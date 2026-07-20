# Sprint Change Proposal — Engagement Hierarchy, Skill Attachment & Ingest Model Refinement

**Date:** 2026-07-20
**Trigger:** Direct stakeholder request — five workflow-friction items observed using the shipped Engagements/Skill Attachment/Run Console screens.
**Prepared via:** correct-course workflow (batch mode)

---

## 1. Issue Summary

Real usage of the shipped platform surfaced five distinct friction points, all rooted in how deeply the current hierarchy/attachment/ingest model requires re-doing work that's actually shared at a higher level:

1. **Locations are re-created per Study.** Today `Location.study_id` is a hard, required FK (`app/models/hierarchy.py:143-174`) — a Location belongs to exactly one Study, with no way to reuse a site across multiple Studies for the same Client. In practice, the same physical sites (hospitals, clinics) run across many Studies for a given Client, so users are forced to re-enter the same postal code, address, and PI name every time a new Study needs that site.

2. **Skill attachment stops at Project/Study.** `SkillAttachment` (`app/models/skill_attachment.py:28-65`) only recognizes `node_type ∈ {project, study}` — there's no way to say "this skill is available anywhere under this Client." An admin must re-attach the same skill to every Project and every Study individually.

3. **Documents are only ever uploaded at invocation time.** `FileReference` (`app/models/file_ref.py:38-108`) has zero hierarchy-node attachment — every invocation re-uploads the protocol document, even when it's the same protocol used across many runs within the same Study.

4. **Engagement screens are cluttered with inline action buttons.** `EngagementsScreen.tsx`'s `DetailActions`/`ChildListCard` render every action (Edit, Delete, Add Location, Add Study, per-skill Run, attach controls) as separate always-visible buttons — a Study card alone can show 5+ buttons. There is no `Menu`/`Dropdown` component anywhere in this codebase to consolidate them.

5. **No visibility into where a skill's outputs live.** Outputs are only visible via the global Jobs History list or the immediate Run Console result — a Project or Study detail screen shows zero history of what's been run there, even though the ltree-scoped query plumbing to support this already exists and is proven elsewhere (`job_service.list_jobs`'s `hierarchy_path <@ ANY(...)` filter, `jobs.py:100`).

**Discovery context:** Not a defect in any shipped story — every item above matches its epic's ACs exactly as built. This is a product refinement based on how the shipped model behaves in real use, the same category of change as Epic 14 (adapter-on-upgrade) and Epic 15 (cost tracking) before it.

---

## 2. Impact Analysis

### Epic Impact

- **Epic 4 (Engagement Hierarchy Management) — stays `done`, directly amended.** FR-ORG-03 ("Locations are children of Studies") is **superseded**, not merely extended — Locations become children of Clients, with a new Study↔Location association concept replacing the direct parent relationship. Stories 4.1/4.3's shipped ACs described the old model correctly at the time; this correct-course changes the model itself.
- **Epic 8 (Access Control & Client Portal) — stays `done`, Story 8.6 amended.** Client-level skill attachment is new scope Story 8.6 never had. The existing scope-match invariant (skill `scope` must equal the `node_type` it's attached to) is **relaxed for Client attachment specifically** — attaching at Client level makes a project-scoped skill available at every Project under that Client, and a study-scoped skill available at every Study under that Client. The skill's own `scope` field continues to mean exactly what it always meant — "at what granularity this skill runs" — attachment only ever decides *where in the tree it becomes reachable from*.
- **Epic 3 (Skill Execution Engine) — stays `done`, Story 3.2 extended.** A new ingest path (Study-creation-time) is added alongside the existing invocation-time path; neither is removed.
- **Epic 5 (Run Console & Invocation UX) — stays `done`, extended.** Run Console's document-upload UI becomes conditional on what a skill declares it needs beyond the Study's protocol.
- **No epic becomes obsolete.** All four affected epics remain `done`; this is forward-amending scope exactly like Epic 14 (amended Epic 11) and Epic 15 (amended Epic 9).
- **New epic required: Epic 16** (next available number).

### Story Impact

Six new stories (detailed in Section 4). No existing story's acceptance criteria are rewritten — Epic 4/8's original stories remain historically accurate for what was built at the time; this epic supersedes specific FRs going forward, the same pattern used for Epic 14/15's FR amendments.

### Artifact Conflicts

- **PRD amendments required (the most of any correct-course so far):**
  - **FR-ORG-03 is superseded**, not extended: "Locations are children of Studies" becomes "Locations are children of Clients; Studies associate existing Client Locations."
  - **FR-LOC-06** (postal code) is unaffected in substance but its "child of Study" framing needs updating.
  - **FR-REG-04** (skill scope) needs a clarifying amendment: scope has always meant *invocation granularity*, never *attachment eligibility* — this correct-course makes that explicit for the first time now that Client-level attachment exists.
  - **FR-INV-09** (Project-attached skills visible at Study level) extends to three tiers: Client → Project → Study.
  - **New FR** needed for Study-creation-time document upload + skill-declares-additional-needs.
  - **New FR** needed for hierarchy-scoped output visibility (Project/Study "Recent Runs").

- **Architecture / data model — the heaviest lift in this proposal:**
  - **Location table restructure.** `Location.study_id` (`hierarchy.py:147`, `NOT NULL` FK) must become `client_id` (`NOT NULL` FK), and a new `study_location_association` join table takes over the "used in this Study" relationship. This is a genuine data migration, not an additive-nullable-column pattern — **every existing Location row has a real, in-use `study_id` today** that must be translated into (a) a `client_id` derived by walking `study_id → project_id → client_id`, and (b) a new association row linking the original Study back to that Location, so existing engagements keep working with zero behavior change post-migration. This is meaningfully riskier than any migration since Epic 8's original hierarchy build — **recommend this be its own isolated story, executed and verified before anything else in this epic touches Location**.
  - **`hierarchy_path` reconstruction.** Location's ltree path is currently 100% derived from its parent Study's path (`hierarchy_service.py:707-752`: `f"{study.hierarchy_path}.{location_segment}"`). Once Location is Client-owned, its canonical path must derive from `Client.hierarchy_path` instead — but every downstream consumer that assumed "Location path implies its Study" (fan-out location-dependent skill logic, audit hierarchy_path recording, access-grant scope checks) needs to be re-examined against the new shape, since a Location's path can no longer be assumed to encode which Study it's being used in for a given invocation (that's now context supplied by the association, not derivable from the path alone).
  - **Reused precedent, lower risk:** the Study↔Location association reuses the exact polymorphic/join pattern `SkillAttachment` and `UserAccessGrant` already established (per the codebase's own Rule-of-Three ADR, documented in `skill_attachment.py:4`) — this is a proven pattern in this codebase, not a novel one.
  - **`SkillAttachment._VALID_NODE_TYPES`** (`skill_attachment_service.py:30`) gets `"client"` added — a small, low-risk change. The bigger change is **unifying the availability-resolution algorithm**, which today is split awkwardly: the client-portal backend (`list_client_skills`, `skill_attachment_service.py:274-353`) resolves granted Project/Study node IDs directly with no walk-up, while the **internal admin FE does its own manual two-query walk-up** (`StudyDetail` calling both `useProjectSkills` and `useStudySkills` and rendering two separate cards, `EngagementsScreen.tsx:991-992`). Adding a third tier (Client) as *another* manual FE walk-up would compound an already-awkward pattern. **Recommend moving the walk-up resolution server-side** as part of this story — one backend endpoint that returns "all skills available at this Study" already resolved across Client→Project→Study, replacing both the client-portal's flat lookup and the internal FE's two-query pattern with a single, consistent algorithm.
  - **New `study_location_association` join table** — reuses the polymorphic pattern; low risk, well-precedented.
  - **New file↔hierarchy-node join table** for Study-creation-time documents — `FileReference` has zero hierarchy attachment today (confirmed: no `study_id`, no polymorphic columns, nothing); this is genuinely new, not an extension. Given the existing "a file may feed multiple invocations" design intent already in the `FileReference` docstring, a join table (not a direct FK) is the right shape — consistent with the Location precedent above.
  - **New `?project_id`/`?study_id` query param on `GET /jobs`** — small, low-risk, reuses the exact `hierarchy_path <@ ANY(...)` pattern already proven in four other places in this codebase (`hierarchy_service.list_projects/list_studies/list_locations`, `skill_attachment_service.list_client_skills`).

- **UI/UX:**
  - **First `Menu`/`Dropdown` shared component in this codebase** — confirmed none exists (`shared/components/` has no menu/dropdown). This is real net-new design-system work, not a refactor of something existing, and should be built once as a shared primitive, not a one-off for Engagements.
  - Study-creation modal (currently the generic `EntityModal`, name+description only, `EngagementsScreen.tsx` mode `add-study`) gains an optional protocol-upload step, plus a separate "add protocol later" path for existing protocol-less Studies (per your confirmed decision — no backfill requirement, existing Studies just start empty and can have a protocol attached after the fact via Study edit).
  - Run Console's document-upload UI (`DocumentUploadCard.tsx`) becomes conditional — hidden/optional when a skill's declared needs are already met by the Study's protocol, still available when a skill needs more.
  - New "Recent Runs" panel on Project/Study detail screens — genuinely net new, no existing partial component to extend.

- **Other artifacts:** No IaC/CI impact. `docs/api-spec.json` regeneration needed (new/changed routes). Testing: this is the first correct-course requiring integration tests that specifically prove **existing** engagements/locations still work correctly after a real data migration, not just tests of new capability.

### Technical Impact Summary

This is the largest single correct-course of the project by migration risk. The Location restructure is a genuine data migration (translate every real row, not just add nullable columns) and touches ltree path derivation, which several other subsystems depend on implicitly. Everything else (Client-level attachment, Study-creation ingest, action-menu consolidation, hierarchy-scoped run history) is lower-risk and reuses proven patterns already in this codebase. Recommend the epic isolate the Location migration as its own first story, fully shipped and verified, before any other story in the epic touches Location-adjacent code.

---

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment (new Epic 16).**

- **Rollback:** Not viable — nothing is broken; every item is a refinement of correctly-shipped behavior.
- **MVP Review:** Not viable/not needed — this doesn't reduce or redefine MVP scope, it refines the shipped model based on real use.
- **Direct Adjustment:** Viable and recommended.
  - **Effort: Medium-High** — larger than Epic 14 or 15 individually. The Location migration alone is comparable in weight to Epic 8's original hierarchy build; everything else is small-to-medium and well-precedented.
  - **Risk: Medium**, concentrated entirely in the Location migration (real-data translation, ltree path re-derivation, and auditing every downstream consumer that implicitly assumed "Location's path encodes its Study"). Every other story reuses an already-proven pattern in this exact codebase.
  - **Timeline:** Additive; recommend sequencing after Epic 15 (in `backlog`, not yet started) or interleaved — no technical dependency either way, purely a capacity/sequencing call for whoever picks up `create-story` next.

---

## 4. Detailed Change Proposals

### 4.1 PRD Amendments

**File:** `_bmad-output/planning-artifacts/epics/requirements-inventory.md`

**FR-ORG-03 — superseded:**

> **OLD:** FR-ORG-03 [P1]: Locations are children of Studies. A Study can have zero or more Locations.
>
> **NEW:** FR-ORG-03 [P1]: **(Superseded 2026-07-20, Epic 16.)** Locations are children of Clients — created once per Client and reused across every Project/Study underneath it. A Study associates zero or more existing Client Locations (rather than owning distinct Location rows); the same physical site is entered once and reused, never re-created per Study.

**FR-REG-04 — clarifying amendment:**

> **OLD:** FR-REG-04 [P1]: Skills have an optional scope: Project-level or Study-level. Study-scoped skills are only invocable within the context of their Study.
>
> **NEW:** FR-REG-04 [P1]: Skills have an optional scope: Project-level or Study-level, determining the **granularity at which the skill runs** — a Project-scoped skill runs in a Project's context, a Study-scoped skill runs in a Study's context. **(Clarified 2026-07-20, Epic 16.)** Scope is independent of *where a skill is attached* — attachment (FR-REG-new below) only controls which part of the hierarchy a skill is reachable from; the skill's own scope alone determines where underneath that point it is actually invocable.

**FR-INV-09 — extended:**

> **OLD:** FR-INV-09 [P1]: Skills attached at the Project level are visible and runnable from both the Project screen and from within each Study screen under that Project.
>
> **NEW:** FR-INV-09 [P1]: Skills attached at the Client level are visible and runnable at every Project (if Project-scoped) or every Study (if Study-scoped) under that Client. Skills attached at the Project level are visible and runnable from both the Project screen and from within each Study screen under that Project. **(Extended 2026-07-20, Epic 16.)**

**New FRs:**

> FR-REG-10 [P1]: **(Added 2026-07-20, Epic 16.)** A skill may be attached at the Client level. A Client-attached skill becomes available at every node under that Client matching the skill's own scope (every Project if Project-scoped, every Study if Study-scoped) — without being re-attached individually at each one.
>
> FR-ING-05 [P1]: **(Added 2026-07-20, Epic 16.)** A protocol document may be uploaded once, at Study creation (or added later via Study edit for Studies that predate this capability), and is automatically available to skills run within that Study — without re-uploading at every invocation. A skill may declare that it needs documents beyond the Study's protocol; the Run Console upload affordance remains available for that case, and is otherwise optional.
>
> FR-USE-08 [P1]: **(Added 2026-07-20, Epic 16.)** A Project or Study detail screen surfaces the outputs of skills that were run in that context (a hierarchy-scoped view of recent invocations), not only the global Jobs History list.

**Rationale:** FR-ORG-03's supersession is marked explicitly (not silently rewritten) because it's a genuine breaking change to a shipped requirement, following the same "mark superseded, don't silently rewrite" discipline established for FR-SEC-08 (Epic 13) and Story 5.5.1 (Epic 14).

### 4.2 New Epic — Epic 16: Engagement Hierarchy, Attachment & Ingest Model Refinement

**File:** `_bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md` (new)

```markdown
# Epic 16: Engagement Hierarchy, Attachment & Ingest Model Refinement

> **Created 2026-07-20** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-20-engagement-model-refinement.md`).
> Trigger: direct stakeholder feedback on five real usage-friction points in the shipped Engagements/Skill
> Attachment/Run Console screens — Locations re-created per Study, skill attachment too granular, documents
> re-uploaded every run, cluttered engagement-screen action buttons, and no hierarchy-level visibility into
> where a skill's outputs live.
> **Epics 3, 4, 5, and 8 all stay `done`** — every affected epic's original ACs described the shipped model
> correctly at the time; this epic supersedes/amends specific FRs going forward, the same pattern Epic 14
> used on Epic 11 and Epic 15 used on Epic 9.

Locations are owned by the Client and reused across every Project/Study underneath it. Skills can be attached
once at the Client level and become available everywhere underneath that matches their own scope. A Study's
protocol document is captured once at Study creation and reused automatically by every skill run within it.
Engagement screens consolidate their scattered action buttons into a single menu per card. Project and Study
detail screens show the outputs of skills run in that context.

**FRs covered:** FR-ORG-03 (superseded), FR-REG-04 (clarified), FR-INV-09 (extended), FR-REG-10 (new),
FR-ING-05 (new), FR-USE-08 (new).

**Sequencing:** The Location data migration (16.1) is the risk-bearing story and must land — and be verified
against real existing engagement data — before any other story touches Location-adjacent code. 16.2-16.5 are
independent of each other once 16.1 lands. No technical dependency on Epic 14/15; sequencing relative to
Epic 15 is a capacity call, not an architectural one.

---

## Story 16.1: Move Locations to Client Ownership (Data Migration)

As a Vitalief consultant,
I want Locations to belong to the Client rather than to a single Study,
So that the same physical site doesn't need to be re-entered every time a new Study needs it.

**Context (from investigation):** `Location.study_id` (`app/models/hierarchy.py:147`) is a hard, required FK
today — no join table, no polymorphic pattern. Every Location's `hierarchy_path` is 100% derived from its
parent Study's path (`hierarchy_service.py:707-752`: `f"{study.hierarchy_path}.{location_segment}"`). This
story restructures the FK to `client_id` and introduces a new `study_location_association` join table
(reusing the exact polymorphic pattern already proven by `SkillAttachment`/`UserAccessGrant` — this
codebase's own documented Rule-of-Three precedent) to carry the "used in this Study" relationship the direct
FK used to encode.

**Acceptance Criteria:**

1. **AC1 — Location becomes Client-owned.** `Location.study_id` (`NOT NULL` FK) is replaced with
   `Location.client_id` (`NOT NULL` FK to `clients.id`). Every Location's `hierarchy_path` is rebuilt to
   derive from `Client.hierarchy_path` instead of a Study's path.

2. **AC2 — Real data is translated, not dropped.** A migration walks every existing Location's current
   `study_id → project_id → client_id` chain to populate the new `client_id`, and inserts a
   `study_location_association` row linking the Location back to its original Study — so every existing
   engagement's Location assignments are preserved exactly as they were, with zero behavior change from a
   user's perspective post-migration. This is NOT an additive-nullable-column migration (unlike prior
   correct-course migrations) — it is a real translation of live, in-use data, and must be tested against a
   realistic pre-migration dataset, not just an empty table.

3. **AC3 — Studies associate, they don't own.** `POST /api/v1/studies/{id}/locations` (or equivalent) lets a
   user pick from the Client's existing Locations and create an association row — no new Location entity is
   created by this action. A NEW `POST /api/v1/clients/{id}/locations` route (mirroring the existing
   Location-creation shape) is where a Location is actually created, once, at the Client.

4. **AC4 — Downstream consumers are re-verified, not assumed safe.** Every place that implicitly relied on
   "a Location's hierarchy_path encodes which Study it's being used in for a given invocation" (fan-out
   location-dependent skill logic, audit hierarchy_path recording at invocation time, access-grant scope
   checks) is audited against the new shape and confirmed to still resolve the correct Study context via the
   association (or the invocation's own context), not via the Location's own path alone.

5. **AC5 — `GET` locations for a Client exists.** A new "list Locations for a Client" query is added
   (no equivalent exists today — confirmed: only `GET /locations?study_id=` exists) so the Client-level
   Location-management UI (Story 16.2) has something to query against.

**Out of scope:** Any UI change (Story 16.2). Client-level skill attachment (16.3). Do not combine this
migration with any other schema change in the epic — it should be isolated, shipped, and verified alone.

---

## Story 16.2: Client-Level Location Management + Study Association UI

_Depends on: Story 16.1._

As a Vitalief consultant,
I want to add Locations once at the Client level and simply associate existing ones when I set up a Study,
So that I never have to re-enter the same site's address, postal code, and PI name for every new Study.

**Acceptance Criteria:**

1. **AC1 — Add Location moves to the Client screen.** The Client detail view gains an "Add Location" action
   (name, address, city, postal code required, PI name) creating a Location owned by that Client.

2. **AC2 — Study associates, doesn't create.** The Study detail view's "Add Location" affordance becomes
   "Associate Location" — a picker over the Client's existing Locations (from Story 16.1's new list-by-client
   query), not a creation form. The postal-code-required validation from the original creation form still
   applies at Client-level creation (Story 16.2 AC1), not at association time (nothing to validate — the
   Location already exists).

3. **AC2 — Removing an association doesn't delete the Location.** Removing a Study's association to a
   Location only removes that association row; the Location itself, and any other Study's association to it,
   is untouched.

4. **AC3 — Existing engagements are unaffected.** Every Study that had Locations before this story ships
   still shows exactly those same Locations (now via association, per 16.1's migration) — no re-work
   required from users for engagements that predate this story.

**Out of scope:** The Location data migration itself (16.1, already done by the time this runs). Action-menu
consolidation (16.5) — this story's new "Associate Location" affordance may temporarily add to the button
count that 16.5 later consolidates; do not attempt to solve both in one story.

---

## Story 16.3: Client-Level Skill Attachment

_Depends on: Story 16.1 only insofar as it touches the same Engagements screens; no schema dependency._

As an admin or MA Tech consultant,
I want to attach a skill once at the Client level and have it become available everywhere under that Client
matching its own scope,
So that I don't have to re-attach the same skill to every Project and every Study individually.

**Acceptance Criteria:**

1. **AC1 — `SkillAttachment` accepts `node_type="client"`.** `_VALID_NODE_TYPES`
   (`skill_attachment_service.py:30`) is extended to include `"client"`; the existing
   scope-must-equal-node_type validation (`attach_skill`, lines 106-107) is **removed entirely** — a skill's
   `scope` field determines only where under an attachment point it's invocable, never whether the
   attachment itself is legal. This applies uniformly, including to the pre-existing Project/Study
   attachment paths (simplifying, not just extending, the existing check).

2. **AC2 — Client-attached skills resolve at every matching descendant.** A Project-scoped skill attached at
   Client level is available at every Project under that Client. A Study-scoped skill attached at Client
   level is available at every Study under that Client. No re-attachment at the Project/Study level is
   needed.

3. **AC3 — Availability resolution moves server-side (unifying two existing divergent implementations).**
   Today, client-portal skill discovery (`list_client_skills`, `skill_attachment_service.py:274-353`) resolves
   availability with no walk-up at all, while the internal admin FE (`StudyDetail`,
   `EngagementsScreen.tsx:991-992`) does its own manual two-query walk-up (Project + Study) rendered as two
   separate UI cards. This story replaces BOTH with a single backend resolution (Client → Project → Study)
   that both the client-portal API and the internal admin FE consume — a third tier bolted onto the existing
   FE-side manual walk-up would compound an already-awkward pattern rather than fix it.

4. **AC4 — Attach/detach UI on the Client screen.** The Client detail view gains the same attach/detach
   controls Project/Study screens already have (`NodeSkillAttachControls` — reuse, don't rebuild), gated by
   the same grantor roles (`admin`/`ma_tech`) established in Story 8.7.

5. **AC5 — New `/clients/{id}/skills` routes.** Mirror the existing six Project/Study attach/list/detach
   routes (`hierarchy.py:541-704`) for Client, reusing the same service functions with `node_type="client"`.

**Out of scope:** Any change to how a skill's own `scope` field is set or displayed — this story only changes
what's legal to attach where, never what scope means.

---

## Story 16.4: Study-Creation-Time Protocol Upload

_Depends on: Story 16.1 (Study creation UI lives on the same screens); no schema dependency on Location._

As a Vitalief consultant,
I want to upload a Study's protocol document once when I create the Study,
So that I don't have to re-upload the same document every time I run a skill against that Study.

**Acceptance Criteria:**

1. **AC1 — Study creation gains an optional protocol upload.** The Study-creation modal (today the generic
   `EntityModal`, name+description only) gains an optional document-upload step reusing the existing
   presign→confirm ingest flow (`DocumentUploadCard.tsx`, `POST /ingest/presign` + `/confirm`) — no new
   upload mechanism invented.

2. **AC2 — A new join table attaches the file to the Study.** `FileReference` has zero hierarchy-node
   attachment today (confirmed: no `study_id`, no polymorphic columns). A new join table (mirroring the
   Location/SkillAttachment polymorphic precedent, consistent with `FileReference`'s existing "may feed
   multiple invocations" design intent) links a `file_reference` to the Study it was uploaded for.

3. **AC3 — Existing Studies can add a protocol later.** A Study that predates this story (or was created
   without a protocol) can have one attached afterward via Study edit — no requirement that protocol-less
   Studies become unusable; per the confirmed decision, no backfill migration is needed, existing Studies
   simply start with no protocol until one is added.

4. **AC4 — Skills consume the Study's protocol automatically.** When a skill is run within a Study that has
   an attached protocol, that document is injected as context automatically — the invoker does not need to
   re-select or re-upload it.

5. **AC5 — Run Console upload becomes conditional, not removed.** If a skill declares (via a new flag —
   confirmed gap: no such flag exists today, only the free-form `input_schema` JSON) that it needs documents
   beyond the Study's protocol, the existing Run Console upload affordance (`DocumentUploadCard.tsx`) remains
   available for that additional document. If a skill needs nothing beyond the protocol, the upload
   affordance is hidden/skipped entirely.

**Out of scope:** Any change to the underlying ingest pipeline (`ingest_service.py`, MIME validation, S3
storage) — this story only changes WHEN and WHERE the upload happens, never HOW.

---

## Story 16.5: Consolidate Engagement-Screen Actions into a Single Menu

_Independent — no dependency on 16.1-16.4, though it will visually incorporate whatever new actions those
stories add (Associate Location, Client-level attach) once they land._

As a Vitalief consultant,
I want each Client/Project/Study/Location card to expose its actions through a single menu instead of a row
of separate buttons,
So that engagement screens are legible instead of cluttered.

**Acceptance Criteria:**

1. **AC1 — A shared `Menu`/dropdown component is introduced.** Confirmed: none exists anywhere in
   `shared/components/` today. Build one reusable primitive (not an Engagements-only one-off) following this
   codebase's existing shared-component conventions.

2. **AC2 — Every per-entity action consolidates into that menu.** `DetailActions` (Edit/Delete) and the
   entity-specific actions (Add Study, Add Location→Associate Location per 16.2, attach controls per 16.3)
   collapse into a single "⋯" menu per card/detail header, replacing the current always-visible button rows.

3. **AC3 — "Run" stays a primary, visible action per skill row.** The consolidation applies to
   entity-management actions (edit/delete/add/associate/attach) — the "Run" button on each attached skill row
   is a distinct, frequent, primary action and stays directly visible, not buried in a menu.

4. **AC4 — No functional regression.** Every action available today remains reachable — this is a pure UI
   consolidation, not a scope change to what any role can do.

**Out of scope:** Any change to WHAT actions exist or WHO can perform them (that's 16.2/16.3/8.7's territory)
— this story only changes HOW they're presented.

---

## Story 16.6: Hierarchy-Scoped Run History on Project/Study Screens

_Independent — no dependency on 16.1-16.5._

As a Vitalief consultant,
I want to see the outputs of skills that were run in a Project or Study directly on that entity's screen,
So that I don't have to search the global Jobs History to find what's already been run there.

**Acceptance Criteria:**

1. **AC1 — `GET /api/v1/jobs` accepts a hierarchy filter.** A new `project_id`/`study_id` (or
   `hierarchy_path`) query param is added, reusing the exact `hierarchy_path <@ ANY(...)` pattern already
   proven in `job_service.list_jobs` and three other places in this codebase — a small, low-risk addition to
   an existing, well-understood query.

2. **AC2 — Project and Study detail screens show a "Recent Runs" panel.** A new panel (genuinely net new —
   no existing partial component to extend) lists recent invocations scoped to that entity, with outcome,
   skill name, timestamp, and a link to the full result — reusing existing Jobs History row-rendering
   patterns where possible rather than inventing new ones.

3. **AC3 — Respects existing hierarchy-scope access control.** The new filtered query is subject to the same
   `hierarchy_scope` dependency every other hierarchy-scoped route already uses — no new access-control
   surface, no bypass.

**Out of scope:** Any change to Jobs History itself, which remains the global, unfiltered view.
```

---

## 5. Implementation Handoff

**Scope classification: Moderate-to-Major**, split by story:

- **Story 16.1 (Location migration) leans Major** in isolation — a real-data schema migration with
  downstream-consumer re-verification is exactly the class of change that benefits from an architect's eyes
  on the migration plan before `dev-story` picks it up, even though the epic as a whole doesn't need a full
  PM/Architect replan.
- **Stories 16.2-16.6 are Moderate** — each reuses an already-proven pattern in this codebase (polymorphic
  join tables, ltree containment queries, existing ingest flow) and fits the standard `create-story` →
  `dev-story` → `code-review` pipeline without new architectural invention.

**Routed to:**
- **Solution Architect (or a dedicated architecture review) for Story 16.1 specifically** — the Location
  migration's rollback plan and downstream-consumer audit list should be reviewed before implementation
  starts, given it's the riskiest single migration since Epic 8's original hierarchy build.
- **Product Owner / Developer** for Stories 16.2-16.6, via the standard pipeline.

**Responsibilities:**
- **Architect/reviewer:** confirm Story 16.1's migration plan (the `study_id → project_id → client_id` walk,
  the `hierarchy_path` re-derivation, and the explicit list of downstream consumers to re-verify) before
  `create-story` details it further.
- **PO/story-author (`create-story`):** expand each of the six stories to full implementation detail — Story
  16.1 first and in isolation; 16.2-16.6 in any order once 16.1 lands.
- **Developer (`dev-story`):** implement Story 16.1 alone first, verify it fully (including against a
  realistic pre-migration dataset, not an empty table) before starting any other story in this epic.
- **Code review:** standard 3-layer adversarial review, with particular attention on Story 16.1's data
  migration correctness and Story 16.3's removal of the scope==node_type invariant (confirm it doesn't
  silently permit an invalid state elsewhere).

**Success criteria:** Every existing engagement's Locations and Studies work identically post-migration with
zero user-visible disruption; a Client-level Location or skill attachment, once created, requires zero
re-entry at any Project/Study underneath; a Study's protocol is captured once and consumed automatically;
engagement-screen actions live in one menu per card; and a Project/Study screen shows what's been run there.

---

## Sprint Status Update (pending approval)

Add to `_bmad-output/implementation-artifacts/sprint-status.yaml`:

```yaml
  # ─────────────────────────────────────────────────────────
  # Epic 16: Engagement Hierarchy, Attachment & Ingest Model Refinement
  #   Added 2026-07-20 via correct-course (sprint-change-proposal-2026-07-20-engagement-model-refinement.md).
  #   Trigger: real-usage friction — Locations re-created per Study, skill attachment stops at Project/Study,
  #   documents re-uploaded every invocation, cluttered engagement-screen buttons, no hierarchy-level run
  #   visibility. Epics 3/4/5/8 all stay done — this epic supersedes/amends FR-ORG-03, FR-REG-04, FR-INV-09
  #   and adds FR-REG-10/FR-ING-05/FR-USE-08.
  #   Dev order: 16-1 (Location data migration, ISOLATED and risk-bearing — architect review recommended
  #   before create-story) → 16-2/16-3/16-4/16-5/16-6 (all independent of each other once 16-1 lands).
  # ─────────────────────────────────────────────────────────
  epic-16: backlog
  16-1-move-locations-to-client-ownership: backlog
  16-2-client-level-location-management-and-study-association-ui: backlog
  16-3-client-level-skill-attachment: backlog
  16-4-study-creation-time-protocol-upload: backlog
  16-5-consolidate-engagement-screen-actions-into-single-menu: backlog
  16-6-hierarchy-scoped-run-history-on-project-study-screens: backlog
```
