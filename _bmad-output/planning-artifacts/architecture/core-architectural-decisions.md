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
