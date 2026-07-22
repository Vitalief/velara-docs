---
baseline_commit: e23bfb0 (top-level docs repo); velara-api working tree at HEAD when picked up
---

# Story 16.1: Move Locations to Client Ownership (Data Migration)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want Locations to belong to the Client rather than to a single Study,
so that the same physical site doesn't need to be re-entered every time a new Study needs it.

**Why this is a real migration, not an additive column (verified in source):** `Location.study_id`
(`app/models/hierarchy.py:150-154`) is a hard `NOT NULL` FK to `studies.id` — no join table, no
polymorphic pattern, no `relationship()` (the whole hierarchy module is FK columns + service-layer
`session.get()` walk-ups, never ORM cascades). Every Location's `hierarchy_path` is derived
**once, at create time**, from its parent Study's path (`hierarchy_service.py:707-745`:
`f"{study.hierarchy_path}.{_build_ltree_segment('location', location.id)}"`) — there is no
re-parent/move operation anywhere in this codebase for any hierarchy level, so this migration is a
one-time backfill of existing rows, not something that must also intercept a live code path. There
are **zero** `UniqueConstraint`/`CheckConstraint`s anywhere in the hierarchy chain today, so no DB
constraint needs translating — but ltree containment is silently load-bearing for **authorization**
(see AC6) and **fan-out job scoping** (see AC7), which this story's own investigation surfaced
beyond what the epic doc names.

**Architect review completed 2026-07-22** (Winston) —
`_bmad-output/planning-artifacts/architecture/story-16-1-location-migration-review.md` — approves
the schema/migration shape as proposed and adds three explicit requirements (AC6, AC7, AC8 below)
that the epic's own AC4 ("downstream consumers re-verified") named only categorically. Read that
review in full before starting; it is the authoritative source for *why* AC6–AC8 exist, not just
*what* they require.

## Acceptance Criteria

1. **AC1 — Location becomes Client-owned.** `Location.study_id` (`NOT NULL` FK) is replaced with
   `Location.client_id` (`NOT NULL` FK to `clients.id`). Every Location's `hierarchy_path` is
   rebuilt to derive from `Client.hierarchy_path` instead of a Study's path (same
   `_build_ltree_segment('location', location.id)` suffix, new parent).

2. **AC2 — Real data is translated, not dropped.** A migration walks every existing Location's
   current `study_id → project_id → client_id` chain (mirrors `hierarchy_service.get_location`'s
   existing walk-up, `hierarchy_service.py:759-770`) to populate the new `client_id`, and inserts a
   `study_location_association` row linking the Location back to its original Study — every
   existing engagement's Location assignment is preserved exactly, zero user-visible behavior
   change post-migration. This is **not** an additive-nullable-column migration (unlike every
   prior correct-course migration) — it is a real translation of live, in-use data. Follow the
   `0020_audit_log_org_id.py` precedent (the one existing migration that backfills real data via
   `UPDATE ... FROM ... JOIN`, not just additive DDL) — see Dev Notes for the exact shape.

3. **AC3 — `study_location_association` is a plain join table, NOT the `SkillAttachment`
   polymorphic pattern.** `SkillAttachment`'s `node_id`/`node_type` string-discriminator shape
   (`app/models/skill_attachment.py`) exists because it targets *one of several* node types with no
   single possible FK. `study_location_association` is a fixed Study↔Location pair — both sides
   always resolve to one real table. Use a real composite-PK join table with real FKs and
   `ON DELETE CASCADE` on both sides:
   ```python
   class StudyLocationAssociation(Base):
       __tablename__ = "study_location_association"
       study_id: Mapped[uuid.UUID] = mapped_column(
           UUID(as_uuid=True), ForeignKey("studies.id", ondelete="CASCADE"), primary_key=True,
       )
       location_id: Mapped[uuid.UUID] = mapped_column(
           UUID(as_uuid=True), ForeignKey("locations.id", ondelete="CASCADE"), primary_key=True,
       )
       org_id: Mapped[str] = mapped_column(String(128), nullable=False)  # tenancy column, mirrors SkillAttachment/UserAccessGrant
   ```
   Do **not** mirror `node_id`/`node_type` here — it would trade away FK integrity/cascades for no
   benefit (confirmed with the architect review).

4. **AC4 — Studies associate, they don't own.** A new endpoint lets a user pick from the Client's
   existing Locations and create an association row — no new Location entity is created by this
   action. A NEW `POST /api/v1/clients/{id}/locations` route (mirroring the existing
   `POST /api/v1/locations` shape) is where a Location is actually created, once, at the Client.
   Naming/route-shape for the associate action (e.g. `POST /api/v1/studies/{id}/locations` body
   `{location_id}`, vs. a `/associations` sub-route) is a dev-time choice — keep it consistent
   with this codebase's existing REST conventions in `app/api/v1/hierarchy.py`.

5. **AC5 — `GET` Locations for a Client exists.** A new "list Locations for a Client" query (no
   equivalent exists today — confirmed: only `GET /locations?study_id=` exists) so the Client-level
   Location-management UI (Story 16.2) has something to query against. `GET /locations?study_id=`
   keeps its existing request shape (still a required query param) but its underlying query moves
   to a `JOIN study_location_association` (see AC1's rewrite of `list_locations`,
   `hierarchy_service.py:775-789`) — this is a public API **contract-stable** change, only the
   query underneath changes.

6. **AC6 — `LocationStudyMismatchError`'s semantics change from equality to existence — get this
   right, don't just rewrite the query.** Today (`invocations.py:203-204`):
   `if body.study_id is not None and location.study_id != body.study_id: raise LocationStudyMismatchError()`
   — a well-defined equality check, since a Location has exactly one Study. Under the new N:M
   model, "mismatch" must become an existence check against `study_location_association` (no row
   for `(study_id, location_id)` → still raise `LocationStudyMismatchError`, same error code/copy —
   this is a **wire-compatible** semantics fix, not a new error). The behavior a caller observes is
   unchanged (same error, same trigger condition in every case that was previously reachable); what
   changes is that a Location can now be legitimately associated with 0, 1, or N studies, so
   "not associated with this study" is a real state that "mismatch" must now express correctly.

7. **AC7 — Fan-out child jobs tag `hierarchy_path` with the Study's path, not the Location's.**
   Today (`execution_service.py:dispatch_fan_out`, ~line 1173) each child job is created with
   `hierarchy_path=str(location.hierarchy_path)` — which today nests under the parent job's
   Study-rooted path (`hierarchy_path=str(study.hierarchy_path)`, line 1156) purely because
   Location's path was derived from that Study. Once Location's path is Client-rooted (AC1), a
   child job's path would no longer be a descendant of its parent job's path under ltree `<@`,
   breaking any code that scopes/queries fan-out children by containment under the parent (job
   listing scope filters, audit hierarchy_path recording). **Fix: tag the child job's
   `hierarchy_path` with the Study's path** (`str(study.hierarchy_path)`, the same value the parent
   already uses) — the job's `hierarchy_path` should reflect *where the invocation is scoped for
   audit/access purposes* (the Study, still the actual execution context), not *where the Location
   physically lives* (now the Client, a different fact that used to be accidentally identical).
   `build_location_block(location)` (still called for the `location` input block) is unaffected —
   only the job's own `hierarchy_path` tagging changes.

8. **AC8 — Study-scoped access grants must still resolve their Locations after the migration —
   this needs an explicit fix AND a regression test, not just "re-verification."**
   `access_service.resolve_scope_paths` (`access_service.py:150-220`) resolves each
   `UserAccessGrant`'s node to its **current** `hierarchy_path` and returns the list; every
   `hierarchy_path <@ ANY(...)` site (`hierarchy_service.py:339,481,628,788`,
   `job_service.py:310`, `audit_service.py:261`, `analytics_service.py:54`) then filters child rows
   by containment under one of those paths. Today, a Study-level grant's path is the Study's own
   path, and a Location's path (Study-rooted) is contained within it — that's the entire mechanism
   by which a Study-scoped grantee currently sees "their" Locations. After AC1, a Location's path is
   Client-rooted and is **not** contained under any Study path, so a Study-scoped grant would
   silently stop resolving its Locations via `list_locations`'s scope filter
   (`hierarchy_service.py:775-789`) unless that filter is repaired.
   **Fix:** `list_locations`'s scope-filtering branch must resolve visibility via
   `study_location_association` membership (the Location is associated with the `study_id` the
   caller is asking about, AND the caller's granted paths include that Study — a join/exists check,
   not ltree containment on the Location's own path) rather than relying on `<@` against the
   Location's own `hierarchy_path`. Also update `access_service._resolve_node_hierarchy_path`'s
   `node_type == "location"` branch (`access_service.py:131-144`) to walk `Location.client_id →
   Client.org_id` directly (shorter — no longer needs Study/Project for the org-membership check),
   but note this function alone does not fix the Study-scoped-grant-visibility problem above; both
   changes are required. **Required regression test:** seed a Study-scoped `UserAccessGrant`
   *before* the migration/on the pre-migration shape, run the migration, and assert that grant still
   resolves that Location as in-scope via `list_locations` afterward — this is the test most likely
   to be skipped since it requires seeding a grant, not just a Location (per architect review §5).

9. **AC9 — `LocationCreate`/`LocationRead` schemas are updated consistently with AC1/AC4.**
   `LocationCreate.study_id` (`app/schemas/hierarchy.py:157-158`) currently determines both the FK
   and the hierarchy_path parent — split this: creation (`POST /clients/{id}/locations`, AC4) is
   keyed by `client_id`, association is a separate action. `LocationRead.study_id`
   (`app/schemas/hierarchy.py:172-186`) currently exposes the (now-removed) direct FK — decide
   whether to replace it with a `client_id` field, drop it from `LocationRead` in favor of a
   separate association-lookup endpoint, or expose an associated-studies list — pick whichever
   keeps Story 16.2's UI unblocked (16.2 depends on this decision) and document the choice in Dev
   Agent Record.

**Out of scope (do NOT touch):**
- Any UI change (Story 16.2). This story is backend/schema only.
- Client-level skill attachment (Story 16.3) — `SkillAttachment._VALID_NODE_TYPES` gaining
  `"client"` is that story's concern, not this one.
- Study-creation-time protocol upload (Story 16.4).
- Action-menu consolidation (Story 16.5).
- Hierarchy-scoped run history (Story 16.6).
- Do not combine this migration with any other schema change in the epic — ship and verify it
  alone before any other Location-adjacent story starts (epic-level sequencing constraint).

## Tasks / Subtasks

- [ ] **Task 1 — Schema: `Location.client_id` + `study_location_association` model (AC1, AC3)**
  — `app/models/hierarchy.py`, new `app/models/study_location_association.py` (or co-locate in
  `hierarchy.py`, dev's call, follow existing file organization)
  - [ ] Add `client_id: Mapped[uuid.UUID]` FK to `clients.id`, `nullable=False`, to `Location`.
    Remove `study_id` from the model (see Task 2 for migration ordering — the column drop happens
    in the DB only after every consumer in Tasks 4–7 is repointed).
  - [ ] Add `StudyLocationAssociation` per AC3's exact shape (composite PK, both FKs
    `ondelete="CASCADE"`, `org_id` column, no `node_type` discriminator).
  - [ ] Update `idx_locations_study_id` → drop; keep `idx_locations_hierarchy_path` (GiST) as-is.
    Add an index on `Location.client_id`.

- [ ] **Task 2 — Alembic migration (AC1, AC2) — `app/db/migrations/versions/0025_*.py`**
  - [ ] Follow the `0020_audit_log_org_id.py` shape: add `client_id` nullable → backfill via
    `UPDATE locations l SET client_id = c.id FROM studies s JOIN projects p ON p.id = s.project_id
    JOIN clients c ON c.id = p.client_id WHERE l.study_id = s.id AND l.client_id IS NULL` →
    `ALTER COLUMN client_id SET NOT NULL` (assert row-count parity before this step — every
    Location must resolve a client_id or the migration is unsafe to proceed).
  - [ ] Backfill `hierarchy_path` via raw `op.execute()` (ltree isn't autogenerate-representable,
    per `0011_hierarchy.py`'s precedent) — re-derive from `Client.hierarchy_path` using the same
    join shape, preserving the existing `location_<uuid>` ltree segment suffix unchanged.
  - [ ] Create `study_location_association`, populate 1:1 from every existing `(study_id, id)` pair
    on `locations` **before** dropping the old column.
  - [ ] Drop `locations.study_id`, its FK, and `idx_locations_study_id` — **last**, only after
    Tasks 4–7 repoint every consumer (a migration that drops the column before the code stops
    referencing it will break at import/runtime, not at migration time — sequence deliberately).
  - [ ] No append-only trigger exists on `locations` (unlike `audit_log_entries` in 0020) — a plain
    transactional migration is sufficient, no trigger-disable dance needed.
  - [ ] Write `downgrade()` symmetrically (recreate `study_id` nullable, backfill from
    `study_location_association`, drop `client_id`/association table) — match this codebase's
    existing migration convention of always providing a working downgrade.

- [ ] **Task 3 — `hierarchy_service.py`: Location CRUD rewrite (AC1, AC2, AC4, AC5, AC8)**
  - [ ] `create_location`: now takes `client_id` (not `study_id`), derives `hierarchy_path` from
    `Client.hierarchy_path` (mirror the existing `create_client`/`create_project`/`create_study`
    pattern at lines 297/432/579 — flush-then-set-path).
  - [ ] New `associate_location_to_study(session, study_id, location_id, org_id, acting_user_id)` —
    validates the Location belongs to the Study's Client (org-scoped), inserts a
    `StudyLocationAssociation` row (idempotent — reject or no-op on duplicate, dev's call, but be
    consistent with `SkillAttachment`'s unique-constraint-prevents-duplicate precedent).
  - [ ] New `disassociate_location_from_study(...)` — deletes only the association row; Location
    and any other Study's association untouched (mirrors AC3 in Story 16.2, but the service
    function belongs here since it operates on this story's new table).
  - [ ] `get_location`: rewrite the org-scope walk-up (currently `Location.study_id → Study →
    Project → Client`, lines 759-770) to `Location.client_id → Client` directly — shorter, matches
    AC8's `access_service` change.
  - [ ] `list_locations`: rewrite the `WHERE Location.study_id == study_id` filter
    (`hierarchy_service.py:785`) to `JOIN study_location_association ON
    study_location_association.location_id == Location.id WHERE
    study_location_association.study_id == :study_id`. The scope-filtering branch (the
    `scope_paths is not None` block, lines 786-788) must additionally verify the caller's granted
    paths cover this Study specifically — do not rely solely on `Location.hierarchy_path <@
    ANY(scope_paths)` post-migration (AC8) since a Client-rooted Location path no longer implies
    "used in this Study." (Concretely: an unrestricted or Client-scoped caller sees all associated
    Locations; a Study-scoped caller must additionally have that Study's own path in
    `scope_paths` — which they will, since scope_paths already includes the Study's path directly
    for a Study-level grant — so the fix may be as simple as confirming the containment check
    targets the *Study's* path, not the Location's; verify carefully against AC8's regression test,
    do not assume.)
  - [ ] New `list_locations_for_client(session, client_id, org_id, scope_paths=None)` — the AC5
    query backing Story 16.2's UI.

- [ ] **Task 4 — `app/api/v1/hierarchy.py`: routes (AC4, AC5, AC9)**
  - [ ] New `POST /api/v1/clients/{client_id}/locations` — mirrors the existing
    `POST /api/v1/locations` handler shape (lines ~403-431), calls `create_location` with
    `client_id`.
  - [ ] New associate/disassociate routes for a Study↔Location association (naming per AC4 note).
  - [ ] New `GET /api/v1/clients/{client_id}/locations` — backs AC5, calls
    `list_locations_for_client`.
  - [ ] `GET /api/v1/locations?study_id=` (existing route, lines 436-451) — no request-shape
    change; underlying call now hits the rewritten `list_locations`.
  - [ ] Update `LocationCreate`/`LocationRead` per AC9's decision; update `docs/api-spec.json`
    regeneration (this codebase's established post-schema-change step, per every prior story's
    Dev Notes).

- [ ] **Task 5 — `app/api/v1/invocations.py`: mismatch semantics (AC6)**
  - [ ] Rewrite the `location.study_id != body.study_id` check (line 203-204) to an existence
    check against `study_location_association` for `(body.study_id, location.id)`. Same
    `LocationStudyMismatchError`, same error code/message — verify with a test that the previously
    correct-mismatch and previously correct-match cases still behave identically, plus new
    coverage for the newly-representable "associated with a different Study" case.

- [ ] **Task 6 — `app/services/execution_service.py`: fan-out child hierarchy_path (AC7)**
  - [ ] In `dispatch_fan_out` (~line 1173), change child job creation's
    `hierarchy_path=str(location.hierarchy_path)` to `hierarchy_path=str(study.hierarchy_path)`
    (the `study` variable is already in scope — used for the parent job two lines up). Confirm
    `build_location_block(location)` (still populating the `location` input block) is unaffected —
    only the job's own `hierarchy_path` field changes.
  - [ ] Add/update a fan-out test asserting each child job's `hierarchy_path` equals the parent's
    (both Study-rooted) post-migration — this is the regression test for AC7.

- [ ] **Task 7 — `app/services/access_service.py`: org-scope walk-up + grant containment (AC8)**
  - [ ] `_resolve_node_hierarchy_path`'s `node_type == "location"` branch (lines 131-144): rewrite
    to `Location.client_id → Client.org_id` (drop the `Study`/`Project` walk — no longer needed).
  - [ ] Verify (write the regression test even if no code change is needed once Task 3's
    `list_locations` fix lands) that a Study-scoped `UserAccessGrant` created before the migration
    still resolves its Locations correctly after — per AC8's required test. Do not close this task
    without that specific test passing against a realistic pre-migration-shaped dataset.

- [ ] **Task 8 — Tests (AC2, AC6, AC7, AC8)**
  - [ ] Migration test: seed at least one Study with an existing Location (pre-migration shape,
    NOT an empty table), run the migration, assert (a) `client_id` backfilled via the 3-hop join,
    (b) `hierarchy_path` re-rooted under the correct Client, (c) the
    `study_location_association` row exists linking back to the original Study.
  - [ ] AC8 regression test: seed a Study-scoped `UserAccessGrant` on the pre-migration shape, run
    the migration, assert `list_locations` (scope-filtered) still returns that Location for that
    grantee afterward.
  - [ ] AC7 regression test: fan-out dispatch → assert every child job's `hierarchy_path` equals
    the parent's Study-rooted path (ltree `<@` containment holds).
  - [ ] AC6 test: mismatch case (Location not associated with the given Study) still raises
    `LocationStudyMismatchError`; a Location associated with 0 studies is a reachable, non-error
    state when no `study_id` is supplied.
  - [ ] `create_location`/`list_locations`/`get_location`/associate/disassociate — full CRUD
    coverage on the new Client-owned shape, mirroring existing Client/Project/Study CRUD test
    patterns in `tests/unit/services/test_hierarchy_service.py` (or wherever those currently live —
    confirm exact path when picking up this story).
  - [ ] `docs/api-spec.json` diff isolated to exactly the new/changed routes and schemas — no
    unrelated drift.

- [ ] **Task 9 — Gates**
  - [ ] Rebuild api (and worker — `execution_service.py`/`access_service.py` changes are imported
    by the worker too) before running tests in-container; run with `AUTH_BACKEND=dev` (documented
    gotcha — the container's baked `.env` sets `AUTH_BACKEND=cognito`, which 401s every dev-auth
    integration test unless overridden on the `docker exec`).
  - [ ] Full BE suite green (expect the one pre-existing flake `test_repeated_denials_are_deduped`
    — do not treat it as caused by this story); `ruff check` clean on every changed file.
  - [ ] Regenerate `docs/api-spec.json`, confirm diff is isolated to this story's new/changed
    surface only.

## Dev Notes

### Why this migration is safe to do as a one-time backfill (not a live re-parent)

Confirmed by source inspection: no hierarchy level in this codebase has a "move"/re-parent
operation — `update_location`, `update_study`, `update_project`, `update_client` only mutate
`name`/`description`/etc., never `hierarchy_path`. `hierarchy_path` is set exactly once, at
`create_*` time, for every entity. This means there is no live code path that needs to be
intercepted in parallel with the migration — it's purely: translate every existing row once, then
change all the write/read code going forward. This significantly de-risks the migration relative
to, say, a system where Locations could already be re-parented.

### The two conflicts the epic doc didn't fully resolve (AC6, AC7, AC8)

The correct-course proposal (`sprint-change-proposal-2026-07-20-engagement-model-refinement.md`)
and the epic doc (`epic-16-engagement-model-refinement.md`) both name AC4's downstream-consumer
re-verification only categorically ("fan-out location-dependent skill logic, audit hierarchy_path
recording... access-grant scope checks"). The architect review
(`_bmad-output/planning-artifacts/architecture/story-16-1-location-migration-review.md`) resolved
these to the three concrete, individually-testable requirements above (AC6, AC7, AC8) — read that
review's Section 3 table for the full downstream-consumer checklist (7 items; AC6/7/8 cover the
three that involve a real behavior/semantics decision, not just a mechanical query rewrite; the
remaining 4 are folded into Tasks 3/4 directly).

**AC8 is the one most likely to be under-tested.** It is easy to fix the `list_locations` query and
move on without noticing that Study-scoped grant visibility is a *separate* invariant that also
needs to keep holding — the review explicitly calls out that this requires seeding a grant in the
test, not just a Location, which is why it's called out as its own numbered AC rather than folded
into "re-verify downstream consumers."

### Migration precedent — follow `0020_audit_log_org_id.py`, not the additive-nullable pattern every other Epic 14/15/16 migration used

Every migration since `0021` has been additive-nullable (add a column, never touch existing rows,
document why backfill is skipped). This story is the exception — `0020` is the one prior migration
that backfills real data via `UPDATE ... FROM ... JOIN`, and its docstring explicitly frames real
data-touching as "the ONE legitimate reason to touch existing rows" for a migration. Read
`app/db/migrations/versions/0020_audit_log_org_id.py` in full before writing this migration — it is
the load-bearing precedent, not merely a similar example.

### `SkillAttachment`'s polymorphic pattern is the WRONG model to copy here

This is worth restating because the epic doc's own Story 16.1 context paragraph says
`study_location_association` "reus[es] the exact polymorphic pattern already proven by
`SkillAttachment`/`UserAccessGrant`" — the architect review corrects this: `SkillAttachment` is
polymorphic because it targets *one of several* node types (project or study) with no single
possible FK. `study_location_association` is a fixed Study↔Location pair; both sides always
resolve to a real table. A plain composite-PK join table with real FKs and cascades is simpler and
strictly better here — do not build a `node_id`/`node_type` shape for this table.

### Project Structure Notes

- No new directories — all changes are within the existing `app/models/`, `app/services/`,
  `app/api/v1/`, `app/db/migrations/versions/` structure this codebase already uses for hierarchy
  work.
- `study_location_association` may live in a new file (`app/models/study_location_association.py`)
  or be added to `app/models/hierarchy.py` alongside `Location` — check how `SkillAttachment` was
  filed (separate file, `app/models/skill_attachment.py`) for the closer precedent and prefer
  consistency with that.

### References

- [Source: _bmad-output/planning-artifacts/architecture/story-16-1-location-migration-review.md] —
  the architect review this story is built from; authoritative for AC6/AC7/AC8's rationale.
- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.1] —
  parent epic story (this story is the full implementation-detail expansion of that epic-level AC1-AC5).
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-20-engagement-model-refinement.md] —
  originating correct-course; Section 2 "Architecture / data model" is the heaviest-lift analysis.
- [Source: velara-api/app/models/hierarchy.py#L143-L174] — current `Location` model (to be changed).
- [Source: velara-api/app/services/hierarchy_service.py#L707-L790] — `create_location`,
  `get_location`, `list_locations` (all rewritten by this story).
- [Source: velara-api/app/models/skill_attachment.py] — the polymorphic precedent this story's
  `study_location_association` deliberately does NOT mirror (see Dev Notes).
- [Source: velara-api/app/db/migrations/versions/0020_audit_log_org_id.py] — the data-backfill
  migration precedent this story's migration follows.
- [Source: velara-api/app/db/migrations/versions/0011_hierarchy.py] — original ltree DDL
  conventions (raw `op.execute()`, GiST indexes) this migration must also follow for
  `hierarchy_path` re-derivation.
- [Source: velara-api/app/api/v1/invocations.py#L147-L221] — `LocationStudyMismatchError`,
  `_resolve_single_job_hierarchy_path` (AC6).
- [Source: velara-api/app/services/execution_service.py#L1127-L1210] — `dispatch_fan_out` (AC7).
- [Source: velara-api/app/services/access_service.py#L86-L226] — `_resolve_node_hierarchy_path`,
  `resolve_scope_paths` (AC8).
- [Source: velara-api/app/schemas/hierarchy.py#L157-L195] — `LocationCreate`/`LocationRead`/`LocationUpdate` (AC9).

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
