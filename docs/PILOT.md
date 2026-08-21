# Internal visible evaluation pilot

> Contributor-only evaluation infrastructure. It is not packaged as an npm binary or offered as a product fallback.

## Purpose and status

`effort-autopilot-pilot` demonstrates and evaluates the complete lifecycle in a visible terminal. `evaluation/pilot-manifest.json` is a five-task **mock-only placeholder**. The separate inert `evaluation/live-pilot-humaneval-5.json` identifies the pinned first live subset; its public payload is generated only under the ignored local state directory. No live benchmark starts automatically.

## Commands

```text
effort-autopilot-pilot dry-run [options]
effort-autopilot-pilot run --live --confirm-subscription-use (--model <id> | --inherit-model) [options]
effort-autopilot-pilot resume --live --confirm-subscription-use (--model <id> | --inherit-model) [options]
effort-autopilot-pilot status [options]
```

The trial limit must be `1..10` and defaults to 5. Live mode requires both confirmation flags plus either an explicit model or an explicit decision to inherit Claude Code's configured/default model.

| Option | Meaning |
| --- | --- |
| `--manifest <file>` | Manifest path; default `evaluation/pilot-manifest.json` |
| `--max-runs <1-10>` | Maximum tasks considered; default 5 |
| `--ceiling <level>` | Per-task effort ceiling; default `medium` |
| `--baseline <level>` | Classification-failure candidate; default `medium` |
| `--model <id>` | Explicit model for reproducibility; alternative to inheritance |
| `--inherit-model` | Omit Claude's model flag and preserve configured/default resolution |
| `--max-total-cost-usd <value>` | Stop before the next trial once reported cumulative cost reaches the value |
| `--max-total-output-tokens <n>` | Stop before the next trial once reported output usage reaches the value |
| `--max-turns <n>` | Per-trial Claude Code turn limit |
| `--permission-mode <mode>` | `manual`, `acceptEdits`, `plan`, or `dontAsk` |
| `--results <file>` | Explicit ignored local checkpoint path |
| `--live` | Permit a real Claude Code execution |
| `--confirm-subscription-use` | Confirm subscription consumption; required with `--live` |

## Visible PowerShell dry-run

```powershell
Start-Process powershell -ArgumentList '-NoExit','-Command',"Set-Location 'C:\Users\jeron\Desktop\effort-autopilot'; effort-autopilot-pilot dry-run --max-runs 5"
```

The mock runner makes no network or Claude call and reports zero tokens/cost. Progress prints benchmark and task ID, selected effort, model label, concise reasons, verifier pass/fail, elapsed milliseconds, turns, token metrics, and cost estimate. It never prints the task prompt.

## Manifest contract

Top-level fields are `schemaVersion`, `benchmark`, optional `description`, and `tasks`. Every task needs a stable public `id`. Mock-only tasks may set `mockVerifierPass`.

A live task additionally needs:

```json
{
  "id": "public-task-id",
  "workspaceSource": ".local-fixtures/public-task-id",
  "promptFile": "TASK.md",
  "verifier": {
    "command": "npm",
    "args": ["test"]
  }
}
```

Tasks can override `ceiling`, `baselineEffort`, `maxTurns`, and `timeoutMs`. `calibrationStartingEffort` is metadata only. `protectedFiles` lists fixture files that must remain byte-identical to the immutable source before the verifier runs.

Paths are resolved from the launcher working directory; `promptFile` is resolved inside the copied workspace. Keep live fixtures and prompt files outside tracked repository content unless licensing and privacy review explicitly permits them. The verifier is invoked directly with shell execution disabled.

## Live lifecycle

For each pending task, the pilot:

1. checks cumulative cost/output ceilings before starting the next trial;
2. recreates a task-specific workspace by copying `workspaceSource`;
3. reads the task prompt into memory;
4. collects local metadata and resolves effort;
5. starts one Claude execution with the exact supplied model or deliberately inherited configured/default model;
6. validates protected files, then runs the verifier once after a successful Claude result;
7. records prompt-free metrics and atomically checkpoints.

A verifier failure is a completed benchmark trial, not a launcher error. A Claude/launcher failure leaves the task pending.

For workspace-producing tasks, the protected benchmark verifier is authoritative after the carefully enumerated terminal codes `error_max_turns`, `error_max_budget_usd`, and launcher `execution-timeout`. The pilot makes no second model call. If the protected verifier passes, it records a completed/pass trial with `agentOutcome`, `finalResultAvailable: false`, and `verifiedAfterTerminal: true`; this is not represented as a clean Claude success. If verification fails, the task remains pending and the stop records both outcomes. Authentication, subscription/rate-limit, uninitialized-workspace, unsafe/protected-file, and general execution failures never enter this recovery path.

## Checkpoint and result schema

The default result is `.effort-autopilot/evaluation-results/<benchmark>.json`; copied workspaces are under `.effort-autopilot/evaluation-workspaces/<benchmark>/`. The entire `.effort-autopilot/` tree is gitignored.

Checkpoint fields include schema version, benchmark, mock/live mode, exact model label, maximum runs, cumulative estimated cost/output tokens, stop reason, and completed trials. Each trial records public task ID, status, verifier outcome, agent outcome, final-result/usage availability, terminal-verification distinction, applied effort, classifier tier, model label, elapsed time, turns, cost estimate, and usage. It does not store the prompt or Claude's response.

On an incomplete execution, `lastError` stores only task ID, error kind/code, and planned effort.

Terminal errors now preserve prompt-free structured fields when Claude supplies them: turns, usage, model usage, estimated cost, stop reason, and verifier outcome. Historical attempts made before this change remain explicitly marked as having unavailable metrics.

## Resume and status

```powershell
effort-autopilot-pilot status --max-runs 5
effort-autopilot-pilot resume --live --confirm-subscription-use --inherit-model --max-runs 5
```

Resume verifies the checkpoint benchmark and mode, skips completed task IDs, and reruns only pending work. A partial pending workspace is deleted and recopied from the source. It never repeats a completed paid trial.

The summary distinguishes completed, pending, passed, failed, launcher errors, subscription-limit stops, and the final stop reason.

## Subscription and ceilings

HTTP 429 and recognizable subscription/rate-limit responses cause an immediate `subscription-limit` checkpoint and stop. There is no spin, wait, or automatic retry. Resume is a deliberate later command after allowance resets.

`--max-total-cost-usd` and `--max-total-output-tokens` are checked before the next task, using metrics returned by prior completed tasks. A current task can overshoot either cumulative threshold. When a cost ceiling is set, the remaining amount is also passed to Claude as `--max-budget-usd`. Usage/cost fields are absent or estimates when Claude does not report them; they are not prepaid-credit or billing guarantees.

## Isolation and safety

Workspace copying prevents one task from intentionally sharing the previous task's modified tree. The first HumanEval fixture adds AST/import/builtin restrictions, isolated Python mode, protected verifier files, and timeouts. These are not operating-system isolation: code, tests, verifier commands, and Claude tools can access resources allowed to the current user and Claude permission mode. Benchmarks requiring robust container isolation need a future benchmark adapter.

See [First live pilot readiness](LIVE_PILOT_READINESS.md) for the exact five tasks and operator command.

Before a live run, review the exact licensed task subset, immutable fixture revisions, verifier commands, explicit-or-inherited model behavior, permissions, run/turn/cost ceilings, and visible command. Do not broaden beyond the initial pilot without fresh authorization.
