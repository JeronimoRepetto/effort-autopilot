---
name: effort-host-adapter
description: >
  Investigates or implements a runtime-host adapter without guessing unsupported pre-call controls.
  Trigger: Work on Claude Code, Codex, or another host's effort vocabulary, transport, capabilities, or execution contract.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke: "Investigating or implementing a runtime host adapter"
---

## Boundary

A coding assistant used to develop the repository is a harness provider. A runtime host is a product integration that must apply effort before the user's task reaches its model. Supporting one does not imply support for the other.

Read [the host-adapter contract](../../docs/HOST_ADAPTERS.md), [product contract](../../docs/PRODUCT.md), and the relevant open GitHub investigation before implementation.

## Evidence before code

- Verify current behavior against official host documentation and a local non-billable capability probe where possible.
- Record exact model preservation, pre-call effort control, authentication inheritance, private prompt transport, acknowledgement, session semantics, usage data, and failure behavior.
- If the host cannot meet the contract, report the limitation instead of mapping an undocumented field or adding a retry.
- Add a provider-specific skill only after the adapter or investigation establishes provider-specific patterns worth reusing.

## Adapter invariants

- Classification and ceiling resolution happen first.
- The prompt is supplied to the host exactly once through a private transport where available.
- Omit provider/model overrides by default; pass them only when explicitly requested.
- Normalize errors and metrics without prompt content.
- Use mocked transports for ordinary tests. Live or billable probes require the user's explicit GO and repository billing gates.

## Verification

```powershell
node --test test/launcher.test.js test/effort-ladder.test.js
npm test
```
