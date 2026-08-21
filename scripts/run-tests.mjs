import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(root, "test");

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(absolute);
    return entry.isFile() && entry.name.endsWith(".test.js") ? [absolute] : [];
  }));
  return nested.flat();
}

const files = (await collectTests(testRoot)).sort();
if (files.length === 0) throw new Error("no test files found");

const child = spawn(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) reject(new Error(`test runner terminated by ${signal}`));
    else resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
