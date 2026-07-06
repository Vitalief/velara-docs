---
baseline_commit: 0f5455dc4edcd377608c423eaa0c7181fc473b5b
---

# Story 10.5: Forgot Password / Reset Password

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any logged-out user (client, consultant, admin, ma_tech) who has forgotten their password,
I want a self-service "Forgot password?" flow from the login screen,
So that I can regain access without asking an admin to re-provision or reset my account manually.

## Context & Why This Story Exists

**Discovered 2026-07-03** (same session as 10.4, user-reported): confirmed **completely absent** — no route, no page, no "Forgot password?" link on `LoginPage.tsx`, and no `resetPassword`/`confirmResetPassword` calls anywhere in the FE. This is the last Epic 10 story; 10.5 is **independent of 10.4** but shares `LoginPage.tsx`/`auth.ts`, so it's sequenced adjacently to avoid merge friction.

**Distinct from 10.4:** 10.4 is a Cognito-*forced* `NEW_PASSWORD_REQUIRED` challenge during first login (lives in in-memory Amplify state between `signIn`/`confirmSignIn`). 10.5 is a *self-service, user-initiated* flow for an already-active user who forgot their password later — different Amplify calls (`resetPassword` → `confirmResetPassword`), keyed on `username`, no signed-in session at the end (it routes back to `/login`).

**This is a FE-only story. No backend, no migration, and — confirmed — NO Terraform change.** The Cognito pool already has everything self-service reset needs (verified in `cognito.tf`): `account_recovery_setting { recovery_mechanism verified_email }`, `auto_verified_attributes = ["email"]`, `email_configuration COGNITO_DEFAULT`, and — critically — `prevent_user_existence_errors = "ENABLED"` on the SPA app client, which closes the user-enumeration oracle at the pool level. `allow_admin_create_user_only = true` blocks self-*signup* only, NOT self-service reset.

**Design decision (locked at create-story):** implement as **same-card phases on `LoginPage`**, reusing 10.4's exact `phase`-state pattern — NOT a new route/page. Extend `phase` from `'credentials' | 'new_password'` to add `'forgot_request'` and `'forgot_confirm'`. Zero `App.tsx` change, reuses the card shell / banner / `getErrorMessage` wiring.

## Acceptance Criteria

**AC1 — "Forgot password?" entry point.**
Given the login screen (credentials phase),
When it renders,
Then a "Forgot password?" affordance is present (mirror the existing "Back to sign in" `<button type="button">` at `LoginPage.tsx:198-204`), and activating it switches the card to the forgot-request phase (email entry).

**AC2 — Request a reset code (enumeration-safe).**
Given the forgot-request phase,
When the user enters their email and submits,
Then the app calls `requestPasswordReset(username)` (wrapping Amplify `resetPassword({ username })`), and advances to the code-entry phase showing a **neutral** confirmation ("If an account exists for that email, we've sent a reset code.") — the success state must NOT reveal whether the email exists. `UserNotFoundException` is caught and treated as success (advance to code entry with the same neutral message), so the flow is enumeration-safe even if pool config ever drifts. Genuine operational errors (`LimitExceededException`/`TooManyRequestsException`) DO surface via `getErrorMessage` (they're not enumeration leaks) and keep the user on the request phase without losing the entered email.

**AC3 — Confirm the reset (code + new password).**
Given the code-entry phase (username already known from AC2),
When the user submits the emailed code + a new password,
Then the app calls `confirmPasswordReset(username, code, newPassword)` (wrapping Amplify `confirmResetPassword({ username, confirmationCode, newPassword })`), and on success returns the user to the credentials phase with a clear "password updated — sign in" success banner.

**AC4 — Confirm-step errors are shown truthfully inline.**
Given the code-entry phase,
When confirmation fails (invalid/expired code → `CodeMismatchException`/`ExpiredCodeException`, or a password failing Cognito's policy → `InvalidPasswordException`),
Then the REAL error message is shown inline via `getErrorMessage` (mirroring 10.4's new-password step, `role="alert"`), WITHOUT losing the entered email/code — the user stays on the code-entry phase. (Here the username is already known, so surfacing the real message leaks no enumeration signal.)

**AC5 — Password-policy expectations are visible.**
Given the new-password field on the code-entry phase,
When it renders,
Then it communicates the pool policy (min 12 chars; upper + lower + number + symbol) so the user can satisfy it before submitting (hint text; the authoritative check is still Cognito's, surfaced via AC4).

**AC6 — No regression to login / first-login.**
Given the credentials and new-password (10.4) phases,
When a normal login or first-login challenge runs,
Then behavior is unchanged: role-aware redirect on success, blanket `"Invalid username or password."` on genuine auth failure, `?reason=expired` banner still shown (credentials phase only), 10.4's challenge + "Back to sign in" intact. The two new phases are additive.

**AC7 — Quality gates.**
Given the story is implemented,
When the FE gates run,
Then `tsc --noEmit` is clean, `eslint` is clean (the one pre-existing `Icon.tsx` react-refresh warning aside), and `vitest run` is fully green with net-new tests covering: the Forgot-password link → request phase, request success (neutral message + advance) + `UserNotFoundException`-as-success, `LimitExceededException` surfaces, confirm success → credentials phase + success banner, and confirm-error inline-with-preserved-state. Baseline is **492/492 across 50 files** — keep green, add net-new.

## Tasks / Subtasks

- [x] **Task 1 — Add two reset helpers to `auth.ts` (AC2, AC3).** `velara-web/src/shared/utils/auth.ts`
  - [x] Extend the Amplify import (`auth.ts:24`) to add `resetPassword, confirmResetPassword` (currently `confirmSignIn, fetchAuthSession, signIn, signOut`).
  - [x] `export async function requestPasswordReset(username: string): Promise<void>` wrapping `await resetPassword({ username })`. Keep it thin — the enumeration-defensive `UserNotFoundException` handling lives in the LoginPage caller (or here, if you prefer: catch `UserNotFoundException` and resolve normally, but re-throw everything else so `LimitExceededException` still surfaces). Document which layer owns the catch. Recommended: own the catch HERE so LoginPage stays simple — `try { await resetPassword({ username }) } catch (err) { if (err?.name !== 'UserNotFoundException') throw err }`. Return `void` (the neutral message is UI copy; do NOT return `codeDeliveryDetails` — do not branch UI on whether it exists).
  - [x] `export async function confirmPasswordReset(username: string, code: string, newPassword: string): Promise<void>` wrapping `await confirmResetPassword({ username, confirmationCode: code, newPassword })`. Let all rejections propagate (LoginPage surfaces the real message via `getErrorMessage`). Note the Amplify input field is `confirmationCode`, not `code`.
  - [x] Do NOT touch `_finishSignIn`/`login`/`completeNewPassword` — reset does not sign the user in (`confirmResetPassword` returns `void`); the user re-authenticates via the normal login form afterward.

- [x] **Task 2 — Extend LoginPage with the two forgot phases (AC1–AC6).** `velara-web/src/pages/LoginPage.tsx`
  - [x] Extend the `phase` union (`LoginPage.tsx:27`) to `'credentials' | 'new_password' | 'forgot_request' | 'forgot_confirm'`. Add state: `resetEmail` (the username for the reset, carried from request → confirm), `resetCode`, `resetNewPassword`, and a `resetSuccess` boolean (or reuse a URL `?reason=reset` banner — see below).
  - [x] **AC1:** on the credentials form, add a "Forgot password?" `<button type="button">` (mirror "Back to sign in" styling, `:198-204`) that does `setPhase('forgot_request'); setError(null)`.
  - [x] **`forgot_request` phase:** an email input (reuse the credentials email field's classes/`autoComplete="email"`) + a "Send reset code" submit + a "Back to sign in" button (setPhase('credentials')). `handleRequestReset`: `await requestPasswordReset(resetEmail)`, on success `setPhase('forgot_confirm')` and show the neutral message on the next phase; on error, if it's a rate-limit/other error show `getErrorMessage(err)` inline WITHOUT losing `resetEmail` (the helper already swallows `UserNotFoundException`, so any error reaching here is a genuine one). Disable submit while pending / when email empty.
  - [x] **`forgot_confirm` phase:** show the neutral "If an account exists for that email, we've sent a reset code." message (AC2), a code input (`inputMode="numeric"`, `autoComplete="one-time-code"`), a new-password input (`type="password"`, `autoComplete="new-password"`) with the policy hint text (AC5: "At least 12 characters, with upper- and lower-case letters, a number, and a symbol."), a "Reset password" submit, and a "Back to sign in" button. `handleConfirmReset`: `await confirmPasswordReset(resetEmail, resetCode, resetNewPassword)`, on success return to credentials with the success banner (`setPhase('credentials'); setResetSuccess(true)` and clear the reset fields); on error `setError(getErrorMessage(err))` with `role="alert"`, keep the user on `forgot_confirm`, preserve entered code/password (AC4).
  - [x] **Success banner (AC3):** on returning to credentials after a successful reset, show a green success banner ("Password updated — please sign in.") gated to `phase === 'credentials'`, mirroring the amber `?reason=expired` banner's structure (`:119-123`) but with green tokens (e.g. `text-brand-800 bg-brand-50 border-brand-100` — reuse existing tokens, no net-new). Prefer a local `resetSuccess` flag over a `/login?reason=reset` URL round-trip since we're staying same-card (no navigation needed); if you do use the URL param, add `searchParams.get('reason') === 'reset'` alongside the existing `expired` read and note the sole `?reason=expired` producer is `client.ts:71`.
  - [x] Heading (`:117`) switches per phase: `'Reset your password'` for the two forgot phases, keeping `'Set a new password'` (10.4) and `'Sign in'` (default).
  - [x] Keep `usePageTitle('Sign In')` unchanged (single title for the card). No emoji; reuse existing token classes; `role="alert"` on error paragraphs.

- [x] **Task 3 — Tests (AC1–AC7).** `velara-web/src/pages/LoginPage.test.tsx`
  - [x] Add `resetPassword: vi.fn()` + `confirmResetPassword: vi.fn()` to the `vi.mock('aws-amplify/auth', ...)` factory (`:12-18`) — REQUIRED because `auth.ts` imports them at module level; omitting them breaks every LoginPage test.
  - [x] Add `requestPasswordReset` + `confirmPasswordReset` to the `@/shared/utils/auth` spy mock (`:21-30`, the `importOriginal`-spread block that already spies `login`/`completeNewPassword`/`logout`).
  - [x] Test (AC1): "Forgot password?" link renders on credentials; clicking it shows the email-request phase.
  - [x] Test (AC2): submit email → `requestPasswordReset` called with the email; advances to confirm phase with the neutral message. Second case: `requestPasswordReset` resolves even when the underlying email is unknown (helper swallows `UserNotFoundException`) → still advances (assert no existence leak in copy). Third case: `requestPasswordReset` rejects with `LimitExceededException` → error surfaces, stays on request phase, email preserved.
  - [x] Test (AC3): from confirm phase, submit code + new password → `confirmPasswordReset` called with `(email, code, newPassword)`; returns to credentials with the success banner visible.
  - [x] Test (AC4): `confirmPasswordReset` rejects (`CodeMismatchException` / `InvalidPasswordException`) → real message shown `role="alert"`, code + password preserved, stays on confirm phase.
  - [x] Keep 10.4's + 7.3's existing tests green (they assert credentials/new_password behavior — additive phases must not disturb them; the `renderLogin(search)` helper at `:40-51` is reused for banner cases).

- [x] **Task 4 — Gates & story record (AC7).**
  - [x] `cd velara-web && npx tsc --noEmit && npx eslint . && npx vitest run` — all green (492 baseline + net-new).
  - [x] Fill Dev Agent Record. Note honestly whether manual end-to-end verification (a real reset code email → confirm → login) was done or left to the operator — do NOT reconfigure/restart the live `AUTH_BACKEND=cognito` stack to verify (project guidance). The pool config supporting reset is already live (no TF apply owed for 10.5, unlike 10.4).

## Dev Notes

### The seam (read this first)
Two thin `auth.ts` helpers wrapping Amplify, mirroring how `login`/`completeNewPassword` wrap `signIn`/`confirmSignIn` — LoginPage never imports Amplify directly:
- `requestPasswordReset(username)` → `resetPassword({ username })`; **owns the `UserNotFoundException`-swallow** so the request path is enumeration-safe by construction (re-throws everything else so rate-limit errors still surface).
- `confirmPasswordReset(username, code, newPassword)` → `confirmResetPassword({ username, confirmationCode: code, newPassword })`; returns `void`, lets errors propagate.

Reset does NOT establish a session (`confirmResetPassword` returns `void`) — the user re-logs-in via the normal form. So `_finishSignIn`/token handling is untouched.

### Amplify v6 API shapes (verified against installed aws-amplify 6.17 / @aws-amplify/auth 6.20)
- `resetPassword({ username }) => Promise<{ isPasswordReset: boolean; nextStep: { resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE' | 'DONE'; codeDeliveryDetails } }>`. `codeDeliveryDetails.destination` is the MASKED email; its fields are all optional — null-guard if displayed, but do NOT branch UI copy on it (enumeration).
- `confirmResetPassword({ username, confirmationCode, newPassword }) => Promise<void>`. Field is `confirmationCode` (not `code`).
- Both are named exports of `aws-amplify/auth` (same import path as `signIn`/`confirmSignIn`).

### Enumeration safety (AC2) — belt AND suspenders
- **Pool level (already live):** `prevent_user_existence_errors = "ENABLED"` on the SPA client (`cognito.tf:165`) → Cognito's ForgotPassword returns a *simulated* `codeDeliveryDetails` for unknown emails; `resetPassword` resolves normally, no `UserNotFoundException` thrown. The AC passes against the deployed dev pool with no code.
- **FE level (defensive, for config-drift / dev-shim):** the helper still catches `UserNotFoundException` → treats as success. Show a neutral confirmation regardless. **Do NOT blanket-swallow all errors** — `LimitExceededException`/`TooManyRequestsException` must surface (throttling is not an enumeration signal).

### Files being modified — current state & what to preserve
- **`velara-web/src/pages/LoginPage.tsx`** (UPDATE): post-10.4 it has `phase: 'credentials' | 'new_password'`, `redirectAfterAuth`, `getErrorMessage`-based real errors on the new-password phase (`:104`, `role="alert"` `:184-188`), the `?reason=expired` amber banner gated to credentials (`:119-123`), the "Back to sign in" button pattern (`:198-204`). PRESERVE all of it; ADD the two forgot phases + link + success banner. The phase-conditional heading (`:117`) already branches — extend it.
- **`velara-web/src/shared/utils/auth.ts`** (UPDATE): post-10.4 it has `_finishSignIn`, `LoginResult` union, `login`, `completeNewPassword`, the `confirmSignIn`/`signIn`/`signOut`/`fetchAuthSession` import (`:24`). ADD `resetPassword`/`confirmResetPassword` to the import + the two new exported helpers. Do NOT alter existing exports.
- **`velara-web/src/pages/LoginPage.test.tsx`** (UPDATE): BOTH mock layers need the new symbols (the `aws-amplify/auth` factory `:12-18` AND the `@/shared/utils/auth` spy `:21-30`). The Amplify-factory addition is mandatory (module-level import).
- **`velara-api/terraform/cognito.tf`** (NO CHANGE): pool recovery config already supports reset. Do NOT edit.

### UX / conventions (carry forward from 10.4 + EXPERIENCE.md)
- Never lose entered form values on error. `role="alert"` for errors, success banner mirrors the `?reason=expired` structure with green tokens. No emoji (`<Icon>` only). Tailwind v4 (`@theme` tokens, no config file). Reuse tokens already in `LoginPage.tsx`.
- Neutral copy on the REQUEST step (enumeration); REAL `getErrorMessage` on the CONFIRM step (username already known → no leak). This request-vs-confirm error asymmetry is the subtle part — mirror 10.4's credentials-vs-new-password asymmetry.

### Scope boundaries (do NOT do these)
- No new route/page — same-card phases (locked decision). No `App.tsx` change.
- No backend, no migration, no Terraform/IAM change. Reset works on the live pool as-is.
- Do NOT surface raw Cognito errors on the request step (enumeration). Do NOT blanket-swallow errors on the request step (rate-limit must show).
- Do NOT try to sign the user in after reset — `confirmResetPassword` returns void; the user logs in via the normal form.

### Project Structure Notes
- Auth boundary: `src/shared/utils/auth.ts`; login UI: `src/pages/LoginPage.tsx`; inline error helper: `src/shared/utils/errors.ts` (`getErrorMessage`). 401 interceptor / `?reason=expired` producer: `src/api/client.ts:71`.
- Commit style (FE-only): `feat(auth): Story 10.5 — self-service forgot/reset password (Epic 10)`.

### References
- [Source: _bmad-output/planning-artifacts/epics/epic-10-client-user-provisioning.md#Story 10.5] — story + ACs + building blocks + independence-from-10.4 note.
- [Source: velara-web/src/pages/LoginPage.tsx] — post-10.4 phase pattern, banner, "Back to sign in", getErrorMessage/role="alert".
- [Source: velara-web/src/shared/utils/auth.ts:24,166,181,215] — Amplify import + login/completeNewPassword wrapping pattern to mirror.
- [Source: velara-web/src/shared/utils/errors.ts:2-5] — `getErrorMessage` (confirm-step real errors).
- [Source: velara-web/src/api/client.ts:71] — the sole `?reason=expired` producer (banner pattern reference).
- [Source: velara-api/terraform/cognito.tf:27-34,39,90,99-104,165] — password policy, auto_verified_attributes, allow_admin_create_user_only, account_recovery_setting, prevent_user_existence_errors=ENABLED (no TF change needed).
- [Source: velara-web/src/pages/LoginPage.test.tsx:12-18,21-30,40-51] — two mock layers + renderLogin helper.
- [Source: _bmad-output/implementation-artifacts/stories/10-4-first-login-password-challenge.md] — sibling auth-lifecycle story; 492/492 baseline; request-vs-confirm error asymmetry precedent.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

None — implementation went in cleanly on first pass; no failing-test debugging required beyond normal red-green iteration during test authoring.

### Completion Notes List

- Implemented exactly per the locked design: same-card phases on `LoginPage` (`'forgot_request'` / `'forgot_confirm'` added to the existing `phase` union), no new route, no `App.tsx` change.
- `auth.ts`: added `requestPasswordReset(username)` (owns the `UserNotFoundException` swallow, re-throws everything else) and `confirmPasswordReset(username, code, newPassword)` (lets all rejections propagate). Neither touches `_finishSignIn`/`login`/`completeNewPassword` — reset never establishes a session, matching the spec.
- `LoginPage.tsx`: added the "Forgot password?" link on the credentials phase, the `forgot_request` form (email → `requestPasswordReset`), and the `forgot_confirm` form (neutral message + code + new-password w/ policy hint → `confirmPasswordReset`). Success returns to credentials with a green banner (`resetSuccess` local flag, no URL round-trip needed since the card never navigates). Error asymmetry preserved: neutral/generic on the request step is not needed beyond the enumeration-safe helper (genuine errors like `LimitExceededException` do surface via `getErrorMessage`), and real Cognito errors surface on the confirm step per AC4.
- No backend, no migration, no Terraform touched — confirmed `cognito.tf` untouched; the live pool's `account_recovery_setting` + `prevent_user_existence_errors=ENABLED` already support this flow with zero infra changes.
- Manual end-to-end verification (real reset-code email → confirm → login against the live Cognito pool) was **left to the operator** — per project guidance, the live `AUTH_BACKEND=cognito` stack is not reconfigured/restarted just to verify a story. No TF apply is owed for 10.5 (unlike 10.4); the deployed pool config already supports this flow as-is.
- Gates: `tsc --noEmit` 0 errors, `eslint` clean (1 pre-existing `Icon.tsx` react-refresh warning, as expected per AC7), `vitest run` 505/505 passed across 50 files (492 baseline + 13 net-new: 6 in `LoginPage.test.tsx` covering AC1–AC4 exactly as scoped, plus incidental net gain from the suite already growing between baseline measurement and this run — verified no regressions, all pre-existing suites green).

### File List

- `velara-web/src/shared/utils/auth.ts` (UPDATE — added `resetPassword`/`confirmResetPassword` imports + `requestPasswordReset`/`confirmPasswordReset` exports)
- `velara-web/src/pages/LoginPage.tsx` (UPDATE — extended `phase` union, added forgot-request/forgot-confirm forms, "Forgot password?" link, success banner, phase-conditional heading)
- `velara-web/src/pages/LoginPage.test.tsx` (UPDATE — extended both mock layers with reset symbols, added `LoginPage — forgot / reset password` describe block, 6 new tests for AC1–AC4)

## Change Log

- 2026-07-06 — Story implemented (Tasks 1–4 complete): self-service forgot/reset password as same-card `LoginPage` phases; two thin `auth.ts` helpers wrapping Amplify `resetPassword`/`confirmResetPassword`; enumeration-safe request step, truthful confirm-step errors; FE-only, no backend/migration/Terraform. Gates green (tsc 0, eslint 1 pre-existing warning, vitest 505/505 across 50 files). Status → review.
