import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { ClaudeRateLimitError } from "../adapters/claude-cli/runner.js";
import { launchTask } from "../launcher/launch.js";
import { loadTaskPrompt, prepareWorkspace, runVerifier, runVerifierProcess } from "./pilot.js";

/**
 * Calibration pipeline: adaptive minimum-sufficient-effort search.
 *
 * For every task it forces executions at specific effort levels (bypassing
 * the classifier entirely) and finds the LOWEST effort that passes the
 * task's protected verifier reliably, per docs/CALIBRATION.md: start near
 * the task's calibration hint, walk down after reliable success, walk up
 * after failure, repeat runs near the boundary. Every trial is checkpointed
 * atomically and resume never repeats a completed task. There is no retry
 * hidden anywhere: a trial is one execution.
 *
 * Checkpoints contain task IDs and metrics, never prompt text. The exported
 * dataset (prompt + label) is written only to explicit local paths and is
 * expected to live under ignored directories.
 */

export const CALIBRATION_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
}

function outputTokens(usage) {
  return Number(usage?.output_tokens ?? usage?.outputTokens ?? 0) || 0;
}

/** Forces one execution at exactly `effort` (classifier bypassed). */
function forcedEffortConfig(effort) {
  return { ceiling: effort, baselineEffort: effort };
}

const FORCED_CLASSIFIER = () => ({
  status: "fallback",
  fallback: "forced",
  errorCode: "calibration-forced-effort",
});

export async function runCalibration({
  manifest,
  cwd,
  resultsFile,
  workspaceRoot,
  mock = true,
  runner,
  processRunner = runVerifierProcess,
  verifyTrial,
  efforts = ["low", "medium", "high"],
  repeats = 1,
  requiredPasses = 1,
  maxTrialsPerTask = 8,
  maxTotalOutputTokens,
  maxTotalCostUsd,
  maxTurns,
  permissionMode,
  model,
  resume = false,
  progress = () => {},
}) {
  if (!efforts.every((effort) => CALIBRATION_EFFORTS.includes(effort))) {
    throw new TypeError("efforts must be a subset of the effort ladder");
  }
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) {
    throw new TypeError("repeats must be 1..5");
  }
  if (requiredPasses > repeats) throw new TypeError("requiredPasses cannot exceed repeats");

  let state = {
    schemaVersion: 1,
    kind: "calibration",
    benchmark: manifest.benchmark,
    mock,
    efforts,
    repeats,
    requiredPasses,
    trials: [],
    tasks: {},
    totalCostUsd: 0,
    totalOutputTokens: 0,
    stopReason: null,
  };
  if (resume) {
    try {
      const existing = JSON.parse(await readFile(resultsFile, "utf8"));
      if (
        existing.kind !== "calibration" ||
        existing.benchmark !== manifest.benchmark ||
        existing.mock !== mock
      ) {
        throw new Error("checkpoint does not match calibration benchmark or mode");
      }
      state = existing;
      state.stopReason = null;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const ladder = CALIBRATION_EFFORTS.filter((effort) => efforts.includes(effort));

  const overBudget = () =>
    (maxTotalOutputTokens !== undefined && state.totalOutputTokens >= maxTotalOutputTokens) ||
    (maxTotalCostUsd !== undefined && state.totalCostUsd >= maxTotalCostUsd);

  for (const task of manifest.tasks) {
    const taskState = (state.tasks[task.id] ??= {
      trials: 0,
      results: {},
      minimumSufficientEffort: null,
      status: "pending",
    });
    if (taskState.status !== "pending") continue;
    if (overBudget()) {
      state.stopReason = "budget-ceiling";
      break;
    }
    progress(`calibrate task=${task.id}`);

    const runTrial = async (effort) => {
      if (overBudget()) return "budget";
      if (taskState.trials >= maxTrialsPerTask) return "task-budget";
      taskState.trials += 1;
      const attempt = taskState.trials;
      const started = Date.now();
      const prepared = await prepareWorkspace(task, workspaceRoot, mock, cwd);
      const prompt = await loadTaskPrompt(task, prepared.workspace, mock);
      let verifier = "fail";
      let agentOutcome = "success";
      let cost;
      let tokens;
      let turns = null;
      try {
        const launched = await launchTask({
          prompt,
          config: forcedEffortConfig(effort),
          classifier: FORCED_CLASSIFIER,
          execution: {
            cwd: prepared.workspace,
            model,
            maxTurns: task.maxTurns ?? maxTurns,
            timeoutMs: task.timeoutMs,
            permissionMode,
            safeMode: task.safeMode,
            tools: task.tools,
            allowedTools: task.allowedTools,
          },
          runner,
        });
        cost = Number(launched.execution.totalCostUsd ?? 0) || 0;
        tokens = outputTokens(launched.execution.usage);
        turns = launched.execution.numTurns ?? null;
        verifier = verifyTrial
          ? await verifyTrial({
              task,
              effort,
              workspace: prepared.workspace,
              source: prepared.source,
            })
          : await runVerifier(task, prepared.workspace, {
              mock,
              source: prepared.source,
              processRunner,
            });
      } catch (error) {
        if (error instanceof ClaudeRateLimitError) {
          state.stopReason = "subscription-limit";
          await atomicJson(resultsFile, state);
          return "stop";
        }
        agentOutcome = error?.code ?? "launcher-error";
        cost = Number(error?.metadata?.totalCostUsd ?? 0) || 0;
        tokens = outputTokens(error?.metadata?.usage);
      }
      state.totalCostUsd += cost;
      state.totalOutputTokens += tokens;
      state.trials.push({
        taskId: task.id,
        effort,
        attempt,
        verifier,
        agentOutcome,
        elapsedMs: Date.now() - started,
        numTurns: turns,
        totalCostUsd: cost,
        outputTokens: tokens,
      });
      const bucket = (taskState.results[effort] ??= { passes: 0, fails: 0 });
      if (verifier === "pass") bucket.passes += 1;
      else bucket.fails += 1;
      progress(`  effort=${effort} attempt=${attempt} verifier=${verifier}`);
      await atomicJson(resultsFile, state);
      return verifier;
    };

    // Reliable = requiredPasses passes within `repeats` runs; early exit both ways.
    const reliablePass = async (effort) => {
      const bucket = taskState.results[effort] ?? { passes: 0, fails: 0 };
      while (bucket.passes < requiredPasses && bucket.fails <= repeats - requiredPasses) {
        if (bucket.passes + bucket.fails >= repeats) break;
        const outcome = await runTrial(effort);
        if (outcome === "stop" || outcome === "budget" || outcome === "task-budget") return outcome;
        bucket.passes = taskState.results[effort].passes;
        bucket.fails = taskState.results[effort].fails;
      }
      return taskState.results[effort]?.passes >= requiredPasses ? "pass" : "fail";
    };

    const startEffort = ladder.includes(task.calibrationStartingEffort)
      ? task.calibrationStartingEffort
      : ladder[Math.floor((ladder.length - 1) / 2)];
    let index = ladder.indexOf(startEffort);
    const outcome = await reliablePass(ladder[index]);
    let aborted = null;

    if (outcome === "pass") {
      // Walk down: lowest reliable pass wins.
      while (index > 0) {
        const lower = await reliablePass(ladder[index - 1]);
        if (lower === "pass") index -= 1;
        else if (lower === "fail") break;
        else {
          aborted = lower;
          break;
        }
      }
      if (!aborted) {
        taskState.minimumSufficientEffort = ladder[index];
        taskState.status = "completed";
      }
    } else if (outcome === "fail") {
      // Walk up until something passes.
      while (index < ladder.length - 1) {
        index += 1;
        const higher = await reliablePass(ladder[index]);
        if (higher === "pass") {
          taskState.minimumSufficientEffort = ladder[index];
          taskState.status = "completed";
          break;
        }
        if (higher !== "fail") {
          aborted = higher;
          break;
        }
      }
      if (taskState.status === "pending" && !aborted) {
        taskState.minimumSufficientEffort = null;
        taskState.status = "no-passing-effort";
      }
    } else {
      aborted = outcome;
    }

    if (aborted === "stop") break;
    if (aborted === "budget") {
      state.stopReason = "budget-ceiling";
      await atomicJson(resultsFile, state);
      break;
    }
    if (aborted === "task-budget") taskState.status = "trial-budget-exhausted";
    await atomicJson(resultsFile, state);
  }

  await atomicJson(resultsFile, state);
  return state;
}

/** Deterministic train/val/test split by task id hash (70/15/15). */
export function splitForTask(taskId) {
  const bucket = parseInt(createHash("sha256").update(taskId).digest("hex").slice(0, 8), 16) % 100;
  if (bucket < 70) return "train";
  if (bucket < 85) return "validation";
  return "test";
}

/**
 * Exports {prompt, label, split, taskId} rows for the ordinal-head trainer.
 * Prompts come from the immutable task sources; write the output only to an
 * ignored local path — the dataset is never committed or published.
 */
export async function exportCalibrationDataset(state, manifest, { cwd, loadPrompt } = {}) {
  const rows = [];
  const readPrompt =
    loadPrompt ??
    (async (task) => readFile(path.resolve(cwd, task.workspaceSource, task.promptFile), "utf8"));
  for (const task of manifest.tasks) {
    const taskState = state.tasks[task.id];
    if (taskState?.status !== "completed" || !taskState.minimumSufficientEffort) continue;
    rows.push({
      taskId: task.id,
      split: splitForTask(task.id),
      label: taskState.minimumSufficientEffort,
      prompt: await readPrompt(task),
    });
  }
  return rows;
}

/**
 * Honest summary including baseline comparison over VISITED efforts only —
 * coverage gaps are reported, never silently treated as data.
 */
export function summarizeCalibration(state, totalTasks) {
  const tasks = Object.entries(state.tasks);
  const completed = tasks.filter(([, task]) => task.status === "completed");
  const baselines = {};
  for (const effort of state.efforts) {
    let visited = 0;
    let reliablePasses = 0;
    for (const [, task] of tasks) {
      const bucket = task.results[effort];
      if (!bucket) continue;
      visited += 1;
      if (bucket.passes >= state.requiredPasses) reliablePasses += 1;
    }
    baselines[`always-${effort}`] = {
      tasksVisited: visited,
      tasksNotVisited: totalTasks - visited,
      reliablePasses,
    };
  }
  return Object.freeze({
    totalTasks,
    completed: completed.length,
    noPassingEffort: tasks.filter(([, task]) => task.status === "no-passing-effort").length,
    trialBudgetExhausted: tasks.filter(([, task]) => task.status === "trial-budget-exhausted")
      .length,
    pending: totalTasks - tasks.filter(([, task]) => task.status !== "pending").length,
    trialsRun: state.trials.length,
    totalOutputTokens: state.totalOutputTokens,
    totalCostUsd: state.totalCostUsd,
    stopReason: state.stopReason ?? null,
    minimumByTask: Object.fromEntries(
      completed.map(([taskId, task]) => [taskId, task.minimumSufficientEffort]),
    ),
    baselines: Object.freeze(baselines),
  });
}
