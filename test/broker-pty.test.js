import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { terminalText } from "../src/broker/pty-session.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "test", "helpers", "run-broker-pty-poc.mjs");

test("terminal acknowledgement normalization removes TUI cursor controls", () => {
  const raw = "Set\u001b[1Ceffort\u001b[1Clevel\u001b[1Cto\u001b[1Cmax\u001b[1C(this\u001b[1Csession\u001b[1Conly):";
  assert.match(terminalText(raw), /Set effort level to max \(this session only\):/);
});

test("multiline and control-bearing prompt uses one bracketed paste then submit", async () => {
  const writes = [];
  const child = {
    onExit: () => ({ dispose() {} }),
    onData: () => ({ dispose() {} }),
    write: (value) => writes.push(value),
    kill() {},
  };
  const session = new (await import("../src/broker/pty-session.js")).PtySession(child, {
    topLevelSubmitSequence: "\u001b[13u",
    promptSettleMs: 1,
  });
  await session.forwardPrompt("línea uno ☕\nlínea dos");
  assert.deepEqual(writes, [
    "\u001b[200~línea uno ☕\nlínea dos\u001b[201~",
    "\u001b[13u",
  ]);
  session.dispose();
});

test("ConPTY mock acknowledges effort before exactly one unchanged prompt", () => {
  const result = spawnSync(process.execPath, [helper], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(summary, {
    acknowledgementBeforeRequest: true,
    requestCount: 1,
    outcome: "applied",
    metadataContainsPrompt: false,
  });
});
