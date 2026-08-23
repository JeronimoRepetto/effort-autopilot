import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

/**
 * Best-effort repair of node-pty's `spawn-helper` execute permission before
 * the first PTY spawn (issue #26). On macOS node-pty executes that prebuilt
 * helper binary, and some package managers (observed: pnpm v11) drop its
 * execute bit during extraction, so every spawn dies with a misleading
 * `posix_spawnp failed` while `pty.node` itself still loads (dlopen only
 * needs read permission).
 *
 * This NEVER throws: the PTY spawn stays the arbiter, and the broker's
 * fail-open layers handle whatever cannot be repaired here. All candidate
 * locations node-pty's own loader probes are checked (existence is not proof
 * of which binary loads, so every present helper is repaired), which is
 * idempotent — in practice at most one exists.
 */

function defaultPackageDir() {
  // node-pty has no `exports` field, so its package.json is resolvable.
  return path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
}

export function ensureSpawnHelperExecutable({
  platform = process.platform,
  arch = process.arch,
  fsOps = fs,
  packageDir,
} = {}) {
  if (platform === "win32") {
    return Object.freeze({ status: "not-applicable", helperPaths: Object.freeze([]) });
  }
  let root;
  try {
    root = packageDir ?? defaultPackageDir();
  } catch {
    return Object.freeze({ status: "missing", helperPaths: Object.freeze([]) });
  }
  // node-pty's loadNativeModule probes each directory relative to lib/.. and
  // lib/. (bundled layouts); unixTerminal resolves spawn-helper next to
  // whichever pty.node loaded, so the same six locations are candidates.
  const libDir = path.join(root, "lib");
  const candidates = new Set();
  for (const dir of ["build/Release", "build/Debug", `prebuilds/${platform}-${arch}`]) {
    for (const base of ["..", "."]) {
      candidates.add(path.resolve(libDir, base, dir, "spawn-helper"));
    }
  }
  const repaired = [];
  const failed = [];
  let executable = false;
  for (const helper of candidates) {
    let stats;
    try {
      stats = fsOps.statSync(helper);
    } catch {
      continue;
    }
    if ((stats.mode & 0o111) !== 0) {
      executable = true;
      continue;
    }
    try {
      // Mirror the read bits into execute bits (0o644 -> 0o755, the mode
      // upstream ships) instead of granting execute where read is absent.
      fsOps.chmodSync(helper, stats.mode | ((stats.mode & 0o444) >> 2));
      repaired.push(helper);
    } catch {
      failed.push(helper);
    }
  }
  if (failed.length > 0) {
    return Object.freeze({ status: "failed", helperPaths: Object.freeze(failed) });
  }
  if (repaired.length > 0) {
    return Object.freeze({ status: "repaired", helperPaths: Object.freeze(repaired) });
  }
  if (executable) return Object.freeze({ status: "ok", helperPaths: Object.freeze([]) });
  return Object.freeze({ status: "missing", helperPaths: Object.freeze([]) });
}
