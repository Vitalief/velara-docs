---
baseline_commit: 78f5406706ddcf735a28a31fb21ed8135b0296ff
---

# Story 3.2: Document Ingest Pipeline

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to upload PDF, DOCX, and XLSX files (up to 100 MB) as inputs to skill invocations,
so that skills can process real documents as part of their execution.

This story adds the **document ingest pipeline** on top of the Story 3.1 async-job infrastructure: a two-step presign → confirm upload flow (the file goes **directly** client→S3, never through the API process), MIME + size validation, a Celery `parse_document` task that extracts text, and the `file_references` table that stores the S3 key + parsed-content reference. It deliberately does **not** wire parsed content into a running skill execution — the execution runtimes arrive in 3.3–3.5. AC #5 ("execution engine prepares the skill context") is satisfied here only by a **thin, well-tested context-builder helper** that the runtime stories call; do not invent the invocation endpoint or `execution_service` routing (that would collide with 3.3–3.5). See **Scope Boundary** below.

## Acceptance Criteria

1. **(Presign)** Given I call `POST /api/v1/ingest/presign` with a `filename` and `content_type`, when the API responds, then I receive a presigned S3 PUT URL valid for **15 minutes** and a `file_ref_id` (UUID) for subsequent reference. A `file_references` row is created in status `pending`.

2. **(Direct S3 upload + encryption)** Given I upload a file directly to the presigned S3 URL, when the upload completes, then the object is stored in the **ingest** bucket with **server-side AES-256 encryption** at rest. (Encryption is provided by **bucket-default SSE**, not a per-request SSE header — see Dev Notes → "AES-256 server-side encryption".)

3. **(Confirm + validation)** Given I call `POST /api/v1/ingest/confirm` with a `file_ref_id`, when the API validates the file, then it checks MIME type (PDF/DOCX/XLSX **only**) and size (≤ 100 MB); invalid files return **HTTP 422** with the error envelope and the `file_references` row transitions to `rejected`.

4. **(Parse)** Given a valid file is confirmed, when the Celery `parse_document` task runs, then the file content is extracted (text from PDF, text from DOCX, cell data from XLSX) and the **parsed content is written to the output bucket as an S3 object**; the `file_references` row records the parsed-content S3 key + metadata and transitions to `parsed` (or `failed` on extraction error).

5. **(Context injection — thin helper only)** Given a skill invocation references a `file_ref_id`, when the execution engine prepares the skill context, then the parsed content is injected as context via a `build_context_input(...)` helper — the raw file content is **never** passed inline; only the S3 key reference travels through the system, and the helper loads parsed text by key at the point of use.

6. **(Unsupported type)** Given an uploaded file has an unsupported MIME type (e.g., `.exe`), when validation runs (at confirm), then **HTTP 422** is returned with exactly `{"error": {"code": "UNSUPPORTED_FILE_TYPE", "message": "Only PDF, DOCX, and XLSX files are accepted.", "request_id": "..."}}`.

## Tasks / Subtasks

- [x] **Task 1 — Add parsing dependencies (AC: 4)**
  - [x] Add to `pyproject.toml` `[project.dependencies]` (exact pins, matching existing `==` style): `pypdf`, `python-docx`, `openpyxl`. See Dev Notes → "Parsing libraries & versions" for the exact pins and rationale. **These are the only new packages.** boto3 1.35.71 is already present.
  - [x] Rebuild the Docker image after editing deps — `docker compose build api worker` (source is **baked**, not mounted; see Dev Notes → "Running tests" / Story 3.1 PITFALL). A missing rebuild = `ModuleNotFoundError: pypdf` inside the container.

- [x] **Task 2 — `FileReference` ORM model (AC: 1, 3, 4)**
  - [x] Create `app/models/file_ref.py` with `FileReference(Base)`. Mirror the **exact** column patterns in [invocation.py](../../../velara-api/app/models/invocation.py) / [skill.py](../../../velara-api/app/models/skill.py) (UUID PK, `DateTime(timezone=True)` Python-side `datetime.now(UTC)`, VARCHAR enums, `String(1024)` for S3 keys, `JSONB` for metadata). Field list is in Dev Notes → "FileReference model".
  - [x] Register it in `app/models/__init__.py`: `from app.models.file_ref import FileReference  # noqa: F401` and add `"FileReference"` to `__all__`. **Without this, Alembic autogenerate and migration model-imports won't see it.**

- [x] **Task 3 — Alembic migration `0007_file_references` (AC: 1, 3, 4)**
  - [x] Create `app/db/migrations/versions/0007_file_references.py`. Set `revision = "0007_file_references"`, `down_revision = "0006_audit_log_entries"` (**current head — verified**; chain is 0001→…→0006).
  - [x] Create the `file_references` table + indexes (`idx_file_references_org_id`, `idx_file_references_created_by_user_id`, `idx_file_references_status`). Use `postgresql.UUID(as_uuid=True)`, `postgresql.JSONB(astext_type=sa.Text())`, `sa.DateTime(timezone=True)` — mirror [0005_invocation_jobs_results.py](../../../velara-api/app/db/migrations/versions/0005_invocation_jobs_results.py).
  - [x] Must round-trip cleanly: `upgrade → downgrade → upgrade`. `downgrade()` drops the table (indexes go with it).

- [x] **Task 4 — Ingest service (AC: 1, 3, 4)**
  - [x] Create `app/services/ingest_service.py` as module-level **async** functions (match `skill_service`/`job_service` shape, keyword-only args incl. `session: AsyncSession`):
    - `create_file_ref(*, session, storage, filename, content_type, created_by_user_id, org_id) -> tuple[FileReference, str]` — validates `content_type` against the allow-list (reject early), builds the S3 key (see Dev Notes → "S3 key layout"), inserts the row in status `pending`, returns the row + a **15-minute** presigned PUT URL.
    - `confirm_file_ref(*, session, storage, file_ref_id, org_id) -> FileReference` — loads the row (org-scoped, `FOR UPDATE`), **HEADs the S3 object** to read actual `ContentLength` + `ContentType`, validates size ≤ 100 MB and MIME ∈ allow-list, transitions to `confirmed`, then **dispatches** `parse_document.delay(str(file_ref_id))` and stores the returned `celery_task_id`. On validation failure → transition to `rejected` and raise the matching domain exception.
    - `get_file_ref(*, session, file_ref_id, org_id) -> FileReference` — org-scoped read (cross-org → 404).
  - [x] Define domain exceptions subclassing `VelaraHTTPException` with an `ERROR_CODE` class var (match `job_service`): `FileRefNotFoundError` (404, `FILE_REF_NOT_FOUND`), `UnsupportedFileTypeError` (422, `UNSUPPORTED_FILE_TYPE`, message **exactly** `"Only PDF, DOCX, and XLSX files are accepted."`), `FileTooLargeError` (422, `FILE_TOO_LARGE`, e.g. `"File exceeds the 100 MB limit."`), `FileNotUploadedError` (422, `FILE_NOT_UPLOADED` — confirm called but the S3 object HEAD 404s).
  - [x] **MIME allow-list (module constant):** map content-type → extension for `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX). Validate **both** at presign (declared `content_type`) and confirm (actual S3 `ContentType` + a magic-bytes sniff — do not trust the header alone; see Dev Notes → "MIME validation").

- [x] **Task 5 — Document parsers + Celery `parse_document` task (AC: 4)**
  - [x] Create `app/services/document_parser.py` with pure, sync functions: `parse_pdf(data: bytes) -> str`, `parse_docx(data: bytes) -> str`, `parse_xlsx(data: bytes) -> str`, and a dispatcher `extract_text(content_type: str, data: bytes) -> str`. All take **bytes** (no filesystem) — wrap in `io.BytesIO`. See Dev Notes → "Parser implementations" for exact API calls.
  - [x] Create `app/workers/ingest_tasks.py`. Register on the existing `celery` app with an **explicit** name: `@celery.task(name="velara.workers.ingest.parse_document", bind=True)`. The task: loads the `FileReference` (must be `confirmed`), `storage.get(ingest_key)` (direct sync call — **not** `run_in_threadpool`), `extract_text(...)`, `output_storage.put(parsed_key, text.encode("utf-8"), "text/plain; charset=utf-8")`, then transitions the row to `parsed` storing `parsed_content_key` + `parsed_metadata` (e.g. `{"char_count": N, "page_count": N}`). On any extraction/IO error → transition to `failed` with a stable `error_code` (`PARSE_FAILED`), log the real error via structlog (PHI-sanitized), and let Sentry capture (re-raise). **Use the Story 3.1 patterns exactly:** `asyncio.run(_do_work(...))` wrapping a `session_scope()` async CM; snapshot context up front and write the `failed` status in a **fresh** `session_scope()` so a poisoned session can't strand the row (see Dev Notes → "Celery task patterns").
  - [x] **Idempotency guard:** if the row is already in a terminal state (`parsed`/`failed`/`rejected`) when the task picks it up, log-and-skip (benign duplicate delivery) — mirror `job_service._guard_not_terminal`.

- [x] **Task 6 — Context-builder helper (AC: 5)**
  - [x] In `app/services/ingest_service.py` (or `document_parser.py`), add `async def build_context_input(*, session, output_storage, file_ref_id, org_id) -> str` (or a small dataclass): loads the `FileReference` (org-scoped, must be `parsed`), reads `parsed_content_key` from the **output** bucket, returns the text. This is the **only** seam 3.3–3.5 use to pull document context. Raise `FileRefNotReadyError` (422, `FILE_REF_NOT_READY`) if status ≠ `parsed`. **Do not** call this from any execution endpoint here — it has no caller yet; it is exercised by unit tests only. [Source: epics/epic-3-skill-execution-engine.md#Story 3.2 AC5 — "only the S3 key reference travels"]

- [x] **Task 7 — Pydantic schemas (AC: 1, 3)**
  - [x] Create `app/schemas/ingest.py`:
    - `PresignRequest` (`filename: str`, `content_type: str`) — request body for presign.
    - `PresignResponse` (`file_ref_id: uuid.UUID`, `upload_url: str`, `expires_in_seconds: int = 900`).
    - `ConfirmRequest` (`file_ref_id: uuid.UUID`).
    - `FileRefRead` (`id`, `original_filename`, `content_type`, `status`, `size_bytes` nullable, `created_at`, `parsed_metadata` nullable) with `model_config = ConfigDict(from_attributes=True)` so `FileRefRead.model_validate(orm_obj)` works (mirror `JobRead`). **Never** expose raw S3 keys or parsed content in the read schema — keys are internal.

- [x] **Task 8 — Ingest API router (AC: 1, 3, 6)**
  - [x] Create `app/api/v1/ingest.py` with `router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])` and the `_meta(request)` helper (copy from [jobs.py](../../../velara-api/app/api/v1/jobs.py)).
  - [x] `POST /presign` → `ResponseEnvelope[PresignResponse]`, deps `user: CurrentUser, session: DbSession, storage: IngestStorage`. `presign_upload` is **CPU-only → safe inline** (no threadpool).
  - [x] `POST /confirm` → `ResponseEnvelope[FileRefRead]`, deps `user: CurrentUser, session: DbSession, storage: IngestStorage`. The S3 **HEAD** inside `confirm_file_ref` is blocking I/O → wrap that single call with `fastapi.concurrency.run_in_threadpool` (see Dev Notes → "Async safety"). Returns the `confirmed` row (parse runs async).
  - [x] (Optional but recommended) `GET /{file_ref_id}` → `ResponseEnvelope[FileRefRead]` so callers can poll parse status. Org-scoped; cross-org → 404.
  - [x] Register in [router.py](../../../velara-api/app/api/v1/router.py): add `ingest` to the import and `api_router.include_router(ingest.router)`.

- [x] **Task 9 — Tests (AC: all)**
  - [x] Unit `tests/unit/services/test_document_parser.py`: build a tiny in-memory PDF/DOCX/XLSX (see Dev Notes → "Test fixtures for parsers"), assert `extract_text` returns the embedded text; assert unsupported content-type raises.
  - [x] Unit `tests/unit/services/test_ingest_service.py`: presign creates a `pending` row + returns 15-min URL; presign with bad content_type → `UnsupportedFileTypeError`; confirm size > 100 MB → `FileTooLargeError` + row `rejected`; confirm unsupported actual MIME → `UnsupportedFileTypeError`; confirm missing S3 object → `FileNotUploadedError`; `get_file_ref` cross-org → 404; `build_context_input` returns parsed text and raises when not `parsed`. **Mock the storage provider** (a fake with `presign_upload`/`get`/`head`/`put`) — no MinIO needed for unit tests.
  - [x] Integration `tests/integration/api/test_ingest.py`: follow the **skip-guard + `_auth_headers`** pattern from [test_jobs.py](../../../velara-api/tests/integration/api/test_jobs.py). Cover: presign returns `file_ref_id` + URL (200); confirm `.exe`/unsupported → 422 `UNSUPPORTED_FILE_TYPE` with the exact message; full presign→(MinIO PUT via the returned URL)→confirm→parse happy path with `celery_eager` fixture, asserting the row reaches `parsed` and a parsed object exists in the output bucket. Use the `_create_*_in_db` direct-insert helper style from test_jobs.py if you need seed rows.
  - [x] Reuse the `dispose_engine_after_test` autouse fixture pattern from the 3.1 worker tests if you add a `tests/integration/workers/test_ingest_tasks.py` (avoids cross-test asyncpg loop contamination). Note the 3.1 learning: **`asyncio.run()` inside a task can't be called from pytest-asyncio's running loop** — for task-logic tests, call the service functions in the same order as the task, or run the parse synchronously via `celery_eager`.
  - [x] **Gates before marking done:** `ruff check .` clean (line-length 100; rules `E,F,I,B,UP,W`; `B008` ignored) AND the **full Docker test suite green** (see Dev Notes → "Running tests"). Verify the migration round-trip in Postgres.

## Dev Notes

### Scope Boundary (read this first)

- **In scope:** presign/confirm endpoints, `file_references` table + model + migration `0007`, MIME/size validation, `parse_document` Celery task + PDF/DOCX/XLSX parsers, the parsed-content-by-key storage pattern, and a **thin** `build_context_input` helper for AC #5.
- **Out of scope (do NOT build — collides with later stories):**
  - The invocation entrypoint `POST /api/v1/invocations/{skill_id}` and any `execution_service` routing → **Story 3.3–3.5**. AC #5 is met by the helper alone; it has no execution caller yet. [Source: stories/3-1-async-job-infrastructure.md#Scope Boundary]
  - Multi-file-per-invocation orchestration (ING-01 "multiple files per invocation") — the schema supports many independent `file_ref_id`s; wiring N files into one invocation is the runtime stories' job.
  - **The connector framework / `IngestConnector` interface (ING-04/05) → Story 3.8.** Build the direct-S3 ingest path concretely here; do **not** prematurely abstract a connector base class. 3.8 refactors this into the connector shape. [Source: epics/epic-3-skill-execution-engine.md#Story 3.8]
  - Branded **output** generation (PDF/PPTX/DOCX/XLSX writers, `output_service.py`, `output_tasks.py`) → **Story 3.6**. This story only **reads** documents; it writes plain extracted text to the output bucket, not branded deliverables.

### Tech stack (exact versions — all already in [pyproject.toml](../../../velara-api/pyproject.toml) except the 3 parsers)

- Python ≥3.12, FastAPI 0.115.6, SQLAlchemy 2.0.36 (async), asyncpg 0.29.0, Alembic 1.13.3, Pydantic 2.10.4, pydantic-settings 2.6.1.
- Celery 5.4.0 (`celery[redis]`), redis 5.2.1 (broker + backend, single `REDIS_URL`). **boto3 1.35.71** (S3/MinIO) — already present, do not re-add.
- structlog 24.4.0 (PHI-sanitized logging), sentry-sdk[fastapi,celery] 2.19.2 (`init_sentry` wired in both web + worker via `app/core/observability.py` — Story 3.1 patch).
- Dev/test: ruff 0.6.9, pytest 8.3.4, pytest-asyncio 0.24.0 (`asyncio_mode="auto"`), httpx 0.27.2.

### Parsing libraries & versions (the ONLY new dependencies)

Add to `[project.dependencies]` with exact `==` pins (match the file's style). Current stable as of June 2026:

```
"pypdf==6.1.1",          # PDF text extraction — pure-Python, no system deps
"python-docx==1.2.0",    # DOCX paragraph/table text
"openpyxl==3.1.5",       # XLSX cell data (read_only mode for large sheets)
```

- **Pin discipline:** if any of these pins is unavailable in the build environment, choose the nearest available stable patch and **keep the exact `==` form** — do not switch to `>=`/`~=` (the project pins everything exactly). Verify the resolved version after `docker compose build`.
- **Why pypdf (not PyMuPDF/pdfminer):** pure-Python, MIT-compatible, zero system libraries to install in the Docker image, and the architecture's stack favors minimal native deps. PyMuPDF (AGPL) would add a licensing constraint; avoid it. [Source: architecture/Velara-Architecture-full.md#17 (ingest PDF/DOCX/XLSX), #113]
- **Do not add** any other parsing/ML libs (no `unstructured`, `textract`, `pandas`, `tika`). Phase-1 ingest is plain text extraction, not layout/OCR/semantic chunking. The architecture's `extract_chunks` (named in `ingest_tasks.py`) is a **future** concern — implement `parse_document` only; leave chunking to a later iteration. [Source: architecture/Velara-Architecture-full.md#409]

### FileReference model (`app/models/file_ref.py`) — mirror [invocation.py](../../../velara-api/app/models/invocation.py)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID(as_uuid=True)` PK, `default=uuid.uuid4` | |
| `org_id` | `String(128)`, not null | org scoping (cross-org → 404) |
| `created_by_user_id` | `String(128)`, not null | opaque auth subject |
| `original_filename` | `String(512)`, not null | as supplied at presign |
| `content_type` | `String(128)`, not null | declared at presign; re-validated at confirm |
| `ingest_key` | `String(1024)`, not null | S3 key in the **ingest** bucket |
| `parsed_content_key` | `String(1024)`, nullable | S3 key in the **output** bucket (set on parse) |
| `size_bytes` | `BigInteger`, nullable | actual size read from S3 HEAD at confirm (use `sa.BigInteger` — 100 MB fits int but be explicit) |
| `status` | `String(16)`, not null, default `"pending"` | `pending`→`confirmed`→`parsed` / `rejected` / `failed`. VARCHAR enum (inline comment listing values), **not** PG enum. |
| `error_code` | `String(64)`, nullable | stable code only, never raw exception text |
| `parsed_metadata` | `JSONB`, nullable | e.g. `{"char_count": N, "page_count": N, "sheet_count": N}` |
| `created_at` | `DateTime(timezone=True)`, not null, `default=lambda: datetime.now(UTC)` | Python-side, **not** `func.now()` |
| `updated_at` | `DateTime(timezone=True)`, not null, `default=...`, `onupdate=lambda: datetime.now(UTC)` | |

- **No FK to `skills`/`jobs`.** A `file_reference` is created **before** any invocation exists (upload-then-invoke), and the same file may feed multiple invocations. Link happens at invocation time (3.3+) via the `file_ref_id` carried in the invocation request, not via a DB FK here. [Source: epics/epic-3-skill-execution-engine.md#Story 3.2 AC5; ING-01 "multiple files per invocation"]
- Indexes via `__table_args__`: `Index("idx_file_references_org_id", "org_id")`, `Index("idx_file_references_created_by_user_id", "created_by_user_id")`, `Index("idx_file_references_status", "status")`.
- **Status enum values are stable public-ish API** (surfaced in `FileRefRead`). Do not rename later.

### Status state machine

```
pending ──(confirm: valid)──▶ confirmed ──(parse ok)──▶ parsed    [terminal]
   │                              │
   │                              └──(parse error)──────▶ failed   [terminal]
   └──(confirm: invalid MIME/size)──────────────────────▶ rejected [terminal]
```

- `parsed`/`failed`/`rejected` are terminal — the parse task log-and-skips a terminal row (idempotent duplicate delivery), mirroring `job_service._guard_not_terminal`. [Source: services/job_service.py `_guard_not_terminal`]

### S3 key layout

Build deterministic, org-scoped keys (never user-controlled raw filenames in the path — path-injection / collision risk):

- Ingest object: `ingest/{org_id}/{file_ref_id}/{sanitized_filename}` in the **ingest** bucket (`settings.S3_INGEST_BUCKET`, default `velara-ingest`).
- Parsed text: `parsed/{org_id}/{file_ref_id}.txt` in the **output** bucket (`settings.S3_OUTPUT_BUCKET`, default `velara-output`).
- The `file_ref_id` UUID guarantees uniqueness; keep the original filename only as the leaf for human-debuggability (sanitize: strip path separators, keep extension).

### AES-256 server-side encryption (AC #2) — bucket-default, NOT per-request header

- **Approach:** rely on **bucket-default SSE** (`AES256`/SSE-S3). The architecture states "RDS + S3 encryption **on by default**" — encryption is a bucket property, applied to every object regardless of upload path. This is the correct path for **presigned direct uploads**, where the client (not our code) performs the PUT. [Source: architecture/Velara-Architecture-full.md#32, #571]
- **Do NOT** add `ServerSideEncryption="AES256"` to the `presign_upload` `Params`. If you sign the encryption header, the **client must send a matching `x-amz-server-side-encryption: AES256` header** on the PUT or S3 returns `SignatureDoesNotMatch` — a fragile contract for a direct browser upload. Bucket-default SSE avoids this entirely. [Source: web research — boto3 #1365 presigned-SSE signature pitfalls]
- **Dev/MinIO:** MinIO encrypts at the volume level; bucket-default SSE config is a no-op-but-accepted in MinIO. The AC is about the **prod** guarantee; do not block local dev on it.
- **Out-of-scope infra note (do NOT implement here):** the actual `PutBucketEncryption` policy lands with real bucket provisioning in **Epic 7**. For this story, document the dependency in the parsed metadata/comments; do not write Terraform/bucket-policy code. The current `S3StorageProvider.put` (used only for the *parsed* object, server-side) may optionally pass `ServerSideEncryption="AES256"` since *we* control that call — but the **ingest** object's encryption is bucket-default. [Source: architecture/Velara-Architecture-full.md#571 "Epic 7"]

### MIME validation (defense in depth — AC #3, #6)

Validate at **two** points, and do not trust the declared header alone:

1. **Presign:** reject if the **declared** `content_type` ∉ allow-list (fail fast, no S3 object created).
2. **Confirm:** (a) S3 **HEAD** → read actual `ContentLength` (size check) and `ContentType`; (b) **magic-bytes sniff** the first bytes of the object to confirm true type — a `.exe` renamed to `.pdf` with `content_type: application/pdf` must still be caught. PDF starts `%PDF`; DOCX/XLSX are ZIP containers starting `PK\x03\x04` (distinguish by inspecting the zip's `[Content_Types].xml` or the presence of `word/` vs `xl/` entries). At minimum: PDF magic `%PDF-`, and ZIP magic `PK` for DOCX/XLSX, then trust the declared OOXML content-type for the word-vs-xl distinction (a renamed-zip edge case is acceptable for Phase 1 — log it; do not over-engineer).
- **Allow-list (module constant in `ingest_service.py`):**
  - `application/pdf` → `.pdf`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` → `.docx`
  - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` → `.xlsx`
- **Exact 422 envelope for unsupported type (AC #6):** code `UNSUPPORTED_FILE_TYPE`, message **exactly** `"Only PDF, DOCX, and XLSX files are accepted."`. The global handler in [exceptions.py](../../../velara-api/app/core/exceptions.py) renders `{"error": {"code", "message", "request_id"}}` — just raise `UnsupportedFileTypeError`.

### Parser implementations (`app/services/document_parser.py`)

Pure sync functions over `bytes` (wrap in `io.BytesIO`; never touch the filesystem):

```python
import io
from pypdf import PdfReader
from docx import Document          # python-docx imports as `docx`
from openpyxl import load_workbook

def parse_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)

def parse_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:                       # capture table text too
        for row in table.rows:
            parts.append("\t".join(c.text for c in row.cells))
    return "\n".join(parts)

def parse_xlsx(data: bytes) -> str:
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)  # read_only: stream large sheets
    lines = []
    for ws in wb.worksheets:
        lines.append(f"# {ws.title}")
        for row in ws.iter_rows(values_only=True):
            lines.append("\t".join("" if v is None else str(v) for v in row))
    wb.close()
    return "\n".join(lines)
```

- `python-docx`'s **import name is `docx`** (the package on PyPI is `python-docx`). A common mistake is `import python_docx` — that fails.
- `openpyxl` **must** use `read_only=True` + `data_only=True` for ≤100 MB sheets (avoids loading the whole DOM; `data_only` returns cached values not formulas). Call `wb.close()`.
- `pypdf`'s `extract_text()` can return `None` for image-only pages — coalesce to `""` (no OCR in Phase 1).
- Dispatcher `extract_text(content_type, data)` routes on the allow-list; raise `ValueError` for anything else (the task converts it to `error_code="PARSE_FAILED"`).

### Celery task patterns (`app/workers/ingest_tasks.py`) — copy Story 3.1 exactly

- **Explicit task name:** `@celery.task(name="velara.workers.ingest.parse_document", bind=True)`. Autogenerated names are forbidden. [Source: workers/celery_app.py; workers/execution_tasks.py]
- **DB in tasks:** `asyncio.run(_do_work(file_ref_id))` wrapping `async with session_scope() as session: ...`. **Never** open an async session against a missing event loop. [Source: stories/3-1#DB access inside Celery tasks; db/session.py `session_scope`]
- **Storage in tasks:** call provider methods **directly** (sync) — `ingest_storage.get(key)`, `output_storage.put(...)`. Do **NOT** `run_in_threadpool` inside a task. [Source: core/dependencies.py async-safety note]
- **Get the providers inside the task** via `get_ingest_storage()` / `get_output_storage()` from `app.integrations.storage` (no FastAPI DI in tasks).
- **Failure handling (Story 3.1 patch learning):** snapshot the `file_ref` context up front; on exception, write the `failed` status + `error_code` in a **fresh** `session_scope()` so a poisoned execution session can't strand the row in `confirmed`. Log the real exception via structlog (PHI-sanitized); re-raise so CeleryIntegration captures it in Sentry. **Never** store raw exception text in the DB. [Source: stories/3-1-async-job-infrastructure.md#Review Findings — "Failure handler reuses a poisoned session"; #Sentry/observability]

### Async safety (request handlers) — [dependencies.py](../../../velara-api/app/core/dependencies.py)

- `presign_upload` / `presign_download`: **CPU-only → safe inline** in async handlers. The presign endpoint needs no threadpool.
- `storage.head_object` / `get` / `put`: **blocking I/O** → in the async `confirm` handler/service, wrap the single HEAD call with `fastapi.concurrency.run_in_threadpool`. (`S3StorageProvider` has no `head` method yet — **add a small `head(key) -> dict` method** returning `head_object`'s `ContentLength`/`ContentType`, mirroring the existing sync methods. Keep it on the provider so it's mockable.)

### API conventions — mirror [jobs.py](../../../velara-api/app/api/v1/jobs.py) / [skills.py](../../../velara-api/app/api/v1/skills.py)

- Every route returns `ResponseEnvelope[T]` from `app.schemas.common`; build meta with the local `_meta(request)` helper. Never return a bare dict.
- Errors via domain exceptions only — raise a `VelaraHTTPException` subclass; the global handler renders the envelope. `RequestValidationError` → 422 `VALIDATION_ERROR` is already handled globally.
- Deps are the typed aliases: `CurrentUser` (`.user_id`, `.org_id`, `.role`), `DbSession`, `IngestStorage` (**already exists** in dependencies.py — `Annotated[S3StorageProvider, Depends(_ingest_storage)]`). Path/body UUIDs: `uuid.UUID` (FastAPI auto-422s on bad UUID).
- Cross-org access → **404** (not 403), matching `job_service`/`skill_service` org-scoping.
- New error codes are **stable public API**: `FILE_REF_NOT_FOUND`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `FILE_NOT_UPLOADED`, `FILE_REF_NOT_READY`, `PARSE_FAILED`. Don't reuse skill/job codes.

### Service layer conventions — mirror [job_service.py](../../../velara-api/app/services/job_service.py)

- Module-level **async** functions, keyword-only args incl. `session: AsyncSession` (and `storage` where needed). Return ORM objects; the router does `FileRefRead.model_validate(obj)`.
- Domain exceptions are classes with an `ERROR_CODE` class var:
  ```python
  class UnsupportedFileTypeError(VelaraHTTPException):
      ERROR_CODE = "UNSUPPORTED_FILE_TYPE"
      def __init__(self) -> None:
          super().__init__(422, self.ERROR_CODE, "Only PDF, DOCX, and XLSX files are accepted.")
  ```
- Org-scope reads in the WHERE clause; use `FOR UPDATE` on `confirm_file_ref` (mirror `job_service.cancel_job`'s row-lock to avoid a confirm↔parse race).

### Running tests (critical — Docker source is baked, not mounted)

- **PITFALL (Story 2.3 / 3.1):** `api`/`worker` containers `build:` the image with **no source volume mount**. New code/deps/migrations are invisible until rebuild: `docker compose build api worker && docker compose up -d`. After adding pypdf/python-docx/openpyxl this rebuild is mandatory or the worker `ModuleNotFoundError`s. [Source: stories/3-1#Running tests; 2-3 Debug Log]
- Apply migration: `docker compose exec api alembic upgrade head`; verify round-trip `alembic downgrade -1` then `upgrade head`.
- Unit tests (no services): `pytest tests/unit/` — mock the storage provider, no MinIO needed.
- Integration (need Postgres + MinIO + Redis): `docker compose up -d` then `docker compose exec api pytest tests/integration/api/test_ingest.py`. Skip-guard auto-skips if services unreachable.
- Integration auth: copy `_auth_headers` from [test_jobs.py](../../../velara-api/tests/integration/api/test_jobs.py) — mint a dev JWT via `DevAuthProvider().issue_token(principal)` (seed users `ma.tech`/`consultant`/`client.user`).
- Celery in tests: `celery.conf.task_always_eager = True` (+ `task_eager_propagates = True`) via the existing `celery_eager` fixture in [conftest.py](../../../velara-api/tests/conftest.py) so `parse_document` runs in-process.
- Reuse `dispose_engine_after_test` autouse fixture (3.1 worker-test pattern) if adding worker tests — prevents asyncpg "Future attached to a different loop" pool contamination. [Source: stories/3-1#Debug Log References]
- Lint: `ruff check .` (line-length 100, `E,F,I,B,UP,W`, `B008` ignored).

### Test fixtures for parsers (build docs in-memory, no binary test assets)

- **DOCX:** `from docx import Document; d = Document(); d.add_paragraph("hello ingest"); buf = io.BytesIO(); d.save(buf); data = buf.getvalue()`.
- **XLSX:** `from openpyxl import Workbook; wb = Workbook(); wb.active["A1"] = "hello ingest"; buf = io.BytesIO(); wb.save(buf); data = buf.getvalue()`.
- **PDF:** generating a real PDF in-memory without a writer lib is awkward — either commit a tiny fixture under `tests/fixtures/` **or** assert `parse_pdf` against a minimal hand-built `%PDF-1.4 ...` byte string with one text object. Keep PDF coverage minimal; the DOCX/XLSX paths carry the parsing-contract assertions.

### Project Structure Notes

New/modified files (all under `velara-api/`), aligned with the architecture's named structure [Source: architecture/project-structure-boundaries.md#39-73, #178]:

| File | Action | Purpose |
|------|--------|---------|
| `app/models/file_ref.py` | NEW | `FileReference` (S3 key + metadata) — fills the architecture's named `file_ref.py` slot |
| `app/models/__init__.py` | MODIFY | register `FileReference` for Alembic |
| `app/db/migrations/versions/0007_file_references.py` | NEW | `file_references` table (down_revision `0006`) |
| `app/services/ingest_service.py` | NEW | presign/confirm, validation, dispatch, `build_context_input` — fills `ingest_service.py` slot |
| `app/services/document_parser.py` | NEW | pure PDF/DOCX/XLSX → text extractors |
| `app/workers/ingest_tasks.py` | NEW | `parse_document` task — fills `ingest_tasks.py` slot |
| `app/integrations/storage.py` | MODIFY | add a `head(key)` method to `StorageProvider`/`S3StorageProvider` |
| `app/schemas/ingest.py` | NEW | `PresignRequest/Response`, `ConfirmRequest`, `FileRefRead` |
| `app/api/v1/ingest.py` | NEW | `POST /ingest/presign`, `POST /ingest/confirm`, `GET /ingest/{id}` — fills `ingest.py` slot |
| `app/api/v1/router.py` | MODIFY | include ingest router |
| `pyproject.toml` | MODIFY | add pypdf, python-docx, openpyxl |
| `tests/unit/services/test_document_parser.py` | NEW | |
| `tests/unit/services/test_ingest_service.py` | NEW | |
| `tests/integration/api/test_ingest.py` | NEW | |

Naming aligns with existing conventions (tables plural snake_case; indexes `idx_{table}_{column}`; Celery `velara.workers.{module}.{action}`). The architecture names exactly these slots (`api/v1/ingest.py`, `services/ingest_service.py`, `workers/ingest_tasks.py`, `models/file_ref.py`) — this story populates them. **No detected conflicts.** The only architecture-vs-AC variance: the data-flow narrative shows a single `POST /api/v1/ingest`, but the **AC specifies the two-step `/ingest/presign` + `/ingest/confirm`** (more precise, security-correct — file never transits the API). Follow the AC. [Source: architecture/Velara-Architecture-full.md#528 vs epic-3 Story 3.2 AC1/AC3]

### References

- [Source: epics/epic-3-skill-execution-engine.md#Story 3.2] — story statement + all 6 ACs (presign 15-min, direct S3 upload + AES-256, confirm MIME/size 422, parse to structured content, context-by-key, `UNSUPPORTED_FILE_TYPE` exact envelope).
- [Source: epics/epic-3-skill-execution-engine.md#Story 3.8] — `IngestConnector` framework deferred to 3.8; build the concrete S3 path here, don't pre-abstract.
- [Source: prds/.../5-functional-requirements.md#ING-01..05] — PDF/DOCX/XLSX, multiple files per invocation, ≤100 MB, type/format validation with clear error, connector framework (3.8).
- [Source: architecture/Velara-Architecture-full.md#17,28,100,132] — ingest ≤100 MB; S3 presigned upload/download; S3(content)+PG(metadata) file-by-key pattern.
- [Source: architecture/Velara-Architecture-full.md#191-192,527-528] — ingest data flow: FileUpload → presigned URL → direct S3 → confirm with key → Celery `parse_document` → extracted content → skill input context.
- [Source: architecture/Velara-Architecture-full.md#32,571,567] — AES-256 at rest (S3 default), 100 MB via presigned URL "file never transits the API process", Epic 7 owns real bucket provisioning.
- [Source: architecture/Velara-Architecture-full.md#138,149] — never store file content inline; file passed by S3 key reference only (PHI/HIPAA enforcement rule).
- [Source: architecture/project-structure-boundaries.md#39,56,66,73,178] — named slots: `ingest.py`, `file_ref.py`, `ingest_service.py`, `ingest_tasks.py (parse_document, extract_chunks)`.
- [Source: velara-api/app/integrations/storage.py] — `StorageProvider` protocol + `S3StorageProvider`; `get_ingest_storage()`/`get_output_storage()`; presign `s3v4`/path-style for MinIO; add a `head()` method here.
- [Source: velara-api/app/core/dependencies.py] — `IngestStorage`/`OutputStorage`/`CurrentUser`/`DbSession` aliases; async-safety note (presign inline, get/put/head via threadpool in handlers, direct in tasks).
- [Source: velara-api/app/core/config.py] — `S3_INGEST_BUCKET`/`S3_OUTPUT_BUCKET`/`S3_ENDPOINT_URL`/`STORAGE_BACKEND`; staging/prod fail-fast validator.
- [Source: velara-api/app/models/invocation.py, app/models/skill.py] — exact UUID/timestamp/VARCHAR-enum/JSONB/Index column patterns to mirror.
- [Source: velara-api/app/workers/celery_app.py, app/workers/execution_tasks.py] — Celery app config, explicit task-name convention, `asyncio.run`+`session_scope` task pattern, fresh-session failure handling, Sentry via `init_sentry`.
- [Source: velara-api/app/services/job_service.py] — module-level async service + `ERROR_CODE` exception pattern + `_guard_not_terminal` + `FOR UPDATE` row-lock.
- [Source: velara-api/app/api/v1/jobs.py, app/api/v1/router.py, app/schemas/common.py, app/core/exceptions.py] — router/`_meta`/envelope/error-code patterns; router registration.
- [Source: velara-api/app/db/migrations/versions/0005_invocation_jobs_results.py, 0006_audit_log_entries.py] — migration head (`0006`) + revision/down_revision format; round-trip discipline.
- [Source: velara-api/app/db/migrations/env.py] — Alembic discovers models via `import app.models`; registration in `__init__.py` is mandatory.
- [Source: velara-api/tests/conftest.py, tests/integration/api/test_jobs.py] — `celery_eager` fixture, `dispose_engine_after_test`, skip-guard + `_auth_headers` dev-JWT pattern, `_create_*_in_db` direct-insert helpers.
- [Source: stories/3-1-async-job-infrastructure.md] — Scope-Boundary discipline, Celery sync-context DB/storage rules, poisoned-session failure-handler patch, Docker-rebuild PITFALL, terminal-state idempotency guard.
- [Source: pypdf 6.x docs / python-docx 1.2.0 / openpyxl 3.1.5 — June 2026] — `PdfReader(...).pages[*].extract_text()`; `docx.Document`; `openpyxl.load_workbook(read_only=True, data_only=True)`.

### Review Findings

<!-- Code review 2026-06-10 — 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) vs uncommitted diff -->

- [x] [Review][Patch] Zip-bomb / decompression-bomb cap for DOCX/XLSX parsing — confirm validates only the *compressed* size (≤100 MB) + magic bytes; a valid OOXML ZIP can decompress to many GB, and `text = "\n".join(...)` materializes all extracted text in memory → worker OOM/hang DoS on a single crafted upload. RESOLVED (decision): add a `_MAX_EXTRACTED_CHARS` cap (default 50 MB of text) in `parse_document`; if `len(text)` exceeds it, abort and transition the row to `failed` with `error_code="PARSE_TOO_LARGE"`. [app/workers/ingest_tasks.py:100-125]

- [x] [Review][Patch] `confirm_file_ref` has no terminal/status guard — `_guard_not_terminal` is defined but never called; re-confirming a row regresses a `parsed`/terminal row back to `confirmed` and double-dispatches `parse_document`. Add the guard (or assert `status == pending`) inside the FOR-UPDATE critical section before transition/dispatch, mirroring `job_service`. [app/services/ingest_service.py:240-297, dead helper at :351]
- [x] [Review][Patch] Confirm splits one logical transition across two commits — commits `status=confirmed` (`:295`), then calls `parse_document.delay()` (`:297`); if the broker is unreachable `.delay()` raises and the row is stranded in `confirmed` forever with no task and no `celery_task_id`. Dispatch + store task_id in one commit, or mark the row `failed`/`pending` if dispatch raises. [app/services/ingest_service.py:295-300]
- [x] [Review][Patch] `FileNotUploadedError` 404-detection substring-matches `str(exc)` — a `403`/`503`/timeout `ClientError` falls through to a bare 500, and any error message containing "not found" is misreported as `FILE_NOT_UPLOADED`. Inspect `exc.response["Error"]["Code"]` (`404`/`NoSuchKey`) instead. [app/services/ingest_service.py:245-249]
- [x] [Review][Patch] Magic-byte `get_range` fallback downloads the entire ≤100 MB object to read 8 bytes — bare `except Exception` swallows transient/network errors (not just "range unsupported") and falls back to `storage.get()[:8]`, a full in-memory download in the request path (threadpool-exhaustion / memory-spike vector). Narrow the except to a range-unsupported signal; otherwise propagate. [app/services/ingest_service.py:273-277]
- [x] [Review][Patch] No lower-bound size check at confirm — only `actual_size > _MAX_SIZE_BYTES` is checked; a 0-byte object (or a missing `ContentLength` defaulting to `0`) passes validation, and relying on the `0` default silently disables size enforcement if the HEAD dict ever lacks the key. Reject `actual_size == 0` / missing `ContentLength`. [app/services/ingest_service.py:251-257]
- [x] [Review][Patch] Parse success-commit lacks the terminal guard the failure handler has — the `parsed` write (`:128-136`) re-fetches without a row lock and without re-checking terminal state, while the failure handler 7 lines below guards `status not in FILE_REF_TERMINAL_STATUSES`. A duplicate/concurrent delivery can blindly re-stamp `parsed`, overwrite `parsed_content_key`, or resurrect a `failed` row. Mirror the failure handler's guard (+ optional row lock). [app/workers/ingest_tasks.py:128-136]
- [x] [Review][Patch] Metadata block re-parses the file a second time + brittle `.endswith(".sheet")` — after `extract_text` already parsed the bytes, the metadata block opens `PdfReader`/`load_workbook` again on the same ≤100 MB bytes (double decompression cost + second OOM opportunity), and keys XLSX off `content_type.endswith(".sheet")` instead of the allow-list constant. Return page/sheet counts from the single parser pass; compare against the XLSX constant. (Also tightens the small partial-failure orphan window.) [app/workers/ingest_tasks.py:107-125]
- [x] [Review][Patch] `parse_document.delay()` (blocking broker publish) runs inline on the event loop — every other blocking call in the service is `run_in_threadpool`-wrapped, but the kombu publish stalls the loop under broker latency. Wrap in `run_in_threadpool` (folds into the dispatch-failure fix). [app/services/ingest_service.py:297]
- [x] [Review][Patch] `build_context_input` calls `output_storage.get` inline (no threadpool) — blocking S3 I/O on the event loop in the 3.3–3.5 seam, inconsistent with every other storage call in the service. Wrap in `run_in_threadpool`; consider `errors="replace"` on the utf-8 decode for defense. [app/services/ingest_service.py:322-345]
- [x] [Review][Patch] `confirm_file_ref` accepts an `output_storage` param it never uses — the handler injects + threads `OutputStorage` through, but the body never references it (parse fetches its own provider via `get_output_storage()`). Remove the dead param + handler injection. [app/services/ingest_service.py:220, app/api/v1/ingest.py:204-215]

- [x] [Review][Defer] Bucket-default SSE (AES-256 at rest) not configured in this changeset — the per-request SSE header is correctly absent from `presign_upload`, but no bucket-default-encryption is set (MinIO bootstrap runs only `mc mb`; no `mc encrypt set`). Per spec Dev Notes the real `PutBucketEncryption` policy "lands with real bucket provisioning in Epic 7" — deferred, out of this story's scope. [docker-compose.yml MinIO bootstrap / Epic 7 IaC]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- **pypdf pin 6.1.1 unavailable → used 6.1.0**: The story specified pypdf==6.1.1 but that version was not available in the build environment. Used pypdf==6.1.0 (nearest stable patch, exact `==` form preserved per pin discipline).
- **`run_in_threadpool` import**: Initially imported inside the `confirm_file_ref` function body; this prevented patching in unit tests (`AttributeError: module has no attribute 'run_in_threadpool'`). Fixed by moving the import to module level.
- **`asyncio.run()` in celery_eager tests**: The `parse_document` Celery task uses `asyncio.run()` which cannot be called from pytest-asyncio's already-running event loop. The integration happy-path tests avoid `celery_eager` for the parse step and instead call the parse service functions inline in the same order as the task (per Story 3.2 Dev Notes guidance).
- **Docker baked-source PITFALL**: Source is baked into the Docker image (no volume mount). Rebuilt twice — once after adding pypdf/python-docx/openpyxl, once after moving `run_in_threadpool` import to module level. Always required after code changes.

### Completion Notes List

- All 6 ACs implemented and verified against the full Docker test suite.
- **AC1 (Presign)**: `POST /api/v1/ingest/presign` creates a `pending` `FileReference` row and returns a 15-minute (900s) presigned S3 PUT URL. Exact MIME validation at presign (fail fast before S3 object creation).
- **AC2 (Direct S3 upload + AES-256)**: File goes directly client→S3 via presigned URL, never through the API process. AES-256 encryption provided by bucket-default SSE per architecture spec (no per-request SSE header to avoid SignatureDoesNotMatch on presigned PUT).
- **AC3 (Confirm + validation)**: `POST /api/v1/ingest/confirm` HEADs the S3 object for actual `ContentLength`+`ContentType`, validates size ≤ 100 MB and MIME ∈ allow-list, plus magic-bytes sniff (`%PDF` for PDF, `PK\x03\x04` for DOCX/XLSX). Invalid files → HTTP 422 + row transitions to `rejected`.
- **AC4 (Parse)**: `parse_document` Celery task downloads the file from the ingest bucket, calls `extract_text` (pypdf/python-docx/openpyxl), writes plain text to output bucket, transitions row to `parsed` with `parsed_content_key` + `parsed_metadata` (char_count, page_count/sheet_count). Failure path uses fresh session (poisoned-session pattern).
- **AC5 (Context injection — thin helper)**: `build_context_input()` in `ingest_service.py` loads the `FileReference` (org-scoped, must be `parsed`), reads `parsed_content_key` from the output bucket, returns text. Raises `FileRefNotReadyError` (422) if not parsed. No execution caller wired yet (3.3–3.5).
- **AC6 (Unsupported type)**: Presign + confirm both reject unsupported MIME types with HTTP 422 `UNSUPPORTED_FILE_TYPE` and the exact message `"Only PDF, DOCX, and XLSX files are accepted."`.
- **`head()` + `get_range()` added to `StorageProvider`/`S3StorageProvider`**: New methods needed for confirm validation. `head()` calls `head_object`; `get_range()` uses `Range: bytes=start-end` for efficient magic-byte sniffing.
- **Migration**: `0007_file_references` chained to `0006_audit_log_entries`; round-trip (upgrade → downgrade → upgrade) verified in Postgres.
- **Tests**: 269 Docker suite + ruff clean. New: 12 unit parser tests, 26 unit service tests, 12 integration API tests. Zero regressions.

### File List

- `pyproject.toml` (modified — added pypdf==6.1.0, python-docx==1.2.0, openpyxl==3.1.5)
- `app/models/file_ref.py` (new)
- `app/models/__init__.py` (modified — registered FileReference)
- `app/db/migrations/versions/0007_file_references.py` (new)
- `app/services/ingest_service.py` (new)
- `app/services/document_parser.py` (new)
- `app/workers/ingest_tasks.py` (new)
- `app/integrations/storage.py` (modified — added head() and get_range() to StorageProvider protocol and S3StorageProvider)
- `app/schemas/ingest.py` (new)
- `app/api/v1/ingest.py` (new)
- `app/api/v1/router.py` (modified — registered ingest router)
- `tests/unit/services/test_document_parser.py` (new)
- `tests/unit/services/test_ingest_service.py` (new)
- `tests/integration/api/test_ingest.py` (new)

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-06-10 | 1.0 | Initial implementation — presign/confirm/parse pipeline, FileReference model, 0007 migration, document_parser, ingest_tasks, 3 API endpoints, 50 new tests (269 suite pass) | claude-sonnet-4-6 |
