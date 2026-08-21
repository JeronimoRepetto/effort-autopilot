import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { executeClaudeTask } from "../adapters/claude-cli/runner.js";
import { collectEnvironmentMetadata } from "../core/environment.js";
import { createMockRunner, runPilot, summarizePilot } from "../evaluation/pilot.js";

export const PILOT_HELP = `Effort Autopilot visible pilot

Usage:
  effort-autopilot-pilot dry-run [options]
  effort-autopilot-pilot run --live --confirm-subscription-use (--model <id> | --inherit-model) [options]
  effort-autopilot-pilot resume --live --confirm-subscription-use (--model <id> | --inherit-model) [options]
  effort-autopilot-pilot status [options]

Options:
  --manifest <file>             Pilot manifest (default: evaluation/pilot-manifest.json)
  --max-runs <1-10>             Strict trial limit (default: 5)
  --ceiling <level>             Effort ceiling (default: medium)
  --baseline <level>            Classification-failure effort (default: medium)
  --model <id>                  Explicit model for live reproducibility
  --inherit-model               Preserve Claude Code's configured/default model
  --max-total-cost-usd <value>  Stop before next trial when estimate reaches value
  --max-total-output-tokens <n> Stop before next trial when output usage reaches value
  --max-turns <n>               Per-trial Claude turn limit
  --permission-mode <mode>      manual, acceptEdits, plan, or dontAsk
  --results <file>              Local checkpoint/result file
  --live                        Permit real Claude Code execution
  --confirm-subscription-use    Explicit confirmation required with --live
`;

function parse(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "dry-run";
  const values = new Set([
    "--manifest",
    "--max-runs",
    "--ceiling",
    "--baseline",
    "--model",
    "--max-total-cost-usd",
    "--max-total-output-tokens",
    "--max-turns",
    "--permission-mode",
    "--results",
  ]);
  const options = {
    manifest: "evaluation/pilot-manifest.json",
    maxRuns: 5,
    ceiling: "medium",
    baselineEffort: "medium",
    live: false,
    confirmed: false,
    inheritModel: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--confirm-subscription-use") options.confirmed = true;
    else if (arg === "--inherit-model") options.inheritModel = true;
    else if (values.has(arg)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      if (arg === "--manifest") options.manifest = value;
      else if (arg === "--max-runs") options.maxRuns = Number(value);
      else if (arg === "--ceiling") options.ceiling = value;
      else if (arg === "--baseline") options.baselineEffort = value;
      else if (arg === "--model") options.model = value;
      else if (arg === "--max-total-cost-usd") options.maxTotalCostUsd = Number(value);
      else if (arg === "--max-total-output-tokens") options.maxTotalOutputTokens = Number(value);
      else if (arg === "--max-turns") options.maxTurns = Number(value);
      else if (arg === "--permission-mode") options.permissionMode = value;
      else if (arg === "--results") options.results = value;
    } else throw new Error(`unknown option: ${arg}`);
  }
  return { command, options };
}

function printSummary(summary, write) {
  write(
    `summary completed=${summary.completed} pending=${summary.pending} passed=${summary.passed} failed=${summary.failed} verified_after_terminal=${summary.verifiedAfterTerminal} launcher_errors=${summary.launcherErrors} stopped_for_limit=${summary.stoppedForLimit} stopped_for_max_turns=${summary.stoppedForMaxTurns} stop_reason=${summary.stopReason}\n`,
  );
}

export async function runPilotCli(
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    stdout = process.stdout,
    runner = executeClaudeTask,
    metadataCollector = collectEnvironmentMetadata,
  } = {},
) {
  const { command, options } = parse(argv);
  if (options.help) {
    stdout.write(PILOT_HELP);
    return 0;
  }
  if (!["dry-run", "run", "resume", "status"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  const manifestPath = path.resolve(cwd, options.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const resultRoot = path.resolve(cwd, ".effort-autopilot", "evaluation-results");
  const resultsFile = path.resolve(
    cwd,
    options.results ?? path.join(resultRoot, `${manifest.benchmark}.json`),
  );
  if (command === "status") {
    const state = JSON.parse(await readFile(resultsFile, "utf8"));
    printSummary(summarizePilot(state, Math.min(options.maxRuns, manifest.tasks.length)), (value) => stdout.write(value));
    return 0;
  }

  const mock = command === "dry-run";
  if (!mock && (!options.live || !options.confirmed)) {
    throw new Error("live pilot requires --live and --confirm-subscription-use");
  }
  if (options.model && options.inheritModel) {
    throw new Error("use either --model or --inherit-model, not both");
  }
  if (!mock && !options.model && !options.inheritModel) {
    throw new Error("live pilot requires --model or explicit --inherit-model");
  }
  const pilot = await runPilot({
    manifest,
    cwd,
    resultsFile,
    workspaceRoot: path.resolve(cwd, ".effort-autopilot", "evaluation-workspaces", manifest.benchmark),
    maxRuns: options.maxRuns,
    resume: command === "resume",
    mock,
    model: options.model,
    ceiling: options.ceiling,
    baselineEffort: options.baselineEffort,
    maxTotalCostUsd: options.maxTotalCostUsd,
    maxTotalOutputTokens: options.maxTotalOutputTokens,
    maxTurns: options.maxTurns,
    permissionMode: options.permissionMode,
    runner: mock ? createMockRunner() : runner,
    metadataCollector,
    progress: (line) => stdout.write(`${line}\n`),
  });
  printSummary(pilot.summary, (value) => stdout.write(value));
  stdout.write(`checkpoint=${resultsFile}\n`);
  return ["launcher-error", "max-turns"].includes(pilot.summary.stopReason) ? 1 : 0;
}

export async function pilotMain() {
  try {
    process.exitCode = await runPilotCli();
  } catch (error) {
    process.stderr.write(`[effort-autopilot-pilot] ${error.message}\n`);
    process.exitCode = 1;
  }
}
