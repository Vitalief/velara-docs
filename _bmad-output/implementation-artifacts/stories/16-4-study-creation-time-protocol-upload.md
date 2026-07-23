---
baseline_commit: d104ab1 (top-level docs repo); velara-api on branch `development` (head 459e2a8), velara-web on branch `development` (head 5a613a9) when picked up
---

# Story 16.4: Study-Creation-Time Protocol Upload

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to upload a Study's protocol document once when I create the Study (or add one later to an existing Study),
so that I don't have to re-upload the same document every time I run a skill against that Study.

## ⚠️ SCOPE — read this first

This story does **not** invent a new ingest mechanism, change MIME validation, or touch S3 storage.
It changes **WHEN and WHERE** a protocol document is uploaded, and makes skill runs **automatically
consume** it. Concretely:

- A **new join table** links a `FileReference` to a `Study` (none exists today — `FileReference` has
  zero hierarchy attachment). It records **history**: **exactly one protocol is `active` per Study at a
  time**; uploading a new one supersedes the prior (the prior row is retained, `is_active=false`).
- **Study creation** (the generic `EntityModal`, today name+description only) gains an **optional**
  protocol-upload step, reusing `DocumentUploadCard` + the existing presign→confirm flow. An existing
  protocol-less Study can add/replace one later via **Study edit**.
- When a skill runs within a Study that has an **active** protocol, that document's `file_ref_id` is
  **injected server-side** into the invocation's `file_ref_ids` (request-side, in `queue_invocation`) —
  the invoker never re-selects or re-uploads it.
- A **new boolean skill flag** declares whether a skill "needs documents beyond the Study's protocol."
  The Run Console upload affordance is **always shown but labeled _optional_** when the Study has a
  protocol that already covers the skill's need — it is **never removed** (per confirmed decision:
  show-but-say-optional, not hide).

**Product decisions confirmed with the operator (do not re-litigate):**
- **One _active_ protocol per Study, history retained.** Not a flat one-row replace, not an unbounded
  live list. New upload → old active row flips to `is_active=false`, new row `is_active=true`. AC4
  injects only the active one.
- **Flag default = upload stays visible.** Existing skills keep their Run Console upload after this
  ships (zero regression). When a Study protocol exists, the affordance renders with an "optional" hint
  rather than disappearing.
- **Injection is request-side** (`queue_invocation`), single insertion point, covers all executor types
  and the client-portal invocation path automatically.

**This story spans BOTH subrepos:** `velara-api` (join table + migration, attach/list/detach routes,
service logic, request-side protocol injection, the new skill flag end-to-end, OpenAPI regen) and
`velara-web` (protocol upload on Study create/edit, a Protocol card on `StudyDetail`, the new skill-flag
toggle on the skill form, the Run Console "optional" labeling).

## Acceptance Criteria

1. **AC1 — Study creation gains an optional protocol upload.** The Study-creation modal (`EntityModal`,
   `EngagementsScreen.tsx`, `add-study` mode — today name+description only) gains an **optional**
   document-upload step reusing `DocumentUploadCard` (`src/features/run/components/DocumentUploadCard.tsx`)
   over the internal `POST /ingest/presign` + `/confirm` flow — **no new upload mechanism**. On successful
   create, if a protocol file was uploaded, it is attached to the new Study (its `file_ref_id` becomes the
   Study's active protocol). Creating a Study **without** a protocol remains fully valid.

2. **AC2 — A new join table attaches a `FileReference` to a `Study`, with active/history semantics.**
   `FileReference` (`app/models/file_ref.py`) has **zero** hierarchy attachment today (confirmed: no
   `study_id`, no polymorphic columns). Add a new table `study_protocol_association` linking one
   `file_reference` to one `study`, using **real FKs with `ON DELETE CASCADE`** (the
   `study_location_association` precedent — `app/models/hierarchy.py:189-219` — NOT the polymorphic
   `SkillAttachment` shape, because both sides resolve to exactly one real table). It carries an
   `is_active` boolean, `org_id`, `attached_at`, `attached_by_user_id`, and a **partial unique index
   guaranteeing at most one `is_active=true` row per `(study_id, org_id)`**. Study delete cascades these
   rows automatically (no `delete_study` code change needed — see Dev Notes Trap 4).

3. **AC3 — Existing Studies can add/replace a protocol later via Study edit.** A Study that predates this
   story (or was created without a protocol) can have one attached afterward. Attaching a **new** protocol
   to a Study that already has an active one **supersedes** it: the prior active row flips to
   `is_active=false` (retained as history), the new row is `is_active=true`. **No backfill migration** —
   existing Studies simply start with no protocol until one is added. Detaching removes the active
   association (flips `is_active=false`; the `FileReference` itself is untouched).

4. **AC4 — Skills consume the Study's active protocol automatically (request-side injection).** When a
   skill is invoked within a Study that has an **active** protocol, that protocol's `file_ref_id` is
   appended **server-side** to the invocation's document set in `queue_invocation`
   (`app/api/v1/invocations.py`, at the `inputs_payload` assembly ~`:316-321`) **before** the job is
   created — for all three invocation shapes (non-location-dependent, location-dependent single, fan-out)
   and for the client-portal path (which reuses `queue_invocation`). The invoker does not re-select or
   re-upload it. **Dedupe:** if the caller already passed the same `file_ref_id` in `body.file_ref_ids`,
   the protocol is not injected twice. The protocol is injected **only when a Study context exists**
   (a run scoped to a Study, or fan-out over a Study's locations); a Project/Client-level run with no
   resolvable Study injects nothing.

5. **AC5 — New skill flag `requires_additional_documents`; Run Console upload becomes conditional-but-
   never-removed.** Add a new boolean skill flag (mirroring `location_dependent` end-to-end — model,
   migration, schemas, service, form) declaring whether a skill needs documents **beyond** the Study's
   protocol. In the Run Console:
   - If the run context is a **Study with an active protocol** AND the skill does **not** require
     additional documents (`requires_additional_documents == false`): the `DocumentUploadCard` still
     renders, but with an **"optional"** hint (e.g. caption "The Study's protocol is included
     automatically — upload only if you have an additional document"). **The affordance is NOT hidden.**
   - If the skill **requires** additional documents (`requires_additional_documents == true`), OR there is
     **no** Study protocol in context: the upload affordance renders as it does today (no "optional" hint /
     its normal prompt).
   - The flag's **default keeps the upload visible** for every existing skill (no regression). It is
     surfaced/editable on the skill create + edit forms exactly like `location_dependent`.

6. **AC6 — New attach/list/detach routes for a Study's protocol.** Add routes on the hierarchy router
   (`app/api/v1/hierarchy.py`, prefix `/api/v1`, internal — `RejectClient` via the router-level default),
   mirroring the `study_location_association` route shape (`:486-539`):
   - `POST /studies/{study_id}/protocol` — body `{ file_ref_id }`; attaches (and supersedes any existing
     active). `get_study` + `scope.assert_in_scope(study.hierarchy_path)`; 201 returning the active
     protocol read model (or 204 — dev's call, but be consistent; recommend 201 + the read model so the FE
     can render immediately).
   - `GET /studies/{study_id}/protocol` — returns the **active** protocol (or `null`/404-with-empty — dev's
     call; recommend 200 with `data: null` when none, so the FE card renders an empty state without a
     404-as-control-flow).
   - `DELETE /studies/{study_id}/protocol` — detaches the active protocol (flips `is_active=false`); 204.
   The `file_ref_id` must be validated as an existing, in-org, **`parsed`** FileReference before attach
   (reuse `ingest_service.assert_file_ref_ready` — see Dev Notes).

7. **AC7 — Gates green in both subrepos, OpenAPI regenerated.** `velara-api`: `ruff`/`mypy` clean,
   `pytest` green (new: join-table + migration test, attach/list/detach/supersede tests, protocol-
   injection tests across the three invocation shapes + dedupe + no-study-no-injection, the new skill flag
   through create/PATCH/audit). `docs/api-spec.json` regenerated via the repo's export script (routes +
   the new skill field change the spec — do **not** hand-edit). `velara-web`: `tsc --noEmit` + `eslint`
   clean, `vitest run` green (protocol upload on create/edit, the Protocol card, the new skill-flag
   toggle, the Run Console "optional" labeling; both wholesale-`useEngagements`-mock files updated).

**Out of scope (do NOT touch):**
- The ingest pipeline internals — `ingest_service.py` MIME allow-list, magic-byte sniff, size cap, S3
  storage, the presign/confirm/parse mechanics. This story only changes *when/where* upload happens.
- The **run authorization / grant** path. Protocol injection adds a document to an already-authorized
  run; it must **not** change who can run what. `queue_invocation` still authorizes on grants +
  `assert_in_scope` + `location_dependent`. (Note: grants are Client-only as of Story 16.3's `0027`
  migration — irrelevant to injection, but do not reintroduce study/project grant assumptions.)
- Skill `scope`, `visibility`, `lifecycle_state`, `location_dependent` semantics — unchanged. The new flag
  is **independent** of `location_dependent`.
- Location/skill-attachment stories (16.1/16.2/16.3), action-menu consolidation (16.5), run history (16.6).
- No backfill migration for existing Studies (confirmed).

## Tasks / Subtasks

### velara-api

- [x] **Task 1 — The `study_protocol_association` model + migration (AC2)** —
  `app/models/hierarchy.py` (or `app/models/file_ref.py` — put it beside `StudyLocationAssociation` in
  `hierarchy.py` for pattern-locality), new migration under `app/db/migrations/versions/`
  - [x] Model: mirror `StudyLocationAssociation` (`app/models/hierarchy.py:189-219`) but this is a
    **history table**, so use a surrogate `id` PK (not a composite `(study_id, file_ref_id)` PK — you need
    multiple rows per study over time). Columns:
    - `id` — `UUID(as_uuid=True)`, `default=uuid.uuid4`, PK (match `FileReference`'s real-UUID PK style,
      `file_ref.py:48-50` — NOT `SkillAttachment`'s `String(36)`).
    - `study_id` — `UUID` FK → `studies.id` `ondelete="CASCADE"`, NOT NULL.
    - `file_ref_id` — `UUID` FK → `file_references.id` `ondelete="CASCADE"`, NOT NULL. **Note the FK
      target PK is `UUID(as_uuid=True)`** (`file_ref.py:48`) — the FK column must be `UUID`, not
      `String(36)`.
    - `is_active` — `Boolean`, NOT NULL, `default=True`, `server_default=text("true")`.
    - `org_id` — `String(128)`, NOT NULL.
    - `attached_at` — `DateTime(timezone=True)`, NOT NULL, default now(UTC) (copy `SkillAttachment`'s
      `attached_at` pattern).
    - `attached_by_user_id` — `String(128)`, NOT NULL.
    - Index on `file_ref_id` (non-leading FK, like `idx_study_location_association_location_id`).
    - **Partial unique index** `uq_study_protocol_active` on `(study_id, org_id) WHERE is_active` — this is
      the "at most one active protocol per study" guarantee. Postgres partial unique index:
      `sa.Index("uq_study_protocol_active", "study_id", "org_id", unique=True, postgresql_where=sa.text("is_active"))`.
  - [x] Migration: `revision = "0028_study_protocol_association"`, `down_revision = "0027_client_only_grants"`
    (**verified current head** — no migration declares 0027 as its down_revision). Mirror
    `0025_location_client_ownership.py:83-96`'s raw `CREATE TABLE` **or** use `op.create_table` — dev's
    call; but the **partial unique index** must be created with `postgresql_where` (op.create_index with
    `postgresql_where=sa.text("is_active")`). `upgrade()` creates the table + both indexes; `downgrade()`
    drops the table. This is an **additive** migration (new table only) — no real-data translation, no
    backfill (confirmed). Contrast with 0025/0026 which were data translations; this one is simple.

- [x] **Task 2 — Read schema + request schema (AC6)** — `app/schemas/` (new file
  `app/schemas/study_protocol.py`, or extend an existing hierarchy schema module — match the file's
  neighbors, e.g. where `StudyLocationAssociationCreate` lives)
  - [x] Request: `StudyProtocolCreate { file_ref_id: uuid.UUID }` (mirror `StudyLocationAssociationCreate`).
  - [x] Read: `StudyProtocolRead` exposing the active protocol for a Study — include `file_ref_id`,
    `attached_at`, and enough of the underlying `FileReference` for the card to render
    (`original_filename`, `content_type`, `status`). Do **not** expose S3 keys (follow `FileRefRead`,
    `app/schemas/ingest.py:30-39`). A `GET` returning "no protocol" should be representable
    (return `data: null`).

- [x] **Task 3 — Service layer: attach (supersede), get-active, detach (AC2, AC3, AC6)** —
  `app/services/hierarchy_service.py` (put these beside `associate_location_to_study` /
  `disassociate_location_from_study`; they are the naming/shape precedent)
  - [x] `attach_study_protocol(session, *, study_id, file_ref_id, org_id, acting_user_id)`:
    - Validate the FileReference is ready: call `ingest_service.assert_file_ref_ready(session, file_ref_id,
      org_id)` (the exact validator `queue_invocation` uses, `invocations.py:307-312` — confirm its
      signature; it must exist, be in-org, `parsed`). This prevents attaching a half-uploaded/rejected file.
    - **Supersede:** `UPDATE study_protocol_association SET is_active=false WHERE study_id=:s AND org_id=:o
      AND is_active` (flip any current active row), then insert the new `is_active=true` row. Do both in the
      same transaction so the partial-unique index never sees two active rows.
    - Write an audit event (mirror how `associate_location_to_study` audits — grep it; use the same event
      family / a `study.protocol.attached`-style verb consistent with existing hierarchy-association audit
      verbs).
    - Return the new active association (for the 201 read model).
  - [x] `get_active_study_protocol(session, *, study_id, org_id) -> StudyProtocolAssociation | None`:
    select the `is_active=true` row for the study (org-scoped), join `FileReference` for the read model.
    Returns `None` when none.
  - [x] `detach_study_protocol(session, *, study_id, org_id, acting_user_id)`: flip the active row to
    `is_active=false` (retain history). No-op-safe if none active. Audit `study.protocol.detached`.
  - [x] **Do NOT touch `delete_study`** (`:682-716`) — the `ON DELETE CASCADE` FK on `study_id` cleans up
    protocol rows automatically, exactly like `study_location_association` (see the comment at
    `hierarchy_service.py:689-694`). Adding a manual cleanup call would be redundant. (This is the payoff
    of choosing real-FK over polymorphic — Trap 4.)

- [x] **Task 4 — Routes: attach/list(get-active)/detach (AC6)** — `app/api/v1/hierarchy.py`
  - [x] Add three routes mirroring `associate_study_location`/`disassociate_study_location`
    (`:486-539`) and `get_location`/list patterns:
    - `POST /studies/{study_id}/protocol` → `get_study` + `assert_in_scope` +
      `attach_study_protocol(...)`; 201 + `ResponseEnvelope[StudyProtocolRead]`.
    - `GET /studies/{study_id}/protocol` → `get_study` + `assert_in_scope` +
      `get_active_study_protocol(...)`; 200 + `ResponseEnvelope[StudyProtocolRead | None]`.
    - `DELETE /studies/{study_id}/protocol` → `get_study` + `assert_in_scope` +
      `detach_study_protocol(...)`; 204.
  - [x] Use the same dependency set as the location-association routes (`CurrentUser`, `DbSession`,
    `HierarchyScope`) — router-level `RejectClient` already applies (verify the router default). No grantor
    gate is specified for protocol (it's a consultant-facing engagement action, like location association);
    do **not** add `_require_grantor` unless the location-association routes have it — match them exactly.

- [x] **Task 5 — Request-side protocol injection into invocations (AC4)** — `app/api/v1/invocations.py`
  - [x] In `queue_invocation` (`:255-458`), **before** `inputs_payload` is assembled (`~:316-321`), resolve
    the run's Study (if any) and its active protocol, then append the protocol's `file_ref_id` to the
    document list. Study resolution per invocation shape:
    - **non-location-dependent** run: `body.study_id` (if present).
    - **fan-out** run: the study driving the fan-out (`~:336-338` resolves it).
    - **location-dependent single**: study resolved inside `_resolve_single_job_hierarchy_path`
      (`~:217-224`) — thread the resolved `study_id` back out, or resolve it once up front. Dev picks the
      cleanest single resolution; the invariant is: **one place** computes "the Study for this run (or None)".
    - Project/Client-level run with no Study → inject nothing.
  - [x] `protocol = await hierarchy_service.get_active_study_protocol(session, study_id=..., org_id=user.org_id)`.
    If present and `str(protocol.file_ref_id)` **not already in** the caller-supplied `file_ref_ids` list,
    append it. **Dedupe is mandatory** (a diligent caller might pass it explicitly; injecting twice would
    double the document in context).
  - [x] The injected id flows through the **existing** `assert_file_ref_ready` + `inputs_payload["file_ref_ids"]`
    machinery unchanged — no executor change needed (the four executor doc-loaders in
    `execution_service.py` / `code_driven_executor.py` already read `inputs["file_ref_ids"]`). Confirm the
    protocol `file_ref_id` is validated ready (it was validated at attach time, but a protocol could in
    principle be deleted between attach and run — safest is to let it pass through the same
    `assert_file_ref_ready` gate the other ids pass, or skip-with-log if not ready rather than 500 the run;
    dev's call — prefer skip-with-structlog-warning over failing an otherwise-valid run).

- [x] **Task 6 — The new skill flag `requires_additional_documents`, end-to-end (AC5)** — mirror
  `location_dependent` at every site (this is the exact, verified template)
  - [x] **Model** `app/models/skill.py`: add
    `requires_additional_documents: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True,
    server_default=text("true"))` **beside** `location_dependent` (`:65-67`). **NOTE the default is `True`**
    (not `false` like `location_dependent`) — this keeps the Run Console upload visible for every existing
    skill (confirmed decision, no regression).
  - [x] **Migration**: fold into the same `0028` migration (or a separate one — dev's call; one migration
    is fine since both are additive and this story owns both). `op.add_column("skills", sa.Column(
    "requires_additional_documents", sa.Boolean(), nullable=False, server_default=sa.text("true")))`;
    `downgrade()` drops it. (Pattern: `0012_location_fan_out.py:40-48`.)
  - [x] **Schemas** `app/schemas/skill.py`: add to `SkillCreate` (`~:353`, `= True`), `SkillRead`
    (`~:429`), `SkillMetadataUpdate` (`~:558`, `bool | None = None`), and to `_PATCH_NULL_REJECTED`
    (`~:529`) so an explicit `null` on PATCH → 422 (exactly like `location_dependent`).
  - [x] **Service** `app/services/skill_service.py`: add the param to `create_skill` (`~:747`) and pass it
    into the `Skill(...)` constructor (`~:796`); check the other `Skill(...)` construction sites
    (`~:910/970/1035` — derive/import paths) and add it where a full skill is built. Add
    `"requires_additional_documents"` to `_AUDITED_VERBATIM` (`~:1809-1811`). PATCH is **generic**
    (`setattr` loop, `~:1781-1782`) — no PATCH service change beyond the schema field.
  - [x] **Router** `app/api/v1/skills.py`: POST create passes `requires_additional_documents=body.requires_additional_documents`
    into the service (`~:145`). PATCH is generic (`model_dump(exclude_unset=True)`, `~:947`) — no change.
  - [x] **Consider** propagating to `app/schemas/skill_attachment.py` (`AttachedSkillRead`, beside
    `location_dependent` `~:40`) and `app/schemas/client.py` (`ClientSkillRead` `~:149/166`) **if** the
    Run Console reads the flag off the attachment/picker payload (see FE Task 10 — the context-first Run
    Console gates `location_dependent` off `selectedSkill`, an `AttachedSkill`, so the flag likely needs to
    ride there too). Also `skill_export.py` (`~:209/384/409`) round-trips `location_dependent` — add the new
    flag there for export/import parity. Grep `location_dependent` across `app/` and add the new flag at
    every read-model/export site it appears (the derive request `SkillDeriveRequest` intentionally omits
    `location_dependent` — omit the new flag there too, matching).

- [x] **Task 7 — Tests (AC2-AC6)** — `tests/integration/`
  - [x] Migration/model test: create table via `alembic upgrade`, assert the partial unique index rejects a
    second `is_active=true` row for the same `(study_id, org_id)` but **allows** an inactive one. Follow the
    subprocess-`alembic` harness pattern established by Story 16.3's migration test
    (`tests/integration/services/test_client_skill_attachment_migration.py`) — in-process
    `alembic.command` collides with pytest-asyncio's loop (documented 16.3 gotcha); invoke `alembic` as a
    subprocess and dispose the shared async engine after.
  - [x] Route tests (new file or extend the study/location association test file): attach a protocol
    (201), GET returns it, attach a **second** protocol → GET returns the new one and the old row is
    `is_active=false` (supersede), DELETE → GET returns none. Attaching a non-`parsed`/cross-org
    `file_ref_id` → 4xx (via `assert_file_ref_ready`). `assert_in_scope` 403 for out-of-scope study.
  - [x] Injection tests (extend `tests/integration/api/test_invocations.py` or the invocation test file):
    - Study with an active protocol + a non-location-dependent run → the job's persisted
      `inputs["file_ref_ids"]` **contains** the protocol id.
    - **Dedupe**: caller passes the protocol id explicitly → it appears **once**, not twice.
    - Study **without** a protocol → no injection.
    - Project/Client-level run (no study) → no injection.
    - Fan-out and location-dependent-single shapes → protocol injected for each (or once — assert the
      shape the dev implemented; the invariant is the protocol reaches the executor's document set).
  - [x] Skill-flag tests (extend `tests/integration/api/test_skills.py`): create a skill → default
    `requires_additional_documents == true`; create with `false` → persisted; PATCH toggles it and writes
    an audit row (assert the `_AUDITED_VERBATIM` old→new entry); PATCH `null` → 422.
  - [x] Rebuild the api image before pytest (image bakes source — stale image = false results; documented
    gotcha). No worker code changes here, but if any shared module the worker imports changed
    (`hierarchy_service`, `skill` model), rebuild the worker too and confirm (Epic 15 lesson).

- [x] **Task 8 — OpenAPI spec regen (AC7)** — `docs/api-spec.json`
  - [x] Regenerate via the repo's canonical export (Story 16.3: `python3 -m scripts.export_openapi`
    **inside the container** — module invocation, not bare script path, or `sys.path` breaks the
    `app.main` import; `docker cp` the spec out if the script writes inside the image). Do **not** hand-edit.
    The 3 new protocol routes + the new `skills` field must appear in the diff.

### velara-web

- [x] **Task 9 — API client + hooks for study protocol (AC1, AC3, AC6)** —
  `src/api/hierarchy.ts`, `src/features/engagements/hooks/useEngagements.ts`
  - [x] `hierarchy.ts`: add `attachStudyProtocol(studyId, fileRefId)` → `POST /api/v1/studies/{studyId}/protocol`
    (body `{ file_ref_id }`), `getStudyProtocol(studyId)` → `GET .../protocol`, `detachStudyProtocol(studyId)`
    → `DELETE .../protocol`. Mirror `associateLocation`/`disassociateLocation` (`hierarchy.ts:130-137`).
    Add the `StudyProtocol` response type (mirror the backend `StudyProtocolRead`).
  - [x] `useEngagements.ts`: add hooks mirroring the **association-hook shape** (`useAssociateLocation`
    `:188-194`): `useStudyProtocol(studyId)` (query, key `['studyProtocol', studyId]` — **singular** key
    per the singular-record convention, like `['study', id]` `:207`), `useAttachStudyProtocol(studyId)` and
    `useDetachStudyProtocol(studyId)` (mutations invalidating `['studyProtocol', studyId]`). **Both
    wholesale mock files must be updated** — see Task 12.

- [x] **Task 10 — Study create/edit protocol upload + Protocol card (AC1, AC3)** —
  `src/features/engagements/components/EngagementsScreen.tsx`
  - [x] **EntityModal** (`:174`): extend, do not fork. Add a conditional protocol-upload block (mirror the
    `isLocation` conditional field block `:427-480`) shown for `add-study` and `edit-study` modes: render
    `<DocumentUploadCard onFileRefIdChange={setProtocolFileRefId} onUploadingChange={setProtocolUploading} />`,
    hold `protocolFileRefId` in local state, and gate the submit button on `!protocolUploading` (upload
    must finish before create/attach — RunConsole precedent). **Focus-trap caveat:** the trap
    (`handleTrapKey` `:252-259`, initial focus `:242`) queries `'input,textarea,button:not([disabled])'`;
    `DocumentUploadCard` adds a `role="button"` div + hidden file input + a "Remove" button — verify tab
    order still cycles after adding it.
  - [x] **Submit wiring:** in the `add-study` branch (`:320-322`), after `createStudy` succeeds, if a
    protocol was uploaded, call `attachStudyProtocol(newStudyId, protocolFileRefId)` **then** close. This
    is now a two-step (create → attach), so change `onSuccess: onClose` to chain the attach (await create,
    then attach, then close) — do NOT fire-and-forget. In the `edit-study` branch (`:323-328`), if a new
    protocol was uploaded, attach it (supersede). Report attach errors via the modal's `applyApiErrors`.
  - [x] **Protocol card on StudyDetail** (`:1112`, beside `StudyLocationsCard` at `:1156-1163`): add a
    Protocol card structurally mirroring `StudyLocationsCard` (`:947-1020`) — `<Card>`, an `<h3>Protocol</h3>`
    heading (**unique** — do not reuse "Document"/"Locations"), the active protocol's filename row with a
    **Remove** button (→ `useDetachStudyProtocol`), and an **empty state** ("No protocol attached") with an
    add affordance that opens the upload (either the edit modal or an inline `DocumentUploadCard`). Use
    `<Icon name="doc2" />` for the row (a document glyph already in `Icon.tsx:43`) — **never emoji**
    (HARD rule). Fed by `useStudyProtocol(study.id)`.

- [x] **Task 11 — New skill-flag toggle on the skill form (AC5)** —
  `src/features/skills/` (`types.ts`, `components/SkillForm.tsx`, `SkillCreate.tsx`, `SkillEdit.tsx`)
  - [x] `types.ts`: add `requires_additional_documents?: boolean` to `SkillCreateInput` (`~:19`),
    `requires_additional_documents: boolean` to `Skill` (`~:71`), and add it to the `SkillUpdateInput`
    `Pick` list (`~:52`).
  - [x] `SkillForm.tsx`: add to `FormFields` (`~:67`), initial state
    (`~:183`, `initial?.requires_additional_documents ?? true` — **default true**), dirty-tracking (`~:287`),
    and render a `<Toggle>` **cloning the `location_dependent` block** (`:425-436`) with a clear label
    (e.g. "Requires documents beyond the Study protocol") and helper text.
  - [x] `SkillCreate.tsx` (`~:46`): add to the `SkillCreateInput` object. `SkillEdit.tsx` (`~:152-154`):
    add a `buildPatchBody` diff block (`if (values.requires_additional_documents !== skill!.requires_additional_documents)
    patch.requires_additional_documents = ...`). API client (`src/api/skills.ts`) sends the whole object —
    no change beyond types.

- [x] **Task 12 — Run Console "optional" labeling + tests + gates (AC5, AC7)** —
  `src/features/run/components/RunConsole.tsx`, co-located `.test.tsx`, the two wholesale mocks
  - [x] **RunConsole conditional labeling** (do NOT hide the card): both modes render `<DocumentUploadCard>`
    unconditionally today — context-first `:717`, skill-first `:1031`. Add a computed
    `protocolCoversNeed` = "run context is a Study with an active protocol AND
    `!skill.requires_additional_documents`". When true, pass a prop to `DocumentUploadCard` (add an
    optional `optionalHint?: string` or `variant` prop to the card, `DocumentUploadCard.tsx`) that renders
    the "optional — the Study's protocol is included automatically" caption. When false, render as today.
    **Never remove the card** (confirmed decision).
    - To know a Study protocol exists: query `useStudyProtocol(studyId)` for the resolved study context
      (context-first has `studyId`/`origin` `:465-484`; skill-first has `selection.studyId` `:785`). Only a
      Study context can have a protocol.
    - To read the skill flag: context-first `selectedSkill` is an `AttachedSkill` (`:500`) — if you added
      the flag to `AttachedSkill` (Task 6), gate off `selectedSkill?.requires_additional_documents` (mirror
      `location_dependent` at `:510`); otherwise read the separately-fetched `fullSkill` (`:504`).
      Skill-first `skill` is a full `SkillWithVersion` (`:780`) — reads the flag directly.
  - [x] **Tests:** `EngagementsScreen.test.tsx` — Study-create with a protocol upload threads the
    `file_ref_id` into an attach call (extend the existing AC1 create test `:536-558`); Protocol card
    renders active protocol + Remove → detach; scope card-internal assertions with `within` and query the
    Protocol card by its **unique** `getByRole('heading', { name: 'Protocol' })` (do not assert bare
    `getByText('Document')` — `DocumentUploadCard` labels itself "Document", `DocumentUploadCard.tsx:63`).
    `SkillForm`/`SkillEdit` tests: the new toggle defaults on, round-trips through create + PATCH.
    RunConsole test: with a Study protocol + non-requiring skill, the upload card shows the optional hint;
    with a requiring skill or no protocol, it shows the normal prompt.
  - [x] **Both wholesale `useEngagements`-mock files MUST list the new hooks** or components crash on
    render ("not a function"): `src/routes/internal.test.tsx` (factory mock `:11-40`) and
    `src/pages/LogoutFlow.test.tsx` (factory mock `:21-40`). Add `useStudyProtocol`,
    `useAttachStudyProtocol`, `useDetachStudyProtocol` to **both**. Also add `vi.mocked(...).mockReturnValue(...)`
    entries in `EngagementsScreen.test.tsx`'s `beforeEach` (`~:182-193`).
  - [x] Gates: `tsc --noEmit` + `eslint` clean; `vitest run` green (0 regressions).

- [x] **Task 13 — Cross-repo gate (AC7)**
  - [x] Do NOT commit velara-api or velara-web (never-push-subrepos rule — dev-story only commits the
    top-level docs repo; code-review commits the subrepos post-review). Rebuild the api image before
    pytest (image bakes source). Rebuild the worker only if a worker-imported shared module changed.

## Dev Notes

### The exact change surface (verified against source — line numbers current on `development`)

| File | What changes |
|---|---|
| `app/models/hierarchy.py` | NEW `StudyProtocolAssociation` model (beside `StudyLocationAssociation` `:189-219`) — real FKs + `ON DELETE CASCADE`, `is_active`, partial unique index. |
| `app/models/skill.py` | NEW `requires_additional_documents` bool column beside `location_dependent` `:65-67` (**default `True`**). |
| `app/db/migrations/versions/0028_*.py` | NEW additive migration: create `study_protocol_association` + partial unique index; add `skills.requires_additional_documents`. `down_revision="0027_client_only_grants"`. |
| `app/schemas/study_protocol.py` (new) | `StudyProtocolCreate` / `StudyProtocolRead`. |
| `app/schemas/skill.py` | add `requires_additional_documents` to `SkillCreate` `~:353`, `SkillRead` `~:429`, `SkillMetadataUpdate` `~:558`, `_PATCH_NULL_REJECTED` `~:529`. |
| `app/services/hierarchy_service.py` | NEW `attach_study_protocol` (supersede) / `get_active_study_protocol` / `detach_study_protocol` beside `associate_location_to_study`. **`delete_study` unchanged** (cascade handles it). |
| `app/services/skill_service.py` | add flag to `create_skill` param + `Skill(...)` ctor sites; add to `_AUDITED_VERBATIM` `~:1809`. PATCH generic — no change. |
| `app/api/v1/hierarchy.py` | 3 new `/studies/{id}/protocol` routes mirroring the location-assoc routes `:486-539`. |
| `app/api/v1/invocations.py` | request-side protocol injection in `queue_invocation` at `inputs_payload` assembly `~:316-321` (resolve study → active protocol → append+dedupe). |
| `app/api/v1/skills.py` | POST create passes the new flag `~:145`. PATCH generic. |
| `docs/api-spec.json` | regenerated. |
| FE `src/api/hierarchy.ts` | `attach/get/detachStudyProtocol` + `StudyProtocol` type. |
| FE `src/features/engagements/hooks/useEngagements.ts` | `useStudyProtocol` + attach/detach hooks. |
| FE `EngagementsScreen.tsx` | EntityModal protocol upload (create+edit) + Protocol card on StudyDetail. |
| FE `src/features/skills/{types.ts,SkillForm.tsx,SkillCreate.tsx,SkillEdit.tsx}` | new flag toggle end-to-end. |
| FE `src/features/run/components/{RunConsole.tsx,DocumentUploadCard.tsx}` | conditional "optional" labeling (card never hidden). |

### ⚠️ Non-obvious traps (this is where a naive implementation regresses)

**Trap 1 — the join table is real-FK, NOT polymorphic; and it is a HISTORY table.** Both sides
(`file_references`, `studies`) resolve to exactly one real table, so use real FKs with `ON DELETE CASCADE`
(the `study_location_association` precedent, `hierarchy.py:189-219`), **not** `SkillAttachment`'s
`node_id`/`node_type` polymorphic shape — the architect's own documented rule (`hierarchy.py:190-197`).
But unlike `study_location_association` (a plain composite-PK pair), this table keeps **history**: one row
per protocol-ever-attached, at most one `is_active=true` per study. So it needs a **surrogate `id` PK** and
a **partial unique index** `(study_id, org_id) WHERE is_active`, not a composite PK. Getting this wrong
(composite PK, or a full unique on `(study_id, org_id)`) blocks the supersede-with-history flow.

**Trap 2 — the FK to `file_references.id` must be a real `UUID`, not `String(36)`.** `FileReference.id`
is `UUID(as_uuid=True)` (`file_ref.py:48`), unlike `SkillAttachment`'s `String(36)` PK. The `file_ref_id`
FK column type must match (`UUID`), or the FK/migration fails. Same for `study_id → studies.id`.

**Trap 3 — injection must dedupe and must be Study-scoped.** In `queue_invocation`, a caller might already
pass the protocol's `file_ref_id` explicitly; injecting it again double-loads the document into context
(wasted tokens, possibly confusing output). Dedupe against `body.file_ref_ids` before appending. And only a
run with a resolvable **Study** context gets an injection — a Project/Client-level run has no protocol.
There are **three** invocation shapes (non-LD, LD-single, fan-out) — resolve "the Study for this run (or
None)" **once** and inject in one place; do not scatter the logic.

**Trap 4 — do NOT add a `delete_study` cleanup call.** It's tempting to mirror `delete_study`'s
`delete_attachments_for_node` call (`hierarchy_service.py:696-700`) for the new table. **Don't.** That call
exists only because `skill_attachment.node_id` has **no FK** (no cascade). The protocol table uses a real
`study_id ... ON DELETE CASCADE` FK, so rows cascade automatically — exactly like `study_location_association`,
which `delete_study` also does NOT clean up manually (see the comment at `:689-694`). A redundant manual
delete would be dead code at best.

**Trap 5 — the skill flag default is `True`, opposite `location_dependent`.** `location_dependent` defaults
`false` (opt-in). The new `requires_additional_documents` defaults **`true`** so that after this ships,
every existing skill keeps its Run Console upload visible — no silent removal of a working affordance
(confirmed decision). Copy the `location_dependent` **wiring** exactly, but flip the default in the model
(`server_default=text("true")`), the migration (`server_default=sa.text("true")`), and the `SkillCreate`
schema (`= True`).

**Trap 6 — the Run Console never HIDES the upload; it re-labels it.** AC5's earlier draft said "hidden";
the confirmed decision is **show-but-optional**. Do not gate the `<DocumentUploadCard>` render behind the
flag. Instead, when the Study protocol already covers the skill's need, render the card **with an
"optional" hint**. This means adding a presentational prop to `DocumentUploadCard`, not a conditional in
RunConsole that removes it.

**Trap 7 — Study create becomes a two-step FE flow (create → attach).** Today the `add-study` submit is
`createStudy.mutate(input, { onSuccess: onClose })` — fire-and-close. With an optional protocol, on success
you must **await** the create (to get the new `study_id`), **then** attach the protocol, **then** close.
Don't `onSuccess: onClose` and drop the attach. Gate submit on upload-complete (`onUploadingChange`) so you
never attach a half-uploaded file.

**Trap 8 — heading/text uniqueness in EngagementsScreen tests.** `DocumentUploadCard` labels itself
"Document" (`DocumentUploadCard.tsx:63`); `StudyLocationsCard` has an `<h3>Locations</h3>` (`:965`); the
skills card has `<h3>` too. Give the Protocol card a **unique** `<h3>Protocol</h3>` and query it by role
+ name; scope card-internal assertions with `within`. `queryByText('Study')` is already asserted **absent**
on a Location detail (`test :632`) — keep all protocol UI on `StudyDetail`, not on Location screens.

**Trap 9 — both wholesale `useEngagements` factory mocks must list every new hook.** `vi.mock(...factory)`
does not auto-provide new exports. Adding `useStudyProtocol`/`useAttachStudyProtocol`/`useDetachStudyProtocol`
without adding them to **both** `src/routes/internal.test.tsx` (`:11-40`) and `src/pages/LogoutFlow.test.tsx`
(`:21-40`) crashes those suites on render ("not a function"). Verified prior-story trap (16.2/16.3).

### Reuse map (do NOT rebuild)

- **Upload UI** — `DocumentUploadCard` (`src/features/run/components/DocumentUploadCard.tsx`): self-contained,
  drives the full presign→confirm→parse lifecycle via `useIngest`
  (`src/features/run/hooks/useIngest.ts`), emits the ready `file_ref_id` via `onFileRefIdChange`, reports
  in-flight via `onUploadingChange`. Reuse verbatim at Study-create/edit and in the Protocol card. Its
  `basePath` defaults to internal `/api/v1/ingest` — correct for admin study creation (no override needed;
  only the client portal overrides it).
- **Join-table model** — `StudyLocationAssociation` (`hierarchy.py:189-219`) + its migration
  (`0025_location_client_ownership.py:83-96`): the real-FK-with-cascade template.
- **Association service fns** — `associate_location_to_study`/`disassociate_location_from_study`
  (`hierarchy_service.py`): naming, org-scoping, audit, and the `acting_user_id` threading precedent.
- **Association routes** — `associate_study_location`/`disassociate_study_location` (`hierarchy.py:486-539`):
  the exact route shape (`get_study` + `assert_in_scope` + service call).
- **Ready-file validation** — `ingest_service.assert_file_ref_ready` (used at `invocations.py:307-312`):
  reuse to validate a `file_ref_id` at attach time.
- **Skill flag template** — `location_dependent` end-to-end (model `skill.py:65-67`, migration
  `0012_location_fan_out.py:40-48`, schemas `skill.py:353/429/529/558`, service `skill_service.py:747/796/1809`,
  router `skills.py:145`, FE `types.ts` + `SkillForm.tsx:425-436` `<Toggle>` + `SkillCreate.tsx:46` +
  `SkillEdit.tsx:152-154`). Clone it; flip the default to `True`.
- **FE Protocol card** — `StudyLocationsCard` (`EngagementsScreen.tsx:947-1020`): Card + row + Remove
  markup to mirror (but attach-via-upload, not the AssociateLocationPanel picker).
- **FE association hooks** — `useAssociateLocation`/`useDisassociateLocation` (`useEngagements.ts:188-205`):
  mutation shape + query-key invalidation convention.

### Data model & flow facts (verified)

- `FileReference` (`app/models/file_ref.py`): `id` is real `UUID(as_uuid=True)` (`:48`), `org_id`
  `String(128)` (`:52`), `status` state machine `pending→confirmed→parsed` (`:26-35`); **only `parsed`
  files are usable in a run** (`ingest_service.build_context_input` gates on it). **No hierarchy
  attachment column today** (`:10-11` docstring). Ingest routes: `POST /api/v1/ingest/{presign,confirm}`
  (`ingest.py:40,75`), returned id field is `file_ref_id`; client mirror at `client.py:615-690`.
- Invocation request: `InvocationRequest.file_ref_ids: list[uuid.UUID] = []` (`schemas/invocation.py:64`),
  `model_config = ConfigDict(extra="forbid")` (`:62`) — so the **request schema is NOT changed** (protocol
  is injected server-side). `queue_invocation` validates each id via `assert_file_ref_ready`
  (`invocations.py:307-312`) and assembles `inputs_payload = {"file_ref_ids": [...], "inputs": ...}`
  (`:316-321`) → `job.inputs`. Executors read `inputs["file_ref_ids"]` (`execution_service.py:479-490,
  584-588, 839-843`; `code_driven_executor.py:462-474`) — **no executor change needed**.
- `Skill.location_dependent` (`skill.py:65-67`): the exact flag precedent (`Boolean`, NOT NULL,
  `server_default=text("false")`). PATCH service is generic (`setattr` loop, `skill_service.py:1781-1782`);
  `_AUDITED_VERBATIM` (`:1809-1811`) records old→new for bounded fields; `_PATCH_NULL_REJECTED`
  (`skill.py:529`) rejects explicit-null on PATCH.
- Migration head: **`0027_client_only_grants`** (verified: no child). New revision `0028_*`.
- `delete_study` (`hierarchy_service.py:682-716`): `study_location_association` cleaned by cascade (no code,
  comment `:689-694`); `skill_attachment` cleaned by explicit call (`:696-700`) **because node_id has no
  FK**. The new protocol table uses a real cascade FK → **no `delete_study` change**.

### Testing standards

- Backend: pytest, integration tests under `tests/integration/`. Rebuild the api image before pytest
  (image bakes source). Migration tests use **subprocess `alembic`** (in-process `alembic.command` collides
  with pytest-asyncio's running loop — documented 16.3 gotcha) and dispose the shared async engine after.
  CI runs `ruff` + `pytest` only (no mypy in CI per Epic-15/16 memory — still run `mypy` locally to satisfy
  AC7). Audit rows: the new flag rides `_AUDITED_VERBATIM`; protocol attach/detach audits via the hierarchy
  association event family (grep `associate_location_to_study`'s audit call).
- Frontend: Vitest + React Testing Library, co-located `*.test.tsx`. Watch the heading-uniqueness trap and
  the two wholesale-`useEngagements`-mock files. `-e AUTH_BACKEND=dev` for host pytest of API (documented
  recipe).

### Git / build context

- `velara-api` on `development` (head `459e2a8`), `velara-web` on `development` (head `5a613a9`). Both are
  **separate nested git repos** from the top-level docs repo; `cd`ing in shifts Bash cwd — `cd` back for
  docs-publish git commands.
- Do NOT commit either subrepo (never-push-subrepos rule). Regenerate `docs/api-spec.json` but do not commit
  it here — code-review commits the api subrepo post-review.

### Project Structure Notes

- Backend: new model in `app/models/hierarchy.py`, new schema module `app/schemas/study_protocol.py`, new
  migration in `app/db/migrations/versions/`, service fns in `app/services/hierarchy_service.py`, routes in
  `app/api/v1/hierarchy.py`, injection in `app/api/v1/invocations.py`, the skill flag across
  `app/models/skill.py` / `app/schemas/skill.py` / `app/services/skill_service.py` / `app/api/v1/skills.py`,
  tests under `tests/integration/`, `docs/api-spec.json`. No new directories.
- Frontend: `src/api/hierarchy.ts`, `src/features/engagements/hooks/useEngagements.ts`,
  `src/features/engagements/components/EngagementsScreen.tsx`, `src/features/skills/{types.ts,
  components/SkillForm.tsx, components/SkillCreate.tsx, components/SkillEdit.tsx}`,
  `src/features/run/components/{RunConsole.tsx,DocumentUploadCard.tsx}`, co-located tests, and the two
  wholesale-mock files. Use `<Icon>` (`src/shared/components/Icon.tsx`), never emoji. No new directories.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.4] —
  parent epic story (the epic-level AC contract).
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-20-engagement-model-refinement.md] —
  FR-ING-05 / FR-USE-08 definitions; the confirmed "add protocol later via edit, no backfill" and
  "conditional Run Console upload" decisions.
- [Source: _bmad-output/implementation-artifacts/stories/16-3-client-level-skill-attachment.md] — prior
  Epic 16 story: the `/studies/{id}/…` route shape, the migration-test subprocess-alembic harness, the
  wholesale-mock trap, the OpenAPI regen recipe, and the `0027` head.
- [Source: _bmad-output/implementation-artifacts/stories/16-2-client-level-location-management-and-study-association-ui.md] —
  the `StudyLocationsCard` + association-hook UI precedent this story's Protocol card mirrors; the
  shared-entity key-prefix invalidation lesson.
- [Source: velara-api/app/models/file_ref.py#L26-L108] — `FileReference` columns, real-UUID PK, status
  machine, no hierarchy attachment.
- [Source: velara-api/app/models/hierarchy.py#L189-L219] — `StudyLocationAssociation` real-FK+cascade
  precedent (and the architect's polymorphic-vs-plain rule).
- [Source: velara-api/app/db/migrations/versions/0025_location_client_ownership.py#L83-L96] — raw
  CREATE TABLE + cascade FK migration template.
- [Source: velara-api/app/db/migrations/versions/0012_location_fan_out.py#L40-L48] — `add_column` boolean
  flag migration template.
- [Source: velara-api/app/models/skill.py#L65-L67] + [velara-api/app/schemas/skill.py#L353,L429,L529,L558]
  + [velara-api/app/services/skill_service.py#L747,L796,L1781-L1811] — the `location_dependent` end-to-end
  flag template.
- [Source: velara-api/app/api/v1/hierarchy.py#L486-L539] — the study-location association routes (route
  template).
- [Source: velara-api/app/api/v1/invocations.py#L255-L458] — `queue_invocation`; `assert_file_ref_ready`
  (`:307-312`), `inputs_payload` assembly (`:316-321`), the three invocation shapes.
- [Source: velara-api/app/services/execution_service.py#L479-L490] + [code_driven_executor.py#L462-L474] —
  where `inputs["file_ref_ids"]` documents are injected into context (unchanged by this story).
- [Source: velara-api/app/services/hierarchy_service.py#L682-L716] — `delete_study` cascade-vs-explicit
  cleanup (why no protocol cleanup call is needed).
- [Source: velara-api/app/api/v1/ingest.py#L40-L123] + [velara-api/app/schemas/ingest.py#L15-L39] — presign/
  confirm routes + `FileRefRead` (S3-key-omitting read model to mirror).
- [Source: velara-web/src/features/run/components/DocumentUploadCard.tsx#L4-L15] +
  [velara-web/src/features/run/hooks/useIngest.ts] — reused upload card + hook.
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L174,L320-L322,L947-L1020,L1112-L1207] —
  EntityModal, the add-study submit branch, `StudyLocationsCard`, `StudyDetail`.
- [Source: velara-web/src/features/engagements/hooks/useEngagements.ts#L188-L209] — association hook shape +
  query-key conventions.
- [Source: velara-web/src/features/skills/components/SkillForm.tsx#L425-L436] — the `location_dependent`
  `<Toggle>` block to clone.
- [Source: velara-web/src/features/run/components/RunConsole.tsx#L510,L717,L1031] — the `location_dependent`
  conditional precedent and the two `DocumentUploadCard` render sites.
- [Source: velara-web/src/routes/internal.test.tsx#L11-L40] + [velara-web/src/pages/LogoutFlow.test.tsx#L21-L40] —
  the two wholesale `useEngagements` factory mocks that must list every new hook.
- [Source: velara-web/src/shared/components/Icon.tsx#L43] — `doc2` icon for the Protocol card (no emoji).
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] —
  envelope, error-code, TanStack Query, ltree-scope, migration conventions.

## Change Log

- 2026-07-23 — Implemented Story 16.4. Both subrepos. **Backend (velara-api):** new
  `study_protocol_association` table (real FKs + `ON DELETE CASCADE` on both sides, surrogate `id` PK,
  `is_active` history semantics, partial unique index guaranteeing at most one active protocol per
  `(study_id, org_id)`) added via idempotent migration `0028_study_protocol_association` (also adds
  `skills.requires_additional_documents`, default `true`). New service functions
  `attach_study_protocol`/`get_active_study_protocol`/`detach_study_protocol` (supersede-not-delete on
  re-attach) beside `associate_location_to_study`; `delete_study` intentionally left unchanged — the
  cascade FK cleans up protocol rows automatically. New `POST/GET/DELETE /studies/{id}/protocol` routes
  mirroring the location-association route shape. Request-side protocol injection added to
  `queue_invocation` (one resolution point, all three invocation shapes + client-portal reuse; dedupes
  against caller-supplied `file_ref_ids`; skip-with-log if a stale protocol fails the ready-check rather
  than failing the run). New skill flag `requires_additional_documents` threaded end-to-end mirroring
  `location_dependent` (model, migration, schemas incl. `_PATCH_NULL_REJECTED`, service incl.
  `_AUDITED_VERBATIM`, router, `AttachedSkillRead`, `ClientSkillRead`/`ClientSkillRead.from_skill`,
  `skill_export` round-trip) — default `true` (opposite `location_dependent`) so every pre-existing skill
  keeps its Run Console upload visible. `docs/api-spec.json` regenerated (3 new routes + new field on 5+
  schemas). **Frontend (velara-web):** new `StudyProtocol`/`StudyProtocolCreateInput` types + API client
  functions + `useStudyProtocol`/`useAttachStudyProtocol`/`useDetachStudyProtocol` hooks mirroring the
  association-hook shape. `EntityModal`'s `add-study`/`edit-study` modes gained an optional
  `DocumentUploadCard` step; `add-study` submit is now two-step (create → attach using the new
  `study_id`, never fire-and-forget); `edit-study` attaches/supersedes after any field PATCH. New
  `StudyProtocolCard` on `StudyDetail` (Card+row+Remove, mirrors `StudyLocationsCard`) with a unique
  "Protocol" heading. `requires_additional_documents` toggle added to `SkillForm`/`SkillCreate`/`SkillEdit`
  mirroring `location_dependent`, default on. `DocumentUploadCard` gained an `optionalHint` prop (never
  hides the card — only re-labels it); `RunConsole` computes the hint from `useStudyProtocol` + the
  selected/locked skill's flag in both context-first and skill-first modes.
  ⭐ **One implementation deviation from the mirrored `location_dependent` migration pattern, confirmed
  necessary during testing**: migration `0028`'s DDL was made idempotent (`CREATE TABLE/INDEX IF NOT
  EXISTS`, a column-existence check before `add_column`) — this repo's migration-test harness (0025-0027
  precedent) stamps the test DB back to an earlier revision and replays `alembic upgrade head`, which
  re-executes every migration up to and including this story's new head; a non-idempotent `CREATE TABLE`
  collided with the already-materialized table from the harness's own prior run. `0025`/`0026`/`0027`
  never needed this because they only ran once in the harness (they weren't `head` when this story's
  migration was authored) — `0028` being the new `head` is what exposed the gap. No other migration
  needed retrofitting.
  ⭐ **Product decisions confirmed with the operator BEFORE implementation** (locked into the story by
  create-story, not re-litigated during dev): (1) one **active** protocol per Study with **history**
  retained (not a flat replace, not an unbounded list) — drove the partial-unique-index/surrogate-PK
  table shape; (2) the new skill flag defaults to keep the upload **visible** (`true`, opposite
  `location_dependent`'s `false`) — zero regression for existing skills; (3) the Run Console **never
  hides** the upload card, only labels it optional — required a new `DocumentUploadCard` prop rather
  than a conditional render.
  Gates: `ruff` clean, `pytest` 336/336 passed across the touched-area suites (hierarchy, invocations,
  skills, all 3 migration-test modules, openapi) + `tests/unit/test_client_run_fields.py` — 0 regressions;
  a mid-session Docker-VM disk-full crash-looped Postgres (documented recurring gotcha,
  `docker builder prune -a -f` + `docker image prune -a -f` reclaimed ~90GB) was infra, not a code
  regression, and was confirmed via a clean re-run afterward. `mypy` has no tooling in this repo (not a
  dependency) — consistent with the documented CI = ruff+pytest-only fact; not run. `tsc --noEmit` clean,
  `eslint` clean (1 pre-existing unrelated `Icon.tsx` warning), `vitest run` 61 files / 759 tests passing
  (+8 new, 0 regressions from the 16.3 baseline of 751). Both api and worker images rebuilt (shared ORM
  models changed). Not committed to either subrepo (never-push-subrepos rule — only the top-level docs
  repo is committed here; code-review commits the subrepos post-review). Status → review.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8

### Debug Log References

- The first full `pytest tests/` run (1500+ tests) showed 475 failures across unrelated modules
  (`test_audit_service.py`, `test_execution_tasks.py`, `test_jobs.py`, etc.) immediately after the
  targeted regression suite had passed cleanly. Root-caused to the Docker VM disk filling during
  iterative image rebuilds this session (`PANIC: could not write to file
  "pg_logical/replorigin_checkpoint.tmp": No space left on device"`, crash-looping Postgres) — a
  documented recurring gotcha from prior stories, not a code regression. `docker builder prune -a -f` +
  `docker image prune -a -f` reclaimed ~90GB; Postgres recovered cleanly on restart (WAL replay, no data
  loss — both `velara_test` and the dev DB remained at migration head `0028`). Re-ran the full
  touched-area regression suite (336 tests) afterward to confirm zero real regressions.
- Migration `0028`'s first version used plain (non-idempotent) `CREATE TABLE`/`op.add_column`, which
  passed in isolation but broke the pre-existing `0026`/`0027` migration tests once `0028` became head —
  their `stamped_to_00XX` fixtures replay `alembic upgrade head` against a DB where `0028`'s objects
  already exist (from this session's manual `alembic upgrade head` runs against `velara_test`). Fixed by
  making `0028` idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`, a `sa.inspect` column-existence check
  before `add_column`) — mirrors the `CREATE EXTENSION IF NOT EXISTS` idempotency precedent already used
  in migrations 0001/0011.
- The first version of the protocol-injection tests used `celery_eager` + a real `_patch_llm_provider()`
  context, which let the queued job actually execute and try to fetch the (fake, non-existent) protocol
  document's content from MinIO at its `parsed_content_key`, failing with `botocore.exceptions.ClientError:
  NoSuchKey`. Fixed by switching to `_post_invocation` (patches `run_skill.delay` out entirely) and
  `_post_fan_out` (patches `celery.chord` out) — the existing precedent in this test file for asserting
  on a queued job's persisted `inputs` without requiring real execution.
- `EngagementsScreen.test.tsx`'s new protocol-upload-threading test initially used `vi.spyOn` on a
  dynamically-imported `@/api/hierarchy` module, which did not intercept the call made through
  `EngagementsScreen.tsx`'s own static import binding (a real network call was attempted, visible as a
  jsdom preflight-400 stderr line, though it didn't fail the test). Switched to a proper `vi.mock('@/api/hierarchy',
  ...)` with `vi.importActual` preserving every other export — the standard partial-module-mock pattern.

### Completion Notes List

- **Task 1 (AC2):** `StudyProtocolAssociation` model added to `app/models/hierarchy.py` beside
  `StudyLocationAssociation` — real FKs (`study_id`→`studies.id`, `file_ref_id`→`file_references.id`,
  both `ON DELETE CASCADE`), surrogate UUID `id` PK (not composite — a history table needs multiple rows
  per study), `is_active` boolean, partial unique index `uq_study_protocol_active` on `(study_id, org_id)
  WHERE is_active`. Migration `0028_study_protocol_association` (idempotent DDL, see Debug Log) also adds
  `skills.requires_additional_documents`. `down_revision="0027_client_only_grants"` (verified head).
- **Task 2 (AC6):** New `app/schemas/study_protocol.py` — `StudyProtocolCreate`/`StudyProtocolRead`
  (S3-key-omitting, mirrors `FileRefRead`).
- **Task 3 (AC2, AC3, AC6):** `attach_study_protocol` (validates via `ingest_service.assert_file_ref_ready`,
  supersedes any active row transactionally, audits), `get_active_study_protocol` (join to
  `FileReference`, returns `None` when absent), `detach_study_protocol` (flips active→inactive,
  no-op-safe) added to `hierarchy_service.py`. `delete_study` deliberately left unchanged — verified the
  cascade FK handles cleanup (Trap 4).
- **Task 4 (AC6):** `POST/GET/DELETE /studies/{id}/protocol` added to `hierarchy.py`, mirroring the
  location-association route shape exactly (`get_study` + `assert_in_scope` + service call).
- **Task 5 (AC4):** Protocol resolution added to `queue_invocation` right before `inputs_payload`
  assembly — single point, keys off `body.study_id` (present/absent identically across all three
  invocation shapes), dedupes against caller-supplied ids, and gracefully skips (structlog warning) rather
  than failing the run if the protocol fails its ready-check at run time.
- **Task 6 (AC5):** `requires_additional_documents` added at every site `location_dependent` appears
  (model, migration, 4 schema sites, service incl. `_AUDITED_VERBATIM`, 3 `Skill(...)` constructor sites,
  router, `AttachedSkillRead`, `ClientSkillRead` + its `from_skill` classmethod + docstring,
  `skill_export.py` round-trip both directions) — default `True` everywhere (opposite `location_dependent`).
  `SkillDeriveRequest` intentionally omits it, matching `location_dependent`'s omission there.
- **Task 7 (AC2-AC6):** New `test_study_protocol_migration.py` (table existence, partial-unique-index
  enforcement, column default), `test_hierarchy.py` additions (attach/get/detach/supersede,
  not-ready-rejected, cross-org 404), `test_invocations.py` additions (injected/deduped/no-protocol/
  no-study-context/fan-out), `test_skills.py` additions (default-true, false-persisted, PATCH+audit,
  null-reject). Fixed 2 pre-existing test files that broke on the new required `Skill`/`AttachedSkill`
  field: `test_client_run_fields.py`'s `SimpleNamespace` fixtures (not real ORM objects, so the new
  field had to be added explicitly) and `test_openapi.py`'s `_CLIENT_SKILL_ALLOWED_FIELDS` lock set.
- **Task 8 (AC7):** `docs/api-spec.json` regenerated via `python3 -m scripts.export_openapi` inside the
  container; diff confirmed scoped to the 3 new routes + the new field on skill-facing schemas.
- **Task 9 (AC1, AC3, AC6):** `attachStudyProtocol`/`getStudyProtocol`/`detachStudyProtocol` added to
  `src/api/hierarchy.ts`; `useStudyProtocol`/`useAttachStudyProtocol`/`useDetachStudyProtocol` added to
  `useEngagements.ts` mirroring the association-hook shape (singular `['studyProtocol', studyId]` key).
- **Task 10 (AC1, AC3):** `EntityModal` gained a conditional `DocumentUploadCard` step for
  `add-study`/`edit-study`; `add-study` submit is two-step (`createStudy` → `attachStudyProtocolApi` using
  the raw API function, since `study.id` isn't known until create succeeds — never fire-and-forget);
  `edit-study` submit attaches/supersedes after any field PATCH, or standalone if only the protocol
  changed. New `StudyProtocolCard` (mirrors `StudyLocationsCard`'s Card+row+Remove shape, unique
  `<h3>Protocol</h3>` heading, `<Icon name="doc2">`, no emoji) wired into `StudyDetail`.
- **Task 11 (AC5):** `requires_additional_documents` toggle added to `SkillForm`/`SkillCreate`/`SkillEdit`
  cloning the `location_dependent` `<Toggle>` block exactly, default `true`.
- **Task 12 (AC5, AC7):** `DocumentUploadCard` gained an `optionalHint?: string` prop (renders a caption,
  never hides the card). `RunConsole` computes `documentUploadHint` from `useStudyProtocol` + the
  relevant skill's `requires_additional_documents` in both context-first (`selectedSkill`, an
  `AttachedSkill` — flag added there too) and skill-first (`skill`, a full `SkillWithVersion`) modes.
  Both wholesale `useEngagements` mocks (`internal.test.tsx`, `LogoutFlow.test.tsx`) updated with the 3
  new hooks. New tests: protocol-threading on study create, Protocol card render/empty-state, skill-flag
  toggle round-trip (create + PATCH), Run Console optional-hint (3 cases: shown/not-required-with-protocol,
  hidden/required-with-protocol, hidden/no-protocol).
- **Task 13 (AC7):** Both `velara-api` and `velara-worker` images rebuilt (shared ORM models changed).
  Neither subrepo committed (never-push-subrepos rule).

### File List

**velara-api:**
- `app/models/hierarchy.py` (modified — new `StudyProtocolAssociation` model)
- `app/models/skill.py` (modified — new `requires_additional_documents` column)
- `app/db/migrations/versions/0028_study_protocol_association.py` (new)
- `app/schemas/study_protocol.py` (new)
- `app/schemas/skill.py` (modified)
- `app/schemas/skill_attachment.py` (modified)
- `app/schemas/client.py` (modified)
- `app/services/hierarchy_service.py` (modified — new attach/get-active/detach functions)
- `app/services/skill_service.py` (modified)
- `app/services/skill_export.py` (modified)
- `app/api/v1/hierarchy.py` (modified — 3 new protocol routes)
- `app/api/v1/invocations.py` (modified — request-side injection)
- `app/api/v1/skills.py` (modified)
- `app/api/v1/client.py` (modified — docstring only)
- `docs/api-spec.json` (regenerated)
- `tests/integration/services/test_study_protocol_migration.py` (new)
- `tests/integration/api/test_hierarchy.py` (modified)
- `tests/integration/api/test_invocations.py` (modified)
- `tests/integration/api/test_skills.py` (modified)
- `tests/integration/api/test_openapi.py` (modified)
- `tests/unit/test_client_run_fields.py` (modified — fixture fix for new required field)

**velara-web:**
- `src/features/engagements/types.ts` (modified — new `StudyProtocol`/`StudyProtocolCreateInput` types)
- `src/api/hierarchy.ts` (modified — new attach/get/detach functions)
- `src/features/engagements/hooks/useEngagements.ts` (modified — new hooks)
- `src/features/engagements/components/EngagementsScreen.tsx` (modified — protocol upload + card)
- `src/features/run/components/DocumentUploadCard.tsx` (modified — new `optionalHint` prop)
- `src/features/run/components/RunConsole.tsx` (modified — optional-hint wiring)
- `src/api/skillAttachments.ts` (modified — new field on `AttachedSkill`)
- `src/features/skills/types.ts` (modified)
- `src/features/skills/components/SkillForm.tsx` (modified — new toggle)
- `src/features/skills/components/SkillCreate.tsx` (modified)
- `src/features/skills/components/SkillEdit.tsx` (modified)
- `src/features/admin/components/AccessControl.tsx` (modified — new field on attach payload)
- `src/features/engagements/components/EngagementsScreen.test.tsx` (modified — new tests)
- `src/features/skills/components/SkillForm.test.tsx` (modified — new test + fixture fix)
- `src/features/skills/components/SkillEdit.test.tsx` (modified — new test + fixture fix)
- `src/features/run/components/RunConsole.test.tsx` (modified — new tests + fixture fix)
- `src/routes/internal.test.tsx` (modified — wholesale mock + fixture fix)
- `src/pages/LogoutFlow.test.tsx` (modified — wholesale mock)
- `src/api/skills.test.ts` (modified — fixture fix)
- `src/features/admin/hooks/useNodeSkills.test.tsx` (modified — fixture fix)
- `src/features/certification/components/CertificationScreen.test.tsx` (modified — fixture fix)
- `src/features/run/hooks/useProjectSkills.test.tsx` (modified — fixture fix)
- `src/features/skills/components/ConfirmDialog.test.tsx` (modified — fixture fix)
- `src/features/skills/components/SkillCreate.test.tsx` (modified — fixture fix)
- `src/features/skills/components/SkillDetail.test.tsx` (modified — fixture fix)
- `src/features/skills/components/SkillRegistry.test.tsx` (modified — fixture fix)
- `src/features/skills/hooks/useSkills.test.tsx` (modified — fixture fix)
