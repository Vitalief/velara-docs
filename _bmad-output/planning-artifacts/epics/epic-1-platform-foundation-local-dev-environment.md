# Epic 1: Platform Foundation & Local Dev Environment

Developers can initialize and run the full platform **locally** — FastAPI + Celery + Redis + PostgreSQL + local object storage — with provider abstractions that make the eventual swap to AWS a configuration change, not a rewrite. Authentication runs against a local dev-auth shim that issues the same JWT claims contract Cognito will later provide. HIPAA controls (PHI sanitizer, S3-key-reference pattern, append-only audit, structured logging) are present in the application from the first commit. **Real AWS provisioning, CI/CD, Cognito, and cloud observability are delivered later in Epic 7 (Infrastructure, Deployment & Cloud Auth)** — this epic deliberately removes the AWS-account dependency from the critical path so feature work (Skill Registry, Execution) can proceed before the client provisions AWS and GitHub.

> **Sequencing note (2026-06-05):** Epics were originally infrastructure-first ("all infra in place from day one"). Because the client's AWS account and GitHub repos are not yet provisioned, the cloud-provisioning stories (originally 1.3 CI/CD-infra, 1.4 CI/CD, 1.5 Cognito, 1.6 cloud observability) were relocated to **Epic 7**, and this epic was rescoped to deliver a fully local-runnable foundation. See `sprint-change-proposal-2026-06-05.md`.

## Story 1.1: velara-api Project Scaffold

As a developer,
I want a fully scaffolded FastAPI project with core middleware stack, database connection, and Celery worker setup,
So that all subsequent API work starts from a consistent, production-ready foundation with HIPAA controls enforced from line one.

**Acceptance Criteria:**

**Given** the velara-api repository is initialized
**When** I run `docker-compose up`
**Then** the FastAPI app starts on port 8000, Celery worker starts and connects to Redis, and PostgreSQL is reachable

**Given** the app is running
**When** I call `GET /health`
**Then** I receive `{"status": "ok"}` with HTTP 200

**Given** the app is running
**When** I call `GET /health/ready`
**Then** readiness status confirms DB and Redis connections are both healthy

**Given** any API request is made
**When** the request is processed
**Then** a UUID `request_id` is assigned, logged via structlog with `request_id` and `duration_ms`, and returned in the response `meta` envelope as `{"data": {...}, "meta": {"request_id": "...", "timestamp": "..."}}`

**Given** any log is written
**When** the log entry is emitted
**Then** the PHI sanitizer middleware has run — no field matching email, MRN, or free-text name patterns appears in the log output

**Given** an unhandled exception occurs in any route
**When** the exception propagates to the global error handler
**Then** the response is `{"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred.", "request_id": "..."}}` with HTTP 500 — no stack trace or raw exception message returned to caller

**Given** the Alembic migration environment is configured
**When** I run `alembic upgrade head`
**Then** the initial migration runs without error and `alembic_version` table exists in the database

**Given** `pyproject.toml` is configured
**When** I run `ruff check .` and `pytest`
**Then** no lint errors and all tests pass (test suite includes at least one health check integration test)

---

## Story 1.2: velara-web Project Scaffold

As a developer,
I want a fully scaffolded Vite + React + TypeScript project with routing, design tokens, global providers, and Sentry wired in,
So that all subsequent frontend work starts from a consistent base with the correct design system and observability from the first commit.

**Acceptance Criteria:**

**Given** the velara-web repository is initialized
**When** I run `npm run dev`
**Then** the app starts on port 5173 and renders without console errors

**Given** an unauthenticated user visits any route under `/internal/*` or `/client/*`
**When** React Router evaluates the route
**Then** they are redirected to `/login` — `RequireAuth` wrappers are in place on both route trees

**Given** the app loads for an authenticated internal user
**When** the AppBar renders
**Then** it shows the "Velara · A Vitalief Skills Platform" wordmark, a role switcher (Vitalief team ↔ Client portal), and the horizontal nav tab strip with Engagements as the active default tab

**Given** `tailwind.config.ts` is configured
**When** I inspect it
**Then** the evergreen color palette, Georgia/Calibri typography scale, spacing scale, and shadow tokens from `design/styles_v2.css` are correctly mapped as Tailwind theme extensions

> 🎨 **Re-themed by Story 1.6 (2026-06-09):** the V3 Vitalief brand palette (teal/navy/slate/pink) and Poppins/Open Sans typography from `design/styles_v3.css` supersede the evergreen/Georgia tokens above. This AC records the original scaffold as-built; Story 1.6 re-ports the tokens.

**Given** a JavaScript error is thrown in any component
**When** the `ErrorBoundary` catches it
**Then** Sentry captures it with the PHI `before_send` sanitizer applied, and the user sees a fallback error UI — no raw error details exposed

**Given** `npm run build` is run
**Then** the build completes without errors and produces a valid `dist/` directory

**Given** `npm run typecheck` is run
**Then** zero TypeScript errors are reported

---

## Story 1.3: Local Dev Environment & Provider Abstractions

As a developer,
I want storage and secrets behind provider interfaces with local backends, and a docker-compose stack that runs the whole platform without any AWS account,
So that Skill Registry and Execution can be built and tested locally now, and the later switch to AWS is a configuration change rather than a rewrite.

**Acceptance Criteria:**

**Given** the `StorageProvider` interface is defined (`put`, `get`, `presign_upload`, `presign_download`, `delete`)
**When** the app boots with `STORAGE_BACKEND=local`
**Then** a `LocalStorage` implementation backed by MinIO/LocalStack S3-compatible storage is wired in; with `STORAGE_BACKEND=s3` an `S3Storage` implementation is selected — no calling code changes between the two

**Given** all file handling uses the `StorageProvider`
**When** any file is ingested or generated
**Then** only the object key + metadata travels through the system (S3-key-reference pattern) — file content is never stored inline in the database or passed inline through services

**Given** the `SecretsProvider` interface is defined (`get_secret`)
**When** the app boots with `SECRETS_BACKEND=env`
**Then** an `EnvSecretsProvider` reads from environment variables / a local `.env`; with `SECRETS_BACKEND=aws` a `SecretsManagerProvider` is selected — credential consumers are unchanged

**Given** I run `docker-compose up`
**When** the stack starts
**Then** FastAPI, Celery worker, Redis, PostgreSQL, and a MinIO/LocalStack object store all start; the `ingest` and `output` buckets are auto-created by a bootstrap step

**Given** `.env.example` is provided
**When** a new developer copies it to `.env`
**Then** it documents every backend switch (`STORAGE_BACKEND`, `SECRETS_BACKEND`, `AUTH_BACKEND`) with local defaults and the AWS values commented for Epic 7

**Given** the provider selection is configuration-driven
**When** Epic 7 provisions real AWS
**Then** switching to AWS backends requires only environment/config changes — no changes to `services/`, route handlers, or worker tasks

---

## Story 1.4: Dev Authentication Shim

As a developer,
I want a local authentication provider that issues and validates JWTs with the same claims contract Cognito will use,
So that role-scoped features (registry visibility, route guards) work locally now and the production Cognito swap is isolated to one provider.

**Acceptance Criteria:**

**Given** the `AuthProvider` interface is defined (`issue_token`, `validate_token` → `user_id`, `org_id`, role claims)
**When** the app boots with `AUTH_BACKEND=dev`
**Then** a `DevAuthProvider` issues signed JWTs carrying `user_id`, `org_id`, and a role claim identical in shape to the Cognito token contract; with `AUTH_BACKEND=cognito` a `CognitoAuthProvider` validates against the Cognito JWKS endpoint (implemented in Epic 7, Story 7.3)

**Given** seed dev users exist across roles (MA Tech, consultant, client)
**When** I log in locally at `/login` with a seed user
**Then** a JWT is issued, I am redirected to `/internal/engagements`, and the role switcher reflects my role

**Given** a valid dev JWT is present in a request
**When** FastAPI processes it
**Then** the same dependency that will later validate Cognito tokens extracts `user_id` and `org_id` and allows the request — the validation seam is provider-agnostic

**Given** a request arrives with an expired or invalid JWT
**When** the auth dependency validates the token
**Then** the request is rejected with HTTP 401 and `{"error": {"code": "UNAUTHORIZED", "message": "Authentication required.", "request_id": "..."}}`

**Given** the frontend `auth.ts` boundary is the single place that talks to the auth provider
**When** Epic 7 swaps `DevAuthProvider` for Amplify/Cognito
**Then** no route component or API hook changes — the swap is contained to `auth.ts` and the API client's token source (resolving the `deferred-work.md` note on token-storage isolation)

**Given** role-based registry visibility (Epic 2, Story 2.4) is built
**When** a user with a given role views the Skill Registry
**Then** the dev-auth role claim drives what they see — proving the auth seam end-to-end before Cognito lands

---

## Story 1.5: Per-Route Browser Tab Title

As a Vitalief user with several Velara tabs open,
I want the browser tab title to reflect the current page (and entity, where applicable),
So that I can tell my open tabs apart at a glance instead of seeing a generic label.

> Added 2026-06-08 (see `sprint-change-proposal-2026-06-08.md`). App-shell behavior — static page titles can be done now; dynamic entity-name titles (Project/Study/Location) wire in as the Epic 4 screens land.

**Acceptance Criteria:**

**Given** the velara-web app shell is running
**When** I navigate to any top-level page
**Then** `document.title` is set to `"{Page} · Velara"` (e.g., `Skill Registry · Velara`, `Certification · Velara`, `Audit Log · Velara`, `Usage & Value · Velara`) — replacing the generic "Velara" label from the Story 1.2 scaffold

**Given** I navigate to a hierarchy entity detail (Project, Study, or Location)
**When** the entity has loaded
**Then** the title is `"{Entity Name} · {Type} · Velara"` (e.g., `Protocol Feasibility · Study · Velara`) so multiple entity tabs are distinguishable

**Given** an entity detail is still loading
**When** the name is not yet available
**Then** the title falls back to `"{Type} · Velara"` (e.g., `Study · Velara`) — never blank or stale

**Given** the title is set per route
**When** React Router transitions between routes
**Then** the title updates on every navigation via one shared mechanism (e.g., a `useDocumentTitle` hook or router-level effect) — not duplicated ad-hoc per page

**Given** the client portal (`/client/*`)
**When** a client user navigates
**Then** titles follow the same pattern scoped to client-visible pages — no internal-only labels leak into the client tab title

---

## Story 1.6: Apply Vitalief V3 Brand Theme

As a developer,
I want the platform's design tokens re-mapped to the Vitalief V3 brand (from the client's brand guidelines),
So that every screen built from here on uses the correct brand colors and fonts.

> Added 2026-06-09 (see `sprint-change-proposal-2026-06-09.md`). Source: client `design/uploads/Brand Colors.png` → `design/styles_v3.css` / `design/app_v3.jsx`. Re-themes the Story 1.2 scaffold (done); no feature screens exist yet, so this is a low-risk token swap done before Epic 2 UI.

**Acceptance Criteria:**

**Given** `src/index.css` (Tailwind v4 `@theme`) is updated from `design/styles_v3.css`
**When** I inspect the tokens
**Then** the Vitalief brand palette is mapped — primary teal `#128F8B`, ink navy `#323843`, slate `#4C5270`, pink `#F652A0` accent, danger `#d4186c` — replacing the evergreen values (rename `--green-*` tokens to `--brand-*` for clarity)

**Given** the typography tokens are updated
**When** I inspect the font setup
**Then** headings use **Poppins**, body uses **Open Sans**, mono stays IBM Plex Mono — self-hosted (no third-party CDN, per Story 1.2's HIPAA decision); the Georgia/Source-Sans tokens are removed

**Given** Vitalief has not yet provided licensed **Nexa** font files (the brand-exact heading font)
**When** the theme is applied
**Then** Poppins is used for headings as the approved stand-in; swapping in Nexa later is a font-file + token change only

**Given** the AppBar and nav chrome render
**When** I view the app
**Then** the AppBar is the navy/teal brand bar and the active nav tab is underlined in brand teal (per UX-DR-02/03)

**Given** the re-theme is complete
**When** I run `npm run build` and `npm run typecheck`
**Then** both pass, the running app visually matches `design/Velara v3.html`, and no evergreen / Georgia / Source-Sans tokens remain in `src/index.css`

**Dependencies:** Optional — Nexa XBold/Regular font files from Vitalief (brand asset, per PRD A5) for exact-match headings. [Source: `design/styles_v3.css`, `design/app_v3.jsx`, `design/uploads/Brand Colors.png`]

---
