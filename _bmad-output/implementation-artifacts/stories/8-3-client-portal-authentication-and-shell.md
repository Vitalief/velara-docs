---
baseline_commit: 8e9445fbfaaebea7c480af984021dcd6fd684f30
---

# Story 8.3: Client Portal Authentication & Shell

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **client engagement lead or clinical ops director**,
I want **to log in to the client portal and see a clean interface scoped to my engagement**,
so that **I can access my assigned skills without seeing any Vitalief internal tools or methodology**.

## Acceptance Criteria

1. **(AC1 — Login redirect)** **Given** a client user navigates to `/login` **When** they authenticate via Cognito with their client-scoped credentials **Then** they are redirected to `/client/dashboard` — not `/internal/*`.

2. **(AC2 — Client shell branding, no role switcher)** **Given** a client user is logged in **When** the app renders **Then** the role switcher is **not** visible; the client AppBar shows "Velara · A Vitalief Skills Platform" **and** the client's assigned engagement name (the granted Client/Project name).

3. **(AC3 — Internal routes inaccessible to clients)** **Given** a client user attempts to navigate to any `/internal/*` route **When** the route guard evaluates their role **Then** they are redirected to `/client/dashboard` — internal routes are inaccessible. *(Symmetric corollary: an internal user hitting `/client/*` is redirected to `/internal/engagements`.)*

4. **(AC4 — Engagement-scoped visibility)** **Given** a client user's session is valid **When** they view the portal **Then** they see only the Clients and Projects they have been granted access to — no other engagement data is visible.

### Definition of Done (gates — must all pass before `done`)

- All 4 ACs satisfied and covered by tests.
- Backend: `GET /api/v1/client/engagements` returns the caller's granted Clients/Projects via an **IP-safe schema** (zero `org_id` / `hierarchy_path` / internal-metadata fields). Run with `docker compose exec -e AUTH_BACKEND=dev api pytest ...` (see Constraint C1).
- Frontend: `npm run test` green (vitest); existing **title-isolation test** (`client.test.tsx:39-55`) and **AppBar sub-label test** (`AppBar.test.tsx:23-27`) still pass and are extended for the new screens.
- `ruff check` + `ruff format` clean (backend); no TypeScript errors (frontend).
- No internal label, role switcher, ⌘K palette, or "M. Maxwell" user card reachable from any `/client/*` route.

---

## Tasks / Subtasks

> Sequence: **Backend endpoint first** (FE hooks depend on its contract), then **FE auth/routing**, then **FE shell**, then **tests**. The grant model (8.1) and the `/api/v1/client` router (8.2) already exist and are `done` — this story extends them, it does not create them.

### Backend

- [x] **Task 1 — Add `GET /api/v1/client/engagements` read endpoint (AC2, AC4)**
  - [x] 1.1 Add an IP-safe response schema. Create `velara-api/app/schemas/client.py` (NEW) with `ClientEngagementProject` (`project_id: uuid.UUID`, `project_name: str`) and `ClientEngagement` (`client_id: uuid.UUID`, `client_name: str`, `projects: list[ClientEngagementProject]`) and `ClientEngagementsData` (`engagements: list[ClientEngagement]`). **DO NOT** reuse `ClientRead`/`ProjectRead` from `schemas/hierarchy.py` — they expose `org_id` + `hierarchy_path` (IP leak). Independent `BaseModel`, zero inheritance — mirror the 8.2 `ClientJobRead` discipline (`schemas/job.py`).
  - [x] 1.2 Add `GET /api/v1/client/engagements` to `velara-api/app/api/v1/client.py` (the existing 8.2 client router; prefix `/api/v1/client`). Response is `ResponseEnvelope[ClientEngagementsData]`. Depend on `CurrentUser`, `DbSession`, and `HierarchyScope` (the 8.1 `hierarchy_scope` dependency). This is the **first read route** on the client router.
  - [x] 1.3 Implement resolution using the caller's **own** `org_id` (the client's hierarchy lives under its own org — see Constraint C3; there is NO cross-tenant indirection). Step 1: `granted_clients = hierarchy_service.list_clients(session, org_id=user.org_id, scope_paths=scope.scope_paths)`. Step 2: for each granted client, `hierarchy_service.list_projects(session, client_id=client.id, org_id=user.org_id, scope_paths=scope.scope_paths)`. The `<@` containment filter restricts both to the granted slice; an empty `scope_paths` list returns `[]` from these helpers (so the no-grants case naturally yields zero engagements).
  - [x] 1.4 Group results: for each granted Client, nest its granted Projects. **Edge case (must handle):** `<@` is descendant-or-self, so if a user is granted only a **Project** (not its parent Client), `list_clients(scope_paths=[project_path])` will **NOT** return the parent Client (the Client's path is an *ancestor* of the project path, not a descendant). To always resolve the engagement name (AC2), derive the parent Client for every granted project path — load the Client whose `hierarchy_path` is the ancestor prefix of the project path (or query the project's `client_id` FK and `get_client`). Build the engagement tree from the **union** of directly-granted Clients and the parent Clients of granted Projects. Map ORM → IP-safe schema (name + id only).
  - [x] 1.5 Internal tokens (`ma_tech`/`consultant`) calling this route are `unrestricted=True` → `scope.scope_paths` is empty and `unrestricted` is true. **Decide & document:** return an empty `engagements` list for internal callers (they have no grants; the portal is for clients). Do **not** dump the whole org. Add a short comment — the route is client-shaped; internal callers get an empty engagement set, not all engagements.

- [x] **Task 2 — Backend tests for the new endpoint (AC2, AC4)** *(co-locate in `tests/integration/api/test_client_surface.py` — the existing 8.2 test file)*
  - [x] 2.1 Client with a granted Client+Project → 200, response contains exactly that Client name + Project name nested; assert **zero** internal fields (`org_id`, `hierarchy_path`, `description`, `created_at`) anywhere in the body (reuse the 8.2 "no internals" recursive-search assertion pattern).
  - [x] 2.2 Client with **no** grants → 200 with empty `engagements` list (not 403/404).
  - [x] 2.3 Client granted only `client_A` does **not** see `client_B`'s data (seed two clients; grant one; assert the other is absent) — AC4.
  - [x] 2.4 Internal token (`ma_tech`) → 200 with empty `engagements` (per Task 1.5 decision).
  - [x] 2.5 Add the new schema (`ClientEngagementsData`) to the OpenAPI schema-lock test (`test_openapi.py`) — 8.2 established this lock.

### Frontend — Auth & Routing (AC1, AC3)

- [x] **Task 3 — Role-aware route guards (AC3)**
  - [x] 3.1 Add `RequireClient` and `RequireInternal` to `velara-web/src/shared/components/` (alongside the existing `RequireAuth.tsx`). Each composes the existing auth check first (`isAuthenticated()` → `<Navigate to="/login" state={{ from: location }} replace />`), then checks role: `RequireClient` redirects a non-client (internal) user to `/internal/engagements`; `RequireInternal` redirects a client user to `/client/dashboard`. **Keep `RequireAuth`** for the bare auth check they reuse (do not delete it — `internal.tsx`/`client.tsx` currently use it).
  - [x] 3.2 Read role from the established source: `getCurrentUser()?.role` in `auth.ts` (returns `AuthUser` with `{user_id, org_id, role}`) — `role === 'client'` is the client check. Add a small `isClient()` helper to `auth.ts` (`getCurrentUser()?.role === 'client'`) so guards and redirects share one definition (only ad-hoc `user.role === 'client'` checks exist today, in LoginPage). Do **not** rely on the Zustand `useRoleStore` for guarding — it defaults to `'internal'` and is UI state, not the source of truth on hard refresh.
  - [x] 3.3 Wrap the route trees: `velara-web/src/routes/internal.tsx` `InternalRoutes()` swaps `RequireAuth` → `RequireInternal`; `velara-web/src/routes/client.tsx` `ClientRoutes()` swaps `RequireAuth` → `RequireClient`.

- [x] **Task 4 — Role-aware login & root redirect (AC1)**
  - [x] 4.1 `velara-web/src/pages/LoginPage.tsx`: the post-login redirect (lines 31-37 compute `from`; line 47 navigates) is role-blind. Branch on the returned user role: client → `/client/dashboard`; internal → the clamped `from` (default `/internal/engagements`). The `login()` call already returns the `AuthUser` (line 45) and `setRole(...)` is already called (line 46) — reuse that role value; do not re-decode. Clamp `from` so a client deep-linked into `/internal/*` is **not** sent back there (a client's `from` pointing at `/internal` must fall back to `/client/dashboard`).
  - [x] 4.2 `velara-web/src/App.tsx`: the root redirect `/ → /internal/engagements` (line 20) and the already-authenticated `/login` redirect (line 23) are role-blind — a logged-in client landing on `/` double-redirects through `/internal`. Make both role-aware: route to `/client/dashboard` when `isClient()`, else `/internal/engagements`.

### Frontend — Client Shell (AC2)

- [x] **Task 5 — Minimal `ClientAppBar` (AC2)** *(decision: NEW component — do NOT reuse the shared internal `AppBar.tsx`)*
  - [x] 5.1 Create `velara-web/src/features/client-portal/components/ClientAppBar.tsx`. Render: VLogo + "Velara" wordmark + sub-label "A Vitalief Skills Platform" (reuse the exact strings/markup from `AppBar.tsx:278-286` so the sub-label test pattern holds), the engagement name (from the new `/client/engagements` data), and a Log out button (reuse the `logout()` + `navigate('/login')` pattern from `AppBar.tsx:352-360`). **Structurally omit** the role switcher, the ⌘K/search button, the "M. Maxwell"/"MM" user card, the access pill, and the CmdPalette — none of these exist in this component. This makes AC2 compliance structural, not conditional.
  - [x] 5.2 Create `velara-web/src/features/client-portal/components/ClientShell.tsx` — mirrors `InternalShell` (`internal.tsx:43-118` = AppBar + NavTabs + nested `<Routes>`) but **WITHOUT** `NavTabs` and without any internal tools. It renders `<ClientAppBar engagementName={...} />` + the nested client `<Routes>`. (The Dashboard/Studies/Deliverables tabs in the design mockup are **8.4** — see Out of Scope.)
  - [x] 5.3 Use V3 brand tokens already in the Tailwind config (teal `brand-*`, navy/slate `ink`/`ink-2`, Poppins headings / Open Sans body). Match the internal AppBar's dark-bar styling so the brand reads consistently. Do not introduce new raw hex — use the existing Tailwind token classes.

- [x] **Task 6 — Client data layer + dashboard (AC2, AC4)**
  - [x] 6.1 Create `velara-web/src/api/clientPortal.ts` (NEW) — an Axios call (reusing the shared `apiClient` from `api/client.ts`, which already attaches the bearer token + handles 401 refresh) to `GET /api/v1/client/engagements`, returning the `{ data }` envelope's `engagements`. **Do NOT** reuse `api/hierarchy.ts` (`listClients`/`listProjects` → internal `/api/v1/clients`, wrong tenant + 404'd off internal routes for client tokens by the 8.2 `RejectClient` guard).
  - [x] 6.2 Create `velara-web/src/features/client-portal/hooks/useMyEngagements.ts` (NEW) — a TanStack Query hook (`queryKey: ['client', 'engagements']`, `staleTime: 30_000`) consuming `clientPortal.ts`. **Do NOT** reuse `useEngagements.ts` (`useClients`/`useProjects` → internal endpoints).
  - [x] 6.3 Populate `velara-web/src/features/client-portal/types.ts` (currently `export {}`) with `ClientEngagement` / `ClientEngagementProject` TS types (camelCase: `clientId`, `clientName`, `projectName`) mirroring the backend schema.
  - [x] 6.4 Replace the `Placeholder` dashboard in `velara-web/src/routes/client.tsx` (lines 26-29, "Client Portal — Story 7.x") with a real `ClientDashboard` screen under `ClientShell`: it calls `usePageTitle('Dashboard')` (preserve title isolation — Constraint C2), uses `useMyEngagements()`, and renders the granted engagement name(s) + the list of granted Clients/Projects (AC4). Use TanStack Query `isLoading`/`isError` directly (skeleton on load) — no hand-rolled booleans (arch Process Patterns). Fix the stale "Epic 7 (Stories 7.3/7.4)" comment (lines 18-19) → 8.3.

### Frontend — Tests (AC1, AC2, AC3, AC4)

- [x] **Task 7 — FE tests** *(co-located `*.test.tsx`, vitest + Testing Library)*
  - [x] 7.1 `client.test.tsx`: client-role user logging in lands on `/client/dashboard` (AC1); extend the existing title-isolation test (lines 39-55) to the new dashboard screen — assert no `Skill Registry`/`Audit Log`/`Access Control`/`Engagements` leak. Mock `useMyEngagements` (or the API) so the dashboard renders deterministically.
  - [x] 7.2 Route-guard tests: a client token hitting an `/internal/*` route → redirected to `/client/dashboard` (AC3); an internal token hitting `/client/*` → redirected to `/internal/engagements` (AC3 corollary). (Mirror `internal.test.tsx:128-138` redirect-test style; seed the role via `getCurrentUser()` — i.e. set `velara_user` in sessionStorage, not just the token, since the test helper `_mockAuthSession` sets token only.)
  - [x] 7.3 `ClientAppBar.test.tsx` (NEW, co-located): renders "Velara" + "A Vitalief Skills Platform" + the engagement name; asserts **no** role switcher ("Vitalief team"/"Client portal" buttons absent), **no** "Search"/⌘K, **no** "M. Maxwell" (AC2).
  - [x] 7.4 `LoginPage.test.tsx`: extend the existing client-role test (lines 125-137 already assert `setRole('client')`) to also assert navigation to `/client/dashboard` (currently the suite only checks `/internal/engagements` for the default path).

---

### Review Findings

_Code review 2026-07-01 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 4 ACs, all DoD gates, and C1–C6 verified functionally SATISFIED by the Auditor; findings below are correctness gaps + hardening. 18 raw findings → 5 patch, 2 defer, 1 decision, 9 dismissed (false positives / verified-handled)._

_**All 6 patches APPLIED + VERIFIED 2026-07-01.** Gates: FE 331 tests ✅ (28 files) + tsc 0 errors + ruff check/format clean; BE engagements 5/5 ✅ in Docker (`AUTH_BACKEND=dev`) + OpenAPI lock 10/10 ✅. Patch #2 (study/location) proven by a red-then-green regression test: the new test FAILS against pre-patch Step-3 logic (SQL shows the project dropped by `<@`) and PASSES with the fix. The 3 remaining `test_client_surface` failures are the pre-existing 8.2 `fk_invocation_jobs_skill_id` DB-state failures documented in the Debug Log — not introduced here. Test helper `_mockAuthSession` updated to seed a default internal `velara_user` (the positive `isInternal()` guard requires it; client.test.tsx overrides with a client user)._

- [x] [Review][Patch] Internal user's `/client/*` deep-link `from` is discarded after login (RESOLVED FROM DECISION 2026-07-01 → patch: clamp internal `from` symmetrically) — APPLIED (LoginPage: `f.pathname.startsWith('/client')` → `/internal/engagements`) — an internal user who deep-links to a `/client/*` URL while unauthenticated gets `state.from=/client/*`; after a successful internal login `LoginPage` navigates to `from`, which `RequireClient` bounces to `/internal/engagements`, silently dropping the intended destination. Fix: mirror the existing client-side clamp — if an internal user's post-login `from` resolves into `/client/*`, fall back to `/internal/engagements` explicitly (don't rely on the guard bounce). Add a test. [src/pages/LoginPage.tsx:44-52, src/shared/components/RequireClient.tsx:14-16] _(edge+auditor)_

- [x] [Review][Patch] Study/location-level grant drops the Project (`projects: []`) — breaks AC4 — APPLIED (client.py Step 3: `project_scope_paths` = each granted path truncated to `segments[:3]`) + regression test [velara-api/app/api/v1/client.py:112-116]
  - CONFIRMED against source. `create_grant` accepts `node_type` ∈ {client, project, **study, location**} (access_service.py:48); Study/Location are real 4-/5-segment ltree nodes. For a grant at `org.clientA.projectZ.studyS`, Step 2 correctly derives the parent Client (`segments[:2]`), but Step 3 calls `list_projects(client_id=clientA, scope_paths=[org.clientA.projectZ.studyS])`. ProjectZ's path (`org.clientA.projectZ`) is an **ancestor** of the study path, so `projectZ <@ studyS` is FALSE → ProjectZ is filtered out → the client is returned with an empty `projects` list despite the user having valid access to a study inside it. The parent-derivation rebuilds only the Client, never the intermediate Project. Fix: derive project-level ancestor paths (truncate each granted path to its `project` segment) for the Step-3 `list_projects` scope filter, mirroring the Step-2 client derivation. _(blind+edge)_

- [x] [Review][Patch] FE route guards conflate unknown/lost role with "internal" — non-`'client'` authenticated user renders internal shell — APPLIED (new positive `isInternal()` in auth.ts; `RequireInternal` sends unknown/lost roles to `/login`) [velara-web/src/shared/components/RequireInternal.tsx:15, src/shared/utils/auth.ts:85]
  - `RequireInternal` only bounces users where `isClient()===true`. Any authenticated user whose role is not exactly `'client'` — a lost/malformed `velara_user` (token survives, user object cleared → `getCurrentUser()` returns null → `isClient()` false), a mis-cased `'Client'`, or a future external role — falls through to the internal shell (AppBar, NavTabs, role switcher, ⌘K, "M. Maxwell"). Backend `reject_client` allowlist means API calls still 404, so this is internal-chrome exposure, not data exposure — but it's an asymmetric guard (FE denylists `'client'`; BE allowlists internal roles). Fix: add a positive `isInternal()` (role ∈ {ma_tech, consultant}) and gate `RequireInternal` on it, so unknown/lost roles fall to `/login`, not the internal shell. _(blind+edge)_

- [x] [Review][Patch] `ClientAppBar` shows only the first engagement's name for multi-engagement clients — APPLIED (ClientShell: 1 engagement → client name; >1 → "N engagements"; 0 → undefined) [velara-web/src/features/client-portal/components/ClientShell.tsx:13]
  - `data?.engagements[0]?.clientName` arbitrarily picks the first engagement (ordered by `Client.created_at`). A client granted access to ≥2 distinct Clients — a case the endpoint's `client_map` and the dashboard's `engagements.map(...)` both support — sees the whole portal mislabeled with one arbitrary engagement's name. Fix: show a multi-engagement affordance (e.g. count/generic label when >1) or pass the resolved context down rather than truncating to `[0]`. _(blind+edge)_

- [x] [Review][Patch] No test for the study/location grant path or the `len(segments)>=3` parent-derivation branch — APPLIED (`test_engagements_study_level_grant_resolves_client_and_project`: grants at study level, asserts parent client name resolves AND project surfaced; verified red-then-green) [velara-api/tests/integration/api/test_client_surface.py]
  - Every 8.3 engagement test seeds `node_type="client"` grants only, so the entire project-only / study / location derivation logic (Task 1.4's raison d'être) is never executed. Pairs with the study/location patch above — add a test that grants a client user at project level (parent-client-name resolves) and at study/location level (project still surfaced). _(auditor+edge)_

- [x] [Review][Patch] `ClientAppBar` logout has no error handling — APPLIED (`try { await logout() } finally { navigate('/login') }`) [velara-web/src/features/client-portal/components/ClientAppBar.tsx:39]
  - `onClick={async () => { await logout(); navigate('/login') }}` — if `logout()` (Amplify `signOut`) rejects, `navigate('/login')` never runs, leaving the user stranded on the portal with an unhandled rejection. Fix: `try/finally` so the navigate always fires (mirror the internal AppBar's logout handling). _(blind)_

- [x] [Review][Defer] Engagements endpoint is unbounded (no pagination + N+1 `list_projects`) [velara-api/app/api/v1/client.py:109-131] — deferred, pre-existing (inherits the org-wide `list_clients`/`list_projects` no-LIMIT design shared across the hierarchy service).

- [x] [Review][Defer] Stale-grant vs no-grant empty list is indistinguishable (support diagnosability) [velara-api/app/api/v1/client.py, app/services/access_service.py:207-216] — deferred, pre-existing (rooted in 8.1 `resolve_scope_paths` fail-closed drop-of-stale-paths; correct security-wise, just unobservable).

---

## Dev Notes

### What this story is (and is not)

8.3 delivers the **client portal shell + auth/routing + the one read endpoint the shell needs** — it is **NOT** FE-only. The crux: AC2's engagement name and AC4's granted-Clients/Projects list are data **not in the JWT** and **not reachable by any existing client endpoint** (the 8.2 `RejectClient` guard 404s client tokens off the internal `/api/v1/clients` route), so a small backend read route on the existing client router is required. The grant model resolves entirely within the client's own org — no cross-tenant logic (see C3). Skill discovery/listing, the client run/invoke UI, the visibility filter, and the Dashboard/Studies/Deliverables nav tabs from the design mockup are all **Story 8.4** — keep them out.

### Dependencies (already DONE — extend, don't rebuild)

- **Story 8.1 (RBAC foundation, `done`)** provides the `UserAccessGrant` model + the `hierarchy_scope` FastAPI dependency. `HierarchyScope` resolves the caller's granted ltree paths into `HierarchyScopeValue(scope_paths, unrestricted)`. Internal roles (`ma_tech`/`consultant`) are `unrestricted=True` with empty `scope_paths`; client tokens get their actual granted paths. `access_service.resolve_scope_paths(session, user_id, org_id)` is the resolver. [Source: stories/8-1-hierarchy-scoped-rbac-enforcement.md; architecture/core-architectural-decisions.md#authorization-internal-roles-are-org-global-operators]
- **Story 8.2 (IP client surface, `done`)** provides the `/api/v1/client` router (`velara-api/app/api/v1/client.py`, prefix `/api/v1/client`) with **only** `POST /invocations/{skill_id}` + `GET /jobs/{job_id}` today, the `RejectClient` 404 guard on all 8 internal routers, and the IP-safe-schema discipline (`ClientJobRead` — independent `BaseModel`, zero internals). Your new read route lands on **this** router. [Source: stories/8-2-ip-protection-client-api-surface-enforcement.md]
- **Story 7.3 (Cognito, `done`)** provides the role claim in the JWT (`custom:role` → `AuthUser.role`) and the FE `auth.ts` `login()`/`getCurrentUser()`/`logout()` boundary + Amplify token refresh. [Source: auth.ts]

### Source tree — current state of files this story touches

**Backend (velara-api):**

| File | State | What it does today / what to change |
|------|-------|-------------------------------------|
| `app/api/v1/client.py` | UPDATE | 8.2 client router, prefix `/api/v1/client`. Has `POST /invocations/{skill_id}` (`client.py:53-83`) + `GET /jobs/{job_id}` (`client.py:89-183`). Both use `ResponseEnvelope` + IP-safe schemas; the jobs route already calls `scope.assert_in_scope(...)` (`client.py:115`). **Add** `GET /engagements`. No `require_client` inverse guard exists — internal tokens may also call this router (intentional per 8.2, `client.py:7`); handle internal callers per Task 1.5. |
| `app/api/v1/router.py` | no change | `client.router` already mounted (`router.py:30`). New route is on the same router → auto-registered. |
| `app/schemas/client.py` | NEW | IP-safe client engagement schemas. |
| `app/schemas/hierarchy.py` | READ-ONLY ref | `ClientRead` (`:42-51`) + `ProjectRead` (`:84-93`) expose `org_id` + `hierarchy_path` → **do NOT** return these to clients. Model your new schema on the fields you need (id + name), not on these. |
| `app/services/hierarchy_service.py` | reuse | `list_clients(session, org_id, scope_paths=None)` (`:200-213`) and `list_projects(session, client_id, org_id, scope_paths=None)` (`:296-312`, note: needs `client_id` and self-scope-guards via `get_client`) apply the `hierarchy_path <@ ANY(CAST(:paths AS ltree[]))` scope filter; **empty `scope_paths` list → returns `[]`** (important for the no-grants case). Pass the caller's **own** `user.org_id` (see C3 — no cross-org). |
| `app/services/access_service.py` | reuse | `resolve_scope_paths(...)` (`:143-217`) returns granted ltree path strings (batch-resolved; no caching — AC5 of 8.1). The `HierarchyScope` dep already calls this; you get the result via `scope.scope_paths`. |
| `app/models/hierarchy.py` | READ-ONLY ref | `Client` (`:56-80`): `id, org_id, name, description, hierarchy_path, created_at, updated_at`. `Project` (`:83-110`): `id, client_id, name, description, hierarchy_path, ...`. |
| `app/core/dependencies.py` | reuse | `HierarchyScope` type alias (`:167`), `HierarchyScopeValue` (`:109-145`: `scope_paths`, `unrestricted`, `in_scope()`, `assert_in_scope()`), `reject_client`/`RejectClient` (`:170-193`, raises 404 `NOT_FOUND`), `_INTERNAL_ROLES = {"ma_tech","consultant"}` (`:106`). |
| `app/schemas/common.py` | reuse | `ResponseEnvelope[T]` (`data` + `meta`), `ResponseMeta` (`request_id`, `timestamp`), `PageMeta` (`total`, `page`, `per_page`). Use `ResponseEnvelope`. Pagination is **optional** for engagements (a client has few) — skip `PageMeta` unless trivially added; if added, follow the `page`/`per_page` shape (arch Format Patterns). |
| `tests/integration/api/test_client_surface.py` | UPDATE | 8.2's 16 tests + helpers. `_auth_headers(role)` + `_custom_headers(user_id, org_id, role)` issue dev-JWTs; `access_service.create_grant(session, user_id, node_id, node_type, role="client", org_id, granted_by_user_id)` seeds grants (`test_client_surface.py:284-292`); constants `_CLIENT_ORG="org_client_001"`, `_INTERNAL_ORG="org_vitalief"`, `_CLIENT_USER_ID="usr_003_client"`. Add the new endpoint's tests here. |
| `tests/integration/api/test_openapi.py` | UPDATE | Add the new schema to the OpenAPI lock. |

**Frontend (velara-web):**

| File | State | What it does today / what to change |
|------|-------|-------------------------------------|
| `src/App.tsx` | UPDATE | Mounts `/internal/*`→`<InternalRoutes/>` (`:25`), `/client/*`→`<ClientRoutes/>` (`:26`). `/`→`/internal/engagements` (`:20`) and authed `/login`→`/internal/engagements` (`:23`) are **role-blind** → make role-aware (Task 4.2). |
| `src/routes/client.tsx` | UPDATE | `ClientRoutes()` wraps `RequireAuth` (`:23`) → swap to `RequireClient`. Only an index→`dashboard` redirect + a `Placeholder` dashboard saying "Client Portal — Story 7.x" (`:26-29`, stale comment `:18-19`). Replace with `ClientShell` + real `ClientDashboard`. |
| `src/routes/internal.tsx` | UPDATE | `InternalRoutes()` wraps `RequireAuth` (`:122`) → swap to `RequireInternal`. `InternalShell` (`:43-118`) = AppBar + NavTabs + nested Routes (the shape `ClientShell` mirrors, minus NavTabs). |
| `src/shared/components/RequireAuth.tsx` | KEEP + ADD | Auth-only guard (`:1-15`, `isAuthenticated()` → `/login` with `state.from`). Keep it; add `RequireClient.tsx` + `RequireInternal.tsx` beside it that compose it then check role. |
| `src/shared/utils/auth.ts` | UPDATE | `AuthUser` = `{user_id, org_id, role}` (`:29-33`). `getCurrentUser()` (`:47-54`) reads `velara_user` from sessionStorage. `login()` (`:113-148`) returns `AuthUser`. `getToken()`/`isAuthenticated()` (`:38-82`). **Add** `isClient()` helper. No role helpers exist today. |
| `src/pages/LoginPage.tsx` | UPDATE | Email + password fields present (`:78,:93`). Post-login `from` computed role-blind (`:31-37`), `setRole(user.role==='client'?'client':'internal')` already called (`:45-46`), navigate at `:47`. Failures all map to "Invalid username or password." (`:48-51`). Session-expired banner on `?reason=expired` (`:65-69`). **Branch the post-login redirect on role** (Task 4.1). |
| `src/shared/components/AppBar.tsx` | READ-ONLY ref | Shared internal bar. Sub-label "A Vitalief Skills Platform" (`:284-286`). Role switcher (`:305-324`, "Vitalief team"/"Client portal"). Internal-only search/⌘K (`:290-303`, gated `role==='internal'`). "M. Maxwell"/"MM" card (`:336-349`, gated internal). Logout (`:352-360`). CmdPalette (`:34-251`). **Do NOT modify** — copy the brand-block + logout markup into the new `ClientAppBar`. |
| `src/shared/components/navTabsData.ts` | READ-ONLY ref | The 7 internal tabs (Engagements/Skill Registry/Jobs/Certification/Access Control/Analytics/Audit Log) — **none** appear in the client shell. |
| `src/stores/useRoleStore.ts` | reuse (not for guarding) | Zustand `role: 'internal'|'client'`, default `'internal'`, `setRole`. Drives the shared AppBar's conditional rendering. Use `getCurrentUser().role` (durable) for guards/redirects, NOT this store (resets to `'internal'` on refresh). |
| `src/features/client-portal/` | NEW (fill) | `types.ts` = `export {}` (fill with TS types); `components/` = only `.gitkeep` (add `ClientAppBar.tsx`, `ClientShell.tsx`, `ClientDashboard.tsx`); add `hooks/useMyEngagements.ts`. |
| `src/api/clientPortal.ts` | NEW | Axios call to `/api/v1/client/engagements` via the shared `apiClient` (`api/client.ts` — bearer + 401-refresh interceptors already there). |
| `src/api/hierarchy.ts` + `src/features/engagements/hooks/useEngagements.ts` | DO NOT REUSE | Hit internal `/api/v1/clients`/`/api/v1/projects` — wrong tenant for a client token + 404'd by the 8.2 `RejectClient` guard. |
| `src/shared/hooks/useDocumentTitle.ts` | reuse | `usePageTitle(...parts)` (`:38-40`) → `'… · Velara'`. Every client route must call it (title isolation — C2). |

### Critical constraints (read before coding)

- **C1 — Backend test auth backend.** `.env` has `AUTH_BACKEND=cognito`; `DevAuthProvider` HS256 tokens are rejected by `CognitoAuthProvider` RS256 validation. **All integration tests must run with** `docker compose exec -e AUTH_BACKEND=dev api pytest tests/integration/api/test_client_surface.py`. (Learned in 8.2 — `8-2…md` Debug Log.)
- **C2 — Title isolation (regression gate).** `client.test.tsx:39-55` seeds a stale internal title (`'Skill Registry · Velara'`), renders `/client/dashboard`, and asserts the title becomes `'Dashboard · Velara'` and contains **none** of `Skill Registry`/`Audit Log`/`Access Control`/`Engagements`. Your `ClientDashboard` **must** call `usePageTitle('Dashboard')`. Extend this negative assertion to any new client screen. Breaking it breaks the build.
- **C3 — Why this endpoint exists (and why there is NO cross-tenant gap — verified against the live 8.2 implementation).** AC2/AC4 need data not in the JWT (only `user_id`/`org_id`/`role`) and not reachable by any existing client route. **Important correction to earlier planning assumptions:** a client's Clients/Projects/Studies are created under the **client's own org** (`org_client_001`), and the grant row is stored with that same `org_id`. The 8.2 tests prove this — `test_client_surface.py:254-290` create the client hierarchy with `org_id=_CLIENT_ORG ("org_client_001")` and `create_grant(..., org_id=_CLIENT_ORG)`. `resolve_scope_paths(session, user_id, org_id)` filters grants by the caller's `org_id` and verifies each granted node's `hierarchy_path` starts with `_org_segment(user.org_id)` (`access_service.py:156-216`). So you pass the caller's **own** `user.org_id` to `list_clients`/`list_projects` — exactly like the internal hierarchy route does, just on the client router. **Do NOT** introduce any cross-org / `org_vitalief` indirection; that model is not how 8.1/8.2 were built and would return zero rows. The `HierarchyScope` dependency already calls `resolve_scope_paths` for you — just read `scope.scope_paths` (and short-circuit on `scope.unrestricted` per Task 1.5).
- **C4 — IP-safe response.** The client response carries **only** `client_id`/`client_name`/`project_id`/`project_name`. No `org_id`, no `hierarchy_path`, no `description`, no timestamps. This is the same discipline that made 8.2 pass its "zero internals" assertion. A separate Pydantic schema (not `ClientRead`) enforces it structurally.
- **C5 — No new migration.** The `user_access_grants` table (migration `0016`) and the hierarchy tables (`0011`) already exist. This story adds **no** DB schema. Confirm before authoring any migration (you should not need one).
- **C6 — `RequireAuth` stays.** Don't delete it; `RequireClient`/`RequireInternal` compose it. Both new guards must still send unauthenticated users to `/login` with `state.from` preserved (so deep-link-then-login still works).

### Architecture compliance (hard enforcement rules — All Agents MUST)

[Source: architecture/implementation-patterns-consistency-rules.md#enforcement-rules-all-agents-must]

1. **Response envelope** — the new route returns `ResponseEnvelope` (`{data, meta}`); never a bare object/array.
2. **`hierarchy_scope` on hierarchical-data routes** — the engagements route **must** depend on `HierarchyScope` and filter by the resolved scope; never return unfiltered hierarchy data.
3. **snake_case in the API layer** (`client_id`, `project_name`); **camelCase in TS** (`clientId`, `projectName`) — convert at the FE boundary.
4. **`request_id`** flows through `ResponseMeta` (handled by the envelope helper `_meta(request)`).
5. **Never return raw exception messages** — map through the global handler / `VelaraHTTPException`.
6. **Co-locate tests** — `ClientAppBar.test.tsx` beside `ClientAppBar.tsx`; backend tests in the integration suite alongside the 8.2 client tests.
7. **Loading via TanStack Query** `isLoading`/`isError` — skeleton on initial load, no hand-rolled booleans; `staleTime: 30_000` for registry/hierarchy data.
8. **Auth flow** — token refresh via the existing Amplify-backed `apiClient` 401 interceptor; do not hand-roll.

### Library / framework versions (pinned — do not change)

[Source: velara-web/package.json]

- `react ^19`, `react-router-dom ^7`, `aws-amplify ^6` + `@aws-amplify/auth ^6` (modular API — `signIn`/`fetchAuthSession`/`signOut`, already wired in `auth.ts`), `@tanstack/react-query ^5`, `zustand ^5`, `tailwindcss ^4`, `vite ^6`, `vitest ^2`, `@testing-library/react ^16`, `@sentry/react ^8`. Backend: FastAPI + SQLAlchemy (async) + Pydantic v2 (`ConfigDict(from_attributes=True)`), Postgres `ltree`, Alembic.
- No new dependencies are needed for this story. If you reach for one, stop — the patterns above cover it.

### UX / design intent

[Source: design/client.jsx, design/styles_v3.css, architecture/core-architectural-decisions.md#frontend-architecture]

- Brand: V3 tokens — teal (`#128F8B` / Tailwind `brand-*`), navy `#323843` (`ink`), slate `#4C5270` (`ink-2`), Poppins headings / Open Sans body. Already in the Tailwind config (Story 1.6). Use token classes, not raw hex.
- Client AppBar: brand block ("Velara · A Vitalief Skills Platform") + engagement context + logout. **No** internal chrome. The `client.jsx` mockup also shows Dashboard/Studies/Deliverables tabs, study cards, and a run flow — **those are 8.4**; 8.3 ships the shell + a dashboard that lists the granted engagement(s).
- "The platform serves two populations with opposing needs… clients receive outputs without ever seeing methodology, code, or instructions. The platform enforces this boundary at every layer." [Source: PRD product overview] — the IP-safe schema (C4) and the structural absence of internal chrome (Task 5) are this story's contribution to that boundary.
- Relevant PRD FRs: **ACL-04** (clients see skill name/description/result/output files — nothing else), **ACL-07** (project- and study-level skills in the portal — the *skills* are 8.4; the *shell* is here), **SEC-06** (auth: Phase 1 username/password — already built via Cognito). [Source: prds/.../5-functional-requirements.md]

### Previous-story intelligence (8.1 + 8.2 — apply these)

- **8.2 RejectClient cascade:** the `RejectClient` 404 guard means a client token on any internal route gets `NOT_FOUND` at the router boundary. This is why the FE `useEngagements`/`hierarchy.ts` are unusable for clients and why a dedicated client endpoint + hook are mandatory. [Source: 8-2…md Debug Log + File List]
- **8.2 IP-safe schema pattern:** `ClientJobRead`/`ClientOutputFile`/`ClientErrorInfo` are independent `BaseModel`s with zero inheritance and a recursive "no internals fields" test. Copy this exactly for `ClientEngagement*`. [Source: 8-2…md Completion Notes]
- **8.1 scope semantics:** internal roles bypass scope (`unrestricted=True`); only `client` role is scope-restricted; `create_grant` rejects internal-role grantees (422). Grants are path-scope, not permission-scope (`role` column is descriptive). Empty `scope_paths` → zero rows (so no-grants client correctly sees nothing). [Source: 8-1…md Review Findings + architecture ADR]
- **8.2 invocation gating (context, not a 8.3 task):** org-global (non-location-dependent) invocations are blocked for client tokens; this is why client run/invoke is gated to location-dependent skills — relevant background for 8.4, not this story.

### Git intelligence

The repo history is squashed into an initial-import + one `updates` commit, so per-file commit diffs are not informative here. **The story Dev Agent Records (`8-1…md`, `8-2…md`) are the authoritative record of what 8.1/8.2 actually built** — they are quoted throughout these notes. Trust the file-state tables above (verified against the live tree during story creation) over any assumption from older planning docs.

### Scope boundaries (do NOT do these — they are 8.4)

- Skill discovery / listing in the portal (project-level + study-level skills, badges, hero counts).
- The client run/invoke UI (upload → run → output download), `RunConsole`-equivalent client screens.
- The skill `visibility` filter (`internal_only` filtered at the API).
- The Dashboard/Studies/Deliverables nav tabs and Study-detail screens from the mockup.
- Any change to the invoke/job-poll routes (those are 8.2; already done).

### Project Structure Notes

- New backend files follow `app/schemas/<resource>.py` + route-on-existing-router conventions; tests co-located in the integration suite. No structural variance.
- New frontend files follow the feature-first layout (`features/client-portal/{components,hooks}/`, `api/clientPortal.ts`, `routes/client.tsx`). `RequireClient`/`RequireInternal` live in `shared/components/` beside `RequireAuth.tsx`. No variance from `architecture/project-structure-boundaries.md`.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-8-access-control-client-portal.md#story-8.3-client-portal-authentication-shell] — the 4 ACs (authoritative).
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#frontend-architecture] — separate `/internal/*` + `/client/*` route trees, Zustand, TanStack Query, V3 design tokens.
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#authorization-internal-roles-are-org-global-operators] — internal-role scope bypass; client-only scoping.
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#enforcement-rules-all-agents-must] — the 9 hard rules.
- [Source: _bmad-output/implementation-artifacts/stories/8-1-hierarchy-scoped-rbac-enforcement.md] — grant model, `hierarchy_scope`, `resolve_scope_paths`.
- [Source: _bmad-output/implementation-artifacts/stories/8-2-ip-protection-client-api-surface-enforcement.md] — `/api/v1/client` router, `RejectClient` 404, IP-safe schema pattern, AUTH_BACKEND=dev test note.
- [Source: velara-api/app/api/v1/client.py, app/core/dependencies.py, app/services/{hierarchy_service,access_service}.py, app/schemas/{hierarchy,common,job}.py, app/models/hierarchy.py] — backend current state.
- [Source: velara-web/src/{App.tsx, routes/client.tsx, routes/internal.tsx, pages/LoginPage.tsx, shared/components/{RequireAuth,AppBar}.tsx, shared/utils/auth.ts, stores/useRoleStore.ts, api/client.ts, shared/hooks/useDocumentTitle.ts}] — frontend current state.
- [Source: design/client.jsx, design/styles_v3.css] — client portal visual intent + brand tokens.
- [Source: prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md] — ACL-04, ACL-07, SEC-06.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- C3 Verified: client hierarchy lives under client's own org (org_client_001), not org_vitalief. No cross-tenant indirection needed.
- Project-only grant edge case: list_clients uses `<@` so a granted project path does NOT match the parent client. Implemented path-segment resolver (segments[:2] = client path prefix) to surface the engagement name.
- ruff format prefers `assert (condition), msg` style — updated test_openapi.py assertions.
- 3 pre-existing 8.2 integration test failures (completed_job_presign, blocked_job, out_of_scope_403) are FK constraint errors from stale dev-env DB state, NOT introduced by 8.3.

### Completion Notes List

- **Task 1**: `app/schemas/client.py` NEW — independent BaseModels (no hierarchy.py inheritance). `GET /engagements` on existing client router with HierarchyScope dep. Internal callers (unrestricted=True) get empty list. Project-only-grant edge case handled via parent path derivation.
- **Task 2**: 4 new integration tests (grants→names+zero-internals, no-grants→empty, isolation, internal-empty) + OpenAPI schema lock for all 3 new schemas. All pass: 4 integration ✅, 10 OpenAPI ✅, 529 unit ✅.
- **Task 3**: `RequireClient.tsx` + `RequireInternal.tsx` created. `isClient()` helper added to `auth.ts`. `internal.tsx` swapped to `RequireInternal`.
- **Task 4**: `LoginPage.tsx` role-aware post-login redirect (client→/client/dashboard, internal→clamped from). `App.tsx` `/` and `/login` redirects now role-aware via `isClient()`.
- **Task 5**: `ClientAppBar.tsx` (brand block + engagement name + logout; no role switcher/⌘K/MM) + `ClientShell.tsx` (AppBar + main). V3 brand tokens throughout (brand-900 bg, no raw hex).
- **Task 6**: `api/clientPortal.ts` (shared apiClient, snake→camelCase), `useMyEngagements.ts` (TanStack Query, staleTime:30_000), `types.ts` (TS camelCase types), `ClientDashboard.tsx` (usePageTitle('Dashboard'), isLoading skeleton, engagement list). `client.tsx` fully replaced.
- **Task 7**: `client.test.tsx` rewritten (velara_user sessionStorage seed, AC1/AC3/C2 coverage, useMyEngagements mock), `ClientAppBar.test.tsx` NEW (8 AC2 tests), `LoginPage.test.tsx` extended. 331 FE tests pass (28 files), 0 TS errors.

### File List

velara-api/app/schemas/client.py
velara-api/app/api/v1/client.py
velara-api/tests/integration/api/test_client_surface.py
velara-api/tests/integration/api/test_openapi.py
velara-web/src/shared/utils/auth.ts
velara-web/src/shared/components/RequireClient.tsx
velara-web/src/shared/components/RequireInternal.tsx
velara-web/src/routes/internal.tsx
velara-web/src/routes/client.tsx
velara-web/src/routes/client.test.tsx
velara-web/src/pages/LoginPage.tsx
velara-web/src/pages/LoginPage.test.tsx
velara-web/src/App.tsx
velara-web/src/features/client-portal/types.ts
velara-web/src/api/clientPortal.ts
velara-web/src/features/client-portal/hooks/useMyEngagements.ts
velara-web/src/features/client-portal/components/ClientAppBar.tsx
velara-web/src/features/client-portal/components/ClientAppBar.test.tsx
velara-web/src/features/client-portal/components/ClientShell.tsx
velara-web/src/features/client-portal/components/ClientDashboard.tsx

### Change Log

- 2026-06-30: Story 8.3 implemented. Backend: GET /api/v1/client/engagements (IP-safe schema, HierarchyScope, project-only-grant edge case, empty for internals). Frontend: RequireClient/RequireInternal guards + isClient() helper; role-aware login+root redirects; ClientAppBar+ClientShell+ClientDashboard; TanStack Query engagement data layer. Tests: 4 BE integration + OpenAPI schema locks + 331 FE tests (28 files). Gates: 529 unit ✅, 10 OpenAPI ✅, 4 new integration ✅, 331 FE ✅, 0 TypeScript errors, ruff check+format clean on all new files.
