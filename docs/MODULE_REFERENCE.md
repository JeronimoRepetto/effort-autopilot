# Module reference

## Product-path modules

| Path | Responsibility |
| --- | --- |
| [`src/core/policy.js`](../src/core/policy.js) | Hand-authored deterministic signals, weights, thresholds, uncertainty, and ultracode gate |
| [`src/core/classifier.js`](../src/core/classifier.js) | Host-neutral scoring, confidence, model/environment adjustment, explanations |
| [`src/core/model-profiles.js`](../src/core/model-profiles.js) | Exact versioned model capabilities and bootstrap offsets |
| [`src/core/protocol.js`](../src/core/protocol.js) | Safe host-neutral envelope and malformed-input fallback |
| [`src/core/environment.js`](../src/core/environment.js) | Bounded cheap local project metadata |
| [`src/core/ordinal-head.js`](../src/core/ordinal-head.js) | Proportional-odds ordinal head: artifact validation and microsecond pure-JS inference |
| [`src/core/ordinal-training.js`](../src/core/ordinal-training.js) | Dependency-free trainer with monotonic cutpoints (gradient descent, L2) |
| [`src/core/embedding-provider.js`](../src/core/embedding-provider.js) | Optional local multilingual embedding model (ONNX CPU) — the only seam touching `@huggingface/transformers` |
| [`src/core/learned-classifier.js`](../src/core/learned-classifier.js) | Learned classifier with the classifyEnvelope contract and deterministic fallback chain; installed-artifact loader |
| [`scripts/train-ordinal-head.mjs`](../scripts/train-ordinal-head.mjs) | CLI trainer (`npm run ml:train`) from JSONL features/prompts to a versioned artifact |
| [`src/broker/turn-controller.js`](../src/broker/turn-controller.js) | User override precedence, fail-open causes, acknowledgement, exact-once forwarding, prompt-free status |
| [`src/broker/hybrid-coordinator.js`](../src/broker/hybrid-coordinator.js) | First-hook block tickets, routing, replay arming, session/model state |
| [`src/broker/replay-authorizations.js`](../src/broker/replay-authorizations.js) | Expiring session-bound prompt-digest authorizations, held only in memory and consumed once |
| [`src/broker/ipc.js`](../src/broker/ipc.js) | Random authenticated Windows named-pipe/Unix-socket bridge with bounded messages |
| [`src/broker/hook-client.js`](../src/broker/hook-client.js) | Claude hook JSON adapter and visible no-change fail-open warning |
| [`src/broker/pty-session.js`](../src/broker/pty-session.js) | ConPTY/PTY transport, effort acknowledgement normalization, exact replay |
| [`src/broker/input-relay.js`](../src/broker/input-relay.js) | Byte-transparent stdin pause/resume during the routing window |
| [`src/broker/claude-args.js`](../src/broker/claude-args.js) | Positional scan of forwarded CLI arguments for `--settings`, `--effort`, resume, and print facts |
| [`src/broker/settings-merge.js`](../src/broker/settings-merge.js) | Additive hook merge into a user-provided `--settings` document; refuses shapes it cannot combine |
| [`src/broker/effort-baseline.js`](../src/broker/effort-baseline.js) | Local `effortLevel` read for the `--effort` spawn pin — makes the starting level known for the same-level skip (the pin does not scope persistence) |
| [`src/broker/session-observer.js`](../src/broker/session-observer.js) | Terminal acknowledgement watcher for manual `/effort` precedence and `/model` ambiguity marking |
| [`src/broker/session-policy.js`](../src/broker/session-policy.js) | `manual-wins`/`autopilot-wins` precedence policy and known-active-level tracking for the same-level skip |
| [`src/broker/messages.js`](../src/broker/messages.js) | Prompt-language–localized status messages (English default, Spanish on clear evidence); cause codes stay untranslated |
| [`src/broker/install-paths.js`](../src/broker/install-paths.js) | Canonical per-platform install root, shim, config, and backup locations |
| [`src/broker/project-config.js`](../src/broker/project-config.js) | Per-project `.effort-autopilot.json`, global install config, and the policy resolution chain |
| [`src/broker/claude-locator.js`](../src/broker/claude-locator.js) | Real-Claude resolution that skips the shim directory on every launch |
| [`src/installer/path-edit.js`](../src/installer/path-edit.js) | Pure, reversible PATH-entry and shell-profile-block transformations |
| [`src/installer/shim.js`](../src/installer/shim.js) | Windows `.cmd` and POSIX shell shim contents |
| [`src/installer/installer.js`](../src/installer/installer.js) | Consent-gated install/uninstall/status/policy with raw-registry PATH handling and backups |
| [`bin/effort-autopilot-cli.js`](../bin/effort-autopilot-cli.js) | Public installer CLI entrypoint (install, uninstall, status, policy, ml-setup) |
| [`src/broker/interactive.js`](../src/broker/interactive.js) | Interactive lifecycle: settings merge, session effort pin, real CLI PTY, local IPC, routing, observer wiring, passthrough fallback, crash cleanup |
| [`bin/internal-effort-autopilot-hook.js`](../bin/internal-effort-autopilot-hook.js) | Internal hook process used by the POC; not a package binary |
| [`bin/internal-interactive-broker.js`](../bin/internal-interactive-broker.js) | Internal interactive broker entrypoint used only by the isolated test shell |
| [`scripts/verify-hybrid-broker-no-inference.mjs`](../scripts/verify-hybrid-broker-no-inference.mjs) | Installed-CLI diagnostic with an independent always-block safety hook |
| [`scripts/start-isolated-test.ps1`](../scripts/start-isolated-test.ps1) | Opens a visible PowerShell with a reversible session-only `claude` shim |
| [`scripts/run-tests.mjs`](../scripts/run-tests.mjs) | Cross-platform explicit discovery of `*.test.js`, excluding interactive fixtures |
| [`src/gateway/request-transform.js`](../src/gateway/request-transform.js) | Synthetic Anthropic Messages effort-only transform and stream pass-through proof |

## Internal evaluation infrastructure (not product UX)

| Path | Responsibility |
| --- | --- |
| [`src/launcher/plan.js`](../src/launcher/plan.js) | Shared ceiling planning retained by benchmarks and mocks |
| [`src/launcher/launch.js`](../src/launcher/launch.js) | Internal exactly-one runner invocation |
| [`src/adapters/claude-cli/runner.js`](../src/adapters/claude-cli/runner.js) | Internal `--print` benchmark transport |
| [`src/cli/main.js`](../src/cli/main.js) | Legacy internal launcher entry logic; not exported as npm bin |
| [`src/cli/pilot-main.js`](../src/cli/pilot-main.js) | Internal pilot runner CLI |
| [`bin/effort-autopilot.js`](../bin/effort-autopilot.js) | Internal direct script retained for tests/calibration only |
| [`bin/effort-autopilot-pilot.js`](../bin/effort-autopilot-pilot.js) | Internal pilot script, not packaged as a bin |
| [`src/evaluation/calibration.js`](../src/evaluation/calibration.js) | Adaptive minimum-sufficient-effort search, resumable checkpoints, dataset export, honest baseline summary |
| [`scripts/calibrate.mjs`](../scripts/calibrate.mjs) | Calibration CLI (`npm run calibrate`); live mode double-gated behind `--live --confirm-subscription-use` |
| [`evaluation/`](../evaluation) | Public benchmark references/manifests, no private prompts |

## Packaging and experimental plugin

| Path | Responsibility |
| --- | --- |
| [`package.json`](../package.json) | Private (unpublished) scoped package; the installer CLI is the only bin mapping; explicit files whitelist |
| [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) | Manual-only historical skills; no automatic hook |
| [`skills/`](../skills) | Manual experimental effort skills, not the product |

## Tests

| Path | Responsibility |
| --- | --- |
| [`test/broker-turn.test.js`](../test/broker-turn.test.js) | Applied/unchanged outcomes, every fail-open cause, override precedence, timeout, exact-once, privacy |
| [`test/broker-pty.test.js`](../test/broker-pty.test.js) | Synthetic ConPTY command acknowledgement and forward ordering |
| [`test/hybrid-broker.test.js`](../test/hybrid-broker.test.js) | One-use replay, Unicode/multiline fidelity, repeats, sessions, races, cancellation, stale tokens |
| [`test/broker-ipc.test.js`](../test/broker-ipc.test.js) | Token-authenticated local IPC, fail-open, prompt-free hook status |
| [`test/broker-input-relay.test.js`](../test/broker-input-relay.test.js) | Routing pause with exact permission/paste/Unicode/cancellation byte preservation |
| [`test/broker-launch.test.js`](../test/broker-launch.test.js) | Launch-argument facts, additive `--settings` hook merge, and session effort baseline resolution |
| [`test/pty-effort-dialog.test.js`](../test/pty-effort-dialog.test.js) | Escalation-confirmation dialog handling and modal dismissal before fail-open reinjection |
| [`test/session-policy.test.js`](../test/session-policy.test.js) | `manual-wins`/`autopilot-wins` precedence, `/effort auto` handback, launch-flag latching, same-level skip |
| [`test/messages.test.js`](../test/messages.test.js) | Language detection defaults and untranslated cause codes in both catalogs |
| [`test/installer.test.js`](../test/installer.test.js) | Install paths, PATH/profile edits, shim contents, shim-skip selection, project/global config, policy chain |
| [`test/ordinal-head.test.js`](../test/ordinal-head.test.js) | Artifact validation, probability sanity, tier monotonicity, synthetic training convergence and determinism |
| [`test/learned-classifier.test.js`](../test/learned-classifier.test.js) | Decision-contract fidelity, profile clamping, and the full deterministic fallback chain with fake embedders |
| [`test/calibration.test.js`](../test/calibration.test.js) | Adaptive search correctness, boundary repeats, resume idempotence, budget/limit stops, dataset export, baseline honesty |
| [`test/session-observer.test.js`](../test/session-observer.test.js) | Manual `/effort` and `/model` acknowledgement attribution, broker-window suppression, chunk splits |
| [`test/gateway-transform.test.js`](../test/gateway-transform.test.js) | Effort-only body mutation, exact model, failure modes, stream bytes, privacy |
| [`test/classifier.test.js`](../test/classifier.test.js) | Six tiers, boundaries, multilingual and model-aware regression |
| [`test/documentation.test.js`](../test/documentation.test.js) | Link/index/product-boundary synchronization |
| Other `test/*.test.js` | Internal evaluation, packaging scaffolding, and regression coverage |
