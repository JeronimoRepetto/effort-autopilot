import { EFFORT_LEVELS, TIERS } from "./effort-ladder.js";

/**
 * Per-host effort vocabulary as data (issue #8): the ordered native levels a
 * host accepts plus the mapping from classifier tiers to those native levels.
 * Supporting a host whose vocabulary differs from the canonical ladder (for
 * example OpenAI's minimal|low|medium|high) is a data entry here, not a code
 * hunt. Only the Claude Code vocabulary ships today.
 */

export const HOST_EFFORT_VOCABULARY_SCHEMA_VERSION = 1;
export const DEFAULT_HOST_ID = "claude-code";

export const HOST_EFFORT_VOCABULARIES = Object.freeze({
  "claude-code": Object.freeze({
    id: "claude-code",
    schemaVersion: HOST_EFFORT_VOCABULARY_SCHEMA_VERSION,
    // Claude Code accepts the canonical effort levels natively.
    nativeLevels: EFFORT_LEVELS,
    // Ultracode is orchestration mode, not an effort level Claude's /effort
    // accepts; its pre-call recommendation degrades to xhigh (the ceiling
    // still applies downstream).
    tierToNative: Object.freeze({
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
      ultracode: "xhigh",
    }),
  }),
});

export function resolveHostEffortVocabulary(hostId = DEFAULT_HOST_ID) {
  return HOST_EFFORT_VOCABULARIES[hostId] ?? null;
}

export function mapTierToNativeEffort(
  tier,
  vocabulary = HOST_EFFORT_VOCABULARIES[DEFAULT_HOST_ID],
) {
  if (!TIERS.includes(tier)) {
    throw new TypeError(`unknown classifier tier: ${tier}`);
  }
  const native = vocabulary?.tierToNative?.[tier];
  if (typeof native !== "string" || !vocabulary.nativeLevels.includes(native)) {
    throw new TypeError(`host vocabulary ${vocabulary?.id ?? "unknown"} does not map tier ${tier}`);
  }
  return native;
}
