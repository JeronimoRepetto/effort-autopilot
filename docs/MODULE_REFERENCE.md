# Module reference

## Product-path modules

| Path | Responsibility |
| --- | --- |
| [`src/core/policy.js`](../src/core/policy.js) | Hand-authored deterministic signals, weights, thresholds, uncertainty, and ultracode gate |
| [`src/core/classifier.js`](../src/core/classifier.js) | Host-neutral scoring, confidence, model/environment adjustment, explanations |
| [`src/core/model-profiles.js`](../src/core/model-profiles.js) | Exact versioned model capabilities and bootstrap offsets |
| [`src/core/protocol.js`](../src/core/protocol.js) | Safe host-neutral envelope and malformed-input fallback |
| [`src/core/environment.js`](../src/core/environment.js) | Bounded cheap local project metadata |
| [`src/broker/turn-controller.js`](../src/broker/turn-controller.js) | User override precedence, fail-open causes, acknowledgement, exact-once forwarding, prompt-free status |
| [`src/broker/hybrid-coordinator.js`](../src/broker/hybrid-coordinator.js) | First-hook block tickets, routing, replay arming, session/model state |
| [`src/broker/replay-authorizations.js`](../src/broker/replay-authorizations.js) | Expiring session-bound prompt-digest authorizations, held only in memory and consumed once |
| [`src/broker/ipc.js`](../src/broker/ipc.js) | Random authenticated Windows named-pipe/Unix-socket bridge with bounded messages |
| [`src/broker/hook-client.js`](../src/broker/hook-client.js) | Claude hook JSON adapter and visible no-change fail-open warning |
| [`src/broker/pty-session.js`](../src/broker/pty-session.js) | ConPTY/PTY transport, effort acknowledgement normalization, exact replay |
| [`src/broker/input-relay.js`](../src/broker/input-relay.js) | Byte-transparent stdin pause/resume during the routing window |
| [`src/broker/interactive.js`](../src/broker/interactive.js) | Interactive lifecycle: temporary hook settings, real CLI PTY, local IPC, routing, terminal relay, and cleanup |
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
| [`evaluation/`](../evaluation) | Public benchmark references/manifests, no private prompts |

## Packaging and experimental plugin

| Path | Responsibility |
| --- | --- |
| [`package.json`](../package.json) | Private package metadata; no public executable mappings |
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
| [`test/gateway-transform.test.js`](../test/gateway-transform.test.js) | Effort-only body mutation, exact model, failure modes, stream bytes, privacy |
| [`test/classifier.test.js`](../test/classifier.test.js) | Six tiers, boundaries, multilingual and model-aware regression |
| [`test/documentation.test.js`](../test/documentation.test.js) | Link/index/product-boundary synchronization |
| Other `test/*.test.js` | Internal evaluation, packaging scaffolding, and regression coverage |
