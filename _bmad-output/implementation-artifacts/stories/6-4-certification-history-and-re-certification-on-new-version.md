---
baseline_commit: 83a4ab0ac51f3846b10509d132411c380f021971
---

# Story 6.4: Certification History & Re-Certification on New Version

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Plain-language framing (read first):** This story is almost entirely **frontend**. The backend already does everything: it already stores a cert row per (version, type), already keeps old-version certs untouched when a new version is published, already resets a re-versioned skill to `draft`, already flags derived skills for review and blocks them, and already has an endpoint that returns a skill's full cross-version cert history. **None of that needs to be built.** 6.4 surfaces it in the UI: (1) a **Certification History** panel showing every version's keys + signers + dates + notes; (2) a **"Requires re-certification"** indicator when a new version reset the skill; (3) a **derived-skill review warning + an Acknowledge button** that clears the block. The only possible backend work is one extra test proving the history endpoint spans multiple versions.

## Story

As an MA Tech developer,
I want to view the full certification history for any skill version and be required to re-certify whenever a new version is published,
So that the audit trail is complete and no new version can reach clients without going through governance.

## Acceptance Criteria

**AC1 — Certification history shows every version's records:**
**Given** I view a skill with one or more versions that have certification records
**When** I open the Certification History section (on the Skill Detail page)
**Then** I see, grouped by version (newest version first), each version's certification records: version number, technical certifier + UTC date + notes, and methodological certifier + UTC date + notes. A version with no certs shows an explicit "no certifications recorded" row; a record's optional `notes` render when present.
[Source: epic-6-certification-governance.md:115-117; GET /certifications?skill_id= returns CertificationRead[] with skill_version per record — certification_service.py list_certifications]

**AC2 — A re-versioned skill shows "Requires re-certification":**
**Given** a skill was `client_ready` at version 1.0.0
**When** version 1.1.0 is published (the skill resets to `draft`, current version repoints to 1.1.0, and the new version has zero certs while the 1.0.0 certs are preserved in history)
**Then** the Skill Detail page shows a clear **"Requires re-certification"** indicator for the current version, and the Certification History still shows the preserved 1.0.0 records (they did NOT carry over to 1.1.0). The indicator is shown whenever the current version has zero certs AND at least one prior-version cert exists for the skill.
[Source: epic-6-certification-governance.md:119-121; create_version resets client_ready→draft (skill_service.py:623-629); certs are version-FK'd so old certs persist bound to the old skill_version_id; the RECERTIFICATION_REQUIRED gate condition — certification_service.py:446-455]

**AC3 — Derived-skill review warning blocks certification until acknowledged:**
**Given** a derived (paired) skill has `review_required: true` because its parent published a new version
**When** I view it / attempt to advance it toward client_ready
**Then** the UI shows a warning — "Parent skill was updated. Review lineage changes before certifying." — with a link to the parent skill, and an **"Acknowledge parent update"** action; advancing to `client_ready` is blocked (backend returns `DERIVED_SKILL_REVIEW_REQUIRED` 422) until I acknowledge. After I acknowledge (`POST /api/v1/skills/{id}/acknowledge-parent-update`), the flag clears, the warning disappears, and the advance is unblocked (subject to the normal two-key gate).
[Source: epic-6-certification-governance.md:123-125; review_required set by parent create_version (skill_service.py:637-645); assert_can_advance block (skill_service.py:680-689); acknowledge endpoint (skills.py:290-311)]

**AC4 — The history endpoint returns all records across all versions, chronologically:**
**Given** certification records exist for a skill across one or more versions
**When** `GET /api/v1/certifications?skill_id={id}` is called
**Then** all certification records for that skill (ALL versions) are returned in chronological order (`certified_at` ascending). This contract already exists; AC4 is satisfied by the existing endpoint and is covered by a test proving multi-version spread.
[Source: epic-6-certification-governance.md:127-129; certification_service.py list_certifications — filters skill_id+org_id only (no version filter), order certified_at ASC]

## Tasks / Subtasks

> **SCOPE: FRONTEND-only** (plus ONE optional backend test). The backend for all four AC areas is already built and tested (verified against source — see "Already-built backend" below). Do NOT add endpoints, services, migrations, models, or schema changes. The work is: a Certification History panel + a re-cert indicator + a derived-review warning & acknowledge action, all on the **Skill Detail page** (`SkillDetail.tsx`), plus a thin acknowledge API fn + hook.
>
> ⚠️ **Why Skill Detail, not the Certification screen:** the existing `/internal/certification` screen is `internal_ready`-only and **current-version-only** (`CertificationScreen.tsx:292` hard-blocks any non-internal_ready skill; it shows only the current version's two keys). A re-versioned skill is back at `draft`, and history spans `client_ready`/`draft` skills — none of which the certification screen will display. SkillDetail already renders for every lifecycle state and already hosts the version, lineage, and review-required UI. That is the correct home for 6.4 (Decision D1).

### BACKEND (velara-api) — verification only

- [x] **Task 1 — Multi-version history integration test (AC: 4) — ADD to `tests/integration/api/test_certifications.py`**
  - [x] Add `test_list_certifications_spans_multiple_versions`: create a skill, advance to internal_ready, `_post_cert(technical)` + `_post_cert(methodological)` (auto-advances to client_ready at v1.0.0), publish a new version (resets to draft), advance back to internal_ready, record both certs on v1.1.0 → `GET /certifications?skill_id=` returns ALL FOUR records across BOTH versions, ordered `certified_at` ascending, each with its correct `skill_version` string. The existing `test_list_certifications_chronological` only certifies ONE version — this proves the cross-version spread AC4 actually requires.
  - [x] Reuse helpers in `test_certifications.py`: `_create_skill`, `_advance_to_internal_ready`, `_post_cert`. For publishing a new version + advancing back, mirror `test_recertification_required_on_new_version_422` (test_certifications.py:231-268). Gate: `ruff check .` clean; run against live Docker PG (`docker compose exec api pytest tests/integration/api/test_certifications.py`); 0 regressions. **No production code change** — this test documents/locks the already-correct behavior.
  - [x] Do NOT change `list_certifications`, the route, or any schema. Do NOT attempt to "fix" the RECERTIFICATION_REQUIRED discriminator (the "any prior cert exists" vs "previously client_ready" simplification) — it remains spec-sanctioned and deferred (needs a lifecycle state-history table that does not exist; deferred-work.md:203). Out of scope.

### FRONTEND (velara-web)

- [x] **Task 2 — Acknowledge API fn + hook (AC: 3) — EDIT `src/api/skills.ts` + `src/features/skills/hooks/useSkills.ts`**
  - [x] Add `acknowledgeParentUpdate(skillId: string): Promise<SkillWithVersion>` to `api/skills.ts`, mirroring `transitionLifecycle` (skills.ts:75-81): `POST /api/v1/skills/${skillId}/acknowledge-parent-update` (POST, **no body**), unwrap `response.data.data`. [Source: skills.py:290-311 — POST, no request body, returns ResponseEnvelope[SkillRead]]
  - [x] Add `useAcknowledgeParentUpdate(skillId: string)` to `useSkills.ts`, mirroring `useTransitionLifecycle` (useSkills.ts:62-72): on success invalidate `['skills', skillId]`, `['skills']`, `['skills-page']` (acknowledge clears `review_required`, which is read across all skills views). Acknowledging does NOT change cert records, so it need NOT invalidate `['certifications', ...]`.

- [x] **Task 3 — Certification History panel (AC: 1) — NEW `src/features/certification/components/CertificationHistory.tsx`**
  - [x] Props: `{ skillId: string }`. Use the EXISTING `useCertifications(skillId)` hook (useCertifications.ts:17-23) — it already calls `GET /certifications?skill_id=` and returns `{ items: CertificationRead[], page }`. Do NOT add a new hook or API fn.
  - [x] **Group the flat `items` list by `skill_version` client-side**, newest-version-first. Each record carries `skill_version` (semver string) + `skill_version_id` + `certification_type` + `certifier_user_id` + `certifier_role` + `certified_at` + `signature_meaning` + `notes`. For each version group render: the version label (`v{skill_version}`), and within it the technical record (certifier + role + UTC date + notes) and the methodological record (same), or a "no certifications recorded" line for a key that's absent. Sort versions by semver descending (or by the max `certified_at` in each group descending — simpler and matches "newest activity first"); within a version, technical then methodological.
  - [x] **Version ordering note:** the list is `certified_at` ASC (oldest-first) from the API. Do the grouping + reordering in the component; do NOT rely on API order for display. A version may have only one key (e.g. technical recorded, methodological pending) — render the present key and a muted "Methodological — not yet recorded" placeholder.
  - [x] **per_page guard (closes a 6.3-deferred risk):** the default `useCertifications` page is `per_page=50`. On a high-churn skill with many versions × 2 keys, the full history could exceed one page and silently truncate. For the history view, fetch with a higher bound — either call `listCertifications({ skill_id, per_page: 200 })` via a dedicated query (new hook variant or pass params through `useCertifications`) OR page through. Simplest acceptable approach: add an optional `params` arg to `useCertifications` and request `per_page: 200` for the history panel. Document the cap (200 is the backend max — certifications.py:113); a skill exceeding 200 cert records (100 versions) is not a Phase-1 concern but note the cap in a comment. [Source: 6-3 Review Defer — useCertifications page-1 truncation; certifications.py:112-113 per_page le=200]
  - [x] Reuse existing layout/token conventions from `CertificationScreen.tsx` (the `--color-key-tech*`/`--color-key-method*` tokens, the card/badge styling, the UTC manifestation line format at CertificationScreen.tsx:429-447). Render UTC via `new Date(certified_at).toUTCString()` for the Part 11 line consistency. Guard `new Date(...)` is server-controlled ISO (the 6.3 review noted an unguarded `new Date` — a malformed value would show "Invalid Date"; acceptable for now, server emits valid ISO, but don't crash on it).

- [x] **Task 4 — Mount history + re-cert indicator on Skill Detail (AC: 1, 2) — EDIT `src/features/skills/components/SkillDetail.tsx`**
  - [x] **Mount `<CertificationHistory skillId={skill.id} />`** as a new section on the skill detail page (a sibling of the existing Lineage / Current Version / Lifecycle sections, ~SkillDetail.tsx:257-311). Place it after the Lifecycle/Version sections. Import from `@/features/certification/components/CertificationHistory`.
  - [x] **Re-cert indicator (AC2):** derive `needsRecert` on the detail page: the current version has zero certs AND at least one prior cert exists for the skill. Compute from the `useCertifications(skillId)` data already fetched by the history panel — either lift that query to SkillDetail or expose a small derived flag from the history component. Concretely: `currentVersionCerts = items.filter(c => c.skill_version_id === skill.current_version_id)`; `needsRecert = currentVersionCerts.length === 0 && items.length > 0`. When `needsRecert`, render a clear **"Requires re-certification"** badge/banner near the lifecycle badge (mirror the existing `review_required` "⚠ Review required" pill at SkillDetail.tsx:157-161 in style). This mirrors the backend's RECERTIFICATION_REQUIRED condition (certification_service.py:446-455) so the UI and the gate agree.
  - [x] Do NOT compute re-cert from `lifecycle_state` alone — a brand-new never-certified `draft` skill also has zero current-version certs but NO prior certs, so it must NOT show "Requires re-certification". The `items.length > 0` (prior cert exists) clause is what distinguishes re-cert from never-certified. [Trap — mirrors the backend discriminator exactly]

- [x] **Task 5 — Derived-review warning + Acknowledge action (AC: 3) — EDIT `src/features/skills/components/SkillDetail.tsx`**
  - [x] SkillDetail already renders a "⚠ Review required" pill (`:157-161`), maps the `DERIVED_SKILL_REVIEW_REQUIRED` transition error (`:121-124`), and shows the parent-lineage link (`:302-311`). **What's missing is the explicit warning copy + an Acknowledge button** — today the user sees the error but has no way to clear the flag from the UI (a dead-end). Close it:
  - [x] When `skill.review_required` is true, render a warning block (near the review-required pill or in the Lineage section): **"Parent skill was updated. Review lineage changes before certifying."** + the existing parent link (`skill.lineage?.derived_from.parent_skill_id` → `/internal/skills/{parent}`, already at `:302-311`) + an **"Acknowledge parent update"** button.
  - [x] Wire the button to `useAcknowledgeParentUpdate(skill.id)` (Task 2). On success the `review_required` flag clears via cache invalidation and the warning disappears (no manual state needed — `useSkill` re-reads). Use a double-submit `if (isPending) return` guard (mirror the transition handler at SkillDetail.tsx:108-133). On error, surface a friendly message (reuse `getErrorMessage` already imported).
  - [x] **Scope of who can acknowledge:** any authenticated internal user (no RBAC — Epic 8). Do NOT add a role check. [FR-SEC-11 = Epic 8]
  - [x] Keep the existing `DERIVED_SKILL_REVIEW_REQUIRED` transition-error mapping (`:121-124`) — but now its message can point the user to the Acknowledge button ("…acknowledge the parent update below before advancing.").

- [x] **Task 6 — Frontend tests (AC: all) — NEW + EDIT colocated `*.test.tsx`/`*.test.ts`**
  - [x] **NEW `src/api/skills.test.ts`** (or EDIT if it exists) — add an `acknowledgeParentUpdate` test: asserts `POST /api/v1/skills/{id}/acknowledge-parent-update` with no body, unwraps `.data.data`. Mirror the `transitionLifecycle` test pattern.
  - [x] **NEW `src/features/certification/components/CertificationHistory.test.tsx`** — mock `useCertifications`; assert: records grouped by version newest-first; a multi-version fixture (v1.0.0 tech+meth, v1.1.0 tech only) renders both version groups, both v1.0.0 signers/dates, the v1.1.0 technical signer, and a "methodological not yet recorded" placeholder for v1.1.0; notes render when present; empty-history shows the empty state. Reuse `makeQC` + the mocked-hook fixture pattern from `CertificationScreen.test.tsx`.
  - [x] **EDIT `src/features/skills/components/SkillDetail.test.tsx`** — add: (a) `needsRecert` banner renders when current version has 0 certs but prior certs exist; (b) `needsRecert` banner does NOT render for a never-certified skill (0 current + 0 prior); (c) the "Parent skill was updated…" warning + Acknowledge button render when `review_required`; (d) clicking Acknowledge calls the mutation; (e) the warning is absent when `review_required` is false. Mock `useCertifications` + `useAcknowledgeParentUpdate` + `useSkill`. Reuse the existing SkillDetail test fixtures (`baseSkill`/`SkillWithVersion`).
  - [x] **EDIT `src/features/skills/hooks/useSkills.test.tsx`** (if present) — add a `useAcknowledgeParentUpdate` invalidation test: asserts `['skills', skillId]`, `['skills']`, `['skills-page']` invalidated on success. Mirror the `useTransitionLifecycle` invalidation test.
  - [x] Gates: `npm test` (baseline 293 after 6.3 — net new from history + acknowledge + skill-detail tests), 0 regressions; `npm run typecheck` 0 errors; lint clean; `npm run build` ✓.

## Dev Notes

### Already-built backend (verified against source — do NOT rebuild)

Every backend mechanism 6.4 needs already exists and is tested. This was confirmed by reading the actual source:

- **AC4 — cross-version history list: DONE.** `GET /api/v1/certifications?skill_id=` → `list_certifications` filters by `skill_id` + `org_id` ONLY (no version filter), so it returns ALL records across ALL versions, ordered `certified_at ASC, id ASC` (oldest-first), paginated (`per_page` default 50, max 200). Each `CertificationRead` carries `skill_version` (semver string) + `skill_version_id` — everything the FE needs to group by version. Org-scope guarded via `get_skill` (404 on cross-org). [certification_service.py list_certifications; certifications.py:106-129; schemas/certification.py CertificationRead/CertificationListData]
- **AC2 — new version → re-cert + old certs preserved: DONE.** `create_version` resets `lifecycle_state` `client_ready → draft` (skill_service.py:623-629), repoints `current_version_id` to the new version, and does NOT touch `certification_records`. Certs are FK'd to `skill_version_id` (immutable), so old-version certs stay bound to the old version and the new version has zero certs. The gate raises `RECERTIFICATION_REQUIRED` when the current version has zero certs AND any prior-version cert exists (certification_service.py:446-455). [test: test_recertification_required_on_new_version_422]
- **AC3 — derived review + block + acknowledge: DONE.** A parent's `create_version` bulk-sets `review_required=True` on all derived children (skill_service.py:637-645). `assert_can_advance` blocks `client_ready` with `DERIVED_SKILL_REVIEW_REQUIRED` 422 while flagged (skill_service.py:680-689). `POST /api/v1/skills/{id}/acknowledge-parent-update` (skills.py:290-311; service skill_service.py:872-896) sets `review_required=False`, idempotent, 404 on unknown/cross-org, returns the updated `SkillRead`. [tests: test_new_parent_version_flags_child_for_review, test_flagged_child_cannot_advance_to_client_ready, test_acknowledge_clears_flag_and_unblocks_client_ready]
- **SkillRead fields the FE needs: ALL EXPOSED.** `SkillRead` exposes `lifecycle_state`, `current_version_id`, `review_required`, `derived_from`, `paired_with`. The detail route `GET /api/v1/skills/{id}` returns `SkillReadWithVersion` with `current_version` (incl. `.version` semver) + `lineage` — the FE already consumes this as `SkillWithVersion` via `getSkill`/`useSkill`. [schemas/skill.py SkillRead:222-256, SkillReadWithVersion:292-297]

> **Net: 6.4 is a frontend story.** The only backend task is one verification test (Task 1). No endpoint, service, migration, model, or schema change.

### As-built FRONTEND state (verified — what exists vs what 6.4 adds)

- **`SkillDetail.tsx` already has** (the AC3 anchors): a "⚠ Review required" pill gated on `skill.review_required` (`:157-161`); the `DERIVED_SKILL_REVIEW_REQUIRED` transition-error mapping (`:121-124`); a Lineage section with the parent-skill link (`:298-311`); the double-submit transition guard pattern (`:108-133`); `getErrorMessage` imported. **6.4 adds:** the explicit "Parent skill was updated…" warning copy + an **Acknowledge button** (the missing piece — today the flag can't be cleared from the UI) + the re-cert indicator + the history panel mount.
- **`useCertifications(skillId)` already exists** (useCertifications.ts:17-23) and already returns the full cross-version history (`GET /certifications?skill_id=`). 6.4 REUSES it for the history panel; only the `per_page` needs raising for the history view (default 50 could truncate). No new cert API fn/hook.
- **`api/skills.ts` + `useSkills.ts` have NO acknowledge fn/hook** — 6.4 ADDS `acknowledgeParentUpdate` + `useAcknowledgeParentUpdate`, mirroring `transitionLifecycle`/`useTransitionLifecycle` exactly. [skills.ts:75-81; useSkills.ts:62-72]
- **The `/internal/certification` screen is NOT the home for 6.4** — it's `internal_ready`-only (`CertificationScreen.tsx:292`) and current-version-only. Do NOT try to add history/re-cert/derived-warning there; a re-versioned `draft` skill won't even render. SkillDetail renders for all states. [Decision D1]

### LOCKED DECISIONS (resolved 2026-06-27)

- **D1 — History + re-cert state + derived-review live on the Skill Detail page** (`SkillDetail.tsx`), not the Certification screen. The Certification screen is `internal_ready`/current-version-only and cannot show a re-versioned `draft` skill or cross-version history; SkillDetail already renders for every lifecycle state and already hosts version/lineage/review-required UI. [Source: CertificationScreen.tsx:292; SkillDetail.tsx:257-311]
- **D2 — Close the acknowledge UX dead-end with a real Acknowledge button** wired to the existing `POST /skills/{id}/acknowledge-parent-update`. Today the FE shows the `DERIVED_SKILL_REVIEW_REQUIRED` error but offers no way to clear the flag — AC3 ("blocked until acknowledged") is only half-built. 6.4 finishes it. [Source: skills.py:290-311; SkillDetail.tsx:121-124]
- **D3 — Group cert history by version CLIENT-SIDE from the existing flat list** (no new grouping endpoint). The list endpoint already returns every record with its `skill_version`; the component groups + reorders newest-first. Raise `per_page` to 200 (backend max) for the history fetch to avoid the 6.3-deferred page-1 truncation on high-churn skills. [Source: certification_service.py list_certifications; certifications.py:112-113; 6-3 Review Defer]
- **D-signer (carried) — signer = `certifier_user_id` + `role`.** No display name until Epic 7 Cognito. History rows render the recorded `certifier_user_id` (+ role), not a resolved name. [Source: 6-2/6-3 Decision D2]
- **D-recert-discriminator — DO NOT fix the coarse discriminator.** The backend infers RECERTIFICATION_REQUIRED from "any prior cert exists" rather than "previously reached client_ready" because there is no lifecycle state-history table. This is spec-sanctioned and deferred; the FE re-cert indicator mirrors the SAME condition (current version 0 certs AND ≥1 prior cert) so UI and gate agree. Do NOT build a state-history table. [Source: deferred-work.md:203; certification_service.py:446-455]

### DEV TRAPS & REUSE MAP

**REUSE (don't rebuild):**
1. **`useCertifications(skillId)`** already returns the full cross-version history — reuse for the panel; only raise `per_page`. [useCertifications.ts:17-23]
2. **`getSkill`/`useSkill`** already return `SkillWithVersion` (current_version + lineage + review_required) — the history/re-cert UI reads these. [useSkills.ts:30-36; api/skills.ts:54-55]
3. **`transitionLifecycle`/`useTransitionLifecycle`** are the exact template for the new acknowledge fn/hook (POST vs PATCH; same invalidation set). [skills.ts:75-81; useSkills.ts:62-72]
4. **SkillDetail existing pieces**: review-required pill (`:157-161`), error mapping (`:121-124`), Lineage + parent link (`:298-311`), double-submit guard (`:108-133`), `getErrorMessage`. EXTEND, don't duplicate.
5. **Cert tokens + Part 11 line format** from `CertificationScreen.tsx` (`--color-key-tech*`/`--color-key-method*`, `new Date(certified_at).toUTCString()` manifestation line at `:429-447`). [CertificationScreen.tsx]
6. **Test patterns**: `makeQC`, mocked-hook fixtures, `<MemoryRouter>` — from `CertificationScreen.test.tsx` + `SkillDetail.test.tsx`. BE: `_create_skill`/`_advance_to_internal_ready`/`_post_cert`, `test_recertification_required_on_new_version_422` as the version-publish template. [test_certifications.py:231-268]

**TRAPS:**
1. **Re-cert indicator must NOT fire for a never-certified skill** — gate on `currentVersionCerts.length === 0 AND items.length > 0` (prior cert exists). A fresh `draft` skill has 0 current certs but 0 prior certs → no indicator. [mirrors certification_service.py:446-455]
2. **`useCertifications` default `per_page=50` can truncate history** — raise to 200 for the history view or the oldest records fall off and the panel shows an incomplete trail. [6-3 Review Defer; certifications.py:113]
3. **API list is `certified_at` ASC (oldest-first)** — the panel must reorder to newest-version-first itself; do NOT assume display order from the API. [certification_service.py order]
4. **History spans non-internal_ready skills** — do NOT mount it inside the internal_ready-gated certification detail panel; mount on SkillDetail which renders for all states. [Decision D1]
5. **Acknowledge endpoint is POST `/acknowledge-parent-update` with NO body** — not PATCH, not `/acknowledge`. Returns the updated skill. [skills.py:290-311]
6. **Acknowledge invalidates SKILLS keys, not certifications** — it clears `review_required` (a Skill field); cert records are untouched. Invalidate `['skills', id]` + `['skills']` + `['skills-page']`. [mirror useTransitionLifecycle]
7. **Old certs are preserved, not deleted, on new version** — the history must show prior-version records; they live in the table bound to the old `skill_version_id`. Do NOT filter history to the current version. [create_version never touches certification_records]
8. **No display name** — render `certifier_user_id` + role, not a resolved name (Epic 7). [D-signer]
9. **Do NOT fix the RECERTIFICATION_REQUIRED discriminator** — spec-sanctioned, deferred (no state-history table). [deferred-work.md:203]
10. **Guard `new Date(certified_at)`** — server emits valid ISO, but a malformed value should not crash the regulatory line (6.3 review noted this). Render defensively.

### Out of scope (explicitly NOT 6.4)

- **No new backend endpoint/service/migration/model/schema.** All backend mechanisms exist; Task 1 is a verification test only.
- **No RBAC** on who may acknowledge or certify (Epic 8 / FR-SEC-11). Any authenticated internal user. [requirements-inventory.md:102]
- **No lifecycle state-history table** and no fix to the "any prior cert" re-cert discriminator (spec-sanctioned simplification). [deferred-work.md:203]
- **No cryptographic signing / password re-auth** (FR-SEC-12 deferred). [requirements-inventory.md:103]
- **No client-portal exposure** — certification history + signatures are an internal governance surface; never surface on client-facing routes (Epic 8 enforces). [core-architectural-decisions.md:12,26; FR-ACL-03/04/05]
- **Re-cert auto-trigger / version diffing** — 6.4 surfaces the re-cert *requirement*; re-running certification is the normal 6.2/6.3 flow once the skill is advanced back to internal_ready. No new automation.

### IP-protection / compliance constraints

Certification history + signatures are an **internal governance surface**. The history panel lives under `/internal/*` (SkillDetail) and MUST NOT be exposed in the client portal (Epic 8). `notes` and `signature_meaning` can carry methodology assessments — never surface on any client-facing route. The history is the **complete 21 CFR Part 11 audit trail** (FR-SEC-10) — each row is an immutable e-signature record (signer + UTC timestamp + meaning, bound to a version). Render the full preserved trail; never hide or mutate prior-version records. [Source: core-architectural-decisions.md:12,26,95; FR-SEC-10 requirements-inventory.md:101; FR-CRT-05 requirements-inventory.md:77]

### Testing standards summary

- **Frontend:** vitest + @testing-library/react (jsdom), `user-event`. Colocated `*.test.tsx`/`*.test.ts`. Mock API/hook modules with `vi.mock`; wrap hooks in `<QueryClientProvider>` (`makeQC` with `retry:false`); render in `<MemoryRouter>`. Mock `useCertifications`/`useSkill`/`useAcknowledgeParentUpdate`. Run `npm test`. Baseline 293 after 6.3. [Source: 6-3 story; vitest.config.ts]
- **Backend:** pytest, Docker integration against `velara_test` PG; reuse `test_certifications.py` helpers. Verify the multi-version history test against LIVE Postgres (the 6.2/6.3 reviews showed infra-down auto-skip can hide failures — rebuild/cp into the container and run green). Baseline after 6.3: cert integration ~24 tests; BE unit 497. [Source: 6-3 story]

### Project Structure Notes

- New FE file `src/features/certification/components/CertificationHistory.tsx` sits beside the existing certification components. SkillDetail (skills feature) imports it cross-feature — acceptable (it already imports certification-adjacent UI conventions). No structural variance.
- The acknowledge fn/hook extend the existing `api/skills.ts` + `useSkills.ts` — no new files there.
- One BE test added to `test_certifications.py` — no new BE files, no migration.
- **Design prototype reference (layout cues ONLY):** `design/internal2.jsx` (the certification two-pane prototype) shows a cert-history list style; use it for visual cues only — IGNORE its deprecated `var(--green-*)` tokens (the `key-*`/`st-*` token decisions stand).

### Latest Tech Information

Stack (verified `package.json`): React 19, react-router-dom 7, @tanstack/react-query 5, axios 1.7, zustand 5, Tailwind v4 (CSS-first `@theme` in `index.css`, NO `tailwind.config.js`), Vite 6, Vitest 2, @aws-amplify/auth 6. Backend: FastAPI + Pydantic v2 + SQLAlchemy 2.x (async). **No new dependency required** (BE or FE).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-6-certification-governance.md#Story-6.4 (ACs lines 107-129)]
- [Source: _bmad-output/planning-artifacts/epics/requirements-inventory.md — FR-CRT-04 re-cert per version (76), FR-CRT-05 immutable record (77), FR-SEC-10 (101), FR-SEC-11 (102)]
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md — IP rule (12,26), Part 11 §11.50/§11.70 (95)]
- [Source: implementation-artifacts/stories/6-1-certification-data-model-and-state-machine-api.md — as-built backend, re-cert reset, two-key gate]
- [Source: implementation-artifacts/stories/6-3-methodological-certification-workflow-ui.md — as-built FE redesign (CertificationScreen card UI, LockDot/KeyCard), Review Findings (per_page truncation defer; unguarded new Date defer); File List]
- [Source: implementation-artifacts/deferred-work.md:203 — RECERTIFICATION_REQUIRED discriminator simplification (stays deferred — out of 6.4 scope)]
- [Source: velara-api/app/services/certification_service.py — list_certifications (cross-version, certified_at ASC, per_page≤200), evaluate_certification_eligibility, assert_certified_for_client_ready re-cert discriminator (446-455)]
- [Source: velara-api/app/services/skill_service.py — create_version reset client_ready→draft (623-629) + flag derived children (637-645), assert_can_advance / DerivedSkillReviewRequiredError (680-689), acknowledge_parent_update (872-896)]
- [Source: velara-api/app/api/v1/certifications.py — GET "" list route (106-129); velara-api/app/api/v1/skills.py — POST acknowledge-parent-update (290-311), PATCH lifecycle (190-206)]
- [Source: velara-api/app/schemas/skill.py — SkillRead (222-256: review_required, derived_from, current_version_id, lifecycle_state), SkillReadWithVersion (292-297: current_version, lineage)]
- [Source: velara-api/tests/integration/api/test_certifications.py — _create_skill/_advance_to_internal_ready/_post_cert, test_list_certifications_chronological, test_recertification_required_on_new_version_422 (231-268); tests/integration/api/test_skills.py — derive/acknowledge tests (test_acknowledge_clears_flag_and_unblocks_client_ready), _lifecycle helper]
- [Source: velara-web/src/features/certification/components/CertificationScreen.tsx — internal_ready-only guard (292), token/manifestation conventions (429-447); hooks/useCertifications.ts — useCertifications (17-23)]
- [Source: velara-web/src/api/certifications.ts — listCertifications + CertificationRead (per_page param, all fields)]
- [Source: velara-web/src/features/skills/components/SkillDetail.tsx — review-required pill (157-161), DERIVED_SKILL_REVIEW_REQUIRED mapping (121-124), Lineage + parent link (298-311), double-submit guard (108-133), section layout (257-311)]
- [Source: velara-web/src/api/skills.ts — transitionLifecycle pattern (75-81), getSkill (54-55); src/features/skills/hooks/useSkills.ts — useTransitionLifecycle (62-72), useSkill (30-36); src/features/skills/types.ts — SkillWithVersion/Lineage/DerivedFrom (38-75)]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- All tasks complete. 313 tests pass (baseline 293 + 20 new), typecheck clean, lint clean, build ✓.
- `useCertifications` extended with optional `params` arg (queryKey includes params to avoid cache collision between per_page:50 CertificationScreen calls and per_page:200 history calls).
- `needsRecert` computed in SkillDetail from lifted `useCertifications(skillId, { per_page: 200 })` — mirrors backend RECERTIFICATION_REQUIRED discriminator exactly (0 current-version certs AND ≥1 prior cert).
- `DERIVED_SKILL_REVIEW_REQUIRED` error message updated to point users to the Acknowledge button.
- `ConfirmDialog.test.tsx` also required mocks for the new hooks (it renders SkillDetail). Added `useAcknowledgeParentUpdate` + `useCertifications` mocks + `CertificationHistory` stub there too.

### File List

**Backend (velara-api):**
- `tests/integration/api/test_certifications.py` — EDITED (added `test_list_certifications_spans_multiple_versions`)

**Frontend (velara-web):**
- `src/api/skills.ts` — EDITED (added `acknowledgeParentUpdate`)
- `src/features/skills/hooks/useSkills.ts` — EDITED (added `useAcknowledgeParentUpdate`)
- `src/features/certification/hooks/useCertifications.ts` — EDITED (added optional `params` arg)
- `src/features/certification/components/CertificationHistory.tsx` — NEW
- `src/features/skills/components/SkillDetail.tsx` — EDITED (mounted CertificationHistory, re-cert indicator, AC3 warning + Acknowledge)
- `src/api/skills.test.ts` — EDITED (added `acknowledgeParentUpdate` test)
- `src/features/certification/components/CertificationHistory.test.tsx` — NEW
- `src/features/skills/components/SkillDetail.test.tsx` — EDITED (added AC1/AC2/AC3 tests)
- `src/features/skills/hooks/useSkills.test.tsx` — EDITED (added `useAcknowledgeParentUpdate` test)
- `src/features/skills/components/ConfirmDialog.test.tsx` — EDITED (added new hook mocks needed by SkillDetail)

### Review Findings

> Code review 2026-06-27 (bmad-code-review, 3 layers: Blind Hunter + Edge Case Hunter + Acceptance Auditor). Diff: uncommitted story-6.4 changes across velara-web + velara-api. 4 findings after triage (1 patch, 2 decision-needed, 1 defer); 8 dismissed as noise/false-positive/satisfied-by-design. AC1–AC4 + all locked decisions/traps verified PASS by the Acceptance Auditor.

- [x] [Review][Dismissed] Unknown `certification_type` silently dropped from history — `CertificationRead.certification_type` is typed `string` (not the narrowed `CertificationType` union), so a value other than `'technical'`/`'methodological'` falls through both `if` branches in `groupByVersion` and is discarded. **Dismissed (Developer, 2026-06-27):** the data contract only ever emits the two known types; the `string` typing is the smell but no code change warranted now. [src/features/certification/components/CertificationHistory.tsx:50-58]
- [x] [Review][Dismissed] Duplicate same-type+version cert silently overwrites — when two same-type records share a `skill_version`, the last-in-iteration (newest by `certified_at ASC`) wins. **Dismissed (Developer, 2026-06-27):** unreachable — the backend records one row per (version, type), so two same-type certs for one version cannot occur. [src/features/certification/components/CertificationHistory.tsx:50-58]
- [x] [Review][Patch] `toUTCStr` catch is dead code — "Invalid Date" can render on the Part 11 signature line — `new Date(badIso).toUTCString()` returns the string `"Invalid Date"` instead of throwing, so the `try/catch` never fired and the literal text "Invalid Date" could reach the regulatory e-signature manifestation line on any malformed `certified_at`. **FIXED (2026-06-27):** replaced the dead try/catch with an explicit `Number.isNaN(new Date(iso).getTime())` validity check that falls back to the raw `iso`. Typecheck clean; 11 CertificationHistory tests pass. [src/features/certification/components/CertificationHistory.tsx:22-28]
- [x] [Review][Defer] Re-cert badge + history read only the first 200 cert records — beyond `per_page:200` history rows silently truncate with no "showing first 200 of N" indicator, AND the `needsRecert` computation in SkillDetail reads only page 1, so a skill with >200 certs whose current-version certs fall on a later page would falsely show "Requires re-certification". [src/features/skills/components/SkillDetail.tsx:362-366; src/features/certification/components/CertificationHistory.tsx:121] — deferred, known cap (story Trap 2 / D3 accept 200 as the Phase-1 bound; >100 versions is out of scope). Defer reason: spec-sanctioned cap (D3); add pagination/truncation-indicator when a skill realistically approaches 200 cert records.
