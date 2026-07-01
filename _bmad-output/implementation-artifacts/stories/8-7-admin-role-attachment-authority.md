---
baseline_commit: 6e661260eca9a0260a25657c7ca0fea09b202db3
---

# Story 8.7: Admin Role & Attachment/Grant Authority

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief admin,
I want a privileged `admin` role that (with `ma_tech`) can attach skills and manage access grants, while `consultant` becomes read-only for those operations,
so that administrative authority over skill attachment and access is **tiered** rather than shared equally across all internal staff — without touching who can *run* skills.

## Acceptance Criteria

1. **admin is an internal role.** Given a user whose Cognito `custom:role` is `admin`, when they authenticate, then they are treated as internal — `_INTERNAL_ROLES` includes `admin`; the hierarchy-scope dependency returns `unrestricted=True` for them (bypasses scope); `RejectClient` passes them through; and on the FE `isInternal()` returns true / `RequireInternal` admits them.

2. **Unified grantor gate = {admin, ma_tech}.** Given the attach/detach routes (`POST`/`DELETE /api/v1/projects/{id}/skills`, `POST`/`DELETE /api/v1/studies/{id}/skills`) and the grant routes (`POST /api/v1/access-grants`, `DELETE /api/v1/access-grants/{id}`), when called, then they are gated to a single unified `_GRANTOR_ROLES = {admin, ma_tech}` for BOTH attach and grant.

3. **consultant demoted to read-only admin (403).** Given a `consultant`-role token, when it calls any attach/detach or grant route, then it is rejected with **403 FORBIDDEN** (the now-reachable `_require_grantor` branch). Consultant retains internal READ access — it still lists engagements, attached skills, and grants — but can no longer attach/detach or create/revoke.

4. **Running skills is UNAFFECTED by the demotion.** Given a `consultant`-role token, when it runs a skill (the invocation route) from the Engagements screen or elsewhere, then it **succeeds**. The invocation router stays gated by `RejectClient` only (any internal role may run); **NO** `_GRANTOR_ROLES`/grantor check is added to the run path. Consultant = read-only administrator of attach/grant, full operator of run.

5. **admin is never a grantee (422).** Given a grant attempted with an internal-role grantee (`ma_tech`/`consultant`/`admin`), when `create_grant` runs, then it is rejected with `422 INTERNAL_ROLE_NOT_GRANTABLE` — the `_NON_GRANTABLE_ROLES` guard now covers `admin` too.

6. **FE affordances follow the gate.** Given the Engagements screen and the Access Control screen, when an `admin` or `ma_tech` user views a Project/Study, then attach/detach affordances (`+ Attach skill` buttons, detach `×` on attached-skill chips) are shown; for a `consultant` they are **hidden** — but the per-skill **Run** button remains visible to consultant everywhere it appears today.

7. **Issuance is manual / Epic 10 — no role-management UI here.** Given the app's role model, when an `admin` identity is needed, then it is assigned via the Cognito console (or Epic 10 provisioning once built). This story adds **NO** self-service role-management UI, no `AdminUpdateUserAttributes`, and no users-list surface (all Epic 10). Cognito `custom:role` already accepts `admin` (free-string attribute) — verify, no IaC change expected.

## Tasks / Subtasks

- [x] **Task 1 — Backend: register `admin` as an internal role (AC: #1)**
  - [x] In [dependencies.py:106](velara-api/app/core/dependencies.py#L106) change `_INTERNAL_ROLES = frozenset({"ma_tech", "consultant"})` → `frozenset({"ma_tech", "consultant", "admin"})`.
  - [x] Verify `_hierarchy_scope` ([dependencies.py:157](velara-api/app/core/dependencies.py#L157)) then returns `unrestricted=True` for `admin` (it already keys on `_INTERNAL_ROLES` — no other change) and `reject_client` ([dependencies.py:189](velara-api/app/core/dependencies.py#L189)) passes `admin` through. Update the REVISIT-TRIGGER comment block ([dependencies.py:90-105](velara-api/app/core/dependencies.py#L90-L105)) to note `admin` was added per the 2026-07-01 ADR (the trigger fired).
  - [x] Add an `admin` seed user to `_SEED_USERS` ([auth.py:98-117](velara-api/app/integrations/auth.py#L98-L117)) so integration tests can mint an admin token: key `"admin"`, `user_id="usr_004_admin"`, `org_id="org_vitalief"`, `role="admin"`. Extend the persona docstring ([auth.py:43-45](velara-api/app/integrations/auth.py#L43-L45)) with the `admin` line.

- [x] **Task 2 — Backend: unify `_GRANTOR_ROLES = {admin, ma_tech}` (AC: #2, #3)**
  - [x] [hierarchy.py:38](velara-api/app/api/v1/hierarchy.py#L38): `_GRANTOR_ROLES = frozenset({"consultant", "ma_tech"})` → `frozenset({"admin", "ma_tech"})`.
  - [x] [access_grants.py:26](velara-api/app/api/v1/access_grants.py#L26): same change → `frozenset({"admin", "ma_tech"})`.
  - [x] Update the two 403 messages that name the roles: [hierarchy.py:519](velara-api/app/api/v1/hierarchy.py#L519) ("Only consultant or ma_tech users may manage skill attachments." → "Only admin or ma_tech users…") and [access_grants.py:40](velara-api/app/api/v1/access_grants.py#L40) ("Only consultant or ma_tech users may manage access grants." → "Only admin or ma_tech users…").
  - [x] Do NOT touch the invocation router — leave [invocations.py:45](velara-api/app/api/v1/invocations.py#L45) as `RejectClient`-only (AC #4). Add no grantor gate to any run path.

- [x] **Task 3 — Backend: reject `admin` as a grantee (AC: #5)**
  - [x] [access_service.py:31](velara-api/app/services/access_service.py#L31): `_NON_GRANTABLE_ROLES = frozenset({"ma_tech", "consultant"})` → `frozenset({"ma_tech", "consultant", "admin"})`. The existing `create_grant` guard ([access_service.py:253-254](velara-api/app/services/access_service.py#L253-L254)) already raises `InternalRoleNotGrantableError` (422 `INTERNAL_ROLE_NOT_GRANTABLE`) — no other change.

- [x] **Task 4 — Frontend: register `admin` as internal (AC: #1)**
  - [x] [auth.ts:85](velara-web/src/shared/utils/auth.ts#L85): `const INTERNAL_ROLES = new Set(['ma_tech', 'consultant'])` → add `'admin'`. Added shared `isGrantor()` helper + `GRANTOR_ROLES = {admin, ma_tech}` to avoid duplicate role-set literals. `isInternal()` / `RequireInternal` then admit admins with no further change.

- [x] **Task 5 — Frontend: tier the grantor gate to {admin, ma_tech} (AC: #6)**
  - [x] [NodeSkillAttachControls.tsx](velara-web/src/features/admin/components/NodeSkillAttachControls.tsx): removed local `GRANTOR_ROLES` + `canManageAttachments()` — now imports and uses shared `isGrantor()` from `auth.ts`. Updated docstring to reflect new gate `{admin, ma_tech}` + consultant read-only.
  - [x] **AccessControl screen**: imported `isGrantor` from `auth.ts`; added `canAttach = isGrantor()` in `ProjectCard` and `StudyRow`; `+ Attach skill` / `+ Attach` buttons are conditionally rendered (`{canAttach && ...}`); `AttachedSkillChip.onDetach` made optional — `×` button only renders when `onDetach` is provided (passed as `undefined` for non-grantors). Consultant sees attachment lists read-only.
  - [x] **Guardrail — Run buttons untouched.** Verified no Run button was modified in this story.
  - [x] Searched for other hardcoded `consultant/ma_tech` gate copies — updated doc comments in `skillAttachments.ts` (not logic copies).

- [x] **Task 6 — Cognito / IaC verify (AC: #7)**
  - [x] Confirmed `custom:role` is a free-string attribute (max_length=64 at [cognito.tf:47-55](velara-api/terraform/cognito.tf#L47-L55)) — `admin` accepted with **no `terraform apply` needed**. Updated doc comment [cognito.tf:36](velara-api/terraform/cognito.tf#L36) to `(admin | ma_tech | consultant | client)`.

- [x] **Task 7 — Backend tests (AC: #2, #3, #4, #5)**
  - [x] `test_skill_attachments.py`: added `"admin"` to `_auth_headers` map; fixed `test_attach_skill_to_project` (was using consultant, now ma_tech); updated `test_require_grantor_403_branch` to reflect new gating; added `test_admin_can_attach_and_detach_skill` (admin succeeds on project+study attach/detach); added `test_consultant_cannot_attach_or_detach` (consultant → 403 on project+study attach/detach).
  - [x] `test_access_grants.py`: added `"admin"` to `_auth_headers` map; updated `_grant` helper + all existing consultant-as-grantor calls → `ma_tech`; added `test_admin_can_create_and_revoke_grant`; added `test_consultant_cannot_create_or_revoke_grant` (consultant → 403); extended `test_grant_for_internal_role_is_rejected` to cover `admin` grantee (422).
  - [x] `test_invoke.py`: added `test_consultant_can_still_invoke_after_demotion` (consultant POST /invoke → 202) proving AC #4.
  - [x] `test_access_service.py`: added `test_internal_role_not_grantable_error_shape` + `test_admin_role_raises_internal_role_not_grantable` (covers `_NON_GRANTABLE_ROLES` constant + error shape for all 3 roles).

- [x] **Task 8 — Frontend tests (AC: #1, #6)**
  - [x] `AccessControl.test.tsx`: added `_mockAuthSession` + `_clearAuthSession` to `beforeEach`/`afterEach` (defaults to ma_tech so existing tests pass); added 3 role-gate tests: consultant sees no attach/detach affordances (but sees list), admin sees both, ma_tech sees both.
  - [x] `NodeSkillAttachControls.test.tsx` (NEW): 3 tests — consultant → renders null; admin → renders attach button; ma_tech → renders attach button.
  - [x] `auth.test.ts`: added `isInternal` describe (admin/ma_tech/consultant → true; client → false); added `isGrantor` describe (admin/ma_tech → true; consultant/client/no-session → false).

- [x] **Task 9 — Gates & handoff**
  - [x] BE: `ruff check` ✅ + `ruff format` ✅ (our files clean); BE unit tests 528/529 pass (1 pre-existing Redis SSL test unrelated to 8.7). NO new migration.
  - [x] FE: `vitest` 388/388 ✅ (36 test files), `tsc` 0 errors ✅.
  - [x] Confirmed no regression in `ma_tech` behavior — stays grantor + internal + runner throughout.

## Dev Notes

### What this story is (and is NOT)

Pure **authorization plumbing**: add one internal role, tighten one grantor gate to a superset for `ma_tech` (adds `admin`, removes `consultant`), reject `admin` as a grantee, and align the FE gates + tests. **No new migration, no new endpoint, no new screen, no new model.** The Engagements-screen attach UI and the AccessControl screen already exist (built in Story 8.6) — this story only changes *who* sees the attach/detach/grant affordances.

The governing decision is already merged: **ADR "Authorization — Admin role & tiered internal authority (added 2026-07-01, Story 8.7)"** in [core-architectural-decisions.md](../../planning-artifacts/architecture/core-architectural-decisions.md) (lines ~120-136). It amends the 2026-06-30 "Internal roles are org-global operators" ADR by exercising its stated revisit trigger. **Do not re-open that debate** — implement to the ADR.

### The single most important guardrail — RUN IS NOT GATED

The demotion is scoped to `_GRANTOR_ROLES`-gated **administrative** operations (attach/detach skills; create/revoke grants). **Running a skill is a distinct, separately-gated operation.** The invocation router [invocations.py:45](velara-api/app/api/v1/invocations.py#L45) is `dependencies=[RejectClient]` only — any internal role may run, no grantor check. Because `consultant` stays in `_INTERNAL_ROLES`, it keeps full skill-execution authority. **Adding a grantor gate to the run path is a bug, not a feature.** The ADR states this explicitly ("Implementation MUST NOT add a grantor gate to the run path"). Verified 2026-07-01: invocations router is RejectClient-only, no `_GRANTOR_ROLES` import.

### Current state of the files you touch (read before editing)

**Backend — three role sets, three edits:**
- `_INTERNAL_ROLES` — [dependencies.py:106](velara-api/app/core/dependencies.py#L106) `frozenset({"ma_tech", "consultant"})`. Consumed by `_hierarchy_scope` (line 157: internal → `unrestricted=True`) and `reject_client` (line 189: non-internal → 404). Add `admin` and BOTH consumers get correct behavior for free — that's the design.
- `_GRANTOR_ROLES` — **duplicated** in two files: [hierarchy.py:38](velara-api/app/api/v1/hierarchy.py#L38) (attach/detach, checked by `_require_grantor` at line 513, called at lines 560/590/642/672) and [access_grants.py:26](velara-api/app/api/v1/access_grants.py#L26) (grants, `_require_grantor` at line 36, called at lines 55/77). Change **both** to `{admin, ma_tech}`. (They are separate copies today; keep them in sync. A shared constant refactor is optional and out of scope — if you do it, put it next to `_INTERNAL_ROLES` in `dependencies.py`, but a two-line duplicate change is the low-risk path.)
- `_NON_GRANTABLE_ROLES` — [access_service.py:31](velara-api/app/services/access_service.py#L31) `frozenset({"ma_tech", "consultant"})`. Add `admin`. Guard already fires at line 253.

**Frontend — three role sets, mirror them:**
- `INTERNAL_ROLES` — [auth.ts:85](velara-web/src/shared/utils/auth.ts#L85) `new Set(['ma_tech', 'consultant'])` → add `'admin'`.
- `GRANTOR_ROLES` — [NodeSkillAttachControls.tsx:9](velara-web/src/features/admin/components/NodeSkillAttachControls.tsx#L9) `new Set(['consultant', 'ma_tech'])` → `new Set(['admin', 'ma_tech'])`.
- **AccessControl screen has no gate** — [AccessControl.tsx](velara-web/src/features/admin/components/AccessControl.tsx) shows `+ Attach skill` and detach `×` unconditionally (verified: no `getCurrentUser`/role check in the file). This is the **one net-new gate to author** — see Task 5. Reuse the grantor predicate; don't invent a 4th role-set literal.

### The `_require_grantor` 403 branch is now reachable — test it

Today `_INTERNAL_ROLES == _GRANTOR_ROLES` at the attach/grant call sites (both are `{consultant, ma_tech}` intersected with the router's `RejectClient`), so the `_require_grantor` 403 branch was **dead** — no internal role could hit it (client is 404'd upstream by `RejectClient`, internal roles all passed). After this story, a `consultant` token reaches the route (still internal → passes `RejectClient`) but fails `_require_grantor` → **403**. This closes the coverage gap flagged in the 8-6 review. The demoted-`consultant` token is the test vector for AC #3.

### Test patterns (reuse — do not invent)

- **BE token minting:** `_auth_headers(role)` maps role→seed-username then `_provider.issue_token(seed[username])` — see [test_access_grants.py:61-67](velara-api/tests/integration/api/test_access_grants.py#L61-L67). Add `"admin": "admin"` to that map (depends on Task 1's `admin` seed user). Arbitrary principals: `_custom_headers(user_id, org_id, role)` builds `AuthPrincipal` + `issue_token` directly. `_INTERNAL_ORG = "org_vitalief"`.
- **FE role mocking:** `_mockAuthSession(token)` seeds a default `ma_tech` `velara_user`; tests needing another role overwrite `sessionStorage['velara_user']` right after — the documented pattern ([auth.ts:186-189](velara-web/src/shared/utils/auth.ts#L186-L189)). `client.test.tsx` already does this; follow it for a `consultant` fixture.
- Client role is 404'd on attach/grant by `RejectClient` (Story 8.2) — do NOT expect 403 for client; 403 is the *internal-consultant* path. Keep any existing client-role 404 tests intact.

### Project Structure Notes

- All changes are in existing files. Anti-pattern to avoid: **do not** create a new `roles.py`/`constants.py` or a new endpoint — the seams are the three BE sets + three FE sets above.
- **No emoji/unicode icons** in any FE change (hard project rule) — use `<Icon>` from `src/shared/components/Icon.tsx` if any new visual element is needed (none expected here).
- No Alembic migration (the last is `0017` from Story 8.6; this story adds no schema).
- Node-type URL pluralization gotcha does not apply here (no new hierarchy URLs), but if you touch any attach URL, remember `study → studies` (never `${nodeType}s`).

### References

- [Source: architecture/core-architectural-decisions.md — "Admin role & tiered internal authority (added 2026-07-01, Story 8.7)"] — the governing ADR (already merged); role set, unified `_GRANTOR_ROLES`, run-unaffected clause, role-not-org rationale, manual/Epic-10 issuance, seams list.
- [Source: architecture/core-architectural-decisions.md — "Internal roles are org-global operators (added 2026-06-30, Story 8.1)"] — the amended ADR + its revisit trigger (this story fires it).
- [Source: planning-artifacts/sprint-change-proposal-2026-07-01-admin-role.md] — correct-course that created this story; Section 4 change list + Appendix ADR draft.
- [Source: epics/epic-8-access-control-client-portal.md#Story 8.7] — the 7 ACs + out-of-scope + sequencing.
- [Source: velara-api/app/core/dependencies.py#L106] `_INTERNAL_ROLES`; #L147-L164 `_hierarchy_scope`; #L170-L193 `reject_client`.
- [Source: velara-api/app/api/v1/hierarchy.py#L38] + #L513-L520 attach `_GRANTOR_ROLES`/`_require_grantor`; call sites #L560,#L590,#L642,#L672.
- [Source: velara-api/app/api/v1/access_grants.py#L26,#L36-L40] grant `_GRANTOR_ROLES`/`_require_grantor`.
- [Source: velara-api/app/services/access_service.py#L31,#L253-L254] `_NON_GRANTABLE_ROLES` + `create_grant` guard.
- [Source: velara-api/app/api/v1/invocations.py#L45] invocation router — `RejectClient`-only (DO NOT gate).
- [Source: velara-api/app/integrations/auth.py#L98-L117] `_SEED_USERS` (add `admin`).
- [Source: velara-web/src/shared/utils/auth.ts#L85] `INTERNAL_ROLES`; #L183-L203 `_mockAuthSession`.
- [Source: velara-web/src/features/admin/components/NodeSkillAttachControls.tsx#L9] `GRANTOR_ROLES` + self-gate.
- [Source: velara-web/src/features/admin/components/AccessControl.tsx] attach buttons #L434-L446, detach chip #L25-L52 (ungated — add gate).
- [Source: velara-api/terraform/cognito.tf#L36,#L47-L55] `custom:role` free-string (no apply needed).
- [Source: velara-api/tests/integration/api/test_access_grants.py#L61-L74] `_auth_headers`/`_custom_headers` token helpers.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- ruff E501 in `test_invoke.py`: assertion f-string exceeded 100 chars → split into two concatenated f-strings
- ruff format violations in `test_access_grants.py`, `test_skill_attachments.py`, `test_access_service.py` → fixed with `ruff format`
- Existing `AccessControl.test.tsx` tests would fail after `isGrantor()` gate added (no session → buttons hidden) → fixed by adding `_mockAuthSession('test-token')` to `beforeEach` to seed ma_tech by default

### Completion Notes List

- Pre-existing failing test `test_rediss_url_enables_ssl` in `test_celery_app.py` unrelated to Story 8.7 (Redis TLS options bug from prior story); 528/529 BE unit tests pass
- FE `isGrantor()` helper lifted to `auth.ts` as single source of truth, eliminating the need for a local copy in `NodeSkillAttachControls.tsx` and preventing a third copy in `AccessControl.tsx`
- The previously-dead `_require_grantor` 403 branch in `hierarchy.py` and `access_grants.py` is now reachable via consultant tokens (confirmed AC #3 test coverage)
- Integration tests for new admin/consultant behavior written and syntactically verified; require `docker compose exec -e AUTH_BACKEND=dev api pytest` against a live Postgres instance to run

### File List

- `velara-api/app/core/dependencies.py` — `_INTERNAL_ROLES` += admin; updated REVISIT-TRIGGER comment + docstrings
- `velara-api/app/integrations/auth.py` — added `admin` seed user to `_SEED_USERS`; extended persona docstring
- `velara-api/app/api/v1/hierarchy.py` — `_GRANTOR_ROLES` → `{admin, ma_tech}`; updated 403 message
- `velara-api/app/api/v1/access_grants.py` — `_GRANTOR_ROLES` → `{admin, ma_tech}`; updated 403 message
- `velara-api/app/services/access_service.py` — `_NON_GRANTABLE_ROLES` += admin
- `velara-api/terraform/cognito.tf` — updated doc comment to list admin role
- `velara-web/src/shared/utils/auth.ts` — `INTERNAL_ROLES` += admin; added `GRANTOR_ROLES` + `isGrantor()` export
- `velara-web/src/features/admin/components/NodeSkillAttachControls.tsx` — removed local gate; now uses shared `isGrantor()`
- `velara-web/src/features/admin/components/AccessControl.tsx` — added `isGrantor()` gate on all attach/detach affordances; `onDetach` made optional on `AttachedSkillChip`
- `velara-web/src/api/skillAttachments.ts` — updated JSDoc comments (no logic change)
- `velara-api/tests/integration/api/test_skill_attachments.py` — added admin mapping; new admin/consultant 8.7 tests
- `velara-api/tests/integration/api/test_access_grants.py` — added admin mapping; updated all consultant-as-grantor calls → ma_tech; new admin/consultant 8.7 tests
- `velara-api/tests/integration/api/test_invoke.py` — added consultant invoke regression test
- `velara-api/tests/unit/services/test_access_service.py` — added admin non-grantable role tests
- `velara-web/src/features/admin/components/AccessControl.test.tsx` — added role-gate tests; `beforeEach` seeds ma_tech session
- `velara-web/src/features/admin/components/NodeSkillAttachControls.test.tsx` — NEW; role-gate tests (consultant/admin/ma_tech)
- `velara-web/src/shared/utils/auth.test.ts` — added `isInternal` and `isGrantor` describe blocks

## Review Findings

Code review 2026-07-01 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor, each finding adversarially verified against the real code; the GrantRole defect was independently reproduced by instantiating `AccessGrantCreate(role='admin')`). 5 raw findings → 3 patch, 2 dismissed as noise. AC1/AC2/AC3/AC4 (run-path guardrail)/AC6/AC7 all verified sound.

- [x] [Review][Patch] `GrantRole` Literal omits `admin` — AC5 semantic 422 is HTTP-unreachable for admin grantees and the story's own rejection test fails on the `admin` case [velara-api/app/schemas/access_grant.py:13] — FIXED: added `"admin"` → `Literal["ma_tech", "consultant", "client", "admin"]`. Verified by reproducing at the Pydantic layer: `AccessGrantCreate(role='admin')` now validates cleanly (was raising `ValidationError`) and reaches `create_grant` → `_NON_GRANTABLE_ROLES` guard → `INTERNAL_ROLE_NOT_GRANTABLE`; garbage roles still rejected. Integration test not executed live (no Postgres in this env — same constraint as dev). Original defect below: `GrantRole = Literal["ma_tech", "consultant", "client"]` had no `admin`. `AccessGrantCreate.role: GrantRole` is validated by Pydantic **before** `_require_grantor`/`create_grant` run, so `POST /api/v1/access-grants` with `role="admin"` returns `422 VALIDATION_ERROR` (exceptions.py:105), never the `422 INTERNAL_ROLE_NOT_GRANTABLE` that AC5 (spec §AC5) and Task 3 require. Consequently `test_grant_for_internal_role_is_rejected` (test_access_grants.py:579-591) — which now loops `("consultant","ma_tech","admin")` and asserts `error.code == "INTERNAL_ROLE_NOT_GRANTABLE"` — **fails on the admin iteration** (currently green only because integration tests are Postgres-skip-gated and were not run). Security posture is preserved (admin still 422-rejected), but the contract is wrong and the `_NON_GRANTABLE_ROLES` admin guard (access_service.py:31/253) is dead via HTTP. **Fix:** add `"admin"` to the `GrantRole` Literal → `Literal["ma_tech", "consultant", "client", "admin"]` so the body reaches `create_grant` and the semantic guard fires.
- [x] [Review][Patch] `access_grants.py` module docstring still names `consultant` as a permitted grantor after 8.7 demoted it [velara-api/app/api/v1/access_grants.py:6] — FIXED: docstring now reads "the `admin` and `ma_tech` internal roles… consultant demoted to read-only… any other role (including consultant) is rejected with 403 FORBIDDEN."
- [x] [Review][Patch] `client.py` docstrings under-enumerate internal roles (omit `admin`) post-8.7 [velara-api/app/api/v1/client.py:9,82] — FIXED: both docstrings now read "admin / ma_tech / consultant" (only two occurrences exist; the "~362" comment the verifier mentioned does not exist). Behavior was already correct (routes gate on `_INTERNAL_ROLES` membership); doc drift only.

**Dismissed as noise (2):** (1) `dependencies.py` REVISIT-TRIGGER "do not silently widen this set" comment now precedes the widening — the inserted Note explicitly reconciles it ("trigger fired → resolved via tiered gate"), so the change is the opposite of silent; verifier rated it below reporting threshold. (2) `test_access_service.py` admin-role loop is near-tautological (constructs the exception and re-asserts its own constants) — harmless; the load-bearing membership assertion plus the integration test already cover the AC5 guard-firing path.
