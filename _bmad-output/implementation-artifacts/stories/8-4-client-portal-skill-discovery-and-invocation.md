# Story 8.4: Client Portal — Skill Discovery & Invocation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **client engagement lead**,
I want **to see all skills available to my engagement (both project-level and study-level) and invoke them from the client portal**,
so that **I can run approved skills and receive outputs without any exposure to Vitalief's methodology**.

## Acceptance Criteria

1. **(AC1 — Project view: project-wide skills)** **Given** a client user views their Project dashboard **When** the page loads **Then** project-level skills are shown in a "Project-wide skills" section above the studies list, each with a "Project-wide" badge; the hero "Available skills" count includes them.

2. **(AC2 — Study view: two skill sections)** **Given** a client user views a Study detail **When** the page loads **Then** project-level skills appear in an "Available across all studies" section (with a layers icon), and study-specific skills appear below in a "Study-specific" section.

3. **(AC3 — Run interface: name + description only)** **Given** a client user clicks "Run" on a skill **When** the client run interface opens **Then** it shows the skill name and description — no instructions, methodology, or code are visible anywhere in the UI.

4. **(AC4 — Output + back nav)** **Given** a client user submits a skill invocation **When** the run completes **Then** they see the output text and can download output files — the back button returns them to the Project or Study they ran from.

5. **(AC5 — Visibility filtered at the API layer)** **Given** a skill has `visibility: "internal_only"` **When** it is queried through the client API **Then** it does not appear in the client portal at all — it is filtered out at the API layer.

6. **(AC6 — Audit trail on client invocation)** **Given** a client user invokes a skill **When** I check the audit log **Then** an entry exists with the client's `user_id`, the engagement `hierarchy_path`, skill ID, and `outcome`.

### Definition of Done (gates — must all pass before `done`)

- All 6 ACs satisfied and covered by tests.
- Backend: new client-scoped read routes (`GET /api/v1/client/skills`, `.../projects/{id}/studies`, `.../studies/{id}/locations`) return **IP-safe schemas** (id + name + description only; **zero** `visibility`/`lifecycle_state`/`org_id`/`scope`/`author`/`hierarchy_path`/schema fields). Visibility filter enforced in the service query (AC5). Run BE tests with `docker compose exec -e AUTH_BACKEND=dev api pytest ...` (Constraint C1).
- **D1 (invocation widening) has architect sign-off recorded in the Dev Agent Record before merge** — it revises the 8.1 authorization boundary (see Task 5 + C4). If sign-off is withheld, fall back to the location-dependent-only path and note the AC6-non-LD limitation.
- Frontend: `npm run test` green (vitest); the 8.3 **title-isolation test** (`client.test.tsx:92-101`) still passes and is extended to every new client screen; **zero** `VisibilityChip`/`SkillLifecycleBadge`/job-id/`hierarchy_path`/`/internal/*` reachable from any `/client/*` screen.
- `ruff check` + `ruff format` clean (backend); no TypeScript errors (frontend).
- New OpenAPI schema-lock entries added for every new client schema (`test_openapi.py` — 8.2/8.3 established this lock).

> **Pre-existing failing tests (NOT introduced here — do not "fix" by masking):** the 8.3 record notes 3 pre-existing 8.2 integration failures (`completed_job_presign`, `blocked_job`, `out_of_scope_403`) that are **FK-constraint errors from stale dev-env DB state**, not code. Reset the test DB (`docker compose down -v` / re-migrate) if they surface; do not alter production code to make them pass.

---

## Tasks / Subtasks

> Sequence: **Backend read/skills endpoints first** → **backend invocation widening (D1, gated on sign-off)** → **backend tests** → **FE data hooks** → **FE discovery screens** → **FE run/output** → **FE tests**. This is the FINAL story of Epic 8. The grant model (8.1), the `/api/v1/client` router + `ClientJobRead` (8.2), and the client shell/routing/engagements (8.3) already exist and are `done`.

### Backend — Read surface (AC1, AC2, AC5)

- [ ] **Task 1 — `GET /api/v1/client/skills` (AC1, AC2, AC5)**
  - [ ] 1.1 Add `ClientSkillRead` to `velara-api/app/schemas/client.py` — independent `BaseModel`, zero inheritance (mirror the existing `ClientEngagement`/`ClientJobRead` discipline in this file). Fields: `id: uuid.UUID`, `name: str`, `description: str | None`, `scope: str | None` (needed to bucket project-wide vs study-specific on the FE — `scope` is NOT IP-sensitive; it's `"project"`/`"study"`/`null`), `location_dependent: bool` (the run flow needs it to decide whether to collect a location). **DO NOT** add `visibility`, `lifecycle_state`, `org_id`, `author`, `runtime_type`, `input_schema`, `output_schema`, `tags`, `paired_with`, `derived_from`, `review_required`, `created_by_user_id` — `SkillRead` (`schemas/skill.py:222-256`) leaks all of these; the client schema must not.
  - [ ] 1.2 Extend `skill_service.list_skills` (`services/skill_service.py:401-458`) with an optional `visibility: str | None` filter param and an optional `scope: str | None` filter param (both `None` today; append `Skill.visibility == visibility` / `Skill.scope == scope` to the `filters` list when provided). Keep it backward-compatible — the internal route passes neither, so its behavior is unchanged.
  - [ ] 1.3 Add `GET /api/v1/client/skills` to `velara-api/app/api/v1/client.py` (existing client router, prefix `/api/v1/client`). Query params: `project_id: uuid.UUID | None`, `study_id: uuid.UUID | None` (to bucket by context — see 1.4), plus `page`/`per_page` (follow the `PageMeta` shape from `schemas/common.py`; the internal skills route already paginates this way). Response `ResponseEnvelope[ClientSkillListData]` (a `data.items: list[ClientSkillRead] + page: PageMeta` shape mirroring the internal `SkillListData`). Depend on `CurrentUser`, `DbSession`, `HierarchyScope`.
  - [ ] 1.4 **Availability = scope-filtered org skills gated by grant + visibility** (there is NO project↔skill / study↔skill attachment table — confirmed: no join table, skills are org-global not ltree-pathed, `skill.py:3`). This matches the internal mock seam `useProjectSkills(_projectId)` which **ignores projectId** and filters the global list by `scope==='project'` (`useProjectSkills.ts` — comment: "backend skill-attachment is a later epic; swap when the attachment API lands"). So: filter `org_id == user.org_id` AND `visibility == "client_facing"` AND `lifecycle_state == "client_ready"` (only cert-passed, client-sanitized skills — this satisfies **AC5**: `internal_only` and `paired`-internal parents are excluded structurally). Then bucket by `scope`: when `project_id` is passed → return `scope == "project"` skills (the "Project-wide" set, AC1); when `study_id` is passed → return BOTH `scope == "project"` (the "Available across all studies" set) AND `scope == "study"` (the "Study-specific" set) so the FE can split them (AC2). **The `project_id`/`study_id` gate the caller's access** (assert the referenced node is in `scope` via `HierarchyScope` — cross-org 404, out-of-scope 403) but do NOT change which org skills match (no per-node attachment). Document this scope-heuristic explicitly in a route comment — it is a deliberate decision, not a stub, and mirrors the internal side.
  - [ ] 1.5 The real per-engagement attachment model stays **deferred** ("a later epic" — a join table + assignment UI is a much larger lift and out of 8.4). Note it in the Dev Agent Record.

- [ ] **Task 2 — Client hierarchy drill-down read routes (AC1, AC2, AC4 — needed to reach Study→Location for the run flow)** *(D2)*
  - [ ] 2.1 Add `GET /api/v1/client/projects/{project_id}/studies` to the client router → returns IP-safe `ClientStudyRead` list (`study_id`, `study_name` only). Depend on `HierarchyScope`; `assert_in_scope` the project path (cross-org 404, out-of-scope 403). Reuse `hierarchy_service.list_studies(session, project_id, org_id, scope_paths=...)` if it accepts a scope filter; otherwise filter results by scope. (The 8.3 `/engagements` route returns Clients+Projects ONLY — no studies/locations — so this is net-new and required for the Project view's studies list + drill-down.)
  - [ ] 2.2 Add `GET /api/v1/client/studies/{study_id}/locations` → IP-safe `ClientLocationRead` list (`location_id`, `location_name` only). Same scope enforcement. Needed because a client runs **location-dependent** skills, which require a `location_id` (or `study_id` + `fan_out`) — see Task 5.
  - [ ] 2.3 Add the corresponding `ClientStudyRead` / `ClientLocationRead` + list-data schemas to `schemas/client.py` (independent BaseModels, id+name only).

### Backend — Invocation widening (AC6) — **GATED ON ARCHITECT SIGN-OFF (D1)**

- [ ] **Task 3 — Verify audit is already written (AC6, mostly verify-only)**
  - [ ] 3.1 Confirm (do not rebuild): `audit_service.record_entry` (`services/audit_service.py:38-95`) is already called for every outcome — success/blocked (`workers/execution_tasks.py:219-250`), failure (`:297-309`), fan-out parent — with `user_id=job.created_by_user_id` (= the client's `user_id` for a client invocation), `skill_id`, `skill_version`, `outcome`, and `hierarchy_path=str(job.hierarchy_path)`. A client invocation flows the SAME `queue_invocation`→`run_skill` pipeline, so audit entries are produced automatically. The append-only guarantee is enforced by the migration `0006` trigger. **No new audit code** — 3.2 is the only AC6 gap.
  - [ ] 3.2 The AC6 gap is the `hierarchy_path` value, handled by Task 5. (Location-dependent invocations already record the real engagement ltree path; the widening in Task 5 makes non-LD client invocations record the real engagement path too, instead of the current `"org"`.)

- [ ] **Task 4 — Client run/invoke wiring on the existing client route (AC3, AC4)**
  - [ ] 4.1 The `POST /api/v1/client/invocations/{skill_id}` route already exists (`client.py:154-184`, reuses `queue_invocation`) and returns `InvocationAccepted` (job_id + status). `GET /api/v1/client/jobs/{job_id}` returns `ClientJobRead` (internals-free). **No new routes needed here** — 8.4's job is the FE hooks (Task 8) + the invocation-body handling that Task 5 enables. Confirm the `InvocationRequest` body (`schemas/invocation.py:17-49`, `extra="forbid"`) accepts `{file_ref_ids?, inputs?, location_id?, study_id?, fan_out?}` — the client run UI builds this same body.

- [ ] **Task 5 — Widen invocation so scope-restricted clients can run skills with a real engagement `hierarchy_path` (AC6) — D1, ARCHITECT SIGN-OFF REQUIRED**
  - [ ] 5.1 **Context / why this is gated:** today `queue_invocation`'s non-location-dependent branch (`invocations.py:274-292`) hardcodes `hierarchy_path="org"` and **rejects any non-`unrestricted` (i.e. client) caller with 403** — a deliberate 8.1-review authorization ruling ("only internal roles run org-global invocations"; ADR in `core-architectural-decisions.md#authorization-internal-roles-are-org-global-operators`). Consequence today: a client can ONLY run **location-dependent** skills. AC6 wants the engagement `hierarchy_path` for client invocations generally, so this ruling must be revised. **This is scope into a settled security boundary — obtain architect sign-off (record it in the Dev Agent Record) before implementing.**
  - [ ] 5.2 **The change (if approved):** in the non-LD branch, instead of `if not scope.unrestricted: raise HierarchyScopeError()`, resolve an engagement `hierarchy_path` for a scoped client from their grant. **Disambiguator plumbing already exists** — `InvocationRequest.study_id` is a field on the body (`schemas/invocation.py`) and the client invoke route passes `body` straight into `queue_invocation` (`client.py:154-184`), so NO route/schema change is needed; the client run UI just includes `study_id` (or add reading `project_id` from the body only if you extend the schema — prefer reusing `study_id`). Rule: when `not scope.unrestricted` and a `study_id`/project is supplied, load that node, `scope.assert_in_scope(node.hierarchy_path)`, and pass that path to `create_job` instead of `"org"`. If the client has exactly one granted path (`len(scope.scope_paths) == 1`) and no disambiguator is supplied, use that single granted path. Never fall back to `"org"` for a scoped user (that would re-introduce the un-attributable audit entry AC6 forbids — raise a clear error instead). Internal (`unrestricted`) callers keep the existing `"org"` behavior unchanged.
  - [ ] 5.3 Keep the blast radius minimal and reversible: gate the new path on `not scope.unrestricted` so **only** the client case changes; internal invocation behavior and all existing tests must be untouched. If sign-off is withheld, DROP Task 5, restrict the client skills list to `location_dependent=true` skills only (Task 1.4 add-on), and record the AC6-non-LD limitation as accepted — the location-dependent path already satisfies AC6 with a real path.

### Backend — Tests (AC1, AC2, AC5, AC6)

- [ ] **Task 6 — BE integration tests** *(co-locate in `tests/integration/api/test_client_surface.py`; reuse its helpers)*
  - [ ] 6.1 `GET /client/skills?project_id=` returns only `client_facing` + `client_ready` skills of `scope="project"`; assert **zero** internal fields in the body (recursive "no internals" search — reuse the 8.2 pattern; assert absence of `visibility`, `lifecycle_state`, `org_id`, `author`). **AC5:** seed an `internal_only` and a `paired` skill → assert both are absent.
  - [ ] 6.2 `GET /client/skills?study_id=` returns both `scope="project"` and `scope="study"` client skills (bucketing verified by the FE; here just assert both scopes present).
  - [ ] 6.3 Scope isolation: a client granted `client_A` gets 403/404 for `project_id`/`study_id` under `client_B` (mirror 8.3's isolation test). Studies/locations routes: same isolation.
  - [ ] 6.4 **AC6:** client invokes a skill (via `POST /client/invocations/{id}`), worker runs, then query `audit_log_entries` (or the audit read path) → assert an entry with `user_id == _CLIENT_USER_ID`, the real engagement `hierarchy_path` (NOT `"org"` if Task 5 approved), `skill_id`, `outcome`. Seed via the existing `_seed_location_dependent_invocation_context` helper (`test_client_surface.py:177-294`) for the LD path; add a non-LD case if Task 5 is approved.
  - [ ] 6.5 Add every new schema (`ClientSkillRead`, `ClientStudyRead`, `ClientLocationRead`, list-data wrappers) to the OpenAPI schema-lock test (`test_openapi.py`).

### Frontend — Data layer (AC1, AC2, AC3, AC4)

- [ ] **Task 7 — Client skills + hierarchy hooks**
  - [ ] 7.1 Extend `velara-web/src/api/clientPortal.ts` (currently only `listMyEngagements`) with `listClientSkills({projectId?, studyId?})`, `listClientStudies(projectId)`, `listClientLocations(studyId)` — each via the shared `apiClient` (bearer + 401-refresh already wired), snake→camelCase mapping like the existing `listMyEngagements`.
  - [ ] 7.2 Add a client `ClientSkill` TS type to `velara-web/src/features/client-portal/types.ts` — `{ id, name, description, scope, locationDependent }` ONLY (NO `visibility`/`lifecycleState`/`orgId` — do NOT reuse `features/skills/types.ts` `Skill`, which carries all internals). Add `ClientStudy`/`ClientLocation` types.
  - [ ] 7.3 Add hooks under `velara-web/src/features/client-portal/hooks/`: `useClientSkills({projectId?, studyId?})`, `useClientStudies(projectId)`, `useClientLocations(studyId)` — TanStack Query, keys like `['client','skills',{projectId,studyId}]`, `staleTime: 30_000`, `isLoading`/`isError` (no hand-rolled booleans).
  - [ ] 7.4 Add `useClientCreateInvocation()` + `useClientJob(jobId)` hooks + `createClientInvocation(skillId, payload)` / `getClientJob(jobId)` in `clientPortal.ts` → hit **`POST /api/v1/client/invocations/{skillId}`** and **`GET /api/v1/client/jobs/{jobId}`** (the 8.2 client routes returning `ClientJobRead`). **DO NOT** reuse the internal `createInvocation`/`getJob` (`src/api/jobs.ts:118-126` → `/api/v1/invocations` + `/jobs`) — 8.2's `RejectClient` guard 404s client tokens off those. Poll the job with TanStack Query `refetchInterval` until `status ∈ {completed, failed, cancelled}` (job-status enum: `queued→running→completed|failed|cancelled`).

### Frontend — Discovery screens (AC1, AC2)

- [ ] **Task 8 — Client Project + Study screens under the client shell**
  - [ ] 8.1 Add routes to `velara-web/src/routes/client.tsx` (inside the existing `<ClientShell><Routes>…`): `project/:projectId` → `ClientProject`, `project/:projectId/study/:studyId` → `ClientStudy`, and a run route (`project/:projectId/run/:skillId` and `.../study/:studyId/run/:skillId`, or a single `run/:skillId` carrying origin state) → `ClientRun`. Keep `dashboard` as-is. Every new screen calls `usePageTitle(...)` (title-isolation gate C2).
  - [ ] 8.2 `ClientDashboard` (`components/ClientDashboard.tsx`) currently renders projects as **plain text with no links** — make each project a link to `/client/project/:projectId` (AC1 entry point). Preserve `usePageTitle('Dashboard')`.
  - [ ] 8.3 `ClientProject` screen (NEW): `usePageTitle(projectName)`; a **"Project-wide skills"** section ABOVE the studies list, each skill row with a **"Project-wide" badge** and a Run button (AC1); a hero **"Available skills"** count that includes them; the studies list (from `useClientStudies`) linking to each study. Mirror the internal `EngagementsScreen` project section STRUCTURE (`EngagementsScreen.tsx:960-996`) — header + count + skill rows + Run — but render **name + description ONLY** (NO `RuntimeTypeChip`/`SkillLifecycleBadge`/`VisibilityChip`). Use V3 tokens (teal `brand-*`, `ink`/`ink-2`, Poppins/Open Sans).
  - [ ] 8.4 `ClientStudy` screen (NEW): `usePageTitle(studyName)`; an **"Available across all studies"** section with a **layers icon** (the `scope==="project"` skills — AC2); a **"Study-specific"** section below (the `scope==="study"` skills — AC2); each skill row → Run button. Mirror `EngagementsScreen.tsx:1049-1084` structure (incl. the "Available across all studies" subtext) but internals-free. Back nav returns to the Project.

### Frontend — Run + output (AC3, AC4) — **D3: new client-only components**

- [ ] **Task 9 — `ClientRun` + `ClientRunOutput` (client-only; do NOT reuse internal RunConsole)**
  - [ ] 9.1 `velara-web/src/features/client-portal/components/ClientRun.tsx` (NEW): shows the skill **name + description ONLY** (from `useClientSkills`/route state) — AC3. NO `VisibilityChip`/`SkillLifecycleBadge`/`LockedSkillCard` (internal `RunConsole.tsx:122-143,181-229` leak these), NO job id / `hierarchy_path` / blocked-QA `result_metadata`, ALL nav within `/client/*`. For a **location-dependent** skill (`clientSkill.locationDependent`), collect the location: use `useClientLocations(studyId)` to render a location picker (single `location_id`) or a "run for all locations" option (`study_id` + `fan_out:true`) — mirror the internal payload logic (`RunConsole.tsx:420-423,633-637`) but with client hooks. Build the `InvocationRequest` body `{file_ref_ids?, inputs?, location_id?|study_id?+fan_out?}` and submit via `useClientCreateInvocation`.
  - [ ] 9.2 Poll via `useClientJob` (Task 7.4) through the 3 phases (upload → running/progress → done). Show a progress/running state (`queued`/`running`), then the output.
  - [ ] 9.3 `ClientRunOutput` (NEW, or inline): **REUSE ONLY the output-download rendering PATTERN** from `RunConsole.tsx` — single output (`:943-998`: prefer `output_files[]`, fall back to `output_file_url` + `output_file_key`; filename = `key.split('/').pop()`; `<a href={url} download>`), and fan-out children (`:902-936`: per-location name + status badge + presigned url). Render output text + download links. Everything comes from `ClientJobRead` (`job_id`/`status`/`output_files`/`error.message`/`created_at`/`completed_at`) — which already excludes internals — so nothing internal can leak.
  - [ ] 9.4 AC4 back button: "Back to study"/"Back to project" returns to the origin screen (carry origin in route/state). "Run again" resets to the upload phase.

### Frontend — Tests (AC1–AC6)

- [ ] **Task 10 — FE tests** *(co-located `*.test.tsx`, vitest; mock client session: `_mockAuthSession('test-token')` + `sessionStorage.setItem('velara_user', JSON.stringify({user_id,org_id:'org_client_001',role:'client'}))` — the 8.3 `mockClientSession` pattern, `client.test.tsx:1-202`)*
  - [ ] 10.1 `ClientProject` test: renders "Project-wide skills" section with "Project-wide" badges above the studies list; "Available skills" count includes them (AC1). Mock `useClientSkills`/`useClientStudies`.
  - [ ] 10.2 `ClientStudy` test: renders "Available across all studies" (project-scoped) + "Study-specific" sections (AC2).
  - [ ] 10.3 `ClientRun` test: shows name+description only; assert NO visibility/lifecycle/job-id text; run → output text + download link; back button returns to origin (AC3, AC4). Mock `useClientCreateInvocation`/`useClientJob`.
  - [ ] 10.4 Extend the title-isolation test (`client.test.tsx:92-101`) to the new `project`/`study`/`run` routes — assert no `Skill Registry`/`Audit Log`/`Access Control`/`Engagements` leak into the title on any client screen (C2).

---

## Dev Notes

### What this story is (FINAL Epic 8 story)

8.4 adds **client skill discovery** (project-wide + study-specific sections), a **client-only run/output UI** (name+description only), a small **client read surface** (skills + studies + locations), and closes the **audit** loop for client invocations. It is FE-heavy but has a real BE surface: a client skills-list endpoint with a visibility filter (AC5), two hierarchy drill-down read routes (D2), and a gated invocation-widening change (D1/AC6). After 8.4, run the **Epic 8 retrospective**.

### Dependencies (all DONE — extend, don't rebuild)

- **8.1 (RBAC, `done`)** — `UserAccessGrant`, `HierarchyScope` dep (`HierarchyScopeValue.scope_paths`/`unrestricted`/`in_scope`/`assert_in_scope`, `dependencies.py:109-167`), `resolve_scope_paths`. Internal roles bypass scope (`unrestricted=True`); only `client` is scope-restricted; `create_grant` rejects internal-role grantees (422). [Source: stories/8-1…md; architecture ADR]
- **8.2 (IP client surface, `done`)** — `/api/v1/client` router (`client.py`, prefix `/api/v1/client`), `POST /invocations/{skill_id}` + `GET /jobs/{job_id}`, `ClientJobRead`/`ClientOutputFile`/`ClientErrorInfo` (internals-free), `RejectClient` 404 guard on internal routers, the "independent BaseModel + recursive no-internals test" schema discipline. [Source: stories/8-2…md]
- **8.3 (client shell, `done`)** — `ClientShell`/`ClientAppBar`/`ClientDashboard` (`features/client-portal/components/`), `RequireClient`/`RequireInternal` guards + `isClient()`, role-aware login/root redirect, `GET /api/v1/client/engagements` (clients+projects, IP-safe), `clientPortal.ts` + `useMyEngagements`, `schemas/client.py` (`ClientEngagement*`). The client route tree (`routes/client.tsx`) = `RequireClient` → `ClientShell` → `<Routes>` with only `dashboard` today. [Source: stories/8-3…md Dev Agent Record + verified files]

### Source tree — current state of files this story touches

**Backend (velara-api):**

| File | State | Current / change |
|------|-------|------------------|
| `app/api/v1/client.py` | UPDATE | Client router (prefix `/api/v1/client`). Has `GET /engagements` (`:57`), `POST /invocations/{skill_id}` (`:154`, reuses `queue_invocation`), `GET /jobs/{job_id}` (`:190`, `ClientJobRead`, `scope.assert_in_scope` at `:216`). **Add** `GET /skills`, `GET /projects/{id}/studies`, `GET /studies/{id}/locations`. No `require_client` guard — internal tokens may call these but resolve empty grants (`:74-78`). |
| `app/schemas/client.py` | UPDATE | 8.3 `ClientEngagementProject`/`ClientEngagement`/`ClientEngagementsData` (independent BaseModels, id+name only — the discipline to copy). **Add** `ClientSkillRead`, `ClientStudyRead`, `ClientLocationRead` + list-data wrappers. |
| `app/schemas/skill.py` | READ-ONLY ref | `SkillRead` (`:222-256`) leaks `visibility`/`lifecycle_state`/`scope`/`org_id`/`author`/`created_by_user_id`/schemas/etc. **Do NOT** return this to clients — that's why `ClientSkillRead` exists. |
| `app/services/skill_service.py` | UPDATE | `list_skills` (`:401-458`) filters by `org_id`+`status`+`tag`+`q` — **NO visibility/scope filter today**. Add optional `visibility` + `scope` params (backward-compatible). |
| `app/models/skill.py` | READ-ONLY ref | `visibility` (`internal_only`/`paired`/`client_facing`, `:52-54`), `lifecycle_state` (`draft`/`internal_ready`/`client_ready`/`retired`, `:55-57`), `scope` (`project`/`study`/`null`, `:59-61`), `location_dependent` (`:65-67`), `org_id` (`:134`). **Skills are org-global, NOT ltree-pathed** (`:3`). **No attachment table exists.** |
| `app/services/hierarchy_service.py` | reuse | `list_studies`/`list_locations` for the drill-down routes (check the exact signature + `scope_paths` param; `list_projects` uses `hierarchy_path <@ ANY(CAST(:paths AS ltree[]))`, empty scope → `[]`). |
| `app/api/v1/invocations.py` | UPDATE (D1, gated) | `queue_invocation` (`:135-325`). LD single path sets real `hierarchy_path=location.hierarchy_path` (`:264-272`) + `scope.assert_in_scope` (`:255`); LD fan-out sets study path + `assert_in_scope` (`:216-220`). **Non-LD branch (`:274-292`) hardcodes `hierarchy_path="org"` and 403s any non-`unrestricted` caller** — this is the D1 change point (Task 5). |
| `app/schemas/invocation.py` | READ-ONLY ref | `InvocationRequest` (`:17-49`, `extra="forbid"`): `file_ref_ids`, `inputs`, `location_id`, `study_id`, `fan_out`. Client run body uses the same. |
| `app/services/audit_service.py` | READ-ONLY ref (verify) | `record_entry` (`:38-95`): `skill_id`, `skill_version`, `user_id`, `hierarchy_path`, `runtime_type`, `outcome`, `error_code`, timestamps, `fan_out`, `invocation_id`. Append-only (migration `0006` trigger). |
| `app/workers/execution_tasks.py` | READ-ONLY ref (verify) | Audit writes: success/blocked (`:219-250`), failure (`:297-309`), fan-out parent — `user_id=job.created_by_user_id`, `hierarchy_path=str(job.hierarchy_path)`. **AC6 already satisfied at write level.** |
| `tests/integration/api/test_client_surface.py` | UPDATE | Helpers: `_custom_headers(user_id, org_id, role="client")` (`:84`), `_seed_skill_in_client_org(lifecycle_state="client_ready", ...)` (`:97-174`, inserts `visibility='client_facing'`, `location_dependent=false`), `_seed_location_dependent_invocation_context` (`:177-294`, LD skill + full hierarchy + `create_grant`). Constants `_CLIENT_ORG="org_client_001"`, `_INTERNAL_ORG="org_vitalief"`, `_CLIENT_USER_ID="usr_003_client"`. Add 8.4 tests here. |
| `tests/integration/api/test_openapi.py` | UPDATE | Add each new client schema to the schema lock. |

**Frontend (velara-web):**

| File | State | Current / change |
|------|-------|------------------|
| `src/routes/client.tsx` | UPDATE | `RequireClient` → `ClientShell` → `<Routes>` with only `index`→`dashboard` + `dashboard`. **Add** `project/:projectId`, `.../study/:studyId`, run routes. |
| `src/features/client-portal/components/ClientDashboard.tsx` | UPDATE | Renders engagements; projects are **plain text, NO links** (`:44-49`). Make projects link to `/client/project/:projectId`. Keep `usePageTitle('Dashboard')` (`:9`). |
| `src/features/client-portal/components/ClientShell.tsx` | READ-ONLY ref | AppBar + `<main>{children}` + engagement label from `useMyEngagements`. New screens render inside it. |
| `src/features/client-portal/components/ClientProject.tsx` / `ClientStudy.tsx` / `ClientRun.tsx` | NEW | The discovery + run screens (Tasks 8, 9). |
| `src/features/client-portal/types.ts` | UPDATE | Has `ClientEngagement*`. Add `ClientSkill` (id/name/description/scope/locationDependent ONLY), `ClientStudy`, `ClientLocation`. |
| `src/api/clientPortal.ts` | UPDATE | Has `listMyEngagements` only. Add `listClientSkills`/`listClientStudies`/`listClientLocations`/`createClientInvocation`/`getClientJob` (snake→camelCase; shared `apiClient`). |
| `src/features/client-portal/hooks/` | UPDATE | Has `useMyEngagements`. Add `useClientSkills`/`useClientStudies`/`useClientLocations`/`useClientCreateInvocation`/`useClientJob`. |
| `src/features/run/hooks/useProjectSkills.ts` | READ-ONLY ref | The mock seam: **ignores `_projectId`**, filters global `useSkills()` by `scope==='project'`; comment "backend skill-attachment is a later epic". 8.4's client version mirrors the scope-heuristic (server-side). No `useStudySkills` exists (study reuses `useProjectSkills`). |
| `src/features/engagements/components/EngagementsScreen.tsx` | READ-ONLY ref | Internal project skills section (`:960-996`) + study "Available across all studies" section (`:1049-1084`) — the STRUCTURE to mirror. **Leaks** `RuntimeTypeChip`/`SkillLifecycleBadge` — client version must NOT. `onRun(skillId, origin, originId)`. |
| `src/features/run/components/RunConsole.tsx` | READ-ONLY ref | **Leaks:** `LockedSkillCard`/`SkillPickerRow` show `VisibilityChip`+`SkillLifecycleBadge` (`:131-132,214-215`). **Reuse ONLY** the output-download pattern: single (`:943-998`), fan-out children (`:902-936`); location payload logic (`:420-423,633-637`); location selector gating (`:365,384`). All nav is `/internal/*` — client version stays `/client/*`. |
| `src/api/jobs.ts` | DO NOT REUSE | `createInvocation`/`getJob` (`:118-126`) → `/api/v1/invocations` + `/jobs` — 404'd for client tokens by `RejectClient`. Use the client hooks. |
| `src/features/client-portal/types.ts` `Skill` from `features/skills/types.ts` | DO NOT REUSE | `Skill` (`:24-45`) carries `visibility`/`lifecycle_state`/`org_id`/schemas — internals. Use the slim `ClientSkill`. |
| `src/routes/client.test.tsx` | UPDATE | 8.3 title-isolation test (`:92-101`) + `mockClientSession` (`velara_user` sessionStorage seed) + `useMyEngagements` mock pattern. Extend for new screens. |

### Critical constraints (read before coding)

- **C1 — BE test auth backend.** `.env` has `AUTH_BACKEND=cognito`; `DevAuthProvider` HS256 tokens are rejected by Cognito RS256. Run integration tests with `docker compose exec -e AUTH_BACKEND=dev api pytest tests/integration/api/test_client_surface.py`. Tests need Postgres+MinIO+Redis up. [8.2/8.3 learning]
- **C2 — Title isolation (regression gate).** `client.test.tsx:92-101` asserts client routes don't leak internal labels into the tab title. Every new client screen MUST call `usePageTitle(...)`. Extend the negative assertion to `project`/`study`/`run`.
- **C3 — IP-safe everywhere (AC3, AC5).** Client skill/study/location/job schemas expose id + name (+ description/scope/locationDependent for skills) ONLY. NO `visibility`/`lifecycle_state`/`org_id`/`author`/`hierarchy_path`/schemas. The FE run/output UI shows name+description+output only — no chips/badges/job-id. This is enforced structurally (separate schemas + separate components), the same discipline that let 8.2/8.3 pass their "zero internals" assertions.
- **C4 — D1 invocation widening is a security-boundary change (architect sign-off).** Task 5 revises the 8.1 ruling that only internal roles run org-global (`"org"`-path) invocations. Do NOT ship it without recorded architect sign-off. Keep the change gated on `not scope.unrestricted` so internal behavior is untouched, and never let a scoped user's job fall back to `hierarchy_path="org"` (breaks AC6 attributability). Fallback if withheld: list only `location_dependent` client skills and accept the non-LD limitation.
- **C5 — No new migration.** Skills, hierarchy, grants, audit tables all exist (migrations through `0016`). Adding a visibility filter + read routes + (gated) invocation logic needs NO schema change. The real attachment model is explicitly deferred. Confirm before authoring any migration.
- **C6 — Client runs are location-dependent by default (today).** Until D1 lands, a client can only run `location_dependent` skills. The run UI must collect a `location_id` (single) or `study_id`+`fan_out` (all locations) for those — hence the studies/locations drill-down routes (Task 2). If D1 is approved, non-LD skills also become runnable (body carries `project_id`/`study_id` to resolve the engagement path).

### Architecture compliance (hard rules — All Agents MUST)

[Source: architecture/implementation-patterns-consistency-rules.md#enforcement-rules-all-agents-must]

1. **Response envelope** on all new routes (`{data, meta}`); use `PageMeta` for the skills list.
2. **`hierarchy_scope` on hierarchical routes** — the studies/locations/skills-context routes depend on `HierarchyScope` and `assert_in_scope` the referenced node.
3. **snake_case API / camelCase TS** — map at the FE boundary (as `listMyEngagements` already does).
4. **`request_id`** via `ResponseMeta` (the `_meta(request)` helper on the client router).
5. **No raw exception messages** — map through the global handler / `VelaraHTTPException`.
6. **Co-locate tests**; **TanStack Query** `isLoading`/`isError` + `refetchInterval` for job polling (no hand-rolled polling loops); `staleTime: 30_000` for lists.
7. Stable enums: skill visibility `internal_only|paired|client_facing`; lifecycle `draft|internal_ready|client_ready|retired`; job status `queued→running→completed|failed|cancelled`. Async invocation = `202 Accepted` + `job_id`, poll the job. [Source: architecture core decisions + consistency rules]

### Library / framework versions (pinned — no new deps)

React 19, react-router-dom 7, aws-amplify 6, @tanstack/react-query 5, zustand 5, tailwindcss 4, vite 6, vitest 2, @testing-library/react 16. Backend: FastAPI + async SQLAlchemy + Pydantic v2 (`ConfigDict`), Postgres `ltree`, Alembic, Celery worker. [Source: velara-web/package.json; 8.1–8.3 stories]

### UX / design intent

[Source: design/client.jsx, design/styles_v3.css, PRD, architecture]

- **Project view:** hero "Available skills" count; "Project-wide skills" section above the studies list (each with a "Project-wide" badge); studies list. **Study view:** "Skills for this study" with an "Outputs only" shield chip; "Available across all studies" (layers icon, project-scoped skills) + "Study-specific" sections. **Run flow (3 steps):** upload input → running/progress (spinner + bar, "Processing your document securely. Usually under a minute.") → done (success banner "Your deliverable is ready", output-files grid with download buttons, "Run again" / "Back to study"). The mockup exposes **no** internals — name + description + output file-type tags only.
- Brand: V3 tokens — teal `#128F8B` (`brand-*`), navy `#323843` (`ink`), slate `#4C5270` (`ink-2`), Poppins headings / Open Sans body. Use token classes.
- **PRD FRs:** **ACL-04** (clients see name/description/result/output files — nothing else), **ACL-07** (project-level "available across all studies" + study-level skills, both invocable if granted), **ACL-03/ACL-05** (internals never returned; client surface is invoke-only), **INV-05** (run interface is contextual, not a top-level nav item), **INV-09** (project skills visible from project AND each study), **OUT-01** (multiple mixed-type artifacts + canonical JSON), **USE-01** (every invocation logged: user/org/client/project/study/location/skill/version/duration/outcome/input/output — the AC6 anchor, 21 CFR Part 11 §11.10(e)). [Source: prds/.../5-functional-requirements.md, 7-user-journeys.md UJ-2]

### Previous-story intelligence (apply)

- **8.3:** the client `/engagements` endpoint + `useMyEngagements` return clients+projects ONLY (no studies/skills) — hence Task 2's drill-down routes. `ClientDashboard` shows projects as plain text — Task 8.2 adds links. `mockClientSession` seeds `velara_user` in sessionStorage (role:client) — 8.4 tests reuse it. Title-isolation is a live gate. Pre-existing 8.2 test failures are dev-DB state, not code.
- **8.2:** IP-safe = independent BaseModel + recursive no-internals test. `RejectClient` 404s client tokens off internal routes (why internal hooks are off-limits). Client invocation reuses `queue_invocation`.
- **8.1:** internal roles `unrestricted`; client scope-restricted; the non-LD `"org"`-path invocation is gated to `unrestricted` — the exact ruling D1 revises. `assert_in_scope`: out-of-scope same-org → 403, cross-org → 404.

### Git intelligence

History is squashed (initial import + `updates` commit), so per-file diffs aren't informative; the 8.1/8.2/8.3 Dev Agent Records + the verified file-state tables above are authoritative. All three prior Epic 8 stories are implemented and `done`.

### Scope boundaries (do NOT do these)

- A real project↔skill / study↔skill **attachment model** (join table + assignment UI) — explicitly deferred ("a later epic"); 8.4 uses the scope-heuristic (org skills of the right scope, gated by grant + visibility).
- The `/client/invocations` + `/client/jobs` **routes themselves** (8.2) and grants (8.1) and the client shell/engagements (8.3).
- Widening invocation beyond the minimal client-non-LD case (D1) — internal behavior stays untouched; do not refactor the internal run path.
- Analytics/usage (Epic 9). The Epic 8 **retrospective** runs after 8.4 is `done`.

### Project Structure Notes

New FE screens/hooks live under `features/client-portal/{components,hooks}/`; new API fns in `api/clientPortal.ts`; new routes in `routes/client.tsx` under the existing `ClientShell`. New BE schemas in `schemas/client.py`; new routes on the existing client router; service filter param added in place. Tests co-located (FE `*.test.tsx`; BE in `test_client_surface.py`). No structural variance from `architecture/project-structure-boundaries.md`.

### References

- [Source: epics/epic-8-access-control-client-portal.md#story-8.4] — the 6 ACs (authoritative).
- [Source: architecture/core-architectural-decisions.md] — skill artifact IP model; async job invocation (202+poll); internal-roles-org-global ADR (the D1 boundary); skill visibility enum.
- [Source: architecture/implementation-patterns-consistency-rules.md] — envelope, hierarchy_scope, snake/camel, PageMeta, enums, co-located tests, TanStack loading.
- [Source: stories/8-1…md, 8-2…md, 8-3…md] — grant model, client router + IP-safe discipline, client shell + `/engagements` + verified built state.
- [Source: velara-api/app/api/v1/{client,invocations,skills}.py, app/services/{skill_service,audit_service}.py, app/schemas/{client,skill,invocation}.py, app/models/skill.py, app/workers/execution_tasks.py] — BE current state.
- [Source: velara-web/src/routes/client.tsx, src/features/client-portal/**, src/api/{clientPortal,jobs}.ts, src/features/run/{components/RunConsole.tsx,hooks/useProjectSkills.ts}, src/features/engagements/components/EngagementsScreen.tsx, src/features/skills/types.ts] — FE current state.
- [Source: design/client.jsx, design/styles_v3.css] — client discovery + run/output UX + brand tokens.
- [Source: prds/prd-Velara-2026-05-29/prd/{5-functional-requirements,7-user-journeys}.md] — ACL-03/04/05/07, INV-05/09, OUT-01, USE-01, UJ-2.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log
