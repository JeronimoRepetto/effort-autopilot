---
name: skill-creator
description: >
  Creates or restructures reusable Effort Autopilot Agent Skills with scoped, progressively disclosed guidance.
  Trigger: Creating a new Agent Skill or changing an existing skill's structure or metadata.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke: "Creating a new Agent Skill"
---

## When to create a skill

Create a skill when a reusable project-specific pattern changes agent decisions, a fragile workflow needs deterministic guidance, or a decision tree prevents repeated rediscovery.

Do not create one for a one-off request, generic software advice, or content already maintained in project documentation. Link to the authoritative local guide instead.

## Structure

```text
agent-skills/{skill-name}/
├── SKILL.md
├── scripts/       optional deterministic helpers
├── references/    optional conditional detail
└── assets/        optional output templates or schemas
```

Create only resources the workflow uses. Keep `SKILL.md` concise: discovery in name/description, essential decisions in the body, and substantial conditional detail in references.

## Required frontmatter

```yaml
---
name: skill-name
description: >
  What the skill enables.
  Trigger: The specific work that should load it.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke: "Concrete action"
---
```

- Use lowercase letters, digits, and hyphens; the folder and `name` must match.
- Use `effort-<domain>` for product-specific skills and an action-oriented name for workflow skills.
- Keep `scope` to a target supported by `skill-sync`. Add a new scope only with a real scoped `AGENTS.md`.
- Make `auto_invoke` a discriminating action or list of actions, not a catch-all.
- Use only Effort Autopilot names, paths, license rules, author metadata, and real repository scopes.

## Workflow

1. Confirm the pattern is reusable and no existing skill owns it.
2. Use [the maintained template](assets/SKILL-TEMPLATE.md) to create the skill.
3. Reference local docs instead of duplicating them.
4. Run the sync skill and validators.
5. Review discovery text, links, authorization boundaries, and any helper scripts.

## Commands

```powershell
npm run skills:sync
npm run skills:check
npm test
```
