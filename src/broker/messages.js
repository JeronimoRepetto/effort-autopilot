/**
 * User-facing broker status messages, localized per prompt.
 *
 * English is the default; Spanish is selected only when the prompt itself
 * shows clear Spanish evidence (Spanish-only characters, or at least two
 * common Spanish words). Detection is a local heuristic over the prompt that
 * is already in memory — no prompt content is stored or reported, and the
 * machine-readable cause codes stay untranslated inside parentheses.
 */

const SPANISH_CHARACTERS = /[áéíóúüñ¿¡]/iu;
const SPANISH_WORDS = /(?<![\p{L}\p{N}_])(?:que|qué|para|cómo|como|hace|hacer|haz|una|uno|este|esta|esto|con|por|los|las|del|más|pero|también|añade|crea|arregla|revisa|explica|explícame|cambia|funciona|quiero|necesito|ayuda|código|proyecto|archivo|prueba|nuevo|nueva|cuando|dónde|porque|ahora|entonces)(?![\p{L}\p{N}_])/giu;

export function detectMessageLanguage(prompt) {
  if (typeof prompt !== "string" || prompt.length === 0) return "en";
  if (SPANISH_CHARACTERS.test(prompt)) return "es";
  SPANISH_WORDS.lastIndex = 0;
  return (prompt.match(SPANISH_WORDS) ?? []).length >= 2 ? "es" : "en";
}

const CATALOG = Object.freeze({
  en: Object.freeze({
    applying:
      "Effort Autopilot is choosing the right effort level for this task; your prompt will be resubmitted automatically in a moment.",
    busy: "Effort Autopilot is still routing the previous task.",
    explicitUserEffort:
      "Effort Autopilot: keeping your manual effort choice (explicit-user-effort).",
    applied: (effort, model) => `Effort Autopilot: applied ${effort} for ${model}.`,
    appliedDialogNote: " The CLI's confirmation also saved this level as your default.",
    unchanged: (cause) => `Effort Autopilot: automatic effort unchanged (${cause}).`,
    brokerUnavailable: "Effort Autopilot: automatic effort unchanged (broker unavailable).",
  }),
  es: Object.freeze({
    applying:
      "Effort Autopilot está eligiendo el nivel de esfuerzo adecuado para esta tarea; tu prompt se reenviará automáticamente en un instante.",
    busy: "Effort Autopilot todavía está enrutando la tarea anterior.",
    explicitUserEffort:
      "Effort Autopilot: se mantiene tu elección manual de esfuerzo (explicit-user-effort).",
    applied: (effort, model) => `Effort Autopilot: esfuerzo ${effort} aplicado para ${model}.`,
    appliedDialogNote: " La confirmación del CLI también guardó este nivel como tu valor por defecto.",
    unchanged: (cause) => `Effort Autopilot: esfuerzo automático sin cambios (${cause}).`,
    brokerUnavailable: "Effort Autopilot: esfuerzo automático sin cambios (broker unavailable).",
  }),
});

export function brokerMessages(prompt) {
  return CATALOG[detectMessageLanguage(prompt)];
}
