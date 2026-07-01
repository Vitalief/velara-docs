# Sprint Change Proposal — Access Control Admin Surfaces & Client Provisioning

**Date:** 2026-07-01
**Author:** Developer (via correct-course)
**Status:** Proposed — awaiting approval
**Scope classification:** **Major** (new epic + PRD requirements) → routes to PM/Architect for the new epic; Moderate (2 story additions) for Epic 8.

---

## Section 1 — Issue Summary

**Trigger.** During the wind-down of Epic 8 (Access Control & Client Portal) — with stories 8.1, 8.2, 8.3 `done` and 8.4 `ready-for-dev` — a review found that three operational capabilities a working access-control product needs were never built:

1. **(a)** No internal **Access Control admin screen** — no UI for a Vitalief admin to view/create/revoke a client's access grants.
2. **(b)** No **client account provisioning** — no way to create a client's login identity (Cognito user) or invite them.
3. **(c)** No **skill-to-engagement assignment** — no way to attach specific skills to specific Clients/Projects/Studies.

**What the evidence shows (this is a scope gap, not defective execution).** A source audit of both the planning artifacts and the codebase confirms Epic 8's *written* stories delivered exactly what they specified — enforcement plumbing (8.1), the IP client-API surface (8.2), and the client portal shell (8.3) — but the epic's stories never included the internal admin surfaces, and one piece was a *documented deliberate deferral*:

| Gap | Built state (code evidence) | Planning-artifact promise |
|---|---|---|
| (a) Access Control screen | **MISSING.** Nav tab `access` → a `Placeholder` ("Access Control — Story 7.x") at `velara-web/src/routes/internal.tsx:102-105`. No `accessGrants.ts` API client, no component. The grant **API exists** (`POST /api/v1/access-grants`, `DELETE /{id}` — `access_grants.py`, consultant/ma_tech gated) but has **zero UI**. No `GET` list route. | Not in any 8.x story. `ACL-06` (self-service grant UI) is **P2 / Phase 2** (`5-functional-requirements.md:106`). |
| (b) Client provisioning | **MISSING.** No Cognito `AdminCreateUser`, no invite flow, no user-management screen. `create_grant` stores a `user_id` **string with no identity check** (`access_service.py:230-294`) — you can grant a user who cannot log in. Dev has 3 hard-coded seed users. | Not promised. `SEC-06` (`5-functional-requirements.md:193`) **assumes users pre-exist** in the auth provider ("Phase 1: username/password"). Genuinely **new scope**. |
| (c) Skill attachment | **MISSING.** No `project_skill`/`study_skill` join table, no migration (latest `0016`), no endpoint. FE `useProjectSkills(_projectId)` is a **mock that ignores `projectId`** and filters global skills by `scope==='project'` — comment: *"MOCK SEAM — backend skill-attachment is a later epic."* | **Explicitly deferred** (Story 8.4 Dev Notes: "a join table + assignment UI is a much larger lift and out of 8.4"). `INV-07` (P1) even states the context picker shows all nodes *"without filtering by skill attachment."* |

**Product decision (user, 2026-07-01).** Build all three now, despite (a)/(b) being unpromised and (c) being deferred:
- **(a)** Build the Access Control admin screen over the existing grant API.
- **(b)** **Full provisioning** — the platform creates the Cognito user + invite, not just grants.
- **(c)** **Real attachment model + UI** — a join table + assign/unassign, not the scope-heuristic.
- **Epic strategy:** (a) and (c) are **added to Epic 8**; (b) becomes its **own new epic** (distinct concern — needs Cognito-admin architecture + invite/email infra + user-management screens).

---

## Section 2 — Impact Analysis

### Epic Impact

- **Epic 8 (Access Control & Client Portal) — stays open, +2 stories.** 8.1–8.3 `done` and 8.4 `ready-for-dev` are unaffected (no rework). Two new stories added:
  - **8.5 — Access Control Screen (admin grant management UI).**
  - **8.6 — Skill Attachment Model & Assignment UI.**
- **NEW Epic 10 — Client User Provisioning.** Cognito admin user creation, invite flow, and internal user-management screens. Numbered **10** (Epic 10 is free — the label was briefly used in 2026-06-18 then renamed to 5.5; current epics are 1,2,3,4,5,5.5,6,7,8,9).

### Story Impact

- **8.4 (ready-for-dev) — dependency note, no rewrite required.** 8.4 defines client skill availability via the **scope-heuristic** (org skills of matching scope, gated by grant + visibility). Once 8.6 lands a real attachment model, 8.4's client discovery **should** filter by attachment instead. Two viable sequencings (see §3): ship 8.4 as-is then have 8.6 swap the query (8.4's `useClientSkills`/`GET /client/skills` become attachment-aware), **or** sequence 8.6 before 8.4 so 8.4 consumes attachments from the start. **Recommendation: 8.6 before 8.4** to avoid building the client discovery contract twice (the 8.4 story already flags the mock seam as the swap point).
- **No completed story is invalidated.** 8.1's grant API is the foundation 8.5 builds a UI over; 8.2's IP surface is untouched; 8.3's shell is untouched.

### Artifact Conflicts

- **PRD (`5-functional-requirements.md`):** ADD FRs — an admin grant-management UI (promote the *internal-admin* case now; ACL-06's engagement-lead self-service stays P2), a skill-attachment/assignment requirement (supersedes the INV-07 "no attachment filtering" Phase-1 stance), and a new user-provisioning FR group (net-new — SEC-06 currently assumes pre-existing users).
- **Architecture (`core-architectural-decisions.md`):** ADD decisions — (c) a `project_skill`/`study_skill` attachment model (schema + how it composes with `scope` and the grant scope filter); (b) Cognito **AdminCreateUser** integration (a new `AuthProvider`-adjacent admin capability), invite/temporary-password flow, and where user identities are managed. These are additive; no prior decision is reversed except the "attachment deferred" stance.
- **UX:** New screens — Access Control management (grant list + create/revoke), Skill Assignment (attach skills to a project/study), and (Epic 10) user creation/invite + user list. The `design/` mockups do not cover these admin surfaces; UX design is needed for all three (net-new).
- **`sprint-status.yaml`:** add `8-5`, `8-6` under Epic 8; add `epic-10` + its stories (backlog).

### Technical Impact

- **8.5 (Access Control UI):** mostly FE + **one small BE addition** — a `GET /api/v1/access-grants` **list** route (does not exist today; 8.1 skipped it as optional) so the screen can display current grants. New FE `api/accessGrants.ts` + a real `AccessControl` feature screen replacing the placeholder. No migration.
- **8.6 (Skill Attachment):** **new migration** (`project_skill`/`study_skill` join table or a single polymorphic `skill_attachment`), attach/unattach service + API, an internal assignment UI, and rewiring `useProjectSkills`/8.4's client skills query from the mock seam to real attachments. Medium-large.
- **Epic 10 (Provisioning):** new Cognito-admin integration (IAM perms for `cognito-idp:AdminCreateUser`, invite email/SES or Cognito-managed), a provisioning service + API, user-management screens, and org/role claim assignment. Largest; needs architecture design first. Interacts with the `DevAuthProvider` seam (a dev-mode provisioning path) so it stays testable offline.

---

## Section 3 — Recommended Approach

**Selected path: Option 1 (Direct Adjustment) + Option-4-style new epic — a hybrid.**

- **Direct adjustment for (a)+(c):** add 8.5 and 8.6 to Epic 8. Both extend already-built foundations (8.1 grant API; the skill registry + hierarchy), so they fit the existing plan without rollback.
- **New Epic 10 for (b):** client provisioning is a separable concern (identity lifecycle, invite/email infra, Cognito-admin IAM) that deserves its own architecture pass rather than being wedged into the access-control epic.

**Why not the alternatives.** *Rollback (Option 2):* nothing needs reverting — no completed work is wrong; rejected. *MVP reduction (Option 3):* the opposite of the ask — the user is expanding scope, not cutting it; rejected. *All three in Epic 8:* rejected in favor of splitting provisioning out, because it inflates Epic 8 with an unrelated concern and blocks its closure on the heaviest, least-required piece.

**Sequencing recommendation.**
1. **8.6 before 8.4** (build the attachment model, then have client discovery consume it) — avoids building the 8.4 client-skills contract twice. If you'd rather ship 8.4 sooner, the fallback is 8.4-as-mock then 8.6 swaps the query; the 8.4 story already marks the swap point.
2. **8.5** any time after 8.1 (independent; just needs the grant API + the new list route).
3. **Epic 10** after Epic 8 closes (or in parallel if capacity allows) — architecture design first.

**Effort / risk.** 8.5: **Low–Medium** effort, **Low** risk (UI over a stable API + one list route). 8.6: **Medium** effort, **Medium** risk (migration + contract change touching 8.4). Epic 10: **High** effort, **Medium–High** risk (external Cognito-admin + email infra + security surface). Timeline: Epic 8 closure slips by ~2 stories; Epic 10 is net-new capacity.

---

## Section 4 — Detailed Change Proposals

> Story bodies (full ACs, dev-context) are authored later via `create-story`. Below are the epic/PRD/status edits and the story stubs (goal + AC skeleton) that anchor them.

### 4.1 — Epic file: `planning-artifacts/epics/epic-8-access-control-client-portal.md`

**ADD after Story 8.4:**

```
## Story 8.5: Access Control Screen — Admin Grant Management

As a Vitalief consultant (internal admin),
I want a screen to view, create, and revoke client access grants across the engagement hierarchy,
So that I can manage who can access which Clients/Projects/Studies without calling the API by hand.

Acceptance Criteria:
- Given I open /internal/access, Then the placeholder is replaced by a real screen listing existing
  grants (user_id, node, node_type, role, granted_at) for my org — backed by a NEW
  GET /api/v1/access-grants list route (consultant/ma_tech gated).
- Given I create a grant (pick a user_id, a hierarchy node, node_type, role=client), When I submit,
  Then POST /api/v1/access-grants is called and the new grant appears in the list.
- Given I revoke a grant, When I confirm, Then DELETE /api/v1/access-grants/{id} is called and it
  disappears; the affected client's scope recalculates on their next request (no caching — 8.1 AC5).
- Given the grantee role is internal (ma_tech/consultant), Then the UI prevents it (create_grant already
  returns 422 INTERNAL_ROLE_NOT_GRANTABLE — surface it, don't crash).
- The screen is internal-only (RequireInternal), uses the response envelope + snake→camel mapping,
  and shows TanStack Query loading/error states.

## Story 8.6: Skill Attachment Model & Assignment UI

As a Vitalief consultant,
I want to attach specific skills to specific Projects and Studies (and see/remove those attachments),
So that a client's portal shows only the skills actually assigned to their engagement — not every
org skill of a matching scope.

Acceptance Criteria:
- Given the migration runs, Then an attachment table exists (project_skill / study_skill, or a
  polymorphic skill_attachment) linking a skill to a hierarchy node.
- Given I attach skill X to project Y (POST /api/v1/projects/{id}/skills or equivalent), Then the
  attachment persists; unattach removes it. Attach/unattach is consultant/ma_tech gated + scope-checked.
- Given an internal assignment UI, Then I can attach/detach skills on a Project/Study screen.
- Given the client portal (8.4), Then client skill availability is filtered by REAL attachments
  (replacing the scope-heuristic mock) intersected with the client's grant + client_facing visibility.
- Given the internal mock seam useProjectSkills(_projectId), Then it is rewired to query real
  attachments by projectId (the documented swap point).
```

### 4.2 — Epic list: `planning-artifacts/epics/epic-list.md`

- Under **Epic 8**, add the 8.5 + 8.6 one-liners.
- ADD a new top section:

```
## Epic 10: Client User Provisioning

Vitalief admins can create client login identities and invite them, so a client can be onboarded
end-to-end from within the platform (not via out-of-band Cognito console work).

Stories (to be detailed via create-story):
- 10.1 Cognito admin user provisioning (AdminCreateUser + org_id/role claims + invite/temp password)
- 10.2 User-management screen (create/invite client users, list users, resend invite)
- 10.3 Provisioning ↔ grant handoff (create user → immediately grant engagement access in one flow)
```

- ADD a dated changelog note at the top mirroring the existing convention (2026-07-01: correct-course — Epic 8 +8.5/8.6, new Epic 10).

### 4.3 — PRD: `planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md`

**Access Control table — ADD:**

```
| ACL-08 | Internal admins (Vitalief consultants) can view, create, and revoke client access grants
          across the engagement hierarchy via an in-app Access Control screen. | P1 |
| ACL-09 | Skills can be attached to specific Projects and Studies; a client's portal shows only the
          skills attached to their granted engagement (intersected with client-facing visibility),
          not all org skills of a matching scope. | P1 |
```

- **Note on ACL-06 / INV-07:** ACL-06 (engagement-lead *self-service*, no admin involvement) remains **P2**; ACL-08 covers the *internal-admin* case being built now. ACL-09 **supersedes** the INV-07 Phase-1 stance ("context picker shows all nodes without filtering by skill attachment") for the client portal — add a cross-reference so the two don't read as contradictory.

**New FR group — Client User Provisioning (Epic 10) — ADD (e.g. `USR-*`):**

```
| USR-01 | Vitalief admins can create a client user identity in the platform's auth provider
          (Cognito), setting the user's org_id and role claims. | P1 (Epic 10) |
| USR-02 | New client users receive an invitation (temporary password / set-password flow) to
          activate their account. | P1 (Epic 10) |
| USR-03 | Admins can view and manage client users (list, resend invite, deactivate). | P2 (Epic 10) |
```

> **Supersedes note for SEC-06:** SEC-06 assumed users pre-exist. USR-01/02 introduce in-platform provisioning; add a cross-reference in SEC-06.

### 4.4 — Architecture: `planning-artifacts/architecture/core-architectural-decisions.md`

- ADD a decision block: **Skill attachment model** (table shape; how attachment composes with the `scope` field and the ltree grant scope filter; that skills remain org-global registry entries but gain per-node attachments).
- ADD a decision block: **Client user provisioning** (Cognito `AdminCreateUser` via a new admin capability alongside the `AuthProvider` seam; invite/temp-password flow; IAM `cognito-idp:AdminCreateUser`; a dev-mode provisioning path through `DevAuthProvider` so it stays offline-testable).

### 4.5 — `sprint-status.yaml`

- Under Epic 8, add `8-5-access-control-screen: backlog` and `8-6-skill-attachment-model-and-assignment-ui: backlog`.
- Add `epic-10: backlog` + `10-1-…`, `10-2-…`, `10-3-…` as `backlog`, plus `epic-10-retrospective: optional`.
- Update the `last_updated` header note.
- **Do NOT** flip epic-8 to `done`. (It was already `in-progress`; it stays open for 8.4–8.6.)

---

## Section 5 — Implementation Handoff

**Scope classification: Major** (new epic + new PRD FRs + architecture decisions) — but decomposable:

| Work | Recipient | Deliverable |
|---|---|---|
| Epic file + epic-list + PRD FR edits + sprint-status | **PO / Developer** (this workflow applies them on approval) | Updated artifacts (this proposal's §4) |
| Architecture decisions for skill attachment + Cognito provisioning | **Architect (Winston)** | Two ADR blocks before 8.6 / Epic 10 dev starts |
| Story detailing (8.5, 8.6, 10.1–10.3) | **create-story** per story | Full context-engineered story files |
| Implementation | **Developer (dev-story)** | Code, per story, after each is `ready-for-dev` |
| UX for 3 net-new admin surfaces | **UX (Sally)** | Access Control, Skill Assignment, User Management designs |

**Success criteria.** (a) An internal admin can grant/revoke client access from a screen. (c) An admin can attach skills to a project/study and the client portal reflects only attached skills. (b) An admin can create + invite a client user who can then log in — all covered by the new stories' ACs.

**Recommended immediate next steps (post-approval):**
1. Apply the §4 artifact edits (this workflow).
2. Architect authors the 2 ADR blocks (§4.4).
3. `create-story 8-6` (before 8-4, per §3 sequencing) → then re-check 8-4's client-skills contract → `create-story 8-5`.
4. Schedule Epic 10 design + stories.
