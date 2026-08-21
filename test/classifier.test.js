import assert from "node:assert/strict";
import test from "node:test";

import { classifyPrompt, tierForScore } from "../src/core/classifier.js";

const REPRESENTATIVE_PROMPTS = Object.freeze({
  low: "Rename foo to bar.",
  medium: "Add a unit test for the helper that returns the configured port value.",
  high: "Implement authentication validation and tests for the login handler.",
  xhigh:
    "Investigate a flaky race condition in our cross-platform authentication service, find the root cause, implement the fix, and add tests.",
  max:
    "Perform a comprehensive audit of authentication and payment flows across the entire codebase, investigate the root cause of failures, build a threat model, and add tests.",
  ultracode:
    "Architect and implement an end-to-end migration across the entire monorepo. Investigate the production incident and security risks, coordinate multiple services, add comprehensive tests, benchmark performance, design zero-downtime rollout and rollback paths, verify all edge cases, and document independent workstreams for the client, API, data layer, and operations team.",
});

for (const [expectedTier, prompt] of Object.entries(REPRESENTATIVE_PROMPTS)) {
  test(`representative prompt routes to ${expectedTier}`, () => {
    const result = classifyPrompt(prompt);
    assert.equal(result.preliminaryTier, expectedTier);
    assert.equal(result.tier, expectedTier);
    assert.ok(result.confidence >= 0.55);
    assert.ok(result.reasons.length > 0);
    assert.ok(result.signals.every(({ name, weight }) => name && Number.isFinite(weight)));
  });
}

test("score thresholds are inclusive and cover all six outcomes", () => {
  const cases = [
    [-100, "low"],
    [0, "low"],
    [1, "medium"],
    [3, "medium"],
    [4, "high"],
    [6, "high"],
    [7, "xhigh"],
    [9, "xhigh"],
    [10, "max"],
    [12, "max"],
    [13, "ultracode"],
    [100, "ultracode"],
  ];

  for (const [score, expected] of cases) {
    assert.equal(tierForScore(score), expected, `score ${score}`);
  }
});

test("underspecified prompts escalate conservatively", () => {
  const result = classifyPrompt("Fix it.");
  assert.equal(result.tier, "medium");
  assert.equal(result.conservativeEscalation, true);
  assert.ok(result.confidence < 0.55);
  assert.ok(result.reasons.some((reason) => reason.includes("underspecified")));
  assert.ok(result.reasons.some((reason) => reason.includes("conservative")));
});

test("ultracode score is clamped to max when the orchestration gate is not met", () => {
  const result = classifyPrompt(
    "Perform a comprehensive audit of the architecture, security, and authentication across the entire codebase. Investigate the root cause, implement fixes, and add tests.",
  );
  assert.ok(result.score >= 13);
  assert.equal(result.tier, "max");
  assert.ok(result.signals.some(({ name }) => name === "ultracode-gate-not-met"));
});

test("explicit ultracode intent is represented separately from xhigh effort", () => {
  const result = classifyPrompt("Use ultracode for this task.");
  assert.equal(result.tier, "ultracode");
  assert.deepEqual(result.execution, {
    requestedTier: "ultracode",
    claudeEffort: "xhigh",
    orchestrationMode: "standard",
    fallbackTier: "xhigh",
    clamped: true,
    status: "unapplied",
  });
});

test("ultracode remains an unapplied recommendation when capability is present", () => {
  const result = classifyPrompt("Use ultracode for this task.", {
    modelProfile: {
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      ultracodeAvailable: true,
    },
  });
  assert.equal(result.execution.orchestrationMode, "ultracode");
  assert.equal(result.execution.clamped, false);
  assert.equal(result.execution.status, "unapplied");
});

test("explicit max intent reaches at least max", () => {
  const result = classifyPrompt("Use max effort to answer this.");
  assert.equal(result.tier, "max");
  assert.equal(result.execution.claudeEffort, "max");
});

test("classifier rejects malformed direct input", () => {
  assert.throws(() => classifyPrompt(null), /string/);
  assert.throws(() => classifyPrompt("   "), /empty/);
});

test("Spanish system-wide microphone toggle is conservatively xhigh", () => {
  const prompt =
    "Créame un botón flotante que cuando lo apriete me mutee todos los micrófonos del ordenador y cuando lo vuelva a apretar se desmuteen";
  const result = classifyPrompt(prompt);
  assert.equal(result.tier, "xhigh");
  assert.ok(result.score >= 7);
  const names = new Set(result.signals.map(({ name }) => name));
  assert.ok(names.has("implementation"));
  assert.ok(names.has("os-system-integration"));
  assert.ok(names.has("permissions-device-control"));
  assert.ok(names.has("multi-device-state"));
  assert.ok(names.has("ui-system-combination"));
  assert.ok(names.has("platform-ambiguity"));
});

test("English system-wide microphone toggle exposes the same core signals", () => {
  const result = classifyPrompt(
    "Create a floating button that mutes every microphone on the computer and unmutes them when pressed again.",
  );
  assert.equal(result.tier, "xhigh");
  const names = new Set(result.signals.map(({ name }) => name));
  assert.ok(names.has("os-system-integration"));
  assert.ok(names.has("permissions-device-control"));
  assert.ok(names.has("multi-device-state"));
  assert.ok(names.has("ui-system-combination"));
});

test("active-model profile makes the minimum sufficient effort model-relative", () => {
  const prompt = "Implement authentication validation and tests for the login handler.";
  const higherNeed = classifyPrompt(prompt, {
    modelProfile: { effortOffset: 1 },
  });
  const lowerNeed = classifyPrompt(prompt, {
    modelProfile: { effortOffset: -1 },
  });
  assert.equal(higherNeed.baseTier, "high");
  assert.equal(higherNeed.tier, "xhigh");
  assert.equal(lowerNeed.tier, "medium");
  assert.notEqual(higherNeed.predictedMinimumSufficientEffort, lowerNeed.predictedMinimumSufficientEffort);
});

test("capability profile clamps an unsupported xhigh recommendation", () => {
  const result = classifyPrompt(REPRESENTATIVE_PROMPTS.xhigh, {
    modelProfile: {
      supportedEfforts: ["low", "medium", "high", "max"],
      effortCap: "high",
    },
  });
  assert.equal(result.tier, "xhigh");
  assert.equal(result.execution.claudeEffort, "high");
  assert.equal(result.execution.clamped, true);
  assert.equal(result.execution.status, "unapplied");
});

test("cheap environment metadata contributes transparent local signals", () => {
  const result = classifyPrompt("Update the shared module and verify it.", {
    modelProfile: { effortOffset: 0 },
    environment: {
      platform: "windows",
      repositoryFileCount: 7000,
      multiProject: true,
      projectKinds: ["desktop-app", "service"],
      permissionsSensitive: true,
    },
  });
  assert.deepEqual(result.context.environmentMetadataUsed, [
    "repositoryFileCount",
    "multiProject",
    "projectKinds",
    "permissionsSensitive",
    "platform",
  ]);
  assert.ok(result.signals.some(({ name }) => name === "environment:large-repository"));
  assert.ok(result.signals.some(({ name }) => name === "environment:permissions-sensitive"));
});
