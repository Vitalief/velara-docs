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

Status: ready-for-dev

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

- [ ] **Task 1 — Confirm current behavior against source (AC1-AC3)**
  - [ ] Re-read `parse_document` (`ingest_tasks.py:46-201`) and `confirm_file_ref`
    (`ingest_service.py:218-347`) against the current working tree — line numbers above are from
    HEAD `d193a07`; re-locate by searching for `parse_document_unexpected_status` if the file has
    moved.
  - [ ] Confirm the `@celery.task(name="velara.workers.ingest.parse_document", bind=True)` decorator
    (`ingest_tasks.py:46`) already has `bind=True` (needed for `self.retry(...)`) — it does; no
    decorator change needed for that alone, only for retry-limit/backoff configuration if you add
    `max_retries`/`default_retry_delay` to the decorator itself vs. passing them to `self.retry()`
    per-call. Either is acceptable; document which you chose in Completion Notes.

- [ ] **Task 2 — Add bounded retry to the `pending`-status branch (AC1, AC2, AC3)**
  - [ ] Modify ONLY the `if ref.status != FILE_REF_STATUS_CONFIRMED:` branch
    (`ingest_tasks.py:97-103`) — this check currently sits INSIDE the same `async with session_scope()`
    block used to load the ref (lines 80-103). `self.retry()` raises a `Retry` exception that Celery
    catches at the task level; make sure raising it here doesn't get swallowed or converted by
    anything else in `_execute()`'s control flow (check whether the outer `try/except Exception`
    block at line 112 covers this branch — it starts AFTER the ref-loading block per current
    structure, so the pending-check itself sits outside that except, but verify this against current
    source since a refactor could have changed the boundary).
  - [ ] Choose bounded retry parameters (e.g. `countdown=2`, `max_retries=5` — roughly enough to
    absorb typical commit-visibility latency, which the live incident suggests is sub-second to a
    few seconds, without waiting anywhere near the frontend's 2-minute cap). Document the chosen
    values and reasoning in Completion Notes.
  - [ ] On retry exhaustion (Celery's `self.retry()` re-raises the original condition once
    `max_retries` is hit, or you can check `self.request.retries >= max_retries` explicitly before
    calling retry) — transition to AC4's terminal `failed` state instead of raising unhandled or
    looping forever.

- [ ] **Task 3 — Terminal failure on retry exhaustion with a distinct error_code (AC4)**
  - [ ] Add a new error code constant alongside `ERROR_CODE_PARSE_FAILED`/`ERROR_CODE_PARSE_TOO_LARGE`
    (`ingest_tasks.py:32-33`) — e.g. `ERROR_CODE_CONFIRM_RACE_TIMEOUT` or similar; name it to reflect
    "the row never reached confirmed after retries," not a parsing problem.
  - [ ] Write the terminal `failed` status using the SAME fresh-`session_scope()` pattern the
    existing failure handler uses (`ingest_tasks.py:180-194` — a fresh session so a poisoned
    execution session can't strand the row; terminal-state-guarded so a concurrent transition isn't
    clobbered). Reuse this pattern, don't invent a second one.

- [ ] **Task 4 — Tests (AC5)**
  - [ ] **Trap to avoid:** do not call `parse_document(file_ref_id)` synchronously inside a
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
  - [ ] Test 1 (AC1): row seeded at `pending`, task observes it, retries; then row flipped to
    `confirmed` (simulating the API's commit landing); retried attempt completes and reaches
    `parsed`.
  - [ ] Test 2 (AC4): row seeded at `pending` and NEVER transitions to `confirmed` (simulating a
    genuinely stranded row, not just latency); retries exhaust; row ends at `failed` with the new
    error_code.
  - [ ] Confirm the existing terminal-state idempotency test (whatever currently covers
    `ingest_tasks.py:88-95`, if one exists as a dedicated unit test vs. only exercised via the
    integration happy-path) still passes unmodified (AC3) — search for it before assuming it exists;
    if no dedicated test currently exercises that branch, note this as a pre-existing gap, not one
    this story is required to backfill (out of scope).
  - [ ] Gates: `ruff` clean; the relevant pytest suite (`tests/unit/services/test_ingest_service.py`,
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

### Debug Log References

### Completion Notes List

### File List
