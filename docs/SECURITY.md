# Privacy and security

## Data inventory

| Data | Source | Handling |
| --- | --- | --- |
| Prompt | `UserPromptSubmit` hook or internal public benchmark | held in memory through one routing/replay window; never included in broker metadata or persistence |
| Routing signals/reasons | local classifier | may be displayed; contain no prompt excerpts |
| Project metadata | local root and Git | bounded derived facts only |
| Model profile | optional local JSON | read up to 128 KiB; not a credential |
| Claude result/usage | internal benchmark structured output | internal evaluation only |
| Pilot checkpoint | local runner | ignored JSON with public IDs and metrics, no prompt/result |
| Credentials | Claude Code configuration/environment | never read by broker POC; a future gateway would transiently relay auth headers without inspecting/logging/persisting them |

## Threat model and controls

### Prompt disclosure through routing

Control: classification is in-process and has no network dependencies. Decisions contain signal names, weights, and generic reasons, never the prompt, excerpts, or hashes. Tests use a canary to verify prompt absence.

### Local hook IPC and replay

Control: every broker process creates a unique local named pipe/socket and random 256-bit token. The token is inherited by the child/hook environment, never placed in command arguments or logs. Frames are bounded, tokens are compared in constant time, Unix sockets use mode `0600`, and Windows pipe access is additionally protected by the token and the creating user's process security context. The hook sends prompt content only to that local endpoint.

Replay authorization is in memory, expires after five seconds, binds session ID to a SHA-256 prompt digest, and is consumed once. The digest is never logged or persisted. Repeating identical text later creates a new normal routing ticket.

### Process-list or shell injection disclosure

Control: the PTY adapter spawns by executable plus argument array, and terminal input is relayed as bytes without invoking a shell. The routing-window relay pauses rather than interpreting permission, editor, paste, Unicode, or cancellation input. Internal benchmark/verifier processes also use argument arrays with `shell: false`. The isolated test broker is internal, has no npm binary mapping, and shadows `claude` only in a newly opened PowerShell session.

### Credential theft or provider substitution

Control: there is no credential API or provider option. The hook/ConPTY broker uses Claude's already-authenticated child and never reads or forwards an authentication header. It accepts exact model only as read-only context. The synthetic gateway has no network/header code. A future loopback gateway would need separate security approval.

### Unexpected extra billable work

Control: classification uses zero model tokens. The broker controller forwards once and has no retry; explicit user effort wins and ultracode is never activated. Internal pilot limits remain explicit. Residual risk: stock Claude Code can perform normal multiple agentic requests and its own documented capability retries.

### Persistence

Control: broker status and `systemMessage` omit prompt text/hashes, replay state is memory-only, and current POCs write no prompt state. The stock UI deliberately displays the blocked original prompt, and the real Claude session follows Claude Code's normal transcript/service policies; operating-system memory, terminal logging, created files, and service-side handling remain outside this project.

### Benchmark-generated code

Control: every task gets a fresh copied workspace and direct verifier invocation. The first HumanEval pilot additionally protects verifier files, statically rejects dangerous Python constructs/imports/private access, runs candidate functions with restricted builtins under Python isolated mode, and enforces process timeouts. Residual risk: this is not a formal OS sandbox or memory cap. Do not generalize it to untrusted repositories; provide external container isolation first.

### Denial of service and oversized data

Control: prompt input is limited to 1 MiB, model profiles to 128 KiB, and combined Claude stdout/stderr to 32 MiB. Metadata reads are bounded and avoid a recursive filesystem walk.

## Telemetry policy

The default application has no analytics or telemetry. Future calibration telemetry must be strictly opt-in and should collect derived features/outcomes rather than raw prompts. Raw prompt collection requires separate consent, retention/deletion policy, access controls, and security review.

## Reporting issues

Do not include prompts, credentials, Claude configuration files, or raw private output in an issue. Reproduce with a synthetic task and include only public error codes and version information.
