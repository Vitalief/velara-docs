---
baseline_commit_api: c4d4805
baseline_commit_web: 835e90b
---

# Story 10.2: User-Management Screen

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief grantor (admin or ma_tech),
I want a Users screen where I can list existing users with their invitation status, create/invite a new client (or consultant) user, and resend a pending invitation,
so that I can manage login identities visually instead of via the AWS Cognito console.

## Scope decisions (create-story, Project Lead, 2026-07-03)

Three decisions resolved via AskUserQuestion — they reshape the epic's 10.2 AC text and are **binding**:

1. **Status + resend ARE in 10.2** (USR-03 partial). The UX design's Invited/Active pills + per-row Resend are core to the screen, but the shipped backend discards Cognito `UserStatus` and has no resend seam — so **10.2 is full-stack, not FE-only**: a small backend extension surfaces `status` on the user list and adds a resend route (`AdminCreateUser` + `MessageAction="RESEND"`; **zero Terraform** — IAM already grants `AdminCreateUser`, and the 10.1 review confirmed `AdminResendInvitation` is a phantom API that does not exist). **Disable/deactivate stays deferred** (the `deferred-work.md` typo'd-invite item remains open for a follow-up; `AdminDisableUser` IAM is granted but nothing calls it).
2. **Role select, default `client`.** The epic AC's "role fixed to client" predates the 10.1 product decision that the API deliberately provisions BOTH `client` and `consultant` (consultant = interim bridge until Azure AD federation). The create form offers `client | consultant`, defaulting to `client` (the mock shows a Role select).
3. **Flat directory + search — NO client-selector scoping.** The design's "per selected client" IA cannot be honestly implemented: no user↔client association exists in the data, only access grants, and a freshly-invited user has none (the mock itself shows "— (grant pending)"). Build ONE table of all directory users with a client-side search box; the "Engagement access" column is resolved from the existing `GET /api/v1/access-grants` data.

## Acceptance Criteria

1. **BE — `status` on the user directory.** `AuthProvider.list_users` surfaces each user's invitation status, normalized to `"invited" | "active" | "unknown"`:
   - `CognitoAuthProvider.list_users` reads the per-user `UserStatus` field from the Cognito `ListUsers` response (it is a **top-level** key on each user, NOT inside `Attributes` — currently discarded at `auth.py:500-513`) and maps: `FORCE_CHANGE_PASSWORD → "invited"`, `CONFIRMED → "active"`, `EXTERNAL_PROVIDER → "active"` (future AAD-federated users have no invite), anything else → `"unknown"`.
   - `DevAuthProvider.list_users` returns `"active"` for the pristine seed users and `"invited"` for users created via `create_user` (tracked in module state that `reset_seed()` restores).
   - `UserSummary` (`auth.py:61`) and `UserSummaryRead` (`app/schemas/user.py:14`) gain `status: str` — **additive**; the existing `GET /api/v1/users` contract (params, gating, envelope, 403/404/502 codes) is otherwise unchanged. `POST /api/v1/users`' 201 body reports `status="invited"` (an `AdminCreateUser`-created user is always `FORCE_CHANGE_PASSWORD`).

2. **BE — resend-invite route.** `AuthProvider` gains `resend_invite(email) -> AuthPrincipal`, and a new `POST /api/v1/users/resend-invite` (body `{"email": <EmailStr>}`) is added to the existing users router:
   - Gating **identical to `POST /users`** (the 10.1 trap): router stays `RejectClient` (client → **404**), in-handler `_require_grantor` (consultant → **403**). Do NOT use `RejectNonGrantor`.
   - `CognitoAuthProvider.resend_invite` calls `admin_create_user` with `MessageAction="RESEND"` + `DesiredDeliveryMediums=["EMAIL"]` (reuse the existing call/parse/error plumbing at `auth.py:548-596`; RESEND takes no `UserAttributes`). `DevAuthProvider.resend_invite` validates the email exists and is invite-pending, then no-ops (returns the stored principal).
   - Error mapping: unknown email → **404** `USER_NOT_FOUND` (Cognito `UserNotFoundException`); user already active → **409** `USER_NOT_PENDING` (Cognito `UnsupportedUserStateException`); other provider failure → **502** `USER_DIRECTORY_UNAVAILABLE`. Success → **200** `ResponseEnvelope[UserSummaryRead]` (`status="invited"`).
   - A successful resend writes a best-effort `admin.user_invite_resent` audit event (same pattern as `admin.user_provisioned`; never fails the call). **No Terraform change.**

3. **FE — Users nav tab + route.** A "Users" tab (`{ id: 'users', label: 'Users', path: 'users', grantorOnly: true }`) is added to `TABS` (insert after `access`), routed at `/internal/users` via `<Route path="users/*" element={<RequireGrantor><div className="p-6"><UsersScreen /></div></RequireGrantor>} />`. Not visible to `client` (no internal shell) or `consultant` (`grantorOnly` filter + `RequireGrantor` redirect to `/internal/engagements`). `usePageTitle('Users')` set. Existing nav/route tests' grantor-only expectations updated.

4. **FE — user directory table.** `/internal/users` lists ALL directory users from `useUsers()` (no `role` param) in the AccessControl-style HTML table. Columns per the design mock: **User** (navy mono-initial avatar + name) · **Email** · **Role** · **Engagement access** · **Status** · row action. A "Search users…" input filters client-side by name/email. "Engagement access" resolves the user's grants from the existing access-grants list data (node name; `+N more` if several; `— (grant pending)` for a user with no grants; `—` for internal roles). TanStack Query loading/error states (`getErrorMessage`), plain-text empty state, snake_case fields end-to-end (**no snake→camel mapping** — the epic AC phrasing is overridden; the codebase is snake_case throughout, per the 8.5 precedent), and no emoji (all glyphs via `<Icon>`).

5. **FE — status pill.** A new `UserStatusBadge` (pill shape mirrors `AuditOutcomeBadge`): `invited` → amber (the design's single net-new color: bg `#fff7ed`, text `#b45309`, border `#fcd9a8`), `active` → teal (existing brand/status tokens), `unknown` → neutral muted. Rendered in the Status column and driven only by the API `status` field.

6. **FE — Add-user overlay (create + invite).** An "Add user" primary button opens a focus-trapped, Esc-closable overlay containing a **Stepper** (built to take a steps array so 10.3 can insert "Grant access"; 10.2 renders `Create & invite → Done`):
   - Step 1 form: **Full name**, **Work email**, **Role** select (`client` default, `consultant` option) + the design's teal callout explaining that Cognito emails the invitation ("Velara never sees or stores the password").
   - Submit → new `useCreateUser` mutation → `POST /api/v1/users`; while pending the form locks and the button reads "Creating…". On success the overlay advances **in place** to the Done step: confirmation that Cognito has emailed the invitation, with "Add another" (reset to Step 1) and "Done" (close); the users list is invalidated and shows the new user with an **Invited** pill.
   - On error the form values are **never lost** (EXPERIENCE.md rule). Error copy: 409 `USER_ALREADY_EXISTS` → "A user with this email already exists."; 422 → field-level messages (use `mapDetailsToFieldErrors`); 502/network → "Couldn't create the account — try again." (inline `role="alert"`, no crash). Creation is **never optimistic**.

7. **FE — resend action.** Rows with `status === "invited"` show a ghost "Resend" button (Active/unknown rows show none, per the design). Click → new `useResendInvite` mutation → `POST /api/v1/users/resend-invite` with the row's email; while pending the button disables ("Resending…"); on success it shows a brief inline confirmation ("Invitation resent to <email>", `aria-live="polite"`) and stays disabled briefly to prevent double-send; on error an inline `role="alert"` message via `getErrorMessage`. (There is no toast system in the app — the design's "toast" is delivered as this inline confirmation; do not build a toast framework.)

8. **Tests + gates.**
   - BE (`AUTH_BACKEND=dev` pytest): status present + correct in `GET /users` (seed → `active`, freshly-provisioned → `invited`); POST 201 body has `status="invited"`; resend happy path 200; resend caller-gating (consultant → 403, client → 404); resend unknown email → 404; resend already-active user → 409; audit event recorded on resend. `ruff` clean. OpenAPI spec regenerated (`/api/v1/users/resend-invite` + `status` field appear).
   - FE (vitest): UsersScreen renders rows with status pills + engagement access; search filters; Resend only on invited rows; resend success/error flows; Add-user overlay create success → Done step + list invalidation; 409/422/502 error handling preserves form values; nav tab + route grantor gating (update `GRANTOR_ONLY` expectations). `tsc --noEmit` 0, eslint clean.
   - Existing contracts NOT regressed: `GET /users` (admin/ma_tech 200, consultant 403, client 404), `POST /users` (10.1's 16 tests), `UserPicker`/`AuditLog` consumers of `UserSummary` (the new field is additive).

## Tasks / Subtasks

- [x] **Task 1 — BE: surface `UserStatus` in the directory (AC: 1)**
  - [x] `app/integrations/auth.py`: add `status: str = "unknown"` to `UserSummary` (`:61` — frozen dataclass; a defaulted field must stay last and keeps the only two constructor sites, `:336` and `:506`, safe while both are updated). In `CognitoAuthProvider.list_users` (`:470-519`), read `u.get("UserStatus")` (top-level per-user key, sibling of `Attributes`) and normalize via a module-level `_normalize_user_status(raw)` helper: `FORCE_CHANGE_PASSWORD→invited`, `CONFIRMED→active`, `EXTERNAL_PROVIDER→active`, else/missing→`unknown`.
  - [x] `DevAuthProvider`: track invite-pending emails in a module-level set (e.g. `_INVITED_EMAILS`), populated by `create_user`, restored by `reset_seed()` (extend the pristine-snapshot pattern at `auth.py:137-141, 375-386`). `list_users` reports `invited` for tracked emails, `active` for seed users.
  - [x] `app/schemas/user.py`: `UserSummaryRead.status: str = "unknown"` (`:14-20`; defaulted so the field is additive for any existing constructor). `POST /users` handler (`users.py:129-137`) sets `status="invited"` on the 201 body.

- [x] **Task 2 — BE: `resend_invite` seam (AC: 2)**
  - [x] Add `resend_invite(self, *, email: str) -> AuthPrincipal` to the `AuthProvider` Protocol (`auth.py:124-170`, after `create_user`).
  - [x] `CognitoAuthProvider.resend_invite`: same boto3 client construction as `create_user` (`:521-596`); call `admin_create_user(UserPoolId=..., Username=email, MessageAction="RESEND", DesiredDeliveryMediums=["EMAIL"])` — **no `UserAttributes`** on RESEND. Reuse the existing response-parsing (sub extraction, loud 502 on missing sub) and error-mapping shape. Map `UserNotFoundException` → new `UserNotFoundError`; `UnsupportedUserStateException` → new `UserNotPendingError`; other boto errors → `UserDirectoryError`. Match on the modeled error-code string like `create_user` does.
  - [x] `DevAuthProvider.resend_invite`: email unknown (not in `_SEED_EMAILS`/created set) → raise `UserNotFoundError`; email known but not invite-pending → raise `UserNotPendingError`; else return the stored principal (no state change).
  - [x] Add `UserNotFoundError` + `UserNotPendingError` next to `UserAlreadyExistsError` in `auth.py`.

- [x] **Task 3 — BE: resend route + audit (AC: 2)**
  - [x] `app/schemas/user.py`: `UserInviteResend(BaseModel)` with `model_config = ConfigDict(str_strip_whitespace=True)` and `email: EmailStr = Field(max_length=128)` (mirror `UserCreate` `:29-52`).
  - [x] `app/api/v1/users.py`: `@router.post("/users/resend-invite", response_model=ResponseEnvelope[UserSummaryRead])` (200, not 201). First line `_require_grantor(user.role)` — router stays `dependencies=[RejectClient]`; do NOT add `RejectNonGrantor` anywhere (10.1's gating trap: it would 404 consultant and regress the GET contract).
  - [x] Extend `app/services/provisioning_service.py` with `resend_user_invite(...)`: call the seam, then best-effort `record_admin_action(event_type=EVENT_ADMIN_USER_INVITE_RESENT, hierarchy_path="org", org_id=<caller org>, user_id=<caller>, metadata={"email": ..., "resent_user_id": ...})` in the same try/except-log shape as `provision_user` (`:56-74`).
  - [x] `app/models/audit.py`: `EVENT_ADMIN_USER_INVITE_RESENT = "admin.user_invite_resent"` (next to `EVENT_ADMIN_USER_PROVISIONED` `:53`).
  - [x] Route error mapping: `UserNotFoundError` → `VelaraHTTPException(404, "USER_NOT_FOUND", ...)`; `UserNotPendingError` → `(409, "USER_NOT_PENDING", "This user has already activated their account.")`; `UserDirectoryError` → 502 `USER_DIRECTORY_UNAVAILABLE` (existing pattern `users.py:123-127`).

- [x] **Task 4 — BE: tests + spec (AC: 8)**
  - [x] Extend `tests/integration/api/test_users.py` (reuse `_auth_headers(role)`; the suite-wide seed-reset autouse fixture already lives in `tests/conftest.py` since the 10.1 review): status assertions on GET (seed active / provisioned invited) and POST 201 (`status="invited"`); resend 200 for admin AND ma_tech; consultant→403 / client→404 on resend; unknown email→404; resend on an active seed user→409; audit row `admin.user_invite_resent` written (mirror 10.1's audit test).
  - [x] Use `@*.example` emails in request bodies (email-validator rejects the seed convention's `.test` TLD — 10.1 debug log).
  - [x] `docker compose build api` BEFORE `docker compose exec api pytest ...` (image bakes source — false greens otherwise). `ruff check` clean. Regenerate `docs/api-spec.json` (new path + `status` field; confirm byte-stable rerun).

- [x] **Task 5 — FE: API client + hooks (AC: 4, 6, 7)**
  - [x] `src/api/users.ts`: add `status: string` to `UserSummary`; add `createUser(body: {email, name, role}): Promise<UserSummary>` (`POST /api/v1/users`, unwrap `response.data.data`) and `resendInvite(body: {email}): Promise<UserSummary>` (`POST /api/v1/users/resend-invite`). Extend `src/api/users.test.ts` accordingly (mock `@/api/client`).
  - [x] `src/features/admin/hooks/useUsers.ts`: add `useCreateUser()` and `useResendInvite()` mutations in the house shape (`useQueryClient` + `useMutation` + `onSuccess: qc.invalidateQueries({ queryKey: ['users'] })` — the key-prefix invalidation catches `['users', params]`; per-call `onError` at the component, mirroring `useCreateGrant` in `useAccessGrants.ts:17-35`).

- [x] **Task 6 — FE: nav tab + route (AC: 3)**
  - [x] `src/shared/components/navTabsData.ts`: insert `{ id: 'users', label: 'Users', path: 'users', grantorOnly: true }` after the `access` entry.
  - [x] `src/routes/internal.tsx`: import `UsersScreen`, add `<Route path="users/*" element={<RequireGrantor><div className="p-6"><UsersScreen /></div></RequireGrantor>} />` beside the `audit`/`analytics` routes (`:93-108`).
  - [x] Update `NavTabs.test.tsx` `GRANTOR_ONLY` list + `internal.test.tsx` route/title expectations (same mechanical update 9.5 made).

- [x] **Task 7 — FE: UsersScreen list (AC: 4, 5)**
  - [x] New `src/features/admin/components/UsersScreen.tsx`: `usePageTitle('Users')`; header + "Add user" primary button (`<Icon name="plus" />`, gated `isGrantor()` — belt-and-suspenders, the route already guarantees it); "Search users…" input; AccessControl-style table (`AccessControl.tsx:1009-1055` for thead/row classes). Avatar = navy circle + initials (copy the `initials()` helper idea from `AuditLog.tsx:19-23`; `bg-` navy token + white text, no image).
  - [x] Engagement-access column: fetch grants via the existing `listAccessGrants` API/hook (`useAccessGrants`, per_page 200, page 1 — the directory and grant set are small; add a code comment noting the >200-grants truncation caveat), build a `user_id → grants[]` map, resolve node display names the same way `GrantManagementSection` does (client name via `useClients()`; project label via the grant's node data). Render: single grant → node name; multiple → first + `+N more`; none + role `client` → `— (grant pending)`; internal roles → `—`.
  - [x] New `src/features/admin/components/UserStatusBadge.tsx` mirroring `AuditOutcomeBadge`'s pill markup (`inline-flex items-center gap-[6px] rounded-full border px-[9px] py-[3px] text-[11.5px] font-semibold`): invited → amber arbitrary values `bg-[#fff7ed] text-[#b45309] border-[#fcd9a8]` (Tailwind v4 — arbitrary classes are fine; only add `@theme` tokens if reused elsewhere), active → existing teal/brand tokens, unknown → `text-muted` neutral. Loading = hand-rolled skeleton rows (house pattern); error = `getErrorMessage` text; empty = plain centered text ("No users in the directory yet.").

- [x] **Task 8 — FE: Add-user overlay (AC: 6)**
  - [x] New `src/features/admin/components/AddUserOverlay.tsx`: fixed overlay + scrim (copy `DetachDialog`/`RevokeGrantDialog` a11y mechanics — `role="dialog"` `aria-modal`, initial focus, Esc close, stop-propagation; `AccessControl.tsx:67-129, 656-721`). Contains a small `Stepper` sub-component taking `steps: string[]` + `current` (dots per DESIGN.md: current filled teal, done teal-ring + check, upcoming faint) — 10.2 passes `['Create & invite', 'Done']`; 10.3 will insert `'Grant access'`.
  - [x] Step 1: 2-col form grid (label/input classes from `GrantManagementSection`, `AccessControl.tsx:937-994`): Full name (text), Work email (`type="email"`), Role (`<select>`: `client` default / `consultant`), teal-wash callout (`border-brand-600`-family tokens) with the Cognito-invite copy. Buttons: Cancel (ghost) + "Create & send invite" (primary; pending → "Creating…" + form disabled).
  - [x] Submit → `createUser.mutate(body, { onSuccess, onError })`. onError: inspect `err.response?.data?.error?.code` (AccessControl inline pattern `:884-891`) → 409/422/other copy per AC6; keep all field values. onSuccess → advance to Done step (confirmation text names the email; "Add another" resets the form to Step 1; "Done" closes). No optimistic update.

- [x] **Task 9 — FE: resend row action (AC: 7)**
  - [x] In the row: `status === 'invited'` → ghost "Resend" button. `resendInvite.mutate({ email }, ...)`; track the in-flight/confirmed row locally (single-row state — don't disable all rows). Success → inline "Invitation resent to <email>" (`aria-live="polite"`, e.g. replacing the button with a check `<Icon name="check" />` + "Sent" for a few seconds, then restore). Error → inline `role="alert"` with `getErrorMessage`.

- [x] **Task 10 — FE: tests + gates (AC: 8)**
  - [x] `UsersScreen.test.tsx` + `AddUserOverlay.test.tsx` (+ badge test) in the house convention: `vi.mock` the hooks (`useUsers`, `useAccessGrants`, `useEngagements` hooks used for name resolution, `usePageTitle`), `q(data)`/`noOpMutation`/`makeQC()` helpers, `_mockAuthSession` seeding (see `AccessControl.test.tsx:10-48, 142-165`). Cover: rows/pills/search/resend-visibility, create success → Done + `invalidateQueries`, 409 error keeps values, resend success + error.
  - [x] `tsc --noEmit` 0 errors; eslint clean (the pre-existing `Icon.tsx` react-refresh warning is known); full `vitest run` green (baseline 461 tests / 47 files — expect additions, zero regressions).

## Dev Notes

### Why this story is full-stack (and exactly how big the BE slice is)
The epic labeled 10.2 "(Frontend)", but the design's two load-bearing elements — the **Invited/Active pill** and the **Resend** action — have no backend today: `CognitoAuthProvider.list_users` discards the `UserStatus` field (`auth.py:500-513`), and no resend seam/route exists anywhere (verified). The BE slice is deliberately tiny: one field threaded through `UserSummary`/`UserSummaryRead`, one Protocol method with two implementations, one route, one audit constant. **No migration** (no users table — identities live in Cognito; head stays `0020`). **No Terraform** — `terraform/iam.tf:113-123` already grants `cognito-idp:AdminCreateUser` scoped to the pool ARN, and resend IS `AdminCreateUser` (`MessageAction="RESEND"`); the 10.1 review empirically confirmed **`AdminResendInvitation` does not exist** in the cognito-idp service model (the epic AC naming it is a spec error — do not re-add it to IAM).

### Shipped 10.1 contract you build on (verified at `c4d4805`, working tree clean)
- `GET /api/v1/users` — one optional `role` query param, **unpaginated** `{"data": {"items": [{user_id, name, email|null, role}]}, "meta": {...}}`; admin/ma_tech 200, consultant 403 (in-handler `_require_grantor`, `users.py:31, 44-46`), client 404 (router `RejectClient`), 502 `USER_DIRECTORY_UNAVAILABLE`.
- `POST /api/v1/users` — body `UserCreate` (`email: EmailStr max 128`, `name: str 1..256` whitespace-stripped, `role: Literal["client","consultant"]`, **no org_id**; `schemas/user.py:29-52`); 201 `ResponseEnvelope[UserSummaryRead]`; 409 `USER_ALREADY_EXISTS`, 502, 422, 403, 404. Error envelope: `{"error": {"code", "message", "request_id"}}`.
- `AuthProvider` Protocol (`auth.py:124-170`): `issue_token`, `validate_token`, `list_users`, `create_user`. `CognitoAuthProvider.create_user` (`auth.py:521-596`) is the exact template for `resend_invite`: same boto3 client construction, same `DesiredDeliveryMediums=["EMAIL"]` (the 10.1 review's critical fix — AWS default is SMS and the invite silently never sends), same modeled-error-code matching, same loud-502-on-missing-sub parse.
- `provisioning_service.provision_user` (`provisioning_service.py:56-74`) is the audit template: best-effort `record_admin_action` after the action, try/except that only logs.

### Cognito facts the implementer must not re-derive
- `UserStatus` is a **top-level per-user field** in the `ListUsers` response (sibling of `Attributes`), not an attribute. Values seen in practice: `FORCE_CHANGE_PASSWORD` (invited, temp password not yet replaced), `CONFIRMED` (active), `EXTERNAL_PROVIDER` (federated — future AAD users; treat as active), plus rarities (`RESET_REQUIRED`, `UNCONFIRMED`, `ARCHIVED`, `COMPROMISED`, `UNKNOWN`) → normalize to `"unknown"` and render neutrally.
- Resend = `admin_create_user(Username=email, MessageAction="RESEND", DesiredDeliveryMediums=["EMAIL"])`. It **fails with `UnsupportedUserStateException`** if the user is not in `FORCE_CHANGE_PASSWORD` (i.e. already activated) and `UserNotFoundException` for unknown usernames — map to 409/404 respectively, never 500. Do NOT pass `UserAttributes` on a RESEND call. Resend also **re-issues a new temporary password** (expected behavior; invalidates the previous invite's temp password — fine).
- The pool is `username_attributes=["email"]` + case-insensitive, so `Username=email` addresses the user directly; no sub→email resolution needed (this is why the route takes `email` in the body, not a path `user_id` — resolving a sub to a username would require an extra `ListUsers` filter round-trip).
- Directory/org semantics are inherited from the existing `GET /users` (pool-wide; single-org reality today — 10.1 sets `org_id` = caller's org). Do NOT invent org fencing on resend; it would diverge from the list this screen renders.

### Route gating — copy 10.1 exactly (its documented trap)
Router stays `dependencies=[RejectClient]` (client→404 for free, GET consultant→403 contract preserved); the new POST handler's **first line** is `_require_grantor(user.role)` (consultant→403). **Never** add route/router-level `RejectNonGrantor` here — it 404s consultant (wrong code for this surface) and would regress `test_consultant_cannot_list_users`. Note the `_require_grantor` message was generalized in the 10.1 review patches — reuse as-is.

### Dev-shim status/resend semantics (offline tests are the point)
`DevAuthProvider` is what the whole pytest suite exercises (`AUTH_BACKEND=dev`). Requirements: seed users report `active`; `create_user`-provisioned users report `invited`; `resend_invite` on an invited user succeeds (no-op + return principal), on a seed/active user raises `UserNotPendingError`, on an unknown email raises `UserNotFoundError`. Track invited emails in module state alongside `_SEED_USERS`/`_SEED_EMAILS` and restore it in `reset_seed()` (`auth.py:375-386`) — the suite-wide autouse reset fixture in `tests/conftest.py` (moved there by the 10.1 review) then keeps tests isolated for free. Casefold email comparisons (the 10.1 review patched dev/prod dup-check parity — keep the same discipline here).

### FE seams — what EXISTS vs what is NET-NEW
EXISTS (do not rebuild):
- `src/api/users.ts` — `UserSummary {user_id, name, email|null, role}` (snake_case), `listUsers`, `.data.data` unwrap. `useUsers(params?)` at `src/features/admin/hooks/useUsers.ts`, query key `['users', params]`, staleTime 60s. Consumers: `AccessControl.tsx:826` (UserPicker), `AuditLog.tsx:8` — the new `status` field is additive and breaks neither.
- Mutation house-shape: `useAccessGrants.ts:17-35` (`onSuccess` invalidate in the hook; `onError` per-call at the component).
- `RequireGrantor` (`src/shared/components/RequireGrantor.tsx`), `NavTabs` `grantorOnly` filter (`NavTabs.tsx:22-23`), route wildcard pattern (`internal.tsx:93-108`), `usePageTitle`.
- `getErrorMessage` + `mapDetailsToFieldErrors` (`src/shared/utils/errors.ts` — the field-error mapper exists and is exactly what the 422 case needs).
- `isGrantor()` (`shared/utils/auth.ts:97`), `<Icon>` with `user`/`users`/`plus`/`check`/`search` names present (`Icon.tsx:6-58`).
- Table/row/form styling: copy classes from `AccessControl.tsx` (table `:1009-1055`, form fields `:937-994`); dialog a11y mechanics from `DetachDialog`/`RevokeGrantDialog`.
- Grant data for the Engagement-access column: `useAccessGrants` + the name-resolution approach already used by `GrantManagementSection`'s table.
NET-NEW: `UsersScreen.tsx`, `UserStatusBadge.tsx`, `AddUserOverlay.tsx` (+ internal `Stepper`), `useCreateUser`/`useResendInvite`, `createUser`/`resendInvite` API fns, the nav tab entry + route.

### Design fidelity + mock-vs-API reconciliation (the recurring epic-9 trap, resolved up front)
Design of record: `ux-designs/ux-Velara-2026-07-01/` (DESIGN.md + EXPERIENCE.md + `mockups/admin-surfaces-mock.html` screens 4–5). **`design/internal3.jsx` has NO Users screen** — it is the AccessControl prototype only; do not hunt for a Users mock there.
Reconciliations (binding):
- **Client-selector scoping → flat directory + search** (scope decision 3). Keep the mock's table columns, avatars, pills, "Search users…", "Add user" button.
- **"Client / engagement" select in the Step-1 form → OMIT in 10.2.** It exists in the mock to feed Step 2 (grant), which is Story 10.3. The 10.2 form is name + email + role only.
- **Step 2 "Grant access" → 10.3.** Build the Stepper to accept a steps array; render 2 steps now. Do not build any grant UI in the overlay.
- **Toast on resend → inline confirmation.** No toast system exists (Toast.tsx is an unused stub); the design's "Invitation resent to <email>" copy is delivered inline with `aria-live`. Do not introduce a toast framework for one message.
- **Status pill amber tokens are net-new** (`#fff7ed/#b45309/#fcd9a8`) — Tailwind v4 arbitrary values are acceptable; there is NO tailwind config file (`@theme` lives in CSS) if you prefer tokens.
- **No emoji anywhere** — `<Icon>` only (hard rule).
- "Never lose entered form values on error" and "never optimistic for create/resend" are explicit EXPERIENCE.md rules.

### Previous-story intelligence (10.1 + Epic 9 FE stories)
- **BE test env:** `docker compose build api` before `docker compose exec api pytest ...` — the image bakes source (`Dockerfile.api:14 COPY . .`, no volume); stale code = false greens. Alternatively the 10.1 host recipe: host pytest with `AUTH_BACKEND=dev` env override works (localhost PG/MinIO) — `.env` says cognito, the override must win. **Never touch the live `AUTH_BACKEND=cognito` containers** (a prior story broke the user's live session; explicit retro rule).
- **email-validator rejects `.test` TLDs** — use `@*.example` in test request bodies (10.1 debug log).
- Suite baseline: BE 1005 passed/36 skipped (host run); FE 461 tests/47 files, tsc 0, eslint clean except the known `Icon.tsx` react-refresh warning.
- FE screen tests mock hooks with `vi.mock` (NOT msw); `_mockAuthSession` seeds an `ma_tech` grantor by default — override `sessionStorage.setItem('velara_user', ...)` to simulate consultant/client (see `AccessControl.test.tsx:454, 483`).
- 9.5's lesson: reconcile mock-vs-API **before** coding (done above); update `GRANTOR_ONLY` test arrays when adding a grantor-only tab.
- Commit style: `feat(users): Story 10.2 — user management screen (Epic 10)` per repo; both repos get commits (velara-api + velara-web), like the 9.3 combined story.

### What must be preserved (regression guardrails)
- `GET /api/v1/users`: params/gating/envelope unchanged; only the additive `status` field lands. 10.1's 16 `test_users.py` tests keep passing (some gain a `status` assertion).
- `POST /api/v1/users`: contract untouched except the 201 body's additive `status`.
- `AuthProvider` Protocol: existing four methods' signatures unchanged; `resend_invite` is additive. `get_auth_provider()` `@lru_cache` factory untouched.
- FE `UserSummary` consumers (`UserPicker`, `AuditLog` actor resolution) unaffected by the additive field.
- Nav/route behavior for existing tabs; `RequireGrantor` redirect target stays `/internal/engagements`.
- No changes to the client portal surface (`/api/v1/client/*`, client routes) — this is an internal-only story.

### Project Structure Notes
- BE (all **extend**, one new function): `app/integrations/auth.py` (Protocol + both providers + 2 new exceptions + status normalize), `app/schemas/user.py` (`status` field + `UserInviteResend`), `app/api/v1/users.py` (resend route), `app/services/provisioning_service.py` (`resend_user_invite`), `app/models/audit.py` (constant), `tests/integration/api/test_users.py`, `docs/api-spec.json` (regen).
- FE: `src/api/users.ts` (+`.test.ts`), `src/features/admin/hooks/useUsers.ts`, `src/features/admin/components/` gains `UsersScreen.tsx`, `UserStatusBadge.tsx`, `AddUserOverlay.tsx` (+ co-located tests), `src/shared/components/navTabsData.ts`, `src/routes/internal.tsx` (+ test updates in `NavTabs.test.tsx`, `internal.test.tsx`). API clients live in `src/api/`, hooks in the feature folder — do not put fetch code in components.
- The Users screen lives in `features/admin/` (same surface family as AccessControl, per the epic's building-blocks note), NOT a new top-level feature folder.

### References
- [Epic 10 doc — Story 10.2 ACs + building blocks](_bmad-output/planning-artifacts/epics/epic-10-client-user-provisioning.md#Story-10.2)
- [ADR: Client User Provisioning](_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Client-User-Provisioning) (lines 181–203; grantor gate superseded to `{admin, ma_tech}` 2026-07-03)
- [UX design of record — Users table, Add-user overlay, resend](_bmad-output/planning-artifacts/ux-designs/ux-Velara-2026-07-01/) (DESIGN.md :35-38, :105-107; EXPERIENCE.md :44-51, :67-68, :77-81; mockups/admin-surfaces-mock.html screens 4–5)
- [Story 10.1 (previous story — contract, gating trap, review patches)](_bmad-output/implementation-artifacts/10-1-cognito-admin-user-provisioning.md)
- [AuthProvider seam](velara-api/app/integrations/auth.py) — Protocol :124-170, DevAuthProvider create/reset :344-386, Cognito list_users :470-519, create_user :521-596
- [Users router + `_require_grantor`](velara-api/app/api/v1/users.py) — GET :49-84, POST :87-137
- [User schemas](velara-api/app/schemas/user.py#L14-L52)
- [provisioning_service — audit template](velara-api/app/services/provisioning_service.py#L56-L74)
- [IAM CognitoUserAdmin statement (already sufficient)](velara-api/terraform/iam.tf#L108-L123)
- [FE users API + hook](velara-web/src/api/users.ts), (velara-web/src/features/admin/hooks/useUsers.ts)
- [Mutation house-shape](velara-web/src/features/admin/hooks/useAccessGrants.ts#L17-L35)
- [AccessControl exemplar — table :1009-1055, form :937-994, dialogs :67-129/:656-721, error inline :884-891](velara-web/src/features/admin/components/AccessControl.tsx)
- [Nav tabs + guard + routes](velara-web/src/shared/components/navTabsData.ts), (velara-web/src/shared/components/NavTabs.tsx#L22-L23), (velara-web/src/routes/internal.tsx#L93-L108)
- [errors utils incl. mapDetailsToFieldErrors](velara-web/src/shared/utils/errors.ts)
- [AuditOutcomeBadge — pill template](velara-web/src/features/audit/components/AuditOutcomeBadge.tsx)
- [Deferred-work: typo'd-invite disable/resend note](_bmad-output/implementation-artifacts/deferred-work.md) (resend lands here; disable remains deferred)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- BE tests run on host with `AUTH_BACKEND=dev` env overrides (localhost PG/MinIO/Redis pointing at the existing docker-compose containers) per the 10.1 host recipe — the live `AUTH_BACKEND=cognito` containers were never restarted/reconfigured.
- Full BE suite: 1017 passed, 36 skipped, 0 failed (baseline 1005 + 12 new). `ruff check` clean.
- `docs/api-spec.json` regenerated and confirmed byte-stable on a second rerun.
- FE: `tsc --noEmit` 0 errors, `eslint` clean. Full `vitest run`: 482 passed / 50 files (baseline 461/47 + 21 new), 0 regressions.
- Manual browser verification (Playwright against the running local dev server, logged in as `dev.admin@velara.dev`): the Users nav tab, directory table (User/Email/Role/Engagement access/Status columns), initials avatars, live search filter, and the Add-user overlay (stepper, form, Cognito-invite callout, error handling) all render and behave correctly. The actual create/resend network calls hit a 405 because the long-running local `velara-api-api-1` container is serving code baked in before Story 10.1 (predates this session — `docker exec` showed no `POST /users` route at all, i.e. stale relative to git HEAD `c4d4805`). Per explicit instruction and project memory, the live container was not rebuilt/restarted to work around this; BE behavior for create/resend is fully covered by the automated integration test suite instead (34 passing tests in `test_users.py` against a freshly-built local environment).

### Completion Notes List

- **BE (Tasks 1-4):** Added `status` to `UserSummary`/`UserSummaryRead` (additive), a `_normalize_user_status` helper mapping Cognito's top-level `UserStatus` field, and dev-shim invite-tracking (`_INVITED_EMAILS`, reset by `reset_seed()`). Added `resend_invite` to the `AuthProvider` Protocol with `CognitoAuthProvider` (AdminCreateUser `MessageAction="RESEND"`) and `DevAuthProvider` implementations, plus `UserNotFoundError`/`UserNotPendingError`. Added `POST /api/v1/users/resend-invite` (identical gating to `POST /users`: router `RejectClient` + in-handler `_require_grantor`), `provisioning_service.resend_user_invite` with best-effort `admin.user_invite_resent` audit, and the `EVENT_ADMIN_USER_INVITE_RESENT` constant. No migration, no Terraform change (as scoped).
- **BE tests:** 12 new tests in `test_users.py` (status on GET/POST, resend happy path for admin+ma_tech, consultant→403, client→404, unknown email→404, already-active→409, audit-row assertion via `session_scope()`, 502 on provider failure) plus 2 existing-test updates (added `status` to key-set assertions). Full suite green, spec regenerated and byte-stable.
- **FE (Tasks 5-10):** Added `status` to the `UserSummary` type, `createUser`/`resendInvite` API functions, and `useCreateUser`/`useResendInvite` mutations (house shape, key-prefix invalidation). Added the `Users` grantor-only nav tab + route. Built `UsersScreen.tsx` (flat directory table with client-side search, engagement-access resolution via `useAccessGrants` + `useClients`, per-row Resend on invited rows), `UserStatusBadge.tsx` (amber/teal/neutral pill), and `AddUserOverlay.tsx` (Stepper component accepting a `steps` array for 10.3 extensibility, 2-step Create→Done flow, form-value preservation on error, 409/422/502 error mapping).
- **FE tests:** 21 new tests across `UsersScreen.test.tsx`, `AddUserOverlay.test.tsx`, `UserStatusBadge.test.tsx`, plus additive assertions in `users.test.ts`. All existing nav/route gating tests pass unmodified (NavTabs' generic grantor-filter test and `internal.test.tsx` needed no changes).
- **Design reconciliation applied as scoped:** flat directory (no client-selector), no "Client/engagement" select in the create form (deferred to 10.3), Stepper renders 2 of its eventual 3 steps, inline `aria-live` confirmation instead of a toast system, amber status-pill tokens are net-new arbitrary Tailwind values.

### File List

**velara-api:**
- `app/integrations/auth.py` (modified — `status` field, `_normalize_user_status`, `resend_invite` Protocol method + both provider implementations, `UserNotFoundError`/`UserNotPendingError`, dev-shim `_INVITED_EMAILS`)
- `app/schemas/user.py` (modified — `UserSummaryRead.status`, new `UserInviteResend`)
- `app/api/v1/users.py` (modified — `status` on GET/POST responses, new `POST /users/resend-invite` route)
- `app/services/provisioning_service.py` (modified — new `resend_user_invite`)
- `app/models/audit.py` (modified — `EVENT_ADMIN_USER_INVITE_RESENT`)
- `tests/integration/api/test_users.py` (modified — 12 new tests, 2 updated assertions)
- `docs/api-spec.json` (regenerated)

**velara-web:**
- `src/api/users.ts` (modified — `status` field, `createUser`, `resendInvite`)
- `src/api/users.test.ts` (modified — additive `status` assertions, new `createUser`/`resendInvite` tests)
- `src/features/admin/hooks/useUsers.ts` (modified — `useCreateUser`, `useResendInvite`)
- `src/shared/components/navTabsData.ts` (modified — `users` nav tab)
- `src/routes/internal.tsx` (modified — `users/*` route)
- `src/features/admin/components/UsersScreen.tsx` (new)
- `src/features/admin/components/UsersScreen.test.tsx` (new)
- `src/features/admin/components/UserStatusBadge.tsx` (new)
- `src/features/admin/components/UserStatusBadge.test.tsx` (new)
- `src/features/admin/components/AddUserOverlay.tsx` (new)
- `src/features/admin/components/AddUserOverlay.test.tsx` (new)

## Change Log

| Date | Version | Description |
|------|---------|-------------|
| 2026-07-03 | 0.1.0 | Story 10.2 implemented (full-stack): BE — `status` surfaced on the user directory (`UserSummary`/`UserSummaryRead`, additive) + `POST /api/v1/users/resend-invite` (`AuthProvider.resend_invite` seam, gating identical to `POST /users`, best-effort `admin.user_invite_resent` audit); FE — grantor-only Users nav tab/route, `UsersScreen` (flat searchable directory table with engagement-access resolution), `UserStatusBadge`, `AddUserOverlay` (Stepper-based create→invite flow, 10.3-extensible). 12 new BE tests (34 total in `test_users.py`, full suite 1017/0 fail), 21 new FE tests (482 total, 0 regressions). `ruff`/`tsc`/`eslint` clean; `docs/api-spec.json` regenerated byte-stable. Manual browser verification confirmed FE rendering/behavior end-to-end; live create/resend calls blocked by a pre-existing stale local API container (predates this session, left untouched per instruction) — BE behavior fully covered by the automated suite instead. Status → review. |
