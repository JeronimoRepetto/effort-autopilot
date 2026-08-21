import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { executeClaudeTask } from "../adapters/claude-cli/runner.js";
import { collectEnvironmentMetadata } from "../core/environment.js";
import { classifyPrompt } from "../core/classifier.js";
import { resolveModelProfile } from "../core/model-profiles.js";
import { DEFAULT_FALLBACK, parseAndClassifyEnvelope } from "../core/protocol.js";
import { launchTask } from "../launcher/launch.js";
import { resolveExecutionPlan } from "../launcher/plan.js";
import { HELP_TEXT, parseCliArgs } from "./args.js";

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_PROFILE_BYTES = 128 * 1024;

async function readBoundedStdin(input = process.stdin) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error("input exceeds the 1 MiB limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function loadModelProfile(filePath, cwd) {
  if (!filePath) return undefined;
  const absolute = path.resolve(cwd, filePath);
  const content = await readFile(absolute, "utf8");
  if (Buffer.byteLength(content) > MAX_PROFILE_BYTES) throw new Error("model profile exceeds 128 KiB");
  const profile = JSON.parse(content);
  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("model profile must contain a JSON object");
  }
  return profile;
}

function routeSummary(plan) {
  const confidence = plan.confidence === null ? "n/a" : plan.confidence.toFixed(2);
  return `[effort-autopilot] effort=${plan.effort} ceiling=${plan.ceiling} classifier=${plan.classifierTier} confidence=${confidence} profile=${plan.modelProfileId ?? "deterministic-fallback"}`;
}

function publicError(error) {
  return error?.code ? `${error.name}: ${error.code}` : error?.message || "unknown error";
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    env = process.env,
    input = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    runner = executeClaudeTask,
    metadataCollector = collectEnvironmentMetadata,
    version = "0.2.0",
  } = {},
) {
  const parsed = parseCliArgs(argv, env);
  if (parsed.options.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }
  if (parsed.options.version) {
    stdout.write(`${version}\n`);
    return 0;
  }

  if (parsed.command === "classify" || parsed.command === "classify-json") {
    let raw;
    try {
      raw = await readBoundedStdin(input);
    } catch (error) {
      if (parsed.command === "classify-json") {
        stdout.write(`${JSON.stringify(DEFAULT_FALLBACK)}\n`);
        return 0;
      }
      throw error;
    }
    const value =
      parsed.command === "classify" ? classifyPrompt(raw) : parseAndClassifyEnvelope(raw);
    stdout.write(`${JSON.stringify(value)}\n`);
    return 0;
  }

  let prompt;
  if (parsed.options.stdin || parsed.promptParts.length === 0) {
    prompt = await readBoundedStdin(input);
  } else {
    prompt = parsed.promptParts.join(" ");
  }
  if (!prompt.trim()) throw new Error("prompt must not be empty");

  const cwd = path.resolve(parsed.options.cwd);
  const modelProfileOverride = await loadModelProfile(parsed.options.modelProfilePath, cwd);
  const modelProfile = resolveModelProfile({
    modelId: parsed.options.model,
    override: modelProfileOverride,
  });
  const environment = metadataCollector(cwd);
  const config = {
    ceiling: parsed.options.ceiling,
    baselineEffort: parsed.options.baselineEffort,
  };
  const execution = {
    cwd,
    model: parsed.options.model,
    maxTurns: parsed.options.maxTurns,
    maxBudgetUsd: parsed.options.maxBudgetUsd,
    permissionMode: parsed.options.permissionMode,
  };

  if (parsed.options.dryRun) {
    const classification = parseAndClassifyEnvelope(
      JSON.stringify({ prompt, modelProfile, environment }),
    );
    const plan = resolveExecutionPlan(classification, config);
    if (parsed.options.json) stdout.write(`${JSON.stringify({ routing: plan, dryRun: true })}\n`);
    else {
      stdout.write(`${routeSummary(plan)}\n`);
      if (!parsed.options.quiet) {
        for (const reason of plan.reasons.slice(0, 3)) stdout.write(`- ${reason}\n`);
      }
    }
    return 0;
  }

  const launched = await launchTask({
    prompt,
    modelProfile,
    environment,
    config,
    execution,
    runner,
    onPlan: (plan) => {
      if (!parsed.options.quiet && !parsed.options.json) {
        stderr.write(`${routeSummary(plan)}\n`);
        for (const reason of plan.reasons.slice(0, 3)) stderr.write(`- ${reason}\n`);
      }
    },
  });

  if (parsed.options.json) {
    stdout.write(`${JSON.stringify(launched)}\n`);
  } else {
    stdout.write(`${launched.execution.result}\n`);
    if (!parsed.options.quiet) {
      const cost = launched.execution.totalCostUsd;
      stderr.write(
        `[effort-autopilot] turns=${launched.execution.numTurns} estimated_cost_usd=${cost ?? "unavailable"}\n`,
      );
    }
  }
  return 0;
}

export async function main() {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    process.stderr.write(`[effort-autopilot] ${publicError(error)}\n`);
    process.exitCode = 1;
  }
}
