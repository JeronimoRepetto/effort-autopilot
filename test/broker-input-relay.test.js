import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { PtyInputRelay } from "../src/broker/input-relay.js";

test("input relay preserves permissions, Unicode, paste, and cancellation bytes", async () => {
  const input = new PassThrough();
  const forwarded = [];
  const relay = new PtyInputRelay({ input, write: (chunk) => forwarded.push(Buffer.from(chunk)) });
  relay.start();

  input.write(Buffer.from("y\r"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(Buffer.concat(forwarded).toString(), "y\r");

  relay.pauseForRouting();
  const held = Buffer.from("área\u001b[200~pegado\nmultilínea\u001b[201~\u0003", "utf8");
  input.write(held);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(Buffer.concat(forwarded).toString(), "y\r");

  relay.resumeAfterRouting();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Buffer.concat(forwarded), Buffer.concat([Buffer.from("y\r"), held]));
  relay.dispose();
});

test("input relay lifecycle calls are idempotent", () => {
  const input = new PassThrough();
  const relay = new PtyInputRelay({ input, write: () => {} });
  relay.start();
  relay.start();
  assert.equal(relay.pauseForRouting(), true);
  assert.equal(relay.pauseForRouting(), false);
  assert.equal(relay.resumeAfterRouting(), true);
  assert.equal(relay.resumeAfterRouting(), false);
  relay.dispose();
  relay.dispose();
});
