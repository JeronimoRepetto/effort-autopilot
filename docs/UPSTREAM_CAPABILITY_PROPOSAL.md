# Draft upstream capability proposal: same-turn effort override

> **DRAFT — local repository document only. This proposal has not been submitted to Anthropic.**

Target reviewed: Claude Code 2.1.238 on 2026-08-21. Supporting evidence is in the [stock-host feasibility audit](STOCK_HOST_FEASIBILITY.md).

## Compact feature request

**Title:** Allow `UserPromptSubmit` hooks to set same-turn effort before dispatch

A globally installed Claude Code plugin should be able to classify a submitted prompt locally and choose the minimum sufficient effort for the exact active model. The user should continue typing in stock Claude Code; the plugin must not add a model call, change provider/model, rewrite the prompt, or ask the user to resubmit.

Today, `UserPromptSubmit` can block a prompt or add context, but it cannot atomically set effort for that same pending turn. Please add optional model/capability/effective-effort fields to the hook input and a validated synchronous `turnEffortOverride` output. Claude Code should resolve it after synchronous hooks finish and before the sole normal model dispatch, then expose prompt-free telemetry showing exact model and applied effort.

## Minimal zero-inference reproduction

1. Start an isolated stock session on exact `claude-sonnet-5` at `high`.
2. Let a synchronous `UserPromptSubmit` hook write `effortLevel: "low"` to the isolated local settings and return `decision: "block"`.
3. Observe a later `ConfigChange`, proving the process noticed the file write.
4. Observe that the stock status line still says `high`.
5. Observe zero turns, zero tokens, zero cost, and no supported automatic requeue.

The diagnostic persisted only event names, timestamps, model/effort fields, and prompt length. It persisted no prompt text and invoked no model.

## Proposed backward-compatible input

All additions are optional. A capability token lets a new hook detect support without assuming an older host will honor unknown output.

```json
{
  "hook_api_version": 2,
  "capabilities": ["turn-effort-override-v1"],
  "hook_event_name": "UserPromptSubmit",
  "session_id": "session-id",
  "turn_id": "turn-id",
  "cwd": "C:\\work\\project",
  "permission_mode": "default",
  "prompt": "the existing prompt field",
  "host": {
    "surface": "cli",
    "version": "2.1.238",
    "platform": "win32"
  },
  "model": {
    "resolved_id": "claude-sonnet-5",
    "family": "sonnet",
    "capabilities": {
      "effort": {
        "supported": true,
        "levels": ["low", "medium", "high", "xhigh", "max"]
      },
      "ultracode": false
    }
  },
  "effort": {
    "current_effective": "high",
    "source": "model_default",
    "user_ceiling": "high",
    "override_allowed": true
  },
  "project": {
    "workspace_root": "C:\\work\\project",
    "platform": "windows",
    "trusted": true,
    "is_git_repository": true
  }
}
```

`turn_id` correlates resolution and dispatch without prompt content. `host.surface` distinguishes supported hosts. `model.resolved_id` is exact after aliases and policy resolve. Capabilities prevent guessing. Current effort/source preserve explicit-user-choice precedence. The ceiling remains host-authoritative. Project paths stay local hook input and are never telemetry. `ultracode` is separate because it is orchestration, not an API effort level.

## Proposed synchronous output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "turnEffortOverride": {
      "level": "medium",
      "policyId": "effort-autopilot/bootstrap-2026-08-21",
      "reasonCodes": ["scoped-task", "single-surface"],
      "confidence": 0.81
    }
  }
}
```

Only `level` is operational. Other fields are optional bounded diagnostics. The schema must reject model, provider, endpoint, credential, prompt-replacement, retry, and orchestration fields. Apply the override after all synchronous hooks, before constructing/sending the turn's first model request, and for that turn only.

## Precedence, conflicts, and failure

Recommended precedence, highest first:

1. Managed policy and hard organization/user ceiling.
2. Explicit fixed user session/environment effort; input says `override_allowed: false`.
3. Resolved synchronous hook override.
4. Current session effort or model default.

For multiple authorized hooks, choose the highest requested supported level, then clamp to the ceiling. This avoids last-writer behavior and is quality-conservative within the user's cost limit.

- Any hook blocks: zero model requests; discard overrides.
- Omitted/invalid field, crash, or timeout: preserve current effort and continue under existing hook policy.
- Unsupported/over-ceiling request: clamp when safe and report requested/applied values; otherwise preserve current effort.
- Async hooks cannot set the current turn.
- Never persist the override to later turns.

## Prompt-free telemetry

Expose resolution in stream JSON/debug instrumentation and optionally a `TurnDispatch` hook:

```json
{
  "type": "system",
  "subtype": "turn_dispatch",
  "session_id": "session-id",
  "turn_id": "turn-id",
  "model": "claude-sonnet-5",
  "effort": {
    "previous": "high",
    "requested": "medium",
    "applied": "medium",
    "source": "hook",
    "hook_count": 1,
    "clamped": false,
    "outcome": "applied"
  }
}
```

Do not include prompt text, excerpts, hashes, credentials, plugin paths, or free-form reasons. The UI should display effective effort. Test instrumentation should assert hook completion before dispatch before first response and count one normal dispatch.

## Security and trust

- Require visible plugin permissions such as `prompt:read` and `turnEffort:write`, with managed allowlisting.
- Never let this field set provider, model, base URL, auth, tools, or permission mode.
- Never exceed model support or user/organization ceiling.
- Keep classification local and prompt-free in logs/telemetry.
- Re-resolve exact model/capabilities each turn.

## Parity and non-goals

The same contract should apply wherever stock Claude Code owns submission: CLI and supported Desktop Code sessions. Desktop Chat/Cowork are separate unless they adopt it independently.

Non-goals: provider/model routing, hard token caps, guaranteed per-prompt savings, ultracode orchestration, prompt rewriting, retries, MCP/API routing, or replacement UI.

## Why current mechanisms do not meet the native contract

| Mechanism | Limitation |
| --- | --- |
| Settings mutation | Detected, but verified active session did not adopt the pending value. |
| `additionalContext` | Changes context, not API effort. |
| Block/reinject | No hand-back primitive; PTY retyping is UI-protocol automation. |
| Skills/subagents | Apply only after invocation and can add model/context work. |
| Environment/`CLAUDE_ENV_FILE` | Cannot change parent pending request. |
| Agent SDK | Owns a custom client, not stock composer. |
| Launcher/alias | Changes entrypoint; cannot attach to stock TUI. |
| Prompt/agent hooks | Spend model tokens. |
| LLM gateway | Can mutate CLI `output_config.effort`, but is infrastructure outside the plugin contract and handles request/auth headers in transit. |

## Acceptance tests

1. Classify before the sole dispatch and observe requested effort on it.
2. Model switch yields newly resolved exact ID/capabilities.
3. Ceiling clamps and telemetry reports it.
4. Explicit user effort sets `override_allowed: false` and wins.
5. Multiple hooks resolve deterministically.
6. Invalid output, crash, and timeout preserve effort with at most one dispatch.
7. Block produces zero dispatches; async cannot mutate.
8. CLI/Desktop Code semantics match.
9. Provider/model remain unchanged; `ultracode` is rejected as effort.
10. Old hooks remain compatible; new hooks detect old hosts.
11. Telemetry contains no prompt or credential data.

## Engineering appendix

```text
composer submit
  -> freeze original prompt
  -> resolve exact model/capabilities/current effort/ceiling
  -> run synchronous hooks
  -> block, or validate and resolve turnEffortOverride
  -> dispatch original prompt once
  -> emit prompt-free model/effort telemetry
```

Suggested constraints: effort enum only; `policyId` at most 128 bytes; at most eight reason codes of 64 bytes; confidence finite in `[0,1]`. Unknown fields remain forward-compatible, while forbidden security-sensitive fields discard only that override.

```text
snapshot = resolveTurnState()
outputs = runSynchronousHooks(snapshot)
if outputs.anyBlock: stopWithoutDispatch()
eligible = validateOverrides(outputs, snapshot)
requested = highestEffort(eligible)
applied = clampToSupportedAndCeiling(requested, snapshot)
dispatch(originalPrompt, snapshot.model, applied ?? snapshot.currentEffort)
emitTurnDispatchTelemetry(snapshot, requested, applied)
```

The existing hook lifecycle is early enough. The missing capability is a typed host-resolved mutation between hook completion and dispatch.

---

**Draft status:** ready for review, but not submitted to Anthropic.
