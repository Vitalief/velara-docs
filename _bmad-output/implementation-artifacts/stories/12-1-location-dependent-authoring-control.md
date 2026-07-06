---
baseline_commit: f1b863c21b0f1f7e1c38aa3d1f94824f548f0191
---

# Story 12.1: Location-Dependent Authoring Control

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer,
I want a "location-dependent" toggle in the skill create/edit form,
so that I can mark a skill site-specific without making a direct API call.

## Acceptance Criteria

1. **AC1 — Toggle present; create & edit send it.**
   **Given** the skill create/edit form
   **When** it renders
   **Then** a `location_dependent` toggle is present; create and edit send the field; the backend already accepts it (**no backend change**).

2. **AC2 — Edit reflects and round-trips the current value.**
   **Given** an existing location-dependent skill
   **When** I open it in the edit form
   **Then** the toggle reflects its current value, and clearing/setting it patches correctly (a bare toggle change alone must enable Save and produce a valid PATCH body).

3. **AC3 — End-to-end proof through the Run Console.**
   **Given** a location-dependent skill created via the toggle
   **When** it is invoked in the Run Console
   **Then** the existing location-prompt / fan-out behavior fires — proving the toggle wires end-to-end. (This behavior already exists and consumes `skill.location_dependent`; this AC is verified, not built.)

## Tasks / Subtasks

- [ ] **Task 1 — Add `location_dependent` to the FE input contracts (AC1, AC2)**
  - [ ] In [types.ts](../../../velara-web/src/features/skills/types.ts#L3-L16), add `location_dependent?: boolean` to `SkillCreateInput`.
  - [ ] In [types.ts](../../../velara-web/src/features/skills/types.ts#L18-L30), add `'location_dependent'` to the `Pick<>` list in `SkillUpdateInput`. **Do NOT redefine `Skill`** — it already has `location_dependent: boolean` at [types.ts:47](../../../velara-web/src/features/skills/types.ts#L47).
  - [ ] Do **not** touch [api/skills.ts](../../../velara-web/src/api/skills.ts) — `createSkill`/`updateSkillMetadata` POST/PATCH the input object verbatim (`apiClient.post('/api/v1/skills', input)`), so the new field reaches the backend once the input types include it and the components populate it.

- [ ] **Task 2 — Render the toggle in `SkillForm` and wire form state (AC1, AC2)**
  - [ ] In [SkillForm.tsx](../../../velara-web/src/features/skills/components/SkillForm.tsx), add `location_dependent: boolean` to the `FormFields` interface ([lines 75-88](../../../velara-web/src/features/skills/components/SkillForm.tsx#L75-L88)).
  - [ ] Initialize it in the `useState<FormFields>` default ([lines 185-198](../../../velara-web/src/features/skills/components/SkillForm.tsx#L185-L198)): `location_dependent: initial?.location_dependent ?? false`.
  - [ ] Render a checkbox control (a labelled `<input type="checkbox">`) in **both** create and edit modes. It is a boolean, not an enum — do **not** use the `<select>` pattern. Place it near Scope (it is conceptually a runtime-behavior flag). Include a short helper line: *"Site-specific: must be run with a location or fan-out across a study."*
  - [ ] The `set(key, value)` helper is typed `string | Scope` ([line 215](../../../velara-web/src/features/skills/components/SkillForm.tsx#L215)); a checkbox produces a `boolean`. Either widen `set`'s value type to include `boolean`, or update `location_dependent` with a small dedicated `setFields` call (`setFields(prev => ({ ...prev, location_dependent: e.target.checked }))`). Prefer widening `set` so all fields stay uniform. **Verify tsc after this change** — the union type is the one tsc trap in this story.

- [ ] **Task 3 — Include the toggle in edit-mode dirty tracking + PATCH body (AC2)**
  - [ ] Add `location_dependent` to `isEditDirty` in [SkillForm.tsx](../../../velara-web/src/features/skills/components/SkillForm.tsx#L234-L243): `|| fields.location_dependent !== (initial?.location_dependent ?? false)`. Without this, a toggle-only change leaves Save disabled and AC2 fails.
  - [ ] In [SkillEdit.tsx `buildPatchBody`](../../../velara-web/src/features/skills/components/SkillEdit.tsx#L106-L152), add: `if (values.location_dependent !== skill!.location_dependent) patch.location_dependent = values.location_dependent`. It is a plain boolean — no clear-guard needed (unlike scope/schemas). **Never send `null`** for it: the PATCH schema rejects explicit `null` (see Dev Notes §Backend guard), and the empty-body guard at [SkillEdit.tsx:158-163](../../../velara-web/src/features/skills/components/SkillEdit.tsx#L158) already protects against a no-op PATCH.

- [ ] **Task 4 — Populate `location_dependent` in the create submit path (AC1)**
  - [ ] In [SkillCreate.tsx `handleSubmit`](../../../velara-web/src/features/skills/components/SkillCreate.tsx#L34-L48), add `location_dependent: values.location_dependent` to the `SkillCreateInput` object. (Omitting it is technically safe — backend defaults to `false` — but send it explicitly so the toggle is honored when set.)

- [ ] **Task 5 — Tests (AC1, AC2)**
  - [ ] In [SkillForm.test.tsx](../../../velara-web/src/features/skills/components/SkillForm.test.tsx): add a create-mode assertion that the toggle renders and, when checked, `onSubmit` is called with `expect.objectContaining({ location_dependent: true })` (mirror the existing `output_format: 'pdf'` submit test at [lines 50-80](../../../velara-web/src/features/skills/components/SkillForm.test.tsx#L50-L80)).
  - [ ] Add an edit-mode assertion: mount with a `location_dependent: true` skill, confirm the checkbox is checked; toggle it off and confirm Save becomes enabled (mirror the "enables Save when a field is changed" test at [lines 173-181](../../../velara-web/src/features/skills/components/SkillForm.test.tsx#L173-L181)).
  - [ ] **REGRESSION TRAP:** the edit-mode test at [SkillForm.test.tsx:133-135](../../../velara-web/src/features/skills/components/SkillForm.test.tsx#L133-L135) asserts `selects.length === 3`. A checkbox is **not** a `combobox`, so this count stays 3 and must **not** be changed. If you (wrongly) implement the toggle as a `<select>`, this assertion breaks — that is the signal you used the wrong control.
  - [ ] [SkillCreate.test.tsx](../../../velara-web/src/features/skills/components/SkillCreate.test.tsx#L89) already asserts the submit payload with `toHaveBeenCalledWith(expect.objectContaining({…}))` (partial match) — adding `location_dependent` to the payload will **not** break it, and the mocked `createSkill` return already carries `location_dependent: false`. So **no edit is required here**; optionally add `location_dependent: false` to that `objectContaining` to lock in the default-when-unchecked path.

- [ ] **Task 6 — Verify AC3 end-to-end (no code; verification only)**
  - [ ] Confirm the Run Console already consumes the flag: the "Location-dependent" pin chip at [RunConsole.tsx:134](../../../velara-web/src/features/run/components/RunConsole.tsx#L134), and the location-selector / fan-out gating at [RunConsole.tsx:377](../../../velara-web/src/features/run/components/RunConsole.tsx#L377), [:396](../../../velara-web/src/features/run/components/RunConsole.tsx#L396), [:603](../../../velara-web/src/features/run/components/RunConsole.tsx#L603). No change needed here — this is the AC3 proof surface. Document in Completion Notes that AC3 is satisfied by existing behavior.

- [ ] **Task 7 — Gates**
  - [ ] `tsc --noEmit` → 0 errors (watch the `set()` union-type change from Task 2).
  - [ ] `eslint` → clean (a single pre-existing `Icon.tsx` react-refresh warning is the known baseline — not introduced here).
  - [ ] `vitest` → all pass, including the `selects.length === 3` assertion **unchanged**.

## Dev Notes

### Scope reality — this is a PURE FRONTEND form gap

The `location_dependent` field is **fully wired end-to-end in the backend and already consumed by the Run Console.** The only gap is that the authoring form never exposed it. This story adds the toggle and threads it through the two FE input types and the create/edit submit paths. **No backend, no migration, no Terraform, no api-client change.**
[Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.1; sprint-change-proposal-2026-07-06.md#G4 / Story-12.1 / §REG-10]

### Backend contract — VERIFIED (do NOT modify velara-api)

Subagent-verified against `velara-api` with exact citations:

- **Model column** — `app/models/skill.py:65-67`: `location_dependent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))`. NOT nullable; defaults `false`. Added by migration `0012_location_fan_out.py`.
- **CREATE schema** — `app/schemas/skill.py:179`: `location_dependent: bool = False` on class `SkillCreate`. Omitting it defaults to `False`.
- **UPDATE schema** — `app/schemas/skill.py:368`: `location_dependent: bool | None = None` on class **`SkillMetadataUpdate`** (the PATCH body). Route applies `body.model_dump(exclude_unset=True)` at `app/api/v1/skills.py:324`, so an omitted key is left unchanged.
  - ⚠️ **Explicit-null guard:** `location_dependent` is in `_PATCH_NULL_REJECTED` (`skill.py:339`); sending `"location_dependent": null` → **422**. Sending `true`/`false` is fine. → **The FE must never PATCH this field as `null`; only send a concrete boolean when it changed.** (Task 3 already does this.)
- **READ schema** — `app/schemas/skill.py:239`: `location_dependent: bool` on `SkillRead` (required in every response; inherited by list + detail). This is why the FE `Skill` type already has it.
- **Service** — `create_skill` persists it (`skill_service.py:341`); `update_skill_metadata` applies patched fields generically via `setattr` (`skill_service.py:774-775`) — no special-casing for `location_dependent`. The service's only guarded field is `visibility` (paired-lineage), which does **not** apply here.
- **Routes** — POST passes `location_dependent=body.location_dependent` (`skills.py:76`); PATCH forwards it via `exclude_unset` fields (`skills.py:324-333`).
- **Wire field name** — `location_dependent` in all three (create/update/read); no Pydantic alias, so the JSON key equals the field name verbatim. snake_case per the API convention. [Source: architecture/implementation-patterns-consistency-rules.md#Format-Patterns — "JSON fields: snake_case in all request/response bodies"]

### AC3 consumer — the end-to-end behavior already exists (Story 3.7)

When `skill.location_dependent` is true, `_queue_invocation` in `app/api/v1/invocations.py:204` requires exactly one of `location_id` or `fan_out=true` (else 422 `LocationRequiredError`/`AmbiguousLocationError`); `fan_out=true` triggers a study fan-out (one child job per location via `execution_service.dispatch_fan_out`). When false, those fields are ignored and a single org/engagement job runs.

The **frontend** side of that behavior is already in the Run Console and keys on the same flag:
- `RunConsole.tsx:134` — renders the "Location-dependent" pin chip.
- `RunConsole.tsx:377` — `showLocationSelector = !!selectedSkill?.location_dependent && origin === 'study'`.
- `RunConsole.tsx:396` — `locationDependentNoStudy` guard for project-scope.
- `RunConsole.tsx:603` — `isLocationDependent` gating.

So marking a skill location-dependent via the new toggle immediately changes how it behaves in the Run Console — **that is AC3, and it requires no new code.** [Source: story 3-7-location-dependent-skill-fan-out.md]

### Source tree — files to touch (all in `velara-web/src`)

| File | Change | Why |
|------|--------|-----|
| `features/skills/types.ts` | Add field to `SkillCreateInput`; add key to `SkillUpdateInput` Pick | Input contracts omit it today |
| `features/skills/components/SkillForm.tsx` | `FormFields` field + state init + checkbox render (both modes) + `isEditDirty` term + `set()` type widen | The form gap itself |
| `features/skills/components/SkillCreate.tsx` | Add `location_dependent` to the `SkillCreateInput` in `handleSubmit` | Create submit path |
| `features/skills/components/SkillEdit.tsx` | Add the field to `buildPatchBody` | Edit PATCH path |
| `features/skills/components/SkillForm.test.tsx` | New create + edit assertions; keep `selects.length===3` | Coverage + regression guard |
| `features/skills/components/SkillCreate.test.tsx` | Update payload assertion if strict | Avoid strict-match break |

**Do NOT touch:** `api/skills.ts` (passes input verbatim), any `velara-api` file, `RunConsole.tsx` (already consumes the flag), `clientPortal.ts` / `skillAttachments.ts` / `AccessControl.tsx` (they read `location_dependent` on already-typed `Skill`, unaffected).

### UI convention constraints (house rules)

- **No emoji / unicode icons.** Use `<Icon name="..." />` from `src/shared/components/Icon.tsx` if you add any glyph (e.g. a `pin` icon beside the label, matching the Run Console chip). A plain checkbox needs no icon; do not introduce ✅/☑ characters. [Source: project memory — No Emoji Icons rule; verified by RunConsole using `<Icon name="pin" />`]
- **Styling tokens.** Reuse the form's existing `inputCls`/`labelCls`/`errorCls` and the `Field` wrapper idiom already in `SkillForm.tsx` ([lines 5-28](../../../velara-web/src/features/skills/components/SkillForm.tsx#L5-L28)). Note `Field` renders `label → children → error` stacked; a checkbox reads better as an inline `<label><input type="checkbox" …/> Location-dependent</label>` with the helper line below, rather than forced through `Field`. Match the surrounding Tailwind-v4 token classes (`text-ink`, `border-line`, `bg-surface`, `text-brand-700`) — do not hardcode colors.
- **No reusable Toggle/Switch component exists** in the repo (searched — none). Build a plain accessible checkbox; do not add a new shared component for one control.

### Pattern to mirror — the `output_format` / `visibility` editable-field precedent (2026-07-02)

This is the exact same shape of change made when `output_format` and `visibility` were made editable: field added to `FormFields`, initialized from `initial?`, rendered in both modes, added to `isEditDirty`, added to `buildPatchBody` only-when-changed, and covered by a "submits the chosen value" create test + an edit dirty test. Follow that precedent line-for-line — `location_dependent` is simpler because it is a boolean with no clear-guard. [Source: SkillForm.tsx comments at lines 335-337 & 364-365; SkillEdit.tsx:141-149; project memory — Skill output_format Editable]

### Testing standards

- Vitest + Testing Library, co-located `*.test.tsx` beside the component. [Source: architecture/implementation-patterns-consistency-rules.md#Structure-Patterns — "Tests are co-located"]
- Query the checkbox by its label text/role (`getByRole('checkbox', { name: /location-dependent/i })`), not by index — index-based `getAllByRole('combobox')` is only for the selects.
- Assert submit payloads with `expect.objectContaining({ location_dependent: … })` (partial match) rather than a full object equality, matching the existing `output_format` test style.

### Project Structure Notes

- All changes land under the `velara-web/src/features/skills/` feature folder plus its `types.ts` — consistent with the one-directory-per-domain structure. No new files, no new folders, no route changes. [Source: architecture/implementation-patterns-consistency-rules.md#Structure-Patterns]
- The FE `Skill` model already carries `location_dependent` (added when the Run Console started consuming it), so **no read-model or fixture churn** is required for existing tests — every fixture already sets `location_dependent: false`.

### Sequencing / dependencies

- **First story of Epic 12** — `epic-12` flips `backlog → in-progress` when this story is created (handled in sprint-status update).
- **Independent of Epic 11** — no dependency on any Epic 11 architecture/ADR. Can ship on its own cadence. Suggested Epic 12 order: 12.1 (this, trivial) → 12.2 → 12.3 → 12.4. [Source: epics/epic-12…md; sprint-change-proposal-2026-07-06.md §Sequencing]

### References

- [Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.1] — story, ACs, "pure frontend form gap" reality note.
- [Source: planning-artifacts/sprint-change-proposal-2026-07-06.md#G4] — root-cause (backend fully wired, FE omits) and §REG-10 FR, §Story-12.1, §Solution-slice G4.
- [Source: architecture/implementation-patterns-consistency-rules.md] — snake_case JSON fields, co-located tests, feature-folder structure, TS naming.
- [Source: velara-api app/models/skill.py:65 / app/schemas/skill.py:179,239,339,368 / app/api/v1/skills.py:76,324 / app/services/skill_service.py:341,774] — verified backend contract (read-only; do not modify).
- [Source: velara-web src/features/skills/types.ts, components/SkillForm.tsx, SkillCreate.tsx, SkillEdit.tsx, SkillForm.test.tsx; src/api/skills.ts; src/features/run/components/RunConsole.tsx:134,377,396,603] — FE gap surface + AC3 consumer.
- [Source: project memory] — No Emoji Icons (use `<Icon>`); Skill output_format Editable (the precedent pattern for adding an editable field via PATCH).

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
