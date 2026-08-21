import { isEffort } from "../launcher/plan.js";

const VALUE_OPTIONS = new Set([
  "--ceiling",
  "--baseline",
  "--model",
  "--model-profile",
  "--cwd",
  "--max-turns",
  "--max-budget-usd",
  "--permission-mode",
]);
const PERMISSION_MODES = new Set(["manual", "acceptEdits", "plan", "dontAsk"]);

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

export function parseCliArgs(argv, env = process.env) {
  const args = [...argv];
  let command = "run";
  if (["run", "classify", "classify-json"].includes(args[0])) command = args.shift();

  const options = {
    ceiling: env.EFFORT_AUTOPILOT_CEILING || "medium",
    baselineEffort: env.EFFORT_AUTOPILOT_BASELINE || "medium",
    cwd: process.cwd(),
    quiet: false,
    json: false,
    stdin: false,
    dryRun: false,
  };
  const promptParts = [];
  let afterDelimiter = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (afterDelimiter) {
      promptParts.push(arg);
      continue;
    }
    if (arg === "--") {
      afterDelimiter = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (arg === "--quiet" || arg === "-q") options.quiet = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--stdin") options.stdin = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (VALUE_OPTIONS.has(arg)) {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--ceiling") options.ceiling = value;
      else if (arg === "--baseline") options.baselineEffort = value;
      else if (arg === "--model") options.model = value;
      else if (arg === "--model-profile") options.modelProfilePath = value;
      else if (arg === "--cwd") options.cwd = value;
      else if (arg === "--max-turns") options.maxTurns = positiveInteger(value, arg);
      else if (arg === "--max-budget-usd") options.maxBudgetUsd = positiveNumber(value, arg);
      else if (arg === "--permission-mode") options.permissionMode = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      promptParts.push(arg);
    }
  }

  if (!isEffort(options.ceiling)) throw new Error("--ceiling must be low, medium, high, xhigh, or max");
  if (!isEffort(options.baselineEffort)) throw new Error("--baseline must be low, medium, high, xhigh, or max");
  if (options.permissionMode && !PERMISSION_MODES.has(options.permissionMode)) {
    throw new Error("unsupported --permission-mode");
  }
  if (options.stdin && promptParts.length) {
    throw new Error("use either --stdin or prompt arguments, not both");
  }

  return Object.freeze({ command, options: Object.freeze(options), promptParts: Object.freeze(promptParts) });
}

export const HELP_TEXT = `Effort Autopilot — classify locally, then run Claude once with pre-call effort

Usage:
  effort-autopilot [options] "prompt"
  command-producing-prompt | effort-autopilot --stdin [options]
  effort-autopilot classify < prompt.txt
  effort-autopilot classify-json < envelope.json

Options:
  --ceiling <level>          Maximum selected effort (default: medium)
  --baseline <level>         Fallback on classification failure (default: medium)
  --model <id>               Explicit model override; omitted preserves Claude settings
  --model-profile <file>     Local JSON capability profile for classifier calibration
  --cwd <path>               Working directory for metadata and Claude (default: current)
  --max-turns <number>       Optional Claude Code execution turn limit
  --max-budget-usd <amount>  Optional Claude Code execution budget
  --permission-mode <mode>   manual, acceptEdits, plan, or dontAsk
  --stdin                    Read the prompt from stdin
  --dry-run                  Classify and show the plan without calling Claude
  --json                     Emit one JSON result with routing and usage
  -q, --quiet                Print only Claude's final result
  -h, --help                 Show help
  -v, --version              Show version

Environment:
  EFFORT_AUTOPILOT_CEILING
  EFFORT_AUTOPILOT_BASELINE
`;
