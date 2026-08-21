/**
 * Additive hook merge for a user-provided `--settings` document.
 *
 * The user's settings object is preserved verbatim; the broker only appends
 * its own SessionStart/UserPromptSubmit command hooks after any hooks the user
 * already configured. Any shape that cannot be combined without guessing
 * throws, and the caller must fall back to running Claude unchanged.
 */

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function brokerHookConfiguration(hookCommand) {
  const entry = () => ({ hooks: [{ type: "command", command: hookCommand, timeout: 5 }] });
  return { SessionStart: [entry()], UserPromptSubmit: [entry()] };
}

export function mergeHookSettings(userSettings, hookCommand) {
  if (!isPlainObject(userSettings)) throw new TypeError("user settings must be a JSON object");
  if (typeof hookCommand !== "string" || !hookCommand) throw new TypeError("hook command required");
  const merged = structuredClone(userSettings);
  if (merged.hooks === undefined) merged.hooks = {};
  if (!isPlainObject(merged.hooks)) throw new TypeError("user settings 'hooks' must be an object");
  for (const [event, entries] of Object.entries(brokerHookConfiguration(hookCommand))) {
    const existing = merged.hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new TypeError(`user settings 'hooks.${event}' must be an array`);
    merged.hooks[event] = [...existing, ...entries];
  }
  return merged;
}
