---
name: effort-broker
description: >
  Changes and reviews the hook, IPC, PTY, acknowledgement, replay, and session-routing path.
  Trigger: Broker lifecycle work or failures involving prompt forwarding, acknowledgement, or fail-open behavior.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Changing hooks, IPC, PTY, replay authorization, or session routing"
    - "Debugging prompt forwarding, acknowledgement, or fail-open behavior"
---

## Required reading

Read [the product sequence](../../docs/PRODUCT.md), [broker architecture](../../docs/ARCHITECTURE.md), and [security boundaries](../../docs/SECURITY.md). Use [the module reference](../../docs/MODULE_REFERENCE.md) to select the narrowest source and test files.

## Critical patterns

- Positively identify a top-level submission and block it before inference.
- Keep the exact prompt bytes in memory only. Never include prompt content in status, errors, logs, tickets after completion, or persisted artifacts.
- Apply effort before forwarding and require an exact host acknowledgement.
- Arm a session-bound, prompt-digest, one-use replay authorization; consume it once and reinject the original prompt once.
- On unsupported state, timeout, classification error, transport failure, or missing acknowledgement, preserve the active effort and fail open with a visible prompt-free cause.
- Preserve explicit user effort and exact model provenance. Do not add hidden retries or parser guesses for non-task UI.
- Keep user-facing broker text in `src/broker/messages.js`.

## Verification

Select targeted tests first, then run the full suite:

```powershell
node --test test/broker-turn.test.js test/hybrid-broker.test.js
node --test test/broker-ipc.test.js test/broker-input-relay.test.js
npm test
```

The installed-CLI diagnostic is not a normal test and must never be invoked without the repository's zero-inference guard rules.
