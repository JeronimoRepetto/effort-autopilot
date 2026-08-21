import { spawn } from "node:child_process";

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const PERMISSION_MODES = new Set(["manual", "acceptEdits", "plan", "dontAsk"]);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

function normalizeTools(value, name) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((tool) => typeof tool !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(tool))
  ) {
    throw new TypeError(`${name} must be a non-empty array of bare tool names`);
  }
  return [...new Set(value)];
}

export class ClaudeExecutionError extends Error {
  constructor(code, metadata = {}) {
    super(`Claude execution failed (${code})`);
    this.name = "ClaudeExecutionError";
    this.code = code;
    this.metadata = Object.freeze(metadata);
    this.rateLimited = false;
  }
}

export class ClaudeRateLimitError extends ClaudeExecutionError {
  constructor(metadata = {}) {
    super("subscription-limit", metadata);
    this.name = "ClaudeRateLimitError";
    this.rateLimited = true;
  }
}

export function buildClaudeCliInvocation({
  effort,
  cwd,
  model,
  maxTurns,
  maxBudgetUsd,
  permissionMode,
  tools,
  allowedTools,
  safeMode,
}) {
  if (!EFFORTS.has(effort)) throw new TypeError("invalid effort");
  if (permissionMode !== undefined && !PERMISSION_MODES.has(permissionMode)) {
    throw new TypeError("unsupported permission mode");
  }
  const args = [
    "--print",
    "--input-format",
    "text",
    "--output-format",
    "json",
    "--effort",
    effort,
    "--no-session-persistence",
  ];
  const available = normalizeTools(tools, "tools");
  const allowed = normalizeTools(allowedTools, "allowedTools");
  if (safeMode === true) args.push("--safe-mode");
  if (available) args.push("--tools", available.join(","));
  if (allowed) args.push("--allowedTools", allowed.join(","));
  // Omitting --model preserves the model resolved by existing Claude settings.
  if (model !== undefined) args.push("--model", model);
  if (maxTurns !== undefined) args.push("--max-turns", String(maxTurns));
  if (maxBudgetUsd !== undefined) args.push("--max-budget-usd", String(maxBudgetUsd));
  if (permissionMode !== undefined) args.push("--permission-mode", permissionMode);
  return Object.freeze({ command: "claude", args: Object.freeze(args), cwd });
}

export function runClaudeProcess({ command, args, cwd, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          child.kill();
          finish(reject, new ClaudeExecutionError("execution-timeout"));
        }, timeoutMs)
      : null;
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(reject, new ClaudeExecutionError("output-limit"));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      finish(reject,
        new ClaudeExecutionError(
          error?.code === "ENOENT" ? "claude-not-found" : "process-start-failed",
        ),
      );
    });
    child.on("close", (exitCode) => {
      finish(resolve, {
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(input);
  });
}

function parseJsonOutput(value) {
  try {
    return JSON.parse(value.trim());
  } catch {
    return null;
  }
}

export function isRateLimitFailure(payload, stderr = "", exitCode = 1) {
  const status = payload?.api_error_status ?? payload?.status ?? null;
  const subtype = payload?.subtype ?? "";
  const errors = Array.isArray(payload?.errors) ? payload.errors.join(" ") : "";
  const safeDiagnostic = `${subtype} ${errors} ${stderr}`;
  return (
    status === 429 ||
    /rate[_ -]?limit|usage[_ -]?limit|subscription[_ -]?limit|limit reached|resets? at/i.test(
      safeDiagnostic,
    ) ||
    (exitCode !== 0 && /too many requests/i.test(safeDiagnostic))
  );
}

/**
 * Execute one authenticated Claude Code CLI process. The prompt is supplied on
 * stdin so it does not appear in process arguments. There is no retry path.
 */
export async function executeClaudeTask(
  request,
  { processRunner = runClaudeProcess } = {},
) {
  const invocation = buildClaudeCliInvocation(request);
  const completed = await processRunner({
    ...invocation,
    input: request.prompt,
    timeoutMs: request.timeoutMs,
  });
  const payload = parseJsonOutput(completed.stdout);
  const metadata = {
    exitCode: completed.exitCode,
    subtype: payload?.subtype ?? null,
    numTurns: payload?.num_turns ?? 0,
    totalCostUsd: payload?.total_cost_usd ?? null,
    usage: payload?.usage ?? null,
    modelUsage: payload?.modelUsage ?? payload?.model_usage ?? null,
    stopReason: payload?.stop_reason ?? null,
  };

  if (isRateLimitFailure(payload, completed.stderr, completed.exitCode)) {
    throw new ClaudeRateLimitError(metadata);
  }
  if (
    completed.exitCode !== 0 ||
    payload === null ||
    payload.is_error === true ||
    (payload.subtype && payload.subtype !== "success")
  ) {
    throw new ClaudeExecutionError(payload?.subtype ?? "cli-execution-failed", metadata);
  }

  return Object.freeze({
    result: payload.result ?? "",
    sessionId: payload.session_id ?? null,
    ...metadata,
  });
}
