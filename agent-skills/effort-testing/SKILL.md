---
name: effort-testing
description: >
  Designs and runs Effort Autopilot tests that protect behavior, privacy, packaging, and exact-once guarantees.
  Trigger: Adding tests, fixing a bug, implementing behavior, or verifying a regression.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding or changing tests"
    - "Fixing a bug or implementing behavior"
---

## Test from the contract

Read the relevant product guide and inspect the source path with CodeGraph before choosing assertions. Prefer observable outcomes over implementation-shaped tests.

Every behavior change should cover the applicable invariants:

- zero-token local classification and no prompt persistence;
- byte-for-byte, exactly-once forwarding;
- acknowledgement before forwarding;
- explicit-user precedence and session state;
- visible prompt-free fail-open causes;
- exact model/provider preservation and no retry;
- packaging/import boundaries and reversible installation.

## Test selection

```text
Core policy/profile change  → classifier, effort-ladder, model-profile tests
Broker lifecycle change     → broker-turn, hybrid-broker, IPC, PTY tests
Installer/startup change    → installer, launch, setup-failopen tests
Docs/harness change         → documentation and agent-skills tests
Any observable behavior     → targeted tests, then npm test
```

Tripwires in `test/packaging.test.js`, `test/documentation.test.js`, and `test/privacy.test.js` encode deliberate boundaries. Update one only when the product decision changes and the rationale and documentation change with it.

## Commands

```powershell
node --test <targeted-test-files>
npm test
npm run lint
npm run format:check
```

Normal tests must not launch the installed Claude CLI or require network access.
