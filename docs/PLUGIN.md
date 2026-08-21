# Historical native plugin scaffold and manual skills

The repository retains a valid Claude Code plugin manifest, marketplace entry, and six manual routing skills for regression/format validation. It is not the product, is not recommended for end-user installation, and contains no packaged `UserPromptSubmit` hook.

## Why it cannot implement the intended product today

A prompt hook runs in Claude Code's lifecycle but cannot truthfully guarantee mutation of the main agent's effort before that same first model execution. The installed-behavior test and official API gap are recorded in the [stock-host feasibility audit](STOCK_HOST_FEASIBILITY.md). Asking Claude to semantically route, invoking a subagent only to choose effort, or repeating the task would consume model tokens and could defeat the savings goal.

The intended product is the transparent CLI broker. This scaffold is useful only for manual format experiments and makes no automatic effort-change or savings claim.

## Bundled skills

`skills/route-low`, `route-medium`, `route-high`, `route-xhigh`, and `route-max` correspond to documented effort levels. `route-ultracode` records the xhigh/orchestration distinction. All are manual and do not alter broker behavior.

## Validation

```powershell
claude plugin validate .
claude plugin validate .\skills
```

Validation checks historical file formats, not broker behavior.

Do not install this scaffold for normal use. If it was installed during earlier development, remove it with the official `claude plugin uninstall` command and remove its local marketplace registration. This does not affect the future broker because no broker is globally installed yet.
