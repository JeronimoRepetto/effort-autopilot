# Effort Autopilot — agent rules

Transparent effort broker for the Claude Code CLI: local zero-token classification chooses `/effort` per prompt via a hook + ConPTY broker. Read `docs/README.md` for the full map; `docs/PRODUCT.md` is the contract.

## Rule 1 — MANDATORY documentation discipline (two moments, both obligatory)

**A. Document immediately, ALWAYS.** The instant any change, improvement, feature, or fix is completed, update the affected documentation as part of that same work — never "later". Documentation is part of the change, not a follow-up task. This applies to every change with observable behavior, without exception.

**B. Pre-commit/pre-push audit gate — an OBLIGATORY safeguard.** Before ANY `git commit` or `git push` that includes code or behavior changes:

1. **Launch an audit subagent** (Explore/general-purpose) that reads `README.md` and **every** file under `docs/` and reports claims that are now stale, deprecated, or contradicted by the changes being committed — with file/line and what current reality says. Give it a precise checklist of what changed.
2. **Review the agent's findings yourself** — do not rubber-stamp them: verify each one, then apply the pertinent fixes (docs must describe only real, current behavior — no aspirational or leftover claims) and discard false positives with a stated reason.
3. **Run `npm test`** (documentation tests enforce links/index/product boundaries) and include the doc fixes **in the same commit** as the change they describe.

No commit or push of behavior changes is permitted without this gate. Doc-only or comment-only commits are exempt from step B (but not from accuracy).

History shows why this is a safeguard and not bureaucracy: phases repeatedly outran their documentation until an audit found 10 stale files, including safety claims stated backwards.

## Rule 2 — GitHub Issues are the single work registry

- Every proposal, improvement, or bug is filed as a GitHub issue (what, why, how, acceptance criteria) in `JeronimoRepetto/effort-autopilot` BEFORE any implementation. When the user floats an idea, file it — do not start building it unless they explicitly say so.
- Work happens on a feature branch referencing the issue; the PR closes it (`Closes #N`).
- Pending work and future intent live ONLY in issues — never as "TODO/roadmap" notes in `docs/` or `README.md`, which describe exclusively current shipped behavior (see Rule 1).

## Hard contract (never violate)

- Classification consumes zero model tokens and makes no network call; prompts are never persisted or logged.
- Exact model/provider never changed; prompt forwarded byte-for-byte, exactly once; no hidden retries.
- Fail-open on any doubt, always visibly reported with a prompt-free cause code.
- Explicit user effort wins under `manual-wins` (default policy).
- The user's Claude settings are never written (the CLI's own saved-default side effect is disclosed, accepted behavior).

## Billing and system-mutation gates

- NEVER invoke the installed `claude` for experiments without the zero-inference guard hook (`bin/internal-zero-inference-guard-hook.js`) in temporary `--settings`. Bare `claude <words>` submits a billable prompt (`claude config get` no longer exists).
- Anything live/billable (pilot, calibration `--live`) requires the user's explicit GO and the double flag `--live --confirm-subscription-use`.
- npm publication, PATH mutations outside the installer, and settings writes require explicit user authorization.
- File-verified on 2.1.238: `/effort low|medium|high|xhigh` persists the user's saved default on EVERY path; only `/effort max` is session-only. The `--effort` spawn pin does not scope anything.

## Verify before claiming done

```powershell
npm test                                      # full local suite, no Claude calls
npm run lint                                  # ESLint 10
npm run broker:poc:installed-zero-inference   # installed-CLI diagnostic, zero inference
```

Tripwire tests (`test/packaging.test.js`, `test/documentation.test.js`, `test/privacy.test.js`) intentionally hard-code product boundaries; crossing one is allowed only deliberately, updating test + docs in the same change with the rationale.

## Conventions

- Feature branches, imperative commit messages; `main` requires PRs except for the owner.
- Prettier + ESLint before committing. BOM-tolerant reads for any settings/JSON file a user might have written on Windows.
- Everything under `.effort-autopilot/` is local ignored state (checkpoints, workspaces, datasets) and must never be committed.
- Broker/user-facing status messages live in `src/broker/messages.js` (EN default, ES on clear prompt evidence; cause codes untranslated).
