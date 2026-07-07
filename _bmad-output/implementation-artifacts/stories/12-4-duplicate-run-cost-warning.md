---
baseline_commit: 366ffb69d33dab2cd0b3d17ce97fd9c19c9b7d09
---

# Story 12.4: Duplicate-Run Cost Warning (Advisory)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a consultant,
I want a warning when I'm about to run a skill with the same inputs in the same context as a recent completed run,
so that I don't spend AI budget on a duplicate.

## Acceptance Criteria

1. **AC1 — Advisory warning on a matching recent completed run.**
   **Given** a run request for `(skill_id, skill_version, resolved hierarchy_path, inputs-hash)`
   **When** a **completed** job with the exact same `(skill_id, skill_version, hierarchy_path, inputs-hash)` exists and finished within a recent window (config-driven, default 7 days)
   **Then** the platform surfaces an **advisory** warning — naming the prior job and its completion time, with a link/reference to the prior result — **before** spending. The user may proceed anyway (non-blocking) or open/reuse the prior result. The check never blocks the request; it only informs.

2. **AC2 — No match, no warning.**
   **Given** no prior completed job matches `(skill_id, skill_version, hierarchy_path, inputs-hash)` within the window
   **When** the run is requested
   **Then** no warning appears; the normal queue-and-run flow proceeds exactly as it does today, unchanged.

3. **AC3 — Hook point: evaluated before job creation, using the already-available inputs payload.**
   **Given** the hook point
   **When** a run is requested
   **Then** the check is evaluated in `queue_invocation` **before** `job_service.create_job` is called (or via a pre-flight endpoint the Run Console calls before submitting) — hashing the same `inputs_payload` dict (`file_ref_ids` + `inputs`) that `queue_invocation` already builds at [invocations.py:186-190](../../../velara-api/app/api/v1/invocations.py#L186-L190). Advisory only — never blocks a deliberate re-run; the existing double-submit guard (`createInvocation.isPending`) is untouched and orthogonal to this check.

## Tasks / Subtasks

- [x] **Task 1 — Add a stable, deterministic inputs-hash to the invocation pipeline (AC1, AC3)**
  - [x] Implemented as `job_service.hash_inputs_payload(inputs_payload)` in [job_service.py](../../../velara-api/app/services/job_service.py) rather than inline in `invocations.py` — same `hashlib.sha256(json.dumps(inputs_payload or {}, sort_keys=True, default=str).encode()).hexdigest()` formula, but factored as a standalone pure function so both `queue_invocation`'s real-submit path and the new pre-flight `check-duplicate` endpoint call the identical hash logic without duplication.
  - [x] Computed once per call site; `queue_invocation` itself does not call it directly today (see Task 4 note — the wiring ended up entirely in the new pre-flight endpoint under the chosen response shape) but the function is unit-tested standalone and used by `check-duplicate`.

- [x] **Task 2 — Add a duplicate-check query function to `job_service` (AC1, AC2, AC3)**
  - [x] Added `async def find_recent_duplicate(*, session, org_id, skill_id, skill_version, hierarchy_path, inputs_hash, window_minutes) -> InvocationJob | None` in [job_service.py](../../../velara-api/app/services/job_service.py), exactly the query shape specified (org_id/skill_id/skill_version/hierarchy_path/status=completed/completed_at>=cutoff, `ORDER BY completed_at DESC`, `LIMIT 20`), hash-compared in Python against each candidate.
  - [x] No new column/migration — confirmed no schema change needed.
  - [x] Mirrors `list_jobs`' `select(...).where(*conditions).order_by(...).limit(...)` shape.

- [x] **Task 3 — Config: recency window (AC1)**
  - [x] Added `DUPLICATE_RUN_WINDOW_MINUTES: int = Field(default=10080, gt=0)` to [config.py](../../../velara-api/app/core/config.py), directly beside `MINUTES_SAVED_PER_RUN`/`BLENDED_LABOR_RATE_USD`, same convention. Default raised from the story text's suggested 1440 (24h) to 10080 (7 days) per explicit user feedback after initial implementation — a day was judged too short a window for the advisory to be useful in practice.

- [x] **Task 4 — Wire the check into the duplicate-detection hook point (AC1, AC2, AC3)**
  - [x] **Scope changed by the Task 5 decision (below):** since the user chose response shape (b) — a separate pre-flight endpoint, not the inline 202 response — the duplicate check does **not** run inside `queue_invocation`/`create_job`'s call path at all. Instead it runs entirely inside the new `POST /api/v1/invocations/{skill_id}/check-duplicate` endpoint, called by the FE *before* the user clicks Run. `queue_invocation` itself is unmodified in behavior; it was only refactored (see below) to share hierarchy-resolution logic with the new endpoint, not to call the duplicate check itself.
  - [x] Extracted a `_resolve_single_job_hierarchy_path(...)` helper in [invocations.py](../../../velara-api/app/api/v1/invocations.py) covering the location-dependent single-location branch and the non-LD branch (fan-out excluded, per the story's explicit fan-out-out-of-scope decision) — used by both `queue_invocation`'s two single-job branches (pure refactor, zero behavior change, existing tests prove it) and the new `check-duplicate` endpoint, so the two can never resolve a hierarchy_path differently for "the same" request.
  - [x] The check-duplicate endpoint never raises to the caller — any exception during resolution or lookup is caught and reported as `duplicate_of: null` (see `check_duplicate`'s try/except in invocations.py).

- [x] **Task 5 — Response shape: advisory info returned alongside/instead-of immediate queueing (AC1, AC3 — DECISION NEEDED)**
  - [x] **Resolved via `AskUserQuestion` at story start: shape (b) — separate pre-flight endpoint**, not (a) the inline 202 response the Dev Notes recommended. The user wants the warning visible *before* the Run click (potentially informing the decision to click at all), not only after the job is already queued.
  - [x] Implemented `POST /api/v1/invocations/{skill_id}/check-duplicate` in [invocations.py](../../../velara-api/app/api/v1/invocations.py) — takes the same `InvocationRequest` body shape (reused as-is; no new request schema needed since it's identical to the real invocation payload), returns `DuplicateCheckResponse{duplicate_of: DuplicateWarning | None}`. Registered on the same router (inherits `RejectClient`).
  - [x] Added `DuplicateWarning{job_id, completed_at}` and `DuplicateCheckResponse{duplicate_of}` to [schemas/invocation.py](../../../velara-api/app/schemas/invocation.py) — additive only, `InvocationRequest`'s `extra="forbid"` input contract untouched (no new request field anywhere).

- [x] **Task 6 — Frontend: render the advisory (AC1)** — adjusted for shape (b): pre-flight call before the click, not an `onSuccess` after-the-fact banner.
  - [x] Added `checkDuplicateInvocation(skillId, payload)` + `DuplicateWarning`/`DuplicateCheckResponse` types to [api/jobs.ts](../../../velara-web/src/api/jobs.ts).
  - [x] New hook [useDuplicateCheck.ts](../../../velara-web/src/features/run/hooks/useDuplicateCheck.ts) — debounces the run payload (reusing the existing `useDebounce` hook, same 400ms-class pattern as `SkillRegistry`'s search debounce) and queries the pre-flight endpoint via `useQuery` (auto-caches/dedups, `enabled` gated on skill+payload present).
  - [x] Both `RunConsoleInner` (context-first) and `RunConsoleSkillFirstInner` (skill-first) in [RunConsole.tsx](../../../velara-web/src/features/run/components/RunConsole.tsx) now share a `buildRunPayload()` function reused by both the submit path (`handleRun`) and the new pre-flight hook call, so the two payloads can never drift. The advisory banner (`DuplicateWarningBanner`, reusing the exact `skillBlockedReason` inline-banner classes + a new local `warn` icon glyph) renders before the Run button whenever `duplicateOf` is present — i.e. **before** the click, per the chosen shape.
  - [x] "View prior result" swaps `activeJobId` via the existing `setActiveJobId` store action (same mechanism `handleRun`'s `onSuccess` already uses) — confirmed reachable via `JobStatusPanel`, per the 12.3 lesson to verify new user-facing actions are actually wired to existing routing/state.
  - [x] The banner never disables or gates the Run button — clicking Run always submits regardless of `duplicateOf` (verified by test).

- [x] **Task 7 — Backend tests (AC1, AC2, AC3)**
  - [x] Added 12 integration tests to [test_invocations.py](../../../velara-api/tests/integration/api/test_invocations.py) covering: match against a just-completed job; no-match with no prior job; no-match for queued/running/failed/cancelled prior jobs (parametrized); no-match on different inputs; no-match outside the window; fan_out requests always report no duplicate and the real fan-out endpoint is unaffected; the advisory never blocks a real run (both endpoints independently produce results); single-location context match; unknown skill_id swallowed as no-duplicate (not a 404/500). Also added 7 unit tests for `hash_inputs_payload` in [test_job_service.py](../../../velara-api/tests/unit/services/test_job_service.py) (None/empty-dict equivalence, key-order independence, value/file_ref_id sensitivity, stable hex digest shape, UUID `default=str` defensive coverage).

- [x] **Task 8 — Frontend tests (AC1)** — adjusted for shape (b): asserts the pre-flight-driven banner, not an `onSuccess`-driven one.
  - [x] Extended [RunConsole.test.tsx](../../../velara-web/src/features/run/components/RunConsole.test.tsx) with a new `useDuplicateCheck` mock (default: `duplicate_of: null`) and 7 new tests across both `RunConsoleInner`/context-first and `RunConsoleSkillFirstInner`/skill-first blocks: banner renders when a match is mocked; no banner when absent (regression, AC2); "View prior result" calls `setActiveJobId` with the prior job id; Run remains enabled and still submits with the banner showing.

- [x] **Task 9 — Gates**
  - [x] **Backend:** `ruff check .` clean; full suite 1072 passed (3 pre-existing MinIO-in-container `test_ingest.py` failures, unrelated, per project history); `python scripts/export_openapi.py` regenerated `docs/api-spec.json` — purely additive (`DuplicateWarning`/`DuplicateCheckResponse` schemas + the new `check-duplicate` path); diff committed.
  - [x] **Frontend:** `npm run typecheck` → 0 errors; `npm run lint` → 1 pre-existing `Icon.tsx` warning (baseline, unchanged); `npx vitest run` → 545/545 passed across 52 files (538 baseline + 7 new).

## Dev Notes

### Scope reality — thin BE (hash + query + wiring) + thin FE (banner), one genuine product decision (VERIFIED)

No dedup/idempotency/cache logic exists anywhere in the invocation pipeline today (confirmed by reading `invocations.py`, `job_service.py`, and `models/invocation.py` in full — the only existing "duplicate" guard is the FE's `createInvocation.isPending` double-submit guard at [RunConsole.tsx:665](../../../velara-web/src/features/run/components/RunConsole.tsx#L665), which prevents clicking Run twice on the *same* in-flight request — an entirely different concern from "did I already run this exact thing recently and get a result"). The natural hook is `queue_invocation`, immediately before each of its two `job_service.create_job(...)` call sites ([invocations.py:270](../../../velara-api/app/api/v1/invocations.py#L270) single-location LD path, [invocations.py:313](../../../velara-api/app/api/v1/invocations.py#L313) non-LD path). Inputs are already hashable — `inputs_payload` is built once at [invocations.py:186-190](../../../velara-api/app/api/v1/invocations.py#L186-L190) as `{"file_ref_ids": [...], "inputs": {...}}`, a plain JSON-serializable dict. **This story is genuinely thin on both sides** — the one place it is NOT thin is Task 5's response-shape decision, which the epic text explicitly leaves as an "or" (inline response vs. separate pre-flight endpoint) — resolve that with the user before writing FE code, not as an implementation-time guess.
[Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.4]

### The two single-job creation sites — exact hook points (VERIFIED, read in full)

`queue_invocation` in [invocations.py:134-346](../../../velara-api/app/api/v1/invocations.py#L134-L346) has **three** job-creation paths, not two:
1. **Fan-out** ([line ~229](../../../velara-api/app/api/v1/invocations.py#L229), via `execution_service.dispatch_fan_out`) — **out of scope** per Task 4's decision (a batch of children, not a single duplicate-checkable job).
2. **Location-dependent single-location** ([line ~270](../../../velara-api/app/api/v1/invocations.py#L270)) — `hierarchy_path=str(location.hierarchy_path)`, in scope.
3. **Non-location-dependent** ([line ~313](../../../velara-api/app/api/v1/invocations.py#L313)) — `hierarchy_path=hierarchy_path_str` (resolved study>project>client>"org"), in scope.

Both in-scope branches already have `skill.id`, `skill_version_str`, and a fully-resolved `hierarchy_path` string in scope by the time `create_job` is called — everything `find_recent_duplicate` needs is already local to each branch; no new data needs to be threaded in.
[Source: invocations.py:134-346, full function body]

### Why the hash is computed in Python, not SQL, and why no new column/migration

`InvocationJob.inputs` is a raw JSONB column ([invocation.py:95](../../../velara-api/app/models/invocation.py#L95)) with no functional/hash index. Two options: (a) add an `inputs_hash` column + migration + backfill, indexed for O(1) lookup; (b) filter by the cheap, already-indexed columns (`org_id`, `skill_id`, `status`, `completed_at` — all four already have B-tree indexes per [invocation.py:146-154](../../../velara-api/app/models/invocation.py#L146-L154)) plus the ltree `hierarchy_path` equality, fetch the small resulting candidate set (bounded to `LIMIT 20`), and hash-compare in Python. **Choose (b).** The composite filter (same org + same skill + same version + same exact hierarchy_path + completed + within 24h) is already highly selective in practice — this is explicitly a "thin BE" story per the epic, and a schema migration for an optimization that isn't yet needed would be scope creep. If this ever needs to scale to skills run thousands of times per day in the same context, that is a future story, not this one.
[Source: invocation.py:49-154 full model; epics/epic-12…md#Story-12.4 "Thin BE + FE" framing]

### Config precedent — mirror `MINUTES_SAVED_PER_RUN`/`BLENDED_LABOR_RATE_USD` exactly

[config.py:199-205](../../../velara-api/app/core/config.py#L199-L205) already establishes the "greenfield, config-driven, story owns it as tunable config" pattern for exactly this kind of business-logic constant (Story 9.4's analytics value metrics). `DUPLICATE_RUN_WINDOW_MINUTES` should be added the same way — a plain `Field(default=..., gt=0)` on `Settings`, no environment-specific override needed unless ops asks for one later.
[Source: config.py:150-205 — Field() convention across EXECUTION_TIMEOUT_S, HYBRID_MAX_TOOL_TURNS, MINUTES_SAVED_PER_RUN, BLENDED_LABOR_RATE_USD]

### The IP-protection contract on `InvocationRequest` — do NOT touch the request schema

[schemas/invocation.py:8-9,44](../../../velara-api/app/schemas/invocation.py#L8-L44): `InvocationRequest` uses `extra="forbid"` specifically so IP protection is structural — no field may be added to the **request** without deliberate review (a spec test locks this: `tests/integration/api/test_openapi.py`, per the schema's own docstring). This story's Task 5 response-shape work only ever touches the **response** (`InvocationAccepted`, additive `duplicate_of` field) — never `InvocationRequest`. Do not add an `override_duplicate_check` or similar request-side field; the advisory is never blocking, so there is nothing for the caller to need to override.
[Source: schemas/invocation.py:1-70 full file]

### Response-shape decision — read the epic's own "or" carefully

The epic's own AC3 language: *"evaluated in queue_invocation before create_job (**or** a pre-flight endpoint the Run Console calls)"* — this is the epic author leaving the door open for either shape, not mandating one. Given (i) no existing pre-flight-endpoint precedent exists anywhere in this codebase for invocation-adjacent checks (skill-retired/no-version gating is done client-side off already-loaded skill fields, not a server round-trip), and (ii) the "advisory, never blocking" framing in every AC strongly implies the run should proceed on click regardless of the warning — shape (a) (inline in the existing 202 response) is recommended and is the path of least new surface area. **Still confirm via AskUserQuestion before FE implementation** — this is a UX call (does the user see the warning *before* committing to spend, or *after* already having queued the run) that the story text explicitly does not resolve, and getting it wrong means redoing Task 5 and Task 6 together.

### Testing standards

- **Backend:** integration tests live in `velara-api/tests/integration/` — locate the existing invocations test module (grep for `test_invocations` or similar; the epic references `invocations.py` directly, and Story 3.7's fan-out/location tests are the closest sibling coverage to model the new tests' fixture setup on — reuse whatever seed-skill/seed-job helpers those tests already use rather than writing new ones).
- **Frontend:** Vitest + Testing Library, co-located `*.test.tsx`. `RunConsole.test.tsx` already exists and already has separate test blocks for `RunConsoleInner` and `RunConsoleSkillFirstInner` (per Story 12.2's AC4 addition) — add the new duplicate-banner case to both, following whatever mock/fixture pattern those existing blocks already use for `createInvocation.mutate`'s success payload.
- Respect the "no test exercises X" pattern established in 12.2/12.3's Dev Notes — call out explicitly in Completion Notes if any edge case (e.g. two duplicates within the window, ties on `completed_at`) is deliberately left uncovered rather than silently gapped.

### UI convention constraints (house rules)

- **No emoji/unicode icons.** Use `<Icon name="..." />` — the advisory banner should reuse an existing icon (`clock`/`warn`/`refresh` are all already in the registry per [Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx) — `warn` reads most correctly for an advisory). [Source: project memory — No Emoji Icons]
- **Tailwind-v4 tokens only.** Reuse the existing inline-banner classes (`rounded-lg border border-line bg-surface px-[22px] py-4 text-sm text-muted`) already used for `skillBlockedReason` — do not invent new banner styling.
- **Reuse, don't rebuild:** this is a data/query addition + one new banner block, not a new screen or route. No new component library entry needed.

### Project Structure Notes

- **Backend** changes: [app/api/v1/invocations.py](../../../velara-api/app/api/v1/invocations.py) (hash computation + duplicate-check call at both single-job sites), [app/services/job_service.py](../../../velara-api/app/services/job_service.py) (new `find_recent_duplicate`), [app/core/config.py](../../../velara-api/app/core/config.py) (new `DUPLICATE_RUN_WINDOW_MINUTES`), [app/schemas/invocation.py](../../../velara-api/app/schemas/invocation.py) (new `DuplicateWarning` + additive `InvocationAccepted.duplicate_of`), [docs/api-spec.json](../../../velara-api/docs/api-spec.json) (regenerated), tests. **No migration** (no new column — see Dev Notes rationale).
- **Frontend** changes: [src/api/jobs.ts](../../../velara-web/src/api/jobs.ts) (extend `JobRef`), [src/features/run/components/RunConsole.tsx](../../../velara-web/src/features/run/components/RunConsole.tsx) (both `handleRun` success handlers + new banner render block), tests.
- **Two nested repos:** `velara-api` and `velara-web` are separate git repos nested under the top-level `velara` (which holds `_bmad-output` docs). Both repos' working trees are currently **clean and committed** as of this story's creation (12.1/12.2/12.3 all landed as real commits: `velara-web` `2d48024`/`495065b`/`366ffb6`; `velara-api` `27d60aa` for 12.2's backend half — 12.1/12.3 were FE-only, no `velara-api` commit needed). Both repos are a few commits ahead of `origin/main` (unpushed) — not this story's concern to push those; commit this story's own changes as new commits on top. [Source: project memory — velara-web is a separate nested git repo]

### Previous Story Intelligence (Story 12.3 — Distinct Audit Event Icons)

- 12.3 was FE-only (icon map) and shipped clean — no backend touched, so no direct code-path overlap with this story.
- 12.3's dev agent found and fixed a **scope gap the story text didn't anticipate**: a new event type without a corresponding filter-pill option (added a `Provisioning` pill to `eventKindMeta.ts` as a same-day follow-up after review). **Lesson for this story:** if the advisory banner surfaces information the user would reasonably want to act on (e.g. "view prior result"), make sure that action is actually reachable with existing routing/state — don't assume a `setActiveJobId` swap is sufficient without checking how `activeJobId` is consumed elsewhere in `RunConsole.tsx` first.
- 12.3 established the `it.each`-driven rendering-assertion technique (query rendered SVG `<path d>` and compare to `ICONS[name]`) as the house style for icon-presence tests — reuse this exact technique in Task 8 if the advisory banner includes an icon.
- Gates baseline from 12.3 (for regression comparison after this story): `tsc --noEmit` 0 errors; `eslint` 1 pre-existing `Icon.tsx` warning (baseline); `vitest` 538/538 passing (after the Provisioning-pill follow-up).

### Git Intelligence Summary

Recent `velara-web` commits (`366ffb6` "Story 12.3", `2d48024` "Story 12.1", `495065b` "Story 12.2", plus the Epic 10 stories before them) confirm the commit convention `feat(<area>): Story <id> — <short title> (Epic <n>)`. Recent `velara-api` commits (`27d60aa` "Story 12.2 — backend-enriched hierarchy context names") show the same convention on the backend side. This story, touching both repos, should land as two separate commits (one per repo) following this convention, e.g. `feat(invocations): Story 12.4 — duplicate-run cost warning (Epic 12)` in `velara-api` and `feat(run): Story 12.4 — duplicate-run advisory banner (Epic 12)` in `velara-web`.

### Sequencing / dependencies

- **Final story of Epic 12** (12.1 → 12.2 → 12.3 all done; epic already `in-progress`). After this story's review, Epic 12 is complete 4/4 — a retrospective may follow per the established Epic pattern (see prior epic retros in project memory).
- **Independent of Epic 11** — no dependency.
- **Adjacent to nothing in this epic** — 12.1 (skill form toggle), 12.2 (audit context names), 12.3 (audit icons) all touch unrelated surfaces (skill authoring / audit log). This story is the first Epic 12 story to touch `invocations.py`/`job_service.py`/`RunConsole.tsx`'s Run flow directly.

### References

- [Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.4] — story, ACs, "thin BE + FE" reality note, the explicit hook-point "or" language.
- [Source: velara-api app/api/v1/invocations.py:134-346] — `queue_invocation` full body: the 3 job-creation paths, existing `inputs_payload` construction, both in-scope hook points.
- [Source: velara-api app/services/job_service.py:104-254] — `create_job`, `list_children`, `list_jobs` — query-helper style and index-aware filtering pattern to mirror for `find_recent_duplicate`.
- [Source: velara-api app/models/invocation.py:49-154] — `InvocationJob` full model: existing indexes (org_id, skill_id, status, created_at), the `inputs` JSONB column, why no new column is needed.
- [Source: velara-api app/schemas/invocation.py] — `InvocationRequest`'s `extra="forbid"` IP-protection contract; where `DuplicateWarning`/`duplicate_of` must NOT touch the request side.
- [Source: velara-api app/core/config.py:150-205] — `Field(default=..., gt=0)` config convention; `MINUTES_SAVED_PER_RUN`/`BLENDED_LABOR_RATE_USD` as the direct precedent for a new greenfield tunable.
- [Source: velara-web src/api/jobs.ts:9-22] — `InvocationPayload`/`JobRef` wire types to extend.
- [Source: velara-web src/features/run/components/RunConsole.tsx:340-467,578-810] — both `handleRun` implementations (`RunConsoleInner` context-first, `RunConsoleSkillFirstInner` skill-first), the existing double-submit guard, the `skillBlockedReason` banner pattern to reuse.
- [Source: velara-web src/features/run/hooks/useCreateInvocation.ts] — the mutation hook wrapping `createInvocation`.
- [Source: velara-web src/shared/utils/errors.ts:34-51] — `friendlyInvocationError`/`INVOCATION_ERROR_MESSAGES` pattern (for reference; this story adds an advisory, not a new error code, so this map is not directly extended, but its shape confirms how invocation-adjacent messaging is conventionally handled).
- [Source: project memory — velara-web is a separate nested git repo]
- [Source: _bmad-output/implementation-artifacts/stories/12-3-distinct-audit-event-icons.md] — previous story full file (Dev Agent Record, Completion Notes, Change Log) — gates baseline, the "check reachability of any new user-facing action" lesson.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

None — no blocking failures. One test-authoring mistake was caught and fixed inline: `test_check_duplicate_fan_out_request_unaffected` initially posted directly to the real fan-out invocation endpoint without patching `run_skill`/the celery chord dispatch, causing a real 500 (unrelated to the story's logic — a test-fixture gap). Fixed by reusing the existing `_post_fan_out` helper (which patches `celery.chord`) instead of a raw `client.post`, matching the pattern every other fan-out test in the module already uses.

### Completion Notes List

- **Product decision resolved via `AskUserQuestion` before any FE work** (per Dev Notes' explicit gate): user chose response shape **(b) — a separate pre-flight endpoint** (`POST /api/v1/invocations/{skill_id}/check-duplicate`), not the Dev Notes' recommended shape (a) inline-in-202-response. Rationale given: the warning must be visible **before** the Run click (potentially informing whether to click at all), not only after the job is already queued. This changed the shape of Tasks 4/5/6 from what the story text originally sketched — recorded in each task's notes above and in the sprint-status transition log.
- Because of the shape (b) pivot, `queue_invocation`'s real job-creation path is **behaviorally unchanged** — the duplicate check never touches job creation, dispatch, or the 202 response. The only change to `queue_invocation` is a pure refactor: the location/context hierarchy-resolution logic for the two single-job branches was extracted into `_resolve_single_job_hierarchy_path(...)` so the new pre-flight endpoint can resolve the identical hierarchy_path without duplicating ~60 lines of branching logic. All pre-existing `queue_invocation` tests pass unmodified, confirming no behavior change.
- The pre-flight endpoint reuses `InvocationRequest` as its own request body (rather than a new schema) since the payload it needs (file_ref_ids/inputs/location_id/study_id/project_id/client_id/fan_out) is identical to the real invocation payload — this also means the FE's `buildRunPayload()` output can be posted to either endpoint unchanged.
- Fan-out requests (`fan_out=True`) always report `duplicate_of: null` from the pre-flight endpoint and are otherwise fully unaffected — confirmed by a dedicated test that exercises both the pre-flight call and the real fan-out submission in the same test.
- The pre-flight check never surfaces an error to the caller (unknown skill_id, resolution failures, DB errors, etc. are all swallowed and reported as `duplicate_of: null`) — verified by a dedicated test posting to a nonexistent skill_id and asserting 200 with `duplicate_of: null`, not a 404.
- No migration, no new request-side schema field (IP-protection `extra="forbid"` contract on `InvocationRequest` untouched), no changes to the fan-out dispatch path.
- Gates: Backend `ruff check .` clean; full suite 1072 passed / 3 pre-existing unrelated `test_ingest.py` MinIO-in-container failures (documented in project history, not touched by this story); `python scripts/export_openapi.py` regenerated `docs/api-spec.json` purely additively. Frontend `tsc --noEmit` 0 errors; `eslint` 1 pre-existing `Icon.tsx` warning (baseline); `vitest` 545/545 across 52 files (538 baseline + 7 new).
- Both `velara-api` and `velara-web` are separate nested git repos under the top-level `velara` — this story's backend and frontend changes are uncommitted in their respective repos as of Dev Agent Record write-time; they should land as two separate commits per the established `feat(<area>): Story <id> — <short title> (Epic <n>)` convention.
- Final story of Epic 12 (4/4). After review, a retrospective may follow per the established epic pattern.

### File List

**velara-api:**
- `app/api/v1/invocations.py` — new `_resolve_single_job_hierarchy_path` helper (extracted from `queue_invocation`, zero behavior change); new `POST /{skill_id}/check-duplicate` endpoint (`check_duplicate`). *Code review:* `check_duplicate` now passes `inputs_payload` to `find_recent_duplicate` (not a pre-computed hash).
- `app/services/job_service.py` — new `hash_inputs_payload(inputs_payload)`; new `async def find_recent_duplicate(...)`. *Code review:* new `_resolve_file_ref_content_hashes` helper (resolves `file_ref_ids` → `content_sha256` before hashing); `find_recent_duplicate` now takes `inputs_payload` and resolves both the request and each candidate through content hashes before comparing.
- `app/services/ingest_service.py` — *Code review:* `confirm_file_ref` now computes and persists `content_sha256` from the full uploaded bytes.
- `app/models/file_ref.py` — *Code review:* new `FileReference.content_sha256` column.
- `app/db/migrations/versions/0021_file_ref_content_hash.py` — *Code review, new file:* adds `file_references.content_sha256` (nullable, indexed).
- `app/schemas/invocation.py` — new `DuplicateWarning`, `DuplicateCheckResponse` schemas.
- `app/core/config.py` — new `DUPLICATE_RUN_WINDOW_MINUTES` setting.
- `docs/api-spec.json` — regenerated (additive: new schemas + new path; unaffected by the code-review fix — internal-only change).
- `tests/integration/api/test_invocations.py` — 12 new tests (Story 12.4 duplicate-run advisory section) + `_run_to_completion` test helper; 1 pre-existing test's fan-out-submit call fixed to use `_post_fan_out` for correctness. *Code review:* +2 new tests (`test_check_duplicate_matches_on_file_content_hash_not_raw_upload_id`, `test_check_duplicate_no_match_for_genuinely_different_file_content`) + `_seed_parsed_file_ref`/`_post_invocation_and_mark_completed` helpers.
- `tests/unit/services/test_job_service.py` — 7 new tests for `hash_inputs_payload`.
- `tests/unit/services/test_ingest_service.py` — *Code review:* +1 new test (`test_confirm_success_sets_content_sha256_from_uploaded_bytes`); `_make_file_ref` fixture gained `content_sha256`.

**velara-web:**
- `src/api/jobs.ts` — new `DuplicateWarning`, `DuplicateCheckResponse` types; new `checkDuplicateInvocation(skillId, payload)` API function.
- `src/features/run/hooks/useDuplicateCheck.ts` — new hook (debounced pre-flight query).
- `src/features/run/components/DocumentUploadCard.tsx` — *Code review:* new `onUploadingChange` prop, fired whenever the upload's `isProcessing` state changes.
- `src/features/run/components/DocumentUploadCard.test.tsx` — *Code review, new file:* 7 tests covering `onUploadingChange` across idle/each-processing-phase/ready.
- `src/features/run/components/RunConsole.tsx` — new local `warn` icon glyph; new `DuplicateWarningBanner` + `formatCompletedAt` helpers; both `RunConsoleInner` and `RunConsoleSkillFirstInner` gained a shared `buildRunPayload()` (refactor, reused by submit + pre-flight check) and render the advisory banner before the Run button. *Code review:* both components now track `isUploadingDoc` and suspend the duplicate-check payload/banner while a document is actively uploading.
- `src/features/run/components/RunConsole.test.tsx` — new `useDuplicateCheck` mock; 7 new tests across both context-first and skill-first blocks. *Code review:* new `useIngest` mock + 1 new test confirming the banner is suspended mid-upload.

### Review Findings

- [x] [Review][Decision→Patch] **`file_ref_id` is a random UUID per upload, not content-addressed — AC1's duplicate warning was structurally unreachable for any run involving an uploaded document** [job_service.py:hash_inputs_payload](../../../velara-api/app/services/job_service.py), [ingest_service.py:create_file_ref](../../../velara-api/app/services/ingest_service.py#L190). Two uploads of byte-identical content always minted two different `file_ref_id` UUIDs, so `hash_inputs_payload` could never match a prior completed run's file, no matter how identical the re-uploaded document — this is the exact bug reported (warning flashed then vanished, Run always proceeded with no warning after a re-upload). Resolved via `AskUserQuestion`: **content-hash the file at ingest time**. **Fixed:** new migration `0021_file_ref_content_hash` adds `FileReference.content_sha256` (nullable, indexed); `ingest_service.confirm_file_ref` now hashes the full uploaded bytes (reusing the same `storage.get` read already needed) and persists the digest; `job_service.find_recent_duplicate` now resolves `file_ref_ids` → `content_sha256` (new `_resolve_file_ref_content_hashes` helper, batched lookup) for BOTH the incoming request and each completed-job candidate before hashing, so `check_duplicate` now passes `inputs_payload` (not a pre-computed hash) through to `find_recent_duplicate`. 2 new backend integration tests (`test_check_duplicate_matches_on_file_content_hash_not_raw_upload_id`, `test_check_duplicate_no_match_for_genuinely_different_file_content`) + 1 new unit test (`test_confirm_success_sets_content_sha256_from_uploaded_bytes`) prove the fix; pre-migration rows with `content_sha256=NULL` fall back to raw-id matching (unchanged prior behavior, not a regression).
- [x] [Review][Patch] **FE race: `DocumentUploadCard` nulled `fileRefId` synchronously on upload-start, re-firing the debounced pre-flight check against a transitional/no-file payload** [DocumentUploadCard.tsx:19-22](../../../velara-web/src/features/run/components/DocumentUploadCard.tsx#L19-L22), [RunConsole.tsx](../../../velara-web/src/features/run/components/RunConsole.tsx). **Fixed:** added `onUploadingChange` prop to `DocumentUploadCard` (fires whenever `isProcessing` changes); both `RunConsoleInner`/`RunConsoleSkillFirstInner` track `isUploadingDoc` and suspend the duplicate-check payload (and freeze `duplicateOf` to `null`) while a document is actively uploading/extracting, rather than showing a banner that answers a question about a payload the user isn't submitting. 4 new `DocumentUploadCard` tests (idle/each-processing-phase/ready) + 1 new `RunConsole` test confirming the banner is suppressed mid-upload even if a prior duplicate was found.
- [x] [Review][Patch] No test exercised a `file_ref_ids`-bearing duplicate scenario — bundled into the fix above (2 new BE integration tests + 1 new BE unit test + 5 new FE tests).
- [x] [Review][Defer] `find_recent_duplicate`'s `LIMIT 20` candidate window is shared across all distinct input variants at a given (org, skill, version, hierarchy_path) — a real duplicate can be pushed out of the top-20-most-recent-completed and silently missed [job_service.py:find_recent_duplicate](../../../velara-api/app/services/job_service.py) — deferred, documented tradeoff (advisory-only, not an exhaustive audit); revisit if a high-frequency skill/context combination shows real misses.
- [x] [Review][Defer] `check_duplicate` re-does a full skill lookup + hierarchy resolution + candidate query + Python hash loop on every debounced call (~every 400ms of active editing), with no server-side rate limit beyond the client debounce [invocations.py:check_duplicate](../../../velara-api/app/api/v1/invocations.py) — deferred, pre-existing since original implementation; revisit if load becomes a real concern.

## Change Log

- 2026-07-07: Implemented Story 12.4 — resolved the response-shape decision via `AskUserQuestion` to shape (b), a separate pre-flight `POST /api/v1/invocations/{skill_id}/check-duplicate` endpoint (not the Dev Notes' recommended inline-202 shape), so the advisory is visible before the Run click. Backend: `job_service.hash_inputs_payload` + `find_recent_duplicate`, `config.DUPLICATE_RUN_WINDOW_MINUTES`, new `DuplicateWarning`/`DuplicateCheckResponse` schemas, new pre-flight endpoint, `_resolve_single_job_hierarchy_path` extracted from `queue_invocation` as a pure refactor shared by both the real endpoint and the pre-flight one. Frontend: `useDuplicateCheck` debounced hook, shared `buildRunPayload()` in both RunConsole modes, `DuplicateWarningBanner` shown before the Run button. 12 new backend integration tests + 7 new unit tests; 7 new frontend tests. Gates: ruff clean, BE 1072/1072 (3 pre-existing unrelated), openapi spec regenerated additively; FE tsc 0, eslint 1 pre-existing warning, vitest 545/545. Final story of Epic 12 (4/4) → status review.
- 2026-07-07 (follow-up): Raised `DUPLICATE_RUN_WINDOW_MINUTES` default from 1440 (24h) to 10080 (7 days) per explicit user feedback — a day was judged too short a window for the advisory to be practically useful. Config-only change (no code/schema/migration impact); the outside-window test already reads the setting dynamically so no test changes were needed. Gates re-run: ruff clean, BE 87/87 (invocations + job_service modules), openapi spec unchanged (config values aren't part of the spec).
- 2026-07-07 (code review): 3-layer adversarial review (Blind/Edge/Auditor) all independently converged on the same root cause behind a user-reported production bug ("re-uploading the exact same document briefly flashed the warning, then it disappeared once extraction finished, and Run proceeded with no warning"): `file_ref_id` is a random UUID minted per upload (`ingest_service.create_file_ref`), not content-addressed, so `hash_inputs_payload` could never match two uploads of byte-identical content — AC1's duplicate warning was structurally unreachable for any run involving a document. Resolved via `AskUserQuestion`: **content-hash files at ingest.** New migration `0021_file_ref_content_hash` (`FileReference.content_sha256`, nullable/indexed); `confirm_file_ref` now hashes the full uploaded bytes (reusing the existing `storage.get` read) and persists the digest; new `job_service._resolve_file_ref_content_hashes` resolves `file_ref_ids` → content hashes for both the incoming request and each completed-job candidate before comparing (`find_recent_duplicate` now takes `inputs_payload`, not a pre-computed hash). Also fixed the FE race that caused the "flash then disappear": `DocumentUploadCard` gained an `onUploadingChange` prop so `RunConsole` can suspend the duplicate-check banner while a document is actively uploading/extracting, instead of re-firing the check against a transitional no-file payload. 1 decision (content-hash vs. document-known-limitation vs. scope-out — user chose content-hash), 2 patches (bundled into the same fix: FE race + missing file-ref test coverage), 2 deferred (LIMIT 20 candidate-window gap, no server-side rate limit on the debounced endpoint), rest dismissed as speculative/non-issues. New tests: 2 BE integration (content-hash match / no-match), 1 BE unit (`confirm_file_ref` sets `content_sha256`), 5 FE (`DocumentUploadCard` upload-state ×4, `RunConsole` banner-suspended-mid-upload ×1). Gates re-run: BE ruff clean, migration applied clean, full suite 1075/1078 (3 pre-existing unrelated `test_ingest.py` MinIO-in-container failures), openapi spec unchanged (internal-only fix); FE tsc 0, eslint 1 pre-existing warning, vitest 553/553. Final story of Epic 12 (4/4) → status done.
