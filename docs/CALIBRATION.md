# Calibration roadmap

## Implemented pipeline

The adaptive search below is implemented in [`src/evaluation/calibration.js`](../src/evaluation/calibration.js) with the CLI [`scripts/calibrate.mjs`](../scripts/calibrate.mjs) (`npm run calibrate`). It forces executions at explicit effort levels (classifier bypassed), walks down from the task's starting hint after reliable success and up after failure, repeats runs at the boundary (`--repeats`/`--required-passes`), checkpoints every trial atomically, and resumes without repeating completed tasks. Budget ceilings (`--max-total-output-tokens`, `--max-total-cost-usd`, `--max-trials-per-task`) and subscription-limit stops are first-class and honest (`stopReason`, per-task statuses, baseline coverage gaps reported instead of extrapolated). `--export-dataset` writes `{taskId, split, label, prompt}` JSONL with a deterministic 70/15/15 hash split for `npm run ml:train` — only to ignored local paths; the dataset is never committed or published.

Mock mode (`npm run calibrate`) is free and local. **Live mode requires both `--live` and `--confirm-subscription-use`** and has not been executed; running it is a separately authorized decision with an agreed budget.

## Objective

Predict the minimum sufficient effort for a task on a specific active model family/version while minimizing expected token cost and latency subject to a quality threshold.

The present deterministic weights are hand-authored bootstrap priors. They are neither learned nor empirically calibrated. Their purpose is to provide an inspectable baseline, a stable feature vocabulary, and concrete failure cases while outcome data is collected.

## Unit of calibration

Calibrations are versioned by at least:

- model family and model version
- supported effort ladder and organization/account caps
- classifier feature schema version
- dataset version
- quality metric and threshold version
- confidence-calibration version

A task can map differently on Fable, Sonnet, Opus, or later models because effort scales are model-relative. Do not reuse offsets or thresholds across model versions without evaluation.

## Ground-truth labels

For each task and active model:

1. Run the task at supported effort levels.
2. Evaluate with executable tests where possible.
3. Use reviewed acceptance criteria when tests cannot capture quality.
4. Estimate reliability with repeated runs, concentrating repetitions near pass/fail boundaries.
5. Assign the lowest effort that reliably meets the quality threshold.

Human intuition, a synthetic generator, or a stronger LLM must not directly supply the ground-truth effort label. Synthetic generation may create paraphrases and translations, but the variants receive labels only through objective tests or reviewed acceptance criteria.

## Data acquisition

Use several modest, complementary sources rather than assuming a huge corpus:

- public coding benchmarks with executable test harnesses
- suitably licensed open-source issue and task descriptions with reproducible repositories and acceptance tests
- curated boundary tasks that target adjacent tiers, uncertainty, underspecification, and long-horizon orchestration
- a multilingual suite beginning with English and Spanish, including meaning-preserving translations reviewed by speakers
- strictly opt-in, privacy-preserving outcome telemetry

Opt-in telemetry should prefer derived features and outcome summaries over raw prompts. Any prompt collection requires separate explicit consent, retention limits, redaction, access controls, and deletion support. The default product behavior remains no logging and no persistence.

No specific dataset size guarantees calibration quality. Measure coverage, label reliability, subgroup performance, boundary error, drift, and held-out cost/quality outcomes.

## Cost-efficient labeling

- Use adaptive effort search instead of running every effort for every task. Start near the bootstrap prediction, move down after reliable success, and move up after failure.
- Repeat runs primarily near the estimated boundary, where stochastic outcomes can change the minimum reliable tier.
- Use active learning to prioritize cases with low confidence, policy/model disagreement, multilingual gaps, and large expected cost impact.
- Preserve a fixed held-out suite and never use it to tune thresholds.

## Interpretable model

The learned classifier is two models in cascade, and neither is trained from scratch:

1. **A frozen, pretrained multilingual embedding model** ("the AI that understands the prompt"): an existing open model (default `Xenova/multilingual-e5-small`, ~100 MB quantized ONNX, ~100 languages) executed locally on CPU via the optional `@huggingface/transformers` dependency. Downloaded once at install; never fine-tuned; no network at classification time (`localFilesOnly`). This is what makes the classifier language-independent without collecting multilingual feature patterns by hand.
2. **A trained ordinal head** ("the AI that returns the effort"): proportional-odds ordinal logistic regression over the embedding — one weight vector plus four strictly increasing cutpoints, a few KB, fully inspectable. Implemented in `src/core/ordinal-head.js`, trained by the dependency-free `src/core/ordinal-training.js` (`npm run ml:train`). Freezing the encoder and training only the head ("linear probing") is the standard transfer-learning choice for the hundreds-to-thousands of labels calibration will produce; full fine-tuning stays a future optimization that would not change this contract.

### Why this embedding model

`Xenova/multilingual-e5-small` is the default because it is the intersection of four hard constraints, each of which eliminates alternatives:

1. **Runs locally in Node on any CPU** — requires ONNX weights compatible with transformers.js (the `Xenova/` namespace is exactly that); ~110 MB quantized, tens of milliseconds per short prompt, comfortably inside the 1500 ms classification budget.
2. **Genuinely multilingual** — the multilingual e5 family is contrastively trained across ~100 languages, which is what removes the hand-written per-language pattern approach.
3. **Best quality-per-MB in its class** — stronger multilingual models exist (`e5-base/large`, `bge-m3`, `LaBSE`) but cost 2–20× the size and latency; equally small models are weaker (`paraphrase-multilingual-MiniLM`) or English-only (`all-MiniLM-L6`).
4. **Permissive license** (MIT; re-verify at release).

The choice is deliberately swappable: the trained artifact records its `embeddingModel`, so upgrading the encoder means re-training the head (seconds), nothing else.

### Why a trained head is unavoidable

The encoder cannot decide: its only output is a meaning vector — it has no notion of "effort" and no channel to answer with a tier. Some second stage must map meaning to one of the five ordered labels, and the candidates are: a generative LLM (rejected — tokens, network, latency), zero-shot anchor-phrase similarity (still a second stage, just an uncalibrated one with hand-guessed boundaries — the manual-weights problem in embedding form), or this trained head. "How much effort Claude needs" is not knowledge any pretrained model contains; it is a measured property of Claude's effort ladder and our quality threshold, and the head is the smallest container for it.

Candidate additional inputs for the head remain: transparent prompt features from the deterministic policy, cheap local project/environment metadata, and a versioned active-model capability profile. Fit per-model parameters or a hierarchical model only after the data supports that complexity. Calibrate confidence on held-out data using a method appropriate to ordinal predictions. Report reliability diagrams and per-boundary error, not only aggregate accuracy.

The runtime chain is already integrated behind the same envelope contract (`src/core/learned-classifier.js`): learned classifier → deterministic classifier on any failure or missing artifact → the broker's confidence gate (fail-open under `manual-wins`; the `high` uncertainty floor under `autopilot-wins`). It activates only when config sets `"ml": true` AND the model cache and a valid trained artifact exist; until calibration ships an artifact, the deterministic classifier runs.

## Optimization and release criteria

Optimize the cost/quality tradeoff rather than raw classification accuracy. A candidate calibration should be evaluated on:

- probability of meeting the quality threshold
- false-low rate and severity
- expected token cost and latency
- cost-weighted regret versus the lowest reliably passing effort
- calibration error overall and by language/task family
- robustness under model-version and project-distribution drift

Ship a calibration only with a versioned evaluation report and a safe rollback to the deterministic baseline. Missing, stale, or incompatible profiles must fail open to the host's existing/default behavior.
