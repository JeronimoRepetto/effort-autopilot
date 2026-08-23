import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function jsFilesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return jsFilesUnder(absolute);
    return entry.isFile() && entry.name.endsWith(".js") ? [absolute] : [];
  });
}

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

// Regression tripwire for issue #13: src/broker/turn-controller.js once
// imported src/launcher/plan.js, which the tarball excludes, so the published
// package would have crashed with ERR_MODULE_NOT_FOUND on first use.
test("shipped modules only import files that ship in the npm tarball", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const shippedFiles = new Set();
  const shippedRoots = [];
  for (const entry of packageJson.files) {
    const absolute = path.normalize(path.join(root, entry)).replace(/[\\/]+$/, "");
    if (entry.endsWith("/")) shippedRoots.push(absolute);
    else shippedFiles.add(absolute);
  }
  const isShipped = (absolute) =>
    shippedFiles.has(absolute) ||
    shippedRoots.some((directory) => absolute.startsWith(directory + path.sep));
  const shippedModules = [
    ...[...shippedFiles].filter((file) => file.endsWith(".js")),
    ...shippedRoots.flatMap((directory) => jsFilesUnder(directory)),
  ];
  assert.ok(shippedModules.length > 0);
  const importPattern =
    /(?:import|export)\s+(?:[^"'()]*?from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const file of shippedModules) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier?.startsWith(".")) continue;
      const resolved = path.normalize(path.resolve(path.dirname(file), specifier));
      assert.ok(
        isShipped(resolved),
        `${path.relative(root, file)} imports ${specifier}, which is excluded from the tarball`,
      );
    }
  }
});

// The canonical effort ladder must have exactly one definition (issue #8).
// Model profiles keep per-model level lists as verified data, and shorter
// level subsets (calibration search spaces, tier→native mappings) are data,
// not ladder copies — only the full low→xhigh(→max) sequence counts.
test("the effort ladder is defined once in src/core/effort-ladder.js", async () => {
  const ladderLiteral =
    /\[\s*["']low["']\s*,\s*["']medium["']\s*,\s*["']high["']\s*,\s*["']xhigh["']/;
  const allowed = new Set([path.join(root, "src", "core", "effort-ladder.js")]);
  const dataFiles = new Set([path.join(root, "src", "core", "model-profiles.js")]);
  for (const file of [
    ...jsFilesUnder(path.join(root, "src")),
    ...jsFilesUnder(path.join(root, "bin")),
  ]) {
    if (allowed.has(file) || dataFiles.has(file)) continue;
    const source = await readFile(file, "utf8");
    assert.ok(
      !ladderLiteral.test(source),
      `${path.relative(root, file)} defines its own copy of the effort ladder`,
    );
  }
});

test("plugin scaffold version tracks the package version", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const plugin = JSON.parse(
    await readFile(path.join(root, ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(plugin.version, packageJson.version);
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
