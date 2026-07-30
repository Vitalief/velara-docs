---
governing_ads: [AD-1, AD-3, AD-6]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: [17-4]
status_note: STUB created by correct-course 2026-07-29. Run bmad-create-story to fill full context before dev.
---

# Story 17.7: Estimate Write on the Hot Path; Slim `pricing.py`

Status: backlog

## Story

As a Vitalief operator,
I want a cost to appear on the Run Console the instant a run completes,
so that I never see a blank/"pending" cost — while LangSmith remains the source that later corrects it.

## Acceptance Criteria

1. `app/core/pricing.py` is **retained but demoted**: `compute_cost_usd` produces a **provisional estimate** only, understood to be approximate and always reconcilable. Not deleted, not the source of truth. (AD-1)
2. At completion the worker persists `input_tokens`, `output_tokens`, `model`, `langsmith_run_id`, and a provisional `cost_usd` from the estimate with `cost_is_estimated=true`. Never blocks on / reads LangSmith inline. Unknown model → `cost_usd=NULL`. (AD-3)
3. The estimate write is a **guarded upsert**: sets `cost_is_estimated=true` only when the row is absent or already estimated — **never** overwrites a reconciled (`false`) row. (AD-8 symmetric guard, writer side)
4. Tracing-off (AD-6): tokens + estimate still written; no `langsmith_run_id`; job succeeds offline.
5. Genuine `code`/fan-out-parent rows unchanged: `cost_usd=0, cost_is_estimated=false`, never estimated. (AD-1, AD-9)
6. Gates green; `SUM(cost_usd)` analytics still returns numbers (now estimates until reconciled).

## Dev Notes
- Governing: **AD-1, AD-3, AD-6** (+ the writer half of AD-8). Depends on 17-4 (columns).
