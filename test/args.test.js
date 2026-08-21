import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "../src/cli/args.js";

test("cross-platform arguments preserve Windows paths and spaced prompt parts", () => {
  const parsed = parseCliArgs([
    "--cwd",
    "C:\\Users\\Example User\\project",
    "--model-profile",
    "C:\\Profiles\\sonnet.json",
    "fix",
    "the login bug",
  ], {});
  assert.equal(parsed.options.cwd, "C:\\Users\\Example User\\project");
  assert.equal(parsed.options.modelProfilePath, "C:\\Profiles\\sonnet.json");
  assert.deepEqual(parsed.promptParts, ["fix", "the login bug"]);
});

test("delimiter permits prompts that begin with a dash", () => {
  const parsed = parseCliArgs(["--ceiling", "low", "--", "--explain", "this"], {});
  assert.equal(parsed.options.ceiling, "low");
  assert.deepEqual(parsed.promptParts, ["--explain", "this"]);
});

test("provider and model are untouched unless model is explicit", () => {
  const preserved = parseCliArgs(["hello"], {});
  assert.equal("model" in preserved.options, false);
  const explicit = parseCliArgs(["--model", "claude-opus-example", "hello"], {});
  assert.equal(explicit.options.model, "claude-opus-example");
});

test("permission mode excludes model-based auto routing", () => {
  assert.throws(
    () => parseCliArgs(["--permission-mode", "auto", "hello"], {}),
    /unsupported/,
  );
});
