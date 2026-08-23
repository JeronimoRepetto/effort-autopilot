import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runInteractiveBroker } from "../src/broker/interactive.js";

// Running the suite from a session that was itself launched through the
// installed broker shim inherits the recursion-guard variable; this test file
// exercises the broker entry directly, so clear it for this process only.
delete process.env.EFFORT_AUTOPILOT_BROKER_ACTIVE;

// Regression tests for issue #19: a broker setup failure (observed live on
// macOS via the issue-#18 chmod ENOENT) aborted the launch entirely instead
// of degrading to an unchanged Claude session, violating the fail-open
// contract. Setup failure must clean up, report a prompt-free cause, and
// still hand the user their Claude session with the ORIGINAL arguments.

async function scratchDirs(t) {
  const dirs = await Promise.all(
    ["ea-home-", "ea-cwd-", "ea-temp-"].map((prefix) => mkdtemp(path.join(os.tmpdir(), prefix))),
  );
  t.after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));
  return dirs;
}

test("a broker setup failure still launches Claude unchanged with a visible cause", async (t) => {
  const [home, cwd, tempRoot] = await scratchDirs(t);
  const notices = [];
  const relayCalls = [];

  const exitCode = await runInteractiveBroker({
    claudeArgs: ["--verbose"],
    cwd,
    home,
    claudeExecutable: "C:/fake/claude.exe",
    input: { isTTY: true },
    output: { isTTY: true },
    errorOutput: { write: (chunk) => notices.push(chunk) },
    ipcServerStarter: async () => {
      throw new Error("ENOENT: no such file or directory, chmod '/var/folders/x/T/ea.sock'");
    },
    relayPlain: async (options) => {
      relayCalls.push(options);
      return 0;
    },
    tempRoot,
  });

  assert.equal(exitCode, 0);
  assert.equal(relayCalls.length, 1);
  assert.equal(relayCalls[0].claudeExecutable, "C:/fake/claude.exe");
  assert.deepEqual(relayCalls[0].claudeArgs, ["--verbose"]);
  const noticeText = notices.join("");
  assert.match(noticeText, /broker-setup-failed/);
  assert.match(noticeText, /Claude runs unchanged/);
  assert.deepEqual(await readdir(tempRoot), [], "partial temp settings must be cleaned up");
});

test("the fallback forwards the user's own --settings untouched, with no pin injected", async (t) => {
  const [home, cwd, tempRoot] = await scratchDirs(t);
  const userSettings = path.join(cwd, "my-settings.json");
  await writeFile(userSettings, "{}", "utf8");
  const relayCalls = [];

  const exitCode = await runInteractiveBroker({
    claudeArgs: ["--settings", userSettings],
    cwd,
    home,
    claudeExecutable: "C:/fake/claude.exe",
    input: { isTTY: true },
    output: { isTTY: true },
    errorOutput: { write: () => {} },
    ipcServerStarter: async () => {
      throw new Error("ipc-endpoint-too-long: the socket path exceeds the 103-byte sun_path limit");
    },
    relayPlain: async (options) => {
      relayCalls.push(options);
      return 7;
    },
    tempRoot,
  });

  assert.equal(exitCode, 7, "the fallback session's exit code is propagated");
  assert.equal(relayCalls.length, 1);
  // Original arguments byte-for-byte: the user's own settings path (not the
  // temporary merged copy) and no injected --effort baseline pin.
  assert.deepEqual(relayCalls[0].claudeArgs, ["--settings", userSettings]);
  assert.deepEqual(await readdir(tempRoot), []);
});

test("unrecoverable preconditions stay hard errors instead of a doomed fallback", async () => {
  await assert.rejects(
    runInteractiveBroker({
      claudeArgs: [],
      input: { isTTY: false },
      output: { isTTY: true },
      errorOutput: { write: () => {} },
      claudeExecutable: "C:/fake/claude.exe",
      relayPlain: async () => 0,
    }),
    /requires a terminal/,
  );
});
