---
baseline_commit: 910c5dc14cb378bd4220cfc315dd95f21a99392e
---

# Story 9.5: Usage & Value Analytics UI (Overview + By User)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want a Usage & Value screen with an Overview tab and a By-User tab,
so that I can see platform-wide adoption and value, and analyze metrics for an individual user.

> **FE-ONLY.** This story builds the internal-portal "Usage & Value" screen that consumes the **SHIPPED + DONE** Story 9.4 analytics API (`GET /api/v1/analytics/{overview, users, users/{user_id}}`). No backend work. The screen is mocked in `design/internal2.jsx` → `Analytics()` (Overview + By-User tabs), styled to the V3 brand. Several mock elements are **static prose the 9.4 API deliberately does not supply** — those are reconciled in the ACs below (see AC7 + Dev Notes → "Mock-vs-API reconciliation").

## Acceptance Criteria

1. **Overview tab (default).** Given I navigate to the Usage & Value tab, when the page loads, then the **Overview** tab shows aggregate metrics from `GET /api/v1/analytics/overview`: `total_invocations`, `success_rate`, a **12-week weekly usage bar chart** (from `series: [{week_start, count}]`), a **Most-used skills** list (from `top_skills: [{skill_id, name, runs}]`), and a **value summary** — `hours_saved`, `value_cost_avoided` ($), and `token_cost` ($ LLM spend). Loading shows a skeleton; error shows a retryable error message (mirror the audit screen's loading/error handling).

2. **By-User tab.** Given I switch to the **By User** tab, when the tab opens, then I can select an individual user (from `GET /api/v1/analytics/users`) and see their metrics from `GET /api/v1/analytics/users/{user_id}`: `invocations`, `success_rate`, `skills_used`, `avg_runtime_ms`, `trend_pct`, `hours_saved`, `top_skills`, a **12-week `weekly` activity bar chart**, and a **`recent_activity`** feed (last ≤7 audit entries — `{created_at, event_type, skill_name, outcome}`).

3. **User switch re-renders without page reload.** Given I change the selected user, when the selection updates, then the By-User panel re-renders with that user's metrics via a new `/analytics/users/{user_id}` query (react-query keyed by `user_id`) — no full page reload; the user list is fetched once.

4. **Own nav tab.** Given the internal nav strip, when it renders, then "Usage & Value" appears as its own tab (per UX-DR-02 / UX-DR-13) — distinct from the Audit Log tab. **The tab + a `RequireGrantor`-guarded route already exist** (`navTabsData.ts:20`, `internal.tsx:112-115`) — this story **replaces the placeholder** with the real screen and (decision below) may rename the tab label to "Usage & Value".

5. **Client + consultant cannot see it.** Given I am a **client-scoped** user, when the client portal renders, then the Usage & Value tab is not present (the client shell has no internal nav strip). Given I am a **consultant**, when the internal portal renders, then the tab is filtered out (`grantorOnly` + `RequireGrantor`) and a direct deep-link redirects to `/internal/engagements` — analytics is an **admin/ma_tech-only oversight surface** (the 2026-07-02 consultant-exclusion; the API also 404s them via `RejectNonGrantor`).

6. **Charts are hand-rolled (no chart library).** Given the usage time-series and per-user weekly charts render, when they draw, then they are built with **plain divs + inline height/width** (there is NO chart library in the project and none is to be added) — vertical bars: `height = count / max(counts) * H`, last bucket in a darker accent, x-axis labels from `week_start`; horizontal bars (skills): `width = runs / max(runs) * 100%`. Empty/zero series render gracefully (no divide-by-zero).

7. **Mock-vs-API reconciliation (only render what the API supplies).** Given the mock (`internal2.jsx`) contains static demo figures the 9.4 API does **not** return, when the real screen is built, then those are **omitted or clearly static**, specifically:
   - **OMIT the entire "By surface" card** (per-user `surfaces[]` was descoped in 9.4 — no data) and collapse the By-User metrics grid from 3 columns to 2.
   - **Renewal value snapshot:** render only `value_cost_avoided` ($) from the API; the mock's `6.2× proposal velocity`, `2,165 governed invocations`, `11 reusable IP assets` are **not** API-supplied → drop them (or keep the card minimal with just the real cost-avoided figure + hours-saved). The "Generate renewal report" button is **non-functional** in this story (omit, or render disabled — no report endpoint exists).
   - **Overview KPI tiles:** the mock's `+18% vs prior period`, `active projects / across 3 clients`, `avg platform overhead 1.4s / p95` are **not** in the API → omit those tiles/subtexts. Keep tiles backed by real fields: total invocations, success rate, hours saved, token cost.
   - **Null-safety:** handle every nullable API field — `top_skills[].name`/`skill_id` (deleted skill → show a fallback label), `avg_runtime_ms` (null → "—"), `trend_pct` (null → "—"; **can be negative** → show sign + color), `recent_activity[].skill_name`/`outcome` (null for admin/fan-out events → fallback label, no outcome badge).

8. **No emoji; V3 tokens.** Given any icon or glyph, when rendered, then it uses the shared `<Icon name="…">` component (no emoji — hard rule); and all colors/typography map the mock's `var(--green-*)`/V3 tokens to the real Tailwind v4 `@theme` tokens (`brand-*`, `ink`, `muted`, `surface-sunk`, `font-serif` Poppins, etc.).

## Tasks / Subtasks

- [ ] **Task 1 — API client + types: `src/api/analytics.ts` (AC: #1, #2, #3)**
  - [ ] NEW file. Mirror `src/api/audit.ts` exactly: use the shared `apiClient` from `@/api/client`, unwrap `response.data.data`. Three functions:
    ```ts
    export async function getOverview(): Promise<AnalyticsOverview> {
      const res = await apiClient.get<{ data: AnalyticsOverview }>('/api/v1/analytics/overview')
      return res.data.data
    }
    export async function listAnalyticsUsers(): Promise<AnalyticsUserSummary[]> {
      const res = await apiClient.get<{ data: AnalyticsUsersData }>('/api/v1/analytics/users')
      return res.data.data.users
    }
    export async function getUserDetail(userId: string): Promise<AnalyticsUserDetail> {
      const res = await apiClient.get<{ data: AnalyticsUserDetail }>(`/api/v1/analytics/users/${encodeURIComponent(userId)}`)
      return res.data.data
    }
    ```
  - [ ] ⚠️ **Overview path is `/api/v1/analytics/overview`, NOT bare `/api/v1/analytics`** (the latter 404s). Verified against the shipped route.
  - [ ] Define the TS interfaces to match the shipped wire contract EXACTLY (see Dev Notes → "The exact 9.4 wire contract"). Mark the nullable fields `| null`:
    - `WeeklyBucket { week_start: string; count: number }` (`week_start` is an ISO **date** string `"2026-04-14"`, not datetime).
    - `SkillRun { skill_id: string | null; name: string | null; runs: number }`.
    - `AnalyticsOverview { total_invocations: number; success_rate: number; series: WeeklyBucket[]; top_skills: SkillRun[]; hours_saved: number; value_cost_avoided: number; token_cost: number; minutes_saved_per_run: number }`.
    - `AnalyticsUserSummary { user_id: string; name: string; invocations: number; success_rate: number; skills_used: number }`; `AnalyticsUsersData { users: AnalyticsUserSummary[] }`.
    - `ActivityRow { id: string; created_at: string; event_type: string; skill_name: string | null; outcome: string | null }`.
    - `AnalyticsUserDetail { user_id: string; name: string; invocations: number; success_rate: number; skills_used: number; avg_runtime_ms: number | null; trend_pct: number | null; hours_saved: number; top_skills: SkillRun[]; weekly: WeeklyBucket[]; recent_activity: ActivityRow[] }`.
  - [ ] `success_rate` is a **percent 0–100** (already scaled server-side — do NOT ×100). Dollar fields are **unrounded floats** — format FE-side (see the formatting helpers task).

- [ ] **Task 2 — Hooks: `src/features/analytics/hooks/useAnalytics.ts` (AC: #1, #2, #3)**
  - [ ] Mirror `src/features/audit/hooks/useAudit.ts` (react-query `useQuery`, `staleTime: 30_000` — or 60_000 like `useUsers`; pick and note):
    - `useOverview()` → `useQuery({ queryKey: ['analytics-overview'], queryFn: getOverview, staleTime })`.
    - `useAnalyticsUsers()` → `useQuery({ queryKey: ['analytics-users'], queryFn: listAnalyticsUsers, staleTime })`.
    - `useUserDetail(userId: string | null)` → `useQuery({ queryKey: ['analytics-user', userId], queryFn: () => getUserDetail(userId!), enabled: !!userId, staleTime })` — the `enabled: !!userId` gate is the AC3 pattern (mirror `useAuditChildren`'s `enabled: !!parentJobId`) so no fetch fires before a user is selected.

- [ ] **Task 3 — Formatting helpers (AC: #1, #2, #7)**
  - [ ] Small module-local helpers (or reuse existing in `@/shared/utils` if present — grep first): `fmtNum(n)` = thousands separators (`Intl.NumberFormat`); `fmtUsd(n)` = `$` + compact/thousands (the mock shows `$412K` — use `Intl.NumberFormat(undefined, {notation:'compact', style:'currency', currency:'USD'})` for the big value figure; token_cost is small so show `$X.XX`); `fmtPct(n)` = `n.toFixed(1) + '%'`; `fmtMs(ms)` = `ms>=1000 ? (ms/1000).toFixed(1)+'s' : ms+'ms'` (copy from the mock's `fmtMs`, `shared.jsx:109`); `fmtTrend(pct)` = signed `+X.X%`/`-X.X%` with null→"—". Reuse the audit screen's `formatTs`/timestamp helper for `recent_activity` + `week_start` labels (grep `AuditLog.tsx` for its `Intl.DateTimeFormat` usage).

- [ ] **Task 4 — Screen shell + tabs: `src/features/analytics/components/AnalyticsScreen.tsx` (AC: #1, #2, #4, #6, #8)**
  - [ ] NEW. `usePageTitle('Usage & Value')` first line (import from `@/shared/hooks/useDocumentTitle`).
  - [ ] **Tab switcher is GREENFIELD** (no in-page tab pattern exists in the app). Build with `const [tab, setTab] = useState<'overview' | 'user'>('overview')` + two `<button>`s. Style the active/inactive pills on the **audit event-kind pill** precedent (`AuditLog.tsx:299-312`): active = `border-brand-800 bg-brand-800 text-white`, inactive = `border-line-2 bg-surface text-ink-2 hover:text-ink`; each button has a leading `<Icon name="chart"|"user" size={13}/>` (Overview / By User). Header title text "Usage & Value" (`text-[22px] font-semibold text-ink` per `AuditLog.tsx:288`).
  - [ ] Keep the outer `<div className="p-6">` from the route (or add page padding here — match audit). Render `<OverviewTab/>` or `<ByUserTab/>` by `tab`.
  - [ ] **No emoji** anywhere; every glyph via `<Icon>`. All the icons the mock uses (`chart`, `user`, `clock`, `bolt`, `layers`, `sparkle`, `doc2`, `play`, `x`, `check`, `download`) already exist in `Icon.tsx` — none need adding.

- [ ] **Task 5 — Overview tab: `OverviewTab.tsx` (AC: #1, #6, #7, #8)**
  - [ ] `useOverview()`. Loading → skeleton (mirror `AuditLog.tsx` `SkeletonRows` `animate-pulse`); error → `getErrorMessage(error)` from `@/shared/utils/errors`.
  - [ ] **KPI tiles (reconciled — AC7):** render ONLY API-backed tiles — Total invocations (`total_invocations`, `fmtNum`), Success rate (`success_rate`, `fmtPct`), Hours saved (`hours_saved`, `fmtNum`+"h", subtext `"modeled at {minutes_saved_per_run} min / run"` — this IS API-supplied), Token cost (`token_cost`, `fmtUsd`). **Drop** the mock's "+18% vs prior", "Active projects / across 3 clients", "Avg platform overhead 1.4s". Tile visual: mirror the mock `StatMini` (card, `.k` label with leading Icon, `.v` big `font-serif` value, `.delta` subtext) → Tailwind (`bg-surface border border-line rounded-lg p-4`, value `font-serif text-[34px]`, first tile accent = `border-brand-100 bg-gradient` optional).
  - [ ] **Usage time-series bar chart (AC6):** container `flex items-end gap-2 h-40` (160px); per bucket a column (`flex-1 flex flex-col items-center gap-1.5`) with a bar div `style={{ height: max ? (b.count / max) * 140 : 0 }}` (px number), `w-full max-w-[30px] rounded-t-[5px]`, color = **last bucket** `bg-brand-700` else `bg-brand-300` (`i === series.length - 1`), and an x-label `<span className="text-[9.5px] text-faint">` = the day-of-month from `week_start` (parse the ISO date; the mock shows just the day number). `const max = Math.max(1, ...series.map(b => b.count))` to avoid /0. The API ALWAYS returns exactly 12 buckets.
  - [ ] **Most-used skills (AC6/#7):** map `top_skills` → ranked rows (rank `{i+1}` mono, name `font-semibold` with **null fallback** `name ?? '(deleted skill)'`, a horizontal bar track+fill `width: runs / maxRuns * 100%`, run count mono). `const maxRuns = Math.max(1, ...top_skills.map(s => s.runs))`. Horizontal bar = a track `<div className="h-[7px] rounded-full bg-surface-sunk overflow-hidden">` + fill `<div className="h-full bg-brand-600" style={{ width: pct+'%' }}/>`.
  - [ ] **Value summary card (AC1/#7):** the green-tinted "Renewal value snapshot" card, but reconciled — show `value_cost_avoided` (`fmtUsd`, big `font-serif text-brand-700`, label "est. delivery cost avoided") + `hours_saved` + `token_cost`. **Drop** `6.2×`/`2,165`/`11` (not API-supplied). The "Generate renewal report" button: omit or render `disabled` (no endpoint).

- [ ] **Task 6 — By-User tab: `ByUserTab.tsx` (AC: #2, #3, #6, #7, #8)**
  - [ ] `useAnalyticsUsers()` for the selector; `const [selUser, setSelUser] = useState<string | null>(null)`; default to the first user once loaded (`useEffect` set to `users[0]?.user_id` when `selUser == null && users.length`). `useUserDetail(selUser)`.
  - [ ] **User selector chips:** `flex gap-2 flex-wrap`; each `<button onClick={() => setSelUser(u.user_id)}>` styled selected = `bg-brand-800 text-white border-brand-800`, unselected = `bg-surface text-ink-2 border-line-2`; label = `u.name` (already resolved server-side; NO avatar unless a shared Avatar exists — grep; the mock uses `Avatar` but skip if not present in velara-web).
  - [ ] **User header card:** name (`font-bold text-lg`) + 3 big `font-serif text-[24px] text-brand-700` stats: `invocations` (fmtNum), `success_rate` (fmtPct), `hours_saved` (fmtNum + "h", label "hours modeled saved").
  - [ ] **Metrics grid — 2 columns (NOT 3; AC7):** Weekly activity + Skills used. **OMIT the "By surface" card entirely.**
    - **Weekly activity chart:** same div-bar technique as Overview but smaller (`h-24`/96px container, bar `height = v / maxWeekly * 82`, `rounded-t-[3px]`, last bucket `bg-brand-700` else `bg-brand-300`; x-labels only every 4th bucket). Header shows `trend_pct` via `fmtTrend` (**null → "—"; negative → red/`text-danger`, positive → `text-brand-600`**) + "vs prior". Footer `~{Math.round(invocations/12)}/wk avg · {fmtMs(avg_runtime_ms)} runtime` (avg_runtime_ms null → "—").
    - **Skills used card:** chip `{skills_used} distinct`; map `top_skills` rows (name + null fallback + horizontal bar `runs/maxRuns*100%` + run count).
  - [ ] **Recent activity feed (AC2/#7):** map `recent_activity` (≤7 rows). Each row: a 30×30 `rounded-[7px] bg-surface-sunk` icon tile with an `<Icon>` chosen by event — **success** `outcome==='success'` → `play` tinted `text-brand-600`; **failure** → `x` tinted `text-danger`; admin events (`event_type` starts `admin.`) → map (`admin.certification`→`cert`, `admin.grant_*`→`shield`, `admin.lifecycle_transition`→`layers`, else `dots`); label = `skill_name ?? <humanized event_type>`; detail line = a short `{event_type} · {outcome ?? ''}` (⚠️ **NO surface** — the mock's `"Web · 8.4s · success"` used descoped `surface`/`ms`; the ActivityRow has neither → show `{outcome}` / event only); right-aligned timestamp via the audit `formatTs`. Empty → "No recent activity."
  - [ ] Loading/error same as Overview. While `selUser` is set but detail is loading, show a skeleton in the panel (don't blank the whole tab).

- [ ] **Task 7 — Wire the route (AC: #4)**
  - [ ] In `src/routes/internal.tsx:112-115`, **replace** the analytics placeholder body:
    ```tsx
    <Route path="analytics/*" element={<RequireGrantor><div className="p-6"><AnalyticsScreen /></div></RequireGrantor>} />
    ```
    (mirror the audit line `:116-119`). Import `AnalyticsScreen` near `:18` alongside the `AuditLog` import. **Do NOT** add a new `<Route>` or a new guard — the guarded placeholder already exists.
  - [ ] **Decision (rename the nav label):** `navTabsData.ts:20` currently labels the tab `'Analytics'` but the design/PRD name is **"Usage & Value"** (UX-DR-02/13; mock TopBar title "Usage & Value"). **Rename `label: 'Analytics'` → `label: 'Usage & Value'`** (keep `id:'analytics'`, `path:'analytics'`, `grantorOnly:true` unchanged — id/path are the route contract). Update any test asserting the old label. Note the change in Completion Notes.

- [ ] **Task 8 — Tests: `src/features/analytics/**/*.test.tsx` + `src/api/analytics.test.ts` (AC: #1–#7)**
  - [ ] Mirror `AuditLog.test.tsx`: `vi.mock('@/features/analytics/hooks/useAnalytics', ...)`, `mockReturnValue({ data, isLoading, error } as never)`, render inside `<QueryClientProvider client={makeQC()}><MemoryRouter initialEntries={['/internal/analytics']}>`. `beforeEach(vi.clearAllMocks + defaultMocks)`.
  - [ ] **AC1 (overview):** given a mocked overview → assert total invocations, success-rate %, the 12 bars render (query the bar container), top-skills rows with names + run counts, and the value figures ($ cost avoided, hours saved, token cost). Assert the **descoped** mock figures are ABSENT (no "+18% vs prior", no "By surface", no "6.2×").
  - [ ] **AC2/#3 (by-user):** mock `useAnalyticsUsers` (2 users) + `useUserDetail`; assert user chips render; clicking a chip calls `useUserDetail` with the new `user_id` (read `vi.mocked(useUserDetail).mock.calls.at(-1)?.[0]`); assert the panel shows the user's invocations/success/weekly/recent-activity. Assert switching users doesn't remount the whole screen (no `usePageTitle` re-assert needed — just that the detail query key changed).
  - [ ] **AC6 (charts):** with a `series` where `max=0` (all zero counts) → no crash, bars render at height 0. With a normal series → the last bucket has the accent class.
  - [ ] **AC7 (null-safety):** `top_skills` with `name: null` → fallback label; `avg_runtime_ms: null` → "—"; `trend_pct: null` → "—" and a **negative** `trend_pct` → shows `-` + danger color; `recent_activity` row with `outcome: null` + `skill_name: null` (an admin event) → renders with a fallback label and no success/fail badge.
  - [ ] **API client test** (`analytics.test.ts`): `vi.mock('@/api/client', () => ({ apiClient: { get: vi.fn() } }))`; assert `getOverview` calls `'/api/v1/analytics/overview'` and unwraps `.data.data`; `getUserDetail('u1')` calls `/api/v1/analytics/users/u1`.
  - [ ] (Optional but cheap) a nav/label test if one asserts tab labels — update it for "Usage & Value".

- [ ] **Task 9 — Gates & handoff**
  - [ ] `npm run typecheck` (tsc --noEmit) = 0 errors; `npm run lint` clean; `npm run test` (vitest) green — baseline is **440 tests / 44 files**; add the new analytics tests on top.
  - [ ] Manually sanity-check against a running API if available (the 3 endpoints are live post-9.4). Not required for the gate, but confirm the envelope unwrap + null handling on real data.
  - [ ] This is the **final Epic 9 story** — after code-review passes, epic-9 is complete (9.1–9.5 all done) → a retrospective is the natural next step.

## Dev Notes

### What this story IS (and is NOT)

**IS:** the internal-portal **Usage & Value** screen (Overview + By-User tabs) consuming the SHIPPED 9.4 analytics API. A NEW `src/features/analytics/` feature folder + `src/api/analytics.ts` + hooks, replacing the existing `analytics/*` route placeholder. Hand-rolled bar charts (no lib). Careful reconciliation of the mock's static demo data against what the API actually returns.

**IS NOT:** any backend/endpoint work (9.4 shipped it — DONE), any new nav tab or route guard (both already exist — placeholder + `RequireGrantor`), any chart library (forbidden — hand-roll with divs), the surface breakdown (descoped in 9.4 — the "By surface" card is OMITTED), or the audit screen (9.3, separate tab).

### The exact 9.4 wire contract (source-verified against the shipped API + api-spec.json)

- `GET /api/v1/analytics/overview` → `{ data: AnalyticsOverview, meta }`. **Path is `/overview`, not bare.**
- `GET /api/v1/analytics/users` → `{ data: { users: AnalyticsUserSummary[] }, meta }`. Flat list, no pagination.
- `GET /api/v1/analytics/users/{user_id}` → `{ data: AnalyticsUserDetail, meta }`. **404** `{code:"NOT_FOUND"}` when the user has no in-scope activity (only reachable via a bad/departed id — the users list only returns users WITH activity, so the happy path never 404s; still handle the error).
- Envelope: every route → `ResponseEnvelope` → unwrap `.data.data` (same as `audit.ts`).
- **Nullable fields the FE MUST handle (from the OpenAPI `anyOf: [..., null]`):**
  | Field | Null when | FE fallback |
  |---|---|---|
  | `SkillRun.name` / `.skill_id` | skill deleted (outer join) | label "(deleted skill)" |
  | `AnalyticsUserDetail.avg_runtime_ms` | no runs with both timestamps | "—" |
  | `AnalyticsUserDetail.trend_pct` | prior 12-wk window had 0 activity | "—"; **can be negative** → signed + colored |
  | `ActivityRow.skill_name` | non-skill (admin) event | humanized `event_type` |
  | `ActivityRow.outcome` | admin / fan-out-parent event | no outcome badge |
- **Units:** `success_rate` = float **0–100** (already percent, one decimal — do NOT re-scale). `hours_saved`/`value_cost_avoided`/`token_cost` = **unrounded** USD/hours floats → format FE-side. `week_start` = ISO **date** string (`"2026-04-14"`, Monday-anchored). `created_at` = ISO **datetime**. `series`/`weekly` always exactly **12** buckets. `recent_activity` ≤ 7 rows, newest-first.

### Mock-vs-API reconciliation (the critical trap — AC7)

The mock `internal2.jsx` is a **hardcoded demo** — several figures have **no API source**. Building them "as shown" would fabricate data. What to DROP:
- **"By surface" card** (per-user `surfaces[]`) — descoped in 9.4 (all invocation entrypoints share `queue_invocation`, no surface column). OMIT the card; collapse the per-user grid 3→2 columns. (See `project-epic9-analytics-api` memory for the descope rationale.)
- **Renewal snapshot extras** — `6.2× proposal velocity`, `2,165 governed invocations`, `11 reusable IP assets` are pure demo literals. Only `value_cost_avoided` ($412K in the mock) is real. Drop the other three; the "Generate renewal report" button has no endpoint → omit/disable.
- **Overview KPI extras** — `+18% vs prior period`, `Active projects / across 3 clients`, `Avg platform overhead 1.4s / p95` are demo. Keep total-invocations, success-rate, hours-saved (subtext `"{minutes_saved_per_run} min / run"` IS real), token-cost.
- **Recent-activity detail line** — the mock renders `"Web · 8.4s · success"` using descoped `surface` + a `ms` field the `ActivityRow` does NOT carry. Render only what exists: a humanized `event_type` + `outcome` (when non-null). No surface, no per-row duration.

### Scaffolding that already exists (do NOT re-create)

- **Nav tab:** `src/shared/components/navTabsData.ts:20` — `{ id:'analytics', label:'Analytics', path:'analytics', grantorOnly:true }`. This story **renames the label to "Usage & Value"** (keep id/path). `NavTabs.tsx:22-23` already filters `grantorOnly` via `isGrantor()` (consultant excluded).
- **Guarded route (placeholder):** `src/routes/internal.tsx:112-115` — `analytics/*` already wrapped in `<RequireGrantor>`. Swap the `<Placeholder>` body for `<AnalyticsScreen/>`.
- **`RequireGrantor`** (`src/shared/components/RequireGrantor.tsx`): consultant → redirect `/internal/engagements`; client → `/client/dashboard`; unauth → `/login`. `GRANTOR_ROLES = {'admin','ma_tech'}` (`src/shared/utils/auth.ts:94-100`). No change needed.

### Templates to mirror (don't reinvent — the 9.3 audit feature is the direct precedent)

- **`src/api/audit.ts`** → `src/api/analytics.ts` (shared `apiClient`, `.data.data` unwrap).
- **`src/features/audit/hooks/useAudit.ts`** → `useAnalytics.ts` (react-query, `staleTime`, `enabled: !!x` gate from `useAuditChildren` for the per-user query). `src/features/admin/hooks/useUsers.ts` is a simpler single-query template.
- **`src/features/audit/components/AuditLog.tsx`** → the screen skeleton: `usePageTitle` first line, `SkeletonRows`/`animate-pulse` loading, `getErrorMessage(error)` from `@/shared/utils/errors`, page header `text-[22px] font-semibold text-ink`, `formatTs` timestamp helper. Its event-kind **pill buttons** (`:299-312`, active `border-brand-800 bg-brand-800 text-white`) are the model for the Overview/By-User tab switcher.
- **`AuditLog.test.tsx`** + `src/api/audit.test.ts` → the test patterns (mock the hook module, `mockReturnValue(... as never)`, `MemoryRouter` + `QueryClientProvider`, assert hook call args via `mock.calls.at(-1)`).

### Charts — hand-rolled, NO library (AC6)

There is NO chart lib in `package.json` (no recharts/chart.js/d3/visx/nivo) and none is to be added. The mock draws every chart with plain divs + inline styles:
- **Vertical bars (usage series / weekly):** flex row `items-end`, each column `flex-1`, bar `height = (count / max) * H` px (Overview H=140 in a 160px box; per-user H=82 in a 96px box), `rounded-t-[5px]`/`[3px]`, last bucket `bg-brand-700` else `bg-brand-300`. **Guard `max = Math.max(1, ...counts)`** to avoid /0 on an all-zero series.
- **Horizontal bars (skills):** a track `<div className="h-[7px] rounded-full bg-surface-sunk overflow-hidden">` + fill `<div className="h-full bg-brand-600" style={{ width: pct+'%' }}/>`, `pct = runs / maxRuns * 100`.
- Inline numeric `height`/`width` (React appends px / use `+'%'` for width) — matches the audit skeleton's inline-style approach.

### V3 token mapping (mock `var(--green-*)` → real Tailwind v4 `@theme`)

Tailwind v4, `@theme` in `src/index.css` (NO `tailwind.config.js`). The V3 rebrand **replaced** the mock's `--green-*` with `brand-*`:
- `--green-700` → `brand-700`, `--green-800` → `brand-800`, `--green-600` → `brand-600`, `--green-500` → `brand-500`, `--green-300` → `brand-300`, `--green-100` → `brand-100`, `--green-50` → `brand-50`.
- `--ink`→`ink`, `--ink-2`→`ink-2`, `--muted`→`muted`, `--faint`→`faint`, `--surface`→`surface`, `--surface-sunk`→`surface-sunk`, `--line`→`line`, `--line-2`→`line-2`, `--danger`→`danger`. `--serif` (Poppins) → `font-serif`; `--mono` → `font-mono`.
- Big stat numbers + headings use `font-serif` (Poppins). Bars/cards use `rounded-lg` cards, `bg-surface border border-line`.

### Icons (all exist — AC8; no emoji)

`Icon.tsx` already has every icon the mock uses: `chart` (tab/bar), `user`, `clock`, `bolt`, `layers`, `sparkle`, `doc2`, `play`, `check`, `x`, `download`, `cert`, `shield`, `flag`, `upload`, `dots`. Use `<Icon name="…" size={…}/>`. Recent-activity event→icon map: success→`play`, failure→`x`, `admin.certification`→`cert`, `admin.grant_*`→`shield`, `admin.lifecycle_transition`→`layers`, fallback→`dots`. **Never** an emoji.

### Project Structure Notes

- NEW feature folder `src/features/analytics/{components,hooks}/` + `src/api/analytics.ts` — mirrors `src/features/audit/`. Fully aligned, no structural variance.
- Only EDITS to existing files: `src/routes/internal.tsx` (swap placeholder body + import) and `src/shared/components/navTabsData.ts` (rename label). No new deps, no new routes/guards.
- Preserve title isolation: `usePageTitle('Usage & Value')` — this is the INTERNAL portal (internal labels fine; the client title-isolation discipline is about the CLIENT portal only, and this screen never renders there).

### Testing standards

- vitest ^2 + @testing-library/react + user-event; jsdom. Gate: `npm run typecheck` (tsc --noEmit, 0 errors), `npm run lint` (eslint), `npm run test` (vitest run). Baseline **440 tests / 44 files** — add analytics tests on top; keep all green.
- Mock hooks per-test (don't hit the network); wrap in `QueryClientProvider` (`retry:false`) + `MemoryRouter`.

### References

- [Source: epics/epic-9-audit-log-usage-analytics.md#Story 9.5] — the 4 epic ACs (Overview tab, By-User tab, user-switch re-render, own nav tab, client-hidden). Reconciled here with the surface descope + mock-vs-API static-data trimming.
- [Source: velara-api/app/api/v1/analytics.py + app/schemas/analytics.py + docs/api-spec.json] — the SHIPPED wire contract this screen consumes: 3 routes (`/overview`, `/users`, `/users/{user_id}`), `ResponseEnvelope`, every field + type + the 6 nullable fields. `success_rate` 0–100; `week_start` date; 12 buckets.
- [Source: design/internal2.jsx `Analytics()` (~L170-505) + design/data.js:227-262 + design/styles_v3.css] — the mock: tab switcher (`.roleswitch`), 4 KPI `StatMini` tiles, "Invocations over time" vertical bars (`height:(v/maxBar*140)`), "By project"/"Most-used skills" horizontal bars, "Renewal value snapshot" 2×2, By-User selector + header + weekly bars + skills + **"By surface" (DESCOPE)** + recent activity feed. Title "Usage & Value". V3 `var(--green-*)` tokens.
- [Source: velara-web/src/api/audit.ts + src/features/audit/hooks/useAudit.ts + src/features/audit/components/AuditLog.tsx (+ .test.tsx)] — the 9.3 audit feature: the direct template for the api client, hooks (`enabled` gate), screen skeleton (usePageTitle/loading/error/header/pill-buttons), and tests.
- [Source: velara-web/src/routes/internal.tsx:112-119] — the existing `RequireGrantor`-guarded `analytics/*` placeholder to REPLACE (mirror the `audit/*` line).
- [Source: velara-web/src/shared/components/navTabsData.ts:20 + NavTabs.tsx:22-23] — the `{id:'analytics', grantorOnly:true}` tab (rename label to "Usage & Value") + the `isGrantor()` filter.
- [Source: velara-web/src/shared/components/RequireGrantor.tsx + src/shared/utils/auth.ts:94-100] — the consultant/client guard (`GRANTOR_ROLES={admin,ma_tech}`, consultant→`/internal/engagements`). No change.
- [Source: velara-web/src/shared/components/Icon.tsx] — `<Icon name=…>` + the full ICONS map (all needed icons exist). No-emoji rule.
- [Source: velara-web/src/index.css @theme] — Tailwind v4 tokens (`brand-*`, `ink`, `muted`, `surface-sunk`, `font-serif`, `danger`); the `--green-*`→`brand-*` mapping.
- [Source: story 9-4-usage-and-value-analytics-api.md] — the shipped backend this consumes; the 3 product decisions (surfaces descoped, value config-driven, token-cost built) that shape what the API supplies vs the mock.
- Memory: `project-epic9-analytics-api` (⭐ overview at `/overview`, surfaces descoped → OMIT By-surface card, value config-driven, token-cost real; the mock's static value-stats NOT API-supplied), `project-epic9-ui-design-ref` (internal2.jsx + V3 is the design source of truth for 9.5), `project-epic9-audit-ui` (Tailwind v4 @theme, the 9.3 feature-folder pattern this mirrors), `project-consultant-oversight-exclusion` (grantorOnly + RequireGrantor), `project-no-emoji-icons` (hard Icon rule).
- Predecessor: 9.3 (Audit Log UI, DONE) — same feature-folder + react-query + Tailwind-v4 patterns. This is the FINAL Epic 9 story → epic complete after review → retrospective.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
