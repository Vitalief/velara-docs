---
baseline_commit: f90d9f572f76b3bdd6b756192475fb6846dd55f5
---

# Story 4.3: Study & Location Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to create and manage Studies and Locations (with postal codes) within Projects,
so that clinical trial contexts are properly structured and location-dependent skills have the site data they need.

## Acceptance Criteria

> **BDD source:** [epic-4-engagement-hierarchy-management.md#story-43](../../planning-artifacts/epics/epic-4-engagement-hierarchy-management.md). **FR source:** ORG-01–ORG-06 (Study/Location entities, postal_code required, child-guard delete). **Architecture:** core-architectural-decisions.md (Frontend — feature-first, Zustand, TanStack Query, Tailwind V3). **Design:** [design/hierarchy.jsx](../../../design/hierarchy.jsx) (full Client→Project→Study→Location prototype). **API:** built & verified by Story 4.1 (studies + locations CRUD). **Extends:** Story 4.2 `EngagementsScreen.tsx`.

**This is a frontend-only story that EXTENDS the Story 4.2 Engagements screen.** The hierarchy API (studies + locations CRUD, with child-guard delete) was delivered and verified by Story 4.1 (`velara-api`, 522 Docker tests pass). Do **not** touch the backend. You are deepening the existing two-panel `EngagementsScreen` ([velara-web/src/features/engagements/components/EngagementsScreen.tsx](../../../velara-web/src/features/engagements/components/EngagementsScreen.tsx)) to add the Study (child of Project) and Location (child of Study) levels, including the **first delete-with-confirmation flow** in the engagements feature.

**Scope boundary (read first):**
- **IN scope:** Study CRUD (create/read/edit/delete), Location CRUD (create/read/edit/delete) with required `postal_code`, the tree extended to 4 levels (Client→Project→Study→Location), Study/Location detail panels, the "delete Study that has Locations → warning + confirm" flow, and search extended to match Studies/Locations.
- **OUT of scope:** Breadcrumb trail + ⌘K navigation → **Story 4.4**. Skill attachment to projects/studies/locations → **later epic** (keep the existing placeholder "Attached skills" card as-is — do not wire it). Hierarchy-scoped RBAC → Epic 8.
- **Replace the two 4.2 placeholders** in `ProjectDetail` (the disabled "Studies" card that says "Study management arrives in Story 4.3", and leave the "Attached skills" placeholder untouched).

1. **Add Study from a Project detail panel.**
   **Given** I am viewing a Project detail panel
   **When** I click "Add Study" and fill name (required) + description (optional) and submit
   **Then** `POST /api/v1/studies` is called with the parent `project_id`; on HTTP 201 the study appears in the project's Studies list and tree immediately, and the modal closes

2. **Studies appear as tree children of their project; labeled as Study; optional.**
   **Given** a study exists under a project
   **When** I expand the project node in the tree
   **Then** the study appears as a child node, visually labeled/iconed as a **Study** — projects with no studies show no study children (studies are optional)

3. **Add Location within a Study — full field set.**
   **Given** I click "Add Location" within a Study (study detail panel or study node)
   **When** the modal opens
   **Then** it contains fields for: **name** (required), **address**, **city**, **postal code (required)**, and **PI name** (and an optional description)

4. **Postal code is required — blocked inline.**
   **Given** I submit the Add Location form without a postal code
   **When** the form validates
   **Then** submission is blocked and a "Postal code is required" error appears inline on the postal_code field (client-side; the API also enforces 422 if it slips through)

5. **Location detail shows + persists postal code.**
   **Given** a Location is created with a postal code
   **When** I view the location detail
   **Then** the postal code (and address, city, PI name when present) is displayed; it is persisted on the location entity (the API stores it — verified by 4.1)

6. **Delete a Study with Locations → explicit warning + confirm.**
   **Given** I delete a Study that has N locations
   **When** I attempt the deletion
   **Then** a confirmation dialog warns "This study has {N} location(s). Deleting it will also remove all locations." and requires explicit confirmation before calling `DELETE /api/v1/studies/{id}`.
   *(Backend note: the API does NOT cascade — it returns HTTP 409 `HIERARCHY_HAS_CHILDREN` if children exist. So the frontend must delete the locations first, OR — simpler and matching the warning copy — surface the 409 as a clear message if the user confirms but children remain. See Dev Notes "Delete semantics" for the required approach.)*

7. **Project with no Studies still shows a Skills section directly on the project.**
   **Given** a project has no studies
   **When** I view the project detail/tree node
   **Then** the project detail still surfaces a project-level "Skills" section (the existing placeholder "Attached skills" card stays — skill attachment itself is a later story). Do not hide it; do not block adding studies because of it. *(This AC is about layout intent: skills can attach at the project level when there are no studies. For 4.3, keep the placeholder Skills card visible on the project detail alongside the now-real Studies card.)*

## Tasks / Subtasks

- [x] **Task 1 — Extend domain types: `src/features/engagements/types.ts` (AC: 1, 2, 3, 4, 5)**
  - [x] Add (do NOT remove the existing `Client`/`Project` types):
  - [x] `Study`: `{ id: string; project_id: string; name: string; description: string | null; hierarchy_path: string; created_at: string; updated_at: string }`
  - [x] `Location`: `{ id: string; study_id: string; name: string; description: string | null; hierarchy_path: string; postal_code: string; address: string | null; city: string | null; pi_name: string | null; created_at: string; updated_at: string }`
  - [x] `StudyCreateInput`: `{ project_id: string; name: string; description?: string }`
  - [x] `StudyUpdateInput`: `{ name?: string; description?: string }`
  - [x] `LocationCreateInput`: `{ study_id: string; name: string; postal_code: string; description?: string; address?: string; city?: string; pi_name?: string }`
  - [x] `LocationUpdateInput`: `{ name?: string; postal_code?: string; description?: string; address?: string; city?: string; pi_name?: string }`
  - [x] Field names are snake_case (API JSON contract) — do NOT camelCase `postal_code`, `pi_name`, `study_id`, `project_id`.

- [x] **Task 2 — Extend API module: `src/api/hierarchy.ts` (AC: 1, 2, 3, 5, 6)**
  - [x] Mirror the existing client/project functions exactly (each unwraps `response.data.data`). Add:
  - [x] `listStudies(projectId: string): Promise<Study[]>` → `apiClient.get('/api/v1/studies', { params: { project_id: projectId } })` — **`project_id` is a REQUIRED query param.**
  - [x] `createStudy(input: StudyCreateInput): Promise<Study>` → `POST /api/v1/studies`
  - [x] `updateStudy(id, input: StudyUpdateInput): Promise<Study>` → `PATCH /api/v1/studies/${id}`
  - [x] `deleteStudy(id: string): Promise<void>` → `DELETE /api/v1/studies/${id}` (204; 409 `HIERARCHY_HAS_CHILDREN` if locations exist)
  - [x] `listLocations(studyId: string): Promise<Location[]>` → `apiClient.get('/api/v1/locations', { params: { study_id: studyId } })` — **`study_id` REQUIRED.**
  - [x] `createLocation(input: LocationCreateInput): Promise<Location>` → `POST /api/v1/locations`
  - [x] `updateLocation(id, input: LocationUpdateInput): Promise<Location>` → `PATCH /api/v1/locations/${id}`
  - [x] `deleteLocation(id: string): Promise<void>` → `DELETE /api/v1/locations/${id}` (204; leaf — no children)

- [x] **Task 3 — Extend hooks: `src/features/engagements/hooks/useEngagements.ts` (AC: 1, 2, 3, 5, 6)**
  - [x] Query keys follow the existing `[resource, parentId]` convention: `['studies', projectId]`, `['locations', studyId]`.
  - [x] `useStudies(projectId: string | undefined)` → `useQuery({ queryKey: ['studies', projectId], queryFn: () => listStudies(projectId!), enabled: !!projectId })`
  - [x] `useLocations(studyId: string | undefined)` → same pattern, `enabled: !!studyId`
  - [x] `useCreateStudy()` → on success `invalidateQueries({ queryKey: ['studies', input.project_id] })`
  - [x] `useUpdateStudy(id, projectId)` → invalidate `['studies', projectId]`
  - [x] `useDeleteStudy(projectId)` → `mutationFn: (id) => deleteStudy(id)`; on success invalidate `['studies', projectId]`
  - [x] `useCreateLocation()` → invalidate `['locations', input.study_id]`
  - [x] `useUpdateLocation(id, studyId)` → invalidate `['locations', studyId]`
  - [x] `useDeleteLocation(studyId)` → invalidate `['locations', studyId]` (and `['studies', projectId]` is NOT needed — study list doesn't show location counts unless you add them)
  - [x] **Note:** 4.2 deliberately did NOT add delete hooks. These are the first. No optimistic updates — invalidate-and-refetch (matches the codebase).

- [x] **Task 4 — Extend entity metadata, icons, and shared unions in `EngagementsScreen.tsx` (AC: 2, 3)**
  - [x] Add `study` and `location` to the `ENTITY` map (label/icon/text/bg). Suggested (matching the design prototype `ENTITY` colors translated to the same `text-[#…]`/`bg-[#…]` inline-Tailwind style 4.2 used): `study: { label: 'Study', icon: 'flask', text: 'text-[#5a4a7a]', bg: 'bg-[#ece8f4]' }`, `location: { label: 'Location', icon: 'pin', text: 'text-[#2e7a6a]', bg: 'bg-[#e0f0ec]' }`.
  - [x] Add the `flask` and `pin` SVG paths to the `ICONS` map (4.2's set lacks them). From the design prototype: `pin: 'M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7zm0 4a3 3 0 100 6 3 3 0 000-6z'`, `flask: 'M9 3h6m-3 0v6l-4 8h10L14 9V3M5 19h14'`. Also add a `trash` icon for delete buttons (e.g. `'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6'`).
  - [x] Widen the `EntityBadge` prop type from `'client' | 'project'` to `'client' | 'project' | 'study' | 'location'`.
  - [x] Widen `SearchResultItem.type` and the `Selection` union and the `ModalMode` union to include study/location (see Tasks 5–7).

- [x] **Task 5 — Extend the tree to 4 levels (AC: 2)**
  - [x] The 4.2 tree is **not recursive**: `ClientNode` renders the client + a flat list of project rows. For 4.3, add the study and location levels. Two acceptable approaches (pick the lower-risk one — **extend in place, do NOT rewrite the whole screen**):
    - **(Recommended) Add sibling node components**: `ProjectNode` (renders a project row + its expandable studies via `useStudies`, gated on `isExpanded`), `StudyNode` (renders a study row + its expandable locations via `useLocations`). Each mirrors `ClientNode`'s pattern: chevron rotates on expand, child fetch is `enabled` only when expanded, child loading/error/empty states reuse the existing `Loading…`/`friendlyError`/"No … yet." idioms. Indent each level deeper (4.2 projects use `pl-6`; studies `pl-[42px]`, locations `pl-[60px]` or similar).
    - Locations are **leaf** nodes (no chevron, no expand) — like projects are today.
  - [x] Each expanded level must feed its loaded children into a cache for search (Task 8): add `studiesCache: Record<projectId, Study[]>` and `locationsCache: Record<studyId, Location[]>` plus `handleStudiesLoaded`/`handleLocationsLoaded` callbacks (mirror the existing `projectsCache` + `handleProjectsLoaded` referential-equality pattern at `EngagementsScreen.tsx:682-689`).
  - [x] Selecting any node sets `sel` to the right discriminated-union variant and writes hierarchy context (`useHierarchyStore.setActiveStudyId` exists; use it for studies — there is no `setActiveLocationId`, so leave location out of the store or extend the store minimally if needed, preserving existing signatures).

- [x] **Task 6 — Study & Location detail panels (AC: 5, 6, 7)**
  - [x] **Replace** the placeholder Studies card in `ProjectDetail` (`EngagementsScreen.tsx:586-599`) with a **real Studies card**: header "Studies · {count}" + "Add Study" button (now enabled), list of studies fetched via `useStudies(project.id)` rendered as clickable rows (mirror the existing Projects-card row markup), loading skeleton, error via `friendlyError`, and "No studies yet." empty state. **Keep** the "Attached skills" placeholder card below it untouched (AC7).
  - [x] `StudyDetail`: header (Study badge, name, description, Created/Project meta, Edit + **Delete** buttons) + a "Locations · {count}" card with "Add Location" button and a clickable list of locations (fetched via `useLocations(study.id)`).
  - [x] `LocationDetail`: header (Location badge, name, description, Edit + Delete buttons) + a meta strip showing **postal code** (always), address, city, PI name (when present) using the existing `MetaChip` component.
  - [x] Wire the detail-panel render switch in the main component (`EngagementsScreen.tsx:893-911`) to render `StudyDetail`/`LocationDetail` for the new selection variants, preferring fresh cache entries over the selection snapshot (mirror the existing P5 "fresh cache preferred" pattern at lines 778-784).

- [x] **Task 7 — Extend `EntityModal` for studies and locations (AC: 1, 3, 4)**
  - [x] Add four `ModalMode` variants: `add-study` (carries `projectId`, `projectName`), `edit-study` (carries `study`, `projectName`), `add-location` (carries `studyId`, `studyName`), `edit-location` (carries `location`, `studyName`).
  - [x] Study form = same name + description fields as project (reuse the existing form body).
  - [x] **Location form adds fields**: `postal_code` (**required**), `address`, `city`, `pi_name` (all optional except postal_code), plus name + description. Render these conditionally when the modal is in an `add-location`/`edit-location` mode. Use the existing `Field`/`inputCls`/`labelCls`/`errorCls` markup pattern already in the modal.
  - [x] **Client-side validation (AC4)**: name required (1–255, trimmed); for locations, `postal_code` required (1–20, trimmed) → inline error "Postal code is required" if empty. Mirror the existing name-validation flow in `handleSubmit` (`EngagementsScreen.tsx:183-221`).
  - [x] Extend `handleSubmit` with study/location create/edit branches calling the new mutations; extend `applyApiErrors` so `postal_code` field errors from `details[]` (loc ends in `postal_code`) surface on that field.
  - [x] Preserve all existing modal behaviors: focus-trap (`handleTrapKey`), Escape-to-close-when-not-submitting, double-submit guard, "description cannot be cleared once set" on edit (apply the same clear-once-set guard to other optional fields you let users edit, OR keep it scoped to description as today — be consistent and note it).

- [x] **Task 8 — Extend search to Studies & Locations (AC: 2 — searchability)**
  - [x] Extend the `searchResults` `useMemo` (`EngagementsScreen.tsx:715-726`) to also iterate `studiesCache` (per project) and `locationsCache` (per study), pushing matching studies/locations with their `parentName`. Add `studiesCache`/`locationsCache` to the memo deps.
  - [x] Extend `SearchResultItem` to carry the new types + parent linkage needed for `handleSelect` to reconstruct the selection.
  - [x] Extend `handleSelect` (`EngagementsScreen.tsx:732-746`) so clicking a study/location result selects it (and, ideally, expands ancestors so it's visible — but full expand-to-reveal is a 4.4 nicety; minimally, select it and show its detail panel).
  - [x] Search stays a **client-side mock over already-loaded (cached) data** — do NOT add any `?search=` API param. Keep the existing "Expand a … to include its … in search" hint pattern if helpful (lines 840-844).

- [x] **Task 9 — Delete flows with ConfirmDialog (AC: 6)**
  - [x] Reuse `ConfirmDialog` from `@/features/skills/components/ConfirmDialog.tsx` (focus-trap, Escape, `pending` state — already battle-tested).
  - [x] **Study delete**: before opening the dialog, read the study's location count from `useLocations(study.id)` (or the `locationsCache`). Dialog message: `This study has {N} location(s). Deleting it will also remove all locations.` when N > 0, else a plain "Delete this study?". On confirm, run the delete per "Delete semantics" below.
  - [x] **Location delete**: simple confirm "Delete this location?" → `useDeleteLocation`.
  - [x] After a successful delete, clear the selection if the deleted entity was selected (mirror the existing stale-selection-clearing effect at `EngagementsScreen.tsx:772-776`) and invalidate the relevant query so the tree/list updates.
  - [x] Map `HIERARCHY_HAS_CHILDREN` (409) to a clear, **entity-aware** message — see Task 10 (the current `friendlyError` hardcodes "remove child projects first", which is wrong for studies).

- [x] **Task 10 — Make error mapping entity-aware (AC: 4, 6)**
  - [x] `friendlyError` (`EngagementsScreen.tsx:95-100`) hardcodes `HIERARCHY_HAS_CHILDREN` → "remove child projects first". Generalize it (e.g. "Cannot delete: remove its child items first." or pass the entity label) so a study-with-locations 409 reads sensibly.
  - [x] Add `STUDY_NOT_FOUND` / `LOCATION_NOT_FOUND` to the 404 branch ("This item no longer exists.").
  - [x] Ensure `postal_code` validation 422 (`VALIDATION_ERROR` with `details[].loc` ending in `postal_code`) maps to the postal_code field via the existing `mapDetailsToFieldErrors`.

- [x] **Task 11 — Tests (AC: all)**
  - [x] Extend/add tests in `EngagementsScreen.test.tsx` (and any new component test files) mirroring the existing harness: `vi.mock('@/features/engagements/hooks/useEngagements')`, mock `useHierarchyStore`, wrap in `<QueryClientProvider client={makeQC()}><MemoryRouter>…`. **You must add mock returns for the new hooks** (`useStudies`, `useLocations`, `useCreateStudy`, `useCreateLocation`, `useDeleteStudy`, `useDeleteLocation`, `useUpdateStudy`, `useUpdateLocation`) in `beforeEach`, or the component will throw.
  - [x] Required cases: (a) expand a project → studies appear as labeled child nodes (AC2); (b) project with no studies → no study children, Skills card still shown (AC7); (c) "Add Study" from project detail opens modal + submit calls `createStudy` (AC1); (d) "Add Location" modal shows name/address/city/postal_code/pi_name fields (AC3); (e) submitting Add Location with empty postal code shows "Postal code is required" and does NOT call `createLocation` (AC4); (f) location detail displays the postal code (AC5); (g) deleting a study with locations opens ConfirmDialog with the "{N} location(s)" warning and only calls `deleteStudy` after confirm (AC6); (h) search matches a study/location name. Keep all existing 4.2 tests green.

- [x] **Task 12 — Gates**
  - [x] `npm run typecheck` (0 errors — widening the unions touches several exhaustive switches; fix all), `npm run lint` clean, `npm run test` all pass (existing + new), `npm run build` succeeds.

### Review Findings

_Code review 2026-06-12 — 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 7 ACs PASS on the happy path; 145/145 tests green; only the 6 declared files changed; no scope or must-not-modify violations. 1 decision + 5 patches below (2 dismissed: documented address/city/pi_name clear no-op, latent EntityModal `key`)._

- [x] [Review][Patch] **AC6 cascade is bypassed for a study selected but never expanded** [EngagementsScreen.tsx:1323] — `requestDeleteStudy` reads the location list from `locationsCache[study.id]`, which is populated ONLY by tree expansion (`StudyNode`'s `onLocationsLoaded` effect, line 684). A study can be selected WITHOUT expanding it — via a **search result** (`selectStudy`, line 1249) or by clicking a row in the **ProjectDetail Studies card** (`onSelectStudy`, line 929). In those flows `deleteTarget.locations` is `[]`, so: the dialog shows "Delete this study?" (no "{N} location(s)" warning even though the study has locations), the cascade loop deletes nothing, and `deleteStudy.mutateAsync` then 409s `HIERARCHY_HAS_CHILDREN` → user sees "remove its child items first." This defeats AC6's core promise. `StudyDetail` calls `useLocations(study.id)` for its own card (line 960) but never feeds `locationsCache`. Found by Blind + Edge. **RESOLVED → fetch fresh at confirm time:** `confirmDelete` (study branch) fetches the live location list via `queryClient.fetchQuery(['locations', study.id])` before deciding the warning count and running the cascade — always correct regardless of expansion/cache staleness, and also closes the "child added after dialog opened" race. The dialog count is derived from the fresh list (with a brief counting state on open).

- [x] [Review][Patch] **Cascade delete is not partial-failure safe / not idempotent on retry** [EngagementsScreen.tsx:1346-1355] — the loop awaits `cascadeDeleteLocation.mutateAsync` over a frozen `deleteTarget.locations` snapshot; if delete #k fails it aborts (study left with some locations gone, study still present), and pressing Confirm again restarts at index 0 → re-deletes the already-gone locations (404 `LOCATION_NOT_FOUND`) and stalls before reaching the survivors. Make the loop tolerant (treat 404/NOT_FOUND as success) so retry converges.

- [x] [Review][Patch] **Stale-selection auto-clear only covers `client`; project/study/location render phantom panels** [EngagementsScreen.tsx:1367-1371] — the P7 effect only nulls `sel` when `sel.type === 'client'`. Combined with the `?? sel.study` / `?? sel.location` snapshot fallback (lines 1379-1384), a study/location removed by an external refetch keeps rendering a phantom detail panel, and Edit/Delete then operate on a non-existent entity. Extend the effect to project/study/location (clear when the entity is absent from its parent's loaded list).

- [x] [Review][Patch] **`selectStudy`/`selectLocation` leave a stale active-id chain in the hierarchy store** [EngagementsScreen.tsx:1191-1200] — `selectStudy` sets `activeProjectId`+`activeStudyId` but not `activeClientId`; `selectLocation` sets only `activeStudyId`. After a cross-branch search jump the store's active path is incoherent (e.g. `activeClientId` points at a different client than the selected study's parent). 4.4 depends on this store. Resolve the full ancestor chain on select.

- [x] [Review][Patch] **Search hint disappears before studies/locations are actually searchable** [EngagementsScreen.tsx:1231] — the hint is gated on `anyProjectsLoaded` (true after ANY one client expands), but `studiesCache`/`locationsCache` are filled only by expanding projects/studies. So the hint vanishes while telling the user search now "includes its projects, studies, and locations" — when only that one client's projects are cached. Tie the hint to actual search depth or reword it.

- [x] [Review][Patch] **`aria-controls` dropped from expandable tree rows (4.2 a11y regression)** [EngagementsScreen.tsx:841-889] — the refactored `TreeRow` sets `aria-expanded` but no longer wires `aria-controls={groupId}` to the `role="group"` it toggles (4.2's `ClientNode` did). The `groupId`s are still rendered but unreferenced. Re-add `aria-controls` on chevron rows.

## Dev Notes

### This story is FRONTEND ONLY — the API is done and verified

Story 4.1 shipped studies + locations CRUD with child-guard delete (`velara-api/app/api/v1/hierarchy.py`, `app/services/hierarchy_service.py`), all covered by 522 passing Docker tests. **Do not modify any `velara-api` file.** Every endpoint, schema, and error code below already exists.

### API Contract (Studies & Locations — exact, from 4.1 source)

Auth is automatic (the `apiClient` interceptor attaches the Bearer token; `org_id` scoping is server-side from the JWT — the frontend never sends it). CORS already allows `http://localhost:5173`.

| Operation | Method | Path | Body / Params | Success |
|-----------|--------|------|---------------|---------|
| List studies | GET | `/api/v1/studies` | `?project_id={uuid}` **(required)** | 200 → `{ data: StudyRead[] }` |
| Create study | POST | `/api/v1/studies` | `{ project_id, name, description? }` | 201 → `{ data: StudyRead }` |
| Get study | GET | `/api/v1/studies/{id}` | — | 200 |
| Update study | PATCH | `/api/v1/studies/{id}` | `{ name?, description? }` (≥1) | 200 |
| Delete study | DELETE | `/api/v1/studies/{id}` | — | 204 — **409 `HIERARCHY_HAS_CHILDREN` if it has locations** |
| List locations | GET | `/api/v1/locations` | `?study_id={uuid}` **(required)** | 200 → `{ data: LocationRead[] }` |
| Create location | POST | `/api/v1/locations` | `{ study_id, name, postal_code, description?, address?, city?, pi_name? }` | 201 → `{ data: LocationRead }` |
| Get location | GET | `/api/v1/locations/{id}` | — | 200 |
| Update location | PATCH | `/api/v1/locations/{id}` | any subset, ≥1 field | 200 |
| Delete location | DELETE | `/api/v1/locations/{id}` | — | 204 (leaf — always deletable) |

**`StudyRead` JSON:** `{ id, project_id, name, description|null, hierarchy_path, created_at, updated_at }`.
**`LocationRead` JSON:** `{ id, study_id, name, description|null, hierarchy_path, postal_code, address|null, city|null, pi_name|null, created_at, updated_at }`.

**Field constraints (server-enforced):** `name` required 1–255, stripped. `postal_code` required 1–**20**, stripped. PATCH bodies require ≥1 field → else 422. Both `StudyRead` and `LocationRead` use `from_attributes`.

### Delete semantics — the API does NOT cascade (critical for AC6)

The backend `delete_study` returns **HTTP 409 `HIERARCHY_HAS_CHILDREN`** if the study still has locations — it will **not** auto-delete them. The AC's warning copy ("Deleting it will also remove all locations") describes user intent, but the server won't cascade. **Required frontend approach:**

1. On "Delete study", read the location count (from `useLocations(study.id)` / `locationsCache`).
2. Show `ConfirmDialog` with `This study has {N} location(s). Deleting it will also remove all locations.` (or a plain prompt if N === 0).
3. On confirm: if N > 0, **delete each location first** (loop `deleteLocation` over the cached/fetched locations, await all), then `deleteStudy`. This makes the warning truthful. If any location delete fails, surface `friendlyError` and stop.
   - Alternative (acceptable, simpler): call `deleteStudy` directly and, on a 409, show "This study still has locations — remove them first." Choose approach (1) "delete-children-then-study" to honor the AC's "will also remove all locations" promise; document whichever you pick in the Completion Notes.
4. Locations are leaves — `deleteLocation` never 409s.

### Extend the as-built 4.2 screen — do NOT rewrite it

The entire engagements UI is **one 921-line file**: [velara-web/src/features/engagements/components/EngagementsScreen.tsx](../../../velara-web/src/features/engagements/components/EngagementsScreen.tsx). It is hardcoded to client/project (not generic). **For 4.3, extend in place** following the established patterns — adding study/location siblings to the existing tree/detail/modal/search, NOT refactoring to a generic tree engine (that's higher-risk and not required by any AC). Exact extension points (verified line numbers):

| What | Where (`EngagementsScreen.tsx`) | Change |
|------|----------------------------------|--------|
| `ICONS` map | lines 24-33 | add `flask`, `pin`, `trash` paths |
| `ENTITY` map | lines 50-53 | add `study`, `location` entries |
| `EntityBadge` prop type | line 55 | widen union to 4 types |
| `friendlyError` | lines 95-100 | entity-aware 409 + add STUDY/LOCATION_NOT_FOUND |
| `Selection` union | lines 110-113 | add `study`/`location` variants |
| `ModalMode` union | lines 117-121 | add add/edit study + location |
| `EntityModal` handleSubmit/fields | lines 183-318 | study + location branches; postal_code & extra location fields |
| `ClientNode` (tree) | lines 326-421 | add `ProjectNode` + `StudyNode` siblings (studies/locations) |
| `ProjectDetail` studies placeholder | lines 586-599 | **replace** with real Studies card (keep Skills placeholder 601-612) |
| Detail render switch | lines 893-911 | render StudyDetail/LocationDetail |
| `projectsCache` + `handleProjectsLoaded` | lines 682-689 | add `studiesCache`/`locationsCache` + handlers (same referential-equality pattern) |
| `searchResults` memo | lines 715-726 | iterate studies/locations caches |
| `handleSelect` | lines 732-746 | handle study/location result clicks |
| stale-selection effect | lines 772-776 | also clear study/location selections that vanish |

### Reusable infrastructure (from 4.2 + shared) — do NOT rebuild

| Need | Reuse | Path |
|------|-------|------|
| Error envelope helpers (`getApiCode`/`mapDetailsToFieldErrors`/`friendlyError`) | already in the file | `EngagementsScreen.tsx:75-100` |
| Form field styles (`inputCls`/`labelCls`/`errorCls`) | already in the file | `EngagementsScreen.tsx:70-73` |
| `Card`, `MetaChip`, `EntityBadge`, `Icon` primitives | already in the file | `EngagementsScreen.tsx` |
| `formatDate` (Invalid-Date-safe) | already in the file | `EngagementsScreen.tsx:103-106` |
| Confirm dialog (focus-trap, Escape, `pending`) | `ConfirmDialog` | `src/features/skills/components/ConfirmDialog.tsx` |
| Loading placeholder | `Skeleton` | `src/shared/components/Skeleton.tsx` |
| Active-hierarchy store (`setActiveStudyId` exists) | `useHierarchyStore` | `src/stores/useHierarchyStore.ts` |
| Axios client + auth + request-id | `apiClient` | `src/api/client.ts` |

### Design intent (from [design/hierarchy.jsx](../../../design/hierarchy.jsx))

The prototype `OrgHierarchy` / `EntityDetail` / `AddEntityModal` show the full 4-level screen — that is the authority for the study/location levels. Translate as in 4.2:
- **Tree** descends Client → Project → Study → Location with deeper indentation per level; study icon `flask`, location icon `pin` (already mapped above).
- **Study detail** = header + a Locations child card (+ Add Location).
- **Location detail** = header + a meta strip with postal code, city, PI name, address (the prototype `MetaChip`s: `Site city`, `Principal Investigator`, etc. — but only render fields the API returns: `postal_code`, `address`, `city`, `pi_name`).
- **Add Location modal fields** (prototype `ADD_FIELDS.location`): name, code(→ omit; no `code` field on API), city, PI. **The API's required field is `postal_code`** — the prototype labels it loosely; use the real `postal_code`.
- Prototype-only fields with **no API backing** (do NOT add): `code`, `phase`, `sponsor`, `lead`, `status`/`paused`, skill-attachment. Only id/name/description/path/timestamps (+ location's postal_code/address/city/pi_name) exist.
- Translate prototype `var(--green-*)`/`var(--ink)` etc. to the app's Tailwind `brand-*`/`text-ink`/`bg-surface` classes — same as 4.2 did. The 4.2 `ENTITY` map already uses literal `text-[#…]`/`bg-[#…]` for the per-entity accent swatches; keep that convention for study/location.

### What NOT to build

- No backend changes — studies/locations API is complete (Story 4.1).
- No breadcrumbs, no ⌘K navigation → **Story 4.4**.
- No skill attachment to projects/studies/locations — keep the existing placeholder "Attached skills" card; do not wire it (later epic).
- No server-side search — client-side mock over loaded data only (no `?search=` param).
- No generic tree-engine refactor — extend the existing hardcoded structure in place.
- No optimistic updates — invalidate-and-refetch (matches the codebase).
- No prototype-only entity fields (`code`/`phase`/`sponsor`/`lead`/`status`) — they don't exist on the API.

### REGRESSION GUARD — do NOT break

- All existing 4.2 tests + the whole `velara-web` suite must stay green (133 tests today). The skills feature is untouched.
- **Widening the `Selection`/`ModalMode`/`SearchResultItem`/`EntityBadge` unions will surface TypeScript exhaustiveness errors** in existing switches/ternaries — fix every one; `npm run typecheck` must be 0 errors. This is expected and is the safety net.
- Keep the existing 4.2 behaviors intact: P2 (description clear-once-set), P5 (fresh-cache-preferred detail), P6 (double-submit guard), P7 (stale-selection clearing), the `projectsCache` referential-equality pattern, and the "Expand a client to include its projects in search" hint.
- Do NOT modify `ConfirmDialog.tsx`, `Skeleton.tsx`, `client.ts`, `queryClient.ts`, or the skills feature.
- `useHierarchyStore` already has `setActiveStudyId`; if you need a location id, extend the store **additively** (keep all existing signatures) — 4.4 depends on this store.
- The route is already wired (`internal.tsx` → `EngagementsScreen`); no routing change needed.

### Tooling, naming, conventions (verified)

- **Stack:** React 19, react-router-dom 7, @tanstack/react-query 5, axios 1.7, zustand 5, Tailwind CSS 4 (`@theme` in `src/index.css`), TypeScript 5.5 strict, Vite 6, Vitest 2 + @testing-library/react 16 + user-event 14.
- **Tokens present in `src/index.css`:** `brand-50/300/600/700/800`, `danger` (#d4186c), `danger-bg` (#fde8f3), `ink`/`ink-2`/`muted`/`faint`, `surface`/`surface-2`/`surface-sunk`, `line`/`line-2`/`line-strong`. (The 4.2 review added the `danger` tokens — the modal/delete error styles use `text-danger`/`bg-danger-bg`.)
- **Naming:** TS `camelCase` vars, `PascalCase` components/types, files `PascalCase.tsx`/`camelCase.ts`. **API JSON stays snake_case** (`postal_code`, `pi_name`, `project_id`, `study_id`).
- **Path alias** `@/` → `src/`. **Feature dir:** `src/features/engagements/` + `src/api/hierarchy.ts`.
- **Dev login for manual test:** `LoginPage` → `consultant` seed user (`org_id: org_vitalief`). Token TTL 8h.

### File Locations

```
velara-web/
  src/
    features/engagements/
      types.ts                                ← EXTEND (add Study/Location + inputs)
      hooks/useEngagements.ts                 ← EXTEND (add study/location query+mutation hooks)
      components/
        EngagementsScreen.tsx                 ← EXTEND (tree/detail/modal/search + delete)
        EngagementsScreen.test.tsx            ← EXTEND (new hook mocks + study/location cases)
        (optionally split new pieces into StudyDetail.tsx / LocationDetail.tsx /
         ProjectNode.tsx / StudyNode.tsx if EngagementsScreen.tsx grows unwieldy —
         a split is encouraged but not required; keep imports/exports consistent)
    api/hierarchy.ts                           ← EXTEND (8 new study/location functions)
```
Splitting the now-large screen into per-component files is welcome (the file is ~921 lines and will grow). If you split, co-locate tests and keep the public `EngagementsScreen` export stable.

### Testing Setup

- Co-locate tests; `src/test/setup.ts` resets `document.title` + `sessionStorage` between tests.
- The 4.2 harness wraps in **both** `<QueryClientProvider client={makeQC()}>` (retry:false) **and** `<MemoryRouter>`, and mocks `useEngagements` + `useHierarchyStore`. **Add mock returns for every new hook** in `beforeEach` (a missing mock returns `undefined` → destructuring crash).
- Use `userEvent` for clicks/typing; assert with `screen.getByRole`/`getByText`. For the postal-code-required case, assert the error text appears AND the create mutation's `mutate` was NOT called.
- Run `npm run typecheck && npm run lint && npm run test && npm run build` before review (the prior UI stories gated on all four clean).

### References

- [Epic 4 — Story 4.3 ACs](../../planning-artifacts/epics/epic-4-engagement-hierarchy-management.md)
- [Story 4.2 — Engagements Screen (the screen you extend)](4-2-engagements-screen-client-and-project-management.md)
- [Story 4.1 — Hierarchy Data Model & API (the backend)](4-1-hierarchy-data-model-and-api.md)
- [Design prototype — full 4-level hierarchy screen](../../../design/hierarchy.jsx)
- [As-built screen: src/features/engagements/components/EngagementsScreen.tsx](../../../velara-web/src/features/engagements/components/EngagementsScreen.tsx)
- [As-built API: src/api/hierarchy.ts](../../../velara-web/src/api/hierarchy.ts)
- [As-built hooks: src/features/engagements/hooks/useEngagements.ts](../../../velara-web/src/features/engagements/hooks/useEngagements.ts)
- [As-built types: src/features/engagements/types.ts](../../../velara-web/src/features/engagements/types.ts)
- [Reusable: src/features/skills/components/ConfirmDialog.tsx](../../../velara-web/src/features/skills/components/ConfirmDialog.tsx)
- [Backend schemas: app/schemas/hierarchy.py](../../../velara-api/app/schemas/hierarchy.py) — Study/Location field contracts
- [Architecture — Implementation Patterns & Consistency Rules](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md)

## Change Log

- 2026-06-12: Story 4.3 created (create-story). Frontend-only; extends the as-built 4.2 `EngagementsScreen` to add Study & Location levels (4-level tree), Study/Location detail panels, required `postal_code`, and the engagements feature's first delete-with-confirmation flow. Exhaustive as-built analysis: mapped the exact 921-line `EngagementsScreen.tsx` extension points (line-referenced), confirmed the 4.1 studies/locations API + that delete does NOT cascade (409 child-guard → frontend must delete children first to honor AC6 copy), verified the `danger`/`brand-*` tokens, the `flask`/`pin` icons missing from 4.2's set, and the 4.2 test harness (QueryClientProvider + MemoryRouter + hook mocks). Scoped breadcrumbs/⌘K to 4.4 and skill-attachment to a later epic.
- 2026-06-12: Story 4.3 implemented (dev-story). All 7 ACs satisfied; all 12 tasks complete. Extended the as-built 4.2 screen in place (no rewrite, no generic tree-engine) to 4 levels. Gates: typecheck 0 errors, lint clean, 145 tests pass (+8 new, 0 regressions), build ✓. Status → review.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **Latent 4.2 expand bug surfaced & fixed.** `selectClient` both expanded the client (`setExpanded(prev => new Set([...prev, id]))`) AND the tree-row click also called `toggleExpand`. With two functional `setExpanded` calls the second cancelled the first, so the node never actually opened — masked in 4.2 because the project name also rendered in the detail-panel projects card. The 4.3 tree-expand tests exposed it. Fixed by making expansion driven solely by `onToggleExpand` on the row click; `selectClient` no longer touches `expanded`.
- **Infinite-render loop in tests (OOM).** The per-level cache-load `useEffect`s initially depended on the whole `ctx` object (rebuilt every parent render) → re-fired every render → with a fresh `data` array each render churned cache state forever (heap OOM, worker crash). Two-part fix: (1) depend on the specific stable (useMemo'd) callback (`onProjectsLoaded`/`onStudiesLoaded`/`onLocationsLoaded`), not `ctx`; (2) added a cheap `sameList` id-signature guard so a fresh-but-equivalent array doesn't write new cache state — idempotent under reference changes, correct for both the real app (TanStack Query returns stable refs anyway) and naive test mocks.

### Completion Notes List

**Summary:** Extended the single-file `EngagementsScreen` from the 2-level (Client→Project) 4.2 screen to the full 4-level (Client→Project→Study→Location) hierarchy, in place, mirroring every established 4.2 pattern. No backend changes.

**Per-AC:**
- **AC1** — Real Studies card on `ProjectDetail` (replaced the disabled 4.2 placeholder) with an enabled "Add Study"; `EntityModal` `add-study` branch calls `createStudy({ project_id, name, description? })`; invalidate-and-refetch shows it immediately and closes the modal.
- **AC2** — New `ProjectNode`/`StudyNode` tree components (siblings of `ClientNode`) render Study children under projects (flask icon, Study badge), each fetching children only when expanded; projects with no studies show "No studies yet." and no study children (studies optional). Search extended to studies/locations too.
- **AC3** — Location modal adds `address`, `city`, `postal_code` (required), `pi_name` fields (plus name + optional description), rendered conditionally in `add-location`/`edit-location` modes.
- **AC4** — Client-side `postal_code` required validation ("Postal code is required") blocks submit before any request; `applyApiErrors`/`mapDetailsToFieldErrors` also map a 422 `postal_code` detail to that field as a backstop.
- **AC5** — `LocationDetail` meta strip always shows postal code (+ city/address/PI when present) via `MetaChip`; persisted by the 4.1 API.
- **AC6** — Study Delete opens `ConfirmDialog` (reused from skills) with `This study has {N} location(s). Deleting it will also remove all locations.` (plain prompt when N=0). **Delete semantics: approach (1) "delete-children-then-study"** — on confirm, each cached location is deleted first (`await mutateAsync`), then the study, making the warning copy truthful (the API does NOT cascade — 409 `HIERARCHY_HAS_CHILDREN`). Location delete is a simple confirm (leaf). Stale-selection is cleared after a successful delete (P7).
- **AC7** — The placeholder "Attached skills" card is retained on `ProjectDetail` alongside the now-real Studies card; not wired (later epic).

**Notable decisions / consistency:**
- **Extended in place, no rewrite.** Refactored the duplicated child-list markup into a shared `ChildListCard` (Projects/Studies/Locations) and `DetailActions` (Edit/Delete) to keep the growing file DRY — `ClientDetail`'s projects card now uses it too (aria-labels unchanged: "Open project …").
- **Entity-aware error mapping (Task 10):** generalized `friendlyError`'s 409 to "remove its child items first." (was hard-coded "child projects") and added `STUDY_NOT_FOUND`/`LOCATION_NOT_FOUND` to the not-found set.
- **Clear-once-set guard (P2)** kept scoped to `description` only (documented in code); the other optional location fields no-op on clear, matching API PATCH semantics.
- **Store:** used the existing `setActiveStudyId`; did not add a location id to the store (none existed; 4.4 can extend additively). All existing store signatures preserved.
- Preserved every 4.2 behavior: P5 fresh-cache-preferred detail, P6 double-submit guard, P7 stale-selection clearing, the referential-equality cache pattern (now hardened with `sameList`), focus-trap/Escape modal a11y, and the search hint.

**Tests:** +8 cases covering AC1–AC7 + study/location search (a–h from Task 11). Updated the 4.2 `internal.test.tsx` and `EngagementsScreen.test.tsx` hook mocks to include the 8 new study/location hooks (+ `mutateAsync`) and `setActiveStudyId`. One 4.2 assertion ("expands a client → shows projects") tightened from a bare text match to the tree-node role match, since the project name now correctly appears in both the tree and the detail panel.

**Gates:** `npm run typecheck` 0 errors · `npm run lint` clean · `npm run test` 145 passed (16 files, +8, 0 regressions) · `npm run build` ✓.

### File List

- velara-web/src/features/engagements/types.ts (modified — added `Study`, `Location`, `StudyCreateInput`, `StudyUpdateInput`, `LocationCreateInput`, `LocationUpdateInput`)
- velara-web/src/api/hierarchy.ts (modified — added 8 study/location CRUD functions)
- velara-web/src/features/engagements/hooks/useEngagements.ts (modified — added `useStudies`/`useCreateStudy`/`useUpdateStudy`/`useDeleteStudy` + `useLocations`/`useCreateLocation`/`useUpdateLocation`/`useDeleteLocation`)
- velara-web/src/features/engagements/components/EngagementsScreen.tsx (modified — 4-level tree [`TreeRow`/`TreeChildStatus`/`ProjectNode`/`StudyNode`], `StudyDetail`/`LocationDetail`, shared `ChildListCard`/`DetailActions`, `EntityModal` study+location branches with postal_code, search over studies/locations, delete flows with `ConfirmDialog`, entity-aware `friendlyError`, `sameList` cache guard, widened `Selection`/`ModalMode`/`SearchResultItem`/`EntityBadge` unions, flask/pin/trash icons + study/location `ENTITY` entries)
- velara-web/src/features/engagements/components/EngagementsScreen.test.tsx (modified — new hook mocks + `setActiveStudyId`; 8 new study/location test cases; tightened one 4.2 assertion)
- velara-web/src/routes/internal.test.tsx (modified — added the 8 new hook mocks + `setActiveStudyId` to the engagements/store mocks so the route tree renders the extended screen)
