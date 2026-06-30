# Story 2.4: Skill Registry UI — Browse & Detail

---
baseline_commit: 95479e9f623409bc2a0c1fea2ff211ddb86c7caf
---

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Repository:** This is a **`velara-web`** (frontend) story. All implementation paths below are relative to `/Users/apple/Projects/AI/velara/velara-web`, **not** the `velara-api` working directory. It consumes the Skill Registry REST API delivered in Stories 2.1–2.3 (`velara-api`); no backend changes are in scope.

## Story

As a Vitalief consultant,
I want to browse all skills in the registry with filtering by lifecycle state, visibility, runtime type, and tags, and view a skill's full detail,
so that I can discover available skills and understand their capabilities before invoking or certifying them.

## Acceptance Criteria

1. **Browse list.** Given I navigate to the Skill Registry tab, when the page loads, then all skills visible to my role are displayed as a **table** (matching the `design/` prototype layout) with rows showing: name, lifecycle-state badge, visibility badge, runtime type, and author. Each row is clickable → opens that skill's detail.
2. **Filter by lifecycle state.** Given I filter by `status=internal_ready`, when the filter is applied, then only `internal_ready` skills are shown. (Filtering also supported for visibility, runtime type, and tags.)
3. **Detail view.** Given I click on a skill card, when the detail view opens, then I see: full metadata, current version, description, input/output schema, lifecycle state/history, and — for paired skills — the lineage link.
4. **Client visibility (out of scope here).** Given a skill has `visibility: "internal_only"`, when a client-scoped user views the registry, then this skill does not appear — **enforced in Epic 8, NOT this story.** The internal (Vitalief team) view shows all skills.
5. **Run button (deferred to Epic 5).** Given I am on a skill detail view, when I click the "Run" button, then the Run Console opens in skill-first mode with this skill pre-selected — **the Run Console is implemented in Epic 5.** This story renders the button in a clearly-disabled "coming soon" state.
6. **⌘K search.** Given I search the registry using ⌘K, when I type a skill name or tag, then matching skills appear as suggestions and selecting one opens its detail view.

---

## Tasks / Subtasks

- [x] **Task 1 — API client + types** (AC: 1, 2, 3, 6)
  - [x] Define TypeScript types in `src/features/skills/types.ts` matching the API **exactly** (snake_case field names + enum string values — see Dev Notes §"API contract"). Types: `Skill` (list shape = `SkillRead`), `SkillWithVersion` (detail shape = `SkillReadWithVersion`, adds `current_version` + `lineage`), `SkillVersionSummary`, `Lineage`, `DerivedFrom`, `DerivedSkillRef`. Export the enum union types: `LifecycleState`, `RuntimeType`, `Visibility`, `Scope`.
  - [x] Implement `src/api/skills.ts` (currently a `export {}` stub): `listSkills(params?: { status?; tag? }): Promise<Skill[]>` and `getSkill(skillId: string): Promise<SkillWithVersion>`. Use the shared `apiClient` from `@/api/client`. **Unwrap the envelope** — read `response.data.data` (success envelope is `{ data, meta }`).
- [x] **Task 2 — TanStack Query hooks** (AC: 1, 2, 3)
  - [x] `src/features/skills/hooks/useSkills.ts`: `useSkills()` → `useQuery({ queryKey: ['skills'], queryFn: () => listSkills() })` (fetch full list once; filter client-side — see Dev Notes §Filtering). `useSkill(skillId)` → `useQuery({ queryKey: ['skills', skillId], queryFn: () => getSkill(skillId), enabled: !!skillId })`.
- [x] **Task 3 — Badge / chip components** (AC: 1, 3)
  - [x] `src/features/skills/components/SkillLifecycleBadge.tsx` — pill badge mapping each `lifecycle_state` to label + status color tokens (see Dev Notes §"Badge styling"). Map snake_case API value → human label (`internal_ready` → "Internal-ready").
  - [x] `VisibilityChip` + `RuntimeTypeChip` (co-locate in `SkillLifecycleBadge.tsx` or a `SkillBadges.tsx`) — icon + label for `internal_only`/`paired`/`client_facing` and `prompt`/`code`/`hybrid`.
- [x] **Task 4 — Registry browse view (table)** (AC: 1, 2)
  - [x] `src/features/skills/components/SkillRow.tsx` — a clickable table row (`<tr>`) for one skill: **Skill** (name + monospace id), **Type** (runtime-type chip), **Visibility** (visibility chip), **State** (lifecycle badge), **Author**, and a trailing chevron. Navigates to `/internal/skills/:skillId` on click (`useNavigate`). _(Replaces the architecture's planned `SkillCard.tsx` — see Project Structure Notes.)_
  - [x] `src/features/skills/components/SkillRegistry.tsx` — calls `usePageTitle('Skill Registry')`; renders a filter bar (segmented controls for State, Type, Visibility + a tag/text search input) above a **table** (`<table>` with header row: Skill · Type · Visibility · State · Author · ›) whose body maps the filtered `useSkills()` list to `SkillRow`s. Match the prototype's `.tbl` look using Tailwind/brand tokens (uppercase faint header on `bg-surface-2`, row hover `bg-brand-50`, hairline `border-line` row separators). Loading → skeleton rows; error → `getErrorMessage`; empty/no-match → empty-state row. Apply all four filters client-side over the fetched list.
- [x] **Task 5 — Skill detail view** (AC: 3, 5)
  - [x] `src/features/skills/components/SkillDetail.tsx` — reads `:skillId` (`useParams`), calls `useSkill(skillId)`, calls `usePageTitle(skill?.name, 'Skill')`. Sections: header (name, lifecycle badge, visibility chip, runtime chip, author, created/updated); **Definition** (runtime_type, scope, tags, input_schema + output_schema rendered as formatted JSON); **Version** (current_version: version, content_type, artifact_checksum, created_at); **Lineage** (only when `lineage.derived_from` or `lineage.derived_skills` present — render links to related skills); a back link / breadcrumb to the registry; and a **disabled "Run" button** with a "Available in the Run Console (coming soon)" tooltip/label.
  - [x] Handle `404 SKILL_NOT_FOUND` (deleted/wrong-org id) with a friendly not-found panel + back link.
- [x] **Task 6 — Route wiring** (AC: 1, 3)
  - [x] In `src/routes/internal.tsx`, replace the `skills/*` `Placeholder` with real nested routes: index → `<SkillRegistry />`, `:skillId` → `<SkillDetail />`. Remove the `Placeholder` wrapper for skills (each component owns its own `usePageTitle`).
  - [x] **Wire NavTabs to the router** so AC1 ("navigate to the Skill Registry tab") works: clicking a tab must navigate, and the active tab must derive from the current URL. Add a `path` to each `NavTab` and use `useNavigate` + `useLocation` in the shell (or NavTabs). **Resolve the known `registry`-id vs `skills`-path mismatch** (deferred-work.md line 36): map the `registry` tab to the `/internal/skills` path (do not introduce a `/internal/registry` route). Keep the other tabs pointing at their existing placeholder paths so nothing regresses.
- [x] **Task 7 — ⌘K command palette search** (AC: 6)
  - [x] Upgrade the stub `CmdPalette` in `src/shared/components/AppBar.tsx` (it currently renders "coming soon"): on open, load skills (reuse `useSkills()` / the `['skills']` query), filter by typed name **or** tag, render up to ~6 matching skills as selectable suggestions, and on select navigate to `/internal/skills/:skillId` and close. Preserve the existing ⌘K/Escape keyboard handling already in AppBar.
- [x] **Task 8 — Tests** (AC: 1–3, 6)
  - [x] Co-located Vitest + Testing-Library tests: `SkillRegistry.test.tsx` (renders table rows from mocked list; State filter narrows results — AC2; empty state), `SkillDetail.test.tsx` (renders metadata/version/schema; lineage block shows only for paired/derived; Run button is disabled — AC5), `SkillLifecycleBadge.test.tsx` (label/colour per state), `hooks/useSkills.test.tsx`, and an `internal.test.tsx` update asserting `/internal/skills` and `/internal/skills/:id` render and that the Skill Registry tab navigates.
- [x] **Task 9 — Gates**
  - [x] `npm run typecheck` (0 errors), `npm run lint` (clean), `npm run test` (all pass, 0 regressions to the existing ~49 tests), `npm run build` (clean).

---

## Dev Notes

### Critical: API field names ≠ design-prototype field names

The design prototype (`design/`) is the **visual** reference, but its `data.js` uses **different field names and enum casing** than the real API. **Bind the UI to the API contract below, NOT to the prototype's data shape.** Mapping you must apply:

| Prototype (`data.js`) | Real API (`SkillRead`) | Notes |
|---|---|---|
| `state` (`'client-ready'`, kebab) | `lifecycle_state` (`'client_ready'`, snake) | rename + recase |
| `type` | `runtime_type` | |
| `desc` | `description` | |
| `visibility` (`'internal-only'`) | `visibility` (`'internal_only'`) | recase |
| `modified` / `created` | `updated_at` / `created_at` | ISO datetimes |
| `version` (string) | `current_version.version` (detail only) | |
| `parentId` / `lineageChildId` | `lineage.derived_from` / `lineage.derived_skills` | detail only |
| `tech` / `method` / `versions` / `runs` | **not in API** | certification (Epic 6), versions history, usage (Epic 9) — **out of scope** |

### Scope guardrails — what NOT to build

The prototype's skill detail is feature-rich (two-key certification panel, Versions timeline with recert, Usage analytics, Access tab, working Run button, a stat strip with invocation counts). **Most of that is later epics. For 2.4, build only what the ACs require:**

- **Build:** browse cards + filters, detail with metadata/current-version/schema/lineage, ⌘K skill search, NavTabs→router wiring, disabled Run button.
- **Do NOT build:** two-key certification UI (Epic 6), version-history / recert timeline, usage/analytics tab (Epic 9), access tab (Epic 8), create/edit forms (Story 2.5), invocation-count stat strip (needs usage data — Epic 9), client-visibility filtering (Epic 8). Don't fabricate data the API doesn't return.

### API contract (from Stories 2.1–2.3 — `velara-api/app/api/v1/skills.py`, `schemas/skill.py`)

**Success envelope (all endpoints):** `{ "data": <payload>, "meta": { "request_id", "timestamp" } }` → always read `response.data.data`.
**Error envelope:** `{ "error": { "code": "SCREAMING_SNAKE", "message", "request_id" } }`.

**`GET /api/v1/skills`** → `data` is a **flat array** of `SkillRead` (no pagination envelope yet — see "Pagination" below). Ordered by `created_at` desc. Server-side query params: `status` (one of the lifecycle enum values; invalid → `422 VALIDATION_ERROR`) and `tag` (case-sensitive exact match). **There is no server-side `visibility` or `runtime_type` filter** — those must be applied client-side.

**`GET /api/v1/skills/{skill_id}`** → `data` is `SkillReadWithVersion`. `404 SKILL_NOT_FOUND` if missing or different org (org-scoped; never 403).

**`SkillRead` (list item):**
```
id: uuid               name: string            description: string | null
author: string         runtime_type: "prompt"|"code"|"hybrid"
visibility: "internal_only"|"paired"|"client_facing"
lifecycle_state: "draft"|"internal_ready"|"client_ready"|"retired"
scope: "project"|"study"|null
input_schema: object|null   output_schema: object|null   tags: string[]
paired_with: uuid|null      derived_from: object|null     review_required: boolean
org_id: string         created_by_user_id: string   current_version_id: uuid|null
created_at: ISO8601     updated_at: ISO8601
```

**`SkillReadWithVersion` (detail) adds:**
```
current_version: { id, skill_id, version, artifact_checksum, content_type,
                   created_by_user_id, created_at } | null      # NO content field — artifact lives in S3
lineage: {
  derived_from: { parent_skill_id: uuid, parent_version: semver } | null,
  derived_skills: [ { skill_id: uuid, visibility, lifecycle_state }, ... ]
} | null
```

Enum unions for `types.ts`:
- `LifecycleState = 'draft' | 'internal_ready' | 'client_ready' | 'retired'`
- `RuntimeType = 'prompt' | 'code' | 'hybrid'`
- `Visibility = 'internal_only' | 'paired' | 'client_facing'`
- `Scope = 'project' | 'study' | null`

**Lineage rendering:** show the lineage block only when `lineage.derived_from` (this is a derived child → link to parent) **or** `lineage.derived_skills.length > 0` (this is a paired parent → link to each child). `derived_skills` is identifiers-only (no names) by design (IP protection) — render each as a link to `/internal/skills/:skill_id` labelled by id/visibility/state; the destination detail fetch resolves the name.

### AC3 "lifecycle history" — known gap (read this)

The API exposes the **current** `lifecycle_state` but **no lifecycle-history / state-transition read endpoint or field** exists yet. Do **not** fabricate a history timeline. Render what the API actually provides: the current lifecycle badge plus a minimal "timeline" from real fields — `created_at`, `updated_at`, and `current_version.{version, created_at}`. A true per-transition history depends on an endpoint not yet built (audit trail lands in Epic 9). See the open question at the end of this story.

### Filtering approach

The list endpoint returns a flat array (no pagination) and only supports `status`/`tag` server-side. **Simplest correct approach for Phase-1 volumes:** fetch the full list once via `useSkills()` and apply **all four** filters (State, Type, Visibility, tag/text) **client-side** in `SkillRegistry`. This keeps the UI snappy (no refetch per filter), matches the prototype's in-memory filtering, and avoids the missing server-side visibility/runtime filters. Text search matches name + tags (and optionally description). Server-side `status`/`tag` params remain available if a future story needs them.

### Existing shell integration — verified facts

- **Routing** (`src/App.tsx`): `BrowserRouter` → `/internal/*` → `InternalRoutes` (wraps `RequireAuth` → `InternalShell`). `InternalShell` renders `<AppBar />` + `<NavTabs>` + a descendant `<Routes>` (NOT a data router). The `skills/*` route currently renders `<Placeholder title="Skill Registry">Skills — Story 3.x</Placeholder>` — replace it. Nested detail routing works under the existing `skills/*` splat.
- **NavTabs** (`src/shared/components/NavTabs.tsx`): tabs are `{id,label}` with `id: 'registry'` for "Skill Registry". `InternalShell` holds `activeTab` in local `useState('engagements')` and **`onTabChange` only sets state — it does not navigate.** Wiring this to the router is **in scope** (AC1) and was explicitly deferred to this story (deferred-work.md line 36). Resolve the `registry`-id ≠ `skills`-path mismatch by mapping the tab to `/internal/skills`.
- **AppBar** (`src/shared/components/AppBar.tsx`): already implements the ⌘K/Ctrl-K + Escape `keydown` handler and the navy "Search ⌘K" button (internal role only). The `CmdPalette` it renders is a **stub** ("Command palette — coming soon"). Upgrade that component for AC6 — keep the keyboard handling.
- **API client** (`src/api/client.ts`): pre-built Axios instance, `baseURL = import.meta.env.VITE_API_URL`, request interceptor attaches `Authorization: Bearer <token>` (from `@/shared/utils/auth`) + `X-Request-ID`; response interceptor redirects to `/login` on 401. Use it — don't create another axios instance.
- **Query client** (`src/api/queryClient.ts`): `staleTime 30s`, `retry 1`, `refetchOnWindowFocus false`. Provider is already mounted in `App.tsx`.
- **Auth (dev):** dev-auth JWT shim (Story 1.4) issues an HS256 Bearer token with claims `sub`/`org_id`/`role`; the interceptor sends it automatically. No frontend auth work needed.

### Badge / chip styling (V3 tokens — `src/index.css` `@theme`)

Use the lifecycle status tokens already in the theme (added in Story 1.6). The prototype's `STATE_META` mapping, recased to API values:

| `lifecycle_state` | Label | Text / bg / border tokens |
|---|---|---|
| `draft` | Draft | `st-draft` family (grey `#828a96`) |
| `internal_ready` | Internal-ready | `st-internal` family (slate/navy `#4C5270`) |
| `client_ready` | Client-ready | `st-client` family (teal `#128F8B`) |
| `retired` | Retired | `st-retired` family (warm grey `#998d86`) |

Visibility chips: `internal_only` → "Internal-only" (lock icon), `paired` → "Paired" (layers), `client_facing` → "Client-facing" (eye). Runtime chips: `prompt`/`code`/`hybrid` → "Prompt"/"Code"/"Hybrid". Brand utilities are `brand-*` (NOT `green-*` — renamed in 1.6; using `green-*` silently falls back to Tailwind's built-in green). Surfaces `bg-surface`/`bg-paper`, text `text-ink`/`text-ink-2`/`text-muted`/`text-faint`, borders `border-line`. Cards: `rounded-lg border border-line bg-surface`.

### Conventions (hard rules)

- **Imports:** always `@/...` alias, never relative (`tsconfig` `@/* → src/*`).
- **Titles:** every routed page calls `usePageTitle(...)` once (`@/shared/hooks/useDocumentTitle`); detail uses `usePageTitle(skill?.name, 'Skill')` so it reads `<name> · Skill · Velara`. Pattern set in Story 1.5.
- **Feature-first structure:** components in `src/features/skills/components/`, hooks in `.../hooks/`, types in `.../types.ts` (folder already scaffolded with `.gitkeep`s + `export {}` types stub).
- **Errors:** unwrap via `getErrorMessage` (`@/shared/utils/errors.ts`). For known error codes (`SKILL_NOT_FOUND`), branch on `error.response?.data?.error?.code` for friendlier messaging.
- **Stores:** role from `useRoleStore` (`@/stores/useRoleStore`) — internal vs client. This story targets the internal view.

### Project Structure Notes

New (all under `velara-web/`):
```
src/features/skills/
├── types.ts                              (replace export {})
├── components/
│   ├── SkillRegistry.tsx  + .test.tsx
│   ├── SkillRow.tsx                       (table row; replaces planned SkillCard.tsx)
│   ├── SkillDetail.tsx    + .test.tsx
│   └── SkillLifecycleBadge.tsx + .test.tsx   (incl. Visibility/Runtime chips)
└── hooks/
    └── useSkills.ts       + useSkills.test.tsx
```
Modified: `src/api/skills.ts` (implement), `src/routes/internal.tsx` (real routes + tab→router wiring), `src/shared/components/AppBar.tsx` (CmdPalette → skill search), possibly `src/shared/components/NavTabs.tsx` (add `path`, navigate).

**Table layout (decided):** render the registry as a **table matching the `design/` prototype**, not cards. This intentionally replaces the architecture's planned `SkillCard.tsx` component with `SkillRow.tsx`; keep the other planned component names (`SkillRegistry`, `SkillDetail`, `SkillLifecycleBadge`, `hooks/useSkills`). **Drop the prototype's `Version` and `Runs` table columns** — the list endpoint (`SkillRead`) returns neither a version string (only `current_version_id`; the version string is detail-only) nor usage counts (usage = Epic 9). Keep the columns that map to AC1 list fields: Skill · Type · Visibility · State · Author (+ chevron). The prototype's top stat strip (Total / Client-ready / In-cert / Invocations) is likewise out of scope (needs usage + certification data).

### Tooling / versions (`package.json`)

React 19, React Router 7 (`react-router-dom`), TanStack Query 5, Zustand 5, Axios 1.7, Tailwind 4 (`@tailwindcss/vite`, theme in `src/index.css`), TypeScript 5.5 (strict), Vitest 2 + Testing-Library 16 (jsdom, globals on; setup `src/test/setup.ts` resets `document.title`). Scripts: `dev`, `build`, `test` (`vitest run`), `test:watch`, `lint` (`eslint src --ext .ts,.tsx`), `typecheck` (`tsc --noEmit`).

### Testing standards

Co-locate `*.test.tsx` beside source. Globals enabled (no import of `describe/it/expect`). Mock the API by mocking the hook module or `@/api/skills` (`vi.mock`); for router-dependent components render inside `<MemoryRouter>` and mock auth via `_mockAuthSession` (see `src/routes/internal.test.tsx`). Query by role/text; assert filter behaviour by rendering a known list and checking which cards remain after a filter interaction (AC2). Keep the existing ~49 tests green.

### Previous-story intelligence

- **1.5 (titles/routing):** the descendant-`<Routes>` structure, the `Placeholder`-wrapper pattern (drop it when a real page lands and call `usePageTitle` directly), and the explicit note that NavTabs doesn't navigate yet. Reuse `usePageTitle`; do not add `react-helmet` (rejected — redundant on React 19).
- **1.6 (V3 theme):** brand utilities were renamed `green-*` → `brand-*`; status tokens (`st-draft/internal/client/retired`) and fonts (Poppins headings via `font-serif`, Open Sans body via `font-sans`) are in place. Use `brand-*` and the `st-*` tokens; never reintroduce `green-*`.
- **2.1–2.3 (API):** description is required (blank → `422 MISSING_DESCRIPTION`); `current_version` carries no `content` (S3-backed); `derived_skills` is identifiers-only; `paired_with` is a non-authoritative convenience pointer (nulled once a parent has >1 child) — use `lineage` for relationships, not `paired_with`.

### Pagination (deferred, but be aware)

`GET /api/v1/skills` returns an unbounded flat array and the detail lineage query is unbounded; code review of 2.3 explicitly tagged registry pagination for **"Story 2.4/2.5"** (deferred-work.md line 57). For this story, client-side rendering of the full list is acceptable for Phase-1 volumes. Do not block on building pagination; if you add infinite scroll or windowing, keep it client-side and note it. Server-side pagination remains a future enhancement.

### References

- [epic-2-skill-registry-lifecycle.md — Story 2.4](../../planning-artifacts/epics/epic-2-skill-registry-lifecycle.md)
- [PRD §13 Design Reference](../../planning-artifacts/prds/prd-Velara-2026-05-29/prd/13-design-reference.md) — prototype is the canonical visual ref (`design/`)
- [architecture — Frontend Architecture](../../planning-artifacts/architecture/core-architectural-decisions.md) (Zustand, TanStack Query, React Router, feature-first, Tailwind+V3 tokens)
- [architecture — Project Structure: velara-web](../../planning-artifacts/architecture/project-structure-boundaries.md) (`features/skills/` layout, REG-01–09 mapping)
- API source: `velara-api/app/api/v1/skills.py`, `app/schemas/skill.py`, `app/schemas/common.py`, `app/models/skill.py`
- Existing shell: `velara-web/src/routes/internal.tsx`, `src/shared/components/{AppBar,NavTabs}.tsx`, `src/api/{client,queryClient}.ts`, `src/index.css`
- [deferred-work.md](../deferred-work.md) — lines 36 (NavTabs→router wiring, tab-id/path mismatch) and 57 (registry pagination), both routed to this story

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Story creation: claude-opus-4-8)

### Debug Log References

- Badge text appears in both filter buttons and table rows — required `getAllByText` instead of `getByText` in `SkillRegistry.test.tsx` (lifecycle badges) and `SkillDetail.test.tsx` (version chip and lifecycle badge).
- Author rendered as "By {author}" in detail header — test regex `/Dr\. Smith/` used instead of exact text match.
- TanStack Query 5 tightened `UseQueryResult` type — required `as unknown as ReturnType<typeof useSkill>` double-cast in test mocks.
- `react-refresh/only-export-components` lint warning: moved `TABS` constant + `NavTab` interface from `NavTabs.tsx` into a co-located `navTabsData.ts` file; updated imports in `NavTabs.tsx` and `internal.tsx`.

### Completion Notes List

- All 9 Tasks (16 subtasks) complete. All ACs satisfied.
- AC1 (table browse): `SkillRegistry.tsx` renders a table with `SkillRow` rows; header columns Skill · Type · Visibility · State · Author · ›; loading skeleton; empty/error states.
- AC2 (filter by lifecycle): segmented controls for State, Type, Visibility + text/tag search input; all filters applied client-side over `useSkills()` result.
- AC3 (detail view): `SkillDetail.tsx` shows full metadata, Definition (schema JSON), Version, Lifecycle (current state + timestamps), and conditional Lineage card.
- AC5 (Run button deferred): button renders disabled with "Coming soon" label; Run Console is Epic 5.
- AC6 (⌘K search): `CmdPalette` in `AppBar.tsx` upgraded to load skills, filter by name/tag, render up to 6 results, navigate on select.
- NavTabs→router wiring (deferred-work.md line 36): resolved by adding `path` field to each tab and `useActiveTab()` hook in `InternalShell`; `registry` id correctly maps to `skills` path.
- `navTabsData.ts` introduced to satisfy `react-refresh/only-export-components` lint rule.
- Final gate results: typecheck 0 errors, lint 0 errors, test 91/91 pass, build clean.

### File List

**New files (velara-web):**
- `src/features/skills/types.ts`
- `src/api/skills.ts`
- `src/features/skills/hooks/useSkills.ts`
- `src/features/skills/hooks/useSkills.test.tsx`
- `src/features/skills/components/SkillLifecycleBadge.tsx`
- `src/features/skills/components/SkillLifecycleBadge.test.tsx`
- `src/features/skills/components/SkillRow.tsx`
- `src/features/skills/components/SkillRegistry.tsx`
- `src/features/skills/components/SkillRegistry.test.tsx`
- `src/features/skills/components/SkillDetail.tsx`
- `src/features/skills/components/SkillDetail.test.tsx`
- `src/shared/components/navTabsData.ts`

**Modified files (velara-web):**
- `src/shared/components/NavTabs.tsx` — added `path` field; extracted TABS to `navTabsData.ts`
- `src/routes/internal.tsx` — real `SkillRegistry`/`SkillDetail` routes; NavTabs→router wiring
- `src/shared/components/AppBar.tsx` — upgraded `CmdPalette` to skill search
- `src/routes/internal.test.tsx` — added `QueryClientProvider`, mocked `useSkills`/`useSkill`, 3 new tests

## Change Log

| Date       | Change |
|------------|--------|
| 2026-06-10 | Story created. Context-engine analysis across: Epic 2 Story 2.4 ACs; the live `velara-web` shell (descendant `<Routes>`, AppBar ⌘K stub, NavTabs local-state non-navigation, `api/client`/`queryClient`, V3 `@theme` tokens); the 2.1–2.3 API contract (`SkillRead`/`SkillReadWithVersion`, envelope, enums, error codes); the `design/` prototype (visual ref) with an explicit field-name/casing mapping; and deferred-work.md (NavTabs→router wiring + registry pagination both routed here). Key scoping decisions: build table+filters / detail (metadata/version/schema/lineage) / ⌘K skill search / disabled Run button; defer certification, versions-history, usage, access, client-visibility, and create/edit to their owning epics; flag "lifecycle history" as a real API gap (render current state + version/timestamps, do not fabricate). Status → ready-for-dev. |
| 2026-06-10 | Refined per author: registry renders as the **prototype table** (not cards) — `SkillRow.tsx` replaces planned `SkillCard.tsx`; dropped Version/Runs columns + stat strip (not in list API). Lifecycle-history fallback (current state + timestamps) confirmed acceptable. |

---

### Review Findings

_Adversarial code review (Blind Hunter · Edge Case Hunter · Acceptance Auditor) — 2026-06-10, baseline `95479e9`. All 6 ACs verified **SATISFIED** (AC4 correctly deferred to Epic 8). Outcome: 2 patch, 2 defer, 7 dismissed as noise._

**Patch (actionable now):**

- [x] [Review][Patch] SkillRow `<tr>` is click-only — no keyboard access path [src/features/skills/components/SkillRow.tsx:13] — **FIXED 2026-06-10:** added `tabIndex={0}`, `onKeyDown` (Enter/Space → navigate), `focus-visible` styling, and `aria-label`. — The row is the sole navigation affordance to a skill's detail (the name is not a link, the chevron is decorative), yet the clickable `<tr>` has only `onClick`; no `tabIndex`, no `onKeyDown` (Enter/Space), and `role="row"`. Keyboard-only users cannot focus or open any skill detail, so AC1's "each row is clickable → opens detail" is mouse-only. Fix: add `tabIndex={0}` + an `onKeyDown` (Enter/Space → navigate) and an accessible name/role. _(blind, High confidence)_
- [x] [Review][Patch] Visibility "Paired" and Runtime "Hybrid" chips share the same ⚡ glyph [src/features/skills/components/SkillLifecycleBadge.tsx:71,94] — **FIXED 2026-06-10:** paired chip now uses a distinct `⧉` (layers) glyph. — `VIS_META.paired.icon` and `RUNTIME_META.hybrid.icon` are both `⚡`, so a paired skill renders two identical icons; Dev Notes §"Badge styling" specifies a distinct "layers" icon for paired. Low-severity visual-fidelity fix: give paired a distinct glyph. _(auditor, High confidence)_

**Deferred (real, but pre-existing / out of this story's scope):**

- [x] [Review][Defer] Non-404 API errors render a developer-facing message in Skill views [src/shared/utils/errors.ts] — deferred, pre-existing. `getErrorMessage` is still a stub that only unwraps `Error.message`, so a 500/network failure surfaces raw axios text (e.g. "Request failed with status code 500") in `SkillDetail`/`SkillRegistry`. The `SKILL_NOT_FOUND` branch is correct; only the generic-error fallback is affected. The stub is a shared cross-cutting util from an earlier story — hardening it is out of scope for 2.4. _(edge)_
- [x] [Review][Defer] No catch-all route under `/internal/*`; skills splat narrowed to exact paths [src/routes/internal.tsx:57-58] — deferred, pre-existing. The change replaced `skills/*` (wildcard) with exact `skills` + `skills/:skillId`, so a malformed deep link like `/internal/skills/<id>/extra` now renders a blank `<main>` (no app-wide `path="*"` 404 exists). No in-app link produces such a path; a global not-found page is a separate concern. _(edge)_

**Dismissed as noise (7):** CmdPalette "esc" badge with no handler (FALSE POSITIVE — `AppBar.tsx:118` handles Escape); useActiveTab tab↔route mismatch (NO DEFECT — all six tab `path`s verified matching their `<Route>`s); Invalid-Date rendering (API contract guarantees ISO8601 non-null `created_at`/`updated_at`); CmdPalette fetch vs. "no extra request" comment (behavior is the intended fetch-once-then-client-filter per Dev Notes); whitespace-only `name` title (name is required non-empty); duplicate version in Lifecycle + Version cards (within AC3 "minimal timeline from real fields" guidance); stale test comment re header version chip (test passes, no defect).
