import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Claude Code 2.1.238 persists `/effort <level>` as the user's default for new
 * sessions unless the session was started with an explicit `--effort` flag, in
 * which case the change is session-only. The broker therefore pins the session
 * effort scope at spawn so its automatic `/effort` commands can never mutate
 * the user's saved defaults.
 *
 * The pinned value must reproduce the effort the session would have had
 * anyway. This resolver reads only the `effortLevel` key from the same local
 * settings files Claude itself consults (project-local, project, user) and
 * falls back to `auto`, which matches unset behavior. Managed/enterprise
 * policy files are not read; if one overrides effort, the CLI acknowledgement
 * gate still prevents any unsupported application.
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
      parsed = JSON.parse(readFile(candidate.file).replace(/^﻿/, ""));
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
