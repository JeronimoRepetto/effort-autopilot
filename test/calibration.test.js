import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ClaudeRateLimitError } from "../src/adapters/claude-cli/runner.js";
import {
  exportCalibrationDataset,
  runCalibration,
  splitForTask,
  summarizeCalibration,
} from "../src/evaluation/calibration.js";
import { createMockRunner } from "../src/evaluation/pilot.js";

function manifestOf(tasks) {
  return { benchmark: "calibration-mock", tasks };
}

function task(id, { start = "medium", ...rest } = {}) {
  return { id, calibrationStartingEffort: start, safeMode: true, ...rest };
}

async function withTemp(run) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "effort-autopilot-calibration-"));
  try {
    return await run(temp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

// verifyTrial fake: pass iff the effort is >= the task's hidden true minimum.
function oracle(minimums) {
  const ladder = ["low", "medium", "high", "xhigh", "max"];
  return async ({ task: current, effort }) =>
    ladder.indexOf(effort) >= ladder.indexOf(minimums[current.id]) ? "pass" : "fail";
}

test("adaptive search finds each task's minimum without sweeping the ladder", async () =>
  withTemp(async (temp) => {
    const manifest = manifestOf([
      task("t/low", { start: "medium" }),
      task("t/high", { start: "medium" }),
      task("t/medium", { start: "medium" }),
    ]);
    const state = await runCalibration({
      manifest,
      cwd: temp,
      resultsFile: path.join(temp, "calibration.json"),
      workspaceRoot: path.join(temp, "ws"),
      mock: true,
      runner: createMockRunner(),
      verifyTrial: oracle({ "t/low": "low", "t/high": "high", "t/medium": "medium" }),
      efforts: ["low", "medium", "high"],
    });
    const summary = summarizeCalibration(state, manifest.tasks.length);
    assert.deepEqual(summary.minimumByTask, {
      "t/low": "low",
      "t/high": "high",
      "t/medium": "medium",
    });
    // Adaptive: t/medium resolves in 2 trials (medium pass, low fail), never 3.
    assert.equal(state.trials.filter(({ taskId }) => taskId === "t/medium").length, 2);
    assert.equal(summary.completed, 3);
    assert.equal(summary.stopReason, null);
  }));

test("a task that fails every effort is reported as no-passing-effort", async () =>
  withTemp(async (temp) => {
    const manifest = manifestOf([task("t/impossible", { start: "low" })]);
    const state = await runCalibration({
      manifest,
      cwd: temp,
      resultsFile: path.join(temp, "calibration.json"),
      workspaceRoot: path.join(temp, "ws"),
      mock: true,
      runner: createMockRunner(),
      verifyTrial: async () => "fail",
      efforts: ["low", "medium", "high"],
    });
    assert.equal(state.tasks["t/impossible"].status, "no-passing-effort");
    assert.equal(state.tasks["t/impossible"].minimumSufficientEffort, null);
    assert.equal(summarizeCalibration(state, 1).noPassingEffort, 1);
  }));

test("boundary repeats require reliable passes before accepting a level", async () =>
  withTemp(async (temp) => {
    // "medium" flakes (pass, then fail); "high" always passes.
    let mediumCalls = 0;
    const state = await runCalibration({
      manifest: manifestOf([task("t/flaky", { start: "medium" })]),
      cwd: temp,
      resultsFile: path.join(temp, "calibration.json"),
      workspaceRoot: path.join(temp, "ws"),
      mock: true,
      runner: createMockRunner(),
      verifyTrial: async ({ effort }) => {
        if (effort === "medium") return (mediumCalls += 1) === 1 ? "pass" : "fail";
        return effort === "high" ? "pass" : "fail";
      },
      efforts: ["low", "medium", "high"],
      repeats: 2,
      requiredPasses: 2,
    });
    // medium got 1 pass + 1 fail -> unreliable -> escalates to high.
    assert.equal(state.tasks["t/flaky"].minimumSufficientEffort, "high");
    assert.deepEqual(state.tasks["t/flaky"].results.medium, { passes: 1, fails: 1 });
  }));

test("resume never repeats completed tasks and preserves totals", async () =>
  withTemp(async (temp) => {
    const resultsFile = path.join(temp, "calibration.json");
    const options = {
      manifest: manifestOf([task("t/a", { start: "low" })]),
      cwd: temp,
      resultsFile,
      workspaceRoot: path.join(temp, "ws"),
      mock: true,
      efforts: ["low", "medium", "high"],
      verifyTrial: oracle({ "t/a": "low" }),
    };
    let firstRuns = 0;
    await runCalibration({
      ...options,
      runner: async (...args) => {
        firstRuns += 1;
        return createMockRunner()(...args);
      },
    });
    let secondRuns = 0;
    const resumed = await runCalibration({
      ...options,
      resume: true,
      runner: async (...args) => {
        secondRuns += 1;
        return createMockRunner()(...args);
      },
    });
    assert.ok(firstRuns >= 1);
    assert.equal(secondRuns, 0);
    assert.equal(resumed.tasks["t/a"].status, "completed");
  }));

test("subscription limit checkpoints and stops immediately without retry", async () =>
  withTemp(async (temp) => {
    let calls = 0;
    const state = await runCalibration({
      manifest: manifestOf([task("t/a", { start: "low" }), task("t/b", { start: "low" })]),
      cwd: temp,
      resultsFile: path.join(temp, "calibration.json"),
      workspaceRoot: path.join(temp, "ws"),
      mock: true,
      runner: async () => {
        calls += 1;
        throw new ClaudeRateLimitError("subscription limit reached");
      },
      verifyTrial: async () => "pass",
      efforts: ["low", "medium"],
    });
    assert.equal(calls, 1);
    assert.equal(state.stopReason, "subscription-limit");
    assert.equal(state.tasks["t/a"].status, "pending");
    const persisted = JSON.parse(await readFile(path.join(temp, "calibration.json"), "utf8"));
    assert.equal(persisted.stopReason, "subscription-limit");
  }));

test("the output-token ceiling stops the run with an honest stop reason", async () =>
  withTemp(async (temp) => {
    const runner = async () => ({
      result: "done",
      subtype: "success",
      numTurns: 1,
      totalCostUsd: 0,
      usage: { input_tokens: 0, output_tokens: 500 },
      modelUsage: {},
    });
    const state = await runCalibration({
      manifest: manifestOf([task("t/a", { start: "low" }), task("t/b", { start: "low" })]),
      cwd: temp,
      resultsFile: path.join(temp, "calibration.json"),
      workspaceRoot: path.join(temp, "ws"),
      mock: true,
      runner,
      verifyTrial: async () => "pass",
      efforts: ["low"],
      maxTotalOutputTokens: 400,
    });
    assert.equal(state.stopReason, "budget-ceiling");
    assert.equal(summarizeCalibration(state, 2).pending, 1);
  }));

test("dataset export carries prompt + label with a deterministic split", async () =>
  withTemp(async (temp) => {
    const manifest = manifestOf([task("t/a", { start: "low" }), task("t/b", { start: "low" })]);
    const state = await runCalibration({
      manifest,
      cwd: temp,
      resultsFile: path.join(temp, "calibration.json"),
      workspaceRoot: path.join(temp, "ws"),
      mock: true,
      runner: createMockRunner(),
      verifyTrial: oracle({ "t/a": "low", "t/b": "medium" }),
      efforts: ["low", "medium", "high"],
    });
    const rows = await exportCalibrationDataset(state, manifest, {
      cwd: temp,
      loadPrompt: async (current) => `prompt for ${current.id}`,
    });
    assert.deepEqual(
      rows.map(({ taskId, label }) => [taskId, label]),
      [
        ["t/a", "low"],
        ["t/b", "medium"],
      ],
    );
    for (const row of rows) {
      assert.equal(row.split, splitForTask(row.taskId));
      assert.ok(["train", "validation", "test"].includes(row.split));
      assert.match(row.prompt, /prompt for/);
    }
    // Determinism across calls.
    assert.equal(splitForTask("t/a"), splitForTask("t/a"));
  }));

test("baseline summary reports coverage gaps instead of silently extrapolating", async () =>
  withTemp(async (temp) => {
    const state = await runCalibration({
      manifest: manifestOf([task("t/high", { start: "high" })]),
      cwd: temp,
      resultsFile: path.join(temp, "calibration.json"),
      workspaceRoot: path.join(temp, "ws"),
      mock: true,
      runner: createMockRunner(),
      verifyTrial: oracle({ "t/high": "high" }),
      efforts: ["low", "medium", "high"],
    });
    const { baselines } = summarizeCalibration(state, 1);
    assert.equal(baselines["always-high"].tasksVisited, 1);
    assert.equal(baselines["always-high"].reliablePasses, 1);
    // "low" was never visited by the adaptive walk (medium already failed).
    assert.equal(baselines["always-low"].tasksNotVisited, 1);
  }));
