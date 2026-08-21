import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { ClaudeRateLimitError } from "../adapters/claude-cli/runner.js";
import { launchTask } from "../launcher/launch.js";

const VERIFIABLE_TERMINAL_CODES = new Set([
  "error_max_turns",
  "error_max_budget_usd",
  "execution-timeout",
]);

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pilot";
}

function outputTokens(usage) {
  return Number(usage?.output_tokens ?? usage?.outputTokens ?? 0) || 0;
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
}

export function summarizePilot(state, totalTasks) {
  const completed = state.trials.length;
  return Object.freeze({
    completed,
    pending: Math.max(0, totalTasks - completed),
    passed: state.trials.filter(({ verifier }) => verifier === "pass").length,
    failed: state.trials.filter(({ verifier }) => verifier === "fail").length,
    launcherErrors:
      state.trials.filter(({ status }) => status === "launcher-error").length +
      (state.stopReason === "launcher-error" ? 1 : 0),
    stoppedForLimit: state.stopReason === "subscription-limit",
    stoppedForMaxTurns: state.stopReason === "max-turns",
    verifiedAfterTerminal: state.trials.filter(
      ({ verifiedAfterTerminal }) => verifiedAfterTerminal === true,
    ).length,
    stopReason: state.stopReason ?? null,
  });
}

export function createMockRunner({ model = "mock-preserved-model" } = {}) {
  return async () => ({
    result: "mock execution complete",
    sessionId: null,
    subtype: "success",
    numTurns: 1,
    totalCostUsd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    modelUsage: { [model]: { inputTokens: 0, outputTokens: 0, costUSD: 0 } },
    stopReason: "end_turn",
  });
}

function resolveWithin(root, relativePath) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relativePath);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`path escapes workspace: ${relativePath}`);
  }
  return absolute;
}

async function protectedFilesIntact(task, source, workspace) {
  if (!source || !Array.isArray(task.protectedFiles)) return true;
  for (const relativePath of task.protectedFiles) {
    if (typeof relativePath !== "string" || relativePath.length === 0) return false;
    const [original, candidate] = await Promise.all([
      readFile(resolveWithin(source, relativePath)),
      readFile(resolveWithin(workspace, relativePath)),
    ]);
    if (!original.equals(candidate)) return false;
  }
  return true;
}

async function runVerifier(task, workspace, { mock, source, processRunner = runVerifierProcess }) {
  if (mock) return task.mockVerifierPass === false ? "fail" : "pass";
  if (!(await protectedFilesIntact(task, source, workspace))) return "fail";
  const command = task.verifier?.command;
  if (!command) return "fail";
  const completed = await processRunner({
    command,
    args: task.verifier.args ?? [],
    cwd: workspace,
    timeoutMs: task.verifier.timeoutMs ?? task.timeoutMs,
  });
  return completed.exitCode === 0 ? "pass" : "fail";
}

export function runVerifierProcess({ command, args, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
            finish(resolve, { exitCode: null, timedOut: true });
          }, timeoutMs)
        : null;
    child.on("error", (error) => finish(reject, error));
    child.on("close", (exitCode) => finish(resolve, { exitCode, timedOut: false }));
  });
}

async function prepareWorkspace(task, root, mock, baseCwd) {
  const workspace = path.join(root, safeName(task.id));
  await mkdir(path.dirname(workspace), { recursive: true });
  if (mock) {
    await mkdir(workspace, { recursive: true });
    return { workspace, source: null };
  }
  if (!task.workspaceSource) throw new Error(`task ${task.id} has no workspaceSource`);
  // A pending trial may have a partial workspace from a stopped execution.
  // It is local, ignored pilot state; recreate it from the immutable source.
  await rm(workspace, { recursive: true, force: true });
  await cp(path.resolve(baseCwd, task.workspaceSource), workspace, {
    recursive: true,
    errorOnExist: true,
  });
  return { workspace, source: path.resolve(baseCwd, task.workspaceSource) };
}

async function loadTaskPrompt(task, workspace, mock) {
  if (mock)
    return `Public dry-run benchmark task ${task.id}: implement and verify a bounded change.`;
  if (!task.promptFile) throw new Error(`task ${task.id} has no promptFile`);
  return readFile(path.resolve(workspace, task.promptFile), "utf8");
}

function modelLabel(execution, explicitModel, mock) {
  const used = Object.keys(execution.modelUsage ?? {});
  if (used.length) return used.join(",");
  if (explicitModel) return explicitModel;
  return mock ? "mock-preserved-model" : "preserved-configured-model";
}

/**
 * Run a bounded pilot with one launcher/Claude process per trial and no retry.
 * Checkpoints contain task IDs and metrics, never prompt text.
 */
export async function runPilot({
  manifest,
  cwd,
  resultsFile,
  workspaceRoot,
  maxRuns,
  resume = false,
  mock = true,
  model,
  ceiling,
  baselineEffort,
  maxTotalCostUsd,
  maxTotalOutputTokens,
  maxTurns,
  permissionMode,
  runner,
  metadataCollector,
  progress = () => {},
  processRunner,
}) {
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 10) {
    throw new Error("maxRuns must be between 1 and 10");
  }
  const tasks = manifest.tasks.slice(0, maxRuns);
  let state = {
    schemaVersion: 1,
    benchmark: manifest.benchmark,
    mock,
    model: model ?? "preserved-configured-model",
    maxRuns,
    trials: [],
    totalCostUsd: 0,
    totalOutputTokens: 0,
    stopReason: null,
  };
  if (resume) {
    try {
      const existing = JSON.parse(await readFile(resultsFile, "utf8"));
      if (existing.benchmark !== manifest.benchmark || existing.mock !== mock) {
        throw new Error("checkpoint does not match benchmark or mode");
      }
      state = existing;
      state.stopReason = null;
      delete state.lastError;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const completedIds = new Set(state.trials.map(({ taskId }) => taskId));
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (completedIds.has(task.id)) continue;
    if (maxTotalCostUsd !== undefined && state.totalCostUsd >= maxTotalCostUsd) {
      state.stopReason = "cost-ceiling";
      break;
    }
    if (maxTotalOutputTokens !== undefined && state.totalOutputTokens >= maxTotalOutputTokens) {
      state.stopReason = "token-ceiling";
      break;
    }

    progress(`benchmark=${manifest.benchmark} task=${task.id} (${index + 1}/${tasks.length})`);
    const started = Date.now();
    const prepared = await prepareWorkspace(task, workspaceRoot, mock, cwd);
    const { workspace } = prepared;
    const prompt = await loadTaskPrompt(task, workspace, mock);
    const environment = metadataCollector(workspace);
    let planned = null;

    try {
      const launched = await launchTask({
        prompt,
        environment,
        config: {
          ceiling: task.ceiling ?? ceiling,
          baselineEffort: task.baselineEffort ?? baselineEffort,
        },
        execution: {
          cwd: workspace,
          model,
          maxTurns: task.maxTurns ?? maxTurns,
          timeoutMs: task.timeoutMs,
          maxBudgetUsd:
            maxTotalCostUsd === undefined
              ? undefined
              : Math.max(0.000001, maxTotalCostUsd - state.totalCostUsd),
          permissionMode,
          safeMode: task.safeMode,
          tools: task.tools,
          allowedTools: task.allowedTools,
        },
        runner,
        onPlan: (plan) => {
          planned = plan;
          progress(`  effort=${plan.effort} model=${model ?? "preserved-configured-model"}`);
          progress(`  reasons=${plan.reasons.slice(0, 2).join(" | ")}`);
        },
      });
      const verifier = await runVerifier(task, workspace, {
        mock,
        source: prepared.source,
        processRunner,
      });
      const elapsedMs = Date.now() - started;
      const cost = Number(launched.execution.totalCostUsd ?? 0) || 0;
      const tokens = outputTokens(launched.execution.usage);
      state.totalCostUsd += cost;
      state.totalOutputTokens += tokens;
      state.trials.push({
        taskId: task.id,
        status: "completed",
        verifier,
        agentOutcome: "success",
        finalResultAvailable: true,
        usageAvailable: launched.execution.usage != null,
        verifiedAfterTerminal: false,
        effort: launched.routing.effort,
        classifierTier: launched.routing.classifierTier,
        model: modelLabel(launched.execution, model, mock),
        elapsedMs,
        numTurns: launched.execution.numTurns,
        totalCostUsd: cost,
        usage: launched.execution.usage,
      });
      progress(`  verifier=${verifier.toUpperCase()} elapsed_ms=${elapsedMs}`);
      progress(
        `  model_used=${modelLabel(launched.execution, model, mock)} usage_input=${launched.execution.usage?.input_tokens ?? 0} usage_output=${tokens} turns=${launched.execution.numTurns} estimated_cost_usd=${cost}`,
      );
      await atomicJson(resultsFile, state);
    } catch (error) {
      const errorCode = error?.code ?? "unknown";
      const eligibleForTerminalVerification =
        !mock &&
        prepared.source !== null &&
        VERIFIABLE_TERMINAL_CODES.has(errorCode) &&
        !(error instanceof ClaudeRateLimitError);
      let terminalVerifier = "not-run";
      if (eligibleForTerminalVerification) {
        try {
          terminalVerifier = await runVerifier(task, workspace, {
            mock: false,
            source: prepared.source,
            processRunner,
          });
        } catch {
          terminalVerifier = "fail";
        }
      }

      state.stopReason =
        error instanceof ClaudeRateLimitError
          ? "subscription-limit"
          : errorCode === "error_max_turns"
            ? "max-turns"
            : "launcher-error";
      const errorCost = Number(error?.metadata?.totalCostUsd ?? 0) || 0;
      const errorTokens = outputTokens(error?.metadata?.usage);
      state.totalCostUsd += errorCost;
      state.totalOutputTokens += errorTokens;

      if (terminalVerifier === "pass") {
        const elapsedMs = Date.now() - started;
        state.trials.push({
          taskId: task.id,
          status: "completed",
          verifier: "pass",
          agentOutcome: errorCode,
          finalResultAvailable: false,
          usageAvailable: error?.metadata?.usage != null,
          verifiedAfterTerminal: true,
          effort: planned?.effort ?? null,
          classifierTier: planned?.classifierTier ?? null,
          model: modelLabel(error?.metadata ?? {}, model, false),
          elapsedMs,
          numTurns: error?.metadata?.numTurns ?? null,
          configuredMaxTurns: task.maxTurns ?? maxTurns ?? null,
          totalCostUsd: error?.metadata?.totalCostUsd ?? null,
          usage: error?.metadata?.usage ?? null,
          terminalStopReason: error?.metadata?.stopReason ?? null,
        });
        state.stopReason = null;
        delete state.lastError;
        progress(
          `  verifier=PASS agent_outcome=${errorCode} final_result=false elapsed_ms=${elapsedMs}`,
        );
        progress(
          `  model_used=${modelLabel(error?.metadata ?? {}, model, false)} usage_output=${error?.metadata?.usage == null ? "unavailable" : errorTokens} turns=${error?.metadata?.numTurns ?? "unavailable"} estimated_cost_usd=${error?.metadata?.totalCostUsd ?? "unavailable"}`,
        );
        await atomicJson(resultsFile, state);
        continue;
      }

      state.lastError = {
        taskId: task.id,
        kind: state.stopReason,
        code: errorCode,
        plannedEffort: planned?.effort ?? null,
        numTurns: error?.metadata?.numTurns ?? null,
        totalCostUsd: error?.metadata?.totalCostUsd ?? null,
        usage: error?.metadata?.usage ?? null,
        modelUsage: error?.metadata?.modelUsage ?? null,
        stopReason: error?.metadata?.stopReason ?? null,
        verifierOutcome: terminalVerifier,
      };
      progress(
        `  stopped=${state.stopReason} code=${state.lastError.code} turns=${state.lastError.numTurns ?? "unavailable"}`,
      );
      progress(
        `  model_used=${Object.keys(state.lastError.modelUsage ?? {}).join(",") || model || "unavailable"} usage_output=${errorTokens || "unavailable"} estimated_cost_usd=${state.lastError.totalCostUsd ?? "unavailable"}`,
      );
      await atomicJson(resultsFile, state);
      break;
    }
  }

  if (!state.stopReason) state.stopReason = "complete";
  await atomicJson(resultsFile, state);
  return Object.freeze({
    state: Object.freeze(state),
    summary: summarizePilot(state, tasks.length),
  });
}

/**
 * Promote one previously stopped, verifier-passing workspace without invoking
 * Claude. This is intentionally explicit and idempotent.
 */
export async function recoverVerifiedTerminalTrial({
  manifest,
  cwd,
  resultsFile,
  workspaceRoot,
  taskId,
  processRunner,
}) {
  const state = JSON.parse(await readFile(resultsFile, "utf8"));
  const tasks = manifest.tasks.slice(0, state.maxRuns ?? manifest.tasks.length);
  if (state.benchmark !== manifest.benchmark || state.mock !== false) {
    throw new Error("checkpoint does not match the live benchmark");
  }
  if (state.trials.some((trial) => trial.taskId === taskId)) {
    return Object.freeze({
      recovered: false,
      reason: "already-completed",
      state,
      summary: summarizePilot(state, tasks.length),
    });
  }
  const task = tasks.find(({ id }) => id === taskId);
  if (!task) throw new Error(`task is not in the bounded manifest: ${taskId}`);
  const terminal = state.lastError;
  if (terminal?.taskId !== taskId || !VERIFIABLE_TERMINAL_CODES.has(terminal?.code)) {
    throw new Error("checkpoint does not contain a recoverable terminal outcome");
  }
  const source = path.resolve(cwd, task.workspaceSource);
  const workspace = path.join(workspaceRoot, safeName(task.id));
  let verifier = "fail";
  try {
    verifier = await runVerifier(task, workspace, {
      mock: false,
      source,
      processRunner,
    });
  } catch {
    // stays "fail": a crashed verifier is a failed verification
  }
  if (verifier !== "pass") {
    state.lastError.verifierOutcome = verifier;
    await atomicJson(resultsFile, state);
    return Object.freeze({
      recovered: false,
      reason: "verifier-failed",
      state,
      summary: summarizePilot(state, tasks.length),
    });
  }

  const provenance = Object.freeze({
    mode: "existing-stopped-workspace",
    recoveredWithoutModelCall: true,
    priorAgentCode: terminal.code,
    configuredMaxTurns: task.maxTurns ?? null,
    workspace: path.relative(cwd, workspace),
    source: path.relative(cwd, source),
    protectedFiles: task.protectedFiles ?? [],
    verifier: task.verifier ?? null,
    recoveredAt: new Date().toISOString(),
  });
  state.trials.push({
    taskId,
    status: "completed",
    verifier: "pass",
    agentOutcome: terminal.code,
    finalResultAvailable: false,
    usageAvailable: false,
    verifiedAfterTerminal: true,
    effort: terminal.plannedEffort ?? null,
    classifierTier: null,
    model: "unavailable-error-metadata-not-persisted",
    elapsedMs: null,
    numTurns: null,
    configuredMaxTurns: task.maxTurns ?? null,
    totalCostUsd: null,
    usage: null,
    terminalStopReason: null,
    recoveryProvenance: provenance,
  });
  state.metricsCompleteness = "partial-terminal-attempt-metrics-unavailable";
  state.stopReason = "awaiting-authorization";
  state.lastTerminalRecovery = provenance;
  delete state.lastError;
  await atomicJson(resultsFile, state);
  return Object.freeze({
    recovered: true,
    reason: "verifier-passed",
    state,
    summary: summarizePilot(state, tasks.length),
  });
}
