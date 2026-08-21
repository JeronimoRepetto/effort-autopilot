#!/usr/bin/env node
import process from "node:process";

import { handleClaudeHookInput } from "../src/broker/hook-client.js";

const MAX_BYTES = 1024 * 1024 + 16 * 1024;
let raw = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  raw = Buffer.concat([raw, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  if (raw.length > MAX_BYTES) {
    process.stdout.write("{}\n");
    process.exit(0);
  }
}

let input;
try {
  input = JSON.parse(raw.toString("utf8"));
} catch {
  process.stdout.write("{}\n");
  process.exit(0);
}

const output = await handleClaudeHookInput(input, {
  endpoint: process.env.EFFORT_AUTOPILOT_IPC_ENDPOINT,
  token: process.env.EFFORT_AUTOPILOT_IPC_TOKEN,
});
process.stdout.write(`${JSON.stringify(output)}\n`);
