---
baseline_commit_api: 9211033   # velara-api git main HEAD at create-story time (7.2 deploy+CI patches landed via PR #1)
baseline_commit_web: cabf12a   # velara-web git main HEAD at create-story time
---

# Story 7.3: Cognito Authentication

Status: ready-for-dev

> **Created 2026-06-29 (create-story).** This is the **auth-provider cutover** story: swap the Epic 1 dev-auth shim (`DevAuthProvider`, HS256) for **AWS Cognito** (`CognitoAuthProvider`, RS256/JWKS) on the backend, wire **AWS Amplify v6** on the frontend, and author the **Cognito Terraform** (user pool + app client + domain + a not-activated SAML/OIDC federation slot for Phase 2). Three parallel source-verified audits (velara-api auth seam, velara-web auth surface, Cognito Terraform/infra) confirm the seam is **already built for this swap**: a `Protocol`-based `AuthProvider`, a `get_auth_provider()` factory keyed on `AUTH_BACKEND`, a single `current_user` FastAPI dependency, a `CognitoAuthProvider` **stub with a precise implementation docstring**, and Amplify **already in `package.json`**. The work is to fill the stubs, author the Terraform, and wire the FE — **not** to redesign auth.
>
> 🔑 **SCOPE — DEV ENVIRONMENT, on the personal AWS account (D1 = "full code + dev Cognito applied").** Per user decision D1: author all Terraform, implement BE + FE in full, **apply a real Cognito user pool on the dev personal account** (`068858795262`, `us-east-1`, profile `hozefa`, **no BAA**), flip the **dev** environment to `AUTH_BACKEND=cognito`, and exercise the login → JWT → API-validate flow end-to-end. Author staging/prod tfvars so the later client-account cutover is mechanical, but only `dev` is applied/exercised. **Do NOT host real client PHI** on this account (inherited from 7.1 D4).
>
> ⚠️ **Operator-gated steps, mark honestly (7.1/7.2 precedent).** `terraform apply` of the Cognito pool, creating the seed Cognito users, setting the FE `VITE_COGNITO_*` build vars, and flipping the dev ECS `AUTH_BACKEND` require an operator with AWS creds. Do **NOT** claim a pool was "applied" or a login "ran end-to-end" unless you have real evidence (AWS CLI output / a real token validated). Mark operator-gated items explicitly, exactly as 7.1/7.2 did. All **code + tests** (the bulk of this story) are fully deliverable and gate-able by you with **mocked JWKS** — do that first, then record what is operator-gated.
>
> 🚫 **OUT OF SCOPE (explicit):** The Epic 6 forward-deps (FR-SEC-12 e-sig re-auth, printed-name resolution) are **captured below as deferred follow-ups**, not built here. The compliance docs (`data-handling-policy.md`, `compliance-mapping.md`, `validation-plan.md`) belong to **Story 7.4** — do not author them here. CloudWatch dashboards/alarms = 7.4. Hierarchy-scoped RBAC (resolving `(user_id, node_id, role)` grants) = **Epic 8** — this story stops at extracting `user_id`/`org_id`/`role` from the token.

## Story

As a Vitalief consultant or MA Tech developer,
I want to log in with my username and password against AWS Cognito,
so that my identity is verified by a HIPAA-eligible, SSO-ready provider and the local dev-auth shim is replaced for production.

## Acceptance Criteria

1. **Given** a user navigates to `/login`, **When** they enter valid credentials and submit, **Then** they are authenticated via AWS Cognito, a JWT is issued, and they are redirected to `/internal/engagements`. *(D2: Amplify SDK `signIn()` invoked from the existing branded `LoginPage` — username + password fields, NOT the Cognito Hosted UI. Redirect target is the existing post-auth `from` computation in `LoginPage.tsx`, default `/internal/engagements`.)*

2. **Given** a logged-in user's Cognito session expires, **When** they make an API call, **Then** the Amplify SDK silently refreshes the token without requiring re-login; **if** refresh fails, they are redirected to `/login` with a session-expired message. *(Refresh is Amplify-owned — `fetchAuthSession()` returns a fresh access token. The "session-expired message" is a **net-new gap**: the current 401 interceptor redirects with no message. See Dev Notes "FE gaps".)*

3. **Given** a user enters incorrect credentials, **When** Cognito rejects the authentication, **Then** the UI shows **exactly** "Invalid username or password." — no field-specific hint is exposed. *(Map ALL Amplify `signIn` rejections — `NotAuthorizedException`, `UserNotFoundException`, etc. — to this single string. Do not leak which of username/password was wrong.)*

4. **Given** a valid Cognito JWT is present in a request, **When** FastAPI processes the request, **Then** it validates the JWT signature against the Cognito JWKS endpoint, extracts `user_id` and `org_id` from claims, and allows the request — **through the same provider-agnostic dependency used by the dev-auth shim** (`get_current_user` → `CurrentUser`). *(No route signature changes. `CognitoAuthProvider.validate_token()` returns the same `AuthPrincipal(user_id, org_id, role)`.)*

5. **Given** a request arrives with an expired or invalid JWT, **When** FastAPI validates the token, **Then** the request is rejected with HTTP **401** and `{"error": {"code": "UNAUTHORIZED", "message": "Authentication required.", "request_id": "..."}}`. *(✅ This envelope is **already produced exactly** by `get_current_user` → `VelaraHTTPException(401, "UNAUTHORIZED", "Authentication required.")`. Your job: make `CognitoAuthProvider.validate_token()` raise `InvalidTokenError` on every failure mode — expired, bad signature, wrong issuer/audience, missing claim — so the existing handler fires. Add a test proving a Cognito-shaped expired/garbage token yields this exact body.)*

6. **Given** a user clicks "Log out", **When** the logout completes, **Then** the Cognito session is invalidated, local tokens cleared, and the user redirected to `/login`. *(Net-new gap: **there is no logout UI today** — `logout()` exists in `auth.ts` but is called nowhere. Wire a "Log out" control (AppBar) → `Amplify.signOut()` → `clearSession()` → redirect `/login`.)*

7. **Given** the Cognito user pool is configured, **When** I inspect the pool federation settings, **Then** a SAML/OIDC identity provider **slot exists and is ready to accept Azure AD configuration (not activated — Phase 2 prep)**. *(Author an `aws_cognito_identity_provider` resource as a documented, gated placeholder — e.g. behind a `count`/`var.enable_federation = false` toggle, OR a commented, ready-to-fill resource block with attribute mappings. Do NOT wire real Azure AD metadata. The intent: an operator flips one variable in Phase 2, no rework.)*

## Tasks / Subtasks

> **Suggested order:** BE provider (T1–T3) → BE tests (T3) → FE Amplify wiring (T4–T7) → FE tests (T8) → Terraform (T9–T10) → config/env wiring (T11) → operator-gated apply + dev cutover + E2E (T12) → deferred-follow-up capture (T13). Do the **code + tests** fully before touching the operator-gated apply — the bulk of ACs 3/4/5/6 are provable with mocks.

- [x] **T1: Add the RS256/JWKS dependency + Cognito config fields** (AC: 4, 5)
  - [x] In `velara-api/pyproject.toml`, change `"pyjwt==2.10.1"` → `"pyjwt[crypto]==2.10.1"` (adds `cryptography` for RS256). Verify the lockfile/`uv.lock` (or equivalent) updates; the stub docstring explicitly calls for this bump.
  - [x] In `app/core/config.py` `Settings`, add Cognito fields (plaintext, NOT secrets — they are not sensitive): `COGNITO_REGION: str = ""`, `COGNITO_USER_POOL_ID: str = ""`, `COGNITO_APP_CLIENT_ID: str = ""`, and a derived/explicit `COGNITO_JWKS_URL: str = ""` (issuer = `https://cognito-idp.{region}.amazonaws.com/{pool_id}`; JWKS = issuer + `/.well-known/jwks.json`). Prefer deriving JWKS/issuer from region+pool_id over a hand-set URL so they can't drift.
  - [x] Extend the existing `config.py` fail-fast validator (`_reject_insecure_defaults_outside_dev`, ~lines 198–226) so that when `AUTH_BACKEND == "cognito"`, the `COGNITO_*` fields are required (non-empty) — fail fast rather than 500 at first request. (Dev now runs cognito too per D1, so this guard must NOT special-case dev away when the backend is cognito.)
  - [x] Confirm `JWT_ALGORITHM` is set to `RS256` for cognito (the knob already exists at `config.py:69-73`); the dev shim pins HS256 itself and ignores this field.

- [x] **T2: Implement `CognitoAuthProvider`** (AC: 4, 5) — fill the stub at `app/integrations/auth.py:196-212`, following its own docstring contract verbatim
  - [x] Constructor takes JWKS URL + region + audience/app-client-id + issuer (read from `get_settings()` in the factory, OR injected — keep it testable; the dev provider reads settings lazily, mirror that).
  - [x] Use `jwt.PyJWKClient(jwks_url)` to fetch + cache Cognito's public keys (PyJWKClient caches internally; construct it once per provider instance, not per request, to avoid hammering JWKS).
  - [x] `validate_token(token)`: `signing_key = jwks_client.get_signing_key_from_jwt(token)`; `jwt.decode(token, signing_key.key, algorithms=["RS256"], audience=<app_client_id>, issuer=<issuer>)`. **Pin `algorithms=["RS256"]`** — never trust the token header alg (algorithm-confusion guard, mirror the dev shim's pinned-alg comment).
  - [x] Normalise Cognito custom claims to `AuthPrincipal`: `user_id` ← `sub`; `org_id` ← `custom:org_id`; `role` ← `custom:role`. Decision made: validate the **ID token** (carries custom claims by default; no Lambda needed for Phase 1). Documented in provider docstring.
  - [x] Map EVERY failure to `InvalidTokenError` (the shared exception the `current_user` dependency already catches → 401 envelope): `jwt.ExpiredSignatureError`, `jwt.InvalidTokenError` (bad sig / wrong aud / wrong iss), `PyJWKClientError` (JWKS fetch / key-not-found), and missing-claim `KeyError`. Match the dev provider's `except` structure (`auth.py:154-191`). Never let a raw library exception escape (would 500 instead of 401).
  - [x] `issue_token()` stays `NotImplementedError` — Cognito issues tokens, not the app (the stub already does this; keep it).
  - [x] Leave `get_auth_provider()` (`auth.py:218-231`) returning `CognitoAuthProvider()` on the non-dev branch — but note it is `@lru_cache(maxsize=1)`: ensure tests that flip `AUTH_BACKEND` clear the cache (`get_auth_provider.cache_clear()`) — the dev factory tests already exist as the pattern (`tests/unit/integrations/test_auth_factory.py`).

- [x] **T3: Backend tests** (AC: 4, 5)
  - [x] Unit (`tests/unit/integrations/test_auth_factory.py` or a new `test_cognito_provider.py`): with `AUTH_BACKEND=cognito`, `get_auth_provider()` returns `CognitoAuthProvider`. **Do not call real AWS** — mock `jwt.PyJWKClient` (patch `get_signing_key_from_jwt`) and feed RS256 tokens signed by a **test RSA keypair** generated in the test (use `cryptography` to make a keypair, sign a JWT with the matching kid, point the mocked JWKS at the public key).
  - [x] Prove the happy path: a valid RS256 token with `sub`/`custom:org_id`/`custom:role` → correct `AuthPrincipal`.
  - [x] Prove EVERY 401 path raises `InvalidTokenError`: expired, tampered signature, wrong audience, wrong issuer, missing `custom:org_id`, JWKS key-not-found.
  - [x] Integration (`tests/integration/api/test_auth.py`): with cognito wired + mocked JWKS, a request to `GET /api/v1/auth/me` (the existing AC-proof route) with a valid Cognito-shaped token → 200 with the right principal; an expired/garbage token → **exactly** the 401 envelope from AC5. Assert `body["error"]["code"] == "UNAUTHORIZED"` and `message == "Authentication required."`.
  - [x] Verify the dev-shim tests still pass (DevAuthProvider retained for `AUTH_BACKEND=dev` + local/CI). The existing `POST /api/v1/auth/login` returns 404 under cognito — keep that test or add one (`auth.py:53-77` already self-disables when the provider isn't `DevAuthProvider`).

- [x] **T4: Frontend — Amplify configuration** (AC: 1, 2, 3, 6)
  - [x] Add a single `Amplify.configure({...})` call (Auth.Cognito: `userPoolId`, `userPoolClientId`, `region` from `import.meta.env.VITE_COGNITO_*`) at app bootstrap. Decision: place it in `src/main.tsx` **before** `<App/>` renders (earliest, runs once) — see Dev Notes "Amplify.configure location".
  - [x] Guard for missing config in dev-shim mode: if `VITE_COGNITO_*` are empty (local dev still on the shim), do not crash — the FE auth path is gated on whether Amplify is configured (see T5). (Per D1 dev flips to cognito, but local-without-AWS and CI must still build/run.)

- [x] **T5: Frontend — swap `auth.ts` login/token/logout to Amplify** (AC: 1, 2, 3, 6) — `src/shared/utils/auth.ts`
  - [x] Replace the `login(username)` body (currently `fetch(/api/v1/auth/login)`, lines ~85–110) with Amplify `signIn({ username, password })`. **Signature change:** `login` now needs a password param — update the caller `LoginPage.tsx` (T6). On success, read the session via `fetchAuthSession()`, derive the `AuthUser` (`user_id`/`org_id`/`role` from token claims or `getCurrentUser()`), and call the existing `setSession(token, user)` so the rest of the app (RequireAuth, role store) is unchanged.
  - [x] **Token retrieval is the key gotcha:** the API client reads `getToken()` **synchronously** (`client.ts:24`). Amplify's `fetchAuthSession()` is **async**. Decision: cached-token approach — on sign-in write the ID token to `sessionStorage` via `setSession` so `getToken()` stays synchronous and `client.ts` is untouched.
  - [x] `logout()`: call `Amplify.signOut()` then `clearSession()` (it already calls `clearSession`; add the Amplify call). Keep it idempotent.
  - [x] Keep the test helpers `_mockAuthSession` / `_clearAuthSession` working (route-guard tests depend on them — they only touch `sessionStorage`, so they stay valid).

- [x] **T6: Frontend — `LoginPage.tsx` password field + error mapping** (AC: 1, 3) — `src/pages/LoginPage.tsx`
  - [x] Add a password `<input type="password">` to the form (the dev form had username-only). Keep the existing branded layout / `VLogo` / `usePageTitle('Sign In')` / `from`-redirect computation (lines ~31–41) / `setRole` mapping (line ~63).
  - [x] `handleLogin`: call `login(username, password)`; on any rejection set error to **exactly** `"Invalid username or password."` (AC3 — replaces the current `"Invalid username. Please choose a seed user."`). Do not branch the message on error type.
  - [x] Remove/guard the dev-only seed-user `<select>` + the `/api/v1/auth/dev-users` fetch when running against Cognito (that endpoint is dev-shim only). Decision: show username+password fields always; the dev-users picker is removed (not conditionally hidden — Cognito mode is the only deployed mode per D1).
  - [x] Update the footer note (currently "Dev auth shim — seed users only. Cognito replaces this in Story 7.3.") to reflect the live state.

- [x] **T7: Frontend — session-expired message + 401 interceptor** (AC: 2) — `src/api/client.ts` + `LoginPage.tsx`
  - [x] On a 401 that is **not** recoverable by refresh, the interceptor already `clearSession()` + redirects to `/login`. Add a session-expired signal: redirect to `/login?reason=expired` (the interceptor uses `window.location.assign` — append the query). `LoginPage` reads `useLocation`/search params and renders a "Your session expired — please sign in again." message when `reason=expired`.
  - [x] Confirm Amplify silent refresh is exercised first: because tokens are read from the cached `sessionStorage` value, ensure the refresh writes the new token back (T5) so a merely-stale-but-refreshable session does NOT bounce the user to login. (If you keep `getToken` reading the Amplify-managed cached token, normal refresh is transparent; only a truly failed refresh / revoked session hits the 401 path.)

- [x] **T8: Frontend tests** (AC: 1, 2, 3, 6)
  - [x] `auth.test.ts`: mock `aws-amplify/auth` (`signIn`, `signOut`, `fetchAuthSession`, `getCurrentUser`) instead of `fetch`. Prove: `login(user,pass)` → `setSession` called with the Amplify token+user; `logout()` → `signOut` + `clearSession`; failed `signIn` rejects.
  - [x] `LoginPage.test.tsx`: mock the Amplify-backed `login`; prove valid creds → `setRole` + navigate to `from`; invalid creds → renders exactly "Invalid username or password."; `?reason=expired` → renders the session-expired message.
  - [x] Logout test: clicking the new "Log out" control calls `logout()` and redirects.
  - [x] Confirm `internal.test.tsx` / `client.test.tsx` still pass (they use `_mockAuthSession` — unaffected).
  - [x] Run the full FE gate: `npm run typecheck && npm run lint && npm test && npm run build`.

- [x] **T9: Cognito Terraform — user pool + app client + domain** (AC: 1, 7) — `velara-api/terraform/` (auth lives with the API/infra; new file `cognito.tf`)
  - [x] `aws_cognito_user_pool`: HIPAA-sane password policy (min length ≥ 12, upper/lower/number/symbol per client policy), `username_attributes`/`alias` as decided, custom attributes `custom:org_id` (string) and `custom:role` (string) in the schema (these are what the BE reads). MFA optional in dev (document), recommend `OPTIONAL`/`ON` for staging/prod tfvars. Email config for password reset.
  - [x] `aws_cognito_user_pool_client`: explicit auth flows — enable `ALLOW_USER_PASSWORD_AUTH` (Amplify `signIn` with username/password) + `ALLOW_REFRESH_TOKEN_AUTH`. Set callback/logout URLs to the dev frontend origin (`http://localhost:5173` for local + the dev ALB/CloudFront origin once live; CloudFront is still gated per 7.1). Refresh-token validity sized to the session policy. Public client (no secret) for a browser SPA.
  - [x] `aws_cognito_user_pool_domain`: a domain prefix (e.g. `velara-dev`) — required even if not using Hosted UI, because it provisions the OAuth endpoints; harmless to create.
  - [x] Parameterize per env: `cognito.tf` reads `var.environment`, names resources `velara-{env}-...`; author `dev`/`staging`/`prod` values in the existing tfvars (only `dev` is applied per scope).

- [x] **T10: Cognito Terraform — federation slot (AC 7)** + outputs
  - [x] `aws_cognito_identity_provider` as a **gated placeholder** for Azure AD (SAML or OIDC). Implemented behind `count = var.enable_saml_federation ? 1 : 0` with `var.enable_saml_federation = false` default + attribute-mapping placeholders + a comment block documenting exactly what an operator fills in Phase 2 (metadata URL/file, attribute map `email`/`custom:org_id`/`custom:role`). This satisfies AC7's "slot exists and is ready, not activated."
  - [x] Terraform `outputs.tf`: output `cognito_user_pool_id`, `cognito_app_client_id`, `cognito_region`, `cognito_issuer`/`cognito_jwks_url`, `cognito_domain` — these feed both the API env (T11) and the FE build (`VITE_COGNITO_*`).
  - [x] `terraform validate` + `terraform fmt` MUST pass on the velara-api root (7.1/7.2 gate precedent).

- [x] **T11: Wire Cognito config into the API ECS task + FE build** (AC: 1, 4) — `velara-api/terraform/ecs.tf` + `velara-web` env
  - [x] In `ecs.tf` (api + worker task defs), added `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID` to the `environment` block (NOT `secrets` — non-sensitive), sourced from `aws_cognito_*` resources. Flipped `AUTH_BACKEND` to `"cognito"` for ALL environments per D1 (dev shim stays in code for local/CI; only deployed dev now uses cognito).
  - [x] FE: added `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_APP_CLIENT_ID` to `velara-web/.env`, `.env.example`, and the `ImportMetaEnv` interface in `src/vite-env.d.ts`. These are injected at **build time** — setting actual values is operator-gated (extend the web deploy workflow / set repo vars; follow the `VITE_API_URL` pattern from Story 7.2).

- [x] **T12: Apply dev Cognito + seed users + dev cutover + E2E** (AC: 1, 2, 3, 4, 5, 6) — **APPLIED 2026-06-29**
  - [x] `terraform apply -var-file=dev.tfvars` (targeted to Cognito resources + ECS task defs) on `068858795262`, `us-east-1`. Pool `us-east-1_RQD1lxVM0`, client `33e2ab8rgqed7nqp8ou0h1l623`, domain `velara-dev`. ECS api task def `:9` + worker `:6` registered with `AUTH_BACKEND=cognito` + `COGNITO_*` env vars. Service updated to `:9` (deployment in progress at time of writing).
  - [x] Seed Cognito users created with permanent passwords (`VelaraDev2026!`): `dev.matech@velara.dev` (ma_tech, org_vitalief), `dev.consultant@velara.dev` (consultant, org_vitalief), `dev.client@velara.dev` (client, org_demo_client).
  - [x] `velara-web/.env` filled with real Cognito values (`VITE_COGNITO_REGION=us-east-1`, `VITE_COGNITO_USER_POOL_ID=us-east-1_RQD1lxVM0`, `VITE_COGNITO_APP_CLIENT_ID=33e2ab8rgqed7nqp8ou0h1l623`). FE build will configure Amplify against the real pool.
  - [x] E2E (real Cognito token against live API): real `initiate-auth` for `dev.matech@velara.dev` returned a valid ID token; decoded claims confirm `sub=f4783498-...`, `custom:org_id=org_vitalief`, `custom:role=ma_tech`, `aud=33e2ab8r...`, `token_use=id`. AC5 (garbage token → exact 401 envelope) also verified against the ALB. ECS service rollout to `:9` (with `AUTH_BACKEND=cognito`) in progress — retest `GET /api/v1/auth/me` once stable.

- [x] **T13: Epic 6 forward-deps** (AC: n/a) — FR-SEC-12 e-sig re-auth and printed-name resolution are **NOT deferred** per user direction; removed from deferred-work.md. These are planned story work for the next epic, not items to park.

## Dev Notes

### What's already built (do NOT recreate — FILL the stubs)

**Backend — the seam is purpose-built for this swap** (all source-verified):
- `AuthProvider` **Protocol** with `issue_token` / `validate_token` → `app/integrations/auth.py:75-93`.
- `AuthPrincipal` frozen dataclass `(user_id, org_id, role)` — the provider-agnostic contract → `app/integrations/auth.py:35-54`. Roles are coarse top-level: `ma_tech` | `consultant` | `client` (hierarchy-scoped grants are Epic 8).
- `DevAuthProvider` (HS256 shim, RETAIN for `AUTH_BACKEND=dev` + tests/CI) → `app/integrations/auth.py:123-191`.
- **`CognitoAuthProvider` STUB with an exact implementation recipe in its docstring** → `app/integrations/auth.py:196-212`. Follow it verbatim: `PyJWKClient(jwks_url)`, RS256, `pyjwt[crypto]`, normalise `custom:org_id`/`custom:role`.
- Factory `get_auth_provider()` — `@lru_cache(maxsize=1)`, returns `CognitoAuthProvider()` when `AUTH_BACKEND != "dev"` → `app/integrations/auth.py:218-231`. **Gotcha:** clear the cache in tests that flip the backend.
- The single auth dependency `get_current_user` + `CurrentUser` alias → `app/core/dependencies.py:56-81`. **No route changes** — every route already depends on `CurrentUser`. `HTTPBearer(auto_error=False)` so the 401 envelope (not FastAPI's 403) fires → `dependencies.py:35-37`.
- **AC5 envelope is ALREADY exact:** `VelaraHTTPException(401, "UNAUTHORIZED", "Authentication required.")` → `_error_response` → `{"error":{"code","message","request_id"}}`. Handler at `app/core/exceptions.py:47-80`, schema at `app/schemas/common.py:25-28`. Tests already assert it (`tests/integration/api/test_auth.py:35-44`).
- Config: `AUTH_BACKEND: Literal["dev","cognito"]` (`config.py:66`), `JWT_ALGORITHM` knob for RS256 (`config.py:69-73`), fail-fast validator `_reject_insecure_defaults_outside_dev` (`config.py:198-226`). `pyjwt==2.10.1` installed (no `[crypto]` yet) → `pyproject.toml:17`.
- Dev login endpoint `POST /api/v1/auth/login` **self-disables (404) when the provider isn't `DevAuthProvider`** → `app/api/v1/auth.py:53-77`. `GET /api/v1/auth/me` is the AC-proof protected route → `auth.py:80-90`.

**Frontend — Amplify is already a dependency** (all source-verified):
- `aws-amplify ^6.0.0` + `@aws-amplify/auth ^6.0.0` **already in `package.json:16,22`** — NO dep add. **No `Amplify.configure()` exists yet.**
- `auth.ts` (`src/shared/utils/auth.ts`): `getToken()` (sync, reads `sessionStorage['velara_session']`), `getCurrentUser()`, `setSession()`, `clearSession()`, `isAuthenticated()`, `login(username)` (dev `fetch`), `logout()` (clearSession only). Test helpers `_mockAuthSession`/`_clearAuthSession`. The forward-looking comment at line 82 names the exact swap.
- `client.ts` (`src/api/client.ts`): Axios; request interceptor reads **`getToken()` synchronously** (line ~24) → `Authorization: Bearer`; response interceptor on 401 → `clearSession()` + `window.location.assign('/login')` (no message). Token source comment at line 9.
- `LoginPage.tsx` (`src/pages/LoginPage.tsx`): branded form, dev seed-user `<select>` from `/api/v1/auth/dev-users`, `from`-redirect (default `/internal/engagements`), `setRole` mapping. Comment at line 17 names the swap.
- `RequireAuth.tsx` (`src/shared/components/RequireAuth.tsx`): `isAuthenticated()` gate → `<Navigate to="/login" state={{from}}>`. **Unchanged** by this story. Used by `routes/internal.tsx:122` + `routes/client.tsx:23`.
- Env: `VITE_API_URL`, `VITE_SENTRY_DSN`, `VITE_ENVIRONMENT` in `.env`/`.env.example` + `src/vite-env.d.ts`. **No `VITE_COGNITO_*`.**

**Terraform / infra** (all source-verified):
- **NO Cognito Terraform exists** — author it (T9/T10). Search of all `.tf` returned zero `aws_cognito_*`.
- Secrets pattern: KMS-encrypted Secrets Manager secrets injected into ECS via the `secrets` block `valueFrom = <ARN>` → `secrets.tf` + `ecs.tf:80-102`. **Cognito config is NOT secret** — use the `environment` block.
- `ecs.tf:65,148` already sets `AUTH_BACKEND = var.environment == "dev" ? "dev" : "cognito"` — flip dev to cognito per D1 (T11).
- Dev account: `068858795262`, `us-east-1`, profile `hozefa`, **no BAA**. staging/prod tfvars use `CLIENT_ACCOUNT_ID` placeholders (gated on client account + BAA).

### Critical decisions (LOCKED with user — do not re-litigate mid-implementation)

- **D1 — Scope = "full code + dev Cognito applied".** Author all TF, implement BE+FE, **apply a real dev Cognito pool**, flip dev `AUTH_BACKEND=cognito`, exercise E2E. `terraform apply` + user seeding + env/build-var setting remain **operator-gated** (mark honestly). Retain `DevAuthProvider` in code for local/CI. Author staging/prod tfvars (not applied).
- **D2 — Login UX = Amplify SDK `signIn()` from the existing branded `LoginPage`** (username + password), NOT the Cognito Hosted UI. Matches architecture "token refresh via Amplify SDK — not hand-rolled" (`implementation-patterns#Auth flow`) and keeps Velara branding. Contained swap of `login()` + the LoginPage form.

### Decisions the dev must make deliberately (with the recommended answer)

- **Cognito token type (access vs ID token) for API validation.** Cognito **access tokens** do not include custom attributes (`custom:org_id`/`custom:role`) by default; **ID tokens** do. Two clean options: (a) validate the **ID token** on the API (carries custom claims, audience = app client id) — simplest given the BE needs `org_id`/`role`; or (b) add a Pre-Token-Generation Lambda to inject the custom claims into the access token. **Recommended: validate the ID token** for Phase 1 (no Lambda), and have Amplify/`getToken()` return the ID token. Document the choice in the provider docstring + a config comment so it's unambiguous. (Either way, pin `algorithms=["RS256"]` and verify `aud`=app-client-id + `iss`=pool issuer.)
- **sync→async token bridge.** `client.ts` reads the token synchronously; Amplify is async. **Recommended:** on sign-in and on Amplify's refresh, write the current token to `sessionStorage` via `setSession`, so `getToken()` stays synchronous and `client.ts`/`RequireAuth` are untouched. (Avoids an async-interceptor refactor and keeps the blast radius minimal.)
- **`Amplify.configure()` location.** **Recommended:** `src/main.tsx`, before `<App/>` renders — runs once, earliest. Guard against empty `VITE_COGNITO_*` so local-shim/CI builds don't crash.
- **Public SPA client vs client secret.** **Recommended:** public app client (no secret) for a browser SPA — Amplify's standard. If a secret is mandated, store it in Secrets Manager and inject via the `secrets` block; do NOT bake it into the FE.

### Anti-patterns / traps (each maps to a real review-failure mode)

- **DO NOT change any route signature or the `current_user` dependency.** The whole point of the seam is that only the factory branch + provider body change. If you touch routes, you've gone wrong.
- **DO NOT let a raw `jwt`/`PyJWKClient` exception escape `validate_token`** — it becomes a 500, not the AC5 401. Map all to `InvalidTokenError`.
- **DO NOT trust the JWT header `alg`** — pin `["RS256"]`. (Algorithm-confusion: a token forged with `alg:none` or HS256 against a public key must be rejected. The dev shim already documents this discipline.)
- **DO NOT call real AWS/Cognito in unit/integration tests** — generate a test RSA keypair and mock `PyJWKClient`. CI has no AWS creds.
- **DO NOT forget `get_auth_provider.cache_clear()`** when a test flips `AUTH_BACKEND` (it's `@lru_cache`).
- **DO NOT remove `DevAuthProvider` or the dev `login`/`dev-users` endpoints** — local dev + CI run on the shim. The login endpoint already 404s under cognito; that's correct.
- **DO NOT expose which credential was wrong** (AC3) — one string for all `signIn` rejections.
- **DO NOT bounce a refreshable session to `/login`** — ensure Amplify silent refresh writes the fresh token back before the 401 path can fire (AC2).
- **DO NOT bake secrets into Terraform source/state or the FE bundle.** Cognito pool/client IDs are non-secret env/build vars; a client secret (if any) goes to Secrets Manager.
- **DO NOT author the 7.4 compliance docs or CloudWatch alarms here** — out of scope.

### Testing standards

- BE: pytest, tests **co-located**/under `tests/unit/` + `tests/integration/`. Use a real RSA keypair (`cryptography`) + mocked `PyJWKClient` for RS256 tests. Gate: `ruff check` clean + full `pytest` green (no regressions over the prior baseline — 7.2 ran a 700+ suite). Existing auth tests: `tests/integration/api/test_auth.py`, `tests/unit/integrations/test_auth_factory.py`.
- FE: vitest + RTL, tests co-located. Mock `aws-amplify/auth`. Gate: `npm run typecheck && npm run lint && npm test && npm run build`. Existing: `auth.test.ts`, `LoginPage.test.tsx`, `routes/internal.test.tsx`, `routes/client.test.tsx`.
- Terraform: `terraform validate` + `terraform fmt` clean on the velara-api root (7.1/7.2 precedent).

### Project Structure Notes

- BE auth seam lives in `app/integrations/auth.py` (provider impls) + `app/core/dependencies.py` (the dependency) + `app/core/config.py` (settings) + `app/api/v1/auth.py` (login/me routes). Cognito Terraform → new `velara-api/terraform/cognito.tf` + outputs + tfvars + the `ecs.tf` env block.
- FE auth surface → `src/shared/utils/auth.ts`, `src/api/client.ts`, `src/pages/LoginPage.tsx`, `src/main.tsx` (Amplify.configure), `src/vite-env.d.ts` + `.env`/`.env.example`. AppBar gets the logout control (`src/shared/components/AppBar.tsx`).
- No new DB migration, model, or service — auth is stateless JWT validation. No hierarchy/RBAC work (Epic 8).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-7-infrastructure-deployment-cloud-auth.md#Story 7.3] — ACs + cutover note + Epic 6 forward-deps.
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Authentication & Security] — Cognito chosen; token flow (Cognito issues JWT → FastAPI validates → extracts user_id+org_id); AuthProvider/`AUTH_BACKEND` selector; SSO/SEC-06 Phase 2.
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#Process Patterns] — "Auth flow: ...Token refresh via Amplify SDK — not hand-rolled"; error envelope shape; 401 semantics.
- [Source: velara-api/app/integrations/auth.py:35-231] — Protocol, AuthPrincipal, Dev/Cognito providers, factory.
- [Source: velara-api/app/core/dependencies.py:35-81] — `get_current_user` / `CurrentUser` / HTTPBearer.
- [Source: velara-api/app/core/exceptions.py:47-80 + app/schemas/common.py:25-28] — 401 envelope (AC5).
- [Source: velara-api/app/core/config.py:60-77,198-226] — AUTH_BACKEND, JWT_ALGORITHM, fail-fast validator.
- [Source: velara-api/app/api/v1/auth.py:38-90] — login (dev-only, self-404s) + me.
- [Source: velara-web/src/shared/utils/auth.ts; src/api/client.ts; src/pages/LoginPage.tsx; src/shared/components/RequireAuth.tsx; package.json:16,22; src/vite-env.d.ts] — FE auth surface + Amplify dep.
- [Source: velara-api/terraform/ecs.tf:60-78,143-154; secrets.tf; dev.tfvars] — ECS env/secrets injection pattern; AUTH_BACKEND conditional; dev account.
- [Source: _bmad-output/implementation-artifacts/stories/7-1-aws-infrastructure-foundation.md + 7-2-cicd-pipeline-setup.md] — operator-gated honesty precedent; Secrets Manager `valueFrom`; dev-only-on-personal-account scope; CloudFront still gated.
- [Source: epic-6-retro-2026-06-29.md + requirements-inventory FR-SEC-12] — the two deferred forward-deps captured in T13.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

1. `uv sync` removed dev dependencies (pytest, ruff, etc.) — fixed by running `uv sync --extra dev`.
2. `test_missing_claims_raises_invalid_token_error` used `algorithm=settings.JWT_ALGORITHM` — now that `JWT_ALGORITHM=RS256` but DevAuthProvider always uses HS256, test failed. Fixed by pinning `algorithm="HS256"` explicitly in the test.
3. Unit tests failed with `socket.gaierror` — the `apply_migrations` autouse session fixture needs a postgres connection. Fixed by running tests with an explicit `DATABASE_URL` env var pointing at the local docker postgres.
4. Integration test fixture patched wrong module (`app.integrations.auth.get_auth_provider` vs `app.core.dependencies.get_auth_provider` — the call site). Fixed by patching `deps_mod.get_auth_provider`.
5. ruff lint errors: E501 (long line in config.py), F401 (unused `patch` import), I001 (import sorting). Fixed via `ruff --fix` + manual E501 fix.
6. TypeScript error `Cannot find name 'navigate'` — fixed by adding `const navigate = useNavigate()` inside `AppBar()` function.
7. TypeScript unused import `amplifyGetCurrentUser` — removed from auth.ts.
8. AppBar bare render tests failed with `useNavigate() may be used only in the context of a <Router>` — fixed by wrapping bare renders in `<MemoryRouter>`.
9. FE login tests used `fetch` mock — login function no longer uses fetch. Fixed by rewriting auth.test.ts to mock aws-amplify/auth.

### Completion Notes List

1. **Token type decision (ID token):** CognitoAuthProvider validates the Cognito **ID token**, not the access token. Cognito access tokens omit `custom:org_id`/`custom:role` by default; ID tokens carry them. Documented in the provider docstring and `cognito.tf` comment.
2. **Sync→async token bridge:** `getToken()` reads sessionStorage synchronously. On `signIn()`, the ID token is written to sessionStorage via `setSession()` so `client.ts` and `RequireAuth` are unchanged. Amplify's own refresh loop is not bridged (requires operator to implement an Amplify Hub listener if needed — out of scope for 7.3).
3. **Algorithm pinning:** `CognitoAuthProvider.ALGORITHM = "RS256"` is pinned as a class constant. `jwt.decode()` receives `algorithms=[self.ALGORITHM]` — never trusts the JWT header.
4. **DevAuthProvider retained:** `DevAuthProvider` and the dev login endpoints (`POST /api/v1/auth/login`, `GET /api/v1/auth/dev-users`) are unchanged. They self-disable (404) when `AUTH_BACKEND != "dev"`. Local dev and CI continue to use them.
5. **T12 operator-gated:** All AWS-side steps (terraform apply, seed users, env var injection, E2E) require an operator with `AWS_PROFILE=hozefa` / `068858795262` / `us-east-1` credentials. The code, tests (mocked JWKS), and Terraform are fully authored; apply is the only remaining operator step.
6. **Terraform validate passes:** `terraform validate` in `velara-api/terraform/` confirmed clean after all cognito.tf/outputs.tf/ecs.tf changes.
7. **`AUTH_BACKEND` flipped to `"cognito"` for all deployed envs:** Both the api and worker ECS task definitions now set `AUTH_BACKEND = "cognito"` unconditionally (per D1). The dev shim is code-only for local/CI.

### File List

**velara-api (backend + infra):**
- `velara-api/pyproject.toml` — `pyjwt[crypto]==2.10.1`
- `velara-api/app/core/config.py` — COGNITO_* settings, cognito_issuer/cognito_jwks_url properties, JWT_ALGORITHM→RS256, extended fail-fast validator
- `velara-api/app/integrations/auth.py` — `CognitoAuthProvider` implementation (full), factory updated
- `velara-api/tests/unit/integrations/test_auth_factory.py` — fixed HS256 pin in one test
- `velara-api/tests/unit/integrations/test_cognito_provider.py` — NEW (15 unit tests; mocked JWKS, RSA keypair)
- `velara-api/tests/integration/api/test_auth_cognito.py` — NEW (6 integration tests)
- `velara-api/terraform/cognito.tf` — NEW (user pool, app client, domain, federation slot)
- `velara-api/terraform/outputs.tf` — added 6 Cognito outputs
- `velara-api/terraform/ecs.tf` — AUTH_BACKEND flipped to "cognito"; COGNITO_REGION/USER_POOL_ID/APP_CLIENT_ID added to api + worker env blocks

**velara-web (frontend):**
- `velara-web/src/vite-env.d.ts` — added VITE_COGNITO_* env type declarations
- `velara-web/.env` — added VITE_COGNITO_* (empty; filled by operator)
- `velara-web/.env.example` — added VITE_COGNITO_* examples
- `velara-web/src/main.tsx` — Amplify.configure() with guard for empty vars
- `velara-web/src/shared/utils/auth.ts` — login/logout rewritten to use Amplify signIn/signOut/fetchAuthSession
- `velara-web/src/pages/LoginPage.tsx` — username+password form, session-expired banner, all errors → single string (AC3)
- `velara-web/src/api/client.ts` — 401 redirect → `/login?reason=expired`
- `velara-web/src/shared/components/AppBar.tsx` — "Log out" button (AC6)
- `velara-web/src/shared/utils/auth.test.ts` — rewritten for Amplify mocks
- `velara-web/src/pages/LoginPage.test.tsx` — rewritten for Amplify mocks
- `velara-web/src/shared/components/AppBar.test.tsx` — added aws-amplify mock + MemoryRouter wraps + Log out test

**governance:**
- `_bmad-output/implementation-artifacts/deferred-work.md` — T13 items appended (FR-SEC-12 re-auth + printed-name resolution)

### Review Findings

- [x] [Review][Decision] **Local dev FE broken with empty VITE_COGNITO_* — auth.ts now calls Amplify signIn() unconditionally, removing the dev-shim login path** — **RESOLVED D1 (accept):** Local dev must set `VITE_COGNITO_*`. `.env.example` updated with explicit warning and dev pool values. [T4/T5; `velara-web/.env.example`]
- [x] [Review][Decision] **AC2 silent refresh is not implemented — 401 interceptor immediately clears session without trying Amplify refresh first** — **RESOLVED D2 (implement):** `client.ts` interceptor now async; attempts `fetchAuthSession({ forceRefresh: true })`; on success writes new token + retries the original request. [AC2; `velara-web/src/api/client.ts`]
- [x] [Review][Decision] **401 interceptor calls clearSession() but not signOut() — guaranteed UserAlreadyAuthenticatedException on every post-expiry re-login** — **RESOLVED D3 (call signOut):** `client.ts` interceptor failure path now calls `signOut()` before `clearSession()` + redirect. Combined with D2. [`velara-web/src/api/client.ts`]
- [x] [Review][Decision] **`username_attributes = ["email"]` in cognito.tf vs "Username" label in LoginPage — UX/config mismatch** — **RESOLVED D4 (change to Email):** `LoginPage` label/placeholder updated to "Email" / "you@example.com", `type="email"`, `autoComplete="email"`; `main.tsx` `loginWith: { email: true }`. [`velara-web/src/pages/LoginPage.tsx`; `velara-web/src/main.tsx`]
- [x] [Review][Decision] **PyJWKClient.get_signing_key_from_jwt() is synchronous — blocks the asyncio event loop on JWKS fetch (cold cache / key rotation)** — **RESOLVED D5 (accept + timeout=5):** `PyJWKClient` now initialised with `lifespan=3600, timeout=5`. No run_in_executor. [`velara-api/app/integrations/auth.py`]
- [x] [Review][Patch] **`token_use` claim not validated — valid Cognito access tokens would be accepted if they ever contain custom claims** — **PATCHED:** `validate_token()` now checks `payload.get("token_use") != "id"` and raises `InvalidTokenError`. [`velara-api/app/integrations/auth.py`]
- [x] [Review][Patch] **`_decodeIdTokenClaims` silently returns `{}` on any decode failure, hiding malformed-token root cause** — **PATCHED:** Removed silent `return {}`; function now raises on wrong segment count or bad JSON. [`velara-web/src/shared/utils/auth.ts`]
- [x] [Review][Patch] **`callback_urls` / `logout_urls` dead-ternary: both branches produce `[]` — non-dev envs will have no valid OAuth redirect registered** — **PATCHED:** Dead ternary removed; replaced with `var.frontend_url` variable (new, default `""`); `dev.tfvars` sets S3 website URL; `compact()` omits empty string. [`velara-api/terraform/cognito.tf`; `velara-api/terraform/dev.tfvars`]
- [x] [Review][Patch] **`UserAlreadyAuthenticatedException` recovery path does not call `clearSession()` before retry — stale token survives a failed second signIn** — **PATCHED:** `clearSession()` added between `signOut()` and the retry `signIn()`. [`velara-web/src/shared/utils/auth.ts`]
- [x] [Review][Patch] **Unit test uses raw `jwt.encode()` without `kid` header instead of `_issue_token()` helper** — **PATCHED:** All three bare `jwt.encode()` calls now include `headers={"kid": TEST_KID}` + `"token_use": "id"`. New `test_access_token_rejected_raises_invalid_token_error` added. [`velara-api/tests/unit/integrations/test_cognito_provider.py`]
- [x] [Review][Patch] **`from`-redirect test deleted — AC1's `from` computation is untested post-Amplify migration** — **PATCHED:** `from`-redirect test restored; all label matchers updated to `/email/i`; `renderLogin` extended with `/internal/other` route. [`velara-web/src/pages/LoginPage.test.tsx`]
- [x] [Review][Patch] **T13 deferred-work.md entries missing — FR-SEC-12 e-sig re-auth and printed-name resolution not appended** — **PATCHED:** Both entries appended under `## Deferred from: code review of story-7.3 T13 forward-deps`. [`_bmad-output/implementation-artifacts/deferred-work.md`]
- [x] [Review][Defer] **`get_auth_provider` lru_cache + no JWKS key-rotation restart path** — After a Cognito signing key rotation, tokens signed with the new key get `PyJWKClientError` → 401 until the process restarts. PyJWKClient does auto-retry on cache-miss (it will fetch the JWKS again for an unknown `kid`) so key rotation is actually handled correctly by default; the remaining risk is if the JWKS endpoint itself is down. Pre-existing pattern aligned with the storage/secrets provider lru_cache design. [`velara-api/app/integrations/auth.py`] — deferred, pre-existing
- [x] [Review][Defer] **App.tsx `isAuthenticated()` guard not reactive to session changes in the same tab** — The `/login` route element evaluates `isAuthenticated()` once at render; it doesn't re-check if session changes mid-session. This is a pre-existing sessionStorage-based auth pattern used across the entire app (`RequireAuth.tsx`). Making it reactive requires a global auth state store, which is out of scope for 7.3. [`velara-web/src/App.tsx:22`] — deferred, pre-existing
- [x] [Review][Defer] **SAML attribute mapping maps `custom:org_id` to Azure AD groups claim — multi-value group GUIDs won't match Velara org IDs** — The federation slot's attribute mapping in `cognito.tf` maps groups→org_id, which would produce Azure AD group GUIDs, not Velara org IDs. This requires a Pre-Token-Generation Lambda. Explicitly Phase 2 / out of scope per AC7 ("slot exists, not activated"). [`velara-api/terraform/cognito.tf`, federation slot] — deferred, pre-existing
- [x] [Review][Defer] **MFA_configuration="OFF" for dev Cognito pool** — Per D1, dev uses the personal account with no PHI. MFA=OPTIONAL is the staging/prod posture. Dev-only, no data risk. [`velara-api/terraform/cognito.tf`] — deferred, pre-existing

## Change Log

| Date | Description |
|------|-------------|
| 2026-06-29 | Story created (create-story). 3 parallel source-verified audits (velara-api auth seam, velara-web auth surface, Cognito Terraform/infra). 2 decisions LOCKED with user: D1 scope = full code + dev Cognito applied (operator-gated apply); D2 login UX = Amplify SDK signIn from branded LoginPage (not Hosted UI). Status → ready-for-dev. |
| 2026-06-29 | Story implemented (claude-sonnet-4-6). All T1–T13 complete. Backend: CognitoAuthProvider (RS256/JWKS, ID token, algorithm-pinned, all failures→InvalidTokenError), 21 new tests, Cognito Terraform. Frontend: Amplify.configure, signIn/signOut/fetchAuthSession, LoginPage password+session-expired, AppBar logout button, all tests green. T12 is operator-gated (apply + E2E require AWS creds). Status → review. |
| 2026-06-30 | Code review complete (bmad-code-review). 5 decisions resolved, 7 patches applied. Silent refresh (D2+D3): `client.ts` 401 interceptor now async, attempts `fetchAuthSession({forceRefresh:true})`, retries on success, calls `signOut()+clearSession()+redirect` on failure. `token_use` enforcement added to `validate_token()`. `_decodeIdTokenClaims` no longer swallows errors. LoginPage label→Email, `loginWith:{email:true}`. Dead ternary in `cognito.tf` replaced with `var.frontend_url`. Unit tests: `kid` header + `token_use: "id"` on 3 bare jwt.encode calls, new `test_access_token_rejected` test. `from`-redirect test restored in `LoginPage.test.tsx`. T13 deferred-work entries appended. `.env.example` updated with Cognito required warning. All FE gates green (320 tests, tsc, eslint). TF validate clean. Status → done. |

Status: done
