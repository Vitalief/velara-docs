# Core Architectural Decisions

## Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hierarchy storage | PostgreSQL + `ltree` | Ancestor/descendant traversal with ACID compliance; HIPAA-eligible managed RDS; Neo4j deferred to Phase 2 |
| Skill artifact storage | S3 (content) + PostgreSQL (metadata) | S3 handles large reference files naturally; metadata stays queryable; S3 already required for ingest/output pipeline |
| Audit log | PostgreSQL append-only table, partitioned monthly | Queryable, ACID-compliant, no extra service; S3 Glacier archival a Phase 2 operational concern |
| Caching | Redis (AWS ElastiCache) — shared with Celery | Read-heavy data (skill registry listings, hierarchy trees) cached in the Redis instance already required for job queuing |

**Skill artifact model:** Each skill is stored as a compiled artifact — a versioned record with encrypted prompt/code content. No API route for client-scoped tokens exposes the internals table. This is enforced at the API routing layer, not just RBAC.

**ltree hierarchy path:** Every entity stores a `path` column (e.g., `org_1.client_7.project_3.study_2.location_9`). All queries include a `path <@ :scope_path` filter derived from the authenticated user's access grants. This is applied in a FastAPI dependency, not in individual route handlers.

---

## Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth provider | AWS Cognito | HIPAA-eligible, SSO-ready for Phase 2 (SEC-06), handles username/password as Phase 1 subset; avoids rebuilding auth when SSO is required |
| Authorization model | Hierarchy-scoped RBAC via PostgreSQL grants table | `(user_id, node_id, role)` rows; resolved by FastAPI dependency on every request; ORM queries filter by resolved scope |
| Secrets management | AWS Secrets Manager | BAA-eligible, ECS-native injection, no secrets in repos or env files |
| PHI protection | structlog sanitizer middleware | Strips PHI-pattern fields before any log write; file content passed by S3 key reference only, never inline |
| Skill IP protection | API-layer enforcement | Client-scoped tokens have no route to skill internals; enforced at FastAPI router prefix, not just permission checks |

**Token flow:** Cognito issues JWT; FastAPI validates and extracts `user_id` + `org_id`; dependency resolves hierarchy scope; all subsequent DB calls receive the resolved scope filter.

---

## API & Communication

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Versioning | `/api/v1/` prefix on all routes | Standard; allows non-breaking v2 introduction without flag gymnastics |
| Skill execution model | Async job-based for all executions | POST → `202 Accepted` + `job_id`; client polls `/api/v1/jobs/{id}` for status/result. Even fast skills go through the queue so execution is auditable, cancellable, and observable |
| Job status transport | Polling (Phase 1) + WebSocket (Phase 2) | Polling is simpler and sufficient for Phase 1 volumes; WebSocket upgrade planned once concurrent execution scales |
| Claude proxy endpoint | `POST /api/v1/invoke/{skill_id}` | Accepts context + inputs only; executes skill server-side via Celery; returns output. Skill internals never in request or response |
| Fan-out execution | N Celery tasks dispatched in parallel, results aggregated by parent task | One Celery task per location for location-dependent skills; parent task awaits all N and merges results before marking job complete |
| Error handling | Structured error envelope: `{code, message, request_id}`; PHI-safe messages only | `request_id` traces to internal logs without exposing PHI to callers |

---

## Frontend Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Role routing | Separate route trees: `/internal/*` and `/client/*` | Clean URL separation; route-level auth guards per role; matches design's role switcher; both served by same Vite build |
| Client state | Zustand | Lightweight global UI state (active hierarchy node, run context, current role); no Redux boilerplate; composable with TanStack Query for server state |
| Routing | React Router v6 (code-based) | Well-matched to the conditional route trees; no file-system convention overhead |
| Component structure | Feature-first directories: `features/engagements/`, `features/skills/`, `features/run/`, `features/admin/` | Collocates components, hooks, and types per domain; avoids a flat `components/` dumping ground |
| Run Console | Contextual only — not in primary nav | Surfaced via "Run" button in Skill Detail (skill-first mode) and in Engagement child screens (context-first mode). Matches design prototype and INV-05–INV-09 |
| Design system | Tailwind CSS + design tokens from `design/styles_v3.css` | Vitalief V3 brand tokens (teal `#128F8B`, navy `#323843`, slate `#4C5270`, pink `#F652A0` accent; Poppins headings + Open Sans body) ported to the Tailwind config. Re-themed 2026-06-09 — see Epic 1 Story 1.6; Nexa headings pending licensed font files |

---

## Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Environments | `dev` → `staging` → `prod` | Three isolated ECS environments; separate RDS instances; shared ECR registry |
| ECS service layout | 3 services per env: `velara-api` (FastAPI + Uvicorn), `velara-worker` (Celery), `velara-web` (static → CloudFront) | Scales independently; worker can scale on queue depth; frontend served via CloudFront CDN |
| Networking | VPC, private subnets for RDS + ElastiCache + ECS tasks; public subnet for ALB only | RDS and Redis never internet-accessible; all ingress through ALB |
| Monitoring | CloudWatch (logs + metrics, BAA-eligible) + Sentry (API + frontend error tracking) | CloudWatch is the compliance anchor; Sentry improves developer experience without PHI exposure (sanitize before sending) |
| Static file serving | CloudFront + S3 (frontend build artifacts) | CDN-cached; decouples frontend deploy from API deploy |
| Deferred (Phase 2) | WAF, VPC flow logs, GuardDuty, Neo4j, WebSocket job status, S3 Glacier audit archival | Architected for, not built in Phase 1 |

---

## Local Development & Provider Abstractions (added 2026-06-05)

To decouple feature development from cloud provisioning — the client's AWS account and GitHub repos are provisioned later (see `planning-artifacts/sprint-change-proposal-2026-06-05.md`) — three cloud-coupled concerns are accessed through provider interfaces with swappable backends. This is **additive** to the decisions above: production targets are unchanged, and the AWS cutover (Epic 7) is configuration-only.

| Concern | Interface | Dev backend | Prod backend (Epic 7) | Selector |
|---------|-----------|-------------|-----------------------|----------|
| Object storage | `StorageProvider` | MinIO / LocalStack (S3-compatible) | AWS S3 | `STORAGE_BACKEND` |
| Secrets | `SecretsProvider` | env / local `.env` | AWS Secrets Manager | `SECRETS_BACKEND` |
| Authentication | `AuthProvider` | Dev-auth JWT shim (same claims: `user_id`, `org_id`, role) | AWS Cognito | `AUTH_BACKEND` |

- These formalize the **existing seams** rather than introducing new patterns: file content always travels by object key (S3-key-reference), and auth is resolved in a single FastAPI dependency against a provider-agnostic JWT claims contract.
- HIPAA controls (PHI sanitizer, append-only audit, encryption-by-design) are not provider-dependent and ship from the first commit.
- Real AWS provisioning, Cognito, CI/CD, and CloudWatch/X-Ray land in **Epic 7** before any PHI-adjacent / production deployment, preserving the HIPAA "BAA + infra before hosting" gate.

---

## Regulatory Compliance — HIPAA + 21 CFR Part 11 (added 2026-06-08)

Velara is built to two named compliance frameworks. This maps controls **already** in the architecture to their governing clauses — additive, changing no prior decision.

| Framework / clause | Control | Where |
|--------------------|---------|-------|
| HIPAA — PHI safeguards | PHI sanitizer (logs + Sentry), file-by-S3-key-reference, encryption at rest/in transit, BAA-eligible hosting | Epic 1 scaffolds + Epic 7 |
| 21 CFR Part 11 §11.10(e) — audit trail | Secure, computer-generated, UTC-time-stamped, attributable, append-only (tamper-evident) audit log | Epic 9 |
| 21 CFR Part 11 §11.50 / §11.70 — e-signatures + record linking | Two-key certification = electronic signatures: signer identity + UTC timestamp + signature **meaning**, bound immutably to the skill version | Epic 6 |
| 21 CFR Part 11 §11.10(d)(g), §11.300 — access / authority / IDs | Unique user identification (Cognito) + hierarchy-scoped RBAC authority checks | Epic 7 + Epic 8 |
| 21 CFR Part 11 §11.10(a) — system validation | **Deferred:** validation plan + clause mapping authored Phase 1; formal IQ/OQ/PQ execution + full non-repudiation tracked in a compliance backlog | Epic 7 (plan) → backlog |

- The audit log, certification records, RBAC, and encryption decisions above are the Part 11 anchors; this section names the obligations and the single deferral.
- The compliance-clause mapping + validation plan are a deliverable of **Epic 7, Story 7.4**.

---

## Authorization — Internal roles are org-global operators (added 2026-06-30, Story 8.1)

Hierarchy-scoped RBAC (Epic 8 / Story 8.1) enforces access at the route boundary via the `hierarchy_scope` FastAPI dependency. This decision records how the **internal roles** (`ma_tech`, `consultant`) relate to that scoping — resolved during the 8.1 code review (architect: Winston).

**Decision.** Internal roles bypass hierarchy scope entirely (`unrestricted=True`); only the external `client` role is scope-restricted. The engagement model is *"Vitalief/MA staff run engagements; clients see only their granted slice."* The `unrestricted` bypass is therefore an intentional **authorization policy**, not an optimization, and the consequence is explicit: AC3's "cannot interact with out-of-scope entities" guarantee applies to the **`client` role only**.

**Why the bypass keys on `role`, not `org`.** A tempting hardening was to gate `unrestricted` on the user belonging to an "internal org." Rejected: it buys no real security. `org_id` and `role` are sibling Cognito ID-token claims with identical trust — a forged `role` could equally forge `org_id`. Defense against forged claims lives **upstream** (Cognito user-pool integrity + the `token_use=="id"` and signature checks in `CognitoAuthProvider`), not in a second claim cross-check inside the scope layer. There is also no formal "internal org" concept in the system (it is a seed-data string), so gating on it would invent an abstraction with zero security payoff — counter to "boring technology" and "Rule of Three."

**Guard against the representable-but-inert grant.** The grant table stores the grantee's `role`, so it could *represent* a grant for an internal role — which would be silently unenforceable (the scope dependency bypasses grants for those roles). To keep the invariant executable rather than documentary, `create_grant` **rejects** a grantee `role` of `ma_tech`/`consultant` with **422 `INTERNAL_ROLE_NOT_GRANTABLE`**. Grants apply to client-scoped users only.

**Revisit trigger.** This rests on the product fact (confirmed 2026-06-30) that a scope-limited internal user is **not foreseeable**. If that changes (e.g. a contractor consultant restricted to one client), promote to per-role grant enforcement — a single enforcement path that honors grants for all roles — as its own story. Do **not** silently widen `_INTERNAL_ROLES`.

**Seams touched:** `app/core/dependencies.py` (`_INTERNAL_ROLES`, `_hierarchy_scope`, policy comment); `app/services/access_service.py` (`_NON_GRANTABLE_ROLES`, `InternalRoleNotGrantableError`, `create_grant` guard). Changes no prior decision; formalizes the 8.1 enforcement boundary.

---

## Authorization — Admin role & tiered internal authority (added 2026-07-01, Story 8.7)

Amends the 2026-06-30 "Internal roles are org-global operators" ADR by exercising its stated revisit trigger. Trigger: the Story 8.6 code review — product requested a privileged internal tier for administrative operations. Architect: Winston.

**Decision.** Introduce a third internal role, `admin`, above `ma_tech`/`consultant`. `_INTERNAL_ROLES = {ma_tech, consultant, admin}` — all three bypass hierarchy scope (`unrestricted=True`); the external `client` role remains the only scope-restricted role (the 2026-06-30 decision is otherwise unchanged). Administrative *authority* (attaching skills; granting access) is tiered: **`_GRANTOR_ROLES = {admin, ma_tech}`** — a single unified set gating **both** skill attach/detach and access-grant management. `consultant` is **demoted to read-only for these two administrative operations only**; it can no longer attach/detach skills or create/revoke grants. This reverses the 8.1 D4 ruling that `consultant` is a grantor.

**Scope of the demotion — running skills is UNAFFECTED.** The demotion is limited to the `_GRANTOR_ROLES`-gated *administrative* surface (attach/grant). **Running a skill is a distinct, separately-gated operation** — the invocation route (`/api/v1/invocations`) is gated by `RejectClient` only (any internal role may run), with no `_GRANTOR_ROLES` check. Because `consultant` remains in `_INTERNAL_ROLES`, it **retains full skill-execution authority**: a consultant still runs skills from the Engagements screen (and elsewhere), still reads engagements/attached-skills/grants — it simply cannot *change* attachments or grants. Consultant is a read-only *administrator* of attachments/grants but a full *operator*. Implementation MUST NOT add a grantor gate to the run path.

**Why one unified `_GRANTOR_ROLES` (not split attach vs grant).** The 2026-07-01 skill-attachment ADR mandates attachment mirror `user_access_grants` 1:1. Keeping a single grantor set preserves that attach≡grant symmetry — one gate, one mental model, one test surface. The alternative — a distinct `_ATTACH_ROLES` — was rejected: it forks the symmetry for no product benefit, since `consultant` loses both attach and grant.

**Role-not-org still holds.** The 2026-06-30 rationale carries forward unchanged: the bypass keys on `role`, not `org`, because `role`/`org_id` are sibling Cognito ID-token claims of equal trust; forgery is defended upstream (Cognito user-pool integrity + `token_use=="id"` + signature checks in `CognitoAuthProvider`), not by a second claim cross-check. `admin` is a trusted `custom:role` claim like the others.

**Issuance.** `admin` is a valid `custom:role` value the app recognizes. Phase 1: admins are designated **manually (Cognito console)** or via Epic 10 provisioning once built — there is **no** self-service role-management surface in Story 8.7 (that is Epic 10 territory: user list + `cognito-idp:AdminUpdateUserAttributes`). `create_grant` continues to reject internal-role grantees (now including `admin`) with 422 `INTERNAL_ROLE_NOT_GRANTABLE` — an operator is never a grantee.

**Sequencing.** Independent of Story 8.4 (client discovery — disjoint code paths; may run in parallel). Prefer **before or with Story 8.5** (Access Control screen) so 8.5 is built against the final gate. No MVP scope change.

**Seams touched (for 8.7 dev):** `app/core/dependencies.py` (`_INTERNAL_ROLES`, `_hierarchy_scope`); `app/api/v1/hierarchy.py` + `app/api/v1/access_grants.py` (`_GRANTOR_ROLES`); `app/services/access_service.py` (`_NON_GRANTABLE_ROLES` gains `admin`); FE `src/shared/utils/auth.ts` (`INTERNAL_ROLES`) + `features/admin/` gates (`NodeSkillAttachControls`, AccessControl). Cognito `custom:role` accepts `admin`; Epic 10 provisioning offers it. Amends the 2026-06-30 ADR (revisit trigger fired); the now-reachable `_require_grantor` 403 branch becomes testable via a demoted-`consultant` token.

---

## Skill Attachment Model — explicit skill↔engagement attachment (added 2026-07-01, Story 8.6)

Story 8.6 (correct-course `sprint-change-proposal-2026-07-01.md`) introduces an **explicit attachment** between a skill and a hierarchy node, replacing the Phase-1 scope-heuristic that the client portal (8.4) and the internal `useProjectSkills` mock relied on. Governing FR: **ACL-09**. Architect: Winston.

**Context.** Skills are org-global registry entries (`app/models/skill.py:3` — "not ltree-pathed hierarchy nodes"). Until now, "which skills are available to a Project/Study" was inferred from the coarse `skill.scope` string (`project | study | None`) — the same value the internal `useProjectSkills(_projectId)` mock filters on while *ignoring* the project id. That gives no per-engagement selectivity: every client granted any project would see every `client_facing` project-scoped skill in the org. ACL-09 requires real, admin-controlled attachment.

**Decision — one polymorphic `skill_attachment` table.** A single table attaches a skill to a node:

```
skill_attachment(
  id                uuid  PK,
  skill_id          uuid  FK → skills.id,
  node_id           uuid,          -- the attached Project or Study (no DB FK — polymorphic)
  node_type         varchar(16),   -- "project" | "study"
  org_id            varchar(128),
  attached_at       timestamptz,
  attached_by_user_id varchar(128)
)
UNIQUE(skill_id, node_id, node_type, org_id)
```

This deliberately **mirrors `user_access_grants` 1:1** (same polymorphic-node shape, same `org_id` tenancy column, same unique-constraint discipline). Chosen over two typed tables (`project_skill` + `study_skill` with hard FKs on both sides) on **Rule-of-Three / boring-technology** grounds: the grant table already proved this exact pattern in this codebase, so a second attachment concept reuses established team muscle-memory, one migration, one service, one route family, one test suite — versus doubling all of that and forcing the client-availability query to UNION two tables. **No live data exists yet** (product confirmed 2026-07-01 — the app has no users), so there is zero migration/compatibility cost to this choice; it is made purely on engineering merit.

**Composition with `scope` and visibility (the new availability rule).** Client-portal availability becomes:

> a client sees a skill  ⇔  it is **attached** to a node the client is **granted** (8.1)  ∩  the skill's `visibility == client_facing`  ∩ `lifecycle_state == client_ready`.

`skill.scope` is **demoted to an authoring/UX hint** — it no longer drives client availability. Its one remaining executable role is an **attach-time validation guard**: a `scope == "study"` skill may only be attached to a `study` node, `scope == "project"` only to a `project` node (a `scope == None` skill may attach to either, or is disallowed — dev's call at story time, default: allow both). This keeps a single source of truth (the attachment) and avoids re-checking `scope` at read time (rejected alternative: "attached AND scope matches view" — redundant with the attach-time guard, two things to keep in sync, more confusing empty-list states).

**Guard against the polymorphic-integrity gap.** Because `node_id` has no DB-level FK (it points at either `projects` or `studies`), the same two integrity duties the grant code already discharges apply here, in the service layer, **not** the database:
- **Attach-time:** verify the node exists, is in the caller's `org_id`, and its type matches `node_type` (and matches `scope` per the guard above). Attach/unattach is `consultant`/`ma_tech` gated and hierarchy-scope checked (reuse the 8.1 pattern).
- **Node-delete-time:** deleting a Project/Study must clean up its `skill_attachment` rows (no cascade fires automatically — mirror how a grant/child delete is handled today). Detaching a skill is a plain row delete.

**Skills stay org-global.** This ADR does **not** move skills into the ltree hierarchy or give them a `hierarchy_path`. A skill remains a single org-level registry entry that can be *attached* to many nodes; attachment is a join, not ownership. Certification, versioning, and IP storage (S3-key-reference) are unchanged.

**Revisit trigger.** If attachment ever needs to carry per-attachment metadata (e.g. an attachment-specific config, an effective-date, or a client-visible override), the polymorphic row is the place to add columns — do not fork into typed tables reflexively. If a third attachable node type appears (e.g. attaching at the Client level), the polymorphic shape absorbs it by widening the `node_type` check; the typed-table alternative would have required a whole new table. If real referential-integrity pain emerges once there is live data, promote to typed tables as its own migration story — but that is not foreseeable now.

**Seams touched (for 8.6 dev):** new `app/models/skill_attachment.py` + migration (next number after `0016`); new `app/services/` attach/unattach/list-attachments functions (model on `access_service.py`); attach/unattach routes (consultant/ma_tech gated, scope-checked); the client skills query (8.4 `GET /api/v1/client/skills`) filters by attachment ∩ grant ∩ `client_facing`/`client_ready` instead of the scope-heuristic; the internal `useProjectSkills(_projectId)` FE mock is rewired to query real attachments by `projectId` (its documented swap point). **Sequenced before Story 8.4** so client discovery is built against real attachments, not the mock.

---

## Client User Provisioning — Cognito AdminCreateUser via the AuthProvider seam (added 2026-07-01, Epic 10)

Epic 10 (correct-course `sprint-change-proposal-2026-07-01.md`) lets Vitalief admins create and invite client login identities from inside the platform, rather than via out-of-band Cognito-console work. Governing FRs: **USR-01 / USR-02 / USR-03**. This is the identity-*lifecycle* concern that was split out of Epic 8 (which manages *access grants* for users assumed to already exist). Architect: Winston.

**Context.** Auth flows through the `AuthProvider` Protocol (`app/integrations/auth.py:75`), today a two-method contract — `issue_token` + `validate_token`. `DevAuthProvider` (HS256, in-code seed users) backs the offline test suite (`.env.test` / `.env.hostworker` → `AUTH_BACKEND=dev`); `CognitoAuthProvider` (RS256 validate; Cognito issues its own tokens) backs local dev **and** production (`.env` → `AUTH_BACKEND=cognito`, confirmed 2026-07-01). There is **no** user-creation capability anywhere today; `create_grant` stores a `user_id` string with no identity check, so an admin can currently grant access to a user who cannot log in.

**Decision — add a `create_user` capability to the `AuthProvider` seam; Cognito owns the invite email.**

1. **Extend the provider seam, don't bypass it.** Add a `create_user(...)` method to the `AuthProvider` Protocol, returning the new principal's `user_id` (Cognito `sub`) plus the `org_id`/`role` claims it set. Callers never import concrete providers — same discipline as `issue_token`/`validate_token` and the `StorageProvider`/`SecretsProvider` seams.
   - `CognitoAuthProvider.create_user` → **`AdminCreateUser`** on the user pool, setting `custom:org_id` and `custom:role` claims, in the **default invite mode** (Cognito generates a temporary password and **emails the built-in invitation**; the client is forced to set a real password on first login).
   - `DevAuthProvider.create_user` → adds the user to the in-memory/local seed set and returns synthesized claims. No AWS. This is what keeps Epic 10 **testable offline** in CI (the test suite cannot reach Cognito).

2. **Cognito sends the invite (no SES/email service now).** We use Cognito's built-in `AdminCreateUser` invitation + temporary-password + forced-reset flow. We deliberately do **not** build a branded SES email/template/token pipeline in Phase 1 — that is meaningful operational surface (deliverability, templates, link tokens) for a first-impression polish, and is a clean Phase-2 upgrade (`SUPPRESS` the Cognito email + send our own) if branding demands it. Boring technology: let AWS own delivery.

3. **Local dev exercises the real path.** Because local dev runs on `AUTH_BACKEND=cognito`, the developer building Epic 10 sees the *actual* `AdminCreateUser` + invite behavior end-to-end — no stub. The dev-shim `create_user` exists specifically so the **automated tests** (which run on `AUTH_BACKEND=dev`) can still exercise create→grant→login offline. Two concrete consumers, one on each backend — the seam is justified by facts, not speculation.

**Provisioning ↔ grant handoff (USR / ACL boundary).** Creating a user and granting access stay **distinct operations** on distinct FRs (USR-01 create identity; 8.1/ACL-08 grant access), but Story 10.3 offers a combined admin flow: create the Cognito user, then immediately call the existing `create_grant` with the returned `user_id`. This closes today's gap where a grant can reference a non-existent user — after 10.3, the create-then-grant flow guarantees the granted `user_id` is a real, invited identity. We do **not** add a DB FK from grants to a users table (there is no users table — identities live in Cognito); the guarantee is procedural (the combined flow), consistent with the existing "user_id is an opaque Cognito `sub`" model.

**IAM / security surface.** The API's task role gains `cognito-idp:AdminCreateUser` (and, for 10.3/USR-03, `AdminGetUser` / `AdminResendInvitation` / `AdminDisableUser`) **scoped to the specific user pool ARN** — least privilege, no wildcard. Provisioning routes are `consultant`/`ma_tech` gated (internal admins only), same authority model as grant management. `custom:org_id` / `custom:role` are set **server-side** at creation from the admin's validated input — never client-supplied — so a created user cannot self-elevate; this preserves the "role/org are trusted Cognito claims, forgery defended upstream" stance of the 2026-06-30 internal-role ADR.

**Revisit trigger.** If Vitalief needs branded onboarding, self-service client sign-up, or SSO-provisioned identities, promote to the SES-branded-invite path (item 2's Phase-2 note) and/or a Cognito federation story — as its own epic. Do not bolt an email service onto Epic 10 reactively. If internal-user provisioning is ever needed (today internal users are managed out-of-band), the same `create_user` seam extends to it; scope Epic 10 to **client** users only for now.

**Seams touched (for Epic 10 dev):** `app/integrations/auth.py` (`AuthProvider.create_user` on the Protocol; real impl in `CognitoAuthProvider`, offline impl in `DevAuthProvider`); new provisioning service + `consultant`/`ma_tech`-gated routes (10.1); Terraform/IAM adds the scoped `cognito-idp:Admin*` permissions on the pool ARN; FE user-management screens (10.2) + the create-then-grant flow (10.3) reusing the existing `create_grant`. Changes no prior decision; extends the auth seam additively.

---

## Draft-Mutable Versioning — a scoped exception to version immutability (added 2026-07-06, Epic 11 Story 11.6)

Epic 11 (correct-course `sprint-change-proposal-2026-07-06.md`) lets developers author new skill versions from the UI: edit content in place for prompt/code skills, upload a new ZIP for hybrid skills (Story 11.1). Governing FRs: **SKL-07**, and this **amends REG-02**. Architect: Winston.

**Context — the current invariant is convention-only, not DB-enforced.** `skill_service.py:5` declares *"SkillVersion rows are immutable — no UPDATE/DELETE ever,"* and every content change today mints a new content-addressed version via `create_version` (`skill_service.py:558-706`, row-locked, semver-monotonic, S3 key = `skills/{skill_id}/{version}/{checksum}`). **Verified 2026-07-06: this immutability is enforced only in the service layer — there is no DB trigger on `skill_versions`.** This is a deliberate contrast with `audit_log_entries` (hard `reject_audit_mutation()` BEFORE-UPDATE/DELETE trigger, migration 0006) and certification records (0015): those are Part-11 electronic records where tamper-evidence is a *regulatory* obligation, so the guarantee is pushed to the database. A skill artifact is **not** a regulated record — it is an engineering artifact whose immutability buys reproducibility, not compliance. That distinction is what makes a scoped exception defensible here and forbidden there.

**Decision — draft content is mutable in place; every non-draft version stays immutable.** While a skill is in `lifecycle_state == "draft"`, edits to its **current** version's content overwrite that version in place (no version bump, no new row). The moment the skill is **published** (advances out of `draft` via the lifecycle transition), the version becomes immutable and all subsequent content changes mint a new version through the existing `create_version` path. Concretely:

1. **A `draft`-gated mutate path.** A new `update_draft_content(skill, content, content_type)` service function writes the new artifact to storage and re-points the current draft version's `artifact_key`/`artifact_checksum`. It **asserts `skill.lifecycle_state == "draft"` and `skill.current_version_id is not None`** and raises a typed error (`SkillNotDraftError` → 409) otherwise. The assertion is the executable form of the invariant — the exception is *enforced*, not merely documented, so the "no UPDATE outside draft" guarantee holds as code, not prose.
2. **Storage stays content-addressed.** An in-place draft edit writes a **new** key (`…/{new_checksum}`) and re-points the version row, then best-effort-deletes the orphaned prior draft object (mirror `create_skill`'s `_safe_delete` on the failure path). The checksum still identifies the bytes; we do not overwrite an existing key in place (S3 object immutability is preserved even though the *version row* now mutates its pointer). This keeps "the checksum names the bytes" true and sidesteps read-after-overwrite consistency questions.
3. **Publish is the freeze point.** Advancing lifecycle out of `draft` is the existing `transition_lifecycle` call; no new "publish" verb is invented. Version 1.0.0 minted at `create_skill` is the draft's mutable version until the first advance; thereafter `create_version` governs (immutable, auto-bump). The `client_ready → draft` reset-on-new-version rule (`skill_service.py:667-668`) and the derived-child `review_required` fan-out (`:676-684`) are **unchanged** — they operate on *published* versions and are orthogonal to draft-mutability.

**Why in-place draft mutation instead of "always a new version."** The rejected alternative — mint a fresh immutable version on every keystroke-batch save while drafting — pollutes the version history with dozens of throwaway `0.x` versions before a skill is ever certified, inflates S3, and makes the *meaningful* version list (what was actually published and run) unreadable. Draft is by definition the "not yet real" state; its churn should not leave permanent artifacts. Immutability earns its keep the instant a version can be **referenced** — certified, run, promoted, or consumed by a downstream skill — and none of those can touch a `draft` (execution requires a resolvable current version and `assert_invocable`; certification gates `client_ready`; promotion exports published versions). So the immutability boundary is drawn exactly where a version becomes referenceable. This is the Rule of Three cutting *toward* the exception: three independent consumers (run, certify, promote) all key on non-draft, so non-draft is the natural immutability frontier.

**Hybrid new-version-via-ZIP.** For hybrid skills the same rule applies over the Story 11.1 bundle path: a `draft` hybrid's ZIP re-upload replaces the draft artifact in place; a published hybrid's new ZIP mints a new immutable version. The `HybridShapeMismatchError` guard (code-driven↔LLM-driven cannot switch across versions, `skill_service.py:605-614`) **also applies within draft** — a draft edit may not change the manifest shape, since shape is a structural identity of the skill, not draft-mutable content.

**Revisit trigger.** If a regulated-record obligation is ever placed on skill *artifacts* themselves (e.g. a Part-11 requirement that the exact bytes of every draft iteration be tamper-evident), this exception must be revoked and immutability pushed to a DB trigger like the audit log — do not keep a service-only carve-out for a regulated record. If draft collaboration by multiple authors appears, the in-place overwrite needs optimistic-concurrency (a version-row `updated_at` check) to avoid lost updates — add it then, not speculatively now (single-author drafting is the current reality).

**Seams touched (for 11.6 dev):** `app/services/skill_service.py` (new `update_draft_content` + `SkillNotDraftError`; the `draft`-state assertion; `_safe_delete` reuse for the orphaned draft object; docstring line 5 amended to state the draft exception explicitly); `app/api/v1/skills.py` (a `draft`-gated content-update route, or extend the existing version path); FE `SkillEdit.tsx` gains a content editor + a `createVersion`/`updateDraft` API client (neither exists — it PATCHes metadata only today). Amends REG-02; changes no DB schema (no migration — the mutation is a pointer re-write on an existing row).

---

## AI Skill Integration Assistant — LLM on the registration path, adapter-only, propose→approve (added 2026-07-06, Epic 11 Stories 11.2 / 11.3)

Epic 11 replaces the per-skill hand-written adapter shim (the Epic 5.5 `velara-protocol-extractor` one-off, flagged by that epic's retro as *"a One-Off, Not a Standard"*) with a standardized entrypoint contract (11.2) plus an AI assistant that **proposes** an adapter + manifest for a client-provided skill (11.3). Governing FRs: **SKL-02, SKL-03, SKL-04**. Architect: Winston.

**Context — registration is deterministic and LLM-free today; the LLM seam is execution-only.** `create_skill` (`skill_service.py:261`) validates a skill purely mechanically (Pydantic + regex + manifest parse in `code_driven_hybrid.py`) and stores a content-addressed artifact — no network call, synchronous, reproducible. The only LLM in the codebase is `AnthropicProvider.complete(system=, user_content=, max_tokens=)` (`anthropic_client.py:149`), imported solely by `execution_service` and the Celery `execution_tasks` worker. The platform runner calls every code-driven entrypoint with one fixed shape — `func(input_path=…, output_dir=…, params=dict)` (`code_driven_executor.py:135-143`) — and a skill whose signature differs needs an adapter. Today that adapter is hand-written per skill.

**Decision — a standardized contract first (11.2), then AI *proposes* an adapter as a pre-registration step (11.3); the register path itself stays LLM-free.**

1. **Standardize before you automate (11.2).** The canonical contract is `run(input_path, output_dir, params: dict)`. Registration validation is extended from the current *string-format* check on the `module:callable` entrypoint to an actual **callable-signature check** — a conforming skill needs no adapter and runs on the existing executor unchanged. This is the boring, deterministic backbone; the AI assistant exists only to help skills that *don't* conform.
2. **The LLM is a separate "propose" step, not an inline mutation of `create_skill`.** The assistant is a new service call — reusing the existing `AnthropicProvider.complete` seam, not a second LLM client — that takes the uploaded bundle's entrypoint signature + arg shape + output-envelope shape and **returns a proposed adapter shim + manifest as a review artifact**. It does **not** call `create_skill`. Registration stays synchronous and deterministic; the AI's output is data for a human to approve, then the *human-approved* artifact flows through the unchanged register path. This preserves the "registration is reproducible" property — a re-run of registration with the same approved inputs yields the same result, LLM nondeterminism quarantined to the advisory step.
3. **Adapter-only is a structural boundary, enforced by checksum.** The assistant may author **only** the adapter file + the manifest. The skill's core logic files are stored **byte-for-byte unchanged**, and the review UI proves it: the pre-upload core-file checksums equal the post-registration core-file checksums. "Without changing what it does" is therefore a *mechanical invariant a reviewer can verify*, not a claim to trust. The assistant is structurally prevented from editing core files — they are not in its writable set.
4. **Human-approve gate + certification re-run (SKL-04).** Nothing the AI proposes auto-registers (propose, never apply). And an AI-adapted skill re-enters the existing **two-key certification** (`certification_service.assert_certified_for_client_ready`, gated at `skill_service.py:509-514`) before it can reach `client_ready`. Two independent gates — a human at registration, two humans at certification — stand between an AI-authored adapter and a client. The AI narrows the work; it never widens the trust boundary.

**Why reuse `AnthropicProvider.complete`, not a new agentic client.** The existing seam is a single-shot `system + user_content → text` completion — exactly the shape of "here is a signature and an envelope, emit an adapter." No tool-use loop, no multi-turn agent, no new dependency. Boring technology: the adapter-generation task is a structured transformation, not an open-ended agent problem, so it gets the simplest client that does the job. If adapter generation ever needs to *execute* the skill to verify its own proposal (a test-in-the-loop), that is a materially different capability — scope it as its own story then, behind the same propose→approve gate.

**Cost / duplicate-run interaction.** The assistant is invoked deliberately by a developer on-boarding a skill (not per invocation), so it is outside the Epic 12 duplicate-run advisory (INV-10). Its token usage should still be recorded via the existing audit token-tracking (Epic 9) under an `admin.*`-class event so integration-assistant spend is attributable.

**Revisit trigger.** If the standardized contract (11.2) covers the great majority of incoming skills, the AI assistant may prove rarely needed — measure adapter-proposal invocation rate before investing further in it; do not gold-plate the assistant if the deterministic contract does the work. If clients begin shipping skills whose *core logic* (not just arg shape) is incompatible, that is **not** an adapter problem and must not be solved by widening the AI's writable set to core files — it is a skill-authoring conversation with the client, or a new certification finding. The adapter-only boundary is load-bearing and non-negotiable.

**Seams touched (for 11.2/11.3 dev):** `app/services/skill_service.py` / `app/services/code_driven_hybrid.py` (callable-signature validation at registration — 11.2); a new integration-assistant service reusing `app/integrations/anthropic_client.py`'s `AnthropicProvider.complete` (11.3) that returns a proposed adapter + manifest **without** calling `create_skill`; the adapter-only writable-set constraint + core-file checksum equality surfaced in the review response; FE integration-review screen (propose/diff/approve) — net-new UX; certification path unchanged (re-cert is the existing gate). First LLM call on the registration path; changes no prior decision.

---

## Environment Promotion & Bundle Portability — signed export/import now, in-app promote next (added 2026-07-06, Epic 11 Stories 11.4 / 11.5)

Epic 11 lets a skill built in one environment move to a higher one without hand re-registration. Governing FRs: **SKL-05** (export/import, P1), **SKL-06** (in-app promote, P2). Architect: Winston.

**Context — environments are isolated by design; nothing moves skills between them today.** The `Environment` enum is `dev | staging | prod` (`config.py`), each a separate ECS deployment with its **own RDS and its own `S3_SKILL_BUCKET`** (`storage.py`). There is no export/import/promote router, no seed script — a skill registered in dev is re-registered by hand in staging/prod. Environments are also **trust-graded**: `terraform/README.md` gates staging/prod behind a signed BAA. That grading is the whole reason promotion cannot be a naive file copy.

**Decision — Phase 1: a signed, content-addressed export/import bundle; Phase 2: the same semantics over an authenticated service-to-service call. Trust never rides along.**

1. **Export produces a signed, content-addressed portable bundle (11.4).** A bundle is the manifest + all artifact files + version metadata, **content-addressed** (the same checksum discipline the registry already uses) and **signed** so import can verify integrity and provenance. The signing key is per-environment, from Secrets Manager — never in the bundle, never in code (consistent with the HIPAA "no secrets in code" boot-guard in `config.py`).
2. **Import re-creates the version immutably AND lands it non-`client_ready` (11.4).** A validated bundle recreates the skill+version through the immutable registry path; a tampered or unsigned bundle is rejected. Critically, the imported skill lands in a **non-`client_ready`** state so that **target-environment certification must run before it can serve clients there.** This is the load-bearing rule: *trust does not copy across environments by file transfer.* A skill certified in dev is not thereby certified in prod — the two-key certification is an environment-local electronic-record act (Part-11 §11.50/§11.70 bind the signature to a version *in that system*). Importing the artifact bytes is a convenience; re-certifying is the governance. Collapsing the two would let a dev-certified skill reach prod clients unreviewed — precisely the boundary the BAA gating exists to protect.
3. **The PHI/IP boundary of an exported file.** In Phase 1 the bundle **leaves the platform** (an admin downloads it). It therefore must contain **only the skill artifact** — code, manifest, schemas, metadata — and **never** any invocation input, output, document reference, or run history. A skill bundle is IP (Vitalief methodology), not PHI, and the export path must assert that: it serializes the registry `SkillVersion` + artifact, nothing from `invocation_*` / `audit_*` / ingest. This keeps the file's blast radius to IP-if-leaked, never PHI-if-leaked, and lets the ADR state a clean rule for the reviewer: *if it isn't the skill itself, it isn't in the bundle.*
4. **In-app promote (11.5) is the same decision minus the file (Phase-2 target).** The Phase-2 path replaces download/upload with an **authenticated service-to-service call** from the source environment's API to the target's, carrying the same signed content-addressed payload. Same non-`client_ready` landing, same re-certification requirement, same artifact-only boundary. This epic **designs** it (the ADR + a seam/stub); Phase 1 ships export/import as the working mechanism so promotion is unblocked without waiting on cross-environment networking + identity.

**Why export/import first, promote second (not the reverse).** In-app promote needs cross-environment service identity, network reachability between isolated VPCs, and a trust model for one environment's API authenticating to another's — real infrastructure that touches the Epic 7 networking boundary. Export/import needs none of that: it's serialize → sign → download → upload → verify, entirely within existing single-environment primitives. Shipping the file-based path first delivers the capability now and de-risks the promote path by proving the bundle format + the non-`client_ready`-on-arrival governance rule before the harder networking lands. Boring technology, sequenced by dependency.

**Revisit trigger.** If bundle size or multi-file volume makes download/upload impractical, prioritize the Phase-2 in-app promote sooner — but do not skip the signed-bundle format; the promote path reuses it. If a client-deployable variant (PRD POR-05) is ever built, this same export bundle is the natural unit to ship into a client environment — design the format so it does not assume a Vitalief-controlled target (avoid embedding environment-specific identifiers in the signed payload). Never add a "promote already-certified as certified" shortcut that skips target-environment re-certification — that reverses the load-bearing trust rule and would defeat the BAA gating.

**Seams touched (for 11.4/11.5 dev):** new export/import service serializing `SkillVersion` + artifact from `StorageProvider` (11.4), with a per-environment signing key from `SecretsProvider`/Secrets Manager; import validation (signature + checksum + manifest) landing the skill non-`client_ready`; the artifact-only assertion (no `invocation_*`/`audit_*`/ingest data in the bundle); a Phase-2 service-to-service promote seam/stub (11.5) designed but not built; FE export/import + promote controls — net-new UX. Reuses the existing content-addressed storage discipline and the two-key certification gate; changes no prior decision.

---

### Phase-2 in-app promote — the deferred design, resolved (added 2026-07-13, Story 11.5)

The record above ships Phase 1 (11.4) and names Phase 2 only as "the same decision minus the file" — "an authenticated service-to-service call," three sentences, with no auth mechanism, no promotable-state predicate, and no cross-environment identity or topology specified. The sprint-change-proposal that commissioned this ADR asked for all three by name, and the epic still listed signing-key rotation as an open question. This amendment answers them. It does not change anything decided above — Phase 1 stands as shipped — and it does not build the transport (that remains a future story; this story ships only the seam/stub, per the epic AC).

**(a) Auth mechanism — the symmetric-key trap.** `BUNDLE_SIGNING_KEY` is **symmetric HMAC-SHA256, per-environment** (`config.py` — see the drift note below), locked deliberately by 11.4 for a bundle an operator carries by hand. That was correct *for a human in the loop* — the operator's own authenticated session is the identity, and the HMAC only needs to prove the bytes are unaltered. Take the human out of the loop, as Phase-2 promote does, and the same primitive is asked to do a second job it cannot do: an HMAC proves *"someone holding this key produced these bytes,"* never *who*. That leaves two naive designs, and both are wrong:

- **Share one key across environments** so the target can verify the source's signature. This means **any** environment holding the key can mint a bundle indistinguishable from any other's — prod would trust anything dev can produce. This directly **inverts** this ADR's own Context: staging/prod are gated behind a signed BAA precisely *because* they are more trusted than dev. A shared key erases that grading in a one-line config change that reads like a bug fix.
- **Keep per-environment keys as they are today.** The target then cannot verify a bundle the source signed at all — promote is dead on arrival.

**Decision: integrity and identity are different jobs, and Phase 2 keeps them separate.**

1. **Identity comes from the transport, not the signature.** The source environment authenticates to the target as a genuine cross-environment principal: cross-account **AWS SigV4 / IAM role assumption** between the source and target ECS task roles is the recommended mechanism — the platform is already all-AWS, and Epic 7 already owns the account/VPC boundary this crosses. An OIDC machine token is the named alternative if role assumption proves impractical across the account boundary; it is not adopted here, only reserved as a fallback. This transport-level authentication **is** the "authenticated service-to-service call" this ADR's Phase-2 line already named but never specified.
2. **Integrity stays the HMAC, unchanged, per-environment.** Each environment continues to sign and verify with **its own** `BUNDLE_SIGNING_KEY`, exactly as 11.4 shipped it. Nothing about the signing scheme changes.
3. **The target re-validates and re-signs on landing.** On receipt, the target environment re-computes the content-address digest (key-independent — `sha256` over sorted `(path, sha256)` pairs, `skill_service.py`) to confirm the payload matches what the source's principal asserted it sent, then **re-signs the landed bundle with its own key**, the same way an import today re-creates the version through the immutable registry path. The source's signature authenticates nothing to the target; the source's *transport identity* does.
4. **Key-sharing is explicitly rejected.** Do not "fix" a cross-environment `BUNDLE_SIGNATURE_INVALID` by pointing dev and prod at the same key. That diff will look trivially correct and is a security regression — it is precisely the inversion described above. A future implementer who reaches this ADR while debugging that error should stop here.
5. **Key rotation (the epic's open question) is answered by this shape, not deferred further.** Because each environment keeps its own key and re-signs on landing rather than trusting a shared one, rotating a key is a **single-environment operation** — no cross-environment coordination, no rotation ceremony that has to touch two Secrets Manager entries in lockstep. This is a direct consequence of keeping identity and integrity separate, not a separate mechanism to design.

**(b) Promotable lifecycle states.** The promotable-state predicate is **`client_ready` only** — no other state (`draft`, `internal_ready`, `retired`) is promotable. Reasoning: a skill becomes referenceable — certifiable, runnable by clients, and now promotable — at exactly the point Vitalief's own two-key certification has cleared it to `client_ready` *in the source environment*. Promoting anything less would ship an unreviewed skill toward a more-trusted environment.

This is a **deliberate asymmetry** with export, which has no lifecycle gate at all (`export_skill_version` — any state, including `draft`, is exportable today). That asymmetry is intentional, not an oversight to "harmonize" later: **export is an operator escape hatch** — a human downloads a file and takes responsibility for it (backing up work-in-progress, moving a draft between machines). **Promote is a governed act** — the platform itself pushes a skill into a more-trusted environment on the platform's own authority, so it must only do that for something already two-key-certified here. Do not add a lifecycle gate to export as a drive-by consistency fix; do not loosen promote's gate to match export.

**(c) Cross-environment identity + promotion topology.** The topology is **directed and non-cyclic**: `dev → staging → prod`. Prod is never a promotion *source*. A target environment is resolved from a **config-declared registry per environment** — never a caller-supplied URL or hostname, which would be an SSRF surface. The target authenticates the calling **principal** (the source environment's assumed IAM role / machine identity per (a)), not the bundle's contents — the bundle's own integrity is the target's own HMAC re-validation, per (a)(3).

**The load-bearing rule carries forward unchanged (AC5).** Exactly as 11.4's import lands a skill non-`client_ready` with zero certification records copied, Phase-2 promote lands the target skill **`draft`, with zero certification rows copied** from the source. Target-environment two-key certification must re-run in full. This ADR's existing revisit trigger already states the prohibition this amendment restates for emphasis: **never add a "promote already-certified as certified" shortcut that skips target-environment re-certification** — doing so reverses the load-bearing trust rule and defeats the BAA gating this whole ADR protects. Promote is not modeled as a lifecycle transition on the source: `client_ready` remains terminal-except-`retired`, the source skill's `lifecycle_state` is untouched by a promote attempt, and no `promoted` state is added to the enum.

**Correcting an ADR/code drift.** Decision item 1 above (line 260) says the export/import signing key is "per-environment, from Secrets Manager." In the shipped 11.4 code, `BUNDLE_SIGNING_KEY` is a plain `Settings` field (`config.py`) — its own comment states it is "**NOT** routed through `SecretsProvider`" (that seam is reserved for per-skill connector credentials fetched at execution time). The two descriptions are both *about* Secrets Manager but describe different mechanisms: in practice the key is injected as an **environment variable** sourced from Secrets Manager via the ECS task definition, the same pattern used for `ANTHROPIC_API_KEY`, not fetched at runtime through the `SecretsProvider` protocol. This is what the code actually does today, and Phase 2's per-environment key handling in (a) builds directly on this same mechanism — stated here so the next reader does not go looking for a `SecretsProvider.get_secret("BUNDLE_SIGNING_KEY")` call that does not exist.

**Revisit trigger (Phase-2-specific).** If cross-account IAM role assumption proves impractical to provision within the Epic 7 VPC/account boundary, revisit toward the named OIDC-machine-token alternative before reconsidering key-sharing — key-sharing is rejected outright, not merely deprioritized, for the reasons in (a).

**Seams touched (11.5 only):** a new `PromotionProvider` seam (`app/integrations/promotion.py`) mirroring the existing `AuthProvider`/`SecretsProvider`/`StorageProvider` shape, with a `DisabledPromotionProvider` as the only implementation this story ships (raises `PROMOTION_NOT_CONFIGURED`); a `POST /api/v1/skills/{skill_id}/promote` route enforcing the `client_ready` gate before the seam is ever consulted, reusing 11.4's `export_skill_version(...) -> (zip_bytes, envelope)` as its payload with zero new serialization. The actual cross-account IAM/SigV4 transport described in (a) is **not built by this story** — it is designed here and left for a future implementation story to wire a `RemotePromotionProvider` behind the same seam, flipping `PROMOTION_BACKEND` from `disabled` to `remote` with no call-site changes.

## LLM-Call Observability — LangSmith as an environment-graded secondary trace sink (added 2026-07-24, Epic 17 Stories 17.1 / 17.2)

Architect: Winston. Commissioned by `sprint-change-proposal-2026-07-24.md`, which stood up Epic 17 and named this ADR as the blocker on Story 17.1.

**Context — the value of LangSmith and the platform's hardest rule point in opposite directions.** The operator wants per-**individual-LLM-call** observability — cost, latency, and request/response inspection for each call — as a secondary tool alongside Epic 15's stored per-execution cost. Every platform LLM call already funnels through a single seam: `AnthropicProvider.complete(system=, user_content=, max_tokens=)` and `.create_message(...)` (`anthropic_client.py`), both calling `self._client.messages.create(...)`. That is a clean single choke point to instrument. **But** LangSmith's entire value is capturing the two arguments to that call — `system` (Vitalief skill instructions = IP) and `user_content` / `messages` (assembled inputs + protocol documents = **PHI**) — plus the response text. Those are *exactly* the values the codebase has a hard-coded, repeated rule never to let escape: every method in `anthropic_client.py` carries `# Never log system / user_content / output_text (potential PHI/IP)`. This is a HIPAA + 21 CFR Part 11 platform (see the Regulatory Compliance ADR). So the question this ADR answers is **not** "how do we wire LangSmith" — the seam is obvious — it is **"what may LangSmith receive, and in which environments."**

**The Sentry precedent is the right shape but the wrong depth.** `observability.py:init_sentry` already solved "ship telemetry to an external cloud service without leaking PHI": DSN-gated (`if not settings.SENTRY_DSN: return` — no-op when unconfigured), `send_default_pii=False`, and a `before_send=_before_send` hook that runs `sanitize_phi(event)` (`middleware.py:87`) on the egress path. LangSmith reuses that *shape* — config-gated, safe-by-default, redact-on-egress — but with one inversion that makes it a genuinely new decision: **Sentry's PHI is incidental** (it rides along in a stack trace or request body and can be scrubbed out while leaving a useful error), whereas **LangSmith's PHI/IP is the primary payload** (redact the prompt and output and there is nothing left to inspect). You cannot `sanitize_phi` your way to a useful *and* safe LLM trace. That forces a real choice about content, not just a scrubbing hook.

**Decision — LangSmith is a config-gated, environment-graded, secondary trace sink; verbosity is a per-environment switch that defaults to metadata-only.**

1. **Secondary, never the system of record.** LangSmith is observability *atop* Epic 15's stored cost, not a replacement for it. `invocation_results.cost_usd` (15.1), priced by `app/core/pricing.py`, remains the authoritative per-execution cost fact; `AnalyticsOverview.token_cost` (15.3) is unchanged in meaning. If LangSmith is disabled, unconfigured, or down, **nothing about stored cost, execution, or analytics changes** — this is additive instrumentation with zero load-bearing dependency, exactly as Sentry is today. Cost figures sent to LangSmith spans are computed from the *same* `pricing.py` table — never a second pricing source (mirrors 15.1/AC3 and 15.4/AC1).

2. **Config-gated, safe-by-default (Sentry precedent).** A `LANGSMITH_API_KEY` (default `""`) gates all tracing; unconfigured → the tracing wrapper is a no-op and the platform runs exactly as today (no hard dependency, no startup failure). Instrumentation is added at the single `anthropic_client.py` seam so both `complete` and `create_message` — and therefore execution *and* adapter-propose — are covered by one wrapper.

3. **Trace verbosity is environment-graded, and the dangerous mode is opt-in.** A `LANGSMITH_TRACE_CONTENT` switch (default **`false` = metadata-only**) governs what a span carries:
   - **Metadata-only (the default, and the ONLY sanctioned mode for staging/prod):** model, `input_tokens`, `output_tokens`, `latency_ms`, `cost_usd`, `stop_reason`, and correlating IDs (`skill_id`, `skill_version`, `job_id`). **Never** `system`, `user_content` / `messages`, `tools`, or response text. This honors the `anthropic_client.py` PHI/IP rule verbatim — nothing sensitive egresses, so the SaaS endpoint needs **no BAA**. You get per-call cost / latency / error-rate / stop-reason observability, which is what "track individual LLM calls" resolves to under this platform's constraints.
   - **Full-content (opt-in, dev/local ONLY):** the whole prompt, tool defs, and output are traced, because dev/local data is synthetic and non-PHI. This is where an engineer actually inspects and debugs individual calls. It must be reached only by an explicit `LANGSMITH_TRACE_CONTENT=true` in a dev/local config — never a staging/prod default.

4. **The default direction is the whole safety argument — do not invert it.** Metadata-only is the floor; full-content is the deliberate exception, gated to environments whose data is fake. If staging/prod ever silently defaulted to full-content, real protocol documents and skill IP would land in a third-party SaaS — a PHI/IP breach that would read like a one-line config typo in review. This is the identical failure-shape as the 11.5 ADR's "don't point dev and prod at the same signing key" warning: **a change that looks trivially correct and is a security regression.** Accordingly the implementation must (a) default `LANGSMITH_TRACE_CONTENT=false`, and (b) **hard-refuse full-content in a non-dev environment** — a boot-time / init-time assertion that raises if `LANGSMITH_TRACE_CONTENT=true` while `ENVIRONMENT` is `staging`/`prod`, joining the existing staging/prod config-validation gate that already fails boot on a missing `ANTHROPIC_API_KEY` (`config.py`). Full-content in prod is not a config option to be trusted to discipline; it is a state the code refuses to enter.

5. **This is the same environment trust-grading the platform already runs on.** `terraform/README.md` gates staging/prod behind a signed BAA; the export-bundle ADR (11.4/11.5) grades environments by trust and states the clean boundary rule *"if it isn't the skill itself, it isn't in the bundle."* This ADR is that same reasoning applied to a trace sink: **in a trust-graded environment, only metadata leaves; full content is confined to the environment whose data isn't real.** LangSmith introduces no new trust model — it inherits the existing one.

6. **In-bundle LLM calls (Story 17.2) inherit this decision, they do not re-decide it.** Code-driven hybrid skills make their own LLM calls inside the sandbox (Epic 15.5). Story 17.2 changes the AI adapter (`skill_integration_assistant.py`) so authored/upgraded bundles route those calls through a tracing convention the sandbox exposes — but that convention is bound to the *same* `LANGSMITH_API_KEY` gate and the *same* `LANGSMITH_TRACE_CONTENT` environment grading defined here. A bundle cannot trace at full content in prod any more than the platform can; the sandbox must not widen egress beyond the tracing endpoint the environment already permits. Whether existing bundles are re-adapted or only trace-forward is a 17.2 story-level decision (its AC2), not an architecture decision — the boundary rule above holds either way.

**Rejected alternatives.**
- **Full traces in all environments via SaaS** (richest observability) — rejected: routes live PHI + Vitalief IP to a third party with no BAA, directly violating the `anthropic_client.py` rule and the compliance ADR. Not recoverable by redaction, since the payload *is* the sensitive content.
- **Self-hosted LangSmith in-VPC** (full traces everywhere, inside the AWS/BAA boundary) — a legitimate option, and the natural revisit target *if* prompt/response inspection in prod ever becomes a hard requirement. Not adopted now: it is a new stateful service to deploy, secure, and operate (Epic 7 territory), disproportionate to Epic 17's "wire a secondary observability tool" intent. Named here as the sanctioned upgrade path, not built.
- **A single `sanitize_phi`-style redactor on full traces** (mirror Sentry exactly) — rejected as the *primary* mechanism for the reason in Context: an LLM trace redacted to remove PHI/IP is not a useful trace. Metadata-only is the honest expression of "safe by default" for this payload, not a scrubbed-down full trace.

**Seams touched (design for 17.1; 17.2 extends into the sandbox):** `app/core/config.py` (`LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACE_CONTENT` — all defaulting off/false; the staging/prod validation gate gains the full-content refusal); a tracing wrapper at the `app/integrations/anthropic_client.py` seam (one place, covers `complete` + `create_message`, therefore execution and adapter-propose) that emits a metadata span always-when-configured and attaches content only in the explicitly-permitted dev/local case; cost on the span reuses `app/core/pricing.py`. No change to execution logic, no change to Epic 15's stored columns, no new API surface, no client-facing surface. **Revisit trigger:** if prompt/response inspection becomes a hard requirement in staging/prod, revisit toward self-hosted-in-VPC (above) — never by flipping the SaaS sink to full-content in a trust-graded environment, which item 4 refuses by construction.
