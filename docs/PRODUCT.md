# Product contract

## Intended product

Effort Autopilot's only intended end-user product is a transparent, user-approved, globally installed broker/shim in front of the real Claude Code CLI. It must preserve the stock interactive session and intercept only positively identified top-level task submissions before model inference.

The old one-shot launcher is not an alternative, fallback, or public command. Its `--print` transport is retained only because the internal benchmark runner depends on it. The npm package is private and exposes no binaries while the broker is unproven.

## Terms

- **broker**: local process that owns the real CLI's terminal transport while preserving the child session.
- **exact active model**: resolved immutable model/version, never an ambiguous family alias.
- **automatic effort**: classifier recommendation that the host positively acknowledged for the pending task.
- **explicit user effort**: a CLI argument, environment/session choice, or observed `/effort` choice made by the user; it always wins.
- **unchanged**: no intentional automatic effort mutation; use Claude's active/default/user-selected value.
- **one forward**: the original task submission is delivered once. Claude Code can still perform normal agentic model/tool turns internally.
- **ultracode**: orchestration mode, not a model effort level; never activated by the broker.

## Required sequence

```text
top-level submission identified
  -> hook blocks the pending prompt before inference
  -> preserve exact task bytes in memory
  -> resolve exact active model/profile
  -> classify locally with ceiling/confidence policy
  -> apply effort through a supported mechanism
  -> require exact acknowledgement
  -> arm one-use session + prompt-digest authorization
  -> reinject original task once in the same session
  -> hook consumes authorization and allows it
  -> emit prompt-free status
```

No preliminary model call is allowed. Provider/model cannot change.

## Fail-open contract

An explicit user effort choice has precedence. The broker leaves effort unchanged and forwards once when any of these applies:

- model/version unsupported or ambiguous;
- confidence below the configured threshold;
- classification failure or timeout;
- terminal state not positively identified as top-level task entry;
- proposed effort not positively acknowledged.

Status must distinguish `applied` from `unchanged` and state a prompt-free cause. No block, duplicate, retry, prompt rewrite, prompt persistence, or fallback to the old launcher is allowed. A future explicit strict mode may pause instead, but does not exist today.

## Current implementation boundary

The local classifier, model profiles, fail-open controller, authenticated local IPC, one-use replay authorization, synthetic gateway transform, and ConPTY transport are implemented and tested. An installed CLI diagnostic completed the full hook/block/acknowledge/replay/second-hook sequence with an independent final blocker and zero inference.

`UserPromptSubmit` supplies the missing semantic event, so permissions, auth flows, editors, pickers, and ordinary slash commands do not need byte-level interpretation. Production is still gated on a reversible installer/shim, robust mid-session model and explicit-effort tracking, input relay integration, and one authorized live prompt proof. Stock Claude visibly reports the first hook block; there is no supported quiet-block output.

No end-user install, live model proof, or savings claim is authorized yet.
