---
baseline_commit: 78f5406706ddcf735a28a31fb21ed8135b0296ff
---

# Story 3.3: Prompt-Based Skill Execution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to execute prompt-based skills where the platform sends instructions and context to Claude and returns the output,
so that LLM-powered skills run server-side with skill internals never exposed to callers.

This is the **first real execution runtime** in Epic 3. Story 3.1 built the job/result/audit persistence and the `run_skill` Celery scaffold (with an explicit `# TODO(3.3-3.5)` routing seam); Story 3.2 built document ingest and the `build_context_input` helper. Story 3.3 fills the seam for the **prompt** runtime only: it adds the Anthropic Claude client wrapper, an `execution_service` router, the **invocation endpoint** (`POST /api/v1/invocations/{skill_id}`) that creates a `queued` job and dispatches `run_skill`, retry/backoff on transient Claude errors, and the IP-protection guarantee that a client-scoped response carries **only** output. It deliberately does **not** implement the code runtime (3.4), the hybrid tool-use loop (3.5), branded output generation (3.6), location fan-out (3.7), or the connector/credential framework (3.8). See **Scope Boundary** below.

## Acceptance Criteria

1. **(Prompt routing → Claude)** Given a skill with `runtime_type: "prompt"` is invoked, when the Celery `run_skill` task dispatches it, then `execution_service` routes to the prompt runtime, constructs the Claude API call with the skill's instruction set and context, and calls the Anthropic API. [Source: epics/epic-3-skill-execution-engine.md#Story 3.3]

2. **(Result stored, job completed)** Given the Claude API returns a response, when the result is processed, then the output text is written to the **output bucket** as an S3 object, the `output_file_key` + `result_metadata` are stored in `invocation_results`, and the job transitions to `completed`. [Source: epic-3 AC2; architecture/Velara-Architecture-full.md#331 "S3-key + metadata"; PRD ING/OUT "input reference / output reference"]

3. **(IP protection — output only)** Given a caller with a client-scoped token invokes a skill, when the response is returned, then only the output text and any output file references are in the response — the skill's prompt instructions, system prompt, and reference file contents are **never** included in any response, log, or error. [Source: epic-3 AC3; PRD ACL-03/04/05; architecture/core-architectural-decisions.md#12,26]

4. **(Retry with backoff)** Given the Claude API returns a rate-limit or server error, when the error is received, then the task retries with exponential backoff (**3 attempts**); if all retries fail, the job transitions to `failed` with a stable `error_code`. Non-retryable client errors (4xx other than 429) transition to `failed` immediately without retrying. [Source: epic-3 AC4; claude-api skill — SDK auto-retry + typed exceptions]

5. **(Audit entry)** Given a prompt skill execution completes, when I check the audit log, then an entry exists with: `skill_id`, `skill_version`, `user_id`, `hierarchy_path`, `runtime_type: "prompt"`, `started_at`, `completed_at`, `outcome: "success"`. On failure, a `failure` entry is written with the same identity fields and `outcome: "failure"` + `error_code`. [Source: epic-3 AC5; PRD EXE-04/USE-01]

6. **(Invocation endpoint)** Given I call `POST /api/v1/invocations/{skill_id}` with optional `file_ref_ids` and inputs, when the request is accepted, then a `queued` `InvocationJob` is created (pinned to the skill's current version), `run_skill.delay(job_id)` is dispatched, the `celery_task_id` is stored, and the response is `202 Accepted` with the `job_id` for polling via the existing `GET /api/v1/jobs/{job_id}`. Retired skills → 422 `SKILL_RETIRED`; cross-org skill → 404. [Source: architecture/Velara-Architecture-full.md#161-163,189,525; stories/3-1-async-job-infrastructure.md#Scope Boundary]

## Tasks / Subtasks

- [x] **Task 1 — Add the `anthropic` SDK dependency (AC: 1, 4)**
  - [x] Add `anthropic` to `pyproject.toml` `[project.dependencies]` with an exact `==` pin (match the file's style — everything is pinned). Pick the current stable release at build time; verify the resolved version after `docker compose build`. `httpx==0.27.2` (the SDK's HTTP backend) is already present. **These are the only new packages.** [Source: claude-api skill — `pip install anthropic`; architecture/Velara-Architecture-full.md#113 lists `anthropic` in the init command but it is **not** yet in pyproject.toml — confirmed]
  - [x] **Rebuild the Docker image after editing deps** — `docker compose build api worker && docker compose up -d` (source is **baked**, not mounted; see Dev Notes → "Running tests" / Story 3.1–3.2 PITFALL). A missing rebuild = `ModuleNotFoundError: anthropic` inside the worker.

- [x] **Task 2 — Anthropic client wrapper `app/integrations/anthropic_client.py` (AC: 1, 3, 4)**
  - [x] Create the architecture-named module `app/integrations/anthropic_client.py` — the "Claude API wrapper (proxy pattern)" slot. [Source: architecture/project-structure-boundaries.md#79; Velara-Architecture-full.md#415]
  - [x] Expose a small, **mockable** seam — a `LLMProvider` Protocol (`def complete(*, system: str, user_content: str, max_tokens: int) -> LLMResult`) plus an `AnthropicProvider` implementation and an `@lru_cache` factory `get_llm_provider()`. Mirror the Protocol+concrete+`@lru_cache` shape of [storage.py](../../../velara-api/app/integrations/storage.py) / [secrets.py](../../../velara-api/app/integrations/secrets.py). The Protocol seam is what unit tests inject a `FakeLLMProvider` into. [Source: integrations/storage.py StorageProvider; integrations/secrets.py SecretsProvider]
  - [x] Use the **sync** `anthropic.Anthropic(api_key=...)` client (the Celery task is a sync context). Call `client.messages.create(model=..., max_tokens=..., system=<skill instructions>, messages=[{"role": "user", "content": <input + document context>}])`. Extract the response text from the `text`-type content blocks (`"".join(b.text for b in resp.content if b.type == "text")`). See Dev Notes → "Claude API call shape" for the exact, version-correct parameters.
  - [x] **Do NOT pass `temperature`, `top_p`, `top_k`, or `thinking={"type":"enabled","budget_tokens":N}`** — these return **HTTP 400** on the default model (Opus 4.x). If you want thinking, use `thinking={"type":"adaptive"}` only. [Source: claude-api skill — Opus 4.8/4.7 removed sampling params + budget_tokens]
  - [x] Set `max_retries` on the client to **3** so the SDK's built-in exponential backoff covers AC4's "3 attempts" for 429/5xx. Surface the SDK's typed exceptions (`anthropic.RateLimitError`, `anthropic.InternalServerError`, `anthropic.APIStatusError`, `anthropic.APIConnectionError`, `anthropic.BadRequestError`, `anthropic.AuthenticationError`) so the task/service can map them to stable error codes. See Dev Notes → "Retry & error mapping". [Source: claude-api skill — error-codes.md typed exceptions]
  - [x] **PHI discipline:** never log the `system`, `messages`, or response text (they may contain PHI) — log only IDs, model id, token counts, and outcome. [Source: PRD SEC-04; architecture/core-architectural-decisions.md#25]

- [x] **Task 3 — Configuration & secrets for the Anthropic key/model (AC: 1, 4)**
  - [x] Add settings to [config.py](../../../velara-api/app/core/config.py) (SCREAMING_SNAKE_CASE, env-sourced, matching the existing pattern): `ANTHROPIC_API_KEY: str = ""`, `ANTHROPIC_MODEL: str = "claude-opus-4-8"`, `ANTHROPIC_MAX_TOKENS: int = 16000`, `ANTHROPIC_MAX_RETRIES: int = 3`, `ANTHROPIC_TIMEOUT_S: float = 120.0`. **Default model is `claude-opus-4-8`** (exact string, no date suffix). [Source: claude-api skill — current models table; config.py existing settings pattern]
  - [x] Extend the `_reject_insecure_defaults_outside_dev` model-validator ([config.py](../../../velara-api/app/core/config.py)) to **fail fast in staging/prod if `ANTHROPIC_API_KEY` is empty** — consistent with the HIPAA "no secrets in code, fail-fast" posture used for `SECRET_KEY`/`DATABASE_URL`. In dev, an empty key is allowed (tests mock the provider). [Source: config.py `_reject_insecure_defaults_outside_dev`]
  - [x] **Key sourcing decision (see Dev Notes → "Where the Anthropic key lives"):** the Anthropic key is a **platform-wide, boot-time** credential → it belongs in `Settings` (env var; injected from Secrets Manager via ECS in prod), **not** routed through `SecretsProvider.get_secret()` (which `secrets.py`'s own docstring reserves for **per-skill/per-execution** connector credentials — Story 3.8). Pass `settings.ANTHROPIC_API_KEY` into the `AnthropicProvider`. [Source: integrations/secrets.py docstring #8-13; config.py #3-6]

- [x] **Task 4 — `execution_service` prompt-runtime router `app/services/execution_service.py` (AC: 1, 2, 3)**
  - [x] Create the architecture-named module `app/services/execution_service.py` — the "skill dispatch: prompt/code/hybrid router" slot. Module-level **async** functions, keyword-only args incl. `session: AsyncSession` (match `job_service`/`ingest_service` shape). [Source: project-structure-boundaries.md#65; Velara-Architecture-full.md#401]
  - [x] `async def execute_skill(*, session, job, llm_provider, skill_storage, output_storage) -> tuple[str, dict]` — the entry the `run_skill` task calls. It: (a) loads the skill + active version via `skill_service.get_skill(...)` (use `job.skill_id`, `job.org_id`); (b) **routes on `skill.runtime_type`** — implement only the `"prompt"` branch; raise `UnsupportedRuntimeError` (stable code `UNSUPPORTED_RUNTIME`) for `code`/`hybrid` so 3.4/3.5 slot in cleanly; (c) calls the prompt runtime; (d) returns `(output_file_key, result_metadata)` to the task. **Do not** call `mark_completed`/`record_entry` here — the task owns lifecycle/audit (the scaffold already does it). Return values only.
  - [x] **Prompt runtime** (`_run_prompt(...)` or a small `runtimes/prompt_runtime.py` — your call; the architecture names no `runtimes/` slot, so a private function in `execution_service.py` is the lighter choice): (1) fetch the skill artifact bytes from the **skill bucket** via `skill_storage.get(version.artifact_key)` (wrap blocking S3 in `run_in_threadpool`); decode as the skill's instruction/system text (see Dev Notes → "Skill artifact format — DECISION NEEDED"); (2) assemble the user content from the invocation inputs + any document context pulled via `ingest_service.build_context_input(...)` per referenced `file_ref_id`; (3) call `llm_provider.complete(...)`; (4) write the output **text** to the output bucket at `outputs/{org_id}/{job_id}.txt` via `output_storage.put(...)` (text/plain; utf-8); (5) return `(output_key, {"format": "text", "char_count": N, "model": settings.ANTHROPIC_MODEL, "input_tokens": ..., "output_tokens": ...})`.
  - [x] **IP protection (AC3):** only the model **output** is written to `invocation_results` / returned. The artifact bytes (instructions/system prompt/reference content) are used to build the request and then discarded — never stored in the DB, never logged, never returned. This is satisfied structurally because `InvocationResult` has no field that could carry them; keep it that way. [Source: PRD ACL-03; architecture #12,26]
  - [x] Define domain exceptions subclassing `VelaraHTTPException` with `ERROR_CODE` (match `job_service`): `UnsupportedRuntimeError` (422, `UNSUPPORTED_RUNTIME`). Map Anthropic transient failures to stable worker error codes (see Task 6 / Dev Notes → "Retry & error mapping") — `LLM_RATE_LIMIT`, `LLM_UNAVAILABLE`, `PROMPT_EXECUTION_ERROR`.

- [x] **Task 5 — Wire the `run_skill` Celery task (AC: 1, 2, 4, 5)**
  - [x] In [execution_tasks.py](../../../velara-api/app/workers/execution_tasks.py), **fill the `# TODO(3.3-3.5)` block** (currently lines ~100-106) to call `execution_service.execute_skill(...)` inside the existing success `session_scope()`, getting providers **directly** (no FastAPI DI): `get_skill_storage()`, `get_output_storage()`, and `get_llm_provider()`. Pass the returned `(output_file_key, result_metadata)` to the existing `job_service.mark_completed(...)` call. Keep the existing success-path audit `record_entry(outcome="success")` and the fresh-session failure handler. [Source: execution_tasks.py#100-129; ingest_tasks.py provider-fetch pattern]
  - [x] **Replace `_get_runtime_type(job)`** (the hardcoded `"prompt"` placeholder, ~line 199) with a real lookup: load the skill (`skill_service.get_skill`) and return `skill.runtime_type` so the audit `runtime_type` is accurate for prompt skills (and correct once 3.4/3.5 land). Snapshot it into `job_ctx` up front so the fresh-session failure handler records the right runtime. [Source: execution_tasks.py#199-207, #89,125]
  - [x] **Retry config on the task decorator:** the task is already `bind=True`. Add `autoretry_for=(anthropic.RateLimitError, anthropic.InternalServerError, anthropic.APIConnectionError)` (plus `anthropic.APIStatusError` filtered to status ≥ 500 if you prefer explicit `self.retry`), `retry_backoff=True`, `retry_backoff_max=...`, `max_retries=3`, and (recommended) `task_time_limit`/`task_soft_time_limit`. **Non-retryable** Anthropic errors (`BadRequestError`, `AuthenticationError`, `PermissionDeniedError`, `NotFoundError`) must **not** retry — let them fall through to the existing `except Exception` → `mark_failed`. After retries exhaust, Celery re-raises into the same handler → `failed`. (The SDK's own `max_retries=3` and the Celery `autoretry_for` are two layers; pick **one** as the authoritative 3-attempt mechanism to avoid 3×3 = 9 effective attempts — see Dev Notes → "Retry & error mapping" for the recommended single-layer choice.) [Source: claude-api skill; celery_app.py has no global retry config — confirmed]
  - [x] **Distinct stable error codes** (mirror Story 3.2's `isinstance` dispatch in [ingest_tasks.py](../../../velara-api/app/workers/ingest_tasks.py)): in the `except`, map `anthropic.RateLimitError`/exhausted → `LLM_RATE_LIMIT`, server/connection → `LLM_UNAVAILABLE`, everything else → `PROMPT_EXECUTION_ERROR` (or keep the existing `SKILL_EXECUTION_ERROR` as the generic). Never store raw exception text; log the real exception via structlog (PHI-sanitized) and re-raise for Sentry. [Source: ingest_tasks.py#159-166; execution_tasks.py#141-194]

- [x] **Task 6 — Invocation endpoint `app/api/v1/invocations.py` + schemas (AC: 6, 3)**
  - [x] Create `app/schemas/invocation.py`: `InvocationRequest` (`file_ref_ids: list[uuid.UUID] = []`, `inputs: dict | None = None`) and `InvocationAccepted` (`job_id: uuid.UUID`, `status: str = "queued"`). Keep the request minimal — **context + inputs only; never skill internals** (the endpoint accepts no prompt/instruction fields). [Source: architecture/core-architectural-decisions.md#39 "Accepts context + inputs only"]
  - [x] Create `app/api/v1/invocations.py` with `router = APIRouter(prefix="/api/v1/invocations", tags=["invocations"])` and the `_meta(request)` helper (copy from [jobs.py](../../../velara-api/app/api/v1/jobs.py)).
  - [x] `POST /{skill_id}` → `ResponseEnvelope[InvocationAccepted]`, `status_code=202`, deps `user: CurrentUser, session: DbSession`. Steps: (1) `skill = await skill_service.get_skill(session=, skill_id=, org_id=user.org_id)` (cross-org → 404); (2) `skill_service.assert_invocable(skill)` → raises `SkillRetiredError` (422 `SKILL_RETIRED`) for retired skills; (3) `job = await job_service.create_job(session=, skill_id=skill.id, skill_version=<skill's current version str>, created_by_user_id=user.user_id, org_id=user.org_id, hierarchy_path="org")`; (4) dispatch `run_skill.delay(str(job.id))`, store `job.celery_task_id = task.id`, commit; (5) return `202` + `job_id`. Use the **atomic-dispatch** discipline from Story 3.2's review (dispatch wrapped/ordered so a broker failure doesn't strand a `queued` job with no task — see Dev Notes → "Dispatch discipline"). [Source: skill_service.assert_invocable #500-507; job_service.create_job #102-129; stories/3-2-document-ingest-pipeline.md#Review Findings (split-commit/orphan)]
  - [x] Register in [router.py](../../../velara-api/app/api/v1/router.py): add `invocations` to the import and `api_router.include_router(invocations.router)`.
  - [x] **Phase-1 note on `file_ref_ids` → job linkage:** there is **no** `file_ref_id` column on `InvocationJob` today. For Phase 1, persist the referenced file refs in a way the task can read them back (recommended: a small `job_inputs`/`result_metadata`-style JSONB on the request side, OR store them on a new nullable JSONB column — see Dev Notes → "How the task gets file_ref_ids — DECISION NEEDED"). Keep it minimal; multi-file orchestration is later-story scope. [Source: stories/3-2 Scope Boundary "multiple files per invocation → runtime stories"; ING-01]

- [x] **Task 7 — Tests (AC: all)**
  - [x] Unit `tests/unit/services/test_execution_service.py`: inject a `FakeLLMProvider` + fake storages; assert a `prompt` skill routes to the prompt runtime, calls the provider with the artifact text as `system` and the assembled context as user content, writes the output to the output bucket, and returns `(output_file_key, result_metadata)`. Assert `code`/`hybrid` runtime_type → `UnsupportedRuntimeError`. Assert document context is pulled via `build_context_input` (mock it). [Source: ingest_service unit-test mock-the-provider pattern]
  - [x] Unit `tests/unit/integrations/test_anthropic_client.py`: with the `anthropic` client **mocked**, assert the request is built with `system`/`messages`/`max_tokens`/`model` and **without** `temperature`/`top_p`/`budget_tokens`; assert text extraction from mixed content blocks; assert typed exceptions surface for mapping. **No real network call.**
  - [x] Unit/worker `tests/unit/workers/test_execution_tasks.py` (or extend the existing 3.1 worker test): assert the retry/error-code mapping (rate-limit → `LLM_RATE_LIMIT`, server → `LLM_UNAVAILABLE`, other → generic) and that `_get_runtime_type` now reads `skill.runtime_type`. **Reuse the 3.1 learning:** `asyncio.run()` inside the task can't run on pytest-asyncio's loop — call the service functions in the same order as the task, or use `celery_eager` only where the task body doesn't re-enter `asyncio.run`. Reuse `dispose_engine_after_test`. [Source: tests/integration/workers/test_execution_tasks.py#6-23, #62-76]
  - [x] Integration `tests/integration/api/test_invocations.py`: follow the **skip-guard + `_auth_headers`** dev-JWT pattern from [test_jobs.py](../../../velara-api/tests/integration/api/test_jobs.py). Cover: `POST /api/v1/invocations/{skill_id}` for a `prompt` skill returns `202` + `job_id` and creates a `queued` job; invoke a **retired** skill → 422 `SKILL_RETIRED`; cross-org skill → 404; **IP-protection assertion** — the `202` body and the subsequent `GET /api/v1/jobs/{job_id}` body contain **no** artifact/instruction/system-prompt fields (only status + result references). For the happy-path execution, **mock the LLM provider** (seam from Task 2) so no real Anthropic call is made; assert the job reaches `completed` with an output object in the output bucket and a `success` audit row. Seed skills/jobs with the `_create_*_in_db` direct-insert helper style. [Source: test_jobs.py; conftest.py `celery_eager`]
  - [x] **Gates before marking done:** `ruff check .` clean (line-length 100; rules `E,F,I,B,UP,W`; `B008` ignored) AND the **full Docker test suite green** (rebuild first — new `anthropic` dep). No real Anthropic network calls in CI. [Source: Story 3.1/3.2 gates]

## Dev Notes

### Scope Boundary (read this first)

- **In scope:** `anthropic` dependency; `integrations/anthropic_client.py` (Claude wrapper + `LLMProvider` seam); `services/execution_service.py` (runtime router — **prompt branch only**); the prompt runtime (artifact → Claude → output-bucket text); wiring the `run_skill` `# TODO(3.3-3.5)` seam + real `_get_runtime_type`; retry/backoff + stable error codes; **the `POST /api/v1/invocations/{skill_id}` endpoint** + `schemas/invocation.py`; Anthropic config/secrets + prod fail-fast; audit `runtime_type="prompt"`.
- **Out of scope (do NOT build — collides with later stories):**
  - **Code runtime** (`runtime_type:"code"` → subprocess sandbox, 300s timeout, `EXECUTION_TIMEOUT`, network-block) → **Story 3.4**. Route it to `UnsupportedRuntimeError` here. [Source: epic-3#107-133]
  - **Hybrid runtime** (Claude tool-use loop, `tool_use`/`tool_result`, `is_error`) → **Story 3.5**. [Source: epic-3#137-159]
  - **Branded output generation** (PDF/PPTX/DOCX/XLSX writers, `output_tasks.py`, 24h presigned download URLs as a *deliverable* format) → **Story 3.6**. 3.3 writes **plain text** output only. [Source: epic-3#163-193]
  - **Location-dependent fan-out** (`fan_out_locations`/`aggregate_results` chord, `LOCATION_REQUIRED`, per-location context, parent/child audit) → **Story 3.7** (deferred after Epic 4). Leave `AuditLogEntry.fan_out`/`invocation_id` at defaults. [Source: epic-3#197-199]
  - **Connector framework / external-API credential injection** (`SecretsProvider`-backed per-skill creds, `MISSING_CREDENTIAL`, `IngestConnector`/`OutputConnector`) → **Story 3.8**. Do **not** route the Anthropic key through `SecretsProvider`. [Source: epic-3#233-251; secrets.py docstring]
  - **WebSocket job status** — Phase 2; polling only. Reuse the existing `GET /api/v1/jobs/{job_id}` from 3.1. [Source: core-architectural-decisions.md#38]
  - **Skill-chaining / subroutines** (EXE-06) → Phase 2. [Source: PRD EXE-06]

### Tech stack (exact versions — all already in [pyproject.toml](../../../velara-api/pyproject.toml) except the `anthropic` SDK)

- Python ≥3.12, FastAPI 0.115.6, SQLAlchemy 2.0.36 (async), asyncpg 0.29.0, Alembic 1.13.3, Pydantic 2.10.4, pydantic-settings 2.6.1.
- Celery 5.4.0 (`celery[redis]`), redis 5.2.1 (broker + backend, single `REDIS_URL`). boto3 1.35.71 (S3/MinIO) — already present.
- structlog 24.4.0 (PHI-sanitized logging), sentry-sdk[fastapi,celery] 2.19.2 (CeleryIntegration auto-captures task exceptions; `init_sentry` wired in web + worker).
- **NEW: `anthropic` (official Python SDK)** — the only new package. `httpx==0.27.2` (SDK backend) already present. [Source: claude-api skill]
- Dev/test: ruff 0.6.9, pytest 8.3.4, pytest-asyncio 0.24.0 (`asyncio_mode="auto"`), httpx 0.27.2.

### Claude API call shape (version-correct — from the `claude-api` skill)

Use the official `anthropic` Python SDK. The Celery task is **sync**, so use the **sync** client:

```python
import anthropic

client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, max_retries=3, timeout=120.0)

resp = client.messages.create(
    model=settings.ANTHROPIC_MODEL,        # default "claude-opus-4-8"
    max_tokens=settings.ANTHROPIC_MAX_TOKENS,  # ~16000 non-streaming is safe
    system=skill_instruction_text,         # the skill artifact text — separate param, NOT a message
    messages=[{"role": "user", "content": assembled_user_content}],
    # NO temperature / top_p / top_k / budget_tokens — they 400 on Opus 4.x
)
output_text = "".join(b.text for b in resp.content if b.type == "text")
in_toks, out_toks = resp.usage.input_tokens, resp.usage.output_tokens
```

- **Model:** default `claude-opus-4-8` (exact string — **never** append a date suffix). Configurable via `ANTHROPIC_MODEL`. [Source: claude-api skill — current models table]
- **`max_tokens` is required.** ~16000 is safe non-streaming (the SDK raises `ValueError` for non-streaming requests it estimates will exceed ~10 min; for very large outputs use `client.messages.stream(...)` + `.get_final_message()`). Phase-1 prompt skills are short-to-moderate output → non-streaming is fine; make the cap a setting. [Source: claude-api skill — streaming.md, max_tokens guidance]
- **Adaptive thinking only** if you want thinking: `thinking={"type":"adaptive"}`. `{"type":"enabled","budget_tokens":N}` returns 400. Omitting `thinking` = no thinking (fine for Phase 1). [Source: claude-api skill]
- **API key:** the SDK reads `ANTHROPIC_API_KEY` from env by default; we pass it explicitly from `Settings` so it's testable and prod-injected. [Source: claude-api skill — client init]

### Where the Anthropic key lives (config vs SecretsProvider)

The Anthropic API key is a **platform-wide, read-once-at-boot** credential → it belongs in `Settings`/`config.py` as an env var (in ECS injected from AWS Secrets Manager via the task definition, exactly like `SENTRY_DSN`/`SECRET_KEY`/`DATABASE_URL`). **Do NOT** route it through `SecretsProvider.get_secret()` — `secrets.py`'s own docstring reserves that abstraction for **dynamic per-skill connector credentials fetched at execution time** (Story 3.8), and explicitly says "config.py holds static app config … Do NOT route app config through SecretsProvider." [Source: integrations/secrets.py#8-13; core-architectural-decisions.md#24 (Secrets Manager + ECS injection); config.py#3-6] Add the prod fail-fast guard so an empty key can't reach staging/prod. [Source: config.py `_reject_insecure_defaults_outside_dev`]

### Retry & error mapping (AC4) — pick ONE retry layer

AC4 = **3 attempts** with exponential backoff for **rate-limit (429)** and **server (5xx/529)** errors; immediate `failed` for non-retryable client errors (400/401/403/404). Two mechanisms exist — **use exactly one** as the authoritative 3-attempt counter, or they compound (SDK `max_retries=3` × Celery `max_retries=3` = up to 9 calls):

- **Recommended: let the Anthropic SDK own retries.** Set `max_retries=3` on the `anthropic.Anthropic(...)` client (it already does exponential backoff on 429 + ≥500 + connection errors, and does **not** retry 4xx-except-429). Then **do not** add `autoretry_for` for Anthropic errors on the Celery task — when the SDK's retries exhaust it raises the typed exception, which the task's existing `except Exception` turns into `mark_failed`. Simpler, fewer moving parts, and the backoff is inside one network boundary.
- **Alternative: Celery owns retries.** Set the SDK `max_retries=0` and add `autoretry_for=(RateLimitError, InternalServerError, APIConnectionError)`, `retry_backoff=True`, `max_retries=3` on `@celery.task`. Use this only if you want the retries visible as Celery task retries (e.g. for Flower/metrics). Filter `APIStatusError` to `status_code >= 500`.
- **Error-code mapping** (stable, SCREAMING_SNAKE_CASE, never raw text): `RateLimitError`/retries-exhausted-429 → `LLM_RATE_LIMIT`; `InternalServerError`/`OverloadedError`/`APIConnectionError`/`APIStatusError(>=500)` → `LLM_UNAVAILABLE`; `BadRequestError`/`AuthenticationError`/everything else → `PROMPT_EXECUTION_ERROR`. Mirror Story 3.2's `isinstance(exc, ...)` dispatch in the failure handler. [Source: claude-api skill — error-codes.md typed exceptions; ingest_tasks.py#159-166]
- Typed exceptions: `anthropic.RateLimitError` (429), `anthropic.InternalServerError` (500), `anthropic.OverloadedError` (529), `anthropic.APIStatusError` (`.status_code`), `anthropic.APIConnectionError` (network/timeout), `anthropic.BadRequestError` (400), `anthropic.AuthenticationError` (401). [Source: claude-api skill]

### Skill artifact format — **DECISION NEEDED** (default chosen, flag at review)

`skill_service.create_skill(initial_content: str, content_type)` stores the skill as a **single opaque text blob** (`initial_content.encode()`) at `artifact_key` — there is **no** structured schema separating "system prompt" vs "instructions" vs "reference files" in the current model. [Source: skill_service.py#227-249, #400-437 — confirmed]

- **Default for Story 3.3:** treat the entire artifact text as the prompt skill's **instruction/system content** → pass it as the Claude `system=` parameter; put the caller's runtime inputs + document context into the `user` message. This is the minimal, correct interpretation of EXE-01 ("an instruction set, context, and optional reference files passed to an LLM"). [Source: PRD EXE-01]
- **If a structured artifact format is desired** (e.g. JSON with `system_prompt` + `instructions` + `reference_keys`), that is a larger change to the skill authoring/storage contract (Story 2.x territory) and should be raised — do **not** invent a new artifact schema inside 3.3. Flag this as an open question in the Dev Agent Record.

### How the task gets `file_ref_ids` — **DECISION NEEDED** (keep minimal)

`InvocationJob` has **no** `file_ref_id`/inputs column today. The invocation request carries `file_ref_ids`, but the `run_skill` task only receives `job_id`. Options (pick the lightest that's forward-compatible):

- **Recommended (Phase 1):** add a single nullable `inputs` JSONB column to `InvocationJob` (migration `0008`) storing `{"file_ref_ids": [...], "inputs": {...}}`; the endpoint writes it at `create_job` time, the task reads it. One small migration, no new table, and 3.7 multi-file/fan-out can build on it. (Confirm `create_job`'s signature is extended or the endpoint sets the column post-create.)
- **Alternative (no migration):** stash the refs in `result_metadata` on a pre-created result row — rejected (results are output-only; conflates input/output).
- Whatever you choose, **the document content still travels by S3 key only** — the task calls `build_context_input(...)` per `file_ref_id` to pull parsed text at execution time; raw file content never rides in the request or the job row. [Source: ingest_service.build_context_input #355-384; architecture #138 file-by-key]

### `build_context_input` seam (Story 3.2)

`async def build_context_input(*, session, output_storage, file_ref_id, org_id) -> str` — loads the `FileReference` (org-scoped, must be `parsed`), reads `parsed_content_key` from the **output** bucket, returns the parsed text. Raises `FileRefNotFoundError` (404) / `FileRefNotReadyError` (422, status≠`parsed`). Call it once per referenced `file_ref_id` and concatenate into the user content (label each so Claude can tell documents apart). It already wraps its S3 `get` in `run_in_threadpool`, so it's safe inside the task's `asyncio.run(_execute())`. [Source: ingest_service.py#355-384]

### Reusing the `run_skill` scaffold (Story 3.1) — exact wiring points

The task already does the heavy lifting; 3.3 fills two holes:
- **The success seam:** [execution_tasks.py](../../../velara-api/app/workers/execution_tasks.py) ~line 100 `# TODO(3.3-3.5): execution_service routing goes here` → call `execution_service.execute_skill(...)`, set `output_file_key`/`result_metadata`, then the existing `mark_completed(...)` (~line 111) persists the result + `completed`. The success audit `record_entry(outcome="success", runtime_type=...)` (~line 119) already fires. [Source: execution_tasks.py#100-129]
- **The runtime_type placeholder:** `_get_runtime_type(job)` (~line 199) returns hardcoded `"prompt"` → replace with `skill_service.get_skill(...).runtime_type`. Snapshot into `job_ctx` (~line 89) so the fresh-session failure handler (~line 174) records the correct runtime on failure too. [Source: execution_tasks.py#89,125,199-207]
- **Lifecycle/audit ownership:** the task owns `mark_running`/`mark_completed`/`mark_failed` + audit (do not duplicate in `execution_service`). Storage/providers are fetched **directly** inside the task (`get_skill_storage()`/`get_output_storage()`/`get_llm_provider()`) — no FastAPI DI, no `run_in_threadpool` *around provider calls in the task* (that's only for request handlers; `build_context_input` wraps its own). [Source: ingest_tasks.py provider fetch; dependencies.py async-safety note]

### Job lifecycle & result storage (Story 3.1 services to reuse)

- `job_service.create_job(*, session, skill_id, skill_version, created_by_user_id, org_id, hierarchy_path)` → `queued` job (commits). Endpoint stores `celery_task_id` after dispatch. [Source: job_service.py#102-129]
- `job_service.mark_running/mark_completed/mark_failed` — all guarded by `_guard_not_terminal` (idempotent for Celery re-delivery; important under retries). `mark_completed(*, session, job, output_file_key=, result_metadata=)` writes the `InvocationResult` row. `error_code` only, never raw text. [Source: job_service.py#206-289]
- `InvocationResult`: `output_file_key` (S3 key, output bucket — **never inline**), `result_metadata` (JSONB). 3.3 writes the Claude output text to S3 and stores the key. [Source: invocation.py#117-159; enforcement rule #6 — never store file content inline]
- Status machine: `queued → running → completed/failed`; `queued → cancelled`. [Source: invocation.py#5-9]

### Audit log (Story 3.1) — AC5

`audit_service.record_entry(*, session, skill_id, skill_version, user_id, hierarchy_path, runtime_type, outcome, fan_out=False, invocation_id=None, started_at=None, completed_at=None, error_code=None)` — the **only** writer (append-only, DB-trigger-enforced, migration 0006). Validates `outcome ∈ {success,failure,cancelled}` and `runtime_type ∈ {prompt,code,hybrid}` (a bad value raises `ValueError` — and `"llm"` is explicitly invalid; **use `"prompt"`**). Constants in `app/models/audit.py`: `OUTCOME_SUCCESS/_FAILURE/_CANCELLED`, `RUNTIME_PROMPT/_CODE/_HYBRID`. The scaffold already writes success + failure entries; 3.3 only makes `runtime_type` real. [Source: audit_service.py#37-94; models/audit.py#22-30; tests/unit/services/test_audit_service.py#105 (`"llm"` rejected)]

### IP protection (AC3) — the load-bearing guarantee

This is the defining constraint. The architecture enforces it **structurally**, not by field-stripping:
- Skill internals live as **S3-keyed artifacts**; **no** read route exposes them to client-scoped tokens — enforced at the **API router prefix**, not just RBAC. [Source: architecture #12,15,26,136,150; PRD ACL-05]
- The invocation/job/result path carries **only** output: `InvocationResult` has only `output_file_key` + `result_metadata`; `JobRead*`/job responses surface status + result references. There is **no field** that could carry prompt/system/reference content — keep it that way. [Source: PRD ACL-03/04; invocation.py]
- **Errors** carry only `{code, message, request_id}`, PHI-safe; never echo artifact bytes or raw Claude errors. [Source: core-architectural-decisions.md#41; PRD SEC-04]
- Phase-1 acceptance gate: "A client-facing skill invocation returns output only — no internals exposed via any API call." [Source: PRD §9]

### Dispatch discipline (carry Story 3.2's review fix forward)

Story 3.2's review found a split-commit orphan bug (commit `confirmed` → `.delay()` can fail → row stranded). Apply the same fix here: in the invocation endpoint, dispatch `run_skill.delay(...)` and persist `celery_task_id` such that a broker failure does **not** leave a `queued` job with no task — either dispatch-then-commit atomically, or mark the job `failed`/roll back if dispatch raises. [Source: stories/3-2-document-ingest-pipeline.md#Review Findings — "Confirm splits one logical transition across two commits"]

### Async safety & Celery context

- Request handlers (invocation endpoint): `create_job` is async DB work; `run_skill.delay()` is a blocking broker publish → wrap in `run_in_threadpool` (Story 3.2's review folded the broker publish into threadpool — match it). [Source: stories/3-2 Review Findings; dependencies.py async-safety note]
- Celery task: `asyncio.run(_execute())` bridges sync→async; DB via `session_scope()`; providers fetched directly (sync). `anthropic.Anthropic()` sync client is correct here (no event loop needed). [Source: execution_tasks.py#15-17, #196]

### Running tests (critical — Docker source is baked, not mounted)

- **PITFALL (Story 2.3/3.1/3.2):** `api`/`worker` containers `build:` the image with **no source volume mount**. New code/deps are invisible until rebuild: `docker compose build api worker && docker compose up -d`. After adding `anthropic` this rebuild is mandatory or the worker `ModuleNotFoundError`s. [Source: stories/3-1#Running tests; 3-2 Debug Log]
- Migration (if you add the `inputs` column): `docker compose exec api alembic upgrade head`; verify round-trip `alembic downgrade -1` then `upgrade head`. Chain the new migration to the current head (verify with `alembic heads` — current head is `0007_file_references`).
- Unit tests (no services, **no network**): `pytest tests/unit/` — inject `FakeLLMProvider` + mock storages; mock the `anthropic` client. **No real Anthropic API calls in any test.**
- Integration (need Postgres + MinIO + Redis): `docker compose up -d` then `docker compose exec api pytest tests/integration/api/test_invocations.py`. Skip-guard auto-skips if services unreachable. Mock the LLM provider for the happy path.
- Integration auth: copy `_auth_headers` from [test_jobs.py](../../../velara-api/tests/integration/api/test_jobs.py) — mint a dev JWT via `DevAuthProvider().issue_token(principal)` (seed users `ma.tech`/`consultant`/`client.user`). Use `client.user` (org_client_001) for cross-org → 404 and for the IP-protection (client-scoped) assertion.
- Celery: `celery.conf.task_always_eager = True` via the `celery_eager` fixture ([conftest.py](../../../velara-api/tests/conftest.py)) so `run_skill` runs in-process — but mind the **3.1 learning**: `asyncio.run()` inside the task can't be called from pytest-asyncio's running loop. For task-logic tests, call the service functions in the same order, or assert via the API with the provider mocked. Reuse `dispose_engine_after_test`. [Source: stories/3-1#Debug Log; tests/integration/workers/test_execution_tasks.py]
- Lint: `ruff check .` (line-length 100, `E,F,I,B,UP,W`, `B008` ignored).

### Project Structure Notes

New/modified files (all under `velara-api/`), aligned with the architecture's named structure [Source: architecture/project-structure-boundaries.md#39-79, #176-188]:

| File | Action | Purpose |
|------|--------|---------|
| `app/integrations/anthropic_client.py` | NEW | Claude wrapper + `LLMProvider` Protocol + `get_llm_provider()` — fills the architecture's `anthropic_client.py` slot |
| `app/services/execution_service.py` | NEW | prompt/code/hybrid router (prompt branch only) — fills `execution_service.py` slot |
| `app/workers/execution_tasks.py` | MODIFY | fill the `# TODO(3.3-3.5)` seam; real `_get_runtime_type`; retry config + error-code mapping |
| `app/api/v1/invocations.py` | NEW | `POST /api/v1/invocations/{skill_id}` — fills `invocations.py` slot |
| `app/schemas/invocation.py` | NEW | `InvocationRequest`, `InvocationAccepted` |
| `app/api/v1/router.py` | MODIFY | register invocations router |
| `app/core/config.py` | MODIFY | `ANTHROPIC_*` settings + prod fail-fast guard |
| `app/models/invocation.py` | MODIFY (if chosen) | nullable `inputs` JSONB column for `file_ref_ids`/inputs |
| `app/db/migrations/versions/0008_*.py` | NEW (if chosen) | add `inputs` column (down_revision `0007_file_references`) |
| `pyproject.toml` | MODIFY | add `anthropic` |
| `tests/unit/services/test_execution_service.py` | NEW | |
| `tests/unit/integrations/test_anthropic_client.py` | NEW | |
| `tests/unit/workers/test_execution_tasks.py` | NEW/EXTEND | retry/error-code + runtime_type |
| `tests/integration/api/test_invocations.py` | NEW | |

The architecture names exactly these execution slots (`api/v1/invocations.py`, `services/execution_service.py`, `integrations/anthropic_client.py`, `workers/execution_tasks.py`) — this story populates them. **One architecture inconsistency to follow the AC on:** the architecture shows both `POST /api/v1/invoke/{skill_id}` (#39,163) and `POST /api/v1/invocations/{skill_id}` (#189,525, and the `invocations.py` file slot #181). Use the **plural `/invocations/{skill_id}`** form — it matches the file-mapping, the data-flow diagram, REST plural-noun convention, and Story 3.1's cited entrypoint. [Source: Velara-Architecture-full.md#161-163 vs #189,525,181]

### References

- [Source: epics/epic-3-skill-execution-engine.md#Story 3.3] — story statement + all 5 ACs (prompt routing, result→completed, IP-protection output-only, retry 3-attempts, audit entry).
- [Source: epics/epic-3-skill-execution-engine.md#Story 3.4/3.5/3.6/3.7/3.8] — out-of-scope runtimes/output/fan-out/connectors.
- [Source: prds/.../5-functional-requirements.md] — EXE-01 (prompt = instructions+context+reference files → LLM → output), EXE-04 (execution logged), REG-03 (runtime_type), INV-01 (server-side, output-only, internals never leave server), ACL-03/04/05 (IP protection), USE-01 (invocation log fields), SEC-04 (no PHI in logs/URLs/errors).
- [Source: prds/.../6-non-functional-requirements.md] — ≤2s P95 platform overhead **excluding skill runtime**; zero silent failures (every failure logged + surfaced); SEC-01/02/03 (BAA, AES-256, TLS1.2+). Note: PRD specifies **no** LLM timeout/retry-count/rate-limit/cost NFR — AC4's "3 attempts" comes from the epic, the rest are design choices.
- [Source: prds/.../9-phase-1-acceptance-criteria.md] — "at least one prompt-based skill invoked successfully and logged"; "client-facing skill invocation returns output only — no internals exposed".
- [Source: architecture/Velara-Architecture-full.md#161-163,189,524-525] — Claude proxy endpoint; invocation data flow (RunConsole → POST invocations → queued job → run_skill → execution_service routes → Claude → result → S3 + InvocationResult → completed → poll jobs).
- [Source: architecture/Velara-Architecture-full.md#331,138] — never store file content inline (S3-key+metadata); file-by-key PHI rule.
- [Source: architecture/core-architectural-decisions.md#12,15,24,26,38,39,41,75-79] — skill-artifact model + IP protection at router layer; Secrets Manager + ECS injection; polling not WebSocket Phase 1; error envelope; provider abstractions (storage/secrets/auth — **no** LLM provider mandated, so the `LLMProvider` Protocol is a net-new convenience).
- [Source: architecture/project-structure-boundaries.md#65,72,79,181,176-188] — named slots `execution_service.py`, `execution_tasks.py (run_skill, fan_out_locations, aggregate_results)`, `anthropic_client.py`, `invocations.py`; FR→structure mapping `EXE-01..06 → execution_service + execution_tasks + anthropic_client`.
- [Source: velara-api/app/workers/execution_tasks.py#33,36,89,100-129,141-194,199-207] — `run_skill` scaffold, `# TODO(3.3-3.5)` seam, `_get_runtime_type` placeholder, fresh-session failure handler, `ERROR_CODE_SKILL_EXECUTION_ERROR`.
- [Source: velara-api/app/services/job_service.py#102-129,206-289] — `create_job`, `mark_running/completed/failed`, `_guard_not_terminal`, `ERROR_CODE` exception pattern, org-scope.
- [Source: velara-api/app/services/audit_service.py#37-94; app/models/audit.py#22-30] — `record_entry` signature + validation + constants (`"prompt"` valid, `"llm"` invalid).
- [Source: velara-api/app/services/skill_service.py#227-249,308,400-437,500-507] — opaque text artifact (`initial_content.encode()` → `artifact_key`), `get_skill`, `assert_invocable`/`SkillRetiredError`.
- [Source: velara-api/app/services/ingest_service.py#355-384] — `build_context_input` seam (args/returns/exceptions, threadpool-wrapped get).
- [Source: velara-api/app/models/skill.py#46-67,147-151] — `Skill.runtime_type`, `current_version_id`; `SkillVersion.artifact_key`/`artifact_checksum`.
- [Source: velara-api/app/models/invocation.py#27-159] — job/result models, status constants, `InvocationResult.output_file_key`/`result_metadata`, `celery_task_id`.
- [Source: velara-api/app/integrations/storage.py#199-201; secrets.py#8-13] — `get_skill_storage()`/`get_output_storage()`; SecretsProvider reserved for per-skill creds (key goes in config, not secrets).
- [Source: velara-api/app/core/config.py#52-66,109-135] — settings pattern, backend selectors, `_reject_insecure_defaults_outside_dev` fail-fast validator.
- [Source: velara-api/app/api/v1/jobs.py, app/api/v1/router.py, app/schemas/common.py, app/core/exceptions.py] — router/`_meta`/`ResponseEnvelope`/domain-exception patterns; router registration.
- [Source: velara-api/tests/conftest.py; tests/integration/api/test_jobs.py; tests/integration/workers/test_execution_tasks.py] — `celery_eager`, `dispose_engine_after_test`, skip-guard + `_auth_headers`, the asyncio.run-in-task vs pytest-asyncio-loop learning.
- [Source: stories/3-1-async-job-infrastructure.md] — scaffold design intent, Scope Boundary deferring the invocation endpoint to 3.3, Celery sync-context DB/storage rules, Docker-rebuild PITFALL.
- [Source: stories/3-2-document-ingest-pipeline.md#Review Findings] — atomic-dispatch / no-orphan discipline, threadpool-wrap the broker publish, distinct-error-code `isinstance` dispatch.
- [Source: claude-api skill — python/claude-api/README.md, streaming.md, shared/error-codes.md, shared/models.md] — `anthropic.Anthropic()` sync client, `messages.create(system=, messages=, max_tokens=, model=)`, default `claude-opus-4-8`, Opus 4.x removed `temperature`/`top_p`/`top_k`/`budget_tokens` (400), adaptive thinking only, SDK auto-retry 429/5xx with `max_retries` (default 2; set 3), typed exceptions (`RateLimitError`/`InternalServerError`/`OverloadedError`/`APIStatusError`/`APIConnectionError`/`BadRequestError`/`AuthenticationError`), non-streaming `ValueError` guard for large `max_tokens` → stream for big outputs.

## Review Findings

_Code review 2026-06-11 (adversarial 3-layer: Blind Hunter + Edge Case Hunter + Acceptance Auditor). Scope: Story 3.3 file set only (3.2 ingest excluded — already done). All 6 ACs verified; AC1/AC2/AC3/AC4/AC5 fully satisfied, AC6 satisfied except the dispatch-atomicity bug below. Single-retry-layer (SDK `max_retries=3`, no Celery autoretry), Opus-4.x forbidden-param omission, and prod fail-fast on empty `ANTHROPIC_API_KEY` all confirmed correct._

**Decision-needed (resolved 2026-06-11):**

- Retired/cross-state skill executed at runtime — **DISMISSED** (accepted): the queue-then-retire window is small and the spec only mandates the endpoint-time guard; the runtime re-check cost is not warranted for phase 1.
- `file_ref_id` not-ready/not-found/cross-org → opaque error — **→ PATCH** (validate at request time): see patch below.
- Empty Claude response → 0-byte output marked `completed` — **→ PATCH** (surface `stop_reason`): see patch below.

**Patches (applied & verified 2026-06-11 — 313 Docker tests pass, ruff clean, migration round-trip OK):**

- [x] [Review][Patch] Stranded `queued` job on broker dispatch failure — `rollback()` is a no-op after `create_job` already committed [app/api/v1/invocations.py] — **FIXED:** on a `run_skill.delay` failure the endpoint now marks the already-committed job `failed` (error_code `DISPATCH_FAILED`) in a fresh session via new `job_service.get_job_unscoped` + `mark_failed`, instead of a no-op rollback. New integration test `test_dispatch_failure_marks_job_failed_not_stranded` asserts the job is `failed`, never stranded `queued`. Raised independently by all 3 review layers.
- [x] [Review][Patch] `execute_skill` block does not guard `job is None` → `AttributeError` mis-mapped to `SKILL_EXECUTION_ERROR` [app/workers/execution_tasks.py] — **FIXED:** added `if job is None: return {"status": "not_found"}` guard in the execution block, mirroring the other three fetch sites.
- [x] [Review][Patch] `skill_version="unknown"` tolerated at the endpoint but `_run_prompt` hard-raises [app/api/v1/invocations.py] — **FIXED:** endpoint now raises `NoCurrentVersionError` (422 `SKILL_NO_CURRENT_VERSION`) synchronously when the current version can't be resolved, instead of queueing a job pinned to a bogus `"unknown"` version.
- [x] [Review][Patch] 413 `RequestTooLargeError` (status < 500) unmapped → generic `SKILL_EXECUTION_ERROR` [app/workers/execution_tasks.py] — **FIXED:** added `anthropic.APIStatusError` with `400 <= status_code < 500` → `PROMPT_EXECUTION_ERROR`. New unit test `test_request_too_large_413_maps_to_prompt_execution_error`.
- [x] [Review][Patch] `ANTHROPIC_MAX_TOKENS`/`MAX_RETRIES`/`TIMEOUT_S` unvalidated bare ints [app/core/config.py] — **FIXED:** `Field(gt=0, le=16000)` on max_tokens (caps at the non-streaming-safe ceiling, fail-fast at settings load), `ge=0` on retries, `gt=0` on timeout.
- [x] [Review][Patch] Silent `except Exception: pass` mislabels audit `runtime_type` / masks DB errors [app/workers/execution_tasks.py] — **FIXED:** narrowed to `except skill_service.SkillNotFoundError` (the only case where the "prompt" fallback is harmless); other errors (DB connectivity) now propagate instead of being swallowed and mislabeled.
- [x] [Review][Patch] Validate `file_ref_ids` at request time (resolved decision) [app/api/v1/invocations.py + ingest_service.py] — **FIXED:** new `ingest_service.assert_file_ref_ready` reused by the endpoint to verify each ref exists/in-org/`parsed` before queueing → 404 `FILE_REF_NOT_FOUND` / 422 `FILE_REF_NOT_READY`. New integration test `test_invoke_with_unknown_file_ref_returns_404`.
- [x] [Review][Patch] Surface `stop_reason` for empty/refused Claude responses (resolved decision) [anthropic_client.py + execution_service.py] — **FIXED:** `stop_reason` added to `LLMResult` (from `resp.stop_reason`) and into `result_metadata`; an empty/refused generation (char_count 0 + stop_reason "refusal"/"max_tokens") is now distinguishable from a normal `end_turn` success. New unit tests in test_anthropic_client + test_execution_service.

**Deferred (logged, not blocking):**

- [x] [Review][Defer] Unbounded concatenated context — no token/byte cap before the Claude call [app/services/execution_service.py:156-178] — deferred, multi-file/context-size governance is later-story (3.7 fan-out) scope per the Scope Boundary; phase-1 prompt skills are short-to-moderate.
- [x] [Review][Defer] `get_llm_provider()` lru-cached on an empty API key in dev → first real call fails late as 401 → `PROMPT_EXECUTION_ERROR` [app/integrations/anthropic_client.py:128-137] — deferred, dev-only (staging/prod is fail-fast guarded); cosmetic error-code clarity only.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code)

### Debug Log References

- **anthropic.OverloadedError AttributeError**: `anthropic==0.50.0` does not have `OverloadedError`; HTTP 529 maps to `APIStatusError` with `status_code >= 500`. Removed from isinstance check.
- **F401 unused import**: Local `import anthropic` inside `complete()` and `_execute()` — removed; SDK imported in `__init__`.
- **I001 unsorted imports**: Auto-fixed via `ruff check . --fix` in three test files.
- **UP038 isinstance tuple**: Changed `isinstance(exc, (A, B))` to `isinstance(exc, A | B)`.
- **test_execution_service mock target**: `get_skill` and `build_context_input` were function-local imports; moved to module-level in `execution_service.py` so tests can patch at `app.services.execution_service.get_skill`.
- **Integration test event-loop conflict**: `celery_eager` + `asyncio.run()` inside Celery task creates a new event loop, conflicting with asyncpg connections bound to the test's loop. Fixed: moved `run_skill` import to module-level in `invocations.py`; removed `celery_eager` from tests that trigger execution; patched `app.api.v1.invocations.run_skill.delay` instead.

### Completion Notes List

- **Skill artifact format decision**: Entire artifact blob treated as Claude `system=` parameter (opaque text). No structured schema change needed for Story 3.3.
- **Single retry layer**: SDK `max_retries=3` owns backoff for 429/5xx. No Celery `autoretry_for` for Anthropic errors (avoids 3×3=9 calls).
- **ANTHROPIC_API_KEY**: Platform-wide boot-time credential in `Settings`/`config.py` — NOT routed through `SecretsProvider` (reserved for per-skill connectors, Story 3.8).
- **inputs JSONB column**: Migration `0008_invocation_job_inputs` adds nullable `inputs` JSONB to `invocation_jobs`; chained to `0007_file_references`.
- **IP protection**: Structural — `InvocationResult` has no field that could carry skill internals; artifact bytes discarded after Claude call. Never logged.
- **307 tests pass** (163 pre-existing + 26 new Story 3.3 + 18 Story 3.2 ingest); `ruff check .` clean.

### File List

**New files:**
- `app/integrations/anthropic_client.py`
- `app/services/execution_service.py`
- `app/api/v1/invocations.py`
- `app/schemas/invocation.py`
- `app/db/migrations/versions/0008_invocation_job_inputs.py`
- `tests/unit/integrations/test_anthropic_client.py`
- `tests/unit/services/test_execution_service.py`
- `tests/unit/workers/__init__.py`
- `tests/unit/workers/test_execution_tasks.py`
- `tests/integration/api/test_invocations.py`

**Modified files:**
- `pyproject.toml` — added `anthropic==0.50.0`
- `app/core/config.py` — `ANTHROPIC_*` settings + prod fail-fast guard
- `app/models/invocation.py` — `inputs` JSONB column
- `app/models/__init__.py` — (auto-updated)
- `app/services/job_service.py` — `create_job` accepts `inputs` param
- `app/workers/execution_tasks.py` — filled `# TODO(3.3-3.5)` seam; real `runtime_type` lookup; error-code mapping; time limits
- `app/api/v1/invocations.py` — module-level `run_skill` import (for testability)
- `app/api/v1/router.py` — registered `invocations` router
