---
baseline_commit: 38e2889dc8c7e8f66901d5e657463148eac0ecee
---

# Story 10.1: Cognito Admin User Provisioning (Backend)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief grantor (admin or ma_tech),
I want a backend route that creates a **client or consultant** login identity in Cognito with the correct `org_id`/`role` claims and triggers Cognito's built-in invitation,
so that a client OR an internal consultant can be onboarded from the platform without anyone touching the AWS Cognito console.

## Acceptance Criteria

1. **Seam extension (`AuthProvider.create_user`).** The `AuthProvider` Protocol (`app/integrations/auth.py`) gains a `create_user(email, name, org_id, role)` method (extend the seam — never bypass it). It returns the new user's identity: the Cognito `sub` / `user_id` **plus** the applied `org_id`/`role` claims (return an `AuthPrincipal`, reusing the existing contract — see Dev Notes). Callers never import a concrete provider.

2. **Cognito impl (`AUTH_BACKEND=cognito`).** `CognitoAuthProvider.create_user` calls Cognito **`AdminCreateUser`** on the configured pool, sets `custom:org_id` and `custom:role` (and the standard `name` + `email` attributes) from the **server-validated** admin input (never client-supplied), in Cognito's **default invite mode** — Cognito generates a temporary password and sends its built-in invitation email; a forced password reset is required on first login. `email_verified=true` is set so the invite email is delivered.

3. **Dev-shim impl (`AUTH_BACKEND=dev`).** `DevAuthProvider.create_user` adds the user to the in-memory seed set and returns synthesized claims with **no AWS call** — so the create→grant→login flow is exercisable in the offline test suite (which runs on `AUTH_BACKEND=dev`, cannot reach Cognito). It must appear in a subsequent `list_users(role=<created role>)` call (so 10.2's list reflects the new user, whether client or consultant) and be resolvable by `issue_token`/`validate_token` (so 10.3's create→grant→login works offline).

4. **New route `POST /api/v1/users`.** A create route is added to the existing users router (`app/api/v1/users.py`) as the mutation counterpart to the read-only `GET /api/v1/users`. It is gated to `_GRANTOR_ROLES = {admin, ma_tech}`: a `client` token gets **404** (existence-hiding via the router's existing `RejectClient`); a `consultant` token gets **403** (via the in-handler `_require_grantor(user.role)`). **Do not** add router-level `RejectNonGrantor` — it would 404 consultant (wrong code) and regress the GET contract (see Dev Notes "Route gating"). On success it returns **201** with the created user summary in the standard `ResponseEnvelope`.

5. **Provisionable-roles guard (`client` + `consultant` only).** The request body's `role` must be **`client` or `consultant`**. `admin` and `ma_tech` are **rejected** — those two privileged/grantor identities stay Cognito-console-only (least privilege; an admin/ma_tech account is never minted from a UI). Enforce in the request schema: `role: Literal["client", "consultant"]` (a bad/omitted value → Pydantic **422**). `org_id` is **not** in the body — it is set server-side to the **caller's** `user.org_id` for **both** roles (a consultant is created in the caller's internal org `org_vitalief`; a client is created in the caller's org too — new client *organizations* are set up out-of-band via the console, so cross-org client provisioning is out of scope for this route). A **duplicate email** surfaces Cognito's `UsernameExistsException` as a clean **409** (`USER_ALREADY_EXISTS`), never a 500.

6. **IAM (Terraform).** The API's ECS task role gains a `cognito-idp` statement granting `AdminCreateUser` (+ `AdminGetUser`, `AdminResendInvitation`, `AdminDisableUser`, and `ListUsers` for the pre-existing Story 8.5 read path) **scoped to the Cognito user-pool ARN** (`aws_cognito_user_pool.main.arn`) — **no wildcard**. This statement does **not** exist yet (Story 8.5's `ListUsers` was never granted in Terraform), so it is net-new.

7. **Audit.** A successful provisioning writes a best-effort admin-action audit event `admin.user_provisioned` (via `audit_service.record_admin_action`) **after** the create commits — an audit-write failure must never fail the provisioning call. `hierarchy_path="org"` (no node); `metadata` carries `provisioned_user_id`, `email`, and the provisioned `role` (so `client` vs `consultant` provisioning is distinguishable in the trail).

8. **Tests + gates.** `AUTH_BACKEND=dev` pytest suite passes with new tests covering: admin provisions a **client**→201, admin provisions a **consultant**→201, ma_tech provisions (both roles)→201, `consultant` **caller**→403, `client` **caller**→404, body `role="admin"` and `role="ma_tech"`→**422** (rejected), duplicate email→409, and that the dev-shim user (client and consultant) is listable via `list_users(role=...)` + can log in. `ruff` clean. OpenAPI spec regenerated (the new POST path appears). Terraform `validate` passes.

## Tasks / Subtasks

- [x] **Task 1 — Extend the `AuthProvider` seam (AC: 1)**
  - [x] Add `create_user(self, *, email: str, name: str, org_id: str, role: str) -> AuthPrincipal` to the `AuthProvider` Protocol in `app/integrations/auth.py` (after `list_users`). Docstring: sets `org_id`/`role` server-side; returns the new principal (incl. the generated `user_id`/`sub`).
  - [x] Do **not** add a new return dataclass — reuse `AuthPrincipal` (it already carries `user_id`, `org_id`, `role`, `name`). This keeps 10.3's handoff trivial (`created.user_id` → `create_grant`).

- [x] **Task 2 — `DevAuthProvider.create_user` (dev-shim, AC: 3)**
  - [x] Implement as a real (non-static) method OR a staticmethod that mutates the module-level `_SEED_USERS` + `_SEED_EMAILS` dicts. Synthesize `user_id = "usr_prov_<short-uuid>"` (or similar; must be a stable opaque sub). Build an `AuthPrincipal(user_id, org_id, role, name)`, insert it into `_SEED_USERS` keyed by the email (so `list_users` and the login path both see it), and record the email in `_SEED_EMAILS`.
  - [x] Ensure `list_users(role=<created role>)` returns the new user for **both** `client` and `consultant` (it already deduplicates by `user_id` and filters by role — a new entry of either role will appear).
  - [x] **State-isolation trap (see Dev Notes):** `_SEED_USERS` is a module global and there is NO conftest fixture that resets it between tests. Provide a way to reset it — either a `DevAuthProvider.reset_seed()` classmethod the tests call in a fixture, or snapshot/restore `_SEED_USERS` in a test fixture. Do NOT let a create in one test leak into another.

- [x] **Task 3 — `CognitoAuthProvider.create_user` (real path, AC: 2)**
  - [x] Mirror the boto3 client-construction pattern already in `CognitoAuthProvider.list_users` (dedicated `COGNITO_AWS_*` creds when set; else default chain / ECS task role). Call `admin_create_user(UserPoolId=..., Username=email, UserAttributes=[{name},{email},{email_verified:true},{custom:org_id},{custom:role}])` in the DEFAULT invite mode (do NOT pass `MessageAction="SUPPRESS"` — Cognito must send the invite).
  - [x] Extract the created user's `sub` from the `AdminCreateUser` response (`resp["User"]["Attributes"]` → find `sub`, or `resp["User"]["Username"]`), and return `AuthPrincipal(user_id=sub, org_id=org_id, role=role, name=name)`.
  - [x] Map `botocore` exceptions: `UsernameExistsException` → raise a new `UserAlreadyExistsError` (see Task 5) so the route can 409; other `ClientError`/`BotoCoreError` → raise `UserDirectoryError` (reuse the existing exception so the route returns 502, mirroring `list_users`). Log with `error=str(exc)`, never the raw request.

- [x] **Task 4 — Request/response schemas (AC: 4, 5)**
  - [x] Add `UserCreate` to `app/schemas/user.py`: `email: EmailStr` (validated — requires the `email-validator` package; confirm it's already a dep since 8.5/pydantic uses it, else add `pydantic[email]`), `name: str = Field(min_length=1)`, `role: Literal["client", "consultant"]` (**no default** — force the caller to state intent; `admin`/`ma_tech`/garbage → Pydantic 422). This `Literal` is the entire enforcement of AC5 — `admin`/`ma_tech` are structurally unrepresentable in the body. No `org_id` in the body — it is taken from the **caller's** `user.org_id` (server-side) for both roles, never client-supplied.
  - [x] Reuse `UserSummaryRead` as the 201 response body (it already has `user_id`/`name`/`email`/`role`).

- [x] **Task 5 — New exception + service (AC: 5, 7)**
  - [x] Add `UserAlreadyExistsError(VelaraBaseException)` with `ERROR_CODE = "USER_ALREADY_EXISTS"` in `app/integrations/auth.py` (next to `UserDirectoryError`), OR raise a `VelaraHTTPException(409, ...)` directly in the route — prefer a provider-raised domain exception the route maps, to keep boto3 details out of the route.
  - [x] Add a thin `provisioning_service.py` (or fold into the route — see Project Structure Notes) that: calls `provider.create_user(...)`, then best-effort `audit_service.record_admin_action(event_type="admin.user_provisioned", user_id=<caller>, org_id=<caller org>, hierarchy_path="org", metadata={...})` wrapped in try/except that only logs on failure. Add the `EVENT_ADMIN_USER_PROVISIONED = "admin.user_provisioned"` constant to `app/models/audit.py` (next to `EVENT_ADMIN_GRANT_CREATED`).

- [x] **Task 6 — Route handler `POST /api/v1/users` (AC: 4, 5, 7)**
  - [x] **Keep the router `dependencies=[RejectClient]` unchanged.** Do NOT flip it to `RejectNonGrantor` — that would make `consultant→404` on the existing `GET /users` and break `test_consultant_cannot_list_users`. See Dev Notes "Route gating."
  - [x] Gate the new POST for **client→404, consultant→403** exactly as the epic AC requires: `RejectClient` (router) 404s client; put `_require_grantor(user.role)` as the **first line of the POST handler** to 403 consultant. Do NOT add a route-level `RejectNonGrantor` to the POST (it would 404 consultant instead of 403).
  - [x] Handler body: `_require_grantor(user.role)` → call the provisioning service with `org_id=user.org_id` and `granted_by`/actor `= user.user_id` → return `ResponseEnvelope(data=UserSummaryRead(...), meta=_meta(request))` with `status_code=status.HTTP_201_CREATED` (import `status` from fastapi, as `access_grants.py` does).
  - [x] Map `UserAlreadyExistsError` → `VelaraHTTPException(409, "USER_ALREADY_EXISTS", ...)`; `UserDirectoryError` → 502 (as GET already does).

- [x] **Task 7 — Terraform IAM (AC: 6)**
  - [x] In `terraform/iam.tf`, add a `statement {}` block to `data.aws_iam_policy_document.ecs_task_api` (lines ~71–108): `sid = "CognitoUserAdmin"`, `effect = "Allow"`, `actions = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser", "cognito-idp:AdminResendInvitation", "cognito-idp:AdminDisableUser", "cognito-idp:ListUsers"]`, `resources = [aws_cognito_user_pool.main.arn]`. No new resource block — the existing `aws_iam_role_policy.ecs_task_api` re-serializes the document.
  - [x] Run `terraform validate` (and `fmt`). Do NOT add an IAM `description` with non-ASCII chars (em-dash) — AWS rejects it at apply (see Dev Notes gotcha).

- [x] **Task 8 — Tests + gates (AC: 8)**
  - [x] Extend `tests/integration/api/test_users.py` (reuse its `_auth_headers(role)` helper): `test_admin_provisions_client_user` (201, body shape, listable via `?role=client` after), `test_admin_provisions_consultant_user` (201, `role=consultant` in body → created in caller's org, listable via `?role=consultant`), `test_ma_tech_can_provision` (both roles), `test_consultant_caller_cannot_provision` (403), `test_client_caller_cannot_provision` (404), `test_admin_role_body_rejected` (`role="admin"`→422), `test_ma_tech_role_body_rejected` (`role="ma_tech"`→422), `test_duplicate_email_conflicts` (409 — dev-shim create twice).
  - [x] **Distinguish caller-role vs body-role in test names/assertions** — the two `consultant`s are different axes: a `consultant` *caller* is 403 (can't provision), but `consultant` is a valid *body* role (can be provisioned by an admin/ma_tech caller). Don't conflate them.
  - [x] Add a fixture that resets `_SEED_USERS`/`_SEED_EMAILS` after each provisioning test (Task 2 trap).
  - [x] Regenerate the OpenAPI spec (the repo has a spec-regen step — confirm `POST /api/v1/users` appears). Run `ruff check`. Run `AUTH_BACKEND=dev` pytest (see Dev Notes "How tests run").

### Review Findings

Code review 2026-07-03 — 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor) + per-finding empirical verification (AWS cognito-idp service model, `record_admin_action`/`get_session` source). Auditor per-AC verdict: AC1–AC7 SATISFIED, AC8 PARTIAL (consultant login test missing). `terraform validate` + `fmt` independently re-run clean.

- [x] [Review][Patch] **Invite email never sent — `AdminCreateUser` omits `DesiredDeliveryMediums=["EMAIL"]`** (default is `"SMS"`, verified in the AWS service model; no phone number on the user → the invitation the story exists to send fails/never delivers; `email_verified=true` does not govern invite delivery) [app/integrations/auth.py:537]
- [x] [Review][Patch] **Phantom IAM action `cognito-idp:AdminResendInvitation`** — no such API exists (verified against the cognito-idp service model); resend = `AdminCreateUser` + `MessageAction="RESEND"`, already granted. Remove the line (note: AC6/Task-7 text named it — spec error, not dev error) [terraform/iam.tf:459]
- [x] [Review][Patch] **Dev-shim duplicate check misses pristine seed emails + case-variant emails** — `email in _SEED_USERS` is keyed by username shortname for the 6 seed users (their emails live in `_SEED_EMAILS` values) and is case-sensitive, while the prod pool is `username_attributes=["email"]` + `case_sensitive=false` → dev 201s where Cognito 409s. Also map Cognito `AliasExistsException` → 409 alongside `UsernameExistsException` [app/integrations/auth.py:365]
- [x] [Review][Patch] **Cognito response parsing outside the try/except + silent `user_id`→email fallback** — a malformed `AdminCreateUser` response escapes as a 500 (user already created), and a missing `sub` silently makes the permanent grant key the raw email. Missing `sub` should raise `UserDirectoryError` (502) loudly [app/integrations/auth.py:560-563]
- [x] [Review][Patch] **Server-side `org_id` tenancy is untested** — no test asserts the created principal's `org_id` == caller's org, and no test proves a smuggled body `org_id` is ignored (the endpoint's central security property) [tests/integration/api/test_users.py]
- [x] [Review][Patch] **AC8 gap: provisioned-consultant login untested** — `test_provisioned_dev_user_can_log_in` covers `client` only; AC8 mandates both roles [tests/integration/api/test_users.py:620]
- [x] [Review][Patch] **`_reset_seed_users` fixture lives only in `test_users.py`, not conftest** — any other module provisioning (10.3's create→grant→login is anticipated) leaks seed state across the session; the story's own trap re-armed [tests/integration/api/test_users.py:17]
- [x] [Review][Patch] **POST 502 path untested** — no test covers `UserDirectoryError` → 502 `USER_DIRECTORY_UNAVAILABLE` on the create route (GET has one) [tests/integration/api/test_users.py]
- [x] [Review][Patch] **Schema hardening: `name` accepts whitespace-only/unbounded values; email can exceed Cognito's 128-char username cap** — bad input surfaces as a misleading 502 (`InvalidParameterException`) instead of 422; add strip + max lengths [app/schemas/user.py:309-311]
- [x] [Review][Patch] **Stale 403 message** — `_require_grantor` says "may list the user directory"; a consultant blocked from *provisioning* gets the listing message [app/api/v1/users.py:41-46]
- [x] [Review][Patch] **"Deep-copied" comment is wrong** — `dict(_SEED_USERS)` is shallow (safe today only because `AuthPrincipal` is frozen); fix the comment [app/integrations/auth.py:137-141]
- [x] [Review][Defer] **Blocking sync boto3 `AdminCreateUser` on the event loop** [app/services/provisioning_service.py:33] — deferred, pre-existing pattern (identical to 8.5 `list_users`, already in deferred-work.md from the 9.4 review); fix both paths together (`asyncio.to_thread` or async seam)
- [x] [Review][Defer] **Typo'd invite email → pre-verified stranger account with no API cleanup** [app/integrations/auth.py:544] — deferred, product-level; `email_verified=true` is AC2-mandated, and disable/delete is a 10.2 candidate (IAM already grants `AdminDisableUser`, nothing calls it)

Dismissed as noise/disproven (7): audit-write session poisoning (disproven — `record_admin_action` commits itself, `get_session` teardown never commits, session unused after); no audit of failed provisioning attempts (AC7 mandates success-only); response echoes request email (AuthPrincipal has no email field; Cognito username==email); `hierarchy_path="org"` literal (AC7-mandated; migration 0020 org_id fence handles queryability — verified); OpenAPI missing 4xx/5xx codes (repo-wide convention, zero 409s anywhere in the spec); multi-worker dev-shim divergence (single-process compose only); stale ADR grantor wording (superseded by the 2026-07-03 product decision).

## Dev Notes

### The seam is the point — extend the Protocol
Auth flows through the `AuthProvider` Protocol (`app/integrations/auth.py:109`). Today it has three methods (`issue_token`, `validate_token`, `list_users`); this story adds a **fourth**, `create_user`. **Extend the Protocol, never bypass it** — the same discipline the ADR mandates and the codebase already follows for `StorageProvider`/`SecretsProvider`. Keep `create_user`'s signature provider-neutral: takes plain `email/name/org_id/role`, returns the shared `AuthPrincipal`; Cognito's `sub` is just the opaque `user_id` string (the same opaque-`sub` model `create_grant` already assumes). Don't leak `boto3`/Cognito types into the Protocol or the route.

### Provisionable roles: `client` + `consultant` (NOT `admin`/`ma_tech`), and how future Azure AD relates
**Product decisions (Project Lead, 2026-07-03):**
- **This route provisions `client` OR `consultant` users** — both are created directly in Cognito via `AdminCreateUser`. `admin` and `ma_tech` are **NOT** provisionable here (privileged/grantor accounts stay Cognito-console-only, least privilege). `role: Literal["client", "consultant"]` (AC5) makes the other two structurally impossible in the body.
- **`org_id` = the caller's org for BOTH roles.** A `consultant` is created in the caller's internal org (`org_vitalief`). A `client` is *also* created in the caller's org — **new client organizations are set up out-of-band via the console**, so this route does not select or create a foreign client org (no `org_id` in the body; no `Organization`-registry lookup needed). Keep it simple: `org_id = user.org_id` unconditionally.
- **Both grantors provision.** `admin` and `ma_tech` callers may each provision either role (the uniform `{admin, ma_tech}` grantor gate; no per-role split on the *caller* side).

**Future Azure AD is *federation into Cognito*, not a second provider.** The planned AAD (Entra ID) work federates AAD into the existing Cognito pool as an external SAML/OIDC IdP so consultants can sign in with AAD credentials — AAD is **added to Cognito, not alongside/replacing it**. Implications:
- **Cognito stays the single token issuer.** The API keeps validating **Cognito** JWTs via `CognitoAuthProvider` (`auth.py:305`). There is **no** future `AzureAdAuthProvider` and **no** new factory branch — federated logins still yield Cognito ID tokens with the same `custom:org_id`/`custom:role` shape. **Do not** design a second-provider abstraction or "composite router"; it would be dead architecture.
- **Consultant provisioning here is an interim bridge, and that's fine.** Until AAD federation lands, an admin can natively create a consultant's Cognito login via this route (Cognito-invite + temp password). Once AAD federation ships, consultants would instead be auto-provisioned by Cognito at first federated login — at which point native consultant-provisioning may be deprecated in favor of AAD, but **this route does not need to change** (federated users simply arrive through a different door; the Cognito claim shape is identical). No code here assumes consultants are *only* ever native.
- **`admin`/`ma_tech` remain console-only** regardless of AAD — they are never minted from a UI/route.

### Return type: reuse `AuthPrincipal`
`AuthPrincipal` (`auth.py:35`) already carries `user_id`, `org_id`, `role`, `name` — exactly the "new principal's identity + applied claims" AC1 asks for. Returning it (not a new dataclass) makes 10.3's handoff a one-liner: `created = provider.create_user(...)` → `create_grant(user_id=created.user_id, ...)`.

### Cognito `AdminCreateUser` specifics (real path)
- **Client-construction pattern already exists** — copy it from `CognitoAuthProvider.list_users` (`auth.py:398–408`): use `COGNITO_AWS_ACCESS_KEY_ID`/`COGNITO_AWS_SECRET_ACCESS_KEY` when set (local dev against real AWS), else boto3's default chain (ECS task role in prod). Same `region_name=settings.COGNITO_REGION`.
- **Custom attributes are already writable in the pool** (`cognito.tf:38–56`: `custom:org_id` and `custom:role` are declared `mutable = true`), so `AdminCreateUser` can set them. Set `custom:role` to the **provisioned** role from the body (`client` or `consultant`) and `custom:org_id` to `user.org_id` (caller's org). `name` and `email` are standard attrs — always settable by the admin API; no schema block needed.
- **Cognito owns the invite** (ADR item 2 + `cognito.tf:62–64` `email_configuration = COGNITO_DEFAULT`, `mfa_configuration = OFF`): use the **default** invite mode. Do **not** pass `MessageAction="SUPPRESS"` — that would silence the invite (a Phase-2 SES-branded path, explicitly out of scope). Set `email_verified=true` so the invite is delivered. The same Cognito invite email is used for both client and consultant users (consultant-specific/AAD onboarding is a later concern — see the roles note above); do not branch the invite behavior by role in this story.
- **No new config fields.** `COGNITO_REGION`/`COGNITO_USER_POOL_ID`/`COGNITO_APP_CLIENT_ID` (`config.py:72–74`) and the `COGNITO_AWS_*` creds (`config.py:141–142`) already exist and the fail-fast validator already requires them under `AUTH_BACKEND=cognito` (`config.py:247`). Add nothing to config.

### Route gating — the exact pattern (and a real conflict to resolve)
The gold template is `access_grants.py`: router `dependencies=[RejectNonGrantor]` (404s client + consultant) **plus** in-handler `_require_grantor(user.role)` (belt-and-suspenders 403). `RejectNonGrantor`/`RejectClient`/`_GRANTOR_ROLES` all live in `app/core/dependencies.py` (`_GRANTOR_ROLES = {"admin","ma_tech"}` at `dependencies.py:117`).

**⚠️ Do this exactly (a subtle trap):** the epic AC (`epic-10...md:49`) requires **client→404, consultant→403** on `POST /api/v1/users`. The users router today is `dependencies=[RejectClient]` (`users.py:28`) so `consultant` **reaches** `GET /users` and is 403'd by `_require_grantor`; `test_consultant_cannot_list_users` asserts that consultant→403 on GET.

- **Keep the router at `RejectClient`.** `RejectClient` gives you `client→404` for free (and preserves the GET consultant→403 contract).
- **Gate the POST with the in-handler `_require_grantor(user.role)` only** → `consultant→403`. This is exactly what the epic wants.
- **Do NOT** add a route- or router-level `RejectNonGrantor`. `RejectNonGrantor` 404s consultant (existence-hiding), which contradicts the AC's 403 and would also regress the GET test if applied at the router. (This is the one place where provisioning intentionally diverges from the audit/access-grants surfaces, which DO 404 consultant — provisioning wants the 403.)

### Audit write — exact pattern
Copy the best-effort audit block from `access_service.create_grant` (`access_service.py:323–341`): write **after** the primary action, wrapped in `try/except Exception` that only `logger.warning(...)`s on failure. Signature: `audit_service.record_admin_action(session=..., event_type=EVENT_ADMIN_USER_PROVISIONED, user_id=<caller.user_id>, org_id=<caller.org_id>, hierarchy_path="org", metadata={...})` (`audit_service.py:260`). Add `EVENT_ADMIN_USER_PROVISIONED = "admin.user_provisioned"` to `app/models/audit.py` (the `admin.*` vocabulary lives at `audit.py:45–51`). `hierarchy_path="org"` is the established convention for non-hierarchy-scoped admin events (`certification_service.py:262`); org isolation is by the `org_id` column (migration 0020), not the path, so `"org"` is correct and safe.
> Note the known Epic-9 gap: `hierarchy_path="org"` admin events are currently only visible in the audit UI after the 9.1 write-path fix. That is a **pre-existing** limitation, not this story's concern — record the event correctly and move on.

### Error + envelope conventions
- Errors: `raise VelaraHTTPException(status, "CODE", "message")` (see `users.py:67`, `access_grants.py:52`). The global handler wraps it in the standard `{"error": {"code", "message"}}` envelope. Success: `ResponseEnvelope(data=..., meta=_meta(request))` with `_meta` from `users.py:33`.
- `409` code `USER_ALREADY_EXISTS` for duplicate email; a body `role` outside `{client, consultant}` (i.e. `admin`/`ma_tech`/garbage) yields a **422** automatically via the `Literal["client", "consultant"]` schema — no manual check needed.

### State-isolation trap (dev-shim tests)
`get_auth_provider()` is `@lru_cache(maxsize=1)` (`auth.py:444`) and `_SEED_USERS`/`_SEED_EMAILS` are **module-level dicts**. There is **no** conftest fixture that clears the cache or resets the seed between tests (`tests/conftest.py` has only `apply_migrations`, `celery_eager`, `client`). A `DevAuthProvider.create_user` that mutates `_SEED_USERS` will therefore **leak created users across tests** (e.g. the duplicate-email test could pollute the list-users test). Provide a reset seam (a `reset_seed()` classmethod or a snapshot/restore fixture) and use it in an `autouse` fixture within `test_users.py`. This is the single most likely source of a flaky/false-green suite for this story.

### Test auth headers — the established helper
`test_users.py` already has `_auth_headers(role)` that mints a dev token via `DevAuthProvider.seed_users()[username]` + `issue_token` for `ma_tech`/`consultant`/`client`/`admin`. Reuse it verbatim; no new fixture needed for role auth.

### How tests run
Backend integration tests run on `AUTH_BACKEND=dev` (the `config.py:66` default, sourced from `.env`) against Postgres (`velara_test`, migrated by the session-autouse `apply_migrations` fixture). There is **no Makefile target**; the canonical command (per `test_access_grants.py:3-4` docstring) is:
```
docker compose exec api pytest tests/integration/api/test_users.py
```
**⚠️ The API image BAKES source** — `docker/Dockerfile.api:14` is `COPY . .` and the `api` service in `docker-compose.yml` has **no source volume mount**. So new code is NOT live in the container: you MUST `docker compose build api` (or `up --build`) **before** `docker compose exec api pytest`, or you will test stale code and get false greens. `REQUIRE_POSTGRES=1` turns the "PG unreachable → skip" into a hard failure (CI). **Do NOT verify against the user's live `AUTH_BACKEND=cognito` container** — a prior story broke the user's live Cognito session doing exactly that; use isolated infra only.

### What must be preserved (regression guardrails)
- `GET /api/v1/users` behavior is unchanged: admin/ma_tech→200, consultant→**403**, client→404. Do not regress `test_consultant_cannot_list_users`.
- `list_users` dedup/sort/role-filter semantics (`auth.py:274–299`) — the new dev user must slot into them cleanly.
- The `AuthPrincipal` contract and `get_current_user` seam (`dependencies.py:57`) — no signature changes.
- No new migration (there is no users table — identities live in Cognito; `create_grant` stores an opaque `user_id` with no FK). Head is `0020`; add nothing.

### Project Structure Notes
- Route: **extend** `app/api/v1/users.py` (do not create a new router — the POST is the mutation counterpart of the existing GET on the same `/api/v1` prefix).
- Schema: **extend** `app/schemas/user.py` (`UserCreate` + reuse `UserSummaryRead`).
- Seam: **extend** `app/integrations/auth.py` (Protocol + both providers + new `UserAlreadyExistsError`).
- Service: a thin `app/services/provisioning_service.py` is optional — the create+audit orchestration is small enough to live in the route, but a service keeps the route thin and matches `access_service` precedent. Either is acceptable; if you add the service, mirror `access_service`'s module shape.
- IAM: `terraform/iam.tf` (`data.aws_iam_policy_document.ecs_task_api`). Pool ARN via `aws_cognito_user_pool.main.arn` (`cognito.tf:13`). No sibling infra repo — all Terraform is in `velara-api/terraform/`.
- Audit constant: `app/models/audit.py`.

### References

- [Epic 10 doc — Story 10.1 ACs + building blocks](_bmad-output/planning-artifacts/epics/epic-10-client-user-provisioning.md#Story-10.1)
- [ADR: Client User Provisioning — Cognito AdminCreateUser via the AuthProvider seam](_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Client-User-Provisioning) (lines 181–203)
- [AuthProvider seam + both providers](velara-api/app/integrations/auth.py) — Protocol at :109, DevAuthProvider :201, CognitoAuthProvider :305 (`list_users` boto3 pattern :383–432), factory :444
- [Users router (GET pattern to extend)](velara-api/app/api/v1/users.py)
- [Access grants router (gold template for POST + grantor gate)](velara-api/app/api/v1/access_grants.py)
- [Dependencies — RejectNonGrantor / RejectClient / _GRANTOR_ROLES](velara-api/app/core/dependencies.py#L117-L225)
- [access_service.create_grant — audit + internal-role reject pattern](velara-api/app/services/access_service.py#L236-L343)
- [audit_service.record_admin_action signature](velara-api/app/services/audit_service.py#L260)
- [audit event_type constants (admin.*)](velara-api/app/models/audit.py#L45-L51)
- [config.py — COGNITO_* settings + fail-fast validator](velara-api/app/core/config.py#L68-L142)
- [Terraform IAM task role](velara-api/terraform/iam.tf) (statements :71–108, role-policy :110–114); [Cognito pool + mutable custom attrs](velara-api/terraform/cognito.tf) (:13, custom attrs :38–56, email/mfa :59–64)
- [test_users.py — `_auth_headers(role)` + role-gate test pattern](velara-api/tests/integration/api/test_users.py)
- [conftest.py — no seed/cache reset fixture (the trap)](velara-api/tests/conftest.py#L107-L149)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8, 1M context) — dev-story workflow (Amelia).

### Debug Log References

- **email-validator dependency was missing.** `EmailStr` (AC5 body validation) requires the `email-validator` backend, which pydantic does not vendor and was NOT already a dep. Per Task 4's pre-authorization ("else add `pydantic[email]`"), added `email-validator==2.2.0` to `pyproject.toml` and regenerated `uv.lock` (`uv lock` → +email-validator, +dnspython). The Docker image installs from `pyproject.toml` (pip `-e ".[dev]"`), so the pin there is what the test image consumes.
- **`.test` TLD rejected by email-validator.** First test run: 6 provisioning tests 422'd because the seed convention's `@*.test` addresses are rejected by email-validator as a reserved/special-use domain (RFC 6761) even with syntax-only validation. The seed users' `.test` emails never pass through `EmailStr` (they're display-only), but the new POST body does. Fixed by using `@*.example` addresses in the provisioning test bodies. No code change — the validator behavior is correct/desired.
- **Live container is `AUTH_BACKEND=cognito`.** The running `velara-api-api-1` is the user's live Cognito session. All verification ran in one-off `docker compose run --rm --no-deps -e AUTH_BACKEND=dev` containers against `velara_test`; the live service was never reconfigured or restarted (per the Epic-9 retro lesson).
- **Image bakes source.** Rebuilt `api` (`docker compose build api`) before each pytest/ruff/spec run so no stale-code false-greens.

### Completion Notes List

- **Seam extended (AC1):** `AuthProvider.create_user(*, email, name, org_id, role) -> AuthPrincipal` added to the Protocol; both providers implement it; `AuthPrincipal` reused (no new dataclass) so 10.3's `created.user_id → create_grant` handoff is a one-liner.
- **Cognito path (AC2):** `CognitoAuthProvider.create_user` calls `admin_create_user` in default invite mode (no `MessageAction="SUPPRESS"`), sets `name`/`email`/`email_verified=true`/`custom:org_id`/`custom:role`, mirrors the `list_users` credential pattern, extracts `sub` from the response, and maps `UsernameExistsException`→`UserAlreadyExistsError` (409) / other boto3 errors→`UserDirectoryError` (502). Matched on the modeled error code string so it doesn't depend on the botocore exception class being importable.
- **Dev shim (AC3):** `DevAuthProvider.create_user` mutates `_SEED_USERS`/`_SEED_EMAILS` (keyed by email), synthesizes `usr_prov_<12hex>` sub, is listable via `list_users(role=...)` for both roles, and is login-resolvable (`test_provisioned_dev_user_can_log_in`). Added `reset_seed()` classmethod restoring from import-time `_SEED_USERS_PRISTINE`/`_SEED_EMAILS_PRISTINE` snapshots; `test_users.py` autouse fixture calls it after each test (state-isolation trap closed).
- **Route + gating (AC4/AC5):** `POST /api/v1/users` added to the existing users router. Router kept at `RejectClient` (client→404, GET consultant→403 contract preserved); in-handler `_require_grantor` first line 403s consultant caller. `role: Literal["client","consultant"]` in `UserCreate` makes admin/ma_tech→422 structurally; `org_id = user.org_id` server-side for both roles (no `org_id` in body); duplicate→409. 201 `ResponseEnvelope[UserSummaryRead]`.
- **Service + audit (AC5/AC7):** thin `provisioning_service.provision_user` calls the seam then best-effort `record_admin_action(EVENT_ADMIN_USER_PROVISIONED, hierarchy_path="org", metadata={provisioned_user_id,email,role})` in try/except after the create — audit failure never fails provisioning. `EVENT_ADMIN_USER_PROVISIONED = "admin.user_provisioned"` added to `app/models/audit.py`.
- **IAM (AC6):** net-new `CognitoUserAdmin` statement on `data.aws_iam_policy_document.ecs_task_api` — `AdminCreateUser`+`AdminGetUser`+`AdminResendInvitation`+`AdminDisableUser`+`ListUsers`, `resources=[aws_cognito_user_pool.main.arn]` (no wildcard, no `description`). `terraform validate` + `fmt -check` pass.
- **Gates (AC8):** `AUTH_BACKEND=dev` pytest — `test_users.py` 16/16, full suite **1032 passed** (3 pre-existing `test_ingest` MinIO-connectivity failures, unrelated — known infra tax). `ruff==0.6.9` clean on `app/`+`tests/`. OpenAPI spec regenerated → `POST /api/v1/users` + `UserCreate` schema present (`role` enum `[client,consultant]`, `email` format, no `org_id`).
- **No migration:** identities live in Cognito; head stays `0020` (nothing added), per AC/Dev Notes.

### File List

**velara-api/** (code lives in the nested repo; baseline_commit `38e2889` is its HEAD)

- `app/integrations/auth.py` (modified) — `create_user` on Protocol + both providers; `UserAlreadyExistsError`; `DevAuthProvider.reset_seed()` + pristine seed snapshots.
- `app/schemas/user.py` (modified) — `UserCreate` (EmailStr / name / role Literal).
- `app/api/v1/users.py` (modified) — `POST /api/v1/users` handler + imports.
- `app/services/provisioning_service.py` (new) — `provision_user` orchestration + best-effort audit.
- `app/models/audit.py` (modified) — `EVENT_ADMIN_USER_PROVISIONED` constant.
- `terraform/iam.tf` (modified) — `CognitoUserAdmin` IAM statement.
- `tests/integration/api/test_users.py` (modified) — 10 new provisioning tests + autouse seed-reset fixture.
- `pyproject.toml` (modified) — added `email-validator==2.2.0`.
- `uv.lock` (modified) — regenerated (+email-validator, +dnspython).
- `docs/api-spec.json` (modified) — regenerated OpenAPI spec (POST /api/v1/users + UserCreate).

## Change Log

| Date | Version | Description |
|------|---------|-------------|
| 2026-07-03 | 0.1.0 | Story 10.1 implemented: `AuthProvider.create_user` seam (Protocol + Dev/Cognito) + `POST /api/v1/users` (grantor-gated, client→404/consultant→403, role Literal[client,consultant], dup→409) + best-effort `admin.user_provisioned` audit + net-new Cognito IAM statement. Added `email-validator` dep. 10 new tests; full suite green (1032 passed, 3 pre-existing unrelated). Status → review. |
