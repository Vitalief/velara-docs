---
baseline_commit: 915ba3b (top-level docs repo); velara-api on branch `development`, velara-web at its current HEAD when picked up
---

# Story 16.3: Client-Level Skill Attachment

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an admin or MA Tech consultant,
I want to attach a skill once at the Client level and have it become available everywhere under that Client that matches the skill's own scope,
so that I don't have to re-attach the same skill to every Project and every Study individually.

## ⚠️ SCOPE — read this first: this is a MODEL CHANGE, not a walk-up refactor

The parent epic (16.3) originally described a Client→Project→Study *walk-up* that **kept** Project/Study
attachment and merely added a Client tier on top. **The confirmed product decision supersedes that
wording.** From this story forward:

- **Skills attach ONLY at the Client level.** There is **no** way to attach a skill directly to a
  specific Project or a specific Study anymore. The per-Project and per-Study attach/detach affordances
  and their routes are **removed** (Project/Study *list-of-available-skills* reads stay — see AC3/AC4).
- **A skill's `scope` decides where it fans out, not where it attaches.** A **Project-scoped** skill
  attached at a Client is available at **every Project** under that Client. A **Study-scoped** skill
  attached at a Client is available at **every Study** under that Client. A **null-scope** skill is
  available at both tiers.
- **Existing Project/Study attachment rows are migrated up to their owning Client** (real-data
  migration, deduped) so no currently-available skill silently disappears.
- The **Client detail screen also lists** every client-attached skill (a management view), in addition
  to those skills appearing on the scoped descendant (Project/Study) screens.

This is a legitimate Epic-16-style supersession of the epic's own literal AC3 (the same pattern Epic 14
used on Epic 11 and Epic 15 on Epic 9). The epic's stated *goal* — "attach once, available everywhere
matching scope, stop the per-node re-attachment friction" — is fully honored; only the *mechanism*
(client-only attach + scope fan-out, vs. a three-tier walk-up) is the refined one.

**This story spans BOTH subrepos:** `velara-api` (the bulk — schema, service, routes, resolver, a
real-data migration, `delete_client` cleanup) and `velara-web` (attach controls move to the Client
screen; Project/Study screens keep a read-only "Available skills" list resolved server-side).

## Acceptance Criteria

1. **AC1 — `SkillAttachment` accepts `node_type="client"` and attach is client-only.**
   `_VALID_NODE_TYPES` (`skill_attachment_service.py:30`, currently `frozenset({"project", "study"})`)
   becomes `frozenset({"client"})` — the **only** legal attach target is now a Client. The
   `InvalidAttachmentNodeTypeError` message (`:54`) updates to "Must be one of: client." `_verify_node`
   (`:389-419`, currently a `project`/else-`study` branch) is rewritten to verify the **client** node
   via `hierarchy_service.get_client`. `AttachNodeType` in `schemas/skill_attachment.py:11` widens to
   include `"client"` (`SkillAttachmentRead.node_type` at `:22` inherits it — a `client` row would fail
   Pydantic validation without this).

2. **AC2 — The attach-time scope-must-equal-node_type guard is removed.** The check at
   `skill_attachment_service.py:106-107` (`if skill.scope is not None and skill.scope != node_type:
   raise SkillScopeMismatchError`) is **deleted entirely**. Under the new model a skill's `scope` no
   longer describes where it attaches (attachment is always at the Client) — it describes only where it
   **fans out** (AC5). A `project`-scoped and a `study`-scoped skill both attach identically to the
   Client; scope is applied only at resolution time. `SkillScopeMismatchError` itself becomes dead code
   — remove the class (`:58-69`) and its `SKILL_SCOPE_MISMATCH` error-code registration if it is
   registered anywhere; grep for `SkillScopeMismatchError`/`SKILL_SCOPE_MISMATCH` and remove all
   references (including tests asserting 422 scope-mismatch — those scenarios are no longer reachable).

3. **AC3 — New `/clients/{id}/skills` attach/list/detach routes; the six Project/Study attach/detach
   routes are removed; Project/Study *list* routes stay but resolve server-side.**
   - Add three routes on the hierarchy router (`hierarchy.py`, prefix `/api/v1`, `dependencies=[RejectClient]`):
     `GET/POST/DELETE /clients/{client_id}/skills[/{skill_id}]`, mirroring the existing project routes
     (`:627-707`) exactly — `_require_grantor(user.role)` on POST/DELETE, `get_client` +
     `scope.assert_in_scope(client.hierarchy_path)`, service call with `node_type="client"`,
     `node_id=str(client_id)`, 201 / 200 / 204.
   - **Remove** the six Project/Study **attach and detach** routes:
     `attach_skill_to_project`/`detach_skill_from_project` (`:650-707`),
     `attach_skill_to_study`/`detach_skill_from_study` (`:733-790`). Attaching/detaching at
     Project/Study is no longer a legal operation.
   - **Keep** the two Project/Study **list** routes (`list_project_skills` `:627`, `list_study_skills`
     `:710`) — but change what they return: instead of `list_attached_skills_for_node` (single-node,
     own attachments only), they call a **new resolver** (AC5) that returns the Client-attached skills
     that fan out to that Project/Study by scope. These are the read surfaces the internal Project/Study
     screens consume.

4. **AC4 — Client-attached skills resolve at every matching descendant AND on the Client screen.**
   - A **Project-scoped** skill attached at Client C is returned by `GET /projects/{p}/skills` for
     **every** Project `p` under C, with **no** row in the `skill_attachment` table pointing at `p`.
   - A **Study-scoped** skill attached at Client C is returned by `GET /studies/{s}/skills` for
     **every** Study `s` under C.
   - A **null-scope** skill attached at C is returned for both every Project and every Study under C.
   - `GET /clients/{c}/skills` returns **all** skills attached at C (regardless of scope) — the
     management view.
   - The client-portal discovery path (`list_client_skills`, `client.py:498`) reflects the same model:
     a client user granted at a Project/Study sees the Client-attached skills that fan out to their
     granted node by scope (see AC5 for the exact resolution).

5. **AC5 — A single server-side resolver implements the fan-out, consumed by every read path.** Add one
   resolution helper (in `skill_attachment_service.py`) that, given a **target node** (project or study,
   by `node_id`+`node_type`+its `hierarchy_path`), returns the Skills attached at any **ancestor Client**
   of that node whose scope matches the target tier:
   - Resolve the target's owning Client (project → `client_id`; study → project → `client_id`), take
     that Client's `id`.
   - Select `Skill` JOIN `SkillAttachment` where `SkillAttachment.node_type == "client"`,
     `SkillAttachment.node_id == str(client_id)`, `SkillAttachment.org_id == org_id`,
     `Skill.org_id == org_id`, **and** the scope filter: for a **project** target,
     `Skill.scope IN ('project', NULL)`; for a **study** target, `Skill.scope IN ('study', NULL)`.
     (Represent the NULL match with SQLAlchemy `or_(Skill.scope == tier, Skill.scope.is_(None))`.)
   - The internal admin read (`list_project_skills`/`list_study_skills`) uses this resolver directly
     (org-scoped, `assert_in_scope` already applied by the route).
   - `list_client_skills` (`:274-353`, the client-portal path) is rewritten to use the **same**
     ancestor+scope logic instead of its current "granted project/study node_id IN (...)" match. It must
     still intersect with the caller's **grants** (`scope_paths`) and keep the
     `visibility=="client_facing"` + `lifecycle_state=="client_ready"` filters — i.e. for each granted
     project/study path, include Client-attached skills of the matching scope tier from that node's
     ancestor Client, deduped `distinct()`. Its optional `node_id`/`node_type` narrowing (the
     `?project_id`/`?study_id` query filters in `client.py:483-496`) must continue to work (narrow to
     the requested node's tier).

6. **AC6 — Existing Project/Study attachment rows are migrated up to their owning Client (real-data
   migration).** A new Alembic migration (branching from head `0025_location_client_ownership`) rewrites
   every existing `skill_attachment` row with `node_type IN ('project','study')` into a
   `node_type='client'` row on that node's owning Client, then **deletes** the original project/study
   rows. It **must dedupe**: two Projects under the same Client both attaching skill X collapse to a
   single `(X, client_id, 'client', org)` row. This is a **real translation of live data** (like 16.1's
   0025) — test it against a realistic pre-migration dataset (project rows, study rows, cross-project
   duplicates, a row already at client level if any), not an empty table. A parity assertion after the
   translation must fail loudly if any project/study attachment's `node_id` did not resolve to a Client.

7. **AC7 — `delete_client` cleans up its skill attachments (parity gap fix).** Today `delete_client`
   (`hierarchy_service.py:386-413`) does **not** call `delete_attachments_for_node` (only `delete_project`
   `:541-545` and `delete_study` `:689-693` do — verified). Because attachments now live on the Client
   node, `delete_client` must call
   `delete_attachments_for_node(session, node_id=str(client.id), node_type="client", org_id=org_id)`
   before deleting the Client, mirroring the project/study cleanup. `node_id` has no FK, so no DB cascade
   fires — this service-level cleanup is mandatory to avoid orphaned rows.

8. **AC8 — Attach/detach UI moves to the Client screen; Project/Study screens keep a read-only list.**
   - The Client detail view (`ClientDetail`, `EngagementsScreen.tsx:747`) gains
     `<NodeSkillAttachControls nodeType="client" nodeId={client.id} label={...} />` (**reuse** the
     existing control — `src/features/admin/components/NodeSkillAttachControls.tsx`) plus a Skills card
     listing the client-attached skills. Gated by the same grantor roles (`admin`/`ma_tech`) the control
     already enforces internally via `isGrantor()` — **do not add a new gate**.
   - `ProjectDetail`/`StudyDetail` **remove** their `<NodeSkillAttachControls>` (`:1038-1042`,
     `:1173-1177`). Their skills cards become **read-only** lists ("Available skills") fed by the
     server-resolved `GET /projects|studies/{id}/skills` (which now returns the fanned-out
     Client-attached skills). **`StudyDetail`'s two-card walk-up (Project card + Study card,
     `:1087-1089` / `:1127-1203`) collapses to ONE read-only "Available skills" card** — the manual
     `useProjectSkills(study.project_id)` + `useStudySkills(study.id)` two-query walk-up is deleted; a
     single `useStudySkills(study.id)` now returns the resolved set. The per-skill **Run** button stays
     visible on each row (it is a primary action, not an attach action).
   - `AttachNodeType` (`src/api/skillAttachments.ts:4`) widens to include `'client'`; `NODE_SEGMENT`
     (`:12-15`) gains `client: 'clients'` (**never** naive `${nodeType}s` — the map exists precisely to
     avoid that; `clients` is correct but use the map). The node-type-agnostic hooks
     (`useNodeSkills`/`useAttachSkill`/`useDetachSkill`, `useNodeSkills.ts`) then work for `'client'`
     with no change.

9. **AC9 — Gates green in both subrepos, OpenAPI regenerated.** `velara-api`: `ruff`/`mypy` clean,
   `pytest` green (updated attachment tests — scope-mismatch tests removed, client-attach/detach/list
   tests added, migration tested, `delete_client` cleanup tested, client-portal fan-out tested).
   `docs/api-spec.json` regenerated (routes removed + added → the spec changes; regenerate via the
   repo's export script, do not hand-edit). `velara-web`: `tsc --noEmit` + `eslint` clean, `vitest`
   green.

**Out of scope (do NOT touch):**
- Changing what a skill's `scope` field **means at the schema/UI level** or how it is set/displayed
  (`Scope = Literal["project","study"]` in `schemas/skill.py:29` stays as-is; **do not** add a
  `"client"` scope value — scope still describes fan-out tier, and a Client is not a fan-out tier). The
  only change is *when* scope is applied (resolution, not attach).
- The **invocation / run authorization** path. Verified: `queue_invocation` (`invocations.py:255`)
  authorizes on grants + `assert_in_scope` + `location_dependent`, and reads **no** `skill_attachment`
  rows. Attachment governs skill **discovery/listing** only, never the run gate. No invocation-path
  change is needed or wanted.
- Action-menu consolidation (Story 16.5) and hierarchy-scoped run history (16.6).
- Client-portal *visual* redesign — only the resolution the discovery endpoint returns changes.
- Location/protocol stories (16.1/16.2/16.4).

## Tasks / Subtasks

### velara-api

- [ ] **Task 1 — Node-type + schema: make `client` the only legal attach target (AC1, AC2)** —
  `app/services/skill_attachment_service.py`, `app/schemas/skill_attachment.py`
  - [ ] `_VALID_NODE_TYPES` (`:30`) → `frozenset({"client"})`. Update the
    `InvalidAttachmentNodeTypeError` message (`:54`) to "…Must be one of: client."
  - [ ] Rewrite `_verify_node` (`:389-419`): the only branch is `client` → `hierarchy_service.get_client`
    (signature `get_client(session, client_id: uuid.UUID, org_id: str)` — raises `ClientNotFoundError`
    404 on cross-org/missing). Parse `node_id` via `uuid.UUID(node_id)` first (as the current code does);
    remove the project/study branches.
  - [ ] **Delete** the scope guard at `:106-107` and the `SkillScopeMismatchError` class (`:58-69`).
    Grep `SkillScopeMismatchError` and `SKILL_SCOPE_MISMATCH` across `app/` and remove every reference
    (error-code registry, exception handlers, `__all__`, etc.).
  - [ ] `schemas/skill_attachment.py:11`: `AttachNodeType = Literal["client"]` (or
    `Literal["client", "project", "study"]` if you prefer to keep the read-model tolerant of legacy rows
    during the same deploy — but after the migration only `client` rows exist; prefer the strict
    `Literal["client"]` and confirm no serialized legacy row survives the migration to violate it).

- [ ] **Task 2 — The fan-out resolver (AC4, AC5)** — `app/services/skill_attachment_service.py`
  - [ ] Add `list_resolved_skills_for_node(session, *, node_id, node_type, node_hierarchy_path, org_id)`
    (name dev's call; keep it consistent with the file's existing `list_*` naming). Logic:
    - Determine the owning `client_id`: for `node_type=="project"` load the Project → `client_id`; for
      `"study"` load Study → Project → `client_id`. (Reuse `hierarchy_service.get_project`/`get_study`,
      which already walk and org-guard; or resolve the client id from the passed
      `node_hierarchy_path`'s client segment — dev's call, but the getter route already loaded the node,
      so passing the resolved `client_id` in is cleanest. See Task 3 — the route already has the node.)
    - `tier = node_type` (`"project"` or `"study"`).
    - Query: `select(Skill).join(SkillAttachment, ...).where(SkillAttachment.node_type == "client",
      SkillAttachment.node_id == str(client_id), SkillAttachment.org_id == org_id,
      Skill.org_id == org_id, or_(Skill.scope == tier, Skill.scope.is_(None))).distinct()`.
    - Return `list[Skill]`. (Do **not** apply `client_facing`/`client_ready` here — that's the
      client-portal filter, applied in `list_client_skills`; the internal admin read shows all lifecycle
      states, matching today's `list_attached_skills_for_node` behavior.)
  - [ ] **Simplest correct shape:** since each internal route already loads the node (and thus can
    cheaply resolve `client_id`), consider a resolver that takes `client_id` + `tier` directly:
    `list_client_attached_skills(session, *, client_id, tier, org_id)` returning the scope-filtered
    Client attachments. Keep it one function used by all three internal reads (project/study/client — for
    the Client screen call it with `tier=None` meaning "all scopes", no scope filter). Dev picks the
    signature; the invariant is **one** resolver, no duplicated scope logic.

- [ ] **Task 3 — Routes: add client routes, remove project/study attach/detach, repoint list reads
  (AC3, AC4)** — `app/api/v1/hierarchy.py`
  - [ ] Add `GET/POST/DELETE /clients/{client_id}/skills[/{skill_id}]` mirroring the project routes
    (`:627-707`): `get_client` + `scope.assert_in_scope(client.hierarchy_path)`; POST/DELETE call
    `_require_grantor(user.role)`; POST → `attach_skill(node_type="client", node_id=str(client_id))`
    (201, `SkillAttachmentRead`); DELETE → `unattach_skill(node_type="client")` (204); GET →
    the resolver with `tier=None` (all scopes) → `AttachedSkillRead` list (200).
  - [ ] **Remove** `attach_skill_to_project`/`detach_skill_from_project` (`:650-707`) and
    `attach_skill_to_study`/`detach_skill_from_study` (`:733-790`).
  - [ ] Repoint `list_project_skills` (`:631`) and `list_study_skills` (`:710`): after the existing
    `get_project`/`get_study` + `assert_in_scope`, call the resolver with the node's owning `client_id`
    and `tier="project"`/`"study"`. Return `AttachedSkillRead` list as today.

- [ ] **Task 4 — Client-portal discovery resolver (AC4, AC5)** — `app/services/skill_attachment_service.py`
  (`list_client_skills`, `:274-353`), consumed by `app/api/v1/client.py:498`
  - [ ] Rewrite the resolution: keep the empty-`scope_paths`→`[]` guard (`:298-299`) and the granted
    project/study id resolution via ltree (`:306-322`) — but instead of matching
    `SkillAttachment.node_id IN (granted project/study ids)`, resolve, for each granted node, its owning
    **Client** and match `SkillAttachment.node_type=="client"` + `node_id == that client id` +
    the **scope-vs-tier** filter (project-granted node → project|null scope; study-granted node →
    study|null scope). Keep `visibility=="client_facing"` + `lifecycle_state=="client_ready"` +
    `distinct()`. Preserve the optional `node_id`/`node_type` per-node narrowing (`:346-350`,
    driven by `client.py`'s `?project_id`/`?study_id`) — narrow to the requested node's tier.
  - [ ] Efficient approach: collect the set of granted Client ids (the client segment of each granted
    path, or a `select(Client.id).where(hierarchy_path <@ ANY(scope_paths) OR <ancestor-of-granted>)`);
    then one JOIN with `SkillAttachment.node_id IN (client ids)` + the tier filter. Dev's call on the
    exact SQL; the invariant is: a client user granted at project/study P sees Client-attached skills of
    P's tier from P's ancestor Client, and **only** those (still grant-fenced, still lifecycle/visibility
    filtered).

- [ ] **Task 5 — `delete_client` attachment cleanup (AC7)** — `app/services/hierarchy_service.py`
  - [ ] In `delete_client` (`:386-413`), before `_commit_delete`, add:
    `from app.services.skill_attachment_service import delete_attachments_for_node` then
    `await delete_attachments_for_node(session, node_id=str(client.id), node_type="client", org_id=org_id)`
    — mirroring `delete_project` (`:541-545`) / `delete_study` (`:689-693`) exactly.

- [ ] **Task 6 — Real-data migration: project/study attachments → client (AC6)** —
  new file `app/db/migrations/versions/0026_client_skill_attachment.py`
  - [ ] `down_revision = "0025_location_client_ownership"` (verified current head — no child migration
    exists). Pick a `revision` id consistent with the repo convention (`0026_client_skill_attachment`).
  - [ ] `upgrade()`: insert deduped client rows, then delete the old project/study rows, then assert
    parity. Mirror 0025's `UPDATE … FROM … JOIN` chain-resolution style. Resolve owning client per row:
    - project rows: `JOIN projects p ON p.id = CAST(sa.node_id AS uuid)` → `p.client_id`.
    - study rows: `JOIN studies s ON s.id = CAST(sa.node_id AS uuid) JOIN projects p ON p.id = s.project_id`
      → `p.client_id`.
    - `node_id` is `String(36)` — you **must** `CAST(sa.node_id AS uuid)` to join against the UUID PKs.
  - [ ] **Dedupe** — no `ON CONFLICT` precedent exists in this repo (0025 is the only INSERT migration and
    has none); introduce it here. Recommended:
    `INSERT INTO skill_attachment (id, skill_id, node_id, node_type, org_id, attached_at, attached_by_user_id)
     SELECT gen_random_uuid()::text, sub.skill_id, sub.client_id::text, 'client', sub.org_id,
            MIN(sub.attached_at), MIN(sub.attached_by_user_id)
     FROM (<union of resolved project + study rows>) sub
     GROUP BY sub.skill_id, sub.client_id, sub.org_id
     ON CONFLICT (skill_id, node_id, node_type, org_id) DO NOTHING;`
    The `GROUP BY` collapses cross-project duplicates within a client; `ON CONFLICT DO NOTHING` protects
    against any pre-existing client row and against re-runs. `gen_random_uuid()::text` supplies the
    `String(36)` PK (no DB default exists — the model uses a Python-side `default`). Confirm `pgcrypto`/
    PG13+ `gen_random_uuid()` is available (it is used elsewhere? if not, `md5(random()::text || clock_timestamp()::text)` is a fallback — prefer `gen_random_uuid()`).
  - [ ] After insert: `DELETE FROM skill_attachment WHERE node_type IN ('project','study');`
  - [ ] Parity assert (mirror 0025 `:113-123`): `SELECT COUNT(*) FROM skill_attachment WHERE node_type
    NOT IN ('client')` must be 0 — `raise RuntimeError(...)` otherwise. (Also optionally assert every
    pre-existing project/study attachment's node_id resolved — i.e. count unresolved before delete.)
  - [ ] `downgrade()`: this is **lossy** (client rows can't be split back to the exact original per-project
    /study rows — provenance isn't recorded). Follow 0025's downgrade discipline: document the loss in a
    comment; a defensible downgrade is a no-op raising `NotImplementedError` with a clear message, OR
    (if the reviewer wants reversibility) leave the client rows in place and re-derive nothing. Dev's
    call — but be explicit; do not write a downgrade that silently produces a wrong pre-state.

- [ ] **Task 7 — Tests (AC1-AC7)** — `tests/integration/api/test_skill_attachments.py` and a migration test
  - [ ] **Remove** the now-unreachable scope-mismatch tests: `test_study_scoped_skill_rejected_for_project`
    (`:558`), `test_project_scoped_skill_rejected_for_study` (`:572`) — these assert the deleted 422.
  - [ ] Update/replace `test_null_scope_skill_allowed_to_both` (`:586`) to the client-attach model.
  - [ ] Add: attach a **project-scoped** skill at Client C → assert it appears in
    `GET /projects/{p}/skills` for **two different** projects under C, and is **absent** from
    `GET /studies/{s}/skills`. Symmetric test for a **study-scoped** skill. Null-scope → both tiers.
    Assert `GET /clients/{c}/skills` returns all attached skills regardless of scope.
  - [ ] Add: `POST /clients/{c}/skills` (201), `DELETE /clients/{c}/skills/{skill}` (204), grantor-gating
    403 for a non-grantor (mirror `test_require_grantor_403_branch` `:356`). Assert `POST /projects/{p}/skills`
    and `POST /studies/{s}/skills` now **404** (routes removed).
  - [ ] Add a **client-delete cleanup** test (mirror `test_project_delete_cleans_up_attachments` `:773`):
    attach at a client, delete the client (with no child projects so the 409 guard passes), assert the
    attachment rows are gone.
  - [ ] Client-portal fan-out: in `test_client_surface.py`, add a case — grant a client user at a Project,
    attach a project-scoped client-facing/client-ready skill at the ancestor Client → assert it surfaces
    via `GET /client/skills`. Symmetric study case. Cross-scope must NOT surface (study-scoped skill must
    not appear for a project-only grant).
  - [ ] **Migration test:** seed a realistic pre-0026 dataset (project attachment rows, study attachment
    rows, two projects under one client sharing a skill = a dedupe collision), run `upgrade()`, assert:
    every original row is gone, exactly the deduped client rows exist, availability (via the resolver /
    routes) is unchanged for a representative node. Follow the repo's existing migration-test harness
    pattern (look for how 0025 / 0020 real-data migrations are tested).
  - [ ] OpenAPI lock test (`test_skill_attachment_schemas_in_openapi` `:823`) updated for the route set.

- [ ] **Task 8 — OpenAPI spec regen (AC9)** — `docs/api-spec.json`
  - [ ] Regenerate via the repo's export script (per memory: `export_openapi.py` writes inside the
    container/image — run it the repo's canonical way and `docker cp` the spec out if needed; do **not**
    hand-edit). The removed 4 routes + added 3 routes must be reflected. Confirm the spec diff matches
    the route changes.

### velara-web

- [ ] **Task 9 — API client + hooks: add the `client` node type (AC8)** — `src/api/skillAttachments.ts`
  - [ ] `AttachNodeType` (`:4`) → `'project' | 'study' | 'client'`. `NODE_SEGMENT` (`:12-15`) → add
    `client: 'clients'`. No function-body changes (URLs are built from the map). The
    `useNodeSkills`/`useAttachSkill`/`useDetachSkill` hooks (`useNodeSkills.ts`) are node-type-agnostic
    and now work for `'client'` unchanged.
  - [ ] Add a read hook for the Client screen's skills list. Reuse `useNodeSkills('client', clientId)`
    directly, OR add a thin `useClientNodeSkills(clientId?)` in `useProjectSkills.ts` (key
    `['nodeSkills','client', clientId ?? '']`) mirroring `useProjectSkills`/`useStudySkills`. **Do NOT
    name it `useClientSkills`** — that name is already the client-portal hook
    (`features/client-portal/hooks/useClientSkills.ts`); a collision will confuse.

- [ ] **Task 10 — Client screen: attach controls + Skills card (AC8)** — `EngagementsScreen.tsx`
  - [ ] `ClientDetail` (`:747`): after the Locations card (`:797-803`), add a Skills card listing the
    client-attached skills (from the read hook) — mirror `ProjectDetail`'s Skills card markup
    (`:1030-1068`: `RuntimeTypeChip` + `SkillLifecycleBadge` rows, Run button per row calling
    `onRun(skill.id, ...)`). Give this card a **distinct heading** (e.g. "Client skills" or "Attached
    skills") — **not** the bare "Skills" — because `EngagementsScreen.test.tsx` uses
    `getByText('Skills')` and a second literal "Skills" would make it non-unique (verified trap).
  - [ ] Add `<NodeSkillAttachControls nodeType="client" nodeId={client.id} label={`${client.name} · Client`} />`
    to the card header (reuse — do not rebuild). Its internal `isGrantor()` gate handles role visibility;
    no extra gating.

- [ ] **Task 11 — Project/Study screens: attach controls out, read-only resolved list (AC8)** —
  `EngagementsScreen.tsx`
  - [ ] `ProjectDetail` (`:980`): remove `<NodeSkillAttachControls nodeType="project" …>` (`:1038-1042`).
    The Skills card stays but is now a read-only "Available skills" list fed by the unchanged
    `useProjectSkills(project.id)` call (`:992`) — which now returns the server-resolved fanned-out set.
    Update the card caption/empty-text to reflect availability-by-client-attachment (e.g. empty:
    "No skills available — attach at the Client.").
  - [ ] `StudyDetail` (`:1073`): **collapse the two-card walk-up into one read-only "Available skills"
    card.** Remove `useProjectSkills(study.project_id)` (`:1088`) and Card A (`:1127-1162`); remove the
    `<NodeSkillAttachControls nodeType="study" …>` (`:1173-1177`). Keep a single card fed by
    `useStudySkills(study.id)` (`:1089`) — now the server-resolved study-tier set — with per-row Run
    buttons (`onRun(skill.id, 'study', study.id)`). Update empty/caption copy.
  - [ ] Verify no other consumer of `useProjectSkills`/`useStudySkills` assumed "own attachments only"
    semantics (grep both hook names across the FE). The run path is unaffected (it uses grants, not
    attachments).

- [ ] **Task 12 — FE tests + gates (AC8, AC9)** — co-located `.test.tsx`
  - [ ] `NodeSkillAttachControls.test.tsx`: add a `nodeType="client"` case (role-gate assertions apply
    unchanged — null for consultant, "+ Attach skill" for admin/ma_tech).
  - [ ] `EngagementsScreen.test.tsx`: ClientDetail now renders a skills card + attach control — ensure the
    "Skills" heading query stays unambiguous (use the distinct Client-card heading or `getAllByText`).
    Update/replace any StudyDetail test asserting the two-card walk-up ("No skills attached to the parent
    project." / "Study-specific skills") — those cards are gone.
  - [ ] Confirm the two wholesale-`useEngagements`-mock files (`src/routes/internal.test.tsx:11-40`,
    `src/pages/LogoutFlow.test.tsx:21-40`) still pass. Since the new work lives in `skillAttachments`/
    `useNodeSkills` (not `useEngagements`), you likely add **no** new `useEngagements` export — but if
    ClientDetail ends up needing one, it must be added to **both** literal mock objects or the app
    crashes on render (verified prior-story trap).
  - [ ] Gates: `tsc --noEmit` + `eslint` clean; `vitest run` green (0 new failures).

- [ ] **Task 13 — Cross-repo gate (AC9)**
  - [ ] Do NOT commit velara-api or velara-web (subrepos — dev-story only commits the top-level docs repo,
    per the never-push-subrepos rule; code-review commits the subrepos post-review). Rebuild the api
    image before running pytest (the image bakes source — a stale image gives false results; verified
    repo gotcha). Rebuild **both** api and worker if a shared module changed (per Epic 15 lesson) — though
    this story doesn't touch worker code, confirm.

## Dev Notes

### The exact backend change surface (verified against source — line numbers current on `development`)

| File | What changes |
|---|---|
| `app/services/skill_attachment_service.py` | `_VALID_NODE_TYPES` `:30` → `{"client"}`; error msg `:54`; delete scope guard `:106-107` + `SkillScopeMismatchError` class `:58-69`; rewrite `_verify_node` `:389-419` (client-only, `get_client`); rewrite `list_client_skills` `:274-353` (ancestor-client + scope-tier resolution); add the internal resolver (Task 2). `delete_attachments_for_node` `:356-383` unchanged (node-type-agnostic). |
| `app/schemas/skill_attachment.py` | `AttachNodeType` `:11` → include `"client"`. |
| `app/api/v1/hierarchy.py` | add 3 `/clients/{id}/skills` routes; remove 4 project/study attach+detach routes (`:650-707`, `:733-790`); repoint 2 list routes (`:631`, `:710`) to the resolver. |
| `app/services/hierarchy_service.py` | `delete_client` `:386-413` → add `delete_attachments_for_node(node_type="client")` (AC7 gap). |
| `app/db/migrations/versions/0026_*.py` | NEW real-data migration (AC6), head `0025_location_client_ownership`. |
| `docs/api-spec.json` | regenerated (route set changed). |

### ⚠️ Non-obvious traps (this is where a naive implementation regresses)

**Trap 1 — attachments do NOT authorize runs; don't "fix" the invocation path.** It's tempting to think
"attachment = permission to run." It is not. `queue_invocation` (`invocations.py:255`) authorizes on
**grants + `assert_in_scope` + `location_dependent`** and reads **zero** `skill_attachment` rows
(verified across all of `app/` — the only readers are `skill_attachment_service`, `hierarchy_service`
delete-cleanup, `hierarchy.py` routes, and `client.py:498`). Attachment governs **discovery/listing**
only. Changing attachment to client-only must **not** touch the run gate. Adding an attachment check to
`queue_invocation` would be a scope-creep regression.

**Trap 2 — scope now means fan-out tier, applied at RESOLUTION, never at attach.** Under the old model
`skill.scope` was checked at attach time (`:106`, the deleted guard). Under the new model attach is
always at the Client and accepts any scope. The scope filter moves to the **read/resolve** path
(`or_(Skill.scope == tier, Skill.scope.is_(None))`). A common mistake: re-introducing a scope check at
attach ("client-scoped skills only") — there is **no** `"client"` scope value and none is being added
(`Scope = Literal["project","study"]` stays). Every skill attaches to the Client identically; scope only
decides whether it surfaces on Project screens, Study screens, or both.

**Trap 3 — the migration dedupe collision (AC6) is real and has no repo precedent.** Two Projects under
one Client both attaching skill X both remap to `(X, client_id, 'client', org)` → a
`uq_skill_attachment_skill_node_org` UNIQUE violation. You **must** dedupe (`GROUP BY` +
`ON CONFLICT DO NOTHING`). This repo has **no** prior `ON CONFLICT` migration (0025 is the only INSERT
migration and has none) — you're introducing the pattern. Also: the `id` PK is `String(36)` with **no DB
default** (Python-side default only), so a SQL `INSERT … SELECT` must generate it
(`gen_random_uuid()::text`). And `node_id` is `String(36)` — `CAST(node_id AS uuid)` is required to join
against the UUID PKs of `projects`/`studies`. Test the migration against realistic data (16.1's 0025 is
the pattern: real translation, parity assertion, tested with non-empty tables), not an empty table.

**Trap 4 — `delete_client` silently orphans attachments today (AC7).** `delete_project` and
`delete_study` both call `delete_attachments_for_node`; `delete_client` does **not** (verified
`:386-413`). Before this story that was harmless (attachments never lived on a client node). Now it's a
leak: `node_id` has no FK, so no DB cascade fires — a deleted client's attachment rows would linger with
a dangling `node_id`. Add the cleanup call. (Same class of bug as 16.1's "sweep every path that assumed
the old model" lesson.)

**Trap 5 — two read consumers, one resolver (AC5).** The internal admin routes
(`list_project_skills`/`list_study_skills`) and the client-portal path (`list_client_skills`) are
**different functions with different filters** (internal shows all lifecycle states; client-portal
filters `client_facing`/`client_ready` and fences by grants). Do **not** duplicate the ancestor+scope
resolution logic into both by copy-paste — factor the "Client-attached skills of tier T under client C"
core into one helper and have each caller apply its own extra filters. Divergent copies are exactly what
this epic's AC3 set out to eliminate.

### Client-portal resolution — the grant fence stays (AC5)

`list_client_skills` (`:274`) is called from `client.py:498` for client-role users; `scope.unrestricted`
short-circuits internal callers to `[]` (`client.py:476-478`). The rewrite keeps: empty-`scope_paths`→`[]`;
the grant fence (a client user only sees skills reachable from a node they're **granted** on); and the
`visibility=="client_facing"` + `lifecycle_state=="client_ready"` filters. What changes is only the
attachment match: from "attachment node_id ∈ granted project/study ids" to "attachment is a `client`
row on the ancestor Client of a granted node, of the granted node's scope tier." The `?project_id`/
`?study_id` narrowing (`client.py:483-496`) still works — it narrows to that node's tier.

### Reuse map (do NOT rebuild)

- **Attach control** — `NodeSkillAttachControls` (`src/features/admin/components/NodeSkillAttachControls.tsx`):
  node-type-agnostic, gated internally by `isGrantor()`. Reuse with `nodeType="client"`. Its underlying
  `AttachPanel`/`DetachDialog` come from `AccessControl.tsx`.
- **Attachment API** — `src/api/skillAttachments.ts`: `NODE_SEGMENT`-driven URLs; only the map + the
  `AttachNodeType` type change. Hooks `useNodeSkills`/`useAttachSkill`/`useDetachSkill`
  (`useNodeSkills.ts`) are already generic.
- **Skill row markup** — inline in `ProjectDetail` (`:1052-1065`): `RuntimeTypeChip` +
  `SkillLifecycleBadge` (`@/features/skills/components/SkillLifecycleBadge`) + Run button. Replicate for
  the Client card; do not invent a new row component.
- **Backend route pattern** — the project skill routes (`hierarchy.py:627-707`) and the client-location
  routes (`hierarchy.py:400-611` from 16.1) are the exact templates for the new client-skill routes
  (`get_client` + `assert_in_scope(client.hierarchy_path)` + `_require_grantor` on mutations).
- **Migration pattern** — `0025_location_client_ownership.py`: `UPDATE … FROM … JOIN` chain-resolution,
  parity assertion before enforcing, lossy-downgrade discipline. The one thing 0025 lacks that you need:
  `ON CONFLICT DO NOTHING` dedupe.
- **`delete_attachments_for_node`** (`skill_attachment_service.py:356`) already exists and is
  node-type-agnostic — just call it from `delete_client`.

### Data model facts (verified)

- `SkillAttachment` (`app/models/skill_attachment.py`): `node_type` is `String(16)`, **no** enum/CHECK →
  storing `"client"` needs **no** migration for the column itself. Unique constraint
  `uq_skill_attachment_skill_node_org` = `(skill_id, node_id, node_type, org_id)`. `node_id` `String(36)`,
  no FK (polymorphic).
- `Skill.scope` (`app/models/skill.py:59`): `String(16)` nullable, values `project|study|None`. Pydantic
  `Scope = Literal["project","study"]` (`schemas/skill.py:29`). **No `"client"` scope; none added.**
- `Project.client_id` (FK `clients.id`), `Study.project_id` (FK `projects.id` → `project.client_id`).
  `Client/Project/Study.hierarchy_path` are `LtreeType` with GiST indexes. Descendant containment idiom:
  `text("hierarchy_path <@ ANY(CAST(:paths AS ltree[]))")`.
- `get_client(session, client_id: uuid.UUID, org_id)` → `Client`, raises `ClientNotFoundError` (404) on
  cross-org/missing. `list_projects(session, client_id, org_id, scope_paths=None)` enumerates a client's
  projects by FK. There is **no** single "all studies under a client" helper — enumerate via
  projects→studies or ltree containment (Task 2/4 use the owning-client-id match, so you don't need to
  enumerate descendants explicitly — you match attachments by the client node id + scope tier).

### Testing standards

- Backend: pytest, integration tests in `tests/integration/api/test_skill_attachments.py` (950 lines,
  the primary file). Rebuild the api image before pytest (image bakes source). Audit rows for
  attach/detach carry `node_type` in free-form metadata — `"client"` flows through unchanged.
- Frontend: Vitest + React Testing Library, co-located `*.test.tsx`. Watch the `getByText('Skills')`
  uniqueness trap and the two wholesale-`useEngagements`-mock files.

### Git / build context

- `velara-api` on `development`, `velara-web` on its current HEAD. Both are **separate nested git repos**
  from the top-level docs repo; `cd`ing in shifts Bash cwd — `cd` back for docs-publish git commands.
- Do NOT commit either subrepo (never-push-subrepos rule). Regenerate `docs/api-spec.json` but do not
  commit it here — code-review commits the api subrepo post-review.

### Project Structure Notes

- Backend changes: `app/services/skill_attachment_service.py`, `app/services/hierarchy_service.py`,
  `app/api/v1/hierarchy.py`, `app/schemas/skill_attachment.py`, one new migration under
  `app/db/migrations/versions/`, tests under `tests/integration/`, `docs/api-spec.json`.
- Frontend changes: `src/api/skillAttachments.ts`, `src/features/run/hooks/useProjectSkills.ts` (if a
  new read hook is added there), `src/features/engagements/components/EngagementsScreen.tsx`, co-located
  tests. `NodeSkillAttachControls` is reused, not modified (unless a `client` label needs threading —
  it takes `label` as a prop already). No new directories.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.3] —
  parent epic story. **Note the confirmed supersession:** this story implements client-only attachment +
  scope fan-out (product decision), not the epic's literal three-tier walk-up; the epic's *goal* is
  honored.
- [Source: _bmad-output/implementation-artifacts/stories/16-2-client-level-location-management-and-study-association-ui.md] —
  prior Epic 16 story; establishes the client-owned pattern, the `/clients/{id}/…` route shape, the
  `NODE_SEGMENT` map lesson, the `EngagementsScreen.tsx` layout, and the wholesale-mock trap.
- [Source: _bmad-output/implementation-artifacts/stories/16-1-move-locations-to-client-ownership.md] —
  the migration precedent (0025); real-data-translation discipline and downstream re-verification lesson.
- [Source: velara-api/app/services/skill_attachment_service.py#L30-L419] — `_VALID_NODE_TYPES`, the
  scope guard, `_verify_node`, `list_attached_skills_for_node`, `list_client_skills`,
  `delete_attachments_for_node`.
- [Source: velara-api/app/api/v1/hierarchy.py#L627-L790] — the six project/study skill routes (template
  + removal targets); L400-611 the client-location routes (mirror pattern).
- [Source: velara-api/app/services/hierarchy_service.py#L323-L709] — `get_client`/`get_project`/`get_study`,
  `list_projects`, and the `delete_client`/`delete_project`/`delete_study` cleanup asymmetry (AC7).
- [Source: velara-api/app/models/skill_attachment.py] — columns, unique constraint, node_type `String(16)`
  no-CHECK.
- [Source: velara-api/app/models/skill.py#L59] + [velara-api/app/schemas/skill.py#L29] — `scope` column
  and `Scope` Literal (unchanged).
- [Source: velara-api/app/api/v1/client.py#L460-L508] — client-portal `/client/skills` route consuming
  `list_client_skills`.
- [Source: velara-api/app/db/migrations/versions/0025_location_client_ownership.py] — real-data migration
  pattern; head to branch from.
- [Source: velara-web/src/features/admin/components/NodeSkillAttachControls.tsx] — reused attach control.
- [Source: velara-web/src/api/skillAttachments.ts#L4-L15] — `AttachNodeType` + `NODE_SEGMENT`.
- [Source: velara-web/src/features/admin/hooks/useNodeSkills.ts] +
  [velara-web/src/features/run/hooks/useProjectSkills.ts] — the node-type-agnostic attach hooks and the
  project/study read hooks.
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L747-L1206] — `ClientDetail`,
  `ProjectDetail`, `StudyDetail` (two-card walk-up to collapse).
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] —
  envelope, error-code, TanStack Query, ltree-scope, migration conventions.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
