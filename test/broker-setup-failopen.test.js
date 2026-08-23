import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { relayPlainSession, runInteractiveBroker } from "../src/broker/interactive.js";

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

// Regression tests for issue #25: a PtySession.spawn failure (observed live
// on macOS as "posix_spawnp failed") escaped the fail-open guard and aborted
// the launch. A PTY transport failure must degrade, never abort.

test("a PTY spawn failure after successful setup still launches Claude unchanged", async (t) => {
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
    ipcServerStarter: async () => ({ close: async () => {} }),
    ptySessionFactory: () => {
      throw new Error("posix_spawnp failed.");
    },
    relayPlain: async (options) => {
      relayCalls.push(options);
      return 0;
    },
    tempRoot,
  });

  assert.equal(exitCode, 0);
  assert.equal(relayCalls.length, 1);
  // ORIGINAL arguments: never the spawnArgs whose temporary --settings the
  // finally block deletes, and no injected --effort pin.
  assert.deepEqual(relayCalls[0].claudeArgs, ["--verbose"]);
  const noticeText = notices.join("");
  assert.match(noticeText, /pty-spawn-failed/);
  assert.match(noticeText, /Claude runs unchanged/);
  assert.deepEqual(await readdir(tempRoot), [], "temporary settings must be cleaned up");
});

function fakeChild() {
  const child = new EventEmitter();
  return child;
}

test("relayPlainSession degrades to a directly attached child when the PTY cannot spawn", async () => {
  const notices = [];
  const spawns = [];
  const child = fakeChild();
  const resultPromise = relayPlainSession({
    claudeExecutable: "/usr/local/bin/claude",
    claudeArgs: ["--verbose"],
    cwd: "/work",
    input: { isTTY: true },
    output: { isTTY: true },
    errorOutput: { write: (chunk) => notices.push(chunk) },
    ptySpawner: () => {
      throw new Error("posix_spawnp failed.");
    },
    plainSpawner: (command, args, options) => {
      spawns.push({ command, args, options });
      return child;
    },
    platform: "linux",
    env: { PATH: "/usr/bin" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", 3, null);
  assert.equal(await resultPromise, 3);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, "/usr/local/bin/claude");
  assert.deepEqual(spawns[0].args, ["--verbose"]);
  assert.equal(spawns[0].options.stdio, "inherit");
  assert.equal(spawns[0].options.env.EFFORT_AUTOPILOT_BROKER_ACTIVE, "1");
  assert.match(notices.join(""), /pty-spawn-failed/);
});

test("a signal death in the attached child reports 128+n, never success", async () => {
  const child = fakeChild();
  const resultPromise = relayPlainSession({
    claudeExecutable: "/usr/local/bin/claude",
    claudeArgs: [],
    cwd: "/work",
    input: { isTTY: true },
    output: { isTTY: true },
    errorOutput: { write: () => {} },
    ptySpawner: () => {
      throw new Error("broken");
    },
    plainSpawner: () => child,
    platform: "linux",
    env: {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", null, "SIGTERM");
  assert.equal(await resultPromise, 128 + os.constants.signals.SIGTERM);
});

test("an async spawn error of the attached child is reported and exits 1", async () => {
  const notices = [];
  const child = fakeChild();
  const resultPromise = relayPlainSession({
    claudeExecutable: "claude",
    claudeArgs: [],
    cwd: "/work",
    input: { isTTY: true },
    output: { isTTY: true },
    errorOutput: { write: (chunk) => notices.push(chunk) },
    ptySpawner: () => {
      throw new Error("broken");
    },
    plainSpawner: () => child,
    platform: "linux",
    env: {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("error", new Error("spawn claude ENOENT"));
  assert.equal(await resultPromise, 1);
  assert.match(notices.join(""), /could not start Claude/);
  assert.match(notices.join(""), /ENOENT/);
});

test("a Windows .cmd executable is launched through ComSpec with verbatim quoting", async () => {
  const child = fakeChild();
  const spawns = [];
  const resultPromise = relayPlainSession({
    claudeExecutable: "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd",
    claudeArgs: ["--settings", "C:\\a b\\s.json"],
    cwd: "C:\\work",
    input: { isTTY: true },
    output: { isTTY: true },
    errorOutput: { write: () => {} },
    ptySpawner: () => {
      throw new Error("broken");
    },
    plainSpawner: (command, args, options) => {
      spawns.push({ command, args, options });
      return child;
    },
    platform: "win32",
    env: { ComSpec: "C:\\WINDOWS\\system32\\cmd.exe" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit", 0, null);
  assert.equal(await resultPromise, 0);
  const { command, args, options } = spawns[0];
  assert.equal(command, "C:\\WINDOWS\\system32\\cmd.exe");
  assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(
    args[3],
    '""C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd" "--settings" "C:\\a b\\s.json""',
  );
  assert.equal(options.windowsVerbatimArguments, true);
  assert.equal(options.stdio, "inherit");
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
