# Calibration roadmap

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

Ordinal logistic regression is a suitable first learned baseline because tiers are ordered and coefficients remain inspectable. Candidate inputs include:

- transparent prompt features from the deterministic policy
- cheap local project/environment metadata
- a versioned active-model capability profile

Fit per-model parameters or a hierarchical model with explicit model/version features only after the data supports that complexity. Calibrate confidence on held-out data using a method appropriate to ordinal predictions. Report reliability diagrams and per-boundary error, not only aggregate accuracy.

## Optimization and release criteria

Optimize the cost/quality tradeoff rather than raw classification accuracy. A candidate calibration should be evaluated on:

- probability of meeting the quality threshold
- false-low rate and severity
- expected token cost and latency
- cost-weighted regret versus the lowest reliably passing effort
- calibration error overall and by language/task family
- robustness under model-version and project-distribution drift

Ship a calibration only with a versioned evaluation report and a safe rollback to the deterministic baseline. Missing, stale, or incompatible profiles must fail open to the host's existing/default behavior.
