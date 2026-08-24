# Development agent harness

The repository includes a provider-neutral instruction and Agent Skills harness for contributors. It changes how coding agents discover project guidance; it is not part of the installed broker, prompt classification, effort application, or the historical Claude plugin scaffold.

## Instruction ownership

`AGENTS.md` is the canonical project guide for every coding-agent provider. It contains the product invariants that must always be visible, the work and documentation gates, the skill catalog, metadata-generated auto-invoke routing, and the delegation boundary.

`CLAUDE.md` and `GEMINI.md` are thin provider entrypoints that import `AGENTS.md` and add only provider-specific discovery notes. They must not become copies of the project contract. A policy change belongs in `AGENTS.md`; provider-only behavior belongs in the matching entrypoint.

The harness maintains all three committed instruction surfaces without installing symlinks, user configuration, custom subagent profiles, or runtime-host support.

## Canonical and generated skill surfaces

| Path | Responsibility |
| --- | --- |
| `agent-skills/` | Only editable source for development Agent Skill instructions |
| `.agents/skills/` | Generated Codex/open-standard discovery indexes |
| `.claude/skills/` | Generated Claude Code discovery indexes |
| `.gemini/skills/` | Generated Gemini CLI discovery indexes |
| `skills/route-*/` | Historical manual Claude plugin fixtures that represent six routing outcomes |

Every generated provider `SKILL.md` contains discovery metadata plus a link to its matching canonical `agent-skills/<name>/SKILL.md`; it does not duplicate the canonical instructions. The route skills remain manual-only and do not classify a prompt, apply effort automatically, or teach an agent how to modify the repository. The development synchronizer scans only canonical `agent-skills/*/SKILL.md` files.

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

`skills:sync` validates every canonical development skill, replaces only the block bounded by `<!-- skill-sync:start -->` and `<!-- skill-sync:end -->` in each registered instruction target, creates missing provider directories, and writes deterministic native-discovery indexes. Rows and provider indexes are sorted deterministically, and unrelated files under provider directories are left untouched.

`skills:check` performs the same validation without writing and exits nonzero when routing or any expected provider index has drifted. For review without mutation:

```powershell
node agent-skills/skill-sync/scripts/sync.mjs --dry-run
```

The Node implementation is shared by Windows and POSIX and does not require symlinks. Normal `npm test` includes metadata, parsing, deterministic rendering, dry-run, idempotence, canonical-instruction, provider-entrypoint, index-redirect, and drift tests.

## Loading and refreshing

The generated directories are committed, so a contributor does not run an installer after cloning or pulling. Start the coding agent at or below the repository root. Codex discovers `.agents/skills/`; Claude Code discovers `.claude/skills/`; Gemini CLI discovers `.gemini/skills/` and also recognizes `.agents/skills/`.

When a top-level provider directory is created after an agent session has already started, restart that session if the new skills do not appear. Gemini CLI can rescan with `/skills reload` and refresh `GEMINI.md` context with `/memory reload`. `npm run skills:sync` is a maintainer command for canonical skill changes, not an end-user installation step.

## Delegation boundary

The primary agent owns scope, synthesis, user authorization, and final verification. It may delegate bounded independent work, but a subagent cannot authorize live or billable execution, publication, settings writes, PATH mutation, or any exception to the product contract.

The independent documentation-staleness audit required before committing or pushing behavior changes remains mandatory. It is a review worker, not an approval authority; the primary agent verifies and resolves its findings.
