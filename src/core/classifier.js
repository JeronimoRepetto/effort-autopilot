import {
  CONFIDENCE_POLICY,
  ENVIRONMENT_PRIORS,
  FEATURE_RULES,
  LENGTH_BANDS,
  THRESHOLDS,
  TIERS,
  SYSTEM_FEATURES,
  ULTRACODE_GATE,
  UNCERTAINTY_RULES,
} from "./policy.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wordCount(prompt) {
  const words = prompt.trim().match(/[\p{L}\p{N}_'-]+/gu);
  return words?.length ?? 0;
}

function chooseLengthBand(words) {
  return LENGTH_BANDS.reduce(
    (selected, band) => (words >= band.minWords ? band : selected),
    LENGTH_BANDS[0],
  );
}

export function tierForScore(score) {
  return THRESHOLDS.reduce(
    (selected, threshold) => (score >= threshold.min ? threshold.tier : selected),
    "low",
  );
}

function isBoundaryScore(score) {
  return THRESHOLDS.slice(1).some(({ min }) => score === min || score === min - 1);
}

function nextTier(tier) {
  return TIERS[Math.min(TIERS.indexOf(tier) + 1, TIERS.length - 1)];
}

const EFFORT_TIERS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

function shiftEffortTier(tier, offset) {
  if (!EFFORT_TIERS.includes(tier) || offset === 0) return tier;
  const index = EFFORT_TIERS.indexOf(tier);
  return EFFORT_TIERS[clamp(index + offset, 0, EFFORT_TIERS.length - 1)];
}

function normalizeContext(context) {
  if (context === undefined) return { modelProfile: null, environment: null };
  if (context === null || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("context must be an object");
  }
  const modelProfile = context.modelProfile ?? null;
  const environment = context.environment ?? null;
  if (modelProfile !== null && (typeof modelProfile !== "object" || Array.isArray(modelProfile))) {
    throw new TypeError("modelProfile must be an object");
  }
  if (environment !== null && (typeof environment !== "object" || Array.isArray(environment))) {
    throw new TypeError("environment must be an object");
  }
  return { modelProfile, environment };
}

function addSystemSignals(prompt, environment, signals) {
  const hasUi = SYSTEM_FEATURES.ui.pattern.test(prompt);
  const hasOsIntegration = SYSTEM_FEATURES.osIntegration.pattern.test(prompt);
  const hasDeviceControl = SYSTEM_FEATURES.permissionDeviceControl.pattern.test(prompt);
  const hasMultiDevice = SYSTEM_FEATURES.multiDevice.pattern.test(prompt);
  const environmentNamesPlatform =
    typeof environment?.platform === "string" && environment.platform !== "unknown";

  if (hasOsIntegration) {
    signals.push({
      name: "os-system-integration",
      weight: 2,
      reason: "It requires operating-system or system-wide integration.",
    });
  }
  if (hasDeviceControl) {
    signals.push({
      name: "permissions-device-control",
      weight: 2,
      reason: "It controls protected devices or APIs and may require OS permissions.",
    });
  }
  if (hasMultiDevice) {
    signals.push({
      name: "multi-device-state",
      weight: 1,
      reason: "It must coordinate state across multiple devices.",
    });
  }
  if (hasUi && (hasOsIntegration || hasDeviceControl)) {
    signals.push({
      name: "ui-system-combination",
      weight: 1,
      reason: "It combines interactive UI state with system behavior.",
    });
  }
  if (
    (hasOsIntegration || hasDeviceControl) &&
    !SYSTEM_FEATURES.namedPlatform.pattern.test(prompt) &&
    !environmentNamesPlatform
  ) {
    signals.push({
      name: "platform-ambiguity",
      weight: 1,
      reason: "The required platform APIs are ambiguous.",
    });
  }
}

function addEnvironmentSignals(environment, signals) {
  if (!environment) return [];
  const used = [];
  if (
    Number.isInteger(environment.repositoryFileCount) &&
    environment.repositoryFileCount >= ENVIRONMENT_PRIORS.largeRepositoryFiles
  ) {
    signals.push({
      name: "environment:large-repository",
      weight: ENVIRONMENT_PRIORS.largeRepositoryWeight,
      reason: "Local project metadata indicates a large repository.",
    });
    used.push("repositoryFileCount");
  }
  if (environment.multiProject === true) {
    signals.push({
      name: "environment:multi-project",
      weight: ENVIRONMENT_PRIORS.multiProjectWeight,
      reason: "Local metadata indicates work spanning multiple projects.",
    });
    used.push("multiProject");
  }
  if (Array.isArray(environment.projectKinds) && environment.projectKinds.length > 1) {
    signals.push({
      name: "environment:mixed-project-kinds",
      weight: ENVIRONMENT_PRIORS.mixedProjectKindsWeight,
      reason: "Local metadata indicates multiple project surfaces.",
    });
    used.push("projectKinds");
  }
  if (environment.permissionsSensitive === true) {
    signals.push({
      name: "environment:permissions-sensitive",
      weight: ENVIRONMENT_PRIORS.permissionsSensitiveWeight,
      reason: "Local metadata marks the project as permissions-sensitive.",
    });
    used.push("permissionsSensitive");
  }
  if (typeof environment.platform === "string") used.push("platform");
  return used;
}

function resolveSupportedEffort(tier, modelProfile) {
  const requestedEffort = tier === "ultracode" ? "xhigh" : tier;
  const supported = Array.isArray(modelProfile?.supportedEfforts)
    ? modelProfile.supportedEfforts.filter((value) => EFFORT_TIERS.includes(value))
    : null;
  const cap = EFFORT_TIERS.includes(modelProfile?.effortCap) ? modelProfile.effortCap : null;
  let resolved = requestedEffort;
  if (cap && EFFORT_TIERS.indexOf(resolved) > EFFORT_TIERS.indexOf(cap)) {
    resolved = cap;
  }
  if (supported?.length && !supported.includes(resolved)) {
    const requestedIndex = EFFORT_TIERS.indexOf(resolved);
    resolved =
      [...supported]
        .sort((a, b) => EFFORT_TIERS.indexOf(b) - EFFORT_TIERS.indexOf(a))
        .find((value) => EFFORT_TIERS.indexOf(value) <= requestedIndex) ?? supported[0];
  }
  const ultracodeAvailable = modelProfile?.ultracodeAvailable === true;
  return {
    requestedTier: tier,
    claudeEffort: resolved,
    orchestrationMode: tier === "ultracode" && ultracodeAvailable ? "ultracode" : "standard",
    fallbackTier: tier === "ultracode" ? resolved : "auto",
    clamped: resolved !== requestedEffort || (tier === "ultracode" && !ultracodeAvailable),
    status: "unapplied",
  };
}

/**
 * Classify a prompt with local deterministic features only.
 *
 * The returned object intentionally contains no prompt or prompt excerpt. This
 * makes decisions explainable without persisting or echoing private content.
 */
export function classifyPrompt(prompt, context) {
  if (typeof prompt !== "string") {
    throw new TypeError("prompt must be a string");
  }

  const normalized = prompt.normalize("NFKC").trim();
  if (!normalized) {
    throw new TypeError("prompt must not be empty");
  }

  const { modelProfile, environment } = normalizeContext(context);
  const words = wordCount(normalized);
  const lengthBand = chooseLengthBand(words);
  const signals = [
    {
      name: `length:${lengthBand.name}`,
      weight: lengthBand.weight,
      reason: lengthBand.reason,
    },
  ];

  for (const rule of FEATURE_RULES) {
    if (rule.pattern.test(normalized)) {
      signals.push({ name: rule.name, weight: rule.weight, reason: rule.reason });
    }
  }
  addSystemSignals(normalized, environment, signals);
  const environmentMetadataUsed = addEnvironmentSignals(environment, signals);

  const uncertaintySignals = UNCERTAINTY_RULES.filter((rule) => rule.pattern.test(normalized));

  const score = signals.reduce((total, signal) => total + signal.weight, 0);
  let tier = tierForScore(score);

  const explicitMax = signals.some(({ name }) => name === "explicit-max");
  const explicitUltracode = signals.some(({ name }) => name === "explicit-ultracode");
  const explicitIntent = explicitMax || explicitUltracode;
  if (explicitUltracode) {
    tier = "ultracode";
  } else if (explicitMax && TIERS.indexOf(tier) < TIERS.indexOf("max")) {
    tier = "max";
  }

  const distinctWeightedSignals = signals.filter(({ weight }) => weight !== 0).length;
  let confidence =
    CONFIDENCE_POLICY.base +
    distinctWeightedSignals * CONFIDENCE_POLICY.perDistinctSignal +
    (explicitIntent ? CONFIDENCE_POLICY.explicitIntentBonus : 0) -
    (isBoundaryScore(score) ? CONFIDENCE_POLICY.boundaryPenalty : 0) -
    (!modelProfile ? CONFIDENCE_POLICY.missingModelProfilePenalty : 0) -
    (uncertaintySignals.length ? CONFIDENCE_POLICY.uncertaintyPenalty : 0);
  confidence = clamp(confidence, CONFIDENCE_POLICY.minimum, CONFIDENCE_POLICY.maximum);

  let conservativeEscalation = false;
  if (confidence < CONFIDENCE_POLICY.conservativeThreshold && !explicitIntent) {
    tier = nextTier(tier);
    conservativeEscalation = true;
  }

  if (tier === "ultracode" && !explicitUltracode) {
    const workstreamSignals = signals.filter(({ name }) =>
      ULTRACODE_GATE.workstreamSignalNames.includes(name),
    ).length;
    const gatePassed =
      score >= ULTRACODE_GATE.minScore &&
      words >= ULTRACODE_GATE.minWords &&
      workstreamSignals >= ULTRACODE_GATE.minWorkstreamSignals;
    if (!gatePassed) {
      tier = "max";
      signals.push({
        name: "ultracode-gate-not-met",
        weight: 0,
        reason:
          "The task does not show enough long-horizon, multi-workstream structure for ultracode.",
      });
    }
  }

  const baseTier = tier;
  const rawOffset = Number.isInteger(modelProfile?.effortOffset) ? modelProfile.effortOffset : 0;
  const modelRelativeOffset = clamp(rawOffset, -2, 2);
  if (!explicitIntent) {
    tier = shiftEffortTier(tier, modelRelativeOffset);
  }

  const reasons = [
    ...signals.filter(({ weight }) => weight !== 0).map(({ reason }) => reason),
    ...uncertaintySignals.map(({ reason }) => reason),
  ];
  if (conservativeEscalation) {
    reasons.push("Low confidence triggered a conservative one-tier escalation.");
  }
  if (modelRelativeOffset !== 0 && tier !== baseTier) {
    reasons.push(
      `The supplied active-model profile adjusted the minimum sufficient effort by ${modelRelativeOffset > 0 ? "+" : ""}${modelRelativeOffset} tier(s).`,
    );
  }
  if (!modelProfile) {
    reasons.push(
      "No active-model capability profile was supplied, so model-relative calibration was not applied.",
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    baseTier,
    preliminaryTier: tier,
    predictedMinimumSufficientEffort: tier,
    tier,
    score,
    confidence: Number(confidence.toFixed(2)),
    conservativeEscalation,
    signals: Object.freeze(signals.map(({ name, weight }) => ({ name, weight }))),
    reasons: Object.freeze(reasons),
    context: Object.freeze({
      modelProfileApplied: modelProfile !== null,
      modelProfileId: typeof modelProfile?.id === "string" ? modelProfile.id : null,
      modelProfileCatalogVersion:
        typeof modelProfile?.catalogVersion === "string" ? modelProfile.catalogVersion : null,
      modelRelativeOffset,
      environmentMetadataUsed: Object.freeze(environmentMetadataUsed),
    }),
    execution: Object.freeze(resolveSupportedEffort(tier, modelProfile)),
  });
}
