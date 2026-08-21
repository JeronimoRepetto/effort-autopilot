import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClaudeCliInvocation,
  ClaudeExecutionError,
  ClaudeRateLimitError,
  executeClaudeTask,
  isRateLimitFailure,
} from "../src/adapters/claude-cli/runner.js";

test("CLI invocation applies effort pre-call and preserves model/provider by omission", () => {
  const invocation = buildClaudeCliInvocation({ effort: "medium", cwd: "C:\\work" });
  assert.equal(invocation.command, "claude");
  assert.equal(invocation.args.includes("--effort"), true);
  assert.equal(invocation.args[invocation.args.indexOf("--effort") + 1], "medium");
  assert.equal(invocation.args.includes("--model"), false);
  assert.equal(invocation.args.includes("--no-session-persistence"), true);
  assert.equal(
    invocation.args.some((value) => /provider/i.test(value)),
    false,
  );
});

test("explicit model and bounded controls are forwarded", () => {
  const invocation = buildClaudeCliInvocation({
    effort: "low",
    cwd: "/work",
    model: "claude-sonnet-example",
    maxTurns: 3,
    maxBudgetUsd: 0.25,
    permissionMode: "dontAsk",
  });
  assert.deepEqual(invocation.args.slice(-8), [
    "--model",
    "claude-sonnet-example",
    "--max-turns",
    "3",
    "--max-budget-usd",
    "0.25",
    "--permission-mode",
    "dontAsk",
  ]);
});

test("locked-down task invocation exposes only approved edit tools", () => {
  const invocation = buildClaudeCliInvocation({
    effort: "low",
    cwd: "C:\\work",
    safeMode: true,
    tools: ["Read", "Edit", "Write"],
    allowedTools: ["Read", "Edit", "Write"],
  });
  assert.equal(invocation.args.includes("--safe-mode"), true);
  assert.deepEqual(
    invocation.args.slice(
      invocation.args.indexOf("--tools"),
      invocation.args.indexOf("--tools") + 4,
    ),
    ["--tools", "Read,Edit,Write", "--allowedTools", "Read,Edit,Write"],
  );
  assert.equal(
    invocation.args.some((value) => value.includes("Bash")),
    false,
  );
});

test("runner invokes one CLI process, sends prompt only on stdin, and captures usage", async () => {
  let calls = 0;
  let received;
  const processRunner = async (request) => {
    calls += 1;
    received = request;
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "answer",
        session_id: "session",
        num_turns: 2,
        total_cost_usd: 0.012,
        usage: { input_tokens: 10, output_tokens: 20 },
        modelUsage: { "configured-model": { inputTokens: 10, outputTokens: 20 } },
        stop_reason: "end_turn",
      }),
    };
  };
  const result = await executeClaudeTask(
    { prompt: "PRIVATE", effort: "low", cwd: "/work", timeoutMs: 1234 },
    { processRunner },
  );
  assert.equal(calls, 1);
  assert.equal(received.input, "PRIVATE");
  assert.equal(received.timeoutMs, 1234);
  assert.equal(received.args.includes("PRIVATE"), false);
  assert.equal(result.result, "answer");
  assert.equal(result.numTurns, 2);
  assert.equal(result.totalCostUsd, 0.012);
});

test("documented 429 and rate-limit diagnostics stop without retry", async () => {
  assert.equal(isRateLimitFailure({ api_error_status: 429 }, "", 1), true);
  assert.equal(isRateLimitFailure({}, "Usage limit reached; resets at 08:00", 1), true);
  let calls = 0;
  await assert.rejects(
    executeClaudeTask(
      { prompt: "PRIVATE", effort: "low", cwd: "/work" },
      {
        processRunner: async () => {
          calls += 1;
          return {
            exitCode: 1,
            stdout: JSON.stringify({ subtype: "error_during_execution", api_error_status: 429 }),
            stderr: "",
          };
        },
      },
    ),
    (error) => error instanceof ClaudeRateLimitError && error.rateLimited,
  );
  assert.equal(calls, 1);
});

test("execution failure does not expose or retry prompt", async () => {
  let calls = 0;
  await assert.rejects(
    executeClaudeTask(
      { prompt: "PRIVATE", effort: "low", cwd: "/work" },
      {
        processRunner: async () => {
          calls += 1;
          return { exitCode: 1, stdout: "", stderr: "unrelated failure" };
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof ClaudeExecutionError);
      assert.equal(error.message.includes("PRIVATE"), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});
