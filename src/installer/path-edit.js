/**
 * Pure string transformations for reversible PATH installation. No IO here:
 * the effectful installer feeds these with what it read and writes back the
 * results, so every transformation is unit-testable.
 */

function normalizeSegment(segment, caseInsensitive) {
  const trimmed = segment.trim().replace(/[\\/]+$/, "");
  return caseInsensitive ? trimmed.toLowerCase() : trimmed;
}

export function splitPathList(value, separator) {
  return (value ?? "").split(separator).filter((segment) => segment.trim() !== "");
}

export function containsPathEntry(value, entry, { separator = ";", caseInsensitive = true } = {}) {
  const target = normalizeSegment(entry, caseInsensitive);
  return splitPathList(value, separator).some(
    (segment) => normalizeSegment(segment, caseInsensitive) === target,
  );
}

/** Prepend `entry`, removing any existing occurrence so the result is stable. */
export function prependPathEntry(value, entry, options = {}) {
  const { separator = ";" } = options;
  const rest = removePathEntry(value, entry, options);
  return rest === "" ? entry : `${entry}${separator}${rest}`;
}

/** Remove every occurrence of `entry`, preserving all other segments verbatim. */
export function removePathEntry(value, entry, { separator = ";", caseInsensitive = true } = {}) {
  const target = normalizeSegment(entry, caseInsensitive);
  return splitPathList(value, separator)
    .filter((segment) => normalizeSegment(segment, caseInsensitive) !== target)
    .join(separator);
}

const PROFILE_BLOCK_BEGIN = "# effort-autopilot begin";
const PROFILE_BLOCK_END = "# effort-autopilot end";

export function shellProfileBlock(shimDir) {
  return `${PROFILE_BLOCK_BEGIN}\nexport PATH="${shimDir}:$PATH"\n${PROFILE_BLOCK_END}`;
}

const PROFILE_BLOCK_PATTERN = new RegExp(
  `\\n?${PROFILE_BLOCK_BEGIN}[\\s\\S]*?${PROFILE_BLOCK_END}\\n?`,
  "g",
);

/** Idempotent: replaces an existing managed block instead of stacking a second. */
export function upsertProfileBlock(profileText, shimDir) {
  const cleaned = removeProfileBlock(profileText);
  const separator = cleaned === "" || cleaned.endsWith("\n") ? "" : "\n";
  return `${cleaned}${separator}\n${shellProfileBlock(shimDir)}\n`;
}

export function removeProfileBlock(profileText) {
  return (profileText ?? "").replace(PROFILE_BLOCK_PATTERN, "\n").replace(/\n{3,}/g, "\n\n");
}

export function hasProfileBlock(profileText) {
  PROFILE_BLOCK_PATTERN.lastIndex = 0;
  return PROFILE_BLOCK_PATTERN.test(profileText ?? "");
}
