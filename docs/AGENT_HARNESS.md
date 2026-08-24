# Development agent harness

The repository includes a provider-neutral instruction and Agent Skills harness for contributors. It changes how coding agents discover project guidance; it is not part of the installed broker, prompt classification, effort application, or the historical Claude plugin scaffold.

## Instruction ownership

`AGENTS.md` is the canonical project guide for every coding-agent provider. It contains the product invariants that must always be visible, the work and documentation gates, the skill catalog, metadata-generated auto-invoke routing, and the delegation boundary.

`CLAUDE.md` is a Claude Code entrypoint that imports `AGENTS.md` and adds only Claude-specific discovery notes. It must not become a second copy of the project contract. A policy change belongs in `AGENTS.md`; provider-only behavior belongs in the provider entrypoint.

The harness currently maintains these two committed instruction surfaces. It does not install provider-specific symlinks, user configuration, custom subagent profiles, or runtime-host support.

## Two different skill sets

| Path | Responsibility |
| --- | --- |
| `agent-skills/` | Development guidance for agents working on this repository |
| `skills/route-*/` | Historical manual Claude plugin fixtures that represent six routing outcomes |

The route skills remain manual-only and do not classify a prompt, apply effort automatically, or teach an agent how to modify the repository. The development synchronizer scans only `agent-skills/*/SKILL.md`.

## Skill metadata

Each development skill follows the repository's maintained template:

```yaml
---
name: effort-example
description: >
  What the skill enables.
  Trigger: Specific work that should load it.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke: "Concrete action"
---
```

The folder and `name` must match. `auto_invoke` may be one string or a list. The current scope registry contains only `root`, mapped to `AGENTS.md`; a new scope requires a real scoped instruction file plus synchronizer and test coverage.

## Creating and synchronizing skills

Use [`skill-creator`](../agent-skills/skill-creator/SKILL.md) for structure and metadata, then [`skill-sync`](../agent-skills/skill-sync/SKILL.md) to update routing:

```powershell
npm run skills:sync
npm run skills:check
```

`skills:sync` validates every development skill and replaces only the block bounded by `<!-- skill-sync:start -->` and `<!-- skill-sync:end -->` in each registered target. Rows are sorted deterministically by action and skill.

`skills:check` performs the same validation without writing and exits nonzero when generated content has drifted. For review without mutation:

```powershell
node agent-skills/skill-sync/scripts/sync.mjs --dry-run
```

The Node implementation is shared by Windows and POSIX and does not require symlinks. Normal `npm test` includes metadata, parsing, deterministic rendering, dry-run, idempotence, canonical-instruction, and drift tests.

## Delegation boundary

The primary agent owns scope, synthesis, user authorization, and final verification. It may delegate bounded independent work, but a subagent cannot authorize live or billable execution, publication, settings writes, PATH mutation, or any exception to the product contract.

The independent documentation-staleness audit required before committing or pushing behavior changes remains mandatory. It is a review worker, not an approval authority; the primary agent verifies and resolves its findings.
