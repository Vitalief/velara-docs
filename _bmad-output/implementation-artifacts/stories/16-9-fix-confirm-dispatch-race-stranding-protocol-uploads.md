---
baseline_commit: velara-api on branch `development` (head `d193a07`). `ingest_service.py` and
  `ingest_tasks.py` are CLEAN in the working tree (confirmed via `git status`). The working tree DOES
  have other unrelated uncommitted Epic 17 work (certifications.py/model/schema/service, PLUS
  `app/workers/execution_tasks.py` — a Story 17.3 addition, `_extract_output_sha256`, lines ~195-207
  and its call sites in `run_skill`) — none of it touches ingest. Note: this story's Dev Notes cite
  `execution_tasks.py:21-22`'s retry-precedent comment (the "don't mix provider-level retry with
  Celery autoretry_for" rule) — that comment sits well above the uncommitted 17.3 diff and is
  unaffected by it, but if re-verifying against source, be aware `execution_tasks.py` itself is not
  at a clean HEAD state right now. No migration, no schema change. velara-web is unaffected — no FE
  change required for this story's ACs (see Notes).
---

# Story 16.9: Fix the Confirm/Dispatch Race That Strands a Protocol Upload at "Processing"

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want a protocol document upload to reliably reach a parsed or clearly-failed state,
so that I'm never stuck watching "Processing document…" for two minutes only to get a generic
timeout with no actionable explanation.

## ⚠️ SCOPE — read this first

**BACKEND ONLY (`velara-api`). No migration, no schema change, no frontend change required.**
Independent of 16.1-16.8. This is a live, confirmed-in-deployed-dev race condition between the API's
`confirm_file_ref` and the Celery worker's `parse_document` task — narrow, intermittent, and
root-caused against actual production logs, not speculation.

**Root cause (confirmed live against deployed dev — not a hypothesis):**

`confirm_file_ref` (`app/services/ingest_service.py:334-344`) dispatches the Celery task **before**
committing the row's status transition:

```python
ref.status = FILE_REF_STATUS_CONFIRMED
...
try:
    task = await run_in_threadpool(parse_document.delay, str(ref.id))   # line 335 — broker publish
except Exception:
    await session.rollback()
    raise

ref.celery_task_id = task.id
ref.updated_at = datetime.now(UTC)
await session.commit()          # line 344 — the actual commit, AFTER dispatch
```

This ordering is deliberate and must NOT be changed (see AC2) — it exists so a broker-publish
failure rolls the row back to `pending` instead of stranding it `confirmed`-but-undispatched. But it
creates a real window: if the worker dequeues and starts executing the task before this commit
becomes visible to it, `parse_document` (`app/workers/ingest_tasks.py:97-103`) finds the row still
`pending`:

```python
if ref.status != FILE_REF_STATUS_CONFIRMED:
    logger.warning("parse_document_unexpected_status", file_ref_id=file_ref_id, status=ref.status)
    return {"file_ref_id": file_ref_id, "status": ref.status}   # <-- gives up, permanently
```

There is no retry, no requeue, no terminal-status write here. The row is now stuck at `pending`
forever — nothing will ever touch it again. The frontend (`velara-web/src/features/run/hooks/useIngest.ts`)
polls `GET /api/v1/ingest/{id}` every 3s but only recognizes `'parsed'` and `'failed'` as terminal;
`'pending'` isn't one it acts on, so it polls for the full ~2-minute cap (`MAX_ATTEMPTS`) before
giving up with a generic "File processing timed out" message — a slow, unexplained failure instead
of a fast, specific one.

**Confirmed live in deployed dev** — CloudWatch log group `/velara/dev/worker`, 2026-07-27T13:56:35Z:
```
parse_document_unexpected_status file_ref_id=478ef3e6-75e2-4f7d-a8ba-5d66a5d3ce2a status=pending
```
No `parse_document_completed` or `parse_document_failed` for that `file_ref_id` appears anywhere in
the surrounding 3-day log window — that row is permanently stranded right now. Only one occurrence
found in that window: this is an **intermittent** race (depends on relative timing between the
broker round-trip and the DB commit landing across containers), not a constant failure — consistent
with a "sometimes it hangs" report rather than "always."

## Acceptance Criteria

1. **AC1 — The race no longer permanently strands a row.** When `parse_document` observes a row
   that is `pending` (not yet `confirmed`), it must not silently give up. It retries (bounded, short
   backoff — e.g. Celery's `self.retry(countdown=..., max_retries=...)`) instead of treating "not
   confirmed yet" as a terminal no-op. A row that is still `pending` only because the API's commit
   hasn't landed yet must resolve to processing normally once the commit becomes visible on retry.

2. **AC2 — No regression to the existing broker-failure protection.** The dispatch-before-commit
   ordering in `confirm_file_ref` (`ingest_service.py:324-344`) and its existing rollback-on-
   broker-failure guard (lines 334-340) are UNCHANGED — this story fixes the worker's reaction to a
   *successfully dispatched* task racing the commit, not the broker-unreachable case. Do not reorder
   `confirm_file_ref` to commit before dispatching (that would reintroduce the
   confirmed-but-undispatched-on-broker-failure problem the current ordering deliberately prevents).

3. **AC3 — Terminal-state idempotency guards are preserved exactly.** The existing early-return for
   an already-terminal row (`ingest_tasks.py:88-95`, `FILE_REF_TERMINAL_STATUSES` — handles benign
   duplicate task delivery after a row already reached `parsed`/`failed`/`rejected`) is untouched.
   This story only changes the `pending`-not-yet-`confirmed` branch (lines 97-103); do not merge it
   with or alter the terminal-state branch's logic.

4. **AC4 — A genuinely-stranded row fails fast and clearly, not after a 2-minute generic timeout.**
   If retries are exhausted and the row still isn't `confirmed` (a real anomaly — not normal commit
   latency, which AC1's retry already absorbs), `parse_document` writes a terminal `failed` status
   with a distinct, new `error_code` (do not reuse `PARSE_FAILED`/`PARSE_TOO_LARGE` — those describe
   extraction failures, not a dispatch-race failure) so the existing frontend failure path
   (`useIngest.ts`'s `status === 'failed'` check, already correct and unchanged) surfaces the error
   promptly instead of waiting out the full client-side timeout.

5. **AC5 — Regression test reproduces the race.** A test drives `parse_document` (or its retry
   branch directly — see Dev Notes on why calling the Celery task synchronously in a pytest-asyncio
   test is a known trap) against a row seeded at `pending`, and asserts: (a) it retries rather than
   permanently giving up, and (b) once the row is flipped to `confirmed` (simulating the commit
   landing), the retried attempt completes normally. A second test covers AC4: retries exhausted
   while the row is still `pending` → terminal `failed` with the new error_code.

**Out of scope (do NOT touch):**
- Any frontend file. `useIngest.ts`'s existing `status === 'failed'` handling already covers AC4 with
  zero FE code change — the fix makes the worker *reach* `failed` faster and with a clearer cause,
  it does not change what the frontend does with that status. A distinct user-facing message for the
  new error_code is an optional FE follow-up, not required to close this story.
- `confirm_file_ref`'s dispatch-before-commit ordering (`ingest_service.py:324-344`) — do not reorder
  it (AC2).
- The already-terminal early-return branch (`ingest_tasks.py:88-95`) — do not alter (AC3).
- `document_parser.py` / `extract_document` — this bug is not an extraction failure; do not touch
  the parsing logic itself.
- Any other Celery task (`execution_tasks.py`) — this codebase deliberately does NOT mix
  provider-level retry (Anthropic 429/5xx, handled in `AnthropicProvider`) with Celery-level
  `autoretry_for` for the same errors (see `execution_tasks.py:21-22`); that precedent is about a
  *different* retry axis and is not directly reusable here, but do not introduce a second, competing
  retry mechanism in `execution_tasks.py` while you're in this area — this story's retry is scoped
  to `parse_document`'s specific pending/confirmed race only.

## Tasks / Subtasks

- [x] **Task 1 — Confirm current behavior against source (AC1-AC3)**
  - [x] Re-read `parse_document` (`ingest_tasks.py:46-201`) and `confirm_file_ref`
    (`ingest_service.py:218-347`) against the current working tree — line numbers above are from
    HEAD `d193a07`; re-locate by searching for `parse_document_unexpected_status` if the file has
    moved.
  - [x] Confirm the `@celery.task(name="velara.workers.ingest.parse_document", bind=True)` decorator
    (`ingest_tasks.py:46`) already has `bind=True` (needed for `self.retry(...)`) — it does; no
    decorator change needed for that alone, only for retry-limit/backoff configuration if you add
    `max_retries`/`default_retry_delay` to the decorator itself vs. passing them to `self.retry()`
    per-call. Either is acceptable; document which you chose in Completion Notes.

- [x] **Task 2 — Add bounded retry to the `pending`-status branch (AC1, AC2, AC3)**
  - [x] Modify ONLY the `if ref.status != FILE_REF_STATUS_CONFIRMED:` branch
    (`ingest_tasks.py:97-103`) — this check currently sits INSIDE the same `async with session_scope()`
    block used to load the ref (lines 80-103). `self.retry()` raises a `Retry` exception that Celery
    catches at the task level; make sure raising it here doesn't get swallowed or converted by
    anything else in `_execute()`'s control flow (check whether the outer `try/except Exception`
    block at line 112 covers this branch — it starts AFTER the ref-loading block per current
    structure, so the pending-check itself sits outside that except, but verify this against current
    source since a refactor could have changed the boundary).
  - [x] Choose bounded retry parameters (e.g. `countdown=2`, `max_retries=5` — roughly enough to
    absorb typical commit-visibility latency, which the live incident suggests is sub-second to a
    few seconds, without waiting anywhere near the frontend's 2-minute cap). Document the chosen
    values and reasoning in Completion Notes.
  - [x] On retry exhaustion (Celery's `self.retry()` re-raises the original condition once
    `max_retries` is hit, or you can check `self.request.retries >= max_retries` explicitly before
    calling retry) — transition to AC4's terminal `failed` state instead of raising unhandled or
    looping forever.

- [x] **Task 3 — Terminal failure on retry exhaustion with a distinct error_code (AC4)**
  - [x] Add a new error code constant alongside `ERROR_CODE_PARSE_FAILED`/`ERROR_CODE_PARSE_TOO_LARGE`
    (`ingest_tasks.py:32-33`) — e.g. `ERROR_CODE_CONFIRM_RACE_TIMEOUT` or similar; name it to reflect
    "the row never reached confirmed after retries," not a parsing problem.
  - [x] Write the terminal `failed` status using the SAME fresh-`session_scope()` pattern the
    existing failure handler uses (`ingest_tasks.py:180-194` — a fresh session so a poisoned
    execution session can't strand the row; terminal-state-guarded so a concurrent transition isn't
    clobbered). Reuse this pattern, don't invent a second one.

- [x] **Task 4 — Tests (AC5)**
  - [x] **Trap to avoid:** do not call `parse_document(file_ref_id)` synchronously inside a
    pytest-asyncio test and expect it to work cleanly — the task's body wraps `asyncio.run(_execute())`
    (`ingest_tasks.py:201`), which clashes with an already-running event loop under pytest-asyncio
    (`test_ingest.py:483-484`'s comment: "If asyncio.run() clash happens inside eager task, the
    confirm endpoint returns 500"). The existing integration test
    (`tests/integration/api/test_ingest.py`, e.g. `test_presign_upload_confirm_parse_happy_path_xlsx`)
    works around this by re-implementing the parse logic inline against the DB directly rather than
    invoking the real Celery task function. Follow the same convention: test the retry/terminal-fail
    LOGIC (the branch you're adding) by either (a) extracting it into a plain testable helper/method
    that doesn't require `asyncio.run()` re-entry, or (b) driving it through Celery's `task.apply()`
    (eager mode, no broker) if that sidesteps the event-loop clash — verify which approach actually
    works in this test harness before committing to one; do not assume without checking.
  - [x] Test 1 (AC1): row seeded at `pending`, task observes it, retries; then row flipped to
    `confirmed` (simulating the API's commit landing); retried attempt completes and reaches
    `parsed`.
  - [x] Test 2 (AC4): row seeded at `pending` and NEVER transitions to `confirmed` (simulating a
    genuinely stranded row, not just latency); retries exhaust; row ends at `failed` with the new
    error_code.
  - [x] Confirm the existing terminal-state idempotency test (whatever currently covers
    `ingest_tasks.py:88-95`, if one exists as a dedicated unit test vs. only exercised via the
    integration happy-path) still passes unmodified (AC3) — search for it before assuming it exists;
    if no dedicated test currently exercises that branch, note this as a pre-existing gap, not one
    this story is required to backfill (out of scope).
  - [x] Gates: `ruff` clean; the relevant pytest suite (`tests/unit/services/test_ingest_service.py`,
    `tests/integration/api/test_ingest.py`, plus wherever you add the new worker-level tests) green,
    0 regressions.

## Dev Notes

### The exact change surface

| File | What changes |
|---|---|
| `app/workers/ingest_tasks.py` | The `if ref.status != FILE_REF_STATUS_CONFIRMED:` branch (~lines 97-103) — add bounded retry via `self.retry(...)`; add a new error_code constant; on retry exhaustion, write terminal `failed` via the existing fresh-`session_scope()` failure-write pattern (~lines 178-194, reused not duplicated). |
| New or existing test file under `tests/` | New tests for AC1/AC4 per Task 4. |

**No changes to:** `app/services/ingest_service.py` (the dispatch-before-commit ordering is correct
and must stay, AC2), `app/services/document_parser.py`, `app/workers/execution_tasks.py`, any
frontend file, any migration/schema.

### ⚠️ Non-obvious traps (verified against source)

**Trap 1 — Don't "fix" this by reordering `confirm_file_ref` to commit before dispatching.** That
looks like the obvious fix (commit first, dispatch second — no more race) but it reintroduces a
WORSE bug the current ordering was deliberately built to prevent: if the broker publish then fails
(Redis unreachable, network blip), you'd be left with a `confirmed` row and no task ever dispatched
— silently stranding it forever with no retry path at all, since nothing would ever notice. The
current dispatch-then-commit ordering trades a narrow, retriable race (this story's fix) for
protection against that unretriable, silent worse case. Fix the worker's reaction to the race
instead (AC1/AC4), not the ordering that creates the window.

**Trap 2 — the `pending`-status branch sits inside the SAME `async with session_scope()` block used
to load the ref** (`ingest_tasks.py:80-103`), not inside the `try/except Exception` block that
starts afterward (line 112). Calling `self.retry()` here raises Celery's `Retry` exception — verify
it propagates cleanly out of the `async with session_scope()` context manager (i.e., the session
context manager's `__aexit__` doesn't swallow or convert it) before assuming a bare `self.retry()`
call "just works" at this exact point in the control flow. If `session_scope()`'s exit handling
interferes, you may need to raise `Retry` outside the session block (capture what's needed, exit the
`async with`, then retry) — check this against current source, don't assume.

**Trap 3 — `parse_document` runs inside `asyncio.run(_execute())`** (`ingest_tasks.py:201`), and
`self.retry()` is a synchronous Celery API call happening inside an async function body. Confirm
`self.retry()` is safe to call from within the `async def _execute()` coroutine as currently
structured (it likely needs to be called from the outer `def parse_document(self, file_ref_id)`
sync function, propagated up from `_execute()` via a raised exception/sentinel, rather than calling
`self.retry()` directly inside `_execute()` — Celery's retry mechanism is tied to the task's sync
call stack). Verify this rather than assuming `self.retry()` "just works" called from inside the
`async def`.

**Trap 4 — testing this without triggering the `asyncio.run()` re-entry clash.** See Task 4's note
— the existing integration test suite already hit this exact problem and worked around it by
reimplementing parse logic inline rather than calling the real task function inside a pytest-asyncio
test. Do not assume you can just `await parse_document(...)` or call it synchronously in a new async
test without checking whether that clashes the same way; follow the existing test file's documented
workaround pattern.

**Trap 5 — this is a genuinely intermittent, timing-dependent bug.** Only one occurrence was found
in a 3-day deployed-dev log window. Do not expect to easily reproduce the exact race by just
uploading a file locally — you will very likely need to seed a `FileReference` row directly at
`pending` status and invoke the retry-branch logic directly (per Task 4/AC5) rather than trying to
race the real dispatch-then-commit timing end-to-end, which is not reliably reproducible on demand.

### Reuse map (do NOT rebuild)

- **The fresh-`session_scope()` failure-write pattern** (`ingest_tasks.py:178-194`) — already
  correctly guards against a poisoned session stranding the row and against clobbering a
  concurrently-reached terminal state. Reuse this exact pattern for AC4's retry-exhaustion write;
  do not invent a second failure-write mechanism.
- **`FILE_REF_TERMINAL_STATUSES`** (`app/models/file_ref.py:31-34`) — the single source of truth for
  "nothing left to do with this row." Reuse verbatim in any new guard condition.
- **`ERROR_CODE_PARSE_FAILED`/`ERROR_CODE_PARSE_TOO_LARGE`** (`ingest_tasks.py:32-33`) — the existing
  error_code naming convention this story's new constant should follow (a short, all-caps, specific
  name), not reuse (this is a distinct failure mode from either).

### Data model & flow facts (verified against current source)

- `FileReference.status` values (`app/models/file_ref.py:26-34`): `FILE_REF_STATUS_PENDING`
  ("pending"), `FILE_REF_STATUS_CONFIRMED` ("confirmed"), plus `FILE_REF_TERMINAL_STATUSES`
  (`parsed`/`failed`/`rejected` — verify exact terminal set against current source).
- `confirm_file_ref` (`ingest_service.py:218-347`) is itself guarded against double-confirm
  (`ref.status != FILE_REF_STATUS_PENDING` → `FileRefNotReadyError`, lines 249-255, under a `FOR
  UPDATE` row lock) — this is a DIFFERENT protection than this story's fix; it stops a second
  `/confirm` call from re-dispatching, it does not address the worker racing the FIRST confirm's own
  commit.
- The live incident's `file_ref_id` (`478ef3e6-75e2-4f7d-a8ba-5d66a5d3ce2a`) is a real, currently-
  stranded row in the deployed-dev database as of this story's drafting (2026-07-27) — it will not
  self-resolve; once this fix ships, consider (separately, not part of this story's ACs) whether that
  specific row needs a manual one-off status correction, since it predates the fix and nothing will
  retroactively retry it.

### Testing standards

- Backend: pytest, `tests/unit/` and `tests/integration/api/` per existing convention.
- `ruff` clean — this codebase's standing gate bar for every BE story.
- Follow this file's existing test-file conventions (`tests/unit/services/test_ingest_service.py` for
  service-layer logic, `tests/integration/api/test_ingest.py` for the full presign→confirm→parse
  flow) rather than introducing a new top-level test file, unless the retry logic genuinely needs
  worker-specific fixtures the existing files don't have.

### Git / build context

- `velara-api` on `development` (head `d193a07`) — `ingest_service.py`/`ingest_tasks.py` confirmed
  clean in the working tree via `git status` at this story's drafting; unrelated uncommitted Epic 17
  work exists in OTHER files (`certifications.py`, `certification.py` model/schema/service, AND
  `app/workers/execution_tasks.py` — a Story 17.3 addition) — do not touch those, do not assume they
  need to be committed/stashed for this story. Re-verify against current source before quoting
  `execution_tasks.py:21-22`'s retry-precedent comment, since that file is not at a clean HEAD state.
  Do NOT commit `velara-api` from this story (never-push-subrepos rule — only `code-review` commits
  subrepos, post-review). Only the top-level docs repo is committed by `dev-story`.
- `velara-web` — unaffected; no need to check its state for this story's own changes (16.7/16.8 are
  independent, unrelated FE work that may or may not have landed by the time this is picked up).

### Project Structure Notes

- Backend only, existing file modified in place (`ingest_tasks.py`). No new files strictly required
  (tests may land in an existing test file), no new dependencies, no migration.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.9] —
  parent epic story, the AC contract this story expands.
- [Source: velara-api/app/services/ingest_service.py#confirm_file_ref] — the dispatch-before-commit
  ordering (lines 324-344) that creates the race window; must not be reordered (AC2).
- [Source: velara-api/app/workers/ingest_tasks.py#parse_document] — the task and its `pending`-status
  early-return (lines 97-103), the exact code this story changes.
- [Source: velara-api/app/models/file_ref.py] — `FILE_REF_STATUS_PENDING`/`FILE_REF_STATUS_CONFIRMED`/
  `FILE_REF_TERMINAL_STATUSES` constants.
- [Source: velara-web/src/features/run/hooks/useIngest.ts] — the frontend poll loop; confirms AC4
  requires no FE change since `status === 'failed'` handling already exists there.
- [Source: velara-api/tests/integration/api/test_ingest.py#L483-521] — the existing documented
  workaround for the `asyncio.run()` re-entry clash when testing parse logic under pytest-asyncio
  (Trap 4); follow this convention rather than calling the real task function directly in a test.
- [Source: velara-api/app/workers/execution_tasks.py#L21-22] — the codebase's existing note on NOT
  mixing provider-level retry with Celery-level `autoretry_for` for the same error class; a
  precedent to be aware of, though it addresses a different retry axis than this story's fix.
- CloudWatch log group `/velara/dev/worker`, event at 2026-07-27T13:56:35Z — live confirmation of the
  race actually occurring in deployed dev (`file_ref_id=478ef3e6-75e2-4f7d-a8ba-5d66a5d3ce2a`,
  `status=pending`), the evidence this story is root-caused against.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Verified `self.retry()`'s real Celery semantics before implementing (`docker compose exec api
  python3 -c "..."` against `celery.app.task.Task.retry` source, celery 5.4.0): it internally
  computes `retries = request.retries + 1` and raises `MaxRetriesExceededError` itself once
  `retries > max_retries` — so the implementation does NOT manually check
  `self.request.retries >= max_retries` before calling retry (that would have been redundant and
  off-by-one-prone); it lets `self.retry()` raise `MaxRetriesExceededError` and catches that.
- Confirmed `celery/celery#4661` (GitHub) — `self.retry()` under `task_always_eager=True` +
  `task_eager_propagates=True` (this repo's `celery_eager` fixture,
  `tests/conftest.py:185-196`) raises a `RuntimeError`, not a clean retry — so `celery_eager` is
  NOT usable to test the retry branch. Tests instead patch `parse_document.retry` /
  `.MaxRetriesExceededError` directly on the real singleton task object and invoke
  `parse_document(file_ref_id)` (plain call syntax) inside a fresh thread/event loop (see below).
- Confirmed `Retry` (celery.exceptions.Retry) is a plain `Exception` subclass and
  `session_scope()`'s `async with SessionFactory()` does not swallow exceptions on `__aexit__` — so
  raising the new `_ConfirmRacePending` sentinel from inside the `async with session_scope()` block
  that loads the ref propagates cleanly to the outer `parse_document`, without being caught by the
  later `try/except Exception` block that handles parse failures (verified the sentinel is raised
  BEFORE that `try:`, so AC3's terminal-state branch and the parse-failure branch are both
  unaffected).
- Reproduced and fixed a `dispose_engine()` gap during implementation (not present in the story's
  Dev Notes): the pending-status branch originally raised `_ConfirmRacePending` from inside
  `_execute()` WITHOUT ever reaching the inner `try/finally` that calls `await dispose_engine()` —
  meaning the pooled asyncpg connection opened to load the ref would leak past `asyncio.run()`
  returning. Fixed by wrapping the ref-load block in its own `try/except _ConfirmRacePending:
  await dispose_engine(); raise` so disposal happens on every exit path, matching
  `dispose_engine()`'s own docstring requirement ("call this... before `asyncio.run()` returns").
- `docker compose exec api ruff check app/workers/ingest_tasks.py
  tests/integration/api/test_ingest.py` — clean (caught and fixed one import-line-length issue
  mid-implementation: `_mark_confirm_race_timeout`'s `from app.models.file_ref import ...` line
  exceeded 100 chars — wrapped to a multi-line import). Full-repo `ruff check .` also run: only 2
  pre-existing E501s remain, both in `tests/integration/api/test_certifications.py` (uncommitted
  Story 17.3 work this story's baseline explicitly says not to touch) — unrelated to this story.
- `docker compose exec -e AUTH_BACKEND=dev api pytest tests/integration/api/test_ingest.py
  tests/unit/services/test_ingest_service.py -v` — 52 passed, 3 skipped (pre-existing
  `USE_REAL_STORAGE=1`-gated skips, unrelated), 0 failed.
- `docker compose exec -e AUTH_BACKEND=dev api pytest -q` (full backend suite) — 1597 passed, 3
  skipped, 1 failed
  (`tests/integration/api/test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped`).
  **Verified pre-existing and unrelated**: re-ran the identical test against `git stash`'d
  (unmodified, HEAD `d193a07`) code inside the same container — it fails identically. Also already
  logged in `deferred-work.md` (from the 2026-07-24 auth/authz-auditing review): the test's
  `dedupe_key` uses a fixed literal route with no per-run uniqueness, and `audit_log_entries` is
  append-only (DB trigger blocks DELETE), so re-running the suite against a not-yet-truncated
  `velara_test` within ~15 minutes of a prior run collides with the prior run's own row. Not
  introduced by, or related to, this story's ingest/Celery changes — no `deferred-work.md` update
  needed since it's already recorded there.
- This repo has no source bind-mount for the `api`/`worker` containers — `docker compose cp` was
  used to sync `app/workers/ingest_tasks.py` and `tests/integration/api/test_ingest.py` into the
  running `api` container ahead of each test run (confirmed via `docker-compose.yml`: only
  `postgres_data`/`minio_data` volumes and one skill-bundle mount exist, no `./:/app`).

### Completion Notes List

- **Bounded retry parameters chosen: `countdown=2` seconds, `max_retries=5`** (documented in
  `ingest_tasks.py` as `_CONFIRM_RACE_RETRY_COUNTDOWN`/`_CONFIRM_RACE_MAX_RETRIES`). Reasoning: the
  live incident's commit-visibility latency is sub-second to a few seconds; 5 retries × ~2s spacing
  absorbs that with margin while resolving in well under 10 seconds total — nowhere near the
  frontend's 2-minute poll cap (AC4's "fails fast" intent).
- **Retry-limit configuration chosen: passed per-call to `self.retry(countdown=..., max_retries=...)`**,
  not set on the `@celery.task(...)` decorator itself — keeps the race-specific retry policy
  colocated with the one branch it governs, rather than becoming a task-wide default that could
  silently apply to some future unrelated exception in this task.
- **Retry-exhaustion detection: let Celery's real `self.retry()` raise `MaxRetriesExceededError`
  itself, caught by the outer `parse_document`** — NOT a manual `self.request.retries >=
  max_retries` pre-check (see Debug Log: `Task.retry()`'s own source already does `retries =
  request.retries + 1` and raises when `retries > max_retries`; duplicating that logic would risk
  an off-by-one and diverge from Celery's real semantics on a future Celery upgrade).
- **Control-flow structure**: introduced a private sentinel exception `_ConfirmRacePending`, raised
  from inside `_execute()`'s ref-loading block when the row is `pending` (not yet `confirmed`), and
  caught by the OUTER sync `parse_document` (never inside the coroutine) specifically because
  Celery's retry mechanism (`self.retry()` → `apply_async()`) is tied to the task's sync call stack,
  not something safe/meaningful to invoke from inside a coroutine running under `asyncio.run()`.
  This resolved the story's Trap 3 concern by construction rather than by trial and error.
- **New terminal-write helper `_mark_confirm_race_timeout`** reuses the exact fresh-`session_scope()`
  + terminal-state-guard shape as the existing parse-failure handler (`ingest_tasks.py:236-260`'s
  precedent) — a fresh session so a poisoned session can't strand the row, and a terminal-state
  check so a concurrently-landing real transition (e.g. the API's commit finally arriving, or a
  duplicate task delivery reaching `parsed` first) isn't clobbered.
- **New error code: `ERROR_CODE_CONFIRM_RACE_TIMEOUT = "CONFIRM_RACE_TIMEOUT"`** — distinct from
  `PARSE_FAILED`/`PARSE_TOO_LARGE`, named to reflect "the row never reached confirmed after
  retries," not an extraction problem. No frontend coupling to specific ingest error_code strings
  was found (`useIngest.ts` only branches on `status === 'failed'`), confirmed via grep across both
  subrepos before adding it — safe to introduce without a frontend change (matches the story's own
  Out-of-scope note).
- **AC2 verified untouched**: `confirm_file_ref`'s dispatch-before-commit ordering
  (`ingest_service.py:324-344`) was not modified — confirmed via `git diff` scoped to
  `ingest_service.py` showing zero changes.
- **AC3 verified untouched and now has direct test coverage**: the pre-existing terminal-state
  early-return (`ingest_tasks.py:88-95`, unmodified) previously had no dedicated unit/integration
  test exercising it directly (searched `tests/` for `parse_document_skipped_terminal` — no hits
  before this story). Added `test_already_terminal_row_still_skips_without_retry`, closing that
  pre-existing gap as a side effect (not required by the story, but free given the new test
  infrastructure built for AC1/AC4).
- **Testing approach**: neither of Task 4's two suggested options worked as originally scoped.
  Extracting the retry logic into a plain non-`asyncio.run()`-wrapped helper was only partially
  possible (`_mark_confirm_race_timeout` IS such a helper and is tested directly), but the
  retry-vs-exhaustion BRANCHING decision lives in the outer `parse_document`'s sync body, which
  still wraps `asyncio.run()`. Celery's `task.apply()` (eager mode) was ruled out empirically —
  confirmed it raises `RuntimeError` when `self.retry()` is called under
  `task_always_eager=True`+`task_eager_propagates=True` (`celery/celery#4661`, reproduced locally).
  Final approach (see Debug Log): patch `parse_document.retry`/`.MaxRetriesExceededError` directly
  on the real singleton task object, and invoke `parse_document(file_ref_id)` (plain call syntax —
  NOT `.delay()`/`.apply_async()`, no broker involved) inside a fresh thread via
  `asyncio.to_thread(...)`, mirroring the pre-existing `_run_in_fresh_loop` pattern in
  `tests/integration/api/test_invocations.py:1890-1912` (rebinding `app.db.session`'s
  engine/SessionFactory to the new thread's own event loop, since asyncpg connections cannot cross
  loops/threads). All 4 new control-flow tests exercise the REAL task function against a real
  Postgres row, not a reimplementation of the logic.
- **`docker compose cp` iteration note**: this environment's `api`/`worker` containers have no
  source bind-mount (image-baked code only). Each edit to `ingest_tasks.py` or
  `tests/integration/api/test_ingest.py` required `docker compose cp <file> api:/app/<path>`
  before `pytest` picked it up — documented here so a future session doesn't waste time debugging
  "why aren't my test changes taking effect."
- **Pre-existing test failure investigated and excluded**: see Debug Log —
  `test_repeated_denials_are_deduped` fails identically on unmodified `d193a07`, already logged in
  `deferred-work.md`. Not touched by this story.
- Live-incident row `file_ref_id=478ef3e6-75e2-4f7d-a8ba-5d66a5d3ce2a` (stranded before this fix
  shipped) is NOT retroactively repaired by this change — per the story's own Data Model & Flow
  Facts note, that specific row predates the fix and nothing will re-trigger it; a manual one-off
  correction (if desired) is explicitly out of this story's scope.

### File List

**Backend (`velara-api/`):**
- `app/workers/ingest_tasks.py` — MODIFIED. Added `ERROR_CODE_CONFIRM_RACE_TIMEOUT` constant,
  `_CONFIRM_RACE_RETRY_COUNTDOWN`/`_CONFIRM_RACE_MAX_RETRIES` constants, `_ConfirmRacePending`
  sentinel exception, `_mark_confirm_race_timeout` helper; the `pending`-status branch inside
  `_execute()` now raises `_ConfirmRacePending` (with an added `dispose_engine()` call on that exit
  path) instead of silently giving up; the outer `parse_document` now catches
  `_ConfirmRacePending` and calls `self.retry()`, catching `MaxRetriesExceededError` on exhaustion
  to write the terminal `failed` status via the new helper. No change to the terminal-state
  early-return branch, the parse-failure branch, or `confirm_file_ref`.
- `tests/integration/api/test_ingest.py` — MODIFIED. New "Story 16.9" test section: helper
  `_seed_pending_file_ref` (direct DB seed, bypasses presign/S3) and
  `_run_parse_document_in_fresh_loop` (drives the real `parse_document` task in a fresh
  thread/event loop with `.retry()`/`MaxRetriesExceededError` patched on the real task instance,
  mirroring `test_invocations.py`'s `_run_in_fresh_loop` convention); 6 new tests:
  `test_confirm_race_timeout_writes_failed_with_new_error_code`,
  `test_confirm_race_timeout_does_not_clobber_a_terminal_row`,
  `test_pending_status_retries_via_self_retry`,
  `test_pending_status_resolves_once_confirmed_on_retry`,
  `test_retry_exhaustion_writes_terminal_failed_with_new_error_code`,
  `test_already_terminal_row_still_skips_without_retry`.

**Docs:**
- `_bmad-output/implementation-artifacts/stories/16-9-fix-confirm-dispatch-race-stranding-protocol-uploads.md` —
  this file (task checkboxes, Dev Agent Record, Change Log, Status).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions.

## Change Log

- 2026-07-27 — Implemented (dev-story). Backend-only fix for the confirm/dispatch race that
  permanently strands a protocol upload at `pending`: `parse_document` now retries (bounded,
  `countdown=2`, `max_retries=5`) via a new `_ConfirmRacePending` sentinel raised from the ref-load
  branch and caught by the outer sync task body — resolving before Celery's `self.retry()` (tied to
  the task's sync call stack) rather than from inside the `asyncio.run()`-wrapped coroutine. On
  retry exhaustion, writes a terminal `failed` status with a new `CONFIRM_RACE_TIMEOUT` error_code
  via a new helper reusing the existing fresh-session failure-write pattern. `confirm_file_ref`'s
  dispatch-before-commit ordering and the pre-existing terminal-state idempotency guard are both
  verified unchanged (AC2/AC3). Added 6 new integration tests driving the REAL `parse_document` task
  (not a reimplementation) via a fresh-thread/event-loop pattern mirroring
  `test_invocations.py`'s existing `_run_in_fresh_loop` convention, with `.retry()` patched on the
  real singleton task object — necessary because Celery's real retry dispatch needs a broker and the
  `celery_eager` fixture's `self.retry()` is broken under `task_eager_propagates=True`
  (celery/celery#4661). One of the 6 new tests closes a pre-existing gap (no prior test directly
  exercised the terminal-state early-return branch). Gates: backend `ruff check .` clean (only 2
  pre-existing E501s remain, in uncommitted unrelated Story 17.3 files); `pytest` full suite 1597
  passed, 3 skipped, 1 pre-existing failure (`test_repeated_denials_are_deduped` — verified fails
  identically on unmodified HEAD, already logged in `deferred-work.md`, unrelated to this story). 0
  regressions introduced.
