# Epic 16: Engagement Hierarchy, Attachment & Ingest Model Refinement

> **Created 2026-07-20** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-20-engagement-model-refinement.md`). Trigger: direct stakeholder feedback on five real usage-friction points in the shipped Engagements/Skill Attachment/Run Console screens — Locations re-created per Study, skill attachment too granular, documents re-uploaded every run, cluttered engagement-screen action buttons, and no hierarchy-level visibility into where a skill's outputs live. **Epics 3, 4, 5, and 8 all stay `done`** — every affected epic's original ACs described the shipped model correctly at the time; this epic supersedes/amends specific FRs going forward, the same pattern Epic 14 used on Epic 11 and Epic 15 used on Epic 9.

Locations are owned by the Client and reused across every Project/Study underneath it. Skills can be attached once at the Client level and become available everywhere underneath that matches their own scope. A Study's protocol document is captured once at Study creation and reused automatically by every skill run within it. Engagement screens consolidate their scattered action buttons into a single menu per card. Project and Study detail screens show the outputs of skills run in that context.

**FRs covered:** FR-ORG-03 (superseded), FR-REG-04 (clarified), FR-INV-09 (extended), FR-REG-10 (new), FR-ING-05 (new), FR-USE-08 (new).

**Sequencing:** The Location data migration (16.1) is the risk-bearing story and must land — and be verified against real existing engagement data — before any other story touches Location-adjacent code. 16.2-16.6 are independent of each other once 16.1 lands. No technical dependency on Epic 14/15; sequencing relative to Epic 15 is a capacity call, not an architectural one.

---

## Story 16.1: Move Locations to Client Ownership (Data Migration)

As a Vitalief consultant,
I want Locations to belong to the Client rather than to a single Study,
So that the same physical site doesn't need to be re-entered every time a new Study needs it.

**Context (from investigation):** `Location.study_id` (`app/models/hierarchy.py:147`) is a hard, required FK today — no join table, no polymorphic pattern. Every Location's `hierarchy_path` is 100% derived from its parent Study's path (`hierarchy_service.py:707-752`: `f"{study.hierarchy_path}.{location_segment}"`). This story restructures the FK to `client_id` and introduces a new `study_location_association` join table (reusing the exact polymorphic pattern already proven by `SkillAttachment`/`UserAccessGrant` — this codebase's own documented Rule-of-Three precedent) to carry the "used in this Study" relationship the direct FK used to encode.

**Acceptance Criteria:**

1. **AC1 — Location becomes Client-owned.** `Location.study_id` (`NOT NULL` FK) is replaced with `Location.client_id` (`NOT NULL` FK to `clients.id`). Every Location's `hierarchy_path` is rebuilt to derive from `Client.hierarchy_path` instead of a Study's path.

2. **AC2 — Real data is translated, not dropped.** A migration walks every existing Location's current `study_id → project_id → client_id` chain to populate the new `client_id`, and inserts a `study_location_association` row linking the Location back to its original Study — so every existing engagement's Location assignments are preserved exactly as they were, with zero behavior change from a user's perspective post-migration. This is NOT an additive-nullable-column migration (unlike prior correct-course migrations) — it is a real translation of live, in-use data, and must be tested against a realistic pre-migration dataset, not just an empty table.

3. **AC3 — Studies associate, they don't own.** `POST /api/v1/studies/{id}/locations` (or equivalent) lets a user pick from the Client's existing Locations and create an association row — no new Location entity is created by this action. A NEW `POST /api/v1/clients/{id}/locations` route (mirroring the existing Location-creation shape) is where a Location is actually created, once, at the Client.

4. **AC4 — Downstream consumers are re-verified, not assumed safe.** Every place that implicitly relied on "a Location's hierarchy_path encodes which Study it's being used in for a given invocation" (fan-out location-dependent skill logic, audit hierarchy_path recording at invocation time, access-grant scope checks) is audited against the new shape and confirmed to still resolve the correct Study context via the association (or the invocation's own context), not via the Location's own path alone.

5. **AC5 — `GET` locations for a Client exists.** A new "list Locations for a Client" query is added (no equivalent exists today — confirmed: only `GET /locations?study_id=` exists) so the Client-level Location-management UI (Story 16.2) has something to query against.

**Notes:** No UI change (Story 16.2) or Client-level skill attachment (16.3) in scope here. Do not combine this migration with any other schema change in the epic — it should be isolated, shipped, and verified alone.

---

## Story 16.2: Client-Level Location Management + Study Association UI

_Depends on: Story 16.1._

As a Vitalief consultant,
I want to add Locations once at the Client level and simply associate existing ones when I set up a Study,
So that I never have to re-enter the same site's address, postal code, and PI name for every new Study.

**Acceptance Criteria:**

1. **AC1 — Add Location moves to the Client screen.** The Client detail view gains an "Add Location" action (name, address, city, postal code required, PI name) creating a Location owned by that Client.

2. **AC2 — Study associates, doesn't create.** The Study detail view's "Add Location" affordance becomes "Associate Location" — a picker over the Client's existing Locations (from Story 16.1's new list-by-client query), not a creation form. The postal-code-required validation from the original creation form still applies at Client-level creation (this story's AC1), not at association time (nothing to validate — the Location already exists).

3. **AC3 — Removing an association doesn't delete the Location.** Removing a Study's association to a Location only removes that association row; the Location itself, and any other Study's association to it, is untouched.

4. **AC4 — Existing engagements are unaffected.** Every Study that had Locations before this story ships still shows exactly those same Locations (now via association, per 16.1's migration) — no re-work required from users for engagements that predate this story.

**Notes:** The Location data migration itself (16.1) must already be done. Action-menu consolidation (16.5) may need to absorb this story's new "Associate Location" affordance later — do not attempt to solve both in one story.

---

## Story 16.3: Client-Level Skill Attachment

_Depends on: Story 16.1 only insofar as it touches the same Engagements screens; no schema dependency._

As an admin or MA Tech consultant,
I want to attach a skill once at the Client level and have it become available everywhere under that Client matching its own scope,
So that I don't have to re-attach the same skill to every Project and every Study individually.

**Acceptance Criteria:**

1. **AC1 — `SkillAttachment` accepts `node_type="client"`.** `_VALID_NODE_TYPES` (`skill_attachment_service.py:30`) is extended to include `"client"`; the existing scope-must-equal-node_type validation (`attach_skill`, lines 106-107) is **removed entirely** — a skill's `scope` field determines only where under an attachment point it's invocable, never whether the attachment itself is legal. This applies uniformly, including to the pre-existing Project/Study attachment paths (simplifying, not just extending, the existing check).

2. **AC2 — Client-attached skills resolve at every matching descendant.** A Project-scoped skill attached at Client level is available at every Project under that Client. A Study-scoped skill attached at Client level is available at every Study under that Client. No re-attachment at the Project/Study level is needed.

3. **AC3 — Availability resolution moves server-side (unifying two existing divergent implementations).** Today, client-portal skill discovery (`list_client_skills`, `skill_attachment_service.py:274-353`) resolves availability with no walk-up at all, while the internal admin FE (`StudyDetail`, `EngagementsScreen.tsx:991-992`) does its own manual two-query walk-up (Project + Study) rendered as two separate UI cards. This story replaces BOTH with a single backend resolution (Client → Project → Study) that both the client-portal API and the internal admin FE consume — a third tier bolted onto the existing FE-side manual walk-up would compound an already-awkward pattern rather than fix it.

4. **AC4 — Attach/detach UI on the Client screen.** The Client detail view gains the same attach/detach controls Project/Study screens already have (`NodeSkillAttachControls` — reuse, don't rebuild), gated by the same grantor roles (`admin`/`ma_tech`) established in Story 8.7.

5. **AC5 — New `/clients/{id}/skills` routes.** Mirror the existing six Project/Study attach/list/detach routes (`hierarchy.py:541-704`) for Client, reusing the same service functions with `node_type="client"`.

**Notes:** No change to how a skill's own `scope` field is set or displayed — this story only changes what's legal to attach where, never what scope means.

---

## Story 16.4: Study-Creation-Time Protocol Upload

_Depends on: Story 16.1 (Study creation UI lives on the same screens); no schema dependency on Location._

As a Vitalief consultant,
I want to upload a Study's protocol document once when I create the Study,
So that I don't have to re-upload the same document every time I run a skill against that Study.

**Acceptance Criteria:**

1. **AC1 — Study creation gains an optional protocol upload.** The Study-creation modal (today the generic `EntityModal`, name+description only) gains an optional document-upload step reusing the existing presign→confirm ingest flow (`DocumentUploadCard.tsx`, `POST /ingest/presign` + `/confirm`) — no new upload mechanism invented.

2. **AC2 — A new join table attaches the file to the Study.** `FileReference` has zero hierarchy-node attachment today (confirmed: no `study_id`, no polymorphic columns). A new join table (mirroring the Location/SkillAttachment polymorphic precedent, consistent with `FileReference`'s existing "may feed multiple invocations" design intent) links a `file_reference` to the Study it was uploaded for.

3. **AC3 — Existing Studies can add a protocol later.** A Study that predates this story (or was created without a protocol) can have one attached afterward via Study edit — no requirement that protocol-less Studies become unusable; per the confirmed decision, no backfill migration is needed, existing Studies simply start with no protocol until one is added.

4. **AC4 — Skills consume the Study's protocol automatically.** When a skill is run within a Study that has an attached protocol, that document is injected as context automatically — the invoker does not need to re-select or re-upload it.

5. **AC5 — Run Console upload becomes conditional, not removed.** If a skill declares (via a new flag — confirmed gap: no such flag exists today, only the free-form `input_schema` JSON) that it needs documents beyond the Study's protocol, the existing Run Console upload affordance (`DocumentUploadCard.tsx`) remains available for that additional document. If a skill needs nothing beyond the protocol, the upload affordance is hidden/skipped entirely.

**Notes:** No change to the underlying ingest pipeline (`ingest_service.py`, MIME validation, S3 storage) — this story only changes WHEN and WHERE the upload happens, never HOW.

---

## Story 16.5: Consolidate Engagement-Screen Actions into a Single Menu

_Independent — no dependency on 16.1-16.4, though it will visually incorporate whatever new actions those stories add (Associate Location, Client-level attach) once they land._

As a Vitalief consultant,
I want each Client/Project/Study/Location card to expose its actions through a single menu instead of a row of separate buttons,
So that engagement screens are legible instead of cluttered.

**Acceptance Criteria:**

1. **AC1 — A shared `Menu`/dropdown component is introduced.** Confirmed: none exists anywhere in `shared/components/` today. Build one reusable primitive (not an Engagements-only one-off) following this codebase's existing shared-component conventions.

2. **AC2 — Every per-entity action consolidates into that menu.** `DetailActions` (Edit/Delete) and the entity-specific actions (Add Study, Add Location→Associate Location per 16.2, attach controls per 16.3) collapse into a single "⋯" menu per card/detail header, replacing the current always-visible button rows.

3. **AC3 — "Run" stays a primary, visible action per skill row.** The consolidation applies to entity-management actions (edit/delete/add/associate/attach) — the "Run" button on each attached skill row is a distinct, frequent, primary action and stays directly visible, not buried in a menu.

4. **AC4 — No functional regression.** Every action available today remains reachable — this is a pure UI consolidation, not a scope change to what any role can do.

**Notes:** No change to WHAT actions exist or WHO can perform them (that's 16.2/16.3/8.7's territory) — this story only changes HOW they're presented.

---

## Story 16.6: Hierarchy-Scoped Run History on Project/Study Screens

_Independent — no dependency on 16.1-16.5._

As a Vitalief consultant,
I want to see the outputs of skills that were run in a Project or Study directly on that entity's screen,
So that I don't have to search the global Jobs History to find what's already been run there.

**Acceptance Criteria:**

1. **AC1 — `GET /api/v1/jobs` accepts a hierarchy filter.** A new `project_id`/`study_id` (or `hierarchy_path`) query param is added, reusing the exact `hierarchy_path <@ ANY(...)` pattern already proven in `job_service.list_jobs` and three other places in this codebase — a small, low-risk addition to an existing, well-understood query.

2. **AC2 — Project and Study detail screens show a "Recent Runs" panel.** A new panel (genuinely net new — no existing partial component to extend) lists recent invocations scoped to that entity, with outcome, skill name, timestamp, and a link to the full result — reusing existing Jobs History row-rendering patterns where possible rather than inventing new ones.

3. **AC3 — Respects existing hierarchy-scope access control.** The new filtered query is subject to the same `hierarchy_scope` dependency every other hierarchy-scoped route already uses — no new access-control surface, no bypass.

**Notes:** No change to Jobs History itself, which remains the global, unfiltered view.

---

## Story Sequencing & Dependencies

| Story | Depends on | Ship order | Weight |
|-------|-----------|-----------|--------|
| **16-1** Move Locations to Client ownership (migration) | — | 1st, isolated | Heavy (real-data migration + downstream re-verification) |
| **16-2** Client-level Location mgmt + Study association UI | **16-1** | 2nd (or parallel w/ 16-3/16-4/16-5/16-6) | Medium |
| **16-3** Client-level skill attachment | **16-1** (screen-only) | 2nd (or parallel) | Medium-Heavy (unifies two divergent resolution algorithms) |
| **16-4** Study-creation-time protocol upload | **16-1** (screen-only) | 2nd (or parallel) | Medium |
| **16-5** Consolidate engagement-screen actions into one menu | — | Any time, ideally after 16-2/16-3 land | Medium (first Menu component in the codebase) |
| **16-6** Hierarchy-scoped run history on Project/Study screens | — | Any time | Light-Medium |

**Recommended order:** 16-1 first and fully isolated — verified against realistic pre-migration data before anything else in this epic touches Location-adjacent code. 16-2 through 16-6 are independent of each other once 16-1 lands. Per `create-story` discipline, each story is expanded to full implementation detail one at a time when picked up — these epic-level ACs are the contract, not the implementation plan.
