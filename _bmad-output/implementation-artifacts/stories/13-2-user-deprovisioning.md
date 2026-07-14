---
baseline_commit: e7d7a8b
---

# Story 13.2: User Deprovisioning (Disable / Revoke Access)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform administrator,
I want to disable a user's access to the platform and immediately invalidate their active sessions,
so that a terminated employee or offboarded client contact cannot log in, and I can evidence that removal to an auditor.

**Severity — the highest in Epic 13, and not because it's hard.** It is roughly the *smallest* story in the epic. It ranks first because *"we cannot revoke a terminated user's access"* is the first thing a SOC 2 auditor tests, and **no compensating control rescues it.** Today an operator's only recourse is the AWS Cognito console, out-of-band — which produces **no application audit event** (and, per 13.5, no CloudTrail record either). Revoking a *grant* (`admin.grant_revoked`, which does exist) removes data **scope** but leaves the **login active** — and the ID token is valid for **8 hours** with no server-side session kill, so even a grant revoke is not effective immediately.

## Acceptance Criteria

1. **AC1 — Deprovision disables at the IdP (never deletes) and writes an audit event.**
   **Given** an active user
   **When** an admin/ma_tech deprovisions them
   **Then** the user is **disabled** at the identity provider (Cognito `AdminDisableUser`) — **not deleted**, so the audit trail's `user_id` references remain resolvable — and an `admin.user_deprovisioned` audit event is written recording the actor, the target `user_id`, the org, and the UTC timestamp

2. **AC2 — Active sessions are KILLED, not merely prevented from renewing.**
   **Given** a deprovisioned user holding a still-valid (unexpired) ID token
   **When** they call **any** authenticated endpoint
   **Then** the request is rejected. **An 8-hour window in which a terminated user retains full access is not an acceptable answer to CC6.3.** Cognito's `AdminUserGlobalSignOut` revokes refresh tokens but does **NOT** invalidate an already-issued, unexpired ID token — the API validates ID tokens *structurally* against JWKS ([auth.py:527-567](../../../velara-api/app/integrations/auth.py#L527)) and never calls Cognito on the request path, so a disabled user's existing token still passes signature/exp/iss/aud validation. **Therefore an authoritative "is this principal still enabled?" check at the auth seam is REQUIRED, not optional.** See Dev Notes "⛔ TRAP 1" — this is the single hardest part of the story and the one most likely to be silently faked.

3. **AC3 — The directory shows deprovisioned status, and re-enable is possible and audited.**
   **Given** a deprovisioned user
   **When** an admin views the user directory (`GET /api/v1/users` → Users screen)
   **Then** their status renders as **disabled/deprovisioned** (the directory already surfaces status pills — Story 10.2), and a **re-enable** path exists (`AdminEnableUser`), also audited as `admin.user_reprovisioned`, so an accidental disable is recoverable

4. **AC4 — Role changes are auditable and possible in-platform.**
   **Given** the role a user holds
   **When** it is changed (e.g. `client` → `consultant`, or any escalation)
   **Then** the change is audited (`admin.user_role_changed`, capturing old→new). **Role modification is currently impossible in-platform and invisible when done in the console** — and CC6.3 covers *modification* of access, not only grant and revoke

5. **AC5 — IAM is least-privilege, and every action name is verified against the real Cognito API.**
   **Given** the IAM policy for the API task role ([iam.tf:113-123](../../../velara-api/terraform/iam.tf#L113))
   **When** deprovisioning is invoked
   **Then** it has exactly the Cognito actions it needs (`AdminDisableUser`, `AdminEnableUser`, `AdminUserGlobalSignOut`, `AdminUpdateUserAttributes` for AC4) and no more. **Note the phantom-IAM-action lesson from Story 10.1:** verify each action name against the real Cognito API surface before adding it — **a non-existent action name is silently accepted by IAM and fails only at call time.**

6. **AC6 — New event types are categorized (Story 13.1's guard test enforces this).**
   **Given** the new `admin.user_deprovisioned`, `admin.user_reprovisioned`, and `admin.user_role_changed` event types this story introduces
   **When** they are added
   **Then** each is assigned to the **Access Control** category in [audit_categories.py](../../../velara-api/app/models/audit_categories.py)'s `EVENT_TYPE_TO_CATEGORY`, and Story 13.1's guard test (`tests/unit/test_audit_category_guard.py`) passes. **This is not optional bookkeeping — the guard test FAILS CI if you skip it.**

7. **AC7 — The 12.5 audit-coverage guard registry stays green.**
   **Given** the new mutating routes this story adds
   **When** the test suite runs
   **Then** each new `(method, path)` is registered in `tests/unit/test_audit_coverage_guard.py`'s `REGISTRY` with an `audited` decision naming its real event constant — 12.5's route-walk guard fails CI on any unregistered mutating route

## Tasks / Subtasks

- [x] **Task 1 — Add the three event-type constants + categorize them (AC1, AC3, AC4, AC6)**
  - [x] In [app/models/audit.py](../../../velara-api/app/models/audit.py), beside the existing `EVENT_ADMIN_USER_PROVISIONED` / `EVENT_ADMIN_USER_INVITE_RESENT` block (lines 52-55), add: `EVENT_ADMIN_USER_DEPROVISIONED = "admin.user_deprovisioned"`, `EVENT_ADMIN_USER_REPROVISIONED = "admin.user_reprovisioned"`, `EVENT_ADMIN_USER_ROLE_CHANGED = "admin.user_role_changed"`. One-line comment each naming this story, matching the house style. **Stable strings — never rename after deploy** (the table is append-only; a renamed event type orphans every historical row).
  - [x] In [app/models/audit_categories.py](../../../velara-api/app/models/audit_categories.py), add all three to `EVENT_TYPE_TO_CATEGORY` under `CATEGORY_ACCESS_CONTROL` (the epic's taxonomy table is authoritative — do not re-derive). `CATEGORY_TO_EVENT_TYPES` is precomputed from that dict at import, so nothing else needs touching.
  - [x] Do **not** add them to `OUTCOME_TO_EVENT_TYPE` (invocation-only) and do **not** add them to `OUTCOME_BEARING_CATEGORIES` — admin events carry `outcome=None`, which is exactly why 13.1's review fixed the outcome filter to be gated on `OUTCOME_BEARING_CATEGORIES`. Access Control must stay out of that set.

- [x] **Task 2 — Extend the `AuthProvider` Protocol with three new methods (AC1, AC3, AC4, AC5)**
  - [x] [app/integrations/auth.py](../../../velara-api/app/integrations/auth.py) defines exactly five methods on `AuthProvider` today (`issue_token`, `validate_token`, `list_users`, `create_user`, `resend_invite`) — there is **no `disable_user`, no `delete_user`, no `set_role`**. Add to the `Protocol` (lines 154-214):
    - `disable_user(*, user_id_or_email: str) -> AuthPrincipal` — disable + global sign-out
    - `enable_user(*, user_id_or_email: str) -> AuthPrincipal` — re-enable
    - `set_user_role(*, user_id_or_email: str, role: str) -> AuthPrincipal` — change `custom:role`
  - [x] ⚠️ **Identity-key decision — make it deliberately.** Existing provider methods are keyed by **email** (`resend_invite(email=...)`) because the pool is `username_attributes=["email"]` — Cognito's `Username` **is** the email. But the audit trail, grants, and `UserSummary.user_id` are all keyed by the opaque **`sub`**. The `Admin*` API calls take `Username`, not `sub`. **Choose one and state it in the docstring:** either (a) route by email like `resend_invite` does (simplest, consistent with 10.2, and the FE already has `user.email` on every row), or (b) accept a `sub` and resolve it to a username via an extra `ListUsers` round-trip. **Recommend (a)** — the FE Users table already carries `email` on every `UserSummary`, and it keeps the provider seam consistent. **But the AUDIT event must still record the `user_id` (sub)**, not the email as the primary key — the provider returns an `AuthPrincipal` carrying the sub, so record that.
  - [x] **`CognitoAuthProvider` implementations:** copy the dedicated-credential boilerplate from `create_user`/`resend_invite` verbatim (the `COGNITO_AWS_*`-when-set-else-default-chain pattern at [auth.py:641-646](../../../velara-api/app/integrations/auth.py#L641)) — do NOT invent a new client-construction path.
    - `disable_user`: call `admin_disable_user(UserPoolId=..., Username=email)` **then** `admin_user_global_sign_out(UserPoolId=..., Username=email)`. Both, in that order. Map `UserNotFoundException` → `UserNotFoundError` (→404); any other `ClientError`/`BotoCoreError` → `UserDirectoryError` (→502) — the exact shape `resend_invite` uses at [auth.py:730-744](../../../velara-api/app/integrations/auth.py#L730).
    - `enable_user`: `admin_enable_user(...)`. Same error mapping.
    - `set_user_role`: `admin_update_user_attributes(UserPoolId=..., Username=email, UserAttributes=[{"Name": "custom:role", "Value": role}])`. Same error mapping. **Read the user's CURRENT role first** (via `admin_get_user`, or from `list_users`) so the audit event can record old→new (AC4).
  - [x] **`DevAuthProvider` implementations** (offline parity — the integration suite runs `AUTH_BACKEND=dev`): mirror the seed-shim pattern. Add a module-level `_DISABLED_USER_IDS: set[str]` (alongside the existing `_INVITED_EMAILS` set at [auth.py:288](../../../velara-api/app/integrations/auth.py#L288)). `disable_user` adds to it, `enable_user` removes, `set_user_role` replaces the `AuthPrincipal` in `_SEED_USERS` (it's a frozen dataclass — use `dataclasses.replace`). **CRITICAL: add `_DISABLED_USER_IDS.clear()` to `reset_seed()` ([auth.py:456-468](../../../velara-api/app/integrations/auth.py#L456))** — the 10.1 state-isolation trap is documented right there: module globals have no automatic reset and a disabled user in one test will leak into the next.
  - [x] `DevAuthProvider.list_users` must report `status="disabled"` for anyone in `_DISABLED_USER_IDS` (the status precedence: disabled > invited > active).

- [x] **Task 3 — The session kill: an authoritative enabled-check at the auth seam (AC2 — THE HARD PART, READ TRAP 1 FIRST)**
  - [x] `get_current_user` ([app/core/dependencies.py:67-83](../../../velara-api/app/core/dependencies.py#L67)) is **THE single auth validation seam** — its own docstring says so ("nothing else touches the token directly"). This is where the enabled-check belongs. A disabled user's unexpired ID token passes `validate_token` today because validation is purely structural (JWKS signature + exp + iss + aud + `token_use=id`) — **no network call to Cognito on the request path.**
  - [x] Add an `is_user_enabled(user_id_or_email) -> bool` (or fold it into a `validate_principal` step) on the `AuthProvider` seam:
    - **Cognito:** `admin_get_user(...)` returns `Enabled: bool` and `UserStatus`. `AdminGetUser` is **already in the IAM policy** ([iam.tf:118](../../../velara-api/terraform/iam.tf#L118)) — no TF change needed for *this* call.
    - **Dev:** check `_DISABLED_USER_IDS`.
  - [x] ⚠️ **Performance — this is a per-request Cognito call. You MUST cache it.** An uncached `AdminGetUser` on every authenticated request adds a network round-trip to the hot path and will hit Cognito's rate limits. **Use a short-TTL cache** (e.g. 60s, keyed by `user_id`) — a 60-second worst-case window between disable and effective lockout is a defensible, documentable answer to CC6.3 (versus today's 8 hours), and is the standard pattern. **Bust the cache entry for the target user on `disable_user`** so a deprovision is effective *immediately* for the deprovisioning path itself, not after the TTL. State the chosen TTL and the reasoning in a code comment — an auditor will ask "how long is the window?", and "8 hours" is a finding while "60 seconds, and we bust on disable" is a control.
  - [x] Enforce it in `get_current_user`: a disabled principal → `VelaraHTTPException(401, "UNAUTHORIZED", ...)` — the same envelope an invalid token produces. Do **not** invent a new status code; a revoked session is an auth failure.
  - [x] **A cache failure must not fail-open.** If the `AdminGetUser` call errors (Cognito down, throttled), decide deliberately: fail-closed (401 — safe, but a Cognito blip logs everyone out) or serve the last-known-good cached value and log loudly. **Recommend: serve last-known-good if present, else fail-closed.** Whatever you choose, write the reasoning in the code — this is an availability/security tradeoff a reviewer will interrogate.

- [x] **Task 4 — `provisioning_service` gains three orchestration functions (AC1, AC3, AC4)**
  - [x] [app/services/provisioning_service.py](../../../velara-api/app/services/provisioning_service.py) is the existing seam — it already does exactly this shape twice (`provision_user`, `resend_user_invite`): call the provider, `logger.info(...)`, then a **best-effort** audit write in a `try/except` that logs `logger.warning(..., exc_info=True)` and swallows. **Copy that shape verbatim** for `deprovision_user`, `reprovision_user`, `change_user_role`.
  - [x] Audit metadata (reference-only — the same IP/PHI discipline 12.5 established):
    - `deprovision_user` → `{"deprovisioned_user_id": <sub>, "email": <email>}` — the email is admin-supplied, not PHI (10.1 already logs it on `user_provisioned`, so this is consistent).
    - `reprovision_user` → `{"reprovisioned_user_id": <sub>, "email": <email>}`
    - `change_user_role` → `{"target_user_id": <sub>, "email": <email>, "from_role": <old>, "to_role": <new>}` — **old→new is the whole point of AC4**; capture the old role BEFORE the update call.
  - [x] All three: `hierarchy_path="org"`, `org_id=<caller's org>`, `user_id=<acting admin's sub>` — the invariant convention for every admin event. **Do NOT** touch `list_entries`'s org fence; see 12.5's Trap 2 (`hierarchy_path="org"` is correct and the fence is carried by the `org_id` column).
  - [x] **Best-effort ordering:** the audit write happens **AFTER** the provider call succeeds. A failed audit write must never leave a user enabled when the admin was told they were disabled — and equally must never *roll back* a successful disable. (The provider call is not transactional with the DB, so "after" is the only correct order.)

- [x] **Task 5 — Routes (AC1, AC3, AC4, AC7)**
  - [x] [app/api/v1/users.py](../../../velara-api/app/api/v1/users.py) exposes only `GET /users`, `POST /users`, `POST /users/resend-invite` — **no DELETE, no PATCH.** Add:
    - `POST /api/v1/users/deprovision` (body: `{email}`) — or `DELETE /api/v1/users/{user_id}`. **Prefer POST-with-body**, matching `resend-invite`'s existing shape and sidestepping the sub-vs-email key problem in a path param. State the choice.
    - `POST /api/v1/users/reprovision` (body: `{email}`)
    - `PATCH /api/v1/users/role` (body: `{email, role}`) — `role` is `Literal["client", "consultant"]`, reusing `UserCreate`'s exact enforcement rationale ([schemas/user.py](../../../velara-api/app/schemas/user.py): admin/ma_tech are structurally unrepresentable → 422, privileged accounts stay console-only).
  - [x] ⚠️ **GATING — copy the 10.1 trap comment exactly.** The router carries `dependencies=[RejectClient]` (404s client tokens) and each handler calls `_require_grantor(user.role)` (403s consultant). **Do NOT add a route-level `RejectNonGrantor`** — the existing handlers' docstrings warn about this explicitly ([users.py:105-115](../../../velara-api/app/api/v1/users.py#L105)): it would 404 the consultant (wrong code) and regress the GET consultant→403 contract.
  - [x] Error mapping, mirroring the existing handlers: `UserNotFoundError` → 404 `USER_NOT_FOUND`; `UserDirectoryError` → 502 `USER_DIRECTORY_UNAVAILABLE`.
  - [x] **Self-deprovision guard:** an admin deprovisioning *themselves* locks them out instantly (Task 3's cache-bust makes it immediate). Reject it — 422 or 409 with a clear message. This is a 30-second guard that prevents a very embarrassing support ticket.
  - [x] **Register all three new routes in `tests/unit/test_audit_coverage_guard.py`'s `REGISTRY`** with `{"audited": "EVENT_ADMIN_USER_DEPROVISIONED"}` etc. (AC7). The route-walk guard **will** fail CI otherwise — that is it working as designed.

- [x] **Task 6 — Terraform: add the two genuinely-missing IAM actions (AC5)**
  - [x] ⚠️ **READ THIS BEFORE EDITING:** `AdminDisableUser` and `AdminGetUser` are **ALREADY in the policy** ([iam.tf:117-121](../../../velara-api/terraform/iam.tf#L117)) — granted speculatively in Story 10.1 and **never called by any app code** (verified: zero references in `app/`). Do not "add" them again. The genuinely missing ones are **`cognito-idp:AdminEnableUser`**, **`cognito-idp:AdminUserGlobalSignOut`**, and **`cognito-idp:AdminUpdateUserAttributes`** (for AC4's role change).
  - [x] **Verify each action name against the real Cognito API before adding it (AC5 / the Story 10.1 phantom-action lesson).** Story 10.1 shipped a **non-existent** `AdminResendInvitation` action — IAM accepted it silently and it failed only at call time. The three names above are believed correct; confirm them against the AWS docs, not from memory.
  - [x] Keep the statement scoped to `aws_cognito_user_pool.main.arn` (no wildcard — least privilege, as it is today).
  - [x] ⚠️ **Do NOT `terraform apply`.** Standing project rule and an explicit Epic 13 warning. **Author + `terraform plan` only; the operator applies.** The 9.3 lesson (reconfiguring a live service broke the user's Cognito session) applies with full force — this touches the auth path.

- [x] **Task 7 — Frontend: deprovision/re-enable/role-change in the Users screen (AC3, AC4)**
  - [x] [api/users.ts](../../../velara-web/src/api/users.ts): add `deprovisionUser`, `reprovisionUser`, `changeUserRole` calls; extend the `UserStatus` union from `'invited' | 'active' | 'unknown'` to include `'disabled'`.
  - [x] [features/admin/hooks/useUsers.ts](../../../velara-web/src/features/admin/hooks/useUsers.ts): add `useDeprovisionUser`, `useReprovisionUser`, `useChangeUserRole` mutations — each invalidating `['users']` on success, copying `useResendInvite`'s exact shape.
  - [x] [components/UserStatusBadge.tsx](../../../velara-web/src/features/admin/components/UserStatusBadge.tsx): add a `disabled` branch (currently handles `invited` / `active` / fallback-unknown). Use V3 brand tokens; a muted/danger treatment is appropriate. **Hard project rule: NO emoji/unicode glyphs as icons — use `<Icon>` from `shared/components/Icon.tsx`.**
  - [x] [components/UsersScreen.tsx](../../../velara-web/src/features/admin/components/UsersScreen.tsx): the action column currently renders `<ResendButton>` only when `user.status === 'invited'` (line 196). Add a **Deprovision** action for `active`/`invited` users and a **Re-enable** action for `disabled` users, both grantor-gated (`isGrantor()` — the "Add user" button at line 138 shows the pattern).
  - [x] **Deprovision needs a confirmation step.** It kills a person's access. A one-click destructive action with no confirm is a UX defect; use a simple confirm dialog/overlay stating the user's name and that active sessions will be terminated.
  - [x] Role change: a small inline `<select>` or an overlay. Keep it grantor-gated. (If this materially grows the story, it is the one sub-part that could be split — but AC4 is explicit and CC6.3 requires *modification* coverage, so do not silently drop it.)

- [x] **Task 8 — Tests**
  - [x] **The AC2 test is the one that matters.** Drive it end-to-end: provision a user → issue them a valid token → assert an authenticated call succeeds → deprovision them → **assert the SAME (still-unexpired) token now gets 401.** If this test doesn't exist, AC2 is not done, no matter what the code looks like. Put it in `tests/integration/api/` beside the existing users tests.
  - [x] Audit-event tests: assert each of the three new events lands in `audit_log_entries` with the right `user_id` (the ACTOR), `org_id`, `hierarchy_path="org"`, and metadata. For `admin.user_role_changed`, **assert the old→new pair is present** (AC4's whole point).
  - [x] **Best-effort proof:** monkeypatch `audit_service.record_admin_action` to raise and assert the deprovision still succeeds (the user is still disabled). Reuse the existing `_boom` pattern — `tests/integration/api/test_skills.py:2965` does exactly this; copy its shape.
  - [x] Gating tests: client → 404, consultant → 403 on all three new routes (the 10.1 gating contract).
  - [x] Self-deprovision guard test.
  - [x] Guard tests must be green: `tests/unit/test_audit_category_guard.py` (AC6 — will fail if the three constants aren't categorized) and `tests/unit/test_audit_coverage_guard.py` (AC7 — will fail if the three routes aren't registered).

- [x] **Task 9 — Gates**
  - [x] **Backend:** `ruff check .` clean; unit suite green; integration suite green (`AUTH_BACKEND=dev` override — the container defaults to `cognito` and 401s dev tokens).
  - [x] **`docs/api-spec.json`:** regenerate. Expect an **additive** diff (3 new routes + the extended status enum). ⚠️ **13.1's TRAP: `scripts/export_openapi.py` writes to `/app/docs/api-spec.json` INSIDE the container, which is baked into the image and NOT bind-mounted.** Running `docker compose exec api python -m scripts.export_openapi` regenerates it in the container and **never touches the host file** — while printing a reassuring success message. **Always `docker cp "$(docker compose ps -q api):/app/docs/api-spec.json" docs/api-spec.json` after regenerating**, or run the script on the host. CI `git diff --exit-code`s this file.
  - [x] **No migration.** Identities live in Cognito — there is **no users table**. If you find yourself writing a migration, stop.
  - [x] **Terraform:** `terraform plan` only. **Do NOT apply.**
  - [x] **Frontend:** `npm run typecheck` → 0; `npm run lint` → no new warnings (1 pre-existing `Icon.tsx` warning is the baseline); `npx vitest run` → all green.

## Dev Notes

### ⛔ TRAP 1 — `AdminUserGlobalSignOut` does NOT satisfy AC2 on its own. This is the crux of the story.

The obvious implementation is: call `AdminDisableUser`, call `AdminUserGlobalSignOut`, ship it. **That does not kill the session, and the resulting story would fail its own headline AC while looking correct.**

Here is why, verified in this codebase:
- `AdminUserGlobalSignOut` revokes **refresh tokens** and invalidates access tokens *for Cognito's own token endpoints*. It does **not** and cannot retroactively invalidate an **already-issued ID token** — that token is a self-contained, signed JWT sitting in the user's browser.
- This API validates ID tokens **structurally and offline**: `CognitoAuthProvider.validate_token` ([auth.py:527-567](../../../velara-api/app/integrations/auth.py#L527)) checks the JWKS signature, `exp`, `iss`, `aud`, and `token_use == "id"`. **It makes no call to Cognito.** A disabled user's unexpired token passes every one of those checks.
- `id_token_validity = 8` hours ([cognito.tf:137](../../../velara-api/terraform/cognito.tf#L137)).

**Net: disable + global-sign-out alone leaves a terminated user with up to 8 hours of full, authenticated access.** That is precisely the failure the epic calls out ("An 8-hour window in which a terminated user retains full access is not an acceptable answer to CC6.3") and precisely what a naive implementation ships.

**The fix is Task 3:** an authoritative enabled-check at `get_current_user`, cached with a short TTL. Do both — `AdminUserGlobalSignOut` still matters (it stops the *refresh* path from minting new tokens, so the lockout is permanent rather than 8-hours-then-they-log-back-in), but the enabled-check is what closes the window on the *existing* token. Neither alone is sufficient.

[Source: auth.py:527-567 read in full; cognito.tf:137; AWS Cognito token semantics]

### ⛔ TRAP 2 — Two of the IAM actions you'd "add" are already there, and one action you might add doesn't exist

`iam.tf`'s `CognitoUserAdmin` statement ([iam.tf:113-123](../../../velara-api/terraform/iam.tf#L113)) **already grants** `AdminCreateUser`, `AdminGetUser`, `AdminDisableUser`, `ListUsers`. **`AdminDisableUser` and `AdminGetUser` are granted but called by ZERO app code** — verified by grep across `app/`. They were added speculatively in Story 10.1. So:
- **Do not re-add them** (a duplicate action in the list is harmless but signals you didn't read the file).
- **`AdminGetUser` being already-granted is a gift** — Task 3's per-request enabled-check needs exactly that action, and no TF change is required to make the check *work*. (The TF change is still needed for `AdminEnableUser` / `AdminUserGlobalSignOut` / `AdminUpdateUserAttributes`.)
- **Story 10.1's phantom-action lesson:** that story shipped a **non-existent** `AdminResendInvitation` IAM action. IAM accepted it silently — a bogus action name is not a syntax error — and it failed only at call time. **Verify every action name you add against the real Cognito API surface.** The three you need are believed to be `AdminEnableUser`, `AdminUserGlobalSignOut`, `AdminUpdateUserAttributes`; confirm, don't assume.

[Source: iam.tf:108-123 read in full; grep of `app/` for AdminDisableUser/AdminGetUser → zero hits; memory: Story 10.1 phantom AdminResendInvitation]

### ⛔ TRAP 3 — The dev-shim seed state leaks between tests unless you extend `reset_seed()`

`DevAuthProvider` keeps its state in **module-level globals**: `_SEED_USERS`, `_SEED_EMAILS`, `_INVITED_EMAILS` ([auth.py:219-288](../../../velara-api/app/integrations/auth.py#L219)). There is **no automatic reset** — an autouse fixture calls `DevAuthProvider.reset_seed()` ([auth.py:456-468](../../../velara-api/app/integrations/auth.py#L456)) between tests, and that function restores each global explicitly from a pristine import-time snapshot. The docstring calls this out as the "Story 10.1 state-isolation trap."

**Your new `_DISABLED_USER_IDS` set is a fourth global with the same hazard.** If you don't add `_DISABLED_USER_IDS.clear()` to `reset_seed()`, a user disabled in one test stays disabled in every subsequent test in the process — producing a cascade of baffling 401s in tests that have nothing to do with this story. Add the clear line. It is one line and it will cost you an hour if you miss it.

### The `provisioning_service` shape is already correct — copy it, don't redesign it

[provisioning_service.py](../../../velara-api/app/services/provisioning_service.py) does exactly this pattern twice already. `provision_user` (lines 25-76) is the exemplar:

```python
provider = get_auth_provider()
created = provider.create_user(...)          # 1. provider call

logger.info("user_provisioned", ...)          # 2. structured log

try:                                          # 3. best-effort audit AFTER
    await audit_service.record_admin_action(
        session=session,
        event_type=EVENT_ADMIN_USER_PROVISIONED,
        user_id=provisioned_by_user_id,       # the ACTOR, not the target
        org_id=org_id,
        hierarchy_path="org",                 # literal string — see 12.5 Trap 2
        metadata={...},
    )
except Exception:
    logger.warning("user_provisioned_audit_failed", ..., exc_info=True)

return created
```

Three load-bearing details: **(1)** `user_id` on the audit row is the **acting admin's** sub — the target goes in `metadata`. **(2)** `hierarchy_path="org"` is the correct, current convention for every admin event; the org fence is carried by the `org_id` **column** (migration 0020). Do not "fix" it — see 12.5's Trap 2, and `audit_service.list_entries`'s docstring, which ends with *"Do NOT reintroduce a hierarchy_path-based org fence."* **(3)** The audit write is **after** the provider call and **swallowed on failure** — an audit-write failure must never undo a successful disable.

### Identity keys: `sub` vs `email` — the seam is inconsistent today, and you must not make it worse

- **Cognito `Admin*` APIs take `Username`** — and the pool is `username_attributes=["email"]`, so `Username` **is the email**.
- **`AuthPrincipal.user_id` / `UserSummary.user_id` / the audit trail / access grants** are all keyed by the opaque **`sub`**.
- **`resend_invite` routes by email** ([auth.py:699](../../../velara-api/app/integrations/auth.py#L699), `UserInviteResend` schema) precisely because of this — and its schema docstring explains the reasoning: *"no path `user_id`, since resolving a sub to a username would require an extra `ListUsers` round-trip."*

**So:** key the new provider methods and routes by **email** (consistent with 10.2, and the FE has `email` on every directory row), but **record the `sub` in the audit event's `user_id`/metadata** — the sub is the permanent, resolvable key that the audit trail, grants, and `AuthPrincipal` all share. The provider returns an `AuthPrincipal` (carrying the sub) from each call; use it. **Never let the audit trail key a user by email** — an email can change; a sub cannot.

**Watch out:** `UserSummary.email` is `str | None`. A Cognito user with no email attribute would break an email-keyed action. The FE must not offer Deprovision on a row with `email === null` (it already guards `ResendButton` this way: `user.status === 'invited' && user.email` at [UsersScreen.tsx:196](../../../velara-web/src/features/admin/components/UsersScreen.tsx#L196)). Mirror that guard.

### Status precedence in the directory (AC3)

`_normalize_user_status` ([auth.py:471-485](../../../velara-api/app/integrations/auth.py#L471)) maps Cognito's `UserStatus` → `invited` / `active` / `unknown`. **`UserStatus` is orthogonal to `Enabled`** — a disabled user retains `UserStatus: CONFIRMED`. `ListUsers` returns **both** `UserStatus` (top-level) **and** `Enabled` (top-level bool).

So `CognitoAuthProvider.list_users` ([auth.py:569-620](../../../velara-api/app/integrations/auth.py#L569)) must now read `u.get("Enabled")` as well, and status resolution becomes: **`Enabled == False` → `"disabled"` (highest precedence), else the existing `UserStatus` mapping.** A disabled-but-CONFIRMED user must render as **Disabled**, not Active. Getting this backwards means the Users screen tells an admin a terminated user is still Active — the exact opposite of AC3.

### What "no migration" means here

There is **no users table.** Identities live entirely in Cognito; `create_grant` stores an opaque `user_id` with **no FK** ([provisioning_service.py:7-10](../../../velara-api/app/services/provisioning_service.py#L7) says so explicitly). Disabling a user changes **Cognito state**, not database state. The only DB write this story makes is the append-only audit row. **If you find yourself writing an alembic migration, you have gone off the rails.**

This is also why AC1 says *disable, never delete*: the audit trail stores `user_id` strings with no FK, so a deleted Cognito user would leave every historical audit row pointing at a sub that no longer resolves to a name in `GET /users` — the trail would still exist but become unreadable. Disable preserves resolvability.

### Testing standards

- **BE:** pytest. Integration tests drive **real API routes** (the established convention — `test_audit_service.py`'s AC7 block set it: *"exercised end-to-end via the real API routes, not by calling the service function directly, so the wiring is actually proven"*). The AC2 session-kill test **must** go through the real route with a real token.
- **Known local artifact:** the API container defaults to `AUTH_BACKEND=cognito`, which 401s dev tokens — run the integration suite with an `AUTH_BACKEND=dev` override.
- **FE:** vitest + Testing Library, colocated (`UsersScreen.test.tsx`, `UserStatusBadge.test.tsx` already exist — extend them).
- **Guard tests are gates, not suggestions:** `test_audit_category_guard.py` (13.1) fails CI if the three new constants aren't categorized; `test_audit_coverage_guard.py` (12.5) fails CI if the three new routes aren't registered. Both will go red the moment you add code, and both are *supposed to*.

### Project Structure Notes

- `velara-api/app/models/audit.py` — MODIFIED (+3 `EVENT_ADMIN_USER_*` constants)
- `velara-api/app/models/audit_categories.py` — MODIFIED (+3 entries under `CATEGORY_ACCESS_CONTROL`)
- `velara-api/app/integrations/auth.py` — MODIFIED (Protocol +3 methods + an enabled-check; both providers implement; `_DISABLED_USER_IDS` global; `reset_seed()` clears it; `list_users` reads `Enabled`)
- `velara-api/app/core/dependencies.py` — MODIFIED (`get_current_user` gains the cached enabled-check — **AC2's home**)
- `velara-api/app/services/provisioning_service.py` — MODIFIED (+`deprovision_user`, `reprovision_user`, `change_user_role`)
- `velara-api/app/api/v1/users.py` — MODIFIED (+3 routes)
- `velara-api/app/schemas/user.py` — MODIFIED (+ request bodies; `status` union gains `disabled`)
- `velara-api/terraform/iam.tf` — MODIFIED (+`AdminEnableUser`, `AdminUserGlobalSignOut`, `AdminUpdateUserAttributes`) — **plan only, do not apply**
- `velara-api/tests/unit/test_audit_coverage_guard.py` — MODIFIED (register the 3 new routes — AC7)
- `velara-api/tests/integration/api/` — MODIFIED/NEW (the AC2 session-kill test above all)
- `velara-api/docs/api-spec.json` — regenerated (**via `docker cp`, not `exec`** — see the 13.1 trap)
- `velara-web/src/api/users.ts`, `features/admin/hooks/useUsers.ts`, `components/UsersScreen.tsx`, `components/UserStatusBadge.tsx` (+ their `.test.tsx`) — MODIFIED

**No migration. No new DB table or column.**

### References

- [Source: epics/epic-13-compliance-audit-and-access-controls.md#Story-13.2] — the ACs verbatim, the severity framing, the code-verified gap inventory, the phantom-IAM-action warning.
- [Source: velara-api/app/integrations/auth.py] — the 5-method `AuthProvider` Protocol (lines 154-214) this story extends; `CognitoAuthProvider`'s dedicated-credential boilerplate (641-646) and error-mapping shape (730-744) to copy; `DevAuthProvider`'s seed globals + `reset_seed()` (219-288, 456-468) — Trap 3; `_normalize_user_status` (471-485) and `list_users` (569-620) for the `Enabled`-precedence change; `validate_token` (527-567) — **why AC2 needs more than a global sign-out (Trap 1)**.
- [Source: velara-api/app/core/dependencies.py:67-83] — `get_current_user`, THE single auth seam; where AC2's enabled-check belongs.
- [Source: velara-api/app/services/provisioning_service.py] — the exact best-effort audit + provider-call shape to copy (provision_user, lines 25-76).
- [Source: velara-api/app/api/v1/users.py:105-115, 159-165] — the gating trap (RejectClient + `_require_grantor`; **never** add route-level `RejectNonGrantor`), and the error-mapping shape for 404/409/502.
- [Source: velara-api/terraform/iam.tf:108-123] — the `CognitoUserAdmin` statement; `AdminDisableUser`/`AdminGetUser` already granted and unused (Trap 2).
- [Source: velara-api/terraform/cognito.tf:137] — `id_token_validity = 8` hours: the window AC2 exists to close.
- [Source: velara-api/app/models/audit_categories.py] — 13.1's taxonomy; add the 3 new constants to `CATEGORY_ACCESS_CONTROL` (AC6). `OUTCOME_BEARING_CATEGORIES` must NOT gain Access Control (admin events carry `outcome=None` — 13.1's headline review finding).
- [Source: velara-api/tests/unit/test_audit_coverage_guard.py] — 12.5's route-walk `REGISTRY`; the 3 new routes must be registered (AC7).
- [Source: implementation-artifacts/stories/13-1-audit-event-categorization.md#Review-Findings] — the `export_openapi.py`-writes-inside-the-container trap (Task 9); the outcome-is-NULL-for-admin-events finding.
- [Source: implementation-artifacts/stories/12-5-audit-coverage-skill-authoring-ingest.md] — Trap 2 (`hierarchy_path="org"` is correct, do not "fix" it); the `_boom` best-effort monkeypatch test pattern (test_skills.py:2965).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `docker compose exec -T -e AUTH_BACKEND=dev api pytest tests/unit -q` → 728 passed
- `docker compose exec -T -e AUTH_BACKEND=dev api pytest tests/integration -q` → 664 passed, 3 skipped
- `docker compose exec -T api ruff check .` → All checks passed!
- `docker cp "$(docker compose ps -q api):/app/docs/api-spec.json" docs/api-spec.json` → additive diff (3 new routes + `disabled` status)
- `terraform validate` → Success (no AWS credentials available in this environment to run a real `plan`; author + validate only, per the task's "do NOT apply" rule — operator runs the real `plan`/`apply`)
- `npm run typecheck` → 0 errors
- `npm run lint` → 1 pre-existing `Icon.tsx` warning (baseline, no new warnings)
- `npx vitest run` → 698 passed (58 files), incl. `UsersScreen.test.tsx` (18) and `UserStatusBadge.test.tsx` (4)

### Completion Notes List

- Implemented the full deprovision/reprovision/role-change flow per the story's Dev Notes: `disable_user`+`admin_user_global_sign_out` alone does NOT satisfy AC2 (Trap 1) — the actual fix is a cached `is_user_enabled` check added to `get_current_user` (the single auth seam), with a 60s TTL cache busted immediately on disable/enable. A Cognito/directory failure serves the last-known-good cached value if present, else fails closed (treats the principal as disabled) — documented in code as the availability/security tradeoff.
- `AuthProvider` Protocol gained `disable_user`, `enable_user`, `set_user_role`, `is_user_enabled` — routed by email (consistent with `resend_invite`/10.2) except `is_user_enabled`, which is routed by `sub` (the only identifier `get_current_user` has); Cognito's `Admin*` APIs accept a `sub` as `Username` directly, so no extra `ListUsers` round-trip is needed.
- `DevAuthProvider` gained a fourth module-level global, `_DISABLED_USER_IDS`, and `reset_seed()` was extended to clear it (Trap 3) — verified via the full unit+integration suite that no cross-test leakage occurs.
- Terraform: added `AdminEnableUser`, `AdminUserGlobalSignOut`, `AdminUpdateUserAttributes` to the existing `CognitoUserAdmin` IAM statement (verified against real Cognito API action names, not from memory, per the 10.1 phantom-action lesson). `AdminDisableUser`/`AdminGetUser` were already present from Story 10.1 and were NOT re-added. `terraform validate` passes; a real `terraform plan` could not be run in this environment (no reachable remote state backend/AWS credentials) — author-only, as instructed; operator applies.
- Self-deprovision guard resolves the target's identity via the directory (`list_users`) BEFORE calling the provider, so a caller who would deprovision themselves is rejected (409 `SELF_DEPROVISION_NOT_ALLOWED`) without ever disabling their own account.
- Two pre-existing, order-dependent test-pollution failures (`test_auth.py::test_me_with_expired_token_returns_401`, `test_auth_cognito.py::test_dev_login_endpoint_returns_404_under_cognito`) surface ONLY when `tests/unit` and `tests/integration` run in the same pytest invocation — verified via a throwaway git worktree that this reproduces identically on the pre-13.2 baseline commit (1b37615), so it is unrelated to this story. Not fixed (out of scope); both suites are fully green when run separately, which is what the story's Task 9 gate specifies.
- One pre-existing test (`test_audit_service.py::TestCategoryExpansion::test_access_control_expands_to_five_event_types`) hardcoded the exact Access Control event-type set; updated (renamed to `..._expands_to_eight_event_types`) to include the 3 new constants — this test was explicitly designed by Story 13.1 to be extended by future stories.
- `tests/integration/api/test_auth_cognito.py`'s `cognito_provider` fixture now also stubs `is_user_enabled` so its token-validation-focused tests aren't coupled to a real Cognito pool (they'd otherwise get a real `AdminGetUser` call against a nonexistent test pool and 401 via the new fail-closed path).
- Frontend: `UsersScreen` gained a `RoleSelect` (client/consultant only — internal roles render a plain label), a `DeprovisionButton` with a confirm dialog (mirrors `AccessControl.tsx`'s `RevokeGrantDialog` pattern), and a `ReprovisionButton` (no confirm — re-enabling is not destructive). All three are grantor-gated and guard on `user.email` being non-null, mirroring the existing `ResendButton` guard.

### File List

**velara-api:**
- `app/models/audit.py` — MODIFIED (+3 `EVENT_ADMIN_USER_*` constants)
- `app/models/audit_categories.py` — MODIFIED (+3 entries under `CATEGORY_ACCESS_CONTROL`)
- `app/integrations/auth.py` — MODIFIED (Protocol +4 methods: `disable_user`, `enable_user`, `set_user_role`, `is_user_enabled`; both providers implement; `_DISABLED_USER_IDS` global; `reset_seed()` clears it; `list_users` reads `Enabled` for status precedence)
- `app/core/dependencies.py` — MODIFIED (`get_current_user` gains the cached enabled-check + `_bust_enabled_cache`/`_is_user_enabled_cached` — AC2's home)
- `app/services/provisioning_service.py` — MODIFIED (+`deprovision_user`, `reprovision_user`, `change_user_role`)
- `app/api/v1/users.py` — MODIFIED (+3 routes: `POST /users/deprovision`, `POST /users/reprovision`, `PATCH /users/role`)
- `app/schemas/user.py` — MODIFIED (+`UserDeprovision`, `UserReprovision`, `UserRoleChange` request bodies)
- `terraform/iam.tf` — MODIFIED (+`AdminEnableUser`, `AdminUserGlobalSignOut`, `AdminUpdateUserAttributes`) — plan/validate only, not applied
- `tests/unit/test_audit_coverage_guard.py` — MODIFIED (registered the 3 new routes — AC7)
- `tests/unit/services/test_audit_service.py` — MODIFIED (extended the Access Control category-expansion test to the 3 new constants)
- `tests/integration/api/test_users.py` — MODIFIED (+~40 new tests: AC2 session-kill, deprovision/reprovision/role-change happy paths, gating, 404/502/409, audit-event assertions, guard-registry assertions)
- `tests/integration/api/test_auth_cognito.py` — MODIFIED (`cognito_provider` fixture stubs `is_user_enabled`)
- `tests/conftest.py` — MODIFIED (`_reset_dev_seed_users` also clears `_enabled_cache`)
- `docs/api-spec.json` — regenerated (additive: 3 new routes + `disabled` status)

**velara-web:**
- `src/api/users.ts` — MODIFIED (+`deprovisionUser`, `reprovisionUser`, `changeUserRole`; `UserStatus` gains `'disabled'`)
- `src/features/admin/hooks/useUsers.ts` — MODIFIED (+`useDeprovisionUser`, `useReprovisionUser`, `useChangeUserRole`)
- `src/features/admin/components/UserStatusBadge.tsx` — MODIFIED (+`disabled` branch)
- `src/features/admin/components/UserStatusBadge.test.tsx` — MODIFIED (+1 test)
- `src/features/admin/components/UsersScreen.tsx` — MODIFIED (+`DeprovisionDialog`, `DeprovisionButton`, `ReprovisionButton`, `RoleSelect`; wired into the table)
- `src/features/admin/components/UsersScreen.test.tsx` — MODIFIED (+9 tests)

**No migration. No new DB table or column.**

## Review Findings (2026-07-14)

Three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **All 7 ACs judged MET.**
**AC2 — the session kill — is genuinely implemented and genuinely tested, not faked.** `get_current_user` is the only
`validate_token` call site in the app (no bypass seam), and the headline test mints a real unexpired token, proves it
works, deprovisions, then re-sends the *same* token and asserts 401. All three Dev-Notes traps were handled.

### Patches applied during review (4)

1. **[HIGH] Blocking Cognito call stalled the event loop on every cache miss** — `app/core/dependencies.py:117`.
   `is_user_enabled` is a synchronous boto3 `AdminGetUser`, called inline from an `async def` with no
   `run_in_threadpool` — violating this module's own async-safety contract. Single-process uvicorn means every cache
   miss froze the *entire* API for a Cognito round-trip, on the auth seam of every route. The dev shim is a pure set
   lookup, so no test could ever catch it. **Fixed:** offloaded via `run_in_threadpool`. Flagged independently by all
   three layers.

2. **[HIGH] An admin could permanently lock themselves out via `PATCH /users/role`** — `app/api/v1/users.py`.
   The route had **no self-target guard** (deprovision had one). An admin could set their own role to `client`;
   their current token still says `admin` so nothing looks broken, but on next login `RejectClient` 404s them out of
   this very router — including the endpoint needed to undo it. Recovery required the AWS console. **Fixed:** extracted
   a shared `_reject_self_target` helper, now applied to *both* deprovision and role-change (409
   `SELF_ROLE_CHANGE_NOT_ALLOWED`). Same "embarrassing support ticket" the spec demanded a guard for, left open on the
   sibling route.

3. **[HIGH] Compromised accounts could not be deprovisioned from the UI** — `UsersScreen.tsx`.
   The Deprovision button was allowlisted to `active`/`invited`. But Cognito's `RESET_REQUIRED`, `COMPROMISED`, and
   `ARCHIVED` all normalize to `unknown` (`_normalize_user_status`) — so the accounts *most urgently* needing revocation
   rendered with no Deprovision button at all. Backend accepted them fine; pure FE gating omission. **Fixed:** gate on
   `status !== 'disabled'` instead of an allowlist. Regression test added.

4. **[MED] Self-target guard leaked a 500, and `Enabled` failed open** — `users.py` / `auth.py:1074`.
   `list_users()` ran outside the route's try/except, so a directory failure escaped as an opaque 500 instead of the
   502 every sibling path returns. Separately, `resp.get("Enabled", True)` defaulted a *missing* key to **enabled** — the
   fail-open direction on the one call whose entire purpose is to fail closed. **Fixed:** both.

### Deferred — needs your decision (2)

- **[MED] A role change does not kill the target's session.** AC4's *letter* (audit old→new) is met; its *intent*
  (CC6.3 covers **modification** of access) is not. A consultant demoted to `client` keeps `unrestricted=True`
  org-global access for the token's remaining **8 hours** — the exact window AC2 exists to close, left open on the
  modification path. Fix would be an `AdminUserGlobalSignOut` on role change. Deferred because it changes behavior
  beyond the AC's letter.
- **[LOW] The cache-bust comment overstates the guarantee.** `_enabled_cache` is per-process. Today this is harmless —
  uvicorn runs single-process and `api_desired_count = 1` — so the bust *is* effective and AC2 holds. But the comment
  claims deprovision is "effective immediately," which becomes **false** the moment anyone scales to 2 tasks or during
  any rolling deploy (two tasks run concurrently). The real production guarantee is the **60s TTL**. An auditor asking
  "how long is the window?" would get the wrong answer from the code. Recommend correcting the comment now, and
  revisiting a shared store (Redis is already in the stack) before scaling out.

### Dismissed
Layer claims of a platform-wide forced-logout on a Cognito blip were **overstated** — the FE 401 interceptor attempts a
silent Amplify token refresh before redirecting (`client.ts:37-47`). The cold-cache fail-closed path does still
*amplify* load onto a degraded Cognito (401 → forced refresh → re-auth), but it does not instantly log everyone out.

### Gates (re-verified independently, post-patch)
`ruff` clean · unit **728 passed** · integration **666 passed, 3 skipped** (+3 new tests) · FE typecheck 0 ·
FE **699 passed** (+1 new test) · lint: only the pre-existing `Icon.tsx` baseline warning · `api-spec.json` regenerated
via `docker cp` (the 13.1 trap avoided).

⚠️ **Environment note:** an initial integration run showed 396 failures — this was **Docker VM disk exhaustion**
(`postmaster.pid: No space left on device`), not the code. Reclaimed ~56GB and re-ran clean. The Dev Agent Record's
claimed gate results were accurate.

## Change Log

- 2026-07-14: Story implemented — user deprovisioning (disable/revoke access), re-enable, and role change, with the AC2 session-kill cached enabled-check at the auth seam. All 9 tasks complete; all ACs met. Status → review.
- 2026-07-14: Code review complete — all 7 ACs met, AC2 verified genuine. 4 patches applied (event-loop-blocking Cognito call; self-lockout guard on role change; unknown-status deprovision gating; 500→502 + fail-closed `Enabled`). 2 findings deferred for decision (role-change session kill; per-process cache comment). Status → done.
