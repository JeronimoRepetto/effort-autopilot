---
name: route-ultracode
description: Internal Effort Autopilot fallback for a task classified as ultracode-worthy.
disable-model-invocation: true
effort: xhigh
---

Effort Autopilot classified the current task as **ultracode-worthy**.

Ultracode is a session-level Claude Code orchestration setting, not a model effort level, so this skill does not enable it. This skill genuinely requests **xhigh** as the supported fallback. Use dynamic ultracode workflows only if the session already has ultracode enabled; otherwise continue the original task at the effective xhigh-or-lower level without claiming ultracode was applied.
