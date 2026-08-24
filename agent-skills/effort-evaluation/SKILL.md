---
name: effort-evaluation
description: >
  Works on calibration, learned-classifier datasets, dry-run pilots, recovery, and guarded live evaluation.
  Trigger: Evaluation tooling, datasets, calibration, pilot manifests, or any subscription-using experiment.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Changing calibration, pilots, datasets, or live evaluation tooling"
    - "Running any live or subscription-using evaluation"
---

## Required reading

Choose the current guide for the task: [calibration](../../docs/CALIBRATION.md), [pilot](../../docs/PILOT.md), [live readiness](../../docs/LIVE_PILOT_READINESS.md), or [internal Claude transport](../../docs/CLAUDE_TRANSPORT.md).

## Safety boundary

- Prefer deterministic, synthetic, dry-run, mocked, or recovery-only paths.
- Never invoke installed `claude`, start a live pilot, or run live calibration without the user's explicit GO.
- Live execution requires both `--live` and `--confirm-subscription-use`; no agent or issue grants that approval.
- Use `bin/internal-zero-inference-guard-hook.js` for installed-CLI diagnostics that must prove no inference.
- Preserve public-fixture provenance, budgets, limits, resumability, protected verifiers, and prompt isolation.
- Do not turn evaluation results into savings claims without the documented calibration evidence and release authorization.

## Decision tree

```text
Policy/unit behavior             → synthetic tests
Dataset or manifest preparation → dry-run only
Stopped task verification        → recovery path, no new Claude call
Installed CLI mechanics         → zero-inference guarded diagnostic
Model execution or calibration  → stop until explicit user GO
```

## Commands

```powershell
npm run internal:pilot:dry-run
npm run pilot:prepare-live
npm test
```
