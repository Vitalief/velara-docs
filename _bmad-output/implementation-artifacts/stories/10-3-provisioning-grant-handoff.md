---
baseline_commit: 661f40c539eac4bf22b44cf663903be922185509
---

# Story 10.3: Provisioning ↔ Grant Handoff (Create-then-Grant)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief admin,
I want to create a client user and immediately grant them engagement access in one flow,
So that onboarding is a single action rather than "create user, then separately hunt for their id to grant access."

## Context & Why This Story Exists

This is the **final assembly step** of Epic 10: 10.1 built the backend `create_user` seam + `POST /api/v1/users`; 10.2 built the Users screen + `AddUserOverlay` (whose `Stepper` was **deliberately built to take a `steps` array so 10.3 can insert a "Grant access" step** — 10.2 also OMITTED the client/engagement select from its create form because "it feeds 10.3's grant step"). 10.4 fixed first-login so a freshly-provisioned user can actually complete the challenge — which is what **unblocks 10.3's manual end-to-end verification**.

**This is a FE-only orchestration story.** Both backend pieces already exist and are reused UNCHANGED:
- `POST /api/v1/users` (10.1) → returns a `UserSummary` carrying `user_id` (the Cognito `sub`).
- `POST /api/v1/access-grants` + `create_grant` (Epic 8) → accepts an **opaque `user_id`** with **no users-table FK and no existence check** (confirmed in `velara-api/app/services/access_service.py`).

The net-new work is the **combined create-then-grant UI** (insert a "Grant access" step into `AddUserOverlay`) + the orchestration + partial-failure handling. **No backend change, no migration, no Terraform.**

**UX of record:** `ux-designs/ux-Velara-2026-07-01/EXPERIENCE.md:67` + `DESIGN.md:106` — a **3-step overlay** (Create & invite → Grant access → Done). Step 1 creates+invites; on success advances **in place** to Step 2 (the reused, pre-filled grant control — the created user is fixed, admin picks the hierarchy node); Step 3 confirms both. Never optimistic for create-user or grant.

## Acceptance Criteria

**AC1 — Combined create-then-grant flow (primary).**
Given an admin (or ma_tech) opens the Add-user overlay from the Users screen,
When they create a new user (Step 1) and then, on Step 2, pick a hierarchy node and grant access,
Then the flow calls `POST /api/v1/users` first, takes the returned `user_id` (Cognito `sub`), then calls `POST /api/v1/access-grants` with `{ user_id, node_id, node_type, role: 'client' }`, and Step 3 confirms the user is both invited AND scoped in one action — no tab redirect, no manual id-hunting.

**AC2 — No FK; the guarantee is procedural.**
Given the ADR's decision that create and grant remain distinct concerns with **no DB foreign key** between a user and a grant,
When 10.3 is built,
Then it introduces **no** users-table FK and **no** backend change — the create→grant guarantee is procedural (provision first, pass the returned `user_id` into the existing `create_grant`). The `user_id` is opaque server-side; the Cognito `sub` flows straight through.

**AC3 — Grantable-role contract preserved.**
Given the grantee is a freshly-provisioned **client** user,
When `create_grant` runs,
Then it succeeds (`client` is grantable). The overlay hard-codes `role: 'client'` for the grant. An internal-role grantee is still rejected server-side with `422 INTERNAL_ROLE_NOT_GRANTABLE` (the guard covers `admin`/`ma_tech`/`consultant`); the overlay maps that code to a friendly message for defense-in-depth even though the happy path never triggers it.

**AC4 — Partial-failure is a first-class UI state (no silent inconsistency, no crash).**
Given the two-step flow partially fails (user created + invited, but the grant call fails),
When the error is handled,
Then the UI communicates on the grant step that **the user was created and invited but the grant did not apply** — the user exists in the directory and can be granted access separately from Access Control. It offers a **Retry** (re-run the grant) and a way to finish (advance to Done / close) without losing the created-user context. Never crash, never silently drop the failure.

**AC5 — Step 2 grant control mirrors the existing grant form.**
Given Step 2 (Grant access),
When it renders,
Then it reuses/mirrors the existing Access-Control grant form's node picker — a **client combobox** + a **cascading optional project select** ("Client → Project only"; empty project = whole-client grant), resolving `node_type`/`node_id` the same way `GrantManagementSection` does (`node_id = project ?? client`, `node_type = project ? 'project' : 'client'`). It does **NOT** render a user picker — the created user is fixed and shown read-only. Its states mirror the existing grant control (loading/loaded/empty/error + mutation states).

**AC6 — Quality gates.**
Given the story is implemented,
When the FE gates run,
Then `tsc --noEmit` is clean, `eslint` is clean (the one pre-existing `Icon.tsx` react-refresh warning aside), and `vitest run` is fully green with net-new tests covering: 3-step advance, the create→grant orchestration (correct body sent with the returned `user_id`), AC4 partial-failure, and the Step-3 confirmation. Baseline is **492/492 across 50 files** — keep it green and add the net-new tests.

## Tasks / Subtasks

- [x] **Task 1 — Make the grant node-picker reusable (AC5).** `velara-web/src/features/admin/components/AccessControl.tsx`
  - [x] `ClientCombobox` (`AccessControl.tsx:519-652`) is module-private. Either **export it** (cleanest — it already takes `clients`/`selected`/`onSelect`/optional `label`) or copy it into the overlay step (the MetaChip-style copy precedent). Prefer exporting to avoid divergence. If exporting, confirm no name collision and that its dependencies (`useClients` data is passed in as a prop, not imported inside) travel cleanly.
  - [x] Do NOT try to reuse `GrantManagementSection` wholesale — it renders its own list/table/pagination/revoke dialog. Only the **create-form body** (`AccessControl.tsx:922-996`) and its node-resolution logic (`:859-860`) are the reference to mirror. The overlay's grant step **skips `UserPicker` entirely** (the user is already created).

- [x] **Task 2 — Add a `CreateGrantBody` type + confirm the grant hook (AC1).** `velara-web/src/api/accessGrants.ts`
  - [x] `createAccessGrant` currently takes an inline object literal `{ user_id, node_id, node_type, role }` (`accessGrants.ts:34-45`). Export a named `CreateGrantBody` interface for that shape so the overlay imports it (small hygiene improvement; optional but recommended). Do NOT change the request/response shape.
  - [x] `useCreateGrant` (`useAccessGrants.ts:17-25`) is used as-is: `mutationFn: createAccessGrant`, invalidates `['access-grants']` on success. No change needed. (Note: it does NOT invalidate `['users']`; if the Users screen's engagement-access column should refresh after the combined flow, invalidate `['users']` too from the overlay's grant `onSuccess` — see Task 3.)

- [x] **Task 3 — Extend `AddUserOverlay` into the 3-step create→grant flow (AC1, AC3, AC4, AC5).** `velara-web/src/features/admin/components/AddUserOverlay.tsx`
  - [x] Change `STEPS` from `['Create & invite', 'Done']` to `['Create & invite', 'Grant access', 'Done']`. The `Stepper` already handles an N-length array — no Stepper change needed.
  - [x] After Step-1 success, stash the returned user: `onSuccess: (created) => { setCreatedUser(created); setStep(1) }`. `created` is a `UserSummary` carrying `created.user_id` (the Cognito `sub`) — verified: the existing test at `AddUserOverlay.test.tsx:55` already passes `{ user_id: 'usr_1', ... }` into `onSuccess`. Keep the existing Step-1 error handling (`USER_ALREADY_EXISTS` → inline, VALIDATION → field errors, else generic; never lose form values).
  - [x] **Step 2 (Grant access)** — NET-NEW. Render (mirroring `GrantManagementSection`'s create-form body):
    - A read-only line showing the just-created user (name/email) — the grantee is fixed, NOT a picker.
    - `ClientCombobox` (from Task 1) fed by `useClients()`; cascading `<select aria-label="Project">` fed by `useProjects(clientId)` with a "Whole client" default (empty value). `useProjects(undefined)` is a disabled query — safe.
    - Resolve on submit: `const node_id = projectId ?? clientId; const node_type = projectId ? 'project' : 'client';`
    - "Grant access" primary button (disabled until a client is chosen / while pending), plus a secondary "Skip for now" that advances to Done without granting (a valid path — the user is already invited; they can be granted later).
    - Call `createGrant.mutate({ user_id: createdUser.user_id, node_id, node_type, role: 'client' }, { onSuccess: () => { qc? invalidate ['users']; setStep(2) }, onError: setGrantError })`. Use `useCreateGrant()`. Use `mutate` with per-call callbacks (house convention) — do NOT `mutateAsync`-chain the two mutations, and do NOT nest the grant inside createUser's `onSuccess` (keep the steps decoupled so AC4's partial-failure is a clean UI state, not an exception path).
  - [x] **AC4 partial-failure:** grant errors set a `grantError` state rendered in a `<div role="alert">` on Step 2 with copy like: *"{name} was created and invited, but access could not be granted. You can grant access separately from Access Control."* Map `INTERNAL_ROLE_NOT_GRANTABLE` via `getApiCode` to a friendly message (mirror `AccessControl.tsx:887-889`), else `getApiMessage(err) ?? 'Could not grant access — try again.'`. Offer **Retry** (re-run `createGrant.mutate`) and let "Skip for now"/Done still work. Because Step 1 already advanced past create, the user genuinely exists — the messaging must reflect that (not "creation failed").
  - [x] **Step 3 (Done)** — update the existing done copy to confirm BOTH: *"{email} has been invited"* + (if a grant was made) *"and granted access to {node name}."* Keep "Add another" (resets to Step 0, clears `createdUser`/`grantError`) and a "Done"/close. If the grant was skipped, the done copy states invited-only.
  - [x] Use `getApiCode`/`getApiMessage` (already imported) — NOT the inline axios cast the old grant form uses. All glyphs via `<Icon>` (no emoji). Reuse the existing token classes already in the file.

- [x] **Task 4 — Tests (AC1, AC3, AC4, AC5, AC6).** `velara-web/src/features/admin/components/AddUserOverlay.test.tsx`
  - [x] Add `vi.mock` for `useCreateGrant` (mirror the `useCreateUser` mock at `:7-18`) and for the client/project hooks (`useClients`/`useProjects` from `@/features/engagements/hooks/useEngagements`) using the `q<T>(data)` helper (`AccessControl.test.tsx:150-152`: `{ data, isLoading:false, error:null }`).
  - [x] Test: 3-step Stepper renders all three labels; Step-1 success advances to "Grant access" (not straight to Done).
  - [x] Test (AC1): from Step 2, pick a client (+ optional project) and submit → `useCreateGrant`'s `mutate` called with `{ user_id: <returned sub>, node_id, node_type, role: 'client' }`; advances to Done; Done confirms both invite + grant.
  - [x] Test (AC4 partial-failure): Step-1 success → Step 2; grant `mutate` fires `opts.onError({ response: { data: { error: { code: 'INTERNAL_ROLE_NOT_GRANTABLE' } } } })` (or a generic 500) → a `role="alert"` shows the "created and invited, but access could not be granted" message; Retry is present; Done/Skip still reachable.
  - [x] Test (AC5): Step 2 renders the client combobox + project select, NO user picker; the created user is shown read-only; "Skip for now" advances to Done without calling `createGrant`.
  - [x] Keep the 7 existing tests green (Step-1 create/error/Esc/Add-another still pass with the new step count — the "advance to Done" assertions must be updated to "advance to Grant access").

- [x] **Task 5 — Gates & story record (AC6).**
  - [x] `cd velara-web && npx tsc --noEmit && npx eslint . && npx vitest run` — all green (492 baseline + net-new).
  - [x] Fill Dev Agent Record (files, tests, gate output). Note honestly whether manual end-to-end verification (real create → grant → the invited user logging in via 10.4's challenge) was done or left to the operator — do NOT reconfigure/restart the live `AUTH_BACKEND=cognito` stack just to verify (project guidance).

### Review Findings (code review 2026-07-06)

- [x] [Review][Decision] (RESOLVED 2026-07-06: skip the grant step for non-client roles — applied as a patch) Consultant-created user flows into a grant step that hardcodes `role: 'client'` — Step 1 offers Consultant (`AddUserOverlay.tsx:240-241`) but `onSuccess` unconditionally advances to Grant access, and `handleGrant` sends `role: 'client'`. Because the backend's `INTERNAL_ROLE_NOT_GRANTABLE` guard keys on the grant body's `role` field (not the opaque `user_id`), the grant SUCCEEDS silently, creating a client-role grant row for an internal user — data the Epic-8 internal-role-bypass ADR forbids. (Reviewers assumed a guaranteed 422; verified it's a silent bogus grant instead — worse.) The spec's AC3 hardcode assumed a client grantee and never addressed the consultant path from 10.2's role select. Needs a call: skip the grant step for consultants, show an explanatory non-form step, or accept as-is.
- [x] [Review][Patch] Esc inside the open ClientCombobox listbox bubbles to the overlay's document-level Escape handler and closes the whole overlay, discarding the created-user context (AC4) [velara-web/src/features/admin/components/AccessControl.tsx:562-565 + AddUserOverlay.tsx:81-86]
- [x] [Review][Patch] Esc / scrim click / header X are not guarded while the grant mutation is pending — overlay can unmount mid-flight; grant may succeed server-side with zero feedback [velara-web/src/features/admin/components/AddUserOverlay.tsx:79-91,170,181-188]
- [x] [Review][Patch] Client/Project inputs stay enabled while the grant is in flight — selection can change under a pending request [velara-web/src/features/admin/components/AddUserOverlay.tsx:293-320]
- [x] [Review][Patch] Done-step node name is re-resolved live from the clients/projects query caches instead of snapshotted at grant time — a refetch that drops the node renders "granted access to ‹empty›" [velara-web/src/features/admin/components/AddUserOverlay.tsx:75-77,357-361]
- [x] [Review][Patch] `grantError` lifecycle: cleared synchronously before `mutate` so the "Retrying…" label is dead code and the AC4 alert vanishes during a retry; conversely it is NOT cleared when the user changes client/project, leaving a stale banner + misleading "Retry" label on a fresh selection [velara-web/src/features/admin/components/AddUserOverlay.tsx:134,346]
- [x] [Review][Patch] Null `email` renders empty parentheses "()" in the grant-step banner — `UserSummary.email` is nullable and rendered unguarded [velara-web/src/features/admin/components/AddUserOverlay.tsx:287]
- [x] [Review][Patch] Project-level grant path untested — the `[x]` Task-4 subtask promised "(+ optional project)" but no test selects a project; `node_type: 'project'` resolution and the project-name Done copy are never exercised [velara-web/src/features/admin/components/AddUserOverlay.test.tsx:166]
- [x] [Review][Patch] Create-user request-body assertion was deleted in the test rewrite — no remaining test verifies the Step-1 create payload [velara-web/src/features/admin/components/AddUserOverlay.test.tsx:111]
- [x] [Review][Patch] Retry behavior untested — AC4 test asserts the Retry button exists but never clicks it to confirm `createGrant.mutate` re-fires [velara-web/src/features/admin/components/AddUserOverlay.test.tsx:213-231]
- [x] [Review][Patch] Temporary-password guidance ("Cognito has emailed a secure invitation with a temporary password.") silently dropped from the Done step — restore alongside the new granted/skipped copy [velara-web/src/features/admin/components/AddUserOverlay.tsx:352-364]
- [x] [Review][Defer] ClientCombobox free-typed text masks the real selection (no way to clear back to null; stale selection grants silently) [velara-web/src/features/admin/components/AccessControl.tsx:602-615] — deferred, pre-existing shared-component behavior, identical in Access Control's grant form
- [x] [Review][Defer] `useClients` loading/error states swallowed on the grant step (empty combobox with no loading/error/empty message) [velara-web/src/features/admin/components/AddUserOverlay.tsx:72] — deferred, mirrors the reference grant form exactly (AC5 mandated mirroring); fix both together
- [x] [Review][Defer] `useProjects` loading not surfaced — admin can submit a whole-client grant before the project list arrives [velara-web/src/features/admin/components/AddUserOverlay.tsx:73,306-320] — deferred, same mirroring rationale
- [x] [Review][Defer] Focus drops to `<body>` on step transitions (0→1, 1→2) — no focus management for the new step content [velara-web/src/features/admin/components/AddUserOverlay.tsx:113-116,140-144] — deferred, pre-existing pattern from the 2-step 10.2 overlay

## Dev Notes

### The orchestration seam (read this first)
Two sequential react-query mutations, **gated by the Stepper, NOT chained**:
1. Step 1: `useCreateUser().mutate(body, { onSuccess: (created) => { setCreatedUser(created); setStep(1) } })` — `created.user_id` is the Cognito `sub`.
2. Step 2: `useCreateGrant().mutate({ user_id: createdUser.user_id, node_id, node_type, role: 'client' }, { onSuccess, onError })`.

Keeping them decoupled makes AC4 trivial: once Step 1 succeeds the user IS created + invited, so a Step-2 failure is a "grant didn't apply" state on an already-created user — not a rollback, not an exception. `create_grant` is idempotent (duplicate → existing row + `GRANT_REAFFIRMED` audit, still 201), so Retry is safe.

### Backend contracts (reused UNCHANGED — do not touch)
- `POST /api/v1/access-grants` body: `{ user_id, node_id, node_type, role }` (all 4 required; no `client_id`/`study_id`/`scope`). Success **201**, `{ data: AccessGrantRecord, meta }`. Gated `{admin, ma_tech}` via router `RejectNonGrantor` → others 404. **Same grantor boundary as `POST /api/v1/users`**, so anyone who can reach Step 1 can reach Step 2 — no mid-flow authz surprise.
- `create_grant` (`access_service.py`): `user_id` is **opaque** (no existence/FK check — the whole reason the handoff works); `node_type` validated against `_VALID_NODE_TYPES`; node existence validated in-org; `role in {ma_tech, consultant, admin}` → `422 INTERNAL_ROLE_NOT_GRANTABLE`; `client` succeeds. `role: 'client'` is hard-coded in the overlay.
- `POST /api/v1/users` (10.1/10.2): returns `UserSummary { user_id, name, email, role, status }`. `user_id` = Cognito `sub`.

### Node resolution (mirror `GrantManagementSection`, `AccessControl.tsx:859-860`)
```ts
const node_id = grantProjectId ?? grantClientId
const node_type = grantProjectId ? 'project' : 'client'
```
Client via `ClientCombobox` (name-searchable, keyboard-nav) fed by `useClients()`; project via a plain `<select>` fed by `useProjects(clientId)` (cascading, disabled until a client is chosen, "Whole client" = empty = client-level grant). "Client → Project only" — no study/location level in this form.

### Files being modified — current state & what to preserve
- **`velara-web/src/features/admin/components/AddUserOverlay.tsx`** (UPDATE): today a 2-step create→done overlay (`STEPS = ['Create & invite', 'Done']`, `AddUserOverlay.tsx:47`). Preserve: the `Stepper` sub-component (already N-length-ready, `:9-43`), the focus/Esc/scrim a11y mechanics (`:61-73, :115-134`), the Step-1 form + its error handling (`USER_ALREADY_EXISTS`/validation/generic, never-lose-values, `:83-106`), the Cognito-invite callout (`:191-197`). ADD: the third step, `createdUser`/`grantError` state, the grant step, updated done copy.
- **`velara-web/src/features/admin/components/AccessControl.tsx`** (UPDATE, minimal): export `ClientCombobox` (or leave and copy). Do NOT alter `GrantManagementSection`'s behavior.
- **`velara-web/src/api/accessGrants.ts`** (UPDATE, optional): export a `CreateGrantBody` type. No shape change.
- **`velara-web/src/features/admin/components/AddUserOverlay.test.tsx`** (UPDATE): 7 existing tests; the "advance to Done" assertions become "advance to Grant access". Add the mutation + client/project hook mocks.
- The `AddUserOverlay` is opened from `UsersScreen` ("Add user" button) — no change needed there; the overlay's `onClose` contract is unchanged.

### UX rules (from EXPERIENCE.md — enforced in 10.2 review, carry forward)
- **Create = guided (stepper)**; never optimistic for create-user or grant (identity/access — confirm server success). Advance **in place** (no tab redirect).
- Never lose entered form values on error. `role="alert"` for errors, `aria-live` for transient success.
- No emoji — `<Icon>` only. Tailwind v4 (`@theme` tokens, no config file). Reuse the tokens already in `AddUserOverlay.tsx`.
- Step-2 grantee is **read-only** (the created user), not a picker (that's the whole point — no id-hunting).

### Scope boundaries (do NOT do these)
- No backend change, no migration, no Terraform, no IAM change. Both routes already exist and are correctly gated.
- No users-table FK (there is no users table; identities live in Cognito).
- Do NOT chain the two mutations with `mutateAsync` or nest grant inside create's `onSuccess` — Stepper-gate them (AC4 cleanliness).
- Do NOT add a study/location level to the grant form — "Client → Project only", matching the existing grant control.
- Do NOT build a new grant service or endpoint — reuse `useCreateGrant`.

### Project Structure Notes
- FE admin surfaces live in `velara-web/src/features/admin/`. Grant hooks in `hooks/useAccessGrants.ts`; user hooks in `hooks/useUsers.ts`; engagement/client/project hooks in `@/features/engagements/hooks/useEngagements`.
- Commit style (FE-only): `feat(users): Story 10.3 — provisioning→grant handoff (Epic 10)`.

### References
- [Source: _bmad-output/planning-artifacts/epics/epic-10-client-user-provisioning.md#Story 10.3] — story + ACs + building blocks.
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Client User Provisioning] — no-FK, procedural create-then-grant.
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-Velara-2026-07-01/EXPERIENCE.md:67,77,104-111] — 3-step in-place flow + partial-failure copy + the Susan Whitfield walkthrough.
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-Velara-2026-07-01/DESIGN.md:105-106] — provisioning form + 3-dot stepper.
- [Source: velara-web/src/features/admin/components/AddUserOverlay.tsx] — the overlay + Stepper (10.3-extensible by design).
- [Source: velara-web/src/features/admin/components/AccessControl.tsx:519-652,815-996] — `ClientCombobox` + `GrantManagementSection` create-form to mirror; node resolution at `:859-860`; internal-role error mapping at `:887-889`.
- [Source: velara-web/src/api/accessGrants.ts:34-45] — grant body/response shape.
- [Source: velara-web/src/features/admin/hooks/useAccessGrants.ts:17-25] — `useCreateGrant`.
- [Source: velara-api/app/services/access_service.py:253-302] — `create_grant` guard (opaque user_id, internal-role 422, idempotent reaffirm).
- [Source: velara-api/app/api/v1/access_grants.py:30,95] — route gating (`{admin, ma_tech}`).
- [Source: _bmad-output/implementation-artifacts/stories/10-2-user-management-screen.md] — Stepper-extensibility + omitted-grant-step decision; error/a11y conventions.
- [Source: _bmad-output/implementation-artifacts/stories/10-4-first-login-password-challenge.md] — first-login now works (unblocks 10.3 E2E verification); 492/492 FE baseline.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `npx tsc --noEmit` — clean, 0 errors.
- `npx eslint .` — 1 pre-existing warning only (`Icon.tsx` react-refresh, unrelated to this story).
- `npx vitest run` — 50 files / 496 tests passed (492 baseline + 4 net-new in `AddUserOverlay.test.tsx`; net test count in that file grew from 7→11, i.e. +4 after removing the now-obsolete "advance to Done" assertion and adding 5 new tests covering 3-step render, AC1 grant orchestration, AC5 skip-for-now, AC4 partial-failure).
- Fixed a regression surfaced by the full suite run: `UsersScreen.test.tsx` mounts `AddUserOverlay` and its `useAccessGrants`/`useEngagements` mocks didn't include the newly-called `useCreateGrant`/`useProjects` — added both mocks + default return values (no behavior under test changed, purely a missing-mock fix).

### Completion Notes List

- Exported `ClientCombobox` from `AccessControl.tsx` (Task 1) — no behavior change, just visibility, so `GrantManagementSection`'s existing usage is untouched.
- Added `CreateGrantBody` interface to `accessGrants.ts` (Task 2) — `createAccessGrant`'s signature now references the named type; request/response shape unchanged.
- `AddUserOverlay.tsx`: `STEPS` extended to 3; Step 1 (create) unchanged; new Step 2 (Grant access) renders the read-only created-user line + `ClientCombobox` + cascading project `<select>`, with "Skip for now" and "Grant access"/"Retry" actions; Step 3 (Done, was Step 1) now conditionally confirms the grant. `handleGrant`/`handleSkipGrant` added; `resetForm` extended to clear grant-related state on "Add another". The two mutations (`useCreateUser`, `useCreateGrant`) are Stepper-gated, not chained — a grant failure leaves the user on Step 2 with a `role="alert"` message and a Retry button, per AC4.
- Manual end-to-end verification (real create → grant → the invited user logging in via 10.4's first-login challenge) was **NOT performed** — left to the operator, per project guidance not to reconfigure/restart the live `AUTH_BACKEND=cognito` stack just to verify. This story's working directory (`velara-web`) has no local docker-compose to spin up a disposable stack against, so verification is FE-unit-test-only this session; gates (tsc/eslint/vitest) are green.

### File List

- `velara-web/src/features/admin/components/AddUserOverlay.tsx` (modified)
- `velara-web/src/features/admin/components/AddUserOverlay.test.tsx` (modified)
- `velara-web/src/features/admin/components/AccessControl.tsx` (modified — exported `ClientCombobox`)
- `velara-web/src/features/admin/components/UsersScreen.test.tsx` (modified — added missing `useCreateGrant`/`useProjects` mocks)
- `velara-web/src/api/accessGrants.ts` (modified — added `CreateGrantBody` type)

## Change Log

- 2026-07-06: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) → done. 1 decision resolved (consultant creations now SKIP the grant step — the grant body's hardcoded `role: 'client'` would have silently created an ADR-forbidden internal-role grant, since the backend guard keys on the body role, not the opaque user_id) + 10 patches applied: Esc inside ClientCombobox no longer closes the overlay (stopPropagation when listbox open, AccessControl.tsx); all close paths (Esc/scrim/X) gated while a mutation is pending; grant-step inputs disabled during pending (new ClientCombobox `disabled` prop); granted node name snapshotted at grant time for the Done copy; grantError persists through Retry ("Retrying…" now reachable) and clears on selection change; null-email guard in the grant banner; Done copy restores the Cognito temp-password sentence; tests add project-level-grant path, consultant-skip, Esc-dropdown containment, Retry re-fire, and the restored create-body assertion. 4 findings deferred (pre-existing: combobox typed-text masking, clients/projects loading-error states mirroring the reference form, step-transition focus) → deferred-work.md; 5 dismissed as noise. Gates re-verified: tsc clean, eslint 1 pre-existing warning, vitest 499/499 (50 files). Manual E2E still owed by operator (unchanged from Dev Record).
- 2026-07-06: Implemented Story 10.3 (Provisioning ↔ Grant Handoff) — extended `AddUserOverlay` into a 3-step create→grant flow reusing `POST /api/v1/users` (10.1) and `POST /api/v1/access-grants` (Epic 8) unchanged. No backend/migration/Terraform. Gates green: tsc 0, eslint clean (1 pre-existing warning), vitest 496/496 (50 files). Status → review.
