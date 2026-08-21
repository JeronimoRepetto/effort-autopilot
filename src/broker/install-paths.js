import os from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * Canonical on-disk locations shared by the installer CLI and the broker.
 * Windows keeps everything under %LOCALAPPDATA%\effort-autopilot; other
 * platforms use ~/.effort-autopilot. Nothing here touches the filesystem.
 */

export function installRoot({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return path.join(base, "effort-autopilot");
  }
  return path.join(home, ".effort-autopilot");
}

export function shimDirectory(options = {}) {
  return path.join(installRoot(options), "shim");
}

export function shimExecutablePath(options = {}) {
  const { platform = process.platform } = options;
  return path.join(shimDirectory(options), platform === "win32" ? "claude.cmd" : "claude");
}

export function globalConfigPath(options = {}) {
  return path.join(installRoot(options), "config.json");
}

export function pathBackupPath(options = {}) {
  return path.join(installRoot(options), "path-backup.json");
}
