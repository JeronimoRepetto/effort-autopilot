import { rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { classifyEnvelope } from "../core/protocol.js";
import { parseClaudeLaunchArgs } from "./claude-args.js";
import { findRealClaudeExecutable } from "./claude-locator.js";
import { resolveSessionEffortBaseline } from "./effort-baseline.js";
import { readGlobalConfig, readProjectConfig, resolveAutopilotPolicy } from "./project-config.js";
import { HybridBrokerCoordinator } from "./hybrid-coordinator.js";
import { createIpcIdentity, startBrokerIpcServer } from "./ipc.js";
import { PtyInputRelay } from "./input-relay.js";
import { PtySession } from "./pty-session.js";
import { SessionOutputObserver } from "./session-observer.js";
import { SessionEffortPolicy } from "./session-policy.js";
import { mergeHookSettings } from "./settings-merge.js";

function quoteCommandPart(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function terminalDimensions() {
  return {
    cols: Number.isInteger(process.stdout.columns) ? process.stdout.columns : 100,
    rows: Number.isInteger(process.stdout.rows) ? process.stdout.rows : 30,
  };
}

async function resolveUserSettingsObject(settingsValue) {
  if (typeof settingsValue !== "string" || settingsValue.length === 0) {
    throw new Error("--settings requires a value");
  }
  const trimmed = settingsValue.trim();
  const raw = trimmed.startsWith("{") ? trimmed : await readFile(settingsValue, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

export async function runInteractiveBroker({
  claudeArgs = process.argv.slice(2),
  cwd = process.cwd(),
  home = os.homedir(),
  claudeExecutable = findRealClaudeExecutable(),
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("the interactive broker requires a terminal");
  }
  // A persistent shim that ever resolved back to itself must fail loudly
  // instead of fork-bombing the machine.
  if (process.env.EFFORT_AUTOPILOT_BROKER_ACTIVE === "1") {
    throw new Error("broker recursion detected: the claude shim resolved back to itself");
  }

  const launch = parseClaudeLaunchArgs(claudeArgs);
  const projectConfig = readProjectConfig({ cwd });

  // Any launch shape without a proven session-only effort scope, or whose
  // user configuration cannot be combined without guessing, runs Claude
  // completely unchanged instead of degrading its behavior.
  let passthroughCause = null;
  let userSettings = {};
  if (projectConfig.enabled === false) {
    passthroughCause = "disabled by the project's .effort-autopilot.json";
  } else if (launch.printMode) {
    passthroughCause = "non-interactive print mode";
  } else if (launch.resumesSession) {
    passthroughCause = "resumed sessions have no verified session-only effort scope yet";
  } else if (launch.settings) {
    try {
      userSettings = await resolveUserSettingsObject(launch.settings.value);
    } catch {
      passthroughCause = "the provided --settings value could not be safely combined";
    }
  }
  if (projectConfig.invalid) {
    errorOutput.write(
      "Effort Autopilot: the project's .effort-autopilot.json is invalid and was ignored.\r\n",
    );
  }

  const root = path.resolve(import.meta.dirname, "..", "..");
  const hookScript = path.join(root, "bin", "internal-effort-autopilot-hook.js");
  const hookCommand = `${quoteCommandPart(process.execPath)} ${quoteCommandPart(hookScript)}`;
  let mergedSettings = null;
  if (!passthroughCause) {
    try {
      mergedSettings = mergeHookSettings(userSettings, hookCommand);
    } catch {
      passthroughCause = "the provided --settings hooks could not be safely combined";
    }
  }

  if (passthroughCause) {
    errorOutput.write(
      `Effort Autopilot: automatic effort is disabled for this launch (${passthroughCause}); Claude runs unchanged.\r\n`,
    );
    return relayPlainSession({
      claudeExecutable,
      claudeArgs: launch.forwardArgs,
      cwd,
      input,
      output,
    });
  }

  const resolvedPolicy = resolveAutopilotPolicy({
    launchPolicy: launch.autopilotPolicy,
    projectPolicy: projectConfig.policy,
    globalPolicy: readGlobalConfig({ home }).policy,
  });
  const autopilotWins = resolvedPolicy.policy === "autopilot-wins";
  if (launch.invalidAutopilotPolicy) {
    errorOutput.write(
      `Effort Autopilot: unknown --autopilot policy ${launch.invalidAutopilotPolicy}; using ${resolvedPolicy.policy}.\r\n`,
    );
  }
  if (autopilotWins) {
    errorOutput.write(
      `Effort Autopilot: autopilot-wins policy active (${resolvedPolicy.source}); manual /effort choices are re-evaluated on every prompt.\r\n`,
    );
  }

  // Claude Code 2.1.238 persists `/effort` as the saved default unless the
  // session started with an explicit `--effort` scope. Pinning the scope at
  // spawn is what keeps every automatic change session-only.
  const baseline = launch.effort ? null : resolveSessionEffortBaseline({ cwd, home });
  if (launch.effort) {
    errorOutput.write(
      autopilotWins
        ? `Effort Autopilot: session effort starts at ${launch.effort} (--effort flag); autopilot-wins re-evaluates it per prompt.\r\n`
        : `Effort Autopilot: manual --effort ${launch.effort} takes precedence; automatic effort is disabled for this session.\r\n`,
    );
  } else {
    errorOutput.write(
      `Effort Autopilot: session effort starts at ${baseline.effort} (${baseline.source}); automatic changes are session-only.\r\n`,
    );
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), "effort-autopilot-session-"));
  const settingsPath = path.join(temporary, "settings.json");
  await writeFile(settingsPath, JSON.stringify(mergedSettings), { encoding: "utf8", mode: 0o600 });

  const spawnArgs = [...launch.forwardArgs];
  if (launch.settings) {
    if (launch.settings.form === "separate") spawnArgs[launch.settings.index + 1] = settingsPath;
    else spawnArgs[launch.settings.index] = `--settings=${settingsPath}`;
  } else {
    spawnArgs.push("--settings", settingsPath);
  }
  if (!launch.effort) spawnArgs.push("--effort", baseline.effort);

  const identity = createIpcIdentity();
  const coordinator = new HybridBrokerCoordinator();

  let session;
  let relay;
  let outputSubscription;
  let resizeHandler;
  let rawModeChanged = false;
  const activeRoutes = new Set();
  const policy = new SessionEffortPolicy({
    coordinator,
    autopilotWins,
    initialEffort: launch.effort ?? (baseline.effort !== "auto" ? baseline.effort : null),
  });

  const observer = new SessionOutputObserver({
    onUserEffort: (level) => policy.handleUserEffort(level),
    onModelChange: () => policy.handleModelChange(),
  });

  const server = await startBrokerIpcServer({
    ...identity,
    coordinator,
    onDecision: ({ event, sessionId }) => {
      if (event !== "SessionStart" || !sessionId) return;
      policy.handleSessionStart(sessionId, launch.effort);
    },
    onBlocked: ({ ticketId }) => {
      relay?.pauseForRouting();
      const route = coordinator
        .routeTicket(ticketId, {
          classifier: classifyEnvelope,
          config: { ceiling: "max", baselineEffort: "medium" },
          applyEffort: async (effort) => {
            if (policy.shouldSkipApplication(effort)) {
              return { acknowledged: true, effort };
            }
            observer.beginBrokerApplication(effort);
            try {
              const result = await session.applyEffort(effort);
              if (result.acknowledged) policy.noteAcknowledgedApplication(effort);
              return result;
            } finally {
              observer.endBrokerApplication();
            }
          },
          reinjectPrompt: (prompt) => session.forwardPrompt(prompt),
        })
        .catch((error) => {
          errorOutput.write(`\r\nEffort Autopilot could not route this turn: ${error.message}\r\n`);
        })
        .finally(() => {
          activeRoutes.delete(route);
          relay?.resumeAfterRouting();
        });
      activeRoutes.add(route);
    },
  });

  // A crash or forced exit must not leave the child or the temporary hook
  // settings behind; the 'exit' handler is synchronous by contract.
  const crashCleanup = () => {
    try {
      session?.dispose();
    } catch {
      // best effort only
    }
    try {
      rmSync(temporary, { recursive: true, force: true });
    } catch {
      // best effort only
    }
  };
  process.once("exit", crashCleanup);

  try {
    const dimensions = terminalDimensions();
    session = PtySession.spawn(claudeExecutable, spawnArgs, {
      cwd,
      env: {
        ...process.env,
        EFFORT_AUTOPILOT_BROKER_ACTIVE: "1",
        EFFORT_AUTOPILOT_IPC_ENDPOINT: identity.endpoint,
        EFFORT_AUTOPILOT_IPC_TOKEN: identity.token,
      },
      cols: dimensions.cols,
      rows: dimensions.rows,
      acknowledgementTimeoutMs: 5000,
    });
    outputSubscription = session.child.onData((data) => {
      output.write(data);
      observer.feed(data);
    });
    relay = new PtyInputRelay({ input, write: (chunk) => session.write(chunk) });
    if (typeof input.setRawMode === "function") {
      input.setRawMode(true);
      rawModeChanged = true;
    }
    input.resume();
    relay.start();
    resizeHandler = () => {
      const next = terminalDimensions();
      session.child.resize(next.cols, next.rows);
    };
    output.on("resize", resizeHandler);
    const exited = await session.exitPromise;
    return exited.exitCode ?? 0;
  } finally {
    process.off("exit", crashCleanup);
    relay?.dispose();
    if (resizeHandler) output.off("resize", resizeHandler);
    if (rawModeChanged) input.setRawMode(false);
    outputSubscription?.dispose();
    session?.dispose();
    await Promise.allSettled([...activeRoutes]);
    await server.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function relayPlainSession({ claudeExecutable, claudeArgs, cwd, input, output }) {
  let session;
  let relay;
  let outputSubscription;
  let resizeHandler;
  let rawModeChanged = false;
  try {
    const dimensions = terminalDimensions();
    session = PtySession.spawn(claudeExecutable, claudeArgs, {
      cwd,
      env: { ...process.env, EFFORT_AUTOPILOT_BROKER_ACTIVE: "1" },
      cols: dimensions.cols,
      rows: dimensions.rows,
    });
    outputSubscription = session.child.onData((data) => output.write(data));
    relay = new PtyInputRelay({ input, write: (chunk) => session.write(chunk) });
    if (typeof input.setRawMode === "function") {
      input.setRawMode(true);
      rawModeChanged = true;
    }
    input.resume();
    relay.start();
    resizeHandler = () => {
      const next = terminalDimensions();
      session.child.resize(next.cols, next.rows);
    };
    output.on("resize", resizeHandler);
    const exited = await session.exitPromise;
    return exited.exitCode ?? 0;
  } finally {
    relay?.dispose();
    if (resizeHandler) output.off("resize", resizeHandler);
    if (rawModeChanged) input.setRawMode(false);
    outputSubscription?.dispose();
    session?.dispose();
  }
}
