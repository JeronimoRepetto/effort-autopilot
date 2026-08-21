# First live pilot readiness

Status: fixtures and canonical verifiers are ready; the manifest is inert unless the live command includes both confirmation gates. This document records the exact five-task pilot approved for the first run.

## Source, pin, and license

All five tasks come from the official [OpenAI HumanEval repository](https://github.com/openai/human-eval), pinned to commit `6d43fb980f9fee3c892a914eda09951f772ad10d`. The source archive is `data/HumanEval.jsonl.gz` with SHA-256 `b796127e635a67f93fb35c04f4cb03cf06f38c8072ee7cee8833d7bee06979ef`. The repository and dataset are distributed under the [MIT license at that pin](https://github.com/openai/human-eval/blob/6d43fb980f9fee3c892a914eda09951f772ad10d/LICENSE).

The repository commits only task IDs, pin/checksum, loader logic, and manifest metadata. `npm run pilot:prepare-live` downloads the public payload to `.effort-autopilot/`, verifies its checksum, and generates ignored local fixtures. Benchmark prompts/tests are not republished in the package.

## Exact five tasks

The tasks are ordered from very small plumbing checks to materially more involved algorithmic work. HumanEval does not publish authoritative difficulty labels; the descriptions below are structural judgments for this pilot, not ground-truth effort labels.

| Order | Public ID | Task surface | Calibration start | Applied ceiling | Claude timeout | Max turns | Verifier |
| ---: | --- | --- | --- | --- | ---: | ---: | --- |
| 1 | `HumanEval/53` | integer addition; minimal edit/path sanity check | `low` | `low` | 120 s | 6 | `python -I -B verify_task.py`, 30 s |
| 2 | `HumanEval/0` | pairwise floating-point threshold search | `low` | `medium` | 180 s | 3 | same isolated verifier, 30 s |
| 3 | `HumanEval/140` | whitespace run transformation and edge cases | `medium` | `medium` | 180 s | 3 | same isolated verifier, 30 s |
| 4 | `HumanEval/32` | numerical polynomial root finding with randomized deterministic checks | `medium` | `high` | 240 s | 4 | same isolated verifier, 30 s |
| 5 | `HumanEval/129` | lexicographic grid-path reasoning | `high` | `high` | 300 s | 5 | same isolated verifier, 30 s |

`calibrationStartingEffort` is evaluation metadata for a later adaptive effort search. This first single-run pilot does not force that value: the local classifier decides, the task ceiling clamps it, and `baselineEffort` uses the same value only if classification fails. Current non-billable dry routing resolves the five tasks to `low`, `medium`, `medium`, `high`, and `high` respectively.

## Fixture and verifier checks

The loader generates one source workspace per task under `.effort-autopilot/benchmark-fixtures/humaneval/`. Each contains public `TASK.md`, an unsolved `candidate.py`, protected `verify_task.py`, and source provenance. Before declaring readiness, the loader proved for every task:

- the unsolved candidate fails;
- the pinned canonical solution passes;
- the test process exits within 30 seconds;
- no Claude/model call occurs.

The pilot copies each source into a fresh task workspace. It refuses to execute a verifier if `verify_task.py` or `SOURCE.json` differs from the immutable source copy. The verifier runs Python isolated mode (`-I`), disables bytecode output (`-B`), rejects top-level executable statements, decorators, classes, async functions, global/nonlocal declarations, unapproved imports, and private/dunder access, then executes candidate functions with a small builtin allowlist. Only the trusted official test body gets normal Python builtins.

This is defense in depth, not a formal OS/container sandbox. The official HumanEval project warns against running arbitrary model-generated code without robust sandboxing. Docker's Linux engine is not running on this Windows machine, so SWE-bench and its official Docker harness were deliberately excluded. The selected benign function tasks, AST/builtin restrictions, direct child process, fresh workspace, protected verifier, and hard timeout make this a bounded plumbing pilot; they are not the final untrusted-code evaluation architecture.

## Model behavior

Claude Code 2.1.238 is installed and its subscription authentication status succeeds. `ANTHROPIC_MODEL` is not set in the launcher process. Claude Code has no documented non-inference command that prints the fully resolved account-default model before a new session; `/status` or `/model` is interactive, and reading settings directly would cross the credential/configuration boundary this application avoids.

The approved command therefore uses `--inherit-model`. The launcher omits `--model` entirely, preserving Claude Code's configured/default provider and model resolution. The exact model actually used is printed and checkpointed from structured `modelUsage` after each completed execution when Claude supplies it. This favors provider/model preservation over pre-run version pinning; the result is a plumbing pilot, not yet a per-version calibration dataset.

## Visible command and output

Preparation is non-billable:

```powershell
npm run pilot:prepare-live
```

The live command is exactly five tasks and must be started in the explicitly visible PowerShell window:

```powershell
effort-autopilot-pilot run `
  --manifest evaluation/live-pilot-humaneval-5.json `
  --live --confirm-subscription-use --inherit-model `
  --max-runs 5 --permission-mode acceptEdits `
  --max-total-output-tokens 12000
```

The window prints the public benchmark/task ID, locally selected effort and ceiling reasons, inherited-model label before execution, actual model after execution when reported, verifier result, elapsed time, turns, token usage, and estimated cost when available. It never prints the public task prompt or any private prompt.

The 12,000 reported-output-token ceiling is cumulative and checked before the next task. Because Claude reports usage only after a task, the task currently running can cross that cumulative threshold; per-task turn and wall-clock limits remain the primary bounds.

After live attempts stopped at two and three turns before completing HumanEval/53, the separately authorized next resume changes only that task's cap to six turns. Its low effort ceiling and all other task controls remain unchanged.

### Max-turn diagnostic and correction

The six-turn attempt also returned `error_max_turns`, but its resulting `candidate.py` passed the protected official verifier. The working directory and edit target were therefore correct, and edits were permitted. Exact tool-by-tool history was not retained by the historical JSON/no-session-persistence path, so it is not possible to claim which six calls occurred. The evidence and Claude's documented semantics show a harness mismatch: `maxTurns` counts tool-use round trips, while the old prompt invited file inspection and the default tool surface allowed unnecessary exploration; the harness then required a clean final text result before verifying.

The corrected fixture tells Claude to read the target if needed, edit only `candidate.py`, and return immediately. Safe mode disables project customizations, and only pre-approved `Read`, `Edit`, and `Write` are exposed—no shell, search, subagent, skill, MCP, or test tool. The protected external verifier remains responsible for tests.

The verifier is now authoritative after `error_max_turns`, `error_max_budget_usd`, or launcher `execution-timeout` when a fully prepared workspace and unchanged protected verifier exist. A pass completes the benchmark trial but preserves the terminal agent outcome and absence of final result; a failure stays pending/stopped. Authentication and rate-limit outcomes never run the verifier. Prompt-free terminal turns, usage, model usage, cost, and stop reason are checkpointed when available.

HumanEval/53 was recovered from its existing six-turn workspace without a new Claude call. It is legitimately completed/pass with `agentOutcome: error_max_turns`, `finalResultAvailable: false`, `usageAvailable: false` (historical metrics were discarded by the old harness), and verifier-backed recovery provenance. The checkpoint is intentionally `awaiting-authorization` with four tasks pending; the next task is HumanEval/0.

## Checkpoint, stop, and resume

The atomic checkpoint is `.effort-autopilot/evaluation-results/humaneval-windows-pilot-5.json`; task copies are under `.effort-autopilot/evaluation-workspaces/humaneval-windows-pilot-5/`. Both are local and ignored.

Completed task IDs are never repeated by resume. Rate limit, execution timeout, launcher failure, or verifier process failure stops the current run without hidden retry. Verifier assertion failure is a completed failed trial. There is no automatic resume.

Status and an explicitly authorized later resume are:

```powershell
effort-autopilot-pilot status --manifest evaluation/live-pilot-humaneval-5.json --max-runs 5
effort-autopilot-pilot resume --manifest evaluation/live-pilot-humaneval-5.json --live --confirm-subscription-use --inherit-model --max-runs 5 --permission-mode acceptEdits
```

## Confirmation boundary

Preparing fixtures, dry classification, canonical verification, tests, and status are non-billable. Only the visible `run`/`resume` command containing `--live --confirm-subscription-use` may start Claude. The first five-task run received a separate user confirmation; any resume after a stop or any broader batch requires a new explicit instruction.
