---
baseline_commit: a111997cfb1267cc9f8ca1c0fb89fa9c4698da4e
---

# Story 5.8: Skills Free-Text Search API

Status: done

## Story

As a Vitalief consultant,
I want `GET /api/v1/skills?q=` to filter skills by name and description server-side,
so that the skill registry can find any skill across the full catalog regardless of which page it's on.

> **BACKEND-ONLY story** (FastAPI 0.115.6 + SQLAlchemy 2.0 async + Pydantic 2.10.4 + PostgreSQL 15). No frontend, no new dependency. **Added as a retro action item from Epic 5** — the 5-7 review confirmed `GET /api/v1/skills` has no free-text search param (`verified: app/api/v1/skills.py:88-95` + `app/services/skill_service.py:341-362`); the registry table search was locked client-side-only, making it permanently current-page-only once pagination landed. That is a product gap, not an acceptable limitation. Tracked as HIGH in `deferred-work.md:152`.
>
> **Non-breaking additive change.** Adding `?q=` as an optional query param with default `None` composes cleanly with existing `?status=` / `?tag=` / `?page=` / `?per_page=` params — callers that omit `q` get the same behavior as today. The response shape (`ResponseEnvelope[SkillListData]`) is unchanged.
>
> **Use `ilike` (case-insensitive substring match), not full-text / tsvector.** At registry scale (~3,485 rows) `ilike` on indexed `name`+`description` columns is fast enough and avoids adding a migration-heavy tsvector column or a new dependency. Full-text can be a future upgrade if the catalog grows to tens of thousands. Story 5-9 (frontend) wires the search box to this param.

## Acceptance Criteria

**AC1 — `?q=` filters by name and description, case-insensitive, partial match**
**Given** I call `GET /api/v1/skills?q=proto`
**When** the org has skills whose names or descriptions contain "proto" (any case — "Protocol", "PROTO", "prototype")
**Then** only matching skills are returned; skills with no match in name or description are excluded
> In `skill_service.list_skills`: when `q` is a non-empty, non-whitespace string, append `or_(Skill.name.ilike(f"%{q}%"), Skill.description.ilike(f"%{q}%"))` to the `filters` list. `description` is nullable — `ilike` on a nullable column must be safe (SQLAlchemy handles `NULL` correctly; no match). Keep existing `?status=` and `?tag=` filters composing as `AND` with `?q=`.

**AC2 — `?q=` applies to both the rows query AND the `total` count**
**Given** I call `GET /api/v1/skills?q=extract`
**When** the org has 3 matching skills out of 50 total
**Then** `data.page.total` is `3`, not `50` — the count reflects the filtered set
> The shared `filters` list already feeds both the `select(func.count())` and the `select(Skill)` queries (established pattern from 5-6). Adding `q` to `filters` before either statement runs means the count is automatically correct. No extra work required if the filter-building order is preserved.

**AC3 — Empty or whitespace-only `?q=` is treated as absent (no filter applied)**
**Given** I call `GET /api/v1/skills?q=` or `GET /api/v1/skills?q=   `
**When** the query runs
**Then** all org skills are returned (no name/description filter applied) — same as omitting `?q=` entirely
> Mirror the existing `?tag=` empty-guard pattern (`skill_service.py:354-358`: `if tag and tag.strip()`). Use `if q and q.strip()` before appending the ilike filter.

**AC4 — `?q=` composes with `?status=`, `?tag=`, `?page=`, `?per_page=`**
**Given** I call `GET /api/v1/skills?q=extract&status=active&page=1&per_page=10`
**When** the query runs
**Then** only skills matching all filters are returned, paginated correctly — the total reflects the intersection
> All params build into the same `filters` list before the count and rows queries run. Composing is automatic — no special handling needed.

**AC5 — `?q=` does not break existing callers that omit it**
**Given** existing callers to `GET /api/v1/skills` that pass no `q` param
**When** they call the endpoint
**Then** behavior is identical to before this story — no functional change, no shape change
> `q: str | None = None` with the empty-guard means omitting it hits the `if q and q.strip()` guard and falls through — no filter appended, full list returned.

## Scope

**5-8 BUILDS:**
- **`skill_service.list_skills`** — add `q: str | None = None` param; append `or_(Skill.name.ilike(...), Skill.description.ilike(...))` to `filters` when `q` is non-empty/non-whitespace.
- **`skills.py` `list_skills` handler** — add `q: str | None = None` Query param; pass to service. Update handler docstring.
- **Tests** — q-matches-name, q-matches-description, q-case-insensitive, q-partial-match, q-applies-to-total, q-empty-string-no-filter, q-whitespace-no-filter, q-composes-with-status, q-composes-with-tag, q-no-match-returns-empty, q-absent-unchanged-behavior.

**5-8 DEFERS / OUT OF SCOPE:**
- **Frontend wiring** → Story 5-9 (builds after 5-8). Do NOT touch `velara-web`.
- **Full-text / tsvector / trigram indexes** — `ilike` substring is sufficient at current scale. Future upgrade path if catalog grows.
- **Search on other fields** (tags, author, runtime_type) — name + description only. Tag filtering already exists as `?tag=`.
- **No migration** — `ilike` works on existing `String(255)` + `Text` columns without a new index. A `pg_trgm` GIN index could speed it up at large scale but is out of scope here.
- **No new dependency.**

## Tasks / Subtasks

- [x] **Task 0 — Read the current `list_skills` implementation FIRST (all ACs)**
  - [x] Read `app/services/skill_service.py:341-380` (the full `list_skills` function as built by 5-6 + 5-6 review patches — `filters` list, count stmt, rows stmt, tiebreaker, limit/offset). Understand exactly where to inject the `q` filter before touching anything.
  - [x] Read `app/api/v1/skills.py:85-115` (the handler — current params, how `status`/`tag` are passed to the service). Understand the param-declaration pattern (`Annotated[..., Query(...)]` style).
  - [x] Read `app/models/skill.py:41-43` — confirm `name: Mapped[str]` is `String(255)` and `description: Mapped[str | None]` is `Text` (nullable). Both are plain string columns; `ilike` works directly with no special handling.

- [x] **Task 1 — Add `q` param to `skill_service.list_skills` (AC1, AC2, AC3, AC4, AC5)**
  - [x] Add `q: str | None = None` to the function signature (after `tag`).
  - [x] After the existing `if tag and tag.strip()` block, add:
    ```python
    if q and q.strip():
        filters.append(
            or_(Skill.name.ilike(f"%{q}%"), Skill.description.ilike(f"%{q}%"))
        )
    ```
  - [x] Import `or_` from `sqlalchemy` if not already imported in `skill_service.py` (check existing imports — `select`, `func` are already there from 5-6; `or_` may not be).
  - [x] The `count_stmt` and `rows_stmt` both consume `filters` unchanged — no other edits needed in the body.
  - [x] Update the function docstring to mention `q` (name/description ilike, empty = no filter).

- [x] **Task 2 — Add `q` Query param to the handler (AC1, AC3, AC5)**
  - [x] In `app/api/v1/skills.py` `list_skills` handler, add `q: str | None = None` as a plain `Query` param (no `ge`/`le` bounds — it's a string; FastAPI validates it as optional string automatically). No `Annotated` wrapper needed unless adding a max-length constraint (skip for now — `ilike` with a very long string is slow but not a correctness issue at this scale).
  - [x] Pass `q=q` to `skill_service.list_skills(...)`.
  - [x] Update the handler docstring to document `q` (case-insensitive substring match on name and description; empty/absent = no filter).

- [x] **Task 3 — Tests (AC1–AC5)**
  - [x] All new tests go in `tests/integration/api/test_skills.py`. Keep a `test_search_` prefix for discoverability.
  - [x] **`test_search_q_matches_name`** — seed a skill with a unique name fragment; `?q=<fragment>` returns it.
  - [x] **`test_search_q_matches_description`** — seed a skill where the fragment is in description only (name doesn't match); `?q=<fragment>` returns it.
  - [x] **`test_search_q_case_insensitive`** — seed "Protocol Extractor"; `?q=PROTOCOL` and `?q=protocol` both return it.
  - [x] **`test_search_q_partial_match`** — `?q=proto` matches "Protocol" (prefix), "Extractor Protocol" (suffix), "multi-protocol" (middle).
  - [x] **`test_search_q_applies_to_total`** — seed 5 skills; 2 match `?q=<term>`; assert `data.page.total == 2` (not 5). This is the AC2 guard — catches a dropped filter on the count query.
  - [x] **`test_search_q_empty_string_no_filter`** — `?q=` returns all skills (same count as no-q call).
  - [x] **`test_search_q_whitespace_no_filter`** — `?q=   ` (spaces only) returns all skills.
  - [x] **`test_search_q_composes_with_status`** — seed a draft skill; `?q=<term>&status=internal_ready` returns empty (draft excluded by status filter).
  - [x] **`test_search_q_composes_with_tag`** — `?q=<term>&tag=<tag>` returns intersection.
  - [x] **`test_search_q_no_match_returns_empty`** — `?q=zzznomatchzzz` returns empty `items` + `total == 0`.
  - [x] **`test_search_q_absent_unchanged`** — assert that omitting `q` returns the same count as a call with no filters (existing baseline behavior is unchanged).
  - [x] Gates: `ruff check .` clean; Docker suite green (baseline ~590 tests; state your delta; no migration).

## Dev Notes

### Where to inject `q` in `list_skills` — exact surgery point

Current `list_skills` (`skill_service.py:341-380`) builds `filters` like this:
```python
filters = [Skill.org_id == org_id]
if status is not None:
    filters.append(Skill.lifecycle_state == status)
if tag and tag.strip():
    filters.append(Skill.tags.contains([tag]))

count_stmt = select(func.count()).select_from(Skill).where(*filters)
total = (await session.execute(count_stmt)).scalar_one()

rows_stmt = (
    select(Skill)
    .where(*filters)
    .order_by(Skill.created_at.desc(), Skill.id.desc())
    .limit(per_page)
    .offset((page - 1) * per_page)
)
```

Add the `q` block immediately after the `tag` guard, before `count_stmt`:
```python
if q and q.strip():
    filters.append(
        or_(Skill.name.ilike(f"%{q}%"), Skill.description.ilike(f"%{q}%"))
    )
```

Both `count_stmt` and `rows_stmt` already consume `filters` — no other changes needed in the body.

### Why `ilike` and not full-text

`Skill.name` is `String(255)` and `Skill.description` is `Text` (nullable). At the current scale (~3,485 rows), a sequential `ilike` scan is fast enough — PostgreSQL will use the existing `idx_skills_org_id` to narrow to org rows first, then scan the name/description columns. No new index is required for correctness; a future `pg_trgm` GIN index can be added if latency becomes a concern.

SQLAlchemy `ilike` on a nullable column is safe — `NULL ilike '%q%'` evaluates to `NULL` (not true), so null-description skills are correctly excluded when `q` is set.

### `or_` import

Check `skill_service.py` imports before adding. As of 5-6, the file imports `select` and `func` from `sqlalchemy`. Add `or_` to that import line if it's not already there.

### Handler param style

The existing handler uses `Annotated[int, Query(ge=1, le=100_000)]` for numeric params. For the string `q`, a plain `q: str | None = None` is sufficient — FastAPI treats it as an optional query string. No `Annotated` wrapper needed unless you want to add `Query(max_length=200)` as a guard against extremely long search strings (optional; add it if you want the protection).

### Consumer audit (retro lesson — required before this story)
Callers of `skill_service.list_skills`:
- **`app/api/v1/skills.py:99`** — the only production caller. Adding `q=q` is the one call site to update.
- No other service or worker calls `list_skills` directly.

Callers of `GET /api/v1/skills` (frontend):
- `velara-web/src/api/skills.ts` — `listSkills()` (per_page:200, whole-catalog) and `listSkillsPage(params)`. Neither passes `q` today. Story 5-9 wires `q` into `listSkillsPage`. `listSkills` (⌘K/Run Console path) does NOT add `q` — ⌘K retains its own client-side filtering on the whole-catalog fetch.

### Project Structure Notes

Files touched (all `velara-api`):
- `app/services/skill_service.py` — add `q` param + `or_(ilike)` filter block
- `app/api/v1/skills.py` — add `q` Query param, pass to service, update docstring
- `tests/integration/api/test_skills.py` — 11 new `test_search_*` tests

No migration. No new dependency (assuming `or_` is a stdlib SQLAlchemy import). Do NOT touch `velara-web`.

### References
- [Source: deferred-work.md:152] — the HIGH item that triggered this story; exact verification of the missing `?q=` param against `skills.py:88-95` and `skill_service.py:341-362`.
- [Source: stories/5-7-skill-registry-ui-pagination.md] — the 5-7 review finding that surfaced the gap and locked client-side-only as the current state.
- [Source: stories/5-6-skills-list-api-pagination.md] — the `list_skills` pagination precedent; the `filters` list pattern this story extends.
- [Source: implementation-artifacts/epic-5-retro-2026-06-26.md] — retro action item 1; root cause: `deferred-work.md` HIGH items not escalated to PM for a product decision.
- Code seams: `app/services/skill_service.py:341-380` (`list_skills` — inject after tag guard, before count_stmt), `app/api/v1/skills.py:85-115` (handler — add `q` param, pass to service), `app/models/skill.py:41-43` (`name` String(255), `description` Text nullable).
- Consumed by: Story 5-9 (frontend — wires `?q=` into the registry search box).

## Dev Agent Record

### Implementation Plan
- Added `or_` to `sqlalchemy` import in `skill_service.py`
- Added `q: str | None = None` param to `list_skills` service function after `tag`; appended `or_(ilike)` filter using the established `if q and q.strip()` empty-guard pattern (mirrors `tag` guard)
- Added `q: str | None = None` Query param to the handler in `skills.py`; passed `q=q` to service; updated both docstrings
- Wrote 11 `test_search_*` integration tests covering all 5 ACs; corrected `status=active` → `status=internal_ready` after discovering the valid enum values (draft/internal_ready/client_ready/retired)

### Completion Notes
- All 5 ACs satisfied. `?q=` is a non-breaking additive param — omitting it falls through the `if q and q.strip()` guard with no filter appended.
- The `filters` list pattern (shared by count and rows queries) means AC2 (count reflects filtered set) is automatically correct — no extra work.
- `or_` import added to `sqlalchemy` import line in `skill_service.py`.
- Gates: ruff clean, 588 Docker tests pass (80 in test_skills.py — 68 pre-existing + 12 new including the 11 search tests; 3 pre-existing ingest env failures unchanged; 0 regressions).
- No migration, no new dependency, no frontend change.

## File List

- `app/services/skill_service.py` — added `or_` to sqlalchemy import; added `q: str | None = None` param + `or_(ilike)` filter block + updated docstring
- `app/api/v1/skills.py` — added `q: str | None = None` Query param; passed to service; updated docstring
- `tests/integration/api/test_skills.py` — 11 new `test_search_*` integration tests

### Review Findings

_Code review 2026-06-26 — 3-layer adversarial (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Production code is faithful to all 5 ACs; findings are 1 contract gap, 1 input-bound choice, 4 test/coverage fixes, 1 deferred perf item._

- [x] [Review][Patch] Escape LIKE metacharacters (`%`, `_`, `\`) in `q` for a true literal substring match [app/services/skill_service.py:366-381] — APPLIED 2026-06-26: `like_term = q.strip().replace("\\","\\\\").replace("%","\\%").replace("_","\\_")` then `ilike(pattern, escape="\\")` on both name and description; docstrings updated to "literal substring". Two negative tests added (`test_search_q_wildcard_treated_literally` for `_`, `test_search_q_percent_treated_literally` for `%`). Verified SQL emits `ILIKE ... ESCAPE '\'`. Sources: blind+edge.
- [x] [Review][Patch] Add `Query(max_length=255)` bound to `q` [app/api/v1/skills.py:96] — APPLIED 2026-06-26: `q: Annotated[str | None, Query(max_length=255)] = None`; docstring notes "max 255 chars (422 if longer)". Test `test_search_q_too_long_returns_422` added. Source: edge.
- [x] [Review][Patch] Unstripped `q` interpolated into the pattern — leading/trailing spaces become literal [app/services/skill_service.py:366-381] — APPLIED 2026-06-26: the pattern is now built from `q.strip()` (folded into the escaping fix above), so `q="  proto  "` searches for the trimmed term. Source: edge.
- [x] [Review][Patch] `test_search_q_case_insensitive` was a near-tautology [tests/integration/api/test_skills.py] — APPLIED 2026-06-26: now asserts the full cased name (`s["name"] == "Protocol-{unique}"`) across lower/upper/mixed-case variants of the cased word, so a regression to case-sensitive `like` would fail. Source: auditor.
- [x] [Review][Patch] AC1 NULL-description clause was untested [tests/integration/api/test_skills.py] — APPLIED 2026-06-26: discovered the create API forbids NULL/blank description (MISSING_DESCRIPTION, skill_service.py:93), so a NULL-description row is unreachable via the API. `test_search_q_null_description_safe` now seeds the row directly via the app engine (`AsyncSession(engine)`, org_vitalief/usr_001_ma_tech) and asserts `?q=` matches on name yet never false-matches/errors on the NULL description — exercising the real `NULL ILIKE` SQL path. Source: auditor.
- [x] [Review][Patch] `test_search_q_absent_unchanged` compared an identical request to itself [tests/integration/api/test_skills.py] — APPLIED 2026-06-26: now seeds two disjoint-named skills and asserts the no-`q` list contains BOTH, so an unintended filter on the absent-`q` path would drop one. Source: auditor.
- [x] [Review][Defer] Leading-`%` ILIKE forces a sequential scan — no trigram index [app/services/skill_service.py:368] — `%...%` can't use a B-tree, and there is no `pg_trgm`/GIN index on `name`/`description`. Both count and rows queries seq-scan per org. Spec explicitly defers `pg_trgm`/tsvector ("`ilike` substring is sufficient at current scale ~3,485 rows"). Real but spec-deferred; revisit if catalog grows or `max_length` is left unbounded. Source: edge. — deferred, pre-existing/out-of-scope by spec.

_Dismissed as noise (1): Repeated `?q=a&q=b` silently accepted (last value wins) — standard FastAPI scalar-param behavior, not a defect; no caller sends duplicate `q`._

## Change Log

- 2026-06-26: Implemented Story 5.8 — added `?q=` free-text search (ilike on name+description) to `GET /api/v1/skills`; 11 new integration tests; ruff clean; 588 Docker pass (+12 new, 0 regressions). No migration/dep/FE.
- 2026-06-26: Code review (3-layer adversarial) → review → done. 2 decisions resolved + 6 patches applied: (1) escape LIKE metacharacters `%`/`_`/`\` + `escape="\\"` so `q` is a true literal substring (was: raw interpolation — `q="100%"`/`q="%"` broke the documented contract); (2) `q.strip()` in the pattern (was: surrounding whitespace literal); (3) `Query(max_length=255)` on `q` → 422 on overflow (was: unbounded); (4) fixed `test_search_q_case_insensitive` tautology (now asserts the cased name); (5) fixed `test_search_q_absent_unchanged` self-comparison (now seeds 2 disjoint skills, asserts both returned); (6) added real NULL-description coverage via direct-engine seed (create API forbids NULL desc → MISSING_DESCRIPTION, so the AC1 NULL-safety path was unreachable via API). +4 new tests (2 wildcard-literal, 1 max_length 422, 1 null-desc). Gates: ruff clean, 84/84 test_skills (+4, 0 regressions). 1 deferred (seq-scan/no trigram index → deferred-work.md, spec-sanctioned at ~3,485-row scale), 1 dismissed (repeated `?q=` last-wins — standard FastAPI behavior).
