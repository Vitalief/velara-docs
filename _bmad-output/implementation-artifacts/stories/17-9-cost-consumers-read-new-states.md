---
governing_ads: [AD-5, AD-9]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: [17-7, 17-8]
baseline_commit_api: b3afe21 (development — ⚠️ tree ALSO holds Story 17-8's done-but-uncommitted files, see SCOPE)
baseline_commit_web: d5b2bbe (development, clean tree)
status_note: >
  Filled from STUB by bmad-create-story 2026-07-30. Governing artifact is the ARCHITECTURE-SPINE
  (status: final): AD-5 (cost states: estimated/reconciled/NULL, never fabricated $0) and AD-9
  (leaf-sum invariant — fan-out parents/code runs are $0-terminal). LAST story of the 17-4..17-9
  cost re-architecture chain; both dependencies (17-7 estimate write, 17-8 reconciler) are done, so
  both wire states exist to read. Every citation verified against LIVE source via two parallel
  repo sweeps (velara-api read-consumers/schemas/certification; velara-web render surfaces/types/
  tests). FOUR ground-truth facts fixed the scope: (1) ZERO read-consumers of cost_is_estimated
  exist today — this story is the first and only exposure, and it owns the api-spec.json diff that
  17-7/17-8 explicitly held for it; (2) certification NEVER snapshots cost (zero cost references in
  certification models/schemas/service) — the spine's Deferred flag resolves by CONFIRMATION, no
  code change; (3) analytics is already estimate-blind and NULL-safe at all three SUM sites — AC1
  is verification tests, not a service change; (4) the client portal deliberately drops cost at the
  list_jobs unpack (client.py:240) — widening that tuple changes the unpack arity, and the IP rule
  must be re-asserted with the new flag.
---

# Story 17.9: Cost Consumers Read the New States

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a consumer of cost data (analytics, Run Console, client portal, certification),
I want to correctly interpret estimated vs. reconciled vs. NULL cost,
so that dashboards and evidence never treat an estimate as final or a pending/untraceable run as free.

## ⚠️ SCOPE — read this first

**Full-stack, read-side only.** You expose `InvocationResult.cost_is_estimated` on the internal jobs
API (`JobResult` + `JobSummary`), render an "estimated" indicator on the two job-detail cost surfaces
in `velara-web`, VERIFY (with tests, not code changes) that the analytics leaf-sum invariant survives
the reconciler, and close the spine's deferred certification question by documented confirmation. You
are the **only** story in the 17-4..17-9 chain allowed a `docs/api-spec.json` diff — and it must be
isolated to exactly the two job schemas.

**This story does NOT (verified orthogonal — leave alone):**
- **The estimate write / hot path (17-7).** No change to `app/core/pricing.py`,
  `_extract_cost_fields`, `execution_tasks.py`, `mark_completed`/`mark_blocked`.
- **The reconciler (17-8).** No change to `app/workers/cost_reconciler.py`, `celery_app.py`, or the
  enqueue hook. ⚠️ **17-8's files are done-reviewed but still UNCOMMITTED in the velara-api tree**
  at baseline b3afe21 (the 17-10/17-11 review commit deliberately left them untouched). The full
  leftover set is: `M app/workers/celery_app.py`, `M app/workers/execution_tasks.py`,
  `M tests/unit/workers/test_execution_tasks.py`, `?? app/workers/cost_reconciler.py`,
  `?? tests/integration/workers/test_cost_reconciler.py`,
  `?? tests/unit/workers/test_cost_reconciler.py`. Build on top of them; do **NOT** list them in
  this story's File List, and flag them to the reviewer so the diffs are separated at commit time
  (per never-push-subrepos, only code-review commits subrepos).
- **The wrap seam / sandbox shim (17-5/17-6).** `anthropic_client.py`, `velara_trace.py` untouched.
- **Analytics MECHANISM.** `analytics_service.py` and `schemas/analytics.py` stay byte-identical
  (see AC1/AC2 — the SUM sites are already correct; you only add tests).
- **A migration.** Columns exist (17-4, migration 0031). If you reach for `alembic revision` — STOP.
- **Client-portal exposure.** `ClientJob*` schemas and all client-portal FE surfaces stay
  cost-free — the flag must NOT leak there (AC3).
- **FE polling changes.** Do NOT extend `useJob`'s poll to chase the estimate→reconciled flip (the
  poll stops on terminal status by design, `useJob.ts:14-19`); a re-open/refetch shows the
  reconciled value (`staleTime: 0`). The provisional window is the accepted UX (AD-3/AD-5).

**Governing invariants:** **AD-5** (`ARCHITECTURE-SPINE.md:80-84`) — `cost_is_estimated=true` →
provisional real dollars; `false` + non-NULL → authoritative; NULL → genuinely unpriceable, never
coalesced to 0 for an LLM runtime; `SUM(cost_usd)` skips NULLs and may sum estimated+reconciled; a
dashboard MAY surface "includes N estimated" (decision below). **AD-9** (`:104-108`) — fan-out
parents / code runs are `$0`-terminal (`cost_is_estimated=false`, no trace), so the leaf-sum
invariant (parent=0, children carry cost) must still hold after reconciliation.

### Story-level decisions (documented, not silently picked)

1. **D1 — Analytics does NOT surface "includes N estimated" in this story.** AD-5 makes it a MAY.
   Declined for now: reconciliation lands ~60–90s after completion (17-8's `countdown=60` +
   bounded retry), so at analytics horizons the mix is overwhelmingly reconciled; surfacing a count
   would touch 4 analytics schemas + 2 FE tabs for negligible signal. Revisit via correct-course if
   the operator asks. This keeps `analytics_service.py`/`schemas/analytics.py` at zero diff (AC1).
2. **D2 — Certification captures neither the estimate nor the reconciled value, because it stores no
   cost at all** (verified: zero cost references in `models/certification.py`,
   `schemas/certification.py`, `certification_service.py` — evidence rows link `invocation_job_id`
   and read only `output_sha256`/`result_metadata`/status, `certification_service.py:1000-1005`).
   The spine's Deferred flag ("if 17.3 snapshots cost into evidence, decide estimate vs reconciled")
   resolves as **N/A by construction**: any future cost display on the trail would read the live
   `InvocationResult` row and inherit whatever state it is in. AC4 = document this confirmation; no
   code change.
3. **D3 — The wire flag is `bool | None`, and the FE indicator renders ONLY on the two detail
   panels, not the Jobs History table row.** Nullable because `JobSummary` rows come from an
   OUTERJOIN — a queued/running job has NO result row, and defaulting to `false` would lie
   "authoritative" (AD-5's exact bug class). The table's 80px cost cell (`JobsHistory.tsx:324`)
   can't fit an indicator without colliding with exact-match cost tests; the detail panels are
   where a certifier/operator actually inspects a run.
4. **D4 — Legacy rows (`cost_is_estimated=false` + `cost_usd` NULL) render exactly as today.**
   Pre-17.4 rows read `false` via `server_default` ("historical values stand",
   `models/invocation.py:213-215`). `false` does NOT imply non-NULL cost: NULL still renders "—"
   with no indicator. Never treat `false` as "reconciled therefore priced".

## Acceptance Criteria

1. **AC1 — Analytics mechanism unchanged; leaf-sum invariant VERIFIED to survive the reconciler
   (AD-9).** `app/services/analytics_service.py` and `app/schemas/analytics.py` have **zero diff**.
   New integration tests in `tests/integration/api/test_analytics.py` prove, against real
   post-reconciler-shaped rows: (a) a fan-out parent (`cost_usd=0, cost_is_estimated=false`) plus
   reconciled children (`cost_is_estimated=false`, non-zero cost) sums to exactly the children's
   total — no double count; (b) a mixed population (one estimated row + one reconciled row) sums
   both (AD-5: both are real dollars — the SUM is estimate-blind); (c) a NULL-cost estimated row
   (unknown-model, `cost_is_estimated=true, cost_usd=NULL`) contributes $0 via the SUM-level
   COALESCE and never errors. All three run against the existing `_top_skills`/`_token_cost`/
   `list_users` read paths (`analytics_service.py:137,182,260`) through the API surface.

2. **AC2 — The "includes N estimated" dashboard affordance is explicitly declined (decision D1).**
   No analytics schema/FE change ships for it. The decision + rationale are recorded in this story
   (D1) and in the Dev Agent Record on completion.

3. **AC3 — Jobs API exposes `cost_is_estimated`; the client portal does NOT.**
   - `JobResult` gains `cost_is_estimated: bool | None = None` (populated from
     `job.result.cost_is_estimated` in the detail endpoint, `jobs.py:301-310`). Note: `get_job`
     builds `JobResult` only inside `if job.result is not None:` (`jobs.py:202-203`) — a queued
     job's wire payload has `result: null` entirely (pinned by
     `test_get_queued_job_result_and_cost_absent_fields_stay_none`, `test_jobs.py:1149,:1155`), so
     the detail path always populates a real bool; the `None` default exists for schema
     compatibility, not a reachable detail state.
   - `JobSummary` gains `cost_is_estimated: bool | None = None`, threaded from a widened
     `job_service.list_jobs` select (`job_service.py:342-346` gains `InvocationResult.
     cost_is_estimated` → the row tuple becomes a 4-tuple; return-type annotation at `:279`
     updated).
   - **Both unpack sites change arity:** `jobs.py:155` (`for job, skill_name, cost_usd,
     cost_is_estimated in rows`) and `client.py:240` — where the new field is **dropped alongside
     cost** (extend the existing IP-safety comment at `client.py:238-239`). `ClientJobSummary`/
     `ClientJobRead`/`ClientFanOutChild` (`schemas/job.py:215-283`) stay untouched.
   - **No NULL→$0 coalescing anywhere** (AD-5): `cost_usd` semantics are untouched; the new flag is
     additive. A boolean needs **no** `field_serializer` (that idiom is Decimal-only,
     `schemas/job.py:70-72,181-183`).
   - The existing client IP-safety tests are extended so the flag's absence is asserted
     non-vacuously: the LIST test (`test_client_surface.py:2296`) already uses exact key-set
     equality (`:2313`) and structurally excludes any new key — just seed with
     `cost_is_estimated=True`; the DETAIL test (`:2319`) takes the forbidden-strings extension
     (`:2336` pattern) with `cost_is_estimated` added.

4. **AC4 — Certification's relationship to cost states is confirmed and documented (decision D2).**
   No certification code changes. The story records (D2 + Dev Notes) that the dry-run evidence
   trail stores no cost, so the estimate→reconciled window is tolerated by construction. The
   spine's Deferred item is thereby closed for Epic 17.

5. **AC5 — Run Console + Jobs History detail render the estimated state; NULL never renders as
   $0.** In `velara-web`: `JobResult`/`JobSummary` TS types gain `cost_is_estimated: boolean |
   null` (`src/api/jobs.ts:47-58,106-120`). The RunConsole cost card (`RunConsole.tsx:1378-1400`)
   and the JobsHistory detail panel (`JobsHistory.tsx:81-103`) show a small muted "estimated"
   indicator **iff `cost_is_estimated === true`** — rendered as a **separate DOM node** next to the
   cost value (never appended into the cost text node — exact-match tests `getByText('$0.02')`
   depend on it, `RunConsole.test.tsx:1318`, `JobsHistory.test.tsx:216`). `false`/`null`/absent →
   no indicator (D4). A NULL cost still renders "—" via the untouched `fmtCost` wrappers
   (`RunConsole.tsx:69-71`, `JobsHistory.tsx:25-27`). **No emoji/unicode glyphs** — if an icon is
   used at all it must be an existing `<Icon>` name (`clock` at `Icon.tsx:26` fits; there is NO
   `info` icon, and unknown names silently render nothing, `Icon.tsx:82-83` — plain text is the
   safer choice). New FE tests cover: indicator present when `true`, absent when `false` and when
   `null`, and the existing `$0.00`/`—` conventions unchanged.

6. **AC6 — Gates green; the OpenAPI diff is exactly the two job schemas; zero scope drift.**
   Backend: `ruff check .` clean; affected suites green against a fresh `velara_test`;
   `python scripts/export_openapi.py` → `docs/api-spec.json` diff contains **only** the
   `cost_is_estimated` additions to `JobResult` and `JobSummary` (no analytics/client/cert schema
   change). Frontend: `tsc --noEmit`, eslint, and `vitest run` all clean. `git status --short` in
   velara-api shows only this story's files **plus the pre-existing 17-8 leftovers** (which must
   NOT be absorbed into this story's File List).

7. **AC7 — Live spot-check: an estimated run and a reconciled run both render correctly on the Run
   Console.** With a live LangSmith key: run a skill, observe the cost card show the estimate with
   the "estimated" indicator immediately on completion; after ~one reconcile cycle (~60–90s),
   re-open the job and observe the reconciled value with the indicator gone. **Manual/dev step**
   (no live key in CI — same posture as 17-6 AC6 / 17-8 AC9); the automated suite proves the
   rendering with fixture data. Flag it for the same LangSmith-configured session that owes 17-6's
   and 17-8's live checks — this is the last story of the chain, so one live session can close all
   three before the epic is closed.

## Tasks / Subtasks

- [ ] **Task 1 — Backend: widen `job_service.list_jobs` and thread the flag** (AC: 3)
  - [ ] `app/services/job_service.py`: add `InvocationResult.cost_is_estimated` to the list select
        (`:342-346`); update the return-type annotation (`:279`) to
        `tuple[list[tuple[InvocationJob, str | None, Decimal | None, bool | None]], int]`.
  - [ ] `app/api/v1/jobs.py:155-158`: unpack the 4-tuple; add `"cost_is_estimated":
        cost_is_estimated` to the `model_copy(update={...})`.
  - [ ] `app/api/v1/client.py:240`: unpack the 4-tuple, dropping BOTH cost values
        (`for job, skill_name, _cost_usd, _cost_is_estimated in rows`); extend the IP-safety
        comment at `:238-239` to name the flag.
  - [ ] Update the two DIRECT `job_service.list_jobs` callers in tests that unpack the 3-tuple —
        `tests/integration/api/test_jobs.py:1319` (`for job, _, _ in node_only_rows`) and `:1338`
        (`for job, _, _ in rows`, the Story 16.6 AND-composition test). These are the only other
        `list_jobs` call sites in the repo (production callers are exactly `jobs.py:144` and
        `client.py:223`). `tests/unit/services/test_job_service.py` has no `list_jobs` calls and
        is unaffected.
- [ ] **Task 2 — Backend: schema exposure** (AC: 3, 6)
  - [ ] `app/schemas/job.py`: add `cost_is_estimated: bool | None = None` to `JobResult` (after
        `:68`) and `JobSummary` (after `:179`), each with a short AD-5 docstring line
        (`true`=provisional / `false`+non-NULL=authoritative / `None`=no result row yet). No
        serializer (bool, not Decimal). Do NOT touch the `ClientJob*` schemas (`:215-283`).
  - [ ] `app/api/v1/jobs.py:301-310` (`get_job`): populate from `job.result.cost_is_estimated`
        exactly where `cost_usd` is read (`:309`); confirm the queued-job path leaves it `None`.
  - [ ] Regenerate `docs/api-spec.json` (`python scripts/export_openapi.py`); verify the diff is
        isolated to the two schemas (AC6) — this is the chain's one owned OpenAPI diff.
- [ ] **Task 3 — Backend: analytics invariant verification tests** (AC: 1)
  - [ ] In `tests/integration/api/test_analytics.py`, extend `_seed_invocation_result` (`:217`)
        with a `cost_is_estimated` kwarg (default matching today's behavior) and add the three AC1
        tests (fan-out-parent+reconciled-children no-double-count; estimated+reconciled mixed sum;
        NULL-cost estimated row contributes 0 without error). Model them on the existing cost tests
        (`:507-856`).
  - [ ] Confirm `analytics_service.py` + `schemas/analytics.py` show zero diff (`git diff --stat`).
- [ ] **Task 4 — Backend: client IP-safety re-assertion** (AC: 3)
  - [ ] Extend `test_client_jobs_list_priced_job_has_no_cost_field` (`test_client_surface.py:2296`)
        and `test_client_job_detail_priced_job_has_no_cost_field` (`:2319`) to include
        `cost_is_estimated` in the forbidden-strings assertion (`:2336` pattern); seed the row with
        `cost_is_estimated=True` so the test has teeth.
- [ ] **Task 5 — Frontend: types + indicator** (AC: 5)
  - [ ] `src/api/jobs.ts`: `cost_is_estimated: boolean | null` on `JobResult` (insert after `:57`
        — `cost_usd` is the interface's LAST field at `:57` and `:58` is the closing brace) and
        `JobSummary` (after `:119`), with the AD-5 comment convention the file already uses
        (`:56`). No hook/mapper change needed — `getJob`/`listJobs` return parsed JSON directly
        (`:160-168`).
  - [ ] `RunConsole.tsx` cost card (`:1378-1400`): render the indicator as a sibling node of the
        cost span (`:1382`) when `job.result.cost_is_estimated === true`. Suggested shape: a muted
        `<span className="text-[11px] text-faint">estimated</span>` (match the panel's existing
        muted-label styling); a `title` tooltip like "Provisional estimate — reconciled with
        LangSmith shortly" is welcome. Plain text preferred over an icon (see AC5 icon trap).
  - [ ] `JobsHistory.tsx` detail panel (`:81-103`): same indicator next to the cost row (`:85`).
        The table row (`:214`) and header (`:324`) stay untouched (D3).
- [ ] **Task 6 — Frontend: tests** (AC: 5)
  - [ ] `RunConsole.test.tsx`: extend the Story 15.2 cost block (`:1283-1393`) — indicator present
        for a `cost_is_estimated: true` fixture; absent for `false` and for `null`; existing
        `$0.00`/`—`/no-`$NaN` assertions still pass unmodified.
  - [ ] `JobsHistory.test.tsx`: same coverage on the detail panel (`:200-304` block); add
        `cost_is_estimated` to the fixtures (`:73,:87` and the detail fixture at `:250-253`).
  - [ ] Fixture reality check: `tsc` will NOT enumerate the fixtures for you — every existing
        job fixture bypasses the type (`as unknown as JobReadWithResult` casts throughout
        `RunConsole.test.tsx` / `JobsHistory.test.tsx`; untyped `mockJobs`/`mockRuns` literals in
        `JobsHistory.test.tsx:60-89` and `RecentRunsPanel.test.tsx:41-70`; `as never` mocks in
        `RecentRunsPanel.test.tsx:15-24`). Keep the interface field REQUIRED (`boolean | null`) —
        the forced-edit count is ~0 — and manually add `cost_is_estimated` to the fixtures your
        new/extended tests exercise. Untouched legacy fixtures stay green because an absent field
        reads `undefined` → no indicator (the intended `false`-like rendering).
- [ ] **Task 7 — Gates + scope confirmation** (AC: 6, 7)
  - [ ] Backend in-container (see Testing): `ruff check .`; affected suites (`test_jobs.py`,
        `test_client_surface.py`, `test_analytics.py`, `test_job_service.py`) + full regression on
        a fresh `velara_test`; OpenAPI regen + diff isolation check.
  - [ ] Frontend: `tsc --noEmit`, eslint, `vitest run` (expect ~807 baseline tests + new ones).
  - [ ] `git status --short` in BOTH subrepos; confirm this story's File List contains ONLY this
        story's edits (17-8's uncommitted files excluded and flagged to the reviewer).
  - [ ] Record AC7 as a flagged manual step alongside 17-6 AC6 / 17-8 AC9 (one live LangSmith
        session closes all three).

## Dev Notes

### Governing invariants (verbatim intent)

- **AD-5** (`ARCHITECTURE-SPINE.md:80-84`): "`cost_is_estimated = true` → provisional (real
  dollars, subject to change); `false` with non-NULL `cost_usd` → authoritative; `cost_usd IS
  NULL` → genuinely unpriceable (unknown model / no trace), treated as 'unknown', never coalesced
  to 0 for an LLM runtime. `SUM(cost_usd)` skips NULLs and may sum estimated+reconciled (both are
  real figures); a dashboard MAY surface 'includes N estimated'. Explicit `0` stays reserved for
  genuine no-LLM `code` runs."
- **AD-9** (`:104-108`): "`fan_out = true` parent rows keep `cost_usd = 0`, `cost_is_estimated =
  false`, are never assigned a trace, and are never reconciled — preserving the existing analytics
  invariant (leaf-sum works *because* the parent is 0)."
- Spine consumer rule (`:146`): "Consumer → LangSmith: **Forbidden**; consumers read only Postgres
  `cost_usd` / `cost_is_estimated`." Nothing in this story talks to LangSmith.

### ⭐ The key ground-truth that shapes this story

**You are the FIRST reader of `cost_is_estimated`.** Grep confirms the column is referenced only by
its definition (`models/invocation.py:217-219`), the migration, the 17-7 writer, and the 17-8
reconciler — zero read-consumers. 17-7's and 17-8's stories both explicitly held API exposure for
this story ("Exposing the flag on the wire is 17-9's AC — it owns the api-spec.json diff").

**The AD-5 state table you are exposing (verbatim from `models/invocation.py:204-215`):**
`cost_is_estimated=true` → provisional (real dollars, subject to reconciliation);
`cost_is_estimated=false` + `cost_usd` non-NULL → authoritative (reconciled by 17-8, or a genuine
$0 no-LLM `code` run); `cost_usd IS NULL` → genuinely unpriceable, never coalesced to 0 for an LLM
runtime. `server_default=false` makes every pre-existing row read as authoritative (no backfill —
historical values stand). **Corollaries that trip naive readers:**
- `false` + NULL cost is a VALID state (legacy pre-17.4 rows) → render "—", no indicator (D4).
- `true` + NULL cost is a VALID state (unknown-model row, tracing on or off) → "—" + indicator
  (the value is literally pending/unknown — the indicator is truthful there).
- A queued/running job has NO result row → wire `None`, render nothing new.

**Analytics is already correct — do not "improve" it.** All three SUM sites are SUM-level
`func.coalesce(func.sum(InvocationResult.cost_usd), 0)` (`analytics_service.py:137` `_top_skills`,
`:182` `_token_cost`, `:260` `list_users`; `user_detail` reuses `_token_cost` at `:334`). There is
**no single-row NULL→0 coalesce anywhere in `app/`** (swept). The SUMs are estimate-blind by
construction, which is exactly what AD-5 prescribes. Reconciliation only changes the *value* of
`cost_usd` on leaf rows; parents stay 0 (`cost_is_estimated=false`, no trace — 17-8's candidate
predicate structurally can't touch them). Hence AC1 = tests only. **Precision on the fan-out
parent:** all three SUM sites run under `_invocation_where`, which filters
`AuditLogEntry.outcome.isnot(None)` (`analytics_service.py:66-71`, wired at `:222,:252,:295`) —
the parent's audit entry is EXCLUDED from the join, so the parent contributes 0 via *exclusion*,
not via its cost=0 row being summed. Either mechanism satisfies AD-9; write AC1(a)'s assertion as
"total == children's sum", not "the parent row is counted at 0".

**The jobs read path, exactly (verified):**
- List: `job_service.list_jobs` (`job_service.py:270-355`) selects
  `select(InvocationJob, Skill.name, InvocationResult.cost_usd)` with
  `.outerjoin(InvocationResult, InvocationResult.invocation_job_id == InvocationJob.id)`
  (`:342-346`), returns `tuple[list[tuple[InvocationJob, str|None, Decimal|None]], int]` (`:279`).
  Consumed by `jobs.py:155` (3-tuple unpack → `JobSummary.model_copy(update=...)` `:156-158`) and
  `client.py:240` (3-tuple unpack, cost deliberately dropped, comment `:238-239`).
- Detail: `get_job` (`jobs.py:171-310`) builds `JobResult(... cost_usd=job.result.cost_usd)`
  directly off the ORM row (`:301-310`). The queued-job behavior (result fields all None) is pinned
  by `test_get_queued_job_result_and_cost_absent_fields_stay_none` (`test_jobs.py:1149`) — mirror
  it for the new flag.
- Schemas: `JobResult` (`schemas/job.py:39-72`; cost at `:68`, Decimal `field_serializer` at
  `:70-72`); `JobSummary` (`:155-183`; cost `:179`, serializer `:181-183`; tokens/model are
  deliberately summary-excluded per `:162-163` — keep that exclusion, the flag is cheap but tokens
  are not the pattern to copy). The new bool field needs NO serializer.

**Client portal IP boundary (must survive the arity change):** `ClientJobSummary`
(`schemas/job.py:265-283`) and `ClientJobRead` (`:241-262`) are `from_attributes=False` and carry
zero cost/token fields; `client.py:238-240` drops cost at the unpack with an explicit comment. The
client-portal FE renders no cost anywhere (swept: `ClientJobsHistory.tsx` has Skill/Status columns
only, `:51-52`). Your change is: widen the unpack, drop the new value too, extend the comment, and
extend the two IP tests (`test_client_surface.py:2296,2319,2336`) so the boundary is asserted for
the flag — seed with `cost_is_estimated=True` so absence is proven non-vacuously (the seed helper
takes a `cost_usd` kwarg at `:328` and builds the `InvocationResult` at `:389/:400`).

**Certification (D2/AC4) — the confirmation, with receipts:** `CertificationRecord`
(`models/certification.py:26-83`) is Part 11 signature fields only; `CertificationDryRunEvidence`
(`:154-207`) stores `skill_version_id`/`invocation_job_id`/`dry_run_config_id`/`org_id`/
`created_at` — no cost column. The trail response `CertificationDryRunEvidenceRead`
(`schemas/certification.py:166-186`) carries `job_status`/`output_sha256`/`qa_reason` — no cost.
The trail builder reads only status/sha/metadata off `InvocationResult`
(`certification_service.py:1000-1005`); the gate counts hash `output_sha256` exclusively
(`:534-614`). The FE trail card renders no cost (swept `CertificationDryRunTrail.tsx`). Nothing to
tolerate, nothing to snapshot — write the confirmation into the Dev Agent Record and move on.

### Frontend surfaces, exactly (verified)

- **Types** (`src/api/jobs.ts`): `JobResult` `:47-58` (cost `:58`, with the null-vs-0 comment
  convention at `:56-57` — extend it for the flag); `JobSummary` `:106-120` (cost `:119`);
  `JobReadWithResult.result: JobResult | null` (`:98`). `getJob`/`listJobs` (`:160-168`) return
  parsed JSON directly — no transform layer, the flag propagates untouched once typed.
- **Run Console cost card** (`RunConsole.tsx:1378-1400`, guarded `!isFanOut && job.result`,
  `isFanOut` at `:1286`): cost `fmtCost(job.result.cost_usd)` at `:1382`; model row `:1384-1389`;
  tokens row `:1390-1398`. Data via `useJob(activeJobId)` (`:1169`). Fan-out parents never show the
  card, so the indicator can't mislabel a parent's $0.
- **Jobs History** (`JobsHistory.tsx`): detail panel `:81-103` (cost `:85`, guarded `!job.fan_out
  && job.result` — note blocked jobs DO have result rows, so the indicator correctly applies to
  them too); table row cost cell `:214` + header `:324` (untouched, D3).
- **Third render location via component reuse (expected, not a bug):**
  `RecentRunsPanel.tsx:5` (Story 16.6, Project/Study screens) imports `JobRow, JobDetailPanel`
  from JobsHistory — the indicator added to the detail panel automatically renders there too.
  That is desirable (AD-5 binds "all cost consumers") and needs no extra code; just know
  `RecentRunsPanel.test.tsx` fixtures carry `cost_usd` (`:41-70`, values at `:54,:68`) if an
  assertion there ever collides.
- **Formatters:** `fmtUsd` (`analyticsFormat.ts:14-23`) guards null/NaN → `'—'`; the two
  module-local `fmtCost` wrappers (`RunConsole.tsx:69-71`, `JobsHistory.tsx:25-27`) are the
  codebase's explicit null-convention markers — leave them; `fmtNum` has NO null guard
  (`analyticsFormat.ts:6-8`), hence the per-value `!= null` checks at token call sites.
- **Indicator styling:** there is NO shared Chip/Badge primitive (swept `src/shared/components/`);
  the pill idiom is feature-local `JobStatusBadge.tsx` (rounded-full bordered pill). A full pill is
  overkill next to an 11.5px cost line — a muted text span is the codebase-consistent choice. HARD
  rule: no emoji/unicode glyphs (`Icon.tsx:1-4`); available icon names that fit are `clock`
  (`Icon.tsx:26`) / `history` (`:46`); there is NO `info` icon and `<Icon>` returns `null` for
  unknown names (`:82-83`) — a typo'd icon silently renders nothing, which is why plain text is
  recommended.
- **Analytics FE untouched** (D1): `OverviewTab.tsx:101,136,160-161`, `ByUserTab.tsx:63,204-210`
  and `src/api/analytics.ts` types (non-nullable `number` cost fields — correct, backend COALESCEs
  to 0) all stay as-is.
- **AuditDetailPanel** (`AuditDetailPanel.tsx:111-115`) renders adapter-propose `cost_usd` from
  generic audit metadata — orthogonal (15.4's write path, no `cost_is_estimated` in that metadata);
  do not touch.

### Test blast radius (measured, not guessed)

Backend concentration: `test_analytics.py` (34 cost refs; helper `_seed_invocation_result` at
`:217`; existing cost tests `:507,:540,:576,:610,:638,:682,:770,:856`; a fan-out seeding precedent
to model AC1(a) on exists at `test_overview_excludes_admin_and_fan_out_parent_rows` `:373` with
`_seed_entry(event_type="invocation.fan_out")` `:402`), `test_jobs.py` (21 refs; cost tests
`:1057-:1149`; job-seed helper takes `cost_usd` at `:435`; **direct `list_jobs` 3-tuple unpacks at
`:1319,:1338` break on the arity change**), `test_client_surface.py` (9 refs; IP tests
`:2296,:2319`; key-set equality `:2313`; forbidden-strings assert `:2336`). Adding a nullable
schema field with default `None` breaks none of the existing serialization assertions; the arity
change in `list_jobs` is the one mechanical breaker — fix all four unpack sites (2 production, 2
test) in the same pass.

Frontend: `RunConsole.test.tsx` (91 tests; cost block `:1283-1393`), `JobsHistory.test.tsx` (14
tests; cost block `:200-304`), fixtures at `RunConsole.test.tsx:1311,:1349,:1385` and
`JobsHistory.test.tsx:73,:87,:250-253`. Exact-match queries `getByText('$0.02')` /
`getByText('—')` are safe ONLY if the indicator is a separate DOM node. See Task 6's fixture
reality check: fixtures are cast/untyped, so `tsc` enumerates nothing — the field stays required
on the interface and fixture edits are manual, scoped to the tests you touch.

### Testing

- **Framework:** backend pytest (unit `tests/unit/`, integration `tests/integration/`,
  Postgres-gated); frontend vitest + Testing Library.
- **[Memory: project-velara-api-container-test-env]:** the `api` container runs
  `AUTH_BACKEND=cognito` via its `.env` — bare in-container `pytest` yields hundreds of 401s. Run
  integration suites with `set -a; . ./.env.test`, and **recreate `velara_test` clean**
  (dropdb/createdb + `alembic upgrade head`) before trusting a full run.
- **[Memory: project-container-stale-baked-test-file] (bit 17.4–17.8):** the `api`/`worker`
  containers bake source — NO bind mount. `docker cp` every edited file in (and grep-verify a new
  symbol, e.g. `cost_is_estimated` in `schemas/job.py`) before trusting in-container results.
  ⚠️ Because 17-8's `cost_reconciler.py` is uncommitted AND absent from the baked image, a full
  in-container suite may need it `docker cp`'d too (its tests import it).
- **OpenAPI regen:** `python scripts/export_openapi.py` (in-container with `PYTHONPATH=/app`)
  writes `docs/api-spec.json` deterministically; CI re-runs it and `git diff --exit-code`s. The
  expected diff here is ONLY the two schema additions. If the container's baked image predates
  recent routes, use the clean pre/post regeneration-and-diff methodology from 17.6/17.7's Debug
  Logs rather than diffing against the tracked file.
- **Pre-existing failures to expect, not fix:** `test_config.py::test_default_value_is_false`
  (container `.env` leaks `LANGSMITH_TRACING=true` — documented since 17.4); the audit-dedup test
  needs a clean DB (17.10/17.11 review note).
- **Frontend gates:** `npx tsc --noEmit`, eslint (0 errors), `vitest run` — baseline 807 tests at
  d5b2bbe; 0 regressions expected since the indicator is additive and node-separate.
- **What to assert (summary):** BE — detail exposes `true`/`false`; legacy row exposes `false` with
  NULL cost intact; queued job exposes `None`; list rows expose the flag; client payloads never
  contain the string; analytics AC1 trio; OpenAPI diff isolation. FE — indicator iff `true`;
  `—`/`$0.00` conventions unchanged; no `$NaN`.

### Project Structure Notes

- Backend edit surface: `app/services/job_service.py` (select + annotation), `app/api/v1/jobs.py`
  (unpack + detail build), `app/api/v1/client.py` (unpack drop), `app/schemas/job.py` (two
  fields), `docs/api-spec.json` (regen). Tests: `test_jobs.py`, `test_client_surface.py`,
  `test_analytics.py`, `test_job_service.py`.
- Frontend edit surface: `src/api/jobs.ts` (types), `src/features/run/components/RunConsole.tsx`
  (cost card), `src/features/run/components/JobsHistory.tsx` (detail panel). Tests:
  `RunConsole.test.tsx`, `JobsHistory.test.tsx`.
- Untouched (verified orthogonal): `analytics_service.py`, `schemas/analytics.py`, all
  certification files, all `ClientJob*` schemas + client-portal FE, `pricing.py`,
  `execution_tasks.py`, `cost_reconciler.py`, `anthropic_client.py`, `velara_trace.py`, all
  migrations, `useJob.ts` polling.
- velara-web is a SEPARATE nested git repo ([Memory: project-story-12-1-review]) — `cd` back to the
  top-level repo for docs publishing; dev-story commits NEITHER subrepo
  ([Memory: feedback-never-push-subrepos]).

### References

- [Source: ARCHITECTURE-SPINE.md#AD-5] `:80-84` — the three cost states + SUM semantics + the MAY
  this story's D1 declines (governing).
- [Source: ARCHITECTURE-SPINE.md#AD-9] `:104-108` — leaf-sum invariant; parents/code runs
  $0-terminal, never reconciled (AC1's subject).
- [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions] `:136-146` — consumers read only
  Postgres; LangSmith forbidden to consumers.
- [Source: ARCHITECTURE-SPINE.md#Deferred] `:172` — the 17.3 certification-snapshot flag this
  story's D2/AC4 closes.
- [Source: velara-api/app/models/invocation.py] `:202` `cost_usd Numeric(12,6)` nullable; `:204-215`
  AD-5 state docstring (the semantics you expose); `:216` `langsmith_run_id`; `:217-219`
  `cost_is_estimated Boolean NOT NULL server_default false`.
- [Source: velara-api/app/services/job_service.py] `:270-355` `list_jobs` (`:279` return
  annotation; `:342-346` the select + outerjoin you widen).
- [Source: velara-api/app/api/v1/jobs.py] `:144-158` list endpoint (unpack `:155`, model_copy
  `:156-158`); `:171-310` `get_job` (JobResult build `:301-310`, cost read `:309`).
- [Source: velara-api/app/api/v1/client.py] `:200-247` `client_list_jobs`; `:238-240` the
  deliberate cost drop + comment (extend both).
- [Source: velara-api/app/schemas/job.py] `:39-72` `JobResult` (cost `:68`, serializer `:70-72`,
  docstring `:47-56`); `:155-183` `JobSummary` (cost `:179`, serializer `:181-183`,
  summary-exclusion note `:162-163`); `:215-283` `ClientOutputFile`/`ClientFanOutChild`/
  `ClientJobRead`/`ClientJobSummary` (untouched, `from_attributes=False` at `:254,:276`).
- [Source: velara-api/app/services/analytics_service.py] `:131-154` `_top_skills` (SUM `:137`,
  emit `:152`); `:173-190` `_token_cost` (SUM `:182`, docstring `:174-179`); `:217,:229,:239`
  overview wiring; `:244-284` `list_users` (SUM `:260`, emit `:281`); `:334,:368` `user_detail`
  reuse — ALL untouched (AC1).
- [Source: velara-api/app/schemas/analytics.py] `:28,:40,:52,:89` float cost fields — untouched.
- [Source: velara-api/app/services/certification_service.py] `:534-614` evidence counts (hash-only);
  `:985-1044` trail builder (`:1000-1005` select — no cost) — D2's receipts.
- [Source: velara-api/app/models/certification.py] `:26-83` `CertificationRecord`; `:154-207`
  `CertificationDryRunEvidence` — no cost columns.
- [Source: velara-api/app/schemas/certification.py] `:166-186` `CertificationDryRunEvidenceRead`;
  `:189-199` list wrapper — no cost fields.
- [Source: velara-api/scripts/export_openapi.py] deterministic spec export; CI `openapi` job diff
  gate.
- [Source: velara-api/tests/integration/api/test_jobs.py] `:1057-:1149` the six cost tests to
  extend/mirror; `:435` seed `cost_usd` kwarg; `:1149` queued-job all-None precedent.
- [Source: velara-api/tests/integration/api/test_client_surface.py] `:2296,:2319` IP tests;
  `:2336` forbidden-strings assert; `:328,:389,:400` seed helper.
- [Source: velara-api/tests/integration/api/test_analytics.py] `:217` `_seed_invocation_result`;
  `:507-:856` existing cost tests (models for the AC1 trio).
- [Source: velara-web/src/api/jobs.ts] `:47-58` `JobResult`; `:106-120` `JobSummary`; `:98`
  `JobReadWithResult.result`; `:160-168` no-transform fetchers.
- [Source: velara-web/src/features/run/components/RunConsole.tsx] `:69-71` `fmtCost`; `:1286`
  `isFanOut`; `:1378-1400` cost card (cost `:1382`); `:1169` `useJob`.
- [Source: velara-web/src/features/run/components/JobsHistory.tsx] `:25-27` `fmtCost`; `:81-103`
  detail panel (cost `:85`); `:214` row cell + `:324` header (untouched).
- [Source: velara-web/src/features/analytics/analyticsFormat.ts] `:14-23` `fmtUsd` (null guard
  `:15`); `:6-8` `fmtNum` (no guard).
- [Source: velara-web/src/shared/components/Icon.tsx] `:1-4` no-emoji rule; `:26` `clock`; `:46`
  `history`; `:82-83` unknown-name → renders nothing (trap).
- [Source: velara-web/src/features/run/hooks/useJob.ts] `:8-21` `useJob` (3s poll, terminal stop,
  `staleTime: 0`); `:24-30` `useJobs` — both untouched.
- [Source: velara-web/src/features/run/components/RunConsole.test.tsx] `:1283-1393` cost tests +
  exact-match assertions (`:1318,:1356,:1392-1393`).
- [Source: velara-web/src/features/run/components/JobsHistory.test.tsx] `:200-304` cost tests +
  fixtures (`:73,:87,:216-217,:229`).
- [Source: _bmad-output/implementation-artifacts/stories/17-8-deferred-cost-reconciler-task.md]
  (done) — the reconciler whose output states you read; its AC9 manual-live posture AC7 mirrors;
  its files are UNCOMMITTED in the tree at this story's baseline.
- [Source: _bmad-output/implementation-artifacts/stories/17-7-estimate-write-hot-path-slim-pricing.md]
  (done) — the estimate writer; its scope note explicitly hands API/schema exposure to this story.
- [Memory: project-story-15-5-review] — partial-usage None-as-present-key fabricating $0 is the
  recurring platform bug class; this story's read-side twin is coalescing NULL→0 or defaulting the
  flag to `false` for absent rows — do neither.
- [Memory: project-epic9-ui-design-ref] / [Memory: project-no-emoji-icons] — UI conventions; the
  indicator must not introduce emoji/unicode glyphs.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-07-30: Story drafted from STUB by create-story. Governing AD-5/AD-9. Both dependencies
  (17-7 estimate write, 17-8 reconciler) done, so both wire states exist. Scope fixed by two
  parallel live-source sweeps (velara-api read-consumers/schemas/certification; velara-web render
  surfaces/types/tests): (1) zero `cost_is_estimated` readers exist — this story is the first
  exposure and owns the chain's one api-spec.json diff (JobResult + JobSummary only); (2)
  certification stores no cost anywhere — the spine's Deferred snapshot question closes by
  confirmation (D2), no code change; (3) analytics is already estimate-blind/NULL-safe at all
  three SUM sites — AC1 is verification tests with a required zero-diff on the service and its
  schemas; (4) the client portal drops cost at the `list_jobs` unpack — the 4-tuple widening
  changes that arity and the IP tests are extended to assert the flag never leaks. Four decisions
  documented (D1 decline the AD-5 MAY on analytics; D2 certification N/A-by-construction; D3
  nullable wire flag + detail-panels-only indicator; D4 legacy false+NULL renders unchanged).
  AC7 live spot-check flagged manual alongside 17-6 AC6 / 17-8 AC9 — one LangSmith-configured
  session can close all three before the epic closes. ⚠️ Baseline trap recorded: 17-8's files sit
  done-but-uncommitted in velara-api at b3afe21 — excluded from this story's File List, flagged
  for reviewer-time diff separation.
- 2026-07-30: Independent fresh-context validation pass (read-only, against live source at both
  baselines) — zero CRITICAL issues; every load-bearing citation and behavioral claim confirmed
  (get_job builds JobResult only when a result row exists; `list_jobs` production callers are
  exactly jobs.py:144 + client.py:223; `model_copy(update=)` bypasses validation so the flag
  threads cleanly; certification has zero cost references; no unhandled AD-5 consumer). Six
  refinements folded in: (1) the 3-tuple test unpacks that break on the arity change are
  `test_jobs.py:1319,:1338` — NOT `test_job_service.py`, which never calls `list_jobs`; (2) FE
  fixtures are cast/untyped so `tsc` enumerates nothing — field stays required, fixture edits are
  manual and scoped; (3) analytics excludes the fan-out parent via `_invocation_where`'s
  `outcome.isnot(None)` filter (`analytics_service.py:66-71`) — parent contributes 0 by exclusion,
  not by summing its $0 row; AC1(a) asserts "total == children's sum"; (4) `jobs.ts` insertion
  anchor corrected to after `:57` (`:58` is the closing brace); (5) the 17-8 uncommitted-leftover
  list gains `tests/unit/workers/test_execution_tasks.py`; (6) the indicator renders on a THIRD
  surface by design — `RecentRunsPanel` reuses JobsHistory's `JobDetailPanel` (16.6), noted as
  expected. Plus wording fixes: queued-job detail path returns `result: null` wholesale; the
  client LIST IP test uses key-set equality (`:2313`) while only the DETAIL test takes the
  forbidden-strings extension.
