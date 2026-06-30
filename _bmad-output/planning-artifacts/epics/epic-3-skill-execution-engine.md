# Epic 3: Skill Execution Engine

Consultants can execute prompt, code, and hybrid skills with document ingest, location-dependent fan-out, and branded output generation — all through the async job pipeline with full invocation logging.

## Story 3.1: Async Job Infrastructure

As a platform developer,
I want the InvocationJob model, Celery task infrastructure, and job polling endpoint,
So that all skill executions are queued, tracked, and retrievable regardless of execution duration.

**Acceptance Criteria:**

**Given** the Alembic migration for `invocation_jobs` and `invocation_results` runs
**When** I inspect the schema
**Then** `invocation_jobs` has: `id`, `skill_id`, `skill_version`, `status` (`queued`|`running`|`completed`|`failed`|`cancelled`), `created_by_user_id`, `hierarchy_path`, `created_at`, `updated_at`; `invocation_results` stores output reference (S3 key) and result metadata

**Given** a job is created
**When** I call `GET /api/v1/jobs/{job_id}`
**Then** the response includes `status`, `created_at`, and (when complete) `result` with output file references

**Given** a job is in `queued` status
**When** I call `POST /api/v1/jobs/{job_id}/cancel`
**Then** the job status transitions to `cancelled` and the Celery task is revoked if not yet started

**Given** a Celery task starts executing a job
**When** it begins processing
**Then** the job status transitions from `queued` to `running` and `started_at` is recorded

**Given** a Celery task completes successfully
**When** it finishes
**Then** the job status transitions to `completed`, `completed_at` is recorded, and the result is written to `invocation_results`

**Given** a Celery task raises an unhandled exception
**When** it fails
**Then** the job status transitions to `failed`, the error code is recorded (no raw exception in the DB), and Sentry captures the event

**Given** the Alembic migration for `audit_log_entries` runs
**When** I inspect the schema
**Then** `audit_log_entries` has: `id`, `skill_id`, `skill_version`, `user_id`, `hierarchy_path` (ltree), `runtime_type` (`prompt`|`code`|`hybrid`), `fan_out` (boolean), `invocation_id` (nullable parent ref for fan-out children), `started_at`, `completed_at`, `outcome` (`success`|`failure`|`cancelled`), `error_code` (nullable) — table is append-only with no UPDATE or DELETE operations permitted

---

## Story 3.2: Document Ingest Pipeline

As a Vitalief consultant,
I want to upload PDF, DOCX, and XLSX files (up to 100 MB) as inputs to skill invocations,
So that skills can process real documents as part of their execution.

**Acceptance Criteria:**

**Given** I call `POST /api/v1/ingest/presign` with a filename and content type
**When** the API responds
**Then** I receive a presigned S3 URL valid for 15 minutes and a `file_ref_id` for subsequent reference

**Given** I upload a file directly to the presigned S3 URL
**When** the upload completes
**Then** the file is stored in the ingest S3 bucket with server-side AES-256 encryption

**Given** I call `POST /api/v1/ingest/confirm` with a `file_ref_id`
**When** the API validates the file
**Then** it checks the MIME type (PDF/DOCX/XLSX only) and size (≤ 100 MB); invalid files return HTTP 422 with a clear error message

**Given** a valid file is confirmed
**When** the Celery `parse_document` task runs
**Then** the file content is extracted (text from PDF, content from DOCX, data from XLSX) and stored as structured content in the `file_references` table

**Given** a skill invocation references a `file_ref_id`
**When** the execution engine prepares the skill context
**Then** the parsed content is injected as context — the raw file content is never passed inline; only the S3 key reference travels through the system

**Given** an uploaded file has an unsupported MIME type (e.g., `.exe`)
**When** validation runs
**Then** HTTP 422 is returned with `{"error": {"code": "UNSUPPORTED_FILE_TYPE", "message": "Only PDF, DOCX, and XLSX files are accepted.", ...}}`

---

## Story 3.3: Prompt-Based Skill Execution

As a Vitalief consultant,
I want to execute prompt-based skills where the platform sends instructions and context to Claude and returns the output,
So that LLM-powered skills run server-side with skill internals never exposed to callers.

**Acceptance Criteria:**

**Given** a skill with `runtime_type: "prompt"` is invoked
**When** the Celery `run_skill` task dispatches it
**Then** `execution_service` routes to the prompt runtime, constructs the Claude API call with the skill's instruction set and context, and calls the Anthropic API

**Given** the Claude API returns a response
**When** the result is processed
**Then** the output text is stored in `invocation_results` and the job transitions to `completed`

**Given** a caller with a client-scoped token invokes a skill
**When** the response is returned
**Then** only the output text and any output file references are in the response — the skill's prompt instructions, system prompt, and reference file contents are never included

**Given** the Claude API returns a rate limit or server error
**When** the error is received
**Then** the task retries with exponential backoff (3 attempts); if all retries fail, the job transitions to `failed`

**Given** a prompt skill execution completes
**When** I check the audit log
**Then** an entry exists with: `skill_id`, `skill_version`, `user_id`, `hierarchy_path`, `runtime_type: "prompt"`, `started_at`, `completed_at`, `outcome: "success"`

---

## Story 3.4: Code-Based Skill Execution

As a Vitalief consultant,
I want to execute code-based skills where the platform runs Python deterministically in a sandbox,
So that skills with deterministic computation run safely without affecting other skills or platform stability.

**Acceptance Criteria:**

**Given** a skill with `runtime_type: "code"` is invoked
**When** the Celery `run_skill` task dispatches it
**Then** `execution_service` routes to the code runtime and executes the Python code in an isolated subprocess with a configurable timeout (default 300s)

**Given** the Python code executes successfully
**When** it completes
**Then** stdout/output is captured and stored in `invocation_results`; the job transitions to `completed`

**Given** a code skill execution times out
**When** the timeout threshold is reached
**Then** the subprocess is terminated, the job transitions to `failed` with `error_code: "EXECUTION_TIMEOUT"`, and no output is returned

**Given** a code skill raises an unhandled Python exception
**When** the exception propagates
**Then** the job transitions to `failed`; the raw exception message is logged internally but only `{"code": "SKILL_EXECUTION_ERROR", "message": "Skill execution failed."}` is returned to the caller

**Given** a code skill attempts to make an outbound network call not authorized in its definition
**When** the sandbox intercepts the call
**Then** the call is blocked and logged — sandbox isolation prevents network access unless explicitly permitted via the connector framework

---

## Story 3.5: Hybrid Skill Execution

As a Vitalief consultant,
I want to execute hybrid skills where Claude orchestrates the execution and calls Python tools,
So that complex methodology requiring both LLM reasoning and deterministic computation can be expressed as a single skill.

**Acceptance Criteria:**

**Given** a skill with `runtime_type: "hybrid"` is invoked
**When** the Celery `run_skill` task dispatches it
**Then** `execution_service` routes to the hybrid runtime, which starts a Claude API call with tool definitions matching the skill's declared code helpers

**Given** Claude returns a `tool_use` block during execution
**When** the hybrid runtime processes it
**Then** the named Python function is called with the provided arguments, the result is returned to Claude as a `tool_result`, and execution continues

**Given** a hybrid skill's tool call raises a Python exception
**When** the exception is caught
**Then** a structured error is returned to Claude as `tool_result` with `is_error: true`; Claude can handle or propagate it gracefully

**Given** a hybrid skill execution completes
**When** I inspect the audit log entry
**Then** `runtime_type: "hybrid"` is recorded and the full call chain (LLM → tool calls → results → final output) is logged for audit

---

## Story 3.6: Branded Output Generation

As a Vitalief consultant,
I want skill executions that produce PDF, PPTX, DOCX, or XLSX output files with Vitalief brand standards applied,
So that deliverables are consistently formatted and ready for client delivery without manual post-processing.

**Acceptance Criteria:**

**Given** a skill defines `output_format: "pdf"` and produces output content
**When** the `generate_pdf` Celery task runs
**Then** a PDF is generated with: Open Sans body font, Poppins title font (Nexa when Vitalief provides licensed files), the Vitalief brand color palette (teal `#128F8B` / navy `#323843`), standard Vitalief header and footer — and stored in the output S3 bucket

**Given** a skill defines `output_format: "docx"`
**When** the `generate_docx` task runs
**Then** a DOCX is generated applying the same brand standards via python-docx with Vitalief template styles

**Given** a skill defines `output_format: "pptx"`
**When** the `generate_pptx` task runs
**Then** a PPTX is generated using the Vitalief slide template (provided at kickoff) via python-pptx

**Given** a skill defines `output_format: "xlsx"`
**When** the `generate_xlsx` task runs
**Then** an XLSX is generated with Vitalief header row styling and sheet structure via openpyxl

**Given** output files are generated
**When** the job transitions to `completed`
**Then** each output file is stored in the output S3 bucket and the `invocation_result` record contains presigned download URLs (valid 24 hours)

**Given** brand assets (fonts, logo, color hex values) are provided by Vitalief at kickoff
**When** the output templates are configured
**Then** they are stored in S3 (not hardcoded) and loaded at generation time — updating brand assets requires no code change

---

## Story 3.7: Location-Dependent Skill Fan-Out

> ⚠️ **Deferred — sequenced after Epic 4 (Engagement Hierarchy).** This story requires Locations to exist to fan out over. Build it once Epic 4 has landed (or against seed locations). Core execution stories 3.1–3.6 and 3.8 have **no** hierarchy dependency and proceed normally.

As a Vitalief consultant,
I want location-dependent skills to either prompt me to select a location or fan out across all locations in a study,
So that site-specific skill invocations produce per-site outputs with a single trigger and a complete audit trail.

**Acceptance Criteria:**

**Given** a skill has `location_dependent: true` and is invoked within a Study context without a location selected
**When** the invocation request is received
**Then** the API returns HTTP 422 with `{"error": {"code": "LOCATION_REQUIRED", "message": "This skill requires a location selection.", ...}}` — the caller must re-submit with `location_id` or `fan_out: true`

**Given** the invocation is submitted with a specific `location_id`
**When** the skill executes
**Then** the location's postal code and metadata are injected into the skill context and the skill runs for that single location

**Given** the invocation is submitted with `fan_out: true` on a study with N locations
**When** `execution_service` processes it
**Then** N Celery `run_skill` tasks are dispatched in parallel (one per location) as a chord, each receiving that location's postal code and metadata

**Given** all N fan-out tasks complete
**When** the `aggregate_results` chord callback runs
**Then** the results are merged into a single parent job record; each child result is linked to its location and stored in `invocation_results`

**Given** a fan-out job completes
**When** I call `GET /api/v1/jobs/{parent_job_id}`
**Then** the response includes a `children` array with one entry per location, each showing `location_id`, `location_name`, `status`, and output reference

**Given** a fan-out job has N child invocations
**When** I check the audit log
**Then** one parent audit log entry exists with `fan_out: true` and N child entries, each referencing the parent `invocation_id`

---

## Story 3.8: External API Credential & Connector Framework

As an MA Tech developer,
I want skills to be able to make outbound API calls with credentials injected securely at execution time,
So that skills can pull data from external systems without ever exposing credentials in skill definitions.

**Acceptance Criteria:**

**Given** a skill definition declares an external API dependency (e.g., `requires: ["ctms_api"]`)
**When** the execution engine prepares the skill context
**Then** the named credential is fetched from AWS Secrets Manager and injected as an environment variable into the execution context — it does not appear in the skill definition or any log

**Given** a named credential does not exist in Secrets Manager
**When** the execution engine attempts to fetch it
**Then** the job transitions to `failed` with `error_code: "MISSING_CREDENTIAL"` — execution does not proceed

**Given** a new ingest connector is implemented (e.g., SharePoint)
**When** it follows the `IngestConnector` interface (`validate`, `fetch`, `parse` methods)
**Then** it can be registered and used by skills without modifying `execution_service.py` or any core execution code

**Given** a new output connector is implemented
**When** it follows the `OutputConnector` interface (`format`, `deliver` methods)
**Then** it can be registered and used similarly without modifying core execution code

---
