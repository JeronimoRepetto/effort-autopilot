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

Submit one ordinary task. Claude Code will visibly show its hook-block warning, Effort Autopilot will classify locally, apply and confirm the selected effort when supported, then replay the exact task once. The stock warning is an upstream UI limitation; it is not a model request.

## Expected safety behavior

- The classifier makes no network or model call.
- Exact model and provider are inherited from Claude Code and never changed.
- The automatic effort change must be acknowledged before replay.
- The replay authorization is bound to the exact session and prompt and is consumed once.
- Unsupported or ambiguous model, low confidence, classification failure, timeout, or missing acknowledgement preserves Claude's active effort and forwards the task once.
- The prompt is held in memory during routing and is not written to telemetry.

The current isolated test does not combine a user-supplied `--settings` CLI argument. If that flag is present, the broker stops before opening Claude rather than silently overriding it.

## Stop or remove

Exit Claude and close the isolated PowerShell window. No global uninstall is necessary. Optionally remove the ignored development shim after the window is closed:

```powershell
Remove-Item -LiteralPath .\.effort-autopilot\isolated-shim -Recurse -Force
```

Do not globally replace `claude` until the live trial has confirmed normal prompt, permission, editor, cancellation, and resume behavior.
