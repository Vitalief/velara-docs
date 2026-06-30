---
baseline_commit: NO_VCS
---

# Story 1.3: Local Dev Environment & Provider Abstractions

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want storage and secrets behind provider interfaces with local backends, and a `docker-compose` stack that runs the whole platform without any AWS account,
so that Skill Registry (Epic 2) and Skill Execution (Epic 3) can be built and tested locally now, and the later switch to AWS (Epic 7) is a configuration change rather than a rewrite.

> **Context (2026-06-05 resequencing):** This story did not exist in the original plan — it was added when the epics were resequenced feature-first (see `planning-artifacts/sprint-change-proposal-2026-06-05.md`). It removes the AWS-account dependency from the critical path. It builds directly on the `velara-api` scaffold from **Story 1.1** (done). The companion **Story 1.4** (Dev Authentication Shim) implements the third provider (`AuthProvider`); this story only reserves its `AUTH_BACKEND` env switch.

## Acceptance Criteria

1. **Given** a `StorageProvider` interface is defined (`put`, `get`, `presign_upload`, `presign_download`, `delete`), **When** the app boots with `STORAGE_BACKEND=local`, **Then** an S3-compatible local backend (MinIO) is wired in; with `STORAGE_BACKEND=s3` the same provider targets AWS S3 — **no calling code changes** between the two (only configuration differs).

2. **Given** all file handling goes through the `StorageProvider`, **When** any file is stored or retrieved, **Then** only the object **key + metadata** travel through services and the database (S3-key-reference pattern) — raw file content is never stored inline in the DB or passed inline between services.

3. **Given** a `SecretsProvider` interface is defined (`get_secret(name) -> str`), **When** the app boots with `SECRETS_BACKEND=env`, **Then** an `EnvSecretsProvider` reads from environment / local `.env`; with `SECRETS_BACKEND=aws` a `SecretsManagerProvider` (boto3) is used — secret **consumers are unchanged** between backends. A request for a missing secret raises a clear, typed error (no silent `None`).

4. **Given** I run `docker-compose up`, **When** the stack starts, **Then** FastAPI, Celery worker, Redis, PostgreSQL, **and** a MinIO object store all start healthy; the `ingest` and `output` buckets are **auto-created** by a one-shot bootstrap service.

5. **Given** `.env.example` is updated, **When** a new developer copies it to `.env`, **Then** it documents every backend switch (`STORAGE_BACKEND`, `SECRETS_BACKEND`, `AUTH_BACKEND`) with **local defaults**, and the corresponding AWS values are present but commented (for Epic 7).

6. **Given** the provider selection is config-driven (resolved once via factories), **When** Epic 7 provisions real AWS, **Then** switching to AWS backends requires **only** environment/config changes — no edits to `app/services/`, route handlers, or worker tasks.

7. **Given** a presigned upload + download roundtrip is exercised against the local MinIO backend, **When** an object is `put`, a `presign_download` URL is issued and fetched, **Then** the bytes returned match the bytes stored, and `delete` removes the object — proven by an integration test running in the Docker stack.

8. **Given** the existing scaffold (Story 1.1), **When** this story's changes are applied, **Then** `ruff check .` passes, `pytest` passes (existing 9 tests + new provider tests), and the existing `postgres`/`redis`/`api`/`worker` services and `GET /health`, `GET /health/ready` endpoints continue to work unchanged.

## Tasks / Subtasks

- [x] **T1: Extend settings with backend selectors** (AC: 1, 3, 5, 6)
  - [x] In `app/core/config.py` add to the existing `Settings(BaseSettings)`: `STORAGE_BACKEND: Literal["local","s3"] = "local"`, `SECRETS_BACKEND: Literal["env","aws"] = "env"`, `AUTH_BACKEND: Literal["dev","cognito"] = "dev"` (reserved for Story 1.4 — do not implement auth here).
  - [x] Add storage settings: `S3_ENDPOINT_URL: str | None = None` (set for MinIO, `None` for AWS), `S3_REGION: str = "us-east-1"`, `S3_INGEST_BUCKET: str = "velara-ingest"`, `S3_OUTPUT_BUCKET: str = "velara-output"`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (read from env; MinIO root creds locally, IAM role in AWS).
  - [x] **Preserve** the existing fail-fast validator (review-added: `SECRET_KEY`/`DATABASE_URL` must not be defaults in staging/prod). Do not weaken it. Optionally extend: in `staging`/`prod`, require `S3_ENDPOINT_URL is None` and `STORAGE_BACKEND == "s3"` (local backends must never be used in cloud envs).
  - [x] Keep all secrets out of code — values come from env only (HIPAA non-negotiable from Story 1.1).

- [x] **T2: StorageProvider abstraction + S3 implementation** (AC: 1, 2, 6, 7)
  - [x] Create `app/integrations/storage.py` with a `StorageProvider` `Protocol`/ABC: `put(key, data, content_type) -> None`, `get(key) -> bytes`, `presign_upload(key, content_type, expires_s) -> str`, `presign_download(key, expires_s) -> str`, `delete(key) -> None`.
  - [x] Implement `S3StorageProvider(StorageProvider)` using **boto3** (already pinned `boto3==1.35.x` — do NOT add aioboto3). It accepts `endpoint_url`, `region`, credentials, and bucket config so the **same class** serves AWS S3 (`endpoint_url=None`) and MinIO (`endpoint_url=http://minio:9000`).
  - [x] Configure the boto3 client for S3-compatibility: `Config(signature_version="s3v4", s3={"addressing_style": "path"})` — **required** for presigned URLs to work against MinIO (see Dev Notes → MinIO gotchas).
  - [x] Add `get_storage_provider()` factory that reads `settings.STORAGE_BACKEND` and returns a configured `S3StorageProvider`. Cache the instance (module-level singleton or `@lru_cache`).
  - [x] This file fulfills the role the architecture's structure names `integrations/s3_client.py` — the provider **is** the generalized S3 client. Document this as a deliberate, minor structural variance (provider pattern requested by the 2026-06-05 change). Do NOT also create a separate `s3_client.py`.

- [x] **T3: SecretsProvider abstraction + implementations** (AC: 3, 6)
  - [x] Create `app/integrations/secrets.py` with a `SecretsProvider` Protocol/ABC: `get_secret(name: str) -> str`.
  - [x] Implement `EnvSecretsProvider` (reads `os.environ`; raises `MissingSecretError` if absent) and `SecretsManagerProvider` (boto3 `secretsmanager`; raises `MissingSecretError` on `ResourceNotFoundException`).
  - [x] Add a typed `MissingSecretError` (subclass the project's `VelaraBaseException` from `app/core/exceptions.py`) and map it to a `MISSING_CREDENTIAL` error code path (this is the same code Epic 3 Story 3.8 expects for credential injection failures).
  - [x] Add `get_secrets_provider()` factory keyed on `settings.SECRETS_BACKEND`.
  - [x] **Distinction (document in code):** `config.py` holds static **app config** (DB URL, Redis URL). `SecretsProvider` fetches **dynamic per-skill credentials** at execution time (used later by `execution_service` / connector framework in Epic 3). Do not route app config through `SecretsProvider`, and do not put skill credentials in `Settings`.

- [x] **T4: docker-compose — MinIO + bucket bootstrap** (AC: 4, 8)
  - [x] Add a `minio` service (`minio/minio`) to the existing `docker-compose.yml`: command `server /data --console-address ":9001"`, ports `9000:9000` (API) + `9001:9001` (console), env `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` from `.env`, a healthcheck (`mc ready` or curl `/minio/health/live`), and a named volume `minio_data`.
  - [x] Add a one-shot `createbuckets` service (`minio/mc`) that waits for MinIO healthy, then `mc mb` the `velara-ingest` and `velara-output` buckets (idempotent — `--ignore-existing`).
  - [x] Add `minio` (condition: service_healthy) to `depends_on` of `api` and `worker`.
  - [x] **Do not modify** the existing `postgres`/`redis`/`api`/`worker`/`flower` service definitions beyond adding the new `depends_on` entry — preserve the working stack from Story 1.1.

- [x] **T5: .env.example documentation** (AC: 5)
  - [x] Append the new vars with comments: `STORAGE_BACKEND=local` (`# local|s3`), `S3_ENDPOINT_URL=http://minio:9000` (`# unset / remove for AWS S3`), `S3_REGION`, `S3_INGEST_BUCKET`, `S3_OUTPUT_BUCKET`, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (local = MinIO root creds), `SECRETS_BACKEND=env` (`# env|aws`), `AUTH_BACKEND=dev` (`# dev|cognito — implemented in Story 1.4 / swapped in Story 7.3`).
  - [x] Include a commented "AWS (Epic 7)" block showing the production values (`STORAGE_BACKEND=s3`, no endpoint URL, `SECRETS_BACKEND=aws`, `AUTH_BACKEND=cognito`).

- [x] **T6: Provider wiring (DI) + async safety** (AC: 2, 6)
  - [x] Expose providers via FastAPI dependencies (e.g., `app/core/dependencies.py` — create if absent, matching the architecture's planned `dependencies.py`) returning the cached factory instances, so routes/services receive a `StorageProvider`/`SecretsProvider` rather than importing concretes.
  - [x] **Async safety:** presigned-URL generation is local/CPU-only and safe to call directly. For blocking S3 **I/O** (`put`/`get`) inside async request handlers, wrap boto3 calls with `fastapi.concurrency.run_in_threadpool` (or `anyio.to_thread.run_sync`) — never block the event loop. In Celery tasks (sync), call boto3 directly.

- [x] **T7: Tests** (AC: 1, 2, 3, 7, 8)
  - [x] `tests/unit/integrations/test_storage_factory.py` + `test_secrets_factory.py`: factory returns the correct provider per backend setting; `EnvSecretsProvider` returns env value and raises `MissingSecretError` when absent.
  - [x] `tests/integration/integrations/test_storage_roundtrip.py`: against MinIO in the Docker stack — `put` → `presign_download` → HTTP GET the URL → bytes match; `presign_upload` → HTTP PUT → object exists; `delete` removes it. Skip-marker if MinIO env not present, but it MUST run green in the Docker stack.
  - [x] Follow Story 1.1 test conventions: `httpx.AsyncClient` fixture in `conftest.py`, `asyncio_mode = "auto"`, co-located dirs. Add `tests/unit/integrations/__init__.py` + `tests/integration/integrations/__init__.py`.
  - [x] Confirm the existing 9 tests still pass (no regression to health/middleware/error-handling).

- [x] **T8 (optional, careful): storage readiness** (AC: 8)
  - [x] OPTIONALLY extend `GET /health/ready` to include a storage `head_bucket`/`list` check. Implemented following the exact DB/Redis pattern: timeout-guarded, returns 503 not 500 on failure, run boto3 in `asyncio.to_thread` to avoid blocking the event loop. Response envelope now includes `"storage": "ok"|"unavailable"`.

- [x] **T9: Verify end-to-end** (AC: all)
  - [x] `docker compose up -d --build` → postgres (healthy), redis (healthy), minio (healthy), createbuckets (completed — both buckets created), api (up), worker (up), flower (up).
  - [x] `ruff check .` clean; `pytest -q` green — 29 tests locally, 34 tests in-container (includes 5 MinIO roundtrip tests).
  - [x] Storage roundtrip demonstrated: `put` → `get` → bytes match; presign download + upload verified. `get_secret` env lookup demonstrated. Config-only swap demonstrated: `STORAGE_BACKEND=local` → endpoint `http://minio:9000`; `STORAGE_BACKEND=s3` → endpoint `None` (AWS) — zero code changes.

### Review Findings

_Code review 2026-06-09 (adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 8 ACs Met/Partially-Met; no scope violations (AuthProvider correctly reserved-only, no X-Ray, no app config through SecretsProvider, fail-fast validator preserved). 6 patch, 2 defer, 9 dismissed as noise._

**Patches (resolved 2026-06-09 — all applied; `ruff` clean, 29 passed / 5 skipped):**

- [x] [Review][Patch] Prod fail-fast validator does not reject `SECRETS_BACKEND=env` (and `AUTH_BACKEND=dev`) in staging/prod — HIPAA gap: a cloud deploy can boot reading secrets from an env file. Validator guards only STORAGE_BACKEND/S3_ENDPOINT_URL. [app/core/config.py:107-114] — FIXED: validator now also rejects `SECRETS_BACKEND=env` and `AUTH_BACKEND=dev` outside dev.
- [x] [Review][Patch] Storage readiness check reaches into private `provider._client.list_buckets()` (bypasses the StorageProvider Protocol) AND only performs an account-level list — it never verifies the `velara-ingest`/`velara-output` buckets exist, so it reports `storage: ok` with missing buckets. [app/api/v1/health.py:98-118] — FIXED: added `StorageProvider.check_ready()` (per-bucket `head_bucket`); `_check_storage` now probes both ingest and output buckets.
- [x] [Review][Patch] `api`/`worker` depend only on `minio: service_healthy`, not on `createbuckets` completion → startup race where the app runs before buckets exist. The `createbuckets` entrypoint chains with `;` and has no `set -e`, masking a failed `mc mb`. [docker-compose.yml] — FIXED: added `createbuckets: condition: service_completed_successfully` to api+worker and `set -e` to the bootstrap entrypoint.
- [x] [Review][Patch] `SecretsManagerProvider.get_secret` returns `response.get("SecretString") or ""` — a binary-only or empty secret silently returns `""`, violating the Protocol contract and injecting an empty credential. [app/integrations/secrets.py:79-90] — FIXED: raises `MissingSecretError` when `SecretString` is absent/empty.
- [x] [Review][Patch] Integration test skip-guard runs (does not skip) on a host `pytest` when `.env` sets `S3_ENDPOINT_URL=http://minio:9000` but MinIO is unreachable → hang/fail instead of skip. [tests/integration/integrations/test_storage_roundtrip.py:24-44] — FIXED: now probes `/minio/health/live` and skips when unreachable (verified: 5 roundtrip tests skip cleanly on host).
- [x] [Review][Patch] `EnvSecretsProvider.get_secret` only raises on `None`; a set-but-empty env var (`""`) is returned as a valid secret. [app/integrations/secrets.py:60-65] — FIXED: `if not value: raise MissingSecretError(name)`.

**Deferred:**

- [x] [Review][Defer] `SecretsManagerProvider` region sourced from `S3_REGION` (no dedicated AWS/secrets region setting) — cross-domain coupling that breaks if Secrets Manager and S3 live in different regions. [app/integrations/secrets.py:99] — deferred: `aws` secrets backend is unused until Epic 7, which will introduce real AWS region config.
- [x] [Review][Defer] `S3StorageProvider.get()` does an unbounded `response["Body"].read()` into memory — memory/DoS risk for large HIPAA documents; no streaming variant on the Protocol. [app/integrations/storage.py:92-94] — deferred: storage consumers (ingest/output pipelines) are Epic 3 (Stories 3.2/3.6); add a streaming `get` when they arrive.

## Dev Notes

### What already exists (Story 1.1 — done, verified live) — DO NOT reinvent
- `app/core/config.py`: `Settings(BaseSettings)` via **`pydantic-settings`** reading `DATABASE_URL`, `REDIS_URL`, `SENTRY_DSN`, `ENVIRONMENT` (enum `dev|staging|prod`), `SECRET_KEY`. **Has a review-added fail-fast validator** rejecting default `SECRET_KEY`/`DATABASE_URL` in staging/prod — extend `Settings`, don't rewrite it. [Source: `1-1-velara-api-project-scaffold.md` T3, Review Findings]
- `app/integrations/` is **EMPTY** (only `__init__.py` + `.gitkeep`). This is the home for `storage.py` and `secrets.py`. No `s3_client.py` exists yet. [Source: 1-1 File List]
- `app/core/exceptions.py`: `VelaraBaseException` + `VelaraHTTPException` + global handler returning the `{"error":{"code","message","request_id"}}` envelope. Subclass `VelaraBaseException` for `MissingSecretError`. [Source: 1-1 T7]
- `app/core/logging.py` + `middleware.py`: structlog + shared `sanitize_phi`. **Never log raw file bytes or secret values** — they must pass the sanitizer; prefer logging only object keys and secret *names*.
- `app/workers/celery_app.py`: Celery app (`velara`), broker/backend = Redis. Task naming `velara.workers.{module}.{action}`.
- `docker-compose.yml`: services `postgres` (postgres:16-alpine), `redis` (redis:7-alpine), `api`, `worker`, `flower` (5555); named postgres volume; healthcheck-gated `depends_on`. **Extend, don't replace.** [Source: 1-1 T11]
- `boto3==1.35.x` is **already a pinned dependency** ("AWS SDK (S3, Secrets Manager)"). No new AWS SDK needed. Do **not** add `aioboto3`. [Source: 1-1 Tech Stack]
- Tests: `tests/conftest.py` (`httpx.AsyncClient`), `tests/integration/api/`, `tests/unit/services/`, `asyncio_mode="auto"`. 9 tests currently green. [Source: 1-1 T12, Debug Log]
- **X-Ray was removed** in 1.1's review (no Starlette extension in `aws-xray-sdk==2.14`); tracing is Sentry (`traces_sample_rate=0.1`, DSN-gated). Do not reintroduce X-Ray here. [Source: 1-1 Review Findings]

### Architecture constraints (authoritative)
- **Provider abstraction is an approved architecture decision** (added 2026-06-05): `StorageProvider` (S3↔MinIO/LocalStack), `SecretsProvider` (Secrets Manager↔env), `AuthProvider` (Cognito↔dev-JWT), selected by `STORAGE_BACKEND`/`SECRETS_BACKEND`/`AUTH_BACKEND`. These **formalize existing seams** — they are additive, production targets unchanged. [Source: `architecture/core-architectural-decisions.md#local-development--provider-abstractions-added-2026-06-05`]
- **S3-key-reference rule (HIPAA):** "Never store file content inline in the database — always S3 key + metadata pattern." Enforced from day one. [Source: `architecture/implementation-patterns-consistency-rules.md#enforcement-rules`, decision: Skill artifact storage = S3 content + PG metadata]
- **Secrets:** "All secrets in AWS Secrets Manager — injected via ECS task environment, never hardcoded or in env files" (prod); env in local dev. [Source: `core-architectural-decisions.md#authentication--security`, ARCH-09]
- **Structure:** integrations live in `app/integrations/`; the planned `s3_client.py` responsibility is fulfilled by `storage.py`'s provider. [Source: `architecture/project-structure-boundaries.md` — velara-api tree]
- **Naming:** snake_case modules/functions; `SCREAMING_SNAKE_CASE` settings; envelope/error patterns unchanged. [Source: `implementation-patterns-consistency-rules.md#naming-patterns`]

### MinIO / boto3 gotchas (prevent presigned-URL failures)
- Use `endpoint_url=settings.S3_ENDPOINT_URL` for MinIO; leave it `None` for AWS (boto3 then targets real S3).
- **Required client config for MinIO:** `botocore.config.Config(signature_version="s3v4", s3={"addressing_style": "path"})`. Without path-style addressing, boto3 generates virtual-host-style URLs (`bucket.minio:9000`) that MinIO in compose cannot resolve.
- Inside Docker, the API/worker reach MinIO at `http://minio:9000` (service DNS). A presigned URL returned to a **browser/test on the host** must use a host-reachable address (`http://localhost:9000`). For local dev, run tests inside the compose network (host == `minio`) OR set the presign endpoint to `localhost:9000`. Document whichever you choose; the integration test (T7) should fetch via the same network it runs in.
- MinIO credentials = `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` → passed to boto3 as `aws_access_key_id`/`aws_secret_access_key`. Region can be any value locally (e.g., `us-east-1`).

### Async safety
boto3 is **synchronous**. Presign calls do no network I/O (safe inline). For `put`/`get` in async FastAPI handlers, wrap with `run_in_threadpool`. Celery tasks are sync — call boto3 directly. Blocking the event loop on S3 I/O is a real perf/regression risk (NFR-01 ≤2s P95 overhead).

### Scope — What NOT to build in this story
- **`AuthProvider` / dev-auth JWT** — that's **Story 1.4** (only reserve the `AUTH_BACKEND` env var here). [Epic 1]
- Real AWS provisioning / Terraform / Secrets Manager resources — **Epic 7** (Stories 7.1–7.4).
- The ingest/output pipelines that *use* storage (presign endpoints, `parse_document`, branded output) — **Epic 3** (Stories 3.2, 3.6). This story delivers the provider they will consume, plus a roundtrip test — not the pipelines.
- Connector-framework credential consumption — **Epic 3 Story 3.8** (it will call `get_secret`).
- LocalStack (S3 + Secrets Manager in one) is an acceptable alternative to MinIO if the team later wants to exercise `SecretsManagerProvider` locally; default to **MinIO + `SECRETS_BACKEND=env`** for a lean stack. If you choose LocalStack instead, keep the same provider interfaces and env switches.

### Regression preservation (must remain green)
- Existing `docker-compose` services and `GET /health`, `GET /health/ready` behavior unchanged (AC8).
- `config.py` fail-fast validators preserved (HIPAA guard).
- No change to response/error envelopes, middleware order, or Celery task naming.
- Existing 9 tests still pass.

### Project Structure Notes
- New files: `app/integrations/storage.py`, `app/integrations/secrets.py`, `app/core/dependencies.py` (if not present), `tests/unit/integrations/` (+ `__init__.py`), `tests/integration/integrations/` (+ `__init__.py`).
- Updated files: `app/core/config.py` (settings), `docker-compose.yml` (minio + createbuckets + depends_on), `.env.example`, `pyproject.toml` only if a test-only dep is needed (none expected — boto3 already present).
- **Variance (documented):** `storage.py` supersedes the architecture's named `integrations/s3_client.py` by implementing the provider pattern. This is the deliberate intent of the 2026-06-05 change, not a deviation to flag for correction.

### References
- Epic 1, Story 1.3 ACs [Source: `_bmad-output/planning-artifacts/epics/epic-1-platform-foundation-local-dev-environment.md#story-13-local-dev-environment--provider-abstractions`]
- Provider abstractions decision [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#local-development--provider-abstractions-added-2026-06-05`]
- S3-key-reference + secrets rules [Source: `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#enforcement-rules`]
- velara-api directory tree [Source: `_bmad-output/planning-artifacts/architecture/project-structure-boundaries.md`]
- Existing scaffold (config, integrations dir, docker-compose, boto3 pin, test patterns) [Source: `_bmad-output/implementation-artifacts/stories/1-1-velara-api-project-scaffold.md`]
- Sprint Change Proposal (why this story exists) [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-05.md`]

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
- `requests` not in Docker image → replaced with `httpx` in `test_storage_roundtrip.py` (httpx already in dev deps).
- boto3 `_client.list_buckets()` used for `_check_storage()` readiness check — confirms API + bucket access in one call.

### Completion Notes List
- T1: Extended `Settings` with `STORAGE_BACKEND`, `SECRETS_BACKEND`, `AUTH_BACKEND`, all S3 settings, and MinIO credentials. Fail-fast validator extended: `STORAGE_BACKEND=local` and non-null `S3_ENDPOINT_URL` now cause boot failure in staging/prod (HIPAA guard).
- T2: `app/integrations/storage.py` — `StorageProvider` Protocol + `S3StorageProvider` (boto3, works for both MinIO and AWS S3). `Config(signature_version="s3v4", s3={"addressing_style":"path"})` required for MinIO presigned URL compatibility. `get_storage_provider(bucket)` factory with `@lru_cache`. `get_ingest_storage()` / `get_output_storage()` convenience accessors.
- T3: `app/integrations/secrets.py` — `SecretsProvider` Protocol + `EnvSecretsProvider` + `SecretsManagerProvider`. `MissingSecretError(VelaraBaseException)` with `ERROR_CODE = "MISSING_CREDENTIAL"` (Epic 3 Story 3.8 contract). `get_secrets_provider()` factory with `@lru_cache`.
- T4: `docker-compose.yml` — added `minio` service (healthcheck via `/minio/health/live`) + `createbuckets` one-shot bootstrap service (idempotent `mc mb --ignore-existing`). `api` and `worker` now depend on `minio: service_healthy`. New `minio_data` volume.
- T5: `.env.example` updated with all new vars, per-var comments, and a commented AWS Epic 7 block.
- T6: `app/core/dependencies.py` created — `IngestStorage`, `OutputStorage`, `Secrets` type aliases for `Annotated[..., Depends(...)]`. Doc note on async safety: presign is CPU-only (safe inline); put/get need `run_in_threadpool` in async handlers; Celery tasks call boto3 directly.
- T7: Unit tests (10): `test_storage_factory.py` (4) + `test_secrets_factory.py` (6). Integration tests (5): `test_storage_roundtrip.py` against live MinIO — put/get roundtrip, presign download, presign upload, delete, S3-key-reference contract. Skip marker when `S3_ENDPOINT_URL` not set. All 34 tests green in-container.
- T8: `_check_storage()` added to `health.py` using `asyncio.to_thread` to avoid blocking event loop. Runs in parallel with `_check_db` + `_check_redis` via `asyncio.gather`. Response now includes `"storage": "ok"|"unavailable"`. Existing health tests updated to mock `_check_storage` and assert new field.
- T9: `docker compose up -d --build` — all services healthy. `createbuckets` log confirmed both buckets created. `GET /health/ready` returns `{"status":"ok","database":"ok","redis":"ok","storage":"ok"}`. `ruff check .` clean. 29 tests locally, 34 in-container (all green). Config-only swap demonstrated.

### File List
- `velara-api/app/core/config.py` — modified (added STORAGE_BACKEND, SECRETS_BACKEND, AUTH_BACKEND, S3 settings, extended fail-fast validator)
- `velara-api/app/integrations/storage.py` — created (StorageProvider Protocol, S3StorageProvider, get_storage_provider factory)
- `velara-api/app/integrations/secrets.py` — created (SecretsProvider Protocol, EnvSecretsProvider, SecretsManagerProvider, MissingSecretError, get_secrets_provider factory)
- `velara-api/app/core/dependencies.py` — created (FastAPI Depends wrappers: IngestStorage, OutputStorage, Secrets)
- `velara-api/app/api/v1/health.py` — modified (added _check_storage, storage field in readiness response, asyncio.gather for parallel checks)
- `velara-api/docker-compose.yml` — modified (added minio service, createbuckets service, minio_data volume, updated api/worker depends_on)
- `velara-api/.env.example` — modified (added all provider backend selectors, S3/MinIO vars, AWS Epic 7 block)
- `velara-api/.env` — modified (added MinIO vars for local dev — git-ignored)
- `velara-api/tests/unit/integrations/__init__.py` — created
- `velara-api/tests/unit/integrations/test_storage_factory.py` — created
- `velara-api/tests/unit/integrations/test_secrets_factory.py` — created
- `velara-api/tests/integration/integrations/__init__.py` — created
- `velara-api/tests/integration/integrations/test_storage_roundtrip.py` — created
- `velara-api/tests/integration/api/test_health.py` — modified (updated for storage field + _check_storage mock)

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-05 | Story created (resequencing — new Epic 1 story). Context engine analysis completed against Story 1.1 scaffold + architecture provider-abstraction decision. |
| 2026-06-09 | Implemented: StorageProvider + SecretsProvider abstractions, MinIO docker-compose, .env.example docs, FastAPI DI wiring, unit + integration tests, optional storage readiness check. All 34 in-container tests green. |
