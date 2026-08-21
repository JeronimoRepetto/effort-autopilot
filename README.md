# Effort Autopilot

Effort Autopilot is being built as a transparent, globally installed broker in front of the real Claude Code CLI. The intended experience is still the normal interactive `claude` session: a top-level task is classified locally, the chosen effort is applied before inference, and the original task is forwarded once without changing provider, model, or session context.

> **Not installable as an end-user product yet.** The old one-shot launcher has been rejected and removed from npm/package UX. No `effort-autopilot` executable is currently published by this package, no shim replaces `claude`, and no user setting is changed. The existing `--print` transport survives only as internal benchmark/calibration infrastructure.

See the evidence-backed [CLI feasibility audit](docs/STOCK_HOST_FEASIBILITY.md). It now records a third, stronger CLI result:

- a pure PTY byte parser is unsafe because it cannot identify the active composer;
- `UserPromptSubmit` is an authoritative top-level semantic gate even though it cannot set effort itself;
- combining that hook with an authenticated in-memory broker and ConPTY can block, classify, acknowledge `/effort`, and authorize one exact replay before the sole model request.

## Current proof-of-concept state

- Claude Code 2.1.238 `/effort max` was verified without submitting a model prompt; the CLI acknowledged `Set effort level to max (this session only)`.
- A Windows ConPTY mock proves classifier → effort command → exact acknowledgement → unchanged prompt forwarded once → one synthetic request.
- An installed-CLI zero-inference diagnostic proved SessionStart model `claude-fable-5`, first-hook block, acknowledged `max`, one-time exact replay, consumed authorization, and a final independent safety block. No model turn occurred.
- A transport-free gateway mock proves exact-model preservation and an `output_config.effort`-only mutation before synthetic forwarding.
- The deterministic classifier remains local, dependency-light, non-AI, non-RAG, and model-aware.
- No live Claude proof, global install, PATH alias, settings mutation, credential access, commit, or push has occurred.

An isolated, reversible test shell is now available for the first live user trial. It shadows `claude` only inside one newly opened PowerShell window; closing that window restores normal command resolution. It does not change the machine PATH, Claude settings files, credentials, provider, or model. See [Isolated user test](docs/ISOLATED_TEST.md).

The hybrid is not visually silent: stock Claude Code deliberately renders a `UserPromptSubmit operation blocked by hook` notice and the original prompt before the broker replay. The hook API has no supported quiet-block flag (`suppressOutput` has no effect). This is an honest UX limitation, not a hidden model turn.

## Broker contract

The intended broker must guarantee:

- classification consumes zero model tokens and makes no network/model call;
- an explicit user effort choice always wins;
- supported automatic effort is positively acknowledged before the task is forwarded;
- the original task content is unchanged, held only in memory, and forwarded exactly once;
- provider and exact model are never changed;
- there is no hidden retry or preliminary inference;
- status/telemetry contains outcome, model, effort, and prompt-free reason codes only.

Default fail-open behavior is “no automatic change, one normal forward.” Unsupported/ambiguous model, low confidence, classifier failure/timeout, ambiguous terminal state, or missing acknowledgement visibly reports `outcome=unchanged` and uses Claude's already-active/default/user-selected effort. A later optional strict mode may pause, but that is not implemented.

Effort is a behavioral signal rather than a hard token cap, so no design can promise fewer billed tokens for every individual prompt.

## Local development (non-billable)

```powershell
Set-Location C:\Users\jeron\Desktop\effort-autopilot
npm install
npm test
npm run broker:poc:test
npm run broker:poc:installed-zero-inference
```

These commands run local tests only. The installed-CLI diagnostic starts Claude's interface but independently blocks the authorized replay before inference, so it does not use a model turn. Do not globally install this package while the broker remains experimental.

Internal benchmark tools and historical pilot data remain available to contributors, but they are not npm binaries or user-facing alternatives. See [Development](docs/DEVELOPMENT.md) and [Visible pilot](docs/PILOT.md).

## Documentation

The [documentation index](docs/README.md) links the [product contract](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [classifier](docs/CLASSIFIER.md), [CLI feasibility audit](docs/STOCK_HOST_FEASIBILITY.md), [draft upstream proposal](docs/UPSTREAM_CAPABILITY_PROPOSAL.md), [security](docs/SECURITY.md), [module map](docs/MODULE_REFERENCE.md), and internal evaluation/calibration references.

## License

MIT. See [LICENSE](LICENSE).
