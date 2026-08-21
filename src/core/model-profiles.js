/**
 * Versioned, local model-capability profiles used before Claude starts.
 *
 * `effortOffset` values are hand-authored bootstrap priors, not learned facts.
 * They express the provisional hypothesis that the same task may need more
 * effort on a smaller model and less effort on a stronger model. Empirical
 * calibration artifacts can replace those offsets without changing this
 * contract.
 */

export const MODEL_PROFILE_SCHEMA_VERSION = 1;
export const MODEL_PROFILE_CATALOG_VERSION = "2026-08-21.bootstrap.1";

const OFFICIAL_PROVENANCE = Object.freeze({
  modelConfiguration: "https://code.claude.com/docs/en/model-config",
  modelOverview: "https://platform.claude.com/docs/en/about-claude/models/overview",
  effort: "https://platform.claude.com/docs/en/build-with-claude/effort",
  checkedAt: "2026-08-21",
  claudeCodeVersion: "2.1.238",
});

function profile(value) {
  return Object.freeze({
    schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
    catalogVersion: MODEL_PROFILE_CATALOG_VERSION,
    ultracodeAvailable: false,
    calibration: Object.freeze({
      status: "bootstrap-unlearned",
      datasetVersion: null,
      artifactVersion: null,
    }),
    provenance: OFFICIAL_PROVENANCE,
    ...value,
    aliases: Object.freeze(value.aliases ?? []),
    supportedEfforts: Object.freeze(value.supportedEfforts),
  });
}

export const MODEL_PROFILES = Object.freeze({
  "claude-haiku-4-5-20251001": profile({
    id: "claude-haiku-4-5-20251001",
    family: "haiku",
    capabilityTier: "fast",
    aliases: ["claude-haiku-4-5"],
    supportedEfforts: ["low", "medium", "high"],
    effortCap: "high",
    effortOffset: 1,
  }),
  "claude-sonnet-5": profile({
    id: "claude-sonnet-5",
    family: "sonnet",
    capabilityTier: "balanced",
    aliases: [],
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    effortCap: "max",
    effortOffset: 0,
  }),
  "claude-fable-5": profile({
    id: "claude-fable-5",
    family: "fable",
    capabilityTier: "strongest",
    aliases: [],
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    effortCap: "max",
    effortOffset: -1,
  }),
});

/**
 * Resolve only immutable, exact model IDs (or a dated API alias that resolves
 * to a single pinned snapshot). Mutable family aliases such as `sonnet` and
 * `fable` deliberately return null so version-specific calibration is never
 * misapplied after an upstream alias changes.
 */
export function resolveBundledModelProfile(modelId) {
  if (typeof modelId !== "string" || modelId.trim() === "") return null;
  const normalized = modelId.trim().toLowerCase();
  if (MODEL_PROFILES[normalized]) return MODEL_PROFILES[normalized];
  return Object.values(MODEL_PROFILES).find(({ aliases }) => aliases.includes(normalized)) ?? null;
}

export function resolveModelProfile({ modelId, override } = {}) {
  if (override !== undefined && override !== null) {
    if (typeof override !== "object" || Array.isArray(override)) {
      throw new TypeError("model profile override must be an object");
    }
    if (modelId && override.id && override.id !== modelId) {
      throw new Error(`model profile ${override.id} does not match requested model ${modelId}`);
    }
    return override;
  }
  return resolveBundledModelProfile(modelId);
}
