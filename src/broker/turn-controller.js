import { resolveModelProfile } from "../core/model-profiles.js";
import { classifyEnvelope } from "../core/protocol.js";
import { resolveExecutionPlan } from "../launcher/plan.js";

const DEFAULT_TIMEOUT_MS = 250;
const DEFAULT_MIN_CONFIDENCE = 0.55;

function unchangedMetadata(cause, model, activeEffort) {
  return Object.freeze({
    outcome: "unchanged",
    cause,
    model: model ?? null,
    requestedEffort: null,
    appliedEffort: null,
    activeEffort: activeEffort ?? null,
    promptForwarded: true,
  });
}

function appliedMetadata(plan, model, activeEffort) {
  return Object.freeze({
    outcome: "applied",
    cause: "automatic-effort-acknowledged",
    model,
    requestedEffort: plan.effort,
    appliedEffort: plan.effort,
    activeEffort: activeEffort ?? null,
    promptForwarded: true,
  });
}

async function withTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("classification-timeout")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transport-independent broker turn contract.
 *
 * The real terminal adapter must call this only for a positively identified
 * top-level prompt submission. `applyEffort` must not report success until the
 * child CLI has acknowledged the exact requested level. The prompt is passed to
 * `forwardPrompt` once, byte-for-byte, and is never included in returned
 * metadata.
 */
export async function brokerTurn({
  prompt,
  activeModel,
  activeEffort,
  explicitUserEffort = false,
  terminalState = "top-level-prompt",
  environment,
  config,
  classifier = classifyEnvelope,
  profileResolver = resolveModelProfile,
  applyEffort,
  forwardPrompt,
  onStatus,
  classificationTimeoutMs = DEFAULT_TIMEOUT_MS,
  minimumConfidence = DEFAULT_MIN_CONFIDENCE,
} = {}) {
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new TypeError("prompt must be a non-empty string");
  }
  if (typeof forwardPrompt !== "function") throw new TypeError("forwardPrompt must be a function");
  if (typeof applyEffort !== "function") throw new TypeError("applyEffort must be a function");

  let forwarded = false;
  const forwardOnce = async (metadata) => {
    if (forwarded) throw new Error("prompt-already-forwarded");
    forwarded = true;
    await forwardPrompt(prompt, metadata);
  };
  const finishUnchanged = async (cause) => {
    const metadata = unchangedMetadata(cause, activeModel, activeEffort);
    await forwardOnce(metadata);
    await onStatus?.(metadata);
    return metadata;
  };

  // A user-set session, environment, CLI, or observed /effort override wins.
  if (explicitUserEffort) return finishUnchanged("explicit-user-effort");
  if (terminalState !== "top-level-prompt") return finishUnchanged("ambiguous-terminal-state");

  let modelProfile;
  try {
    modelProfile = profileResolver({ modelId: activeModel });
  } catch {
    modelProfile = null;
  }
  if (!modelProfile) return finishUnchanged("unsupported-or-ambiguous-model");

  let classification;
  try {
    classification = await withTimeout(
      () => classifier({ prompt, modelProfile, environment }),
      classificationTimeoutMs,
    );
  } catch (error) {
    const cause = error?.message === "classification-timeout"
      ? "classification-timeout"
      : "classification-failed";
    return finishUnchanged(cause);
  }
  if (classification?.status !== "ok") return finishUnchanged("classification-failed");
  if (
    !Number.isFinite(classification.decision?.confidence) ||
    classification.decision.confidence < minimumConfidence
  ) {
    return finishUnchanged("insufficient-confidence");
  }

  const plan = resolveExecutionPlan(classification, config);
  let acknowledgement;
  try {
    acknowledgement = await applyEffort(plan.effort);
  } catch {
    acknowledgement = null;
  }
  if (
    acknowledgement?.acknowledged !== true ||
    acknowledgement?.effort !== plan.effort
  ) {
    return finishUnchanged("effort-not-acknowledged");
  }

  const metadata = appliedMetadata(plan, activeModel, activeEffort);
  await forwardOnce(metadata);
  await onStatus?.(metadata);
  return metadata;
}
