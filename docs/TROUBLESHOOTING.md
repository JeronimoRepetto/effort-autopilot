# Troubleshooting

## There is no `effort-autopilot` command

Expected. The rejected one-shot launcher was removed from npm bins and the package is private. The transparent broker has not reached a safe global-install stage. Do not create a PATH alias to the legacy script.

## Broker test reports unchanged effort

This is correct fail-open behavior when the cause is one of:

- `explicit-user-effort`
- `unsupported-or-ambiguous-model`
- `insufficient-confidence`
- `classification-failed`
- `classification-timeout`
- `ambiguous-terminal-state`
- `effort-not-acknowledged`

The task is forwarded once at Claude's current/default/user-selected effort and status must say `outcome=unchanged`. It must not retry or route through the legacy launcher.

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

The hybrid uses `UserPromptSubmit` instead of guessing semantic state from terminal bytes, and its guarded installed proof passes. Global installation is still held for a reversible shim/hook installer, exact tracking after mid-session `/model` changes, explicit user-effort observation, crash cleanup, and one authorized live prompt proof. Do not create a PATH alias manually.

## Claude shows “operation blocked by hook”

Expected in the hybrid design. Claude Code visibly renders every blocked `UserPromptSubmit`, including the original prompt. Official docs say `suppressOutput` has no effect. This is a UI artifact with zero model inference, not a duplicate model request. The eventual broker may shorten the reason but cannot honestly promise an invisible block.

## Gateway mock versus live gateway

The mock transforms an in-memory synthetic Messages body and has no listener/network/auth code. It does not change `ANTHROPIC_BASE_URL`. A live loopback gateway needs a separate architecture/security/rollback decision before implementation.

## Internal pilot problems

Historical pilot and `--print` transport are contributor-only. Their detailed recovery semantics remain in [Internal visible pilot](PILOT.md) and [First live pilot readiness](LIVE_PILOT_READINESS.md). They are not product fallbacks.

## Reporting issues

Use synthetic prompts. Include versions and prompt-free cause codes only. Never include credentials, settings files, private prompts, raw auth headers, or private Claude output.
