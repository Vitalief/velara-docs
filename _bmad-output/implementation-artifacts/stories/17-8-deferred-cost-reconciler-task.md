---
governing_ads: [AD-4, AD-8, AD-9]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: [17-4, 17-6, 17-7]
status_note: STUB created by correct-course 2026-07-29. Run bmad-create-story to fill full context before dev.
---

# Story 17.8: Deferred Cost Reconciler Task

Status: backlog

## Story

As the platform,
I want an async task to replace each provisional estimate with LangSmith's authoritative cost,
so that the DB's `cost_usd` converges to the true, per-model figure shortly after a run completes.

## Acceptance Criteria

1. A reconciler (Celery task) reads LangSmith cost for the invocation's trace via `list_runs(trace_id=<langsmith_run_id>, run_type="llm", select=["total_cost"])` and **sums `total_cost` across all llm runs** in the trace (N calls, M models). (AD-4)
2. **Candidate-gated** (AD-9): touches only LEAF, LLM-runtime rows with a non-NULL `langsmith_run_id` and `cost_is_estimated=true`. `fan_out=true` parents and `code` runs are **never** reconciled (stay `cost_usd=0`, `false`) — preserving the analytics leaf-sum-with-parent=0 invariant.
3. **Compare-and-set** (AD-8): `UPDATE … SET cost_usd=<sum>, cost_is_estimated=false WHERE id=… AND cost_is_estimated=true` — a redelivered run is a no-op; never regresses a `false` row to estimate/NULL.
4. **Completeness gate** (AD-8): reconciles only when LangSmith reports the trace's cost complete (all child llm runs present, each `total_cost` non-NULL) — never on a first partial read. Bounded retry while not-yet-computed.
5. **Enqueue-after-commit** (AD-8): the reconciler is enqueued only after the estimate row commits (from the completion transaction / outbox), never on a bare timer that could beat the write. `[ASSUMPTION]` self-scheduled ~60s vs periodic sweep of `is_estimated=true` — confirm at dev.
6. Verified: a real multi-model extractor run's `cost_usd` transitions estimate → reconciled and matches LangSmith's dashboard total.

## Dev Notes
- Governing: **AD-4, AD-8, AD-9**. Depends on 17-4 (columns), 17-6 (trace_id linkage), 17-7 (estimate write). Closes reviewer Holes 3, 4, 5, 6.
