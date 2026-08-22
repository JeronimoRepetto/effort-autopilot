# Agent rules — Effort Autopilot

All AI agents (any provider) working on this repository MUST follow the rules in [CLAUDE.md](CLAUDE.md). They are provider-agnostic despite the filename. Non-negotiables, in brief:

1. **Documentation discipline (Rule 1):** docs are updated as part of every behavior change, and a documentation-staleness audit + `npm test` gate precedes any commit/push of behavior changes.
2. **GitHub Issues are the single work registry (Rule 2):** proposals and pending work are filed as issues (what/why/how + acceptance criteria) before implementation; docs describe only current shipped behavior.
3. **Hard contract:** zero-token local classification, byte-for-byte prompt forwarding exactly once, fail-open with visible cause codes, user's Claude settings never written.
4. **Billing gates:** never invoke the installed `claude` without the zero-inference guard hook; anything billable requires the user's explicit GO.

Read `docs/README.md` for the repository map and `docs/PRODUCT.md` for the product contract.
