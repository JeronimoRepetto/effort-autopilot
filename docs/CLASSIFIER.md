# Deterministic classifier

## What it is

The MVP classifier is a transparent, dependency-free bootstrap policy. It is not AI, RAG, document retrieval, an embedding search, or an LLM call. It performs Unicode normalization, counts words, matches explicit English and Spanish patterns, adds cheap context priors, and computes a score.

It is intentionally replaceable behind the envelope contract. Its hand-authored feature weights and thresholds are bootstrap priors—not learned values, objective truths, or a claim of general semantic understanding.

## Inputs

`classifyPrompt(prompt, context)` accepts:

- a required non-empty string prompt;
- an optional active-model profile;
- optional environment/project metadata.

The active-model profile may contain `supportedEfforts`, `effortCap`, an integer `effortOffset` clamped to `-2..2`, and `ultracodeAvailable`. The same task can require a different minimum tier on different model families or versions, so a production calibration must be model-relative. The current CLI accepts a local profile with `--model-profile`; it does not infer one from the model name.

The metadata collector reads only bounded local facts: runtime platform, Git tracked-file count, selected root marker files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `.sln`), JavaScript workspaces, and desktop-app package markers. It never recursively walks the full tree.

## Policy data

All policy constants live in [`src/core/policy.js`](../src/core/policy.js). This keeps reviewable data separate from the classifier algorithm.

### Score thresholds

| Raw score | Preliminary score tier |
| --- | --- |
| `<= 0` | `low` |
| `1..3` | `medium` |
| `4..6` | `high` |
| `7..9` | `xhigh` |
| `10..12` | `max` |
| `>= 13` | ultracode candidate |

The ultracode candidate must still pass a separate gate.

### Length bands

| Words | Signal | Weight |
| --- | --- | ---: |
| `0..8` | `length:very-short` | -1 |
| `9..30` | `length:short` | 0 |
| `31..80` | `length:detailed` | +1 |
| `81..180` | `length:long` | +2 |
| `181+` | `length:very-long` | +3 |

### Feature families

The general feature weights are: simple operation -2; latency-sensitive -1; implementation +1; investigation +2; architecture +2; broad scope +2; multiple steps +2; verification +1; high stakes +3; deep review +3; explicit max +5; explicit ultracode +8.

System-facing combinations add: OS/system integration +2; protected device or permission control +2; multi-device state +1; UI plus system behavior +1; and ambiguous target platform +1. Environment priors add: at least 5,000 tracked files +1; multi-project +2; mixed project kinds +1; and permissions-sensitive/desktop application +2.

Patterns cover the core families in English and Spanish. This is explicit multilingual feature coverage, not general language understanding.

For example, the Spanish request to create a floating toggle that mutes every computer microphone matches implementation, OS integration, protected-device control, multiple-device state, UI/system combination, and platform ambiguity. It therefore routes conservatively to `xhigh` before a typical savings ceiling. The classifier still cannot infer all hidden platform or acceptance constraints.

## Confidence and uncertainty

Heuristic confidence is:

```text
0.50
+ 0.055 per non-zero matched signal
+ 0.18 for explicit max/ultracode intent
- 0.08 at or immediately below a tier boundary
- 0.25 for a recognized underspecified request
- 0.05 when no model profile is supplied
```

The result is clamped to `0.20..0.96` and rounded to two decimals. If confidence is below `0.55` and there is no explicit intent, the classifier escalates one tier. The broker independently gates on insufficient confidence: under `manual-wins` it is pure fail-open/no-change, while under `autopilot-wins` it floors the session at `high` unless a manual choice is standing or the level already suffices (see the [product contract](PRODUCT.md)). The broker's user ceiling remains authoritative when automation is allowed.

The confidence number is not statistically calibrated. [Calibration](CALIBRATION.md) describes held-out calibration of a future learned model.

## Ultracode semantics and gate

Ultracode is an orchestration recommendation, not model effort. Unless explicitly requested, a score of at least 13 must also have at least 45 words and at least two long-horizon workstream signals among broad scope, multiple steps, architecture, investigation, high stakes, and deep review. Otherwise it is downgraded to `max` with an explanatory signal.

The broker never enables ultracode workflows. Planning may map the recommendation to standard xhigh-or-lower effort for internal evaluation, but the product cannot silently add orchestration or subagents.

## Model-relative and capability resolution

After the bootstrap tier, an optional model `effortOffset` shifts ordinary effort tiers by up to two steps. Explicit max or ultracode intent is not shifted. `effortCap` and `supportedEfforts` then provide an **unapplied** compatibility recommendation. The broker applies user precedence, confidence, acknowledgement, and ceiling rules independently.

Current profiles are user-supplied inputs, not validated empirical calibrations. Dataset and calibration versions should be added before learned profiles are distributed.

## Output contract

The decision includes:

- `baseTier`, `preliminaryTier`, `predictedMinimumSufficientEffort`, and `tier`;
- raw `score` and heuristic `confidence`;
- `conservativeEscalation`;
- named `signals` with weights and human-readable `reasons`;
- context usage without context contents;
- an `execution` recommendation marked `status: "unapplied"`.

No prompt text, substring, hash, or excerpt is returned.
