---
baseline_commit: 9fee700f12599643f1259fea0b956c22ca9fd7e0
---

# Story 4.1: Hierarchy Data Model & API

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform developer,
I want the hierarchy data model (Organization, Client, Project, Study, Location) with ltree paths and full CRUD API,
so that all subsequent features have a consistent, scope-enforceable foundation for every entity in the platform.

## Acceptance Criteria

> **BDD source:** [epic-4-engagement-hierarchy-management.md#story-41](../../planning-artifacts/epics/epic-4-engagement-hierarchy-management.md). **FR source:** ORG-01–ORG-07 (organizational hierarchy, hierarchy path queries, CRUD). **Architecture:** core-architectural-decisions.md (Data Architecture, ltree path), project-structure-boundaries.md (hierarchy.py files).

1. **Migration creates all 5 tables.**
   **Given** Alembic migration `0011_hierarchy.py` runs
   **When** I inspect the database schema
   **Then** tables `organizations`, `clients`, `projects`, `studies`, `locations` all exist — each with `id` (UUID PK), `name`, `description`, `created_at`, `updated_at`, and a `hierarchy_path` ltree column

2. **POST /api/v1/clients creates client with correct ltree path.**
   **Given** I call `POST /api/v1/clients` with valid `name` and `description`
   **When** the client is created
   **Then** HTTP 201 is returned, the response envelope contains the client with `hierarchy_path` of `org_{org_id}.client_{client_id}`, and the record is persisted in the `clients` table

3. **POST /api/v1/projects creates project under a client.**
   **Given** I call `POST /api/v1/projects` with a valid `client_id`
   **When** the project is created
   **Then** HTTP 201 is returned, `hierarchy_path` is `org_{org_id}.client_{client_id}.project_{project_id}`

4. **POST /api/v1/studies creates study under a project.**
   **Given** I call `POST /api/v1/studies` with a valid `project_id`
   **When** the study is created
   **Then** HTTP 201 is returned, `hierarchy_path` is `org_{org_id}.client_{client_id}.project_{project_id}.study_{study_id}`

5. **POST /api/v1/locations requires postal_code.**
   **Given** I call `POST /api/v1/locations` under a study
   **When** the request includes `postal_code`
   **Then** HTTP 201 is returned; postal code is stored and returned in the response envelope
   **When** the request omits `postal_code`
   **Then** HTTP 422 is returned

6. **GET /api/v1/clients lists only org-scoped clients; Organization layer hidden.**
   **Given** I call `GET /api/v1/clients`
   **When** the response is returned
   **Then** only clients belonging to the authenticated user's `org_id` are listed — no `organization_id`, org label, or org entity appears in any response field

7. **DELETE with existing children returns 409 Conflict.**
   **Given** a Client, Project, or Study has child entities
   **When** I call `DELETE /api/v1/{resource}/{id}`
   **Then** HTTP 409 Conflict is returned with error code `HIERARCHY_HAS_CHILDREN` — cascading deletes are not permitted

## Tasks / Subtasks

- [x] **Task 1 — ORM models: `app/models/hierarchy.py` (AC: 1, 2, 3, 4, 5, 6)**
  - [x] Create `app/models/hierarchy.py` with 5 model classes: `Organization`, `Client`, `Project`, `Study`, `Location`
  - [x] Each model inherits from `Base` (from `app.models.base`), uses `mapped_column`, `UUID(as_uuid=True)` PK with `default=uuid.uuid4`, `String(255)` name (NOT NULL), `Text` description (nullable), `DateTime(timezone=True)` for `created_at`/`updated_at`, `LtreeType()` for `hierarchy_path` (NOT NULL)
  - [x] `Client` adds: `org_id: Mapped[str] = mapped_column(String(128), nullable=False)` — scoping field (no FK to organizations table needed for Phase 1; org identity comes from the JWT)
  - [x] `Project` adds: `client_id` FK → `clients.id` (UUID, NOT NULL, CASCADE delete blocked at service layer — see AC7)
  - [x] `Study` adds: `project_id` FK → `projects.id` (UUID, NOT NULL)
  - [x] `Location` adds: `study_id` FK → `studies.id` (UUID, NOT NULL); `postal_code: Mapped[str] = mapped_column(String(20), nullable=False)` — enforced NOT NULL at DB level; also add optional `address`, `city`, `pi_name` as `Text/String(255)`, nullable
  - [x] `Organization` model: `id`, `name`, `description`, `hierarchy_path` (`org_{id}`), `created_at`, `updated_at` — **not exposed in any API response** (architecture rule: org layer invisible to UI/API callers), but the table must exist for path integrity

- [x] **Task 2 — Alembic migration `0011_hierarchy.py` (AC: 1)**
  - [x] `revision = "0011_hierarchy"`, `down_revision = "0010_skill_requires"` (current head)
  - [x] Enable ltree extension first: `op.execute("CREATE EXTENSION IF NOT EXISTS ltree")`
  - [x] Create tables in dependency order: `organizations` → `clients` → `projects` → `studies` → `locations`
  - [x] All tables: UUID PK (postgresql.UUID), String(255) name NOT NULL, Text description nullable, `ltree` hierarchy_path NOT NULL (use `sa.Text()` column type with server-side ltree — the `LtreeType` is ORM-level; migration uses raw SQL type `"ltree"` via `sa.Column("hierarchy_path", sa.Text(), nullable=False)` and then cast in queries... **IMPORTANT**: use `sa.Column("hierarchy_path", sa.Text(), nullable=False)` in migration DDL — ltree is stored as text and the extension handles type coercion), DateTime(timezone=True) created_at/updated_at NOT NULL
  - [x] `clients` table: add `org_id VARCHAR(128) NOT NULL` + index `idx_clients_org_id`
  - [x] `projects` table: add `client_id UUID NOT NULL` FK → `clients.id`, index `idx_projects_client_id`
  - [x] `studies` table: add `project_id UUID NOT NULL` FK → `projects.id`, index `idx_studies_project_id`
  - [x] `locations` table: add `study_id UUID NOT NULL` FK → `studies.id`; add `postal_code VARCHAR(20) NOT NULL`; add nullable `address TEXT`, `city VARCHAR(255)`, `pi_name VARCHAR(255)`; index `idx_locations_study_id`
  - [x] Create GiST index on `hierarchy_path` for all tables: `op.execute("CREATE INDEX idx_clients_hierarchy_path ON clients USING gist (hierarchy_path)")` — repeat for all 5 tables
  - [x] Downgrade: drop tables in reverse order (locations → studies → projects → clients → organizations), drop extension only if no other users (use `IF EXISTS`)
  - [x] **Verify migration round-trip in Docker**: `alembic upgrade head` → `alembic downgrade -1` → `alembic upgrade head` (must pass clean)

- [x] **Task 3 — Pydantic schemas: `app/schemas/hierarchy.py` (AC: 2, 3, 4, 5, 6)**
  - [x] Create `app/schemas/hierarchy.py`
  - [x] Follow exact patterns from `app/schemas/skill.py`: `_MAX_NAME = 255`, `_MAX_DESCRIPTION` for Text, validators raising `ValueError` (→ 422)
  - [x] `ClientCreate(BaseModel)`: `name: str` (1–255 chars, stripped), `description: str | None = None`
  - [x] `ClientRead(BaseModel)`: `id: uuid.UUID`, `name: str`, `description: str | None`, `hierarchy_path: str`, `org_id: str`, `created_at: datetime`, `updated_at: datetime` — **no org entity, no org label**
  - [x] `ClientUpdate(BaseModel)`: `name: str | None = None`, `description: str | None = None` — at least one field required
  - [x] `ProjectCreate(BaseModel)`: `name: str`, `description: str | None = None`, `client_id: uuid.UUID`
  - [x] `ProjectRead(BaseModel)`: `id`, `name`, `description`, `hierarchy_path`, `client_id`, `created_at`, `updated_at`
  - [x] `ProjectUpdate(BaseModel)`: `name: str | None = None`, `description: str | None = None`
  - [x] `StudyCreate(BaseModel)`: `name`, `description | None`, `project_id: uuid.UUID`
  - [x] `StudyRead(BaseModel)`: `id`, `name`, `description`, `hierarchy_path`, `project_id`, `created_at`, `updated_at`
  - [x] `StudyUpdate(BaseModel)`: `name | None`, `description | None`
  - [x] `LocationCreate(BaseModel)`: `name`, `description | None`, `study_id: uuid.UUID`, `postal_code: str` (required, 1–20 chars, stripped), `address: str | None = None`, `city: str | None = None`, `pi_name: str | None = None`
  - [x] `LocationRead(BaseModel)`: all fields including `postal_code`, `address`, `city`, `pi_name`
  - [x] `LocationUpdate(BaseModel)`: all fields optional (name, description, postal_code, address, city, pi_name)
  - [x] All `*Read` schemas must use `model_config = ConfigDict(from_attributes=True)` for ORM compatibility

- [x] **Task 4 — Service layer: `app/services/hierarchy_service.py` (AC: 2, 3, 4, 5, 6, 7)**
  - [x] Create `app/services/hierarchy_service.py`
  - [x] Domain exception classes extending `VelaraHTTPException`:
    ```python
    class ClientNotFoundError(VelaraHTTPException):
        ERROR_CODE = "CLIENT_NOT_FOUND"
        def __init__(self, client_id): super().__init__(404, self.ERROR_CODE, f"Client '{client_id}' not found.")

    class ProjectNotFoundError(VelaraHTTPException):  # similar
    class StudyNotFoundError(VelaraHTTPException):  # similar
    class LocationNotFoundError(VelaraHTTPException):  # similar
    class HierarchyHasChildrenError(VelaraHTTPException):
        ERROR_CODE = "HIERARCHY_HAS_CHILDREN"
        def __init__(self): super().__init__(409, self.ERROR_CODE, "Cannot delete: child entities exist. Delete children first.")
    class HierarchyScopeError(VelaraHTTPException):
        ERROR_CODE = "HIERARCHY_SCOPE_ERROR"
        def __init__(self): super().__init__(403, self.ERROR_CODE, "Entity not accessible.")
    ```
  - [x] **`_build_ltree_segment(prefix: str, entity_id: uuid.UUID) -> str`**: returns `f"{prefix}_{str(entity_id).replace('-', '')}"` — ltree labels cannot contain hyphens; strip them from UUID
  - [x] **`create_client(session, org_id, name, description) -> Client`**: lazy org upsert, hierarchy_path built, commit + refresh
  - [x] **`get_client(session, client_id, org_id) -> Client`**: SELECT by id + org_id scope guard
  - [x] **`list_clients(session, org_id) -> list[Client]`**: SELECT WHERE `org_id = :org_id`
  - [x] **`update_client(session, client_id, org_id, **kwargs) -> Client`**: patch fields, update `updated_at`, scope guard
  - [x] **`delete_client(session, client_id, org_id)`**: child count guard → 409 or DELETE
  - [x] **`create_project(session, client_id, org_id, name, description) -> Project`**: parent scope guard, hierarchy path chained
  - [x] Repeat pattern for `create_study` (parent=project), `create_location` (parent=study, with postal_code)
  - [x] CRUD functions for project/study/location: `get_*`, `list_*`, `update_*`, `delete_*` — all with parent-scope guard
  - [x] All write operations use `session.add()`, `await session.commit()`, `await session.refresh(obj)` — mirror skill_service patterns exactly
  - [x] Log key events with `structlog`: `logger.info("client_created", client_id=..., org_id=...)`, etc.

- [x] **Task 5 — API routes: `app/api/v1/hierarchy.py` (AC: 2, 3, 4, 5, 6, 7)**
  - [x] Create `app/api/v1/hierarchy.py`
  - [x] Router: `router = APIRouter(prefix="/api/v1", tags=["hierarchy"])`
  - [x] All routes: inject `user: CurrentUser`, `session: DbSession`, `request: Request`; return `ResponseEnvelope[T]`; use `_meta(request)` helper
  - [x] Client routes: POST/GET/GET-id/PATCH/DELETE all implemented
  - [x] Project routes: POST/GET-list/GET-id/PATCH/DELETE all implemented
  - [x] Study routes: mirror project pattern with `?project_id={uuid}` filter
  - [x] Location routes: mirror with `?study_id={uuid}` filter; `postal_code` validated by Pydantic schema (NOT NULL → 422 if missing)
  - [x] All delete routes: `status_code=status.HTTP_204_NO_CONTENT`, return `Response()` (no body)
  - [x] **Register router in `app/api/v1/router.py`**: added `hierarchy` import + `include_router` — existing routers untouched

- [x] **Task 6 — Tests (AC: all)**
  - [x] Create `tests/integration/api/test_hierarchy.py`
  - [x] Use the project's existing `conftest.py` patterns (async client, test DB session, auth override)
  - [x] Test coverage: all 11 required tests implemented and passing
  - [x] Unit tests: `tests/unit/services/test_hierarchy_service.py` — 11 tests for `_build_ltree_segment`, `_org_segment`, domain exceptions

### Review Findings

> Code review 2026-06-12 (3-layer adversarial: Blind Hunter / Edge Case Hunter / Acceptance Auditor). All layers completed. 2 decision-needed, 8 patch, 1 defer, 4 dismissed.

**Decision-needed (RESOLVED 2026-06-12):**

- [x] [Review][Decision] `org_id` exposed in responses — does this violate AC6? — **RESOLVED → DISMISSED.** `org_id` is the JWT tenant scope key (matches the `Skill.org_id`-exposed convention), not the hidden Organization entity; no org row/name/PK leaks, so the binding epic AC6 (hide the Organization *layer*) is satisfied. Exposure accepted.
- [x] [Review][Decision] Cross-org access returns 403, diverging from the 404 convention — **RESOLVED → PATCH (see P9).** Match the `skill_service.get_skill` convention: collapse cross-org `HierarchyScopeError` (403) to the relevant `*NotFoundError` (404) to remove the existence oracle.

**Patch (APPLIED 2026-06-12):**

- [x] [Review][Patch] `_strip` before-validators 500 on non-string input — FIXED: new `_strip_str()` helper guards `isinstance(v, str)`; all 8 validators route through it (mirrors `skill.py`). Non-string → clean 422. [app/schemas/hierarchy.py]
- [x] [Review][Patch] `_org_segment` strips underscores — FIXED: underscores now preserved; only `[^A-Za-z0-9_]` chars are replaced. `org_client_001` and `orgclient001` no longer collide. [app/services/hierarchy_service.py]
- [x] [Review][Patch] `_org_segment` does not sanitize ltree-illegal chars — FIXED: `_LTREE_ILLEGAL` regex replaces every illegal char (dot/space/unicode/hyphen) with `_`, guaranteeing a valid ltree literal for any JWT org_id. [app/services/hierarchy_service.py]
- [x] [Review][Patch] `_get_or_create_org` get-or-create race — FIXED: INSERT wrapped in a SAVEPOINT (`begin_nested`); `IntegrityError` is caught, rolled back, and the winner's row re-selected. [app/services/hierarchy_service.py]
- [x] [Review][Patch] Delete child-guard TOCTOU + FK has no `ON DELETE` — FIXED: new `_commit_delete()` helper converts a child-FK `IntegrityError` on commit into the same `409 HIERARCHY_HAS_CHILDREN`; all 3 child-bearing deletes route through it. [app/services/hierarchy_service.py]
- [x] [Review][Patch] No cross-org isolation test — FIXED: `test_cross_org_isolation` creates under `org_vitalief` and asserts `org_client_001` gets 404 on GET/PATCH/DELETE and exclusion from list. [tests/integration/api/test_hierarchy.py]
- [x] [Review][Patch] AC7 child-guard untested for Project & Study; `delete_location` untested — FIXED: added `test_delete_project_with_children`, `test_delete_study_with_children`, `test_delete_location_leaf`, `test_non_string_name_returns_422`. [tests/integration/api/test_hierarchy.py]
- [x] [Review][Patch] Dead code in migration — FIXED: removed `_LTREE`/`_ltree_col` and the now-unused `sa`/`postgresql` imports. [app/db/migrations/versions/0011_hierarchy.py]
- [x] [Review][Patch] (from D2) Cross-org `get_*` returns 403 existence oracle — FIXED: all four `get_*` now raise the matching `*NotFoundError` (404) for cross-org/broken-chain, matching `skill_service.get_skill`. `HierarchyScopeError` retained for Epic 8 RBAC. [app/services/hierarchy_service.py]

> **Gate note (VERIFIED):** `ruff check` clean on all changed files; `py_compile` OK. After rebuilding the `api` image (no source volume-mount — code is baked at build time), the full suite passed in Docker: **522 passed** (515 prior + 7 new, zero regressions). Hierarchy subset: **29 passed** (13 unit + 16 integration), with all 7 new tests confirmed executing (not skipped). Unit `_org_segment` assertions updated to the new sanitization behavior.

**Deferred:**

- [x] [Review][Defer] PATCH cannot null out optional fields / `description:""` blanks silently — `if x is not None` service pattern + `_at_least_one` (is-None) means `{"description":""}` passes and writes empty, and `null` cannot clear a field. Broader PATCH-semantics design question (skill route uses `exclude_unset` + `NoFieldsToUpdateError`); not an in-scope fix for this story. [app/services/hierarchy_service.py:158-174 et al.] — deferred, design-scope

## Dev Notes

### Critical: ltree UUID Label Encoding

ltree labels **cannot contain hyphens or dots** — they must match `[A-Za-z0-9_]+`. UUID strings contain hyphens (`550e8400-e29b-41d4-a716-446655440000`), so strip all hyphens before embedding in the path:

```python
def _build_ltree_segment(prefix: str, entity_id: uuid.UUID) -> str:
    return f"{prefix}_{str(entity_id).replace('-', '')}"
# Result: "client_550e8400e29b41d4a716446655440000"
```

The architecture spec says `org_{id}.client_{id}` etc. — the `{id}` is the UUID **without hyphens**. Do NOT use the raw UUID string with hyphens as an ltree label.

### Critical: Organization Row Bootstrapping

The `organizations` table exists for path integrity, but there is no `/api/v1/organizations` endpoint (Organization layer is hidden from all API surfaces per AC6 and architecture). The `org_id` comes from the JWT claims (`user.org_id: str`, a string identifier from the auth provider, not a UUID).

**Phase 1 approach**: On first `create_client` call, upsert an Organization row keyed by `org_id` string:
```python
org = await session.scalar(select(Organization).where(Organization.org_id_ref == org_id))
if org is None:
    org = Organization(name=org_id, org_id_ref=org_id, ...)
    session.add(org)
    await session.flush()  # get org.id for path construction
```

The `Organization` model needs an `org_id_ref: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)` column to look up by the JWT's `org_id` string. The `hierarchy_path` for org = `f"org_{org_id_stripped}"` where `org_id_stripped = org_id.replace('-', '')`.

**Alternative simpler approach** (preferred for Phase 1): Since `org_id` from JWT is already a string (not necessarily a UUID), use it directly as the ltree root segment:
```python
# org_id from JWT might be "org_abc123" or a UUID string — strip hyphens
org_segment = f"org_{org_id.replace('-', '').replace('_', '')}"
client_segment = f"client_{str(client.id).replace('-', '')}"
client.hierarchy_path = f"{org_segment}.{client_segment}"
```
This avoids needing to query the `organizations` table at all for path construction. The `organizations` table row can be created lazily or omitted from path logic entirely if not needed for FK integrity.

**Decision**: Skip FK between clients.org_id and organizations.id for Phase 1 — use `org_id` as a plain string on `clients`. Only create the `organizations` table for future use. The `hierarchy_path` on clients derives its org segment from the JWT's `org_id`.

### ltree Extension

Enable PostgreSQL's ltree extension in the migration:
```python
op.execute("CREATE EXTENSION IF NOT EXISTS ltree")
```
This must run BEFORE creating columns with type `ltree`. In the migration DDL, declare hierarchy_path as `sa.Text()` at the SQLAlchemy level (since SQLAlchemy doesn't natively know `ltree`), but the actual storage will be `ltree` type via the extension. For Alembic to use the `ltree` type directly:
```python
sa.Column("hierarchy_path", sa.Text(), nullable=False)
# Then alter to ltree type, or just let ltree handle text-compatible storage
```
**Simpler**: use `sa.Column("hierarchy_path", postgresql.TEXT, nullable=False)` in migration, and the `LtreeType` mapper in the ORM model. The PostgreSQL `ltree` extension stores as text internally. The `LtreeType` in `app/models/base.py` already handles this with `get_col_spec() -> "ltree"`.

For the GiST index (ancestor/descendant queries with `<@` operator):
```python
op.execute("CREATE INDEX idx_clients_hierarchy_path ON clients USING gist(hierarchy_path)")
```

### Existing Infrastructure to Reuse

- **`Base`, `LtreeType`** — `app/models/base.py` — import both; use `LtreeType()` for `hierarchy_path` column
- **`VelaraHTTPException`** — `app/core/exceptions.py` — subclass for domain errors
- **`CurrentUser`, `DbSession`** — `app/core/dependencies.py` — inject in routes; `user.org_id` (str), `user.user_id` (str)
- **`ResponseEnvelope`, `ResponseMeta`** — `app/schemas/common.py`
- **`structlog`** — use `logger = structlog.get_logger(__name__)` in service
- **Existing router** — `app/api/v1/router.py` line currently ends at `api_router.include_router(invocations.router)` — add hierarchy router after that

### Patterns to Mirror Exactly (from skills.py / skill_service.py)

1. **Router prefix**: `APIRouter(prefix="/api/v1", tags=["hierarchy"])` — NOT `/api/v1/clients`; define full paths per route
2. **Response**: always `ResponseEnvelope(data=..., meta=_meta(request))`
3. **Service call**: service functions are `async def` using `AsyncSession` with `await session.execute(select(...))`, `await session.commit()`, `await session.refresh(obj)`
4. **Exception pattern**: `raise ClientNotFoundError(client_id)` in service → caught by global handler → error envelope
5. **Model validation**: `ClientRead.model_validate(client_orm)` with `from_attributes=True` config

### File Locations (ALL new files)

```
velara-api/
  app/
    models/hierarchy.py          ← NEW
    schemas/hierarchy.py         ← NEW
    api/v1/hierarchy.py          ← NEW
    services/hierarchy_service.py ← NEW
    db/migrations/versions/
      0011_hierarchy.py           ← NEW
  tests/
    integration/api/test_hierarchy.py  ← NEW
    unit/services/test_hierarchy_service.py  ← NEW
```

**UPDATE**: `app/api/v1/router.py` — add `hierarchy` import + include_router call

### What NOT to build in this story

- No `/api/v1/organizations` endpoint — Organization layer is permanently hidden
- No server-side search/filter by name — Phase 1 search is client-side (Epic 4.2 story); list endpoints return all org-scoped entities
- No hierarchy-scoped RBAC (`access_grants` table) — that is Epic 8. All routes authenticate via `CurrentUser` but scope only by `org_id` from JWT. The `hierarchy_scope` FastAPI dependency referenced in architecture is Epic 8 work.
- No pagination — list endpoints return full collections (Phase 1 volume is small)
- No WebSocket or async notifications
- No audit log writes — Epic 9 work (not yet built)

### REGRESSION GUARD: Do NOT break

- All existing 478 Docker tests (3.1–3.8 passing suite) must remain green
- `app/api/v1/router.py` only needs one new import + one new `include_router` line — no other changes
- `app/models/__init__.py` or base imports — if an `__init__.py` needs the new model imported for Alembic autogenerate, add it; otherwise do not modify existing model files
- Migration chain: `0010_skill_requires` → `0011_hierarchy` — `down_revision` must be exact string `"0010_skill_requires"`

### Testing Setup

Check `tests/conftest.py` for:
- How `AsyncSession` test fixture is set up (likely uses `async_session` fixture)
- How auth is overridden (`override_get_current_user` or similar — sets `user.org_id` and `user.user_id` to test values)
- Whether integration tests use a real test DB or mock — from Epic 3 patterns, integration tests hit a real Postgres in Docker

Mirror the exact `pytest.mark.asyncio` + `httpx.AsyncClient` patterns from existing integration test files (e.g., `tests/integration/api/test_skills.py` or `test_invocations.py`).

### Project Structure Reference

[Source: planning-artifacts/architecture/project-structure-boundaries.md]
- Backend root: `velara-api/` (nested under `velara/` hub repo)
- Models: `app/models/hierarchy.py`
- Schemas: `app/schemas/hierarchy.py`
- Routes: `app/api/v1/hierarchy.py`
- Service: `app/services/hierarchy_service.py`

### References

- [Epic 4 spec](../../planning-artifacts/epics/epic-4-engagement-hierarchy-management.md)
- [Architecture: Data Architecture (ltree)](../../planning-artifacts/architecture/core-architectural-decisions.md#data-architecture)
- [Architecture: Project Structure](../../planning-artifacts/architecture/project-structure-boundaries.md)
- [Architecture: Implementation Patterns](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md)
- [Existing model: app/models/base.py](../../../velara-api/app/models/base.py) — Base, LtreeType
- [Existing model: app/models/skill.py](../../../velara-api/app/models/skill.py) — pattern to follow
- [Existing schema: app/schemas/skill.py](../../../velara-api/app/schemas/skill.py) — pattern to follow
- [Existing router: app/api/v1/router.py](../../../velara-api/app/api/v1/router.py) — add hierarchy.router here
- [Existing migration: app/db/migrations/versions/0002_create_skills.py](../../../velara-api/app/db/migrations/versions/0002_create_skills.py) — migration pattern

## Change Log

- 2026-06-12: Story 4.1 implemented — 5 hierarchy tables (organizations/clients/projects/studies/locations) with ltree paths, full CRUD API for clients/projects/studies/locations, 409 child-guard on delete, org-layer hidden from all API surfaces. Migration 0011 uses raw DDL with native `ltree` type for GiST index support. 515 Docker tests pass, ruff clean.
- 2026-06-12: Code review (3-layer adversarial) → done. 2 decisions resolved (D1 org_id-exposure dismissed as the tenant scope key; D2 cross-org 403→404 promoted to patch), 9 patches applied & verified, 1 deferred (PATCH null-clear semantics), 5 dismissed. Patches: isinstance-guarded strip validators (non-string→422), `_org_segment` regex sanitization (underscores preserved + all ltree-illegal chars→`_`), SAVEPOINT-guarded org upsert race, `_commit_delete` FK-violation→409, cross-org `get_*`→404 (existence-oracle removed), dead migration helpers removed, +7 tests (cross-org isolation, project/study 409, leaf-delete, non-string-422, ltree sanitization). 522 Docker tests pass (+7, zero regressions), ruff clean.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation completed cleanly in one pass.

Key discovery: SQLAlchemy's `op.create_table()` with `sa.Text()` hierarchy_path columns cannot build GiST indexes (ltree requires the column declared as native `ltree` type, not TEXT). Fixed by switching migration to raw `op.execute()` DDL — tables created with `ltree` type columns directly.

### Completion Notes List

- Implemented all 5 hierarchy ORM models (Organization, Client, Project, Study, Location) in `app/models/hierarchy.py` with `LtreeType()` for hierarchy_path columns.
- Migration 0011_hierarchy uses raw SQL DDL (`op.execute`) to declare `ltree` column type — required so GiST indexes succeed. `sa.Text()` columns cannot have GiST indexes without the ltree operator class.
- Organization table exists for structural integrity; no API endpoint exposes it. Org rows lazily upserted on first `create_client` call.
- ltree path encoding: hyphens stripped from UUID strings via `_build_ltree_segment()` (ltree labels must match `[A-Za-z0-9_]+`). Path format: `org_{seg}.client_{seg}.project_{seg}.study_{seg}.location_{seg}`.
- Child-guard (409 HIERARCHY_HAS_CHILDREN) implemented for clients, projects, studies via COUNT query before DELETE.
- Scope guard: all get/update/delete operations verify entity's org_id chain matches the JWT's org_id.
- Docker build cache pruned (freed 20.8 GB from Colima VM) to resolve disk-full migration error.
- Migration round-trip verified: upgrade head → downgrade -1 → upgrade head, all clean.
- 515 Docker tests pass (478 prior + 22 new = no regressions), ruff clean.

### File List

- app/models/hierarchy.py (NEW)
- app/schemas/hierarchy.py (NEW)
- app/services/hierarchy_service.py (NEW)
- app/api/v1/hierarchy.py (NEW)
- app/db/migrations/versions/0011_hierarchy.py (NEW)
- tests/integration/api/test_hierarchy.py (NEW)
- tests/unit/services/test_hierarchy_service.py (NEW)
- app/models/__init__.py (MODIFIED — added hierarchy model imports)
- app/api/v1/router.py (MODIFIED — added hierarchy router)
