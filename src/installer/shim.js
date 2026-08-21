/**
 * Shim file contents. The shim never freezes the real Claude path: the broker
 * re-resolves it on every launch (skipping the shim directory), so Claude
 * updates keep working without reinstalling.
 */

function quoted(value) {
  return `"${String(value)}"`;
}

export function windowsShimContent(nodeExecutable, brokerScript) {
  return `@echo off\r\n${quoted(nodeExecutable)} ${quoted(brokerScript)} %*\r\n`;
}

export function unixShimContent(nodeExecutable, brokerScript) {
  return `#!/bin/sh\nexec ${quoted(nodeExecutable)} ${quoted(brokerScript)} "$@"\n`;
}

export function shimContent(platform, nodeExecutable, brokerScript) {
  return platform === "win32"
    ? windowsShimContent(nodeExecutable, brokerScript)
    : unixShimContent(nodeExecutable, brokerScript);
}
