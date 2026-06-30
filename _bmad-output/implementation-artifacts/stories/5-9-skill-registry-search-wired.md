---
baseline_commit: a111997cfb1267cc9f8ca1c0fb89fa9c4698da4e
---

# Story 5.9: Skill Registry Search — Wired to Server

Status: done

## Story

As a Vitalief consultant,
I want the skill registry search box to find skills across the entire catalog (not just the current page),
so that I can locate any skill by name or description regardless of how many pages exist.

> **FRONTEND-ONLY story** (React 19 + TanStack Query 5 + Tailwind v4). **Depends on Story 5-8** (`GET /api/v1/skills?q=` backend, must be done first). No backend changes, no migration, no new dependency.
>
> **The problem this fixes:** `SkillRegistry.tsx` today has a search box that filters only the items loaded on the current page (client-side `includes()` on `data?.items`). This was an explicit documented limitation from 5-7 — the backend had no `?q=` param. Story 5-8 adds that param. This story wires the existing UI search box to it, making search work across the full catalog.
>
> **Scope is surgical.** The search box, its state, and its clear button already exist in `SkillRegistry.tsx`. The `listSkillsPage` API function and `useSkillsPage` hook already pass through arbitrary params. This story: (1) passes `q` as a server-side param instead of filtering client-side, (2) resets page to 1 when `q` changes (same as the existing `status` filter pattern), (3) removes the now-redundant client-side name/description filter (tags stay client-side — no `?tag=` UI control exists and the backend `?tag=` is an exact-match, not substring), (4) updates the honesty hint and empty-state copy to reflect that search now works server-side.
>
> **Type and Visibility filters stay client-side.** The backend has no `?runtime_type=` or `?visibility=` params. Those filters continue to work within the loaded page only — their existing copy already reflects this and needs no change.

## Acceptance Criteria

**AC1 — Search box sends `?q=` to the server and returns results from the full catalog**
**Given** the catalog has skills on multiple pages, and the skill I'm looking for is on page 3
**When** I type its name into the search box
**Then** it appears in the results — because the request is `GET /api/v1/skills?q=<term>&page=1` (server-side), not a client-side filter on the current page's items
> Pass `q: search.trim() || undefined` into `useSkillsPage`. An empty/whitespace search → `q` is `undefined` → omitted from the request → no `?q=` param → server returns full unfiltered list. `undefined` params are dropped by Axios automatically.

**AC2 — Typing in the search box resets pagination to page 1**
**Given** I'm on page 3 of the registry
**When** I type in the search box
**Then** the page resets to 1 — because `?q=` changes the result set, and the previous page offset may exceed the new total
> Mirror the existing `changeState` pattern: when `search` changes, call `setPage(1)`. Extract an `onChange` handler or add a `useEffect` on `search` that calls `setPage(1)` (whichever is cleaner given the existing structure).

**AC3 — Client-side filtering on name/description is removed; tags stay client-side**
**Given** the server now filters by name/description
**When** the client applies `filtered = items.filter(...)` within the page
**Then** the `inName` and `inDesc` branches are removed from the client-side filter (the server already handled them); the `inTags` branch stays (no backend `?tag=` UI control) — so `filtered` is used only for the Type and Visibility segmented-control filters and the tag substring check
> In the `filtered` useMemo, remove:
> ```
> if (search.trim()) {
>   const q = search.trim().toLowerCase()
>   const inName = s.name.toLowerCase().includes(q)
>   const inDesc = s.description?.toLowerCase().includes(q) ?? false
>   const inTags = s.tags.some((t) => t.toLowerCase().includes(q))
>   if (!inName && !inDesc && !inTags) return false
> }
> ```
> Replace with (tags-only client filter, applied only when search is set):
> ```
> if (search.trim()) {
>   const q = search.trim().toLowerCase()
>   const inTags = s.tags.some((t) => t.toLowerCase().includes(q))
>   if (!inTags) return false
> }
> ```
> Wait — actually, do NOT add the tags branch back. Tags are already filterable by the `?tag=` backend param (exact-match), and there's no tag search UI. Keeping the `inTags` client-side check would silently include tag-matching skills that don't match the name/description `?q=` server filter, creating confusing results. Remove the entire `search.trim()` block from the client-side filter. The `search` state drives the server `?q=` param only.
>
> So the `filtered` useMemo becomes:
> ```typescript
> const filtered = useMemo(() => {
>   return items.filter((s) => {
>     if (typeFilter !== 'all' && s.runtime_type !== typeFilter) return false
>     if (visFilter !== 'all' && s.visibility !== visFilter) return false
>     return true
>   })
> }, [items, typeFilter, visFilter])
> ```

**AC4 — The honesty hint is removed; the search box placeholder and label update**
**Given** search now works across the full catalog
**When** I interact with the search box
**Then** (a) the "Filtering the current page only. Press ⌘K..." hint no longer appears (it was the honest disclaimer for the limitation that no longer exists); (b) the search box placeholder reads "Search skills by name or description…" (not "Filter this page by name, description, or tag…"); (c) the `aria-label` reads "Search skills"
> Remove the `{pageHasFilters && total > metaPerPage && (...)}` block entirely. Update `placeholder` and `aria-label` on the `<input>`. The ⌘K palette remains available for users who prefer it — just don't hint at it as a workaround.

**AC5 — Empty-state copy distinguishes "no results for this search" from "no skills registered"**
**Given** I search for a term that matches nothing
**When** the server returns 0 results
**Then** the empty-state message reads "No skills match your search." (not "No skills registered yet.") — making it clear the catalog is not empty, just unmatched
> The existing empty-state ternary already handles `pageHasFilters`. After this story, `pageHasFilters` covers the search case (since `search.trim() !== ''` is still in the `pageHasFilters` expression). Update the copy in the falsy branch of `pageHasFilters ? ... : ...` to keep it accurate.

**AC6 — Debounce: search sends the request only after 300ms of idle typing**
**Given** I type "protocol extractor" quickly
**When** each keystroke updates the `search` state
**Then** only one network request fires (300ms after I stop typing), not one per character
> The `useSkillsPage` call fires on every `search` state change today because search is in the query key. Add a `useDebounce` hook or a simple `useState`/`useEffect` debounce: derive `debouncedSearch` from `search` with a 300ms delay; pass `debouncedSearch` to `useSkillsPage` instead of `search`; keep the `page` reset tied to `search` (immediate, so the page resets while the debounce is pending).
>
> If a `useDebounce` hook doesn't already exist in the codebase, implement a simple one inline in the component or in `src/shared/hooks/`:
> ```typescript
> function useDebounce<T>(value: T, delay: number): T {
>   const [debounced, setDebounced] = useState(value)
>   useEffect(() => {
>     const t = setTimeout(() => setDebounced(value), delay)
>     return () => clearTimeout(t)
>   }, [value, delay])
>   return debounced
> }
> ```
> Check `src/shared/hooks/` for an existing debounce before adding one.

## Scope

**5-9 BUILDS:**
- **`SkillRegistry.tsx`** — wire `search` as `q` param to `useSkillsPage`; add debounce; reset page on search change; remove client-side name/description filter; remove honesty hint; update placeholder and aria-label; update empty-state copy.
- **`useDebounce` hook** — add to `src/shared/hooks/` if it doesn't exist (check first).
- **`SkillRegistry.test.tsx`** — update tests that mock `useSkillsPage` to pass `q` in params; add tests for debounce (mock timers), page reset on search change, server-driven empty state.
- **`skills.ts`** — `listSkillsPage` already accepts arbitrary `ListSkillsPageParams`; add `q?: string` to the `ListSkillsPageParams` interface so TypeScript catches unrecognised keys.

**5-9 DEFERS / OUT OF SCOPE:**
- **Backend** — done by Story 5-8. Do NOT touch `velara-api`.
- **Type / Visibility server-side filtering** — no backend params; stays client-side within the page. No change.
- **Tag search UI** — no new tag search input. `?tag=` exact-match backend param exists but has no UI control.
- **⌘K palette** — unchanged. `useSkills` (whole-catalog, per_page:200) is not modified. ⌘K retains its own client-side filter on that fetch.
- **`listSkills` (whole-catalog)** — do NOT add `q` to the whole-catalog path. ⌘K already does client-side filtering on its 200-skill fetch.
- **No migration, no new backend dependency.**

## Tasks / Subtasks

- [x] **Task 0 — Read the current `SkillRegistry.tsx` and `hooks/useSkills.ts` and `api/skills.ts` in full before touching anything (all ACs)**
  - [x] Read `SkillRegistry.tsx` in full — mapped `search` state, `useSkillsPage` call, client-side `filtered` useMemo (name/desc/tag branch), `pageHasFilters`, honesty hint block, empty-state ternary, indicator wording.
  - [x] Read `hooks/useSkills.ts` — confirmed `useSkillsPage` passes `params` straight into the query key + `listSkillsPage(params)` queryFn, so a new `q` flows through automatically.
  - [x] Read `api/skills.ts` — confirmed `ListSkillsPageParams` (page/per_page/status/tag) + `listSkillsPage` passes params to Axios verbatim.
  - [x] Checked `src/shared/hooks/` — only `useDocumentTitle` exists; no `useDebounce` → created one.
  - [x] Consumer audit: `useSkillsPage` has exactly ONE caller (`SkillRegistry.tsx`); `ListSkillsPageParams` is consumed only by `listSkillsPage` + `useSkillsPage`. Adding `q?:` is a backwards-compatible extension — no other consumer affected.

- [x] **Task 1 — Add `q` to `ListSkillsPageParams` in `api/skills.ts` (AC1)**
  - [x] Added `q?: string` to `ListSkillsPageParams` with a doc comment. No other API-layer change (Axios drops `undefined` params).

- [x] **Task 2 — Add debounce hook if needed (AC6)**
  - [x] No existing hook → created `src/shared/hooks/useDebounce.ts` (generic `useState`/`useEffect`, 3 unit tests with fake timers).

- [x] **Task 3 — Wire `search` → `?q=` in `SkillRegistry.tsx` (AC1, AC2, AC3, AC4, AC5, AC6)**
  - [x] `const debouncedSearch = useDebounce(search, 300)` after the `search` state.
  - [x] `useEffect(() => { setPage(1) }, [search])` — immediate (non-debounced) page reset (AC2).
  - [x] `useSkillsPage({ page, per_page: PER_PAGE, status, q: debouncedSearch.trim() || undefined })` (AC1/AC6).
  - [x] Removed the entire client-side `search.trim()` branch from the `filtered` useMemo; removed `search` from its deps — now only Type/Visibility (AC3).
  - [x] Removed the honesty hint block entirely (AC4).
  - [x] Updated `<input>` `placeholder="Search skills by name or description…"` + `aria-label="Search skills"` (AC4).
  - [x] Empty-state `pageHasFilters` branch copy → `"No skills match your search."`; other branches unchanged (AC5).
  - [x] `pageHasFilters` expression unchanged (still includes `search.trim() !== ''`) — correct per Dev Notes.

- [x] **Task 4 — Tests (AC1–AC6)**
  - [x] Read existing `SkillRegistry.test.tsx` mock patterns first. Rewrote the suite (28 → 30 tests): the removed client-side name/tag-search tests + the ⌘K-hint test + the old placeholder/empty-state copy were replaced with server-side `?q=` behavior. New `src/shared/hooks/useDebounce.test.ts` (3 tests).
  - [x] `passes q to useSkillsPage after the 300ms debounce` (fake timers + `advanceTimersByTime(300)`).
  - [x] `q is undefined when the search box is empty` + `whitespace-only search sends q: undefined`.
  - [x] `typing in the search box resets pagination to page 1`.
  - [x] `shows "No skills match your search." when the server returns 0 for a search`.
  - [x] `filters the current page by runtime type/visibility (client-side)` retained.
  - [x] `does NOT show the old "filtering the current page only" ⌘K hint`.
  - [x] Plus: debounce coalescing (no intermediate `q`), `does NOT apply the search term client-side`, new placeholder/aria-label assertion.
  - [x] Gates: typecheck 0, lint clean, **251 web tests pass (+6 from 245 baseline, 0 regressions)**, build ✓.

## Dev Notes

### Surgical diff — what changes in `SkillRegistry.tsx`

This is a small diff. The component structure is unchanged. Line-by-line:

**1. Add debounce (after `const [search, setSearch] = useState('')`):**
```typescript
const debouncedSearch = useDebounce(search, 300)
```

**2. Add page reset on search (after existing state declarations):**
```typescript
useEffect(() => { setPage(1) }, [search])
```

**3. Change `useSkillsPage` call:**
```typescript
// Before:
const { data, isLoading, error } = useSkillsPage({ page, per_page: PER_PAGE, status })
// After:
const { data, isLoading, error } = useSkillsPage({
  page,
  per_page: PER_PAGE,
  status,
  q: debouncedSearch.trim() || undefined,
})
```

**4. Remove `search` from `filtered` useMemo; remove it from deps:**
```typescript
// Before:
const filtered = useMemo(() => {
  return items.filter((s) => {
    if (typeFilter !== 'all' && s.runtime_type !== typeFilter) return false
    if (visFilter !== 'all' && s.visibility !== visFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const inName = s.name.toLowerCase().includes(q)
      const inDesc = s.description?.toLowerCase().includes(q) ?? false
      const inTags = s.tags.some((t) => t.toLowerCase().includes(q))
      if (!inName && !inDesc && !inTags) return false
    }
    return true
  })
}, [items, typeFilter, visFilter, search])

// After:
const filtered = useMemo(() => {
  return items.filter((s) => {
    if (typeFilter !== 'all' && s.runtime_type !== typeFilter) return false
    if (visFilter !== 'all' && s.visibility !== visFilter) return false
    return true
  })
}, [items, typeFilter, visFilter])
```

**5. Remove honesty hint block (~5 lines starting with `{pageHasFilters && total > metaPerPage && (`).**

**6. Update `<input>` attrs:**
```typescript
placeholder="Search skills by name or description…"
aria-label="Search skills"
```

**7. Update empty-state copy:**
```typescript
// Before:
pageHasFilters
  ? 'No skills on this page match your filters.'
  : stateFilter !== 'all'
    ? 'No skills match the selected state.'
    : 'No skills registered yet.'

// After:
pageHasFilters
  ? 'No skills match your search.'
  : stateFilter !== 'all'
    ? 'No skills match the selected state.'
    : 'No skills registered yet.'
```

### Why `debouncedSearch` drives the query but `search` drives the page reset

The page reset must be immediate — if you debounce both, the user sees stale pagination state ("Page 3 of 50") for 300ms while typing. Resetting page on raw `search` change is instant; the debounced query fires 300ms later with the reset page. This is the same pattern most search UIs use.

### `pageHasFilters` expression

The current expression is `typeFilter !== 'all' || visFilter !== 'all' || search.trim() !== ''`. After this story, the `search.trim() !== ''` term still makes sense — it's now "any filter is active" which determines the empty-state copy. The expression stays the same.

### Why the ⌘K path is unchanged

`useSkills()` → `listSkills()` fetches with `per_page: 200` and no `q` param. It returns a flat `Skill[]`. AppBar's ⌘K palette does its own client-side filter on that array. This story does not touch that path — ⌘K remains a whole-catalog client-side search up to 200 skills. The two search surfaces (registry table = server-side `?q=`, ⌘K = client-side on whole-catalog fetch) now both work correctly for their intended use case.

### Consumer audit (retro lesson — do this before writing)
- `useSkillsPage` callers: only `SkillRegistry.tsx`. Adding `q` to params is safe — no other consumer affected.
- `ListSkillsPageParams` interface consumers: only `listSkillsPage` in `api/skills.ts` + `useSkillsPage` in `hooks/useSkills.ts`. Adding `q?: string` is a backwards-compatible extension.

### Project Structure Notes

Files touched (all `velara-web`):
- `src/api/skills.ts` — add `q?: string` to `ListSkillsPageParams`
- `src/shared/hooks/useDebounce.ts` — add if not exists
- `src/features/skills/components/SkillRegistry.tsx` — wire `q`, debounce, page reset, remove client filter, update copy
- `src/features/skills/components/SkillRegistry.test.tsx` — update + new tests

Do NOT touch `velara-api`. Do NOT touch `useSkills` / `listSkills` / `AppBar` / `useProjectSkills`.

### References
- [Source: deferred-work.md:152] — the HIGH item this story closes; includes the exact verified source lines confirming the missing `?q=` param.
- [Source: stories/5-8-skills-free-text-search-api.md] — the backend story this depends on; must be `done` before this story starts.
- [Source: stories/5-7-skill-registry-ui-pagination.md] — the 5-7 story that established `SkillRegistry.tsx`'s current structure, `useSkillsPage`, and the honesty hint this story removes.
- [Source: implementation-artifacts/epic-5-retro-2026-06-26.md] — retro action item 2; root cause of the gap.
- Code seams (verified): `velara-web/src/features/skills/components/SkillRegistry.tsx` (full component read in Task 0), `velara-web/src/api/skills.ts` (`ListSkillsPageParams` interface + `listSkillsPage`), `velara-web/src/features/skills/hooks/useSkills.ts` (`useSkillsPage`), `velara-web/src/shared/hooks/` (check for existing `useDebounce`).

### Review Findings (Code Review — 2026-06-26)

> Reviewed: uncommitted working-tree changes, cleanly scoped to the 5-file 5.9 File List (~558 diff lines). Three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). **All 6 ACs verified satisfied** + the whole-catalog `useSkills`/`listSkills`/`AppBar` ⌘K/`useProjectSkills` paths confirmed untouched. Gates green (typecheck 0, 251 tests, build ✓). The findings below are correctness/quality refinements, not AC failures. Both diff-only and source-aware layers converged on one root cause: **`pageHasFilters` now overloads "a server-side search is active" with "a client-side Type/Visibility filter is active"**, which were the same thing pre-5-9 (search was client-side) but no longer are.

**Patch (all FIXED & verified — gates green):**

- [x] [Review][Patch] Empty-state shows "No skills match your search." when a **Type/Visibility filter** (no search text) empties the page [src/features/skills/components/SkillRegistry.tsx:289] — FIXED: split the overloaded `pageHasFilters` into `searchActive` (`search.trim() !== ''`) and `pageLocalFilters` (`typeFilter !== 'all' || visFilter !== 'all'`). The empty-state ternary now reads: search → "No skills match your search."; Type/Vis only → "No skills on this page match your filters."; State → "No skills match the selected state."; else → "No skills registered yet." New regression test (`shows the page-local filter copy (NOT the search copy) when a Type filter empties the page`) locks it.
- [x] [Review][Patch] Indicator wording "Showing N of M on this page…" is wrong for a clean server-side search [src/features/skills/components/SkillRegistry.tsx:308] — FIXED: the page-local indicator branch is now gated on `pageLocalFilters` (Type/Vis only), not search. A server-side search is reflected in the server `total`, so it correctly gets the honest "Showing X–Y of N"; the "on this page" framing now appears only when a genuinely page-local Type/Visibility filter makes the visible rows a subset of the server page.
- [x] [Review][Patch] Debounce test timer setup [src/features/skills/components/SkillRegistry.test.tsx:222] — Investigated: removing `shouldAdvanceTime` broke 5 tests (user-event's internal keystroke async needs the clock to advance during typing → timeouts). `shouldAdvanceTime: true` is in fact **required** for user-event under fake timers; the debounce-boundary assertion stays meaningful because the tests gate on an explicit `advanceTimersByTime(300)` AFTER typing a short string. KEPT `shouldAdvanceTime: true` and added a comment documenting why (resolves the "ambiguous setup" concern by making the intent explicit rather than changing the mechanism).

**Dismissed as noise (6):** immediate page-reset vs debounced-`q` intermediate `{page:1, q:stale}` request (inherent to the spec-mandated "immediate reset + debounced query" pattern — the alternative reintroduces the "Page 3 of 0" flash the spec explicitly avoids; `staleTime` caches the intermediate); the `debounces:` coalescing test being weak (the sibling `passes q after the 300ms debounce` test already proves the 300ms gate — q absent before advance, present after); "Axios drops undefined params" only asserted by comment (verified true — `client.ts` has no custom `paramsSerializer`, and the existing `status` param relies on the identical proven behavior); page-reset effect firing on mount (`setPage(1)` when already 1 is a no-op React bails out of); `useDebounce` lacking an unmount-write test (hook correctly returns `clearTimeout`; Edge verified cleanup); `staleTime:30s` serving a stale same-`q` result (q is in the query key — correct; matches existing list behavior, by design).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — claude-opus-4-8[1m]

### Debug Log References

- RED/GREEN: `useDebounce.test.ts` failed (module not found) → created hook → 3 pass.
- Rewrote `SkillRegistry.test.tsx` (the prior suite asserted the now-removed client-side name/tag search, the ⌘K hint, the old placeholder, and the old empty-state copy). New suite: 30 pass.
- Gates (from `velara-web/`): typecheck 0, lint clean, 251 web tests pass, build ✓.

### Completion Notes List

- **Story 5.9 implemented frontend-only** — wired the SkillRegistry search box to the server-side `?q=` param (delivered by the now-done Story 5-8), added a 300ms debounce, reset page to 1 on search change, removed the client-side name/description/tag filter, removed the ⌘K honesty hint, and updated the placeholder/aria-label/empty-state copy.
- **Surgical, in scope.** Touched exactly the 4 files in the story's File List + the new `useDebounce.test.ts`. No backend, no migration, no new dependency. Did NOT touch `velara-api`, `useSkills`/`listSkills` (whole-catalog), `AppBar` (⌘K), or `useProjectSkills`.
- **Consumer audit (retro lesson) done before writing:** `useSkillsPage` has one caller (SkillRegistry); `ListSkillsPageParams` is consumed only by `listSkillsPage` + `useSkillsPage`. Adding `q?: string` is backwards-compatible.
- **Debounce design:** raw `search` drives the input + the immediate page reset (so the page indicator never flashes a stale "Page 3 of 0"); `debouncedSearch` (300ms) drives the `useSkillsPage` query. Empty/whitespace `search` → `q` is `undefined` → Axios omits the `?q=` param → server returns the full unfiltered list.
- **AC3 decision (per Dev Notes):** removed the *entire* `search.trim()` client-side block — including the tag branch — not just name/description. Keeping a client-side tag match would surface tag-matching skills the server's name/description `?q=` filter excluded, creating confusing mixed results. The `filtered` useMemo now applies only Type + Visibility (the two genuinely client-side, no-backend-param filters).
- **`pageHasFilters` left unchanged** (still includes `search.trim() !== ''`) — it drives the empty-state copy ("No skills match your search.") and the page-local indicator wording; Type/Visibility remain genuinely page-local so the wording stays accurate. The indicator change was explicitly out of scope.
- **⌘K unchanged:** the registry table now searches server-side via `?q=`; the ⌘K palette continues its own client-side filter over the whole-catalog `useSkills()` (per_page:200) fetch. The two surfaces are now both correct for their use cases.
- **Tests:** +6 net (245 → 251, 0 regressions). New: `useDebounce.test.ts` (3). Rewrote `SkillRegistry.test.tsx` (28 → 30) — added server-side `?q=` after debounce, debounce coalescing, page-reset-on-search, whitespace→undefined, no client-side search filtering, hint-removed, new placeholder/aria-label, "No skills match your search." empty state.

### File List

**New:**
- `velara-web/src/shared/hooks/useDebounce.ts`
- `velara-web/src/shared/hooks/useDebounce.test.ts`

**Modified:**
- `velara-web/src/api/skills.ts` (added `q?: string` to `ListSkillsPageParams`)
- `velara-web/src/features/skills/components/SkillRegistry.tsx` (debounce, page-reset effect, `q` param wired, client-side search filter removed, honesty hint removed, placeholder/aria-label + empty-state copy updated)
- `velara-web/src/features/skills/components/SkillRegistry.test.tsx` (rewrote for server-side search behavior)

## Change Log

| Date       | Change                                                                                              |
|------------|----------------------------------------------------------------------------------------------------|
| 2026-06-26 | Story 5.9 implemented: wired the Skill Registry search box to server-side `GET /api/v1/skills?q=` (Story 5-8 backend), 300ms debounce via new `useDebounce` hook, page-reset-on-search, removed the client-side name/description/tag filter + the ⌘K honesty hint, updated placeholder ("Search skills by name or description…") / aria-label ("Search skills") / empty-state copy ("No skills match your search."). FE-only, no backend/migration/dep. Gates: typecheck 0, lint clean, 251 web tests (+6 from 245, 0 regressions), build ✓. Status → review. |
