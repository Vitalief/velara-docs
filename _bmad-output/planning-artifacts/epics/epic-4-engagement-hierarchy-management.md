# Epic 4: Engagement Hierarchy Management

Consultants and admins can create, browse, and manage the full Client → Project → Study → Location tree. The Engagements screen is the landing page. Locations carry a required postal code. The Organization layer is invisible to all UI surfaces.

## Story 4.1: Hierarchy Data Model & API

As a platform developer,
I want the hierarchy data model (Organization, Client, Project, Study, Location) with ltree paths and full CRUD API,
So that all subsequent features have a consistent, scope-enforceable foundation for every entity in the platform.

**Acceptance Criteria:**

**Given** the Alembic migration for hierarchy entities runs
**When** I inspect the database schema
**Then** tables exist for `organizations`, `clients`, `projects`, `studies`, `locations` — each with `id`, `name`, `description`, `created_at`, `updated_at`, and a `hierarchy_path` ltree column

**Given** I call `POST /api/v1/clients` with a valid payload
**When** the client is created
**Then** it is stored with a `hierarchy_path` of `org_{id}.client_{id}` and returned in the response envelope

**Given** I call `POST /api/v1/projects` under a client
**When** the project is created
**Then** its `hierarchy_path` is `org_{id}.client_{id}.project_{id}`

**Given** I call `POST /api/v1/studies` under a project (optional)
**When** the study is created
**Then** its `hierarchy_path` is `org_{id}.client_{id}.project_{id}.study_{id}`

**Given** I call `POST /api/v1/locations` under a study with a `postal_code` field
**When** the location is created
**Then** postal code is stored and returned; a request without `postal_code` returns HTTP 422

**Given** I call `GET /api/v1/clients`
**When** the response is returned
**Then** it lists all clients visible to the authenticated user — the Organization layer does not appear in any response field or label

**Given** a hierarchy entity is deleted
**When** child entities exist under it
**Then** the API returns HTTP 409 Conflict — cascading deletes are not permitted without explicit confirmation

---

## Story 4.2: Engagements Screen — Client & Project Management

As a Vitalief consultant,
I want to browse, create, and manage Clients and Projects from the Engagements landing screen,
So that I can navigate my active engagements and keep client and project records current.

**Acceptance Criteria:**

**Given** a consultant logs in
**When** the app loads
**Then** the Engagements screen is the default landing view at `/internal/engagements` — it is the first and active tab in the nav strip

**Given** the Engagements screen loads
**When** clients exist in the system
**Then** they are displayed as expandable tree nodes — no Organization-level node or label appears anywhere in the UI

**Given** I click "Add Client"
**When** I fill in name and description and submit
**Then** the new client appears in the tree immediately and `POST /api/v1/clients` returns HTTP 201

**Given** I expand a client node
**When** projects exist under it
**Then** they are displayed as child nodes with their names and descriptions

**Given** I click "Add Project" within a client
**When** I fill in project details and submit
**Then** the project appears under the correct client node and `POST /api/v1/projects` returns HTTP 201

**Given** I click on a project node
**When** the detail panel opens
**Then** I see the project name, description, creation date, and options to add Studies or view attached Skills

**Given** I edit a client or project name
**When** I save the change
**Then** the updated name appears in the tree immediately and the `PATCH` call returns HTTP 200

**Given** the Engagements screen has many clients and projects
**When** I type in the on-screen search/filter box
**Then** the tree (or a results list) filters to matching Clients/Projects by name — Phase 1 is a **client-side mock** operating on already-loaded data (server-side search deferred to Phase 2 per FR-ORG-07); clearing the box restores the full tree

---

## Story 4.3: Study & Location Management

As a Vitalief consultant,
I want to create and manage Studies and Locations (with postal codes) within Projects,
So that clinical trial contexts are properly structured and location-dependent skills have the site data they need.

**Acceptance Criteria:**

**Given** I am viewing a Project detail panel
**When** I click "Add Study"
**Then** a modal appears with fields for name and description; submitting creates the study under the project

**Given** a Study exists
**When** I view it in the tree
**Then** it appears as a child of its project and is labeled as a Study (not required for projects without studies)

**Given** I click "Add Location" within a Study
**When** the modal opens
**Then** it contains fields for: name, address, city, postal code (required), and PI name

**Given** I attempt to submit the Add Location form without a postal code
**When** the form is validated
**Then** submission is blocked and a "Postal code is required" error appears inline

**Given** a Location is created with a postal code
**When** I view the location detail
**Then** the postal code is displayed and is stored on the location entity in the database

**Given** I delete a Study that has Locations
**When** I attempt the deletion
**Then** the UI warns "This study has X locations. Deleting it will also remove all locations." and requires explicit confirmation

**Given** a project has no Studies
**When** I view the project tree node
**Then** I see a "Skills" section directly on the project (no Studies layer shown)

---

## Story 4.4: Hierarchy Navigation & Breadcrumb Context

As a Vitalief consultant,
I want clear hierarchy breadcrumbs and a collapsible tree that shows my full engagement context as I navigate,
So that I always know where I am in the hierarchy and can move between entities without losing context.

**Acceptance Criteria:**

**Given** I navigate to a Project detail view
**When** the page renders
**Then** a breadcrumb trail shows: `Engagements > [Client Name] > [Project Name]` — clickable segments, no Organization label appears

**Given** I navigate to a Study detail view
**When** the page renders
**Then** a breadcrumb trail shows: `Engagements > [Client Name] > [Project Name] > [Study Name]` — no Organization label appears

**Given** I navigate to a Location detail view
**When** the page renders
**Then** the breadcrumb shows the full path from Client down to Location

**Given** the Engagements tree has many clients
**When** the screen loads
**Then** tree nodes are collapsed by default; I can expand/collapse individual nodes

**Given** I use the ⌘K search
**When** I type a client or project name
**Then** matching entities appear as suggestions and selecting one navigates directly to that entity's detail panel

**Given** I am deep in the hierarchy (e.g., a Location detail)
**When** I click a breadcrumb segment
**Then** I navigate directly to that ancestor entity's detail panel

---
