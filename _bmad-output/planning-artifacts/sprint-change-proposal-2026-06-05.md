# Sprint Change Proposal — Velara

**Date:** 2026-06-05
**Author:** Developer (via Correct Course workflow)
**Mode:** Incremental
**Scope classification:** **Moderate** (backlog reorganization)
**Status:** Approved — edits applied

---

## Section 1 — Issue Summary

**Problem statement.** Velara's epics and stories were structured **infrastructure-first** — Epic 1 ("Platform Foundation & Authentication") explicitly required *"all infrastructure… in place from day one."* The next story in line, **Story 1.3 — AWS Infrastructure Foundation**, is hard-blocked: the client has not yet provisioned the **AWS account**, and **GitHub repositories** for the service repos do not yet exist. This blocks the remaining Epic 1 stories (CI/CD, Cognito auth, cloud observability) and, transitively, **all downstream feature work**.

**Discovery context.** Surfaced during sprint execution at the boundary between completed scaffolding and the first cloud-provisioning story. Stories 1-1 (velara-api scaffold) and 1-2 (velara-web scaffold) are **done and code-reviewed**; Story 1-3 was promoted to `ready-for-dev` and is the point of blockage.

**Evidence.**
- `sprint-status.yaml` (pre-change): `1-1: done`, `1-2: done`, `1-3: ready-for-dev` (blocked), `1-4/1-5/1-6: backlog` — every remaining Epic 1 story is AWS- or GitHub-coupled.
- Epic 1 narrative: *"All infrastructure (ECS, RDS, ElastiCache, S3, ECR), CI/CD (GitHub Actions), observability (CloudWatch, X-Ray, Sentry), and HIPAA posture… in place from day one."*
- Story 1-3 file documents AWS-account/region and BAA as pre-implementation inputs owned externally.
- `deferred-work.md` confirms auth is not yet wired (token-isolation + login-form items pending real auth).

**Categorization:** External-dependency / sequencing issue — **not** a technical failure and **not** a scope problem.

---

## Section 2 — Impact Analysis

### Epic Impact
- **Epic 1 cannot complete as originally planned right now.** Stories 1-3 (AWS infra) and 1-4 (CI/CD) are hard-blocked; 1-5 (Cognito) is blocked; 1-6 is partially blocked (CloudWatch/X-Ray need AWS; structlog/Sentry/PHI-sanitizer/data-policy do not). **However, the application already runs locally** — Story 1-1 established a working `docker-compose` stack (FastAPI + Celery + Redis + PostgreSQL). The wall is **provisioning, not the application.**
- **No completed work is affected.** Scaffolds 1-1/1-2 remain valid and untouched.
- **Feature epics are largely local-buildable.** Skill Registry is pure FastAPI/Postgres/React. Skill Execution is Celery/Redis (local) plus three AWS touchpoints — S3 (ingest/output), Secrets Manager (credential injection), and Cognito (role-based visibility) — each of which has a clean local substitute.

### Story / Sequencing Impact
- Only **Story 3.7 (Location-Dependent Fan-Out)** and **Run Console context-first mode (5.2)** genuinely depend on the Hierarchy epic. Core execution (3.1–3.6, 3.8) has no hierarchy dependency.
- Auth: the existing `RequireAuth` route guards and login redirect (scaffolded in 1-2) need *something* to authenticate against — satisfied by a local dev-auth shim.

### Artifact Conflicts
- **PRD:** MVP and all P1 requirements **unchanged**. Two statements to honor (not violate): *"all infra… day one"* and *"codebase Vitalief-owned… before any PHI-adjacent skill is hosted."* Both are preserved by keeping HIPAA controls in the app from commit one, still shipping IaC in Phase 1 (FR-POR-02), and completing AWS provisioning + repo handoff before any PHI/production deploy. → **Clarifying note added.**
- **Architecture:** Core decisions hold. The S3-key-reference pattern and single-dependency JWT claims contract already imply swappable seams. → **Additive provider-abstraction note added.**
- **UI/UX:** No conflict. Dev-auth shim feeds the same role switcher and route guards.
- **Other artifacts:** `sprint-status.yaml` (reordered), `deferred-work.md` (auth notes re-routed), Terraform/CI-CD (relocated with Epic 7).

### Technical Impact
- New, small enabling work in Epic 1: provider abstractions (`StorageProvider`, `SecretsProvider`, `AuthProvider`) with local backends (MinIO/LocalStack, env, dev-JWT) and an extended `docker-compose`.
- AWS cutover (Epic 7) becomes a configuration change (`STORAGE_BACKEND`/`SECRETS_BACKEND`/`AUTH_BACKEND`) rather than a rewrite.

---

## Section 3 — Recommended Approach

**Selected path: Hybrid — Direct Adjustment (resequence) + one additive enabling story + a relocated Infrastructure epic.**

| Option | Verdict | Effort | Risk |
|--------|---------|--------|------|
| **Direct Adjustment** (resequence + provider abstractions + dev-auth shim) | ✅ **Selected** | Medium | Low |
| Rollback | ❌ Unnecessary — no AWS-coupled work has been built; scaffolds stay | — | — |
| MVP Review / scope cut | ❌ Not needed — scope intact, only sequence changes | — | — |

**Rationale.** No completed work is discarded; momentum is preserved by unblocking the team immediately onto the client's highest-priority capabilities (Registry + Execution); HIPAA posture and the "Vitalief-owned/day-one" intent are preserved by design; and the provider abstractions make the eventual AWS cutover cheap and low-risk. Infrastructure moves from effective position 1 → **Epic 7** (6 epics down — well past the requested "≥3 down" floor) and lands precisely at the HIPAA hosting gate, just before the client-facing portal.

**Decisions confirmed with stakeholder (2026-06-05):**
1. Hierarchy sequenced **after** Execution (defer only Story 3.7 fan-out).
2. **Provider abstractions + local backends** for S3 / Secrets / Auth.
3. Infrastructure epic placed **just before client-portal go-live** (HIPAA gate).
4. **Full epic renumbering** to reflect the new order.

---

## Section 4 — Detailed Change Proposals

### 4.1 New Epic Order (renumbered)

| New # | Epic | Was | Status |
|-------|------|-----|--------|
| 1 | Platform Foundation **& Local Dev Environment** | E1 (rescoped) | in-progress |
| 2 | Skill Registry & Lifecycle | E3 | backlog |
| 3 | Skill Execution Engine | E4 | backlog |
| 4 | Engagement Hierarchy Management | E2 | backlog |
| 5 | Run Console & Invocation UX | E5 | backlog |
| 6 | Certification & Governance | E6 | backlog |
| 7 | **Infrastructure, Deployment & Cloud Auth** 🆕 | (1-3…1-6 re-homed) | backlog |
| 8 | Access Control & Client Portal | E7 | backlog |
| 9 | Audit Log & Usage Tracking | E8 | backlog |

### 4.2 Story Renumbering Map

```
Epic 1  Foundation & Local Dev Environment
  1-1  velara-api Scaffold .............................. done (unchanged)
  1-2  velara-web Scaffold .............................. done (unchanged)
  1-3  Local Dev Env & Provider Abstractions ............ NEW (backlog)
  1-4  Dev Authentication Shim .......................... NEW (backlog)
Epic 2  Skill Registry (was 3):   3-1→2-1 … 3-5→2-5
Epic 3  Skill Execution (was 4):  4-1→3-1 … 4-6→3-6 | 4-7→3-7 [DEFERRED] | 4-8→3-8
Epic 4  Hierarchy (was 2):        2-1→4-1 … 2-4→4-4
Epic 5  Run Console (was 5):      5-1…5-5 (unchanged)
Epic 6  Certification (was 6):    6-1…6-4 (unchanged)
Epic 7  Infra/Deploy/Cloud Auth (NEW):
  7-1  AWS Infrastructure Foundation .......... (was 1-3; story file preserved, → backlog)
  7-2  CI/CD Pipeline Setup ................... (was 1-4)
  7-3  Cognito Authentication ................. (was 1-5; swaps the dev-auth shim)
  7-4  Cloud Observability & HIPAA Baseline ... (was 1-6)
Epic 8  Access Control (was 7):   7-1→8-1 … 7-4→8-4
Epic 9  Audit Log (was 8):        8-1→9-1 … 8-3→9-3
```

### 4.3 Two New Epic-1 Stories

**Story 1.3 — Local Dev Environment & Provider Abstractions** (`StorageProvider` S3↔MinIO/LocalStack; `SecretsProvider` Secrets-Manager↔env; `docker-compose` + bucket bootstrap; `.env.example` documents the backend switches; AWS cutover is config-only).

**Story 1.4 — Dev Authentication Shim** (`AuthProvider` with `DevAuthProvider` issuing JWTs on the same `user_id`/`org_id`/role claims contract as Cognito; seed users; `RequireAuth` + role switcher wired; isolates the Cognito swap to `auth.ts`, resolving the `deferred-work.md` token-isolation note).

### 4.4 Deferred Story Flag

**Story 3.7 (Location-Dependent Fan-Out)** stays in the Execution epic but is flagged **`[Deferred — sequenced after Epic 4 (Hierarchy)]`** — it requires Locations to exist. Build once Epic 4 lands (or against seed locations).

### 4.5 Companion Document Edits (before/after summary)

| Artifact | Change |
|----------|--------|
| **PRD** (`Velara-PRD-full.md`) | Added *Implementation Sequencing Note (2026-06-05)* after Phase 1 Goals. No requirement removed/changed. |
| **Architecture** (`core-architectural-decisions.md`) | Added additive *Local Development & Provider Abstractions* section (provider table + cutover note). |
| **`deferred-work.md`** | Re-routed the two auth notes: dev-auth wiring → Story 1-4; Cognito swap → Story 7-3. |
| **`sprint-status.yaml`** | Full rewrite to new numbering; 1-1/1-2 preserved as `done`; 7-1 reverted `ready-for-dev`→`backlog`. |
| **Epic files** | 6 renamed; new `epic-7-infrastructure-deployment-cloud-auth.md` created; `epic-1-…-authentication.md` → `epic-1-…-local-dev-environment.md`. |
| **`epic-list.md`, `index.md`, `requirements-inventory.md`** | Rewritten to new order; FR Coverage Map remapped (SEC/POR split across Epic 1 & Epic 7). |
| **Story file** | `1-3-aws-infrastructure-foundation.md` → `7-1-aws-infrastructure-foundation.md`; internal heading, status, and cross-refs (1.4→7.2, 1.5→7.3, 1.6→7.4, Epic-1 source path→Epic-7) updated; D1–D3 planning preserved. |

> Note: the canonical PRD note lives in `Velara-PRD-full.md` (the whole-document version takes priority over the sharded `prd/` copy per the workflow's discovery rule).

---

## Section 5 — Implementation Handoff

**Scope: Moderate (backlog reorganization).** The resequencing, renumbering, and document updates listed in Section 4 have been **applied** to the planning and implementation artifacts.

### Routing & Responsibilities
| Recipient | Responsibility |
|-----------|----------------|
| **Product Owner / Developer** | Confirm the new epic order and the two new Epic-1 stories reflect intent; verify `sprint-status.yaml` is the source of truth for sequencing. |
| **Developer (next action)** | Run `create-story` for **Story 1-3 (Local Dev Env & Provider Abstractions)** — the new next story — then **Story 1-4 (Dev Auth Shim)**. Acceptance-criteria sketches are in `epic-1-platform-foundation-local-dev-environment.md`. |
| **Architect (advisory)** | Confirm the provider-abstraction interfaces (`StorageProvider`/`SecretsProvider`/`AuthProvider`) match intended seams before 1-3 implementation. |

### External Prerequisites (track to unblock Epic 7)
- Client provisions the **AWS account** (account ID + region; BAA in place).
- **Vitalief-owned GitHub repositories** created for `velara-api` and `velara-web` (satisfies the "Vitalief-owned from day one / before hosting" goal before any PHI-adjacent deploy).

### Success Criteria
- `docker-compose up` runs the full stack locally (incl. local object storage + dev-auth) — Stories 1-3/1-4.
- Skill Registry (Epic 2) and Skill Execution core (Epic 3, excl. 3-7) build and pass tests with **no AWS account**.
- Epic 7 cutover to AWS requires **configuration changes only** (backend selectors), with Cognito swapped for the dev-auth shim.
- All P1 requirements remain in scope; MVP unchanged.

---

## Appendix — Change Navigation Checklist Results

| § | Item | Status |
|---|------|--------|
| 1.1 | Triggering story: 1-3 AWS Infrastructure Foundation (blocked) | ✅ Done |
| 1.2 | Core problem: external-dependency / sequencing | ✅ Done |
| 1.3 | Evidence gathered (sprint-status, epic narrative, deferred-work) | ✅ Done |
| 2.1 | Epic 1 cannot complete as-is; rescope needed | ❗ Action-taken |
| 2.2 | Rescope Epic 1 + extract infra to new epic | ❗ Action-taken |
| 2.3 | Remaining epics reviewed for dependencies | ✅ Done |
| 2.4 | No epics invalidated; one new epic (re-homed work) | ✅ Done |
| 2.5 | Resequence epics/priorities | ❗ Action-taken |
| 3.1 | PRD: MVP intact; clarifying note added | ❗ Action-taken |
| 3.2 | Architecture: additive provider note added | ❗ Action-taken |
| 3.3 | UI/UX: no conflict | ✅ N/A |
| 3.4 | sprint-status, deferred-work, IaC updated | ❗ Action-taken |
| 4.1 | Direct Adjustment | ✅ Viable (selected) |
| 4.2 | Rollback | ❌ Not viable / unnecessary |
| 4.3 | MVP Review | ❌ Not needed |
| 4.4 | Recommended path = Hybrid (Direct Adjustment) | ✅ Done |
| 5.1–5.5 | Proposal components compiled | ✅ Done |
| 6.1–6.5 | Review, approval, sprint-status update, handoff | ✅ Done |
