---
baseline_commit: velara-api unaffected (this story has zero backend surface); velara-web on branch
  `development` (head `efcd6d1`, Story 16.6). At this story's drafting, the working tree has
  UNCOMMITTED, in-progress Story 16.7 changes to `useRunStore.ts` and `RunConsole.tsx` (confirmed via
  `git diff` — sprint-status.yaml still shows 16.7 as `ready-for-dev`, so this is another session's
  work-in-progress, not yet reviewed/committed). Confirmed: 16.7's uncommitted diff touches ONLY
  `JobStatusPanel` (`RunConsole.tsx`, ~line 1131+) and its `hydratedJobId`/`explicitJobId` store
  fields — zero overlap with this story's target (`RunConsoleInner`'s skill-picker block,
  ~line 670-696). Run `git status`/`git diff` in `velara-web` before starting to see current state;
  do not revert or stash 16.7's in-progress work — build this story's changes alongside it. If 16.7
  has since been committed, only the file, not the line ranges this story cites, may shift.
---

# Story 16.8: Engagement-Screen "Run" Opens the Console Locked to That One Skill

Status: done

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

- [x] **Task 1 — Confirm current behavior against source (AC1/AC2)**
  - [x] Re-read `RunConsoleInner` against the CURRENT working tree (Story 16.7's uncommitted changes
    shifted line numbers slightly — `preSelectedSkillId` prop at line 460, `availableSkills` at 493,
    `selectedSkillId`/`selectedSkill` at 500-501, `fullSkill` at 505, `skillSelectedButMissing` at 557,
    picker block at 670-696 pre-change — all confirmed at their new locations by grep, zero overlap
    with 16.7's `JobStatusPanel` further down the file).
  - [x] Confirmed `preSelectedSkillId` (`new URLSearchParams(location.search).get('skillId') ?? undefined`
    in `RunConsoleContextFirst`) is `undefined` whenever the query string has no `skillId` — no change
    needed.

- [x] **Task 2 — Branch `RunConsoleInner`'s skill area on `preSelectedSkillId` (AC1, AC2, AC5)**
  - [x] Replaced the "Skill picker" block with a `preSelectedSkillId ? (...) : (...)` branch. Truthy
    branch renders `LockedSkillCard` fed by `fullSkill` (`useSkill(selectedSkillId)`) — `tsc --noEmit`
    confirms `SkillWithVersion extends Skill` satisfies `LockedSkillCard`'s prop type with no
    casting, as Trap 2 predicted.
  - [x] Three sub-states handled in the locked branch: `skillsLoading || (selectedSkill && !fullSkill)`
    → skeleton in the locked-card slot; `skillSelectedButMissing` → fallback message; `fullSkill`
    resolved → `LockedSkillCard`.
  - [x] Falsy branch renders the picker block completely unchanged (same `skillsLoading`/
    `availableSkills.length === 0`/populated sub-branches, same `SkillPickerRow`/`onSelect` wiring).
  - [x] `selectedSkillId` state management and `selectedSkill`/`skillSelectedButMissing` derivations
    untouched — only the JSX branch changed. Removed the now-redundant standalone
    `skillSelectedButMissing` fallback block that used to sit below the picker (it only ever fired for
    the locked-launch case — its message is now inlined in the locked branch instead, reworded per
    Trap 4/Task 4).

- [x] **Task 3 — Verify no other logic implicitly depends on the picker being visible (AC3)**
  - [x] Confirmed via source read: `canRun`, `buildRunPayload`, `useDuplicateCheck`, the
    `VersionSelector`/`LocationSelector` gates, and `documentUploadHint` all key off
    `selectedSkill`/`selectedSkillId`/`showLocationSelector` — none reference the picker's DOM or
    `SkillPickerRow`. No code changes required.

- [x] **Task 4 — Tests (AC1, AC2, AC5)**
  - [x] Replaced `'AC2: pre-selects skill when skillId provided in query string'` with
    `'Story 16.8 AC1: locks to the pre-selected skill (no picker) when skillId is provided in query
    string'` — asserts the locked card renders (`'Running skill'` + skill name, mirroring skill-first
    mode's test) AND the picker/listbox/`Select skill …` rows are absent.
  - [x] Confirmed `'AC1: shows project-attached skill list'` (no `?skillId=`) still passes unmodified
    (exercises the no-skillId path). Added a new explicit test, `'Story 16.8 AC2: no-skill context
    launch (no skillId) still shows the full picker'`, asserting the listbox + both skill rows render
    and no locked-card slot appears.
  - [x] New test `'Story 16.8 AC5: skillId not in the attached list shows the locked-mode fallback,
    not the picker'` — mocks `useProjectSkills` to exclude the queried id, asserts the fallback message
    and absence of the picker. Wording decision (recorded here per the task's note): reworded to
    "That skill isn't available in this context." (dropped the old "Pick a skill from the list above
    to run" clause — there is no list in the locked path to point to). This same reworded fallback is
    now used for both the locked-launch AC5 case and (structurally unreachable, but shares the string)
    any future locked-path missing-skill state; the picker-path's fallback is not needed since a
    picker-selected skill can never be "missing" (it's chosen directly from the rendered list).
  - [x] Re-ran the full test file: AC3-adjacent tests (`'AC3: location selector appears...'` and
    siblings, all launched WITHOUT `?skillId=` and clicking a picker row) pass unmodified — confirmed
    by running, not just inspection.
  - [x] Gates: `tsc --noEmit` clean, `eslint` clean, `vitest run` 793/793 green (up from 791 pre-change:
    net +2 new tests — 1 test edited in place, 2 new added, 0 regressions).

## Review Findings

_Code review 2026-07-27 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor).
All 5 ACs verified satisfied and non-vacuously proven by tests. Triage: 0 decision-needed, 3 patch,
1 defer, 4 dismissed. Blind Hunter and Edge Case Hunter independently converged on the same
high-severity defect (finding 1)._

- [x] [Review][Patch] **`useSkill` error/loading discarded → permanent skeleton bricks the locked
  console** [velara-web/src/features/run/components/RunConsole.tsx:505,673] — HIGH. FIXED: now
  destructures `isError`/`error` from `useSkill`; the locked branch drops out of the skeleton on error
  and renders an error message (SKILL_NOT_FOUND copy or `getErrorMessage`), mirroring
  RunConsoleSkillFirstInner's pattern per Trap 1. The locked branch
  destructures only `const { data: fullSkill } = useSkill(selectedSkillId)`, ignoring `isError`. When
  `preSelectedSkillId` is truthy and the skill IS attached (`selectedSkill` present →
  `skillSelectedButMissing` false) but `useSkill`'s detail fetch errors (transient 500 / network /
  skill deleted mid-session), `fullSkill` stays `undefined` forever, so `selectedSkill && !fullSkill`
  keeps the skeleton condition permanently true → infinite spinner, no error message, no Run
  affordance, until a full remount. This is exactly Trap 1's instruction ("gate the same way
  `RunConsoleSkillFirstInner` gates its own `skillLoading`/`skillError` states") — only the loading
  half was mirrored; the error half was dropped. Skill-first mode's pattern (RunConsole.tsx:808 +
  996, `error: skillError` → explicit error branch) is the fix template. Suggested: destructure
  `isError`/`error` from `useSkill`, and in the locked branch render an error message (e.g. reuse the
  `skillSelectedButMissing`-style card copy or a "couldn't load this skill" message) instead of
  falling through to the skeleton.

- [x] [Review][Patch] **Study-launch flash of "That skill isn't available in this context." before
  `projectId` resolves** [velara-web/src/features/run/components/RunConsole.tsx:672-681] — MEDIUM.
  FIXED: added `attachmentsSettling = origin === 'study' && !projectId` and folded it into the
  skeleton condition, so the not-available fallback fires only after both attachment sources settle. For
  a study-launched Run of a PROJECT-attached skill, `RunConsoleResolver` yields `resolvedProjectId=''`
  until `studyCtx.project.data.id` resolves (RunConsole.tsx:1669-1670). During that window
  `useProjectSkills('')` is disabled (`enabled: !!projectId`, useProjectSkills.ts:14 → not loading, no
  data) while `useStudySkills` has already resolved WITHOUT the project skill → `skillsLoading=false`,
  `selectedSkill` absent → `skillSelectedButMissing=true`. Because the branch checks
  `skillSelectedButMissing` before `fullSkill`, the "not available" fallback renders (even if
  `fullSkill` already resolved), then flips to `LockedSkillCard` once the project id lands. 16.8 makes
  this materially worse than before: pre-change the fallback was a supplement below a still-rendered
  picker; now it is the ONLY thing in the skill slot, so a valid launch briefly reads as a hard "not
  available" error. Suggested: fold the still-resolving-projectId window (study origin && projectId
  empty) into the skeleton condition so the missing-skill fallback fires only after BOTH attachment
  sources have genuinely settled.

- [x] [Review][Patch] **Locked-path skeleton / error sub-state is untested — lets finding 1 ship
  green** [velara-web/src/features/run/components/RunConsole.test.tsx:332-380] — MEDIUM. FIXED: added
  3 tests — loading skeleton (no card/picker/fallback), generic `useSkill` error (message shown, not
  an endless skeleton), and a SKILL_NOT_FOUND error (removed/other-org copy). Task 2
  enumerated three locked sub-states (skeleton / not-found / resolved) but the tests cover only
  resolved-card, picker path, and missing-in-attachment-list. There is no test for `skillsLoading` or
  the `selectedSkill present && fullSkill undefined` (loading/errored) sub-state — precisely the state
  that hangs forever per finding 1. Add coverage for the loading skeleton and the `useSkill`-error
  path alongside the finding-1 fix. (Related low nit, folded in: the AC5 test leaves the default
  `useSkill` mock resolving a real skill for the "missing" id; it still guards the branch order but
  would be more faithful with a `{ data: undefined, error }` override.)

- [x] [Review][Defer] **Attachment-list (`useProjectSkills`/`useStudySkills`) fetch error is
  misreported as "skill not available"** [velara-web/src/features/run/components/RunConsole.tsx:489-499,557]
  — deferred, pre-existing. Both attachment hooks return `error` but `RunConsoleInner` never consumes
  it, so a failed attachment fetch (data undefined, not loading, `availableSkills` empty) makes
  `skillSelectedButMissing` true → the fallback claims the skill is unattached when the real cause is
  a failed request, with no retry. The `skillSelectedButMissing` derivation (line 557) and the
  attachment queries predate this story; 16.8 did not introduce this. Fix would consume the queries'
  `error` and render a retryable "couldn't load skills" state.

_Dismissed as noise (4): (a) reworded fallback copy / removal of the picker-path fallback block —
by-design (auditor confirmed no reachable picker-path missing-skill state; test asserts the new
string); (b) the trailing `: null` leaf of the locked branch is unreachable dead code, harmless and
superseded by finding 1's error branch; (c) `fullSkill` resolved-but-not-attached → fallback wins —
by-design (not-attached must block Run, confirmed by auditor + edge hunter); (d) 16.7's
`hydratedJobId`/`explicitJobId` mock plumbing threaded through the shared test file is a coupling note,
not a 16.8 defect._

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
declared as `{ skill: Skill }`. `fullSkill` (line 505, `useSkill(selectedSkillId)`) actually resolves
to `SkillWithVersion` (`src/api/skills.ts`'s `getSkill` return type), which `extends Skill`
(`src/features/skills/types.ts`) — a structural superset, so it satisfies `LockedSkillCard`'s `Skill`
prop with no widening/casting needed. Use `fullSkill` for the locked card, not `selectedSkill`.

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

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `npx tsc --noEmit` — clean, no errors.
- `npx eslint src/features/run/components/RunConsole.tsx src/features/run/components/RunConsole.test.tsx` — clean, no errors/warnings.
- `npx vitest run` (full suite) — 793/793 passed, 0 regressions (up from 791 pre-change: +2 net new
  tests in `RunConsole.test.tsx` — 1 existing test edited in place to assert the new locked-card
  contract, 2 new tests added for AC2/AC5).

### Completion Notes List

- **Task 1 (confirm current behavior).** Re-read `RunConsoleInner` against the current working tree.
  Story 16.7's uncommitted changes (reviewed, patched, not yet committed per the never-push-subrepos
  rule) shifted line numbers slightly in this story's target area (~5-15 lines) but zero overlap
  confirmed: 16.7 only touches `JobStatusPanel`, far below `RunConsoleInner`'s skill-area block.
  Confirmed `preSelectedSkillId` is `undefined` whenever `?skillId=` is absent from the query string —
  no change needed to that derivation.

- **Task 2 (branch the skill area).** Replaced the unconditional "Skill picker" block with
  `preSelectedSkillId ? (locked branch) : (picker branch, unchanged)`. The locked branch has three
  sub-states exactly as Task 2 specified: `skillsLoading || (selectedSkill && !fullSkill)` → skeleton;
  `skillSelectedButMissing` → fallback message; `fullSkill` resolved → `LockedSkillCard`. Confirmed via
  `tsc --noEmit` (clean) that `fullSkill`'s type (`SkillWithVersion`, from `useSkill`) satisfies
  `LockedSkillCard`'s `{ skill: Skill }` prop with no casting, per Trap 2's prediction (`SkillWithVersion
  extends Skill`). Removed the old standalone `skillSelectedButMissing` fallback block that used to sit
  below the picker (it only ever fired for a pre-selected-but-unresolvable skill, i.e. only the locked
  path — inlining it into the locked branch instead avoids a dead, unreachable duplicate in the picker
  branch). `selectedSkillId` state management and `selectedSkill`/`skillSelectedButMissing` derivations
  untouched, per the story's explicit instruction — only the JSX branch changed.

- **Task 3 (verify no implicit picker-visibility dependency).** Confirmed via source read: `canRun`,
  `buildRunPayload`, `useDuplicateCheck`, the `VersionSelector`/`LocationSelector` render gates, and
  `documentUploadHint` all key off `selectedSkill`/`selectedSkillId`/`showLocationSelector` — none
  reference the picker's DOM, `SkillPickerRow`, or `role="listbox"`. No code changes required; this task
  was pure confirmation.

- **Task 4 (tests).** Replaced the one test that asserted the old pre-selection-inside-the-picker
  behavior with an assertion of the new locked-card contract (mirroring skill-first mode's existing
  "locked card, no picker" pattern). Added an explicit AC2 test (no `skillId` → picker still renders,
  no locked card) and an AC5 test (`skillId` present but not in the attached list → locked-mode fallback,
  not the picker). Fallback copy decision: reworded `skillSelectedButMissing`'s message from "That skill
  isn't available in this context. Pick a skill from the list above to run." to "That skill isn't
  available in this context." — the "pick from the list above" clause no longer makes sense once there
  is no list in the locked-launch path (Trap 4). Re-ran the full test file (not just inspected) to
  confirm the AC3-adjacent location-selector tests — which launch without `?skillId=` and click a picker
  row directly — are unaffected: they are, since they exercise the untouched AC2 picker path.
  `tsc --noEmit` + `eslint` clean; `vitest run` 793/793 green, 0 regressions.

### File List

- `velara-web/src/features/run/components/RunConsole.tsx` — `RunConsoleInner`'s skill-area JSX now
  branches on `preSelectedSkillId`: locked `LockedSkillCard` (fed by `fullSkill`) with loading/missing
  sub-states when truthy, the original unchanged picker block when falsy. Removed the now-redundant
  standalone `skillSelectedButMissing` fallback block (inlined into the locked branch instead, with
  reworded copy). No changes to `LockedSkillCard` itself, state/derivation logic, or
  `RunConsoleSkillFirstInner`.
- `velara-web/src/features/run/components/RunConsole.test.tsx` — replaced the `?skillId=` pre-selection
  test with a locked-card assertion; added 2 new tests (AC2 no-skill picker-still-renders, AC5
  skill-not-in-list locked-mode fallback).

## Change Log

- 2026-07-27 — Implemented (dev-story). Frontend-only, zero backend surface, as scoped. Branched
  `RunConsoleInner`'s skill area on `preSelectedSkillId`: an engagement-launched Run (always carries a
  real `skillId`) now shows a locked single-skill card (reusing skill-first mode's `LockedSkillCard`
  verbatim) instead of the full multi-skill picker; a context-first launch with no `skillId` still shows
  the picker unchanged (AC2). All three locked-path sub-states handled (loading skeleton, not-found
  fallback with reworded copy, resolved card). No changes to run/invocation logic, back navigation, or
  `RunConsoleSkillFirstInner` — verified those all key off `selectedSkill`/`selectedSkillId`, not picker
  JSX. `tsc --noEmit` + `eslint` clean; `vitest run` 793/793 green, 0 regressions (net +2 tests).
