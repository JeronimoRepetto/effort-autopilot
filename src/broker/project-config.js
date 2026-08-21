import { readFileSync } from "node:fs";
import path from "node:path";

import { AUTOPILOT_POLICIES } from "./claude-args.js";
import { globalConfigPath } from "./install-paths.js";

/**
 * Per-project and global installation configuration.
 *
 * A project opts out (or picks a policy) with `.effort-autopilot.json` in its
 * root; the installer persists a machine-wide policy in the install root's
 * `config.json`. Reads are BOM-tolerant and every malformed or unknown value
 * degrades to "no opinion" so the launch-time resolution chain stays safe.
 */

export const PROJECT_CONFIG_FILENAME = ".effort-autopilot.json";

function defaultReadFile(file) {
  return readFileSync(file, "utf8");
}

function parseConfigDocument(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return Object.freeze({ invalid: true });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return Object.freeze({ invalid: true });
  }
  return Object.freeze({
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : undefined,
    policy: AUTOPILOT_POLICIES.includes(parsed.policy) ? parsed.policy : undefined,
    ml: typeof parsed.ml === "boolean" ? parsed.ml : undefined,
    invalid: false,
  });
}

export function readProjectConfig({ cwd, readFile = defaultReadFile } = {}) {
  try {
    return parseConfigDocument(readFile(path.join(cwd, PROJECT_CONFIG_FILENAME)));
  } catch {
    return Object.freeze({ enabled: undefined, policy: undefined, ml: undefined, invalid: false });
  }
}

export function readGlobalConfig({ readFile = defaultReadFile, ...pathOptions } = {}) {
  try {
    return parseConfigDocument(readFile(globalConfigPath(pathOptions)));
  } catch {
    return Object.freeze({ enabled: undefined, policy: undefined, ml: undefined, invalid: false });
  }
}

/**
 * Precedence chain: explicit launch flag > project config > global install
 * config > manual-wins default.
 */
export function resolveAutopilotPolicy({ launchPolicy, projectPolicy, globalPolicy } = {}) {
  if (AUTOPILOT_POLICIES.includes(launchPolicy)) {
    return Object.freeze({ policy: launchPolicy, source: "launch flag" });
  }
  if (AUTOPILOT_POLICIES.includes(projectPolicy)) {
    return Object.freeze({ policy: projectPolicy, source: "project config" });
  }
  if (AUTOPILOT_POLICIES.includes(globalPolicy)) {
    return Object.freeze({ policy: globalPolicy, source: "global config" });
  }
  return Object.freeze({ policy: "manual-wins", source: "default" });
}
