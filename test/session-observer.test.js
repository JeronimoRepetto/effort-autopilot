import assert from "node:assert/strict";
import test from "node:test";

import { SessionOutputObserver } from "../src/broker/session-observer.js";

function record() {
  const events = [];
  const observer = new SessionOutputObserver({
    onUserEffort: (level) => events.push(`effort:${level}`),
    onModelChange: () => events.push("model-change"),
  });
  return { observer, events };
}

test("manual effort acknowledgement is detected across chunk splits and ANSI controls", () => {
  const { observer, events } = record();
  observer.feed("[2K❯ /effort high\n⎿ Set effort le");
  assert.deepEqual(events, []);
  observer.feed("vel to [1mhigh[0m (saved as your default for new sessions)");
  assert.deepEqual(events, ["effort:high"]);
});

test("the session-only acknowledgement variant also counts as a user choice", () => {
  const { observer, events } = record();
  observer.feed("⎿ Set effort level to xhigh (this session only)\n");
  assert.deepEqual(events, ["effort:xhigh"]);
});

test("broker-applied effort acknowledgements are never attributed to the user", () => {
  const { observer, events } = record();
  observer.beginBrokerApplication("max");
  observer.feed("⎿ Set effort level to max (this session only)\n");
  observer.endBrokerApplication();
  // A later TUI re-render of the same acknowledgement stays suppressed.
  observer.feed("⎿ Set effort level to max (this session only)\n");
  assert.deepEqual(events, []);
  // A different level outside any application window is an explicit choice.
  observer.feed("⎿ Set effort level to low (this session only)\n");
  assert.deepEqual(events, ["effort:low"]);
});

test("effort auto acknowledgement reports auto so automation can resume", () => {
  const { observer, events } = record();
  observer.feed("❯ /effort auto\n⎿ Effort level set to auto\n");
  assert.deepEqual(events, ["effort:auto"]);
});

test("a model change acknowledgement is reported without parsing the model", () => {
  const { observer, events } = record();
  observer.feed("⎿ Set model to Sonnet 5 and saved as your default for new sessions\n");
  assert.deepEqual(events, ["model-change"]);
});

test("quoted acknowledgement wording without the TUI result marker is ignored", () => {
  const { observer, events } = record();
  // Assistant text or displayed docs can quote the exact wording; only the
  // `⎿`-marked result line is a real local command acknowledgement.
  observer.feed("The CLI prints `Set effort level to max (this session only)` on success\n");
  observer.feed("and `Set model to Sonnet 5 and saved as your default for new sessions`.\n");
  observer.feed("Use Effort level set to auto to re-enable automation.\n");
  assert.deepEqual(events, []);
});

test("typed command echo without an acknowledgement is ignored", () => {
  const { observer, events } = record();
  observer.feed("❯ /effort high");
  observer.feed("❯ /model sonnet");
  assert.deepEqual(events, []);
});

test("mixed acknowledgements in one burst are handled in on-screen order", () => {
  const { observer, events } = record();
  observer.feed(
    "⎿ Set effort level to low (this session only)\n" +
    "⎿ Effort level set to auto\n" +
    "⎿ Set model to Haiku 4.5\n",
  );
  assert.deepEqual(events, ["effort:low", "effort:auto", "model-change"]);
});
