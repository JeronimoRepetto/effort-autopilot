#!/usr/bin/env node
// Trains the ordinal head from a JSONL dataset of {features|prompt, label}
// rows. With `prompt` rows, embeddings are computed locally through the
// optional @huggingface/transformers dependency (no network with a warmed
// cache). Writes a versioned artifact JSON. Local-only; never calls Claude.
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { createTransformersEmbedder } from "../src/core/embedding-provider.js";
import { predictOrdinal } from "../src/core/ordinal-head.js";
import { evaluateOrdinalAccuracy, trainOrdinalHead } from "../src/core/ordinal-training.js";
import { mlPaths } from "../src/core/learned-classifier.js";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const dataPath = argValue("--data");
const outPath = argValue("--out", mlPaths().artifactPath);
const datasetVersion = argValue("--dataset-version", "unversioned");
const epochs = Number(argValue("--epochs", "300"));
const learningRate = Number(argValue("--learning-rate", "0.5"));
const l2 = Number(argValue("--l2", "0.001"));
if (!dataPath) {
  process.stderr.write(
    "Usage: node scripts/train-ordinal-head.mjs --data <dataset.jsonl> [--out <artifact.json>]\n" +
      "       [--dataset-version <id>] [--epochs N] [--learning-rate X] [--l2 X]\n",
  );
  process.exit(1);
}

const rows = (await readFile(dataPath, "utf8"))
  .split(/\r?\n/u)
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line));

let embeddingModel = null;
let dataset;
if (rows.every((row) => Array.isArray(row.features))) {
  dataset = rows;
} else {
  const { cacheDir } = mlPaths();
  const embedder = await createTransformersEmbedder({ cacheDir });
  if (!embedder) {
    process.stderr.write(
      "Rows carry prompts but @huggingface/transformers is not installed.\n" +
        "Install it (npm install @huggingface/transformers) or provide precomputed features.\n",
    );
    process.exit(1);
  }
  embeddingModel = embedder.modelId;
  dataset = [];
  for (const row of rows) {
    dataset.push({ features: await embedder.embed(row.prompt), label: row.label });
  }
}

const artifact = trainOrdinalHead(dataset, {
  epochs,
  learningRate,
  l2,
  metadata: {
    datasetVersion,
    embeddingModel,
    trainedAt: new Date().toISOString(),
  },
});
const accuracy = evaluateOrdinalAccuracy(dataset, artifact, predictOrdinal);
await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify({ out: outPath, examples: dataset.length, trainingAccuracy: Number(accuracy.toFixed(4)), datasetVersion })}\n`,
);
