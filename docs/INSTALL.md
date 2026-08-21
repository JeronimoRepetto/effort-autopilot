# Installation

Effort Autopilot installs as a reversible `claude` shim: your real Claude Code CLI is never replaced, renamed, or modified, and one command undoes everything. The package is not published to npm yet, so the commands below run from a repository checkout with `node bin/effort-autopilot-cli.js <command>`; once published, the same commands are `effort-autopilot <command>`.

## Install

```powershell
node bin/effort-autopilot-cli.js install
```

The installer asks for explicit consent, asks which precedence policy you want, and then:

1. writes a small shim (`claude.cmd` on Windows, a `claude` shell script elsewhere) into the install root;
2. puts the shim directory first on your PATH — on Windows by editing the **user** `Path` registry value (raw type preserved, exact backup saved to `path-backup.json`, change broadcast to running shells); on macOS/Linux by adding a marked `# effort-autopilot begin/end` block to your shell profile (`.zshrc`/`.bashrc`/`.profile`, backup kept);
3. saves the chosen policy to `config.json` in the install root.

Install roots: `%LOCALAPPDATA%\effort-autopilot` on Windows, `~/.effort-autopilot` elsewhere. After installing, open a **new** terminal and run `claude` normally in any project.

Non-interactive automation can pass `--yes --policy manual-wins|autopilot-wins`.

## Uninstall / status / policy

```powershell
node bin/effort-autopilot-cli.js uninstall   # removes the shim and PATH entry surgically
node bin/effort-autopilot-cli.js status      # platform, install state, real Claude path, policy
node bin/effort-autopilot-cli.js policy autopilot-wins   # change the global policy any time
```

Uninstall removes only Effort Autopilot's own PATH entry/profile block; every other segment is preserved verbatim (the saved backups remain as a safety net and can be deleted).

## Precedence policy

- `manual-wins` (default): your own `/effort` choice disables automation for the session; `/effort auto` hands control back.
- `autopilot-wins`: the broker re-evaluates every prompt, even over manual choices.

Resolution order: `--autopilot` launch flag > project `.effort-autopilot.json` > global `config.json` > `manual-wins`.

## Per-project control

Create `.effort-autopilot.json` in a project root:

```json
{ "enabled": false }
```

disables the broker for that project (Claude runs completely unchanged, with a visible notice). Optionally set a per-project policy instead:

```json
{ "policy": "autopilot-wins" }
```

## How the shim stays safe

- The shim never freezes the real Claude path: on every launch the broker resolves `claude` again and skips its own shim directory, so Claude updates keep working.
- If resolution ever loops back to the shim, a recursion guard aborts with a clear error instead of looping.
- Launch shapes the broker cannot handle safely (`--print`, `--resume`/`--continue`, an uncombinable `--settings`, project opt-out) run Claude completely unchanged with a visible notice.

## Platform support

| Platform | Status |
| --- | --- |
| Windows 10/11 | Verified live (development machine) |
| Linux | Implemented; verified via WSL only |
| macOS | Implemented; **not yet verified on real hardware** — the installer warns |
