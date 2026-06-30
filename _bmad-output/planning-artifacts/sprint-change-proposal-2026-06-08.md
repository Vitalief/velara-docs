# Sprint Change Proposal — Velara

**Date:** 2026-06-08
**Author:** Developer (via Correct Course workflow)
**Mode:** Incremental
**Scope classification:** **Moderate** (additive backlog changes + requirement additions; compliance touches PRD/architecture → PM/Architect FYI)
**Status:** Approved — edits applied

---

## Section 1 — Issue Summary

**Problem statement.** Six changes need to be reflected in the sprint: **four client-required design changes** (refreshed in `design/` on 2026-06-08) plus **two explicit directives** (compliance, browser tab title).

1. Date-range filter on the **Audit Log** screen
2. **User-level analytics** on the Analytics screen (analyze metrics by individual user)
3. **Search/filter (mock)** on the unified **Engagements** screen (find a project among hundreds)
4. **Breadcrumbs** on Project/Study/Location screens (Client → Project → Study → Location)
5. Make **HIPAA + 21 CFR Part 11** explicit, named compliance requirements
6. **Browser tab title** = current page name (Study/Project/Location/…) instead of a generic "Velara" label

**Discovery context.** Surfaced from client design updates + two named directives during sprint setup. The platform is mid-Epic-1 (1-1/1-2 done, 1-3 `ready-for-dev`) following the 2026-06-05 resequencing.

**Evidence.**
- The `design/` Analytics component (`internal2.jsx` → `Analytics`) already has **Overview** and **By User** tabs (`selUser`, `USER_STATS`) — user-level analytics is in the design but absent from the epics.
- `design/overrides.jsx` → `BreadcrumbBar` renders the full hierarchy path for project/study/location.
- No `document.title` anywhere in `design/` → the tab-title change is genuinely new.
- `grep` across all planning/implementation artifacts: **"21 CFR Part 11" appears nowhere** (entirely new); HIPAA appears 9× in the PRD but is not framed as a named compliance framework; **no analytics story/UX-DR exists**.
- The `uploads/` BRD is substantively identical to the `docs/` BRD (not the source of changes).

**Categorization:** New requirements from stakeholder — not a failure, not a scope cut.

---

## Section 2 — Impact Analysis

| # | Change | Maps to | Pre-existing? | Action |
|---|--------|---------|---------------|--------|
| 1 | Audit date-range filter | Epic 9 (9-2 query, 9-3 UI) | ✅ 9-2 already has `from/to`; 9-3 had "time range" | Make **date-range picker** explicit in 9-3 |
| 2 | User-level analytics | — (gap) | ❌ no analytics surface formalized | New stories **9-4 (API)** + **9-5 (UI)**; FR-USE-06; UX-DR-13; nav update |
| 3 | Engagements search/filter (mock) | Epic 4 (4-2) | ⚠️ partial (⌘K in 4-4) | New AC on 4-2 (client-side mock; server-side → P2); FR-ORG-07 |
| 4 | Breadcrumbs | Epic 4 (4-4) | ✅ Study+Location specced | Add explicit **Project** breadcrumb AC |
| 5 | HIPAA + 21 CFR Part 11 | PRD, architecture, Epics 6/7/8/9 | ❌ Part 11 absent | Named frameworks + FR-SEC-08–12 + e-sig (E6) + audit-trail (E9) + validation plan (E7) |
| 6 | Browser tab title | Epic 1 (app shell) | ❌ none | New **Story 1-5**; UX-DR-14 |

**Epic impact:** Changes land in **backlog Epics 4, 6, 7, 9** (AC additions + 2 new analytics stories) and a **new Epic 1 shell story (1-5)**. **No completed work (1-1/1-2) or the in-flight 1-3 is reworked.** Epic 9 is renamed **"Audit Log, Usage & Analytics."**

**Artifact conflicts:** None. PRD/architecture get *additive* compliance notes; the audit log, certification records, and RBAC are already the 21 CFR Part 11 anchors.

**Technical impact:** Analytics API is **read-only, derived** from existing audit/invocation data (no new source of truth). E-signature manifestation adds a `signature_meaning` field to `certification_records`. Tab title is a single shared `useDocumentTitle`/router effect. Part 11 adds a compliance-mapping doc + validation plan (full IQ/OQ/PQ deferred).

---

## Section 3 — Recommended Approach

**Selected: Direct Adjustment** — augment requirements + backlog epics with new ACs and two new stories. No rollback, no MVP reduction. Effort **Medium**, Risk **Low** (additive, mostly backlog).

**Stakeholder decisions (2026-06-08):**
1. **21 CFR Part 11 depth →** explicit + cheap gap-closers (e-signature manifestation, audit attributability); **defer** formal computer-system validation (IQ/OQ/PQ) and full non-repudiation to a tracked compliance backlog (FR-SEC-12).
2. **Analytics →** extend **Epic 9 → "Audit Log, Usage & Analytics"** with a Usage & Value Analytics **API (9-4)** + **UI (9-5)** (Overview + By-User).
3. **Tab title →** **new standalone Story 1-5** in Epic 1 (app shell).
4. **Engagements search →** UI-only **mock** (client-side) per the directive; server-side search deferred (P2, FR-ORG-07).

---

## Section 4 — Detailed Change Proposals (applied)

### Requirements (`requirements-inventory.md`)
- **+ FR-SEC-08** HIPAA named framework · **FR-SEC-09** Part 11 audit-trail (secure, UTC-stamped, attributable, tamper-evident) · **FR-SEC-10** Part 11 e-signatures (signer + UTC time + meaning, bound to version) · **FR-SEC-11** Part 11 access/authority · **FR-SEC-12 [deferred]** formal validation (IQ/OQ/PQ) + non-repudiation
- **+ FR-USE-06** usage analytics (Overview + per-user)
- **+ FR-ORG-07** Engagements on-screen search/filter (Phase 1 mock; server-side P2)
- **+ UX-DR-13** Analytics (Overview + By-User) · **+ UX-DR-14** per-page tab title · **UX-DR-02** nav now includes "Usage & Value (Analytics)"
- **FR Coverage Map** remapped (Epic 9 = audit+analytics+FR-SEC-09; Epic 6 += FR-SEC-10; compliance + tab-title rows added; FR-SEC-12 added to deferred line)

### PRD (`Velara-PRD-full.md`)
- Added **"Compliance Frameworks — HIPAA + 21 CFR Part 11"** note (names both, maps to controls, states the single deferral). No P1/MVP goal removed.

### Architecture (`core-architectural-decisions.md`)
- Added **"Regulatory Compliance — HIPAA + 21 CFR Part 11"** subsection: clause→control map (§11.10(e) audit→E9, §11.50/§11.70 e-sig→E6, §11.10(d)(g)/§11.300 access→E7/E8, §11.10(a) validation deferred).

### Epics
| Epic | Change (applied) |
|------|------------------|
| **1** | **+ Story 1.5 — Per-Route Browser Tab Title** (`{Page}·Velara`; `{Entity}·{Type}·Velara`; shared mechanism; client-portal scoped). Static titles now; entity titles as Epic 4 lands. |
| **4** | **Story 4.2** += on-screen **search/filter (client-side mock)** AC · **Story 4.4** += explicit **Project** breadcrumb AC |
| **6** | **Story 6.1** schema += `signature_meaning`, `certified_at` (UTC) + Part 11 e-signature AC · **6.2/6.3** += signer name + signature statement + recorded manifestation (signer, UTC time, meaning) |
| **7** | **Story 7.4** retitled **"Cloud Observability, HIPAA & 21 CFR Part 11 Compliance Baseline"**; += `docs/compliance-mapping.md` + `docs/validation-plan.md` ACs; explicit deferral of IQ/OQ/PQ |
| **9** | Renamed **→ "Audit Log, Usage & Analytics"** (`epic-9-audit-log-usage-analytics.md`); **9.1** += Part 11 attributability/tamper-evidence AC; **9.3** += date-range picker AC; **+ Story 9.4 — Usage & Value Analytics API** (overview + per-user, internal-only, derived); **+ Story 9.5 — Usage & Value Analytics UI** (Overview + By-User tabs) |

### Index / list / sprint-status
- `epic-list.md` + `index.md`: Epic 9 retitled, 9.4/9.5 added, Story 1.5 added, Story 7.4 retitled, FR/UX-DR coverage updated, 2026-06-08 notes.
- `sprint-status.yaml`: + `1-5`, `9-4`, `9-5` (all `backlog`); Epic 9 comment retitled; `last_updated: 2026-06-08`.

---

## Section 5 — Implementation Handoff

**Scope: Moderate.** All edits above are **applied** to the planning + implementation artifacts.

| Recipient | Responsibility |
|-----------|----------------|
| **Product Owner / Developer** | Confirm the new ACs + analytics stories reflect the client design intent; `sprint-status.yaml` is the sequencing source of truth. |
| **Developer (next actions)** | Continue Story **1-3** (in progress). When ready, `create-story` for the new **1-5**, **9-4**, **9-5**. ACs added to existing backlog stories (4-2, 4-4, 6-1/2/3, 7-4, 9-1/9-3) will be picked up when those stories are contexted. |
| **PM / Solution Architect (FYI)** | **21 CFR Part 11** is now a named compliance framework. Confirm the Phase-1 scope line: cheap gap-closers in-build (e-sig manifestation, audit attributability) + validation **plan**; formal IQ/OQ/PQ execution deferred (FR-SEC-12). Owns the compliance-mapping + validation-plan deliverable (Story 7-4). |

**Success criteria**
- Audit screen has a working date-range picker; analytics screen shows Overview + per-user metrics; Engagements screen has a (mock) search/filter; Project/Study/Location screens show full breadcrumbs; browser tabs show per-page titles.
- Certification records carry e-signature manifestation (signer, UTC time, meaning); audit log meets Part 11 §11.10(e); HIPAA + Part 11 are documented with a clause map + validation plan.
- No P1 requirement removed; resequenced feature-first plan intact.

---

## Appendix — Change Navigation Checklist Results

| § | Item | Status |
|---|------|--------|
| 1.1–1.3 | Trigger (client design + 2 directives), problem, evidence | ✅ Done |
| 2.1 | Current epic (Epic 1) unaffected; changes hit backlog epics | ✅ Done |
| 2.2–2.4 | Epic changes: +2 analytics stories, +1 shell story, AC additions; Epic 9 renamed; none invalidated | ❗ Action-taken |
| 2.5 | No resequencing needed (additive) | ✅ Done |
| 3.1 | PRD: MVP intact; compliance note added | ❗ Action-taken |
| 3.2 | Architecture: additive compliance subsection | ❗ Action-taken |
| 3.3 | UI/UX: design-driven; UX-DR-02/13/14 updated | ❗ Action-taken |
| 3.4 | requirements-inventory, epic-list, index, sprint-status updated | ❗ Action-taken |
| 4.1 | Direct Adjustment | ✅ Viable (selected) |
| 4.2 | Rollback | ❌ Not needed |
| 4.3 | MVP Review | ❌ Not needed |
| 4.4 | Recommended = Direct Adjustment | ✅ Done |
| 5.1–5.5 | Proposal components compiled | ✅ Done |
| 6.1–6.5 | Review, approval, sprint-status update, handoff | ✅ Done |
