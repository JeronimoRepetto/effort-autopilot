import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Resolves the effort level the new session will start at, reading only the
 * `effortLevel` key from the same local settings files Claude itself consults
 * (project-local, project, user), falling back to `auto` (unset behavior).
 *
 * The value is passed as an `--effort` spawn pin. File-verified on 2.1.238:
 * the pin does NOT scope later `/effort` commands (every level except `max`
 * persists the saved default regardless); it is kept because it makes the
 * session's starting level known, enabling the same-level no-op skip, and it
 * reproduces the effort the session would have had anyway. Managed/enterprise
 * policy files are not read; the CLI acknowledgement gate still prevents any
 * unsupported application.
 */

const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max", "auto"]);

function defaultReadFile(file) {
  return readFileSync(file, "utf8");
}

export function resolveSessionEffortBaseline({
  cwd = process.cwd(),
  home = os.homedir(),
  readFile = defaultReadFile,
} = {}) {
  const candidates = [
    { file: path.join(cwd, ".claude", "settings.local.json"), source: "project local settings" },
    { file: path.join(cwd, ".claude", "settings.json"), source: "project settings" },
    { file: path.join(home, ".claude", "settings.json"), source: "user settings" },
  ];
  for (const candidate of candidates) {
    let parsed;
    try {
      // Windows editors and PowerShell commonly write settings with a UTF-8
      // BOM, which JSON.parse rejects.
      parsed = JSON.parse(readFile(candidate.file).replace(/^\uFEFF/, ""));
    } catch {
      continue;
    }
    const effort = parsed?.effortLevel;
    if (typeof effort === "string" && EFFORT_LEVELS.has(effort)) {
      return Object.freeze({ effort, source: candidate.source });
    }
  }
  return Object.freeze({ effort: "auto", source: "session default" });
}
