# Launcher architecture decision

> **Rejected product decision:** the user will not use the one-shot launcher. It remains internal benchmark infrastructure only and is absent from npm bins and public install/usage docs. The intended product is a transparent stock Claude Code CLI broker. See [Stock CLI feasibility](STOCK_HOST_FEASIBILITY.md).

Status: internal evaluation provenance only, not a product UX or fallback.

## Decision

The experimental launcher's entrypoint owns task submission:

1. read the prompt locally
2. collect bounded local project/environment metadata
3. classify locally with zero model tokens
4. resolve model-profile constraints, fallback baseline, and savings ceiling
5. launch one Claude Code `--print` process with `--effort` already set
6. report result, turns, usage, and estimated cost

There is no `UserPromptSubmit` hook and no semantic routing call to Claude. The optional plugin contains manual-only skills.

## Why the installed Claude Code CLI is the primary backend

The TypeScript Agent SDK supports a top-level `effort` option, but its documented distribution/authentication path expects API or external-provider credentials. Third-party applications are not generally permitted to offer claude.ai subscription login.

The product requirement is to use the user’s existing authenticated Claude Code subscription configuration without reading credentials. Therefore the launcher invokes the installed `claude` executable with documented flags:

```text
claude --print --input-format text --output-format json
       --effort <level> --no-session-persistence
```

The prompt is supplied on stdin. No `--model` is added unless the user explicitly asks for one. No provider argument or credential handling exists.

## Execution cardinality

The launcher calls the Claude CLI process once and never retries. A Claude Code execution can contain multiple model turns and tool round-trips. This is inherent to agentic coding and is surfaced through `num_turns` and usage data.

`ultracode` orchestration is never enabled by the savings launcher. A classifier ultracode result becomes standard xhigh effort, then is clamped by the configured ceiling.

## Privacy boundary

- prompt classification is local and in-memory
- prompt text is absent from process arguments, routing output, checkpoints, and errors
- the launched session uses `--no-session-persistence`
- provider and authentication environment are inherited without inspection
- pilot workspaces and results are local and gitignored

## Failure and subscription-limit boundary

There is no retry loop. Claude HTTP 429 status and recognizable usage/rate-limit diagnostics map to a distinct `subscription-limit` stop. The pilot checkpoints and exits immediately. Claude Code exposes no supported preflight remaining-allowance value, so the product cannot predict the reset boundary before an actual limit response.

## Interactive boundary

The MVP is polished one-shot execution only. It does not intercept an already-open interactive session and does not claim per-turn effort ownership there.

## Future Codex adapter

A future Codex adapter can consume the same host-neutral classifier and launch-plan contract. It must preserve provider/model choice, apply effort before execution, avoid classifier inference, and implement its own truthful usage/persistence boundary.
