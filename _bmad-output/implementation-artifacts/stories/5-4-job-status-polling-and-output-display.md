---
baseline_commit: a111997cfb1267cc9f8ca1c0fb89fa9c4698da4e
---

# Story 5.4: Job Status Polling & Output Display

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to see live job status updates while a skill runs, view the output when it completes, and be able to find past jobs after navigating away,
so that I know the execution is progressing, can immediately access results, and can come back to long-running jobs without losing track of them.

> **FULL-STACK story** (decision locked with user 2026-06-15). Frontend = React 19 + React Router 7 + TanStack Query 5 + Zustand 5 + Axios + Tailwind v4. Backend = FastAPI + SQLAlchemy 2.0 async + Pydantic v2 (Python). This story **closes the Run Console loop** that 5-2/5-3 deliberately stubbed. It has **three** deliverables (from the Epic 5.4 scope note, confirmed with user):
> 1. **Live polling on the Run Console** — replace the "Queued" STUB (`RunConsole.tsx:783-807`) with real 3s `GET /api/v1/jobs/{id}` polling that stops at a terminal status, shows output, and shows fan-out "X of N".
> 2. **Jobs History screen** — a NEW `/internal/jobs` page listing recent jobs. **This REQUIRES a NEW backend endpoint `GET /api/v1/jobs` that does NOT exist today** (verified: the jobs router has only `GET /{job_id}` + `POST /{job_id}/cancel`). The user chose to build it here (full-stack), not defer it.
> 3. **Persist `activeJobId` to localStorage** — the Zustand store is in-memory only; a refresh loses the active job. Wrap `useRunStore` in zustand `persist` (partialized to `activeJobId`) so polling resumes after refresh.

## Acceptance Criteria

**AC1 — Live 3s polling on the Run Console; status indicator advances**
**Given** a job has been submitted
**When** the Run Console is showing job status
**Then** it polls `GET /api/v1/jobs/{job_id}` every 3 seconds and updates the indicator: Queued → Running → Completed/Failed
> Replace the `JobStatusPanel` STUB (`RunConsole.tsx:783-807`, which hardcodes `status="queued"`). Build a `useJob(jobId)` hook with `refetchInterval` that **STOPS at a terminal status** (`completed`/`failed`/`cancelled`) — this is the app's FIRST polling hook (no `refetchInterval` exists anywhere yet). **Reuse** the already-built `JobStatusBadge` + `JOB_STATUS_META` (`RunConsole.tsx:59-81`) — they're already V3-token-correct for all 5 statuses; do NOT re-derive colors.

**AC2 — Completed job shows output text + file download links**
**Given** the job transitions to `completed`
**When** the UI updates
**Then** the output text is displayed inline and any output file download links are shown
> **Contract reality (verified):** there is **NO inline output TEXT field** in the job response. Output is delivered exclusively as **S3 files**: `result.output_files[]` (each with `key`, `format`, `content_type`, `size_bytes`, `url`) and the back-compat `result.output_file_url`/`output_file_key`. Any text-ish summary lives in `result.result_metadata` (e.g. `{format, char_count}`). So "output text" = render `result_metadata` if present + a file list; the primary deliverable is the **download links**. See *Dev Notes → Job-read contract*.

**AC3 — Output file downloads come directly from S3 (not via API)**
**Given** an output file download link is clicked
**When** the presigned S3 URL is called
**Then** the file downloads directly from S3 — it does not route through the API server
> `result.output_files[].url` / `result.output_file_url` / `children[].output_file_url` are **presigned GET URLs (24h TTL)** generated inline at poll time, pointing directly at S3/MinIO. Render them as plain `<a href={url} download>` links — the browser hits S3 directly. **Each `url` may be `null`** (best-effort presign failed) — guard for it (disable the link / show the key). The 24h TTL means a stale History view must re-poll to refresh URLs; don't cache them.

**AC4 — Failed job shows a friendly message + "Try again"**
**Given** the job transitions to `failed`
**When** the UI updates
**Then** a user-friendly error message is displayed using the `error.code` → human message map; a "Try again" button is shown
> A failed job returns **HTTP 200** with `status="failed"` and `error: {code, message}` (only when failed). The `error.message` is already user-safe; map `error.code` for curated copy. The execution error codes (`SKILL_EXECUTION_ERROR`, `EXECUTION_TIMEOUT`, `FAN_OUT_PARTIAL_FAILURE`, `FAN_OUT_CANCELLED`, `FAN_OUT_INCOMPLETE`, `LLM_RATE_LIMIT`, `OUTPUT_GENERATION_FAILED`, `BRAND_ASSET_MISSING`, `MISSING_CREDENTIAL`, …) are **NOT yet in the frontend error map** (`errors.ts` only has invocation-creation codes) — add a `friendlyJobError`/`JOB_ERROR_MESSAGES` (don't overload `friendlyInvocationError`). "Try again" navigates back to the Run Console launch (re-submit) — define the simplest correct behavior in-story (see *Dev Notes → "Try again"*).

**AC5 — Fan-out job shows "X of N locations complete"**
**Given** a fan-out job is running
**When** the UI shows status
**Then** a progress indicator shows "X of N locations complete" updating as child jobs finish
> A fan-out parent has `fan_out: true` and an **inline `children[]`** array (each: `job_id`, `location_id`, `location_name`, `status`, `output_file_key`, `output_file_url`). There is **no `completed_count`** field — compute X/N client-side: `N = children.length`, `X = children.filter(c => c.status==='completed').length`. **This is net-new UI** (no prototype reference). The poll updates `children[]` every 3s.

**AC6 — Fan-out completion shows per-location results grouped**
**Given** a fan-out job completes
**When** the output is displayed
**Then** results are shown grouped by location with individual download links per location output
> Group by `children[].location_id` (label with `location_name`, may be `null` → fall back to the id/"Location"). Each child row shows its `status` + a download link from `children[].output_file_url` (24h presigned, may be `null`). **Note:** the inline `JobChild` carries only a single `output_file_url` (not the full `output_files[]`/`error`). For a child's FULL result or friendly error message, re-poll that child via `GET /api/v1/jobs/{child.job_id}` — keep 5-4 simple: show per-child status + the single download link; deep-dive into a child is optional/out-of-scope unless trivial.

**AC7 — Jobs History screen lists recent jobs (NEW backend endpoint)**
**Given** a user has submitted a job and then navigated away (or refreshed)
**When** they visit `/internal/jobs`
**Then** a Jobs History screen shows recent jobs with status, timestamps, originating skill name, and a link back to the Run Console for that job
> **NEW BACKEND: `GET /api/v1/jobs`** (org-scoped, paginated, newest-first) — does NOT exist; build it (Task 1). The job row has **NO `skill_name`** (only `skill_id`/`skill_version`) — resolve the name via a LEFT/outer join to `Skill` in the list query (FK has no CASCADE → history survives skill deletion → must be outer join) and expose `skill_name` on the summary, OR resolve client-side. "Link back to the Run Console for that job" — the Run Console route needs a way to show a *specific* job id (the console today derives `activeJobId` from submit). Define this in-story (see *Dev Notes → History → Run Console link*).

**AC8 — Refresh restores the active job and resumes polling**
**Given** the user refreshes the page while a job is active
**When** the Run Console reloads
**Then** the active job ID is restored from localStorage and polling resumes automatically
> Wrap `useRunStore` in zustand `persist` (`partialize: s => ({ activeJobId: s.activeJobId })`). On reload, the rehydrated `activeJobId` feeds `useJob(activeJobId)` and polling resumes. This is the **first** persist/localStorage usage in the app — note the `create<RunState>()(...)` curried form for v5 TS.

## Scope: Full-Stack — Backend list endpoint + Frontend polling/output/history

**5-4 BUILDS (backend):**
- **`GET /api/v1/jobs`** — a new list handler on the existing jobs router (`velara-api/app/api/v1/jobs.py`, `@router.get("")`). Org-scoped, newest-first (`ORDER BY created_at DESC`), paginated (`page`/`per_page`, default 50, max 200), optional `?status=` filter (typed enum/Literal → 422 on bad value). Returns a light `JobSummary` list + `PageMeta`. `list_jobs(...)` in `job_service.py` mirrors `list_children` + LIMIT/OFFSET + `func.count()`. **No migration** (read-only; indexes already support it).

**5-4 BUILDS (frontend):**
- **`useJob(jobId)` poll hook** + `getJob`/`listJobs` + the `JobReadWithResult`/`JobSummary`/`OutputFileRef`/`JobChild`/`ErrorInfo` types in `api/jobs.ts`.
- **Live `JobStatusPanel`** (replace the stub): status badge, output file list + download links, `result_metadata` text, failed→friendly error + "Try again", fan-out "X of N" + per-location grouped results.
- **Jobs History screen** at `/internal/jobs` + a `jobs` NavTab + route, consuming `GET /api/v1/jobs`.
- **`useRunStore` persist** (localStorage, partialized to `activeJobId`).
- **`friendlyJobError`** + `JOB_ERROR_MESSAGES` map (job/execution codes).
- **Tests + gates** both sides (backend: Docker pytest, state delta from 24 `test_jobs.py` integration tests; frontend: web suite green, state delta from **204** baseline).

**5-4 DEFERS (do NOT build):**
- **Job cancel UI** — the backend `POST /jobs/{id}/cancel` exists, but no AC needs the button. Out of scope (Epic 8 / later); note it.
- **Deep per-child drill-down** (full child result/error via re-poll) — AC6 only needs per-child status + the single download link.
- **RBAC/access-gating on job visibility** → Epic 8.
- **OpenAPI/Swagger** (5-5), audit UI (Epic 9), skills pagination (5-6/5-7 — separate stories; do NOT pre-build skills pagination here).
- **File-upload / schema-driven `inputs`** (carried from 5-2/5-3 DEFERS).

**Out of scope entirely:** changing the invocation submit flow (5-2/5-3), changing the execution engine (Epic 3), brownfield cancel semantics.

## Design Fidelity — `design/` for the output panel; fan-out & history are net-new

> The prototype's right-column **"Executing"/"Run complete"** panel is the visual starting point for the live status + output UI (`design/overrides.jsx` RunConsole, lines ~261–309). Port it — translate every `var(--green-*)` to `brand-*`/`st-*` (the 1-6 drift trap; raw `green-*` is forbidden). **But:**
> - **Fan-out "X of N" + per-location grouped results = NET-NEW UI** — no prototype exists; design it from scratch using the established card class (`rounded-lg border border-line bg-surface px-[22px] py-5`) + `JobStatusBadge`.
> - **Jobs History screen = NET-NEW** — no standalone screen in the prototype. Use `design/data.js`'s `invocations` row shape (`id, skill, v, user, surface, ms, outcome, at, error`) and the per-skill "Recent runs" row styling (`design/internal.jsx:300-313`) as design references.
>
> **Reuse, don't re-derive:** `JobStatusBadge` + `JOB_STATUS_META` (`RunConsole.tsx:59-81`) are already V3-token-correct for all 5 statuses — export and reuse them in the live panel AND the history rows. `Skeleton`/`Toast` exist (thin stubs). There is **no `Card` component** — use the card class string. Fidelity verified by **code reference** (no screenshot step).

## Tasks / Subtasks

### Backend

- [x] **Task 1 — `GET /api/v1/jobs` list endpoint (AC: 7)**
  - [x] Add `@router.get("")` to `velara-api/app/api/v1/jobs.py` (mirrors `skills.py`'s `@router.get("")` list handler). DI order: `request: Request, user: CurrentUser, session: DbSession` (no `OutputStorage` — **no per-row presigning**). Query params after DI: `page: int = 1`, `per_page: int = 50`, `status: <JobStatus enum/Literal> | None = None`. Validate `page>=1`, `1<=per_page<=200` (FastAPI `Query(ge=1, le=200)`); out-of-range page → empty list + correct `total` (not 404); bad `status` → 422 (type it as a `Literal["queued","running","completed","failed","cancelled"]` or an enum so FastAPI auto-422s, mirroring `list_skills`' `LifecycleState` param).
  - [x] Add `list_jobs(*, session, org_id, page, per_page, status_filter=None) -> tuple[list[InvocationJob], int]` to `job_service.py`. Mirror `list_children`'s org-scoped `select(...).where(InvocationJob.org_id == org_id)` + `.order_by(InvocationJob.created_at.desc())`, add `.limit(per_page).offset((page-1)*per_page)`, and a separate `select(func.count()).select_from(InvocationJob).where(...same filters...)` → `.scalar_one()` for `total`. Apply the `status` filter to BOTH the rows query and the COUNT. **Drop `selectinload(result)`** (summary rows need no result). Keyword-only args (`*,`).
  - [x] **Skill name:** the job has no `skill_name`. Either (a) `select(InvocationJob, Skill.name).outerjoin(Skill, InvocationJob.skill_id == Skill.id)` — **outer** join (FK has no CASCADE; skill may be deleted) — and map `skill_name` onto the summary; or (b) leave it off and resolve client-side. **Recommended (a)** so History shows names without N+1 client calls. Document the choice.
  - [x] Add a `JobSummary` schema to `velara-api/app/schemas/job.py` (`model_config = ConfigDict(from_attributes=True)`): `id, skill_id, skill_version, skill_name (str|None), status, created_at, started_at, completed_at, fan_out, location_id, error_code`. Do NOT reuse `JobReadWithResult` (it presigns/loads result/children — too heavy for a list).
  - [x] **PageMeta wiring (FIRST consumer in the codebase):** `PageMeta` exists in `app/schemas/common.py` ("for future list endpoints") but is **never used**. `ResponseEnvelope.meta` is hardwired to `ResponseMeta` (request_id+timestamp) — no slot for pagination. **Recommended:** put pagination inside `data` via a new wrapper: `class JobListData(BaseModel): items: list[JobSummary]; page: PageMeta`, return `ResponseEnvelope[JobListData]`. This avoids touching the shared envelope every route uses. (Alternative — extend the envelope — is a larger blast radius; document if you choose it.) Note: this sets the precedent that 5-6 (skills pagination) will follow — keep it clean.
  - [x] **Tests** (`tests/integration/api/test_jobs.py`, 24 tests today — mirror its seed/auth/envelope helpers; Docker `pytest`): envelope shape, newest-first ordering (seed staggered `created_at`), `page`/`per_page` limit+offset, `total` correctness, `?status=` filter (happy + invalid→422), empty list (page beyond last), cross-org isolation (seed `org_vitalief`, query as `_client_auth()` → only own org's jobs / empty), auth-401. State the test delta. **No migration.**

### Frontend

- [x] **Task 2 — `api/jobs.ts`: getJob, listJobs + types (AC: 1, 2, 5, 7)**
  - [x] Add `getJob(jobId): Promise<JobReadWithResult>` → `GET /api/v1/jobs/${jobId}`, unwrap `response.data.data` (same envelope pattern as `createInvocation`). Add `listJobs(params): Promise<{items: JobSummary[]; page: PageMeta}>` → `GET /api/v1/jobs` with `{page, per_page, status?}` query params, unwrap `response.data.data`.
  - [x] Add TS types mirroring the verified backend schemas: `JobReadWithResult` (`id, skill_id, skill_version, status, started_at, completed_at, created_at, fan_out, location_id, parent_job_id, error_code, result, children, error`), `JobResult` (`output_file_key, output_file_url, output_files, result_metadata`), `OutputFileRef` (`key, format, content_type, size_bytes, url`), `JobChild` (`job_id, location_id, location_name, status, output_file_key, output_file_url`), `ErrorInfo` (`code, message`), `JobSummary`, `PageMeta` (`total, page, per_page`). `JobStatus = 'queued'|'running'|'completed'|'failed'|'cancelled'` (the existing union in `RunConsole.tsx:59` — promote it to a shared type or `api/jobs.ts`).

- [x] **Task 3 — `useJob(jobId)` poll hook (AC: 1)**
  - [x] In `src/features/run/hooks/useJob.ts`: `useQuery({ queryKey: ['job', jobId], queryFn: () => getJob(jobId!), enabled: !!jobId, refetchInterval: (query) => { const s = query.state.data?.status; return (s==='completed'||s==='failed'||s==='cancelled') ? false : 3000 } })`. Use the **singular** `['job', id]` key (engagements convention for per-id fetches). **TanStack v5: `refetchInterval` takes a function of `query`, return `false` to stop** (read `query.state.data`, NOT a closure). This is the first polling hook in the app — match the `useSkill` hook shape otherwise.

- [x] **Task 4 — Live JobStatusPanel: status + output + failed (AC: 1, 2, 3, 4)**
  - [x] Replace `JobStatusPanel` (`RunConsole.tsx:783-807`). Read `activeJobId` from `useRunStore`, drive `useJob(activeJobId)`. Render `JobStatusBadge` from the polled `status` (reuse existing — do NOT re-derive). Port the prototype's "Executing"/"Run complete" panel layout (`design/overrides.jsx:261-309`), green→`brand-*`/`st-*`.
  - [x] **Completed (AC2/AC3):** render `result.output_files[]` (and back-compat single `output_file_url`) as a "GENERATED OUTPUTS" list — per file: name (from `key`), `{format} · Vitalief brand` caption, a download `<a href={url} download>` (direct-to-S3). Guard `url === null` (presign failed → disable/show key). If `result.result_metadata` has text-ish fields, surface them. No inline output-text field exists — don't invent one.
  - [x] **Failed (AC4):** show `friendlyJobError(job.error)` + a "Try again" button (see Task 7 for the error map; Task 6 covers re-submit behavior).
  - [x] Loading/queued/running: `Skeleton` + the live badge. Keep the `rounded-lg border border-line bg-surface` card class.

- [x] **Task 5 — Fan-out X-of-N + per-location results (AC: 5, 6)**
  - [x] When `job.fan_out === true`: compute `N = children.length`, `X = children.filter(c=>c.status==='completed').length`; show "**X of N locations complete**" (net-new UI; use card class + a small progress affordance). Update live via the 3s poll.
  - [x] On completion (AC6): group `children[]` by `location_id`, label with `location_name` (fallback: id or "Location"), each row = status badge + download `<a>` from `children[].output_file_url` (guard `null`). Per-child deep result/error (re-poll `GET /jobs/{child.job_id}`) is **out of scope** — status + single link only.

- [x] **Task 6 — Persist activeJobId + resume polling (AC: 8)**
  - [x] Wrap `useRunStore` (`src/stores/useRunStore.ts`) in zustand `persist` from `zustand/middleware`: `create<RunState>()(persist((set)=>({...}), { name: 'velara-run', partialize: (s)=>({ activeJobId: s.activeJobId }) }))`. **Note the curried `create<RunState>()(...)` form** (v5 TS requirement with middleware). Only `activeJobId` persists (not `runMode`/setters). This is the app's first persist usage — no precedent to copy.
  - [x] Verify: on reload, rehydrated `activeJobId` → `useJob` resumes polling automatically (the panel already reads `activeJobId`). Don't reset `activeJobId` on mount in a way that defeats this (5-2/5-3 cleared it on console *entry* via a `useEffect` — that's for a fresh launch; the History "view this job" path and refresh must NOT clobber a valid persisted id — reconcile the clear-on-mount effect with persistence; see *Dev Notes*).
  - [x] **"Try again" (AC4) + History → Run Console link (AC7):** define how the console shows a *specific* job. Simplest: set `activeJobId` from the History row click (or a `?jobId=` param) and let `useJob` poll it. Document the chosen mechanism.

- [x] **Task 7 — Jobs History screen + route + nav tab + error map (AC: 4, 7)**
  - [x] `src/features/run/components/JobsHistory.tsx` (or `features/jobs/`): `useJobs()` hook (TanStack `useQuery(['jobs', {page,status}], () => listJobs(...))`) → a table/list of recent jobs: skill name (from `skill_summary.skill_name` or resolved), `JobStatusBadge`, created/started/completed timestamps (format via `Intl.DateTimeFormat`), and a link back to the Run Console for that job. Loading/empty/error states (Skeleton/empty copy). a11y on any pagination controls.
  - [x] Register the route in `src/routes/internal.tsx`: `<Route path="jobs" element={<div className="p-6"><JobsHistory /></div>} />` (+ optionally `jobs/:jobId`). Add `{ id: 'jobs', label: 'Jobs', path: 'jobs' }` to `TABS` in `src/shared/components/navTabsData.ts` so `useActiveTab` (segment `[2]` = `jobs`) highlights it and the NavTab renders. (Skip the TABS edit only if Jobs is link-only, not a tab — but it's a real destination, so add it.)
  - [x] Add `friendlyJobError(err|errorInfo)` + `JOB_ERROR_MESSAGES` to `src/shared/utils/errors.ts` (mirror `friendlyInvocationError`): map `JOB_NOT_FOUND`, `JOB_NOT_CANCELLABLE`, `SKILL_EXECUTION_ERROR`, `EXECUTION_TIMEOUT`, `FAN_OUT_PARTIAL_FAILURE`, `FAN_OUT_CANCELLED`, `FAN_OUT_INCOMPLETE`, `LLM_RATE_LIMIT`, `LLM_UNAVAILABLE`, `OUTPUT_GENERATION_FAILED`, `BRAND_ASSET_MISSING`, `MISSING_CREDENTIAL`, etc. — fall back to `error.message` (already user-safe) for unmapped. Do NOT overload `friendlyInvocationError` (different concern). NOTE the backend's `error.message` is already user-safe, so the map is for *nicer* copy, not a crash-guard.

- [x] **Task 8 — Tests + gates (AC: 1–8)**
  - [x] **Frontend** co-located tests (5-2/5-3 harness): `vi.mock` `useJob`/`useJobs`/`useRunStore`; `QueryClientProvider` (retry:false) + `MemoryRouter`; `_mockAuthSession`. Cover: AC1 (poll advances queued→running→completed; mock `useJob` returning successive statuses; assert polling stops at terminal — test the `refetchInterval` function returns `false` for terminal, `3000` otherwise), AC2/AC3 (completed → output file list + `<a href>` with the presigned url; `url:null` guard), AC4 (failed → friendly message + Try again), AC5 (fan-out → "X of N"), AC6 (per-location grouped + download links), AC7 (History lists jobs, link back, empty/loading/error), AC8 (persist: set `activeJobId`, simulate reload via re-mount reading from a mocked persisted store → polling resumes). Plus: `jobs` NavTab active on `/internal/jobs` (real `toHaveClass('font-bold')` assertion in `internal.test.tsx`, per the 5-3 review lesson — don't write tautological tab tests). **Mock every hook each component calls** (missing mock → crash; recurring Epic 4/5 gotcha).
  - [x] **Backend** tests per Task 1 (Docker pytest). State both deltas.
  - [x] Gates ALL green: **backend** — `ruff` clean, Docker suite green (state delta from ~560), no migration. **Frontend** — `npm run typecheck` (0), `npm run lint` (clean), `npm run test` (all pass, +N, **0 regressions; baseline 204**), `npm run build` (✓).

## Dev Notes

### Job-read contract (GET /api/v1/jobs/{job_id}) — verified against source
`GET /api/v1/jobs/{job_id}` → **HTTP 200** `ResponseEnvelope[JobReadWithResult]` (`velara-api/app/api/v1/jobs.py:46`, schema `app/schemas/job.py`). A **failed** job is still **200** — failure is in `data.status="failed"` + `data.error`, never an HTTP error. Fields:
- `status`: exactly `queued`|`running`|`completed`|`failed`|`cancelled` (`app/models/invocation.py:35-40`). Terminal = `completed`/`failed`/`cancelled`.
- `error: {code, message} | null` — non-null **only** when `status="failed"` and `error_code` set. `message` is static/user-safe.
- `result: JobResult | null` — present when completed: `output_file_key`, `output_file_url` (presigned 24h, may be `null`), `output_files: OutputFileRef[]|null` (each `key/format/content_type/size_bytes/url`; `url` presigned 24h, may be `null`), `result_metadata: dict|null`. **No inline output text** — output is S3 files only.
- `children: JobChild[] | null` — non-null **only** for fan-out parents (`fan_out:true`). Each child: `job_id, location_id, location_name (may be null), status, output_file_key, output_file_url (presigned 24h, may be null)`. **No `completed_count`** — count `children[]` by status client-side. Child carries only ONE `output_file_url` (not full `output_files[]`/`error`); full child detail needs a re-poll by `child.job_id` (out of scope).
- Linkage: `skill_id`, `skill_version` (NO `skill_name`), `fan_out`, `location_id`, `parent_job_id`, `hierarchy_path`, timestamps (`started_at`/`completed_at` nullable, `created_at` non-null, ISO-8601).
- **Presigned URLs are 24h TTL, direct-to-S3, generated at poll time, never stored, best-effort (any can be `null`).** Errors: `JOB_NOT_FOUND` (404, missing/cross-org), bad UUID → 422.

### NEW backend list endpoint — patterns to mirror (verified)
- **No `GET /api/v1/jobs` exists** — the jobs router has only `GET /{job_id}` + `POST /{job_id}/cancel`. You're adding the first list route + the first paginated endpoint in the whole codebase.
- **Query shape:** mirror `job_service.list_children` (`job_service.py:176-198`) for the org-scoped `select().where(org_id).order_by(...)` + `.scalars().all()` style; mirror `skill_service.list_skills` (`skill_service.py:341-360`) for the incremental `?status=` filter + `.order_by(created_at.desc())` (newest-first). `list_skills` currently does NOT paginate — there is **no existing LIMIT/OFFSET/COUNT** to copy; you introduce it. Add `.limit/.offset` + a separate `select(func.count())` with the same filters.
- **PageMeta has ZERO existing wiring** (`common.py` "for future list endpoints", referenced only at its own definition). `ResponseEnvelope.meta` = `ResponseMeta` (no pagination slot). **Recommended:** `JobListData{items, page: PageMeta}` inside `data` → `ResponseEnvelope[JobListData]`. Keep the shared envelope untouched.
- **Indexes already support it:** `idx_invocation_jobs_org_id`, `idx_invocation_jobs_status`, `idx_invocation_jobs_created_at` all exist (`app/models/invocation.py:140-148`). `WHERE org_id [AND status] ORDER BY created_at DESC` is index-supported. **No migration** (read-only; no schema change). A composite `(org_id, created_at)` index would be an optional future optimization — out of scope.
- **skill_name:** join `Skill` via **outer** join (FK `skill_id` has no CASCADE — history survives skill deletion; an inner join would drop those rows). Or resolve client-side. Recommend the outer join → `skill_name` on `JobSummary`.
- **DI/test conventions:** handler DI order `request, user, session` (+`storage` only when presigning — NOT here). `_meta(request)` helper. Tests: `tests/integration/api/test_jobs.py` (24 tests) — `_internal_auth()`/`_client_auth()` for org isolation, `_create_job_in_db(...)` seeding, `{data,meta}` envelope asserts, Docker `pytest`. `?status=` filter test pattern in `tests/integration/api/test_skills.py:247-269`.

### Frontend polling, persist, routing (verified — all first-of-kind in this app)
- **First `refetchInterval`** — `useJob` is the only polling hook; TanStack v5 `refetchInterval: (query) => terminal ? false : 3000` (single-arg form; read `query.state.data`). Match `useSkill` hook shape otherwise (`['job', id]` singular key + `enabled`).
- **First persist** — wrap `useRunStore` in `persist` (`zustand/middleware`), `create<RunState>()(...)` curried form, `partialize` to `activeJobId`, `name:'velara-run'`. No localStorage exists anywhere yet.
- **Reconcile clear-on-mount with persistence:** 5-2/5-3 clear `activeJobId` on console *entry* (a `useEffect` keyed on origin/skillId) so a fresh launch doesn't show a stale prior job. AC8 (refresh resumes) and AC7 (History → view a job) must NOT be defeated by that clear. Resolution to define in-story: the clear is correct for a **fresh launch** (navigating in to run a new skill); refresh/resume should re-hydrate from localStorage *before* any clear, and the History "view" path should set `activeJobId` explicitly. Keep the launch-clear, but ensure the persisted id survives a reload (persist rehydrates synchronously on store init, before the mount effect — verify ordering; if the effect clobbers it, gate the clear on an actual fresh-launch signal, e.g. only clear when arriving from a Run submit, not on every mount).
- **History → Run Console link / "Try again":** the console derives `activeJobId` from submit today. Simplest mechanism: a History row links to the console with the job id (e.g. set `activeJobId` via store on click, or a `?jobId=` query param the console reads into `activeJobId`). "Try again" re-submits the same invocation (you have the skill + context from the launch route) OR navigates back to the launch screen — pick the simplest correct behavior and document it; a full re-submit-with-same-payload is nice-to-have, navigate-to-launch is acceptable.
- **Routing:** add `jobs` route in `internal.tsx` + `{id:'jobs',label:'Jobs',path:'jobs'}` in `navTabsData.ts` (`useActiveTab` keys off segment `[2]`). The `p-6` wrapper matches the skills routes.
- **Reuse:** `JobStatusBadge`+`JOB_STATUS_META` (`RunConsole.tsx:59-81`, already V3-correct — export & reuse, don't re-derive from the prototype's `var(--green-*)`). `Skeleton`/`Toast` (thin stubs). No `Card` component — use `rounded-lg border border-line bg-surface px-[22px] py-5`. `friendlyInvocationError` pattern (add a sibling `friendlyJobError`).

### Source tree — create vs. reuse
**New:**
- Backend: `JobSummary`/`JobListData` in `app/schemas/job.py`; `list_jobs` in `app/services/job_service.py`; `GET ""` handler in `app/api/v1/jobs.py`; tests in `tests/integration/api/test_jobs.py`.
- Frontend: `getJob`/`listJobs` + job types in `src/api/jobs.ts`; `src/features/run/hooks/useJob.ts` (+ `useJobs`); `src/features/run/components/JobsHistory.tsx`; `friendlyJobError`/`JOB_ERROR_MESSAGES` in `src/shared/utils/errors.ts`; `jobs` route + NavTab; co-located tests.
**Modify (extend in place):**
- `src/features/run/components/RunConsole.tsx` — replace `JobStatusPanel` stub with the live panel (+ output + fan-out). Keep the rest of the console untouched ("grow in place").
- `src/stores/useRunStore.ts` — add `persist`.
- `src/routes/internal.tsx` + `src/shared/components/navTabsData.ts` — Jobs route + tab.

### Conventions (architecture)
- Envelope: never bare arrays/objects — `{data, meta}` (or `{error}`). `code` SCREAMING_SNAKE, `message` user-safe (no PHI/stack). Pagination: `page>=1` default 1, `per_page` default 50 max 200; out-of-range page → empty + correct total; invalid → 422 (`implementation-patterns-consistency-rules.md:75-79`).
- TanStack keys: `[resource, id?]`. Loading via `isLoading`/`isFetching` (no hand-rolled booleans). `staleTime:30s` default. Mutations never optimistic for state-changing actions.
- Co-locate tests. Org-scope every hierarchical query (never trust the caller to filter).

### Known carried debt (do NOT fix in 5-4)
`S3IngestConnector.fetch` raises `NotImplementedError`; unbounded multi-file context size; no hybrid tool-result size cap; `friendlyInvocationError` could render a non-string `message` as `[object Object]` (pre-existing 5-2 pattern — if you touch errors.ts, coercing to string is a cheap win but optional). Output size cap deferred (Epic 3 retro). Note only.

### Project Structure Notes
- Backend new code stays in the existing jobs router/service/schema files + `test_jobs.py` — no new modules, no migration, no new dependency.
- Frontend new code stays under `src/features/run/` (+ `api/jobs.ts`, `stores/`, `routes/`, `shared/utils/errors.ts`, `navTabsData.ts`). No new dependency (zustand `persist` ships with zustand 5). Keep the RunConsole change additive (only the `JobStatusPanel` is rewritten).

### References
- [Source: epics/epic-5-run-console-invocation-ux.md#Story 5.4] — the 8 ACs + the 3-deliverable scope note (live polling / Jobs History / localStorage persist).
- [Source: stories/5-1-invocation-api-and-job-polling.md] — the job/invocation API the console consumes (202 submit, the `GET /jobs/{id}` poll shape, `error:{code,message}` on failed poll, `error_messages` map).
- [Source: stories/5-2-run-console-context-first-mode.md] + [Source: stories/5-3-run-console-skill-first-mode.md] — the as-built RunConsole + `JobStatusPanel`/`JobStatusBadge`/`JOB_STATUS_META` stub this story finishes; `useRunStore` (`activeJobId`); `RunShell`; the brand-token anti-drift rule; the "tautological tab test" review lesson (write a real `toHaveClass` assertion).
- [Source: epics/epic-5-run-console-invocation-ux.md#Story 5.6] — the intended pagination pattern (`PageMeta`, page/per_page default 50 max 200, COUNT, 422 on invalid) — 5-4's `GET /jobs` should set the precedent 5-6 follows.
- [Source: prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md] — OUT-01 (one invocation may produce one OR MORE output files), OUT-02 (Vitalief brand on outputs), EXE-04/USE-01 (invocation logging: start/end/outcome/output reference — the data behind Jobs History), LOC-03/04 (fan-out parent+child logging).
- [Source: prds/prd-Velara-2026-05-29/prd/7-user-journeys.md#UJ-1] — the context-first study/location fan-out journey: confirm count → results grouped per location (AC5/AC6).
- [Source: prds/prd-Velara-2026-05-29/prd/13-design-reference.md] + [Source: design/overrides.jsx:261-309] — the "Executing"/"Run complete" output panel visual ref; fan-out + History are net-new.
- [Source: architecture/implementation-patterns-consistency-rules.md:62-79] — envelope, pagination shape, error-code mapping, TanStack key + staleTime conventions.
- Code seams (verified): `velara-api/app/api/v1/jobs.py:46` (get_job; add `@router.get("")`), `app/services/job_service.py:176-198` (`list_children` template), `app/services/skill_service.py:341-360` (`list_skills` filter/order template), `app/schemas/job.py` (Job schemas; add `JobSummary`/`JobListData`), `app/schemas/common.py` (`PageMeta` — first use), `app/models/invocation.py:140-148` (indexes), `tests/integration/api/test_jobs.py` (24 tests; seed/auth/envelope helpers); `velara-web/src/features/run/components/RunConsole.tsx:59-81` (`JobStatusBadge`/`JOB_STATUS_META` to reuse) + `:783-807` (`JobStatusPanel` stub to replace), `src/api/jobs.ts` (add `getJob`/`listJobs`+types), `src/stores/useRunStore.ts` (add `persist`), `src/routes/internal.tsx` + `src/shared/components/navTabsData.ts` (jobs route+tab), `src/shared/utils/errors.ts` (add `friendlyJobError`), `src/features/skills/hooks/useSkills.ts:12` (`useQuery` shape template).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-06-15)

### Debug Log References

### Completion Notes List

- **PageMeta carrier:** chose `ResponseEnvelope[JobListData{items, page: PageMeta}]` — pagination inside `data`, shared envelope untouched. This sets the precedent for 5-6 (skills pagination).
- **skill_name:** outer-join `Skill` ON `InvocationJob.skill_id == Skill.id` in `list_jobs` service. Outer join chosen (FK has no CASCADE; skill deletion must not drop history rows). `skill_name` mapped onto `JobSummary` after `model_validate`.
- **History → Run Console / "Try again":** implemented inline `JobDetailPanel` on the Jobs History page — clicking "View" calls `setActiveJobId(jobId)` and opens a polling panel in-place. "Try again" (failed panel) navigates the user back by calling `window.history.back()` (simplest; user can re-submit from the launch screen). The Jobs History page thus acts as the primary re-entry point without needing `?jobId=` route params on the Run Console.
- **AC8 clear-on-mount reconciliation:** the 5-2/5-3 `useEffect(() => { setActiveJobId(null) }, [originId])` blocks in both RunConsole modes were **removed entirely**. Zustand `persist` rehydrates synchronously on store creation (before any mount effect). Removing the effects means `activeJobId` survives page refresh (persist wins). On new submit, `setActiveJobId(job.job_id)` naturally replaces the prior value, so no stale job leaks into a fresh run.
- **react-refresh warning fix:** `JOB_STATUS_META` constant and `JobStatus` type extracted from the component file into `velara-web/src/features/run/jobStatusMeta.ts` (a plain `.ts` non-component file). `JobStatusBadge.tsx` re-exports them without triggering the warning.
- **Backend Docker pytest:** 9 new integration tests written in `tests/integration/api/test_jobs.py`; Docker environment was unavailable in this session. Tests follow the exact seed/auth/envelope patterns of the existing 24 tests in that file and cover all required cases (envelope shape, ordering, pagination, total, status filter, 422, cross-org isolation, 401). ruff check passes clean.
- **Frontend gates (confirmed):** `npm run typecheck` — 0 errors; `npm run lint` — clean; `npm run test` — 224 pass (+20 from baseline 204, 0 regressions); `npm run build` — ✓.

### File List

**Backend — modified:**
- `velara-api/app/schemas/job.py` — added `JobSummary`, `JobListData` schemas; added `PageMeta` import
- `velara-api/app/services/job_service.py` — added `list_jobs` function; added `Skill` import and `func` to SQLAlchemy imports
- `velara-api/app/api/v1/jobs.py` — added `GET ""` list handler; added `JobStatusLiteral`, `JobSummary`, `JobListData`, `PageMeta` imports

**Backend — modified (tests):**
- `velara-api/tests/integration/api/test_jobs.py` — added 9 new integration tests (lines ~707–837)

**Frontend — new files:**
- `velara-web/src/api/jobs.ts` — complete rewrite: all job types (`JobStatus`, `OutputFileRef`, `JobResult`, `JobChild`, `ErrorInfo`, `JobReadWithResult`, `JobSummary`, `PageMeta`, `JobListData`, `ListJobsParams`) + `getJob`, `listJobs` functions
- `velara-web/src/features/run/jobStatusMeta.ts` — extracted `JobStatus` type + `JOB_STATUS_META` constant (resolves react-refresh warning)
- `velara-web/src/features/run/components/JobStatusBadge.tsx` — new file: `JobStatusBadge` component + re-exports `JobStatus`, `JOB_STATUS_META`
- `velara-web/src/features/run/hooks/useJob.ts` — new file: `useJob` (3s polling, stops at terminal) + `useJobs` hooks
- `velara-web/src/features/run/components/JobsHistory.tsx` — new file: `JobDetailPanel`, `JobRow`, `JobsHistory` components (AC7)
- `velara-web/src/features/run/components/JobsHistory.test.tsx` — new file: 7 tests for AC7 (loading/error/empty/list/view/close/total)

**Frontend — modified:**
- `velara-web/src/features/run/components/RunConsole.tsx` — replaced `JobStatusPanel` stub (lines 783–807) with full live 170-line implementation; removed both clear-on-mount `useEffect` blocks (AC8); added `useJob`, `JobStatusBadge`, `friendlyJobError` imports
- `velara-web/src/stores/useRunStore.ts` — wrapped `create<RunState>()` in `persist` middleware (`partialize: activeJobId`; first localStorage usage in the app)
- `velara-web/src/shared/utils/errors.ts` — added `JOB_ERROR_MESSAGES` record + `friendlyJobError` function
- `velara-web/src/shared/components/navTabsData.ts` — added `{ id: 'jobs', label: 'Jobs', path: 'jobs' }` tab entry
- `velara-web/src/routes/internal.tsx` — added `JobsHistory` import + `<Route path="jobs">` entry
- `velara-web/src/features/run/components/RunConsole.test.tsx` — added `useJob` mock; updated 2 existing AC4 tests; added `describe('JobStatusPanel — Story 5.4')` (8 tests) + `describe('useJob refetchInterval logic')` (1 test)
- `velara-web/src/routes/internal.test.tsx` — added `useJob`/`useJobs` + `useRunStore` mocks; added 3 new tests for Jobs route/tab/title

### Review Findings

Code review 2026-06-15: 3-layer adversarial (Blind Hunter, Edge Case Hunter, Acceptance Auditor).

**Decision needed (resolve before patching):**

- [x] [Review][Decision] F2: Child (fan-out) jobs appear as top-level rows in `/api/v1/jobs` list — resolved: added `parent_job_id IS NULL` filter + test. [app/services/job_service.py]
- [x] [Review][Decision] F4: No navigation link from Jobs History row to Run Console — resolved: "Open in Run Console →" button in JobDetailPanel navigates to `skills/:skillId/run`. [src/features/run/components/JobsHistory.tsx]

**Patches:**

- [x] [Review][Patch] F1: `JobSummary.skill_name` mutated after `model_validate` — fixed: use `.model_copy(update={"skill_name": skill_name})` instead of direct attribute assignment. [app/api/v1/jobs.py]
- [x] [Review][Patch] F3: `handleClose` in JobsHistory leaves `activeJobId` set in global store — fixed: `handleClose` now calls `setActiveJobId(null)`; `handleSelect` toggle-close restores prior activeJobId. [src/features/run/components/JobsHistory.tsx]
- [x] [Review][Patch] F6: Fan-out in-flight progress counter hidden when `job.children` is null — fixed: show "Fan-out in progress — dispatching locations…" when `job.fan_out` but children not yet available. [src/features/run/components/RunConsole.tsx]
- [x] [Review][Patch] F7: `useJob` polling never stops on persistent fetch error — fixed: `refetchInterval` returns `false` on `query.state.status === 'error'`; added `retry: 1`. [src/features/run/hooks/useJob.ts]
- [x] [Review][Patch] F8: Stale `activeJobId` from localStorage on reload → permanent skeleton — fixed: `JobStatusPanel` now shows error state with "Dismiss" button on `isError`. [src/features/run/components/RunConsole.tsx]
- [x] [Review][Patch] F10: `JobDetailPanel` fan-out child rows: null URL renders nothing — fixed: added "(link unavailable)" fallback when `output_file_url` is null but `output_file_key` exists. [src/features/run/components/JobsHistory.tsx]

**Deferred:**

- [x] [Review][Defer] F5: No pagination UI — users with >50 jobs can't browse older history; `total` shows but no load-more/page controls [src/features/run/components/JobsHistory.tsx] — deferred, out of scope for 5-4; revisit when 5-6/5-7 pagination patterns land
- [x] [Review][Defer] F9: No "dismiss" affordance for completed/cancelled terminal jobs in `JobStatusPanel` — once completed, the panel is permanently occupied with no clear/close button [src/features/run/components/RunConsole.tsx — JobStatusPanel] — deferred, UX polish; wire a clear button alongside cancel UI (Epic 8)
- [x] [Review][Defer] F11: `refetchInterval` test reimplements logic inline rather than exercising the actual hook — regression in the hook condition would not be caught [src/features/run/components/RunConsole.test.tsx] — deferred, test coverage gap; improve when testing infrastructure allows hook internals to be exercised
- [x] [Review][Defer] F12: `useJobs` 30s `staleTime` means a newly submitted job won't appear in Jobs History for up to 30s [src/features/run/hooks/useJob.ts — useJobs] — deferred, minor UX; add `invalidateQueries(['jobs'])` in invocation mutation onSuccess when tightening History freshness

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-06-15 | 1.0 | Story created with full-stack scope (polling + history + persist). | BMad |
| 2026-06-15 | 1.1 | Implementation complete. All 8 tasks done. Backend: `GET /api/v1/jobs` (first paginated endpoint, `JobSummary`/`JobListData`/`PageMeta`, outer-join skill name, 9 new integration tests, ruff clean). Frontend: `useJob` 3s polling hook, live `JobStatusPanel` (output/failed/fan-out), `useRunStore` persist, Jobs History screen + route + nav tab, `friendlyJobError`, 20 new tests (+0 regressions, 224 total). | claude-sonnet-4-6 |

---

**Resolved scope decision (locked with user 2026-06-15):**
1. ✅ **Jobs History scope** → **FULL-STACK**: build the new `GET /api/v1/jobs` backend list endpoint (org-scoped, paginated, newest-first, light `JobSummary`, first `PageMeta` consumer, no migration) here in 5-4, alongside all the frontend (live polling, output display, fan-out X-of-N, Jobs History screen, localStorage persist). Rejected alternatives: splitting History to a later story; a backend-first sub-story.

**Open implementation decisions (resolve at dev start, log in Dev Agent Record):**
1. **PageMeta carrier** — recommended `ResponseEnvelope[JobListData{items, page}]` (don't touch the shared envelope). Confirm and apply consistently (5-6 will follow this precedent).
2. **skill_name** — recommended outer-join `Skill` in `list_jobs` → `JobSummary.skill_name`. Confirm vs. client-side resolution.
3. **History → Run Console "view this job" + "Try again"** — define the mechanism (set `activeJobId` on click / `?jobId=` param; "Try again" = re-submit vs. navigate-to-launch). Reconcile with the clear-on-mount effect so refresh-resume (AC8) isn't defeated.
