---
baseline_commit: e6ded75 (velara-api, development, story 16.4 code review); velara-web on branch `development` (head 64171e7) with story 16.5's changes UNCOMMITTED in the working tree (unstaged, per never-push-subrepos rule — do not discard them, do not commit them either). Verify with `git status` in both repos before starting.
---

# Story 16.6: Hierarchy-Scoped Run History on Project/Study Screens

Status: ready-for-dev

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

- [ ] **Task 1 — Backend: add `project_id`/`study_id` filter to `GET /api/v1/jobs` (AC1, AC3)**
  - [ ] `app/api/v1/jobs.py` (route, currently lines 79-121): add `project_id: Annotated[UUID | None,
    Query()] = None` and `study_id: Annotated[UUID | None, Query()] = None`. Reject both-provided with
    a 422 (use the existing domain-exception → error-envelope pattern, not a bare `HTTPException`, per
    the "Error handling" architecture rule — check `app/api/v1/` for the codebase's existing "mutually
    exclusive params" validation idiom before inventing one; if none exists, a simple `if project_id and
    study_id: raise ...` with a typed error is fine).
  - [ ] When `project_id` is set: call `hierarchy_service.get_project(session, project_id, org_id)` to
    resolve + org/existence-check it (already 404s appropriately — mirrors `list_studies`'s own
    call to `get_project` first, `hierarchy_service.py:633-641`), then read its `hierarchy_path`.
    Same for `study_id` via `get_study`.
  - [ ] `app/services/job_service.py`: extend `list_jobs(...)` (currently lines 270-333) with a new
    optional `node_path: str | None = None` param (a single ltree path, not a list — distinct from the
    existing `scope_paths: list[str] | None`). Add the single-path predicate `text("hierarchy_path <@
    :node_path").bindparams(node_path=node_path)` **AND**-ed with the existing `scope_paths <@ ANY(...)`
    clause when both are present — mirror `audit_service.py:261-264`'s precedent for AND-ing an
    ANY-based scope fence with a second, narrower single-path `<@` clause (that file's `client_path`
    fence is the closest existing analog to what this story needs).
  - [ ] Preserve every existing behavior: the `scope_paths is not None and len == 0` short-circuit
    (job_service.py:300-301), the `parent_job_id IS NULL` top-level-only filter, the outer-join-for-
    summary pattern (do NOT switch to `selectinload`), the `ORDER BY created_at DESC, id DESC`
    tiebreaker, and the two-query (count + rows) pagination shape.
  - [ ] Update the route docstring (lines 89-99) to document the new params and their AND-composition
    with hierarchy scope.

- [ ] **Task 2 — Frontend: extend the jobs API client + add a hierarchy-scoped hook (AC2)**
  - [ ] `src/api/jobs.ts`: add `project_id?: string` and `study_id?: string` to `ListJobsParams`
    (currently lines 133-137); `listJobs()` (line 162) already spreads `params` into axios params, no
    change needed there beyond the type.
  - [ ] `src/features/run/hooks/useJob.ts`: add `useProjectRuns(projectId: string)` and
    `useStudyRuns(studyId: string)` — **do not** copy `useJobs`'s loose `['jobs', params]` query-key
    shape (a pre-existing minor inconsistency in this codebase, not this story's job to fix elsewhere).
    Instead follow the `[entity, parentId]` convention already used by sibling engagement hooks
    (`useStudies`: `['studies', projectId]`, `useLocations`: `['locations', studyId]` in
    `useEngagements.ts`) — use query keys `['jobs', 'project', projectId]` / `['jobs', 'study',
    studyId]`. Call `listJobs({ project_id: projectId, per_page: <panel page size> })` /
    `listJobs({ study_id: studyId, per_page: <panel page size> })`. Reuse the `staleTime: 30_000`
    convention from `useJobs`.

- [ ] **Task 3 — Frontend: build the "Recent Runs" panel component (AC2)**
  - [ ] New component (suggest `src/features/engagements/components/RecentRunsPanel.tsx` — feature-
    first placement per architecture conventions; co-locate its test file). Props: `projectId?: string`
    XOR `studyId?: string` (dev's call on exact prop shape — a single `entityType`/`entityId` pair is
    also fine, match whichever reads cleaner against the two call sites below).
  - [ ] Render as a `Card` (matching `ChildListCard`'s visual idiom, per AC2), listing rows built from
    `JobRow`'s markup (`src/features/run/components/JobsHistory.tsx:197-233`) — skill name (with the
    existing "Deleted skill" italic fallback for a null joined skill), `JobStatusBadge`, cost via
    `fmtCost`, timestamp via `formatTs`. **Confirmed: `formatTs`, `fmtCost`, `JobRow`, and
    `JobDetailPanel` are all module-private (`function ...`, no `export`) in `JobsHistory.tsx` today**
    — reuse requires either adding `export` to each (smallest diff; check for naming collisions at the
    new import site first) or extracting them to a shared module. Do not assume they're importable
    as-is; verify the compile error is expected, not a sign something else is wrong.
  - [ ] "View full result": reuse the existing `JobDetailPanel`/`useJob(jobId)` slide-in pattern
    (`JobsHistory.tsx:31-193`) if it can be reasonably lifted into this panel without duplicating major
    logic; otherwise a simple "View all in Jobs History" link is an acceptable AC2 fallback for the
    per-row "link to full result" requirement — dev's call, document the choice in Completion Notes.
  - [ ] Empty state: no runs yet for this entity — a plain, unobtrusive empty message (mirror the
    existing "No skills available — attach at the Client." empty-state text style used elsewhere in
    this file).

- [ ] **Task 4 — Wire the panel into `ProjectDetail` and `StudyDetail` (AC2)**
  - [ ] `EngagementsScreen.tsx`: `ProjectDetail` (currently lines 1129-1220) — insert
    `<RecentRunsPanel projectId={project.id} />` as a new sibling `Card` after the "Available skills"
    card closes (after line 1217's `</Card>`), before the component's closing `</div>`.
  - [ ] `StudyDetail` (currently lines 1222-1331) — insert `<RecentRunsPanel studyId={study.id} />` the
    same way, after line 1328's `</Card>`.
  - [ ] **Verify these line numbers against the current working tree before editing** — they reflect
    16.5's uncommitted changes (`HeaderMenu`/`Menu` refactor) already in the working tree as of this
    story's drafting; if the tree has moved further since, re-locate by searching for the "Available
    skills" `Card` closing tag in each component, not by trusting these numbers blindly.

- [ ] **Task 5 — Tests**
  - [ ] Backend: `job_service_test.py` (or equivalent, co-located) — new tests for `list_jobs` with
    `node_path` set: (a) filters to only jobs under that path, (b) AND-composes correctly with
    `scope_paths` (a job under the requested path but outside the caller's scope is excluded), (c) a
    Project-level filter includes a descendant Study's jobs, (d) `project_id`+`study_id` both provided
    → 422. Route-level test for the new query params + the org/existence 404 via `get_project`/
    `get_study`.
  - [ ] Frontend: `RecentRunsPanel.test.tsx` (co-located) — renders rows from a mocked hook response,
    empty state when no runs, skill-name fallback for a deleted skill. `EngagementsScreen.test.tsx`:
    confirm `ProjectDetail`/`StudyDetail` render the new panel (mock `useProjectRuns`/`useStudyRuns`
    the same way sibling hooks are already mocked in this file's existing wholesale `useEngagements`
    mock — check whether the new hooks need adding to that mock file, per Story 16.5's Dev Notes
    reminder to re-run `src/routes/internal.test.tsx`/`src/pages/LogoutFlow.test.tsx` after any new
    hook is introduced).
  - [ ] Gates: `pytest` (velara-api) green; `tsc --noEmit` + `eslint` clean + `vitest run` green, 0
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

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

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
