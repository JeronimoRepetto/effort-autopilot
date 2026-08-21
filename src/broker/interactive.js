import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { classifyEnvelope } from "../core/protocol.js";
import { HybridBrokerCoordinator } from "./hybrid-coordinator.js";
import { createIpcIdentity, startBrokerIpcServer } from "./ipc.js";
import { PtyInputRelay } from "./input-relay.js";
import { PtySession } from "./pty-session.js";

function quoteCommandPart(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function findClaudeExecutable() {
  if (process.env.EFFORT_AUTOPILOT_REAL_CLAUDE) {
    return process.env.EFFORT_AUTOPILOT_REAL_CLAUDE;
  }
  if (process.platform !== "win32") return "claude";
  const matches = execFileSync("where.exe", ["claude"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  if (matches.length === 0) throw new Error("Claude Code CLI was not found");
  return matches[0];
}

function terminalDimensions() {
  return {
    cols: Number.isInteger(process.stdout.columns) ? process.stdout.columns : 100,
    rows: Number.isInteger(process.stdout.rows) ? process.stdout.rows : 30,
  };
}

export async function runInteractiveBroker({
  claudeArgs = process.argv.slice(2),
  cwd = process.cwd(),
  claudeExecutable = findClaudeExecutable(),
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("the interactive broker requires a terminal");
  }
  if (claudeArgs.includes("--settings")) {
    throw new Error("isolated test mode does not yet combine an explicit --settings argument");
  }

  const root = path.resolve(import.meta.dirname, "..", "..");
  const hookScript = path.join(root, "bin", "internal-effort-autopilot-hook.js");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "effort-autopilot-session-"));
  const settingsPath = path.join(temporary, "settings.json");
  const identity = createIpcIdentity();
  const coordinator = new HybridBrokerCoordinator();
  const hookCommand = `${quoteCommandPart(process.execPath)} ${quoteCommandPart(hookScript)}`;
  await writeFile(settingsPath, JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: hookCommand, timeout: 5 }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: hookCommand, timeout: 5 }] }],
    },
  }), { encoding: "utf8", mode: 0o600 });

  let session;
  let relay;
  let outputSubscription;
  let resizeHandler;
  let rawModeChanged = false;
  const activeRoutes = new Set();
  const server = await startBrokerIpcServer({
    ...identity,
    coordinator,
    onBlocked: ({ ticketId }) => {
      relay?.pauseForRouting();
      const route = coordinator.routeTicket(ticketId, {
        classifier: classifyEnvelope,
        config: { ceiling: "max", baselineEffort: "medium" },
        applyEffort: (effort) => session.applyEffort(effort),
        reinjectPrompt: (prompt) => session.forwardPrompt(prompt),
      }).catch((error) => {
        errorOutput.write(`\r\nEffort Autopilot could not route this turn: ${error.message}\r\n`);
      }).finally(() => {
        activeRoutes.delete(route);
        relay?.resumeAfterRouting();
      });
      activeRoutes.add(route);
    },
  });

  try {
    const dimensions = terminalDimensions();
    session = PtySession.spawn(claudeExecutable, [
      ...claudeArgs,
      "--settings",
      settingsPath,
    ], {
      cwd,
      env: {
        ...process.env,
        EFFORT_AUTOPILOT_IPC_ENDPOINT: identity.endpoint,
        EFFORT_AUTOPILOT_IPC_TOKEN: identity.token,
      },
      cols: dimensions.cols,
      rows: dimensions.rows,
      acknowledgementTimeoutMs: 5000,
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
    await Promise.allSettled([...activeRoutes]);
    await server.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
