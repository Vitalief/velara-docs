# Epic 6: Certification & Governance

MA Tech and Matt Maxwell can execute the two-key certification workflow, advancing skills from `internal_ready` to `client_ready` with immutable certification records.

## Story 6.1: Certification Data Model & State Machine API

As a platform developer,
I want the CertificationRecord data model and the certification state machine API,
So that the two-key workflow is enforced structurally — a skill cannot reach `client_ready` without both keys recorded.

**Acceptance Criteria:**

**Given** the Alembic migration for `certification_records` runs
**When** I inspect the schema
**Then** the table has: `id`, `skill_id`, `skill_version`, `certification_type` (`technical`|`methodological`), `certifier_user_id`, `certified_at` (UTC), `signature_meaning`, `notes` — all fields are write-once (no update endpoint)

**Given** I call `POST /api/v1/certifications` to record a technical certification
**When** the payload is valid
**Then** a `CertificationRecord` is created, the skill's `technical_certified` flag is set to `true`, and HTTP 201 is returned

**Given** both `technical_certified` and `methodological_certified` are `true` for a skill version
**When** the platform evaluates lifecycle eligibility
**Then** the skill can be advanced to `client_ready`; attempting to advance without both keys returns HTTP 422 with `CERTIFICATION_INCOMPLETE`

**Given** a new skill version is published after a skill was `client_ready`
**When** I attempt to advance the new version to `client_ready`
**Then** the API returns HTTP 422 with `RECERTIFICATION_REQUIRED` — both certification keys must be recorded against the new version before it can advance

**Given** a certification record is created
**When** any user attempts to update or delete it
**Then** the API returns HTTP 405 Method Not Allowed — certification records are immutable

**Given** 21 CFR Part 11 electronic-signature requirements (FR-SEC-10)
**When** a certification record is created
**Then** it constitutes an electronic signature — capturing the signer's identity (`certifier_user_id`, resolvable to a printed name), a UTC timestamp (`certified_at`), and the **meaning** of the signature (`signature_meaning`, e.g. `technical_certification` / `methodological_certification`) — bound immutably to the specific `skill_version`

---

## Story 6.2: Technical Certification Workflow UI

As an MA Tech developer,
I want a UI surface to review a skill and record the technical certification key,
So that I can formally approve the technical quality of a skill and advance it toward client readiness.

**Acceptance Criteria:**

**Given** I navigate to the Certification tab
**When** the page loads
**Then** I see a unified list of skills pending certification — both awaiting technical review and awaiting methodological review are shown in a single governance view (no separate tabs)

**Given** I click on a skill pending technical certification
**When** the detail panel opens
**Then** I see: skill name, version, description, runtime type, input/output schema, and a "Record Technical Certification" button

**Given** I click "Record Technical Certification"
**When** the modal opens
**Then** it has a notes field (optional) and a checklist confirming: executes without error, handles adversarial inputs, code reviewed, description correctly invokes from Claude, outputs match schema

**Given** I submit the technical certification
**When** the API call completes
**Then** `POST /api/v1/certifications` records the technical key, the skill's technical certification badge updates, and the skill appears in the "Awaiting Methodological Certification" section

**Given** a skill has already been technically certified
**When** I view it
**Then** the technical certification badge shows the certifier name and timestamp — the "Record Technical Certification" button is disabled

**Given** 21 CFR Part 11 electronic signatures (FR-SEC-10)
**When** I open the "Record Technical Certification" modal
**Then** it displays my signer name and an explicit signature statement ("I, {name}, certify the technical quality of this skill version"); on submit, the recorded manifestation — signer name, UTC timestamp, and signature meaning — is shown on the certification record

---

## Story 6.3: Methodological Certification Workflow UI

As Matt Maxwell (Vitalief CIO),
I want a UI surface to review a technically-certified skill and record my methodological certification key,
So that I can formally approve the methodology and voice of a skill before it is exposed to clients.

**Acceptance Criteria:**

**Given** Matt navigates to the Certification tab
**When** the list loads
**Then** skills with technical certification complete and methodological certification pending are clearly visible

**Given** Matt clicks a skill awaiting methodological certification
**When** the detail panel opens
**Then** he sees: the technical certification record (certifier, date, notes) and a "Record Methodological Certification" button

**Given** Matt clicks "Record Methodological Certification"
**When** the modal opens
**Then** it has a notes field and a checklist: produces Vitalief-grade output, aligns with methodology, voice and style match Vitalief standards

**Given** Matt submits the methodological certification
**When** the API call completes
**Then** `POST /api/v1/certifications` records the methodological key, and the system automatically advances the skill lifecycle to `client_ready`

**Given** a skill reaches `client_ready`
**When** I view the Skill Registry
**Then** the lifecycle badge shows `client_ready` and the skill becomes available for client invocation (enforced in Epic 8)

**Given** 21 CFR Part 11 electronic signatures (FR-SEC-10)
**When** Matt opens the "Record Methodological Certification" modal
**Then** it displays his signer name and an explicit signature statement ("I, {name}, certify the methodology and voice of this skill version") with the signature meaning; on submit, the manifestation — signer, UTC timestamp, meaning — is recorded immutably against the skill version

---

## Story 6.4: Certification History & Re-Certification on New Version

As an MA Tech developer,
I want to view the full certification history for any skill version and be required to re-certify whenever a new version is published,
So that the audit trail is complete and no new version can reach clients without going through governance.

**Acceptance Criteria:**

**Given** I view a skill with multiple versions
**When** I open the Certification History section
**Then** I see each version's certification records: version number, technical certifier + date, methodological certifier + date, and notes

**Given** a skill is `client_ready` at version 1.0.0
**When** version 1.1.0 is published
**Then** version 1.1.0 enters `draft` state and the certification UI shows it as "Requires re-certification" — the previous version's certifications are preserved in history but do not carry over

**Given** a derived (paired) skill has `review_required: true` due to a parent update
**When** I attempt to certify it
**Then** the certification UI shows a warning: "Parent skill was updated. Review lineage changes before certifying." — certification is blocked until acknowledged

**Given** certification records exist
**When** I call `GET /api/v1/certifications?skill_id={id}`
**Then** all certification records for that skill (all versions) are returned in chronological order

---
