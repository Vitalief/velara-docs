# Epic 2: Skill Registry & Lifecycle

MA Tech and consultants can register, version, tag, and manage skills through their full lifecycle with all required metadata, visibility designations, and paired-skill lineage tracking.

## Story 2.1: Skill Data Model & Registry API

As a platform developer,
I want the Skill and SkillVersion data models with full CRUD and lifecycle state machine API,
So that skills can be registered, versioned, and lifecycle-managed consistently across all subsequent features.

**Acceptance Criteria:**

**Given** the Alembic migration for skill entities runs
**When** I inspect the schema
**Then** tables exist for `skills` (metadata, lifecycle state, visibility) and `skill_versions` (versioned, immutable artifact content with encrypted storage) — each skill version has a unique identifier

**Given** I call `POST /api/v1/skills` with valid metadata
**When** the skill is created
**Then** it is created in `draft` state with version `1.0.0` and returned with HTTP 201

**Given** I call `PATCH /api/v1/skills/{skill_id}/lifecycle` to advance state
**When** the transition is `draft` → `internal_ready`
**Then** the state advances and the change is recorded; invalid transitions (e.g., `draft` → `client_ready`) return HTTP 422

**Given** a skill is in `retired` state
**When** I attempt to invoke it (any execution endpoint)
**Then** the API returns HTTP 422 with `{"error": {"code": "SKILL_RETIRED", ...}}`

**Given** I call `POST /api/v1/skills/{skill_id}/versions`
**When** a new version is submitted
**Then** the new version is created as immutable, the previous version is preserved, and the skill's `current_version` pointer updates

**Given** I call `GET /api/v1/skills`
**When** filtered by `?status=draft`
**Then** only draft skills are returned in the response

---

## Story 2.2: Skill Metadata, Tags & Visibility Designations

As an MA Tech developer,
I want to set and update all required skill metadata fields including runtime type, visibility designation, and scope,
So that skills are correctly discoverable, correctly restricted, and carry enough information for invocation, certification, and client portal display.

**Acceptance Criteria:**

**Given** I create a skill
**When** I submit the payload
**Then** all required metadata fields are validated: name, description, author, runtime type (`prompt`|`code`|`hybrid`), visibility (`internal_only`|`paired`|`client_facing`), input schema, output schema

**Given** I submit a skill without a description
**When** the API validates the payload
**Then** HTTP 422 is returned with `{"error": {"code": "MISSING_DESCRIPTION", ...}}` — description is required

**Given** I create a skill with `runtime_type: "prompt"`
**When** I retrieve it
**Then** the runtime type is stored correctly and used to route execution

**Given** I set `visibility: "paired"` on a skill
**When** I retrieve the skill
**Then** the response includes a `paired_with` field (null until a derived skill is linked)

**Given** I set `scope: "study"` on a skill
**When** I retrieve it
**Then** the scope is stored; this skill can only be invoked within a Study context

**Given** I add tags to a skill (e.g., `["clinical", "enrollment"]`)
**When** I call `GET /api/v1/skills?tag=clinical`
**Then** only skills with that tag are returned

**Given** a skill's metadata is updated (name, description, tags)
**When** the PATCH is applied
**Then** only metadata changes — no new version is created (metadata updates do not require re-certification)

---

## Story 2.3: Paired Skill Derivation Lineage

As an MA Tech developer,
I want to link an internal skill to its derived client-facing version and track lineage,
So that when the internal (parent) skill changes, the derived (client-facing) version is automatically flagged for review before it can be re-certified.

**Acceptance Criteria:**

**Given** an internal skill (`visibility: "paired"`) exists
**When** I call `POST /api/v1/skills/{skill_id}/derive` with a client-facing skill payload
**Then** a new skill is created with `visibility: "client_facing"` and `derived_from: {parent_skill_id, parent_version}` recorded in its metadata

**Given** the parent skill has a derived child
**When** I retrieve either skill
**Then** the response includes a `lineage` object showing the relationship: parent includes `derived_skills: [...]` and child includes `derived_from: {...}`

**Given** a new version of the parent skill is published
**When** the new version is saved
**Then** all linked derived skills have their `review_required` flag set to `true` automatically

**Given** a derived skill has `review_required: true`
**When** I attempt to advance it to `client_ready` via the certification workflow
**Then** the API returns HTTP 422 with `{"error": {"code": "DERIVED_SKILL_REVIEW_REQUIRED", ...}}` — the reviewer must acknowledge the parent change first

**Given** a reviewer acknowledges the parent change on a derived skill
**When** they call `POST /api/v1/skills/{skill_id}/acknowledge-parent-update`
**Then** `review_required` is cleared and the skill can proceed through certification

---

## Story 2.4: Skill Registry UI — Browse & Detail

As a Vitalief consultant,
I want to browse all skills in the registry with filtering by lifecycle state, visibility, runtime type, and tags, and view a skill's full detail,
So that I can discover available skills and understand their capabilities before invoking or certifying them.

**Acceptance Criteria:**

**Given** I navigate to the Skill Registry tab
**When** the page loads
**Then** all skills visible to my role are displayed as cards showing: name, lifecycle state badge, visibility badge, runtime type, and author

**Given** I filter by `status=internal_ready`
**When** the filter is applied
**Then** only `internal_ready` skills are shown

**Given** I click on a skill card
**When** the detail view opens
**Then** I see: full metadata, current version, description, input/output schema, lifecycle history, and (for paired skills) the lineage link

**Given** a skill has `visibility: "internal_only"`
**When** a client-scoped user would view the registry
**Then** this skill does not appear in their view (enforced in Epic 8 — internal-only skills invisible to clients)

**Given** I am on a skill detail view
**When** I click the "Run" button
**Then** the Run Console opens in skill-first mode with this skill pre-selected (implemented in Epic 5)

**Given** I search the registry using ⌘K
**When** I type a skill name or tag
**Then** matching skills appear as suggestions

---

## Story 2.5: Skill Create & Edit UI

As an MA Tech developer,
I want a form to create and edit skills with all required metadata fields,
So that new skills can be registered and existing skill metadata can be updated without touching the database directly.

**Acceptance Criteria:**

**Given** I click "Register Skill" in the Skill Registry
**When** the form opens
**Then** it includes fields for: name, description, runtime type (select), visibility (select), scope (project/study), tags (multi-input), input schema (JSON editor), output schema (JSON editor)

**Given** I submit the form with all required fields
**When** the API call completes
**Then** the skill is created in `draft` state and I am navigated to the new skill's detail view

**Given** I submit the form without a description
**When** client-side validation runs
**Then** the description field shows an inline error "Description is required for certification" and submission is blocked

**Given** I am on a skill detail view in `draft` state
**When** I click "Edit"
**Then** the edit form pre-populates with the current metadata and I can update any field

**Given** I save metadata edits on a `client_ready` skill
**When** the PATCH completes
**Then** a notice appears: "Metadata updated. This skill's certification status is unchanged — only new versions require re-certification."

**Given** I advance a skill's lifecycle state from the detail view
**When** I click "Advance to Internal Ready"
**Then** a confirmation dialog appears, and on confirm the state transitions and the badge updates

---
