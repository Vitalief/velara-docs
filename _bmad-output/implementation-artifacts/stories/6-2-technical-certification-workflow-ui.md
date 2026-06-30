---
baseline_commit: NO_VCS
---

# Story 6.2: Technical Certification Workflow UI

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer,
I want a UI surface to review a skill and record the technical certification key,
So that I can formally approve the technical quality of a skill and advance it toward client readiness — capturing a 21 CFR Part 11 electronic signature.

## Acceptance Criteria

**AC1 — Unified governance list (no separate tabs):**
**Given** I navigate to the Certification tab (`/internal/certification`)
**When** the page loads
**Then** I see ONE unified list of skills pending certification — both *awaiting technical review* and *awaiting methodological review* shown in a single governance view (NO separate tabs); each row shows the skill name, current version, and its two-key state (technical badge + methodological badge)
[Source: epic-6-certification-governance.md:47-49]

**AC2 — Detail panel:**
**Given** I click a skill pending technical certification
**When** the detail panel opens
**Then** I see: skill name, version, description, runtime type, input/output schema, and a "Record Technical Certification" button
[Source: epic-6-certification-governance.md:51-53]

**AC3 — Modal with checklist + notes:**
**Given** I click "Record Technical Certification"
**When** the modal opens
**Then** it has an optional notes field and a checklist confirming: executes without error, handles adversarial inputs, code reviewed, description correctly invokes from Claude, outputs match schema — and the submit button is gated until all checklist items are confirmed
[Source: epic-6-certification-governance.md:55-57; FR-CRT-02 requirements-inventory.md:74]

**AC4 — Submit records the technical key + moves the skill:**
**Given** I submit the technical certification
**When** the API call completes
**Then** `POST /api/v1/certifications` records the technical key, the skill's technical-certification badge updates, and the skill appears in the "Awaiting Methodological Certification" grouping/state of the unified list
[Source: epic-6-certification-governance.md:59-61]

**AC5 — Already-certified state:**
**Given** a skill has already been technically certified
**When** I view it
**Then** the technical-certification badge shows the certifier identity and timestamp — the "Record Technical Certification" button is disabled
[Source: epic-6-certification-governance.md:63-65]

**AC6 — 21 CFR Part 11 e-signature manifestation (FR-SEC-10):**
**Given** the "Record Technical Certification" modal is open
**When** I read it
**Then** it displays my signer identity and an explicit signature statement ("I, {user_id} ({role}), certify the technical quality of this skill version"); on submit, the recorded manifestation — signer identity, UTC timestamp, and signature meaning (`technical_certification`) returned by the API — is shown on the certification record / badge
[Source: epic-6-certification-governance.md:67-69; FR-SEC-10 requirements-inventory.md:101; Decision D2]

## Tasks / Subtasks

> **SCOPE: FULL-STACK** (per Decision D1). A SMALL backend addition (one new read endpoint, no migration, no model change) + the frontend Certification screen. The methodological-cert UI is Story 6.3; certification *history* UI is Story 6.4 — do NOT build those. This story records the **technical** key and renders the unified pending list.
>
> ⚠️ **Most of the FE scaffolding already exists as stubs — FILL, don't recreate:** the Certification nav tab (`navTabsData.ts:11`), the route Placeholder (`internal.tsx:94-97`), `src/api/certifications.ts` (`export {}`), `src/features/certification/types.ts` (`export {}`), `src/features/certification/components/.gitkeep`. The `--color-key-tech*` / `--color-key-method*` design tokens already exist (`index.css:54-57`) — use them.

### BACKEND (velara-api)

- [x] **Task 1 — Bulk "pending certification" service function (AC: 1) — in EXISTING `app/services/certification_service.py`**
  - [x] Add `async def list_pending_certifications(*, session, org_id, page=1, per_page=50) -> tuple[list[dict], int]`:
    - Query skills in this org with `lifecycle_state == "internal_ready"` (the eligibility gate — a skill is certifiable from internal_ready; a fully-certified-but-not-yet-advanced skill is STILL internal_ready until the 2nd key advances it). Order by `Skill.updated_at.desc()` (or `created_at` — match the registry ordering convention).
    - For each skill, compute its current-version cert state by REUSING the existing `evaluate_certification_eligibility(session=session, skill=skill)` (`certification_service.py:220-243`) — do NOT duplicate the query logic. To avoid per-skill round-trips, you MAY instead do ONE grouped query over `certification_records` filtered to the page's `skill_version_id` set + org, then fold results in Python; either is acceptable — document which.
    - Return rows shaped as `{skill_id, skill_name, skill_version, runtime_type, description, current_version_id, technical_certified: bool, methodological_certified: bool}` + `total` count (for pagination). Keep it a pure read (no commit).
  - [x] **Org-scope every query** (`Skill.org_id == org_id`, `CertificationRecord.org_id == org_id`). [Source: certification_service.py:175-217 list pattern; eligibility 220-243]
  - [x] A skill with `current_version_id IS NULL` → both flags `False` (mirror eligibility's null guard at `:231-232`); still listed (it's internal_ready). Edge case to test.

- [x] **Task 2 — Pending-list response schema (AC: 1) — in EXISTING `app/schemas/certification.py`**
  - [x] Add `class PendingCertificationItem(BaseModel)`: `skill_id: uuid.UUID`, `skill_name: str`, `skill_version: str | None`, `runtime_type: str`, `description: str | None`, `current_version_id: uuid.UUID | None`, `technical_certified: bool`, `methodological_certified: bool`. `model_config = {"from_attributes": True}` is NOT needed (it's a dict, not an ORM row) — plain BaseModel.
  - [x] Add `class PendingCertificationListData(BaseModel)`: `items: list[PendingCertificationItem]`, `page: PageMeta` (mirror `CertificationListData` at `:65-69`).

- [x] **Task 3 — Pending-list endpoint (AC: 1) — in EXISTING `app/api/v1/certifications.py`**
  - [x] Add `GET /api/v1/certifications/pending` → `ResponseEnvelope[PendingCertificationListData]`. Inject `user: CurrentUser`, `session: DbSession`, `request: Request`; `page`/`per_page` `Annotated[int, Query(...)]` with the SAME bounds as the existing list route (`page le=100_000`, `per_page le=200`, both `ge=1` — copy from `certifications.py:82-83`). Call `certification_service.list_pending_certifications`. Wrap in `ResponseEnvelope` with `_meta(request)`.
  - [x] **Route ordering:** declare `/pending` BEFORE any future `/{cert_id}` route so the literal segment matches first (there is no `/{id}` route today — but add a comment so a future dev doesn't shadow it). The existing `GET ""` (list by `?skill_id=`) and `POST ""` are unaffected.
  - [x] Do NOT add PUT/PATCH/DELETE (immutability — `certifications.py:101-102`). The `/pending` route is GET-only.

- [x] **Task 4 — Backend tests (AC: 1) — ADD to `tests/integration/api/test_certifications.py`**
  - [x] `test_pending_list_shows_internal_ready_skills`: seed 2 internal_ready skills (one with a technical cert, one with none) → GET `/certifications/pending` → both present; flags correct (one `technical_certified=True, methodological_certified=False`; other both `False`).
  - [x] `test_pending_list_excludes_draft_and_client_ready`: a `draft` skill and a `client_ready` skill are NOT in the pending list.
  - [x] `test_pending_list_org_scoped`: another org's internal_ready skill is not returned.
  - [x] `test_pending_list_pagination`: per_page/page bounds + total.
  - [x] Reuse the existing fixtures + helpers in `test_certifications.py` (created by 6.1): `client`, `apply_migrations`, `_internal_auth()`, the skill-creation + advance-to-internal_ready helpers, and the cert-recording helper. Gates: `ruff check .` clean; full Docker suite 0 regressions (baseline ~754 after 6.1's adds — confirm actual count).

### FRONTEND (velara-web) — FE-only from here; consumes the 6.1 + Task 3 contract

- [x] **Task 5 — API module (AC: 1, 4, 5, 6) — FILL the stub `src/api/certifications.ts`**
  - [x] Replace `export {}`. Define types mirroring the backend EXACTLY.
  - [x] `listPendingCertifications`, `listCertifications`, `recordCertification` implemented with correct `.data.data` unwrapping.

- [x] **Task 6 — Error map (AC: 4) — ADD to `src/shared/utils/errors.ts`**
  - [x] Added `CERTIFICATION_ERROR_MESSAGES` + `friendlyCertificationError` mapping all 4 backend error codes plus generic fallback.

- [x] **Task 7 — Types + React Query hooks (AC: 1, 4, 5)**
  - [x] FILLED `src/features/certification/types.ts` (re-exports from `@/api/certifications`).
  - [x] NEW `src/features/certification/hooks/useCertifications.ts` with `usePendingCertifications`, `useCertifications`, `useRecordCertification` (no optimistic updates — architecture rule honored).

- [x] **Task 8 — Two-key cert badge component (AC: 1, 5) — NEW `src/features/certification/components/CertKeyBadge.tsx`**
  - [x] Badge uses `--color-key-tech*` / `--color-key-method*` tokens, pending vs certified states, certifier/date tooltip. No deprecated Tailwind colors used.

- [x] **Task 9 — Certification screen: unified list + detail panel (AC: 1, 2, 5) — NEW `src/features/certification/components/CertificationScreen.tsx` (+ subcomponents)**
  - [x] Two-pane layout, unified list with both cert-flag buckets, detail panel with Card/MetaRow/SchemaBlock, "Record Technical Certification" button gated on `!technical_certified`, certifier/timestamp shown via CertKeyBadge when certified.

- [x] **Task 10 — Record Technical Certification modal (AC: 3, 4, 6) — NEW `src/features/certification/components/RecordTechnicalCertModal.tsx`**
  - [x] New modal with role="dialog" aria-modal, focus-trap, Escape-to-close (suppressed while pending), backdrop-click guard. AC6 e-signature statement ("I, {user_id} ({role}), certify…"), 5-item checklist gates submit, optional notes (maxLength=4096), double-submit `if (isPending) return` guard, error banner with danger tokens.

- [x] **Task 11 — Wire the route (AC: 1, 2) — EDIT `src/routes/internal.tsx`**
  - [x] Replaced Placeholder with `<CertificationScreen />`. Kept `certification/*` wildcard so `useActiveTab` keeps the tab highlighted. navTabsData.ts untouched.

- [x] **Task 12 — Frontend tests (AC: all) — NEW colocated `*.test.tsx` / `*.test.ts`**
  - [x] `src/api/certifications.test.ts`: 5 tests — URL/param/unwrap assertions for all 3 API functions.
  - [x] `src/features/certification/hooks/useCertifications.test.tsx`: 4 tests — usePendingCertifications, useCertifications (enabled guard), useRecordCertification invalidation of all 3 query keys.
  - [x] `src/features/certification/components/CertificationScreen.test.tsx`: 4 tests — unified list both buckets, empty state, detail panel enabled/disabled button.
  - [x] `src/features/certification/components/RecordTechnicalCertModal.test.tsx`: 5 tests — e-signature statement, checklist gates submit, mutate called with correct args, double-submit guard, cancel handler.
  - [x] Gates: 276 tests pass (up from 259 baseline, +17 new), 0 regressions, typecheck 0 errors, lint clean, build ✓.

## Dev Notes

### Architecture Context

This is the **first Epic 6 frontend story**. It consumes the Story 6.1 backend certification API (shipped: `POST`/`GET /api/v1/certifications`, two-key gate on the existing `PATCH /skills/{id}/lifecycle`). It adds ONE small backend read endpoint (`GET /certifications/pending`) for the unified governance list, plus the Certification screen. No migration, no model change, no new dependency.

### LOCKED DECISIONS (resolved with user 2026-06-27)

- **D1 — Pending-list data-flow = backend bulk endpoint.** Rather than N+1 per-row cert queries on the FE, add `GET /api/v1/certifications/pending` that returns each internal_ready skill with its `technical_certified`/`methodological_certified` flags computed server-side (reusing the existing `evaluate_certification_eligibility` mechanism). This makes 6.2 FULL-STACK (small BE + FE). It does NOT add cert flags to the Skill model/migration (that was explicitly rejected in 6.1 — cert state lives in `certification_records`).
- **D2 — Signer display = `user_id` + `role`.** The FE has no display name (`AuthUser` = `{user_id, org_id, role}`; no User table until Epic 7 Cognito). The e-signature statement shows "I, {user_id} ({role}), certify…" with a note that verified printed-name binding is an Epic 7 forward-dep. The backend sets `certifier_user_id` from the token regardless; the statement is display-only.

### Scope boundaries (what 6.2 does NOT do)

- **Methodological certification recording UI = Story 6.3** (and the auto-advance-to-client_ready on the 2nd key). 6.2 renders the methodological badge as read-only state in the unified list but does NOT provide a "Record Methodological Certification" action. [Source: epic-6-certification-governance.md:73-103]
- **Certification history UI + re-cert warnings = Story 6.4.** [Source: epic-6-certification-governance.md:107-129]
- **No RBAC enforcement** of who may sign (Epic 8 / FR-SEC-11). Any authenticated internal user can POST; `certifier_role` is captured for the trail. [Source: certifications.py:4-6]
- **No lifecycle-advance button here.** Advancing to client_ready stays the existing skill-registry lifecycle action; the 2nd-key auto-advance is 6.3.

### As-built backend contract (Story 6.1 — verified against source)

- `POST /api/v1/certifications` — body `{skill_id, certification_type: 'technical'|'methodological', notes?}` → **201** `ResponseEnvelope[CertificationRead]`. Server derives `signature_meaning`/`certifier_user_id`/`certifier_role`/`certified_at`. [certifications.py:43-70; schemas/certification.py:28-38]
- `GET /api/v1/certifications?skill_id=&page=&per_page=` → `ResponseEnvelope[{items: CertificationRead[], page: PageMeta}]`, oldest-first. [certifications.py:76-99]
- Error codes (422): `CERTIFICATION_ALREADY_RECORDED` (duplicate version+type — immutable), `NO_CERTIFIABLE_VERSION`, `SKILL_RETIRED`, `CERTIFICATION_INCOMPLETE`/`RECERTIFICATION_REQUIRED` (the lifecycle gate, not this story's POST). [certification_service.py:46-90]
- `CertificationRead`: `id, skill_id, skill_version_id, skill_version, certification_type, certifier_user_id, certifier_role, certified_at, signature_meaning, notes, org_id`. [schemas/certification.py:44-59]

### FILES — CREATE vs FILL vs EDIT

**Backend (velara-api):**
- EDIT `app/services/certification_service.py` — add `list_pending_certifications` (reuse `evaluate_certification_eligibility`).
- EDIT `app/schemas/certification.py` — add `PendingCertificationItem` + `PendingCertificationListData`.
- EDIT `app/api/v1/certifications.py` — add `GET /pending` (before any future `/{id}`).
- EDIT `tests/integration/api/test_certifications.py` — add pending-list tests.

**Frontend (velara-web):**
- FILL `src/api/certifications.ts` (currently `export {}`).
- FILL `src/features/certification/types.ts` (currently `export {}`).
- EDIT `src/shared/utils/errors.ts` — add `CERTIFICATION_ERROR_MESSAGES` + `friendlyCertificationError`.
- EDIT `src/routes/internal.tsx` — replace the `certification/*` Placeholder (`:94-97`) with the real screen.
- NEW `src/features/certification/hooks/useCertifications.ts`
- NEW `src/features/certification/components/CertificationScreen.tsx` (+ list/detail subcomponents)
- NEW `src/features/certification/components/CertKeyBadge.tsx`
- NEW `src/features/certification/components/RecordTechnicalCertModal.tsx`
- NEW colocated tests: `certifications.test.ts`, `useCertifications.test.tsx`, `CertificationScreen.test.tsx`, `RecordTechnicalCertModal.test.tsx`
- Do NOT touch `navTabsData.ts` (tab exists), `AppBar.tsx`, the skills feature, or the run feature.

### DEV TRAPS & REUSE MAP

**REUSE (don't rebuild):**
1. Certification **tab + route already exist** — fill the Placeholder; don't add a tab/route. [navTabsData.ts:11; internal.tsx:94-97]
2. **Stub files to FILL**: `api/certifications.ts`, `features/certification/types.ts`. [both `export {}`]
3. **Envelope unwrap** `.data.data` (+ `.items` for lists). [skills.ts:49-62]
4. **Mutation+invalidation** template. [useSkills.ts:62-72]
5. **Detail panel** `Card`/`MetaRow`/`SchemaBlock`. [SkillDetail.tsx:28-54,249-254]
6. **Modal a11y/focus-trap/escape/backdrop-pending** + **double-submit re-entry guard**. [ConfirmDialog.tsx:26-67; SkillDetail.tsx:108-133]
7. **Pre-existing tokens** `--color-key-tech*`/`--color-key-method*`. [index.css:54-57]
8. **Error-code map** convention. [errors.ts:56-80]
9. **Test fixtures**: `baseSkill` + `makeQC` + mock-axios. [SkillDetail.test.tsx:11-42; useSkills.test.tsx:38-40; skills.test.ts]
10. **Current user** `getCurrentUser()`. [auth.ts:37-44]

**TRAPS (break existing functionality / conventions):**
1. **No display name exists** — use `user_id`+`role`, NOT the hardcoded "M. Maxwell" in `AppBar.tsx:342`. [auth.ts:19-44]
2. **Deprecated Tailwind colors** (`green-*/amber-*/gray-*/red-*`) silently fall back — use `brand-*/st-*/danger/hold/key-*`. [jobStatusMeta.ts:1-2]
3. **No `tailwind.config.js`** — tokens are in `src/index.css @theme`. [index.css]
4. **Active-tab = URL segment[2]** — cert detail must stay under `/internal/certification/...`. [internal.tsx:31-36]
5. **lifecycle_state alone can't bucket** awaiting-technical vs awaiting-methodological — both are `internal_ready`; derive from cert flags. [research §5]
6. **Skill type has NO cert fields** — badge state comes from the pending endpoint / `listCertifications`, not from `Skill`. [skills/types.ts:24-45]
7. **Exact enum** `'technical'|'methodological'` in the POST body — NOT the prototype's "method"/"methodology". [schemas/certification.py:23]
8. **Cert list response is `{items, page}`** — unwrap then `.items`; not a bare array. [certifications.py:76-99]
9. **Double-submit lag** — explicit `if (pending) return` guard; a Part 11 e-signature must not be double-recorded. [SkillDetail.tsx:108-133]
10. **No optimistic updates for certification state** — architecture forbids it. [implementation-patterns-consistency-rules.md:104]

### IP-protection / compliance constraints

Certification is an **internal governance surface** (MA Tech / Matt Maxwell only). The certification screen + the `/pending` endpoint live under `/internal/*` and MUST NOT be exposed in the client portal (Epic 8). `notes` and `signature_meaning` can reflect methodology assessments — never surface them on any client-facing route. [Source: core-architectural-decisions.md:12,26; FR-ACL-03/04/05]

**21 CFR Part 11 (FR-SEC-10):** the modal manifests the e-signature (signer identity + UTC timestamp + meaning); the immutable binding to `skill_version_id` is enforced by the 6.1 backend. Phase-1 is manifestation only — no cryptographic signing / password re-auth (FR-SEC-12 deferred). [Source: requirements-inventory.md:101,103]

### Testing standards summary

- **Frontend:** vitest + @testing-library/react (jsdom). Colocated `*.test.tsx`/`*.test.ts`. Mock API modules with `vi.mock('@/api/...')`; wrap hooks in `<QueryClientProvider>` (`makeQC` with `retry:false`); render components in `<MemoryRouter><Routes>`. Run `npm test`. Baseline ~259 tests. [Source: vitest.config.ts; research §9]
- **Backend:** pytest, Docker integration against `velara_test` PG (`docker compose exec api pytest tests/integration/api/test_certifications.py`), auto-skip when infra down. Reuse 6.1's fixtures/helpers in `test_certifications.py`. [Source: 6.1 story; conftest.py]

### Project Structure Notes

- All FE files follow the `src/features/<feature>/{components,hooks,types.ts}` convention (the `certification` feature folder already exists). No structural variance.
- The BE additions extend the three existing 6.1 certification files + their test file — no new BE files, no migration.
- **Design prototype reference (layout cues ONLY):** `design/internal2.jsx:4-122` prototypes a two-pane certification view with criteria checklists + lock chips. It uses two sub-tabs (Validation Queue / Awaiting Keys) and deprecated `var(--green-*)` tokens — IGNORE those; the story mandates ONE unified list (no sub-tabs) and the `key-*`/`st-*` tokens.

### Latest Tech Information

Stack (verified `package.json`): React 19, react-router-dom 7, @tanstack/react-query 5, axios 1.7, zustand 5, Tailwind v4 (CSS-first `@theme` in `index.css`, NO `tailwind.config.js`), Vite 6, Vitest 2, @aws-amplify/auth 6. No new dependency required. Backend stack unchanged (FastAPI + Pydantic v2 + SQLAlchemy 2.x).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-6-certification-governance.md#Story-6.2 (ACs lines 39-69)]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md — FR-CRT-02 (74), FR-SEC-10 (101)]
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md — optimistic-update rule (104), loading states (102), enforcement rules (137-148)]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md — IP rule (12,26)]
- [Source: implementation-artifacts/stories/6-1-certification-data-model-and-state-machine-api.md — as-built backend contract + File List]
- [Source: velara-api/app/api/v1/certifications.py — POST/GET routes (43-99), 405 note (101-102)]
- [Source: velara-api/app/schemas/certification.py — CertificationCreate/Read/ListData (23-69)]
- [Source: velara-api/app/services/certification_service.py — list_certifications (175-217), evaluate_certification_eligibility (220-243), error codes (46-90)]
- [Source: velara-web/src/routes/internal.tsx — useActiveTab (31-36), certification Placeholder (94-97), route patterns (71-93)]
- [Source: velara-web/src/shared/components/navTabsData.ts — TABS incl. certification (11)]
- [Source: velara-web/src/api/skills.ts — envelope unwrap idioms (39-62); src/api/client.ts (12-15)]
- [Source: velara-web/src/features/skills/hooks/useSkills.ts — query keys + mutation/invalidation (16-72)]
- [Source: velara-web/src/features/skills/components/SkillDetail.tsx — Card/MetaRow/SchemaBlock (28-54,249-254), double-submit guard (108-133); SkillLifecycleBadge.tsx (5-65); ConfirmDialog.tsx (26-67)]
- [Source: velara-web/src/shared/utils/errors.ts — friendly error maps (14-24,56-80); auth.ts — getCurrentUser/AuthUser (19-44)]
- [Source: velara-web/src/index.css — key-tech/key-method tokens (54-57), brand/st tokens; jobStatusMeta.ts:1-2 deprecated-color warning]
- [Source: design/internal2.jsx (4-122) — layout cues only (sub-tabs + green-* tokens NOT followed)]

## Review Findings

> Code review 2026-06-27 (bmad-code-review, opus-4-8). 3-layer adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor) over the uncommitted diff across both sub-repos (velara-api @ c0e58bc + velara-web @ 70c037a). All 3 layers ran. **2 decision-needed, 7 patch, 1 defer, 7 dismissed.** All findings below were independently verified against source.

### Decision-needed (RESOLVED 2026-06-27)

- [x] [Review][Decision] Deep-link to a non-`internal_ready` skill lets a Part 11 cert be recorded — `CertificationDetail` never checks `lifecycle_state`, and the backend `record_certification` only blocks `retired` (certification_service.py:133). **RESOLVED → both FE + BE guard (defense in depth).** Promoted to two patches below (BE-G + FE-G). [HIGH — verified]
- [x] [Review][Decision] AC4 "grouping" is a per-row Status-column label, not a visual grouping/section. **RESOLVED → per-row Status label accepted as satisfying AC4's 'state'; DISMISSED, no code change** (cleanest fit with AC1 "ONE unified list, no separate tabs"). [LOW]

### Patch (APPLIED & verified 2026-06-27)

- [x] [Review][Patch] **CRITICAL — FIXED & PROVEN** — `list_pending_certifications` 500'd (MissingGreenlet) on the normal case [velara-api/app/services/certification_service.py]. `skill.versions` was accessed in a loop with no `selectinload`; the relationship is `lazy="select"` (skill.py:148), `Base` is a plain `DeclarativeBase` with no `AsyncAttrs` (base.py:15), so the lazy I/O raised `sqlalchemy.exc.MissingGreenlet` for any skill with a current version. **Empirically reproduced against live Postgres**: the 3 pending-list tests returned HTTP 500 / `MissingGreenlet` on the pre-fix code (they "passed" before only because they skip when infra is down). **Fix applied**: replaced the lazy access with one explicit `select(SkillVersion.id, SkillVersion.version).where(SkillVersion.id.in_(version_ids))` id→version map (3 flat queries, mirrors the cert-folding pattern); `SkillVersion` added to imports. Re-run against live PG: all 3 pending tests now pass.
- [x] [Review][Patch] **HIGH — FIXED** — Detail-panel certified-state ignored the current version (stale-version cert wrongly disabled Record) [CertificationScreen.tsx] (AC5). Now `.find(c => c.certification_type === 'technical' && c.skill_version_id === skill.current_version_id)` (and same for methodological). Folds in the Blind "page-1-only `.find`" concern (version-scoping bounds the relevant set). Added a regression test asserting a superseded-version cert keeps Record enabled.
- [x] [Review][Patch] **MEDIUM — FIXED** — AC6 manifestation now surfaces `signature_meaning` + `certifier_role` [CertKeyBadge.tsx + CertificationScreen.tsx]. CertKeyBadge gained `certifierRole`/`signatureMeaning` props (rendered in the tooltip), and the detail panel now shows a visible Part 11 manifestation line (signer + role + UTC timestamp + signature meaning) once technically certified.
- [x] [Review][Patch] **MEDIUM — FIXED** — E-signature modal no longer renders/submits under `userId='unknown'` [RecordTechnicalCertModal.tsx]. When `getCurrentUser()` is null the modal renders a "Sign-in required" re-auth prompt instead of the attestation form (no checklist, no submit). Added a test.
- [x] [Review][Patch] **MEDIUM — FIXED** — Modal focus trap now enumerates all focusable elements (checkboxes, textarea, enabled buttons) via a `dialogRef` query, and initial focus lands on the first checkbox (not the disabled Submit button) [RecordTechnicalCertModal.tsx]. Removed the two hard-coded button refs.
- [x] [Review][Patch] **LOW — FIXED** — Versionless `internal_ready` skill now shows a "No version to certify" bucket label instead of inviting an always-422 action [CertificationScreen.tsx getBucketLabel, guarded on `!item.current_version_id`].
- [x] [Review][Patch] **HIGH (BE-G, Decision 1) — FIXED** — `record_certification` now rejects non-`internal_ready` skills [certification_service.py]. New `SkillNotCertifiableError` (422 `SKILL_NOT_CERTIFIABLE`) raised after the `retired` check when `lifecycle_state != "internal_ready"`. Real enforcement boundary against deep-link / direct-API recording. 2 new integration tests (draft + client_ready → 422).
- [x] [Review][Patch] **HIGH (FE-G, Decision 1) — FIXED** — `CertificationDetail` now treats a non-`internal_ready` skill like "not found" ("This skill is not awaiting certification.") and hides the Record action [CertificationScreen.tsx]. FE error map gained `SKILL_NOT_CERTIFIABLE`. Added a test.

**Gates (all green):**
- velara-web: typecheck 0 errors, eslint clean, **279 tests pass** (+3 regression tests over the 276 baseline), build ✓.
- velara-api: `ruff check` clean; **cert integration suite 19/19 pass** against live Docker PG+MinIO (was 17; +2 SKILL_NOT_CERTIFIABLE tests); broader regression run **612 pass, 0 regressions** (test_skills + test_certifications + all unit). The api image was rebuilt + container recreated so the fix was validated against live Postgres (this is what surfaced the Critical — the pre-fix endpoint 500'd).

### Deferred (pre-existing / out-of-scope)

- [x] [Review][Defer] Raw `certifier_user_id` (UUID) rendered as the certifier display name in the badge/tooltip [CertificationScreen.tsx:198; CertKeyBadge.tsx:42,55] — deferred. Per locked Decision D2, no display name exists until Epic 7 Cognito; user_id is the deliberate placeholder. Revisit when identity/printed-name binding lands (Epic 7).

### Dismissed (7, false positives / by-design)

- Escape `removeEventListener` "likely wrong" (Blind) — FALSE POSITIVE: correctly bound `document.removeEventListener('keydown', handleKey)` (RecordTechnicalCertModal.tsx:49).
- Missing `aria-labelledby` (Blind) — FALSE POSITIVE: wired at RecordTechnicalCertModal.tsx:91 (`aria-modal="true"` + `aria-labelledby="cert-modal-title"`).
- `org_id: str` type mismatch (Blind) — FALSE POSITIVE: `Skill.org_id` is `Mapped[str]` String(128) (skill.py:134); the annotation is correct.
- Methodological key has a badge but no recording UI ("dead end") (Blind+Edge) — BY DESIGN: methodological recording is explicitly Story 6.3 scope; 6.2 renders the badge read-only.
- Backdrop/Escape close discards dirty checklist+notes without confirm (Blind) — intentional modal UX; both gated on `!isPending`; consistent with existing ConfirmDialog convention.
- `friendlyCertificationError` could render a non-string `message` (Blind) — matches the existing `friendlyJobError`/`friendlyInvocationError` convention; no new risk introduced.
- count/page TOCTOU desync (Blind) — benign for a same-transaction governance list; out-of-range page correctly returns empty items + accurate total.

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
N/A — no significant debugging issues.

### Completion Notes List
- **Backend:** Added `list_pending_certifications` to `certification_service.py` using a single grouped query over `certification_records` for the page's version_id set (avoids per-skill round-trips). `PendingCertificationItem` / `PendingCertificationListData` added to `certification.py` schemas. `GET /api/v1/certifications/pending` declared before any future `/{cert_id}` path. 4 integration tests added.
- **Frontend API module:** `src/api/certifications.ts` filled with exact backend type mirrors, `listPendingCertifications`/`listCertifications`/`recordCertification` with `.data.data` unwrap.
- **Error map:** `CERTIFICATION_ERROR_MESSAGES` + `friendlyCertificationError` added to `errors.ts`.
- **Hooks:** `usePendingCertifications` (30s staleTime), `useCertifications` (conditional-fetch), `useRecordCertification` (invalidates 3 query keys; NO optimistic updates per arch rule).
- **CertKeyBadge:** Uses `--color-key-tech*` / `--color-key-method*` pre-existing tokens; pending (outline/muted) vs certified (filled); certifier/date shown in tooltip + inline.
- **CertificationScreen:** Two-pane (list left / detail right) with nested `<Routes>`. Bucketing derived from cert flags not lifecycle_state (both buckets are internal_ready — trap avoided). `useSkill` for detail panel; `useCertifications` for certifier/timestamp on already-certified badge.
- **RecordTechnicalCertModal:** New modal (ConfirmDialog too rigid). a11y: `role="dialog" aria-modal` + focus-trap + Escape guard. AC6 e-signature statement using `getCurrentUser()` (user_id+role, NOT hardcoded "M. Maxwell"). 5-item checklist. Double-submit `if (isPending) return` guard. Error banner uses `--color-danger` tokens.
- **Route:** `internal.tsx` Placeholder replaced with `<CertificationScreen />`; `certification/*` wildcard kept; useActiveTab invariant preserved.
- **Gates:** 276 web tests (↑17 from 259 baseline), 0 regressions. typecheck 0 errors. lint clean. build ✓. Backend Python syntax validated.

### File List
velara-api/app/services/certification_service.py (EDITED — added list_pending_certifications)
velara-api/app/schemas/certification.py (EDITED — added PendingCertificationItem, PendingCertificationListData)
velara-api/app/api/v1/certifications.py (EDITED — added GET /pending endpoint, imported new schemas)
velara-api/tests/integration/api/test_certifications.py (EDITED — added 4 pending-list integration tests)
velara-web/src/api/certifications.ts (FILLED — was `export {}`)
velara-web/src/features/certification/types.ts (FILLED — was `export {}`)
velara-web/src/shared/utils/errors.ts (EDITED — added CERTIFICATION_ERROR_MESSAGES + friendlyCertificationError)
velara-web/src/routes/internal.tsx (EDITED — replaced certification/* Placeholder with CertificationScreen)
velara-web/src/features/certification/hooks/useCertifications.ts (NEW)
velara-web/src/features/certification/components/CertKeyBadge.tsx (NEW)
velara-web/src/features/certification/components/CertificationScreen.tsx (NEW)
velara-web/src/features/certification/components/RecordTechnicalCertModal.tsx (NEW)
velara-web/src/api/certifications.test.ts (NEW)
velara-web/src/features/certification/hooks/useCertifications.test.tsx (NEW)
velara-web/src/features/certification/components/CertificationScreen.test.tsx (NEW)
velara-web/src/features/certification/components/RecordTechnicalCertModal.test.tsx (NEW)

## Change Log
- 2026-06-27: Story implemented (dev-story). Full-stack: BE pending-list endpoint + FE Certification screen (unified list + detail + RecordTechnicalCertModal). 17 new FE tests (276 total), 4 new BE integration tests. All ACs satisfied. Status → review.
