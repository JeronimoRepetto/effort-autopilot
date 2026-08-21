import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { shimDirectory } from "./install-paths.js";

/**
 * Resolves the REAL Claude executable while a persistent shim may be first on
 * PATH. The shim never freezes a path; resolution happens at every launch and
 * simply skips candidates living in the shim directory, so Claude updates and
 * relocations keep working. `EFFORT_AUTOPILOT_REAL_CLAUDE` (set by the
 * isolated test window) always wins.
 */

function normalizeDirectory(directory, caseInsensitive) {
  const trimmed = directory.trim().replace(/[\\/]+$/, "");
  return caseInsensitive ? trimmed.toLowerCase() : trimmed;
}

export function selectRealClaudeExecutable(candidates, excludedDirectories, platform = process.platform) {
  const caseInsensitive = platform === "win32";
  const excluded = new Set(
    excludedDirectories.map((directory) => normalizeDirectory(directory, caseInsensitive)),
  );
  return candidates.find(
    (candidate) => !excluded.has(normalizeDirectory(path.dirname(candidate), caseInsensitive)),
  ) ?? null;
}

export function listClaudeCandidates({ platform = process.platform } = {}) {
  try {
    const output = platform === "win32"
      ? execFileSync("where.exe", ["claude"], { encoding: "utf8" })
      : execFileSync("which", ["-a", "claude"], { encoding: "utf8" });
    return output.trim().split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function findRealClaudeExecutable({
  platform = process.platform,
  env = process.env,
} = {}) {
  if (env.EFFORT_AUTOPILOT_REAL_CLAUDE) return env.EFFORT_AUTOPILOT_REAL_CLAUDE;
  const candidates = listClaudeCandidates({ platform });
  if (candidates.length === 0) {
    // No resolver available (or claude is a shell alias). PATH resolution at
    // spawn still works; the broker's recursion guard catches a shim loop.
    if (platform !== "win32") return "claude";
    throw new Error("Claude Code CLI was not found");
  }
  const selected = selectRealClaudeExecutable(candidates, [shimDirectory({ platform, env })], platform);
  if (!selected) {
    throw new Error(
      "Claude Code CLI was not found (only the Effort Autopilot shim is on PATH)",
    );
  }
  return selected;
}
