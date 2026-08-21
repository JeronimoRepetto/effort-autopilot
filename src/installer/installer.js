import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

import { AUTOPILOT_POLICIES } from "../broker/claude-args.js";
import { findRealClaudeExecutable } from "../broker/claude-locator.js";
import {
  globalConfigPath,
  installRoot,
  pathBackupPath,
  shimDirectory,
  shimExecutablePath,
} from "../broker/install-paths.js";
import { readGlobalConfig } from "../broker/project-config.js";
import {
  containsPathEntry,
  hasProfileBlock,
  prependPathEntry,
  removePathEntry,
  removeProfileBlock,
  upsertProfileBlock,
} from "./path-edit.js";
import { shimContent } from "./shim.js";

const packageRoot = path.resolve(import.meta.dirname, "..", "..");
const brokerScript = path.join(packageRoot, "bin", "internal-interactive-broker.js");

// ---------------------------------------------------------------------------
// Windows user PATH (registry): read the RAW value so REG_EXPAND_SZ entries
// like %USERPROFILE% are never expanded and destroyed on rewrite. `setx` is
// never used (it truncates at 1024 characters).
// ---------------------------------------------------------------------------

export function readWindowsUserPath() {
  try {
    const output = execFileSync("reg.exe", ["query", "HKCU\\Environment", "/v", "Path"], {
      encoding: "utf8",
    });
    const match = output.match(/^\s*Path\s+(REG_SZ|REG_EXPAND_SZ)\s+(.*)$/mu);
    if (!match) return { type: "REG_EXPAND_SZ", value: "" };
    return { type: match[1], value: match[2].replace(/\r$/u, "") };
  } catch {
    return { type: "REG_EXPAND_SZ", value: "" };
  }
}

function writeWindowsUserPath(type, value) {
  execFileSync(
    "reg.exe",
    ["add", "HKCU\\Environment", "/v", "Path", "/t", type, "/d", value, "/f"],
    { stdio: "ignore" },
  );
}

function broadcastEnvironmentChange() {
  const script = [
    "$sig='[DllImport(\"user32.dll\",SetLastError=true,CharSet=CharSet.Auto)]public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,uint fuFlags,uint uTimeout,out UIntPtr lpdwResult);'",
    "Add-Type -MemberDefinition $sig -Name NativeMethods -Namespace Win32EnvBroadcast | Out-Null",
    "[UIntPtr]$result=[UIntPtr]::Zero",
    "[Win32EnvBroadcast.NativeMethods]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,5000,[ref]$result) | Out-Null",
  ].join("; ");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: "ignore",
      timeout: 15_000,
    });
  } catch {
    // Best effort: without the broadcast, terminals opened from Explorer see
    // the new PATH only after re-login. The registry change itself succeeded.
  }
}

// ---------------------------------------------------------------------------
// Unix shell profile (marked block, surgical removal, one-time backup).
// ---------------------------------------------------------------------------

export function selectShellProfile({ env = process.env, home = os.homedir() } = {}) {
  const shell = path.basename(env.SHELL ?? "");
  if (shell === "zsh") return path.join(home, ".zshrc");
  if (shell === "bash") return path.join(home, ".bashrc");
  return path.join(home, ".profile");
}

// ---------------------------------------------------------------------------
// Consent and prompts
// ---------------------------------------------------------------------------

async function confirm(question, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [yes/no] `)).trim().toLowerCase();
    return answer === "yes" || answer === "y" || answer === "si" || answer === "sí";
  } finally {
    rl.close();
  }
}

async function askPolicy({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, output });
  try {
    output.write(
      "Precedence policy:\n" +
        "  1. manual-wins    — your own /effort choice disables automation (default)\n" +
        "  2. autopilot-wins — the autopilot re-evaluates every prompt, even over manual choices\n",
    );
    const answer = (await rl.question("Choose [1/2] (1): ")).trim();
    return answer === "2" ? "autopilot-wins" : "manual-wins";
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function runInstall({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  policyFlag = null,
  assumeYes = false,
  output = process.stdout,
  input = process.stdin,
} = {}) {
  const options = { platform, env, home };
  const shimDir = shimDirectory(options);
  const shimPath = shimExecutablePath(options);

  if (platform !== "win32") {
    output.write(
      platform === "darwin"
        ? "Note: macOS support is implemented but NOT yet verified on real hardware.\n"
        : "Note: Linux support is verified via WSL only.\n",
    );
  }

  let realClaude;
  try {
    realClaude = findRealClaudeExecutable({ platform, env });
  } catch (error) {
    output.write(`Cannot install: ${error.message}\n`);
    return 1;
  }

  const profileFile = platform === "win32" ? null : selectShellProfile({ env, home });
  output.write(
    "Effort Autopilot will:\n" +
      `  1. create a reversible shim at ${shimPath}\n` +
      (platform === "win32"
        ? "  2. prepend that directory to your USER Path (registry HKCU\\Environment; exact backup kept)\n"
        : `  2. add a marked PATH block to ${profileFile} (backup kept)\n`) +
      `  3. keep using your real Claude at ${realClaude} — never replaced or renamed\n` +
      "Everything is undone by 'effort-autopilot uninstall'.\n",
  );
  if (!assumeYes) {
    if (!input.isTTY) {
      output.write("Refusing to install without explicit consent (non-interactive; pass --yes).\n");
      return 1;
    }
    if (!(await confirm("Proceed?", { input, output }))) {
      output.write("Installation cancelled; nothing was changed.\n");
      return 1;
    }
  }

  let policy = policyFlag;
  if (!AUTOPILOT_POLICIES.includes(policy)) {
    policy = assumeYes || !input.isTTY ? "manual-wins" : await askPolicy({ input, output });
  }

  mkdirSync(shimDir, { recursive: true });
  writeFileSync(shimPath, shimContent(platform, process.execPath, brokerScript), {
    encoding: "utf8",
  });
  if (platform !== "win32") chmodSync(shimPath, 0o755);
  writeFileSync(globalConfigPath(options), `${JSON.stringify({ policy }, null, 2)}\n`, {
    encoding: "utf8",
  });

  if (platform === "win32") {
    const current = readWindowsUserPath();
    writeFileSync(
      pathBackupPath(options),
      `${JSON.stringify({ savedAt: new Date().toISOString(), ...current }, null, 2)}\n`,
      { encoding: "utf8" },
    );
    if (!containsPathEntry(current.value, shimDir)) {
      writeWindowsUserPath(current.type, prependPathEntry(current.value, shimDir));
      broadcastEnvironmentChange();
    }
  } else {
    const backup = `${profileFile}.effort-autopilot.bak`;
    const existing = existsSync(profileFile) ? readFileSync(profileFile, "utf8") : "";
    if (existing && !existsSync(backup)) copyFileSync(profileFile, backup);
    writeFileSync(profileFile, upsertProfileBlock(existing, shimDir), { encoding: "utf8" });
  }

  output.write(
    `Installed (policy: ${policy}). Open a NEW terminal and run 'claude' normally.\n` +
      'Disable per project with .effort-autopilot.json {"enabled": false}.\n',
  );
  return 0;
}

export async function runUninstall({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  output = process.stdout,
} = {}) {
  const options = { platform, env, home };
  const shimDir = shimDirectory(options);

  if (platform === "win32") {
    const current = readWindowsUserPath();
    if (containsPathEntry(current.value, shimDir)) {
      writeWindowsUserPath(current.type, removePathEntry(current.value, shimDir));
      broadcastEnvironmentChange();
    }
  } else {
    const profileFile = selectShellProfile({ env, home });
    if (existsSync(profileFile)) {
      writeFileSync(profileFile, removeProfileBlock(readFileSync(profileFile, "utf8")), {
        encoding: "utf8",
      });
    }
  }
  rmSync(shimDir, { recursive: true, force: true });
  output.write(
    "Uninstalled: shim removed and PATH restored. " +
      `Config and backups remain under ${installRoot(options)} and can be deleted safely.\n`,
  );
  return 0;
}

export async function runStatus({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  output = process.stdout,
} = {}) {
  const options = { platform, env, home };
  const shimDir = shimDirectory(options);
  const shimPresent = existsSync(shimExecutablePath(options));
  let pathActive;
  if (platform === "win32") {
    pathActive = containsPathEntry(readWindowsUserPath().value, shimDir);
  } else {
    const profileFile = selectShellProfile({ env, home });
    pathActive = existsSync(profileFile) && hasProfileBlock(readFileSync(profileFile, "utf8"));
  }
  let realClaude = null;
  try {
    realClaude = findRealClaudeExecutable({ platform, env });
  } catch {
    // stays null: not found is a reportable state, not an error
  }
  const globalPolicy = readGlobalConfig(options).policy ?? null;
  output.write(
    `${JSON.stringify(
      {
        platform,
        installRoot: installRoot(options),
        shimPresent,
        pathActive,
        installed: shimPresent && pathActive,
        realClaude,
        policy: globalPolicy ?? "manual-wins",
        policySource: globalPolicy ? "global config" : "default",
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

export async function runSetPolicy(
  policy,
  {
    platform = process.platform,
    env = process.env,
    home = os.homedir(),
    output = process.stdout,
  } = {},
) {
  if (!AUTOPILOT_POLICIES.includes(policy)) {
    output.write(`Unknown policy '${policy}'. Valid: ${AUTOPILOT_POLICIES.join(", ")}.\n`);
    return 1;
  }
  const options = { platform, env, home };
  mkdirSync(installRoot(options), { recursive: true });
  writeFileSync(globalConfigPath(options), `${JSON.stringify({ policy }, null, 2)}\n`, {
    encoding: "utf8",
  });
  output.write(`Global policy set to ${policy}.\n`);
  return 0;
}
