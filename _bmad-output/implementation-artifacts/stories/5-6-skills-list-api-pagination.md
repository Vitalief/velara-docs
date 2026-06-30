---
baseline_commit: a111997cfb1267cc9f8ca1c0fb89fa9c4698da4e
---

# Story 5.6: Skills List API Pagination

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform developer,
I want `GET /api/v1/skills` to paginate its results,
so that the skill registry stays fast regardless of how many skills exist in an org.

> **BACKEND-ONLY story** (FastAPI 0.115.6 + SQLAlchemy 2.0 async + Pydantic 2.10.4 + Python 3.12). No frontend, no migration, no new dependency. **Added via correct-course 2026-06-12** — root cause surfaced in the 5-2 review + dev-DB cleanup: `skill_service.list_skills` returns the WHOLE org via `.scalars().all()` with no `LIMIT/OFFSET` (`skill_service.py:341-361`) → the registry is slow at ~3,485 rows.
>
> **MIRROR THE 5-4 PRECEDENT — do NOT invent a new pattern.** Story 5-4 just built the codebase's first paginated endpoint (`GET /api/v1/jobs`) and its `JobListData` schema docstring **explicitly says "5-6 (skills pagination) will follow this same pattern."** Copy it exactly: `SkillListData{items, page}` inside `ResponseEnvelope` + `PageMeta` + a `list_skills(...) -> tuple[rows, total]` service with `func.count()` + `.limit/.offset`. See *Dev Notes → Mirror the jobs endpoint*.
>
> **⚠️ This CHANGES the `GET /api/v1/skills` response shape (breaking).** Today `data` is a bare array (`ResponseEnvelope[list[SkillRead]]`); after 5-6 `data` is `{items, page}` (`ResponseEnvelope[SkillListData]`). The frontend `listSkills` (`velara-web/src/api/skills.ts:4-6`) reads `response.data.data` as `Skill[]` and **will break** — but **Story 5-7 (frontend) is the explicit consumer that adapts** (5-6 builds first; 5-7 depends on it). The note's "backwards-compatible default" means *param defaults* (omit page → page 1), NOT the envelope shape. See *Dev Notes → Breaking shape change + 5-7 coordination*.

## Acceptance Criteria

**AC1 — Paginated, ordered, filters preserved**
**Given** I call `GET /api/v1/skills?page=1&per_page=50`
**When** the org has more than `per_page` skills
**Then** at most `per_page` skills are returned, ordered `created_at desc`, with the existing `?status=` / `?tag=` filters still honored (default `page=1`, `per_page=50`, max `per_page=200`)
> Add `.limit(per_page).offset((page-1)*per_page)` to the existing `select(Skill).where(org_id)...order_by(created_at.desc())` query. **Keep the exact existing filter logic** (`?status=` against `lifecycle_state`; `?tag=` JSONB containment with the empty-tag = no-filter guard at `skill_service.py:354-358`). Keep `order_by(Skill.created_at.desc())`.

**AC2 — `PageMeta` in the envelope**
**Given** the paginated list response
**When** I inspect the envelope
**Then** it carries pagination metadata via `PageMeta` (`total`, `page`, `per_page`) — `total` reflects the **filtered** count (status+tag applied to the COUNT as well)
> `PageMeta` already exists (`app/schemas/common.py:35-40`: `total/page/per_page`) and is consumed by `JobListData` (5-4). Mirror it: a new `SkillListData{items: list[SkillRead]; page: PageMeta}` placed inside `data`. **The COUNT must apply the SAME `status`/`tag` filters as the rows query** (a separate `select(func.count()).select_from(Skill).where(*same_filters)` — exactly as `job_service.list_jobs:223-229` does).

**AC3 — Out-of-range + invalid params**
**Given** I request a `page` beyond the last page
**When** the query runs
**Then** `data.items` is an empty list with the correct `total` (not a 404); invalid `page`/`per_page` (≤0 or `per_page` > max) return HTTP 422
> Use `page: Annotated[int, Query(ge=1)] = 1` and `per_page: Annotated[int, Query(ge=1, le=200)] = 50` (FastAPI auto-422s out-of-bounds — exactly `jobs.py:58-59`). An out-of-range page yields empty `items` + correct `total` naturally (offset past the end returns no rows; the COUNT is independent).

**AC4 — Backwards-compatible param defaults**
**Given** existing callers that pass no pagination params
**When** they call `GET /api/v1/skills`
**Then** they get page 1 at the default page size (`per_page=50`), with the Story 2.1 `?status=` filter behavior preserved
> "Backwards compatible" here = **param defaults**, NOT response shape. Omitting `page`/`per_page` returns the first 50 newest skills. The **response envelope shape DOES change** (`data` array → `{items, page}`) — that's intended and is what 5-7 consumes. Update the two existing list tests that assert the old array shape (Task 3).

## Scope

**5-6 BUILDS:**
- **`SkillListData{items: list[SkillRead]; page: PageMeta}`** schema in `app/schemas/skill.py` (parallel to `JobListData` in `job.py`).
- **`skill_service.list_skills` → `tuple[list[Skill], int]`** — add `LIMIT/OFFSET` + a filtered `func.count()`; keep filters + ordering.
- **`skills.py` `list_skills` handler** — add `page`/`per_page` `Query` params, build `SkillListData` + `PageMeta`, return `ResponseEnvelope[SkillListData]`.
- **Tests** — pagination (limit/offset, total, out-of-range empty, 422 on invalid), filter-applies-to-count, backwards-compat default; **update** the two existing list tests to the new shape.

**5-6 DEFERS / OUT OF SCOPE:**
- **Frontend changes** → Story 5-7 (consumes this contract; builds after 5-6). Do NOT touch `velara-web`.
- **Pagination for other list endpoints** (`clients/projects/studies/locations`) — not in scope; `list_jobs` (5-4) + `list_skills` (5-6) are the only two. The architecture note says future list endpoints *should* adopt this shape, but that's later work.
- **Cursor/keyset pagination, sort params, search** — offset/limit only, fixed `created_at desc` order. No new query params beyond `page`/`per_page`.
- **No migration** (read-only query change). **No new dependency.**

## Tasks / Subtasks

- [x] **Task 0 — Read the 5-4 jobs precedent FIRST (AC: 1, 2, 3)**
  - [x] Read `app/services/job_service.py:202-241` (`list_jobs` — the `tuple[rows, total]` + `func.count()` + `.limit/.offset` shape), `app/api/v1/jobs.py:53-85` (the handler — `Annotated[int, Query(ge=1)]`, `SkillListData`/`PageMeta` assembly, `ResponseEnvelope[JobListData]`), and `app/schemas/job.py:116-147` (`JobSummary`/`JobListData`). **Mirror this exactly for skills.** The `JobListData` docstring even names 5-6 as the next adopter.

- [x] **Task 1 — `SkillListData` schema (AC: 2)**
  - [x] Add to `app/schemas/skill.py`: `class SkillListData(BaseModel): items: list[SkillRead]; page: PageMeta`. Import `PageMeta` from `app.schemas.common` (mirror `job.py:10`). A docstring noting it follows the `JobListData` pattern. `SkillRead` already exists (`:181`) — reuse it unchanged (the list still returns full `SkillRead` rows, same as today — only the wrapper changes).

- [x] **Task 2 — Paginate `skill_service.list_skills` (AC: 1, 2, 3)**
  - [x] Change the signature to `list_skills(*, session, org_id, page: int, per_page: int, status=None, tag=None) -> tuple[list[Skill], int]`. Build the shared `where` filters once (org_id + optional status + optional tag, keeping the empty-tag guard at `skill_service.py:354-358`). Then:
    - **Count:** `total = (await session.execute(select(func.count()).select_from(Skill).where(*filters))).scalar_one()` — SAME filters (AC2).
    - **Rows:** the existing `select(Skill).where(*filters).order_by(Skill.created_at.desc()).limit(per_page).offset((page-1)*per_page)` → `list((await session.execute(...)).scalars().all())`.
    - Return `(rows, total)`.
  - [x] Import `func` from sqlalchemy if not already imported in `skill_service.py` (check; `job_service.py` imports it).

- [x] **Task 3 — Handler + envelope (AC: 1, 2, 3, 4)**
  - [x] In `skills.py` `list_skills` (`:85-108`): add params `page: Annotated[int, Query(ge=1)] = 1`, `per_page: Annotated[int, Query(ge=1, le=200)] = 50` (import `Annotated` from typing + `Query` from fastapi — mirror `jobs.py:14,17`). Keep `status: LifecycleState | None = None` and `tag: str | None = None` UNCHANGED (`LifecycleState` is a `Literal` → FastAPI already 422s bad values; no separate status-literal needed, unlike jobs).
  - [x] Call `rows, total = await skill_service.list_skills(...)`, build `data = SkillListData(items=[SkillRead.model_validate(s) for s in rows], page=PageMeta(total=total, page=page, per_page=per_page))`, return `ResponseEnvelope(data=data, meta=_meta(request))`. Change the `response_model` to `ResponseEnvelope[SkillListData]`.
  - [x] Update the handler docstring to document the new params + shape.

- [x] **Task 4 — Tests (AC: 1, 2, 3, 4)**
  - [x] **Update the two existing list tests** (`tests/integration/api/test_skills.py`) that assert the OLD array shape: `test_list_skills_no_filter_returns_all:236` (asserts `isinstance(body["data"], list)` → now `body["data"]["items"]` is a list + `body["data"]["page"]` has `total/page/per_page`) and `test_list_skills_status_filter:247` (`[s["id"] for s in resp.json()["data"]]` → `...["data"]["items"]`). The `?tag=` tests at `:405`, `:603`, `:624` also read `resp.json()["data"]` — update them to `["data"]["items"]`. **These are required updates, not regressions** — the shape change is the story.
  - [x] **New tests** (mirror `test_jobs.py`'s list tests): `per_page` limits the row count; `page=2` returns the next slice (seed > per_page skills with staggered `created_at`); `total` reflects the full filtered count (not the page size); out-of-range page → empty `items` + correct `total` (not 404); invalid params (`page=0`, `per_page=0`, `per_page=201`) → 422; **`?status=`/`?tag=` applied to BOTH rows and `total`** (AC2 — seed mixed, filter, assert `total` == filtered count). Cross-org isolation already covered elsewhere; add if cheap.
  - [x] Gates: `ruff check .` clean; Docker suite green (`docker compose exec api pytest` — baseline 58 tests in `test_skills.py` / ~570 total; state your delta). **No migration.**

## Review Findings

_Code review 2026-06-25 (bmad-code-review): 3 layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 2 decision-needed, 2 patch, 1 deferred, 1 dismissed._

- [x] [Review][Patch] (was Decision; resolved 2026-06-25 → fix BOTH endpoints; FIXED) No tiebreaker on `created_at desc` → unstable pagination across pages on timestamp ties [app/services/skill_service.py + app/services/job_service.py] — Blind+Edge: rows_stmt orders only by `created_at.desc()`. `create_skill` stamps `created_at = datetime.now(UTC)` (reused for skill + version), so bulk/derive/same-microsecond creates yield identical timestamps. With LIMIT/OFFSET over a non-unique sort key, Postgres returns tied rows in an arbitrary, run-unstable order → a row can be skipped or duplicated across page boundaries. Mirrored `list_jobs` had the IDENTICAL ordering. **FIXED:** added `.order_by(..., <model>.id.desc())` PK tiebreaker to BOTH `list_skills` (`skill_service.py:371`) and `list_jobs` (`job_service.py:236`).
- [x] [Review][Patch] (was Decision; resolved 2026-06-25 → fix BOTH endpoints; FIXED) Unbounded `page` → giant OFFSET (deep-pagination perf trap; extreme values → Postgres bigint overflow → 500) [app/api/v1/skills.py + app/api/v1/jobs.py] — Blind+Edge: `page: Annotated[int, Query(ge=1)]` had no `le=` upper bound; `(page-1)*per_page` goes straight to Postgres OFFSET (bigint). A `page` ≳ 10^17 exceeds the bigint ceiling → asyncpg `OutOfRange` → unhandled 500, contradicting the docstring's "out-of-range page → empty items (not 404)". Inherited verbatim from the unbounded `list_jobs` precedent. **FIXED:** added `Query(ge=1, le=100_000)` upper bound + docstring update to BOTH `skills.py` and `jobs.py` list handlers; new regression test `test_pagination_page_exceeds_max_returns_422`.
- [x] [Review][Patch] (FIXED) Existing `test_artifact_key_not_exposed` not migrated to new shape → vacuous false-pass [tests/integration/api/test_skills.py:306] — Edge+Auditor (verified directly): the list-endpoint half of this IP-protection test still did `for skill in list_resp.json()["data"]:`. `data` is now the `SkillListData` object `{items, page}`, so iterating it yielded the string keys `"items"`/`"page"`; `assert "artifact_key" not in skill` became a substring check that passed vacuously — list-endpoint IP-protection coverage was silently lost. The 5 named tests were updated but this 6th list-consumer was missed. **FIXED:** now iterates `list_resp.json()["data"]["items"]`.
- [x] [Review][Patch] (FIXED) `test_pagination_filter_applies_to_total` can't fail for the bug it targets (weak assertion) [tests/integration/api/test_skills.py] — Auditor: asserted `total >= 1` / `total >= len(items)` against a shared, cross-seeded org, so an unfiltered COUNT would also satisfy them. **FIXED:** added assertions that each per-status `total` is *strictly less than* the unfiltered total and that `draft_total + ready_total <= all_total` — these fail if the filter is dropped from the count query. (AC2 was already independently proven by `test_pagination_tag_filter_applies_to_total` via a unique tag → `total == 1`.)

> **Bonus fix:** the dev's two new status-filter test lines exceeded ruff's 100-char limit (`E501`) — the "ruff clean" gate had actually been red on the under-review change. Wrapped both; `ruff check` now clean across all 6 touched files.
- [x] [Review][Defer] COUNT and ROWS are two separate round-trips → `total` and `items` can disagree under concurrent writes [app/services/skill_service.py:364-374] — deferred, inherent to offset pagination. Edge: the count and rows statements execute as independent queries under READ COMMITTED; a concurrent `create_skill` commit between them makes `total` reflect a different row set than `items`. Inherent to the offset-pagination pattern, shared with the `list_jobs` precedent, and not scoped by the story (no snapshot-isolation requirement). Real but not actionable in this change.

## Dev Notes

### Mirror the jobs endpoint (5-4) — the exact template (verified as-built)
5-4 built the first paginated endpoint; copy its three pieces verbatim-in-spirit:
- **Service** (`job_service.py:202-241`): `async def list_jobs(*, session, org_id, page, per_page, status_filter=None) -> tuple[list[...], int]`. Builds `base_where` once, runs `select(func.count()).select_from(...).where(*base_where)` → `.scalar_one()` for `total`, then `select(...).where(*base_where).order_by(created_at.desc()).limit(per_page).offset((page-1)*per_page)`. Returns `(rows, total)`. **Skills is simpler** — no outer-join (skills don't need a joined name), so `select(Skill)` + `.scalars().all()`.
- **Handler** (`jobs.py:53-85`): `@router.get("", response_model=ResponseEnvelope[JobListData])`, params `page: Annotated[int, Query(ge=1)] = 1`, `per_page: Annotated[int, Query(ge=1, le=200)] = 50`. Assembles `JobListData(items=[...], page=PageMeta(total, page, per_page))`, returns `ResponseEnvelope(data=..., meta=_meta(request))`.
- **Schema** (`job.py:138-147`): `class JobListData(BaseModel): items: list[JobSummary]; page: PageMeta`. **Its docstring literally says "5-6 (skills pagination) will follow this same pattern."** — so use `SkillListData{items: list[SkillRead]; page: PageMeta}`.
> Difference vs jobs: skills returns the **full `SkillRead`** rows (unchanged from today), not a slimmed summary — only the wrapper changes. And skills' `status` filter already uses `LifecycleState` (a `Literal` → auto-422), so no new status-literal type is needed (jobs added `JobStatusLiteral` because jobs had no typed status param before).

### Current `list_skills` — current state / what changes / what to preserve
- **Current** (`skill_service.py:341-361`): `select(Skill).where(org_id)` + optional `status`/`tag` filters + `order_by(created_at.desc())` → `list(.scalars().all())` (ALL rows, no limit). Handler (`skills.py:85-108`) returns `ResponseEnvelope[list[SkillRead]]`.
- **Changes:** add `LIMIT/OFFSET` + a filtered `func.count()`; return `(rows, total)`; handler wraps in `SkillListData`/`PageMeta` and returns `ResponseEnvelope[SkillListData]`.
- **MUST preserve:** the org-scope `where(org_id)`; the `?status=` (lifecycle_state) filter; the `?tag=` JSONB containment **with the empty-tag = no-filter guard** (`:354-358` — `if tag and tag.strip()`); the `created_at desc` ordering; `SkillRead` row shape. Don't change filter semantics — only add pagination.

### Breaking shape change + 5-7 coordination (CRITICAL)
`GET /api/v1/skills` is an **existing** endpoint (unlike jobs, which was net-new in 5-4). Changing `ResponseEnvelope[list[SkillRead]]` → `ResponseEnvelope[SkillListData]` is a **breaking response-shape change**: `data` goes from `[...]` to `{items: [...], page: {...}}`.
- **Only frontend consumer:** `velara-web/src/api/skills.ts` `listSkills` (`:4-6`) reads `response.data.data` as `Skill[]`. After 5-6 that's an object → the FE breaks until **5-7** updates it. **5-6 builds BEFORE 5-7** (sprint note) — this is the intended sequence; 5-7 is "FRONTEND. Depends on 5-6." Do NOT try to keep the old array shape for back-compat — that would block 5-7's server-side filter/page work. **Do NOT touch `velara-web` in this story** (5-7 owns it).
- **Backend callers:** the only production caller of `skill_service.list_skills` is `skills.py:99` (this handler) — verified. No other service/worker calls it. So the signature change (`tuple` return) has a single call site to update.
- **Existing tests assert the old shape** — updating them (Task 4) is required and expected, not a regression.

### Conventions (architecture)
- Pagination shape is now codified (`implementation-patterns-consistency-rules.md:75-79`, added 2026-06-12): `page` (≥1, default 1), `per_page` (default 50, max 200); existing filters compose; `PageMeta{total,page,per_page}` where `total` is the **filtered** count; out-of-range page → empty + correct total (not 404); invalid → 422; omitting params = page 1 default size.
- Response envelope: `ResponseEnvelope[T]` always — never a bare array (the old `list[SkillRead]` was already wrapped; now `T` is `SkillListData`).
- Org-scope every query (`where(Skill.org_id == org_id)`); co-locate tests; ruff clean; no new dependency.

### Project Structure Notes
- Files touched (all `velara-api`): `app/schemas/skill.py` (+`SkillListData`), `app/services/skill_service.py` (`list_skills` → tuple + count + limit/offset), `app/api/v1/skills.py` (handler params + envelope), `tests/integration/api/test_skills.py` (update 5 existing list/tag assertions + add pagination tests). No migration, no dependency, no `velara-web`.

### Performance note (the why)
`select(func.count())` + `LIMIT/OFFSET` is index-supported: skills have `idx_skills_status` (and org scoping). Offset pagination is fine at the registry's scale (~3,485 rows). Cursor/keyset is out of scope — offset is the codified pattern. The COUNT is a second round-trip but cheap with the WHERE on indexed columns.

### References
- [Source: epics/epic-5-run-console-invocation-ux.md#Story 5.6] — the 4 ACs (paginate + filters preserved, PageMeta filtered count, out-of-range/invalid, backwards-compatible default).
- [Source: epics/epic-5-run-console-invocation-ux.md#Story 5.7] — the FRONTEND consumer that depends on this contract (builds after 5-6).
- [Source: stories/5-4-job-status-polling-and-output-display.md] — the pagination precedent: `GET /api/v1/jobs`, `JobListData{items,page}`, `PageMeta`, `list_jobs() -> tuple[rows,total]` with `func.count()` + `.limit/.offset`. **Mirror it.**
- [Source: planning-artifacts/sprint-change-proposal-2026-06-12.md] — the correct-course that added 5-6/5-7 (root cause: unbounded `list_skills`).
- [Source: architecture/implementation-patterns-consistency-rules.md:75-79] — the codified offset/limit pagination shape (`PageMeta`, page/per_page defaults, filtered total, 422/empty rules).
- [Source: stories/2-1-skill-data-model-and-registry-api.md] — the original `GET /api/v1/skills` + `?status=` filter contract being extended.
- Code seams (verified): `app/services/skill_service.py:341-361` (`list_skills` to paginate; empty-tag guard `:354-358`), `app/api/v1/skills.py:85-108` (handler to update; `:99` the only caller), `app/schemas/skill.py:181` (`SkillRead`), `:17` (`LifecycleState` Literal — keep as the status param), `app/schemas/common.py:35-40` (`PageMeta`), `app/services/job_service.py:202-241` + `app/api/v1/jobs.py:53-85` + `app/schemas/job.py:116-147` (the mirror template), `tests/integration/api/test_skills.py:236,247,405,603,624` (list/tag tests to update; 58 tests baseline), `velara-web/src/api/skills.ts:4-6` (the FE consumer 5-7 will adapt — do NOT touch here).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Added `SkillListData{items: list[SkillRead]; page: PageMeta}` to `app/schemas/skill.py`, importing `PageMeta` from `app.schemas.common`. Mirrors `JobListData` exactly as intended.
- Updated `skill_service.list_skills` signature to accept `page`/`per_page`, build shared `filters` list, run `select(func.count())` for filtered total, then paginated rows. Added `func` import to `skill_service.py`.
- Updated `app/api/v1/skills.py` handler: added `Annotated[int, Query(ge=1)]` params, new `response_model=ResponseEnvelope[SkillListData]`, builds `SkillListData` + `PageMeta`, returns `ResponseEnvelope`.
- Updated 5 existing list/tag tests to `["data"]["items"]` (required shape change, not regressions).
- Added 10 new pagination tests covering: per_page limit, page=2 non-overlapping slice, total ≥ seed count, out-of-range empty + correct total, 422 on page=0/per_page=0/per_page=201, status filter applies to total, unique-tag filter applies to total, default params return page=1/per_page=50.
- Gates: ruff clean, 68/68 test_skills.py pass (+10 net), 585/588 total pass (3 pre-existing ingest env failures unchanged). No migration. No new dependency.

### Code Review Fixes (2026-06-25, bmad-code-review)

- 3-layer adversarial review (Blind / Edge Case / Acceptance). 6 raw findings → 2 decision-needed + 2 patch + 1 deferred + 1 dismissed. Both decision items resolved as "fix both endpoints" (skills + the mirrored jobs precedent). All 4 patches applied:
  - **Pagination tiebreaker** — `order_by(created_at.desc(), id.desc())` added to BOTH `list_skills` and `list_jobs` (created_at is not unique → ties could skip/duplicate rows across pages).
  - **Upper `page` bound** — `Query(ge=1, le=100_000)` added to BOTH `skills.py` and `jobs.py` handlers (unbounded `page` → huge OFFSET / bigint-overflow 500); new test `test_pagination_page_exceeds_max_returns_422`.
  - **False-pass test** — `test_artifact_key_not_exposed` now iterates `data["items"]` (was iterating the dict's keys → vacuous IP-protection check).
  - **Weak test hardened** — `test_pagination_filter_applies_to_total` now asserts per-status totals are strictly below the unfiltered total (would catch a dropped count filter).
  - **ruff E501** — wrapped two over-length test lines; `ruff check` clean.
- Deferred (1): COUNT/ROWS two-round-trip inconsistency under concurrent writes — inherent to offset pagination, shared with the jobs precedent ([deferred-work.md](../deferred-work.md)).
- Dismissed (1): `status` param shadowing `fastapi.status` — pre-existing, latent, not activated by this diff.
- Re-verified gates: ruff clean (6 files); 101/101 test_skills + test_jobs pass; 585/588 full suite (3 pre-existing ingest env `Connection refused` failures unchanged). Files additionally touched by review: `app/api/v1/jobs.py`, `app/services/job_service.py`.

### File List

- app/schemas/skill.py
- app/services/skill_service.py
- app/api/v1/skills.py
- tests/integration/api/test_skills.py

---

**Key facts locked (verified against source):**
1. ✅ **Mirror 5-4 exactly** — `SkillListData{items: list[SkillRead]; page: PageMeta}` inside `ResponseEnvelope`; `list_skills() -> tuple[rows, total]` with `func.count()` (same filters) + `.limit/.offset`. The `JobListData` docstring names 5-6 as the next adopter.
2. ✅ **Breaking response-shape change is intended** — `data` array → `{items, page}`; the single FE consumer (`skills.ts listSkills`) is adapted by **Story 5-7** (builds after 5-6). Do NOT preserve the old array shape and do NOT touch `velara-web`.
3. ✅ **`list_skills` has ONE backend caller** (`skills.py:99`) — minimal regression surface; the existing list/tag tests must be updated to the new shape (required, not a regression).
