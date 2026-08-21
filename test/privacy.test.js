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

test("local classifier source has no network, retrieval, model, or persistence primitives", async () => {
  const files = await sourceFiles(path.join(root, "src", "core"));
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
