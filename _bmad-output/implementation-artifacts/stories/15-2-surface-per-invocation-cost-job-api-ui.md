---
baseline_commit: 90e1c57 (velara-api) / 3372772 (velara-web, branch story/14-2-ai-adapter-upgrade-path)
---

# Story 15.2: Surface Per-Invocation Cost on the Job API and UI

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want to see the token cost of an individual job in the Jobs History and Run Console,
so that I can understand what a specific execution cost without cross-referencing the Analytics screen.

**Why this is a thread-through, not new machinery (verified in source):** Story 15.1 already persists the four structured columns on the `InvocationResult` row — `input_tokens` (Integer), `output_tokens` (Integer), `model` (String(64)), `cost_usd` (Numeric(12,6)→`Decimal`), at `app/models/invocation.py:196-202`. This story does **only** the surfacing: expose those columns on two existing response schemas (`JobResult` for the detail endpoint, `JobSummary` for the list endpoint), and render them in the two existing internal UI surfaces (Jobs History table + detail panel, Run Console output). No new endpoint, no new query mechanism, no model/migration change, no LLM-call change. The FE types (`src/api/jobs.ts`) are hand-written and mirror the BE schemas one-to-one, and the `fmtUsd` formatter already exists — everything is reuse.

**This is a full-stack story** (velara-api + velara-web). It **does** change `docs/api-spec.json` (two response schemas gain fields) — regenerate and commit it (see Task 5). It does **not** add a migration, a model column, an audit event, or a client-facing field.

## Acceptance Criteria

1. **AC1 — `JobResult` exposes cost.**
   **Given** a completed (or blocked) prompt/hybrid/code job with an `InvocationResult` row
   **When** `GET /api/v1/jobs/{job_id}` is called
   **Then** the `result` object in the response carries `input_tokens` (int|null), `output_tokens` (int|null), `model` (str|null), and `cost_usd` (number|null) — read **directly from the new Story 15.1 columns** (`job.result.input_tokens` etc.), NOT parsed out of `result_metadata`. A `null` in any of these fields is a legitimate value (see AC5) and must serialize as JSON `null`, never be dropped.

2. **AC2 — `JobSummary` (list rows) exposes `cost_usd`.**
   **Given** the org-scoped jobs list
   **When** `GET /api/v1/jobs` is called
   **Then** every list row carries `cost_usd` (number|null) so the Jobs History table can render a cost column **without an N+1 detail fetch per row**. `cost_usd` is read from the related `InvocationResult` for each job in the **same page query** (single round-trip). Only `cost_usd` is added to the summary (not the token/model fields — those are detail-only, matching the epic AC).

3. **AC3 — Jobs History UI renders cost (table + detail panel).**
   **Given** the internal Jobs History screen
   **When** it renders list rows and the inline job detail panel
   **Then** a **Cost** column appears in the table (per row) and a cost figure appears in the detail panel, formatted via the existing `fmtUsd` helper (`src/features/analytics/analyticsFormat.ts`) — **reused, not reimplemented**. The detail panel additionally shows `model` and the token counts (`input_tokens`/`output_tokens`) when present. A `cost_usd=0` code-runtime job shows **"$0.00"** (never blank); a `cost_usd=null` job (unknown-model, or a legacy pre-15.1 row) shows **"—"** (never `"$NaN"`, never a blank cell that reads as "unknown"). The distinction is deliberate: `0` = "priced, and it was zero"; `null` = "not priced".

4. **AC4 — Run Console renders cost on the completed job.**
   **Given** the internal Run Console (`RunConsole.tsx` → `JobStatusPanel`)
   **When** a job reaches `completed` (or `blocked`) status and its detail loads
   **Then** the same cost/model/token figures appear in the Run Console's completed-job output area, using the same `fmtUsd` formatter and the same null/zero rendering rule as AC3. (Epic AC names "Run Console" alongside Jobs History; the two surfaces share the same `useJob` detail data and the same `JobReadWithResult` type, so this is the same field-render applied in a second component.)

5. **AC5 — Null and zero are both first-class; client surface is untouched.**
   **Given** the `cost_usd` field can be `0` (code-runtime), `null` (unknown model or legacy row), or a real Decimal (priced prompt/hybrid)
   **When** any of these is returned and rendered
   **Then** each renders per the AC3 rule with no crash and no `NaN`. **And** the client-facing schemas `ClientJobRead` / `ClientJobSummary` (`app/schemas/job.py:213-254`) and their routes (`app/api/v1/client.py`) do **NOT** gain any cost/token/model field — matching the existing IP-boundary convention (clients never see internal cost figures, same as they never see skill internals). A test asserts the cost fields are **absent** from client job responses.

**Out of scope (do NOT touch):**
- Per-skill / per-user cost aggregation and any Analytics-screen change — that is **Story 15.3**.
- The adapter-propose LLM cost (audit-log write path) — that is **Story 15.4**.
- Any change to `InvocationResult` columns, the `0024` migration, `execution_tasks.py`, `job_service.mark_completed`/`mark_blocked`, or the pricing table — 15.1 already landed all of that; this story only **reads** those columns.
- Any client-portal FE type/component (`src/features/client-portal/**`, `src/api/clientPortal.ts`) — leave cost-free.
- `analytics_service.py` / the Analytics `token_cost` figure — unchanged.

## Tasks / Subtasks

- [x] **Task 1 — Expose cost on the two internal job response schemas (AC1, AC2) — `velara-api/app/schemas/job.py`**
  - [x] Add to `JobResult` (currently `:38-53`): `input_tokens: int | None = None`, `output_tokens: int | None = None`, `model: str | None = None`, `cost_usd: Decimal | None = None`. Import `Decimal` (`from decimal import Decimal`) at the top of the file. `JobResult` already has `model_config = ConfigDict(from_attributes=True)` — but it is **constructed explicitly** in the route (see Task 2), so the new fields are populated by explicit kwargs, not by ORM validation. Keep `result_metadata` unchanged (additive).
  - [x] Add to `JobSummary` (currently `:136-155`): `cost_usd: Decimal | None = None` (ONLY this — no token/model fields on the list row). `JobSummary` is built via `model_validate(job)` from the `InvocationJob` ORM object, which has **no** `cost_usd` attribute (cost lives on the related `InvocationResult`) — so this field is threaded in explicitly by the route via `model_copy(update=...)` (see Task 3), exactly as `skill_name` already is. A bare `model_validate(job)` would otherwise leave it at its `None` default.
  - [x] Do **NOT** add any cost field to `JobRead`, `JobReadWithResult` (the cost lives on the nested `result`), `JobChild`, or any `Client*` schema.
  - [x] **Decimal → JSON note:** Pydantic v2 under FastAPI serializes a `Decimal` field to a JSON **number** by default (e.g. `Decimal("0.500000")` → `0.5`). This matches the existing money-on-the-wire convention (`app/schemas/analytics.py:39` uses `token_cost: float`). There is no `json_encoders` override anywhere in `app/schemas/` — default behavior applies. Keep the schema type as `Decimal | None` (preserves server-side precision); the wire form is a JSON number. Confirm the exact serialized value in the Task 4 test.

- [x] **Task 2 — Populate the detail `JobResult` from the new columns (AC1) — `velara-api/app/api/v1/jobs.py`**
  - [x] In `get_job`, at the explicit `JobResult(...)` construction (currently `:255-260`), add the four kwargs read directly off the eager-loaded relationship:
    ```python
    result = JobResult(
        output_file_key=job.result.output_file_key,
        output_file_url=output_file_url,
        output_files=output_files,
        result_metadata=job.result.result_metadata,
        input_tokens=job.result.input_tokens,
        output_tokens=job.result.output_tokens,
        model=job.result.model,
        cost_usd=job.result.cost_usd,
    )
    ```
  - [x] The `job.result` relationship is already eager-loaded for the detail path (`_get_job_or_404` uses `selectinload(InvocationJob.result)`, `job_service.py:~158`), so these columns are already in memory — a direct attribute read, no extra query. Do **not** read them out of `result_metadata`.

- [x] **Task 3 — Thread `cost_usd` onto list rows without an N+1 (AC2) — `velara-api/app/services/job_service.py` + `app/api/v1/jobs.py`**
  - [x] In `job_service.list_jobs` (`:270-321`), the rows query (`rows_stmt`, `:310-319`) currently `select(InvocationJob, Skill.name)` with an explicit comment "no result eager-load (summary only)". Add `InvocationResult.cost_usd` to the page query **in the same round-trip** — the clean approach is an explicit `.outerjoin(InvocationResult, InvocationResult.invocation_job_id == InvocationJob.id)` and select the column into the returned tuple. Update the return type + tuple shape from `(InvocationJob, skill_name)` to `(InvocationJob, skill_name, cost_usd)` and update the docstring's "Returns a tuple of (InvocationJob, skill_name|None)" line accordingly.
    - Rationale for outerjoin over `selectinload(result)`: `selectinload` would pull the **whole** `InvocationResult` row (including `result_metadata` JSONB) per page for a summary that needs one Numeric column — the targeted outerjoin is cheaper and keeps the summary genuinely light. Either satisfies "single round-trip, no N+1"; prefer the outerjoin.
  - [x] `InvocationResult` is a one-to-one on `invocation_job_id` (unique constraint `uq_invocation_results_invocation_job_id`), so the outerjoin cannot fan-out rows. A job with no result row (queued/running/failed/cancelled) yields `cost_usd = NULL` — correct (AC5).
  - [x] In `list_jobs` route (`jobs.py:110-113`), update the unpack loop from `for job, skill_name in rows:` to `for job, skill_name, cost_usd in rows:` and thread cost into the summary build (`:112`):
    ```python
    summary = JobSummary.model_validate(job).model_copy(
        update={"skill_name": skill_name, "cost_usd": cost_usd}
    )
    ```
  - [x] **Client reuse check:** `app/api/v1/client.py` `client_list_jobs` (`:229-275`) reuses `job_service.list_jobs` but builds `ClientJobSummary(...)` explicitly (field-by-field, `:261-267`), so the extra tuple element is simply ignored there — no cost leaks to clients. **Update `client.py`'s unpack of `list_jobs` rows to the new 3-tuple shape** (it will iterate the same rows) but do **not** pass cost into `ClientJobSummary`. Grep for every caller/unpacker of `list_jobs` and fix the tuple arity — this is the one back-compat hazard of changing the return shape.

- [x] **Task 4 — Backend tests (AC1, AC2, AC5) — `velara-api/tests`**
  - [x] **`tests/integration/api/test_jobs.py`:** the seed helper `_create_completed_job_with_output_files` (`~:379-414`) builds an `InvocationResult(...)` directly — extend it (or add a variant) to set `input_tokens=`, `output_tokens=`, `model=`, `cost_usd=Decimal(...)`. Then:
    - Detail (`GET /jobs/{id}`): assert `body["data"]["result"]["cost_usd"] == <number>`, `["model"] == "..."`, `["input_tokens"] == ...`, `["output_tokens"] == ...`. Assert the JSON serialized form (number, per Task 1's Decimal note — pin the exact value, e.g. `0.5`, so a future serialization change is caught).
    - A **code-runtime** result (`cost_usd=Decimal("0")`, tokens/model NULL): detail returns `cost_usd == 0`, `model is None`, `input_tokens is None`.
    - An **unknown-model / legacy** result (`cost_usd=None`): detail returns `result["cost_usd"] is None` (JSON `null`, field present not dropped).
    - List (`GET /jobs`): assert each `body["data"]["items"][i]["cost_usd"]` matches the seeded value, and that a no-result job (e.g. queued) yields `cost_usd is None`. Assert the list query stays a single round-trip conceptually (no per-row detail call) — following the existing list-test pattern.
  - [x] **Client IP-boundary test — `tests/integration/api/test_client_surface.py`** (this file holds the existing skill-internals leak tests): add assertions that a client `GET` on a job's detail and list responses contain **no** `cost_usd`, `model`, `input_tokens`, or `output_tokens` key (absent, not just null). Follow the existing "internal field must be absent" assertion pattern already in that file.
  - [x] Do not weaken any existing `test_jobs.py` exact-shape assertion — a queued job's `result` is still `None`; the new fields only appear inside a present `result`.

- [x] **Task 5 — Regenerate the OpenAPI spec (AC1, AC2) — `velara-api`**
  - [x] Run `python scripts/export_openapi.py` **on the host** (it imports `app.main` only — no DB/Redis/MinIO needed; its `OUTPUT_PATH` targets the repo's real `docs/api-spec.json` via `Path(__file__).parent.parent`, so **no `docker cp` is required** for this script — unlike the older in-container export lesson from Story 13.1). Commit the resulting `docs/api-spec.json` diff (`JobResult` gains 4 fields, `JobSummary` gains 1).
  - [x] `tests/integration/api/test_openapi.py` must still pass (CI diff-gates the spec).

- [x] **Task 6 — Extend the FE job types (AC3, AC4) — `velara-web/src/api/jobs.ts`**
  - [x] Add to the `JobResult` interface (`:47-52`): `input_tokens: number | null`, `output_tokens: number | null`, `model: string | null`, `cost_usd: number | null`. (These sit on the nested `result` object, mirroring the BE `JobResult` schema exactly — NOT on `JobReadWithResult` top-level.)
  - [x] Add to the `JobSummary` interface (`:100-112`): `cost_usd: number | null`.
  - [x] `getJob`/`listJobs` (`:149-157`) already pass through the envelope `.data.data` verbatim — no change; the new fields flow automatically once typed.

- [x] **Task 7 — Render cost in Jobs History (AC3) — `velara-web/src/features/run/components/JobsHistory.tsx`**
  - [x] Add a small local formatter (mirroring the file's own `formatTs` null-guard pattern at `:12-20`), e.g.:
    ```ts
    function fmtCost(v: number | null | undefined): string {
      return v == null ? '—' : fmtUsd(v)   // fmtUsd(0) → "$0.00"; null/undefined → "—"
    }
    ```
    Import `fmtUsd` from `@/features/analytics/analyticsFormat`. **Do not** call `fmtUsd` directly on a possibly-null value — `fmtUsd` has no null guard and returns `"$NaN"` for null (confirmed at `analyticsFormat.ts:14`).
  - [x] **Table:** add a **Cost** column. Header row (`:255-260`) — insert `<div className="hidden shrink-0 text-right sm:block w-20">Cost</div>` between Status and Time (or wherever visually clean; match the existing header cell classes). `JobRow` (`:163-195`) — add a matching cell rendering `fmtCost(job.cost_usd)`, right-aligned, near the Status/`formatTs` blocks. Keep it `hidden sm:block` if Time is (responsive parity).
  - [x] **Detail panel** (`JobDetailPanel`, `:24-159`): after the timestamps block (`:65-69`), add a cost/model/token block, e.g. a small labelled row showing `Cost: {fmtCost(job.result?.cost_usd)}`, and — when `job.result?.model` is present — `Model: {job.result.model}` and `Tokens: {fmtNum(in)} in / {fmtNum(out)} out` (import `fmtNum` from the same module for the token counts). Guard on `job.result` being present (a queued job has `result === null`).

- [x] **Task 8 — Render cost in Run Console (AC4) — `velara-web/src/features/run/components/RunConsole.tsx`**
  - [x] In `JobStatusPanel` (`:1083-1463`), the completed branch (`job.status === 'completed'`, `~:1252-1354`), add the same cost/model/token line as the Jobs History detail panel, reading from `job.result` (same `JobReadWithResult` shape from `useJob`). Reuse `fmtUsd`/`fmtNum` + the same `null → "—"`, `0 → "$0.00"` rule. Anchor it near the job-header/run-context area or just above the "Generated outputs" list — pick the cleanest spot; keep it consistent with the Jobs History detail styling.
  - [x] **Icon note:** `RunConsole.tsx` has a **private** local `ICONS`/`Icon` (`:34-56`) that does NOT include `sparkle` (the token-cost glyph used in `OverviewTab.tsx:133`). If you want an icon on the cost line, either import the shared `<Icon>` from `@/shared/components/Icon` or add the needed path to the local map — do **not** use an emoji/unicode glyph (HARD project rule: icons come from `Icon.tsx`; only ⌘ is exempt). A cost line without an icon is also fine — Jobs History rows have none.

- [x] **Task 9 — FE tests (AC3, AC4, AC5) — `velara-web`**
  - [x] **`src/features/run/components/JobsHistory.test.tsx`:** the `mockJobs` fixture (`~:60-87`) — add `cost_usd` to each row (include a `0` row and a `null` row). Assert the table renders `"$0.00"` for the zero row and `"—"` for the null row, and a real `"$x.xx"` for a priced row. The `useJob` detail mock (`~:143-157`) — add `result: { ..., cost_usd, model, input_tokens, output_tokens }`; assert the detail panel shows the cost/model/tokens. Follow the existing `screen.getByText(...)` pattern (`:128-133`).
  - [x] **`src/features/run/components/RunConsole.test.tsx`:** add/extend a completed-job case to assert the cost figure renders in `JobStatusPanel` (mock `useJob` to return a `result` with `cost_usd`). Follow the file's existing `useJob` mock pattern.
  - [x] Confirm no client-portal test needs changing (client types untouched).

- [x] **Task 10 — Gates**
  - [x] **BE:** rebuild the api image before pytest (`docker compose build api` — source is baked, not mounted; stale image = false results). Run with `AUTH_BACKEND=dev` (`docker-compose.yml` defaults `api` to `cognito`, which 401s Dev-token tests). Green: `tests/integration/api/test_jobs.py`, `test_client_surface.py`, `test_openapi.py`, then the full suite. Note the one documented pre-existing flake (`test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped`, append-only-DB dedupe re-run sensitivity — Stories 13.4/13.6/14.1/15.1) so it is not mistaken for a regression.
  - [x] `ruff check` on all changed BE files → clean.
  - [x] Confirm the **only** `docs/api-spec.json` diff is the two schema additions (`git diff docs/api-spec.json`) and it is committed.
  - [x] Confirm **no** new audit event type, **no** migration, **no** `Client*` schema change (`git status` / `git diff` review).
  - [x] **FE:** `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint`), `npm test` (`vitest run`) — all clean/green.

## Dev Notes

### The whole story is: read four columns that already exist, in two places, and render them

Story 15.1 (`baseline_commit 90e1c57`) already added and populated `input_tokens`/`output_tokens`/`model`/`cost_usd` on `InvocationResult` (`app/models/invocation.py:196-202`). 15.1 explicitly deferred *all* surfacing to 15.2/15.3. So the mental model here: **no write-path, no migration, no pricing logic** — you are exposing existing columns on existing response schemas and rendering them in existing components. If you find yourself editing `execution_tasks.py`, `job_service.mark_completed`, `app/core/pricing.py`, or writing a migration, you have gone out of scope.

### The two seams have different shapes — detail is easy, list needs a query change

- **Detail (`GET /jobs/{id}`)** — the `job.result` relationship is already eager-loaded (`selectinload`), and `JobResult` is constructed by explicit kwargs at `jobs.py:255-260`. You just add four kwargs reading `job.result.<col>`. Trivial.
- **List (`GET /jobs`)** — the summary is `JobSummary.model_validate(job)` from the `InvocationJob` ORM object (`jobs.py:112`), and cost lives on the **related** `InvocationResult`, which the list query deliberately does **not** load (`job_service.py:309` comment: "no result eager-load"). So the list needs a real query change: outerjoin `InvocationResult` and select `cost_usd` into the returned tuple, changing `list_jobs`'s return shape from a 2-tuple to a 3-tuple. **That return-shape change is the single back-compat hazard** — grep every unpacker of `list_jobs` (at least the internal route `jobs.py:111` AND the client route `client.py`, which reuses it) and fix the tuple arity, or you get a runtime unpack error on the client jobs list.

### null vs 0 is a real semantic distinction — do not collapse it

Three legitimate `cost_usd` values with three meanings (all decided by 15.1's write path, not this story):
- `Decimal("0")` — a **code-runtime** job. Nothing to price; cost is an explicit zero. Render **"$0.00"**.
- `null` — an **unknown-model** prompt/hybrid job (15.1 stores NULL for a model not in the pricing table, deliberately — "unknown ≠ zero"), OR a **legacy pre-15.1 row** (never had structural token data). Render **"—"**.
- a real `Decimal` — a priced prompt/hybrid job. Render **"$x.xx"** via `fmtUsd`.

The FE hazard: `fmtUsd` (`analyticsFormat.ts:14`) takes `number` and has **no null guard** — `fmtUsd(null)` → `"$NaN"`. Always coalesce through a `v == null ? '—' : fmtUsd(v)` wrapper (mirror `fmtMs`'s existing `null → "—"` guard at `analyticsFormat.ts:30`). `fmtUsd(0)` correctly yields `"$0.00"` — so do **not** map `0` to `"—"`; that would hide a real, meaningful zero.

### Client IP boundary — the structural guarantee is "independent models + explicit construction"

`ClientJobRead`/`ClientJobSummary` (`job.py:213-254`) are deliberately **independent `BaseModel`s** (not subclasses of `JobRead`/`JobResult`) with `from_attributes=False`, and are built field-by-field in `client.py`. That design means a new field on the internal `JobResult`/`JobSummary` **cannot** leak to clients automatically — but only if you don't manually add it there. This story: add cost to internal schemas only; do not touch any `Client*` schema or `client.py`'s explicit `ClientJobSummary(...)`/`ClientJobRead(...)` construction. The one required `client.py` edit is purely mechanical: its loop over `list_jobs` rows must unpack the new 3-tuple arity — but it still passes only the IP-safe fields to `ClientJobSummary`. A test asserting cost keys are **absent** from client responses (`test_client_surface.py`) is the AC5 guard.

### Files being modified (read current state before editing)

**velara-api:**
- `app/schemas/job.py` — `JobResult` (`:38-53`, +4 fields), `JobSummary` (`:136-155`, +`cost_usd`). Import `Decimal`. `Client*` schemas untouched.
- `app/api/v1/jobs.py` — `get_job` `JobResult(...)` build (`:255-260`, +4 kwargs); `list_jobs` route unpack loop (`:110-113`, 3-tuple + thread `cost_usd`).
- `app/services/job_service.py` — `list_jobs` (`:270-321`), `rows_stmt` (`:310-319`) gains an outerjoin on `InvocationResult` + selects `cost_usd`; return type/tuple + docstring updated.
- `app/api/v1/client.py` — `client_list_jobs` (`:229-275`) unpack loop only, to the 3-tuple arity; `ClientJobSummary` build unchanged.
- `docs/api-spec.json` — regenerated (Task 5).

**velara-web (branch `story/14-2-ai-adapter-upgrade-path`):**
- `src/api/jobs.ts` — `JobResult` interface (`:47-52`, +4 fields), `JobSummary` interface (`:100-112`, +`cost_usd`).
- `src/features/run/components/JobsHistory.tsx` — table header (`:255-260`) + `JobRow` (`:163-195`) cost column; `JobDetailPanel` (`:24-159`) cost/model/token block after timestamps (`:69`). Import `fmtUsd`/`fmtNum`.
- `src/features/run/components/RunConsole.tsx` — `JobStatusPanel` completed branch (`~:1252-1354`) cost block.
- Tests: `JobsHistory.test.tsx`, `RunConsole.test.tsx`.
- **Untouched:** all `src/features/client-portal/**` and `src/api/clientPortal.ts`.

### Formatter reuse (do NOT reimplement)

- `fmtUsd(n: number, compact = false)` — `analyticsFormat.ts:14`. `fmtUsd(3.14)` → `"$3.14"`, `fmtUsd(0)` → `"$0.00"`. **No null guard** — wrap it. For per-job cost use `compact = false` (default) so cents show; the compact form is for the big platform-wide figure.
- `fmtNum(n: number)` — `analyticsFormat.ts:6` — thousands separators, for the token counts in the detail panel.
- Reference render: `OverviewTab.tsx:133` uses `value={fmtUsd(data.token_cost)}` with `icon="sparkle"` for the platform token-cost tile — `sparkle` is the established LLM-cost glyph if you add an icon (available in the shared `Icon.tsx` map; NOT in RunConsole's private mini-map).

### Decimal on the wire

BE `cost_usd` is a stored `Decimal` (Numeric(12,6)). Pydantic v2 + FastAPI serialize a `Decimal` field to a JSON **number** by default (no `json_encoders` override exists in `app/schemas/`), matching the existing `token_cost: float` shape on the analytics response. FE types it as `number | null`. Pin the exact serialized value in the BE test so a future encoder change is caught. Small runs price in the sub-cent range — `Numeric(12,6)` preserves it; `fmtUsd`'s `maximumFractionDigits: 2` will display it rounded to cents on screen (acceptable — the exact figure lives in the API/DB).

### Testing standards

- **BE:** pytest under `docker compose exec -e AUTH_BACKEND=dev api`; **rebuild the api image first** (`docker compose build api` — source is baked, not mounted). Seed `InvocationResult` rows directly via the existing `test_jobs.py` helper; assert the JSON response shape (re-read via the endpoint, not the ORM object). Cover all three cost states (real / `0` / `null`) and the client-absence case.
- **FE:** vitest + `@testing-library/react`; extend the existing `mockJobs` fixture and `useJob` mock in `JobsHistory.test.tsx`. Gates: `npm run typecheck`, `npm run lint`, `npm test`.

### Project Structure Notes

- No new files on either side — all edits land in existing schemas/routes/services (BE) and existing components/types (FE). No migration, no new module.
- FE types are hand-written (no OpenAPI codegen in `velara-web`); the FE `JobResult`/`JobSummary` interfaces must be kept in lockstep with the BE schemas by hand — that lockstep is the reason both are edited in the same story.
- velara-web is currently on branch `story/14-2-ai-adapter-upgrade-path` (not switched back to `main` after 14.2 — a known housekeeping state noted in prior reviews). Implement here; code-review handles the branch/commit hygiene per the never-push-subrepos rule (dev-story does not commit the subrepos).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-15-per-execution-cost-tracking.md#Story 15.2]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-20-cost-tracking.md#Story 15.2] — AC text + the `ClientJobRead`/`ClientJobSummary` IP-boundary decision (§ "Client-facing IP boundary").
- [Source: _bmad-output/implementation-artifacts/stories/15-1-persist-structured-per-execution-cost.md] — the columns being surfaced; the null-vs-zero semantics (AC3/AC4 of 15.1); `app/core/pricing.py`.
- [Source: velara-api/app/models/invocation.py#L196-L202] — the four `InvocationResult` columns (`input_tokens`/`output_tokens`/`model`/`cost_usd`), types confirmed.
- [Source: velara-api/app/schemas/job.py#L38-L53,#L136-L155,#L213-L254] — `JobResult` / `JobSummary` (extend) vs `ClientJobRead`/`ClientJobSummary` (leave cost-free).
- [Source: velara-api/app/api/v1/jobs.py#L110-L119,#L255-L260] — list-row build seam + explicit `JobResult(...)` construction.
- [Source: velara-api/app/services/job_service.py#L270-L321] — `list_jobs` rows query ("no result eager-load" comment at :309) — the one query change.
- [Source: velara-api/app/api/v1/client.py#L229-L275] — `client_list_jobs` reuses `list_jobs`; unpack-arity fix only, no cost passed.
- [Source: velara-api/scripts/export_openapi.py] — host-runnable spec regen (no docker cp needed for this script).
- [Source: velara-web/src/api/jobs.ts#L47-L52,#L100-L112] — FE `JobResult`/`JobSummary` interfaces (hand-written, mirror BE).
- [Source: velara-web/src/features/run/components/JobsHistory.tsx] — table header (:255-260), `JobRow` (:163-195), `JobDetailPanel` (:24-159).
- [Source: velara-web/src/features/run/components/RunConsole.tsx#L1083-L1463] — `JobStatusPanel`, completed branch (~:1252-1354).
- [Source: velara-web/src/features/analytics/analyticsFormat.ts#L6-L33] — `fmtUsd` (no null guard) / `fmtNum` / `fmtMs` (null-guard pattern to mirror).
- [Source: velara-web/src/features/analytics/components/OverviewTab.tsx#L133] — reference `fmtUsd` + `sparkle` icon usage for cost.
- [Source: velara-web/src/features/client-portal/types.ts, velara-web/src/api/clientPortal.ts] — client FE surface to leave untouched.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `docker compose build api` rebuilt 3 times across the session (after Task 1-3 code, after the Decimal-serialization fix in Task 1, after a test-file line-length fix) — each followed by `docker compose up -d api` to recreate the container on the fresh image, per the documented "image bakes source" project lesson.
- **Deviation from the story's Task 1 Decimal note (corrected during implementation):** the story assumed Pydantic v2 serializes `Decimal` to a JSON number by default. Verified in-container this is FALSE — Pydantic v2's default `Decimal` JSON encoding is a **string** (`Decimal("0.0175")` → `"0.017500"`), confirmed via a direct `model_dump_json()` probe and via the first failing test (`test_get_job_detail_exposes_priced_cost` initially failed asserting `"0.017500" == 0.0175`). Fixed by adding an explicit `@field_serializer("cost_usd")` on both `JobResult` and `JobSummary` that casts `Decimal | None` to `float | None` — this delivers the story's actual intent (a JSON number matching the `token_cost: float` wire convention, consumable by `fmtUsd(n: number)` with no FE parse step) without changing the Python-side type (`Decimal`, preserving server-side precision/no float drift). Confirmed in the regenerated `docs/api-spec.json`: `cost_usd` shows `"type": "number"`.
- Mid-session Docker Desktop VM disk hit `DiskFullError` (`asyncpg.exceptions.DiskFullError`) during test reruns — the documented "repeated rebuilds fill the VM disk" project lesson (previously fixed with `docker builder prune`). This time the reclaimable space was mostly **dangling `<none>` image layers** from the session's own rebuild history (13 stale `velara-api-api` layers, ~2.7GB unique each), not build cache — `docker builder prune -a -f` alone (39GB) was insufficient; `docker image prune -f` (47GB) cleared it. VM disk went from 96% to 15% used. Noting the refined fix here since the prior memory only documented `docker builder prune`.
- Full BE suite: `docker compose exec -e AUTH_BACKEND=dev api pytest` → **1491 passed, 1 failed, 3 skipped**. The 1 failure (`tests/integration/api/test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped`) reproduces in total isolation and matches the documented pre-existing flake (fixed-`user_id` dedupe-count test, re-run-sensitive against the append-only `velara_test` DB — same class of flake noted in Stories 13.4/13.6/14.1/15.1). Not touched by this story's file set.
- `ruff check` on all 7 changed BE files: clean (1 line-length fix applied in `test_jobs.py` during the process).
- `docs/api-spec.json` regenerated via `.venv/bin/python scripts/export_openapi.py` on host (venv had FastAPI installed; system `python3` did not). Diff isolates to `JobResult` (+4 fields) and `JobSummary` (+1 field) only — confirmed via `git diff docs/api-spec.json | grep -i Client` returning nothing.
- FE: `npm run typecheck` clean; `npm run lint` clean (1 pre-existing unrelated warning in `Icon.tsx`, not touched by this story); full `npx vitest run` → **60 test files, 735 tests passed**.

### Completion Notes List

- **Task 1 (AC1, AC2 schema):** Added `input_tokens`/`output_tokens`/`model`/`cost_usd` to `JobResult` (`app/schemas/job.py`) and `cost_usd` to `JobSummary`. Both gained an explicit `@field_serializer("cost_usd")` casting `Decimal | None` → `float | None` for the wire (see Debug Log deviation note — the story's assumption that Pydantic emits `Decimal` as a JSON number by default was wrong; this serializer delivers the story's actual intended wire shape).
- **Task 2 (AC1):** `get_job`'s explicit `JobResult(...)` construction in `jobs.py` now passes the 4 new fields read directly from the already-eager-loaded `job.result` relationship — no new query.
- **Task 3 (AC2, AC5):** `job_service.list_jobs` now outerjoins `InvocationResult` (on `invocation_job_id`) and selects `cost_usd` into the returned tuple, changing its shape from `(InvocationJob, skill_name)` to `(InvocationJob, skill_name, cost_usd)`. Both callers fixed: the internal `jobs.py` list route threads `cost_usd` into the `JobSummary` build; `client.py`'s `client_list_jobs` unpacks the new 3-tuple arity but deliberately drops `cost_usd` (documented inline) so it never reaches `ClientJobSummary`.
- **Task 4 (AC1, AC2, AC5):** Extended `_create_completed_job_with_output_files` in `test_jobs.py` with optional cost/token/model kwargs (sentinel-defaulted, back-compat with every existing caller). Added 7 new tests covering: priced detail, code-runtime explicit-zero detail, unknown-model null detail, legacy-row (no kwargs) null detail, list-row cost per job (priced/zero/no-result), and a queued-job result-still-None regression guard. Extended `_seed_terminal_job_for_client` in `test_client_surface.py` with the same optional cost kwargs; added `cost_usd`/`input_tokens`/`output_tokens` to the existing forbidden-token leak-search list, plus 2 new dedicated tests proving a job that IS priced internally still returns zero cost fields on both the client list (exact-keys assertion) and detail (token-search assertion) endpoints.
- **Task 5 (AC1, AC2):** Regenerated `docs/api-spec.json` — diff isolates to the 2 touched schemas.
- **Task 6 (AC3, AC4):** Extended the hand-written FE `JobResult`/`JobSummary` interfaces in `src/api/jobs.ts` to match the BE schemas exactly.
- **Task 7 (AC3):** `JobsHistory.tsx` — added a `fmtCost` null-coalescing wrapper around `fmtUsd` (reused, not reimplemented), a Cost column in the table (header + `JobRow` cell), and a cost/model/token block in `JobDetailPanel` guarded on `job.result` being present.
- **Task 8 (AC4):** `RunConsole.tsx` — added the same `fmtCost` wrapper and a cost/model/token block in `JobStatusPanel`'s completed branch (single-job path only; fan-out children are priced individually and have no parent-level rollup in this story's scope).
- **Task 9 (AC3, AC4, AC5):** Extended `mockJobs` in `JobsHistory.test.tsx` with `cost_usd` (one priced, one null) and added 4 new tests (priced row, zero row, detail panel with model/tokens, null-cost "no $NaN" guard). Added 3 new tests to `RunConsole.test.tsx`'s existing `JobStatusPanel — Story 5.4` describe block (priced completed job, zero-cost job, null-cost job) following the file's established `useJob` mock pattern. Confirmed no client-portal test needed changes (client types/components untouched).
- **Task 10 (Gates):** All BE and FE gates green — see Debug Log References above.

### File List

**Modified (velara-api):**
- `velara-api/app/schemas/job.py`
- `velara-api/app/api/v1/jobs.py`
- `velara-api/app/api/v1/client.py`
- `velara-api/app/services/job_service.py`
- `velara-api/docs/api-spec.json`
- `velara-api/tests/integration/api/test_jobs.py`
- `velara-api/tests/integration/api/test_client_surface.py`

**Modified (velara-web, branch `story/14-2-ai-adapter-upgrade-path`):**
- `velara-web/src/api/jobs.ts`
- `velara-web/src/features/run/components/JobsHistory.tsx`
- `velara-web/src/features/run/components/RunConsole.tsx`
- `velara-web/src/features/run/components/JobsHistory.test.tsx`
- `velara-web/src/features/run/components/RunConsole.test.tsx`

## Change Log

- 2026-07-21 — Drafted Story 15.2 (surface per-invocation cost on the Job API + Jobs History/Run Console UI). Backend: add `input_tokens`/`output_tokens`/`model`/`cost_usd` to `JobResult` and `cost_usd` to `JobSummary` (reading Story 15.1's columns; list needs an `InvocationResult` outerjoin + 3-tuple return change), regenerate `docs/api-spec.json`. Frontend: extend the hand-written `JobResult`/`JobSummary` types and render cost (null→"—", 0→"$0.00") via the reused `fmtUsd` helper in Jobs History (table + detail) and Run Console. Client IP boundary preserved (no `Client*` cost field). No migration, no audit event, no write-path change.
- 2026-07-21 — Implemented Story 15.2. All 10 tasks complete. Corrected one story assumption during implementation: Pydantic v2 serializes `Decimal` to a JSON **string** by default, not a number — added explicit `field_serializer`s on `JobResult.cost_usd`/`JobSummary.cost_usd` to deliver the story's actual intended `number` wire shape (matching `token_cost: float`). 12 new BE tests + 7 new FE tests. Gates: BE 1491 passed/1 pre-existing unrelated flake/3 skipped, ruff clean, api-spec diff isolated to the 2 touched schemas, no migration/audit change; FE typecheck/lint clean, 735/735 tests passed.
