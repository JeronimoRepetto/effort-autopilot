# Development and operations

## Local setup only

Requirements: Node.js 20+. Claude Code 2.1.238 was used for the non-inference command audit, but normal tests do not launch it.

```powershell
Set-Location C:\Users\jeron\Desktop\effort-autopilot
npm install
npm test
npm run broker:poc:test
```

`node-pty` 1.1.0 supplies Windows ConPTY and Unix PTY bindings for the broker. It is MIT licensed. The package is marked `private` and has no `bin` mapping. Do not run `npm install --global .`; the interactive entrypoint is restricted to the reversible isolated test and no script permanently replaces or renames the real `claude` executable.

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

The suite covers classifier tiers/boundaries, multilingual features, model profiles, malformed input, privacy, broker acknowledgement/order, user override precedence, every fail-open cause, exact-once forwarding, synthetic ConPTY, gateway effort-only mutation/streaming, and internal benchmark regressions.

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

After the zero-inference diagnostic is green, `scripts/start-isolated-test.ps1` may open a separate PowerShell whose session-local PATH maps `claude` to the internal interactive broker. Closing that window restores the ordinary command. See [Isolated user test](ISOLATED_TEST.md). This is the only currently approved live-test surface; it does not authorize a global installation.

## Change workflow

1. Keep host-neutral logic under `src/core`.
2. Keep product broker logic under `src/broker`, the guarded proof under `scripts`, and gateway research under `src/gateway`.
3. Keep `src/launcher`, `src/adapters/claude-cli`, legacy `src/cli`, and pilot bins internal-only.
4. Never add a public bin, persistent PATH shim, settings mutation, gateway listener, or unreviewed live proof. The isolated session shim must remain explicit and reversible.
5. Preserve prompt-free metadata and add failure/privacy/exact-once tests.
6. Update the feasibility audit and module map, run tests, and inspect git status.

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
