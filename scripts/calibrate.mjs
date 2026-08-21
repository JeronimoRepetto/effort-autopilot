#!/usr/bin/env node
// Calibration pipeline CLI. Mock mode is free and local. LIVE mode consumes
// the Claude subscription and requires BOTH --live and
// --confirm-subscription-use, mirroring the pilot's confirmation boundary.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createMockRunner } from "../src/evaluation/pilot.js";
import {
  exportCalibrationDataset,
  runCalibration,
  summarizeCalibration,
} from "../src/evaluation/calibration.js";
import { executeClaudeTask } from "../src/adapters/claude-cli/runner.js";

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? fallback;
  return fallback;
}
const has = (name) => process.argv.includes(name);

const manifestPath = argValue("--manifest", "evaluation/live-pilot-humaneval-5.json");
const live = has("--live");
const confirmed = has("--confirm-subscription-use");
const resultsFile = argValue(
  "--results",
  path.join(".effort-autopilot", "evaluation-results", "calibration.json"),
);
const datasetOut = argValue("--export-dataset");
const efforts = argValue("--efforts", "low,medium,high").split(",");
const repeats = Number(argValue("--repeats", "1"));
const requiredPasses = Number(argValue("--required-passes", "1"));

if (live && !confirmed) {
  process.stderr.write(
    "LIVE calibration consumes your Claude subscription. Refusing without --confirm-subscription-use.\n",
  );
  process.exit(1);
}

const cwd = process.cwd();
const manifest = JSON.parse(await readFile(path.resolve(cwd, manifestPath), "utf8"));

const state = await runCalibration({
  manifest,
  cwd,
  resultsFile: path.resolve(cwd, resultsFile),
  workspaceRoot: path.join(cwd, ".effort-autopilot", "calibration-workspaces"),
  mock: !live,
  runner: live ? executeClaudeTask : createMockRunner(),
  efforts,
  repeats,
  requiredPasses,
  maxTrialsPerTask: Number(argValue("--max-trials-per-task", "8")),
  maxTotalOutputTokens: argValue("--max-total-output-tokens")
    ? Number(argValue("--max-total-output-tokens"))
    : undefined,
  maxTotalCostUsd: argValue("--max-total-cost-usd")
    ? Number(argValue("--max-total-cost-usd"))
    : undefined,
  permissionMode: argValue("--permission-mode", "acceptEdits"),
  resume: has("--resume"),
  progress: (line) => process.stdout.write(`${line}\n`),
});

const summary = summarizeCalibration(state, manifest.tasks.length);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (datasetOut) {
  const rows = await exportCalibrationDataset(state, manifest, { cwd });
  await writeFile(
    path.resolve(cwd, datasetOut),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  process.stdout.write(`dataset: ${rows.length} rows -> ${datasetOut}\n`);
}
