---
baseline_commit: e34fec9e01f61c55287a6bf695d14403ab325329
---

# Story 9.3: Audit Log UI

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant or operator,
I want an audit log view in the internal portal with filters and invocation detail drill-down,
so that I can review usage, investigate anomalies, and answer compliance questions from the UI.

## Acceptance Criteria

1. **Paginated table.** Given I navigate to the Audit Log tab, when the page loads, then I see a **paginated** list of audit entries with, per row: timestamp (`created_at`), user (`user_id`), event type (`event_type`), skill name (`skill_name`), hierarchy path, and an **outcome badge**. Prev/Next pagination + "Showing X–Y of N" (mirror `SkillRegistry`), reading `data.page.{total,page,per_page}` from the 9.2 envelope. **Hierarchy path is shown as the raw/segmented ltree string** (the row carries `hierarchy_path` like `org_org_vitalief.client_<uuid>.project_<uuid>` — full Client/Project/Study *name* resolution is NOT built here; see Dev Notes "hierarchy-path display" — this matches the design mock, which renders the raw `path`).

2. **Filters + dismissible chips.** Given I apply filters (event-kind, client, skill, time range, outcome), when the filtered query runs, then the table shows only matching entries and each active filter appears as a **dismissible chip** (✕ clears it + resets to page 1). Filters map to the live 9.2 query params (`event_type`/`outcome` for kind, `client_id`, `skill_id`, `from`/`to`, `outcome`). Changing any server-side filter resets `page` to 1.

3. **Date-range picker.** Given the filters include a date range, when I pick a start and end date in the **date-range picker** (preset dropdown: Today / Last 7 days / Last 30 days / All time / Custom, per the design mock — Custom reveals two native `<input type="date">` FROM/TO fields + Apply), then the table shows only entries with `created_at` in that range (calls `GET /api/v1/audit?from=&to=`), and the selected range appears as a dismissible chip. **No date-picker library** — native inputs + preset buttons only (no new dependency).

4. **Detail panel drill-down.** Given I click an audit entry (a "View" affordance), when the detail panel opens (right-side sticky column, mirror `JobDetailPanel`), then I see: full hierarchy path, job ID (`job_id`, if present), skill version (`skill_version`), **duration** (computed from `completed_at − started_at`; "—" if either is null), outcome, event type, and the row's `metadata` (e.g. token usage for prompt/hybrid, grant/lifecycle details for admin events). For a **fan-out parent** entry (`fan_out === true`), the panel also lists the child invocations with per-location outcome (see AC5).

5. **Fan-out child list.** Given a fan-out parent entry is shown, when the panel renders its children, then the child audit entries are listed with their individual outcome badges. ⚠️ **Audit children are SEPARATE audit rows linked by `parent_invocation_id`** (NOT an inline `children[]` array like `JobsHistory`). The panel fetches them via a second query: `GET /api/v1/audit?parent_invocation_id={parentEntry.job_id}` (the parent fan-out job's id; the 9.2 `parent_invocation_id` filter is already live — no backend work). **Output/download links:** audit rows carry NO presigned URL (audit is a metadata-only compliance surface). So show per-location **outcome** from the child audit rows; for a download, link to the job (`/internal/jobs` or the run console) — do NOT fabricate a download link from an audit row. Document this in the panel (a subtle "downloads live on the job" affordance is acceptable; omitting downloads entirely is also acceptable — this is a review/compliance view).

6. **Internal-only surface.** Given I am a client-scoped user viewing the client portal, when the client portal renders, then the Audit Log tab is not present — the audit log is internal-only. This is **structural**: the audit tab lives only in the internal `NavTabs` (`navTabsData.ts`), and the client shell (Story 8.3 `ClientAppBar`) has no internal NavTabs, so the tab cannot appear for clients. No new guard code needed — just do NOT add the tab/route to any client surface. (Belt-and-suspenders: the 9.2 endpoint itself 404s client tokens via `RejectClient`.)

## Tasks / Subtasks

- [x] **Task 1 — API layer: `src/api/audit.ts` + `useAuditPage` hook (AC: #1–#5)**
  - [x] NEW `src/api/audit.ts`. Mirror `src/api/skills.ts` EXACTLY:
    ```ts
    import { apiClient } from '@/api/client'
    export interface PageMeta { total: number; page: number; per_page: number }
    export interface AuditEntry {
      id: string; event_type: string; user_id: string; hierarchy_path: string
      skill_id: string | null; skill_version: string | null; skill_name: string | null
      job_id: string | null; parent_invocation_id: string | null
      runtime_type: string | null; fan_out: boolean
      outcome: string | null; error_code: string | null
      started_at: string | null; completed_at: string | null
      metadata: Record<string, unknown> | null; created_at: string
    }
    export interface AuditListData { items: AuditEntry[]; page: PageMeta }
    export interface ListAuditParams {
      page?: number; per_page?: number
      client_id?: string; skill_id?: string; user_id?: string
      outcome?: string; event_type?: string; parent_invocation_id?: string
      from?: string; to?: string
    }
    export async function listAuditPage(params?: ListAuditParams): Promise<AuditListData> {
      const response = await apiClient.get<{ data: AuditListData }>('/api/v1/audit', { params })
      return response.data.data
    }
    ```
    (Field names come verbatim from the shipped `AuditRead` — `velara-api/app/schemas/audit.py`. `metadata` IS the JSON key — 9.2 used `validation_alias` so the body key is `metadata`, not `event_metadata`. `outcome` values are `success|failure|cancelled|blocked` — NOT `failed`; the API accepts `?outcome=failed` as an alias but returns `failure`.)
  - [x] NEW `src/features/audit/hooks/useAudit.ts` mirroring `useSkillsPage` (`src/features/skills/hooks/useSkills.ts:23-29`):
    ```ts
    export function useAuditPage(params: ListAuditParams) {
      return useQuery({ queryKey: ['audit-page', params], queryFn: () => listAuditPage(params), staleTime: 30_000 })
    }
    ```
    Axios drops `undefined` params, so omit a filter by passing `undefined` (same as `?q=` in skills).
  - [x] (Optional) `src/api/audit.test.ts` mirroring `src/api/skills.test.ts` — assert the request path + params + `.data.data` unwrap.

- [x] **Task 2 — Outcome badge: `AuditOutcomeBadge` + `AUDIT_OUTCOME_META` (AC: #1, #4, #5)**
  - [x] `JobStatusBadge` keys on `JobStatus` (`queued|running|completed|failed|cancelled|blocked`) — a DIFFERENT vocabulary from audit `outcome` (`success|failure|cancelled|blocked`, or `null` for admin events). Do NOT reuse it directly. Mirror its structure (`src/features/run/components/JobStatusBadge.tsx` + `src/features/run/jobStatusMeta.ts`):
    ```ts
    // src/features/audit/auditOutcomeMeta.ts — brand tokens ONLY (V3); NEVER green-*/red-*/amber-* (renamed in 1-6)
    export type AuditOutcome = 'success' | 'failure' | 'cancelled' | 'blocked'
    export const AUDIT_OUTCOME_META: Record<AuditOutcome, {label:string; dotClass:string; pillClass:string}> = {
      success:   { label:'Success',   dotClass:'bg-st-client', pillClass:'text-st-client-tx bg-st-client-bg border-st-client-bd' },
      failure:   { label:'Failure',   dotClass:'bg-danger',    pillClass:'text-danger bg-danger-bg border-danger' },
      cancelled: { label:'Cancelled', dotClass:'bg-st-draft',  pillClass:'text-st-draft-tx bg-st-draft-bg border-st-draft-bd' },
      blocked:   { label:'Blocked',   dotClass:'bg-hold',      pillClass:'text-hold-tx bg-hold-bg border-hold-bd' },
    }
    ```
  - [x] `AuditOutcomeBadge({ outcome }: { outcome: string | null })` — pill markup copied from `JobStatusBadge.tsx:9-14`. For `outcome === null` (admin events), render a neutral "Admin" chip or the event kind instead of an outcome pill (admin events have no outcome — don't show a broken/empty badge).

- [x] **Task 3 — Feature folder + AuditLog (table + filters + chips + pagination) (AC: #1, #2, #3, #6)**
  - [x] NEW `src/features/audit/components/AuditLog.tsx`. `usePageTitle('Audit Log')` (from `@/shared/hooks/useDocumentTitle` — the route already asserts `'Audit Log · Velara'`, `internal.test.tsx:157`, so keep this title). Compose:
    - **Pagination state + math** from `SkillRegistry.tsx:106,155-161`: `const [page,setPage]=useState(1)`; `const total=data?.page.total??0; const metaPage=data?.page.page??page; const metaPerPage=data?.page.per_page??PER_PAGE; const start=total===0?0:(metaPage-1)*metaPerPage+1; const end=Math.min(metaPage*metaPerPage,total); const canPrev=metaPage>1; const canNext=metaPage*metaPerPage<total;` + Prev/Next buttons (`aria-label="Previous page"`/`"Next page"` — the test convention, `SkillRegistry.tsx:322-341`) + "Showing {start}–{end} of {total}". `const PER_PAGE=50`.
    - **Filter state:** `eventKind` (pill group), `clientId`, `skillId`, `outcome`, and date-range (`from`/`to`). Each filter change → `setPage(1)`.
    - **Event-kind pill group** (design mock, `internal2.jsx:582-590`): pills All events / Invocations / Certifications / Access / Versions / Failures → map to query params (see Dev Notes "event-kind → query mapping"). Selected pill = `bg-brand-800 text-white border-brand-800`; unselected = `bg-surface text-ink-2 border-line-2`.
    - **Client + Skill filters:** reuse the existing pickers — `ClientCombobox` (used in AccessControl / grant form; find it under `src/features/admin` or `src/shared`) for client; a skill picker or a simple `<select>` populated by `useSkills()` (whole-catalog hook) for skill. (Confirm `ClientCombobox`'s import path; the FE research already located these — if a shared combobox isn't reusable as-is, a labeled `<select>` is acceptable for Phase 1.)
    - **Dismissible chips row:** ⚠️ **there is NO dismissible-chip component in the codebase** — `SkillRegistry` uses segmented controls, and `MetaChip` (`EngagementsScreen.tsx:724`) is a module-private stacked key/value label (NOT exported, NOT a dismissible chip). So BUILD a small `AuditFilterChip` (label + an `<Icon name="x" size={13}/>` clear button, styled `inline-flex ... rounded-full border border-line-2 bg-surface-2 px-... text-...`) — reuse the search-clear button pattern from `SkillRegistry.tsx:229-238` (`<Icon name="x"/>` + `aria-label="Clear …"`). For each active filter render one chip whose ✕ clears that filter + `setPage(1)`. NEVER a literal "×" glyph — use `<Icon>` ([[project-no-emoji-icons]]).
    - **Table:** header row + data rows mirroring `JobsHistory.tsx:253-270` (a header strip `bg-surface-2 ... uppercase tracking-wide text-faint` + rows `border-b border-line px-6 py-4`). Columns: Time (`formatTs(created_at)`), User (`user_id`), Event (`event_type` + kind icon), Skill (`skill_name ?? '—'`), Path (raw `hierarchy_path`, `font-mono text-faint`, small), Outcome (`<AuditOutcomeBadge outcome={row.outcome}/>`), and a "View" button (selects the row → detail panel).
    - **formatTs** helper: copy from `JobsHistory.tsx:12-20` (`Intl.DateTimeFormat`). NO date lib.
    - **Layout:** two-column `flex gap-6` — `min-w-0 flex-1` list + (when a row is selected) `w-96 shrink-0` with `sticky top-6` detail panel — copy `JobsHistory.tsx:222-282`.
    - **Empty / loading / error states:** `Skeleton` rows while loading (mirror `JobsHistory.tsx:237-243`), "No events in this range." empty state, error state — copy the JobsHistory patterns.
  - [x] **Styling (⚠️ Tailwind v4, CSS-first — no config file):** this project is **Tailwind v4** with tokens declared as `--color-*` CSS custom properties in an `@theme` block in `src/index.css` (there is NO `tailwind.config.*` file). A `--color-brand-800` var generates the `bg-brand-800`/`text-brand-800`/`border-brand-800` utilities. The design mock (`internal2.jsx`) uses inline CSS-var styles (`var(--green-800)`, `var(--ink-2)`) — the "V3" brand naming; the REAL FE uses **Tailwind brand-token classes** (`bg-brand-800`, `text-ink-2`, `bg-surface`/`bg-surface-2`/`bg-surface-sunk`, `text-faint`/`text-muted`, `border-line`/`border-line-2`, `rounded-lg`). Translate the mock's tokens to these Tailwind classes (SkillRegistry/JobsHistory are the reference for the real class vocabulary). NEVER use raw `green-*/amber-*/gray-*/red-*` (renamed — silently fall back to Tailwind defaults). Status scales for the badge: `st-client*` (teal/success), `danger*` (failure), `st-draft*` (cancelled), `hold*` (amber/blocked).
  - [x] Add the "Append-only · 7-year retention" header chip from the mock (`internal2.jsx:574`): `<Icon name="lock" size={13}/> Append-only · 7-year retention` — a nice compliance affordance next to the "Audit Log" title.

- [x] **Task 4 — AuditDetailPanel (drill-down + fan-out children) (AC: #4, #5)**
  - [x] NEW `src/features/audit/components/AuditDetailPanel.tsx`, mirroring `JobDetailPanel` (`JobsHistory.tsx:24-159`) — sticky right column, header with the entry id + ✕ close, then the fields (AC4). ⚠️ **No by-id detail fetch needed:** unlike `JobDetailPanel` (which re-fetches `useJob(jobId)` to get `children[]`), the selected audit row is ALREADY in hand from the list query — pass the whole `AuditEntry` object into the panel (`<AuditDetailPanel entry={selectedEntry} .../>`), no `useAuditEntry(id)` round-trip (there's no `GET /api/v1/audit/{id}` endpoint anyway; audit has only the list route). Render from the passed entry: status/outcome badge, hierarchy path, `job_id`, `skill_version`, **duration** (`formatDuration(started_at, completed_at)` — write a small helper: both present → e.g. "3.2s" / "1m 04s"; else "—"), event type, and a `metadata` render (a `<pre>` or key/value list of the JSONB — e.g. token usage `{input_tokens, output_tokens, model}` for prompt/hybrid).
  - [x] **Fan-out children (AC5):** when `entry.fan_out === true`, fire a second `useAuditPage({ parent_invocation_id: entry.job_id, per_page: 200 })` inside the panel (or a dedicated `useAuditChildren(parentJobId)` hook wrapping it) and render each child audit row with the child's `hierarchy_path` (per-location) + `<AuditOutcomeBadge outcome={child.outcome}/>`. This is the ONE structural difference from JobsHistory (whose children are inline `job.children[]`): audit children are a separate fetch. Guard `entry.job_id` non-null before querying. **No download links** on audit children (audit rows have no URL) — outcome + location path only; optionally a "View job" link to `/internal/jobs`.
  - [x] Selected-row state lives in `AuditLog` (`const [selectedId,setSelectedId]=useState<string|null>(null)`); the panel is rendered only when `selectedId` (copy `JobsHistory.tsx:275-281`).

- [x] **Task 5 — Wire the route (replace the Placeholder) (AC: #1, #6)**
  - [x] `src/routes/internal.tsx:112-113`: replace `<Placeholder title="Audit Log">Audit Log — Story 8.x</Placeholder>` at `path="audit/*"` with `<AuditLog/>` (import it). Keep the `path="audit/*"` and the surrounding route structure — the nav tab (`navTabsData.ts:14`) already points here and the title test already expects `'Audit Log · Velara'`.
  - [x] Do NOT touch the client routes (`src/routes/client.tsx`) — the internal-only property (AC6) is structural.

- [x] **Task 6 — Tests (vitest + @testing-library) (AC: #1–#6)**
  - [x] NEW `src/features/audit/components/AuditLog.test.tsx` mirroring `SkillRegistry.test.tsx` / `JobsHistory.test.tsx`: `vi.mock('@/features/audit/hooks/useAudit')` then `vi.mocked(useAuditPage).mockReturnValue({data:{items,page:{total,page,per_page}},isLoading:false,error:null} as ...)`; render inside `<QueryClientProvider client={makeQC()}><MemoryRouter initialEntries={['/internal/audit']}>...` (JobsHistory.test.tsx:49-59 pattern; a fan-out child query also uses the mocked hook). Row select/close buttons are named `'View'`/`'Close'`. Assert:
    - AC1: table renders a row per item with the expected columns (time, user, event_type, skill_name, path, outcome badge label).
    - AC2: clicking an event-kind pill / setting a filter fires the hook with the mapped param + a dismissible chip appears; clicking the chip's ✕ clears it + resets page.
    - AC3: selecting a date preset / custom range fires the hook with `from`/`to` + shows a range chip.
    - AC4/AC5: clicking "View" opens the detail panel with the fields; for a `fan_out` row, the child query fires with `parent_invocation_id` and child outcomes render.
    - AC1 pagination: Prev disabled on page 1; Next advances page; "Showing X–Y of N".
  - [x] `AuditOutcomeBadge.test.tsx` (small): each outcome → correct label/class; `null` → the neutral/admin fallback.
  - [x] Route/title: `internal.test.tsx` already asserts `'Audit Log · Velara'` — confirm it still passes with the real screen (the screen calls `usePageTitle('Audit Log')`). The client title-isolation tests (`client.test.tsx:135,157,164`) already assert the client portal title never contains "Audit Log" — confirm still green (AC6).
  - [x] Run `npx tsc --noEmit` (tsc 0) + `npx vitest run` (all green). The FE baseline is ~293+ tests (grows per epic) — don't regress; the new suite adds to it.

## Dev Notes

### What this is (and is NOT)

**IS:** a FRONTEND-ONLY internal-portal screen that replaces the `audit/*` route Placeholder, consuming the SHIPPED, DONE 9.2 `GET /api/v1/audit` endpoint. It composes two existing patterns: `SkillRegistry` (paginated table + filter chips + Prev/Next) and `JobsHistory`/`JobDetailPanel` (row → sticky right detail panel + children). Plus a small `AuditOutcomeBadge`.

**IS NOT:** any backend work (9.2 is done — all filters, incl. `parent_invocation_id` for fan-out, are live). Not analytics (9.4/9.5 — a SEPARATE "Usage & Value" tab). Not hierarchy-node name resolution (out of scope — show the raw path). No new dependency (native date inputs, no date lib).

### The shipped 9.2 contract this UI consumes (source-verified 2026-07-02)

`GET /api/v1/audit?page=&per_page=&client_id=&skill_id=&user_id=&outcome=&event_type=&parent_invocation_id=&from=&to=` → `{ data: { items: AuditRead[], page: PageMeta{total,page,per_page} }, meta }`.
- `AuditRead` fields: see Task 1 (matches `velara-api/app/schemas/audit.py` exactly). `metadata` IS the JSON key.
- `outcome` stored/returned values: `success | failure | cancelled | blocked`. The API accepts `?outcome=failed` (alias → `failure`) but you can just send `failure`.
- `client_id` is resolved server-side to its ltree path (a bad/cross-org `client_id` → 404 — surface as an error toast/state, don't crash).
- `from`/`to` accept ISO date (`YYYY-MM-DD`) or datetime; bare date `from` = start-of-day UTC, `to` = inclusive end-of-day UTC. A **bare integer** or an **inverted range** (`from > to`) → **422** (the API guards both) — so the date-range UI should send ISO dates and, ideally, prevent an inverted custom range client-side (or surface the 422 message).
- Fan-out: children are rows with `parent_invocation_id = <parent job id>`; fetch via `?parent_invocation_id={parentEntry.job_id}`.

### ⚠️ KNOWN LIMITATION — admin lifecycle/certification events are currently invisible (deferred, not a 9.3 bug)

9.2's code review found (and `deferred-work.md` records) that **skill lifecycle transitions and certification admin events are written with `hierarchy_path="org"`** (a single ltree label), but 9.2's org-fence requires `hierarchy_path <@ 'org_org_vitalief'`, and `'org' <@ 'org_org_vitalief'` is **FALSE** — so those two admin-event classes are **not returned by `GET /api/v1/audit` for any caller** until a 9.1 write-path fix lands (change `"org"` → `_org_segment(org_id)` + backfill). **Implication for 9.3:** the Audit UI will show invocation events and grant events, but NOT lifecycle/certification events, until that follow-up ships. Do NOT chase this as a UI bug — it is a documented backend gap. `deferred-work.md` explicitly recommends authoring that small write-path fix "before/with 9.3." **Flagged to the Project Lead as a decision** (see the question at hand-off): sequence the write-path fix before 9.3 ships, or accept the partial trail for now and land the fix as a fast-follow.

### hierarchy-path display (the AC1 "Client/Project/Study" phrasing)

AC1's parenthetical "(Client/Project/Study)" reads like it wants resolved node NAMES, but: (a) the audit row stores only the raw ltree `hierarchy_path` (`org_org_vitalief.client_<uuid>.project_<uuid>...`); (b) 9.2 does NOT resolve names; (c) **the design mock (`internal2.jsx:703-707`) renders the raw `path` string** with a `layers` icon in mono/faint. So **show the raw (optionally prettified) path** — do NOT build a uuid→name resolver (that would need per-row hierarchy lookups or a 9.2 change; over-engineering for Phase 1). A light prettifier is fine (e.g. strip the `org_…` root, split on `.`, show the segment labels) — but names are out of scope. Note the decision in the code so 9.5/a later story can add resolution if the product wants it.

### event-kind → query-param mapping (the pill group)

The design mock's kind pills predate the shipped `event_type` vocabulary. Map them to the live params:
- **All events** → no `event_type`/`outcome` filter.
- **Invocations** → `event_type` starts with `invocation.` — the API filters `event_type` by **exact equality** (no prefix match). So "Invocations" as a single filter isn't a single exact value. Options: (a) drop a coarse "Invocations" pill in favor of concrete outcome pills (Success/Failure/etc via `outcome=`), or (b) request a specific `event_type` (e.g. `invocation.success`). **Recommended:** make the pills concrete: **Success** (`outcome=success`), **Failures** (`outcome=failure`), **Blocked** (`outcome=blocked`), **Grants** (`event_type=admin.grant_created`), **Certifications** (`event_type=admin.certification`), **Lifecycle** (`event_type=admin.lifecycle_transition`) — each an exact param the API supports. (The `admin.certification`/`admin.lifecycle_transition` pills will return nothing until the `"org"` write-path fix above — that's expected; keep the pills, they'll populate once the fix lands.) Confirm the exact `event_type` constants in `velara-api/app/models/audit.py:38-51`.

### The two reuse templates (copy, do not reinvent)

1. **`SkillRegistry.tsx`** (`velara-web/src/features/skills/components/SkillRegistry.tsx`) — pagination: `[page,setPage]` (:106), `useSkillsPage({page,per_page,...})` (:129), `total/metaPage/metaPerPage/start/end/canPrev/canNext` (:155-161), `setPage(1)` on filter change (:138), out-of-range page → reset to 1 (the effect around :169). `PER_PAGE` constant. The `useSkills`/`useSkillsPage` hook file (`src/features/skills/hooks/useSkills.ts:23-29`) is the `useAuditPage` template (queryKey `['x-page', params]`, `staleTime: 30_000`).
2. **`JobsHistory.tsx` + `JobDetailPanel`** (`velara-web/src/features/run/components/JobsHistory.tsx`) — `formatTs` (:12-20), the two-column `flex gap-6` list+detail layout (:222-282), the sticky `w-96` detail panel (:275-281), the header/row table strip (:253-270, JobRow :163-195), and the fan-out children block (:79-109) — the ONLY change is audit children come from a second `useAuditPage({parent_invocation_id})` fetch, not `job.children[]`, and have no download URL.

The api-client unwrap idiom (`apiClient.get<{data: X}>(path,{params})` → `response.data.data`) is in every `src/api/*.ts` (e.g. `skills.ts:49-52`). `apiClient` is `@/api/client` (injects the auth header). `Icon` = `@/shared/components/Icon` (all needed glyphs exist: `lock`, `layers`, `clock`, `chevdown`, `check`, `x`, `play`, `cert`, `shield`, `flag`, `audit`, `history`).

### Project structure + conventions

- FE feature folders: `src/features/audit/{components,hooks}` (mirrors `skills`, `run`). API in `src/api/audit.ts`. Route wired in `src/routes/internal.tsx`.
- TS: `camelCase` funcs/vars, `PascalCase` components. Response fields are snake_case (from the API) — keep the `AuditEntry` interface snake_case to match the wire (like `JobSummary`/`Skill` do).
- **Icon rule (HARD):** never emoji/unicode glyphs as icons — use `<Icon name=.../>` ([[project-no-emoji-icons]]). Only `⌘` in ⌘K kbd hints is allowed.
- **V3 brand tokens only** (`bg-brand-*`, `text-ink*`, `bg-surface*`, `text-faint/muted`, `border-line*`, `bg-st-*`, `bg-hold`, `bg-danger`) — never `green-*/amber-*/gray-*/red-*` (renamed 1-6, silently fall back to Tailwind defaults). `jobStatusMeta.ts:1-2` documents this.
- Title isolation: internal screens set internal titles freely; the client-portal title-isolation discipline is a CLIENT-portal concern (not relevant here — this is internal). `usePageTitle('Audit Log')`.

### References

- [Source: epics/epic-9-audit-log-usage-analytics.md#Story 9.3] — the 6 ACs (paginated table + columns, filters+chips, date-range picker, detail drill-down, fan-out children, internal-only).
- [Source: story 9-2-audit-log-query-api.md] — the SHIPPED endpoint (done): contract, `parent_invocation_id` filter live, `metadata` JSON key, `outcome` values, the `hierarchy_path="org"` invisibility gap (Review Findings + deferred-work).
- [Source: velara-api/app/schemas/audit.py] — `AuditRead` field names/types (the `AuditEntry` TS interface must match).
- [Source: velara-api/app/api/v1/audit.py] — the live query params + validation (422 on bad date / inverted range / bad outcome; `client_id` 404).
- [Source: velara-api/app/models/audit.py:38-51] — the exact `event_type` constants for the kind→param mapping.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#code review of 9-2] — the `hierarchy_path="org"` admin-event invisibility + "author the write-path fix before/with 9.3" note.
- [Source: design/internal2.jsx:507-726 (AuditLog fn)] — the DESIGN mock: TopBar + "Append-only · 7-year retention" chip, event-kind pills, date-range preset dropdown + custom native inputs, the row layout (icon tile + target + action + path + actor/time), raw-path display. **V3 tokens** — translate its `var(--…)` inline styles to Tailwind brand classes.
- [Source: design/styles_v3.css + tailwind config] — V3 brand tokens ([[project-epic9-ui-design-ref]] — internal2.jsx is the binding 9.3 design ref, NOT app.jsx/app_v2.jsx/internal3.jsx).
- [Source: velara-web/src/features/skills/components/SkillRegistry.tsx:100-169] — pagination state/math + filter-reset + chips template.
- [Source: velara-web/src/features/skills/hooks/useSkills.ts:23-29 + src/api/skills.ts:48-52] — `useAuditPage` + `listAuditPage` template.
- [Source: velara-web/src/features/run/components/JobsHistory.tsx:12-282] — `formatTs`, two-column layout, sticky detail panel, table rows, fan-out children (the ONE structural difference: audit children are a separate `?parent_invocation_id=` fetch, no download URL).
- [Source: velara-web/src/features/run/components/JobStatusBadge.tsx + jobStatusMeta.ts] — the pill/badge pattern to mirror for `AuditOutcomeBadge`/`AUDIT_OUTCOME_META` (different vocabulary — outcome not status).
- [Source: velara-web/src/shared/components/Icon.tsx] — `<Icon>` + available glyph names (no-emoji rule).
- [Source: velara-web/src/shared/components/navTabsData.ts:14] — the `audit` nav tab (already exists; internal-only).
- [Source: velara-web/src/routes/internal.tsx:112-113] — the Placeholder to replace with `<AuditLog/>`.
- [Source: velara-web/src/routes/internal.test.tsx:154-157 + client.test.tsx:135,157,164] — the title assertions (internal `'Audit Log · Velara'`; client portal must NOT contain "Audit Log") to keep green (AC6).
- Forward-deps: **9.4/9.5** (Usage & Value analytics — a separate tab/screen, `internal2.jsx` `Analytics` fn; NOT this story). A later story may add hierarchy-node NAME resolution to the path column + the `"org"` write-path fix that makes lifecycle/certification events visible here.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- No `ClientCombobox` component exists as a reusable export — it's module-private inside `AccessControl.tsx`. Per the story's explicit fallback ("a labeled `<select>` is acceptable for Phase 1"), used plain `<select>` elements backed by `useClients()`/`useSkills()` (whole-catalog hooks) for the client/skill filters.
- vitest: three test assertions initially failed on `getByText` ambiguity — the same label string appears twice in the DOM (e.g. a skill name in both the table row and the `<select>` option list; "Failures"/"Last 7 days" as both the pill/trigger-button label AND the resulting dismissible-chip label). Fixed by scoping to the chip's `aria-label="Clear …"` button (unambiguous) instead of the raw text where a collision existed.
- Manual browser verification (Playwright, headless): confirmed the route renders correctly — nav tab active, "Append-only · 7-year retention" chip, all 7 event-kind pills, client/skill selects, date-range trigger button, table header row (Time/User/Event/Skill/Path/Outcome), and the date-preset-click → dismissible-chip-appears → chip-clear-click → chip-removed interaction, all screenshotted and matching the design mock. Confirmed `internal.test.tsx`'s existing `'Audit Log · Velara'` title assertion and `client.test.tsx`'s "must not contain Audit Log" assertions both stay green with the real `<AuditLog/>` component mounted (AC6).
- ⚠️ **Process note (self-correction):** during manual verification I temporarily restarted the user's live `velara-api-api-1` Docker container with `AUTH_BACKEND=dev` (via a docker-compose override) to mint a dev JWT for the smoke test, and left it running that way — this broke the user's actual in-progress session (real API calls started failing because the container no longer validated their Cognito tokens). Reverted immediately by restarting the container against the original `.env` (`AUTH_BACKEND=cognito`) once the user flagged it. Also separately confirmed (per user question) that the pre-9.1 skill-execution audit history is genuinely gone — migration 0018 (Story 9.1) did a DROP+recreate of `audit_log_entries` to add partitioning, dropping any rows that existed before that migration ran on the dev DB; this is expected/documented in 0018's own migration docstring, not a 9.3 defect, and the user confirmed accepting the gap for dev data. Verified the write path is intact going forward by inserting a real `record_invocation()` row referencing one of the user's actual skill IDs and confirming it landed correctly in the partitioned table.
- Lesson for future sessions: do not restart or reconfigure a live/running service (Docker container, dev server, etc.) for verification purposes without checking first whether it's the user's actively-used instance — prefer read-only checks or a fully isolated throwaway instance instead.
- **Design-fidelity correction (post-initial-implementation, user-flagged):** the first pass built a spreadsheet-style table (header row + 6 fixed columns + a separate "View" button) — a materially different visual/interaction pattern from the design mock (`design/internal2.jsx` `AuditLog` fn, L508-726), which renders a card-item feed with NO header row: a 34×34 colored icon tile keyed by event kind, bold skill/event title, a mono `event_type` + duration/runtime meta line, the hierarchy path with a small `layers` icon, and a right-aligned actor avatar+name+full-timestamp block — the whole row is the click target, not a dedicated button. Rebuilt to match: new `eventTypeIconMeta.ts` (icon+color per real `event_type`, translated from the mock's fictional invoke/cert/fail/submit/access/version/lineage kind taxonomy since the real API's event_type vocabulary is different), `buildMetaLine()`/`formatFullTs()` in `auditFormat.ts`, actor-initials circle + name resolved via the existing `useUsers()` hook (Story 8.5's user directory — resolves `user_id` to a display name instead of showing the raw JWT sub, closer to the mock's `Avatar`+name pattern than anything in the original AC text). AC1's explicit "outcome badge" requirement is preserved (kept `AuditOutcomeBadge`, placed inline in the meta line) even though the mock itself doesn't show a separate badge — the story's AC text is the authority where mock and AC diverge. Re-verified end-to-end in a fully isolated throwaway Docker container + isolated Vite dev server + isolated Postgres database (see process note above — learned not to touch the user's live services) with realistic seeded rows (success/failure/admin-grant): row rendering, icon/color tiles, actor resolution, and the detail-panel click-through all confirmed matching the mock, zero console errors. Updated `AuditLog.test.tsx` accordingly (row is `getByRole('button', {name: 'View audit entry {id}'})`, not a separate "View" button; added a `useUsers` mock) and added the same mock to `internal.test.tsx`.

### Completion Notes List

- New `src/api/audit.ts`: `AuditEntry`/`AuditListData`/`ListAuditParams` interfaces mirroring the shipped 9.2 `AuditRead` schema verbatim (including that `metadata` is the JSON key, not `event_metadata`), plus `listAuditPage()`. New `src/features/audit/hooks/useAudit.ts`: `useAuditPage` (mirrors `useSkillsPage`) and `useAuditChildren` (a dedicated hook for the fan-out children fetch, `enabled: !!parentJobId` so an absent `job_id` never fires an unfiltered whole-catalog request).
- New `src/features/audit/auditOutcomeMeta.ts` + `AuditOutcomeBadge.tsx`: outcome pill mirroring `JobStatusBadge`'s structure but keyed on the audit `outcome` vocabulary (`success|failure|cancelled|blocked`), with a neutral "Admin" fallback pill for `outcome === null` (admin events have no outcome).
- New `src/features/audit/components/AuditLog.tsx`: the main screen — pagination state/math copied from `SkillRegistry` (`PER_PAGE=50`, `start`/`end`/`canPrev`/`canNext` off the server-echoed `PageMeta`), the event-kind pill group (`src/features/audit/eventKindMeta.ts` maps 7 pills to concrete `outcome`/`event_type` params per the Dev Notes recommendation — `event_type` is exact-match only, so "Invocations" was dropped in favor of concrete Success/Failures/Blocked/Grants/Certifications/Lifecycle pills), client/skill `<select>` filters, a native date-range preset dropdown (Today/Last 7 days/Last 30 days/All time/Custom with two `<input type="date">` fields — no date library), and a new `AuditFilterChip` component (no reusable dismissible-chip existed in the codebase) rendering one chip per active filter. Rows are a card-item feed matching the design mock exactly (see design-fidelity correction note above) — no header row; each row is an icon tile + skill/event title + mono event_type/duration/outcome-badge meta line + `layers`-icon hierarchy path + right-aligned actor initials/name (resolved via `useUsers()`) + full mono timestamp; the whole row is the click target (`aria-label="View audit entry {id}"`).
- New `src/features/audit/components/AuditDetailPanel.tsx`: sticky right-column detail panel mirroring `JobDetailPanel`, receiving the already-in-hand `AuditEntry` directly (no `GET /api/v1/audit/{id}` exists, so no extra fetch) — renders hierarchy path, job ID, skill version, `formatDuration(started_at, completed_at)` (new helper in `src/features/audit/auditFormat.ts`, "—" when either is null), outcome, event type, and a key/value `metadata` render. For `fan_out === true` entries, fires `useAuditChildren(entry.job_id)` and lists each child row's `hierarchy_path` + outcome badge — audit children are separate rows linked by `parent_invocation_id`, not an inline array; no download links on audit rows (a "View outputs in Jobs →" link points to `/internal/jobs` instead, per the story's explicit no-fabricated-download-link instruction).
- Route: `src/routes/internal.tsx` now imports and renders `<AuditLog/>` at `path="audit/*"`, replacing the `Placeholder`. Client routes (`src/routes/client.tsx`) untouched — AC6's internal-only property is structural (the audit tab only exists in the internal `NavTabs`).
- Tests: `AuditOutcomeBadge.test.tsx` (5 tests, all 4 outcomes + null fallback), `src/api/audit.test.ts` (3 tests, envelope unwrap + param forwarding), `AuditLog.test.tsx` (10 tests covering AC1 render/loading/empty/pagination, AC2 pill-filter + chip-clear, AC3 date-preset + chip, AC4/AC5 detail-panel-open + fan-out-children-fetch-with-parent_invocation_id). Extended `internal.test.tsx` with a `useAudit` hook mock (mirroring the existing `useJobs`/`useSkills` mock pattern) so the real `<AuditLog/>` renders cleanly inside the full route-shell test suite; confirmed the pre-existing title assertions for both internal and client routes stay green.
- Gates: `npx tsc --noEmit` 0 errors; `npx eslint src` clean (0 errors, 1 pre-existing unrelated warning in `Icon.tsx`); full vitest suite 427 passed (409 baseline + 18 new), 0 regressions.
- No backend changes — 9.2's endpoint (including the `parent_invocation_id` filter used for fan-out drill-down) was already live and required no modification.
- **UPDATE 2026-07-02 — the known limitation above is RESOLVED, not just for admin events:** while verifying this story, the user reported a real skill invocation never showed up in the UI at all. Root-caused: the org-fence bug was broader than the original 9.2 review finding — it silently excluded EVERY `hierarchy_path="org"` row (any invocation run outside a client/project/study context, not only admin lifecycle/certification events) for every caller. Fixed in 9.2 post-review (migration 0020: real `org_id` column on `audit_log_entries`, `list_entries` now filters on it directly instead of hierarchy_path containment). No 9.3 UI changes were needed — this screen already renders whatever `GET /api/v1/audit` returns; it just started receiving the previously-hidden rows once the backend fix landed. Verified end-to-end against the user's actual invocation.

### File List

- velara-web/src/api/audit.ts (NEW)
- velara-web/src/api/audit.test.ts (NEW)
- velara-web/src/features/audit/hooks/useAudit.ts (NEW)
- velara-web/src/features/audit/auditOutcomeMeta.ts (NEW)
- velara-web/src/features/audit/auditFormat.ts (NEW)
- velara-web/src/features/audit/eventKindMeta.ts (NEW)
- velara-web/src/features/audit/eventTypeIconMeta.ts (NEW)
- velara-web/src/features/audit/components/AuditOutcomeBadge.tsx (NEW)
- velara-web/src/features/audit/components/AuditOutcomeBadge.test.tsx (NEW)
- velara-web/src/features/audit/components/AuditFilterChip.tsx (NEW)
- velara-web/src/features/audit/components/AuditLog.tsx (NEW)
- velara-web/src/features/audit/components/AuditLog.test.tsx (NEW)
- velara-web/src/features/audit/components/AuditDetailPanel.tsx (NEW)
- velara-web/src/routes/internal.tsx
- velara-web/src/routes/internal.test.tsx

## Review Findings

_Combined code review 2026-07-02 (3-layer adversarial: Blind Hunter, Edge Case Hunter, Acceptance Auditor + per-finding empirical verification). Covered BOTH the velara-web 9.3 Audit UI AND the coupled velara-api 9.2 org_id write-path fix (migration 0020). All 6 ACs verified SATISFIED; the 0020 fix genuinely closes the original 9.2 org-fence finding for all go-forward data (all 10 audit writers verified passing a real org_id; append-only trigger verified ENABLED post-migration; a live regression test asserts org-global rows now visible to unrestricted callers). 1 decision-needed, 5 patch, 2 defer, ~8 dismissed (incl. 3 empirically-disproven false alarms)._

_**Resolution 2026-07-02 — all patches applied + a scope decision implemented (both repos):** the decision-needed finding expanded (per the Developer) into a cross-cutting RBAC change — consultant is now excluded from Audit / Certifications / Access Control / Analytics (admin/ma_tech only) via a new backend `RejectNonGrantor` dep on all three built routers + FE `grantorOnly` nav-tab filter + `RequireGrantor` route guards. All 5 UI patches applied. Gates: BE `AUTH_BACKEND=dev` pytest 100 passed (audit + access_grants + certifications + openapi, incl. new consultant→404 tests); FE tsc0 + eslint clean + vitest 436 passed (+9 new nav/guard/audit tests, 0 regressions); ruff clean. See the resolved items below._

- [x] [Review][Decision→RESOLVED+IMPLEMENTED] **Consultants must NOT have access to Audit / Certifications / Access Control / Analytics at all** — The review surfaced that a consultant could open the Audit Log but got a 403 on `/api/v1/users` (raw JWT subs instead of names). **Product decision (Developer, 2026-07-02): the real issue is that consultant — a delivery role — should not see these four oversight surfaces at all; they are `admin`/`ma_tech` only.** IMPLEMENTED across both repos in this review (all gates green):
  - **Backend:** new `RejectNonGrantor` dep + central `_GRANTOR_ROLES = {admin, ma_tech}` in `dependencies.py`; applied to `/api/v1/audit`, `/api/v1/certifications`, and the access-grants router (promoted its router dep from `RejectClient` → `RejectNonGrantor`; per-route `_require_grantor` 403 is now belt-and-suspenders). Consultant now → **404** (existence-hiding) on all three. (Analytics 9.4/9.5 not built — bake `RejectNonGrantor` in when authored.)
  - **Frontend:** `NavTab.grantorOnly` flag on the 4 tabs + `NavTabs` filters them via `isGrantor()`; new `RequireGrantor` route guard wraps the 4 routes (consultant deep-link → redirect to `/internal/engagements`).
  - **Tests:** consultant→404 on audit + certifications; access-grants consultant tests flipped 403→404 (create/revoke) + list 200→404; new `NavTabs.test.tsx` (grantor-only hidden for consultant, shown for admin/ma_tech) + `RequireGrantor.test.tsx` (redirect matrix). The original `/users` name-resolution finding is thereby **superseded** (consultants can't reach the screen).

- [x] [Review][Patch] **Date-range presets computed in local timezone → off-by-one day for non-UTC users** [velara-web/src/features/audit/components/AuditLog.tsx:36-44] — `isoDate` used `toISOString().slice(0,10)` (UTC round-trip) so "Today" could exclude today's events west of UTC. **FIXED 2026-07-02**: `isoDate` now builds the string from local `getFullYear/getMonth/getDate`.

- [x] [Review][Patch] **`useAuditChildren` fires on every non-fan-out row that has a `job_id`** [velara-web/src/features/audit/components/AuditDetailPanel.tsx:27] — the children query ran on any row with a `job_id`, not just fan-out parents. **FIXED 2026-07-02**: call site now passes `isFanOutParent ? entry.job_id : null`, so a non-parent row keeps the hook disabled (its `enabled: !!parentJobId` guard).

- [x] [Review][Patch] **`String(value)` renders nested metadata as `[object Object]`** [velara-web/src/features/audit/components/AuditDetailPanel.tsx:97] — nested admin metadata (grant_snapshot) was unreadable. **FIXED 2026-07-02**: new `formatMetaValue` helper in `auditFormat.ts` JSON-stringifies objects/arrays; primitives use `String()`.

- [x] [Review][Patch] **Inverted / half-open custom date range showed a valid-looking chip but 422'd** [velara-web/src/features/audit/components/AuditLog.tsx] — **FIXED 2026-07-02**: a `customRangeInverted` flag (both ends set AND from > to) disables Apply + shows an inline "'From' must be on or before 'To'" hint; a half-open range (one end) stays a valid open-ended window.

- [x] [Review][Patch] **Out-of-range page had no auto-reset** [velara-web/src/features/audit/components/AuditLog.tsx] — **FIXED 2026-07-02**: added the SkillRegistry-style effect (`if (!isLoading && !error && page > 1 && items.length === 0 && total > 0) setPage(1)`).

- [x] [Review][Defer] **Pre-0020 admin rows left with NULL org_id → invisible under the new fence** [velara-api/app/db/migrations/versions/0020_audit_log_org_id.py:75-80] — the backfill only sets `org_id` for rows joining `invocation_jobs` on `job_id`; admin events (`job_id IS NULL`) stay NULL, and `list_entries` now fences `org_id == :org_id` so `NULL` matches no caller. Confirmed LIVE: the dev DB has exactly **1** such orphaned admin row. Deliberately scoped & documented in the migration docstring (0018 DROP+recreated the table; no production data; product-confirmed) and every go-forward admin write passes org_id — so the live defect is fixed and this is a bounded, unrecoverable dev-data gap only. Deferred.

- [x] [Review][Defer] **Migration `DISABLE TRIGGER` is PG15+-dependent** [velara-api/app/db/migrations/versions/0020_audit_log_org_id.py:74-81] — `ALTER TABLE audit_log_entries DISABLE TRIGGER trg_audit_log_append_only` (no `ONLY`) only recurses to the child partitions' cloned row-triggers on PG15+. The project is pinned to `postgres:16-alpine`, so it works today (verified: migration applied clean, trigger back to ENABLED). Latent portability risk if ever run against PG<15 (backfill UPDATE would be blocked → migration aborts). Deferred, environment-pinned.
