# Architecture Review — Story 16.1: Move Locations to Client Ownership

**Reviewer:** Winston (System Architect)
**Date:** 2026-07-22
**Scope:** Pre-implementation review of the Location data migration proposed in
`sprint-change-proposal-2026-07-20-engagement-model-refinement.md`, Story 16.1, per that
proposal's own recommendation that this migration get an architect's eyes before `create-story`
details it further.

**Verdict: Approved, with two structural conflicts the correct-course proposal under-scoped and
one sequencing addition.** The schema/migration shape (Section 2) is sound and well-precedented.
The two issues below are not blockers to *starting* the story, but they must be written into
Story 16.1's or 16.3's acceptance criteria explicitly — right now neither the correct-course
proposal nor draft AC4 ("downstream consumers are re-verified") gives the implementer enough to
find them without re-deriving this analysis from scratch.

---

## 1. Confirmed current state (source-verified)

- `Location.study_id` — `NOT NULL` FK to `studies.id`, no `relationship()` (this codebase's whole
  hierarchy module is FK columns + service-layer walk-ups, no ORM cascades). `app/models/hierarchy.py:143-174`.
- No `UniqueConstraint`/`CheckConstraint` anywhere in the hierarchy chain — zero DB-level
  uniqueness assumptions to migrate (Section 6's concern in the proposal is moot).
- `hierarchy_path` is derived **once, at create time**, from the parent Study
  (`hierarchy_service.py:707-752`) — there is no "move"/re-parent operation anywhere in this
  codebase for any hierarchy level. This is good news: the migration is a one-time backfill of
  existing rows, not something that must also intercept a live re-parenting code path.
- `SkillAttachment`'s polymorphic `node_id`/`node_type` shape is the wrong precedent for
  `study_location_association`. That shape exists because `SkillAttachment` targets one of
  *several* node types with no single FK possible. `study_location_association` is a fixed
  Study↔Location pair — both sides always resolve to one real table. Use a plain composite-PK
  join table with real FKs and `ON DELETE CASCADE`, not the `node_id`/`node_type` string
  discriminator. Mirroring the polymorphic pattern here would trade away FK integrity for zero
  benefit.

## 2. Migration plan (approved shape)

Follow the `0020_audit_log_org_id.py` precedent — the one prior migration in this codebase that
backfills real data via `UPDATE ... FROM ... JOIN`, not just additive nullable DDL:

1. `ALTER TABLE locations ADD COLUMN client_id UUID NULL REFERENCES clients(id)`.
2. Backfill: `UPDATE locations l SET client_id = c.id FROM studies s JOIN projects p ON p.id = s.project_id JOIN clients c ON c.id = p.client_id WHERE l.study_id = s.id AND l.client_id IS NULL`.
3. `ALTER COLUMN client_id SET NOT NULL` once backfill is verified complete (assert row-count parity before this step).
4. Backfill `hierarchy_path` from `Client.hierarchy_path` via the same join shape (raw `op.execute()` — ltree isn't autogenerate-representable, matching `0011_hierarchy.py`'s precedent).
5. Create `study_location_association(study_id PK/FK CASCADE, location_id PK/FK CASCADE, org_id)`, populate 1:1 from every existing `(study_id, id)` pair on `locations` **before** dropping the old column.
6. Drop `locations.study_id`, its FK, and `idx_locations_study_id` — last step, only after every downstream consumer in Section 3 is repointed.
7. No append-only trigger exists on `locations` (unlike `audit_log_entries`), so `0020`'s
   trigger-disable dance is unnecessary here — a plain transactional migration is sufficient.

This matches the correct-course proposal's AC1/AC2/AC3 as written. No changes needed there.

## 3. Downstream consumers — the explicit checklist AC4 must reference

The proposal's AC4 says "downstream consumers are re-verified" but names only three vague
categories. Here is the concrete list, source-verified, that Story 16.1 (or a tightly-coupled
16.3 follow-up — see Section 4) must resolve:

| # | Site | Current behavior | Required change |
|---|------|-------------------|------------------|
| 1 | `hierarchy_service.list_locations` (`hierarchy_service.py:785`, backs `GET /locations?study_id=`) | `WHERE Location.study_id == study_id` — direct FK filter | Rewrite to `JOIN study_location_association` on `(study_id, location_id)`. Public API shape (`study_id` required query param) can stay the same; only the underlying query changes. |
| 2 | `invocations.py:320` fan-out enumeration | Calls `list_locations(study_id=...)` | No code change needed here if #1 is fixed underneath — but confirm the call site doesn't also assume `study_id` is Location's *only* possible Study. |
| 3 | `_resolve_single_job_hierarchy_path`, `LocationStudyMismatchError` (`invocations.py:147-163, 203-204`) | Equality check: `location.study_id != body.study_id` | **Semantic change, not just a query change.** Becomes an existence check against `study_location_association`. The error now means "this Location is not currently associated with this Study" — a legitimately reachable state once a Location can belong to 0/1/N Studies. Get explicit product sign-off on the error copy/behavior before implementing — this is a user-facing meaning change, not a refactor. |
| 4 | Fan-out child job `hierarchy_path` tagging (`execution_service.py:~1173`) | Child job tagged with `location.hierarchy_path`, which today nests under the parent job's Study-rooted path | **This breaks under the new model.** Once Location.hierarchy_path is Client-rooted, the child job's path is no longer a descendant of the parent job's Study-rooted path via ltree `<@`. Any code that scopes/queries fan-out children by containment under the parent's path breaks silently. Decide explicitly: either (a) tag the child job's `hierarchy_path` with the *Study's* path (not the Location's) since the child job is conceptually "this skill run, for this Study, at this Location" — Study is still the execution context — or (b) carry both paths. Recommend (a): the job's hierarchy_path should reflect *where the invocation is scoped for audit/access purposes* (the Study), not *where the Location physically lives* (the Client) — these are now two different facts that used to be accidentally identical. |
| 5 | `hierarchy_scope` / `UserAccessGrant` containment (`access_service.py:86-144` + every `hierarchy_path <@ ANY(...)` site: `hierarchy_service.py:339, 481, 628, 788`) | A Study-scoped grant currently sees all of that Study's Locations *only because* the Location's path nests under the Study's path | **This is an authorization behavior change, not just a data-shape change.** After the migration, ltree containment alone can no longer answer "does this grant cover this Location" for Study-level grants — a Client-scoped grant would now see *every* Location under that Client (correct, arguably an improvement), but a Study-scoped grant sees *none* of "its" Locations via path containment (regression) unless hierarchy_scope's location-visibility path explicitly joins through `study_location_association` for the Study-level-grant case. **This must be an explicit AC, tested against a real Study-scoped grant, not inferred from "re-verify downstream consumers."** |
| 6 | `access_service._resolve_node_hierarchy_path`, `node_type == "location"` branch (`access_service.py:131-144`) | Walks `Location.study_id → Study.project_id → Project.client_id → Client.org_id` | Rewrite the walk to `Location.client_id → Client.org_id` directly (shorter, and no longer needs Study/Project at all for org-membership resolution) — but see #5, this function alone doesn't fix the grant-containment problem, only the org-fence check. |
| 7 | `LocationCreate`/`LocationRead` schemas (`app/schemas/hierarchy.py:157-183`) | Both have a required `study_id: uuid.UUID` that today determines both the FK and the hierarchy_path parent | Per 16.1 AC3/16.2, creation moves to `POST /clients/{id}/locations` (client_id-keyed); the Study-facing `study_id` field on `LocationRead` should become "the Studies this Location is associated with" (a list) or be dropped from `LocationRead` entirely in favor of a separate association lookup — decide which in 16.1, since 16.2's UI depends on it. |

Items 3, 4, and 5 are the ones this review adds beyond the correct-course proposal's own
analysis — they were named categorically ("fan-out logic," "audit hierarchy_path recording,"
"access-grant scope checks") but not resolved to a concrete required behavior. Recommend these
three become **explicit, individually-testable ACs on Story 16.1** (not left to implementer
discretion during `dev-story`), because each involves a real behavior/semantics decision, not
just a mechanical query rewrite.

## 4. Sequencing recommendation

The correct-course proposal already isolates 16.1 correctly (schema-only, no UI). One addition:
recommend Story 16.1's scope explicitly **include** items 3–5 above (the mismatch-error
semantics, fan-out child path tagging, and Study-scoped grant containment), even though they
touch `invocations.py`/`execution_service.py`/`access_service.py` rather than pure
`hierarchy_service.py` schema code — because none of Stories 16.2–16.6 touch this territory, and
deferring these three to "some later story" risks them being silently missed (they're not listed
in any other story's ACs either). If capacity requires splitting, they should split into a
**16.1b**, sequenced immediately after 16.1a (schema+backfill) and still before 16.2–16.6 — not
folded into a UI story where they'd be easy to overlook in review.

## 5. Testing requirement (reaffirming, not changing, the proposal)

The proposal already correctly flags this as needing a realistic pre-migration dataset, not an
empty-table test. Reaffirming: the test suite must seed at least one Study with an existing
Location (the pre-migration shape), run the migration, and assert — (a) `client_id` backfilled
correctly via the 3-hop join, (b) `hierarchy_path` re-rooted under the correct Client, (c) the
`study_location_association` row exists linking back to the original Study, (d) a Study-scoped
`UserAccessGrant` created *before* the migration still resolves that Location as in-scope *after*
the migration (this is the regression test for Section 3, item 5 — the one most likely to be
skipped since it requires seeding a grant, not just a Location).

## 6. Summary for `create-story`

- Schema/migration shape: **approved as proposed**, follow `0020`'s backfill-via-join precedent.
- `study_location_association`: **plain join table**, not `SkillAttachment`'s polymorphic shape.
- Story 16.1 needs three additional explicit ACs beyond the correct-course draft: (a) mismatch
  error becomes an existence check with product-approved copy/behavior, (b) fan-out child job
  `hierarchy_path` tags with the Study's path, not the Location's, (c) Study-scoped
  `UserAccessGrant` containment for Locations is repaired via an explicit
  `study_location_association` join, not left to ltree containment alone — with a regression
  test proving a pre-existing Study-scoped grant still resolves correctly post-migration.
