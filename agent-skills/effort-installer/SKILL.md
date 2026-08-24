---
name: effort-installer
description: >
  Changes the reversible installer, shim, PATH handling, settings merge, and broker startup fallback.
  Trigger: Installer, launch preflight, executable discovery, PATH, settings, or cleanup work.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: [root]
  auto_invoke: "Changing installer, shim, PATH handling, startup preflight, or settings merge"
---

## Required reading

Read [installation behavior](../../docs/INSTALL.md), [startup architecture](../../docs/ARCHITECTURE.md), [security](../../docs/SECURITY.md), and [troubleshooting](../../docs/TROUBLESHOOTING.md).

## Critical patterns

- Installation is explicit, reversible, and surgical. Never replace or rename the real `claude` executable.
- Preserve exact backups and remove only state the installer owns.
- Never write the user's Claude settings. Temporary merged settings are process-scoped artifacts and must be cleaned up.
- Treat user-authored JSON/settings as BOM-tolerant and refuse shapes that cannot be safely combined.
- Startup failures after passthrough validation degrade to an unchanged stock session with original arguments and a visible prompt-free cause.
- Keep executable discovery and PATH edits platform-exact. Do not generalize Windows and POSIX behavior without tests for both.
- The documented best-effort node-pty `spawn-helper` permission repair is narrow and never authorizes broader dependency or system mutation.

## Verification

```powershell
node --test test/installer.test.js test/broker-launch.test.js
node --test test/broker-setup-failopen.test.js test/pty-preflight.test.js
npm test
```
