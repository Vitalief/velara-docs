---
baseline_commit: a111997cfb1267cc9f8ca1c0fb89fa9c4698da4e
---

# Story 5.7: Skill Registry UI — Pagination

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want the Skill Registry to load skills in pages,
so that browsing the registry stays fast even with a large skill catalog.

> **FRONTEND-ONLY story** (React 19 + React Router 7 + TanStack Query 5 + Axios + Tailwind v4). **Depends on Story 5-6** (`done`), which changed `GET /api/v1/skills` to return `ResponseEnvelope[SkillListData]` (`{items: SkillRead[], page: {total, page, per_page}}`) instead of a bare array. No backend, no migration, no new dependency.
>
> **⚠️ The 5-6 contract change ALREADY BROKE the frontend.** `listSkills` (`velara-web/src/api/skills.ts:4-6`) reads `response.data.data` as `Skill[]`, but `data` is now `{items, page}` — so today every `useSkills()` consumer receives the wrapper object cast as an array (runtime breakage: `.filter`/`.map`/`.slice` on a non-array). **Fixing this is the first job.** See *Dev Notes → The break + the 3 consumers*.
>
> **MIRROR THE 5-4 FE PAGINATION PRECEDENT.** Story 5-4 built `api/jobs.ts` (`PageMeta`/`JobListData`/`listJobs`) + `useJobs(params)` + `JobsHistory.tsx` consuming `{items, page}`. Copy those shapes for skills (`PageMeta`/`SkillListData`/`listSkillsPage` + `useSkillsPage`). Note: `JobsHistory` shows `page.total` but has **no page-navigation controls** — 5-7 adds the FIRST real Prev/Next affordance.
>
> **Two in-story decisions locked with user (2026-06-25):**
> 1. **Pagination affordance = Prev / Next + "Showing X–Y of N"** (not Load-more, not infinite scroll).
> 2. **⌘K palette stays a separate whole-catalog quick-search** (its own `useSkills()` path); **only the registry TABLE paginates.** The table's inline search box becomes **current-page-only** (documented limitation — the backend has no free-text search). See *Dev Notes → Search behavior*.

## Acceptance Criteria

**AC1 — Registry consumes the paged endpoint; Prev/Next + total**
**Given** the Skill Registry tab
**When** the page loads
**Then** it consumes the paged `GET /api/v1/skills` (via a `useSkillsPage`/`listSkillsPage` accepting `page`/`per_page`), showing one page of results with **Prev / Next controls + a "Showing X–Y of N" indicator** reflecting `PageMeta.total` (default `per_page=50`)
> Add `listSkillsPage(params): Promise<SkillListData>` + a `useSkillsPage({page, status?, tag?})` hook (mirror `listJobs`/`useJobs`). Prev disabled on page 1; Next disabled when `page * per_page >= total`. "Showing X–Y of N" computed from `page`, `per_page`, `total`. **The registry stops fetching-all-then-filtering** (`SkillRegistry.tsx:102-124`).

**AC2 — Filters move server-side where supported; React Query key includes page + filters**
**Given** I apply a lifecycle filter (State)
**When** the filter changes
**Then** `?status=` is sent as a server-side query param (off the fetch-all-then-filter-client-side model); the React Query key includes `page` + active server filters; changing a filter resets to page 1
> **Backend supports ONLY `?status=` (lifecycle) and `?tag=` server-side.** The registry's **Type** (runtime) and **Visibility** filters have **NO backend param** — so they must either (a) stay client-side-within-page (documented, consistent with the search decision) or (b) be honestly scoped. **Decision:** State → server-side `?status=`; Type + Visibility + free-text search → **client-side within the current page** (documented limitation; same model as search). Query key e.g. `['skills-page', { page, per_page, status }]`. Changing `status` (or any client filter that the user expects to span the catalog) → reset `page` to 1. See *Dev Notes → Filters: which go server-side*.

**AC3 — Free-text / ⌘K search behavior (locked decision)**
**Given** I use the free-text search box or the ⌘K palette
**When** I type
**Then** the **inline registry search box filters within the current page only** (documented limitation); the **⌘K palette keeps its existing whole-catalog behavior** via its own `useSkills()` path (re-confirm the 2.4 ⌘K registry-search still works under the refactor)
> No backend free-text search exists (only `?status=`/`?tag=`). The inline table search filters `data.items` client-side (current page). The **AppBar ⌘K palette** (`AppBar.tsx:41`) must keep working whole-catalog — so `useSkills()` must STILL return `Skill[]` (see the consumer-preservation requirement in *Dev Notes*). Re-confirm ⌘K skill search after the `listSkills` fix.

**AC4 — Loading / empty / error preserved + a11y on controls**
**Given** the registry is loading, empty, or errored
**When** any of those states occur
**Then** the existing loading (skeleton rows), empty ("No skills…"), and error UX is preserved, and the Prev/Next controls are keyboard-accessible with proper labels (`aria-label`, `disabled` states, focus-visible)
> Keep `SkeletonRows`, the empty-state copy (`SkillRegistry.tsx:237-245`), and the error row. Prev/Next are real `<button>`s with `aria-label="Previous page"/"Next page"`, `disabled` at bounds, and a `focus-visible` ring (mirror existing button a11y).

## Scope

**5-7 BUILDS:**
- **Fix `listSkills`** (`api/skills.ts`) so existing whole-catalog consumers keep getting `Skill[]` (unwrap `.items` — see Dev Notes for the exact approach that doesn't truncate).
- **`SkillListData`/`PageMeta` FE types** in `api/skills.ts` (mirror `api/jobs.ts:90-98`).
- **`listSkillsPage(params)`** + **`useSkillsPage(params)`** hook (the registry's paged path; mirror `listJobs`/`useJobs`).
- **Refactor `SkillRegistry.tsx`**: consume `useSkillsPage`, server-side `?status=` from the State filter, Prev/Next + "Showing X–Y of N", page-reset on filter change, Type/Visibility/search client-side-within-page.
- **Tests** (registry pagination/controls/filter→page-reset/empty/error/a11y; ⌘K still works; the 3 consumers still get arrays) + update the existing `SkillRegistry.test.tsx` mocks to the new hook/shape.

**5-7 DEFERS / OUT OF SCOPE:**
- **Backend changes** — none (5-6 already shipped the contract). Do NOT add a `?q=` search param (user chose client-side-within-page; adding backend search is the rejected scope-creep option).
- **Server-side Type/Visibility filters** — backend has no such params; client-side-within-page (documented limitation). Not a backend story.
- **Server-side free-text search** — none exists; not added.
- **⌘K palette pagination** — ⌘K stays whole-catalog via its own path; do not paginate it.
- **Other list screens** (Engagements, Jobs already done in 5-4) — not in scope.

## Tasks / Subtasks

- [x] **Task 0 — Read the 5-4 FE pagination precedent + map the break (AC: 1, 3)**
  - [x] Read `src/api/jobs.ts:90-122` (`JobSummary`/`PageMeta`/`JobListData`/`listJobs(params)`), `src/features/run/hooks/useJob.ts:24-30` (`useJobs(params)` → `useQuery({queryKey:['jobs',params], queryFn:()=>listJobs(params), staleTime:30_000})`), and `src/features/run/components/JobsHistory.tsx:203,230-231,248-269` (consumes `{items, page}`, shows `page.total`, NO page controls). **Mirrored these for skills.**
  - [x] Confirmed the 3 `useSkills()` consumers (`SkillRegistry:102`, `useProjectSkills:13`, `AppBar:41`) and the current `SkillRegistry` fetch-all-filter model (`:102-124`).

- [x] **Task 1 — Fix `listSkills` + add paged types & API (AC: 1, 3)**
  - [x] Added FE types to `src/api/skills.ts`: `interface PageMeta { total; page; per_page }`, `interface SkillListData { items: Skill[]; page: PageMeta }`, `interface ListSkillsPageParams`.
  - [x] **Fixed the broken `listSkills`** (`:4-6`): now requests `per_page: 200` and returns `response.data.data.items` (unwraps the 5-6 `{items, page}` envelope). Kept the `(params?: {status?; tag?}) => Promise<Skill[]>` signature so the 3 consumers are unchanged. **Documented the 200-cap** as a known whole-catalog limitation in the JSDoc; did NOT build multi-page accumulation.
  - [x] Added `listSkillsPage(params?: ListSkillsPageParams): Promise<SkillListData>` → returns the full `{items, page}`.

- [x] **Task 2 — `useSkillsPage` hook (AC: 1, 2)**
  - [x] Added `useSkillsPage(params)` → `useQuery({ queryKey: ['skills-page', params], queryFn: () => listSkillsPage(params), staleTime: 30_000 })` in `src/features/skills/hooks/useSkills.ts`. Mirrors `useJobs`. Left `useSkills()` (`['skills']`) UNCHANGED.

- [x] **Task 3 — Refactor `SkillRegistry.tsx` to server-side pagination (AC: 1, 2, 3, 4)**
  - [x] Replaced `useSkills()` + the fetch-all `useMemo` with `const [page, setPage] = useState(1)`; server `status` from the State filter; `useSkillsPage({ page, per_page: 50, status })`. Table renders `data.items`.
  - [x] **Client-side-within-page** for Type + Visibility + inline search via `items.filter(...)` (kept the EXISTING type/vis/search predicates; removed only the state predicate — state is server-side now). Kept the search box + clear button + 3 segmented controls.
  - [x] **Reset to page 1** on State change (`changeState` helper wired into the State `FilterSeg.onChange`). Type/Visibility/search are page-local and don't reset.
  - [x] **Prev / Next + indicator:** "Showing {start}–{end} of {total}" computed from the server-echoed `PageMeta` + `‹ Prev` (disabled `page<=1`) / `Next ›` (disabled `page*per_page>=total`). `aria-label="Previous page"/"Next page"`, `disabled`, `focus-visible` ring. Hidden when `total === 0`.
  - [x] **Preserved** loading (`SkeletonRows`), empty, and error UX. Empty-state distinguishes: page-local filters yield 0 → "No skills on this page match your filters"; State filter yields 0 → "No skills match the selected state"; catalog empty → "No skills registered yet." Added a guard `useEffect` that steps back off an empty trailing page.

- [x] **Task 4 — Re-confirm ⌘K + the other consumers still work (AC: 3)**
  - [x] `AppBar.tsx:41` `useSkills()` → `skills.filter(...).slice(0,6)` still gets a `Skill[]` (verified via typecheck 0 + AppBar.test still green; `listSkills` returns `Skill[]`). `useSkills`/`AppBar` untouched.
  - [x] `useProjectSkills.ts:13` `skills?.filter(s => s.scope === 'project')` still gets a `Skill[]` (typecheck 0 + RunConsole's 48 tests green). `useProjectSkills` untouched.

- [x] **Task 5 — Tests + gates (AC: 1–4)**
  - [x] **Rewrote** `SkillRegistry.test.tsx` to mock `useSkillsPage` (12 → 25 tests): renders current page + "Showing X–Y of N"; cross-page indicator math off PageMeta; Prev disabled p1 / Next disabled last page; Next advances + Prev steps back (asserts the hook re-invoked with the new page); State → server `status` param + page reset to 1 + "All" sends `undefined`; Type/Vis/search client-side-within-page + assertion they are NOT sent server-side; page-local + state + catalog empty-states; controls hidden at total 0; loading skeleton; error message; document.title.
  - [x] Added `src/api/skills.test.ts` (5 tests): `listSkills` unwraps `.items` to a `Skill[]`, requests `per_page:200`, forwards `status`/`tag`; `listSkillsPage` returns the full envelope + passes params verbatim. Updated `internal.test.tsx`'s `useSkills` mock to add `useSkillsPage` (route test renders the real registry). AppBar/RunConsole tests mock at the hook level → unaffected, still green.
  - [x] Gates: `npm run typecheck` (0), `npm run lint` (clean — 0 errors/0 warnings), `npm run test` (242 pass / **+18 from 224 baseline, 0 regressions**), `npm run build` (✓).

## Dev Notes

### The break + the 3 `useSkills()` consumers (verified — the #1 regression risk)
5-6 changed `GET /api/v1/skills` `data` from `SkillRead[]` → `{items, page}`. `listSkills` (`api/skills.ts:4-6`) returns `response.data.data` typed as `Skill[]` — now a `{items,page}` object at runtime. **Every `useSkills()` consumer is currently broken:**
1. **`SkillRegistry.tsx:102`** — `skills.filter(...)` (`:111`). The screen this story refactors to `useSkillsPage`.
2. **`useProjectSkills.ts:13`** — `skills?.filter(s => s.scope === 'project')` → feeds the **Run Console** (5-2/5-3). MUST keep getting `Skill[]`.
3. **`AppBar.tsx:41`** — `skills.filter(...).slice(0,6)` → the **⌘K command-palette skill search** (2.4). MUST keep getting `Skill[]`.
**Resolution:** keep `useSkills()` + `listSkills` returning `Skill[]` (fix `listSkills` to unwrap `.items`, request `per_page: 200`); give the registry a NEW `useSkillsPage` returning `{items, page}`. This is why the story does NOT just change `useSkills` to return the wrapper — that would break #2 and #3.

### The 5-4 FE precedent (mirror it — verified as-built)
- `api/jobs.ts:90-98`: `interface PageMeta { total; page; per_page }`, `interface JobListData { items: JobSummary[]; page: PageMeta }`. `listJobs(params): Promise<JobListData>` (`:119`).
- `useJob.ts:24-27`: `useJobs(params) => useQuery({ queryKey: ['jobs', params], queryFn: () => listJobs(params) })`.
- `JobsHistory.tsx`: consumes `data.items`/`data.page.total` (`:203,230-231,248-269`). **Has NO Prev/Next** — it requests `per_page:50` and shows one page + "N total". 5-7 is the first to add real page controls. Mirror the hook/type shapes; ADD the affordance.

### Backend contract (5-6, as-built — verified)
`GET /api/v1/skills` → `ResponseEnvelope[SkillListData]` where `SkillListData = {items: list[SkillRead], page: PageMeta{total, page, per_page}}` (`velara-api/app/schemas/skill.py:367-375`). Handler params (`skills.py:87-94`): `page: int (ge=1, le=100_000) = 1`, `per_page: int (ge=1, le=200) = 50`, `status: LifecycleState | None`, `tag: str | None`. Invalid page/per_page → 422. Out-of-range (in-range) page → empty `items` + correct `total`. **`status` = lifecycle enum; `tag` = exact-match. There is NO Type/Visibility/free-text param** — only `status` and `tag` are server-side.

### Filters: which go server-side vs. page-local (locked)
The registry has 4 filter UIs: **State** (lifecycle), **Type** (runtime), **Visibility**, **search box** (name/desc/tag). Backend server-side params: only `?status=` (State) and `?tag=` (the registry has no tag UI today — leave `tag` unused unless you add a tag chip; out of scope).
- **State → server-side `?status=`** (AC2). Changing it resets to page 1.
- **Type, Visibility, inline search → client-side within the current page** (documented limitation, consistent with the search decision). They filter `data.items` only — a match on another page won't appear. This is acceptable per the locked decision; surface it honestly (e.g. the empty-state copy when page-local filters yield 0: "No skills on this page match your filters").
> Rationale: Type/Visibility have no backend param and adding them is backend scope-creep (rejected). State is the one true server filter. Search-across-catalog stays the ⌘K palette's job (whole-catalog via `useSkills()`).

### Search behavior (locked with user)
- **Inline registry search box** → filters the current page's `items` client-side (current-page-only; documented limitation). Keep the search input + clear button (`SkillRegistry.tsx:164-182`).
- **⌘K palette (AppBar)** → UNCHANGED, stays whole-catalog via its own `useSkills()` (now returning ≤200 skills after the `listSkills` fix). Re-confirm 2.4 ⌘K skill search still works. Two search surfaces with different scopes — that's intended; document it.

### Pagination affordance (locked with user): Prev / Next + indicator
"Showing {start}–{end} of {total}" + `‹ Prev` / `Next ›`. `start = (page-1)*per_page + 1` (or 0 when total=0), `end = min(page*per_page, total)`. Prev disabled `page<=1`; Next disabled `page*per_page >= total`. Keyboard-accessible (`<button>` + `aria-label` + `disabled` + `focus-visible`). No "Load more", no infinite scroll.

### Conventions (architecture / established FE patterns)
- TanStack keys `[resource, params]` (`['skills-page', {page, per_page, status}]`); query refetches on key change. `isLoading`/`error` from the query (no hand-rolled booleans). `staleTime` default 30s.
- No new dependency; reuse `Skeleton`, `SkillRow`, the existing filter segmented controls + search box, brand tokens. Co-locate tests. Keep the change additive to `SkillRegistry.tsx` ("grow in place"); don't restructure unrelated parts.
- Envelope unwrap: `response.data.data` (then `.items` for the page payload).

### Project Structure Notes
- Files touched (all `velara-web`): `src/api/skills.ts` (fix `listSkills`, add `SkillListData`/`PageMeta` + `listSkillsPage`), `src/features/skills/hooks/useSkills.ts` (add `useSkillsPage`; leave `useSkills` as-is), `src/features/skills/components/SkillRegistry.tsx` (paginated refactor), `src/features/skills/components/SkillRegistry.test.tsx` (update mocks + add pagination tests), possibly AppBar/Run-Console tests if they assert the old shape. No backend, no migration, no dependency, no `velara-api` change.

### References
- [Source: epics/epic-5-run-console-invocation-ux.md#Story 5.7] — the 4 ACs (paged `useSkills`/`listSkills`, server-side `status`/`tag` + query-key, in-story search decision, loading/empty/error + a11y). The two "decided in-story" choices are locked above.
- [Source: stories/5-6-skills-list-api-pagination.md] — the backend contract this consumes: `SkillListData{items, page}`, `PageMeta`, `page`/`per_page`/`status`/`tag` params, the intended breaking shape change (5-7 is the named consumer).
- [Source: stories/5-4-job-status-polling-and-output-display.md] — the FE pagination precedent: `api/jobs.ts` `PageMeta`/`JobListData`/`listJobs`, `useJobs(params)`, `JobsHistory` consuming `{items, page}`. **Mirror it.**
- [Source: stories/2-4-skill-registry-ui-browse-and-detail.md] — the original `SkillRegistry` + ⌘K registry-search behavior to re-confirm under pagination; `SkillRow` reuse + a11y bar.
- [Source: architecture/implementation-patterns-consistency-rules.md:75-79] — the codified pagination shape (`PageMeta`, page/per_page defaults, filtered total, 422/empty rules) + TanStack key conventions.
- Code seams (verified): `src/api/skills.ts:4-6` (`listSkills` to fix), `src/features/skills/hooks/useSkills.ts:5-10` (`useSkills` — leave; add `useSkillsPage`), `src/features/skills/components/SkillRegistry.tsx:102` (`useSkills` call) + `:109-124` (fetch-all filter to replace) + `:164-203` (filter bar/search) + `:228-251` (table/loading/empty/error), `src/features/run/hooks/useProjectSkills.ts:13` (consumer — keep array), `src/shared/components/AppBar.tsx:41` (⌘K consumer — keep array), `src/api/jobs.ts:90-119` + `src/features/run/hooks/useJob.ts:24-27` + `src/features/run/components/JobsHistory.tsx:203,248-269` (the mirror precedent), `velara-api/app/schemas/skill.py:367-375` + `app/api/v1/skills.py:87-94` (the 5-6 contract), `src/features/skills/components/SkillRegistry.test.tsx:8,90-94` (mocks to update).

### Review Findings (Code Review — 2026-06-26)

> Reviewed: uncommitted working-tree changes, **scoped to the 6-file 5.7 File List** (~794 diff lines; the working tree also carries unrelated uncommitted 5-4 WIP, excluded by user choice). Three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). All 4 ACs + the #1 regression fix (`listSkills` unwraps `.items`, keeps `Skill[]`; ⌘K + `useProjectSkills` consumers preserved) verified satisfied. Reviewer line numbers re-verified against real source.

**Patch (all FIXED & verified — gates green):**

- [x] [Review][Patch] Skill mutations don't invalidate the registry's paged cache [src/features/skills/hooks/useSkills.ts:42,52,63] — FIXED: added `qc.invalidateQueries({ queryKey: ['skills-page'] })` to all three mutation `onSuccess` handlers (`useCreateSkill`/`useUpdateSkill`/`useTransitionLifecycle`). **This was a consistency regression introduced by the 5-7 migration** — pre-5-7 the registry used `['skills']` (invalidated); after moving to `['skills-page']` the create/transition invalidations no longer covered it, leaving the registry stale ~30s. New test in `useSkills.test.tsx` asserts both keys are invalidated on create.
- [x] [Review][Patch] `listSkills` unwrap has no defensive fallback [src/api/skills.ts:40] — FIXED: `return response.data.data?.items ?? []` so a malformed/absent inner envelope can't throw into the ⌘K + Run Console consumers.
- [x] [Review][Patch] Empty-trailing-page `useEffect` decrements one page per cycle [src/features/skills/components/SkillRegistry.tsx:154-158] — FIXED: now clamps straight to the last valid page (`Math.ceil(total / metaPerPage)`) instead of stepping one page per render, avoiding N-1 wasted refetches on a multi-page shrink.
- [x] [Review][Patch] "Showing X–Y of N" indicator is dishonest when page-local filters are active [src/features/skills/components/SkillRegistry.tsx:292] — FIXED: when `pageHasFilters`, the indicator now reads "Showing {filtered} of {pageSize} on this page (page N, {total} total)" instead of falsely claiming the full server range. New test asserts the honest format.
- [x] [Review][Patch] **Inline registry search is current-page-only — misleading once the registry paginates (raised by user; the locked decision is a known bug).** [src/features/skills/components/SkillRegistry.tsx] — The story locked (2026-06-25) that inline search stays client-side because "the backend has no free-text search." **Verified against real source** (`velara-api/app/api/v1/skills.py:88-95` + `app/services/skill_service.py:341-362`): the endpoint accepts ONLY `page`/`per_page`/`status`/`tag` — no `q`/`search`/`ilike` anywhere. So a true server-side search is **impossible without a backend change** (out of this frontend-only story; adding `?q=` was the rejected scope-creep option). FIXED the *honesty* in-scope: relabelled the box placeholder → "Filter this page by name…" + `aria-label="Filter the current page"`, and added a ⌘K whole-catalog hint that appears when filtering a multi-page catalog (`pageHasFilters && total > metaPerPage`). New test covers the hint. **The real server-side-search fix is logged as a HIGH follow-up requiring backend `?q=` work — see deferred-work.md.**

**Deferred (checked — pre-existing or out of 5-7 scope):**

- [x] [Review][Defer] `internal.test.tsx` carries Story 5-4 scope [src/routes/internal.test.tsx:62-70,301-321] — beyond the legitimately-5-7 `useSkillsPage` mock, the diff adds `useJob`/`useRunStore` mocks + three `/internal/jobs` route tests, all self-labeled `// Story 5.4:`. Scope-bleed from a working tree holding both stories' WIP; not a 5-7 defect (tests pass). Will resolve naturally when 5-4 is committed/reviewed.

**Dismissed as noise (8):** `metaPage` vs local `page` desync + `metaPerPage`-from-echo bounds (self-masking — `useSkillsPage` has no `placeholderData`, so `data`→undefined during a page fetch unmounts the whole `total > 0` control block; `canNext` prevents over-range requests, so the echo never diverges from the request in practice); `data?.page.total` not `?.page?.total` (defensive-only — `listSkillsPage` returns the guaranteed-shaped `SkillListData`); `useMemo(()=>data?.items??[],[data])` "pointless" (it IS the documented lint fix stabilising the `filtered` dep); Next/Prev tests assert only the request side (correct boundary for a mocked-hook unit test — the request is the component's responsibility); `listSkillsPage` test asserting echoed `per_page:200` for a `:50` request (verbatim-passthrough test, shared fixture); error-mid-pagination strands user (pre-existing error-UX pattern; AC4 says preserve it; `retry:1` already configured); stale indicator during refetch (controls unmount during fetch — transient, self-masking).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — BMad dev-story workflow

### Debug Log References

- Initial full-suite run: **224 tests pass** (baseline confirmed; story's "~234" estimate was high — actual matches the 5-4 baseline). typecheck 0. The 5-6 break is runtime-only: typecheck passed because `listSkills` cast `response.data.data` to `Skill[]` (the wrapper object hid behind the cast).
- One new-test failure during dev (`SkillRegistry.test` cross-page indicator): the indicator originally computed `start`/`end` from the component's local `page` state, but the test mocked `page:2` only in the returned `PageMeta`. **Fix (real improvement, not a test hack):** compute the indicator + Prev/Next bounds from the **server-echoed `PageMeta`** (`data.page.page`/`per_page`/`total`), so the displayed range always matches the rows the server actually returned. Re-ran → green.
- One cross-file regression: `internal.test.tsx` (route integration test that renders the REAL `SkillRegistry`) mocks `@/features/skills/hooks/useSkills` with an enumerated factory that lacked `useSkillsPage` → 4 failures. **Fix:** added `useSkillsPage` to that mock returning the paged shape. (AppBar/RunConsole/SkillDetail/etc. mock at the hook level and don't render the registry → unaffected.)
- One lint warning: `const items = data?.items ?? []` made a new array each render, destabilizing the `filtered` `useMemo` dep. **Fix:** wrapped `items` in its own `useMemo([data])`. Re-ran → 0 errors / 0 warnings.

### Completion Notes List

- **The #1 risk (5-6 already broke the FE) is fixed.** `listSkills` now unwraps the paged envelope's `.items` (requesting `per_page:200`) and still returns `Promise<Skill[]>`, so all 3 whole-catalog consumers (`SkillRegistry` — now migrated off it, `useProjectSkills`→Run Console, `AppBar`→⌘K) keep working. `useSkills`/`useProjectSkills`/`AppBar` were NOT modified.
- **Registry now paginates server-side.** New `useSkillsPage`/`listSkillsPage` mirror the 5-4 `useJobs`/`listJobs` precedent. The registry sends `?status=` server-side (State filter); Type/Visibility/inline-search filter the current page client-side (documented limitation — locked decision). React Query key `['skills-page', {page, per_page, status}]`; changing State resets to page 1.
- **First real Prev/Next affordance in the app** (`JobsHistory` shows a total but has no controls). "Showing X–Y of N" + Prev/Next, keyboard-accessible (`<button>` + `aria-label` + `disabled` at bounds + `focus-visible`), hidden at total 0. Indicator/bounds read off the server-echoed `PageMeta` for self-consistency.
- **Empty-states distinguished** so the page-local-filter limitation is surfaced honestly: page-local filters → "No skills on this page match your filters"; State filter empty → "No skills match the selected state"; catalog empty → "No skills registered yet."
- **⌘K re-confirmed whole-catalog** via the untouched `useSkills()` path (AppBar.test green). Two search surfaces with different scopes (⌘K = whole-catalog ≤200; inline table = current page) — intended and documented.
- **Known limitation (documented in `listSkills` JSDoc):** whole-catalog consumers see at most 200 skills (backend `per_page` `le=200`). No multi-page accumulation built (out of scope; the registry is the paginated surface).
- **AC coverage:** AC1 (paged hook + Prev/Next + "Showing X–Y of N"), AC2 (server-side `?status=` + query-key + page-reset), AC3 (inline search current-page-only + ⌘K whole-catalog), AC4 (loading/empty/error preserved + a11y on controls) — all satisfied with tests.
- **Gates:** typecheck 0, lint clean (0/0), test 242 pass (+18 from 224, 0 regressions), build ✓.

### File List

**Modified (velara-web):**
- `src/api/skills.ts` — added `PageMeta`/`SkillListData`/`ListSkillsPageParams`; fixed `listSkills` to unwrap `.items` (per_page:200); added `listSkillsPage`.
- `src/features/skills/hooks/useSkills.ts` — added `useSkillsPage`; left `useSkills` unchanged.
- `src/features/skills/components/SkillRegistry.tsx` — server-side pagination refactor (consume `useSkillsPage`, server `?status=`, Prev/Next + indicator, page-reset on State change, client-side-within-page Type/Vis/search, distinguished empty-states).
- `src/features/skills/components/SkillRegistry.test.tsx` — rewrote to mock `useSkillsPage` (12 → 25 tests).
- `src/routes/internal.test.tsx` — added `useSkillsPage` to the `useSkills` mock factory (route test renders the real registry).

**Added (velara-web):**
- `src/api/skills.test.ts` — 5 tests for `listSkills` (unwrap/`per_page:200`/filter-forwarding) + `listSkillsPage` (full envelope/param passthrough).

### Change Log

| Date | Change |
|------|--------|
| 2026-06-26 | Implemented Story 5.7 (Skill Registry UI — Pagination). Fixed the 5-6-induced `listSkills` runtime break (unwrap `.items`, keep `Skill[]`); added `SkillListData`/`PageMeta`/`listSkillsPage`/`useSkillsPage` (mirror 5-4); refactored `SkillRegistry` to server-side pagination (`?status=`, Prev/Next + "Showing X–Y of N", page-reset on State change, client-side-within-page Type/Vis/search, distinguished empty-states). +18 tests (242 total, 0 regressions); typecheck 0, lint clean, build ✓. Status → review. |

---

**In-story decisions locked with user (2026-06-25):**
1. ✅ **Pagination affordance** → **Prev / Next + "Showing X–Y of N"** (rejected: Load-more, infinite scroll).
2. ✅ **Search under pagination** → **⌘K palette stays whole-catalog** (its own `useSkills()` path); **registry TABLE paginates**, inline search = **current-page-only** (documented limitation); rejected adding a backend `?q=` search (scope creep).

**Key facts locked (verified against source):**
1. ✅ **The 5-6 shape change already broke `listSkills`** — 3 consumers (`SkillRegistry`, `useProjectSkills`→Run Console, AppBar ⌘K) currently receive `{items,page}` cast as `Skill[]`. Fix `listSkills` to unwrap `.items` (per_page:200) so `useSkills()` keeps returning `Skill[]`; add a NEW `useSkillsPage` for the registry. Do NOT change `useSkills`/`useProjectSkills`.
2. ✅ **Only `?status=` is a real server filter** (+ `?tag=`, no UI). Type/Visibility/search → client-side within the current page (documented). State → server-side, resets to page 1.
3. ✅ **Mirror the 5-4 FE precedent** (`PageMeta`/`SkillListData`/`listSkillsPage`/`useSkillsPage`); `JobsHistory` has no page controls, so 5-7 adds the first Prev/Next.
