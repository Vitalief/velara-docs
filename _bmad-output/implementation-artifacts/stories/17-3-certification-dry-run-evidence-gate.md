---
baseline_commit: velara-api head `0028_study_protocol_association` (Alembic); velara-web on
  `development`, Story 16.8 landed (per sprint-status.yaml). This is the FIRST story picked from
  Epic 17 (backlog→in-progress by this drafting). Independent of 17.1/17.2 (LangSmith tracing) —
  no dependency, no shared files. Confirmed via broad grep across both subrepos: NO existing
  "dry-run"/"trigger_source"/"job_kind"/"preset"/"template" concept anywhere in the codebase — this
  story introduces genuinely new schema on both sides, not an extension of an existing mechanism.
---

# Story 17.3: Certification Dry-Run Evidence Gate (5 Runs Before the Technical Key)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech member,
I want to perform and retain a trail of 5 runs of a skill with differing outputs before I can
record its technical certification, and to create/re-run that trail on demand (including a
"Run All" action whenever the skill is updated to a new version),
so that there is documented evidence the skill was exercised before I turn the technical key, and
re-generating that evidence for a new version doesn't mean starting from a blank slate every time.

## ⚠️ SCOPE — read this first

**Backend (`velara-api`) + Frontend (`velara-web`).** Extends Epic 6.2's existing "Technical
Certification" panel (`CertificationScreen.tsx`) — **not a new screen** (epic AC6). Independent of
Story 17.1/17.2 (LangSmith) — zero shared files, no ordering dependency either way.

**This is genuinely new ground, not an extension of an existing mechanism.** Confirmed by two
independent code searches (backend + frontend): there is no "dry-run"/"test-run" concept, no
`job_kind`/`trigger_source`/`initiated_by` field on `InvocationJob`, and no "saved input
preset/template" concept anywhere in either subrepo today. Every piece of schema and UI below is
net-new; nothing is a variant of prior work.

**Two things this story must build that go beyond the epic's literal AC1 wording** (added per
product-owner direction during drafting, 2026-07-27):
1. A UI to **create/configure** the 5 dry-run definitions for a skill version, each with its own
   custom input payload (not just "click run" — an ma_tech member defines what each of the 5 runs'
   inputs are).
2. A **"Run All"** action that re-executes the current saved set of dry-run configs in one action —
   most valuable after a skill is updated to a new version, since AC5 (below) already requires a
   fresh ≥5-run trail per version with no carry-over. Individual configs must also be runnable
   one at a time (a full "Run All" is not the only way to add a run to the trail).

**Out of scope (do NOT touch):**
- `RecordTechnicalCertModal.tsx`'s existing checklist (`CHECKLIST_ITEMS`) — that is a separate
  manual attestation, unrelated to this gate. Leave it exactly as-is; the new dry-run gate is an
  *additional*, harder precondition checked before the modal can even be opened/submitted.
- Story 6.3 (Methodological Certification) — explicitly NOT gated by this story (epic AC4). Do not
  touch `RecordMethodologicalCertModal.tsx` or any methodological-path code.
- `CertificationRecord`'s append-only contract and DB trigger (`0015_certification_records.py`) —
  this story is additive evidence, not a change to the immutable cert record itself.
- Story 17.1/17.2 (LangSmith tracing) — no shared files, no need to sequence against them.
- `assert_certified_for_client_ready` / the lifecycle-advance (`client_ready`) gate — a different
  call site (PATCH lifecycle, not POST /certifications). This story's gate lives inside
  `record_certification` itself (see Dev Notes).

## Acceptance Criteria

1. **AC1 — Dry-run trail is captured against a skill version, via real invocations.** An ma_tech
   member can register up to (at least) 5 certification dry-runs for a specific skill version, each
   linking to an actual `InvocationJob` produced by the existing invocation path (`POST
   /api/v1/invocations/{skill_id}`, version-pinned) — not a parallel runner and not free-text. The
   trail is scoped per `skill_version_id` (not just `skill_id`) so it naturally resets on a new
   version (AC5).

2. **AC2 — "Differing outputs" is enforced automatically, not attested.** Decision (documented here,
   per the epic's explicit instruction not to silently pick one): each dry-run's output is hashed at
   persist time (new `output_sha256` column on `InvocationResult`, mirroring the existing
   `FileReference.content_sha256` precedent); the trail is "sufficient" only when **≥5 dry-run jobs
   for the exact skill version have ≥5 DISTINCT `output_sha256` values**. Rationale: the epic's intent
   is evidence the skill was *actually exercised across varied inputs* — a self-reported checkbox
   would let a certifier click through 5 identical runs, defeating the purpose; the codebase already
   has a working precedent (`FileReference.content_sha256`, input-hashing in `job_service.py`) to
   mirror, so automatic enforcement costs no new pattern.

3. **AC3 — Technical key is gated on the trail.** `POST /api/v1/certifications` with
   `certification_type=technical` returns HTTP 422 with a new stable error code
   `CERTIFICATION_EVIDENCE_INSUFFICIENT` unless ≥5 dry-run jobs with ≥5 distinct output hashes exist
   for that exact `skill_version_id` — mirroring the existing `CERTIFICATION_INCOMPLETE` /
   `RECERTIFICATION_REQUIRED` idiom (`certification_service.py:46-67`) exactly. The check runs only
   when `certification_type == "technical"` (methodological is unaffected, AC4).

4. **AC4 — Immutability + signature manifestation preserved.** The dry-run trail (new tables, see Dev
   Notes) is purely additive evidence; `CertificationRecord`'s append-only contract and DB trigger
   are untouched. The FR-SEC-10 electronic-signature manifestation (signer, UTC timestamp, meaning)
   is unchanged. Methodological certification (6.3) is NOT gated by this story.

5. **AC5 — Re-certification on a new version requires a fresh trail.** Because the trail is keyed to
   `skill_version_id` (a real FK, not the semver string), a new `SkillVersion` row automatically has
   zero dry-run evidence — no explicit "reset" logic needed, this falls out of correct scoping. The
   story must NOT copy/carry over dry-run configs' *executed results* to a new version; saved dry-run
   *config definitions* (the input payloads) MAY be copied forward as a convenience starting point
   (see AC7), but the executed evidence itself never carries over.

6. **AC6 — UI surface on the Certification detail panel.** `CertificationDetail`
   (`CertificationScreen.tsx`) shows a new "Dry-Run Trail" card (between the two-key panel and the
   Part 11 manifestation block) displaying: the current trail count (`X of 5 distinct outputs`),
   each dry-run's status/output summary (reusing `JobRow`/`JobDetailPanel` per the
   `RecentRunsPanel` precedent), and blocks/enables the "Turn technical key" button in `KeyCard`
   accordingly. **Note:** the technical `KeyCard`'s `isLocked` prop is currently hardcoded `false`
   (`CertificationScreen.tsx:404` — there is no existing lock condition on the technical key today;
   only the methodological card has a real sequencing-based `isLocked`, line 415). This story
   replaces the technical card's `isLocked={false}` with `isLocked={!dryRunTrailSufficient}` (or an
   equivalent dedicated `disabled` prop) — it is NOT layering onto an existing condition, since none
   exists for the technical key.

7. **AC7 — Dry-run configs are creatable with custom inputs, individually runnable, and re-runnable
   via "Run All."** The Dry-Run Trail card includes:
   - A way to create/edit up to 5 named dry-run configs for the skill's *current* version, each
     with its own input payload rendered via the skill's existing input schema form
     (`parseInputFields`/`SchemaInputsForm`, reused verbatim — not rebuilt).
   - A per-config "Run" action that fires that one config's inputs through the existing invocation
     path and links the resulting job to the trail (AC1).
   - A single "Run All" action that fires all saved configs (in order, showing per-config progress)
     — the primary way to regenerate the full trail after a skill version bump, without re-creating
     every config's inputs from scratch. Saved config *definitions* persist across skill versions
     (a new version's Dry-Run Trail starts with the same 5 named configs, zero executed evidence)
     so "Run All" is meaningful immediately after a version bump, not just on first setup.
   - Config CRUD is ma_tech-scoped (same `RejectNonGrantor`/`RejectNonMaTech` tier as the rest of the
     certification surface — see Dev Notes decision below).

## Tasks / Subtasks

- [x] **Task 1 — Backend: dry-run config + evidence schema (AC1, AC2, AC5, AC7)**
  - [x] New Alembic migration `0029_certification_dry_runs.py`, `down_revision =
    "0028_study_protocol_association"`. Creates TWO tables:
    - `certification_dry_run_configs` — the saved, reusable input-set definitions, scoped to
      `skill_id` (survives version bumps, per AC7): `id` (UUID PK), `skill_id` (FK `skills.id`,
      CASCADE), `label` (String(128)), `inputs` (JSONB — same shape `InvocationPayload.inputs`
      expects), `sort_order` (Integer), `org_id` (String(128)), `created_by_user_id` (String(128)),
      `created_at`/`updated_at` (tz-aware). Index on `skill_id`.
    - `certification_dry_run_evidence` — the executed-run link, scoped to `skill_version_id` (resets
      per version, per AC5): `id` (UUID PK), `skill_version_id` (FK `skill_versions.id`, CASCADE —
      mirrors `CertificationRecord`'s binding idiom, `certification.py:43-47`), `invocation_job_id`
      (FK `invocation_jobs.id`, **no CASCADE** — mirror `InvocationJob`'s own "survive" convention,
      `invocation.py:65-70,100-107`), `dry_run_config_id` (FK `certification_dry_run_configs.id`,
      nullable — nullable because AC1 only requires linking a real job, a config is a UX convenience
      not a hard requirement), `org_id`, `created_at`. Unique index on `invocation_job_id` (one job
      counts as evidence at most once). Index on `skill_version_id`.
    - Follow `0015_certification_records.py`'s conventions exactly: UUID PKs via
      `postgresql.UUID(as_uuid=True)`, VARCHAR (not PG enum) for any status-like field, Python-set
      `datetime.now(UTC)` defaults (no `server_default`). Neither table needs the append-only
      trigger (`0015`'s `reject_certification_mutation()`) — evidence rows aren't Part 11 records
      themselves, only inputs to a gate; confirm this reading with the architect if in doubt, but
      nothing in AC4 requires dry-run rows to be immutable, only that `CertificationRecord` stays so.
  - [x] New SQLAlchemy models in `app/models/certification.py` (co-located with `CertificationRecord`,
    same file): `CertificationDryRunConfig`, `CertificationDryRunEvidence`. No `relationship()`
    attributes needed — follow `CertificationRecord`'s flat-FK, explicit-`select()`-join convention.
  - [x] Add `output_sha256: Mapped[str | None]` (String(64), nullable) to `InvocationResult`
    (`app/models/invocation.py:160-219`) in the SAME migration — computed in
    `execution_service._persist_output` (`execution_service.py:191-237`) alongside the existing
    `output_file_key` write, mirroring how `FileReference.content_sha256` is computed
    (`0021_file_ref_content_hash.py` precedent — locate and read this migration + its call site
    before implementing, to match the hashing approach exactly, e.g. `hashlib.sha256(output_bytes).hexdigest()`).

- [x] **Task 2 — Backend: dry-run config CRUD + run-linking endpoints (AC1, AC7)**
  - [x] Extended `app/api/v1/certifications.py` (rather than a separate router file — simpler, one
    less file, same prefix already matches), gated `dependencies=[RejectNonGrantor]` to match the
    existing certification router tier (`certifications.py:32-38`).
    **RBAC decision:** kept `RejectNonGrantor` (admin+ma_tech) for consistency with the parent
    certification surface — not narrowed to `RejectNonMaTech`, per the story's own recommendation.
  - [x] `POST /api/v1/certifications/dry-run-configs` — create a config (`skill_id`, `label`,
    `inputs`, `sort_order`). Enforces max 5 configs per skill (422 `DRY_RUN_CONFIG_LIMIT_EXCEEDED`).
  - [x] `PATCH /api/v1/certifications/dry-run-configs/{id}` — edit label/inputs/sort_order. (Configs
    themselves are NOT Part 11 records — no immutability requirement here, unlike `CertificationRecord`.)
  - [x] `DELETE /api/v1/certifications/dry-run-configs/{id}`.
  - [x] `GET /api/v1/certifications/dry-run-configs?skill_id={id}` — list a skill's saved configs.
  - [x] `POST /api/v1/certifications/dry-run-evidence` — body `{invocation_job_id, skill_version_id,
    dry_run_config_id?}`; validates the job actually belongs to that skill+exact version (match
    `InvocationJob.skill_id == skill_id AND InvocationJob.skill_version == target_version.version` —
    string-match against `skill_versions.version`, same pattern as
    `job_service.find_recent_duplicate`, `job_service.py:396-399`) and is `status == "completed"`;
    inserts the evidence link row. Recommend treating a duplicate `invocation_job_id` as **idempotent
    success** (return the existing link row, no error) rather than a 422 — the caller's intent
    ("this job counts as evidence") is already satisfied, and a hard error here would only complicate
    the FE's "Run All" retry logic for no correctness benefit. Document this choice in the Dev Agent
    Record.
  - [x] `GET /api/v1/certifications/dry-run-evidence?skill_version_id={id}` — list the trail
    (joins to `InvocationJob`/`InvocationResult` for status/output_sha256/timestamps) — powers AC6's
    UI card. Response includes a computed `distinct_output_count` and `is_sufficient: bool` so the FE
    doesn't need to re-derive the ≥5-distinct-hashes rule itself.
  - [x] There is no "run all" backend endpoint needed — "Run All" (AC7) is a FE-orchestrated sequence
    of N `POST /api/v1/invocations/{skill_id}` calls (one per saved config) followed by N `POST
    .../dry-run-evidence` linking calls, reusing existing endpoints. Do not build a new bulk-execute
    backend endpoint — this would be a parallel runner, which AC1 explicitly forbids.
  - [x] **Context requirement — CORRECTED during implementation, no backend change needed.** The
    story's drafting assumed every invocation requires `project_id`/`study_id`, based on
    `RunConsole.tsx`'s own `buildRunPayload()` always attributing to its already-known launch
    context. Verified against the actual backend
    (`invocations.py#_resolve_single_job_hierarchy_path`, lines 232-252): for a non-location-dependent
    skill with no `study_id`/`project_id`/`client_id` supplied, an **unrestricted caller (ma_tech/admin
    — internal roles bypass hierarchy scope, `dependencies.py:336-337`) already falls through to
    `return "org", inputs_payload"`** (line 245-246) — a fully-supported context-free invocation today.
    `schemas/invocation.py`'s own docstring confirms this is intentional: *"Omit all three to run at
    the org root (unchanged default behavior for a context-free invocation, e.g. from the Skill
    Registry)."* No new `certification_dry_run` flag, no `InvocationRequest` change, no
    `queue_invocation` change. The dry-run trail UI's "Run" action calls
    `POST /api/v1/invocations/{skill_id}` directly (via a thin new hook, not `RunConsole.tsx`) with
    only `inputs` set — it lands at `hierarchy_path="org"` exactly like a Skill-Registry-launched run.

- [x] **Task 3 — Backend: the evidence gate itself (AC2, AC3)**
  - [x] New function `count_sufficient_dry_run_evidence(*, session, skill_version_id, org_id) -> int` in
    `certification_service.py` (co-located near `evaluate_certification_eligibility`) — a pure-read
    query joining `certification_dry_run_evidence` → `invocation_jobs` → `invocation_results`,
    filtering `status == "completed"`, returning `COUNT(DISTINCT invocation_results.output_sha256)`.
  - [x] New exception `CertificationEvidenceInsufficientError(VelaraHTTPException)`, `ERROR_CODE =
    "CERTIFICATION_EVIDENCE_INSUFFICIENT"` — placed alongside `CertificationIncompleteError`/
    `RecertificationRequiredError`, same two-line constructor shape.
  - [x] Inserted the gate call (`assert_dry_run_evidence_sufficient`) inside `record_certification`,
    guarded `if certification_type == "technical":`, positioned right after `ver` is resolved and
    before the `CertificationRecord(...)` construction — NOT inside `assert_certified_for_client_ready`.
  - [x] Added the new error message to the frontend's `CERTIFICATION_ERROR_MESSAGES` map
    (`velara-web/src/shared/utils/errors.ts`), consumed by `friendlyCertificationError()`.
  - [x] **Pre-existing test-suite fix (discovered during implementation, not originally in this
    task):** the new gate is a real behavior change — every existing test that POSTs a technical
    certification and expects 201 now needs a seeded dry-run trail first, or it correctly (and newly)
    receives 422 `CERTIFICATION_EVIDENCE_INSUFFICIENT`. Added a `_seed_sufficient_dry_run_evidence`
    helper (5 completed jobs w/ distinct `output_sha256`, directly inserted — bypassing real
    execution since `get_llm_provider()` is the real `AnthropicProvider` in this environment, no fake)
    to `test_certifications.py`, `test_skills.py`, and `test_audit_service.py`, and called it before
    every technical-cert POST that expects success (17 call sites across 3 files). One unit test
    (`TestAutoAdvanceDecision::test_only_one_key_does_not_call_transition_lifecycle`) needed the new
    gate function mocked satisfied, mirroring how `evaluate_certification_eligibility` was already
    mocked. Also discovered and fixed: migration `0029` was not idempotent (unlike `0028`'s
    `IF NOT EXISTS` precedent) — the repo's migration-test harness (`test_client_only_grants_migration.py`
    et al.) stamps the test DB back and re-runs `alembic upgrade head`, which replayed `0029`'s DDL
    against a DB where the objects already existed; rewrote using raw SQL + `IF NOT EXISTS`/existence
    checks, matching `0028`'s exact idempotency pattern. New audit-coverage-guard registry entries
    added for the 4 new mutating routes (all `exempt` — not Part 11 records, not the governance event
    itself; see `test_audit_coverage_guard.py`).

- [x] **Task 4 — Frontend: API client + hooks (AC1, AC6, AC7)**
  - [x] New types + API functions in `velara-web/src/api/certifications.ts`:
    `CertificationDryRunConfig`, `CertificationDryRunEvidenceItem`, CRUD functions for configs, list
    + create for evidence, matching the existing `certifications.ts` envelope-unwrapping convention.
  - [x] New hooks file `velara-web/src/features/certification/hooks/useCertificationDryRuns.ts`:
    `useDryRunConfigs`, `useCreateDryRunConfig`, `useUpdateDryRunConfig`, `useDeleteDryRunConfig`,
    `useDryRunEvidence` (query key `['certification-dry-runs', skillVersionId]`, also polls every 3s
    while any linked job is non-terminal), `useLinkDryRunEvidence`. Mutations invalidate
    `['certification-dry-runs', ...]` AND `['certifications', skillId]`.
  - [x] No `ListJobsParams`/`api/jobs.ts` change needed — `GET /dry-run-evidence` alone suffices for
    the trail card (backend join returns everything needed).

- [x] **Task 5 — Frontend: Dry-Run Trail card UI (AC6, AC7)**
  - [x] New component `CertificationDryRunTrail.tsx` in `features/certification/components/`,
    inserted into `CertificationDetail` between the two-key panel and the Part 11 block.
  - [x] Trail evidence list reuses `JobStatusBadge` for status; per-run detail reuses `JobDetailPanel`
    (opened inline on "View"). Saved-config rows are a new lightweight row (JobRow itself takes a
    `JobSummary`, a different shape than our evidence items — adapting it would have added more
    complexity than a small bespoke row).
  - [x] Config editor: reuses `parseInputFields`/`SchemaInputsForm` verbatim to render each config's
    input form, pre-filled from the saved `inputs` JSON.
  - [x] Per-config "Run" button: calls `useCreateInvocation` with the config's saved inputs (no
    context flag needed — see the corrected Task 2 context-requirement note), polls via `useJob` to
    completion, then calls `useLinkDryRunEvidence` on `completed`.
  - [x] "Run All" button: sequences the per-config flow across all saved configs sequentially,
    showing `Running X/Y…` progress — a thin orchestration loop in the component, no new backend
    endpoint.
  - [x] Gated the technical `KeyCard`'s `isLocked` prop (`CertificationScreen.tsx`) — replaced the
    hardcoded `false` with `!dryRunTrailSufficient`, sourced from `CertificationDryRunTrail`'s
    `onSufficiencyChange` callback lifted into `CertificationDetail` state. Methodological card's
    separate `isLocked` untouched.
  - [x] The new config-create/edit modal (`DryRunConfigModal`, inside `CertificationDryRunTrail.tsx`)
    replicates `RecordTechnicalCertModal.tsx`'s hand-rolled focus-trap pattern exactly (`dialogRef`/
    `getFocusable()`/`handleTrapKey`).

- [x] **Task 6 — Tests (all ACs)**
  - [x] Backend unit: `TestDomainExceptions`-style test for `CertificationEvidenceInsufficientError`'s
    code/status. New `TestDryRunEvidenceGate` class mirroring `TestEvaluateCertificationEligibility`'s
    compiled-SQL-assertion idiom for `count_sufficient_dry_run_evidence`'s query shape (asserts
    scoping by `skill_version_id` + `org_id` + `status == "completed"` + `DISTINCT`), plus
    below/at/above-minimum-count tests for `assert_dry_run_evidence_sufficient`. 7 new unit tests.
  - [x] Backend integration: extended `tests/integration/api/test_certifications.py` with a
    `_seed_sufficient_dry_run_evidence` helper (5 completed jobs, 5 distinct `output_sha256`, directly
    inserted) and wired it into every existing technical-cert-POST-expects-201 test (17 call sites) —
    this exercises AC3's gate end-to-end via the real API on every one of those tests, proving both
    the insufficient-evidence 422 path (implicitly, since removing the seed call reproduces it — see
    Debug Log) and the sufficient-evidence 201 path. AC5 (fresh trail per version) is explicitly
    exercised by `test_list_certifications_spans_multiple_versions`, which now seeds evidence twice
    (once per version) and would fail at the second `POST /certifications` if the trail incorrectly
    carried over.
  - [x] Frontend: new `CertificationDryRunTrail.test.tsx` (5 tests) — asserts the distinct-output
    count/sufficiency display, `onSufficiencyChange` callback firing correctly, saved-config rendering,
    the empty state, and that "Run" fires `useCreateInvocation` with the config's exact inputs.
    Extended `CertificationScreen.test.tsx` with 3 new tests asserting the "Turn technical key" button
    is disabled/enabled based on `useDryRunEvidence`'s `is_sufficient`, plus added a
    `mockSufficientDryRunTrail()`/`mockInsufficientDryRunTrail()` pair and wired the former into the
    detail-panel `beforeEach` so the 6 pre-17.3 tests (written before this gate existed) keep their
    original "not locked" expectations without modification.
  - [x] Gates: backend `pytest` 1587 passed/3 skipped, `ruff check .` clean; frontend `tsc --noEmit`
    clean, `eslint` 0 errors (3 pre-existing warnings, unrelated files), `vitest run` 804 passed
    (up from 782 pre-story: 43 in certification alone, +5 new in `CertificationDryRunTrail.test.tsx`,
    +3 new gate tests in `CertificationScreen.test.tsx`), 0 regressions. All re-run against a fresh
    `velara_test` database and rebuilt Docker images, not a stale container (Enforcement Rule 10).

## Dev Notes

### Why this needs new schema, not a variant of existing schema

Two independent research passes (backend + frontend) confirmed via grep that no "dry-run", "test
run", "preset", "template", or "job kind/source" concept exists anywhere in either subrepo today.
`InvocationJob` (`app/models/invocation.py:52-157`) has no field distinguishing a production run
from any other purpose — only `status`, `fan_out`/`parent_job_id`/`location_id` (an unrelated
fan-out feature). This story is the first thing to introduce that distinction, and it does so via a
**link table** (`certification_dry_run_evidence`), not by widening `InvocationJob` itself — keeping
execution history pure and putting "this counts as cert evidence" semantics in the certification
domain, mirroring how `CertificationRecord` (not `Skill`/`SkillVersion`) already owns the two-key
gate state.

### The exact idiom this story's gate must mirror

`certification_service.py:46-67` (existing):
```python
class CertificationIncompleteError(VelaraHTTPException):
    ERROR_CODE = "CERTIFICATION_INCOMPLETE"
    def __init__(self) -> None:
        super().__init__(422, self.ERROR_CODE, "Skill cannot advance to client_ready: ...")

class RecertificationRequiredError(VelaraHTTPException):
    ERROR_CODE = "RECERTIFICATION_REQUIRED"
    def __init__(self) -> None:
        super().__init__(422, self.ERROR_CODE, "A new version has been published. ...")
```
and the gate function shape, `assert_certified_for_client_ready` (`certification_service.py:436-475`):
a pure-read `evaluate_*` helper, called from the mutating function, raising one exception class or
returning cleanly. Story 17.3's `count_sufficient_dry_run_evidence` + `CertificationEvidenceInsufficientError`
follow this exactly — see Task 3.

**Critical placement detail:** the new gate belongs inside `record_certification`
(`certification_service.py:116-273`), which is the handler for `POST /api/v1/certifications` (AC3's
literal wording). It does NOT belong inside `assert_certified_for_client_ready`, which is a
different call site fired from `skill_service.transition_lifecycle` on the lifecycle PATCH — a
different HTTP call entirely. Confusing these two would gate the wrong endpoint.

### Version-matching asymmetry (must be handled correctly, not assumed away)

`CertificationRecord` stores **both** `skill_version_id` (real FK) and `skill_version` (string
snapshot) — `certification.py:43-50`. `InvocationJob` stores **only** the semver **string**
`skill_version` (`invocation.py:71-73`), no FK. This means matching "dry-run jobs for this exact
skill version" cannot join directly on a shared FK unless the new
`certification_dry_run_evidence.skill_version_id` column (Task 1) is populated correctly at
link-time by resolving the target `SkillVersion.id` — do not attempt to join `InvocationJob` to
`SkillVersion` by string alone without also constraining `skill_id` (the same string could
theoretically collide across skills if not scoped; in practice `(skill_id, version)` is unique per
`skill_versions.uq_skill_versions_skill_version`, `skill.py:233`, so scope by both).

### "Differing outputs" — the decision this story makes (AC2)

No output-content hash exists anywhere today — `InvocationResult` (`invocation.py:160-219`) has only
`output_file_key` (S3 key, always unique per job by construction, so NOT useful for detecting
duplicate content) and `result_metadata` (JSONB, no hash field). The existing *input*-hashing
precedent (`job_service.hash_inputs_payload`, `job_service.py:57-76`, used by
`find_recent_duplicate`) hashes inputs, not outputs — do not confuse the two. This story adds a new
`output_sha256` column to `InvocationResult`, computed in `execution_service._persist_output`
(`execution_service.py:191-237`) the same way `FileReference.content_sha256` is computed elsewhere
(locate `0021_file_ref_content_hash.py` and its call site before implementing, to match hashing
approach/library exactly — e.g. `hashlib.sha256`).

### RBAC tier decision (must be made explicit, not defaulted silently)

The epic's user story says "As an MA Tech member" but the existing `POST /api/v1/certifications`
router-level gate is `RejectNonGrantor` (admin **and** ma_tech,
`app/core/dependencies.py` `_GRANTOR_ROLES`), not the narrower `RejectNonMaTech` (ma_tech only, used
elsewhere for e.g. skill bundle export/import — `dependencies.py`). Recommendation: keep the new
dry-run config/evidence endpoints at `RejectNonGrantor` for consistency with the certification
surface they extend, rather than introducing an inconsistent narrower tier on only part of the flow.
Document whichever choice is made in the Dev Agent Record.

### Context requirement — resolved as a non-issue during implementation

The drafted story assumed every invocation requires `project_id`/`study_id`, generalizing from
`RunConsole.tsx`'s `buildRunPayload()` (a **frontend UI-mode** constraint — it always attributes to
the context it was launched with, `RunConsole.tsx:626,958`). The actual backend does NOT require
this: `invocations.py#_resolve_single_job_hierarchy_path` (lines 232-252) already returns
`("org", inputs_payload)` for an unrestricted caller (ma_tech/admin — internal roles bypass
hierarchy scope entirely, `dependencies.py:336-337` `_hierarchy_scope`) supplying none of
`study_id`/`project_id`/`client_id`. `schemas/invocation.py`'s own docstring (lines 46-47) confirms
this is the documented, intentional behavior for "a context-free invocation, e.g. from the Skill
Registry." No new flag, no schema change, no `queue_invocation` change — the dry-run trail's "Run"
action is simply a normal `POST /api/v1/invocations/{skill_id}` call with `inputs` only.

### Reuse map (do NOT rebuild)

- **`parseInputFields` / `SchemaInputsForm`** (`features/run/inputsSchema.ts`,
  `features/run/components/SchemaInputsForm.tsx`) — the exact schema-driven input-rendering pair for
  the dry-run config editor. Note: primitives-only (string/number/integer/boolean/enum); nested
  object/array inputs are out of scope for this renderer today (pre-existing limitation, not
  something to fix here).
- **`useCreateInvocation` + `useJob`** (`features/run/hooks/`) — the submit + poll-to-terminal
  pattern; a dry-run "Run" is just a normal invocation with a flag, tracked the same way.
- **`JobRow` / `JobDetailPanel`** (`features/run/components/JobsHistory.tsx`) — reuse verbatim for
  the trail list, per the `RecentRunsPanel.tsx:20-25` "reuse, don't reinvent" precedent.
- **`JobStatusBadge`** — reuse for each dry-run's live status during "Run All."
- **`CertificationIncompleteError`/`RecertificationRequiredError`** shape — the exact exception
  pattern to mirror for `CertificationEvidenceInsufficientError`.
- **`FileReference.content_sha256`** precedent — the hashing approach to mirror for the new
  `output_sha256` column (find and read `0021_file_ref_content_hash.py` first).

### Migration chain

Current head: `0028_study_protocol_association` (confirmed empirically — no other migration's
`down_revision` points to it). New migration: `0029_certification_dry_runs.py`, `down_revision =
"0028_study_protocol_association"`.

### Testing standards

- Backend: pytest, co-located `tests/unit/` (pure logic, mocked session) + `tests/integration/api/`
  (live Postgres + MinIO, skipped if unreachable). Follow `test_certification_service.py`'s
  compiled-SQL-assertion idiom for new query-shape tests (don't mock `select()` itself — build it for
  real and inspect the compiled WHERE clause).
- Frontend: Vitest + RTL, co-located `*.test.tsx`. No MSW anywhere in this repo — mock the hooks
  module wholesale via `vi.mock`, per `CertificationScreen.test.tsx`'s established pattern.
- Enforcement Rule 10 (`implementation-patterns-consistency-rules.md:150-158`): CI must be green
  before any push to `development` — re-run `ruff check .` / `tsc --noEmit && eslint` / the full test
  suite in the same environment CI uses, not just a possibly-stale local Docker container. A
  "pre-existing failure" note in the Dev Agent Record is not a license to push; get explicit
  sign-off recorded in `deferred-work.md` if deferring anything.
- Enforcement Rules 1/3/5 also apply: new error responses use the standard envelope, new
  columns/fields stay snake_case, no raw exception messages leak to callers (use the
  `VelaraHTTPException` subclass idiom throughout).

### Git / build context

- `velara-api`: head migration `0028_study_protocol_association`. Do NOT commit `velara-api` from
  this story (never-push-subrepos rule) — only `code-review` commits subrepos, post-review.
- `velara-web`: `development`, Story 16.8 landed. Same never-push-subrepos rule applies.
- Only the top-level docs repo is committed by `dev-story`.

### Project Structure Notes

- Backend: new models co-located in `app/models/certification.py`; new migration in
  `app/db/migrations/versions/`; new/extended router in `app/api/v1/`; gate logic added to the
  existing `app/services/certification_service.py`.
- Frontend: new component `features/certification/components/CertificationDryRunTrail.tsx`; new
  hooks file `features/certification/hooks/useCertificationDryRuns.ts` (separate file, matching
  `features/run/hooks/`'s one-file-per-concern granularity, not piled onto the existing 43-line
  `useCertifications.ts`); new types/API functions alongside `api/certifications.ts`.
- No new dependencies, no new libraries (schema-form rendering, hashing, and job polling all reuse
  existing in-repo utilities).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-17-observability-and-certification-evidence.md#Story-17.3] —
  parent epic-level AC contract (lines 63-87) this story expands; AC1-AC6 here map directly to the
  epic's AC1-AC6, with AC7 added for the PO's create/custom-input/Run-All requirement.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-24.md] — correct-course
  proposal that created Epic 17 / Story 17.3 (request 5).
- [Source: _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md#5.9] —
  CRT-06 (this story's FR), CRT-01/02/04/05 (neighboring certification FRs), exact wording.
- [Source: _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md#5.12] —
  SEC-10 (cited as FR-SEC-10 in epic/story convention) — 21 CFR Part 11 signature requirement, unchanged by this story.
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#L137-163] —
  Enforcement Rules 1-10, verbatim; Rule 10 (CI-green-before-push) is the newest and most operationally
  binding for this story's Dev Agent Record.
- [Source: velara-api/app/models/certification.py#CertificationRecord] — the model + dual
  `skill_version_id`/`skill_version` binding idiom this story's new tables mirror.
- [Source: velara-api/app/db/migrations/versions/0015_certification_records.py] — migration
  conventions (UUID PKs, FK ondelete, append-only trigger) to follow/selectively omit.
- [Source: velara-api/app/services/certification_service.py#record_certification,L116-273] — exact
  insertion point for the new gate call.
- [Source: velara-api/app/services/certification_service.py#L46-90,436-475] — the
  `CertificationIncompleteError`/`RecertificationRequiredError`/`assert_certified_for_client_ready`
  idiom to mirror exactly.
- [Source: velara-api/app/models/invocation.py#InvocationJob,InvocationResult] — confirms no
  existing "kind"/"source" field, and the string-only `skill_version` representation.
- [Source: velara-api/app/services/job_service.py#hash_inputs_payload,L57-76,396-399] — existing
  input-hashing precedent; do not confuse with the new output-hashing this story adds.
- [Source: velara-api/app/services/execution_service.py#_persist_output,L191-237] — where the new
  `output_sha256` computation is inserted.
- [Source: velara-api/app/api/v1/invocations.py#queue_invocation,L317-523] — the shared invocation
  path this story reuses; the context-requirement flag (Task 2) is a small addition here.
- [Source: velara-api/app/core/dependencies.py#_GRANTOR_ROLES,_MA_TECH_ROLES,reject_non_ma_tech] —
  the RBAC tier decision this story must make explicit.
- [Source: velara-web/src/features/certification/components/CertificationScreen.tsx#CertificationDetail,L276-486] —
  exact insertion point for the new Dry-Run Trail card.
- [Source: velara-web/src/features/certification/components/RecordTechnicalCertModal.tsx] — the
  modal a11y/focus-trap pattern to replicate for any new modal; the checklist here is unrelated to
  this story's gate (do not conflate).
- [Source: velara-web/src/features/run/inputsSchema.ts#parseInputFields] — schema-form parsing to
  reuse for dry-run config input editing.
- [Source: velara-web/src/features/run/components/SchemaInputsForm.tsx] — the React form renderer to reuse.
- [Source: velara-web/src/features/run/hooks/useCreateInvocation.ts, useJob.ts] — submit + poll
  hooks to reuse for individual and "Run All" dry-run execution.
- [Source: velara-web/src/features/run/components/JobsHistory.tsx#JobRow,JobDetailPanel,L31-233] —
  reusable run-list/detail components for the trail UI.
- [Source: velara-web/src/features/engagements/components/RecentRunsPanel.tsx#L20-25] — the
  "embed a small card reusing JobRow/JobDetailPanel" precedent this story's trail card follows.
- [Source: velara-web/src/features/certification/hooks/useCertifications.ts] — existing hooks-file
  conventions (query key shape, invalidation idiom) the new hooks file follows.
- [Source: velara-web/src/shared/utils/errors.ts#CERTIFICATION_ERROR_MESSAGES,L102-120] — where the
  new error code's user-facing message is added.
- [Source: velara-api/tests/unit/services/test_certification_service.py] — unit test conventions
  (compiled-SQL assertions, exception-code assertions) to mirror.
- [Source: velara-api/tests/integration/api/test_certifications.py] — integration test conventions
  (fixtures, `_post_cert`-style helpers, 422-code assertions) to mirror.
- [Source: velara-web/src/features/certification/components/CertificationScreen.test.tsx] — frontend
  test-harness conventions (`vi.mock`, `QueryClientProvider` + `MemoryRouter`) to mirror.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `docker compose exec api alembic upgrade head` — migration 0029 applied cleanly against the live
  dev DB; `alembic downgrade -1` + re-`upgrade head` verified reversibility.
- `docker compose exec api alembic stamp 0026_client_skill_attachment && alembic upgrade head` —
  reproduced this repo's migration-test harness pattern (stamp back, replay `upgrade head`) and
  caught migration 0029's non-idempotency (`DuplicateTableError` on replay) BEFORE it was found by
  the actual test suite — rewrote using raw SQL + `IF NOT EXISTS`, matching migration 0028's precedent.
- `docker compose exec -e AUTH_BACKEND=dev api pytest -q` (repeated ~15 times while iterating) —
  final clean run (fresh `velara_test` DB): 1587 passed, 3 skipped, 0 failed.
- `docker compose exec api ruff check .` — clean.
- `npx tsc --noEmit` (velara-web) — clean.
- `npx eslint src/` (velara-web) — 0 errors, 3 pre-existing warnings in untouched files.
- `npx vitest run` (velara-web) — 804 passed, 0 failed. +8 new tests from this story (5 in
  `CertificationDryRunTrail.test.tsx`, 3 in `CertificationScreen.test.tsx`); no other file's test
  count changed, so 0 regressions.
- Discovered and fixed a real local-environment issue unrelated to code correctness: this Docker
  stack's `.env` has `AUTH_BACKEND=cognito` (for manual testing against real Cognito) — running
  `pytest` inside the container without overriding `AUTH_BACKEND=dev` makes every dev-issued test
  token fail validation (`get_auth_provider()` returns `CognitoAuthProvider`, which can't validate
  HS256 dev tokens). Not a code bug; documented here so a future session doesn't re-diagnose it.
- Also hit and resolved a Docker disk-space exhaustion mid-session (`docker builder prune -a -f` +
  `docker image prune -a -f` freed ~97GB) — consistent with the memory note about local rebuilds
  filling the VM disk; required rebuilding all images from scratch afterward (DB volume was untouched).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created. This story
  required exhaustive net-new investigation (no prior story or existing mechanism to extend):
  confirmed via independent backend and frontend research passes that no dry-run/preset/job-kind
  concept exists anywhere in the codebase today, so every schema/UI element above is new, not a
  variant of existing work. RBAC tier and "differing outputs" enforcement mechanism are explicit
  documented decisions (per the epic's own instruction not to silently pick one) rather than
  ambiguous open questions left to the dev agent.
- **Implementation correction (Task 2's "context requirement" concern) — the drafted story's
  planned `certification_dry_run` flag on `InvocationRequest` was NOT built.** Verified against
  actual source that `invocations.py#_resolve_single_job_hierarchy_path` already returns
  `("org", inputs_payload)` for an unrestricted (ma_tech/admin) caller supplying no
  `project_id`/`study_id`/`client_id` — a fully-supported context-free invocation today, per
  `schemas/invocation.py`'s own docstring. The frontend's dry-run "Run" action is a plain
  `POST /api/v1/invocations/{skill_id}` call with only `inputs` set. This removed one planned
  backend schema/endpoint change; documented in Task 2 and Dev Notes so the discrepancy from the
  original story text is traceable.
- **All 4 new mutating routes are `exempt` in the audit-coverage guard** (`test_audit_coverage_guard.py`),
  not `audited` — dry-run configs/evidence are evidence-gathering scaffolding feeding the AC3 gate,
  not a governance action themselves; the governance event (POST /certifications) was already audited
  before this story and remains so.
- **Duplicate `invocation_job_id` on `POST /dry-run-evidence` is idempotent success** (returns the
  existing link row), not a 422 — per the story's own recommendation, to keep "Run All" retry logic simple.
- **RBAC stayed at `RejectNonGrantor`** (admin+ma_tech) for the new dry-run endpoints, consistent
  with the parent certification router — not narrowed to `RejectNonMaTech`.
- **Pre-existing test-suite impact (expected, not a regression):** the new gate is a real behavior
  change to `POST /api/v1/certifications` (`certification_type=technical`). Every existing test in
  `test_certifications.py`, `test_skills.py`, and `test_audit_service.py` that POSTs a technical cert
  and expects 201 needed a seeded dry-run trail first (17 call sites across 3 backend files) — added
  via a small `_seed_sufficient_dry_run_evidence` helper duplicated per-file (matching this codebase's
  no-shared-test-utils convention). One backend unit test needed the new gate mocked satisfied.
  Frontend: `CertificationScreen.test.tsx`'s pre-17.3 tests needed the new hooks module mocked with a
  default-sufficient trail to preserve their original "not locked" assertions.
- **Independently discovered and fixed a migration-idempotency bug** before any reviewer needed to
  flag it: migration 0029's `op.create_table` calls were not idempotent, unlike migration 0028's
  established `CREATE TABLE IF NOT EXISTS` precedent — this repo's own migration-test harness
  (`test_client_only_grants_migration.py` et al.) stamps the test DB back and replays `upgrade head`,
  which would have failed on every future test run touching that harness. Rewrote using raw SQL +
  existence checks, verified via manual `stamp` + `upgrade head` replay before the full suite confirmed it.

### File List

**Backend (`velara-api/`):**
- `app/db/migrations/versions/0029_certification_dry_runs.py` — NEW. Idempotent (raw SQL,
  `IF NOT EXISTS`/existence checks, matching migration 0028's precedent).
- `app/models/certification.py` — MODIFIED. Added `CertificationDryRunConfig`,
  `CertificationDryRunEvidence` models.
- `app/models/invocation.py` — MODIFIED. Added `InvocationResult.output_sha256` column.
- `app/services/execution_service.py` — MODIFIED. `_persist_output` computes `output_sha256` and
  folds it into `result_metadata`.
- `app/services/job_service.py` — MODIFIED. `mark_completed`/`mark_blocked` accept/persist a new
  `output_sha256` kwarg (additive, same contract as the Story 15.1 cost columns).
- `app/workers/execution_tasks.py` — MODIFIED. New `_extract_output_sha256` helper (mirrors
  `_extract_cost_fields`); both `mark_completed`/`mark_blocked` call sites pass it through.
- `app/services/certification_service.py` — MODIFIED. New constants
  (`MIN_DRY_RUN_EVIDENCE_COUNT`, `MAX_DRY_RUN_CONFIGS_PER_SKILL`), new exceptions
  (`CertificationEvidenceInsufficientError`, `DryRunConfigLimitExceededError`,
  `DryRunConfigNotFoundError`, `DryRunEvidenceJobNotEligibleError`), new functions
  (`count_sufficient_dry_run_evidence`, `assert_dry_run_evidence_sufficient`,
  `create_dry_run_config`, `update_dry_run_config`, `delete_dry_run_config`,
  `list_dry_run_configs`, `link_dry_run_evidence`, `list_dry_run_evidence`), gate call wired
  into `record_certification`.
- `app/schemas/certification.py` — MODIFIED. New Pydantic schemas for dry-run configs/evidence
  request/response shapes.
- `app/api/v1/certifications.py` — MODIFIED. 6 new routes (`POST`/`GET`/`PATCH`/`DELETE` on
  `/dry-run-configs`, `POST`/`GET` on `/dry-run-evidence`).
- `tests/unit/services/test_certification_service.py` — MODIFIED. New
  `test_certification_evidence_insufficient_error_code` test, new `TestDryRunEvidenceGate` class
  (7 tests), one existing test (`test_only_one_key_does_not_call_transition_lifecycle`) updated to
  mock the new gate satisfied.
- `tests/unit/test_audit_coverage_guard.py` — MODIFIED. 4 new `exempt` registry entries for the new
  mutating routes.
- `tests/integration/api/test_certifications.py` — MODIFIED. New
  `_seed_sufficient_dry_run_evidence` helper; wired into 17 existing test call sites.
- `tests/integration/api/test_skills.py` — MODIFIED. New `_seed_sufficient_dry_run_evidence` helper
  (local copy); wired into 4 existing test call sites.
- `tests/integration/services/test_audit_service.py` — MODIFIED. New
  `_seed_sufficient_dry_run_evidence` helper (local copy); wired into 1 existing test call site.

**Frontend (`velara-web/`):**
- `src/api/certifications.ts` — MODIFIED. New types (`CertificationDryRunConfig`,
  `CertificationDryRunEvidenceItem`, etc.) and API functions for dry-run config/evidence CRUD.
- `src/features/certification/hooks/useCertificationDryRuns.ts` — NEW. `useDryRunConfigs`,
  `useCreateDryRunConfig`, `useUpdateDryRunConfig`, `useDeleteDryRunConfig`, `useDryRunEvidence`,
  `useLinkDryRunEvidence`.
- `src/features/certification/components/CertificationDryRunTrail.tsx` — NEW. The Dry-Run Trail
  card + config list + create/edit modal + Run/Run All orchestration.
- `src/features/certification/components/CertificationScreen.tsx` — MODIFIED. Wired
  `CertificationDryRunTrail` into `CertificationDetail`; technical `KeyCard`'s `isLocked` now driven
  by `dryRunTrailSufficient` state instead of hardcoded `false`.
- `src/shared/utils/errors.ts` — MODIFIED. New `CERTIFICATION_EVIDENCE_INSUFFICIENT` message entry.
- `src/features/certification/components/CertificationDryRunTrail.test.tsx` — NEW. 5 tests.
- `src/features/certification/components/CertificationScreen.test.tsx` — MODIFIED. New
  `useCertificationDryRuns` mock + `mockSufficientDryRunTrail`/`mockInsufficientDryRunTrail`
  helpers wired into the detail-panel `beforeEach`; 3 new gate-specific tests.

**Docs:**
- `_bmad-output/implementation-artifacts/stories/17-3-certification-dry-run-evidence-gate.md` —
  this file (task checkboxes, Dev Agent Record, Change Log, Status).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions.

## Change Log

- 2026-07-27 — Implemented (dev-story). Full-stack: new `certification_dry_run_configs`/
  `certification_dry_run_evidence` tables + `invocation_results.output_sha256` column (migration
  0029); the AC3 gate (`CERTIFICATION_EVIDENCE_INSUFFICIENT`, ≥5 distinct-output completed dry-runs)
  wired into `record_certification` for `certification_type=technical` only; 6 new REST endpoints
  for dry-run config CRUD + evidence linking; new `CertificationDryRunTrail` card on the
  Certification detail screen with config create/edit, per-config Run, and "Run All" — gates the
  "Turn technical key" button. Corrected one planned implementation detail during development: no
  new `certification_dry_run` context flag was needed on `InvocationRequest` — the backend already
  supports context-free invocations for internal roles. Fixed 17 pre-existing tests across 3 backend
  files that needed a seeded dry-run trail to keep passing under the new gate (expected, not a
  regression — the gate is a real behavior change). Independently caught and fixed a migration-0029
  idempotency bug before the test suite surfaced it. Gates: backend `pytest` 1587/1587 passed (3
  skipped, pre-existing sandbox-linux-only skips), `ruff check .` clean; frontend `tsc --noEmit`
  clean, `eslint` 0 errors, `vitest run` 804/804 passed (+8 new tests), 0 regressions.
