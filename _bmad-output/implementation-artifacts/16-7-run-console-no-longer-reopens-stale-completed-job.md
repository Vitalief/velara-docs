---
baseline_commit: velara-api unaffected (this story has zero backend surface); velara-web on branch
  `development` (head `efcd6d1`, Story 16.6) with a CLEAN working tree — Story 16.5's uncommitted
  changes described in 16.6's baseline were folded into 16.6's own commit. Verify with `git status`
  in `velara-web` before starting; expect nothing uncommitted.
---

# Story 16.7: Run Console No Longer Reopens a Stale Completed Job

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want the Run Console to open empty ("Run to invoke") unless I have an in-flight job or explicitly
opened a specific job,
so that a previously-finished run doesn't reappear every time I open the console from anywhere.

## ⚠️ SCOPE — read this first

**FRONTEND ONLY (`velara-web`). Zero backend/schema surface.** Independent of 16.1-16.6. This is a
deployed-dev bug fix against `RunConsole.tsx` / `useRunStore.ts` — both files already carry extensive
docstrings describing the INTENDED behavior correctly. **The intent was right; the implementation has
a gap.** Do not treat the existing comments as ground truth about what the code actually does — this
story's whole job is closing the gap between the documented intent and the observed deployed-dev bug.

**Root cause (confirmed by source analysis, not speculation):**

`hydratedJobId` (`useRunStore.ts`) is set **exactly once per browser tab session**, inside
`onRehydrateStorage`, which Zustand's `persist` middleware fires **only at store-module load time**
(i.e., on a hard page load / refresh) — never on ordinary in-SPA route navigation. `JobStatusPanel`'s
mount-time `useEffect` (`RunConsole.tsx:1152-1158`) is gated on `hydratedJobId` being truthy:

```ts
useEffect(() => {
  if (!hydratedJobId || !job) return          // <-- the gap
  if (job.id !== hydratedJobId) return
  if (!TERMINAL_JOB_STATUSES.has(job.status)) return
  clearHydratedJobId()
  setActiveJobId(null)
}, [hydratedJobId, job, setActiveJobId, clearHydratedJobId])
```

This correctly handles the ONE case it was built for: a page **refresh** while a job is still
in-flight, followed later by a restore that finds the job now terminal (AC2 of this story — must keep
working). It does **nothing** for the far more common case the bug report actually describes: within
a single tab session (no refresh at all), the user runs a skill, **navigates away from the Run Console
before the job finishes** (job keeps running server-side; `JobStatusPanel` unmounts, its `useJob` poll
stops), the job completes in the background, and the user later reopens the Run Console from anywhere
(nav, skill detail, another engagement screen). `activeJobId` in the Zustand store (an in-memory
singleton for the whole SPA session, not just sessionStorage) is still that job's id; `hydratedJobId`
is `null` (nothing was ever restored this session, so the guard's first line short-circuits and does
nothing). `JobStatusPanel` remounts, `useJob(activeJobId)` fetches the now-terminal job, and — because
the guard never fires — it renders that stale completed job's status/output instead of the empty state.

**The fix must clear a terminal job on ANY mount where it isn't a fresh, in-flight, or explicitly-just-
opened job — not only the post-refresh-restore case.** The one-shot `hydratedJobId` mechanism should be
generalized (or replaced) so it also covers "the currently-set `activeJobId` was already terminal before
this mount, and nothing just explicitly (re-)selected it in this render pass."

## Acceptance Criteria

1. **AC1 — Empty by default.** Opening the Run Console from any entry point (nav, skill detail,
   engagement screen) with no in-flight job shows the empty "No job running. Click Run to invoke a
   skill." state — never a previously-completed job's status/output. This must hold **both** immediately
   after a page refresh **and** during ordinary in-SPA navigation with no refresh at all (the gap
   identified above).

2. **AC2 — In-flight jobs still survive a refresh.** A job that is still queued/running when the tab is
   refreshed IS restored and polling resumes (the one behavior sessionStorage persistence exists to
   protect — must not regress). Do not remove or weaken this path; it is covered today by
   `useRunStore.test.ts` and must stay green.

3. **AC3 — Explicit reopen still works.** Selecting a specific job from Jobs History (which calls
   `setActiveJobId(jobId)` before navigating — `JobsHistory.tsx:265`) still opens that job, terminal or
   not. The fix must distinguish "explicitly opened just now" from "stale leftover from a previous visit"
   — the exact distinction `hydratedJobId` was built to make, generalized to also cover the no-refresh case.

4. **AC4 — Root cause documented + regression tests.** The Dev Agent Record states the actual root cause
   (see above — confirm it against source before writing, do not just copy this story's prose verbatim
   without re-verifying). Tests cover, at minimum:
   - a terminal job already set as `activeJobId` at mount (no refresh involved) → console opens empty
     (the bug this story exists to fix — **not covered by any existing test**, confirmed by reading
     `RunConsole.test.tsx` and `useRunStore.test.ts`);
   - a running job in sessionStorage across a simulated refresh → console restores it (AC2, already
     partially covered — extend/confirm, don't duplicate);
   - a job explicitly selected via Jobs History (terminal or not) → console shows it (AC3).

**Out of scope (do NOT touch):**
- `useJob`'s polling/query logic (`useJob.ts`) — unrelated to this bug, do not modify its
  `refetchInterval`/`staleTime`.
- `JobsHistory.tsx`'s own explicit-select logic (`handleSelect`/`handleClose`, lines 258-272) — already
  correct (calls `setActiveJobId` explicitly); do not restructure it.
- Story 16.8 (locking the skill picker to one skill) — a separate, independent fix against the same file.
  Do not fold its scope in here; do not let this story's edits collide with it beyond both touching
  `RunConsole.tsx` (expect a merge, not a conflict — different functions).
- Any backend/API change — `InvocationJob`/`GET /jobs/{id}` are untouched; this is a pure client-state bug.

## Tasks / Subtasks

- [ ] **Task 1 — Confirm the root cause against current source (AC4)**
  - [ ] Re-read `useRunStore.ts` (`onRehydrateStorage`, `partialize`) and `RunConsole.tsx`'s
    `JobStatusPanel` (currently ~lines 1125-1249) against the CURRENT working tree — line numbers above
    are from Story 16.6's baseline (head `efcd6d1`); re-locate by searching for `hydratedJobId` if the
    file has moved.
  - [ ] Verify (e.g. via a scratch test or manual trace, not assumption) that `onRehydrateStorage` does
    NOT re-fire on SPA route navigation within the same tab — only Zustand's `persist` middleware
    hydration lifecycle (store creation / module evaluation) triggers it. This is the load-bearing fact
    the whole fix depends on; confirm it before writing the fix, not after.

- [ ] **Task 2 — Generalize the stale-job guard beyond the `hydratedJobId`-only case (AC1, AC3)**
  - [ ] Design decision to make explicitly (document the choice in Completion Notes): the guard must now
    fire whenever `activeJobId` refers to an ALREADY-terminal job at the moment `JobStatusPanel` (re)mounts
    and observes it, **regardless of whether it came from a refresh-restore or was simply left over from
    an earlier same-session run**. The one exception that must NOT be cleared: a job the user just this
    render-pass explicitly selected (Jobs History "View", the duplicate-check "view prior" banner, or a
    just-submitted run) — those must display even if (implausibly) already terminal by the time they render.
  - [ ] A workable approach: track "was this activeJobId freshly set by an explicit action in THIS mount's
    lifetime" (e.g. a ref/flag set inside `setActiveJobId`-triggering call sites, or comparing against a
    "last explicitly opened id" the same way `hydratedJobId` currently distinguishes restore-from-storage).
    Do not simply delete the terminal-job guard's gating condition (`!hydratedJobId`) without replacing it
    — that would immediately break AC3 (clearing a just-explicitly-opened terminal job on the very next
    render). Dev's call on the exact mechanism; document the chosen design and why in Completion Notes so
    a reviewer can verify AC1/AC3 don't regress each other.
  - [ ] Preserve `useRunStore.test.ts`'s 4 existing assertions about `hydratedJobId`'s current one-shot
    restore semantics if `hydratedJobId` itself is kept (extended, not replaced) — if the mechanism is
    replaced entirely, update/replace those tests to assert the new mechanism's equivalent guarantees
    instead of deleting coverage.

- [ ] **Task 3 — Update `useRunStore.ts` and/or `JobStatusPanel`'s effect (AC1, AC2, AC3)**
  - [ ] Implement the design from Task 2. Do not remove sessionStorage persistence of `activeJobId` (it
    is still required for AC2's mid-run-refresh survival) — narrow when a **terminal** value is trusted
    for display, don't delete the persistence mechanism itself.
  - [ ] Keep `TERMINAL_JOB_STATUSES` (`RunConsole.tsx`) as the single source of truth for "this job has
    nothing left to poll" — do not introduce a second terminal-status set.

- [ ] **Task 4 — Tests (AC4)**
  - [ ] New test(s) in `RunConsole.test.tsx` and/or `useRunStore.test.ts` (whichever file the chosen fix
    actually lives in) covering the 3 scenarios in AC4. **Note the existing test-setup mismatch**:
    `RunConsole.test.tsx` mocks `@/stores/useRunStore` entirely (`vi.fn()`, line 54-56) — the real
    Zustand `persist`/`onRehydrateStorage` machinery is never exercised there. `useRunStore.test.ts`
    (co-located with the store) is the file that exercises the REAL store via seeded `sessionStorage` +
    dynamic `import()` per test (see its own top-of-file comment on why). Put store-hydration-semantics
    tests in `useRunStore.test.ts`; put "does `JobStatusPanel` render the empty state" tests in
    `RunConsole.test.tsx` against the mocked store (asserting the component reads the store's
    already-computed guard state correctly) — do not try to make `RunConsole.test.tsx` exercise real
    sessionStorage hydration through the mock; that mismatch is why the two files test different layers.
  - [ ] If the "activeJobId already terminal at mount, no refresh" scenario requires `JobStatusPanel`'s
    effect logic to consult more than the mocked store's flat return value (e.g. a same-session flag),
    make sure the mock in `RunConsole.test.tsx` is extended to express that shape too — don't leave a gap
    where the real behavior diverges from what the mock allows expressing.
  - [ ] Gates: `tsc --noEmit` + `eslint` clean; `vitest run` green, 0 regressions.

## Dev Notes

### The exact change surface

| File | What changes |
|---|---|
| `src/stores/useRunStore.ts` | The stale-job guard mechanism — extend `hydratedJobId`'s semantics, add a new field, or replace it, per Task 2's design decision. Docstrings must be updated to match (they currently describe ONLY the refresh-restore case as if it were the whole story). |
| `src/features/run/components/RunConsole.tsx` | `JobStatusPanel`'s mount-time `useEffect` (~lines 1152-1158, verify against current tree) — the guard condition that decides whether to clear a terminal `activeJobId`. |
| `src/stores/useRunStore.test.ts` | New/updated tests for the generalized guard's store-level semantics. |
| `src/features/run/components/RunConsole.test.tsx` | New test(s) asserting `JobStatusPanel` shows the empty state for a stale terminal job at mount, and still shows an explicitly-opened job. |

**No changes to:** any backend file, `useJob.ts`, `JobsHistory.tsx`'s explicit-select logic, Story 16.8's
scope (the skill-picker locking fix — separate story, same file, different functions).

### ⚠️ Non-obvious traps (verified against source)

**Trap 1 — `onRehydrateStorage` is a load-time hook, not a navigation hook.** Zustand's `persist`
middleware calls `onRehydrateStorage` once, synchronously during store module initialization (effectively
"on page load/refresh"), never again for the lifetime of that JS module instance. Every subsequent
in-SPA navigation reuses the SAME store instance with `hydratedJobId` already fixed at whatever it was
set to at load — usually `null`, unless the user is mid-refresh-restore. This is the entire root cause;
do not "fix" this by trying to make `onRehydrateStorage` re-fire — it structurally can't without a real
page reload, and that's not the right lever anyway.

**Trap 2 — the existing guard's `job.id !== hydratedJobId` check exists to protect a DIFFERENT case than
the one this story fixes.** It exists so that if the user re-selects (from Jobs History) the SAME job
that was originally restored-and-cleared earlier in the session, it doesn't get wrongly re-cleared a
second time (see `useRunStore.test.ts`'s "clearHydratedJobId is a one-shot consume" test and the
docstring at `RunConsole.tsx:1143-1151`). Any generalized replacement must preserve this specific
protection — don't collapse it into "always clear any terminal job on mount," which would break AC3
(a user re-opening a job they explicitly picked, that happens to already be terminal, must still see it).

**Trap 3 — `RunConsole.test.tsx` mocks the entire `useRunStore` module.** (`vi.mock('@/stores/useRunStore',
() => ({ useRunStore: vi.fn() }))`, line 54-56). This means the real `persist`/hydration behavior is
invisible to that test file by construction — it only tests "given this store shape, does the component
render correctly." The REAL hydration-semantics tests live in `useRunStore.test.ts`, which deliberately
avoids mocking and uses dynamic `import()` per test to control module-load-time `sessionStorage` state
(see that file's own top comment). Write the two kinds of test in the right file — do not try to make
one file do both jobs.

**Trap 4 — `activeJobId` is a session-long Zustand in-memory value, not a per-mount value.** It survives
route navigation within the same tab (that's the whole point — it's how "explicit reopen" and "duplicate
check view-prior" work at all). Don't reason about this bug as if `JobStatusPanel` mounting fresh means
`activeJobId` starts at `null` — it doesn't, except right after a real page load with nothing in
sessionStorage. The bug is specifically that a **stale, already-set, already-terminal** value survives
across an unmount/remount cycle with no page reload in between.

**Trap 5 — Story 16.8 touches the same file.** `RunConsole.tsx`'s skill-picker locking fix
(Story 16.8, not this story) is a separate, independent change to a different part of the same file
(the `availableSkills` picker rendering, not `JobStatusPanel`). Expect both stories' diffs to land in the
same file without functional overlap — do not let this story's edits wander into the skill-picker area,
and don't assume 16.8 has landed or hasn't; this story does not depend on it either way.

### Reuse map (do NOT rebuild)

- **`TERMINAL_JOB_STATUSES`** (`RunConsole.tsx`, module-level `const`) — the single source of truth for
  "nothing left to poll." Reuse verbatim; do not introduce a parallel terminal-status set.
- **`hydratedJobId`/`clearHydratedJobId`** (`useRunStore.ts`) — the existing one-shot mechanism this story
  generalizes. Read its full docstring and the 4 tests in `useRunStore.test.ts` before deciding whether
  to extend it (add a second flag alongside it) or replace it outright — both are legitimate approaches;
  document the choice.
- **`useJob(activeJobId)`** (`useJob.ts`) — unchanged; still the polling hook `JobStatusPanel` reads from.
  Do not touch its query/polling logic.

### Data model & flow facts (verified against current source)

- `useRunStore` (`src/stores/useRunStore.ts`, 69 lines total): Zustand `create` wrapped in `persist`
  middleware, `storage: createJSONStorage(() => sessionStorage)`, `partialize` persists ONLY
  `activeJobId` (not `runMode`, not `hydratedJobId`). `onRehydrateStorage` callback:
  `(state) => { if (state) state.hydratedJobId = state.activeJobId }` — fires once at load.
- `JobStatusPanel` (`RunConsole.tsx`, function starting ~line 1125): destructures
  `{ activeJobId, hydratedJobId, setActiveJobId, clearHydratedJobId }` from `useRunStore()`; calls
  `useJob(activeJobId)`; the guard `useEffect` (~1152-1158) is the exact code quoted in the Scope section
  above. Renders the empty state when `!activeJobId` (~line 1160).
- `setActiveJobId` call sites (confirmed via grep, `RunConsole.tsx`): line 649 (context-first mode, on
  `createInvocation` success), line 750 (duplicate-warning "view prior"), line 965 (skill-first mode, on
  success), line 1080 (skill-first duplicate "view prior"), line 1176 (dismiss on job-fetch error, sets
  `null`), line 1432 (another dismiss/clear site — verify against current tree). None of these clobber
  anything on plain component mount; all are explicit user-triggered callbacks. This confirms the bug is
  NOT "something wrongly calls `setActiveJobId` on mount" — it's "nothing clears a pre-existing stale
  value on mount, except the narrow refresh-only guard."
- `JobsHistory.tsx`'s `handleSelect` (~lines 258-267): explicit "View" click →
  `setActiveJobId(jobId)` — the canonical "explicit reopen" path AC3 protects. `handleClose` (~269-272)
  → `setActiveJobId(null)`. Both correct today; out of scope to modify.
- Two independent mount points render `RunConsole` (`src/routes/internal.tsx`): `engagements/run/:origin/
  :originId` (context-first) and `skills/:skillId/run` (skill-first) — both routes render
  `<RunConsole />`, which internally branches on `useParams().skillId`. Both modes share `RunShell` →
  `JobStatusPanel` (`RunConsole.tsx:300`), so a fix inside `JobStatusPanel`/`useRunStore` automatically
  covers both entry points — no need to duplicate the fix per mode.

### Testing standards

- Frontend: Vitest + React Testing Library, co-located `*.test.tsx`/`*.test.ts`.
- `useRunStore.test.ts` already establishes the pattern for testing REAL Zustand+sessionStorage hydration
  behavior (seed `sessionStorage` → dynamic `import()` → assert on `useRunStore.getState()`) — follow
  this pattern for any new store-level test, per Trap 3.
- `RunConsole.test.tsx` already establishes the pattern for testing component behavior against a mocked
  store (`vi.mocked(useRunStore).mockReturnValue({...})`) — follow this pattern for any new
  component-level test asserting what `JobStatusPanel` renders given a particular store state shape.
- `tsc --noEmit` + `eslint` clean; `vitest run` green, 0 regressions — this codebase's standing gate bar
  for every FE story (confirmed via 16.2/16.3/16.5/16.6's Dev Agent Records).

### Git / build context

- `velara-web` on `development` (head `efcd6d1`, Story 16.6) — confirm clean working tree via
  `git status` before starting (16.6's own record shows it committed cleanly; no known uncommitted
  carry-over as of this story's drafting, unlike the 16.5→16.6 handoff which did carry uncommitted
  changes — do not assume that pattern repeats without checking).
  Do NOT commit `velara-web` from this story (never-push-subrepos rule — only `code-review` commits
  subrepos, post-review). Only the top-level docs repo is committed by `dev-story`.
- `velara-api` — untouched by this story; no need to check its state.

### Project Structure Notes

- Frontend only, existing files modified in place (`useRunStore.ts`, `RunConsole.tsx`, both test files).
  No new files, no new directories, no new dependencies.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.7] —
  parent epic story, the AC contract this story expands.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-24.md#4.1] — the correct-course
  proposal that added this story; Finding #1 in Section 2 is the same root-cause investigation this
  story's Dev Notes confirm and extend against current source.
- [Source: velara-web/src/stores/useRunStore.ts] — the store; `onRehydrateStorage`/`partialize`/
  `hydratedJobId`/`clearHydratedJobId` are the exact mechanism this story generalizes.
- [Source: velara-web/src/stores/useRunStore.test.ts] — existing coverage of the CURRENT one-shot restore
  semantics; must keep passing (if `hydratedJobId` is extended) or be replaced with equivalent coverage
  (if replaced).
- [Source: velara-web/src/features/run/components/RunConsole.tsx#JobStatusPanel] — the guard `useEffect`
  and its surrounding component (~lines 1125-1249 as of Story 16.6's baseline; re-locate by searching for
  `hydratedJobId` against the current tree).
- [Source: velara-web/src/features/run/components/RunConsole.test.tsx#L54-56] — confirms `useRunStore` is
  fully mocked in this file (Trap 3); new store-hydration tests belong in `useRunStore.test.ts` instead.
- [Source: velara-web/src/features/run/components/JobsHistory.tsx#L237-272] — `JobsHistory`'s
  `handleSelect`/`handleClose`, the canonical "explicit reopen" path this story's fix must not break
  (AC3).
- [Source: velara-web/src/routes/internal.tsx#L55-59,81-85] — the two independent route mount points for
  `RunConsole`, confirming a fix in the shared `JobStatusPanel`/`useRunStore` covers both without
  duplication.
- [Source: _bmad-output/implementation-artifacts/16-6-hierarchy-scoped-run-history-on-project-study-screens.md] —
  prior Epic 16 story; confirms `velara-web`'s clean-HEAD state this story builds on top of, and the
  never-push-subrepos discipline.
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#L56] —
  co-located test convention.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
