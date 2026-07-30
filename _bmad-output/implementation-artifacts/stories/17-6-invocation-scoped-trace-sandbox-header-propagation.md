---
governing_ads: [AD-7]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: [17-5]
status_note: STUB created by correct-course 2026-07-29. Run bmad-create-story to fill full context before dev.
---

# Story 17.6: One Invocation-Scoped Trace + Sandbox Header Propagation

Status: backlog

## Story

As the platform,
I want all of an invocation's LLM calls — platform tool-turns AND in-sandbox skill calls — to nest
under a single LangSmith trace,
so that the reconciler can sum `total_cost` across every call the invocation made, across models
and across the process boundary.

## Acceptance Criteria

1. The worker opens **exactly one** LangSmith trace per leaf invocation **before** the first LLM call; every span nests under it (emitter no longer mints independent root runs). (AD-7)
2. Cross-process: the worker passes `parent.to_headers()` into the sandbox subprocess via `injected_env`; the shim rebuilds context with `RunTree.from_headers()` + `tracing_context()` so in-sandbox `wrap_anthropic` calls share the same `trace_id`. (Verified bridge — see spine memlog.)
3. The invocation's **`trace_id`** is captured (via `get_current_run_tree()` inside the traced context) and persisted to `langsmith_run_id` (from 17-4). Not a per-span run id.
4. Tracing-off (AD-6): `get_current_run_tree()` is None → no trace opened, `langsmith_run_id` stays NULL, job still runs.
5. Verified end-to-end: a real code-driven-hybrid run (sonnet locator + opus extraction) produces ONE trace with BOTH calls under it; `list_runs(trace_id, run_type="llm")` returns both.

## Dev Notes
- Governing: **AD-7**. Depends on 17-5 (the wrap seam must exist first). Closes reviewer Holes 1 & 2 (single-call undercount + unlinked sandbox trace).
