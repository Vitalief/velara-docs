---
baseline_commit: db04cef (top-level docs repo); velara-web working tree at HEAD (07960d0, branch story/14-2-ai-adapter-upgrade-path) when picked up
---

# Story 16.2: Client-Level Location Management + Study Association UI

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to add Locations once at the Client level and simply associate existing ones when I set up a Study,
so that I never have to re-enter the same site's address, postal code, and PI name for every new Study.

**This is a FRONTEND-ONLY story.** Story 16.1 (done) already shipped the entire backend
Location→Client-ownership model — new routes, new schemas, the `study_location_association` join
table, and the migration. **The velara-web frontend still speaks the OLD study-owned contract and is
currently broken against the live API** (it POSTs a removed route with a `study_id` body field the
backend no longer accepts, and its `Location` type reads a `study_id` field the backend no longer
returns). This story is the frontend catch-up plus the two UX changes the epic asks for: move
Location *creation* to the Client screen, and turn the Study screen's "Add Location" into an
"Associate Location" picker.

**Why the frontend is broken right now (verified in source):** `createLocation`
(`src/api/hierarchy.ts:110`) POSTs to `/api/v1/locations` with `study_id` in the body — the backend
**removed** that route and that field in 16.1 (creation is now `POST /clients/{client_id}/locations`,
no `study_id`/`client_id` in the body). `Location.study_id` (`src/features/engagements/types.ts:54`)
and `LocationCreateInput.study_id` (`types.ts:78`) reference a field the backend `LocationRead`
replaced with `client_id`. `useLocationContext` (`hooks/useEngagements.ts:249`) walks
`location.study_id` up a Study→Project→Client chain that no longer exists on the model. Every one of
these must be repaired or Location CRUD is dead in the internal UI.

## Acceptance Criteria

1. **AC1 — Add Location moves to the Client screen.** The Client detail view (`ClientDetail`,
   `EngagementsScreen.tsx:745`) gains an "Add Location" action that opens the existing location
   create form (name, address, city, **postal code required**, PI name, description) and creates a
   Location **owned by that Client** via `POST /api/v1/clients/{client_id}/locations`. The
   Client-level `client_id` is sourced from the client route/detail context, **not** from the
   request body (the backend `LocationCreate` schema has neither `study_id` nor `client_id` — the
   owning client comes only from the URL path). The postal-code-required inline validation currently
   in `EntityModal` (`EngagementsScreen.tsx:279-282`) is preserved and now fires at Client-level
   creation.

2. **AC2 — Study associates, doesn't create.** The Study detail view's Locations card
   (`StudyDetail`, `EngagementsScreen.tsx:1021-1027`) "Add Location" affordance becomes **"Associate
   Location"** — a picker over the Client's existing Locations (from `GET
   /api/v1/clients/{client_id}/locations`, backing hook new), **not** a creation form. Selecting a
   Location calls `POST /api/v1/studies/{study_id}/locations` with body `{ location_id }` (204). The
   picker must exclude Locations already associated with this Study (already in the `GET
   /locations?study_id=` list — the exclusion-set model, mirroring `AttachPanel`'s `attachedIds`).
   The Client whose Locations to offer is resolved from the Study's ancestor chain
   (Study→Project→Client).

3. **AC3 — Removing an association doesn't delete the Location.** Removing a Study's association to a
   Location (a new disassociate control on the Study screen) calls `DELETE
   /api/v1/studies/{study_id}/locations/{location_id}` (204) — the Location itself, and every other
   Study's association to it, is untouched. This must **not** call `DELETE /locations/{id}` (which
   deletes the Location entity entirely). The Locations list on the Study screen refreshes to drop
   the removed association.

4. **AC4 — Existing engagements are unaffected.** Every Study that had Locations before 16.1 shipped
   still shows exactly those same Locations (16.1's migration created a `study_location_association`
   row for each), fetched via the **unchanged** `GET /locations?study_id=` request shape
   (`listLocations`, `hierarchy.ts:103` — keep its shape, the backend resolves it through the
   association table now). No user re-work for pre-existing engagements.

5. **AC5 — The stale frontend Location contract is repaired end-to-end (regression fix bundled into
   this story — it is not optional).** `Location.study_id` → `client_id` in the type; `study_id`
   dropped from `LocationCreateInput`; a new `StudyLocationAssociationCreate = { location_id: string }`
   type added. `useLocationContext` (`useEngagements.ts:249`) and the `LocationDetailRoute`
   breadcrumb (`EngagementsScreen.tsx:1377-1415`) are reworked so a Location's ancestor chain
   resolves via `client_id → Client` (a Location is now Client-owned and can be associated with 0,
   1, or N Studies — it has **no single owning Study**). The `Study` MetaChip in `LocationDetail`
   (`EngagementsScreen.tsx:1145`) and the `studyName` prop threaded into it are removed/replaced
   accordingly (a Location has no one Study to name). `useCreateLocation`'s `onSuccess` invalidation
   (`useEngagements.ts:133`, currently keys off the now-absent `input.study_id`) is fixed.

6. **AC6 — Study deletion must NOT delete the Client's Locations (destructive-regression fix,
   MANDATORY).** The current study-delete cascade (`confirmDelete`,
   `EngagementsScreen.tsx:1609-1619`) deletes every child Location via `DELETE /locations/{id}`
   **before** deleting the Study, and the confirm-dialog copy warns "Deleting it will also remove all
   locations." Post-16.1 this is **actively wrong and destructive**: Locations are Client-owned and
   shared across Studies; the backend's `delete_study` no longer guards on Location children and the
   `study_location_association` rows cascade away automatically on study delete (16.1 removed the
   `HierarchyHasChildrenError` guard — verified in its Dev Agent Record). The FE cascade-delete of
   Locations, the `fetchStudyLocations`/`cascadeDeleteLocation` machinery used only for it, the
   location-count pre-fetch in `requestDeleteStudy` (`:1565-1590`), and the "will also remove all
   locations" dialog copy (`:1663-1673`) must be **removed**. Deleting a Study now simply deletes the
   Study (its associations vanish via DB cascade); its Client's Locations survive. Add/adjust a test
   asserting a Study delete leaves the Client's Locations intact.

7. **AC7 — Error handling matches the backend contract.** The associate flow surfaces the backend's
   409 `LOCATION_STUDY_ASSOCIATION_EXISTS` ("already associated") gracefully — a picker already
   excluding associated Locations makes this a race-only case, but the mutation's `onError` must not
   crash. Cross-Client association returns **404 `LOCATION_NOT_FOUND`** (the backend deliberately
   masks a cross-client attempt as not-found) — since the picker only ever offers the Study's own
   Client's Locations this is not user-reachable, but do not special-case it into a misleading
   message. Reuse the existing local `friendlyError`/`getApiCode` error helpers
   (both defined in `EngagementsScreen.tsx:88-115` — `getApiCode` reads
   `err.response.data.error.code`, the shape the FE already parses).

8. **AC8 — Grantor gating matches the existing Engagements convention (do NOT add a new gate).** The
   Engagements screen is **not** grantor-gated today — its Add/Edit/Delete buttons render for every
   internal user, and `EngagementsScreen.tsx` does not import `isGrantor`. The new create/associate/
   disassociate controls follow that same existing convention (ungated at the FE; the backend router
   is `dependencies=[RejectClient]`, so client-role JWTs are already rejected server-side). Do not
   introduce an `isGrantor()` check on these new controls — that would diverge from every other
   Engagements action and is out of this story's scope.

**Out of scope (do NOT touch):**
- Any backend change (Story 16.1 shipped it all — this story calls the existing routes only).
- Client-level skill attachment (Story 16.3).
- Study-creation-time protocol upload (Story 16.4).
- Action-menu consolidation (Story 16.5) — the new "Associate Location" affordance will be absorbed
  into that menu **later**; for now it is a normal button on the Locations card, consistent with the
  current per-card action buttons. Do not build the shared `Menu` primitive here.
- Hierarchy-scoped run history (Story 16.6).
- Any change to how Location **editing** works beyond the `study_id`→`client_id` plumbing fix (the
  edit-location form and `updateLocation`/`PATCH /locations/{id}` are unchanged in shape).

## Tasks / Subtasks

- [x] **Task 1 — Types: repair the stale Location contract (AC5)** —
  `src/features/engagements/types.ts`
  - [x] `Location.study_id` (line 54) → `client_id: string` (matches backend `LocationRead`, which
    now returns `client_id` and no `study_id`).
  - [x] `LocationCreateInput` (line 77): **remove** `study_id` (line 78). Remaining fields (`name`,
    `postal_code` required; `description`/`address`/`city`/`pi_name` optional) already match the
    backend `LocationCreate` schema. `client_id` is NOT added to this type — it goes in the URL path.
  - [x] Add `export interface StudyLocationAssociationCreate { location_id: string }`.
  - [x] `LocationUpdateInput` (line 87) is already correct — no change.

- [x] **Task 2 — API client: repoint create, add the four new calls (AC1, AC2, AC3, AC5)** —
  `src/api/hierarchy.ts`
  - [x] Rename/repoint `createLocation` → `createClientLocation(clientId: string, input:
    LocationCreateInput)` → `POST /api/v1/clients/${clientId}/locations`, unwrap `response.data.data`
    (returns `Location`). (The old `createLocation` at line 110 POSTing `/api/v1/locations` is
    removed — that backend route no longer exists.)
  - [x] Add `listClientLocations(clientId: string): Promise<Location[]>` → `GET
    /api/v1/clients/${clientId}/locations`, unwrap `response.data.data`.
  - [x] Add `associateLocation(studyId: string, locationId: string): Promise<void>` → `POST
    /api/v1/studies/${studyId}/locations` with body `{ location_id: locationId }`. **204, no body —
    do NOT unwrap `.data.data`** (there is none; `await apiClient.post(...)` only).
  - [x] Add `disassociateLocation(studyId: string, locationId: string): Promise<void>` → `DELETE
    /api/v1/studies/${studyId}/locations/${locationId}`. **204, no body** (`await
    apiClient.delete(...)` only).
  - [x] `listLocations` (line 103, `GET /locations?study_id=`), `updateLocation`, `deleteLocation`,
    `getLocation` are **unchanged** — keep as-is. (Note: `deleteLocation` still exists and is still
    the "delete the Location entity" call — it is used by the Location detail-page delete, NOT by the
    Study-disassociate flow.)

- [x] **Task 3 — Query/mutation hooks (AC1, AC2, AC3, AC5)** —
  `src/features/engagements/hooks/useEngagements.ts`
  - [x] `useCreateLocation` (line 129): change `mutationFn` to `createClientLocation(clientId, input)`
    and fix the `onSuccess` invalidation — it currently keys off `input.study_id` (line 133), which
    no longer exists. Invalidate the new client-locations key (`['clientLocations', clientId]`) and
    the study-locations list where relevant. Simplest shape: `useCreateClientLocation(clientId:
    string)` taking `clientId` up front (mirror `useUpdateProject(id, clientId)` at line 72), so the
    invalidation key is stable. Dev's call on exact hook signature — keep it consistent with the
    existing `use*` factory patterns in this file.
  - [x] Add `useClientLocations(clientId: string | undefined)` — `useQuery` with key
    `['clientLocations', clientId]`, `enabled: !!clientId`, `queryFn: () =>
    listClientLocations(clientId!)`. Mirror `useLocations` (line 121) exactly in shape.
  - [x] Add `useAssociateLocation(studyId: string)` and `useDisassociateLocation(studyId: string)`
    mutation hooks — `onSuccess` invalidates `['locations', studyId]` (the Study's associated-list
    query) so the Study screen refreshes. Mirror the `useMutation` + `qc.invalidateQueries` shape of
    the other mutation hooks.
  - [x] `useLocationContext` (line 249): **rework the ancestor chain.** It currently does
    `useStudy(location.data?.study_id)` → `useProject` → `useClient`. A Location no longer has a
    `study_id`. Replace with `useClient(location.data?.client_id)` directly (a Location's only parent
    is now its Client). Drop the `study`/`project` intermediates from what this context returns, OR
    return them as always-undefined — but the `LocationDetailRoute` consumer (Task 4) must be updated
    in lockstep so it no longer reads a Study ancestor. Update the header comment at lines 202-204
    which still names `Location.study_id` as a walk field.

- [x] **Task 4 — Client screen: Add Location card + create modal (AC1, AC5)** —
  `EngagementsScreen.tsx`
  - [x] `ClientDetail` (line 745): add a Locations `ChildListCard` (reuse the existing generic
    `ChildListCard`, line 821 — it already renders any `{id, name, description}[]`) after the
    Projects card, fed by the new `useClientLocations(client.id)` hook, with `addLabel="Add
    Location"` and `onAdd` opening the create modal. `onSelect` navigates to the location detail
    (`h.goToLocation(l.id)`).
  - [x] `ModalMode` (line 160): the `add-location` variant currently carries `{ studyId, studyName }`
    (line 167). Change the create variant to carry `{ clientId, clientName }` (creation is now at the
    Client). The `edit-location` variant (line 168) currently carries `studyName` (line 168) — since
    a Location has no single Study, change it to carry the owning `clientName` (or drop the parent
    name entirely; the edit modal only uses `parentName` for the "Under:" header line at :398-402 —
    dev's call, keep it coherent).
  - [x] `EntityModal` `add-location` submit branch (lines 326-336): build `LocationCreateInput`
    **without** `study_id` (remove line 328) and call the client-create mutation with the modal's
    `clientId`. The `edit-location` branch (line 337) and `updateLocation` wiring (line 229-232,
    which reads `mode.location.study_id` at :231) must switch to the client-scoped update hook /
    invalidation (`updateLocation` PATCH itself is unchanged; only the query-key the update
    invalidates changes — it can no longer key on `study_id`).
  - [x] `openAddLocation` (line 1562) currently takes `(studyId, studyName)` and sets an
    `add-location` modal. Split concerns: the **Client** screen's add opens the create modal with
    `clientId`; the **Study** screen's affordance (Task 5) opens the associate picker instead. Rename
    or repurpose accordingly and update `DetailHandlers` (line 1242) + the wiring at line 1655-1661.
  - [x] `EntityBadge`/`parentName`/`namePlaceholder` for the location branch (lines 364-380): update
    the `add-location` parent-name source from `studyName` to `clientName`.

- [x] **Task 5 — Study screen: Associate + Disassociate (AC2, AC3)** — `EngagementsScreen.tsx`
  - [x] `StudyDetail` (line 978): the Locations `ChildListCard` (lines 1021-1027) "Add Location"
    button becomes **"Associate Location"** — `onAdd` opens a new picker component (see next bullet)
    rather than the create modal. The card still lists the Study's associated Locations via the
    unchanged `useLocations(study.id)` (line 990) — **no change to that query**. Each row gains a
    disassociate affordance (e.g. an inline "Remove" button, or a `DetailActions`-style control) that
    opens a `ConfirmDialog` (reuse `ConfirmDialog`,
    `src/features/skills/components/ConfirmDialog.tsx`) and on confirm calls
    `useDisassociateLocation(study.id).mutate(location.id)`. **This must call disassociate, NOT
    deleteLocation.**
  - [x] Build an **Associate Location picker** modeled on `AttachPanel`
    (`src/features/admin/components/AccessControl.tsx:133`) — a right-docked slide-in
    (`fixed right-0 top-0 z-40 … w-[360px] … border-l shadow-xl`, scrim `fixed inset-0 z-30
    bg-black/20`, Esc-to-close, focus-trap) listing the Client's Locations from
    `useClientLocations(clientId)` filtered by a search box, with an `attachedIds: Set<string>`
    exclusion of the Study's already-associated Location ids (from `useLocations(study.id)`) so
    already-associated sites show "Associated ✓"/disabled. Selecting a row calls
    `useAssociateLocation(study.id)`. Resolve `clientId` from the Study's ancestor chain
    (`useStudyContext(study.id).client.data?.id`, hook at `useEngagements.ts:234`). This may be a
    new file `src/features/engagements/components/AssociateLocationPanel.tsx` co-located with the
    feature — do not add it to the `admin` feature. Match V3 styling and the panel conventions
    already in `AttachPanel`; reuse `Icon` from `src/shared/components/Icon.tsx` (project rule: no
    emoji/unicode icons — the only allowed glyph is ⌘).

- [x] **Task 6 — Location detail + breadcrumb: remove the single-Study assumption (AC5)** —
  `EngagementsScreen.tsx`
  - [x] `LocationDetailRoute` (line 1377): the breadcrumb (lines 1397-1403) currently builds
    Client → Project → Study → Location from `useLocationContext`. Rework to **Client → Location**
    (a Location's only ancestor is its Client now). Remove the `study`/`project` crumbs (or the
    Study/Project crumbs specifically — the Location is directly under the Client). `usePageTitle`
    and `useStoreActivePath` (lines 1380-1381) currently pass `study.data?.id` — update to reflect
    the Client-only chain (`useStoreActivePath(client.data?.id, undefined, undefined)` — a Location no
    longer has an active project/study).
  - [x] `LocationDetail` (line 1110): remove the `studyName` prop and the `Study` MetaChip
    (line 1145). `onDelete` (wired at line 1411 as `h.requestDeleteLocation(leaf, leaf.study_id)`) no
    longer has a `study_id` to pass — see Task 7 for how `requestDeleteLocation`/`confirmDelete`
    change (the post-delete navigation target can no longer be "the parent study"; navigate to the
    owning Client instead: `entityPath('client', leaf.client_id)`).
  - [x] The tree panel's Location nodes and `locationsCache`/`handleLocationsLoaded`
    (`:1450, :1486, :1647`) are keyed by Study (they populate on Study expansion via the unchanged
    `GET /locations?study_id=`) — that still works (a Study's associated Locations). Confirm no code
    in the tree reads `location.study_id`; if it does, repoint it. (Grep `location.study_id` /
    `\.study_id` across the file — known sites: `:231`, `:328`, `:1411`, and `useLocationContext`.)

- [x] **Task 7 — Remove the destructive study-delete Location cascade (AC6)** —
  `EngagementsScreen.tsx`
  - [x] `confirmDelete` (lines 1597-1626): in the `kind === 'study'` branch, **remove** the
    `fetchStudyLocations` + `for (loc of locations) cascadeDeleteOneLocation(...)` loop
    (lines 1615-1618). A Study delete is now just `await deleteStudy.mutateAsync(studyId)` →
    navigate to the parent project. The backend cascades the `study_location_association` rows; the
    Client's Locations are untouched.
  - [x] Remove the now-dead machinery: `fetchStudyLocations` (`:1462`), `cascadeDeleteOneLocation`
    (`:1630`), `cascadeDeleteLocation` hook (`:1498`), the `countingLocations`/`setCountingLocations`
    state and the location-count pre-fetch in `requestDeleteStudy` (`:1565-1590`) — `requestDeleteStudy`
    collapses to just `setDeleteTarget({ kind: 'study', study, projectId })`.
  - [x] Update the delete-study `ConfirmDialog` copy (`:1663-1673`): drop the "This study has N
    location(s). Deleting it will also remove all locations." message and the `countingLocations`
    "Checking for locations…" state — a plain "Delete this study?" is correct now.
  - [x] `requestDeleteLocation` (`:1592`) currently takes `(location, studyId)`; the location-detail
    caller no longer has a `study_id`. Change its signature to not require a Study, and the post-delete
    navigation in `confirmDelete`'s `kind === 'location'` branch (`:1601-1607`) from
    `navigate(entityPath('study', studyId))` to `navigate(entityPath('client', location.client_id))`
    (or back to Engagements root). Update the `DeleteTarget` union (`:1420-1422`): drop `locations:
    Location[]` from the `study` variant (no longer pre-fetched per Task 7's cascade removal) and
    drop `studyId` from the `location` variant (the location delete no longer needs a Study).

- [x] **Task 8 — Tests (AC1-AC7)** — co-located `.test.tsx`/`.test.ts` beside sources (project rule:
  tests co-located; framework is Vitest + Testing Library, per every prior FE story)
  - [x] `hierarchy.ts` / hooks: assert `createClientLocation` POSTs `/clients/{id}/locations` with no
    `study_id`; `associateLocation` POSTs `/studies/{id}/locations` `{location_id}` and does not
    attempt to read a response body; `disassociateLocation` DELETEs the right URL.
  - [x] Client screen: "Add Location" opens the create form, submits a Client-owned Location, the
    Locations card refreshes.
  - [x] Study screen: "Associate Location" opens the picker; already-associated Locations are
    excluded/disabled; selecting one associates and the Study's Locations list refreshes; the
    disassociate control calls **disassociate** (assert it does NOT call `DELETE /locations/{id}`).
  - [x] **AC6 regression test (highest-value):** a Study delete calls `DELETE /studies/{id}` and does
    **NOT** issue any `DELETE /locations/{id}` calls — assert the Client's Locations survive. This is
    the test that proves the destructive-cascade removal.
  - [x] Location detail breadcrumb renders Client → Location (no Study crumb); `useLocationContext`
    resolves via `client_id`.
  - [x] Type/contract: a `LocationRead`-shaped fixture with `client_id` (no `study_id`) flows through
    the type without a TS error; assert `study_id` is no longer referenced (the fix is complete).

- [x] **Task 9 — Gates**
  - [x] `npm run typecheck` (or `tsc --noEmit`) clean — the `study_id`→`client_id` change will surface
    every stale reference as a compile error; chase them all (grep `study_id` across
    `src/features/engagements/` and `src/api/hierarchy.ts` first to pre-empt).
  - [x] `npm run lint` (eslint) clean on every changed file.
  - [x] `npm test` (Vitest) green — full FE suite; no new failures. Prior stories run ~735-737 FE
    tests; expect that order of magnitude.
  - [x] **No backend change, no `docs/api-spec.json` change** — confirm `git status` in velara-api is
    clean (this story touches velara-web only). Do NOT commit velara-web (subrepo — dev-story only
    commits the top-level docs repo, per the never-push-subrepos rule).

### Review Findings

Code review 2026-07-23 (3-layer: Blind Hunter + Edge Case Hunter + Acceptance Auditor).
All 8 ACs and all 3 flagged traps verified MET (AC7 PARTIAL → patch below). 6 patches, 0 deferred,
7 dismissed as noise/false-positive. No File-List drift.

- [x] [Review][Patch] AC7 — associate `onError` uses a hardcoded string instead of reusing `friendlyError`/`getApiCode`; the 409 `LOCATION_STUDY_ASSOCIATION_EXISTS` race is not surfaced with the backend message [AssociateLocationPanel.tsx:73] — FIXED: imports `getApiCode`/`getApiMessage` from `@/shared/utils/errors`; new `associateErrorMessage` maps the 409 to friendly copy and falls back to the backend message.
- [x] [Review][Patch] Location DELETE does not invalidate the per-study `['locations', studyId]` associated-lists → a Location shared across Studies leaves a phantom row (404 on click) in every other Study's card for up to the 30s staleTime [useEngagements.ts:162-173] — FIXED: `useDeleteLocation.onSuccess` now also invalidates the `['locations']` key prefix.
- [x] [Review][Patch] Location EDIT (`useUpdateLocation`) does not invalidate `['locations', studyId]` → stale name/postal_code shown in every associated Study's card for up to 30s [useEngagements.ts:154-160] — FIXED: `useUpdateLocation.onSuccess` now also invalidates the `['locations']` key prefix.
- [x] [Review][Patch] Associate button `disabled={associateLocation.isPending}` disables ALL rows during one in-flight request and there is no per-row in-flight guard → a slow associate blocks associating other rows and a rapid double-click can fire a duplicate POST [AssociateLocationPanel.tsx:151] — FIXED: tracks `pendingId`; only the in-flight row shows "Associating…", double-click guarded via early return in `handleAssociate`.
- [x] [Review][Patch] Associate picker renders "No locations available. Add one at the Client screen first." while `useClientLocations` is still loading or has errored (no `isLoading`/`isError` state) → misleads the user and silently hides a fetch failure [AssociateLocationPanel.tsx:23,127-130] — FIXED: distinct "Loading locations…" and error states rendered from `isLoading`/`isError`.
- [x] [Review][Patch] Cold deep-link to a Study detail: `onAssociateLocation` passes `client.data?.id ?? ''` before the ancestor client resolves → the picker opens against `useClientLocations('')` (`enabled:false`) and always shows "No locations available"; the Associate trigger is not gated on client load [EngagementsScreen.tsx:1462] — FIXED: `associateDisabled` threaded through `StudyDetail`→`StudyLocationsCard`, button disabled until `client.data?.id` resolves.

## Dev Notes

### The backend is already live — this is the exact wire contract (from Story 16.1, verified in source)

All routes: router `APIRouter(prefix="/api/v1", tags=["hierarchy"], dependencies=[RejectClient])`
(`velara-api/app/api/v1/hierarchy.py:41`). Every non-204 response is the standard envelope
`{ "data": ..., "meta": ... }`; unwrap `response.data.data`.

| Operation | Method + URL | Body | Response |
|---|---|---|---|
| Create Client Location | `POST /api/v1/clients/{client_id}/locations` (hierarchy.py:403) | `LocationCreate` (name, postal_code **required**; description/address/city/pi_name optional) — **no study_id, no client_id** | **201** `{data: LocationRead}` |
| List Client's Locations | `GET /api/v1/clients/{client_id}/locations` (hierarchy.py:439) | — | **200** `{data: LocationRead[]}` |
| List Study's Locations | `GET /api/v1/locations?study_id=` (hierarchy.py:461) | — (`study_id` required query param, unchanged) | **200** `{data: LocationRead[]}` |
| Associate Location→Study | `POST /api/v1/studies/{study_id}/locations` (hierarchy.py:486) | `StudyLocationAssociationCreate` = `{ location_id: uuid }` | **204** (empty) |
| Disassociate | `DELETE /api/v1/studies/{study_id}/locations/{location_id}` (hierarchy.py:514) | — | **204** (empty; **no-op still returns 204** if not associated) |
| Get / Update / Delete one Location | `GET/PATCH/DELETE /api/v1/locations/{id}` (hierarchy.py:542+) | `LocationUpdate` (PATCH) | `{data: LocationRead}` / 204 (unchanged) |

`LocationRead` (response) fields — **all always present** (nullables serialize as `null`):
`id`, **`client_id`** (replaces the old `study_id`), `name`, `description`, `hierarchy_path`,
`postal_code`, `address`, `city`, `pi_name`, `created_at`, `updated_at`.

`LocationCreate` (create body): `name` (req), `postal_code` (req), `description`/`address`/`city`/
`pi_name` (optional). **No `study_id`, no `client_id`** — the owning client is the URL path param only.

**Error contract to handle (AC7):**
- Associate a pair already associated → **409** `LOCATION_STUDY_ASSOCIATION_EXISTS`, message "This
  Location is already associated with this Study."
- Associate a Location from a **different Client** → deliberately masked as **404**
  `LOCATION_NOT_FOUND` (not 403/409). Not user-reachable if the picker only offers the Study's own
  Client's Locations.
- Out of hierarchy scope → 403 (HierarchyScopeError). Cross-org → 404.

The FE reads the error code via the **local** `getApiCode(err)` helper
(`EngagementsScreen.tsx:88`), which parses `err.response.data.error.code` (the app's error envelope
is `{ error: { code, message, request_id } }`, per the consistency rules). `friendlyError` and
`mapDetailsToFieldErrors` are also local (`:92-115`). `getApiCode` is already used for the
already-gone-on-delete idempotency check at `:1634` — reuse the same helper for the associate 409,
do not invent a new error-parsing path or import one from shared utils (there isn't one).

### ⚠️ Three non-obvious traps — these are where a naive implementation regresses (read carefully)

**Trap 1 — the study-delete Location cascade is now DESTRUCTIVE (AC6).** This is the single most
important thing in the story. Today `confirmDelete` (`:1609-1619`) deletes every child Location
before deleting the Study, and warns the user it will. That was correct when a Location belonged to
exactly one Study. Post-16.1 a Location is **Client-owned and shared across Studies** — deleting it
because one of its Studies is being deleted would silently destroy a site still in use by other
Studies. The backend already does the right thing (study delete cascades only the *association*
rows, per 16.1's `delete_study` change), so the FE must simply **stop** deleting Locations on study
delete. Missing this ships a data-loss bug. (This mirrors the 16.1 review's own headline lesson:
repointing a Location's ownership must sweep *every* path that assumed the old single-owner model,
not just the obvious list path.)

**Trap 2 — the single-entity Location path, not just the list (AC5).** It is easy to fix
`listLocations`/the list queries and stop there. But `useLocationContext` (`:249`) and the
`LocationDetailRoute` breadcrumb (`:1397`) resolve a Location's *ancestors* by walking
`location.study_id` — a field that no longer exists. A Location's breadcrumb is now **Client →
Location**, resolved via `client_id`. The `Study` MetaChip on the location detail (`:1145`) and the
`onDelete(leaf, leaf.study_id)` wiring (`:1411`) are the same single-owner assumption and must go.
This is the *exact* class of bug 16.1's code review caught on the backend (collection path fixed,
single-entity path missed) — do not repeat it on the frontend.

**Trap 3 — 204 responses have no body (Task 2).** `associateLocation` and `disassociateLocation`
return 204 No Content. Do **not** write `return response.data.data` for them (there is no `data`) —
just `await apiClient.post(...)` / `await apiClient.delete(...)` with a `Promise<void>` return.
Same for the association mutations' `onSuccess` — the mutation result is `void`, invalidate by the
`studyId` you closed over, not by anything in the response.

### Reuse map (do NOT rebuild these)

- **Create form** — reuse `EntityModal` (`EngagementsScreen.tsx:173`), the existing polymorphic
  add/edit modal. Its location branch already renders name/address/city/postal(req)/PI/description
  with inline postal validation (`:279-282, :424-478`). Only the *submit target* (client-create
  instead of the removed study-create) and the *parent-name source* (`clientName` not `studyName`)
  change.
- **Associate picker** — model on `AttachPanel` (`src/features/admin/components/AccessControl.tsx:133`):
  right-docked slide-in, search box, `attachedIds: Set<string>` exclusion, Esc + focus-trap. Build
  a location-specific sibling in the `engagements` feature (`AssociateLocationPanel.tsx`), do not
  cram it into `admin`.
- **Disassociate confirm** — reuse `ConfirmDialog` (`src/features/skills/components/ConfirmDialog.tsx`,
  props `{ open, title, message, confirmLabel, onConfirm, onCancel, pending }`).
- **List card** — reuse the generic `ChildListCard` (`EngagementsScreen.tsx:821`) for the new Client
  Locations card; it already renders any `{id, name, description}[]` with loading/error/empty states.
- **Icons** — `Icon` from `src/shared/components/Icon.tsx`. Project HARD rule: never use emoji/unicode
  as icons (only ⌘ in ⌘K hints is allowed).
- **Error helpers** — `getApiCode` (`:88`), `friendlyError`, `mapDetailsToFieldErrors` (`:92-115`) —
  all **local** to `EngagementsScreen.tsx`; there is no shared error-code util to import.

### Data-fetching conventions (match these exactly)

TanStack Query v5 (`@tanstack/react-query`), Axios client `apiClient` from `@/api/client`. Query-key
convention (established Story 4.4, `useEngagements.ts:158-162`): plural list keys `['locations',
studyId]`, singular per-id keys `['location', id]`. New client-locations list → `['clientLocations',
clientId]`. Mutations `qc.invalidateQueries({ queryKey: [...] })` on success; `qc.removeQueries` for
the singular key on delete. `enabled: !!id` gates queries whose id is an as-yet-unresolved ancestor.
Default `staleTime: 30_000ms` for hierarchy data (per consistency rules). No hand-rolled loading
booleans — use `isLoading`/`isError` from the query.

### Project Structure Notes

- All frontend changes live under `src/features/engagements/` (`components/EngagementsScreen.tsx`,
  `hooks/useEngagements.ts`, `types.ts`) and `src/api/hierarchy.ts`. One new component file
  (`src/features/engagements/components/AssociateLocationPanel.tsx`). No new directories.
- Tests co-located beside sources (project rule). Vitest + React Testing Library, matching existing
  `*.test.tsx` in the feature.
- `EngagementsScreen.tsx` is a single 1811-line file holding the screen, the modal, all detail
  panels, the tree, and the shell handlers — changes are localized within it; follow its existing
  in-file organization (detail panels, then modal, then route components, then the main component's
  handlers) rather than extracting new top-level modules beyond the one new picker.

### Git / build context

- velara-web is a **separate nested git repo** from the top-level velara docs repo. `cd`ing into it
  shifts the Bash cwd — `cd` back to the top-level for the docs-publish git commands. Current
  velara-web branch is `story/14-2-ai-adapter-upgrade-path` (HEAD `07960d0`); the api subrepo is on
  `development`.
- Do NOT commit velara-web or velara-api (subrepos, per the never-push-subrepos rule — dev-story only
  commits the top-level docs repo; code-review commits the subrepos post-review).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.2] —
  parent epic story (AC1-AC4); this story is its full implementation-detail expansion (AC5-AC8 add
  the FE-contract repair + destructive-cascade + gating decisions the epic named only categorically).
- [Source: _bmad-output/implementation-artifacts/stories/16-1-move-locations-to-client-ownership.md] —
  the backend story this consumes; its Dev Agent Record + File List document the exact routes/schemas
  and the `delete_study` child-guard removal AC6 depends on.
- [Source: velara-api/app/api/v1/hierarchy.py#L403-L539] — the create/list-by-client/associate/
  disassociate route handlers (exact signatures, status codes).
- [Source: velara-api/app/schemas/hierarchy.py#L157-L227] — `LocationCreate`/`LocationRead`/
  `StudyLocationAssociationCreate`/`LocationUpdate` (exact fields).
- [Source: velara-web/src/api/hierarchy.ts#L103-L123] — existing location API functions (repointed by
  Task 2).
- [Source: velara-web/src/features/engagements/types.ts#L52-L94] — `Location`/`LocationCreateInput`
  (repaired by Task 1).
- [Source: velara-web/src/features/engagements/hooks/useEngagements.ts#L121-L264] — location hooks +
  `useLocationContext` (Task 3).
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx] — the screen:
  `EntityModal` (:173), `ClientDetail` (:745), `ChildListCard` (:821), `StudyDetail` (:978),
  `LocationDetail` (:1110), `LocationDetailRoute` (:1377), `openAddLocation` (:1562),
  `requestDeleteStudy`/`confirmDelete`/cascade (:1565-1636), `detailHandlers` (:1655).
- [Source: velara-web/src/features/admin/components/AccessControl.tsx#L133-L247] — `AttachPanel`, the
  right-docked picker precedent for the associate panel.
- [Source: velara-web/src/features/skills/components/ConfirmDialog.tsx] — the confirm dialog reused for
  disassociate.
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] —
  velara-web structure, TanStack Query keys, error-envelope + loading-state conventions.

## Change Log

- 2026-07-23 — Implemented Story 16.2. All 9 tasks complete: repaired the stale FE Location contract
  (`study_id`→`client_id`, dead `/locations` POST route call removed) that had been silently broken
  since 16.1's backend shipped; moved Location creation to the Client screen; turned the Study
  screen's "Add Location" into an Associate/Disassociate flow via a new `AssociateLocationPanel`
  (modeled on `AttachPanel`); removed the destructive study-delete Location cascade (AC6 — a Study
  delete no longer deletes the Client's shared Locations); reworked the Location detail breadcrumb to
  Client→Location (no single owning Study post-16.1). 2 new files, 7 modified (5 in-scope + 2
  pre-existing test files whose wholesale `useEngagements` mocks needed the renamed/new hook exports
  — discovered via the full-suite gate, not originally in the story's own File List draft). Gates:
  `tsc --noEmit` clean, `eslint` clean (1 pre-existing unrelated warning), `vitest run` 61 files / 745
  tests passing (0 new failures). No backend/velara-api change — confirmed clean `git status` there.
  Not committed to velara-web (subrepo, per the never-push-subrepos rule — dev-story only commits the
  top-level docs repo). Status → review.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `EngagementsScreen.test.tsx` and two other test files (`src/routes/internal.test.tsx`,
  `src/pages/LogoutFlow.test.tsx`) mock `@/features/engagements/hooks/useEngagements` wholesale by
  export name — every renamed/added hook (`useCreateClientLocation`, `useClientLocations`,
  `useAssociateLocation`, `useDisassociateLocation`) had to be added to all three mock factories or
  the app crashed on render with "No export is defined on the mock." Found via the full `npm test`
  run after the feature-scoped `EngagementsScreen.test.tsx` run alone passed — a reminder that a
  hook-rename blast radius isn't fully visible from a single test file.
- Two Associate-panel/disassociate tests initially failed on ambiguous `getByText`/`getByRole`
  queries because "Mass General Hospital" and a "Remove" button render in both the Study's own
  Locations card and the overlaying picker/dialog simultaneously — fixed by scoping queries with
  `within(panel)` / `within(dialog)`.
- One test asserted on `.mutate` for the disassociate confirm flow, but `confirmDelete` calls
  `.mutateAsync` (matching the existing delete-study/delete-location pattern) — fixed the test to
  assert `mutateAsync`.

### Completion Notes List

- **Task 1 (AC5):** `Location.study_id` → `client_id`; `study_id` dropped from `LocationCreateInput`;
  new `StudyLocationAssociationCreate` type added. `LocationUpdateInput` unchanged.
- **Task 2 (AC1, AC2, AC3, AC5):** `createLocation` replaced with `createClientLocation(clientId,
  input)` → `POST /clients/{clientId}/locations`; added `listClientLocations`, `associateLocation`
  (204, no body), `disassociateLocation` (204, no body). `listLocations`/`updateLocation`/
  `deleteLocation`/`getLocation` unchanged.
- **Task 3 (AC1, AC2, AC3, AC5):** `useCreateClientLocation(clientId)` replaces `useCreateLocation`
  (invalidates `['clientLocations', clientId]` — the old hook's invalidation kept off `input.study_id`
  which no longer exists). Added `useClientLocations`, `useAssociateLocation(studyId)`,
  `useDisassociateLocation(studyId)`. **Deviation from the story's literal Task 3 wording (documented
  here per the story's own "dev's call" note):** `useUpdateLocation`/`useDeleteLocation` now take
  `clientId` (not `studyId`) as their second/only param, invalidating `['clientLocations', clientId]`
  — necessary because a Location's owning entity is now the Client, not a Study, so update/delete
  invalidation must key off the Client to actually work; a `studyId`-keyed invalidation would be a
  silent no-op post-migration. `useLocationContext` reworked to walk `client_id → Client` directly
  (drops the `study`/`project` intermediates — a Location has no single owning Study).
- **Task 4 (AC1, AC5):** `ClientDetail` gains a Locations `ChildListCard` fed by
  `useClientLocations(client.id)`. `ModalMode`'s `add-location`/`edit-location` variants now carry
  `clientId`/`clientName` instead of `studyId`/`studyName`. `EntityModal`'s `add-location` submit
  branch drops `study_id` from the payload entirely (matches the backend `LocationCreate` schema,
  which has neither `study_id` nor `client_id` — the owning client is URL-path-only).
- **Task 5 (AC2, AC3):** New `StudyLocationsCard` component (Locations card variant with a per-row
  "Remove" affordance — the generic `ChildListCard` doesn't support per-row actions, so a dedicated
  component was added rather than overloading the shared one). New
  `AssociateLocationPanel.tsx` (right-docked picker modeled on `AttachPanel`, `attachedIds`-style
  exclusion via the Study's already-associated Locations). Remove opens a `ConfirmDialog` and calls
  `useDisassociateLocation(studyId).mutateAsync(locationId)` — never `deleteLocation`.
- **Task 6 (AC5):** `LocationDetailRoute`'s breadcrumb rewritten from the old 5-segment
  Client→Project→Study→Location path to **Client→Location** (a Location's only ancestor now).
  `LocationDetail` no longer takes a `studyName` prop or renders a `Study` MetaChip.
  `useStoreActivePath` for the Location route now only carries the Client id.
- **Task 7 (AC6, mandatory data-loss fix):** Removed the destructive study-delete Location cascade —
  `fetchStudyLocations`, `cascadeDeleteOneLocation`, the `cascadeDeleteLocation` hook instance, the
  `countingLocations` state, and the location-count pre-fetch in `requestDeleteStudy` are all deleted.
  `confirmDelete`'s `study` branch now only deletes the Study; the delete-study `ConfirmDialog` copy
  no longer warns about removing locations. `DeleteTarget` gained a third `disassociate` variant
  (location + studyId + studyName, for the Remove-from-Study confirm) and the `location` variant
  dropped its now-unnecessary `studyId` field (post-delete navigation goes to the owning Client
  instead of "the parent study").
- **Task 8 (AC1-AC7):** New `src/api/hierarchy.test.ts` (5 tests) pins the exact wire contract for
  `createClientLocation`/`listClientLocations`/`listLocations`/`associateLocation`/
  `disassociateLocation`, including the no-body-unwrap behavior for the two 204 endpoints.
  `EngagementsScreen.test.tsx` updated throughout: fixture `study_id`→`client_id`; rewrote the
  Add-Location tests to target the Client screen; added a payload-shape assertion proving no
  `study_id`/`client_id` leaks into the create body; added Associate-picker and Disassociate tests;
  **replaced** the old "deleting a study with locations warns and cascades" test (which asserted the
  now-removed destructive behavior) with an AC6 regression test asserting a study delete calls only
  `DELETE /studies/{id}` and **never** `DELETE /locations/{id}` — the load-bearing test for this
  story's mandatory data-loss fix. Location breadcrumb test updated to the new Client→Location shape.
  Also updated two OTHER test files whose wholesale `useEngagements` mocks needed the renamed/new
  hook exports added: `src/routes/internal.test.tsx`, `src/pages/LogoutFlow.test.tsx` (both were
  pre-existing files outside this story's originally-scoped File List, discovered via the full-suite
  gate run — documented here since they were touched).
- **Task 9 (Gates):** `tsc --noEmit` clean. `eslint` clean (1 pre-existing unrelated warning in
  `Icon.tsx`, not touched by this story). `vitest run`: 61 files / 745 tests passing (0 new
  failures). Confirmed `git status` clean in `velara-api` — no backend change, no `docs/api-spec.json`
  diff, per the story's FE-only scope.

### File List

**Added (velara-web):**
- `velara-web/src/api/hierarchy.test.ts`
- `velara-web/src/features/engagements/components/AssociateLocationPanel.tsx`

**Modified (velara-web):**
- `velara-web/src/api/hierarchy.ts` — `createLocation`→`createClientLocation`; added
  `listClientLocations`/`associateLocation`/`disassociateLocation`.
- `velara-web/src/features/engagements/types.ts` — `Location.study_id`→`client_id`; `study_id`
  dropped from `LocationCreateInput`; new `StudyLocationAssociationCreate`.
- `velara-web/src/features/engagements/hooks/useEngagements.ts` — Locations section rewritten:
  `useCreateClientLocation`, `useClientLocations`, `useAssociateLocation`, `useDisassociateLocation`
  added; `useUpdateLocation`/`useDeleteLocation` re-keyed to `clientId`; `useLocationContext`
  reworked to a Client-only ancestor chain.
- `velara-web/src/features/engagements/components/EngagementsScreen.tsx` — `ModalMode` location
  variants re-keyed to client; `ClientDetail` gains a Locations card; new `StudyLocationsCard`
  component; `StudyDetail`'s Locations affordance is now Associate/Remove; `LocationDetail`/
  `LocationDetailRoute` breadcrumb reworked to Client→Location; destructive study-delete cascade
  removed (AC6); `DeleteTarget` gained a `disassociate` variant; `DetailHandlers` interface updated.
- `velara-web/src/features/engagements/components/EngagementsScreen.test.tsx` — fixtures, Add
  Location tests, breadcrumb test, AC6 regression test, new Associate/Disassociate tests.
- `velara-web/src/routes/internal.test.tsx` — `useEngagements` mock factory updated for
  renamed/new hook exports.
- `velara-web/src/pages/LogoutFlow.test.tsx` — `useEngagements` mock factory updated for
  renamed/new hook exports.
