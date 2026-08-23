import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { loadInstalledLearnedClassifier } from "../core/learned-classifier.js";
import { classifyEnvelope } from "../core/protocol.js";
import { parseClaudeLaunchArgs } from "./claude-args.js";
import { findRealClaudeExecutable } from "./claude-locator.js";
import { resolveSessionEffortBaseline } from "./effort-baseline.js";
import { readGlobalConfig, readProjectConfig, resolveAutopilotPolicy } from "./project-config.js";
import { HybridBrokerCoordinator } from "./hybrid-coordinator.js";
import { createIpcIdentity, startBrokerIpcServer } from "./ipc.js";
import { PtyInputRelay } from "./input-relay.js";
import { ensureSpawnHelperExecutable } from "./pty-preflight.js";
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
  // Test seams; production callers rely on the defaults.
  ipcServerStarter = startBrokerIpcServer,
  relayPlain = relayPlainSession,
  tempRoot = os.tmpdir(),
  ptySessionFactory = PtySession.spawn,
  spawnHelperPreflight = ensureSpawnHelperExecutable,
} = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("the interactive broker requires a terminal");
  }
  // A persistent shim that ever resolved back to itself must fail loudly
  // instead of fork-bombing the machine.
  if (process.env.EFFORT_AUTOPILOT_BROKER_ACTIVE === "1") {
    throw new Error("broker recursion detected: the claude shim resolved back to itself");
  }

  // Best-effort repair of node-pty's spawn-helper execute bit (issue #26;
  // some package managers drop it). Runs before the passthrough decision so
  // every launch shape self-heals — passthrough sessions spawn a PTY too.
  // Never throws; the PTY spawn is the arbiter and the fail-open layers
  // catch whatever remains broken.
  const preflight = spawnHelperPreflight();
  if (preflight.status === "repaired") {
    errorOutput.write(
      `Effort Autopilot: repaired the execute permission of node-pty's spawn-helper (${preflight.helperPaths.join(", ")}); some package managers drop it during install.\r\n`,
    );
  } else if (preflight.status === "failed") {
    errorOutput.write(
      `Effort Autopilot: node-pty's spawn-helper is not executable and could not be repaired; if the launch degrades, run: chmod +x ${preflight.helperPaths.join(" ")}\r\n`,
    );
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
    return relayPlain({
      claudeExecutable,
      claudeArgs: launch.forwardArgs,
      cwd,
      input,
      output,
      errorOutput,
    });
  }

  const globalConfig = readGlobalConfig({ home });
  const resolvedPolicy = resolveAutopilotPolicy({
    launchPolicy: launch.autopilotPolicy,
    projectPolicy: projectConfig.policy,
    globalPolicy: globalConfig.policy,
  });
  const autopilotWins = resolvedPolicy.policy === "autopilot-wins";
  if (launch.invalidAutopilotPolicy) {
    errorOutput.write(
      `Effort Autopilot: unknown --autopilot policy ${launch.invalidAutopilotPolicy}; using ${resolvedPolicy.policy}.\r\n`,
    );
  }
  if (autopilotWins) {
    errorOutput.write(
      `Effort Autopilot: autopilot-wins policy active (${resolvedPolicy.source}); manual /effort choices are re-evaluated on every prompt, and uncertain tasks are floored at high unless your manual choice is standing.\r\n`,
    );
  }

  // The `--effort` spawn pin does not scope later /effort commands (every
  // level except max persists the saved default regardless); it is kept so
  // the session's starting level is known for the same-level skip.
  const baseline = launch.effort ? null : resolveSessionEffortBaseline({ cwd, home });
  if (launch.effort) {
    errorOutput.write(
      autopilotWins
        ? `Effort Autopilot: session effort starts at ${launch.effort} (--effort flag); autopilot-wins re-evaluates it per prompt.\r\n`
        : `Effort Autopilot: manual --effort ${launch.effort} takes precedence; automatic effort is disabled for this session.\r\n`,
    );
  } else {
    errorOutput.write(
      `Effort Autopilot: session effort starts at ${baseline.effort} (${baseline.source}).\r\n`,
    );
  }

  // Learned classifier (frozen multilingual embeddings + trained ordinal
  // head): opt-in via config, present only when the model cache and artifact
  // exist. Everything else keeps the deterministic classifier; either way the
  // broker's fail-open contract is unchanged.
  let classifier = classifyEnvelope;
  let classificationTimeoutMs;
  if ((projectConfig.ml ?? globalConfig.ml) === true) {
    const learned = loadInstalledLearnedClassifier({ home });
    if (learned) {
      classifier = learned.classifier;
      classificationTimeoutMs = 1500;
      errorOutput.write(
        `Effort Autopilot: learned classifier active (${learned.embeddingModel ?? "local embeddings"} + ordinal head${learned.datasetVersion ? `, dataset ${learned.datasetVersion}` : ""}).\r\n`,
      );
    } else {
      errorOutput.write(
        "Effort Autopilot: ml is enabled in config but the local model or trained artifact is missing; using the deterministic classifier. Run: effort-autopilot ml-setup\r\n",
      );
    }
  }

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

  // Hard contract: from here on, any broker setup failure degrades to an
  // unchanged Claude session instead of aborting the launch (issue #19). The
  // unrecoverable preconditions (no TTY, recursion guard, missing real
  // Claude) were handled above and rightly stay hard errors — the fallback
  // needs the real executable anyway.
  const spawnArgs = [...launch.forwardArgs];
  let temporary = null;
  let identity;
  let server = null;
  try {
    temporary = await mkdtemp(path.join(tempRoot, "effort-autopilot-session-"));
    const settingsPath = path.join(temporary, "settings.json");
    await writeFile(settingsPath, JSON.stringify(mergedSettings), {
      encoding: "utf8",
      mode: 0o600,
    });

    if (launch.settings) {
      if (launch.settings.form === "separate") spawnArgs[launch.settings.index + 1] = settingsPath;
      else spawnArgs[launch.settings.index] = `--settings=${settingsPath}`;
    } else {
      spawnArgs.push("--settings", settingsPath);
    }
    if (!launch.effort) spawnArgs.push("--effort", baseline.effort);

    identity = createIpcIdentity();
    server = await ipcServerStarter({
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
            classifier,
            classificationTimeoutMs,
            config: { ceiling: "max", baselineEffort: "medium" },
            uncertaintyFloorEffort: autopilotWins ? "high" : null,
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
            errorOutput.write(
              `\r\nEffort Autopilot could not route this turn: ${error.message}\r\n`,
            );
          })
          .finally(() => {
            activeRoutes.delete(route);
            relay?.resumeAfterRouting();
          });
        activeRoutes.add(route);
      },
    });
  } catch (error) {
    // Fail-open: clean up whatever was partially created, report a visible,
    // prompt-free cause, and give the user their Claude session unchanged
    // (original arguments — no injected --settings, no --effort pin).
    if (server) await server.close().catch(() => {});
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
    errorOutput.write(
      `Effort Autopilot: automatic effort is disabled for this launch (broker-setup-failed: ${error.message}); Claude runs unchanged.\r\n`,
    );
    return relayPlain({
      claudeExecutable,
      claudeArgs: launch.forwardArgs,
      cwd,
      input,
      output,
      errorOutput,
    });
  }

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
    // The catch wraps ONLY the spawn: a failure mid-session must never
    // relaunch a second Claude. On spawn failure the surrounding finally
    // still cleans the IPC server and temporary settings, so the fallback
    // must launch with the ORIGINAL arguments (issue #25).
    try {
      session = ptySessionFactory(claudeExecutable, spawnArgs, {
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
    } catch (error) {
      errorOutput.write(
        `Effort Autopilot: automatic effort is disabled for this launch (pty-spawn-failed: ${error.message}); Claude runs unchanged.\r\n`,
      );
      return relayPlain({
        claudeExecutable,
        claudeArgs: launch.forwardArgs,
        cwd,
        input,
        output,
        errorOutput,
      });
    }
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

/**
 * Runs Claude with the terminal inherited directly (no PTY, no relay): the
 * last-resort degradation when node-pty itself cannot spawn (issue #25). The
 * child owns the real TTY — raw mode, resize, and Ctrl-C are its business —
 * so the broker only parks SIGINT/SIGQUIT for the cooked-mode startup window
 * (same foreground process group) and reports the child's outcome.
 */
async function runInheritedChild({
  claudeExecutable,
  claudeArgs,
  cwd,
  plainSpawner = spawn,
  platform = process.platform,
  env = process.env,
}) {
  let command = claudeExecutable;
  let args = claudeArgs;
  const options = {
    cwd,
    stdio: "inherit",
    env: { ...env, EFFORT_AUTOPILOT_BROKER_ACTIVE: "1" },
  };
  if (platform === "win32" && /\.(cmd|bat)$/i.test(claudeExecutable)) {
    // Node >=20.12 refuses to spawn .cmd/.bat without a shell (EINVAL,
    // CVE-2024-27980), and shell:true both quotes incorrectly and warns
    // (DEP0190) on newer Node. Invoke cmd.exe explicitly with verbatim
    // arguments and our own quoting. Known cmd limitation: %VAR% sequences
    // inside arguments are still expanded by cmd.
    const parts = [claudeExecutable, ...claudeArgs].map(
      (part) => `"${String(part).replaceAll('"', '""')}"`,
    );
    command = env.ComSpec ?? "cmd.exe";
    args = ["/d", "/s", "/c", `"${parts.join(" ")}"`];
    options.windowsVerbatimArguments = true;
  }
  const child = plainSpawner(command, args, options);
  const parkedSignal = () => {};
  process.on("SIGINT", parkedSignal);
  if (platform !== "win32") process.on("SIGQUIT", parkedSignal);
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        // A signal death must not read as success: report 128+n, the shell
        // convention (code is null in that case).
        if (signal) resolve(128 + (os.constants.signals[signal] ?? 1));
        else resolve(code ?? 0);
      });
    });
  } finally {
    process.off("SIGINT", parkedSignal);
    if (platform !== "win32") process.off("SIGQUIT", parkedSignal);
  }
}

export async function relayPlainSession({
  claudeExecutable,
  claudeArgs,
  cwd,
  input,
  output,
  errorOutput = process.stderr,
  // Test seams; production callers rely on the defaults.
  ptySpawner = PtySession.spawn,
  plainSpawner = spawn,
  platform = process.platform,
  env = process.env,
}) {
  let session;
  let relay;
  let outputSubscription;
  let resizeHandler;
  let rawModeChanged = false;
  const dimensions = terminalDimensions();
  try {
    session = ptySpawner(claudeExecutable, claudeArgs, {
      cwd,
      env: { ...env, EFFORT_AUTOPILOT_BROKER_ACTIVE: "1" },
      cols: dimensions.cols,
      rows: dimensions.rows,
    });
  } catch (error) {
    // node-pty itself cannot spawn (missing/unloadable binding, broken
    // spawn-helper): degrade to a directly attached child. Claude still
    // launches; only the broker's transport disappears.
    errorOutput.write(
      `Effort Autopilot: terminal transport unavailable (pty-spawn-failed: ${error.message}); Claude runs directly attached.\r\n`,
    );
    try {
      return await runInheritedChild({
        claudeExecutable,
        claudeArgs,
        cwd,
        plainSpawner,
        platform,
        env,
      });
    } catch (spawnError) {
      errorOutput.write(`Effort Autopilot: could not start Claude (${spawnError.message}).\r\n`);
      return 1;
    }
  }
  try {
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
