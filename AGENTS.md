# Effort Autopilot — agent guide

Effort Autopilot is a transparent broker for the stock Claude Code CLI. It classifies each positively identified top-level prompt locally, applies an acknowledged `/effort` level before inference, and forwards the original prompt exactly once without changing the model, provider, or session.

Before changing behavior, read [the product contract](docs/PRODUCT.md) and use [the documentation index](docs/README.md) to find the authoritative guide for the area. Implementation and tests are authoritative; documentation describes only current, shipped behavior.

## Available skills

Load the smallest relevant skill before working in its area. The historical `skills/route-*` entries are manual plugin regression fixtures, not development skills.

Canonical skill bodies live only under `agent-skills/`. The `.agents/skills/`, `.claude/skills/`, and `.gemini/skills/` trees are generated discovery indexes; never edit them directly. Run `npm run skills:sync` after changing a canonical skill.

| Skill | Use for |
| --- | --- |
| [`effort-autopilot`](agent-skills/effort-autopilot/SKILL.md) | Project overview, navigation, and cross-area planning |
| [`effort-broker`](agent-skills/effort-broker/SKILL.md) | Hook, IPC, PTY, acknowledgement, replay, and session routing |
| [`effort-classifier`](agent-skills/effort-classifier/SKILL.md) | Local policy, tiers, confidence, model profiles, and host vocabularies |
| [`effort-host-adapter`](agent-skills/effort-host-adapter/SKILL.md) | Evidence and contracts for Claude Code, Codex, or another runtime host |
| [`effort-installer`](agent-skills/effort-installer/SKILL.md) | Reversible shim installation, PATH handling, settings merge, and startup fallback |
| [`effort-evaluation`](agent-skills/effort-evaluation/SKILL.md) | Calibration, pilots, datasets, and subscription-use gates |
| [`effort-testing`](agent-skills/effort-testing/SKILL.md) | Test strategy, regressions, tripwires, and verification |
| [`effort-docs`](agent-skills/effort-docs/SKILL.md) | Documentation, staleness audits, release claims, and current-state discipline |
| [`skill-creator`](agent-skills/skill-creator/SKILL.md) | Creating or restructuring repository Agent Skills |
| [`skill-sync`](agent-skills/skill-sync/SKILL.md) | Regenerating and validating auto-invoke routing and provider discovery indexes |

<!-- skill-sync:start -->
### Auto-invoke skills

When performing these actions, load the corresponding skill first:

| Action | Skill |
| --- | --- |
| Adding or changing tests | `effort-testing` |
| After creating or modifying an Agent Skill | `skill-sync` |
| Changing calibration, pilots, datasets, or live evaluation tooling | `effort-evaluation` |
| Changing classifier policy, effort tiers, profiles, vocabularies, or confidence | `effort-classifier` |
| Changing hooks, IPC, PTY, replay authorization, or session routing | `effort-broker` |
| Changing installer, shim, PATH handling, startup preflight, or settings merge | `effort-installer` |
| Creating a new Agent Skill | `skill-creator` |
| Debugging prompt forwarding, acknowledgement, or fail-open behavior | `effort-broker` |
| Fixing a bug or implementing behavior | `effort-testing` |
| General Effort Autopilot development questions | `effort-autopilot` |
| Investigating or implementing a runtime host adapter | `effort-host-adapter` |
| Planning changes that span multiple project areas | `effort-autopilot` |
| Preparing a behavior change for commit or push | `effort-docs` |
| Regenerating or checking Agent Skill routing or provider indexes | `skill-sync` |
| Running any live or subscription-using evaluation | `effort-evaluation` |
| Writing or updating documentation | `effort-docs` |
<!-- skill-sync:end -->

## Non-negotiable product contract

- Classification consumes zero model tokens, makes no network call, and never persists or logs prompts.
- Preserve the exact model and provider. Forward the prompt byte-for-byte exactly once, with no hidden retry.
- Fail open on error with a visible prompt-free cause code. The documented `autopilot-wins` uncertainty floor is the only deliberate low-confidence exception.
- Explicit user effort wins under the default `manual-wins` policy.
- Never write the user's Claude settings. The CLI's own saved-default side effect is disclosed behavior, not permission for the broker to mutate settings.
- Ultracode is orchestration, not an effort level, and the broker never enables it.

## Work and documentation discipline

- GitHub Issues are the only work registry. File every proposal, bug, or improvement with what/why/how and acceptance criteria before implementation.
- Work on a feature branch that references the issue; the PR closes it. Future intent belongs in issues, never in product documentation.
- Update affected documentation in the same change as observable behavior.
- Before any commit or push containing code or behavior changes, launch a documentation-audit subagent to read `README.md` and every file under `docs/`, report stale claims with file/line evidence, personally review the findings, and apply valid corrections.

## Billing and mutation gates

- Never invoke the installed `claude` for an experiment without `bin/internal-zero-inference-guard-hook.js` in temporary `--settings`. A bare `claude <words>` can submit a billable prompt.
- Live pilots or calibration require the user's explicit GO and both `--live` and `--confirm-subscription-use`.
- npm publication, PATH changes outside the installer, and settings writes require explicit user authorization.
- The documented node-pty `spawn-helper` execute-bit repair is the only accepted dependency-tree mutation.

## Agent delegation

- The primary agent owns planning, scope, synthesis, and final verification.
- Delegate only bounded work that benefits from independent context or parallelism. Give each worker explicit files, expected output, and the non-negotiables that apply.
- Keep one writer per file set. Use read-only investigators for architecture, documentation audit, and test-failure triage when possible.
- A subagent cannot authorize live, billable, publishing, settings, or PATH actions. Those gates remain with the user and primary agent.
- The mandatory documentation audit must be independent of the implementation pass; review its evidence rather than accepting it automatically.

## Verification and conventions

```powershell
npm test
npm run lint
npm run skills:check
```

The installed-CLI diagnostic is separate from normal tests and must remain zero-inference guarded. Tripwires in `test/packaging.test.js`, `test/documentation.test.js`, and `test/privacy.test.js` deliberately encode product boundaries.

Use Node.js 20.11+, ES modules, Prettier, and ESLint. Keep host-neutral logic under `src/core`, product broker logic under `src/broker`, installer behavior under `src/installer`, and user-facing broker messages in `src/broker/messages.js`. Treat everything under `.effort-autopilot/` as ignored local state.
