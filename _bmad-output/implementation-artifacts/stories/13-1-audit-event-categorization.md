---
baseline_commit: 8b91b230c0f81f50c82a80a0c0f243ad5ab67e5e
---

# Story 13.1: Audit Event Categorization

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an admin or compliance reviewer,
I want audit events grouped into a small set of meaningful categories at the top of the audit log,
so that I can filter by "what kind of thing happened" (a skill ran, someone's access changed, someone logged in, a document was disclosed) without needing to know raw `event_type` strings — and so every event family, including the ~15 new ones Epic 13 is about to add, is filterable by family rather than only by exact type.

**Why this story exists, and why it runs first:** the current FE filter ([eventKindMeta.ts:19-43](../../../velara-web/src/features/audit/eventKindMeta.ts#L19)) is a flat, hand-picked pill list that mixes `outcome` values (`success`/`failure`/`blocked`) with specific `event_type` literals. The query API's `event_type` filter is exact-match only ([audit.py:87,234](../../../velara-api/app/api/v1/audit.py#L87)), so each pill only ever catches the one literal it was wired to — the code's own header comment documents this as a known limitation ("Grants" misses `grant_reaffirmed`/`grant_revoked`; "Provisioning" misses `user_invite_resent"). There is **no category concept anywhere in the backend** — `event_type` is a free-text `String` column ([audit.py:112](../../../velara-api/app/models/audit.py#L112)) with no enum and no grouping field. Stories 13.2–13.6 are about to add ~15 more event types across new `auth.*`/`access.*`/`audit.*` prefixes; without this story landing first, each of those stories would extend the same broken flat-pill pattern. This story builds the taxonomy + guard mechanism up front so every event type introduced from here on is assigned a category at the point it's added.

## Acceptance Criteria

1. **AC1 — Every event type maps to exactly one of 7 categories via a single static, code-owned mapping.**
   **Given** the full set of audit `event_type` values (today's 22 constants in `app/models/audit.py`)
   **When** the category mapping is implemented
   **Then** every one resolves to exactly one of: **Skill Execution, Skill Maintenance, Organization, Access Control, Authentication, Compliance & Disclosure, Security** — no DB migration, no backfill (pure code/mapping change, `event_type` stays a free-text column)

2. **AC2 — A guard test fails the build if a new event type has no category.**
   **Given** the mapping module
   **When** the test suite runs
   **Then** a guard test (mirroring 12.5's `test_audit_coverage_guard.py` registry pattern) discovers every `EVENT_*` constant in `app.models.audit` **programmatically** (not a hand-copied list) and asserts each has a mapping entry — a future story that adds an event type with no category assignment fails CI with an actionable message, not a silent gap

3. **AC3 — `GET /api/v1/audit` accepts a `category` query param that expands server-side to the full event-type set.**
   **Given** the audit log query API
   **When** a request includes `?category=<name>`
   **Then** it expands to `event_type IN (<all types in that category>)` server-side — closing the exact-match gap the FE pills currently work around — and `event_type`/`outcome` filters continue to work unchanged and combine with `category` (AND semantics, same as every other filter combination `list_entries` already supports)

4. **AC4 — The audit log UI's top filter is replaced with the 7 categories (+ "All events"), orthogonal to outcome.**
   **Given** the audit log UI's filter toolbar
   **When** it renders
   **Then** the pill/tab bar shows "All events" + the 7 categories, each catching every event type in its category; "Success/Failures/Blocked" become a **separate, orthogonal** outcome filter (still available, no longer conflated with category) — a user can select a category AND an outcome simultaneously (e.g. "Skill Execution" + "Failures")

5. **AC5 — Per-row iconography is unchanged.**
   **Given** an audit log row
   **When** it renders
   **Then** [eventTypeIconMeta.ts](../../../velara-web/src/features/audit/eventTypeIconMeta.ts) and its per-row icon rendering are untouched by this story — only the top-level filter/grouping changes

6. **AC6 — Downstream Epic 13 stories inherit an enforced taxonomy, not a suggestion.**
   **Given** this story lands first in Epic 13
   **When** Stories 13.2, 13.3, 13.4, and 13.6 each introduce their new event types (`admin.user_deprovisioned`/`reprovisioned`/`role_changed`; `access.artifact_disclosed`; `auth.login_succeeded`/`login_failed`/`logout`/`session_revoked`; hierarchy/attachment CRUD events; `audit.log_accessed`; the sandbox network-blocked event)
   **Then** AC2's guard test is the enforcement mechanism — each of those stories' own tasks must add a category-mapping entry for their new constant(s), and the guard test fails their CI if they don't. (This story does not add those future constants itself — there is nothing to map yet.)

7. **AC7 — No data migration.**
   **Given** no production data exists yet
   **When** this story ships
   **Then** no migration, no backfill — confirm `alembic` head is unchanged after this story

## Tasks / Subtasks

- [ ] **Task 1 — Build the category taxonomy as a static, code-owned mapping (AC1)**
  - [ ] Add a new module `velara-api/app/models/audit_categories.py` (co-located with `app/models/audit.py`, which already holds every `EVENT_*` constant this maps). Define:
    - `CATEGORY_SKILL_EXECUTION = "skill_execution"`, `CATEGORY_SKILL_MAINTENANCE = "skill_maintenance"`, `CATEGORY_ORGANIZATION = "organization"`, `CATEGORY_ACCESS_CONTROL = "access_control"`, `CATEGORY_AUTHENTICATION = "authentication"`, `CATEGORY_COMPLIANCE_DISCLOSURE = "compliance_disclosure"`, `CATEGORY_SECURITY = "security"` (stable string values — never rename after deploy, matching every existing constant's house convention in `audit.py`).
    - `ALL_CATEGORIES = frozenset({...})` — analogous to `VALID_OUTCOMES` in `audit_service.py:38`.
    - `EVENT_TYPE_TO_CATEGORY: dict[str, str]` — the single source of truth. Populate it with **today's 22 event types only** (do not invent future stories' constants):
      - **Skill Execution:** `EVENT_INVOCATION_SUCCESS`, `EVENT_INVOCATION_FAILURE`, `EVENT_INVOCATION_CANCELLED`, `EVENT_INVOCATION_BLOCKED`, `EVENT_INVOCATION_FAN_OUT`
      - **Skill Maintenance:** `EVENT_ADMIN_SKILL_CREATED`, `EVENT_ADMIN_SKILL_VERSION_CREATED`, `EVENT_ADMIN_SKILL_UPDATED`, `EVENT_ADMIN_SKILL_DERIVED`, `EVENT_ADMIN_SKILL_DRAFT_CONTENT_UPDATED`, `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED`, `EVENT_ADMIN_SKILL_EXPORTED`, `EVENT_ADMIN_SKILL_IMPORTED`, `EVENT_ADMIN_SKILL_PROMOTED`, `EVENT_ADMIN_DOCUMENT_INGESTED`
      - **Access Control:** `EVENT_ADMIN_GRANT_CREATED`, `EVENT_ADMIN_GRANT_REAFFIRMED`, `EVENT_ADMIN_GRANT_REVOKED`, `EVENT_ADMIN_USER_PROVISIONED`, `EVENT_ADMIN_USER_INVITE_RESENT`
      - **Compliance & Disclosure:** `EVENT_ADMIN_CERTIFICATION`, `EVENT_ADMIN_LIFECYCLE_TRANSITION`
      - **Organization, Authentication, Security:** no existing event types map here yet — these 3 categories exist in `ALL_CATEGORIES` today with **zero** members; they become populated by 13.2 (Access Control gets 3 more), 13.3 (Compliance & Disclosure gets 1 more), 13.4 (Authentication gets 4, Security gets ≥0), 13.6 (Organization gets 4, Compliance & Disclosure + Security get 1 each). **Do not skip creating a category just because it's empty today** — the FE (Task 3) must still render it (or hide empty categories — see Task 3's decision point).
    - A lookup function `category_for(event_type: str) -> str` raising `KeyError` (or returning a documented sentinel — pick one and be consistent) for an unmapped type, so callers get a loud failure rather than a silent `None`.
  - [ ] Do **not** touch `app/models/audit.py`'s existing constants or `OUTCOME_TO_EVENT_TYPE` — this is a purely additive new module importing from it.

- [ ] **Task 2 — The guard test: programmatic discovery, not a hand-copied list (AC2 — THE POINT OF THE STORY)**
  - [ ] Create `velara-api/tests/unit/test_audit_category_guard.py`, structured like [test_audit_coverage_guard.py](../../../velara-api/tests/unit/test_audit_coverage_guard.py) (12.5's guard) but discovering **event-type constants**, not routes.
  - [ ] Discovery mechanism: introspect `app.models.audit` module attributes for every name matching `EVENT_*` (or better: collect the actual string values referenced by `OUTCOME_TO_EVENT_TYPE.values()` plus every module-level `str` constant prefixed `EVENT_`) — this must be **live introspection of the module**, not a hardcoded list copied into the test file, or the guard cannot catch a constant nobody remembered to map (the exact failure mode 12.5's Dev Notes calls out for the FE icon map, deferred there — do not repeat it here).
  - [ ] `test_every_event_type_has_a_category()`: assert the discovered set of event-type values is a subset of `EVENT_TYPE_TO_CATEGORY`'s keys; failure message names the missing constant(s) and tells the author to add an entry to `app/models/audit_categories.py`.
  - [ ] `test_no_stale_category_entries()`: the inverse — a mapping entry whose value is no longer a live constant (renamed/removed) should fail, mirroring 12.5's `test_registry_has_no_stale_entries`.
  - [ ] `test_every_category_value_is_valid()`: every value in `EVENT_TYPE_TO_CATEGORY` is a member of `ALL_CATEGORIES` (catches a typo'd category string).
  - [ ] No DB, no Postgres — this is a pure module-introspection test, must run in every CI invocation (same rationale as 12.5's guard: the anti-regression invariant cannot live behind a `_postgres_reachable()` skip).
  - [ ] Prove the guard actually catches an unmapped constant (not just theater): temporarily add a fake `EVENT_*` constant with no mapping entry in a test-local scope (or monkeypatch) and assert the guard fails with an actionable message — mirror how 12.5's Dev Notes describe proving the route-guard "actually catches a new unregistered route."

- [ ] **Task 3 — `category` query param on `GET /api/v1/audit`, expanding server-side (AC3)**
  - [ ] In [audit.py (router)](../../../velara-api/app/api/v1/audit.py), add `category: Annotated[str | None, Query()] = None` to `list_audit_entries`. Validate against `audit_categories.ALL_CATEGORIES` (422 `VALIDATION_ERROR` on an unknown value — copy the existing `outcome` validation shape at [audit.py:106-115](../../../velara-api/app/api/v1/audit.py#L106)).
  - [ ] Expand `category` into the list of event types in that category (`[et for et, cat in EVENT_TYPE_TO_CATEGORY.items() if cat == category]`) and pass it to `audit_service.list_entries` as a new `event_types: list[str] | None` param (plural — distinct from the existing singular `event_type` param, which must keep working unchanged per AC3).
  - [ ] In `audit_service.list_entries` ([audit_service.py:170](../../../velara-api/app/services/audit_service.py#L170)), add the `event_types` param and, when provided, append `AuditLogEntry.event_type.in_(event_types)` to the `where` list (alongside, not replacing, the existing single-value `event_type ==` filter at [audit_service.py:234](../../../velara-api/app/services/audit_service.py#L234) — both can be supplied simultaneously per AC3's "continue to work unchanged and can combine").
  - [ ] Regenerate `docs/api-spec.json` (`python scripts/export_openapi.py`) — expect a **non-empty, additive-only** diff this time (new `category` query param on the one endpoint) — unlike 12.5, which expected zero diff. Verify the diff is exactly this one param addition, nothing else.

- [ ] **Task 4 — FE: replace the flat pill list with 7 category pills, outcome now orthogonal (AC4)**
  - [ ] Rewrite [eventKindMeta.ts](../../../velara-web/src/features/audit/eventKindMeta.ts): replace the `EventKind` union (`'all' | 'success' | 'failure' | 'blocked' | 'grants' | 'certifications' | 'lifecycle' | 'provisioning'`) with a `Category` type mirroring the backend's 7 values + `'all'`, and `EVENT_CATEGORY_OPTIONS` analogous to today's `EVENT_KIND_OPTIONS`. `categoryToParams(category)` returns `{ category?: string }` (no more `event_type`/`outcome` synthesis — the backend now does the expansion).
  - [ ] In [AuditLog.tsx](../../../velara-web/src/features/audit/components/AuditLog.tsx): add a **new**, separate outcome-filter control (a small pill group or select: All/Success/Failures/Blocked/Cancelled — reuse `OUTCOME_SUCCESS`/`OUTCOME_FAILURE`/`OUTCOME_CANCELLED`/`OUTCOME_BLOCKED` string values already known FE-side via `auditOutcomeMeta.ts`) alongside the category pills, both feeding `useAuditPage`'s `outcome`/`category` params independently (mirrors the existing `client_id`/`skill_id` filters already composing with `outcome`/`event_type` in the current `kindParams` block at [AuditLog.tsx:210-229](../../../velara-web/src/features/audit/components/AuditLog.tsx#L210)). Replace the single `eventKind` state with two: `category` and `outcome`.
  - [ ] Update `ListAuditParams` in [api/audit.ts](../../../velara-web/src/api/audit.ts) with a new optional `category?: string` field (additive, `event_type`/`outcome` stay).
  - [ ] The active-filter chip row ([AuditLog.tsx:447-461](../../../velara-web/src/features/audit/components/AuditLog.tsx#L447)) needs a chip for the new outcome filter (today `eventKind` drove one combined chip) — split into a category chip + an outcome chip, each independently clearable.
  - [ ] **Decision point (empty categories):** Organization/Authentication/Security have zero live event types until 13.2/13.4/13.6 ship. Render all 7 pills regardless (a category with 0 current events still needs to exist in the UI once its first event type lands, and hiding-then-showing pills as sibling stories land is worse UX than a pill that returns "no events yet"). State this decision in code as a comment; do not hide empty-category pills.

- [ ] **Task 5 — Backend behavior tests for the new `category` param (AC3)**
  - [ ] `velara-api/tests/unit/services/test_audit_service.py`: assert `category="skill_maintenance"` expands to the exact 10 event types listed in Task 1, and combining `category` + `event_type` narrows correctly (both filters apply, not either/or).
  - [ ] `velara-api/tests/integration/services/test_audit_service.py` — this is where the real `list_entries` integration coverage lives today (e.g. `test_list_entries_scope_paths_filters_descendant_or_self`, `test_list_entries_org_fences_unrestricted_caller` at lines 742-820). Add category-expansion cases alongside them, driven against the real router where existing tests do the same. An unknown `?category=bogus` on `GET /api/v1/audit` returns 422 — assert this at the router/API layer (there is no separate `tests/integration/api/test_audit.py`; router-level assertions belong beside the router code or in this same service-integration file per the existing convention — check both before creating a new file).

- [ ] **Task 6 — Gates**
  - [ ] **Backend:** `ruff check .` clean; unit suite green (including the two new guard-test files); integration suite green (`AUTH_BACKEND=dev` override per the standing local-artifact note).
  - [ ] **`docs/api-spec.json`:** regenerate; diff must be **exactly** the new `category` query param on `GET /api/v1/audit` — nothing else.
  - [ ] **No migration.** Confirm `alembic` head unchanged (AC7).
  - [ ] **Frontend:** `npm run typecheck` → 0; `npm run lint` → no new warnings; `npx vitest run` → all green, including updated `eventKindMeta`-adjacent tests (rename test file if the module is renamed) and the split category/outcome filter chips.

## Dev Notes

### This is a mechanism story — mirror 12.5's guard-test shape exactly, but for constants, not routes

12.5's `test_audit_coverage_guard.py` proved the pattern: **programmatic discovery of the live surface, cross-checked against a hand-maintained decision registry, with the discovery step itself being what makes the guard real** (a registry of only known-good entries is theater — see 12.5's own retrospective language: "a coverage invariant with no test to enforce it"). This story applies the identical shape one level up: instead of discovering routes via `app.main.app.routes`, discover event-type constants via introspecting `app.models.audit`. The category mapping (`EVENT_TYPE_TO_CATEGORY`) plays the role 12.5's `REGISTRY` played — the reviewed decision record.

**Do not hand-copy the list of `EVENT_*` names into the test file.** That is precisely the mistake 12.5's own review flagged as a *deferred* weakness in the FE icon-completeness test (`eventTypeIconMeta.test.ts`'s `ALL_EVENT_TYPES` is a hand-maintained duplicate that silently drifts). This story's whole reason for existing is to not repeat that pattern on the backend. [Source: 12.5 Review Findings, "FE completeness guard is a hand-copied list and cannot catch the drift it exists to prevent" — deferred, and this story is partly the backend-side fix for the same class of gap.]

### Backend `event_type` values are still the wire format — categories are a derived, server-side-only concept

`AuditRead`/`AuditEntry` (FE) do **not** need a new `category` field on the response — the taxonomy is a *query-time* filter concept (AC3), not a stored or returned attribute. Don't add `category` to `AuditLogEntry`, `AuditRead`, or the FE `AuditEntry` interface. This keeps the change additive and migration-free (AC7) — categorization lives entirely in `audit_categories.py` (backend) and `eventKindMeta`'s successor (FE), both of which map `event_type` → category on the fly.

### `hierarchy_path="org"` / `org_id` tenant-fence conventions are untouched

This story does not touch `list_entries`'s org-fencing logic (`org_id` column, not `hierarchy_path`) — see the docstring at [audit_service.py:192-200](../../../velara-api/app/services/audit_service.py#L192) and 12.5's Trap 2 for why that fence must never be reintroduced via `hierarchy_path`. The new `event_types` filter is purely additive to the existing `where` list; do not restructure the query.

### Downstream stories' obligation (AC6) — what THIS story does vs. what 13.2-13.6 must each do

This story populates the mapping with **only the 22 event types that exist today**. It deliberately does **not** pre-populate entries for `admin.user_deprovisioned` (13.2), `access.artifact_disclosed` (13.3), `auth.login_succeeded` (13.4), etc. — those constants don't exist yet, so mapping them now would be dead code with no guard coverage. Each of 13.2/13.3/13.4/13.6 already carries its own AC (added by the 2026-07-14 correct-course) requiring it to add its new constant(s) to `EVENT_TYPE_TO_CATEGORY` as part of landing — AC2's guard test is what makes skipping that step a build failure instead of a silent gap. When implementing those stories, the category taxonomy table in [epic-13-compliance-audit-and-access-controls.md](../../../_bmad-output/planning-artifacts/epics/epic-13-compliance-audit-and-access-controls.md#Story-13.1) (lines 48-58) is the authoritative assignment for every event type each story introduces — copy those exact category assignments, don't re-derive them.

### FE module rename consideration

`eventKindMeta.ts` is being repurposed from "outcome+event_type pill mapping" to "category pill mapping" — consider renaming the file to `eventCategoryMeta.ts` for clarity (the story's own AC4 language calls the new thing "categories," not "kinds"). If you rename, update both the import in `AuditLog.tsx` and the test file name; this is a judgment call, not a hard requirement — either name is acceptable as long as it's consistent and the old `EventKind`/`eventKindToParams` names don't survive misleadingly attached to the new category concept.

### Testing standards

- **BE:** pytest. New guard test at `tests/unit/test_audit_category_guard.py` (top-level, DB-free, mirrors `test_audit_coverage_guard.py`'s placement rationale — this guards the whole event-type surface, not one service). `list_entries` unit coverage in the existing service test file; integration coverage in the existing audit API integration test file.
- **FE:** vitest + Testing Library, colocated with the renamed/updated `eventKindMeta`/`eventCategoryMeta` module.
- **Known local artifact:** API container defaults `AUTH_BACKEND=cognito` (401s dev tokens) — run integration tests with `AUTH_BACKEND=dev` override, per every prior Epic 9/12 story's note.

### Project Structure Notes

Additive changes only — no new endpoint, no new DB table/column, no new migration:

- `velara-api/app/models/audit_categories.py` — **NEW** (the taxonomy + guard-discoverable mapping).
- `velara-api/app/api/v1/audit.py` — MODIFIED (+`category` query param, validation, expansion).
- `velara-api/app/services/audit_service.py` — MODIFIED (`list_entries` gains `event_types: list[str] | None`).
- `velara-api/tests/unit/test_audit_category_guard.py` — **NEW** (AC2's guard test).
- `velara-api/tests/unit/services/test_audit_service.py` — MODIFIED (category-expansion unit coverage).
- `velara-api/tests/integration/services/test_audit_service.py` — MODIFIED (category-expansion integration coverage, alongside the existing `test_list_entries_*` cases at lines 742-820).
- `velara-web/src/features/audit/eventKindMeta.ts` (or renamed `eventCategoryMeta.ts`) — REWRITTEN.
- `velara-web/src/features/audit/components/AuditLog.tsx` — MODIFIED (category pills + new separate outcome control + split filter chips).
- `velara-web/src/api/audit.ts` — MODIFIED (+`category` param).
- `docs/api-spec.json` — regenerated, additive diff only.

No changes to: `app/models/audit.py` (existing constants untouched), `AuditRead`/`AuditEntry` schemas (no new response field), `eventTypeIconMeta.ts` (AC5, per-row icons out of scope), any migration.

### References

- [Source: epics/epic-13-compliance-audit-and-access-controls.md#Story-13.1] — full ACs, the category taxonomy table (authoritative for this story AND for 13.2-13.6's future additions), the "no migration" clarification.
- [Source: planning-artifacts/sprint-change-proposal-2026-07-14.md] — the correct-course that inserted this story as Epic 13's new first story; the exact same taxonomy table (cross-verify if the epic file is ever edited again).
- [Source: velara-api/tests/unit/test_audit_coverage_guard.py] — 12.5's guard-test pattern this story's AC2 mirrors: programmatic live-surface discovery + hand-maintained decision registry + integrity self-check. Read this file in full before writing Task 2's test — it is the exact shape to replicate one level up (constants, not routes).
- [Source: implementation-artifacts/stories/12-5-audit-coverage-skill-authoring-ingest.md] — Dev Notes' "the registry is the deliverable" framing; Review Findings' deferred FE hand-copied-list weakness (the anti-pattern this story's AC2 must not repeat on the backend).
- [Source: velara-api/app/models/audit.py] — all 22 current `EVENT_*` constants (lines 38-84) this story's mapping must cover completely; the append-only/stable-string house convention to follow for the new category constants.
- [Source: velara-api/app/api/v1/audit.py] — `list_audit_entries` route; existing `outcome` validation shape (lines 106-115) to copy for `category` validation; `_OUTCOME_ALIASES` pattern (not needed here, but shows the house style for query-param normalization).
- [Source: velara-api/app/services/audit_service.py:170-257] — `list_entries`, the `where` list construction to extend; docstring's explicit "do NOT reintroduce a hierarchy_path-based org fence" (Trap 2 from 12.5 — still applies, untouched by this story).
- [Source: velara-api/tests/integration/services/test_audit_service.py:742-820] — the real location of `list_entries` integration coverage (org-fence, scope-paths tests) — there is no separate `tests/integration/api/test_audit.py`; add category tests beside these.
- [Source: velara-web/src/features/audit/eventKindMeta.ts, components/AuditLog.tsx, api/audit.ts] — the current flat pill implementation being replaced; `AuditLog.tsx:210-229` (`kindParams` composition with `useAuditPage`) and `:447-461` (active-filter chips) are the exact lines Task 4 touches.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log
