import { resolveModelProfile } from "../core/model-profiles.js";
import { classifyEnvelope } from "../core/protocol.js";
import { resolveExecutionPlan } from "../launcher/plan.js";

export class GatewayTransformError extends Error {
  constructor(code, cause) {
    super(code, { cause });
    this.name = "GatewayTransformError";
    this.code = code;
  }
}

function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Return the newest natural-language user text in a Messages API request.
 * Tool-result-only user messages are deliberately skipped, so follow-up
 * agentic requests keep using the original turn's classification.
 */
export function extractLatestUserPrompt(requestBody) {
  if (!Array.isArray(requestBody?.messages)) return null;
  for (let index = requestBody.messages.length - 1; index >= 0; index -= 1) {
    const message = requestBody.messages[index];
    if (message?.role !== "user") continue;
    const text = textFromContent(message.content);
    if (text) return text;
  }
  return null;
}

function safeMetadata({ outcome, model, plan, errorCode = null }) {
  return Object.freeze({
    outcome,
    model: typeof model === "string" ? model : null,
    appliedEffort: plan?.effort ?? null,
    classifierTier: plan?.classifierTier ?? null,
    confidence: plan?.confidence ?? null,
    modelProfileId: plan?.modelProfileId ?? null,
    ceilingApplied: plan?.ceilingApplied ?? false,
    errorCode,
  });
}

/**
 * Synthetic, transport-free proof of the supported gateway decision point.
 *
 * The returned `forwardBody` necessarily contains the request prompt because a
 * real gateway must relay it. Callers must treat it as ephemeral and must never
 * log or persist it. `metadata` is deliberately prompt-free and safe to report.
 * This module performs no network or credential operation.
 */
export function prepareGatewayRequest({
  requestBody,
  environment,
  config,
  classifier = classifyEnvelope,
  profileResolver = resolveModelProfile,
  onFailure = "preserve",
} = {}) {
  if (!["preserve", "reject"].includes(onFailure)) {
    throw new TypeError("onFailure must be preserve or reject");
  }

  try {
    if (requestBody === null || typeof requestBody !== "object" || Array.isArray(requestBody)) {
      throw new TypeError("request body must be an object");
    }
    if (typeof requestBody.model !== "string" || requestBody.model.trim() === "") {
      throw new TypeError("request model must be a non-empty string");
    }
    if (
      requestBody.output_config !== undefined &&
      (requestBody.output_config === null ||
        typeof requestBody.output_config !== "object" ||
        Array.isArray(requestBody.output_config))
    ) {
      throw new TypeError("output_config must be an object when present");
    }

    const prompt = extractLatestUserPrompt(requestBody);
    if (!prompt) throw new TypeError("request has no natural-language user prompt");

    const modelProfile = profileResolver({ modelId: requestBody.model });
    const classification = classifier({ prompt, modelProfile, environment });
    if (classification?.status !== "ok") {
      throw new Error("classification-failed");
    }
    const plan = resolveExecutionPlan(classification, config);

    // The only outbound body mutation is output_config.effort. The exact model,
    // messages, tools, stream flag, cache controls, and all other fields retain
    // their original values and object identity where possible.
    const forwardBody = {
      ...requestBody,
      output_config: {
        ...(requestBody.output_config ?? {}),
        effort: plan.effort,
      },
    };
    return Object.freeze({
      forwardBody,
      metadata: safeMetadata({ outcome: "effort-applied", model: requestBody.model, plan }),
    });
  } catch (error) {
    if (onFailure === "reject") {
      throw new GatewayTransformError("gateway-classification-rejected", error);
    }
    return Object.freeze({
      forwardBody: requestBody,
      metadata: safeMetadata({
        outcome: "forward-unmodified",
        model: requestBody?.model,
        plan: null,
        errorCode: "classification-failed",
      }),
    });
  }
}

/** Relay an upstream SSE/body byte stream without buffering or rewriting it. */
export async function* passThroughStream(chunks) {
  for await (const chunk of chunks) yield chunk;
}
