#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { recoverVerifiedTerminalTrial } from "../src/evaluation/pilot.js";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "evaluation", "live-pilot-humaneval-5.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const resultsFile = path.join(
  root,
  ".effort-autopilot",
  "evaluation-results",
  `${manifest.benchmark}.json`,
);
const workspaceRoot = path.join(
  root,
  ".effort-autopilot",
  "evaluation-workspaces",
  manifest.benchmark,
);

const recovered = await recoverVerifiedTerminalTrial({
  manifest,
  cwd: root,
  resultsFile,
  workspaceRoot,
  taskId: "HumanEval/53",
});

process.stdout.write(
  `recovered=${recovered.recovered} reason=${recovered.reason} ` +
    `completed=${recovered.summary.completed} pending=${recovered.summary.pending} ` +
    `verified_after_terminal=${recovered.summary.verifiedAfterTerminal}\n`,
);
process.stdout.write("No Claude or model call was made.\n");
