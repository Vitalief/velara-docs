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

## Story 8.5: Access Control Screen — Admin Grant Management

<!-- Added 2026-07-01 via correct-course (see planning-artifacts/sprint-change-proposal-2026-07-01.md). -->

As a Vitalief consultant (internal admin),
I want a screen to view, create, and revoke client access grants across the engagement hierarchy,
So that I can manage who can access which Clients/Projects/Studies without calling the API by hand.

**Acceptance Criteria:**

**Given** I open `/internal/access`
**When** the screen loads
**Then** the placeholder is replaced by a real screen listing existing grants (user_id, node, node_type, role, granted_at) for my org — backed by a NEW `GET /api/v1/access-grants` list route (consultant/ma_tech gated; this route does not exist today — 8.1 skipped it as optional)

**Given** I create a grant (pick a `user_id`, a hierarchy node, `node_type`, `role=client`)
**When** I submit
**Then** `POST /api/v1/access-grants` is called and the new grant appears in the list

**Given** I revoke a grant
**When** I confirm
**Then** `DELETE /api/v1/access-grants/{id}` is called and it disappears; the affected client's scope recalculates on their next request (no caching — 8.1 AC5)

**Given** the grantee role is internal (`ma_tech`/`consultant`)
**When** I attempt to create the grant
**Then** the UI prevents it and surfaces the existing `422 INTERNAL_ROLE_NOT_GRANTABLE` cleanly (does not crash)

**Given** the screen is under `/internal/*`
**When** any user reaches it
**Then** it is internal-only (`RequireInternal`), uses the response envelope + snake→camel mapping, and shows TanStack Query loading/error states

---

## Story 8.6: Skill Attachment Model & Assignment UI

<!-- Added 2026-07-01 via correct-course. Sequenced BEFORE 8.4 so client skill discovery consumes real attachments (not the scope-heuristic mock). Requires an architecture ADR for the attachment model before dev. -->

As a Vitalief consultant,
I want to attach specific skills to specific Projects and Studies (and see/remove those attachments),
So that a client's portal shows only the skills actually assigned to their engagement — not every org skill of a matching scope.

**Acceptance Criteria:**

**Given** the Alembic migration runs
**When** I inspect the schema
**Then** an attachment table exists (`project_skill` / `study_skill`, or a single polymorphic `skill_attachment`) linking a skill to a hierarchy node

**Given** I attach skill X to Project Y
**When** I call `POST /api/v1/projects/{id}/skills` (or the equivalent attach route)
**Then** the attachment persists; the unattach route removes it. Attach/unattach is consultant/ma_tech gated and hierarchy-scope checked

**Given** an internal assignment UI on a Project/Study screen
**When** I attach or detach a skill
**Then** the attachment set updates and reflects immediately

**Given** the client portal (Story 8.4)
**When** a client views available skills
**Then** availability is filtered by REAL attachments (replacing the scope-heuristic mock) intersected with the client's grant and `client_facing` visibility

**Given** the internal mock seam `useProjectSkills(_projectId)` (which today ignores `projectId` and filters global skills by `scope==='project'`)
**When** this story lands
**Then** it is rewired to query real attachments by `projectId` — the documented swap point

---
