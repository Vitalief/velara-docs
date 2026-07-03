# Epic 10: Client User Provisioning

<!--
  Authored 2026-07-03 (Epic 9 retrospective P1 gate). Promotes the inline Epic 10
  definition in epic-list.md (added 2026-07-01 via correct-course) to a full,
  story-able epic doc so create-story can proceed.

  Architecture ADR: ALREADY WRITTEN — planning-artifacts/architecture/core-architectural-decisions.md:181-203
  (Winston, 2026-07-01, "Cognito user provisioning"). This epic REFERENCES that ADR; it does not re-decide it.
  The P2 retro gate ("Winston ADR before dev") is therefore effectively already satisfied — the ADR predates this doc.
-->

Vitalief admins can create client login identities and invite them, so a client can be onboarded end-to-end from within the platform rather than via out-of-band Cognito-console work. This is a distinct identity-lifecycle concern split out of Epic 8 (which manages *access grants* for users assumed to already exist — SEC-06). Epic 10 delivers the identity-creation half: **create the Cognito user (10.1) → manage/invite users in a UI (10.2) → hand a freshly-created user straight into an access grant (10.3).**

**FRs covered:** FR-USR-01, FR-USR-02, FR-USR-03 _(new; USR-01/02 supersede the SEC-06 assumption that client users pre-exist)_.
**Depends on:** Epic 8 (the `AuthProvider` seam, `DevAuthProvider` dev-shim, `create_grant`, `RequireGrantor`, the `features/admin` FE folder). **Not** Epic 9.
**Architecture ADR:** `core-architectural-decisions.md:181-203` (Cognito user provisioning) — **already written**.

> **Scope boundary (from the ADR):** **client** users only. No branded/SES onboarding email (Cognito owns the invite email in Phase 1). No self-service signup, no SSO. `custom:org_id`/`custom:role` are set **server-side** from validated admin input — never client-supplied.

> **Grantor gate (resolved 2026-07-03, supersedes the ADR's older `consultant`/`ma_tech` note):** all provisioning routes are gated to **`_GRANTOR_ROLES = {admin, ma_tech}`** via `RejectNonGrantor` — identical to the shipped `POST /api/v1/access-grants` gate. `consultant` is a delivery role and is **read-only** for admin operations (the 2026-07-02 consultant-exclusion, which post-dates the ADR). Consultant sees the Users screen read-only if it is exposed to them at all; it does not provision.

---

## Story 10.1: Cognito Admin User Provisioning (Backend)

As a Vitalief admin,
I want a backend route that creates a client login identity in Cognito with the correct `org_id`/`role` claims and triggers Cognito's built-in invitation,
So that a client user can be onboarded from the platform without anyone touching the AWS Cognito console.

**Building blocks:** `AuthProvider` Protocol + `get_auth_provider()` factory + `list_users()` ALREADY EXIST (`app/integrations/auth.py`). `create_user()` on the Protocol + both providers is **NET-NEW**. `AdminCreateUser` + `cognito-idp:Admin*` IAM perms are **NET-NEW**. `COGNITO_*` config already exists (`app/core/config.py:66-86`).

**Acceptance Criteria:**

**Given** the `AuthProvider` Protocol
**When** the seam is extended
**Then** it gains a `create_user(email, name, org_id, role)` method (per the ADR — extend the seam, do not bypass it) that returns the new user's identity (the Cognito `sub` / `user_id` + the applied `org_id`/`role` claims)

**Given** `AUTH_BACKEND=cognito` and an admin calls the provisioning route
**When** `CognitoAuthProvider.create_user` runs
**Then** it calls Cognito `AdminCreateUser` on the configured pool, sets `custom:org_id` and `custom:role` from the **server-validated** admin input (never client-supplied), and uses Cognito's **default invite mode** (Cognito generates a temporary password and sends its built-in invitation email; a forced password reset is required on first login)

**Given** `AUTH_BACKEND=dev` (offline CI / local dev-shim)
**When** `DevAuthProvider.create_user` runs
**Then** it adds the user to the in-memory seed set and returns synthesized claims with **no AWS call** — so the create→grant→login flow is exercisable in tests without Cognito (per the ADR's offline-testability requirement)

**Given** a new provisioning route `POST /api/v1/users` (create) — the mutation counterpart to the existing read-only `GET /api/v1/users`
**When** it is called
**Then** it is gated to `_GRANTOR_ROLES = {admin, ma_tech}` (router `RejectNonGrantor` + in-handler `_require_grantor`), a client token gets **404** (router-absent, mirroring the read route), and a `consultant` token gets **403**

**Given** an admin submits a provisioning request with `role`
**When** the route validates the body
**Then** `role` must be **`client` or `consultant`** (`role: Literal["client", "consultant"]`); `admin` and `ma_tech` are **rejected** with 422 (privileged/grantor accounts stay Cognito-console-only, least privilege — updated 2026-07-03, supersedes the earlier "client users only" phrasing). `org_id` is set server-side to the **caller's** org for both roles (new client *organizations* are set up out-of-band via the console; this route does not select a foreign client org). A duplicate email surfaces Cognito's `UsernameExistsException` as a clean `409`, not a 500

**Given** the ECS task role
**When** Terraform applies
**Then** it grants `cognito-idp:AdminCreateUser` (+ `AdminGetUser`, `AdminResendInvitation`, `AdminDisableUser` for Story 10.3/USR-03), **scoped to the user-pool ARN** (no wildcard)

---

## Story 10.2: User-Management Screen (Frontend)

As a Vitalief admin,
I want a Users screen where I can list existing users, create/invite a new client user, and resend an invitation,
So that I can manage client identities visually instead of by hand.

**Building blocks:** `GET /api/v1/users` + `useUsers({role})` hook ALREADY EXIST (read-only). `RequireGrantor`, the `features/admin/` folder, and the grant-mutation hook pattern (`useCreateGrant`/`useRevokeGrant` in `useAccessGrants.ts`) ALREADY EXIST. The Users **screen**, a "Users" **nav tab**, and the provisioning **mutation hooks** (`useCreateUser`/`useResendInvite`) are **NET-NEW** (mirror the Access Control screen + grant mutations).

**Acceptance Criteria:**

**Given** the internal nav strip for an `admin`/`ma_tech` user
**When** it renders
**Then** a "Users" tab appears (its own tab, `grantorOnly` — same pattern as Access Control / Audit / Usage & Value), routed under `/internal/users` and wrapped in `<RequireGrantor>`; it is **not** present for `client` (no internal strip) or `consultant` (filtered by `grantorOnly` + guard redirect to `/internal/engagements`)

**Given** I open `/internal/users`
**When** the screen loads
**Then** it lists existing users (name, email, role) from `GET /api/v1/users` via `useUsers()`, with TanStack Query loading/error states, the response-envelope + snake→camel mapping, and no emoji (all glyphs via `<Icon>`)

**Given** I create a new client user (enter email, name; `role` fixed to `client`)
**When** I submit
**Then** a new `useCreateUser` mutation calls `POST /api/v1/users`, the list invalidates and shows the new user, and a success state communicates that Cognito has emailed the invitation

**Given** provisioning fails (duplicate email, Cognito error)
**When** the mutation rejects
**Then** the error is surfaced cleanly inline (no crash), reusing the app's `getErrorMessage(error)` pattern

**Given** a user with a pending invitation (USR-03)
**When** I choose "Resend invite"
**Then** a resend mutation is called (backed by `AdminResendInvitation`) and confirms — *(if USR-03 resend/disable is deferred, this AC moves to a follow-up; 10.2 minimally delivers list + create/invite)*

---

## Story 10.3: Provisioning ↔ Grant Handoff (Create-then-Grant)

As a Vitalief admin,
I want to create a client user and immediately grant them engagement access in one flow,
So that onboarding is a single action rather than "create user, then separately hunt for their id to grant access."

**Building blocks:** `create_grant()` + `POST /api/v1/access-grants` ALREADY EXIST and accept an **opaque `user_id`** (a Cognito `sub`) with **no users-table FK and no existence check** — so 10.3 reuses them unchanged. The FE `useCreateGrant` hook ALREADY EXISTS. The combined create-then-grant flow (UI + orchestration) is **NET-NEW**.

**Acceptance Criteria:**

**Given** the ADR's decision that create and grant remain distinct concerns with **no DB foreign key** between a user and a grant
**When** 10.3 is built
**Then** it introduces **no** users-table FK — the create→grant guarantee is **procedural**: provision the Cognito user first, take the returned `user_id` (`sub`), then call the existing `create_grant` with it

**Given** an admin uses the combined onboarding flow (from the Users screen or the Access Control screen)
**When** they create a new client user and pick a hierarchy node + `role=client`
**Then** the flow calls `POST /api/v1/users` (10.1) to create the identity, then `POST /api/v1/access-grants` with the returned `user_id`, and the new grant appears — the user is both invited and scoped in one action

**Given** the grantee is a freshly-provisioned **client** user
**When** `create_grant` runs
**Then** it succeeds (client is a grantable role); an internal-role grantee is still rejected with `422 INTERNAL_ROLE_NOT_GRANTABLE` (the guard covers `admin`/`ma_tech`/`consultant` — an operator is never a grantee, per Story 8.7)

**Given** the two-step flow partially fails (user created, grant fails)
**When** the error is handled
**Then** the UI communicates that the user was created but the grant did not apply (the user exists in the directory and can be granted access separately) — no silent inconsistency, no crash

---

## Story 10.4: First-Login Password Challenge + Invite Email Content

As a newly-invited user (client or consultant),
I want the invite email to tell me what I'm being invited to and where to sign in, and I want the app to actually let me set my password on first login,
So that I can activate my account without hitting a dead end.

**Discovered 2026-07-03** (post-10.2 manual smoke test, ma_tech creating a consultant user): confirmed **missing end-to-end** — not a regression, a scope gap left by 10.1/7.3 never being connected.

- **Confirmed gap 1 (FE, blocking):** `AdminCreateUser`-provisioned users always start in Cognito's `NEW_PASSWORD_REQUIRED` challenge state (10.1's default invite mode, `auth.py:627`). Amplify's `signIn()` resolves this as a `nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'` result, **not** a thrown error — but `login()` (`velara-web/src/shared/utils/auth.ts:147-168`) never inspects `nextStep` at all. It falls through to `fetchAuthSession()`, gets no real tokens, throws `"Authentication failed — no ID token returned."`, which `LoginPage`'s blanket catch (`LoginPage.tsx:57-59`, AC3's "map all rejections to one string") flattens to **"Invalid username or password."** — actively misleading, since the credentials were correct. There is no FE screen/step anywhere that calls Amplify's `confirmSignIn()` with a new password.
- **Confirmed gap 2 (BE, low-severity):** the invite email is Cognito's bare default template — `CognitoAuthProvider.create_user` (`auth.py:627-652`) invokes `AdminCreateUser` with `DesiredDeliveryMediums=["EMAIL"]` but no `MessageAction`/custom `ClientMetadata`/message template — so the email has zero product context (no "you've been invited to Velara," no login URL), just a bare username + temporary password.

**Building blocks:** Amplify `signIn()`/`confirmSignIn()` ALREADY AVAILABLE (`aws-amplify/auth`, already imported in `auth.ts`). Cognito `AdminCreateUser` supports a custom invite message via `MessageAction` + a **User Pool message template** (`AdminCreateUserConfig.InviteMessageTemplate`, Terraform-configurable on `aws_cognito_user_pool`) — no new AWS API, just wiring. No new DB state either.

**Acceptance Criteria (draft — refine at create-story):**

**Given** a user logs in for the first time with their Cognito-issued temporary password
**When** Amplify's `signIn()` resolves with `nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'`
**Then** the app shows a "set your new password" step (not a login failure) and calls `confirmSignIn({ challengeResponse: newPassword })` to complete sign-in, landing the user in the app exactly as a normal login would

**Given** the new-password step
**When** the user submits a password that fails Cognito's password policy
**Then** the error is shown inline (mirroring the existing `getErrorMessage`/inline-error convention) without losing entered state

**Given** an admin/ma_tech provisions a new user or resends an invite
**When** Cognito sends the invitation email
**Then** the email names Velara and states the login URL (`InviteMessageTemplate` on the user pool, applied via Terraform; verify whether `{username}`/`{####}` template placeholders need to be preserved for Cognito to inject the temp password)

**Given** this story ships
**When** 10.3 (create→grant handoff) is developed/tested
**Then** 10.3's manual verification is unblocked — a freshly-provisioned user can actually complete first login end-to-end (10.3 create-story should sequence after or alongside 10.4)

**Sequencing note:** discovered after 10.2, before 10.3 starts — recommend 10.4 lands before or alongside 10.3, since 10.3's own manual verification requires a working first-login path.

---

## Story 10.5: Forgot Password / Reset Password

As any logged-out user (client, consultant, admin, ma_tech) who has forgotten their password,
I want a self-service "Forgot password?" flow from the login screen,
So that I can regain access without asking an admin to re-provision or reset my account manually.

**Discovered 2026-07-03** (same session as 10.4, user-reported): confirmed **completely absent** — no route, no page, no "Forgot password?" link on `LoginPage.tsx`, and no `resetPassword`/`confirmResetPassword` calls anywhere in the FE (`aws-amplify/auth` exposes both; only `signIn`/`signOut` are currently imported in `auth.ts`). Distinct from Story 10.4: 10.4 is a Cognito-*forced* challenge during first login for freshly-provisioned users; this is a *self-service*, user-initiated flow for an already-active user who forgot their password later. Different Amplify calls, different trigger, independently buildable/testable — tracked separately from 10.4.

**Building blocks:** Amplify `resetPassword()` (sends the verification code) + `confirmResetPassword()` (submits code + new password) — both exported by `aws-amplify/auth`, same package already used for `signIn`/`signOut`. Cognito user pool already supports password-reset out of the box (no Terraform change expected — verify at create-story whether the pool's recovery mechanism / email settings need explicit configuration). No new DB state.

**Acceptance Criteria (draft — refine at create-story):**

**Given** the login screen
**When** it renders
**Then** a "Forgot password?" link is present and navigates to a new forgot-password screen/step

**Given** a user enters their email on the forgot-password screen
**When** they submit
**Then** the app calls Amplify `resetPassword({ username })`, and shows a confirmation that a code was emailed (success state must not reveal whether the email exists — avoid a user-enumeration oracle mirrored from the same class of finding raised in the 10.2 review)

**Given** a user has received the reset code
**When** they submit the code + a new password
**Then** the app calls `confirmResetPassword({ username, confirmationCode, newPassword })`, and on success routes them back to `/login` with a clear "password updated, sign in" message (mirrors the existing `?reason=expired` banner pattern on `LoginPage.tsx`)

**Given** an invalid/expired code or a password that fails Cognito's policy
**When** confirmation fails
**Then** the error is shown inline without losing the entered email/code (mirrors 10.4 and the rest of the app's error-handling conventions)

**Sequencing note:** independent of 10.4 — can be built in parallel or in either order. Both surfaced from the same manual-testing session and share `LoginPage.tsx`/`auth.ts`, so consider sequencing them adjacently to avoid merge friction on the same files.

---

## Notes for create-story

- **Sequence:** 10.1 (backend seam + route) → 10.2 (UI over it) → 10.3 (combines 10.1 + the existing grant flow). 10.3 depends on both. 10.4/10.5 are auth-lifecycle gaps discovered post-10.2 — sequence 10.4 before/alongside 10.3 (blocks 10.3's manual verification); 10.5 is independent and can run in parallel with either.
- **P2 (retro) status:** the Cognito-provisioning architecture ADR is **already written** (`core-architectural-decisions.md:181-203`), so create-story is unblocked on both P1 (this doc) and P2 (the ADR).
- **Grantor-gate decision (2026-07-03):** provisioning = `{admin, ma_tech}`, supersedes the ADR's older `consultant`/`ma_tech` phrasing. Bake `RejectNonGrantor` into 10.1.
- **Route shape:** the read route is `GET /api/v1/users`; the natural mutation counterpart is `POST /api/v1/users` on the same router (already `RejectClient`-gated + grantor-checked). Confirm at create-story whether a `POST /api/v1/users/{id}/resend-invite` (USR-03) lands in 10.2 or a follow-up.
- **Dev-shim is mandatory** (ADR): `DevAuthProvider.create_user` keeps `AUTH_BACKEND=dev` tests offline — do not skip it, or the integration suite can't exercise create→grant→login without Cognito.
