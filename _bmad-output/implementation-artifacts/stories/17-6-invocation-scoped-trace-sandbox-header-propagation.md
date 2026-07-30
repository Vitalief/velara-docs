---
governing_ads: [AD-7]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: [17-5]
enables: [17-8]
baseline_commit: fa1e96b5f2ebe42856f0d3775b4bc5dafe31c89b
fixes: "Reviewer Holes 1 & 2 — single-call/multi-model undercount (only 1 of N calls captured) + the sandbox subprocess emitting a separate, unreconcilable trace."
status_note: >
  Filled from STUB by bmad-create-story 2026-07-30. Governing artifact is the ARCHITECTURE-SPINE
  (status: final), specifically AD-7. Every source citation verified against live source at baseline
  fa1e96b (post-17.5) via three parallel call-site sweeps + langsmith 0.10.10 SDK ground-truth
  (installed venv source inspection). Depends on 17-5's wrap seam (done) and 17-4's langsmith_run_id
  column (done). CRITICAL SDK correction folded in: to_headers() carries the full `dotted_order`
  string (not a bare trace_id), so the header bridge must round-trip the whole to_headers() dict.
---

# Story 17.6: One Invocation-Scoped Trace + Sandbox Header Propagation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the platform,
I want all of an invocation's LLM calls — platform tool-turns AND in-sandbox skill calls — to nest
under a single LangSmith trace, and the invocation's `trace_id` persisted,
so that the 17-8 reconciler can sum `total_cost` across every LLM call the invocation made — across
models and across the process boundary — from one queryable trace id.

## ⚠️ SCOPE — read this first

**Backend only (`velara-api`). This is a TRACING-TOPOLOGY story, not a cost-VALUE story.** You do two
things and nothing else:

1. **Open exactly ONE LangSmith trace per leaf invocation in the worker, _before_ the first LLM call**,
   so every platform LLM call nests under it (AD-7). Capture that trace's `trace_id` and **persist it
   to `InvocationResult.langsmith_run_id`** (the column 17-4 added).
2. **Propagate that trace across the subprocess boundary** into the code-driven-hybrid sandbox
   (`to_headers()` → `injected_env` → `from_headers()` + `tracing_context()`), so in-sandbox
   `wrap_anthropic` calls nest under the **same** `trace_id`.

**This story does NOT (do these later — do not reach into them):**
- **Estimate write / `cost_usd` / `cost_is_estimated` / slim `pricing.py` → Story 17-7.** You do **not**
  change what `cost_usd` is written, do **not** set `cost_is_estimated`, and do **not** touch
  `pricing.py` or `_extract_cost_fields`'s cost logic. `langsmith_run_id` is NOT a cost field — persist
  it via a **separate** kwarg, not through `_extract_cost_fields`. If you find yourself editing
  `compute_cost_usd`, `cost_is_estimated`, or the estimate rate table — **STOP, that is 17-7.**
- **The reconciler task → Story 17-8.** You do **not** call `Client.list_runs(...)`, do **not** read
  `total_cost`, and do **not** add a Celery reconciler. You only *persist the `trace_id`* that 17-8
  will later query. If you find yourself reading LangSmith cost — **STOP, that is 17-8.**
- **The `wrap_anthropic` seam itself → done in 17-5.** The wrapped clients and the sandbox shim's
  `_wrap_if_available` already exist. Do **not** re-wrap, re-tag `run_kind`, or touch the explicit
  `Client(hide_inputs/outputs)` redaction. You *build on* the seam; you don't rebuild it.
- **Fan-out parents / genuine `code` runs.** Per AD-9 they are `$0`-terminal, never assigned a trace,
  never reconciled. **Do not open a trace for a fan-out parent roll-up** (execution_tasks.py:689-698)
  or a non-LLM `code` run — only leaf LLM-using invocations get a trace.

**Governing invariant: AD-7** (`ARCHITECTURE-SPINE.md:92-96`). The worker opens **exactly one** trace
per leaf invocation before the first LLM call; every span — all platform tool-turns AND all in-sandbox
skill calls — nests under it. The emitter must **stop minting independent root runs**. The persisted
linkage is the **`trace_id`** (the `langsmith_run_id` column holds it), never a per-span run id.

## Acceptance Criteria

1. **AC1 — The worker opens exactly ONE LangSmith trace per leaf invocation, before the first LLM call,
   and every platform LLM call nests under it.** In `app/workers/execution_tasks.py`'s `run_skill` →
   `_execute()` (`:256`), a single root trace is opened *before* the `execution_service.execute_skill(...)`
   call at `:346` (the one funnel through which every platform prompt/hybrid LLM call flows in-process).
   Use `langsmith.run_helpers.trace("velara.invocation", run_type="chain")` as a context manager wrapping
   the `execute_skill` call. Because a `wrap_anthropic`-wrapped client auto-nests under
   `get_current_run_tree()` (verified: `run_helpers.py:1534,1556` — the wrapper passes no explicit parent
   and resolves it from the context var), every platform LLM call made inside `execute_skill` becomes a
   child `run_type="llm"` span of this one trace. **N platform calls across M models → N distinct llm
   runs under ONE trace** (the structural fix for the single-call undercount). This is the ONLY trace
   opened per invocation — no other `trace()`/root-`RunTree` is minted anywhere in the platform path.

2. **AC2 — Cross-process: the worker passes the parent trace's headers into the sandbox subprocess, and
   the shim rebuilds context so in-sandbox `wrap_anthropic` calls share the same `trace_id`.** In
   `app/services/code_driven_executor.py`, at the `LANGSMITH_*` env-injection block (`:511-515`), when
   tracing is enabled AND a current run tree exists, serialize `get_current_run_tree().to_headers()`
   (a `dict[str,str]` with keys `langsmith-trace` and `baggage`) as **JSON** into a new injected env var
   (e.g. `LANGSMITH_PARENT_HEADERS`). In the sandbox shim (`velara_trace.py`), inside `_wrap_if_available`
   (`:221-251`, behind the existing langsmith-present guard), read that env var, JSON-decode it,
   reconstruct the parent via `RunTree.from_headers(headers)`, and wrap the `wrap_anthropic` call in
   `tracing_context(parent=<that RunTree>)` so in-sandbox calls nest under the worker's trace.
   **CRITICAL (verified SDK fact):** `to_headers()` carries the full **`dotted_order`** string, not a
   bare `trace_id` (`run_trees.py:1073`) — so you MUST round-trip the whole `to_headers()` dict, not
   just a UUID. `from_headers` returns `None` if the trace header is absent → the shim then simply skips
   `tracing_context` and traces as its own root (no crash). (See spine memlog line 26 + `ARCHITECTURE-SPINE.md:96` — this exact `to_headers()→from_headers()+tracing_context()` bridge is the verified cross-process mechanism.)

3. **AC3 — The invocation's `trace_id` is captured and persisted to `langsmith_run_id` (17-4's column).
   It is a TRACE id, not a per-span run id, and it is NOT routed through the cost path.** Inside the
   `with trace(...)` block, capture the id via `cur = get_current_run_tree()` → persist `cur.trace_id`
   when `cur is not None`, else `None` (for a root trace `cur.id == cur.trace_id` — verified
   `run_trees.py:378-382`; `get_current_run_tree()` is the tracing-on/off discriminator, NOT `rt.trace_id`
   from the `with` target, which is non-None even when tracing is off — see Task 1). The captured id is
   the semantic trace identifier the 17-8 reconciler filters on. Thread it to the completion write: add a
   `langsmith_run_id: str | None = None`
   kwarg to `job_service.mark_completed` **and** `mark_blocked` (mirroring `output_sha256`'s additive,
   back-compatible contract at `job_service.py:525-568,571-604`), mapping it onto
   `InvocationResult(langsmith_run_id=...)`. `run_skill` passes the captured trace id to both write sites
   (`execution_tasks.py:399-406` completion, `:374-381` blocked). **Do NOT** derive `langsmith_run_id`
   from `_extract_cost_fields` — it is orthogonal to cost. **Do NOT** set `cost_is_estimated` (17-7).

4. **AC4 — Tracing-off (AD-6): no trace opened, `langsmith_run_id` stays NULL, job still runs.** When
   tracing is disabled/unconfigured (`LANGSMITH_TRACING` off or no `LANGSMITH_API_KEY`),
   `get_current_run_tree()` is `None` (verified: `_context.py:27-29` default None). The worker must NOT
   open a trace in that case (or open one that no-ops with no client): `langsmith_run_id` is written as
   `None`, and the invocation completes exactly as today. The sandbox side likewise: with no
   `LANGSMITH_PARENT_HEADERS` injected (because none was serialized), `from_headers` returns None and the
   shim traces as its own root / not at all — usage still accumulates via `totals()` (17-5's path,
   unchanged). Job execution succeeds regardless of LangSmith availability. **The test env runs
   `LANGSMITH_TRACING=false` — this path must not break** (spine memlog line 12).

5. **AC5 — Fan-out parents and genuine `code` runs get NO trace (AD-9).** The fan-out parent roll-up
   write (`execution_tasks.py:689-698`, `aggregate_results`) and any non-LLM `code` run must NOT open a
   trace and must persist `langsmith_run_id = NULL`. The trace is opened only around the leaf
   `execute_skill` call in `_execute` (AC1). Verify the parent path (which uses
   `_extract_cost_fields(result_metadata)` and stays `cost_usd=0`) is untouched by this story and never
   reaches the trace-open branch.

6. **AC6 — Verified end-to-end: a real code-driven-hybrid run produces ONE trace with BOTH the platform
   and in-sandbox calls under it.** With `LANGSMITH_TRACING=true` and a valid key, run a code-driven
   hybrid whose bundle makes an in-sandbox LLM call (e.g. a sonnet locator + opus extraction). Confirm in
   LangSmith (or via `Client.list_runs(trace_id=<persisted langsmith_run_id>, run_type="llm")`) that
   BOTH calls appear as `run_type="llm"` runs under the ONE persisted `trace_id`, and that
   `InvocationResult.langsmith_run_id` equals that trace id. (This is a manual/dev verification step —
   the unit/integration suite asserts the mechanism, per Testing below; do not require a live LangSmith
   key in CI.)

7. **AC7 — Gates: `ruff` clean; full `pytest` green in the CI-equivalent env; no OpenAPI diff.**
   `ruff check .` clean repo-wide; the affected unit + integration suites pass (see Testing); `python
   scripts/export_openapi.py` → **zero** `docs/api-spec.json` diff (this story adds no HTTP schema —
   `langsmith_run_id` is an internal column, its API exposure is Story 17-9, whose AC requires the
   spec diff there, not here).

## Tasks / Subtasks

- [x] **Task 1 — Open one invocation-scoped trace in the worker** (AC: 1, 3, 4, 5)
  - [x] In `execution_tasks.py` `_execute()` (`:256`), import `trace` and `get_current_run_tree` from
        `langsmith.run_helpers` (lazy/local import at the top of `_execute`, mirroring the existing lazy
        import style — do not add an eager module-level langsmith import that a tracing-off process pays
        for). Wrap the `await execution_service.execute_skill(...)` call (`:346-354`) in
        `with trace("velara.invocation", run_type="chain") as rt:` so every platform LLM call inside
        `execute_skill` nests under it. Keep the surrounding `async with session_scope()` (`:334`) and
        the `try/except/finally` (finally at `:509`) intact — the trace context lives *inside* that try,
        around the execute call, and must be exited before/at the completion write path.
  - [x] Capture the trace id via **one rule only (verified correct — do NOT read `rt.trace_id` from the
        `with` target)**: inside the `with trace(...)` block, read `cur = get_current_run_tree()`; set
        `langsmith_run_id = cur.trace_id if cur is not None else None`, held in a local (default `None`)
        available to the completion/blocked writes at `:362-406`. **Why not `rt.trace_id`:** when tracing
        is OFF, `trace(...)` STILL builds and returns a real `RunTree` with a non-None `.trace_id` but
        does NOT set the current-run ContextVar (verified: `run_helpers.py` `trace._setup` `:1132`,
        `:1148-1158` skipped when disabled). So `rt.trace_id` would persist a **bogus** trace id in the
        tracing-off env — violating AC4/AD-6. `get_current_run_tree()` correctly returns `None` when off
        (`_context.py:27-29` default None) and the live root run when on — the single robust
        discriminator, no separate settings check needed.
  - [x] Do **not** open a trace on the fan-out parent path (`aggregate_results`, `:689-698`) — leave it
        exactly as-is; it stays `cost_usd=0`, `langsmith_run_id=NULL` (AC5).
- [x] **Task 2 — Persist `trace_id` to `langsmith_run_id` via the completion write** (AC: 3, 5)
  - [x] Add `langsmith_run_id: str | None = None` kwarg to `job_service.mark_completed` (`:525-536`) and
        `mark_blocked` (`:571-582`), and map it onto `InvocationResult(langsmith_run_id=...)` at both row
        constructions (`:550-559`, `:595-604`). Document it in both docstrings as the LangSmith **trace**
        id (17-6), same additive/back-compatible contract as `output_sha256` — callers that don't pass it
        leave it NULL.
  - [x] In `run_skill._execute`, pass the captured trace id into the `mark_completed(**cost_fields, ...)`
        call (`:399-406`) and the `mark_blocked` call (`:374-381`) as `langsmith_run_id=<captured id>`.
        Keep `**cost_fields` (from `_extract_cost_fields`) exactly as-is — `langsmith_run_id` is a
        **separate** kwarg, NOT added to `_extract_cost_fields` (it is not a cost field; AC3).
  - [x] Confirm the fan-out parent `mark_completed` (`:692-698`) is NOT given a `langsmith_run_id`
        (defaults to None) — AC5.
- [x] **Task 3 — Propagate the trace headers into the sandbox subprocess** (AC: 2, 4)
  - [x] In `code_driven_executor.py`, at the `LANGSMITH_*` injection block (`:511-515`): when
        `_settings.LANGSMITH_TRACING and _settings.LANGSMITH_API_KEY` (the existing gate) AND a current
        run tree exists, serialize the parent headers. Lazy/local import `get_current_run_tree` from
        `langsmith.run_helpers`; if `rt := get_current_run_tree()` is not None, set
        `injected_env["LANGSMITH_PARENT_HEADERS"] = json.dumps(rt.to_headers())`. (`json` is already
        imported in this module — confirm.) Guard the whole thing so a tracing-off process injects
        nothing new (AC4). Keep the existing three `LANGSMITH_*` injections unchanged.
  - [x] Do NOT inject `LANGSMITH_TRACE_CONTENT` (the existing comment `:499-510` deliberately omits it —
        the sandbox shim's redaction floor is unconditional `hide_inputs/outputs=True`, 17-5).
- [x] **Task 4 — Rebuild trace context in the sandbox shim** (AC: 2, 4)
  - [x] In `velara_trace.py` `_wrap_if_available(raw)` (`:221-251`), inside the existing env-gate +
        langsmith-present guard (after the successful `from langsmith import Client` / `from
        langsmith.wrappers import wrap_anthropic` at `:240-246`), also import `RunTree` from
        `langsmith.run_trees` and `tracing_context` from `langsmith.run_helpers` **inside the same guarded
        try** (so an old/partial langsmith still falls back cleanly). Read
        `os.environ.get("LANGSMITH_PARENT_HEADERS")`; if present, `json.loads` it and
        `parent = RunTree.from_headers(headers)` (returns None if the header is malformed/absent).
  - [x] When `parent` is not None, wrap the returned traced client so its calls execute inside
        `tracing_context(parent=parent)`. **Design note:** `_wrap_if_available` returns a client
        synchronously; `tracing_context` is a context manager that must be active *at the actual API
        call*, not at construction time. Store the reconstructed `parent` RunTree at module scope (e.g.
        `_parent_run`) when `_wrap_if_available` builds a traced client, then have the thin recorder
        enter `tracing_context(parent=_parent_run)` around each real call, guarded so a `None`
        `_parent_run` calls through exactly as today.
  - [x] **⚠️ CRITICAL — cover the STREAM path, not just create/parse (verified against `wrap_anthropic`).**
        `.create`/`.parse` are synchronous: wrapping `with tracing_context(parent=_parent_run):` around
        the `self._inner.create(...)`/`.parse(...)` call in `_UsageMessages` (`:184-192`) nests them
        correctly. **But `.stream` does NOT create its traced run at `.stream()` construction time** —
        `wrap_anthropic`'s stream manager is lazy: the traced run is created only on `__enter__` /
        iteration / `get_final_message()` (verified: `wrappers/_anthropic.py:435-476`,
        `MessagesStreamManagerWrapper.__enter__`/`__iter__`). A `tracing_context` scoped only around
        `_UsageMessages.stream`'s construction call (`:194-196`) will have **already exited** before the
        run is created → the sandbox stream call traces as its OWN root, silently re-opening Hole 2 for
        every streaming skill (and AC6's extractor uses `get_final_message()`, i.e. streaming). So the
        `tracing_context(parent=_parent_run)` MUST be held **across `_UsageStream.__enter__`, the stream
        iteration, and `get_final_message()` / `__exit__`** — not around the `.stream()` call. Concretely:
        open `tracing_context(parent=_parent_run)` inside `_UsageStream.__enter__` (`:154-157`) via a
        stored `contextlib.ExitStack`/entered CM held on the instance, and exit it in `_UsageStream.__exit__`
        (`:159-171`) alongside the existing usage-fallback logic. Do the same for `.create`/`.parse` by
        wrapping their single call. Verify with a test that the stream path nests (patch `tracing_context`
        and assert it was entered during stream consumption, not merely constructed).
  - [x] **Hold the reconstructed parent by a STRONG reference.** `tracing_context(parent=...)` stores the
        parent as a **weakref** (`run_helpers.py:1891` `_PARENT_RUN_TREE_REF.set(weakref.ref(v))`) and
        `get_current_run_tree()` dereferences it. The module-global `_parent_run` (a strong ref) is what
        keeps it alive — do NOT pass a throwaway inline `RunTree.from_headers(...)` to `tracing_context`,
        or it can be GC'd and nesting silently drops to None.
  - [x] `velara_trace.py` MUST keep zero `app.*` imports (it runs in the sandbox venv —
        `sandbox_assets/__init__.py:6`). All new langsmith imports stay inside the existing guarded
        try/except so a venv without langsmith still falls back to untraced + `totals()` accumulation
        (AC4). `import json` locally in the shim if not already present.
- [x] **Task 5 — Tests** (AC: all)
  - [x] **Worker trace-open** — in `tests/unit/workers/test_execution_tasks.py` (or the existing
        `run_skill` test module — locate it): assert that when tracing is ON, `run_skill` opens exactly
        ONE `trace(...)` around `execute_skill` and persists its `trace_id` to `mark_completed`'s
        `langsmith_run_id`; when tracing is OFF, no trace is opened and `langsmith_run_id` is None.
        Patch `langsmith.run_helpers.trace`/`get_current_run_tree` (or a fake) — do NOT require a live
        LangSmith key.
  - [x] **job_service** — extend `tests/unit/services/test_job_service.py` (or equivalent): assert
        `mark_completed`/`mark_blocked` persist a passed `langsmith_run_id` onto `InvocationResult`, and
        default it to None when omitted (back-compat).
  - [x] **Sandbox propagation** — extend `tests/unit/services/test_velara_trace_shim.py`
        (`TestWrapAnthropicGuardedImport`, currently `:112-252`): (a) with `LANGSMITH_PARENT_HEADERS` set
        to a valid serialized `to_headers()` dict AND langsmith present, assert `from_headers` +
        `tracing_context(parent=...)` are invoked (patch them) so the in-sandbox call nests; (b) with the
        env var ABSENT, assert the shim traces as its own root (no `tracing_context`) and still
        accumulates `totals()`; (c) langsmith-absent → still falls back to untraced + accumulation (the
        existing guard test still passes). Add the header-serialization assertion on the executor side if
        there is a `code_driven_executor` env-injection test; otherwise a focused new test for the
        `LANGSMITH_PARENT_HEADERS` injection.
  - [x] `ruff check .` clean; run affected unit + integration suites; `python scripts/export_openapi.py`
        → zero `docs/api-spec.json` diff (AC7).

## Dev Notes

### Governing invariant — AD-7 (verbatim intent)

`ARCHITECTURE-SPINE.md:92-96`: "The worker opens **exactly one** LangSmith trace per leaf invocation
*before* the first LLM call; every span — all platform tool-turns AND all in-sandbox skill calls —
nests under it. The emitter must **stop minting independent root runs**. Cross-process: the worker
passes `parent.to_headers()` into the sandbox via `injected_env`; the shim rebuilds context with
`RunTree.from_headers()` + `tracing_context()` (verified to share `trace_id` across the subprocess
boundary). The persisted linkage is the **`trace_id`** (`langsmith_run_id` column holds it), never a
per-span run id."

Related: **AD-6** (`:86-90`) — tracing-off writes no `langsmith_run_id`; `get_current_run_tree()` is
None when off. **AD-9** (`:104-108`) — fan-out parents / code runs are `$0`-terminal, never assigned a
trace. **AD-2** (`:62-66`) — the wrap seam (17-5, done) that this story nests under.

### The exact edit surface (verified against baseline fa1e96b via full call-site sweep)

| File | Change |
| --- | --- |
| `app/workers/execution_tasks.py` | `_execute()` (`:256`): open ONE `trace("velara.invocation", run_type="chain")` around `execute_skill(...)` (`:346-354`); capture `rt.trace_id` via `get_current_run_tree()` inside the block (None when off); pass `langsmith_run_id=` to `mark_completed` (`:399-406`) and `mark_blocked` (`:374-381`). Do NOT open a trace in `aggregate_results` fan-out (`:689-698`). |
| `app/services/job_service.py` | Add `langsmith_run_id: str | None = None` kwarg to `mark_completed` (`:525-536`) and `mark_blocked` (`:571-582`); map onto `InvocationResult(...)` (`:550-559`, `:595-604`). Additive, back-compat (mirror `output_sha256`). |
| `app/services/code_driven_executor.py` | At the `LANGSMITH_*` env block (`:511-515`): when tracing on AND `get_current_run_tree()` not None, inject `LANGSMITH_PARENT_HEADERS = json.dumps(rt.to_headers())`. |
| `app/services/sandbox_assets/velara_trace.py` | `_wrap_if_available` (`:221-251`): inside the guarded langsmith import, read `LANGSMITH_PARENT_HEADERS`, `RunTree.from_headers()`, and thread `tracing_context(parent=...)` around the actual API call (via the thin recorder). Keep zero `app.*` imports; keep untraced+`totals()` fallback. |
| `tests/unit/workers/test_execution_tasks.py` (or the `run_skill` test module) | Assert one trace opened + `langsmith_run_id` persisted (on) / None (off). |
| `tests/unit/services/test_job_service.py` (or equivalent) | Assert `mark_completed`/`mark_blocked` persist `langsmith_run_id`; default None. |
| `tests/unit/services/test_velara_trace_shim.py` | Extend `TestWrapAnthropicGuardedImport` (`:112-252`): header-present nests via `from_headers`+`tracing_context`; header-absent traces own root; langsmith-absent falls back. |

**Do NOT touch (orthogonal — 17-7/17-8 territory, verified):** `app/core/pricing.py`, `compute_cost_usd`,
`_extract_cost_fields`'s cost logic (`execution_tasks.py:137-192`), `cost_is_estimated`, any
`Client.list_runs`/`total_cost` read, any new Celery reconciler task, `app/integrations/anthropic_client.py`'s
wrap seam (17-5), and the sandbox shim's `Client(hide_inputs/outputs)` redaction (17-5). The
`langsmith_run_id`/`cost_is_estimated` **columns** already exist (17-4, `models/invocation.py:216-219`) —
no migration in this story.

### langsmith 0.10.10 SDK — ground-truthed facts you can rely on

Verified by inspecting the installed venv source
(`velara-api/.venv/lib/python3.12/site-packages/langsmith/`), version `0.10.10` (pinned
`pyproject.toml:34`):

- **`trace(name, run_type="chain", ...)`** (`run_helpers.py:971,1034,1084`) — context manager; `__enter__`
  returns the new root `RunTree` and sets `_PARENT_RUN_TREE_REF` (the current-run ContextVar) to it
  (`run_helpers.py:1153-1154`). So `get_current_run_tree()` inside the block returns that run, and
  `wrap_anthropic` calls inside auto-nest under it.
- **`get_current_run_tree()`** (`run_helpers.py:77-83` → `_internal/_context.py:32-38`) — returns the
  current `RunTree` or **None** (ContextVar default None, `_context.py:27-29`). This is your tracing-on/off
  discriminator inside the block — no separate settings read needed (AC4).
- **`RunTree.id` vs `.trace_id`** (`run_trees.py:311,335,378-382`) — for a **root** run they are equal
  (trace_id defaults to id when there's no parent). Persist `rt.trace_id` (semantic trace id; == `rt.id`
  for the root). This is the UUID 17-8 filters on.
- **`RunTree.to_headers()`** (`run_trees.py:1069-1081`) — returns `{"langsmith-trace": self.dotted_order,
  "baggage": ...}`. **The trace value is the full DOTTED ORDER string, not a bare trace_id.** Only emits
  `langsmith-trace` when `self.trace_id` is truthy. **You MUST serialize the whole dict** (JSON) into the
  env var — passing only the UUID loses the dotted order and `from_headers` then fails to parse it.
- **`RunTree.from_headers(headers, **kwargs)`** (`run_trees.py:1005-1067`) — reads the `langsmith-trace`
  (and `baggage`) header; **returns None if the trace header is absent** (`:1022-1027`). On success it
  parses the dotted order and sets `trace_id = parsed[0][1]` (`:1032`) — the SAME UUID the parent
  serialized (lossless round-trip; `_parse_dotted_order` is the inverse of serialization).
- **`tracing_context(*, parent=None, enabled=None, client=None, ...)`** (`run_helpers.py:142-209`) —
  context manager; `parent` accepts a `RunTree` (or headers/dotted-order/False). Setting
  `parent=<RunTree from from_headers>` puts it in `_PARENT_RUN_TREE_REF` (`run_helpers.py:1891`) so
  subsequent `wrap_anthropic` calls nest under it. **The context must be active at the API-call site**,
  not merely at client construction (that is why Task 4 threads it through the thin recorder).
- **Cross-process is genuinely required** (verified): the current-run is a `contextvars.ContextVar`
  (`_context.py:27-29`) storing a **weakref** — it does NOT survive into a subprocess (fresh interpreter,
  re-imports langsmith → default None). The `to_headers → env → from_headers → tracing_context` bridge
  is the only mechanism; it reconstitutes the identical `trace_id` on the child (spine memlog line 26).
- **`Client.list_runs(trace_id=…, run_type="llm", select=["total_cost"])`** (`client.py:4116-4136`) — the
  17-8 reconciler's query; confirms the id you persist here (`rt.trace_id`) is exactly what 17-8 filters
  on. **17-6 does NOT call this** — it only persists the id.
- **Nesting-forces-tracing-on caveat:** being inside an active parent trace forces the wrapped call to
  trace regardless of the env flag. Relevant to how the sandbox behaves once headers are present — with
  the env-gate in the executor (only inject headers when `LANGSMITH_TRACING` is on), this cannot happen
  in the tracing-off env (no headers injected → `from_headers` returns None → no forced tracing).

### Why this closes Holes 1 & 2

- **Hole 1 (single-call/multi-model undercount):** 17-5's `wrap_anthropic` already makes N calls → N llm
  runs, but they had no common parent, so a single scalar `run_id` addressed only one. AD-7's ONE
  invocation trace makes all N nest under one `trace_id`; 17-8 then sums `total_cost` across
  `list_runs(trace_id, run_type="llm")` — every call counted. (The `32013/110` live undercount.)
- **Hole 2 (unlinked sandbox trace):** post-17-5 the in-sandbox `wrap_anthropic` calls emit their own
  *separate root* trace (17-5 explicitly deferred nesting to here — see `velara_trace.py:36-40`). The
  header bridge joins them to the worker's trace, so the sandbox skill's LLM calls reconcile under the
  same `trace_id` as the platform's.

### Previous story intelligence (17-5, done — build on it, don't redo it)

17-5 (`fa1e96b`) landed the wrap seam and slimmed the sandbox shim. **What already exists that you rely
on:**
- `AnthropicProvider._client` is `wrap_anthropic`-wrapped with an explicit `_get_ls_client()`
  (metadata-only PHI floor via `hide_inputs/outputs = not LANGSMITH_TRACE_CONTENT`) and a static
  `run_kind` tag. **Do not touch it** — the wrap auto-nests under whatever trace you open.
- The sandbox `velara_trace.py` `_wrap_if_available` (`:221-251`) already builds an explicit
  `Client(hide_inputs=True, hide_outputs=True)` and wraps via `wrap_anthropic` behind an env-gate +
  guarded import. **You extend this function**, adding `from_headers`+`tracing_context` inside the same
  guard — you do not rebuild it.
- The `totals()` usage accumulator + the thin recorders (`_UsageClient`/`_UsageMessages`/`_UsageStream`/
  `_UsageStreamProxy`) stay — that is the interim cost-VALUE path (unchanged; 17-7/17-8 change value).
- 17-5's `test_config.py::test_default_value_is_false` **pre-existing container-env failure** (the `api`
  container's `.env` leaks `LANGSMITH_TRACING=true`/`LANGSMITH_TRACE_CONTENT=true` into process env) is
  **not yours** — `config.py`/its test are untouched by this diff. Expect it to still fail in the
  container; confirm your diff doesn't touch `config.py` (`git diff --stat` empty for it).
- 17-5's key learning: a test that constructs the provider through a helper which itself patches
  `wrap_anthropic` will shadow an outer patch — construct/patch at the right layer.

### run_kind and content-redaction are already done (do not re-do)

The `run_kind:execution`/`run_kind:adaptation` static wrap tags and the `hide_inputs/outputs` PHI floor
are 17-5's. When you open the parent trace, those child `wrap_anthropic` spans keep their tags/redaction —
the parent trace is orthogonal to them. **Do not add tags/redaction to the parent `trace(...)` beyond a
name/run_type** unless you have a reason; keep it minimal (`"velara.invocation"`, `run_type="chain"`).

### Testing

- **Framework:** pytest. Unit under `tests/unit/`; integration under `tests/integration/` (Postgres-gated).
  Per [Memory: project-velara-api-container-test-env]: the `api` container runs `AUTH_BACKEND=cognito` via
  its `.env`; run integration tests with `set -a; . ./.env.test` against a freshly-recreated clean
  `velara_test` (recreate the DB before trusting a full run — no-time-window audit-count tests fail on a
  polluted DB).
- **CRITICAL [Memory: project-container-stale-baked-test-file]:** the `api`/`worker` containers **bake
  source into the image — there is NO bind mount.** After editing any file, `docker cp` it into the
  container (or rebuild) BEFORE running in-container pytest, and verify the container actually has your
  change (grep a new symbol / compare line counts) — otherwise `pytest` runs the stale baked copy and
  "passes" against old code. This bit Story 17.4's review and was re-hit in 17.5's dev run. Rebuilds fill
  VM disk — `docker builder prune -a -f` first if rebuilding.
- **What to assert (mechanism, not a live key):**
  - Worker: patch `langsmith.run_helpers.trace` + `get_current_run_tree` (or a fake RunTree with a known
    `trace_id`); assert `run_skill` opens the trace exactly once, wrapping `execute_skill`, and passes
    that `trace_id` to `mark_completed`'s `langsmith_run_id`. Tracing-off: `get_current_run_tree()` →
    None → `langsmith_run_id` written None, job completes.
  - `job_service`: `mark_completed`/`mark_blocked` persist a passed `langsmith_run_id`; omit → None.
  - Sandbox shim: (a) `LANGSMITH_PARENT_HEADERS` present + langsmith present → `RunTree.from_headers` +
    `tracing_context(parent=...)` invoked around the call (patch them); (b) env var absent → own-root, no
    `tracing_context`, `totals()` still accumulates; (c) langsmith absent → untraced fallback +
    accumulation (existing `TestWrapAnthropicGuardedImport` shape). Use the existing autouse
    `_reset_shim_module` reload fixture so module globals (`_parent_run` if you add one) reset per test.
  - Executor: assert `LANGSMITH_PARENT_HEADERS` is injected as `json.dumps(to_headers())` only when
    tracing on AND a run tree is active; absent otherwise (AC4).
- **Do NOT** require a live LangSmith key in CI; AC6's real-run check is a manual/dev verification.
- **Gates:** `ruff check .` clean; affected unit + integration suites green; `python
  scripts/export_openapi.py` → zero `docs/api-spec.json` diff (run with `PYTHONPATH=/app` in-container per
  17.4's note).

### Project Structure Notes

- Worker task seam: `app/workers/execution_tasks.py` (`run_skill` → `_execute`). The single funnel for a
  leaf invocation's platform LLM calls is `execution_service.execute_skill(...)` (`:346`) — the trace
  wraps exactly that.
- Persistence seam: `app/services/job_service.py` `mark_completed`/`mark_blocked` write `InvocationResult`
  with explicit column kwargs (the additive `output_sha256` pattern is the template).
- Sandbox assets: `app/services/sandbox_assets/velara_trace.py` — written into the workspace at execution
  time by `code_driven_executor._write_velara_trace_shim` (`:210-233`, written at `:591`); it must remain
  `app.*`-import-free (`sandbox_assets/__init__.py:6`). All new langsmith usage stays behind the existing
  guarded import.
- Cross-process boundary: platform prompt/hybrid calls run in the worker process; code-driven-hybrid
  skill calls run in a separate subprocess launched by `code_driven_executor` (`subprocess.run`/`Popen`
  via `_run_subprocess_capture`, `:891-1001`, launched at `:620-635` with `env=injected_env`). The header
  bridge is the ONLY thing that links the two into one trace.
- `langsmith==0.10.10` already pinned (`pyproject.toml:34`) — `trace`, `get_current_run_tree`,
  `tracing_context` in `langsmith.run_helpers`; `RunTree` in `langsmith.run_trees`. No new dependency.
- Columns already exist (17-4): `InvocationResult.langsmith_run_id` (String(64), nullable) +
  `cost_is_estimated` at `models/invocation.py:216-219`. **No migration in this story** (do not touch
  `cost_is_estimated`).

### References

- [Source: ARCHITECTURE-SPINE.md#AD-7] `:92-96` — ONE invocation trace + `to_headers()/from_headers()+tracing_context()` bridge + persist `trace_id` (governing; verbatim in Dev Notes).
- [Source: ARCHITECTURE-SPINE.md#AD-6] `:86-90` — tracing-off: no `langsmith_run_id`; `get_current_run_tree()` None when off.
- [Source: ARCHITECTURE-SPINE.md#AD-9] `:104-108` — fan-out parents / code runs are `$0`-terminal, never traced/reconciled.
- [Source: ARCHITECTURE-SPINE.md#AD-2] `:62-66` — the wrap seam (17-5) this story nests under.
- [Source: .memlog.md] `:26` — verified live SDK: current-run is a ContextVar that does NOT cross the subprocess; bridge = `parent.to_headers()` → `from_headers()`+`tracing_context()` (shares trace_id). `:27` AD-7 rationale (closes Holes 1,2). `:12` test env runs `LANGSMITH_TRACING=false`.
- [Source: velara-api/app/workers/execution_tasks.py] `:228-242` `run_skill` task; `:256` `_execute`; `:346-354` `execute_skill` (trace wrap site); `:362` `_extract_cost_fields`; `:374-381` `mark_blocked`; `:399-406` `mark_completed`; `:509` finally; `:689-698` fan-out parent (NO trace).
- [Source: velara-api/app/services/job_service.py] `:525-568` `mark_completed`; `:571-604` `mark_blocked` — add `langsmith_run_id` kwarg + map to `InvocationResult`.
- [Source: velara-api/app/services/code_driven_executor.py] `:493-498` `injected_env`; `:511-515` `LANGSMITH_*` injection (add `LANGSMITH_PARENT_HEADERS`); `:591` shim write; `:620-635` subprocess launch; `:891-1001` `_run_subprocess_capture`.
- [Source: velara-api/app/services/sandbox_assets/velara_trace.py] `:36-40` deferred-to-17.6 note; `:221-251` `_wrap_if_available` (extend); `:254-272` `client()`; `:184-196` thin recorder create/parse/stream; `:275-288` `totals()`; `:291-335` `install()`+auto-install.
- [Source: velara-api/app/models/invocation.py] `:216-219` `langsmith_run_id` + `cost_is_estimated` columns (17-4; no migration here).
- [Source: langsmith 0.10.10 `run_helpers.py`] `:77-83` `get_current_run_tree`; `:142-209` `tracing_context`; `:971,1034,1084,1153-1154` `trace`; `:1534,1556` wrapper resolves parent from context.
- [Source: langsmith 0.10.10 `run_trees.py`] `:1005-1067` `from_headers` (None if absent; `:1032` trace_id parse); `:1069-1081` `to_headers` (dotted_order value); `:311,335,378-382` id==trace_id for root.
- [Source: langsmith 0.10.10 `_internal/_context.py`] `:27-29` ContextVar default None (tracing-off discriminator; weakref → no subprocess crossing).
- [Source: langsmith 0.10.10 `client.py`] `:4116-4136` `list_runs(trace_id, run_type, select)` — 17-8's query; confirms the id 17-6 persists is queryable.
- [Source: _bmad-output/implementation-artifacts/stories/17-5-wrap-anthropic-seam-delete-hand-rolled-tracing.md] — the wrap seam (done) this builds on; the 17-5/17-6 boundary.
- [Source: _bmad-output/implementation-artifacts/stories/17-8-deferred-cost-reconciler-task.md] — the reconciler that consumes the persisted `trace_id`; the boundary 17-6 must not cross.
- [Memory: project-container-stale-baked-test-file] — `api`/`worker` containers bake source; `docker cp` + verify before trusting in-container pytest.
- [Memory: project-velara-api-container-test-env] — `.env.test` + clean `velara_test` for integration tests; test env runs `LANGSMITH_TRACING=false`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Local unit test collection (`.venv/bin/python -m pytest`) fails entirely outside Docker: a
  session-autouse `apply_migrations` fixture in `tests/conftest.py` requires a live Postgres reachable
  at host `postgres` (the Docker Compose service name), which does not resolve from the host — confirmed
  this is pre-existing (identical failure on baseline `fa1e96b` via `git stash`), not caused by this
  story. All test runs were therefore executed inside the `api` container per
  [Memory: project-velara-api-container-test-env].
- Per [Memory: project-container-stale-baked-test-file]: the `api` container bakes source (no bind
  mount). Every changed file was `docker cp`'d into the container after each edit and verified synced
  (grep a new symbol) before trusting any in-container `pytest`/`ruff` run.
- `langsmith.run_helpers.trace(...)` has NO `enabled=` kwarg (its real signature does not include one) —
  an early test draft passed `enabled=True/False` directly to `trace(...)`, which silently absorbs it
  into `**kwargs`, emits a `DeprecationWarning`, and drops it (tracing state follows ambient env
  instead). Fixed by wrapping with the real override, `tracing_context(enabled=True/False)`, which sets
  the actual enablement ContextVar `trace()` reads.
- The `api` container's `.env` leaks `LANGSMITH_TRACING=true`/`LANGSMITH_TRACE_CONTENT=true` into
  process env (same pre-existing leak documented in Story 17.5's Debug Log, causing
  `test_config.py::test_default_value_is_false` to fail there and here — confirmed unrelated,
  `config.py`/its test have an empty `git diff --stat`). This ALSO meant tests asserting the
  tracing-OFF path could not rely on ambient env alone (it's ON in this container) — fixed by using
  `tracing_context(enabled=False)` explicitly rather than assuming unset env vars, in both
  `test_execution_tasks.py::TestCurrentLangsmithTraceId` and
  `test_code_driven_executor.py`'s new `_langsmith_parent_headers_env_value` tests.
- Writing `test_returned_id_is_a_string` (TDD red phase) caught a real type bug before it shipped:
  `RunTree.trace_id` is a `UUID` object (verified `run_trees.py:335`), not a `str`, but
  `langsmith_run_id` is a `String(64)` DB column — `_current_langsmith_trace_id` now explicitly
  `str()`-casts before returning.
- OpenAPI diff gate: the container's baked image predates some already-`done` Story 17.3 certification
  dry-run routes (`docs/api-spec.json` in the repo has them; the container's freshly-generated spec did
  not, for reasons orthogonal to this story — confirmed those routes exist in current
  `app/api/v1/certifications.py`). Diffing the container's freshly-generated spec against the repo's
  tracked file would have shown a false-positive diff unrelated to 17.6. Used a clean methodology
  instead: generated the OpenAPI spec in-container on the pre-17.6 baseline (`git stash`), then again
  post-17.6, and diffed those two container-generated specs directly against each other — byte-identical
  (zero diff attributable to this story's changes), satisfying AC7 without the container/repo drift
  confound.
- Found and fixed a self-contradictory duplicate assertion in my own first draft of
  `test_fan_out_parent_rollup_never_gets_langsmith_run_id` (`assert stored.cost_usd == 0` immediately
  followed by `assert stored.cost_usd is None`, a copy-paste leftover) — caught by the in-container test
  run, not by review.

### Completion Notes List

- **AC1** — `execution_tasks.py` `_execute()` opens exactly one
  `trace("velara.invocation", run_type="chain")` around the `execute_skill(...)` call (the sole
  in-worker platform LLM funnel) via a lazy local import. No other `trace()`/root `RunTree` is opened
  anywhere in the platform path; the fan-out parent roll-up (`aggregate_results`) is untouched.
- **AC2/AC4** — `code_driven_executor.py` gained `_langsmith_parent_headers_env_value()` (extracted, pure
  helper — no active trace → `None`, else `json.dumps(get_current_run_tree().to_headers())`, the FULL
  header dict per the verified `dotted_order` SDK fact), wired into the existing `LANGSMITH_*`
  injection block as a new `LANGSMITH_PARENT_HEADERS` env var, injected only when tracing is on AND a
  trace is active. The sandbox shim's `_wrap_if_available` reconstructs the parent via
  `RunTree.from_headers()` behind the existing guarded-import try, storing it in a strong
  module-global (`_parent_run`) — never a throwaway inline ref (which `tracing_context`'s internal
  weakref could drop). A new `_tracing_context_or_noop()` helper centralizes the "nest only if we have a
  parent" branch.
- **AC2 (critical fix)** — the pre-dev review's CRITICAL finding (stream nesting) was implemented
  exactly as specified: `.create`/`.parse` wrap their single synchronous call in
  `tracing_context(parent=_parent_run)`; `.stream()` does NOT scope it at construction — instead
  `_UsageStream.__enter__` opens a `contextlib.ExitStack`-held `tracing_context` that stays active across
  iteration, `get_final_message()`, and `__exit__`, because `wrap_anthropic`'s stream run is created
  lazily on those calls, not at `.stream()` construction time. A dedicated test
  (`test_stream_path_stays_nested_across_enter_iteration_and_exit`) proves the context is observably
  active *during* stream consumption via a real (non-Mock) recording context manager, not just
  constructed-and-discarded.
- **AC3** — `job_service.mark_completed`/`mark_blocked` gained an additive `langsmith_run_id: str | None
  = None` kwarg (mirroring `output_sha256`'s contract exactly), mapped onto
  `InvocationResult(langsmith_run_id=...)`. `run_skill` captures the id via a new extracted helper,
  `_current_langsmith_trace_id()` (mirrors the existing `_tag_sentry_job` extraction pattern so it's
  unit-testable without running the full async task), and passes it as a separate kwarg to both write
  sites — never threaded through `_extract_cost_fields`.
- **AC4** — Verified against the real SDK (not assumed): `trace(...)` always returns a real `RunTree`
  with a non-None `.trace_id` even when tracing is disabled, but does NOT set the current-run ContextVar
  in that case — so `get_current_run_tree()` (not `rt.trace_id` from the `with` target) is the correct,
  sole discriminator. Proven by a dedicated test that asserts BOTH halves: `rt.trace_id is not None` and
  `captured is None` inside the same `tracing_context(enabled=False)` block.
- **AC5** — Fan-out parent roll-up untouched (verified: no trace-open branch reaches it); a dedicated
  integration test proves `_extract_cost_fields`'s existing `cost_usd=0` branch coexists correctly with
  `langsmith_run_id` defaulting to `None` on that exact write shape.
- **AC6** — Manual/dev verification step, not required in CI per the story's own Testing guidance; not
  executed in this session (no live LangSmith key available) — flagged for a follow-up manual check
  before this reaches a LangSmith-configured environment, exactly as the story anticipated.
- **AC7** — `ruff check .` clean repo-wide. Full unit suite: 856 passed, 1 pre-existing unrelated
  failure (`test_config.py::test_default_value_is_false`, confirmed `config.py`/its test untouched,
  same container-env leak documented in Story 17.5). Full integration suite: 793 passed, 3 pre-existing
  skips, 0 regressions. OpenAPI diff: zero, verified via a clean pre/post-17.6 in-container
  regeneration-and-diff (not a diff against the possibly-stale tracked file — see Debug Log).
- Pre-dev review's 4 findings (1 CRITICAL stream-nesting gap + 3 SHOULD-FIX corrections already folded
  into the story text before implementation) were all implemented as corrected — no additional
  implementation-time deviations from the story's Tasks were needed.

### File List

- `app/workers/execution_tasks.py` (modified — opens one invocation-scoped trace around `execute_skill`;
  new `_current_langsmith_trace_id()` helper; threads `langsmith_run_id` to `mark_completed`/`mark_blocked`)
- `app/services/job_service.py` (modified — added `langsmith_run_id` kwarg to `mark_completed`/`mark_blocked`,
  mapped onto `InvocationResult`)
- `app/services/code_driven_executor.py` (modified — new `_langsmith_parent_headers_env_value()` helper;
  injects `LANGSMITH_PARENT_HEADERS` into the sandbox subprocess env when a trace is active)
- `app/services/sandbox_assets/velara_trace.py` (modified — `_wrap_if_available` reconstructs the parent
  trace via `RunTree.from_headers()`; new `_parent_run` module-global (strong ref) and
  `_tracing_context_or_noop()` helper; `tracing_context(parent=...)` threaded through `_UsageMessages`
  create/parse and `_UsageStream` enter/exit for the lazy stream path)
- `tests/unit/workers/test_execution_tasks.py` (modified — new `TestCurrentLangsmithTraceId` class, 4 tests)
- `tests/unit/services/test_job_service.py` (modified — new `langsmith_run_id` signature-contract +
  column-nullability tests in `TestInvocationResultCostColumns`)
- `tests/unit/services/test_velara_trace_shim.py` (modified — new `TestParentTraceHeaderPropagation`
  class, 5 tests including the critical stream-nesting regression test)
- `tests/unit/services/test_code_driven_executor.py` (modified — 3 new tests for
  `_langsmith_parent_headers_env_value`)
- `tests/integration/workers/test_execution_tasks.py` (modified — 4 new DB-backed tests: `langsmith_run_id`
  persisted on completed/blocked paths, defaults null when omitted, fan-out parent never gets one)

## Change Log

- 2026-07-30: Story drafted from STUB by create-story. Governing AD-7. Edit surface, langsmith 0.10.10
  trace/header API, and the 17-6/17-7/17-8 boundaries verified against live source at baseline fa1e96b
  (post-17.5) via three parallel call-site sweeps + installed-venv SDK ground-truth. Critical SDK
  correction folded in: `to_headers()` carries the full `dotted_order` (not a bare trace_id) — the
  header bridge round-trips the whole `to_headers()` dict. `langsmith_run_id` persisted as a separate
  kwarg (NOT via `_extract_cost_fields`); `cost_is_estimated`/estimate write held for 17-7; reconciler
  read held for 17-8.
- 2026-07-30: Implemented Story 17.6. Worker opens one `trace()` per leaf invocation around
  `execute_skill`; captures the trace id via the on/off-safe `get_current_run_tree()` discriminator
  (extracted into `_current_langsmith_trace_id()`); persists it as a new, separate `langsmith_run_id`
  kwarg on `mark_completed`/`mark_blocked`. Cross-process bridge: the executor injects
  `LANGSMITH_PARENT_HEADERS` (JSON `to_headers()`) into the sandbox subprocess env; the shim rebuilds the
  parent via `RunTree.from_headers()` and threads `tracing_context(parent=...)` through both the
  synchronous create/parse calls AND the lazy stream lifecycle (the pre-dev CRITICAL fix). Zero
  cost-VALUE change; `cost_is_estimated`/estimate write/reconciler untouched (17-7/17-8 territory).
  Gates: ruff clean; 856 unit passed (1 pre-existing unrelated failure) + 793 integration passed (3
  pre-existing skips), 0 regressions; zero OpenAPI diff (verified via clean pre/post in-container spec
  regeneration).

## Review Findings

Code review 2026-07-30 (3 parallel adversarial layers: Blind Hunter, Edge Case Hunter, Acceptance
Auditor). **Acceptance Auditor: all 7 ACs satisfied, forbidden scope (pricing/cost_is_estimated/
reconciler/wrap-seam/migration) fully respected — no AC violations.** 1 patch, 3 deferred (all
pre-existing 17-5 characteristics, not caused by this change), 3 dismissed as noise.

- [x] [Review][Patch] **FIXED** — `_UsageStream.__enter__` leaked the tracing-context ExitStack if the inner stream open raised; tracing_context entry was also unguarded on create/parse [app/services/sandbox_assets/velara_trace.py:196-227, 109-146] — In `__enter__`, `_tracing_context_or_noop()` was entered BEFORE `self._cm.__enter__()`; if the wrap_anthropic stream open raised (verified reachable: `MessagesStreamManagerWrapper.__enter__` opens the HTTP stream), `__enter__` never returned → the `with` never called `__exit__` → the entered tracing_context leaked for the rest of the single-run subprocess. **Fix applied (2026-07-30):** (1) `_UsageStream.__enter__` now wraps the tracing-context entry + inner `.__enter__()` in a `try/except BaseException` that closes+clears the ExitStack and re-raises on any failure — no leak. (2) `_tracing_context_or_noop()` was converted to a `@contextlib.contextmanager` that guards BOTH construction AND `.__enter__()` of `tracing_context`, degrading to an un-nested call on any failure — so a truthy-but-broken `_parent_run` can no longer propagate an `__enter__` exception into the skill's own LLM call (honors the "a tracing failure NEVER breaks the skill's LLM call" contract). 2 regression tests added (`test_stream_open_failure_exits_tracing_context_no_leak`, `test_tracing_context_enter_failure_degrades_to_unnested_call`). Shim suite: 19 passed (was 17); ruff clean.

- [x] [Review][Defer] Streaming `get_final_message()` raising mid-stream silently drops that call's usage in `totals()` [app/services/sandbox_assets/velara_trace.py:161-164, 209-214] — deferred, pre-existing (17-5 `totals()` recorder, unchanged by 17-6; the interim cost-VALUE path being superseded by the 17-8 LangSmith reconciler per AD-4/AD-5).
- [x] [Review][Defer] `totals()` returns real tokens with `model=None` → run prices NULL ("--") [app/services/sandbox_assets/velara_trace.py:104-106, 361-367] — deferred, pre-existing (17-5 `_last_model` truthiness guard, unchanged by 17-6; superseded by 17-8 reconciler which sums LangSmith `total_cost` independent of the envelope model).
- [x] [Review][Defer] `.parse`-only skills get no nested span (wrap_anthropic doesn't trace non-beta `.parse`) — Hole-2 residual for parse-only skills [app/services/sandbox_assets/velara_trace.py:243-247] — deferred, honest documented limitation (the code's own docstring :340-344 acknowledges it; usage is still accumulated). Real-world reach is low (skills stream/create); revisit if a parse-only code-driven-hybrid ships.
