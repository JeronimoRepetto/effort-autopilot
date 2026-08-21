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
    classifier: () => { events.push("classified"); return classification(); },
    config: { ceiling: "medium", baselineEffort: "medium" },
    applyEffort: async (effort) => {
      events.push(`ack:${effort}`);
      return { acknowledged: true, effort };
    },
    reinjectPrompt: async (prompt) => events.push(`reinject:${prompt}`),
  });
  assert.deepEqual(events, ["classified", "ack:medium", `reinject:${PROMPT}`]);
  assert.equal(routed.outcome, "applied");

  const replay = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.deepEqual(replay, {
    action: "allow",
    authorizedReplay: true,
    systemMessage: "Effort Autopilot: applied medium for claude-sonnet-5.",
  });
  const legitimateRepeat = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
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
  const wrongSession = coordinator.handleUserPromptSubmit({ sessionId: "session-b", prompt: PROMPT });
  assert.equal(wrongSession.action, "block");
  coordinator.cancelTicket(wrongSession.ticketId);
  assert.equal(
    coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT }).action,
    "allow",
  );
});

test("ambiguous model and explicit user effort both reinject unchanged", async () => {
  for (const scenario of ["ambiguous", "explicit"]) {
    const coordinator = registeredCoordinator();
    if (scenario === "ambiguous") coordinator.markModelAmbiguous(SESSION);
    else coordinator.updateUserEffort(SESSION, "high");
    const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
    let effortCalls = 0;
    const reinjected = [];
    const result = await coordinator.routeTicket(first.ticketId, {
      classifier: () => classification(),
      applyEffort: async () => { effortCalls += 1; return { acknowledged: true, effort: "medium" }; },
      reinjectPrompt: async (prompt) => reinjected.push(prompt),
    });
    assert.equal(effortCalls, 0);
    assert.deepEqual(reinjected, [PROMPT]);
    assert.equal(result.outcome, "unchanged");
    assert.equal(
      result.cause,
      scenario === "ambiguous" ? "unsupported-or-ambiguous-model" : "explicit-user-effort",
    );
  }
});

test("unacknowledged effort still arms exactly one unchanged replay", async () => {
  const coordinator = registeredCoordinator();
  const first = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  let reinjections = 0;
  const result = await coordinator.routeTicket(first.ticketId, {
    classifier: () => classification(),
    applyEffort: async () => ({ acknowledged: false }),
    reinjectPrompt: async () => { reinjections += 1; },
  });
  assert.equal(result.cause, "effort-not-acknowledged");
  assert.equal(reinjections, 1);
  const replay = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(replay.action, "allow");
  assert.match(replay.systemMessage, /automatic effort unchanged \(effort-not-acknowledged\)/);
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
  const other = coordinator.handleUserPromptSubmit({ sessionId: "session-b", prompt: "second task" });
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
    () => coordinator.routeTicket(failed.ticketId, {
      classifier: () => classification(),
      config: { ceiling: "medium", baselineEffort: "medium" },
      applyEffort: async (effort) => ({ acknowledged: true, effort }),
      reinjectPrompt: async () => { throw new Error("pty closed"); },
    }),
    /pty closed/,
  );
  assert.equal(coordinator.authorizations.size, 0);
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
