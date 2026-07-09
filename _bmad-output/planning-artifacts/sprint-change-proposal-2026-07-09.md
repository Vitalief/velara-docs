# Sprint Change Proposal — Audit Coverage Gap (Skill-Authoring & Ingest Mutations)

**Date:** 2026-07-09
**Author:** John (PM) via `bmad-correct-course`
**Change scope classification:** **Moderate** (backlog change + new story; backend-only implementation, additive)
**Status:** Approved for implementation — routed to backlog as Story 12.5

---

## Section 1 — Issue Summary

**Problem:** Skill-authoring and document-ingest mutations write **no audit event**. A skill can be created, versioned, edited, or derived — and a client document ingested — with **zero audit trail**. Only the skill's later *execution* is logged.

**How it was discovered:** During real use of **deployed dev**, the operator created a prompt-based skill ("Extract Inclusion and Exclusion Criteria") and observed that its creation produced no audit-log entry, while its subsequent execution did.

**Evidence (code-verified 2026-07-09, `velara-api`):**

| Mutation | Location | Audited? | Severity |
|---|---|---|---|
| `create_skill` | `skill_service.py:617` | ❌ No | **HIGH** — new skill (incl. client-facing) enters system with no trail |
| `create_version` | `skill_service.py:951` | ❌ No | **HIGH** — new immutable version, no who/when |
| `update_skill_metadata` | `skill_service.py:1174` | ❌ No | **MEDIUM** — visibility/output_format editable; visibility→client_facing is an access-surface change |
| `derive_skill` | `skill_service.py:1226` | ❌ No | **MEDIUM** — creates paired client-facing skill, IP-boundary-relevant |
| document ingest | `ingest_service.py` / `api/v1/ingest.py` | ❌ No | **MEDIUM–HIGH** — client protocol docs (potential PHI) uploaded, no record |

**Already audited (working, for contrast):** all 5 `invocation.*` events; `admin.grant_created/.grant_reaffirmed/.grant_revoked`; `admin.lifecycle_transition`; `admin.certification`; `admin.user_provisioned/.user_invite_resent`; `admin.skill_adapter_proposed`. **13 event types fire correctly** — the gap is specifically skill *authoring* + ingest.

**Root cause:** The audit layer was built **execution-first** (Epic 9). Admin-mutation coverage was then added **piecemeal, per-story**, only where a specific story called for it — grants (Epic 8), lifecycle + certification (Epic 9), provisioning (Epic 10), adapter-propose (11.3). **Skill authoring and ingest were never on any story's audit checklist** and fell through the seam between epics. This is a *coverage* gap (missing work), not a *defect* (broken work) — the audit machinery is sound; it was simply never wired to these call sites.

---

## Section 2 — Impact Analysis

- **Epic impact:** No existing epic is invalidated. This is **new remediation scope**. It was initially considered for Epic 11 (where the skill-authoring code lives) but **correctly reclassified to Epic 12** — Epic 11 is "AI-Assisted Skill Integration & Promotion" (a capability theme), whereas this is an **observability/compliance** concern. Epic 12 ("Skill & Audit Lifecycle Polish") already owns audit-surface work (12.2 context names, 12.3 event icons) and is the thematically correct home. Epic 12 was `done`; this **reopens it** with Story 12.5.
- **Story impact:** One new story — **12.5**. No existing story requires modification.
- **Artifact conflicts:** **None.** No PRD change (this strengthens the existing audit/compliance posture, doesn't conflict with it). No new architecture — reuses the existing `record_admin_action` seam and the `audit_log` table + `org_id` column (migration 0020). **No migration.** No UI/UX change — the 9.3 audit viewer renders any event type generically, so new events surface automatically.
- **Technical impact:** Backend-only, additive. New `EVENT_ADMIN_*` constants + best-effort audit writes at 5 call sites, mirroring the proven try/except pattern. Plus a **guard/regression test** so the gap cannot silently reopen. FE follow-on is limited to icon coverage, which rides Story 12.3's existing `eventTypeIconMeta.ts` map.

---

## Section 3 — Recommended Approach

**Option 1 — Direct Adjustment (new story in Epic 12).** Selected.

- **Effort:** Medium. **Risk:** Low — the best-effort audit pattern is already proven at 5 existing call sites; event types are additive; no migration; no FE.
- **Rationale:** This is missing coverage, not broken code — nothing to roll back (Option 2 N/A), no MVP-scope change (Option 3 N/A). A single, well-scoped remediation story with a guard test is the proportionate response. The guard test is the durable win: it converts a one-time backfill into a permanent invariant ("every admin mutation is audited"), so future authoring surfaces (e.g. Story 11.6 draft-edit, 11.9 manifest generation) can't reintroduce the gap.
- **Priority note:** This is a live compliance gap in a deployed environment. Recommend prioritizing 12.5 ahead of remaining Epic 11 *feature* stories **if audit completeness is a release gate** — to be confirmed at pickup. Compliance debt compounds (every unaudited mutation accumulates untracked); features do not rot.

---

## Section 4 — Detailed Change Proposals

**Epic file — `epic-12-skill-and-audit-lifecycle-polish.md`:**
- Header updated: epic "Reopened 2026-07-09," suggested order extended to `12.1 → 12.2 → 12.3 → 12.4 → 12.5`, FR line + summary updated.
- **New Story 12.5** appended, in the epic's house style (Reality note + Given/When/Then), with the full unaudited-mutation inventory, the "already audited — do not touch" list, and four acceptance criteria: (1) create/version audited, (2) update/derive audited, (3) ingest audited with IP/PHI discipline (reference/IDs only), (4) **guard test fails CI if any admin mutation lacks an audit write**, plus a constraint AC (reuse existing seam, no migration).

**Sprint status — `sprint-status.yaml`:**
- `epic-12: done → in-progress` (reopened).
- New entry `12-5-audit-coverage-skill-authoring-ingest: backlog` with the full scope note.
- Top-of-file changelog entry added.

**No code changes in this proposal** — implementation is deferred to `create-story` + `dev-story` when 12.5 is picked up, per BMad discipline (epic AC is the contract; implementation plan is expanded one story at a time).

---

## Section 5 — Implementation Handoff

- **Scope:** Moderate → routed to backlog as Story 12.5, to be expanded via `create-story` when picked up.
- **Success criteria:** All 5 identified mutations write a best-effort audit event; a guard/regression test fails CI on any unaudited admin mutation; no migration introduced; ingest event respects IP/PHI discipline (no document content in the event); gates green (ruff + full suite + api-spec diff = new endpoints/none as applicable).
- **Recommended implementer:** Developer agent (`dev-story`) after `create-story 12-5`.
- **Suggested next step for the operator:** decide 12.5's priority vs. Epic 11 feature work (compliance gate question), then run `create-story 12-5`.
