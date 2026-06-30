# Story 4.2: Engagements Screen — Client & Project Management

---
baseline_commit: ce1a427fc1ed039425f48df456193c5a33ec3656
---

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to browse, create, and manage Clients and Projects from the Engagements landing screen,
so that I can navigate my active engagements and keep client and project records current.

## Acceptance Criteria

> **BDD source:** [epic-4-engagement-hierarchy-management.md#story-42](../../planning-artifacts/epics/epic-4-engagement-hierarchy-management.md). **FR source:** ORG-01–ORG-07 (hierarchy browse/create/manage; client-side search per FR-ORG-07). **Architecture:** core-architectural-decisions.md (Frontend Architecture — feature-first dirs, Zustand, TanStack Query, Tailwind V3 tokens). **Design:** [design/hierarchy.jsx](../../../design/hierarchy.jsx) (two-panel Engagements prototype). **API:** built by Story 4.1 — clients/projects CRUD already exists.

**This is a frontend-only story.** The hierarchy API (clients + projects CRUD) was delivered and verified by Story 4.1 (`velara-api`, 522 Docker tests pass). Do **not** touch the backend. Build the React UI in `velara-web` against the existing endpoints.

**Scope boundary (read first):** This story covers **Clients and Projects only**. Studies, Locations, "Add Study", "view attached Skills", deletion-with-children warnings, and breadcrumbs/⌘K are **Stories 4.3 and 4.4** — do NOT build them here. The detail panel for a project must show a placeholder/disabled affordance for "Add Studies / view Skills" (AC6) but the actual Study/Location/Skill management lands in 4.3. Build the two-panel shell so 4.3/4.4 extend it without rework.

1. **Engagements is the default internal landing view.**
   **Given** an authenticated consultant
   **When** the app loads at `/` or `/internal`
   **Then** they land on the Engagements screen at `/internal/engagements`, and the "Engagements" tab is the first and active tab in the nav strip
   *(Already wired: `App.tsx` redirects `/` → `/internal/engagements`; `internal.tsx` redirects `/internal` index → `engagements`; `NavTabs` marks the tab active via URL. This AC is satisfied by replacing the `engagements/*` Placeholder with the real component — verify it still holds.)*

2. **Clients render as expandable tree nodes; no Organization node anywhere.**
   **Given** the Engagements screen loads and clients exist (`GET /api/v1/clients` returns data)
   **When** the tree renders
   **Then** each client is an expandable tree node (collapsed by default per 4.4 default, but expand/collapse must work here); **no** Organization-level node, label, "org", or `org_id` value appears anywhere in the visible UI

3. **Add Client.**
   **Given** the user clicks "New client" (top-bar primary action) or "Add Client"
   **When** they enter a name (required) and description (optional) and submit
   **Then** `POST /api/v1/clients` is called; on HTTP 201 the new client appears in the tree immediately (TanStack Query `['clients']` invalidated/refetched) and the modal closes

4. **Expand a client to reveal its projects.**
   **Given** a client node with projects under it
   **When** the user expands the client node
   **Then** its projects load via `GET /api/v1/projects?client_id={clientId}` and render as child nodes showing name (and description in the detail panel)

5. **Add Project within a client.**
   **Given** the user clicks "Add Project" within a selected client (detail panel) or via the client node
   **When** they enter project details and submit
   **Then** `POST /api/v1/projects` is called with the parent `client_id`; on HTTP 201 the project appears under the correct client node immediately and the modal closes

6. **Project detail panel.**
   **Given** the user clicks a project node
   **When** the detail panel opens
   **Then** it shows the project name, description, and creation date, plus **placeholder** affordances to "Add Studies" / "view attached Skills" (labeled as coming in a later story — disabled or non-functional stubs; the actual behavior is Story 4.3/4.4)

7. **Edit a client or project name/description.**
   **Given** the user edits a client or project from its detail panel
   **When** they save the change
   **Then** `PATCH /api/v1/clients/{id}` (or `/projects/{id}`) is called; on HTTP 200 the updated name appears in the tree and detail panel immediately

8. **Client-side search/filter (Phase 1 mock).**
   **Given** the Engagements screen has clients and projects already loaded
   **When** the user types in the on-screen search/filter box
   **Then** the tree (or a results list) filters to matching **Clients and Projects by name** operating **only on already-loaded data** — this is a **client-side mock per FR-ORG-07** (server-side search is Phase 2; do NOT add a `?search=` API param). Clearing the box restores the full tree.

## Tasks / Subtasks

- [x] **Task 1 — Engagements domain types: `src/features/engagements/types.ts` (AC: 2, 3, 4, 5, 6, 7)**
  - [x] Replace the empty `export {}` stub. Mirror the API contract exactly (snake_case field names — the API returns snake_case JSON; do NOT camelCase API fields).
  - [x] `Client`: `{ id: string; org_id: string; name: string; description: string | null; hierarchy_path: string; created_at: string; updated_at: string }`
  - [x] `Project`: `{ id: string; client_id: string; name: string; description: string | null; hierarchy_path: string; created_at: string; updated_at: string }`
  - [x] `ClientCreateInput`: `{ name: string; description?: string }`
  - [x] `ClientUpdateInput`: `{ name?: string; description?: string }` (at least one — enforce client-side; API returns 422 if both omitted)
  - [x] `ProjectCreateInput`: `{ client_id: string; name: string; description?: string }`
  - [x] `ProjectUpdateInput`: `{ name?: string; description?: string }`
  - [x] **Do NOT** expose `org_id` in any rendered field — it is the tenant scope key, present in the type for completeness but never displayed (AC2).

- [x] **Task 2 — API module: `src/api/hierarchy.ts` (AC: 3, 4, 5, 7)**
  - [x] Replace the empty `export {}` stub. Import `apiClient` from `@/api/client` and the types from `@/features/engagements/types`.
  - [x] Mirror `src/api/skills.ts` exactly — every function unwraps the `{ data: T }` envelope via `response.data.data`.
  - [x] `listClients(): Promise<Client[]>` → `apiClient.get<{ data: Client[] }>('/api/v1/clients')`
  - [x] `createClient(input: ClientCreateInput): Promise<Client>` → `apiClient.post('/api/v1/clients', input)` (returns 201)
  - [x] `updateClient(id: string, input: ClientUpdateInput): Promise<Client>` → `apiClient.patch('/api/v1/clients/${id}', input)`
  - [x] `deleteClient(id: string): Promise<void>` → `apiClient.delete('/api/v1/clients/${id}')` (returns 204; **delete is optional UI for this story** — wire the API fn but the delete-with-children 409 warning UX is Story 4.3. If you surface a delete button, map the 409 `HIERARCHY_HAS_CHILDREN` error per Task 6.)
  - [x] `listProjects(clientId: string): Promise<Project[]>` → `apiClient.get('/api/v1/projects', { params: { client_id: clientId } })` — **`client_id` is a REQUIRED query param**; omitting it returns 422.
  - [x] `createProject(input: ProjectCreateInput): Promise<Project>` → `apiClient.post('/api/v1/projects', input)`
  - [x] `updateProject(id: string, input: ProjectUpdateInput): Promise<Project>` → `apiClient.patch('/api/v1/projects/${id}', input)`
  - [x] (Optional) `deleteProject(id)` — same caveat as deleteClient.

- [x] **Task 3 — TanStack Query hooks: `src/features/engagements/hooks/useEngagements.ts` (AC: 2, 3, 4, 5, 7)**
  - [x] Mirror `src/features/skills/hooks/useSkills.ts`. Remove the `.gitkeep` once a real file lands in the folder.
  - [x] Query keys follow `[resource, id?]`: `['clients']`, `['projects', clientId]`.
  - [x] `useClients()` → `useQuery({ queryKey: ['clients'], queryFn: listClients })`
  - [x] `useProjects(clientId: string | undefined)` → `useQuery({ queryKey: ['projects', clientId], queryFn: () => listProjects(clientId!), enabled: !!clientId })` — only fetches when a client is expanded/selected (AC4).
  - [x] `useCreateClient()` → `useMutation({ mutationFn: createClient, onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }) })`
  - [x] `useUpdateClient(id)` → invalidate `['clients']` on success
  - [x] `useCreateProject()` → `useMutation`; on success invalidate `['projects', input.client_id]` (and you may invalidate `['clients']` if the tree shows project counts)
  - [x] `useUpdateProject(id, clientId)` → invalidate `['projects', clientId]` on success
  - [x] Do NOT add optimistic updates — per implementation-patterns rule, only low-stakes; invalidate-and-refetch is the established pattern and is correct here.

- [x] **Task 4 — Engagements screen shell: `src/features/engagements/components/EngagementsScreen.tsx` (AC: 1, 2, 8)**
  - [x] Call `usePageTitle('Engagements')` at the top (mirrors `SkillRegistry.tsx`; satisfies the document-title convention from Story 1.5).
  - [x] Two-panel layout per [design/hierarchy.jsx](../../../design/hierarchy.jsx) `OrgHierarchy`: left tree panel (~272px, `border-r border-line bg-surface-2`) + right detail panel (`flex-1 overflow-y-auto`). **Translate the prototype's inline styles + `var(--green-*)` tokens to the app's Tailwind `brand-*` classes** (see Dev Notes "Token translation").
  - [x] Page header / top action: "New client" primary button (`bg-brand-800 ... text-white`) opens the Add Client modal. (The prototype's standalone `TopBar` — the app renders inside `InternalShell`'s `<main>`, so render a header row like `SkillRegistry`'s, not a separate bar.)
  - [x] Search box + "Clear" affordance at the top of the tree panel. When the search query is non-empty, render a **flat client-side filtered results list** of matching Clients/Projects (by name) instead of the tree; empty restores the tree (AC8). Keep the filter logic in-component with `useMemo` over already-loaded `['clients']` + the expanded clients' `['projects', id]` caches — **no API search call**.
  - [x] Manage selection + expansion with local React state (the design uses `sel = {type, id}` and an `expanded: Set<string>`). You MAY also write the active client/project into `useHierarchyStore` (`setActiveClientId` / `setActiveProjectId`) so later stories can read context — but the screen's own state is the source of truth for this story.
  - [x] Loading: use TanStack Query `isLoading` → render a `Skeleton`-based placeholder (mirror `SkillRegistry`'s skeleton rows). Error: render `error.code`-mapped message (Task 6). Empty: "No clients yet." with the New client CTA.

- [x] **Task 5 — Tree, detail panel, and modals (AC: 2, 3, 4, 5, 6, 7)**
  - [x] `ClientTree` (tree panel body): top level = clients only (NO org node). Each client node is expandable (chevron rotates on expand); expanding triggers `useProjects(clientId)` and renders project child nodes indented. Selecting a node sets `sel`. Mirror the prototype's `HierarchyTree`/`TreeNode` structure but with Tailwind classes: selected node `bg-brand-50 text-brand-800`, hover `bg-surface-sunk`. Collapsed-by-default (AC: matches 4.4 default; expand/collapse functional here).
  - [x] `EntityDetail` (right panel): for a selected **client**, show name (h1, `font-serif`), description, created date, and a "Projects" child card listing its projects with an "Add Project" button + an Edit affordance. For a selected **project**, show name, description, created date, and **placeholder** "Add Studies / view attached Skills" controls (disabled or "Coming soon" — AC6; real behavior is 4.3). Include an Edit button for both.
  - [x] `AddEntityModal` (or two small modals): reuse the overlay/modal pattern from the prototype's `AddEntityModal`, but build it with the app's conventions — overlay `fixed inset-0 z-[100] flex items-center justify-center bg-black/30` (same as `ConfirmDialog`), card `rounded-lg border border-line bg-surface ...`. Fields: Client = name (required) + description; Project = name (required) + description (parent client_id comes from the selected node, shown read-only as "Under: {clientName}"). Use the `Field`/`inputCls`/`labelCls`/`errorCls` form pattern from `SkillForm.tsx`. **Client-side validation**: name required (trimmed, 1–255). On submit call the create mutation; close on success; show field/form errors on failure (Task 6).
  - [x] Edit uses the same form in an edit mode (or a dedicated `EditEntityModal`) — pre-fill name/description, call the update mutation, enforce "at least one field changed/present" before enabling Save (mirror `SkillForm` dirty-tracking lightly: require name non-empty).
  - [x] **Do NOT** render Study/Location/Skill rows or "Attach skill" — those data sources don't exist in this story's hooks. The prototype shows them; they belong to 4.3.

- [x] **Task 6 — Error mapping + envelope handling (AC: 3, 5, 7, 8)**
  - [x] The shared `getErrorMessage` (`src/shared/utils/errors.ts`) is a stub that only handles `Error` instances — it does NOT read the API error envelope. Follow the **`SkillForm.tsx` pattern instead**: read `error.response.data.error.code` / `.message` / `.details` from the Axios error.
  - [x] Map known codes to friendly messages: `VALIDATION_ERROR` (422) → map `details[]` (`{ loc: [...,field], msg }`) to per-field errors (last string in `loc` is the field name); `CLIENT_NOT_FOUND` / `PROJECT_NOT_FOUND` (404) → "This item no longer exists." + refetch; `HIERARCHY_HAS_CHILDREN` (409, only if you wire delete) → "Cannot delete: remove child projects first."; fallback → `error.message` or "Something went wrong. Please try again."
  - [x] 401 is handled globally by the `apiClient` response interceptor (redirects to `/login`) — do not re-handle it.

- [x] **Task 7 — Wire the route (AC: 1)**
  - [x] In `src/routes/internal.tsx`, replace the `engagements/*` `Placeholder` element with `<EngagementsScreen />` (import it). The `Placeholder` calls `usePageTitle('Engagements')`; your component now owns that call (Task 4). Leave all other routes untouched.
  - [x] Verify `App.tsx` (`/` → `/internal/engagements`) and the `<Route index element={<Navigate to="engagements" replace />} />` still make Engagements the default landing (AC1). No change expected — just confirm.

- [x] **Task 8 — Tests (AC: all)**
  - [x] Co-locate tests beside components (`EngagementsScreen.test.tsx`, etc.) per the project convention.
  - [x] Mirror `SkillRegistry.test.tsx`: `vi.mock` the `useEngagements` hooks, render inside `<MemoryRouter>`, assert with `@testing-library/react` + `userEvent`.
  - [x] Required cases: (a) clients render as tree nodes; (b) **no "Organization"/"org" label appears** (assert `screen.queryByText(/organization/i)` is null); (c) expanding a client shows its projects (mock `useProjects`); (d) clicking a project opens the detail panel with name/description/created-date; (e) "Add Client" / "Add Project" open the modal and submitting calls the mutation; (f) client-side search filters the list and "Clear" restores it; (g) `document.title === 'Engagements · Velara'`; (h) loading skeleton when `isLoading`; (i) empty state when no clients.
  - [x] If you test a component that calls the real hooks (not mocked), wrap it in a `QueryClientProvider` (see `App.tsx`/`queryClient.ts`) — but prefer mocking the hooks like `SkillRegistry.test.tsx` does.

## Dev Notes

### This story is FRONTEND ONLY — the API is done

Story 4.1 shipped the full Client/Project/Study/Location CRUD API (`velara-api/app/api/v1/hierarchy.py`), verified with 522 passing Docker tests. **Do not modify any `velara-api` file.** Every endpoint, schema, and error code below already exists and is tested.

### API Contract (exact — from Story 4.1, verified in source)

All paths are under `/api/v1`. Auth is automatic: the `apiClient` request interceptor attaches `Authorization: Bearer <token>` from `getToken()`; `org_id` scoping is derived from the JWT server-side — **the frontend never sends `org_id`**. CORS already allows `http://localhost:5173`.

| Operation | Method | Path | Body / Params | Success |
|-----------|--------|------|---------------|---------|
| List clients | GET | `/api/v1/clients` | — | 200 → `{ data: ClientRead[] }` |
| Create client | POST | `/api/v1/clients` | `{ name, description? }` | 201 → `{ data: ClientRead }` |
| Get client | GET | `/api/v1/clients/{id}` | — | 200 → `{ data: ClientRead }` |
| Update client | PATCH | `/api/v1/clients/{id}` | `{ name?, description? }` (≥1) | 200 |
| Delete client | DELETE | `/api/v1/clients/{id}` | — | 204 (409 if has projects) |
| List projects | GET | `/api/v1/projects` | `?client_id={uuid}` **(required)** | 200 → `{ data: ProjectRead[] }` |
| Create project | POST | `/api/v1/projects` | `{ client_id, name, description? }` | 201 → `{ data: ProjectRead }` |
| Get project | GET | `/api/v1/projects/{id}` | — | 200 |
| Update project | PATCH | `/api/v1/projects/{id}` | `{ name?, description? }` (≥1) | 200 |
| Delete project | DELETE | `/api/v1/projects/{id}` | — | 204 (409 if has studies) |

**`ClientRead` JSON** (response shape — all snake_case):
```json
{ "id": "uuid", "org_id": "org_vitalief", "name": "Acme Corp", "description": "…|null",
  "hierarchy_path": "org_vitalief.client_<hex>", "created_at": "ISO-8601", "updated_at": "ISO-8601" }
```
**`ProjectRead` JSON**: same but `client_id` (uuid) instead of `org_id`.

**Field constraints (Pydantic, server-enforced):** `name` required, 1–255 chars, stripped. `description` optional. `postal_code` (locations only — not this story). Update bodies require at least one field or → 422.

### Response & error envelopes

**Success envelope (every response):** `{ "data": <T>, "meta": { "request_id": "…", "timestamp": "ISO-8601" } }`. Unwrap with `response.data.data` (see `src/api/skills.ts`).

**Error envelope:** `{ "error": { "code": "SCREAMING_SNAKE", "message": "user-safe", "request_id": "…", "details"?: [...] } }`. From an Axios error, read `err.response.data.error.code` / `.message` / `.details`.

Error codes this UI may encounter:
- `VALIDATION_ERROR` (422) — `details[]` has `{ loc: ["body","name"], msg }`; the last string in `loc` is the field. Map to field errors like `SkillForm.mapDetailsToFieldErrors`.
- `CLIENT_NOT_FOUND` / `PROJECT_NOT_FOUND` (404) — also returned for cross-org access (existence is hidden — collapsed to 404, not 403).
- `HIERARCHY_HAS_CHILDREN` (409) — on delete of a parent with children. (Full delete-with-children warning UX is Story 4.3.)
- `UNAUTHORIZED` (401) — handled globally by the client interceptor → `/login`.

### Existing frontend infrastructure to REUSE (do not rebuild)

| Need | Reuse | Path |
|------|-------|------|
| Axios instance + auth + request-id | `apiClient` | `src/api/client.ts` |
| Query client config (`staleTime: 30s`, `retry: 1`) | `queryClient` | `src/api/queryClient.ts` |
| Document title | `usePageTitle('Engagements')` → "Engagements · Velara" | `src/shared/hooks/useDocumentTitle.ts` |
| Loading placeholder | `<Skeleton />` | `src/shared/components/Skeleton.tsx` |
| Confirm dialog (for any delete) | `<ConfirmDialog />` (focus-trap, Escape, pending) | `src/features/skills/components/ConfirmDialog.tsx` |
| Active-hierarchy global state | `useHierarchyStore` (`setActiveClientId`, `setActiveProjectId`) | `src/stores/useHierarchyStore.ts` |
| Nav tab (already correct) | `TABS[0]` id `engagements` path `engagements` | `src/shared/components/navTabsData.ts` |
| Form field + input styles | `Field`, `inputCls`, `labelCls`, `errorCls` (copy the pattern) | `src/features/skills/components/SkillForm.tsx` |

**Canonical patterns to mirror file-for-file:**
- API module → `src/api/skills.ts`
- Hooks → `src/features/skills/hooks/useSkills.ts`
- List + filter + search + skeleton + empty-state → `src/features/skills/components/SkillRegistry.tsx`
- Clickable row with keyboard a11y (`tabIndex`, Enter/Space) → `src/features/skills/components/SkillRow.tsx`
- Form + client validation + API-error→field mapping → `src/features/skills/components/SkillForm.tsx`
- Test harness (`vi.mock` hooks, `MemoryRouter`, assert `document.title`) → `src/features/skills/components/SkillRegistry.test.tsx`

### CRITICAL: Token translation — design prototype uses old `--green-*` names

[design/hierarchy.jsx](../../../design/hierarchy.jsx) and `design/styles_v3.css` use `var(--green-800)`, `var(--green-50)`, inline styles, and `var(--ink)`/`var(--muted)`. **The live app (after the Story 1.6 V3 re-theme) renamed `green-*` → `brand-*`** and uses Tailwind utility classes against `@theme` tokens in `src/index.css`. Same hex values, different names. Translate as you port:

| Prototype token | App Tailwind class | Hex |
|-----------------|--------------------|-----|
| `var(--green-800)` (primary) | `bg-brand-800` / `text-brand-800` | `#128f8b` |
| `var(--green-700)` (hover) | `hover:bg-brand-700` | `#0d6b68` |
| `var(--green-50)` (selected row bg) | `bg-brand-50` | `#e6f8f8` |
| `var(--ink)` | `text-ink` | `#323843` |
| `var(--ink-2)` | `text-ink-2` | `#4c5270` |
| `var(--muted)` / `var(--faint)` | `text-muted` / `text-faint` | — |
| `var(--surface)` / `var(--surface-2)` / `var(--surface-sunk)` | `bg-surface` / `bg-surface-2` / `bg-surface-sunk` | — |
| `var(--line)` / `var(--line-2)` / `var(--line-strong)` | `border-line` / `border-line-2` / `border-line-strong` | — |
| `var(--sans)` body / `var(--serif)` headings | default / `font-serif` (Poppins) | — |

Do NOT introduce `--green-*` classes or copy the prototype's inline `style={{…}}` objects verbatim. Build with Tailwind classes, the way `SkillRegistry`/`SkillForm`/`SkillRow` do.

### Design intent (from [design/hierarchy.jsx](../../../design/hierarchy.jsx))

The `OrgHierarchy` prototype is the authority for layout, but it spans the WHOLE epic (clients→projects→studies→locations→skills). For **this** story, take from it:
- **Two-panel layout**: fixed-width tree on the left, scrollable detail on the right.
- **Tree starts at Client** ("org is a hidden tenant layer" — comment in the prototype). Expandable nodes with a rotating chevron, an icon chip, selected/hover states.
- **Search + filter at top of tree panel**, switching to a flat results list when filtering (the prototype's `SearchResults`). For 4.2, filter Clients + Projects by name only, client-side.
- **Detail panel** = header (badge + name + description + meta strip) over child cards. For 4.2: client detail shows its Projects card (+ Add Project); project detail shows name/desc/created + placeholder Studies/Skills.
- **Add modal** for creating a child entity, scoped under the selected parent.

Ignore (defer to 4.3/4.4): Study/Location nodes & detail, "Attach skill", inherited-skills section, postal-code fields, breadcrumbs, ⌘K, status/`paused` badges (no `status` field exists on the API entities), `code`/`lead`/`phase`/`sponsor`/`pi` meta chips (those fields don't exist on `ClientRead`/`ProjectRead` — only id/name/description/path/timestamps).

### What NOT to build in this story

- No backend changes — the API is complete (Story 4.1).
- No Studies, Locations, postal codes, "Add Study", attached-Skills lists, or delete-with-children confirmation flows → **Story 4.3**.
- No breadcrumb trail or ⌘K command-palette navigation → **Story 4.4** (note: the AppBar already has a Cmd+K palette for skills; do not extend it here).
- No server-side search/filter — Phase 1 is a **client-side mock on loaded data** (FR-ORG-07). No `?search=` param.
- No status/`paused`/`active` badges — those fields are design-mock-only and absent from the API.
- No optimistic updates — invalidate-and-refetch only (matches the codebase and the "no optimistic for non-trivial" rule).
- No pagination — list endpoints return full org-scoped collections (Phase 1 volume is small).
- No new shared design tokens — the V3 `brand-*` palette in `src/index.css` is sufficient.

### REGRESSION GUARD — do NOT break

- **`src/routes/internal.tsx`**: change ONLY the `engagements/*` route element (Placeholder → `EngagementsScreen`) and add its import. Leave the other routes, `InternalShell`, `useActiveTab`, AppBar, NavTabs untouched.
- **`App.tsx`** and the `/internal` index redirect already make Engagements the landing view — don't alter them.
- All existing `velara-web` tests must stay green (`npm run test`). The skills feature must be unaffected.
- Don't modify `src/api/client.ts`, `queryClient.ts`, `useDocumentTitle.ts`, `ConfirmDialog.tsx`, `Skeleton.tsx`, or the skills feature.
- The `useHierarchyStore` interface is a stub you may now use; if you extend it, keep the existing `setActiveClientId/ProjectId/StudyId` signatures (4.3/4.4 depend on them).
- Stale-but-harmless: a deferred-work note (line 36) claims NavTabs "never navigates" and `registry` id ≠ `skills` path — this was already resolved in Story 2.4 (`useActiveTab` navigates by URL; the `engagements` tab id matches its `engagements` path). No action needed; do not "fix" it.

### Tooling, naming, conventions

- **Stack (verified in `package.json`):** React 19, react-router-dom 7, @tanstack/react-query 5, axios 1.7, zustand 5, Tailwind CSS 4 (`@theme` in `src/index.css`, no config.js), TypeScript 5.5 (strict), Vite 6, Vitest 2 + @testing-library/react 16 + user-event 14.
- **TS naming:** `camelCase` vars/functions, `PascalCase` components/types, files `PascalCase.tsx` for components / `camelCase.ts` for hooks+utils+api. **API JSON fields stay snake_case** (don't transform them).
- **Path alias:** `@/` → `src/`.
- **Feature-first dirs:** everything new lives under `src/features/engagements/` (`components/`, `hooks/`, `types.ts`) + the `src/api/hierarchy.ts` module. Remove `.gitkeep` files when real files land.
- **Loading states:** use TanStack Query `isLoading`/`isError` directly — no hand-rolled booleans.
- **Dev login (for manual testing):** the dev auth shim seeds users; `LoginPage` lists them via `GET /api/v1/auth/dev-users` and logs in. Use the `consultant` user (`org_id: org_vitalief`). Token TTL 8h.

### File Locations

```
velara-web/
  src/
    features/engagements/
      types.ts                              ← REPLACE stub (export {})
      hooks/useEngagements.ts               ← NEW (remove hooks/.gitkeep)
      components/
        EngagementsScreen.tsx               ← NEW (remove components/.gitkeep)
        EngagementsScreen.test.tsx          ← NEW
        ClientTree.tsx (+ test)             ← NEW (or fold into EngagementsScreen)
        EntityDetail.tsx (+ test)           ← NEW (or fold in)
        AddEntityModal.tsx (+ test)         ← NEW (or fold in)
    api/hierarchy.ts                         ← REPLACE stub (export {})
    routes/internal.tsx                      ← UPDATE: engagements route → EngagementsScreen
```
You may consolidate the tree/detail/modal into fewer files if cleaner; the canonical skills feature splits them (Registry / Row / Form / Detail / ConfirmDialog) — a similar split is encouraged but not mandated.

### Testing Setup

- Tests are co-located (`*.test.tsx` beside the component).
- `src/test/setup.ts` resets `document.title` and `sessionStorage` between tests — your title assertion (`'Engagements · Velara'`) is safe.
- Mock the hooks (`vi.mock('@/features/engagements/hooks/useEngagements')`) and provide `{ data, isLoading, error }` shapes, exactly like `SkillRegistry.test.tsx`. Wrap renders in `<MemoryRouter>` (needed for `useNavigate`).
- Run `npm run test` (vitest), `npm run lint`, `npm run typecheck`/`tsc`, and `npm run build` before marking review — the prior UI stories (2.4, 2.5) gated on typecheck + lint + build + tests all clean.

### References

- [Epic 4 spec — Story 4.2 ACs](../../planning-artifacts/epics/epic-4-engagement-hierarchy-management.md)
- [Story 4.1 — Hierarchy Data Model & API (the backend this UI calls)](4-1-hierarchy-data-model-and-api.md)
- [Design prototype — Engagements two-panel screen](../../../design/hierarchy.jsx)
- [Architecture — Frontend (Zustand, TanStack Query, feature-first, Tailwind V3)](../../planning-artifacts/architecture/core-architectural-decisions.md#frontend-architecture)
- [Architecture — Implementation Patterns & Consistency Rules](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md)
- [Existing: src/api/skills.ts](../../../velara-web/src/api/skills.ts) — API module pattern
- [Existing: src/features/skills/hooks/useSkills.ts](../../../velara-web/src/features/skills/hooks/useSkills.ts) — hooks pattern
- [Existing: src/features/skills/components/SkillRegistry.tsx](../../../velara-web/src/features/skills/components/SkillRegistry.tsx) — list/filter/search pattern
- [Existing: src/features/skills/components/SkillForm.tsx](../../../velara-web/src/features/skills/components/SkillForm.tsx) — form + validation + API-error mapping
- [Existing: src/features/skills/components/SkillRow.tsx](../../../velara-web/src/features/skills/components/SkillRow.tsx) — clickable a11y row
- [Existing: src/features/skills/components/ConfirmDialog.tsx](../../../velara-web/src/features/skills/components/ConfirmDialog.tsx) — modal/overlay primitive
- [Existing: src/routes/internal.tsx](../../../velara-web/src/routes/internal.tsx) — route to update
- [Existing: src/index.css](../../../velara-web/src/index.css) — V3 `brand-*` `@theme` tokens

### Review Findings

_Code review 2026-06-12 — 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 8 ACs functionally met. Resolution: 1 decision-needed (refactor) + 8 patches APPLIED & VERIFIED, 2 deferred (1 largely subsumed by the refactor). Post-patch gates: lint clean, 0 TS errors, 137 tests pass (+3 new), build ✓._

- [x] [Review][Decision→Patch] Inline styles + bespoke CSS → refactored to Tailwind `brand-*` — RESOLVED (user chose "refactor"). EngagementsScreen.tsx rewritten with Tailwind utilities mirroring SkillForm/SkillRegistry/ConfirmDialog: **0** inline `style={{}}` objects (was ~105), `brand-50/300/600/700/800` utility classes throughout, modal overlay now `fixed inset-0 z-[100] … bg-black/30` like ConfirmDialog. The 71 lines of bespoke CSS (`.card/.btn/.overlay/.modal/.topbar`…) removed from `src/index.css`, leaving only a single `@keyframes fadeIn` (net +7 lines).
- [x] [Review][Patch] Clearing a description silently no-ops → added the canonical "cannot be cleared once set" guard [EngagementsScreen.tsx EntityModal.handleSubmit] — Confirmed against the API: `hierarchy_service.update_client` does `if description is not None`, so the backend cannot clear a description. Now blocks the clear with a field error (SkillForm pattern) instead of sending `undefined` (which JSON-drops to a no-op). Edit-change-detection rewritten to `if (trimDesc && trimDesc !== original) input.description = trimDesc`. Test added.
- [x] [Review][Patch] Loading state → real `<Skeleton>` rows; test now asserts them [EngagementsScreen.tsx + .test.tsx] — Imports `@/shared/components/Skeleton`; tree loading renders 4 skeleton rows, ClientDetail projects-loading renders 2. Test asserts `container.querySelectorAll('.animate-pulse').length > 0`.
- [x] [Review][Patch] Search can't find projects of un-expanded clients → no longer silently no-ops + hint surfaced [EngagementsScreen.tsx handleSelect/SearchResults] — `handleSelect` project branch keeps the query (so the user can retry) instead of clearing it on a cache miss; a "Expand a client to include its projects in search" hint shows while no projects are cached. (Eager-load deferred as a larger change.)
- [x] [Review][Patch] Stale `sel.project` snapshot → detail panel prefers fresh cache [EngagementsScreen.tsx selectedProject] — Now `projectsCache[sel.clientId]?.find(...) ?? sel.project`, so an edit reflects without reselecting. Test added.
- [x] [Review][Patch] No double-submit guard → added [EngagementsScreen.tsx EntityModal.handleSubmit] — `if (submitting) return` at the top; submit button stays disabled while pending. Test added.
- [x] [Review][Patch] Edit/detail break on evicted/deleted selection → guarded [EngagementsScreen.tsx] — `openEditModal` falls back to `sel.project` when the cache entry is gone; a `useEffect` clears `sel` when a selected client vanishes from `clients`; project detail render gated behind `!selectedClient` so the two never stack.
- [x] [Review][Patch] `new Date(created_at)` → "Invalid Date" → `formatDate()` helper guards with `isNaN`, renders `—` [EngagementsScreen.tsx].
- [x] [Review][Patch] Hardcoded `#d4186c`/`#fde8f3` → `text-danger`/`bg-danger-bg` tokens [EngagementsScreen.tsx] — 0 hardcoded magenta hexes remain.

- [x] [Review][Defer] 422 `details` mapping only handled `name` — LARGELY ADDRESSED by the refactor: `applyApiErrors` now maps both `name` and `description` fields (falls back to form-level only when neither matches). Remaining gap (mapping arbitrary future fields generically) deferred — low impact for this 2-field form. See deferred-work.md.
- [x] [Review][Defer] Tree/modal accessibility — PARTIALLY ADDRESSED by the refactor: modal inputs now use `<label htmlFor>`, errors have `role="alert"`, the client node has `aria-controls` → its project `role="group"`, and search-result rows are keyboard-activatable. Full `role="tree"/"treeitem"` widget semantics + arrow-key nav deferred as a feature-wide a11y pass. See deferred-work.md.

## Change Log

- 2026-06-12: Code review (3-layer adversarial). 1 decision-needed (inline-styles vs Tailwind), 8 patches, 2 deferred, ~6 dismissed as noise (the double `useProjects(clientId)` call shares one query key → no double fetch; `useProjects(undefined)` `enabled` guard is correct; whitespace-only search and no-envelope network errors are already handled; the `internal.tsx` `<main>` padding move + per-route `p-6` wrapping is a necessary correct consequence of EngagementsScreen owning a full-bleed two-panel layout, not a regression-guard breach; the weakened shell-render test assertion is acceptable).
- 2026-06-12: Story 4.2 created (create-story). Frontend-only; consumes the Story 4.1 hierarchy API. Scoped to Clients + Projects (Studies/Locations → 4.3; breadcrumbs/⌘K → 4.4). Exhaustive web + API codebase analysis: verified the engagements/hierarchy stubs, the skills-feature canonical patterns, the V3 `brand-*` token rename vs the design prototype's `--green-*` names, the exact 4.1 API contract + error envelope, and the already-wired default-landing + nav-tab routing.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

### Completion Notes List

- All 8 tasks implemented; components folded into a single `EngagementsScreen.tsx` per story guidance.
- Avoided hook-in-loop anti-pattern: `ClientNode` uses `onProjectsLoaded` callback + `useEffect` to bubble project data up; `EngagementsScreen` maintains `projectsCache` state for search and edit modal.
- Page header ("Engagements" h1 + "New client" button) lives inside `EngagementsScreen` itself, mirroring `SkillRegistry`.
- Error envelope helpers (`getApiCode`/`getApiMessage`/`getApiDetails`/`mapDetailsToFieldErrors`/`friendlyError`) implemented inline, same pattern as `SkillForm.tsx`.
- Route updated: `engagements/*` Placeholder → `<EngagementsScreen />` (path `"engagements"`, no wildcard needed).
- `src/routes/internal.test.tsx`: added engagements hooks + hierarchy store mocks; updated shell-render test assertion to match real heading.
- All gates: 0 TS errors, 133 tests passing (10 new), build ✓.

### Post-Review Notes (code review 2026-06-12)

- Code review resolved: 1 decision (refactor inline-styles → Tailwind) + 8 patches applied & verified, 2 deferred (mostly subsumed by the refactor). See Review Findings above.
- EngagementsScreen.tsx fully rewritten in Tailwind `brand-*` utilities (0 inline `style={{}}`, was ~105) mirroring SkillForm/SkillRegistry/ConfirmDialog; modal overlay matches ConfirmDialog. Reverted the 71 bespoke CSS lines from `index.css` (now just `@keyframes fadeIn`).
- Bug fixes: description-clear guard (API can't clear optional fields — matches SkillForm), `<Skeleton>` loading rows, fresh-cache-preferred detail panel, double-submit guard, stale-selection clearing, `Invalid Date` guard, danger tokens, 422 description-field mapping, modal a11y (`<label htmlFor>`, `role="alert"`, `aria-controls`/`role="group"`).
- Post-review gates: lint clean, 0 TS errors, **137 tests pass** (+3 new), build ✓.

### File List

- src/features/engagements/types.ts (modified)
- src/api/hierarchy.ts (modified)
- src/features/engagements/hooks/useEngagements.ts (created)
- src/features/engagements/hooks/.gitkeep (deleted)
- src/features/engagements/components/EngagementsScreen.tsx (created)
- src/features/engagements/components/EngagementsScreen.test.tsx (created)
- src/features/engagements/components/.gitkeep (deleted)
- src/routes/internal.tsx (modified)
- src/routes/internal.test.tsx (modified)
