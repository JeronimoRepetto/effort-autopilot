import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  const hookOutput = await handleClaudeHookInput(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "x",
      prompt: "must pass unchanged",
    },
    {
      endpoint: identity.endpoint,
      token: "wrong-token",
    },
  );
  assert.deepEqual(hookOutput, {
    systemMessage: "Effort Autopilot: automatic effort unchanged (broker unavailable).",
  });
});

// Regression tests for issue #18: on macOS the old UUID-based basename pushed
// the socket path past the 104-byte sun_path limit, bind() silently truncated
// it, and the later chmod failed ENOENT while the listening handle leaked and
// hung the test runner forever.
test("POSIX IPC endpoint stays under the macOS sun_path limit", () => {
  // macOS per-user $TMPDIR shape: /var/folders/xx/<30 random chars>/T
  const macTmpdir = `/var/folders/nw/${"a".repeat(30)}/T`;
  const identity = createIpcIdentity({ platform: "darwin", tmpdir: macTmpdir, pid: 999999 });
  assert.ok(identity.endpoint.startsWith(macTmpdir));
  assert.match(identity.endpoint, /\/ea-999999-[0-9a-f]{8}\.sock$/);
  assert.ok(
    Buffer.byteLength(identity.endpoint) <= 103,
    `${identity.endpoint} is ${Buffer.byteLength(identity.endpoint)} bytes`,
  );
});

test("an over-long POSIX endpoint fails with a clear cause instead of silently truncating", async () => {
  await assert.rejects(
    startBrokerIpcServer({
      endpoint: `/tmp/${"x".repeat(120)}.sock`,
      token: "token",
      coordinator: new HybridBrokerCoordinator(),
      platform: "darwin",
      fsOps: {
        chmod: async () => {},
        rm: async () => {},
      },
    }),
    /ipc-endpoint-too-long/,
  );
});

test("a post-listen setup failure closes the listening server instead of leaking it", async (t) => {
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\ea-test-${process.pid}-${randomUUID()}`
      : path.join(os.tmpdir(), `ea-test-${process.pid}.sock`);
  if (process.platform !== "win32") t.after(() => rm(endpoint, { force: true }));
  const removed = [];
  await assert.rejects(
    startBrokerIpcServer({
      endpoint,
      token: "token",
      coordinator: new HybridBrokerCoordinator(),
      platform: "linux",
      fsOps: {
        chmod: async () => {
          throw new Error("chmod-denied");
        },
        rm: async (target) => {
          removed.push(target);
        },
      },
    }),
    /chmod-denied/,
  );
  assert.ok(removed.includes(endpoint));
  // The listening handle is gone: a fresh connection must fail, and the test
  // runner exiting at all (instead of hanging on the leaked server) is the
  // regression proof for the macOS hang.
  await assert.rejects(
    callBrokerIpc({
      endpoint,
      token: "token",
      message: { event: "DiagnosticGuard" },
      timeoutMs: 500,
    }),
  );
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
  const output = await handleClaudeHookInput(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "session",
      prompt: "private prompt",
    },
    {
      endpoint: "synthetic",
      token: "synthetic",
      call: async () => ({
        ok: true,
        action: "allow",
        systemMessage: "Effort Autopilot: applied low for claude-fable-5.",
      }),
    },
  );
  assert.deepEqual(output, {
    systemMessage: "Effort Autopilot: applied low for claude-fable-5.",
  });
  assert.doesNotMatch(JSON.stringify(output), /private prompt/i);
});
