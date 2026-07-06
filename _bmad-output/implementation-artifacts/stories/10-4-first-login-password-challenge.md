---
baseline_commit: 34fa2c5fa4bac4def53901c4649d11fd92eb3502
---

# Story 10.4: First-Login Password Challenge + Invite Email Content

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a newly-invited user (client or consultant),
I want the invite email to tell me what I'm being invited to and where to sign in, and I want the app to actually let me set my password on first login,
So that I can activate my account without hitting a dead end.

## Context & Why This Story Exists

**Discovered 2026-07-03** (post-10.2 manual smoke test — an `ma_tech` created a consultant user, then tried to log in as that user). This is **not a regression** — it is a scope gap left because 10.1 (provisioning) and 7.3 (Cognito login) were never connected end-to-end. There is no users table and no migration; this is a **client-side auth-flow story with one small Terraform-only email-content change**.

Two confirmed gaps:

- **Gap 1 (FE, BLOCKING).** Every `AdminCreateUser`-provisioned user starts in Cognito's `FORCE_CHANGE_PASSWORD` state (10.1's default invite mode, `velara-api/app/integrations/auth.py:649-664`). When they sign in with the temp password, Amplify's `signIn()` **resolves** (does not throw) with `{ isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' } }`. But `login()` (`velara-web/src/shared/utils/auth.ts:147-186`) discards the `signIn()` result entirely, falls straight through to `fetchAuthSession()`, gets no ID token, and throws `"Authentication failed — no ID token returned."`. `LoginPage`'s blanket catch (`LoginPage.tsx:57-59`) then flattens that to **"Invalid username or password."** — actively misleading, since the credentials were correct. No FE code anywhere calls `confirmSignIn()`.

- **Gap 2 (Terraform, low-severity).** The invite email is Cognito's bare account-default template — `CognitoAuthProvider.create_user` invokes `AdminCreateUser` in default invite mode with no message template, and the user pool has **no** `admin_create_user_config.invite_message_template` block (`velara-api/terraform/cognito.tf`). So the email has zero product context (no "you've been invited to Velara", no login URL), just a bare username + temporary password.

**Sequencing:** This story unblocks 10.3's (create→grant handoff) manual end-to-end verification — a freshly-provisioned user can't complete first login without Gap 1's fix. Build 10.4 before or alongside 10.3. Independent of 10.5 (self-service forgot-password), though they share `LoginPage.tsx`/`auth.ts`.

## Acceptance Criteria

**AC1 — New-password challenge is handled (Gap 1, primary).**
Given a user logs in for the first time with their Cognito-issued temporary password,
When Amplify's `signIn()` resolves with `nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'`,
Then the app shows a "set your new password" step (NOT a login failure), and on submit calls `confirmSignIn({ challengeResponse: newPassword })`; on success the user lands in the app exactly as a normal login would (same role-aware redirect, same `from` deep-link handling).

**AC2 — Password-policy errors are shown truthfully inline.**
Given the new-password step,
When the user submits a password that fails Cognito's policy (e.g. `InvalidPasswordException`),
Then the **real** error message is shown inline (via `getErrorMessage`), the entered value is NOT lost, and the user stays on the new-password step. This deliberately DIVERGES from the login step's blanket `"Invalid username or password."` — the login step hides field-level detail for anti-enumeration (AC3 of 7.3), but a password-policy rejection must tell the user *why* their chosen password was rejected or they can't proceed.

**AC3 — Login step behavior is preserved (no regression).**
Given an ordinary (already-active) user with correct or incorrect credentials,
When they sign in,
Then behavior is unchanged from today: success → role-aware redirect; any genuine auth failure → the single `"Invalid username or password."` string; `?reason=expired` banner still shown; empty-field disabling intact. The `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` branch is the ONLY new path.

**AC4 — Branded invite email (Gap 2).**
Given an admin/ma_tech provisions a new user or resends an invite,
When Cognito sends the invitation email,
Then the email names Velara and states the login URL. This is implemented via `admin_create_user_config.invite_message_template` on `aws_cognito_user_pool.main` in `cognito.tf`, applied via Terraform. **The `email_message` MUST literally contain both `{username}` and `{####}`** (Cognito injects the username and temp password) or `terraform apply` fails with `InvalidParameterException`. Because RESEND reuses the same pool template, this covers both create and resend with one change — no `auth.py` change.

**AC5 — Quality gates.**
Given the story is implemented,
When the FE gates run,
Then `tsc --noEmit` is clean, `eslint` is clean (the one pre-existing `Icon.tsx` react-refresh warning aside), and `vitest run` is fully green with net-new tests covering the challenge path (unit tests on `auth.ts` + component tests on `LoginPage`). Terraform: `terraform fmt` + `terraform validate` clean; the invite template is plain-ASCII (see Dev Notes trap).

## Tasks / Subtasks

- [x] **Task 1 — Refactor `auth.ts` to handle the new-password challenge (AC1, AC3).** `velara-web/src/shared/utils/auth.ts`
  - [x] Import `confirmSignIn` alongside `signIn`/`signOut`/`fetchAuthSession` from `aws-amplify/auth`.
  - [x] Factor the existing `login()` tail (`auth.ts:164-185`: `fetchAuthSession` → read `idToken` → `_decodeIdTokenClaims` → build `AuthUser` → required-claims check → `setSession` → return) into a **private shared helper** (e.g. `async function _finishSignIn(): Promise<AuthUser>`). Both `login()` and the new `completeNewPassword()` call it — do NOT duplicate the token-decode/claims logic.
  - [x] In `login()`, capture the `signIn()` result: `const { isSignedIn, nextStep } = await signIn({ username, password })`. Preserve the existing `UserAlreadyAuthenticatedException` retry (`auth.ts:150-162`) — capture its result too. If `nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'`, do NOT call `_finishSignIn()`; instead **signal** the challenge to the caller. Recommended signal: change `login()`'s return type to a discriminated union, e.g. `Promise<{ status: 'done'; user: AuthUser } | { status: 'new_password_required' }>`. (Alternative: a sentinel value — but a typed union is cleaner and lets LoginPage's `switch`/`if` be exhaustive.) On `isSignedIn === true` (normal login), call `_finishSignIn()` and return `{ status: 'done', user }`.
  - [x] Add `export async function completeNewPassword(newPassword: string): Promise<AuthUser>` that calls `confirmSignIn({ challengeResponse: newPassword })`, then calls `_finishSignIn()` and returns the `AuthUser`. Let `confirmSignIn` rejections propagate (LoginPage surfaces the real message). Do NOT map to a blanket string here.
  - [x] **Update `LoginPage.tsx`'s single caller** to the new `login()` return shape (see Task 2) — this is a breaking signature change; grep confirmed `LoginPage.tsx:36` is the ONLY non-test caller.

- [x] **Task 2 — Add the new-password sub-state to LoginPage (AC1, AC2).** `velara-web/src/pages/LoginPage.tsx`
  - [x] Add a `phase` state: `'credentials' | 'new_password'` (default `'credentials'`). The new-password step is a **sub-state of LoginPage inside the same card — NOT a new route** (the Amplify challenge lives in in-memory auth state between `signIn` and `confirmSignIn`; a route nav would lose it, and there's no token to gate a new route). `App.tsx:24-31`'s `!isAuthenticated()` guard will NOT evict a mid-challenge LoginPage because no token is set until the challenge completes.
  - [x] In `handleLogin`, on `{ status: 'new_password_required' }` set `phase = 'new_password'` and clear `error`/`loading`. On `{ status: 'done', user }` run the EXISTING redirect logic unchanged (`LoginPage.tsx:37-56`). Keep the blanket-catch `"Invalid username or password."` for the credentials phase (AC3).
  - [x] Render a new-password form when `phase === 'new_password'`: a "Set a new password" heading, a `New password` field (`type="password"`, `autoComplete="new-password"`), and a submit button. On submit call a new `handleSetNewPassword` that awaits `completeNewPassword(newPassword)`, then runs the **same** `setRole` + role-aware redirect as the done branch (factored into a small local `redirectAfterAuth(user)` helper so both branches share it). (Confirm-password field omitted — task marked it optional and no AC requires it.)
  - [x] **AC2 error handling:** wrap `handleSetNewPassword` in try/catch; on error `setError(getErrorMessage(err))` (import from `@/shared/utils/errors`) — the REAL Cognito message, NOT the blanket string. Do NOT reset the entered password value on error (EXPERIENCE.md rule: never lose form values). Keep the user on the `new_password` phase.
  - [x] Reuse the SAME Tailwind theme tokens the card already uses (`bg-paper`/`bg-surface`/`border-line`/`text-ink`/`text-brand-900`/`bg-brand-800`/`hover:bg-brand-700`/`focus:ring-brand-700`, `text-red-600` for the error `<p>`). No emoji.
  - [x] a11y: give the error `<p>` `role="alert"` on the new-password path (credentials-phase error `<p>` left unchanged, per the house convention described in the task).

- [x] **Task 3 — Invite email template (Gap 2, AC4).** `velara-api/terraform/cognito.tf`
  - [x] Added an `admin_create_user_config { invite_message_template { ... } }` block to `resource "aws_cognito_user_pool" "main"`. `email_subject = "You've been invited to Velara"`, `email_message` contains both `{username}` and `{####}` literally, includes the dev login URL (`https://d2yo81lbjfacze.cloudfront.net/login`), and mentions the 7-day temp-password expiry.
  - [x] **ASCII TRAP:** verified plain-ASCII via `grep -P '[^\x00-\x7F]'` (no em-dash/curly quotes/ellipsis/emoji).
  - [x] No `auth.py` change made — email content is 100% pool-template-driven; `resend_invite`'s `MessageAction="RESEND"` reuses the same template.
  - [x] `terraform fmt` (auto-aligned one line) + `terraform validate` — both clean.

- [x] **Task 4 — Unit tests for `auth.ts` (AC1, AC5).** `velara-web/src/shared/utils/auth.test.ts`
  - [x] Added `confirmSignIn: vi.fn()` to the `vi.mock('aws-amplify/auth', ...)` factory and imported it.
  - [x] Test: `login()` new-password-required path → returns `{ status: 'new_password_required' }`, does not call `fetchAuthSession`, does not persist a session.
  - [x] Test: `login()` DONE path → returns `{ status: 'done', user }` and persists the session. Existing `login()` tests updated to the new return shape.
  - [x] Test: `completeNewPassword('NewPass123!')` → calls `confirmSignIn` with `{ challengeResponse: 'NewPass123!' }`, persists session, returns `AuthUser`.
  - [x] Test: `completeNewPassword()` rejection (`InvalidPasswordException`) → error message propagates unswallowed.

- [x] **Task 5 — Component tests for LoginPage (AC1, AC2, AC3, AC5).** `velara-web/src/pages/LoginPage.test.tsx`
  - [x] Added `completeNewPassword` to the `@/shared/utils/auth` mock + `confirmSignIn: vi.fn()` to the `aws-amplify/auth` factory.
  - [x] Test: `login` resolves `new_password_required` → new-password heading/field renders, credentials error NOT shown, no redirect.
  - [x] Test: submit from new-password phase → `completeNewPassword` called with entered password; role-aware redirect fires; `setRole` called.
  - [x] Test (AC2): `completeNewPassword` rejects with a policy error → real message renders inline, password field value preserved, user stays on new-password phase.
  - [x] Test (AC3 regression): existing login-success/`from`-redirect/client-redirect/blanket-error tests updated to `{ status: 'done', user: MOCK_USER }` — all still pass.

- [x] **Task 6 — Run gates & update story record (AC5).**
  - [x] FE: `cd velara-web && npx tsc --noEmit && npx eslint . && npx vitest run` — all green (tsc 0 errors; eslint 0 errors/1 pre-existing warning; vitest 489/489 passed across 50 files, +6 net-new over the 483/50 baseline).
  - [x] Terraform: `cd velara-api/terraform && terraform fmt -check && terraform validate` — clean.
  - [x] Dev Agent Record filled below. Manual verification against live Cognito was NOT performed in this session (would require a freshly-provisioned `FORCE_CHANGE_PASSWORD` user against the live `AUTH_BACKEND=cognito` stack) — left to the operator per the 9.3/Cognito-session hazard in project memory; the challenge path is fully covered by the automated unit/component tests instead.

### Review Findings

- [x] [Review][Patch] Invite email greets users with a UUID, not their email — pool is `username_attributes=["email"]` so Cognito assigns an immutable UUID username and `{username}` renders as "Hello 3f2a9c1e-…"; reword the template so `{username}` is not the greeting (it must still literally appear) and tell users to sign in with their email address [velara-api/terraform/cognito.tf:76]
- [x] [Review][Patch] Invite email hardcodes the dev CloudFront URL — a staging/prod apply would send invites pointing at the dev distribution; interpolate `var.frontend_url` (already used by `callback_urls`/`logout_urls` at cognito.tf:143-144) with the localhost fallback pattern [velara-api/terraform/cognito.tf:76]
- [x] [Review][Patch] `allow_admin_create_user_only` left unset (defaults false) — the public `SignUp` API stays open on an invite-only pool with a secretless SPA client id; add `allow_admin_create_user_only = true` to the new `admin_create_user_config` block [velara-api/terraform/cognito.tf:74]
- [x] [Review][Patch] No "Back to sign in" affordance from the new-password phase — if the short-lived Cognito challenge session expires (or `confirmSignIn` succeeds but the session fetch fails), the user is dead-ended on the form with only a manual reload as recovery; add a link resetting `phase`/`error`/`newPassword` [velara-web/src/pages/LoginPage.tsx]
- [x] [Review][Patch] `?reason=expired` banner persists into the new-password phase — a first-login user arriving via a session-expired redirect sees "session expired" contradicting "Set a new password"; gate the banner on `phase === 'credentials'` [velara-web/src/pages/LoginPage.tsx:107]
- [x] [Review][Patch] "expires in 7 days" literal duplicates `temporary_password_validity_days = 7` with no coupling — extract a shared `locals` value so the email can't silently lie if the policy changes [velara-api/terraform/cognito.tf:22,76]
- [x] [Review][Patch] Temporary password retained in React state for the whole new-password phase — clear `password` when switching to `phase = 'new_password'` [velara-web/src/pages/LoginPage.tsx]
- [x] [Review][Patch] Missing test: client-role user completing the challenge (redirect to `/client/dashboard` + `setRole('client')`) — first login IS the primary flow for newly-provisioned client users in Epic 10 [velara-web/src/pages/LoginPage.test.tsx]
- [x] [Review][Defer] Other `signIn` nextStep values (MFA codes/setup, `RESET_PASSWORD`, `CONFIRM_SIGN_UP`) still fall through to the blanket "Invalid username or password." [velara-web/src/shared/utils/auth.ts] — deferred, pre-existing (identical fall-through existed before this story; MFA is OFF in dev / OPTIONAL elsewhere with no forced enrollment; 10.5 adds the reset flow)
- [x] [Review][Defer] `completeNewPassword` ignores `confirmSignIn`'s returned nextStep — a chained challenge would surface the raw "no ID token" error [velara-web/src/shared/utils/auth.ts:216] — deferred, unreachable today (no forced MFA setup; story Dev Notes explicitly scoped chained challenges out; the partial-success resubmit trap is mitigated by the "Back to sign in" patch)
- [x] [Review][Defer] No tests for unhandled nextStep values / chained challenges [velara-web/src/shared/utils/auth.test.ts] — deferred, tests for the two deferred branches above; add together when MFA/reset handling lands

## Dev Notes

### The core seam (read this first)
`login()` at `velara-web/src/shared/utils/auth.ts:147-186` is the **single mutation point**. Today it does `await signIn({ username, password })` and **throws away the result**, always proceeding to `fetchAuthSession()`. The fix: inspect `signIn()`'s `{ isSignedIn, nextStep }`; branch on `nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'`; add a `completeNewPassword(newPassword)` companion that wraps `confirmSignIn({ challengeResponse })` and shares the token-decode tail. `LoginPage.tsx:36` is the ONLY non-test caller of `login()` (grep-verified) — updating its call site is safe and contained.

### Amplify v6 API shape (verified against installed `aws-amplify@6.17.0`)
- `signIn(input) => Promise<{ isSignedIn: boolean; nextStep: AuthNextSignInStep }>`.
- `nextStep` is a discriminated union on `signInStep`; `'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'` and `'DONE'` are exact valid members. The challenge member may carry `missingAttributes?: string[]` — for Velara's pool this should be empty (invite sets `name`/`email`/`custom:*` at `AdminCreateUser`), so `confirmSignIn({ challengeResponse: newPassword })` with no `options.userAttributes` suffices. (If `missingAttributes` were ever non-empty, confirm would need `options: { userAttributes }` — out of scope; note it and move on.)
- `confirmSignIn(input) => Promise<{ isSignedIn: boolean; nextStep }>`. Input requires `challengeResponse: string`. It is a named export of `aws-amplify/auth`, currently unused anywhere in the FE.

### Error-handling divergence (AC2 vs AC3) — the subtle part
- **Credentials phase** keeps the blanket `"Invalid username or password."` (7.3 AC3 anti-enumeration — `LoginPage.tsx:57-59`). Unchanged.
- **New-password phase** shows the REAL error via `getErrorMessage(err)` (`velara-web/src/shared/utils/errors.ts:2-5`, returns `error.message` verbatim). Amplify v6 errors carry the real Cognito text in `.message` (e.g. `InvalidPasswordException` → "Password did not conform with policy: ..."). Do NOT use the API-error helpers (`getApiCode`/`getApiMessage`) — those key off `err.response.data.error` (axios shape); Amplify errors are plain `Error`s.

### Gap 2 is Terraform-only
The invite-email content is 100% controlled by the pool's `admin_create_user_config.invite_message_template` (absent today), NOT by the `auth.py` boto3 calls. See Task 3. **Non-negotiable:** `email_message` must contain `{username}` and `{####}` or apply fails. Keep it plain-ASCII. `AUTH_BACKEND=dev` never touches Cognito or email (`DevAuthProvider.create_user` is an in-memory shim), so there's nothing to test on the dev backend for Gap 2 and no email assertion is possible offline — Gap 2's verification is `terraform validate` + (operator) apply.

### Files being modified — current state & what to preserve
- **`velara-web/src/shared/utils/auth.ts`** (UPDATE): the auth boundary. Preserve: the `UserAlreadyAuthenticatedException` retry path (`:150-162`), the `_decodeIdTokenClaims` signature-free decode (`:125-135`), the required-claims check (`:180-182`), the atomic `setSession`, and the ID-token (not access-token) choice. Only ADD the challenge branch + `completeNewPassword` + the `_finishSignIn` extraction.
- **`velara-web/src/pages/LoginPage.tsx`** (UPDATE): preserve the role-aware + cross-tree-clamped redirect (`:37-56`), the `?reason=expired` banner (`:74-78`), the empty-field disabling (`:115`). Only ADD the `phase` state and the new-password form.
- **`velara-web/src/pages/LoginPage.test.tsx`** and **`src/shared/utils/auth.test.ts`** (UPDATE): existing tests assert the OLD `login()` return shape and must be updated (Tasks 4/5). This is the primary regression risk — the return-type change ripples into every `mockResolvedValue(...)`.
- **`velara-api/terraform/cognito.tf`** (UPDATE): `aws_cognito_user_pool.main` has NO `admin_create_user_config` today. `username_attributes=["email"]`, `email_configuration.email_sending_account="COGNITO_DEFAULT"` (caps ~50 emails/day; branded high-volume SES is a documented Phase-2, out of scope). App client already has `ALLOW_USER_SRP_AUTH` + `ALLOW_USER_PASSWORD_AUTH` — **no auth-flow change needed** for `confirmSignIn`.

### Testing standards
- Runner: Vitest (`vitest run`). jsdom + `@testing-library/react`. Global setup `src/test/setup.ts` clears `sessionStorage` + `document.title` in `afterEach`. No shared render helper — each file rolls its own `MemoryRouter` render (LoginPage's `renderLogin` at `:38-47`).
- Two mock strategies coexist: `auth.test.ts` mocks `aws-amplify/auth` directly (unit-tests `login`/`completeNewPassword`); `LoginPage.test.tsx` mocks `@/shared/utils/auth` (component-tests the LoginPage state machine). Both need the new symbols added to their mock factories.
- Baseline before this story: **483 FE tests / 50 files** (10.2 landed at 483/483). Keep it green; add the net-new challenge tests.

### Scope boundaries (do NOT do these)
- No new route for the new-password step — it's a LoginPage sub-state.
- No SES/branded-email pipeline — Gap 2 is the Cognito pool template only (branded SES is an explicit Phase-2 per the Epic-10 ADR).
- No forgot-password/self-service reset — that's Story 10.5, distinct Amplify calls (`resetPassword`/`confirmResetPassword`).
- No `auth.py` / boto3 / IAM change for the email (template-driven). No migration (identities live in Cognito).
- Do NOT weaken the credentials-phase blanket error (AC3) — only the new-password phase shows real errors.

### Project Structure Notes
- FE auth lives in `src/shared/utils/auth.ts` (the single boundary) + `src/pages/LoginPage.tsx`. Tailwind v4 (`@theme` tokens, no `tailwind.config` file). No-emoji-icons rule enforced (use `src/shared/components/Icon.tsx`).
- Terraform lives in `velara-api/terraform/`; applied manually by operator, not in CI.
- Commit style (FE-only story): `feat(auth): Story 10.4 — first-login password challenge + invite email (Epic 10)` on both repos if the Terraform change lands in velara-api.

### References
- [Source: _bmad-output/planning-artifacts/epics/epic-10-client-user-provisioning.md#Story 10.4] — story + both gaps + ACs.
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Client User Provisioning] — the provisioning ADR (Cognito owns invite email; branded SES is Phase-2).
- [Source: velara-web/src/shared/utils/auth.ts#login] — the seam (`:147-186`).
- [Source: velara-web/src/pages/LoginPage.tsx#handleLogin] — the caller + blanket-error convention (`:36`, `:57-59`).
- [Source: velara-web/src/shared/utils/errors.ts#getErrorMessage] — inline real-error helper (`:2-5`).
- [Source: velara-api/terraform/cognito.tf#aws_cognito_user_pool.main] — pool resource (no invite template today).
- [Source: velara-api/app/integrations/auth.py#CognitoAuthProvider.create_user] — default invite mode, template-driven email (`:622-697`); `resend_invite` RESEND (`:699-761`).
- [Source: _bmad-output/implementation-artifacts/stories/10-2-user-management-screen.md#Dev Agent Record] — FE conventions (aria-live/role=alert, never-lose-form-values, Tailwind v4, no-emoji, invited=FORCE_CHANGE_PASSWORD state).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Code)

### Debug Log References

None — no debugging blockers encountered. All tests passed on first implementation pass; `terraform fmt` auto-corrected one alignment whitespace diff (non-functional).

### Completion Notes List

- Refactored `auth.ts`: `login()` now returns a discriminated union (`{status:'done',user}` | `{status:'new_password_required'}`); shared token-decode tail extracted into private `_finishSignIn()`; added `completeNewPassword(newPassword)` wrapping `confirmSignIn`. The `UserAlreadyAuthenticatedException` retry path preserved.
- Updated `LoginPage.tsx`'s single caller to the new return shape; added a `phase` sub-state (`'credentials' | 'new_password'`) rendered inside the same card (no new route); added `redirectAfterAuth(user)` helper shared by both the normal-login and challenge-completion paths; new-password errors show the real Cognito message via `getErrorMessage` (AC2), diverging deliberately from the credentials phase's blanket `"Invalid username or password."` (AC3, unchanged).
- Added `admin_create_user_config.invite_message_template` to `aws_cognito_user_pool.main` in `cognito.tf` (Gap 2) — plain-ASCII, contains both `{username}` and `{####}`, includes the dev login URL and the 7-day temp-password expiry note. No `auth.py`/IAM/migration change; `resend_invite`'s RESEND action reuses the same template.
- Net-new tests: 3 in `auth.test.ts` (new_password_required branch, `completeNewPassword` success, `completeNewPassword` rejection) + 3 in `LoginPage.test.tsx` (challenge-step render, challenge-completion redirect, AC2 inline real-error-with-preserved-value). All 4 pre-existing login-success/redirect/blanket-error tests updated to the new `login()` return shape and still pass.
- Gates: `tsc --noEmit` 0 errors; `eslint .` 0 errors (1 pre-existing `Icon.tsx` react-refresh warning, unrelated); `vitest run` 489/489 passed across 50 files (baseline 483/50, +6 net-new); `terraform fmt -check` + `terraform validate` clean.
- Manual end-to-end verification against live Cognito (a real `FORCE_CHANGE_PASSWORD` user completing the challenge, and a real invite email render) was NOT performed in this session — left to the operator, consistent with project guidance against reconfiguring/restarting the live `AUTH_BACKEND=cognito` stack just to verify. The challenge branch logic and email-template Terraform are otherwise fully covered by automated tests + `terraform validate`.

### File List

- `velara-web/src/shared/utils/auth.ts` (modified)
- `velara-web/src/shared/utils/auth.test.ts` (modified)
- `velara-web/src/pages/LoginPage.tsx` (modified)
- `velara-web/src/pages/LoginPage.test.tsx` (modified)
- `velara-api/terraform/cognito.tf` (modified)

## Change Log

| Date | Version | Description |
|------|---------|-------------|
| 2026-07-06 | 0.2.0 | Code review (3-layer adversarial): 8 patches applied — invite email reworded ({username} renders the pool UUID on an email-as-username pool, so it moved to an account-ID footer), login URL now `var.frontend_url`-driven (was hardcoded dev CloudFront), `allow_admin_create_user_only = true` (public SignUp was open on the invite-only pool), temp-password expiry tied to `temporary_password_validity_days` via a shared local, "Back to sign in" escape from the new-password phase (challenge-session expiry recovery), `?reason=expired` banner gated to the credentials phase, temp password cleared from state on phase switch, +3 tests (client-role challenge completion, back-affordance, banner gating). 3 findings deferred → deferred-work.md; 4 dismissed. Gates re-run: tsc/eslint clean, vitest 492/492, terraform fmt/validate clean, template ASCII-clean. Status → done. |
| 2026-07-06 | 0.1.0 | Story 10.4 implemented: Gap 1 — `auth.ts login()` now handles Cognito's `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` challenge via a discriminated-union return + new `completeNewPassword()`; `LoginPage.tsx` gains a `new_password` sub-state (same-card, no new route) with AC2's real-error-inline behavior (credentials-phase blanket error unchanged, AC3). Gap 2 — `cognito.tf` gains a branded, ASCII-only `admin_create_user_config.invite_message_template` covering both create and resend. 6 net-new FE tests (489/50 total, +6 over 483/50 baseline, 0 regressions). `tsc`/`eslint`/`vitest` clean; `terraform fmt`/`validate` clean. Manual live-Cognito verification left to the operator (no live-container reconfiguration performed). Status → review. |
