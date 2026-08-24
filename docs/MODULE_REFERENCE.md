# Module reference

## Product-path modules

| Path | Responsibility |
| --- | --- |
| [`src/core/effort-ladder.js`](../src/core/effort-ladder.js) | Canonical effort ladder (single source of truth): ordered levels, orchestration tiers, ordering/validation helpers, derived user-facing enumeration |
| [`src/core/host-effort-vocabulary.js`](../src/core/host-effort-vocabulary.js) | Per-host effort vocabulary as data: native levels plus tier→native mapping (Claude Code only today) |
| [`src/core/execution-plan.js`](../src/core/execution-plan.js) | Classifier result → host-adapter-ready pre-call plan with ceiling clamp and ultracode suppression |
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
| [`src/broker/turn-controller.js`](../src/broker/turn-controller.js) | User override precedence, fail-open causes, autopilot-wins uncertainty floor, acknowledgement, exact-once forwarding, prompt-free status |
| [`src/broker/hybrid-coordinator.js`](../src/broker/hybrid-coordinator.js) | First-hook block tickets, routing, replay arming, silent task-notification passthrough, session/model state incl. standing-manual tracking and post-applied level refresh |
| [`src/broker/replay-authorizations.js`](../src/broker/replay-authorizations.js) | Expiring session-bound prompt-digest authorizations, held only in memory and consumed once |
| [`src/broker/ipc.js`](../src/broker/ipc.js) | Random authenticated Windows named-pipe/Unix-socket bridge with bounded messages; short socket basenames with an explicit `sun_path` length guard and close-on-error after listen |
| [`src/broker/hook-client.js`](../src/broker/hook-client.js) | Claude hook JSON adapter and visible no-change fail-open warning |
| [`src/broker/pty-session.js`](../src/broker/pty-session.js) | ConPTY/PTY transport, effort acknowledgement normalization, exact replay; node-pty loads lazily inside `spawn` so binding failures surface in the guarded flow instead of at import time |
| [`src/broker/pty-preflight.js`](../src/broker/pty-preflight.js) | Best-effort startup repair of node-pty's `spawn-helper` execute permission (never throws; probes every loader candidate location) |
| [`src/broker/input-relay.js`](../src/broker/input-relay.js) | Byte-transparent stdin pause/resume during the routing window |
| [`src/broker/claude-args.js`](../src/broker/claude-args.js) | Positional scan of forwarded CLI arguments for `--settings`, `--effort`, resume, and print facts |
| [`src/broker/settings-merge.js`](../src/broker/settings-merge.js) | Additive hook merge into a user-provided `--settings` document; refuses shapes it cannot combine |
| [`src/broker/effort-baseline.js`](../src/broker/effort-baseline.js) | Local `effortLevel` read for the `--effort` spawn pin — makes the starting level known for the same-level skip (the pin does not scope persistence) |
| [`src/broker/session-observer.js`](../src/broker/session-observer.js) | Terminal acknowledgement watcher for manual `/effort` precedence and `/model` ambiguity marking |
| [`src/broker/session-policy.js`](../src/broker/session-policy.js) | `manual-wins`/`autopilot-wins` precedence policy, known-active-level tracking for the same-level skip, and standing-manual-choice mirroring for the uncertainty floor |
| [`src/broker/messages.js`](../src/broker/messages.js) | Prompt-language–localized status messages (English default, Spanish on clear evidence); cause codes stay untranslated |
| [`src/broker/install-paths.js`](../src/broker/install-paths.js) | Canonical per-platform install root, shim, config, and backup locations; every helper honors its `platform` parameter for path semantics too, so cross-platform simulations produce the target platform's exact separators |
| [`src/broker/project-config.js`](../src/broker/project-config.js) | Per-project `.effort-autopilot.json`, global install config, and the policy resolution chain |
| [`src/broker/claude-locator.js`](../src/broker/claude-locator.js) | Real-Claude resolution that skips the shim directory on every launch; candidate parsing follows the `platform` parameter (win32 vs posix path semantics) |
| [`src/installer/path-edit.js`](../src/installer/path-edit.js) | Pure, reversible PATH-entry and shell-profile-block transformations |
| [`src/installer/shim.js`](../src/installer/shim.js) | Windows `.cmd` and POSIX shell shim contents |
| [`src/installer/installer.js`](../src/installer/installer.js) | Consent-gated install/uninstall/status/policy with raw-registry PATH handling and backups |
| [`bin/effort-autopilot-cli.js`](../bin/effort-autopilot-cli.js) | Public installer CLI entrypoint (install, uninstall, status, policy, ml-setup) |
| [`src/broker/interactive.js`](../src/broker/interactive.js) | Interactive lifecycle: settings merge, session effort pin, real CLI PTY, local IPC, routing (chooses the autopilot-wins `high` uncertainty floor), observer wiring, passthrough fallback, fail-open on broker setup failure (`broker-setup-failed` → unchanged Claude with original args), spawn-helper preflight wiring, final directly-attached degradation when the PTY cannot spawn (`pty-spawn-failed`), crash cleanup |
| [`bin/internal-effort-autopilot-hook.js`](../bin/internal-effort-autopilot-hook.js) | Internal hook process used by the POC; not a package binary |
| [`bin/internal-interactive-broker.js`](../bin/internal-interactive-broker.js) | Internal interactive broker entrypoint used only by the isolated test shell |
| [`scripts/verify-hybrid-broker-no-inference.mjs`](../scripts/verify-hybrid-broker-no-inference.mjs) | Installed-CLI diagnostic with an independent always-block safety hook |
| [`bin/internal-zero-inference-guard-hook.js`](../bin/internal-zero-inference-guard-hook.js) | Standalone always-block guard hook for any experiment against the installed CLI (zero billable prompts) |
| [`scripts/start-isolated-test.ps1`](../scripts/start-isolated-test.ps1) | Opens a visible PowerShell with a reversible session-only `claude` shim |
| [`scripts/run-tests.mjs`](../scripts/run-tests.mjs) | Cross-platform explicit discovery of `*.test.js`, excluding interactive fixtures |
| [`src/gateway/request-transform.js`](../src/gateway/request-transform.js) | Synthetic Anthropic Messages effort-only transform and stream pass-through proof |

## Internal evaluation infrastructure (not product UX)

| Path | Responsibility |
| --- | --- |
| [`src/launcher/launch.js`](../src/launcher/launch.js) | Internal exactly-one runner invocation (planning itself lives in `src/core/execution-plan.js`) |
| [`src/adapters/claude-cli/runner.js`](../src/adapters/claude-cli/runner.js) | Internal `--print` benchmark transport |
| [`src/cli/main.js`](../src/cli/main.js) | Legacy internal launcher entry logic; not exported as npm bin |
| [`src/cli/args.js`](../src/cli/args.js) | Legacy launcher argument parsing and help text; validation lists derive from the canonical ladder |
| [`src/cli/pilot-main.js`](../src/cli/pilot-main.js) | Internal pilot runner CLI |
| [`bin/effort-autopilot.js`](../bin/effort-autopilot.js) | Internal direct script retained for tests/calibration only |
| [`bin/effort-autopilot-pilot.js`](../bin/effort-autopilot-pilot.js) | Internal pilot script, not packaged as a bin |
| [`src/evaluation/pilot.js`](../src/evaluation/pilot.js) | Benchmark pilot harness: manifest/task-prompt loading, workspace preparation, protected verifier execution, checkpointing |
| [`src/evaluation/calibration.js`](../src/evaluation/calibration.js) | Adaptive minimum-sufficient-effort search, resumable checkpoints, dataset export, honest baseline summary |
| [`scripts/calibrate.mjs`](../scripts/calibrate.mjs) | Calibration CLI (`npm run calibrate`); live mode double-gated behind `--live --confirm-subscription-use` |
| [`scripts/prepare-live-pilot.mjs`](../scripts/prepare-live-pilot.mjs) | Non-billable fixture preparation for the live pilot (`npm run pilot:prepare-live`) |
| [`scripts/recover-live-pilot.mjs`](../scripts/recover-live-pilot.mjs) | Verifier-backed recovery of a stopped live-pilot task without a new Claude call (`npm run pilot:recover-live`) |
| [`evaluation/`](../evaluation) | Public benchmark references/manifests, no private prompts |

## Packaging and experimental plugin

| Path | Responsibility |
| --- | --- |
| [`package.json`](../package.json) | Private (unpublished) scoped package; the installer CLI is the only bin mapping; explicit files whitelist |
| [`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json) | Manual-only historical skills; no automatic hook |
| [`skills/`](../skills) | Manual experimental effort skills, not the product |

## Development agent harness

| Path | Responsibility |
| --- | --- |
| [`AGENTS.md`](../AGENTS.md) | Provider-neutral project contract, skill routing, work gates, and delegation policy |
| [`CLAUDE.md`](../CLAUDE.md) | Claude Code entrypoint that imports the canonical `AGENTS.md` rules |
| [`GEMINI.md`](../GEMINI.md) | Gemini CLI entrypoint that imports the canonical `AGENTS.md` rules |
| [`agent-skills/`](../agent-skills) | Canonical reusable development guidance; separate from historical manual route skills |
| [`.agents/skills/`](../.agents/skills) | Generated Codex/open-standard indexes that redirect to canonical skills |
| [`.claude/skills/`](../.claude/skills) | Generated Claude Code indexes that redirect to canonical skills |
| [`.gemini/skills/`](../.gemini/skills) | Generated Gemini CLI indexes that redirect to canonical skills |
| [`agent-skills/skill-creator/`](../agent-skills/skill-creator) | Maintained skill structure, metadata rules, and template |
| [`agent-skills/skill-sync/scripts/sync.mjs`](../agent-skills/skill-sync/scripts/sync.mjs) | Cross-platform metadata validation, deterministic auto-invoke and provider-index generation, dry-run, and drift check |

## Tests

| Path | Responsibility |
| --- | --- |
| [`test/broker-turn.test.js`](../test/broker-turn.test.js) | Applied/unchanged outcomes, every fail-open cause, the uncertainty floor (applied, respected, met, clamped, unacknowledged), override precedence, timeout, exact-once, privacy |
| [`test/broker-pty.test.js`](../test/broker-pty.test.js) | Synthetic ConPTY command acknowledgement and forward ordering |
| [`test/hybrid-broker.test.js`](../test/hybrid-broker.test.js) | One-use replay, Unicode/multiline fidelity, repeats, sessions, races, cancellation, stale tokens, floor routing, standing-manual state, and agent-notification passthrough |
| [`test/broker-ipc.test.js`](../test/broker-ipc.test.js) | Token-authenticated local IPC, fail-open, prompt-free hook status, the `sun_path` endpoint-length guard, and close-on-error after listen |
| [`test/broker-setup-failopen.test.js`](../test/broker-setup-failopen.test.js) | Setup and PTY-spawn failures degrade to an unchanged Claude launch: original arguments, visible prompt-free causes, artifact cleanup, directly-attached fallback (ComSpec quoting, signal exit codes, async spawn errors), hard preconditions preserved |
| [`test/pty-preflight.test.js`](../test/pty-preflight.test.js) | Spawn-helper execute-bit repair: read-mirrored modes, every candidate location, never-throw contract (issue #26 regression guard) |
| [`test/broker-input-relay.test.js`](../test/broker-input-relay.test.js) | Routing pause with exact permission/paste/Unicode/cancellation byte preservation |
| [`test/broker-launch.test.js`](../test/broker-launch.test.js) | Launch-argument facts, additive `--settings` hook merge, and session effort baseline resolution |
| [`test/pty-effort-dialog.test.js`](../test/pty-effort-dialog.test.js) | Escalation-confirmation dialog handling and modal dismissal before fail-open reinjection |
| [`test/session-policy.test.js`](../test/session-policy.test.js) | `manual-wins`/`autopilot-wins` precedence, `/effort auto` handback, launch-flag latching, same-level skip, standing-manual mirroring |
| [`test/messages.test.js`](../test/messages.test.js) | Language detection defaults and untranslated cause codes in both catalogs |
| [`test/installer.test.js`](../test/installer.test.js) | Install paths, PATH/profile edits, shim contents, shim-skip selection, project/global config, policy chain; exact-equality platform-simulation assertions are the issue-#24 regression guard |
| [`test/ordinal-head.test.js`](../test/ordinal-head.test.js) | Artifact validation, probability sanity, tier monotonicity, synthetic training convergence and determinism |
| [`test/learned-classifier.test.js`](../test/learned-classifier.test.js) | Decision-contract fidelity, profile clamping, and the full deterministic fallback chain with fake embedders |
| [`test/calibration.test.js`](../test/calibration.test.js) | Adaptive search correctness, boundary repeats, resume idempotence, budget/limit stops, dataset export, baseline honesty |
| [`test/session-observer.test.js`](../test/session-observer.test.js) | Manual `/effort` and `/model` acknowledgement attribution, broker-window suppression, chunk splits |
| [`test/gateway-transform.test.js`](../test/gateway-transform.test.js) | Effort-only body mutation, exact model, failure modes, stream bytes, privacy |
| [`test/classifier.test.js`](../test/classifier.test.js) | Six tiers, boundaries, multilingual and model-aware regression |
| [`test/documentation.test.js`](../test/documentation.test.js) | Link/index/product-boundary synchronization |
| [`test/effort-ladder.test.js`](../test/effort-ladder.test.js) | Canonical ladder ordering/helpers, derived user-facing enumeration, host vocabulary mapping |
| [`test/packaging.test.js`](../test/packaging.test.js) | Tripwires: private/unpublished surface, npmignore exclusions, shipped imports resolve inside the tarball, single ladder definition, plugin/package version sync |
| [`test/agent-skills.test.js`](../test/agent-skills.test.js) | Development skill metadata, canonical instruction ownership, provider indexes and entrypoints, deterministic sync, dry-run, idempotence, and drift detection |
| Other `test/*.test.js` | Internal evaluation, packaging scaffolding, and regression coverage |
