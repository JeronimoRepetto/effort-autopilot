import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PILOT_HELP } from "../src/cli/pilot-main.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : [];
  });
}

function localMarkdownTargets(source) {
  const targets = [];
  const pattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
  for (const match of source.matchAll(pattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    targets.push(decodeURIComponent(target.split("#")[0]));
  }
  return targets;
}

test("all local documentation links resolve", () => {
  const files = [path.join(root, "README.md"), ...markdownFiles(path.join(root, "docs"))];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const target of localMarkdownTargets(source)) {
      const absolute = path.resolve(path.dirname(file), target);
      assert.ok(existsSync(absolute), `${path.relative(root, file)} -> ${target}`);
      assert.ok(statSync(absolute).isFile() || statSync(absolute).isDirectory());
    }
  }
});

test("documentation index covers every focused guide", () => {
  const index = readFileSync(path.join(root, "docs", "README.md"), "utf8");
  const required = [
    "PRODUCT.md",
    "STOCK_HOST_FEASIBILITY.md",
    "UPSTREAM_CAPABILITY_PROPOSAL.md",
    "ARCHITECTURE.md",
    "CLASSIFIER.md",
    "CLI.md",
    "CLAUDE_TRANSPORT.md",
    "PILOT.md",
    "LIVE_PILOT_READINESS.md",
    "PLUGIN.md",
    "SECURITY.md",
    "DEVELOPMENT.md",
    "TROUBLESHOOTING.md",
    "MODULE_REFERENCE.md",
    "HOST_ADAPTERS.md",
    "ADAPTER_DECISION.md",
    "CALIBRATION.md",
  ];
  for (const name of required) assert.match(index, new RegExp(`\\(${name}\\)`));
});

test("legacy launcher is internal and package exports no user-facing binary", () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const guide = readFileSync(path.join(root, "docs", "CLI.md"), "utf8");
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  assert.equal(packageJson.private, true);
  assert.equal(Object.hasOwn(packageJson, "bin"), false);
  assert.match(guide, /Not an end-user product or fallback/i);
  assert.match(readme, /old one-shot launcher has been rejected/i);
  assert.doesNotMatch(readme, /npm install --global/);
});

test("proposed live manifest is pinned, inert, and exactly five public tasks", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "evaluation", "live-pilot-humaneval-5.json"), "utf8"),
  );
  assert.equal(manifest.source.repository, "https://github.com/openai/human-eval");
  assert.match(manifest.source.commit, /^[0-9a-f]{40}$/);
  assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.source.license, "MIT");
  assert.deepEqual(manifest.tasks.map(({ id }) => id), [
    "HumanEval/53",
    "HumanEval/0",
    "HumanEval/140",
    "HumanEval/32",
    "HumanEval/129",
  ]);
  assert.equal(manifest.tasks.length, 5);
  for (const task of manifest.tasks) {
    assert.match(task.workspaceSource, /^\.effort-autopilot\//);
    assert.ok(task.timeoutMs > 0);
    assert.ok(task.verifier.timeoutMs > 0);
    assert.ok(["low", "medium", "high"].includes(task.ceiling));
    assert.ok(task.protectedFiles.includes("verify_task.py"));
    assert.equal(task.safeMode, true);
    assert.deepEqual(task.tools, ["Read", "Edit", "Write"]);
    assert.deepEqual(task.allowedTools, ["Read", "Edit", "Write"]);
  }
});

test("documented pilot commands and gates match implemented help", () => {
  const guide = readFileSync(path.join(root, "docs", "PILOT.md"), "utf8");
  for (const value of [
    "dry-run",
    "run",
    "resume",
    "status",
    "--live",
    "--confirm-subscription-use",
    "--model",
    "--inherit-model",
    "--max-runs",
    "--max-total-cost-usd",
    "--max-total-output-tokens",
  ]) {
    assert.match(PILOT_HELP, new RegExp(value));
    assert.match(guide, new RegExp(value));
  }
});

test("plugin documentation and manifest truthfully exclude an automatic hook", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const guide = readFileSync(path.join(root, "docs", "PLUGIN.md"), "utf8");
  assert.equal(Object.hasOwn(manifest, "hooks"), false);
  assert.match(manifest.description, /no automatic hook/i);
  assert.match(guide, /no packaged `UserPromptSubmit` hook/i);
});

test("stock CLI audit and upstream draft preserve the exact decision boundary", () => {
  const audit = readFileSync(
    path.join(root, "docs", "STOCK_HOST_FEASIBILITY.md"),
    "utf8",
  );
  const manifest = JSON.parse(
    readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const proposal = readFileSync(
    path.join(root, "docs", "UPSTREAM_CAPABILITY_PROPOSAL.md"),
    "utf8",
  );
  assert.match(audit, /plugin hook cannot set the same pending turn's effort/i);
  assert.match(audit, /ANTHROPIC_BASE_URL/);
  assert.match(audit, /pure PTY byte parser is not production-safe/i);
  assert.match(audit, /hybrid works mechanically on the installed CLI without inference/i);
  assert.match(audit, /replayReachedDiagnosticBlock/);
  assert.match(audit, /Set effort level to max/);
  assert.match(proposal, /DRAFT/i);
  assert.match(proposal, /not been submitted to Anthropic/i);
  assert.match(proposal, /turnEffortOverride/);
  assert.match(proposal, /"subtype": "turn_dispatch"/);
  assert.match(audit, /UPSTREAM_CAPABILITY_PROPOSAL\.md/);
  assert.equal(Object.hasOwn(manifest, "hooks"), false);
});
