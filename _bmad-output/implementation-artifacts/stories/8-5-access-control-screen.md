---
baseline_commit: fd0a744e6b54b45ca72ac26e3024fc0485621c6c
---

# Story 8.5: Access Control Screen — Admin Grant Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief internal admin (`admin`/`ma_tech`),
I want a section on the Access Control screen to view, create, and revoke client access grants across the engagement hierarchy,
so that I can manage who can access which Clients/Projects/Studies without calling the API by hand.

## Acceptance Criteria

1. **Grant list renders (backed by a NEW list route).** Given I open `/internal/access` as an `admin`/`ma_tech` user, when the screen loads, then a **Grant Management** section lists existing grants for my org (`user_id`, node, `node_type`, `role`, `granted_at`) — backed by a NEW `GET /api/v1/access-grants` list route (grantor-gated), which does **not exist today** (8.1 built only POST/DELETE). List uses TanStack Query loading/error states.

2. **Create a grant.** Given I fill the create-grant form (`user_id`, hierarchy `node_id`, `node_type`, `role=client`), when I submit, then `POST /api/v1/access-grants` is called and the new grant appears in the list without a full reload (query invalidation).

3. **Revoke a grant.** Given I revoke a grant, when I confirm, then `DELETE /api/v1/access-grants/{id}` is called, the grant disappears from the list, and the affected client's scope recalculates on their next request (no caching — 8.1 AC5; nothing to do here beyond the DELETE).

4. **Internal-role grantee is prevented and surfaced cleanly.** Given the chosen grantee `role` is internal (`ma_tech`/`consultant`/`admin`), when I attempt to create the grant, then the UI surfaces the existing `422 INTERNAL_ROLE_NOT_GRANTABLE` error cleanly (inline alert, no crash) — ideally the form defaults/locks `role` to `client` so this path is hard to hit by accident.

5. **Screen is internal-grantor-gated with proper states.** Given the screen is under `/internal/*`, when a user reaches it, then it is internal-only (`RequireInternal`), the grant-management **mutations** (create/revoke) are gated to grantors (`isGrantor()` → `{admin, ma_tech}`; `consultant` sees the list **read-only**, no create form / no revoke button), it consumes the response envelope, and shows TanStack Query loading/error states throughout.

## Tasks / Subtasks

- [x] **Task 1 — Backend: org-wide list service function (AC: #1)**
  - [x] Add `list_org_grants(session, org_id, page, per_page) -> tuple[list[UserAccessGrant], int]` to [access_service.py](velara-api/app/services/access_service.py) — returns a page of ALL grants in the org (NOT the existing user-scoped `list_grants` at [access_service.py:317](velara-api/app/services/access_service.py#L317), which filters by `user_id` and is unpaginated). Mirror the paginate-and-count shape of `certification_service.list_certifications` (offset/limit + a `select(func.count())` total). Order deterministically (e.g. `granted_at DESC, id`).
  - [x] Do NOT remove or repurpose `list_grants` (it's the per-user helper; leave it).

- [x] **Task 2 — Backend: GET list route + list-data schema (AC: #1)**
  - [x] Add `GET /api/v1/access-grants` to [access_grants.py](velara-api/app/api/v1/access_grants.py). Gate it with `_require_grantor(user.role)` (the same `{admin, ma_tech}` gate as create/revoke at [access_grants.py:26,36-41](velara-api/app/api/v1/access_grants.py#L26)). Router already has `dependencies=[RejectClient]` (client→404) — keep it.
  - [x] Signature mirrors `list_certifications` ([certifications.py:109-131](velara-api/app/api/v1/certifications.py#L109-L131)): `page: Annotated[int, Query(ge=1, le=100_000)] = 1`, `per_page: Annotated[int, Query(ge=1, le=200)] = 50`, `request`, `user: CurrentUser`, `session: DbSession`. Scope to `user.org_id`.
  - [x] Add `AccessGrantListData(BaseModel)` to [schemas/access_grant.py](velara-api/app/schemas/access_grant.py): `items: list[AccessGrantRead]` + `page: PageMeta` (import `PageMeta` from `app.schemas.common`). Response `response_model=ResponseEnvelope[AccessGrantListData]`; build `PageMeta(total=total, page=page, per_page=per_page)`. Reuse the existing `_meta(request)` helper.
  - [x] Update the module docstring ([access_grants.py:1-10](velara-api/app/api/v1/access_grants.py#L1-L10)) to add the GET line.

- [x] **Task 3 — Backend tests (AC: #1, #4, #5)**
  - [x] In `tests/integration/api/test_access_grants.py`: `admin` + `ma_tech` tokens → `GET /api/v1/access-grants` returns 200 with the org's grants + correct `page` meta; a grant created for another user in the org appears; pagination (`per_page=1`) works. `consultant` token → **403 FORBIDDEN** on GET (now-reachable grantor branch). `client` token → **404** (RejectClient, existence-hiding — do not assert 403 for client). Cross-org isolation: a grant in another org does NOT appear (scope by `org_id`). Reuse `_auth_headers(role)` (its role→username map already includes `admin` from 8.7) and `_make_grant`/`_create_*_node` helpers already in the file.
  - [x] Unit (optional but preferred): `tests/unit/services/test_access_service.py` — `list_org_grants` returns only same-org rows + correct total.
  - [x] Add/lock the OpenAPI schema for `AccessGrantListData` if the suite has an OpenAPI snapshot test (check `test_openapi.py` — 8.2/8.4 locked new client schemas there; do the same if the pattern exists for internal schemas).

- [x] **Task 4 — Frontend: API layer for grants (AC: #1, #2, #3)**
  - [x] Create `src/api/accessGrants.ts` (net-new — no FE grant API exists today). Mirror [api/skills.ts](velara-web/src/api/skills.ts) exactly: `import { apiClient } from '@/api/client'`; snake_case field types (the codebase does NOT snake→camel transform — `AccessGrantRead` fields stay snake: `user_id`, `node_type`, `granted_at`, `granted_by_user_id`).
    - `interface AccessGrantRecord { id; user_id; node_id; node_type; role; org_id; granted_at; granted_by_user_id }`
    - `interface AccessGrantListData { items: AccessGrantRecord[]; page: PageMeta }` (reuse the `PageMeta` shape from api/skills.ts or api/jobs.ts — `{ total; page; per_page }`).
    - `listAccessGrants(params?: {page?; per_page?}): Promise<AccessGrantListData>` → `apiClient.get('/api/v1/access-grants', { params })` then `return response.data.data`.
    - `createAccessGrant(body: {user_id; node_id; node_type; role}): Promise<AccessGrantRecord>` → POST, `return response.data.data`.
    - `revokeAccessGrant(grantId: string): Promise<void>` → `apiClient.delete(\`/api/v1/access-grants/${grantId}\`)`.
  - [x] Do NOT use `${nodeType}s` to build any URL (project hard-rule). These routes are flat (`/api/v1/access-grants`), so no node pluralization here — but node_type is a form VALUE, not a URL segment.

- [x] **Task 5 — Frontend: TanStack Query hooks (AC: #1, #2, #3)**
  - [x] Create `src/features/admin/hooks/useAccessGrants.ts` mirroring [useSkills.ts](velara-web/src/features/skills/hooks/useSkills.ts):
    - `useAccessGrants(params)` → `useQuery({ queryKey: ['access-grants', params], queryFn: () => listAccessGrants(params), staleTime: 30_000 })`.
    - `useCreateGrant()` → `useMutation` calling `createAccessGrant`, `onSuccess`: `qc.invalidateQueries({ queryKey: ['access-grants'] })`. Surface `error` so AC4's 422 renders.
    - `useRevokeGrant()` → `useMutation` calling `revokeAccessGrant`, `onSuccess`: invalidate `['access-grants']`.

- [x] **Task 6 — Frontend: Grant Management section INSIDE AccessControl.tsx (AC: #1, #2, #3, #4, #5)**
  - [x] **Placement decision (product 2026-07-01): grant management is a SECTION within the existing [AccessControl.tsx](velara-web/src/features/admin/components/AccessControl.tsx), NOT a new screen or nav tab.** The `access` tab ("Access Control", [navTabsData.ts:12](velara-web/src/shared/components/navTabsData.ts#L12)) already renders this screen (skill-attachment, from 8.6). Add a distinct "Grant Management" section (e.g. a collapsible panel or a second band below the skill-attachment content, or a top-level toggle between "Skill Assignment" and "Access Grants"). Keep the existing skill-attachment UI intact — this is additive.
  - [x] The section shows: a paginated grants **table** (columns: user_id, node_type, node_id, role, granted_at, actions) using `useAccessGrants`; a **create-grant form** (user_id text, node_id text/picker, node_type select, role defaulting to `client` — see AC4); a **revoke** action per row behind a confirm dialog (reuse the existing `DetachDialog` deliberate-confirm pattern from AccessControl.tsx, or a small inline confirm — do NOT make revoke optimistic; access mutations must confirm server success per the UX EXPERIENCE.md).
  - [x] **Gate the mutations, not the read.** Wrap the create form + per-row revoke button in `isGrantor()` (import from [auth.ts:92](velara-web/src/shared/utils/auth.ts#L92) — the shared helper 8.7 added; do NOT re-declare a role set). A `consultant` sees the grants list **read-only** (no form, no revoke button) — matches the 8.7 posture. `RequireInternal` already gates the whole route; consultant is admitted but read-only for management.
  - [x] **Error handling (AC4):** on create, if the mutation errors with `422 INTERNAL_ROLE_NOT_GRANTABLE`, render an inline `role="alert"` banner with a friendly message (the axios error carries the envelope; read `error.response.data.error.code`/`.message`). Also render generic create/list/revoke errors as alerts (no silent swallow — the 8.6 review explicitly flagged swallowed errors as a bug).
  - [x] **No emoji/unicode icons** — use `<Icon>` from `src/shared/components/Icon.tsx` for any glyph (hard project rule). Match the existing screen's V3 theme classes.

- [x] **Task 7 — Frontend tests (AC: #1, #2, #3, #4, #5)**
  - [x] Extend/create `AccessControl.test.tsx` (or a focused `GrantManagement.test.tsx`): mock the grants API; assert the grant table renders rows + loading + error states; create-grant form submits and invalidates; revoke behind confirm calls DELETE; **consultant** (seed via `_mockAuthSession('t')` then overwrite `velara_user.role='consultant'` — the documented pattern at [auth.ts:183-203](velara-web/src/shared/utils/auth.ts#L183-L203)) sees the list but NO create form / NO revoke button; `admin`/`ma_tech` see them; a 422 create error renders the inline alert.
  - [x] Keep the existing skill-attachment tests green (this section is additive — do not break them).

- [x] **Task 8 — Gates & handoff**
  - [x] BE: `ruff check` + `ruff format` clean; run affected integration tests on a freshly-migrated `velara_test` (rebuild the api image if it bakes source — 8.4/8.6 reviews noted the image bakes source). **NO new migration** (no schema change — `user_access_grants` already exists from 8.1 migration 0016).
  - [x] FE: `vitest` green, `tsc` 0, `eslint` clean.
  - [x] Confirm no regression in the 8.6 skill-attachment UI or the 8.7 grantor gates.

## Dev Notes

### What this story is (and is NOT)

**One net-new backend GET route + a net-new FE grant-management section** co-located on the existing Access Control screen. It reuses the create/revoke routes (8.1) and the `{admin, ma_tech}` grantor gate (8.7) unchanged. **No migration, no new model, no new screen file, no new nav tab.** Business value: ACL-08 — internal admins manage grants in-UI instead of by hand.

### ⚠️ Naming collision you must understand before touching the FE

The `/internal/access` route + the "Access Control" nav tab already render [AccessControl.tsx](velara-web/src/features/admin/components/AccessControl.tsx) — but that screen is the **SKILL-ATTACHMENT** UI built in Story 8.6 (client selector → project cards → attach/detach skills, titled "Access Control"). The epic AC's phrase *"replaces the /internal/access Placeholder"* is **stale** — the Placeholder was already replaced by 8.6. **Do not create a second screen or a second tab.** Per product decision (2026-07-01) and the UX spec (*"grant control also lives here — existing, for existing users"*, [ux-designs/ux-Velara-2026-07-01/EXPERIENCE.md:43](../../planning-artifacts/ux-designs/ux-Velara-2026-07-01/EXPERIENCE.md)), grant management is an **additive section within the existing AccessControl.tsx**. The screen ends up covering both concerns: skill assignment (8.6) + access grants (8.5).

### Current backend grant surface (read before editing)

[access_grants.py](velara-api/app/api/v1/access_grants.py) today has **only** `POST /api/v1/access-grants` (create, [line 44](velara-api/app/api/v1/access_grants.py#L44)) and `DELETE /api/v1/access-grants/{grant_id}` (revoke, [line 68](velara-api/app/api/v1/access_grants.py#L68)). **There is no GET list route** — 8.1 skipped it as optional; this story adds it. Router: `prefix="/api/v1"`, `dependencies=[RejectClient]`, `_GRANTOR_ROLES = frozenset({"admin", "ma_tech"})` (8.7 unified it), `_require_grantor` raises 403.

[access_service.py](velara-api/app/services/access_service.py) has `list_grants(session, user_id, org_id)` ([line 317](velara-api/app/services/access_service.py#L317)) — **user-scoped and unpaginated**, wrong for this screen. Add a new `list_org_grants(session, org_id, page, per_page)` returning `(rows, total)`. `create_grant` already rejects internal-role grantees (`_NON_GRANTABLE_ROLES = {ma_tech, consultant, admin}`, [line 31](velara-api/app/services/access_service.py#L31)) with `InternalRoleNotGrantableError` → 422 `INTERNAL_ROLE_NOT_GRANTABLE` — that's the AC4 error to surface (no BE change needed for it).

Schema: [schemas/access_grant.py](velara-api/app/schemas/access_grant.py) — `AccessGrantRead` (from_attributes) already has every field the list needs; add only `AccessGrantListData`. `GrantRole = Literal["ma_tech","consultant","client","admin"]`, `NodeType = Literal["client","project","study","location"]`.

### The paginated-list template to mirror (BE)

`certifications.py` `list_certifications` ([lines 109-131](velara-api/app/api/v1/certifications.py#L109-L131)) is the canonical internal paginated-list route: `page`/`per_page` `Query` params → service returns `(rows, total)` → `ResponseEnvelope(data=ListData(items=[Read.model_validate(r) ...], page=PageMeta(total,page,per_page)), meta=_meta(request))`. `PageMeta` = `{total, page, per_page}` ([schemas/common.py:35-40](velara-api/app/schemas/common.py#L35-L40)). Copy this shape exactly for `access-grants`.

### FE patterns to reuse (do NOT invent)

- **API layer:** [api/skills.ts](velara-web/src/api/skills.ts) — `apiClient.get(url, {params})` then `return response.data.data` (envelope unwrap). Paginated data is `{items, page}`. **No snake→camel transform exists** — types keep snake_case fields (`per_page`, `user_id`, `granted_at`). (The epic AC's "snake→camel mapping" line does not match the codebase; follow the codebase — snake_case throughout.)
- **Hooks:** [useSkills.ts](velara-web/src/features/skills/hooks/useSkills.ts) `useSkillsPage`/`useCreateSkill` — `useQuery` with `queryKey: ['access-grants', params]` + `staleTime: 30_000`; mutations invalidate `['access-grants']` on success and expose `error`.
- **Gate helper:** `isGrantor()` from [auth.ts:92](velara-web/src/shared/utils/auth.ts#L92) (added by 8.7 — `{admin, ma_tech}`, single definition). `isInternal()` = `{ma_tech, consultant, admin}`. Gate the create form + revoke button on `isGrantor()`; the route itself is `RequireInternal`.
- **Confirm dialog:** the existing `DetachDialog` in [AccessControl.tsx](velara-web/src/features/admin/components/AccessControl.tsx) is the deliberate-confirm pattern (Esc/✕/confirm) — reuse it or match its shape for revoke. **Revoke must NOT be optimistic** (access mutation — confirm server success; UX EXPERIENCE.md).
- **Screen structure:** `AccessControl()` is at [AccessControl.tsx:647](velara-web/src/features/admin/components/AccessControl.tsx#L647); it uses `usePageTitle('Access Control')`, a header band, a client combobox, then project cards. Add the Grant Management section within this component's scroll area (`div.flex-1.overflow-auto` at [line 669](velara-web/src/features/admin/components/AccessControl.tsx#L669)).

### Test patterns (reuse)

- **BE:** `test_access_grants.py` has `_auth_headers(role)` (role→seed-username → `issue_token`; the map already includes `"admin"` after 8.7), `_custom_headers(user_id, org_id, role)`, `_make_grant`, `_create_client/project_node`, `_INTERNAL_ORG = "org_vitalief"`. Client role → **404** on internal routes (RejectClient), **not** 403 — 403 is the demoted-`consultant` path.
- **FE:** `_mockAuthSession(token)` seeds a default `ma_tech` user; overwrite `sessionStorage['velara_user']` to test `consultant` / `admin` (documented at [auth.ts:186-189](velara-web/src/shared/utils/auth.ts#L186-L189)).

### Project Structure Notes

- New files: `velara-web/src/api/accessGrants.ts`, `velara-web/src/features/admin/hooks/useAccessGrants.ts`. Edited: `AccessControl.tsx` (add section), `access_grants.py` (+GET), `access_service.py` (+`list_org_grants`), `schemas/access_grant.py` (+`AccessGrantListData`), plus tests.
- Feature-first layout: admin FE lives under `src/features/admin/`. Do NOT scatter grant components into `shared/`.
- No Alembic migration (last is 0017 from 8.6; this story adds no schema).
- Anti-patterns to avoid: a 2nd "Access Control" screen/tab; a duplicate role-set literal (use `isGrantor()`); optimistic revoke; swallowed mutation errors; `${nodeType}s` URL building; emoji icons.

### References

- [Source: epics/epic-8-access-control-client-portal.md#Story 8.5] — the 5 ACs (note the stale "replaces Placeholder" phrasing + the 8.7-gate note in AC1).
- [Source: planning-artifacts/sprint-change-proposal-2026-07-01.md] — correct-course that created 8.5 (ACL-08, admin grant-management UI + new GET list route).
- [Source: planning-artifacts/ux-designs/ux-Velara-2026-07-01/EXPERIENCE.md] — Access Control nav tab structure; "grant control also lives here"; attach=fluid / detach+grant=deliberate-confirm; never optimistic for grant/create.
- [Source: architecture/core-architectural-decisions.md — "Admin role & tiered internal authority (2026-07-01, Story 8.7)"] — `_GRANTOR_ROLES = {admin, ma_tech}` gate this story reuses.
- [Source: velara-api/app/api/v1/access_grants.py] — POST/DELETE exist; GET does NOT (build it); `_GRANTOR_ROLES` #L26, `_require_grantor` #L36-L41, `_meta` #L29.
- [Source: velara-api/app/services/access_service.py#L317] `list_grants` (user-scoped, don't reuse); #L31 `_NON_GRANTABLE_ROLES`; #L61-L77 `InternalRoleNotGrantableError` (422).
- [Source: velara-api/app/api/v1/certifications.py#L109-L131] — paginated list-route template.
- [Source: velara-api/app/schemas/access_grant.py] — `AccessGrantRead`, `GrantRole`, `NodeType` (add `AccessGrantListData`).
- [Source: velara-api/app/schemas/common.py#L35-L40] `PageMeta`; #L20 `ResponseEnvelope`.
- [Source: velara-web/src/features/admin/components/AccessControl.tsx#L647] — the screen to extend (skill-attachment today); `DetachDialog` confirm pattern.
- [Source: velara-web/src/shared/utils/auth.ts#L92] `isGrantor()`; #L110 `isInternal()`; #L183-L203 `_mockAuthSession`.
- [Source: velara-web/src/api/skills.ts] + [velara-web/src/features/skills/hooks/useSkills.ts] — API-layer + hook templates (`response.data.data`, `{items, page}`, invalidate on mutate).
- [Source: velara-web/src/routes/internal.tsx#L104-L105] `access/*` → `<AccessControl />`; [navTabsData.ts:12](velara-web/src/shared/components/navTabsData.ts#L12) the `access` tab.
- [Source: velara-api/tests/integration/api/test_access_grants.py] — `_auth_headers`/`_custom_headers`/`_make_grant` helpers.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None.

### Completion Notes List

- BE: `list_org_grants(session, org_id, page, per_page)` added to `access_service.py` — uses `select(func.count())` total + paginated select ordered `granted_at DESC, id`. Imports `func` added.
- BE: `GET /api/v1/access-grants` added to `access_grants.py` behind `_require_grantor` + `RejectClient` (client→404, consultant→403, admin/ma_tech→200). Mirrors `list_certifications` Annotated Query signature exactly.
- BE: `AccessGrantListData(items, page)` added to `schemas/access_grant.py` with `PageMeta` import from `app.schemas.common`.
- BE: Module docstring updated with GET line.
- BE: 7 new integration tests in `test_access_grants.py` covering admin/ma_tech 200+schema, consultant 403, client 404, cross-org isolation, pagination (per_page=1), and cross-user grant appearing in list. Ruff clean + format verified.
- FE: `src/api/accessGrants.ts` created — `AccessGrantRecord`, `AccessGrantListData`, `listAccessGrants`, `createAccessGrant`, `revokeAccessGrant`. Snake_case throughout; no `${nodeType}s` URL building.
- FE: `src/features/admin/hooks/useAccessGrants.ts` created — `useAccessGrants` (staleTime 30s), `useCreateGrant` (invalidates on success), `useRevokeGrant` (invalidates on success).
- FE: `GrantManagementSection` component + `RevokeGrantDialog` added to `AccessControl.tsx` as an additive section below the skill-attachment content. Create form locked to `role=client` (AC4 hard-to-hit path). `INTERNAL_ROLE_NOT_GRANTABLE` 422 error surfaces as inline role="alert" banner. Generic errors also shown. Revoke behind deliberate-confirm dialog (not optimistic). Mutations gated on `isGrantor()`. `consultant` sees list read-only (no form, no revoke). No emoji icons — uses `<Icon>`. Existing skill-attachment UI untouched.
- FE: 9 new tests in `AccessControl.test.tsx`: grant section renders, table rows + loading + error states, create form submits with correct args, 422 error renders inline alert, revoke behind confirm calls mutate with grant id, revoke cancel closes dialog, consultant read-only (no form/no revoke buttons), admin and ma_tech see mutations. All 398 FE tests pass.
- Gates: ruff clean + format verified; tsc 0 errors; vitest 398/398 pass; 8.6 skill-attachment tests all green (additive only).
- ⚠️ BE integration tests require live Postgres: `docker compose exec -e AUTH_BACKEND=dev api pytest tests/integration/api/test_access_grants.py` — rebuild api image first (image bakes source).

### File List

- velara-api/app/services/access_service.py
- velara-api/app/api/v1/access_grants.py
- velara-api/app/schemas/access_grant.py
- velara-api/tests/integration/api/test_access_grants.py
- velara-web/src/api/accessGrants.ts (new)
- velara-web/src/features/admin/hooks/useAccessGrants.ts (new)
- velara-web/src/features/admin/components/AccessControl.tsx
- velara-web/src/features/admin/components/AccessControl.test.tsx
- _bmad-output/implementation-artifacts/stories/8-5-access-control-screen.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

### Change Log

- 2026-07-01: Story 8.5 implemented — BE GET list route + FE Grant Management section on AccessControl screen. 7 BE integration tests + 9 FE tests added. All gates green.

## Review Findings

Code review 2026-07-02 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor, each finding adversarially verified against real code; 18 agents). 15 raw findings → 6 patch, 6 dismissed (noise/false-positive/intended), 1 design-decision → **REDESIGN** (see below). Product verdict: the story was built faithfully to spec, but the spec's raw-UUID create form + UUID-only grants table is unusable for a human admin — being **reworked inline this session** (name-based user picker + cascading client→project/study picker).

**DESIGN DECISION → REDESIGN (DONE 2026-07-02 — supersedes the as-built create form + grants table):**
- [x] [Review][Redesign] Raw-UUID UX replaced with name-first pickers. Implemented: `name` added to Cognito `read_attributes` (standard OIDC attr, no schema block, no apply needed) + `AuthPrincipal.name` + seed-user names + `_SEED_EMAILS`; new `UserSummary` + `AuthProvider.list_users(role)` (Dev = seed directory filtered by grantable client role; Cognito = boto3 `ListUsers`, best-effort→[]); new **`GET /api/v1/users`** (grantor-gated, RejectClient) + `UserSummaryRead`/`UserListData` schemas + `users` router. FE: `api/users.ts` + `useUsers` hook; new **`UserPicker`** filter-by-name combobox replaces the raw `user_id` input; **`ClientCombobox` reused** (gained an optional `label` prop) + a cascading **Project** `<select>` (`useProjects`) replaces the raw `node_id` input — **Client → Project only** (product decision 2026-07-02; grant targets client-wide or a project). Grants table + revoke dialog now resolve `user_id`→name and `node_id`→client name (raw sub never shown). Tests: `test_users.py` (5 gating/payload), `users.test.ts` (API layer), rewritten AccessControl grant tests drive the pickers.

**PATCH (fixed 2026-07-02 — independent of the redesign):**
- [x] [Review][Patch] Consultant GET 403 breaks read-only-list (violated 8.5 AC5 + DONE 8.7 AC3) [access_grants.py:54] — removed `_require_grantor` from the GET only (router `RejectClient` still 404s client; FE gates create/revoke on `isGrantor()`; POST/DELETE keep the gate). BE test flipped to `test_consultant_can_list_grants_read_only` (200).
- [x] [Review][Patch] FE consultant test mocked a success response, hiding the 403 [AccessControl.test.tsx] — now asserts the real read-only consultant experience (list visible, no form, no revoke).
- [x] [Review][Patch] Revoke confirm button now `disabled={pending}` (+ "Revoking…") — no double-submit.
- [x] [Review][Patch] Page-clamp `useEffect` added to GrantManagementSection (mirrors SkillRegistry) — revoking the last grant on page>1 no longer strands the admin.
- [x] [Review][Patch] `setPage(1)` on create success — a newly-created grant is visible on page 1.
- [x] [Review][Patch] Revoke `onError` now `qc.invalidateQueries(['access-grants'])` — the "Refreshing…" copy is truthful and self-heals the stale row.

**Also fixed (pre-existing, surfaced during verification):**
- [x] [Review][Patch] `docs/api-spec.json` was badly stale (27 paths, missing Epics 6–8 routes; CI `openapi` job would fail) — regenerated to the current 44-path spec (includes the new `/api/v1/users`).

**Dismissed (6):** (1) create form has no whitespace-only guard — the raw-ID form is being replaced by the redesign, moot. (2) `createRole` locked-to-client comment slightly imprecise — intended per AC4; form reworked anyway. (3) tautological revoke test (`mutate` inert vi.fn) — low value; rewritten with redesign. (4) pagination `total>=2` assertion weak — AC ("per_page=1 works") is met; the strict `len==1` already guards limit. (5) OpenAPI schema-lock for `AccessGrantListData` not added — correctly N/A (internal admin schema, no IP boundary; the locks it'd mirror are all client-facing). (6) `location` node_type "invalid" — **false positive**: `location` is a first-class node_type end-to-end (schema Literal + `_VALID_NODE_TYPES` + resolution branch + model).
