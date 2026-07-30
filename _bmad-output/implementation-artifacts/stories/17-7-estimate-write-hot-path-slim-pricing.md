---
governing_ads: [AD-1, AD-3, AD-6]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: [17-4]
enables: [17-8]
baseline_commit: b3e3ddabe925003466a28ae3a33e5e0ff944b563
also_governed_by: AD-8 (writer half), AD-9 (fan-out/code $0-terminal)
status_note: >
  Filled from STUB by bmad-create-story 2026-07-30. Governing artifact is the ARCHITECTURE-SPINE
  (status: final): AD-1 (pricing demoted to provisional estimate), AD-3 (hot path writes the estimate,
  never blocks on LangSmith), AD-6 (tracing-off keeps the estimate), plus the WRITER half of AD-8
  (guarded write never overwrites a reconciled row) and AD-9 (fan-out/code rows are $0-terminal).
  Every source citation verified against LIVE source at baseline b3e3dda (post-17.6 code-review) via
  three parallel call-site sweeps (pricing.py + all callers; the completion write path; sandbox cost +
  all cost_usd read-consumers). CRITICAL ground-truth folded in: (1) pricing.py is ALREADY minimal and
  correct for the estimate role — "slim/demote" is a documentation reframe, NOT a rewrite of the rate
  table or compute_cost_usd (which would break the two working callers and reinvent a working wheel);
  (2) the completion write is a FRESH INSERT guarded by _guard_not_terminal (one row per job, no
  UPDATE-of-existing-row path exists), so AD-8's "never overwrite a reconciled row" is satisfied
  STRUCTURALLY — do NOT build an ON CONFLICT upsert; (3) cost_is_estimated has ZERO application writers
  today (relies on server_default=false) and ZERO readers — this story wires the first writer only.
---

# Story 17.7: Estimate Write on the Hot Path; Slim `pricing.py`

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want a cost to appear on the Run Console the instant a run completes,
so that I never see a blank/"pending" cost — while LangSmith remains the source that later corrects it.

## ⚠️ SCOPE — read this first

**Backend only (`velara-api`). This is the ESTIMATE-WRITE + PRICING-DEMOTION story.** You do three
things and nothing else:

1. **Demote `app/core/pricing.py` to the provisional-estimate role (AD-1)** — *by documentation, not
   by rewriting logic*. Reframe its docstring/comments so its output is understood as a **provisional
   estimate, always reconcilable, never the source of truth** (LangSmith's `total_cost` is authoritative,
   reconciled in by 17-8). **The rate table and `compute_cost_usd` are ALREADY exactly what an estimate
   needs — keep them functionally as-is.** Do not delete the table, do not change the return type, do not
   change unknown-model→`None`.
2. **Write `cost_is_estimated` on the hot path (AD-3)** — at completion the worker already persists
   `input_tokens`, `output_tokens`, `model`, `langsmith_run_id`, and a provisional `cost_usd` from the
   local estimate (all done in 17-1/17-4/17-6). This story adds the missing flag: an **LLM-runtime**
   estimate row is written with `cost_is_estimated=true`; a genuine `code`/fan-out-parent `$0` row stays
   `cost_is_estimated=false`. It must never block on / read LangSmith inline (it already doesn't).
   Unknown model → `cost_usd=NULL` with `cost_is_estimated=true` (still reconcilable).
3. **Keep it correct when tracing is off (AD-6) and on the fan-out/code paths (AD-9)** — tracing-off
   still writes tokens + estimate + `cost_is_estimated=true` and no `langsmith_run_id`; fan-out parents
   and genuine `code` runs stay `cost_usd=0, cost_is_estimated=false`, never estimated.

**This story does NOT (do these later / elsewhere — do not reach into them):**
- **The reconciler task → Story 17-8.** You do **not** call `Client.list_runs(...)`, do **not** read
  `total_cost`, do **not** add a Celery reconciler, and do **not** ever set `cost_is_estimated=false`
  on an LLM row (only the reconciler flips a real LLM estimate to `false`). If you find yourself
  reading LangSmith cost or writing `cost_is_estimated=false` for an LLM run — **STOP, that is 17-8.**
- **The trace / `langsmith_run_id` persistence → done in 17-6.** The one invocation trace, the
  `langsmith_run_id` capture, and its separate kwarg on `mark_completed`/`mark_blocked` already exist
  (`execution_tasks.py:353-356,392,418`; `job_service.py:536,566`). Do **not** re-open a trace,
  re-capture the id, or touch the header propagation.
- **The `wrap_anthropic` seam / sandbox shim → done in 17-5/17-6.** Do not touch
  `anthropic_client.py`'s wrap or `velara_trace.py`. The sandbox already reports tokens+model only
  (no cost) and the worker prices the aggregate — that seam is unchanged (see AD note below).
- **A migration.** The `langsmith_run_id` (`:216`) and `cost_is_estimated` (`:217-219`) columns already
  exist (17-4, `models/invocation.py:204-219`). **No migration in this story.** If you reach for `alembic revision`
  — STOP.
- **Cost READ consumers / API exposure → Story 17-9.** Do **not** add `cost_is_estimated` to any API
  schema, and do **not** change `analytics_service` SUMs or `jobs.py` responses. They already work
  correctly against an estimate value (all NULL-safe, none filter on the flag — verified). Exposing
  the flag on the wire is 17-9's AC (it owns the api-spec.json diff).

**Governing invariants:** **AD-1** (`ARCHITECTURE-SPINE.md:56-60`) — LangSmith authoritative, local table
is a provisional estimate only. **AD-3** (`:68-72`) — hot path writes the estimate, never blocks on
LangSmith; unknown model → NULL. **AD-6** (`:86-90`) — tracing-off keeps the estimate; no
`langsmith_run_id`. Plus the **writer half of AD-8** (`:98-102`) — the write never overwrites a
reconciled (`false`) row; and **AD-9** (`:104-108`) — fan-out parents / code runs are `$0`-terminal,
never estimated.

## Acceptance Criteria

1. **AC1 — `pricing.py` is retained but DEMOTED to the provisional-estimate role (AD-1) — documentation,
   not a logic rewrite.** `app/core/pricing.py`'s module docstring and `compute_cost_usd`'s docstring are
   updated to state that its output is a **provisional estimate**, approximate and **always reconcilable**;
   that **LangSmith `total_cost` is the authoritative cost** (reconciled in by Story 17-8); and that this
   table is a placeholder, not a competing source of truth. **The rate table (`_MODEL_PRICING_PER_MTOK` /
   `_MODEL_PRICING`) and the `compute_cost_usd` computation stay functionally unchanged** — same
   keyword-only signature, same `Decimal | None` return, same unknown-model→`None` (never a fallback
   price). It is **not deleted, not gutted, and not made the source of truth.** (Its two callers —
   `execution_tasks._extract_cost_fields` and `skills._adapter_cost_usd` — must keep working byte-for-byte
   at their call sites.)

2. **AC2 — At completion the worker writes the provisional estimate WITH `cost_is_estimated=true` for LLM
   runtimes (AD-3).** For a leaf **LLM-using** invocation (`runtime` in `_LLM_USING_RUNTIMES` —
   `prompt`/`hybrid`/`code_driven_hybrid`), the completed/blocked `InvocationResult` is persisted with:
   `input_tokens`, `output_tokens`, `model`, `langsmith_run_id` (all already wired), the provisional
   `cost_usd` from `compute_cost_usd` (already wired), **and now `cost_is_estimated=true`**. This holds
   whether the estimate is a real number OR `NULL` (unknown model / unpriceable partial report) — a NULL
   cost on an LLM run is still an estimate state (reconcilable later), never `false`. The write must not
   wait for or read LangSmith cost inline (it already doesn't — no change to that property).

3. **AC3 — The write never overwrites a reconciled (`false`) row (writer half of AD-8) — satisfied
   structurally by the existing fresh-INSERT + terminal-guard.** The completion write is a **fresh INSERT**
   of a new `InvocationResult`, guarded by `_guard_not_terminal` (`job_service.py:555,603`): a
   re-delivered/retried task on an already-terminal job **skips entirely** (no second insert). Because the
   estimate write is always the row's *first* write and never UPDATEs a pre-existing row, it **cannot**
   clobber a reconciled row (the 17-8 reconciler is the only thing that ever UPDATEs the row to
   `false`, and only *after* the estimate commits). **Do NOT introduce an `ON CONFLICT`/upsert** — the
   fresh-insert-with-terminal-guard IS the guard; adding an upsert would be reinventing an idempotency
   mechanism the codebase already has (and could race the reconciler). A test must assert a
   redelivered `mark_completed` on a terminal job does not write a second row / does not flip an existing
   `false` back to `true`.

4. **AC4 — Tracing-off (AD-6): tokens + estimate + `cost_is_estimated=true` still written; no
   `langsmith_run_id`; job succeeds offline.** With `LANGSMITH_TRACING` off/unset, the LLM-runtime row is
   still written with the estimate and `cost_is_estimated=true`, `langsmith_run_id` stays `None` (17-6's
   `get_current_run_tree()`-None discriminator, unchanged), and the invocation completes exactly as today.
   **The test env runs `LANGSMITH_TRACING=false` — this path must not break.**

5. **AC5 — Genuine `code` / fan-out-parent rows unchanged: `cost_usd=0, cost_is_estimated=false`, never
   estimated (AD-1, AD-9).** A genuine no-LLM `code` run and a fan-out parent roll-up
   (`aggregate_results`, `execution_tasks.py:699-713`) keep `cost_usd=Decimal("0")` **and**
   `cost_is_estimated=false` (`0` is a "nothing to price" constant, authoritative-terminal, never a
   provisional estimate). These rows are never assigned a `langsmith_run_id` and are never reconciled.
   The discriminator is the existing `_LLM_USING_RUNTIMES` gate in `_extract_cost_fields` — the same
   branch that already decides `cost_usd = None` (LLM) vs `Decimal("0")` (code/fan-out) now also decides
   `cost_is_estimated = true` vs `false`.

6. **AC6 — Gates green; `SUM(cost_usd)` analytics still returns numbers (now estimates until
   reconciled).** `ruff check .` clean repo-wide; the affected unit + integration suites pass (see
   Testing); the analytics read path (`analytics_service` per-skill/per-user/overview SUMs) and the
   `jobs.py` list/detail cost responses **continue to return numbers unchanged** (they are NULL-safe and
   do not filter on `cost_is_estimated` — verified; a value that is now an estimate serializes
   identically). `python scripts/export_openapi.py` → **zero** `docs/api-spec.json` diff (this story adds
   no HTTP schema — `cost_is_estimated` exposure is Story 17-9's AC, not here).

## Tasks / Subtasks

- [ ] **Task 1 — Demote `pricing.py` to the provisional-estimate role (documentation only)** (AC: 1)
  - [ ] In `app/core/pricing.py`, update the **module docstring** (`:1-16`) to state: this table produces
        a **provisional estimate only**, approximate and **always reconcilable**; **LangSmith `total_cost`
        is the authoritative per-run cost** (reconciled in by Story 17-8's deferred reconciler); the local
        table is a placeholder for instant Run-Console UX, not a competing source of truth. Reference
        AD-1. Keep the existing "unrecognized model → `None`, never a fallback" paragraph (still true and
        still important).
  - [ ] Update `compute_cost_usd`'s docstring (`:74-82`) to call its return an **estimate** (provisional,
        subject to reconciliation), not "the cost". **Do NOT change the signature, the `Decimal | None`
        return, the unknown-model→`None` branch, the `_MODEL_PRICING`/`_MODEL_PRICING_PER_MTOK` tables, or
        the exact-Decimal computation.** This is a rename-of-intent in prose, not a behavior change — its
        two callers must keep working with zero call-site edits.
  - [ ] Do **not** touch the second caller `app/api/v1/skills.py::_adapter_cost_usd` (`:76-97`) — the
        adapter-propose audit cost is a separate surface (JSONB audit metadata, not `InvocationResult`);
        it stays as-is. (Its provisional/estimate nature is inherited from `compute_cost_usd`'s reframed
        docstring; no code change.)
- [ ] **Task 2 — Return `cost_is_estimated` from `_extract_cost_fields`** (AC: 2, 4, 5)
  - [ ] In `app/workers/execution_tasks.py`, extend `_extract_cost_fields` (`:137-192`) so its returned
        dict gains a `"cost_is_estimated"` key alongside the existing four
        (`input_tokens`/`output_tokens`/`model`/`cost_usd`). The value is decided by the **same
        LLM-vs-not discriminator already in the function**:
        - **No token keys branch** (`:164-173`): `cost_is_estimated = True` when
          `runtime in _LLM_USING_RUNTIMES` (this is the LLM-ran-but-reported-nothing → `cost_usd=None`
          case — a NULL *estimate*, AC2), else `False` (genuine `code` run / fan-out parent → `cost_usd=0`,
          AC5). It is the exact same predicate that already sets `cost_when_absent`.
        - **Incomplete report branch** (`:177-182`, `cost_usd=None`): `cost_is_estimated = True` — token
          keys are present (evidence of LLM usage), so this is an LLM row with a NULL estimate.
        - **Full report branch** (`:183-186`, `cost_usd=compute_cost_usd(...)`): `cost_is_estimated =
          True` — a priced (or unknown-model→NULL) LLM estimate.
        In short: **`cost_is_estimated` mirrors "is this an LLM-using runtime row?"** — `True` for every
        prompt/hybrid/code_driven_hybrid leaf row (priced, NULL-unknown-model, or NULL-partial), `False`
        only for the genuine `code`/fan-out-parent `Decimal("0")` case. Update the function docstring
        (`:138-161`) to document the new key and the AD-5 state it encodes.
  - [ ] Because `_extract_cost_fields`'s result is splatted as `**cost_fields` into `mark_completed`
        (`:419`), `mark_blocked` (`:393`), AND the fan-out parent `mark_completed`
        (`:711`, via `**_extract_cost_fields(result_metadata)`), the new key flows to all three write
        sites automatically once `mark_completed`/`mark_blocked` accept it (Task 3). Verify the fan-out
        splat now carries `cost_is_estimated=False` (its summary has no token keys and its runtime is not
        in `_LLM_USING_RUNTIMES` → the `False` branch — AC5).
- [ ] **Task 3 — Accept + persist `cost_is_estimated` in `mark_completed`/`mark_blocked`** (AC: 2, 3, 5)
  - [ ] In `app/services/job_service.py`, add `cost_is_estimated: bool = False` as a new keyword arg to
        **both** `mark_completed` (`:525-537`) and `mark_blocked` (`:579-591`), and map it onto the
        `InvocationResult(...)` construction at both sites (`:557-567`, `:605-615`). **Default `False`**
        preserves back-compat for any caller that doesn't pass it (mirrors the additive
        `output_sha256`/`langsmith_run_id`/cost-column contract exactly — see their docstring notes at
        `:540-553,598-601`). Document the new kwarg in both docstrings as the AD-5 estimate flag: `True`
        = provisional (from the estimate hot path, subject to 17-8 reconciliation); `False` = genuine
        `$0`/authoritative.
  - [ ] Keep the write a **fresh INSERT under the existing `_guard_not_terminal`** — do NOT add an
        `ON CONFLICT`/`.merge()`/UPDATE-existing path (AC3). The terminal guard (`:555`, `:603`) already
        makes a re-delivered task a no-op that never writes a second row and never touches an existing
        row, so a reconciled (`false`) row can never be regressed by this write.
- [ ] **Task 4 — Confirm the read/exposure surfaces are untouched and still return numbers** (AC: 6)
  - [ ] Do **not** modify `app/services/analytics_service.py` (the three
        `func.coalesce(func.sum(InvocationResult.cost_usd), 0)` SUMs at `:137,182,260`), `app/api/v1/jobs.py`
        (`:157` list, `:309` detail), `app/api/v1/client.py` (`:240`, already drops cost), or any `schemas/`.
        They are NULL-safe and estimate-blind — surfacing an estimate value works unchanged. Adding
        `cost_is_estimated` to any response is **Story 17-9**.
  - [ ] Confirm (grep) `cost_is_estimated` has **no reader** anywhere in `app/` after your change except
        the DB write path — i.e. you added the first writer only, no consumer coupling.
- [ ] **Task 5 — Tests** (AC: all)
  - [ ] **`_extract_cost_fields`** — add per-branch unit assertions in `tests/unit/workers/test_execution_tasks.py`.
        **⚠️ These are NET-NEW: there is no existing `_extract_cost_fields`/`TestExtractCostFields` unit
        test in that file today** (the current `_extract_cost_fields` coverage is indirect, in
        `tests/integration/workers/test_execution_tasks.py` via the splat write-path, and a direct import
        in `tests/integration/api/test_invocations.py:1282`). Add a focused unit class (import
        `_extract_cost_fields` + `_LLM_USING_RUNTIMES` from `app.workers.execution_tasks`). Assert the
        returned dict now includes `cost_is_estimated`, and its value for each branch: (a) full
        prompt/hybrid report → `True` (priced, cost non-None); (b) unknown model → `True` with
        `cost_usd=None`; (c) LLM runtime, no token keys → `True`, `cost_usd=None`; (d) incomplete report
        (model present, a count missing) → `True`, `cost_usd=None`; (e) genuine `code` run (runtime not in
        `_LLM_USING_RUNTIMES`, no tokens) → `False`, `cost_usd=Decimal("0")`; (f) fan-out parent summary
        shape → `False`, `cost_usd=0`. (No existing test asserts an exact-4-key dict equality on this
        function's output — verified — so adding the 5th key is safe.)
  - [ ] **`job_service`** — extend `tests/unit/services/test_job_service.py` (the `TestInvocationResultCostColumns`
        class, `:244`): assert `mark_completed`/`mark_blocked` persist a passed `cost_is_estimated=True`
        onto `InvocationResult`, and default it to `False` when omitted (back-compat). **⚠️ Do NOT add
        `cost_is_estimated` to the existing `test_mark_completed_and_mark_blocked_accept_cost_kwargs` loop
        (`:266-279`) — that test asserts every listed kwarg has `default is None`, but `cost_is_estimated`
        correctly defaults to `False` (not `None`, per AD-9). Add a separate assertion for it.**
  - [ ] **Guarded write / idempotency (AC3)** — add a test that calling `mark_completed` on an
        already-terminal job is a no-op: no second `InvocationResult` inserted, and an existing row's
        `cost_is_estimated` (e.g. a reconciled `False`) is NOT flipped back to `True`. (Leverage the
        `_guard_not_terminal` behavior; the unique constraint `uq_invocation_results_invocation_job_id`
        also backstops a double insert.)
  - [ ] **Integration (DB-backed)** — extend `tests/integration/workers/test_execution_tasks.py`: a
        completed prompt/hybrid run persists `cost_is_estimated=True` (with a real `cost_usd`); an
        unknown-model LLM run persists `cost_is_estimated=True` with `cost_usd IS NULL`; a genuine `code`
        run and the fan-out parent persist `cost_is_estimated=False` with `cost_usd=0`. Tracing-off (the
        default test-env state) still writes the estimate + `True` and `langsmith_run_id IS NULL` (AC4).
  - [ ] **Analytics still returns numbers (AC6)** — a light assertion (unit or integration) that an
        analytics SUM over rows that are now `cost_is_estimated=True` still returns the summed dollar
        figure (no filter drops estimate rows). If an existing analytics test already covers the SUM,
        confirm it stays green with estimate rows present rather than adding a redundant one.
  - [ ] `ruff check .` clean; run the affected unit + integration suites; `python scripts/export_openapi.py`
        → zero `docs/api-spec.json` diff (AC6).

## Dev Notes

### Governing invariants (verbatim intent)

- **AD-1** (`ARCHITECTURE-SPINE.md:56-60`): "LangSmith's `total_cost` is the **final, authoritative**
  cost. `app/core/pricing.py` is **retained but demoted** to producing a provisional *estimate*
  (`compute_cost_usd`), used only until reconciliation overwrites it. … LangSmith does not expose its
  rate map (verified), so the estimate uses our own slimmed table — kept minimal and understood to be
  approximate. (Non-LLM `code`-runtime rows keep explicit `cost_usd = 0` … `cost_is_estimated = false`,
  never routed through either path.)"
- **AD-3** (`:68-72`): "At completion the worker persists `input_tokens`, `output_tokens`, `model`,
  `langsmith_run_id`, and a **provisional** `cost_usd` from the local estimate with `cost_is_estimated =
  true`. It must not wait for or read LangSmith cost inline. If the model is unknown to the local table,
  `cost_usd = NULL` (still reconcilable later)."
- **AD-6** (`:86-90`): "With tracing disabled, tokens + the local **estimate** are still written
  (`cost_is_estimated = true`), and no `langsmith_run_id` is set … Job execution succeeds regardless of
  LangSmith availability."
- **AD-8 (writer half)** (`:98-102`): "The estimate write is a **guarded upsert**: it sets
  `cost_is_estimated = true` only when the row is absent or already estimated — it must never overwrite a
  reconciled (`false`) row." — In THIS codebase the "guarded upsert" is realized by the existing
  fresh-INSERT + `_guard_not_terminal` (the row is only ever written once, at the terminal transition;
  a redelivery skips). See AC3 for why an explicit `ON CONFLICT` is neither needed nor wanted.
- **AD-9** (`:104-108`): "`fan_out = true` parent rows keep `cost_usd = 0`, `cost_is_estimated = false`,
  are never assigned a trace, and are never reconciled … Genuine `code` runs are likewise `0`-terminal."

### ⭐ The key ground-truth that shapes this story

**`pricing.py` is already exactly what the estimate role needs — the "slim" in the story title is a
documentation reframe, not a logic rewrite.** The spine's Structural Seed line (`:162`) says "retained
but slimmed to the estimate role." The current file (`app/core/pricing.py`, 93 lines) is already:
minimal (one table, one function), returns a `Decimal | None`, returns `None` (never a fallback price)
for an unknown model, and does exact-Decimal math. That IS the provisional-estimate contract. **Rewriting
or gutting it would (a) break its two working callers, (b) reinvent a correct wheel, and (c) risk
re-introducing the fabricated-$0/fallback-price bug class the file's own docstring warns against.** So
Task 1 is prose only. The behavioral work of this story is the **`cost_is_estimated` flag**, which does
not exist as an application write today.

**`cost_is_estimated` has zero writers and zero readers today.** Verified: the column
(`models/invocation.py:217-219`, `Boolean NOT NULL server_default=text("false")`) is written by nobody —
`mark_completed`/`mark_blocked` construct `InvocationResult` without it, relying on the DB default; and no
code reads it (grep across `app/` finds it only in the model + migration 0031). This story wires the
**first writer** (`cost_is_estimated=true` for LLM estimate rows). The first *reader* is Story 17-9
(API exposure) and the reconciler 17-8 (the only *flip to `false`* for LLM rows). Do not add a reader.

### The exact edit surface (verified against baseline b3e3dda via full call-site sweep)

| File | Change |
| --- | --- |
| `app/core/pricing.py` | **Docstring only.** Module docstring (`:1-16`) + `compute_cost_usd` docstring (`:74-82`): reframe as a **provisional estimate** (approximate, always reconcilable; LangSmith authoritative via 17-8). **No change** to `_MODEL_PRICING_PER_MTOK`/`_MODEL_PRICING` (`:38-65`), the `compute_cost_usd` signature/return/unknown-model branch (`:68-92`), or the exact-Decimal math. |
| `app/workers/execution_tasks.py` | `_extract_cost_fields` (`:137-192`): add `"cost_is_estimated"` to the returned dict in all three branches — `True` for LLM-runtime rows (the same `runtime in _LLM_USING_RUNTIMES` predicate at `:167`), `False` for genuine `code`/fan-out `Decimal("0")`. Update the docstring. **No change** to how `cost_usd`/tokens/`langsmith_run_id` are computed or passed. |
| `app/services/job_service.py` | Add `cost_is_estimated: bool = False` kwarg to `mark_completed` (`:525-537`) and `mark_blocked` (`:579-591`); map onto `InvocationResult(...)` at `:557-567` and `:605-615`. Additive, back-compat (mirror `langsmith_run_id`/`output_sha256`). **Keep the fresh-INSERT + `_guard_not_terminal`** — no upsert (AC3). |
| `tests/unit/workers/test_execution_tasks.py` | Assert `_extract_cost_fields` returns the new key with the right value per branch (priced/unknown/absent/partial → `True`; code/fan-out → `False`). |
| `tests/unit/services/test_job_service.py` | Assert `mark_completed`/`mark_blocked` persist a passed `cost_is_estimated`; default `False`; redelivery-on-terminal doesn't flip an existing row (AC3). |
| `tests/integration/workers/test_execution_tasks.py` | DB-backed: LLM run → `True` (+ real cost / NULL-unknown-model); code + fan-out parent → `False`, `cost_usd=0`; tracing-off still writes `True` + `langsmith_run_id NULL`. |

**Do NOT touch (orthogonal — verified):** the `wrap_anthropic` seam (`app/integrations/anthropic_client.py`,
17-5), the sandbox shim (`app/services/sandbox_assets/velara_trace.py`, 17-5/17-6 — it reports
tokens+model only; the worker prices, so no shim change), the trace-open / `langsmith_run_id` capture &
propagation (`execution_tasks.py:353-356`, `code_driven_executor.py` header injection, 17-6), any
`Client.list_runs`/`total_cost` read or Celery reconciler (17-8), the analytics SUMs
(`analytics_service.py:137,182,260`), the `jobs.py`/`client.py` cost responses and all `schemas/` (17-9),
and any migration (columns exist from 17-4).

### How the write path works today (so you extend it, not rebuild it)

1. `run_skill._execute` (`execution_tasks.py:344-367`) opens the ONE invocation trace (17-6),
   runs `execution_service.execute_skill(...)`, and captures `langsmith_run_id`
   (`:356`, `None` when tracing off).
2. `cost_fields = _extract_cost_fields(result_metadata)` (`:374`) — this computes `cost_usd` fresh from
   the envelope's `model`/`input_tokens`/`output_tokens` via `compute_cost_usd`, or `None`/`Decimal("0")`
   by the runtime discriminator. **This is where you add `cost_is_estimated`.**
3. `mark_completed(..., langsmith_run_id=langsmith_run_id, **cost_fields)` (`:412-420`) / `mark_blocked`
   (`:386-394`) — fresh-INSERT the `InvocationResult` under `_guard_not_terminal`. **This is where you
   accept + persist the new kwarg.**
4. Fan-out parent roll-up (`aggregate_results`, `:699-713`) calls
   `mark_completed(..., **_extract_cost_fields(result_metadata))` — no token keys in the summary →
   `_extract_cost_fields` yields `cost_usd=Decimal("0")` AND (after your change) `cost_is_estimated=False`
   → parent stays `$0`-authoritative, no `langsmith_run_id` (it isn't passed there — AD-9). ✅

The code-driven-hybrid sandbox path needs **no change**: `velara_trace.totals()` returns
`{input_tokens, output_tokens, model}` only (no cost); `code_driven_executor` threads those to
`result_metadata` top-level (`:860-875`); the worker's `_extract_cost_fields` prices them exactly like
prompt/hybrid — so your `cost_is_estimated=True` (runtime `code_driven_hybrid` ∈ `_LLM_USING_RUNTIMES`)
flows through the same seam. (Story 15.5's `reports_usage` contract and the NULL-not-$0 rule are
unchanged.)

### Why AD-8's "guarded upsert" is already satisfied (do not over-engineer AC3)

The spine's AD-8 (`:98-102`) prescribes a "guarded upsert … never overwrites a reconciled (`false`)
row." That invariant is written to bind BOTH writers (estimate + reconciler). In this codebase the
estimate writer is a **fresh INSERT** performed once, at the running→completed/blocked transition, under
`_guard_not_terminal` (`job_service.py:493-510`): a redelivered/retried Celery task on a terminal job
logs `job_transition_skipped_terminal` and returns without inserting (`:502`). Combined with the unique
constraint `uq_invocation_results_invocation_job_id` (`models/invocation.py:242-244`, one row per job),
the estimate write **structurally cannot touch a pre-existing row** — so it cannot regress a reconciled
`false` back to `true`. The reconciler (17-8) is the compare-and-set writer that flips `true→false`, and
it runs only *after* the estimate row commits (AD-8 enqueue-after-commit). **Therefore: do NOT add an
`INSERT … ON CONFLICT DO UPDATE` here.** It would be redundant, and a naive one could race the 17-8
reconciler. AC3's test asserts the existing guard holds; it does not ask you to build a new one.

### langsmith / SDK facts relevant here

- **No LangSmith call in this story.** The hot path already captures `langsmith_run_id` (17-6) via
  `get_current_run_tree()` inside the one `trace(...)` block; you neither open a trace nor read cost.
  `langsmith==0.10.10` is pinned (`pyproject.toml:34`); no new dependency, no version concern.
- **`get_current_run_tree()` is the tracing-on/off discriminator** (returns `None` when off,
  `_internal/_context.py:27-29`) — already used at `execution_tasks.py:356` to leave `langsmith_run_id`
  NULL when off. AC4 depends on that existing behavior; you don't change it, you just confirm the
  estimate + `cost_is_estimated=true` are still written in the off case.

### Previous story intelligence (17-4/17-5/17-6, all done — build on them, don't redo)

- **17-4** (`fe35ce2`) added the `langsmith_run_id` + `cost_is_estimated` columns (migration 0031) with
  `server_default=false`. Its story note is explicit: "The app-level write default of true for freshly-
  estimated rows is wired by Story 17.7, not here." **That is this story.** No migration here.
- **17-5** (`fa1e96b`) routed every Anthropic client through `wrap_anthropic` and slimmed the sandbox
  shim to a usage-only accumulator (`totals()` = tokens+model, no cost). **Do not touch it.**
- **17-6** (`b3e3dda`, your baseline) opened the ONE invocation trace, captured `trace_id`, and added
  `langsmith_run_id` as a separate kwarg on `mark_completed`/`mark_blocked` (the additive pattern you
  mirror for `cost_is_estimated`). It explicitly deferred the estimate/`cost_is_estimated` write to
  **17-7** and did not touch `pricing.py`/`_extract_cost_fields`'s cost logic. So the completion write
  is already shaped for one more additive kwarg.
- **Recurring bug class in this project ([Memory: project-story-15-5-review], Epic 15 reviews):**
  *partial-usage None-as-present-key fabricates $0.* `_extract_cost_fields` already defends this (NULL,
  not $0, for LLM runs with missing/partial usage — `:164-186`). Your `cost_is_estimated` must ride the
  SAME predicate: a NULL-cost LLM row is still `cost_is_estimated=True` (an estimate that couldn't be
  priced), NOT `False`. Do not accidentally set `False` on any LLM row — `False` is reserved for genuine
  `$0` code/fan-out rows and (later) reconciled LLM rows.

### Testing

- **Framework:** pytest. Unit under `tests/unit/`; integration under `tests/integration/` (Postgres-gated).
  Per [Memory: project-velara-api-container-test-env]: the `api` container runs `AUTH_BACKEND=cognito` via
  its `.env`; run integration tests with `set -a; . ./.env.test` against a freshly-recreated clean
  `velara_test` (recreate the DB before trusting a full run — no-time-window audit-count tests fail on a
  polluted DB). **The test env runs `LANGSMITH_TRACING=false`** — AC4's tracing-off path is the default
  there; assert `cost_is_estimated=True` still lands and `langsmith_run_id IS NULL`.
- **CRITICAL [Memory: project-container-stale-baked-test-file]:** the `api`/`worker` containers **bake
  source into the image — there is NO bind mount.** After editing any file, `docker cp` it into the
  container (or rebuild) BEFORE running in-container pytest, and verify the container actually has your
  change (grep a new symbol / compare line counts) — otherwise `pytest` runs the stale baked copy and
  "passes" against old code. This bit Stories 17.4/17.5/17.6. Rebuilds fill VM disk —
  `docker builder prune -a -f` first if rebuilding.
- **Pre-existing container-env failure to expect, not fix:** `test_config.py::test_default_value_is_false`
  fails in the `api` container because its `.env` leaks `LANGSMITH_TRACING=true`/`LANGSMITH_TRACE_CONTENT=true`
  into process env (documented in 17.4/17.5/17.6). `config.py`/its test are untouched by this diff
  (confirm empty `git diff --stat` for `config.py`) — it is not your regression.
- **What to assert:** unit — `_extract_cost_fields` per-branch flag values; `mark_completed`/`mark_blocked`
  persist + default the kwarg; redelivery-on-terminal is a guarded no-op (AC3). Integration — DB-backed
  LLM/code/fan-out/unknown-model/tracing-off shapes. Read-path — analytics SUM still returns the dollar
  figure with estimate rows present (AC6).
- **Gates:** `ruff check .` clean; affected unit + integration suites green; `python
  scripts/export_openapi.py` → zero `docs/api-spec.json` diff (run with `PYTHONPATH=/app` in-container per
  17.4's note; if the container's baked image predates already-`done` routes, diff a clean pre/post-17.7
  in-container regeneration against each other rather than the tracked file — see 17.6 Debug Log for the
  methodology).

### Project Structure Notes

- Pricing seam: `app/core/pricing.py` — the ONE pricing table (Story 15.1); two callers
  (`execution_tasks._extract_cost_fields`, `skills._adapter_cost_usd`). This story reframes its docs; the
  table stays.
- Write-path seam: `app/workers/execution_tasks.py` (`_extract_cost_fields` → `run_skill._execute` →
  `mark_completed`/`mark_blocked`) and `app/services/job_service.py` (the `InvocationResult` insert under
  `_guard_not_terminal`). The additive-kwarg pattern (`output_sha256` 17-3, `langsmith_run_id` 17-6) is
  the template for `cost_is_estimated`.
- Persistence: `app/models/invocation.py` `InvocationResult.cost_is_estimated` (`:217-219`) already exists
  (17-4) — no model change, no migration.
- Read/exposure surfaces (untouched here; 17-9 territory): `app/services/analytics_service.py`
  (`:137,182,260`), `app/api/v1/jobs.py` (`:157,309`), `app/api/v1/client.py` (`:240`, drops cost),
  `schemas/job.py`/`schemas/analytics.py`.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-1] `:56-60` — LangSmith authoritative; `pricing.py` demoted to a
  provisional estimate (governing; keep the table, reframe the docs).
- [Source: ARCHITECTURE-SPINE.md#AD-3] `:68-72` — hot path writes tokens+model+trace_id+estimate with
  `cost_is_estimated=true`; never blocks on LangSmith; unknown model → NULL.
- [Source: ARCHITECTURE-SPINE.md#AD-6] `:86-90` — tracing-off keeps the estimate + `cost_is_estimated=true`;
  no `langsmith_run_id`.
- [Source: ARCHITECTURE-SPINE.md#AD-8] `:98-102` — the WRITER-half guard (never overwrite a reconciled
  row); satisfied structurally by the fresh-INSERT + terminal-guard here (do not add an upsert).
- [Source: ARCHITECTURE-SPINE.md#AD-9] `:104-108` — fan-out parents / code runs are `$0`-terminal,
  `cost_is_estimated=false`, never estimated/reconciled.
- [Source: ARCHITECTURE-SPINE.md#Structural-Seed] `:156-163` — `pricing.py` "retained but slimmed to the
  estimate role"; callers write estimate + `is_estimated` at completion; sandbox shim already collapsed
  (17-5) — no shim change here.
- [Source: velara-api/app/core/pricing.py] `:1-16` module docstring (reframe); `:38-65` rate tables (keep);
  `:68-92` `compute_cost_usd` (keep logic; reframe docstring `:74-82`).
- [Source: velara-api/app/workers/execution_tasks.py] `:105-134` token keys + `_LLM_USING_RUNTIMES`;
  `:137-192` `_extract_cost_fields` (add `cost_is_estimated`); `:344-367` trace + `langsmith_run_id`
  capture (17-6, untouched); `:374` cost_fields; `:386-394` `mark_blocked` call; `:412-420` `mark_completed`
  call; `:699-713` fan-out parent roll-up (`cost_is_estimated=False`).
- [Source: velara-api/app/services/job_service.py] `:493-510` `_guard_not_terminal` (the AC3 idempotency
  guard); `:525-576` `mark_completed`; `:579-624` `mark_blocked` — add `cost_is_estimated` kwarg + map to
  `InvocationResult`; keep fresh-INSERT.
- [Source: velara-api/app/models/invocation.py] `:196-219` cost columns incl. `cost_is_estimated`
  (`:217-219`, server_default false; the AD-5 state comment `:204-215` says 17.7 wires the write-default
  true); `:242-244` unique constraint (one row per job — backstops double insert).
- [Source: velara-api/app/services/analytics_service.py] `:137,182,260` `SUM(cost_usd)` COALESCE'd,
  estimate-blind — must keep returning numbers (AC6); do not modify (17-9).
- [Source: velara-api/app/api/v1/jobs.py] `:157` list `cost_usd`, `:309` detail `cost_usd` — pass-through,
  estimate serializes identically; do not modify (17-9).
- [Source: velara-api/app/services/sandbox_assets/velara_trace.py] `totals()` `:384-397` — tokens+model
  only, no cost (worker prices); no change here.
- [Source: velara-api/app/services/code_driven_executor.py] `:860-875` — threads sandbox usage
  (input/output/model) to `result_metadata`; the worker prices via `_extract_cost_fields`; no change here.
- [Source: _bmad-output/implementation-artifacts/stories/17-6-invocation-scoped-trace-sandbox-header-propagation.md]
  — the trace / `langsmith_run_id` write (done); the additive-kwarg pattern to mirror; the 17-6/17-7 boundary.
- [Source: _bmad-output/implementation-artifacts/stories/17-8-deferred-cost-reconciler-task.md] — the
  reconciler that flips `cost_is_estimated true→false` and reads `total_cost`; the boundary 17-7 must not cross.
- [Source: _bmad-output/implementation-artifacts/stories/17-4-cost-tracking-schema-run-id-and-estimated-flag.md]
  — the migration/columns (done); its explicit "17.7 wires the write-default true" hand-off.
- [Memory: project-story-15-5-review] — partial-usage None-as-present-key fabricates $0 is the recurring
  bug class; a NULL-cost LLM row is still an ESTIMATE (`cost_is_estimated=True`), never $0/`False`.
- [Memory: project-container-stale-baked-test-file] — `api`/`worker` containers bake source; `docker cp`
  + verify before trusting in-container pytest.
- [Memory: project-velara-api-container-test-env] — `.env.test` + clean `velara_test` for integration
  tests; test env runs `LANGSMITH_TRACING=false` (AC4's default path there).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-07-30: Story drafted from STUB by create-story. Governing AD-1/AD-3/AD-6 (+ AD-8 writer half,
  AD-9). Edit surface, pricing.py current state, the completion write path, the sandbox cost seam, and
  all `cost_usd`/`cost_is_estimated` consumers verified against LIVE source at baseline b3e3dda
  (post-17.6) via three parallel call-site sweeps. Two ground-truth corrections folded into scope: (1)
  `pricing.py` is ALREADY minimal/correct for the estimate role — "slim/demote" is a documentation
  reframe, NOT a rewrite (rewriting would break its two callers and reinvent a working, correctness-
  hardened wheel); (2) the completion write is a fresh INSERT under `_guard_not_terminal` (one row per
  job, no UPDATE-existing path) — AD-8's "never overwrite a reconciled row" is satisfied STRUCTURALLY, so
  NO `ON CONFLICT` upsert (which could race the 17-8 reconciler). `cost_is_estimated` has zero writers
  (relies on server_default false) and zero readers today; this story wires the FIRST writer only.
  Reconciler read / flip-to-false held for 17-8; API exposure held for 17-9; no migration (columns from 17-4).
- 2026-07-30: Independent fresh-context validation pass (read-only, against live source b3e3dda) —
  no CRITICAL issues; all load-bearing scope claims confirmed: (1) the completion write is the only
  `InvocationResult(...)` constructor pair (`job_service.py:557,605`), no UPDATE/merge/upsert/on_conflict
  anywhere → AC3's "fresh-insert + terminal-guard, no ON CONFLICT" reasoning is sound; (2)
  `cost_is_estimated` has zero app writers/readers (only model + migration 0031 + its migration test) →
  first writer confirmed; (3) `_extract_cost_fields`'s `runtime in _LLM_USING_RUNTIMES` predicate (`:167`)
  cleanly drives the flag; the fan-out parent flows through `**_extract_cost_fields` (no `0` literal, no
  langsmith_run_id). Two test-guidance corrections folded in: the per-branch `_extract_cost_fields` unit
  tests are NET-NEW (no such unit test exists in the named file; current coverage is integration-only),
  and the dev must NOT extend `test_job_service.py:266-279`'s `default is None` loop with the
  `False`-defaulting `cost_is_estimated` kwarg. Model-column citation corrected to `:216`
  (langsmith_run_id) / `:217-219` (cost_is_estimated).
