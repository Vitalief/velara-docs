---
baseline_commit: velara-api HEAD at `0031_invocation_cost_states` (Alembic head). velara-web on
  `development` (no FE change in this story). This is a follow-up to Story 17.3 (certification
  dry-run evidence gate) that closes a gap 17.3's OWN code review knowingly deferred — see the 17.3
  Review Findings "NULL-hash skills blocked from technical cert … kept as a deferred watch item for
  genuinely output-less code-driven-hybrid skills." Field-confirmed 2026-07-30 that the watch item
  has materialized as a HARD BLOCKER (see Dev Notes). Independent of the in-flight cost stories
  (17-4..17-9) — different code path (`code_driven_executor` output-persist step, not pricing /
  reconciler); no shared files, no ordering dependency.
---

# Story 17.10: Emit `output_sha256` for Code-Driven Hybrid Bundle Runs (Unblock the Cert Gate)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech member certifying a code-driven hybrid **bundle** skill (e.g. the velara-protocol-
extractor onboarded via the AI adapter),
I want each successful bundle dry-run to record an output content hash the same way prompt/LLM
runs already do,
so that the technical-certification dry-run gate (Story 17.3) can count its distinct outputs and
the technical key can actually be turned — today it counts every bundle run as a NULL hash, so the
gate reads 0 distinct outputs and NO bundle skill can EVER be technically certified.

## ⚠️ SCOPE — read this first

**Backend only (`velara-api`). No `velara-web` change, no API-surface change, no migration.** The
`InvocationResult.output_sha256` column already exists (added by Story 17.3, migration 0029); the
worker's `_extract_output_sha256` already reads `result_metadata["output_sha256"]` and
`job_service.mark_completed`/`mark_blocked` already accept + persist the `output_sha256` kwarg. The
ONLY thing missing is that the code-driven hybrid BUNDLE output-persist path never *writes*
`output_sha256` into `result_metadata`. This story writes it — one focused addition in
`code_driven_executor.run_code_driven_hybrid`, mirroring exactly how `execution_service._persist_output`
already does it for the other three runtimes.

**This is NOT new ground.** Story 17.3 introduced `output_sha256` and computes it in
`execution_service._persist_output` (`execution_service.py:236,249`) for prompt / LLM-code /
LLM-hybrid runs. `_extract_output_sha256`'s own docstring already documents the bundle path as an
intentional NULL ("code-driven hybrid bundles, which persist output via a different path — Epic
15.5"). This story closes that documented gap; it does not invent a new mechanism.

**Out of scope (do NOT touch):**
- `execution_service._persist_output` — it already writes the hash correctly for its runtimes;
  leave it exactly as-is. (This story adds the SAME behavior in the parallel bundle path, it does
  not refactor the two into one.)
- The certification gate itself (`count_sufficient_dry_run_evidence`, `assert_dry_run_evidence_sufficient`,
  `record_certification`) — the gate's `COUNT(DISTINCT output_sha256)` logic is correct; the bug is
  purely upstream (the hash was never written), so the gate needs zero change.
- The cost stories' territory (17-4..17-9): `cost_usd` / `cost_is_estimated` / `langsmith_run_id` /
  `pricing.py` / the reconciler / `velara_trace.py`. This story touches only the output-hash line in
  the SAME `result_metadata` dict those stories also populate — additive, no overlap.
- The blocked-job path's evidence eligibility (`link_dry_run_evidence` requires `status=="completed"`).
  Blocked jobs correctly never become evidence; that is unchanged. See the "blocked" note in Dev Notes.
- The two OTHER field-diagnosed issues logged alongside this one (Run-All linking aborts after a
  blocked job; no manual-review UI for blocked dry-runs) — separate FE/orchestration concerns, their
  own stories. This story is ONLY the missing `output_sha256`.

## Acceptance Criteria

1. **AC1 — Bundle runs write an output content hash.** On a successful code-driven hybrid bundle
   run, `run_code_driven_hybrid` computes a sha256 hex digest and includes it in the returned
   `result_metadata` under the key `"output_sha256"`, so the existing
   `execution_tasks._extract_output_sha256` → `job_service.mark_completed(output_sha256=...)` chain
   persists it onto `InvocationResult.output_sha256` — identical to the prompt/LLM runtimes.

2. **AC2 — The hash is over the deterministic primary artifact.** The digest is computed over
   `canonical_bytes` (`json.dumps(envelope.canonical).encode("utf-8")` — the authoritative typed
   canonical output already materialized at `code_driven_executor.py:753`), using
   `hashlib.sha256(...).hexdigest()` — the SAME library/approach as `_persist_output`
   (`execution_service.py:236`) and `FileReference.content_sha256`. Rationale: `canonical` is the
   skill's authoritative structured output and is what "differing outputs" (Story 17.3 AC2) is meant
   to distinguish; two runs over different protocols produce different canonical payloads → different
   hashes → counted as distinct. (Do NOT hash a rendered Excel/PDF artifact — those can embed
   run-timestamps/UUIDs that would make every run spuriously "distinct," defeating the gate's intent
   the OTHER way. Canonical JSON of the typed model is the stable, meaningful key.)

3. **AC3 — The cert gate now counts bundle runs.** After this change, ≥5 successful bundle dry-runs
   over ≥5 protocols that yield ≥5 distinct canonical payloads make
   `count_sufficient_dry_run_evidence` return ≥5 for that `skill_version_id`, and a technical
   `POST /api/v1/certifications` no longer 422s `CERTIFICATION_EVIDENCE_INSUFFICIENT` for a bundle
   skill on that basis. No change to the gate code — verified via a test that seeds real bundle-shaped
   evidence rows (with distinct `output_sha256`) and asserts the count.

4. **AC4 — Blocked and legacy runs stay NULL-safe.** A `blocked` bundle run still records its hash
   (the executor computes it before the worker decides blocked-vs-completed — `mark_blocked` already
   accepts `output_sha256`), but a blocked job is still not evidence (unchanged eligibility). A run
   whose envelope has an empty/degenerate `canonical` still produces a valid (if low-entropy) hash,
   never a crash and never a fabricated value — mirroring the NULL-not-fabricated discipline. No
   pre-existing NULL-hash rows are back-filled (same no-backfill convention as the pricing table).

## Tasks / Subtasks

- [x] **Task 1 — Compute + emit `output_sha256` in the bundle output-persist step (AC1, AC2)**
  - [x] In `app/services/code_driven_executor.py`, `run_code_driven_hybrid`, at the point where
    `canonical_bytes` is built (line 753, Step 9), compute
    `output_sha256 = hashlib.sha256(canonical_bytes).hexdigest()`. `hashlib` was NOT imported —
    added `import hashlib` to the top-of-module import block (after `from __future__`, before `json`).
  - [x] Added `"output_sha256": output_sha256` into the `result_metadata` dict as a first-class
    top-level key (after `"status"`, before `"output_files"`), NOT nested under `canonical` —
    `_extract_output_sha256` reads it at the top level.
  - [x] No change to the artifact-upload loop, canonical upload, envelope parsing, or any cost/usage
    key — a single additive computation + a single dict entry.

- [x] **Task 2 — Verify the existing worker chain carries it through (AC1) — read-only confirmation**
  - [x] Confirmed (no code change): `execution_tasks._extract_output_sha256` (line 225) reads
    `(result_metadata or {}).get("output_sha256")`; it is extracted once (line 397) and passed to
    BOTH `mark_completed` (line 411) and `mark_blocked` (line 437). `job_service.mark_completed`
    (line 535) and `mark_blocked` (line 600) both accept `output_sha256: str | None` and persist it.
    The bundle path routes through the same worker branch as every other runtime — no separate wiring
    needed.

- [x] **Task 3 — Tests (all ACs)**
  - [x] Unit (`tests/unit/services/test_code_driven_executor.py`): 4 new tests via the existing
    `_invoke_with_envelope` harness (mocked storage/subprocess, no real sandbox) —
    `test_output_sha256_emitted_for_bundle_run` (AC1/AC2: equals
    `sha256(json.dumps(canonical).encode()).hexdigest()`),
    `test_output_sha256_distinct_for_different_canonical` (AC2/AC3: two payloads → two hashes),
    `test_output_sha256_present_on_blocked_run` (AC4), `test_output_sha256_valid_hex_for_empty_canonical`
    (AC4: 64-char hex, no crash). RED confirmed (KeyError before the fix) → GREEN after.
  - [x] Integration (AC1/AC3): extended `test_code_driven_execution.py::test_run_code_driven_hybrid_e2e`
    — the REAL executor-through-worker path — to assert `metadata["output_sha256"]` equals the sha256
    of the persisted canonical payload. This is the primary end-to-end proof (executor → the exact
    `InvocationResult.output_sha256` value the Story 17.3 gate counts). Did NOT add a redundant
    `count_sufficient_dry_run_evidence` seed test: 17.3's suite already covers the gate's
    distinct-count with directly-inserted hashes; this story's job is proving the bundle path
    *produces* those hashes, which the unit + e2e tests do.
  - [x] Regression: `test_output_sha256_valid_hex_for_empty_canonical` covers the empty-canonical case.
  - [x] Gates (Enforcement Rule 10): `ruff check` clean on all 3 changed files; tests green in the
    container with `-e AUTH_BACKEND=dev`; container confirmed to hold the edited source (grep
    "Story 17.10" → 2 hits) before trusting the pass. See Debug Log for the full run list.

## Dev Notes

### Why this is a real, hard blocker (not a theoretical edge case)

Field-diagnosed 2026-07-30 while certifying the velara-protocol-extractor (a code-driven hybrid
bundle onboarded via the MA-Tech adapter). Five dry-run configs were created and run; four completed
successfully and were linked as evidence. `count_sufficient_dry_run_evidence` still returned **0**,
because every one of those four `invocation_results` rows had `output_sha256 = NULL`. The gate counts
`COUNT(DISTINCT output_sha256)` (`certification_service.py:519`), and Postgres `COUNT(DISTINCT ...)`
ignores NULLs → 0. So the technical key can never be turned for a bundle skill, regardless of how many
clean runs are recorded.

Story 17.3's own code review anticipated this exact case and deferred it (17.3 Review Findings, "NULL-
hash skills blocked from technical cert … resolved in context by the redesign … kept as a deferred
watch item for genuinely output-less code-driven-hybrid skills"). The reviewer assumed the protocol-
upload redesign meant bundle runs "reach distinct hashes normally." That assumption is false: the
bundle path in `code_driven_executor` never routes through `_persist_output` (where the hash is
computed) and never writes `output_sha256` at all — independent of whether it produced output. This
story is the resolution of that deferred watch item.

**Platform reach:** the MA-Tech adapter's whole premise is "any skill becomes a code-driven hybrid
bundle." So this blocks technical certification for the ENTIRE bundle skill class — the platform's
primary skill-onboarding path — not just one skill.

### The exact code and the exact one-line-ish fix

`code_driven_executor.run_code_driven_hybrid`, Step 9 (`code_driven_executor.py:740-891`):
```python
# line ~753 — the authoritative output bytes are ALREADY in hand:
canonical_bytes = json.dumps(envelope.canonical).encode("utf-8")
# ── ADD: compute the hash over these exact bytes ──
output_sha256 = hashlib.sha256(canonical_bytes).hexdigest()
...
# line ~847 — result_metadata is built here; ADD the key:
result_metadata = {
    ...
    "output_sha256": output_sha256,     # ← NEW top-level key
    "canonical": {... "data": envelope.canonical ...},
    ...
}
return canonical_key, result_metadata
```
Everything downstream already exists: `_extract_output_sha256` (`execution_tasks.py:215-227`) reads
`result_metadata["output_sha256"]`; `mark_completed`/`mark_blocked` (`job_service.py`) already take
and persist the `output_sha256` kwarg (added by Story 17.3, File List). Nothing else moves.

### Why hash `canonical`, not the Excel/PDF (AC2 rationale — make this decision explicitly)

Two ways to get "differing outputs" wrong, and canonical-JSON avoids both:
- Hashing a rendered artifact (xlsx/pdf) risks embedding run-time non-determinism (timestamps, UUIDs,
  zip member ordering) → every run hashes differently → the gate is defeated in the permissive
  direction (5 identical-content runs falsely "distinct").
- Hashing nothing (today) → the gate is defeated in the blocking direction (all NULL → count 0).
`envelope.canonical` is the skill's authoritative typed model, the same object Story 17.3 AC2's
"actually exercised across varied inputs" is about. Different protocol in → different canonical out →
different hash. It is also already materialized as `canonical_bytes` for upload, so there is zero
extra serialization cost. Mirrors `_persist_output`, which hashes the rendered `output_bytes` for
LLM runs — the bundle's analogue of "the output" is its canonical payload, which it uploads as the
primary artifact (`code_driven_executor.py:753,772-779`).

### Blocked runs (AC4) — for completeness, not a behavior change

The executor computes `output_sha256` BEFORE the worker's blocked-vs-completed branch
(`execution_tasks.py:391-455`), so a `blocked` bundle run will now also carry a hash — and
`mark_blocked` already accepts it. This is harmless and slightly beneficial (a future feature could
inspect it), but changes nothing about eligibility: `link_dry_run_evidence` still requires
`status=="completed"` (`certification_service.py:814`), so blocked runs remain non-evidence. Do not
add any blocked-run evidence path here.

### No migration, no API change, no FE change

`InvocationResult.output_sha256` (String(64), nullable) already exists from migration 0029. No new
column, no OpenAPI diff (this doesn't add/alter a route or response field — the trail endpoint already
returns `output_sha256` from the join; it was simply always null for bundles). Nothing in `velara-web`
changes — the Dry-Run Trail card already renders the distinct-output count from the existing endpoint
and will simply start counting bundle runs.

### No backfill

Pre-existing bundle `invocation_results` rows with NULL `output_sha256` are NOT back-filled (they'd
require re-hashing stored canonical artifacts and re-opening closed jobs). New runs get the hash; a
certifier re-runs their dry-run trail (the normal per-version "Run All" flow already re-executes) to
generate hashed evidence. Same no-backfill convention as the LLM pricing table
([[project-llm-pricing-table]]). Call this out in the Completion Notes so it isn't mistaken for a miss.

### Container/test gotchas (this repo specifically)

- The `api` container bakes source into the image with NO bind mount — an edited host file is NOT seen
  by in-container `pytest` until `docker cp`'d or the image is rebuilt. "N passed" can be the STALE
  baked file. Verify the container has your change (grep the new `output_sha256 =` line in-container)
  before trusting a green run. ([[project-container-stale-baked-test-file]])
- The container's `.env` sets `AUTH_BACKEND=cognito`; bare `pytest` → hundreds of 401s. Run with
  `AUTH_BACKEND=dev` (`set -a; . ./.env.test`, or `-e AUTH_BACKEND=dev`) and recreate `velara_test`
  clean before trusting a full run. ([[project-velara-api-container-test-env]])

### Testing standards

- Backend: pytest, co-located `tests/unit/services/` (pure logic, mocked storage/subprocess — do NOT
  launch a real sandbox) + `tests/integration/` where a live DB is needed. Follow the existing
  code-driven executor/hybrid test conventions (mock `StorageProvider`, mock `_run_subprocess`).
- Enforcement Rules 1/3/5/10 apply: standard error envelope (no new errors here), snake_case fields,
  no raw exception leakage, and CI-green-before-push in the same environment CI uses (Rule 10) —
  a "pre-existing failure" note is not a license to push (see [[feedback-verify-ci-before-push]]).

### Git / build context

- Do NOT commit `velara-api` from this story (never-push-subrepos rule — [[feedback-never-push-subrepos]]);
  only `code-review` commits subrepos, post-review. Only the top-level docs repo is committed by dev-story.
- No `velara-web` change in this story.

### References

- [Source: _bmad-output/implementation-artifacts/stories/17-3-certification-dry-run-evidence-gate.md#Review-Findings]
  — the deferred "NULL-hash skills blocked from technical cert" watch item this story resolves; and
  17.3 AC2 ("differing outputs" via `output_sha256`) that the gate depends on.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — the 2026-07-30 field-diagnosis
  entry "CERT BLOCKER — code-driven hybrid BUNDLE runs never get `output_sha256`" (root cause + repro).
- [Source: velara-api/app/services/code_driven_executor.py#run_code_driven_hybrid,L740-891] — Step 9,
  where `canonical_bytes` is built (L753) and `result_metadata` is assembled (L847): the insertion point.
- [Source: velara-api/app/services/execution_service.py#_persist_output,L191-249] — the existing
  `hashlib.sha256(output_bytes).hexdigest()` + `result_metadata["output_sha256"]` precedent to mirror.
- [Source: velara-api/app/workers/execution_tasks.py#_extract_output_sha256,L215-227] — the reader
  (unchanged); its docstring documents the bundle-path NULL this story fixes.
- [Source: velara-api/app/workers/execution_tasks.py#L391-455] — the blocked-vs-completed branch;
  both `mark_blocked`/`mark_completed` already pass `output_sha256` through.
- [Source: velara-api/app/services/certification_service.py#count_sufficient_dry_run_evidence,L498-531]
  — the `COUNT(DISTINCT output_sha256)` gate that reads 0 for NULL hashes (unchanged by this story).
- [Source: velara-api/app/models/invocation.py#InvocationResult] — `output_sha256` column (from
  migration 0029, Story 17.3) — already exists, no new migration.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (claude-opus-4-8[1m])

### Debug Log References

- Baseline commit at start of dev (docs repo HEAD): `efb62c9`. Story frontmatter's `baseline_commit`
  is a prose descriptor (pre-existing) — preserved per workflow Step 4, actual HEAD recorded here.
- RED: `docker compose cp` test file → container, then
  `pytest tests/unit/services/test_code_driven_executor.py -k output_sha256` → **4 failed**
  (`KeyError: 'output_sha256'`) — confirmed the tests exercise the missing behavior.
- GREEN: `docker compose cp app/services/code_driven_executor.py` → container; verified in-container
  `grep -c "Story 17.10"` = 2 (source actually updated, not stale baked file); re-ran → **4 passed**.
- Regression + gates (all in-container, `-e AUTH_BACKEND=dev`):
  - `test_code_driven_executor.py` (unit) — **52 passed** (48 pre-existing + 4 new).
  - `test_code_driven_execution.py::test_run_code_driven_hybrid_e2e` — **1 passed** (real
    executor→worker path emits + matches `output_sha256`); full file **10 passed**.
  - `test_execution_tasks.py` (worker integration, reads `result_metadata`) — **25 passed**.
  - `test_code_driven_executor.py + test_execution_service.py + test_certification_service.py`
    (unit) — **156 passed** (1 pre-existing ResourceWarning, not a failure).
  - `ruff check` on all 3 changed files — clean (fixed one E501 on an over-long e2e assertion by
    hashing the already-parsed `payload` dict instead of re-inlining the literal).
- Container/test-env gotchas from memory held: `.env` is `AUTH_BACKEND=cognito` (used `-e
  AUTH_BACKEND=dev`); no source bind-mount, so every edit was `docker cp`'d and grep-verified
  in-container before trusting a result.

### Completion Notes List

- **The fix is exactly the 17.3-deferred gap, closed.** `run_code_driven_hybrid` already had the
  authoritative output bytes in hand (`canonical_bytes`, built for the primary-artifact upload). The
  change is one hash computation + one top-level `result_metadata` key. Everything downstream
  (`_extract_output_sha256` → `mark_completed`/`mark_blocked` → `InvocationResult.output_sha256` →
  the gate's `COUNT(DISTINCT output_sha256)`) already existed from Story 17.3 — Task 2 confirmed the
  wiring rather than adding to it.
- **Hashed `canonical`, not a rendered artifact (AC2 decision).** The canonical JSON is deterministic
  and is the "differing outputs" signal Story 17.3 AC2 is about; a rendered xlsx/pdf can embed
  run-timestamps/UUIDs that would make every run spuriously distinct (defeating the gate the other
  way). Mirrors `execution_service._persist_output`'s `hashlib.sha256(...).hexdigest()`.
- **Blocked runs now carry a hash too** (computed before the worker's blocked-vs-completed branch),
  but eligibility is unchanged — `link_dry_run_evidence` still requires `status=="completed"`, so
  blocked runs remain non-evidence. Harmless and slightly future-useful.
- **No backfill.** Pre-existing NULL-hash bundle rows are not touched (same no-backfill convention as
  the LLM pricing table). A certifier re-runs their dry-run trail (the normal per-version "Run All")
  to generate hashed evidence — the ~4 NULL-hash rows from the 2026-07-30 field session will not
  retroactively count.
- **No migration / no API / no FE**, as scoped. `InvocationResult.output_sha256` already exists from
  migration 0029; the trail endpoint already returns it (was simply always null for bundles); the
  Dry-Run Trail card will start counting bundle runs with no FE change.
- **Operational note for the certifier who hit the original blocker:** after this lands, re-run the
  5-config dry-run trail; bundle runs will now produce distinct hashes and
  `count_sufficient_dry_run_evidence` will climb. (The separate Run-All-aborts-after-blocked and
  blocked-review-UI issues logged in deferred-work.md are NOT addressed here — their own stories.)

### File List

**Backend (`velara-api/`):**
- `app/services/code_driven_executor.py` — MODIFIED. Added `import hashlib`; compute
  `output_sha256 = hashlib.sha256(canonical_bytes).hexdigest()` in `run_code_driven_hybrid` Step 9
  and emit it as a top-level `result_metadata["output_sha256"]` key.
- `tests/unit/services/test_code_driven_executor.py` — MODIFIED. 4 new unit tests (Story 17.10 section).
- `tests/integration/api/test_code_driven_execution.py` — MODIFIED. Extended
  `test_run_code_driven_hybrid_e2e` with an `output_sha256` assertion over the persisted canonical.

_No migration, no schema, no API route, no `velara-web` change._

**Docs:**
- `_bmad-output/implementation-artifacts/stories/17-10-bundle-output-sha256-for-cert-gate.md` — this file.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions.
- `_bmad-output/implementation-artifacts/deferred-work.md` — CERT-BLOCKER entry updated to point here.

## Change Log

- 2026-07-30 — Drafted (create-story). Follow-up to Story 17.3 closing its knowingly-deferred
  "NULL-hash bundle skills can't be technically certified" watch item, after field diagnosis
  confirmed it as a hard blocker for the entire code-driven-hybrid bundle skill class. Backend-only,
  no migration/API/FE change: emit `output_sha256` (sha256 of the canonical payload) from
  `run_code_driven_hybrid`'s output-persist step so the existing Story 17.3 worker→gate chain counts
  bundle dry-runs as distinct outputs.
- 2026-07-30 — Implemented (dev-story). Added `import hashlib` + computed
  `output_sha256 = hashlib.sha256(canonical_bytes).hexdigest()` in `run_code_driven_hybrid` Step 9,
  emitted as a top-level `result_metadata["output_sha256"]`. Confirmed (no change needed) the existing
  worker chain carries it through to `InvocationResult.output_sha256` (the column the Story 17.3
  technical-cert gate counts). Tests: 4 new unit (`test_code_driven_executor.py`, RED→GREEN) + extended
  the e2e integration test (`test_code_driven_execution.py`) to assert the real executor emits the hash.
  Gates: `ruff` clean on all 3 changed files; unit executor 52 passed, e2e file 10 passed, worker
  integration 25 passed, executor+execution_service+certification unit 156 passed — 0 regressions
  (in-container, `AUTH_BACKEND=dev`, source `docker cp`'d + grep-verified). No migration/API/FE change;
  no backfill of pre-existing NULL-hash rows.
