---
baseline_commit: 0c8c37a
---

# Story 2.3: Paired Skill Derivation Lineage

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Repo: velara-api (FastAPI backend). All paths below are relative to the velara-api repo root. -->
<!-- This is a backend-only story. No velara-web work (the registry/lineage UI is Story 2.4). -->

## Story

As an MA Tech developer,
I want to link an internal skill to its derived client-facing version and track lineage,
so that when the internal (parent) skill changes, the derived (client-facing) version is automatically flagged for review before it can be re-certified.

## Acceptance Criteria

1. **Derive a client-facing skill from a paired internal skill.** `POST /api/v1/skills/{skill_id}/derive` on a parent skill whose `visibility == "paired"` creates a **new** skill with `visibility: "client_facing"`, `lifecycle_state: "draft"`, version `1.0.0`, and `derived_from: {parent_skill_id, parent_version}` recorded — where `parent_version` is the parent's current version string at derive time. The new (child) skill is returned with HTTP **201**. *(FR-REG-05, FR-REG-06)*
   - Deriving from a skill whose `visibility != "paired"` returns **422** `{"error": {"code": "SKILL_NOT_DERIVABLE", ...}}` (only paired skills are derivation sources).
   - Deriving from a non-existent / cross-org parent returns **404** `SKILL_NOT_FOUND` (reuse `get_skill` org-scoping).
   - Deriving from a **retired** parent returns **422** `SKILL_RETIRED` (retired skills are frozen — carry the 2.1/2.2 immutability rule).
2. **Lineage object on both sides.** `GET /api/v1/skills/{skill_id}` returns a `lineage` object on the skill-detail response: the **parent** includes `derived_skills: [{skill_id, visibility, lifecycle_state}, ...]` (one-to-many) and the **child** includes `derived_from: {parent_skill_id, parent_version}`. A skill with neither side returns `lineage: {derived_from: null, derived_skills: []}`. *(FR-REG-06)*
3. **Publishing a new parent version flags all derived children for review.** When `POST /api/v1/skills/{skill_id}/versions` succeeds on a parent skill, **every** skill whose `derived_from.parent_skill_id == parent.id` has `review_required` set to `true` automatically, in the **same transaction** as the version create. *(FR-REG-06)*
4. **A child flagged for review cannot advance to `client_ready`.** Advancing a skill that has `review_required == true` to `client_ready` (via `PATCH /api/v1/skills/{skill_id}/lifecycle`) returns **422** `{"error": {"code": "DERIVED_SKILL_REVIEW_REQUIRED", ...}}`. All other transitions (e.g. → `internal_ready`, → `retired`) are unaffected by the flag. *(FR-REG-06)*
   - *Note:* the AC text says "via the certification workflow" — that workflow is **Epic 6** and does not exist yet. The **only** path to `client_ready` today is the lifecycle PATCH, so the guard lives in `transition_lifecycle`. Epic 6's certification path will call the same service guard and inherit this behavior. Do **not** build any certification UI/endpoint here.
5. **Acknowledging the parent change clears the flag.** `POST /api/v1/skills/{skill_id}/acknowledge-parent-update` sets `review_required` to `false` and returns the updated skill (**200**), after which the `client_ready` advance in AC4 succeeds. Calling it on a skill that is **not** `review_required` is an idempotent **200** no-op (returns the skill with `review_required: false`). Unknown / cross-org id → **404** `SKILL_NOT_FOUND`.

> **Scope guard — what is NOT in this story.**
> - **Registry / lineage UI** (browse, detail, the lineage panel, derive button) is **Story 2.4 / 2.5**. This story is backend-only.
> - **Certification workflow** (technical + methodological cert, the `review_required` *warning banner* in the cert UI) is **Epic 6**. This story only adds the *service guard* that the cert path will call and the `acknowledge-parent-update` endpoint that clears the flag.
> - **IP-protection route enforcement** (client-scoped tokens having no route to skill internals) is **Epic 8 / ACL-03..05**. This story does not add client tokens or route-prefix filtering — but **do not** leak parent internals through the child's lineage (see Dev Notes "IP protection — lineage must not leak parent internals").
> - **`runtime_type`-based execution dispatch** is **Epic 3**. The derived skill stores a `runtime_type`; do not route on it.
> - Re-flagging derived skills when the parent reaches `client_ready` (UJ-3 wording) is **NOT** an AC of this story. The story's trigger is explicitly **new parent version published** (AC3). Implement only AC3's trigger; see Dev Notes "Flag trigger: version publish, not lifecycle advance".

## Tasks / Subtasks

- [x] **Task 1 — Model changes** (AC: 1, 2, 3, 4, 5)
  - [x] In [app/models/skill.py](velara-api/app/models/skill.py) add to `Skill`:
    - `derived_from: Mapped[dict | None]` → `mapped_column(JSONB, nullable=True)`. Holds `{"parent_skill_id": "<uuid-str>", "parent_version": "<semver>"}`; `null` for non-derived skills. Store the UUID as a **string** inside JSONB (JSONB has no native UUID type) — be consistent so the AC3 containment query matches.
    - `review_required: Mapped[bool]` → `mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))`.
  - [x] **Reuse the existing `paired_with` self-FK column** (added in 0003) for the 1:1 pairing pointer: on `derive`, set the **child's** `paired_with = parent.id` AND the **parent's** `paired_with = child.id` (so 2.2's promise that `paired_with` is "populated by Story 2.3" is fulfilled symmetrically). `derived_skills` (the *list*) is **computed by query**, not by this column — see Task 4. Do **not** add a new FK column for the child pointer.
  - [x] Add a GIN index for the derivation containment query: `Index("idx_skills_derived_from", "derived_from", postgresql_using="gin")` in `__table_args__` (lets AC3 find children via `derived_from @> '{"parent_skill_id": "<id>"}'` without a full scan).
  - [x] No `__init__.py` change (Skill already imported); re-verify Alembic autogenerate sees the two new columns + index.
- [x] **Task 2 — Alembic migration `0004_skill_derivation_lineage`** (AC: 1, 3, 4)
  - [x] Create `app/db/migrations/versions/0004_skill_derivation_lineage.py` with `revision = "0004_skill_derivation_lineage"`, `down_revision = "0003_skill_metadata_tags"`. **Hand-author** it, mirroring the style of [0003_skill_metadata_tags.py](velara-api/app/db/migrations/versions/0003_skill_metadata_tags.py) (it is the latest revision — chain from it).
  - [x] `upgrade()`: `op.add_column("skills", derived_from JSONB NULL)`; `op.add_column("skills", review_required BOOLEAN NOT NULL server_default text("false"))`; `op.create_index("idx_skills_derived_from", "skills", ["derived_from"], postgresql_using="gin")`.
  - [x] `downgrade()`: drop index, drop both columns (reverse order). Do **not** touch `paired_with` or its FK (owned by 0003).
  - [x] Verify `alembic upgrade head` then `alembic downgrade -1` round-trip cleanly via `docker compose exec api alembic upgrade head` / `... downgrade -1`. Existing 2.1/2.2 rows must survive (both new columns are nullable / defaulted). **Verified:** columns + GIN index created on upgrade, fully dropped on downgrade, re-applied cleanly; DB at `0004` head.
- [x] **Task 3 — Schemas** (AC: 1, 2)
  - [x] In [app/schemas/skill.py](velara-api/app/schemas/skill.py):
    - Add `SkillDeriveRequest(BaseModel)` — the client-facing child payload. Required: `name` (`min_length=1, max_length=_MAX_NAME`), `author` (same bounds), `initial_content` (`max_length=_MAX_CONTENT_LEN`). Optional: `description: str | None = None` (service runs `_validate_description` → child still needs a description, MISSING_DESCRIPTION applies), `content_type: str = Field(default="text/plain", max_length=_MAX_CONTENT_TYPE)`, `runtime_type: RuntimeType | None = None` (defaults to the parent's `runtime_type` if omitted), `scope: Scope | None = None`, `input_schema`/`output_schema: dict | None = None`, `tags: list[str] = Field(default_factory=list)` (reuse `normalize_tags` before-validator). Do **not** accept `visibility` (forced to `client_facing`) or `derived_from` (server-set).
    - Add `DerivedFrom(BaseModel)`: `parent_skill_id: uuid.UUID`, `parent_version: str`. (Serialize the stored JSONB dict through this for a typed, validated shape.)
    - Add `DerivedSkillRef(BaseModel)`: `skill_id: uuid.UUID`, `visibility: str`, `lifecycle_state: str`.
    - Add `SkillLineage(BaseModel)`: `derived_from: DerivedFrom | None = None`, `derived_skills: list[DerivedSkillRef] = Field(default_factory=list)`.
    - Add `derived_from` and `review_required` to **`SkillRead`**: `derived_from: dict | None` and `review_required: bool`. (Keep them on the flat read so list/create responses expose them too.)
    - Add `lineage: SkillLineage | None = None` to **`SkillReadWithVersion`** (the detail schema returned by `GET /{skill_id}`). Only the detail route populates it; list responses leave it `None`.
  - [x] `SkillReadWithVersion` already inherits the new `SkillRead` fields — only add `lineage`.
- [x] **Task 4 — Service layer** (AC: 1, 2, 3, 4, 5)
  - [x] In [app/services/skill_service.py](velara-api/app/services/skill_service.py) add domain exceptions (subclass `VelaraHTTPException`, stable codes; mirror the existing exception classes at the top of the file):
    - `SkillNotDerivableError` → 422 `SKILL_NOT_DERIVABLE` ("Only skills with visibility 'paired' can be derived.").
    - `DerivedSkillReviewRequiredError` → 422 `DERIVED_SKILL_REVIEW_REQUIRED` ("Parent skill changed; acknowledge the update before advancing to client_ready.").
  - [x] Add `async def derive_skill(*, session, storage, parent_skill_id, org_id, child: <fields>, created_by_user_id) -> Skill`:
    - Load parent via `get_skill(...)` (404 if missing/cross-org).
    - If `parent.lifecycle_state == "retired"` → `SkillRetiredError`.
    - If `parent.visibility != "paired"` → `SkillNotDerivableError`.
    - Resolve `parent_version` = the parent's current version string (read from `parent.versions` eager-loaded by `get_skill`; default `"0.0.0"` only if somehow none).
    - Default `runtime_type` to `parent.runtime_type` when the child payload omitted it.
    - Create the child by **reusing `create_skill(...)`** with `visibility="client_facing"`. Then set `child.derived_from`, `child.paired_with = parent.id`, `parent.paired_with = child.id`, commit, refresh. Emits `skill_derived` structlog line.
    - **Order:** lineage update is a second commit after `create_skill`; on follow-up failure it rolls back, logs `skill_derive_lineage_link_failed`, and re-raises (surfaces the error rather than silently half-linking).
  - [x] Lineage built **inline in the route** (typed `DerivedFrom`/`DerivedSkillRef`) rather than a service helper — the route already has the schemas; the pure review-guard helper (`assert_can_advance`) carries the unit-testable logic instead.
  - [x] Add `async def get_derived_skills(*, session, parent_skill_id, org_id) -> list[Skill]`: `select(Skill).where(Skill.org_id == org_id, Skill.derived_from.contains({"parent_skill_id": str(parent_skill_id)}))` (JSONB `@>` containment, uses `idx_skills_derived_from`).
  - [x] Add `async def acknowledge_parent_update(*, session, skill_id, org_id, updated_by_user_id) -> Skill`: load via `get_skill`; set `review_required = False`; `updated_at = now`; commit, refresh; emit `skill_parent_update_acknowledged`. Idempotent.
  - [x] **Wire AC3 into `create_version`:** inside the existing transaction — after `session.flush()` of the new version and before the final `commit()` — run a bulk `update(Skill).where(org + derived_from @> {parent_skill_id}).values(review_required=True, updated_at=now)`, so the flag flip and the version insert commit atomically (a rolled-back version create leaves no stale flags). Logs the affected `rowcount`.
  - [x] **Wire AC4 into `transition_lifecycle`:** after the `_ALLOWED_TRANSITIONS` check passes, call `assert_can_advance(skill, to_state)` → raises `DerivedSkillReviewRequiredError` when `to_state == "client_ready" and skill.review_required`. Ordered after the allowed-transition check so an illegal transition still returns `INVALID_LIFECYCLE_TRANSITION`.
- [x] **Task 5 — Routes** (AC: 1, 2, 5)
  - [x] In [app/api/v1/skills.py](velara-api/app/api/v1/skills.py):
    - Add `POST /{skill_id}/derive` → `derive_skill`. Body = `SkillDeriveRequest`; depends on `CurrentUser` + `DbSession` + `SkillStorage`. Returns `ResponseEnvelope[SkillRead]` with `status_code=201` and `_meta(request)`.
    - Add `POST /{skill_id}/acknowledge-parent-update` → `acknowledge_parent_update`. No body; depends on `CurrentUser` + `DbSession`. Returns `ResponseEnvelope[SkillRead]` (200) with `_meta(request)`.
    - Updated the existing `GET /{skill_id}` handler to populate `lineage`: `DerivedFrom` from `skill.derived_from`, `derived_skills` from `get_derived_skills(...)`. Current-version resolution untouched.
  - [x] Every handler returns `ResponseEnvelope` (enforcement rule 1). Path segment is kebab-case: `acknowledge-parent-update`.
  - [x] **Route ordering:** declared near the other `/{skill_id}/...` sub-routes; distinct trailing segments → no FastAPI matching ambiguity.
- [x] **Task 6 — Tests** (AC: 1–5)
  - [x] **Unit** ([tests/unit/services/test_skill_service.py](velara-api/tests/unit/services/test_skill_service.py), no DB): `TestAssertCanAdvance` — `review_required=True`+`client_ready` raises `DerivedSkillReviewRequiredError`; `+retired` and `+internal_ready` pass; `review_required=False`+`client_ready` passes. (4 tests; mirrors `assert_invocable`/`assert_scope_satisfied`.) The lineage mapping is exercised end-to-end in the integration suite (route builds it inline from schemas).
  - [x] **Integration** ([tests/integration/api/test_skills.py](velara-api/tests/integration/api/test_skills.py), live Postgres + MinIO; reuses skip-guard + `_internal_auth()` + per-test payloads; added `_paired_parent_payload`/`_child_payload`/`_create_paired_parent`/`_lifecycle` helpers): 16 tests covering —
    - **AC1:** happy path (client_facing, draft, 1.0.0, derived_from, paired_with), runtime_type default-to-parent; negatives: internal_only→422 NOT_DERIVABLE, client_facing→422 NOT_DERIVABLE, unknown→404, retired→422 SKILL_RETIRED, blank description→422 MISSING_DESCRIPTION.
    - **AC2:** lineage on parent (`derived_skills`) and child (`derived_from` == parent + `1.0.0`); standalone skill → empty lineage.
    - **AC3:** new parent version flags child; two children both flagged by one publish; unrelated child NOT flagged.
    - **AC4:** flagged child `internal_ready`→`client_ready` → 422 DERIVED_SKILL_REVIEW_REQUIRED (and `draft`→`internal_ready` allowed while flagged); illegal `draft`→`client_ready` still 422 INVALID_LIFECYCLE_TRANSITION.
    - **AC5:** acknowledge clears flag + unblocks client_ready (200); idempotent on un-flagged; unknown→404.
  - [x] Green baseline kept: `ruff check .` clean; **171** tests pass in Docker (151 prior + 20 new). Migration round-trips clean.

## Dev Notes

### Build on 2.1 + 2.2 — do NOT recreate

Stories 2.1/2.2 already shipped: `Skill`/`SkillVersion` models, migrations `0002`/`0003`, the `create_skill` / `get_skill` / `list_skills` / `create_version` / `transition_lifecycle` / `update_skill_metadata` service functions, the `assert_invocable` / `assert_scope_satisfied` guards, the `_ALLOWED_TRANSITIONS` state machine, the `SkillCreate` / `SkillRead` / `SkillReadWithVersion` / `SkillMetadataUpdate` schemas, the full route set, the typed-domain-exception pattern, and the `velara-skills` S3 wiring. The `paired_with` column already exists (0003) — **populate it here, don't add it again**. **Extend in place.** [Source: stories/2-2-skill-metadata-tags-and-visibility-designations.md, stories/2-1-skill-data-model-and-registry-api.md]

This story adds: `derived_from` (JSONB) + `review_required` (bool) columns (migration `0004`), the `/derive` and `/acknowledge-parent-update` routes, the `lineage` object on skill-detail, the version-publish → review-flag trigger, and the `client_ready` review guard.

### Reuse `create_skill` for the child — the single most important reuse (AC1)

`derive_skill` must **call `create_skill`** to make the child, not re-implement it. `create_skill` already: validates the description before any side effect (so a 422 never orphans an S3 object), encodes content → SHA256, writes the artifact to S3 via `run_in_threadpool`, inserts the skill with `current_version_id=None`, flushes, inserts version 1.0.0, flushes, advances the pointer, commits, and runs `_safe_delete` cleanup on failure. Re-implementing any of that is the classic "reinvent the wheel" disaster. Pass `visibility="client_facing"`; set the lineage fields (`derived_from`, `paired_with` both sides) in a **follow-up commit** after `create_skill` returns the child. [Source: app/services/skill_service.py `create_skill` lines 187-278]

### `derived_from` shape & the containment query (AC1, AC3)

Store `derived_from` as JSONB: `{"parent_skill_id": "<uuid-as-string>", "parent_version": "<semver>"}`. **The UUID must be a string** inside JSONB (no native UUID type), and the AC3 query relies on exact string match: `Skill.derived_from.contains({"parent_skill_id": str(parent_id)})` → `derived_from @> '{"parent_skill_id":"..."}'`, indexed by `idx_skills_derived_from` (GIN). This mirrors the proven 2.2 tag pattern (`Skill.tags.contains([tag])`). Be consistent: always `str(uuid)` on write and on query, or the `@>` match silently returns nothing. [Source: app/services/skill_service.py `list_skills` tag-containment lines 308-327]

### `paired_with` (1:1 pointer) vs `derived_skills` (1:many list) — why both (AC2)

2.2 added `paired_with` as a single nullable self-FK and promised 2.3 would populate it. A single UUID can't express a parent with *multiple* derived children, but the story's AC2 needs `derived_skills: [...]` (a list). Resolution:
- Set `paired_with` on **both** sides on derive (parent→child, child→parent) to fulfill 2.2's promise and give a cheap direct pointer. This naturally models the common 1:1 paired case.
- Compute `derived_skills` (the list) by **querying** `derived_from @> {parent_skill_id}` — this is the authoritative one-to-many lineage and supports a parent that is derived more than once. Do **not** try to cram a list into `paired_with`.

`derived_from` is the source of truth for lineage; `paired_with` is a convenience pointer. If they ever disagree, `derived_from` wins (and that's a bug to flag). [Source: epics/epic-2-skill-registry-lifecycle.md#Story-2.3 AC2; stories/2-2...#paired_with]

### Flag trigger: version publish, not lifecycle advance (AC3 — read carefully)

The **story AC3** is unambiguous: the trigger is **"a new version of the parent skill is published"** → flag all derived children. UJ-3 in the PRD describes a *different* moment ("derived version flagged when parent reaches client-ready"). **Implement the story AC, not UJ-3.** The hook is in `create_version`, after the new version row is flushed and the `current_version_id` pointer is set, flipping `review_required=true` on all children in the **same transaction** (a bulk `UPDATE ... WHERE derived_from @> {...}`). Doing it in-transaction means a rolled-back version create (e.g. duplicate-version `IntegrityError`) does **not** leave stale review flags. [Source: epics/epic-2...#Story-2.3 AC3; prds/.../7-user-journeys.md UJ-3 (divergent — not authoritative here)]

### AC4 lives in `transition_lifecycle`, not a new cert endpoint (AC4)

The AC says "advance to `client_ready` via the certification workflow" — but Epic 6's certification workflow does not exist yet, and the **only** code path that reaches `client_ready` today is `PATCH /{id}/lifecycle` → `transition_lifecycle`. Put the guard there: after the `_ALLOWED_TRANSITIONS` check passes, `if to_state == "client_ready" and skill.review_required: raise DerivedSkillReviewRequiredError`. Ordering matters — the allowed-transition check must run first so an illegal target still returns `INVALID_LIFECYCLE_TRANSITION`. When Epic 6 adds its certification service, it calls the same guard (extract it as a small pure helper if convenient). Do not build any Epic 6 surface here. [Source: app/services/skill_service.py `transition_lifecycle` lines 330-358; epics/epic-6-certification-governance.md]

### IP protection — lineage must not leak parent internals (ACL-03..05)

The architecture enforces that **client-scoped tokens have no route to skill internals; enforced at the FastAPI router prefix, not just RBAC** — and ACL-03/05 require that a client-facing skill's instructions/code/reference content are *never* returned by any API surface. Story 2.3 doesn't introduce client tokens (that's Epic 8), but the `lineage` object you add **must not** become a back-door: `DerivedFrom` exposes only `parent_skill_id` + `parent_version` (identifiers, not content); `DerivedSkillRef` exposes only `skill_id`, `visibility`, `lifecycle_state`. **Never** include the parent's `artifact_key`, prompt/code content, `input_schema`/`output_schema` internals, or version artifact in the child's lineage. `SkillRead` already omits `artifact_key` by design (IP protection from 2.1) — keep it that way; do not widen it. [Source: architecture/core-architectural-decisions.md#Data-Architecture (IP protection); prds/.../5-functional-requirements.md ACL-03..05]

### Architecture & pattern constraints (MUST follow — unchanged from 2.1/2.2)

- **Response envelope on every route** — `ResponseEnvelope[T]` + `_meta(request)`; never a bare dict/list. [enforcement rule 1]
- **snake_case** in all DB columns and JSON fields — `derived_from`, `derived_skills`, `review_required`, `parent_skill_id`, `parent_version` (Pydantic default; no aliasing). [rule 3]
- **kebab-case** path segments — `acknowledge-parent-update`. [naming conventions]
- **Typed domain exceptions** raised in the service, rendered by the global handler — stable `SCREAMING_SNAKE_CASE` codes (`SKILL_NOT_DERIVABLE`, `DERIVED_SKILL_REVIEW_REQUIRED`), never raw text. [rule 5; app/core/exceptions.py]
- **Org-scoping on every query** — every `select` filters by `user.org_id`; `derive`, `get_derived_skills`, `acknowledge` all scope to org. Cross-org parent → 404. [dependencies.py CurrentUser]
- **No `hierarchy_path` on skills** — org-level registry, not an ltree node. Do not add hierarchy columns. [core-architectural-decisions.md#Data-Architecture]
- **Async safety** — `derive_skill` writes an artifact (via reused `create_skill`, which already wraps S3 in `run_in_threadpool`); `acknowledge` and the lineage read touch no storage, so no threadpool needed there. [dependencies.py async-safety note]
- **Never store content inline** — the child's artifact lives in S3 (reused `create_skill` path); only the S3 key + metadata in the DB. [rule 6]
- **Co-locate tests**; `pytest` runs `asyncio_mode = "auto"` (no decorator on async tests). [pyproject.toml]

### Migration discipline (carry from 2.1/2.2)

Hand-author `0004` chaining from `0003_skill_metadata_tags` (the current head). Both new columns are additive and nullable/defaulted, so existing 2.1/2.2 rows survive `upgrade`. Confirm column types (JSONB, BOOLEAN), the GIN index, and that `upgrade`/`downgrade` round-trip cleanly in Docker. 2.1 hit a circular-FK ordering issue and 2.2 verified the self-FK — your `0004` adds no FKs (it reuses the existing `paired_with` FK from 0003), so it's the simplest migration yet; still round-trip it. [Source: app/db/migrations/versions/0003_skill_metadata_tags.py; stories/2-2...#Migration-discipline]

### No new dependencies / no config changes

No new libraries (FastAPI, SQLAlchemy, Pydantic, structlog already pinned) and no new buckets/config — the derived child reuses the existing `velara-skills` storage via `create_skill`. The web-research step was intentionally skipped: this is pure in-stack backend work on already-pinned versions. Keep the fail-fast config validator green. [Source: stories/2-2...#No-new-dependencies]

### Test DB strategy (established in 2.1/2.2 — reuse)

DB-backed integration tests live in [tests/integration/api/test_skills.py](velara-api/tests/integration/api/test_skills.py) and **skip** unless Postgres + MinIO are reachable (host-only `pytest` stays green by skipping). Run the full suite via `docker compose exec api pytest`. Reuse `_internal_auth()` / `_auth_headers(role)` (mints a dev JWT via `DevAuthProvider`). The shared `skill_payload` fixture defaults `visibility: "internal_only"` — **the AC1 happy-path needs a `paired` parent**, so build a per-test paired payload (or a local helper that creates a paired parent and returns its id). Prefer unique names per test for isolation (no rollback wrapper). [Source: stories/2-2...#Test-DB-strategy; tests/integration/api/test_skills.py]

### Previous Story Intelligence (2.1 / 2.2 — apply these)

- **Bound every input.** Reuse `_MAX_NAME`, `_MAX_CONTENT_LEN`, `_MAX_CONTENT_TYPE`, `normalize_tags` on `SkillDeriveRequest` exactly as `SkillCreate` does — oversized input must be 422, never a 500 from asyncpg truncation. [2.1 review]
- **TypeError from a field_validator does NOT become 422 in this stack — raise `ValueError`.** 2.2 hit this: a bare `TypeError` escaped to the 500 handler. Any new validator must raise `ValueError`. [2.2 review patch, schemas/skill.py:46-52]
- **Validate before side effects.** `create_skill` (which `derive_skill` reuses) validates the description before the S3 write — so a missing-description derive 422s without orphaning an artifact. Don't reorder. [2.1/2.2]
- **Typed errors must raise, never silently return.** `get_skill` raises `SkillNotFoundError`; `derive_skill` / `acknowledge_parent_update` must do the same on a missing/cross-org id — never `None` or a silent no-op. [2.1/2.2]
- **Retired skills are immutable.** `create_version` already blocks retired skills; `derive_skill` must block a retired parent (`SkillRetiredError`) for the same reason. [2.1 review carried into 2.2]
- **`@>` containment needs exact-typed operands.** The 2.2 tag filter taught that JSONB containment is exact-match — `str(uuid)` consistently on both write and query for `derived_from.parent_skill_id`, or the AC3 flag-flip silently matches zero rows. [2.2 tag-filter]
- **Bulk UPDATE inside the version transaction.** The AC3 flag flip should ride the same commit as the version insert so a rolled-back version create (duplicate-version `IntegrityError` path at create_version lines 428-434) doesn't leave stale flags. [2.1 flush-ordering lesson — keep related writes in one transaction]

### Git Intelligence

`velara-api` is a git repo (the workspace root is not, but `velara-api/` is). Recent commits: `0c8c37a 2-2-skill-metadata-tags-and-visibility-designations` (the baseline for this story), `db57797 1-4-dev-authentication-shim`, `5e13817 1-3-local-dev-environment-and-provider-abstractions`. Each story lands as one commit after its code review passes. The 2.2 commit is `baseline_commit` in this file's frontmatter; review diffs from there.

### Project Structure Notes

All edits land in their architecture-designated, already-existing files — **no new top-level files except the migration**:
- Modify: `app/models/skill.py`, `app/schemas/skill.py`, `app/services/skill_service.py`, `app/api/v1/skills.py`.
- New: `app/db/migrations/versions/0004_skill_derivation_lineage.py`.
- Extend: `tests/unit/services/test_skill_service.py`, `tests/integration/api/test_skills.py`.
- No change expected to `app/core/config.py`, `app/core/dependencies.py`, `app/integrations/storage.py`, `app/api/v1/router.py`, `docker-compose.yml`, `.env*`. [Source: architecture/project-structure-boundaries.md#FR-to-Structure-Mapping (REG-01–09 → Epic 2)]

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-2-skill-registry-lifecycle.md#Story-2.3] — story + ACs (lines 77-104)
- [Source: _bmad-output/implementation-artifacts/stories/2-2-skill-metadata-tags-and-visibility-designations.md] — `paired_with` column promise, `@>` containment pattern, validator-TypeError-vs-ValueError lesson, retired-immutable rule, test strategy
- [Source: _bmad-output/implementation-artifacts/stories/2-1-skill-data-model-and-registry-api.md] — create_skill/version flush ordering, assert_invocable guard pattern, IP-protection omission of artifact_key
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md] — FR-REG-05 (visibility incl. paired), FR-REG-06 (paired lineage + parent-update review flag)
- [Source: _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md] — REG-05/06 (paired lineage), ACL-03/04/05 (IP protection, client API surface)
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Data-Architecture] — org-level registry, skill IP protection at router prefix
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] — response envelope, snake_case, kebab-case paths, typed errors, co-located tests
- [Source: _bmad-output/planning-artifacts/epics/epic-6-certification-governance.md] — where AC4's review guard is later consumed (cert UI warning); NOT built here
- [Source: velara-api/app/models/skill.py, app/schemas/skill.py, app/services/skill_service.py, app/api/v1/skills.py, app/db/migrations/versions/0003_skill_metadata_tags.py, tests/integration/api/test_skills.py] — exact code being extended

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- **Container source is baked at image build, not bind-mounted.** The `api`/`worker` services in `docker-compose.yml` have `build:` but no `volumes:` mount of the source. New code (incl. migration `0004`) is invisible to the running container until `docker compose build api && docker compose up -d api`. Initial `alembic heads` showed `0003` until the image was rebuilt; after rebuild it showed `0004`. All test/migration runs below are post-rebuild.

### Completion Notes List

- **AC1** — `POST /{skill_id}/derive` creates a `client_facing` child in `draft`/`1.0.0` with `derived_from: {parent_skill_id, parent_version}`. Reuses `create_skill` for the artifact write + version + description validation (no reinvention); lineage fields + symmetric `paired_with` set in a second commit. Negatives: non-paired→422 `SKILL_NOT_DERIVABLE`, unknown→404 `SKILL_NOT_FOUND`, retired parent→422 `SKILL_RETIRED`, blank description→422 `MISSING_DESCRIPTION` (inherited from `create_skill`). `runtime_type` defaults to the parent's when omitted.
- **AC2** — `GET /{skill_id}` now returns a `lineage` object: parent side `derived_skills: [{skill_id, visibility, lifecycle_state}]` via JSONB-containment query; child side `derived_from: {parent_skill_id, parent_version}`. Standalone skill → `{derived_from: null, derived_skills: []}`. Identifiers only — no parent/child artifact content (IP protection preserved).
- **AC3** — `create_version` flips `review_required=True` on every derived child **inside the same transaction** as the version insert (bulk `UPDATE ... WHERE derived_from @> {parent_skill_id}`), so a rolled-back version create leaves no stale flags. Verified one publish flags all children and leaves unrelated children untouched.
- **AC4** — `transition_lifecycle` calls the new pure `assert_can_advance(skill, to_state)` guard **after** the `_ALLOWED_TRANSITIONS` check, so a flagged child → 422 `DERIVED_SKILL_REVIEW_REQUIRED` on `client_ready`, while an illegal target still returns `INVALID_LIFECYCLE_TRANSITION`. Other transitions are unaffected by the flag.
- **AC5** — `POST /{skill_id}/acknowledge-parent-update` clears `review_required` (idempotent 200 on an un-flagged skill, 404 on unknown id); after acknowledgement the `client_ready` advance succeeds.
- **Validation:** `ruff check .` clean; **171/171** tests pass in Docker (151 prior + 20 new: 16 integration + 4 unit); migration `0004` upgrade→downgrade→upgrade round-trips cleanly; DB at `0004` head.
- **Atomicity note (carried from story Dev Notes):** the child's lineage link is a second commit after `create_skill`'s own commit. On follow-up failure it rolls back + logs `skill_derive_lineage_link_failed` + re-raises. Strict single-transaction atomicity would require refactoring `create_skill` to not self-commit — intentionally **not** done here to avoid changing its contract.

### File List

- `velara-api/app/models/skill.py` — added `derived_from` (JSONB) + `review_required` (Boolean) columns, `idx_skills_derived_from` GIN index, `Boolean` import; documented `paired_with` dual-side use
- `velara-api/app/schemas/skill.py` — added `derived_from`/`review_required` to `SkillRead`; new `DerivedFrom`, `DerivedSkillRef`, `SkillLineage`, `SkillDeriveRequest`; added `lineage` to `SkillReadWithVersion`
- `velara-api/app/services/skill_service.py` — new exceptions `SkillNotDerivableError`, `DerivedSkillReviewRequiredError`; new `assert_can_advance` guard; new `derive_skill`, `get_derived_skills`, `acknowledge_parent_update`; wired AC3 flag-flip into `create_version` (in-transaction bulk UPDATE, `update` import); wired AC4 guard into `transition_lifecycle`
- `velara-api/app/api/v1/skills.py` — new `POST /{skill_id}/derive` and `POST /{skill_id}/acknowledge-parent-update` routes; `GET /{skill_id}` now builds the `lineage` object; added lineage/derive schema imports
- `velara-api/app/db/migrations/versions/0004_skill_derivation_lineage.py` — new migration: adds `derived_from`, `review_required`, GIN index (chains from `0003`)
- `velara-api/tests/unit/services/test_skill_service.py` — added `TestAssertCanAdvance` (4 tests) + import
- `velara-api/tests/integration/api/test_skills.py` — added Story 2.3 section: 4 derive helpers + 16 integration tests across all 5 ACs

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-09 | Created Story 2.3 context: paired-skill derivation (`/derive` → client_facing child + `derived_from`), lineage object on skill-detail (`derived_skills`/`derived_from`), version-publish → `review_required` flag trigger (in-transaction bulk UPDATE), `client_ready` review guard in `transition_lifecycle`, `acknowledge-parent-update` clear. Reuses `create_skill` for the child; reuses 0003 `paired_with` column; adds `0004` migration for `derived_from`/`review_required`. Built on 2.1/2.2 code analysis + architecture IP-protection constraints. | Bob (Scrum Master) |
| 2026-06-09 | Implemented all 6 tasks: model (`derived_from`/`review_required` + GIN index), migration `0004` (round-trips clean), schemas (`SkillDeriveRequest`/`DerivedFrom`/`DerivedSkillRef`/`SkillLineage` + `SkillRead`/`SkillReadWithVersion` extensions), service (`derive_skill`/`get_derived_skills`/`acknowledge_parent_update`/`assert_can_advance` + AC3 in-transaction flag-flip in `create_version` + AC4 guard in `transition_lifecycle`), routes (`/derive`, `/acknowledge-parent-update`, lineage on `GET /{id}`), tests (4 unit + 16 integration). 171/171 tests pass in Docker, ruff clean. | Dev Agent (claude-opus-4-8) |
| 2026-06-09 | Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): all 5 ACs satisfied; 1 decision-needed (`paired_with` multi-child overwrite), 1 patch (`DerivedFrom` model_validate hardening), 3 deferred, 6 dismissed. See Review Findings. | Code Review |
| 2026-06-10 | Review patches applied → Status `done`: (1) `derive_skill` nulls `parent.paired_with` once a parent has >1 child (option 3) + new `test_derive_multiple_children_nulls_parent_paired_with`; (2) `GET /{id}` lineage uses `DerivedFrom.model_validate` (malformed-JSONB hardening). 3 items deferred to deferred-work.md. ruff clean; 114 skills+unit tests pass (58 integration incl. new test). | Code Review |

## Review Findings

_Adversarial code review 2026-06-09 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 5 ACs SATISFIED. 1 decision-needed, 1 patch, 3 deferred, 6 dismissed as noise._

- [x] [Review][Decision→Patch] `parent.paired_with` overwritten on every derive of the same parent — `paired_with` is a scalar self-FK, but a parent may have N derived children. Flagged High by both Blind + Edge hunters; Acceptance Auditor notes `derived_from`/`derived_skills` remain authoritative so AC2 is unaffected. **Resolved (option 3):** `derive_skill` now counts the parent's prior children (`get_derived_skills`) and sets `parent.paired_with = child.id` only for the first child, nulling it once a 2nd child exists (stays null for the 3rd+). Child→parent pointer always set. [app/services/skill_service.py:642-656]. New integration test `test_derive_multiple_children_nulls_parent_paired_with` locks in the behavior. ✅ applied.
- [x] [Review][Patch] `DerivedFrom(**skill.derived_from)` was brittle to malformed/extra-key JSONB — a stored dict with an unexpected key would raise `TypeError`→500 on a plain `GET /{skill_id}`. **Switched to `DerivedFrom.model_validate(skill.derived_from)`** (extra-key tolerant). [app/api/v1/skills.py:138] ✅ applied.
- [x] [Review][Defer] `parent_version` "0.0.0" defensive fallback can be silently persisted into a child's `derived_from` if a parent ever lacks a `current_version` — narrow trigger (a freshly `create_skill`-ed parent always has 1.0.0), but the bogus lineage is stored, not rejected. [app/services/skill_service.py:610] — deferred, narrow trigger / pre-existing defensive path
- [x] [Review][Defer] `get_derived_skills` lineage query is unbounded (no `LIMIT`) and runs on every `GET /{skill_id}` detail fetch — fan-out for a parent with many children. Consistent with other unbounded list endpoints in the codebase. [app/services/skill_service.py:671] — deferred, consistent with existing pattern
- [x] [Review][Defer] Acknowledge-during-publish race — `review_required` is a plain boolean with no version/sequence token, so an `acknowledge-parent-update` that lands after a *second* parent publish clears the flag for the newer un-reviewed change too. This is the AC5-defined boolean-clear behavior; sequencing is beyond this story's scope. [app/services/skill_service.py:704] — deferred, matches AC5 boolean design / out of scope
