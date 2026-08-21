import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_PROFILE_CATALOG_VERSION,
  resolveBundledModelProfile,
  resolveModelProfile,
} from "../src/core/model-profiles.js";

test("exact pinned models resolve to versioned capability profiles", () => {
  const fast = resolveBundledModelProfile("claude-haiku-4-5-20251001");
  const balanced = resolveBundledModelProfile("claude-sonnet-5");
  const strongest = resolveBundledModelProfile("claude-fable-5");
  assert.equal(fast.capabilityTier, "fast");
  assert.equal(fast.effortCap, "high");
  assert.equal(balanced.capabilityTier, "balanced");
  assert.equal(strongest.capabilityTier, "strongest");
  assert.equal(strongest.effortOffset, -1);
  assert.equal(balanced.catalogVersion, MODEL_PROFILE_CATALOG_VERSION);
});

test("mutable aliases and unsupported models safely decline calibration", () => {
  assert.equal(resolveBundledModelProfile("haiku"), null);
  assert.equal(resolveBundledModelProfile("sonnet"), null);
  assert.equal(resolveBundledModelProfile("fable"), null);
  assert.equal(resolveBundledModelProfile("custom-provider-model"), null);
});

test("Opus 5 and its 1M-context variant resolve to one pinned profile", () => {
  const strong = resolveBundledModelProfile("claude-opus-5");
  assert.equal(strong.capabilityTier, "strong");
  assert.equal(strong.effortCap, "max");
  // Observed live on 2.1.238: SessionStart reports "claude-opus-5[1m]".
  assert.equal(resolveBundledModelProfile("claude-opus-5[1m]").id, "claude-opus-5");
  assert.equal(resolveBundledModelProfile("opus"), null);
});

test("a dated immutable Haiku API alias resolves to its pinned snapshot", () => {
  assert.equal(
    resolveBundledModelProfile("claude-haiku-4-5").id,
    "claude-haiku-4-5-20251001",
  );
});

test("profile overrides must match the explicitly requested model", () => {
  assert.throws(
    () => resolveModelProfile({
      modelId: "claude-sonnet-5",
      override: { id: "claude-fable-5", supportedEfforts: ["low"] },
    }),
    /does not match/,
  );
  assert.deepEqual(
    resolveModelProfile({ modelId: "claude-sonnet-5", override: { effortOffset: 0 } }),
    { effortOffset: 0 },
  );
});
