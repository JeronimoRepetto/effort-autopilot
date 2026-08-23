# Troubleshooting

## `effort-autopilot` is not recognized

The `effort-autopilot` command is the installer CLI (`bin/effort-autopilot-cli.js`). Until the package is published to npm, run it from a repository checkout as `node bin/effort-autopilot-cli.js <command>` — see [Installation](INSTALL.md). The rejected one-shot launcher has no binary at all and is internal-only (`node bin/effort-autopilot.js`, see [CLI.md](CLI.md)); do not create a PATH alias to it.

## Broker test reports unchanged effort

This is correct fail-open behavior when the cause is one of:

- `explicit-user-effort`
- `unsupported-or-ambiguous-model`
- `insufficient-confidence` (manual-wins)
- `insufficient-confidence-manual-respected` (autopilot-wins: your standing manual choice won)
- `insufficient-confidence-floor-met` (autopilot-wins: the level already meets the `high` floor)
- `classification-failed`
- `classification-timeout`
- `ambiguous-terminal-state`
- `effort-not-acknowledged`

The task is forwarded once at Claude's current/default/user-selected effort and status must say `outcome=unchanged`. It must not retry or route through the legacy launcher. (A `broker-setup-failed` or `pty-spawn-failed` notice is not a turn cause — those are launch-level; see their sections below.)

## Automatic effort is disabled for this launch (broker-setup-failed)

A broker setup step failed after launch (for example the temporary settings write or the local IPC server), so the broker cleaned up and started Claude completely unchanged with your original arguments — fail-open by contract, never a blocked launch. The parenthesized cause after `broker-setup-failed:` is prompt-free and names the failing operation; it may include local file paths (for example under your `$TMPDIR`), so redact your username before sharing it publicly. Automatic effort returns on the next launch once the underlying cause (disk permissions, an exotic `$TMPDIR`) is resolved; if it persists, report the cause code.

## macOS: chmod ENOENT on a `.sock` path, or `npm test` hangs

Fixed on 2026-08-23 (issue #18): the IPC socket path exceeded the 104-byte macOS `sun_path` limit, so `bind()` silently truncated it and the later `chmod` failed. The endpoint basename is now short (`ea-<pid>-<hex>.sock`), the byte length is guarded explicitly (`ipc-endpoint-too-long` instead of silent truncation), and a post-listen failure closes the server instead of hanging the test runner. If you still see this, you are on an older checkout — update.

## macOS: `posix_spawnp failed` (the ConPTY test fails, or an older checkout aborts the launch)

`node-pty` on macOS executes a small `spawn-helper` binary shipped prebuilt inside its package; `posix_spawnp failed` means the OS refused to execute it. Verified on real hardware (2026-08-23, pnpm v11.1.1, darwin-arm64): installing dependencies with pnpm can drop the helper's execute bit (`-rw-r--r--` instead of `-rwxr-xr-x`) while `pty.node` still loads fine, because `require()` only needs read permission.

The broker now repairs this automatically at launch (a one-line notice reports the repaired path), so a live launch self-heals. The manual fix — for older checkouts, for making `npm test` pass without launching the broker first, or when the automatic repair reports a permission failure — is:

```zsh
chmod +x node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/*/spawn-helper   # pnpm layout
chmod +x node_modules/node-pty/prebuilds/*/spawn-helper                                  # npm layout
```

(If node-pty was compiled from source, the helper lives in `.../node-pty/build/Release/` instead; the broker's `failed` notice prints the exact detected paths.)

Note that `pnpm rebuild node-pty` does NOT fix this: node-pty's install script short-circuits without compiling whenever its shipped prebuilds exist.

## Claude runs but the notice says `pty-spawn-failed` / "directly attached"

node-pty could not spawn at all (missing or unloadable native binding, a helper the automatic repair could not fix). The broker degraded to its last-resort mode: Claude attached directly to your real terminal — fully usable, prompt untouched, but with no automatic effort for that launch. The parenthesized cause is prompt-free; it may include local file paths, so redact your username before sharing. Fix the underlying node-pty install (see the `posix_spawnp` entry above, or reinstall dependencies) to get the broker back.

## The broker raised my effort to high and I didn't ask

That is the `autopilot-wins` uncertainty floor, not an error: when classification is uncertain and no manual `/effort` choice is standing and the level is below `high`, the broker applies `high` and reports `applied` with `uncertainty-floor-acknowledged`. To keep your own level, type `/effort <level>` (it stands until an applied automatic turn or `/effort auto`), or switch back to the default policy with `node bin/effort-autopilot-cli.js policy manual-wins`.

## ConPTY test fails on Windows

Run Node.js 20+ on Windows 10/11 with the locally installed `node-pty` 1.1.0 dependency. Re-run `npm install`, then:

```powershell
npm run broker:poc:test
```

This tests the synthetic TUI and controller only. The separate guarded installed check is:

```powershell
npm run broker:poc:installed-zero-inference
```

It opens stock Claude Code but installs an independent temporary block hook, so it must never reach inference. Do not confuse it with a live prompt proof.

## Why the broker is not globally installed

The hybrid uses `UserPromptSubmit` instead of guessing semantic state from terminal bytes, and its guarded installed proof passes. The former release blockers (mid-session `/model` ambiguity marking, explicit user-effort observation, crash cleanup, live prompt proofs) are implemented and live-validated, and a reversible installer now exists — see [Installation](INSTALL.md). Do not create a PATH alias manually; use the installer CLI's `install`/`uninstall` (`node bin/effort-autopilot-cli.js`) so the change stays reversible and backed up.

## Claude shows “operation blocked by hook”

Expected in the hybrid design. Claude Code visibly renders every blocked `UserPromptSubmit`, including the original prompt. Official docs say `suppressOutput` has no effect. This is a UI artifact with zero model inference, not a duplicate model request. The eventual broker may shorten the reason but cannot honestly promise an invisible block.

## Gateway mock versus live gateway

The mock transforms an in-memory synthetic Messages body and has no listener/network/auth code. It does not change `ANTHROPIC_BASE_URL`. A live loopback gateway needs a separate architecture/security/rollback decision before implementation.

## Internal pilot problems

Historical pilot and `--print` transport are contributor-only. Their detailed recovery semantics remain in [Internal visible pilot](PILOT.md) and [First live pilot readiness](LIVE_PILOT_READINESS.md). They are not product fallbacks.

## Reporting issues

Use synthetic prompts. Include versions and prompt-free cause codes only. Never include credentials, settings files, private prompts, raw auth headers, or private Claude output.
