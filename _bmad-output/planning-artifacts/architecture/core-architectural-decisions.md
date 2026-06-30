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
