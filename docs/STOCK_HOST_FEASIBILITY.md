# Stock Claude Code CLI feasibility audit

Audit date: 2026-08-21  
Installed Claude Code: 2.1.238  
Current product scope: stock Claude Code **CLI only**

The native-hook request is captured in a local [draft upstream capability proposal](UPSTREAM_CAPABILITY_PROPOSAL.md). It has **not** been submitted to Anthropic.

## Definitive result

Four distinct conclusions are supported by evidence:

1. **A plugin hook cannot set the same pending turn's effort.** `UserPromptSubmit` can allow, block, or add context, but exposes no effort output.
2. **A supported local gateway is the first genuine transparent CLI request-mutation path found.** Official docs allow `ANTHROPIC_BASE_URL` with a saved claude.ai login and no gateway credential. The gateway receives the exact `model` and `output_config.effort` before inference and can mutate only effort while forwarding the same request to Anthropic.
3. **A pure PTY byte parser is not production-safe, but the hook can be its semantic gate.** `UserPromptSubmit` identifies a real top-level submission before inference. A broker can let the stock TUI own all ordinary input, then use the hook event to block and route only actual prompts.
4. **The hybrid works mechanically on the installed CLI without inference.** An authenticated named-pipe hook blocked the first submission, the ConPTY broker received the exact prompt/session/model, `/effort max` was acknowledged, one replay authorization was armed and consumed, and an independent diagnostic hook blocked the replay before any model request.

The repository contains the hybrid coordinator, one-use authorization store, named-pipe hook bridge, ConPTY adapter, byte-transparent input relay, effort-only gateway transform, the reversible global installer, and tests. It has no live gateway and makes no persistent Claude-settings change; live model calls happen only in user-authorized proofs and the (separately gated) calibration runs.

## Native hook evidence

The official [hooks reference](https://code.claude.com/docs/en/hooks) documents allow, block, `additionalContext`, and session-title behavior for `UserPromptSubmit`. It documents no `effort`, `updatedEffort`, `updatedPrompt`, deferred-prompt token, or current-turn setter. Input lacks active model and effort.

An ignored diagnostic plugin on 2.1.238 changed an isolated `settings.local.json` from high to low and blocked the prompt. `ConfigChange` fired later, while the active stock status remained high. The blocked run recorded zero turns, tokens, and cost. No hook output requeued the prompt.

## Supported gateway route

Official references:

- [Gateway overview and subscription behavior](https://code.claude.com/docs/en/llm-gateway)
- [Connect Claude Code to a gateway](https://code.claude.com/docs/en/llm-gateway-connect)
- [Gateway protocol reference](https://code.claude.com/docs/en/llm-gateway-protocol)
- [Environment variables](https://code.claude.com/docs/en/env-vars)
- [Model configuration](https://code.claude.com/docs/en/model-config)
- [Effort API](https://platform.claude.com/docs/en/build-with-claude/effort)

### Authentication matrix

| CLI configuration | Authentication/billing | Result |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` only | Saved claude.ai login remains active; subscription limits/billing apply | **Officially documented** |
| Base URL plus `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, or `apiKeyHelper` | Gateway credential replaces saved subscription; its upstream owner is billed | **Officially documented** |
| Bedrock/Vertex/Foundry variables | Provider-specific credentials and billing | Supported, but changes route and is out of scope |
| `HTTPS_PROXY` | Routes encrypted traffic | Cannot mutate JSON without forbidden TLS interception |

With saved subscription auth, a gateway must forward the `Authorization` and complete `anthropic-beta` headers unchanged; the beta header includes the OAuth capability. A local gateway therefore handles the auth header transiently in memory even if it never inspects, copies, logs, or persists its value. This audit accessed no credential.

The legal documentation permits subscription OAuth for ordinary native-app use and forbids third-party developers from routing plan credentials on behalf of users. The technical docs explicitly cover saved claude.ai login through a gateway. A personally operated local gateway is the documented technical path; distributing one to others should receive Anthropic clarification and must never become a hosted credential relay.

### Protocol requirements

- `ANTHROPIC_BASE_URL` selects `/v1/messages` and optional `/v1/messages/count_tokens`.
- The body includes exact `model`; `output_config` carries effort.
- The base URL changes destination, not selected model.
- Forward headers/body as open lists, preserve the `system` array, stream SSE/pings without buffering, and forward errors unchanged.
- Implement/forward token counting so absence does not trigger an inference-endpoint fallback.
- The gateway adds no retry. Claude Code may internally retry selected capability rejections.
- Effort changes can invalidate prompt caching; keep one chosen effort stable across agentic requests for a user turn.

[`src/gateway/request-transform.js`](../src/gateway/request-transform.js) is a transport-free synthetic proof. It performs local classification, preserves exact model and all fields except `output_config.effort`, emits prompt-free metadata, relays mock stream bytes unchanged, and supports preserve/reject failure semantics. It has no listener, upstream URL, network, or credential code.

### Global CLI scope

Official settings permit `ANTHROPIC_BASE_URL` in user-level `~/.claude/settings.json` under `env`, applying across projects after startup. A real installer must require explicit consent, merge atomically, bind only to loopback, save the prior value, and provide exact rollback. None is implemented yet.

### Desktop evidence retained but out of scope

Desktop's gateway docs use third-party inference configuration and a gateway API key or external OIDC flow; the same-subscription route was not proven there. Desktop Chat/Cowork are separate. The user removed Desktop from scope, so this audit records but does not pursue it.

## Hybrid hook + ConPTY broker audit

### Verified effort command

The [commands reference](https://code.claude.com/docs/en/commands) documents `/effort [low|medium|high|xhigh|max|auto]` and says it applies immediately.

In an authenticated 2.1.238 interactive session started with `--effort max`, the zero-inference command `/effort max` produced:

```text
Set effort level to max (this session only)
```

The status displayed `max`, then the session exited without a task. No model prompt was submitted. This verifies the local command and visible acknowledgement, not interception.

### Verified effort/model persistence and session scoping (2026-08-21)

Guarded zero-inference probes on the same 2.1.238 build, culminating in an **atomic-path matrix that read the saved `effortLevel` file after every single command**, established the definitive persistence rule:

- **`/effort low|medium|high|xhigh` ALWAYS persists the saved default** — on every path (the broker's atomic single-write submission, interactive typing through the composer, the bare picker, and the escalation confirmation dialog) and regardless of any `--effort` spawn flag. The acknowledgement says `saved as your default for new sessions` and the file changes.
- **`/effort max` is the only session-scoped level**: it acknowledges `(this session only)` and the file is untouched (file-verified in the same pinned session where `medium` and `xhigh` both persisted).
- Earlier drafts of this section wrongly credited the `--effort` spawn pin with session scoping; the two "(this session only)" observations that suggested it were both `max` applications. The pin protects nothing — it is kept only because it makes the session's starting level known (enabling the same-level skip) and is harmless.
- `/model sonnet` acknowledged `Set model to Sonnet 5 and saved as your default for new sessions` and persisted `model`.
- `/effort auto` acknowledges `Effort level set to auto` (different wording), and `--effort auto` is accepted as a spawn flag.
- The composer renders a `● <level> · /effort` status line; under `auto` it displays the resolved level, not the word `auto`.

Consequence: every non-max automatic application rewrites the user's saved default as an upstream side effect the broker cannot scope. The broker discloses it in the visible status (`The CLI also saved this level as your default`). Product decision (2026-08-21): this drift is **accepted behavior** — with the autopilot active the effort is re-decided per prompt anyway, so the saved default only matters where the broker does not run (opted-out projects, after uninstall), which the documentation states plainly. A snapshot/restore mitigation was considered and declined; the native session-scoped control in the upstream proposal remains the real fix. Settings files are read tolerating a UTF-8 BOM, which Windows tooling commonly writes.

One persistence path remains outside the pin: in a live pinned broker session on 2026-08-21, the bare `/effort` **picker** (no argument) acknowledged `saved as your default for new sessions` and persisted the chosen level into the user's settings. The broker cannot intercept or scope that interactive UI; it only observes the acknowledgement and registers the explicit user choice. This is a documented honest limitation of the stock CLI, not broker behavior.

Two further live behaviors shape `applyEffort`:

- **Escalation confirmation dialog.** Once a conversation has history, `/effort <higher>` renders a `Change effort level?` Yes/No dialog (cache for the current effort would be invalidated) instead of applying immediately. The broker initiated the change, so it confirms the highlighted "Yes" itself and then accepts either the textual acknowledgement or the redrawn `● <level> · /effort` status line as proof. If neither arrives, it sends one Esc to dismiss any modal **before** the fail-open reinjection — in the first live test the reinjected prompt had been swallowed by exactly such an unhandled dialog. A second live user test confirmed the handled flow end to end: block → silent dialog confirmation → `applied xhigh` → one forwarded prompt and one model response. **Known side effect:** a dialog-confirmed change persists the CLI's saved default effort (verified live — the user's saved level was rewritten). The broker cannot scope that upstream behavior; it discloses it in the visible status (`The CLI's confirmation also saved this level as your default.`). A native session-scoped effort control remains the correct upstream fix and is the strongest item in the draft proposal.

Launch-time precedence policy: the broker consumes its own `--autopilot manual-wins|autopilot-wins` flag (never forwarded to the CLI). The default `manual-wins` latches any observed manual `/effort` as authoritative; `autopilot-wins` re-evaluates every prompt while still tracking the manual choice as the session's current level; a tracked manual choice additionally "stands" against the uncertainty floor — when classification is uncertain the broker floors the session at `high` unless that standing choice exists or the level already suffices (see the [product contract](PRODUCT.md)). `/effort auto` under `manual-wins` hands control back to the broker.
- **Same-level no-op skip.** Re-sending the already-active level was observed to acknowledge `saved as your default for new sessions` even in a pinned session. The broker tracks the session's known active level (spawn pin, acknowledged applications, observed manual choices) and skips the command entirely when the classifier's choice is already active.

### Why the hybrid avoids the PTY state blocker

A pure PTY broker must choose:

1. Forward editing keystrokes so the stock editor works. At Enter, the child already owns the prompt buffer; running `/effort` first requires undocumented clear/retype sequences.
2. Withhold bytes until classification. Then the broker must implement editing, paste/multiline, attachments, slash completion, history, Vim mode, and rendering. That is a replacement input UI.

Claude Code exposes no documented PTY frame for “top-level composer active.” The hybrid does not invent one: it forwards terminal bytes normally and accepts only `UserPromptSubmit` as the semantic top-level gate. Tool approvals, auth, editor input, picker choices, shell input, and ordinary slash commands bypass this route because they do not fire that event.

The mock ConPTY proof uses Microsoft's MIT-licensed `node-pty` and a synthetic TUI:

```text
synthetic top-level prompt
  -> classifier with exact synthetic model
  -> /effort command
  -> exact acknowledgement
  -> original prompt once
  -> one synthetic MODEL_REQUEST marker
```

The installed zero-inference diagnostic then used real Claude Code 2.1.238 with temporary settings and two command hooks. The second diagnostic-only hook always blocked, independently of IPC, so an IPC or coordinator defect could not permit inference. Observed prompt-free result:

```json
{
  "exactModel": "claude-fable-5",
  "firstSubmissionBlocked": true,
  "effortAcknowledged": true,
  "replayReachedDiagnosticBlock": true,
  "multilineUnicodePromptFidelity": true,
  "zeroInferenceGuardObserved": true,
  "routeOutcome": "applied",
  "requestedEffort": "max",
  "appliedEffort": "max",
  "pendingTickets": 0,
  "replayAuthorizations": 0,
  "modelPromptSubmitted": false
}
```

The installed TUI needed a bounded 500 ms paste-settle window before submit; the earlier 25 ms attempt left text in the composer. Multiline/control-bearing text uses terminal bracketed paste, and the consumed replay digest proved exact Unicode/multiline fidelity. `/effort` acknowledged locally. ANSI cursor controls inside the acknowledgement are normalized before exact matching.

The first block is not quiet. Stock Claude renders `UserPromptSubmit operation blocked by hook`, the reason, and the original prompt. Official docs state `suppressOutput` has no effect. Production can keep the message concise but cannot claim invisible interception.

### Hybrid replay protocol

1. The broker creates a random 256-bit token and per-process Windows named pipe (Unix socket on other platforms) and passes both only in the child environment.
2. `SessionStart` registers session ID, cwd, and exact model when present.
3. First `UserPromptSubmit` sends session ID, `prompt_id`, cwd, and prompt over bounded local IPC and returns `decision: block`.
4. The broker classifies locally, applies `/effort`, and requires the normalized exact acknowledgement.
5. It arms an expiring authorization keyed by session ID plus an in-memory SHA-256 prompt digest, then reinjects the exact original prompt once.
6. The second hook consumes that authorization. A legitimate later identical prompt is not authorized automatically.
7. The allow response includes only a prompt-free `systemMessage` reporting applied or unchanged status. Official docs describe `systemMessage` as a user warning; it is not `additionalContext`.

Wrong/stale tokens, oversized messages, IPC timeout, coordinator failure, expired authorization, concurrent sessions, legitimate repeats, Unicode/multiline fidelity, reinjection failure, and cancellation before routing are covered by local tests. During the routing window the input relay pauses stdin instead of interpreting it; queued permission/paste/Unicode/cancellation bytes resume unchanged.

### Model tracking

`SessionStart` supplied exact model in the installed diagnostic and can seed a broker without inference. Official hooks docs say the field is optional and that it does not update when `/model` changes during a session. The broker now watches terminal output for the verified `⎿ Set model to …` acknowledgement and marks the session's model ambiguous when it appears; from then on every prompt forwards unchanged until a new `SessionStart` supplies an exact model again. It never infers an exact version from an alias or picker rendering. All observer patterns require the TUI's `⎿` result marker, so assistant text or displayed documentation that merely quotes the acknowledgement wording is not read as a real command.

Two live findings from the first user test (2026-08-21) matter here. First, a clean-environment `SessionStart` reported `"model": "claude-opus-5[1m]"` — an exact id with a 1M-context suffix; the bundled catalog now includes a Claude Opus 5 profile and strips the `[1m]` variant marker before lookup. Until then every prompt correctly but uselessly forwarded as `unsupported-or-ambiguous-model`; that status now names the unresolved model id (prompt-free) so a missing profile is visible instead of silent. Second, diagnostics launched from inside another Claude Code session inherit `CLAUDE_CODE_*` child-session environment and can report the parent session's model — clean-environment verification is required before trusting any model-identity observation.

Manual `/effort` precedence uses the same observable channel: acknowledgements produced outside the broker's own application window (`Set effort level to <level>` in either scope variant) register an explicit user effort that wins from then on, and `Effort level set to auto` clears it so automation can resume. Attribution errs toward the user: a re-rendered copy of an older broker acknowledgement, or assistant text quoting the acknowledgement wording, can at worst disable automation visibly — never apply an effort. A `--effort` launch flag registers explicit user effort at `SessionStart`, and such prompts are allowed directly without a block/replay cycle.

### Fail-open contract

Explicit user effort always wins under `manual-wins`. Unsupported/ambiguous model, classifier failure/timeout, ambiguous terminal state, missing exact acknowledgement — or insufficient confidence under `manual-wins` (under `autopilot-wins` an uncertain prompt is instead floored at `high` unless a standing manual choice or an already-sufficient level applies; see the [product contract](PRODUCT.md)) — means:

- intentionally leave effort unchanged;
- forward the original prompt exactly once at current/default/user effort;
- visibly report `outcome=unchanged` with a prompt-free cause;
- never block, duplicate, retry, persist, or rewrite the prompt.

After `/effort` is sent, loss of its acknowledgement cannot prove it had no side effect. The contract therefore reports unchanged and forwards once without claiming an application; it does not send another effort command. The installed proof demonstrates the positive acknowledgement path, not every terminal failure mode.

If broker IPC is unavailable, the hook returns a prompt-free `systemMessage` that automatic effort was unchanged and otherwise allows the original submission. No block/replay occurs in that case. This is the strongest documented visible fail-open behavior without adding model context.

## Other legitimate local-control architectures

| Architecture | Coverage | Result |
| --- | --- | --- |
| Local Messages gateway | Stock CLI, all projects | **Supported pre-inference effort transform; strongest CLI route** |
| Explicit PATH shim | Process startup | Cannot choose later turns unless paired with gateway/custom UI |
| Pure PTY/ConPTY parser | Preserves child process/stream | Unsafe semantic guessing; rejected |
| UserPromptSubmit + ConPTY hybrid | Stock CLI session | **Zero-inference installed POC passes; visible block artifact and release gaps remain** |
| Launcher-owned `--print`/`--resume` | Can set effort pre-call | Rejected product; internal benchmark only, not stock TUI |
| Agent SDK client | Can own conversation/effort | Replacement client, not stock CLI |
| Settings mutation before Enter | File change detected | Active session adoption not verified |
| Corporate HTTP proxy | Opaque TLS | No body transform without forbidden MITM |
| MCP, custom headers, hooks, skills | Context/tools/advice | No outbound effort middleware |
| Binary patch/injection/sniffing | Unsafe/unsupported | Excluded |

## Current decision boundary

- **Transparent CLI mechanism:** the hook/ConPTY hybrid is technically feasible and preserves the same stock session with no preliminary model call.
- **Truthful UX:** the first hook block is visibly rendered; the current API cannot make it silent.
- **Shipped:** the reversible global installer, live prompt proofs, mid-session model ambiguity marking, explicit-user-effort tracking (terminal acknowledgement observer plus `--effort` flag precedence), user `--settings` merging with a visible passthrough fallback, runtime input-relay wiring, and crash cleanup — implemented and covered by local tests plus a zero-inference installed-CLI harness. The `--effort` spawn pin is kept only for known-starting-level tracking; it does not scope anything (see the persistence rule above).
- **Remaining release blocker:** macOS verification on real hardware (Linux is WSL-verified).
- **Live boundary:** user-authorized live prompts on 2026-08-21 covered every branch that existed on that date; the autopilot-wins uncertainty floor (added 2026-08-22, issue #2) is unit-tested only, never live-proven. Fail-open: a deliberately trivial prompt classified below the confidence floor (0.37), visibly forwarded once unchanged with one model response (observed under `manual-wins`; under `autopilot-wins` that same prompt would now be floored at `high`). Applied: `applied low` on a first prompt, and `applied xhigh` mid-conversation through the CLI's escalation confirmation dialog, each with exactly one authorized replay and one model response. Manual precedence: an observed `/effort` choice passed prompts through directly. The live calibration benchmark remains separately gated.
- **Current code:** the shipped hybrid broker with installer, the synthetic gateway transform, classifier plus inactive learned-classifier stack, and internal benchmarks — tagged `v0.3.0-beta.1` and released on GitHub as a pre-release; npm publication remains gated on the release checklist.

The hybrid broker is the shipped product mechanism. The gateway route stays documented as an alternative architecture, and the draft proposal still requests the native session-scoped capability that would remove the visible block and the saved-default side effect.
