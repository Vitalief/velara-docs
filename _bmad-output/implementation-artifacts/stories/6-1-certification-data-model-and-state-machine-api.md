---
baseline_commit: 281bba7
---

# Story 6.1: Certification Data Model & State Machine API

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform developer,
I want the `CertificationRecord` data model and the certification state-machine API,
So that the two-key (technical + methodological) certification workflow is enforced structurally — a skill version cannot reach `client_ready` without both keys recorded immutably as 21 CFR Part 11 electronic signatures.

## Acceptance Criteria

**AC1 — `certification_records` schema (write-once):**
**Given** the Alembic migration for `certification_records` runs
**When** I inspect the schema
**Then** the table has: `id`, `skill_id`, `skill_version_id` (FK → `skill_versions.id`), `skill_version` (semver string snapshot), `certification_type` (`technical` | `methodological`), `certifier_user_id`, `certifier_role`, `certified_at` (UTC), `signature_meaning`, `notes`, `org_id` — and is **append-only at the DB layer** (UPDATE/DELETE/TRUNCATE rejected by trigger, mirroring `audit_log_entries`)
[Source: epic-6-certification-governance.md:13-15 (AC); migration 0006 trigger pattern]

**AC2 — Record a certification → 201, set flag:**
**Given** I call `POST /api/v1/certifications` with a valid technical-certification payload (`skill_id`, `certification_type: "technical"`, optional `notes`)
**When** the payload is valid and the skill version is the skill's current version
**Then** a `CertificationRecord` is created bound to the current `skill_version_id`, the certifier identity/role/UTC-timestamp/signature-meaning are captured, and HTTP **201** is returned wrapped in `ResponseEnvelope`
[Source: epic-6-certification-governance.md:17-19, 33-35]

**AC3 — Two-key gate on advance to `client_ready` → 422 `CERTIFICATION_INCOMPLETE`:**
**Given** the platform evaluates lifecycle eligibility for advancing a skill to `client_ready`
**When** both technical AND methodological certifications exist for the skill's **current** version → the advance is permitted; **otherwise** advancing returns HTTP **422** with code `CERTIFICATION_INCOMPLETE`
**And** this gate is enforced inside the EXISTING `assert_can_advance()` guard (called by the EXISTING `PATCH /api/v1/skills/{skill_id}/lifecycle` route) — no new advance endpoint is added
[Source: epic-6-certification-governance.md:21-23; skill_service.py:655-664 — guard reserved for "Epic 6's certification path"]

**AC4 — Re-certification required on new version → 422 `RECERTIFICATION_REQUIRED`:**
**Given** a skill was `client_ready` at version 1.0.0 and version 1.1.0 is then published
**When** the new version is published, the skill's `lifecycle_state` is reset to `draft` (re-cert needed); previous-version certifications are preserved in history but do NOT carry over to the new version
**And** if the new version is somehow targeted for `client_ready` without both keys against that version, the advance returns HTTP **422** with code `RECERTIFICATION_REQUIRED`
[Source: epic-6-certification-governance.md:25-27, 119-121; FR-CRT-04 requirements-inventory.md:76]

**AC5 — Records are immutable → 405:**
**Given** a certification record exists
**When** any user attempts to UPDATE or DELETE it via the API
**Then** the API returns HTTP **405** Method Not Allowed — achieved by declaring ONLY POST + GET routes (Starlette returns 405 automatically; the global handler envelopes it); the DB-level trigger is the defense-in-depth backstop
[Source: epic-6-certification-governance.md:29-31; exceptions.py:83-94 http_exception_handler covers 405]

**AC6 — 21 CFR Part 11 electronic signature (FR-SEC-10):**
**Given** a certification record is created
**When** it is persisted
**Then** it constitutes an electronic signature capturing: signer identity (`certifier_user_id`, intended to be resolvable to a printed name — see Decision D3), UTC timestamp (`certified_at`), and the **meaning** of the signature (`signature_meaning`, e.g. `technical_certification` / `methodological_certification`) — bound immutably to the specific `skill_version_id`
[Source: epic-6-certification-governance.md:33-35; FR-SEC-10 requirements-inventory.md:101; core-architectural-decisions.md:95 §11.50/§11.70]

**AC7 — History query:**
**Given** certification records exist for a skill
**When** I call `GET /api/v1/certifications?skill_id={id}`
**Then** all certification records for that skill (across all versions) are returned in chronological order (oldest `certified_at` first), org-scoped, wrapped in `ResponseEnvelope` with the standard `PageMeta` paginated shape
[Source: epic-6-certification-governance.md:128-129 (story 6.4 GET, mechanism built here); implementation-patterns-consistency-rules.md:75-79 pagination SHOULD]

## Tasks / Subtasks

> **SCOPE: BACKEND-ONLY.** No frontend, no new dependency. One migration (`0015`). The certification *UI* (6.2/6.3), the auto-advance-on-2nd-key UX flow (6.3), and certification *history UI* (6.4) are LATER stories. This story builds the **data model + state-machine API + the eligibility mechanism** they will consume.

- [x] **Task 1 — Domain exceptions (AC: 3, 4) — in NEW `app/services/certification_service.py`**
  - [x] Define `CertificationIncompleteError(VelaraHTTPException)`: `ERROR_CODE = "CERTIFICATION_INCOMPLETE"`, `super().__init__(422, ...)`. Message: PHI-safe, e.g. `"Skill cannot advance to client_ready: both technical and methodological certifications are required for the current version."` — do NOT echo which key is missing in a way that leaks skill internals; naming the missing key (technical/methodological) is fine (it is governance state, not IP).
  - [x] Define `RecertificationRequiredError(VelaraHTTPException)`: `ERROR_CODE = "RECERTIFICATION_REQUIRED"`, `super().__init__(422, ...)`. Message names that a new version requires re-certification.
  - [x] Follow the EXACT subclass pattern at `skill_service.py:53-79` (class attr `ERROR_CODE` + `super().__init__(status, ERROR_CODE, message)`). **No central error-code registry exists** — the global `velara_http_exception_handler` (`exceptions.py:68-80`) auto-renders any `VelaraHTTPException`. Do NOT edit any mapper dict (there is none).
  - [x] Error codes are **permanent once shipped** — `CERTIFICATION_INCOMPLETE` / `RECERTIFICATION_REQUIRED` are the AC-mandated names; do not rename. [Source: execution-engine-patterns.md:88-91]

- [x] **Task 2 — `CertificationRecord` ORM model — NEW `app/models/certification.py` (AC: 1, 6)**
  - [x] Create `class CertificationRecord(Base)`, `__tablename__ = "certification_records"`. Mirror the column idioms in `app/models/audit.py` and `app/models/skill.py`:
    - `id: Mapped[uuid.UUID]` — `postgresql.UUID(as_uuid=True)`, PK, `default=uuid.uuid4`
    - `skill_id: Mapped[uuid.UUID]` — FK → `skills.id` (`ondelete="CASCADE"`), NOT NULL, indexed
    - `skill_version_id: Mapped[uuid.UUID]` — FK → `skill_versions.id` (`ondelete="CASCADE"`), NOT NULL — **this is the immutable Part 11 binding** (AC6)
    - `skill_version: Mapped[str]` — `String(32)`, NOT NULL — semver string snapshot (matches `audit.py` which also stores the version string; lets history render without a join)
    - `certification_type: Mapped[str]` — `String(24)`, NOT NULL — `technical | methodological` (VARCHAR, NOT PG ENUM — validated in service, Task 4)
    - `certifier_user_id: Mapped[str]` — `String(128)`, NOT NULL (mirror `created_by_user_id` width, `skill.py:135`)
    - `certifier_role: Mapped[str]` — `String(24)`, NOT NULL — the `AuthPrincipal.role` at signing time (`ma_tech` / `consultant`); preserves who-by-authority for Part 11 (D3)
    - `certified_at: Mapped[datetime]` — `DateTime(timezone=True)`, NOT NULL, default `lambda: datetime.now(UTC)` (Python-set, NO server_default — matches `skill.py:137-139`)
    - `signature_meaning: Mapped[str]` — `String(64)`, NOT NULL — e.g. `technical_certification` / `methodological_certification`
    - `notes: Mapped[str | None]` — `Text`, nullable
    - `org_id: Mapped[str]` — `String(128)`, NOT NULL, indexed (org-scope idiom; cert table carries its own `org_id` so list queries filter directly — mirror `skill.py:134`)
  - [x] **Uniqueness:** add `UniqueConstraint("skill_version_id", "certification_type", name="uq_certification_records_version_type")` — exactly one technical + one methodological cert per skill version. (Re-signing the same key is an error, not an overwrite — records are immutable.) Mirror the constraint idiom at `skill.py:206`.
  - [x] Indexes: `idx_certification_records_skill_id`, `idx_certification_records_org_id` (naming `idx_{table}_{col}` per implementation-patterns-consistency-rules.md:10).
  - [x] **Register the model**: add `from app.models.certification import CertificationRecord` to `app/models/__init__.py` (currently `:1-24`) AND add `"CertificationRecord"` to `__all__`. Without this, Alembic autogenerate / `Base.metadata` won't see it. [Source: models/__init__.py:1-24; env.py imports `app.models`]
  - [x] Do NOT build a `ValidationRecord` model — Decision D2 (CertificationRecord only). [Source: project-structure-boundaries.md:54 lists ValidationRecord but Epic 6 ACs never reference it; PRD unified cert+validation, 5-functional-requirements.md:144]

- [x] **Task 3 — Alembic migration `0015_certification_records.py` (AC: 1, 5)**
  - [x] `revision = "0015_certification_records"` (26 chars — **MUST stay ≤ 32**; `alembic_version.version_num` is `String(32)`), `down_revision = "0014_skill_output_contract"` — **the revision ID of the head, NOT the filename stem `0014_skill_version_schema_contract`** (they differ; chaining off the wrong string branches history). [Source: 0014_skill_version_schema_contract.py:32-33]
  - [x] `upgrade()`: `op.create_table("certification_records", ...)` with all columns from Task 2; `op.create_index(...)` for skill_id + org_id; the `UniqueConstraint` either inline in `create_table` or via `op.create_unique_constraint`. Use `postgresql.UUID(as_uuid=True)`, `sa.DateTime(timezone=True)`, `sa.Text`, `sa.String(N)`. NO server_default on `certified_at` (Python-set). NO PG ENUM, NO CheckConstraint (zero in repo history). [Source: 0002_create_skills.py, 0014; enum convention audit_service.py:34]
  - [x] **Append-only immutability triggers** — COPY VERBATIM from `0006_audit_log_entries.py:85-105`, renamed for this table: create function `reject_certification_mutation()` raising on `TG_OP`; a `BEFORE UPDATE OR DELETE ON certification_records FOR EACH ROW` trigger `trg_certification_records_append_only`; and a `BEFORE TRUNCATE ON certification_records FOR EACH STATEMENT` trigger `trg_certification_records_no_truncate`. (Row triggers don't fire on TRUNCATE — the statement trigger closes that hole.) [Source: 0006_audit_log_entries.py:82-105]
  - [x] `downgrade()`: `DROP TRIGGER IF EXISTS ...` (both), `DROP FUNCTION IF EXISTS reject_certification_mutation()`, then `op.drop_index(...)` + `op.drop_table("certification_records")` — round-trip clean. [Source: 0006_audit_log_entries.py:108-114]
  - [x] alembic.ini `[post_write_hooks]` runs `ruff check --fix` on the new file — keep it ruff-clean.

- [x] **Task 4 — `certification_service.py` write + read + enum validation (AC: 2, 6, 7)**
  - [x] Module-level async functions, kwargs-only (`*` first), `session: AsyncSession` explicit — match `skill_service.py` house style.
  - [x] `VALID_CERTIFICATION_TYPES = frozenset({"technical", "methodological"})` and `VALID_SIGNATURE_MEANINGS = frozenset({"technical_certification", "methodological_certification"})` — service-layer enum validation (mirror `audit_service.VALID_OUTCOMES` at `audit_service.py:34`). Raise a 422 `VelaraHTTPException` (or `ValueError` → mapped) on out-of-set values. Derive `signature_meaning` from `certification_type` server-side (don't trust client to pass it) — `technical` → `technical_certification`, `methodological` → `methodological_certification`.
  - [x] `async def record_certification(*, session, skill_id, org_id, certification_type, certifier_user_id, certifier_role, notes=None) -> CertificationRecord`:
    - `skill = await skill_service.get_skill(session=session, skill_id=skill_id, org_id=org_id)` — reuses the org-scoped loader (404 on cross-org via `SkillNotFoundError`; selectinloads versions). [Source: skill_service.py:387-398]
    - Resolve the current version: `ver = next((v for v in skill.versions if v.id == skill.current_version_id), None)` (pattern at `skills.py:144-152`). If `None` → 422 (no current version to certify).
    - Build `CertificationRecord` bound to `ver.id` + `ver.version`; set `certified_at = datetime.now(UTC)`, `signature_meaning` derived, `certifier_role` from the caller's principal.
    - `session.add(...)`; `await session.commit()`; `await session.refresh(...)`. On `IntegrityError` (duplicate version+type unique violation) → `await session.rollback()` then raise a 422 domain error (e.g. `CertificationAlreadyRecordedError`, `ERROR_CODE = "CERTIFICATION_ALREADY_RECORDED"`) — mirror the `IntegrityError`→422 translation at `skill_service.py:623-629`.
  - [x] `async def list_certifications(*, session, skill_id, org_id, page=1, per_page=50) -> tuple[list[CertificationRecord], int]`:
    - `select(CertificationRecord).where(skill_id == ..., org_id == ...).order_by(CertificationRecord.certified_at.asc(), CertificationRecord.id.asc())` (chronological, AC7; `id` tiebreaker for stable ordering — same idiom as the 5-6 created_at tiebreaker).
    - Verify the skill exists + is org-visible first (call `get_skill` → 404 on cross-org, so a foreign skill_id never returns an empty 200 that leaks nothing-vs-forbidden). Return `(rows, total)` via `func.count()` mirroring `list_skills` pagination (`skill_service.py:341-361` post-5-6). [Source: 5-6 pagination precedent]
  - [x] `async def evaluate_certification_eligibility(*, session, skill: Skill) -> dict[str, bool]` (or similar) — returns whether the skill's **current version** has technical + methodological certs. This is the MECHANISM consumed by Task 5 (the gate) and later by 6.3's auto-advance. Query `certification_records` for `skill_version_id == skill.current_version_id` grouped by `certification_type`. Keep it a pure read (no commit).
  - [x] All queries org-scoped. No raw exception messages to callers. [Source: implementation-patterns-consistency-rules.md:137-148 rules 1,3,5]

- [x] **Task 5 — Wire the two-key gate into the EXISTING lifecycle guard (AC: 3, 4)**
  - [x] Extend `assert_can_advance()` (`skill_service.py:655-664`) — it ALREADY guards `to_state == "client_ready"` and its docstring reserves it for "Epic 6's certification path." Add, AFTER the existing `review_required` check:
    - When `to_state == "client_ready"`: load the current-version cert eligibility (via the Task 4 mechanism). If NOT both keys present → raise `CertificationIncompleteError`.
  - [x] **Signature constraint (VERIFIED — do not deviate):** `assert_can_advance(skill, to_state)` is SYNC, sessionless, and is called both at `skill_service.py:480` AND directly by 4 existing unit tests (`test_skill_service.py:303,310,314,318`). **DO NOT make `assert_can_advance` async or add a session param** — that breaks those unit tests. The eligibility check (which needs a DB query) MUST go in the async `transition_lifecycle` (`:461-495`, which has the session): right after the existing `assert_can_advance(skill, to_state)` call, add `if to_state == "client_ready": <eligibility check> → raise CertificationIncompleteError`. (Equivalently, factor a new async `assert_certified_for_client_ready(session, skill)` called from `transition_lifecycle` — but leave the sync `assert_can_advance` untouched.) [Source: skill_service.py:461-495,480,655-664; test_skill_service.py:24,303-318]
  - [x] **`RECERTIFICATION_REQUIRED` vs `CERTIFICATION_INCOMPLETE` distinction (AC4):** These are different signals. `RECERTIFICATION_REQUIRED` applies when the skill PREVIOUSLY reached `client_ready` and a newer version now lacks certs; `CERTIFICATION_INCOMPLETE` is the generic "current version not fully certified." Practically, after Task 6 resets a re-versioned skill to `draft`, a re-cert attempt that skips keys can surface either code — implement: if the skill has ANY prior `client_ready` history for an OLDER version but the current version has zero certs → `RECERTIFICATION_REQUIRED`; else → `CERTIFICATION_INCOMPLETE`. (If distinguishing prior client_ready history is too costly without a state-history table, document the simplification and default to `CERTIFICATION_INCOMPLETE`, raising `RECERTIFICATION_REQUIRED` specifically from the create_version reset path's follow-on advance — confirm exact behavior against the AC4 test.) Save any ambiguity as a question for the user rather than guessing silently.

- [x] **Task 6 — Reset lifecycle to `draft` on new version (AC: 4) — in EXISTING `create_version()`**
  - [x] `create_version()` (`skill_service.py:498-642`) currently **never touches `skill.lifecycle_state`** — so publishing a new version on a `client_ready` skill leaves it `client_ready` (the gap AC4 closes). In the SAME transaction (do NOT add a second commit), after the new version row is inserted and `current_version_id` is advanced (`:589`), if `skill.lifecycle_state == "client_ready"` → set `skill.lifecycle_state = "draft"`.
  - [x] **Mirror the existing in-txn pattern** at `:612-620` where `create_version` already flips `review_required=True` on derived children — same transaction, rollback-safe. [Source: skill_service.py:498-642, esp. :589, :612-620]
  - [x] Previous-version certs are preserved automatically (they're bound to the OLD `skill_version_id`); the gate only ever evaluates the CURRENT version, so they correctly "do not carry over." No cert-row mutation needed. [Source: epic-6-certification-governance.md:121]
  - [x] **Consumer-audit (Epic 5 retro lesson):** `create_version` has one caller (`skills.py` POST `/{skill_id}/versions`). Confirm no test asserts that lifecycle is UNCHANGED across version creation that this reset would break. Grep tests.

- [x] **Task 7 — Pydantic schemas — NEW `app/schemas/certification.py` (AC: 2, 7)**
  - [x] `CertificationType = Literal["technical", "methodological"]` (stable enum type, mirror `schemas/skill.py:25-29` Literal aliases).
  - [x] `CertificationCreate(BaseModel)`: `skill_id: uuid.UUID`, `certification_type: CertificationType`, `notes: str | None = Field(default=None, max_length=...)`. Do NOT accept `signature_meaning`/`certifier_*`/`certified_at` from the client — those are server-derived (AC6 integrity). Mirror DB widths in `Field(max_length=...)` so oversize → 422 not 500 (`schemas/skill.py:35-39`). Do NOT use `extra='forbid'` — house style is default-ignore (verified: not used in `schemas/skill.py`). [Source: schemas/skill.py:14, 25-39]
  - [x] `CertificationRead(BaseModel)` with `model_config = {"from_attributes": True}` (`schemas/skill.py:156`): all record fields EXCEPT none-sensitive — include `id, skill_id, skill_version_id, skill_version, certification_type, certifier_user_id, certifier_role, certified_at, signature_meaning, notes`. (No artifact/IP fields exist on this table, so all are safe, but keep `notes`/`signature_meaning` OFF any client-facing surface — see Dev Notes IP section.)
  - [x] For the list response, reuse `PageMeta` from `app/schemas/common.py` and return `ResponseEnvelope[<ListData>]` where ListData is `{items: list[CertificationRead], page: PageMeta}` — mirror the `SkillListData`/`JobListData` shape (5-4/5-6 precedent). [Source: schemas/common.py; implementation-patterns-consistency-rules.md:75-79]

- [x] **Task 8 — Router — NEW `app/api/v1/certifications.py` (AC: 2, 5, 7)**
  - [x] `router = APIRouter(prefix="/api/v1/certifications", tags=["certifications"])` — match the prefix/tags idiom of `skills.py`. Register it in `app/main.py` alongside the other v1 routers (find where `skills.router` is included).
  - [x] `POST ""` → `record_certification`; `status_code=status.HTTP_201_CREATED`; `response_model=ResponseEnvelope[CertificationRead]`. Inject `user: CurrentUser`, `session: DbSession`, `request: Request` (copy the dependency set + `_meta(request)` helper usage from `skills.py:48-82`). Pass `certifier_user_id=user.user_id`, `certifier_role=user.role`, `org_id=user.org_id`. Return `ResponseEnvelope(data=CertificationRead.model_validate(rec), meta=_meta(request))`.
  - [x] `GET ""` with `skill_id: uuid.UUID` (required query param) + `page`/`per_page` `Annotated[int, Query(ge=1, le=...)]` (mirror `skills.py` list bounds: `per_page` `le=200`, `page` `le=100_000` per 5-6 review) → `list_certifications` → `ResponseEnvelope[ListData]`.
  - [x] **DO NOT declare PUT/PATCH/DELETE** on `/certifications/{id}` (or any cert path). Their absence is what produces the AC5 405 (Starlette auto-405 → `http_exception_handler` envelope, `exceptions.py:83-94`). Add a code comment stating the omission is intentional (immutability) so a future dev doesn't "helpfully" add an update route.
  - [x] **AUTH / ROLE NOTE:** This story does NOT implement RBAC role-enforcement (which role may sign which key) — hierarchy-scoped RBAC is Epic 8 (FR-SEC-11). For 6.1, any authenticated internal user can POST; capture `certifier_role` for the audit trail. Do NOT add a `hierarchy_scope` dependency that doesn't exist yet — confirm whether such a dependency is already wired in `skills.py` routes; if not, match exactly what `skills.py` does (just `CurrentUser`). [Source: skills.py:53-59 dependency set; FR-SEC-11 requirements-inventory.md:102 = Epic 8]

- [x] **Task 9 — Tests — NEW `tests/integration/api/test_certifications.py` + unit (AC: all)**
  - [x] **Integration** (run via `docker compose exec api pytest tests/integration/api/test_certifications.py`; auto-skip guard when PG/MinIO down — copy the `pytestmark` skip block from `test_skills.py:33-71`). Reuse fixtures: `client` (conftest.py:61-69), `apply_migrations` (autouse — your `0015` migration MUST be chain-valid or the WHOLE suite fails setup), and copy local helpers `_internal_auth()`/`_auth_headers(role)` (test_skills.py:76-89) + `skill_payload` (test_skills.py:94-105). `ma_tech` org is `org_vitalief`.
    - `test_record_technical_certification_201`: create skill → advance to internal_ready → POST cert → 201; GET returns it.
    - `test_advance_to_client_ready_blocked_without_both_keys_422`: internal_ready skill + only technical cert → PATCH `/skills/{id}/lifecycle` to client_ready → 422, `error.code == "CERTIFICATION_INCOMPLETE"`. (Extends the `test_lifecycle_invalid_transition_422` shape at test_skills.py:136-163.)
    - `test_advance_to_client_ready_succeeds_with_both_keys`: both certs present → PATCH to client_ready → 200, state `client_ready`.
    - `test_recertification_required_on_new_version_422`: client_ready skill → POST new version → assert skill `lifecycle_state == "draft"`; attempt advance → 422 (`RECERTIFICATION_REQUIRED` per AC4 distinction in Task 5).
    - `test_certification_records_immutable_405`: attempt PUT/PATCH/DELETE on a cert resource path → 405.
    - `test_certification_duplicate_version_type_422`: POST the same (skill_version, technical) twice → second is 422 `CERTIFICATION_ALREADY_RECORDED`.
    - `test_list_certifications_chronological`: multiple certs → GET `?skill_id=` returns oldest-first, paginated envelope.
    - `test_certification_cross_org_404`: POST/GET for a skill in another org → 404 (org-scope; never leaks existence).
    - `test_signature_meaning_server_derived`: client cannot override `signature_meaning`/`certified_at` (extra fields ignored; values are server-set).
  - [x] **Unit** `tests/unit/services/test_certification_service.py` (NEW): enum frozenset validation rejects bad `certification_type`; `evaluate_certification_eligibility` returns correct both/one/none; `signature_meaning` derivation mapping.
  - [x] **Gates:** `ruff check .` clean; full Docker suite passes with 0 regressions (baseline ~724 tests); migration `0015` round-trip (`upgrade head` then `downgrade -1`) clean; the immutability triggers verified by the 405-path test + (ideally) a direct UPDATE/DELETE attempt asserting the DB raises. [Source: 5.5-1 gates pattern; conftest.py apply_migrations]

### Review Findings

> Code review 2026-06-27 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 7 ACs functionally satisfied; all 14 dev traps honored; migration chain + both skill_service edits verified correct. Findings concentrate in test integrity plus one real behavioral gap. F6 (TOCTOU) decision resolved with user → patch.

- [x] [Review][Patch] No lifecycle-state guard on `record_certification` — a `retired` (terminal) skill still accepts immutable e-signature certs; every other mutating path raises `SkillRetiredError`. [app/services/certification_service.py:96-165] (cf. skill_service.py:533) — FIXED: added `retired` guard → 422 SKILL_RETIRED; covered by `test_cannot_certify_retired_skill_422`.
- [x] [Review][Patch] AC5 immutability test asserts nothing real — `test_certification_records_immutable_405` POSTs verbs to the collection root, gets 405 from Starlette route resolution without touching the DB; the migration-0015 append-only triggers (the actual Part-11 backstop) have ZERO coverage. Add a direct UPDATE/DELETE-raises assertion (spec Task 9:147 called for this). [tests/integration/api/test_certifications.py] — FIXED: added `test_certification_record_db_level_immutable` asserting UPDATE/DELETE/TRUNCATE all raise at the DB.
- [x] [Review][Patch] AC6 `certified_at` assertion is weak — `test_signature_meaning_server_derived` asserts `certified_at != "2000-01-01T00:00:00Z"`, which passes even if the server accepted the client value (it would reformat to `+00:00`). Assert the stored value is server-recent, not merely string-unequal. [tests/integration/api/test_certifications.py] — FIXED: now parses `certified_at` and asserts it falls within the request window.
- [x] [Review][Patch] Eligibility unit tests don't validate the org/version filters — they mock `select` and reassign `session.execute`, so the security-relevant `.where(skill_version_id ==, org_id ==)` clauses are never exercised; a regression dropping scoping would not be caught. [tests/unit/services/test_certification_service.py] — FIXED: tests no longer patch `select`; new `test_query_is_scoped_to_current_version_and_org` compiles the real query and asserts both filters + literal values are present.
- [x] [Review][Patch] TOCTOU on lifecycle advance — `transition_lifecycle` reads the skill without a row lock while `create_version` takes `for_update=True`; concurrent advance + re-version can interleave so the advance commits against a superseded version, defeating the AC4 re-cert gate. Add `for_update=True` to the `get_skill` call. [app/services/skill_service.py:470] (mirror :528-530) — FIXED: `transition_lifecycle` now loads the skill `for_update=True`; 158 skills+lifecycle tests pass, no regression.
- [x] [Review][Defer] AC4 `RECERTIFICATION_REQUIRED` discriminator uses "any prior cert exists for the skill" rather than the spec's "previously reached client_ready" — a skill with an orphan cert on an old version (never client_ready) gets RECERTIFICATION_REQUIRED on advance. [app/services/certification_service.py:260-274] — deferred: spec Task 5:114 explicitly authorizes this simplification when no state-history table exists (there is none); documented in completion notes (line 259). Revisit in 6.3.

## Dev Notes

### Architecture Context

This story OPENS Epic 6 (Certification & Governance). It is purely additive: a new table + new service/schema/router files + two targeted edits to the EXISTING `skill_service.py` (the advance gate in Task 5 and the version-reset in Task 6). It does NOT reopen Epic 2 or change the skill artifact/IP flow.

**The lifecycle state machine (canonical, underscore enum):** `draft → internal_ready → client_ready → retired`. The certification gate sits on the `internal_ready → client_ready` transition. [Source: implementation-patterns-consistency-rules.md:84; FR-REG-02 requirements-inventory.md:16; the live `_ALLOWED_TRANSITIONS` map at skill_service.py:43-48]

⚠️ **Enum naming trap:** the SHARDED PRD (`5-functional-requirements.md:27,148`) uses **hyphenated** `internal-ready`/`client-ready`. That shard is STALE. The codebase, the architecture stable-enum, and ALL Epic 6 ACs use **underscore** `internal_ready`/`client_ready` (verified live: `schemas/skill.py:25`, `skill_service.py:43-48`). Use underscores everywhere.

### LOCKED DECISIONS (resolved with user 2026-06-27)

- **D1 — API shape:** Build the **records-resource** shape: `POST /api/v1/certifications` (record one signature) + `GET /api/v1/certifications?skill_id=` (history). The **advance-to-client_ready action ALREADY EXISTS** as `PATCH /api/v1/skills/{skill_id}/lifecycle` (`skills.py:190-206`) and just gets the two-key gate added to its `assert_can_advance` guard. **Do NOT build a `/skills/{id}/certify` action verb** (it's in implementation-patterns-consistency-rules.md:15 but predates the `/lifecycle` endpoint — adding it would create TWO ways to advance a skill). Rationale: the certify *record* (a noun/e-signature) and the advance *action* (existing) are genuinely different concerns; this honors both without duplication.
- **D2 — CertificationRecord ONLY.** `project-structure-boundaries.md:54` lists a co-resident `ValidationRecord`, but no Epic 6 AC references it and the PRD unified certification + validation into one workflow surface (`5-functional-requirements.md:144`). Treat `ValidationRecord` as legacy from an earlier design — do not build it.
- **D3 — Printed name = forward-dep.** AC6 wants `certifier_user_id` "resolvable to a printed name," but the live `AuthPrincipal` (`auth.py:35-53`) carries ONLY `user_id`, `org_id`, `role` — there is NO User table and no name/email field. Store `certifier_user_id` + `certifier_role` immutably NOW; printed-name *resolution/display* is a forward-dependency on Epic 7 Cognito (richer claims, `auth.py:196-206`). Do NOT invent a User model. The dev seed users (`auth.py:98-117`: `ma.tech`→`ma_tech`, `consultant`→`consultant`) are the two cert personas in dev.

### Auto-advance seam (6.3)

Story 6.3's AC (`epic-6-certification-governance.md:95`) says recording the *methodological* (2nd) key AUTO-advances the skill to `client_ready`. Per D1, **6.1 does NOT auto-advance** — it builds the `evaluate_certification_eligibility` mechanism (Task 4) and the gate (Task 5). 6.3 will call the mechanism and trigger the advance. Keep 6.1 a pure data-model + state-machine API story; the auto-advance orchestration is 6.3. Note this seam in your completion notes.

### Files to CREATE
- `app/models/certification.py` — `CertificationRecord` [Source: project-structure-boundaries.md:54]
- `app/schemas/certification.py` — `CertificationCreate`, `CertificationRead`, list-data [Source: project-structure-boundaries.md:59]
- `app/services/certification_service.py` — exceptions, write/read/eligibility, enum frozensets [Source: project-structure-boundaries.md:64]
- `app/api/v1/certifications.py` — POST + GET only [Source: project-structure-boundaries.md:37]
- `app/db/migrations/versions/0015_certification_records.py`
- `tests/integration/api/test_certifications.py`, `tests/unit/services/test_certification_service.py`

### Files to UPDATE (read fully before editing)
- `app/models/__init__.py` — register `CertificationRecord` in imports + `__all__` (or Alembic/metadata won't see it). [models/__init__.py:1-24]
- `app/services/skill_service.py` — Task 5 (gate, near `:461-495` / `:655-664`) + Task 6 (reset to draft in `create_version`, near `:589`/`:612-620`). **Read these two functions completely** — they are load-bearing for the whole registry. Current state: `assert_can_advance` only checks `review_required`; `create_version` never touches `lifecycle_state`. Preserve all existing behavior (allowed-transition map ordering so illegal targets still return `INVALID_LIFECYCLE_TRANSITION`; the derived-child `review_required` flag write).
- `app/main.py` — include the new `certifications.router` (find the `skills.router` include).

### DEV TRAPS & GOTCHAS (top failure modes — read before coding)

1. **`down_revision = "0014_skill_output_contract"`** (the revision ID), NOT the filename stem `0014_skill_version_schema_contract`. They differ; the wrong string silently branches migration history. [0014 file:32-33]
2. **Revision ID ≤ 32 chars.** `alembic_version.version_num` is `String(32)`. `0015_certification_records` (26) is safe; a verbose id overflows and crashes migration.
3. **Gate hook = EXISTING `assert_can_advance` / `transition_lifecycle`**, NOT a new transition path. Check `to_state == "client_ready"` AFTER the allowed-transition map (so an illegal target still returns `INVALID_LIFECYCLE_TRANSITION`). The guard's docstring (`skill_service.py:661`) literally reserves it for "Epic 6's certification path."
4. **Re-cert reset goes in `create_version`, SAME transaction** (mirror the `review_required` write at `:612-620`). Currently a `client_ready` skill stays `client_ready` after a new version — that IS the bug AC4 fixes. No second commit.
5. **Enums = VARCHAR + service frozenset, NOT PG ENUM, NOT CheckConstraint** (zero CHECK constraints in the entire migration history). Mirror `audit_service.VALID_OUTCOMES` (`audit_service.py:34`).
6. **HTTP 405 is automatic** — just don't declare UPDATE/DELETE routes. Add the DB append-only trigger (copy `0006:85-105`) as the real immutability backstop.
7. **`AuthPrincipal` has no name/email/User table** — store `user_id` + `role`; printed-name is Epic 7 (D3). Don't invent identity infra.
8. **Org-scope EVERY query.** The cert table carries `org_id`; always filter by it and resolve the skill via `get_skill(..., org_id=...)` (404 on cross-org — never an empty 200 that leaks). `SkillVersion` itself has no `org_id`; reach org via the parent skill.
9. **Bind to `skill_version_id` (FK), not just the version string.** The FK is the unambiguous immutable Part 11 binding; the string snapshot is a convenience for history rendering. Store both.
10. **No `extra='forbid'`** in the new schemas (house style ignores extras — verified in `schemas/skill.py`). Derive `signature_meaning`/`certified_at`/`certifier_*` server-side so a client can't forge an e-signature's meaning/time.
11. **Register the model in `app/models/__init__.py`** or autogenerate/metadata won't see it (env.py imports `app.models`).
12. **Translate the unique-constraint race to 422** via `except IntegrityError` → rollback → domain error (pattern `skill_service.py:623-629`).
13. **`apply_migrations` is session-scoped autouse** — a broken `0015` fails the ENTIRE ~724-test suite, not just cert tests. Get the migration right first.
14. **Consumer audit (Epic 5 retro):** the Task 6 reset and the Task 5 gate change behavior of the existing `/lifecycle` + `/versions` routes — grep existing tests for lifecycle/version assertions that might now break, and run the full suite.

### IP-protection / compliance constraints

Certification is an **internal governance surface** (MA Tech / Matt Maxwell only). Certification records — especially `notes` and `signature_meaning` (which can reflect methodology/voice assessments) — must NEVER be exposed to any client-scoped token or client-facing route. The `/api/v1/certifications` routes belong to the internal surface; do not add them to any client portal (Epic 8). This composes with the platform IP rule: client tokens have no route to skill internals, enforced at the routing layer. [Source: core-architectural-decisions.md:12,26; FR-ACL-03/04/05 5-functional-requirements.md:103-105]

**21 CFR Part 11 (FR-SEC-10):** the three signature components MUST be captured — signer identity (`certifier_user_id`/`certifier_role`), UTC timestamp (`certified_at`), signature meaning (`signature_meaning`) — bound immutably to `skill_version_id`. Full non-repudiation + IQ/OQ/PQ validation are explicitly DEFERRED (FR-SEC-12) — do NOT over-build cryptographic signing or password re-auth; the manifestation (capture + immutability) is the Phase-1 scope. [Source: requirements-inventory.md:101,103; core-architectural-decisions.md:95,97]

### Testing standards summary

- `pytest`, `asyncio_mode="auto"`, `testpaths=["tests"]`. Integration tests hit real `velara_test` Postgres + MinIO inside Docker (`docker compose exec api pytest ...`) and auto-skip when infra is down. No per-test rollback — use unique skill names. Co-locate the unit test beside conceptually (under `tests/unit/services/`). Reuse `client`, `apply_migrations`, `_internal_auth()`, `skill_payload`. [Source: conftest.py:31-69; test_skills.py:7,33-105]

### Project Structure Notes

- All new file paths match `project-structure-boundaries.md` exactly (model/schema/service/router names were pre-specified there). No structural variance.
- **Known deviation (documented):** endpoint shape follows the Epic 6 ACs (`/certifications` resource) rather than the patterns-doc action verb (`/skills/{id}/certify`) — see Decision D1. The advance action reuses the existing `/lifecycle` endpoint.
- **Traceability note:** FR-SEC-10 is defined in `epics/requirements-inventory.md:101` (the 2026-06-08 additive update), NOT in the sharded PRD `5-functional-requirements.md` (whose SEC list stops at SEC-08). Cite `requirements-inventory.md` as the canonical FR source.

### Latest Tech Information

No new dependency. All work uses the existing stack: SQLAlchemy 2.x typed `Mapped[...]` ORM, Alembic, FastAPI + Pydantic v2, `postgresql.UUID`/`JSONB`/`DateTime(timezone=True)`, plpgsql triggers. No web research surfaced any version-specific concern for this purely additive backend change.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-6-certification-governance.md#Story-6.1 (ACs lines 5-35; 6.4 history GET line 128)]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md#FR-CRT (73-77), #FR-SEC (99-103), #FR-REG-02 (16)]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Regulatory-Compliance (87-101); IP rule (12,26)]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#Naming (5-22), #Envelopes (62-79), #Enums (84), #Enforcement-Rules (137-148)]
- [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md (37,54,59,64,76-77)]
- [Source: _bmad-output/planning-artifacts/architecture/execution-engine-patterns.md#Stable-error-codes (88-91), #Append-only (117)]
- [Source: velara-api/app/services/skill_service.py — `_ALLOWED_TRANSITIONS` (43-48), exception pattern (53-79), `transition_lifecycle` (461-495), `create_version` (498-642, reset point near 589 / mirror 612-620), `assert_can_advance` (655-664), IntegrityError→422 (623-629), `get_skill` org-scope (387-398)]
- [Source: velara-api/app/models/skill.py — Skill (35-162: lifecycle_state 55-57, org_id 134, created_by_user_id 135, created_at 137-139, review_required 129-131), SkillVersion (165-208: version 206 unique, created_by 186)]
- [Source: velara-api/app/models/audit.py + app/services/audit_service.py — VALID_OUTCOMES frozenset (audit_service.py:34); column idioms]
- [Source: velara-api/app/core/exceptions.py — VelaraHTTPException (27-40), velara_http_exception_handler (68-80), http_exception_handler/405 (83-94)]
- [Source: velara-api/app/integrations/auth.py — AuthPrincipal (35-53), seed users (98-117), Cognito forward-dep (196-206)]
- [Source: velara-api/app/api/v1/skills.py — create POST pattern (48-82), lifecycle PATCH (190-206), current-version resolution (144-152)]
- [Source: velara-api/app/schemas/skill.py — Literal enums (25-29), Field width mirroring (35-39), from_attributes (156), no extra='forbid']
- [Source: velara-api/app/db/migrations/versions/0006_audit_log_entries.py — append-only trigger pattern (82-114)]
- [Source: velara-api/app/db/migrations/versions/0014_skill_version_schema_contract.py — head revision id (32-33)]
- [Source: velara-api/app/models/__init__.py — model registration (1-24)]
- [Source: velara-api/tests/conftest.py (31-69) + tests/integration/api/test_skills.py (7,33-105,136-163) — fixtures + lifecycle test precedent]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- ruff B904: `raise CertificationAlreadyRecordedError` inside `except IntegrityError` needed `from exc` — fixed.
- ruff E501: two docstring lines in `test_certifications.py` exceeded 100 chars — shortened.
- ruff I001+F401: import sort violation + unused `pytest` in unit test — fixed with `ruff check --fix`.
- Integration tests skipping: skip guard parsed `postgres` Docker hostname (unreachable from host). Fixed by exporting `DATABASE_URL=postgresql+asyncpg://velara:velara@localhost:5432/velara_test`.
- `test_certification_records_immutable_405` returning 404: test targeted `/api/v1/certifications/{fake_id}` (non-existent path → Starlette 404). Fixed by testing against `/api/v1/certifications` root (GET+POST registered → PUT/PATCH/DELETE → 405).
- Regression `test_acknowledge_clears_flag_and_unblocks_client_ready`: existing test advanced a derived skill to `client_ready` without cert records. New gate blocked this. Fixed by adding both cert records in the test before the advance.

### Completion Notes List

- Implemented the full `certification_records` data model with append-only DB triggers (21 CFR Part 11 pattern mirroring `0006_audit_log_entries.py`).
- Migration `0015_certification_records` chains correctly off `0014_skill_output_contract`; round-trip (upgrade+downgrade) clean.
- Two-key gate placed in async `transition_lifecycle()` (not sync `assert_can_advance()`) to preserve 4 existing unit tests that call the sync function directly.
- `RECERTIFICATION_REQUIRED` vs `CERTIFICATION_INCOMPLETE` distinguished by checking if any prior cert exists for the skill (not just current version) — if prior_count > 0 and current version has zero certs → RECERTIFICATION_REQUIRED; else → CERTIFICATION_INCOMPLETE.
- Circular import between `skill_service` and `certification_service` resolved via lazy imports inside function bodies.
- `evaluate_certification_eligibility()` exposed as the auto-advance seam for Story 6.3 (methodological cert recording will call it + trigger advance).
- No RBAC role enforcement for 6.1 — any authenticated `ma_tech` user can certify; `certifier_role` captured for audit trail. Role-based restriction is Epic 8.
- Full suite: 724 passed, 0 failed after all changes (baseline maintained). 11 integration tests + 19 unit tests added.

### File List

**New files:**
- `app/models/certification.py`
- `app/schemas/certification.py`
- `app/services/certification_service.py`
- `app/api/v1/certifications.py`
- `app/db/migrations/versions/0015_certification_records.py`
- `tests/integration/api/test_certifications.py`
- `tests/unit/services/test_certification_service.py`

**Modified files:**
- `app/models/__init__.py` — registered `CertificationRecord`
- `app/services/skill_service.py` — added async cert gate in `transition_lifecycle()` + lifecycle reset to `draft` in `create_version()`
- `app/api/v1/router.py` — included `certifications.router`
- `tests/integration/api/test_skills.py` — added cert records before `client_ready` advance in `test_acknowledge_clears_flag_and_unblocks_client_ready`

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-06-27 | 1.0.0 | Implemented certification data model (`certification_records` table with append-only triggers), `POST /api/v1/certifications` + `GET /api/v1/certifications` API, two-key gate on `client_ready` lifecycle transition, lifecycle reset to `draft` on new version publication. All 7 ACs satisfied. 11 integration tests + 19 unit tests added. 724 tests passing. | claude-sonnet-4-6 |
