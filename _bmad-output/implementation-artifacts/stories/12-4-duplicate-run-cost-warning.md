---
baseline_commit: 366ffb69d33dab2cd0b3d17ce97fd9c19c9b7d09
---

# Story 12.4: Duplicate-Run Cost Warning (Advisory)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a consultant,
I want a warning when I'm about to run a skill with the same inputs in the same context as a recent completed run,
so that I don't spend AI budget on a duplicate.

## Acceptance Criteria

1. **AC1 — Advisory warning on a matching recent completed run.**
   **Given** a run request for `(skill_id, skill_version, resolved hierarchy_path, inputs-hash)`
   **When** a **completed** job with the exact same `(skill_id, skill_version, hierarchy_path, inputs-hash)` exists and finished within a recent window (config-driven, default 24h)
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

- [ ] **Task 1 — Add a stable, deterministic inputs-hash to the invocation pipeline (AC1, AC3)**
  - [ ] In [invocations.py](../../../velara-api/app/api/v1/invocations.py), after `inputs_payload` is built (around [line 186-190](../../../velara-api/app/api/v1/invocations.py#L186-L190)), compute a hash over the **stable-sorted-key JSON** of `inputs_payload` (or `{}` if `inputs_payload is None`) — `hashlib.sha256(json.dumps(inputs_payload or {}, sort_keys=True, default=str).encode()).hexdigest()`. `sort_keys=True` is required: Python dict insertion order is not guaranteed to be identical between two otherwise-identical requests, and an unsorted-key hash would silently fail to match semantically-identical inputs. `default=str` covers the one non-JSON-native type in the payload (`uuid.UUID`s inside `file_ref_ids` are already `str(fid)`-cast at build time, so this is a defensive no-op, not a load-bearing conversion).
  - [ ] This hash is computed **once**, in `queue_invocation`, on the same `inputs_payload` variable both the single-job and fan-out branches already consume — do not duplicate the hash computation per branch.

- [ ] **Task 2 — Add a duplicate-check query function to `job_service` (AC1, AC2, AC3)**
  - [ ] Add `async def find_recent_duplicate(*, session, org_id, skill_id, skill_version, hierarchy_path, inputs_hash, window_minutes) -> InvocationJob | None` in [job_service.py](../../../velara-api/app/services/job_service.py) (alongside `list_jobs`/`list_children` — same file, same query-helper style). Query: `InvocationJob.org_id == org_id AND InvocationJob.skill_id == skill_id AND InvocationJob.skill_version == skill_version AND InvocationJob.hierarchy_path == hierarchy_path AND InvocationJob.status == JOB_STATUS_COMPLETED AND InvocationJob.completed_at >= (now - window_minutes)`, ordered by `completed_at DESC`, `LIMIT 1`.
  - [ ] **The `inputs_hash` is NOT a column** — `InvocationJob.inputs` is the existing JSONB column ([invocation.py:95](../../../velara-api/app/models/invocation.py#L95)), un-indexed for hash lookup. Compute the hash **in Python** on each of a small number of `org_id`+`skill_id`+`skill_version`+`hierarchy_path`+`status`+recency-filtered candidate rows (that composite filter is already highly selective — a given skill/version/context/recent-completed set is small) and compare in the service function, rather than trying to filter by hash in SQL. Do **not** add a new `inputs_hash` column/migration for this — the story is scoped as "thin BE", and computing the hash over a handful of already-fetched candidate rows is cheap and requires no schema change. If profiling ever shows this query path is hot, an indexed hash column is a future optimization, not this story's scope.
  - [ ] Query pattern to mirror: [list_jobs](../../../velara-api/app/services/job_service.py#L203-L254)'s `select(...).where(*conditions).order_by(...).limit(...)` shape — but this one only needs a handful of matching rows (same skill+version+context+completed+recent), not a paginated page, so `.limit(20)` as a sane upper bound on the candidate set before hashing in Python is enough (a given skill/context pair completing >20 times in the default 24h window is already an edge case the advisory doesn't need to handle exhaustively — the point is to catch the common "I just ran this, did I run it again" case, not build an exhaustive audit).

- [ ] **Task 3 — Config: recency window (AC1)**
  - [ ] Add `DUPLICATE_RUN_WINDOW_MINUTES: int = Field(default=1440, gt=0)` to [Settings in config.py](../../../velara-api/app/core/config.py) (1440 min = 24h), following the exact `Field(default=..., gt=0)` convention already used for `MINUTES_SAVED_PER_RUN`/`EXECUTION_TIMEOUT_S` etc. — greenfield, config-driven, no migration.

- [ ] **Task 4 — Wire the check into `queue_invocation`, both branches (AC1, AC2, AC3)**
  - [ ] In [invocations.py queue_invocation](../../../velara-api/app/api/v1/invocations.py#L134), **after** `hierarchy_path_str`/`location.hierarchy_path` is resolved for **both** the location-dependent single-job branch ([line ~269](../../../velara-api/app/api/v1/invocations.py#L269)) and the non-LD branch ([line ~311](../../../velara-api/app/api/v1/invocations.py#L311)) but **before** their respective `job_service.create_job(...)` calls, call `job_service.find_recent_duplicate(...)`. **Do not** add the check to the fan-out branch (`dispatch_fan_out`) — a fan-out is a batch of per-location jobs, and "did I already fan out this exact batch" is a materially different (and much rarer) question than "did I already run this single job"; scope this story to the two single-job creation paths only, matching the epic's "no dedup/idempotency logic exists for invocations anywhere" framing which is itself about the common single-run case.
  - [ ] If a duplicate is found, attach the match to the response so the caller can render the advisory — see Task 5 for the response-shape decision.
  - [ ] The check must **never raise** or block job creation — if the duplicate lookup itself fails for any reason, log and proceed as if no duplicate was found (advisory-only per AC1/AC3; a lookup bug must never prevent a legitimate run).

- [ ] **Task 5 — Response shape: advisory info returned alongside/instead-of immediate queueing (AC1, AC3 — DECISION NEEDED)**
  - [ ] **This AC requires a genuine product decision the epic text leaves open** ("or a pre-flight endpoint the Run Console calls"). Two viable shapes exist; **use `AskUserQuestion` to confirm before implementing** if not already resolved by the time this task is reached:
    - **(a) Inline in the existing 202 response:** `queue_invocation` still queues+dispatches the job immediately (unchanged today's behavior — no extra latency, no extra round-trip), but `InvocationAccepted` gains an optional `duplicate_of: DuplicateWarning | None` field (`{job_id: uuid, completed_at: datetime}`) populated when a match is found. The FE queues the run exactly as it does today (fire-and-forget submit) but the success handler additionally checks for `duplicate_of` and shows a dismissible advisory banner/toast alongside navigating to the new job — "This looks identical to a run that finished at HH:MM — [view result]". **Never blocks; the new job runs regardless.**
    - **(b) Pre-flight, separate from submission:** a new `GET`/`POST` pre-flight endpoint (e.g. `POST /api/v1/invocations/{skill_id}/check-duplicate`) the Run Console calls on the same debounced trigger it uses today for other pre-flight state (skill retired/no-version checks are already client-side via `skill.lifecycle_state`/`current_version_id`, so there is no existing BE pre-flight precedent to mirror) — FE shows the advisory banner **before** the user clicks Run, and Run still queues normally when clicked (advisory never blocking).
    - **Recommendation: (a).** It requires no new endpoint, no new FE pre-submission round-trip, and keeps "click Run → job queues" as an unconditional single action (matching every existing invocation flow in the codebase — there is no precedent anywhere in Run Console for a confirm-then-submit two-step). The advisory becomes informational context attached to the same response the FE already handles in `onSuccess`. Only pick (b) if the user, when asked, explicitly wants the warning to appear **before** the click (i.e. wants to potentially deter the click itself, not just inform after submission) — this is a genuine UX tradeoff, not a technical constraint, hence the explicit decision gate.
  - [ ] Whichever shape is chosen, add `DuplicateWarning` to [schemas/invocation.py](../../../velara-api/app/schemas/invocation.py) as a small Pydantic model (`job_id: uuid.UUID`, `completed_at: datetime`) — additive, does not touch `InvocationRequest`'s `extra="forbid"` input contract (Task 5 only touches the **response**, never adds an input field, preserving the IP-protection guarantee at [invocation.py:8-9](../../../velara-api/app/schemas/invocation.py#L8-L9)).

- [ ] **Task 6 — Frontend: render the advisory (AC1)**
  - [ ] Extend `InvocationAccepted`'s FE mirror — `JobRef` in [api/jobs.ts](../../../velara-web/src/api/jobs.ts#L19-L22) — with the optional `duplicate_of?: { job_id: string; completed_at: string } | null` field (assuming Task 5 resolves to shape (a); adjust if (b) is chosen).
  - [ ] In both `handleRun`'s `onSuccess` callbacks ([RunConsole.tsx:475](../../../velara-web/src/features/run/components/RunConsole.tsx) context-first mode, and the skill-first mode's equivalent around line ~697), after `setActiveJobId(job.job_id)`, check `job.duplicate_of` and if present set a new local state (e.g. `duplicateWarning`) that renders a dismissible advisory banner — reuse the existing inline-banner visual pattern already used for `skillBlockedReason` ([RunConsole.tsx:625-631](../../../velara-web/src/features/run/components/RunConsole.tsx#L625-L631): `rounded-lg border border-line bg-surface px-[22px] py-4 text-sm text-muted` + `<Icon>`), not a new component. Include a link/button to view the prior job (`setActiveJobId(job.duplicate_of.job_id)` swap, or a `/internal/jobs/{id}`-style navigation if one exists — check current routing before inventing a new one).
  - [ ] The banner is purely advisory — it does not prevent `activeJobId`/`runMode` from being set to the **new** job; the new run proceeds and displays exactly as it does today. The banner is additive UI on top of the unchanged success path.

- [ ] **Task 7 — Backend tests (AC1, AC2, AC3)**
  - [ ] Add tests to the invocations integration test module (locate the existing `test_invocations*.py` under `velara-api/tests/integration/` — mirror its fixture/session style). Cover: (1) identical `(skill_id, version, hierarchy_path, inputs)` as a just-completed job within the window → response carries `duplicate_of` pointing at the prior job; (2) same triple but the prior job is `queued`/`running`/`failed`/`cancelled` (not `completed`) → no `duplicate_of` (AC2 — only completed jobs count as "already got the answer"); (3) same skill+context but **different** `inputs` → no `duplicate_of` (hash differs); (4) a completed match **outside** the window (`completed_at` older than `DUPLICATE_RUN_WINDOW_MINUTES`) → no `duplicate_of`; (5) fan-out requests are unaffected (no duplicate check fires on that branch, matching Task 4's scope decision) — job still creates/dispatches normally.
  - [ ] Assert the check truly never blocks: even with a duplicate found, the new job is still created in `queued` status and dispatched (the response includes both the new `job_id` **and** the `duplicate_of` info — never one instead of the other).

- [ ] **Task 8 — Frontend tests (AC1)**
  - [ ] Extend `RunConsole.test.tsx` (both `RunConsoleInner`/context-first and `RunConsoleSkillFirstInner`/skill-first test blocks) with a case asserting: when `createInvocation.mutate`'s success payload includes `duplicate_of`, the advisory banner renders with the prior job's completion time; when absent, no banner renders (regression coverage for the unchanged default path — AC2's FE-side counterpart).

- [ ] **Task 9 — Gates**
  - [ ] **Backend:** `ruff check .` clean; new/existing invocation integration tests green against a reachable test Postgres; `python scripts/export_openapi.py` regenerates `docs/api-spec.json` (additive `duplicate_of`/`DuplicateWarning` fields only) — commit the diff (the `openapi` CI job diff-checks this file).
  - [ ] **Frontend:** `npm run typecheck` → 0 errors; `npm run lint` → clean (1 pre-existing `Icon.tsx` warning is baseline); `npm test` → all pass including the new banner-rendering assertions.

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

### Debug Log References

### Completion Notes List

### File List
