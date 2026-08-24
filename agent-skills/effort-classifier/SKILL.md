---
name: effort-classifier
description: >
  Changes Effort Autopilot's local classifier, effort policy, model profiles, confidence, and host vocabulary.
  Trigger: Classifier signals, tier boundaries, profile capabilities, uncertainty, or effort mapping work.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke: "Changing classifier policy, effort tiers, profiles, vocabularies, or confidence"
---

## Required reading

Read [the classifier guide](../../docs/CLASSIFIER.md), [product contract](../../docs/PRODUCT.md), and [host-adapter contract](../../docs/HOST_ADAPTERS.md) before changing policy or mappings.

## Critical patterns

- Classification is local and zero-token: no model call, network routing, RAG, prompt logging, or prompt persistence.
- Keep the canonical tier ladder in `src/core/effort-ladder.js`; do not duplicate it.
- Keep model capabilities in exact versioned profiles and host-native effort mappings in `host-effort-vocabulary.js`.
- Never change or substitute the provider/model to satisfy an effort recommendation.
- Apply the configured ceiling and supported-effort clamp before host execution.
- Treat ultracode as orchestration. Mapping an ultracode recommendation to a native effort fallback does not enable orchestration.
- Low-confidence and error behavior must remain aligned with `manual-wins`, `autopilot-wins`, and the documented uncertainty-floor exceptions.

## Verification

```powershell
node --test test/classifier.test.js test/effort-ladder.test.js
node --test test/model-profiles.test.js test/learned-classifier.test.js
npm test
```

Add boundary and regression cases for every policy change. A changed score without a documented behavioral reason is not sufficient evidence.
