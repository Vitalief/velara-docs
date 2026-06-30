---
baseline_commit: NO_VCS
---

# Story 1.4: Dev Authentication Shim

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a local authentication provider that issues and validates JWTs with the **same claims contract** Cognito will use,
so that role-scoped features (registry visibility, route guards) work locally now and the production Cognito swap is isolated to one provider.

> **Context:** This is the third and final provider abstraction of Epic 1's local-dev foundation. Stories 1.1 (api scaffold), 1.2 (web scaffold), and 1.3 (StorageProvider + SecretsProvider + MinIO) are **done**. Story 1.3 deliberately **reserved** the `AUTH_BACKEND` env switch and `Settings.AUTH_BACKEND` field but did NOT implement `AuthProvider` — that is this story. The real AWS Cognito provider (`CognitoAuthProvider` JWKS validation, Amplify on the frontend) lands in **Epic 7, Story 7.3**; this story builds the dev shim and the provider-agnostic validation seam Cognito will later slot into. [Source: epics/epic-1, Story 1.4; stories/1-3, Dev Notes "Scope — What NOT to build"]

## Acceptance Criteria

1. **Given** the `AuthProvider` interface is defined (`issue_token`, `validate_token` → `user_id`, `org_id`, role claims), **When** the app boots with `AUTH_BACKEND=dev`, **Then** a `DevAuthProvider` issues signed JWTs carrying `user_id`, `org_id`, and a `role` claim **identical in shape** to the Cognito token contract; with `AUTH_BACKEND=cognito` a `CognitoAuthProvider` validates against the Cognito JWKS endpoint (full implementation deferred to **Epic 7, Story 7.3** — this story provides the class + factory branch + documented stub, not live JWKS validation).

2. **Given** seed dev users exist across roles (MA Tech, consultant, client), **When** I log in locally at `/login` with a seed user, **Then** a JWT is issued, I am redirected to `/internal/engagements`, and the role switcher reflects my role.

3. **Given** a valid dev JWT is present in a request, **When** FastAPI processes it, **Then** the **same dependency** that will later validate Cognito tokens extracts `user_id` and `org_id` and allows the request — the validation seam is provider-agnostic (one `current_user` dependency, backed by `get_auth_provider()`).

4. **Given** a request arrives with an expired or invalid JWT (or no token), **When** the auth dependency validates the token, **Then** the request is rejected with HTTP 401 and `{"error": {"code": "UNAUTHORIZED", "message": "Authentication required.", "request_id": "..."}}`.

5. **Given** the frontend `auth.ts` boundary is the single place that talks to the auth provider, **When** Epic 7 swaps `DevAuthProvider` for Amplify/Cognito, **Then** no route component or API hook changes — the swap is contained to `auth.ts` and the API client's token source (this **resolves** the `deferred-work.md` note that `src/api/client.ts` reads `sessionStorage` directly rather than through `auth.ts`).

6. **Given** role-based registry visibility (Epic 2, Story 2.4) is built, **When** a user with a given role views the Skill Registry, **Then** the dev-auth `role` claim drives what they see — i.e. this story must **surface the role claim** to the frontend (stored via `auth.ts`, reflected in the role switcher) so Epic 2 can consume it; the registry-filtering logic itself is Epic 2's, not this story's.

## Tasks / Subtasks

- [x] **T1: Settings + JWT dependency** (AC: 1, 4)
  - [x] Add **one** new backend dependency to `pyproject.toml`: `pyjwt==2.10.1` (pure-Python, HS256 needs no `cryptography`). Do **NOT** add `[crypto]`/`cryptography` here — Epic 7 Story 7.3 adds `pyjwt[crypto]` for Cognito's RS256 + JWKS. Do NOT add `python-jose`. [See Dev Notes → JWT library]
  - [x] In `app/core/config.py`, extend the **existing** `Settings` (do not rewrite). Update the stale comment on `AUTH_BACKEND` (currently says "AuthProvider is NOT implemented in this story" — written during 1.3; it IS implemented now). Add: `JWT_ALGORITHM: str = "HS256"` (dev), `JWT_ACCESS_TTL_MINUTES: int = 480` (8h dev session), `JWT_ISSUER: str = "velara-dev"`, `JWT_AUDIENCE: str = "velara"`.
  - [x] **Preserve** the fail-fast validator. It already rejects `AUTH_BACKEND=dev` in staging/prod (added in 1.3 review) — do NOT weaken it. The dev shim must never boot in a cloud env (HIPAA: dev tokens are unsigned-by-Cognito).
  - [x] Dev JWTs are signed with the existing `SECRET_KEY`. No new secret in code (HIPAA non-negotiable since 1.1).

- [x] **T2: AuthProvider abstraction + implementations** (AC: 1, 3)
  - [x] Create `app/integrations/auth.py` mirroring `storage.py`/`secrets.py` exactly (Protocol + concrete classes + `@lru_cache` factory). Define:
    - `AuthPrincipal` — frozen dataclass (or `pydantic.BaseModel`) carrying `user_id: str`, `org_id: str`, `role: str`. This is the **provider-agnostic claims contract** every consumer depends on.
    - `AuthProvider(Protocol)`: `issue_token(principal: AuthPrincipal) -> str`, `validate_token(token: str) -> AuthPrincipal`.
    - `DevAuthProvider`: `issue_token` → `jwt.encode({sub, org_id, role, iss, aud, iat, exp}, SECRET_KEY, HS256)`; `validate_token` → `jwt.decode(...)` then map claims → `AuthPrincipal`. Raise a typed error (see below) on any `jwt.ExpiredSignatureError` / `jwt.InvalidTokenError`. **Owns the seed user list** (see T4).
    - `CognitoAuthProvider`: **stub for Epic 7 Story 7.3**. Constructor may accept JWKS URL/region config (reserved). `validate_token` raises `NotImplementedError("CognitoAuthProvider lands in Epic 7 Story 7.3")` — do not implement JWKS fetch here. Document that it will use `PyJWKClient` (RS256) and normalize Cognito's `custom:org_id` / `custom:role` claims to the same `AuthPrincipal` shape.
  - [x] Add `InvalidTokenError(VelaraBaseException)` (or reuse `VelaraHTTPException`) — see T3 for how it becomes a 401 envelope. Follow the `MissingSecretError` precedent in `secrets.py` (subclass `VelaraBaseException`, give it a stable `ERROR_CODE = "UNAUTHORIZED"`).
  - [x] `get_auth_provider() -> AuthProvider` factory, `@lru_cache(maxsize=1)`, keyed on `settings.AUTH_BACKEND` (`"dev"` → `DevAuthProvider`, `"cognito"` → `CognitoAuthProvider`). Same shape as `get_secrets_provider()`.
  - [x] **Document the structural variance** (same pattern as 1.3's `storage.py`): `integrations/auth.py` fulfils the roles the architecture named `core/security.py` (Cognito JWT validation) **and** `integrations/cognito_client.py`. This is the provider pattern from the 2026-06-05 change, not a deviation. Do NOT also create `core/security.py` or `integrations/cognito_client.py`.

- [x] **T3: `current_user` dependency + 401 seam** (AC: 3, 4)
  - [x] In `app/core/dependencies.py` (created in 1.3 — extend it, matching the `IngestStorage`/`Secrets` alias style), add the auth seam:
    - A function that extracts the Bearer token from the `Authorization` header (use FastAPI's `Annotated[str, Depends(HTTPBearer)]` or read `request.headers`), calls `get_auth_provider().validate_token(...)`, and returns the `AuthPrincipal`.
    - On missing/expired/invalid token → raise `VelaraHTTPException(401, "UNAUTHORIZED", "Authentication required.")`. The **existing** `velara_http_exception_handler` already renders this as the exact AC4 envelope `{"error": {"code": "UNAUTHORIZED", "message": "Authentication required.", "request_id": "..."}}` — do NOT hand-roll a new handler. (Note: FastAPI's `HTTPBearer(auto_error=True)` raises its own 403/`StarletteHTTPException`; set `auto_error=False` and raise the Velara exception yourself so the code/message/status match AC4 exactly.)
    - Export `CurrentUser = Annotated[AuthPrincipal, Depends(get_current_user)]` so routes write `user: CurrentUser`.
  - [x] This is **THE** single validation seam (AC3). JWT decode is CPU-only (HS256) → safe to call inline in async handlers (no `run_in_threadpool` needed). Cognito's JWKS fetch (Epic 7) is network I/O — that provider will handle its own async/caching; the dependency contract is unchanged.

- [x] **T4: Auth router (login + me) + seed users + CORS** (AC: 1, 2, 3, 4)
  - [x] Create `app/api/v1/auth.py` (the architecture's named `api/v1/auth.py`). Mount it in `app/api/v1/router.py` next to `health` (under the `/api/v1` story convention — see Dev Notes → routing). Endpoints:
    - `POST /api/v1/auth/login` — **dev-only**. Accepts `{username}` (+ an ignored/sentinel password is fine for the shim; do NOT build real credential hashing — that's Cognito's job). Looks up the seed user; on match issues a token via `get_auth_provider().issue_token(...)` and returns `ResponseEnvelope` with `{token, user: {user_id, org_id, role}}`. Unknown user → `VelaraHTTPException(401, "UNAUTHORIZED", "Authentication required.")`.
    - `GET /api/v1/auth/me` — protected by `CurrentUser`. Returns the resolved principal in a `ResponseEnvelope`. **This is the proof endpoint for AC3** (a real route that exercises the seam) since no domain routes exist yet.
    - (Optional, recommended) `GET /api/v1/auth/dev-users` — dev-only listing of seed usernames+roles so the login page isn't a second source of truth for the seed list. Guard so it 404s when `AUTH_BACKEND != "dev"`.
  - [x] **Seed users** live in the `DevAuthProvider` (in-code constant) — **no users DB table** in this story (the users/`access_grant` table is Epic 8 RBAC; hierarchy is Epic 4). Seed at least three, one per role:
    - an **MA Tech** user (technical-cert key persona), `role="ma_tech"`, internal org;
    - a **Vitalief consultant**, `role="consultant"`, internal org;
    - a **client** user, `role="client"`, a client org_id.
    - Give each a stable `user_id` (opaque string/UUID) and an `org_id` consistent with the ltree root convention (`org_1...` — internal users share the Vitalief org; the client user gets a distinct client org). Role values are a **stable enum** (`ma_tech | consultant | client`) — pick names that Cognito custom-claim values can mirror; document them. Keep it coarse: this is a top-level identity role, NOT hierarchy-scoped RBAC grants (Epic 8 refines `(user_id, node_id, role)`).
  - [x] **Add CORS** — `app/main.py` has no `CORSMiddleware`, and this story is the **first** browser→API cross-origin call (login). Add Starlette/FastAPI `CORSMiddleware` allowing the dev frontend origin. Add a `CORS_ALLOW_ORIGINS` setting (default `["http://localhost:5173"]`); allow credentials/`Authorization` header. Without this, login fails in the browser even though it passes in tests. [See Dev Notes → CORS]
  - [x] Keep `/health` and `/health/ready` **auth-exempt** (ECS probes). Do NOT apply `CurrentUser` app-wide; apply per-route. (The `health.py` docstring says "auth is wired in Story 1.5" — stale renumber reference; health stays public regardless.)

- [x] **T5: `.env.example` + config docs** (AC: 1, 5)
  - [x] `velara-api/.env.example`: the `AUTH_BACKEND=dev` line + commented Epic 7 `AUTH_BACKEND=cognito` block already exist (1.3). Add the new JWT vars with comments (`JWT_ALGORITHM`, `JWT_ACCESS_TTL_MINUTES`, `JWT_ISSUER`, `JWT_AUDIENCE`) and a `CORS_ALLOW_ORIGINS` line. In the commented "AWS (Epic 7)" block, note Cognito sets `JWT_ALGORITHM=RS256` + JWKS URL.
  - [x] `velara-web/.env.example`: `VITE_API_URL=http://localhost:8000` already present — confirm it's documented as the login target. (No new web env var required.)

- [x] **T6: Frontend `auth.ts` boundary** (AC: 2, 5, 6)
  - [x] Rewrite `src/shared/utils/auth.ts` as the **single** auth boundary (its docstring already promises this; it currently only wraps `sessionStorage`). Add:
    - token storage accessors: `getToken()`, `getCurrentUser()`, `setSession(token, user)`, `clearSession()` — keep using the `velara_session` sessionStorage key (preserve the storage-throws `try/catch` safety already there). Store the user object (`{user_id, org_id, role}`) alongside the token (e.g. a second `velara_user` key or a JSON blob) so the role is available without decoding the JWT client-side.
    - `isAuthenticated()` → derives from `getToken()`.
    - `login(username)` → `POST {VITE_API_URL}/api/v1/auth/login` via the shared axios client, then `setSession(token, user)` and return the user. `logout()` → `clearSession()`.
  - [x] **Preserve the test helpers** `_mockAuthSession(token)` / `_clearAuthSession()` — `src/routes/internal.test.tsx` and `client.test.tsx` import them. Re-implement them on top of `setSession`/`clearSession` (or keep writing the `velara_session` key) so existing route tests stay green. [See Dev Notes → Regression]
  - [x] Update the stale docstrings: "Story 1.5 … Amplify" → the dev-auth shim is here now; the Amplify/Cognito swap is **Story 7.3** and stays contained to this file + the API client token source.

- [x] **T7: API client sources token via `auth.ts`** (AC: 5)
  - [x] `src/api/client.ts`: replace the direct `sessionStorage.getItem('velara_session')` (request interceptor) with `getToken()` from `auth.ts`; replace the direct `sessionStorage.removeItem('velara_session')` (401 response interceptor) with `clearSession()` from `auth.ts`. Keep the existing redirect-loop guard (don't redirect when already on `/login`) and the `X-Request-ID` header (the backend `RequestIDMiddleware` honors it). This is the concrete fix for the `deferred-work.md` token-isolation note. Update the "Story 1.5 / Amplify" comments to "Story 7.3".

- [x] **T8: Login page form** (AC: 2)
  - [x] Rebuild `src/pages/LoginPage.tsx` from the stub into a working dev login: a seed-user picker (dropdown/buttons sourced from `GET /api/v1/auth/dev-users`, or a small hardcoded list if you skip that endpoint) — or a username field. On submit → `auth.login(username)` → on success redirect to the post-login target.
  - [x] **Fix the deferred redirect bug**: currently reads `state.from.pathname` only (drops search/hash; no guard if `from === '/login'`). Redirect to the full `from` location (path+search+hash) and fall back to `/internal/engagements` when `from` is absent or is `/login`. [deferred-work.md, 1-2 review]
  - [x] On success, set `useRoleStore` from the user's role so the role switcher reflects it (T9). Keep current evergreen tokens (`green-*`, etc.) — the V3 re-theme is **Story 1.6** (still backlog, runs after this); do not pre-empt it.

- [x] **T9: Surface role to the UI** (AC: 2, 6)
  - [x] After login, initialize `useRoleStore` (portal switcher: `internal | client`) from the authenticated user's `role`: a `client`-role user defaults to (and is constrained to) the `client` portal; `ma_tech`/`consultant` default to `internal`. **Clarify in code/comments** that `useRoleStore` is the *portal switcher* (UI affordance) while the JWT `role` claim is the *authoritative identity* — they are related but distinct; do not collapse them. The AppBar's hardcoded "M. Maxwell / Methodology key" user row may optionally be wired to the logged-in user, but that polish is not required for AC2.
  - [x] Epic 2 Story 2.4 (registry visibility) will read `getCurrentUser().role` — make sure the role is reliably stored and retrievable; do NOT build registry filtering here.

- [x] **T10: Tests** (AC: 1, 2, 3, 4, 5)
  - [x] **Backend unit** `tests/unit/integrations/test_auth_factory.py` (the `tests/unit/integrations/` dir already exists from 1.3): factory returns `DevAuthProvider` for `AUTH_BACKEND=dev`; `DevAuthProvider` issue→validate roundtrip yields the correct `AuthPrincipal`; an **expired** token raises `InvalidTokenError`; a **tampered / wrong-signature** token raises; a token with missing required claims raises.
  - [x] **Backend integration** `tests/integration/api/test_auth.py` (follow 1.1/1.3 `httpx.AsyncClient` + `conftest.py` conventions): `POST /api/v1/auth/login` with a seed user → 200 + token in envelope; unknown user → 401 envelope; `GET /api/v1/auth/me` with a valid token → 200 + principal; **no token → 401**, **invalid/expired token → 401**, asserting the exact `{"error":{"code":"UNAUTHORIZED","message":"Authentication required.","request_id":...}}` body; `GET /health` + `/health/ready` still return 200 **without** a token (auth-exempt regression).
  - [x] **Frontend** `src/shared/utils/auth.test.ts` (co-located): token+user roundtrip via `setSession`/`getToken`/`getCurrentUser`/`clearSession`; `isAuthenticated()` reflects state; storage-throws path returns `false`/safe. `src/pages/LoginPage.test.tsx`: renders, submit calls `login` (mock axios) and navigates to `from`/default. Confirm `src/routes/internal.test.tsx` + `client.test.tsx` still pass via the preserved `_mockAuthSession`/`_clearAuthSession` helpers.
  - [x] Co-locate tests (enforcement rule 7). Add any new `__init__.py` only if a new test dir is introduced (the integrations + api dirs already exist).

- [x] **T11: Verify end-to-end** (AC: all)
  - [x] Backend: `ruff check .` clean; `pytest` green (existing **29** local / 34 in-container tests from 1.3 still pass + new auth tests). `docker compose up` — app boots with `AUTH_BACKEND=dev`; `POST /api/v1/auth/login` returns a token; `GET /api/v1/auth/me` with it returns the principal; without it returns the 401 envelope.
  - [x] Frontend: `npm run typecheck` (0 errors), `npm run lint`, `npm run test`, `npm run build` all green. Manually (or via test) confirm the real flow: visit a guarded route → redirected to `/login` → pick a seed user → JWT stored via `auth.ts` → redirected to `/internal/engagements` → API calls carry the Bearer token → role switcher reflects the user's role. **Confirm CORS** lets the browser at `:5173` call the API at `:8000`.

## Dev Notes

### What already exists — DO NOT reinvent

**Backend (velara-api, from Stories 1.1 + 1.3 — done, verified live):**
- `app/core/config.py`: `Settings(BaseSettings)` already has `AUTH_BACKEND: Literal["dev","cognito"] = "dev"` (reserved by 1.3) and `SECRET_KEY` (the dev-JWT signing key). **Extend** `Settings`; preserve the fail-fast validator that already rejects `AUTH_BACKEND=dev` outside dev. [config.py:64-67, 94-120]
- `app/integrations/storage.py` + `secrets.py`: the **exact pattern to mirror** — `Protocol` interface, concrete class(es), typed error subclassing `VelaraBaseException`, `@lru_cache` factory keyed on a `*_BACKEND` setting. `auth.py` should read like a sibling of these. [stories/1-3 T2/T3]
- `app/core/dependencies.py`: already exists (created in 1.3) with `Annotated[..., Depends(...)]` aliases (`IngestStorage`, `OutputStorage`, `Secrets`). **Add** `CurrentUser` here in the same style — do not create a new module.
- `app/core/exceptions.py`: `VelaraBaseException`, `VelaraHTTPException(status_code, code, message)`, and `velara_http_exception_handler` that renders **exactly** `{"error":{"code","message","request_id"}}`. Raising `VelaraHTTPException(401, "UNAUTHORIZED", "Authentication required.")` produces AC4's envelope verbatim — reuse it, don't add a handler. `MissingSecretError` is the precedent for a typed domain exception with a stable `ERROR_CODE`. [exceptions.py:23-41, 68-80]
- `app/schemas/common.py`: `ResponseEnvelope[T]` + `ResponseMeta(request_id, timestamp)`. Every route returns an envelope (enforcement rule 1) — login/me responses included. [schemas/common.py]
- `app/api/v1/router.py`: aggregate router; `api_router.include_router(health.router)`. Add `auth.router` the same way. [router.py]
- `app/api/v1/health.py`: shows the `_meta(request)` helper + `ResponseEnvelope` return style to copy. Health is auth-exempt and must stay so. [health.py:33-44]
- `app/core/middleware.py`: `RequestIDMiddleware` honors an inbound `X-Request-ID` (the frontend already sends one) and stamps `request.state.request_id`; the error handler reads it for the envelope. `sanitize_phi` strips PHI from logs — **never log raw tokens or full JWTs**; log only `user_id`/`role` (opaque) and token *prefix* at most. [middleware.py:23, 114-143]
- `boto3` is pinned; **no AWS SDK work** in this story (Cognito is Epic 7).
- Tests: `tests/conftest.py` (`httpx.AsyncClient`), `tests/unit/integrations/`, `tests/integration/api/`, `asyncio_mode="auto"`. 29 local / 34 in-container tests currently green — keep them green. [stories/1-3 T7]

**Frontend (velara-web, from Story 1.2 — done):**
- `src/shared/utils/auth.ts`: the boundary stub — `isAuthenticated()`, `_mockAuthSession`, `_clearAuthSession`, `velara_session` key, storage-throws `try/catch`. **Extend in place**; keep the test helpers working.
- `src/api/client.ts`: shared axios instance; request interceptor attaches `Bearer` + `X-Request-ID`; response interceptor redirects to `/login` on 401 (with loop guard). Re-point its token read/clear to `auth.ts`. [client.ts:21-42]
- `src/shared/components/RequireAuth.tsx`: guard using `isAuthenticated()`, preserves `state.from`. No change needed (depends only on the boolean contract).
- `src/routes/internal.tsx` + `client.tsx`: `RequireAuth`-wrapped trees; `/internal/engagements` is the post-login default. `src/App.tsx`: `/` → `/internal/engagements`, `/login` route. [App.tsx:17-26]
- `src/stores/useRoleStore.ts`: `Role = 'internal' | 'client'` **portal switcher** (not the identity role). `src/shared/components/AppBar.tsx`: renders the role switcher + a hardcoded user row. [useRoleStore.ts; AppBar.tsx:77-121]
- `aws-amplify` + `@aws-amplify/auth` are **already** in `package.json` (reserved for Story 7.3) — do NOT add them, do NOT use them yet. The dev shim talks to the backend over axios.
- `react-router-dom` is **v7** (architecture text says v6) — APIs used here (`Navigate`, `useNavigate`, `useLocation`, `state.from`) are identical; no change required.

### The provider-agnostic claims contract (the heart of this story)
- One shape, two providers. `AuthPrincipal { user_id, org_id, role }` is what every consumer sees. `DevAuthProvider` mints it from a signed HS256 JWT today; `CognitoAuthProvider` (Epic 7) will mint the **same** shape from a Cognito RS256 JWT validated against JWKS, normalizing Cognito's `custom:org_id` / `custom:role` custom-claim names to `org_id` / `role`. Because the `current_user` dependency and all routes depend only on `AuthPrincipal` + `get_auth_provider()`, the Epic 7 swap is a factory branch — no route/service edits (AC3, mirrors the AC6 promise the storage/secrets providers already keep).
- Claim names in the dev JWT: use `sub` for `user_id` (standard), plus `org_id` and `role`. Include `iss`, `aud`, `iat`, `exp` so the dev decode path exercises the same validation knobs (`issuer`, `audience`, expiry) Cognito will use — this de-risks the swap.

### Architecture constraints (authoritative)
- **Provider abstraction is an approved decision** (2026-06-05): `AuthProvider` (Cognito ↔ dev-JWT), selected by `AUTH_BACKEND`. Additive; production target (Cognito) unchanged. [Source: architecture/core-architectural-decisions.md#local-development--provider-abstractions-added-2026-06-05]
- **Token flow** (the production intent the seam preserves): "Cognito issues JWT; FastAPI validates and extracts `user_id` + `org_id`; dependency resolves hierarchy scope; all subsequent DB calls receive the resolved scope filter." This story builds the validate-and-extract half; hierarchy-scope resolution is Epic 4/8. [Source: core-architectural-decisions.md#authentication--security]
- **SEC-06**: "The platform supports user authentication. Phase 1: username/password or API key." The dev shim satisfies the Phase-1 local stand-in; real auth is Cognito (Epic 7). [Source: prd §FR-SEC-06]
- **21 CFR Part 11 §11.10(d)/§11.300** (unique user identification) and **hierarchy-scoped RBAC authority** are anchored on Cognito + Epic 8 — this story's role claim is the local stand-in that lets those features be built/tested now. [Source: core-architectural-decisions.md#regulatory-compliance; prd §FR-SEC-11]
- **Naming/format** (enforcement rules): snake_case JSON fields + DB; kebab-case API path segments; SCREAMING_SNAKE_CASE error codes; envelope on every response; `request_id` carried through. HTTP 401 = unauth (distinct from 403 forbidden). [Source: implementation-patterns-consistency-rules.md#format-patterns, #enforcement-rules]
- **Auth flow (frontend)**: "All `/internal/*` and `/client/*` routes wrapped in `<RequireAuth>`. Unauthenticated → `/login` with post-auth redirect. Token refresh via Amplify SDK — not hand-rolled." For the **dev** shim there is no refresh; just issue an 8h token. Amplify refresh arrives with Cognito (Story 7.3) — do not hand-roll refresh now. [Source: implementation-patterns-consistency-rules.md#process-patterns]

### Structural variance (document it, like 1.3 did)
The architecture's `project-structure-boundaries.md` names `core/security.py` (Cognito JWT validation), `integrations/cognito_client.py` (token validation helpers), and `api/v1/auth.py` (`POST /auth/token`). Story 1.3 set the precedent that the **provider file supersedes the architecture's pre-provider file names** (`storage.py` superseded `s3_client.py`). Apply the same here: `integrations/auth.py` is the provider home and **supersedes** both `core/security.py` and `integrations/cognito_client.py`; the `current_user` dependency lives in the existing `core/dependencies.py`; `api/v1/auth.py` is the router. Note this as a deliberate, minor variance — not a deviation to flag for correction. Do NOT scatter auth logic across `core/security.py` + `integrations/cognito_client.py` + `auth.py`.

### CORS — new requirement this story surfaces
`app/main.py` registers only `RequestIDMiddleware`; there is **no `CORSMiddleware`**. Every prior story's API calls were server-side or test-client (same-origin); this story is the **first real browser→API cross-origin call** (`:5173` → `:8000` login). Add `from fastapi.middleware.cors import CORSMiddleware` in `create_app()` with a `CORS_ALLOW_ORIGINS` setting (default `["http://localhost:5173"]`), `allow_credentials=True`, allow the `Authorization` + `X-Request-ID` headers and `Content-Type`, and the methods used. Keep it tight (explicit origin list, not `*`, since credentials are allowed). Without this the login works in pytest but fails in the browser — and a story must leave the system working end-to-end, not merely pass its unit ACs.

### JWT library
- Use **`pyjwt==2.10.1`** (latest stable; pure-Python). HS256 dev signing/verifying uses stdlib hmac — **no `cryptography` needed now**. `python-jose` is unmaintained relative to PyJWT — do not use it.
- Epic 7 Story 7.3 will bump to `pyjwt[crypto]` (pulls `cryptography`) for Cognito's **RS256** + `jwt.PyJWKClient(jwks_url)` to fetch/cache Cognito's JWKS. Mention this in the `CognitoAuthProvider` stub docstring so the upgrade path is obvious. Pinning exact versions matches the project's `pyproject.toml` convention.
- `jwt.decode(token, key, algorithms=[settings.JWT_ALGORITHM], audience=..., issuer=...)` — always pass `algorithms` explicitly (never trust the token header's `alg`) to avoid the classic `alg=none` / algorithm-confusion vulnerability.

### Seed users & roles — scope discipline
- **No users table, no `access_grant` table, no DB migration** in this story. Seed users are an in-code constant owned by `DevAuthProvider`. The persistent users/grants tables are Epic 8 (RBAC); hierarchy entities are Epic 4. Adding a migration here would be scope creep and a regression risk to the clean 0001_initial schema.
- Role claim is a **coarse top-level identity role** (`ma_tech | consultant | client`), distinct from Epic 8's hierarchy-scoped `(user_id, node_id, role)` grants. Don't model node-scoped authority now — just the identity role that registry visibility (Epic 2 Story 2.4) keys off.
- The persona → role mapping from the PRD: **MA Technologies** holds the technical-cert key (`ma_tech`); **Vitalief consultants** operate internal skills (`consultant`); **clients** invoke + see outputs only (`client`). "Matt/Matthew" (methodology key) is a methodological-cert persona — you may add a 4th seed (`methodologist`) but it's optional; the AC requires MA Tech + consultant + client. [Source: prd §Users; §FR-CRT-02]

### Regression preservation (must remain green)
- Backend: existing 29 local / 34 in-container tests pass. `/health` + `/health/ready` stay **public** (no `CurrentUser`). No change to the response/error envelopes, middleware order (CORS is additive — register it without disturbing `RequestIDMiddleware`'s request_id stamping; mind middleware ordering so request_id still lands on CORS-preflight and error responses), Celery naming, or the 0001 migration. Fail-fast validator preserved.
- Frontend: `_mockAuthSession`/`_clearAuthSession` keep working → `internal.test.tsx` + `client.test.tsx` stay green. `RequireAuth` contract (boolean) unchanged. The `velara_session` storage key is preserved (or migrated transparently). No new console errors; `npm run build`/`typecheck` clean (the 1.2 ACs).
- Do not introduce new evergreen tokens needing rework — but do not re-theme either (that's Story 1.6, which runs after this).

### Scope — What NOT to build
- **Real Cognito / JWKS validation / Amplify wiring** — Epic 7 Story 7.3. `CognitoAuthProvider.validate_token` is a documented `NotImplementedError` stub here.
- **Persistent users / `access_grant` / RBAC enforcement / hierarchy-scoped filtering** — Epic 8 (+ Epic 4 hierarchy). No DB table, no migration.
- **Registry visibility filtering by role** — Epic 2 Story 2.4 (this story only *surfaces* the role claim).
- **Password hashing, MFA, token refresh, password reset** — Cognito owns these in Epic 7; the dev shim deliberately skips credential security.
- **Per-route tab titles / V3 brand re-theme** — Stories 1.5 / 1.6 (both backlog, after this).

### Project Structure Notes
- **New files:** `app/integrations/auth.py`, `app/api/v1/auth.py`, `tests/unit/integrations/test_auth_factory.py`, `tests/integration/api/test_auth.py`, `src/shared/utils/auth.test.ts`, `src/pages/LoginPage.test.tsx`.
- **Updated files:** `app/core/config.py` (JWT + CORS settings, comment fix), `app/core/dependencies.py` (`CurrentUser`), `app/api/v1/router.py` (mount auth), `app/main.py` (CORS middleware), `pyproject.toml` (`pyjwt==2.10.1`), `.env.example` (JWT/CORS vars); `src/shared/utils/auth.ts`, `src/api/client.ts`, `src/pages/LoginPage.tsx`, and (role-init) the login→`useRoleStore` wiring; possibly `src/shared/components/AppBar.tsx` (optional user row).
- **Variance (documented above):** `integrations/auth.py` supersedes the architecture-named `core/security.py` + `integrations/cognito_client.py` (provider pattern, 2026-06-05). Not a deviation.

### References
- Epic 1, Story 1.4 ACs [Source: _bmad-output/planning-artifacts/epics/epic-1-platform-foundation-local-dev-environment.md#story-14-dev-authentication-shim]
- Provider abstractions + token-flow + Cognito decisions [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#authentication--security, #local-development--provider-abstractions-added-2026-06-05]
- Naming/format/enforcement + frontend auth-flow patterns [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#format-patterns, #process-patterns, #enforcement-rules]
- Named file structure (security.py / cognito_client.py / auth.py) the provider supersedes [Source: _bmad-output/planning-artifacts/architecture/project-structure-boundaries.md#velara-api]
- SEC-06 auth requirement; Part 11 access/authority; user personas [Source: _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/Velara-PRD-full.md §FR-SEC-06, §FR-SEC-11, §Users]
- Provider pattern precedent + reserved AUTH_BACKEND [Source: _bmad-output/implementation-artifacts/stories/1-3-local-dev-environment-and-provider-abstractions.md]
- Token-isolation + login-redirect deferred items this story resolves [Source: _bmad-output/implementation-artifacts/deferred-work.md — "Deferred from: code review of 1-2", bullets 2 & 8 (Story 1-4)]
- Existing seams: config, dependencies, exceptions, middleware, router, health [Source: velara-api/app/core/{config,dependencies,exceptions,middleware}.py, app/api/v1/{router,health}.py]
- Frontend seams: auth boundary, axios client, login stub, route guards, role store [Source: velara-web/src/shared/utils/auth.ts, src/api/client.ts, src/pages/LoginPage.tsx, src/routes/*, src/stores/useRoleStore.ts]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

No blocking issues. One test fix: tampered-signature test replaced char-flip (probabilistically non-deterministic) with known-invalid signature segment replacement.

### Completion Notes List

- T1: Added `pyjwt==2.10.1` to pyproject.toml. Extended `Settings` with JWT fields (JWT_ALGORITHM, JWT_ACCESS_TTL_MINUTES, JWT_ISSUER, JWT_AUDIENCE) and CORS_ALLOW_ORIGINS. Fixed stale AUTH_BACKEND comment. Fail-fast validator preserved.
- T2: Created `app/integrations/auth.py` — AuthPrincipal (frozen dataclass), AuthProvider (Protocol), DevAuthProvider (HS256 + seed users), CognitoAuthProvider (documented NotImplementedError stub), InvalidTokenError (VelaraBaseException subclass, ERROR_CODE="UNAUTHORIZED"), get_auth_provider() lru_cache factory. Structural variance from architecture documented.
- T3: Extended `app/core/dependencies.py` with get_current_user() using HTTPBearer(auto_error=False) + VelaraHTTPException on missing/invalid token; exported CurrentUser type alias.
- T4: Created `app/api/v1/auth.py` with POST /api/v1/auth/login (dev-only), GET /api/v1/auth/me (CurrentUser proof endpoint), GET /api/v1/auth/dev-users (404s when AUTH_BACKEND!=dev). Mounted in router.py. Added CORSMiddleware to main.py with CORS_ALLOW_ORIGINS setting (explicit list, not wildcard, allow_credentials=True).
- T5: Updated velara-api/.env.example with JWT vars + CORS. Confirmed velara-web/.env.example VITE_API_URL documented.
- T6: Rewrote src/shared/utils/auth.ts as the single auth boundary: getToken, getCurrentUser, setSession, clearSession, isAuthenticated, login (uses fetch directly to avoid circular import with client.ts), logout. Preserved _mockAuthSession/_clearAuthSession test helpers writing velara_session key.
- T7: Updated src/api/client.ts to source token/clear via getToken()/clearSession() from auth.ts. Fixed circular-import risk by using fetch in auth.ts for login endpoint.
- T8+T9: Rebuilt src/pages/LoginPage.tsx — fetches seed users from /api/v1/auth/dev-users, shows picker (dropdown) or text input (fallback), calls auth.login(), fixes deferred redirect bug (path+search+hash, guards against from=='/login'), sets useRoleStore from identity role (client→'client', others→'internal').
- T10: Backend — 13 unit tests (test_auth_factory.py) + 11 integration tests (test_auth.py), all pass. Frontend — 16 auth.ts unit tests + 7 LoginPage tests, all pass. Route regression (internal.test.tsx + client.test.tsx) still green.
- T11: ruff clean, pytest 53 passed + 5 skipped (no regressions), tsc 0 errors, eslint clean, npm run build clean, npm run test 32/32.

### File List

**New files:**
- velara-api/app/integrations/auth.py
- velara-api/app/api/v1/auth.py
- velara-api/tests/unit/integrations/test_auth_factory.py
- velara-api/tests/integration/api/test_auth.py
- velara-web/src/shared/utils/auth.test.ts
- velara-web/src/pages/LoginPage.test.tsx

**Modified files:**
- velara-api/pyproject.toml (pyjwt dependency)
- velara-api/app/core/config.py (JWT + CORS settings, stale comment fix)
- velara-api/app/core/dependencies.py (get_current_user + CurrentUser)
- velara-api/app/api/v1/router.py (mount auth router)
- velara-api/app/main.py (CORSMiddleware)
- velara-api/.env.example (JWT/CORS vars)
- velara-web/src/shared/utils/auth.ts (full boundary rewrite)
- velara-web/src/api/client.ts (token via auth.ts)
- velara-web/src/pages/LoginPage.tsx (working dev login)

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-09 | Story created. Context-engine analysis against Stories 1.1–1.3 (done), architecture provider-abstraction + auth decisions, PRD SEC-06/Part-11, and the live velara-api/velara-web seams. Surfaced two cross-cutting requirements beyond the epic ACs: CORS middleware (first browser→API call) and preserving the `_mockAuthSession` test helpers. |
| 2026-06-09 | Story implemented. AuthProvider abstraction + DevAuthProvider (HS256 dev-JWT) + CognitoAuthProvider stub. CurrentUser dependency seam. Auth router with login/me/dev-users endpoints. CORSMiddleware added. Frontend auth.ts boundary rewrite (token+user storage, login via fetch, logout). client.ts re-pointed. LoginPage rebuilt with seed-user picker, redirect-bug fix, role-store wiring. 53 backend + 32 frontend tests pass, ruff + tsc + eslint + build all clean. |

## Review Findings

_Adversarial code review (Blind Hunter + Edge-Case Hunter + Acceptance Auditor), 2026-06-09. All 6 ACs verified MET. 0 decision-needed, 4 patch, 6 deferred, 8 dismissed as noise._

- [x] [Review][Patch] `login()` throws raw TypeError on a 200 response with a malformed/empty body — boundary contract claims it only throws "Authentication failed.", but `const { token, user } = body.data` on `{}`/`null`/non-JSON crashes and is masked as "Invalid username." Guard the shape. [velara-web/src/shared/utils/auth.ts:286-301]
- [x] [Review][Patch] `DevAuthProvider` signs/verifies with `settings.JWT_ALGORITHM` (free `str`) rather than pinning HS256 — its own docstring calls it "the HS256 dev-JWT shim". If `JWT_ALGORITHM=RS256` is set with `AUTH_BACKEND=dev`, it would use `SECRET_KEY` as an RS256 key (algorithm-confusion surface) and fail at request time. Pin HS256 in the provider. [velara-api/app/integrations/auth.py:1100-1125]
- [x] [Review][Patch] CORS middleware-ordering comment is factually backwards — Starlette runs the *last*-added middleware outermost, so `RequestIDMiddleware` (added last) wraps CORS, the opposite of what the comment asserts. Behavior is correct; the misleading comment invites a future regression. Fix the comment. [velara-api/app/main.py:813-816]
- [x] [Review][Patch] Stale "auth is wired in Story 1.5" reference left in the health docstring (renumber drift; flagged in T4). Health stays public regardless — just correct the comment. [velara-api/app/api/v1/health.py:6]
- [x] [Review][Defer] `get_auth_provider()` `@lru_cache` has no cache-invalidation seam — fine for immutable boot-time config (matches the secrets/storage provider pattern), but the Cognito swap (Story 7.3) and any hot-reload will need `cache_clear()`. [velara-api/app/integrations/auth.py:1171] — deferred, Story 7.3 concern
- [x] [Review][Defer] CORS omits `expose_headers=["X-Request-ID"]`, so the browser cannot read the response trace id. Frontend only *sends* it today, so non-breaking. [velara-api/app/main.py:817-823] — deferred, trace-surfacing enhancement
- [x] [Review][Defer] `validate_token` passes no `leeway=` — zero clock-skew tolerance. Moot for the single-process dev shim; matters for distributed Cognito validation. [velara-api/app/integrations/auth.py:1119-1125] — deferred, Story 7.3 concern
- [x] [Review][Defer] Post-login `navigate(from)` target is unvalidated beyond the `/login` guard — no allow-list against external/malformed paths (open-redirect-style). Low risk: `from` is set internally by RequireAuth. [velara-web/src/pages/LoginPage.tsx:89-96] — deferred, hardening
- [x] [Review][Defer] Request-id interceptor's `crypto.randomUUID?.()` guards a missing *method* but not a missing global `crypto` object (insecure context / JSDOM). [velara-web/src/api/client.ts:20] — deferred, pre-existing (not changed by this story)
- [x] [Review][Defer] LoginPage `dev-users` fetch ignores HTTP status (no `r.ok` check) — a 500 is indistinguishable from an empty seed list; works today only via the `?? []` fallback. [velara-web/src/pages/LoginPage.tsx:99-105] — deferred, non-breaking robustness
