import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseSkillSource,
  PROVIDER_SKILL_ROOTS,
  renderAutoInvokeSection,
  renderProviderSkillIndex,
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

test("provider skill indexes preserve discovery metadata and redirect to one canonical source", () => {
  const skill = parseSkillSource(fixtureSkill(), "mock-skill");
  const index = renderProviderSkillIndex(skill, "../../../agent-skills/mock-skill/SKILL.md");
  assert.match(index, /^---\nname: mock-skill\ndescription: >/);
  assert.match(index, /\.\.\/\.\.\/\.\.\/agent-skills\/mock-skill\/SKILL\.md/);
  assert.match(index, /only editable source of truth/);
  assert.doesNotMatch(index, /## Mock/);
  assert.deepEqual(PROVIDER_SKILL_ROOTS, {
    codex: ".agents/skills",
    claude: ".claude/skills",
    gemini: ".gemini/skills",
  });
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

test("provider entrypoints import the canonical AGENTS.md rules", async () => {
  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8");
  const gemini = await readFile(path.join(root, "GEMINI.md"), "utf8");
  assert.match(claude, /^# Claude Code entrypoint/m);
  assert.match(claude, /^@AGENTS\.md$/m);
  assert.match(gemini, /^# Gemini CLI entrypoint/m);
  assert.match(gemini, /^@\.\/AGENTS\.md$/m);
  assert.doesNotMatch(agents, /follow the rules in \[CLAUDE\.md\]/i);
  for (const contract of ["zero model tokens", "byte-for-byte exactly once", "GitHub Issues"]) {
    assert.match(agents, new RegExp(contract, "i"));
    assert.doesNotMatch(claude, new RegExp(contract, "i"));
    assert.doesNotMatch(gemini, new RegExp(contract, "i"));
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
    const indexPaths = Object.values(PROVIDER_SKILL_ROOTS).map((skillRoot) =>
      path.join(temporaryRoot, skillRoot, "mock-skill", "SKILL.md"),
    );
    const expectedChanges = [agentsPath, ...indexPaths];

    const dryRun = await syncAgentSkills({ root: temporaryRoot, dryRun: true });
    assert.deepEqual(dryRun.changes, expectedChanges);
    assert.equal(await readFile(agentsPath, "utf8"), initialAgents);
    for (const skillRoot of Object.values(PROVIDER_SKILL_ROOTS)) {
      await assert.rejects(stat(path.join(temporaryRoot, skillRoot)), { code: "ENOENT" });
    }

    const unrelatedPath = path.join(
      temporaryRoot,
      PROVIDER_SKILL_ROOTS.codex,
      "local-only",
      "NOTES.md",
    );
    await mkdir(path.dirname(unrelatedPath), { recursive: true });
    await writeFile(unrelatedPath, "preserve me\n", "utf8");

    const written = await syncAgentSkills({ root: temporaryRoot });
    assert.deepEqual(written.changes, expectedChanges);
    assert.equal(await readFile(unrelatedPath, "utf8"), "preserve me\n");
    for (const indexPath of indexPaths) {
      const source = await readFile(indexPath, "utf8");
      assert.match(source, /agent-skills\/mock-skill\/SKILL\.md/);
      assert.doesNotMatch(source, /## Mock/);
    }
    const checked = await syncAgentSkills({ root: temporaryRoot, check: true });
    assert.deepEqual(checked.changes, []);

    await writeFile(indexPaths[1], "stale\n", "utf8");
    const drift = await syncAgentSkills({ root: temporaryRoot, check: true });
    assert.deepEqual(drift.changes, [indexPaths[1]]);
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
