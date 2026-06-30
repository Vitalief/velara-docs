---
baseline_commit: f90d9f572f76b3bdd6b756192475fb6846dd55f5
---

# Story 4.4: Hierarchy Navigation & Breadcrumb Context

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want clear hierarchy breadcrumbs and a collapsible tree that shows my full engagement context as I navigate,
so that I always know where I am in the hierarchy and can move between entities without losing context.

## Acceptance Criteria

> **BDD source:** [epic-4-engagement-hierarchy-management.md#story-44](../../planning-artifacts/epics/epic-4-engagement-hierarchy-management.md). **FR source:** FR-ORG-06 (Organization layer never shown; paths begin at Client), FR-ORG-07 (Engagements on-screen search — already shipped in 4.2/4.3; ⌘K is the global command-palette surface). **UX:** UX-DR-03 (Unified AppBar carries the context URL + ⌘K search). **Architecture:** core-architectural-decisions.md (Frontend — React Router v6 code-based, Zustand, TanStack Query, Tailwind V3). **Design:** [design/hierarchy.jsx](../../../design/hierarchy.jsx), [design/app_v3.jsx](../../../design/app_v3.jsx) (TopBar `crumbs` + CmdPalette). **API:** built & verified by Story 4.1 (GET-by-id for all four entities exists). **Extends:** Story 4.3 `EngagementsScreen.tsx` + the global `AppBar` ⌘K palette.

**This is a FRONTEND-ONLY story.** The hierarchy API (full CRUD + GET-by-id for clients/projects/studies/locations) was delivered and verified by Story 4.1 (`velara-api`, 522 Docker tests pass). **Do NOT touch any `velara-api` file.** You are: (1) converting the Story-4.3 selection-state-driven Engagements screen to be **URL-routed per entity**, (2) adding a **clickable breadcrumb trail** to each detail view, and (3) extending the **existing global ⌘K command palette** (`AppBar.tsx`) to also find Clients/Projects and navigate to their detail.

### Two locked architectural decisions (read FIRST — these shape every task)

**Decision A — Entity navigation is URL-routed (not selection-state).** Today selection lives in `EngagementsScreen`'s local `sel` useState and the detail panel is a conditional render at a single URL (`/internal/engagements`). For 4.4 we introduce nested routes so each entity is deep-linkable and the breadcrumb segments are real `<Link>`s:
- `/internal/engagements` — tree + empty detail (today's behavior)
- `/internal/engagements/clients/:clientId`
- `/internal/engagements/projects/:projectId`
- `/internal/engagements/studies/:studyId`
- `/internal/engagements/locations/:locationId`

The active entity is derived from the URL param (via `useParams`), **not** from `sel` state. Selecting a tree node / breadcrumb / search hit becomes a `navigate(...)` call. This is a real refactor of the screen — see Task 4 for the exact seam.

**Decision B — ⌘K is the ONE existing global palette in `AppBar.tsx`, extended.** `AppBar.tsx` already owns a global `CmdPalette` (opened by ⌘K everywhere in `/internal/*`) that currently searches **Skills only** and navigates to `/internal/skills/:id`. **Do NOT build a second palette.** Add an **"Engagements" section** (clients + projects from the loaded `['clients']` / `['projects', clientId]` caches) above/below the existing Skills section; selecting one calls `navigate('/internal/engagements/clients/:id'`/`projects/:id')`. Keep the existing Skills section and the existing ⌘K open/close handler intact.

**Scope boundary (read second):**
- **IN scope:** the 5 nested routes above; deriving the active entity from the URL; a clickable breadcrumb trail (`Engagements > Client > Project [> Study [> Location]]`) on every detail view; deep-link resolution (loading an entity + its ancestors when you land cold on a `/studies/:id` URL); tree collapsed-by-default (verify — already true); extending the AppBar ⌘K palette with an Engagements section; keeping all 4.3 CRUD/search/delete behaviors working under the new routing.
- **OUT of scope:** **No backend changes.** No new entity *creation/editing/deleting* flows (4.2/4.3 own those — they must keep working). No server-side search. No skill attachment. No hierarchy-scoped RBAC (Epic 8). No client-portal nav (this is the internal `/internal/*` tree only).

### Acceptance Criteria (BDD)

1. **Project breadcrumb — clickable, no Org label.**
   **Given** I navigate to a Project detail view (`/internal/engagements/projects/:id`)
   **When** the page renders
   **Then** a breadcrumb shows `Engagements > {Client Name} > {Project Name}`; every ancestor segment ("Engagements", the Client) is a clickable link, the current entity (Project) is non-link emphasized text, and **no Organization segment/label appears anywhere**.

2. **Study breadcrumb.**
   **Given** I navigate to a Study detail view (`/internal/engagements/studies/:id`)
   **When** the page renders
   **Then** the breadcrumb shows `Engagements > {Client Name} > {Project Name} > {Study Name}` — ancestor segments clickable, no Organization label.

3. **Location breadcrumb — full path.**
   **Given** I navigate to a Location detail view (`/internal/engagements/locations/:id`)
   **When** the page renders
   **Then** the breadcrumb shows the full path `Engagements > {Client} > {Project} > {Study} > {Location}` — ancestors clickable, no Organization label.

4. **Tree collapsed by default; per-node expand/collapse.**
   **Given** the Engagements tree has many clients
   **When** the screen loads
   **Then** tree nodes are collapsed by default (no client auto-expands), and I can expand/collapse any individual node independently. *(This is already the 4.3 behavior — `expanded` starts as an empty `Set`. Confirm it survives the routing refactor and add/keep a test.)*

5. **⌘K finds a client/project and navigates to its detail.**
   **Given** I press ⌘K (or Ctrl+K) anywhere in the internal app
   **When** I type a client or project name
   **Then** matching Clients and Projects appear as suggestions in an "Engagements" section of the command palette, and selecting one **navigates to that entity's detail route** (`/internal/engagements/clients/:id` or `/projects/:id`) and closes the palette. *(The existing Skills section stays. Studies/locations in ⌘K are optional — see Dev Notes "⌘K scope".)*

6. **Breadcrumb ancestor click navigates to that ancestor's detail.**
   **Given** I am deep in the hierarchy (e.g. a Location detail)
   **When** I click a breadcrumb segment (e.g. the Project)
   **Then** I navigate to that ancestor entity's detail route and its detail panel renders. Clicking "Engagements" returns to the tree-only view (`/internal/engagements`, empty detail).

7. **Deep-link / refresh resolves the full context (regression-critical).**
   **Given** I load a deep URL directly (e.g. paste `/internal/engagements/studies/:id`, or hit refresh there)
   **When** the screen mounts with no pre-loaded cache
   **Then** the entity and its ancestor chain are fetched (GET-by-id walks `study → project → client`), the detail panel and the full breadcrumb render, and the document title reads `{Entity Name} · {Entity Type} · Velara`. A not-found/forbidden id shows a friendly "This item no longer exists." state, not a crash or a blank screen.

## Tasks / Subtasks

- [x] **Task 1 — Add GET-by-id API functions: `src/api/hierarchy.ts` (AC: 7)**
  - [x] Mirror the existing list/create functions exactly (each unwraps `response.data.data`). Add:
  - [x] `getClient(id: string): Promise<Client>` → `apiClient.get('/api/v1/clients/${id}')`
  - [x] `getProject(id: string): Promise<Project>` → `GET /api/v1/projects/${id}`
  - [x] `getStudy(id: string): Promise<Study>` → `GET /api/v1/studies/${id}`
  - [x] `getLocation(id: string): Promise<Location>` → `GET /api/v1/locations/${id}`
  - [x] These already exist on the backend (`get_client`/`get_project`/`get_study`/`get_location` in `app/api/v1/hierarchy.py`, each returning `ResponseEnvelope[…Read]`). A missing/cross-org id returns 404 `{CLIENT,PROJECT,STUDY,LOCATION}_NOT_FOUND` (already in `NOT_FOUND_CODES`).

- [x] **Task 2 — Add single-entity + ancestor-resolution hooks: `src/features/engagements/hooks/useEngagements.ts` (AC: 1, 2, 3, 7)**
  - [x] Query keys follow the established convention. Use a **per-id key** distinct from the list keys: `['client', id]`, `['project', id]`, `['study', id]`, `['location', id]` (singular — the list keys are plural `['projects', clientId]` etc.; do not collide).
  - [x] `useClient(id: string | undefined)` → `useQuery({ queryKey: ['client', id], queryFn: () => getClient(id!), enabled: !!id })`. Same shape for `useProject`, `useStudy`, `useLocation`.
  - [x] **Ancestor resolution (the heart of breadcrumbs + deep-link, AC7):** each entity carries its parent id — `Project.client_id`, `Study.project_id`, `Location.study_id`. Resolve the chain by walking parent ids with the per-id queries. Two acceptable approaches (pick one, document it):
    - **(Recommended) Compose the per-id hooks with `enabled` gating** so each fetch waits on the previous: e.g. for a study route — `const study = useStudy(studyId); const project = useProject(study.data?.project_id); const client = useClient(project.data?.client_id)`. Each downstream query stays disabled until its parent id is known, then fires. TanStack Query dedupes/caches so an already-loaded ancestor is instant. Expose a small helper hook per route (`useStudyContext(studyId)` → `{ study, project, client, isLoading, error }`) to keep `EngagementsScreen` clean.
    - Or a single imperative resolver using `queryClient.fetchQuery` in an effect. The hook-composition approach is preferred (declarative, cache-aware, no effect races).
  - [x] **Do NOT parse `hierarchy_path` to get ancestor ids.** The ltree segments (`org_{uuid}.client_{uuid}.project_{uuid}…`) encode internal Organization-row uuids and are an internal scoping detail (FR-ORG-06 hides the org layer) — the parent-id fields (`client_id`/`project_id`/`study_id`) are the contract. Use them.

- [x] **Task 3 — Add the nested routes: `src/routes/internal.tsx` (AC: 1, 2, 3, 6, 7)**
  - [x] Today there is one engagements route (`<Route path="engagements" element={…EngagementsScreen…} />`, `internal.tsx:60-64`). Replace it with a parent route that renders `EngagementsScreen` and **nested child routes** carrying the entity param, OR keep a single `engagements/*` route and resolve params inside `EngagementsScreen` with a nested `<Routes>`. Recommended: keep one `<Route path="engagements/*" element={<div className="flex h-full flex-col"><EngagementsScreen /></div>} />` and let `EngagementsScreen` own its own `<Routes>`/`useParams` for `clients/:clientId`, `projects/:projectId`, `studies/:studyId`, `locations/:locationId` — this keeps the screen's persistent tree+detail two-panel layout (the tree must NOT remount on entity navigation).
  - [x] **Regression — `useActiveTab` (`internal.tsx:31-37`)** derives the active nav tab from `pathname.split('/')[2]` (the segment after `/internal/`). With the new deeper URLs the segment is still `engagements`, so the Engagements tab stays active — **verify this** (add a test that `/internal/engagements/projects/x` still marks the Engagements tab active).
  - [x] Auth wrapper (`RequireAuth`) and the `AppBar`+`NavTabs` shell already wrap all `/internal/*` — no change needed there beyond the ⌘K extension (Task 6).

- [x] **Task 4 — Refactor `EngagementsScreen.tsx`: URL-derived selection + breadcrumbs (AC: 1–4, 6, 7)**
  - [x] **This is the largest task. Extend in place; do NOT rewrite the tree/detail/modal/search internals** — only change how the *active entity* is determined and add the breadcrumb. The file is ~1672 lines; splitting the new pieces (`Breadcrumb.tsx`, route-context hooks) into sibling files is encouraged.
  - [x] **Replace `sel` state with URL params as the source of truth.** Today (`EngagementsScreen.tsx:1129` `const [sel, setSel] = useState<Selection>(null)`) selection is local state, and `selectClient/selectProject/selectStudy/selectLocation` (lines 1195-1229) call `setSel(...)` + the hierarchy-store setters. Change the model:
    - Derive the active entity from `useParams()` inside a nested `<Routes>` (one element per entity type), each route element resolving its entity + ancestors via the Task-2 context hooks and rendering the matching detail panel + breadcrumb.
    - The `selectX` functions become `navigate('/internal/engagements/{type}s/{id}')` calls. Keep them as the single funnel the tree rows, detail-card child rows, and search hits all call (so callsites barely change — only their bodies do).
    - Keep writing the hierarchy store (`setActiveClientId/ProjectId/StudyId`) on navigation — 4.4 and later epics read it; preserve the **full-chain** writes the 4.3 review added (R-F5, lines 1212-1245). Resolve the chain from the route-context hooks now (authoritative) instead of the caches.
  - [x] **Tree still uses local `expanded` state** (AC4) — expansion is independent of the routed selection. A tree row's "active" highlight is now `activeId === node.id` where `activeId` comes from the URL param, not `sel`. Keep `expanded` starting as `new Set()` (collapsed by default) and the `toggleExpand` toggle-only behavior (the 4.3 latent-bug fix at lines 1195-1203 — do NOT reintroduce double-`setExpanded`).
  - [x] **Breadcrumb component (AC1-3, 6):** a new `Breadcrumb` rendering `Engagements > … > {current}`. Each ancestor is a `<Link to={…}>` (or a `<button>`+`navigate`); the leaf (current entity) is bold non-link text. First segment "Engagements" links to `/internal/engagements`. **Never render an Organization segment** (FR-ORG-06). Match the design prototype trail (`design/internal3.jsx:28-39`, `design/app_v3.jsx` `crumb`): chevron `Icon` separators, faint ancestors, brand-800 bold leaf. Place it at the top of the detail panel (above the entity header card), or in the screen's existing internal topbar (`EngagementsScreen.tsx:1513-1522`) — pick one, be consistent across all four detail types.
  - [x] **Detail panels barely change.** `ClientDetail`/`ProjectDetail`/`StudyDetail`/`LocationDetail` already exist (lines 747-1051). They now receive their entity + ancestor names from the route-context hook (not from caches). The single-line parent name they show today (e.g. `ProjectDetail` lines 912-915 `<Icon chevron/> {clientName}`) is **superseded by the breadcrumb** — remove that inline parent line OR keep it; do not show the parent twice confusingly. Prefer removing the inline parent line in favor of the breadcrumb.
  - [x] **Loading & not-found (AC7):** while ancestors resolve, show the existing `Skeleton`/`Loading…` idiom; on a 404 from any id in the chain, render a friendly empty state using `friendlyError` ("This item no longer exists.") rather than crashing. The detail-render switch (lines 1611-1648) becomes route-driven.

- [x] **Task 5 — Document titles per entity (AC: 7)**
  - [x] `EngagementsScreen` currently calls `usePageTitle('Engagements')` (line 1123) — a single static title. With routing, set the title to the active entity: `usePageTitle(entity?.name, '{Type}')` → e.g. `Protocol Feasibility · Study · Velara` once loaded, `Study · Velara` while loading (the `buildTitle` helper filters the falsy name — this is the documented Epic-4 seam in `useDocumentTitle.ts:9-23`). At the bare `/internal/engagements` (no entity) keep `usePageTitle('Engagements')` → `Engagements · Velara` (the `internal.test.tsx` test at line 129-133 asserts this — must stay green).

- [x] **Task 6 — Extend the global ⌘K palette: `src/shared/components/AppBar.tsx` (AC: 5)**
  - [x] **Do NOT add a new keydown handler or a second palette.** Extend the existing `CmdPalette` (`AppBar.tsx:13-100`). It already focuses an input, filters, and navigates on select.
  - [x] Add the engagements data sources: `const { data: clients } = useClients()` and project lookups. **Projects are per-client** (`useProjects(clientId)` requires a client id), so to search projects you need them loaded. Pragmatic approach for Phase 1: search **clients** always (one `['clients']` query, cheap), and search **projects only from clients already loaded into the `['projects', clientId]` cache** (mirror the 4.2/4.3 "search over loaded data" mock). Read cached project lists via `queryClient.getQueriesData({ queryKey: ['projects'] })` (do not fire N project requests on palette open). Document this "clients always, projects-if-loaded" behavior — it matches FR-ORG-07's client-side-mock posture.
  - [x] Render an **"Engagements" section** (label like the existing "Skills" header, `AppBar.tsx:77-79`) listing matched clients (users icon) and projects (layers icon). On click: `navigate('/internal/engagements/clients/${id}')` or `projects/${id}` then `onClose()`. Reuse the existing row markup/hover styles.
  - [x] Keep the existing Skills section and the "Search skills and views…" placeholder updated to reflect the new scope (e.g. "Search skills, clients, projects…"). The existing ⌘K toggle handler (`AppBar.tsx:112-122`) is unchanged.
  - [x] **Reuse, do not rebuild:** `useClients` from `@/features/engagements/hooks/useEngagements`, `useQueryClient` for cached projects, `useNavigate` (already imported).

- [x] **Task 7 — Keep all 4.3 behaviors working under routing (AC: regression)**
  - [x] **Search box (sidebar):** the in-tree search (`EngagementsScreen.tsx:1531-1559`, `searchResults` memo lines 1249-1272, `handleSelectResult` lines 1274-1301) must still work — its `selectClient/Project/Study/Location` calls now `navigate(...)` instead of `setSel(...)`. The `projectsCache`/`studiesCache`/`locationsCache` referential-equality pattern + `sameList` guard stay as-is (they feed search).
  - [x] **CRUD modals (`EntityModal`)** and **delete flows (`ConfirmDialog`, study-cascade)** are untouched in behavior. After a create/edit, the screen still invalidates-and-refetches. After a **delete**, instead of clearing `sel` (the old `clearSelectionFor`, lines 1430-1434), **navigate away from the deleted entity's route** — e.g. deleting the selected study navigates to its parent project (`/internal/engagements/projects/{projectId}`) or to `/internal/engagements`. Preserve the 4.3 study-delete-cascade semantics (delete child locations first; idempotent 404-tolerant retry; live-fetch the location count — R-F1/R-F2).
  - [x] **Stale-entity handling:** the 4.3 P7 stale-selection effect (lines 1443-1462) cleared `sel` when an entity vanished. Under routing, a vanished entity now surfaces as a 404 on the route's id query → render the friendly not-found state (Task 4). Remove or adapt the old effect accordingly; don't leave dead code referencing `sel`.

- [x] **Task 8 — Tests (AC: all)**
  - [x] Extend `EngagementsScreen.test.tsx`, `internal.test.tsx`, and add `AppBar.test.tsx` cases (AppBar test file exists). Mirror the existing harnesses: `vi.mock('@/features/engagements/hooks/useEngagements')`, mock `useHierarchyStore`, wrap in `<QueryClientProvider client={makeQC()}><MemoryRouter initialEntries={[…]}>…`. **Add mock returns for every NEW hook** (`useClient`, `useProject`, `useStudy`, `useLocation`, and any context hook) in `beforeEach` or the component throws (a missing mock destructures `undefined`).
  - [x] Required cases:
    - (a) Render at `/internal/engagements/projects/:id` → breadcrumb shows `Engagements > Client > Project`, no "Organization" text anywhere (AC1).
    - (b) Render at `/internal/engagements/studies/:id` → 4-segment breadcrumb (AC2); at `/locations/:id` → 5-segment (AC3).
    - (c) Clicking the Project segment from a Location detail navigates to `/internal/engagements/projects/:id` (assert the project detail / breadcrumb updates) (AC6). Clicking "Engagements" → tree-only.
    - (d) Tree collapsed by default (no project rows visible until a client node is expanded) (AC4).
    - (e) ⌘K (fire `keydown` `metaKey:true, key:'k'`) opens the palette; typing a client name shows it under "Engagements"; selecting it navigates to `/internal/engagements/clients/:id` (AC5). (Test in `AppBar.test.tsx` with `useClients` mocked.)
    - (f) Deep-link cold-load at `/studies/:id` with only the per-id hooks mocked → detail + full breadcrumb render; a 404-mocked id → "This item no longer exists." (AC7).
    - (g) `/internal/engagements/projects/x` keeps the **Engagements** nav tab active and title `Engagements`-derived (regression on `useActiveTab`).
  - [x] Keep ALL existing 4.2/4.3 tests green (145 today) — adapt any that asserted on `sel`-driven selection to the routed model.

- [x] **Task 9 — Gates**
  - [x] `npm run typecheck` (0 errors — the `sel`→route refactor and the widened palette touch several types; fix all), `npm run lint` clean, `npm run test` all pass (existing + new), `npm run build` succeeds.

## Dev Notes

### This story is FRONTEND ONLY — the API is done and verified

Story 4.1 shipped full hierarchy CRUD **plus GET-by-id** for all four entities (`velara-api/app/api/v1/hierarchy.py` — `get_client`/`get_project`/`get_study`/`get_location`, each `ResponseEnvelope[…Read]`), covered by 522 passing Docker tests. **Do not modify any `velara-api` file.** Every endpoint and error code below already exists.

### API Contract (GET-by-id — exact, from 4.1 source)

Auth is automatic (the `apiClient` interceptor attaches the Bearer token; org scoping is server-side from the JWT). All responses use the `{ data: … }` envelope (unwrap `response.data.data`).

| Operation | Method | Path | Success / Error |
|-----------|--------|------|-----------------|
| Get client | GET | `/api/v1/clients/{id}` | 200 `{ data: ClientRead }` · 404 `CLIENT_NOT_FOUND` |
| Get project | GET | `/api/v1/projects/{id}` | 200 `{ data: ProjectRead }` · 404 `PROJECT_NOT_FOUND` |
| Get study | GET | `/api/v1/studies/{id}` | 200 `{ data: StudyRead }` · 404 `STUDY_NOT_FOUND` |
| Get location | GET | `/api/v1/locations/{id}` | 200 `{ data: LocationRead }` · 404 `LOCATION_NOT_FOUND` |

Parent-id fields used for ancestor walking (all guaranteed present): `Project.client_id`, `Study.project_id`, `Location.study_id`. The four `*_NOT_FOUND` codes are already in `NOT_FOUND_CODES` (`EngagementsScreen.tsx:119-124`) → `friendlyError` returns "This item no longer exists."

### The current screen is selection-state-driven — this story makes it URL-routed

The entire engagements UI is **one ~1672-line file**: [velara-web/src/features/engagements/components/EngagementsScreen.tsx](../../../velara-web/src/features/engagements/components/EngagementsScreen.tsx). Today:
- Selection is local `useState` (`sel`, line 1129); the detail panel is a conditional render (lines 1611-1648) at the single URL `/internal/engagements`.
- There is **no breadcrumb** — detail panels show a single inline parent-name line (e.g. `ProjectDetail` lines 912-915).
- The tree is already **collapsed by default** (`expanded = new Set()`, line 1130) — AC4 is mostly pre-satisfied; just preserve it.

The refactor converts the *active-entity identity* to the URL while preserving the persistent two-panel layout (tree must not remount on navigation). Exact seams (verified line numbers):

| What | Where (`EngagementsScreen.tsx`) | Change |
|------|----------------------------------|--------|
| `usePageTitle('Engagements')` | line 1123 | per-entity title (Task 5) |
| `const [sel, setSel] = useState` | line 1129 | active entity derived from `useParams` (Task 4) |
| `selectClient/Project/Study/Location` | lines 1195-1229 | bodies become `navigate(...)` (keep store writes) |
| ancestor-chain store writes (R-F5) | lines 1212-1245 | resolve from route-context hooks, keep writing the full chain |
| `searchResults` memo + `handleSelectResult` | lines 1249-1301 | hits now `navigate(...)` |
| edit/add openers | lines 1303-1358 | resolve active entity from route, not `sel` |
| delete request/confirm + `clearSelectionFor` | lines 1360-1462 | on success, `navigate` to parent/root instead of clearing `sel` |
| selected-entity derivation (P5) | lines 1464-1478 | comes from route-context hooks |
| detail render switch | lines 1611-1648 | becomes a nested `<Routes>` (one per entity type) |
| internal topbar | lines 1513-1522 | candidate home for the breadcrumb |

### ⌘K — extend the ONE existing palette, do NOT add a second (Decision B)

[velara-web/src/shared/components/AppBar.tsx](../../../velara-web/src/shared/components/AppBar.tsx) already owns:
- A **global ⌘K handler** (`AppBar.tsx:112-122`) — `(metaKey||ctrlKey) && key==='k'` toggles `cmdOpen`; Escape closes. **Leave it as-is.**
- A `CmdPalette` (`lines 13-100`) that searches `useSkills()` and navigates to `/internal/skills/:id`. **Extend it** — add an "Engagements" section (clients + cached projects) that navigates to the new entity routes. Keep the Skills section.

This is the design intent: `design/app_v3.jsx` `CmdPalette` (lines 206-285) is a single palette with **SKILLS** + **GO TO** (views) sections — one ⌘K, multiple sources. We're adding an Engagements source.

**⌘K scope (Phase-1 mock):** search **clients** always (the `['clients']` query is one cheap list). Search **projects only from clients already loaded** into the `['projects', clientId]` cache — read via `queryClient.getQueriesData({ queryKey: ['projects'] })`; do **not** fan out N project requests when the palette opens. This matches FR-ORG-07's "client-side search over loaded data" posture (server-side search deferred to Phase 2). Studies/locations in ⌘K are **optional** for this story (AC5 only requires client+project) — skip them unless trivial; do not fire extra requests for them.

### Breadcrumb design intent (FR-ORG-06: org layer NEVER shown)

- Trail format: `Engagements > {Client} > {Project} [> {Study} [> {Location}]]` — depth matches the entity type. **No Organization segment, ever** (the ltree path's `org_*` root is internal-only).
- "Engagements" (root) links to `/internal/engagements`. Each ancestor entity links to its detail route. The current entity is bold, non-link.
- Visual: chevron `Icon` separators (already in `ICONS`), faint ancestor text, brand-800 bold leaf — mirror `design/internal3.jsx:28-39` (translate prototype `var(--green-*)` to the app's `brand-*`/`text-faint`/`text-muted`, same as 4.2/4.3 did).
- Resolve ancestor **names** from the route-context hooks' loaded ancestor entities (`client.data?.name`, `project.data?.name`, `study.data?.name`) — not from the search caches (which may be empty on a cold deep-link).

### Reusable infrastructure — do NOT rebuild

| Need | Reuse | Path |
|------|-------|------|
| Global ⌘K palette + handler | extend `CmdPalette` / `AppBar` | `src/shared/components/AppBar.tsx` |
| Clients query | `useClients` | `src/features/engagements/hooks/useEngagements.ts` |
| Per-id queries | `useClient`/`useProject`/`useStudy`/`useLocation` (Task 2 — new, but mirror `useProjects` shape) | same file |
| Error envelope helpers (`getApiCode`/`friendlyError`/`NOT_FOUND_CODES`) | already in the file | `EngagementsScreen.tsx:99-133` |
| `Card`/`MetaChip`/`EntityBadge`/`Icon`/`ENTITY` map (has `chevron`) | already in the file | `EngagementsScreen.tsx` |
| `formatDate` (Invalid-Date-safe) | already in the file | `EngagementsScreen.tsx:136-139` |
| Detail panels (Client/Project/Study/Location) | already exist | `EngagementsScreen.tsx:747-1051` |
| Active-hierarchy store | `useHierarchyStore` (has `setActiveClientId/ProjectId/StudyId`) | `src/stores/useHierarchyStore.ts` |
| Title builder (entity-page seam) | `usePageTitle(name, type)` | `src/shared/hooks/useDocumentTitle.ts` |
| Routing | `react-router-dom` v7 (`useParams`/`useNavigate`/`<Link>`/`<Routes>`) | already a dep |
| Tab-from-URL derivation | `useActiveTab` | `src/routes/internal.tsx:31-37` |

### What NOT to build

- **No backend changes** — GET-by-id already exists (Story 4.1).
- **No second ⌘K palette / no new keydown handler** — extend `AppBar`'s `CmdPalette` (Decision B).
- **No Organization breadcrumb segment / label** anywhere (FR-ORG-06).
- **No server-side search** — ⌘K and the sidebar search stay client-side mocks over loaded data (FR-ORG-07).
- **No new CRUD** — creation/edit/delete are 4.2/4.3; keep them working, don't reimplement.
- **No `hierarchy_path` parsing** for ancestors — walk the `*_id` parent fields (the org-uuid ltree segments are internal).
- **No skill attachment, no RBAC, no client-portal nav** — out of scope.
- **No tree remount on navigation** — the tree + its `expanded`/cache state must persist across entity routes (keep one persistent `EngagementsScreen`, nest the `<Routes>` for the detail panel only).

### REGRESSION GUARD — do NOT break

- All existing 4.2/4.3 tests + the whole `velara-web` suite must stay green (**145 tests today**). The skills feature is untouched except the AppBar palette extension (whose existing Skills behavior must still pass — `AppBar.test.tsx` exists).
- `internal.test.tsx` asserts: Engagements renders at `/internal/engagements`, title `Engagements · Velara` (line 129-133), Engagements tab active (line 160-165). All must stay true under the new routes — and `/internal/engagements/projects/x` must ALSO keep the Engagements tab active (`useActiveTab` uses path segment `[2]` = `engagements`, so it should — verify + test).
- Keep every 4.3 behavior: tree collapsed-by-default + toggle-only expand (the latent-double-`setExpanded` fix, lines 1195-1203), `projectsCache`/`studiesCache`/`locationsCache` + `sameList` guard, the search hint, the study-delete cascade (live-fetch count, idempotent 404-tolerant retry, delete-children-then-study — R-F1/R-F2), `EntityModal` focus-trap/Escape/double-submit guard (P6), description clear-once-set (P2), fresh-cache-preferred detail (P5).
- Do NOT modify `ConfirmDialog.tsx`, `Skeleton.tsx`, `client.ts`, `queryClient.ts`, `useDocumentTitle.ts`, or any skills-feature file (other than reading `useSkills` in the palette, already imported).
- Extend `useHierarchyStore` **additively** if you need a location id (none exists today) — preserve all existing signatures. Likely NOT needed (the route param IS the location identity now).
- The route param is the entity identity; keep `org_id` server-side only (the frontend never sends or shows it).

### Tooling, naming, conventions (verified)

- **Stack:** React 19, react-router-dom 7, @tanstack/react-query 5, axios 1.7, zustand 5, Tailwind CSS 4 (`@theme` in `src/index.css`), TypeScript 5.5 strict, Vite 6, Vitest 2 + @testing-library/react 16 + user-event 14.
- **Tokens present in `src/index.css`:** `brand-50/300/600/700/800/900`, `danger`/`danger-bg`, `ink`/`ink-2`/`muted`/`faint`, `surface`/`surface-2`/`surface-sunk`, `paper`, `line`/`line-2`/`line-strong`.
- **Naming:** TS `camelCase` vars, `PascalCase` components/types, files `PascalCase.tsx`/`camelCase.ts`. **API JSON stays snake_case** (`client_id`, `project_id`, `study_id`, `postal_code`).
- **Path alias** `@/` → `src/`. **Feature dir:** `src/features/engagements/` + `src/api/hierarchy.ts`; routes in `src/routes/internal.tsx`; shared shell in `src/shared/components/AppBar.tsx`.
- **Dev login for manual test:** `LoginPage` → `consultant` seed user (`org_id: org_vitalief`). Token TTL 8h. Manual smoke: expand tree → click a study → confirm breadcrumb `Engagements > Client > Project > Study`, click Project segment → lands on project detail; refresh on a `/studies/:id` URL → context resolves; press ⌘K, type a client name → select → lands on client detail.

### File Locations

```
velara-web/
  src/
    api/hierarchy.ts                          ← EXTEND (add 4 GET-by-id functions)
    routes/
      internal.tsx                            ← EXTEND (nested engagements/* routes)
      internal.test.tsx                       ← EXTEND (deep-route + tab-active cases)
    shared/components/
      AppBar.tsx                              ← EXTEND (CmdPalette gets an Engagements section)
      AppBar.test.tsx                         ← EXTEND (⌘K → client/project navigation)
    features/engagements/
      hooks/useEngagements.ts                 ← EXTEND (per-id hooks + ancestor-context hooks)
      components/
        EngagementsScreen.tsx                 ← REFACTOR (URL-derived selection + breadcrumb)
        EngagementsScreen.test.tsx            ← EXTEND (routed selection, breadcrumb, deep-link)
        Breadcrumb.tsx                        ← NEW (optional split; the clickable trail)
```
Splitting the breadcrumb and the route-context hooks into their own files is encouraged (the screen is already ~1672 lines). If you split, co-locate tests and keep the public `EngagementsScreen` export stable.

### Testing Setup

- Co-locate tests; `src/test/setup.ts` resets `document.title` + `sessionStorage` between tests.
- Harness wraps in **both** `<QueryClientProvider client={makeQC()}>` (retry:false) **and** `<MemoryRouter initialEntries={[path]}>`. For routed tests, use `initialEntries` to land on a deep URL (see `internal.test.tsx:73-84` `renderAt(path)` — reuse that pattern).
- **Add mock returns for every new hook** (`useClient`/`useProject`/`useStudy`/`useLocation` + any `useXContext`) in `beforeEach`, or the component throws (missing mock → destructure crash). For deep-link tests, mock each per-id hook to return the right ancestor so the chain resolves.
- For the ⌘K test, fire `await userEvent.keyboard('{Meta>}k{/Meta}')` or `fireEvent.keyDown(window, { key:'k', metaKey:true })`; assert the palette input appears, type a client name, click the result, and assert the resulting route (e.g. via a `LocationDisplay` test helper that reads `useLocation()` from react-router, or assert the navigated detail/breadcrumb renders).
- Run `npm run typecheck && npm run lint && npm run test && npm run build` before review (all prior UI stories gated on all four clean).

### References

- [Epic 4 — Story 4.4 ACs](../../planning-artifacts/epics/epic-4-engagement-hierarchy-management.md)
- [Story 4.3 — Study & Location Management (the screen you refactor)](4-3-study-and-location-management.md)
- [Story 4.2 — Engagements Screen](4-2-engagements-screen-client-and-project-management.md)
- [Story 4.1 — Hierarchy Data Model & API (the backend, incl. GET-by-id)](4-1-hierarchy-data-model-and-api.md)
- [As-built screen: src/features/engagements/components/EngagementsScreen.tsx](../../../velara-web/src/features/engagements/components/EngagementsScreen.tsx)
- [As-built ⌘K palette: src/shared/components/AppBar.tsx](../../../velara-web/src/shared/components/AppBar.tsx)
- [As-built routes: src/routes/internal.tsx](../../../velara-web/src/routes/internal.tsx)
- [As-built API: src/api/hierarchy.ts](../../../velara-web/src/api/hierarchy.ts)
- [As-built hooks: src/features/engagements/hooks/useEngagements.ts](../../../velara-web/src/features/engagements/hooks/useEngagements.ts)
- [Title seam: src/shared/hooks/useDocumentTitle.ts](../../../velara-web/src/shared/hooks/useDocumentTitle.ts)
- [Design — breadcrumb trail](../../../design/internal3.jsx) · [Design — TopBar crumbs + CmdPalette](../../../design/app_v3.jsx) · [Design — full hierarchy screen](../../../design/hierarchy.jsx)
- [Backend GET-by-id routes: app/api/v1/hierarchy.py](../../../velara-api/app/api/v1/hierarchy.py)
- [Architecture — Core Decisions (React Router v6 code-based, role route trees)](../../planning-artifacts/architecture/core-architectural-decisions.md)
- [Architecture — Implementation Patterns & Consistency Rules](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md)

## Change Log

- 2026-06-12: Story 4.4 implemented (dev-story). Refactored the as-built 4.3 `EngagementsScreen` from selection-state to URL-routed per entity (nested `/internal/engagements/{clients,projects,studies,locations}/:id` via a screen-owned `<Routes>` so the tree never remounts), added a new `Breadcrumb.tsx` clickable trail (org layer hidden, FR-ORG-06), per-id + ancestor-context hooks (`useClient`/`useProject`/`useStudy`/`useLocation` + `use*Context`, walking `*_id` parent fields with `enabled` gating) for deep-link/refresh resolution (AC7), per-entity document titles, navigate-on-delete (replacing `sel` clearing), and extended the single existing AppBar ⌘K palette with an Engagements section (clients always + cached projects). Preserved all 4.3 behaviors (collapsed-by-default tree, toggle-only expand, cache+`sameList` search, study-delete cascade R-F1/R-F2, full active-path store writes R-F5). Tests: rewrote `EngagementsScreen.test.tsx` to the routed model + added breadcrumb/deep-link/⌘K/tab-active cases. Gates: typecheck 0 errors, lint clean, 154 tests pass (+9, 0 regressions), build ✓. Status → review.
- 2026-06-12: Story 4.4 created (create-story). Frontend-only; refactors the as-built 4.3 `EngagementsScreen` from selection-state to URL-routed per entity (nested `/internal/engagements/{clients,projects,studies,locations}/:id` routes), adds a clickable breadcrumb trail (org layer hidden per FR-ORG-06), deep-link/refresh ancestor resolution via GET-by-id (verified to exist in 4.1), and extends the EXISTING global ⌘K palette in `AppBar.tsx` with an Engagements (clients/projects) section. Two architectural decisions locked with the user: (A) URL routes per entity [vs. keeping state-driven]; (B) extend the single AppBar ⌘K palette [vs. a separate in-screen palette]. Exhaustive as-built analysis: line-referenced every `sel`→route seam in the ~1672-line screen, confirmed the tree is already collapsed-by-default (AC4), found and reused the existing `AppBar` ⌘K handler + `CmdPalette` (do-not-duplicate), verified GET-by-id endpoints + the `*_NOT_FOUND` envelope codes already wired into `friendlyError`, the `usePageTitle(name, type)` entity-page seam, and the MemoryRouter+initialEntries test harness. Scoped out: backend, server-side search, new CRUD, RBAC, skill attachment, studies/locations in ⌘K (optional).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8, 1M context)

### Debug Log References

- Initial state: the working tree carried **uncommitted Story 4.3 code** (studies/locations + delete-cascade) on top of `baseline_commit f90d9f5` (Story 4.2). Verified the 4.3 baseline was green (145 tests) before starting — this story extends it in place.
- Per-entity document title initially read `Velara` (not the entity) on deep links: the shell's `usePageTitle(undefined)` parent effect ran **after** the detail route's child effect and clobbered it. Fixed by removing the shell-level title call and giving the title to each route component (`EmptyDetail` owns the static `Engagements`; each detail route sets `usePageTitle(entity?.name, 'Type')`). Child effects run before parent effects, so per-route ownership is the correct seam.

### Completion Notes List

Implemented Story 4.4 as a frontend-only refactor of the as-built 4.3 `EngagementsScreen`, converting selection-state to URL-routed navigation, adding a clickable breadcrumb trail, deep-link ancestor resolution, and extending the global ⌘K palette.

- **Task 1 — GET-by-id API (`src/api/hierarchy.ts`):** added `getClient/getProject/getStudy/getLocation`, each unwrapping the `{ data }` envelope, mirroring the list/create functions.
- **Task 2 — per-id + context hooks (`useEngagements.ts`):** added `useClient/useProject/useStudy/useLocation` with **singular** query keys (`['client', id]` …) distinct from the plural list keys, gated by `enabled: !!id`. Added `useClientContext/useProjectContext/useStudyContext/useLocationContext` that walk the parent-id chain (`client_id`/`project_id`/`study_id`) via `enabled`-gated composition — TanStack Query dedupes already-loaded ancestors. **Did not parse `hierarchy_path`** (org-uuid ltree segments are internal; FR-ORG-06).
- **Task 3 — nested routes (`internal.tsx`):** changed `engagements` → `engagements/*` so the screen owns its own nested `<Routes>` (tree never remounts) and `useActiveTab` (segment `[2]`) keeps the Engagements tab active at every depth.
- **Task 4/5/7 — screen refactor (`EngagementsScreen.tsx`):** removed `sel` state + the stale-selection effect + `clearSelectionFor`; the active entity is now derived from the pathname (`useActiveEntity`) for tree highlighting, and the detail panel is a nested `<Routes>` with one route-component per entity type. Each detail route resolves its entity + ancestors via the Task-2 context hooks, writes the **full** active-hierarchy store chain (`useStoreActivePath`, authoritative — preserves R-F5), sets the per-entity document title (Task 5), and renders the breadcrumb above the (unchanged) detail panel. The inline parent-name lines in Project/Study/Location detail were removed in favor of the breadcrumb (Location gained a "Study" MetaChip for parity). The `selectX` funnels became `goToClient/Project/Study/Location` → `navigate(...)`. On delete success the screen **navigates to the parent/root** instead of clearing `sel` (Task 7); the 4.3 study-delete cascade (live-fetch count, idempotent 404-tolerant retry, delete-children-then-study — R-F1/R-F2) is preserved.
- **Task 4 — `Breadcrumb.tsx` (NEW):** clickable trail `Engagements > Client > Project [> Study [> Location]]`; ancestors are `<Link>`s, leaf is bold non-link, **no Organization segment ever** (FR-ORG-06). Chevron separators, faint ancestors, brand-800 leaf.
- **Task 6 — ⌘K palette (`AppBar.tsx`):** extended the **single existing** `CmdPalette` (no second palette, no new keydown handler). Added an "Engagements" section — clients always (one cheap `['clients']` list), projects only from clients already in the `['projects', …]` cache via `queryClient.getQueriesData` (no N-request fan-out, FR-ORG-07 client-side-mock posture). Selecting a client/project navigates to its detail route and closes the palette. Placeholder updated to "Search skills, clients, projects…".
- **Task 8 — tests:** rewrote `EngagementsScreen.test.tsx` to the routed model (mounts within `/internal/engagements/*`, mocks the new per-id/context hooks, renders detail via deep-link URLs); added breadcrumb depth (AC1/2/3), ancestor-click navigation + "Engagements"→tree-only (AC6), collapsed-by-default (AC4), deep-link + 404 friendly state (AC7), per-entity title. Added `internal.test.tsx` cases (deep route keeps Engagements tab active + per-type title — `useActiveTab` regression). Added `AppBar.test.tsx` ⌘K cases (open → type client → navigate to `/clients/:id`; no-results state). Adapted all 4.2/4.3 tests to routing.
- **AC coverage:** AC1 (project breadcrumb, no Org) ✓; AC2 (study 4-seg) ✓; AC3 (location 5-seg) ✓; AC4 (collapsed default) ✓; AC5 (⌘K client/project nav) ✓; AC6 (ancestor click nav) ✓; AC7 (deep-link resolve + 404 friendly + title) ✓.
- **Gates:** `npm run typecheck` 0 errors · `npm run lint` clean · `npm run test` **154 passed** (+9 over the 145 baseline, 0 regressions) · `npm run build` ✓.

### File List

- `src/api/hierarchy.ts` — MODIFIED (added 4 GET-by-id functions)
- `src/features/engagements/hooks/useEngagements.ts` — MODIFIED (per-id hooks + ancestor-context hooks)
- `src/routes/internal.tsx` — MODIFIED (`engagements` → `engagements/*` nested route)
- `src/features/engagements/components/EngagementsScreen.tsx` — MODIFIED (URL-derived selection, nested detail routes, breadcrumb wiring, navigate-on-delete, per-entity title)
- `src/features/engagements/components/Breadcrumb.tsx` — NEW (clickable breadcrumb trail; org layer hidden)
- `src/shared/components/AppBar.tsx` — MODIFIED (CmdPalette Engagements section: clients + cached projects)
- `src/features/engagements/components/EngagementsScreen.test.tsx` — MODIFIED (routed model + breadcrumb/deep-link/AC tests)
- `src/routes/internal.test.tsx` — MODIFIED (deep-route tab-active + per-type title; new-hook mocks)
- `src/shared/components/AppBar.test.tsx` — MODIFIED (⌘K → client navigation)

*(Note: `src/features/engagements/types.ts` also shows as modified in `git status`, but those are the pre-existing uncommitted Story 4.3 Study/Location interface additions — NOT changed by this story.)*

### Review Findings

_Code review 2026-06-12 — 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 7 ACs + both locked decisions + scope boundaries PASS per the Auditor. 9 actionable findings (2 decision-needed, 6 patch, 1 defer); 3 dismissed as noise._

**Decision-needed (resolved 2026-06-12 → both became patches):**

- Resolved → patch: ⌘K palette keyboard navigation — user chose to add arrow/Enter nav to the shared palette. (see patch below)
- Resolved → patch: ⌘K project results filtering — user chose to filter project results to live clients + add a loaded-data hint. (see patch below)

**Patch:**

- [x] [Review][Patch] ⌘K palette: add keyboard navigation (arrow/Enter) — results are plain `<button>`s with no `onKeyDown`/roving focus. Add up/down arrow selection + Enter-to-navigate + `aria-activedescendant` across both Skills and Engagements sections. (resolved from decision-needed) [AppBar.tsx]
- [x] [Review][Patch] ⌘K: filter project results to live clients + loaded-data hint — `getQueriesData(['projects'])` can surface projects whose parent client was collapsed/deleted. Filter results to clients present in the live `useClients()` list, and add a "covers loaded data only" hint matching the tree search. (resolved from decision-needed) [AppBar.tsx]

- [x] [Review][Patch] Ancestor fetch error hides an existing leaf entity (HIGH, 2 layers) — `if (error || !leaf)` returns `DetailNotFound` when an *ancestor* GET errors even though the leaf loaded. Gate not-found on the leaf's own error; let ancestor errors degrade to `to: undefined` crumbs (already supported). [EngagementsScreen.tsx:1221,1250,1282 + useEngagements.ts:214,228,244]
- [x] [Review][Patch] Deleted study/location lingers in singular per-id cache; Back shows stale entity — delete mutations invalidate only the plural list keys, never `['study'|'location', id]`. Add `removeQueries` on the singular (+ ancestor) keys. [useEngagements.ts:110,144]
- [x] [Review][Patch] Cascade-delete count can miss a recently-added location → 409 — confirm-time `fetchStudyLocations` respects the global 30s `staleTime`, so the "live list" comment is false. Add `staleTime: 0`. [EngagementsScreen.tsx:1352-1357]
- [x] [Review][Patch] `requestDeleteStudy` unguarded `.finally` clears `countingLocations` for a different target — open A → cancel → open B fast; A's resolution flips B's "Checking…" prematurely. Guard the reset (check current target) or move it into the guarded `.then`/`.catch`. [EngagementsScreen.tsx:1467]
- [x] [Review][Patch] Active-hierarchy store not cleared on root/empty route — `EmptyDetail` never clears `activeClientId/ProjectId/StudyId`, leaving a stale active path after navigating back to `/internal/engagements`. Clear the store on the index/`*` route. [EngagementsScreen.tsx EmptyDetail]
- [x] [Review][Patch] Cold deep-link Study/Location renders blank ancestor metadata + "…" crumbs before resolve — inconsistent with `ProjectDetailRoute`'s ancestor-loading guard. Align Study/Location guards to the Project route. [EngagementsScreen.tsx:1249,1281 vs 1220]
- [x] [Review][Patch] Breadcrumb leaf with empty name renders a blank bold segment — leaf crumb is `{ label: leaf.name }` with no fallback (ancestors guard with `|| '…'`). Add a leaf-name fallback. [EngagementsScreen.tsx:1203,1228,1258,1292]
- [x] [Review][Patch] Dead `SearchResultItem.parentId` field + stale comment — `handleSelectResult` navigates by type+id only; `parentId` is populated but never read, and its comment claims linkage logic that doesn't exist. Remove the field + fix the comment. [EngagementsScreen.tsx:1832,2142-2152,2177]

**Deferred:**

- [x] [Review][Defer] Client-side study/location cascade delete is non-atomic — deferred, inherent to the API (no cascade endpoint; frontend-only story). A mid-loop non-404 failure leaves locations partially deleted. The 4.3 R-F1/R-F2 pattern is 404-tolerant by design; a true fix needs a backend cascade endpoint (out of scope). [EngagementsScreen.tsx:1494-1497]

**Dismissed (3):** `useActiveEntity` over-matching garbage trailing paths (unreachable via app nav, falls through to EmptyDetail); same-description-plus-trailing-space no-op close (correct — nothing changed); ⌘K-as-toggle discarding the typed query (standard palette behavior; Decision B says keep handler intact).

_All 10 patches applied 2026-06-12 (8 review findings + 2 resolved decisions). Gates re-run GREEN: typecheck 0, lint clean, 154 tests pass (AppBar palette-row assertion updated `button`→`option` for the new combobox a11y), build ✓. 1 deferred (non-atomic cascade → logged in deferred-work.md), 3 dismissed._
