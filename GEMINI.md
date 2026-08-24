# Gemini CLI entrypoint — Effort Autopilot

@./AGENTS.md

`AGENTS.md` is the provider-neutral source of truth. The import above is intentional: do not duplicate its project contract, work registry, documentation gates, skill routing, or delegation policy here.

## Gemini CLI-specific notes

- Gemini discovers generated skill indexes under `.gemini/skills/` and the shared `.agents/skills/` directory. Each index redirects to the matching canonical `agent-skills/*/SKILL.md`; edit only the canonical skill and run `npm run skills:sync`.
- The six `skills/route-*` skills belong to the historical manual Claude plugin scaffold. They do not implement automatic routing and must not be treated as development guidance.
- The development harness does not add a Gemini runtime adapter to the Effort Autopilot product.
