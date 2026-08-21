import assert from "node:assert/strict";
import test from "node:test";

import { parseClaudeLaunchArgs } from "../src/broker/claude-args.js";
import { resolveSessionEffortBaseline } from "../src/broker/effort-baseline.js";
import { mergeHookSettings } from "../src/broker/settings-merge.js";

const HOOK = '"node" "hook.js"';

test("launch args expose settings position, explicit effort, resume, and print facts", () => {
  const separate = parseClaudeLaunchArgs(["--verbose", "--settings", "C:\\a b\\s.json", "--effort", "high"]);
  assert.deepEqual(separate.settings, { value: "C:\\a b\\s.json", index: 1, form: "separate" });
  assert.equal(separate.effort, "high");
  assert.equal(separate.resumesSession, false);
  assert.equal(separate.printMode, false);

  const inline = parseClaudeLaunchArgs(["--settings={\"theme\":\"dark\"}", "--effort=max"]);
  assert.equal(inline.settings.form, "inline");
  assert.equal(inline.settings.value, '{"theme":"dark"}');
  assert.equal(inline.effort, "max");

  assert.equal(parseClaudeLaunchArgs(["--resume", "abc"]).resumesSession, true);
  assert.equal(parseClaudeLaunchArgs(["-c"]).resumesSession, true);
  assert.equal(parseClaudeLaunchArgs(["-p", "hello"]).printMode, true);
  const empty = parseClaudeLaunchArgs([]);
  assert.equal(empty.settings, null);
  assert.equal(empty.effort, null);
  // null = no launch-flag opinion; the config chain resolves the policy.
  assert.equal(empty.autopilotPolicy, null);
});

test("broker-owned --autopilot flag is consumed and never forwarded to the CLI", () => {
  const wins = parseClaudeLaunchArgs(["--autopilot", "autopilot-wins", "--verbose"]);
  assert.equal(wins.autopilotPolicy, "autopilot-wins");
  assert.equal(wins.invalidAutopilotPolicy, null);
  assert.deepEqual([...wins.forwardArgs], ["--verbose"]);

  const inline = parseClaudeLaunchArgs(["--autopilot=manual-wins"]);
  assert.equal(inline.autopilotPolicy, "manual-wins");
  assert.deepEqual([...inline.forwardArgs], []);

  const invalid = parseClaudeLaunchArgs(["--autopilot", "turbo"]);
  assert.equal(invalid.autopilotPolicy, null);
  assert.equal(invalid.invalidAutopilotPolicy, "turbo");
  assert.deepEqual([...invalid.forwardArgs], []);

  // Bare --autopilot means "the autopilot decides".
  const bare = parseClaudeLaunchArgs(["--autopilot"]);
  assert.equal(bare.autopilotPolicy, "autopilot-wins");
  assert.equal(bare.invalidAutopilotPolicy, null);
  const bareBeforeFlag = parseClaudeLaunchArgs(["--autopilot", "--verbose"]);
  assert.equal(bareBeforeFlag.autopilotPolicy, "autopilot-wins");
  assert.deepEqual([...bareBeforeFlag.forwardArgs], ["--verbose"]);

  // settings.index refers to the FORWARDED argument list after stripping.
  const combined = parseClaudeLaunchArgs(["--autopilot", "autopilot-wins", "--settings", "s.json"]);
  assert.deepEqual(combined.settings, { value: "s.json", index: 0, form: "separate" });
  assert.deepEqual([...combined.forwardArgs], ["--settings", "s.json"]);
});

test("hook merge preserves user settings and appends broker hooks after user hooks", () => {
  const user = {
    permissions: { allow: ["Read"] },
    theme: "dark",
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "user-hook" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] }],
    },
  };
  const merged = mergeHookSettings(user, HOOK);
  assert.deepEqual(merged.permissions, { allow: ["Read"] });
  assert.equal(merged.theme, "dark");
  assert.deepEqual(merged.hooks.PreToolUse, user.hooks.PreToolUse);
  assert.equal(merged.hooks.UserPromptSubmit.length, 2);
  assert.equal(merged.hooks.UserPromptSubmit[0].hooks[0].command, "user-hook");
  assert.equal(merged.hooks.UserPromptSubmit[1].hooks[0].command, HOOK);
  assert.equal(merged.hooks.SessionStart.length, 1);
  assert.equal(merged.hooks.SessionStart[0].hooks[0].command, HOOK);
  // The user's object is never mutated.
  assert.equal(user.hooks.UserPromptSubmit.length, 1);
  assert.equal(user.hooks.SessionStart, undefined);
});

test("hook merge refuses shapes it cannot combine without guessing", () => {
  assert.throws(() => mergeHookSettings(null, HOOK), /JSON object/);
  assert.throws(() => mergeHookSettings([], HOOK), /JSON object/);
  assert.throws(() => mergeHookSettings({ hooks: "broken" }, HOOK), /'hooks' must be an object/);
  assert.throws(() => mergeHookSettings({ hooks: { SessionStart: {} } }, HOOK), /must be an array/);
});

test("session effort baseline prefers project-local, then project, then user settings", () => {
  const files = {
    "C:\\proj\\.claude\\settings.local.json": JSON.stringify({ effortLevel: "low" }),
    "C:\\proj\\.claude\\settings.json": JSON.stringify({ effortLevel: "max" }),
    "C:\\home\\.claude\\settings.json": JSON.stringify({ effortLevel: "high" }),
  };
  const readFile = (file) => {
    if (!(file in files)) throw new Error("ENOENT");
    return files[file];
  };
  const options = { cwd: "C:\\proj", home: "C:\\home", readFile };
  assert.deepEqual(resolveSessionEffortBaseline(options), { effort: "low", source: "project local settings" });
  delete files["C:\\proj\\.claude\\settings.local.json"];
  assert.deepEqual(resolveSessionEffortBaseline(options), { effort: "max", source: "project settings" });
  delete files["C:\\proj\\.claude\\settings.json"];
  assert.deepEqual(resolveSessionEffortBaseline(options), { effort: "high", source: "user settings" });
});

test("session effort baseline tolerates a UTF-8 BOM in settings files", () => {
  const readFile = () => `\uFEFF${JSON.stringify({ effortLevel: "medium" })}`;
  assert.deepEqual(
    resolveSessionEffortBaseline({ cwd: "C:\\proj", home: "C:\\home", readFile }),
    { effort: "medium", source: "project local settings" },
  );
});

test("session effort baseline fails open to auto on missing, malformed, or invalid values", () => {
  const cases = [
    () => { throw new Error("ENOENT"); },
    () => "{ not json",
    () => JSON.stringify({ effortLevel: "turbo" }),
    () => JSON.stringify({ effortLevel: 3 }),
    () => JSON.stringify({}),
  ];
  for (const readFile of cases) {
    assert.deepEqual(
      resolveSessionEffortBaseline({ cwd: "C:\\proj", home: "C:\\home", readFile }),
      { effort: "auto", source: "session default" },
    );
  }
});
