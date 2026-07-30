---
governing_ads: [AD-5]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: []
enables: [17-7, 17-8, 17-9]
baseline_commit: c702131df0796bde2c754942b99fe4c1b430039d
baseline_commit_note: >
  velara-api HEAD is c702131 "wip(17.2): in-sandbox LLM tracing experiments — SUPERSEDED by Epic 17
  re-arch". That wip commit is superseded work that Stories 17-5..17-8 will DELETE — do NOT build on
  its tracing code. BUT it does NOT touch app/models/invocation.py or any migration file (verified:
  it touches skills.py/config.py/dependencies.py/anthropic_client.py/code_driven_executor.py/
  sandbox_assets/skill_integration_assistant.py + tests only), and the working tree is clean. So for
  THIS schema-only story your two target surfaces (the model + a new migration) sit on a clean
  baseline. velara-api migration head is `0030_dry_run_config_study`; velara-web is untouched by this
  story. This is the FIRST story of the 2026-07-29 cost re-architecture (17-4..17-9); it is
  dependency-free and unblocks 17-7 (estimate write) and 17-8 (reconciler).
status_note: >
  Filled from STUB by bmad-create-story 2026-07-30. Governing artifact is the ARCHITECTURE-SPINE
  (status: final), specifically AD-5. Source citations verified against live source at baseline.
---

# Story 17.4: Cost-Tracking Schema — `langsmith_run_id` + `cost_is_estimated`

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the platform,
I want `invocation_results` to carry a LangSmith trace linkage and an estimated/authoritative flag,
so that cost can be written provisionally at completion and later reconciled to LangSmith's truth
without ambiguity about which state a row is in.

## ⚠️ SCOPE — read this first

**Backend only (`velara-api`). Schema + ORM model only. ZERO behavior change, ZERO new/changed API
surface, ZERO frontend.** You add two nullable-friendly columns to one existing table and mirror them
on the ORM model. Nothing reads or writes these columns yet.

**Who writes/reads these columns is OTHER stories — do NOT do their work here:**
- **17-7** writes the provisional estimate (`cost_is_estimated = true`) on the hot path.
- **17-8** (reconciler) overwrites `cost_usd` and sets `cost_is_estimated = false`.
- **17-9** exposes these states to consumers (jobs/client APIs, analytics).

If you find yourself editing `execution_tasks.py`, `tracing.py`, `pricing.py`, `analytics_service.py`,
`app/api/v1/jobs.py`, `app/schemas/job.py`, or any Celery task — **STOP, you have left this story's
scope.** This story is exactly: one Alembic migration + two `mapped_column` lines + model docstring +
tests for the two.

**Governing invariant: AD-5** (`ARCHITECTURE-SPINE.md:80-84`). The whole point of this story is to make
the three cost states — **estimated (provisional)** · **reconciled (authoritative)** · **NULL
(unpriceable, never fabricated $0)** — representable in the schema. You are not implementing the states'
behavior; you are giving the later stories a place to store them, plus the documented semantics on the
model so 17-7/17-8/17-9 can't misread them.

## Acceptance Criteria

1. **AC1 — Migration adds two columns to `invocation_results`; the ORM model is updated to match.**
   A new forward-only Alembic migration adds:
   - `langsmith_run_id` — `String` (nullable), holds the invocation's LangSmith **trace id** (per AD-7,
     `ARCHITECTURE-SPINE.md:92-96` — this is the *trace_id*, NOT a per-span run id). Use `sa.String()`
     (unbounded) or a generous bound — LangSmith trace ids are UUID-shaped today but do not hard-cap;
     `String(64)` matches the existing `model`/`output_sha256` bound and is safe. Choose `String(64)`
     for consistency with the adjacent cost cluster.
   - `cost_is_estimated` — `Boolean`, **NOT NULL**, with a **server_default of `false`** (see AC3 for
     why the server_default value is `false`).

   The `InvocationResult` model in `app/models/invocation.py` gains both as SQLAlchemy-2.0
   `Mapped[...] = mapped_column(...)` declarations, placed in the Story 15.1 cost block
   (`app/models/invocation.py:187-202`, right after `cost_usd` at :202). `Boolean` and `String` are
   **already imported** (`app/models/invocation.py:21-31`) — no import change needed.

2. **AC2 — Cost-state semantics (AD-5) are documented on the model.** Add a concise docstring/comment
   block above the two new columns capturing the AD-5 contract verbatim in intent:
   - `cost_is_estimated = true` → provisional (real dollars, subject to reconciliation).
   - `cost_is_estimated = false` **with non-NULL `cost_usd`** → authoritative (reconciled, or a genuine
     `$0` no-LLM row).
   - `cost_usd IS NULL` → genuinely unpriceable (unknown model / no trace) — **treated as "unknown",
     never coalesced to `0`** for an LLM runtime.
   - Genuine `code` / fan-out-parent rows: `cost_usd = 0, cost_is_estimated = false`, never assigned a
     `langsmith_run_id`, never reconciled (AD-9, `ARCHITECTURE-SPINE.md:104-108`).
   This is documentation only — it must not change any current write path (none writes these columns
   yet).

3. **AC3 — Default makes existing/historical rows read as reconciled/authoritative (`false`); no
   backfill.** `cost_is_estimated` gets a **`server_default=sa.text("false")`** so the migration
   populates every pre-existing row (and any row created before 17-7 wires the app-level default) as
   `false` = authoritative. This is deliberate: rows priced by the *old* `pricing.py` are treated as
   final (spine "Deferred → Backfill of historical rows … existing values stand", `:169`). Do **NOT**
   write a data-backfill `UPDATE`; the `server_default` alone satisfies this. `langsmith_run_id` stays
   nullable with no default (historical rows never had a trace → correctly NULL). Note the intentional
   split: DB `server_default=false` covers *existing* rows now; the *app-level* default when the
   estimate path writes a NEW row will be `true` (that is 17-7's job, `ARCHITECTURE-SPINE.md:160-161` —
   do not implement it here, but do not contradict it either: `mapped_column(..., server_default=...)`
   for the DB, and leave the Python-side default alone / do not set `default=False`).

4. **AC4 — Migration is idempotent, forward-only, correctly chained, and reversible; it passes the
   stamp-and-replay migration-test harness.**
   - `down_revision` chains off the current head **`0030_dry_run_config_study`**; new `revision`/slug is
     `0031_...` with a **revision id ≤31 chars** (the `alembic_version.version_num` column is
     `VARCHAR(32)`; keep it short, e.g. `0031_invocation_cost_states`).
   - **Idempotent `upgrade()`** — guard each `op.add_column` with an `sa.inspect(bind)` existing-column
     check (mirror `0030_dry_run_config_study.py`). This is **non-negotiable**: the stamp-and-replay
     harness (`tests/integration/services/test_client_only_grants_migration.py` and siblings) runs
     `alembic upgrade head` against a DB **already at head**, so a bare `op.add_column` would raise
     `DuplicateColumn` and fail the suite — exactly the "migration-0029 idempotency bug" the sprint
     history flagged twice.
   - `downgrade()` drops both columns in reverse order (`op.drop_column("invocation_results", ...)`).
   - Mirror the style of `0024_invocation_cost_tracking.py` (same table, additive, nullable, no
     backfill) — annotated module-level `revision`/`down_revision`/`branch_labels`/`depends_on`,
     `import sqlalchemy as sa`, `from alembic import op`, a docstring documenting each column + the
     no-backfill + the AD-5 default decision.

5. **AC5 — No OpenAPI/spec change is expected in this story.** These columns are **not** exposed on any
   response schema here (that is 17-9). Therefore `python scripts/export_openapi.py` must produce
   **zero diff** to `docs/api-spec.json`. Run it and confirm `git diff --exit-code docs/api-spec.json`
   is clean; if it is NOT clean, you have accidentally touched a serialized schema — revert that, you
   are out of scope. (The spec/CI gate is real: CI's `openapi` job re-runs the export and fails on any
   diff.)

## Tasks / Subtasks

- [x] **Task 1 — Update the ORM model** (AC: 1, 2)
  - [x] In `app/models/invocation.py`, in the `InvocationResult` class, immediately after the `cost_usd`
        column (`:202`), add:
        `langsmith_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)` and
        `cost_is_estimated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))`.
        (`text` is already imported at `:30`; `Boolean`, `String` already imported at `:22,:28`.)
  - [x] Add the AD-5 semantics docstring/comment block above the two columns (AC2 wording). Follow the
        existing Story-15.1 comment style already in that block (`:187-202`).
  - [x] Do NOT set a Python-side `default=` on `cost_is_estimated` (the app-write default of `true` is
        17-7's; the DB `server_default=false` handles existing rows — see AC3).
- [x] **Task 2 — Author the migration** (AC: 1, 3, 4)
  - [x] Create `app/db/migrations/versions/0031_invocation_cost_states.py` (or an equally short slug
        ≤31 chars). `revision = "0031_invocation_cost_states"`, `down_revision = "0030_dry_run_config_study"`.
  - [x] `upgrade()`: `bind = op.get_bind(); inspector = sa.inspect(bind)`; compute
        `existing = {c["name"] for c in inspector.get_columns("invocation_results")}`; add
        `langsmith_run_id` (`sa.String(length=64)`, `nullable=True`) only if absent; add
        `cost_is_estimated` (`sa.Boolean()`, `nullable=False`, `server_default=sa.text("false")`) only
        if absent.
  - [x] `downgrade()`: `op.drop_column("invocation_results", "cost_is_estimated")` then
        `op.drop_column("invocation_results", "langsmith_run_id")` (reverse order).
  - [x] Write a module docstring documenting: the two columns, that `cost_is_estimated`'s
        `server_default=false` makes historical rows authoritative (AD-5/AD-3 split, no backfill), and
        the AD-7 note that `langsmith_run_id` holds the **trace id**.
  - [x] NO data backfill `UPDATE` — server_default only.
- [x] **Task 3 — Verify** (AC: 4, 5)
  - [x] Run the migration against a clean `velara_test` DB (`alembic upgrade head`) and confirm both
        columns exist with the expected types/nullability/default; `alembic downgrade -1` then
        `upgrade head` round-trips cleanly.
  - [x] Add/extend a migration test in the stamp-and-replay style (see Testing) asserting: after
        `upgrade head`, `invocation_results` has both columns, a pre-existing seeded row reads
        `cost_is_estimated = false` and `langsmith_run_id IS NULL`. Confirm re-running `upgrade head`
        against an already-migrated DB is a no-op (idempotency — the harness does exactly this).
  - [x] `ruff check` clean; `python scripts/export_openapi.py` produces **zero** `docs/api-spec.json`
        diff (AC5). Run the relevant model/migration tests.

## Dev Notes

### What you're touching (verified against baseline `c702131`)

| File | Change |
| --- | --- |
| `app/models/invocation.py` | +2 `mapped_column` lines + AD-5 docstring, in the `InvocationResult` cost block after `:202`. No import changes. |
| `app/db/migrations/versions/0031_invocation_cost_states.py` | NEW migration, chained off head `0030_dry_run_config_study`. |
| `tests/integration/services/test_*_migration.py` (new or extended) | Stamp-and-replay assertion for the two new columns + idempotency. |

Nothing else. If the File List at the end names any other production file, the story was
over-implemented.

### Exact current shape (do not re-derive — this was verified at baseline)

`InvocationResult` (`app/models/invocation.py:160-228`), `__tablename__ = "invocation_results"`, base
`Base`, SQLAlchemy-2.0 `Mapped`/`mapped_column`. The Story-15.1 cost cluster:

```
196    input_tokens:  Mapped[int | None]     = mapped_column(Integer, nullable=True)
197    output_tokens: Mapped[int | None]     = mapped_column(Integer, nullable=True)
198    model:         Mapped[str | None]     = mapped_column(String(64), nullable=True)
202    cost_usd:      Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
```

Add the two new columns right after `:202`, inside the same commented block. Imports already present
(`:21-33`): `Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint, text`;
`JSONB, UUID`; `Mapped, mapped_column, relationship`.

**Trap — `fan_out` is NOT on this table.** `fan_out` lives on `InvocationJob` (`:115-117`), not
`InvocationResult`. AD-9's "fan-out parent rows keep `cost_usd=0, cost_is_estimated=false`" is a
*runtime* semantic that later stories enforce by reading the parent job's `fan_out`; this story does
**not** add a `fan_out` column to results and does not join. Just document the semantic (AC2), don't
implement it. `fan_out` is the single existing example of `server_default=text("false")` in this file
(`:116`) — mirror that exact idiom for `cost_is_estimated`.

### The migration — mirror `0024`, guard like `0030`

- **Reference template:** `app/db/migrations/versions/0024_invocation_cost_tracking.py` is the closest
  precedent — it added `input_tokens/output_tokens/model/cost_usd` to this same table, additive +
  nullable + no backfill. Copy its structure (annotated revision vars, per-column `op.add_column`,
  reverse-order drops, rich docstring).
- **Idempotency guard (from `0030_dry_run_config_study.py`):** the newest head migrations wrap DDL in
  `sa.inspect(bind)` existence checks precisely because the stamp-and-replay test harness replays the
  head migration against an already-migrated DB. Your migration becomes the new head, so it **must** be
  guarded or the harness fails with `DuplicateColumn`. This is the exact bug the sprint log flagged for
  0029 ("independently caught+fixed a migration-0029 idempotency bug … before the test suite surfaced
  it"). Do not skip this.
- **Head is `0030_dry_run_config_study`** (confirmed: `ls app/db/migrations/versions/ | tail`). Chain
  off it. Keep `revision` ≤31 chars (`alembic_version.version_num` is `VARCHAR(32)`; this repo keeps
  ids ≤31 — note revision id may be shorter than the filename, cf. `0014_skill_output_contract`).
- **Forward-only, no `depends_on`, single linear chain** — the repo has no migration branches.

### Cost-state semantics you are encoding (AD-5, the governing rule)

From `ARCHITECTURE-SPINE.md:80-84` and Consistency Conventions (`:138-146`):

- `cost_is_estimated = true` → **provisional** estimate (real dollars, will be overwritten by 17-8's
  reconciler).
- `cost_is_estimated = false` + non-NULL `cost_usd` → **authoritative** (reconciled, or a genuine `$0`
  no-LLM row).
- `cost_usd IS NULL` → **unpriceable** (unknown model / no trace). NEVER coalesce to `0` for an LLM
  runtime — this is the recurring bug class in this codebase (see the Epic-15 memory: "partial-usage
  None-as-present-key fabricates $0"). `0` is reserved for genuine no-LLM `code` runs.
- `langsmith_run_id` = the LangSmith **trace id** (AD-7), one per leaf invocation. Fan-out parents /
  code runs never get one.

You are only *documenting* these on the model this story; 17-7/17-8/17-9 enforce them.

### Why the default is `false` for existing rows but the app will write `true` (don't conflate)

- **DB `server_default = false`** → backfills historical rows as authoritative (they were priced by the
  old table and are final — spine Deferred `:169`). This is what AC3 requires and is the ONLY default
  behavior you implement.
- **App-side write default = `true`** → when 17-7 writes a *fresh* estimate at completion it will pass
  `cost_is_estimated=True` explicitly (`ARCHITECTURE-SPINE.md:160-161`). That's a future story. So:
  set the DB `server_default=text("false")`, and do **not** set a Python `default=` on the column
  (leaving it unset avoids fighting 17-7's explicit write). If you set `default=False` in the model it
  wouldn't break anything today, but it muddies the intent — omit it.

### Testing

- **Framework:** pytest (`tests/`), integration tests gated on Postgres reachability
  (`skipif` on `DATABASE_URL`). Per the container-test-env memory: the `api` container runs
  `AUTH_BACKEND=cognito`; run migration/integration tests with `set -a; . ./.env.test` and against a
  **freshly recreated clean `velara_test`** DB.
- **Harness to mirror:** `tests/integration/services/test_client_only_grants_migration.py` (migration
  0027) and `test_client_skill_attachment_migration.py` (0026). Pattern: `alembic stamp <prior_rev>`,
  seed rows, then `alembic upgrade head` **as a subprocess** (Alembic's `env.py` calls `asyncio.run()`
  and would collide with pytest-asyncio's loop), assert on migrated data, teardown re-stamps `head`.
  Add a `test_invocation_cost_states_migration.py` (or extend an existing one) asserting the two new
  columns exist and a seeded pre-existing row reads `cost_is_estimated=false` / `langsmith_run_id=NULL`.
- **Idempotency assertion:** running `upgrade head` twice must not error — this is what the guarded
  `upgrade()` buys you and what the shared harness exercises implicitly.
- **Gates before handing off:** `ruff check` clean; migration round-trips (`upgrade`/`downgrade -1`/
  `upgrade`); `python scripts/export_openapi.py` → **no diff** on `docs/api-spec.json` (AC5);
  targeted model + migration tests pass on a clean `velara_test`.

### Project Structure Notes

- Migrations: `app/db/migrations/versions/` (config: `alembic.ini`, `script_location =
  app/db/migrations`). Numeric-prefix + snake_case slug.
- Model lives under `app/models/`; there is no `updated_at` on `InvocationResult` (only `created_at`,
  `:213-215`) — do not add one.
- No Makefile in this repo; the OpenAPI export is `python scripts/export_openapi.py` (writes
  `docs/api-spec.json` deterministically, CI-diff-gated).

### References

- [Source: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md#AD-5] — cost states (governing)
- [Source: ARCHITECTURE-SPINE.md#AD-3] `:68-72` — hot-path estimate write, `cost_is_estimated=true` on new rows (17-7's job; explains the app-default=true vs DB-default=false split)
- [Source: ARCHITECTURE-SPINE.md#AD-7] `:92-96` — `langsmith_run_id` holds the **trace id**, one trace per leaf invocation
- [Source: ARCHITECTURE-SPINE.md#AD-9] `:104-108` — fan-out parents / code runs are `$0`-terminal, `cost_is_estimated=false`, no trace, never reconciled
- [Source: ARCHITECTURE-SPINE.md#Structural-Seed] `:158-164` — `InvocationResult` gains `langsmith_run_id` + `cost_is_estimated`; migration required
- [Source: ARCHITECTURE-SPINE.md#Deferred] `:169` — no backfill of historical rows; existing values stand
- [Source: velara-api/app/models/invocation.py#InvocationResult] `:160-228`, cost cluster `:187-202`, imports `:21-33`, `fan_out` on `InvocationJob` `:115-117`
- [Source: velara-api/app/db/migrations/versions/0024_invocation_cost_tracking.py] — add-column template for this exact table
- [Source: velara-api/app/db/migrations/versions/0030_dry_run_config_study.py] — current head + idempotency-guard pattern to mirror
- [Source: velara-api/tests/integration/services/test_client_only_grants_migration.py] — stamp-and-replay migration-test harness to mirror
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml] — 2026-07-29 re-architecture note (17-4..17-9); "recommended first: 17-5"
- [Memory: project-velara-api-container-test-env] — `.env.test` + clean `velara_test` DB required for integration/migration tests
- [Memory: project-story-15-5-review / project-llm-pricing-table] — the None-as-$0 fabrication bug class this schema's NULL-semantics exist to prevent

## Review Findings

Code review 2026-07-30 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor: **all 5 ACs PASS, zero scope violations** in the story-scoped files. Findings below are all test-quality hardening on the new migration test — the migration DDL and model changes themselves are clean. 5 patch, 2 defer, 5 dismissed.

### Patch (applied 2026-07-30)

- [x] [Review][Patch] Idempotency test's `DuplicateColumn` assertion is dead — `_run_alembic` runs with `expect_success=True`, which asserts `returncode == 0` first, so `assert "DuplicateColumn" not in output` (line 215) can never fire; the real gate is the generic returncode check. The test proves "upgrade head exits 0", which the first test already establishes — not idempotency specifically. [tests/integration/services/test_invocation_cost_states_migration.py:214-215] — FIXED: returncode assertion now documented as the real gate (`expect_success`) + a positive `count(*)==2` "both columns survived the replay intact" assertion added so the test confirms the replay-against-existing-columns path, not just a clean exit.
- [x] [Review][Patch] `test_migration_0031_upgrade_head_is_idempotent` is order-coupled and passes vacuously in isolation — it has no drop/seed of its own and relies on "live schema already at head from the previous test". Run first, with `-k`, or after the drop-test failed, it exercises the *add* path (guard's else-branch), not the replay path it claims to test, and still passes green. Make it self-seeding. [tests/integration/services/test_invocation_cost_states_migration.py:206-215] — FIXED: test now calls `_restore_cost_state_columns()` first (guarantees both columns present), so it exercises the replay path regardless of order/isolation. Proven: passes standalone via `-k test_migration_0031_upgrade_head_is_idempotent`.
- [x] [Review][Patch] Seeded rows are committed and never cleaned up — permanently pollutes `velara_test`; the sibling harness this story was told to mirror (`test_client_only_grants_migration.py:267-276`) explicitly `DELETE`s its seeded rows. [tests/integration/services/test_invocation_cost_states_migration.py:105,164] — FIXED: added `_cleanup_seed()` (DELETEs the seeded result+job+skill) invoked in a `finally`. Proven: post-run seed-row leak count is 0 (was accumulating +1/run).
- [x] [Review][Patch] `test_migration_0031_adds_cost_state_columns` can leave the live schema corrupted on failure — it `DROP COLUMN`s both columns and commits *before* re-running the migration; on upgrade failure/interrupt `velara_test` is left missing columns the ORM model declares, and the fixture teardown only re-stamps bookkeeping. [tests/integration/services/test_invocation_cost_states_migration.py:155-166] — FIXED: whole drop→seed→upgrade wrapped in try/`finally`; `_restore_cost_state_columns()` (ADD COLUMN IF NOT EXISTS) runs in the finally so a failed run leaves the schema whole. Proven: the String(16) mutation run (which fails the test) still fired the cleanup+restore DELETEs.
- [x] [Review][Patch] Column-shape assertions were too loose — `data_type == "character varying"` passes for any varchar length; the boolean's `column_default` was selected but never asserted. [tests/integration/services/test_invocation_cost_states_migration.py:184,186] — FIXED: now asserts `character_maximum_length == 64` and that `cost_is_estimated`'s `column_default` contains `false`. Proven: mutating the migration to `String(16)` makes the test FAIL (old test passed it).

### Deferred (pre-existing / out of scope)

- [x] [Review][Defer] No index on `langsmith_run_id` despite the docstring describing it as the 17-8 reconciler's lookup key — a full-table-scan foot-gun once the table grows. [app/models/invocation.py:216] — deferred: reconciler is Story 17-8; the index (likely partial, `WHERE langsmith_run_id IS NOT NULL`) is 17-8's call, and this story is schema-only. Belongs with the query surface that introduces it.
- [x] [Review][Defer] `_postgres_reachable()` silently skips the whole module (via bare `except: return False`) on any DATABASE_URL that lacks `@`/explicit `:port`, reporting a misleading "Postgres not reachable" — a CI misconfig could make the migration silently untested and green. [tests/integration/services/test_invocation_cost_states_migration.py:33-57] — deferred, pre-existing: copied verbatim from the 0026/0027 sibling migration tests; fixing it belongs to a test-infra pass across all migration tests, not this story.

### Dismissed (5)

- `String(64)` truncation risk on the external LangSmith id — spec AC1 explicitly mandates `String(64)`; ids are UUID-shaped (36 chars). Deliberate, documented.
- `downgrade()` unguarded while `upgrade()` guarded — the template (0024) and mirror-reference (0030) both use bare unguarded `op.drop_column`; the harness only replays *upgrade* against a head DB, never downgrade. Convention-consistent, not a defect.
- Idempotency guard checks column name not type/shape — consistent with 0030's precedent; shape-drift in `velara_test` is not a reachable production path.
- `server_default` without a paired Python `default=` leaves `cost_is_estimated` as None on an unrefreshed instance — spec AC3/Dev Notes explicitly forbid the Python default (reserved for 17-7), and grep confirms **zero** in-session readers of the column this story. Deliberate + unreachable.
- Subprocess doesn't inherit test DB env — false positive; `_run_alembic` passes `env=os.environ`, which carries the test's DATABASE_URL/.env.test through.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Rebuilt `api`/`worker` Docker images twice (model+migration, then +test file) after pruning
  `docker builder prune -a -f` (freed ~6GB; memory-flagged disk-fill risk avoided).
- Recreated `velara_test` clean (`DROP DATABASE` + `CREATE DATABASE ... OWNER velara`) before first
  migration run, per the container-test-env convention.
- Verified idempotency the way the shared harness actually exercises it: `alembic stamp
  0030_dry_run_config_study` (schema still at head) → `alembic upgrade head` replayed 0031's guarded
  DDL against columns that already existed — no `DuplicateColumn`, confirmed via `\d invocation_results`
  before/after.
- First test-seed draft used wrong `skills` column names (`execution_mode` instead of the real
  `author`/`runtime_type`/`visibility`/`lifecycle_state`) — read `app/models/skill.py:43-57` for the
  real enum values (`visibility: internal_only|paired|client_facing`,
  `lifecycle_state: draft|internal_ready|client_ready|retired`) and fixed the seed helper.
- `python scripts/export_openapi.py` must run with `PYTHONPATH=/app` inside the container (bare
  `python scripts/export_openapi.py` from `/app` fails `ModuleNotFoundError: app` — no `pip install -e`
  effect without the path). Confirmed the regenerated spec contains zero occurrences of
  `langsmith_run_id`/`cost_is_estimated` (AC5 — this story doesn't expose them) and that the repo's
  tracked `docs/api-spec.json` has no working-tree diff (untouched by this story). Note: a
  container-side regeneration DOES differ from the committed spec, but that diff is 100%
  Story-17.3 dry-run-config endpoints missing from the tracked file — a pre-existing drift from before
  this story started, not something this story introduced or is responsible for fixing.

### Completion Notes List

- Added `langsmith_run_id` (String(64), nullable) and `cost_is_estimated` (Boolean, NOT NULL,
  `server_default=false`) to `InvocationResult`, with an AD-5 cost-state docstring, immediately after
  `cost_usd` (app/models/invocation.py). No import changes needed (`Boolean`/`String`/`text` already
  imported). No Python-side `default=` set on `cost_is_estimated`, per AC3/Dev Notes — that's Story
  17.7's job.
- New migration `0031_invocation_cost_states.py`, chained off head `0030_dry_run_config_study`,
  idempotent via `sa.inspect` existence checks (mirrors `0030`), reverse-order `downgrade()`. Verified
  live: full-chain `upgrade head` from empty DB, `downgrade -1` → `upgrade head` round-trip, and a
  stamp-back-to-0030-then-replay-upgrade-head idempotency check (the exact scenario the shared
  stamp-and-replay migration harness exercises) — all clean, no `DuplicateColumn`.
- New test `test_invocation_cost_states_migration.py` (2 tests): asserts both columns exist with
  correct nullability/type after migration and that a pre-existing seeded row reads
  `cost_is_estimated=false` / `langsmith_run_id=NULL` / `cost_usd` unchanged (no backfill); asserts
  replaying `upgrade head` at head is idempotent (no `DuplicateColumn`).
- Zero behavior change: nothing reads/writes these columns yet (confirmed no other production file
  touched — File List below has exactly the 2 story-scoped files + 1 test file).
- Gates: full suite 1654 passed / 3 skipped (pre-existing skips, 0 regressions) on a freshly recreated
  `velara_test`; `ruff check .` clean repo-wide; OpenAPI export produces zero diff attributable to this
  story (repo's tracked `docs/api-spec.json` has no working-tree changes).

### File List

- `app/models/invocation.py` (modified — 2 new columns + docstring on `InvocationResult`)
- `app/db/migrations/versions/0031_invocation_cost_states.py` (new — migration)
- `tests/integration/services/test_invocation_cost_states_migration.py` (new — migration tests)

## Change Log

- 2026-07-30: Implemented Story 17.4 (schema-only). Added `langsmith_run_id` + `cost_is_estimated` to
  `invocation_results` via idempotent migration `0031_invocation_cost_states`, mirrored on
  `InvocationResult`. Zero behavior/API change. Full suite green (1654/1654, 3 pre-existing skips),
  ruff clean, migration round-trip + idempotency verified live.
