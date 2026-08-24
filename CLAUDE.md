# Claude Code entrypoint — Effort Autopilot

@AGENTS.md

`AGENTS.md` is the provider-neutral source of truth. The import above is intentional: do not duplicate its project contract, work registry, documentation gates, skill routing, or delegation policy here.

## Claude Code-specific notes

- Repository development skills live under `agent-skills/`. Load the matching `SKILL.md` when the `AGENTS.md` auto-invoke table applies.
- The six `skills/route-*` skills belong to the historical manual plugin scaffold. They do not implement automatic routing and must not be treated as development guidance.
- Never test the installed Claude Code CLI with a prompt unless the user has explicitly authorized subscription use and the applicable guard described in `AGENTS.md` is active.
