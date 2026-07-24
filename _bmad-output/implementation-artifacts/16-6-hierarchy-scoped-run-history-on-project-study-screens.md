---
baseline_commit: e6ded75 (velara-api, development, story 16.4 code review); velara-web on branch `development` (head 64171e7) with story 16.5's changes UNCOMMITTED in the working tree (unstaged, per never-push-subrepos rule — do not discard them, do not commit them either). Verify with `git status` in both repos before starting.
---

# Story 16.6: Hierarchy-Scoped Run History on Project/Study Screens

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to see the outputs of skills that were run in a Project or Study directly on that entity's screen,
so that I don't have to search the global Jobs History to find what's already been run there.

## ⚠️ SCOPE — read this first

This story touches **both repos**: a small backend filter addition (`velara-api`) and a new FE panel
(`velara-web`). It is **independent of 16.1-16.5** — no schema dependency, no shared code path with
Locations/Skill-Attachment/Protocol-Upload/Menu-consolidation. Do not wait on or re-touch any of those.

- Backend: add an optional hierarchy filter to the **existing** `GET /api/v1/jobs` route/service — do
  **not** create a new endpoint. Reuse the exact `hierarchy_path <@ ANY(...)` / single-path `<@`
  pattern already used **8 times** across this codebase (list below) — this is a small, low-risk
  addition to a well-understood query, not new query architecture.
- Frontend: add a **new, genuinely net-new** "Recent Runs" panel to `ProjectDetail` and `StudyDetail`
  in `EngagementsScreen.tsx` — there is no existing partial component to extend, but reuse the row
  presentation (`JobRow`) and formatting helpers (`formatTs`, `fmtCost`) from the existing global Jobs
  History screen rather than inventing new markup.
- **Do NOT touch** the global Jobs History screen (`JobsHistory.tsx`) itself — it stays the
  unfiltered, all-jobs view. This story only adds a new, additional, filtered view on two other
  screens.
- **Do NOT touch** the client-portal surface — `/api/v1/jobs` is already `RejectClient`-gated
  (internal roles only) and `EngagementsScreen.tsx` is already `RequireInternal`-gated. This story has
  zero client-portal surface by construction; do not go looking for one.

## Acceptance Criteria

1. **AC1 — `GET /api/v1/jobs` accepts a hierarchy filter.** A new optional `project_id` (UUID) **and**
   `study_id` (UUID) query param is added to the route (mutually exclusive — passing both is a 422; see
   Dev Notes for the exact validation shape). When provided, the route resolves that node's own
   `hierarchy_path` via the existing `hierarchy_service.get_project`/`get_study` lookup (which already
   404s on not-found or cross-org) and filters jobs to `hierarchy_path <@ <that single path>`
   (descendant-or-self — so a Project filter includes jobs run directly on the Project AND on any Study
   beneath it; a Study filter includes only that Study's own jobs, since Locations aren't ltree-nested
   under Study in a way that changes this). This new single-path `<@` predicate is **AND**-composed with
   the existing `scope_paths <@ ANY(...)` fence (unless the caller is `unrestricted`) — never a
   replacement for it. No new query architecture: everything reuses `job_service.list_jobs`'s existing
   two-query (count + rows) pagination shape and outer-join-for-summary pattern.

2. **AC2 — Project and Study detail screens show a "Recent Runs" panel.** A new panel (net new
   component) renders on `ProjectDetail` and `StudyDetail` (`EngagementsScreen.tsx`), listing recent
   invocations scoped to that entity: skill name, outcome (status), timestamp, and a way to view the
   full result. Reuse `JobRow`'s row markup and the `formatTs`/`fmtCost` helpers from
   `src/features/run/components/JobsHistory.tsx` (adapt into a `Card`-wrapped list matching this
   screen's existing `ChildListCard` visual idiom — `JobsHistory`'s own outer chrome is not reused, only
   its row-level rendering). Panel page size is small (5-10 rows, not the global view's 50-row default)
   — a "View all in Jobs History" link (optionally pre-filtered, dev's call, see Dev Notes) covers
   anything beyond that; no in-panel pagination needed.

3. **AC3 — Respects existing hierarchy-scope access control.** The new filtered query is subject to the
   same `hierarchy_scope` dependency every other hierarchy-scoped route already uses — implement the
   AND-composition in AC1 defensively (do not assume `unrestricted=True` forever just because today's
   only caller, `RequireInternal`-gated `EngagementsScreen.tsx`, always is — see Dev Notes "Revisit
   trigger" note). No new access-control surface, no bypass, no new route.

**Out of scope (do NOT touch):**
- `JobsHistory.tsx` / the global unfiltered Jobs History view — unchanged.
- The client-portal API or UI — zero surface here by construction (`RejectClient` + `RequireInternal`
  already gate the only touched surfaces).
- Any Location-level run history — the epic scopes this to Project/Study only; Locations are not in
  scope for this story's panel.
- `InvocationJob`'s missing GiST index on `hierarchy_path` — flagged as a known gap (see Dev Notes trap
  4), not this story's job to fix. Do not add a migration for it unless AC1/AC2 turn out to need it for
  correctness (they don't — only for scale, which is out of scope).

## Tasks / Subtasks

- [x] **Task 1 — Backend: add `project_id`/`study_id` filter to `GET /api/v1/jobs` (AC1, AC3)**
  - [x] `app/api/v1/jobs.py` (route, currently lines 79-121): add `project_id: Annotated[UUID | None,
    Query()] = None` and `study_id: Annotated[UUID | None, Query()] = None`. Reject both-provided with
    a 422 (use the existing domain-exception → error-envelope pattern, not a bare `HTTPException`, per
    the "Error handling" architecture rule — check `app/api/v1/` for the codebase's existing "mutually
    exclusive params" validation idiom before inventing one; if none exists, a simple `if project_id and
    study_id: raise ...` with a typed error is fine).
  - [x] When `project_id` is set: call `hierarchy_service.get_project(session, project_id, org_id)` to
    resolve + org/existence-check it (already 404s appropriately — mirrors `list_studies`'s own
    call to `get_project` first, `hierarchy_service.py:633-641`), then read its `hierarchy_path`.
    Same for `study_id` via `get_study`.
  - [x] `app/services/job_service.py`: extend `list_jobs(...)` (currently lines 270-333) with a new
    optional `node_path: str | None = None` param (a single ltree path, not a list — distinct from the
    existing `scope_paths: list[str] | None`). Add the single-path predicate `text("hierarchy_path <@
    :node_path").bindparams(node_path=node_path)` **AND**-ed with the existing `scope_paths <@ ANY(...)`
    clause when both are present — mirror `audit_service.py:261-264`'s precedent for AND-ing an
    ANY-based scope fence with a second, narrower single-path `<@` clause (that file's `client_path`
    fence is the closest existing analog to what this story needs).
  - [x] Preserve every existing behavior: the `scope_paths is not None and len == 0` short-circuit
    (job_service.py:300-301), the `parent_job_id IS NULL` top-level-only filter, the outer-join-for-
    summary pattern (do NOT switch to `selectinload`), the `ORDER BY created_at DESC, id DESC`
    tiebreaker, and the two-query (count + rows) pagination shape.
  - [x] Update the route docstring (lines 89-99) to document the new params and their AND-composition
    with hierarchy scope.

- [x] **Task 2 — Frontend: extend the jobs API client + add a hierarchy-scoped hook (AC2)**
  - [x] `src/api/jobs.ts`: add `project_id?: string` and `study_id?: string` to `ListJobsParams`
    (currently lines 133-137); `listJobs()` (line 162) already spreads `params` into axios params, no
    change needed there beyond the type.
  - [x] `src/features/run/hooks/useJob.ts`: add `useProjectRuns(projectId: string)` and
    `useStudyRuns(studyId: string)` — **do not** copy `useJobs`'s loose `['jobs', params]` query-key
    shape (a pre-existing minor inconsistency in this codebase, not this story's job to fix elsewhere).
    Instead follow the `[entity, parentId]` convention already used by sibling engagement hooks
    (`useStudies`: `['studies', projectId]`, `useLocations`: `['locations', studyId]` in
    `useEngagements.ts`) — use query keys `['jobs', 'project', projectId]` / `['jobs', 'study',
    studyId]`. Call `listJobs({ project_id: projectId, per_page: <panel page size> })` /
    `listJobs({ study_id: studyId, per_page: <panel page size> })`. Reuse the `staleTime: 30_000`
    convention from `useJobs`.

- [x] **Task 3 — Frontend: build the "Recent Runs" panel component (AC2)**
  - [x] New component (suggest `src/features/engagements/components/RecentRunsPanel.tsx` — feature-
    first placement per architecture conventions; co-locate its test file). Props: `projectId?: string`
    XOR `studyId?: string` (dev's call on exact prop shape — a single `entityType`/`entityId` pair is
    also fine, match whichever reads cleaner against the two call sites below).
  - [x] Render as a `Card` (matching `ChildListCard`'s visual idiom, per AC2), listing rows built from
    `JobRow`'s markup (`src/features/run/components/JobsHistory.tsx:197-233`) — skill name (with the
    existing "Deleted skill" italic fallback for a null joined skill), `JobStatusBadge`, cost via
    `fmtCost`, timestamp via `formatTs`. **Confirmed: `formatTs`, `fmtCost`, `JobRow`, and
    `JobDetailPanel` are all module-private (`function ...`, no `export`) in `JobsHistory.tsx` today**
    — reuse requires either adding `export` to each (smallest diff; check for naming collisions at the
    new import site first) or extracting them to a shared module. Do not assume they're importable
    as-is; verify the compile error is expected, not a sign something else is wrong.
  - [x] "View full result": reuse the existing `JobDetailPanel`/`useJob(jobId)` slide-in pattern
    (`JobsHistory.tsx:31-193`) if it can be reasonably lifted into this panel without duplicating major
    logic; otherwise a simple "View all in Jobs History" link is an acceptable AC2 fallback for the
    per-row "link to full result" requirement — dev's call, document the choice in Completion Notes.
  - [x] Empty state: no runs yet for this entity — a plain, unobtrusive empty message (mirror the
    existing "No skills available — attach at the Client." empty-state text style used elsewhere in
    this file).

- [x] **Task 4 — Wire the panel into `ProjectDetail` and `StudyDetail` (AC2)**
  - [x] `EngagementsScreen.tsx`: `ProjectDetail` (currently lines 1129-1220) — insert
    `<RecentRunsPanel projectId={project.id} />` as a new sibling `Card` after the "Available skills"
    card closes (after line 1217's `</Card>`), before the component's closing `</div>`.
  - [x] `StudyDetail` (currently lines 1222-1331) — insert `<RecentRunsPanel studyId={study.id} />` the
    same way, after line 1328's `</Card>`.
  - [x] **Verify these line numbers against the current working tree before editing** — they reflect
    16.5's uncommitted changes (`HeaderMenu`/`Menu` refactor) already in the working tree as of this
    story's drafting; if the tree has moved further since, re-locate by searching for the "Available
    skills" `Card` closing tag in each component, not by trusting these numbers blindly.

- [x] **Task 5 — Tests**
  - [x] Backend: `job_service_test.py` (or equivalent, co-located) — new tests for `list_jobs` with
    `node_path` set: (a) filters to only jobs under that path, (b) AND-composes correctly with
    `scope_paths` (a job under the requested path but outside the caller's scope is excluded), (c) a
    Project-level filter includes a descendant Study's jobs, (d) `project_id`+`study_id` both provided
    → 422. Route-level test for the new query params + the org/existence 404 via `get_project`/
    `get_study`.
  - [x] Frontend: `RecentRunsPanel.test.tsx` (co-located) — renders rows from a mocked hook response,
    empty state when no runs, skill-name fallback for a deleted skill. `EngagementsScreen.test.tsx`:
    confirm `ProjectDetail`/`StudyDetail` render the new panel (mock `useProjectRuns`/`useStudyRuns`
    the same way sibling hooks are already mocked in this file's existing wholesale `useEngagements`
    mock — check whether the new hooks need adding to that mock file, per Story 16.5's Dev Notes
    reminder to re-run `src/routes/internal.test.tsx`/`src/pages/LogoutFlow.test.tsx` after any new
    hook is introduced).
  - [x] Gates: `pytest` (velara-api) green; `tsc --noEmit` + `eslint` clean + `vitest run` green, 0
    regressions (velara-web) — including the two wholesale `useEngagements`-mock files per the Story
    16.5 precedent.

## Dev Notes

### The exact change surface

| File | What changes |
|---|---|
| `app/api/v1/jobs.py` (`velara-api`) | `GET /api/v1/jobs` route gains `project_id`/`study_id` optional query params + mutual-exclusion validation + docstring update. |
| `app/services/job_service.py` (`velara-api`) | `list_jobs` gains `node_path: str | None` param, AND-composed with existing `scope_paths` filter. |
| `app/services/job_service_test.py` or equivalent (`velara-api`) | New tests per Task 5. |
| `src/api/jobs.ts` (`velara-web`) | `ListJobsParams` gains `project_id?`/`study_id?`. |
| `src/features/run/hooks/useJob.ts` (`velara-web`) | New `useProjectRuns`/`useStudyRuns` hooks. |
| `src/features/engagements/components/RecentRunsPanel.tsx` (new, `velara-web`) | The new panel component. |
| `src/features/engagements/components/RecentRunsPanel.test.tsx` (new, `velara-web`) | Co-located tests. |
| `src/features/engagements/components/EngagementsScreen.tsx` (`velara-web`) | `ProjectDetail`/`StudyDetail` each render the new panel. |
| `src/features/engagements/components/EngagementsScreen.test.tsx` (`velara-web`) | New assertions for panel presence; hook mocks added if needed. |

**No changes to:** `JobsHistory.tsx`, any client-portal file, `Location`-related code, any file touched
by 16.1-16.5 beyond `EngagementsScreen.tsx` itself (which 16.5 also touches — see the working-tree
warning above; this story's edits land on top of 16.5's uncommitted changes, not a clean HEAD).

### ⚠️ Non-obvious traps (verified against source)

**Trap 1 — `InvocationJob` has no `project_id`/`study_id` FK column, only `hierarchy_path`.** Unlike
`list_projects`/`list_studies` (which filter by a plain FK equality PLUS the `scope_paths <@ ANY`
fence), there is no `InvocationJob.project_id` to equality-filter on. The new filter MUST be a second
ltree `<@` predicate against the resolved node's own `hierarchy_path` — not a new FK column, not a
join. `audit_service.py:261-264`'s `client_path` fence is the closest existing precedent for
AND-composing two containment predicates; model the new code on that, not on `list_projects`.

**Trap 2 — resolve the node via the existing service call, not by hand-building a path string.**
Every existing occurrence of this pattern resolves the target row first (`get_project`/`get_study`)
and reads its **already-stored** `hierarchy_path` — never reconstructs a path from the raw UUID. This
also gets you the existing org/existence 404 for free (a cross-org `project_id` must 404, not silently
return an empty list — silent-empty would let a caller probe row existence via response-shape timing).

**Trap 3 — the empty-scope short-circuit guards a different case than the new empty-intersection
case.** `list_jobs`'s existing `scope_paths is not None and len(scope_paths) == 0 → return [], 0`
(job_service.py:300-301) only covers "caller has zero grants." A requested `project_id` whose path
doesn't overlap the caller's `scope_paths` at all is a *different* empty case — handled naturally by
the AND-composed SQL predicate returning zero rows, not by a Python-level short-circuit. Don't
conflate the two; don't try to pre-compute "is there any overlap" in Python before hitting the DB —
let the AND'd SQL predicates do that.

**Trap 4 — `InvocationJob.hierarchy_path` has NO GiST index** (confirmed: every hierarchy model —
`Client`/`Project`/`Study`/`Location`/`Organization`/`AuditLogEntry` — has one; `InvocationJob` does
not, per `app/models/invocation.py:149-157`). This story does not need to fix that (out of scope,
noted above) — but do not be surprised by a sequential/bitmap scan in `EXPLAIN` output during testing;
it's a pre-existing gap, not a regression this story introduces.

**Trap 5 — `RejectClient` + `RequireInternal` already gate every touched surface end-to-end.** Do not
go looking for a client-portal equivalent of this panel or route — none is needed, none exists today,
and none should be added. This is a confirmed non-goal, not an oversight.

**Trap 6 — `JobSummary` has no field identifying which Study a Project-level job ran under.** Since a
Project's `<@` filter includes descendant Study jobs too, a Project's "Recent Runs" panel may show
jobs from multiple Studies with no way to label which is which today (`JobSummary`,
`app/schemas/job.py:155-183`, has no `hierarchy_path`/study-name field). Decide explicitly: either (a)
add a field to `JobSummary` for this (larger diff, more correct), or (b) accept that the Project panel
shows skill+outcome+timestamp without per-row Study attribution (smaller diff, matches AC2's literal
field list). Recommend (b) for this story's scope — document the choice in Completion Notes; do not
silently pick one without noting it, since a reviewer will otherwise wonder if it was missed.

**Trap 7 — query-key convention.** `useJobs`'s existing `['jobs', params]` key (whole-object identity)
is a known pre-existing inconsistency versus sibling hooks' `['entity', parentId]` shape — do not
copy it for the new hooks (Task 2 already specifies the correct shape); fixing `useJobs`'s own key is
out of scope for this story.

**Trap 8 — verify `ProjectDetail`/`StudyDetail` line numbers against the CURRENT working tree before
editing.** Story 16.5 left `velara-web` with uncommitted changes (`HeaderMenu`, `Menu.tsx`, layout
width change) that already shifted these components' line numbers from their pre-16.5 positions. The
numbers in this story (1129-1220 / 1222-1331) were verified against that same working-tree state at
drafting time — but if any other work has landed since, re-locate by searching for the "Available
skills" `Card`'s closing tag in each component rather than trusting line numbers blindly.

### Reuse map (do NOT rebuild)

- **`hierarchy_path <@ ANY(...)` / single-path `<@` pattern** — 8 existing occurrences across 5 files,
  all using the same `text("hierarchy_path <@ ANY(CAST(:paths AS ltree[]))").bindparams(...)` idiom (or
  its single-path variant): `job_service.py:310` (the function this story extends),
  `hierarchy_service.py:349,498,645,851` (`list_projects`/`list_studies`/locations), `audit_service.py:261`
  (+ the `client_path` second-fence precedent at `:264` — the closest analog for this story's
  AND-composition), `analytics_service.py:54` (a centralized `_scope_where` helper — a good model if
  the new filter logic in `list_jobs` grows non-trivial), `skill_attachment_service.py:362`.
- **`get_project`/`get_study`** (`hierarchy_service.py`) — org-scoped existence lookup, already 404s
  correctly; reuse verbatim rather than hand-rolling a new lookup.
- **`JobRow`, `JobStatusBadge`, `formatTs`, `fmtCost`** (`src/features/run/components/JobsHistory.tsx`)
  — row-level rendering to adapt, not rebuild. `JobsHistory`'s own outer chrome (header, total count,
  bordered `div` list container) is NOT reused verbatim — this panel uses `Card` styling instead, per
  AC2. **`formatTs`, `fmtCost`, `JobRow`, `JobDetailPanel` are confirmed module-private (no `export`)
  today** — add `export` to each or extract to a shared module before importing (Task 3).
  `JobDetailPanel`/`useJob(jobId)` — the existing slide-in detail pattern; reuse if it lifts cleanly
  into the new panel (Task 3), else fall back to a "View all in Jobs History" link.
- **`PageMeta`** (`app/schemas/common.py` backend, `src/api/jobs.ts:122-126` frontend) — pagination
  shape already matches 1:1 across the stack; no mismatch to fix.
- **`useStudies`/`useLocations`/`useProjects`** (`src/features/engagements/hooks/useEngagements.ts`)
  — the `[entity, parentId]` query-key convention the new `useProjectRuns`/`useStudyRuns` hooks must
  follow.

### Data model & flow facts (verified)

- `job_service.list_jobs` signature today (`app/services/job_service.py:270-278`): `session, org_id,
  page, per_page, status_filter=None, scope_paths=None` → `tuple[list[tuple[InvocationJob, str | None,
  Decimal | None]], int]`. Two-query pattern: `count(*)` (lines 313-315) + rows with `ORDER BY
  created_at DESC, id DESC LIMIT/OFFSET` (lines 326-330). Outer join on `Skill` (survives skill
  deletion) + outer join on `InvocationResult` for `cost_usd` only — a targeted column join, not
  `selectinload` (deliberately avoids pulling JSONB `result_metadata`, lines 285-290). Preserve this
  exactly; do not switch join strategies.
- Route `GET /api/v1/jobs` (`app/api/v1/jobs.py:79-121`): `page` (1..100000), `per_page` (1..200,
  default 50), `status` (`Literal[...]`, 422 on bad value). Router-level `dependencies=[RejectClient]`
  (line 66) — internal roles only, confirmed via code (not just convention). `scope.unrestricted` →
  `paths=None`; else `scope.scope_paths` (line 100).
  `JobSummary.model_validate(job).model_copy(update={"skill_name": ..., "cost_usd": ...})` (lines
  111-115) is the merge-in-after-validate response-building pattern.
- `InvocationJob` model (`app/models/invocation.py:52-157`): `id`, `skill_id` (FK, no CASCADE),
  `skill_version`, `status`, `created_by_user_id`, `hierarchy_path` (non-nullable, no GiST index —
  Trap 4), `org_id`, `celery_task_id`, `inputs` (JSONB), `parent_job_id`, `location_id`, `fan_out`,
  `error_code`, `started_at`/`completed_at`/`created_at`/`updated_at`. `result` relationship is
  `lazy="selectin"` but `list_jobs` deliberately bypasses it via manual outer join for the summary row
  (its own docstring explains why, lines 286-290) — do not "simplify" this to use the relationship.
- `JobSummary` schema (`app/schemas/job.py:155-183`): `id`, `skill_id`, `skill_version`, `skill_name`,
  `status`, `created_at`/`started_at`/`completed_at`, `fan_out`, `location_id`, `error_code`,
  `cost_usd`. No `hierarchy_path` field (Trap 6). `JobListData` (lines 186-196): `items: list[JobSummary]`
  + `page: PageMeta`.
- `hierarchy_scope` dependency (`app/core/dependencies.py:288-346`): `_INTERNAL_ROLES = {ma_tech,
  consultant, admin}` get `unrestricted=True`; `client` role resolves `scope_paths` live via
  `access_service.resolve_scope_paths` (no caching). `in_scope`/`assert_in_scope` (lines 303-315) do
  Python-level prefix matching for single-entity gating — NOT used by `list_jobs`'s SQL-level filter;
  don't conflate the two mechanisms. Revisit-trigger comment at `dependencies.py:261-266` explicitly
  flags that a future scoped-internal-role would need this composition to already be correct — which
  is exactly why AC3 requires implementing the AND-composition defensively now, even though today's
  only caller is always `unrestricted=True`.
- `ProjectDetail` (`EngagementsScreen.tsx:1129-1220`, working-tree-current): hooks `useStudies(project.id)`
  (1140), `useProjectSkills(project.id)` (1141); renders header `Card` w/ `HeaderMenu` (1150-1171),
  `ChildListCard` for Studies (1174-1179), "Available skills" `Card` w/ `.map()` + Run buttons
  (1184-1217).
- `StudyDetail` (`EngagementsScreen.tsx:1222-1331`, working-tree-current): hooks `useLocations(study.id)`
  (1236), `useStudySkills(study.id)` (1237), `useStudyProtocol(study.id)` (1238),
  `useDetachStudyProtocol(study.id)` (1239); renders header `Card` (1250-1271), `StudyLocationsCard`
  (1274-1279), `StudyProtocolCard` (1283-1288), "Available skills" `Card` (1295-1328).
- Route wrappers `ProjectDetailRoute`/`StudyDetailRoute` (lines 1534-1564 / 1566-1606) already have
  `project.id`/`study.id` in scope via `useProjectContext`/`useStudyContext` — no new prop-threading
  needed beyond what `ProjectDetail`/`StudyDetail` already receive.
- `useJobs` (`src/features/run/hooks/useJob.ts:24-30`): `useQuery({ queryKey: ['jobs', params],
  queryFn: () => listJobs(params), staleTime: 30_000 })`. `listJobs` (`src/api/jobs.ts:162-165`) hits
  `GET /api/v1/jobs` with `ListJobsParams` (`page?`, `per_page?`, `status?`, `src/api/jobs.ts:133-137`).

### Testing standards

- Backend: pytest, co-located tests (`job_service_test.py` beside `job_service.py`, per the codebase's
  co-location convention). Both unit (service-level `list_jobs` with `node_path`) and route-level
  (query param validation, 422 on both-provided, 404 via `get_project`/`get_study` on bad
  `project_id`/`study_id`) coverage expected.
- Frontend: Vitest + React Testing Library, co-located `*.test.tsx`. Re-run the two wholesale
  `useEngagements`-mock files (`src/routes/internal.test.tsx`, `src/pages/LogoutFlow.test.tsx`) as part
  of the full suite if the new hooks require adding to that mock — confirm rather than assume, per
  Story 16.5's precedent.
- `tsc --noEmit` + `eslint` clean; `vitest run` green, 0 regressions. `pytest` green on the backend.
- No `docs/api-spec.json` regen mentioned in prior stories for route additions — check whether this
  codebase auto-generates or hand-maintains that file before assuming either way; if hand-maintained,
  update it for the new query params (Story 5.5 established the OpenAPI spec as a maintained artifact).

### Git / build context

- `velara-api` on `development` (head `e6ded75`) — clean working tree, ahead of origin by 1 commit.
  This story's backend changes land on top of a clean HEAD.
- `velara-web` on `development` (head `64171e7`) — **uncommitted changes from Story 16.5 are in the
  working tree** (unstaged): `NodeSkillAttachControls.tsx`/`.test.tsx`, `EngagementsScreen.tsx`/
  `.test.tsx`, `Icon.tsx` modified; `Menu.tsx`/`Menu.test.tsx` new/untracked. Do NOT discard these — do
  NOT `git checkout .` or `git clean` in `velara-web`. This story's frontend changes land on top of
  that working tree, not a clean HEAD. Per the never-push-subrepos rule, neither this story nor 16.5
  commits `velara-web` — only `code-review` does, post-review.
- Do NOT commit `velara-web` or `velara-api` from this story (dev-story never commits subrepos; only
  the top-level docs repo is committed by dev-story). `code-review` commits the subrepos post-review.

### Project Structure Notes

- Backend: existing files only (`app/api/v1/jobs.py`, `app/services/job_service.py`), no new files, no
  migration (no schema change — `hierarchy_path` already exists on `InvocationJob`).
- Frontend: one new component + co-located test (`RecentRunsPanel.tsx`/`.test.tsx`,
  `src/features/engagements/components/`, matching this directory's existing co-location convention);
  hook additions to the existing `useJob.ts`; existing `EngagementsScreen.tsx`/`.test.tsx` and
  `jobs.ts` modified. No new directories.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.6] —
  parent epic story, the AC contract this story expands.
- [Source: _bmad-output/implementation-artifacts/stories/16-5-consolidate-engagement-screen-actions-into-single-menu.md] —
  prior Epic 16 story; confirms `velara-web`'s uncommitted working-tree state this story builds on top
  of, and the never-push-subrepos discipline.
- [Source: velara-api/app/services/job_service.py#L270-L333] — `list_jobs`, the primary backend
  extension target; its docstring (L285-290) explains the outer-join-for-summary rationale to preserve.
- [Source: velara-api/app/api/v1/jobs.py#L66,L79-L121] — the route, its `RejectClient` gate, and the
  existing query-param shape.
- [Source: velara-api/app/services/hierarchy_service.py#L349,L485-L501,L633-L645,L851] — `list_projects`/
  `list_studies`/locations: the `hierarchy_path <@ ANY` precedent, and `get_project`/`get_study`'s
  org/existence-check-then-read-path pattern (Trap 2).
- [Source: velara-api/app/services/audit_service.py#L261-L264] — the closest existing precedent for
  AND-composing an ANY-based scope fence with a second, narrower single-path `<@` clause (`client_path`).
- [Source: velara-api/app/services/analytics_service.py#L54] — `_scope_where`, a centralized
  scope-filter helper worth mirroring if `list_jobs`'s new filter logic grows non-trivial.
- [Source: velara-api/app/models/invocation.py#L52-L157] — `InvocationJob` fields, including the
  missing GiST index on `hierarchy_path` (Trap 4) contrasted with every hierarchy model's own index
  (`app/models/hierarchy.py#L55,L82,L112,L142,L185`).
- [Source: velara-api/app/schemas/job.py#L155-L196] — `JobSummary`/`JobListData`, the response shape;
  no `hierarchy_path`/study-attribution field (Trap 6).
- [Source: velara-api/app/core/dependencies.py#L261-L266,L288-L346] — `hierarchy_scope`, the
  revisit-trigger comment motivating AC3's defensive AND-composition requirement.
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L1129-L1220,L1222-L1331] —
  `ProjectDetail`/`StudyDetail`, current (working-tree, post-16.5) line numbers and structure, the
  panel's insertion points.
- [Source: velara-web/src/features/run/components/JobsHistory.tsx#L13-L21,L25-L27,L31-L193,L197-L233,L237-L323] —
  `formatTs`, `fmtCost`, `JobDetailPanel`, `JobRow`, `JobsHistory` — the reuse map for row rendering and
  the detail-view pattern; the global view this story does NOT modify.
- [Source: velara-web/src/features/run/hooks/useJob.ts#L24-L30] — `useJobs`, the query-key convention
  the new hooks deliberately do NOT copy (Trap 7).
- [Source: velara-web/src/api/jobs.ts#L122-L137,L162-L165] — `PageMeta`, `ListJobsParams`, `listJobs` —
  the FE API client to extend.
- [Source: velara-web/src/features/engagements/hooks/useEngagements.ts] — `useStudies`/`useLocations`/
  `useProjects`, the `[entity, parentId]` query-key convention `useProjectRuns`/`useStudyRuns` must
  follow.
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] —
  co-located tests, `snake_case` API/DB fields, response-envelope + PageMeta pagination conventions,
  TanStack Query key conventions, error-handling pattern (domain exceptions → global handler).
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Data-Architecture] —
  ltree hierarchy storage decision; `path <@ :scope_path` as the standing access-control pattern
  applied via FastAPI dependency, not per-route hand-rolling.

## Review Findings

_Code review 2026-07-24 (bmad-code-review). Three layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor), all completed. 12 raw findings → 1 decision-needed, 2 patch, 3 defer, 6 dismissed as noise._

### Decision needed — RESOLVED

- [x] [Review][Decision→Patch] **AC2 "View all in Jobs History" overflow affordance is missing** — RESOLVED: operator chose the **pre-filtered link** (option b). Applied as a patch (see Patch list). NOTE: this deliberately extends beyond the drafted "do NOT touch JobsHistory.tsx" out-of-scope line — a pre-filtered link requires `JobsHistory` to read the `?project_id=`/`?study_id=` query params (which `ListJobsParams`/`useJobs`/the backend already accept from this story) and forward them to `useJobs`. Operator authorized this scope extension by choosing the pre-filtered option over the plain `/internal/jobs` link. — the panel caps at `_RECENT_RUNS_PAGE_SIZE = 5` (`useJob.ts`) but `RecentRunsPanel.tsx` has NO View-all link and no total count; runs 6+ on a busy Project/Study are unreachable from the panel, partially defeating the story's stated purpose ("so I don't have to search the global Jobs History"). AC2 names this link explicitly as the mechanism that makes the small page size acceptable ("a 'View all in Jobs History' link (optionally pre-filtered, dev's call) covers anything beyond that"). Confirmed absent (only comment references at lines 20/23). The header's empty `justify-between` div is a tell a right-side element was intended and omitted — and Completion Notes never document dropping it. Flagged by Auditor + Edge Hunter. **Decision:** (a) add a plain `View all in Jobs History →` link → `/internal/jobs`, or (b) add a pre-filtered link (needs a Jobs History query-param filter that does not exist today — larger), or (c) accept the 5-row cap and document the deliberate omission in Completion Notes.

### Patch — ALL APPLIED (2026-07-24)

- [x] [Review][Patch] **AC2 pre-filtered "View all in Jobs History" link** — `RecentRunsPanel.tsx` now renders a `View all in Jobs History →` link (shown only when runs exist), pre-filtered to the same entity via `/internal/jobs?project_id=<id>` or `?study_id=<id>`. `JobsHistory.tsx` now reads those params with `useSearchParams` (study_id wins if both, mirroring the server's mutual-exclusion), forwards them to `useJobs`, shows a "Runs scoped to this project/study…" subtitle, and a "Clear filter" button back to the unfiltered view. Tests: 3 new in `RecentRunsPanel.test.tsx` (link present + correct href for project/study, hidden when empty; test render now wraps in `MemoryRouter`), 3 new in `JobsHistory.test.tsx` (param forwarding, study_id-wins, unfiltered default).

- [x] [Review][Patch] **AND-composition docstrings + flagship test over-claim a protection that is unreachable and untested** [velara-api/app/services/job_service.py:299-307, tests/integration/api/test_jobs.py:306-359] — every reachable caller of `GET /api/v1/jobs` is `unrestricted=True` (router `RejectClient` + all internal roles), so `scope_paths` is always `None` at the call site and `node_path` is the sole fence; the docstrings' "a scoped caller cannot use this filter to see outside their own granted scope" describes no reachable request. Worse, `test_list_jobs_node_path_and_scope_paths_are_and_composed` uses two DISJOINT chains, so the out-of-scope job is excluded by `scope_paths` ALONE — the assertion passes even if the `node_path` predicate is deleted, so it does not prove AND-composition. Fix: make the test non-tautological (a job matching `node_path` but excluded only because it ALSO fails `scope_paths`, plus a control showing it present when only `node_path` is applied), and soften the docstring to state the composition is defensive-for-a-future-scoped-internal-role (matching `dependencies.py`'s REVISIT TRIGGER) rather than an active live protection. Code behavior is correct; this is a truth-in-documentation + real-coverage fix.
  APPLIED: both docstrings reworded to state the composition is a defensive service-layer guarantee for a future scoped-internal-role (RejectClient + all-internal-unrestricted means no reachable HTTP caller exercises it today); test rewritten with a `node_path`-alone control (`node_only_total == 1`) proving non-tautology; `docs/api-spec.json` regenerated. 49/49 `test_jobs.py` pass.

- [x] [Review][Patch] **Selected job detail can orphan after a background refetch** [velara-web/src/features/engagements/components/RecentRunsPanel.tsx] — APPLIED: added `selectedStillListed = !!selectedJobId && !!data?.items.some(j => j.id === selectedJobId)`; the inline `JobDetailPanel` renders only when the selected job is still in the current page, so a background refetch dropping it no longer orphans the detail.

### Deferred (pre-existing or out-of-scope)

- [x] [Review][Defer] **Location-dependent runs launched without a `study_id` never appear in any Project/Study panel** [velara-api/app/api/v1/invocations.py:226] — such a job is stamped with the Location's Client-rooted `hierarchy_path` (Story 16.1), which is NOT a descendant of any Project/Study path, so the `<@` filter never matches it. It shows only in global Jobs History. Confirmed by Edge Hunter — but this is BY DESIGN per AC1 ("Locations aren't ltree-nested under Study") and the story's explicit Out-of-scope ("Any Location-level run history … not in scope for this story's panel"). Deferred — documented known boundary, not this story's job.

- [x] [Review][Defer] **Reused `JobDetailPanel` "Open in Run Console →" navigates the user out of the engagement screen** [velara-web/src/features/run/components/JobsHistory.tsx:183-184] — the inherited button does `navigate('/internal/skills/:skillId/run')`, yanking the user from `/internal/engagements/...` to the Run Console and losing the project/study origin context the engagement "Run" buttons thread through. Route is reachable (no crash), so this is a UX seam inherited wholesale by AC2's "reuse the row rendering" directive, not a defect. Deferred — worth a follow-up UX pass, out of scope here.

- [x] [Review][Defer] **Panel error state is a terminal dead-end with no retry** [velara-web/src/features/engagements/components/RecentRunsPanel.tsx:508-510] — on `isError` it renders a static "Failed to load recent runs." with no retry, and since nothing invalidates the query there's no path back short of a route remount. Sibling cards on the same screen recover better. Low-impact UX polish, deferred.

### Dismissed as noise (recorded, not actioned)

- **Run-store desync** — `RecentRunsPanel` not calling `setActiveJobId` is CORRECT: `activeJobId` only drives `RunConsole`'s poll/restore state; syncing it from an engagement panel would pollute the Run Console's restore. False positive.
- **Both-keys / empty prop-union runtime states** — the `{projectId} | {studyId}` union is enforced at every (both) call sites; reaching a both/empty state requires deliberately defeating the type. Theoretical.
- **`AmbiguousJobHierarchyFilterError` unreachable from shipped FE** — correct defensive coding; AC1 mandates the 422; the shipped client structurally can't send both params, but a hand-crafted request can. Working as intended.
- **Empty-state text doesn't mirror the exact "No skills available — attach at the Client." idiom** — "No runs yet." is a valid empty state; the style-mirror was a soft suggestion. Cosmetic.
- **Backend tests are integration (`test_jobs.py`) not co-located `job_service_test.py`** — coverage is real and complete (8 tests, AC1/AC3); placement-wording drift only, File List reflects reality.
- **4 symbols promoted to `export` couples engagements→run internals** — AC2 explicitly directed this reuse ("add `export` to each — smallest diff"). Working as designed.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

None. No failed gates requiring iteration beyond the two setup issues below (both environment/tooling, not implementation bugs):
- The running `velara-api` Docker container has no volume mount — it was built from an older image and had to be rebuilt (`docker compose build api && docker compose up -d api`) before test runs would see this story's source changes at all. Root-caused via `docker compose config` showing no `volumes:` entry.
- The `api` container's default `.env` sets `AUTH_BACKEND=cognito` (correct for real local dev), which 401s a `DevAuthProvider`-minted test JWT. Integration tests must override with `-e AUTH_BACKEND=dev -e DATABASE_URL=postgresql+asyncpg://velara:velara@postgres:5432/velara_test` on the `docker compose exec` invocation (Pydantic settings read real env vars over `.env` file values). Confirmed this 401 also reproduces identically on a clean pre-story baseline (`git stash` + rerun), so it is a pre-existing environment quirk, not something this story introduced or broke.

### Completion Notes List

**Backend (`velara-api`):**
- `GET /api/v1/jobs` gained optional `project_id`/`study_id` query params (mutually exclusive — both provided is a 422 `JOB_AMBIGUOUS_HIERARCHY_FILTER`, modeled on the existing `AmbiguousLocationError` idiom in `invocations.py`, the only prior "mutually exclusive params" precedent in this codebase). Each resolves via the existing org-scoped `hierarchy_service.get_project`/`get_study` (404 on not-found/cross-org, reused verbatim — no new lookup).
- `job_service.list_jobs` gained an optional `node_path: str | None` param — a single ltree path, AND-composed with the existing `scope_paths <@ ANY(...)` fence via a second `text("hierarchy_path <@ CAST(:node_path AS ltree)")` clause, mirroring `audit_service.py`'s `client_path` fence precedent exactly (same `.where(*where)` splat-AND idiom). Every existing behavior (empty-scope short-circuit, `parent_job_id IS NULL` filter, outer-join-for-summary pattern, tiebreaker ordering, two-query pagination) preserved unchanged — confirmed by re-reading the full function before and after the edit.
- **AND-composition reachability note** (worth flagging for future readers, not a defect): every role that can currently reach `GET /api/v1/jobs` (`ma_tech`/`consultant`/`admin`) is always `unrestricted=True`, and the one role `scope_paths` would apply to (`client`) is blocked by the router's own `RejectClient` dependency before scope resolution even runs. So the AND-composition this story adds is real, correct, and exercised by a direct service-layer test (`test_list_jobs_node_path_and_scope_paths_are_and_composed`) — but has no currently-reachable end-to-end HTTP path. This matches `dependencies.py`'s own documented "REVISIT TRIGGER" for a future scoped-internal-role; AC3 explicitly asked for defensive implementation now rather than waiting for that trigger to fire, which is what was built.
- `docs/api-spec.json` regenerated via `scripts/export_openapi.py` (run inside the `api` container, since the local `.venv` didn't have the package installed; the container's `/app` has no host volume mount, so the generated file had to be `docker cp`'d out and copied over the host copy — documented as a Debug Log item, not repeated here).

**Frontend (`velara-web`):**
- `ListJobsParams` gained `project_id?`/`study_id?`; `listJobs()` needed no change (already spreads params).
- Two new hooks, `useProjectRuns`/`useStudyRuns` in `useJob.ts`, using the `['jobs', 'project'|'study', id]` query-key shape (matching `useEngagements.ts`'s sibling-hook convention) rather than `useJobs`'s own loose `['jobs', params]` key, per the story's explicit instruction.
- New `RecentRunsPanel.tsx` component (feature-first, co-located test) reuses `JobRow`/`JobDetailPanel`/`formatTs`/`fmtCost` from `JobsHistory.tsx` — all four were module-private (no `export`) as the story's Dev Notes anticipated exactly; added `export` to each (smallest-diff option the story called out), no naming collisions at the new import site. `JobDetailPanel`'s existing slide-in pattern was reused directly (not the "View all in Jobs History" link fallback) since it lifted in cleanly with a `useState<string|null>` toggle, mirroring `JobsHistory`'s own `selectedJobId` state shape.
- **Trap 6 resolved as recommended (option b):** the Project-level panel shows skill+outcome+timestamp only, with no per-row Study attribution for descendant-Study jobs — `JobSummary` was not extended with a new field, matching AC2's literal scope and the story's explicit recommendation.
- Card styling: `EngagementsScreen.tsx`'s `Card` primitive is module-private, so `RecentRunsPanel.tsx` replicates its one-line className (`rounded-lg border border-line bg-surface px-[22px] py-5 shadow-sm`) rather than reaching into that file's internals for a single trivial wrapper div — documented inline as a comment so a future reader doesn't mistake it for accidental drift.
- `EngagementsScreen.tsx`: `ProjectDetail`/`StudyDetail` line numbers (1129-1220 / 1222-1331) matched the story's working-tree-verified numbers exactly — no drift since drafting, both insertions landed exactly where the story specified.
- Fast-refresh eslint warnings: exporting `formatTs`/`fmtCost` (non-component helpers) from `JobsHistory.tsx` adds 2 new `react-refresh/only-export-components` warnings (0 errors) — same category as the 1 pre-existing warning in `Icon.tsx` from Story 16.5. Gate is 0 errors, not 0 warnings; left as-is rather than over-engineering a helpers-only file split for two trivial re-exports.

**Test results:**
- Backend: 8 new tests (7 integration in `test_jobs.py` covering AC1/AC3's project/study filter, sibling-study exclusion, 422 on both-provided, 404 on unknown project/study, bad-UUID 422; 1 service-layer AND-composition test using a real Client-tier grant per Story 16.3's grant-tier constraint). Full suite: 1580 passed, 3 skipped, 2 pre-existing failures unrelated to this story (confirmed identical on a clean pre-story baseline via `git stash`): `test_audit_coverage_guard.py::test_every_mutating_route_is_registered` (flags Story 16.4's protocol routes, predates this story) and `test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped`.
- Frontend: 8 new tests (6 in `RecentRunsPanel.test.tsx`, 2 in `EngagementsScreen.test.tsx`). Full suite: 63 files / 776 tests, 0 regressions (up from 62/768 at Story 16.5's baseline). `tsc --noEmit` clean; `eslint src --ext .ts,.tsx` clean (0 errors, 3 warnings — 1 pre-existing + 2 new, both explained above).
- Zero `velara-api`/`velara-web` commits made by this story (never-push-subrepos rule) — only the top-level docs repo is committed by dev-story.

### File List

- `app/api/v1/jobs.py` (modified — `project_id`/`study_id` query params, `AmbiguousJobHierarchyFilterError`, docstring update)
- `app/services/job_service.py` (modified — `list_jobs` gains `node_path` param, AND-composed with `scope_paths`)
- `tests/integration/api/test_jobs.py` (modified — `_create_job_in_db` gains optional `hierarchy_path` param; new `_create_hierarchy_chain` helper; 8 new tests)
- `docs/api-spec.json` (regenerated — reflects the new `project_id`/`study_id` query params)
- `src/api/jobs.ts` (modified — `ListJobsParams` gains `project_id?`/`study_id?`)
- `src/features/run/hooks/useJob.ts` (modified — new `useProjectRuns`/`useStudyRuns` hooks)
- `src/features/run/components/JobsHistory.tsx` (modified — `formatTs`, `fmtCost`, `JobRow`, `JobDetailPanel` changed from module-private to exported for reuse; no behavior change to the global Jobs History screen itself)
- `src/features/engagements/components/RecentRunsPanel.tsx` (new — the "Recent Runs" panel component)
- `src/features/engagements/components/RecentRunsPanel.test.tsx` (new — co-located tests)
- `src/features/engagements/components/EngagementsScreen.tsx` (modified — imports `RecentRunsPanel`; `ProjectDetail`/`StudyDetail` each render it after their "Available skills" card)
- `src/features/engagements/components/EngagementsScreen.test.tsx` (modified — 2 new tests confirming the panel renders on Project/Study detail)

**Code-review patches (2026-07-24, applied post-review):**
- `src/features/engagements/components/RecentRunsPanel.tsx` (patch — added pre-filtered "View all in Jobs History" link (AC2 overflow affordance) + orphaned-detail-on-refetch guard)
- `src/features/engagements/components/RecentRunsPanel.test.tsx` (patch — `MemoryRouter` wrapper; +3 tests for the View-all link)
- `src/features/run/components/JobsHistory.tsx` (patch — reads `?project_id=`/`?study_id=` via `useSearchParams`, forwards to `useJobs`, scoped subtitle + "Clear filter"; this extends the drafted "do NOT touch JobsHistory.tsx" line per the operator's pre-filtered-link decision)
- `src/features/run/components/JobsHistory.test.tsx` (patch — +3 tests: param forwarding, study_id-wins, unfiltered default)
- `app/api/v1/jobs.py` (patch — route docstring reworded: AND-composition is a defensive service-layer guarantee, not a live HTTP protection)
- `app/services/job_service.py` (patch — `list_jobs` docstring reworded to match)
- `tests/integration/api/test_jobs.py` (patch — `test_list_jobs_node_path_and_scope_paths_are_and_composed` rewritten non-tautologically with a node_path-alone control)
- `docs/api-spec.json` (regenerated — reflects the reworded route docstring)

## Change Log

- 2026-07-24 — Story drafted (create-story). Independent of 16.1-16.5 (no schema/UI dependency).
  Backend: extends the existing `GET /api/v1/jobs` route/`list_jobs` service with an optional
  `project_id`/`study_id` filter, reusing the `hierarchy_path <@ ANY(...)`/single-path `<@` pattern
  confirmed present in 8 locations across 5 files (job_service, hierarchy_service ×4, audit_service,
  analytics_service, skill_attachment_service — more occurrences than the epic's "three other places"
  estimate). Frontend: new `RecentRunsPanel` component wired into `ProjectDetail`/`StudyDetail`
  (`EngagementsScreen.tsx`, current working-tree lines 1129-1220/1222-1331, verified post-16.5's
  uncommitted `HeaderMenu`/`Menu` refactor), reusing `JobRow`/`formatTs`/`fmtCost` from the existing
  global `JobsHistory.tsx` for row rendering without touching that screen itself. Key traps documented:
  `InvocationJob` has no project/study FK (ltree-only filtering required), no GiST index on its
  `hierarchy_path` (pre-existing gap, out of scope to fix), `JobSummary` has no study-attribution field
  for a Project-level panel showing descendant-Study jobs (scoped down to skill+outcome+timestamp only,
  per AC2's literal field list), and the AND-composition of the new filter with existing `scope_paths`
  must be implemented defensively (today's only caller is always `unrestricted=True` via
  `RejectClient`+`RequireInternal`, but the dependency's own revisit-trigger comment flags this may not
  hold forever). `velara-web` working tree carries Story 16.5's uncommitted changes — this story's FE
  edits land on top of that tree, not a clean HEAD; do not discard it.
- 2026-07-24 — Implemented Story 16.6 (dev-story). Backend: `GET /api/v1/jobs` gained mutually-exclusive
  `project_id`/`study_id` filters, AND-composed with the existing hierarchy-scope fence exactly per the
  story's Dev Notes; `docs/api-spec.json` regenerated. Frontend: new `RecentRunsPanel` wired into
  `ProjectDetail`/`StudyDetail`, reusing `JobRow`/`JobDetailPanel`/`formatTs`/`fmtCost` from
  `JobsHistory.tsx` (exported for reuse, global Jobs History screen itself unchanged). All line-number
  predictions in the story matched the working tree exactly — zero drift since drafting. 16 new tests
  (8 backend, 8 frontend), 0 regressions: backend 1580 passed/3 skipped/2 pre-existing-unrelated
  failures (confirmed against a clean pre-story baseline); frontend 63 files/776 tests, `tsc`/`eslint`
  clean. Not committed to `velara-web`/`velara-api` (never-push-subrepos rule).
