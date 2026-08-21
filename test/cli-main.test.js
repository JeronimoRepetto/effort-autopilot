import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli/main.js";
import { runPilotCli } from "../src/cli/pilot-main.js";

function sink() {
  let value = "";
  return {
    stream: { write: (chunk) => { value += chunk; } },
    value: () => value,
  };
}

const metadataCollector = () => ({ platform: "linux", projectKinds: [] });

test("quiet mode prints only final Claude result", async () => {
  const stdout = sink();
  const stderr = sink();
  let calls = 0;
  const code = await runCli(["--quiet", "Rename foo to bar."], {
    env: {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    runner: async () => {
      calls += 1;
      return {
        result: "done",
        numTurns: 1,
        totalCostUsd: 0,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
    metadataCollector,
  });
  assert.equal(code, 0);
  assert.equal(calls, 1);
  assert.equal(stdout.value(), "done\n");
  assert.equal(stderr.value(), "");
});

test("dry-run shows routing without invoking Claude", async () => {
  const stdout = sink();
  let calls = 0;
  await runCli(["--dry-run", "Rename foo to bar."], {
    env: {},
    stdout: stdout.stream,
    stderr: sink().stream,
    runner: async () => { calls += 1; },
    metadataCollector,
  });
  assert.equal(calls, 0);
  assert.match(stdout.value(), /effort=low/);
  assert.equal(stdout.value().includes("Rename foo"), false);
});

test("pilot standalone --help does not load a manifest or invoke Claude", async () => {
  const stdout = sink();
  let calls = 0;
  const code = await runPilotCli(["--help"], {
    cwd: "Z:\\path-that-does-not-exist",
    stdout: stdout.stream,
    runner: async () => { calls += 1; },
  });
  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.match(stdout.value(), /visible pilot/);
});
