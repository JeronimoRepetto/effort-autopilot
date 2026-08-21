# Documentation

This directory is the detailed reference for Effort Autopilot. The root [README](../README.md) states the beta status; installation is from a repository checkout via the reversible installer ([Installation](INSTALL.md)) while the npm package remains unpublished.

## Start here

| Document | Responsibility |
| --- | --- |
| [Product contract](PRODUCT.md) | Purpose, terminology, guarantees, non-guarantees, and current scope |
| [Installation](INSTALL.md) | Reversible global shim install, uninstall, status, precedence policy, and per-project control |
| [Release checklist](RELEASE_CHECKLIST.md) | Deliberate npm publication gates, tarball inspection, and post-publication verification |
| [Stock CLI feasibility](STOCK_HOST_FEASIBILITY.md) | Hybrid hook/ConPTY proof, gateway evidence, installed zero-inference result, and release gaps |
| [Isolated user test](ISOLATED_TEST.md) | Reversible first live trial using the normal `claude` command in a temporary PowerShell session |
| [Draft upstream proposal](UPSTREAM_CAPABILITY_PROPOSAL.md) | Local, unsubmitted same-turn hook proposal and engineering appendix |
| [Architecture](ARCHITECTURE.md) | Components, data flow, lifecycle, and trust boundaries |
| [Classifier](CLASSIFIER.md) | Deterministic policy, inputs, signals, scoring, confidence, and ultracode |
| [Internal legacy CLI](CLI.md) | Non-distributed one-shot interface retained only for tests/calibration |
| [Internal Claude transport](CLAUDE_TRANSPORT.md) | Benchmark-only `--print` invocation, authentication, usage, and errors |
| [Internal visible pilot](PILOT.md) | Evaluation manifests, checkpoints, results, limits, and isolation |
| [First live pilot readiness](LIVE_PILOT_READINESS.md) | Exact pinned five-task subset, local verifier checks, model inheritance, and confirmation boundary |
| [Plugin status](PLUGIN.md) | Why the bundled native plugin and skills are manual-only |
| [Security and privacy](SECURITY.md) | Data inventory, threat model, controls, and residual risks |
| [Development](DEVELOPMENT.md) | Install, upgrade, uninstall, tests, release checks, and contribution workflow |
| [Troubleshooting](TROUBLESHOOTING.md) | Common failures and safe recovery |
| [Module reference](MODULE_REFERENCE.md) | File-by-file responsibility map |
| [Host adapters](HOST_ADAPTERS.md) | Contract and checklist for a future Codex or other host adapter |
| [Historical adapter decision](ADAPTER_DECISION.md) | Rejected launcher decision retained for engineering provenance |
| [Calibration roadmap](CALIBRATION.md) | Empirical labels, benchmark data, ordinal models, and per-model calibration |

## Authority and synchronization

The implementation and automated tests are authoritative. The npm package remains private and unpublished; its only executable mapping is the reversible installer CLI (`effort-autopilot`), and publication follows the [release checklist](RELEASE_CHECKLIST.md). Internal launcher/pilot documents are contributor references, not end-user alternatives. Official Claude behavior can change independently; validate against the current release before distribution.
