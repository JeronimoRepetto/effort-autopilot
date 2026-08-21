# Internal legacy launcher CLI

> **Not an end-user product or fallback.** The user rejected this one-shot UX. The package exports no launcher binary; this document exists only for internal benchmark and regression reproducibility.

## Commands

```text
effort-autopilot [options] "prompt"
effort-autopilot run [options] "prompt"
effort-autopilot --stdin [options]
effort-autopilot classify < prompt.txt
effort-autopilot classify-json < envelope.json
```

`run` is optional and one-shot. `classify` treats all stdin as the prompt. `classify-json` accepts the host-neutral envelope and safely returns the fallback object for malformed input.

## Run options

| Option | Meaning |
| --- | --- |
| `--ceiling <level>` | Highest executable effort; default `medium` |
| `--baseline <level>` | Candidate on classifier failure; default `medium` |
| `--model <id>` | Explicit Claude model override; omitted by default |
| `--model-profile <file>` | Local JSON capability/calibration profile, maximum 128 KiB |
| `--cwd <path>` | Project metadata and Claude working directory |
| `--max-turns <n>` | Positive Claude Code execution turn limit |
| `--max-budget-usd <amount>` | Positive Claude Code execution budget |
| `--permission-mode <mode>` | `manual`, `acceptEdits`, `plan`, or `dontAsk` |
| `--stdin` | Read prompt from stdin instead of arguments |
| `--dry-run` | Return the routing plan without starting Claude |
| `--json` | Emit one machine-readable routing/execution object |
| `--quiet`, `-q` | Suppress routing and usage summaries; print only Claude's final result |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |

Valid effort values are `low`, `medium`, `high`, `xhigh`, and `max`. Ultracode is not valid for `--ceiling` or `--baseline` because it is not an effort setting.

Environment defaults are `EFFORT_AUTOPILOT_CEILING` and `EFFORT_AUTOPILOT_BASELINE`; explicit CLI values win.

## Prompt handling

Argument prompts are joined with spaces. Use `--stdin` for multi-line tasks and to avoid shell quoting. `--` ends option parsing when prompt text begins with a dash. Input is limited to 1 MiB. Empty input, conflicting stdin/argument input, unknown flags, invalid effort values, and invalid numeric values fail before Claude starts.

```powershell
Get-Content .\task.txt -Raw | effort-autopilot --stdin --ceiling medium
effort-autopilot -- --prompt-text-that-begins-with-a-dash
```

On macOS or Linux:

```sh
effort-autopilot --stdin --ceiling medium < task.txt
```

The process adapter uses an argument array with shell execution disabled, so paths and model IDs are not reinterpreted by a shell.

## Output

Default mode writes the Claude result to stdout. Before execution it writes the chosen effort and up to three reasons to stderr; after execution it writes turns and estimated cost to stderr. This separation permits result piping.

`--quiet` removes both summaries. `--dry-run` never calls Claude. `--json` writes one object containing `routing` and `execution`; the latter includes Claude's output, session ID if reported, turns, usage, model usage, cost estimate, and stop metadata. JSON output may therefore be private even though routing data alone is prompt-free.

## Exit behavior and error codes

The CLI exits `0` for successful execution, help/version, dry-run, and safe `classify-json` fallback. It exits `1` for invalid launcher input or Claude execution failure.

Adapter error codes include `claude-not-found`, `process-start-failed`, `output-limit`, `cli-execution-failed`, Claude-reported error subtypes, and `subscription-limit`. Public CLI errors do not include the prompt or raw Claude stderr. There is no automatic retry.

## Model and provider preservation

When `--model` is absent, the adapter does not add a model flag. The new Claude process resolves its model and provider using its normal CLI configuration and inherited environment. The launcher has no provider-switching option. An explicit `--model` is passed through verbatim; the launcher does not translate it to another provider or model.

The local `--model-profile` affects the recommendation and compatibility metadata only. It never changes which model is launched.
