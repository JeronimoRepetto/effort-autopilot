import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { classifyPrompt } from "../src/core/classifier.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(fullPath) : [fullPath];
    }),
  );
  return nested.flat().filter((file) => file.endsWith(".js"));
}

test("decision contains signals and reasons but never prompt text", () => {
  const secret = "PRIVATE_CANARY_7f43c908";
  const result = classifyPrompt(`Rename ${secret} to a safer identifier.`);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.ok(result.signals.length > 0);
  assert.ok(result.reasons.length > 0);
});

// The learned-classifier stack (embedding-provider, learned-classifier,
// ordinal-head, ordinal-training) legitimately mentions embeddings and the
// optional local model; it has its own network-free guarantees below.
const DETERMINISTIC_CORE = [
  "classifier.js",
  "policy.js",
  "protocol.js",
  "environment.js",
  "model-profiles.js",
];

test("local classifier source has no network, retrieval, model, or persistence primitives", async () => {
  const files = DETERMINISTIC_CORE.map((name) => path.join(root, "src", "core", name));
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  const forbidden = [
    /node:https?/,
    /node:net/,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /WebSocket/,
    /writeFile/,
    /appendFile/,
    /createWriteStream/,
    /openai/i,
    /anthropic/i,
    /embedding/i,
    /vector(?:store|db)/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern);
  }
});

test("the learned-classifier stack is network-free and isolates the optional dependency", async () => {
  const files = await sourceFiles(path.join(root, "src", "core"));
  const learnedFiles = files.filter((file) => !DETERMINISTIC_CORE.includes(path.basename(file)));
  assert.ok(learnedFiles.length >= 3, "expected the learned-classifier stack under src/core");
  const importers = [];
  for (const file of learnedFiles) {
    const source = await readFile(file, "utf8");
    // No direct network or persistence primitives at classification time.
    for (const pattern of [
      /node:https?/,
      /node:net/,
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /WebSocket/,
      /writeFile/,
      /appendFile/,
      /createWriteStream/,
    ]) {
      assert.doesNotMatch(source, pattern, `${path.basename(file)} matches ${pattern}`);
    }
    if (source.includes("@huggingface/transformers")) importers.push(path.basename(file));
  }
  // Exactly one seam touches the optional model dependency, and the installed
  // loader pins classification to cached local files only.
  assert.deepEqual(importers, ["embedding-provider.js"]);
  const loader = await readFile(path.join(root, "src", "core", "learned-classifier.js"), "utf8");
  assert.match(loader, /localFilesOnly: true/);
});
