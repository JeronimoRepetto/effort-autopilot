import { classifyEnvelope } from "../core/protocol.js";
import { resolveExecutionPlan } from "./plan.js";

/**
 * Classify first, then invoke the supplied Claude runner exactly once.
 * There is intentionally no retry path.
 */
export async function launchTask({
  prompt,
  modelProfile,
  environment,
  config,
  execution,
  classifier = classifyEnvelope,
  runner,
  onPlan,
}) {
  if (typeof runner !== "function") {
    throw new TypeError("runner must be a function");
  }

  let classification;
  try {
    classification = classifier({ prompt, modelProfile, environment });
  } catch {
    classification = {
      status: "fallback",
      fallback: "auto",
      errorCode: "classification-failed",
    };
  }

  const plan = resolveExecutionPlan(classification, config);
  await onPlan?.(plan);

  // Exactly one invocation. If it throws, the error propagates without retry.
  const result = await runner({
    prompt,
    effort: plan.effort,
    ...execution,
  });

  return Object.freeze({
    routing: plan,
    execution: result,
  });
}
