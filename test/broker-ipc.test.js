import assert from "node:assert/strict";
import test from "node:test";

import { handleClaudeHookInput } from "../src/broker/hook-client.js";
import { HybridBrokerCoordinator } from "../src/broker/hybrid-coordinator.js";
import { callBrokerIpc, createIpcIdentity, startBrokerIpcServer } from "../src/broker/ipc.js";

test("authenticated local IPC carries hook events without prompt telemetry", async (t) => {
  const identity = createIpcIdentity();
  const coordinator = new HybridBrokerCoordinator();
  const tickets = [];
  const server = await startBrokerIpcServer({
    ...identity,
    coordinator,
    onBlocked: (event) => tickets.push(event),
  });
  t.after(() => server.close());

  const session = await callBrokerIpc({
    ...identity,
    message: {
      event: "SessionStart",
      sessionId: "ipc-session",
      model: "claude-sonnet-5",
      cwd: "C:\\work",
    },
  });
  assert.equal(session.exactModel, "claude-sonnet-5");

  const privatePrompt = "private IPC prompt ☕";
  const blocked = await callBrokerIpc({
    ...identity,
    message: {
      event: "UserPromptSubmit",
      sessionId: "ipc-session",
      prompt: privatePrompt,
      cwd: "C:\\work",
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(blocked.action, "block");
  assert.equal(tickets.length, 1);
  assert.deepEqual(Object.keys(tickets[0]), ["ticketId"]);
  assert.doesNotMatch(JSON.stringify(blocked), /private IPC prompt/i);
  coordinator.cancelTicket(blocked.ticketId);
});

test("wrong IPC token is rejected and hook-side IPC failure allows original prompt", async (t) => {
  const identity = createIpcIdentity();
  const coordinator = new HybridBrokerCoordinator();
  const server = await startBrokerIpcServer({ ...identity, coordinator });
  t.after(() => server.close());
  const unauthorized = await callBrokerIpc({
    endpoint: identity.endpoint,
    token: "wrong-token",
    message: { event: "SessionStart", sessionId: "x", model: "claude-sonnet-5" },
  });
  assert.deepEqual(unauthorized, { ok: false, errorCode: "unauthorized" });

  const hookOutput = await handleClaudeHookInput({
    hook_event_name: "UserPromptSubmit",
    session_id: "x",
    prompt: "must pass unchanged",
  }, {
    endpoint: identity.endpoint,
    token: "wrong-token",
  });
  assert.deepEqual(hookOutput, {
    systemMessage: "Effort Autopilot: automatic effort unchanged (broker unavailable).",
  });
});

test("hook client maps broker block and allow without echoing prompt", async () => {
  const input = {
    hook_event_name: "UserPromptSubmit",
    session_id: "session",
    cwd: "C:\\work",
    prompt: "private hook prompt",
  };
  const blocked = await handleClaudeHookInput(input, {
    endpoint: "synthetic",
    token: "synthetic",
    call: async () => ({ ok: true, action: "block", reason: "Routing locally." }),
  });
  const allowed = await handleClaudeHookInput(input, {
    endpoint: "synthetic",
    token: "synthetic",
    call: async () => ({ ok: true, action: "allow" }),
  });
  assert.deepEqual(blocked, { decision: "block", reason: "Routing locally." });
  assert.deepEqual(allowed, {});
  assert.doesNotMatch(JSON.stringify(blocked), /private hook prompt/i);
});

test("hook client surfaces prompt-free applied status on authorized replay", async () => {
  const output = await handleClaudeHookInput({
    hook_event_name: "UserPromptSubmit",
    session_id: "session",
    prompt: "private prompt",
  }, {
    endpoint: "synthetic",
    token: "synthetic",
    call: async () => ({
      ok: true,
      action: "allow",
      systemMessage: "Effort Autopilot: applied low for claude-fable-5.",
    }),
  });
  assert.deepEqual(output, {
    systemMessage: "Effort Autopilot: applied low for claude-fable-5.",
  });
  assert.doesNotMatch(JSON.stringify(output), /private prompt/i);
});
