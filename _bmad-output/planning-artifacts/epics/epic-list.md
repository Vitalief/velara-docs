# Epic List

> **Resequenced 2026-06-05** (see `sprint-change-proposal-2026-06-05.md`). Original order was infrastructure-first. Because the client's AWS account and GitHub repos are not yet provisioned, cloud provisioning was relocated to Epic 7 and feature epics (Skill Registry, Skill Execution) were prioritized to run locally first. Mapping: old E3→E2, old E4→E3, old E2→E4, new E7 (infra), old E7→E8, old E8→E9.
>
> **Updated 2026-06-08** (see `sprint-change-proposal-2026-06-08.md`): client design changes + compliance. Epic 9 expanded to **Audit Log, Usage & Analytics** (new analytics API + UI stories); Epic 1 gains a per-page tab-title story (1.5); Epics 4/6/7 gain ACs; **HIPAA + 21 CFR Part 11** are now named compliance frameworks.
>
> **Updated 2026-06-09** (see `sprint-change-proposal-2026-06-09.md`): V3 brand re-theme. Client brand guidelines drive a new palette (teal/navy/slate/pink) and typography (Poppins/Open Sans). Epic 1 gains **Story 1.6** (apply V3 brand theme); design-token references across architecture, UX-DR-02/03/04, branded output (Epic 3), and PRD §13 updated v2→v3.
>
> **Added 2026-06-18** (see `sprint-change-proposal-2026-06-18.md`): the client delivered the first real foundation skill (`velara-protocol-extractor`), a **code-driven hybrid** the current hybrid runtime cannot host. **New Epic 5.5** (positioned right after Epic 5) widens the hybrid runtime for code-driven trusted skills (multi-file bundle, deps, egress, injected secrets, raw-file input) and adds a schema-versioned canonical output contract + `blocked` QA job state. **Epics 2 & 3 stay `done`** (forward FR amendments only, no reopen). Phase-1 isolation = per-skill venv; container isolation deferred to an Epic 7 story. Headline gate = the client skill running **end-to-end** on the platform. _(Renumbered 2026-06-25: created as Epic 10, moved to **5.5** to sit where it belongs by dependency; Epics 6–9 keep their numbers.)_
>
> **Added 2026-07-01** (see `sprint-change-proposal-2026-07-01.md`): access-control admin surfaces gap found near Epic 8 close. Epic 8's stories delivered RBAC enforcement (8.1), the IP client surface (8.2), and the client portal (8.3/8.4) but never the internal admin UI, and the skill-attachment model was a documented deferral. **Epic 8 gains Story 8.5** (Access Control screen — admin grant management UI over the 8.1 API) and **Story 8.6** (Skill Attachment Model & Assignment UI — real join table + assignment, replacing the scope-heuristic mock; **sequenced before 8.4** so client discovery consumes real attachments). **New Epic 10: Client User Provisioning** (Cognito `AdminCreateUser` + invites + user-management screens — a distinct identity-lifecycle concern, `USR-*` FRs, net-new vs SEC-06's pre-existing-user assumption). New FRs ACL-08/ACL-09/USR-01..03; ACL-09 supersedes the INV-07 "no attachment filtering" Phase-1 stance for the client portal; requires architecture ADRs (attachment model + Cognito provisioning).
>
> **Added 2026-07-06** (see `sprint-change-proposal-2026-07-06.md`): forward scope addition after Epic 10 close — the skill on-boarding path is too rigid. **New Epic 11: AI-Assisted Skill Integration, Versioning & Environment Promotion** — real multi-file ZIP bundle upload, a standardized code-driven entrypoint contract enforced at registration (absorbs the Epic 5.5 retro Action Item 1), an AI integration assistant that **proposes** a standardized adapter + manifest for human approval (adapter-only, core files byte-for-byte unchanged, re-certified before `client_ready`), UI-authored new versions (draft-mutable-in-place + immutable-on-publish; new-ZIP for hybrid), running an older version to compare (admin/ma_tech), and environment promotion (export/import Phase 1, in-app promote Phase-2 target). New `SKL-01..SKL-08` FRs; amends REG-01/REG-02; requires 3 architecture ADRs. **New Epic 12: Skill & Audit Lifecycle Polish** — four independent quick-fixes decoupled to ship on their own cadence: location-dependent authoring toggle (REG-10), backend-enriched audit context names (USE-07), distinct audit event icons (USE-08), duplicate-run cost warning (INV-10).
>
> **Added 2026-07-20** (see `sprint-change-proposal-2026-07-20-cost-tracking.md`). **New Epic 15: Per-Execution Cost Tracking** — an operator found only a single platform-wide aggregate dollar figure (Analytics Overview's `token_cost`); no per-invocation, per-skill, or per-user cost anywhere, and the AI-adapter-propose LLM spend (Epic 11/14) is captured in tokens but never priced either. Adds FR-USE-07. **Epic 9 stays `done`** (FR-USE-06 fully met as originally scoped) — this is new scope, not a defect.

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
Clients can access a dedicated portal to invoke client-facing skills and receive outputs — with project-level skills surfaced above study-level skills. Hierarchy-scoped RBAC is fully enforced across all API routes. Skill internals are structurally blocked from client-scoped tokens at the API router level (not just permissions). Internal-only and client-facing skill visibility is enforced end-to-end. **Internal admins get an Access Control screen to manage client grants (8.5), and skills are attached to specific Projects/Studies via a real attachment model + assignment UI (8.6, sequenced before 8.4).**

**Stories:** 8.1 RBAC enforcement · 8.2 IP client surface · 8.3 client portal shell · 8.4 client skill discovery · **8.5 Access Control screen (admin grant management)** · **8.6 Skill Attachment Model & Assignment UI** _(8.5/8.6 added 2026-07-01)_

**FRs covered:** FR-ACL-01, FR-ACL-02, FR-ACL-03, FR-ACL-04, FR-ACL-05, FR-ACL-07, **FR-ACL-08, FR-ACL-09**
**Also covers:** UX-DR-09

---

## Epic 9: Audit Log, Usage & Analytics
Operators and consultants can query the immutable, append-only audit log by any combination of hierarchy path, user, skill, time window, and outcome. Every invocation — including fan-out child records with parent linkage — is accurately captured. Access logs record every administrative action. A **Usage & Value (Analytics)** screen adds an aggregate **Overview** and a per-user **By-User** view (select an individual user and analyze their metrics). The audit log also serves as the **21 CFR Part 11** electronic-records trail (secure, UTC-time-stamped, attributable, tamper-evident). (Audit write-path is established earlier in Epic 3; this epic delivers the query API, audit UI, and the analytics API + UI.)

**FRs covered:** FR-USE-01, FR-USE-02, FR-USE-03, FR-USE-04, FR-USE-06 (usage analytics — Overview + per-user), FR-SEC-09 (Part 11 audit-trail attributes)
**Also covers:** UX-DR-13 (Analytics Overview + By-User)

---

## Epic 10: Client User Provisioning

<!-- Added 2026-07-01 via correct-course (see planning-artifacts/sprint-change-proposal-2026-07-01.md). -->
<!-- Promoted to a full story-able epic doc 2026-07-03 (Epic 9 retro P1): see epics/epic-10-client-user-provisioning.md — the authoritative version with Given/When/Then ACs. Summary below retained for the roadmap index. Architecture ADR already written: architecture/core-architectural-decisions.md:181-203. Provisioning gate resolved 2026-07-03 to {admin, ma_tech} (supersedes the ADR's older consultant/ma_tech phrasing). -->

Vitalief admins can create client login identities and invite them, so a client can be onboarded end-to-end from within the platform rather than via out-of-band Cognito-console work. This is a distinct identity-lifecycle concern split out of Epic 8 (which manages *access grants* for users assumed to already exist). Requires an architecture ADR for Cognito `AdminCreateUser` + invite flow before dev.

**Stories (to be detailed via create-story):**
- 10.1 Cognito admin user provisioning (`AdminCreateUser` + `org_id`/`role` claims + invite / temporary-password flow; dev-mode path via `DevAuthProvider`)
- 10.2 User-management screen (create/invite client users, list users, resend invite)
- 10.3 Provisioning ↔ grant handoff (create user → immediately grant engagement access in one flow)

**FRs covered:** FR-USR-01, FR-USR-02, FR-USR-03 _(new; USR-01/02 supersede the SEC-06 assumption that users pre-exist)_

---

## Epic 11: AI-Assisted Skill Integration, Versioning & Environment Promotion

<!-- Added 2026-07-06 via correct-course (see planning-artifacts/sprint-change-proposal-2026-07-06.md). Authoritative story-able version: epics/epic-11-ai-assisted-skill-integration-and-promotion.md. -->

Vitalief can on-board a client-provided skill with AI assistance — the platform **proposes** a standardized adapter + manifest so the skill fits the runtime contract *without changing what it does* (adapter-only; core files byte-for-byte unchanged; re-certified before `client_ready`) — register true multi-file ZIP bundles, author new versions from the UI, run an older version to compare, and promote certified skills to higher environments (export/import Phase 1; in-app promote Phase-2 target). Replaces the per-skill hand-written adapter shim (Epic 5.5) with a standardized contract + an AI integration assistant. Epics 2/3/5.5 stay `done` (forward FR amendments only). **Architecture-gated** — 3 Winston ADRs (AI-integration seam; promotion/bundle portability; draft-mutable versioning).

**Stories (to be detailed via create-story):**
- 11.1 Multi-file ZIP bundle upload & extraction
- 11.2 Standardized entrypoint contract + registration-time validation _(absorbs Epic 5.5 retro Action Item 1)_
- 11.3 AI skill integration assistant (propose → human-approve, adapter-only, re-cert)
- 11.4 Export / import portable skill bundles
- 11.5 In-app environment promotion (Phase-2 design + stub)
- 11.6 Author new skill versions from the UI (draft-edit + version-on-publish; new-ZIP for hybrid)
- 11.7 Run an older skill version to compare (admin / ma_tech)

**FRs covered:** SKL-01..SKL-08 _(new)_; REG-01 _(amended — ZIP bundle built)_; REG-02 _(amended — draft-mutable versioning; published versions still immutable)_; EXE-03 _(adjacent — code-driven entrypoint contract standardized)_

---

## Epic 12: Skill & Audit Lifecycle Polish

<!-- Added 2026-07-06 via correct-course (see planning-artifacts/sprint-change-proposal-2026-07-06.md). Authoritative story-able version: epics/epic-12-skill-and-audit-lifecycle-polish.md. -->

Four independent, high-value fixes to skill authoring and the audit surface, **decoupled from Epic 11** so they ship on their own cadence (none depend on Epic 11 architecture): a location-dependent authoring toggle (a pure FE form gap — backend already wired), backend-enriched audit context names (resolve ltree UUID segments → entity names server-side), distinct per-event audit icons (fill the two unmapped event types + verify render), and an advisory duplicate-run cost warning (hook in `queue_invocation` before `create_job`). Suggested order 12.1 → 12.2 → 12.3 → 12.4.

**Stories (to be detailed via create-story):**
- 12.1 Location-dependent authoring control _(FE-only; backend field already wired)_
- 12.2 Audit log context names (backend-enriched)
- 12.3 Distinct audit event icons
- 12.4 Duplicate-run cost warning (advisory)

**FRs covered:** REG-10, USE-07, USE-08 _(P2)_, INV-10 _(P2)_ _(new)_

---

## Epic 13: Compliance — Audit Coverage, Access Lifecycle & Detective Controls

<!-- Added 2026-07-13 from a HIPAA / SOC 2 gap analysis run against deployed code at HEAD cddc082. Authoritative story-able version: epics/epic-13-compliance-audit-and-access-controls.md. -->

Closes the HIPAA / SOC 2 gaps a code-verified compliance gap analysis surfaced. **The one-line finding: the audit log is a write-path log — it records who *ran* a skill and who *granted* access, but never who *read* anything and never who *logged in* (or failed to).** Under HIPAA §164.312(b)/§164.528 and SOC 2 CC6, the read side is the half that matters most, and it is at zero. Separately, the platform has **no way to deprovision a user at all** (`AuthProvider` has no `disable_user`; `/users` has no DELETE) — not "unaudited," *absent* — and there is **no CloudTrail** (zero detective controls across all 15 `.tf` files).

**Root cause (planning):** FR-SEC-08 names HIPAA and 21 CFR Part 11 as co-equal frameworks, but only Part 11 was ever decomposed into FRs (SEC-09/10/11/12 are all Part 11 clauses). HIPAA's Security Rule audit/accountability obligations were never turned into requirements, so no story carried them. Epic 13 adds the missing FRs.

**Does NOT supersede Epic 12 / Story 12.5** (skill-authoring + ingest audit coverage + the anti-regression guard test) — 12.5 ships on its own cadence and its guard-test registry is the entry point several Epic 13 stories plug into.

**Stories (to be detailed via create-story):**
- 13.1 Audit event categorization _(NEW 2026-07-14 — runs first; builds the category taxonomy/mapping the rest of this epic's new event types plug into)_
- 13.2 User deprovisioning (disable / revoke access) _(HIGH — no compensating control; first thing an auditor tests)_
- 13.3 Audit the read path — PHI access & disclosure _(HIGH — §164.528 currently unanswerable)_
- 13.4 Authentication & authorization event auditing _(HIGH — failed logins recorded nowhere)_
- 13.5 Cloud detective controls (CloudTrail, access logging, Config) _(HIGH — Terraform; plan only, operator applies)_
- 13.6 Close the remaining unaudited-mutation surface _(hierarchy CRUD, attachments, audit-log reads, sandbox probes)_
- 13.7 HIPAA & SOC 2 control mapping documents _(finalize last — must describe what actually shipped)_

**FRs covered:** FR-SEC-13, FR-SEC-14, FR-SEC-15, FR-SEC-16, FR-SEC-17 _(all new)_; strengthens FR-SEC-08 (the HIPAA half, previously undecomposed) and FR-SEC-09 (audit completeness)

---

## Epic 15: Per-Execution Cost Tracking

<!-- Added 2026-07-20 via correct-course. Authoritative story-able version: epics/epic-15-per-execution-cost-tracking.md. -->

An operator asked whether individual skill executions are cost-tracked and found only a single platform-wide aggregate dollar figure (Analytics Overview's `token_cost`) — no per-invocation, per-skill, or per-user cost anywhere. Token counts already exist for prompt/hybrid runs but are buried in an untyped `result_metadata` JSONB blob; code-runtime skills carry no cost data at all. A second, distinct LLM-spend path — the AI integration assistant's `propose_adapter` calls (Epic 11/14) — has the identical gap: tokens/model are captured but never priced.

**Epic 9 stays `done`** — FR-USE-06 (Epic 9's own scope) is fully met as written; this epic adds FR-USE-07, new scope Epic 9 was never asked to cover.

**Stories (to be detailed via create-story):**
- 15.1 Persist structured per-execution cost at write time _(the risk-bearing migration story — new `invocation_results` columns, execution-path write, relocated pricing table)_
- 15.2 Surface per-invocation cost on the Job API + Run Console/Jobs History UI _(depends on 15.1)_
- 15.3 Per-skill and per-user cost in Analytics _(depends on 15.1; independent of 15.2)_
- 15.4 Cost the AI-assisted skill-adaptation LLM call _(depends on 15.1 for the shared pricing table only; audit-log-only, no schema change)_

**FRs covered:** FR-USE-07 _(new)_

---
