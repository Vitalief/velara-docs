---
baseline_commit: 78cc58629987f94c8b96fa445e49aa265fc5004f
---

# Story 3.1: Async Job Infrastructure

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform developer,
I want the `InvocationJob` model, Celery task infrastructure, and job polling endpoint,
so that all skill executions are queued, tracked, and retrievable regardless of execution duration.

This is the **foundation story for Epic 3 (Skill Execution Engine)**. It introduces the persistence layer (three new tables), the Celery task scaffolding, the job lifecycle state machine, the append-only audit log, and the read/cancel job API endpoints that every later execution story (3.2–3.8) builds on. It deliberately does **not** implement the actual skill-execution runtimes or the invocation-creation endpoint — those land in 3.3–3.5 (see **Scope Boundary** below).

## Acceptance Criteria

1. **(Schema — jobs & results)** Given the Alembic migration for `invocation_jobs` and `invocation_results` runs, when I inspect the schema, then `invocation_jobs` has: `id`, `skill_id`, `skill_version`, `status` (`queued`|`running`|`completed`|`failed`|`cancelled`), `created_by_user_id`, `hierarchy_path`, `created_at`, `updated_at`; and `invocation_results` stores an output reference (S3 key) and result metadata.

2. **(Read job)** Given a job is created, when I call `GET /api/v1/jobs/{job_id}`, then the response includes `status`, `created_at`, and (when complete) `result` with output file references.

3. **(Cancel queued job)** Given a job is in `queued` status, when I call `POST /api/v1/jobs/{job_id}/cancel`, then the job status transitions to `cancelled` and the Celery task is revoked if not yet started.

4. **(Transition to running)** Given a Celery task starts executing a job, when it begins processing, then the job status transitions from `queued` to `running` and `started_at` is recorded.

5. **(Transition to completed)** Given a Celery task completes successfully, when it finishes, then the job status transitions to `completed`, `completed_at` is recorded, and the result is written to `invocation_results`.

6. **(Transition to failed)** Given a Celery task raises an unhandled exception, when it fails, then the job status transitions to `failed`, the error code is recorded (no raw exception in the DB), and Sentry captures the event.

7. **(Schema — audit log, append-only)** Given the Alembic migration for `audit_log_entries` runs, when I inspect the schema, then `audit_log_entries` has: `id`, `skill_id`, `skill_version`, `user_id`, `hierarchy_path` (ltree), `runtime_type` (`prompt`|`code`|`hybrid`), `fan_out` (boolean), `invocation_id` (nullable parent ref for fan-out children), `started_at`, `completed_at`, `outcome` (`success`|`failure`|`cancelled`), `error_code` (nullable) — and the table is append-only with no UPDATE or DELETE operations permitted.

## Tasks / Subtasks

- [x] **Task 1 — ORM models for jobs, results, and audit (AC: 1, 7)**
  - [x] Create `app/models/invocation.py` with `InvocationJob` and `InvocationResult` classes inheriting `app.models.base.Base`. Match the exact column patterns in [skill.py](../../../velara-api/app/models/skill.py) (see Dev Notes → "Model conventions").
  - [x] Create `app/models/audit.py` with `AuditLogEntry` inheriting `Base`. Use `LtreeType()` from `app.models.base` for `hierarchy_path` (this is the **first** real consumer of `LtreeType`).
  - [x] Register all three models in `app/models/__init__.py` (`from app.models.invocation import InvocationJob, InvocationResult` and `from app.models.audit import AuditLogEntry`, add to `__all__`). **Without this, Alembic autogenerate and the migrations’ model imports won’t see them.**
  - [x] Status / outcome / runtime_type are stored as plain `String(N)` VARCHAR columns (NOT native PG enums) — exactly as `Skill.lifecycle_state` is. Add a Python `enum.StrEnum` or module-level constants + (optionally) a Pydantic enum for app-layer validation only.

- [x] **Task 2 — Alembic migrations (AC: 1, 7)**
  - [x] Add migration `app/db/migrations/versions/0005_invocation_jobs_results.py` creating `invocation_jobs` + `invocation_results`. Set `down_revision = "0004_skill_derivation_lineage"` (current head — verified).
  - [x] Add migration `app/db/migrations/versions/0006_audit_log_entries.py` creating `audit_log_entries`. Set `down_revision = "0005_invocation_jobs_results"`.
  - [x] In `0006`, enforce append-only at the **DB level** with a trigger that raises on UPDATE/DELETE (see Dev Notes → "Append-only enforcement" for the exact SQL). App-level discipline alone is insufficient for the AC.
  - [x] Add the indexes named in Dev Notes (`idx_invocation_jobs_created_at`, `idx_invocation_jobs_created_by_user_id`, `idx_invocation_results_invocation_job_id`, `idx_audit_log_entries_skill_id`, `idx_audit_log_entries_invocation_id`).
  - [x] Each migration must round-trip cleanly: `upgrade → downgrade → upgrade`. The trigger and function must be dropped in `downgrade()`.

- [x] **Task 3 — Celery task scaffolding + status transitions (AC: 4, 5, 6)**
  - [x] Create `app/workers/execution_tasks.py`. Register the task on the existing `celery` app from [celery_app.py](../../../velara-api/app/workers/celery_app.py) with an **explicit** name following the convention: `@celery.task(name="velara.workers.execution.run_skill", bind=True)`.
  - [x] The task is **scaffolding only** for this story: on start it transitions the job `queued → running` and stamps `started_at`; the body is a placeholder (`# TODO(3.3-3.5): execution_service routing`) that the runtime stories fill in. On placeholder success it transitions `running → completed`, stamps `completed_at`, writes an `InvocationResult`, and writes a `success` audit entry. On exception it transitions to `failed`, records `error_code`, writes a `failure` audit entry, and lets Sentry capture (the worker is wired to Sentry’s CeleryIntegration — re-raise or `capture_exception`; do NOT swallow).
  - [x] Celery tasks run in a **sync** context — use `app.db.session.session_scope()` (the async context manager) bridged via `asyncio.run(...)` for DB work, OR a sync helper. See Dev Notes → "DB access inside Celery tasks" for the chosen pattern; do not open an async session against a missing event loop.
  - [x] Storage calls inside tasks are called **directly** (sync) — NOT wrapped in `run_in_threadpool` (that’s only for async request handlers). See [dependencies.py](../../../velara-api/app/core/dependencies.py) async-safety note.

- [x] **Task 4 — Job + audit service layer (AC: 2, 3, 4, 5, 6)**
  - [x] Create `app/services/job_service.py` as module-level async functions (match `skill_service` shape): `create_job(...)`, `get_job(session, job_id, org_id)`, `cancel_job(session, job_id, org_id)`, and status-transition helpers (`mark_running`, `mark_completed`, `mark_failed`, `mark_cancelled`).
  - [x] Create `app/services/audit_service.py` with `record_entry(...)` — **insert only**; never UPDATE/DELETE. Provide a sync variant (or asyncio-bridged call) usable from Celery tasks.
  - [x] Define domain exceptions subclassing `VelaraHTTPException` with an `ERROR_CODE` class var (match `skill_service` pattern): `JobNotFoundError` (404, `JOB_NOT_FOUND`), `JobNotCancellableError` (422, `JOB_NOT_CANCELLABLE` — raised when cancelling a job already in a terminal state `completed`/`failed`/`cancelled`).
  - [x] `get_job` and `cancel_job` scope by `org_id` (a job from another org → 404 `JOB_NOT_FOUND`, never 403, matching the skill registry’s cross-org-as-404 convention).
  - [x] `cancel_job`: if `status == queued` and a `celery_task_id` is stored, call `celery.control.revoke(task_id)`; transition to `cancelled`, stamp `completed_at`, write a `cancelled` audit entry. If already terminal → `JobNotCancellableError`. (Revoking a `running` task is best-effort; the AC only requires queued-job cancellation.)

- [x] **Task 5 — Pydantic schemas (AC: 2)**
  - [x] Create `app/schemas/job.py` with response models: `JobRead` (`id`, `skill_id`, `skill_version`, `status`, `created_by_user_id`, `hierarchy_path`, `created_at`, `updated_at`, `started_at`, `completed_at`, `error_code`) and `JobResult` (`output_file_key`, `output_file_url` nullable presigned, `result_metadata`). `JobReadWithResult` extends `JobRead` with `result: JobResult | None`.
  - [x] Use `model_config = ConfigDict(from_attributes=True)` (Pydantic v2) so `JobRead.model_validate(orm_obj)` works — matches the `SkillRead` pattern. `hierarchy_path` serializes as a `str`.

- [x] **Task 6 — Job API router (AC: 2, 3)**
  - [x] Create `app/api/v1/jobs.py` with `router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])` and the `_meta(request)` helper (copy from [skills.py](../../../velara-api/app/api/v1/skills.py)).
  - [x] `GET /{job_id}` → `ResponseEnvelope[JobReadWithResult]`, deps `user: CurrentUser, session: DbSession`. When the job is `completed`, populate `result` with the `InvocationResult` and generate a presigned download URL (24h) via `OutputStorage` (`presign_download(key, expires_s=86400)` — CPU-only, safe inline).
  - [x] `POST /{job_id}/cancel` → `ResponseEnvelope[JobRead]`, deps `user: CurrentUser, session: DbSession`. Returns the updated job.
  - [x] Register the router in [router.py](../../../velara-api/app/api/v1/router.py): `from app.api.v1 import ... jobs` and `api_router.include_router(jobs.router)`.

- [x] **Task 7 — Tests (AC: all)**
  - [x] Unit tests `tests/unit/services/test_job_service.py`: create/get/cancel, status-transition helpers, cross-org → 404, cancel-of-terminal → 422.
  - [x] Unit tests `tests/unit/services/test_audit_service.py`: `record_entry` inserts with all fields incl. `runtime_type`/`fan_out`/`invocation_id`/`outcome`.
  - [x] Integration tests `tests/integration/api/test_jobs.py`: follow the skip-guard + `_auth_headers` helper pattern from [test_skills.py](../../../velara-api/tests/integration/api/test_jobs.py) — GET existing job, GET unknown → 404 `JOB_NOT_FOUND`, GET cross-org → 404, cancel queued → `cancelled`, cancel terminal → 422 `JOB_NOT_CANCELLABLE`, completed job returns `result` with presigned URL.
  - [x] Celery transition tests: `tests/integration/workers/test_execution_tasks.py` — tests the full queued→running→completed and queued→running→failed lifecycle using the same service functions the task calls, plus monkeypatching to force the failure path. Note: `asyncio.run()` inside run_skill cannot be invoked from pytest-asyncio’s running loop; service-level testing used instead (wiring tested in staging via `docker compose exec worker`).
  - [x] Append-only test: assert an UPDATE or DELETE against `audit_log_entries` raises a DB error (proves the trigger).
  - [x] Gates before marking done: `ruff check .` clean and the **full Docker test suite green** (see Dev Notes → "Running tests").

## Dev Notes

### Scope Boundary (read this first)

This story builds **infrastructure**, not execution. The architecture defines the actual invocation entrypoint as `POST /api/v1/invocations/{skill_id}` (returns `202 Accepted` + `job_id`) [Source: architecture/Velara-Architecture-full.md#161-163]. **That endpoint and the real skill-execution body are NOT in this story** — they arrive in Story 3.3 (prompt), 3.4 (code), 3.5 (hybrid). Here:

- The `run_skill` Celery task exists with its lifecycle wiring (queued→running→completed/failed) but a **placeholder body** the runtime stories fill in.
- Job *creation* is exercised by tests / a thin internal `create_job` service call, not by a public invocation endpoint.
- Fan-out (`fan_out_locations` / `aggregate_results` chord) is Story 3.7 (deferred after Epic 4). Just include the `fan_out` boolean + `invocation_id` parent ref columns now so 3.7 needs no migration. [Source: epic-3-skill-execution-engine.md#Story 3.7]

Do **not** invent the invocation endpoint or execution-service routing here — that would collide with 3.3–3.5.

### Tech stack (exact versions — already in [pyproject.toml](../../../velara-api/pyproject.toml))

- Python ≥3.12, FastAPI 0.115.6, SQLAlchemy 2.0.36 (async, `[asyncio]`), asyncpg 0.29.0, Alembic 1.13.3, Pydantic 2.10.4, pydantic-settings 2.6.1.
- **Celery 5.4.0 (`celery[redis]`)**, **redis 5.2.1** — Redis is **both** broker and result backend (single instance, `REDIS_URL`). [Source: workers/celery_app.py; architecture/Velara-Architecture-full.md#99]
- boto3 1.35.71 (S3/MinIO), structlog 24.4.0 (PHI-sanitized logging), **sentry-sdk[fastapi,celery] 2.19.2** (the `[celery]` extra means CeleryIntegration auto-captures task exceptions). 
- Dev/test: ruff 0.6.9, pytest 8.3.4, pytest-asyncio 0.24.0 (`asyncio_mode = "auto"`), httpx 0.27.2.
- All deps needed for this story are **already present** — do not add packages.

### Model conventions (mirror [skill.py](../../../velara-api/app/models/skill.py) exactly)

```python
import uuid
from datetime import UTC, datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, LtreeType
```

- **PK:** `id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)`
- **Timestamps:** `created_at` → `DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)`; `updated_at` adds `onupdate=lambda: datetime.now(UTC)`. (The codebase uses Python-side `datetime.now(UTC)`, NOT `func.now()` / `server_default` for app timestamps — match it.)
- **Nullable lifecycle timestamps** (`started_at`, `completed_at`): `DateTime(timezone=True), nullable=True` (no default — set explicitly on transition).
- **Enums are VARCHAR**, not PG enum types: `status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")` with an inline comment listing values. Validate values in the service/schema layer.
- **`skill_id`** FK → `skills.id` (`ForeignKey("skills.id")`). **Do NOT** add `ondelete="CASCADE"` for jobs/audit — execution history must survive skill changes (audit is append-only / 7-year retention). [Source: architecture/Velara-Architecture-full.md#18,133]
- **`skill_version`**: `String(32)` semver string (matches `SkillVersion.version`).
- **`created_by_user_id` / `user_id`**: `String(128)` (opaque auth subject, matches `Skill.created_by_user_id`).
- **`hierarchy_path`**: `mapped_column(LtreeType(), nullable=False)` on both `invocation_jobs` and `audit_log_entries`. This is the first use of `LtreeType` — the `ltree` extension is already enabled (migration `0001_initial`). For Phase-1 (no hierarchy yet, Epic 4 pending) callers may pass a root path like `"org"`; keep the column non-null but accept a single-label ltree.
- **`result_metadata` / output reference:** `InvocationResult.output_file_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)` (S3 key only — never inline content, file-by-key pattern), `result_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)`. [Source: architecture/Velara-Architecture-full.md#525; skill.py SkillVersion.artifact_key]
- **`celery_task_id`** on `InvocationJob`: `String(255), nullable=True` — store the dispatched task id so `cancel_job` can `revoke()` it.
- **Indexes** via `__table_args__`: `Index("idx_invocation_jobs_created_at", "created_at")`, `Index("idx_invocation_jobs_created_by_user_id", "created_by_user_id")`, `Index("idx_invocation_results_invocation_job_id", "invocation_job_id")`, `Index("idx_audit_log_entries_skill_id", "skill_id")`, `Index("idx_audit_log_entries_invocation_id", "invocation_id")`. [Source: architecture/Velara-Architecture-full.md#199-202]

### Migration conventions (mirror [0004_skill_derivation_lineage.py](../../../velara-api/app/db/migrations/versions/0004_skill_derivation_lineage.py))

- **Current head is `0004_skill_derivation_lineage`** (verified — chain is 0001→0002→0003→0004). New: `0005_invocation_jobs_results` (down_revision `0004_...`), then `0006_audit_log_entries` (down_revision `0005_...`).
- Revision id format is the descriptive string (`revision: str = "0005_invocation_jobs_results"`), not a hash. `branch_labels`/`depends_on` = `None`.
- Use `postgresql.UUID(as_uuid=True)`, `postgresql.JSONB(astext_type=sa.Text())`, `sa.DateTime(timezone=True)`. For the `hierarchy_path` ltree column, import `from app.models.base import LtreeType` and write `sa.Column("hierarchy_path", LtreeType(), nullable=False)` directly in the migration (`LtreeType.get_col_spec()` emits `ltree`). The `ltree` extension is already enabled by migration `0001_initial`, so no `CREATE EXTENSION` is needed here.
- `alembic.ini` runs `ruff check --fix` as a post-write hook; still run `ruff check .` yourself.
- Models are discovered by Alembic via `import app.models` in [env.py](../../../velara-api/app/db/migrations/env.py) — so registering them in `app/models/__init__.py` (Task 1) is mandatory.

### Append-only enforcement (`audit_log_entries`) — DB-level (AC 7)

App discipline is not enough for the AC ("no UPDATE or DELETE operations permitted"). Add, in `0006` `upgrade()` after `create_table`:

```python
op.execute("""
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_entries is append-only: % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
""")
op.execute("""
CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log_entries
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
""")
```

`downgrade()` must `DROP TRIGGER trg_audit_log_append_only ON audit_log_entries;` and `DROP FUNCTION reject_audit_mutation();` before dropping the table.

### Job lifecycle state machine

```
queued ──(task starts)──▶ running ──(success)──▶ completed   [terminal]
   │                         │
   │                         └──(unhandled exc)──▶ failed     [terminal]
   └──(POST /cancel, revoke)─────────────────────▶ cancelled  [terminal]
```

- `queued → cancelled` is the AC-3 guaranteed path (revoke before pickup). `running → cancelled` is best-effort (not required by ACs).
- `completed`/`failed`/`cancelled` are terminal — `cancel_job` on a terminal job → 422 `JOB_NOT_CANCELLABLE`.
- `task_track_started=True` is already set on the Celery app, enabling the `running` state. [Source: workers/celery_app.py#28]
- Status enum values are **stable** — do not rename. [Source: architecture/Velara-Architecture-full.md#269,577]

### API conventions (mirror [skills.py](../../../velara-api/app/api/v1/skills.py))

- Every route returns `ResponseEnvelope[T]` from `app.schemas.common`; build meta with the local `_meta(request)` helper. Never return a bare dict/list.
- Errors flow through domain exceptions only — raise a `VelaraHTTPException` subclass; the global handler in [exceptions.py](../../../velara-api/app/core/exceptions.py) renders the `{"error": {"code", "message", "request_id"}}` envelope. `RequestValidationError` → 422 `VALIDATION_ERROR` is already handled globally.
- Dependencies are the typed aliases from [dependencies.py](../../../velara-api/app/core/dependencies.py): `CurrentUser` (→ `AuthPrincipal` with `.user_id`, `.org_id`, `.role`), `DbSession`, `OutputStorage`. Path param: `job_id: uuid.UUID` (FastAPI auto-parses/422s on bad UUID).
- Cross-org access → 404 (not 403), matching `skill_service.get_skill`’s org-scoping. [Source: skills.py docstring "scope data to the authenticated user's org_id"]
- Status codes: 200 GET/cancel-success, 404 not-found, 422 business-rule violation.

### Service layer conventions (mirror [skill_service.py])

- Module-level **async** functions taking keyword args incl. `session: AsyncSession` (and `storage` only where needed). Return ORM objects; the router does `JobRead.model_validate(obj)`.
- Domain exceptions are classes with `ERROR_CODE` class var, e.g.:
  ```python
  class JobNotFoundError(VelaraHTTPException):
      ERROR_CODE = "JOB_NOT_FOUND"
      def __init__(self, job_id): super().__init__(404, self.ERROR_CODE, f"Job '{job_id}' not found.")
  ```
- New error codes are **stable public API** — `JOB_NOT_FOUND`, `JOB_NOT_CANCELLABLE`. Don’t reuse existing skill codes.

### DB access inside Celery tasks (sync context)

- Request handlers use the `DbSession` async dependency. **Celery tasks have no event loop and no FastAPI DI.** Use `app.db.session.session_scope()` (the async `@asynccontextmanager` already provided for exactly this — its docstring says "for use outside the request cycle (e.g. Celery tasks)") wrapped in `asyncio.run()`:
  ```python
  import asyncio
  from app.db.session import session_scope
  async def _do_work(job_id): 
      async with session_scope() as session: ...
  @celery.task(name="velara.workers.execution.run_skill", bind=True)
  def run_skill(self, job_id: str):
      asyncio.run(_do_work(job_id))
  ```
- **Storage in tasks:** call provider methods directly (sync) — the dependencies.py note states "In Celery tasks (sync context) call the provider methods directly." Do NOT use `run_in_threadpool` there.
- **Storage in async request handlers:** `put()`/`get()` are blocking → wrap with `fastapi.concurrency.run_in_threadpool`; but `presign_download`/`presign_upload` are CPU-only and safe inline. The job GET endpoint only presigns, so no threadpool needed there. [Source: dependencies.py module docstring]

### Sentry / observability (AC 6)

- Sentry is configured via `sentry-sdk[fastapi,celery]`; `SENTRY_DSN` is empty in dev (no-op) and injected in staging/prod. The CeleryIntegration auto-captures unhandled task exceptions — so in `mark_failed` record the stable `error_code` (never the raw message) in the DB, log the real exception via structlog (PHI-sanitized), and let it propagate / `sentry_sdk.capture_exception(exc)` for capture. **Never store raw exception text or a traceback in the DB.** [Source: exceptions.py module docstring; pyproject.toml sentry extra]
- Worker logging is already routed through structlog with the PHI sanitizer via the `setup_logging` signal. [Source: workers/celery_app.py#34-38]

### Running tests (critical — Docker source is baked, not mounted)

- **PITFALL from Story 2.3:** the `api`/`worker` containers `build:` the image with **no source volume mount**. New code/migrations are invisible until you rebuild: `docker compose build api worker && docker compose up -d`. (In 2.3, `alembic heads` showed the stale revision until rebuild.) Always rebuild before running migrations/integration tests against the container.
- Apply migrations: `docker compose exec api alembic upgrade head` (and verify round-trip: `alembic downgrade -1` then `upgrade head` for each new migration).
- Unit tests (no services needed): `pytest tests/unit/`.
- Integration tests (need Postgres + MinIO + Redis up): `docker compose up -d` then `docker compose exec api pytest tests/integration/api/test_jobs.py`. Tests auto-skip if services unreachable (skip-guard pattern).
- Lint: `ruff check .` (line-length 100, rules `E,F,I,B,UP,W`, `B008` ignored for FastAPI Depends).
- Integration auth: mint a dev JWT via `DevAuthProvider().issue_token(principal)` with a seed user (`ma.tech`/`consultant`/`client.user`) → `{"Authorization": f"Bearer {token}"}`. Copy the `_auth_headers` helper from [test_skills.py](../../../velara-api/tests/integration/api/test_skills.py).
- Celery in tests: set `celery.conf.task_always_eager = True` (and `task_eager_propagates = True` to surface exceptions) so tasks run synchronously in-process — no worker needed.

### Project Structure Notes

New/modified files (all under `velara-api/`), aligned with the architecture’s named structure [Source: architecture/Velara-Architecture-full.md#391-407]:

| File | Action | Purpose |
|------|--------|---------|
| `app/models/invocation.py` | NEW | `InvocationJob`, `InvocationResult` |
| `app/models/audit.py` | NEW | `AuditLogEntry` (append-only, first `LtreeType` user) |
| `app/models/__init__.py` | MODIFY | register new models for Alembic |
| `app/db/migrations/versions/0005_invocation_jobs_results.py` | NEW | jobs + results tables (down_revision `0004`) |
| `app/db/migrations/versions/0006_audit_log_entries.py` | NEW | audit table + append-only trigger (down_revision `0005`) |
| `app/workers/execution_tasks.py` | NEW | `run_skill` task scaffolding + lifecycle wiring |
| `app/services/job_service.py` | NEW | job CRUD, status transitions, cancel/revoke |
| `app/services/audit_service.py` | NEW | append-only audit writes |
| `app/schemas/job.py` | NEW | `JobRead`, `JobResult`, `JobReadWithResult` |
| `app/api/v1/jobs.py` | NEW | `GET /jobs/{job_id}`, `POST /jobs/{job_id}/cancel` |
| `app/api/v1/router.py` | MODIFY | include jobs router |
| `tests/unit/services/test_job_service.py` | NEW | |
| `tests/unit/services/test_audit_service.py` | NEW | |
| `tests/integration/api/test_jobs.py` | NEW | |

Naming aligns with existing conventions (tables plural snake_case; indexes `idx_{table}_{column}`; Celery `velara.workers.{module}.{action}`). No detected conflicts. The architecture doc lists `app/models/audit.py`, `app/services/audit_service.py`, `app/workers/celery_app.py` by name — this story populates exactly those slots.

### References

- [Source: epics/epic-3-skill-execution-engine.md#Story 3.1] — story statement + all 7 ACs (exact schema fields, status/outcome enums, append-only requirement).
- [Source: epics/epic-3-skill-execution-engine.md#Story 3.7] — fan-out is deferred; `fan_out`/`invocation_id` columns added now so 3.7 needs no migration.
- [Source: architecture/Velara-Architecture-full.md#161-164] — async job model, `202 Accepted` + `job_id`, polling `/api/v1/jobs/{id}`, fan-out chord (later story).
- [Source: architecture/Velara-Architecture-full.md#18,133,557,570] — audit log append-only, monthly partition (Phase-2), 7-year retention.
- [Source: architecture/Velara-Architecture-full.md#99,134] — Celery + Redis (broker, backend, cache all one Redis/ElastiCache).
- [Source: architecture/Velara-Architecture-full.md#199-202,269,277] — table/index naming, job status enum, Celery task naming.
- [Source: architecture/Velara-Architecture-full.md#305-309] — X-Ray tracing API→worker, task.started/completed/failed log events with `task_id`/`skill_id`/`job_id`/`duration_ms` (observability target; structlog already wired).
- [Source: velara-api/app/models/skill.py] — exact UUID/timestamp/VARCHAR-enum/JSONB/Index column patterns to mirror.
- [Source: velara-api/app/workers/celery_app.py] — Celery app, JSON-only serialization, `task_track_started=True`, structlog worker logging, task-name convention.
- [Source: velara-api/app/db/session.py] — `session_scope()` async CM for use in Celery tasks; `get_session` for request DI.
- [Source: velara-api/app/core/dependencies.py] — `CurrentUser`/`DbSession`/`OutputStorage` aliases; async-safety note (threadpool for blocking I/O in handlers, direct in tasks).
- [Source: velara-api/app/core/exceptions.py] — `VelaraHTTPException`, global error envelope, `VALIDATION_ERROR`/`INTERNAL_ERROR` handling.
- [Source: velara-api/app/api/v1/skills.py] — router/`_meta`/envelope/org-scoping/`model_validate` patterns to copy.
- [Source: velara-api/app/services/skill_service.py] — module-level async service + `ERROR_CODE`-bearing exception pattern.
- [Source: velara-api/app/db/migrations/versions/0004_skill_derivation_lineage.py] — migration head + revision/down_revision format.
- [Source: velara-api/app/db/migrations/env.py] — Alembic discovers models via `import app.models`.
- [Source: velara-api/tests/integration/api/test_skills.py] — skip-guard + `_auth_headers` dev-JWT integration test pattern.
- [Source: stories/2-3-paired-skill-derivation-lineage.md#Debug Log References] — Docker image bakes source (no volume mount): rebuild before migrations/integration tests.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Story implementation) / claude-opus-4-8 (Task 7 tests + completion)

### Debug Log References

- **`audit.py` missing `UUID` import**: `F821 Undefined name 'UUID'` — fixed by adding `from sqlalchemy.dialects.postgresql import UUID`.
- **`invocation.py` unused `Text` import**: `F401` — removed.
- **Unit tests checking ORM defaults on `__init__`**: SQLAlchemy `mapped_column(default=...)` only fires on session flush, not `__init__`. Fixed by checking column metadata (`col.default.is_callable`, `col.nullable`).
- **`org_id` missing from initial model**: Added after discovering `job_service` needed it for org scoping.
- **Integration test `asyncio.run()` conflict**: `_sync_create_skill/job()` helpers used `asyncio.run()` which fails when pytest-asyncio already has a loop running. Fixed by making test helpers and fixtures `async` and calling `await` directly.
- **Skills ↔ skill_versions circular FK**: In `_create_skill_in_db()`, must INSERT skills with `current_version_id=NULL` first, then INSERT skill_versions, then UPDATE `current_version_id`. Original helper had the order reversed.
- **Cross-test engine pool contamination**: The shared SQLAlchemy async engine caches asyncpg connections to the first test's event loop; subsequent tests' loops get "Future attached to a different loop". Fixed by adding `autouse` `dispose_engine_after_test` fixture in worker tests.
- **Celery eager-mode `asyncio.run()` nested loop**: Cannot call `asyncio.run()` (inside `run_skill`) from pytest-asyncio's running loop. Worker tests instead call the service functions (`mark_running`, `mark_completed`, `mark_failed`, `record_entry`) in the same order as the task, validating the lifecycle logic without the nested loop.

### Completion Notes List

- Story 3.1 is fully implemented. All 7 ACs satisfied; 109 Docker integration tests + 103 unit tests green.
- `celery_eager` fixture added to `tests/conftest.py` for future use in other test files.
- `dispose_engine_after_test` autouse fixture in worker tests prevents cross-test pool contamination (pattern to reuse in future worker test files).
- Migration round-trip verified: `downgrade -1` × 2 then `upgrade head` clean.

### File List

**New files:**
- `velara-api/app/models/invocation.py`
- `velara-api/app/models/audit.py`
- `velara-api/app/db/migrations/versions/0005_invocation_jobs_results.py`
- `velara-api/app/db/migrations/versions/0006_audit_log_entries.py`
- `velara-api/app/services/job_service.py`
- `velara-api/app/services/audit_service.py`
- `velara-api/app/workers/execution_tasks.py`
- `velara-api/app/schemas/job.py`
- `velara-api/app/api/v1/jobs.py`
- `velara-api/tests/unit/services/test_job_service.py`
- `velara-api/tests/unit/services/test_audit_service.py`
- `velara-api/tests/integration/api/test_jobs.py`
- `velara-api/tests/integration/workers/__init__.py`
- `velara-api/tests/integration/workers/test_execution_tasks.py`

**Modified files:**
- `velara-api/app/models/__init__.py` — registered InvocationJob, InvocationResult, AuditLogEntry
- `velara-api/app/api/v1/router.py` — added jobs router
- `velara-api/tests/conftest.py` — added `celery_eager` fixture

## Review Findings

_Code review 2026-06-10 (uncommitted diff vs baseline `78cc586`) — adversarial 3-layer (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 7 findings retained, 8 dismissed as noise/scope-bounded._

### Decision-needed

_(Both resolved 2026-06-10 → patch — see Patch list below.)_

### Patch (all applied & verified 2026-06-10)

- [x] [Review][Patch] Append-only trigger does not cover `TRUNCATE` — added statement-level `BEFORE TRUNCATE` trigger `trg_audit_log_no_truncate` in `0006` (same reject function); dropped before table in downgrade. Verified: `TRUNCATE audit_log_entries` now raises "append-only: TRUNCATE not permitted". [app/db/migrations/versions/0006_audit_log_entries.py]
- [x] [Review][Patch] No enum validation before insert — added `VALID_OUTCOMES`/`VALID_RUNTIME_TYPES` allow-list validation at the top of `audit_service.record_entry` (raises `ValueError` before any DB access); +2 unit tests. [app/services/audit_service.py]
- [x] [Review][Patch] AC6 violation — Sentry never initialized in the Celery worker. Extracted shared `app/core/observability.init_sentry(with_fastapi=...)`; worker registers it via `worker_process_init` signal (CeleryIntegration only); `main.py` now calls it with `with_fastapi=True`. Verified: signal receiver connected in worker container. [app/core/observability.py, app/workers/celery_app.py, app/main.py]
- [x] [Review][Patch] No terminal-state guard on `mark_*` helpers → duplicate `InvocationResult` breaks GET — added `_guard_not_terminal` (idempotent skip) to `mark_running`/`mark_completed`/`mark_failed`, AND a DB-level `UNIQUE(invocation_job_id)` constraint on `invocation_results` (0005 + model; replaced the redundant plain index). +5 unit tests. Verified: unique constraint live in DB. [app/services/job_service.py, app/models/invocation.py, app/db/migrations/versions/0005_invocation_jobs_results.py]
- [x] [Review][Patch] Concurrent cancel ↔ task-pickup race — `_get_job_or_404` gained `for_update` param; `cancel_job` now loads the row `FOR UPDATE` (mirrors `skill_service.get_skill`). [app/services/job_service.py]
- [x] [Review][Patch] `cancel_job` writes no `cancelled` audit entry — now records an `OUTCOME_CANCELLED` audit entry after `mark_cancelled`. [app/services/job_service.py]
- [x] [Review][Patch] Failure handler reuses a poisoned session — task now snapshots job context up front and writes the failure status + audit in a FRESH `session_scope()`, so a DB-error in the (future 3.3-3.5) body no longer leaves the job stuck in `running` with no audit. [app/workers/execution_tasks.py]
- [x] [Review][Patch] `presign_download` failure turns a normal GET into a 500 — wrapped the presign call in try/except; on failure logs a warning and returns `output_file_url=null` (status + metadata + key still returned). [app/api/v1/jobs.py]
- [x] [Review][Patch] Misleading org-scoping comment — removed the false `<username>@<org_id>`-parsing comment and the indirection helper; `_get_job_or_404` now scopes org in the WHERE clause (`InvocationJob.org_id == org_id`), matching `skill_service.get_skill`. [app/services/job_service.py]

**Verification:** ruff clean · 111 unit tests pass (+8 new) · 220 full Docker suite pass · migration round-trip (upgrade→downgrade×2→upgrade) clean on a fresh DB · UNIQUE constraint + TRUNCATE rejection functionally confirmed in Postgres.

### Deferred

- [x] [Review][Defer] No reaper/timeout for jobs stuck in `running` — if the worker dies between `mark_running` and the terminal transition, the job is durably `running` forever (no `task_time_limit`, no sweep task) [app/workers/celery_app.py] — deferred, infrastructure concern beyond 3.1 scaffolding scope
- [x] [Review][Defer] `hierarchy_path` empty/malformed string → opaque DB `DataError` — no ltree-format validation in `create_job`/`record_entry`; latent since all current callers pass `"org"`, real paths arrive in Epic 4 [app/services/job_service.py, app/services/audit_service.py] — deferred, latent until Epic 4 populates hierarchy paths

### Dismissed (noise / scope-bounded — not written as action items)

- `runtime_type` hardcoded `"prompt"` — explicit `TODO(3.3-3.5)` placeholder, permitted by Scope Boundary.
- Completed scaffolding job always gets an `InvocationResult` with null `output_file_key` — spec Task 3 ("on placeholder success … writes an InvocationResult") explicitly prescribes this.
- `started_at` drift between the local var and the persisted `job.started_at` — sub-millisecond cosmetic.
- Cross-org query lacks DB-level `WHERE org_id` (Python guard only) — functionally correct; defensive nit.
- `JobReadWithResult` ltree→str serialization risk — speculative; `LtreeType` coercion not shown to break, integration tests pass.
- Double job-load across two sessions — wasteful but harmless; intentional session separation.
- AC2 "output file references" structurally-but-not-functionally satisfied — same root as the null-key scaffolding item; spec-compliant.
- Spec self-referential typo (`test_jobs.py` vs `test_skills.py` in Task 7) — documentation only, implementation is correct.

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-10 | Created Story 3.1 context: Async Job Infrastructure — `InvocationJob`/`InvocationResult`/`AuditLogEntry` models (migrations 0005/0006, append-only trigger), Celery `run_skill` task scaffolding + lifecycle state machine, `job_service`/`audit_service`, `GET /jobs/{id}` + `POST /jobs/{id}/cancel` endpoints. Scope-bounded: execution runtimes (3.3–3.5), invocation endpoint, and fan-out (3.7) explicitly excluded. Built from epic-3 ACs + architecture decisions + exhaustive velara-api codebase analysis (skill model/router/service patterns, Celery app, session_scope, dependencies async-safety, 0004 migration head) + Story 2.3 Docker-rebuild learning. | Bob (Scrum Master) |
