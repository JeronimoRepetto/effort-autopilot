---
name: effort-autopilot
description: >
  Navigates Effort Autopilot's product architecture and selects the authoritative project area.
  Trigger: General Effort Autopilot development questions or changes spanning multiple areas.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "General Effort Autopilot development questions"
    - "Planning changes that span multiple project areas"
---

## When to use

Use this skill to orient work, choose the relevant domain skill, or plan a change that crosses the broker, core, installer, evaluation, packaging, or documentation boundaries.

## Start with the contract

Read [the product contract](../../docs/PRODUCT.md) before proposing behavior. Use [the documentation index](../../docs/README.md) and [module reference](../../docs/MODULE_REFERENCE.md) to locate current implementation details.

The development harness guides contributors; it is not part of prompt classification or broker runtime behavior. Coding-assistant providers and Effort Autopilot runtime hosts are separate concepts.

## Routing

```text
Hook, IPC, PTY, replay, session state       → effort-broker
Scoring, confidence, profiles, vocabulary  → effort-classifier
New runtime host or host capability        → effort-host-adapter
Shim, PATH, settings, startup fallback     → effort-installer
Calibration, datasets, pilots              → effort-evaluation
Tests or behavior implementation           → effort-testing
Documentation or release claims            → effort-docs
```

For source relationships, use CodeGraph first when it is initialized. Do not reconstruct call paths with broad text searches when indexed symbol data is available.

## Commands

```powershell
npm test
npm run lint
npm run skills:check
```
