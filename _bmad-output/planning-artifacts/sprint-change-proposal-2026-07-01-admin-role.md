# Sprint Change Proposal — Admin Role & Tiered Attachment/Grant Authority

- **Date:** 2026-07-01
- **Author:** Developer (correct-course), architect lens: Winston
- **Trigger:** Story 8-6 code review (2026-07-01)
- **Scope classification:** Moderate (new story + new ADR + backlog update; no code shipped by this workflow)
- **Status:** Approved 2026-07-01

---

## Section 1 — Issue Summary

During the Story 8-6 (Skill Attachment Model & Assignment UI) code review, the product owner requested that skill **attach/detach** be available on the **Engagements screen**, gated to a new **`admin`** role plus `ma_tech`, with **`consultant` demoted to read-only** for administrative operations.

The Engagements-screen attach/detach UI was **built during the 8-6 review** (uncommitted working tree) but gated to the *current* internal grantor roles `{consultant, ma_tech}`. The **role change itself** — introducing `admin` and demoting `consultant` — was deliberately deferred to this correct-course, because introducing a role is an **authorization-architecture decision**, not a config tweak.

**Why it's an architecture decision (not a code tweak):** Winston's 2026-06-30 ADR ("Authorization — Internal roles are org-global operators", `architecture/core-architectural-decisions.md`) fixes the internal role set at `{ma_tech, consultant}` and states explicitly: *"Do **not** silently widen `_INTERNAL_ROLES`"* — a new role must arrive "as its own story." That ADR's **revisit trigger** (a differently-privileged internal user) is exactly what this change realizes.

**Evidence:** the as-built gates `_GRANTOR_ROLES = frozenset({"consultant", "ma_tech"})` in `app/api/v1/hierarchy.py:38` (attach) and `app/api/v1/access_grants.py:26` (grant); FE `INTERNAL_ROLES = new Set(['ma_tech', 'consultant'])` in `src/shared/utils/auth.ts:85`; the 2026-06-30 ADR revisit hook.

---

## Section 2 — Impact Analysis

### Epic Impact
- **Epic 8 (Access Control & Client Portal):** completes as planned; this is **additive**. Done stories (8-1/8-2/8-3/8-6) are **not reopened** — their role gates *tighten* to a superset (`admin` added, `consultant` removed), which is behavior-compatible for existing `ma_tech` users and is the intended demotion for `consultant`.
- **New story:** **8-7 — Admin Role & Attachment/Grant Authority** (status `backlog`).
- **Epic 10 (Client User Provisioning):** unchanged in scope; gains one dependency note — Cognito `custom:role` provisioning must offer `admin` (admin assignment UI is Epic 10 territory, out of 8-7).

### Story Impact
- **8-4 (Client Portal Skill Discovery & Invocation, `ready-for-dev`):** **NOT affected — no sequencing dependency on 8-7.** 8-4 is entirely client-side (read + invoke via `GET /api/v1/client/skills` and the client invocation routes); it never calls attach or grant. The only role boundary 8-4 revises is D1 invocation-widening (the "internal-roles-only run org-global invocations" ruling), which is unrelated to `_GRANTOR_ROLES`. **8-4 and 8-7 are disjoint and may run in either order or in parallel.**
- **8-5 (Access Control Screen, `backlog`):** renders internal admin surfaces. Should be built against the **final** role gate → **prefer 8-7 before or with 8-5** so 8-5 doesn't hardcode the old `{consultant, ma_tech}` gate and need rework. Soft preference, not a hard block.

### Artifact Conflicts
- **Architecture — ACTION NEEDED:** a **new ADR** amending the 2026-06-30 internal-role ADR's revisit trigger (records the `admin` role, the unified `_GRANTOR_ROLES = {admin, ma_tech}`, the role-not-org rationale carried forward, and manual/Epic-10 issuance).
- **PRD:** minor — FR/AC prose that reads "consultant/ma_tech gated" should read "admin/ma_tech gated" for attach/grant.
- **UX:** no new screens. The attach UI exists (built in 8-6 review); only role-gating changes — `consultant` now sees attached skills **read-only**.
- **Cognito/IaC:** `custom:role` must accept `admin` (Terraform `cognito.tf` if the attribute is enum-constrained; free-string today likely needs no change — verify).
- **Tests:** the `_require_grantor` 403 branch — **unreachable today** because `_INTERNAL_ROLES == _GRANTOR_ROLES` — becomes **reachable and testable** with a demoted-`consultant` token. This closes the coverage gap flagged in the 8-6 review.

### Technical Impact (seams)
- `app/core/dependencies.py` — `_INTERNAL_ROLES` gains `admin`; `admin` resolves `unrestricted=True` (bypasses hierarchy scope, like other internal roles).
- `app/api/v1/hierarchy.py:38` + `app/api/v1/access_grants.py:26` — `_GRANTOR_ROLES` → `{admin, ma_tech}` (unified; consultant removed from both attach AND grant per the approved full-demotion decision).
- `app/services/access_service.py` — `create_grant` internal-role-grantee rejection now also covers `admin` (an internal role is not a grantee).
- FE `src/shared/utils/auth.ts:85` — `INTERNAL_ROLES` gains `admin`.
- FE `src/features/admin/components/NodeSkillAttachControls.tsx` (`GRANTOR_ROLES`) + the AccessControl screen's gate → `{admin, ma_tech}`.

---

## Section 3 — Recommended Approach

**Option 1 — Direct Adjustment (SELECTED).** Add one new story (8-7) + author one ADR. Effort: **Medium**, Risk: **Low-Medium**.

- **Option 2 (Rollback):** not viable/unnecessary — nothing to revert; 8-6 stays `done`.
- **Option 3 (MVP review):** N/A — MVP scope is unchanged; this refines the actor model.

**Rationale:** the attach UI is already built; 8-7 is contained role plumbing + a gate tightening + tests, plus the ADR that authorization changes require. It does not disturb completed stories or the MVP. The full-demotion decision (consultant loses both attach and grant) keeps a single unified `_GRANTOR_ROLES` set, preserving the 8-6 ADR's attach≡grant symmetry.

---

## Section 4 — Detailed Change Proposals

### ① NEW Story 8-7 — "Admin Role & Attachment/Grant Authority" (`backlog`)
**Backend**
- Add `admin` to `_INTERNAL_ROLES` (`dependencies.py:106`); `admin` → `unrestricted=True` in the hierarchy-scope dependency.
- `_GRANTOR_ROLES` → `{admin, ma_tech}` in **both** `hierarchy.py:38` and `access_grants.py:26` (consultant removed from attach AND grant).
- `create_grant` rejects `admin` as a grantee (internal roles are operators, not grantees — extend `_NON_GRANTABLE_ROLES`).

**Frontend**
- Add `admin` to `INTERNAL_ROLES` (`auth.ts:85`) so `RequireInternal` admits admins.
- `NodeSkillAttachControls` `GRANTOR_ROLES` → `{admin, ma_tech}`; same effective gate on the AccessControl screen. Consultant renders read-only (the read-only skill lists already exist) — but the per-skill **Run** button stays visible to consultant (see run-authority note below).

**Run authority — UNAFFECTED (guardrail for the dev)**
- The demotion is limited to `_GRANTOR_ROLES`-gated attach/grant. **Running a skill is a separate operation** gated by `RejectClient` only (`invocations.py:45`) — any internal role may run, no grantor check. `consultant` stays in `_INTERNAL_ROLES`, so it **retains full skill-execution authority** (runs skills from the Engagements screen and elsewhere). **Do NOT add a grantor gate to the invocation/run path.** Consultant = read-only administrator of attach/grant; full operator of run.

**Cognito / IaC**
- `custom:role` accepts `admin`. Admin assignment is **manual (Cognito console) or via Epic 10 provisioning** — no self-service role-management UI in this story.

**Tests**
- Demoted-`consultant` token → **403** on attach AND on grant (now-reachable `_require_grantor` branch).
- `admin` token → success on attach + grant; `ma_tech` unchanged.
- FE: consultant sees no attach affordance; admin/ma_tech do.

**Out of scope (explicit):** role-management UI, `AdminUpdateUserAttributes`, user-list surface (all Epic 10).

### ② NEW ADR — `core-architectural-decisions.md`
"Admin role & tiered internal authority (added 2026-07-01, Story 8-7)" — amends the 2026-06-30 internal-role ADR's revisit trigger: records `admin` in `_INTERNAL_ROLES`, `_GRANTOR_ROLES = {admin, ma_tech}` (consultant demoted, unified attach+grant), the role-not-org rationale carried forward, `create_grant` rejects `admin` grantee, and manual/Epic-10 issuance. (Draft appended below; to be merged into the architecture doc on dev pickup.)

### ③ Epic 8 file — `epics/epic-8-access-control-client-portal.md`
- Add a Story 8-7 section (ACs mirroring the story).
- Update 8-5/8-6 AC prose "consultant/ma_tech gated" → "admin/ma_tech gated" for attach/grant.

### ④ Epic 10 note — `core-architectural-decisions.md` (Client User Provisioning ADR)
- Note that `custom:role` provisioning must offer `admin` as a valid value.

### ⑤ sprint-status.yaml
- Add `8-7-admin-role-attachment-authority: backlog` under Epic 8.

---

## Section 5 — Implementation Handoff

- **Scope:** Moderate → **Product Owner / Developer** coordination (backlog add + a new story), with **Architect** authoring/merging the ADR before dev.
- **Sequencing:** 8-7 independent of 8-4 (parallel OK); **prefer 8-7 before/with 8-5**.
- **Success criteria:** `admin` is a recognized internal role (BE+FE); attach + grant gated to `{admin, ma_tech}`; consultant read-only for both, verified by the now-reachable 403 tests; ADR recorded amending the 2026-06-30 decision; no regression in `ma_tech` behavior or completed stories.
- **Next step:** run `create-story` for 8-7 to expand these ACs into full dev detail; Architect merges the ADR draft.

---

## Appendix — ADR Draft (for `core-architectural-decisions.md`)

> ## Authorization — Admin role & tiered internal authority (added 2026-07-01, Story 8-7)
>
> Amends the 2026-06-30 "Internal roles are org-global operators" ADR by exercising its stated revisit trigger. Architect: Winston.
>
> **Decision.** Introduce a third internal role, `admin`, above `ma_tech`/`consultant`. `_INTERNAL_ROLES = {ma_tech, consultant, admin}` — all three bypass hierarchy scope (`unrestricted=True`); the external `client` role remains the only scope-restricted role (the 2026-06-30 decision is otherwise unchanged). Administrative *authority* (attaching skills; granting access) is tiered: **`_GRANTOR_ROLES = {admin, ma_tech}`** — a single unified set gating **both** skill attach/detach and access-grant management. `consultant` is **demoted to read-only** for these operations; it retains internal read access (sees engagements, attached skills, grants) but can no longer attach/detach or create/revoke grants. This reverses the 8.1 D4 ruling that `consultant` is a grantor.
>
> **Why one unified `_GRANTOR_ROLES` (not split attach vs grant).** The 2026-07-01 skill-attachment ADR mandates attachment mirror `user_access_grants` 1:1. Keeping a single grantor set preserves that attach≡grant symmetry — one gate, one mental model, one test surface. (The alternative — a distinct `_ATTACH_ROLES` — was rejected: it forks the symmetry for no product benefit given consultant loses both.)
>
> **Role-not-org still holds.** The 2026-06-30 rationale (bypass keys on `role`, not `org`, because `role`/`org_id` are sibling Cognito claims of equal trust; forgery is defended upstream at the Cognito/`token_use=="id"`/signature layer) carries forward unchanged. `admin` is a trusted `custom:role` claim like the others.
>
> **Issuance.** `admin` is a valid `custom:role` value the app recognizes. Phase 1: admins are designated **manually (Cognito console)** or via Epic 10 provisioning once built — no self-service role-management surface in 8-7. `create_grant` continues to reject internal-role grantees (now incl. `admin`) with 422 `INTERNAL_ROLE_NOT_GRANTABLE` — an operator is never a grantee.
>
> **Seams touched:** `app/core/dependencies.py` (`_INTERNAL_ROLES`, `_hierarchy_scope`); `app/api/v1/hierarchy.py` + `app/api/v1/access_grants.py` (`_GRANTOR_ROLES`); `app/services/access_service.py` (`_NON_GRANTABLE_ROLES`); FE `src/shared/utils/auth.ts` (`INTERNAL_ROLES`) + `features/admin/` gates. Cognito `custom:role` accepts `admin`. Amends the 2026-06-30 ADR (revisit trigger fired); Epic 10 provisioning offers `admin`.
