import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ClaudeExecutionError, ClaudeRateLimitError } from "../src/adapters/claude-cli/runner.js";
import { createMockRunner, recoverVerifiedTerminalTrial, runPilot } from "../src/evaluation/pilot.js";

function manifest(ids = ["public-01", "public-02", "public-03"] ) {
  return { benchmark: "test-pilot", tasks: ids.map((id) => ({ id })) };
}

async function locations() {
  const root = await mkdtemp(path.join(os.tmpdir(), "effort-autopilot-pilot-"));
  return {
    root,
    resultsFile: path.join(root, ".effort-autopilot", "evaluation-results", "state.json"),
    workspaceRoot: path.join(root, ".effort-autopilot", "evaluation-workspaces"),
  };
}

const metadataCollector = () => ({ platform: "windows", projectKinds: [] });

test("mock pilot streams visible fields and checkpoints prompt-free results", async () => {
  const place = await locations();
  const lines = [];
  let calls = 0;
  const mock = createMockRunner();
  const pilot = await runPilot({
    manifest: manifest(),
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    maxRuns: 3,
    mock: true,
    ceiling: "medium",
    baselineEffort: "medium",
    runner: async (request) => {
      calls += 1;
      return mock(request);
    },
    metadataCollector,
    progress: (line) => lines.push(line),
  });
  assert.equal(calls, 3);
  assert.equal(pilot.summary.completed, 3);
  assert.equal(pilot.summary.passed, 3);
  assert.ok(lines.some((line) => line.includes("benchmark=test-pilot task=public-01")));
  assert.ok(lines.some((line) => line.includes("effort=")));
  assert.ok(lines.some((line) => line.includes("model=")));
  assert.ok(lines.some((line) => line.includes("verifier=PASS")));
  assert.ok(lines.some((line) => line.includes("usage_input=")));
  const persisted = await readFile(place.resultsFile, "utf8");
  assert.equal(persisted.includes("Public dry-run benchmark task"), false);
  assert.equal(persisted.includes("prompt"), false);
  assert.deepEqual(JSON.parse(persisted).trials.map(({ taskId }) => taskId), [
    "public-01",
    "public-02",
    "public-03",
  ]);
});

test("subscription limit stops immediately and resume skips completed paid work", async () => {
  const place = await locations();
  let firstCalls = 0;
  const success = createMockRunner({ model: "exact-model" });
  const first = await runPilot({
    manifest: manifest(),
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    maxRuns: 3,
    mock: true,
    ceiling: "medium",
    baselineEffort: "medium",
    runner: async (request) => {
      firstCalls += 1;
      if (firstCalls === 2) throw new ClaudeRateLimitError({ exitCode: 1 });
      return success(request);
    },
    metadataCollector,
  });
  assert.equal(firstCalls, 2);
  assert.equal(first.summary.completed, 1);
  assert.equal(first.summary.pending, 2);
  assert.equal(first.summary.stoppedForLimit, true);

  let resumedCalls = 0;
  const resumed = await runPilot({
    manifest: manifest(),
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    maxRuns: 3,
    resume: true,
    mock: true,
    ceiling: "medium",
    baselineEffort: "medium",
    runner: async (request) => {
      resumedCalls += 1;
      return success(request);
    },
    metadataCollector,
  });
  assert.equal(resumedCalls, 2);
  assert.equal(resumed.summary.completed, 3);
  assert.equal(resumed.summary.pending, 0);
  assert.deepEqual(resumed.state.trials.map(({ taskId }) => taskId), [
    "public-01",
    "public-02",
    "public-03",
  ]);
});

test("launcher errors are distinct and never retried", async () => {
  const place = await locations();
  let calls = 0;
  const result = await runPilot({
    manifest: manifest(),
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    maxRuns: 3,
    mock: true,
    ceiling: "medium",
    baselineEffort: "medium",
    runner: async () => {
      calls += 1;
      const error = new Error("failed");
      error.code = "cli-execution-failed";
      throw error;
    },
    metadataCollector,
  });
  assert.equal(calls, 1);
  assert.equal(result.summary.stopReason, "launcher-error");
  assert.equal(result.summary.launcherErrors, 1);
  assert.equal(result.summary.stoppedForLimit, false);
});

test("pilot enforces strict run count", async () => {
  const place = await locations();
  await assert.rejects(
    runPilot({
      manifest: manifest(),
      cwd: place.root,
      resultsFile: place.resultsFile,
      workspaceRoot: place.workspaceRoot,
      maxRuns: 11,
      mock: true,
      runner: createMockRunner(),
      metadataCollector,
    }),
    /between 1 and 10/,
  );
});

test("task-specific ceiling, turn limit, and timeout are applied before one execution", async () => {
  const place = await locations();
  let received;
  const result = await runPilot({
    manifest: {
      benchmark: "task-controls",
      tasks: [{
        id: "public-01",
        ceiling: "low",
        baselineEffort: "low",
        maxTurns: 2,
        timeoutMs: 1234,
      }],
    },
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    maxRuns: 1,
    mock: true,
    ceiling: "high",
    baselineEffort: "medium",
    runner: async (request) => {
      received = request;
      return createMockRunner()(request);
    },
    metadataCollector,
  });
  assert.equal(received.effort, "low");
  assert.equal(received.maxTurns, 2);
  assert.equal(received.timeoutMs, 1234);
  assert.equal(result.state.trials[0].effort, "low");
});

test("live verifier fails if a protected fixture file is changed", async () => {
  const place = await locations();
  const source = path.join(place.root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "TASK.md"), "Public task", "utf8");
  await writeFile(path.join(source, "verify.py"), "raise SystemExit(0)\n", "utf8");
  let verifierCalls = 0;
  const result = await runPilot({
    manifest: {
      benchmark: "protected-verifier",
      tasks: [{
        id: "public-01",
        workspaceSource: "source",
        promptFile: "TASK.md",
        protectedFiles: ["verify.py"],
        verifier: { command: "python", args: ["verify.py"] },
      }],
    },
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    maxRuns: 1,
    mock: false,
    ceiling: "medium",
    baselineEffort: "medium",
    runner: async (request) => {
      await writeFile(path.join(request.cwd, "verify.py"), "raise SystemExit(1)\n", "utf8");
      return createMockRunner()(request);
    },
    metadataCollector,
    processRunner: async () => {
      verifierCalls += 1;
      return { exitCode: 0 };
    },
  });
  assert.equal(verifierCalls, 0);
  assert.equal(result.state.trials[0].verifier, "fail");
});

async function terminalFixture(place, verifierExitCode) {
  const source = path.join(place.root, "terminal-source");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "TASK.md"), "Public task", "utf8");
  await writeFile(path.join(source, "verify.py"), "protected", "utf8");
  let claudeCalls = 0;
  let verifierCalls = 0;
  const result = await runPilot({
    manifest: {
      benchmark: "terminal-verifier",
      tasks: [{
        id: "public-01",
        workspaceSource: "terminal-source",
        promptFile: "TASK.md",
        protectedFiles: ["verify.py"],
        maxTurns: 4,
        verifier: { command: "python", args: ["verify.py"] },
      }],
    },
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    maxRuns: 1,
    mock: false,
    ceiling: "low",
    baselineEffort: "low",
    runner: async () => {
      claudeCalls += 1;
      throw new ClaudeExecutionError("error_max_turns", {
        numTurns: 4,
        totalCostUsd: 0.01,
        usage: { input_tokens: 10, output_tokens: 20 },
        modelUsage: { "inherited-model": { outputTokens: 20 } },
        stopReason: "tool_use",
      });
    },
    metadataCollector,
    processRunner: async () => {
      verifierCalls += 1;
      return { exitCode: verifierExitCode };
    },
  });
  return { result, claudeCalls, verifierCalls };
}

test("max-turn terminal with verifier pass is a completed distinguished trial", async () => {
  const place = await locations();
  const terminal = await terminalFixture(place, 0);
  assert.equal(terminal.claudeCalls, 1);
  assert.equal(terminal.verifierCalls, 1);
  assert.equal(terminal.result.summary.completed, 1);
  assert.equal(terminal.result.summary.passed, 1);
  assert.equal(terminal.result.summary.verifiedAfterTerminal, 1);
  assert.equal(terminal.result.state.trials[0].agentOutcome, "error_max_turns");
  assert.equal(terminal.result.state.trials[0].finalResultAvailable, false);
  assert.equal(terminal.result.state.trials[0].usageAvailable, true);
  assert.equal(terminal.result.state.totalOutputTokens, 20);
});

test("max-turn terminal with verifier failure remains pending and stopped", async () => {
  const place = await locations();
  const terminal = await terminalFixture(place, 1);
  assert.equal(terminal.claudeCalls, 1);
  assert.equal(terminal.verifierCalls, 1);
  assert.equal(terminal.result.summary.completed, 0);
  assert.equal(terminal.result.summary.pending, 1);
  assert.equal(terminal.result.summary.stopReason, "max-turns");
  assert.equal(terminal.result.state.lastError.verifierOutcome, "fail");
});

test("subscription limit never runs the workspace verifier or retries", async () => {
  const place = await locations();
  const source = path.join(place.root, "rate-source");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "TASK.md"), "Public task", "utf8");
  await writeFile(path.join(source, "verify.py"), "protected", "utf8");
  let claudeCalls = 0;
  let verifierCalls = 0;
  const result = await runPilot({
    manifest: { benchmark: "rate-stop", tasks: [{
      id: "public-01",
      workspaceSource: "rate-source",
      promptFile: "TASK.md",
      protectedFiles: ["verify.py"],
      verifier: { command: "python", args: ["verify.py"] },
    }] },
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    maxRuns: 1,
    mock: false,
    ceiling: "low",
    baselineEffort: "low",
    runner: async () => {
      claudeCalls += 1;
      throw new ClaudeRateLimitError({ numTurns: 1 });
    },
    metadataCollector,
    processRunner: async () => {
      verifierCalls += 1;
      return { exitCode: 0 };
    },
  });
  assert.equal(claudeCalls, 1);
  assert.equal(verifierCalls, 0);
  assert.equal(result.summary.stopReason, "subscription-limit");
});

test("terminal recovery is verifier-backed and checkpoint-idempotent", async () => {
  const place = await locations();
  const failed = await terminalFixture(place, 1);
  assert.equal(failed.result.summary.completed, 0);
  const manifestValue = {
    benchmark: "terminal-verifier",
    tasks: [{
      id: "public-01",
      workspaceSource: "terminal-source",
      promptFile: "TASK.md",
      protectedFiles: ["verify.py"],
      maxTurns: 4,
      verifier: { command: "python", args: ["verify.py"] },
    }],
  };
  const recover = () => recoverVerifiedTerminalTrial({
    manifest: manifestValue,
    cwd: place.root,
    resultsFile: place.resultsFile,
    workspaceRoot: place.workspaceRoot,
    taskId: "public-01",
    processRunner: async () => ({ exitCode: 0 }),
  });
  const first = await recover();
  const second = await recover();
  assert.equal(first.recovered, true);
  assert.equal(first.summary.completed, 1);
  assert.equal(second.recovered, false);
  assert.equal(second.reason, "already-completed");
  assert.equal(second.state.trials.length, 1);
  assert.equal(second.state.trials[0].recoveredWithoutModelCall, undefined);
  assert.equal(second.state.trials[0].recoveryProvenance.recoveredWithoutModelCall, true);
});
