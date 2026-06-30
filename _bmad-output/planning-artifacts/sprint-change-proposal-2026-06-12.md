# Sprint Change Proposal — Skills Registry Pagination

- **Date:** 2026-06-12
- **Author:** Developer (via bmad-correct-course)
- **Trigger:** Story 5-2 (Run Console — Context-First Mode) code review + dev-DB cleanup
- **Scope classification:** Moderate (backlog addition, cross-stack; no replan)
- **Status:** Approved 2026-06-12

---

## 1. Issue Summary

During **Story 5-2** code review and the subsequent local dev-DB cleanup, the Skill Registry page was found to be slow. Root cause:

- `GET /api/v1/skills` → `skill_service.list_skills` (`velara-api/app/services/skill_service.py:341-360`) returns the **entire org's skills** via `.scalars().all()` with **no `LIMIT`/`OFFSET`**.
- The frontend `SkillRegistry` (`velara-web/src/features/skills/components/SkillRegistry.tsx:102-124`) **fetches the whole list and filters client-side** in a `useMemo`.

With ~3,485 skill rows (mostly integration-test cruft accumulated because the integration suite writes to the shared dev DB without rollback/cleanup), this is a real performance cliff. The DB cruft has since been cleared (volume reset + re-migrate to head `0012`), but the structural limitation remains and cruft will re-accumulate on the next test run.

**Evidence that pagination was always intended:** `PageMeta {total, page, per_page}` already exists in `velara-api/app/schemas/common.py:36-40` with the docstring *"Pagination metadata for future list endpoints."*

**Issue type:** Technical limitation discovered during implementation.

---

## 2. Impact Analysis

| Area | Impact |
|------|--------|
| **Epic** | Epic 2 (Skill Registry) is `done` and stays closed. Two new stories land in **Epic 5** (active in-progress epic), per user decision. No future epics invalidated. |
| **Stories** | Net-new: **5-6 (backend)** + **5-7 (frontend)**. No reopening of `done` stories. Story 5-5 (OpenAPI) auto-reflects the new query params. |
| **PRD** | §6.1 Performance has no list-latency target — added one (NFR). |
| **Architecture** | Documented offset/limit + `PageMeta` envelope as the list-endpoint convention (Implementation Patterns doc). |
| **UX** | Registry needs a pagination affordance (page controls or "Load more"). |
| **Technical** | Backend query + endpoint + envelope; FE query-key + API client + a shift from fetch-all-filter-client to server-side filter+page. Backwards-compatible defaults keep existing callers working. |

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment (Hybrid: two new stories in Epic 5).**

- **Effort:** Medium · **Risk:** Low
- **Rationale:** Keeps `done` stories done (no rollback churn), uses the prepositioned `PageMeta`, and the chosen offset/limit mechanism supports jump-to-page + total counts with minimal new surface. Separate BE/FE stories let the backend contract land and be reviewed before the UI consumes it.
- **Alternatives considered:** Cursor-based pagination (rejected — no jump-to-page, discards prepositioned `PageMeta`, more work); reopening done Stories 2.1/2.4 (rejected — moves done work back to in-progress); MVP review / rollback (N/A — no scope reduction needed).

**Pagination mechanism (locked):** offset/limit via `page`/`per_page`, default 50 / max 200, `PageMeta` envelope.

---

## 4. Detailed Change Proposals

### 4a. New Story — 5-6: Skills List API Pagination (BACKEND) → `backlog`
Backend `list_skills` LIMIT/OFFSET + filtered `COUNT(*)` + `PageMeta` envelope on `GET /api/v1/skills`. Keeps `?status=`/`?tag=` filters; backwards-compatible defaults; out-of-range page → empty data + correct total; invalid params → 422. No migration. *(Full ACs appended to `epics/epic-5-run-console-invocation-ux.md`.)*

### 4b. New Story — 5-7: Skill Registry UI Pagination (FRONTEND, depends on 5-6) → `backlog`
`SkillRegistry` consumes the paged API via `useSkills`/`listSkills` page params; moves `status`/`tag` to server-side; adds a keyboard-accessible pagination affordance reflecting `PageMeta.total`; free-text/⌘K search behavior decided in-story. *(Full ACs in the Epic 5 doc.)*

### 4c. PRD §6.1 Performance — added NFR
`| Skill registry list response (server-side, P95) | ≤ 500 ms at 10k skills, via pagination |`

### 4d. Architecture — Implementation Patterns
Added "List endpoint pagination (offset/limit)" under Format Patterns: `page`/`per_page` (default 50, max 200), `PageMeta` envelope, filtered total, out-of-range/invalid handling, backwards-compat; future list endpoints SHOULD adopt the same shape.

### 4e. Epic 5 doc
Appended Story 5.6 and 5.7 stanzas with full acceptance criteria.

---

## 5. Implementation Handoff

**Scope: Moderate** (backlog addition + cross-stack, no replan).

- **create-story → dev-story (Developer / Amelia):** author 5-6 then 5-7; **build 5-6 first** (FE depends on the contract).
- **PRD/Architecture edits:** applied as part of this proposal (4c/4d).
- **Success criteria:** registry list P95 ≤ target with seeded volume; both stories' gates green; OpenAPI (5-5) shows the new params.

### Secondary issue noted (NOT in this proposal)
Integration tests write to the shared dev DB with no rollback/cleanup, so skill cruft re-accumulates on every `pytest` run (this is *why* the DB had 3,485 rows). The user chose to address **pagination** via this correct-course; test-DB isolation is logged here as a separate follow-up to consider (e.g. rolled-back per-test transactions or an ephemeral test DB).

---

## Artifacts Modified

- `_bmad-output/implementation-artifacts/sprint-status.yaml` — added `5-6-skills-list-api-pagination` + `5-7-skill-registry-ui-pagination` as `backlog`.
- `_bmad-output/planning-artifacts/epics/epic-5-run-console-invocation-ux.md` — appended Story 5.6 + 5.7.
- `_bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/6-non-functional-requirements.md` — added list-latency NFR.
- `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md` — added pagination convention.
