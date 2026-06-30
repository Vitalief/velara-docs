# Epic 8: Access Control & Client Portal

Clients can access a dedicated portal to invoke client-facing skills and receive outputs. Hierarchy-scoped RBAC is fully enforced across all API routes. Skill internals are structurally blocked from client-scoped tokens.

## Story 8.1: Hierarchy-Scoped RBAC Enforcement

As a platform developer,
I want the UserAccessGrant model and `hierarchy_scope` FastAPI dependency enforced on every protected route,
So that users can only access entities within their granted hierarchy scope — not through any combination of API calls.

**Acceptance Criteria:**

**Given** the Alembic migration for `user_access_grants` runs
**When** I inspect the schema
**Then** the table has `user_id`, `node_id`, `node_type`, `role`, `granted_at`, `granted_by_user_id`

**Given** the `hierarchy_scope` FastAPI dependency is applied to a route
**When** a request arrives with a valid JWT
**Then** the dependency resolves the user's granted `hierarchy_path` scopes and attaches them to the request context; all ORM queries in that request automatically filter by `path <@ :scope_path`

**Given** a user with access only to `client_A/project_X` attempts to access `client_B/project_Y`
**When** the request is processed
**Then** the API returns HTTP 403 with `{"error": {"code": "FORBIDDEN", ...}}` — the user cannot see or interact with out-of-scope entities

**Given** an admin grants a user access to a Client
**When** `POST /api/v1/access-grants` is called
**Then** the grant is created and the user can immediately access all Projects and Studies under that Client

**Given** an access grant is revoked
**When** the user makes a subsequent request
**Then** the scope dependency recalculates and the revoked path is no longer accessible — no caching of grants beyond the request lifetime

---

## Story 8.2: IP Protection — Client API Surface Enforcement

As a platform architect,
I want client-scoped tokens to be structurally blocked from all skill internals routes at the API router level,
So that it is architecturally impossible — not just permission-checked — for a client token to access skill instructions, code, or reference file contents.

**Acceptance Criteria:**

**Given** a Cognito token has the `client` role claim
**When** FastAPI processes the token
**Then** the request is routed to the `/api/v1/client/` router prefix — which has no routes for skill definitions, skill versions, or skill content

**Given** a client-scoped token attempts to call `GET /api/v1/skills/{skill_id}` (internal route)
**When** the FastAPI router evaluates it
**Then** HTTP 404 is returned — the route does not exist on the client router prefix (not 403; the route is structurally absent)

**Given** a client-scoped token calls the invocation endpoint
**When** the response is returned
**Then** it contains only: `job_id`, `status`, and (when complete) output file download links — no `instructions`, `code`, `system_prompt`, or `reference_files` fields are present

**Given** any API response is inspected for a client-scoped invocation
**When** I search the response body for skill content fields
**Then** zero matches are found — the serialization layer for client responses uses a separate Pydantic schema with no internals fields

---

## Story 8.3: Client Portal Authentication & Shell

As a client engagement lead or clinical ops director,
I want to log in to the client portal and see a clean interface scoped to my engagement,
So that I can access my assigned skills without seeing any Vitalief internal tools or methodology.

**Acceptance Criteria:**

**Given** a client user navigates to `/login`
**When** they authenticate via Cognito with their client-scoped credentials
**Then** they are redirected to `/client/dashboard` — not `/internal/*`

**Given** a client user is logged in
**When** the app renders
**Then** the role switcher is not visible; the AppBar shows "Velara · A Vitalief Skills Platform" and the client's assigned engagement name

**Given** a client user attempts to navigate to any `/internal/*` route
**When** the `RequireAuth` guard evaluates their role
**Then** they are redirected to `/client/dashboard` — internal routes are inaccessible

**Given** a client user's session is valid
**When** they view the portal
**Then** they see only the Clients and Projects they have been granted access to — no other engagement data is visible

---

## Story 8.4: Client Portal — Skill Discovery & Invocation

As a client engagement lead,
I want to see all skills available to my engagement (both project-level and study-level) and invoke them from the client portal,
So that I can run approved skills and receive outputs without any exposure to Vitalief's methodology.

**Acceptance Criteria:**

**Given** a client user views their Project dashboard
**When** the page loads
**Then** project-level skills are shown in a "Project-wide skills" section above the studies list, each with a "Project-wide" badge; the hero "Available skills" count includes them

**Given** a client user views a Study detail
**When** the page loads
**Then** project-level skills appear in an "Available across all studies" section (with a layers icon), and study-specific skills appear below in a "Study-specific" section

**Given** a client user clicks "Run" on a skill
**When** the client run interface opens
**Then** it shows the skill name and description — no instructions, methodology, or code are visible anywhere in the UI

**Given** a client user submits a skill invocation
**When** the run completes
**Then** they see the output text and can download output files — the back button returns them to the Project or Study they ran from

**Given** a skill has `visibility: "internal_only"`
**When** it is queried through the client API
**Then** it does not appear in the client portal at all — it is filtered out at the API layer

**Given** a client user invokes a skill
**When** I check the audit log
**Then** an entry exists with the client's `user_id`, the engagement `hierarchy_path`, skill ID, and `outcome`

---
