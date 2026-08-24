---
name: effort-docs
description: >
  Maintains current-state documentation and performs the mandatory staleness audit for behavior changes.
  Trigger: Writing documentation or preparing code or behavior changes for commit or push.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Writing or updating documentation"
    - "Preparing a behavior change for commit or push"
---

## Documentation model

Use [the documentation index](../../docs/README.md) to find the owner of each claim. Keep one authoritative explanation and link to it rather than copying details into multiple guides.

- Documentation describes implemented current behavior only.
- Proposals, pending work, and roadmaps belong in GitHub Issues.
- Update documentation immediately with every observable change.
- Keep the root README concise; detailed engineering behavior belongs under `docs/`.
- Update `docs/README.md` for every focused guide and `docs/MODULE_REFERENCE.md` for new maintained paths.

## Mandatory pre-commit/pre-push audit

For any commit or push containing code or behavior changes:

1. Launch an independent audit subagent with the exact change summary.
2. Require it to read `README.md` and every file under `docs/`.
3. Ask for stale or contradictory claims with file, line, and current evidence.
4. Personally verify every finding; apply valid fixes and explicitly reject false positives.
5. Run `npm test` and include documentation corrections in the same commit.

Do not delegate approval: the primary agent owns the final review. Doc-only or comment-only commits do not require the subagent gate, but they still require accuracy.

## Commands

```powershell
npm test
npm run lint
npm run skills:check
```
