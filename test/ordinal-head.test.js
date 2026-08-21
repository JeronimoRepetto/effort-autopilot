import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDINAL_TIERS,
  predictOrdinal,
  validateOrdinalHeadArtifact,
} from "../src/core/ordinal-head.js";
import { evaluateOrdinalAccuracy, trainOrdinalHead } from "../src/core/ordinal-training.js";

const VALID_ARTIFACT = {
  schemaVersion: 1,
  kind: "ordinal-logistic-head",
  weights: [2, 0.5],
  thresholds: [-2, -0.5, 1, 2.5],
};

test("artifact validation rejects every malformed shape", () => {
  assert.equal(validateOrdinalHeadArtifact(VALID_ARTIFACT), null);
  assert.match(validateOrdinalHeadArtifact(null), /object/);
  assert.match(
    validateOrdinalHeadArtifact({ ...VALID_ARTIFACT, schemaVersion: 2 }),
    /schemaVersion/,
  );
  assert.match(validateOrdinalHeadArtifact({ ...VALID_ARTIFACT, kind: "linear" }), /kind/);
  assert.match(validateOrdinalHeadArtifact({ ...VALID_ARTIFACT, weights: [] }), /weights/);
  assert.match(validateOrdinalHeadArtifact({ ...VALID_ARTIFACT, weights: [1, NaN] }), /non-finite/);
  assert.match(
    validateOrdinalHeadArtifact({ ...VALID_ARTIFACT, thresholds: [1, 2, 3] }),
    /cutpoints/,
  );
  assert.match(
    validateOrdinalHeadArtifact({ ...VALID_ARTIFACT, thresholds: [1, 1, 2, 3] }),
    /strictly increasing/,
  );
});

test("higher scores predict monotonically higher tiers with valid probabilities", () => {
  let previousIndex = -1;
  for (const scale of [-3, -1, 0.2, 1.2, 3]) {
    const result = predictOrdinal([scale, scale], VALID_ARTIFACT);
    assert.ok(result.tierIndex >= previousIndex, "tier must not decrease as score grows");
    previousIndex = result.tierIndex;
    const total = result.probabilities.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    assert.ok(result.probabilities.every((value) => value >= 0));
    assert.equal(result.confidence, result.probabilities[result.tierIndex]);
  }
  assert.equal(predictOrdinal([-3, -3], VALID_ARTIFACT).tier, "low");
  assert.equal(predictOrdinal([3, 3], VALID_ARTIFACT).tier, "max");
});

test("the trainer learns a separable synthetic ordinal problem", () => {
  // One informative dimension: tier grows with the feature value.
  const dataset = [];
  for (let index = 0; index < ORDINAL_TIERS.length; index += 1) {
    for (const jitter of [-0.15, 0, 0.15]) {
      dataset.push({ features: [index + jitter, 1], label: ORDINAL_TIERS[index] });
    }
  }
  const artifact = trainOrdinalHead(dataset, { epochs: 5000, learningRate: 0.5, l2: 1e-5 });
  assert.equal(validateOrdinalHeadArtifact(artifact), null);
  const accuracy = evaluateOrdinalAccuracy(dataset, artifact, predictOrdinal);
  assert.ok(accuracy >= 0.85, `training accuracy ${accuracy} below threshold`);
  // Determinism: same inputs, same artifact.
  const again = trainOrdinalHead(dataset, { epochs: 5000, learningRate: 0.5, l2: 1e-5 });
  assert.deepEqual(again.weights, artifact.weights);
  assert.deepEqual(again.thresholds, artifact.thresholds);
});
