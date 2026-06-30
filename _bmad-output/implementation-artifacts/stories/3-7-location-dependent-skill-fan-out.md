---
baseline_commit: 74b296a0530406c828b779b6e41b82da4e26e5fe
---
# Story 3.7: Location-Dependent Skill Fan-Out

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want location-dependent skills to either prompt me to select a location or fan out across all locations in a study,
so that site-specific skill invocations produce per-site outputs with a single trigger and a complete audit trail.

> **Sequencing note:** This is an Epic 3 story deliberately deferred until Epic 4 (Engagement Hierarchy) landed — it needs real Locations to fan out over. Epic 4 is now **done** (4-1 hierarchy data model + Location entities + ltree paths shipped). This story is the bridge between Epic 3 (execution engine) and Epic 5 (Run Console): Epic 5 Story 5-4's fan-out UI ("X of N locations complete", results grouped by location) depends on the parent/children API this story delivers.

## Acceptance Criteria

> Verbatim from `_bmad-output/planning-artifacts/epics/epic-3-skill-execution-engine.md#Story 3.7`. BDD format.

**AC1 — Location required when missing**
**Given** a skill has `location_dependent: true` and is invoked within a Study context without a location selected
**When** the invocation request is received
**Then** the API returns HTTP 422 with `{"error": {"code": "LOCATION_REQUIRED", "message": "This skill requires a location selection.", ...}}` — the caller must re-submit with `location_id` or `fan_out: true`

**AC2 — Single location**
**Given** the invocation is submitted with a specific `location_id`
**When** the skill executes
**Then** the location's postal code and metadata are injected into the skill context and the skill runs for that single location

**AC3 — Fan-out dispatch**
**Given** the invocation is submitted with `fan_out: true` on a study with N locations
**When** `execution_service` processes it
**Then** N Celery `run_skill` tasks are dispatched in parallel (one per location) as a chord, each receiving that location's postal code and metadata

**AC4 — Aggregation**
**Given** all N fan-out tasks complete
**When** the `aggregate_results` chord callback runs
**Then** the results are merged into a single parent job record; each child result is linked to its location and stored in `invocation_results`

**AC5 — Parent job exposes children**
**Given** a fan-out job completes
**When** I call `GET /api/v1/jobs/{parent_job_id}`
**Then** the response includes a `children` array with one entry per location, each showing `location_id`, `location_name`, `status`, and output reference

**AC6 — Audit trail (parent + children)**
**Given** a fan-out job has N child invocations
**When** I check the audit log
**Then** one parent audit log entry exists with `fan_out: true` and N child entries, each referencing the parent `invocation_id`

## Tasks / Subtasks

- [x] **Task 1 — Add `location_dependent` to the Skill model + migration 0012 (AC1)**
  - [x] Add `location_dependent: Mapped[bool]` to `app/models/skill.py` (`nullable=False`, `server_default=text("false")`), placed near `scope`/`requires`. No index needed (boolean filter).
  - [x] Create `app/db/migrations/versions/0012_skill_location_dependent.py` with `down_revision = "0011"`. Use `op.add_column("skills", sa.Column("location_dependent", sa.Boolean(), nullable=False, server_default=sa.text("false")))` and drop it in `downgrade`. Mirror the column-add structure of `0010_skill_requires.py` (but Boolean, no GIN index). [Named `0012_location_fan_out.py` since it spans two tables.]
  - [x] Expose it on the Pydantic schemas in `app/schemas/skill.py`: `location_dependent: bool = False` on `SkillCreate`, `location_dependent: bool` on `SkillRead`, and `location_dependent: bool | None = None` on `SkillMetadataUpdate` (PATCH). Wire it through `skill_service` create/update the same way `scope`/`requires` are handled.
  - [x] Verify migration round-trip in Docker: upgrade head → downgrade -1 → upgrade head, all clean.

- [x] **Task 2 — Add fan-out linkage columns to `InvocationJob` + same migration 0012 (AC4, AC5, AC6)**
  - [x] Add to `app/models/invocation.py` `InvocationJob`:
    - `parent_job_id: Mapped[uuid.UUID | None]` — `ForeignKey("invocation_jobs.id")`, nullable, **no** ondelete CASCADE (history survives). Self-referential FK.
    - `location_id: Mapped[uuid.UUID | None]` — nullable; **no FK** to `locations` (jobs/audit must survive location deletion, matching the `skill_id` no-CASCADE convention; store the id as a bare UUID). Document this choice in a comment.
    - `fan_out: Mapped[bool]` — `nullable=False`, `server_default=text("false")` (mirrors the audit column; lets the parent be identified without walking children).
  - [x] Add `Index("idx_invocation_jobs_parent_job_id", "parent_job_id")` (children-by-parent lookup is the hot path for AC5).
  - [x] Add these columns in `0012_location_fan_out.py` — three `op.add_column` on `invocation_jobs` + the index. Keep all adds in the one 0012 migration.

- [x] **Task 3 — Extend the invocation request schema + endpoint (AC1, AC2, AC3)**
  - [x] `app/schemas/invocation.py` `InvocationRequest`: add `location_id: uuid.UUID | None = None` and `fan_out: bool = False`. [Mutual exclusion is enforced in the endpoint, not a model validator, so it yields the stable `INVOCATION_AMBIGUOUS_LOCATION` code rather than a generic `VALIDATION_ERROR`.]
  - [x] `app/api/v1/invocations.py` `invoke_skill` — location-resolution block inserted after file-ref validation, before `create_job`:
    - [x] `skill.location_dependent` False → ignore `location_id`/`fan_out`, single job `hierarchy_path="org"` (no regression).
    - [x] location-dependent + neither → `LocationRequiredError` (422 `LOCATION_REQUIRED`).
    - [x] `location_id` given → `hierarchy_service.get_location(...)`, single job with location's `hierarchy_path` + injected metadata (AC2).
    - [x] `fan_out: true` → `study_id` required (else `STUDY_REQUIRED`); `get_study` + `list_locations`; zero → `NO_LOCATIONS_IN_STUDY`; else `dispatch_fan_out` (parent + chord).
  - [x] Keep the existing file-ref validation, version resolution, and dispatch-failure→`mark_failed` safety net intact for every path.

- [x] **Task 4 — Fan-out orchestration: parent job + Celery chord + `aggregate_results` (AC3, AC4)**
  - [x] `execution_service.dispatch_fan_out(...)` service helper (endpoint stays thin):
    - [x] Parent `InvocationJob`: `fan_out=True`, no location, study's path, status `queued`.
    - [x] Per-location child `InvocationJob`: `parent_job_id`, `location_id`, `fan_out=False`, location's `hierarchy_path`, `inputs` = base inputs + injected location block (Task 5).
    - [x] Commit parent + all children before dispatch (`create_job(..., commit=False)` + single commit); on chord-dispatch failure mark parent + queued children failed in a fresh session.
  - [x] Dispatch with a Celery **chord**: `chord([run_skill.s(child_id) ...])(aggregate_results.s(parent_id))`. `run_skill` signature unchanged.
  - [x] Implement `aggregate_results(self, child_returns, parent_job_id)` in `execution_tasks.py` as a new `@celery.task`: `asyncio.run(_aggregate())`, re-query children by `parent_job_id` (authoritative), roll up terminal status (`completed`/`failed` + first-child or `FAN_OUT_PARTIAL_FAILURE` code), write parent `InvocationResult` summarizing children (file-by-key, no child bytes), fresh session + terminal guard + already-terminal early-bail (redelivery-safe).
  - [x] **Chord prerequisite verified:** `celery_app.py` sets `backend=settings.REDIS_URL` (confirmed non-empty); documented in the patterns doc (Task 9).

- [x] **Task 5 — Inject location metadata into skill context (AC2, AC3)**
  - [x] Location fields carried in the child/single job's `inputs["location"]` block at job-creation time (`execution_service.build_location_block`).
  - [x] `_location_context_block` prepends a `[Location Context]` section in `_run_prompt`/`_run_hybrid` (user_parts) and `_run_code` (leading document + dedicated stdin `location` key), alongside `[Document N]` blocks.
  - [x] **PHI discipline:** location block never logged at INFO (ids over content).

- [x] **Task 6 — Parent job API: expose `children` (AC5)**
  - [x] `app/schemas/job.py`: `JobChild` (`job_id`, `location_id`, `location_name`, `status`, `output_file_key`/`output_file_url`) + `children: list[JobChild] | None = None` on `JobReadWithResult`. Also exposed `fan_out`/`location_id`/`parent_job_id` on `JobRead`.
  - [x] `app/api/v1/jobs.py` `get_job`: when `fan_out=True`, `job_service.list_children` (org-scoped, oldest-first, eager result), resolve `location_name` from the child's stored location block (no extra round-trip), presign each child output. Non-fan-out jobs → `children` stays `None` (no regression).
  - [x] Child output presigning reuses the existing 24h best-effort pattern.

- [x] **Task 7 — Audit entries: parent + children (AC6)**
  - [x] `run_skill` audit writes (success + failure) pass `invocation_id=job.parent_job_id` (captured into `job_ctx`); `fan_out` defaults False for children.
  - [x] Parent entry written in `aggregate_results`: `fan_out=True`, `invocation_id=None`, `runtime_type` = the skill's real runtime, rolled-up outcome.
  - [x] Append-only trigger (migration 0006) respected — inserts only.

- [x] **Task 8 — Tests (all ACs)**
  - [x] Added to `tests/integration/api/test_invocations.py`; `_create_full_hierarchy_in_db` seeds Client→Project→Study→N Locations; `_drive_fan_out` replicates the chord (child seam w/ parent invocation_id + `aggregate_results`) at the service level.
  - [x] AC1: `LOCATION_REQUIRED`; non-location skill ignores fields (regression guard).
  - [x] AC2: single job, `location_id` set, location block persisted, postal code asserted in the LLM `user_content`.
  - [x] AC3+AC4: parent `fan_out=True` + N children w/ correct `parent_job_id`/`location_id`; after `_drive_fan_out`, parent `completed` and `result_metadata.children` has N entries. **Approach (Debug Log):** patch `celery.chord` out at dispatch + service-level drive (eager-chord not relied upon).
  - [x] AC4 edge: one child fails → parent `failed` w/ roll-up code; idempotent re-aggregate (terminal guard) writes no second result.
  - [x] AC5: `GET /jobs/{parent}` returns `children[]` w/ `location_id`/`location_name`/`status`/output ref; cross-org → 404.
  - [x] AC6: 1 parent (`fan_out=True`, `invocation_id=None`) + N children (`invocation_id=parent`, `fan_out=False`).
  - [x] Edge: zero locations → `NO_LOCATIONS_IN_STUDY`; no `study_id` → `STUDY_REQUIRED`; `location_id`+`fan_out` → `INVOCATION_AMBIGUOUS_LOCATION`.
  - [x] Gates: `ruff check` clean; full suite green in Docker (api image rebuilt); migration round-trip verified.

- [x] **Task 9 — Execution Engine Patterns doc (Epic 3 retro action item 1)**
  - [x] Created `_bmad-output/planning-artifacts/architecture/execution-engine-patterns.md` capturing: (1) asyncio.run/event-loop + service-level testing constraint; (2) terminal-state guard; (3) dispatch atomicity (commit-then-dispatch, including fan-out parent+children); (4) fresh-session-on-failure; (5) timeout sandwich; (6) file-by-key/IP discipline; (7) stable error codes; (8) fan-out chord + `aggregate_results`, result-backend requirement, parent/child job + audit linkage. Link-referenced to source files.

### Review Findings

> Code review 2026-06-12 — 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 6 ACs + 6 invariants + locked chord decision confirmed *in the test suite*, but the suite masks the Critical defect below (real chord-on-failure semantics not exercised).

**Decision-needed (resolved 2026-06-12)**

- [x] [Review][Patch] (was Decision) Single-location path ignores `study_id` and does not verify the location belongs to that study. **Resolved → patch APPLIED:** when both `location_id` and `study_id` are given, `location.study_id == study_id` is verified; else `LOCATION_STUDY_MISMATCH` (422). New test `test_single_location_with_mismatched_study_422`. [`app/api/v1/invocations.py`]
- [x] [Review][Defer] (was Decision) Skill `scope` (project/study) is not enforced against the requested study/location — within-org least-privilege gap. **Resolved → defer to Epic 8 (hierarchy-scoped RBAC):** scope enforcement is that epic's explicit subject; out of scope for this execution-engine story. Logged in deferred-work.md. [`app/api/v1/invocations.py`] — deferred
- [x] [Review][Patch] (was Decision) Location free-text (`name`/`address`/`pi_name`) rendered verbatim into the LLM `[Location Context]`. **Resolved → patch APPLIED:** `_LOCATION_CONTEXT_FIELDS` narrowed to non-PII (name/postal_code/city/hierarchy_path); `pi_name` + free-text `address` dropped from BOTH the rendered block AND the code-path stdin `location` key (new `_location_context_fields`). Full block still STORED in inputs for AC5 `location_name`. Test extended to assert PII excluded from `user_content` but present in stored inputs. [`app/services/execution_service.py`]

**Patch (all APPLIED & verified — 537 Docker tests pass, 0 regressions)**

- [x] [Review][Patch] CRITICAL — Chord body `aggregate_results` never fired when any child failed (`run_skill` re-raised; Celery 5.4 runs the chord body only if every header task succeeds → parent stranded `queued`, no roll-up/audit). **Fixed:** `run_skill` now detects fan-out children (`job_ctx["parent_job_id"]` set), captures the exception in Sentry explicitly, and RETURNS `{"status": "failed", ...}` instead of re-raising — so the chord body still fires. Single jobs still re-raise (unchanged). New test `test_fan_out_child_failure_does_not_raise` drives the REAL `run_skill` task body (fresh-loop/fresh-engine thread) and asserts return-not-raise. [`app/workers/execution_tasks.py`]
- [x] [Review][Patch] Rollup loop treated any non-`completed` child as a failure. **Fixed:** the loop now distinguishes completed / failed / cancelled / non-terminal; new codes `FAN_OUT_CANCELLED` + `FAN_OUT_INCOMPLETE`; a still-running/cancelled child no longer collapses to a generic partial failure (and non-terminal is logged). [`app/workers/execution_tasks.py`]
- [x] [Review][Patch] Parent `started_at` never set. **Fixed:** `dispatch_fan_out` now calls `mark_running` on the parent after commit so `started_at` is stamped (parent transitions queued→running→terminal like single jobs). [`app/services/execution_service.py`]
- [x] [Review][Patch] Parent audit double-write under concurrent callback redelivery. **Fixed:** the second session re-reads parent terminality and sets `we_transitioned`; the audit write is gated on this call actually performing the transition (loser bails). [`app/workers/execution_tasks.py`]
- [x] [Review][Patch] AC5 cross-org test asserted 404 on a random UUID. **Fixed:** the test now seeds a genuine `org_other` fan-out parent via `job_service.create_job` and asserts the default-org caller gets 404 — exercising `list_children`'s org-scoping branch. [`tests/integration/api/test_invocations.py`]
- [x] [Review][Patch] `DISPATCH_FAILED` net could force-fail an already-running child. **Fixed:** the net now always fails the parent (which has no task of its own, now `running`) but only fails children still in `queued`; running/terminal children are spared. [`app/services/execution_service.py`]

**Deferred**

- [x] [Review][Defer] Fan-out parent has no `celery_task_id` (the `fan_out` branch returns before the `celery_task_id` tail) → `cancel_job` cannot revoke the chord or children. Cancellation of an in-flight fan-out is unsupported. [`app/api/v1/invocations.py` fan-out branch] — deferred, cancel UX is Epic 5; not an AC of this story.

## Dev Notes

### What this story is (and is not)
- **Backend-only.** No UI. The fan-out *display* (X of N locations, grouped results) is Epic 5 Story 5-4 — this story delivers the parent/children API it consumes.
- This is a **deferred Epic 3 story**, not Epic 4 work. It re-enters the execution-engine codebase, so the asyncio/Celery/dispatch-atomicity patterns from Epic 3 apply directly.

### Architecture decision (LOCKED with Project Lead): Celery chord + `aggregate_results` callback
The chosen orchestration is the literal spec reading: dispatch the N child `run_skill` tasks as a `chord(group(...))(aggregate_results.s(parent_id))`, and the chord callback writes the merged parent result.
- **This is the first chord in the codebase** — there are currently zero `chord`/`group`/`chain`/`.s()` usages anywhere in `velara-api`. Treat the chord wiring as new infrastructure, not a copy of an existing pattern.
- **Result-backend dependency:** chord callbacks require a Celery result backend to know when the group has finished. `app/workers/celery_app.py` already configures `backend=settings.REDIS_URL`. Verify it is non-empty in the worker runtime; if it is ever unset, the callback silently never fires. Document this in the patterns doc (Task 9).
- **Testing fragility (the real cost):** under `task_always_eager=True` (how every execution test runs today — `tests/.../conftest.py`), chord callback semantics can be inconsistent across Celery versions. The safe testing approach is the established **service-level `_drive_execution` pattern** (`test_invocations.py:489-584`): drive the N children and then call `aggregate_results` logic directly on the test's own event loop, asserting the same end state, rather than relying on eager-chord callback firing. If eager chords do fire reliably in this Celery version, an integration-level assertion is a bonus — but the service-level test is the guardrail. The retro's lesson was explicit: **service-level testing, not task-level**, because `asyncio.run()` cannot nest in pytest-asyncio's loop.
- `run_skill(self, job_id: str) -> dict` is already chord-compatible (takes a string, returns a dict). Do not change its signature.

### Critical execution-engine invariants you MUST preserve (from Epic 3)
These are the patterns that took multiple stories to get right — re-deriving or breaking them is the documented failure mode:
1. **asyncio.run()/event-loop:** Celery tasks are sync; they wrap async work in `asyncio.run(_inner())`. `aggregate_results` MUST follow the exact `run_skill` structure (`asyncio.run(_aggregate())`) — never nest loops, never reuse a session across the sync/async boundary. [Source: `app/workers/execution_tasks.py:61-264` run_skill; line 264 `asyncio.run(_execute())`]
2. **Terminal-state guard:** every status transition routes through `_guard_not_terminal` so a redelivered task/callback can't flip a terminal job. `aggregate_results` may be redelivered — guard the parent transition. [Source: `app/services/job_service.py:224-241`]
3. **Dispatch atomicity (commit-then-dispatch):** `create_job` commits the queued row before `.delay()`; a broker failure can't be rolled back, so it's caught and the job is `mark_failed` in a fresh session. The fan-out path must commit parent+children before the chord dispatch, and on chord-dispatch failure mark the parent (and queued children) failed. [Source: `app/api/v1/invocations.py:82-84,135-152`]
4. **Fresh session on failure:** the failure path opens a *new* session because the first may be poisoned by a DB error. [Source: `execution_tasks.py:208-262`]
5. **File-by-key / IP discipline:** never store output bytes inline; only S3 keys travel. The parent result references children; children reference S3 keys. Skill artifact bytes are fetched-used-discarded, never logged or returned. [Source: `app/models/invocation.py` InvocationResult docstring; execution_service `_run_*`]
6. **Stable error codes:** error codes are persisted and must never be renamed. New codes added here (`LOCATION_REQUIRED`, `STUDY_REQUIRED`, `NO_LOCATIONS_IN_STUDY`, `INVOCATION_AMBIGUOUS_LOCATION`, optional `FAN_OUT_PARTIAL_FAILURE`) are SCREAMING_SNAKE_CASE and permanent once shipped. [Source: `execution_tasks.py:39-58`, `core/exceptions.py`]

### Source tree — exact files & seams

**Models / migrations**
- `app/models/skill.py` (UPDATE) — add `location_dependent: bool`. Current model has `scope`, `requires` (JSONB, migration 0010) but **no** location flag. [skill.py:35-141]
- `app/models/invocation.py` (UPDATE) — add `parent_job_id` (self-FK, no CASCADE), `location_id` (bare UUID, no FK — survives location deletion), `fan_out` (bool, server_default false) + `idx_invocation_jobs_parent_job_id`. Mirror the existing no-CASCADE rationale on `skill_id`. [invocation.py:35-119]
- `app/models/audit.py` (NO CHANGE to schema) — `AuditLogEntry` **already has** `fan_out: bool` (default False) and `invocation_id: UUID | None` (parent ref), prepositioned for exactly this story. Just populate them. [audit.py:33-100, fields at :67 (fan_out), :70 (invocation_id)]
- `app/db/migrations/versions/0012_location_fan_out.py` (NEW) — `down_revision = "0011"`. Adds the skill column + 3 invocation_jobs columns + index in one migration. Pattern reference: `0010_skill_requires.py:25-40` (column-add structure; use `sa.Boolean()` not JSONB).

**Schemas**
- `app/schemas/invocation.py` (UPDATE) — `InvocationRequest` currently only has `file_ref_ids: list[uuid.UUID] = []` and `inputs: dict | None = None`. Add `location_id`, `fan_out`, `study_id` + mutual-exclusion validator. [invocation.py:15-27]
- `app/schemas/job.py` (UPDATE) — add `JobChild` + `children` on `JobReadWithResult`. Existing: `JobRead`, `JobResult`, `OutputFileRef`, `JobReadWithResult`. [job.py:11-68]
- `app/schemas/skill.py` (UPDATE) — `location_dependent` on `SkillCreate`/`SkillRead`/`SkillMetadataUpdate`. [skill.py:150-299]

**Services**
- `app/services/hierarchy_service.py` (READ/CONSUME, no change) — the Epic 4 reads you need:
  - `get_study(session, study_id, org_id) -> Study` raises `StudyNotFoundError` (404). [:368-383]
  - `list_locations(session, study_id, org_id) -> list[Location]` org-scoped. [:491-500]
  - `get_location(session, location_id, org_id) -> Location` cascade scope-guard → `LocationNotFoundError` (404). [:470-488]
  - Cross-org reads return **404 (not 403)** — match this convention for the new error paths. [`test_hierarchy.py:336-377`]
- `app/services/execution_service.py` (UPDATE) — read the `location` block from `job.inputs` in the `_run_prompt/_run_code/_run_hybrid` context assembly; prepend `[Location Context]`. `execute_skill(session, job, llm_provider, skill_storage, output_storage, secrets_provider) -> (output_file_key, result_metadata)` is the dispatch router — fan-out happens at job-creation/dispatch level, **not** inside `execute_skill` (each child is a normal single-job execution). [:235-310; build_context_input consumed from `ingest_service.py:377-406`]
- `app/services/job_service.py` (UPDATE) — `create_job(session, skill_id, skill_version, created_by_user_id, org_id, hierarchy_path, inputs)` needs new optional params: `parent_job_id`, `location_id`, `fan_out`. Keep all existing fields. [:102-131] Reuse `mark_running/mark_completed/mark_failed/_guard_not_terminal`.
- Consider a thin `execution_service.dispatch_fan_out(...)` so the endpoint stays thin and the chord wiring is unit-testable at the service level (preferred over inlining in the route).

**API / workers**
- `app/api/v1/invocations.py` (UPDATE) — the location-resolution block slots in **after** version resolution (`invocations.py:103`) and **before** `create_job` (`:125`). Preserve the file-ref validation loop (:109-114) and the dispatch-failure safety net (:138-152). For non-location skills, the existing single-job path is unchanged. [whole file read; route `POST /api/v1/invocations/{skill_id}`]
- `app/api/v1/jobs.py` (UPDATE) — `get_job` populates `children` only when `fan_out=True`. [:37-135]
- `app/workers/execution_tasks.py` (UPDATE) — extend `run_skill` audit write to pass `invocation_id=job.parent_job_id`; add the new `aggregate_results` task (copy `run_skill`'s `asyncio.run` + fresh-session + terminal-guard skeleton). [:61-264, audit writes :186-196 & :242-253, error map :267-348]
- `app/workers/celery_app.py` (VERIFY, likely no change) — `backend=settings.REDIS_URL` already set; chords depend on it. [:17-21]

### Project Structure Notes
- Single migration **0012** spans `skills` + `invocation_jobs` (acceptable — it's one logical feature: location-dependent fan-out). Name it `0012_location_fan_out.py`, `down_revision="0011"`.
- `location_id` on `invocation_jobs` is intentionally **not** a DB FK (bare UUID) — execution/audit history must survive a location being deleted, matching the established `skill_id` no-CASCADE rationale. State this in the migration + model comment so a reviewer doesn't "fix" it into an FK.
- No new dependencies. Celery is already present; chords are a built-in primitive.
- Tests live in `tests/integration/api/test_invocations.py`; reuse `celery_eager` fixture and `_drive_execution`. Hierarchy seeding helper is in `test_hierarchy.py:85-118` (`_create_full_hierarchy`).

### Testing standards summary
- Docker-based integration suite; **rebuild the `api` image after code changes** (code is baked at build time, no source volume-mount) before asserting suite results.
- `task_always_eager=True` runs Celery inline (no Redis broker) — but for the chord callback, prefer the **service-level `_drive_execution` replication** over relying on eager-chord callback firing (see architecture decision above). Document the chosen approach in the Debug Log.
- Mock the LLM via `_patch_llm_provider()` (`test_invocations.py:172-184`) — no live Anthropic calls.
- Gates to pass: `ruff check` clean, full suite green (0 regressions), migration round-trip (upgrade→downgrade→upgrade).

### References
- [Source: _bmad-output/planning-artifacts/epics/epic-3-skill-execution-engine.md#Story 3.7] — ACs verbatim, "as a chord", `aggregate_results` callback, `children` array shape, parent+N audit entries.
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-06-12.md] — service-level testing for asyncio/Celery; dispatch atomicity; terminal-state guard; "deferred items compound"; patterns-doc action item.
- [Source: _bmad-output/implementation-artifacts/epic-4-retro-2026-06-12.md] — this story is the locked critical-path bridge to Epic 5; write the patterns doc here.
- [Source: app/workers/execution_tasks.py:61-264] — run_skill task, asyncio.run, mark_*, audit writes, error mapping.
- [Source: app/services/execution_service.py:235-310] — execute_skill dispatch router; context assembly seams.
- [Source: app/services/hierarchy_service.py:368-383,470-500] — get_study/get_location/list_locations (Epic 4).
- [Source: app/models/invocation.py:35-164] — InvocationJob/InvocationResult, status enum, terminal set, no-CASCADE rationale.
- [Source: app/models/audit.py:33-100] — AuditLogEntry with fan_out + invocation_id already present; append-only (migration 0006).
- [Source: app/api/v1/invocations.py (full)] — exact seam for location resolution; commit-then-dispatch; dispatch-failure handling.
- [Source: app/api/v1/jobs.py:37-135 + app/schemas/job.py:11-68] — job read envelope; OutputFileRef/JobResult presigned-URL pattern.
- [Source: tests/integration/api/test_invocations.py:489-584,172-184 + tests/integration/api/test_hierarchy.py:85-118] — `_drive_execution`, LLM mock, hierarchy seeding.
- [Source: app/db/migrations/versions/0010_skill_requires.py:25-40] — column-add migration pattern; 0011 is current head → 0012 next.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **Chord testing approach (Task 8, AC3/AC4):** eager-chord callback semantics
  vary across Celery versions, so the tests do **not** rely on eager-chord firing.
  `_post_fan_out` patches `celery.chord` out at dispatch (parent + children still
  commit), and `_drive_fan_out` replicates the child `run_skill` seam (including
  the child audit entry's `invocation_id=<parent>`, AC6) followed by the
  `aggregate_results` callback logic on the test's own event loop — the
  established service-level pattern (asyncio.run() cannot nest in pytest-asyncio's
  loop). End state is asserted identically.
- **Mutual exclusion code:** moved the `location_id`+`fan_out` check out of a
  Pydantic model validator and into the endpoint so it raises the stable
  `INVOCATION_AMBIGUOUS_LOCATION` code (a validator error collapses to a generic
  `VALIDATION_ERROR`). The same reasoning governs `LOCATION_REQUIRED` /
  `STUDY_REQUIRED` / `NO_LOCATIONS_IN_STUDY` — all four are `VelaraHTTPException`
  subclasses defined in `invocations.py`.
- **Migration round-trip (Docker):** upgrade head → downgrade -1 → upgrade head
  all clean (`0011_hierarchy ↔ 0012_location_fan_out`).
- **Failed-parent result:** `aggregate_results` writes the children-summary
  `InvocationResult` only on the completed path (via `mark_completed`); a failed
  parent has no result row, but its `children` are still served by `GET /jobs`
  querying `parent_job_id` directly (AC5 is independent of the result row).

### Completion Notes List

Backend-only. Implemented location-dependent skill fan-out end to end:

- **Schema/model (Tasks 1–2):** `Skill.location_dependent` (bool, NOT NULL,
  default false); `InvocationJob.parent_job_id` (self-FK, no CASCADE),
  `location_id` (bare UUID, **no FK** — survives location deletion), `fan_out`
  (bool) + `idx_invocation_jobs_parent_job_id`. Single migration `0012` spans
  `skills` + `invocation_jobs`. Wired through `SkillCreate`/`SkillRead`/
  `SkillMetadataUpdate` (+ `_PATCH_NULL_REJECTED`) and `skill_service.create_skill`.
- **Endpoint (Task 3):** `InvocationRequest` gains `location_id`/`study_id`/
  `fan_out`; the resolution block branches non-location (unchanged single job),
  single-location (AC2: location resolved, metadata injected, `location_id` set,
  location's `hierarchy_path`), and fan-out (AC3). New stable codes:
  `LOCATION_REQUIRED`, `INVOCATION_AMBIGUOUS_LOCATION`, `STUDY_REQUIRED`,
  `NO_LOCATIONS_IN_STUDY`.
- **Orchestration (Task 4):** `execution_service.dispatch_fan_out` creates parent
  + children (commit-then-dispatch), fires the first Celery **chord** in the
  codebase, and on dispatch failure marks parent + queued children failed.
  `aggregate_results` (new `@celery.task`) re-queries children, rolls up the
  parent (`completed`, or `failed` with first-child / `FAN_OUT_PARTIAL_FAILURE`
  code), writes the children-summary result, fresh session + terminal guard +
  already-terminal early-bail.
- **Context injection (Task 5):** location block stored in job `inputs["location"]`
  at creation; `_location_context_block` prepends `[Location Context]` in all three
  runtimes (code path also exposes a dedicated stdin `location` key). PHI-safe.
- **Parent children API (Task 6):** `JobChild` + `children` on `JobReadWithResult`;
  `get_job` populates it only for `fan_out=True` parents via `list_children`
  (org-scoped), resolving `location_name` from the stored block and presigning
  child outputs. No shape change for existing callers.
- **Audit (Task 7):** child `run_skill` audit writes carry
  `invocation_id=parent_job_id`; the parent entry (`fan_out=True`,
  `invocation_id=None`, real runtime_type) is written by `aggregate_results`.
- **Patterns doc (Task 9):** wrote `execution-engine-patterns.md` (closes the
  most-deferred Epic 3 retro action item).

**Gates:** migration round-trip clean; `ruff check .` clean; **535 Docker tests
pass (0 regressions, +13 net — 11 new fan-out tests)**. No new dependencies.

### File List

**New**
- `app/db/migrations/versions/0012_location_fan_out.py`
- `_bmad-output/planning-artifacts/architecture/execution-engine-patterns.md`

**Modified**
- `app/models/skill.py`
- `app/models/invocation.py`
- `app/schemas/skill.py`
- `app/schemas/invocation.py`
- `app/schemas/job.py`
- `app/services/skill_service.py`
- `app/services/job_service.py`
- `app/services/execution_service.py`
- `app/api/v1/skills.py`
- `app/api/v1/invocations.py`
- `app/api/v1/jobs.py`
- `app/workers/execution_tasks.py`
- `tests/integration/api/test_invocations.py`

## Change Log

- 2026-06-12 — Story 3.7 implemented (location-dependent skill fan-out). Migration 0012 (skills.location_dependent + invocation_jobs parent/location/fan_out + index). New invocation request fields + location-resolution endpoint, `execution_service.dispatch_fan_out` (first Celery chord), `aggregate_results` task, `[Location Context]` injection across all runtimes, parent `children` API, parent+child audit linkage. Wrote execution-engine-patterns.md (Epic 3 retro item 1). 535 Docker tests pass (0 regressions, +13), ruff clean, migration round-trip verified. Status → review.
