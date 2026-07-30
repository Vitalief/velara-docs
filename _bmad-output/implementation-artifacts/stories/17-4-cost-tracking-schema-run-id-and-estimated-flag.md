---
governing_ads: [AD-5]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: []
status_note: STUB created by correct-course 2026-07-29. Run bmad-create-story to fill full context before dev.
---

# Story 17.4: Cost-Tracking Schema — `langsmith_run_id` + `cost_is_estimated`

Status: backlog

## Story

As the platform,
I want `invocation_results` to carry a LangSmith trace linkage and an estimated/authoritative flag,
so that cost can be written provisionally at completion and later reconciled to LangSmith's truth
without ambiguity about which state a row is in.

## Acceptance Criteria

1. Alembic migration adds `langsmith_run_id: str | None` (holds the invocation's LangSmith **trace id**, per AD-7) and `cost_is_estimated: bool` to `invocation_results`; `InvocationResult` model updated.
2. Cost-state semantics (AD-5) documented on the model: `cost_is_estimated=true` → provisional; `false` + non-NULL `cost_usd` → authoritative; `cost_usd IS NULL` → unpriceable (never $0 for an LLM runtime). Genuine `code`/fan-out-parent rows: `cost_usd=0, cost_is_estimated=false`.
3. Default for `cost_is_estimated` chosen so existing/historical rows read as **reconciled/authoritative** (`false`) — no backfill, existing values stand.
4. `docs/api-spec.json` regenerated if any schema exposing these fields changes; migration is forward-only and reversible.

## Dev Notes
- Governing: **AD-5** (cost states). Enables 17-7 (estimate write) and 17-8 (reconciler).
- No behavior change in this story — schema + model only.
