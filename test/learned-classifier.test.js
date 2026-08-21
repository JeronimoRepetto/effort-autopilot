import assert from "node:assert/strict";
import test from "node:test";

import { createLearnedClassifier } from "../src/core/learned-classifier.js";
import { ORDINAL_TIERS } from "../src/core/ordinal-head.js";

// Deterministic fake embedder: maps prompt length to the informative
// dimension, so short prompts land low and long prompts land max.
const fakeEmbedder = {
  modelId: "fake-multilingual-embedder",
  async embed(text) {
    return [Math.min(text.length / 40, 4.5), 1];
  },
};

const ARTIFACT = {
  schemaVersion: 1,
  kind: "ordinal-logistic-head",
  weights: [2, 0],
  thresholds: [1, 3, 5, 7],
  embeddingModel: "fake-multilingual-embedder",
  datasetVersion: "synthetic-test-1",
};

function deterministicFallback() {
  return { status: "ok", decision: { tier: "medium", confidence: 0.6, fallbackMarker: true } };
}

test("learned decision satisfies the classifyEnvelope/decision contract", async () => {
  const classifier = createLearnedClassifier({
    embedderPromise: Promise.resolve(fakeEmbedder),
    artifact: ARTIFACT,
    deterministic: deterministicFallback,
  });
  const result = await classifier({
    prompt:
      "Investiga la arquitectura completa, busca condiciones de carrera y refactoriza con tests de regresión exhaustivos.",
  });
  assert.equal(result.status, "ok");
  const { decision } = result;
  assert.ok(ORDINAL_TIERS.includes(decision.tier));
  assert.equal(typeof decision.confidence, "number");
  assert.equal(decision.execution.claudeEffort, decision.tier);
  assert.equal(decision.execution.status, "unapplied");
  assert.equal(decision.classifierKind, "learned-ordinal-head");
  assert.equal(decision.context.embeddingModel, "fake-multilingual-embedder");
  assert.equal(decision.context.ordinalHeadDataset, "synthetic-test-1");
  assert.ok(Array.isArray(decision.reasons) && decision.reasons.length > 0);
  // No prompt content leaks into the decision.
  assert.doesNotMatch(JSON.stringify(decision), /arquitectura/);
});

test("longer/heavier prompts predict higher tiers than trivial ones", async () => {
  const classifier = createLearnedClassifier({
    embedderPromise: Promise.resolve(fakeEmbedder),
    artifact: ARTIFACT,
    deterministic: deterministicFallback,
  });
  const short = await classifier({ prompt: "hola" });
  const long = await classifier({ prompt: "x".repeat(200) });
  assert.equal(short.decision.tier, "low");
  assert.equal(long.decision.tier, "max");
});

test("the model profile clamps unsupported learned tiers", async () => {
  const classifier = createLearnedClassifier({
    embedderPromise: Promise.resolve(fakeEmbedder),
    artifact: ARTIFACT,
    deterministic: deterministicFallback,
  });
  const result = await classifier({
    prompt: "y".repeat(200),
    modelProfile: {
      id: "claude-haiku-4-5-20251001",
      catalogVersion: "test",
      supportedEfforts: ["low", "medium", "high"],
      effortCap: "high",
    },
  });
  assert.equal(result.decision.baseTier, "max");
  assert.equal(result.decision.tier, "high");
  assert.equal(result.decision.execution.clamped, true);
});

test("every failure mode falls back to the deterministic classifier", async () => {
  const cases = [
    // Embedder never became available.
    createLearnedClassifier({
      embedderPromise: Promise.resolve(null),
      artifact: ARTIFACT,
      deterministic: deterministicFallback,
    }),
    // Embedder rejects at warmup.
    createLearnedClassifier({
      embedderPromise: Promise.reject(new Error("download failed")),
      artifact: ARTIFACT,
      deterministic: deterministicFallback,
    }),
    // Embedding call throws.
    createLearnedClassifier({
      embedderPromise: Promise.resolve({
        async embed() {
          throw new Error("onnx crashed");
        },
      }),
      artifact: ARTIFACT,
      deterministic: deterministicFallback,
    }),
    // Invalid artifact.
    createLearnedClassifier({
      embedderPromise: Promise.resolve(fakeEmbedder),
      artifact: { ...ARTIFACT, thresholds: [3, 2, 1, 0] },
      deterministic: deterministicFallback,
    }),
  ];
  for (const classifier of cases) {
    const result = await classifier({ prompt: "any prompt" });
    assert.equal(result.decision.fallbackMarker, true);
  }
  // Invalid prompt also falls back (and the real deterministic fallback
  // would then fail open at the envelope layer).
  const classifier = createLearnedClassifier({
    embedderPromise: Promise.resolve(fakeEmbedder),
    artifact: ARTIFACT,
    deterministic: deterministicFallback,
  });
  assert.equal((await classifier({ prompt: "" })).decision.fallbackMarker, true);
});
