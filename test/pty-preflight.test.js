import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { ensureSpawnHelperExecutable } from "../src/broker/pty-preflight.js";

// Regression tests for issue #26: pnpm v11 dropped the execute bit on
// node-pty's prebuilt spawn-helper on macOS (-rw-r--r--), so every spawn died
// with posix_spawnp failed while pty.node still loaded fine.

const PKG = path.join("/fake", "node-pty");

function candidate(...segments) {
  return path.resolve(path.join(PKG, "lib"), ...segments);
}

function fakeFs(files, { chmodError } = {}) {
  const chmods = [];
  return {
    chmods,
    statSync(target) {
      if (!(target in files)) throw new Error("ENOENT");
      return { mode: files[target] };
    },
    chmodSync(target, mode) {
      if (chmodError) throw chmodError;
      chmods.push({ target, mode });
      files[target] = mode;
    },
  };
}

test("a helper missing its execute bit is repaired by mirroring the read bits", () => {
  const helper = candidate("..", "prebuilds/darwin-arm64", "spawn-helper");
  const fs = fakeFs({ [helper]: 0o100644 });
  const result = ensureSpawnHelperExecutable({
    platform: "darwin",
    arch: "arm64",
    fsOps: fs,
    packageDir: PKG,
  });
  assert.equal(result.status, "repaired");
  assert.deepEqual([...result.helperPaths], [helper]);
  assert.deepEqual(fs.chmods, [{ target: helper, mode: 0o100755 }]);
});

test("an already-executable helper is left untouched", () => {
  const helper = candidate("..", "prebuilds/darwin-arm64", "spawn-helper");
  const fs = fakeFs({ [helper]: 0o100755 });
  const result = ensureSpawnHelperExecutable({
    platform: "darwin",
    arch: "arm64",
    fsOps: fs,
    packageDir: PKG,
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(fs.chmods, []);
});

test("every present candidate is repaired, matching node-pty's probe order", () => {
  const rootBuild = candidate("..", "build/Release", "spawn-helper");
  const bundledBuild = candidate(".", "build/Release", "spawn-helper");
  const fs = fakeFs({ [rootBuild]: 0o100600, [bundledBuild]: 0o100644 });
  const result = ensureSpawnHelperExecutable({
    platform: "linux",
    arch: "x64",
    fsOps: fs,
    packageDir: PKG,
  });
  assert.equal(result.status, "repaired");
  assert.deepEqual([...result.helperPaths].sort(), [rootBuild, bundledBuild].sort());
  // 0o600 read bits mirror to 0o700 (owner-only), 0o644 to 0o755.
  const modes = Object.fromEntries(fs.chmods.map(({ target, mode }) => [target, mode]));
  assert.equal(modes[rootBuild], 0o100700);
  assert.equal(modes[bundledBuild], 0o100755);
});

test("nothing to repair reports missing without throwing", () => {
  const fs = fakeFs({});
  const result = ensureSpawnHelperExecutable({
    platform: "darwin",
    arch: "arm64",
    fsOps: fs,
    packageDir: PKG,
  });
  assert.equal(result.status, "missing");
  assert.deepEqual([...result.helperPaths], []);
});

test("win32 is not applicable and touches nothing", () => {
  const result = ensureSpawnHelperExecutable({
    platform: "win32",
    fsOps: {
      statSync() {
        throw new Error("must not be called");
      },
      chmodSync() {
        throw new Error("must not be called");
      },
    },
  });
  assert.equal(result.status, "not-applicable");
});

test("a chmod failure reports the path instead of throwing (fail-open stays upstream)", () => {
  const helper = candidate("..", "prebuilds/darwin-arm64", "spawn-helper");
  const fs = fakeFs({ [helper]: 0o100644 }, { chmodError: new Error("EPERM") });
  const result = ensureSpawnHelperExecutable({
    platform: "darwin",
    arch: "arm64",
    fsOps: fs,
    packageDir: PKG,
  });
  assert.equal(result.status, "failed");
  assert.deepEqual([...result.helperPaths], [helper]);
});
