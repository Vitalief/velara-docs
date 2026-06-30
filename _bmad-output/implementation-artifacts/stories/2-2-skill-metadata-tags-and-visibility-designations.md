---
baseline_commit: NO_VCS
---

# Story 2.2: Skill Metadata, Tags & Visibility Designations

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Repo: velara-api (FastAPI backend). All paths below are relative to the velara-api repo root. -->

## Story

As an MA Tech developer,
I want to set and update all required skill metadata fields — including runtime type, visibility designation, scope, and tags — with proper validation and a metadata-only edit path,
so that skills are correctly discoverable, correctly restricted, and carry enough information for invocation, certification, and client-portal display.

## Acceptance Criteria

1. **Required metadata validated on create.** `POST /api/v1/skills` validates the required metadata set: `name`, `description`, `author`, `runtime_type` (`prompt`|`code`|`hybrid`), `visibility` (`internal_only`|`paired`|`client_facing`). `input_schema` / `output_schema` remain **optional** (a draft skill may be authored before its schemas are finalized; certification completeness is judged in Epic 6) but, when present, must be JSON objects. Invalid enum values return **422**. *(FR-REG-03, FR-REG-05)*
2. **Description is required — specific error code.** Creating a skill with a missing, `null`, empty, or whitespace-only description returns HTTP **422** with `{"error": {"code": "MISSING_DESCRIPTION", ...}}`. This code is **not** the generic `VALIDATION_ERROR` — it is a dedicated domain error (see Dev Notes "Why MISSING_DESCRIPTION cannot be a Pydantic-required field"). *(FR-REG-03, FR-REG-07)*
3. **Runtime type stored and exposed for routing.** A skill created with `runtime_type: "prompt"` (or `code`/`hybrid`) stores the value and exposes it on `SkillRead`, so the execution layer can route on it later. *(Actual execution dispatch on `runtime_type` is Epic 3 — this story only guarantees correct storage + exposure.)* *(FR-REG-03)*
4. **Paired visibility exposes `paired_with`.** Setting `visibility: "paired"` (and every other skill) returns a `paired_with` field on `SkillRead`. It is **`null` in this story** — it is populated only when a derived skill is linked in **Story 2.3**. *(FR-REG-05, FR-REG-06)*
5. **Scope stored + study-context invocation guard.** Setting `scope: "study"` stores the scope. A service-layer guard enforces that a study-scoped skill is only invocable inside a Study context. There are no execution endpoints yet (they arrive in Epic 3/5 and will call this guard) — prove it with a unit test on the service, mirroring how `assert_invocable` was proven in Story 2.1. *(FR-REG-04)*
6. **Tags stored + filterable.** A skill can carry tags (e.g. `["clinical", "enrollment"]`). `GET /api/v1/skills?tag=clinical` returns only skills carrying that tag; tags appear on `SkillRead`. *(FR-REG-03)*
7. **Metadata-only update (no new version).** `PATCH /api/v1/skills/{skill_id}` updates editable metadata (`name`, `description`, `tags`, `scope`, `input_schema`, `output_schema`) as a **partial** update — only fields present in the body change. It creates **no new `SkillVersion`**, does **not** touch `current_version_id`, and does **not** change `lifecycle_state` (metadata edits never require re-certification). A description set to blank via PATCH returns **422 MISSING_DESCRIPTION**. *(FR-REG-03)*

> **Scope guard — what is NOT in this story.**
> - **Paired-skill derivation & lineage** — `/derive`, populating `paired_with`/`derived_from`, `derived_skills`, `review_required`, `/acknowledge-parent-update` — is **Story 2.3**. This story only *adds the `paired_with` column and exposes it as `null`*; do not build derivation.
> - **`runtime_type`-based execution dispatch** is **Epic 3**. Store and expose it; do not route on it.
> - **Registry UI** (browse/detail/create/edit forms) is **2.4 / 2.5**.
> - **Hierarchy-scoped RBAC visibility filtering** (internal-only skills hidden from client tokens) is **Epic 8**. Visibility here is a stored designation, not an access filter.
> - **Certification judgment** of whether a description is *adequate* (FR-REG-07) is **Epic 6**. This story only enforces that a description is *present and non-blank*.
> - **`runtime_type` / `visibility` are NOT editable** via the metadata PATCH (see Dev Notes "Metadata PATCH field set").

## Tasks / Subtasks

- [x] **Task 1 — Model changes** (AC: 4, 6)
  - [x] In [app/models/skill.py](velara-api/app/models/skill.py) add to `Skill`:
    - `tags: Mapped[list[str]]` → `mapped_column(JSONB, nullable=False, default=list, server_default="[]")`. JSONB array (see Dev Notes "Tags storage decision" — **not** a join table).
    - `paired_with: Mapped[uuid.UUID | None]` → nullable self-referential FK to `skills.id` (`ForeignKey("skills.id", name="fk_skills_paired_with", use_alter=True)`), `nullable=True`. Populated by Story 2.3; always `null` here.
  - [x] Add a GIN index for tag containment: `Index("idx_skills_tags", "tags", postgresql_using="gin")` in `__table_args__`.
  - [x] **Do not** change the `description` column to `NOT NULL` — keep it `nullable=True` at the DB level; the required-ness is enforced in the service layer so it can return the specific `MISSING_DESCRIPTION` code (see Dev Notes). Existing 2.1 rows must not break.
  - [x] No change needed to `app/models/__init__.py` (Skill is already imported), but re-verify Alembic autogenerate sees the new columns.
- [x] **Task 2 — Alembic migration `0003_skill_metadata_tags`** (AC: 4, 6)
  - [x] Create `app/db/migrations/versions/0003_skill_metadata_tags.py` with `down_revision = "0002_create_skills"`. Author by hand (mirror the style of [0002_create_skills.py](velara-api/app/db/migrations/versions/0002_create_skills.py)).
  - [x] `upgrade()`: `op.add_column("skills", tags JSONB NOT NULL server_default '[]'::jsonb)`; `op.add_column("skills", paired_with UUID NULL)`; `op.create_foreign_key("fk_skills_paired_with", "skills", "skills", ["paired_with"], ["id"])`; `op.create_index("idx_skills_tags", "skills", ["tags"], postgresql_using="gin")`.
  - [x] `downgrade()`: drop index, drop FK, drop both columns (reverse order).
  - [x] Verify `alembic upgrade head` and `alembic downgrade -1` both run cleanly against the docker-compose Postgres (via `docker compose exec api alembic ...`).
- [x] **Task 3 — Schemas** (AC: 1, 2, 3, 4, 6, 7)
  - [x] In [app/schemas/skill.py](velara-api/app/schemas/skill.py):
    - Add bounds constants: `_MAX_TAGS = 32`, `_MAX_TAG_LEN = 64` (mirror the bounding rigor the 2.1 review added — never accept unbounded input).
    - `SkillCreate`: add `tags: list[str] = Field(default_factory=list)`. Keep `description: str | None = None` **unchanged** (do **not** make it a required `str` — see Dev Notes). Add a field validator that normalizes tags: strip each, drop empties, de-duplicate (preserve first-seen order), enforce `len(tag) <= _MAX_TAG_LEN` and `len(tags) <= _MAX_TAGS` (else `ValueError` → 422 `VALIDATION_ERROR`).
    - `SkillRead`: add `tags: list[str]` and `paired_with: uuid.UUID | None`.
    - Add `SkillMetadataUpdate(BaseModel)` with all-optional fields: `name: str | None`, `description: str | None`, `tags: list[str] | None`, `scope: Scope | None`, `input_schema: dict | None`, `output_schema: dict | None`. Reuse the same tag normalization. Apply the same `min_length=1`/`max_length=_MAX_NAME` bound on `name` when present. (Partial-update semantics handled in the route via `model_dump(exclude_unset=True)`.)
  - [x] `SkillReadWithVersion` inherits the new fields automatically — no change.
- [x] **Task 4 — Service layer** (AC: 1, 2, 5, 6, 7)
  - [x] In [app/services/skill_service.py](velara-api/app/services/skill_service.py) add domain exceptions (subclass `VelaraHTTPException`, stable codes):
    - `MissingDescriptionError` → 422 `MISSING_DESCRIPTION`.
    - `SkillScopeError` → 422 `SKILL_SCOPE_VIOLATION`.
    - `NoFieldsToUpdateError` → 422 `NO_FIELDS_TO_UPDATE` (raised by the PATCH route on an empty body).
  - [x] Add `_validate_description(description: str | None) -> None` helper: raise `MissingDescriptionError` when `description is None or not description.strip()`.
  - [x] `create_skill`: add a `tags: list[str]` parameter; call `_validate_description(description)` **before** writing the artifact to storage (fail fast — don't orphan an S3 object on a validation 422); persist `tags`.
  - [x] Add `update_skill_metadata(*, session, skill_id, org_id, fields: dict, updated_by_user_id) -> Skill`:
    - Load via `get_skill(...)` (raises `SkillNotFoundError`).
    - Block edits to a **retired** skill → raise `SkillRetiredError` (consistent with the 2.1 review decision that retired skills are immutable; see Dev Notes "Retired skills are immutable").
    - If `"description"` is in `fields`, run `_validate_description` on the new value.
    - Apply only the keys present in `fields` (partial update); set `updated_at = now`; **never** touch `current_version_id` or `lifecycle_state`. Commit, refresh, emit a `skill_metadata_updated` structlog line, return the skill.
  - [x] Add `assert_scope_satisfied(skill: Skill, *, study_context_present: bool) -> None`: if `skill.scope == "study"` and not `study_context_present`, raise `SkillScopeError`. (Epic 3/5 execution routes will call this alongside `assert_invocable`.)
  - [x] `list_skills`: add an optional `tag: str | None` parameter. When set, filter with JSONB containment — `Skill.tags.contains([tag])` (`@>` operator). Compose with the existing `status` filter.
- [x] **Task 5 — Routes** (AC: 1, 2, 3, 6, 7)
  - [x] In [app/api/v1/skills.py](velara-api/app/api/v1/skills.py):
    - `create_skill` route: pass `tags=body.tags` through to the service.
    - `list_skills` route: add `tag: str | None = None` query param; pass to `skill_service.list_skills(...)`.
    - Add `PATCH /{skill_id}` route → `update_skill_metadata`. Body = `SkillMetadataUpdate`; compute `fields = body.model_dump(exclude_unset=True)`; if `fields` is empty, raise **422 `NO_FIELDS_TO_UPDATE`** (a `VelaraHTTPException` — an empty edit is a client error, not a silent no-op). Return `ResponseEnvelope[SkillRead]` with `_meta(request)`. Depends on `CurrentUser` + `DbSession` (no `SkillStorage` — metadata edits never touch object storage).
  - [x] Keep every handler returning `ResponseEnvelope` (architecture enforcement rule 1).
- [x] **Task 6 — Tests** (AC: 1–7)
  - [x] **Unit** ([tests/unit/services/test_skill_service.py](velara-api/tests/unit/services/test_skill_service.py), no DB):
    - `_validate_description`: `None`, `""`, `"   "` each raise `MissingDescriptionError`; a real string passes.
    - `assert_scope_satisfied`: `scope="study"` + `study_context_present=False` raises `SkillScopeError`; `scope="study"` + `True` passes; `scope="project"` and `scope=None` pass regardless of context.
  - [x] **Integration** ([tests/integration/api/test_skills.py](velara-api/tests/integration/api/test_skills.py), live Postgres + MinIO; reuse the existing skip-guard + `_internal_auth()` helper):
    - **AC2**: create with no `description` key → 422 `MISSING_DESCRIPTION`; create with `description: ""` → 422 `MISSING_DESCRIPTION`; create with `"   "` → 422.
    - **AC1**: create with `runtime_type: "bogus"` → 422; create with `visibility: "bogus"` → 422.
    - **AC3**: create `runtime_type: "code"`, GET it back, assert stored.
    - **AC4**: create `visibility: "paired"`, assert response has `paired_with` present and `null`.
    - **AC6**: create skill with `tags: ["clinical","enrollment"]` and another with `tags: ["ops"]`; `GET ?tag=clinical` includes the first, excludes the second; assert `tags` present on `SkillRead`.
    - **AC7**: PATCH `{name, description, tags}` → 200, fields changed, `current_version_id` unchanged, `lifecycle_state` unchanged, no new version row (GET `/{id}` shows same current version); PATCH `description: ""` → 422 `MISSING_DESCRIPTION`; PATCH a **retired** skill → 422 `SKILL_RETIRED`; PATCH unknown id → 404 `SKILL_NOT_FOUND`.
    - Bounds: tag longer than `_MAX_TAG_LEN`, or > `_MAX_TAGS` tags → 422.
    - Update the shared `skill_payload` fixture only if needed (it already includes a description) — prefer per-test payloads so the AC2 negative tests can omit description.
  - [x] Keep the green baseline: `ruff check .` clean; all existing 99 (Docker) tests still pass. Run the new DB tests via `docker compose exec api pytest`.

### Review Findings (code review 2026-06-09)

**Decisions resolved (2026-06-09):**
- [ ] [Review][Patch] (was Decision D1) Explicit null in PATCH → reject with 422 — `{"scope": null}` / `{"input_schema": null}` / `{"output_schema": null}` / `{"tags": null}` must be rejected, not silently clear the column. Decision: REJECT null (do not allow clear-via-null). Subsumes the `{"tags": null}`→500 fix. Touch [schemas/skill.py SkillMetadataUpdate](velara-api/app/schemas/skill.py#L149) (validators / field types) + empty-body guard interaction ([skills.py:210](velara-api/app/api/v1/skills.py#L210)).
- [x] [Review][Dismiss] (was Decision D2) `extra="forbid"` — Decision: KEEP silent-drop. No contract change. `model_dump(exclude_unset=True)` already prevents mutation of immutable fields; accepted known behavior, not patched.

**Patch (all applied 2026-06-09):**
- [x] [Review][Patch] Non-string tag element → AttributeError → HTTP 500 not 422 — FIXED: `_normalize_tags` now `isinstance`-guards list + each element, raising **ValueError** (→422). NOTE: initially used TypeError; Docker test run proved a bare TypeError from a field_validator is NOT converted to 422 in this stack and escaped as 500 — switched to ValueError. [schemas/skill.py:46-52](velara-api/app/schemas/skill.py#L46-L52)
- [x] [Review][Patch] PATCH {"tags": null} → NULL into NOT NULL column → 500 — FIXED by D1 `reject_explicit_null` model_validator → 422 [schemas/skill.py:180-195](velara-api/app/schemas/skill.py#L180-L195)
- [x] [Review][Patch] tags as string ("abc") explodes per-char — FIXED: non-list raises TypeError [schemas/skill.py:46-47](velara-api/app/schemas/skill.py#L46-L47)
- [x] [Review][Patch] AC2: description stored un-stripped — FIXED: `_validate_description` returns stripped value; create + PATCH store it [skill_service.py:158-167](velara-api/app/services/skill_service.py#L158-L167)
- [x] [Review][Patch] ?tag= (empty string) → zero results — FIXED: `if tag and tag.strip()` treats empty as no-filter [skill_service.py:312-316](velara-api/app/services/skill_service.py#L312-L316)
- [x] [Review][Patch] Model server_default drift — FIXED: `server_default=text("'[]'::jsonb")` [models/skill.py:74](velara-api/app/models/skill.py#L74)
- [x] [Review][Patch] D1 explicit-null reject (scope/input_schema/output_schema/name/tags) — FIXED: `reject_explicit_null` model_validator [schemas/skill.py:180-195](velara-api/app/schemas/skill.py#L180-L195)
- [x] [Review][Patch] Missing test coverage — ADDED: unit (`TestNormalizeTags`, description-strip return) + 11 integration tests (non-string tag→422, tags-as-string→422, description strip on create/PATCH, explicit-null tags/scope→422, non-object input_schema→422, tag case-sensitivity, dedup/order, empty-?tag= no-filter, GET-detail paired_with) [tests/integration/api/test_skills.py](velara-api/tests/integration/api/test_skills.py), [tests/unit/services/test_skill_service.py](velara-api/tests/unit/services/test_skill_service.py)

**Deferred:**
- [x] [Review][Defer] update_skill_metadata read-modify-write race / stale retired guard [skill_service.py:472-484](velara-api/app/services/skill_service.py#L472-L484) — deferred, pre-existing pattern (no row lock; mirrors pre-2.2 service style)
- [x] [Review][Defer] name/author stored un-stripped; whitespace-only `name=" "` passes min_length=1 [skill_service.py:230](velara-api/app/services/skill_service.py#L230) — deferred, pre-existing from 2.1

## Dev Notes

### Build on Story 2.1 — do NOT recreate

Story 2.1 already shipped the `Skill`/`SkillVersion` models, the `0002` migration, the create/list/get/lifecycle/versions routes, the `SkillCreate`/`SkillRead` schemas, the service layer with `_ALLOWED_TRANSITIONS`/`assert_invocable`/semver helpers, and the `velara-skills` storage wiring. **Extend these in place.** [Source: stories/2-1-skill-data-model-and-registry-api.md] This story adds: `tags` + `paired_with` columns (migration `0003`), description-required enforcement with a dedicated code, a scope guard, tag filtering, and a metadata-only `PATCH`.

### Why `MISSING_DESCRIPTION` cannot be a Pydantic-required field (AC 2 — critical)

The global validation handler maps **all** `RequestValidationError`s to a single generic code, `VALIDATION_ERROR` ([app/core/exceptions.py](velara-api/app/core/exceptions.py) `validation_exception_handler`). If you make `description: str` (required) on `SkillCreate`, a missing description yields `VALIDATION_ERROR`, **not** the `MISSING_DESCRIPTION` the AC requires. Therefore:

- Keep `description: str | None = None` on `SkillCreate`.
- Enforce presence in the **service layer** via `_validate_description`, raising `MissingDescriptionError(ERROR_CODE="MISSING_DESCRIPTION")` (a `VelaraHTTPException` subclass → rendered by `velara_http_exception_handler`).
- Strip whitespace before the check so `"   "` is treated as missing.

This mirrors the established typed-domain-exception pattern (`SkillNotFoundError`, `InvalidLifecycleTransitionError`, etc.) and keeps error codes stable and client-mappable. [Source: implementation-patterns-consistency-rules.md#Format (error envelope, stable codes); exceptions.py]

### Tags storage decision (AC 6)

Store tags as a **JSONB string array column on `skills`** with a **GIN index**, filtered via the containment operator (`Skill.tags.contains([tag])` → `tags @> '["clinical"]'`). Rationale: tag filtering here is a single-value membership query over an org-level registry; a JSONB array + GIN gives indexed containment with zero join complexity and no new table. The architecture names `skills` / `skill_versions` as the registry tables and does not prescribe a `skill_tags` join table, so this is the lowest-friction choice that satisfies FR-REG-03. [Source: implementation-patterns-consistency-rules.md#Naming; core-architectural-decisions.md#Data-Architecture] *(If future stories need tag-rename/merge or tag governance, a normalized `tags` table can be introduced additively — note it, don't build it.)*

Normalization: strip, drop empties, de-duplicate preserving order; bound count and length (`_MAX_TAGS`, `_MAX_TAG_LEN`). Match is **case-sensitive exact** against the stored value (the AC example stores and queries lowercase). Do not silently lowercase — it would surprise callers; document if the team later wants case-insensitive search.

### `paired_with` column now, derivation in 2.3 (AC 4)

AC 4 only requires the **field to appear** (as `null`) on every `SkillRead`. Add the nullable self-FK column `paired_with` in this story's migration so 2.3 can populate it without a second schema migration, and expose it on `SkillRead`. **Do not** build `/derive`, `derived_from`, `derived_skills`, `review_required`, or `/acknowledge-parent-update` — all of that is Story 2.3. [Source: epics/epic-2-skill-registry-lifecycle.md#Story-2.3]

### Scope guard (AC 5)

`scope` (`project`|`study`) is already a stored column. FR-REG-04 says study-scoped skills are only invocable within their Study. There are **no execution endpoints yet** (Epic 3/5), so — exactly as 2.1 did for `assert_invocable` — add a pure guard `assert_scope_satisfied(skill, *, study_context_present)` and prove it with a unit test. The execution routes in Epic 3/5 will call `assert_invocable(skill)` **and** `assert_scope_satisfied(skill, study_context_present=...)` before dispatching. Do not wire hierarchy/study context resolution here. [Source: requirements-inventory.md FR-REG-04; stories/2-1...#assert_invocable]

### Metadata PATCH field set (AC 7)

`PATCH /api/v1/skills/{skill_id}` is a **metadata-only, partial** update. Editable: `name`, `description`, `tags`, `scope`, `input_schema`, `output_schema`. **Excluded on purpose:**
- `runtime_type` — binds execution routing; treat as fixed after create (changing it would invalidate certified behavior).
- `visibility` — visibility/paired transitions are derivation-semantics owned by Story 2.3.
- `author`, `org_id`, `created_*` — provenance, immutable.
- `lifecycle_state` — only changes via `PATCH /{id}/lifecycle`.
- versions / `current_version_id` — never touched by a metadata edit.

Use `body.model_dump(exclude_unset=True)` so only fields the caller actually sent are applied (distinguishes "set tags to `[]`" from "don't touch tags"). Decide and document the empty-body behavior (no-op 200 vs. 422 `NO_FIELDS_TO_UPDATE`).

### Retired skills are immutable (decision carried from 2.1 review)

The 2.1 code review established that retired skills cannot be mutated (`create_version` raises `SKILL_RETIRED`). Apply the same rule to `update_skill_metadata`: editing a `retired` skill raises `SkillRetiredError` (422 `SKILL_RETIRED`). Retired skills remain in the registry for audit (FR-REG-09) but are frozen. *(If the team wants to allow metadata corrections on retired skills for audit hygiene, that's a deliberate product decision — flag it in review rather than silently allowing it.)*

### Architecture & pattern constraints (MUST follow — unchanged from 2.1)

- **Response envelope on every route** — `ResponseEnvelope[T]` + `ResponseMeta`; copy the `_meta(request)` helper already in [skills.py](velara-api/app/api/v1/skills.py). Never return a bare dict/list. [enforcement rule 1]
- **snake_case** in all DB columns and JSON fields (Pydantic default; no aliasing). [rule 3]
- **Typed domain exceptions** raised in the service, rendered by the global handler — stable `SCREAMING_SNAKE_CASE` codes, never raw exception text. [rule 5; exceptions.py]
- **Auth seam** — every route depends on `CurrentUser`; scope all queries by `user.org_id`. [dependencies.py]
- **No `hierarchy_path` on skills** — org-level registry, not an ltree node. Do not add hierarchy columns. [core-architectural-decisions.md#Data-Architecture]
- **Async safety** — `await session.execute/commit` directly in async handlers; the metadata PATCH touches no object storage so no `run_in_threadpool` needed. [dependencies.py async-safety note]
- **Co-locate tests**; `pytest` runs `asyncio_mode = "auto"` (no decorator on async tests). [pyproject.toml]

### No new dependencies / no config changes

This story introduces **no new libraries** (FastAPI, SQLAlchemy, Pydantic, structlog are already pinned and in use) and **no new config or buckets** (metadata edits never touch storage). Web-research step was intentionally skipped for that reason. `S3_SKILL_BUCKET` and the storage wiring from 2.1 are reused as-is. Keep the fail-fast config validator green. [Source: stories/2-1...#config]

### Test DB strategy (established in 2.1 — reuse)

DB-backed integration tests live in [tests/integration/api/test_skills.py](velara-api/tests/integration/api/test_skills.py) and **skip** unless Postgres + MinIO are reachable (host-only `pytest` stays green by skipping). Run the full suite via `docker compose exec api pytest`. Reuse the existing `_internal_auth()` / `_auth_headers(role)` helper that mints a dev JWT via `DevAuthProvider`. The shared `skill_payload` fixture already includes a description — write per-test payloads for the AC2 negative cases. Prefer unique names/tags per test for isolation (no rollback wrapper). [Source: stories/2-1...#Test-DB-strategy; tests/integration/api/test_skills.py]

### Previous Story Intelligence (2.1 — apply these)

- **Bound every input.** The 2.1 review added `min_length`/`max_length` caps and a 1 MiB content cap so oversized input is 422, not a 500 from asyncpg `StringDataRightTruncation`. Apply the same to `tags` (`_MAX_TAGS`, `_MAX_TAG_LEN`) and `name` on the PATCH schema.
- **Typed errors must raise, never silently return.** `get_skill` raises `SkillNotFoundError`; `update_skill_metadata` must do the same, never return `None` or a silent no-op on a missing skill.
- **Validate before side effects.** `_validate_description` runs before any S3 write in `create_skill` so a 422 never orphans an artifact (the 2.1 review added `_safe_delete` cleanup for the commit-failure path; don't even reach it for a pure validation failure).
- **Migration discipline.** Hand-author `0003`, confirm column types, the self-FK, the GIN index, and that `upgrade`/`downgrade` round-trip cleanly in Docker (2.1 hit a circular-FK ordering issue — your self-FK is simpler but still verify).

### Project Structure Notes

All edits land in their architecture-designated, already-existing files — **no new top-level files except the migration and (extending) the two test files**:
- Modify: `app/models/skill.py`, `app/schemas/skill.py`, `app/services/skill_service.py`, `app/api/v1/skills.py`.
- New: `app/db/migrations/versions/0003_skill_metadata_tags.py`.
- Extend: `tests/unit/services/test_skill_service.py`, `tests/integration/api/test_skills.py`.
- No change expected to `app/core/config.py`, `app/core/dependencies.py`, `app/integrations/storage.py`, `app/api/v1/router.py`, `docker-compose.yml`, `.env*`. [Source: architecture/project-structure-boundaries.md#FR-to-Structure-Mapping (REG-01–09 → Epic 2)]

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-2-skill-registry-lifecycle.md#Story-2.2] — story + ACs
- [Source: _bmad-output/implementation-artifacts/stories/2-1-skill-data-model-and-registry-api.md] — prior implementation, file list, review decisions to carry forward
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md] — FR-REG-03 (metadata incl. tags), FR-REG-04 (scope), FR-REG-05 (visibility), FR-REG-07 (description first-class)
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] — envelope, snake_case, stable enums, typed errors, co-located tests, enforcement rules
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Data-Architecture] — org-level skill registry, IP protection
- [Source: velara-api/app/core/exceptions.py] — `VALIDATION_ERROR` is generic → why `MISSING_DESCRIPTION` is a domain exception
- [Source: velara-api/app/models/skill.py, app/schemas/skill.py, app/services/skill_service.py, app/api/v1/skills.py, tests/integration/api/test_skills.py] — exact code being extended

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
- Pre-existing `create_version` FK ordering bug (story 2.1 in-progress, pending re-run): SQLAlchemy emitted `UPDATE skills.current_version_id` before `INSERT skill_versions` because there is no ORM relationship from `Skill.current_version_id` to `SkillVersion`. Fixed by adding `await session.flush()` after `session.add(new_version)` to ensure the INSERT precedes the FK UPDATE. This was not a 2.2 regression but was surfaced by the test run.

### Completion Notes List
- AC1: `runtime_type` and `visibility` enum validation enforced by Pydantic `Literal` type — invalid values return 422 `VALIDATION_ERROR`.
- AC2: `description` kept `nullable=True` at DB level; `_validate_description()` in service raises `MissingDescriptionError` (422 `MISSING_DESCRIPTION`) before any S3 write, ensuring no orphaned artifacts on validation failure.
- AC3: `runtime_type` stored as VARCHAR(16) and exposed on `SkillRead`; execution routing is Epic 3.
- AC4: `paired_with` nullable self-FK added in migration `0003`; exposed on `SkillRead` as `null`; derivation logic is Story 2.3.
- AC5: `assert_scope_satisfied(skill, *, study_context_present)` pure guard added; proven with unit tests; Epic 3/5 execution routes will call alongside `assert_invocable`.
- AC6: `tags` JSONB array + GIN index; `_normalize_tags` strips/deduplicates/bounds-checks; `GET ?tag=` filters via JSONB containment (`@>` operator).
- AC7: `PATCH /{skill_id}` metadata-only route; `SkillMetadataUpdate` excludes `runtime_type`, `visibility`, provenance, lifecycle, versions; empty body → 422 `NO_FIELDS_TO_UPDATE`; retired skill → 422 `SKILL_RETIRED`; blank description → 422 `MISSING_DESCRIPTION`.
- All 131 tests pass (99 original + 32 new); ruff clean; migration round-trips verified.

### File List
- `velara-api/app/models/skill.py` — added `tags` (JSONB+GIN) and `paired_with` (nullable self-FK) columns
- `velara-api/app/schemas/skill.py` — added `_MAX_TAGS`, `_MAX_TAG_LEN`, `_normalize_tags`; updated `SkillCreate` (tags + validator); updated `SkillRead` (tags, paired_with); added `SkillMetadataUpdate`
- `velara-api/app/services/skill_service.py` — added `MissingDescriptionError`, `SkillScopeError`, `NoFieldsToUpdateError`, `_validate_description`, `assert_scope_satisfied`, `update_skill_metadata`; updated `create_skill` (tags param + description validation); updated `list_skills` (tag filter); fixed pre-existing `create_version` flush ordering bug
- `velara-api/app/api/v1/skills.py` — updated `create_skill` route (tags passthrough); updated `list_skills` route (tag query param); added `PATCH /{skill_id}` metadata update route
- `velara-api/app/db/migrations/versions/0003_skill_metadata_tags.py` — new migration: adds tags + paired_with columns, GIN index, self-FK
- `velara-api/tests/unit/services/test_skill_service.py` — added `TestValidateDescription` and `TestAssertScopeSatisfied` test classes
- `velara-api/tests/integration/api/test_skills.py` — added 32 new integration tests covering all 7 ACs for story 2.2

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-09 | Created Story 2.2 context: metadata validation (MISSING_DESCRIPTION domain error), tags (JSONB+GIN) + ?tag= filter, paired_with column exposure (null until 2.3), scope guard, metadata-only PATCH. Built on 2.1 implementation analysis. | Bob (Scrum Master) |
| 2026-06-09 | Implemented all 6 tasks: model changes (tags+paired_with), migration 0003, schema updates (SkillCreate/SkillRead/SkillMetadataUpdate), service layer (3 new exceptions, _validate_description, assert_scope_satisfied, update_skill_metadata, tag filter), routes (PATCH metadata + tag query param), tests (32 new). Also fixed pre-existing create_version FK ordering bug from 2.1. 131/131 tests pass, ruff clean. | Dev Agent |
