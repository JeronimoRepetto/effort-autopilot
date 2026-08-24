---
name: skill-sync
description: >
  Synchronizes Agent Skill metadata into the generated AGENTS.md auto-invoke table and detects drift.
  Trigger: After changing a skill or when regenerating or checking AGENTS.md skill routing.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "After creating or modifying an Agent Skill"
    - "Regenerating or checking the AGENTS.md auto-invoke table"
---

## Purpose

The synchronizer reads `agent-skills/*/SKILL.md`, validates required metadata, groups `auto_invoke` actions by `scope`, and replaces only the marked generated block in the target `AGENTS.md`.

It is Node-based so Windows and POSIX use the same implementation. It does not create symlinks, touch user configuration, or scan the historical `skills/route-*` plugin fixtures.

## Metadata

`metadata.scope` is a list of registered instruction scopes. `metadata.auto_invoke` is a string or list of concrete actions. The current registered scope is:

| Scope | Target |
| --- | --- |
| `root` | `AGENTS.md` |

Add another scope only when a maintained scoped `AGENTS.md` exists and the synchronizer and tests map it explicitly.

## Workflow

1. Create or modify the skill with `skill-creator`.
2. Run `npm run skills:sync`.
3. Inspect the generated table and skill links.
4. Run `npm run skills:check` and `npm test`.

## Commands

```powershell
npm run skills:sync
node agent-skills/skill-sync/scripts/sync.mjs --dry-run
node agent-skills/skill-sync/scripts/sync.mjs --scope root
npm run skills:check
```

`--dry-run` prints candidate sections without writing. `--check` exits nonzero on metadata errors or generated-content drift.
