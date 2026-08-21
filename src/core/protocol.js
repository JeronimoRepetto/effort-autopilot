import { classifyPrompt } from "./classifier.js";

export const DEFAULT_FALLBACK = Object.freeze({
  status: "fallback",
  fallback: "auto",
  errorCode: "classification-failed",
});

/**
 * Host-neutral safe boundary for adapters.
 *
 * An adapter passes an object with a string `prompt`. Any malformed input or
 * classifier failure returns `auto`, meaning the host must preserve its current
 * default behavior. No exception, prompt text, or error detail crosses this
 * boundary.
 */
export function classifyEnvelope(input) {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.prompt !== "string" ||
      input.prompt.trim() === ""
    ) {
      return DEFAULT_FALLBACK;
    }

    return Object.freeze({
      status: "ok",
      decision: classifyPrompt(input.prompt, {
        modelProfile: input.modelProfile,
        environment: input.environment,
      }),
    });
  } catch {
    return DEFAULT_FALLBACK;
  }
}

export function parseAndClassifyEnvelope(rawInput) {
  try {
    return classifyEnvelope(JSON.parse(rawInput));
  } catch {
    return DEFAULT_FALLBACK;
  }
}
