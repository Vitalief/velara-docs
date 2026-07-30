---
baseline_commit: velara-api HEAD at `0031_invocation_cost_states` (Alembic head), on top of the
  uncommitted Story 17-10 change (`code_driven_executor.output_sha256`) — 17-11 DEPENDS on 17-10:
  a blocked run only carries a distinct hash because 17-10 makes the bundle path emit one. Sequence
  17-10 → 17-11 (or land them together). velara-web on `development`; this story DOES change FE
  (the Dry-Run Trail card). Follow-up to Story 17.3 (the gate) — loosens what terminal status counts
  as evidence, a compliance-weighted change to a 21 CFR Part 11 gate, hence its own story not a patch.
---

# Story 17.11: Count `blocked` Dry-Runs as Evidence (Capped) + Surface the QA Reason

Status: ready-for-dev

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

- [ ] **Task 1 — Backend: shared eligibility set + loosen link (AC1, AC6)**
  - [ ] Add module-level `EVIDENCE_ELIGIBLE_STATUSES = frozenset({"completed", "blocked"})` and
    `MIN_COMPLETED_DRY_RUN_EVIDENCE_COUNT = 3` near `MIN_DRY_RUN_EVIDENCE_COUNT`
    (`certification_service.py:40-42`).
  - [ ] In `link_dry_run_evidence`, change the job query's `InvocationJob.status == "completed"` to
    `InvocationJob.status.in_(EVIDENCE_ELIGIBLE_STATUSES)`. Keep the idempotent-duplicate and
    version-match logic identical.

- [ ] **Task 2 — Backend: gate counts with a completed floor (AC2, AC3)**
  - [ ] `count_sufficient_dry_run_evidence`: change the `status == "completed"` filter to
    `status.in_(EVIDENCE_ELIGIBLE_STATUSES)`. Update its docstring (it currently states the
    completed-only rationale).
  - [ ] New `count_completed_dry_run_evidence(*, session, skill_version_id, org_id) -> int` — the
    same query but `status == "completed"` only. (Factor the shared query body if clean; else a small
    duplicate is fine per this repo's no-shared-helper convention.)
  - [ ] `assert_dry_run_evidence_sufficient`: require BOTH total `>= MIN_DRY_RUN_EVIDENCE_COUNT` AND
    completed `>= MIN_COMPLETED_DRY_RUN_EVIDENCE_COUNT`. Raise the total-insufficient error for the
    first, and the all-blocked/floor error (AC3 decision) for the second.
  - [ ] AC3 error: DECIDE — extend `CertificationEvidenceInsufficientError`'s message to be
    floor-aware, or add `CertificationEvidenceAllBlockedError` (`CERTIFICATION_EVIDENCE_ALL_BLOCKED`,
    422, same two-line constructor idiom). Document the choice + add any new code to the FE
    `CERTIFICATION_ERROR_MESSAGES` map. Recommend a distinct code — the remediation differs ("run a
    clean protocol" vs "run more protocols").

- [ ] **Task 3 — Backend: trail response carries block reason + completed count (AC4)**
  - [ ] `list_dry_run_evidence`: add `qa_reason` per row — pull the linked
    `InvocationResult.result_metadata->'qa'` (egregious/flags) for blocked rows (NULL for completed).
    Add the `InvocationResult.result_metadata` to the select (or a targeted JSON accessor) alongside
    the existing `output_sha256`. Add `completed_distinct_count` to the returned summary tuple.
  - [ ] Update the response Pydantic schema (`schemas/certification.py`) with `qa_reason` (nullable)
    and `completed_distinct_count`. This is an API-surface change → regenerate `docs/api-spec.json`
    (`scripts/export_openapi.py`) as part of the story so CI's OpenAPI-diff gate stays green.

- [ ] **Task 4 — Frontend: trail card counts + reason (AC5)**
  - [ ] `CertificationDryRunTrail.tsx`: consume the new `completed_distinct_count` + `qa_reason`
    fields; render blocked runs with a distinct badge (reuse `JobStatusBadge`) and their `qa_reason`
    (inline or expandable — reuse the existing detail-panel pattern). Trail count text shows
    "X of 5 (Y successful)".
  - [ ] Key enablement stays driven by backend `is_sufficient` (do NOT re-derive the cap in FE). When
    insufficient due to the floor, show the specific message from the AC3 error/summary.
  - [ ] Update `api/certifications.ts` types (`CertificationDryRunEvidenceItem` gains `qa_reason`;
    summary gains `completed_distinct_count`).

- [ ] **Task 5 — Tests (all ACs)**
  - [ ] Backend unit: eligibility-set constant; `count_completed_dry_run_evidence` query shape
    (compiled-SQL assertion idiom, mirroring `TestDryRunEvidenceGate`); the two-part
    `assert_dry_run_evidence_sufficient` truth table — (5 completed → pass), (3 completed + 2 blocked
    → pass), (5 blocked + 0 completed → fail floor), (2 completed + 3 blocked → fail floor),
    (4 total → fail total). AC3 error code/status test.
  - [ ] Backend integration (`test_certifications.py`): extend the seed helper to seed blocked
    evidence (a `blocked` job + `InvocationResult` with a distinct `output_sha256` + a `qa` metadata
    block); assert the mixed-trail 201 path and the all-blocked 422 path end-to-end via the real API.
    Assert `list_dry_run_evidence` returns `qa_reason` for a blocked row and NULL for a completed row.
  - [ ] Frontend: `CertificationDryRunTrail.test.tsx` — blocked run renders its badge + qa_reason;
    count text shows the "(Y successful)" split; key disabled with the floor-specific message when
    all-blocked. `CertificationScreen.test.tsx` — key enablement follows the new `is_sufficient`.
  - [ ] Gates (Enforcement Rule 10): `ruff` + `pytest` (fresh `velara_test`, `AUTH_BACKEND=dev`,
    source `docker cp`'d/rebuilt + grep-verified in-container); `tsc`/`eslint`/`vitest`; regenerate
    `docs/api-spec.json` and confirm the OpenAPI-diff CI gate is green.

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

_(dev-story to fill)_

### Debug Log References

_(dev-story to fill)_

### Completion Notes List

_(dev-story to fill)_

### File List

_(dev-story to fill — expected backend: certification_service.py, schemas/certification.py, possibly a
new exception; frontend: CertificationDryRunTrail.tsx, api/certifications.ts, errors.ts, + tests on
both sides; docs/api-spec.json regenerated. No migration.)_

## Change Log

- 2026-07-30 — Drafted (create-story). Follow-up to Story 17.3, depends on 17-10. Makes `blocked`
  dry-runs count as technical-cert evidence (capped: requires ≥3 completed distinct outputs so a trail
  can't be all blocks) and surfaces each blocked run's QA reason in the trail card, per the product
  argument that a loud block is itself evidence the platform doesn't silently swallow bad data.
  Backend + FE, no migration; OpenAPI response-shape change (regen api-spec.json).
