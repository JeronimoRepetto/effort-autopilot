# Development and operations

## Local setup only

Requirements: Node.js 20+. Claude Code 2.1.238 was used for the non-inference command audit, but normal tests do not launch it.

```powershell
Set-Location <path-to-your-clone>\effort-autopilot
npm install
npm test
npm run broker:poc:test
npm run skills:check
```

Line endings are pinned by `.gitattributes` (LF for source/docs, CRLF only for PowerShell), so checkouts match Prettier's `endOfLine: "lf"` on every platform regardless of `core.autocrlf` — `npm run format:check` passes on a fresh clone.

npm's `package-lock.json` is this repo's canonical lockfile — do not commit other managers' lockfiles or workspace artifacts (they are git-ignored). Running the checkout with pnpm works (verified 2026-08-23: the full suite runs under pnpm v11), with one known macOS caveat — pnpm can drop the execute bit on node-pty's prebuilt `spawn-helper` (`posix_spawnp failed`). The broker repairs it automatically at launch; running `npm test` before any launch still needs the one-line fix in [Troubleshooting](TROUBLESHOOTING.md).

`node-pty` 1.1.0 supplies Windows ConPTY and Unix PTY bindings for the broker. It is MIT licensed. The package is marked `private` (unpublished) and exposes exactly one executable: the reversible installer CLI (`effort-autopilot` → `bin/effort-autopilot-cli.js`, see [Installation](INSTALL.md)). No script permanently replaces or renames the real `claude` executable; publication requires the [release checklist](RELEASE_CHECKLIST.md).

## Internal evaluation tools

The rejected one-shot launcher and historical pilot survive only for calibration/regression:

```powershell
npm run internal:classify < .\synthetic-task.txt
npm run internal:pilot:dry-run
npm run pilot:prepare-live
```

They are not public product commands or fallback UX. `pilot:prepare-live` only prepares public fixtures. Do not run a live pilot or the legacy launcher against a real task without explicit subscription-use authorization.

## Tests

```powershell
npm test
npm run broker:poc:test
```

The suite covers classifier tiers/boundaries, multilingual features, model profiles, malformed input, privacy, broker acknowledgement/order, user override precedence, every fail-open cause, the autopilot-wins uncertainty floor, exact-once forwarding, synthetic ConPTY, gateway effort-only mutation/streaming, the canonical effort ladder and host vocabulary mapping, development Agent Skill metadata and synchronization, packaging tripwires (shipped imports resolve inside the npm tarball, single ladder definition, plugin/package version sync), broker-startup fail-open with the IPC endpoint length guard, platform-exact path derivation in the install/locator helpers, the spawn-helper execute-bit preflight with the directly-attached PTY fallback, and internal benchmark regressions.

Plugin validation is optional historical scaffolding and does not prove broker behavior:

```powershell
claude plugin validate .
claude plugin validate .\skills
```

## Safe zero-inference installed-CLI check

The guarded hybrid diagnostic is intentionally excluded from `npm test` because it opens the installed authenticated CLI and may create ordinary local session metadata. It creates temporary hook settings, adds an independent always-block UserPromptSubmit hook, runs the full block/ack/replay/second-block sequence, removes the temporary files, and exits:

```powershell
npm run broker:poc:installed-zero-inference
```

On Windows the script uses bracketed paste plus a bounded 500 ms settle window. It must report `modelPromptSubmitted: false`, `firstSubmissionBlocked: true`, `effortAcknowledged: true`, `replayReachedDiagnosticBlock: true`, `multilineUnicodePromptFidelity: true`, and zero pending authorizations. This is a diagnostic command, not an end-user entrypoint.

## Reversible interactive test

After the zero-inference diagnostic is green, `scripts/start-isolated-test.ps1` may open a separate PowerShell whose session-local PATH maps `claude` to the internal interactive broker. Closing that window restores the ordinary command. See [Isolated user test](ISOLATED_TEST.md). For a persistent setup, the reversible installer is documented in [Installation](INSTALL.md); the npm package itself remains private and unpublished.

## Change workflow

Repository agents use [`AGENTS.md`](../AGENTS.md) as their provider-neutral source of truth. Claude Code enters through [`CLAUDE.md`](../CLAUDE.md), which imports the canonical guide. Development skills and their metadata workflow are documented in [Development agent harness](AGENT_HARNESS.md).

1. Keep host-neutral logic under `src/core`.
2. Keep product broker logic under `src/broker`, the guarded proof under `scripts`, and gateway research under `src/gateway`.
3. Keep `src/launcher`, `src/adapters/claude-cli`, legacy `src/cli`, and pilot bins internal-only. Packaged code (`src/broker`, `src/core`, `src/installer`, the shipped `bin/` entrypoints) must never import from those internal directories — they are excluded from the npm tarball, and `test/packaging.test.js` enforces that every shipped import resolves inside it (regression guard for issue #13).
4. The only permitted persistent install surface is the reversible installer (`bin/effort-autopilot-cli.js` + `src/installer/`): explicit consent, exact backups, surgical uninstall, never overwriting or renaming the real `claude`. Never add a Claude settings mutation, gateway listener, or unreviewed live proof.
5. Preserve prompt-free metadata and add failure/privacy/exact-once tests.
6. Update the feasibility audit and module map, run tests, and inspect git status.
7. **Document immediately after every change** — documentation updates are part of the change itself, never deferred (see `AGENTS.md`).
8. **Mandatory pre-commit/pre-push audit gate** (see `AGENTS.md`): before committing or pushing behavior changes, launch a subagent to sweep `README.md` + all of `docs/` for claims made stale by the change, personally review its findings, and land the fixes in the same commit. This safeguard is obligatory.
9. After creating or changing a development skill, run `npm run skills:sync` and `npm run skills:check`.

Do not commit `.effort-autopilot/`, `node_modules/`, logs, benchmark payloads, prompt files, or private output.

## Future release gate

- Hook/ConPTY interception is robustly proven for the installed CLI and guarded replay.
- Explicit user effort precedence and every fail-open cause are demonstrated.
- Model/provider remain unchanged and exact model provenance remains valid after any mid-session model change.
- Prompt is unchanged/unpersisted and sent once.
- Installer is explicit/reversible and never overwrites the real binary.
- Security review covers PTY/gateway trust and transient credential handling.
- Full tests and clean-room smoke pass without billable inference.
- README contains only the architecture actually shipped.
