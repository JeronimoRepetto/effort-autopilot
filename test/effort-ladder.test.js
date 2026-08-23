import assert from "node:assert/strict";
import test from "node:test";

import {
  EFFORT_LEVELS,
  ORCHESTRATION_TIERS,
  TIERS,
  formatEffortLevels,
  isEffort,
  isTier,
  lowerOf,
  nextTier,
  shiftEffort,
} from "../src/core/effort-ladder.js";
import {
  DEFAULT_HOST_ID,
  HOST_EFFORT_VOCABULARIES,
  mapTierToNativeEffort,
  resolveHostEffortVocabulary,
} from "../src/core/host-effort-vocabulary.js";

test("canonical ladder orders five effort levels plus the orchestration tier", () => {
  assert.deepEqual([...EFFORT_LEVELS], ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual([...ORCHESTRATION_TIERS], ["ultracode"]);
  assert.deepEqual([...TIERS], [...EFFORT_LEVELS, ...ORCHESTRATION_TIERS]);
  assert.ok(Object.isFrozen(EFFORT_LEVELS));
  assert.ok(Object.isFrozen(TIERS));
});

test("isEffort accepts only native levels while isTier also accepts orchestration", () => {
  for (const level of EFFORT_LEVELS) {
    assert.ok(isEffort(level));
    assert.ok(isTier(level));
  }
  assert.ok(!isEffort("ultracode"));
  assert.ok(isTier("ultracode"));
  for (const value of ["auto", "", null, undefined, "LOW", 3]) {
    assert.ok(!isEffort(value));
    assert.ok(!isTier(value));
  }
});

test("lowerOf returns the weaker level and rejects non-efforts with the documented message", () => {
  assert.equal(lowerOf("high", "medium"), "medium");
  assert.equal(lowerOf("low", "max"), "low");
  assert.equal(lowerOf("xhigh", "xhigh"), "xhigh");
  assert.throws(
    () => lowerOf("auto", "low"),
    new TypeError("effort must be low, medium, high, xhigh, or max"),
  );
  assert.throws(() => lowerOf("medium", "ultracode"), TypeError);
});

test("shiftEffort clamps at both ends and passes non-effort tiers through", () => {
  assert.equal(shiftEffort("medium", 1), "high");
  assert.equal(shiftEffort("medium", -1), "low");
  assert.equal(shiftEffort("low", -2), "low");
  assert.equal(shiftEffort("max", 2), "max");
  assert.equal(shiftEffort("high", 0), "high");
  assert.equal(shiftEffort("ultracode", 1), "ultracode");
});

test("nextTier climbs the full ladder and saturates at ultracode", () => {
  assert.equal(nextTier("low"), "medium");
  assert.equal(nextTier("max"), "ultracode");
  assert.equal(nextTier("ultracode"), "ultracode");
});

test("formatEffortLevels derives the user-facing enumeration from the ladder", () => {
  assert.equal(formatEffortLevels(), "low, medium, high, xhigh, or max");
  assert.equal(formatEffortLevels("and"), "low, medium, high, xhigh, and max");
});

test("claude-code vocabulary maps every tier natively and degrades ultracode to xhigh", () => {
  const vocabulary = resolveHostEffortVocabulary();
  assert.equal(vocabulary, HOST_EFFORT_VOCABULARIES[DEFAULT_HOST_ID]);
  assert.deepEqual([...vocabulary.nativeLevels], [...EFFORT_LEVELS]);
  for (const level of EFFORT_LEVELS) {
    assert.equal(mapTierToNativeEffort(level, vocabulary), level);
  }
  assert.equal(mapTierToNativeEffort("ultracode", vocabulary), "xhigh");
  assert.equal(resolveHostEffortVocabulary("unknown-host"), null);
});

test("mapTierToNativeEffort rejects unknown tiers and unmapped vocabularies", () => {
  assert.throws(() => mapTierToNativeEffort("auto"), TypeError);
  const broken = {
    id: "broken",
    nativeLevels: ["low"],
    tierToNative: { low: "minimal" },
  };
  assert.throws(() => mapTierToNativeEffort("low", broken), TypeError);
});
