/**
 * Proportional-odds ordinal head ("the AI that returns the effort").
 *
 * Inference over a feature vector (typically a frozen multilingual embedding)
 * using a tiny, fully inspectable artifact: one weight vector plus K-1
 * strictly increasing cutpoints for the K ordered effort tiers. Pure JS, no
 * dependencies, microsecond inference.
 */

export const ORDINAL_TIERS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
export const ORDINAL_HEAD_SCHEMA_VERSION = 1;

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

export function validateOrdinalHeadArtifact(artifact) {
  if (typeof artifact !== "object" || artifact === null) return "artifact must be an object";
  if (artifact.schemaVersion !== ORDINAL_HEAD_SCHEMA_VERSION) return "unsupported schemaVersion";
  if (artifact.kind !== "ordinal-logistic-head") return "unsupported artifact kind";
  if (!Array.isArray(artifact.weights) || artifact.weights.length === 0) return "missing weights";
  if (!artifact.weights.every(Number.isFinite)) return "non-finite weight";
  if (
    !Array.isArray(artifact.thresholds) ||
    artifact.thresholds.length !== ORDINAL_TIERS.length - 1
  ) {
    return `thresholds must have ${ORDINAL_TIERS.length - 1} cutpoints`;
  }
  if (!artifact.thresholds.every(Number.isFinite)) return "non-finite threshold";
  for (let index = 1; index < artifact.thresholds.length; index += 1) {
    if (artifact.thresholds[index] <= artifact.thresholds[index - 1]) {
      return "thresholds must be strictly increasing";
    }
  }
  return null;
}

export function ordinalScore(features, weights) {
  if (!Array.isArray(features) || features.length !== weights.length) {
    throw new TypeError(`feature vector must have ${weights.length} dimensions`);
  }
  let score = 0;
  for (let index = 0; index < weights.length; index += 1) score += features[index] * weights[index];
  return score;
}

/** Returns tier, per-tier probabilities, and the winning probability as confidence. */
export function predictOrdinal(features, artifact) {
  const invalid = validateOrdinalHeadArtifact(artifact);
  if (invalid) throw new TypeError(`invalid ordinal head artifact: ${invalid}`);
  const score = ordinalScore(features, artifact.weights);
  const cumulative = artifact.thresholds.map((threshold) => sigmoid(threshold - score));
  const probabilities = cumulative.map((value, index) =>
    index === 0 ? value : value - cumulative[index - 1],
  );
  probabilities.push(1 - cumulative[cumulative.length - 1]);
  let tierIndex = 0;
  for (let index = 1; index < probabilities.length; index += 1) {
    if (probabilities[index] > probabilities[tierIndex]) tierIndex = index;
  }
  return Object.freeze({
    tier: ORDINAL_TIERS[tierIndex],
    tierIndex,
    score,
    probabilities: Object.freeze(probabilities),
    confidence: probabilities[tierIndex],
  });
}
