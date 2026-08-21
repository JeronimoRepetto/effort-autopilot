/**
 * Minimal, positional-aware scan of the arguments forwarded to the real
 * Claude Code CLI. The broker only needs the launch facts that change its own
 * safety posture; every other argument is forwarded untouched.
 *
 * Broker-owned flags (`--autopilot …`) are consumed here and never forwarded:
 * the real CLI would reject them. `settings.index` positions refer to
 * `forwardArgs`, the argument list that actually reaches the child.
 */

const SESSION_RESUME_FLAGS = new Set(["--resume", "-r", "--continue", "-c"]);
const PRINT_FLAGS = new Set(["--print", "-p"]);

export const AUTOPILOT_POLICIES = Object.freeze(["manual-wins", "autopilot-wins"]);

export function parseClaudeLaunchArgs(args = []) {
  let settings = null;
  let effort = null;
  let resumesSession = false;
  let printMode = false;
  // null = no launch-flag opinion; the broker resolves the effective policy
  // through the project/global config chain.
  let autopilotPolicy = null;
  let invalidAutopilotPolicy = null;
  const forwardArgs = [];

  const readPolicy = (value) => {
    if (AUTOPILOT_POLICIES.includes(value)) autopilotPolicy = value;
    else invalidAutopilotPolicy = value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (typeof argument !== "string") continue;
    if (argument === "--autopilot") {
      const next = args[index + 1];
      // Bare `--autopilot` (no value, or the next token is another flag)
      // means "the autopilot decides", i.e. autopilot-wins.
      if (typeof next === "string" && !next.startsWith("-")) {
        readPolicy(next);
        index += 1;
      } else {
        autopilotPolicy = "autopilot-wins";
      }
      continue;
    }
    if (argument.startsWith("--autopilot=")) {
      readPolicy(argument.slice("--autopilot=".length));
      continue;
    }
    if (argument === "--settings") {
      settings = { value: args[index + 1] ?? null, index: forwardArgs.length, form: "separate" };
    } else if (argument.startsWith("--settings=")) {
      settings = {
        value: argument.slice("--settings=".length),
        index: forwardArgs.length,
        form: "inline",
      };
    } else if (argument === "--effort") {
      effort = args[index + 1] ?? null;
    } else if (argument.startsWith("--effort=")) {
      effort = argument.slice("--effort=".length);
    } else if (SESSION_RESUME_FLAGS.has(argument)) {
      resumesSession = true;
    } else if (PRINT_FLAGS.has(argument)) {
      printMode = true;
    }
    forwardArgs.push(argument);
  }

  return Object.freeze({
    settings,
    effort,
    resumesSession,
    printMode,
    autopilotPolicy,
    invalidAutopilotPolicy,
    forwardArgs: Object.freeze(forwardArgs),
  });
}
