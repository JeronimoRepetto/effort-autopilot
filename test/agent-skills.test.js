import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseSkillSource,
  renderAutoInvokeSection,
  replaceGeneratedSection,
  syncAgentSkills,
} from "../agent-skills/skill-sync/scripts/sync.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixtureSkill({
  name = "mock-skill",
  scope = "[root]",
  autoInvoke = '"Mock action"',
} = {}) {
  return `---
name: ${name}
description: >
  Mock skill used to exercise metadata parsing.
  Trigger: Mock work.
license: MIT
metadata:
  author: "Jeronimo Repetto"
  version: "1.0"
  scope: ${scope}
  auto_invoke: ${autoInvoke}
---

## Mock
`;
}

test("skill metadata supports inline scopes and multiple auto-invoke actions", () => {
  const source = fixtureSkill({
    autoInvoke: `
    - "Second action"
    - "First action"`,
  });
  const parsed = parseSkillSource(source, "mock-skill");
  assert.deepEqual(parsed.scopes, ["root"]);
  assert.deepEqual(parsed.actions, ["Second action", "First action"]);
  assert.equal(parsed.author, "Jeronimo Repetto");
  assert.equal(parsed.license, "MIT");
});

test("skill metadata rejects unknown scopes and mismatched folders", () => {
  assert.throws(
    () => parseSkillSource(fixtureSkill({ scope: "[broker]" }), "mock-skill"),
    /unsupported metadata\.scope 'broker'/,
  );
  assert.throws(() => parseSkillSource(fixtureSkill(), "different-folder"), /must match folder/);
});

test("generated auto-invoke sections are deterministic and marker-bounded", () => {
  const section = renderAutoInvokeSection(
    [
      { name: "z-skill", scopes: ["root"], actions: ["Z action", "A action"] },
      { name: "a-skill", scopes: ["root"], actions: ["A action"] },
    ],
    "root",
  );
  assert.ok(section.indexOf("| A action | `a-skill` |") < section.indexOf("| Z action |"));
  assert.match(section, /^<!-- skill-sync:start -->/);
  assert.match(section, /<!-- skill-sync:end -->$/);

  const original = `Header
<!-- skill-sync:start -->
old
<!-- skill-sync:end -->
Footer
`;
  const replaced = replaceGeneratedSection(original, section);
  assert.match(replaced, /^Header/);
  assert.match(replaced, /Footer\n$/);
  assert.doesNotMatch(replaced, /\nold\n/);
});

test("all repository Agent Skills use the maintained Effort Autopilot metadata", async () => {
  const skillsRoot = path.join(root, "agent-skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, entry.name, "SKILL.md");
    const source = await readFile(skillPath, "utf8");
    const parsed = parseSkillSource(source, entry.name);
    names.push(parsed.name);
    assert.equal(parsed.author, "Jeronimo Repetto");
    assert.equal(parsed.license, "MIT");
    assert.deepEqual(parsed.scopes, ["root"]);
    assert.match(parsed.description, /Trigger:/);

    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0].trim();
      if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(skillPath), decodeURIComponent(target));
      const targetStat = await stat(resolved);
      assert.ok(targetStat.isFile() || targetStat.isDirectory());
    }
  }
  assert.deepEqual(names.sort(), [
    "effort-autopilot",
    "effort-broker",
    "effort-classifier",
    "effort-docs",
    "effort-evaluation",
    "effort-host-adapter",
    "effort-installer",
    "effort-testing",
    "skill-creator",
    "skill-sync",
  ]);
});

test("CLAUDE.md imports the canonical AGENTS.md rules", async () => {
  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
  assert.match(claude, /^# Claude Code entrypoint/m);
  assert.match(claude, /^@AGENTS\.md$/m);
  assert.doesNotMatch(agents, /follow the rules in \[CLAUDE\.md\]/i);
  for (const contract of ["zero model tokens", "byte-for-byte exactly once", "GitHub Issues"]) {
    assert.match(agents, new RegExp(contract, "i"));
  }
});

test("skill sync dry-run is non-mutating, write is idempotent, and check detects no drift", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "effort-agent-skills-"));
  try {
    await mkdir(path.join(temporaryRoot, "agent-skills", "mock-skill"), { recursive: true });
    await writeFile(
      path.join(temporaryRoot, "agent-skills", "mock-skill", "SKILL.md"),
      fixtureSkill(),
      "utf8",
    );
    const initialAgents = `# Mock

<!-- skill-sync:start -->
stale
<!-- skill-sync:end -->
`;
    const agentsPath = path.join(temporaryRoot, "AGENTS.md");
    await writeFile(agentsPath, initialAgents, "utf8");

    const dryRun = await syncAgentSkills({ root: temporaryRoot, dryRun: true });
    assert.deepEqual(dryRun.changes, [agentsPath]);
    assert.equal(await readFile(agentsPath, "utf8"), initialAgents);

    const written = await syncAgentSkills({ root: temporaryRoot });
    assert.deepEqual(written.changes, [agentsPath]);
    const checked = await syncAgentSkills({ root: temporaryRoot, check: true });
    assert.deepEqual(checked.changes, []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("repository auto-invoke table is synchronized", async () => {
  const result = await syncAgentSkills({ root, check: true });
  assert.deepEqual(
    result.changes.map((target) => path.relative(root, target)),
    [],
  );
});
