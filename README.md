# Effort Autopilot

**Automatic reasoning-effort selection for the Claude Code CLI.** You keep using `claude` exactly as always; before each task reaches the model, Effort Autopilot classifies it **locally** (zero tokens, zero network) and sets the right `/effort` level — low for trivial asks, xhigh for deep work — without ever changing your model, provider, login, or session.

> Status: **beta** ([`v0.3.0-beta.1`](https://github.com/JeronimoRepetto/effort-autopilot/releases)) — working end to end on Windows, live-validated, not yet published to npm. Install today from a repository checkout with the reversible installer — see [Installation](docs/INSTALL.md).

## How it works today

Claude Code's hooks cannot change the pending turn's effort, and its TUI exposes no safe byte-level control point. Effort Autopilot combines both worlds — a hook for *semantics*, a pseudoterminal for *actuation*:

```
you type a task in the normal claude TUI
  1. a UserPromptSubmit hook identifies it as a real top-level task and blocks it (pre-inference)
  2. the broker (this tool, owning the terminal via ConPTY) receives it over authenticated local IPC
  3. a deterministic local classifier scores it → effort tier + confidence   (0 tokens, ~ms)
  4. the broker types /effort <tier> into your session and waits for the CLI's real acknowledgement
  5. it re-injects your exact original prompt, authorized for exactly one replay
  6. the hook lets that single replay through → Claude answers normally, at the right effort
```

Everything visible is disclosed in-terminal (which effort was applied and why, or why nothing changed), localized in English or Spanish based on your prompt's language.

### The contract

- Classification never calls a model or the network and never stores your prompt.
- Your exact model and provider are never changed; the prompt is forwarded byte-for-byte, exactly once.
- **Fail-open on every error**: unknown model, classifier timeout, missing acknowledgement, ambiguous state → your prompt goes through unchanged, with a visible reason code. Low confidence also fails open under `manual-wins`; under `autopilot-wins` it instead floors the session at `high` (see below).
- **You stay in charge**: under the default `manual-wins` policy your own `/effort` choice disables automation (`/effort auto` hands it back); the opt-in `autopilot-wins` policy re-evaluates every prompt instead, and when classification is uncertain it raises the session to at least `high` — unless your manual `/effort` choice is still standing (then it is respected) or the level already suffices. Policy is chosen at install, per project (`.effort-autopilot.json`), or per launch (`--autopilot`).
- Reversible by design: the installer shims `claude` on your user PATH with explicit consent and exact backups; `effort-autopilot uninstall` restores everything. Your real Claude binary is never touched.

### What works right now

- Full interactive broker on Windows (ConPTY), validated live: automatic escalation (including the CLI's mid-conversation confirmation dialog, auto-confirmed), fail-open branches, manual-precedence, per-project opt-out.
- Reversible global installer (`install` / `uninstall` / `status` / `policy` / `ml-setup`), Linux implemented (WSL-verified), macOS implemented but unverified.
- The complete mini-AI stack: local multilingual embeddings (optional dependency), trained-artifact loader with a deterministic fallback chain, a dependency-free ordinal trainer (`npm run ml:train`), and the calibration pipeline (`npm run calibrate`).
- 174 local non-billable tests; a zero-inference diagnostic proves the whole pipeline against the installed CLI without a single model call.

### Honest limitations

- Claude Code renders a visible `UserPromptSubmit operation blocked by hook` notice on each intercepted task — the hook API has no quiet block. A [native capability proposal](docs/UPSTREAM_CAPABILITY_PROPOSAL.md) (unsubmitted draft) would remove the artifact entirely.
- On Claude Code 2.1.238, every `/effort` change except `max` also becomes your saved default (upstream behavior, disclosed on each application). With the autopilot active this is inconsequential; details in [INSTALL.md](docs/INSTALL.md).
- The current classifier's linguistic patterns cover English and Spanish; other languages classify with low confidence rather than guessing — unchanged effort under `manual-wins`, floored at `high` under `autopilot-wins`.
- Effort is a behavioral signal, not a token cap — no per-prompt savings guarantee is claimed until measured by calibration.

## Roadmap

| Phase | What | Status |
| --- | --- | --- |
| 1 | Hybrid hook + ConPTY broker, live validation | ✅ done |
| 2 | Reversible global installer, per-project config, precedence policies | ✅ done |
| 3 | npm packaging preparation (`@jeronimorepetto/claude-effort-autopilot`) | ✅ prepared, unpublished |
| 4 | **Multilingual mini-AI**: a frozen, pretrained multilingual embedding model (~100 MB, ONNX, local CPU, ~100 languages) + a tiny ordinal head trained on real calibration data — replacing today's hand-written weights while keeping the zero-token/zero-network contract | ✅ infrastructure built (runtime, trainer, fallback chain, `install --with-ml`); awaits calibration data |
| 5 | Calibration pipeline: adaptive minimum-sufficient-effort search over benchmark tasks, resumable checkpoints, dataset export, baseline comparison | ✅ built (`npm run calibrate`, mock-verified); the live run is a separately authorized, budgeted decision ([CALIBRATION.md](docs/CALIBRATION.md)) |
| 6 | npm publication ([release checklist](docs/RELEASE_CHECKLIST.md)), macOS verification | gated on explicit authorization |

**The end state**: install once from npm, run `claude` anywhere in any language, and every prompt silently gets the smallest effort that reliably does the job — measured, not guessed — with your manual choice always one `/effort` away.

### How the mini-AI works (and why this design)

Two models in cascade, neither trained from scratch: a **frozen, pretrained multilingual encoder** (`multilingual-e5-small` — chosen as the intersection of local-CPU ONNX execution, ~100-language coverage, best quality-per-MB in its size class, and a permissive license) turns the prompt into a meaning vector; a **tiny trained ordinal head** (proportional-odds regression: one weight vector + four cutpoints, a few KB, fully inspectable) turns that meaning into an effort tier with calibrated confidence. The encoder cannot decide by itself — it has no concept of "effort"; that mapping is a measured property of Claude's effort ladder, learned only from calibration runs. Training data comes from executing benchmark tasks at every effort level and labeling the minimum that reliably passes — never from intuition or another LLM. Full rationale, data sources, and evaluation criteria: [docs/CALIBRATION.md](docs/CALIBRATION.md). Any failure anywhere falls back to the deterministic classifier and then to the broker's fail-open.

## Try it

```powershell
git clone https://github.com/JeronimoRepetto/effort-autopilot.git
cd effort-autopilot
npm install
npm test                                   # 174 local tests, no Claude calls
node bin/effort-autopilot-cli.js install   # consent-gated, reversible
# open a NEW terminal, cd into any project, and run: claude
```

Full guide: [docs/INSTALL.md](docs/INSTALL.md) · Documentation index: [docs/README.md](docs/README.md)

## Project history note

The old one-shot launcher has been rejected as a product and removed from the package surface; its `--print` transport survives only as internal benchmark/calibration infrastructure. The full engineering trail — including the CLI feasibility audit with every live-verified behavior — is in [docs/STOCK_HOST_FEASIBILITY.md](docs/STOCK_HOST_FEASIBILITY.md).

## Support

If this tool saves you time or tokens, you can support its development — it genuinely helps keep the open-source work going:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20this%20project-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/jeronimorepetto)

## License

MIT. See [LICENSE](LICENSE).
