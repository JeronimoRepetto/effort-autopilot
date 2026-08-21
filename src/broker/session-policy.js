/**
 * Session-level effort precedence policy.
 *
 * Bridges observed terminal facts (manual /effort, /model changes, session
 * registration) to coordinator state under one of two launch policies:
 *
 * - `manual-wins` (default): an observed manual /effort latches explicit user
 *   precedence; `/effort auto` clears it and hands control back.
 * - `autopilot-wins`: manual choices are tracked as the session's current
 *   level but never latch precedence, so every prompt is re-evaluated.
 *
 * It also tracks the session's known active level so the broker can skip
 * re-sending an already-active effort (observed on 2.1.238: a same-level
 * /effort can persist the saved default even in a pinned session).
 */
export class SessionEffortPolicy {
  constructor({ coordinator, autopilotWins = false, initialEffort = null }) {
    if (!coordinator) throw new TypeError("coordinator required");
    this.coordinator = coordinator;
    this.autopilotWins = Boolean(autopilotWins);
    this.currentEffort = initialEffort;
    this.sessionId = null;
  }

  handleSessionStart(sessionId, launchEffort = null) {
    if (!sessionId) return;
    this.sessionId = sessionId;
    if (launchEffort && !this.autopilotWins) {
      this.coordinator.updateUserEffort(sessionId, launchEffort);
    }
  }

  handleUserEffort(level) {
    if (!this.sessionId) return;
    this.currentEffort = level === "auto" ? null : level;
    if (this.autopilotWins) return;
    if (level === "auto") this.coordinator.clearUserEffort(this.sessionId);
    else this.coordinator.updateUserEffort(this.sessionId, level);
  }

  handleModelChange() {
    if (this.sessionId) this.coordinator.markModelAmbiguous(this.sessionId);
  }

  shouldSkipApplication(effort) {
    return Boolean(this.currentEffort) && effort === this.currentEffort;
  }

  noteAcknowledgedApplication(effort) {
    this.currentEffort = effort;
  }
}
