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

## Notes for create-story

- **Sequence:** 10.1 (backend seam + route) → 10.2 (UI over it) → 10.3 (combines 10.1 + the existing grant flow). 10.3 depends on both.
- **P2 (retro) status:** the Cognito-provisioning architecture ADR is **already written** (`core-architectural-decisions.md:181-203`), so create-story is unblocked on both P1 (this doc) and P2 (the ADR).
- **Grantor-gate decision (2026-07-03):** provisioning = `{admin, ma_tech}`, supersedes the ADR's older `consultant`/`ma_tech` phrasing. Bake `RejectNonGrantor` into 10.1.
- **Route shape:** the read route is `GET /api/v1/users`; the natural mutation counterpart is `POST /api/v1/users` on the same router (already `RejectClient`-gated + grantor-checked). Confirm at create-story whether a `POST /api/v1/users/{id}/resend-invite` (USR-03) lands in 10.2 or a follow-up.
- **Dev-shim is mandatory** (ADR): `DevAuthProvider.create_user` keeps `AUTH_BACKEND=dev` tests offline — do not skip it, or the integration suite can't exercise create→grant→login without Cognito.
