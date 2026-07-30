# Sprint Change Proposal — LLM Cost-Tracking Re-Architecture (Epic 17)

**Date:** 2026-07-29
**Author:** Developer (via bmad-correct-course)
**Scope classification:** **Major** — supersedes the cost/tracing design shipped in Stories 17.1/17.2; adds a DB migration, a new async worker task, and rewrites the tracing seam.
**Driving artifact:** [ARCHITECTURE-SPINE.md](architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md) (`status: final`, lint-clean, adversarially reviewed, SDK claims verified live)

## Section 1 — Issue Summary

During live testing of Story 17.2 (AI-adapter-emitted LangSmith traces + code-driven-hybrid cost), a sequence of cost-reporting failures surfaced that the story's design could not cleanly resolve:

1. **Cost `--` (NULL) after re-adapting a skill** — the AI adapter non-deterministically regenerated a usage-lift that read a nonexistent metadata shape; cost silently priced NULL.
2. **Cost wrong (undercounted)** — the hand-rolled sandbox tracing captured only ONE of an invocation's N LLM calls (the cheap sonnet locator, `32013/110`), missing the streaming opus extraction — because the skill calls `stream.get_final_message()` itself and the bespoke stream wrapper's second call failed.
3. **Multi-model mispricing** — the single-model envelope aggregate can't express a run that uses sonnet + opus.

Root cause: the platform was **reinventing (with bugs) what LangSmith already does natively** — per-call, per-model, streaming-aware cost — while the adapter was asked to re-derive each skill's private usage shape (inherently unreliable).

## Section 2 — Impact Analysis

- **Epic Impact:** Epic 17 stays `in-progress`; 6 new stories (17-4..17-9) added. 17.1/17.2's worker-side/hand-rolled tracing is **superseded** (not reverted — its DB column, settings, and `wrap_anthropic` dependency are reused).
- **Story Impact:** 17.1/17.2 remain `done` historically; their tracing implementation is replaced by 17-5..17-8. 17.3 (certification evidence) may read `cost_usd` — must tolerate the estimate→reconciled window (flagged in 17-9).
- **Artifact Conflicts:** `app/core/pricing.py` (demoted, not deleted), `app/core/tracing.py` (hand-rolled emitter removed), `app/services/sandbox_assets/velara_trace.py` (collapses to monkeypatch + token accumulator), `app/workers/execution_tasks.py`, `app/models/invocation.py` (+2 columns, migration), `app/services/analytics_service.py` + jobs/client APIs (read new states).
- **Technical Impact:** one Alembic migration (`langsmith_run_id`, `cost_is_estimated`); one new reconciler Celery task; cross-process trace-header propagation into the sandbox.

## Section 3 — Recommended Approach

**Direct Adjustment** — add stories within Epic 17, dependency-ordered. Paradigm: **estimate-then-reconcile** (instant local estimate for UX; LangSmith `total_cost` reconciled in as the authoritative value; both persisted in Postgres so analytics/offline reads are unchanged). Full rationale + the 9 ADs and the 6 reviewer-found holes they close live in the spine + its `.memlog.md`.

## Section 4 — Detailed Change Proposals

Six new story files created under `_bmad-output/implementation-artifacts/stories/`, each citing its governing ADs, with dependency links:

| Story | Title | ADs | Deps |
| --- | --- | --- | --- |
| 17-4 | Cost-tracking schema: `langsmith_run_id` + `cost_is_estimated` | AD-5 | — |
| 17-5 | `wrap_anthropic` seam — delete hand-rolled tracing (**fixes the live cost bug**) | AD-2 | — |
| 17-6 | Invocation-scoped trace + sandbox header propagation | AD-7 | 17-5 |
| 17-7 | Estimate write on the hot path; slim `pricing.py` | AD-1, AD-3, AD-6 | 17-4 |
| 17-8 | Deferred cost reconciler task | AD-4, AD-8, AD-9 | 17-4, 17-6, 17-7 |
| 17-9 | Cost consumers read the new states | AD-5, AD-9 | 17-7, 17-8 |

Sprint-status and the Epic 17 file updated to list 17-4..17-9 as `backlog`.

## Section 5 — Implementation Handoff

- **Recommended first story:** **17-5** — dependency-free and it directly fixes the current wrong-cost bug by replacing all hand-rolled stream/multi-model capture with `wrap_anthropic`. Everything hand-rolled this session is deleted by it.
- **Recipient:** Developer agent (`bmad-create-story` to fill each stub with full context, then `bmad-dev-story`).
- **Success criteria:** a real re-adapt+run of the protocol extractor shows a correct, non-NULL, multi-model-accurate cost on the Run Console (estimate immediately, reconciled shortly after), and LangSmith's dashboard cost matches.
