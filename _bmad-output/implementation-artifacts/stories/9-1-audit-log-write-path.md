---
baseline_commit: 87e36e0e01f61c55287a6bf695d14403ab325329
---

# Story 9.1: Audit Log Write Path

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform developer,
I want every skill invocation, access event, and administrative action written to a partitioned, append-only audit log that carries the full hierarchy path **and LLM token usage**,
so that the platform has a complete, tamper-resistant record of all significant events — and a queryable basis for usage/value reporting.

## Acceptance Criteria

1. **Partitioned schema.** Given the Alembic migration runs, when I inspect the schema, then `audit_log_entries` is partitioned by month (PostgreSQL declarative range partitioning on `created_at`) and has: `id`, `event_type`, `user_id`, `hierarchy_path` (ltree), `skill_id`, `skill_version`, `job_id`, `outcome`, `metadata` (JSONB), `created_at` — plus the existing `runtime_type`, `fan_out`, `error_code`, `started_at`, `completed_at`, and the renamed `parent_invocation_id`.

2. **Invocation write.** Given a skill invocation completes (success or failure), when `audit_service.record_invocation()` is called, then an entry is written with all required fields including full `hierarchy_path`; only genuinely-optional fields are nullable (e.g. `skill_version`/`skill_id` for non-skill events; `runtime_type`/`outcome` for admin events).

3. **Token usage recorded (this story's addition).** Given a **prompt** or **hybrid** skill invocation completes, when the audit entry is written, then its `metadata` JSONB carries the LLM token usage already captured on the run — `{"input_tokens": N, "output_tokens": M, "model": "..."}` — sourced from the run's `result_metadata`. For **code** (non-LLM) runs the token keys are absent (no LLM tokens exist). Dollar **cost is NOT computed here** — cost derivation (tokens × per-model price) is Story 9.4's analytics concern; 9.1 records the raw counts that make it derivable.

4. **Fan-out.** Given a fan-out invocation completes, when audit entries are written, then one parent entry has `event_type: "invocation.fan_out"` and N child entries each carry `parent_invocation_id` linking to the parent.

5. **Append-only (DB-enforced).** Given an entry exists, when any user or process attempts UPDATE or DELETE (or TRUNCATE), then a DB-level trigger prevents it — the table stays append-only across all partitions.

6. **Part 11 trail (FR-SEC-09).** Given 21 CFR Part 11 §11.10(e), when an entry is written, then it is attributable to a unique `user_id`, carries a UTC `created_at`, and is tamper-evident (append-only) — a secure, computer-generated, time-stamped audit trail.

7. **Admin actions.** Given an admin action occurs (granting access, changing a lifecycle/certification state), when `audit_service.record_admin_action()` is called, then an entry is written with `event_type: "admin.*"` and the relevant context in `metadata` — with `runtime_type`/`skill_version`/`outcome` nullable for these non-invocation events.

## Tasks / Subtasks

- [x] **Task 1 — Migration 0018: evolve `audit_log_entries` into a partitioned general event log (AC: #1, #5)**
  - [x] **Migration number is 0018** (last is `0017_skill_attachment`; NOT 0016 — 0016 is `user_access_grants` from 8.1). `down_revision = "0017_skill_attachment"`.
  - [x] PostgreSQL cannot ALTER an existing table into a partitioned one → **DROP + recreate** as `PARTITION BY RANGE (created_at)`. No live data exists (product-confirmed: app has no users), so drop-and-recreate has zero data-migration cost — but the downgrade must restore the 0006 non-partitioned shape.
  - [x] **Composite PK `(id, created_at)`** — the partition key (`created_at`) MUST be part of every unique/primary key on a partitioned table. (This changes the 0006 single-column `id` PK.)
  - [x] New/changed columns: add `event_type VARCHAR` (NOT NULL); add `job_id UUID` (nullable); add `metadata JSONB` (nullable); rename `invocation_id` → `parent_invocation_id`; make `runtime_type`, `skill_version`, `skill_id`, `outcome` **nullable** (admin/non-skill events don't have them).
  - [x] **Inbound/outbound FK caution:** a partitioned table's PK is now composite, so the existing `fk_audit_log_entries_invocation_id`/`_skill_id` outbound FKs still work (they reference other tables' PKs, not this one). But **do NOT add any inbound FK pointing AT `audit_log_entries`** and be aware child `parent_invocation_id` self-reference cannot be a real FK across partitions — keep it a plain indexed UUID column (mirrors how 0006 already treated `invocation_id` as a soft ref). Keep `skill_id`→`skills` and `job_id`→`invocation_jobs` as nullable soft references or plain columns; verify FK creation succeeds against the partitioned parent (if Postgres rejects, drop to plain indexed columns and note it).
  - [x] **Recreate the append-only triggers on the parent AND ensure they apply to partitions.** Row-level `BEFORE UPDATE OR DELETE` triggers do NOT automatically propagate to partitions created later — use the row-trigger on the parent (Postgres 11+ propagates row triggers to partitions) OR attach per-partition; the **statement-level `BEFORE TRUNCATE` trigger does NOT auto-propagate to partitions** (known PG limitation) — document this and attach TRUNCATE protection to each created partition, or rely on the row-trigger + an operational note. Reuse the existing `reject_audit_mutation()` function shape from [0006_audit_log_entries.py:85-105](velara-api/app/db/migrations/versions/0006_audit_log_entries.py#L85-L105).
  - [x] **Create the initial month partitions** the app will write to (at least the current month + a couple ahead) so inserts don't fail on a missing partition. A default/catch-all partition is acceptable to avoid insert failures on an unprovisioned month; note the operational need for ongoing partition creation (Phase-2 automation, out of scope here).
  - [x] Migration must be `down`/`up` clean; verify on a fresh `velara_test`.

- [x] **Task 2 — ORM model: evolve `AuditLogEntry` (AC: #1, #2, #3, #7)**
  - [x] [app/models/audit.py](velara-api/app/models/audit.py): add `event_type` (str), `job_id` (UUID|None), rename `invocation_id`→`parent_invocation_id`; make `runtime_type`/`skill_version`/`skill_id`/`outcome` `| None`. Add the `metadata` JSONB column — **but the Python attribute CANNOT be named `metadata`** (reserved on `DeclarativeBase` at [base.py:15](velara-api/app/models/base.py#L15)). Name the attribute `event_metadata` mapped to DB column `"metadata"`: `event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)`.
  - [x] Update the composite PK to `(id, created_at)` in `__table_args__` / `mapped_column(primary_key=True)` on both `id` and `created_at`.
  - [x] Add stable `event_type` constants near the existing `OUTCOME_*`/`RUNTIME_*` constants: e.g. `EVENT_INVOCATION_SUCCESS="invocation.success"`, `..._FAILURE="invocation.failure"`, `..._CANCELLED="invocation.cancelled"`, `..._BLOCKED="invocation.blocked"`, `EVENT_INVOCATION_FAN_OUT="invocation.fan_out"`, `EVENT_ADMIN_GRANT_CREATED`/`_REVOKED`, `EVENT_ADMIN_LIFECYCLE_TRANSITION`, `EVENT_ADMIN_CERTIFICATION` (align exact strings with the epic ACs: fan-out parent = `invocation.fan_out`; else `invocation.<outcome>`; admin = `admin.*`).

- [x] **Task 3 — Service: `record_invocation` (rename) + `record_admin_action` (new) + token forwarding (AC: #2, #3, #4, #7)**
  - [x] [app/services/audit_service.py](velara-api/app/services/audit_service.py): **rename `record_entry`→`record_invocation`** (and `record_entry_sync`→`record_invocation_sync`) and update **all 5 callers** (see call-site list in Dev Notes). Add an `event_type` derivation: `invocation.fan_out` when `fan_out=True`, else `invocation.<outcome>`.
  - [x] Add a `metadata: dict | None = None` (or explicit `input_tokens`/`output_tokens`/`model`) parameter to `record_invocation`, written into the new `event_metadata` column. Keep the existing `VALID_OUTCOMES`/`VALID_RUNTIME_TYPES` validation, but allow `outcome=None`/`runtime_type=None` for admin events (validation only when non-None).
  - [x] Add `record_admin_action(*, session, event_type, user_id, hierarchy_path, metadata=None, ...)` writing an entry with `runtime_type=None`, `skill_id=None`, `skill_version=None`, `outcome=None`. Provide a `_sync` wrapper mirroring the existing pattern.
  - [x] **Token forwarding:** in the two success/blocked call sites in [execution_tasks.py:219,239](velara-api/app/workers/execution_tasks.py#L219), `result_metadata` is already in scope right beside the audit call — extract `{"input_tokens","output_tokens","model"}` from it (present only for prompt/hybrid runs; absent for code runs) and pass into `record_invocation`'s metadata. Do NOT invent tokens for code runs; forward only what `result_metadata` actually contains. See the exact keys in Dev Notes (execution_service writes `input_tokens`/`output_tokens`/`model`).

- [x] **Task 4 — Wire `record_admin_action` into the admin surfaces (AC: #7)**
  - [x] `access_service.create_grant` / `revoke_grant` → `record_admin_action(event_type="admin.grant_created"/"admin.grant_revoked", ...)` with grantee `user_id`/node in metadata. (These are the 8.1/8.5 grant mutations.)
  - [x] `skill_service.transition_lifecycle` ([skill_service.py:479](velara-api/app/services/skill_service.py#L479)) → `admin.lifecycle_transition` with from/to state in metadata.
  - [x] `certification_service.record_certification` ([certification_service.py:116](velara-api/app/services/certification_service.py#L116)) → `admin.certification` with key type in metadata.
  - [x] Keep these writes **best-effort / non-blocking of the primary mutation** where the existing code already commits the mutation first — do not let an audit-write failure roll back a successful grant/transition (match the existing invocation-audit ordering, which records after the state change).

- [x] **Task 5 — Tests (AC: #1–#7)**
  - [x] Migration test: table is partitioned (`pg_partitioned_table` / `relkind='p'`), composite PK present, append-only trigger rejects UPDATE/DELETE across a partition (red-then-green: an UPDATE raises), `down`→`up` clean on fresh `velara_test`.
  - [x] `record_invocation`: writes `event_type` correctly (fan-out parent = `invocation.fan_out`; child carries `parent_invocation_id`; success/failure/blocked/cancelled map to `invocation.<outcome>`); token metadata present for a prompt/hybrid run, absent for a code run.
  - [x] `record_admin_action`: writes an `admin.*` entry with nullable runtime_type/outcome/skill fields; grant create/revoke + lifecycle transition + certification each produce their audit entry.
  - [x] Integration: a real prompt-skill invocation end-to-end produces an audit entry whose `metadata` carries the same `input_tokens`/`output_tokens` the run recorded in `result_metadata` (proves the forwarding wire).
  - [x] Run on live Postgres (the partition + trigger behavior is meaningless against a mock — Epic 6/8 test-integrity lesson: compliance/security-critical paths run against real infra). Rebuild the api image before pytest if it bakes source.

- [x] **Task 6 — Gates & handoff**
  - [x] `ruff check`/`format` clean; migration up/down verified; append-only trigger proven at DB level; token-forwarding integration test green.
  - [x] Handoff note for 9.2 (query API reads this schema — `event_type`/`metadata`/`parent_invocation_id`/partition pruning) and 9.4 (derives cost from `metadata.input_tokens`/`output_tokens` × per-model price; **9.4 owns pricing**).

## Dev Notes

### Why this story now carries token usage (Project Lead directive, 2026-07-02)

Token/cost tracking for skill executions was raised as an Epic-9 need. Audit of the current code (source-verified 2026-07-02):

- **Token counts ARE already captured** from the Anthropic SDK `response.usage` in [anthropic_client.py](velara-api/app/integrations/anthropic_client.py) (`input_tokens`/`output_tokens` on `LLMResult`/`LLMTurn`), flow into [execution_service.py](velara-api/app/services/execution_service.py) `runtime_metadata` (prompt run ~L481-490: `input_tokens`/`output_tokens`/`model`; hybrid ~L935-944: summed across tool turns), and land in `InvocationResult.result_metadata` JSONB ([invocation.py:182](velara-api/app/models/invocation.py#L182)). They are also structured-logged.
- **They are NOT queryable** — only inside the free-form `result_metadata` blob, never in a column, never in the audit log.
- **Dollar cost does NOT exist anywhere** — no pricing/tiktoken/cost concept in the backend at all.
- **Pure `code` runs have no LLM tokens** (`code_driven_executor.py`/`code_driven_hybrid.py` have zero LLM references).

**Decision (Project Lead):** 9.1 forwards the already-captured tokens into the new audit `metadata` JSONB (near-trivial — `result_metadata` sits beside the `record_invocation` call). **Cost is deferred to 9.4** (analytics), which derives it from these counts and owns the pricing table/config. This is the Epic-8-retro checklist applied: 9.1 records the field its consumer (9.4) needs, so 9.4 isn't a discovered gap.

### The audit schema evolution (the core of this story)

Today's `AuditLogEntry` ([audit.py](velara-api/app/models/audit.py)) is **invocation-only**, non-partitioned, single-column `id` PK, with a fixed column set and NO `metadata`/`event_type`/`job_id`. Migration [0006](velara-api/app/db/migrations/versions/0006_audit_log_entries.py) created it with the append-only trigger (`reject_audit_mutation()` — row-level `BEFORE UPDATE OR DELETE` + statement-level `BEFORE TRUNCATE`). 0006's own docstring even flags "Monthly partitioning is a Phase 2 operational concern" — **this story is that Phase 2.**

Partitioning gotchas the dev MUST handle (these are where partitioned-table migrations fail):
- **Composite PK** `(id, created_at)` — the range key must be in every unique key. Single-column `id` PK will be rejected.
- **Row triggers propagate to partitions (PG11+); TRUNCATE statement-triggers do NOT** — attach TRUNCATE protection per-partition or accept the row-trigger + operational note.
- **A missing partition for the insert month raises** — provision current + a few future months, or a default partition, so writes don't fail.
- **Inbound FKs to a partitioned table are disallowed / limited** — keep `parent_invocation_id` a plain indexed UUID (not a real self-FK); verify the outbound `skill_id`/`job_id` FKs create cleanly against the partitioned parent, else demote to plain indexed columns and note it.

### The `metadata` reserved-word trap

`Base(DeclarativeBase)` ([base.py:15](velara-api/app/models/base.py#L15)) → `Base.metadata` is SQLAlchemy's schema registry. **You cannot name a mapped attribute `metadata`.** Map the DB column `"metadata"` to a Python attribute named `event_metadata`:
```python
event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
```

### The 5 `record_entry` callers to rename (all must update)

- [execution_tasks.py:219](velara-api/app/workers/execution_tasks.py#L219) (blocked), [:239](velara-api/app/workers/execution_tasks.py#L239) (success), [:297](velara-api/app/workers/execution_tasks.py#L297) (failure), [:540](velara-api/app/workers/execution_tasks.py#L540) (a fan-out/other path — verify) — the **success + blocked** sites have `result_metadata` in scope → thread tokens here. The **failure** site (fresh `fail_session`) and **cancelled** site have no result_metadata (no tokens produced) — pass no token metadata.
- [job_service.py:307](velara-api/app/services/job_service.py#L307) (cancellation) — no tokens (cancelled before/without completion).

### Token keys to extract (exact, from execution_service)

`result_metadata` for prompt/hybrid runs contains `input_tokens`, `output_tokens`, `model` (hybrid also `tool_turns`/`tool_calls`/`stop_reason`; prompt also `char_count`/`stop_reason`/`format`). Forward at minimum `input_tokens`, `output_tokens`, `model` into audit `metadata`. Guard with `.get()` — a code run's `result_metadata` won't have them, and that's correct (absent, not zero).

### Append-only discipline (unchanged, must survive the rewrite)

`audit_service` remains the ONLY writer; never UPDATE/DELETE. The DB trigger is the backstop (Epic 6's lesson: enforce Part 11 immutability at the DB layer, not just app code — and TEST it with a real UPDATE that raises, not a route-level 405). Preserve/recreate `reject_audit_mutation()` and prove it across a partition in Task 5.

### Project Structure Notes

- Files touched: `app/db/migrations/versions/0018_*.py` (NEW), `app/models/audit.py`, `app/services/audit_service.py`, `app/workers/execution_tasks.py` (rename + token forward), `app/services/job_service.py` (rename), `app/services/access_service.py` + `skill_service.py` + `certification_service.py` (record_admin_action wiring), plus tests.
- No FE in this story (9.3 is the audit UI; 9.2 the query API).
- Migration is **0018**. `metadata` attribute → `event_metadata`. Composite PK `(id, created_at)`.

### References

- [Source: epics/epic-9-audit-log-usage-analytics.md#Story 9.1] — the 6 ACs (partitioned schema, invocation write, fan-out, append-only, Part 11, admin actions).
- [Source: architecture/core-architectural-decisions.md] — "Audit log | PostgreSQL append-only table, partitioned monthly" (L9); Part 11 §11.10(e) audit-trail obligation mapped to Epic 9 (L94); async job-based execution is auditable by design (L37).
- [Source: velara-api/app/models/audit.py] — current invocation-only schema to evolve.
- [Source: velara-api/app/services/audit_service.py] — `record_entry`/`record_entry_sync` to rename + extend; `VALID_OUTCOMES`/`VALID_RUNTIME_TYPES`.
- [Source: velara-api/app/db/migrations/versions/0006_audit_log_entries.py] — the append-only trigger (`reject_audit_mutation`, row + TRUNCATE) to recreate; FK + index patterns.
- [Source: velara-api/app/workers/execution_tasks.py#L219-L309] — the invocation audit call sites (success/blocked/failure); `result_metadata` in scope for token forwarding.
- [Source: velara-api/app/services/job_service.py#L307] — cancellation audit call site.
- [Source: velara-api/app/integrations/anthropic_client.py] — `response.usage` → `input_tokens`/`output_tokens`/`model` (source of token counts).
- [Source: velara-api/app/services/execution_service.py ~L481-490 (prompt), ~L935-944 (hybrid)] — where tokens land in `result_metadata`.
- [Source: velara-api/app/models/invocation.py#L182] — `InvocationResult.result_metadata` JSONB (current token home).
- [Source: velara-api/app/models/base.py#L15] — `Base(DeclarativeBase)` → `metadata` reserved (use `event_metadata`).
- [Source: velara-api/app/db/migrations/versions/0017_skill_attachment.py] — confirms next migration is 0018.
- Forward-deps: **9.2** (query API reads `event_type`/`metadata`/`parent_invocation_id` + partition pruning); **9.4** (derives cost = tokens × per-model price; owns pricing config — 9.1 only records raw counts).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Migration 0018 verified against live Postgres 16 (docker compose `postgres` service): `alembic upgrade head` from `0017_skill_attachment` clean; `\d audit_log_entries` confirmed partitioned table, composite PK `(id, created_at)`, 6 partitions (5 monthly + `_default`); `alembic downgrade 0017_skill_attachment` restored the exact 0006 non-partitioned shape; re-upgraded to head.
- Manual UPDATE/TRUNCATE against a live row both raised `audit_log_entries is append-only: <OP> not permitted` — append-only trigger holds on the partitioned parent.
- `AUTH_BACKEND` in the running dev container defaults to `cognito` (not `dev`), which 401's `DevAuthProvider`-issued tokens — all API-driven integration tests must run with `-e AUTH_BACKEND=dev` (matches the existing `test_access_grants.py` convention; not a regression, just an environment note for the next dev).
- `test_ingest.py` (`test_confirm_unsupported_content_type_returns_422`, `test_presign_upload_confirm_parse_happy_path_docx`, `test_presign_upload_confirm_parse_happy_path_xlsx`) fail in this dev container on a presigned-PUT `ConnectError` — pre-existing environment issue (localhost/minio hostname mismatch inside the container), unrelated to `audit_log_entries`; confirmed unrelated by inspecting the failing assertions (real MinIO PUT calls, no audit table involved).
- `docker compose exec api pytest` requires the api image rebuilt first (it bakes source) — rebuilt `api`+`worker` images before the final full-suite run.

### Completion Notes List

- Migration 0018 drops and recreates `audit_log_entries` as `PARTITION BY RANGE (created_at)` with composite PK `(id, created_at)`, 5 initial monthly partitions (2026-06 through 2026-10) + a `DEFAULT` catch-all, and a per-partition `BEFORE TRUNCATE` trigger (the row-level append-only trigger on the parent propagates to partitions automatically; the statement-level TRUNCATE trigger does not, per PG limitation — documented in the migration docstring). Downgrade restores the exact pre-0018 (0006) shape.
- `AuditLogEntry` (app/models/audit.py) evolved to a general event log: new `event_type` (NOT NULL), `job_id` (nullable, plain indexed column), `event_metadata` (maps to DB column `metadata`, since `metadata` is reserved by `DeclarativeBase`); `skill_id`/`skill_version`/`runtime_type`/`outcome` now nullable for admin events; `invocation_id` renamed to `parent_invocation_id`. Added `EVENT_INVOCATION_*` and `EVENT_ADMIN_*` constants plus an `OUTCOME_TO_EVENT_TYPE` map.
- `audit_service.record_entry`/`record_entry_sync` renamed to `record_invocation`/`record_invocation_sync` (all 5 call sites updated: `execution_tasks.py` success/blocked/failure/fan-out-aggregate, `job_service.py` cancellation); `record_invocation` now derives `event_type` (`invocation.fan_out` when `fan_out=True`, else `invocation.<outcome>`) and accepts an optional `metadata` dict. New `record_admin_action`/`record_admin_action_sync` write `admin.*` entries with all invocation-only fields NULL.
- Token forwarding: `execution_tasks.py` gained `_extract_token_metadata()`, which pulls `input_tokens`/`output_tokens`/`model` out of `result_metadata` when present (prompt/hybrid runs) and returns `None` (not `{}`) when absent (code runs) — wired into both the success and blocked call sites, which are the two sites where `result_metadata` is in scope.
- `record_admin_action` wired into: `access_service.create_grant`/`revoke_grant` (`admin.grant_created`/`admin.grant_revoked`; `revoke_grant` gained a new required `revoked_by_user_id` parameter — threaded from the route's `user.user_id` — since the prior signature had no actor to attribute the revoke to), `skill_service.transition_lifecycle` (`admin.lifecycle_transition`, hierarchy_path=`"org"` since skills are org-global), `certification_service.record_certification` (`admin.certification`). All three writes are wrapped in `try/except` after the primary mutation's commit so an audit-write failure never rolls back the mutation (logged as a warning instead).
- Tests: extended `tests/unit/services/test_audit_service.py` (new schema/constant assertions + `_extract_token_metadata` unit tests, all pure/no-DB) and added `tests/integration/services/test_audit_service.py` (16 new tests against live Postgres covering AC1/AC2/AC3/AC5/AC6/AC7, including 4 tests that exercise the admin wiring end-to-end through the real `/api/v1/access-grants`, `/api/v1/skills/{id}/lifecycle`, and `/api/v1/certifications` routes rather than calling the service function directly). Updated pre-existing tests that referenced the old `record_entry` name or the old `invocation_id` column (`tests/integration/workers/test_execution_tasks.py`, `tests/integration/api/test_invocations.py`).
- Gates: `ruff check`/`ruff format --check` clean on all touched files; full test suite 967 passed / 3 pre-existing failures (unrelated `test_ingest.py` MinIO presign issue, confirmed not a regression); migration `downgrade`→`upgrade` verified clean on a freshly created `velara_test`.
- Handoff for 9.2/9.4 confirmed in Dev Notes: 9.2 (query API) reads `event_type`/`metadata`/`parent_invocation_id` + benefits from partition pruning on `created_at` range filters; 9.4 (analytics) derives cost from `metadata.input_tokens`/`output_tokens` × a per-model price it owns — 9.1 only records the raw counts.

### File List

- velara-api/app/db/migrations/versions/0018_partition_audit_log.py (NEW)
- velara-api/app/models/audit.py
- velara-api/app/services/audit_service.py
- velara-api/app/services/access_service.py
- velara-api/app/services/skill_service.py
- velara-api/app/services/certification_service.py
- velara-api/app/workers/execution_tasks.py
- velara-api/app/services/job_service.py
- velara-api/app/api/v1/access_grants.py
- velara-api/tests/unit/services/test_audit_service.py
- velara-api/tests/integration/services/test_audit_service.py (NEW)
- velara-api/tests/integration/workers/test_execution_tasks.py
- velara-api/tests/integration/api/test_invocations.py
