---
baseline_commit: 63efcd18f5acd3409e0b4a68f41b4826fb8e1e5d
---

# Story 5.1: Invocation API & Job Polling

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer,
I want the invocation endpoint that creates a job and the polling endpoint that returns its status, plus a Claude-proxy `/invoke` surface,
so that all invocation surfaces (web, CLI, Claude) have a consistent async API to drive skill execution.

> **READ THIS FIRST — most of this story already exists.** Epic 3 (Stories 3-1, 3-3, 3-7) already built `POST /api/v1/invocations/{skill_id}` (202), `GET /api/v1/jobs/{job_id}` (polling, 24h presigned URLs, fan-out children), the atomic commit-then-dispatch pattern, the IP-protected request schema, and the `{data,meta}` / `{error:{code,message}}` envelopes. **This story is an EXTENSION/EXPOSURE story, not a greenfield build.** Your genuinely new work is small and precisely scoped — see *Scope: What's New vs. What Already Exists* below. **Do not re-implement what exists. Do not re-derive the execution-engine invariants** — they are documented in [execution-engine-patterns.md](../../planning-artifacts/architecture/execution-engine-patterns.md) and were re-derived 3–4 times across Epic 3 (the #1 retro lesson). Read that doc before touching anything.

## Acceptance Criteria

**AC1 — Create invocation (already built; verify + regression-guard)**
**Given** I call `POST /api/v1/invocations/{skill_id}` with a valid context payload
**When** the request is processed
**Then** an `InvocationJob` is created with status `queued`, the Celery task is enqueued, and the response is **HTTP 202** with `{"data": {"job_id": "...", "status": "queued"}, "meta": {...}}`

**AC2 — Running poll (already built; verify + regression-guard)**
**Given** I call `GET /api/v1/jobs/{job_id}` while the job is running
**When** the response is returned
**Then** status is `running` with a `started_at` timestamp

**AC3 — Completed poll with 24h presigned URLs (already built; verify + regression-guard)**
**Given** I call `GET /api/v1/jobs/{job_id}` after completion
**When** the response is returned
**Then** status is `completed`, `completed_at` is set, and `result` contains output file presigned URLs (valid 24 hours)

**AC4 — Claude proxy `/invoke` (NET-NEW)**
**Given** I call `POST /api/v1/invoke/{skill_id}` (Claude proxy endpoint) with a minimal payload
**When** the platform executes the skill
**Then** the response contains only the output reference — no skill instructions, code, or internals are returned
> **Resolved design decision (locked with user 2026-06-12):** The proxy is an **async thin alias** of `/invocations` — it creates a job and returns **HTTP 202** `{"data": {"job_id","status":"queued"}, "meta": {...}}`; the caller then polls `GET /api/v1/jobs/{job_id}`. It does **not** execute synchronously and does **not** return inline output bytes. "Returns only the output" is satisfied because the *only* path to output is the IP-protected `GET /jobs` response (`output_file_key` + presigned URL + names/counts metadata), which structurally cannot carry skill internals. See *Dev Notes → Claude proxy*.

**AC5 — Failed poll with user-safe `error: {code, message}` (NET-NEW: add `message`)**
**Given** a job fails
**When** I call `GET /api/v1/jobs/{job_id}`
**Then** status is `failed` and `error` contains a user-safe `code` and `message` — no raw exception detail
> **What exists vs. new:** The job already persists a stable `error_code: str` and `GET /jobs` already returns it on `JobRead`. **NET-NEW:** add a user-safe `error_code → message` map and expose a structured `error: {code, message} | None` object on the poll response (populated when `status == "failed"`). The `error` object is built at response time from the persisted `error_code` — no schema migration, no new persisted column.

## Scope: What's New vs. What Already Exists

> **VERIFY-BEFORE-BUILD.** Before writing any code, confirm the current state in the repo (these were true as of 2026-06-12 story authoring):
> - `velara-api/app/api/v1/invocations.py` — `POST /api/v1/invocations/{skill_id}` exists, returns 202, atomic dispatch with `DISPATCH_FAILED` safety net. (AC1)
> - `velara-api/app/api/v1/jobs.py` — `GET /api/v1/jobs/{job_id}` exists: 24h presign (`expires_s=86400`), fan-out `children`, best-effort presign. (AC2, AC3)
> - `velara-api/app/schemas/job.py` — `JobRead` already carries `error_code: str | None`; `JobReadWithResult` has `result` + `children`. (AC5 partial)
> - `velara-api/app/api/v1/router.py` — sub-routers mounted; no `invoke` router yet. (AC4)
> - Latest Alembic migration: `0012_location_fan_out`. **This story adds NO migration** — confirm with `alembic heads` before assuming.

| AC | Status | Work for 5-1 |
|----|--------|--------------|
| AC1 (POST /invocations → 202) | ✅ EXISTS (3-3/3-7) | Verify; add/keep a regression test asserting the exact 202 envelope shape. No code change expected. |
| AC2 (running poll + started_at) | ✅ EXISTS (3-1) | Verify; regression test. No code change expected. |
| AC3 (completed poll + 24h presign) | ✅ EXISTS (3-1/3-6) | Verify; regression test. No code change expected. |
| AC4 (`POST /api/v1/invoke/{skill_id}` proxy) | 🆕 NET-NEW | New router `app/api/v1/invoke.py` (async thin alias → 202 + job_id), register in `router.py`, IP-scrubbed by construction. |
| AC5 (`error: {code,message}` on failed poll) | 🟡 PARTIAL | Add `error_code → message` map + `error: ErrorInfo | None` on `JobReadWithResult`, built at response time in `get_job`. |

**Out of scope (explicitly deferred — do NOT pull forward):**
- Client-token RBAC / client-facing-skill enforcement on `/invoke` (ACL-03/ACL-05) → **Epic 8** (locked with user). 5-1 provides output-only IP protection structurally; it does NOT restrict `/invoke` to `client_facing` skills or add a client-scoped token surface.
- Skill `scope` enforcement against requested study/location → **Epic 8** (already deferred in 3-7).
- Run Console UI, context-first/skill-first UX, job-status UI polling → **Stories 5-2/5-3/5-4** (frontend).
- OpenAPI spec / Swagger doc work → **Story 5-5**.
- Fan-out cancel (parent has no `celery_task_id`) → noted in 3-7 deferrals; not in 5-1.
- Running-job reaper / stuck-`running` timeout → deferred (see *Dev Notes → Known gaps*). 5-1 does not add a reaper.

## Tasks / Subtasks

- [x] **Task 1 — Verify AC1/AC2/AC3 already pass; lock them with regression tests (AC: 1, 2, 3)**
  - [x] Read `app/api/v1/invocations.py`, `app/api/v1/jobs.py`, `app/schemas/job.py`, `app/schemas/invocation.py` and confirm the endpoints behave as the ACs require (202 envelope shape; `running`+`started_at`; `completed`+`completed_at`+presigned `result`).
  - [x] In `tests/integration/api/test_jobs.py` / `test_invocations.py`, add (or confirm) explicit regression tests asserting the **exact** envelope shape: `data.job_id`, `data.status == "queued"`, `meta.request_id`, `meta.timestamp`; and a completed-job test asserting `result.output_file_url` is a presigned URL (mock the storage presign to a sentinel and assert it's surfaced, `expires_s=86400`).
  - [x] Do NOT modify the endpoints unless a verification gap is found; if one is found, document it in the Dev Agent Record before changing code.

- [x] **Task 2 — Add user-safe `error: {code, message}` to the failed-job poll response (AC: 5)**
  - [x] In `app/schemas/job.py`: add `class ErrorInfo(BaseModel): code: str; message: str`. Add `error: ErrorInfo | None = None` to `JobReadWithResult` (NOT `JobRead` — keep the bare `error_code` on `JobRead` for back-compat; the structured object is a poll-response enrichment).
  - [x] Create a single source-of-truth `error_code → user-safe message` map. Put it in a new module `app/services/error_messages.py` (or `app/core/error_messages.py`) as `ERROR_MESSAGES: dict[str, str]` plus a helper `def error_message_for(code: str) -> str` that returns the mapped message, falling back to a generic safe message (e.g. `"The skill execution failed. Please try again or contact support."`) for any unmapped/unknown code — **never** echo the raw code as the message and **never** surface exception text.
  - [x] Populate the map with every persisted worker/dispatch `error_code` the job can carry. Enumerate them from `app/workers/execution_tasks.py` (the `ERROR_CODE_*` constants / `_map_error_code`) and the dispatch path. At minimum: `SKILL_EXECUTION_ERROR`, `PROMPT_EXECUTION_ERROR`, `EXECUTION_TIMEOUT`, `LLM_RATE_LIMIT`, `LLM_UNAVAILABLE`, `INVALID_HYBRID_ARTIFACT`, `HYBRID_LOOP_EXHAUSTED`, `HYBRID_TOOL_SERVER_ERROR`, `HYBRID_EMPTY_OUTPUT`, `UNSUPPORTED_OUTPUT_FORMAT`, `OUTPUT_GENERATION_FAILED`, `BRAND_ASSET_MISSING`, `MISSING_CREDENTIAL`, `DISPATCH_FAILED`, `FAN_OUT_PARTIAL_FAILURE`, `FAN_OUT_CANCELLED`, `FAN_OUT_INCOMPLETE`. (Grep the codebase for the authoritative, current list — do not trust this enumeration blindly.)
  - [x] In `app/api/v1/jobs.py` `get_job`: when `job.error_code` is set (any non-terminal-success state that carries a code, primarily `status == "failed"`), build `error = ErrorInfo(code=job.error_code, message=error_message_for(job.error_code))` and pass it into `JobReadWithResult`. Leave `error = None` when there is no `error_code`.
  - [x] PHI/IP discipline: messages are static, generic, user-safe strings — they must contain NO PHI, NO skill internals, NO raw exception text. (This is why we map by code, not by exception.)
  - [x] Tests: a failed-job poll returns `error.code` + a human-readable `error.message`; an unmapped/synthetic code falls back to the generic message (not the raw code); a completed/running job has `error == None`.

- [x] **Task 3 — Add the Claude proxy `POST /api/v1/invoke/{skill_id}` (async thin alias) (AC: 4)**
  - [x] Create `app/api/v1/invoke.py` with `router = APIRouter(prefix="/api/v1/invoke", tags=["invoke"])` and a local `_meta(request)` helper (copy from `jobs.py`/`invocations.py`).
  - [x] Add a minimal request schema in `app/schemas/invocation.py` (e.g. `class InvokeRequest(BaseModel)`), or reuse `InvocationRequest` if the field set matches. Per INV-01 the Claude-facing payload is **context + inputs only** — `file_ref_ids`, `inputs`, and (for location-dependent skills) `location_id` / `study_id` / `fan_out`. It must carry NO prompt/instruction/internals fields (IP protection by absence — mirror the `InvocationRequest` docstring rationale).
  - [x] Endpoint behavior: **reuse the exact logic of `invoke_skill` in `invocations.py`** — do not duplicate-and-drift. Strongly prefer refactoring the shared body into a service function (e.g. `execution_service.queue_invocation(...)` or a helper in `invocations.py`) that both `/invocations/{skill_id}` and `/invoke/{skill_id}` call, so the atomic-dispatch + location-resolution + file-ref-validation logic lives in ONE place. The proxy returns **HTTP 202** `ResponseEnvelope[InvocationAccepted]` (`job_id` + `status="queued"`), identical to `/invocations`.
  - [x] If you cannot cleanly extract the shared helper this story, the proxy may delegate by calling the same `skill_service` / `ingest_service` / `execution_service` / `job_service` functions in the same order — but it MUST preserve every invariant: skill load (cross-org→404), `assert_invocable`, current-version resolution (422 `SKILL_NO_CURRENT_VERSION`), file-ref pre-validation, location resolution, commit-then-dispatch with `DISPATCH_FAILED` fresh-session fallback. Re-read *Dev Notes → Atomic dispatch invariant*.
  - [x] Register the new router in `app/api/v1/router.py` (`api_router.include_router(invoke.router)`).
  - [x] IP protection: the proxy NEVER returns skill internals. The 202 body has only `job_id`/`status`; the only output path is `GET /jobs/{id}` which is already IP-protected. Add an integration test asserting the 202 body (and a subsequent `GET /jobs/{id}` body) contain no artifact/instruction/system-prompt fields.
  - [x] Add a code comment + the *Out of scope* note that client-token RBAC / client-facing-flag enforcement is deferred to Epic 8 — this proxy is the future client surface but is NOT yet access-restricted beyond the existing dev-auth + org-scoping.

- [x] **Task 4 — Tests, gates, and patterns-doc check (AC: 1–5)**
  - [x] Integration tests in `tests/integration/api/`: AC1 (202 shape via `/invocations` AND `/invoke`), AC2 (running+started_at), AC3 (completed+24h presign surfaced), AC4 (`/invoke` 202 + IP-scrub assertion), AC5 (failed → `error.code`+`error.message`; unmapped-code fallback). Reuse the `_auth_headers` / dev-JWT helper and the integration skip-guard pattern from `test_jobs.py`; use `client.user` / a foreign org for cross-org-404 assertions.
  - [x] Service/unit test for `error_message_for` (mapped code → mapped message; unknown code → generic fallback; never returns the raw code).
  - [x] Do NOT call Celery task bodies in tests (the `asyncio.run`-in-task constraint — patterns doc §1). For dispatch, patch `run_skill.delay` (keep the import module-level so it's patchable) or rely on the `celery_eager` fixture; assert job state via the service/endpoint, not by running `run_skill`.
  - [x] If you touched `execution_tasks.py`/`execution_service.py`/`job_service.py` (e.g. extracting the shared queue helper), update [execution-engine-patterns.md](../../planning-artifacts/architecture/execution-engine-patterns.md) source map / §3 dispatch section accordingly. If you only added the proxy router + error map, no patterns-doc change is needed.
  - [x] Gates before marking review: `ruff check .` clean; **rebuild containers** (`docker compose build api worker && docker compose up -d`) then full Docker suite green (no regressions; the 537 baseline from 3-7 plus Epic 4's web suite — backend count is what matters here); if any migration was added (none expected), `upgrade head → downgrade -1 → upgrade head` round-trips clean.

### Review Findings

> Code review 2026-06-13 — 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor), fresh review of sonnet-4-6's implementation. **No Critical/High findings.** AC4 (async-202 proxy) and AC5 (error map) correctly implemented; all dispatch invariants preserved; error map complete (17/17 persisted InvocationJob codes incl. all FAN_OUT_*/DISPATCH_FAILED); scope boundaries honored; no migration added (head stays 0012). Findings are 1 Medium (defensive hardening) + Lows.

**Decision-needed (resolved 2026-06-13 → all patch APPLIED & verified)**

- [x] [Review][Patch] (was Decision) `/invoke` dispatch body duplicated verbatim from `invocations.py`. **APPLIED:** extracted `queue_invocation()` in `invocations.py` (single source of skill-load/version/file-ref/location-resolution/atomic-dispatch); both `invoke_skill` and `invoke_proxy` are now thin 202-envelope wrappers over it (`log_prefix` distinguishes log events only). Repointed 4 test mock targets `app.api.v1.invoke.run_skill` → `app.api.v1.invocations.run_skill`. [`app/api/v1/invocations.py`, `app/api/v1/invoke.py`]
- [x] [Review][Patch] (was Decision) `InvokeRequest` re-declares fields. **APPLIED:** `InvokeRequest(InvocationRequest)` now subclasses — fields/validators/config inherited; it exists only to name the proxy's OpenAPI schema. [`app/schemas/invocation.py`]
- [x] [Review][Patch] (was Decision) `InvokeRequest` lacks `extra="forbid"`. **APPLIED:** `model_config = ConfigDict(extra="forbid")` on the parent `InvocationRequest` (inherited by `InvokeRequest`) → unknown/IP-bearing/typo'd fields now 422 on BOTH surfaces. New test `test_invoke_proxy_rejects_unknown_fields`. No existing payload carried extra fields (suite still green). [`app/schemas/invocation.py`]

**Patch (all APPLIED & verified — 560 Docker tests pass, 0 regressions)**

- [x] [Review][Patch] `error` block keyed on `error_code` truthiness, not `status == "failed"`. **APPLIED:** now gated `if job.status == JOB_STATUS_FAILED and job.error_code:` — a stale/empty code on a non-failed job can never surface an `error` block; matches the AC5 contract literally. [`app/api/v1/jobs.py`]
- [x] [Review][Patch] AC3 regression didn't lock `expires_s=86400`. **APPLIED:** the AC3 test now asserts every `presign_download` call used `expires_s=86400`. [`tests/integration/api/test_jobs.py`]
- [x] [Review][Patch] AC1 regression asserted the poll shape, not create-202. **APPLIED:** new `test_ac1_create_invocation_202_exact_envelope_shape` asserts the `/invocations` create envelope (`data == {job_id, status}`, `meta.request_id/timestamp`). [`tests/integration/api/test_jobs.py`]

## Dev Notes

### Source tree — exact files you'll touch
All under `/Users/apple/Projects/AI/velara/velara-api/`:
- `app/api/v1/invoke.py` — **NEW** router (AC4). [Source: project-structure-boundaries.md#velara-api]
- `app/api/v1/invocations.py` — read/reuse; possibly extract a shared `queue_invocation` helper. **Already implements AC1 + atomic dispatch.** [`invocations.py:135-311`]
- `app/api/v1/jobs.py` — edit `get_job` to add the `error` object (AC5). **Already implements AC2/AC3 + 24h presign + fan-out children.** [`jobs.py:43-189`]
- `app/api/v1/router.py` — register `invoke.router`. [`router.py:5-14`]
- `app/schemas/job.py` — add `ErrorInfo` + `error` on `JobReadWithResult` (AC5). [`job.py:43-94`]
- `app/schemas/invocation.py` — add `InvokeRequest` (or reuse `InvocationRequest`). [`invocation.py:15-47`]
- `app/services/error_messages.py` — **NEW** `ERROR_MESSAGES` map + `error_message_for`. (AC5)
- `app/services/execution_service.py` — possible shared-helper extraction; reuse `execute_skill`, `dispatch_fan_out`, `build_location_block`. [`execution_service.py:297,931,949`]
- `app/services/job_service.py` — reuse `create_job`, `get_job`, `get_job_unscoped`, `mark_failed`, `list_children`. **Do not add raw status UPDATEs** — go through the existing `mark_*` helpers (terminal-guarded).
- `tests/integration/api/test_jobs.py`, `tests/integration/api/test_invocations.py`, plus a new `tests/integration/api/test_invoke.py`; unit test for the error map.

### The async-proxy decision (AC4) — why a thin alias, not synchronous
Locked with the user (2026-06-12). The architecture wording "Claude calls the platform endpoint, the platform resolves and executes the skill server-side, and returns only the output" reads synchronous, but the entire engine is async (Celery + `asyncio.run`-in-task; tests cannot even call task bodies). A synchronous proxy would block the request for the skill's full runtime (up to the 1200s sandbox limit) and violate the ≤2s P95 platform-overhead NFR. So the proxy is an **async thin alias**: 202 + `job_id`, poll `GET /jobs`. "Returns only the output" is honored because the *only* output path (`GET /jobs`) is IP-protected by construction — `InvocationResult` has only `output_file_key` + `result_metadata` (names/counts/tokens), no field that can carry skill internals. [Source: core-architectural-decisions.md#API & Communication "Claude proxy"; 6-non-functional-requirements.md §6.1 (≤2s P95 overhead); execution-engine-patterns.md#1, #6]

### Atomic dispatch invariant — MANDATORY, do not break (AC1, AC4)
`create_job` commits the `queued` row **before** the broker `.delay()` call. A broker failure cannot be rolled back (row already committed), so it is caught and the job is `mark_failed(error_code="DISPATCH_FAILED")` in a **fresh session** (`session_scope()` + `get_job_unscoped`) — never stranded `queued`-with-no-task. The broker publish is wrapped in `run_in_threadpool` (blocking call). The `/invoke` proxy MUST preserve this exactly — ideally by sharing the same code. [Source: execution-engine-patterns.md#3; `invocations.py:278-299`] This bug class was independently re-introduced in 3-2 and 3-3 (retro #1 lesson) — reuse, don't re-derive.

### IP protection — structural, not field-stripping (AC4, AC5)
- Request side: `InvocationRequest`/`InvokeRequest` accept **context + inputs only** — no prompt/instruction/internals field exists to submit. [Source: `invocation.py:1-6,15-40`; 3-3 AC3]
- Output side: `InvocationResult` has only `output_file_key` + `result_metadata`. Skill artifact bytes (system prompt, tool defs, code) are fetched → used to build the Claude request → **discarded**; never stored, logged, or returned. [Source: execution-engine-patterns.md#6; execution_service.py:13-19]
- Error side: error envelopes and the new `error.message` carry only stable codes + static user-safe strings — **never** raw exception text, Claude error text, or artifact bytes. The global handler already guarantees unhandled exceptions become `INTERNAL_ERROR` with no traceback. [Source: `exceptions.py:1-7`; implementation-patterns-consistency-rules.md#Enforcement Rules]
- PHI discipline: never log `system`/`messages`/response text or the location block at INFO — IDs over content. [Source: execution-engine-patterns.md#8; 3-3 Dev Notes]

### Error envelope & response shapes (AC1, AC5)
- Success: `ResponseEnvelope{data: T, meta: ResponseMeta{request_id, timestamp}}`. [`common.py:15-23`]
- API error (request-time): `ErrorEnvelope{error: ErrorDetail{code, message, request_id}}` via the global handler — raise a `VelaraHTTPException` subclass with a SCREAMING_SNAKE `ERROR_CODE`. [`exceptions.py:27-40`; `common.py:25-33`]
- **Job-result error (AC5) is different from the API error envelope:** it's a field *inside* `data` on a 200 `GET /jobs` response — `JobReadWithResult.error: ErrorInfo{code, message} | None`. A failed job still returns **HTTP 200** (the poll succeeded); the failure is expressed in `data.status == "failed"` + `data.error`. Do not turn a failed-job poll into a non-200 response.

### Fan-out result shape — already exposed; do not regress (downstream: Story 5-4)
`GET /jobs/{parent}` already returns `children: list[JobChild] | None`, populated only when `fan_out=True` (else `None`). Each `JobChild` carries `job_id`, `location_id`, `location_name`, `status`, `output_file_key`, `output_file_url` (24h presign, best-effort). Story 5-4's "X of N locations complete" derives N from `len(children)` and completed-count from `children[].status == "completed"`. A **failed** parent has no `InvocationResult` but still serves `children` (queried by `parent_job_id`, independent of the parent result row). Rollup codes: `FAN_OUT_PARTIAL_FAILURE` / `FAN_OUT_CANCELLED` / `FAN_OUT_INCOMPLETE` — these MUST be in the AC5 error-message map. [Source: execution-engine-patterns.md#8; 3-7 AC5; `jobs.py:137-182`; `job.py:70-94`]

### Known gaps / deferrals to note (not 5-1 work)
- **Running-job reaper:** no sweep for jobs stuck `running` if a worker dies between `mark_running` and the terminal transition (code/hybrid have the 1200/1260/1320s timeout sandwich; the crash-between-transitions case is still unbounded). 5-1 does NOT add a reaper — leave to ops-hardening. [Source: deferred-work.md; 3-1 deferral]
- **`S3IngestConnector.fetch` raises `NotImplementedError`** — "full async wrapping deferred to Epic 5." Only relevant if 5-1 wires connector invocation (it does not — connectors are invoked inside execution, not at the API surface). Flag only. [Source: deferred-work.md; epic-3-retro]
- **Unbounded concatenated LLM context** — no token/byte cap before the Claude call. Not introduced or fixed by 5-1. [Source: deferred-work.md]
- **Fan-out cancel** — parent has no `celery_task_id`, so cancel can't revoke a chord. Not in 5-1. [Source: 3-7 deferral]

### Testing standards (AC: all)
- Framework: **pytest** + pytest-asyncio. Tests co-located/structured under `tests/unit/...` and `tests/integration/api/...`. [Source: project-structure-boundaries.md#velara-api]
- Integration tests use the **skip-guard** (auto-skip if Postgres/MinIO/Redis unreachable) + `_auth_headers` dev-JWT helper (`DevAuthProvider().issue_token(principal)`; seed users `ma.tech` / `consultant` / `client.user`). Use `client.user` + a foreign org for cross-org-404 and IP-scrub assertions. [Source: 3-1/3-3 test notes; `tests/integration/api/test_jobs.py`]
- **Never call Celery task bodies** — `asyncio.run` can't nest in pytest-asyncio's loop. Patch `run_skill.delay` (module-level import) or use the `celery_eager` fixture; assert via service/endpoint. Reuse the autouse `dispose_engine_after_test` fixture in any new worker-touching test file. [Source: execution-engine-patterns.md#1; epic-3-retro #1 lesson]
- Co-locate tests with source; assert the exact envelope shapes (don't just assert 200/202 — assert `data`/`meta`/`error` field presence and types). [Source: implementation-patterns-consistency-rules.md#Enforcement Rules]
- **Docker rebuild before testing:** source is baked into the `api`/`worker` images (no volume mount) — `docker compose build api worker && docker compose up -d` after any code change, or tests run stale code. [Source: every Epic 3 story]

### Latest tech / config
- LLM: `ANTHROPIC_MODEL` defaults to `claude-opus-4-8`; the seam is `app/integrations/anthropic_client.py` (`LLMProvider` Protocol + cached `get_llm_provider()`), mockable in tests. 5-1 doesn't call the LLM directly (execution does) — but the proxy's job will. [Source: `config.py:148`; anthropic_client.py]
- Celery: `backend=settings.REDIS_URL` is REQUIRED for fan-out chords (`aggregate_results` callback). Don't disturb. [Source: `celery_app.py`; execution-engine-patterns.md#8]
- Presign TTL: 24h = `expires_s=86400`, applied in `get_job`. The 24h figure comes from the Epic 5 AC, not the architecture docs (which only say "presigned URLs, lifecycle policies"). [Source: epic-5 AC3; `jobs.py:72`]

### Functional / non-functional requirement anchors
- **INV-01** (P1): Skills invocable from Claude via the platform API; platform resolves + executes server-side, returns only output; internals never leave the server. → AC4. [Source: 5-functional-requirements.md §5.8]
- **INV-02** (P1): Skills invocable from scripts/CLI via documented REST API. → AC1/AC4. [Source: §5.8]
- **EXE-04 / USE-01** (P1): Every invocation is logged (start/end, success/failure, input/output refs, user, hierarchy context). The execution path already writes append-only audit via `audit_service.record_entry`; 5-1 does NOT add a new audit write at the API surface (the job/worker path owns it). [Source: §5.3, §5.11; execution-engine-patterns.md source map]
- **LOC-02/03/04** (P1): location-selection / fan-out / parent-child logging — already handled by the existing endpoint + `dispatch_fan_out`; the proxy inherits it. [Source: §5.4]
- **ACL-03/ACL-05** (P1): client-facing IP protection + invoke-only client surface — **deferred to Epic 8**; 5-1 delivers the structural output-only guarantee, not the RBAC. [Source: §5.7; locked with user]
- **NFR §6.1**: ≤2s P95 platform overhead (drives 202-not-sync); ≥10 concurrent executions. **NFR §6.2**: zero silent failures — every failure logged AND surfaced (drives AC5). [Source: 6-non-functional-requirements.md]

### Project Structure Notes
- New `invoke.py` follows the one-router-per-resource convention with its own `prefix="/api/v1/invoke"`; registered in `router.py` (all routers carry their own `/api/v1/...` prefix, mounted at root in `main.py`). [Source: project-structure-boundaries.md#velara-api; `router.py`]
- `error_messages.py` is a new leaf module under `services/` (or `core/`) with no dependencies — pure data + a lookup function. Single source of truth for code→message so the future Run Console UI and any other surface map identically.
- **No migration expected.** AC5's `error` object is built at response time from the existing persisted `error_code`. Confirm `alembic heads == 0012_location_fan_out` before assuming; if Epic 4 (4-1) added `0013+`, chain from the actual head only if a migration is truly needed (it should not be).
- **Naming-discrepancy note:** docs variously call the proxy `/invoke`, `/invocations`, and the collection `/invocation-jobs`. The code-grounded reality is `/api/v1/invocations` (create) + `/api/v1/jobs` (poll); the epic AC4 explicitly names `/api/v1/invoke/{skill_id}` for the proxy. Use those exact paths. [Source: epic-5 AC; core-architectural-decisions.md; project-structure-boundaries.md#Key Data Flows]

### References
- [Source: _bmad-output/planning-artifacts/epics/epic-5-run-console-invocation-ux.md#Story 5.1] — the 5 ACs.
- [Source: _bmad-output/planning-artifacts/architecture/execution-engine-patterns.md] — §1 asyncio/test constraint, §2 terminal guard, §3 atomic dispatch, §4 fresh-session, §6 file-by-key/IP, §7 stable error codes, §8 fan-out. **Read first.**
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#API & Communication] — 202 async model, Claude proxy, error envelope `{code, message, request_id}`.
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] — envelope mandate, status codes, naming, enforcement rules, observability.
- [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#velara-api] — directory layout, test layout, Docker/ruff/pytest.
- [Source: _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md] — INV-01/02/03, EXE-04, LOC-02/03/04, ACL-03/05, USE-01.
- [Source: _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/6-non-functional-requirements.md] — ≤2s P95 overhead, zero silent failures, PHI-never-in-logs.
- [Source: _bmad-output/implementation-artifacts/stories/3-1-async-job-infrastructure.md] — InvocationJob model, job_service lifecycle, presign-best-effort, org-scope-in-WHERE, terminal guard.
- [Source: _bmad-output/implementation-artifacts/stories/3-3-prompt-based-skill-execution.md] — atomic dispatch (`DISPATCH_FAILED`, `get_job_unscoped`), IP-protection AC3, `stop_reason` in metadata.
- [Source: _bmad-output/implementation-artifacts/stories/3-7-location-dependent-skill-fan-out.md] — fan-out children, `FAN_OUT_*` codes, child-returns-not-raises.
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-06-12.md] — #1 lesson: don't re-derive engine invariants; service-level (not task-level) testing.
- Code: `velara-api/app/api/v1/invocations.py:135-311`, `velara-api/app/api/v1/jobs.py:43-217`, `velara-api/app/schemas/job.py:43-94`, `velara-api/app/schemas/invocation.py:15-47`, `velara-api/app/api/v1/router.py:5-14`, `velara-api/app/schemas/common.py:25-39`, `velara-api/app/core/exceptions.py:27-40`.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — no significant debugging required.

### Completion Notes List

- AC1/AC2/AC3: Verified existing endpoints already implement all three ACs. No endpoint code changes needed. Added explicit regression tests asserting exact `{data, meta}` envelope shape (request_id, timestamp), `status=queued`/`running`/`completed`, and sentinel presign URL surfacing in `test_jobs.py`.
- AC4: Created `app/api/v1/invoke.py` — async thin alias of `/invocations` endpoint. Shares all service-layer calls in identical order, preserving all invariants (skill load, invocability guard, version resolution, file-ref pre-validation, location resolution, atomic commit-then-dispatch with DISPATCH_FAILED fresh-session fallback). Re-uses location error classes from `invocations.py` to keep error codes identical across both surfaces. Registered in `router.py`. Added `InvokeRequest` schema to `invocation.py`. IP protection is structural: 202 body only carries `job_id`+`status`; output path via GET /jobs is already IP-protected.
- AC5: Added `ErrorInfo(code, message)` to `app/schemas/job.py`; added `error: ErrorInfo | None` on `JobReadWithResult`. Created `app/services/error_messages.py` with `ERROR_MESSAGES` dict mapping all 17 worker error codes to user-safe static strings + `error_message_for()` with safe generic fallback. `get_job` in `jobs.py` builds the `ErrorInfo` at response time from the persisted `error_code`. No migration needed.
- Tests: 6 unit tests for `error_message_for`; 9 new integration tests in `test_invoke.py` (AC4 202/IP/job-retrieve/404/retired/auth/dispatch-failure); 7 new integration tests in `test_jobs.py` (AC1/AC2/AC3 envelope regression + AC5 failed/unmapped/completed/running error field).
- No migration added (alembic head remains 0012_location_fan_out).
- No patterns-doc update needed (only added proxy router + error map; did not touch execution_tasks/execution_service/job_service).
- Gates: ruff clean, 558 Docker tests pass (+21, 0 regressions).

### File List

- app/api/v1/invoke.py (NEW)
- app/api/v1/router.py (modified — added invoke.router)
- app/api/v1/jobs.py (modified — ErrorInfo import, error_message_for import, error field in get_job)
- app/schemas/job.py (modified — ErrorInfo class, error field on JobReadWithResult)
- app/schemas/invocation.py (modified — InvokeRequest class)
- app/services/error_messages.py (NEW)
- tests/integration/api/test_invoke.py (NEW)
- tests/integration/api/test_jobs.py (modified — AC1/AC2/AC3 + AC5 regression tests)
- tests/unit/services/test_error_messages.py (NEW)

### Change Log

- 2026-06-13: Story 5-1 implemented — Claude proxy POST /api/v1/invoke, ErrorInfo on failed-job poll, AC1/AC2/AC3 envelope regression tests. 558 Docker tests pass (+21, 0 regressions), ruff clean, no migration.

---

**Open questions for the user (none blocking — both resolved during authoring):**
1. ✅ `/invoke` proxy mode → **async thin alias (202 + job_id)**, not synchronous.
2. ✅ `/invoke` access scope → **output-only IP protection now; client-token RBAC + client-facing-flag enforcement deferred to Epic 8.**
