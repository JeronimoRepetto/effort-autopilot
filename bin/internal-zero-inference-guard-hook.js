#!/usr/bin/env node

import { callBrokerIpc } from "../src/broker/ipc.js";

// Diagnostic-only safety hook. This file is never exposed as a package binary.
// It deliberately blocks every UserPromptSubmit event so installed-CLI terminal
// transport tests cannot reach model inference even if the broker IPC is down.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
  if (Buffer.byteLength(raw) > 1024 * 1024 + 16 * 1024) process.exit(2);
});
process.stdin.on("end", async () => {
  try {
    const input = JSON.parse(raw);
    if (input?.hook_event_name === "UserPromptSubmit") {
      try {
        await callBrokerIpc({
          endpoint: process.env.EFFORT_AUTOPILOT_IPC_ENDPOINT,
          token: process.env.EFFORT_AUTOPILOT_IPC_TOKEN,
          timeoutMs: 500,
          message: {
            event: "DiagnosticGuard",
            sessionId: input.session_id,
          },
        });
      } catch {
        // The independent block below is intentionally not conditional on IPC.
      }
      process.stdout.write(
        JSON.stringify({
          decision: "block",
          reason: "Zero-inference diagnostic guard blocked this submission.",
        }),
      );
    } else {
      process.stdout.write("{}");
    }
  } catch {
    process.exitCode = 2;
  }
});
