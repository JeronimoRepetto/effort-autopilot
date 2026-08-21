#!/usr/bin/env node
import process from "node:process";

import {
  runInstall,
  runSetPolicy,
  runStatus,
  runUninstall,
} from "../src/installer/installer.js";

const HELP = `Effort Autopilot — transparent effort broker for the Claude Code CLI

Usage: effort-autopilot <command>

Commands:
  install [--policy <manual-wins|autopilot-wins>] [--yes]
              Install the reversible 'claude' shim (asks for explicit consent).
  uninstall   Remove the shim and restore your PATH exactly.
  status      Show platform, install state, real Claude path, and policy.
  policy <manual-wins|autopilot-wins>
              Change the global precedence policy without reinstalling.
  help        Show this message.

Per-project control: put .effort-autopilot.json in a project root with
{"enabled": false} to disable the broker there, or {"policy": "..."} to
override the policy for that project.
`;

const [command, ...rest] = process.argv.slice(2);

function flagValue(name) {
  const index = rest.indexOf(name);
  if (index >= 0) return rest[index + 1] ?? null;
  const inline = rest.find((argument) => argument.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : null;
}

try {
  switch (command) {
    case "install":
      process.exitCode = await runInstall({
        policyFlag: flagValue("--policy"),
        assumeYes: rest.includes("--yes"),
      });
      break;
    case "uninstall":
      process.exitCode = await runUninstall({});
      break;
    case "status":
      process.exitCode = await runStatus({});
      break;
    case "policy":
      process.exitCode = await runSetPolicy(rest[0] ?? "");
      break;
    case "help":
    case undefined:
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      break;
    default:
      process.stderr.write(`Unknown command '${command}'.\n\n${HELP}`);
      process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`effort-autopilot: ${error.message}\n`);
  process.exitCode = 1;
}
