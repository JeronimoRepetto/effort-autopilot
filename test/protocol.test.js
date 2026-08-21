import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FALLBACK,
  classifyEnvelope,
  parseAndClassifyEnvelope,
} from "../src/core/protocol.js";

test("valid envelope returns an explainable decision", () => {
  const result = classifyEnvelope({
    prompt: "Rename foo to bar.",
    modelProfile: { effortOffset: 0, supportedEfforts: ["low", "medium", "high"] },
    environment: { platform: "linux" },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.decision.tier, "low");
  assert.ok(result.decision.reasons.length > 0);
  assert.equal(result.decision.context.modelProfileApplied, true);
  assert.deepEqual(result.decision.context.environmentMetadataUsed, ["platform"]);
});

test("malformed envelopes fail open to auto/default behavior", () => {
  const invalid = [null, undefined, {}, { prompt: null }, { prompt: "" }, []];
  for (const input of invalid) {
    assert.deepEqual(classifyEnvelope(input), DEFAULT_FALLBACK);
  }
});

test("malformed JSON fails open without error details", () => {
  assert.deepEqual(parseAndClassifyEnvelope("not json"), DEFAULT_FALLBACK);
  assert.deepEqual(parseAndClassifyEnvelope("{\"prompt\":"), DEFAULT_FALLBACK);
  assert.equal("error" in DEFAULT_FALLBACK, false);
});
