import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Canonical on-disk locations shared by the installer CLI and the broker.
 * Windows keeps everything under %LOCALAPPDATA%\effort-autopilot; other
 * platforms use ~/.effort-autopilot. Nothing here touches the filesystem.
 *
 * Every helper honors its `platform` parameter for path semantics too (not
 * just for branching), so a win32 layout simulated on a POSIX host — and vice
 * versa — produces the exact separators of the target platform (issue #24).
 */

function pathFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function installRoot({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const p = pathFor(platform);
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? p.join(home, "AppData", "Local");
    return p.join(base, "effort-autopilot");
  }
  return p.join(home, ".effort-autopilot");
}

export function shimDirectory(options = {}) {
  const { platform = process.platform } = options;
  return pathFor(platform).join(installRoot(options), "shim");
}

export function shimExecutablePath(options = {}) {
  const { platform = process.platform } = options;
  return pathFor(platform).join(
    shimDirectory(options),
    platform === "win32" ? "claude.cmd" : "claude",
  );
}

export function globalConfigPath(options = {}) {
  const { platform = process.platform } = options;
  return pathFor(platform).join(installRoot(options), "config.json");
}

export function pathBackupPath(options = {}) {
  const { platform = process.platform } = options;
  return pathFor(platform).join(installRoot(options), "path-backup.json");
}
