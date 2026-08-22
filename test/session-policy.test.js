import assert from "node:assert/strict";
import test from "node:test";

import { HybridBrokerCoordinator } from "../src/broker/hybrid-coordinator.js";
import { SessionEffortPolicy } from "../src/broker/session-policy.js";

const SESSION = "session-policy";
const MODEL = "claude-sonnet-5";
const PROMPT = "tarea de prueba";

function setup({ autopilotWins = false, initialEffort = "high" } = {}) {
  const coordinator = new HybridBrokerCoordinator();
  coordinator.registerSession({ sessionId: SESSION, model: MODEL });
  const policy = new SessionEffortPolicy({ coordinator, autopilotWins, initialEffort });
  policy.handleSessionStart(SESSION);
  return { coordinator, policy };
}

test("manual-wins latches an observed manual effort and auto hands control back", () => {
  const { coordinator, policy } = setup();
  policy.handleUserEffort("low");
  const manual = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(manual.action, "allow");
  assert.equal(manual.explicitUserEffort, true);

  policy.handleUserEffort("auto");
  const reenabled = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(reenabled.action, "block");
  coordinator.cancelTicket(reenabled.ticketId);
});

test("autopilot-wins tracks the manual level but never latches precedence", () => {
  const { coordinator, policy } = setup({ autopilotWins: true });
  policy.handleUserEffort("low");
  // The manual choice is known as the active level (skip logic)…
  assert.equal(policy.shouldSkipApplication("low"), true);
  assert.equal(policy.shouldSkipApplication("xhigh"), false);
  // …but the next prompt still routes automatically.
  const routed = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
  assert.equal(routed.action, "block");
  assert.ok(routed.ticketId);
  coordinator.cancelTicket(routed.ticketId);
});

test("a launch --effort flag latches precedence only under manual-wins", () => {
  for (const autopilotWins of [false, true]) {
    const coordinator = new HybridBrokerCoordinator();
    coordinator.registerSession({ sessionId: SESSION, model: MODEL });
    const policy = new SessionEffortPolicy({ coordinator, autopilotWins, initialEffort: "max" });
    policy.handleSessionStart(SESSION, "max");
    const decision = coordinator.handleUserPromptSubmit({ sessionId: SESSION, prompt: PROMPT });
    if (autopilotWins) {
      assert.equal(decision.action, "block");
      coordinator.cancelTicket(decision.ticketId);
    } else {
      assert.equal(decision.action, "allow");
      assert.equal(decision.explicitUserEffort, true);
    }
  }
});

test("model changes mark the session ambiguous under both policies", () => {
  for (const autopilotWins of [false, true]) {
    const { coordinator, policy } = setup({ autopilotWins });
    policy.handleModelChange();
    assert.equal(coordinator.sessions.get(SESSION).modelReliable, false);
  }
});

test("same-level skip follows the pin, acknowledged applications, and auto", () => {
  const { policy } = setup({ initialEffort: "high" });
  assert.equal(policy.shouldSkipApplication("high"), true);
  policy.noteAcknowledgedApplication("xhigh");
  assert.equal(policy.shouldSkipApplication("xhigh"), true);
  assert.equal(policy.shouldSkipApplication("high"), false);
  policy.handleUserEffort("auto");
  // Unknown current level (auto): never skip.
  assert.equal(policy.shouldSkipApplication("xhigh"), false);
});

test("autopilot-wins mirrors manual choices as a standing session level", () => {
  const { coordinator, policy } = setup({ autopilotWins: true });
  policy.handleUserEffort("low");
  let session = coordinator.sessions.get(SESSION);
  assert.equal(session.activeEffort, "low");
  assert.equal(session.manualEffortStanding, true);
  assert.equal(session.explicitUserEffort, false);

  policy.handleUserEffort("auto");
  session = coordinator.sessions.get(SESSION);
  assert.equal(session.activeEffort, null);
  assert.equal(session.manualEffortStanding, false);
  assert.equal(session.explicitUserEffort, false);
});

test("session start seeds the known level; only a launch --effort flag stands", () => {
  for (const [launchEffort, expectedStanding] of [
    ["max", true],
    [null, false],
  ]) {
    const coordinator = new HybridBrokerCoordinator();
    coordinator.registerSession({ sessionId: SESSION, model: MODEL });
    const policy = new SessionEffortPolicy({
      coordinator,
      autopilotWins: true,
      initialEffort: launchEffort ?? "medium",
    });
    policy.handleSessionStart(SESSION, launchEffort);
    const session = coordinator.sessions.get(SESSION);
    assert.equal(session.activeEffort, launchEffort ?? "medium");
    assert.equal(session.manualEffortStanding, expectedStanding);
    assert.equal(session.explicitUserEffort, false);
  }
});

test("events before SessionStart are ignored instead of touching unknown sessions", () => {
  const coordinator = new HybridBrokerCoordinator();
  const policy = new SessionEffortPolicy({ coordinator, initialEffort: null });
  policy.handleUserEffort("low");
  policy.handleModelChange();
  assert.equal(coordinator.sessions.size, 0);
});
