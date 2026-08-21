import assert from "node:assert/strict";
import test from "node:test";

import { brokerTurn } from "../src/broker/turn-controller.js";

const PROMPT = "Implement the scoped parser fix and add tests.";
const MODEL = "claude-sonnet-5";

function confidentClassification(effort = "medium", confidence = 0.8) {
  return {
    status: "ok",
    decision: {
      tier: effort,
      confidence,
      reasons: ["synthetic"],
      execution: { claudeEffort: effort },
      context: { modelProfileId: MODEL },
    },
  };
}

async function run(overrides = {}) {
  const forwarded = [];
  const statuses = [];
  let applyCalls = 0;
  const metadata = await brokerTurn({
    prompt: PROMPT,
    activeModel: MODEL,
    activeEffort: "high",
    config: { ceiling: "medium", baselineEffort: "medium" },
    classifier: () => confidentClassification(),
    applyEffort: async (effort) => {
      applyCalls += 1;
      return { acknowledged: true, effort };
    },
    forwardPrompt: async (prompt) => forwarded.push(prompt),
    onStatus: async (status) => statuses.push(status),
    ...overrides,
  });
  return { metadata, forwarded, statuses, applyCalls };
}

test("acknowledged automatic effort precedes one exact prompt forward", async () => {
  const events = [];
  const result = await run({
    classifier: () => {
      events.push("classified");
      return confidentClassification();
    },
    applyEffort: async (effort) => {
      events.push(`ack:${effort}`);
      return { acknowledged: true, effort };
    },
    forwardPrompt: async (prompt) => events.push(`forward:${prompt}`),
  });
  assert.deepEqual(events, ["classified", "ack:medium", `forward:${PROMPT}`]);
  assert.equal(result.metadata.outcome, "applied");
  assert.equal(result.metadata.appliedEffort, "medium");
  assert.equal(result.metadata.promptForwarded, true);
});

test("explicit user effort has precedence and bypasses classification and mutation", async () => {
  let classifications = 0;
  const result = await run({
    explicitUserEffort: true,
    classifier: () => {
      classifications += 1;
      return confidentClassification();
    },
  });
  assert.equal(classifications, 0);
  assert.equal(result.applyCalls, 0);
  assert.deepEqual(result.forwarded, [PROMPT]);
  assert.equal(result.metadata.cause, "explicit-user-effort");
});

for (const [name, overrides, expectedCause] of [
  ["ambiguous terminal state", { terminalState: "permission-prompt" }, "ambiguous-terminal-state"],
  ["unsupported model", { activeModel: "sonnet" }, "unsupported-or-ambiguous-model"],
  [
    "insufficient confidence",
    { classifier: () => confidentClassification("medium", 0.4) },
    "insufficient-confidence",
  ],
  [
    "classification failure",
    { classifier: () => ({ status: "fallback" }) },
    "classification-failed",
  ],
  [
    "classification exception",
    {
      classifier: () => {
        throw new Error("boom");
      },
    },
    "classification-failed",
  ],
  [
    "unacknowledged effort",
    { applyEffort: async () => ({ acknowledged: false }) },
    "effort-not-acknowledged",
  ],
]) {
  test(`${name} visibly forwards unchanged exactly once`, async () => {
    const result = await run(overrides);
    assert.deepEqual(result.forwarded, [PROMPT]);
    assert.equal(result.metadata.outcome, "unchanged");
    assert.equal(result.metadata.cause, expectedCause);
    assert.equal(result.metadata.appliedEffort, null);
    assert.equal(result.metadata.promptForwarded, true);
    assert.equal(result.statuses.length, 1);
  });
}

test("classification timeout fails open without a late duplicate", async () => {
  let resolveClassification;
  const result = await run({
    classificationTimeoutMs: 5,
    classifier: () =>
      new Promise((resolve) => {
        resolveClassification = resolve;
      }),
  });
  assert.deepEqual(result.forwarded, [PROMPT]);
  assert.equal(result.metadata.cause, "classification-timeout");
  resolveClassification(confidentClassification());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result.forwarded, [PROMPT]);
});

test("telemetry never contains prompt content", async () => {
  const result = await run();
  assert.doesNotMatch(JSON.stringify(result.metadata), /scoped parser fix/i);
  assert.doesNotMatch(JSON.stringify(result.statuses), /scoped parser fix/i);
});
