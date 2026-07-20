# Requirements Inventory

## Functional Requirements

**Organizational Hierarchy (ORG)**
- FR-ORG-01 [P1]: The platform stores Organizations, Clients, Projects, Studies, and Locations as first-class entities with names, descriptions, and creation metadata.
- FR-ORG-02 [P1]: Studies are optional children of Projects. A Project with no Studies attaches skills directly at the Project level.
- FR-ORG-03 [P1]: **(Superseded 2026-07-20, Epic 16.)** Locations are children of Clients — created once per Client and reused across every Project/Study underneath it. A Study associates zero or more existing Client Locations (rather than owning distinct Location rows); the same physical site is entered once and reused, never re-created per Study.
- FR-ORG-04 [P1]: All access control policies, audit logs, and skill invocation records reference the full hierarchy path (Org → Client → Project → Study → Location where applicable).
- FR-ORG-05 [P1]: The data model supports multiple Organizations without schema changes, even though Phase 1 deploys with one.
- FR-ORG-06 [P1]: The Organization layer is never exposed in the UI. All user-facing paths, labels, and audit displays begin at the Client level. The UI nav section for this tree is labelled "Engagements."
- FR-ORG-07 [P1]: The Engagements screen provides an on-screen **search/filter** to locate a Client/Project among potentially hundreds. Phase 1: client-side search/filter (mock — operates on loaded data); server-side search is deferred (P2).

**Skill Registry and Lifecycle (REG)**
- FR-REG-01 [P1]: Skills are stored as versioned, immutable artifacts. Each version has a unique identifier.
- FR-REG-02 [P1]: Skill lifecycle states: `draft`, `internal_ready`, `client_ready`, `retired`. State drives invocation access.
- FR-REG-03 [P1]: Skills carry required metadata: name, description, author, created date, last modified date, lifecycle state, tags, runtime type (`prompt`, `code`, `hybrid`), visibility designation, input schema, output schema.
- FR-REG-04 [P1]: Skills have an optional scope: Project-level or Study-level, determining the **granularity at which the skill runs** — a Project-scoped skill runs in a Project's context, a Study-scoped skill runs in a Study's context. **(Clarified 2026-07-20, Epic 16.)** Scope is independent of *where a skill is attached* — attachment (FR-REG-10) only controls which part of the hierarchy a skill is reachable from; the skill's own scope alone determines where underneath that point it is actually invocable.
- FR-REG-05 [P1]: Skills carry one of three visibility designations: `internal_only`, `client_facing`, or `paired` (both versions exist with lineage tracked).
- FR-REG-06 [P1]: For Paired skills: the internal (parent) skill and the client-facing (derived) skill are linked via derivation lineage. Updates to the parent flag the derived skill for review before re-certification.
- FR-REG-07 [P1]: Skill descriptions are first-class artifacts. A skill with an inadequate description does not pass technical certification.
- FR-REG-08 [P2]: Skill versions can be pinned to specific Projects or Engagements, isolating them from later changes until explicitly upgraded.
- FR-REG-09 [P2]: Retired skills remain in the registry for audit but cannot be invoked.
- FR-REG-10 [P1]: **(Added 2026-07-20, Epic 16.)** A skill may be attached at the Client level. A Client-attached skill becomes available at every node under that Client matching the skill's own scope (every Project if Project-scoped, every Study if Study-scoped) — without being re-attached individually at each one.

**Skill Execution (EXE)**
- FR-EXE-01 [P1]: The platform supports prompt-based skills — an instruction set, context, and optional reference files passed to an LLM.
- FR-EXE-02 [P1]: The platform supports code-based skills — executable Python that produces output deterministically.
- FR-EXE-03 [P1]: The platform supports hybrid skills — an LLM orchestrates the execution and calls code helpers as tools.
- FR-EXE-04 [P1]: Skill execution is logged: start time, end time, success/failure, input reference, output reference, invoking user, full hierarchy context.
- FR-EXE-05 [P1]: Skill execution is sandboxed. A misbehaving skill cannot affect other skills or platform stability.
- FR-EXE-06 [P2]: Skills can call other skills as subroutines. The full call chain is logged for audit.

**Location-Dependent Skills (LOC)**
- FR-LOC-01 [P1]: A skill definition can declare itself location-dependent, indicating that it requires or produces location-specific output.
- FR-LOC-02 [P1]: When a location-dependent skill is invoked without a location selected, the platform prompts the invoker to select a Location before execution proceeds.
- FR-LOC-03 [P1]: The invoker may choose to run the skill across all Locations in the Study — platform fans out parallel invocations, one per Location, and returns aggregated results.
- FR-LOC-04 [P1]: Multi-invocation runs (LOC-03) are logged as a single parent invocation containing one child log entry per Location.
- FR-LOC-05 [P1]: Skills that are not location-dependent receive no location prompt and do not fan out.
- FR-LOC-06 [P1]: Location entities store a postal code as a required field (Medicare benefits eligibility, injected as context into location-dependent skill invocations).

**Document Ingest (ING)**
- FR-ING-01 [P1]: The platform accepts PDF, DOCX, and XLSX file uploads as inputs to skills. Multiple files may be uploaded per invocation.
- FR-ING-02 [P1]: Uploaded files are validated for type and format before being passed to the skill. Invalid files are rejected with a clear error.
- FR-ING-03 [P1]: File uploads support sizes up to 100 MB per file.
- FR-ING-04 [P1]: The connector framework makes adding future ingest sources consistent and cheap. New connectors do not require changes to the skill execution layer.
- FR-ING-05 [P1]: **(Added 2026-07-20, Epic 16.)** A protocol document may be uploaded once, at Study creation (or added later via Study edit for Studies that predate this capability), and is automatically available to skills run within that Study — without re-uploading at every invocation. A skill may declare that it needs documents beyond the Study's protocol; the Run Console upload affordance remains available for that case, and is otherwise optional.

**Output Generation (OUT)**
- FR-OUT-01 [P1]: The platform generates PDF, PPTX, DOCX, and XLSX files as skill outputs.
- FR-OUT-02 [P1]: Generated files apply Vitalief brand standards by default (Open Sans body, Poppins/Nexa titles, Vitalief brand colors — teal/navy, headers, footers). Brand assets provided by Vitalief at kickoff.
- FR-OUT-03 [P1]: The output connector framework mirrors the ingest framework. New send-out destinations can be added without changes to the skill execution layer.

**Access Control and IP Protection (ACL)**
- FR-ACL-01 [P1]: Access to skills is scoped by the hierarchy: a user must be assigned to the relevant Client, Project, and Study to invoke a skill within it.
- FR-ACL-02 [P1]: Internal-only skills are visible and invocable only by Vitalief users assigned to the relevant engagement.
- FR-ACL-03 [P1]: Client-facing skills are invocable by clients. The skill's instructions, code, reference files, and methodology content are never returned by any API surface.
- FR-ACL-04 [P1]: Clients see: skill name, description, invocation result, and output files. Nothing else.
- FR-ACL-05 [P1]: The client-facing API surface exposes only invocation endpoints. There are no read-definition, read-instructions, or read-code endpoints accessible to client-scoped tokens.
- FR-ACL-06 [P2]: Engagement leads can grant or revoke client access to specific skills without platform administrator involvement.
- FR-ACL-07 [P1]: In the client portal, clients see both Project-level skills ("available across all studies") and Study-level skills. Both are invocable if access is granted.

**Invocation and Run UX (INV)**
- FR-INV-01 [P1]: Skills can be invoked from Claude (claude.ai, Claude Code, Anthropic API) through the platform's API. The platform acts as intermediary; skill internals never leave the server.
- FR-INV-02 [P1]: Skills can be invoked from scripts and command-line tools via a documented REST API.
- FR-INV-03 [P1]: A minimal web interface supports skill management, certification workflow, and basic skill invocation.
- FR-INV-04 [P3]: Skills can be invoked from third-party surfaces (Slack, Teams, custom portals) via webhook or API.
- FR-INV-05 [P1]: The run interface is launched contextually — from the Engagements tree (context-first) or from a skill's detail view (skill-first). It is not a standalone top-level navigation item.
- FR-INV-06 [P1]: In context-first mode, the Client → Project → Study context is pre-populated. The user selects the skill to run.
- FR-INV-07 [P1]: In skill-first mode, the skill is pre-selected and locked. The context picker shows all Clients, Projects, and Studies without filtering by skill attachment.
- FR-INV-08 [P1]: Both run modes provide a back button that returns the user to the originating screen.
- FR-INV-09 [P1]: Skills attached at the Client level are visible and runnable at every Project (if Project-scoped) or every Study (if Study-scoped) under that Client. Skills attached at the Project level are visible and runnable from both the Project screen and from within each Study screen under that Project. **(Extended 2026-07-20, Epic 16.)**

**Certification and Validation (CRT)**
- FR-CRT-01 [P1]: Every skill submitted for `client_ready` status passes through a two-key certification workflow. Both keys must be recorded before the state can advance.
- FR-CRT-02 [P1]: Technical certification (MA Technologies key): skill executes without error, handles representative and adversarial inputs, code passes review, description correctly triggers invocation from Claude, outputs match declared schema.
- FR-CRT-03 [P1]: Methodological certification (Matt key): skill produces Vitalief-grade output, aligns with established methodology, voice and style match Vitalief standards.
- FR-CRT-04 [P1]: Both certifications are recorded against the specific skill version. A new version requires re-certification before it can become `client_ready`.
- FR-CRT-05 [P1]: The certification workflow records: certifier identity, certification type, timestamp, skill ID and version, and any notes. This record is immutable.

**Outbound API and Connector Framework (API/CON)**
- FR-API-01 [P1]: Skills can make outbound API calls to external systems. Credentials are managed by the platform (stored securely, injected at execution time, never exposed in skill definitions).
- FR-CON-01 [P1]: Ingest and send-out connectors follow a documented framework. Adding a new connector requires implementing a defined interface, not modifying core platform code.

**Usage Tracking and Audit (USE)**
- FR-USE-01 [P1]: Every skill invocation is logged: timestamp, user, full hierarchy context, skill ID and version, runtime duration, outcome, input reference, output reference.
- FR-USE-02 [P1]: Audit logs are append-only and immutable from the platform UI.
- FR-USE-03 [P1]: Usage logs are queryable by: client, project, study, location, user, skill, time window, and outcome.
- FR-USE-04 [P1]: Access logs capture every skill invocation, every read of skill internals, and every administrative action.
- FR-USE-05 [P2]: Audit logs are retained for a minimum of seven years.
- FR-USE-06 [P1]: Usage analytics — the platform surfaces **aggregate (Overview)** and **per-user** usage/value metrics (invocations, success rate, top skills, runtime, value/hours-saved, breakdown by invocation surface) in a **Usage & Value** screen. Per-user analysis lets an operator select an individual user and analyze their metrics.
- FR-USE-07 [P1]: **(Added 2026-07-20, Epic 15.)** Every skill invocation that makes an LLM call records its own token counts and computed dollar cost as a durable, queryable fact of that execution — not only as an input to a platform-wide aggregate. Cost is surfaced per-invocation (Job detail), per-skill, and per-user (extending the existing Usage & Value screen), and a code-runtime or failed/cancelled invocation records an explicit zero/null cost rather than being silently excluded from any total. The same pricing applies to the AI integration assistant's skill-adaptation LLM calls (`propose_adapter`, Epic 11/14) — a separate spend path, priced and surfaced in the Audit Log.
- FR-USE-08 [P1]: **(Added 2026-07-20, Epic 16.)** A Project or Study detail screen surfaces the outputs of skills that were run in that context (a hierarchy-scoped view of recent invocations), not only the global Jobs History list.

**Security and Compliance (SEC)**
- FR-SEC-01 [P1]: Platform is hosted on a BAA-eligible cloud provider with a signed BAA in place before any PHI-adjacent skill is deployed.
- FR-SEC-02 [P1]: Data at rest is encrypted with AES-256 or equivalent.
- FR-SEC-03 [P1]: Data in transit uses TLS 1.2 or higher.
- FR-SEC-04 [P1]: PHI is never written to URLs, log lines, or error messages. Enforced at the platform layer.
- FR-SEC-05 [P1]: A data handling policy is documented and reviewed by Vitalief before platform launch.
- FR-SEC-06 [P1/P2]: Platform supports user authentication. Phase 1: username/password. Phase 2: SSO.
- FR-SEC-07 [P1]: A BAA between Vitalief and MA Technologies is executed before any PHI-adjacent skill is hosted.
- FR-SEC-08 [P1]: The platform is governed by **HIPAA** (PHI safeguards per FR-SEC-01–07) and built to **21 CFR Part 11** (electronic records & signatures). Both are named, first-class compliance frameworks for the platform.
- FR-SEC-09 [P1]: 21 CFR Part 11 — electronic records: the audit log is secure, computer-generated, UTC-time-stamped, attributable to a unique user, and tamper-evident (append-only). _(Epic 9)_
- FR-SEC-10 [P1]: 21 CFR Part 11 — electronic signatures: certification approvals are electronic signatures recording the signer's identity, UTC timestamp, and the **meaning** of the signature; each signature is bound immutably to the signed skill version. _(Epic 6)_
- FR-SEC-11 [P1]: 21 CFR Part 11 — access & authority: unique user identification (authentication) plus hierarchy-scoped RBAC restrict system access and signing authority to authorized individuals. _(Epic 7/8)_
- FR-SEC-12 [P2 / deferred]: Formal computer-system validation (IQ/OQ/PQ), validation documentation, and full electronic-signature non-repudiation. Phase 1 produces a validation plan + compliance-clause mapping; full execution is deferred to a tracked compliance backlog.

> **Added 2026-07-13 (Epic 13).** FR-SEC-08 names **HIPAA** and 21 CFR Part 11 as co-equal, first-class frameworks — but FR-SEC-09 through FR-SEC-12 decompose **only the Part 11 half**. HIPAA's Security Rule audit/accountability obligations were never turned into requirements, so no story ever carried them; a code-verified gap analysis found the audit log records only the **write** path (who ran, who granted) and never the **read** path or the **auth** path, and that user deprovisioning does not exist at all. FR-SEC-13..17 close that decomposition gap. _(Epic 13; see `velara-api/docs/hipaa-security-rule-mapping.md` and `soc2-control-matrix.md`.)_

- FR-SEC-13 [P1]: **HIPAA §164.312(b) — audit controls cover ACCESS, not only mutation.** Every disclosure of a PHI-bearing artifact (ingested document, parsed text, skill output) is recorded in the audit trail, attributable to a user and a UTC time. Minting a presigned download URL **is** the disclosure and is the auditable act. _(Epic 13.3)_
- FR-SEC-14 [P1]: **HIPAA §164.308(a)(5)(ii)(C) — log-in monitoring.** Authentication activity — successful login, **failed login**, logout, session/token revocation, credential reset — is recorded and monitorable, with alarming on anomalous patterns (brute force, credential stuffing). _(Epic 13.4)_
- FR-SEC-15 [P1]: **SOC 2 CC6.3 / HIPAA §164.308(a)(3)(ii)(C) — access can be REMOVED.** A user's platform access can be revoked (disabled) through the platform, promptly and with an audit record, and active sessions are invalidated — not merely prevented from renewing. Role modification is likewise possible and audited. _(Epic 13.2)_
- FR-SEC-16 [P1]: **SOC 2 CC7.1/CC7.2 — detective controls.** Cloud control-plane and data-plane activity (CloudTrail, S3/ALB access logging) is captured sufficiently to investigate a security incident, including actions taken out-of-band via the AWS console. _(Epic 13.5)_
- FR-SEC-17 [P2]: **HIPAA §164.528 — accounting of disclosures.** The platform can produce, for a given document/subject over a date range, an accounting of who accessed or received the data. _(Epic 13.3 provides the events; the reporting surface is P2.)_

**Portability (POR)**
- FR-POR-01 [P1]: The platform is architected so a future variant can be deployed into a client environment without rewrite.
- FR-POR-02 [P1]: The platform uses containerization (Docker) and infrastructure-as-code for repeatable deployments.
- FR-POR-03 [P1]: Vitalief-specific configuration (brand assets, org identity, feature flags) is parameterized, not hard-coded.
- FR-POR-04 [P1]: The platform avoids proprietary dependencies that would prevent client-side deployment.

---

## NonFunctional Requirements

- NFR-01: Platform overhead per skill invocation (excluding skill runtime) ≤ 2 seconds at P95.
- NFR-02: Concurrent skill executions at launch ≥ 10, with headroom to scale.
- NFR-03: Maximum file upload size: 100 MB per file.
- NFR-04: Monthly uptime during Vitalief business hours ≥ 99.5% from launch.
- NFR-05: Zero silent failures — every execution failure is logged and surfaced to the invoker.
- NFR-06: Skill artifacts and audit log backup: daily, with off-site retention.
- NFR-07: Data at rest encrypted with AES-256.
- NFR-08: Data in transit encrypted with TLS 1.2+.
- NFR-09: PHI never written to URLs, log lines, or error messages — architectural enforcement, not a guideline.
- NFR-10: All code delivered to and residing in a Vitalief-owned repository from Phase 1 day one.
- NFR-11: Platform documented at a level that supports handover to a different vendor.
- NFR-12: Data hosted in the United States by default.
- NFR-13: BAA in place with cloud provider and MA Technologies before PHI-adjacent skills are deployed.

---

## Additional Requirements

_From Architecture document — technical requirements that affect implementation:_

- ARCH-01: Multi-repo structure: `velara` (hub/docs), `velara-api` (FastAPI), `velara-web` (Vite + React). BMad planning artifacts in hub; service repos get BMad for story execution only.
- ARCH-02: Stack — FastAPI (Python 3.12+) + SQLAlchemy async + Alembic + PostgreSQL (AWS RDS) + ltree extension + Celery + Redis (AWS ElastiCache) + S3 + AWS ECS Fargate + ECR + Terraform + GitHub Actions.
- ARCH-03: AWS Cognito for authentication (HIPAA-eligible, SSO-ready for Phase 2). Token flow: Cognito JWT → FastAPI validation → hierarchy scope resolution → filtered DB queries.
- ARCH-04: `hierarchy_path` ltree column on every hierarchical entity. All queries include `path <@ :scope_path` filter applied in FastAPI dependency — not in individual route handlers.
- ARCH-05: Skill artifact stored as compiled artifact — versioned record with encrypted prompt/code content. No API route for client-scoped tokens exposes the skill internals table.
- ARCH-06: All skill executions go through Celery async job queue: POST → 202 Accepted + job_id → client polls `/api/v1/jobs/{job_id}`. Fan-out uses Celery chord: N parallel `run_skill` tasks + `aggregate_results` parent.
- ARCH-07: PHI sanitizer middleware (structlog) strips PHI-pattern fields before any log write. Sentry `before_send` hook uses the same sanitizer. File content always by S3 key reference — never inline.
- ARCH-08: Observability stack: structlog + CloudWatch Logs + CloudWatch Metrics (aws-embedded-metrics) + AWS X-Ray (distributed tracing) + Sentry (API + frontend error tracking). Health endpoints: `GET /health` + `GET /health/ready`.
- ARCH-09: All secrets in AWS Secrets Manager — injected via ECS task environment, never hardcoded or in env files.
- ARCH-10: Three ECS services per environment (dev/staging/prod): `velara-api` (FastAPI + Uvicorn), `velara-worker` (Celery), `velara-web` (CloudFront + S3). VPC with private subnets for RDS + ElastiCache + ECS tasks; public subnet for ALB only.
- ARCH-11: API response envelope required on all routes: `{"data": {...}, "meta": {"request_id": "...", "timestamp": "..."}}`. Error envelope: `{"error": {"code": "SCREAMING_SNAKE_CASE", "message": "...", "request_id": "..."}}`.
- ARCH-12: Request ID (UUID) assigned at start of every request; carried through logs, response meta, and error envelopes.
- ARCH-13: Repository initialization and base project scaffolding must be the first stories — foundational for all subsequent work.

---

## UX Design Requirements

_From design/ prototype (Velara v3.html, overrides.jsx, styles_v3.css, data.js) — V3 Vitalief brand theme (2026-06-09):_

- UX-DR-01: Landing page is the Engagements screen (hierarchy tree). "Engagements" is the first and default nav tab.
- UX-DR-02: Navigation is a horizontal top tab strip (not a sidebar). Active item underlined in brand teal. Nav items: Engagements, Skill Registry, Certification, Usage & Value (Analytics), Audit Log, Admin (internal portal); Client portal has its own tab structure.
- UX-DR-03: Unified AppBar: Velara brand wordmark, context URL, search (⌘K), role switcher (Vitalief team ↔ Client portal), and user avatar in one navy/teal brand bar.
- UX-DR-04: Design tokens from `styles_v3.css` ported to Tailwind config: Vitalief brand palette (teal `#128F8B`, navy `#323843`, slate `#4C5270`, pink `#F652A0` accent), spacing scale, typography (Poppins headings, Open Sans body; Nexa headings when licensed), shadow depths, hover states (teal-tinted table row hover). _(Re-themed to V3 brand 2026-06-09 — see Epic 1 Story 1.6.)_
- UX-DR-05: Run Console is NOT in the nav. Surfaced via "Run" button on Skill Detail (skill-first mode) and via "Run" button on skill chips in Engagement child screens (context-first mode).
- UX-DR-06: Back button in Run Console — persists across re-renders; returns user to originating screen (Engagement entity or Skill Detail).
- UX-DR-07: Skill-first run mode: skill card shown first (green tint, locked), then unrestricted context picker showing all clients/projects/studies. Skill dropdown hidden.
- UX-DR-08: Certification + Validation are a single unified governance UI surface. No separate "Validation Queue" tab.
- UX-DR-09: Client portal shows project-level skills ("Project-wide" badge) above study-level skills in both Project dashboard and Study detail views. "Available skills" hero count includes project-level skills.
- UX-DR-10: Add Location modal includes Postal Code as a required field (positioned after City field).
- UX-DR-11: Separate route trees for `/internal/*` and `/client/*` with role-based RequireAuth guards on each.
- UX-DR-12: Skeleton loaders for initial page loads; spinner overlay for in-progress mutations. TanStack Query `isLoading`/`isFetching`/`isError` states — no hand-rolled loading booleans.
- UX-DR-13: Usage & Value (Analytics) screen has two tabs — **Overview** (aggregate metrics, top skills, usage series, value/hours-saved) and **By User** (select an individual user to analyze their invocations, success rate, top skills, surfaces, and recent activity). [Source: design `internal2.jsx` → `Analytics`]
- UX-DR-14: The browser tab title reflects the current page/entity — e.g. `Protocol Feasibility · Study · Velara`, `Skill Registry · Velara` — so multiple open tabs are distinguishable (replaces the generic "Velara" label).

---

## FR Coverage Map

> **Remapped 2026-06-05** to the resequenced epics (see `sprint-change-proposal-2026-06-05.md`). HIPAA/cloud security (FR-SEC) and IaC (FR-POR-02) now land in Epic 7; Phase-1 auth (FR-SEC-06) is split: dev-auth shim in Epic 1, Cognito in Epic 7.
> **Updated 2026-06-08** (see `sprint-change-proposal-2026-06-08.md`): added compliance (FR-SEC-08–12, HIPAA + 21 CFR Part 11), usage analytics (FR-USE-06), and Engagements search (FR-ORG-07).

| FR | Epic | Description |
|----|------|-------------|
| FR-SEC-04 | Epic 1 | PHI never in logs/URLs/errors — PHI sanitizer in scaffolds |
| FR-SEC-06 (Phase 1, dev-auth) | Epic 1 | Local dev-auth shim issuing the Cognito JWT claims contract |
| FR-POR-01, 03, 04 | Epic 1 | Architected for client deploy, parameterized config, open-source stack, provider abstractions |
| FR-REG-01–07 | Epic 2 | Skill versioning, lifecycle, metadata, visibility, paired lineage |
| FR-EXE-01–05 | Epic 3 | Prompt, code, hybrid runtimes; sandboxed; execution logging |
| FR-LOC-01–05 | Epic 3 | Location-dependent flag, prompt-to-select, fan-out (Story 3.7 deferred → Epic 4), aggregation |
| FR-ING-01–04 | Epic 3 | PDF/DOCX/XLSX ingest, validation, 100 MB, connector framework (via StorageProvider) |
| FR-OUT-01–03 | Epic 3 | Branded PDF/PPTX/DOCX/XLSX output, connector framework |
| FR-API-01 | Epic 3 | Outbound API calls from skills, credential injection (via SecretsProvider) |
| FR-CON-01 | Epic 3 | Connector interface, no core changes for new connectors |
| FR-ORG-01–07 | Epic 4 | Full hierarchy CRUD, org hidden from UI, "Engagements" label, on-screen search/filter (mock) |
| FR-LOC-06 | Epic 4 | Postal code on Location entities |
| FR-INV-01–03 | Epic 5 | Claude proxy, REST API, web invocation |
| FR-INV-05–09 | Epic 5 | Run Console contextual modes, back button, project-level skill visibility |
| FR-CRT-01–05, FR-SEC-10 | Epic 6 | Two-key certification workflow, immutable records, 21 CFR Part 11 electronic-signature manifestation (signer, UTC time, meaning) |
| FR-SEC-01, 02, 03, 05, 07 | Epic 7 | BAA-eligible AWS hosting, AES-256 at rest, TLS in transit, data-handling policy, MA Tech BAA |
| FR-SEC-06 (Phase 1, Cognito) | Epic 7 | AWS Cognito auth — swaps the Epic 1 dev-auth shim (same AuthProvider contract) |
| FR-POR-02 | Epic 7 | Containerization + IaC (Terraform) for repeatable deployments |
| FR-ACL-01–05, 07 | Epic 8 | RBAC, client portal, IP protection, client-facing API surface |
| FR-USE-01–04, 06; FR-SEC-09 | Epic 9 | Audit log (append-only, queryable, Part 11 attributable/tamper-evident; write-path in Epic 3) + Usage & Value analytics (Overview + per-user) |
| FR-SEC-08 (HIPAA) | Cross-cutting (E1, E7, E8, E9) | HIPAA named framework — PHI safeguards, BAA, encryption, audit |
| FR-SEC-11 (Part 11 access) | Epic 7 + Epic 8 | Unique user IDs + auth (Cognito) and hierarchy-scoped RBAC / authority checks |
| FR-USE-07 | Epic 15 | Per-invocation/per-skill/per-user cost tracking + priced AI-adapter-propose LLM spend |
| FR-ORG-03 (superseded), FR-REG-04 (clarified), FR-INV-09 (extended), FR-REG-10, FR-ING-05, FR-USE-08 | Epic 16 | Client-owned Locations + Study association; Client-level skill attachment; Study-creation-time protocol upload; hierarchy-scoped run history |
| UX-DR-14 (tab title) | Epic 1 (Story 1.5) | Per-page browser tab title (app shell) |

_P2/P3 FRs deferred (not in Phase 1 epics): FR-REG-08/09, FR-EXE-06, FR-ING-05, FR-OUT-04, FR-ACL-06, FR-INV-04, FR-USE-05, FR-SEC-12 (formal 21 CFR Part 11 system validation / IQ-OQ-PQ)_

---
