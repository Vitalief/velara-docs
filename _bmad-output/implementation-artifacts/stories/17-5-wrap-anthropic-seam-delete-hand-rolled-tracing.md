---
governing_ads: [AD-2]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: []
fixes: "Live wrong-cost bug — hand-rolled stream/multi-model capture recorded only 1 of N calls (32013/110)."
status_note: STUB created by correct-course 2026-07-29. Run bmad-create-story to fill full context before dev.
---

# Story 17.5: `wrap_anthropic` Seam — Delete Hand-Rolled Tracing

Status: backlog

## Story

As the platform,
I want every Anthropic client to be traced by `langsmith.wrappers.wrap_anthropic` instead of our own
wrappers,
so that per-call, per-model, and streaming usage/cost are captured by LangSmith's tested code — not
by bespoke logic that has repeatedly miscounted.

## Acceptance Criteria

1. All Anthropic clients (platform `anthropic_client.py` factories `get_llm_provider` **and** `get_adapter_llm_provider`, and the sandbox path) are obtained via `wrap_anthropic(anthropic.Anthropic(...))`. (AD-2)
2. **Deleted:** `app/core/tracing.py`'s `_emit_span`, `LLMSpan`, `trace_llm_call`'s custom RunTree construction, `record_code_driven_span`; the sandbox `velara_trace.py` custom `_TracedClient`/`_TracedStream`/`_TracedMessages`/`_StreamProxy`/`_emit_span`. No bespoke `RunTree` remains.
3. Sandbox shim `velara_trace.py` collapses to: monkeypatch `anthropic.Anthropic` → `wrap_anthropic(real())` (so a skill's own internally-built client is traced with zero cooperation) + a local token accumulator for the estimate/DB write. (AD-2)
4. `wrap_anthropic` verified to cover `.create` / `.stream` / `beta.create` (the extractor streams) — no story-authored stream-usage capture.
5. Gates: `ruff` clean; full `pytest` green in CI-equivalent env; existing tracing tests updated to the wrapper (delete tests asserting the removed internals).

## Dev Notes
- Governing: **AD-2**. **Dependency-free — implement FIRST; this fixes the current live wrong-cost bug.**
- Cost VALUE still comes from the old path until 17-7/17-8 land; this story is about the tracing seam. Coordinate so cost isn't left worse in the interim (may land with 17-7).
