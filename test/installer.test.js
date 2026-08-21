import assert from "node:assert/strict";
import test from "node:test";

import { selectRealClaudeExecutable } from "../src/broker/claude-locator.js";
import {
  globalConfigPath,
  installRoot,
  shimDirectory,
  shimExecutablePath,
} from "../src/broker/install-paths.js";
import {
  readGlobalConfig,
  readProjectConfig,
  resolveAutopilotPolicy,
} from "../src/broker/project-config.js";
import {
  containsPathEntry,
  hasProfileBlock,
  prependPathEntry,
  removePathEntry,
  removeProfileBlock,
  upsertProfileBlock,
} from "../src/installer/path-edit.js";
import { unixShimContent, windowsShimContent } from "../src/installer/shim.js";

test("install paths are platform-correct and derived from one root", () => {
  const win = {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
    home: "C:\\Users\\u",
  };
  assert.equal(installRoot(win), "C:\\Users\\u\\AppData\\Local\\effort-autopilot");
  assert.match(shimExecutablePath(win), /shim\\claude\.cmd$/);
  assert.match(globalConfigPath(win), /effort-autopilot\\config\.json$/);

  const nix = { platform: "linux", env: {}, home: "/home/u" };
  assert.match(installRoot(nix).replaceAll("\\", "/"), /\/home\/u\/.effort-autopilot$/);
  assert.match(shimExecutablePath(nix).replaceAll("\\", "/"), /shim\/claude$/);
});

test("PATH entry editing is idempotent, surgical, and case-insensitive on Windows", () => {
  const shim = "C:\\Users\\u\\AppData\\Local\\effort-autopilot\\shim";
  const original = "C:\\nodejs;%USERPROFILE%\\bin;C:\\tools";
  const installed = prependPathEntry(original, shim);
  assert.equal(installed, `${shim};${original}`);
  // Re-prepending does not stack duplicates.
  assert.equal(prependPathEntry(installed, shim.toUpperCase()).split(";").length, 4);
  // Removal restores the original exactly, preserving %VAR% segments verbatim.
  assert.equal(removePathEntry(installed, shim.toUpperCase()), original);
  assert.equal(containsPathEntry(installed, `${shim}\\`), true);
  assert.equal(containsPathEntry(original, shim), false);
  // Unix separator variant.
  assert.equal(
    prependPathEntry("/usr/bin:/bin", "/home/u/.effort-autopilot/shim", {
      separator: ":",
      caseInsensitive: false,
    }),
    "/home/u/.effort-autopilot/shim:/usr/bin:/bin",
  );
});

test("shell profile block is marked, idempotent, and surgically removable", () => {
  const profile = "# my profile\nexport EDITOR=vim\n";
  const withBlock = upsertProfileBlock(profile, "/home/u/.effort-autopilot/shim");
  assert.equal(hasProfileBlock(withBlock), true);
  assert.match(
    withBlock,
    /# effort-autopilot begin\nexport PATH="\/home\/u\/\.effort-autopilot\/shim:\$PATH"\n# effort-autopilot end/,
  );
  // Upserting again replaces rather than stacking.
  const twice = upsertProfileBlock(withBlock, "/home/u/.effort-autopilot/shim");
  assert.equal((twice.match(/# effort-autopilot begin/g) ?? []).length, 1);
  const removed = removeProfileBlock(twice);
  assert.equal(hasProfileBlock(removed), false);
  assert.match(removed, /export EDITOR=vim/);
});

test("shim contents invoke the broker and forward all arguments", () => {
  const win = windowsShimContent(
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\pkg\\bin\\internal-interactive-broker.js",
  );
  assert.match(win, /^@echo off\r\n"C:\\Program Files\\nodejs\\node\.exe" ".*broker\.js" %\*\r\n$/);
  const nix = unixShimContent("/usr/bin/node", "/pkg/bin/internal-interactive-broker.js");
  assert.match(nix, /^#!\/bin\/sh\nexec "\/usr\/bin\/node" ".*broker\.js" "\$@"\n$/);
});

test("real Claude selection skips the shim directory across platforms", () => {
  const winPick = selectRealClaudeExecutable(
    [
      "C:\\Users\\u\\AppData\\Local\\EFFORT-AUTOPILOT\\shim\\claude.cmd",
      "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd",
    ],
    ["C:\\Users\\u\\AppData\\Local\\effort-autopilot\\shim"],
    "win32",
  );
  assert.equal(winPick, "C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd");
  const onlyShim = selectRealClaudeExecutable(
    ["C:\\Users\\u\\AppData\\Local\\effort-autopilot\\shim\\claude.cmd"],
    ["C:\\Users\\u\\AppData\\Local\\effort-autopilot\\shim"],
    "win32",
  );
  assert.equal(onlyShim, null);
  const nixPick = selectRealClaudeExecutable(
    ["/home/u/.effort-autopilot/shim/claude", "/usr/local/bin/claude"],
    ["/home/u/.effort-autopilot/shim"],
    "linux",
  );
  assert.equal(nixPick, "/usr/local/bin/claude");
});

test("project config reads enabled/policy tolerantly and flags invalid documents", () => {
  const read = (content) => readProjectConfig({ cwd: "C:\\proj", readFile: () => content });
  assert.deepEqual(read(JSON.stringify({ enabled: false })), {
    enabled: false,
    policy: undefined,
    invalid: false,
  });
  assert.deepEqual(read(`\uFEFF${JSON.stringify({ policy: "autopilot-wins" })}`), {
    enabled: undefined,
    policy: "autopilot-wins",
    invalid: false,
  });
  assert.equal(read('{"policy": "turbo"}').policy, undefined);
  assert.equal(read("{ not json").invalid, true);
  const missing = readProjectConfig({
    cwd: "C:\\proj",
    readFile: () => {
      throw new Error("ENOENT");
    },
  });
  assert.deepEqual(missing, { enabled: undefined, policy: undefined, invalid: false });
});

test("policy resolution honors launch > project > global > default", () => {
  assert.deepEqual(
    resolveAutopilotPolicy({
      launchPolicy: "manual-wins",
      projectPolicy: "autopilot-wins",
      globalPolicy: "autopilot-wins",
    }),
    { policy: "manual-wins", source: "launch flag" },
  );
  assert.deepEqual(
    resolveAutopilotPolicy({
      launchPolicy: null,
      projectPolicy: "autopilot-wins",
      globalPolicy: "manual-wins",
    }),
    { policy: "autopilot-wins", source: "project config" },
  );
  assert.deepEqual(
    resolveAutopilotPolicy({
      launchPolicy: null,
      projectPolicy: undefined,
      globalPolicy: "autopilot-wins",
    }),
    { policy: "autopilot-wins", source: "global config" },
  );
  assert.deepEqual(resolveAutopilotPolicy({}), { policy: "manual-wins", source: "default" });
});

test("global config read degrades to no-opinion when missing", () => {
  const missing = readGlobalConfig({
    readFile: () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(missing.policy, undefined);
  const present = readGlobalConfig({
    readFile: () => JSON.stringify({ policy: "autopilot-wins" }),
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\x" },
    home: "C:\\u",
  });
  assert.equal(present.policy, "autopilot-wins");
});

test("shim directory matches what the locator excludes", () => {
  const options = { platform: "win32", env: { LOCALAPPDATA: "C:\\x" }, home: "C:\\u" };
  assert.equal(shimDirectory(options), "C:\\x\\effort-autopilot\\shim");
});
