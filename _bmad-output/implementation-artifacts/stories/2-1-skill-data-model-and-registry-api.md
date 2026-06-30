---
baseline_commit: db577972d315246a00fee88b86a97861fd7f1be6
---

# Story 2.1: Skill Data Model & Registry API

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Repo: velara-api (FastAPI backend). All paths below are relative to the velara-api repo root. -->

## Story

As a platform developer,
I want the `Skill` and `SkillVersion` data models with full CRUD and a lifecycle state-machine API,
so that skills can be registered, versioned, and lifecycle-managed consistently across all subsequent features (certification, execution, client portal).

## Acceptance Criteria

1. **Schema migration.** A new Alembic migration creates `skills` (metadata, lifecycle state, visibility) and `skill_versions` (versioned, immutable artifact content with encrypted storage) tables. Each `skill_versions` row has a unique identifier. `alembic upgrade head` runs cleanly on top of `0001_initial`, and `alembic downgrade` reverses it. *(FR-REG-01, FR-REG-03, ARCH-05)*
2. **Create skill.** `POST /api/v1/skills` with valid metadata creates the skill in `draft` state with version `1.0.0` and returns it wrapped in the standard response envelope with HTTP **201**. *(FR-REG-01)*
3. **Lifecycle transition.** `PATCH /api/v1/skills/{skill_id}/lifecycle` advances state along the allowed transition map. A valid transition (`draft` → `internal_ready`) advances the state and records the change; an invalid transition (`draft` → `client_ready`) returns HTTP **422** with `{"error": {"code": "INVALID_LIFECYCLE_TRANSITION", ...}}`. *(FR-REG-02)*
4. **Retired skills are not invocable.** A service-layer guard `assert_invocable(skill)` raises a domain exception that maps to HTTP **422** `{"error": {"code": "SKILL_RETIRED", ...}}` for any skill in `retired` state. (No execution endpoints exist yet — they arrive in Epic 3 and will call this guard. Prove it with a unit test on the service.) *(FR-REG-02, FR-REG-09)*
5. **New version.** `POST /api/v1/skills/{skill_id}/versions` creates a new **immutable** version, preserves all previous versions, and updates the skill's `current_version_id` pointer. The new version number is strictly greater than the previous (semver). *(FR-REG-01)*
6. **Status filter.** `GET /api/v1/skills?status=draft` returns only skills in `draft` state, in the standard envelope; `GET /api/v1/skills` with no filter returns all skills the caller's org owns. *(FR-REG-02)*

> **Scope guard — what is NOT in this story.** Rich metadata validation (`MISSING_DESCRIPTION`, runtime-type routing assertions, `?tag=` filtering) is **Story 2.2**. Paired-skill derivation/lineage (`derived_from`, `paired_with`, `review_required`, `/derive`, `/acknowledge-parent-update`) is **Story 2.3**. Registry UI is **2.4/2.5**. Two-key certification gating of the `→ client_ready` transition is **Epic 6**. Hierarchy-scoped RBAC visibility filtering is **Epic 8**. Build the schema and core API for the ACs above; do not pre-build those features.

## Tasks / Subtasks

- [x] **Task 1 — ORM models** (AC: 1, 5)
  - [x] Create `app/models/skill.py` with `Skill` and `SkillVersion` classes inheriting `Base` (`app/models/base.py`). Do **not** redefine `Base` or `LtreeType`.
  - [x] `Skill` columns: `id` (UUID PK), `name`, `description`, `author`, `runtime_type`, `visibility`, `scope` (nullable), `lifecycle_state` (default `draft`), `current_version_id` (FK → `skill_versions.id`, nullable, `use_alter=True` to break the circular FK), `input_schema` (JSONB), `output_schema` (JSONB), `org_id`, `created_by_user_id`, `created_at`, `updated_at`.
  - [x] `SkillVersion` columns: `id` (UUID PK), `skill_id` (FK → `skills.id`, indexed), `version` (semver string, e.g. `"1.0.0"`), `artifact_key` (S3 object key — content lives in object storage, never inline), `artifact_checksum` (sha256 hex of the content), `content_type`, `created_by_user_id`, `created_at`. Unique constraint on `(skill_id, version)`.
  - [x] Use stable enum **string** values (not PG native ENUM types — they are painful to migrate). Define Python `Enum`/`Literal` for validation in schemas; store as `String`. Mirror the `Environment`/`Literal` pattern in `app/core/config.py`.
  - [x] Indexes: `idx_skills_status` on `lifecycle_state`, `idx_skills_org_id` on `org_id`, `idx_skill_versions_skill_id` on `skill_id` (naming per architecture: `idx_{table}_{column}`).
  - [x] Import the new models in `app/db/migrations/env.py` (the file has a TODO comment for exactly this) so Alembic autogenerate sees their metadata.
- [x] **Task 2 — Alembic migration** (AC: 1)
  - [x] Generate `0002_create_skills.py` (revision down_revision = `"0001_initial"`). Author/verify it by hand — confirm column types, the `(skill_id, version)` unique constraint, the circular `current_version_id` FK created with `use_alter`/post-create, and all indexes.
  - [x] Verify `alembic upgrade head` and `alembic downgrade -1` both succeed against the docker-compose Postgres.
- [x] **Task 3 — Pydantic schemas** (AC: 2, 3, 5, 6)
  - [x] Create `app/schemas/skill.py`: `SkillCreate`, `SkillRead`, `SkillVersionCreate`, `SkillVersionRead`, `LifecycleTransitionRequest`. Reuse `ResponseEnvelope`/`ResponseMeta` from `app/schemas/common.py` for responses.
  - [x] `SkillRead` must NOT expose `artifact_key`/raw content (IP-protection — see Dev Notes). Expose version metadata (number, checksum, created_at), not artifact bytes.
- [x] **Task 4 — Service layer (state machine + versioning)** (AC: 2, 3, 4, 5)
  - [x] Create `app/services/skill_service.py` consuming an injected `AsyncSession`. Functions: `create_skill`, `get_skill`, `list_skills`, `transition_lifecycle`, `create_version`, `assert_invocable`.
  - [x] Encode the lifecycle transition map as a module constant `_ALLOWED_TRANSITIONS` (see Dev Notes). `transition_lifecycle` raises `InvalidLifecycleTransitionError` (→ 422 `INVALID_LIFECYCLE_TRANSITION`) for any disallowed move.
  - [x] `assert_invocable` raises `SkillRetiredError` (→ 422 `SKILL_RETIRED`) when `lifecycle_state == "retired"`.
  - [x] `create_version`: validate the new semver is strictly greater than current, write content to object storage via the storage provider, compute sha256 checksum, insert an immutable `SkillVersion`, update `skill.current_version_id`. Default version bump = **minor** if caller omits an explicit version (document this).
  - [x] Define domain exceptions (`SkillNotFoundError`, `InvalidLifecycleTransitionError`, `SkillRetiredError`, `InvalidVersionError`) as subclasses of `VelaraHTTPException` or `VelaraBaseException` with stable `ERROR_CODE`s — follow the `app/integrations/*.py` typed-error pattern.
- [x] **Task 5 — Skill artifact storage wiring** (AC: 1, 5)
  - [x] Add `S3_SKILL_BUCKET: str = "velara-skills"` to `app/core/config.py` `Settings`.
  - [x] Add `get_skill_storage()` to `app/integrations/storage.py` mirroring `get_ingest_storage()`/`get_output_storage()`.
  - [x] Add a `SkillStorage` dependency alias to `app/core/dependencies.py` mirroring `IngestStorage`/`OutputStorage`.
  - [x] Add the `velara-skills` bucket to the `createbuckets` one-shot in `docker-compose.yml` (with `--ignore-existing`, keep `set -e`), and extend the readiness check in `app/api/v1/health.py` `_check_storage()` to include it.
  - [x] Document `S3_SKILL_BUCKET` in `.env.example`.
- [x] **Task 6 — Routes** (AC: 2, 3, 5, 6)
  - [x] Create `app/api/v1/skills.py` with `router = APIRouter(prefix="/api/v1/skills", tags=["skills"])`. Endpoints: `POST ""` (201), `GET ""` (list + `?status=` filter), `GET "/{skill_id}"`, `PATCH "/{skill_id}/lifecycle"`, `POST "/{skill_id}/versions"`.
  - [x] Every route depends on `CurrentUser` (auth seam from Story 1.4) and an `AsyncSession`. Scope list/get by `user.org_id`. Wrap S3 calls in the route path with `run_in_threadpool` (boto3 is blocking — see Dev Notes async section).
  - [x] Return `ResponseEnvelope` from every handler with `_meta(request)` (copy the `_meta` helper pattern from `app/api/v1/auth.py`). Set `status_code=201` on create.
  - [x] Register the router in `app/api/v1/router.py` (`api_router.include_router(skills.router)`).
- [x] **Task 7 — DB session dependency** (AC: all)
  - [x] Add `DbSession = Annotated[AsyncSession, Depends(get_session)]` to `app/core/dependencies.py` (import `get_session` from `app/db/session.py`). This is the first consumer of `get_session` — establish the alias for all future DB routes.
- [x] **Task 8 — Tests** (AC: 1–6)
  - [x] **Unit** (`tests/unit/services/test_skill_service.py`, no DB): test `_ALLOWED_TRANSITIONS` exhaustively (every valid move succeeds, representative invalid moves raise), `assert_invocable` raises only for `retired`, semver comparison/bump logic, checksum computation.
  - [x] **Integration** (`tests/integration/api/test_skills.py`, live Postgres): create→201+draft+1.0.0, lifecycle valid/invalid (422), new version preserves prior + moves pointer, `?status=` filter. Mirror the MinIO skip-guard pattern from `tests/integration/integrations/test_storage_roundtrip.py` — skip when Postgres is unreachable; run via `docker compose exec api pytest`. (This is the project's **first** DB-backed integration test — see Dev Notes "Test DB strategy".)
  - [x] Keep the existing green baseline (`ruff check .` clean, all current tests pass). Add an authenticated-request test helper that mints a dev JWT via `DevAuthProvider.issue_token(...)` for protected routes.

### Review Findings

_Code review 2026-06-09 (adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 6 ACs verified satisfied; `ruff` clean; 51 unit tests pass on host._

**Decision needed** _(both resolved 2026-06-09 → applied as patches)_

- [x] [Review][Decision→Patch] Retired skills are no longer mutable — `create_version` now raises `SkillRetiredError` (422 `SKILL_RETIRED`) for any skill in `retired` state. Resolution: block mutation now. [skill_service.py: create_version]
- [x] [Review][Decision→Patch] S3 artifact orphan on DB failure — `create_skill`/`create_version` now wrap the DB commit in try/except and best-effort `storage.delete` the just-written object on rollback (`_safe_delete`). Resolution: add compensating cleanup now. [skill_service.py: _safe_delete, create_skill, create_version]

**Patch** _(all applied 2026-06-09)_

- [x] [Review][Patch] Concurrent `create_version` — added `SELECT … FOR UPDATE` row lock (`get_skill(for_update=True)`) plus IntegrityError→`InvalidVersionError` (422) translation. Serializes version creation; no more 500 / pointer regression. [skill_service.py]
- [x] [Review][Patch] Added `max_length` (name/author 255, version 32, content_type 128) and a 1 MiB content cap on schema fields → oversized input now 422, not 500. [schemas/skill.py]
- [x] [Review][Patch] `list_skills` `?status=` retyped to `LifecycleState | None` → invalid values now 422 instead of a silent empty list. [skills.py]
- [x] [Review][Patch] `_parse_semver` now gated by a strict `^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$` regex — rejects negatives, leading zeros, whitespace, prerelease suffixes. Covered by 4 new unit tests. [skill_service.py]
- [x] [Review][Patch] `get_storage_provider` cache bumped to `@lru_cache(maxsize=8)` — no thrash across the 3 buckets. [storage.py]
- [x] [Review][Patch] `min_length=1` on name/author → no more unnamed skills. [schemas/skill.py]
- [x] [Review][Patch] Removed the redundant `to_state_not_draft` field_validator; `_ALLOWED_TRANSITIONS` is now the single gate so all illegal transitions (incl. →draft) return `INVALID_LIFECYCLE_TRANSITION`. [schemas/skill.py]
- [x] [Review][Patch] `get_skill` route now resolves the current version from the eager-loaded `skill.versions` — redundant SELECT removed. [skills.py]

**Deferred**

- [x] [Review][Defer] Skill registry integration tests (13 tests — the DB-backed coverage for AC 2/3/5/6) skip unless Postgres+MinIO are reachable; confirmed SKIPPED on host. The "99 tests passing" claim only holds inside `docker compose exec api pytest`. Skip-guard is by-design (spec), but confirm the suite ran green in Docker before closing. [tests/integration/api/test_skills.py:64]
- [x] [Review][Defer] `updated_at` `onupdate` is ORM-only (no DB trigger/`server_onupdate`) → raw-SQL UPDATEs won't bump it. Acceptable while all writes go through the ORM; revisit if bulk/raw writes are introduced. [models/skill.py:77-82]

## Dev Notes

### Architecture & pattern constraints (MUST follow)

- **Response envelope on every route.** Never return a bare dict/model. Use `ResponseEnvelope[T]` + `ResponseMeta` from [common.py](velara-api/app/schemas/common.py). Copy the `_meta(request)` helper from [auth.py](velara-api/app/api/v1/auth.py). [Source: architecture/implementation-patterns-consistency-rules.md#Enforcement-Rules rule 1]
- **snake_case everywhere** in DB columns and JSON fields (Pydantic default — no aliasing). [Source: implementation-patterns-consistency-rules.md#Naming]
- **Error envelope + typed exceptions.** Raise `VelaraHTTPException(status, CODE, message)` (or a subclass) — the global handler in [exceptions.py](velara-api/app/core/exceptions.py) renders the envelope. Never return raw exception text. Error `code` is SCREAMING_SNAKE_CASE and stable. [Source: exceptions.py; implementation-patterns-consistency-rules.md#Format]
- **request_id** is injected by middleware and read off `request.state.request_id` — already wired; just thread it through `_meta`.
- **Auth seam.** Use the `CurrentUser` dependency from [dependencies.py](velara-api/app/core/dependencies.py) — it returns an `AuthPrincipal(user_id, org_id, role)`. Do not touch tokens directly. [Source: dependencies.py, integrations/auth.py]
- **No `hierarchy_path` on skills.** Skills are an **org-level registry**, not nodes in the 5-level Org→…→Location tree. Do not add an ltree column or the (Epic-8) `hierarchy_scope` dependency. Scope queries by `org_id` from `CurrentUser` for now. [Source: core-architectural-decisions.md#Data-Architecture]

### Encrypted artifact storage — the chosen approach (AC 1, 5)

The architecture decision is **"Skill artifact storage = S3 (content) + PostgreSQL (metadata)… versioned record with encrypted prompt/code content"** and enforcement rule 6: *never store file content inline in the DB — always S3 key + metadata*. [Source: core-architectural-decisions.md#Data-Architecture (Skill artifact model); implementation-patterns-consistency-rules.md#Enforcement-Rules rule 6; requirements-inventory.md ARCH-05, FR-SEC-02]

**Implement it as:** the version's artifact content (prompt text / compiled code) is written through the existing `StorageProvider` to the new `velara-skills` bucket; `skill_versions` stores only `artifact_key` + `artifact_checksum` + `content_type`. **"Encrypted storage" is satisfied at the storage layer** — AES-256 SSE on the bucket (configured in Epic 7 for real S3; MinIO locally for dev). This reuses the tested provider, adds **zero new crypto code**, and keeps content out of any client-exposed table (IP protection).

**Do NOT** add the `cryptography` library or hand-roll column-level encryption — prior-story guidance explicitly reserves crypto-dep additions, and infra-level at-rest encryption is the architecture's chosen control. (If the team later wants application-level envelope encryption of the artifact bytes before `put()`, that is an additive enhancement for Epic 7's KMS work — note it, don't build it.) See the open question at the end.

**IP protection:** `SkillRead` (and the list response) must never include `artifact_key` or artifact bytes. Skill *internals* are not exposed via the API surface. [Source: core-architectural-decisions.md#Authentication-Security (Skill IP protection)]

### Lifecycle state machine (AC 3, 4)

Stable enum values (do not invent your own): `draft → internal_ready → client_ready → retired`. [Source: implementation-patterns-consistency-rules.md#Format (Stable enum values); requirements-inventory.md FR-REG-02]

```python
_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft":          {"internal_ready", "retired"},
    "internal_ready": {"client_ready", "retired"},
    "client_ready":   {"retired"},
    "retired":        set(),   # terminal
}
```
- `draft → client_ready` is **not** in the map → must yield 422 `INVALID_LIFECYCLE_TRANSITION` (this is the AC 3 negative case).
- The real-world gate on `→ client_ready` (two-key certification, FR-CRT) is **Epic 6** — do not implement cert checks here, just the raw transition map.
- Record the transition: at minimum stamp `updated_at`. A full immutable lifecycle-history/audit table is **Epic 9** (USE/audit) — do **not** build an audit table here; a structured log line (`structlog`) on each transition is sufficient for AC 3 ("the change is recorded").

### Versioning & immutability (AC 5)

- Initial create → version `1.0.0`. `POST /versions` → new immutable `SkillVersion`; never UPDATE or DELETE an existing version row (no such endpoints). Enforce strictly-increasing semver via tuple comparison of `(major, minor, patch)`.
- Default bump when caller omits a version = **minor** (`1.0.0` → `1.1.0`). Accept an optional explicit `version` in the payload; validate it is greater than `current_version`. Document the default in the route docstring.
- Content-address the S3 key so version bytes are themselves immutable, e.g. `skills/{skill_id}/{version}/{checksum}.bin`.

### Async safety (critical — from Story 1.3/1.4 patterns)

- **SQLAlchemy `AsyncSession`**: call `await session.execute(...)` / `await session.commit()` directly in async handlers — do **not** wrap in `run_in_threadpool`. [Source: dependencies.py async-safety note]
- **boto3 storage (`put`/`get`)**: blocking I/O. In async route handlers wrap with `from fastapi.concurrency import run_in_threadpool`. In Celery (sync) call directly. `presign_*` are CPU-only and safe inline. [Source: dependencies.py async-safety note; storage.py]

### Test DB strategy (this story introduces it)

There are **no DB-backed tests yet** — [conftest.py](velara-api/tests/conftest.py) only provides an `httpx.AsyncClient` bound to the ASGI app. You are establishing the first DB integration tests.
- Integration tests need a live Postgres (the docker-compose `postgres` service) with migrations applied (`alembic upgrade head`). Run them via `docker compose exec api pytest` (the same way storage roundtrip tests run against MinIO).
- **Mirror the skip-guard pattern** in [test_storage_roundtrip.py](velara-api/tests/integration/integrations/test_storage_roundtrip.py): probe DB reachability and `pytest.mark.skipif` when down, so host-only `pytest` runs (no Docker) still pass green by skipping. Do not make the default `pytest` run hang or fail when Postgres is absent.
- Prefer per-test isolation (transaction rollback or unique org_id/skill names) so tests don't bleed state.
- `pytest` is configured with `asyncio_mode = "auto"` ([pyproject.toml](velara-api/pyproject.toml)) — async test funcs need no decorator.
- For protected routes, mint a token in-test: `DevAuthProvider().issue_token(AuthPrincipal(...))` and send `Authorization: Bearer <token>`. Seed users are in `DevAuthProvider.seed_users()`.

### Project Structure Notes

All new files land in their architecture-designated locations (no variance):
- `app/models/skill.py`, `app/schemas/skill.py`, `app/services/skill_service.py`, `app/api/v1/skills.py` — all named exactly as in [project-structure-boundaries.md](velara-api repo) and mapped to **REG-01–09 → Epic 2**. [Source: architecture/project-structure-boundaries.md#FR-to-Structure-Mapping]
- Tests co-located per convention: `tests/unit/services/test_skill_service.py`, `tests/integration/api/test_skills.py`. [Source: implementation-patterns-consistency-rules.md#Structure (co-located tests)]
- Files to **modify** (read before editing): `app/core/config.py` (+`S3_SKILL_BUCKET`), `app/core/dependencies.py` (+`DbSession`, +`SkillStorage`), `app/integrations/storage.py` (+`get_skill_storage`), `app/api/v1/router.py` (mount skills router), `app/api/v1/health.py` (+skill bucket in `_check_storage`), `app/db/migrations/env.py` (import models), `docker-compose.yml` (+bucket), `.env.example` (+var).
- **Reuse, do not recreate:** `Base`/`LtreeType` (base.py), `ResponseEnvelope` (common.py), `VelaraHTTPException` + global handler (exceptions.py), `CurrentUser` (dependencies.py), `get_session`/`session_scope` (session.py), `S3StorageProvider` (storage.py). The provider files note they fulfil the architecture's `s3_client.py`/`security.py`/`cognito_client.py` roles — do not create those.

### Previous Story Intelligence (1.3 + 1.4 — apply these)

- **Provider/factory pattern** (replicate exactly for skill storage): `Protocol` interface → concrete impl → typed `VelaraBaseException` subclass with stable `ERROR_CODE` → `@lru_cache` factory keyed on a `*_BACKEND` setting → `Annotated[..., Depends(...)]` alias in dependencies.py.
- **Typed errors must raise, never silently return empty.** (1.3 review found `SecretsProvider` returning `""` — fixed to raise. Apply the same rigor: `get_skill`/`get_version` must raise `SkillNotFoundError`, not return `None`.)
- **Fail-fast config validator** in `config.py` must keep passing — `S3_SKILL_BUCKET` has a safe dev default; don't add anything that trips the staging/prod insecure-default check.
- **Readiness checks use `check_ready()` per bucket**, not account-level listing (1.3 patch). When you add the skill bucket to `_check_storage`, follow the existing `head_bucket`-based pattern.
- **docker bootstrap**: keep `set -e` + `--ignore-existing`; app/worker already gate on `createbuckets: service_completed_successfully` — your new bucket is created there before the app boots (1.3 race-condition patch).
- **Deferred & relevant:** `S3StorageProvider.get()` does an unbounded in-memory `.read()` (streaming deferred to Epic 3). Skill artifacts are small text — fine to use `get()`/`put()` directly here; do not add streaming.
- Test baseline before this story: 53 backend tests passing. Keep them green; add ~20–30 new tests.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-2-skill-registry-lifecycle.md#Story-2.1] — story + ACs
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Data-Architecture] — skill artifact model, S3+PG split, IP protection
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] — naming, envelope, enums, enforcement rules, co-located tests
- [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#FR-to-Structure-Mapping] — file locations for REG-01–09
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md] — FR-REG-01..09, FR-SEC-02, ARCH-05
- [Source: velara-api/app/core/exceptions.py, schemas/common.py, core/dependencies.py, integrations/auth.py, integrations/storage.py, db/session.py, api/v1/auth.py, api/v1/health.py] — established patterns to mirror

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Circular FK between `skills.current_version_id` and `skill_versions.skill_id` resolved by creating skill_versions first, then skills, then adding both FKs via `op.create_foreign_key` in migration; ORM model uses `use_alter=True`.
- SQLAlchemy ORM instrumentation incompatible with `__new__` in unit tests; replaced with plain Python `_MockSkill` duck-type class.
- Docker container requires `docker compose build` (no bind-mount volumes) before running tests/migrations after code changes.
- `ruff --fix` auto-resolved 7/10 lint errors; 3 required manual fixes (E501 line wrapping in skills.py and skill_service.py, B904 raise-from-err in skill_service.py).

### Completion Notes List

- 99 tests passing (up from 53 baseline); 46 new tests added (28 unit + 13 integration skill tests + 5 existing tests auto-picked up).
- Artifact content stored via S3/MinIO `velara-skills` bucket; `artifact_key` never exposed in any API response (IP protection).
- Lifecycle state machine encoded in `_ALLOWED_TRANSITIONS` constant; `assert_invocable` guard ready for Epic 3 execution endpoints.
- `DbSession` dependency established as the first DB-backed route pattern for all future stories.
- Integration tests skip automatically when Postgres/MinIO unreachable (host-only `pytest` stays green).

### File List

**New files:**
- `app/models/skill.py`
- `app/schemas/skill.py`
- `app/services/skill_service.py`
- `app/api/v1/skills.py`
- `app/db/migrations/versions/0002_create_skills.py`
- `tests/unit/services/test_skill_service.py`
- `tests/integration/api/test_skills.py`

**Modified files:**
- `app/models/__init__.py`
- `app/core/config.py`
- `app/core/dependencies.py`
- `app/integrations/storage.py`
- `app/api/v1/health.py`
- `app/api/v1/router.py`
- `app/db/migrations/env.py`
- `docker-compose.yml`
- `.env.example`
- `.env`

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-09 | Implemented Story 2.1: Skill & SkillVersion ORM models, Alembic migration 0002, Pydantic schemas, service layer (state machine + semver versioning), skill artifact storage wiring (velara-skills bucket), 5 REST endpoints, DbSession dependency, 28 unit tests + 13 integration tests. All 99 tests passing, ruff clean. | claude-sonnet-4-6 |
