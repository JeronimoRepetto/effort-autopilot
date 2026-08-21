# Internal benchmark Claude Code transport

> This `--print` transport is not the Effort Autopilot product and is not distributed as a user command. It remains solely for internal benchmark/calibration infrastructure.

## Selected transport

The primary adapter invokes the user's installed `claude` executable. This is the documented path that can inherit an existing authenticated Claude Code subscription/session configuration without requesting or handling credentials. The Agent SDK was not selected for this MVP because its third-party distribution authentication path does not generally permit reusing claude.ai subscription login.

The invocation is assembled before spawning:

```text
claude --print --input-format text --output-format json
       --effort <resolved-effort> --no-session-persistence
```

Optional flags are `--model`, `--max-turns`, `--max-budget-usd`, and `--permission-mode`. The prompt is the child process's stdin, not an argument.

## Authentication and provider inheritance

The child inherits the normal process environment and Claude Code configuration. Effort Autopilot does not request, read, copy, print, validate, or persist credentials. It cannot tell the user how much subscription allowance remains before a call because the CLI exposes no supported preflight allowance value.

The adapter contains no provider selection. Omitting `--model` also omits the corresponding CLI flag. An explicit model is the only model override path.

## Session semantics

Each launcher task creates a fresh one-shot `--print` execution with `--no-session-persistence`. It does not attach to, resume, or mutate an interactive Claude terminal or Desktop Code-tab conversation. Claude may still create files or run tools in the supplied working directory.

The JSON payload may report a session ID, but the launcher does not use it to resume. Disabling session persistence protects the local Claude transcript store; it does not mean Anthropic performs no service-side processing or retention. Claude's applicable product and organization policies remain in force.

## Exactly-once dispatch

`launchTask` calls the runner exactly once after classification and planning. `executeClaudeTask` creates exactly one child process. Neither function contains a retry loop. Spawn failure, malformed JSON, Claude-reported failure, output overflow, and rate limit all terminate the task.

“One execution” is intentionally narrower than “one model call.” A single `claude --print` agent execution can perform multiple inference turns and tool interactions. `num_turns`, aggregate usage, model usage, and estimated cost are returned when the CLI supplies them. `--max-turns` bounds agent turns; `--max-budget-usd` is the available cost control, not proof of an exact token cap.

## Output and limits

The adapter buffers structured stdout and diagnostic stderr up to a combined 32 MiB. Exceeding that limit kills the child and reports `output-limit`. Successful JSON is normalized to final result, session ID, subtype, turn count, cost estimate, aggregate usage, model usage, and stop reason.

Subscription-limit detection recognizes HTTP 429 status and common structured rate/usage-limit diagnostics. It intentionally does not retry, sleep, poll, or attempt to infer credentials. Detection is best effort because CLI error formats can change.

## Permission behavior

The launcher passes a permission mode only when explicitly requested. Supported values mirror the installed CLI: `manual`, `acceptEdits`, `plan`, and `dontAsk`. It does not expose an AI-based `auto` permission router, because that could add another inference path and weaken the one-classifier/one-execution contract.

## Compatibility checks

Before release or after upgrading Claude Code, run the CLI help and smoke checks described in [Development](DEVELOPMENT.md). If Claude rejects an effort because of model, account, or organization capability, the execution fails once; it is not silently reissued at another level. A supplied model capability profile can clamp the request locally, but current profiles are not automatically discovered.
