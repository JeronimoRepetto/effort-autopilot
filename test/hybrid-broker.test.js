import assert from "node:assert/strict";
import test from "node:test";

import { HybridBrokerCoordinator } from "../src/broker/hybrid-coordinator.js";
import { ReplayAuthorizations } from "../src/broker/replay-authorizations.js";

const SESSION = "session-a";
const MODEL = "claude-sonnet-5";
const PROMPT = "Añade la función café ☕.\nDespués verifica dos casos.";

function classification(effort = "medium", confidence = 0.8) {
  return {
    status: "ok",
    decision: {
      tier: effort,
      confidence,
      reasons: ["synthetic"],
      execution: { claudeEffort: effort },
      context: { modelProfileId: MODEL },
    },
  };
}

function registeredCoordinator(options) {
  const coordinator = new HybridBrokerCoordinator(options);
  coordinator.registerSession({ sessionId: SESSION, model: MODEL, cwd: "C:\\work" });
  return coordinator;
}

test("block, acknowledged effort, exact Unicode reinjection, and one-use allow", async () => {
  const coordinator = registeredCoordinator();
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(first.action, "block");
  assert.ok(first.ticketId);

  const events = [];
  const routed = await coordinator.routeTicket(first.ticketId, {
    classifier: () => {
      events.push("classified");
      return classification();
    },
    config: { ceiling: "medium", baselineEffort: "medium" },
    applyEffort: async (effort) => {
      events.push(`ack:${effort}`);
      // Mirrors the real transport: non-max levels persist the saved default.
      return { acknowledged: true, effort, persistsSavedDefault: effort !== "max" };
    },
    reinjectPrompt: async (prompt) => events.push(`reinject:${prompt}`),
  });
  assert.deepEqual(events, ["classified", "ack:medium", `reinject:${PROMPT}`]);
  assert.equal(routed.outcome, "applied");

  const replay = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  // The Spanish prompt selects the Spanish status catalog; non-max levels
  // disclose the CLI's saved-default side effect.
  assert.deepEqual(replay, {
    action: "allow",
    authorizedReplay: true,
    systemMessage:
      "Effort Autopilot: esfuerzo medium aplicado para claude-sonnet-5." +
      " El CLI también guardó este nivel como tu valor por defecto (comportamiento del CLI).",
  });
  const legitimateRepeat = coordinator.handleUserPromptSubmit({
    sessionId: SESSION,
    prompt: PROMPT,
  });
  assert.equal(legitimateRepeat.action, "block");
  assert.notEqual(legitimateRepeat.ticketId, first.ticketId);
  coordinator.cancelTicket(legitimateRepeat.ticketId);
});

test("authorization is bound to session identity", async () => {
  const coordinator = registeredCoordinator();
  coordinator.registerSession({ sessionId: "session-b", model: MODEL });
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification(),
    config: { ceiling: "medium", baselineEffort: "medium" },
    applyEffort: async (effort) => ({ acknowledged: true, effort }),
    reinjectPrompt: async () => {},
  });
  const wrongSession = coordinator.handleUserPromptSubmit({
    sessionId: "session-b",
    prompt: PROMPT,
  });
  assert.equal(wrongSession.action, "block");
  coordinator.cancelTicket(wrongSession.ticketId);
  assert.equal(
    coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT }).action,
    "allow",
  );
});

test("ambiguous model reinjects unchanged without an effort command", async () => {
  const coordinator = registeredCoordinator();
  coordinator.markModelAmbiguous(SESSION);
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  let effortCalls = 0;
  const reinjected = [];
  const result = await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification(),
    applyEffort: async () => {
      effortCalls += 1;
      return { acknowledged: true, effort: "medium" };
    },
    reinjectPrompt: async (prompt) => reinjected.push(prompt),
  });
  assert.equal(effortCalls, 0);
  assert.deepEqual(reinjected, [PROMPT]);
  assert.equal(result.outcome, "unchanged");
  assert.equal(result.cause, "unsupported-or-ambiguous-model");
});

test("explicit user effort allows the prompt directly without block or replay", () => {
  const coordinator = registeredCoordinator();
  coordinator.updateUserEffort(SESSION, "high");
  const decision = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(decision.action, "allow");
  assert.equal(decision.authorizedReplay, false);
  assert.equal(decision.explicitUserEffort, true);
  assert.match(decision.systemMessage, /elección manual de esfuerzo \(explicit-user-effort\)/);
  assert.equal(coordinator.pending.size, 0);
  assert.equal(coordinator.authorizations.size, 0);
});

test("user effort set after a block still wins during routing, and auto re-enables automation", async () => {
  const coordinator = registeredCoordinator();
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(first.action, "block");
  coordinator.updateUserEffort(SESSION, "high");
  let effortCalls = 0;
  const result = await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification(),
    applyEffort: async () => {
      effortCalls += 1;
      return { acknowledged: true, effort: "medium" };
    },
    reinjectPrompt: async () => {},
  });
  assert.equal(effortCalls, 0);
  assert.equal(result.cause, "explicit-user-effort");
  // Consume the replay authorization armed by the unchanged forward.
  assert.equal(
    coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT }).authorizedReplay,
    true,
  );

  assert.equal(coordinator.clearUserEffort(SESSION), true);
  const afterClear = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(afterClear.action, "block");
  assert.ok(afterClear.ticketId);
  coordinator.cancelTicket(afterClear.ticketId);
});

test("a persisting application discloses the saved-default side effect", async () => {
  const coordinator = registeredCoordinator();
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification(),
    config: { ceiling: "medium", baselineEffort: "medium" },
    applyEffort: async (effort) => ({ acknowledged: true, effort, viaDialog: true }),
    reinjectPrompt: async () => {},
  });
  const replay = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.match(
    replay.systemMessage,
    /esfuerzo medium aplicado para claude-sonnet-5\. El CLI también guardó este nivel como tu valor por defecto/,
  );
});

test("an unsupported session model is named in the prompt-free unchanged status", async () => {
  const coordinator = new HybridBrokerCoordinator();
  coordinator.registerSession({ sessionId: SESSION, model: "claude-futuro-9[1m]" });
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  const result = await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification(),
    applyEffort: async (effort) => ({ acknowledged: true, effort }),
    reinjectPrompt: async () => {},
  });
  assert.equal(result.cause, "unsupported-or-ambiguous-model");
  const replay = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(replay.action, "allow");
  assert.match(replay.systemMessage, /unsupported-or-ambiguous-model: claude-futuro-9\[1m\]/);
  assert.doesNotMatch(replay.systemMessage, /Añade/);
});

test("unacknowledged effort still arms exactly one unchanged replay", async () => {
  const coordinator = registeredCoordinator();
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  let reinjections = 0;
  const result = await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification(),
    applyEffort: async () => ({ acknowledged: false }),
    reinjectPrompt: async () => {
      reinjections += 1;
    },
  });
  assert.equal(result.cause, "effort-not-acknowledged");
  assert.equal(reinjections, 1);
  const replay = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(replay.action, "allow");
  assert.match(replay.systemMessage, /esfuerzo automático sin cambios \(effort-not-acknowledged\)/);
  assert.equal(coordinator.authorizations.size, 0);
});

test("diagnostic mode proves authorized replay without allowing inference", async () => {
  const coordinator = registeredCoordinator({ diagnosticBlockAuthorizedReplay: true });
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification(),
    config: { ceiling: "medium", baselineEffort: "medium" },
    applyEffort: async (effort) => ({ acknowledged: true, effort }),
    reinjectPrompt: async () => {},
  });
  const replay = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(replay.action, "block");
  assert.equal(replay.authorizedReplay, true);
  assert.equal(replay.diagnostic, true);
  assert.equal(coordinator.authorizations.size, 0);
});

test("routing race is bounded per session while another session remains independent", () => {
  const coordinator = registeredCoordinator();
  coordinator.registerSession({ sessionId: "session-b", model: MODEL });
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  const busy = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: "second task" });
  const other = coordinator.handleUserPromptSubmit({
    sessionId: "session-b",
    prompt: "second task",
  });
  assert.equal(busy.busy, true);
  assert.equal(busy.action, "block");
  assert.equal(other.action, "block");
  assert.ok(other.ticketId);
  coordinator.cancelTicket(first.ticketId);
  coordinator.cancelTicket(other.ticketId);
});

test("cancel and reinjection crash leave no replay authorization", async () => {
  const coordinator = registeredCoordinator();
  const cancelled = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(coordinator.cancelTicket(cancelled.ticketId), true);
  await assert.rejects(() => coordinator.routeTicket(cancelled.ticketId, {}), /stale-ticket/);

  const failed = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  await assert.rejects(
    () =>
      coordinator.routeTicket(failed.ticketId, {
        classifier: () => classification(),
        config: { ceiling: "medium", baselineEffort: "medium" },
        applyEffort: async (effort) => ({ acknowledged: true, effort }),
        reinjectPrompt: async () => {
          throw new Error("pty closed");
        },
      }),
    /pty closed/,
  );
  assert.equal(coordinator.authorizations.size, 0);
});

test("autopilot-wins floors an uncertain task at high and replays a distinct status", async () => {
  const coordinator = registeredCoordinator();
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  const applied = [];
  const result = await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification("low", 0.4),
    config: { ceiling: "max", baselineEffort: "medium" },
    uncertaintyFloorEffort: "high",
    applyEffort: async (effort) => {
      applied.push(effort);
      return { acknowledged: true, effort };
    },
    reinjectPrompt: async () => {},
  });
  assert.equal(result.outcome, "applied");
  assert.equal(result.cause, "uncertainty-floor-acknowledged");
  assert.deepEqual(applied, ["high"]);
  const replay = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(replay.action, "allow");
  assert.match(replay.systemMessage, /se fijó como mínimo en high para claude-sonnet-5/);
  assert.match(replay.systemMessage, /\(uncertainty-floor-acknowledged\)/);
  assert.doesNotMatch(replay.systemMessage, /Añade/);
});

test("a standing manual level survives an uncertain turn", async () => {
  const coordinator = registeredCoordinator();
  coordinator.noteSessionEffort(SESSION, "low", { manualStanding: true });
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  // A noted level never latches explicit precedence, so the prompt still routes.
  assert.equal(first.action, "block");
  let effortCalls = 0;
  const result = await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification("low", 0.4),
    config: { ceiling: "max", baselineEffort: "medium" },
    uncertaintyFloorEffort: "high",
    applyEffort: async (effort) => {
      effortCalls += 1;
      return { acknowledged: true, effort };
    },
    reinjectPrompt: async () => {},
  });
  assert.equal(effortCalls, 0);
  assert.equal(result.outcome, "unchanged");
  assert.equal(result.cause, "insufficient-confidence-manual-respected");
});

test("an applied turn refreshes the session's active effort and clears manual standing", async () => {
  const coordinator = registeredCoordinator();
  coordinator.noteSessionEffort(SESSION, "low", { manualStanding: true });
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification("xhigh", 0.9),
    config: { ceiling: "max", baselineEffort: "medium" },
    applyEffort: async (effort) => ({ acknowledged: true, effort }),
    reinjectPrompt: async () => {},
  });
  const session = coordinator.sessions.get(SESSION);
  assert.equal(session.activeEffort, "xhigh");
  assert.equal(session.manualEffortStanding, false);
  assert.equal(session.explicitUserEffort, false);
});

test("stale replay authorization expires without retaining prompt", () => {
  let now = 100;
  const store = new ReplayAuthorizations({ ttlMs: 10, now: () => now });
  store.arm(SESSION, PROMPT);
  assert.equal(store.size, 1);
  now = 111;
  assert.equal(store.consume(SESSION, PROMPT), null);
  assert.equal(store.size, 0);
  assert.doesNotMatch(JSON.stringify([...store.entries.values()]), /Añade/);
});
