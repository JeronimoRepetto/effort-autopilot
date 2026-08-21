#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = Object.freeze({
  repository: "https://github.com/openai/human-eval",
  commit: "6d43fb980f9fee3c892a914eda09951f772ad10d",
  dataPath: "data/HumanEval.jsonl.gz",
  sha256: "b796127e635a67f93fb35c04f4cb03cf06f38c8072ee7cee8833d7bee06979ef",
  license: "MIT",
});
const TASK_IDS = Object.freeze([
  "HumanEval/53",
  "HumanEval/0",
  "HumanEval/140",
  "HumanEval/32",
  "HumanEval/129",
]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadPinnedDataset(cacheFile) {
  let compressed;
  try {
    compressed = await readFile(cacheFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!compressed || sha256(compressed) !== SOURCE.sha256) {
    const url = `https://raw.githubusercontent.com/openai/human-eval/${SOURCE.commit}/${SOURCE.dataPath}`;
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`HumanEval download failed: HTTP ${response.status}`);
    compressed = Buffer.from(await response.arrayBuffer());
    if (sha256(compressed) !== SOURCE.sha256) {
      throw new Error("HumanEval archive checksum does not match the pinned source");
    }
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, compressed);
  }
  return gunzipSync(compressed)
    .toString("utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
}

function verifierSource(task) {
  return (
    `# Generated from pinned OpenAI HumanEval test data. Do not edit.\n` +
    `import ast\n` +
    `import builtins\n` +
    `import math\n` +
    `import typing\n` +
    `from pathlib import Path\n\n` +
    `ENTRY_POINT = ${JSON.stringify(task.entry_point)}\n` +
    `TEST_SOURCE = ${JSON.stringify(task.test)}\n\n` +
    `source = Path("candidate.py").read_text(encoding="utf-8")\n` +
    `tree = ast.parse(source, filename="candidate.py")\n` +
    `for statement in tree.body:\n` +
    `    if not isinstance(statement, (ast.Import, ast.ImportFrom, ast.FunctionDef)):\n` +
    `        raise AssertionError("candidate may contain only imports and function definitions")\n` +
    `    if isinstance(statement, ast.FunctionDef) and statement.decorator_list:\n` +
    `        raise AssertionError("candidate decorators are not allowed")\n` +
    `for node in ast.walk(tree):\n` +
    `    if isinstance(node, ast.Import):\n` +
    `        if any(alias.name != "math" for alias in node.names):\n` +
    `            raise AssertionError("only the math import is allowed")\n` +
    `    elif isinstance(node, ast.ImportFrom):\n` +
    `        if node.module != "typing" or any(alias.name not in {"List", "Tuple", "Optional"} for alias in node.names):\n` +
    `            raise AssertionError("only selected typing imports are allowed")\n` +
    `    elif isinstance(node, ast.Attribute) and node.attr.startswith("_"):\n` +
    `        raise AssertionError("private/dunder attribute access is not allowed")\n` +
    `    elif isinstance(node, ast.Name) and node.id.startswith("__"):\n` +
    `        raise AssertionError("dunder names are not allowed")\n` +
    `    elif isinstance(node, (ast.ClassDef, ast.AsyncFunctionDef, ast.Global, ast.Nonlocal)):\n` +
    `        raise AssertionError("unsupported candidate construct")\n` +
    `tree.body = [node for node in tree.body if not isinstance(node, (ast.Import, ast.ImportFrom))]\n` +
    `safe_names = ["abs", "all", "any", "bool", "dict", "enumerate", "filter", "float", "int", "len", "list", "map", "max", "min", "range", "reversed", "round", "set", "sorted", "str", "sum", "tuple", "zip"]\n` +
    `safe_builtins = {name: getattr(builtins, name) for name in safe_names}\n` +
    `namespace = {"__builtins__": safe_builtins, "math": math, "List": typing.List, "Tuple": typing.Tuple, "Optional": typing.Optional}\n` +
    `exec(compile(tree, "candidate.py", "exec"), namespace, namespace)\n` +
    `test_namespace = dict(namespace)\n` +
    `test_namespace["__builtins__"] = builtins.__dict__\n` +
    `exec(TEST_SOURCE, test_namespace, test_namespace)\n` +
    `test_namespace["check"](namespace[ENTRY_POINT])\n`
  );
}

function taskInstructions(task) {
  return (
    `# ${task.task_id}\n\n` +
    `Make the minimum required edit in \`candidate.py\` only. Implement the public ` +
    `OpenAI HumanEval function below while preserving its name and signature. ` +
    `Use this exact workflow: read \`candidate.py\` if needed, edit only that file, ` +
    `then immediately return a brief completion message. Do not inspect any other ` +
    `file, run commands or tests, install dependencies, or edit verifier/source metadata. ` +
    `The external harness performs verification after Claude exits.\n\n` +
    `## Public task\n\n\`\`\`python\n${task.prompt}\`\`\`\n`
  );
}

function validatePython(workspace, expectedSuccess) {
  const completed = spawnSync("python", ["-I", "-B", "verify_task.py"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  const succeeded = completed.status === 0;
  if (succeeded !== expectedSuccess) {
    throw new Error(
      `Verifier ${expectedSuccess ? "rejected the canonical solution" : "accepted the empty candidate"}`,
    );
  }
}

async function prepareTask(task, fixturesRoot) {
  const directory = path.join(fixturesRoot, task.task_id.replace("/", "-"));
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "TASK.md"), taskInstructions(task), "utf8");
  await writeFile(path.join(directory, "candidate.py"), task.prompt, "utf8");
  await writeFile(path.join(directory, "verify_task.py"), verifierSource(task), "utf8");
  await writeFile(
    path.join(directory, "SOURCE.json"),
    `${JSON.stringify({ ...SOURCE, taskId: task.task_id }, null, 2)}\n`,
    "utf8",
  );

  validatePython(directory, false);
  const gold = await mkdtemp(path.join(os.tmpdir(), "effort-autopilot-gold-"));
  try {
    await writeFile(path.join(gold, "candidate.py"), task.prompt + task.canonical_solution, "utf8");
    await writeFile(path.join(gold, "verify_task.py"), verifierSource(task), "utf8");
    validatePython(gold, true);
  } finally {
    await rm(gold, { recursive: true, force: true });
  }
  process.stdout.write(`prepared=${task.task_id} stub=FAIL gold=PASS\n`);
}

async function main() {
  const cacheFile = path.join(ROOT, ".effort-autopilot", "benchmark-cache", "HumanEval.jsonl.gz");
  const dataset = await loadPinnedDataset(cacheFile);
  const byId = new Map(dataset.map((task) => [task.task_id, task]));
  const fixturesRoot = path.join(ROOT, ".effort-autopilot", "benchmark-fixtures", "humaneval");
  for (const id of TASK_IDS) {
    const task = byId.get(id);
    if (!task) throw new Error(`Pinned HumanEval task is missing: ${id}`);
    await prepareTask(task, fixturesRoot);
  }
  process.stdout.write(`fixtures=${fixturesRoot}\n`);
  process.stdout.write("No Claude or model call was made.\n");
}

main().catch((error) => {
  process.stderr.write(`[prepare-live-pilot] ${error.message}\n`);
  process.exitCode = 1;
});
