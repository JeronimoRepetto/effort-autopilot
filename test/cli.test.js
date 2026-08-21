import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "effort-autopilot.js");

function run(mode, input) {
  return spawnSync(process.execPath, [cli, mode], {
    cwd: root,
    input,
    encoding: "utf8",
    timeout: 2_000,
  });
}

test("classify-json accepts a host-neutral prompt envelope", () => {
  const child = run("classify-json", JSON.stringify({ prompt: "Rename foo to bar." }));
  assert.equal(child.status, 0);
  const output = JSON.parse(child.stdout);
  assert.equal(output.status, "ok");
  assert.equal(output.decision.tier, "low");
  assert.equal(child.stderr, "");
});

test("classify-json fails open for malformed JSON", () => {
  const child = run("classify-json", "private malformed input");
  assert.equal(child.status, 0);
  assert.deepEqual(JSON.parse(child.stdout), {
    status: "fallback",
    fallback: "auto",
    errorCode: "classification-failed",
  });
  assert.equal(child.stderr, "");
});

test("oversized input fails open without echoing input", () => {
  const secret = "DO_NOT_ECHO_" + "x".repeat(1024 * 1024);
  const child = run("classify-json", secret);
  assert.equal(child.status, 0);
  assert.equal(child.stdout.includes("DO_NOT_ECHO"), false);
  assert.equal(JSON.parse(child.stdout).fallback, "auto");
});

test("unknown option fails closed as a developer error without input echo", () => {
  const child = run("--unknown", "DO_NOT_ECHO");
  assert.notEqual(child.status, 0);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr.includes("DO_NOT_ECHO"), false);
});
