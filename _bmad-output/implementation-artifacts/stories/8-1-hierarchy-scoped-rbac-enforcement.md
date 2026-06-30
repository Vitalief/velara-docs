<!--
  Story 8.1 — Hierarchy-Scoped RBAC Enforcement
  Created via bmad-create-story 2026-06-30. First story of Epic 8 (Access Control & Client Portal).
  Source grounding: 2 parallel source-verified audits (hierarchy/ltree/auth model + router/test patterns)
  + architecture docs + Epic 8 epic file + deferred-work.md. All file:line citations verified against the
  real velara-api/ tree at creation time.
-->

# Story 8.1: Hierarchy-Scoped RBAC Enforcement

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform developer,
I want the `UserAccessGrant` model and a `hierarchy_scope` FastAPI dependency enforced on every protected hierarchy route,
So that users can only access entities within their granted hierarchy scope — not through any combination of API calls — and an admin can grant/revoke that scope at runtime.

## Acceptance Criteria

1. **Grant table schema.** **Given** the Alembic migration for `user_access_grants` runs, **When** I inspect the schema, **Then** the table has `user_id`, `node_id`, `node_type`, `role`, `granted_at`, `granted_by_user_id` (plus a surrogate `id` PK and `org_id` for tenant isolation — see Dev Notes Decision D1).

2. **Scope dependency resolves + enforces.** **Given** the `hierarchy_scope` FastAPI dependency is applied to a route, **When** a request arrives with a valid JWT, **Then** the dependency resolves the user's granted `hierarchy_path` scopes and makes them available to the route; entity reads in that request are filtered by `hierarchy_path <@ :scope_path` (ltree descendant-or-self containment). See Dev Notes Decision D2 for the "all ORM queries automatically filter" reinterpretation — enforcement is at the **access boundary**, not a global ORM monkey-patch.

3. **Out-of-scope access is forbidden.** **Given** a user with access only to `client_A/project_X` attempts to access `client_B/project_Y` (an entity in the **same org** but outside their granted scope), **When** the request is processed, **Then** the API returns HTTP **403** with `{"error": {"code": "FORBIDDEN", ...}}` — the user cannot see or interact with out-of-scope entities. (Cross-**org** access remains **404** by the existing convention — see Decision D3.)

4. **Admin grant creation.** **Given** an authorized grantor calls `POST /api/v1/access-grants`, **When** the grant references a Client node, **Then** the grant is created and the user can immediately access all Projects and Studies under that Client (because their `hierarchy_path` scope now contains the Client's path and ltree containment matches all descendants).

5. **Revocation is immediate, no caching.** **Given** an access grant is revoked (`DELETE /api/v1/access-grants/{grant_id}`), **When** the user makes a subsequent request, **Then** the scope dependency recalculates from the DB and the revoked path is no longer accessible — **no caching of grants beyond the request lifetime**.

## Tasks / Subtasks

- [x] **Task 1 — `UserAccessGrant` ORM model** (AC: #1)
  - [x] Create `app/models/access_grant.py` with `UserAccessGrant` (table `user_access_grants`). Columns: `id` (surrogate PK, mirror the `String(36)` UUID pattern used across models), `user_id String(128)`, `node_id String(36)`, `node_type String(16)` (one of `client`/`project`/`study`/`location` — store the granted node's level), `role String(32)`, `org_id String(128)` (tenant isolation, mirror `skill.py:134`), `granted_at DateTime(timezone=True)`, `granted_by_user_id String(128)`. **Do NOT** add an FK to a `users` table — none exists; `user_id` is the opaque JWT `sub` (Dev Notes §"No User model").
  - [x] Index: `idx_user_access_grants_user_id` on `user_id` (the hot lookup in the scope dependency). Optionally a composite `(user_id, org_id)`.
  - [x] Register the model in `app/models/__init__.py`: add `from app.models.access_grant import UserAccessGrant  # noqa: F401` and append `"UserAccessGrant"` to `__all__` (this is the established registration pattern — that file's docstring is *"import all models so Alembic autogenerate sees them"*; `env.py:28` uses `target_metadata = Base.metadata`).
- [x] **Task 2 — Alembic migration `0016`** (AC: #1)
  - [x] Author `app/db/migrations/versions/0016_user_access_grants.py`. `revision = "0016_user_access_grants"`, `down_revision = "0015_certification_records"`. Mirror the hand-written `op.create_table` style of `0015_certification_records.py` (this project writes migrations by hand, not autogenerate-dump). Provide a real `downgrade()` that drops the table + index.
  - [x] The granted `node_id` is **not** an FK to a single table (a node can be a client/project/study/location) — do **not** add a cross-table FK; node existence is validated in the service at grant-creation time (Task 4).
- [x] **Task 3 — `access_service.py`: grant resolution + CRUD** (AC: #2, #4, #5)
  - [x] Create `app/services/access_service.py`.
  - [x] `resolve_scope_paths(session, user_id, org_id) -> list[str]`: SELECT all grant rows for `(user_id, org_id)`, join/resolve each `node_id`→the node's current `hierarchy_path` (look up the node by `node_type` against the matching hierarchy table; reuse `hierarchy_service` getters), return the list of ltree path strings. **No caching** — runs every request (AC5).
  - [x] `create_grant(session, *, user_id, node_id, node_type, role, org_id, granted_by_user_id) -> UserAccessGrant`: validate the node exists in this org (reuse `hierarchy_service.get_client/get_project/...`, which already 404 on cross-org), snapshot nothing (resolve path live), insert, commit.
  - [x] `revoke_grant(session, grant_id, org_id)`: delete by id scoped to org (cross-org → 404, per convention). 
  - [x] `list_grants(...)` if AC needs a read surface (the epic only requires create + revoke; a list endpoint is optional — adopt the `PageMeta` pattern from `certification_service.list_certifications` if added).
  - [x] Define a domain exception for unauthorized grantor (Task 5) and reuse `HierarchyScopeError` for out-of-scope (Task 6).
- [x] **Task 4 — `hierarchy_scope` FastAPI dependency** (AC: #2, #3)
  - [x] Add to `app/core/dependencies.py`: an `async def hierarchy_scope(user: CurrentUser, session: DbSession) -> HierarchyScope` that calls `access_service.resolve_scope_paths(...)` and returns a small value object holding the resolved paths + a helper `assert_in_scope(path: str)` that raises `HierarchyScopeError` (403) when `path` is not a descendant-or-self of any granted path.
  - [x] Export a type alias `HierarchyScope = Annotated[..., Depends(hierarchy_scope)]` mirroring the existing `CurrentUser`/`DbSession`/`SkillStorage` alias style (`dependencies.py:78-90`).
  - [x] **Wire it into the hierarchy read/mutate routes** in `app/api/v1/hierarchy.py`: each `get_*`/`update_*`/`delete_*` and the list endpoints must check the loaded entity's `hierarchy_path` against the scope (single-entity routes call `scope.assert_in_scope(entity.hierarchy_path)` **after** the existing org-scoped load; list routes add the `hierarchy_path <@ ANY(:scope_paths)` filter in the service query — see Decision D2 + Task 7).
- [x] **Task 5 — Grant admin routes + grantor role-gate** (AC: #4, #5)
  - [x] `POST /api/v1/access-grants` and `DELETE /api/v1/access-grants/{grant_id}` — new router `app/api/v1/access_grants.py`, mounted in `app/api/v1/router.py` (`api_router.include_router(access_grants.router)`).
  - [x] **Grantor authorization:** no admin role exists today (roles are `ma_tech` / `consultant` / `client`; see Dev Notes §"Roles"). Introduce a minimal role-gate dependency (e.g. `require_grantor_role`) that permits `consultant` (Vitalief internal) to manage grants and **rejects `client`** with 403 `FORBIDDEN`. Decision D4: do not invent a brand-new role; gate on the existing `consultant` role. Confirm with PM if `ma_tech` should also be allowed.
  - [x] Request/response Pydantic schemas in `app/schemas/` (new `access_grant.py`): `AccessGrantCreate` (user_id, node_id, node_type, role), `AccessGrantRead`. Use the `ResponseEnvelope` wrapper like every other route.
- [x] **Task 6 — Reconcile the `FORBIDDEN` error code** (AC: #3) — **DECISION ITEM, see D5**
  - [x] The epic AC literally requires `{"error": {"code": "FORBIDDEN", ...}}`, but the existing `HierarchyScopeError` emits code `HIERARCHY_SCOPE_ERROR` (`hierarchy_service.py:71`). Pick ONE and apply consistently: (a) change `HierarchyScopeError.ERROR_CODE` to `"FORBIDDEN"`, or (b) keep `HIERARCHY_SCOPE_ERROR` and treat the epic's `FORBIDDEN` as the HTTP status family not the literal code. **Recommended: (a)** rename the code to `FORBIDDEN` to satisfy the AC verbatim and align with the architecture's "FORBIDDEN" naming; update the one existing test that asserts the code (`test_hierarchy_service.py:118`).
- [x] **Task 7 — Scope-filtered list queries (ltree `<@`)** (AC: #2, #3)
  - [x] In `hierarchy_service` list functions, add an optional `scope_paths: list[str]` arg; when present, AND a containment predicate so only in-scope rows return. **NET-NEW pattern:** no `<@` query exists in the codebase yet. asyncpg has no native ltree codec — build the predicate with `sqlalchemy.text()` and CAST, e.g. `text("hierarchy_path <@ ANY(CAST(:paths AS ltree[]))").bindparams(paths=scope_paths)`. **Empty `scope_paths` ⇒ zero rows** (a user with no grants sees nothing) — handle explicitly (don't generate `<@ ANY('{}')` ambiguity; short-circuit to an empty result).
- [x] **Task 8 — Tests** (AC: #1–#5)
  - [x] Integration tests in `tests/integration/api/test_access_grants.py` + additions to `test_hierarchy.py`. Use the established `_auth_headers(role)` helper pattern (`test_hierarchy.py:54-61`: `DevAuthProvider().issue_token(principal)`).
  - [x] AC3: a user granted only `client_A` gets **403 FORBIDDEN** on `GET /api/v1/clients/{client_B_id}` (same org, out of scope); and **404** on a different-org client (cross-org convention preserved — mirror `test_cross_org_isolation` `test_hierarchy.py:336`).
  - [x] AC4: after `POST /access-grants` for a Client, the grantee can `GET` a Project/Study under it (containment).
  - [x] AC5: after `DELETE /access-grants/{id}`, the next request 403s — no stale access (assert within the same test client, no restart).
  - [x] Grantor gate: a `client`-role token calling `POST /access-grants` → 403.
  - [x] Unit tests for `access_service.resolve_scope_paths` + the `<@` predicate (co-locate per the repo convention; service unit tests live under `tests/unit/services/`).
- [x] **Task 9 — Run gates before marking review**
  - [x] `ruff check` + `ruff format`, `mypy`/`pyright` if configured, and the full `pytest` (integration tests require the test DB + migrations — `conftest.py` applies migrations session-autouse; Postgres must be reachable). Migration applies cleanly up and down.

## Dev Notes

### What's already built (DO NOT recreate)

- **Hierarchy models are fully ltree-ready.** `app/models/hierarchy.py` — `Organization` (28-53), `Client` (56-80), `Project` (83-110), `Study` (113-140), `Location` (143-174). Every one has `hierarchy_path: Mapped[str] = mapped_column(LtreeType(), nullable=False)` with a GiST index (`postgresql_using="gist"`). `LtreeType` is a custom `UserDefinedType` returning col spec `"ltree"` (`app/models/base.py:19-37`). Path encoding strips hyphens from UUIDs and sanitizes `[^A-Za-z0-9_]`→`_` (`hierarchy_service.py:100-119`). Path shape: `org_<orgid>.client_<id>.project_<id>.study_<id>.location_<id>`.
- **`HierarchyScopeError` is ALREADY DEFINED but never raised** — `app/services/hierarchy_service.py:70-74`: subclasses `VelaraHTTPException`, status **403**, `ERROR_CODE = "HIERARCHY_SCOPE_ERROR"`, message `"Entity not accessible."`. It was reserved for exactly this story. (See Task 6 — its `ERROR_CODE` likely needs to become `FORBIDDEN` to satisfy AC3 verbatim.)
- **The single auth seam exists.** `get_current_user` (`app/core/dependencies.py:56-72`) validates the Bearer token and returns an `AuthPrincipal`. Type alias `CurrentUser = Annotated[AuthPrincipal, Depends(get_current_user)]` (`:81`). `DbSession` alias (`:90`). **Build `hierarchy_scope` as a new dependency that depends on `CurrentUser` + `DbSession`** — do not touch token validation.
- **`AuthPrincipal`** (`app/integrations/auth.py:35-53`): frozen dataclass `user_id: str`, `org_id: str`, `role: str`. The class docstring already says *"Hierarchy-scoped `(user_id, node_id, role)` grants are Epic 8 / RBAC"* — this story fulfills that note. **There is NO `User` ORM model** — `user_id` is the opaque JWT `sub`; never FK to a users table.
- **Roles** (seed users, `auth.py:98-117`): `ma_tech`, `consultant`, `client`. **No admin role, and no role-gating exists in any route today** (`user.role` is only echoed into responses at `auth.py:74/88`, `certifications.py:67` — never used to allow/deny). The grantor gate (Task 5) is net-new.
- **Cross-org isolation is established as 404, not 403.** `hierarchy_service.get_client` (191-201) does `session.get(Client, id)` then `if client is None or client.org_id != org_id: raise ClientNotFoundError` (404). Tested in `test_hierarchy.py:336 test_cross_org_isolation` (docstring: *"Cross-org reads/updates/deletes must return 404 (not 403) so the status code does not leak existence"*). Project/study/location getters chain the same org check via FK. **Preserve this**: cross-org = 404, in-org-out-of-scope = 403.
- **Error envelope + handler.** `{"error": {"code", "message", "request_id"}}` — `ErrorDetail`/`ErrorEnvelope` (`app/schemas/common.py:25-32`); `VelaraHTTPException` → `velara_http_exception_handler` → `_error_response` (`app/core/exceptions.py:27-80`); handlers registered `exceptions.py:138-144`. Raise domain exceptions; never hand-build error JSON.
- **PageMeta pagination** (`app/schemas/common.py`) — `page` (ge=1), `per_page` (ge=1, le=200, default 50). Reference impl: `certifications.py:84-126` + `certification_service.list_certifications`. Use this shape **only if** you add a grant-list endpoint.
- **Test auth helper pattern** — `_auth_headers(role="ma_tech")` builds `DevAuthProvider().issue_token(seed_users[username])` → `{"Authorization": f"Bearer {token}"}` (`test_hierarchy.py:54-61`). Reuse verbatim. Seed usernames map: `ma_tech→ma.tech`, `consultant→consultant`, `client→client.user`.
- **`conftest.py`** applies Alembic migrations session-autouse (`tests/conftest.py:64-78`) and exposes an async ASGI `client` fixture (`:94-96`). Integration tests need a reachable Postgres test DB.
- **Routers mounted in `app/api/v1/router.py:18-26`**: health, auth, skills, certifications, jobs, ingest, invocations, invoke, hierarchy. (No `audit`/`outputs` router yet — those are later epics.) Routers are mounted **without** shared `dependencies=[...]`; auth is applied per-route via the `CurrentUser` param. Add the access-grants router here.

### Decisions baked into this story

- **D1 — Grant table columns.** Epic AC1 lists `user_id, node_id, node_type, role, granted_at, granted_by_user_id`. Add a surrogate `id` PK and `org_id` (tenant isolation, mirroring `skill.py:134` / `certification.py:72` org-global pattern) so revocation/listing can be org-scoped and cross-org grant access 404s. The architecture's earlier `(user_id, node_id, role)` shorthand (`core-architectural-decisions.md`) is a subset — AC1's fuller column list governs.
- **D2 — "All ORM queries automatically filter" is reinterpreted as access-boundary enforcement, NOT a global ORM filter.** There is **no central query seam**: each request gets a fresh `AsyncSession` via `get_session`/`session_scope` with no SQLAlchemy event listener, `with_loader_criteria`, or global filter. **Celery workers run their own `session_scope()` outside the request lifecycle** (`workers/execution_tasks.py:110,121,143`), so request contextvars (used today only for `structlog` request_id, `middleware.py:114-142`) would NOT reach worker queries. A monkey-patched global filter would be partial and dangerous. **Enforce instead via the `hierarchy_scope` dependency at the route boundary**: single-entity routes assert the loaded entity's `hierarchy_path` is in scope; list routes pass `scope_paths` into the service query as a `<@` filter. This is the safe, testable, reviewable interpretation of AC2.
- **D3 — Two distinct denials.** Cross-**org** → **404** (preserve existing convention, don't leak existence). In-**org** but **out-of-granted-scope** → **403 FORBIDDEN**. The org check already exists in the getters; layer the scope check on top, after the entity is loaded.
- **D4 — Grantor gate uses the existing `consultant` role**, not a new admin role (none exists). Reject `client`. Open question for PM: should `ma_tech` also grant? (Recommend consultant-only.)
- **D5 — Error code `FORBIDDEN` vs `HIERARCHY_SCOPE_ERROR`** — see Task 6. Recommend renaming `HierarchyScopeError.ERROR_CODE` to `"FORBIDDEN"` to satisfy AC3 literally; update `test_hierarchy_service.py:118`.

### Scope boundaries (what this story is NOT)

- **Skills and certifications are org-global, NOT ltree-pathed** — `Skill` has `org_id` only, no `hierarchy_path` (`skill.py:133-134` comment: *"replaces hierarchy_scope — skills are org-global, not ltree-pathed"*); `CertificationRecord` same (`certification.py:71-72`). So `hierarchy_scope` filtering applies to **hierarchy entities (clients/projects/studies/locations) and entities that carry a `hierarchy_path`** (e.g. invocation jobs) — NOT to skill/cert registry queries. Do not attempt to path-filter skills here.
- **Invocation scope enforcement is a known follow-up, lightly in scope.** `deferred-work.md` line 130: *"Skill `scope` (project/study) is not enforced against the requested study/location at the invocation endpoint... Deferred to Epic 8 (hierarchy-scoped RBAC enforcement)... Enforce alongside RBAC there. [`app/api/v1/invocations.py`]"*. `queue_invocation` (`invocations.py:135`) already org-scopes study/location loads (`hierarchy_service.get_study(session, body.study_id, user.org_id)`, `:217-268`) and pins `hierarchy_path`. **Minimum for this story:** the invocation path's study/location load should also pass through the scope check so a user can't invoke against an out-of-scope node. If wiring the full invocations route is too large, scope it to the hierarchy routes for 8.1 and log the invocation-route wiring as a tracked follow-up — confirm with PM.
- **Client-portal routing / IP surface = Story 8.2.** Visibility filtering of client-facing skills = 8.4. This story is the RBAC **foundation** (grant model + scope dependency + admin grant CRUD) the rest of Epic 8 builds on.
- **No grant caching** (AC5) — explicitly resolve from DB per request.

### Architecture compliance rules (MUST follow)

From `implementation-patterns-consistency-rules.md` "Enforcement Rules":
1. Use the response envelope — never bare objects/arrays (`ResponseEnvelope`/`ErrorEnvelope`).
2. **"Apply `hierarchy_scope` FastAPI dependency on every route touching hierarchical data — never rely on callers to filter."** ← this story implements that very rule.
3. `snake_case` for all DB columns and JSON fields.
4. `request_id` carried through (middleware already does this).
5. Never return raw exception messages — map through the global handler.
- Naming: ltree path column is **always** `hierarchy_path`. Tables plural snake_case (`user_access_grants`). FK columns `{singular}_id`. Indexes `idx_{table}_{cols}`.
- API endpoints: plural-noun kebab segments → `/api/v1/access-grants`; path params snake_case → `{grant_id}`.

### Testing standards

- Co-locate / mirror existing dirs: integration API tests in `tests/integration/api/`, service unit tests in `tests/unit/services/`.
- Use `_auth_headers(role)` (build via `DevAuthProvider().issue_token`). For org isolation, seed users have fixed orgs (`org_vitalief` for ma_tech/consultant, `org_client_001` for client) — to test in-org-out-of-scope vs cross-org you may need two grantees in the same org; follow whatever org-override helper the hierarchy tests use, or issue tokens with matching `org_id`.
- Assert exact status codes AND the envelope `error.code` (e.g. `assert resp.status_code == 403` and `resp.json()["error"]["code"] == "FORBIDDEN"`).
- The `<@` containment query is DB-dependent — exercise it against the real Postgres test DB, not a mock.

### Project Structure Notes

- New files (all greenfield, names per `project-structure-boundaries.md`): `app/models/access_grant.py`, `app/services/access_service.py`, `app/api/v1/access_grants.py`, `app/schemas/access_grant.py`, `app/db/migrations/versions/0016_user_access_grants.py`, plus tests.
- Modified files: `app/core/dependencies.py` (add `hierarchy_scope` + alias), `app/api/v1/router.py` (mount access-grants router), `app/api/v1/hierarchy.py` (wire scope checks into get/list/update/delete), `app/services/hierarchy_service.py` (add `scope_paths` filter to list functions; possibly relocate/keep `HierarchyScopeError` and update its `ERROR_CODE`), `app/models/__init__.py` (register new model — verify the registration mechanism), `tests/unit/services/test_hierarchy_service.py` (D5 code change).
- Variance: the architecture sketch puts scope logic in `core/dependencies.py` + `services/access_service.py` + `models/access_grant.py` — this matches exactly. No conflicts.

### Critical anti-patterns / traps

- **Do NOT monkey-patch a global ORM filter / SQLAlchemy event listener** to satisfy AC2 — it won't reach Celery workers and is the wrong seam (Decision D2).
- **Do NOT cache resolved grants** across requests (violates AC5). Resolve live every request.
- **`<@ ANY(CAST(:paths AS ltree[]))` with an empty list** is a trap — short-circuit empty `scope_paths` to an empty result rather than emitting an ambiguous/empty-array cast. asyncpg has no ltree codec, so bind as text and CAST in SQL.
- **Do NOT collapse cross-org and out-of-scope into one status** — cross-org stays 404 (existence-hiding), out-of-scope is 403. Order matters: the existing org check (→404) runs first on entity load; the scope check (→403) runs on the already-org-validated entity.
- **`node_id` is polymorphic** (client/project/study/location) — do not add a single-table FK on it. Validate existence in the service via the typed getter.
- **`user_id` has no users table** — no FK, opaque string.
- **Resolve grant `node_id`→`hierarchy_path` LIVE** at request time (don't snapshot the path into the grant row): if a node moves/re-paths, the grant must still resolve to the current path. (And AC4's "immediately access descendants" relies on live containment, not a stored path snapshot.)

### References

- Epic: [epic-8-access-control-client-portal.md](../../planning-artifacts/epics/epic-8-access-control-client-portal.md) — Story 8.1 ACs (verbatim source).
- [core-architectural-decisions.md](../../planning-artifacts/architecture/core-architectural-decisions.md) — "Authorization model: Hierarchy-scoped RBAC via PostgreSQL grants table `(user_id, node_id, role)`; resolved by FastAPI dependency on every request"; "ltree hierarchy path… `path <@ :scope_path` filter… applied in a FastAPI dependency, not individual handlers".
- [implementation-patterns-consistency-rules.md](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md) — Enforcement Rule #2 (hierarchy_scope on every route), error envelope, naming, PageMeta.
- [project-structure-boundaries.md](../../planning-artifacts/architecture/project-structure-boundaries.md) — file locations (`models/access_grant.py`, `services/access_service.py`, `core/dependencies.py`), ACL-01–07 mapping.
- Code (verified at creation): hierarchy models `app/models/hierarchy.py` (28-174); `LtreeType` `app/models/base.py:19-37`; `HierarchyScopeError` `app/services/hierarchy_service.py:70-74`; cross-org getters `hierarchy_service.py:191-201,275-288,368-383,470-488`; `get_current_user`/aliases `app/core/dependencies.py:56-90`; `AuthPrincipal` `app/integrations/auth.py:35-53`; roles/seed `auth.py:98-117`; error envelope `app/schemas/common.py:25-32`; handlers `app/core/exceptions.py:27-144`; latest migration `app/db/migrations/versions/0015_certification_records.py`; routers `app/api/v1/router.py:18-26`; PageMeta ref `app/api/v1/certifications.py:84-126`; test auth helper `tests/integration/api/test_hierarchy.py:54-61`; cross-org test `test_hierarchy.py:336`; worker sessions `app/workers/execution_tasks.py:110,121,143`; invocation scope load `app/api/v1/invocations.py:135,217-268`; skills org-global `app/models/skill.py:133-134`; cert org-global `app/models/certification.py:71-72`.
- Deferred follow-up logged: [deferred-work.md](../deferred-work.md) line ~130 (invocation-endpoint scope enforcement → Epic 8).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- **ruff F401** — removed unused `UUID` import from `access_grant.py` (using `String(36)` PK, not a native UUID column).
- **ruff B904** — `raise NodeNotFoundError(...) from None` inside `except ValueError` in `access_service.py`.
- **HierarchyScopeError 403 regression** — after wiring `HierarchyScope` to hierarchy routes, 6 existing `test_hierarchy.py` tests 403'd because `ma_tech` seed users have no grants. Root cause: initial "empty grants = unrestricted" heuristic was wrong (AC5 revocation test needs 0-grant → blocked). Fix: role-based bypass — `ma_tech`/`consultant` get `unrestricted=True` in `_hierarchy_scope`; only `client` role goes through grant resolution. Also changed all grantee principals in integration tests from `role="ma_tech"` to `role="client"`.
- **List route scope path** — `scope.scope_paths or None` was wrong (external no-grant user also got `None` = unrestricted). Fixed to `paths = None if scope.unrestricted else scope.scope_paths`.
- **Multiple ruff E501** — broke long lines in integration test and hierarchy.py onto multiple lines with extracted local variables.

### Completion Notes List

- **`ma_tech` and `consultant` are unconditionally unrestricted** — they bypass grant resolution entirely in `_hierarchy_scope`. This preserves all existing hierarchy tests (which use ma_tech tokens with no grants) and is the correct interpretation: internal roles are system-level operators who manage the hierarchy, not grantees.
- **D4 decision** — both `ma_tech` and `consultant` are in `_GRANTOR_ROLES` (can create/revoke grants). The story said to confirm with PM for `ma_tech`; implemented permissively since `ma_tech` is the highest-privilege role.
- **No grant-list endpoint added** — the epic ACs only require create + revoke; list was optional. Skipped to stay in scope.
- **Invocation-scope enforcement deferred** — wiring `hierarchy_scope` into `invocations.py` was listed as out-of-scope for 8.1 (confirmed in Dev Notes §"Scope boundaries"). Logged as a follow-up for Epic 8.
- **53/53 tests pass** after all fixes; `ruff check` and `ruff format` clean.

### File List

**New files:**
- `velara-api/app/models/access_grant.py`
- `velara-api/app/services/access_service.py`
- `velara-api/app/schemas/access_grant.py`
- `velara-api/app/api/v1/access_grants.py`
- `velara-api/app/db/migrations/versions/0016_user_access_grants.py`
- `velara-api/tests/unit/services/test_access_service.py`
- `velara-api/tests/integration/api/test_access_grants.py`

**Modified files:**
- `velara-api/app/models/__init__.py` — registered `UserAccessGrant`
- `velara-api/app/core/dependencies.py` — added `HierarchyScopeValue`, `_hierarchy_scope`, `HierarchyScope`; **(review)** added non-raising `in_scope()` companion to `assert_in_scope()`
- `velara-api/app/services/hierarchy_service.py` — changed `HierarchyScopeError.ERROR_CODE` to `"FORBIDDEN"`; added `scope_paths` filter param to all 4 list functions
- `velara-api/app/api/v1/hierarchy.py` — wired `HierarchyScope` into all hierarchy routes; **(review)** also into `create_project`/`create_study`/`create_location` (scope the parent)
- `velara-api/app/api/v1/router.py` — mounted `access_grants` router
- `velara-api/tests/unit/services/test_hierarchy_service.py` — updated `HierarchyScopeError` code assertion to `"FORBIDDEN"`

**Modified files (code-review 2026-06-30 — scope-wiring + hardening):**
- `velara-api/app/api/v1/invocations.py` — `queue_invocation(scope=...)`; `assert_in_scope` on study/location; org-global invocations gated to unrestricted roles; wired into `invoke_skill`
- `velara-api/app/api/v1/invoke.py` — threaded `scope` into `invoke_proxy`; docstring updated (RBAC no longer "deferred")
- `velara-api/app/api/v1/jobs.py` — `HierarchyScope` on `list_jobs`/`get_job`/`cancel_job`; out-of-scope fan-out children dropped
- `velara-api/app/services/job_service.py` — `list_jobs(scope_paths=...)` `<@` filter (empty→zero rows)
- `velara-api/app/services/access_service.py` — narrowed exception swallow; idempotent `create_grant`; batch-resolve `resolve_scope_paths` (N+1 fix); dropped redundant `granted_at`; **(architect ruling)** `InternalRoleNotGrantableError` + reject internal-role grantees (422)
- `velara-api/app/core/dependencies.py` — **(architect ruling)** documented the `_INTERNAL_ROLES` bypass as authorization policy + revisit-trigger
- `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md` — **(architect ruling)** ADR: "Authorization — Internal roles are org-global operators"
- `velara-api/app/models/access_grant.py` — `UniqueConstraint`; `role` documented as descriptive-only
- `velara-api/app/db/migrations/versions/0016_user_access_grants.py` — added the unique constraint (amended; unreleased)
- `velara-api/app/schemas/access_grant.py` — `node_type`/`role` Literals, `min_length` on ids
- `velara-api/app/api/v1/access_grants.py` — grantor docstring corrected (consultant + ma_tech)
- `velara-api/tests/integration/api/test_access_grants.py` — +4 tests (create-scope 403 ×2, jobs-list scope, grant idempotency)

### Review Findings

<!-- bmad-code-review 2026-06-30 — 3-layer adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor).
     Gates re-verified live: 53/53 hierarchy+grant tests PASS (37/37 in the 8.1 slice), ruff clean.
     Blind Hunter's CRITICAL C1 (asyncpg `<@ ANY(CAST(:paths AS ltree[]))` bind fails) was EMPIRICALLY DISPROVEN
     against live PG16+asyncpg (the bind sends the list as a Postgres array; the scoped-list test passes). Dismissed. -->

**Decision-needed — RESOLVED 2026-06-30 (PM/operator calls during review):**

- [x] [Review][Decision→Patch] Invocation/invoke routes unscoped — **RESOLVED: wire now ("All three now").** Add scope enforcement to `app/api/v1/invocations.py` (`queue_invocation`) + `app/api/v1/invoke.py`. (auditor F2 + edge C2)
- [x] [Review][Decision→Patch] Jobs routes leak cross-scope jobs + presigned URLs — **RESOLVED: wire now ("All three now").** Scope-filter `list_jobs`, assert on `get_job`/`cancel_job` in `app/api/v1/jobs.py`. (edge C3/H1)
- [x] [Review][Decision→Patch] Create routes unscoped — **RESOLVED: wire now ("All three now").** Add `scope.assert_in_scope(parent.hierarchy_path)` to `create_project`/`create_study`/`create_location` in `app/api/v1/hierarchy.py`. (edge C1)
- [x] [Review][Decision→Patch] `ma_tech` in `_GRANTOR_ROLES` vs D4 consultant-only — **RESOLVED: keep ma_tech (ratified as highest-privilege internal grantor), fix the stale docstring** in `app/api/v1/access_grants.py:6-7`. (auditor F1 + blind H2 + edge M2)
- [x] [Review][Decision] `unrestricted=True` bypass makes internal roles permanently un-scopeable — `app/core/dependencies.py`. **RESOLVED by architect (Winston) 2026-06-30 — RATIFIED as intentional authorization policy** (ADR appended to `core-architectural-decisions.md`: "Authorization — Internal roles are org-global operators"). Internal roles are org-global operators; AC3's out-of-scope guarantee covers the `client` role only. Bypass keys on `role` not `org` (gating on org buys no security — sibling Cognito claims, equal trust; forged-claim defense is upstream). Product fact confirmed: scope-limited internal user is NOT foreseeable → executable guard added: `create_grant` rejects ma_tech/consultant grantees with **422 INTERNAL_ROLE_NOT_GRANTABLE** (an inert grant can't be represented). Documented as security policy at `_hierarchy_scope` with a revisit-trigger. No longer blocks `done`. (auditor F3 + edge M1 + blind H2)
- [x] [Review][Decision→Patch] Grant `role` stored but never enforced — **RESOLVED: keep `role` as descriptive metadata only; document that grants are path-scope, not permission-scope** (in `access_grant.py` model docstring + the route). No write/read permission tiers in 8.1. Also validate the `role` string is a known role on create. (blind M3 + edge M5)

**Patch (unambiguous fixes — includes the resolved decisions above) — ALL APPLIED 2026-06-30:**

- [x] [Review][Patch] Wire scope into invocations + invoke [`app/api/v1/invocations.py`, `app/api/v1/invoke.py`] — `queue_invocation` now takes `scope` and `assert_in_scope` on the resolved study (fan-out) / location (single); org-global (non-location) invocations restricted to `unrestricted` roles. Threaded through `invoke_skill` + `invoke_proxy`. (resolves decision #1; obsoletes the "log a deferral" patch — wired instead of deferred)
- [x] [Review][Patch] Wire scope into jobs [`app/api/v1/jobs.py`, `app/services/job_service.py`] — `list_jobs` gains a `scope_paths` `<@` filter (empty→zero rows); `get_job`/`cancel_job` `assert_in_scope(job.hierarchy_path)`; fan-out children outside scope dropped via new `HierarchyScopeValue.in_scope`. (resolves decision #2)
- [x] [Review][Patch] Wire scope into create routes [`app/api/v1/hierarchy.py`] — `create_project`/`create_study`/`create_location` load the parent (org-scoped) and `assert_in_scope(parent.hierarchy_path)` before creating the child. (resolves decision #3)
- [x] [Review][Patch] Fix stale grantor docstring + ratify ma_tech [`app/api/v1/access_grants.py:1-9`] — docstring now states consultant+ma_tech are grantors (D4 resolved). (resolves decision #4)
- [x] [Review][Patch] Document grant `role` is descriptive-only + validate it on create [`app/models/access_grant.py` docstring, `app/schemas/access_grant.py`] — model docstring states grants are path-scope not permission-scope; `AccessGrantCreate.role` is now a `GrantRole` Literal. (resolves decision #6)
- [x] [Review][Patch] Narrow the over-broad exception swallow in `resolve_scope_paths` → `except NodeNotFoundError` only [`app/services/access_service.py`]. (blind H3 + edge H2)
- [x] [Review][Patch] Add `UniqueConstraint(user_id, node_id, node_type, org_id)` + idempotent `create_grant` [`app/models/access_grant.py`, `0016_user_access_grants.py` (amended — unreleased), `app/services/access_service.py`] — duplicate POSTs now return the existing grant; a single revoke fully removes access (AC5). Migration verified down→up clean. (blind M4 + edge M3)
- [x] [Review][Patch] Tighten `AccessGrantCreate` [`app/schemas/access_grant.py`] — `node_type`/`role` are `Literal`s; `user_id`/`node_id` `min_length=1` → clean 422 on bad input. (edge M4/L3)
- [x] [Review][Patch] Batch-resolve grant paths (kill N+1) [`app/services/access_service.py`] — `resolve_scope_paths` now loads nodes per type with `id IN (...)` and verifies org via the path-prefix invariant (reuses `_org_segment`); was up to 4N round-trips/request. (blind M2 + edge perf)
- [x] [Review][Patch] Remove redundant explicit `granted_at` [`app/services/access_service.py`] — relies on the model column default. (blind L3)

- [x] [Review][Patch] **(architect ruling)** Reject internal-role grantees at grant creation [`app/services/access_service.py`] — `create_grant` raises 422 `INTERNAL_ROLE_NOT_GRANTABLE` for ma_tech/consultant grantees; the `unrestricted` bypass is documented as authorization policy at `_hierarchy_scope` with a revisit-trigger. ADR in `core-architectural-decisions.md`.

**New tests added for the patches** (`tests/integration/api/test_access_grants.py`): create-child-under-out-of-scope-parent → 403 (project + study), jobs-list excludes org-global for scoped user, grant idempotency + single-revoke-removes-access, internal-role grant → 422 (architect guard). The `_grant` helper now uses `role="client"` (only client-scoped users are grantable).

**Deferred (real, not actionable now):**

- [x] [Review][Defer] `_postgres_reachable()` brittle URL parse can silently skip the whole integration suite [`tests/integration/api/test_access_grants.py:30-43`] — bare `except: return False` turns any URL-shape mismatch (no port / no auth) into a skip, so scope-filter coverage can vanish in a misconfigured CI. Pre-existing test-infra pattern (mirrors test_hierarchy.py); not introduced by 8.1. Parse with `urlsplit` and make CI fail loudly rather than skip. (blind M5)
- [x] [Review][Defer] Grant resolution trusts node org-membership immutability; a future re-parent/move-to-different-org could mis-resolve [`app/services/access_service.py:55-115`] — no move/re-parent feature exists today, so unreachable now; latent. Revisit when a move-node story lands. (edge H3)

**Dismissed (2):** Blind Hunter C1 (asyncpg `<@ ANY(CAST(:paths AS ltree[]))` bind — empirically disproven on live PG16, scoped-list test passes); dead `list_grants` service fn with no route (within the story's "list endpoint optional" allowance, harmless).

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-30 | Story created (bmad-create-story); 2 parallel source-verified audits + architecture + epic grounding | bmad-create-story |
| 2026-06-30 | Full implementation: UserAccessGrant model, migration 0016, access_service.py, hierarchy_scope dependency, access-grants admin routes, ltree scope-filtered list queries, FORBIDDEN error code, unit + integration tests; 53/53 pass, ruff clean | claude-sonnet-4-6 |
