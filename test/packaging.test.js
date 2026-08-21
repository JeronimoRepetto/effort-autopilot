import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("plugin and marketplace metadata identify the same scaffold", async () => {
  const plugin = JSON.parse(
    await readFile(path.join(root, ".claude-plugin", "plugin.json"), "utf8"),
  );
  const marketplace = JSON.parse(
    await readFile(path.join(root, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  assert.equal(plugin.name, "effort-autopilot");
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].version, plugin.version);
  assert.match(plugin.description, /manual effort skills/i);
});

test("manual Claude skills preserve six outcomes without calling another provider", async () => {
  const expectedEffort = {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
    ultracode: "xhigh",
  };
  for (const [tier, effort] of Object.entries(expectedEffort)) {
    const skill = await readFile(path.join(root, "skills", `route-${tier}`, "SKILL.md"), "utf8");
    assert.match(skill, new RegExp(`effort: ${effort}(?:\\r?\\n)`));
    assert.match(skill, /disable-model-invocation: true/);
  }
});

test("no automatic hook or public launcher binary is packaged", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.private, true);
  // The only public executable is the reversible installer CLI; the legacy
  // launcher stays unexposed.
  assert.deepEqual(packageJson.bin, { "effort-autopilot": "bin/effort-autopilot-cli.js" });
  assert.ok(Array.isArray(packageJson.files));
  assert.ok(
    !packageJson.files.some((entry) =>
      /effort-autopilot\.js|effort-autopilot-pilot\.js/.test(entry),
    ),
  );
  await assert.rejects(readFile(path.join(root, "hooks", "hooks.json"), "utf8"), {
    code: "ENOENT",
  });
});

test("rejected launcher implementation is excluded from npm tarballs", async () => {
  const npmignore = await readFile(path.join(root, ".npmignore"), "utf8");
  for (const internalPath of [
    "bin/effort-autopilot.js",
    "bin/effort-autopilot-pilot.js",
    "src/cli/",
    "src/launcher/",
    "src/adapters/",
    "src/evaluation/",
    "evaluation/",
  ]) {
    assert.match(npmignore, new RegExp(internalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
