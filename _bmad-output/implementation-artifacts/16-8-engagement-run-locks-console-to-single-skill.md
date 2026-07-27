---
baseline_commit: velara-api unaffected (this story has zero backend surface); velara-web on branch
  `development` (head `efcd6d1`, Story 16.6) with a CLEAN working tree. Story 16.7 (also FE-only,
  also touches `RunConsole.tsx`) is `ready-for-dev` but NOT yet implemented as of this story's
  drafting — HEAD is still exactly 16.6. Verify with `git status` in `velara-web` before starting;
  if 16.7 has landed by the time you pick this up, its diff is in a different function
  (`JobStatusPanel`, ~line 1123+) than this story's (`RunConsoleInner`'s skill-picker block,
  ~line 670-696) — expect a clean merge, not a conflict (see Trap 5 in 16.7's own Dev Notes).
---

# Story 16.8: Engagement-Screen "Run" Opens the Console Locked to That One Skill

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want clicking "Run" on a specific skill from a Project or Study screen to open the Run Console
showing only that skill,
so that I'm running the skill I clicked, not re-picking it from the full list of everything
attached in that context.

## ⚠️ SCOPE — read this first

**FRONTEND ONLY (`velara-web`). Zero backend/schema surface.** Independent of 16.1-16.7. This is a
deployed-dev UX fix against `RunConsole.tsx`'s context-first mode (`RunConsoleInner`) — skill-first
mode (`RunConsoleSkillFirstInner`, launched from `/internal/skills/:skillId/run`) already does the
right thing and is **not touched** by this story.

**Root cause (confirmed by source analysis, not speculation):** every "Run" button on an
Project/Study engagement screen already passes a specific skill id — `EngagementsScreen.tsx:1840-1842`
(`onRun`) navigates to `/internal/engagements/run/{origin}/{originId}?skillId=...`, and both call
sites (`EngagementsScreen.tsx:1210` project-row, `:1324` study-row) always supply `skill.id`. There
is no "run something here, nothing picked yet" affordance anywhere in the engagement screens today.
But `RunConsoleInner` (`RunConsole.tsx:455-786`) only uses that `preSelectedSkillId` to pre-*select*
a row (`useState(preSelectedSkillId)`, line 500) inside the full `availableSkills` picker
(`role="listbox"`, lines 681-694) — it always renders the entire list of every skill attached to the
Project (and, in Study scope, the Study too), never narrows to just the clicked skill. Skill-first
mode (`RunConsoleSkillFirstInner`) already solves exactly this shape via `LockedSkillCard`
(`RunConsole.tsx:238-260`) — a static, non-interactive display card, no picker at all. This story
brings the engagement-launched context-first path in line with that already-proven idiom, for the
one case (`preSelectedSkillId` present) where a single skill was explicitly chosen.

## Acceptance Criteria

1. **AC1 — Launched-with-a-skill = locked single skill.** When the console is opened from an
   engagement skill row (a specific `skillId` is supplied via `?skillId=` — i.e. `preSelectedSkillId`
   is truthy), the skill area shows only that one skill as a locked card (mirroring skill-first
   mode's `LockedSkillCard`), not the full `role="listbox"` picker. Context (Client/Project/Study)
   stays pre-scoped and locked exactly as it is today (5.2 `LockedContextPanel` behavior preserved,
   untouched by this story).

2. **AC2 — No-skill context launch still shows the picker.** If the console is opened context-first
   WITHOUT a specific skill (`preSelectedSkillId` is `undefined` — e.g. a future "Run something here"
   affordance, or a direct URL with no query string), the multi-skill picker still renders exactly as
   today. This story narrows only the explicit-skill launch path; it does not remove or gate the
   picker component itself.

3. **AC3 — Run behavior unchanged for the locked skill.** The invocation payload
   (`buildRunPayload`), version handling (grantor-only `VersionSelector` per Story 11.7), location
   selector for location-dependent skills (`LocationSelector`, Study scope only), and study-protocol
   handling (`documentUploadHint` per Story 16.4) all behave exactly as today once a skill is
   resolved — none of that logic changes, only how the skill got "selected."

4. **AC4 — Back navigation unchanged.** Back still returns to the originating Project/Study screen
   (`entityPath(origin, originId)`, Story 5.2 AC preserved) — untouched by this story.

5. **AC5 — The "skill not available in this context" fallback still fires correctly.** Today, if
   `preSelectedSkillId` doesn't resolve to any attachment in `availableSkills` (retired, wrong scope,
   or attachments still loading), `skillSelectedButMissing` shows a fallback message
   (`RunConsole.tsx:716-720`) instead of a picker row. This must keep working under the locked-card
   UI too — a locked card can only render once the skill resolves; the not-found/loading states need
   an explicit locked-mode equivalent (see Task 2).

**Out of scope (do NOT touch):**
- `RunConsoleSkillFirstInner` and `LockedSkillCard` itself — reuse `LockedSkillCard` (or a card that
  renders identically), do not fork a second copy of its markup.
- Story 16.7 (`JobStatusPanel`'s stale-terminal-job guard) — a separate, independent fix against a
  different function in the same file. Both stories touch `RunConsole.tsx`; expect a clean merge
  (different functions), not a conflict.
- `EngagementsScreen.tsx`'s `onRun`/navigation — already correct (always passes a real `skillId`);
  no changes needed there.
- Any backend/API change — this is a pure client-side rendering-branch change; the invocation payload
  and API contract are identical before and after.
- `useProjectSkills`/`useStudySkills` — still needed to resolve which skill(s) are available (for the
  no-skill picker path, AC2, and to validate the pre-selected id actually exists, AC5); their query
  shape/keys are unchanged.

## Tasks / Subtasks

- [ ] **Task 1 — Confirm current behavior against source (AC1/AC2)**
  - [ ] Re-read `RunConsoleInner` (`RunConsole.tsx`, currently ~lines 455-786) against the CURRENT
    working tree — line numbers above are from Story 16.6's baseline (head `efcd6d1`); re-locate by
    searching for `availableSkills` and `SkillPickerRow` if the file has moved (Story 16.7 may have
    landed first and shifted line numbers in `JobStatusPanel`, further down the file — that does not
    affect this story's target lines, which sit well above it).
  - [ ] Confirm `preSelectedSkillId` (derived from `?skillId=` in `RunConsoleContextFirst`, line 1561,
    threaded through `RunConsoleResolver` to `RunConsoleInner`'s props) is `undefined` whenever the
    query string has no `skillId` key — `new URLSearchParams(location.search).get('skillId') ?? undefined`
    (line 1561) already does this correctly; no change needed there.

- [ ] **Task 2 — Branch `RunConsoleInner`'s skill area on `preSelectedSkillId` (AC1, AC2, AC5)**
  - [ ] When `preSelectedSkillId` is truthy, render a locked single-skill card instead of the
    `role="listbox"` picker block (lines ~670-696). Reuse `LockedSkillCard` (`RunConsole.tsx:238-260`)
    directly — it takes a `Skill` (from `src/features/skills/types.ts`), and `RunConsoleInner` already
    fetches the full skill via `useSkill(selectedSkillId)` into `fullSkill` (line 505) for the
    schema-driven-inputs feature. Wire the locked card to render from `fullSkill` once it resolves
    (verify `fullSkill` carries every field `LockedSkillCard` reads: `name`, `runtime_type`,
    `visibility`, `lifecycle_state`, `location_dependent`, `description` — it does, `Skill` is a
    superset of `AttachedSkill`).
  - [ ] Handle the three sub-states of the locked path explicitly (this is what AC5 requires and what
    the plain "always renders LockedSkillCard" happy path misses):
    - `skillsLoading` (attachment list not yet resolved) → a loading skeleton in the locked-card slot
      (reuse the existing `Skeleton` import used elsewhere in this file, e.g. lines 674-676's pattern).
    - resolved but `skillSelectedButMissing` is true (attachment exists in the list check fails, or
      the skill is retired/gone) → keep the existing fallback message block (lines 716-720) — it
      already covers this; just ensure it still renders when the picker itself is absent.
    - resolved and found (`selectedSkill` truthy, `fullSkill` loaded) → render `LockedSkillCard`.
  - [ ] When `preSelectedSkillId` is falsy (AC2), render the existing picker block completely
    unchanged (lines ~670-696, including the `skillsLoading`/`availableSkills.length === 0`/populated
    branches) — do not alter this path at all.
  - [ ] Do not touch `selectedSkillId` state management (`useState(preSelectedSkillId)`, line 500) or
    `selectedSkill`/`skillSelectedButMissing` derivations (lines 501, 557) — the locked-card path
    reads the SAME derived values the picker path already computes; only the JSX branch changes.

- [ ] **Task 3 — Verify no other logic implicitly depends on the picker being visible (AC3)**
  - [ ] Confirm `canRun`, `buildRunPayload`, the duplicate-check pre-flight (`useDuplicateCheck`), the
    `VersionSelector` gate, `LocationSelector` gate, and `documentUploadHint` (Story 16.4) all key off
    `selectedSkill`/`selectedSkillId`/`showLocationSelector` — NOT off whether the picker JSX rendered.
    They do (verified: none reference the picker's DOM or `SkillPickerRow`) — this task is a
    confirmation, not expected to require code changes, but re-verify against current source before
    assuming it still holds.

- [ ] **Task 4 — Tests (AC1, AC2, AC5)**
  - [ ] Update the existing test `'AC2: pre-selects skill when skillId provided in query string'`
    (`RunConsole.test.tsx:353-358`) — it currently asserts the picker row for the pre-selected skill
    has `aria-selected="true"`. Under this story, a `?skillId=` launch no longer renders the picker at
    all, so this assertion must change to: the locked card renders with the skill's name (e.g.
    `expect(screen.getByText('Running skill')).toBeInTheDocument()` mirroring the skill-first mode
    test at line 692, `it('AC1: shows the locked "Running skill" card with the skill name')`), AND
    `expect(screen.queryByRole('listbox', { name: 'Available skills' })).not.toBeInTheDocument()`
    (mirroring the skill-first isolation test at line 699-702).
  - [ ] New test — no-skill context launch (AC2): render `/internal/engagements/run/project/project-1`
    (no `?skillId=`) and assert the picker (`role="listbox"`) STILL renders with both mock skills
    (this is exactly the existing test at line 324-328, `'AC1: shows project-attached skill list'` —
    confirm it still passes unmodified; it should, since it exercises the no-`skillId` path).
  - [ ] New test — pre-selected skill not in the attached list (AC5): mock `useProjectSkills`/
    `useStudySkills` to NOT include the id passed via `?skillId=`, render with that query string, and
    assert the existing fallback message renders (`"That skill isn't available in this context. Pick
    a skill from the list above to run."`) — note the message text itself may need a small edit since
    "pick a skill from the list above" no longer makes sense when there's no list in the locked path;
    decide on exact wording during implementation and record the choice in Completion Notes (the
    literal string is not asserted by any AC, but should read sensibly for a locked-launch context —
    e.g. "That skill isn't available in this context." without the "pick from the list" clause when
    `preSelectedSkillId` is set).
  - [ ] Re-verify AC3-adjacent existing tests are unaffected: `'AC3: location selector appears when
    location-dependent skill selected in Study scope'` (line 362) and its siblings render WITHOUT
    `?skillId=` (they manually click a picker row) — these exercise the AC2 no-skill path and should
    need no changes; confirm this by running the full file, not by inspection alone.
  - [ ] Gates: `tsc --noEmit` + `eslint` clean; `vitest run` green, 0 regressions.

## Dev Notes

### The exact change surface

| File | What changes |
|---|---|
| `src/features/run/components/RunConsole.tsx` | `RunConsoleInner`'s skill-area JSX (~lines 670-696) — branch on `preSelectedSkillId` truthy/falsy; reuse `LockedSkillCard` (lines 238-260) for the truthy branch. No changes to `LockedSkillCard` itself, no changes to state/derivation logic (lines 493-557), no changes to `RunConsoleSkillFirstInner`. |
| `src/features/run/components/RunConsole.test.tsx` | Update the one existing `?skillId=` test (line 353-358); add 1-2 new tests per Task 4. |

**No changes to:** any backend file, `EngagementsScreen.tsx`, `useProjectSkills.ts`/`useStudySkills.ts`,
`useSkills.ts` (`useSkill` hook itself), Story 16.7's scope (`JobStatusPanel`, a different function in
the same file).

### ⚠️ Non-obvious traps (verified against source)

**Trap 1 — `preSelectedSkillId` truthy does not mean the skill has resolved yet.** There's a gap
between "a `skillId` was supplied in the URL" and "we know the skill exists in this context and have
its full data." Three async things must settle: `useProjectSkills`/`useStudySkills` (the attachment
list, gates `skillsLoading`/`skillSelectedButMissing`) and `useSkill(selectedSkillId)` (gates
`fullSkill`, needed by `LockedSkillCard`). Don't render `LockedSkillCard` with a `fullSkill` of
`undefined` — gate it the same way `RunConsoleSkillFirstInner` gates its own `skillLoading`/`skillError`
states (lines 976-1007) before rendering its main return.

**Trap 2 — `LockedSkillCard` takes a `Skill`, not an `AttachedSkill`.** `selectedSkill` (line 501) is
derived from `availableSkills: AttachedSkill[]` — it does NOT have every field `Skill` has (e.g. no
`input_schema`, `current_version_id`). `LockedSkillCard` only reads `name`, `runtime_type`,
`visibility`, `lifecycle_state`, `location_dependent`, `description` — all present on `AttachedSkill`
too — so either type would satisfy it at the field level, but `LockedSkillCard`'s prop type is
declared as `{ skill: Skill }`. `fullSkill` (line 505, already fetched via `useSkill(selectedSkillId)`
for the schema-inputs feature) IS a real `Skill` — use `fullSkill` for the locked card, not
`selectedSkill`, so the prop type matches with no widening/casting needed.

**Trap 3 — the picker's `onSelect` callback also resets `locationSelection`/`selectedVersion`**
(lines 687-691). In the locked path there is no click to trigger this reset — but there's also
nothing to reset FROM, since `selectedSkillId` is fixed at `preSelectedSkillId` for the lifetime of
this mount (no picker means no way to change skills mid-session on this path). Confirm this is fine
as-is: `selectedSkillId`'s `useState` initializer runs once; nothing in the locked path ever calls
`setSelectedSkillId` again, so there's no stale-reset concern — just don't wire up a spurious
`onSelect`-equivalent that doesn't exist.

**Trap 4 — `skillSelectedButMissing`'s existing message assumes a picker is visible.** The current
copy ("Pick a skill from the list above to run") is written for the AC2 (no-lock) mental model where
a list is right above it. Under a locked launch, there is no list above it (per this story). Reword
for the locked context — see Task 4's note; this is copy-only, not logic.

**Trap 5 — Story 16.7 touches the same file, different function.** `JobStatusPanel`'s stale-terminal-
job guard (Story 16.7, not this story) is a separate, independent change further down `RunConsole.tsx`
(currently ~line 1123 onward). Expect both stories' diffs to land in the same file without functional
overlap — do not let this story's edits wander into `JobStatusPanel`, and don't assume 16.7 has landed
or hasn't; this story does not depend on it either way (per the epic's own sequencing note).

### Reuse map (do NOT rebuild)

- **`LockedSkillCard`** (`RunConsole.tsx:238-260`) — the exact presentation this story needs for the
  context-first locked path. Reuse verbatim (pass `fullSkill`, a real `Skill`); do not create a second
  "locked card" component or duplicate its markup/classNames.
- **`skillSelectedButMissing`** (line 557) — already correctly distinguishes "picked an id we can't
  resolve" from "nothing picked"; reuse this derivation as the locked-path's not-found gate, don't
  reinvent a parallel check.
- **`fullSkill`** (`useSkill(selectedSkillId)`, line 505) — already fetched for schema-driven inputs;
  the SAME query serves the locked card's data need. Do not add a second `useSkill` call.
- **`Skeleton`** — already imported and used for the picker's loading state (lines 674-676); reuse the
  same component for the locked-card loading state rather than inventing new loading markup.

### Data model & flow facts (verified against current source)

- `preSelectedSkillId` originates in `RunConsoleContextFirst` (line 1561):
  `new URLSearchParams(location.search).get('skillId') ?? undefined` — threaded through
  `RunConsoleResolver` (line 1603) into `RunConsoleInner`'s props (line 460) unchanged. No other
  source sets it.
- `EngagementsScreen.tsx`'s `onRun` (lines 1840-1842) is the ONLY caller that constructs a
  `/internal/engagements/run/{origin}/{originId}?skillId=...` URL in the codebase (confirmed via
  grep for `skillId=` across `src/features/engagements/`); both its call sites
  (`EngagementsScreen.tsx:1210` and `:1324`) always pass a real `skill.id` from an already-rendered
  attached-skill row — there is no code path today that reaches `RunConsoleInner` with a garbage or
  empty-string `skillId` from this screen. `skillSelectedButMissing`'s fallback exists for edge cases
  (skill detached/retired between page load and click, or attachment list still loading) rather than
  a routinely-hit case.
- `RunConsoleInner`'s `availableSkills` (line 493-498) merges `useProjectSkills(projectId)` and, in
  Study scope only, `useStudySkills(studyId)` into one deduped list keyed by skill id — this merge is
  UNCHANGED by this story; it is still needed to validate a pre-selected id exists (AC5) and to power
  the AC2 no-skill picker path.
- Two independent mount points render `RunConsole` (`src/routes/internal.tsx`): `engagements/run/
  :origin/:originId` (context-first, this story's target) and `skills/:skillId/run` (skill-first,
  already correct, untouched). Only the context-first path needs a fix.

### Testing standards

- Frontend: Vitest + React Testing Library, co-located `*.test.tsx`.
- `RunConsole.test.tsx` already establishes the pattern for testing this exact "locked card, no
  picker" shape in skill-first mode (lines 692-702) — mirror those two assertions for the context-first
  locked path rather than inventing new assertion styles.
- `tsc --noEmit` + `eslint` clean; `vitest run` green, 0 regressions — this codebase's standing gate
  bar for every FE story (confirmed via 16.2/16.3/16.5/16.6/16.7's Dev Agent Records).

### Git / build context

- `velara-web` on `development` (head `efcd6d1`, Story 16.6) — confirm clean working tree via
  `git status` before starting. Story 16.7 is `ready-for-dev` but unimplemented as of this story's
  drafting (HEAD still exactly 16.6) — if it has landed by the time you start, its diff sits in
  `JobStatusPanel` (different function, further down the file); expect a clean merge, not a conflict.
  Do NOT commit `velara-web` from this story (never-push-subrepos rule — only `code-review` commits
  subrepos, post-review). Only the top-level docs repo is committed by `dev-story`.
- `velara-api` — untouched by this story; no need to check its state.

### Project Structure Notes

- Frontend only, existing files modified in place (`RunConsole.tsx`, `RunConsole.test.tsx`). No new
  files, no new directories, no new dependencies, no new components (reuses `LockedSkillCard`).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.8] —
  parent epic story, the AC contract this story expands.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-24.md] — the correct-course
  proposal that added this story (per sprint-status.yaml's 2026-07-24 entries; no standalone file was
  found on disk — the proposal's content is captured inline in sprint-status.yaml's dated comments).
- [Source: velara-web/src/features/run/components/RunConsole.tsx#RunConsoleInner] — the context-first
  component and its skill-picker block (~lines 455-786 as of Story 16.6's baseline); re-locate by
  searching for `availableSkills`/`SkillPickerRow` against the current tree.
- [Source: velara-web/src/features/run/components/RunConsole.tsx#LockedSkillCard] — the exact
  presentation (lines 238-260) this story reuses for the context-first locked path.
- [Source: velara-web/src/features/run/components/RunConsole.tsx#RunConsoleSkillFirstInner] — the
  already-correct skill-first mode (lines 794-1116) this story's locked-card behavior mirrors; do not
  modify.
- [Source: velara-web/src/features/run/components/RunConsole.test.tsx#L353-358] — the one existing
  test that must change (`?skillId=` currently asserts picker pre-selection; must assert locked card
  instead).
- [Source: velara-web/src/features/run/components/RunConsole.test.tsx#L692-702] — skill-first mode's
  "locked card, no picker" test pattern to mirror for the context-first locked path.
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L1840-1842,1210,1324] —
  `onRun` and its two call sites; confirms every engagement-launched Run always supplies a real
  `skillId` today.
- [Source: velara-web/src/api/skillAttachments.ts#AttachedSkill] — the type `availableSkills` holds;
  confirms it's a field-subset of `Skill` (relevant to Trap 2).
- [Source: velara-web/src/features/skills/types.ts#Skill] — the type `LockedSkillCard` requires;
  `fullSkill` (from `useSkill`) already satisfies it.
- [Source: _bmad-output/implementation-artifacts/16-7-run-console-no-longer-reopens-stale-completed-job.md] —
  sibling Epic 16 story touching the same file in a different function; confirms no coordination
  needed either way (Trap 5).
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#L56] —
  co-located test convention.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
