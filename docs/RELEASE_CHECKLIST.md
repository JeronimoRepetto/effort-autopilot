# Release checklist

Publication is a deliberate, user-authorized act. Nothing below runs automatically, and `private: true` stays in `package.json` until the moment of publication.

## Pre-publication gates

1. Full local suite green (`npm test`) and the installed-CLI zero-inference diagnostic green (`npm run broker:poc:installed-zero-inference`).
2. Lint clean (`npm run lint`) and formatting clean (`npm run format:check`).
3. `npm pack --dry-run` — inspect the file list against the `files` whitelist: only the installer CLI, internal broker entrypoints, `src/broker`, `src/core`, `src/installer`, the public docs, LICENSE, and README. No benchmark payloads, evaluation manifests, legacy launcher, or scripts.
4. License review: package MIT; `node-pty` MIT; any bundled or downloaded ML artifact license verified and recorded.
5. [Security notes](SECURITY.md) reviewed against the shipped surface (installer PATH mutation, shim, IPC, disclosure messages).
6. README and [INSTALL.md](INSTALL.md) describe only shipped behavior; platform support matrix is current (macOS still unverified unless proven).
7. Version bumped intentionally; `git tag` matches; working tree clean and pushed.

## Publication

```powershell
# 1. Remove "private": true from package.json (single deliberate edit).
# 2. Scoped packages default to restricted; this package is public:
npm publish --access public
# 3. Restore nothing: the published state is the tagged commit.
```

## Post-publication

- Install from the registry on a clean machine/profile: `npm install -g @jeronimorepetto/claude-effort-autopilot`, then `effort-autopilot install`, smoke test, `effort-autopilot uninstall`.
- Create the GitHub release pointing at the tag.
- Record the published version and date here.

| Version | Date | Notes |
| --- | --- | --- |
| — | — | Not published yet |
