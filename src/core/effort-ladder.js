/**
 * Canonical effort ladder — the single source of truth for effort levels and
 * classification tiers (issue #8). Every ordering helper, validation list, and
 * user-facing level enumeration derives from these constants; no other module
 * may define its own copy of the ladder. Model profiles and host vocabularies
 * remain data that reference (or subset) this ladder.
 */

export const EFFORT_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

// Orchestration tiers are classifier recommendations, not model effort
// levels; hosts map them to a native effort (see host-effort-vocabulary.js).
export const ORCHESTRATION_TIERS = Object.freeze(["ultracode"]);

export const TIERS = Object.freeze([...EFFORT_LEVELS, ...ORCHESTRATION_TIERS]);

export function isEffort(value) {
  return EFFORT_LEVELS.includes(value);
}

export function isTier(value) {
  return TIERS.includes(value);
}

/** "low, medium, high, xhigh, or max" — for user-facing messages. */
export function formatEffortLevels(conjunction = "or") {
  const head = EFFORT_LEVELS.slice(0, -1).join(", ");
  return `${head}, ${conjunction} ${EFFORT_LEVELS[EFFORT_LEVELS.length - 1]}`;
}

export function lowerOf(left, right) {
  if (!isEffort(left) || !isEffort(right)) {
    throw new TypeError(`effort must be ${formatEffortLevels()}`);
  }
  return EFFORT_LEVELS[Math.min(EFFORT_LEVELS.indexOf(left), EFFORT_LEVELS.indexOf(right))];
}

/** Clamped shift within the effort levels; non-effort tiers pass through. */
export function shiftEffort(level, offset) {
  if (!isEffort(level) || offset === 0) return level;
  const index = EFFORT_LEVELS.indexOf(level) + offset;
  return EFFORT_LEVELS[Math.max(0, Math.min(EFFORT_LEVELS.length - 1, index))];
}

/** Next tier up the full ladder (orchestration included), saturating at the top. */
export function nextTier(tier) {
  return TIERS[Math.min(TIERS.indexOf(tier) + 1, TIERS.length - 1)];
}
