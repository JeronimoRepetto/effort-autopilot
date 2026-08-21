import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function platformName(value) {
  if (value === "win32") return "windows";
  if (value === "darwin") return "macos";
  if (value === "linux") return "linux";
  return "unknown";
}

function readTextIfPresent(filePath, maxBytes = 256 * 1024) {
  if (!existsSync(filePath)) return null;
  const value = readFileSync(filePath, "utf8");
  return value.length <= maxBytes ? value : value.slice(0, maxBytes);
}

function countGitFiles(cwd, spawn = spawnSync) {
  const result = spawn("git", ["-C", cwd, "ls-files", "-z"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
  if (!result.stdout) return 0;
  return result.stdout.split("\0").filter(Boolean).length;
}

/** Collect bounded, cheap, local-only metadata. Never walks the full tree. */
export function collectEnvironmentMetadata(
  cwd,
  { runtimePlatform = process.platform, spawn = spawnSync } = {},
) {
  const resolvedCwd = path.resolve(cwd);
  const projectKinds = [];
  const packageText = readTextIfPresent(path.join(resolvedCwd, "package.json"));
  let packageJson = null;
  if (packageText) {
    projectKinds.push("javascript");
    try {
      packageJson = JSON.parse(packageText);
    } catch {
      packageJson = null;
    }
    if (/\b(?:electron|@tauri-apps\/api)\b/i.test(packageText)) {
      projectKinds.push("desktop-app");
    }
  }
  if (existsSync(path.join(resolvedCwd, "pyproject.toml"))) projectKinds.push("python");
  if (existsSync(path.join(resolvedCwd, "Cargo.toml"))) projectKinds.push("rust");
  if (existsSync(path.join(resolvedCwd, "go.mod"))) projectKinds.push("go");
  try {
    if (readdirSync(resolvedCwd).some((name) => name.endsWith(".sln"))) {
      projectKinds.push("dotnet");
    }
  } catch {
    // An unreadable directory simply contributes no project-kind signal.
  }

  return Object.freeze({
    platform: platformName(runtimePlatform),
    repositoryFileCount: countGitFiles(resolvedCwd, spawn),
    projectKinds: Object.freeze([...new Set(projectKinds)]),
    multiProject: Boolean(packageJson?.workspaces) || new Set(projectKinds).size > 1,
    permissionsSensitive: projectKinds.includes("desktop-app"),
  });
}
