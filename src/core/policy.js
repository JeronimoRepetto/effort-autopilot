/**
 * The entire MVP routing policy lives here. It is deliberately data-driven so
 * weights and thresholds can be reviewed and revised without changing host
 * adapters. Patterns are deterministic local features, not retrieval queries.
 *
 * IMPORTANT: every current weight and threshold is a hand-authored bootstrap
 * prior. None was learned from outcomes or empirically calibrated, and none
 * should be interpreted as objectively correct. The policy is a replaceable
 * baseline behind the stable classifier contract.
 */

export const TIERS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
]);

export const THRESHOLDS = Object.freeze([
  { min: Number.NEGATIVE_INFINITY, tier: "low" },
  { min: 1, tier: "medium" },
  { min: 4, tier: "high" },
  { min: 7, tier: "xhigh" },
  { min: 10, tier: "max" },
  { min: 13, tier: "ultracode" },
]);

export const LENGTH_BANDS = Object.freeze([
  { minWords: 0, weight: -1, name: "very-short", reason: "The request is very short." },
  { minWords: 9, weight: 0, name: "short", reason: "The request is short and bounded." },
  { minWords: 31, weight: 1, name: "detailed", reason: "The request includes meaningful detail." },
  { minWords: 81, weight: 2, name: "long", reason: "The request is long enough to imply several constraints." },
  { minWords: 181, weight: 3, name: "very-long", reason: "The request contains extensive requirements." },
]);

export const FEATURE_RULES = Object.freeze([
  {
    name: "simple-operation",
    weight: -2,
    pattern: /\b(rename|format|reformat|spellcheck|typo|one[- ]line|single line|explain briefly|summarize briefly|list files|show status|renombra|renombrar|formatea|formatear|ortograf[ií]a|una l[ií]nea|explica brevemente|resume brevemente|lista (?:los )?archivos|muestra (?:el )?estado)\b/i,
    reason: "It asks for a routine, tightly scoped operation.",
  },
  {
    name: "latency-sensitive",
    weight: -1,
    pattern: /\b(quick|quickly|brief|briefly|fast|minimal answer|no explanation|r[aá]pid[oa]|r[aá]pidamente|breve|brevemente|respuesta m[ií]nima|sin explicaci[oó]n)\b/i,
    reason: "It explicitly favors speed or brevity.",
  },
  {
    name: "implementation",
    weight: 1,
    pattern: /\b(implement|build|create|add|write|update|change|fix|patch|implementa(?:r)?|constru(?:ye|ir)|cr[eé]a(?:me|r)?|a[nñ]ad(?:e|ir)|agrega(?:r)?|escri(?:be|bir)|actualiza(?:r)?|cambia(?:r)?|arregla(?:r)?|corrige|corregir|parche)\b/i,
    reason: "It asks for implementation work.",
  },
  {
    name: "investigation",
    weight: 2,
    pattern: /\b(debug|diagnos(?:e|is)|root cause|investigate|trace|race condition|deadlock|flaky|intermittent|depura(?:r)?|diagnostica(?:r)?|causa ra[ií]z|investiga(?:r)?|rastrea(?:r)?|condici[oó]n de carrera|interbloqueo|inestable|intermitente)\b/i,
    reason: "It requires investigation or causal reasoning.",
  },
  {
    name: "architecture",
    weight: 2,
    pattern: /\b(architect(?:ure|ural)?|design system|distributed system|concurrency|consensus|compiler|algorithm|protocol|state machine|arquitectura|arquitect[oó]nico|dise[nñ]a(?:r)?|sistema distribuido|concurrencia|consenso|compilador|algoritmo|protocolo|m[aá]quina de estados)\b/i,
    reason: "It contains architecture or deep technical-design work.",
  },
  {
    name: "broad-scope",
    weight: 2,
    pattern: /\b(across the (?:entire )?(?:repo|repository|codebase)|cross[- ]platform|end[- ]to[- ]end|monorepo|multiple services|system[- ]wide|large[- ]scale|(?:en|por) todo el (?:repo|repositorio|c[oó]digo base)|multiplataforma|de extremo a extremo|m[uú]ltiples servicios|en todo el sistema|a gran escala)\b/i,
    reason: "It spans a broad technical scope.",
  },
  {
    name: "multi-step",
    weight: 2,
    pattern: /(?:^|\n)\s*(?:[-*]|\d+[.)])\s+|\b(first|then|after that|finally|primero|luego|despu[eé]s|finalmente|por [uú]ltimo)\b/imu,
    reason: "It specifies multiple steps or deliverables.",
  },
  {
    name: "verification",
    weight: 1,
    pattern: /\b(test|tests|testing|verify|validation|benchmark|prove|reproduce|prueba|pruebas|probar|verifica(?:r)?|validaci[oó]n|demuestra|demostrar|reproduc(?:e|ir))\b/i,
    reason: "It requires explicit verification.",
  },
  {
    name: "high-stakes",
    weight: 3,
    pattern: /\b(security|vulnerability|authentication|authorization|payment|billing|data loss|production incident|outage|compliance|privacy|safety[- ]critical|seguridad|vulnerabilidad|autenticaci[oó]n|autorizaci[oó]n|pago|facturaci[oó]n|p[eé]rdida de datos|incidente de producci[oó]n|ca[ií]da|cumplimiento|privacidad|cr[ií]tico para la seguridad)\b/i,
    reason: "Errors could have security, reliability, privacy, or financial impact.",
  },
  {
    name: "deep-review",
    weight: 3,
    pattern: /\b(exhaustive|comprehensive audit|all edge cases|formal verification|threat model|production[- ]critical|zero downtime|exhaustiv[oa]|auditor[ií]a (?:integral|exhaustiva)|todos los casos l[ií]mite|verificaci[oó]n formal|modelo de amenazas|cr[ií]tico para producci[oó]n|sin tiempo de inactividad)\b/i,
    reason: "It requests unusually deep or exhaustive analysis.",
  },
  {
    name: "explicit-max",
    weight: 5,
    pattern: /\b(?:(?:use|with|at) )?max(?:imum)? effort|esfuerzo m[aá]ximo\b/i,
    reason: "It explicitly requests maximum reasoning effort.",
  },
  {
    name: "explicit-ultracode",
    weight: 8,
    pattern: /\b(?:use |with |at )?ultracode\b/i,
    reason: "It explicitly requests Claude Code ultracode orchestration.",
  },
]);

// System-facing feature families. Some are combined in classifier.js because
// the combination carries more information than isolated keywords.
export const SYSTEM_FEATURES = Object.freeze({
  ui: Object.freeze({
    pattern: /\b(user interface|UI|button|toggle|floating button|menu bar|tray icon|widget|interfaz(?: de usuario)?|bot[oó]n|interruptor|bot[oó]n flotante|barra de men[uú]|icono de bandeja|widget)\b/i,
  }),
  osIntegration: Object.freeze({
    pattern: /\b(operating system|system[- ]wide|OS[- ]level|computer|desktop app|background service|global hotkey|sistema operativo|en todo el sistema|ordenador|computadora|aplicaci[oó]n de escritorio|servicio en segundo plano|atajo global)\b/i,
  }),
  permissionDeviceControl: Object.freeze({
    pattern: /\b(permission|permissions|entitlement|system API|OS API|microphone|camera|audio device|input device|mute|unmute|device control|permiso|permisos|API del sistema|micr[oó]fono|c[aá]mara|dispositivo de audio|dispositivo de entrada|mutear|mutee|desmutear|desmutee|control de dispositivos)\b/i,
  }),
  multiDevice: Object.freeze({
    pattern: /\b(all|every) (?:the )?(?:microphones?|cameras?|audio devices?|input devices?)|\b(?:todos|todas) (?:los|las) (?:micr[oó]fonos|c[aá]maras|dispositivos de audio|dispositivos de entrada)\b/i,
  }),
  namedPlatform: Object.freeze({
    pattern: /\b(Windows|macOS|Mac OS|Linux|iOS|Android|ChromeOS|Chrome OS)\b/i,
  }),
});

export const ENVIRONMENT_PRIORS = Object.freeze({
  largeRepositoryFiles: 5000,
  largeRepositoryWeight: 1,
  multiProjectWeight: 2,
  mixedProjectKindsWeight: 1,
  permissionsSensitiveWeight: 2,
});

export const UNCERTAINTY_RULES = Object.freeze([
  {
    name: "underspecified-reference",
    pattern: /^(?:please\s+)?(?:fix|change|update|improve|review|handle)\s+(?:it|this|that)\s*[.!?]*$/i,
    reason: "The request is underspecified and may hide more work than its length suggests.",
  },
  {
    name: "question-only",
    pattern: /^\s*(?:can you|could you|would you|help|thoughts\??)\s*[.!?]*$/i,
    reason: "The request does not yet reveal its real scope.",
  },
]);

// Ultracode is gated independently from score. It is orchestration mode, not a
// model effort level, and should be rare without explicit user intent.
export const ULTRACODE_GATE = Object.freeze({
  minScore: 13,
  minWords: 45,
  minWorkstreamSignals: 2,
  workstreamSignalNames: Object.freeze([
    "broad-scope",
    "multi-step",
    "architecture",
    "investigation",
    "high-stakes",
    "deep-review",
  ]),
});

export const CONFIDENCE_POLICY = Object.freeze({
  base: 0.5,
  perDistinctSignal: 0.055,
  explicitIntentBonus: 0.18,
  boundaryPenalty: 0.08,
  uncertaintyPenalty: 0.25,
  missingModelProfilePenalty: 0.05,
  minimum: 0.2,
  maximum: 0.96,
  conservativeThreshold: 0.55,
});
