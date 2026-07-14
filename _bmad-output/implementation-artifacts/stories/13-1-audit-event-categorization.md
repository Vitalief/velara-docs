---
baseline_commit: 8b91b230c0f81f50c82a80a0c0f243ad5ab67e5e
---

# Story 13.1: Audit Event Categorization

Status: done

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

- [x] **Task 1 — Build the category taxonomy as a static, code-owned mapping (AC1)**
  - [x] Add a new module `velara-api/app/models/audit_categories.py` (co-located with `app/models/audit.py`, which already holds every `EVENT_*` constant this maps). Define:
    - `CATEGORY_SKILL_EXECUTION = "skill_execution"`, `CATEGORY_SKILL_MAINTENANCE = "skill_maintenance"`, `CATEGORY_ORGANIZATION = "organization"`, `CATEGORY_ACCESS_CONTROL = "access_control"`, `CATEGORY_AUTHENTICATION = "authentication"`, `CATEGORY_COMPLIANCE_DISCLOSURE = "compliance_disclosure"`, `CATEGORY_SECURITY = "security"` (stable string values — never rename after deploy, matching every existing constant's house convention in `audit.py`).
    - `ALL_CATEGORIES = frozenset({...})` — analogous to `VALID_OUTCOMES` in `audit_service.py:38`.
    - `EVENT_TYPE_TO_CATEGORY: dict[str, str]` — the single source of truth. Populate it with **today's 22 event types only** (do not invent future stories' constants):
      - **Skill Execution:** `EVENT_INVOCATION_SUCCESS`, `EVENT_INVOCATION_FAILURE`, `EVENT_INVOCATION_CANCELLED`, `EVENT_INVOCATION_BLOCKED`, `EVENT_INVOCATION_FAN_OUT`
      - **Skill Maintenance:** `EVENT_ADMIN_SKILL_CREATED`, `EVENT_ADMIN_SKILL_VERSION_CREATED`, `EVENT_ADMIN_SKILL_UPDATED`, `EVENT_ADMIN_SKILL_DERIVED`, `EVENT_ADMIN_SKILL_DRAFT_CONTENT_UPDATED`, `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED`, `EVENT_ADMIN_SKILL_EXPORTED`, `EVENT_ADMIN_SKILL_IMPORTED`, `EVENT_ADMIN_SKILL_PROMOTED`, `EVENT_ADMIN_DOCUMENT_INGESTED`
      - **Access Control:** `EVENT_ADMIN_GRANT_CREATED`, `EVENT_ADMIN_GRANT_REAFFIRMED`, `EVENT_ADMIN_GRANT_REVOKED`, `EVENT_ADMIN_USER_PROVISIONED`, `EVENT_ADMIN_USER_INVITE_RESENT`
      - **Compliance & Disclosure:** `EVENT_ADMIN_CERTIFICATION`, `EVENT_ADMIN_LIFECYCLE_TRANSITION`
      - **Organization, Authentication, Security:** no existing event types map here yet — these 3 categories exist in `ALL_CATEGORIES` today with **zero** members; they become populated by 13.2 (Access Control gets 3 more), 13.3 (Compliance & Disclosure gets 1 more), 13.4 (Authentication gets 4, Security gets ≥0), 13.6 (Organization gets 4, Compliance & Disclosure + Security get 1 each). **Do not skip creating a category just because it's empty today** — the FE (Task 3) must still render it (or hide empty categories — see Task 3's decision point).
    - A lookup function `category_for(event_type: str) -> str` raising `KeyError` (or returning a documented sentinel — pick one and be consistent) for an unmapped type, so callers get a loud failure rather than a silent `None`.
  - [x] Do **not** touch `app/models/audit.py`'s existing constants or `OUTCOME_TO_EVENT_TYPE` — this is a purely additive new module importing from it.

- [x] **Task 2 — The guard test: programmatic discovery, not a hand-copied list (AC2 — THE POINT OF THE STORY)**
  - [x] Create `velara-api/tests/unit/test_audit_category_guard.py`, structured like [test_audit_coverage_guard.py](../../../velara-api/tests/unit/test_audit_coverage_guard.py) (12.5's guard) but discovering **event-type constants**, not routes.
  - [x] Discovery mechanism: introspect `app.models.audit` module attributes for every name matching `EVENT_*` (or better: collect the actual string values referenced by `OUTCOME_TO_EVENT_TYPE.values()` plus every module-level `str` constant prefixed `EVENT_`) — this must be **live introspection of the module**, not a hardcoded list copied into the test file, or the guard cannot catch a constant nobody remembered to map (the exact failure mode 12.5's Dev Notes calls out for the FE icon map, deferred there — do not repeat it here).
  - [x] `test_every_event_type_has_a_category()`: assert the discovered set of event-type values is a subset of `EVENT_TYPE_TO_CATEGORY`'s keys; failure message names the missing constant(s) and tells the author to add an entry to `app/models/audit_categories.py`.
  - [x] `test_no_stale_category_entries()`: the inverse — a mapping entry whose value is no longer a live constant (renamed/removed) should fail, mirroring 12.5's `test_registry_has_no_stale_entries`.
  - [x] `test_every_category_value_is_valid()`: every value in `EVENT_TYPE_TO_CATEGORY` is a member of `ALL_CATEGORIES` (catches a typo'd category string).
  - [x] No DB, no Postgres — this is a pure module-introspection test, must run in every CI invocation (same rationale as 12.5's guard: the anti-regression invariant cannot live behind a `_postgres_reachable()` skip).
  - [x] Prove the guard actually catches an unmapped constant (not just theater): temporarily add a fake `EVENT_*` constant with no mapping entry in a test-local scope (or monkeypatch) and assert the guard fails with an actionable message — mirror how 12.5's Dev Notes describe proving the route-guard "actually catches a new unregistered route."

- [x] **Task 3 — `category` query param on `GET /api/v1/audit`, expanding server-side (AC3)**
  - [x] In [audit.py (router)](../../../velara-api/app/api/v1/audit.py), add `category: Annotated[str | None, Query()] = None` to `list_audit_entries`. Validate against `audit_categories.ALL_CATEGORIES` (422 `VALIDATION_ERROR` on an unknown value — copy the existing `outcome` validation shape at [audit.py:106-115](../../../velara-api/app/api/v1/audit.py#L106)).
  - [x] Expand `category` into the list of event types in that category (`[et for et, cat in EVENT_TYPE_TO_CATEGORY.items() if cat == category]`) and pass it to `audit_service.list_entries` as a new `event_types: list[str] | None` param (plural — distinct from the existing singular `event_type` param, which must keep working unchanged per AC3).
  - [x] In `audit_service.list_entries` ([audit_service.py:170](../../../velara-api/app/services/audit_service.py#L170)), add the `event_types` param and, when provided, append `AuditLogEntry.event_type.in_(event_types)` to the `where` list (alongside, not replacing, the existing single-value `event_type ==` filter at [audit_service.py:234](../../../velara-api/app/services/audit_service.py#L234) — both can be supplied simultaneously per AC3's "continue to work unchanged and can combine").
  - [x] Regenerate `docs/api-spec.json` (`python scripts/export_openapi.py`) — expect a **non-empty, additive-only** diff this time (new `category` query param on the one endpoint) — unlike 12.5, which expected zero diff. Verify the diff is exactly this one param addition, nothing else.

- [x] **Task 4 — FE: replace the flat pill list with 7 category pills, outcome now orthogonal (AC4)**
  - [x] Rewrite [eventKindMeta.ts](../../../velara-web/src/features/audit/eventKindMeta.ts): replace the `EventKind` union (`'all' | 'success' | 'failure' | 'blocked' | 'grants' | 'certifications' | 'lifecycle' | 'provisioning'`) with a `Category` type mirroring the backend's 7 values + `'all'`, and `EVENT_CATEGORY_OPTIONS` analogous to today's `EVENT_KIND_OPTIONS`. `categoryToParams(category)` returns `{ category?: string }` (no more `event_type`/`outcome` synthesis — the backend now does the expansion).
  - [x] In [AuditLog.tsx](../../../velara-web/src/features/audit/components/AuditLog.tsx): add a **new**, separate outcome-filter control (a small pill group or select: All/Success/Failures/Blocked/Cancelled — reuse `OUTCOME_SUCCESS`/`OUTCOME_FAILURE`/`OUTCOME_CANCELLED`/`OUTCOME_BLOCKED` string values already known FE-side via `auditOutcomeMeta.ts`) alongside the category pills, both feeding `useAuditPage`'s `outcome`/`category` params independently (mirrors the existing `client_id`/`skill_id` filters already composing with `outcome`/`event_type` in the current `kindParams` block at [AuditLog.tsx:210-229](../../../velara-web/src/features/audit/components/AuditLog.tsx#L210)). Replace the single `eventKind` state with two: `category` and `outcome`.
  - [x] Update `ListAuditParams` in [api/audit.ts](../../../velara-web/src/api/audit.ts) with a new optional `category?: string` field (additive, `event_type`/`outcome` stay).
  - [x] The active-filter chip row ([AuditLog.tsx:447-461](../../../velara-web/src/features/audit/components/AuditLog.tsx#L447)) needs a chip for the new outcome filter (today `eventKind` drove one combined chip) — split into a category chip + an outcome chip, each independently clearable.
  - [x] **Decision point (empty categories):** Organization/Authentication/Security have zero live event types until 13.2/13.4/13.6 ship. Render all 7 pills regardless (a category with 0 current events still needs to exist in the UI once its first event type lands, and hiding-then-showing pills as sibling stories land is worse UX than a pill that returns "no events yet"). State this decision in code as a comment; do not hide empty-category pills.

- [x] **Task 5 — Backend behavior tests for the new `category` param (AC3)**
  - [x] `velara-api/tests/unit/services/test_audit_service.py`: assert `category="skill_maintenance"` expands to the exact 10 event types listed in Task 1, and combining `category` + `event_type` narrows correctly (both filters apply, not either/or).
  - [x] `velara-api/tests/integration/services/test_audit_service.py` — this is where the real `list_entries` integration coverage lives today (e.g. `test_list_entries_scope_paths_filters_descendant_or_self`, `test_list_entries_org_fences_unrestricted_caller` at lines 742-820). Add category-expansion cases alongside them, driven against the real router where existing tests do the same. An unknown `?category=bogus` on `GET /api/v1/audit` returns 422 — assert this at the router/API layer (there is no separate `tests/integration/api/test_audit.py`; router-level assertions belong beside the router code or in this same service-integration file per the existing convention — check both before creating a new file).

- [x] **Task 6 — Gates**
  - [x] **Backend:** `ruff check .` clean; unit suite green (including the two new guard-test files); integration suite green (`AUTH_BACKEND=dev` override per the standing local-artifact note).
  - [x] **`docs/api-spec.json`:** regenerate; diff must be **exactly** the new `category` query param on `GET /api/v1/audit` — nothing else.
  - [x] **No migration.** Confirm `alembic` head unchanged (AC7).
  - [x] **Frontend:** `npm run typecheck` → 0; `npm run lint` → no new warnings; `npx vitest run` → all green, including updated `eventKindMeta`-adjacent tests (rename test file if the module is renamed) and the split category/outcome filter chips.

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

claude-sonnet-5 (Claude Code, bmad-dev-story workflow)

### Debug Log References

- `ruff check .` (velara-api container) — clean, no findings after auto-fixing one import-order issue in `tests/unit/services/test_audit_service.py`.
- `pytest tests/unit/` (velara-api container) — 727 passed.
- `pytest tests/integration/ -e AUTH_BACKEND=dev` (velara-api container) — 631 passed, 3 skipped (pre-existing skips, unrelated to this story).
- `python -m scripts.export_openapi` — regenerated `docs/api-spec.json`; diff is exactly the new `category` query param on `GET /api/v1/audit`, nothing else.
- `alembic current` / `alembic heads` — both `0022_skill_version_bundle`, unchanged (AC7, no migration).
- `npm run typecheck` (velara-web) — 0 errors.
- `npm run lint` (velara-web) — 0 new warnings (1 pre-existing `Icon.tsx` fast-refresh warning, unrelated).
- `npx vitest run` (velara-web) — 681 passed, including 3 new `eventCategoryMeta.test.ts` tests and updated `AuditLog.test.tsx` cases.

### Completion Notes List

- Built `app/models/audit_categories.py`: 7 stable category constants, `ALL_CATEGORIES` frozenset, `EVENT_TYPE_TO_CATEGORY` mapping all 22 live event types (Organization/Authentication/Security intentionally empty today, populated by 13.2/13.4/13.6), and a `category_for()` lookup raising `KeyError` on an unmapped type.
- Built `tests/unit/test_audit_category_guard.py` mirroring 12.5's `test_audit_coverage_guard.py` shape: programmatic discovery of every `EVENT_*` string constant on `app.models.audit` via `dir()` introspection (not a hand-copied list), cross-checked against `EVENT_TYPE_TO_CATEGORY`. Includes a self-verifying test (`test_guard_actually_catches_an_unmapped_constant`) proving the discovery/diff mechanism is real, not theater — mirrors the story's explicit instruction to prove the guard catches an unmapped constant.
- `GET /api/v1/audit` gained a `category` query param (422 on an unknown value, same validation shape as `outcome`), expanded server-side into `event_types: list[str]` and passed to `audit_service.list_entries`, which gained an additive `event_types` filter (`event_type.in_(...)`) alongside the existing single-value `event_type ==` filter — both apply simultaneously per AC3.
- FE: replaced `eventKindMeta.ts` with `eventCategoryMeta.ts` (category pills mirroring the backend's 7 values + "all"; `categoryToParams` just forwards `{ category }` — no more client-side outcome/event_type synthesis). `AuditLog.tsx` now carries two independent filter states (`category`, `outcome`) instead of one combined `eventKind`; outcome is a new `<select>` control reusing `AUDIT_OUTCOME_META` labels; the active-filter chip row splits into an independently-clearable category chip and outcome chip. Per AC4's decision point, all 7 category pills render regardless of whether they have live members yet (documented in the module's header comment).
- `eventTypeIconMeta.ts` and per-row icon rendering were not touched (AC5).
- Verified no migration was created and `alembic current` == `alembic heads` (AC7).
- Regenerated `docs/api-spec.json`; the diff is additive-only (the new `category` query param), matching the story's expectation.

### File List

- `velara-api/app/models/audit_categories.py` — NEW
- `velara-api/app/api/v1/audit.py` — MODIFIED (`category` query param + validation + expansion)
- `velara-api/app/services/audit_service.py` — MODIFIED (`list_entries` gains `event_types` param)
- `velara-api/tests/unit/test_audit_category_guard.py` — NEW
- `velara-api/tests/unit/services/test_audit_service.py` — MODIFIED (category-expansion unit coverage)
- `velara-api/tests/integration/services/test_audit_service.py` — MODIFIED (category-expansion integration coverage)
- `velara-api/docs/api-spec.json` — MODIFIED (regenerated, additive-only diff)
- `velara-web/src/features/audit/eventKindMeta.ts` — DELETED (replaced by `eventCategoryMeta.ts`)
- `velara-web/src/features/audit/eventCategoryMeta.ts` — NEW
- `velara-web/src/features/audit/eventCategoryMeta.test.ts` — NEW
- `velara-web/src/features/audit/components/AuditLog.tsx` — MODIFIED (category pills + separate outcome control + split filter chips)
- `velara-web/src/features/audit/components/AuditLog.test.tsx` — MODIFIED (updated for split category/outcome filters)
- `velara-web/src/api/audit.ts` — MODIFIED (`ListAuditParams` gains `category?: string`)

## Review Findings

Three-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor), 2026-07-14. AC1/AC2/AC5/AC6/AC7 verified clean: all 22 live `EVENT_*` constants discovered and mapped, every category assignment matches the epic's authoritative taxonomy table, `eventTypeIconMeta.ts` untouched, alembic head unchanged (`0022_skill_version_bundle`). 11 findings actioned; 9 patched.

### ⭐ HEADLINE — the orthogonal outcome filter was a dead end for 4 of the 7 categories

`record_admin_action` writes `outcome=None` ([audit_service.py:304](../../../velara-api/app/services/audit_service.py#L304)); the column is explicitly *"NULL for admin events"* ([audit.py:167](../../../velara-api/app/models/audit.py#L167)). `list_entries` filters with `AuditLogEntry.outcome == outcome`, and **`NULL = 'success'` is never true in SQL**. Only **Skill Execution** carries a non-NULL outcome — Skill Maintenance (10 types), Access Control (5), and Compliance & Disclosure (2) are all admin events.

So **"Access Control" + "Success"** — precisely the combination AC4 was written to enable — returned **zero rows, always**, with two healthy-looking filter chips and the message "No events in this range." On a compliance surface, an unsatisfiable query that renders as a clean audit trail is the exact hazard the codebase already 422s inverted date windows to prevent ([audit.py:137-142](../../../velara-api/app/api/v1/audit.py#L137)).

**This was introduced by this story.** The old `EventKind` was a single mutually-exclusive union (`'success'` XOR `'grants'`), so the broken combination was structurally *unrepresentable*. AC4's orthogonality refactor made it representable and meaningless. **Both existing tests picked the one working cell** (`skill_execution`) — BE `test_audit_route_category_and_outcome_combine_with_and_semantics` and FE `'category and outcome combine'` — so the matrix's 6 broken cells were never probed.

**Fix (Project Lead decision):** make the impossible combination unrepresentable again. New `OUTCOME_BEARING_CATEGORIES` in `audit_categories.py`, mirrored FE-side as `categoryHasOutcomes()`; the outcome `<select>` is disabled (with an explanatory `title`) and a stale outcome is reset to `'all'` whenever a non-outcome-bearing category is selected. Pinned by a new BE integration test asserting every admin-category × outcome pair returns 0 while `skill_execution` + `success` returns 1 — it flips red (with an actionable message) if a future story ever gives admin events a real outcome.

**LESSON:** when a refactor makes two filters *orthogonal*, the new cells of the product matrix are new code paths. Test the cells the old design made unreachable — that's where the regression hides. A test that exercises only the one cell that works certifies the feature as green.

### Other patches (8)

- **Contradictory `category` + `event_type` now 422s** (Project Lead decision). Categories are disjoint, so the pair is either redundant or provably empty; it silently 200'd with an empty page, and an integration test *codified* that. Now rejected, matching the inverted-date-window precedent.
- **The "proves the guard isn't theater" test WAS theater.** `test_guard_actually_catches_an_unmapped_constant` re-implemented the set-difference inline and asserted Python's `-` operator works. It never called `_live_event_types()` against a mutated module and would have passed identically if discovery were broken to return an empty set — the precise failure it existed to rule out. Rewritten to `monkeypatch` a real `EVENT_*` constant onto `app.models.audit` and assert the **real** guard raises and names it.
- **Guard was blind to duplicate constant *values*.** Discovery collected values into a `set`, so two constants sharing a literal (a plausible copy-paste when 13.2 adds three siblings at once) would collapse — the new one inheriting the old one's category with no mapping of its own. Discovery is now name-keyed, plus `test_no_duplicate_event_type_values`.
- **Expansion logic was duplicated in the router and re-implemented a third time in its own unit test** (testing a copy, not the code). Extracted to `audit_categories.event_types_for()` (precomputed reverse index); router and test both call it.
- **The 3 unpopulated pills (Organization/Authentication/Security) looked identical to working ones.** An auditor clicking **Security**, seeing "No events in this range", records "no security events" — when the truth is "not built yet". Now dashed/dimmed with a `title`, and the empty state names the real cause.
- **`category` was bare `str` in the OpenAPI spec** — no enum, so consumers got no contract. Now publishes all 7 values via `json_schema_extra` while keeping the house 422 envelope.
- **Empty-category expansion short-circuits** in `list_entries` (`return [], 0`) rather than relying on SQLAlchemy's implicit `IN () → 1 != 1`; documents intent and skips two pointless round-trips.
- **Page-stranding fix:** the out-of-range page recovery was guarded by `total > 0`, but the pagination block *also* renders only when `total > 0` — a filter dropping total to exactly 0 on page 2 left no Prev button and no way back. Guard dropped.

### ⚠️ TRAP for future stories — `export_openapi.py` writes INSIDE the container

`scripts/export_openapi.py` resolves its output as `Path(__file__).parent.parent / "docs"` → **`/app/docs/api-spec.json` inside the container**, which is baked into the image, *not* bind-mounted. Running `docker compose exec api python -m scripts.export_openapi` regenerates the spec **in the container and never touches the host file** — it prints a reassuring "Wrote OpenAPI spec to /app/docs/api-spec.json" either way. The host spec here was stale-but-accidentally-correct (the pre-enum output happened to match). CI re-runs this script and `git diff --exit-code`s it, so this silently ships a stale spec. **Always `docker cp "$(docker compose ps -q api):/app/docs/api-spec.json" docs/api-spec.json` after regenerating**, or run the script on the host.

### Deferred (1)

- **FE `Category` union is a hand-copied duplicate of the BE's `ALL_CATEGORIES`** with no cross-repo guard — the same drift class this story exists to eliminate on the backend. Mitigated for now: the spec's new `enum` makes it generatable. Worth a follow-up that asserts the FE union against `docs/api-spec.json`.

### Dismissed (4)

Untracked new files "won't import" (expected pre-commit state — they *are* the deliverable); filter state not URL-persisted (pre-existing, never was); `category_for()` unused (deliberate API surface, now joined by `event_types_for()` which *is* wired); loss of per-`event_type` UI narrowing (intended coarsening per AC4).

### Post-review gates

BE: `ruff` clean · unit **728** passed · integration **632** passed, 3 skipped (pre-existing) · alembic head unchanged · api-spec in sync with the live app (verified against the CI diff gate).
FE: `tsc --noEmit` 0 errors · lint 0 errors (1 pre-existing `Icon.tsx` warning) · vitest **688** passed.

## Change Log

- 2026-07-14: Code review complete. Fixed the headline outcome-filter dead end (admin categories carry `outcome=NULL`, making every admin-category × outcome combination unsatisfiable — introduced by AC4's orthogonality refactor and missed because both tests probed only the one working cell); contradictory `category`+`event_type` now 422s; replaced the guard's self-proof theater with a real monkeypatched exercise; closed the duplicate-constant-value blind spot; de-duplicated the expansion logic into `event_types_for()`; marked the 3 unpopulated categories in the UI; published the `category` enum in the OpenAPI spec; fixed page-stranding on a zero-result filter. Status → done.
- 2026-07-14: Story implemented end-to-end (Tasks 1-6). Backend: additive `audit_categories.py` taxonomy module + programmatic guard test (AC1/AC2) mirroring 12.5's route-guard pattern; `category` query param on `GET /api/v1/audit` expanding server-side into the service's `event_types` filter, combining with `event_type`/`outcome` (AC3); no migration (AC7). Frontend: `eventKindMeta.ts` replaced by `eventCategoryMeta.ts`; `AuditLog.tsx` now has independent category and outcome filters, each with its own dismissible chip (AC4); `eventTypeIconMeta.ts` untouched (AC5). All gates green: BE ruff/unit(727)/integration(631)/api-spec regen/alembic-unchanged; FE typecheck/lint/vitest(681).
