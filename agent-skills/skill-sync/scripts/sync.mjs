import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..", "..");
const START_MARKER = "<!-- skill-sync:start -->";
const END_MARKER = "<!-- skill-sync:end -->";
const EXPECTED_AUTHOR = "Jeronimo Repetto";
const EXPECTED_LICENSE = "MIT";
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
]);

export const SCOPE_TARGETS = Object.freeze({
  root: "AGENTS.md",
});

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function frontmatterLines(source) {
  const normalized = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") throw new Error("SKILL.md must start with YAML frontmatter");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("SKILL.md frontmatter is not closed");
  return lines.slice(1, end);
}

function topLevelValue(lines, key) {
  const prefix = `${key}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line ? unquote(line.slice(prefix.length)) : "";
}

function foldedTopLevelValue(lines, key) {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return "";
  const inline = lines[index].slice(key.length + 1).trim();
  if (inline && inline !== ">" && inline !== "|") return unquote(inline);
  const parts = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line && !/^\s/.test(line)) break;
    if (line.trim()) parts.push(line.trim());
  }
  return parts.join(" ");
}

function metadataLines(lines) {
  const start = lines.findIndex((line) => line === "metadata:");
  if (start === -1) return [];
  const nested = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !/^\s/.test(line)) break;
    nested.push(line);
  }
  return nested;
}

function metadataValue(lines, key) {
  const pattern = new RegExp(`^\\s+${key}:\\s*(.*)$`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index === -1) return null;
  const inline = lines[index].match(pattern)?.[1]?.trim() ?? "";
  if (inline) return unquote(inline);

  const values = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const match = lines[cursor].match(/^\s+-\s+(.+)$/);
    if (!match) break;
    values.push(unquote(match[1]));
  }
  return values;
}

function inlineList(value) {
  if (!value.startsWith("[") || !value.endsWith("]")) return [unquote(value)];
  const body = value.slice(1, -1).trim();
  return body ? body.split(",").map((entry) => unquote(entry)) : [];
}

function requiredStrings(value, field) {
  const values = Array.isArray(value) ? value : inlineList(value ?? "");
  if (
    values.length === 0 ||
    values.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.trim() === "" ||
        entry.includes("|") ||
        entry.includes("\n"),
    )
  ) {
    throw new Error(`${field} must contain one or more plain strings`);
  }
  return values.map((entry) => entry.trim());
}

export function parseSkillSource(source, folderName = null) {
  const lines = frontmatterLines(source);
  const metadata = metadataLines(lines);
  const topLevelKeys = lines
    .map((line) => line.match(/^([a-z][a-z0-9-]*):/)?.[1] ?? null)
    .filter(Boolean);
  const unexpected = topLevelKeys.filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key));
  if (unexpected.length > 0) {
    throw new Error(`unexpected frontmatter keys: ${unexpected.join(", ")}`);
  }
  const name = topLevelValue(lines, "name");
  const description = foldedTopLevelValue(lines, "description");
  const license = topLevelValue(lines, "license");
  const author = metadataValue(metadata, "author");
  const version = metadataValue(metadata, "version");
  const scopes = requiredStrings(metadataValue(metadata, "scope"), "metadata.scope");
  const actions = requiredStrings(metadataValue(metadata, "auto_invoke"), "metadata.auto_invoke");

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error("name must use lowercase letters, digits, and hyphens");
  }
  if (name.length > 64) throw new Error("name must not exceed 64 characters");
  if (folderName && name !== folderName) {
    throw new Error(`name '${name}' must match folder '${folderName}'`);
  }
  if (license !== EXPECTED_LICENSE) {
    throw new Error(`license must be ${EXPECTED_LICENSE}`);
  }
  if (
    !description ||
    description.length > 1024 ||
    description.includes("<") ||
    description.includes(">") ||
    /\[TODO:/i.test(description)
  ) {
    throw new Error("description must be complete, non-empty, and at most 1024 characters");
  }
  if (author !== EXPECTED_AUTHOR) {
    throw new Error(`metadata.author must be ${EXPECTED_AUTHOR}`);
  }
  if (typeof version !== "string" || !/^\d+\.\d+$/.test(version)) {
    throw new Error("metadata.version must use major.minor format");
  }
  for (const scope of scopes) {
    if (!Object.hasOwn(SCOPE_TARGETS, scope)) {
      throw new Error(`unsupported metadata.scope '${scope}'`);
    }
  }
  return Object.freeze({ name, description, license, author, version, scopes, actions });
}

async function loadSkills(root) {
  const skillsRoot = path.join(root, "agent-skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, entry.name, "SKILL.md");
    let source;
    try {
      source = await readFile(skillPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    try {
      skills.push(parseSkillSource(source, entry.name));
    } catch (error) {
      throw new Error(`${path.relative(root, skillPath)}: ${error.message}`, { cause: error });
    }
  }
  if (skills.length === 0) throw new Error("no Agent Skills found");
  return skills;
}

export function renderAutoInvokeSection(skills, scope) {
  const rows = skills
    .filter((skill) => skill.scopes.includes(scope))
    .flatMap((skill) => skill.actions.map((action) => ({ action, skill: skill.name })))
    .sort(
      (left, right) =>
        left.action.localeCompare(right.action, "en") ||
        left.skill.localeCompare(right.skill, "en"),
    );
  if (rows.length === 0) throw new Error(`scope '${scope}' has no auto-invoke actions`);

  return [
    START_MARKER,
    "### Auto-invoke skills",
    "",
    "When performing these actions, load the corresponding skill first:",
    "",
    "| Action | Skill |",
    "| --- | --- |",
    ...rows.map(({ action, skill }) => `| ${action} | \`${skill}\` |`),
    END_MARKER,
  ].join("\n");
}

export function replaceGeneratedSection(source, section) {
  const start = source.indexOf(START_MARKER);
  const end = source.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("target is missing valid skill-sync markers");
  }
  const suffixStart = end + END_MARKER.length;
  return `${source.slice(0, start)}${section}${source.slice(suffixStart)}`;
}

export async function syncAgentSkills({
  root = DEFAULT_ROOT,
  check = false,
  dryRun = false,
  scope = null,
} = {}) {
  if (scope && !Object.hasOwn(SCOPE_TARGETS, scope)) {
    throw new Error(`unknown scope '${scope}'`);
  }
  const skills = await loadSkills(root);
  const scopes = scope ? [scope] : Object.keys(SCOPE_TARGETS);
  const changes = [];
  const previews = [];

  for (const currentScope of scopes) {
    const target = path.join(root, SCOPE_TARGETS[currentScope]);
    const source = await readFile(target, "utf8");
    const section = renderAutoInvokeSection(skills, currentScope);
    const next = replaceGeneratedSection(source, section);
    previews.push({ scope: currentScope, target, section });
    if (next === source) continue;
    changes.push(target);
    if (!check && !dryRun) await writeFile(target, next, "utf8");
  }

  return Object.freeze({ skills, changes, previews });
}

function usage() {
  return [
    "Usage: node agent-skills/skill-sync/scripts/sync.mjs [options]",
    "",
    "Options:",
    "  --check          Fail when generated AGENTS.md content is stale",
    "  --dry-run        Print generated sections without writing",
    "  --scope <scope>  Process one registered scope",
    "  --help           Show this help",
  ].join("\n");
}

function parseArguments(argv) {
  const options = { check: false, dryRun: false, scope: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--scope") {
      options.scope = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`unknown option '${argument}'`);
    }
  }
  if (options.check && options.dryRun) {
    throw new Error("--check and --dry-run are mutually exclusive");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await syncAgentSkills(options);
  if (options.dryRun) {
    for (const preview of result.previews) {
      process.stdout.write(`# ${path.relative(DEFAULT_ROOT, preview.target)}\n`);
      process.stdout.write(`${preview.section}\n\n`);
    }
    return;
  }
  if (options.check && result.changes.length > 0) {
    const relative = result.changes.map((target) => path.relative(DEFAULT_ROOT, target));
    throw new Error(`generated skill routing is stale: ${relative.join(", ")}`);
  }
  const verb = options.check ? "validated" : result.changes.length > 0 ? "updated" : "unchanged";
  process.stdout.write(
    `Agent Skills ${verb}: ${result.skills.length} skills, ${result.changes.length} changed files.\n`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
