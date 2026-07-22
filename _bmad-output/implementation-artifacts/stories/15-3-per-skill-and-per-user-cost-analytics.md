---
baseline_commit: 118639a (velara-api, branch development) / 754dafa (velara-web, branch story/14-2-ai-adapter-upgrade-path)
---

# Story 15.3: Per-Skill and Per-User Cost in Analytics

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want to see cost broken out by skill and by user in the Usage & Value screen,
so that I can identify which skills or users are driving LLM spend, not just the platform-wide total.

**Why this is a real rewrite, not a thread-through (verified in source):** Unlike Story 15.2 (pure read of existing columns), `analytics_service.py`'s cost path today (`_token_cost`, `app/services/analytics_service.py:162-214`) computes the platform-wide `token_cost` figure by parsing `AuditLogEntry.event_metadata` JSONB text with a regex guard against malformed values — it does **not** read Story 15.1's structured `InvocationResult.cost_usd`/`input_tokens`/`output_tokens`/`model` columns at all. AC3 requires switching this read path over to the structured columns. There is **no existing FK** from `AuditLogEntry` to `InvocationResult` — the join key is `AuditLogEntry.job_id` (a plain indexed UUID, soft-referencing `InvocationJob.id` — see `app/models/audit.py:183-186`) to `InvocationResult.invocation_job_id` (the unique one-to-one column `job_service.py` already outerjoins on for Story 15.2's list-cost seam). This story adds that same outerjoin idiom to three more queries (`_top_skills`, a new per-user cost query, and the `_token_cost` replacement), and rewrites the JSONB-parsing tests that will otherwise silently stop reflecting real cost.

**This is a full-stack story** (velara-api + velara-web). It does **not** add a migration, a new endpoint, or a `Client*`/audit-event change. `docs/api-spec.json` **does** change (three response schemas gain `cost_usd`) — regenerate and commit it.

## Acceptance Criteria

1. **AC1 — `SkillRun` carries cost.**
   **Given** the `top_skills` breakdown (used by both `GET /api/v1/analytics/overview` and `GET /api/v1/analytics/users/{user_id}`, both built by `_top_skills`)
   **When** either endpoint is called
   **Then** each `SkillRun` entry carries a `cost_usd: float` field — the SUM of `InvocationResult.cost_usd` across every invocation-leaf audit row in scope for that skill, joined via `AuditLogEntry.job_id == InvocationResult.invocation_job_id`. A skill with rows that have `cost_usd IS NULL` (unknown-model or legacy pre-15.1 row) or no matching `InvocationResult` at all (queued/running/failed/cancelled — no result row ever written) contributes `0` to that skill's sum, never `NULL` at the aggregate level (`COALESCE(SUM(...), 0)` — a `SUM` with a `FILTER`/`GROUP BY` over zero non-null rows is SQL `NULL`, must be coalesced). `runs` (the existing count) is unchanged in meaning — it counts audit rows, not priced rows.

2. **AC2 — `AnalyticsUserSummary` and `AnalyticsUserDetail` carry cost.**
   **Given** `GET /api/v1/analytics/users` (the users-in-scope list) and `GET /api/v1/analytics/users/{user_id}` (per-user drill-down)
   **When** either is called
   **Then** both schemas gain a `cost_usd: float` field — the same `InvocationResult`-joined, `COALESCE`d sum as AC1, scoped to that user's invocation-leaf rows (mirrors how `invocations`/`success_rate`/`skills_used` are already computed per-user). This closes the documented gap where these two schemas already break out per-user activity/success/hours but never cost.

3. **AC3 — `analytics_service.py`'s cost path reads the structured column, not JSONB.**
   **Given** the existing `_token_cost` function (`app/services/analytics_service.py:162-214`), which today parses `AuditLogEntry.event_metadata["input_tokens"/"output_tokens"/"model"].astext` with a regex-guarded `CAST(... AS Numeric)` and looks up `_MODEL_PRICING` at query time
   **When** this story ships
   **Then** `_token_cost` (or its direct replacement used by `overview()` for the existing `token_cost` field) is rewritten to `SUM(InvocationResult.cost_usd)` over the same outerjoin, coalesced to `0.0` — **simpler, faster, and no longer silently excludes** code-runtime/failed rows the JSONB version excluded via its `event_metadata.isnot(None)` filter (those rows now have an explicit `cost_usd=0`/`NULL` on `InvocationResult` per Story 15.1 AC4, correctly included in every sum). The regex-guard/malformed-JSONB-survival logic this function existed to protect against is retired along with the JSONB read — a stored `Numeric(12,6)` column cannot be malformed the way free-form JSONB text can. Do **not** duplicate a second pricing lookup here — this story sums an already-priced stored column; it does not call `compute_cost_usd`/`_MODEL_PRICING` itself (that happens once, at write time, in Story 15.1's `execution_tasks.py`).

4. **AC4 — Existing `AnalyticsOverview.token_cost` figure is unchanged in meaning.**
   **Given** the platform-wide `token_cost` field on `AnalyticsOverview`
   **When** AC3's rewrite lands
   **Then** the field keeps its existing name and unit (a float USD figure at the platform-wide, in-scope level) — this story changes **how** it is computed (structured column vs. JSONB parse) and **fixes** its completeness (code-runtime/failed rows now correctly included, per AC3), but does not rename it, change its type, or otherwise alter callers' expectations (stable-field-name discipline, mirroring the project's stable-error-code convention). **Numeric consequence of AC3 the story author must accept:** because the JSONB path silently excluded non-priced rows and the new column-sum path correctly includes them (now contributing `$0` per Story 15.1's explicit-zero AC4, not `NULL`), `token_cost`'s **value** for any org with code-runtime or failed invocations does not change (both paths already contributed `$0` for those rows) — only *unknown-model* legacy rows change from "$0 (fabricated, JSONB path found no metadata to parse against a still-recognized model)" to "$0 (correct, explicit NULL cost coalesced)" — i.e. no behavioral regression is expected, but the existing `test_token_cost_*` tests must be rewritten (they seed via `event_metadata`, which this story stops reading) — see Task 4.

5. **AC5 — UI renders the new breakdowns.**
   **Given** the shipped Analytics screen (Story 9.5: `OverviewTab.tsx`'s `TopSkills`, `ByUserTab.tsx`'s user chips + `SkillsUsed`)
   **When** cost is present on the API response
   **Then** Overview's Top Skills list shows each skill's cost, and By-User shows the selected user's cost alongside their existing metrics (`invocations`/`success_rate`/`hours_saved`) and each of their top skills' costs — **extending** Story 9.5's shipped screens, not replacing them. Cost renders via the existing `fmtUsd` helper (`analyticsFormat.ts`), wrapped in a null/zero-safe local helper (mirroring Story 15.2's `fmtCost` pattern — `fmtUsd` has no null guard and returns `"$NaN"` for `null`). Since this story's `cost_usd` is always a coalesced `float` (never `null` — see AC1/AC2), the FE wrapper's `null` branch is defensive only (protects against an absent/legacy API response), not a value this story's backend ever actually emits.

**Out of scope (do NOT touch):**
- Per-invocation display (Job API / Jobs History / Run Console) — already shipped by Story 15.2.
- The adapter-propose LLM cost (audit-log write path) — that is Story 15.4.
- Any change to `InvocationResult` columns, the `0024` migration, `execution_tasks.py`, `job_service.mark_completed`/`mark_blocked`, or `app/core/pricing.py`'s pricing table itself — Story 15.1 already landed all of that; this story only **reads** `InvocationResult.cost_usd` (never recomputes a price).
- Any client-portal FE type/component or `Client*` schema — analytics is already `RejectNonGrantor`-gated (admin/ma_tech only, 404s client and consultant); this story does not touch that gate.
- The `AnalyticsOverview.value_cost_avoided`/`hours_saved` value-metrics logic (`_value_metrics`) — unrelated to token cost, unchanged.

## Tasks / Subtasks

- [x] **Task 1 — Add `cost_usd` to the three response schemas (AC1, AC2) — `velara-api/app/schemas/analytics.py`**
  - [x] Add `cost_usd: float` to `SkillRun` (currently `:20-27`). No `field_serializer` needed — this is a plain `float`, not a `Decimal` (unlike Story 15.2's `JobResult`/`JobSummary`, which serialize a stored `Decimal`; here the value is a query-time SQL `SUM` you cast to `float` in the service layer before constructing the Pydantic model — see Task 2/3). Keep `skill_id`/`name`/`runs` unchanged.
  - [x] Add `cost_usd: float` to `AnalyticsUserSummary` (currently `:44-50`).
  - [x] Add `cost_usd: float` to `AnalyticsUserDetail` (currently `:76-89`) — this is the user's **own total** cost (mirrors how `hours_saved`/`invocations` are the user's own totals, distinct from `top_skills[].cost_usd` which is per-skill).
  - [x] Do **not** add `cost_usd` to `AnalyticsOverview` beyond its existing `token_cost` field (AC4 — no rename, no duplicate field) or to `WeeklyBucket`/`ActivityRow` (out of scope — no per-week or per-event cost).

- [x] **Task 2 — Rewrite `_top_skills` to join `InvocationResult` and sum cost (AC1) — `velara-api/app/services/analytics_service.py`**
  - [x] Import `InvocationResult` from `app.models.invocation` (new import — the module currently imports only `Skill` from `app.models.skill`).
  - [x] In `_top_skills` (`:131-143`), add a second `outerjoin(InvocationResult, InvocationResult.invocation_job_id == AuditLogEntry.job_id)` alongside the existing `outerjoin(Skill, ...)`, and select `func.coalesce(func.sum(InvocationResult.cost_usd), 0).label("cost_usd")` into the query. Group by must stay `(AuditLogEntry.skill_id, Skill.name)` — the join is one-to-one on `invocation_job_id`'s unique constraint, so it cannot fan out rows (same non-fan-out guarantee `job_service.list_jobs` already relies on for its own `InvocationResult` outerjoin — see `job_service.py:317-323`).
  - [x] Update the `SkillRun(...)` construction (`:143`) to pass `cost_usd=float(r.cost_usd)` (the `Numeric` SQL sum comes back as a `Decimal`; cast to `float` to match the schema's `float` type and the existing `token_cost: float` wire convention — do not leave it a `Decimal`, there is no `field_serializer` on this schema).
  - [x] Order-by/limit/tiebreaker logic (`func.count().desc(), AuditLogEntry.skill_id`) is unchanged — cost does not affect ranking (epic AC does not ask for cost-ordering; `runs` stays the sort key).

- [x] **Task 3 — Add per-user cost sum + thread through `list_users`/`user_detail` (AC2) — `velara-api/app/services/analytics_service.py`**
  - [x] In `list_users` (`:268-303`), extend the existing grouped stmt (`:278-287`) with the same `InvocationResult` outerjoin and a `func.coalesce(func.sum(InvocationResult.cost_usd), 0).label("cost_usd")` column, added to the existing `select(...)` alongside `invocations`/`success`/`skills_used`. Thread `cost_usd=float(r.cost_usd)` into the `AnalyticsUserSummary(...)` construction (`:295-302`).
  - [x] In `user_detail` (`:306-389`), add a small helper query (or extend the existing `_counts`-style pattern) that sums `InvocationResult.cost_usd` over the same `inv_where` (already scoped to `org_id`/`scope_paths`/`user_id`) via the `AuditLogEntry.job_id == InvocationResult.invocation_job_id` outerjoin, coalesced to `0.0`. Thread the result into `AnalyticsUserDetail(...)` (`:377-389`) as `cost_usd=<the sum>`.
  - [x] **Reuse, don't duplicate:** if it reads more cleanly, factor the "sum InvocationResult.cost_usd over a WHERE, coalesced to 0.0" query into one small private helper (e.g. `_cost_sum(session, *, where: list) -> float`) and call it from `_top_skills`'s per-skill-group variant is NOT the same shape (that one is grouped) — but `list_users`' per-user-group sum and `user_detail`'s single-user sum **do** share a shape; consider whether a shared helper reduces duplication without over-abstracting for a 2-caller case. Use judgment; do not force an abstraction that only serves one call site.

- [x] **Task 4 — Rewrite `_token_cost` to sum the structured column (AC3, AC4) — `velara-api/app/services/analytics_service.py`**
  - [x] Replace `_token_cost`'s body (`:162-214`) with a query joining `InvocationResult` via `AuditLogEntry.job_id == InvocationResult.invocation_job_id` and `func.coalesce(func.sum(InvocationResult.cost_usd), 0)`, cast to `float`. Remove the `event_metadata`/regex-guard/`_MODEL_PRICING`-lookup-at-query-time logic entirely — it is fully retired by this story (the column is priced once, at write time, by Story 15.1).
  - [x] Remove the now-dead `event_metadata.isnot(None)` filter from this function specifically — do **not** touch `_invocation_where`'s `outcome.isnot(None)` filter (that one distinguishes invocation-leaf rows from admin rows and fan-out parents; it is unrelated and still needed by every caller of `_invocation_where`, including this rewritten function).
  - [x] Keep the function's name (`_token_cost`) and signature (`session, *, where: list) -> float`) unchanged so `overview()`'s call site (`:253`) needs no edit — this is a pure internal rewrite.
  - [x] Remove the now-unused `from app.core.pricing import _MODEL_PRICING` import (`:20`) and the `Numeric, cast, or_` imports from `sqlalchemy` (`:16`) **only if** nothing else in the file still uses them after the rewrite — grep the file first (`or_`/`cast`/`Numeric` may still be needed elsewhere; verify before removing).

- [x] **Task 5 — Backend tests (AC1-AC4) — `velara-api/tests/integration/api/test_analytics.py`**
  - [x] **Rewrite the four existing `test_token_cost_*` tests** (`test_token_cost_computed_from_known_model_pricing`, `test_token_cost_zero_for_code_and_failure_rows_no_error`, `test_token_cost_unknown_model_contributes_zero_never_mispriced`, `test_token_cost_survives_malformed_and_huge_token_values`) — they currently seed cost via `_seed_entry(metadata={...})`, which AC3's rewrite stops reading entirely. Each must be re-seeded via a real `InvocationResult` row (see next bullet) joined to its audit row by `job_id`. The "malformed JSONB" and "huge token value" test cases are **no longer reachable** post-rewrite (a `Numeric(12,6)` column cannot hold a malformed string) — replace them with the AC1/AC3-relevant cases instead: a `cost_usd=NULL` row (unknown-model, mirrors Story 15.1's write-path contract) contributing `$0` to the sum, and a `cost_usd=0` code-runtime row contributing `$0`. Do not try to preserve the "survives malformed JSONB" test as dead code — delete it; note its removal in the Dev Agent Record (the malformed-input class it guarded against no longer exists once the read path is a typed column, not JSONB).
  - [x] **Extend `_seed_entry`** (`:148-204`) with an optional `job_id: uuid.UUID | None = None` param, threaded into the INSERT (currently the helper does not set `job_id` at all — every seeded audit row today has `job_id=NULL`, which is why the JSONB-based tests never needed a job/result pairing). Add a new local helper (e.g. `_seed_invocation_result`) that inserts a matching `InvocationJob` + `InvocationResult` row (mirror the real write-path shape: `InvocationResult.invocation_job_id` = the same UUID passed as `_seed_entry`'s `job_id`) with `cost_usd`/`input_tokens`/`output_tokens`/`model` kwargs — this is the new fixture shape every AC1-AC4 test needs. Look at `test_jobs.py`'s `_create_completed_job_with_output_files` for the `InvocationJob`+`InvocationResult` seeding pattern already established there (Story 15.2 extended it with cost kwargs) — reuse that shape's spirit rather than inventing a third seeding convention, even though it lives in a different test file.
  - [x] **New AC1 tests:** seed 2+ skills each with 1-2 priced audit+result rows; assert `overview().top_skills[i].cost_usd` sums correctly per skill; assert a skill with only a `cost_usd=NULL` result row (or no result row at all — e.g. a `queued`/`failed` job never reaching `mark_completed`) shows `cost_usd == 0.0`, never `None`/an error.
  - [x] **New AC2 tests:** seed 2 users with distinct costs; assert `list_users()` rows carry the right per-user `cost_usd`; assert `user_detail()` for one user returns the matching total plus correctly-priced `top_skills[].cost_usd` entries.
  - [x] **New AC3/AC4 tests:** seed a mix of priced/zero/null-cost rows across code-runtime and prompt/hybrid outcomes; assert `overview().token_cost` sums only the non-null `InvocationResult.cost_usd` values, coalesced to `0.0` when there are zero matching rows in scope (e.g. an org/scope with only admin events, no invocations).
  - [x] Keep every existing non-cost assertion in this file green (success-rate, weekly-series, top-skills-count/order, user-list/detail scalars, recent-activity, RBAC-gate tests) — this story only changes how cost is computed and adds `cost_usd` fields; it must not change `runs`, `invocations`, `success_rate`, ordering, or scope-fencing behavior anywhere.

- [x] **Task 6 — Regenerate the OpenAPI spec (AC1, AC2) — `velara-api`**
  - [x] Run `.venv/bin/python scripts/export_openapi.py` **on the host** (per Story 15.2's confirmed host-runnable recipe — no `docker cp` needed; the system `python3` may lack FastAPI installed, use the repo's `.venv` if present). Commit the resulting `docs/api-spec.json` diff — expect exactly 3 schema additions (`SkillRun`, `AnalyticsUserSummary`, `AnalyticsUserDetail` each gain `cost_usd`).
  - [x] `tests/integration/api/test_openapi.py` must still pass (CI diff-gates the spec).

- [x] **Task 7 — Extend the FE analytics types (AC5) — `velara-web/src/api/analytics.ts`**
  - [x] Add `cost_usd: number` to the `SkillRun` interface (`:20-24`).
  - [x] Add `cost_usd: number` to `AnalyticsUserSummary` (`:38-44`).
  - [x] Add `cost_usd: number` to `AnalyticsUserDetail` (`:64-75`).
  - [x] These are typed as non-nullable `number` (not `number | null`) — the backend always coalesces to `0`, matching AC1/AC2's contract. Do not add `| null` speculatively.

- [x] **Task 8 — Render cost in Overview's Top Skills (AC5) — `velara-web/src/features/analytics/components/OverviewTab.tsx`**
  - [x] In `TopSkills` (`:77-104`), add a per-row cost figure next to the existing `runs` count (`:99`) — e.g. a right-aligned `fmtCost(s.cost_usd)` beside or below the existing `fmtNum(s.runs)` span. Add a small local `fmtCost` helper (mirroring Story 15.2's FE pattern): `const fmtCost = (v: number) => fmtUsd(v)` is sufficient here since the value is never null (Task 7), but keep the wrapper for consistency with ByUserTab (Task 9) and in case a future null case is added — a bare inline `fmtUsd(s.cost_usd)` call is also acceptable given the non-null contract; use judgment on whether a wrapper adds value here.
  - [x] Import `fmtUsd` (already imported at `:4`) — no new import needed for this component.

- [x] **Task 9 — Render cost in By-User (AC5) — `velara-web/src/features/analytics/components/ByUserTab.tsx`**
  - [x] In the user header card's metrics row (`:196-207`), add a fourth stat tile: `[fmtUsd(detail.cost_usd), 'LLM cost']` (or similar label), following the existing `[val, label]` tuple-array pattern already used for invocations/success-rate/hours-saved.
  - [x] In `SkillsUsed` (`:50-70`), add each skill's cost next to its `runs` count (`:61`), mirroring Task 8's OverviewTab change — same rendering approach, applied to the smaller per-user skill list.
  - [x] Import `fmtUsd` from `@/features/analytics/analyticsFormat` (currently only `fmtNum, fmtPct, fmtMs, fmtTrend` are imported at `:6` — add `fmtUsd` to that import list).

- [x] **Task 10 — FE tests (AC5) — `velara-web`**
  - [x] **`src/features/analytics/components/AnalyticsScreen.test.tsx`:** the `OVERVIEW`/`USERS`/`makeDetail(...)` fixtures (`:16-40+`) currently omit `cost_usd` — add it to each (`top_skills[].cost_usd`, user summary `cost_usd`, detail `cost_usd`) so the fixtures satisfy the extended TS interfaces (a missing required field is a compile error under Task 7's non-nullable typing, so this file will not typecheck until fixed regardless of whether new assertions are added). Add at least one assertion per tab that the new cost figure renders (`screen.getByText(...)` on the formatted `fmtUsd` output), following the file's existing pattern.
  - [x] Confirm `npm run typecheck` catches any other fixture in the test suite constructing a `SkillRun`/`AnalyticsUserSummary`/`AnalyticsUserDetail` object literal that would now be missing the required field — fix each one found.

- [x] **Task 11 — Gates**
  - [x] **BE:** rebuild the api image before pytest (`docker compose build api` — source is baked, not mounted). Run with `AUTH_BACKEND=dev` (`docker-compose.yml` defaults `api` to `cognito`, which 401s dev-token tests — the documented gotcha hit in Stories 15.2/15.6). Green: `tests/integration/api/test_analytics.py` (full file, including the rewritten cost tests), `test_openapi.py`, then the full suite. Note the one documented pre-existing flake (`test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped`) so it is not mistaken for a regression.
  - [x] `ruff check` on all changed BE files → clean.
  - [x] Confirm the **only** `docs/api-spec.json` diff is the 3 schema additions (`git diff docs/api-spec.json`) and it is committed.
  - [x] Confirm **no** migration, **no** new endpoint, **no** `Client*` schema/route change, **no** edit to `app/core/pricing.py` or `execution_tasks.py` (`git status`/`git diff` review).
  - [x] **FE:** `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint`), `npm test` (`vitest run`) — all clean/green.

## Dev Notes

### The core seam: there is no FK from audit rows to InvocationResult — join on `job_id`

`AuditLogEntry.job_id` (`app/models/audit.py:183-186`) is a plain indexed `UUID` column, deliberately **not** a real foreign key ("mirrors invocation_id's prior soft-reference treatment in 0006"). It is populated at the real write path — every `audit_service.record_invocation(...)` call in `execution_tasks.py` passes `job_id=job.id` (or `job_id=parent_uuid` for the fan-out parent), where `job.id` is the same `InvocationJob.id` that `InvocationResult.invocation_job_id` uniquely references (`uq_invocation_results_invocation_job_id`). Story 15.2 already established the exact idiom this story needs — `job_service.list_jobs`'s `.outerjoin(InvocationResult, InvocationResult.invocation_job_id == InvocationJob.id)` (`job_service.py:320-323`) — except there the join partner is `InvocationJob.id` (job_service already has the job row in scope); here in `analytics_service.py` the join partner is `AuditLogEntry.job_id` (analytics never queries `InvocationJob` directly today, only `AuditLogEntry`). Both joins are one-to-one on `InvocationResult`'s unique constraint, so **neither can fan out rows** — a `GROUP BY` after the join is always safe.

### Fan-out is already handled correctly by the existing audit rows — do not add fan-out-specific logic

Both a fan-out parent and each fan-out child get their own `audit_log_entries` row (parent: `fan_out=True`, its own `job_id`; children: `fan_out=False`, `parent_invocation_id` set, each their own `job_id`) AND their own `InvocationResult` row (`execution_tasks.py` calls `mark_completed` once per child job, and once more for the parent with a rolled-up `cost_usd` — see `job_service.mark_completed`'s Story 15.1 docstring). `_invocation_where`'s existing `outcome.isnot(None)` filter already excludes admin rows but **includes** both fan-out parent and child leaf rows (this is pre-existing, unchanged behavior — re-read the `_invocation_where` docstring at `analytics_service.py:66-71` before touching it). Because parent and child rows each have their own correctly-priced `InvocationResult`, a naive per-row join-and-sum does **not** double-count — you are not summing "parent roll-up + each child's individual cost" for the same dollars, because parent and child are lexically distinct audit rows contributing to (potentially) distinct `skill_id`/`user_id` groupings in `_top_skills`/`list_users`. Do not add any fan-out-exclusion filter that isn't already there; if a test surfaces unexpected doubling, re-verify against `execution_tasks.py`'s actual write behavior before assuming the join is wrong.

### `_token_cost`'s regex-guard existed only because JSONB can be malformed — a typed column can't be

`_token_cost` today (`analytics_service.py:162-214`) has substantial defensive logic — a regex check (`^[0-9]+(\.[0-9]+)?$`) guarding the `CAST(... AS Numeric)` calls, specifically because `event_metadata` is free-form JSONB on an **append-only** table (one malformed historical row would otherwise 22P02 the whole aggregate forever, per the function's own docstring). `InvocationResult.cost_usd` is a `Numeric(12,6)` **typed column** — it is structurally impossible for it to hold a non-numeric value. AC3's rewrite retires this entire defensive apparatus, not just the pricing lookup. Do not port the regex guard forward "just in case" — it would be dead code protecting against an input shape (malformed JSONB text) that no longer exists on this read path.

### `SUM(...) ` over zero or all-NULL rows is SQL `NULL` — every sum in this story must be `COALESCE`d

Postgres's `SUM()` returns `NULL`, not `0`, when there are zero rows in the group or every summed value is `NULL` (e.g. a skill whose every invocation is `queued`/`failed`-before-completion, with no `InvocationResult` row at all yet, or a user whose only jobs are unknown-model prompt runs with `cost_usd=NULL`). AC1/AC2/AC3 all require `0.0` in these cases, not `None`/a dropped field — wrap every new sum in `func.coalesce(func.sum(...), 0)` at the SQL level (cheaper and clearer than coalescing in Python after the fact). This is the same null-vs-zero discipline Story 15.1/15.2 established for the per-invocation figure, applied here at the aggregate level — the difference is that at the **aggregate** level, "no priced data in scope" legitimately collapses to a real `0.0` (there is no equivalent to per-invocation's "unknown ≠ zero" distinction once you are summing across many rows; an aggregate of zero known-cost rows is unambiguously "no cost incurred that we can attribute", not "unknown"). Do not read Story 15.2's per-row null-vs-zero rule as applying unchanged to this story's per-skill/per-user aggregates — coalescing to 0 here is correct, not a regression of that rule.

### Existing `test_token_cost_*` tests are testing the wrong thing after this story — rewrite, don't patch

Four tests in `test_analytics.py` (`test_token_cost_computed_from_known_model_pricing`, `test_token_cost_zero_for_code_and_failure_rows_no_error`, `test_token_cost_unknown_model_contributes_zero_never_mispriced`, `test_token_cost_survives_malformed_and_huge_token_values`) seed cost purely via `_seed_entry(metadata={...})` — i.e. they write `event_metadata` JSONB and never touch `InvocationResult` at all. After AC3's rewrite, `_token_cost` never reads `event_metadata` — these tests would pass trivially (asserting `token_cost == 0.0` against a code path that no longer looks at their seeded data) or fail outright, and either way stop testing anything real. They must be re-seeded against a real `InvocationResult` row joined by `job_id` (see Task 5) or deleted where their premise (malformed JSONB survival) no longer applies. This is the single highest-risk correctness trap in this story: it is easy to leave these tests "passing" while they silently test nothing.

### `_seed_entry` has never set `job_id` — every existing seeded row is an orphan by this story's new join

Every call site of `_seed_entry` across the existing test file passes no `job_id` (the helper doesn't even accept the param today), so every previously-seeded audit row has `job_id=NULL` in the DB. Under this story's new `InvocationResult` outerjoin, a `NULL` `job_id` simply never matches any `InvocationResult` row — `cost_usd` for that row's group contributes `0` via the `COALESCE`, which is actually the **correct**, safe default for all the *other* (non-cost) tests in this file that don't care about cost at all (they keep passing unaffected). Only the tests that need a real priced sum must be updated to pass a real `job_id` + seed a matching `InvocationResult` (Task 5's new `_seed_invocation_result` helper). Do not feel obligated to retrofit `job_id` onto every existing `_seed_entry` call in the file — only the cost-relevant tests need it.

### Files being modified (read current state before editing)

**velara-api:**
- `app/schemas/analytics.py` — `SkillRun` (`:20-27`, +`cost_usd: float`), `AnalyticsUserSummary` (`:44-50`, +`cost_usd: float`), `AnalyticsUserDetail` (`:76-89`, +`cost_usd: float`). `AnalyticsOverview`/`WeeklyBucket`/`ActivityRow`/`AnalyticsUsersData` untouched.
- `app/services/analytics_service.py` — new `InvocationResult` import; `_top_skills` (`:131-143`, +outerjoin +cost sum); `_token_cost` (`:162-214`, full rewrite — JSONB parse → structured-column sum); `list_users` (`:268-303`, +outerjoin +cost sum); `user_detail` (`:306-389`, +cost sum). `overview()`'s call to `_token_cost` (`:253`) unchanged (same signature). `_scope_where`/`_empty_scope`/`_invocation_where`/`_weekly_series`/`_counts`/`_success_rate`/`_value_metrics`/`_user_names`/`_densify_weekly`/`_window_start` all unchanged.
- `docs/api-spec.json` — regenerated (Task 6).
- `tests/integration/api/test_analytics.py` — `_seed_entry` (+`job_id` param), new `_seed_invocation_result`-style helper, 4 existing `test_token_cost_*` tests rewritten/replaced, new AC1/AC2 tests.

**velara-web:**
- `src/api/analytics.ts` — `SkillRun`, `AnalyticsUserSummary`, `AnalyticsUserDetail` interfaces (+`cost_usd: number` each).
- `src/features/analytics/components/OverviewTab.tsx` — `TopSkills` (`:77-104`) per-row cost.
- `src/features/analytics/components/ByUserTab.tsx` — user header metrics row (`:196-207`, +cost tile), `SkillsUsed` (`:50-70`, +per-skill cost); import `fmtUsd`.
- `src/features/analytics/components/AnalyticsScreen.test.tsx` — fixtures extended with `cost_usd`; new render assertions.
- **Untouched:** `src/features/audit/**`, any client-portal path, `useAnalytics.ts` hooks (no new query params/keys — same 3 endpoints, richer payloads only).

### Reference render for the FE cost pattern

Story 15.2 established the FE null-safety idiom for cost rendering (`fmtCost` wrapping `fmtUsd`) in `JobsHistory.tsx`/`RunConsole.tsx` — this story's values are never null (Task 7), so a bare `fmtUsd(v)` call is technically sufficient, but keep the visual/formatting convention (right-aligned mono figure near a count, `compact=false` so cents show for small per-skill/per-user figures — reserve `compact=true` for the existing big platform-wide `value_cost_avoided` tile) consistent with the rest of the screen.

### Testing standards

- **BE:** pytest under `docker compose exec -e AUTH_BACKEND=dev api`; **rebuild the api image first**. Seed both an `AuditLogEntry` (via `_seed_entry`, extended with `job_id`) and a matching `InvocationJob`+`InvocationResult` pair for every cost-relevant test; assert via the actual endpoint response (`overview()`/`list_users()`/`user_detail()` service calls, or the HTTP routes — follow this file's existing mixed pattern of calling the service function directly in most tests and the HTTP client only for the RBAC-gate tests at the top of the file).
- **FE:** vitest + `@testing-library/react`; extend `AnalyticsScreen.test.tsx`'s fixtures. Gates: `npm run typecheck`, `npm run lint`, `npm test`.

### Project Structure Notes

- No new files on either side — all edits land in existing schemas/services/components/tests. No migration, no new module, no new route.
- FE types are hand-written (no OpenAPI codegen in `velara-web`); `src/api/analytics.ts` must be kept in lockstep with the BE schemas by hand, same convention as `src/api/jobs.ts` (Story 15.2).
- velara-web is currently on branch `story/14-2-ai-adapter-upgrade-path` (still not switched back to `main`/`development` after 14.2/15.2 — a known housekeeping state noted in prior reviews). Implement here; code-review handles branch/commit hygiene per the never-push-subrepos rule (dev-story does not commit the subrepos).
- velara-api is currently on branch `development` at `118639a` (Story 15.2's commit, tip of branch) — implement on top of this baseline.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-15-per-execution-cost-tracking.md#Story 15.3]
- [Source: _bmad-output/implementation-artifacts/stories/15-1-persist-structured-per-execution-cost.md] — the four `InvocationResult` columns this story reads; the null-vs-zero write-path semantics this story's aggregates must coalesce correctly.
- [Source: _bmad-output/implementation-artifacts/stories/15-2-surface-per-invocation-cost-job-api-ui.md] — the `job_service.list_jobs` outerjoin idiom this story mirrors; the `fmtCost`/`fmtUsd`-null-guard FE pattern; the Decimal-serialization lesson (not directly applicable here since these fields are plain `float`, not stored `Decimal`, but the same wire-shape discipline applies).
- [Source: velara-api/app/models/invocation.py#L160-L217] — `InvocationResult` columns + `uq_invocation_results_invocation_job_id` unique constraint (the join-safety guarantee).
- [Source: velara-api/app/models/audit.py#L183-L186] — `AuditLogEntry.job_id`, the soft-reference join key (not a real FK).
- [Source: velara-api/app/services/job_service.py#L270-L323] — `list_jobs`'s `InvocationResult` outerjoin (the idiom to mirror), including its "cannot fan out rows" reasoning.
- [Source: velara-api/app/services/analytics_service.py#L131-L214,#L268-L389] — `_top_skills`, `_token_cost` (full rewrite target), `list_users`, `user_detail`.
- [Source: velara-api/app/schemas/analytics.py#L20-L89] — `SkillRun`, `AnalyticsUserSummary`, `AnalyticsUserDetail` (all three extend).
- [Source: velara-api/app/core/pricing.py] — `compute_cost_usd`/`_MODEL_PRICING`; this story does NOT call this module (it sums an already-priced column) — referenced only to confirm no duplicate pricing logic is needed.
- [Source: velara-api/app/workers/execution_tasks.py#L365-L704] — `record_invocation(job_id=job.id, ...)` call sites confirming the `job_id` ↔ `InvocationResult.invocation_job_id` correspondence, including the fan-out parent/child pairing.
- [Source: velara-api/tests/integration/api/test_analytics.py#L109-L204,#L443-L572] — `_seed_skill_and_version`/`_seed_entry` helpers (extend); the 4 existing `test_token_cost_*` tests (rewrite/replace).
- [Source: velara-web/src/api/analytics.ts] — FE `SkillRun`/`AnalyticsUserSummary`/`AnalyticsUserDetail` interfaces (hand-written, mirror BE).
- [Source: velara-web/src/features/analytics/components/OverviewTab.tsx#L77-L104] — `TopSkills` (shared render target for AC5).
- [Source: velara-web/src/features/analytics/components/ByUserTab.tsx#L50-L70,#L196-L207] — `SkillsUsed`, user header metrics row.
- [Source: velara-web/src/features/analytics/analyticsFormat.ts#L14-L22] — `fmtUsd` (no null guard — wrap defensively per Task 8/9 guidance).
- [Source: velara-web/src/features/analytics/components/AnalyticsScreen.test.tsx#L16-L40] — existing fixtures to extend with `cost_usd`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Code)

### Debug Log References

None — no test/gate failures required debugging beyond one FE assertion fix (a `getByText('$19.99')` ambiguous-match, resolved by switching to `getAllByText` since the fixture's single skill accounts for the whole user cost).

### Completion Notes List

- Rewrote `_top_skills`, `_token_cost`, `list_users`, `user_detail` in `analytics_service.py` to join `InvocationResult` via `AuditLogEntry.job_id == InvocationResult.invocation_job_id` and sum `cost_usd` (`COALESCE`d to 0), replacing `_token_cost`'s JSONB-parsing/regex-guard/`_MODEL_PRICING`-lookup body entirely (AC3). `user_detail`'s own cost total reuses `_token_cost` directly against its already-user-scoped `inv_where` (avoided a redundant single-purpose helper — `list_users`' grouped per-user sum is a genuinely different query shape and was inlined there instead, per the story's "use judgment" guidance).
- Added `cost_usd: float` to `SkillRun`, `AnalyticsUserSummary`, `AnalyticsUserDetail` (`app/schemas/analytics.py`). No `field_serializer` needed (plain float, not a stored Decimal).
- Removed now-unused imports (`Numeric`, `cast`, `or_` from sqlalchemy; `_MODEL_PRICING` from `app.core.pricing`) after confirming (via grep) nothing else in the file still used them.
- Rewrote the 4 `test_token_cost_*` tests against real `InvocationResult` rows (new `_seed_invocation_result` helper mirroring `test_jobs.py`'s `_create_completed_job_with_output_files` shape) instead of `event_metadata` JSONB; deleted the "survives malformed/huge JSONB" test per the story's instruction (unreachable once the column is typed) and replaced it with a coalesce-to-zero-with-zero-matching-rows test. Extended `_seed_entry` with an optional `job_id` param (defaults `None`, preserving every pre-existing call site's orphan-row behavior). Added new AC1/AC2 tests (per-skill sum incl. NULL-cost + no-result-row cases, per-user sum, user_detail cost+top_skills consistency).
- Regenerated `docs/api-spec.json` — diff isolated to the 3 expected schema additions (`SkillRun`, `AnalyticsUserSummary`, `AnalyticsUserDetail` each gain `cost_usd`).
- FE: extended the 3 hand-written interfaces in `src/api/analytics.ts` (non-nullable `number`, matching the backend's always-coalesced contract). Rendered cost in `OverviewTab.tsx`'s `TopSkills` (per-row, next to `runs`) and `ByUserTab.tsx` (new "LLM cost" header tile + per-skill cost in `SkillsUsed`), reusing `fmtUsd` directly (no wrapper needed — the value is never null per Task 7/AC5's non-nullable contract, per the story's own guidance that a bare `fmtUsd(v)` call is acceptable here).
- Extended `AnalyticsScreen.test.tsx` fixtures with `cost_usd` on all three types + added render assertions per tab (Overview per-skill cost figures; By-User header "LLM cost" tile). Confirmed via `npm run typecheck` that no other fixture in the suite constructs these types.
- Gates: BE full suite 1543 passed / 1 pre-existing flake (`test_repeated_denials_are_deduped`) / 3 skipped, ruff clean (api rebuilt + worker rebuilt); FE `tsc --noEmit` clean, eslint clean (1 pre-existing unrelated warning), 735/735 vitest tests passed. `git status` confirms only the 4 expected BE files + 5 expected FE files changed — no migration, no `pricing.py`/`execution_tasks.py` edit, no `Client*` change.

### File List

**velara-api:**
- `app/schemas/analytics.py`
- `app/services/analytics_service.py`
- `docs/api-spec.json`
- `tests/integration/api/test_analytics.py`

**velara-web:**
- `src/api/analytics.ts`
- `src/features/analytics/components/OverviewTab.tsx`
- `src/features/analytics/components/ByUserTab.tsx`
- `src/features/analytics/components/AnalyticsScreen.test.tsx`

## Change Log

- 2026-07-22 — Drafted Story 15.3 (per-skill and per-user cost analytics). Rewrites `analytics_service.py`'s cost aggregation from JSONB-parsing (`_token_cost`) to a structured-column `InvocationResult` join (`AuditLogEntry.job_id == InvocationResult.invocation_job_id`, mirroring Story 15.2's `job_service.list_jobs` outerjoin idiom) across three functions (`_top_skills`, `_token_cost`, plus new per-user sums in `list_users`/`user_detail`). Adds `cost_usd: float` to `SkillRun`, `AnalyticsUserSummary`, `AnalyticsUserDetail` (all coalesced to 0.0, never null). FE: extend the 3 hand-written types + render cost in Overview's Top Skills and By-User's header/skills-used, reusing `fmtUsd`. Existing `test_token_cost_*` tests (seeded via `event_metadata`) must be rewritten against real `InvocationResult` rows — flagged as the story's highest-risk trap. No migration, no new endpoint, no client-facing change, no pricing-table change.
- 2026-07-22 — Implemented Story 15.3 (dev-story). All 11 tasks complete: BE cost aggregation rewired to the structured `InvocationResult` column across `_top_skills`/`_token_cost`/`list_users`/`user_detail`; 4 legacy JSONB-seeded cost tests rewritten + 6 new AC1/AC2/AC3/AC4 tests added; `docs/api-spec.json` regenerated (3 schema additions only). FE: 3 hand-written types extended, cost rendered in Overview Top Skills + By-User header/skills-used. Gates: BE 1543/1544 (1 pre-existing flake), ruff clean; FE tsc/eslint clean, 735/735 tests passed.
