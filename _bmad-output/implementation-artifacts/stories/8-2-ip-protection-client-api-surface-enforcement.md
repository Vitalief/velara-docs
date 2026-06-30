<!--
  Story 8.2 — IP Protection: Client API Surface Enforcement
  Created via bmad-create-story 2026-06-30. Second story of Epic 8 (Access Control & Client Portal).
  Source grounding: 3 parallel source-verified codebase/architecture audits (invocation+job+skill schemas;
  router+deps+role-guard surface; architecture IP-protection decisions) + Epic 8 epic file + Story 8.1
  (done) Dev Notes + deferred-work.md. All file:line citations verified against the real velara-api/ tree
  at creation time. Decisions D1–D3 locked with PM during creation (see Dev Notes).
-->

# Story 8.2: IP Protection — Client API Surface Enforcement

---
baseline_commit: ce270b9b156554bd9b56cd1b0ad4a09fb9304aba
---

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform architect,
I want client-scoped tokens to be served only by a dedicated `/api/v1/client/` router and structurally blocked (404, not 403) from every internal route,
So that it is architecturally impossible — not merely permission-checked — for a client token to reach skill instructions, code, or reference-file contents, and a client can still invoke a skill and retrieve its output through a separate serialization surface that carries zero skill internals.

## Acceptance Criteria

1. **Client router exists with no skill-internals routes.** **Given** a Cognito/dev token with the `client` role claim, **When** it calls the client surface, **Then** it is served by the `/api/v1/client/` router prefix — which exposes ONLY a skill-invocation endpoint and a job-status endpoint, and has **no** routes for skill definitions, skill versions, or skill content. (Skill *discovery/listing* for clients is Story 8.4 — not built here.)

2. **Internal routes are structurally absent to client tokens (404, not 403).** **Given** a `client`-scoped token attempts to call `GET /api/v1/skills/{skill_id}` (or any other internal route), **When** the FastAPI router evaluates it, **Then** HTTP **404** is returned with `{"error": {"code": "NOT_FOUND", ...}}` — the route is treated as structurally absent from the client surface, **not** 403. This is distinct from 8.1's in-org-out-of-scope **403 FORBIDDEN**. (See Dev Notes Decision D2 — the guard is applied to **all** internal routers.)

3. **Client invocation response carries only a job reference.** **Given** a client-scoped token calls the client invocation endpoint, **When** the 202 response is returned, **Then** it contains only `job_id` and `status` — no `instructions`, `code`, `system_prompt`, or `reference_files` fields are present (reuses the existing `InvocationAccepted` schema, which already satisfies this).

4. **Client job-status response uses a separate internals-free schema.** **Given** a client-scoped token polls the client job endpoint for a completed job, **When** the response is returned, **Then** it carries only: `job_id`, `status`, output file download links (presigned URLs), failure `error.message` (when failed), and the safe `created_at`/`completed_at` timestamps — serialized via a **new** `ClientJobRead` Pydantic schema that has **no** field for skill internals **and none of the internal job-context fields** (`skill_id`, `skill_version`, `org_id`, `hierarchy_path`, `created_by_user_id`, `result_metadata`, `parent_job_id`, `location_id`).

5. **Zero internals on any client response (locked by test).** **Given** any client-surface response body is string-searched for skill content and internal-context tokens, **When** the search runs, **Then** zero matches are found — locked by an extension of the existing no-internals body-search assertions (`test_invoke.py:184-233`) and the OpenAPI schema lock (`test_openapi.py`).

## Tasks / Subtasks

- [x] **Task 1 — `reject_client` 404 guard dependency** (AC: #2)
  - [x] Add a guard to `app/core/dependencies.py` (co-locate with the auth/scope deps): `async def reject_client(user: CurrentUser) -> None` that raises `VelaraHTTPException(404, "NOT_FOUND", "Not found.")` when `user.role == "client"`. Model it on the existing `_require_grantor` role-gate (`app/api/v1/access_grants.py:36-41`) but inverted to **deny client** and to return **404 not 403** (existence-hiding — see Decision D2). It depends on `CurrentUser` so the token is still validated first (an unauthenticated request stays 401 via `get_current_user`).
  - [x] Export a dependency-only alias for clean mounting: `RejectClient = Depends(reject_client)` (a bare `Depends`, used in router-level `dependencies=[...]`, not a typed value alias like `CurrentUser`). Do **not** return a value — this guard is side-effecting (raise-or-pass).
  - [x] **Decision D2 (LOCKED): apply to ALL internal routers** — `skills`, `certifications`, `hierarchy`, `ingest`, `invocations`, `invoke`, `jobs`, `access_grants`. A client token gets 404 on every internal route; only `/api/v1/client/*`, `/api/v1/auth/*`, and `/health*` remain reachable for a client. Rationale in Dev Notes. (Do NOT guard `auth` or `health`.)
- [x] **Task 2 — Apply the guard to every internal router** (AC: #2)
  - [x] Add `dependencies=[RejectClient]` at the **`APIRouter(...)` declaration** in each internal router module so the guard runs for every route on that router. Precedent: each router already declares `router = APIRouter(prefix="/api/v1/...", tags=[...])` (e.g. `skills.py:35`, `jobs.py:46`, `invocations.py:39`, `invoke.py:40`, `access_grants.py:24`, `certifications.py`, `ingest.py`, `hierarchy.py`). Add the `dependencies=[...]` kwarg there — this is cleaner than touching every `@router.get/post` decorator and cannot be forgotten on a new route added later to that router.
  - [x] **Order matters for 404-vs-401:** because `reject_client` depends on `CurrentUser` (which 401s a missing/invalid token first), an **unauthenticated** request to an internal route still gets 401, an **internal-role** token passes, and a **client** token gets 404. Verify FastAPI resolves the router-level dependency for every route including ones with their own param-level `CurrentUser` (it does — router `dependencies` run before/around the path-operation; both resolve `get_current_user` but FastAPI caches the dependency within a request so the token is validated once).
  - [x] **Verified:** every internal router is a SINGLE `APIRouter` declaration — `hierarchy.py:32` and `access_grants.py:24` use `APIRouter(prefix="/api/v1", ...)` with full resource paths per-route (`/clients`, `/projects`, `/access-grants`, …); the others use `APIRouter(prefix="/api/v1/<domain>", ...)`. So exactly ONE `dependencies=[RejectClient]` kwarg per router module covers all of its routes (8 edits total). No sub-router-per-resource pattern exists.
- [x] **Task 3 — `ClientJobRead` schema** (AC: #4) — **NET-NEW, the heart of the serialization layer**
  - [x] Add `ClientJobRead` to `app/schemas/job.py` (co-locate with `JobRead`/`JobReadWithResult` — per `project-structure-boundaries.md`, schemas live in per-domain files). Fields (Decision D1 LOCKED — "minimal + safe timestamps"):
    - `job_id: uuid.UUID` (map from the job's `id` — see note below)
    - `status: str`
    - `output_files: list[ClientOutputFile] | None = None` (presigned download links; populated only on completed jobs)
    - `error: ClientErrorInfo | None = None` (only `message` — a user-safe string; **no** `code`, to avoid leaking the internal SCREAMING_SNAKE error taxonomy. Decision D3.)
    - `created_at: datetime`
    - `completed_at: datetime | None = None`
  - [x] Add `ClientOutputFile` (client-safe projection of `OutputFileRef`): `filename: str`, `format: str`, `url: str | None`. **Exclude the raw S3 `key`** (it encodes `skills/{skill_id}/...`-style internal paths in some buckets and is not needed by a downloading client — the presigned `url` is sufficient). Derive `filename` from the output metadata (`output_files[].key` basename or a `filename` field if present) — confirm the available fields against `result_metadata["output_files"]` entries (`{key, format, content_type, size_bytes}` per `app/models/invocation.py:157-199` / `app/schemas/job.py:24-35`).
  - [x] Add `ClientErrorInfo`: `message: str` only.
  - [x] **Do NOT** subclass `JobRead`/`JobReadWithResult` — that would inherit `skill_id`, `org_id`, `hierarchy_path`, `created_by_user_id`, etc. `ClientJobRead` is an **independent** `BaseModel` so a future field added to `JobRead` can never silently leak onto the client surface. (This is the structural guarantee AC4/AC5 demand.)
  - [x] Use `model_config = ConfigDict(from_attributes=False)` (build it explicitly from primitives in the route, not via `model_validate(job)` against the ORM — `from_attributes` validation against the ORM risks pulling unexpected attrs). Construct each field explicitly in the route handler (Task 5).
- [x] **Task 4 — `app/api/v1/client.py`: the client router** (AC: #1, #3)
  - [x] Create `app/api/v1/client.py` with `router = APIRouter(prefix="/api/v1/client", tags=["client"])`. **Do NOT** add `dependencies=[RejectClient]` here (that guard is for *internal* routers). This router is the *only* surface a client may reach.
  - [x] **`POST /api/v1/client/invocations/{skill_id}`** → reuse the shared `queue_invocation` helper (`app/api/v1/invocations.py:135-336`) verbatim — same signature `(skill_id, body: InvocationRequest, user, session, scope, log_prefix="client_invocation")`. Wrap the returned `job_id` in `ResponseEnvelope[InvocationAccepted]` exactly like `invoke_skill`/`invoke_proxy` (status 202). **Reuse `InvocationRequest` + `InvocationAccepted` as-is** — both are already IP-safe (`extra="forbid"`, only `{job_id, status}`). This guarantees the client invocation pipeline cannot drift from the internal one (the same review-hardened atomic-dispatch + scope enforcement + file-ref pre-validation runs).
  - [x] **`GET /api/v1/client/jobs/{job_id}`** → reuse `job_service.get_job(session, job_id, org_id=user.org_id)` (`app/services/job_service.py:152-159`), then `scope.assert_in_scope(str(job.hierarchy_path))` (8.1 scope check — a client may only read jobs in their granted scope), then build a `ClientJobRead` (Task 5). Wrap in `ResponseEnvelope[ClientJobRead]`.
  - [x] Depend on `CurrentUser`, `DbSession`, `HierarchyScope`, and `OutputStorage` (the presign provider) — same dependency aliases used by `jobs.py:105-113`.
  - [x] **Note on who can call the client router:** the epic frames `/api/v1/client/*` as the client surface. Internal roles (`ma_tech`/`consultant`) are NOT blocked from it (they bypass scope as `unrestricted`); that is acceptable and useful for testing/ops. Do not add an inverse "reject internal" guard — the security property required is "client CANNOT reach internal routes," not "internal cannot reach client routes." (Confirmed scope boundary — see Dev Notes.)
- [x] **Task 5 — Build `ClientJobRead` in the client job route (presign reuse)** (AC: #4)
  - [x] In `GET /api/v1/client/jobs/{job_id}`, after loading + scope-checking the job, project it to `ClientJobRead`:
    - `job_id = job.id`, `status = job.status`, `created_at = job.created_at`, `completed_at = job.completed_at`.
    - **Output files:** mirror the presign loop in `jobs.py:131-203` — for `job.result.output_file_key` and each entry in `job.result.result_metadata["output_files"]`, call `storage.presign_download(key, expires_s=86400)` **best-effort** (wrap in try/except, on failure log a warning and set `url=None`, never 500). Build `ClientOutputFile(filename=..., format=..., url=...)`. **Do not copy `result_metadata` wholesale** — extract only filename/format/url per file.
    - **Error:** if `job.status == JOB_STATUS_FAILED` and `job.error_code`, set `error = ClientErrorInfo(message=error_message_for(job.error_code))` (reuse `app/services/error_messages.py:error_message_for` — the same user-safe mapping `jobs.py:263-267` uses). **Do not** expose `error_code` itself on the client surface (D3).
  - [x] **Fan-out parents:** a client invocation can produce a fan-out parent job (if the skill is location-dependent and `fan_out=true`). Decide child handling: for 8.2, surface only the **parent's** own output files (do NOT expose the `children[]` array with per-child job_ids/locations — that leaks hierarchy structure). If the parent has no own output (children hold the outputs), return empty `output_files` for now and log a follow-up — full client fan-out output aggregation can be a 8.4 concern. **Confirm this is acceptable** (most client-facing skills are not location-dependent; flag if the engagement needs client fan-out output in 8.2).
- [x] **Task 6 — Mount the client router** (AC: #1)
  - [x] In `app/api/v1/router.py`: add `client` to the `from app.api.v1 import (...)` block and append `api_router.include_router(client.router)`. No extra prefix at include time (the prefix is on the router declaration, per the established pattern).
- [x] **Task 7 — Tests** (AC: #1–#5)
  - [x] **AC2 (404 existence-hiding)** — new `tests/integration/api/test_client_surface.py` (or extend `test_invoke.py`): a `client`-role token (`_auth_headers("client")`) calling `GET /api/v1/skills`, `GET /api/v1/skills/{skill_id}`, `GET /api/v1/jobs/{job_id}`, `POST /api/v1/invocations/{skill_id}`, `POST /api/v1/invoke/{skill_id}`, `GET /api/v1/clients/{id}`, `POST /api/v1/access-grants` → **404** with `error.code == "NOT_FOUND"` for each. Assert it is 404 NOT 403 (the distinguishing AC2 property). Also assert an **unauthenticated** request to one internal route stays **401** (proves the guard order didn't break auth) and an **internal-role** token still gets its normal response (200/202/404-for-real-missing — proves the guard only bites `client`).
  - [x] **AC3 (client invocation 202)** — a client token POSTing to `/api/v1/client/invocations/{skill_id}` for an in-scope, client-org skill → 202; `set(resp.json()["data"].keys()) == {"job_id", "status"}`; body string-search finds none of `("artifact", "system_prompt", "instruction", "You are a helpful")` (extend the `test_invoke.py:184-205` pattern). **Test-setup nuance (CRITICAL):** the seed `client.user` is in `org_client_001`, but seeded skills live in `org_vitalief` → a client invoking a vitalief skill 404s (cross-org). To exercise a *successful* client invocation you must seed a skill **and** the target hierarchy node (study/location) **in `org_client_001`**, then create an access grant for `usr_003_client` covering that node (use `access_service.create_grant(...)` with `role="client"`, `node_type=...`; see `test_access_grants.py` `_grant` helper). For a non-location skill, the client has no org-root grant → it would 403; prefer a location-dependent skill + a location grant, OR confirm with PM whether client invocations of org-global skills are in scope (they are blocked today by the 8.1 `unrestricted`-only org-root rule — `invocations.py:283-291`).
  - [x] **AC4/AC5 (ClientJobRead no-internals)** — poll `GET /api/v1/client/jobs/{job_id}` for a completed client job; assert `set(data.keys()) <= {"job_id","status","output_files","error","created_at","completed_at"}`; assert each forbidden internal-context key is ABSENT from the body string: `skill_id`, `skill_version`, `org_id`, `hierarchy_path`, `created_by_user_id`, `result_metadata`, `parent_job_id`, `location_id`, plus the skill-internal tokens (`artifact`, `system_prompt`, `instruction`, the seeded artifact text). Use a full-body `str(resp.json())` substring search like `test_invoke.py:202-205`.
  - [x] **OpenAPI lock (AC5)** — extend `test_openapi.py`: assert `ClientJobRead` is in `components.schemas` and its `properties` keys are a subset of the 6 allowed; assert none of the forbidden internal-context field names appear in `ClientJobRead.properties`. (Mirror `test_invoke_request_schema_exposes_only_safe_fields` at `test_openapi.py:111-131`.)
  - [x] Reuse the test scaffolding verbatim: `_auth_headers(role)` / `_client_auth()` / `_internal_auth()` (`test_invoke.py:57-74`), `_create_skill_in_db(...)` (`test_invoke.py:80-155`), the `_postgres_reachable()` skip-guard (`test_invoke.py:28-52`), and the `client` ASGI fixture from `conftest.py`.
- [x] **Task 8 — Run gates before marking review**
  - [x] `ruff check` + `ruff format`; run the full `pytest` integration suite (requires the Docker stack — Postgres + MinIO + Redis reachable; `conftest.py` applies migrations session-autouse). Confirm: no existing internal test regressed (internal-role tokens still pass everywhere), all new client-surface tests pass, OpenAPI locks pass.
  - [x] **No migration** — this story is routing + Pydantic serialization only. Do NOT author an Alembic migration (Decision: zero DB changes — verified, skill internals are already S3-only and no new tables/columns are needed).

## Dev Notes

### What's already built (DO NOT recreate, DO reuse)

- **Skill internals are ALREADY S3-only — never DB columns.** The IP guarantee is structural-by-storage before 8.2 even starts. Skill artifact bytes (instructions / code / system_prompt / reference files) live exclusively in S3 via `SkillVersion.artifact_key` (`app/models/skill.py:165-208` — only `artifact_key`/`artifact_checksum`/`content_type` in the DB, no content). `SkillRead` (`app/schemas/skill.py:222-256`) deliberately omits `artifact_key` and all content. So the AC-named fields (`instructions`, `code`, `system_prompt`, `reference_files`) **do not exist as serializable model/schema fields anywhere** — 8.2's real job is excluding the *metadata that points-at/describes internals* and the *internal job-context fields*, via a separate client router + the new `ClientJobRead` schema.
- **The invocation REQUEST contract is already IP-safe and locked.** `InvocationRequest` / `InvokeRequest` (`app/schemas/invocation.py:17-63`) carry only `{file_ref_ids, inputs, location_id, study_id, fan_out}` with `extra="forbid"` (422 on any unknown field). `InvocationAccepted` (`:66-70`) returns only `{job_id, status}`. Both are already string-search-locked by `test_invoke.py:184-205` and schema-locked by `test_openapi.py:111-146`. **Reuse them as-is** for the client invocation endpoint (AC3 needs nothing new here).
- **`queue_invocation` is the single shared invocation pipeline — REUSE IT.** `app/api/v1/invocations.py:135-336`. Signature: `async def queue_invocation(*, skill_id, body: InvocationRequest, user: CurrentUser, session: DbSession, scope: HierarchyScopeValue, log_prefix="invocation") -> uuid.UUID`. It does: skill load (cross-org→404 `SKILL_NOT_FOUND`), invocability guard, version resolution, file-ref pre-validation, location resolution + fan-out, **8.1 scope enforcement** (`scope.assert_in_scope(...)` on study/location; org-global only for `unrestricted` roles), atomic commit-then-dispatch with `DISPATCH_FAILED` fresh-session fallback. Both `invoke_skill` (`:343-361`) and `invoke_proxy` (`invoke.py:55-88`) already call it — the client route makes it three callers, none diverging.
- **Job retrieval + presign pattern — REUSE.** `job_service.get_job(*, session, job_id, org_id) -> InvocationJob` (`app/services/job_service.py:152-159`, cross-org→404 `JOB_NOT_FOUND`). The presign pattern is `storage.presign_download(key, expires_s=86400)` via the `OutputStorage` dependency (`app/core/dependencies.py:79`, impl `app/integrations/storage.py` — boto3 `generate_presigned_url("get_object", ...)`, 24h TTL). Best-effort: on failure log + `url=None`, never 500 (`jobs.py:138-148`). The full presign loop to mirror is `jobs.py:131-203`.
- **8.1 RBAC foundation is DONE and wired.** `HierarchyScopeValue` (`app/core/dependencies.py:109-144`): `scope_paths: list[str]`, `unrestricted: bool`, `assert_in_scope(path)` (raises 403 `FORBIDDEN`), `in_scope(path)` (non-raising). `HierarchyScope` alias (`:167`). `_INTERNAL_ROLES = frozenset({"ma_tech","consultant"})` bypass (`:106,157-158`). `client` role goes through grant resolution (`access_service.resolve_scope_paths`). The client job/invocation routes MUST use `HierarchyScope` so a client only touches in-scope jobs.
- **Role-gate precedent.** `_require_grantor(user_role)` (`app/api/v1/access_grants.py:36-41`) raises `VelaraHTTPException(403, "FORBIDDEN", ...)` when role not in `{consultant, ma_tech}`. 8.2's `reject_client` is the **inverse shape**: deny `client`, raise **404 `NOT_FOUND`** (not 403). Note `_require_grantor` is called *inside* the handler; 8.2 prefers the router-level `dependencies=[...]` form so it's automatic for every route on the router.
- **Cross-org-404 convention (the precedent AC2 extends).** `hierarchy_service.get_client` (`:187-197`): cross-org → 404 `CLIENT_NOT_FOUND`, "so the status code does not leak whether an id exists in another tenant." `get_job`/`get_skill` collapse cross-org to 404 the same way. AC2's "internal route → 404 for client" is the same existence-hiding principle applied at the *router* boundary instead of the *row* boundary.
- **Error envelope + base exception.** `VelaraHTTPException(status_code, code, message)` (`app/core/exceptions.py:27-41`). Error envelope `{"error": {"code", "message", "request_id"}}` (`app/schemas/common.py:25-33`). Use `VelaraHTTPException(404, "NOT_FOUND", "Not found.")` for the guard — `NOT_FOUND` is a new stable code; keep the message generic ("Not found.") so it reveals nothing.
- **Router mount pattern.** `app/api/v1/router.py` imports each module and calls `api_router.include_router(<mod>.router)` with NO include-time prefix — each router bakes its own `APIRouter(prefix="/api/v1/...", tags=[...])`. Routers are mounted WITHOUT shared `dependencies=[...]` today; per-route auth is via the `CurrentUser` param.
- **Test scaffolding.** `_auth_headers(role)` maps `ma_tech→ma.tech`, `consultant→consultant`, `client→client.user` (`test_invoke.py:57-66`); `_client_auth()`/`_internal_auth()` shortcuts (`:69-74`). Seed users: `client.user` = `usr_003_client`, `org_client_001`, `role=client` (`app/integrations/auth.py:112-116`). `_create_skill_in_db(...)` seeds a Skill+SkillVersion and writes artifact bytes to MinIO (`test_invoke.py:80-155`). No-internals body-search assertion: `test_invoke.py:184-233`. OpenAPI schema lock: `test_openapi.py:111-146`.

### Decisions baked into this story (LOCKED with PM during creation 2026-06-30)

- **D1 — `ClientJobRead` = "minimal + safe timestamps."** Fields: `job_id`, `status`, `output_files[]` (presigned links), `error.message`, `created_at`, `completed_at`. Excludes ALL skill-identity + internal-context fields (`skill_id`, `skill_version`, `org_id`, `hierarchy_path`, `created_by_user_id`, `result_metadata`, `parent_job_id`, `location_id`). It is an **independent BaseModel**, NOT a subclass of `JobRead` (subclassing would inherit the leak surface).
- **D2 — The 404 reject-client guard is applied to ALL internal routers** (`skills, certifications, hierarchy, ingest, invocations, invoke, jobs, access_grants`), NOT just skill-bearing ones. Rationale: (a) the architecture decision is literally "Client-scoped tokens have **no route** to skill internals; enforced at FastAPI router prefix" (`core-architectural-decisions.md:12,26`) — "no route" means the whole internal surface; (b) leaving some internal routers at 403/scope-guarded and others at 404 creates an inconsistent existence-hiding story and a future-leak risk; (c) a client legitimately needs only `/api/v1/client/*` + `/auth` + `/health`. `auth` and `health` are NOT guarded.
- **D3 — Client error surface exposes `message` only, never `error_code`.** The internal SCREAMING_SNAKE error taxonomy (`SKILL_RETIRED`, `DISPATCH_FAILED`, `LOCATION_REQUIRED`, …) is internal vocabulary; clients get the user-safe `error_message_for(code)` string only. (`error_code` itself is an internal-context field by the same logic as D1's exclusions.)
- **Scope boundary — internal roles may reach `/api/v1/client/*`.** Not blocked; useful for ops/testing. The required property is one-directional: client CANNOT reach internal. No inverse guard.

### Scope boundaries (what this story is NOT)

- **NOT skill discovery/enumeration for clients** — there is no client skill-list route in 8.2 (AC1 explicitly: invocation + job-status only). The client must already know the `skill_id` (8.3/8.4 wire discovery). **Visibility filtering** (`internal_only | paired | client_facing`, `app/models/skill.py:visibility`) is **Story 8.4** — do not add any visibility logic here.
- **NOT the client-portal frontend** — `/client/*` React routes, `ClientDashboard`/`ClientRun`, login redirect = Stories 8.3 (shell/auth) and 8.4 (discovery/run UX). 8.2 is backend API surface only.
- **NOT a migration / DB change** — routing + Pydantic serialization only. Zero new tables/columns (skill internals already S3-only; jobs already exist).
- **NOT new auth/token logic** — `get_current_user` + `AuthPrincipal.role` are untouched; the guard reads the already-validated `user.role`.

### Architecture compliance rules (MUST follow)

From `implementation-patterns-consistency-rules.md` "Enforcement Rules" + `core-architectural-decisions.md`:
1. Use the response envelope — `ResponseEnvelope[...]` / `ErrorEnvelope`, never bare objects (`:139`).
2. Apply `hierarchy_scope` on every route touching hierarchical data — the client job/invocation routes use `HierarchyScope` (`:140`).
3. `snake_case` DB columns + JSON fields; SCREAMING_SNAKE stable error codes, never renamed once shipped (`NOT_FOUND` is new) (`:141`, `core-architectural-decisions.md` error codes).
4. `request_id` carried through (middleware already does this); each route builds `ResponseMeta` via the `_meta(request)` helper pattern (`jobs.py:49-53`).
5. Never return raw exception messages — raise `VelaraHTTPException`, let the global handler envelope it (`:143`).
6. Never store file content inline — S3-key + presigned-URL pattern only (`:144` — already honored; the client surface returns presigned URLs, never bytes).
- **Naming:** API path segments kebab/plural → `/api/v1/client/invocations/{skill_id}`, `/api/v1/client/jobs/{job_id}`; path params snake_case `{skill_id}`/`{job_id}`. Pydantic classes PascalCase (`ClientJobRead`). New router file `app/api/v1/client.py` (singular resource module name, like `skills.py`/`jobs.py`).

### Critical anti-patterns / traps

- **Do NOT subclass `JobRead` for `ClientJobRead`** — inheritance would carry every internal-context field. Make it a fresh `BaseModel`; a leak then requires someone to *add* a field, not *forget to remove* one.
- **Do NOT return 403 for a client hitting an internal route** — AC2 requires **404** (route structurally absent). 403 would both fail the AC and leak that the route exists. The guard's status is `404 NOT_FOUND`, distinct from 8.1's in-scope-violation 403.
- **Do NOT forget the guard runs AFTER auth** — `reject_client` depends on `CurrentUser`, so missing/invalid token still 401s first; only an authenticated `client` token gets 404. Verify a no-token request to an internal route is still 401 (a test asserts this).
- **Do NOT build a parallel invocation pipeline** — the client invocation MUST call `queue_invocation`. A second hand-rolled pipeline would drift from the 8.1-hardened scope/dispatch/file-ref invariants. The whole point of `queue_invocation`'s `log_prefix` param is to support exactly this third caller.
- **Do NOT copy `result_metadata` onto the client response** — it's a free-form dict (highest leak risk: may contain `skill_id`, internal counters, S3 keys). Extract only `filename`/`format`/presigned-`url` per output file into `ClientOutputFile`.
- **Do NOT expose the raw S3 `key` or internal `error_code` on the client surface** — `key` encodes internal path structure; `error_code` is internal vocabulary. Client gets presigned `url` + user-safe `error.message` only.
- **Cross-org reminder for tests** — `client.user` is `org_client_001`; default seed skills are `org_vitalief`. A naive client-invocation test will 404 (cross-org) before any 8.2 logic runs. Seed the skill + grant in `org_client_001` (Task 7).
- **`hierarchy.py` + `access_grants.py` use `prefix="/api/v1"` (not `/api/v1/<domain>`)** with full paths per-route — still a single `APIRouter`, so one `dependencies=[RejectClient]` kwarg covers all their routes (verified). Don't mistake the broad prefix for needing per-route guards.

### Testing standards

- Integration tests in `tests/integration/api/` (new `test_client_surface.py` or extend `test_invoke.py`); the suite skips when Postgres is unreachable (`_postgres_reachable()` guard — `test_invoke.py:28-52`).
- Assert exact status codes AND envelope `error.code` (e.g. `assert resp.status_code == 404` and `resp.json()["error"]["code"] == "NOT_FOUND"`).
- Lock no-internals with **both** a `set(data.keys())` allow-list assertion AND a full-body `str(resp.json())` substring search for every forbidden token (skill-internal text + internal-context field names) — mirror `test_invoke.py:200-205`.
- Add an OpenAPI schema lock for `ClientJobRead` mirroring `test_openapi.py:111-131`.
- The presign / completed-job path needs MinIO + a completed job — follow the `test_invoke.py`/`test_invocations.py` `celery_eager` + `_create_skill_in_db` setup to drive a job to completion, or assert the queued-state client poll for the no-internals checks that don't need output.

### Project Structure Notes

- **New files:** `app/api/v1/client.py` (client router); `tests/integration/api/test_client_surface.py` (or additions to `test_invoke.py`).
- **New schema (in existing file):** `ClientJobRead` + `ClientOutputFile` + `ClientErrorInfo` in `app/schemas/job.py`.
- **Modified files:** `app/core/dependencies.py` (add `reject_client` + `RejectClient`); `app/api/v1/router.py` (import + mount `client.router`); each internal router module — `skills.py`, `certifications.py`, `hierarchy.py`, `ingest.py`, `invocations.py`, `invoke.py`, `jobs.py`, `access_grants.py` (add `dependencies=[RejectClient]` to the `APIRouter(...)` declaration); `tests/integration/api/test_openapi.py` (add `ClientJobRead` lock).
- **Alignment with `project-structure-boundaries.md`:** ACL-07 (client-portal/structural surface) maps to `core/dependencies.py` + the new client router. The structure doc lists `routes/client.tsx` on the FE (8.3/8.4) and ACL access-control in `core/dependencies.py` — the backend client router (`api/v1/client.py`) is the natural home and matches the per-resource router-file convention. No conflicts.

### References

- Epic: [epic-8-access-control-client-portal.md](../../planning-artifacts/epics/epic-8-access-control-client-portal.md) — Story 8.2 ACs (verbatim source); 8.1 (done) and 8.4 (visibility) boundaries.
- Previous story (DONE): [8-1-hierarchy-scoped-rbac-enforcement.md](./8-1-hierarchy-scoped-rbac-enforcement.md) — `HierarchyScopeValue`, `_INTERNAL_ROLES` bypass, scope wiring into invocations/jobs, role-gate precedent, internal-role ADR.
- [core-architectural-decisions.md](../../planning-artifacts/architecture/core-architectural-decisions.md) — "Skill IP protection | API-layer enforcement | Client-scoped tokens have no route to skill internals; enforced at FastAPI router prefix, not just permission checks" (:26); "No API route for client-scoped tokens exposes the internals table… enforced at the API routing layer, not just RBAC" (:12); "Claude proxy… Skill internals never in request or response" (:39); 8.1 internal-roles-org-global ADR (:90-112).
- [implementation-patterns-consistency-rules.md](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md) — response envelope (Enforcement #1), hierarchy_scope (#2), snake_case (#3), S3-key-not-inline (#6), endpoint/naming conventions, visibility enum.
- [project-structure-boundaries.md](../../planning-artifacts/architecture/project-structure-boundaries.md) — file locations; ACL-01–07 → `core/dependencies.py` + client-portal guards; per-resource router-file convention.
- Code (verified at creation 2026-06-30): `queue_invocation` `app/api/v1/invocations.py:135-336`; `invoke_skill` `:343-361`; `invoke_proxy` `app/api/v1/invoke.py:55-88`; `InvocationRequest`/`InvokeRequest`/`InvocationAccepted` `app/schemas/invocation.py:17-70`; `get_job`/`list_jobs`/`cancel_job` `app/services/job_service.py:152-319`; job GET route + presign loop `app/api/v1/jobs.py:105-303`; `JobRead`/`JobReadWithResult`/`JobResult`/`OutputFileRef` `app/schemas/job.py:24-133`; `InvocationJob`/`InvocationResult` models `app/models/invocation.py:49-199`; `SkillRead` `app/schemas/skill.py:222-256`; `Skill`/`SkillVersion` models `app/models/skill.py:35-208`; internal skill routes `app/api/v1/skills.py:48,88,130,190,212,247,290,317`; `presign_download` `app/integrations/storage.py`; `reject`/role-gate precedent `_require_grantor` `app/api/v1/access_grants.py:36-41`; `HierarchyScopeValue`/`_INTERNAL_ROLES`/`HierarchyScope` `app/core/dependencies.py:106-167`; `get_current_user`/aliases `:57-87`; `AuthPrincipal` `app/integrations/auth.py:35-53`; seed users `:98-117`; `VelaraHTTPException` `app/core/exceptions.py:27-41`; `ClientNotFoundError`(404) `app/services/hierarchy_service.py:31-35`; `HierarchyScopeError`(403 FORBIDDEN) `:70-75`; cross-org-404 `get_client` `:187-197`; error envelope `app/schemas/common.py:25-33`; router mount `app/api/v1/router.py:5-29`; `error_message_for` `app/services/error_messages.py`; test scaffolding `tests/integration/api/test_invoke.py:28-233`, `test_invocations.py:57-393`, `test_openapi.py:111-146`, `test_access_grants.py`.
- Deferred-work: no open 8.2 items in [deferred-work.md](../deferred-work.md) at creation.

## Review Findings

<!-- Added by bmad-code-review 2026-06-30. 3-layer adversarial review (Blind Hunter, Edge Case
     Hunter, Acceptance Auditor) + orchestrator verification against the real velara-api/ tree,
     diffed vs baseline_commit ce270b9 (Story 8.1). All 5 ACs verified PASS and D1/D2/D3 honored;
     findings below are correctness (1 high) + coverage + process. 6 patch / 3 decision / 1 defer
     / 4 dismissed. -->

### Decision-needed (resolved 2026-06-30)

- [x] [Review][Decision→Dismissed] Out-of-scope same-org client job poll returns 403, not 404 — **RESOLVED: keep 403.** Decision: match the internal `jobs.py` 8.1 semantics (same-org-out-of-scope = 403 FORBIDDEN) on the client router too; the existence oracle is accepted as intended. No code change. [`velara-api/app/api/v1/client.py:115`]
- [x] [Review][Decision→Dismissed] `output_file_key` (singular) not presigned on the client route — **RESOLVED: dismissed after investigation.** Verified the SOLE output-writing path is `_persist_output` (`execution_service.py:191-237`), routed through by all 3 runtimes (prompt/code/hybrid at `:491/:632/:945`); it ALWAYS returns both `output_file_key` AND `result_metadata["output_files"]=[{key,...}]` carrying that same key. No path sets `output_file_key` without mirroring it into `output_files[]`, so the client's list-only loop captures every real output. Residual fragility: a future executor that sets `output_file_key` outside `_persist_output` would reintroduce the gap. [`velara-api/app/api/v1/client.py:120-160`]
- [x] [Review][Decision→Patch] `reject_client` guard is a denylist (`role == "client"`), not an allowlist — **RESOLVED: harden to allowlist.** Reject any role not in `_INTERNAL_ROLES` (fails closed when a future external role is added). Moved to Patch below. [`velara-api/app/core/dependencies.py:182`]

### Patch (all applied + verified 2026-06-30)

- [x] [Review][Patch] **`blocked` job leaks held-for-review output to the client (HIGH)** — FIXED. `client.py` now gates the `output_files` presign block on `job.status == JOB_STATUS_COMPLETED and job.result is not None` (was `job.result is not None` alone). `mark_blocked` writes a full result row identical to `mark_completed` but its output is held for human review (QA egregious flag); the client no longer receives presigned URLs for it. Locked by `test_client_blocked_job_withholds_output` (asserts empty `output_files` + no key in body). [`velara-api/app/api/v1/client.py:117-127`]
- [x] [Review][Patch] No completed-job / out-of-scope client-router test — ADDED 3 tests to `test_client_surface.py`: `test_client_completed_job_returns_presigned_output_no_internals` (drives a job to completed with a real MinIO output + result_metadata["output_files"], asserts a usable presigned url, basename filename, raw key absent, full-body no-internals search); `test_client_blocked_job_withholds_output` (locks the HIGH fix); `test_client_out_of_scope_same_org_job_is_403` (locks the kept-403 decision). All green. [`velara-api/tests/integration/api/test_client_surface.py`]
- [x] [Review][Patch] 8.1 regression assertions retired without client-router replacement — RESOLVED (re-scoped after analysis): the only scope-limited role is `client`, which 404s at the router on every internal route, AND `ma_tech`/`consultant` are `unrestricted` (bypass scope) — so the retired behaviors are structurally unreachable via ANY internal HTTP route by ANY role. Correct homes: (a) **in-org-403** restored on the client router via `test_client_out_of_scope_same_org_job_is_403`; (b) **scope-matching** (exact/descendant/sibling-reject/parent-reject/empty/unrestricted/prefix-without-dot) already covered by 11 unit cases in `tests/unit/services/test_access_service.py` (verified present in tree); (c) **immediate revocation** — the genuine gap — restored by strengthening `test_revocation_is_immediate` to assert `resolve_scope_paths` CONTAINS the granted path before revoke and does NOT after (was: grant_id-uniqueness only). [`velara-api/tests/integration/api/test_access_grants.py:283`]
- [x] [Review][Patch] Story File List under-reports churn — FIXED: `test_access_grants.py` enumerated; `ruff format` reflow churn in `invocations.py`/`skills.py`/`jobs.py` noted in the File List. [story File List]
- [x] [Review][Patch] Comment mislabels Decision reference — FIXED: `client.py` comment now correctly attributes the S3-key exclusion to D1 (was "(D3)"). [`velara-api/app/api/v1/client.py:119`]
- [x] [Review][Patch] Harden `reject_client` to a fail-closed allowlist — FIXED: now rejects any role `not in _INTERNAL_ROLES` (was `role == "client"`), keeping the 404 NOT_FOUND response. A future external/mis-cased/missing role fails closed on internal routes. AC2 guard tests (client→404, ma_tech→pass, unauth→401) all still green. [`velara-api/app/core/dependencies.py:170-189`]

### Deferred

- [x] [Review][Defer] Fan-out parent client poll degrades to permanently empty `output_files` + an unhelpful parent status — a fan-out parent's `result_metadata` carries a `"children"` roll-up (job_id/location_id/status/output_file_key per child), NOT a top-level `"output_files"` key, so the client loop finds nothing and returns `output_files: null`; the parent status never summarizes child completion. No leak (verified: the client loop keys on `"output_files"`, the parent metadata key is `"children"`, and `ClientJobRead` excludes `result_metadata`). Story 8.2 explicitly defers full client fan-out output aggregation to 8.4 — deferred, pre-acknowledged. [`velara-api/app/api/v1/client.py:120-160`]

### Dismissed (4 — not written as action items)

- `get_job` None → 500 / cross-org wrong-error (blind) — FALSE POSITIVE: `get_job` → `_get_job_or_404`, return type `InvocationJob`, raises 404; never returns None (`job_service.py:152-159`).
- Fan-out parent presigns child output keys → leak (blind, HIGH) — FALSE POSITIVE: parent `result_metadata` key is `"children"`, not `"output_files"`; client loop keys on `"output_files"` and finds nothing; `ClientJobRead` excludes `result_metadata`. No leak (Edge Hunter corroborates). NOTE: safe only because the metadata key names differ — fragile.
- Cross-org-404 tests now assert the guard not domain isolation (blind) — legitimate cascade; domain cross-org-404 remains covered for internal-role tokens; the real coverage concern is captured in the 8.1-regression patch above.
- `format` silently coerced to `""` vs strict `key` handling (blind) — cosmetic; mirrors internal `jobs.py:190` exactly; no failure mode.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- **AUTH_BACKEND=cognito container env:** `.env` has `AUTH_BACKEND=cognito`; DevAuthProvider HS256 tokens are rejected by CognitoAuthProvider RS256 validation. All integration tests must be run with `docker compose exec -e AUTH_BACKEND=dev api pytest ...`.
- **RejectClient cascade on existing tests:** 13+ pre-existing tests used `client`-role tokens on internal routes expecting domain-specific error codes (SKILL_NOT_FOUND, CLIENT_NOT_FOUND, etc.). With RejectClient guard, those tests now get `NOT_FOUND` at the router boundary before the domain handler runs. All 7 affected test files updated.
- **ltree path bug in test seeding:** `_seed_location_dependent_invocation_context()` initially built hierarchy paths manually with `"org.{c_seg}"` prefix but `_org_segment("org_client_001")` returns `"org_org_client_001"`. Fix: use `hierarchy_service.create_client/project/study/location()` and `access_service.create_grant()` directly — the service functions generate correct ltree paths and make this approach match how `test_access_grants.py` seeds data.
- **Client invocation 403 root cause:** Non-location-dependent skills are org-global (hierarchy_path="org"); `queue_invocation` lines 280-283 explicitly block `unrestricted=False` (client) tokens from invoking them. Solution: seed `location_dependent=True` skill + full hierarchy + grant; pass `location_id` in the invocation body.
- **3 pre-existing ingest failures:** `test_confirm_unsupported_content_type_returns_422` and 2 docx/xlsx tests fail with `httpx.ConnectError: [Errno 111] Connection refused` when trying to PUT to MinIO presigned URLs from inside the container. Pre-existing infrastructure issue, unrelated to 8.2 changes.

### Completion Notes List

- All 5 ACs satisfied: client router created at `/api/v1/client/`, `RejectClient` guard on all 8 internal routers, `ClientJobRead`/`ClientOutputFile`/`ClientErrorInfo` schemas (independent `BaseModel`, zero inheritance), `queue_invocation` reused verbatim for client invocation, OpenAPI schema lock added to `test_openapi.py`.
- 16 new integration tests in `test_client_surface.py`: 11 AC2 guard tests + 3 AC3 invocation tests + 1 AC4/AC5 poll schema test + 1 internal-may-reach-client test. All pass.
- 529 unit tests pass; integration suite passes except 3 pre-existing ingest infrastructure failures (unrelated).
- No migration authored (confirmed zero DB changes — routing + Pydantic serialization only).

### File List

**New files:**
- `velara-api/app/api/v1/client.py` — client router (`POST /api/v1/client/invocations/{skill_id}`, `GET /api/v1/client/jobs/{job_id}`)
- `velara-api/tests/integration/api/test_client_surface.py` — 16 integration tests for all ACs

**Modified files:**
- `velara-api/app/core/dependencies.py` — added `reject_client()` + `RejectClient = Depends(reject_client)`
- `velara-api/app/api/v1/router.py` — imported + mounted `client.router`
- `velara-api/app/schemas/job.py` — added `ClientOutputFile`, `ClientErrorInfo`, `ClientJobRead`
- `velara-api/app/api/v1/skills.py` — added `dependencies=[RejectClient]` to `APIRouter(...)`
- `velara-api/app/api/v1/certifications.py` — added `dependencies=[RejectClient]` to `APIRouter(...)`
- `velara-api/app/api/v1/hierarchy.py` — added `dependencies=[RejectClient]` to `APIRouter(...)`
- `velara-api/app/api/v1/ingest.py` — added `dependencies=[RejectClient]` to `APIRouter(...)`
- `velara-api/app/api/v1/invocations.py` — added `dependencies=[RejectClient]` to `APIRouter(...)`
- `velara-api/app/api/v1/invoke.py` — added `dependencies=[RejectClient]` to `APIRouter(...)`
- `velara-api/app/api/v1/jobs.py` — added `dependencies=[RejectClient]` to `APIRouter(...)`
- `velara-api/app/api/v1/access_grants.py` — added `dependencies=[RejectClient]` to `APIRouter(...)`
- `velara-api/tests/integration/api/test_openapi.py` — added `ClientJobRead` schema lock
- `velara-api/tests/integration/api/test_certifications.py` — updated 3 client-token assertions from domain codes → `NOT_FOUND`
- `velara-api/tests/integration/api/test_hierarchy.py` — updated 4 client-token assertions from `CLIENT_NOT_FOUND` → `NOT_FOUND`
- `velara-api/tests/integration/api/test_invocations.py` — updated 1 cross-org assertion from `SKILL_NOT_FOUND` → `NOT_FOUND`
- `velara-api/tests/integration/api/test_invoke.py` — updated 1 cross-org assertion from `SKILL_NOT_FOUND` → `NOT_FOUND`
- `velara-api/tests/integration/api/test_jobs.py` — updated 1 cross-org assertion from `JOB_NOT_FOUND` → `NOT_FOUND`
- `velara-api/tests/integration/api/test_ingest.py` — updated 1 cross-org assertion from `FILE_REF_NOT_FOUND` → `NOT_FOUND`
- `velara-api/tests/integration/api/test_access_grants.py` — **(omitted from original File List; added by code-review 2026-06-30)** rewrote ~7 client-token assertions from 8.1 `403 FORBIDDEN` / domain codes → `404 NOT_FOUND` (guard cascade); coverage of the retired 8.1 behaviors (immediate revocation, in-org-403, positive org-scoped filtering) restored via internal-role tokens — see Review Findings patch.
- **Note (code-review 2026-06-30):** `ruff format` (Task 8) reflowed unrelated production code in `invocations.py`, `skills.py`, and `jobs.py` (behavior-preserving whitespace/line-wrap only). Those files are listed above as "added `dependencies=[RejectClient]`"; the reflow churn inflates their diff line-count beyond the guard edit.

### Change Log

- Added `reject_client` 404 guard + `RejectClient` alias to `app/core/dependencies.py`
- Applied `dependencies=[RejectClient]` to all 8 internal `APIRouter(...)` declarations
- Added `ClientOutputFile`, `ClientErrorInfo`, `ClientJobRead` schemas to `app/schemas/job.py`
- Created `app/api/v1/client.py` with POST invocations + GET jobs routes
- Mounted `client.router` in `app/api/v1/router.py`
- Added `ClientJobRead` OpenAPI lock to `test_openapi.py`
- Created `tests/integration/api/test_client_surface.py` with 16 integration tests
- Updated 7 existing test files to reflect `NOT_FOUND` guard behavior for client tokens on internal routes
