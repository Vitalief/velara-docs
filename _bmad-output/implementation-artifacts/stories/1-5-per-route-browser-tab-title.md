---
baseline_commit: f471895d4c006ffb627e5541e2fe7c01506b9080
---

# Story 1.5: Per-Route Browser Tab Title

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief user with several Velara tabs open,
I want the browser tab title to reflect the current page (and entity, where applicable),
so that I can tell my open tabs apart at a glance instead of seeing a generic label.

> Added 2026-06-08 (see `planning-artifacts/sprint-change-proposal-2026-06-08.md`). App-shell behavior — **static page titles ship now**; **dynamic entity-name titles** (Project/Study/Location) are wired by Epic 4 screens when they land. This story delivers the shared mechanism + every static title that exists today, and leaves a documented, tested seam for entity titles. **Do NOT fabricate entity-detail pages** — they do not exist yet (Epic 4). Scope is `velara-web` only; no `velara-api` changes.

## Acceptance Criteria

1. **Static top-level titles** — When I navigate to any top-level page, `document.title` is set to `"{Page} · Velara"` (e.g., `Skill Registry · Velara`, `Certification · Velara`, `Audit Log · Velara`, `Usage & Value · Velara`) — replacing the generic title baked into `index.html` by the Story 1.2 scaffold.
2. **Entity-detail titles (seam only this story)** — When I navigate to a hierarchy entity detail (Project, Study, or Location) and the entity has loaded, the title is `"{Entity Name} · {Type} · Velara"` (e.g., `Protocol Feasibility · Study · Velara`). *Those pages arrive in Epic 4; this story delivers and unit-tests the mechanism that produces that exact string, not the pages.*
3. **Loading fallback** — While an entity detail is still loading (name not yet available), the title falls back to `"{Type} · Velara"` (e.g., `Study · Velara`) — never blank or stale. *(Tested at the hook level; consumed by Epic 4.)*
4. **One shared mechanism** — Every page sets its title through the **same** shared hook (`useDocumentTitle` / `usePageTitle`) — **not** hand-rolled `document.title =` assignments scattered ad-hoc per page. Each page *owns its title value*; the *mechanism* is singular and shared. The title updates on every React Router navigation.
5. **Client portal isolation** — Under `/client/*`, titles follow the same pattern scoped to client-visible pages — **no internal-only labels leak** into the client tab title.

## Tasks / Subtasks

- [x] **T1 — Create the shared title hook** (AC: 1, 2, 3, 4)
  - [x] Create `src/shared/hooks/useDocumentTitle.ts` exporting:
    - `BRAND = 'Velara'` (SCREAMING_SNAKE_CASE constant).
    - `buildTitle(...parts: Array<string | undefined | null>): string` — pure helper; filters out falsy parts, appends `BRAND`, joins with `' · '` (**U+00B7 MIDDLE DOT** — the exact separator in the AppBar wordmark and `index.html`). `buildTitle('Skill Registry')` → `"Skill Registry · Velara"`; `buildTitle('Protocol Feasibility', 'Study')` → `"Protocol Feasibility · Study · Velara"`; `buildTitle(undefined, 'Study')` → `"Study · Velara"`; `buildTitle()` → `"Velara"`.
    - `useDocumentTitle(title: string): void` — a `useEffect([title])` that sets `document.title = title`. Idempotent (safe under StrictMode double-invoke); no cleanup/restore (the next page overwrites).
    - `usePageTitle(...parts: Array<string | undefined | null>): void` — convenience wrapper: `useDocumentTitle(buildTitle(...parts))`. **This is the function pages call.**
  - [x] **No central route→title map, no `useLocation`-driven resolver, no `react-helmet`/`react-helmet-async`.** Per-page ownership via the hook is the chosen mechanism (see Dev Notes › Mechanism decision). No new dependencies — `react`/`react-router-dom` only.
  - [x] TS conventions: `camelCase.ts` filename for a hook; `useDocumentTitle`/`usePageTitle`/`buildTitle` camelCase; `BRAND` SCREAMING_SNAKE_CASE. [Source: architecture/implementation-patterns-consistency-rules.md#Naming Patterns]
- [x] **T2 — Apply titles per route in the internal shell** (AC: 1, 4)
  - [x] The internal routes currently render placeholder `<div>`s (`Skills — Story 3.x`, etc.). Add a tiny co-located `Placeholder` component in `src/routes/internal.tsx` that owns its title:
    ```tsx
    function Placeholder({ title, children }: { title: string; children: ReactNode }) {
      usePageTitle(title)
      return <div>{children}</div>
    }
    ```
    Then give each route its title at the route declaration (title sits next to the element — per-page ownership, no separate map):
    - `engagements/*` → `<Placeholder title="Engagements">Engagements — Story 2.x</Placeholder>`
    - `skills/*` → `title="Skill Registry"`  ⚠️ route path is `skills`, NOT `registry` (see Dev Notes)
    - `certification/*` → `title="Certification"`
    - `access/*` → `title="Access Control"`
    - `analytics` → `title="Usage & Value"`  ⚠️ differs from the current NavTabs label "Analytics" (see Dev Notes)
    - `audit/*` → `title="Audit Log"`
  - [x] The `index` route `<Navigate to="engagements" replace />` needs no title — it immediately redirects to a titled route.
  - [x] When a real page component lands in a later epic, **it** calls `usePageTitle('Skill Registry')` and the `Placeholder` wrapper is dropped. (Document this in the `Placeholder` doc comment.)
- [x] **T3 — Apply titles in the client shell + login page** (AC: 1, 4, 5)
  - [x] `src/routes/client.tsx`: wrap the `dashboard` placeholder with `title="Dashboard"` (reuse a local `Placeholder` of the same shape, or lift a shared one — keep it simple; a second tiny local component is fine). Client titles are declared independently of internal ones, so no internal label can leak (AC5 satisfied structurally).
  - [x] `src/pages/LoginPage.tsx`: call `usePageTitle('Sign In')` near the top of the component → `"Sign In · Velara"` (LoginPage's heading is "Sign in"; keep page + tab aligned). LoginPage is rendered directly by `App.tsx`, outside both shells, so it owns its own title. Do **not** disturb the Story 1.4 login logic.
- [x] **T4 — Document the Epic 4 entity-title seam** (AC: 2, 3)
  - [x] Add a doc comment in `useDocumentTitle.ts` showing the pattern Epic 4 entity pages will use: `usePageTitle(entity?.name, 'Study')` — yields `"{Name} · Study · Velara"` once loaded and `"Study · Velara"` while `entity` is undefined (falsy first part is filtered by `buildTitle`). Do NOT create entity pages or routes.
- [x] **T5 — Tests (co-located, vitest + jsdom + Testing Library)** (AC: 1, 2, 3, 4, 5)
  - [x] `src/shared/hooks/useDocumentTitle.test.tsx`: (a) `buildTitle` unit cases for all four shapes in T1 (page; entity-loaded; entity-loading→`"Study · Velara"`; empty→`"Velara"`); (b) a component calling `usePageTitle('Skill Registry')` asserts `document.title === 'Skill Registry · Velara'`; (c) re-render with new parts updates `document.title`.
  - [x] `src/routes/internal.test.tsx` (extend): authenticated render at `/internal/skills` → assert `document.title === 'Skill Registry · Velara'`; at `/internal/audit` → `'Audit Log · Velara'`. Reuse the existing `renderAt` + `_mockAuthSession` harness already in that file.
  - [x] `src/routes/client.test.tsx` (extend): assert a client route sets a client title and that **no** internal label (e.g. `Skill Registry`) appears in `document.title`.
  - [x] Follow the existing harness exactly: `MemoryRouter initialEntries={[path]}`, `_mockAuthSession('test-token')` for guarded routes, `beforeEach(_clearAuthSession)`. [Source: src/routes/internal.test.tsx]
- [x] **T6 — Verify green gates** (AC: all)
  - [x] `npm run typecheck` → 0 errors; `npm run lint` clean; `npm run test` all pass (no regression in existing AppBar/route/Login/auth/sentry tests); `npm run build` clean.
  - [x] Manual smoke (`npm run dev`): tab title changes across Engagements → Skill Registry → Certification → Access Control → Usage & Value → Audit Log, and on the login page, with no console errors.

### Review Findings

_Adversarial code review 2026-06-09 (Blind Hunter + Edge-Case Hunter + Acceptance Auditor). Auditor verdict: AC1–AC5 all SATISFIED, no AC violations. Findings below are test-quality hardening (patch) and pre-existing/out-of-scope items (deferred)._

- [x] [Review][Patch] Tests never reset `document.title`, so exact-equality and negative assertions trust render order [src/test/setup.ts:5] — shared `afterEach` only runs `cleanup()` + `sessionStorage.clear()`; route/login title tests rely on each render overwriting the global. A "route renders but never calls `usePageTitle`" regression could pass on a leaked value. **✅ Fixed 2026-06-09:** added `document.title = ''` to the shared `afterEach`. (sources: blind+edge)
- [x] [Review][Patch] Client "no internal label leaks" test is a weak negative assertion that passes for the wrong reason [src/routes/client.test.tsx:38] — `/client/dashboard` never produces internal strings, so `not.toContain('Skill Registry'|…)` cannot fail on a real regression. **✅ Fixed 2026-06-09:** test now seeds `document.title = 'Skill Registry · Velara'`, renders the client route, and asserts it actively changes to `'Dashboard · Velara'` before the no-leak checks (AC5 now has teeth). (source: blind)
- [x] [Review][Patch] LoginPage `usePageTitle('Sign In')` is the only call site with no test [src/pages/LoginPage.test.tsx] — 8 tests, zero assert `document.title`; every other call site is covered. **✅ Fixed 2026-06-09:** added a `'Sign In · Velara'` assertion (suite now 49 tests, all green; typecheck + lint clean). (source: blind)
- [x] [Review][Defer] No catch-all route + no unmount cleanup → unmatched URLs keep a stale/default title [src/routes/internal.tsx, src/shared/hooks/useDocumentTitle.ts:21] — deferred, pre-existing. Explicitly acknowledged in this story's "Unknown-route edge" Dev Note; the `NotFound` route is tracked in deferred-work.md and will call `usePageTitle('Not Found')`. (sources: edge+blind)
- [x] [Review][Defer] `analytics` route uses `path="analytics"` (no `/*`) while siblings use `/*`, so `/internal/analytics/sub` won't match → stale title [src/routes/internal.tsx:49] — deferred, pre-existing (this change only wrapped the existing element). (source: edge)
- [x] [Review][Defer] NavTabs clicks don't navigate (local `useState`) and tab id `registry` ≠ route `skills`, so active-tab/title can desync and title-on-nav will break once tabs are wired [src/routes/internal.tsx:24, src/shared/components/NavTabs.tsx] — deferred, pre-existing router/NavTabs design noted in Dev Notes. (source: edge)
- [x] [Review][Defer] `buildTitle` doesn't trim whitespace-only parts (`'  '` → `'    · Velara'`) [src/shared/hooks/useDocumentTitle.ts:15] — deferred; latent Epic-4 hardening for untrusted `entity.name`, no current consumer. (source: edge)
- [x] [Review][Defer] Index `<Navigate>` redirect routes have no title assertion (`/internal`, `/client`, `/`) [src/routes/internal.test.tsx, src/routes/client.test.tsx] — deferred; leaf targets already tested, low-value coverage add. (sources: blind+edge)

## Dev Notes

### Mechanism decision (chosen 2026-06-09)
Per-page custom titles via a **shared `useDocumentTitle` / `usePageTitle` hook** — each page (or, for today's placeholders, each route element) owns its own title string. Rejected alternatives:
- **Central route→title map driven by `useLocation()`** — one map to maintain, but it rots against route changes and recreates exactly the kind of label/path drift documented below (`registry`↔`skills`, "Analytics"↔"Usage & Value"). Per-page ownership keeps the title next to the thing it names.
- **`react-helmet` / `react-helmet-async`** — adds a runtime dependency. The original `react-helmet` is broken on React 18+/StrictMode; the async fork works but is **redundant on React 19**, which natively hoists `<title>`. Against this repo's no-unnecessary-deps / self-host ethos. Not used.
- **React 19 native `<title>` element** — also dependency-free and viable, but the team chose the explicit hook (trivially unit-testable in isolation, no reliance on render-time metadata hoisting, one obvious call site per page). If a page ever needs other `<head>` tags, React 19 native rendering is still available alongside.

### What this story is — and is NOT
- **IS:** one reusable `useDocumentTitle`/`usePageTitle` hook + `buildTitle` helper, called by each route element / login page, with tests. Satisfies AC1, AC4, AC5 fully and AC2/AC3 **at the mechanism level**.
- **IS NOT:** entity-detail pages. Project/Study/Location detail screens are **Epic 4** (`4-2`, `4-3`, `4-4` — all `backlog`) and do not exist in `src/` today (`features/engagements/components/` is just a `.gitkeep`). AC2/AC3 describe the string the hook must produce; prove it with hook unit tests, then leave the seam for Epic 4 to call. **Creating placeholder entity pages just to "satisfy" AC2/AC3 is scope creep and a regression risk — do not.**

### AC4 reading (so the acceptance auditor doesn't misread "per page")
"One shared mechanism … not duplicated ad-hoc per page" = **every page uses the same hook**; nobody hand-writes `document.title = …`. Pages legitimately differ in the *title value* they pass — that's ownership, not duplication. The shared, singular thing is the hook.

### Routing architecture — relevant constraint
- `velara-web` uses **`<BrowserRouter>` + descendant `<Routes>`** (`App.tsx` → `routes/internal.tsx` / `routes/client.tsx`), **NOT** a data router (`createBrowserRouter`/`RouterProvider`). [Source: src/App.tsx, src/routes/internal.tsx] So the React Router 7 route-`handle`/`useMatches` title pattern is unavailable — but the chosen per-page hook doesn't need it. Do not refactor to a data router for this story.
- `react-router-dom@^7` + `react@^19` are already installed — **no new packages**.

### Human labels per route (easy to get wrong — read carefully)
Set the human label on each route element, not the `NavTabs` tab id (which is local UI state, disconnected from the router — note the `useState('engagements')` in `InternalShell`). Two specific traps:
- The route is **`skills/*`** but the NavTabs id is `registry` (label "Skill Registry"). Title = **`Skill Registry · Velara`** on the `skills` route. [Source: src/shared/components/NavTabs.tsx vs src/routes/internal.tsx]
- The NavTabs label for `analytics` is "Analytics", but the AC (and Epic 9's rename to "Usage & Value Analytics") specify the **tab title** `Usage & Value · Velara`. Use **`Usage & Value`** on the `analytics` route. **Do not change the `NavTabs` label in this story** — cosmetic nav chrome is out of scope; only `document.title` is in scope.

### Separator & brand string
- Use **`·` (U+00B7 MIDDLE DOT)**, single space each side — identical to the AppBar wordmark (`src/shared/components/AppBar.tsx:55`) and `index.html`'s `<title>`. Not a hyphen, not a bullet (•).
- `index.html` ships `<title>Velara · A Vitalief Skills Platform</title>` — only the pre-hydration default; the hook overrides it once a route renders. You do **not** need to edit `index.html` (the descriptive default is a fine no-JS fallback). AC1's "generic 'Velara' label" refers to the absence of per-page titles, which the hook resolves.

### Unknown-route edge (honest scope note)
There is no catch-all `path="*"` 404 route (open item in `deferred-work.md`). With per-page ownership, an unmatched URL renders no page and therefore sets no title, so `document.title` keeps the `index.html` default (or the prior page's title on a client-side nav to an unknown path). This is acceptable for this story; when the deferred `NotFound` route is added it will call `usePageTitle('Not Found')`. Do **not** add a 404 route here (out of scope).

### Source tree — files to touch
- **NEW** `src/shared/hooks/useDocumentTitle.ts` — `BRAND`, `buildTitle`, `useDocumentTitle`, `usePageTitle`.
- **NEW** `src/shared/hooks/useDocumentTitle.test.tsx` — co-located tests.
- **UPDATE** `src/routes/internal.tsx` — add the `Placeholder` wrapper (calls `usePageTitle`) and a `title` on each route element. Import `ReactNode` from `react`. Preserve AppBar, NavTabs, the local `activeTab` state, the auth wrapper, and all routes.
- **UPDATE** `src/routes/client.tsx` — titled `dashboard` placeholder; preserve `RequireAuth` + existing routes.
- **UPDATE** `src/pages/LoginPage.tsx` — one `usePageTitle('Sign In')` call; leave Story 1.4 login logic untouched.
- **UPDATE** `src/routes/internal.test.tsx`, `src/routes/client.test.tsx` — extend with title assertions using the existing harness.
- `src/shared/hooks/` is a new directory — additive, consistent with the per-feature `features/*/hooks/` convention. [Source: architecture/project-structure-boundaries.md] Variance noted in Project Structure Notes.

### Existing behavior to preserve (regression guardrails)
- `InternalShell` keeps its local `activeTab` `useState` + `AppBar`/`NavTabs` render — you only **add** titled placeholders. [Source: src/routes/internal.tsx]
- `LoginPage` is rendered directly by `App.tsx` (outside the shells) — it must set its own title; the shells never run for `/login`. [Source: src/App.tsx:21-22]
- Root `/` immediately `<Navigate>`s to `/internal/engagements` — no title there; the engagements route sets it post-redirect. [Source: src/App.tsx:19]

### House conventions (TypeScript / velara-web)
- `camelCase` vars/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants. Files: `PascalCase.tsx` components, `camelCase.ts` utils/hooks. [Source: architecture/implementation-patterns-consistency-rules.md#Naming Patterns]
- Path alias `@/` → `src/` works in tsconfig/vite/vitest (defined three ways — a known smell in `deferred-work.md`, but functional). Import as `@/shared/hooks/useDocumentTitle`.
- Tests **co-located** with source. [Source: implementation-patterns-consistency-rules.md#Structure Patterns]

### Testing standards
- Vitest + jsdom + `@testing-library/react`, `globals: true`, setup `src/test/setup.ts` (auto `cleanup()` + `sessionStorage.clear()` after each test). [Source: vitest.config.ts, src/test/setup.ts]
- jsdom gives a writable `document.title`, so `expect(document.title).toBe('Skill Registry · Velara')` works directly.
- Guarded routes: `_mockAuthSession('test-token')` before render, `_clearAuthSession()` in `beforeEach`. [Source: src/routes/internal.test.tsx]
- StrictMode double-invokes effects in dev — the hook is an idempotent assignment, so harmless; don't add per-render side effects beyond the title set.

### Previous Story Intelligence (1.4 — Dev Authentication Shim, done)
- 1.4 exported the test helpers `_mockAuthSession` / `_clearAuthSession` (from `@/shared/utils/auth`) the route tests rely on — reuse, don't reinvent. [Source: stories/1-4-dev-authentication-shim.md#File List]
- 1.4's `LoginPage.tsx` heading is **"Sign in"** (tests assert `getByRole('heading', { name: /sign in/i })`); aligning the login title to `Sign In · Velara` keeps page + tab consistent. [Source: src/routes/internal.test.tsx:24]
- 1.4 review = adversarial (Blind Hunter + Edge-Case Hunter + Acceptance Auditor), every AC verified. Make the AC2/AC3 hook unit tests explicit and self-evidently mapped so the auditor confirms "mechanism delivered, entity pages correctly deferred."

### Git Intelligence
- Two commits exist: `Intial Commit with Frontend Scaffolding` and `1-4-dev-authentication-shim`. The frontend is freshly scaffolded; the conventions above (descendant routes, co-located vitest, `@/` alias, self-hosted/no-CDN) are the entire established pattern set — follow them. [Source: `git log`]

### Latest Tech Information
- **React 19** natively hoists `<title>`; we deliberately use the explicit hook instead (see Mechanism decision) — no `react-helmet*` dependency. Setting `document.title` in an effect is the standard approach for this CSR-only app and needs nothing from React 19's metadata feature. [Source: package.json]

### Project Structure Notes
- **Variance (intentional):** introduces `src/shared/hooks/` — not enumerated in `architecture/project-structure-boundaries.md` (which lists `shared/components`, `shared/utils`, `shared/design-tokens`). A shared hook doesn't belong in `utils` (pure functions); `shared/hooks/` mirrors the established `features/*/hooks/` convention and is the idiomatic home. Net-new, additive, no conflict.
- All other paths align with the documented structure (`routes/`, `pages/`, co-located tests).

### References
- [Source: planning-artifacts/epics/epic-1-platform-foundation-local-dev-environment.md#Story 1.5] — story statement + 5 ACs
- [Source: planning-artifacts/sprint-change-proposal-2026-06-08.md] — origin of this story (static-now/entity-later split)
- [Source: src/App.tsx] — top-level router; login outside shells; root redirect
- [Source: src/routes/internal.tsx] — `InternalShell`, descendant `<Routes>`, route paths (`skills`, `access`, `analytics`, `audit`, …)
- [Source: src/routes/client.tsx] — client tree, `dashboard` route
- [Source: src/shared/components/NavTabs.tsx] — tab-id↔label↔route-path mismatches (`registry`→`skills`, "Analytics"→"Usage & Value")
- [Source: src/shared/components/AppBar.tsx:55] — `·` separator + "Velara" wordmark
- [Source: src/routes/internal.test.tsx] — test harness (`renderAt`, `MemoryRouter`, `_mockAuthSession`)
- [Source: vitest.config.ts, src/test/setup.ts] — vitest/jsdom config
- [Source: architecture/implementation-patterns-consistency-rules.md] — TS naming, co-located tests, structure
- [Source: architecture/project-structure-boundaries.md] — `shared/` layout (basis for the `shared/hooks/` variance)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — no catch-all 404 route (unknown-route note)
- [Source: stories/1-4-dev-authentication-shim.md] — prior patterns, auth test helpers, login heading

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- Created `src/shared/hooks/useDocumentTitle.ts` with `BRAND`, `buildTitle`, `useDocumentTitle`, `usePageTitle`. Pure `buildTitle` helper filters falsy parts and joins with U+00B7 middle dot. Hook uses `useEffect([title])` — idempotent, no restore. Epic 4 entity-title seam documented in JSDoc.
- Updated `src/routes/internal.tsx`: added local `Placeholder` component that calls `usePageTitle(title)`; each of 6 routes now wrapped with its correct human label (`Skill Registry` on `skills/*`, `Usage & Value` on `analytics`, etc.).
- Updated `src/routes/client.tsx`: added matching local `Placeholder`; `dashboard` route titled `Dashboard`. Client titles declared independently — no internal label can leak (AC5).
- Updated `src/pages/LoginPage.tsx`: added `usePageTitle('Sign In')` call at component top; login logic from Story 1.4 untouched.
- All 5 ACs satisfied: static titles (AC1), entity-title mechanism + seam tests (AC2/AC3), one shared hook (AC4), client portal isolation (AC5).
- 48 tests pass (8 new in `useDocumentTitle.test.tsx`, 6 new in `internal.test.tsx`, 2 new in `client.test.tsx`); 0 regressions. Typecheck, lint, and build all clean.

### File List

- src/shared/hooks/useDocumentTitle.ts (NEW)
- src/shared/hooks/useDocumentTitle.test.tsx (NEW)
- src/routes/internal.tsx (MODIFIED)
- src/routes/client.tsx (MODIFIED)
- src/pages/LoginPage.tsx (MODIFIED)
- src/routes/internal.test.tsx (MODIFIED)
- src/routes/client.test.tsx (MODIFIED)

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-09 | Story created. Context-engine analysis against Epic 1 (Story 1.5 ACs), the live `velara-web` router (descendant `<Routes>`, not a data router), NavTabs/route-path mismatches, the 1.4 auth test harness, and `deferred-work.md`. Key scoping decision: deliver the shared title mechanism + all static titles now; satisfy entity-title ACs (2/3) at the hook level and defer the entity *pages* to Epic 4 (do not fabricate them). |
| 2026-06-09 | Mechanism revised per team decision: **per-page ownership via a shared `useDocumentTitle`/`usePageTitle` hook**, dropping the central route→title map. Rejected `react-helmet`/`react-helmet-async` (redundant on React 19, adds a dep) and the `useLocation` map (drifts against route changes). No new dependencies. |
| 2026-06-09 | Implementation complete. Created `useDocumentTitle.ts` hook + co-located tests; applied titles to all internal routes, client dashboard, and LoginPage via `Placeholder` wrapper pattern. All 48 tests pass, typecheck/lint/build clean. Status → review. |
