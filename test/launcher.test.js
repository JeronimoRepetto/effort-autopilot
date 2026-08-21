import assert from "node:assert/strict";
import test from "node:test";

import { launchTask } from "../src/launcher/launch.js";
import { resolveExecutionPlan } from "../src/launcher/plan.js";

function decision(tier, effort = tier) {
  return {
    status: "ok",
    decision: {
      tier,
      confidence: 0.8,
      reasons: ["test reason"],
      execution: { claudeEffort: effort },
    },
  };
}

test("classification and planning happen before exactly one Claude invocation", async () => {
  const events = [];
  let calls = 0;
  const result = await launchTask({
    prompt: "private prompt",
    classifier: () => {
      events.push("classify");
      return decision("high");
    },
    onPlan: (plan) => {
      events.push(`plan:${plan.effort}`);
    },
    runner: async ({ effort }) => {
      calls += 1;
      events.push(`run:${effort}`);
      return { result: "done", numTurns: 1 };
    },
    config: { ceiling: "medium", baselineEffort: "medium" },
  });
  assert.deepEqual(events, ["classify", "plan:medium", "run:medium"]);
  assert.equal(calls, 1);
  assert.equal(result.routing.status, "planned");
  assert.equal(result.execution.result, "done");
});

test("ceiling clamps every higher recommendation", () => {
  for (const tier of ["high", "xhigh", "max"]) {
    const plan = resolveExecutionPlan(decision(tier), {
      ceiling: "medium",
      baselineEffort: "medium",
    });
    assert.equal(plan.effort, "medium", tier);
    assert.equal(plan.ceilingApplied, true);
  }
});

test("lower recommendations remain below the ceiling", () => {
  const plan = resolveExecutionPlan(decision("low"), {
    ceiling: "medium",
    baselineEffort: "medium",
  });
  assert.equal(plan.effort, "low");
  assert.equal(plan.ceilingApplied, false);
});

test("ultracode is never silently enabled in savings mode", () => {
  const plan = resolveExecutionPlan(decision("ultracode", "xhigh"), {
    ceiling: "max",
    baselineEffort: "medium",
  });
  assert.equal(plan.effort, "xhigh");
  assert.equal(plan.ultracodeSuppressed, true);
  assert.equal(plan.orchestrationMode, "standard");
  assert.ok(plan.reasons.some((reason) => reason.includes("orchestration is disabled")));
});

test("classification failure uses baseline clamped by ceiling", async () => {
  let received;
  const result = await launchTask({
    prompt: "private prompt",
    classifier: () => {
      throw new Error("classifier broke");
    },
    runner: async (request) => {
      received = request;
      return { result: "fallback" };
    },
    config: { ceiling: "low", baselineEffort: "high" },
  });
  assert.equal(received.effort, "low");
  assert.equal(result.routing.fallbackUsed, true);
  assert.equal(result.routing.classificationStatus, "fallback");
});

test("execution failure is not retried", async () => {
  let calls = 0;
  await assert.rejects(
    launchTask({
      prompt: "private prompt",
      classifier: () => decision("low"),
      runner: async () => {
        calls += 1;
        throw new Error("execution failed");
      },
    }),
    /execution failed/,
  );
  assert.equal(calls, 1);
});
