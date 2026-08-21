const EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

export const DEFAULT_SAVINGS_CONFIG = Object.freeze({
  ceiling: "medium",
  baselineEffort: "medium",
});

export function isEffort(value) {
  return EFFORTS.includes(value);
}

export function lowerOf(left, right) {
  if (!isEffort(left) || !isEffort(right)) {
    throw new TypeError("effort must be low, medium, high, xhigh, or max");
  }
  return EFFORTS[Math.min(EFFORTS.indexOf(left), EFFORTS.indexOf(right))];
}

/**
 * Turn a classifier result into a host-adapter-ready pre-call plan.
 *
 * Ultracode is deliberately not enabled here: it is orchestration mode, while
 * Claude's documented effort controls accept only the five effort
 * levels. An ultracode recommendation becomes xhigh, then respects the ceiling.
 */
export function resolveExecutionPlan(classification, config = DEFAULT_SAVINGS_CONFIG) {
  const ceiling = config.ceiling ?? DEFAULT_SAVINGS_CONFIG.ceiling;
  const baselineEffort = config.baselineEffort ?? DEFAULT_SAVINGS_CONFIG.baselineEffort;
  if (!isEffort(ceiling) || !isEffort(baselineEffort)) {
    throw new TypeError("invalid savings configuration");
  }

  const succeeded = classification?.status === "ok";
  const decision = succeeded ? classification.decision : null;
  const classifierTier = decision?.tier ?? "auto";
  const requestedEffort = succeeded ? decision.execution.claudeEffort : baselineEffort;
  const effectiveCandidate = isEffort(requestedEffort) ? requestedEffort : baselineEffort;
  const effort = lowerOf(effectiveCandidate, ceiling);
  const ultracodeSuppressed = classifierTier === "ultracode";
  const ceilingApplied = effort !== effectiveCandidate;

  const reasons = succeeded
    ? [...decision.reasons]
    : ["Local classification failed; the configured baseline was used."];
  if (ultracodeSuppressed) {
    reasons.push(
      "Ultracode orchestration is disabled in the one-execution savings launcher; xhigh-or-lower effort is used instead.",
    );
  }
  if (ceilingApplied) {
    reasons.push(`The savings ceiling clamped ${effectiveCandidate} to ${effort}.`);
  }

  return Object.freeze({
    effort,
    ceiling,
    baselineEffort,
    classifierTier,
    modelProfileId: decision?.context?.modelProfileId ?? null,
    modelProfileCatalogVersion: decision?.context?.modelProfileCatalogVersion ?? null,
    confidence: decision?.confidence ?? null,
    classificationStatus: succeeded ? "ok" : "fallback",
    fallbackUsed: !succeeded,
    ceilingApplied,
    ultracodeSuppressed,
    orchestrationMode: "standard",
    reasons: Object.freeze(reasons),
    status: "planned",
  });
}
