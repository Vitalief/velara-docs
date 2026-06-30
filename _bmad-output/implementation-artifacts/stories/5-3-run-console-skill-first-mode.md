---
baseline_commit: a111997cfb1267cc9f8ca1c0fb89fa9c4698da4e
---

# Story 5.3: Run Console — Skill-First Mode

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to launch the Run Console from a Skill detail view with the skill pre-selected and locked, then pick **any** engagement context via an editable Client → Project → Study picker,
so that I can test or run any skill against any engagement without the skill needing to be formally attached to that project.

> **FRONTEND-ONLY story** (React 19 + React Router 7 + TanStack Query 5 + Zustand 5 + Axios + Tailwind v4). The backend invocation/job API was finalized in **Story 5-1** (`done`) and the Run Console **shell** was built in **Story 5-2** (`done`). **Do NOT build or change backend code, and do NOT rebuild the shell — EXTEND it in place.** This is the *second* Run Console story; 5-2 explicitly built the shell so this story slots in. The Epic 4 retro's #1 lesson is **"grow one screen in place, don't rewrite."**
>
> **The single most important contract fact (read this first):** the invocation POST body has **NO `client_id` and NO `project_id` field** (`extra="forbid"` → sending them = 422). For a **non-location-dependent** skill (the common skill-first case), the user's Client→Project→Study selection is **invisible to the backend** — only `study_id`/`location_id` are ever transmitted, and `study_id` is *ignored and not stored* for non-location-dependent skills. The context picker is real UX (per the AC), but at the wire level a non-LD skill submits `{}`/`{inputs}`. See *Dev Notes → Backend context contract — the critical truth*. **Verified against `velara-api/app/schemas/invocation.py` + `invocations.py` + `models/invocation.py`.**

## Acceptance Criteria

**AC1 — Launch from Skill detail; skill card shown locked with a green tint**
**Given** I am viewing a Skill detail page (`/internal/skills/:skillId`)
**When** I click "Run"
**Then** the Run Console opens in skill-first mode: the skill card is shown with a **green (brand) tint** and **locked** (cannot be changed)
> The Skill detail page currently has a **disabled** "▶ Run · Coming soon" button at `SkillDetail.tsx:210-221` — this story **wires it live** (remove `disabled`/`title="…coming soon"`, add `onClick` to navigate to the skill-first run route). "Green tint" = brand tokens (`bg-brand-50 border-brand-100`, eyebrow `text-brand-600/700`), **NEVER `green-*`** (renamed to `brand-*` in 1-6 — `green-*` silently falls back to Tailwind's built-in green; this is the exact drift the Epic 4 retro guards against). The prototype labels this card with an uppercase eyebrow **"Running skill"** (`design/overrides.jsx:167`).

**AC2 — Context picker shows ALL Clients/Projects/Studies, not filtered by skill attachment**
**Given** the Run Console is in skill-first mode
**When** the context picker renders
**Then** it shows **all** Clients, Projects, and Studies in the system — NOT filtered by skill attachment
> This is an **editable cascade picker** (the inverse of 5-2's *locked* context panel). Populate it with the existing list hooks — `useClients()` → `useProjects(clientId)` → `useStudies(projectId)` (all in `features/engagements/hooks/useEngagements.ts`, all gated by `enabled: !!parentId`, all already used by the engagements tree). **No new hooks/endpoints — verified all four list hooks exist.** Port the prototype's `HierarchyPicker` (`design/internal3.jsx:8-74`): three cascading native `<select>`s (Client → Project → Study). There is **no existing reusable cascade component** — build it under `features/run/`.

**AC3 — Selecting Client → Project (→ Study) activates the Run button**
**Given** the Run Console is in skill-first mode
**When** I select Client → Project → Study (or Client → Project if no Study)
**Then** the Run button becomes active and the invocation will use the selected context with the locked skill
> **Minimum valid context = a Project** (Client→Project). Study is **optional** for a non-location-dependent skill (prototype: a "All studies (project-level)" sentinel option leaves `studyId` empty — `design/internal3.jsx:59`). For a **location-dependent** skill, a Study is **required** to resolve locations (reuse 5-2's `LocationSelector` once a Study is chosen). See *Dev Notes → Run-button gating (skill-first)*.

**AC4 — Submit invocation with selected context; skill dropdown absent**
**Given** I click "Run" in skill-first mode
**When** the invocation is submitted
**Then** `POST /api/v1/invocations/{skill_id}` is called with the selected context and the skill **dropdown is absent** from the UI
> "Skill dropdown is absent" = the context-first skill picker (`SkillPickerRow` list in `RunConsole.tsx:424-453`) must **not render** in skill-first mode — only the locked green skill card shows. **Payload (verified contract):** location-dependent single → `{location_id}`; location-dependent run-for-all → `{study_id, fan_out: true}`; **non-location-dependent → `{}`** (optionally `{inputs}`/`{file_ref_ids}` — not required by any 5-3 AC). **NEVER add `project_id`/`client_id`/`scope` to the body** (`extra="forbid"` → 422). On 202 success set `useRunStore.setActiveJobId(job_id)` + `setRunMode('skill-first')`. Status indicator remains the **5-2 STUB** ("Queued"); real polling is Story 5-4.

**AC5 — Back button returns to the originating Skill detail page**
**Given** the Run Console was opened from Skill Detail
**When** I click the back button
**Then** I am returned to the **Skill detail page** for the skill that was being tested (`/internal/skills/:skillId`)
> Use an **explicit route** (`/internal/skills/${skillId}`), **never** `navigate(-1)` (codebase convention — 4-4/5-2). The skill id is in the run route, so the back target is always resolvable on cold deep-link/refresh.

## Scope: Extend the 5-2 Shell — Don't Rebuild

> **Decision needed (see Dev Agent Record):** the route placement for skill-first. **Recommended:** a dedicated `skills/run/:skillId` route (NOT reusing 5-2's `engagements/run/:origin/:originId` with a new `origin=skill`). See *Dev Notes → Routing decision* for the full rationale — short version: `useActiveTab` keys off path segment `[2]`, so `skills/run/...` keeps the **Skills** tab active (matching back-to-skill-detail), whereas `engagements/run/...` would highlight Engagements; and `entityPath`/`validOrigin`/the whole context-resolution branch in `RunConsole.tsx` assume `project|study` and would all need special-casing for a `skill` origin.

**5-3 BUILDS:**
- A **skill-first entry path** into the EXISTING `RunConsole`: wire `SkillDetail.tsx:210-221`'s disabled Run button live → navigate to the skill-first run route.
- A new **route** (recommended `skills/run/:skillId`) registered in `routes/internal.tsx`, ordered **before** `skills/:skillId` (literal segment before dynamic param).
- A **`RunMode`-aware** `RunConsole`: in skill-first it renders the **locked green skill card** (resolved via `useSkill(skillId)`) and the **editable context cascade picker** instead of the locked-context panel + skill list. Reuse the two-column shell, breadcrumb, trust chip, location selector, submit mutation, and job-status stub from 5-2.
- A **`HierarchyPickerCascade`** component (ported from the prototype): `useClients`/`useProjects`/`useStudies`, cascading resets, Study optional.
- **Mode-aware** `setRunMode('skill-first')` on submit (5-2 hardcodes `'context-first'` at `RunConsole.tsx:388`).
- The location selector reused **when** the locked skill is location-dependent AND a Study is selected in the picker.
- **Tests + gates** (typecheck 0, lint clean, web suite green — baseline **175** at end of 5-2; state your delta — build ✓).

**5-3 DEFERS (do NOT build):**
- **Real job polling (3s), live output, file download, fan-out "X of N" + per-location results** → **Story 5-4**. The 5-2 status-indicator stub is the seam; leave the `JobStatusPanel`/`JobStatusBadge` STUB as-is (it already shows "Queued").
- **Real backend skill-attachment / RBAC / access-gating** → later epic / Epic 8. Skill-first is intentionally *unrestricted* by design (run any skill against any context).
- **File-upload / schema-driven inputs in the run config** (the prototype's "Input · {schema}" card + dropzone) → not required by any 5-3 AC. Leave `inputs`/`file_ref_ids` unsent unless trivially additive; note as a known gap.
- **Reshaping `useRunStore`** — `activeJobId` (single id) + `runMode` already suffice. Fan-out returns ONE parent id.

**Out of scope entirely:** backend changes, OpenAPI/Swagger (5-5), audit UI (Epic 9), pagination (5-6/5-7).

## Design Fidelity — `design/` is the visual starting point

> **A working skill-first Run Console mockup already exists — mirror it.** This is the guard against the engagements-screen drift (Epic 4 retro; ~105 inline `style={{}}`/`var(--green-*)` values had drifted and silently fell back to Tailwind's built-in green). Do NOT design from scratch — port the prototype. (5-2's initial dev *skipped* the prototype on a false "not found" claim and it had to be reconciled in review — don't repeat that. The files DO exist at `/Users/apple/Projects/AI/velara/design/`.)
>
> **Authoritative references (read before building UI):**
> - `design/overrides.jsx` — the **live** `RunConsole` (lines 96–319). Skill-first specifics: `mode === 'skill-first'` is the locked-skill branch. The **locked green skill card** is lines **165–174** (eyebrow "Running skill", `var(--green-50)` bg / `var(--green-100)` border / `var(--green-600)` eyebrow → translate to `brand-*`). The skill `<select>` is suppressed in skill-first: `{mode !== 'skill-first' && …}` (line 183). Empty-state copy in skill-first: **"Select an engagement context to continue"** (line 243).
> - `design/internal3.jsx` — the **`HierarchyPicker`** (lines 8–74) + `PickerStep` (76–86): the cascading Client→Project→Study `<select>`s, the green breadcrumb confirmation strip (lines 28–39), cascade resets (lines 16–18: choosing client wipes project+study; choosing project wipes study), the "All studies (project-level)" sentinel (line 59). **This is the component to port for AC2/AC3.**
> - `design/app_v3.jsx` — the entry point `handleSkillRun(id)` (lines 80–92): sets `mode:'skill-first'`, locks the skill id, and `onBack` returns to that skill's detail. This is what `SkillDetail`'s Run button must do (as a real route navigation).
> - `design/styles_v3.css` — V3 brand tokens (already ported to Tailwind in 1-6 — use Tailwind `brand-*`/`st-*`/surface/ink/line classes, never raw hex, never `green-*`).
>
> **Treatment:** strong reference, **pragmatic deviations allowed and documented.** Expected deviations: (1) the prototype's skill `<select>` and Input/file-dropzone card are out of scope (skill-first locks the skill; inputs deferred); (2) the prototype is a single SPA component — you're porting into the routed, hook-driven 5-2 shell. Note any further deviation in the Dev Agent Record with a one-line rationale. Fidelity is verified by **code reference** against `design/overrides.jsx`/`internal3.jsx` + `styles_v3.css` — no live-render/screenshot step required.

## Tasks / Subtasks

- [x] **Task 0 — Read the as-built 5-2 shell + the prototype BEFORE writing anything (AC: 1–5)**
  - [x] Read `src/features/run/components/RunConsole.tsx` END TO END. Mapped seams: entry `RunConsole` → `RunConsoleResolver` → `RunConsoleInner`; skill picker list (`role="listbox"`), `LockedContextPanel`, `handleRun` hardcoding `setRunMode('context-first')`, `LocationSelector`, `JobStatusPanel`. Branched on route (skillId param) without forking the console — extracted a shared `RunShell`.
  - [x] Read `design/overrides.jsx` RunConsole (skill-first branches: locked card 165–174, suppressed skill `<select>` 183, empty-state copy 243) + `design/internal3.jsx` HierarchyPicker/PickerStep (8–86) + `design/app_v3.jsx:80-92` (`handleSkillRun`). Every `var(--green-*)`/inline style translated to `brand-*`/`st-*` tokens. Verified zero `green-*/amber-*/gray-*/red-*`/hex/`brand-200` in new code via grep.

- [x] **Task 1 — Add the skill-first route + wire the Skill detail Run button (AC: 1, 5)**
  - [x] Registered `skills/:skillId/run` in `src/routes/internal.tsx` (nested under the skill so the `skillId` param sits in the same position as `skills/:skillId`; the literal `run` trailing segment is distinct from `edit`, so order among `skills/:skillId/*` routes doesn't matter). Keeps `useActiveTab` (segment `[2]` = `skills` → `registry` tab) highlighting the **Skills** tab. (Chose `:skillId/run` over the story's `run/:skillId` suggestion — see decision log; both keep the Skills tab, this nests more naturally and the navigate target matched the SkillDetail snippet.)
  - [x] Replaced the disabled "▶ Run · Coming soon" button in `SkillDetail.tsx` with a live `bg-brand-800` button → `navigate('/internal/skills/' + skill.id + '/run')`.

- [x] **Task 2 — Make `RunConsole` accept skill-first (AC: 1, 4)**
  - [x] Entry `RunConsole` now dispatches: `skillId` param → `RunConsoleSkillFirstInner`; else → `RunConsoleContextFirst`. Each sibling owns ALL its hooks unconditionally (no hook-after-conditional-return; rules-of-hooks hold per route). Locked skill resolved via `useSkill(skillId)`. Shared two-column shell/breadcrumb/trust-chip/Run+Back/JobStatusPanel reused via `RunShell`.
  - [x] `usePageTitle(skill?.name, 'Run')` in the skill-first inner → "<Skill> · Run · Velara" (falls back to "Run · Velara" while loading).
  - [x] Loading → `Skeleton` (no phantom green card); `SKILL_NOT_FOUND` → friendly not-found state (mirrors SkillDetail's pattern via `getApiCode`/`getErrorMessage`).

- [x] **Task 3 — Locked green skill card (AC: 1, 4)**
  - [x] `LockedSkillCard` (skill-first only): `border-brand-100 bg-brand-50`, eyebrow "Running skill" (`text-brand-600`, `text-[10.5px] font-bold uppercase tracking-wide`), bold name, `RuntimeTypeChip`/`VisibilityChip`/`SkillLifecycleBadge` row + location-dependent pin + description. Static display = "locked", no skill selector.
  - [x] Context-first skill picker list is structurally absent in skill-first (it lives only in `RunConsoleInner`; skill-first never renders it). AC4 asserted by querying for `role="listbox"` name "Available skills" → absent.

- [x] **Task 4 — Editable context cascade picker (AC: 2, 3)**
  - [x] Created `src/features/run/components/HierarchyPickerCascade.tsx` (port of `design/internal3.jsx`). `value:{clientId,projectId,studyId}` + `onChange`. Client (eager `useClients`), Project (gated `useProjects`), Study optional (gated `useStudies`, first option "All studies (project-level)" `value=''`). Cascade resets: client wipes project+study; project wipes study.
  - [x] Dropped the prototype `(p.code)` suffix (entities have `id`+`name` only). Selects use the shared brand-token input class (mirrors EngagementsScreen `inputCls`), no hex.
  - [x] Brand-tinted breadcrumb strip of the chosen path (`bg-brand-50 border-brand-100`, `data-testid="cascade-path"`).
  - [x] a11y: each `<select>` has a `<label>` + `aria-label` ("Client"/"Project"/"Study").

- [x] **Task 5 — Location selector in skill-first (AC: 3)**
  - [x] Reused 5-2's `LocationSelector` (not rebuilt). Rendered only when locked skill `location_dependent === true` AND a `studyId` is selected. Wired to `useLocations(studyId)`.
  - [x] Edge cases: LD skill + Project but no Study → inline "Select a Study to choose a location for this skill" + Run blocked. Empty study → 5-2 selector disables "Run for all". Non-LD → selector never shown, Study optional.

- [x] **Task 6 — Submit mutation + Run-button gating (skill-first) (AC: 3, 4)**
  - [x] Reused `useCreateInvocation()`/`createInvocation` (no new mutation code). Payload: LD single → `{location_id}`; LD run-for-all → `{study_id, fan_out:true}`; non-LD → `{}` (Client/Project/Study NOT sent — verified no `client_id`/`project_id`/`scope` in the body).
  - [x] Gating: disabled until a Project is picked; for LD, also requires a Study AND a location/run-for-all selection. Non-LD needs only a Project. `canRun` blocks the handler too.
  - [x] Double-submit guard: `if (createInvocation.isPending) return` at the top + `disabled` (via `canRun`) on the button.
  - [x] On 202: `setActiveJobId(job.job_id)` + `setRunMode('skill-first')`. On error: `setSubmitError(friendlyInvocationError(err))` (reuses the existing `errors.ts` invocation map).

- [x] **Task 7 — Back-to-skill navigation + job-status stub (AC: 5, 4)**
  - [x] Back button → `navigate('/internal/skills/' + skillId)` (never `navigate(-1)`). Breadcrumb: "Skill Registry › <skill> › [Client › Project › Study ›] Run Console" — context crumbs derived from the picker selection.
  - [x] `JobStatusPanel`/`JobStatusBadge` STUB untouched (still shows "Queued"). `activeJobId` cleared on mount via a `useEffect` keyed on `skillId`.

- [x] **Task 8 — Tests + gates (AC: 1–5)**
  - [x] Co-located tests. `HierarchyPickerCascade.test.tsx` (8 tests). `RunConsole.test.tsx` extended with a "skill-first mode" block (17 tests) using the 5-2 harness (vi.mock hooks, QueryClientProvider retry:false + MemoryRouter, `_mockAuthSession`, stub `/internal/skills/:skillId` for AC5). `SkillDetail.test.tsx` Run-button test updated (live, navigates to run route). `internal.test.tsx` +3 (skill-first route renders, Skills tab active, title).
  - [x] Covered AC1 (locked card, name, picker absent), AC2 (cascade clients→projects→studies, not skill-filtered), AC3 (gating: non-LD Project-only, LD Study+location), AC4 (payloads `{}`/`{location_id}`/`{study_id,fan_out:true}`, no project_id/client_id, `setRunMode('skill-first')`, Queued status), AC5 (Back→skill detail), + Skills-tab-active, 422 friendly error, loading/not-found.
  - [x] Gates: `npm run typecheck` (0), `npm run lint` (clean), `npm run test` (**203 pass, +28 from 175 baseline, 0 regressions**), `npm run build` (✓).

## Dev Notes

### Backend context contract — the critical truth (verified against source)
The invocation POST body (`InvocationRequest`, `velara-api/app/schemas/invocation.py:41-47`, `extra="forbid"`) has **exactly five fields**: `file_ref_ids: uuid[]`, `inputs: dict|null`, `location_id: uuid|null`, `study_id: uuid|null`, `fan_out: bool`. **There is NO `client_id`, NO `project_id`, NO `scope` — and `extra="forbid"` means sending one is a 422, not silently ignored.** `InvocationJob` (`velara-api/app/models/invocation.py:43-148`) stores only `location_id` (bare UUID), `hierarchy_path` (ltree string, set to `"org"` for non-LD jobs), and `org_id` — **no project/client/study columns.**

Consequence for skill-first (`velara-api/app/api/v1/invocations.py:205-276`):
- **Non-location-dependent skill:** takes the `else` branch (`:267-276`) → `hierarchy_path="org"`, and `location_id`/`study_id`/`fan_out` are **ignored entirely**. The user's Client→Project→Study selection is recorded against `org` only — it never reaches a stored field. **So the picker is real UX for the user, but the wire payload is `{}` (plus optional inputs).** Do NOT try to "send the context" — there is no field for it.
- **Location-dependent skill, single location:** `{location_id}` → backend stores `location_id` + the location's `hierarchy_path`. If you also send `study_id` it is used ONLY to validate the location belongs to it (`LOCATION_STUDY_MISMATCH` on conflict) — not stored.
- **Location-dependent skill, fan-out:** `{study_id, fan_out:true}` → parent + one child per location; returns the **parent** `job_id`.

**This is the #1 disaster to prevent:** an LLM dev will instinctively try to send the selected `project_id`/`client_id` to "use the selected context." That POST 422s. The context selection drives only `study_id`/`location_id` (for LD skills) — for non-LD skills it's display-only.

### Routing decision (recommended: dedicated route)
`useActiveTab` (`routes/internal.tsx:30-35`) keys off `pathname.split('/')[2]` — the segment after `/internal/`. Skill-first launches from `/internal/skills/:skillId` and Back returns there.
- **Recommended — `skills/run/:skillId`:** segment `[2]` = `skills` → the **Skills** tab stays active (matches the skill-detail origin). Register it **before** `skills/:skillId` (`routes/internal.tsx:79`) so React Router matches `run` literally, not as a `:skillId`. Back target = `/internal/skills/:skillId` — trivially resolvable from the route param.
- **Alternative — reuse 5-2's `engagements/run/:origin/:originId` with `origin='skill'`:** you'd then own (a) the `validOrigin` guard (`RunConsole.tsx:554`, currently rejects non-`project|study`), (b) `entityPath` (`:47-50`, only knows `projects|studies`), (c) the whole context-resolution branch (`:294-313`, assumes a Client→Project[→Study] chain). And segment `[2]`=`engagements` would light the **wrong** tab. More work, worse fit. **Document whichever you pick in the Dev Agent Record.**

### Make `RunConsole` mode-aware — minimal seams (don't fork the component)
5-2's `RunConsoleInner` is built for context-first (locked context + derived skill list). The clean extension is a `mode: RunMode` flowing into the inner UI that branches **four** things:
1. **Left column top:** skill-first → locked green skill card (`useSkill`); context-first → `LockedContextPanel` (unchanged).
2. **Context source:** skill-first → editable `HierarchyPickerCascade` (the user picks); context-first → resolved-and-locked chain (unchanged).
3. **Skill source:** skill-first → the route's `skillId` is the skill (no list; `RunConsole.tsx:424-453` skill picker hidden); context-first → `useProjectSkills` picker (unchanged).
4. **`setRunMode`** on submit: skill-first → `'skill-first'`; context-first → `'context-first'` (today hardcoded `RunConsole.tsx:388`).
The two-column shell, breadcrumb, trust chip, `LocationSelector`, `useCreateInvocation`, `JobStatusPanel`, Back/Run buttons, and the `friendlyInvocationError` mapping are **shared** — reuse them. Prefer a `mode` prop + conditional rendering inside the existing inner component over a parallel `RunConsoleSkillFirstInner`.

### Source tree — what to create vs. reuse
**New (under `velara-web/src/`):**
- `features/run/components/HierarchyPickerCascade.tsx` — the editable Client→Project→Study cascade (port of `design/internal3.jsx` `HierarchyPicker`).
- Skill-first branch inside `features/run/components/RunConsole.tsx` (extend in place — DO NOT create a second console).
- Tests co-located.

**Reuse directly (do NOT rebuild):**
- Run shell + subcomponents: `RunConsole.tsx` two-column layout, `LockedContextPanel` (context-first only), `SkillPickerRow` (context-first only — hide in skill-first), `LocationSelector`, `JobStatusBadge`/`JobStatusPanel` (STUB), `Icon`, `entityPath`.
- Hooks: `useSkill` (`features/skills/hooks/useSkills.ts:12`), `useClients`/`useProjects`/`useStudies`/`useLocations` (`features/engagements/hooks/useEngagements.ts:33,40,82,121` — all gated by `enabled:!!parentId`), `useCreateInvocation`, `useRunStore` (`runMode` already supports `'skill-first'`).
- HTTP/API: `createInvocation` (`api/jobs.ts`), `apiClient`, envelope-unwrap (`response.data.data`).
- Components/utils: `Breadcrumb`, `SkillLifecycleBadge`/`VisibilityChip`(⧉ glyph)/`RuntimeTypeChip`, `Skeleton`, `friendlyInvocationError`/`getApiCode`/`getErrorMessage` (`shared/utils/errors.ts`), `usePageTitle`.
> No new list hooks or endpoints are needed — `useClients`/`useProjects`/`useStudies`/`useLocations` all exist and already power the engagements tree with the exact gated-cascade behavior.

### API contract quick-reference (from Story 5-1 — verified against real files)
`POST /api/v1/invocations/{skill_id}` → 202 `{data:{job_id, status:"queued"}, meta:{request_id,timestamp}}`. Fan-out `job_id` = parent. Validation 422 codes (enforced **only** when `skill.location_dependent`): `LOCATION_REQUIRED`, `INVOCATION_AMBIGUOUS_LOCATION` (both location_id+fan_out), `STUDY_REQUIRED` (fan_out w/o study_id), `NO_LOCATIONS_IN_STUDY`, `LOCATION_STUDY_MISMATCH`. Plus `SKILL_NOT_FOUND` (404), `SKILL_RETIRED` (422), `SKILL_NO_CURRENT_VERSION` (422), `FILE_REF_NOT_FOUND`/`FILE_REF_NOT_READY` (only if you send `file_ref_ids`). **Note:** `SKILL_SCOPE_VIOLATION` exists in the backend but is **not enforced** on the invocation path today — study-scope is not checked at invocation time, so skill-first can legitimately run any invocable skill against any context (matches the AC's intent).
- List endpoints: `GET /api/v1/clients`, `/api/v1/projects?client_id=`, `/api/v1/studies?project_id=`, `/api/v1/locations?study_id=` — all return `{data: T[]}` envelopes, all wrapped by the existing hooks.
- Skill resolution: `GET /api/v1/skills/{id}` via `useSkill(skillId)` → single `Skill` (`.data`). `Skill` already has `location_dependent: boolean` (added in 5-2, `features/skills/types.ts:33`) and `scope: 'project'|'study'|null`.

### Run-button gating (skill-first) — explicit truth table
| Locked skill | Picker state | Run enabled? | Payload |
|---|---|---|---|
| non-LD | Client only | ❌ (no Project) | — |
| non-LD | Client+Project (study empty or chosen) | ✅ | `{}` (context not sent) |
| LD | Client+Project, no Study | ❌ + inline "select a Study" | — |
| LD | +Study, no location chosen | ❌ | — |
| LD | +Study + single location | ✅ | `{location_id}` |
| LD | +Study + "run for all" (≥1 location) | ✅ | `{study_id, fan_out:true}` |
| LD | +Study with 0 locations | ❌ ("run for all" disabled) | — |
Always also gate on `!createInvocation.isPending` and a resolved (non-404) skill.

### Forms / mutations / errors (established conventions)
- No form library (controlled `useState` — 2-5/5-2). Disabled-until-valid + double-submit guard (`if(isPending) return` + `disabled={isPending}`).
- Mutations: **invalidate-on-success / never optimistic** for state-creating actions; don't override `retry` (default no-retry is correct for writes).
- Errors: branch on `error.code` (SCREAMING_SNAKE via `getApiCode`), not message. 401 handled globally — don't re-handle.

### State / store
`useRunStore` (Zustand): `activeJobId`, `runMode`, `setActiveJobId`, `setRunMode`. On skill-first submit success → `setActiveJobId(parent_job_id)` + `setRunMode('skill-first')`. Single `activeJobId` suffices (fan-out returns one parent id); do NOT reshape — 5-4 owns any per-child tracking.

### Testing harness specifics
Vitest + Testing Library + user-event, jsdom, globals on. Co-located `*.test.tsx`. `src/test/setup.ts` resets `cleanup()`/`document.title`/`sessionStorage`. Mock hook modules with `vi.mock` (no MSW). Wrap in `QueryClientProvider` (retry:false) + `MemoryRouter`. `_mockAuthSession('test-token')`. The 5-2 `RunConsole.test.tsx` error-path test (drives `mutate`'s `onError` with `{response:{data:{error:{code:'LOCATION_REQUIRED'}}}}`) is directly reusable. **Add a mock for every hook the skill-first component calls** (missing mock → crash). Watch for render loops (stable memo'd callbacks; reset child selection by setting child id → undefined which auto-idles the gated child query).

### Known carried debt (do NOT fix in 5-3)
`S3IngestConnector.fetch` raises `NotImplementedError`; unbounded multi-file context size; no hybrid tool-result size cap (Epic 3/4 retro carried-debt). These surface at execution time, not at submit. 5-3 only submits invocations + stubs status. Note only.

### Project Structure Notes
- New code stays under `src/features/run/` (`components/HierarchyPickerCascade.tsx` + skill-first branch in `RunConsole.tsx`). Aligns with the architecture's Run feature file map. No backend, no migration, no new dependency (use existing React/Router/Query/Zustand/Tailwind).
- The only file outside `features/run/` you modify: `src/features/skills/components/SkillDetail.tsx` (wire the Run button) + `src/routes/internal.tsx` (new route) + test fixtures. Keep changes additive ("grow in place").

### References
- [Source: epics/epic-5-run-console-invocation-ux.md#Story 5.3] — the 5 skill-first ACs (+5.2/5.4 for shared-shell design).
- [Source: stories/5-2-run-console-context-first-mode.md] — the as-built shell this story extends: `RunConsole.tsx` structure, `LockedContextPanel`/`SkillPickerRow`/`LocationSelector`/`JobStatusPanel`, `handleRun` payload builder + hardcoded `setRunMode('context-first')`, the design-prototype-skip lesson, brand-token anti-drift rule, reuse list.
- [Source: stories/5-1-invocation-api-and-job-polling.md] — invocation/job API contract (POST body, 202 shape, error codes).
- [Source: prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md] — INV-07 (skill-first: skill pre-selected, unrestricted context, run without formal attachment), INV-08 (back to origin), LOC-01..06 (location-dependent selector/fan-out).
- [Source: prds/prd-Velara-2026-05-29/prd/13-design-reference.md] + [Source: architecture/Velara-Architecture-full.md] — `design/` prototype is canonical visual ref; one `RunConsole` for both modes; V3 brand tokens.
- [Source: architecture/implementation-patterns-consistency-rules.md] — envelope, error-code mapping, no-optimistic-for-job-submissions, TanStack key conventions, `staleTime:30s`.
- [Source: stories/4-4-hierarchy-navigation-and-breadcrumb-context.md] — routing (literal-before-dynamic, useActiveTab segment[2], explicit-route back-nav), combobox a11y.
- [Source: stories/2-5-skill-create-and-edit-ui.md] — `<select>` styling, no-form-library, double-submit guard, mutation template.
- Code seams (verified): `src/features/run/components/RunConsole.tsx` (entry ~544, `RunConsoleInner` ~276, skill picker `:424-453`, `handleRun` ~369 / `setRunMode` `:388`, `LocationSelector` `:188-264`, `JobStatusPanel` `:516-540`), `src/features/skills/components/SkillDetail.tsx:210-221` (disabled Run button to wire), `src/routes/internal.tsx:30-35,76-79` (`useActiveTab`, skills routes), `src/features/engagements/hooks/useEngagements.ts:33,40,82,121` (`useClients`/`useProjects`/`useStudies`/`useLocations`), `src/features/skills/hooks/useSkills.ts:12` (`useSkill`), `src/stores/useRunStore.ts` (`runMode`), `src/api/jobs.ts` (`createInvocation`/`InvocationPayload`), `src/shared/utils/errors.ts` (invocation error map), `design/overrides.jsx:96-319` + `design/internal3.jsx:8-86` + `design/app_v3.jsx:80-92` (prototype).

### Review Findings (Code Review — 2026-06-13)

> Reviewed: uncommitted working-tree changes + new untracked files (~2,451 lines, 22 files). Three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). All ACs and the #1 contract truth (no `client_id`/`project_id`/`scope`; correct `{}`/`{location_id}`/`{study_id,fan_out}` payloads) verified satisfied. Note: reviewer line numbers initially reflected a concatenated diff; all findings below re-verified against real source.

**Patch (unchecked — fixable, fix is unambiguous):**

- [x] [Review][Patch] Retired / no-current-version skill is launchable in skill-first (no pre-flight gate) [src/features/run/components/RunConsole.tsx:611-616] — FIXED: added `skillRetired`/`skillNoVersion`/`skillNotRunnable` derived flags; folded `!skillNotRunnable` into `canRun`; render an inline `skillBlockedReason` hint under the locked card so Run is disabled *with* an explanation instead of failing reactively on a 422.
- [x] [Review][Patch] LD skill + Study with 0 locations is a silent dead-end [src/features/run/components/RunConsole.tsx:600-616] — FIXED: `LocationSelector` empty-state copy now explains the study has no locations and that Run stays disabled until locations are added (mirrors the `NO_LOCATIONS_IN_STUDY` mapper copy).
- [x] [Review][Patch] Decorative `▶` glyph leaks into Run buttons' accessible name [src/features/skills/components/SkillDetail.tsx:219, src/features/engagements/components/EngagementsScreen.tsx:988,1078] — FIXED: wrapped each `▶` in `<span aria-hidden="true">` so the accessible name is "Run"; updated `SkillDetail.test.tsx` matcher from `/^▶ run$/i` → `/^run$/i`.
- [x] [Review][Patch] Tautological "Engagements tab stays active" regression test [src/features/run/components/RunConsole.test.tsx] — FIXED: renamed the bare-render test to honestly describe what it asserts; added a genuine active-tab assertion (`toHaveClass('font-bold')` on the Engagements tab at the run route) in `routes/internal.test.tsx`, where real InternalRoutes + NavTabs are mounted.

**Deferred (checked — pre-existing or explicitly out of 5-3 scope):**

- [x] [Review][Defer] `inputs`/`file_ref_ids` never collected or sent — deferred per "5-3 DEFERS" (file-upload / schema-driven inputs → later story). Known, documented gap; not required by any 5-3 AC.
- [x] [Review][Defer] `runMode` written only inside `onSuccess` (stale module-global until first successful submit) [src/features/run/components/RunConsole.tsx:456,655] — no consumer reads `runMode` before 5-4; store reshape is explicitly 5-4's concern. Latent, deferred.
- [x] [Review][Defer] `friendlyInvocationError` could render a non-string `error.message` as `[object Object]` [src/shared/utils/errors.ts:51] — pre-existing in the 5-2 `errors.ts` pattern, not introduced by 5-3; depends on backend always returning a string `message` (Uncertain). Coerce to string in a future hardening pass.
- [x] [Review][Defer] `EngagementsScreen.tsx` (+95 lines) is outside the story File List — verified to be Story 5.2 context-first "Run from engagement" wiring (`onRun` → `engagements/run/...`), captured by the working-tree diff, not new 5.3 behavior. Scope-tracking note, not a defect.

**Dismissed as noise (7):** `useProjectSkills` ignoring `projectId` (documented MOCK SEAM; INV-09 intentionally makes project & study skill lists identical); context-first "missing" double-submit guard (both `canRun` gates already include `!isPending` — no real asymmetry); vanished selected entity still enabling Run (recoverable via server error; requires mid-session delete+refetch); `studyId!` assertion (guarded by `origin==='study'` + `studyName`); redundant `locationList.length > 0` inner guard (harmless dead guard); `mapDetailsToFieldErrors` unguarded `d.loc.length` (array guaranteed by `getApiDetails`; unused by 5-3); route shape deviation from spec recommendation (spec explicitly permits it, documented in Dev Record).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — claude-opus-4-8[1m]

### Debug Log References

- RED/GREEN: `HierarchyPickerCascade.test.tsx` failed (module not found) → implemented component → 8 pass.
- One test fix: AC1 "skill name" assertion hit two matches (locked card + breadcrumb crumb) → switched to `getAllByText(...).length >= 1`.
- All gates run from `velara-web/`: typecheck 0, lint clean, 203 tests pass, build ✓.

### Completion Notes List

- **Story 5.3 (Run Console — Skill-First Mode) implemented frontend-only**, extending the as-built 5-2 shell in place (no rebuild, no backend/migration/dependency changes).
- **Design decision resolved (route placement):** chose `skills/:skillId/run` over the story's recommended `skills/run/:skillId`. Both keep the **Skills** tab active (`useActiveTab` reads path segment `[2]` = `skills`) and both give a trivially-resolvable back target. Picked the `:skillId/run` shape because it nests naturally under the skill (the `skillId` param sits in the same position as `skills/:skillId`), it matched the SkillDetail Run-button navigate snippet in Task 1, and the trailing literal `run` segment is distinct from `edit` so route ordering among `skills/:skillId/*` is unambiguous. The alternative (reuse 5-2's `engagements/run/:origin/:origin` with `origin='skill'`) was rejected — it would light the wrong tab and force `validOrigin`/`entityPath`/context-resolution special-casing.
- **Did NOT fork a second console component.** Refactored the shared two-column frame (breadcrumb + trust chip + left config column + right job-status column) into a `RunShell` wrapper used by both modes. The entry `RunConsole` is a thin dispatcher; `RunConsoleContextFirst` (5-2, unchanged behavior) and `RunConsoleSkillFirstInner` (new) each own their hooks unconditionally so rules-of-hooks hold per route.
- **#1 contract trap avoided (verified by grep):** the invocation POST body carries NO `client_id`/`project_id`/`scope`. Non-LD skill → `{}`; LD single → `{location_id}`; LD run-for-all → `{study_id, fan_out:true}`. The Client→Project→Study selection is real UX but invisible to the wire for non-LD skills.
- **Brand-token discipline (1-6 drift trap):** zero `green-*/amber-*/gray-*/red-*`/hex/`brand-200` in new code (grep-verified). Locked card uses `border-brand-100 bg-brand-50 text-brand-600`; cascade path strip uses `bg-brand-50 border-brand-100`.
- **Deviations from prototype (documented):** (1) the prototype's skill `<select>` and Input/file-dropzone card are out of scope (skill locked; inputs deferred to a later story per 5-3 DEFERS); (2) ported the single-SPA prototype into the routed, hook-driven 5-2 shell. No further deviations.
- **Deferred / known gaps (unchanged from story scope):** real job polling/output/fan-out X-of-N → Story 5-4 (JobStatusPanel stub left as-is); file-upload/schema-driven inputs → not wired (no 5-3 AC needs them; `inputs`/`file_ref_ids` left unsent); RBAC/skill-attachment gating → later epic. Pre-existing `SkillDetail.tsx` transition-error block still uses `red-*` tokens (out of 5-3 scope; noted for a future brand-token sweep).
- **Tests:** +28 net (175 → 203, 0 regressions). New: `HierarchyPickerCascade.test.tsx` (8), `RunConsole.test.tsx` skill-first block (17), `internal.test.tsx` (+3). Updated: `SkillDetail.test.tsx` Run-button test.

### File List

**New:**
- `src/features/run/components/HierarchyPickerCascade.tsx`
- `src/features/run/components/HierarchyPickerCascade.test.tsx`

**Modified:**
- `src/features/run/components/RunConsole.tsx` (skill-first dispatcher + `RunConsoleSkillFirstInner` + `LockedSkillCard` + shared `RunShell`; context-first refactored onto `RunShell`, behavior unchanged)
- `src/features/run/components/RunConsole.test.tsx` (skill-first mode test block + extended mocks)
- `src/features/skills/components/SkillDetail.tsx` (live Run button → skill-first run route)
- `src/features/skills/components/SkillDetail.test.tsx` (Run-button test updated to live/navigates)
- `src/routes/internal.tsx` (new `skills/:skillId/run` route)
- `src/routes/internal.test.tsx` (skill-first route render + Skills-tab-active + title tests; `useCreateInvocation` mock)

## Change Log

| Date       | Change                                                                                          |
|------------|------------------------------------------------------------------------------------------------|
| 2026-06-12 | Story 5.3 implemented: Run Console skill-first mode — wired SkillDetail Run button live to new `skills/:skillId/run` route; made `RunConsole` mode-aware via a shared `RunShell` (no fork); added `LockedSkillCard` + `HierarchyPickerCascade` (editable Client→Project→Study); reused 5-2 `LocationSelector`/`useCreateInvocation`/`JobStatusPanel` stub; skill-first submit sets `setRunMode('skill-first')`; contract-correct payloads (no client_id/project_id). Gates: typecheck 0, lint clean, 203 tests (+28, 0 regressions), build ✓. Status → review. |
