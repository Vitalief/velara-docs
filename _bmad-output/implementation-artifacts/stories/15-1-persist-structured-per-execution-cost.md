---
baseline_commit: d212b34 (velara-api) / 3372772 (velara-web)
---

# Story 15.1: Persist Structured Per-Execution Cost at Write Time

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform operator,
I want every completed invocation to record its own token counts and computed dollar cost as structured, queryable data,
so that cost is a permanent fact about that specific execution, not something re-derived later from an opaque JSONB blob.

**Why this is the right shape (verified in source, not assumed):** The raw inputs already exist. `_run_prompt` (`execution_service.py:516-525`) and `_run_hybrid` (`execution_service.py:1040-1049`) already compute `model`/`input_tokens`/`output_tokens` into `runtime_metadata`; `_run_code` (`execution_service.py:682-687`) has none (nothing to price). All this data reaches the write path as `result_metadata`, and `execution_tasks.py` **already** has a helper that isolates exactly these keys (`_extract_token_metadata` / `_TOKEN_METADATA_KEYS`, `execution_tasks.py:103-114`) for the audit entry. The only new work is: (1) add four columns, (2) relocate the pricing table so the execution path can import it, (3) compute `cost_usd` at the confirmed write-path seam and thread all four fields into the `InvocationResult` row `mark_completed`/`mark_blocked` already write. No LLM-call-site change; no new query surface (that is 15.2/15.3).

**This is a backend-only story (velara-api).** No FE change, no `docs/api-spec.json` change (the new columns are not exposed on any response schema yet — that is Story 15.2/15.3), and no new audit event type / guard-registry change.

## Acceptance Criteria

1. **AC1 — Structured columns exist.**
   **Given** the `invocation_results` table at head `0023_skill_version_egress`
   **When** the new migration is applied
   **Then** `invocation_results` gains four **additive, nullable** columns: `input_tokens` (Integer, nullable), `output_tokens` (Integer, nullable), `model` (String, nullable), and `cost_usd` (Numeric, nullable). The migration is chained off the verified current head `0023_skill_version_egress`, follows the Story 14.1 additive-nullable-column precedent (`0023`) for a live-table-safe change, and `downgrade()` drops all four columns. No index (there is no cost/token query surface in this story; 15.2/15.3 read by `invocation_job_id`, already the unique-index lookup).

2. **AC2 — Cost is computed and stored at execution time, not query time.**
   **Given** a prompt or hybrid invocation that completes (or is blocked)
   **When** the Celery task writes the `InvocationResult` row
   **Then** `input_tokens`, `output_tokens`, `model`, and a computed `cost_usd` are persisted onto that row — computed **once, at write time**, from the `result_metadata`'s `model`/`input_tokens`/`output_tokens`, at the confirmed seam in `execution_tasks.py` right after `execute_skill()` returns `(output_file_key, result_metadata)` and before the blocked-check / `mark_completed` / `mark_blocked` calls. `result_metadata` (the existing JSONB blob) is still written unchanged alongside the new structured columns — the columns are additive, not a replacement.

3. **AC3 — The pricing table has one source of truth.**
   **Given** `_MODEL_PRICING` today lives only in `analytics_service.py:37-43`
   **When** this story lands
   **Then** the pricing map + the token→USD computation move into a **new shared module** (`app/core/pricing.py`) importable by both the execution write path (this story) and the analytics read path (unchanged in behavior here; 15.3 rewires it), with **no duplicated per-model rate data anywhere**. `analytics_service.py` imports from the new module instead of defining its own dict. An unrecognized model **logs a warning and yields `cost_usd=NULL`** — it MUST NOT fall back to any other model's price. This deliberately **removes** today's `_DEFAULT_PRICING` silent-fallback (`analytics_service.py:43`); it is a correctness fix, called out here so it is not mistaken for a regression.

4. **AC4 — Every written result row gets an explicit cost, never silent omission.**
   **Given** a **code-runtime** invocation that completes (or is blocked)
   **When** its `InvocationResult` row is written
   **Then** it stores `cost_usd=0` (a real Decimal zero, not NULL), `input_tokens=NULL`, `output_tokens=NULL`, `model=NULL` — there is nothing to price, but the cost is an explicit zero, not an absence. A prompt/hybrid row whose `model` is unrecognized stores `cost_usd=NULL` per AC3 (unknown ≠ zero).
   **Scope note (design decision — read the Dev Note "AC4 and the failed/cancelled row that does not exist"):** `mark_failed`/`mark_cancelled` write **no `InvocationResult` row at all** today (`job_service.py:547-578`) — only completed/blocked jobs get a result row. This story does **not** change that (writing result rows for every failure is an invasive behavior change with real regression surface and is out of scope). AC4's "failed/cancelled invocations get an explicit zero rather than being excluded" outcome is delivered at the **analytics read layer in Story 15.3**, which sums the structured `cost_usd` column and treats absent rows as an explicit `0` (COALESCE), not by fabricating result rows here. 15.1's AC4 is therefore satisfied for **every row this story actually writes** (completed + blocked, all three runtimes).

5. **AC5 — Historical rows are not fabricated.**
   **Given** `invocation_results` rows that existed before this migration
   **When** the migration runs
   **Then** those rows get `NULL` for all four new columns — **no backfill attempt**. Structured token data was never captured before this story (it only ever lived inside `result_metadata`, and even there only for prompt/hybrid), so there is nothing accurate to backfill from. This is a documented approximation matching the project's established backfill-gap precedent (Story 14.1's `0023` egress backfill note). Do **not** attempt to parse historical `result_metadata` JSONB into the new columns.

**Out of scope (do NOT touch):**
- Surfacing any of the new columns on an API response or in the UI — that is **Story 15.2** (`JobResult`/`JobSummary` + Jobs History UI) and **Story 15.3** (analytics per-skill/per-user). No `job.py`/`analytics.py` schema field additions, no FE, no `docs/api-spec.json` regen in this story.
- Rewiring `analytics_service._token_cost()` to read the new column — that is **Story 15.3/AC3**. In 15.1, `analytics_service.py` only changes its **import source** for the pricing table (AC3); its existing JSONB-reading query behavior is otherwise unchanged (still passes its current tests).
- The adapter-propose LLM cost — that is **Story 15.4** (a separate write path on `audit_log_entries`; it will import the same `app/core/pricing.py` this story creates).
- Any change to the LLM call sites (`_run_prompt`/`_run_hybrid`) — they already produce the needed raw data.

## Tasks / Subtasks

- [ ] **Task 1 — Relocate the pricing table into a shared module (AC3)**
  - [ ] Create `velara-api/app/core/pricing.py`. Move `_MODEL_PRICING` (the `{model: (input_usd_per_token, output_usd_per_token)}` map, currently `analytics_service.py:37-40`) here as the single source of truth. Keep the published-rate-card comment (`claude-opus-4-8` = $5/MTok in, $25/MTok out, verified 2026-07-03).
  - [ ] Add a `compute_cost_usd(*, model, input_tokens, output_tokens) -> Decimal | None` function that prices a **known** model from its token counts and returns `None` (after a structured `logger.warning` carrying the model name only — never PHI) for an **unrecognized** `model`. It uses `Decimal` (not float) to match the Numeric column and avoid binary-float drift on money. Note: the code-runtime "no tokens → `Decimal("0")`" case is decided by the caller at the write-path runtime split (Task 3), **not** inside this function — this function only handles the price-a-model computation.
  - [ ] **Delete `_DEFAULT_PRICING` and its silent fallback** (`analytics_service.py:43`). Unknown model → warn + `None`, everywhere (AC3). This is the deliberate behavior change.
  - [ ] Update `analytics_service.py` to `from app.core.pricing import _MODEL_PRICING` (or the public name you choose) instead of defining its own. **Do not** change `_token_cost()`'s query logic in this story (that is 15.3) — only its source of the pricing constants. Confirm its existing tests still pass.

- [ ] **Task 2 — Add the four columns: model + migration (AC1, AC5) — `velara-api`**
  - [ ] Add `input_tokens` (Integer, nullable), `output_tokens` (Integer, nullable), `model` (String, nullable), `cost_usd` (Numeric, nullable) to the `InvocationResult` model (`app/models/invocation.py`, beside `result_metadata`). For `cost_usd`, use `sa.Numeric` mapped to `Decimal` (e.g. `Mapped[Decimal | None]`). Pick a Numeric precision/scale generous enough for USD token cost (e.g. `Numeric(12, 6)` — sub-cent precision; document the choice in a comment).
  - [ ] New Alembic migration `velara-api/app/db/migrations/versions/0024_invocation_cost_tracking.py`, `down_revision = "0023_skill_version_egress"` (verified head — nothing revises 0023). `upgrade()` adds the four columns (all nullable, **no server_default / no backfill** — pre-existing rows stay NULL per AC5); `downgrade()` drops all four. Mirror the `0023` module docstring style: state explicitly that historical rows are intentionally left NULL and why (no structural token data existed pre-migration).
  - [ ] Migration round-trip locally: `alembic upgrade head` (0023→0024) → `alembic downgrade -1` → `alembic upgrade head` again, clean both directions.

- [ ] **Task 3 — Compute + persist cost at the write-path seam (AC2, AC4) — `velara-api/app/workers/execution_tasks.py` + `app/services/job_service.py`**
  - [ ] At the confirmed seam in `execution_tasks.py` (right after `output_file_key, result_metadata = await execution_service.execute_skill(...)` at ~`:256`, before the `is_blocked` check at `:269`), derive the four cost fields from `result_metadata`:
    - Read `model`/`input_tokens`/`output_tokens` from `result_metadata` (reuse/extend the existing `_extract_token_metadata` idiom at `:103-114` rather than re-deriving keys).
    - **Runtime split (AC4):** if this is a **code** runtime (no token keys present in `result_metadata` — equivalently `job_ctx["runtime_type"] == "code"`), set `input_tokens=None`, `output_tokens=None`, `model=None`, `cost_usd=Decimal("0")`. Otherwise (prompt/hybrid) set the token fields from metadata and `cost_usd = compute_cost_usd(...)` (which is `None` for an unknown model, per AC3/AC4).
  - [ ] Thread the four fields into **both** result-writing paths: pass them through `mark_completed` (`job_service.py:490-513`) and `mark_blocked` (`job_service.py:516-544`) as new keyword args, and set them on the `InvocationResult(...)` constructor in each. Keep `result_metadata=` unchanged (columns are additive).
  - [ ] Do **not** touch `mark_failed`/`mark_cancelled` (`job_service.py:547-578`) — they write no result row; AC4's failed/cancelled outcome is a 15.3 read-layer concern (see Dev Note). Do not add a result-row write there in this story.
  - [ ] Confirm the fan-out **child** completed-path (the second `mark_completed` call site, ~`execution_tasks.py:587-591`, per subagent map) also receives the cost fields — a child job is a real completed invocation and must be priced too. Grep for every `mark_completed(`/`mark_blocked(` call site and update all of them.

- [ ] **Task 4 — Tests (AC1-AC5)**
  - [ ] **Unit — `tests/unit/core/test_pricing.py` (new):** `compute_cost_usd` for a known model (assert exact `Decimal` against hand-computed $5/$25-per-MTok math), unknown model → `None` + a warning is logged, and zero/None token inputs behave sanely. Assert `Decimal`, not float.
  - [ ] **Unit — `tests/unit/services/test_job_service.py`:** `mark_completed`/`mark_blocked` persist the four new fields onto the `InvocationResult` row when passed; default to `None`/unset when not passed (back-compat for existing callers/tests).
  - [ ] **Integration — `tests/integration/workers/test_execution_tasks.py`:** prove cost persists **across all three runtimes** through the real task write path — prompt/hybrid → real `cost_usd` + token columns populated; **code → `cost_usd=0`, tokens/model NULL** (AC4); an unknown-model prompt result → `cost_usd=NULL` (AC3/AC4). This is the highest-value regression net — it exercises the exact `execute_skill → mark_completed → InvocationResult` seam this story changes.
  - [ ] **Integration:** re-read the **stored** row from the DB (fresh query, not the in-memory object) and assert the four columns — do not assert only the object the service returned. (Project lesson: "in-memory repair not threaded into the persisted artifact" is a recurring bug class; a test that never re-reads the stored bytes masks it.)
  - [ ] **Analytics regression:** confirm `analytics_service.py`'s existing token-cost tests still pass unchanged after the pricing-table relocation (import-source change only; no query-behavior change in 15.1).

- [ ] **Task 5 — Gates**
  - [ ] Rebuild the api image before running pytest in-container (`docker compose build api`) — the image bakes source; a stale image gives false results (project lesson).
  - [ ] Run pytest with the `AUTH_BACKEND=dev` override (the documented host recipe; `docker-compose.yml` defaults `api` to `cognito`, which 401s Dev-token tests across the whole suite).
  - [ ] Full `tests/integration/workers/test_execution_tasks.py` + `tests/unit/services/test_job_service.py` + new `test_pricing.py` green; then the full repo suite (note any pre-existing unrelated flake, e.g. the documented append-only-DB dedupe re-run sensitivity from 13.4/13.6, so it is not mistaken for a regression).
  - [ ] `ruff check` on all changed files → clean.
  - [ ] Confirm **no `docs/api-spec.json` diff** (`git status`) — no response schema changed in this story.
  - [ ] Confirm **no new audit event type** and the guard registry is untouched.

## Dev Notes

### The seam is already there — this is a thread-through, not a new mechanism

`execution_tasks.py` already isolates the exact token keys you need (`_TOKEN_METADATA_KEYS = ("input_tokens", "output_tokens", "model")`, `_extract_token_metadata`, `:103-114`) to build the audit entry, and already carries `job_ctx["runtime_type"]` at the write path. The natural implementation reuses that helper to get the raw values once, computes `cost_usd` beside it, and passes all four into `mark_completed`/`mark_blocked`. Do not invent a parallel extraction path.

**The confirmed insertion point** (from the change proposal + verified in source): immediately after
```python
output_file_key, result_metadata = await execution_service.execute_skill(...)   # execution_tasks.py:256
```
and **before** `is_blocked = (result_metadata or {}).get("status") == "blocked"` (`:269`) and the `mark_completed`/`mark_blocked` calls (`:301-305` completed, `:278-283` blocked). Compute the four fields once here; pass them to whichever branch fires.

### The discriminator: prompt/hybrid have tokens, code has none

`execute_skill` routes on `skill.runtime_type` (`execution_service.py:372`): `"prompt"`→`_run_prompt`, `"code"`→`_run_code`, `"hybrid"`→`_run_hybrid`. Only prompt/hybrid put `input_tokens`/`output_tokens`/`model` into `result_metadata`; code puts none. Two equivalent ways to tell them apart at the write path — **presence of the token keys in `result_metadata`**, or **`job_ctx["runtime_type"] == "code"`**. Prefer keying on the metadata keys' presence for the None-vs-value decision (it degrades gracefully if a future runtime also lacks tokens), and use `cost_usd = Decimal("0")` specifically for the no-token case. Do not conflate "no tokens (code) → cost 0" with "unknown model (prompt/hybrid) → cost NULL": those are two different AC4/AC3 outcomes.

### AC4 and the failed/cancelled row that does not exist — READ THIS before implementing AC4

The epic-level AC4 says failed/cancelled invocations should "store an explicit `cost_usd=0` rather than leaving the row absent." **In the current architecture there is no row to store it on:** `mark_failed` (`job_service.py:547-568`) and `mark_cancelled` (`:571-578`) update the `invocation_jobs` row only — they never create an `InvocationResult`. Only `mark_completed`/`mark_blocked` write result rows. Making failures write result rows is a real behavior change: it touches the `job.result` one-to-one relationship semantics, the `uq_invocation_results_invocation_job_id` unique constraint, the callers that assume "has a result ⇒ succeeded/blocked", and a spread of existing tests (`test_jobs.py`, `test_artifact_disclosure.py`, `test_invocations.py` all construct/inspect `InvocationResult` on the success assumption). That is out of proportion to this migration story and out of scope.

**Resolution (this story's contract):** 15.1 satisfies AC4 for **every row it writes** — completed + blocked, across all three runtimes (code → explicit `Decimal("0")`; prompt/hybrid known-model → real cost; prompt/hybrid unknown-model → NULL per AC3). The "failed/cancelled rows are an explicit 0, not an invisible exclusion" property is delivered **at the read layer in Story 15.3**, whose `_token_cost` rewrite sums the structured `cost_usd` column and `COALESCE`s missing/absent contributions to `0` — so failed/cancelled jobs (no result row) contribute a *defined* zero to every aggregate rather than being silently dropped. This is called out explicitly in AC4's scope note and again here so a dev does not "fix" AC4 by rewriting `mark_failed`. If a future requirement genuinely needs a per-failure cost row, that is its own story.

### Money is Decimal, not float

`cost_usd` is a `Numeric` column → map it to `Decimal` and compute with `Decimal` end-to-end (`compute_cost_usd` returns `Decimal | None`). The existing analytics `_token_cost` uses float because it produces one display aggregate; a *stored, permanent, per-row* money fact should not carry binary-float drift. Keep the per-token rates as their exact fractions (`5.0 / 1_000_000`) but convert through `Decimal` for the stored value. Pick a Numeric scale (≥6) that preserves sub-cent cost of small runs.

### Pricing-table home: `app/core/pricing.py`

`app/core/` is where `config.py` (with `ANTHROPIC_MODEL = "claude-opus-4-8"`, `:212`) lives and is import-safe from both the service layer (`analytics_service.py`) and the worker/execution layer (`execution_tasks.py` / `execution_service.py`) with no circular-import risk. Do not park pricing inside `analytics_service.py` (the execution path importing the analytics service pulls in the whole read-aggregation surface) or inside `execution_service.py` (analytics importing execution is worse). A small leaf module in `core` is the clean shared home — and it is exactly where Story 15.4 will import the same table from.

### Migration is the one heavyweight — get it right first

Same risk profile as Story 14.1's `0023`: a broken migration fails the entire suite (autouse `alembic upgrade head`) and blocks deploy. `invocation_results` is a live, frequently-written table, so the safety comes from the additive-nullable-column pattern (no rewrite, no lock-heavy default backfill) — copy `0023`'s shape. Unlike `0023`, there is **no backfill** here at all (AC5): all four columns start NULL on existing rows. Verify the round-trip before writing any application code.

### Files being modified (read current state before editing)

- `app/models/invocation.py` — `InvocationResult` (`:157-199`). Adds 4 columns beside `result_metadata` (`:182`). Preserve the `output_file_key` file-by-key comment and the unique constraint.
- `app/services/job_service.py` — `mark_completed` (`:490-513`), `mark_blocked` (`:516-544`) gain 4 kwargs, set on the `InvocationResult(...)` constructor. `mark_failed`/`mark_cancelled` **untouched**.
- `app/workers/execution_tasks.py` — the write-path seam (`:256-321`), plus the fan-out child completed path (~`:587-591`). Reuse `_extract_token_metadata`.
- `app/services/analytics_service.py` — pricing import source only (`:37-43` removed/relocated); `_token_cost` query logic **unchanged** in this story.
- **New:** `app/core/pricing.py`, `app/db/migrations/versions/0024_invocation_cost_tracking.py`.

### Testing standards

pytest under `docker compose exec api`, run with `-e AUTH_BACKEND=dev`. Rebuild the api image first (source is baked, not mounted). Assert stored-row state by re-querying the DB, not by trusting the in-memory returned object. Keep new fixtures minimal — reuse the `test_execution_tasks.py` harness that already drives `execute_skill → mark_completed`.

### Project Structure Notes

- New shared module `app/core/pricing.py` is consistent with the existing `app/core/` leaf-module layout (`config.py`). No conflict with the unified structure.
- Migration numbering `0024_*` chains cleanly off verified head `0023_skill_version_egress` (confirmed nothing revises 0023).
- No FE/`velara-web` changes in this story — the whole cost-surfacing job is Stories 15.2 (Job API/UI) and 15.3 (Analytics), both of which depend on these columns landing first.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-15-per-execution-cost-tracking.md#Story 15.1]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-20-cost-tracking.md#4.1 PRD Amendment FR-USE-07] — the new FR this epic adds.
- [Source: velara-api/app/services/analytics_service.py#L37-L43] — current pricing table + `_DEFAULT_PRICING` fallback being removed.
- [Source: velara-api/app/services/analytics_service.py#L174-L208] — `_token_cost` JSONB read path (unchanged here; rewritten in 15.3).
- [Source: velara-api/app/workers/execution_tasks.py#L256-L321] — the confirmed write-path seam + `_extract_token_metadata` (`:103-114`).
- [Source: velara-api/app/services/job_service.py#L490-L578] — `mark_completed`/`mark_blocked` (get cost fields) vs `mark_failed`/`mark_cancelled` (no result row — see AC4 Dev Note).
- [Source: velara-api/app/services/execution_service.py#L516-L525,#L682-L687,#L1040-L1049] — the three runtimes' `result_metadata` token shape (prompt/code/hybrid).
- [Source: velara-api/app/models/invocation.py#L157-L199] — `InvocationResult` model.
- [Source: velara-api/app/db/migrations/versions/0023_skill_version_egress.py] — additive-nullable-column + documented-backfill-note migration precedent (Story 14.1).
- [Source: velara-api/app/core/config.py#L212] — `ANTHROPIC_MODEL = "claude-opus-4-8"` (the model string keying the pricing map).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
