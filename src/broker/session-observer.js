import { terminalText } from "./pty-session.js";

/**
 * Watches the child CLI's terminal output for the local acknowledgement lines
 * that are the only observable signals for a manual `/effort` choice or a
 * mid-session `/model` change (hooks receive neither event).
 *
 * Verified on Claude Code 2.1.238:
 * - `/effort <level>` prints `Set effort level to <level> …` (both the
 *   "(this session only)" and "saved as your default" variants);
 * - `/effort auto` prints `Effort level set to auto`;
 * - `/model …` prints `Set model to …`.
 *
 * Attribution is conservative in the fail-open direction. Acknowledgements
 * produced by the broker's own application window are consumed; a re-rendered
 * copy of the latest broker acknowledgement is ignored; every other match is
 * treated as an explicit user choice, which only ever disables automation.
 * Model text (for example an assistant reply quoting "Set effort level to
 * max") can therefore cause a false positive whose sole effect is visible
 * unchanged forwarding.
 */

// Real acknowledgements render behind the TUI's `⎿` result marker (verified
// on 2.1.238 for /effort, /effort auto, and /model). Requiring it prevents
// assistant text or displayed file content that merely QUOTES the wording
// (this repository's own docs contain it) from being read as a real command.
const EFFORT_SET_PATTERN = /⎿\s*Set effort level to (low|medium|high|xhigh|max)\b/gi;
const EFFORT_AUTO_PATTERN = /⎿\s*Effort level set to auto\b/gi;
const MODEL_SET_PATTERN = /⎿\s*Set model to \S/g;

export class SessionOutputObserver {
  constructor({ onUserEffort, onModelChange, maxTailChars = 16384 } = {}) {
    this.onUserEffort = onUserEffort;
    this.onModelChange = onModelChange;
    this.maxTailChars = maxTailChars;
    this.tail = "";
    this.brokerApplication = null;
    this.lastBrokerEffort = null;
  }

  beginBrokerApplication(effort) {
    this.brokerApplication = effort;
    this.lastBrokerEffort = effort;
  }

  endBrokerApplication() {
    this.brokerApplication = null;
  }

  feed(chunk) {
    this.tail += chunk;
    if (this.tail.length > this.maxTailChars) this.tail = this.tail.slice(-this.maxTailChars);
    const text = terminalText(this.tail);
    const events = [];
    for (const match of text.matchAll(EFFORT_SET_PATTERN)) {
      events.push({ index: match.index, level: match[1].toLowerCase() });
    }
    for (const match of text.matchAll(EFFORT_AUTO_PATTERN)) {
      events.push({ index: match.index, level: "auto" });
    }
    MODEL_SET_PATTERN.lastIndex = 0;
    const modelChanged = MODEL_SET_PATTERN.test(text);
    if (events.length === 0 && !modelChanged) return;
    events.sort((left, right) => left.index - right.index);
    for (const event of events) this.#handleEffortAcknowledgement(event.level);
    if (modelChanged) this.onModelChange?.();
    this.tail = "";
  }

  #handleEffortAcknowledgement(level) {
    if (level !== "auto" && this.brokerApplication === level) return;
    if (level !== "auto" && this.lastBrokerEffort === level) return;
    this.onUserEffort?.(level);
  }
}
