---
name: skill-sync
description: >
  Synchronizes Agent Skill metadata into AGENTS.md and generated provider discovery indexes.
  Trigger: After changing a skill or when regenerating or checking skill routing and native indexes.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "After creating or modifying an Agent Skill"
    - "Regenerating or checking Agent Skill routing or provider indexes"
---

## Purpose

The synchronizer reads `agent-skills/*/SKILL.md`, validates required metadata, groups `auto_invoke` actions by `scope`, replaces only the marked generated block in the target `AGENTS.md`, and creates lightweight native-discovery indexes for every canonical skill.

It is Node-based so Windows and POSIX use the same implementation. It does not create symlinks, copy canonical instruction bodies, touch user configuration, or scan the historical `skills/route-*` plugin fixtures.

| Provider | Generated discovery root |
| --- | --- |
| Codex/open Agent Skills | `.agents/skills/` |
| Claude Code | `.claude/skills/` |
| Gemini CLI | `.gemini/skills/` |

Every generated `SKILL.md` preserves the canonical `name` and `description`, then redirects the agent to `agent-skills/<name>/SKILL.md`. Never edit a generated index directly.

## Metadata

`metadata.scope` is a list of registered instruction scopes. `metadata.auto_invoke` is a string or list of concrete actions. The current registered scope is:

| Scope | Target |
| --- | --- |
| `root` | `AGENTS.md` |

Add another scope only when a maintained scoped `AGENTS.md` exists and the synchronizer and tests map it explicitly.

## Workflow

1. Create or modify the skill with `skill-creator`.
2. Run `npm run skills:sync`.
3. Inspect the generated table and provider index links.
4. Run `npm run skills:check` and `npm test`.

## Commands

```powershell
npm run skills:sync
node agent-skills/skill-sync/scripts/sync.mjs --dry-run
node agent-skills/skill-sync/scripts/sync.mjs --scope root
npm run skills:check
```

`--dry-run` prints the candidate AGENTS section and provider indexes without writing. `--check` exits nonzero on metadata errors, routing drift, or missing/stale provider indexes.
