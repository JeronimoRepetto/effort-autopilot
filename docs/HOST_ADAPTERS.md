# Adding a host adapter

The shared core predicts a minimum sufficient tier; an adapter truthfully maps that plan to a host's documented pre-call controls. The per-host effort vocabulary layer already exists as data ([`src/core/host-effort-vocabulary.js`](../src/core/host-effort-vocabulary.js): ordered native levels plus tier→native mapping); only the Claude Code vocabulary ships today. A future Codex adapter is possible, but is not implemented.

## Required contract

A host adapter must:

1. accept the plan only after local classification and ceiling resolution;
2. apply effort before the task reaches the host model;
3. avoid a model/LLM routing call and avoid RAG;
4. launch at most one host execution unless a separate non-savings mode explicitly changes that contract;
5. have no silent retry path;
6. preserve provider and model by default, exposing only explicit pass-through overrides;
7. keep the prompt out of command arguments, logs, routing results, and checkpoints where the host permits;
8. distinguish unsupported effort, authentication/rate limits, transport errors, and task failures;
9. report actual usage/turn metrics when documented and available;
10. document what one host execution may do internally.

## Integration seam

Call `launchTask` with a host runner:

```javascript
const outcome = await launchTask({
  prompt,
  modelProfile,
  environment,
  config: { ceiling, baselineEffort },
  execution: { cwd, model },
  runner: executeHostTask,
});
```

The runner receives `{prompt, effort, ...execution}` exactly once. It should return normalized result and usage data or throw a typed, prompt-free error. If the host does not support the planned effort, fail before or during that one execution; do not hide a second attempt. Plan resolution itself (ceiling clamp, ultracode suppression, baseline fallback) lives in [`src/core/execution-plan.js`](../src/core/execution-plan.js); `launchTask` only invokes the runner exactly once.

## Capability profiles

Add a versioned profile provider only if it can obtain cheap, local, non-secret facts without a model call. Profile identity should include host, model family/version, caps, calibration dataset, and feature schema; the host's supported effort ladder itself lives in the separately versioned host effort vocabulary (`nativeLevels`), not in the model profile. Profile selection must never substitute a different model.

## Codex-specific checklist

Before implementation, verify current official Codex controls for pre-call effort, authentication inheritance, model preservation, one-shot execution, stdin or equivalent private input, session persistence, usage reporting, and rate limits. If any behavior is unavailable, state the limitation instead of mapping to an undocumented field.

Keep Codex transport code under a new `src/adapters/codex` directory and its CLI surface separate where semantics differ. Reuse `src/core` (planning lives in `src/core/execution-plan.js`; `src/launcher` holds only the internal exactly-one runner invocation and is excluded from the npm tarball, so packaged code must never import from it). Add the Codex effort vocabulary as a data entry in `src/core/host-effort-vocabulary.js`; do not add provider routing to the classifier.

## Tests for every adapter

Use a mocked transport to prove classification occurs first, applied effort is the resolved plan, the configured ceiling wins, model/provider are omitted by default and passed only explicitly, prompt transport is private, exactly one invocation occurs, execution failure is not retried, rate limits are typed, and metrics are normalized without prompt persistence.

