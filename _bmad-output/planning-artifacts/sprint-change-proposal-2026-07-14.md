# Sprint Change Proposal — 2026-07-14

## Trigger

Developer requested (during Epic 13 planning, before any Epic 13 story had started) that the audit log's category taxonomy be improved as part of this sprint. Today's audit log UI groups events with a flat, hand-picked pill list (`All / Success / Failures / Blocked / Grants / Certifications / Lifecycle / Provisioning`) that mixes outcome values with specific event-type literals. Epic 13 is about to add roughly 15 new event types (`auth.*`, `access.*`, `audit.*`, plus new `admin.*` events) for HIPAA/SOC 2 compliance auditing — without better categorization, the existing ad hoc pattern would be extended per-story and the filter UI would become progressively less useful exactly as the number of auditable event families grows.

No production data exists yet, so no migration/backfill concern applies — this is a forward-looking design correction, not a data-repair task.

## Issue Summary

**Section 1.1 — Triggering context:** Not a story-execution defect; a planning-stage improvement identified before Epic 13 development begins. Epic 13 (all 6 original stories) was in `backlog` status with zero stories started, making this the ideal time to change scope with no rollback or in-flight rework needed.

**Section 1.2 — Issue category:** New requirement emerged from stakeholder review of upcoming epic scope (recognizing the existing category UX wouldn't scale to Epic 13's new event volume).

**Section 1.3 — Evidence:**
- `AuditLog.tsx:300-316` / `eventKindMeta.ts:19-43` — the current pill filter is flat and hand-picked, mixing `outcome` and `event_type` values.
- `eventKindMeta.ts:12-17` — the code itself documents the exact-match limitation ("Grants" pill misses `admin.grant_revoked`/`admin.grant_reaffirmed`; "Provisioning" misses `admin.user_invite_resent`).
- `audit.py:112` (BE) — `event_type` is a free-text `String` column with no category/grouping concept anywhere in the backend.
- Epic 13 as drafted (`epic-13-compliance-audit-and-access-controls.md`) adds ~15 new event types across `auth.*`, `access.*`, `audit.*`, and new `admin.*` — none of which the current FE pill pattern could represent without per-event hardcoding.

## Impact Analysis

**Epic impact:** Epic 13 gains one new story. No other epic is affected — Epic 12 (`12-5`, `done`... actually `ready-for-dev`/in-flight per sprint-log) is unaffected; its guard-test registry pattern is *reused* (not modified) by the new story's category-completeness guard test.

**Story impact:** New Story **13.1: Audit Event Categorization**, inserted as Epic 13's first story. The original six stories (13.1–13.6) are renumbered to 13.2–13.7 with no scope change — only IDs shifted. Four of the renumbered stories (13.2 Deprovisioning, 13.3 Read-Path Disclosure, 13.4 Auth Events, 13.6 Unaudited Mutations) each gain one additional AC: assign their new event type(s) to a category in 13.1's taxonomy, enforced by 13.1's guard test.

**Artifact conflicts:**
- `epics/epic-13-compliance-audit-and-access-controls.md` — new Story 13.1 inserted; 13.1–13.6 renumbered to 13.2–13.7; stale internal cross-references (e.g. "per 13.4" → "per 13.5") corrected; new "Sequencing" note documenting the renumber.
- `epics/epic-list.md` — Epic 13 story bullet list renumbered, new 13.1 bullet added.
- `epics/requirements-inventory.md` — FR-SEC-13..17's "(Epic 13.x)" citations shifted to match new numbering.
- `implementation-artifacts/sprint-status.yaml` — new `13-1-audit-event-categorization: backlog` entry added; existing five entries renumbered `13-1..13-6` → `13-2..13-7`.
- `implementation-artifacts/sprint-log.md` — **left unchanged** (historical record of the 2026-07-13 planning session under its own numbering); a note was added immediately before the `13-1-user-deprovisioning` entry cross-referencing the renumber, so a future reader isn't misled.

**Technical impact:** New Story 13.1 touches: (1) a static, code-owned `event_type → category` mapping on the backend (no DB migration — `event_type` stays a free-text column), (2) a new `category` query param on `GET /api/v1/audit` that expands server-side to the full set of event types in that category, (3) a rework of the FE top filter from the current flat pill list to 7 category pills + an orthogonal outcome filter, and (4) a guard test (mirroring 12.5's registry-guard pattern) that fails the build if any `event_type` is introduced without a category assignment. Per-row event icons (`eventTypeIconMeta.ts`) are explicitly out of scope and unchanged.

## Recommended Approach

**Selected: Direct Adjustment (Option 1)** — add the new story within the existing Epic 13 structure; no rollback, no MVP/PRD scope change.

- **Effort:** Low-Medium. The mechanism (static mapping + guard test + one new query param + FE filter swap) is small; most of the "cost" already happened in this session (taxonomy design against the real current+planned event-type list).
- **Risk:** Low. Epic 13 has zero stories started, so there's no in-flight work to reconcile. The four downstream stories each gain one small, mechanical AC rather than a redesign.
- **Rationale:** Doing this first (as the user specifically requested, positioning it as 13.1) means the taxonomy mechanism exists before any of Epic 13's ~15 new event types are introduced, so each subsequent story assigns its own new events to a category as part of landing that story — avoiding a retrofit/audit pass at the end. This was validated against the codebase before drafting: the current FE pattern's exact-match limitation is a *documented, known* gap in the code itself, not a hypothetical concern.

Rollback (Option 2) and MVP review (Option 3) were not applicable — no completed work exists to roll back, and this doesn't touch PRD/MVP scope, only Epic 13's internal story breakdown.

## Category Taxonomy (final)

| Category | Event types |
|---|---|
| **Skill Execution** | `invocation.success`, `invocation.failure`, `invocation.cancelled`, `invocation.blocked`, `invocation.fan_out` |
| **Skill Maintenance** | `admin.skill_created`, `admin.skill_updated`, `admin.skill_version_created`, `admin.skill_derived`, `admin.skill_draft_content_updated`, `admin.skill_adapter_proposed`, `admin.skill_exported`, `admin.skill_imported`, `admin.skill_promoted`, `admin.document_ingested` |
| **Organization** | `admin.hierarchy_created/updated/deleted` *(new, 13.6)*, `admin.skill_attached/detached` *(new, 13.6)* |
| **Access Control** | `admin.grant_created/reaffirmed/revoked`, `admin.user_provisioned`, `admin.user_invite_resent`, `admin.user_deprovisioned/reprovisioned/role_changed` *(new, 13.2)* |
| **Authentication** | `auth.login_succeeded/login_failed/logout/session_revoked` *(new, 13.4)* |
| **Compliance & Disclosure** | `access.artifact_disclosed` *(new, 13.3)*, `audit.log_accessed` *(new, 13.6)*, `admin.certification`, `admin.lifecycle_transition` |
| **Security** | sandbox network-blocked event *(new, 13.6)*, denial/threshold-alarm events if persisted to `audit_log_entries` *(new, 13.4)* |

## Detailed Change Proposals

All edits below are **applied** (this proposal documents changes already made in this session, per the user's batch-review preference).

1. **New Story 13.1** written into `epic-13-compliance-audit-and-access-controls.md` — full ACs covering the taxonomy, the guard test, the `category` query param, the FE filter rework, and the "no migration needed" clarification.
2. **Renumbered** the original six stories 13.1→13.2 through 13.6→13.7 in the epic file, `epic-list.md`, `requirements-inventory.md`, and `sprint-status.yaml`.
3. **Corrected stale cross-references** inside the epic file that pointed at old story numbers (e.g. "per 13.4" for CloudTrail now correctly reads "per 13.5").
4. **Added one AC each** to renumbered Stories 13.2, 13.3, 13.4, and 13.6, requiring their new event types to be assigned a category per 13.1's mapping.
5. **`sprint-log.md`** left as originally written (historical log), with one explanatory note inserted ahead of the affected section so the pre-renumber IDs there aren't confused with the current ones.

## PRD / MVP Impact

None. This change is scoped entirely within Epic 13's internal story breakdown and does not touch the PRD, MVP definition, architecture, or UX specifications beyond the audit log's own filter UI (which Epic 9/12 already established as a feature, now being extended).

## Implementation Handoff

**Scope classification: Minor.** All planning-artifact edits are complete as of this proposal. Handoff is to the **Developer agent** for direct implementation via `create-story` → `dev-story` on `13-1-audit-event-categorization` when Epic 13 development begins, followed by `13-2` through `13-7` in the documented order.

**Success criteria:** Story 13.1 ships with the 7-category mapping, the completeness guard test, the `category` query param, and the reworked FE filter — before any other Epic 13 story lands. Stories 13.2/13.3/13.4/13.6 each pass 13.1's guard test when they introduce their new event types.
