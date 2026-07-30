---
governing_ads: [AD-4, AD-8, AD-9]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: [17-4, 17-6, 17-7]
enables: [17-9]
baseline_commit: d6bc4bcbe (HEAD, post-17.7)
also_governed_by: AD-6 (reconciler no-ops without a langsmith_run_id), AD-7 (trace_id linkage / list_runs)
status_note: >
  Filled from STUB by bmad-create-story 2026-07-30. Governing artifact is the ARCHITECTURE-SPINE
  (status: final): AD-4 (reconciler overwrites the estimate with LangSmith's authoritative total_cost),
  AD-8 (compare-and-set, completeness gate, enqueue-after-commit, never-regress), AD-9 (leaf LLM rows
  only — fan-out parents / code runs are $0-terminal, never reconciled), plus AD-6 (no-op without a
  trace) and AD-7 (the trace_id linkage + list_runs read). Every source citation verified against LIVE
  source at baseline d6bc4bc (post-17.7 merge) via two parallel call-site sweeps (Celery task/registration/
  retry/enqueue-ordering + session pattern; LangSmith Client construction, list_runs SDK signature,
  InvocationResult cost columns, and the reconcile-candidate predicate). CRITICAL ground-truth folded in:
  (1) the reconciler is GREENFIELD — no reconciler, no `list_runs`/`total_cost`/`read_run` call exists in
  app/ today; (2) the new task module MUST be added to celery_app.py's `include=[...]` list or it silently
  never registers (there is NO autodiscovery); (3) the DB-level candidate predicate
  `cost_is_estimated = true AND langsmith_run_id IS NOT NULL` STRUCTURALLY excludes fan-out parents and
  code runs — neither `fan_out` nor `runtime` is a column on `invocation_results` (fan_out lives on
  InvocationJob; runtime lives inside result_metadata JSONB), and AD-9 rows never get a trace id anyway;
  (4) the AD-9 `[ASSUMPTION]` in the spine (self-scheduled follow-up vs periodic sweep) is RESOLVED to
  self-scheduled enqueue-after-commit + bounded self-retry, because that is the only ordering AD-8 permits
  and it mirrors the existing `parse_document` retry idiom exactly; (5) `langsmith_run_id` is a TRACE id,
  so the read is `list_runs(trace_id=...)`, NEVER `read_run(run_id=...)`.
---

# Story 17.8: Deferred Cost Reconciler Task

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the platform,
I want an async task to replace each provisional estimate with LangSmith's authoritative cost,
so that the DB's `cost_usd` converges to the true, per-model figure shortly after a run completes.

## ⚠️ SCOPE — read this first

**Backend only (`velara-api`). This is the RECONCILER story — the cold-path CAS writer.** You build ONE
new async Celery task that: (a) is **enqueued after the estimate row commits** at job completion, (b)
reads LangSmith's authoritative `total_cost` for the invocation's trace and **sums it across all `llm`
runs**, (c) **compare-and-set UPDATEs** `cost_usd` + `cost_is_estimated=false` on the row **only while it
is still an estimate**, and (d) **bounded-retries** while LangSmith's cost is not yet computed. You are the
**only** code in the whole platform that ever flips an LLM row's `cost_is_estimated` from `true → false`,
and the only code that reads LangSmith cost.

**This story does NOT (do these elsewhere / leave them alone):**
- **The estimate write / hot path → done in 17-7.** The completion write of `cost_usd` (estimate),
  `cost_is_estimated=true`, `langsmith_run_id`, tokens, and `model` is already wired
  (`execution_tasks.py` → `mark_completed`/`mark_blocked` → fresh `InvocationResult` INSERT under
  `_guard_not_terminal`). Do **not** touch `_extract_cost_fields`, `pricing.py`, or the estimate write.
  You only **UPDATE** the row it already inserted.
- **The trace / `langsmith_run_id` capture → done in 17-6.** The one invocation-scoped `trace(...)` and
  `_current_langsmith_trace_id()` already persist the **trace id** into `langsmith_run_id`. You **read**
  that column; you do not open a trace, capture an id, or touch header propagation.
- **The `wrap_anthropic` seam / sandbox shim → done in 17-5/17-6.** Do not touch
  `anthropic_client.py`'s wrap factory or `velara_trace.py`. You build a **separate, read-only**
  `langsmith.Client` for `list_runs` (do NOT reuse the cached write client `_get_ls_client()` — see AC7).
- **Cost READ consumers / API exposure → Story 17-9.** Do **not** add `cost_is_estimated` to any API
  schema, and do **not** change `analytics_service` SUMs, `jobs.py`, or `client.py`. They already read
  `cost_usd` NULL-safely and estimate-blind; after you reconcile a row its `cost_usd` simply becomes more
  accurate and serializes identically. Exposing the flag on the wire is 17-9's AC (it owns the
  `api-spec.json` diff — this story's OpenAPI diff must be **zero**).
- **A migration.** The `langsmith_run_id` (`:216`) and `cost_is_estimated` (`:217-219`) columns already
  exist (17-4, migration 0031). **No migration in this story.** If you reach for `alembic revision` — STOP.

**Governing invariants:** **AD-4** (`ARCHITECTURE-SPINE.md:74-78`) — reconciler overwrites the estimate
with LangSmith's authoritative `total_cost`, summed across all llm runs in the trace, idempotent,
bounded-retry, never regresses `false`. **AD-8** (`:96-102`) — compare-and-set (`UPDATE … WHERE
cost_is_estimated = true`), completeness gate (only when the trace's cost is fully computed),
enqueue-after-commit (never a bare timer that could beat the write). **AD-9** (`:104-108`) — reconcile
**leaf LLM rows only**; fan-out parents / code runs are `$0`-terminal, never reconciled. Plus **AD-6**
(`:86-90`) — a row with no `langsmith_run_id` (tracing was off) is never reconciled, its estimate stands.
**AD-7** (`:92-94`) — resolve cost via `list_runs(trace_id=…, run_type="llm", select=["total_cost"])`.

## Acceptance Criteria

1. **AC1 — A new reconciler Celery task reads LangSmith cost for the invocation's trace and sums
   `total_cost` across all its `llm` runs (AD-4, AD-7).** A new task (e.g.
   `velara.workers.cost_reconciler.reconcile_invocation_cost`, `bind=True`) accepts the invocation job id
   (or the `langsmith_run_id` + result row key), constructs a **read-only** `langsmith.Client`, and calls
   `client.list_runs(trace_id=<langsmith_run_id>, run_type="llm", select=["total_cost"], project_name=<settings.LANGSMITH_PROJECT>)`.
   It **sums `total_cost` across every returned llm run** (an invocation may make N calls across M models —
   e.g. a sonnet locator + an opus streaming extraction) into one authoritative figure. `list_runs`
   returns a **lazy iterator** — materialize it; do not assume a length.

2. **AC2 — Candidate-gated: touches only reconcilable LEAF LLM rows (AD-9).** The task reconciles a row
   **only if** it satisfies the DB-level predicate **`langsmith_run_id IS NOT NULL AND cost_is_estimated =
   true`**. This predicate **structurally excludes** fan-out parents and genuine `code` runs — those are
   written with `langsmith_run_id = NULL` and `cost_is_estimated = false` by 17-7 (AD-9), so they can never
   match. `fan_out = true` parents (`cost_usd = 0, cost_is_estimated = false`) and `code` runs
   (`cost_usd = 0, cost_is_estimated = false`) are **never** reconciled — the analytics leaf-sum invariant
   (parent = 0, children carry the cost) is preserved. **Do not JOIN to `invocation_jobs.fan_out` as the
   primary gate** — the `langsmith_run_id IS NOT NULL` predicate already excludes them (a fan-out parent
   never gets a trace id); a belt-and-suspenders `fan_out = false` JOIN is optional, not required.

3. **AC3 — Compare-and-set UPDATE: never regresses a reconciled row (AD-8, writer symmetry).** The write
   is a single **`UPDATE invocation_results SET cost_usd = <sum>, cost_is_estimated = false WHERE id = <id>
   AND cost_is_estimated = true`**. Because the `WHERE` clause requires `cost_is_estimated = true`, a
   **redelivered / duplicate reconciler run is a no-op** (0 rows affected — the row is already `false`); it
   **never** flips a reconciled `false` back to `true` and **never** regresses a reconciled `cost_usd` to
   an estimate or NULL. A test must assert: (a) first run flips `true → false` with the summed cost; (b) a
   second (redelivered) run over the now-`false` row updates **0 rows** and leaves `cost_usd` unchanged.

4. **AC4 — Completeness gate + bounded retry: reconcile only when LangSmith's cost is fully computed (AD-8).**
   The task reconciles **only** when the trace's cost is complete — i.e. `list_runs` returns at least one
   `llm` run **and every returned run has a non-NULL `total_cost`**. If the cost is not yet computed
   (no llm runs returned yet, or any `total_cost` is `None`/absent), it **does not write** — it
   **`self.retry(countdown=…, max_retries=…)`** (mirroring the `parse_document` bounded-retry idiom). On
   retry exhaustion it **leaves the estimate in place** (a permanent estimate is acceptable per AD-6/the
   spine's outage policy) and logs a structured `cost_reconcile_incomplete_giving_up` — it must **never**
   write a partial or NULL cost over a valid estimate.

5. **AC5 — Enqueue-after-commit: the reconciler is dispatched only after the estimate row commits (AD-8).**
   The reconciler is enqueued from the completion path **after** `mark_completed`/`mark_blocked` has
   committed the estimate row — never on a bare timer/beat that could run before the row exists.
   **DECISION (resolves the spine's `[ASSUMPTION]`):** use a **self-scheduled `apply_async(countdown=~60)`
   dispatched after the completion transaction commits** (the `create_job → run_skill.delay` after-commit
   ordering in `invocations.py:496-513` is the template — commit first, then dispatch, tolerate a broker
   failure by logging, never rollback the committed cost row). Do **NOT** use a periodic beat sweep of
   `cost_is_estimated = true` rows (rejected: it would fire before the trace exists and re-scan the whole
   table forever). Only dispatch when a `langsmith_run_id` was captured (tracing on) — a tracing-off row
   (`langsmith_run_id IS NULL`) is **not** enqueued at all (AD-6). A broker failure at dispatch is logged
   and swallowed (the estimate stands); it must **not** fail the already-completed job.

6. **AC6 — Tracing-off rows are never reconciled; their estimate stands (AD-6).** A row written with
   `langsmith_run_id IS NULL` (tracing disabled — the default test-env state, `LANGSMITH_TRACING=false`) is
   **never enqueued** (AC5) and, if the task is ever invoked for one defensively, **no-ops immediately**
   (nothing to reconcile against) — its `cost_usd` estimate and `cost_is_estimated=true` are left exactly
   as written. The job completes and stays valid with no LangSmith dependency.

7. **AC7 — A dedicated read-only LangSmith Client, gated on tracing-enabled; no reuse of the write client.**
   The reconciler builds its **own** `langsmith.Client(api_key=settings.LANGSMITH_API_KEY)` for reads —
   it does **NOT** import/reuse `anthropic_client._get_ls_client()` (that is a cached, write-oriented,
   `hide_inputs/hide_outputs` client, private to the wrap seam). Client construction is **gated** on the
   same enabled predicate (`settings.LANGSMITH_TRACING and settings.LANGSMITH_API_KEY`, mirroring
   `_tracing_enabled()`): if tracing is not configured the task no-ops (there is nothing to read). Auth is
   **explicit `api_key=`**, never ambient `os.environ`; no custom endpoint. `project_name` comes from
   `settings.LANGSMITH_PROJECT` (default `"velara"`).

8. **AC8 — Gates green; zero OpenAPI diff; no read-consumer / hot-path drift.** `ruff check .` clean
   repo-wide; the new unit + integration tests pass (see Testing); the new task module is added to
   `celery_app.py`'s `include=[...]` (else it never registers). `python scripts/export_openapi.py` →
   **zero** `docs/api-spec.json` diff (this story adds no HTTP schema). `git status` shows edits confined
   to the new reconciler module, its `include=` registration, the completion-path enqueue call
   (`execution_tasks.py`), and tests — **no** change to `pricing.py`, `_extract_cost_fields`,
   `analytics_service.py`, `jobs.py`, `client.py`, any `schemas/`, the `wrap_anthropic` seam, or
   `velara_trace.py`.

9. **AC9 — Verified end-to-end: a real multi-model run transitions estimate → reconciled and matches the
   LangSmith dashboard.** With a live LangSmith key, a real multi-model extractor run shows an **estimate**
   `cost_usd` immediately on the Run Console, then (within ~one reconcile cycle) a **reconciled** value
   that matches LangSmith's dashboard `total_cost` for that trace, with `cost_is_estimated` now `false`.
   **This is a manual/dev step** (no live key in CI — same posture as 17-6's AC6); flag it for a
   LangSmith-configured environment. The automated suite proves AC1–AC8 with a **mocked** `list_runs`.

## Tasks / Subtasks

- [x] **Task 1 — New reconciler Celery task module** (AC: 1, 2, 3, 4, 6, 7)
  - [x] Create `app/workers/cost_reconciler.py` with a task decorated
        `@celery.task(name="velara.workers.cost_reconciler.reconcile_invocation_cost", bind=True, ...)`
        (import `from app.workers.celery_app import celery`; follow the naming convention
        `velara.workers.{module}.{action}` — autogenerated names are forbidden per `celery_app.py`).
        Signature accepts the **job id** (`str(job.id)`) + `langsmith_run_id`. **⚠️ The enqueuer only has
        the `InvocationJob`, NOT the `InvocationResult.id`** — `mark_completed`/`mark_blocked` return the
        job, and the result row's id is never surfaced to the completion path. So the reconciler re-derives
        the one result row via the unique `invocation_job_id` (`uq_invocation_results_invocation_job_id`,
        `models/invocation.py:239-245`) — `select(InvocationResult).where(InvocationResult.invocation_job_id
        == job_uuid)`. Pass the job id, not a result id.
  - [x] **Session pattern (mandatory):** the task is a **sync** Celery function that bridges to async via
        `asyncio.run(_execute())`; inside, `async with session_scope() as session:` (the `AsyncSession`
        from `app.db.session`), and `await dispose_engine()` in a `finally`. Mirror
        `execution_tasks.py:269-283,536-537` and `ingest_tasks.py` exactly. If retry-exhaustion needs a
        second `asyncio.run()`, dispose the engine again in that loop's own `finally` (see
        `_mark_confirm_race_timeout`, `ingest_tasks.py:123-124`).
  - [x] **Candidate re-check (AD-9):** load the one `InvocationResult` for the job (via
        `invocation_job_id`); if it is not `cost_is_estimated == True` or `langsmith_run_id is None`,
        **no-op return** (already reconciled, or a tracing-off / non-LLM / fan-out row that should never
        have been enqueued — AC6, AC2).
  - [x] **Read-only LangSmith Client (AC7):** build a **dedicated** `langsmith.Client(api_key=settings.LANGSMITH_API_KEY)`
        gated on `settings.LANGSMITH_TRACING and settings.LANGSMITH_API_KEY` (mirror
        `anthropic_client._tracing_enabled()` — do NOT import `_get_ls_client()`). If not enabled, no-op.
        Call `list_runs(trace_id=<langsmith_run_id>, run_type="llm", select=["total_cost"],
        project_name=settings.LANGSMITH_PROJECT)`; materialize the **lazy iterator** into a list.
  - [x] **Completeness gate + sum (AC4, AC1):** if the list is empty OR any run's `total_cost` is
        `None`/missing → **incomplete**: `raise self.retry(countdown=…, max_retries=…)` (mirror
        `parse_document`'s `_CONFIRM_RACE_RETRY_COUNTDOWN`/`_CONFIRM_RACE_MAX_RETRIES` module constants at
        `ingest_tasks.py:41-42`; pick sensible values, e.g. countdown ~30–60s, max ~5–10). On
        `self.MaxRetriesExceededError`, log `cost_reconcile_incomplete_giving_up` and return (leave the
        estimate). Otherwise **sum** the `Decimal`/float `total_cost` values across all runs.
        **⚠️ Decimal discipline:** `cost_usd` is `Numeric(12,6)` (`Decimal`); coerce LangSmith's
        `total_cost` (may be `float`) to `Decimal` via `str()` before summing (never `Decimal(float)` — it
        carries binary-float noise; follow `pricing.py`'s exact-Decimal convention).
  - [x] **Compare-and-set UPDATE (AC3):** issue a single
        `update(InvocationResult).where(InvocationResult.invocation_job_id == <job_uuid>,
        InvocationResult.cost_is_estimated == True).values(cost_usd=<sum>, cost_is_estimated=False)`, then
        `await session.commit()`. Inspect `result.rowcount`: 0 rows = already-reconciled (a redelivered
        no-op — log and return); 1 row = reconciled. **Do NOT** UPDATE without the `cost_is_estimated ==
        True` guard in the WHERE. (Keying on `invocation_job_id` is unambiguous — the unique constraint
        guarantees at most one result row per job.)
- [x] **Task 2 — Register the task module** (AC: 8)
  - [x] Add `"app.workers.cost_reconciler"` to the `include=[...]` list in `app/workers/celery_app.py`
        (`:27-31`). **Without this the task never registers** and dispatch silently no-ops (there is NO
        `autodiscover_tasks`). No `task_routes` needed — it runs on the single default `celery` queue.
- [x] **Task 3 — Enqueue-after-commit from the completion path** (AC: 5, 6)
  - [x] In `app/workers/execution_tasks.py`, after `mark_completed`/`mark_blocked` returns (its commit has
        landed inside the service at `job_service.py:584`/`637`) — ideally **after** the `session_scope()`
        block at `:347` exits cleanly — dispatch the reconciler **only when** a `langsmith_run_id` was
        captured (i.e. `langsmith_run_id is not None`; tracing on). Use
        `await run_in_threadpool(reconcile_invocation_cost.apply_async, ...)` with `countdown=~60`
        (mirror the `run_in_threadpool(run_skill.delay, …)` after-commit dispatch in
        `invocations.py:499`). Pass the `InvocationResult.id` (or job id) + `langsmith_run_id`.
  - [x] **Broker-failure handling (AC5) — swallowing is MANDATORY, not tidy.** Wrap the dispatch in
        `try/except` — a broker failure logs a structured `cost_reconcile_dispatch_failed` and is
        **swallowed** (the job is already complete and its estimate stands; do NOT rollback the cost row,
        do NOT fail the job). ⚠️ The dispatch point (after the `session_scope()` block exits, before the
        function returns) is **still inside `run_skill`'s outer `try:`** whose `except Exception` marks the
        job **FAILED**. An un-swallowed dispatch exception would therefore fail an already-completed job —
        so the local `try/except` around the dispatch is required for correctness, not just hygiene. This
        is the deliberate after-commit tradeoff (unlike `confirm_file_ref`'s before-commit+rollback — do
        not copy that here).
  - [x] **Do NOT** enqueue for fan-out parents or `code` runs (they have `langsmith_run_id is None` → the
        `is not None` guard already excludes them — AD-9), and **do NOT** enqueue on the tracing-off path
        (`langsmith_run_id is None` — AD-6).
- [x] **Task 4 — Confirm no hot-path / read-consumer / schema drift** (AC: 8)
  - [x] Do **not** modify `app/core/pricing.py`, `_extract_cost_fields`, `app/services/analytics_service.py`,
        `app/api/v1/jobs.py`, `app/api/v1/client.py`, any `schemas/`, the `wrap_anthropic` seam
        (`app/integrations/anthropic_client.py`), or `app/services/sandbox_assets/velara_trace.py`.
  - [x] `git status --short` after all edits shows only: `app/workers/cost_reconciler.py` (new),
        `app/workers/celery_app.py` (include), `app/workers/execution_tasks.py` (enqueue), and test files.
  - [x] `python scripts/export_openapi.py` → zero `docs/api-spec.json` diff (AC8).
- [x] **Task 5 — Tests** (AC: all)
  - [x] **Unit — the reconciler task** (`tests/unit/workers/test_cost_reconciler.py`, new). Mock
        `langsmith.Client` (follow `tests/unit/integrations/test_anthropic_client.py`'s
        `patch("langsmith.Client")` + `SimpleNamespace` settings pattern, `:33-42,315`) and patch
        `get_settings` to return tracing-on settings. Assert:
        - **(AC1/AC4 complete):** `list_runs` returning 2 llm runs with `total_cost` 0.03 + 0.07 → the CAS
          UPDATE is issued with `cost_usd=Decimal("0.10")`, `cost_is_estimated=False`.
        - **(AC4 incomplete):** a run with `total_cost=None` (or empty iterator) → `self.retry` is called,
          **no** UPDATE issued. (Assert `self.retry` invoked — mock `self`/use the task's `.retry`.)
        - **(AC4 exhaustion):** `MaxRetriesExceededError` → logs give-up, no write.
        - **(AC7 tracing-off / not-configured):** settings with `LANGSMITH_TRACING=False` (or empty key) →
          no `list_runs`, no write, clean no-op.
        - **(AC2/AC6 candidate re-check):** a row already `cost_is_estimated=False`, or `langsmith_run_id
          is None` → no `list_runs`, no write.
        - **Decimal coercion:** a `float` `total_cost` is coerced via `str()` → the persisted value is an
          exact `Decimal` (no binary-float tail).
  - [x] **Integration — DB-backed CAS + no-flip-back** (`tests/integration/workers/test_cost_reconciler.py`,
        new — or extend `tests/integration/workers/test_execution_tasks.py`). With a real `velara_test`
        row and a **mocked** `list_runs`:
        - Seed an estimate row (`cost_is_estimated=True`, a `langsmith_run_id`, an estimate `cost_usd`);
          run the reconciler; assert `cost_usd` == the summed LangSmith figure and `cost_is_estimated ==
          False` (AC1/AC3).
        - **Redelivery no-op (AC3):** run the reconciler a **second** time over the now-`False` row; assert
          the CAS UPDATE affects **0 rows** and `cost_usd` is unchanged (never regressed). This mirrors the
          existing `test_redelivered_mark_completed_does_not_flip_reconciled_row_back_to_estimated`
          precedent (`tests/integration/workers/test_execution_tasks.py:1228`) from the writer side.
        - **AD-9 skip (AC2):** a fan-out-parent / code row (`langsmith_run_id IS NULL`,
          `cost_is_estimated=False`, `cost_usd=0`) → the reconciler no-ops; the row is unchanged.
  - [x] **Enqueue-after-commit (AC5)** — a unit/integration assertion in the completion path
        (`tests/integration/workers/test_execution_tasks.py`) that a completed **LLM** run with a
        `langsmith_run_id` triggers `reconcile_invocation_cost.apply_async` (patched/spied) **after** the
        estimate row is committed; and that a **tracing-off** run (`langsmith_run_id IS NULL`) and a
        **fan-out parent** do **not** enqueue it (AC5/AC6/AD-9). Assert a broker failure at dispatch is
        swallowed and does not fail the job.
  - [x] `ruff check .` clean; run the affected unit + integration suites; `python scripts/export_openapi.py`
        → zero `docs/api-spec.json` diff (AC8).

## Dev Notes

### Governing invariants (verbatim intent)

- **AD-4** (`ARCHITECTURE-SPINE.md:74-78`): "A single asynchronous reconciler reads LangSmith's
  `total_cost` for the invocation's trace, **overwrites** `cost_usd`, and sets `cost_is_estimated = false`.
  It sums `total_cost` across **all** llm runs under the trace (N calls across M models). Idempotent,
  bounded-retry (cost may not be computed yet), and it never regresses a reconciled (`false`) row back to
  an estimate or to NULL."
- **AD-8** (`:96-102`): "…The reconciler writes with a **compare-and-set** (`UPDATE … WHERE
  cost_is_estimated = true`), so a redelivered run is a no-op. It reconciles **only** when LangSmith
  reports the trace's cost as complete (all child llm runs present and `total_cost` non-NULL on each) —
  never on the first partial read. Reconciliation is enqueued only *after* the estimate row commits (from
  the completion transaction / outbox), never on a bare timer that could beat it."
- **AD-9** (`:104-108`): "Reconciliation candidates are **leaf** invocation rows whose runtime made a
  platform LLM call and that carry a `langsmith_run_id`. `fan_out = true` parent rows keep `cost_usd = 0`,
  `cost_is_estimated = false`, are never assigned a trace, and are never reconciled … Genuine `code` runs
  are likewise `0`-terminal. Each child reconciles only the runs under **its own** trace."
- **AD-6** (`:86-90`): "…The reconciler **no-ops for any row without a `langsmith_run_id`**, leaving the
  estimate untouched (never regressed to NULL). Job execution succeeds regardless of LangSmith
  availability."
- **AD-7** (`:92-94`): "…The persisted linkage is the **`trace_id`** (`langsmith_run_id` column holds it),
  never a per-span run id. The reconciler resolves cost via `list_runs(trace_id=…, run_type="llm",
  select=["total_cost"])`."

### ⭐ The key ground-truth that shapes this story

**This is greenfield — there is no reconciler and no LangSmith `list_runs`/`total_cost`/`read_run` call
anywhere in `app/` today** (grep confirms: the only `total_cost` in `app/` is an unrelated local variable
in `analytics_service.py:189`, a SQL sum). You are building the entire cold path from scratch, but every
piece it must plug into already exists and is verified below.

**The candidate predicate is DB-structural, and it makes AD-9 automatic.** `invocation_results` has **no
`fan_out` column and no `runtime` column** (verified — `fan_out` is on `InvocationJob:114-117`; `runtime`
lives inside `result_metadata` JSONB, read at estimate-write time only). But 17-7 already wrote fan-out
parents and `code` runs with **`langsmith_run_id = NULL`** and `cost_is_estimated = false` (AD-9), and LLM
leaf rows with a real `langsmith_run_id` and `cost_is_estimated = true`. So the single predicate
**`langsmith_run_id IS NOT NULL AND cost_is_estimated = true`** cleanly selects exactly the reconcilable
leaf-LLM rows — no JOIN to `invocation_jobs.fan_out` is needed (it is optional belt-and-suspenders). This
is corroborated by the writer-side tests `test_fan_out_parent_rollup_never_gets_langsmith_run_id`
(`tests/integration/workers/test_execution_tasks.py:983`) and
`test_cost_is_estimated_false_for_fan_out_parent_rollup` (`:1149`).

**`langsmith_run_id` is a TRACE id, not a span/run id.** 17-6 captured it via
`_current_langsmith_trace_id()` = `str(get_current_run_tree().trace_id)` (`execution_tasks.py:890-911`).
So the read is **`list_runs(trace_id=<value>, …)`**, NEVER `read_run(run_id=<value>)` — passing a trace id
to `read_run` would be wrong. `list_runs` returns a **lazy `Iterator[Run]`**; materialize it and handle
the empty case (trace exists but no `llm` child yet → incomplete → retry).

**The 17-7 review already flagged this story's exact selection constraint.** Story 17-7's Review Findings
(`[Review][Defer]`) recorded: the reconciler's row-selection predicate must couple **`cost_is_estimated =
true AND langsmith_run_id IS NOT NULL`** — selecting by `cost_is_estimated = true` **alone** is wrong.
The `langsmith_run_id IS NOT NULL` half excludes **tracing-OFF rows** (AD-6): a row written with tracing
disabled has `cost_is_estimated=true` but no trace id, so there is nothing to `list_runs` against — it
must be left as a permanent estimate, not retried forever. (Note the subtlety: an **unknown-model** LLM
row written *with tracing on* has `cost_is_estimated=true` + `cost_usd=NULL` **and a real
`langsmith_run_id`** — LangSmith knows the true cost even though our local table couldn't price it, so
that row **is** reconcilable and correctly matches the predicate. The `IS NOT NULL` half is about
"was there a trace?", not "did we manage to estimate a price?".) The coupled predicate is mandatory, not
optional — this is why AC2 states it explicitly.

### The exact edit surface (verified against baseline d6bc4bc via full call-site sweep)

| File | Change |
| --- | --- |
| `app/workers/cost_reconciler.py` (**NEW**) | The reconciler task: read-only `langsmith.Client`, `list_runs(trace_id=…, run_type="llm", select=["total_cost"], project_name=…)`, sum `total_cost` across llm runs, completeness gate + bounded `self.retry`, CAS `UPDATE … WHERE cost_is_estimated = true`. Async-in-sync session pattern + `dispose_engine()` in `finally`. |
| `app/workers/celery_app.py` | Add `"app.workers.cost_reconciler"` to `include=[...]` (`:27-31`) — **registration is required or the task silently never registers** (no autodiscovery). |
| `app/workers/execution_tasks.py` | **After** `mark_completed`/`mark_blocked` commits, and only when `langsmith_run_id is not None`, dispatch `reconcile_invocation_cost.apply_async(..., countdown=~60)` via `run_in_threadpool` (mirror `invocations.py:499`'s after-commit `run_skill.delay`). Broker failure logged + swallowed. **No change** to `_extract_cost_fields` / the estimate write. |
| `tests/unit/workers/test_cost_reconciler.py` (**NEW**) | Mocked `list_runs`: complete → CAS write; incomplete → retry; exhaustion → give-up; tracing-off/not-configured → no-op; candidate re-check; Decimal coercion. |
| `tests/integration/workers/test_cost_reconciler.py` (**NEW**, or extend `test_execution_tasks.py`) | DB-backed CAS flip `true→false`; redelivery no-op (0 rows, no regression); AD-9 skip of fan-out/code rows. |
| `tests/integration/workers/test_execution_tasks.py` | Enqueue-after-commit: LLM run enqueues the reconciler post-commit; tracing-off + fan-out do NOT; broker failure swallowed. |

**Do NOT touch (orthogonal — verified):** `app/core/pricing.py` + `_extract_cost_fields` (the estimate
writer, 17-7), the `wrap_anthropic` seam `app/integrations/anthropic_client.py` (17-5 — and do NOT reuse
its cached write client `_get_ls_client()`), the sandbox shim `velara_trace.py` (17-5/17-6), the trace-open
/ `langsmith_run_id` capture (`execution_tasks.py:368-369`, 17-6), the analytics SUMs
(`analytics_service.py:137,182,260`), the `jobs.py`/`client.py` cost responses and all `schemas/` (17-9),
and any migration (columns exist from 17-4). Zero `docs/api-spec.json` diff.

### Celery / worker mechanics you must follow (verified)

1. **Registration is via `include=[...]`, not autodiscovery** (`celery_app.py:27-30`). The Celery app is
   `celery = Celery("velara", broker=REDIS_URL, backend=REDIS_URL, include=[…])`. Add the new module or the
   worker boots with the task **unregistered** — dispatch by name silently succeeds while nothing consumes
   it (the file's own comment warns of exactly this). No `task_routes`/queues exist; the task runs on the
   default `celery` queue.
2. **Task decorator convention:** `@celery.task(name="velara.workers.cost_reconciler.reconcile_invocation_cost", bind=True, …)`.
   `bind=True` gives you `self` for `self.retry(...)`. Name convention `velara.workers.{module}.{action}`
   is mandatory (autogenerated names forbidden). Representative: `run_skill` at `execution_tasks.py:241-254`.
3. **Bounded-retry-with-countdown pattern — copy `parse_document` exactly** (`ingest_tasks.py:295-311`).
   It is the ONE such pattern in the repo: module constants `_CONFIRM_RACE_RETRY_COUNTDOWN=2`,
   `_CONFIRM_RACE_MAX_RETRIES=5` (`:41-42`); `raise self.retry(countdown=…, max_retries=…)` **raises**
   (so `raise self.retry(...)`); on exhaustion Celery raises `self.MaxRetriesExceededError` (let Celery own
   the `retries+1 > max_retries` check — do NOT inspect `self.request.retries` yourself). Pick reconciler
   values (e.g. countdown ~30–60s to give LangSmith time to compute cost, max ~5–10).
4. **Session pattern — async-in-sync** (`execution_tasks.py:269-283,536-537`; `ingest_tasks.py`): the sync
   task body does `asyncio.run(_execute())`; inside `_execute`, `async with session_scope() as session:`
   (the **AsyncSession** from `app.db.session`); `await dispose_engine()` in a `finally`. There is **no**
   sync `Session`/`SessionLocal()` in the worker path. A second event loop (e.g. a give-up terminal write
   after retry exhaustion) needs its own `dispose_engine()` in its own `finally` (see
   `_mark_confirm_race_timeout`, `ingest_tasks.py:65-124`).
5. **Enqueue-after-commit** (`invocations.py:496-513` is the template): `create_job` commits the queued
   row, **then** `task = await run_in_threadpool(run_skill.delay, str(job.id))`; a broker failure there is
   logged and the job marked failed in a fresh session (it can't be rolled back post-commit). For the
   reconciler you want the same **commit-then-dispatch** ordering — but on broker failure you **swallow**
   (the job is already complete; the estimate stands). **Do NOT** copy `confirm_file_ref`'s
   dispatch-**before**-commit + rollback (`ingest_service.py:323-345`) — that ordering is for a different
   failure mode and is wrong here.

### LangSmith SDK facts (verified in-container against `langsmith==0.10.10`, `pyproject.toml:34`)

- **`Client.list_runs(*, project_name=None, run_type=None, trace_id=None, …, select=None, limit=None, **kwargs)
  -> Iterator[Run]`** — all four needed params (`trace_id`, `run_type`, `select`, `project_name`) exist and
  the call `list_runs(trace_id=<id>, run_type="llm", select=["total_cost"], project_name="velara")` is
  valid. Returns a **lazy iterator** (materialize; don't assume length).
- **`Run.total_cost`** is present on the schema (alongside `prompt_cost`, `completion_cost`, `run_type`).
  Sum it across the returned llm runs. It may be `float` — coerce to `Decimal` via `str()` before persisting
  to the `Numeric(12,6)` column (never `Decimal(a_float)`).
- **`Client.read_run(run_id, load_child_runs=False) -> Run`** exists too — but do **not** use it here;
  `langsmith_run_id` is a **trace** id (use `list_runs(trace_id=…)`).
- **Read Client construction — mirror `_get_ls_client()`/`_tracing_enabled()`** (`anthropic_client.py:49-79`)
  but build a **separate** one (AC7). Verbatim gate + construction to mirror:
  ```python
  def _tracing_enabled() -> bool:
      settings = get_settings()
      return bool(settings.LANGSMITH_TRACING and settings.LANGSMITH_API_KEY)

  # ... construction (mirror, do not reuse the cached write client):
  from langsmith import Client
  settings = get_settings()
  Client(api_key=settings.LANGSMITH_API_KEY)   # explicit key, never os.environ; no custom endpoint
  ```
  Settings fields (`app/core/config.py:263-289`): `LANGSMITH_API_KEY` (`:272`, gates all tracing;
  blank = off), `LANGSMITH_PROJECT` (`:276`, default `"velara"` → pass as `project_name`),
  `LANGSMITH_TRACING` (`:279`, master switch), `LANGSMITH_TRACE_CONTENT` (`:289`, irrelevant to reads).
  `_tracing_enabled()` = `bool(LANGSMITH_TRACING and LANGSMITH_API_KEY)`.

### The InvocationResult row you UPDATE (verified — `app/models/invocation.py`)

- `cost_usd` (`:202`): `Numeric(12,6)`, nullable — the reconciler overwrites this with the summed authoritative figure.
- `langsmith_run_id` (`:216`): `String(64)`, nullable — **holds the TRACE id** (migration 0031 docstring). Your read key.
- `cost_is_estimated` (`:217-219`): `Boolean NOT NULL server_default=text("false")` — you flip `true → false`. (No ORM client-side `default`; set it explicitly to `False` in the UPDATE `.values`.)
- Unique constraint `uq_invocation_results_invocation_job_id` (`:239-245`): one row per job.
- AD-5 state docstring (`:204-215`): "`cost_is_estimated=false + cost_usd non-NULL -> authoritative
  (reconciled by the 17.8 reconciler, or a genuine $0 no-LLM code run)`" — **your** story is the "reconciled
  by 17.8" half.
- **No `fan_out`/`runtime` column here** — `fan_out` is `InvocationJob:114-117`; `runtime` is JSONB in
  `result_metadata`. Use the `langsmith_run_id IS NOT NULL AND cost_is_estimated = true` predicate (AC2).

### The completion write path you hook into (so you extend it, not rebuild it)

1. `run_skill._execute` opens the ONE trace and captures `langsmith_run_id`
   (`execution_tasks.py:368-369`: `with trace("velara.invocation", run_type="chain"): langsmith_run_id =
   _current_langsmith_trace_id()`; `None` when tracing off — AD-6/AC6).
2. `cost_fields = _extract_cost_fields(result_metadata)` (returns `input_tokens`/`output_tokens`/`model`/
   `cost_usd`/`cost_is_estimated`, `:190-206`). **Do not touch this** (17-7 owns it).
3. `mark_completed(session=…, job=…, …, langsmith_run_id=langsmith_run_id, **cost_fields)`
   (`execution_tasks.py:425-433`) / `mark_blocked` (`:399-407`) — fresh `InvocationResult` **INSERT** under
   `_guard_not_terminal`, committed inside the service (`job_service.py:584`/`637`). This is the row you
   later UPDATE. The write is INSERT-only, never UPDATE — **you are the sole UPDATE writer** of
   `cost_usd`/`cost_is_estimated` (AD-8 writer symmetry).
4. **Your new hook:** after that call returns / the `session_scope()` block (`:347`) exits, if
   `langsmith_run_id is not None`, dispatch `reconcile_invocation_cost.apply_async(…, countdown=~60)` (AC5).

### Why the reconciler's write is safe against the hot-path writer (AD-8 symmetry)

The estimate writer is **INSERT-only** under `_guard_not_terminal` (`job_service.py`) — it never UPDATEs an
existing row, so it can never clobber your reconciled value. Your reconciler is **UPDATE-only** with a
`WHERE cost_is_estimated = true` guard — so it (a) is a no-op on an already-reconciled row (redelivery),
and (b) never touches a fan-out/code `false` row (they're `false` from birth and have no trace anyway).
The two writers are disjoint by construction: writer INSERTs `true`, reconciler flips `true → false`, and
never the reverse. This is the "never-regress is symmetric" of AD-8, realized without a lock: the DB row's
`cost_is_estimated` value **is** the compare-and-set token.

### langsmith / SDK & config notes

- `langsmith==0.10.10` is pinned (`pyproject.toml:34`); no new dependency, no version bump.
- The read Client does network I/O + spins a background batching thread on construction — construct it
  **only** when `_tracing_enabled()` (AC7), and consider lazy-caching per the `_get_ls_client()` pattern
  (`anthropic_client.py:46,60-79`) if you construct it more than once (a per-task construction is also fine
  since the task is infrequent — pick one; if you cache a module global, add a test cache-reset fixture
  like `_isolate_ls_client_cache` at `tests/unit/integrations/test_anthropic_client.py:258-264`).

### Testing

- **Framework:** pytest. Unit under `tests/unit/`; integration under `tests/integration/` (Postgres-gated).
  Per [Memory: project-velara-api-container-test-env]: the `api` container runs `AUTH_BACKEND=cognito` via
  its `.env`; run integration tests with `set -a; . ./.env.test` against a freshly-recreated clean
  `velara_test` (recreate the DB before trusting a full run — no-time-window audit-count tests fail on a
  polluted DB). **The test env runs `LANGSMITH_TRACING=false`** — so AC6/AC7's not-configured no-op is the
  DEFAULT there; the reconciler's `list_runs` MUST be **mocked** for the happy-path/complete/incomplete
  unit + integration tests (there is no live key in CI).
- **CRITICAL [Memory: project-container-stale-baked-test-file]:** the `api`/`worker` containers **bake
  source into the image — there is NO bind mount.** After editing any file, `docker cp` it into the
  container (or rebuild) BEFORE running in-container pytest, and verify the container has your change
  (grep a new symbol / compare line counts) — otherwise `pytest` runs the stale baked copy and "passes"
  against old code. This bit Stories 17.4/17.5/17.6/17.7. Rebuilds fill VM disk — `docker builder prune -a
  -f` first if rebuilding. **A brand-new module (`cost_reconciler.py`) must be `docker cp`'d in — it does
  not exist in the baked image at all**, so an in-container import will `ModuleNotFoundError` until copied.
- **LangSmith mocking pattern — `unittest.mock.patch("langsmith.Client")`** + `SimpleNamespace` settings
  stand-in + `patch.object(module, "get_settings", return_value=…)`. Follow
  `tests/unit/integrations/test_anthropic_client.py:33-42,258-264,315` exactly. For `list_runs`, patch the
  Client instance's `list_runs` to return an iterable of objects/`SimpleNamespace(total_cost=…)`.
- **Pre-existing container-env failure to expect, not fix:** `test_config.py::test_default_value_is_false`
  fails in the `api` container because its `.env` leaks `LANGSMITH_TRACING=true`/`LANGSMITH_TRACE_CONTENT=true`
  into process env (documented in 17.4/17.5/17.6/17.7). `config.py`/its test are untouched by this diff —
  it is not your regression (confirm empty `git diff --stat` for `config.py`).
- **What to assert:** unit — complete-cost → CAS write with the summed `Decimal`; incomplete/empty →
  `self.retry`, no write; exhaustion → give-up, no write; tracing-off/not-configured → no-op; candidate
  re-check (already-`false` / `langsmith_run_id is None`) → no-op; `float`→`Decimal` coercion exactness.
  Integration — DB-backed flip `true→false` with the summed figure; redelivery no-op (0 rows,
  no regression); AD-9 skip of fan-out/code rows. Completion path — LLM run enqueues the reconciler
  post-commit; tracing-off + fan-out do not; broker failure swallowed.
- **Gates:** `ruff check .` clean; affected unit + integration suites green; `python
  scripts/export_openapi.py` → **zero** `docs/api-spec.json` diff (run with `PYTHONPATH=/app` in-container
  per 17.4's note; if the container's baked image predates already-`done` routes, diff a clean pre/post-17.8
  in-container regeneration against each other rather than the tracked file — see 17.6/17.7 Debug Log for
  the methodology).
- **AC9 (live end-to-end) is a MANUAL/dev step** — no live LangSmith key in CI, same posture as 17-6's
  AC6. The automated suite proves AC1–AC8 with a mocked `list_runs`; flag AC9 for a LangSmith-configured
  environment before closing the epic.

### Project Structure Notes

- Reconciler home: `app/workers/cost_reconciler.py` (new) — per the spine's namespace mapping ("Cost
  reconciliation task → `app/workers/`") and Structural Seed ("New reconciler Celery task").
- Registration: `app/workers/celery_app.py` `include=[...]` (`:27-30`) — the new module must be listed.
- Enqueue seam: `app/workers/execution_tasks.py` completion path (after `mark_completed`/`mark_blocked`
  commit) — mirrors the `invocations.py:496-513` after-commit `.delay()` dispatch idiom.
- Retry idiom: `app/workers/ingest_tasks.py:41-42,295-311` (`parse_document` bounded self-retry) — the one
  template to copy.
- Read seam: a **dedicated** `langsmith.Client` (mirror `app/integrations/anthropic_client.py:49-79`, do
  NOT reuse `_get_ls_client()`); `list_runs(trace_id=…)` (AD-7).
- Persistence target: `app/models/invocation.py` `InvocationResult.{cost_usd, cost_is_estimated,
  langsmith_run_id}` (`:202,216,217-219`) — no model change, no migration (17-4).
- Read/exposure surfaces (untouched here; 17-9 territory): `app/services/analytics_service.py`
  (`:137,182,260`), `app/api/v1/jobs.py` (`:157,309`), `app/api/v1/client.py`, `schemas/`.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-4] `:74-78` — reconciler overwrites the estimate with LangSmith's
  authoritative `total_cost`, summed across all llm runs; idempotent, bounded-retry, never regresses `false` (governing).
- [Source: ARCHITECTURE-SPINE.md#AD-8] `:96-102` — compare-and-set (`UPDATE … WHERE cost_is_estimated =
  true`); completeness gate (all llm runs present + `total_cost` non-NULL); enqueue-after-commit; redelivery no-op.
- [Source: ARCHITECTURE-SPINE.md#AD-9] `:104-108` — leaf LLM rows only; fan-out parents / code runs are
  `$0`-terminal, never reconciled; each child reconciles only its own trace's runs.
- [Source: ARCHITECTURE-SPINE.md#AD-6] `:86-90` — reconciler no-ops for any row without a `langsmith_run_id`;
  estimate stands; job succeeds regardless of LangSmith availability.
- [Source: ARCHITECTURE-SPINE.md#AD-7] `:92-94` — `langsmith_run_id` holds the TRACE id; resolve cost via
  `list_runs(trace_id=…, run_type="llm", select=["total_cost"])`.
- [Source: ARCHITECTURE-SPINE.md#Structural-Seed] `:156-163` — "New reconciler Celery task (self-scheduled
  ~60s after completion, bounded retries) — `[ASSUMPTION]` vs a periodic sweep" (this story RESOLVES the
  assumption to self-scheduled enqueue-after-commit — see AC5).
- [Source: ARCHITECTURE-SPINE.md#Deferred] — "Reconciler trigger mechanism (self-scheduled vs periodic
  sweep) — `[ASSUMPTION]` self-scheduled; confirm at build" (resolved to self-scheduled).
- [Source: velara-api/app/workers/celery_app.py] `:19` app instance `celery`; `:27-31` `include=[...]`
  registration (add the new module); `:65-88` conf + `beat_schedule` (single existing periodic task — do
  NOT add a sweep here).
- [Source: velara-api/app/workers/ingest_tasks.py] `:41-42` retry constants; `:65-124`
  `_mark_confirm_race_timeout` (second-event-loop + `dispose_engine` pattern); `:305-308`
  `raise self.retry(countdown=, max_retries=)` template + `:309-311` `MaxRetriesExceededError` exhaustion.
- [Source: velara-api/app/workers/execution_tasks.py] `:134` `_LLM_USING_RUNTIMES` (estimate-write
  discriminator, context); `:190-206` `_extract_cost_fields` return (do NOT touch); `:241-254` `run_skill`
  task decorator (convention); `:269-283,536-537` async-in-sync session + `dispose_engine`; `:368-369`
  trace + `_current_langsmith_trace_id()` (17-6, untouched); `:399-407` `mark_blocked` call; `:425-433`
  `mark_completed` call (the enqueue-after hook goes after these commit).
- [Source: velara-api/app/api/v1/invocations.py] `:496-513` `create_job` after-commit `run_skill.delay`
  dispatch + broker-failure handling (the enqueue-after-commit template — commit then dispatch).
- [Source: velara-api/app/services/ingest_service.py] `:323-345` `confirm_file_ref` dispatch-BEFORE-commit
  + rollback (Story 16.9 — the OPPOSITE ordering; do NOT copy it here).
- [Source: velara-api/app/integrations/anthropic_client.py] `:46` cached client global; `:49-57`
  `_tracing_enabled()`; `:60-79` `_get_ls_client()` construction (mirror the gate + explicit `api_key=`;
  build a SEPARATE read client — do NOT reuse this cached write client).
- [Source: velara-api/app/core/config.py] `:263-289` LangSmith settings — `LANGSMITH_API_KEY` (`:272`),
  `LANGSMITH_PROJECT` default `"velara"` (`:276`, → `project_name`), `LANGSMITH_TRACING` (`:279`).
- [Source: velara-api/app/models/invocation.py] `:114-117` `InvocationJob.fan_out` (NOT on the result row);
  `:202` `cost_usd Numeric(12,6)`; `:204-215` AD-5 state docstring; `:216` `langsmith_run_id String(64)`
  (TRACE id); `:217-219` `cost_is_estimated Boolean NOT NULL server_default false` (flip `true→false`);
  `:239-245` unique constraint.
- [Source: velara-api/app/core/pricing.py] `compute_cost_usd` — the ESTIMATE writer (17-7); exact-Decimal
  convention to mirror when coercing LangSmith `total_cost` (do NOT touch pricing.py itself).
- [Source: langsmith 0.10.10] `Client.list_runs(*, project_name, run_type, trace_id, select, limit, …)
  -> Iterator[Run]`; `Run.total_cost` present; `Client.read_run(run_id, …)` exists (NOT used — trace id).
- [Source: _bmad-output/implementation-artifacts/stories/17-7-estimate-write-hot-path-slim-pricing.md]
  (done) — the estimate write you UPDATE; its Review Findings `[Review][Defer]` records THIS story's
  mandatory selection predicate: `cost_is_estimated=true AND langsmith_run_id IS NOT NULL` (an unknown-model
  estimate row is `true`+NULL-trace and is NOT reconcilable — do not select by the flag alone).
- [Source: _bmad-output/implementation-artifacts/stories/17-6-invocation-scoped-trace-sandbox-header-propagation.md]
  (done) — the trace + `langsmith_run_id` (trace id) capture you read; the manual live-verification posture (AC9 mirrors its AC6).
- [Source: _bmad-output/implementation-artifacts/stories/17-4-cost-tracking-schema-run-id-and-estimated-flag.md]
  (done) — the columns + migration 0031 (no migration here).
- [Source: velara-api/tests/unit/integrations/test_anthropic_client.py] `:33-42` `_tracing_on` SimpleNamespace
  settings; `:258-264` `_isolate_ls_client_cache` reset fixture; `:315` `patch("langsmith.Client")` mock pattern.
- [Source: velara-api/tests/integration/workers/test_execution_tasks.py] `:983`
  `test_fan_out_parent_rollup_never_gets_langsmith_run_id`; `:1149` fan-out `cost_is_estimated=false`;
  `:1228` `test_redelivered_mark_completed_does_not_flip_reconciled_row_back_to_estimated` (writer-side
  no-flip-back precedent to mirror for the reconciler's redelivery no-op).
- [Memory: project-story-15-5-review] — partial-usage None-as-present-key fabricates $0 is the recurring
  bug class; a NULL/absent `total_cost` from LangSmith is INCOMPLETE (retry), never a $0 to write over the estimate.
- [Memory: project-container-stale-baked-test-file] — `api`/`worker` containers bake source; a NEW module
  must be `docker cp`'d in (it is absent from the baked image) + grep-verify before trusting in-container pytest.
- [Memory: project-velara-api-container-test-env] — `.env.test` + clean `velara_test`; test env runs
  `LANGSMITH_TRACING=false` (so `list_runs` is mocked in CI; AC6/AC7 not-configured no-op is the default there).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Sonnet 5)

### Debug Log References

- Verified all load-bearing citations (Celery `include=[...]`, `parse_document`'s retry constants/idiom,
  `invocations.py`'s after-commit dispatch, `anthropic_client.py`'s tracing gate/Client construction,
  `InvocationResult`/`InvocationJob` column shapes, `_current_langsmith_trace_id`) against live source at
  baseline `d6bc4bc` before writing any code — all matched the story exactly.
- `docker cp`'d every new/changed file into both `velara-api-api-1` and `velara-api-worker-1` before each
  in-container ruff/pytest run and confirmed presence via `grep -c`/direct import, per
  [Memory: project-container-stale-baked-test-file] — the brand-new `cost_reconciler.py` module does not
  exist in the baked image at all, so an in-container import raises `ModuleNotFoundError` until copied.
- Confirmed Celery registration end-to-end: `from app.workers.celery_app import celery; import
  app.workers.cost_reconciler` then checked `celery.tasks` contains
  `velara.workers.cost_reconciler.reconcile_invocation_cost`.
- Recreated `velara_test` clean (`dropdb`/`createdb` + `alembic upgrade head` under `.env.test`) before
  running integration tests, per [Memory: project-velara-api-container-test-env].
- Hit the same nested-`asyncio.run()` clash `test_execution_tasks.py`'s own docstring documents: calling
  the real `reconcile_invocation_cost` task directly from an `async def` pytest-asyncio test raised
  `RuntimeError: asyncio.run() cannot be called from a running event loop` (with a "coroutine was never
  awaited" warning). Fixed by routing every direct task invocation through a fresh-thread+event-loop
  runner mirroring `test_ingest.py`'s `_run_parse_document_in_fresh_loop` (temporarily rebinding
  `app.db.session`'s engine/`SessionFactory` to the new thread's loop, `.retry()`/
  `MaxRetriesExceededError` patched on the real singleton task object) — not just for the retry-exhaustion
  tests, but for every test that calls the bound task, matching the established Story 16.9 precedent
  exactly rather than partially.
- Extracted the enqueue decision out of `run_skill._execute` into a standalone async helper
  `_maybe_enqueue_cost_reconciler` (mirroring the existing `_tag_sentry_job`/`_current_langsmith_trace_id`
  extraction pattern) specifically so it could be unit-tested directly — `run_skill` itself is never
  invoked end-to-end in this test suite (same asyncio.run constraint), so an inline dispatch block would
  have had no direct unit-test path.
- `ruff check .` clean on first pass after minor import-order fixes (ruff auto-sorted two files;
  reconciled host and container copies via `docker cp` back to host to keep them byte-identical).
- `python scripts/export_openapi.py` (with `PYTHONPATH=/app`) → zero `docs/api-spec.json` diff, confirmed
  via `git diff --stat`.

### Completion Notes List

- **Task 1 (`app/workers/cost_reconciler.py`, new):** Built the reconciler task exactly as scoped —
  `_tracing_enabled()`/`_build_read_client()` mirror `anthropic_client.py`'s gate but construct a
  SEPARATE, un-cached read `Client(api_key=...)` (never `_get_ls_client()`); `_sum_total_cost()` calls
  `list_runs(trace_id=..., run_type="llm", select=["total_cost"], project_name=...)`, materializes the
  lazy iterator, and raises `_CostNotYetComputed` if empty or any `total_cost` is `None` (coercing via
  `str()` before `Decimal`, never `Decimal(a_float)`). The task body re-derives the one `InvocationResult`
  row via `invocation_job_id` (the enqueuer only has the job id — `mark_completed`/`mark_blocked` return
  the `InvocationJob`, not a result id), re-checks the candidate predicate
  (`cost_is_estimated=True AND langsmith_run_id is not None`), and issues a single compare-and-set
  `UPDATE ... WHERE cost_is_estimated = true`. Bounded retry
  (`_RECONCILE_RETRY_COUNTDOWN=30`, `_RECONCILE_MAX_RETRIES=8`) mirrors `parse_document`'s
  `self.retry(countdown=, max_retries=)` / `MaxRetriesExceededError` idiom verbatim, including the
  sync-call-stack requirement (retry is invoked in the outer `except _CostNotYetComputed:` block, never
  inside the coroutine).
- **Task 2 (`celery_app.py`):** Added `"app.workers.cost_reconciler"` to `include=[...]`; verified
  registration end-to-end in-container (task appears in `celery.tasks`).
- **Task 3 (`execution_tasks.py`):** Extracted `_maybe_enqueue_cost_reconciler(job_id, langsmith_run_id)`
  as a standalone async helper (unit-testable, mirroring `_tag_sentry_job`), called from `run_skill`
  immediately after the `session_scope()` block that committed the estimate row exits. No-ops when
  `langsmith_run_id is None` (covers both AD-6 tracing-off and AD-9 fan-out/code rows in one guard, since
  neither ever gets a trace id). Dispatches via
  `run_in_threadpool(reconcile_invocation_cost.apply_async, args=[job_id, langsmith_run_id],
  countdown=_COST_RECONCILE_COUNTDOWN)` (countdown=60s), mirroring `invocations.py`'s after-commit
  `run_in_threadpool(run_skill.delay, ...)` dispatch. Wrapped in try/except that logs
  `cost_reconcile_dispatch_failed` and swallows — verified this call site sits inside `run_skill`'s outer
  `try:` whose `except Exception` marks the job FAILED, so swallowing is required for correctness, not
  optional hygiene.
- **Task 4 (scope confirmation):** `git status --short` shows exactly the 6 files predicted by the story
  (3 modified + 1 new source + 2 new test files) — zero drift into `pricing.py`, `_extract_cost_fields`'s
  logic (only its caller module gained an unrelated constant), `analytics_service.py`, `jobs.py`,
  `client.py`, any `schemas/`, the `wrap_anthropic` seam, or `velara_trace.py`. OpenAPI diff confirmed zero.
- **Task 5 (tests):** 12 new unit tests (`test_cost_reconciler.py` — `_tracing_enabled`/`_build_read_client`
  gating, `_sum_total_cost`'s completeness gate + exact-Decimal summation) + 3 new unit tests
  (`test_execution_tasks.py::TestMaybeEnqueueCostReconciler` — None-run-id never dispatches, real trace id
  dispatches with the countdown, a broker failure is swallowed not raised) + 8 new integration tests
  (`test_cost_reconciler.py` — happy-path CAS flip, redelivery 0-row no-op, AD-9 fan-out skip, AD-6
  tracing-off skip, missing-row no-op, not-configured no-op, incomplete-cost retry, retry-exhaustion
  give-up). All direct invocations of the real `reconcile_invocation_cost` task route through a
  fresh-thread+event-loop runner (mirroring `test_ingest.py`'s established pattern for `bind=True`
  tasks) — discovered mid-implementation that a naive direct call inside an `async def` test raises
  `RuntimeError: asyncio.run() cannot be called from a running event loop`.
- **Gates:** `ruff check .` clean repo-wide. Unit: 883 passed (1 pre-existing unrelated failure —
  `test_config.py::test_default_value_is_false`, documented since 17.4/17.5/17.6/17.7 container `.env`
  leak; confirmed `config.py` has zero diff). Integration: 808 passed, 3 pre-existing skips, 0 regressions
  (run against a freshly recreated `velara_test`). `python scripts/export_openapi.py` → zero
  `docs/api-spec.json` diff.
- **Scope discipline:** No migration (columns already exist from 17-4). No touch to `pricing.py`,
  `_extract_cost_fields`'s cost logic, `analytics_service.py`, `jobs.py`, `client.py`, any `schemas/`, the
  `wrap_anthropic` seam, or `velara_trace.py` (all confirmed via `git status --short`/`git diff --stat`).
  AC9 (live end-to-end LangSmith verification) is explicitly a manual/dev step per the story — not
  executed this session (no live key), flagged for a follow-up check before a LangSmith-configured
  environment.

### File List

- `app/workers/cost_reconciler.py` — NEW: the reconciler task (`reconcile_invocation_cost`), its
  candidate re-check, LangSmith read-Client construction, completeness gate + bounded retry, and the
  compare-and-set UPDATE.
- `app/workers/celery_app.py` — added `"app.workers.cost_reconciler"` to `include=[...]` (task
  registration).
- `app/workers/execution_tasks.py` — new `_COST_RECONCILE_COUNTDOWN` constant; new standalone
  `_maybe_enqueue_cost_reconciler` helper called from `run_skill` after the estimate row commits.
- `tests/unit/workers/test_cost_reconciler.py` — NEW: 12 unit tests for `_tracing_enabled`,
  `_build_read_client`, `_sum_total_cost`.
- `tests/unit/workers/test_execution_tasks.py` — new `TestMaybeEnqueueCostReconciler` class (3 tests).
- `tests/integration/workers/test_cost_reconciler.py` — NEW: 8 DB-backed integration tests covering
  AC1-AC7 (CAS flip, redelivery no-op, AD-9 skip, AD-6 skip, missing-row, not-configured, retry, and
  retry-exhaustion give-up).

## Change Log

- 2026-07-30: Story drafted from STUB by create-story. Governing AD-4/AD-8/AD-9 (+ AD-6 no-op-without-trace,
  AD-7 trace_id/list_runs). The reconciler surfaces — Celery registration/retry/enqueue-ordering/session
  pattern, the LangSmith read-Client construction + `list_runs` 0.10.10 signature, and the InvocationResult
  cost columns + candidate predicate — verified against LIVE source at baseline d6bc4bc (post-17.7) via two
  parallel call-site sweeps. Five ground-truth facts fixed the scope: (1) GREENFIELD — no reconciler /
  `list_runs` / `total_cost` exists in `app/` today; (2) the new task module MUST be added to
  `celery_app.py`'s `include=[...]` (no autodiscovery) or it silently never registers; (3) the candidate
  predicate `cost_is_estimated=true AND langsmith_run_id IS NOT NULL` is DB-structural and makes AD-9
  automatic — `invocation_results` has NO `fan_out`/`runtime` column, and fan-out/code rows are born
  `false`+NULL-trace; (4) the spine's `[ASSUMPTION]` (self-scheduled vs periodic sweep) is RESOLVED to
  self-scheduled `apply_async(countdown~60)` enqueued after the estimate commits (the only ordering AD-8
  permits; mirrors `invocations.py`'s after-commit `.delay()` and the `parse_document` self-retry idiom) —
  a periodic beat sweep is explicitly rejected; (5) `langsmith_run_id` is a TRACE id, so the read is
  `list_runs(trace_id=…)`, never `read_run(run_id=…)`. Carries forward 17-7's Review `[Review][Defer]`
  constraint verbatim (couple the flag with `langsmith_run_id IS NOT NULL` — an unknown-model estimate row
  is `true`+traceless and NOT reconcilable). No migration (columns from 17-4); read-consumers/API exposure
  held for 17-9 (their api-spec.json diff, not here); wrap seam/sandbox shim/estimate writer untouched
  (17-5/17-6/17-7). AC9 (live end-to-end) is a manual/dev step (no CI key), same posture as 17-6's AC6.
- 2026-07-30: Independent fresh-context validation pass (read-only, against live source at HEAD) — no
  CRITICAL or SHOULD-FIX issues; every load-bearing claim confirmed: Celery `include=[...]` registration
  (`celery_app.py:27-31`, no autodiscovery), the `parse_document` bounded-retry idiom
  (`ingest_tasks.py:41-42,305-311`, the only such pattern), the after-commit `run_skill.delay` enqueue
  template (`invocations.py:496-515`) vs `confirm_file_ref`'s opposite before-commit+rollback
  (`ingest_service.py:323-345`), the async-in-sync session pattern, the DB-structural candidate predicate
  (no `fan_out`/`runtime` column on `invocation_results`; `fan_out` on `InvocationJob:114-117`; fan-out/code
  rows born `false`+NULL-trace), the cost column defs, the read-Client construction to mirror
  (`anthropic_client.py:49-79`, cached/write-oriented — build a separate one), the trace-id semantics
  (`_current_langsmith_trace_id` → `list_runs(trace_id=…)`, never `read_run`), and the langsmith 0.10.10
  `list_runs`/`Run.total_cost` signature (verified in-container). Three refinements folded in from the
  pass: (1) the predicate rationale tightened — `langsmith_run_id IS NOT NULL` excludes **tracing-off**
  rows (an unknown-model row *with tracing on* IS reconcilable); (2) the enqueuer holds only the
  `InvocationJob` (not the `InvocationResult.id`), so the reconciler re-derives the row via the unique
  `invocation_job_id` and the CAS UPDATE keys on it; (3) the dispatch point sits inside `run_skill`'s outer
  `try:` whose `except` marks the job FAILED, so swallowing a broker-dispatch failure is MANDATORY for
  correctness, not just hygiene. AC5's self-scheduled-apply_async-after-commit decision confirmed sound
  (periodic-beat sweep correctly rejected).
- 2026-07-30: Implemented and moved to review (dev-story). New `app/workers/cost_reconciler.py`:
  `reconcile_invocation_cost` (bind=True) builds a dedicated read-only `langsmith.Client` (mirrors
  `anthropic_client._tracing_enabled()`/`_get_ls_client()`'s gate but never reuses the cached write
  client), re-derives the job's one `InvocationResult` row via `invocation_job_id`, re-checks the
  candidate predicate (`cost_is_estimated=True AND langsmith_run_id is not None`), calls
  `list_runs(trace_id=..., run_type="llm", select=["total_cost"], project_name=...)`, sums `total_cost`
  across all llm runs (Decimal-exact via `str()` coercion), and issues a single compare-and-set
  `UPDATE ... WHERE cost_is_estimated = true`. Incomplete cost (empty result or any `total_cost=None`)
  triggers `self.retry(countdown=30, max_retries=8)` mirroring `parse_document`'s idiom exactly; exhaustion
  leaves the estimate in place permanently. Registered in `celery_app.py`'s `include=[...]`. Enqueue hook
  extracted as a standalone `_maybe_enqueue_cost_reconciler` helper in `execution_tasks.py` (unit-testable,
  mirroring `_tag_sentry_job`), called from `run_skill` immediately after the estimate row's
  `session_scope()` block exits; no-ops on `langsmith_run_id is None` (covers both tracing-off and
  fan-out/code rows in one guard); dispatches via `apply_async(countdown=60)` through
  `run_in_threadpool`, wrapped in a swallowing try/except (confirmed necessary, not just tidy, since the
  call site sits inside `run_skill`'s outer failure-handling `try:`). Discovered mid-implementation that
  directly invoking the real bound task from an `async def` pytest-asyncio test raises `RuntimeError:
  asyncio.run() cannot be called from a running event loop` — fixed by routing every direct task call
  through a fresh-thread+event-loop runner mirroring `test_ingest.py`'s established
  `_run_parse_document_in_fresh_loop` pattern (not only for the retry-exhaustion tests, but consistently
  for all reconciler task invocations). Tests: 12 new unit tests (`_tracing_enabled`/`_build_read_client`/
  `_sum_total_cost`), 3 new unit tests (`_maybe_enqueue_cost_reconciler`), 8 new DB-backed integration
  tests (CAS flip, redelivery no-op, AD-9 fan-out skip, AD-6 tracing-off skip, missing-row no-op,
  not-configured no-op, incomplete-cost retry, retry-exhaustion give-up). No migration (17-4's columns);
  zero reader/scope drift into `pricing.py`, `_extract_cost_fields`'s logic, `analytics_service.py`,
  `jobs.py`, `client.py`, `schemas/`, the `wrap_anthropic` seam, or `velara_trace.py` (confirmed via `git
  status`/`git diff --stat`). Gates: `ruff check .` clean repo-wide; unit 883 passed (1 pre-existing
  unrelated container-env failure, documented since 17.4); integration 808 passed / 3 pre-existing skips
  (0 regressions, run against a freshly recreated `velara_test`); zero `docs/api-spec.json` diff. AC9
  (live end-to-end LangSmith verification) is a manual/dev step per the story — not executed this session
  (no live key), flagged for a follow-up check before a LangSmith-configured environment.
