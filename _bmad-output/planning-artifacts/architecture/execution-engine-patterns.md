# Execution Engine Patterns

> Load-bearing invariants the skill-execution engine (Epic 3) has accreted across
> Stories 3.1–3.8. They took multiple stories to get right; re-deriving or breaking
> them is the documented failure mode. Treat these as required reading before
> touching `execution_tasks.py`, `execution_service.py`, `job_service.py`, or the
> invocation/job API. Each links to the source of truth.

## 1. asyncio.run() / event-loop bridge

Celery tasks are **sync**; all async DB/storage work is wrapped in
`asyncio.run(_inner())`. A new event loop is created per task invocation. You must
**never** nest event loops and **never** reuse a session across the sync/async
boundary.

- `run_skill` — `app/workers/execution_tasks.py` (`return asyncio.run(_execute())`).
- `aggregate_results` (Story 3.7) follows the identical shape
  (`return asyncio.run(_aggregate())`).

**Testing constraint (the real cost):** `asyncio.run()` cannot nest inside
pytest-asyncio's already-running loop ("Future attached to a different loop").
Tests therefore **do not** call the task bodies. Instead they replicate the
task's service-call sequence on the test's own loop — the
`_drive_execution` / `_drive_fan_out` helpers in
`tests/integration/api/test_invocations.py`. **Service-level testing, not
task-level.** This is the single most-repeated Epic 3 retro lesson.

## 2. Terminal-state guard

Every status transition routes through `_guard_not_terminal`
(`app/services/job_service.py`). A job already in `completed`/`failed`/`cancelled`
is never transitioned again, and `mark_completed` never inserts a second
`InvocationResult`. A redelivered Celery task — or a redelivered chord callback —
is thus a benign no-op rather than a double-write or a state regression.

- `aggregate_results` additionally **reads the parent's terminal state up front
  and bails before writing any audit/result row** if it is already terminal, so a
  redelivered callback writes nothing.

## 3. Dispatch atomicity — commit-then-dispatch

`create_job` commits the `queued` row **before** the broker `.delay()` call. A
broker failure cannot be rolled back (the row is already committed), so it is
caught and the job is `mark_failed` in a **fresh** session — never stranded
`queued`-with-no-task. [`app/api/v1/invocations.py`]

- **Fan-out (Story 3.7):** the same discipline scales to N children — the parent
  **and every child** are committed (`create_job(..., commit=False)` + a single
  `session.commit()`) **before** the chord is dispatched. On chord-dispatch
  failure, the parent and all queued children are marked failed in a fresh session
  (`execution_service.dispatch_fan_out`).

## 4. Fresh session on failure

The failure path opens a **new** session because the execution session may be
poisoned by a DB error — reusing it would raise on commit and leave the job stuck
in `running` with no failure audit. [`execution_tasks.py` `run_skill` except block]

## 5. Timeout sandwich

For code/hybrid skills the timeout layers must stay ordered:

```
sandbox EXECUTION_TIMEOUT_S (1200s) < Celery soft_time_limit (1260s) < hard time_limit (1320s)
```

The sandbox's specific `EXECUTION_TIMEOUT` fires before Celery's generic
`SoftTimeLimitExceeded`; the ~60s headroom absorbs surrounding DB/S3/context work.
If `EXECUTION_TIMEOUT_S` changes, **both** Celery limits must be re-checked.
`SoftTimeLimitExceeded` is still mapped to `EXECUTION_TIMEOUT` so the two layers
stay consistent. [`execution_tasks.py` task decorator + `_map_error_code`]

## 6. File-by-key / IP discipline

Output file **content is never stored inline** — only the S3 key travels through
the system. `InvocationResult` has no field that could carry bytes; keep it that
way. Skill artifact bytes (system prompt / tool definitions / code) are
fetched-used-discarded: never stored in the DB, never logged, never returned. Tool
args and intermediate tool results are likewise discarded — only names/counts go
into `result_metadata`.

- **Fan-out parent:** the parent result **references** its children (job_id /
  location_id / status / output_file_key per child); it never copies child output
  bytes. The `children` array on `GET /api/v1/jobs/{parent}` is built by querying
  children by `parent_job_id` and presigning each child key on the fly.

## 7. Stable error codes

Error codes are persisted (job `error_code`, audit `error_code`) and **must never
be renamed** once shipped — they are SCREAMING_SNAKE_CASE and permanent. New codes
are added, never repurposed. Codes added by Story 3.7:
`LOCATION_REQUIRED`, `STUDY_REQUIRED`, `NO_LOCATIONS_IN_STUDY`,
`INVOCATION_AMBIGUOUS_LOCATION`, `FAN_OUT_PARTIAL_FAILURE`.
[`execution_tasks.py` `ERROR_CODE_*`, `core/exceptions.py`, `api/v1/invocations.py`]

## 8. Fan-out: chord + aggregate_results (Story 3.7)

Location-dependent skills (`Skill.location_dependent=True`) either run for a single
`location_id` (one normal job, location metadata injected into context) or fan out
across all locations in a study.

- **Dispatch:** `chord(group(run_skill.s(child_id) ...))(aggregate_results.s(parent_id))`
  — the **first chord in the codebase**. There is no prior `chord`/`group`/`chain`
  pattern to copy; treat it as new infrastructure.
- **Result-backend requirement:** chord callbacks need a Celery **result backend**
  to know when the group finished. `app/workers/celery_app.py` sets
  `backend=settings.REDIS_URL`. **If the backend were ever unset, the callback
  silently never fires** — verify it stays non-empty in worker config.
- **Parent/child job linkage:** child `InvocationJob`s carry `parent_job_id` (self
  FK, no CASCADE — history survives) and `location_id` (a **bare UUID, no FK** to
  `locations`, so jobs/audit survive a location deletion — same rationale as
  `skill_id`). The parent carries `fan_out=True`, no location.
- **Audit linkage (AC6):** each child audit entry records
  `invocation_id=<parent_job_id>`, `fan_out=False`; the parent writes one entry
  with `fan_out=True`, `invocation_id=None`, `runtime_type` = the skill's **real**
  runtime (never "fan_out"). The audit table is append-only (migration 0006
  trigger) — inserts only.
- **Aggregation:** `aggregate_results` re-queries children by `parent_job_id`
  (authoritative state, not the chord's advisory `child_returns`), rolls the parent
  to `completed` (all children completed) or `failed` (any child failed —
  `error_code` = first failed child's code, else `FAN_OUT_PARTIAL_FAILURE`), and
  writes the parent result summarizing children.
- **Location context injection:** the location block
  (`name`/`postal_code`/`address`/`city`/`pi_name`/`hierarchy_path`) is stored in
  the (child/single) job's `inputs["location"]` at creation time, and each runtime
  prepends a `[Location Context]` section in `execution_service`. PHI discipline:
  postal code + PI name are site metadata (acceptable in context) but the block is
  **never logged at INFO** (ids over content).

**Testing the chord:** eager-chord callback semantics vary across Celery versions,
so the integration tests **do not rely on eager-chord firing**. They patch
`celery.chord` out at dispatch (parent + children still commit) and drive the
children + `aggregate_results` logic via the service-level `_drive_fan_out` helper,
asserting the same end state. (See pattern #1.)

## Source map

| Concern | File |
| --- | --- |
| Task bodies, asyncio.run, error mapping | `app/workers/execution_tasks.py` |
| Runtime router + context assembly + fan-out dispatch | `app/services/execution_service.py` |
| Job lifecycle + terminal guard + children query | `app/services/job_service.py` |
| Invocation endpoint + location resolution | `app/api/v1/invocations.py` |
| Job read + children exposure | `app/api/v1/jobs.py` |
| Append-only audit writes | `app/services/audit_service.py` |
| Celery app + result backend | `app/workers/celery_app.py` |
