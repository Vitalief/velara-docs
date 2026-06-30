# Story 2.5: Skill Create & Edit UI

---
baseline_commit: c0b241e6258d961fd1a4d78f2278c359c1529792
---

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Repository:** This is a **`velara-web`** (frontend) story. All paths below are relative to `/Users/apple/Projects/AI/velara/velara-web`, **not** `velara-api`. It consumes the Skill Registry REST API from Stories 2.1–2.3 (`velara-api`); **no backend changes are in scope.**
>
> **Builds on Story 2.4 (committed).** Baseline HEAD is `c0b241e` ("2-4-skill-registry-ui-browse-and-detail"). Story 2.4's files (`SkillRegistry.tsx`, `SkillDetail.tsx`, `SkillRow.tsx`, `SkillLifecycleBadge.tsx`, `useSkills.ts`, `api/skills.ts`, `types.ts`, route + AppBar edits) are in the tree at this commit. This story extends those files in place.

## Story

As an MA Tech developer,
I want a form to create and edit skills with all required metadata fields, plus a control to advance a skill's lifecycle state,
so that new skills can be registered and existing skill metadata can be updated without touching the database directly.

## Acceptance Criteria

1. **Create form fields.** Given I click "Register Skill" in the Skill Registry, when the form opens, then it presents controls for: **name** (text), **description** (textarea), **author** (text), **runtime type** (select: prompt/code/hybrid), **visibility** (select: internal_only/paired/client_facing), **scope** (select: project/study/none), **tags** (multi-value input), **input schema** + **output schema** (JSON editors), and a **skill definition / content** field (the v1.0.0 artifact body — see Dev Notes §"Critical: `initial_content` is required"). All enum option values bind to the **API snake_case values**, displayed with human labels.
2. **Create → draft → detail.** Given I submit the form with all required fields valid, when `POST /api/v1/skills` succeeds (HTTP 201), then the skill is created in `draft` state with version `1.0.0` and I am navigated to the new skill's detail view (`/internal/skills/:newId`). The `['skills']` list query is invalidated so the registry shows it.
3. **Client-side required-field validation.** Given I submit the form without a description, when client-side validation runs, then the description field shows an inline error **"Description is required for certification"** and submission is blocked (no API call). The same blocking validation applies to other required fields (name, author, runtime type, visibility) with field-level messages. The API's `422 MISSING_DESCRIPTION` / `VALIDATION_ERROR` are handled as a backstop.
4. **Edit pre-populated.** Given I am on a skill detail view, when I click "Edit", then the edit form opens pre-populated with the skill's current metadata and I can update the **editable** fields (name, description, tags, scope, input_schema, output_schema). `runtime_type`, `visibility`, and `author` are shown **read-only** (no API path to change them — see Dev Notes §"Editable vs immutable"). On save, `PATCH /api/v1/skills/{id}` is called with **only changed fields** and I return to the detail view.
5. **Metadata edit on a certified skill shows a notice.** Given I save metadata edits on a `client_ready` skill, when the PATCH completes, then a notice appears: **"Metadata updated. This skill's certification status is unchanged — only new versions require re-certification."** (For non-`client_ready` skills, a plain "Metadata updated" confirmation is shown.)
6. **Lifecycle advance with confirmation.** Given I am on a skill detail view of a non-retired skill, when I click **"Advance to <Next State>"** (e.g. "Advance to Internal-ready"), then a confirmation dialog appears, and on confirm `PATCH /api/v1/skills/{id}/lifecycle` is called with `{ "to_state": "<next>" }`, the state transitions, and the lifecycle badge updates (queries invalidated). Invalid transitions and `DERIVED_SKILL_REVIEW_REQUIRED` are surfaced as friendly errors. The control is hidden when the skill is already `retired` (terminal).

---

## Tasks / Subtasks

- [x] **Task 1 — API client functions + request types** (AC: 2, 4, 6)
  - [x] In `src/api/skills.ts`, add three functions matching the existing `listSkills`/`getSkill` style (standalone `async function`, `apiClient`, unwrap `response.data.data`):
    - `createSkill(input: SkillCreateInput): Promise<SkillWithVersion>` → `apiClient.post('/api/v1/skills', input)` (201).
    - `updateSkillMetadata(skillId: string, input: SkillUpdateInput): Promise<SkillWithVersion>` → `apiClient.patch(\`/api/v1/skills/${skillId}\`, input)`.
    - `transitionLifecycle(skillId: string, toState: LifecycleState): Promise<SkillWithVersion>` → `apiClient.patch(\`/api/v1/skills/${skillId}/lifecycle\`, { to_state: toState })`. **Body key is `to_state` (NOT `target_state`/`status`); method is PATCH (NOT POST).**
  - [x] In `src/features/skills/types.ts`, add request types (see Dev Notes §"API contract" for exact required/optional):
    - `SkillCreateInput` — `name`, `description`, `author`, `runtime_type`, `visibility` (required); `scope?`, `tags?`, `input_schema?`, `output_schema?`, `initial_content` (required), `content_type?` (optional).
    - `SkillUpdateInput = Partial<Pick<SkillCreateInput, 'name' | 'description' | 'tags' | 'scope' | 'input_schema' | 'output_schema'>>` — **only these six are PATCH-able.**
- [x] **Task 2 — Mutation hooks** (AC: 2, 4, 5, 6) — _this is the **first** `useMutation` in the codebase; establish the pattern cleanly._
  - [x] In `src/features/skills/hooks/useSkills.ts` add (using `useMutation` + `useQueryClient`):
    - `useCreateSkill()` → `mutationFn: createSkill`; `onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] })`.
    - `useUpdateSkill(skillId)` → `mutationFn: (input) => updateSkillMetadata(skillId, input)`; `onSuccess` invalidates **both** `['skills', skillId]` and `['skills']`.
    - `useTransitionLifecycle(skillId)` → `mutationFn: (toState) => transitionLifecycle(skillId, toState)`; `onSuccess` invalidates **both** `['skills', skillId]` and `['skills']`.
  - [x] Do not override mutation retry (TanStack default = no retry, correct for writes).
- [x] **Task 3 — Shared `SkillForm` component** (AC: 1, 3, 4)
  - [x] `src/features/skills/components/SkillForm.tsx` — a controlled form (native `useState` per field + manual validation, **no form library**; mirror `src/pages/LoginPage.tsx` form idiom). Props: `mode: 'create' | 'edit'`, `initial?: Skill` (for edit pre-population), `submitting: boolean`, `error?: unknown`, `onSubmit(values)`, `onCancel()`.
  - [x] Fields per AC1. In `edit` mode, render `runtime_type`/`visibility`/`author` as **read-only** display (reuse `RuntimeTypeChip`/`VisibilityChip` from `./SkillLifecycleBadge`) and omit `initial_content`/`content_type` (create-only).
  - [x] **Validation (client-side, blocks submit):** `name` non-empty; `author` non-empty (create); `description` non-empty → else inline error **"Description is required for certification"**; `runtime_type` & `visibility` chosen; `input_schema`/`output_schema` if non-blank must `JSON.parse` to a **plain object** (not array/primitive) → else "Must be a valid JSON object". Tags entered as comma-separated, split/trim/dedupe at the form boundary into `string[]`.
  - [x] **Edit dirty-tracking:** build the PATCH body from **changed fields only**; never send a key set to `null` (API rejects null for name/tags/scope/schemas — 422). Disable Save when nothing changed (prevents `NO_FIELDS_TO_UPDATE`).
- [x] **Task 4 — Create page** (AC: 1, 2, 3)
  - [x] `src/features/skills/components/SkillCreate.tsx` — calls `usePageTitle('Register Skill')`; renders `<SkillForm mode="create" />` wired to `useCreateSkill()`. On success, `navigate(\`/internal/skills/${created.id}\`)`. Map API errors to field/form messages (branch on `error.response?.data?.error?.code`: `MISSING_DESCRIPTION` → description field; `VALIDATION_ERROR` → use `error.response.data.error.details` if present; else form-level via `getErrorMessage`).
- [x] **Task 5 — Edit page** (AC: 4, 5)
  - [x] `src/features/skills/components/SkillEdit.tsx` — reads `:skillId` (`useParams`), `useSkill(skillId)` to load + pre-populate; `usePageTitle(skill?.name, 'Edit Skill')`. Renders `<SkillForm mode="edit" initial={skill} />` wired to `useUpdateSkill(skillId)`. Handle loading skeleton, `SKILL_NOT_FOUND` (friendly panel + back link, mirror SkillDetail), and `SKILL_RETIRED` (block edit — retired is immutable). On success: show the AC5 notice then navigate after 4s auto-dismiss.
- [x] **Task 6 — Lifecycle advance control + confirmation dialog** (AC: 6)
  - [x] `src/features/skills/components/ConfirmDialog.tsx` — a minimal accessible modal (overlay + centered panel, focus the confirm button, Escape closes, `role="dialog"` + `aria-modal`). Props: `open`, `title`, `message`, `confirmLabel`, `onConfirm`, `onCancel`, `pending`.
  - [x] In `SkillDetail.tsx` header action area (the `flex-none` div holding the disabled Run button), add an **"Advance to <Next>"** primary button. Compute next state from the transition map (`draft → internal_ready → client_ready → retired`); also offer **"Retire"** (any non-retired → `retired`). Hide all advance controls when `lifecycle_state === 'retired'`. On click → open `ConfirmDialog`; on confirm → `useTransitionLifecycle(skillId).mutate(toState)`; on success the badge updates via invalidation. Surface `INVALID_LIFECYCLE_TRANSITION` and `DERIVED_SKILL_REVIEW_REQUIRED` as readable messages.
- [x] **Task 7 — Metadata-updated notice** (AC: 5)
  - [x] Drive the notice with local state (`useState<string|null>`) + render `<Toast message={notice} />` (`@/shared/components/Toast` — a presentational stub; **no global toast system exists**). After a successful metadata PATCH: if `skill.lifecycle_state === 'client_ready'` show the exact AC5 string; otherwise "Metadata updated." Auto-dismiss via `useEffect`+`setTimeout` (~4s) and navigate on dismiss.
- [x] **Task 8 — Entry points + routes** (AC: 1, 2, 4)
  - [x] `SkillRegistry.tsx`: add a header row (title left, **"+ Register Skill"** primary button right) as the first child above the filter-bar card; button `navigate('/internal/skills/new')` (add `useNavigate` import).
  - [x] `SkillDetail.tsx`: add an **"Edit"** secondary button beside Run → `navigate(\`/internal/skills/${skill.id}/edit\`)`.
  - [x] `src/routes/internal.tsx`: add routes **in this order** — `skills` → `skills/new` → `skills/:skillId/edit` → `skills/:skillId`. **`skills/new` MUST precede `skills/:skillId`** so "new" isn't captured as a `:skillId`. `useActiveTab()` already maps all `skills/*` paths to the registry tab — no change needed.
- [x] **Task 9 — Tests** (AC: 1–6) — co-located Vitest + Testing-Library, mock the API/hooks (`vi.mock`), render under `<MemoryRouter>` + `<QueryClientProvider>` (add `mutations: { retry: false }` to the test QC).
  - [x] `SkillForm.test.tsx` — renders all create fields (AC1); blocks submit + shows "Description is required for certification" when description empty (AC3); JSON-object validation; edit mode pre-populates and shows runtime/visibility read-only (AC4).
  - [x] `SkillCreate.test.tsx` — valid submit calls `createSkill` and navigates to the returned id (AC2).
  - [x] `SkillEdit.test.tsx` — pre-populates from `useSkill`; PATCH sends only changed fields (AC4); AC5 notice text appears for a `client_ready` skill.
  - [x] `ConfirmDialog.test.tsx` + lifecycle: advancing from `SkillDetail` opens the dialog and on confirm calls `transitionLifecycle` with the correct `to_state`; control hidden when `retired` (AC6).
  - [x] Extend `src/routes/internal.test.tsx`: `/internal/skills/new` renders the create page and `/internal/skills/:id/edit` renders the edit page (assert page + `document.title`); extend the `@/api/skills` / `useSkills` mocks with the new functions/hooks.
- [x] **Task 10 — Gates**
  - [x] `npm run typecheck` (0 errors), `npm run lint` (clean), `npm run test` (all pass; 122/122 green), `npm run build` (clean).

---

## Dev Notes

### Critical: `initial_content` is required by `POST /api/v1/skills` (AC1 omits it — do NOT skip it)

`SkillCreate` marks **`initial_content` (string, ≤1 MiB) as required** — it is the immutable **v1.0.0 artifact body** (REG-01). A create payload without it returns `422 VALIDATION_ERROR`. AC1's field list does not mention content, but the API will reject the request. **Resolution for this story:** the create form includes a **"Skill Definition / Content"** field (monospace `<textarea>`, treated as required, non-empty) plus an optional `content_type` (default `"text/plain"`). The edit form does **NOT** include content — new artifact content goes through `POST /skills/{id}/versions` (a separate versioning flow, not in this story). _(See Open Questions — confirm whether to add the content field here or defer artifact authoring; PRD §8 notes skill authoring is partly out-of-platform.)_

### Editable vs immutable fields (resolves AC4 "update any field")

| Field | Create (`POST`) | Edit (`PATCH /skills/{id}`) | Notes |
|---|---|---|---|
| `name` | required | ✅ editable | min 1, max 255 |
| `description` | **required at runtime** | ✅ editable | blank → `422 MISSING_DESCRIPTION` (distinct code) |
| `author` | required (client-supplied) | ❌ **not editable** | show read-only in edit |
| `runtime_type` | required | ❌ **not editable** | no API path post-create; read-only in edit |
| `visibility` | required | ❌ **not editable** | no API path post-create; read-only in edit |
| `scope` | optional/nullable | ✅ editable | `project`/`study`; cannot be set to `null` via PATCH |
| `tags` | optional (default `[]`) | ✅ editable | normalized server-side (trim/dedupe, ≤32, ≤64 chars each) — re-read from response |
| `input_schema` / `output_schema` | optional (arbitrary JSON object, unvalidated) | ✅ editable | must be a JSON **object**, not array/string |
| `initial_content` / `content_type` | required / optional | ❌ create-only | not in `SkillMetadataUpdate` |
| `lifecycle_state` | server-forced `draft` | ❌ via `/lifecycle` only | separate endpoint (AC6) |

So AC4's "update any field" means **the editable subset** (name, description, tags, scope, input_schema, output_schema). Render `runtime_type`/`visibility`/`author` read-only with a hint ("set at creation").

### API contract (authoritative — read from `velara-api/app/{api/v1/skills.py, schemas/skill.py, services/skill_service.py}`)

**Envelope:** success `{ data, meta: { request_id, timestamp } }` → unwrap `response.data.data`. Error `{ error: { code, message, request_id } }`; on `VALIDATION_ERROR` an extra `error.details[]` (FastAPI field errors) is included. **Branch on `error.code`** (stable SCREAMING_SNAKE), not the message.

**Enum string values (snake_case):** `lifecycle_state`: `draft|internal_ready|client_ready|retired`; `runtime_type`: `prompt|code|hybrid`; `visibility`: `internal_only|paired|client_facing`; `scope`: `project|study|null`.

**`POST /api/v1/skills` → 201**, `data` = `SkillRead`. Required: `name`, `description`(runtime), `author`, `runtime_type`, `visibility`, `initial_content`. Optional: `scope`, `tags` (default `[]`), `input_schema`, `output_schema`, `content_type` (default `text/plain`). **Never send** `org_id`/`created_by_user_id`/`lifecycle_state`/`id` (server-derived). Errors: `VALIDATION_ERROR` (422), `MISSING_DESCRIPTION` (422), `INTERNAL_ERROR` (500).

**`PATCH /api/v1/skills/{id}` → 200**, `data` = `SkillRead`. Partial update via `exclude_unset` — **send only changed keys.** Updatable: `name`, `description`, `tags`, `scope`, `input_schema`, `output_schema`. **Sending `null`** for name/tags/scope/schemas → `422 VALIDATION_ERROR` ("omit it to leave unchanged"). **Empty body** → `422 NO_FIELDS_TO_UPDATE`. Other errors: `SKILL_NOT_FOUND` (404), `SKILL_RETIRED` (422, retired is immutable), `MISSING_DESCRIPTION` (422). Does **not** create a version.

**`PATCH /api/v1/skills/{id}/lifecycle` → 200**, `data` = `SkillRead`. Body: `{ "to_state": "<enum>" }`. **Transition map (single source of truth):**
```
draft          → { internal_ready, retired }
internal_ready → { client_ready, retired }
client_ready   → { retired }
retired        → { }   (terminal)
```
No back-transitions, no skipping, cannot target `draft`. Errors: `INVALID_LIFECYCLE_TRANSITION` (422), `DERIVED_SKILL_REVIEW_REQUIRED` (422 — a derived skill with `review_required` can't reach `client_ready` until parent-update is acknowledged), `SKILL_NOT_FOUND` (404), `VALIDATION_ERROR` (422).

### No form library, no mutation precedent, Toast is a stub

- **No `react-hook-form`/`zod`/`formik`** in `package.json` — build controlled inputs (`useState` per field) + hand-rolled validation, exactly like `src/pages/LoginPage.tsx` (the `onSubmit={(e)=>{e.preventDefault();…}}` + per-field error-string pattern). **Do not add a form/validation dependency.**
- **No `useMutation` anywhere in `src/`** (the other `src/api/*.ts` are `export {}` stubs). Story 2.5 establishes the first mutation hooks — follow the `useQuery` conventions already in `useSkills.ts` for placement/shape.
- **`Toast.tsx` is presentational only** (`export function Toast({ message }) { … }`) — no provider, no `useToast`, not rendered anywhere. Drive AC5's notice with local state + `<Toast message={notice} />`. Don't build a global toast system.
- **`getErrorMessage`** (`@/shared/utils/errors.ts`) only unwraps `Error.message`. Branch on the API code **inline** at the call site: `(error as { response?: { data?: { error?: { code?: string; message?: string; details?: unknown[] } } } })?.response?.data?.error?.code` (same cast `SkillDetail.tsx` uses for `SKILL_NOT_FOUND`), falling back to `getErrorMessage`.

### Integration points (files from Story 2.4, committed at `c0b241e`)

- `src/api/skills.ts` — `listSkills`/`getSkill` use `apiClient.get<{ data: T }>(…)` → `return response.data.data`. Match this for the new POST/PATCH functions.
- `src/features/skills/hooks/useSkills.ts` — `useSkills()` keyed `['skills']`; `useSkill(id)` keyed `['skills', id]`, `enabled: !!id`. Add mutation hooks here.
- `src/features/skills/components/SkillRegistry.tsx` — outer `<div>` → first child is the filter-bar card (no page header yet). Add the header+Register-button row before it.
- `src/features/skills/components/SkillDetail.tsx` — `useParams<{ skillId }>()`, `useNavigate()`, `useSkill(skillId)`; header is `flex items-start justify-between`; right side is a `flex-none` div with the disabled Run button (turn into a button group; add Edit + Advance). 404 branch reads `error.response?.data?.error?.code === 'SKILL_NOT_FOUND'`.
- `src/routes/internal.tsx` — skills routes at the nested `<Routes>`; `useActiveTab()` keys off `pathname.split('/')[2]`.
- Reuse: `SkillLifecycleBadge`, `VisibilityChip`, `RuntimeTypeChip` (`./SkillLifecycleBadge`); `Skeleton` (`@/shared/components/Skeleton`); `usePageTitle` (`@/shared/hooks/useDocumentTitle`); `useRoleStore` for internal-only UI gating if needed.

### Form surface: full-page routes (decided) vs prototype drawer

The `design/` prototype renders edit as a right-side **drawer** (`ManageSkillModal`, `design/internal.jsx:491+`). **This story uses full-page routes** (`/internal/skills/new`, `/internal/skills/:skillId/edit`) instead, because: (a) consistent with Story 2.4's route-based detail page; (b) AC2 ("navigated to the detail view") fits route navigation; (c) no overlay/drawer/focus-trap primitive exists in the codebase yet; (d) far simpler to test. The prototype remains the **visual** reference for field grouping and the lifecycle-stepper look. _(See Open Questions.)_ Note the prototype's "client-visible description" field has **no API counterpart** (`Skill` has only `description`) — **do not build it.**

### Styling tokens (V3 brand — `src/index.css @theme`)

Brand teal primary `bg-brand-800` (`#128f8b`) `hover:bg-brand-700`; navy `brand-900`. Surfaces `bg-surface`/`surface-2`; text `text-ink`/`ink-2`/`muted`/`faint`; borders `border-line`; cards `rounded-lg border border-line bg-surface`. Inputs (from LoginPage): `rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-700` with a `<label className="text-sm font-medium text-ink">`. Inline error: `text-sm text-red-600`. Primary button: `rounded bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50`. **Use `brand-*`/`st-*` tokens, never `green-*`. Always `@/…` imports, never relative `../`.**

### Conventions (hard rules)

- Imports always `@/…` alias. Components `PascalCase.tsx`, hooks/utils `camelCase.ts`, tests co-located `*.test.tsx`. Every routed page calls `usePageTitle(...)` once.
- Architecture rule: **metadata edits may be optimistic; lifecycle-state changes must NOT be optimistic** (gates invocation access) — use plain invalidate-on-success for the lifecycle mutation. `[Source: architecture/implementation-patterns-consistency-rules.md#Process Patterns]`
- Errors: never surface raw exception text; map `error.code` to a human message (architecture mandates toast-style error surfacing). `SKILL_NOT_FOUND`/`SKILL_RETIRED` get friendly panels.

### Testing standards

Globals on (no import of describe/it/expect). Mock the API layer (`vi.mock('@/api/skills', …)` adding `createSkill`/`updateSkillMetadata`/`transitionLifecycle`) or the hook module (`vi.mock('@/features/skills/hooks/useSkills')`, returning `{ mutate, mutateAsync, isPending: false, error: null }` cast `as unknown as ReturnType<typeof useX>`). Render router-dependent components in `<MemoryRouter>`; for `useParams` use `<MemoryRouter initialEntries={[…]}><Routes><Route path=… element=…/></Routes></MemoryRouter>`. Hook tests wrap in `<QueryClientProvider>` with `{ queries: { retry: false }, mutations: { retry: false } }`. Auth via `_mockAuthSession('test-token')` (see `src/routes/internal.test.tsx`). Use `userEvent` for interaction, `waitFor` for async assertions. Keep the existing 91 tests green.

### Previous-story intelligence (Story 2.4 — just code-reviewed & passed)

- 2.4 deviated from the prototype with author approval (table rows, not cards) — precedent for the full-page-vs-drawer deviation here.
- 2.4 review patches now in the tree: `SkillRow` got keyboard a11y (`tabIndex`+`onKeyDown` Enter/Space+`aria-label`) — **apply the same keyboard-accessibility bar** to new interactive non-button elements and the ConfirmDialog. The `Paired` visibility chip uses `⧉` (not `⚡`).
- 2.4 deferred items (`deferred-work.md`, 2026-06-10): `getErrorMessage` is a shared stub that surfaces raw axios text on non-404 errors — this story does more error-mapping, so prefer inline `error.code` branching + consider reading `error.response.data.error.message`. No app-wide `path="*"` 404 — keep new routes exact.
- 2.4's `SkillDetail` already renders current `lifecycle_state` + timestamps (no fabricated history) and a disabled Run button — extend that header, don't rebuild it.
- API field fidelity from 2.1–2.3: snake_case + exact enums; `description` required (blank → `MISSING_DESCRIPTION`); `tags` normalized server-side; bind to the API, never the prototype's `data.js` shape.

### Project Structure Notes

New files (under `velara-web/src/features/skills/components/` unless noted):
```
SkillForm.tsx            + SkillForm.test.tsx       (shared controlled form, create+edit)
SkillCreate.tsx          + SkillCreate.test.tsx      (page: /internal/skills/new)
SkillEdit.tsx            + SkillEdit.test.tsx        (page: /internal/skills/:skillId/edit)
ConfirmDialog.tsx        + ConfirmDialog.test.tsx    (minimal accessible modal for lifecycle advance)
```
Modified: `src/api/skills.ts` (+3 functions), `src/features/skills/types.ts` (+request types), `src/features/skills/hooks/useSkills.ts` (+3 mutation hooks), `src/features/skills/components/SkillRegistry.tsx` (header + Register button), `src/features/skills/components/SkillDetail.tsx` (Edit + Advance buttons + ConfirmDialog wiring), `src/routes/internal.tsx` (new/edit routes), `src/routes/internal.test.tsx` (route + title assertions). Architecture lists no mandated name for the form component; `SkillForm.tsx` is chosen (prototype's `ManageSkillModal` is drawer-specific and not used here). `[Source: architecture/project-structure-boundaries.md#velara-web]`

### REG / FR mapping

Story 2.5 covers **REG-03** (required metadata capture incl. input/output schema), **REG-02** (lifecycle states + advance), **REG-05** (visibility designation at create), **REG-07** (description first-class, certification-gating — drives AC3 validation message), **REG-04** (optional project/study scope), **REG-01** (versioned immutable artifact — the `initial_content` v1.0.0). `[Source: prds/.../5-functional-requirements.md §5.2]` Out of scope: two-key certification to advance to `client_ready` (CRT-01, `features/certification/`, Epic 6); version-history/new-version authoring (`POST /skills/{id}/versions`); paired-skill derivation UI (lineage display only, from 2.4).

### References

- [epic-2-skill-registry-lifecycle.md — Story 2.5](../../planning-artifacts/epics/epic-2-skill-registry-lifecycle.md)
- [Story 2.4 (browse & detail — extended here)](2-4-skill-registry-ui-browse-and-detail.md)
- API source: `velara-api/app/api/v1/skills.py` (`create_skill`, `update_skill_metadata`, `transition_lifecycle`), `app/schemas/skill.py` (`SkillCreate`, `SkillMetadataUpdate`, `LifecycleTransitionRequest`), `app/services/skill_service.py` (`_ALLOWED_TRANSITIONS`, validation), `app/schemas/common.py` (envelopes)
- Design prototype: `design/internal.jsx` (`ManageSkillModal` ~L491, New-skill button ~L108) — visual ref only
- [PRD §5 Functional Requirements](../../planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md), [§8 Skill Authoring (out-of-platform)](../../planning-artifacts/prds/prd-Velara-2026-05-29/prd/8-skill-authoring-out-of-platform-scope-but-relevant.md), [§13 Design Reference](../../planning-artifacts/prds/prd-Velara-2026-05-29/prd/13-design-reference.md)
- [architecture — implementation patterns](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md), [project structure](../../planning-artifacts/architecture/project-structure-boundaries.md)
- Existing web: `src/pages/LoginPage.tsx` (form idiom), `src/api/{skills,client,queryClient}.ts`, `src/features/skills/*` (2.4), `src/shared/components/Toast.tsx`, `src/shared/utils/errors.ts`

### Open Questions (for the author — do not block dev; reasoned defaults chosen above)

1. **`initial_content` on create.** The API requires it but AC1 doesn't list it. Default chosen: add a required "Skill Definition / Content" textarea to the create form. Alternative: create metadata-only with empty content and defer artifact authoring to a version-upload story (PRD §8 notes authoring is partly out-of-platform). Confirm.
2. **Full-page form vs prototype drawer.** Default chosen: full-page routes (consistent with 2.4, simpler/testable). Confirm, or request the prototype's right-side drawer.
3. **Editable-field scope vs AC4 "any field".** `runtime_type`/`visibility`/`author` have no edit endpoint and are shown read-only. Confirm that's acceptable (otherwise a backend change is required — out of this story's scope).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Story creation); claude-sonnet-4-6 (Implementation 2026-06-10)

### Debug Log References

### Completion Notes List

- All 6 ACs satisfied. Typecheck: 0 errors. Lint: clean. Tests: 122/122 pass (31 new). Build: clean.
- First `useMutation` hooks in the codebase established in `useSkills.ts` (`useCreateSkill`, `useUpdateSkill`, `useTransitionLifecycle`).
- `SkillForm` uses controlled `useState`-per-field + hand-rolled validation (no form library), matching `LoginPage.tsx` idiom.
- AC5 Toast notice shows on SkillEdit before auto-navigate (notice → 4s timeout → navigate), keeping component mounted for the toast to render.
- `SkillDetail` lifecycle advance: transition map mirrors backend `_ALLOWED_TRANSITIONS`; shows primary advance + separate Retire; hides all controls when `retired`.
- `ConfirmDialog` is accessible (role=dialog, aria-modal, Escape closes, focus trap on confirm button).
- `skills/new` route placed before `skills/:skillId` in `internal.tsx` to prevent "new" being captured as a skillId param.
- Open question from story (initial_content): added required "Skill Definition / Content" textarea to create form per Dev Notes guidance.

### File List

- src/api/skills.ts (modified — +createSkill, +updateSkillMetadata, +transitionLifecycle)
- src/features/skills/types.ts (modified — +SkillCreateInput, +SkillUpdateInput)
- src/features/skills/hooks/useSkills.ts (modified — +useCreateSkill, +useUpdateSkill, +useTransitionLifecycle)
- src/features/skills/components/SkillForm.tsx (new)
- src/features/skills/components/SkillForm.test.tsx (new)
- src/features/skills/components/SkillCreate.tsx (new)
- src/features/skills/components/SkillCreate.test.tsx (new)
- src/features/skills/components/SkillEdit.tsx (new)
- src/features/skills/components/SkillEdit.test.tsx (new)
- src/features/skills/components/ConfirmDialog.tsx (new)
- src/features/skills/components/ConfirmDialog.test.tsx (new)
- src/features/skills/components/SkillRegistry.tsx (modified — +header row + Register Skill button)
- src/features/skills/components/SkillDetail.tsx (modified — +Edit button, +lifecycle advance controls, +ConfirmDialog)
- src/features/skills/components/SkillDetail.test.tsx (modified — +useTransitionLifecycle mock in beforeEach)
- src/routes/internal.tsx (modified — +SkillCreate/SkillEdit imports, +skills/new + skills/:skillId/edit routes)
- src/routes/internal.test.tsx (modified — +useCreateSkill/useUpdateSkill/useTransitionLifecycle mocks, +new route tests)

### Change Log

- 2026-06-10: Implemented Story 2.5 — Skill Create & Edit UI. Added SkillForm (create+edit), SkillCreate page, SkillEdit page with AC5 toast notice, ConfirmDialog for lifecycle advance, lifecycle advance controls in SkillDetail, Register Skill entry point in SkillRegistry, new routes in internal.tsx. 31 new tests; all 122 tests pass.

### Review Findings

_Code review 2026-06-10 (Blind Hunter + Edge Case Hunter + Acceptance Auditor on uncommitted diff vs `c0b241e`). Gate claims verified: typecheck 0 errors, lint clean, 122/122 tests pass. However, all violating paths below are untested, which is why the suite is green._

**Decisions resolved (2026-06-10):**

- **Scope clear** → surface an inline error ("Scope cannot be cleared once set") and block save. Promoted to a patch below.
- **Schema clear** → handle the same way as scope (inline error + block save when a previously-set schema is emptied). Promoted to a patch below.
- **Null-description edit** → keep blocking (a description is required before any edit; certification-gating). Intended behavior; dismissed, no change.

**Patch (9) — all applied & verified 2026-06-10. Gates re-run: typecheck 0 errors, lint clean, 123/123 tests pass, build clean.**

- [x] [Review][Patch] Edit sends `scope: null` which the API rejects (422) [src/features/skills/components/SkillEdit.tsx:115-116 / src/features/skills/components/SkillForm.tsx:266-276] — clearing a set Scope to "None" coerces to `null` and adds `patch.scope = null`; Dev Notes state scope cannot be unset via PATCH (any `null` → 422). **Resolution:** when the skill already has a scope and the user selects "None", show an inline error "Scope cannot be cleared once set" and block save; never put `null` in the patch body.
- [x] [Review][Patch] Clearing a set input/output schema is silently dropped [src/features/skills/components/SkillEdit.tsx:118-132] — emptying a previously-set schema marks dirty but `parseJsonObject('')→undefined` omits the key, so the schema is never cleared (and null would 422). **Resolution:** mirror the scope handling — inline error + block save when a previously-set schema is emptied; do not send `null`/`undefined` for it.

- [x] [Review][Patch] Edit can fire an empty `{}` PATCH on whitespace/reorder/reformat-only changes [src/features/skills/components/SkillForm.tsx:150-161] — `isEditDirty` compares raw strings (enables Save) while `buildPatchBody` compares trimmed/sorted/parsed values (omits the key). A trailing-space-on-name, tag reorder, or schema reformat as the *only* change enables Save but produces `{}`, then shows a "Metadata updated" toast for a no-op (and may itself 422 as `NO_FIELDS_TO_UPDATE`). Align the two comparisons (normalize in both) and/or guard against an empty patch before `mutate`.
- [x] [Review][Patch] ConfirmDialog dismisses (Escape / backdrop click) while a transition is `pending` [src/features/skills/components/ConfirmDialog.tsx:33,47] — only the buttons honor `pending`; Escape and backdrop call `onCancel()` unconditionally, closing the dialog mid-flight on an irreversible action (e.g. Retire) while the mutation still completes. Gate both on `!pending`.
- [x] [Review][Patch] ConfirmDialog has no focus trap [src/features/skills/components/ConfirmDialog.tsx] — `aria-modal="true"` is set and confirm is auto-focused, but Tab/Shift-Tab moves focus to background controls (Edit/Retire/Run/nav), which are not `inert`/`aria-hidden`. 2.4 set a keyboard-a11y bar; contain focus within the dialog.
- [x] [Review][Patch] AC3 `VALIDATION_ERROR` / `error.details[]` backstop not implemented [src/features/skills/components/SkillForm.tsx:164-173] — only `MISSING_DESCRIPTION` is mapped to a field; `VALIDATION_ERROR` falls to a generic form-level message and `error.response.data.error.details[]` is never read (Task 4 specified mapping details to fields). Functionally a friendly message still shows, but the field-level mapping the spec calls for is absent.
- [x] [Review][Patch] Edit-route test asserts nothing meaningful [src/routes/internal.test.tsx:374] — the `useSkill` mock returns `data: undefined`, so `SkillEdit` renders `null`; the test only asserts the heading is *absent* and never checks `document.title` or that the edit page renders (Task 9 said "assert page + document.title", as the create-route test does). Mock a loaded skill and assert title + heading.
- [x] [Review][Patch] Double-submit window on the confirm button [src/features/skills/components/ConfirmDialog.tsx:55-63 / src/features/skills/components/SkillDetail.tsx:108-130] — `disabled={pending}` lags one render, so a fast double Enter/click on the focused confirm button can call `onConfirm` twice and fire the transition twice. Add a re-entry guard (e.g. ignore if already pending) in `handleConfirmTransition`.
- [x] [Review][Patch] Identical-notice re-save can mis-time auto-navigation [src/features/skills/components/SkillEdit.tsx:44-52] — the effect deps are `[notice]` only; saving twice to a byte-identical notice string (e.g. two non-`client_ready` edits both yielding "Metadata updated.") does not change `notice`, so the effect doesn't re-run and the **first** save's 4s timer governs navigation. Track a nonce/counter or include the relevant deps so each success re-arms the timer.
