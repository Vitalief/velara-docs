---
baseline_commit: velara-api head `0028_study_protocol_association` (Alembic); velara-web on
  `development`, Story 16.8 landed (per sprint-status.yaml). This is the FIRST story picked from
  Epic 17 (backlog→in-progress by this drafting). Independent of 17.1/17.2 (LangSmith tracing) —
  no dependency, no shared files. Confirmed via broad grep across both subrepos: NO existing
  "dry-run"/"trigger_source"/"job_kind"/"preset"/"template" concept anywhere in the codebase — this
  story introduces genuinely new schema on both sides, not an extension of an existing mechanism.
---

# Story 17.3: Certification Dry-Run Evidence Gate (5 Runs Before the Technical Key)

Status: ready-for-dev

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

- [ ] **Task 1 — Backend: dry-run config + evidence schema (AC1, AC2, AC5, AC7)**
  - [ ] New Alembic migration `0029_certification_dry_runs.py`, `down_revision =
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
  - [ ] New SQLAlchemy models in `app/models/certification.py` (co-located with `CertificationRecord`,
    same file): `CertificationDryRunConfig`, `CertificationDryRunEvidence`. No `relationship()`
    attributes needed — follow `CertificationRecord`'s flat-FK, explicit-`select()`-join convention.
  - [ ] Add `output_sha256: Mapped[str | None]` (String(64), nullable) to `InvocationResult`
    (`app/models/invocation.py:160-219`) in the SAME migration — computed in
    `execution_service._persist_output` (`execution_service.py:191-237`) alongside the existing
    `output_file_key` write, mirroring how `FileReference.content_sha256` is computed
    (`0021_file_ref_content_hash.py` precedent — locate and read this migration + its call site
    before implementing, to match the hashing approach exactly, e.g. `hashlib.sha256(output_bytes).hexdigest()`).

- [ ] **Task 2 — Backend: dry-run config CRUD + run-linking endpoints (AC1, AC7)**
  - [ ] New router `app/api/v1/certification_dry_runs.py` (or extend `certifications.py` — pick one
    and be consistent), gated `dependencies=[RejectNonGrantor]` to match the existing certification
    router tier (`certifications.py:32-38`) unless the story's RBAC decision (below) says narrower.
    **RBAC decision to make explicit in Dev Agent Record:** the epic frames this as an "ma_tech
    member" action, but the existing `POST /api/v1/certifications` gate is `RejectNonGrantor`
    (admin+ma_tech). Recommend staying consistent with the existing certification endpoints'
    `RejectNonGrantor` tier (not narrowing to `RejectNonMaTech`) — narrowing only this one sub-surface
    while its parent stays broader would be an inconsistent, undocumented RBAC seam. Document
    whichever is chosen; do not silently default.
  - [ ] `POST /api/v1/certifications/dry-run-configs` — create a config (`skill_id`, `label`,
    `inputs`, `sort_order`). Enforce max 5 configs per skill (422 if exceeded — reuse
    `VelaraHTTPException` idiom, new code e.g. `DRY_RUN_CONFIG_LIMIT_EXCEEDED`).
  - [ ] `PATCH /api/v1/certifications/dry-run-configs/{id}` — edit label/inputs/sort_order. (Configs
    themselves are NOT Part 11 records — no immutability requirement here, unlike `CertificationRecord`.)
  - [ ] `DELETE /api/v1/certifications/dry-run-configs/{id}`.
  - [ ] `GET /api/v1/certifications/dry-run-configs?skill_id={id}` — list a skill's saved configs.
  - [ ] `POST /api/v1/certifications/dry-run-evidence` — body `{invocation_job_id, skill_version_id,
    dry_run_config_id?}`; validates the job actually belongs to that skill+exact version (match
    `InvocationJob.skill_id == skill_id AND InvocationJob.skill_version == target_version.version` —
    string-match against `skill_versions.version`, same pattern as
    `job_service.find_recent_duplicate`, `job_service.py:396-399`) and is `status == "completed"`;
    inserts the evidence link row. Recommend treating a duplicate `invocation_job_id` as **idempotent
    success** (return the existing link row, no error) rather than a 422 — the caller's intent
    ("this job counts as evidence") is already satisfied, and a hard error here would only complicate
    the FE's "Run All" retry logic for no correctness benefit. Document this choice in the Dev Agent
    Record.
  - [ ] `GET /api/v1/certifications/dry-run-evidence?skill_version_id={id}` — list the trail
    (joins to `InvocationJob`/`InvocationResult` for status/output_sha256/timestamps) — powers AC6's
    UI card. Response includes a computed `distinct_output_count` and `is_sufficient: bool` so the FE
    doesn't need to re-derive the ≥5-distinct-hashes rule itself.
  - [ ] There is no "run all" backend endpoint needed — "Run All" (AC7) is a FE-orchestrated sequence
    of N `POST /api/v1/invocations/{skill_id}` calls (one per saved config) followed by N `POST
    .../dry-run-evidence` linking calls, reusing existing endpoints. Do not build a new bulk-execute
    backend endpoint — this would be a parallel runner, which AC1 explicitly forbids.
  - [ ] **Context requirement decision (flagged by frontend research, must be resolved here):** every
    existing invocation requires `project_id` or `study_id` (`invocations.py` `queue_invocation`); a
    certification dry-run is conceptually context-free. Decide and document: either (a) add a new
    optional `certification_dry_run: bool` flag to `InvocationRequest`
    (`schemas/invocation.py`) that lets `queue_invocation` skip the project/study requirement for
    ma_tech/admin callers, or (b) require the ma_tech user to pick any project/study they have access
    to, same as a normal run. Recommend (a) — a dry-run's purpose is orthogonal to engagement context,
    and forcing a fake project/study pick would confuse the evidence trail with real client work.
    This flag, if added, is a small `queue_invocation` change (`invocations.py:303-523` — function
    signature at line 303, docstring runs ~304-316, body follows), NOT a change to
    `execution_service.py`'s execution logic itself.

- [ ] **Task 3 — Backend: the evidence gate itself (AC2, AC3)**
  - [ ] New function `count_sufficient_dry_run_evidence(*, session, skill_version_id) -> int` in
    `certification_service.py` (co-located near `evaluate_certification_eligibility`,
    `certification_service.py:410-433`) — a pure-read query joining
    `certification_dry_run_evidence` → `invocation_jobs` → `invocation_results`, filtering
    `status == "completed"`, returning `COUNT(DISTINCT invocation_results.output_sha256)`.
  - [ ] New exception `CertificationEvidenceInsufficientError(VelaraHTTPException)`, `ERROR_CODE =
    "CERTIFICATION_EVIDENCE_INSUFFICIENT"`, message e.g. "At least 5 dry-runs with differing outputs
    are required before technical certification can be recorded." — placed alongside
    `CertificationIncompleteError`/`RecertificationRequiredError` (`certification_service.py:46-67`),
    same two-line constructor shape.
  - [ ] Insert the gate call inside `record_certification` (`certification_service.py:116-273`),
    guarded `if certification_type == "technical":`, positioned right after `ver` is resolved (after
    line 164, before the `CertificationRecord(...)` construction at line 167) — NOT inside
    `assert_certified_for_client_ready` (a different call site for the lifecycle PATCH, not this POST).
  - [ ] Add the new error message to the frontend's `CERTIFICATION_ERROR_MESSAGES` map
    (`velara-web/src/shared/utils/errors.ts:102-110`), consumed by `friendlyCertificationError()`
    (already called in `RecordTechnicalCertModal.tsx:95`) — no other FE error-plumbing change needed.

- [ ] **Task 4 — Frontend: API client + hooks (AC1, AC6, AC7)**
  - [ ] New types + API functions in `velara-web/src/api/certifications.ts` (or a sibling file):
    `CertificationDryRunConfig`, `CertificationDryRunEvidenceItem`, CRUD functions for configs, list
    + create for evidence, matching the existing `certifications.ts` envelope-unwrapping convention.
  - [ ] New hooks file `velara-web/src/features/certification/hooks/useCertificationDryRuns.ts`
    (separate file, per the `run/hooks/` granularity precedent — `useCreateInvocation.ts`,
    `useJob.ts` are each their own file, not piled onto one shared hooks file): `useDryRunConfigs`,
    `useCreateDryRunConfig`, `useUpdateDryRunConfig`, `useDeleteDryRunConfig`, `useDryRunEvidence`
    (query key `['certification-dry-runs', skillVersionId]`), `useLinkDryRunEvidence`. Mutations
    invalidate `['certification-dry-runs', ...]` AND `['certifications', skillId]` (since the "Turn
    technical key" button's enablement now depends on both), mirroring `useRecordCertification`'s
    multi-key invalidation (`useCertifications.ts:32-40`).
  - [ ] Add `skill_id` filter support to `ListJobsParams`/`api/jobs.ts:133-140` if the trail listing
    needs to query jobs by skill directly (verify whether `GET /dry-run-evidence` alone suffices
    before adding this — likely the backend join makes this unnecessary for the trail card itself).

- [ ] **Task 5 — Frontend: Dry-Run Trail card UI (AC6, AC7)**
  - [ ] New component `CertificationDryRunTrail.tsx` in `features/certification/components/`,
    inserted into `CertificationDetail` (`CertificationScreen.tsx:276-486`) between the two-key panel
    (387-419) and the Part 11 block (422-451).
  - [ ] Trail list: reuse `JobRow`/`JobDetailPanel` (`features/run/components/JobsHistory.tsx:31-193,
    197-233`) per the `RecentRunsPanel` reuse precedent (`RecentRunsPanel.tsx:20-25`) — do not build
    new run-row markup.
  - [ ] Config editor: reuse `parseInputFields`/`SchemaInputsForm`
    (`features/run/inputsSchema.ts`, `features/run/components/SchemaInputsForm.tsx`) to render each
    config's input form, pre-filled from the saved `inputs` JSON instead of blank.
  - [ ] Per-config "Run" button: calls `useCreateInvocation` (existing hook, `useCreateInvocation.ts`)
    with the config's saved inputs + the `certification_dry_run` flag (Task 2), polls via `useJob`
    (existing hook) to completion, then calls `useLinkDryRunEvidence`.
  - [ ] "Run All" button: sequences the above per-config flow across all saved configs, showing
    per-config progress (reuse `JobStatusBadge` for each row's live status) — a thin orchestration
    loop in the component, not a new backend endpoint (Task 2).
  - [ ] Gate the "Turn technical key" button (`KeyCard`, `CertificationScreen.tsx:246-259`): pass a
    new prop (e.g. `dryRunTrailSufficient: boolean`, computed from `useDryRunEvidence`'s
    `is_sufficient` field) into the technical `KeyCard` instance's `isLocked` prop (currently
    hardcoded `false` at `CertificationScreen.tsx:404` — replace it with `!dryRunTrailSufficient`;
    do NOT touch the methodological card's separate, already-real `isLocked` at line 415).
  - [ ] Modal a11y: any new modal (e.g. "Create dry-run config") must replicate
    `RecordTechnicalCertModal.tsx`'s hand-rolled focus-trap pattern (33-78) — there is no shared Modal
    primitive to import; copy the same `dialogRef`/`getFocusable()`/`handleTrapKey` shape.

- [ ] **Task 6 — Tests (all ACs)**
  - [ ] Backend unit: `TestDomainExceptions`-style test for `CertificationEvidenceInsufficientError`'s
    code/status (`tests/unit/services/test_certification_service.py:51-72` pattern). New test class
    mirroring `TestEvaluateCertificationEligibility`'s compiled-SQL-assertion idiom
    (`test_certification_service.py:78-157`) for `count_sufficient_dry_run_evidence`'s query shape
    (asserts scoping by `skill_version_id` + `status == "completed"` + `DISTINCT output_sha256`).
  - [ ] Backend integration (`tests/integration/api/test_certifications.py` conventions — new helpers
    analogous to `_post_cert`): register <5 dry-runs → `POST /certifications` (`technical`) → 422
    `CERTIFICATION_EVIDENCE_INSUFFICIENT`; register 5 with distinct `output_sha256` → 201 succeeds;
    register 5 with duplicate hashes → still 422 (proves AC2's distinct-hash enforcement, not just a
    count check); new version → trail is empty, gate re-fires (AC5).
  - [ ] Frontend: `vi.mock` the new hooks module in a `CertificationDryRunTrail.test.tsx`, following
    `CertificationScreen.test.tsx`'s render-harness pattern (`QueryClientProvider` + `MemoryRouter`).
    Assert: "Turn technical key" button disabled when `is_sufficient=false`, enabled when true
    (`getByRole('button', {name: /turn technical key/i})`, mirroring the existing assertion idiom).
    Assert config create/edit/run/"Run All" trigger the right mutations with the right payloads.
  - [ ] Gates: backend `pytest` + `ruff check .` green; frontend `tsc --noEmit` + `eslint` + `vitest
    run` green, 0 regressions — re-run in the same environment CI uses before any push (Enforcement
    Rule 10 — `docs/architecture` `implementation-patterns-consistency-rules.md:150-158`), not just a
    possibly-stale local Docker container.

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

### Context-requirement gap for dry-run invocations

Every existing invocation requires `project_id` or `study_id` (`RunConsole.tsx:626,958` on the FE;
`invocations.py` `queue_invocation`, function at line 303, on the BE) — a certification dry-run is
conceptually context-free (it's about certifying a skill version, not an engagement run). Task 2
recommends a new optional `certification_dry_run: bool` flag on `InvocationRequest` that lets
`queue_invocation` skip the context requirement for grantor-role callers. This is a small, additive
change to `invocations.py`'s `queue_invocation` (lines 303-523) — it does not touch
`execution_service.py`'s actual execution routing/logic.

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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created. This story
  required exhaustive net-new investigation (no prior story or existing mechanism to extend):
  confirmed via independent backend and frontend research passes that no dry-run/preset/job-kind
  concept exists anywhere in the codebase today, so every schema/UI element above is new, not a
  variant of existing work. RBAC tier and "differing outputs" enforcement mechanism are explicit
  documented decisions (per the epic's own instruction not to silently pick one) rather than
  ambiguous open questions left to the dev agent.

### File List
