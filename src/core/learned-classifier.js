import { readFileSync } from "node:fs";
import path from "node:path";

import { installRoot } from "../broker/install-paths.js";
import { createTransformersEmbedder } from "./embedding-provider.js";
import { ORDINAL_TIERS, predictOrdinal, validateOrdinalHeadArtifact } from "./ordinal-head.js";
import { classifyEnvelope } from "./protocol.js";

/**
 * Learned classifier: frozen multilingual embeddings (AI 1) feeding the
 * trained ordinal head (AI 2), exposed through the exact same envelope
 * contract as the deterministic classifier so the broker never changes.
 *
 * Degradation chain: embedder missing/slow/failing, invalid artifact, or any
 * thrown error → the deterministic classifier → the broker's own fail-open.
 */

function clampToProfile(tier, modelProfile) {
  const order = ORDINAL_TIERS;
  let index = order.indexOf(tier);
  const cap = modelProfile?.effortCap;
  if (typeof cap === "string" && order.includes(cap)) {
    index = Math.min(index, order.indexOf(cap));
  }
  const supported = modelProfile?.supportedEfforts;
  if (Array.isArray(supported) && supported.length > 0) {
    while (index > 0 && !supported.includes(order[index])) index -= 1;
    if (!supported.includes(order[index])) {
      const fallback = order.find((level) => supported.includes(level));
      if (fallback) index = order.indexOf(fallback);
    }
  }
  return order[index];
}

function learnedDecision(prediction, artifact, modelProfile) {
  const tier = clampToProfile(prediction.tier, modelProfile);
  const clamped = tier !== prediction.tier;
  const reasons = [
    `Learned ordinal head selected ${prediction.tier} with probability ${prediction.confidence.toFixed(2)}.`,
  ];
  if (clamped) reasons.push(`The active model profile clamped ${prediction.tier} to ${tier}.`);
  return Object.freeze({
    schemaVersion: 1,
    classifierKind: "learned-ordinal-head",
    baseTier: prediction.tier,
    preliminaryTier: prediction.tier,
    predictedMinimumSufficientEffort: tier,
    tier,
    score: Number(prediction.score.toFixed(4)),
    confidence: Number(prediction.confidence.toFixed(2)),
    conservativeEscalation: false,
    signals: Object.freeze([
      Object.freeze({ name: "learned:ordinal-head", weight: Number(prediction.score.toFixed(4)) }),
    ]),
    reasons: Object.freeze(reasons),
    context: Object.freeze({
      modelProfileApplied: Boolean(modelProfile),
      modelProfileId: modelProfile?.id ?? null,
      modelProfileCatalogVersion: modelProfile?.catalogVersion ?? null,
      modelRelativeOffset: 0,
      environmentMetadataUsed: Object.freeze([]),
      ordinalHeadDataset: artifact.datasetVersion ?? null,
      embeddingModel: artifact.embeddingModel ?? null,
    }),
    execution: Object.freeze({
      requestedTier: prediction.tier,
      claudeEffort: tier,
      orchestrationMode: "standard",
      fallbackTier: tier,
      clamped,
      status: "unapplied",
    }),
  });
}

/**
 * Builds an async classifier with the classifyEnvelope contract.
 * `embedderPromise` may still be warming up; callers rely on the broker's
 * classification timeout, and any failure falls back deterministically.
 */
export function createLearnedClassifier({
  embedderPromise,
  artifact,
  deterministic = classifyEnvelope,
}) {
  const artifactProblem = validateOrdinalHeadArtifact(artifact);
  return async function learnedClassifierEnvelope(input) {
    try {
      if (artifactProblem) throw new Error(artifactProblem);
      const prompt = input?.prompt;
      if (typeof prompt !== "string" || prompt.trim() === "") throw new TypeError("invalid prompt");
      const embedder = await embedderPromise;
      if (!embedder) throw new Error("embedder unavailable");
      const features = await embedder.embed(prompt);
      const prediction = predictOrdinal(features, artifact);
      return Object.freeze({
        status: "ok",
        decision: learnedDecision(prediction, artifact, input?.modelProfile),
      });
    } catch {
      return deterministic(input);
    }
  };
}

export const ORDINAL_HEAD_FILENAME = "ordinal-head.json";
export const ML_CACHE_DIRECTORY = "models";

export function mlPaths(options = {}) {
  const root = installRoot(options);
  return Object.freeze({
    cacheDir: path.join(root, ML_CACHE_DIRECTORY),
    artifactPath: path.join(root, ML_CACHE_DIRECTORY, ORDINAL_HEAD_FILENAME),
  });
}

/**
 * Loads the installed learned classifier when everything is present: the
 * trained artifact on disk, and the optional embedding dependency + cached
 * model (localFilesOnly: classification never touches the network).
 * Returns null when unavailable so callers keep the deterministic path.
 */
export function loadInstalledLearnedClassifier(options = {}) {
  const { artifactPath, cacheDir } = mlPaths(options);
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  if (validateOrdinalHeadArtifact(artifact)) return null;
  const embedderPromise = createTransformersEmbedder({
    modelId: artifact.embeddingModel ?? undefined,
    cacheDir,
    localFilesOnly: true,
  });
  return Object.freeze({
    classifier: createLearnedClassifier({ embedderPromise, artifact }),
    embeddingModel: artifact.embeddingModel ?? null,
    datasetVersion: artifact.datasetVersion ?? null,
  });
}
