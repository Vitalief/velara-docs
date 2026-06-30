# Epic 5: Run Console & Invocation UX

Consultants can invoke skills from the web UI in context-first and skill-first modes, with job polling and result display. Skills are also invokable from Claude and REST API.

## Story 5.1: Invocation API & Job Polling

As an MA Tech developer,
I want the invocation endpoint that creates a job and the polling endpoint that returns its status,
So that all invocation surfaces (web, CLI, Claude) have a consistent async API to drive skill execution.

**Acceptance Criteria:**

**Given** I call `POST /api/v1/invocations/{skill_id}` with a valid context payload
**When** the request is processed
**Then** an `InvocationJob` is created with status `queued`, the Celery task is enqueued, and the response is HTTP 202 with `{"data": {"job_id": "...", "status": "queued"}, "meta": {...}}`

**Given** I call `GET /api/v1/jobs/{job_id}` while the job is running
**When** the response is returned
**Then** status is `running` with `started_at` timestamp

**Given** I call `GET /api/v1/jobs/{job_id}` after completion
**When** the response is returned
**Then** status is `completed`, `completed_at` is set, and `result` contains output file presigned URLs (valid 24 hours)

**Given** I call `POST /api/v1/invoke/{skill_id}` (Claude proxy endpoint) with a minimal payload
**When** the platform executes the skill
**Then** the response contains only the output — no skill instructions, code, or internals are returned

**Given** a job fails
**When** I call `GET /api/v1/jobs/{job_id}`
**Then** status is `failed` and `error` contains a user-safe `code` and `message` — no raw exception detail

---

## Story 5.2: Run Console — Context-First Mode

As a Vitalief consultant,
I want to launch the Run Console from an Engagement entity (Project or Study) with the context pre-scoped,
So that I can quickly invoke skills relevant to my current engagement without re-selecting the context I'm already viewing.

**Acceptance Criteria:**

**Given** I am viewing a Project detail screen
**When** I click "Run" on a skill chip
**Then** the Run Console opens with Client, Project pre-populated and locked; a skill picker shows only skills attached at the Project level

**Given** I am viewing a Study detail screen
**When** I click "Run" on a skill chip
**Then** the Run Console opens with Client, Project, Study pre-populated and locked; the skill is pre-selected

**Given** the Run Console is open in context-first mode
**When** the selected skill is location-dependent
**Then** a location selector appears showing all Locations in the Study; the consultant must select one location or choose "Run for all locations"

**Given** I click "Run" in the Run Console
**When** the invocation is submitted
**Then** `POST /api/v1/invocations/{skill_id}` is called with the locked context payload and a job status indicator appears

**Given** the Run Console is open
**When** I click the back button
**Then** I am returned to the originating Project or Study detail screen — the back destination is always the entity that launched the Run Console

---

## Story 5.3: Run Console — Skill-First Mode

As a Vitalief consultant,
I want to launch the Run Console from a Skill detail view with the skill pre-selected and an unrestricted context picker,
So that I can test or run any skill against any engagement without the skill needing to be formally attached to that project.

**Acceptance Criteria:**

**Given** I am viewing a Skill detail page
**When** I click "Run"
**Then** the Run Console opens in skill-first mode: the skill card is shown with a green tint and locked (cannot be changed)

**Given** the Run Console is in skill-first mode
**When** the context picker renders
**Then** it shows all Clients, Projects, and Studies in the system — not filtered by skill attachment

**Given** I select a context in skill-first mode
**When** I select Client → Project → Study (or Client → Project if no Study)
**Then** the Run button becomes active and the invocation will use the selected context with the locked skill

**Given** I click "Run" in skill-first mode
**When** the invocation is submitted
**Then** `POST /api/v1/invocations/{skill_id}` is called with the selected context and the skill dropdown is absent from the UI

**Given** the Run Console was opened from Skill Detail
**When** I click the back button
**Then** I am returned to the Skill detail page for the skill that was being tested

---

## Story 5.4: Job Status Polling & Output Display

As a Vitalief consultant,
I want to see live job status updates while a skill runs, view the output when it completes, and be able to find past jobs after navigating away,
So that I know the execution is progressing, can immediately access results, and can come back to long-running jobs without losing track of them.

> **Scope confirmed with user 2026-06-12:** This story must cover three things:
> 1. **Live polling on the Run Console** — replace the "Queued" stub with real `GET /api/v1/jobs/{id}` polling.
> 2. **Jobs History screen** — a new `/internal/jobs` page listing recent jobs with status + originating skill/context, so users can find a long-running job after navigating away.
> 3. **Persist `activeJobId` to localStorage** — Zustand store is currently in-memory only; a page refresh loses the active job ID entirely.
>
> **Why:** After 5-2 ships, submitting an invocation shows "Queued" and then disappears — no live updates, no history, no way to return to a long-running job. All three gaps must be closed here.

**Acceptance Criteria:**

**Given** a job has been submitted
**When** the Run Console is showing job status
**Then** it polls `GET /api/v1/jobs/{job_id}` every 3 seconds and updates the status indicator: Queued → Running → Completed/Failed

**Given** the job transitions to `completed`
**When** the UI updates
**Then** the output text is displayed inline and any output file download links are shown

**Given** an output file download link is clicked
**When** the presigned S3 URL is called
**Then** the file downloads directly from S3 — it does not route through the API server

**Given** the job transitions to `failed`
**When** the UI updates
**Then** a user-friendly error message is displayed using the `error.code` → human message map; a "Try again" button is shown

**Given** a fan-out job is running
**When** the UI shows status
**Then** a progress indicator shows "X of N locations complete" updating as child jobs finish

**Given** a fan-out job completes
**When** the output is displayed
**Then** results are shown grouped by location with individual download links per location output

**Given** a user has submitted a job and then navigated away (or refreshed the page)
**When** they visit `/internal/jobs`
**Then** a Jobs History screen shows recent jobs with status, timestamps, originating skill name, and a link back to the Run Console for that job

**Given** the user refreshes the page while a job is active
**When** the Run Console reloads
**Then** the active job ID is restored from localStorage and polling resumes automatically

---

## Story 5.5: REST API Documentation & OpenAPI Spec

As an MA Tech developer or external integrator,
I want a published OpenAPI spec and basic API documentation,
So that skills can be invoked from scripts, Claude Code, and third-party tools without guessing endpoint shapes.

**Acceptance Criteria:**

**Given** the FastAPI app is running
**When** I navigate to `/api/v1/docs`
**Then** the Swagger UI is available showing all routes, request schemas, and response schemas

**Given** the FastAPI app is running
**When** I call `GET /api/v1/openapi.json`
**Then** a valid OpenAPI 3.x JSON spec is returned that can be imported into tools like Postman or used to generate client SDKs

**Given** the `/api/v1/invoke/{skill_id}` Claude proxy endpoint is documented
**When** I inspect the spec
**Then** the request schema shows only `context` and `inputs` fields — no internals fields are present in the schema

**Given** the OpenAPI spec is exported
**When** it is committed to the velara hub repo at `docs/api-spec.json`
**Then** it is kept in sync with the actual API via a CI step that regenerates and diffs it on each PR

---

## Story 5.6: Skills List API Pagination

> Added via correct-course 2026-06-12 (see `sprint-change-proposal-2026-06-12.md`). Root cause surfaced during Story 5-2 code review + dev-DB cleanup. **BACKEND.** Build before 5.7.

As a platform developer,
I want `GET /api/v1/skills` to paginate its results,
So that the skill registry stays fast regardless of how many skills exist in an org.

**Acceptance Criteria:**

**Given** I call `GET /api/v1/skills?page=1&per_page=50`
**When** the org has more than `per_page` skills
**Then** at most `per_page` skills are returned, ordered `created_at desc`, with the existing `?status=` / `?tag=` filters still honored (default `page=1`, `per_page=50`, max `per_page=200`)

**Given** the paginated list response
**When** I inspect the envelope
**Then** it carries pagination metadata via `PageMeta` (`total`, `page`, `per_page`) — `PageMeta` already exists in `app/schemas/common.py` ("Pagination metadata for future list endpoints"); `total` reflects the filtered count (status+tag applied to the COUNT as well)

**Given** I request a `page` beyond the last page
**When** the query runs
**Then** `data` is an empty list with the correct `total` (not a 404); invalid `page`/`per_page` (≤0 or `per_page` > max) return HTTP 422

**Given** existing callers that pass no pagination params
**When** they call `GET /api/v1/skills`
**Then** they get page 1 at the default page size (backwards compatible — Story 2.1 `?status=` filter behavior preserved)

> Scope: `skill_service.list_skills` applies `.limit()/.offset()` + a separate filtered `COUNT(*)`. No migration. Gates: ruff clean, Docker suite green (state delta), OpenAPI (5.5) auto-reflects new params.

---

## Story 5.7: Skill Registry UI — Pagination

> Added via correct-course 2026-06-12. **FRONTEND. Depends on 5.6.**

As a Vitalief consultant,
I want the Skill Registry to load skills in pages,
So that browsing the registry stays fast even with a large skill catalog.

**Acceptance Criteria:**

**Given** the Skill Registry tab
**When** the page loads
**Then** it consumes the paged `GET /api/v1/skills` (via `useSkills`/`listSkills` accepting `page`/`per_page`), showing one page of results with a pagination affordance (page controls or "Load more"/infinite scroll — decided in-story) reflecting `PageMeta.total`

**Given** I apply a lifecycle/visibility/runtime/tag filter
**When** the filter changes
**Then** `status`/`tag` are sent as server-side query params (moving off the current fetch-all-then-filter-client-side model at `SkillRegistry.tsx:102-124`); the React Query key includes page + active filters

**Given** I use the free-text / ⌘K search
**When** I type
**Then** search behaves per the locked-in-story decision (client-side within the current page, or a documented limitation) and the 2.4 ⌘K registry-search behavior is re-confirmed under pagination

**Given** the registry is loading, empty, or errored
**When** any of those states occur
**Then** the existing loading/empty/error UX is preserved, and the pagination controls are keyboard-accessible with proper labels

> Gates: typecheck 0, lint clean, web tests (state delta), build ✓.

---
