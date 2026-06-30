# Epic List

> **Resequenced 2026-06-05** (see `sprint-change-proposal-2026-06-05.md`). Original order was infrastructure-first. Because the client's AWS account and GitHub repos are not yet provisioned, cloud provisioning was relocated to Epic 7 and feature epics (Skill Registry, Skill Execution) were prioritized to run locally first. Mapping: old E3→E2, old E4→E3, old E2→E4, new E7 (infra), old E7→E8, old E8→E9.
>
> **Updated 2026-06-08** (see `sprint-change-proposal-2026-06-08.md`): client design changes + compliance. Epic 9 expanded to **Audit Log, Usage & Analytics** (new analytics API + UI stories); Epic 1 gains a per-page tab-title story (1.5); Epics 4/6/7 gain ACs; **HIPAA + 21 CFR Part 11** are now named compliance frameworks.
>
> **Updated 2026-06-09** (see `sprint-change-proposal-2026-06-09.md`): V3 brand re-theme. Client brand guidelines drive a new palette (teal/navy/slate/pink) and typography (Poppins/Open Sans). Epic 1 gains **Story 1.6** (apply V3 brand theme); design-token references across architecture, UX-DR-02/03/04, branded output (Epic 3), and PRD §13 updated v2→v3.
>
> **Added 2026-06-18** (see `sprint-change-proposal-2026-06-18.md`): the client delivered the first real foundation skill (`velara-protocol-extractor`), a **code-driven hybrid** the current hybrid runtime cannot host. **New Epic 5.5** (positioned right after Epic 5) widens the hybrid runtime for code-driven trusted skills (multi-file bundle, deps, egress, injected secrets, raw-file input) and adds a schema-versioned canonical output contract + `blocked` QA job state. **Epics 2 & 3 stay `done`** (forward FR amendments only, no reopen). Phase-1 isolation = per-skill venv; container isolation deferred to an Epic 7 story. Headline gate = the client skill running **end-to-end** on the platform. _(Renumbered 2026-06-25: created as Epic 10, moved to **5.5** to sit where it belongs by dependency; Epics 6–9 keep their numbers.)_

## Epic 1: Platform Foundation & Local Dev Environment
Developers can run the full platform locally — FastAPI + Celery + Redis + PostgreSQL + local object storage (MinIO/LocalStack) — behind provider abstractions (storage, secrets, auth) that make the eventual AWS swap a configuration change. A dev-auth shim issues the same JWT claims contract (`user_id`, `org_id`, role) Cognito will later provide. HIPAA controls (PHI sanitizer, S3-key-reference pattern, append-only audit, structured logging) ship from the first commit. **AWS provisioning, CI/CD, Cognito, and cloud observability move to Epic 7** — removing the AWS-account dependency from the critical path.

**FRs covered:** FR-SEC-04, FR-SEC-06 (Phase 1 dev-auth subset), FR-POR-01, FR-POR-03, FR-POR-04
**Also covers:** ARCH-01, ARCH-04–07, ARCH-11–13, NFR-09, UX-DR-02, UX-DR-03, UX-DR-04, UX-DR-11, UX-DR-12, UX-DR-14 (Story 1.5 — per-page browser tab title)

---

## Epic 2: Skill Registry & Lifecycle
MA Tech and consultants can register, version, tag, and manage skills through their full lifecycle (`draft` → `internal_ready` → `client_ready` → `retired`) with all required metadata, three visibility designations (`internal_only`, `paired`, `client_facing`), and paired-skill derivation lineage tracking. Skill descriptions are enforced as first-class artifacts required for technical certification. Skill artifact content is stored via the `StorageProvider` (local backend in dev). Runs fully on the local stack.

**FRs covered:** FR-REG-01, FR-REG-02, FR-REG-03, FR-REG-04, FR-REG-05, FR-REG-06, FR-REG-07

---

## Epic 3: Skill Execution Engine
Consultants can execute prompt, code, and hybrid skills with document ingest (PDF/DOCX/XLSX up to 100 MB via presigned upload through the `StorageProvider`), location-dependent single-site and fan-out parallel execution (Celery chord), and branded output generation (PDF/PPTX/DOCX/XLSX) — all through the async job pipeline with full invocation logging. External API credential injection (via `SecretsProvider`) and the connector framework interface are implemented. Claude/Anthropic API calls require only an API key (no AWS).

**FRs covered:** FR-EXE-01, FR-EXE-02, FR-EXE-03, FR-EXE-04, FR-EXE-05, FR-LOC-01, FR-LOC-02, FR-LOC-03, FR-LOC-04, FR-LOC-05, FR-ING-01, FR-ING-02, FR-ING-03, FR-ING-04, FR-OUT-01, FR-OUT-02, FR-OUT-03, FR-API-01, FR-CON-01
**Sequencing:** Story 3.7 (Location-Dependent Fan-Out) depends on Epic 4 (Hierarchy/Locations) — deferred until Epic 4 lands or run against seed locations. Stories 3.1–3.6 and 3.8 have no hierarchy dependency.

---

## Epic 4: Engagement Hierarchy Management
Consultants and admins can create, browse, and manage the full Client → Project → Study → Location tree from the Engagements landing screen. Locations carry a required postal code. The Organization layer is invisible across all UI surfaces. All hierarchy entities store ltree paths used by RBAC and audit throughout the platform. (Sequenced after Execution per the 2026-06-05 resequencing; unblocks fan-out and context-first Run Console.)

**FRs covered:** FR-ORG-01, FR-ORG-02, FR-ORG-03, FR-ORG-04, FR-ORG-05, FR-ORG-06, FR-ORG-07 (on-screen search/filter — Phase 1 mock), FR-LOC-06
**Also covers:** UX-DR-01, UX-DR-10 · breadcrumbs now explicitly include Project/Study/Location (Story 4.4)

---

## Epic 5: Run Console & Invocation UX
Consultants can invoke skills from the web UI in two contextual modes — context-first (from an Engagement entity, hierarchy pre-scoped) and skill-first (from Skill Registry detail view, unrestricted context picker) — with back-button navigation to the originating screen. Job status polls until complete and output is displayed. Skills are also invokable from Claude (proxy pattern) and via REST API. Project-level skills are visible and runnable from within Study screens. (Now correctly lands after both Execution and Hierarchy.)

**FRs covered:** FR-INV-01, FR-INV-02, FR-INV-03, FR-INV-05, FR-INV-06, FR-INV-07, FR-INV-08, FR-INV-09
**Also covers:** UX-DR-05, UX-DR-06, UX-DR-07

---

## Epic 5.5: Code-Driven Hybrid Skills & Canonical Output Contract
The hybrid runtime is widened to host **code-driven, trusted** hybrid skills (multi-file bundle, third-party deps, network egress, platform-injected secrets, raw-file input) — the shape the client's first foundation skill (`velara-protocol-extractor`) requires — without adding a new `runtime_type`. The platform gains a first-class **schema-versioned canonical output contract** so the downstream skill pipeline (coding → coverage → budget → CTA → ops) binds to one model, plus a **`blocked`** QA job state. Phase-1 isolation is a per-skill venv; true container isolation is deferred to an Epic 7 story. **Headline gate: the client skill runs end-to-end on the platform.** (Sequenced after Epic 5; Epics 2 & 3 stay `done`.)

**FRs covered:** FR-EXE-03 (amended), FR-EXE-05 (qualified — tiered sandbox), FR-REG-03 (activated — schemas load-bearing), FR-ING-01 (extended — raw-file-by-reference), FR-OUT-01 (extended — canonical JSON + multi-artifact), FR-OUT-05 (new — schema-versioned output contract), FR-EXE-09 (new — `blocked` QA state)
**Defers to Epic 7:** container/kernel isolation hardening (replaces Phase-1 venv)

---

---

## Epic 6: Certification & Governance
MA Tech and Matt Maxwell can execute the unified two-key certification workflow — technical certification (MA Tech key) followed by methodological certification (Matt key) — advancing skills from `internal_ready` to `client_ready`. Both keys are recorded immutably against the specific skill version. Re-certification is required on any new version. The certification + validation UI is a single unified governance surface (no separate queue tabs).

**FRs covered:** FR-CRT-01, FR-CRT-02, FR-CRT-03, FR-CRT-04, FR-CRT-05, FR-SEC-10 (21 CFR Part 11 electronic-signature manifestation: signer, UTC time, meaning, bound to version)
**Also covers:** UX-DR-08

---

## Epic 7: Infrastructure, Deployment & Cloud Auth
The platform is provisioned onto HIPAA-eligible AWS infrastructure via Terraform (dev/staging/prod), deployed through GitHub Actions CI/CD, secured with AWS Cognito (swapping the Epic 1 dev-auth shim — a config change thanks to the shared `AuthProvider` contract), and observable via CloudWatch + X-Ray. Lands just before client-facing go-live, satisfying the HIPAA + 21 CFR Part 11 gate (BAA + infra provisioned before any PHI-adjacent skill is hosted). Story 7.4 also delivers the **compliance-clause mapping + 21 CFR Part 11 validation plan** (full IQ/OQ/PQ execution deferred — FR-SEC-12). **Prerequisite: client AWS account + Vitalief-owned GitHub repos provisioned.** Stories originated as Epic 1 stories 1.3–1.6.

**FRs covered:** FR-SEC-01, FR-SEC-02, FR-SEC-03, FR-SEC-05, FR-SEC-06 (Phase 1 Cognito), FR-SEC-07, FR-SEC-11, FR-POR-02 · _Part 11 compliance mapping + validation plan (FR-SEC-12 deferred)_
**Also covers:** ARCH-02, ARCH-03, ARCH-08, ARCH-09, ARCH-10, NFR-07, NFR-08, NFR-10, NFR-12, NFR-13

---

## Epic 8: Access Control & Client Portal
Clients can access a dedicated portal to invoke client-facing skills and receive outputs — with project-level skills surfaced above study-level skills. Hierarchy-scoped RBAC is fully enforced across all API routes. Skill internals are structurally blocked from client-scoped tokens at the API router level (not just permissions). Internal-only and client-facing skill visibility is enforced end-to-end.

**FRs covered:** FR-ACL-01, FR-ACL-02, FR-ACL-03, FR-ACL-04, FR-ACL-05, FR-ACL-07
**Also covers:** UX-DR-09

---

## Epic 9: Audit Log, Usage & Analytics
Operators and consultants can query the immutable, append-only audit log by any combination of hierarchy path, user, skill, time window, and outcome. Every invocation — including fan-out child records with parent linkage — is accurately captured. Access logs record every administrative action. A **Usage & Value (Analytics)** screen adds an aggregate **Overview** and a per-user **By-User** view (select an individual user and analyze their metrics). The audit log also serves as the **21 CFR Part 11** electronic-records trail (secure, UTC-time-stamped, attributable, tamper-evident). (Audit write-path is established earlier in Epic 3; this epic delivers the query API, audit UI, and the analytics API + UI.)

**FRs covered:** FR-USE-01, FR-USE-02, FR-USE-03, FR-USE-04, FR-USE-06 (usage analytics — Overview + per-user), FR-SEC-09 (Part 11 audit-trail attributes)
**Also covers:** UX-DR-13 (Analytics Overview + By-User)

---
