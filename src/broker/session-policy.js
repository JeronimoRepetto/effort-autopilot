/**
 * Session-level effort precedence policy.
 *
 * Bridges observed terminal facts (manual /effort, /model changes, session
 * registration) to coordinator state under one of two launch policies:
 *
 * - `manual-wins` (default): an observed manual /effort latches explicit user
 *   precedence; `/effort auto` clears it and hands control back.
 * - `autopilot-wins`: manual choices never latch precedence, so every prompt
 *   is re-evaluated — but they are mirrored to the coordinator as a
 *   "standing" session level, which an uncertain classification respects
 *   instead of applying the uncertainty floor. An applied automatic turn
 *   overwrites the standing choice.
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
    if (!this.autopilotWins) {
      if (launchEffort) this.coordinator.updateUserEffort(sessionId, launchEffort);
      return;
    }
    // Seed the coordinator's known level; a launch --effort flag is an
    // explicit user choice, so it stands against the uncertainty floor,
    // while a saved-default baseline merely makes the level known.
    this.coordinator.noteSessionEffort?.(sessionId, this.currentEffort, {
      manualStanding: Boolean(launchEffort),
    });
  }

  handleUserEffort(level) {
    if (!this.sessionId) return;
    this.currentEffort = level === "auto" ? null : level;
    if (this.autopilotWins) {
      this.coordinator.noteSessionEffort?.(this.sessionId, this.currentEffort, {
        manualStanding: level !== "auto",
      });
      return;
    }
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
