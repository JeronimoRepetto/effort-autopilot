import assert from "node:assert/strict";
import test from "node:test";

import { PtySession } from "../src/broker/pty-session.js";

// Scripted fake child: `script` maps received writes to emitted output.
function fakeChild(script) {
  let dataListener = null;
  const writes = [];
  return {
    writes,
    onData(listener) {
      dataListener = listener;
      return { dispose() { dataListener = null; } };
    },
    onExit() {
      return { dispose() {} };
    },
    write(data) {
      writes.push(data);
      const reply = script(data);
      if (reply) setImmediate(() => dataListener?.(reply));
    },
    kill() {},
  };
}

test("immediate acknowledgement resolves without touching the dialog path", async () => {
  const child = fakeChild((data) =>
    data === "/effort max\r" ? "⎿ Set effort level to max (this session only)\n" : null,
  );
  const session = new PtySession(child, { acknowledgementTimeoutMs: 300 });
  assert.deepEqual(
    await session.applyEffort("max"),
    // max is the only session-scoped level on 2.1.238 (file-verified).
    { acknowledged: true, effort: "max", viaDialog: false, persistsSavedDefault: false },
  );
  assert.deepEqual(child.writes, ["/effort max\r"]);
});

test("mid-conversation confirmation dialog is confirmed by the broker itself", async () => {
  const child = fakeChild((data) => {
    if (data === "/effort xhigh\r") {
      return "Change effort level?\nYour next response will be slower and use more tokens\n❯ 1. Yes, switch to xhigh\n2. No, go back\n";
    }
    if (data === "\r") return "● xhigh · /effort\n";
    return null;
  });
  const session = new PtySession(child, { acknowledgementTimeoutMs: 300 });
  // viaDialog surfaces upstream so the saved-default side effect is disclosed.
  assert.deepEqual(
    await session.applyEffort("xhigh"),
    { acknowledged: true, effort: "xhigh", viaDialog: true, persistsSavedDefault: true },
  );
  assert.deepEqual(child.writes, ["/effort xhigh\r", "\r"]);
});

test("an unconfirmed dialog is dismissed before failing open", async () => {
  const child = fakeChild((data) =>
    data === "/effort xhigh\r" ? "Change effort level?\n❯ 1. Yes, switch to xhigh\n" : null,
  );
  const session = new PtySession(child, { acknowledgementTimeoutMs: 150 });
  assert.deepEqual(await session.applyEffort("xhigh"), { acknowledged: false, effort: null });
  // /effort, confirmation attempt, then Esc so reinjection cannot type into a modal.
  assert.deepEqual(child.writes, ["/effort xhigh\r", "\r", ""]);
});

test("silence produces a dismissal Esc and a fail-open result", async () => {
  const child = fakeChild(() => null);
  const session = new PtySession(child, { acknowledgementTimeoutMs: 150 });
  assert.deepEqual(await session.applyEffort("high"), { acknowledged: false, effort: null });
  assert.deepEqual(child.writes, ["/effort high\r", ""]);
});
