import { ORDINAL_HEAD_SCHEMA_VERSION, ORDINAL_TIERS, ordinalScore } from "./ordinal-head.js";

/**
 * Dependency-free trainer for the proportional-odds ordinal head.
 *
 * Full-batch gradient descent on the negative log-likelihood with L2 on the
 * weights. Cutpoints are parameterized as base + cumulative exp(deltas) so
 * they stay strictly increasing by construction. Deterministic given the
 * dataset and hyperparameters (weights start at zero, cutpoints at a spread).
 */

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function thresholdsFromRaw(base, deltas) {
  const thresholds = [base];
  for (const delta of deltas) thresholds.push(thresholds[thresholds.length - 1] + Math.exp(delta));
  return thresholds;
}

export function trainOrdinalHead(
  dataset,
  { epochs = 2000, learningRate = 0.3, l2 = 1e-4, metadata = {} } = {},
) {
  if (!Array.isArray(dataset) || dataset.length === 0) throw new TypeError("dataset required");
  const dimensions = dataset[0].features.length;
  const cutpointCount = ORDINAL_TIERS.length - 1;
  const examples = dataset.map(({ features, label }) => {
    const labelIndex = ORDINAL_TIERS.indexOf(label);
    if (labelIndex < 0) throw new TypeError(`unknown label ${label}`);
    if (!Array.isArray(features) || features.length !== dimensions) {
      throw new TypeError("inconsistent feature dimensions");
    }
    return { features, labelIndex };
  });

  const weights = new Array(dimensions).fill(0);
  let base = -1.5;
  const deltas = new Array(cutpointCount - 1).fill(0);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradient = new Array(dimensions).fill(0);
    let baseGradient = 0;
    const deltaGradient = new Array(deltas.length).fill(0);
    const thresholds = thresholdsFromRaw(base, deltas);

    for (const { features, labelIndex } of examples) {
      const score = ordinalScore(features, weights);
      const cumulative = thresholds.map((threshold) => sigmoid(threshold - score));
      const lower = labelIndex === 0 ? 0 : cumulative[labelIndex - 1];
      const upper = labelIndex === cutpointCount ? 1 : cumulative[labelIndex];
      const probability = Math.max(upper - lower, 1e-12);

      // d(sigmoid(c - s)) = sig*(1-sig) * (dc - ds)
      const upperSlope =
        labelIndex === cutpointCount ? 0 : cumulative[labelIndex] * (1 - cumulative[labelIndex]);
      const lowerSlope =
        labelIndex === 0 ? 0 : cumulative[labelIndex - 1] * (1 - cumulative[labelIndex - 1]);
      const dLdUpper = -1 / probability;
      const dLdLower = 1 / probability;

      // Score gradient: dq/ds = -slope for each cutpoint.
      const scoreGradient = dLdUpper * -upperSlope + dLdLower * -lowerSlope;
      for (let index = 0; index < dimensions; index += 1) {
        weightGradient[index] += scoreGradient * features[index];
      }

      // Cutpoint gradients: c_j = base + sum(exp(delta_m), m <= j, m >= 1).
      const addCutpointGradient = (cutIndex, amount) => {
        baseGradient += amount;
        for (let m = 0; m < cutIndex; m += 1) deltaGradient[m] += amount * Math.exp(deltas[m]);
      };
      if (labelIndex !== cutpointCount) addCutpointGradient(labelIndex, dLdUpper * upperSlope);
      if (labelIndex !== 0) addCutpointGradient(labelIndex - 1, dLdLower * lowerSlope);
    }

    const scale = learningRate / examples.length;
    for (let index = 0; index < dimensions; index += 1) {
      weights[index] -= scale * (weightGradient[index] + l2 * examples.length * weights[index]);
    }
    base -= scale * baseGradient;
    for (let index = 0; index < deltas.length; index += 1)
      deltas[index] -= scale * deltaGradient[index];
  }

  return Object.freeze({
    schemaVersion: ORDINAL_HEAD_SCHEMA_VERSION,
    kind: "ordinal-logistic-head",
    tiers: ORDINAL_TIERS,
    dimensions,
    weights: weights.map((value) => Number(value.toFixed(6))),
    thresholds: thresholdsFromRaw(base, deltas).map((value) => Number(value.toFixed(6))),
    trainingExamples: examples.length,
    ...metadata,
  });
}

export function evaluateOrdinalAccuracy(dataset, artifact, predict) {
  let correct = 0;
  for (const { features, label } of dataset) {
    if (predict(features, artifact).tier === label) correct += 1;
  }
  return correct / dataset.length;
}
