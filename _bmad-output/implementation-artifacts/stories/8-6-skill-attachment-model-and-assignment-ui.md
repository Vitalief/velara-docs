# Story 8.6: Skill Attachment Model & Assignment UI

---
baseline_commit: 42bd4dd6546df3ff440753ace6c625ea87836a1e
---

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Created 2026-07-01 via create-story. Sequenced BEFORE 8.4 (correct-course sprint-change-proposal-2026-07-01.md). Requires the 2026-07-01 skill-attachment ADR (present in architecture/core-architectural-decisions.md#skill-attachment-model). -->

## Story

As a **Vitalief consultant**,
I want **to attach specific skills to specific Projects and Studies (and see/remove those attachments)**,
so that **a client's portal shows only the skills actually assigned to their engagement — not every org skill of a matching scope**.

## Acceptance Criteria

1. **(AC1 — Attachment schema)** **Given** the Alembic migration runs **When** I inspect the schema **Then** a single polymorphic `skill_attachment` table exists linking a skill to a hierarchy node — columns `id`, `skill_id`, `node_id`, `node_type` (`project`|`study`), `org_id`, `attached_at`, `attached_by_user_id`, with `UNIQUE(skill_id, node_id, node_type, org_id)` (mirrors `user_access_grants` 1:1 — architect ADR).

2. **(AC2 — Attach / unattach API)** **Given** I attach skill X to Project Y **When** I call `POST /api/v1/projects/{project_id}/skills` (and the study equivalent `POST /api/v1/studies/{study_id}/skills`) **Then** the attachment persists; the unattach route (`DELETE /api/v1/projects/{project_id}/skills/{skill_id}`, study equivalent) removes it. Attach/unattach is **consultant/ma_tech gated** and **hierarchy-scope checked** (out-of-scope same-org → 403; cross-org / missing node → 404); re-attaching an existing pair is idempotent (no duplicate, backed by the UNIQUE constraint).

3. **(AC3 — Attach-time scope guard)** **Given** a skill with `scope == "study"` **When** I attempt to attach it to a `project` node (or a `scope == "project"` skill to a `study` node) **Then** the API rejects it with a stable error (a `scope == null` skill may attach to either). `skill.scope` is demoted to an authoring/UX hint whose only executable role is this attach-time validation.

4. **(AC4 — Client availability = real attachments)** **Given** the client portal **When** a client's available skills are resolved **Then** availability is `attached ∩ granted (8.1) ∩ visibility == "client_facing" ∩ lifecycle_state == "client_ready"` — the scope-heuristic is replaced by real attachments. A `list_client_skills` service (consumed by the client skills route) returns only skills attached to a node the client is granted, filtered by visibility/lifecycle — internals never leak.

5. **(AC5 — Internal assignment UI)** **Given** the internal Access Control screen (`/internal/access`, today a `Placeholder`) **When** it loads for a selected client **Then** it renders per-project cards with a project-level skill band and per-study rows; each has an **Attach** affordance (right-docked side panel listing **client-ready skills only**) and each attached skill chip has a hover-revealed **detach ✕** (detach behind a confirm dialog). Attach/detach reflect immediately. Internal-only skills are never offered by the attach panel (guardrail-by-construction).

6. **(AC6 — Internal `useProjectSkills` seam rewired)** **Given** the internal mock seam `useProjectSkills(_projectId)` (which today **ignores** `projectId` and filters global skills by `scope==='project'`) **When** this story lands **Then** it queries **real attachments by `projectId`** — the documented swap point — and its study-level consumer resolves attachments for the study. The `EngagementsScreen` Project and Study skill sections and `RunConsole` show attachment-driven skills.

7. **(AC7 — Node-delete cleanup)** **Given** a Project or Study is deleted **When** the delete runs **Then** its `skill_attachment` rows are removed first (no DB cascade fires — the service cleans them up, mirroring the existing child-delete discipline), so no orphaned attachments remain.

### Definition of Done (gates — must all pass before `done`)

- All 7 ACs satisfied and covered by tests.
- **Backend:** new `skill_attachment` model + migration `0017_skill_attachment` (`down_revision = "0016_user_access_grants"`); attach/unattach/list-attachments + `list_client_skills` service functions; attach/unattach/list routes on the hierarchy router (consultant/ma_tech gated + scope-checked); `list_client_skills` wired so a client skills query filters by attachment ∩ grant ∩ visibility/lifecycle. Node-delete cleanup in `hierarchy_service.delete_project`/`delete_study`. Run BE tests with `docker compose exec -e AUTH_BACKEND=dev api pytest ...` (Constraint C1).
- **Frontend:** the `access/*` `Placeholder` is replaced by a real Access Control assignment screen (client selector + project/study cards + attach panel + detach confirm); `useProjectSkills` rewired to real attachments; `EngagementsScreen` + `RunConsole` consume it. `npm run test` green (vitest); no TypeScript errors.
- `ruff check` + `ruff format` clean (backend); no new lint errors (frontend).
- New OpenAPI schema-lock entries added for every new schema (`test_openapi.py` — the 8.2/8.3 lock discipline).
- `useProjectSkills` swap comment removed/updated (it no longer says "backend skill-attachment is a later epic").

> **Pre-existing failing tests (NOT introduced here — do not "fix" by masking):** the 8.3/8.4 records note pre-existing 8.2 integration failures (`completed_job_presign`, `blocked_job`, `out_of_scope_403`) that are **FK-constraint errors from stale dev-env DB state**, not code. Reset the test DB (`docker compose down -v` / re-migrate) if they surface; do not alter production code to make them pass.

---

## Tasks / Subtasks

> **Sequence:** model + migration → service (attach/unattach/list + client-availability) → node-delete cleanup → routes → BE tests → FE API client + hooks → FE assignment screen (fill the Placeholder + dead-stub) → rewire `useProjectSkills` → FE tests.
> This story is **sequenced BEFORE 8.4** (correct-course §3). It delivers the attachment model AND the attachment-aware client-availability query so 8.4 consumes real attachments from the start (product decision 2026-07-01: "8.6 builds the attachment-aware client query too"). 8.4's story gets a dependency note (see Task 11).

### Backend — Model + migration (AC1)

- [x] **Task 1 — `SkillAttachment` model + migration (AC1)**
  - [x] 1.1 Add `velara-api/app/models/skill_attachment.py` — **mirror `app/models/access_grant.py` exactly** (same `Mapped[]` style, same `String(128)`/`String(36)`/`String(16)` widths for the non-FK columns, same `default=lambda: str(uuid.uuid4())` for `id`, same `DateTime(timezone=True)` with `default=lambda: datetime.now(UTC)`). Class `SkillAttachment(Base)`, `__tablename__ = "skill_attachment"`. Columns: `id: Mapped[str]` PK (`String(36)`, uuid-string lambda default — matches access_grant's own id, which is a string even though skills.id is a real UUID); **`skill_id: Mapped[uuid.UUID]` (`from sqlalchemy.dialects.postgresql import UUID` → `mapped_column(UUID(as_uuid=True), ForeignKey("skills.id", ondelete="CASCADE"), nullable=False)`) — CONFIRMED: `skills.id` is `postgresql.UUID(as_uuid=True)` (migration `0002_create_skills.py:31`, model `skill.py:38`), so `skill_id` MUST be the same UUID type, NOT `String(36)` — a `String(36)`↔`UUID` FK will fail at migrate.** The `ondelete="CASCADE"` handles skill-delete orphans for free at the DB level; `node_id` stays FK-less polymorphic; `node_id: Mapped[str]` (`String(36)`, no FK — polymorphic project/study); `node_type: Mapped[str]` (`String(16)`, `"project" | "study"`); `org_id: Mapped[str]` (`String(128)`); `attached_at: Mapped[datetime]` (default now UTC); `attached_by_user_id: Mapped[str]` (`String(128)`). `__table_args__`: `UniqueConstraint("skill_id", "node_id", "node_type", "org_id", name="uq_skill_attachment_skill_node_org")` + `Index("idx_skill_attachment_node", "node_id", "node_type", "org_id")` (the read path is "attachments for a node") + `Index("idx_skill_attachment_skill", "skill_id")`.
  - [x] 1.2 Register the model in `app/models/__init__.py` (the access_grant analysis confirms models are exported there; `SkillAttachment` must be imported so Alembic + metadata see it).
  - [x] 1.3 Add migration `app/db/migrations/versions/0017_skill_attachment.py` — **copy `0016_user_access_grants.py` verbatim as the template**. `revision = "0017_skill_attachment"`, `down_revision = "0016_user_access_grants"`. `op.create_table("skill_attachment", ...)` with the columns above. **`skill_id` as `sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False)`** (`from sqlalchemy.dialects import postgresql` — `skills.id` is `postgresql.UUID(as_uuid=True)` per `0002_create_skills.py:31`; a `String(36)` FK to a UUID PK will fail at migrate). `id` stays `sa.String(36)` (the attachment's own PK, matching `0016`'s `id`). `node_id` `sa.String(36)`, `node_type` `sa.String(16)`, `org_id` `sa.String(128)`, `attached_at` `sa.DateTime(timezone=True)`, `attached_by_user_id` `sa.String(128)`. `sa.PrimaryKeyConstraint("id")`; the UNIQUE + two indexes. `downgrade()` drops indexes then table (indexes on a table with an FK: dropping the table drops them, but mirror `0016`'s explicit `drop_index` calls for symmetry). [Source: 0002_create_skills.py:31, 0016_user_access_grants.py]

### Backend — Service (AC2, AC3, AC4, AC7)

- [x] **Task 2 — Attach / unattach / list-attachments service (AC2, AC3)**
  - [x] 2.1 Add attachment functions to `velara-api/app/services/skill_attachment_service.py` (new file; model it on `access_service.py`). Reuse the org-membership + path-resolution discipline from `access_service._resolve_node_hierarchy_path` (lines 80-140) — but scope `node_type` to `{"project", "study"}` only (attachments never target client/location). Define a local `_resolve_attach_node(session, node_id, node_type, org_id) -> str` returning the node's `hierarchy_path` (or reuse hierarchy_service's `get_project`/`get_study` which already walk FKs to verify org — **prefer reusing `hierarchy_service.get_project`/`get_study`** to avoid a second copy of the FK-walk; they raise `ProjectNotFoundError`/`StudyNotFoundError` (404) on wrong-org/missing).
  - [x] 2.2 `attach_skill(session, *, skill_id, node_id, node_type, org_id, attached_by_user_id, scope) -> SkillAttachment`. Validation order (mirror `create_grant`): (a) `node_type in {"project","study"}` else a `400 INVALID_NODE_TYPE`-style error; (b) load the skill (`skill_service.get_skill(session=..., skill_id=..., org_id=...)` — raises `SkillNotFoundError` (404) if missing/cross-org) and read its `scope`; (c) **attach-time scope guard (AC3):** if `skill.scope == "study"` and `node_type == "project"` → reject (`422`/`400`, code e.g. `SKILL_SCOPE_MISMATCH`, message "A study-scoped skill can only be attached to a study."); symmetric for `scope == "project"` onto a study; `scope is None` → allow both; (d) resolve/verify the node exists in org (Task 2.1); (e) idempotent upsert — query existing `(skill_id, node_id, node_type, org_id)`; return prior if present (mirror `create_grant` lines 259-270); else insert + commit + refresh + `logger.info("skill_attached", ...)`.
  - [x] 2.3 `unattach_skill(session, *, skill_id, node_id, node_type, org_id) -> None` — delete by the unique tuple scoped to org; **not-found → 404** (`SkillAttachmentNotFoundError`, mirror `AccessGrantNotFoundError`) so a cross-org / already-detached delete doesn't leak. Commit + `logger.info("skill_detached", ...)`.
  - [x] 2.4 `list_attachments_for_node(session, *, node_id, node_type, org_id) -> list[SkillAttachment]` — the internal read path (what skills are attached to this project/study). Filter on the `idx_skill_attachment_node` index. (Optionally join skills to return name for the UI, or the route resolves names — see Task 4.)
  - [x] 2.5 Define the service's exceptions inline mirroring `access_service` (all `VelaraHTTPException` subclasses with `ERROR_CODE` constants): `SkillAttachmentNotFoundError` (404), the scope-mismatch error, and reuse `InvalidNodeTypeError` if suitable (or a local one). **Do NOT** reuse the grant `InternalRoleNotGrantableError` — attachment has no role concept.

- [x] **Task 3 — Client-availability query (AC4) + node-delete cleanup (AC7)**
  - [x] 3.1 `list_client_skills(session, *, org_id, scope_paths, node_id=None, node_type=None) -> list[Skill]` in the attachment service (or `skill_service`). This is the **attachment ∩ grant ∩ visibility/lifecycle** query the client portal consumes. Build it as a join: `select(Skill).join(SkillAttachment, SkillAttachment.skill_id == Skill.id)` filtered by `Skill.org_id == org_id`, `Skill.visibility == "client_facing"`, `Skill.lifecycle_state == "client_ready"`, and the attachment's node being in the caller's grant scope. **Grant-scope mapping:** the client's `scope_paths` (ltree strings from 8.1 `resolve_scope_paths`) are node *paths*, but `SkillAttachment.node_id` is a node *id*. Resolve the granted nodes' ids by loading the projects/studies whose `hierarchy_path <@ ANY(CAST(:paths AS ltree[]))` (reuse the `hierarchy_service` ltree filter pattern — `list_projects`/`list_studies` lines ~307-310) and match `SkillAttachment.node_id IN (those ids)`. When `node_id`/`node_type` are supplied (a specific project/study view), additionally constrain to that node (after `assert_in_scope`). De-dup skills attached to multiple granted nodes. Empty scope → `[]` (never returns all).
  - [x] 3.2 **Node-delete cleanup (AC7):** in `hierarchy_service.delete_project` and `delete_study`, delete the node's `skill_attachment` rows BEFORE `_commit_delete(session, obj)` (the analysis confirms delete does NOT auto-clean related tables and the DB FK on `node_id` is absent — no cascade fires). Add a `delete_attachments_for_node(session, node_id, node_type, org_id)` helper in the attachment service and call it. (Skill-delete orphans are handled by the migration-level `ondelete="CASCADE"` on `skill_id` — Task 1.3 — so no skill-delete change is needed; confirm skills has a delete path and note it.)

### Backend — Routes (AC2, AC3)

- [x] **Task 4 — Attach / unattach / list routes on the hierarchy router**
  - [x] 4.1 Add routes to `velara-api/app/api/v1/hierarchy.py` (router `prefix="/api/v1"`, `tags=["hierarchy"]`, `dependencies=[RejectClient]` — it already owns `POST/GET/PATCH/DELETE /api/v1/projects/{project_id}` and the study equivalents, so the attach routes belong here). Add:
    - `POST /api/v1/projects/{project_id}/skills` — body `{skill_id}` (a `SkillAttachmentCreate` schema); 201 + `SkillAttachmentRead`. Gate with `_require_grantor(user.role)` (the consultant/ma_tech gate — **reuse the exact pattern from `access_grants.py` lines 26-41 / 55**; `_GRANTOR_ROLES = {"consultant","ma_tech"}` → 403). Depend on `CurrentUser`, `DbSession`, `HierarchyScope`; `scope.assert_in_scope(project.hierarchy_path)` before attaching (out-of-scope 403; the service's node resolution gives cross-org 404). Call `skill_attachment_service.attach_skill(...)` with `node_type="project"`.
    - `POST /api/v1/studies/{study_id}/skills` — study equivalent, `node_type="study"`.
    - `DELETE /api/v1/projects/{project_id}/skills/{skill_id}` and `DELETE /api/v1/studies/{study_id}/skills/{skill_id}` — 204; same gate + scope check; call `unattach_skill(...)`.
    - `GET /api/v1/projects/{project_id}/skills` and `GET /api/v1/studies/{study_id}/skills` — internal list of attached skills (for the assignment UI + the rewired `useProjectSkills`); returns attached skills with the fields the internal UI needs (id, name, description, runtime_type, visibility, lifecycle_state, scope — internal admin MAY see these, unlike the client surface). Scope-checked. Response `ResponseEnvelope[...]` with `PageMeta` if paginating (the attached set per node is small — pagination optional; if omitted, still wrap in the envelope, never a bare array — Enforcement Rule 1).
  - [x] 4.2 Add schemas to `velara-api/app/schemas/skill_attachment.py` (new): `SkillAttachmentCreate(skill_id: str)`; `SkillAttachmentRead(id, skill_id, node_id, node_type, org_id, attached_at, attached_by_user_id)` (mirror `AccessGrantRead`, `model_config = {"from_attributes": True}`); and an `AttachedSkillRead` (or reuse an internal skill read) for the `GET .../skills` list carrying id+name+description+runtime_type+visibility+lifecycle_state+scope. Register all in `test_openapi.py` schema lock.
  - [x] 4.3 Use the `_meta(request)` helper + `ResponseEnvelope`/`ResponseMeta` exactly as `access_grants.py` does. Map all failures through `VelaraHTTPException` (no raw messages — Enforcement Rule 5).

### Backend — Client skills endpoint wiring (AC4)

- [x] **Task 5 — Expose `list_client_skills` on the client router (AC4)**
  - [x] 5.1 Add `GET /api/v1/client/skills` to `velara-api/app/api/v1/client.py` (router `prefix="/api/v1/client"`, no `RejectClient` — client-accessible). Query params `project_id?`, `study_id?`, plus `page`/`per_page` (`PageMeta`). Depend on `CurrentUser`, `DbSession`, `HierarchyScope`. Call `list_client_skills(session, org_id=user.org_id, scope_paths=scope.scope_paths, node_id=..., node_type=...)`. When `project_id`/`study_id` supplied, `assert_in_scope` the node (cross-org 404, out-of-scope 403) before querying. Response uses a **client IP-safe schema** — reuse the `ClientSkillRead` discipline from `schemas/client.py` (independent `BaseModel`, **id + name + description + scope + location_dependent ONLY** — NO `visibility`/`lifecycle_state`/`org_id`/`author`/schemas; recursive no-internals). **Coordinate with 8.4:** 8.4's story (Task 1) also plans `GET /api/v1/client/skills` against the scope-heuristic — **8.6 builds the real attachment-backed version now**; 8.4 then builds the discovery *screens* + bucketing on top of this endpoint (update 8.4's Task 1 note — see Task 11). If `ClientSkillRead` doesn't exist yet (8.4 not built), create it here in `schemas/client.py` following the `ClientEngagement`/`ClientJobRead` pattern; 8.4 reuses it.
  - [x] 5.2 **AC5-equivalent visibility guarantee:** the query already filters `visibility == "client_facing" ∩ lifecycle_state == "client_ready"`, so `internal_only`/`paired`/non-client-ready skills are structurally excluded. Add a route comment: availability is now REAL attachments (not the scope-heuristic) — the deferred model from 8.4 has landed.

### Backend — Tests (AC1–AC4, AC7)

- [x] **Task 6 — BE integration + unit tests**
  - [x] 6.1 Migration test / model round-trip: assert the `skill_attachment` table + UNIQUE + indexes exist after migrate; insert + read back a row.
  - [x] 6.2 Attach/unattach (AC2): attach skill→project persists; re-attach is idempotent (one row); unattach removes it; unattach of a missing pair → 404. Gate: a `client`-role token → 404 (RejectClient on the hierarchy router); a non-grantor internal role (if any beyond consultant/ma_tech) or a client → 403/404 as appropriate. Cross-org node → 404; in-org out-of-scope → 403.
  - [x] 6.3 Scope guard (AC3): attaching a `scope="study"` skill to a project → rejected with the scope-mismatch code; `scope="project"` to a study → rejected; `scope=None` → allowed to both.
  - [x] 6.4 Client availability (AC4): seed a client-facing/client-ready skill + a grant on a project + an attachment on that project → `list_client_skills`/`GET /client/skills` returns it; an UNATTACHED client-ready skill of matching scope is now **absent** (proves the scope-heuristic is gone); an `internal_only` attached skill is absent; a skill attached to a NON-granted node is absent. Assert **zero internals** in the `GET /client/skills` body (recursive no-internals search — reuse the 8.2 pattern; assert absence of `visibility`/`lifecycle_state`/`org_id`/`author`).
  - [x] 6.5 Node-delete cleanup (AC7): attach a skill to a study, delete the study → its attachment rows are gone (query returns none); no orphan.
  - [x] 6.6 Add every new schema (`SkillAttachmentCreate`/`SkillAttachmentRead`/`AttachedSkillRead`/`ClientSkillRead` if new) to `test_openapi.py` schema lock.
  - [x] Co-locate in `tests/integration/api/` (attach/routes/client) + `tests/unit/services/` (service logic). Run with `docker compose exec -e AUTH_BACKEND=dev api pytest ...` (C1).

### Frontend — API client + hooks (AC5, AC6)

- [x] **Task 7 — `skillAttachments.ts` API client + TanStack hooks**
  - [x] 7.1 Add `velara-web/src/api/skillAttachments.ts` (model on `src/api/skills.ts`; shared `apiClient`; response-envelope `{data}` unwrap; snake→camel at the boundary). Functions: `listNodeSkills(nodeType, nodeId)` → `GET /api/v1/{nodeType}s/{nodeId}/skills`; `attachSkill(nodeType, nodeId, skillId)` → `POST`; `detachSkill(nodeType, nodeId, skillId)` → `DELETE`.
  - [x] 7.2 Add hooks in `velara-web/src/features/admin/hooks/` (or `features/engagements/hooks/`): `useNodeSkills(nodeType, nodeId)` (TanStack Query, key `['nodeSkills', nodeType, nodeId]`, `staleTime: 30_000`, `isLoading`/`isError`); `useAttachSkill()` + `useDetachSkill()` (`useMutation`, `onSuccess` → `invalidateQueries(['nodeSkills', nodeType, nodeId])` AND the project/study skills keys `useProjectSkills` reads — mirror the `useEngagements.ts` invalidate-on-success pattern, lines 48-62 / 106-117). **Optimistic attach** per UX (insert chip on mutate, roll back + toast on error); **detach is NOT optimistic** — it goes through a confirm dialog then mutates (UX EXPERIENCE.md: "Attach = fluid/optimistic; Detach = deliberate/confirm; never optimistic for destructive").

### Frontend — Assignment screen (AC5)

- [x] **Task 8 — Access Control assignment screen (fill the `Placeholder` + dead-stub)**
  - [x] 8.1 Replace the `access/*` `Placeholder` in `velara-web/src/routes/internal.tsx` (lines ~102-105, `<Placeholder title="Access Control">…`) with a real `AccessControl` feature screen under `features/admin/components/` (per `project-structure-boundaries.md` — `features/admin/`). Keep it under `RequireInternal`. Give the screen a page title via `usePageTitle('Access Control')` (title-isolation convention).
  - [x] 8.2 Port the **prototype layout** from `design/internal3.jsx` `AccessControl` (lines 245-354) to real React + V3 tokens: a **client selector** (the UX's net-new **scalable combobox** replacing the prototype's horizontal button row — see DESIGN.md Components + EXPERIENCE.md "Client selector": `role="combobox"`, type-to-filter by name/code, ↑/↓/Enter/Esc, paused clients selectable, persists last-selected per session); per-project **cards** (header + "Attach skill" button + project-level skill band); per-study **rows** (study name/code/status + per-study "Attach" + attached-skill chips). Data: clients from the existing engagements/hierarchy hooks; attached skills per node from `useNodeSkills('project'|'study', id)`.
  - [x] 8.3 **Attach side panel** (net-new behavior, DESIGN.md + EXPERIENCE.md): right-docked, opens from any Attach button, **stays open** after an attach (bulk attach across studies), cards visible behind a light scrim; header states the target ("to ONC-204 · Study · <project>"); a search input filtering a **client-ready-only** candidate list (`useSkills()` filtered to `lifecycle_state === 'client_ready'` — this is the guardrail-by-construction: internal-only skills are never offered); each row has an Attach button; already-attached rows are **disabled + "Attached ✓"** (the UNIQUE-constraint duplicate state made unreachable). Focus-trapped, Esc/✕/click-outside closes, focus returns to the invoking button.
  - [x] 8.4 **Skill chip + detach:** each attached chip shows the skill name (+ an "Outputs" marker for client-facing skills, per prototype line 305-307); hover/focus reveals a detach **✕** (neutral → `danger` on hover). ✕ → **detach confirm** `role="alertdialog"` ("Detach <skill> from <study>? Clients on this engagement will no longer see it." · [Cancel] [Detach], default focus Cancel) → on confirm calls `useDetachSkill`. **No undo** (the confirm is the friction).
  - [x] 8.5 States (EXPERIENCE.md State Patterns): loading (skeleton chips) / loaded / **empty per level** ("No skills attached to this project/study yet.") / error; attach-panel candidate list loading/empty ("No client-ready skills available to attach")/no-match/error. Use V3 tokens by name (teal `brand-*`, `ink`/`ink-2`, Poppins/Open Sans) — never hard-code hex; the amber **Invited** pill and the Users tab are **Epic 10, NOT this story** — do not build them here.

### Frontend — Rewire the mock seam (AC6)

- [x] **Task 9 — Rewire `useProjectSkills` + study consumer to real attachments**
  - [x] 9.1 `velara-web/src/features/run/hooks/useProjectSkills.ts` — replace the mock (which calls `useSkills()` and filters `scope==='project'`, **ignoring** `_projectId`) with a real query of attachments by `projectId`: call `listNodeSkills('project', projectId)` via a TanStack hook (key `['nodeSkills','project',projectId]`). **Remove** the "MOCK SEAM — backend skill-attachment is a later epic; swap this query when the attachment API lands" comment (lines 1-3). Keep the return shape `{ data: Skill[] | undefined, isLoading, error }` so consumers don't change signature. Handle `projectId === undefined` (no query / empty).
  - [x] 9.2 The study-level consumer: `EngagementsScreen` `StudyDetail` (line ~1012) currently calls `useProjectSkills(study.project_id)` to show "Available across all studies". With real attachments, a study should show **project-level attachments (the project it belongs to) + its own study-level attachments**. Add a `useStudySkills(studyId)` (queries `listNodeSkills('study', studyId)`) and, in StudyDetail, render project attachments (via `useProjectSkills(study.project_id)`) as "Available across all studies" AND study attachments (`useStudySkills(study.id)`) as "Study-specific" — matching INV-09 (project skills visible from project AND each study) and the existing section structure (`EngagementsScreen.tsx:1049-1084`). Do not change the internal chip set (`RuntimeTypeChip`/`SkillLifecycleBadge` stay — this is the internal screen).
  - [x] 9.3 `RunConsole.tsx` also imports `useProjectSkills` (line 15) — since the hook keeps its signature/return shape, RunConsole works unchanged; **verify** its skill list now reflects attachments (a run-context project shows attached skills). No RunConsole refactor beyond confirming behavior.

### Frontend — Tests (AC5, AC6)

- [x] **Task 10 — FE tests** *(co-located `*.test.tsx`, vitest)*
  - [x] 10.1 `AccessControl` screen test: client selector filters by typed query; selecting a client scopes the cards; an Attach button opens the side panel; the panel lists **only client-ready** skills (assert an internal-only/draft skill is absent); attaching inserts a chip and the panel stays open; already-attached rows are disabled. Mock `useNodeSkills`/`useSkills`/`useAttachSkill`.
  - [x] 10.2 Detach test: hovering/focusing a chip reveals ✕; clicking ✕ opens the confirm alertdialog (default focus Cancel); confirming calls `useDetachSkill` and removes the chip; cancel does nothing.
  - [x] 10.3 `useProjectSkills` rewire test: given attachments for a project, the hook returns attachment-driven skills (NOT the old `scope==='project'` global filter) — assert it queries by `projectId` (a different project returns a different set, proving `projectId` is no longer ignored).
  - [x] 10.4 `EngagementsScreen` StudyDetail: renders "Available across all studies" (project attachments) + "Study-specific" (study attachments) sections from the new hooks.

### Cross-story handoff

- [x] **Task 11 — Update the 8.4 dependency note (documentation, no code)**
  - [x] 11.1 8.4 (`stories/8-4-…md`, `ready-for-dev`) Task 1.4/1.5 describe the client skills query as the **scope-heuristic** with the attachment model "deferred". Since 8.6 now lands the attachment model AND `GET /api/v1/client/skills` (attachment-backed), add a note to the 8.4 story Dev Agent Record / Task 1: **"8.6 landed the real attachment-backed `GET /api/v1/client/skills` + `ClientSkillRead`; 8.4 builds the discovery screens + project/study bucketing on top of the 8.6 endpoint — do NOT rebuild the scope-heuristic."** Do not rewrite 8.4's ACs; just prevent double-building the contract (correct-course §3 rationale). If 8.4 is picked up before 8.6 merges, this note is the coordination point.

---

## Dev Notes

### What this story is (Epic 8, added via 2026-07-01 correct-course; sequenced BEFORE 8.4)

8.6 replaces the **scope-heuristic** (org skills of a matching `scope`, the same value the internal `useProjectSkills` mock filters on while ignoring the project id) with a **real, admin-controlled attachment model**. It delivers: (1) a polymorphic `skill_attachment` table mirroring `user_access_grants`; (2) attach/unattach/list service + routes (consultant/ma_tech gated, scope-checked); (3) the attachment-aware **client-availability query** (`attached ∩ granted ∩ client_facing/client_ready`) exposed as `GET /api/v1/client/skills` so 8.4 consumes real attachments; (4) the internal **Access Control assignment UI** (fills the `Placeholder` + the prototype's dead-stub attach buttons); (5) the **`useProjectSkills` rewire** to real attachments. Governing FR: **ACL-09**. Architect ADR present.

**Product decision (2026-07-01):** 8.6 builds the attachment-aware client query too (the fullest ADR delivery) — 8.4 then builds discovery screens/bucketing on top. This avoids building the client-skills contract twice (correct-course §3).

### The architect ADR (authoritative — read it)

[Source: architecture/core-architectural-decisions.md#skill-attachment-model-explicit-skillengagement-attachment-added-2026-07-01-story-86]

- **One polymorphic `skill_attachment` table**, mirroring `user_access_grants` 1:1 (chosen over two typed `project_skill`/`study_skill` tables on Rule-of-Three / boring-technology grounds — the grant table already proved the pattern; one migration, one service, one route family, one test suite; no live data exists so zero migration cost).
- **Availability rule:** `client sees a skill ⇔ attached to a granted node (8.1) ∩ visibility == client_facing ∩ lifecycle_state == client_ready`.
- **`skill.scope` demoted to an authoring/UX hint** — its one executable role is the **attach-time validation guard** (Task 2.2c / AC3): `scope=="study"` → study-only, `scope=="project"` → project-only, `scope==null` → either (default: allow both).
- **Polymorphic-integrity duties in the service layer, NOT the DB** (node_id has no FK): attach-time verify node exists / in org / type matches / in scope; node-delete-time clean up attachment rows (no cascade fires — Task 3.2 / AC7). Detach is a plain row delete.
- **Skills stay org-global** — attachment is a join, not ownership; no `hierarchy_path` on skills; cert/versioning/S3-IP unchanged.

### Backend — current state of files this story touches (VERIFIED via source analysis)

| File | State | Current / change |
|------|-------|------------------|
| `app/models/access_grant.py` | **TEMPLATE (read-only)** | The exact model to mirror. `String(36)` id (uuid lambda default), `String(128)` user/org ids, `String(36)` node_id + `String(16)` node_type (no FK, polymorphic), `DateTime(timezone=True)` default now UTC, `UniqueConstraint(user_id,node_id,node_type,org_id)` + 2 indexes, `Mapped[]` style, `from app.models.base import Base`, NO relationships. [access_grant.py:28-64] |
| `app/models/skill_attachment.py` | **NEW** | Mirror access_grant. `skill_id`+`node_id`+`node_type`+`org_id`+`attached_at`+`attached_by_user_id`; `UNIQUE(skill_id,node_id,node_type,org_id)`. |
| `app/models/__init__.py` | UPDATE | Register `SkillAttachment` (models are exported here; Alembic/metadata need it). |
| `app/db/migrations/versions/0016_user_access_grants.py` | **TEMPLATE (read-only)** | Copy verbatim. `revision="0016_user_access_grants"`, table create + UNIQUE + 2 indexes + downgrade drops. [0016:18-54] |
| `app/db/migrations/versions/0017_skill_attachment.py` | **NEW** | `revision="0017_skill_attachment"`, `down_revision="0016_user_access_grants"`. `skill_id` gets `sa.ForeignKey("skills.id", ondelete="CASCADE")` (skills is a real table). **Verify `skills.id` SQL type first** (skill.py model id is `Mapped[uuid.UUID]` → likely `postgresql.UUID`; the FK column must match — do NOT blindly use `String(36)`). |
| `app/models/skill.py` | READ-ONLY ref | `__tablename__="skills"`, `id: Mapped[uuid.UUID]` (`UUID(as_uuid=True)` PK), `org_id: String(128)`, `scope: String(16) nullable` (`project`/`study`/null), `visibility: String(24)` (`internal_only`/`paired`/`client_facing`), `lifecycle_state: String(24)` (`draft`/`internal_ready`/`client_ready`/`retired`), `location_dependent: Boolean`. Skills are org-global, NOT ltree-pathed (skill.py:3). [skill.py:36-153] |
| `app/services/access_service.py` | **TEMPLATE (read-only)** | Mirror `create_grant` (validation order → idempotent upsert → commit/refresh/log, :230-294), `revoke_grant` (:297-314, 404 on cross-org), `list_grants`, `_resolve_node_hierarchy_path` (org-membership FK walk, :80-140), exception classes (`AccessGrantNotFoundError`/`InvalidNodeTypeError`/`NodeNotFoundError`, all `VelaraHTTPException` with `ERROR_CODE`). Constant `_VALID_NODE_TYPES` (:25). |
| `app/services/skill_attachment_service.py` | **NEW** | `attach_skill`/`unattach_skill`/`list_attachments_for_node`/`list_client_skills`/`delete_attachments_for_node`. Reuse `skill_service.get_skill` (:374-398, raises 404 on missing/cross-org) + `hierarchy_service.get_project`/`get_study` (FK-walk org verify) rather than re-copying the walk. |
| `app/services/skill_service.py` | READ-ONLY ref (reuse) | `get_skill(*, session, skill_id, org_id, for_update=False)` (:374-398) raises `SkillNotFoundError` on missing/cross-org. `list_skills` (:401-458) builds a `filters` list + `.where(*filters)` + `PageMeta` — the pattern if you add an attachment-join filter here instead of a separate service fn. |
| `app/services/hierarchy_service.py` | UPDATE (delete cleanup) + reuse | `get_project`/`get_study` walk FKs to verify org (404 on wrong-org, :280-293 / :377-392). `list_projects`/`list_studies` apply `hierarchy_path <@ ANY(CAST(:paths AS ltree[]))` with `.bindparams(paths=scope_paths)` (:307-310 / :405-408) — reuse for the client-availability grant→node-id resolution. `delete_project`/`delete_study` (:334-346 / :432-444) call `_commit_delete` and do NOT clean related tables — **add attachment cleanup before `_commit_delete`** (AC7). |
| `app/api/v1/hierarchy.py` | UPDATE | Router `prefix="/api/v1"`, `tags=["hierarchy"]`, `dependencies=[RejectClient]`. Already owns `/projects/{id}` + `/studies/{id}` CRUD. **Add** the attach/unattach/list routes here. |
| `app/api/v1/access_grants.py` | **TEMPLATE (read-only)** | The gate + envelope pattern to copy: `_GRANTOR_ROLES={"consultant","ma_tech"}` + `_require_grantor(user.role)`→403 (:26-41,55); `_meta(request)` helper (:29-33); `ResponseEnvelope[...]`+201/204; `RejectClient` on the router. [access_grants.py:24-83] |
| `app/api/v1/client.py` | UPDATE | Client router `prefix="/api/v1/client"` (NO `RejectClient`). Existing: `GET /engagements` (:57, uses `HierarchyScope`+`scope_paths`), `POST /invocations/{skill_id}` (:154), `GET /jobs/{job_id}` (:190, `assert_in_scope` :216). **Add** `GET /skills` (attachment-backed, `ClientSkillRead`). `GET /client/skills` does NOT exist yet (8.4 not built). |
| `app/schemas/access_grant.py` | **TEMPLATE (read-only)** | `AccessGrantCreate` + `AccessGrantRead(model_config={"from_attributes":True})` — mirror for `SkillAttachmentCreate`/`SkillAttachmentRead`. `NodeType = Literal[...]` alias pattern. |
| `app/schemas/skill_attachment.py` | **NEW** | `SkillAttachmentCreate(skill_id)`, `SkillAttachmentRead(...)`, `AttachedSkillRead(...)` (internal). |
| `app/schemas/client.py` | UPDATE (if 8.4 not built) | `ClientEngagement`/`ClientJobRead` = the independent-BaseModel id+name discipline. Add `ClientSkillRead` (id+name+description+scope+location_dependent ONLY) if it doesn't exist; 8.4 reuses it. |
| `app/schemas/skill.py` | READ-ONLY ref | `SkillRead` (:222-256) LEAKS `visibility`/`lifecycle_state`/`scope`/`org_id`/`author`/`created_by_user_id`/schemas/`paired_with`/`derived_from`. **Never** return it to clients — that's why `ClientSkillRead` exists. Internal `AttachedSkillRead` MAY carry visibility/lifecycle (internal admin). |
| `app/core/dependencies.py` | READ-ONLY ref | `_INTERNAL_ROLES={"ma_tech","consultant"}` (:106); `RejectClient` = `Depends(reject_client)` → 404 for non-internal (:170-193); `HierarchyScope` = `Annotated[HierarchyScopeValue, Depends(_hierarchy_scope)]` (internal→`unrestricted=True`, client→`scope_paths` from grants, :147-167); `CurrentUser`/`DbSession` aliases. |
| `tests/integration/api/` + `tests/unit/services/` | UPDATE/NEW | Co-locate attach/route/client tests + service unit tests. Run `docker compose exec -e AUTH_BACKEND=dev api pytest ...`. |
| `tests/integration/api/test_openapi.py` | UPDATE | Add new schemas to the schema lock. |

### Frontend — current state of files this story touches (VERIFIED via source analysis)

| File | State | Current / change |
|------|-------|------------------|
| `src/features/run/hooks/useProjectSkills.ts` | UPDATE (the swap point) | The MOCK: `useProjectSkills(_projectId)` **ignores** `_projectId`, calls `useSkills()`, filters `s.scope === 'project'`. Comment "MOCK SEAM — backend skill-attachment is a later epic; swap this query when the attachment API lands" (:1-3). **Rewire** to `listNodeSkills('project', projectId)`; remove the comment; keep return shape. Consumers: `EngagementsScreen` ProjectDetail (:923), StudyDetail (:1012), `RunConsole` (:15). No `useStudySkills` exists today. |
| `src/features/engagements/components/EngagementsScreen.tsx` | UPDATE | Project skills section (:960-994): name + `RuntimeTypeChip` + `SkillLifecycleBadge` + Run button; empty "No skills attached to this project." Study section (:1049-1084): "Available across all studies" subtitle + same rows. Uses `useProjectSkills` (:10,923,1012). **Add** the Study-specific section via `useStudySkills` (Task 9.2). Chips stay (internal screen). |
| `src/routes/internal.tsx` | UPDATE | `access/*` → `<Placeholder title="Access Control">Access Control — Story 7.x</Placeholder>` (:102-105). Nav tab `access` "Access Control" exists (`navTabsData.ts`). **Replace** the Placeholder with the real assignment screen under `RequireInternal` (:122). |
| `src/features/admin/components/AccessControl.tsx` | **NEW** | The assignment screen (Task 8). `features/admin/` is the ACL home per project-structure-boundaries.md. |
| `src/features/admin/hooks/` | **NEW** | `useNodeSkills`/`useAttachSkill`/`useDetachSkill`/`useStudySkills`. |
| `src/api/skillAttachments.ts` | **NEW** | `listNodeSkills`/`attachSkill`/`detachSkill` (model on `src/api/skills.ts` — shared `apiClient`, `{data}` envelope unwrap, snake→camel). |
| `src/api/skills.ts` | **TEMPLATE (read-only)** | The API-client pattern to copy (shared `apiClient`, response-envelope, camelCase types). |
| `src/features/engagements/hooks/useEngagements.ts` | **TEMPLATE (read-only)** | Mutation pattern: `useMutation` + `onSuccess`→`invalidateQueries` (:48-62); delete + `removeQueries` (:106-117). Model attach/detach on this (add optimistic for attach only). |
| `src/features/skills/hooks/useSkills.ts` | READ-ONLY ref (reuse) | `useSkills()` powers the attach-panel candidate list — filter to `lifecycle_state === 'client_ready'` for the guardrail. |
| `src/features/skills/types.ts` | READ-ONLY ref | `Skill` (:24-45) carries internals (`org_id`/`created_by_user_id`/schemas/`paired_with`/`derived_from`). Internal admin screen MAY use runtime_type/visibility/lifecycle_state; do NOT leak schemas/lineage into any client-adjacent copy. |
| `src/features/run/components/RunConsole.tsx` | READ-ONLY ref (verify) | Imports `useProjectSkills` (:15). Signature-preserving rewire ⇒ works unchanged; just verify it now shows attachments. |
| `src/routes/client.tsx` + `features/client-portal/**` | 8.4 territory | The client discovery screens are 8.4. 8.6 only provides the endpoint/service they consume. Do NOT build client screens here. |
| `design/internal3.jsx` | READ-ONLY ref (port) | `AccessControl` (:245-354): client-selector button row (:260-271 — replace with the scalable combobox), project cards (:278-311), study rows (:314-347), the **dead-stub attach buttons** `onClick={()=>{}}` (:289 project, :327 study) — the exact handlers 8.6 wires. `DATA.skillsAt(type,id)`/`skillAssignments` (data.js:294-326) = the entityType/entityId/skillId shape the real model mirrors. |
| `_bmad-output/.../ux-designs/ux-Velara-2026-07-01/{DESIGN,EXPERIENCE}.md` + `mockups/admin-surfaces-mock.html` | READ-ONLY ref (authoritative UX) | The attach/detach interaction spine. Side panel (right-dock, stay-open, client-ready-only, "Attached ✓"), detach confirm alertdialog, scalable client selector combobox, per-level empty states, guardrail-by-construction. The **spines win on any mock conflict**. Users tab + Invited pill + provisioning stepper are **Epic 10, not 8.6**. |

### Critical constraints (read before coding)

- **C1 — BE test auth backend.** `.env` runs `AUTH_BACKEND=cognito`; `DevAuthProvider` HS256 tokens are rejected by Cognito RS256. Run integration tests with `docker compose exec -e AUTH_BACKEND=dev api pytest tests/...`. Postgres+MinIO+Redis must be up. [8.2/8.3/8.4 learning]
- **C2 — Mirror the grant model exactly; do not invent a new shape.** The ADR mandates a 1:1 mirror of `user_access_grants`. Copy `access_grant.py` + `0016` migration + `access_service.py` patterns; the only deltas are `skill_id` (with a real FK to `skills`), `node_type` narrowed to `{project,study}`, and `attached_*` naming. Rule-of-Three: this is the second use of the polymorphic-node pattern — reuse, don't fork.
- **C3 — Attach-time is the ONLY place `scope` is executable.** Do NOT re-check `scope` at read/availability time (the ADR explicitly rejects "attached AND scope matches" as redundant). Availability = attachment ∩ grant ∩ visibility/lifecycle, full stop.
- **C4 — Polymorphic integrity lives in the service, not the DB.** `node_id` has no FK. Verify node existence/org/type at attach time; clean up rows at node-delete time (AC7). The DB won't do it for you. (The `skill_id` FK with `ondelete="CASCADE"` DOES handle skill-delete orphans — that one is DB-level.)
- **C5 — IP-safe client surface (AC4).** `GET /api/v1/client/skills` returns `ClientSkillRead` (id+name+description+scope+location_dependent ONLY) — recursive no-internals test (reuse 8.2's assertion). The internal `GET /projects/{id}/skills` MAY carry visibility/lifecycle (internal admin). Two schemas, two surfaces — the discipline that let 8.2/8.3 pass "zero internals".
- **C6 — Scope + role gate on every attach route.** Attach/unattach are on the `RejectClient` hierarchy router (client tokens → 404) AND `_require_grantor` gated (non-consultant/ma_tech → 403) AND `assert_in_scope` the target node (out-of-scope same-org → 403; cross-org/missing → 404). Three layers, matching the grant routes.
- **C7 — This UNBLOCKS 8.4; coordinate, don't collide.** 8.6 lands `GET /api/v1/client/skills` + `ClientSkillRead`. 8.4 builds the client discovery *screens* + bucketing on top. Add the Task-11 note to 8.4 so neither rebuilds the contract. If schema names collide, 8.6's win (it ships first).
- **C8 — No Users tab / provisioning here.** The UX DESIGN/EXPERIENCE cover BOTH 8.6 (attach/detach) and Epic 10 (Users/provisioning). Build ONLY the attach/detach surface. The amber Invited pill, Add-user flow, and 3-step stepper are Epic 10.

### Architecture compliance (hard rules — All Agents MUST)

[Source: architecture/implementation-patterns-consistency-rules.md#enforcement-rules-all-agents-must]

1. **Response envelope** on all new routes (`{data, meta}`) — never a bare array/object; `PageMeta` if the list paginates.
2. **`hierarchy_scope` on hierarchical routes** — attach/unattach/list + client skills depend on `HierarchyScope` and `assert_in_scope` the target node.
3. **snake_case API / camelCase TS** — map at the FE boundary (as `skills.ts`/`clientPortal.ts` do).
4. **`request_id`** via `ResponseMeta` (the `_meta(request)` helper).
5. **No raw exception messages** — all failures through `VelaraHTTPException` / global handler.
6. **Co-locate tests**; **TanStack Query** `isLoading`/`isError`, `staleTime: 30_000` for lists; **optimistic updates ONLY for low-stakes** (attach yes; detach no — it confirms; create/grant never).
7. Stable enums: visibility `internal_only|paired|client_facing`; lifecycle `draft|internal_ready|client_ready|retired`; node_type here `project|study`. DB naming: table `skill_attachment`, columns snake_case, indexes `idx_skill_attachment_*`, FK `{singular}_id`. [Source: consistency rules Naming Patterns]

### Library / framework versions (pinned — no new deps)

React 19, react-router-dom 7, @tanstack/react-query 5, zustand 5, tailwindcss 4, vite 6, vitest 2, @testing-library/react 16. Backend: FastAPI + async SQLAlchemy 2.0 (`Mapped[]`) + Pydantic v2 (`model_config`/`from_attributes`), Postgres `ltree` (`<@` containment via `text().bindparams`), Alembic, Celery. No new dependency is required — this is a table + service + routes + a screen, all with existing patterns. [Source: package.json; 8.1-8.4 stories]

### Previous-story intelligence (apply)

- **8.1 (RBAC, done):** `UserAccessGrant` + `resolve_scope_paths` + `HierarchyScope` (`scope_paths`/`unrestricted`/`assert_in_scope`) — the model + scope machinery 8.6 reuses. `create_grant` idempotent-upsert + `_resolve_node_hierarchy_path` org-walk = the exact template. Internal roles bypass scope; `assert_in_scope`: out-of-scope same-org → 403, cross-org → 404. The polymorphic-node-without-FK pattern (proven here) is what the ADR says to reuse.
- **8.2 (IP client surface, done):** IP-safe = independent BaseModel + recursive no-internals test; `RejectClient` 404s client tokens off internal routers. The `ClientSkillRead` (AC4) follows this discipline.
- **8.3 (client shell, done):** `GET /api/v1/client/engagements` returns clients+projects via `HierarchyScope.scope_paths` — the client-scoped read pattern the new `GET /client/skills` mirrors.
- **8.4 (ready-for-dev, NOT built):** defines the client discovery screens + a scope-heuristic `GET /client/skills`. 8.6 supersedes the heuristic with real attachments and ships the endpoint first (per product decision). Task 11 keeps them from colliding. 8.4's D1 invocation-widening is unrelated to 8.6.

### Git intelligence

History is squashed (initial import + `updates`/`UX updates` commits), so per-file diffs aren't informative; the verified file-state tables above (from a fresh source analysis 2026-07-01) + the 8.1-8.4 Dev Agent Records are authoritative. 8.1/8.2/8.3 are `done`; 8.4 is `ready-for-dev`; latest migration is `0016`.

### Scope boundaries (do NOT do these)

- **Two typed tables** (`project_skill` + `study_skill`) — the ADR chose ONE polymorphic `skill_attachment`. Do not fork.
- **Re-checking `scope` at read time** — it's an attach-time guard only (C3).
- **The client discovery SCREENS / bucketing / run flow** — that's 8.4. 8.6 provides only the endpoint/service.
- **The Users tab, Add-user/provisioning flow, Invited pill, 3-step stepper** — Epic 10 (C8).
- **A `role` or permission-tier concept on attachments** — attachment is a plain join; no role column (unlike grants).
- **Attaching at Client or Location level** — `node_type` is `{project, study}` only (the ADR's revisit-trigger covers widening later).
- **Moving skills into the ltree hierarchy / giving them a `hierarchy_path`** — skills stay org-global registry entries; attachment is a join, not ownership.

### Project Structure Notes

New BE: `models/skill_attachment.py`, `schemas/skill_attachment.py`, `services/skill_attachment_service.py`, migration `0017_skill_attachment.py`; routes added in place on `api/v1/hierarchy.py` + `api/v1/client.py`; `client.py`/`schemas/client.py` gain the client skills read; `hierarchy_service` delete fns gain cleanup. New FE: `features/admin/{components/AccessControl.tsx, hooks/}`, `api/skillAttachments.ts`; `routes/internal.tsx` swaps the Placeholder; `features/run/hooks/useProjectSkills.ts` rewired; `EngagementsScreen` gains the study section. Tests co-located (BE `tests/integration/api/` + `tests/unit/services/`; FE `*.test.tsx`). No structural variance from `architecture/project-structure-boundaries.md` (`features/admin/` is the designated ACL home; attach routes live with the project/study routes they extend).

### References

- [Source: epics/epic-8-access-control-client-portal.md#story-8.6] — the 5 epic ACs (authoritative anchor; expanded to 7 here for the client-query + node-delete duties the ADR mandates).
- [Source: architecture/core-architectural-decisions.md#skill-attachment-model-…-2026-07-01-story-86] — one polymorphic table; availability rule; scope demotion; service-layer integrity; skills stay org-global; revisit triggers.
- [Source: planning-artifacts/sprint-change-proposal-2026-07-01.md] — why 8.6 exists (scope gap (c)), sequencing (8.6 before 8.4), ACL-09.
- [Source: architecture/implementation-patterns-consistency-rules.md] — envelope, hierarchy_scope, snake/camel, PageMeta, enums, naming, co-located tests, TanStack loading/optimistic rules.
- [Source: ux-designs/ux-Velara-2026-07-01/DESIGN.md + EXPERIENCE.md + mockups/admin-surfaces-mock.html] — assignment cards, scalable client selector combobox, right-dock stay-open attach panel (client-ready-only), detach confirm alertdialog, per-level empty states, guardrail-by-construction, accessibility floor. Users/provisioning = Epic 10.
- [Source: velara-api/app/models/access_grant.py, app/db/migrations/versions/0016_user_access_grants.py, app/services/access_service.py, app/api/v1/access_grants.py, app/schemas/access_grant.py] — the mirror templates (model/migration/service/route/schema).
- [Source: velara-api/app/models/skill.py, app/services/{skill_service,hierarchy_service}.py, app/api/v1/{hierarchy,client}.py, app/core/dependencies.py, app/schemas/{skill,client}.py] — reuse targets + current state.
- [Source: velara-web/src/features/run/hooks/useProjectSkills.ts, src/features/engagements/components/EngagementsScreen.tsx, src/features/engagements/hooks/useEngagements.ts, src/routes/internal.tsx, src/api/skills.ts, src/features/skills/types.ts] — the swap seam, the screen to fill, the API/mutation templates.
- [Source: design/internal3.jsx (AccessControl :245-354, dead-stub attach :289/:327), design/data.js (skillAssignments :294-326)] — the prototype layout + the exact stubs to wire.
- [Source: stories/8-1…md, 8-2…md, 8-3…md, 8-4…md] — grant model, IP-safe discipline, client shell, client discovery (the 8.4 contract 8.6 unblocks).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-07-01)

### Debug Log References

- **Docker disk full (Task 6):** After multiple test runs, `docker compose exec ... pytest` stalled with `No space left on device` from the PostgreSQL container. Fixed with `docker system prune -f` (reclaimed 44.6 GB). All 17 BE integration tests passed after the prune.
- **`Project.org_id` AttributeError in `list_client_skills` (Task 3):** `Project` model has no `org_id` column — org is resolved via `client_id→Client→org_id`. Fixed by removing the erroneous `Project.org_id == org_id` filter and relying on ltree containment (`projects.hierarchy_path <@ ANY(CAST(:paths AS ltree[]))`) with explicit table-name qualifiers in `text()`.
- **`ClientSkillRead.id: str` vs `Skill.id: uuid.UUID` Pydantic mismatch (Task 5):** `Skill.id` is `postgresql.UUID(as_uuid=True)` so Pydantic's `from_attributes` read `uuid.UUID` objects. Changed `ClientSkillRead.id: str` to `ClientSkillRead.id: uuid.UUID`.
- **Combobox `closeOnOutside` bug (Task 8/10):** The `ul` listbox is a SIBLING of `div[role="combobox"]`, not inside it. `inputRef.current.parentElement` was `div[role="combobox"]` which does NOT contain the `ul` listbox. When clicking a list option, `mousedown` fired and `closeOnOutside` saw the `li` as OUTSIDE, closing the dropdown before the click handler ran (9 failing tests). Fixed by adding `containerRef = useRef<HTMLDivElement>(null)` on the outer `div.relative` (which contains BOTH the combobox div AND the ul sibling) and checking `containerRef.current.contains(e.target)`.
- **TypeScript unused parameter (Task 10):** `nodeType` parameter declared but unused in `listNodeSkills.mockImplementation((nodeType, nodeId) => ...)`. Fixed by renaming to `_nodeType`.

### Completion Notes List

- All 7 ACs satisfied and all 11 tasks checked.
- **AC1:** `skill_attachment` table created via migration `0017_skill_attachment.py` (`down_revision="0016_user_access_grants"`). `skill_id` is `postgresql.UUID(as_uuid=True)` with FK `ondelete="CASCADE"`. UNIQUE(skill_id, node_id, node_type, org_id) + 2 indexes.
- **AC2/AC3:** `attach_skill`/`unattach_skill` service functions implement idempotent upsert + attach-time scope guard. Routes on `hierarchy.py` with `RejectClient` + `_require_grantor` (consultant/ma_tech) + `assert_in_scope`. Re-attach returns existing row (no duplicate).
- **AC4:** `list_client_skills` resolves granted project/study IDs via ltree `<@ ANY(CAST(:paths AS ltree[]))` then joins `SkillAttachment` → `Skill` filtered by `client_facing` + `client_ready`. `GET /api/v1/client/skills` returns `ClientSkillRead` (id/name/description/scope/location_dependent only — zero internals).
- **AC5:** `AccessControl` screen replaces the `access/*` Placeholder. Client selector combobox (role="combobox", type-to-filter, ↑/↓/Enter/Esc, `containerRef` fix for outside-click). Per-project cards with study rows. Right-docked `AttachPanel` (client-ready-only, stays open after attach). `AttachedSkillChip` with hover-revealed detach ✕ → `DetachDialog` (`role="alertdialog"`, default focus Cancel, no undo).
- **AC6:** `useProjectSkills` rewired from mock (ignores projectId, filters global skills by scope) to real `listNodeSkills('project', projectId)`. Mock comment removed. `useStudySkills` added. `EngagementsScreen` StudyDetail now shows both "Available across all studies" (project attachments) and "Study-specific" (study attachments) sections.
- **AC7:** `hierarchy_service.delete_project` and `delete_study` now call `delete_attachments_for_node(session, node_id, node_type, org_id)` before `_commit_delete`. No orphaned attachments remain after node deletion.
- **Tests:** 17 BE integration tests pass (`tests/integration/api/test_skill_attachments.py`). 349 FE tests pass (331 pre-existing + 13 AccessControl + 5 useProjectSkills). TypeScript compiles clean.
- **Task 11:** `stories/8-4-…md` Dev Agent Record updated with 8.6 handoff note (do NOT rebuild scope-heuristic; endpoint + ClientSkillRead exist in `velara-api/app/api/v1/client.py` and `velara-api/app/schemas/client.py`).

### File List

**Backend (new/modified):**
- `velara-api/app/models/skill_attachment.py` — NEW: `SkillAttachment` ORM model
- `velara-api/app/models/__init__.py` — MODIFIED: exports `SkillAttachment`
- `velara-api/app/db/migrations/versions/0017_skill_attachment.py` — NEW: migration 0017
- `velara-api/app/services/skill_attachment_service.py` — NEW: `attach_skill`, `unattach_skill`, `list_attachments_for_node`, `list_client_skills`, `delete_attachments_for_node`
- `velara-api/app/schemas/skill_attachment.py` — NEW: `SkillAttachmentCreate`, `SkillAttachmentRead`, `AttachedSkillRead`
- `velara-api/app/schemas/client.py` — MODIFIED: added `ClientSkillRead`
- `velara-api/app/api/v1/hierarchy.py` — MODIFIED: 6 new routes (POST/DELETE/GET for projects/{id}/skills and studies/{id}/skills), `_GRANTOR_ROLES`, `_require_grantor`
- `velara-api/app/api/v1/client.py` — MODIFIED: added `GET /api/v1/client/skills`
- `velara-api/app/services/hierarchy_service.py` — MODIFIED: `delete_project` and `delete_study` call `delete_attachments_for_node`
- `velara-api/tests/integration/api/test_skill_attachments.py` — NEW: 17 tests (AC1–AC4, AC7)
- `velara-api/tests/integration/api/test_openapi.py` — MODIFIED: schema lock entries for new schemas

**Frontend (new/modified):**
- `velara-web/src/api/skillAttachments.ts` — NEW: `listNodeSkills`, `attachSkill`, `detachSkill`
- `velara-web/src/features/admin/hooks/useNodeSkills.ts` — NEW: `useNodeSkills`, `useAttachSkill`, `useDetachSkill`
- `velara-web/src/features/admin/components/AccessControl.tsx` — NEW: full assignment screen
- `velara-web/src/features/admin/components/AccessControl.test.tsx` — NEW: 13 tests
- `velara-web/src/routes/internal.tsx` — MODIFIED: `access/*` Placeholder → `<AccessControl />`
- `velara-web/src/features/run/hooks/useProjectSkills.ts` — MODIFIED: rewired to real attachments, mock comment removed, `useStudySkills` added
- `velara-web/src/features/run/hooks/useProjectSkills.test.tsx` — NEW: 5 tests
- `velara-web/src/features/engagements/components/EngagementsScreen.tsx` — MODIFIED: `useStudySkills` import + "Study-specific skills" Card section in StudyDetail
- `velara-web/src/features/run/components/RunConsole.tsx` — MODIFIED: `AttachedSkill` type import (compatible shape)

**Documentation:**
- `_bmad-output/implementation-artifacts/stories/8-4-client-portal-skill-discovery-and-invocation.md` — MODIFIED: 8.6 handoff note in Dev Agent Record

### Change Log

- 2026-07-01: Story 8.6 implemented end-to-end. Polymorphic `skill_attachment` table (migration 0017) + service + 6 hierarchy routes + `GET /api/v1/client/skills` + AccessControl assignment UI + `useProjectSkills` rewire. All 7 ACs satisfied. 17 BE + 18 FE tests added. Scope-heuristic fully replaced by real attachment model.
- 2026-07-01: Code review (3-layer adversarial). Fixed a shipped BLOCKER — `AttachedSkillRead.id: str` 500'd the internal list routes (and the whole AccessControl UI) on any attached node — plus 12 more patches (study-run picker union, attach/detach error surfacing, real optimistic attach, model FK, list-route JOIN vs N+1/concurrent-404, node_type enum, combobox scroll/bounds, AttachPanel focus trap, DetachDialog Esc). Added 5 BE tests (incl. the internal-list-with-attachment regression guard that would have caught the 500) + OpenAPI field-shape lock. Verified: 34 BE tests pass on a freshly-migrated `velara_test` (image rebuilt), 349 FE vitest pass, tsc + eslint clean. Status → done. Two follow-ups tracked (NOT blockers): (1) deferred concurrent-duplicate-attach 500 (cross-cutting w/ create_grant); (2) product scope-change — Engagements-screen attach + new `admin` role / consultant-demotion → routed to correct-course + architect ADR. Also corrected 8.6's Dev-Notes claim: the 3 `test_client_surface.py` failures are an 8.2 seed-data FK bug (persist on a fresh DB), not stale-DB state — deferred to the 8.2 test owner.

### Review Findings

_Adversarial code review 2026-07-01 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 15 findings kept; 4 dismissed as false positives (see note). velara-api + velara-web are sub-repos; paths below are repo-relative._

**Decision resolved (2026-07-01)** — Attaching a `client_ready` but non-`client_facing` (e.g. `internal_only`) skill is **intended behavior, not a bug**. Product ruling: consultants are also users of attachments — an admin attaches a `client_ready` skill to a study/project to make it available to **internal consultants** working that engagement; `client_facing` is what separately gates *client* visibility, and `list_client_skills` correctly hides non-`client_facing` skills from clients. So the attach-panel guardrail (`lifecycle_state === 'client_ready'`, no visibility filter) is **correct as-built** → the "silently inert" framing is dismissed. Residual: the detach-dialog copy and the "Outputs" badge assume every attachment is client-facing (see patch below).

**Patch — ALL APPLIED + VERIFIED 2026-07-01** (BE: 34 tests pass on a freshly-migrated `velara_test`, image rebuilt so tests exercise the edits; FE: 349 vitest pass, `tsc --noEmit` + eslint clean)

- [x] [Review][Patch] Detach dialog copy + "Outputs" badge unconditionally imply client visibility on non-`client_facing` attachments — **ALREADY SATISFIED AS-BUILT:** `AttachedSkillChip` gates the "Outputs" badge on `isClientFacing` (AccessControl.tsx:39) and `DetachDialog` gates the "Clients … will no longer see it" line on `skill.visibility === 'client_facing'` (AccessControl.tsx:91). Verified against source; matches the resolved decision — no change needed. [Source: edge/decision-residual]
- [x] [Review][Patch] `AttachedSkillRead.id: str` → runtime 500 on internal list routes — **FIXED:** changed to `id: uuid.UUID` (skill_attachment.py:33), mirroring the `ClientSkillRead` fix. Guarded by the new list-with-attachment tests + an OpenAPI field-shape lock asserting `format: uuid`. [Source: auditor]
- [x] [Review][Patch] No test hits the internal `GET /{projects,studies}/{id}/skills` routes with an attachment — **FIXED:** added `test_list_project_skills_with_attachment`, `test_list_study_skills_with_attachment`, `test_list_project_skills_empty_ok` (they 500'd pre-fix, pass now). [Source: auditor+edge]
- [x] [Review][Patch] Study-attached skills un-runnable via the Study-specific Run button — **FIXED:** RunConsole now also consumes `useStudySkills(studyId)` in study scope and unions it with project attachments (deduped by id) into `availableSkills`, which drives both the picker list and `selectedSkill` (RunConsole.tsx:360-374, 476-480). [Source: edge]
- [x] [Review][Patch] Attach failures silently swallowed — **FIXED:** `useAttachSkill({onError})` + an `role="alert"` error banner in `AttachPanel` (AccessControl.tsx). [Source: edge+auditor]
- [x] [Review][Patch] Detach failure after dialog-close leaves a stale chip — **FIXED:** `useDetachSkill({onError})` + a `role="alert"` detach-error message in both `StudyRow` and `ProjectCard`. [Source: edge]
- [x] [Review][Patch] `useAttachSkill` docstring claimed optimistic behavior it lacked — **FIXED (implemented, not just re-commented):** real `onMutate` optimistic chip insert (via a passed `optimisticSkill`), `onError` rollback to the prior cache, `onSettled` re-sync (useNodeSkills.ts). Docstring is now true. [Source: blind+edge+auditor]
- [x] [Review][Patch] ORM model missing the `ForeignKey` (C2 drift) — **FIXED:** added `ForeignKey("skills.id", ondelete="CASCADE")` to the model `skill_id` column (skill_attachment.py:34-38). Migration `0017` re-verified: applies cleanly from `0016` on an empty DB, head confirmed. [Source: auditor]
- [x] [Review][Patch] 403 branches untested — **FIXED (honestly):** added `test_require_grantor_403_branch` (unit-level — the HTTP 403 branch is currently UNREACHABLE because `_INTERNAL_ROLES`==`_GRANTOR_ROLES`, documented in the test) + `test_out_of_scope_internal_note` asserting the unrestricted-internal complement. If the `admin`-role scope change lands (see below), an HTTP-level 403 test should be added. [Source: auditor+edge]
- [x] [Review][Patch] Internal list routes N+1 + whole-endpoint-404-on-concurrent-delete — **FIXED:** new `list_attached_skills_for_node` service fn does a single `Skill ⋈ SkillAttachment` JOIN; both routes use it (hierarchy.py). One query, and a concurrently-deleted skill drops from the join instead of 404-ing the endpoint. [Source: edge]
- [x] [Review][Patch] `SkillAttachmentRead.node_type` free `str` — **FIXED:** tightened to `AttachNodeType` (skill_attachment.py:22); OpenAPI lock now asserts the `["project","study"]` enum. [Source: blind]
- [x] [Review][Patch] `ClientCombobox` unbounded dropdown + no `scrollIntoView` + ArrowUp quirk — **FIXED:** `max-h-[280px] overflow-y-auto` on the listbox, guarded `scrollIntoView?.({block:'nearest'})` on `activeIdx` change, and ArrowUp/ArrowDown clamped sanely (ArrowDown opens if closed; ArrowUp holds at 0). [Source: blind+edge]
- [x] [Review][Patch] AttachPanel `aria-modal` without focus trap — **FIXED:** real Tab focus containment (wraps first↔last, pulls stray focus back in) + focus restore to the invoking element on close; the mislabeled comment is corrected. [Source: blind]
- [x] [Review][Patch] `DetachDialog` missing Escape handler — **FIXED:** added a document-level Escape handler → `onCancel` (AccessControl.tsx). [Source: blind]

**Deferred**

- [x] [Review][Defer] `attach_skill` returns 500 on a true concurrent duplicate insert (no `IntegrityError` catch) [velara-api/app/services/skill_attachment_service.py:783-813] — deferred, pre-existing pattern: select-then-insert with no catch; two simultaneous attaches of the same tuple both miss the existence check and the second hits the UNIQUE constraint → 500. Idempotency holds only for the sequential case. Inherited 1:1 from `create_grant`, which has the identical gap — fixing here should be a cross-cutting fix on both. [Source: edge]

**Scope change requested during review (NOT an 8.6 review patch — routed to correct-course + architect ADR)**

- [ ] [Review][Scope→new-story] Attach/detach from the **Engagements screen**, gated to a new `admin` role + `ma_tech`, with **consultant demoted to read-only** for attachments (consultant + client see attached skills but cannot attach). Requested by product 2026-07-01. This is **out of 8.6's scope as written** (8.6 built attach/detach on the Access Control screen only, gated to the as-built `{consultant, ma_tech}` grantor set per the 8.1 D4 decision). It requires **net-new role infrastructure + a reversal of a prior decision**, so it must go through **correct-course + an architect ADR**, not a code-review patch:
  - **New `admin` role (auth/architecture change):** add to `_INTERNAL_ROLES` (`velara-api/app/core/dependencies.py:106` — the hierarchy-scope bypass + `RejectClient` inverse both key on this; without it `admin` is treated as a client and 404'd off every internal route) and to FE `INTERNAL_ROLES` (`velara-web/src/shared/utils/auth.ts:85` — else `RequireInternal` bounces admin to the client portal). Cognito `custom:role` (`app/integrations/auth.py:268`) must be able to issue `admin`.
  - **Attach gate → `{admin, ma_tech}`:** change `_GRANTOR_ROLES` for the attach routes (`velara-api/app/api/v1/hierarchy.py:38`) to drop `consultant`. **OPEN DECISION for the ADR:** the *same* `_GRANTOR_ROLES` set also gates the **access-grant** routes (`app/api/v1/access_grants.py:26`) — does consultant lose GRANT rights too, or only skill-ATTACH rights? The 8.6 ADR treated attachment ∩ grant as 1:1 mirrors; splitting their role gates breaks that symmetry and needs an explicit call. Recommend a distinct `_ATTACH_ROLES` constant if attach and grant diverge.
  - **Engagements-screen affordances:** `EngagementsScreen` project/study skill sections are read-only chips today; add attach/detach (reuse `useAttachSkill`/`useDetachSkill` + `AttachPanel`/`DetachDialog`), shown only for `{admin, ma_tech}`; consultant/client render view-only.
  - **Action:** run `correct-course` to author the new story (mirrors how 8.5/8.6 were added) and request the architect ADR for the `admin` role before implementation. [Source: product request 2026-07-01]

**Dismissed (false positives — not written as action items, recorded for audit):**
- Missing `await session.commit()` in `delete_attachments_for_node` (Blind Hunter HIGH) — `_commit_delete` (hierarchy_service.py:91) commits the shared session and the staged attachment deletes flush with it; AC7 node-delete tests pass. Not a bug.
- Org-blind granted-node resolution in `list_client_skills` (Blind Hunter HIGH + Auditor RISK) — `resolve_scope_paths` filters grants by `org_id` and guards every path via `_path_in_org` (access_service.py:209), so `scope_paths` are provably org-prefixed; `Project`/`Study` have no `org_id` column by design; final query double-gates on `Skill.org_id` + `SkillAttachment.org_id`. No cross-org leak.
- AttachPanel `attachedIds` "stale/duplicated across two query instances" (Blind Hunter) — self-retracted on second look; same query key dedupes and invalidation propagates.
- RunConsole importing the internals-carrying `AttachedSkill` type (Blind Hunter informational) — RunConsole is internal-only; no client leak in this diff.
