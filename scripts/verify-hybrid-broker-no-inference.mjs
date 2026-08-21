import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { HybridBrokerCoordinator } from "../src/broker/hybrid-coordinator.js";
import { createIpcIdentity, startBrokerIpcServer } from "../src/broker/ipc.js";
import { PtySession } from "../src/broker/pty-session.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookScript = path.join(root, "bin", "internal-effort-autopilot-hook.js");
const guardHookScript = path.join(root, "bin", "internal-zero-inference-guard-hook.js");
const prompt = "EFFORT_AUTOPILOT_ZERO_INFERENCE_REPLAY_TEST á ☕\nSECOND_LINE_保持_FIDELITY";
const claudeExecutable = process.env.EFFORT_AUTOPILOT_REAL_CLAUDE ?? (
  process.platform === "win32"
    ? execFileSync("where.exe", ["claude"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]
    : "claude"
);
const temporary = await mkdtemp(path.join(os.tmpdir(), "effort-autopilot-hybrid-"));
const settingsPath = path.join(temporary, "settings.json");
const quote = (value) => `"${value.replaceAll('"', '\\"')}"`;
const hookCommand = `${quote(process.execPath)} ${quote(hookScript)}`;
const guardHookCommand = `${quote(process.execPath)} ${quote(guardHookScript)}`;
await writeFile(settingsPath, JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: hookCommand, timeout: 5 }] }],
    UserPromptSubmit: [{ hooks: [
      { type: "command", command: hookCommand, timeout: 5 },
      { type: "command", command: guardHookCommand, timeout: 5 },
    ] }],
  },
}), { encoding: "utf8", mode: 0o600 });

const enterSequences = Object.freeze({
  cr: "\r",
  lf: "\n",
  crlf: "\r\n",
  "csi-u": "\u001b[13u",
  "csi-u-1": "\u001b[13;1u",
  "csi-u-cr": "\u001b[13u\r",
  "csi-u-twice": "\u001b[13u\u001b[13u",
});
const enterMode = process.env.EFFORT_AUTOPILOT_ENTER_MODE ?? "cr";
const enterSequence = enterSequences[enterMode];
if (!enterSequence) throw new Error(`unsupported diagnostic enter mode: ${enterMode}`);

const identity = createIpcIdentity();
const coordinator = new HybridBrokerCoordinator({ diagnosticBlockAuthorizedReplay: true });
let session;
let routingPromise = null;
let routeResult = null;
let firstTicket = null;
let authorizedReplayDecision = null;
let guardInvocations = 0;
let stage = "start";
let completed = false;
const server = await startBrokerIpcServer({
  ...identity,
  coordinator,
  onDecision: (decision) => {
    if (decision.authorizedReplay) authorizedReplayDecision = decision;
    if (decision.diagnosticGuard) guardInvocations += 1;
  },
  onBlocked: ({ ticketId }) => {
    if (firstTicket) return;
    firstTicket = ticketId;
    routingPromise = coordinator.routeTicket(ticketId, {
      classifier: () => ({
        status: "ok",
        decision: {
          tier: "max",
          confidence: 1,
          reasons: ["zero-inference diagnostic"],
          execution: { claudeEffort: "max" },
          context: { modelProfileId: coordinator.sessions.values().next().value?.model ?? null },
        },
      }),
      config: { ceiling: "max", baselineEffort: "max" },
      applyEffort: (effort) => session.applyEffort(effort),
      reinjectPrompt: (value) => session.forwardPrompt(value),
    }).then((result) => {
      routeResult = result;
      return result;
    });
  },
});

function waitUntil(predicate, timeoutMs = 10_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error("diagnostic-timeout"));
      setTimeout(poll, 25);
    };
    poll();
  });
}

try {
  stage = "spawn";
  session = PtySession.spawn(claudeExecutable, [
    "--effort",
    "max",
    "--settings",
    settingsPath,
  ], {
    cwd: root,
    env: {
      ...process.env,
      EFFORT_AUTOPILOT_IPC_ENDPOINT: identity.endpoint,
      EFFORT_AUTOPILOT_IPC_TOKEN: identity.token,
    },
    acknowledgementTimeoutMs: 5000,
    topLevelSubmitSequence: enterSequence,
  });
  stage = "session-start-hook";
  await waitUntil(() => coordinator.sessions.size === 1);
  stage = "top-level-prompt";
  await waitUntil(() => /\/effort|Try "how does/i.test(session.buffer));
  stage = "first-submission";
  await session.forwardPrompt(prompt);
  await waitUntil(() => Boolean(firstTicket));
  stage = "route-and-reinject";
  await routingPromise;
  stage = "diagnostic-second-block";
  await waitUntil(() => authorizedReplayDecision?.diagnostic === true && guardInvocations >= 2);

  const registered = coordinator.sessions.values().next().value;
  const summary = {
    exactModel: registered?.model ?? null,
    firstSubmissionBlocked: Boolean(firstTicket),
    effortAcknowledged: routeResult?.outcome === "applied" && routeResult?.appliedEffort === "max",
    replayReachedDiagnosticBlock: authorizedReplayDecision?.action === "block" &&
      authorizedReplayDecision?.diagnostic === true,
    multilineUnicodePromptFidelity: authorizedReplayDecision?.authorizedReplay === true,
    zeroInferenceGuardObserved: guardInvocations >= 2,
    enterMode,
    routeOutcome: routeResult?.outcome ?? null,
    routeCause: routeResult?.cause ?? null,
    requestedEffort: routeResult?.requestedEffort ?? null,
    appliedEffort: routeResult?.appliedEffort ?? null,
    pendingTickets: coordinator.pending.size,
    replayAuthorizations: coordinator.authorizations.size,
    modelPromptSubmitted: false,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  completed = true;
  session.write("/exit");
  await new Promise((resolve) => setTimeout(resolve, 25));
  session.write(enterSequence);
  await Promise.race([
    session.exitPromise,
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
} catch (error) {
  const safeTail = (session?.buffer ?? "")
    .slice(-4000)
    .replaceAll(prompt, "[synthetic-prompt-redacted]")
    .replaceAll(identity.token, "[ipc-token-redacted]");
  process.stderr.write(`stage=${stage} ${error?.stack ?? error}\n${safeTail}\n`);
  throw error;
} finally {
  session?.dispose();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}

// node-pty can retain a native ConPTY handle after the diagnostic child exits.
// All resources and temporary files are closed above, so terminate the isolated
// diagnostic process explicitly instead of leaving a background handle alive.
if (completed) process.exit(0);
