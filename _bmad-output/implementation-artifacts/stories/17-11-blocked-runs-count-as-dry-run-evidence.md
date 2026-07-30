---
baseline_commit: velara-api HEAD at `0031_invocation_cost_states` (Alembic head), on top of the
  uncommitted Story 17-10 change (`code_driven_executor.output_sha256`) — 17-11 DEPENDS on 17-10:
  a blocked run only carries a distinct hash because 17-10 makes the bundle path emit one. Sequence
  17-10 → 17-11 (or land them together). velara-web on `development`; this story DOES change FE
  (the Dry-Run Trail card). Follow-up to Story 17.3 (the gate) — loosens what terminal status counts
  as evidence, a compliance-weighted change to a 21 CFR Part 11 gate, hence its own story not a patch.
---

# Story 17.11: Count `blocked` Dry-Runs as Evidence (Capped) + Surface the QA Reason

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech member certifying a skill,
I want a `blocked` dry-run (the skill ran and its QA gate correctly refused to emit egregious output)
to count toward the technical dry-run trail — capped so the trail can't be ALL blocks, and with the
block reason visible — so that a skill whose honest, correct verdict on a hard input is "block" can
still accumulate the evidence it needs, because a loud block is itself proof the platform does not
silently swallow bad data.

## ⚠️ SCOPE — read this first

**Backend (`velara-api`) + Frontend (`velara-web`).** Extends Story 17.3's dry-run evidence gate and
17.3's `CertificationDryRunTrail` card. Depends on Story 17-10 (bundle runs must emit `output_sha256`,
or a blocked bundle run contributes a NULL hash and this story is moot for bundle skills — the exact
case that motivated it). Independent of the cost stories (17-4..17-9).

**The product rationale (why this is correct, not a loosening of rigor):** Story 17.3 hard-required
`status=="completed"`, treating a block as "not evidence." Field experience (2026-07-30, certifying
the velara-protocol-extractor bundle) showed the opposite: a scanned/no-text-layer protocol
(NCT03377491) correctly BLOCKED — the skill ran, extracted what it could, and its QA gate flagged the
result egregious rather than emit a bad Schedule-of-Assessments. That block is STRONGER evidence that
"the system errors loudly instead of silently swallowing bad data" than a clean run is. It should
count. A blocked run's canonical is a full structured payload (verified: 5905 bytes, real metadata +
`qa_flags` + `source_filename`/`extracted_at`), so with 17-10 it hashes distinctly — blocked runs
genuinely add distinct outputs, they don't collapse to one empty hash.

**Two guard rails (product decision, 2026-07-30):**
1. **Capped** — the trail must contain at least `MIN_COMPLETED_DRY_RUN_EVIDENCE_COUNT` genuinely
   `completed` distinct outputs; blocked runs fill the remainder up to `MIN_DRY_RUN_EVIDENCE_COUNT`.
   A trail that is ALL blocks does NOT certify — the skill must succeed sometimes.
2. **Reason visible** — the Dry-Run Trail card surfaces each blocked run's QA reason (its
   `qa_flags`/egregious list) so the Part 11 certifier signs knowing WHY it blocked.

**Out of scope (do NOT touch):**
- `failed` / `cancelled` jobs — remain non-evidence. Those are infra errors or user aborts, NOT a
  skill's considered QA verdict. Only `completed` and `blocked` are terminal-with-meaning here.
- The `CertificationRecord` append-only contract / DB trigger — unchanged (additive evidence only).
- Methodological certification (6.3) — not gated by dry-runs, untouched.
- The distinct-output hashing mechanism itself (Story 17-10) — this story consumes it, doesn't change it.
- The Run-All-aborts-after-blocked bug (separate deferred item) — this story makes blocked runs
  COUNT, but does not fix the FE loop that skips linking runs AFTER a block. Note the interaction in
  Dev Notes; the fix is its own story.

## Acceptance Criteria

1. **AC1 — Blocked jobs are eligible to link as evidence.** `link_dry_run_evidence`
   (`certification_service.py:809-818`) accepts a job whose `status` is `completed` OR `blocked`
   (currently `completed` only). `failed`/`cancelled`/queued/running remain rejected with the
   existing `DRY_RUN_EVIDENCE_JOB_NOT_ELIGIBLE` error. The eligibility set is defined as a named
   constant (e.g. `EVIDENCE_ELIGIBLE_STATUSES = frozenset({"completed", "blocked"})`) so the three
   call sites (link, count, list) share ONE source of truth.

2. **AC2 — The gate counts completed + blocked distinct outputs, but requires a completed floor.**
   `count_sufficient_dry_run_evidence` counts DISTINCT `output_sha256` across evidence rows whose job
   status is in the eligible set (was `completed` only). A NEW companion read
   `count_completed_dry_run_evidence` counts DISTINCT `output_sha256` among `completed`-only rows.
   `assert_dry_run_evidence_sufficient` passes only when BOTH:
   - total distinct (completed + blocked) `>= MIN_DRY_RUN_EVIDENCE_COUNT` (5), AND
   - completed-only distinct `>= MIN_COMPLETED_DRY_RUN_EVIDENCE_COUNT` (new constant; recommend **3**).
   A trail of 5 blocked + 0 completed FAILS the gate (new floor); 3 completed + 2 blocked PASSES.
   The NULL-hash exclusion (a hash-less row never counts) is preserved unchanged.

3. **AC3 — A distinct 422 when the floor is unmet.** If total distinct `>= 5` but completed-only
   distinct `< 3`, the technical `POST /certifications` returns 422 with a message that names the
   floor specifically ("at least N of the dry-runs must be successful (completed) outputs, not
   blocked"). Reuse `CertificationEvidenceInsufficientError` if its message can be made specific, or
   add a sibling code `CERTIFICATION_EVIDENCE_ALL_BLOCKED` — decide and document in Dev Notes. The
   existing insufficient-total 422 is unchanged.

4. **AC4 — The trail response distinguishes completed vs blocked and carries the block reason.**
   `list_dry_run_evidence` already returns `job_status` per row. It must ALSO return each blocked
   row's QA reason — surface the linked `InvocationResult.result_metadata`'s `qa` (or `qa_flags`)
   egregious list as a `qa_reason` field on the row (NULL for completed rows). The response's summary
   gains `completed_distinct_count` alongside the existing `distinct_output_count`/`is_sufficient`,
   so the FE renders "X of 5 (Y successful)" without re-deriving.

5. **AC5 — FE: the Dry-Run Trail card counts blocked runs and shows why they blocked.**
   `CertificationDryRunTrail.tsx` (a) includes blocked runs in the displayed trail count using the
   new summary fields, (b) renders each blocked run with a distinct status treatment + its
   `qa_reason` (the egregious flags) visible or one-click expandable, and (c) the "Turn technical
   key" enablement uses the backend `is_sufficient` (which already encodes the completed-floor rule —
   the FE does NOT re-implement the cap). If the floor is unmet, the card shows the specific reason
   ("need ≥3 successful runs") not a generic "insufficient."

6. **AC6 — Immutability + methodological untouched; failed/cancelled still excluded.** No change to
   `CertificationRecord`, its trigger, or the methodological path. A `failed`/`cancelled` job linked
   (or attempted-linked) is still rejected and still not counted. Backfill: none — this changes the
   COUNTING rule, not stored rows; existing blocked runs simply begin to count once linked.

## Tasks / Subtasks

- [x] **Task 1 — Backend: shared eligibility set + loosen link (AC1, AC6)**
  - [x] Added `EVIDENCE_ELIGIBLE_STATUSES = frozenset({"completed", "blocked"})` and
    `MIN_COMPLETED_DRY_RUN_EVIDENCE_COUNT = 3` next to `MIN_DRY_RUN_EVIDENCE_COUNT`.
  - [x] `link_dry_run_evidence` now filters `InvocationJob.status.in_(EVIDENCE_ELIGIBLE_STATUSES)`;
    idempotent-duplicate + version-match logic unchanged. Docstring updated.

- [x] **Task 2 — Backend: gate counts with a completed floor (AC2, AC3)**
  - [x] `count_sufficient_dry_run_evidence` now counts `status IN EVIDENCE_ELIGIBLE_STATUSES`
    (delegates to a new shared `_count_distinct_evidence(statuses=...)` helper so completed-only and
    completed+blocked can never drift). Docstring updated.
  - [x] New `count_completed_dry_run_evidence` (same helper, `statuses={"completed"}`).
  - [x] `assert_dry_run_evidence_sufficient` requires BOTH total `>= MIN_DRY_RUN_EVIDENCE_COUNT`
    (else `CertificationEvidenceInsufficientError`) AND completed `>= MIN_COMPLETED_DRY_RUN_EVIDENCE_COUNT`
    (else `CertificationEvidenceAllBlockedError`).
  - [x] AC3 error: added a DISTINCT `CertificationEvidenceAllBlockedError`
    (`CERTIFICATION_EVIDENCE_ALL_BLOCKED`, 422) — the remediation differs from insufficient-total, so
    a separate code + message. Added to the FE `CERTIFICATION_ERROR_MESSAGES` map.

- [x] **Task 3 — Backend: trail response carries block reason + completed count (AC4)**
  - [x] `list_dry_run_evidence` now selects `InvocationResult.result_metadata` and derives `qa_reason`
    per row via a new defensive `_extract_qa_reason` (blocked-only; reads `qa.egregious` tolerantly,
    degrades to None). Return tuple now `(rows, distinct, completed_distinct, is_sufficient)`, and
    `is_sufficient` encodes the FULL two-part rule (so the FE never re-derives the cap). Both API
    call sites updated for the new arity.
  - [x] Schemas: `CertificationDryRunEvidenceRead` gains `qa_reason: list | None`;
    `CertificationDryRunEvidenceListData` gains `completed_distinct_count: int`. Regenerated
    `docs/api-spec.json`.

- [x] **Task 4 — Frontend: trail card counts + reason (AC5)**
  - [x] `CertificationDryRunTrail.tsx`: count badge shows "X of 5 distinct outputs (Y successful)";
    copy explains blocked runs count (capped) and shows a floor-specific message when the completed
    floor is unmet; blocked evidence rows render their `qa_reason` egregious flags (danger-token
    chips). Key enablement stays driven by backend `is_sufficient` (cap NOT re-derived in FE).
  - [x] `api/certifications.ts` types updated (`qa_reason`, `completed_distinct_count`).

- [x] **Task 5 — Tests (all ACs)**
  - [x] Backend unit: widened-status query-shape test (asserts both `completed` AND `blocked` in the
    IN clause); `count_completed_dry_run_evidence` completed-only query-shape test; the full two-part
    truth table (5c→pass, 3c+2b→pass, 2c+3b→all-blocked, 0c+5b→all-blocked, total<5→insufficient);
    AllBlocked error code/status; `_extract_qa_reason` (completed→None, blocked→egregious list,
    missing/non-dict qa→None, None metadata→None).
  - [x] Backend integration (`test_certifications.py`): new `_seed_mixed_dry_run_evidence(n_completed,
    n_blocked)` helper (blocked jobs carry a `qa.egregious` block); tests for mixed-trail 201,
    all-blocked 422 (`CERTIFICATION_EVIDENCE_ALL_BLOCKED`), and the list surfacing `qa_reason`
    (blocked) / None (completed) + `completed_distinct_count`.
  - [x] Frontend: new `CertificationDryRunTrail.test.tsx` test (blocked run renders qa_reason + the
    "(N successful)" count split); updated the pre-existing badge-text assertions + the two Screen
    mocks for the new fields.
  - [x] Gates (Enforcement Rule 10): ruff clean; backend cert unit 40 + integration 34 + skills/audit
    = 338 passed (fresh `velara_test`, `AUTH_BACKEND=dev`, source `docker cp`'d + grep-verified);
    `tsc`/`eslint` clean; `vitest` 807 passed; `docs/api-spec.json` regenerated. See Debug Log.

### Review Findings

_Code review 2026-07-30 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor, run on a different model than the implementer). 17-11 findings below; sibling 17-10 findings in its own story file._

- [x] [Review][Patch] **HIGH — the UI never linked blocked runs: the headline feature was unreachable end-to-end.** FIXED: `runOne()` now links on `completed` OR `blocked` (mirroring `EVIDENCE_ELIGIBLE_STATUSES`); `failed`/`cancelled`/`timeout` still never link. Single Run and Run-All both link blocked evidence now. [velara-web/src/features/certification/components/CertificationDryRunTrail.tsx:216]
- [x] [Review][Patch] **qa_reason shape contract fragile: strings rendered as blank chips.** FIXED both ends: `_extract_qa_reason` now NORMALIZES — dict flags pass through, string flags coerce to `{code, message, location: None, severity: "egregious"}`, garbage entries drop (all-garbage → None); FE type widened to `Array<QaFlag | string>` with optional fields, render falls back `string ? flag : message ?? code ?? 'QA flag'`, empty/None reason shows "Blocked: reason unavailable", chips truncate at 420px with full text in the hover title. Integration test now asserts every returned flag is an object with a message. [certification_service.py `_extract_qa_reason`; CertificationDryRunTrail.tsx; api/certifications.ts]
- [x] [Review][Patch] **Link-eligibility widening had zero API-level test coverage.** FIXED: new `_seed_unlinked_job` helper + 2 integration tests through the real endpoint — blocked job links 201 (returns `job_status: "blocked"`), failed job still 422 `DRY_RUN_EVIDENCE_JOB_NOT_ELIGIBLE`. [velara-api/tests/integration/api/test_certifications.py]
- [x] [Review][Patch] **Remediation copy omitted "distinct" in all three surfaces.** FIXED: backend error, `errors.ts` message, and the FE floor copy all now say "successful (completed) with distinct outputs — blocked runs alone cannot satisfy the trail." [certification_service.py; errors.ts; CertificationDryRunTrail.tsx]
- [x] [Review][Patch] **FE floor re-derivation could contradict the backend verdict + Dev-Record claim inaccurate.** FIXED: `completedFloorUnmet` is now guarded on `!isSufficient &&` (copy can never contradict the backend verdict), the local constants are documented as display-only mirrors of the backend source of truth, and the Dev-Record claim is corrected below. [CertificationDryRunTrail.tsx]
- [x] [Review][Defer] **NULL-hash runs are linkable but can never count (silent dead evidence), and qa_reason is None for non-bundle runtimes** — link checks status only, never hash presence; pre-17.10 bundle rows and any hash-less runtime link 201 but are skipped by `COUNT(DISTINCT)` NULL semantics with no feedback; `_extract_qa_reason` only understands the bundle `qa.egregious` nesting. Largely the pre-existing 17.3 pattern (completed links never checked hash either); no-backfill discipline applies. — deferred, pre-existing pattern [certification_service.py:905-912]
- [x] [Review][Defer] **Two-part gate is a two-query read (TOCTOU) and the list endpoint's rows/counts come from three separate queries** — under READ COMMITTED, concurrent evidence-linking between statements can pass a state that never existed, or return items inconsistent with counts. Introduced by this change but accepted as low-risk (transient, self-correcting, human-paced gate); candidate fix is a single SELECT with `FILTER (WHERE status='completed')` aggregation. — deferred, accepted low-risk [certification_service.py:635-644, 1021-1027]

## Dev Notes

### Why this is a considered compliance change, not a loosening

Story 17.3 chose `completed`-only deliberately ("a queued/running/failed dry-run is not evidence the
skill was successfully exercised"). This story refines that: a `blocked` run WAS successfully
exercised — the skill ran to completion and its QA gate made a correct negative decision. That is
evidence of a working, safe system. The cap (a completed floor) preserves 17.3's underlying intent
("the skill must actually work") while crediting the block. Failed/cancelled stay excluded because
they are NOT a skill verdict — they are infrastructure/user events. This distinction (verdict vs
event) is the whole basis of the change; keep it crisp in the code comments.

### The two-part gate — exact truth table (write this into the tests verbatim)

Let C = distinct completed hashes, B = distinct blocked hashes (blocked not also in completed),
T = distinct(C ∪ B). MIN=5, FLOOR=3.
- C=5, B=0 → T=5 → PASS (unchanged behavior).
- C=3, B=2 → T=5, C≥3 → PASS (the new capability).
- C=2, B=3 → T=5 but C<3 → FAIL (AC3 floor error).
- C=0, B=5 → T=5 but C<3 → FAIL (all-blocked).
- C=2, B=1 → T=3 <5 → FAIL (total-insufficient, existing error).
Note T counts the UNION distinctly — a blocked run whose canonical happens to hash-collide with a
completed run's does not double-count. In practice blocked canonicals embed `source_filename`/
`extracted_at` so collisions don't occur, but the DISTINCT semantics make it safe regardless.

### AC3 error code decision (make it explicit)

Recommend a NEW code `CERTIFICATION_EVIDENCE_ALL_BLOCKED` (422) distinct from
`CERTIFICATION_EVIDENCE_INSUFFICIENT`, because the certifier's remediation differs: insufficient-total
→ "run more protocols"; floor-unmet → "at least 3 must be successful, not blocked." A single generic
message would send the operator down the wrong path. Mirror the two-line constructor idiom of
`CertificationIncompleteError` (`certification_service.py:46-67`) and add the message to
`velara-web/src/shared/utils/errors.ts` `CERTIFICATION_ERROR_MESSAGES`.

### The qa_reason source (AC4)

A blocked run's `InvocationResult.result_metadata` carries the skill's `qa` block (for the bundle
path, `envelope.qa` — e.g. `{"releasable": false, "egregious": [...], "warnings": [...]}`;
`code_driven_executor.py:857`). Surface the egregious list as `qa_reason`. For non-bundle runtimes
the shape may differ — read defensively (`result_metadata.get("qa")` → the egregious/flags list, else
None); never assume a fixed nested shape (mirrors the None-tolerant discipline in
[[project-story-15-5-review]] — a partial/absent structure must degrade to None, never fabricate).

### Interaction with the Run-All-aborts-after-blocked bug (NOT fixed here)

The deferred "Run All stops linking after a blocked job" item means that even once blocked runs COUNT,
the FE Run-All loop may still fail to LINK runs that execute after a block — so the operator might not
see the blocked run (or the ones after it) in the trail without a manual re-link. This story makes the
gate/UI treat blocked runs correctly; it does NOT fix the linking loop. Call this out so the two
aren't conflated — a certifier testing this story should link the blocked run explicitly (or run
configs individually) until the Run-All fix lands.

### No migration, no backfill

Pure counting/eligibility + response-shape change. `output_sha256` already exists (0029);
`result_metadata` already stores `qa`. No new column. Existing blocked runs begin to count the moment
they're linked — no backfill of rows. (The 2026-07-30 field session's one blocked run, NCT03377491,
becomes countable once 17-10 is deployed so it carries a hash, then linked.)

### Container/test gotchas (this repo)

- No source bind-mount in the `api`/`worker` containers — `docker cp` or rebuild BOTH images (they use
  different Dockerfiles: `Dockerfile` for api, `docker/Dockerfile.worker` for worker) and grep-verify
  in-container before trusting a run ([[project-container-stale-baked-test-file]]).
- `.env` is `AUTH_BACKEND=cognito`; run tests with `-e AUTH_BACKEND=dev` and a fresh `velara_test`
  ([[project-velara-api-container-test-env]]).
- Regenerate `docs/api-spec.json` — this story changes API response shape; the CI OpenAPI-diff gate
  will go red otherwise (see the standing deferred-work note about that gate).

### Testing standards

- Backend: pytest, `tests/unit/services/` (compiled-SQL assertions for the new count query, exception
  code/status) + `tests/integration/api/test_certifications.py` (real API, seed helpers). Follow
  17.3's `TestDryRunEvidenceGate` idiom.
- Frontend: Vitest + RTL, `vi.mock` the hooks module wholesale (no MSW), per `CertificationScreen.test.tsx`.
- Enforcement Rules 1/3/5/10 apply (standard envelope, snake_case, no raw exception leakage, CI-green
  before push — [[feedback-verify-ci-before-push]]).

### Git / build context

- Never commit `velara-api`/`velara-web` from dev-story ([[feedback-never-push-subrepos]]) — only
  code-review commits subrepos. Only the top-level docs repo is committed by dev-story.
- Depends on 17-10's uncommitted change; ensure 17-10 is present in the working tree (or landed)
  before running 17-11's integration tests, or a blocked bundle run won't carry a hash.

### References

- [Source: _bmad-output/implementation-artifacts/stories/17-3-certification-dry-run-evidence-gate.md]
  — the gate this story refines (AC2/AC3, `count_sufficient_dry_run_evidence`, the completed-only
  choice being relaxed here).
- [Source: _bmad-output/implementation-artifacts/stories/17-10-bundle-output-sha256-for-cert-gate.md]
  — dependency: makes blocked bundle runs carry a distinct `output_sha256`.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — the 2026-07-30 field entries:
  the blocked NCT03377491 evidence case, and the separate Run-All-aborts-after-blocked + blocked-review-UI
  items (the latter is partially satisfied by this story's AC4/AC5 qa_reason surfacing).
- [Source: velara-api/app/services/certification_service.py#link_dry_run_evidence,L779-847] — the
  `status=="completed"` eligibility to loosen (AC1).
- [Source: velara-api/app/services/certification_service.py#count_sufficient_dry_run_evidence,L498-535]
  — the count query to widen + the new completed-only companion (AC2).
- [Source: velara-api/app/services/certification_service.py#assert_dry_run_evidence_sufficient,L538-554]
  — the two-part gate (AC2/AC3).
- [Source: velara-api/app/services/certification_service.py#list_dry_run_evidence,L850-900] — add
  `qa_reason` + `completed_distinct_count` (AC4).
- [Source: velara-api/app/services/code_driven_executor.py#L857] — where a bundle run's `qa` block is
  placed into `result_metadata` (the AC4 reason source).
- [Source: velara-web/src/features/certification/components/CertificationDryRunTrail.tsx] — the FE card
  (AC5).
- [Source: velara-web/src/shared/utils/errors.ts#CERTIFICATION_ERROR_MESSAGES] — where the AC3 error
  message is added.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (claude-opus-4-8[1m])

### Debug Log References

- Baseline docs-repo HEAD at start of dev: `66825df`. Story frontmatter `baseline_commit` is prose
  (pre-existing) — preserved per Step 4.
- Backend unit (in-container, `-e AUTH_BACKEND=dev`, source `docker cp`'d + `grep -c` verified = 19
  markers): `test_certification_service.py` **40 passed** (new two-part truth table + `_extract_qa_reason`
  + widened-status query shape; pre-existing 17.3 gate tests still green — the two-part gate is
  backward-compatible because a 5-completed trail satisfies both total≥5 and completed≥3).
- Backend integration: `test_certifications.py` **34 passed** (3 new 17.11 tests: mixed-trail 201,
  all-blocked 422, list qa_reason/completed_count); + `test_skills.py` + `test_audit_service.py`
  (they seed cert evidence) — combined run **338 passed**, 0 regressions, fresh `velara_test`.
- ruff: clean on all 5 changed backend files.
- OpenAPI: regenerated `docs/api-spec.json` via host `.venv/bin/python scripts/export_openapi.py`.
  **Large diff (~698 insertions):** MOST is the PRE-EXISTING stale-spec drift already logged in
  deferred-work.md (the committed spec was missing ALL of Story 17.3's dry-run routes/schemas); this
  story's own additions are `qa_reason` + `completed_distinct_count` + the response-shape docstrings.
  Regenerating necessarily pulls in both — the spec is now accurate; the reviewer should know the bulk
  is 17.3 catch-up, not 17.11 surface.
- FE: `tsc --noEmit` clean; `eslint` clean on changed files; `vitest run` **807 passed** (64 files),
  incl. the new blocked-run trail test. Fixed a real slip found by the gate: I initially used a
  non-existent `--color-warn` CSS token — corrected to the real `--color-danger`/`--color-danger-bg`.

### Completion Notes List

- **AC3 error decision: added a distinct `CERTIFICATION_EVIDENCE_ALL_BLOCKED` code** (not a reworded
  `CERTIFICATION_EVIDENCE_INSUFFICIENT`), per the story recommendation — the remediation genuinely
  differs ("run a successful protocol" vs "run more protocols"), so a shared generic message would
  misdirect the certifier.
- **Shared count helper.** Factored the completed-only and completed+blocked counts through one
  `_count_distinct_evidence(statuses=...)` so they can't drift — the eligibility set is defined ONCE
  (`EVIDENCE_ELIGIBLE_STATUSES`) and reused by link + count + list.
- **`is_sufficient` encodes the full cap server-side; FE floor COPY uses local display mirrors.**
  (Wording corrected in review 2026-07-30: the original "cap NOT re-derived in FE" claim was too
  strong.) Key ENABLEMENT is driven solely by the backend `is_sufficient`; the FE additionally holds
  display-only mirrors of the two thresholds (5/3) to choose WHICH explanatory copy to show, now
  guarded on `!isSufficient` so the copy can never contradict the backend verdict even if the
  constants drift.
- **`_extract_qa_reason` is deliberately defensive** — only blocked rows, reads `qa.egregious`
  tolerantly, degrades to None on any absent/non-dict shape (never assumes a fixed nested structure;
  mirrors the None-tolerant billing-input discipline). Non-bundle runtimes with a different qa shape
  simply yield None rather than raising.
- **failed/cancelled remain excluded** (verified: `EVIDENCE_ELIGIBLE_STATUSES` is exactly
  {completed, blocked}). No migration, no backfill — existing blocked runs begin to count the moment
  they are linked.
- **Interaction NOT fixed here (as scoped):** the Run-All-aborts-after-blocked FE loop bug is
  untouched — this story makes blocked runs COUNT and shows their reason, but a certifier may still
  need to link a post-block run manually until that separate fix lands. Noted in Dev Notes.
- **Depends on Story 17-10** (uncommitted in the working tree): a blocked BUNDLE run only carries a
  distinct hash because 17-10 emits `output_sha256`. Both are staged for a combined review.

### File List

**Backend (`velara-api/`):**
- `app/services/certification_service.py` — MODIFIED. New constants (`EVIDENCE_ELIGIBLE_STATUSES`,
  `MIN_COMPLETED_DRY_RUN_EVIDENCE_COUNT`); new `CertificationEvidenceAllBlockedError`; `link_dry_run_evidence`
  eligibility widened; `count_sufficient_dry_run_evidence` widened + new `count_completed_dry_run_evidence`
  + shared `_count_distinct_evidence`; two-part `assert_dry_run_evidence_sufficient`;
  `list_dry_run_evidence` returns 4-tuple with `qa_reason` (via new `_extract_qa_reason`) +
  `completed_distinct_count`.
- `app/schemas/certification.py` — MODIFIED. `CertificationDryRunEvidenceRead.qa_reason`;
  `CertificationDryRunEvidenceListData.completed_distinct_count`.
- `app/api/v1/certifications.py` — MODIFIED. Both `list_dry_run_evidence` unpack sites updated for the
  4-tuple; list handler passes `completed_distinct_count` into the response.
- `docs/api-spec.json` — REGENERATED (adds 17.11 fields + catches up the pre-existing 17.3 dry-run
  route/schema drift).
- `tests/unit/services/test_certification_service.py` — MODIFIED. Two-part gate truth table,
  completed-only query test, AllBlocked error test, `TestExtractQaReason`; removed a now-unused import.
- `tests/integration/api/test_certifications.py` — MODIFIED. `_seed_mixed_dry_run_evidence` helper + 3
  new 17.11 tests.

**Frontend (`velara-web/`):**
- `src/api/certifications.ts` — MODIFIED. `qa_reason` on the evidence item; `completed_distinct_count`
  on the list data.
- `src/features/certification/components/CertificationDryRunTrail.tsx` — MODIFIED. Completed-split
  count badge + capped/floor copy + blocked-run `qa_reason` chips.
- `src/shared/utils/errors.ts` — MODIFIED. `CERTIFICATION_EVIDENCE_ALL_BLOCKED` message.
- `src/features/certification/components/CertificationDryRunTrail.test.tsx` — MODIFIED. New blocked-run
  test + updated badge-text assertions + mock fields.
- `src/features/certification/components/CertificationScreen.test.tsx` — MODIFIED. Mock fields +
  badge-text assertions updated.

_No migration._

**Docs:**
- `_bmad-output/implementation-artifacts/stories/17-11-blocked-runs-count-as-dry-run-evidence.md` — this file.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions.
- `_bmad-output/implementation-artifacts/deferred-work.md` — blocked-review-UI item marked partially superseded.

## Change Log

- 2026-07-30 — Drafted (create-story). Follow-up to Story 17.3, depends on 17-10. Makes `blocked`
  dry-runs count as technical-cert evidence (capped: requires ≥3 completed distinct outputs so a trail
  can't be all blocks) and surfaces each blocked run's QA reason in the trail card, per the product
  argument that a loud block is itself evidence the platform doesn't silently swallow bad data.
  Backend + FE, no migration; OpenAPI response-shape change (regen api-spec.json).
- 2026-07-30 — Implemented (dev-story). Backend: shared `EVIDENCE_ELIGIBLE_STATUSES` (completed+blocked);
  `link_dry_run_evidence` accepts blocked; two-part gate (total≥5 AND completed≥3) via new
  `count_completed_dry_run_evidence` + shared `_count_distinct_evidence`; distinct
  `CERTIFICATION_EVIDENCE_ALL_BLOCKED` 422; `list_dry_run_evidence` surfaces `qa_reason`
  (defensive `_extract_qa_reason`) + `completed_distinct_count`, `is_sufficient` now encodes the full
  cap. FE: count shows "(N successful)", capped/floor copy, blocked-run reason chips, new error
  message. failed/cancelled stay excluded; no migration/backfill. Gates: ruff clean; backend cert
  unit 40 + integration 34 + skills/audit = 338 passed; tsc/eslint clean; vitest 807 passed;
  api-spec.json regenerated (also catches up pre-existing 17.3 spec drift). Depends on 17-10 (both
  staged for combined review).
- 2026-07-30 — Code review (3-layer adversarial, different model than the implementer) + fixes
  applied. **HIGH fix:** `runOne()` now links blocked runs (was completed-only — the widened backend
  eligibility was unreachable from the UI's own run flow). **Other patches:** `_extract_qa_reason`
  normalizes string flags → objects (blank-chip bug); FE renders defensively with truncation +
  "reason unavailable" fallback and the `qa_reason` type honestly widened; 2 new integration tests
  exercise the real `POST /dry-run-evidence` endpoint (blocked → 201, failed → 422); all three
  remediation-copy surfaces now name DISTINCT outputs; floor copy guarded on `!isSufficient`;
  Dev-Record "cap not re-derived" claim corrected. **Deferred (logged):** NULL-hash links never
  count silently (pre-existing pattern); two-query gate TOCTOU (accepted low-risk). **Dismissed:**
  distinct_output_count semantic widening (by design, spec'd); chip key-by-index (static list).
  Gates re-run green: ruff clean, 141 backend tests pass, tsc/eslint clean, 51 certification FE
  tests pass; both docker images rebuilt (live dev env runs the reviewed code). Status → done.
