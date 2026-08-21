import assert from "node:assert/strict";
import test from "node:test";

import { brokerMessages, detectMessageLanguage } from "../src/broker/messages.js";

test("English is the default language, including for edge inputs", () => {
  assert.equal(detectMessageLanguage("fix the login bug and add tests"), "en");
  assert.equal(detectMessageLanguage("refactor auth module"), "en");
  // Single ambiguous word is not enough evidence.
  assert.equal(detectMessageLanguage("update the config del sistema"), "en");
  assert.equal(detectMessageLanguage(""), "en");
  assert.equal(detectMessageLanguage(null), "en");
});

test("clear Spanish evidence selects Spanish", () => {
  // Spanish-only characters win immediately.
  assert.equal(detectMessageLanguage("¿puedes revisar esto?"), "es");
  assert.equal(detectMessageLanguage("añade una función"), "es");
  // Two common Spanish words without accents also qualify.
  assert.equal(detectMessageLanguage("que hace este proyecto?"), "es");
  assert.equal(detectMessageLanguage("explica como funciona el broker"), "es");
});

test("both catalogs keep the machine-readable cause codes untranslated", () => {
  for (const prompt of ["fix the bug", "arregla el código por favor"]) {
    const messages = brokerMessages(prompt);
    assert.match(messages.unchanged("insufficient-confidence"), /\(insufficient-confidence\)\.$/);
    assert.match(messages.explicitUserEffort, /\(explicit-user-effort\)\.$/);
    assert.match(messages.applied("xhigh", "claude-opus-5"), /xhigh/);
    assert.match(messages.applied("xhigh", "claude-opus-5"), /claude-opus-5/);
    assert.equal(typeof messages.applying, "string");
    assert.equal(typeof messages.busy, "string");
  }
  assert.notEqual(
    brokerMessages("fix the bug").applying,
    brokerMessages("arregla el código").applying,
  );
});
