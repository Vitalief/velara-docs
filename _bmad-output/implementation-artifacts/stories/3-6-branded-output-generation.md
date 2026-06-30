# Story 3.6: Branded Output Generation

---
baseline_commit: a5b9767b7661df6d8c304a4672830a2824961be9
---

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want skill executions that produce PDF, PPTX, DOCX, or XLSX output files with Vitalief brand standards applied,
so that deliverables are consistently formatted and ready for client delivery without manual post-processing.

## Acceptance Criteria

> **BDD source:** [epic-3-skill-execution-engine.md#story-36](../../planning-artifacts/epics/epic-3-skill-execution-engine.md) (lines 163–193). **FR source:** OUT-01, OUT-02 [5-functional-requirements.md](../../planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md). The current plain-text seam these ACs replace is `execution_service` → `output_storage.put(...,"text/plain")` (see Dev Notes §2).

1. **PDF output with brand standards.**
   **Given** a skill defines `output_format: "pdf"` and a runtime produced final text content
   **When** branded PDF generation runs
   **Then** a PDF is generated with: **Open Sans** body font, **Poppins** title font (Nexa when Vitalief provides licensed files), the Vitalief brand colour palette (teal `#128F8B` / navy `#323843`), a standard Vitalief header and footer — and stored in the output S3 bucket.

2. **DOCX output with brand standards.**
   **Given** a skill defines `output_format: "docx"`
   **When** DOCX generation runs
   **Then** a DOCX is generated applying the same brand standards via **python-docx** with Vitalief template styles (Open Sans body, Poppins headings, teal/navy accents, header/footer).

3. **PPTX output with brand standards.**
   **Given** a skill defines `output_format: "pptx"`
   **When** PPTX generation runs
   **Then** a PPTX is generated using the Vitalief slide template (provided at kickoff) via **python-pptx**.

4. **XLSX output with brand standards.**
   **Given** a skill defines `output_format: "xlsx"`
   **When** XLSX generation runs
   **Then** an XLSX is generated with Vitalief header-row styling and sheet structure via **openpyxl**.

5. **Output stored + presigned download URLs (24h).**
   **Given** output files are generated
   **When** the job transitions to `completed`
   **Then** each output file is stored in the output S3 bucket and the `invocation_result` record carries presigned download URLs (valid **24 hours**). A single invocation may produce **one or more** output files (OUT-01); the `GET /api/v1/jobs/{job_id}` response presigns **every** generated file.

6. **Brand assets loaded from S3, not hardcoded.**
   **Given** brand assets (fonts, logo, colour hex values, slide template) are provided by Vitalief at kickoff
   **When** the output templates are configured
   **Then** they are stored in S3 (not hardcoded source) and loaded at generation time — **updating brand assets requires no code change** (OUT-02). The brand colour palette and font *names* are stable design tokens (config); the binary assets (TTF/OTF fonts, logo image, `.pptx` template) live in the brand-assets S3 bucket/prefix.

### Implied / regression requirements (NOT optional — see Dev Notes §3)

- **R1 — Back-compatible default.** A skill with `output_format` NULL or `"text"` must keep the **exact current behaviour**: write `result.text` (or stdout / hybrid final text) as `text/plain` to `outputs/{org_id}/{job_id}.txt`. Stories 3.3/3.4/3.5 and their 313+ passing tests must not regress.
- **R2 — All three runtimes feed generation.** Branded generation applies after **any** runtime (`prompt`, `code`, `hybrid`) produces its final text — it is keyed off the skill's `output_format`, independent of `runtime_type`.
- **R3 — IP/PHI discipline preserved.** Output **content** (which may contain PHI) is rendered into the file and stored by key only; it is **never** logged, never returned inline, never placed in `result_metadata`. Skill internals (prompt/code/tool defs) remain unexposed. `result_metadata` carries format/size/counts only.
- **R4 — Failure path.** A generation failure (unsupported format, render error, brand-asset missing) transitions the job to `failed` with a stable `error_code` (no raw exception text in DB or to caller), writes a `failure` audit entry, and re-raises so Sentry captures it — mirroring the existing `run_skill` failure handler.
- **R5 — Terminal-state + atomic-dispatch guards untouched.** Generation runs **inside** the existing `run_skill` task before `mark_completed`; it must not bypass `_guard_not_terminal`, must not create a second `InvocationResult`, and must not strand a job.

## Tasks / Subtasks

- [x] **Task 1 — Add the `output_format` field to the Skill model + migration 0009 (AC: 1–4, R1)**
  - [x] Add `output_format: Mapped[str | None] = mapped_column(String(8), nullable=True)` to `Skill` in [app/models/skill.py](../../../velara-api/app/models/skill.py) (place beside `runtime_type`; same VARCHAR-not-PG-enum convention). Comment: `pdf | docx | pptx | xlsx | text | NULL`.
  - [x] Create migration `app/db/migrations/versions/0009_skill_output_format.py` with `down_revision = "0008_invocation_job_inputs"`. `op.add_column("skills", sa.Column("output_format", sa.String(8), nullable=True))` up; `op.drop_column("skills", "output_format")` down.
  - [x] Define the allowed set once, e.g. `OUTPUT_FORMAT_PDF/DOCX/PPTX/XLSX/TEXT` constants + `OUTPUT_FORMATS = {...}` in `app/services/output_service.py` (new) — service-layer validation, NOT a DB enum (mirrors `JOB_TERMINAL_STATUSES`).
  - [x] Surface `output_format` in the skill create/edit service + schema (`app/services/skill_service.py`, `app/schemas/skill.py`) so a skill can be authored with a format. Validate against `OUTPUT_FORMATS` → reuse the existing `VALIDATION_ERROR`/scope-guard pattern; an unknown value is a 422 at author time, not a runtime surprise. **If the create/edit surface is out of scope to extend now, seed the column directly in tests and note the gap in the Dev Agent Record.**
  - [x] Run migration round-trip in Docker: `alembic upgrade head` → `downgrade -1` → `upgrade head` (see Dev Notes §8).

- [x] **Task 2 — New `output_service.py`: brand-rendering functions (AC: 1–4, 6, R3)**
  - [x] Create `app/services/output_service.py`. Pure rendering functions, raw-bytes-in / raw-bytes-out (mirror `document_parser.py`'s in-memory `io.BytesIO` discipline — no filesystem writes):
    - `generate_pdf(text: str, brand: BrandAssets) -> bytes` (reportlab)
    - `generate_docx(text: str, brand: BrandAssets) -> bytes` (python-docx)
    - `generate_pptx(text: str, brand: BrandAssets) -> bytes` (python-pptx, from the Vitalief slide template)
    - `generate_xlsx(rows, brand: BrandAssets) -> bytes` (openpyxl)
  - [x] `render_output(output_format, content, brand) -> tuple[bytes, str]` dispatcher returning `(file_bytes, content_type)`; raises `UnsupportedOutputFormatError` (422, `UNSUPPORTED_OUTPUT_FORMAT`) for an unknown format. Mirror `document_parser.extract_document`'s dispatch-on-format pattern.
  - [x] Apply brand standards from `BrandAssets` (loaded in Task 3): register TTF fonts (Open Sans/Poppins → Nexa fallback to Poppins), set heading vs body fonts, brand colours (teal `#128F8B`, navy `#323843`; accents slate `#4C5270`, pink `#F652A0`), header + footer with logo. **Never log `content` (PHI/IP).**
  - [x] Define content-type constants: PDF `application/pdf`, DOCX `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, PPTX `application/vnd.openxmlformats-officedocument.presentationml.presentation`, XLSX `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. (Reuse the OOXML strings already in `document_parser._PARSERS`.)

- [x] **Task 3 — Brand-asset loading from S3 (AC: 6, R3)**
  - [x] Add `S3_BRAND_BUCKET: str = "velara-brand"` (+ optional `BRAND_ASSET_PREFIX`) to `Settings` in [app/core/config.py](../../../velara-api/app/core/config.py), following the exact `S3_*_BUCKET` pattern. Add `get_brand_storage()` to [app/integrations/storage.py](../../../velara-api/app/integrations/storage.py) (mirror `get_output_storage`). Bump `get_storage_provider` `lru_cache(maxsize=8)` is already adequate for a 4th bucket.
  - [x] Add brand-asset **key** settings (font/logo/template object keys) as config fields — stable strings, not file bytes. The *binary* assets live in S3; only their keys are config.
  - [x] `load_brand_assets(brand_storage) -> BrandAssets` — fetch TTF/logo/template bytes by key, cache per-process (`@lru_cache` or module-level memo) so generation does not re-download per job. **Graceful absence:** if a brand asset is missing in dev/local, fall back to a built-in default (system font, no logo) and log `brand_asset_missing` rather than hard-failing local dev. In staging/prod a *required* asset missing → `BrandAssetMissingError` (422, `BRAND_ASSET_MISSING`) → job `failed` (R4). **Decision needed in Dev Agent Record:** which assets are hard-required vs optional.
  - [x] `BrandAssets` dataclass: font bytes (body/title + Nexa-if-present), logo bytes, colour hex tokens, pptx-template bytes. Colours/font-names are the stable tokens from `design/styles_v3.css` (§9).

- [x] **Task 4 — Wire branded generation into the runtime seam (AC: 1–5, R1, R2, R5)**
  - [x] In [app/services/execution_service.py](../../../velara-api/app/services/execution_service.py), refactor the three `_run_*` functions so the final-text → output-write step routes through a shared helper, e.g. `_persist_output(*, job, output_storage, content, base_metadata, output_format)`. **Do not duplicate the rendering call in three places.**
  - [x] Read `skill.output_format` (loaded already in `execute_skill` via `get_skill`). Pass it down to each `_run_*`.
  - [x] If `output_format` is NULL/`"text"` → **current behaviour exactly** (`outputs/{org_id}/{job_id}.txt`, `text/plain`, `format: "text"` metadata) — **R1**.
  - [x] Otherwise: load brand assets (Task 3), `render_output(...)`, write to `outputs/{org_id}/{job_id}.{ext}` with the correct content-type, and return that key + format/size metadata. Keep the file-by-key + `run_in_threadpool(output_storage.put, ...)` pattern.
  - [x] **Multi-file (AC5, "support N files now"):** the helper returns the **primary** `output_file_key` (back-compat with the single-key `InvocationResult` column + UNIQUE constraint) AND populates `result_metadata["output_files"] = [{"key": ..., "format": ..., "size_bytes": ..., "content_type": ...}, ...]`. For this story each runtime produces one file by default, so the list has one entry — but the *contract and presign path* support N. (True N-file generation per skill is driven later by 3.7 fan-out; the data shape is established now so no rework is needed then.) See Dev Notes §4 for the exact metadata shape.
  - [x] **PHI/IP (R3):** `output_service` rendering receives `content` but the caller must NOT log it; `result_metadata` gets `format`, `size_bytes`, `output_files` (keys + sizes only) — never the rendered content or skill internals.

- [x] **Task 5 — Surface multiple presigned download URLs on job GET (AC: 5, R3)**
  - [x] In [app/api/v1/jobs.py](../../../velara-api/app/api/v1/jobs.py) `get_job`, in addition to the existing single `output_file_url` (presign of `output_file_key`, **keep for back-compat**), presign **every** entry in `result_metadata["output_files"]` and expose them. Extend `JobResult` in [app/schemas/job.py](../../../velara-api/app/schemas/job.py) with `output_files: list[OutputFileRef] | None` where `OutputFileRef = {key, format, size_bytes, url}`.
  - [x] Reuse the **presign-failure graceful-degradation** pattern (try/except per URL → log `presign_download_failed`, set that `url=None`, never 500). Each file's `expires_s=86400` (24h).
  - [x] If `output_files` is absent (legacy / text jobs), fall back to the single-key behaviour unchanged.

- [x] **Task 6 — Error codes + dependencies (AC: 1–4, R4)**
  - [x] Add `OUTPUT_GENERATION_FAILED`, `UNSUPPORTED_OUTPUT_FORMAT`, `BRAND_ASSET_MISSING` as `VelaraHTTPException` subclasses in `output_service.py` (each with `ERROR_CODE`), and add matching `ERROR_CODE_*` constants + `isinstance` branches in `execution_tasks._map_error_code` — **placed before the anthropic block** (mirror the hybrid codes) so an output failure is never mislabeled `LLM_*` (see Dev Notes §5).
  - [x] Add to `pyproject.toml` `dependencies` (exact `==` pins, alphabetise sensibly): **`reportlab`** (PDF writer) and **`python-pptx`**. `python-docx==1.2.0` and `openpyxl==3.1.5` are already present — reuse, do not re-add or bump. Verify reportlab/python-pptx pull **no native/apt deps** (they don't — pure Python) so the existing Dockerfile needs no system packages.
  - [x] **Rebuild Docker after dep change:** `docker compose build api worker && docker compose up -d` (source is baked into the image, NOT volume-mounted — see Dev Notes §8, the recurring pitfall).

- [x] **Task 7 — Tests (AC: 1–6, R1–R5)**
  - [x] `tests/unit/services/test_output_service.py`: each generator produces a non-empty, valid file of the right format (assert magic bytes / re-open with the reader lib — e.g. `PdfReader` reads it back, `Document(BytesIO)` opens the docx, `load_workbook` opens the xlsx, `Presentation` opens the pptx); `render_output` dispatch + `UnsupportedOutputFormatError`; brand colour/font applied (assert font registered / colour present where the lib exposes it).
  - [x] `tests/unit/services/test_execution_service.py` (extend): `output_format=None` → text/plain path unchanged (**R1 regression**); each format → correct key extension + content-type + `output_files` metadata; PHI not logged.
  - [x] `tests/integration/api/test_jobs.py` (extend): completed job with `output_files` → GET presigns each (assert N URLs, 24h); presign failure → `url=None`, not 500.
  - [x] `tests/integration/api/test_invocations.py` or a worker test: end-to-end a `pdf` skill via the `celery_eager` + `dispose_engine_after_test` fixtures (see Dev Notes §8) → job `completed`, output object in the (mock/MinIO) output bucket, audit `success` entry. Drive via the established `_drive_execution`/patch-`run_skill.delay` approach.
  - [x] Brand-asset-missing in staging-config → `BRAND_ASSET_MISSING` → job `failed` + `failure` audit entry (R4).
  - [x] Gates before marking review: `ruff check .` clean; full Docker suite `docker compose exec api pytest` green (current baseline 389 — expect new tests added, zero regressions).

## Dev Notes

> **Architecture-vs-reality reconciliation (read first):** The epic's wording ("the `generate_pdf` Celery task runs") and the architecture's `output_tasks.py` slot describe branded output as *standalone Celery tasks*. The **as-built** execution engine (Stories 3.1–3.5) uses a **single** `run_skill` task in which `execution_service` produces the final text and writes the result before `mark_completed`. **Decision (locked):** implement branded generation **inline in `execution_service`** (a render step after the runtime's final text, before `mark_completed`), with the four `generate_*` functions living in **`output_service.py`** as plain service functions — NOT new `@celery.task`s. This reuses the terminal-state guard, atomic-dispatch, fresh-session failure handler, and audit machinery already proven across 3.1–3.5, avoids a second job-hop, and keeps one `InvocationResult` per job. The `output_tasks.py` slot from the architecture is **intentionally not used** in this story; if a future story needs detached/async generation it can add tasks then. **Record this reconciliation in the Dev Agent Record.**

### 1. Source-tree map — what to touch

| File | Action | Why |
|------|--------|-----|
| `app/services/output_service.py` | **NEW** | Brand-rendering functions + `render_output` dispatch + output error codes + format/content-type constants + `BrandAssets`/`load_brand_assets`. |
| `app/models/skill.py` | UPDATE | Add `output_format` column (Task 1). |
| `app/db/migrations/versions/0009_skill_output_format.py` | **NEW** | `down_revision="0008_invocation_job_inputs"`. |
| `app/services/execution_service.py` | UPDATE | Route the final-text→output write through a shared `_persist_output` helper that renders branded output by `output_format` (Task 4). The seam is the three identical blocks writing `outputs/{org}/{job}.txt` (lines ~276–293, ~392–413, ~672–690). |
| `app/core/config.py` | UPDATE | Add `S3_BRAND_BUCKET` + brand-asset key settings (Task 3). |
| `app/integrations/storage.py` | UPDATE | Add `get_brand_storage()` (Task 3). |
| `app/workers/execution_tasks.py` | UPDATE | Add output error codes + `_map_error_code` branches (Task 6). No structural change to `run_skill`. |
| `app/api/v1/jobs.py` | UPDATE | Presign every `output_files` entry (Task 5). |
| `app/schemas/job.py` | UPDATE | `JobResult.output_files` + `OutputFileRef` (Task 5). |
| `app/services/skill_service.py`, `app/schemas/skill.py` | UPDATE (or note gap) | Author `output_format` on create/edit (Task 1). |
| `pyproject.toml` | UPDATE | Add `reportlab`, `python-pptx` (Task 6). |
| `tests/unit/services/test_output_service.py` | **NEW** | Task 7. |
| `tests/unit/services/test_execution_service.py`, `tests/integration/api/test_jobs.py`, `tests/integration/api/test_invocations.py` | UPDATE | Task 7. |

**Naming:** Python `snake_case` modules/functions, `PascalCase` classes, `SCREAMING_SNAKE_CASE` module constants (PEP 8). Output object keys: `outputs/{org_id}/{job_id}.{ext}` (extends the existing `outputs/{org_id}/{job_id}.txt`). [Source: architecture/implementation-patterns-consistency-rules.md#naming-patterns]

### 2. The exact seam being replaced (CRITICAL — read these lines)

All three runtimes in `execution_service.py` end with the **identical** three lines, writing plain text:

```python
output_key = f"outputs/{job.org_id}/{job.id}.txt"
output_bytes = result.text.encode("utf-8")        # or result.stdout / final_text
await run_in_threadpool(output_storage.put, output_key, output_bytes, "text/plain")
```
- `_run_prompt`: [execution_service.py:277-279](../../../velara-api/app/services/execution_service.py#L277-L279), metadata at L281-291.
- `_run_code`: [execution_service.py:393-395](../../../velara-api/app/services/execution_service.py#L393-L395), metadata L405-411.
- `_run_hybrid`: [execution_service.py:672-674](../../../velara-api/app/services/execution_service.py#L672-L674), metadata L678-688.

Refactor these three into one `_persist_output(...)` helper. The function signature each `_run_*` already returns is `tuple[output_file_key: str, result_metadata: dict]` — **keep it**. `run_skill` passes `output_file_key`/`result_metadata` straight to `job_service.mark_completed` ([execution_tasks.py:156-173](../../../velara-api/app/workers/execution_tasks.py#L156-L173)) — no change needed there.

### 3. Job/result/storage facts the dev MUST honour

- **Result model is single-key.** `InvocationResult.output_file_key` (`String(1024)`, nullable) + `result_metadata` (JSONB), with **`UniqueConstraint("invocation_job_id")`** → one result row per job. [Source: app/models/invocation.py:122-164]. **Multi-file (AC5) is carried in `result_metadata["output_files"]`, NOT by adding result rows** — keeping the proven single-result invariant intact. The primary file's key still goes in `output_file_key` for back-compat with `GET /jobs`.
- **`mark_completed(*, session, job, output_file_key=None, result_metadata=None)`** is the ONLY way to write a result; it is terminal-guarded. Never set `job.status`/insert `InvocationResult` directly. [Source: app/services/job_service.py:258-283]
- **Storage is via the `StorageProvider` Protocol**, never raw boto3. `output_storage.put(key, bytes, content_type)` to write; `presign_download(key, expires_s=86400)` for the 24h URL. `get_output_storage()` / new `get_brand_storage()` factories. Inside async service code, wrap `put`/`get` in `run_in_threadpool` (boto3 is blocking); `presign_download` is CPU-only → safe inline. [Source: app/integrations/storage.py; app/api/v1/jobs.py:64-67]
- **SSE / encryption-at-rest:** bucket-default AES-256 SSE is **NOT** configured locally and **lands in Epic 7 IaC** (PutBucketEncryption on real buckets). Do **NOT** add a per-request `ServerSideEncryption` header to presigned URLs (the `SignatureDoesNotMatch` trap). For our **server-side** `put` (we control it) you MAY optionally pass `ServerSideEncryption="AES256"` — but the canonical guarantee is bucket-default SSE in Epic 7; treat output-bucket encryption as an Epic-7 dependency and note it. [Source: deferred-work.md "Bucket-default SSE → Epic 7"; epic-7 line 17 "S3 buckets (ingest, output, frontend) with AES-256 encryption"]
- **Streaming get for large files:** `S3StorageProvider.get()` does an unbounded `.read()` into memory; deferred-work explicitly names **Story 3.6** as a place to add `get_stream`. For Phase 1, generated outputs are bounded (skill final text → a document); a full streaming refactor is **out of scope** but if a generator must read a large brand template, fetch-once-and-cache (Task 3) keeps it bounded. Note any large-asset concern in the Dev Agent Record.

### 4. `result_metadata` shape (exact)

Text path (unchanged, R1) — e.g. prompt: `{"format":"text","char_count":...,"model":...,"input_tokens":...,"output_tokens":...,"stop_reason":...}`.

Branded path — **add** alongside the runtime's existing metadata keys (model/tokens/etc. stay):
```json
{
  "format": "pdf",                         // the output_format (pdf|docx|pptx|xlsx)
  "output_files": [
    {"key": "outputs/<org>/<job>.pdf",
     "format": "pdf",
     "content_type": "application/pdf",
     "size_bytes": 48213}
  ]
  // ...plus the runtime's existing model/token/char_count keys
}
```
**Never** put rendered content, skill internals, tool args, or tool results in `result_metadata` (R3, IP-protection AC6 of prior stories). Keys + sizes + counts only.

### 5. Error-code conventions (how to add the three new codes)

There is **no central enum file**. Two layers:
1. **Domain exceptions** subclass `VelaraHTTPException` (`app/core/exceptions.py`) with a `ERROR_CODE = "SCREAMING_SNAKE_CASE"` class var and `super().__init__(status_code, self.ERROR_CODE, "user-safe message")`. Put the new ones (`UnsupportedOutputFormatError`→`UNSUPPORTED_OUTPUT_FORMAT`, `OutputGenerationError`→`OUTPUT_GENERATION_FAILED`, `BrandAssetMissingError`→`BRAND_ASSET_MISSING`) in `output_service.py` (same module-local pattern as `execution_service`'s `ExecutionTimeoutError` etc.). Use **422** (client/skill-config error), matching the existing execution-error codes.
2. **Worker DB codes** = module-level `ERROR_CODE_*` constants at the top of `execution_tasks.py` + an `isinstance` branch in `_map_error_code` — **placed before the anthropic block** (lines ~263–293) so an output failure isn't mislabeled `LLM_*` or the generic `SKILL_EXECUTION_ERROR`. [Source: app/workers/execution_tasks.py:39-50, 257-323]

The global handler renders `{"error":{"code","message","request_id"}}`; raw exception text never reaches the DB or the caller — only the stable `error_code`. The real exception goes to structlog (`exc_info=exc`, PHI-sanitized) + Sentry on re-raise. [Source: app/core/exceptions.py; architecture/implementation-patterns-consistency-rules.md#enforcement-rules rule 5]

### 6. Config / settings pattern

`Settings(BaseSettings)` in `app/core/config.py`, `SCREAMING_SNAKE_CASE` env fields, `@lru_cache get_settings()`. Add `S3_BRAND_BUCKET` next to the other `S3_*_BUCKET` fields. If a brand asset becomes **required in prod**, add it to the `_reject_insecure_defaults_outside_dev` validator so a misconfig fails fast at boot — **but** prefer graceful dev fallback (Task 3) so local dev without brand binaries still runs. Constrained numeric config uses `Field(default=..., gt=0, le=N)` (see `EXECUTION_TIMEOUT_S`, `ANTHROPIC_MAX_TOKENS`). [Source: app/core/config.py:30-205]

### 7. Tech stack & library notes (versions verified against pyproject.toml)

- **Python 3.12+, FastAPI 0.115.6, Pydantic 2.10.4, SQLAlchemy 2.0.36 (async) + asyncpg 0.29.0, Alembic 1.13.3, Celery[redis] 5.4.0, boto3 1.35.71, anthropic 0.50.0, structlog 24.4.0.** [Source: velara-api/pyproject.toml]
- **Already present (REUSE, do not re-add/bump):** `python-docx==1.2.0`, `openpyxl==3.1.5`, `pypdf==6.1.0` (read-only — cannot write PDFs).
- **ADD:** `reportlab` (PDF writer — pure-Python, BSD, no native deps; **chosen** over weasyprint which needs Pango/cairo apt packages, and over fpdf2 for stronger font/layout control) and `python-pptx`. Pin both with `==`. Confirm neither adds a system/apt dependency to the Dockerfile.
- **openpyxl write pattern:** `openpyxl.Workbook()` → style header row (`Font`, `PatternFill` with brand hex), `wb.save(io.BytesIO())`. The repo already uses openpyxl in read mode in `document_parser.parse_xlsx` — same import.
- **python-docx write pattern:** `docx.Document()` (no path → blank), set styles/fonts/colours, `doc.save(io.BytesIO())`. Repo uses `Document(io.BytesIO(data))` for reading in `document_parser.parse_docx`.
- **python-pptx:** `Presentation(io.BytesIO(template_bytes))` to start from the Vitalief template, populate, `prs.save(io.BytesIO())`.
- **reportlab:** register TTFs via `pdfmetrics.registerFont(TTFont("OpenSans", io/path))`; use `platypus`/`canvas` for header/footer; brand colours via `reportlab.lib.colors.HexColor("#128F8B")`.
- **Constraint:** "open-source preferred; no proprietary dependencies that would prevent client-side deployment." reportlab (BSD) + python-pptx (MIT) satisfy this. [Source: architecture/Velara-Architecture-full.md#technical-constraints-dependencies]

### 8. Testing standards & the recurring Docker pitfall

- **Test layout:** `tests/unit/{services,workers,integrations}/`, `tests/integration/{api,workers}/`; files `test_<module>.py`. [Source: project-structure-boundaries.md; prior stories]
- **THE recurring pitfall:** source is **baked into the Docker image, NOT volume-mounted.** After ANY code or dependency change: **`docker compose build api worker && docker compose up -d`** before running tests, or you get stale code / `ModuleNotFoundError`. This bit every Epic-3 story.
- **Run:** unit (no services) `pytest tests/unit/`; integration (needs Postgres+MinIO+Redis) `docker compose up -d` then `docker compose exec api pytest tests/integration/...`; full suite `docker compose exec api pytest` (baseline **389** at end of 3.5).
- **Celery/execution test fixtures (in `tests/conftest.py`):** `celery_eager` (`task_always_eager=True` + `task_eager_propagates=True`) and the autouse `dispose_engine_after_test` (prevents asyncpg "Future attached to a different loop" pool contamination). **Reuse both** in any worker/execution test.
- **`asyncio.run()` inside `run_skill` cannot run under pytest-asyncio's already-running loop** — drive execution by calling the service functions in task order, or patch `app.api.v1.invocations.run_skill.delay` and use the `_drive_execution` helper. Keep imports module-level so they're patchable. (Recurs in 3.1/3.2/3.3/3.5.)
- **LLM is always mocked** (`FakeLLMProvider`); no real Anthropic calls in CI. For 3.6 the **render libs run for real** (reportlab/docx/pptx/openpyxl) writing to a mock/MinIO output bucket — assert by re-opening the generated bytes with the corresponding reader.
- **Integration auth:** copy `_auth_headers` from `tests/integration/api/test_jobs.py` (mint dev JWT via `DevAuthProvider().issue_token(...)`, seed users `ma.tech`/`consultant`/`client.user`); seed rows with the `_create_*_in_db` helpers.
- **Migration round-trip (every migration):** `docker compose exec api alembic upgrade head` → `alembic downgrade -1` → `upgrade head`, verify clean. Register the model change so autogenerate/`import app.models` sees it. Current head **`0008_invocation_job_inputs`** → new is **`0009_skill_output_format`**.
- **Lint gate:** `ruff check .` (line-length 100; rules `E,F,I,B,UP,W`; `B008` ignored).

### 9. Brand tokens (authoritative values — from `design/styles_v3.css`)

| Token | Hex | Use |
|-------|-----|-----|
| Teal (primary) | `#128F8B` | brand primary; technical/client accents |
| Navy / Ink | `#323843` | body ink, navy accent |
| Slate | `#4C5270` | secondary ink, methodological accent |
| Pink | `#F652A0` | accent only |

- **Headings: Poppins** (brand spec calls for **Nexa** — commercial; deferred until Vitalief supplies licensed `.otf`/`.ttf` files; **Poppins is the approved stand-in** — so the code must use Nexa *if its font asset is present in S3*, else Poppins).
- **Body: Open Sans.**
- These mirror the V3 web re-theme (Story 1.6, `@theme` tokens). The OLD pre-V3 3.6 spec named *Calibri/Georgia* — **superseded; do not use.** [Source: sprint-change-proposal-2026-06-09.md line 83; design/styles_v3.css lines 3-4, 14-22, 56-57]
- Brand binaries available in-repo for reference: `design/uploads/Brand Colors.png`, `design/uploads/Vitalief_Skills_Platform_BRD.docx`. The *production* fonts/logo/slide-template are provided by Vitalief at kickoff → stored in the brand-asset S3 bucket. For dev, ship sensible fallbacks (system font, placeholder logo) so local generation works without the licensed binaries.

### 10. IP-protection & PHI (load-bearing — non-negotiable)

- Only **output text + output file references (S3 keys)** travel back to callers; skill internals (prompt/code/tool defs/reference content) never appear in request or response — enforced structurally. Output content may contain **PHI**: render it into the file and store by key; **never log it, never inline it, never put it in `result_metadata`**. [Source: core-architectural-decisions.md#authentication-security; #api-communication; execution_service.py module docstring]
- PHI must never appear in object **keys** or URLs (keys are `outputs/{org}/{job}.{ext}` — opaque UUIDs, already safe). Presigned URLs are time-limited (24h) and signed — do not embed identifiers. [Source: implementation-patterns-consistency-rules.md#enforcement-rules]

### Project Structure Notes

- Aligns with the architecture's named slots: `services/output_service.py` ("branded output generation"), `schemas/output.py` (we instead extend `schemas/job.py` since output is surfaced through the existing job-result envelope — note this minor variance), and the `StorageProvider`/`s3_client` integration. **Variance (intentional, documented above):** the architecture's `workers/output_tasks.py` and `api/v1/outputs.py` slots are **not** created — branded generation runs inline in the existing `run_skill`/`execution_service` pipeline and is surfaced via the existing `GET /api/v1/jobs/{id}` result, matching the as-built single-task design of Stories 3.1–3.5. A dedicated outputs route/tasks can be added by a later story if detached generation is needed.
- `output_format` lives on `Skill` (new column, migration 0009) rather than in `output_schema` JSONB — explicit, validatable, mirrors `runtime_type`.

### References

- [epic-3-skill-execution-engine.md#Story-3.6](../../planning-artifacts/epics/epic-3-skill-execution-engine.md) — BDD acceptance criteria (lines 163–193).
- [5-functional-requirements.md](../../planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md) — OUT-01 (one-or-more files), OUT-02 (brand-by-default), OUT-03 (connector framework → Story 3.8, NOT here).
- [architecture/project-structure-boundaries.md](../../planning-artifacts/architecture/project-structure-boundaries.md) — `output_service.py`/`output_tasks.py`/`outputs.py` slots; FR→structure mapping; key data flows.
- [architecture/core-architectural-decisions.md](../../planning-artifacts/architecture/core-architectural-decisions.md) — StorageProvider abstraction, S3-key-reference, AES-256, V3 brand tokens (#frontend-architecture), async job model.
- [architecture/implementation-patterns-consistency-rules.md](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md) — error envelope, naming, Celery task naming, enforcement rules (no raw exceptions, hierarchy_scope, request_id).
- [sprint-change-proposal-2026-06-09.md](../../planning-artifacts/sprint-change-proposal-2026-06-09.md) — V3 re-theme; line 83 explicitly remaps Story 3.6 fonts/colours (Calibri/Georgia → Open Sans/Poppins + teal/navy).
- As-built code: `app/services/execution_service.py` (the seam), `app/services/job_service.py` (mark_completed/guards), `app/models/invocation.py` (result model), `app/integrations/storage.py` (StorageProvider/presign), `app/core/config.py` (Settings pattern), `app/workers/execution_tasks.py` (run_skill/_map_error_code), `app/api/v1/jobs.py` (presign-download path), `app/services/document_parser.py` (docx/xlsx/pdf lib usage to mirror).
- [deferred-work.md](../deferred-work.md) — bucket-default SSE → Epic 7; streaming `get` named for Story 3.6.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- **Ruff F401** — `import logging` unused in `output_service.py`; removed.
- **Ruff E501** — `OUTPUT_FORMATS` frozenset line too long; split to two lines.
- **Ruff F401** — `from docx.oxml.ns import qn` unused in `generate_docx`; removed.
- **Ruff I001** — import sort in `test_output_service.py` (`BrandAssetMissingError` before `BrandAssets`); auto-fixed by `ruff check . --fix`.
- **MagicMock `output_format` regression** — pre-existing unit tests use `_make_skill()` which creates a bare `MagicMock`; `MagicMock.output_format` auto-generates a nested `MagicMock` rather than `None`, so `render_output` received a `MagicMock` and raised `UnsupportedOutputFormatError`. Fix: explicitly set `skill.output_format = output_format` (default `None`) in `_make_skill()`. Docker images must be rebuilt after any test file change (source baked, not volume-mounted).

### Completion Notes List

- **Inline generation decision** — branded generation runs inside `_persist_output` helper within the existing `run_skill` task, not as standalone Celery tasks. The architecture's `output_tasks.py` slot is intentionally not created; this matches the as-built single-task design of Stories 3.1–3.5.
- **Brand-asset hard-required vs optional** — Decision: all binary assets (fonts, logo, PPTX template) are *optional*. Empty `BRAND_*_KEY` settings → graceful dev fallback (system Helvetica fonts, no logo, blank PPTX). Staging/prod with non-empty keys → missing object → `BrandAssetMissingError`. Colour tokens and font names are hardcoded design constants in `BrandAssets`, not S3-backed.
- **`output_format` schema validation** — `Literal["pdf","docx","pptx","xlsx","text"]` enforced at skill-create time via `SkillCreate.output_format`. Unknown values raise 422 `VALIDATION_ERROR` before the job runs.
- **`output_files` shape established now** — single-entry list per job for 3.6; contract supports N entries for Story 3.7 fan-out without schema rework.
- **Back-compat invariant verified** — `output_format=None` and `output_format="text"` both produce `.txt` with `text/plain`; all 389 pre-existing tests continue to pass (432 total with new tests).
- **Streaming get deferred** — `S3StorageProvider.get()` buffers into memory. Brand assets are cached per-process via `@lru_cache`; no streaming refactor needed for Phase 1.
- **Bucket-default SSE** — not configured locally; deferred to Epic 7 IaC per `deferred-work.md`.
- **Post-review Markdown rendering (2026-06-11, after code review).** Live testing against a real ARROW clinical-trial protocol surfaced that PDF/DOCX rendered the runtime's text as flat lines — LLM-emitted Markdown (`#`, `**`, `-`, `---`, and `| tables |`) appeared literally. Replaced the initial flat text-dumper with a proper Markdown engine: **`markdown-it-py==3.0.0`** (CommonMark + GFM tables, pure-Python, no system libs) parses the final text ONCE into a token AST, then `_render_pdf_tokens` → reportlab flowables (styled headings, bold/italic, bullet/ordered `ListFlowable`s, `HRFlowable` dividers, branded `Table`s with teal header + grid + zebra) and `_render_docx_tokens` → python-docx (headings, bold/italic runs, `List Bullet`/`List Number`, real `add_table`, HR bottom-border). XML-safety preserved: every text segment is escaped before `<b>/<i>` markup is applied, and `code_inline`/`html_inline` content is treated as literal text, so raw `<RET fusion>`/`R&D` cannot break reportlab's mini-XML parser. XLSX/PPTX unchanged. Verified end-to-end on the ARROW protocol (real Anthropic call, dev key, since removed): tables render as real tables with zero raw `|`/`---` markers. Tests cover inline markup, headings, HR, lists, and tables for both PDF and DOCX.

### File List

- `app/models/skill.py` — added `output_format` column
- `app/db/migrations/versions/0009_skill_output_format.py` — NEW: migration adding `output_format` VARCHAR(8) nullable to skills
- `app/schemas/skill.py` — added `OutputFormat` type alias, `output_format` field in `SkillCreate`/`SkillRead`
- `app/services/skill_service.py` — added `output_format` param to `create_skill()`
- `app/api/v1/skills.py` — passed `output_format=body.output_format` in create call
- `app/services/output_service.py` — NEW: brand-rendering functions (`generate_pdf/docx/pptx/xlsx`), `render_output` dispatcher, `BrandAssets` dataclass, `load_brand_assets`, error classes. Post-review: Markdown engine (`parse_markdown`, `_inline_to_rl_markup`, `_collect_table`, `_render_pdf_tokens`, `_render_docx_tokens`, `_emit_docx_list`) wiring `markdown-it-py` token AST into branded PDF/DOCX (headings, bold/italic, lists, tables, dividers).
- `app/core/config.py` — added `S3_BRAND_BUCKET` + brand asset key settings
- `app/integrations/storage.py` — added `get_brand_storage()`
- `app/services/execution_service.py` — added `_persist_output` helper, wired all three `_run_*` functions through it; re-exported output error classes
- `app/schemas/job.py` — added `OutputFileRef` model, `output_files` field on `JobResult`
- `app/api/v1/jobs.py` — added presigning loop for `output_files` in `get_job`
- `app/workers/execution_tasks.py` — added 3 output error code constants + isinstance branches in `_map_error_code`
- `pyproject.toml` — added `python-pptx==1.0.2`, `reportlab==4.5.1`, and (post-review) `markdown-it-py==3.0.0`
- `tests/unit/services/test_output_service.py` — NEW: comprehensive output_service unit tests; post-review added Markdown parsing/inline/PDF/DOCX table+list tests
- `tests/unit/services/test_execution_service.py` — extended: `_make_skill` now sets `output_format=None` by default; added `TestPersistOutput` class
- `tests/unit/workers/test_execution_tasks.py` — extended: output error code mapping tests + constants
- `tests/integration/api/test_jobs.py` — extended: AC5 output_files presigning tests
- `tests/integration/api/test_invocations.py` — extended (review): e2e PDF generation (AC1/AC5) + brand-asset-missing→failed (R4) tests; `_create_skill_in_db` gained an `output_format` param

## Review Findings

> Code review 2026-06-11 — 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 3 layers completed (none failed). Triage: 2 decision-needed, 6 patch, 5 defer, 10 dismissed. ACs 1–6 + R1/R2/R3/R5 satisfied; R4 wired but test-unverified (see patch). Findings below grouped by class.

> **All 8 patches APPLIED & verified 2026-06-11** — 434 Docker tests pass (+2 new integration tests over the 432 baseline), ruff clean. Both decision-needed findings were resolved → patch and applied.

### Decision Needed (both RESOLVED 2026-06-11 → patch, APPLIED)

- [x] [Review][Patch] (was Decision) Brand-asset prod enforcement: empty `BRAND_*_KEY` silently yielded `None` (unbranded output) in staging/prod instead of failing — `load_brand_assets._opt` returned `None` before the `is_dev` check. **APPLIED: fail closed in prod** — `_opt(..., required=True)` raises `BrandAssetMissingError` for empty/unfetchable Open Sans, Poppins, and logo keys when `not is_dev`; Nexa + PPTX template remain optional; dev stays graceful. Verified by `test_pdf_skill_brand_asset_missing_fails_with_stable_code`.
- [x] [Review][Patch] (was Decision) Logo loaded from S3 but never rendered. **APPLIED: render logo image** into PDF (per-page top-right via `_draw_header_footer`), DOCX (top of doc), and PPTX (slide top-right). Best-effort: a missing/unsupported (e.g. SVG) logo logs `brand_logo_render_failed` and falls back to the text wordmark rather than failing the job.

### Patch (all APPLIED)

- [x] [Review][Patch] PDF text not XML-escaped before `Paragraph` — APPLIED: `xml.sax.saxutils.escape` each body line so `<`, `&`, `List<T>`, `<thinking>` render literally instead of corrupting/raising [app/services/output_service.py:`generate_pdf` body loop]. **High.**
- [x] [Review][Patch] `get_job` 500s on a malformed `output_files` entry — APPLIED: the loop now requires `isinstance(raw_files, list)`, skips non-dict / missing-or-non-str-key entries (logged), and builds `OutputFileRef` with type-guarded `format`/`content_type`/`size_bytes`, so the per-file "never 500" contract holds [app/api/v1/jobs.py:`get_job`]. **High.**
- [x] [Review][Patch] XLSX hardcoded Calibri — APPLIED: header+body now use the Open Sans name token (Calibri was the superseded v2 token, Dev Notes §9), consistent with PDF/DOCX [app/services/output_service.py:`generate_xlsx`].
- [x] [Review][Patch] R4 + e2e integration tests absent — APPLIED: added `test_pdf_skill_executes_to_completed_with_output_and_audit` (AC1/AC5: job→completed, `%PDF` object in bucket, presigned `output_files`, PHI-free metadata, success audit) and `test_pdf_skill_brand_asset_missing_fails_with_stable_code` (R4/R5: forces staging → BRAND_ASSET_MISSING, failure audit, no stranded result row) [tests/integration/api/test_invocations.py].
- [x] [Review][Patch] `SoftTimeLimitExceeded` mislabeled — APPLIED: `render_output` now re-raises `SoftTimeLimitExceeded` before the blanket `except`, so a render overrun maps to `EXECUTION_TIMEOUT` not `OUTPUT_GENERATION_FAILED` [app/services/output_service.py:`render_output`].
- [x] [Review][Patch] XLSX cosmetic/consistency — APPLIED: real bounded column-A width tracking the widest cell (was no-op `min(120,60)`); blank lines skipped for parity with the other generators; `_load_asset_optional` warning now carries `error_type` + `exc_info` so S3 auth/endpoint errors aren't masked as benign "brand_asset_missing". (Incidental: `generate_pptx` now guards an empty-`slide_layouts` template → `OutputGenerationError` instead of `IndexError`.)

### Deferred (pre-existing class or design-dependent)

- [x] [Review][Defer] `load_brand_assets` `@lru_cache(maxsize=1)` permanently caches a degraded dev fallback after a transient first-call S3 blip — silent unbranded output until worker restart (dev-only; prod raises before caching) [app/services/output_service.py:181] — deferred, fix (TTL/invalidation) is a design choice, not unambiguous.
- [x] [Review][Defer] PPTX uses `slide_layouts[-1]` ("typically blank" — admitted assumption) with no Vitalief-template guarantee/footer; a real template's last layout may carry placeholders → overlapping boxes, or zero layouts → IndexError [app/services/output_service.py generate_pptx] — deferred, depends on the kickoff slide template (not yet provided).
- [x] [Review][Defer] `_hex_to_rgb` assumes 6-digit `#RRGGBB`; a future 3-digit/`rgba()` brand token raises ValueError mid-render [app/services/output_service.py docx/pptx color helpers] — deferred, color tokens are stable 6-digit config today; hardening only.
- [x] [Review][Defer] No size cap on `content` before render (large text → reportlab flowables / >1M XLSX rows → memory/CPU) [app/services/execution_service.py:_persist_output] — deferred, same class as the existing "unbounded context size" item (Story 3.3).
- [x] [Review][Defer] `update_skill_metadata` blind `setattr` loop applies no `OutputFormat` validation if the edit surface ever exposes `output_format` [app/services/skill_service.py update_skill_metadata] — deferred, edit surface for `output_format` was scoped out of Task 1; revisit when the edit route exposes it.

### Dismissed (10, recorded — not written as action items)

openpyxl availability (present, `openpyxl==3.1.5`; AC4 satisfied) · VARCHAR(8) overflow (longest value 4 chars) · `result_metadata` format/output_files clobber (by-design spread-override) · org_id S3-key path-traversal (server-derived FK, not user input; identical to pre-existing text path) · DOCX `runs[0]` else-branch (harmless defensive) · `getattr(skill, "output_format", None)` (harmless guard) · PDF font name-token rendering caveat (documented design) · lru_cache `TypeError unhashable` (provider is hashable singleton; speculative) · `OutputFileRef.size_bytes` default 0 (subsumed by the malformed-entry patch) · `generate_xlsx(text)` vs spec `generate_xlsx(rows)` signature (reasonable documented adaptation — runtime emits free text).
