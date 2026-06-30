# 5. Functional Requirements

Requirements are numbered for traceability. BRD IDs are noted in parentheses where applicable. Priority: **P1** = Phase 1 required, **P2** = Phase 2 required, **P3** = architected for, built later.

---

## 5.1 Organizational Hierarchy Management

| ID | Requirement | Priority |
|----|-------------|----------|
| ORG-01 | The platform stores Organizations, Clients, Projects, Studies, and Locations as first-class entities with names, descriptions, and creation metadata. | P1 |
| ORG-02 | Studies are optional children of Projects. A Project with no Studies attaches skills directly at the Project level. | P1 |
| ORG-03 | Locations are children of Studies. A Study can have zero or more Locations. | P1 |
| ORG-04 | All access control policies, audit logs, and skill invocation records reference the full hierarchy path (Org → Client → Project → Study → Location where applicable). | P1 |
| ORG-05 | The data model supports multiple Organizations without schema changes, even though Phase 1 deploys with one. | P1 |
| ORG-06 | The Organization layer is never exposed in the UI. All user-facing paths, labels, and audit displays begin at the Client level. The UI nav section for this tree is labelled "Engagements." | P1 |

---

## 5.2 Skill Registry and Lifecycle

*(BRD REG-01 through REG-07)*

| ID | Requirement | Priority |
|----|-------------|----------|
| REG-01 | Skills are stored as versioned, immutable artifacts. Each version has a unique identifier. The artifact may be a single file or a **multi-file bundle** (zip/directory) — the bundle is the immutable unit. | P1 |
| REG-02 | Skill lifecycle states: `draft`, `internal-ready`, `client-ready`, `retired`. State drives invocation access. | P1 |
| REG-03 | Skills carry required metadata: name, description, author, created date, last modified date, lifecycle state, tags, runtime type (`prompt`, `code`, `hybrid`), internal/client/both designation, input schema, output schema. For code-driven hybrid skills the input schema and output schema are **load-bearing and schema-versioned** (a declared `schema_version`), not optional annotations. | P1 |
| REG-04 | Skills have an optional scope: Project-level or Study-level. Study-scoped skills are only invocable within the context of their Study. | P1 |
| REG-05 | Skills carry one of three visibility designations: **Internal-only** (never exposed to clients), **Client-facing** (sanitized skill for client invocation), or **Paired** (both an internal version and a derived client-facing version exist, with lineage tracked between them). | P1 |
| REG-06 | For Paired skills: the internal (parent) skill and the client-facing (derived) skill are linked via derivation lineage in metadata. Updates to the parent skill flag the derived skill for review before it can be re-certified as client-ready. | P1 |
| REG-07 | Skill descriptions are treated as first-class artifacts. Descriptions drive discoverability and correct invocation — especially from Claude. A skill with an inadequate description does not pass technical certification. | P1 |
| REG-08 | Skill versions can be pinned to specific Projects or Engagements, isolating them from later changes until explicitly upgraded. | P2 |
| REG-09 | Retired skills remain in the registry for audit but cannot be invoked. | P2 |

---

## 5.3 Skill Execution

*(BRD EXE-01 through EXE-06; EXE-09 added 2026-06-18 — sprint-change-proposal-2026-06-18.md, Epic 5.5)*

| ID | Requirement | Priority |
|----|-------------|----------|
| EXE-01 | The platform supports **prompt-based skills** — an instruction set, context, and optional reference files passed to an LLM. The LLM produces the output. | P1 |
| EXE-02 | The platform supports **code-based skills** — executable Python (and additional runtimes as scope expands) that produces output deterministically. | P1 |
| EXE-03 | The platform supports **hybrid skills** — combining an LLM and code — in two execution shapes: **(a) LLM-driven** — an LLM orchestrates the execution and calls code helpers as tools (the Anthropic SKILL.md pattern); and **(b) code-driven, trusted** — the skill's multi-file code drives the orchestration and calls the LLM itself, bears third-party dependencies, and is granted network egress, platform-injected secrets, and raw-file access. The code-driven shape is certification-gated. | P1 |
| EXE-04 | Skill execution is logged: start time, end time, success/failure, input reference, output reference, invoking user, hierarchy context (Org/Client/Project/Study/Location). | P1 |
| EXE-05 | Skill execution is sandboxed; a misbehaving skill cannot affect other skills or platform stability. Sandboxing is **tiered**: an adversarial sandbox (no network, no untrusted dependencies) for `code` and LLM-driven hybrid skills; an **isolated-but-trusted** environment for code-driven hybrid skills — isolated for platform stability, not against hostile code, with trust established by certification rather than runtime restriction. | P1 |
| EXE-06 | Skills can call other skills as subroutines. The full call chain is logged for audit. | P2 |
| EXE-09 | A skill run may end in a **`blocked`** state — distinct from `failed` — when a QA egregious-error gate fires, signalling that a human must resolve the result before it can be trusted. A `blocked` output is not consumable by any downstream skill. | P1 |

---

## 5.4 Location-Dependent Skills

| ID | Requirement | Priority |
|----|-------------|----------|
| LOC-01 | A skill definition can declare itself **location-dependent**, indicating that it requires or produces location-specific output. | P1 |
| LOC-02 | When a location-dependent skill is invoked without a location selected, the platform prompts the invoker to select a Location from the Study's location list before execution proceeds. | P1 |
| LOC-03 | Alternatively, the invoker may choose to run the skill across all Locations in the Study. In this case, the platform fans out parallel invocations — one per Location — and returns aggregated results. | P1 |
| LOC-04 | Multi-invocation runs (LOC-03) are logged as a single parent invocation containing one child log entry per Location, preserving the full audit trail. | P1 |
| LOC-05 | Skills that are not location-dependent receive no location prompt and do not fan out. | P1 |
| LOC-06 | Location entities store a **postal code** as a required field. Postal code is used to determine Medicare benefits eligibility for the site and is injected as context into location-dependent skill invocations. | P1 |

---

## 5.5 Document Ingest

*(BRD ING-01, ING-02)*

| ID | Requirement | Priority |
|----|-------------|----------|
| ING-01 | The platform accepts PDF, Word (DOCX), and Excel (XLSX) file uploads as inputs to skills. Multiple files may be uploaded per invocation. A skill may receive the **raw uploaded file by reference (path)** — not only pre-parsed text — so skills that perform their own ingestion (e.g. page rasterization for a vision pass) can read the original bytes. | P1 |
| ING-02 | Uploaded files are validated for type and format before being passed to the skill. Invalid files are rejected with a clear error. | P1 |
| ING-03 | File uploads support sizes up to 100 MB per file. | P1 |
| ING-04 | The connector framework makes adding future ingest sources (SharePoint, Google Drive, OneDrive, email, REDCap, CTMS) consistent and cheap. New connectors do not require changes to the skill execution layer. | P1 |
| ING-05 | Future ingest connectors include (not built in Phase 1, but architected for): SharePoint, Google Drive, OneDrive, ClinicalTrials.gov, email, Slack, Teams. | P3 |

---

## 5.6 Output Generation

*(BRD OUT-01, OUT-02; OUT-05 added 2026-06-18 — sprint-change-proposal-2026-06-18.md, Epic 5.5)*

| ID | Requirement | Priority |
|----|-------------|----------|
| OUT-01 | The platform generates PDF, PPTX, DOCX, and XLSX files as skill outputs, and **canonical JSON conforming to a versioned schema** as a structured data output alongside (or instead of) branded office files. A single skill invocation may produce **multiple artifacts** of mixed types. | P1 |
| OUT-02 | Generated files apply Vitalief brand standards by default (Open Sans body, Poppins/Nexa titles, Vitalief brand colors — teal/navy, headers, footers) unless the skill definition overrides specific elements. Brand assets are provided by Vitalief at Phase 1 kickoff. | P1 |
| OUT-03 | The output connector framework mirrors the ingest framework. New send-out destinations can be added without changes to the skill execution layer. | P1 |
| OUT-04 | Future send-out connectors (not built in Phase 1): SharePoint, Google Drive, OneDrive, Slack, Teams, ClickUp, Jira, Smartsheet, Vitalief dashboard. | P3 |
| OUT-05 | **Schema-versioned output contract.** The platform persists a skill's output schema and its `schema_version` as first-class metadata. A downstream skill declares the upstream schema (and version) it consumes, so a pipeline of skills binds to one canonical, versioned data contract. | P1 |

---

## 5.7 Access Control and IP Protection

*(BRD ACL-01 through ACL-05)*

| ID | Requirement | Priority |
|----|-------------|----------|
| ACL-01 | Access to skills is scoped by the hierarchy: a user must be assigned to the relevant Organization, Client, Project, and (where applicable) Study to invoke a skill within it. | P1 |
| ACL-02 | Internal-only skills are visible and invocable only by Vitalief users assigned to the relevant engagement. | P1 |
| ACL-03 | Client-facing skills are invocable by clients. The skill's instructions, code, reference files, and methodology content are never returned by any API surface or exposed in any response, log, or error. | P1 |
| ACL-04 | Clients see: skill name, description, invocation result, and output files. Nothing else. | P1 |
| ACL-05 | The client-facing API surface exposes only invocation endpoints (`invoke`). There are no `read-definition`, `read-instructions`, or `read-code` endpoints accessible to client-scoped tokens. | P1 |
| ACL-06 | Engagement leads can grant or revoke client access to specific skills without platform administrator involvement. | P2 |
| ACL-07 | In the client portal, clients see both Project-level skills (labelled "available across all studies") and Study-level skills within each Study. Both are invocable if the client has been granted access. Project-level skills are surfaced at the Project dashboard and repeated inside each Study view. | P1 |

---

## 5.8 Invocation

*(BRD INV-01 through INV-04)*

| ID | Requirement | Priority |
|----|-------------|----------|
| INV-01 | Skills can be invoked from Claude (claude.ai, Claude Code, Anthropic API) through the platform's API. The platform acts as an intermediary: Claude calls the platform endpoint, the platform resolves and executes the skill server-side, and returns only the output. Skill internals never leave the server. | P1 |
| INV-02 | Skills can be invoked from scripts and command-line tools via a documented REST API. | P1 |
| INV-03 | A minimal web interface supports skill management, certification workflow, and basic skill invocation for Phase 1. Full client-facing web portal is Phase 2. | P1 |
| INV-04 | Skills can be invoked from third-party surfaces (Slack, Teams, custom portals) via webhook or API. | P3 |

### Run UX — Two invocation modes in the web interface

The Run Console is not a top-level navigation destination. It is surfaced contextually in two modes:

**Context-first mode** (launched from the Engagements tree): The Client → Project → Study context is pre-scoped to the entity the user is viewing. The user selects a skill from those available at that level and runs it. This is the primary run path for consultants working within an active engagement.

**Skill-first mode** (launched from Skill Registry → skill detail): The skill is pre-selected and locked. The context picker is unrestricted — the consultant can select any Client, Project, or Study regardless of whether the skill is formally attached there. This supports ad-hoc runs and testing without requiring prior skill attachment.

| ID | Requirement | Priority |
|----|-------------|----------|
| INV-05 | The run interface is launched contextually — from the Engagements tree (context-first) or from a skill's detail view (skill-first). It is not a standalone top-level navigation item. | P1 |
| INV-06 | In context-first mode, the Client → Project → Study context is pre-populated from the originating entity. The user selects the skill to run. | P1 |
| INV-07 | In skill-first mode, the skill is pre-selected and locked. The context picker shows all Clients, Projects, and Studies without filtering by skill attachment. | P1 |
| INV-08 | Both run modes provide a back button that returns the user to the originating screen (Engagements entity or skill detail). | P1 |
| INV-09 | Skills attached at the Project level are visible and runnable from both the Project screen and from within each Study screen under that Project (shown as "available across all studies"). | P1 |

---

## 5.9 Certification and Validation Workflow

*(BRD CRT-01 through CRT-05)*

Certification and validation are a single unified workflow surface in the UI. There is no separate "Validation Queue" tab — skill validation (technical review) and methodological certification both appear in one governance view, progressing through the two-key sequence.

| ID | Requirement | Priority |
|----|-------------|----------|
| CRT-01 | Every skill submitted for `client-ready` status passes through a two-key certification workflow. Both keys must be recorded before the lifecycle state can advance to `client-ready`. | P1 |
| CRT-02 | **Technical certification (MA Technologies key):** Skill executes without error; handles representative and adversarial inputs; code passes review; security posture is appropriate; description correctly triggers invocation from Claude; outputs match declared output schema. | P1 |
| CRT-03 | **Methodological certification (Matt key):** Skill produces Vitalief-grade output; aligns with established methodology; voice and style match Vitalief standards. | P1 |
| CRT-04 | Both certifications are recorded against the specific skill version. A new version requires re-certification before it can become `client-ready`. | P1 |
| CRT-05 | The certification workflow records: certifier identity, certification type (technical/methodological), timestamp, skill ID and version, and any notes. This record is immutable. | P1 |

---

## 5.10 Outbound API and Connector Framework

*(BRD API-01, CON-01, CON-02)*

| ID | Requirement | Priority |
|----|-------------|----------|
| API-01 | Skills can make outbound API calls to external systems. Credentials for external systems are managed by the platform (stored securely, injected at execution time, never exposed in skill definitions). | P1 |
| CON-01 | Ingest and send-out connectors follow a documented framework. Adding a new connector requires implementing a defined interface, not modifying core platform code. | P1 |

---

## 5.11 Usage Tracking and Audit

*(BRD USE-01 through USE-04)*

| ID | Requirement | Priority |
|----|-------------|----------|
| USE-01 | Every skill invocation is logged: timestamp, user, organization, client, project, study (if applicable), location (if applicable), skill ID, skill version, runtime duration, outcome (success/failure), input reference, output reference. | P1 |
| USE-02 | Audit logs are append-only and immutable from the platform UI. | P1 |
| USE-03 | Usage logs are queryable by: organization, client, project, study, location, user, skill, time window, and outcome. | P1 |
| USE-04 | Access logs capture every skill invocation, every read of skill internals, and every administrative action. | P1 |
| USE-05 | Audit logs are retained for a minimum of seven years. | P2 |
| USE-06 | A value-reporting view summarizes usage data per engagement for renewal conversations with clients. | P2 |

---

## 5.12 Security and Compliance

*(BRD SEC-01 through SEC-08)*

| ID | Requirement | Priority |
|----|-------------|----------|
| SEC-01 | Platform is hosted on a BAA-eligible cloud provider with a signed BAA in place before any PHI-adjacent skill is deployed. Default assumption: AWS. | P1 |
| SEC-02 | Data at rest is encrypted with AES-256 or equivalent. | P1 |
| SEC-03 | Data in transit uses TLS 1.2 or higher. | P1 |
| SEC-04 | PHI is never written to URLs, log lines, or error messages. This is an architectural requirement enforced at the platform layer, not a skill-level guideline. | P1 |
| SEC-05 | A data handling policy is documented and reviewed by Vitalief before platform launch. | P1 |
| SEC-06 | The platform supports user authentication. Phase 1: username/password or API key. Phase 2: SSO compatible with Vitalief's identity provider. | P1/P2 |
| SEC-07 | A BAA between Vitalief and MA Technologies is executed before any PHI-adjacent skill is hosted. | P1 |
| SEC-08 | Audit logs are retained for a minimum of seven years, consistent with clinical research records norms. | P2 |

---

## 5.13 Portability

*(BRD POR-01 through POR-05)*

| ID | Requirement | Priority |
|----|-------------|----------|
| POR-01 | The platform is architected so a future variant can be deployed into a client environment without rewrite. | P1 |
| POR-02 | The platform uses containerization (Docker or equivalent) and infrastructure-as-code for repeatable deployments. | P1 |
| POR-03 | Vitalief-specific configuration (brand assets, org identity, feature flags) is parameterized, not hard-coded. | P1 |
| POR-04 | The platform avoids proprietary dependencies that would prevent client-side deployment. Open-source preferred. | P1 |
| POR-05 | A client-deployable variant is built when an engagement requires it. Not part of Phase 1. | P3 |

---
