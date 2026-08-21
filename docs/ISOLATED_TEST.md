# Isolated user test

This is the first live trial of the interactive broker. It is intentionally not a global installation.

## What the test changes

Running `scripts/start-isolated-test.ps1` opens a new PowerShell window and places a temporary `claude.cmd` shim first in `PATH` for that window only. The shim starts the real installed Claude Code CLI through the interactive broker. The real executable path is captured before the temporary shim is enabled, preventing recursion.

Closing the new window removes the temporary environment variables and restores normal command resolution. The script does not edit the machine or user `PATH`, Claude settings files, credentials, provider, model, or project files. A small generated shim remains under the ignored `.effort-autopilot/isolated-shim` development directory and can be deleted safely when no test window is open.

## Start the test

From the repository, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-isolated-test.ps1
```

A separate visible PowerShell window opens. In that window, enter any project directory and run the usual command:

```powershell
claude
```

Submit one ordinary task. Claude Code will visibly show its hook-block warning, Effort Autopilot will classify locally, apply and confirm the selected effort when supported, then replay the exact task once. The stock warning is an upstream UI limitation; it is not a model request. Broker status lines are English by default and switch to Spanish when the prompt itself is clearly Spanish; the parenthesized cause codes stay in English for diagnostics. Prompts in other languages get English status lines and typically fail open (`insufficient-confidence`), because the classifier's feature patterns currently cover English and Spanish only.

At startup the broker prints one line naming the session's pinned starting effort (taken from your local `effortLevel` setting, or `auto`); the pin is what keeps every automatic `/effort` session-only instead of saving your defaults. Mid-conversation escalations trigger the CLI's own `Change effort level?` confirmation, which the broker confirms itself.

## Precedence policy

By default (`manual-wins`), typing `/effort <level>` yourself latches your choice: later prompts pass through directly with a visible `explicit-user-effort` status, and `/effort auto` hands control back to the broker. To let the broker re-evaluate every prompt even over your manual choices, launch with the broker-owned flag (it is consumed, never forwarded to the real CLI):

```powershell
claude --autopilot autopilot-wins
```

Stock-CLI caveats you may notice: typing `/effort` yourself (with or without an argument, through the composer or its picker) saves the chosen level as your global default; and when the broker escalates mid-conversation, the CLI's confirmation dialog also saves the new level as your default — the broker reports this visibly (`The CLI's confirmation also saved this level as your default.`). Only the broker's own direct command path is session-scoped. A native session-only effort control is requested in the upstream proposal.

## Expected safety behavior

- The classifier makes no network or model call.
- Exact model and provider are inherited from Claude Code and never changed.
- The automatic effort change must be acknowledged before replay.
- The replay authorization is bound to the exact session and prompt and is consumed once.
- Unsupported or ambiguous model, low confidence, classification failure, timeout, or missing acknowledgement preserves Claude's active effort and forwards the task once.
- The prompt is held in memory during routing and is not written to telemetry.

A user-supplied `--settings` argument is combined additively (your hooks run first, the broker's are appended; everything else is preserved). A settings value that cannot be combined safely, `--print`, and `--resume`/`--continue` launches all print a visible notice and run Claude completely unchanged instead of degrading it.

## Stop or remove

Exit Claude and close the isolated PowerShell window. No global uninstall is necessary. Optionally remove the ignored development shim after the window is closed:

```powershell
Remove-Item -LiteralPath .\.effort-autopilot\isolated-shim -Recurse -Force
```

Do not globally replace `claude` until the live trial has confirmed normal prompt, permission, editor, cancellation, and resume behavior.
