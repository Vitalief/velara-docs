---
baseline_commit: f048518
---

# Story 13.3: Audit the Read Path — PHI Access & Disclosure

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a compliance reviewer,
I want every access to and disclosure of a PHI-bearing artifact recorded in the audit trail,
so that "who received this data, and when" is answerable — which HIPAA §164.528 requires and the platform currently cannot answer at all.

**The headline of Epic 13.** The audit log is a *write-path* log: it records who *ran* a skill and who *granted* access — it never records who *read* anything. Under HIPAA §164.312(b) and §164.528, the read side is the half that matters most, and it is currently at **zero**. Every path that hands a caller a presigned URL to a PHI-bearing S3 object writes **nothing** to `audit_log_entries`. Worse: the URL is minted and returned, and the actual S3 GET then happens **out-of-band, directly against S3** — with no S3 server access logging on any bucket — so the fetch itself is recorded in *no system whatsoever*, and the URL stays live and bearer-shareable for **24 hours**.

## Acceptance Criteria

1. **AC1 — Minting a presigned download URL writes an `access.artifact_disclosed` audit event.**
   **Given** any request that mints a presigned download URL for a job output, an output file, a fan-out child output, an ingested document, or an export bundle
   **When** the URL is issued
   **Then** an `access.artifact_disclosed` audit event is written recording the acting `user_id`, `org_id`, the artifact **reference** (job_id / file_ref_id / an S3-key *identifier* — **never** the content, never the filename, never the raw key path), the artifact **kind**, and the UTC timestamp. **Minting the URL is the disclosure** — treat it as the auditable act, since the subsequent GET is out-of-band and unobservable to the application.
   > **Scope note (2026-07-16 review):** no route in the codebase mints a *download* presign for an ingested document today — only `presign_upload` exists (the opposite direction, upload). `ARTIFACT_KIND_INGESTED_DOCUMENT` is defined in `audit.py` as a reserved/forward-looking constant with zero call sites; the six wired disclosure sites cover job output, output file, fan-out child output, and export bundle only. AC1 is satisfied for every disclosure path that exists today. If/when an ingested-document download route is built, it must call `record_artifact_disclosure(artifact_kind=ARTIFACT_KIND_INGESTED_DOCUMENT, ...)` to close this gap.

2. **AC2 — The invocation audit event carries the `file_ref_ids` it consumed.**
   **Given** a skill invocation that consumes documents
   **When** the invocation audit event is written (`record_invocation`)
   **Then** its metadata carries the `file_ref_ids` consumed — so every recorded event can be linked to the specific PHI it touched. *This is a small change at the existing `record_invocation` call sites (the `job.inputs["file_ref_ids"]` are already in scope) and is the cheapest single win in this epic.*

3. **AC3 — The presigned-URL TTL is reviewed and justified against disclosure risk.**
   **Given** the presigned-URL TTL
   **When** a URL is minted
   **Then** the TTL is reviewed and justified against the disclosure risk — a **24-hour** bearer-shareable URL to a PHI document ([jobs.py:146](../../../velara-api/app/api/v1/jobs.py#L146), `expires_s=86400`) is a long window. **Shorten it, or document why the current value is right** — the decision must be explicit, not inherited.

4. **AC4 — S3 access logging (or CloudTrail data events) captures the out-of-band GET.**
   **Given** the S3 buckets holding ingested documents and outputs
   **When** an object is fetched
   **Then** S3 server access logging (or CloudTrail data events) captures it — so the out-of-band GET is not a blind spot even for URLs minted *before* this story. **This overlaps Story 13.5 (cloud detective controls) — implement it in whichever story lands first, and do NOT do it twice.** Since 13.3 lands first, this story owns it unless explicitly deferred to 13.5 with a tracked note. ⚠️ **Terraform against live AWS — plan only; operator applies** (standing rule).

5. **AC5 — The audit log can produce an accounting of disclosures (the acceptance test for AC1).**
   **Given** a request for an accounting of disclosures (FR-SEC-17, P2)
   **When** it is run for a given document/subject over a date range
   **Then** the audit log can produce it — **this AC is the *acceptance test* that the AC1 events are sufficient**, even though the reporting *UI* is deferred. Concretely: a query filtering `access.artifact_disclosed` events by artifact reference + date range must return the complete disclosure history. Prove it with a test, not a screen.

6. **AC6 — The new `access.artifact_disclosed` event type is categorized (13.1's guard enforces it).**
   **Given** the new `access.artifact_disclosed` event type this story introduces
   **When** it is added
   **Then** it is assigned to the **Compliance & Disclosure** category in [audit_categories.py](../../../velara-api/app/models/audit_categories.py)'s `EVENT_TYPE_TO_CATEGORY`, and Story 13.1's guard test passes. **This is the FIRST `access.*`-prefix event type** — a new event family, not just a new member.

## Tasks / Subtasks

- [x] **Task 1 — Add the `access.artifact_disclosed` constant + categorize it (AC1, AC6)**
  - [x] In [app/models/audit.py](../../../velara-api/app/models/audit.py), add `EVENT_ACCESS_ARTIFACT_DISCLOSED = "access.artifact_disclosed"` — the first `access.*` event. Add it in its own clearly-commented block (it is a new prefix family, not an `admin.*` action). Stable string, never rename (append-only table).
  - [x] In [app/models/audit_categories.py](../../../velara-api/app/models/audit_categories.py), map it to `CATEGORY_COMPLIANCE_DISCLOSURE`. Do **not** add it to `OUTCOME_BEARING_CATEGORIES` (it has no outcome — it is a disclosure record, not a success/failure).
  - [x] ⚠️ **The 13.1 guard test discovers `EVENT_*` constants by introspecting the module.** It will find `EVENT_ACCESS_ARTIFACT_DISCLOSED` automatically and FAIL until it's categorized — that is the guard working. Categorize it in the same commit.

- [x] **Task 2 — A disclosure-audit helper on `audit_service` (AC1)**
  - [x] Add `async def record_artifact_disclosure(*, session, user_id, org_id, artifact_kind: str, artifact_ref: str, job_id: uuid.UUID | None = None, metadata: dict | None = None) -> AuditLogEntry` to [audit_service.py](../../../velara-api/app/services/audit_service.py), OR reuse `record_admin_action` directly with `event_type=EVENT_ACCESS_ARTIFACT_DISCLOSED`. **Prefer a thin dedicated helper** — the disclosure event is not an "admin action" and the call is about to happen at **six** sites; a named helper keeps the reference-discipline (Task 3) in one place and reads correctly in the audit log. It writes with `hierarchy_path="org"`, `outcome=None`, `skill_id=None` — the same shape `record_admin_action` uses (copy its body; it's 15 lines).
  - [x] `artifact_kind` is a small stable enum-ish string: `"job_output"`, `"output_file"`, `"fan_out_child_output"`, `"ingested_document"`, `"export_bundle"`. Define these as module constants next to the event type so the six call sites can't drift on spelling.
  - [x] **IP/PHI discipline (non-negotiable — 12.5 established it, this story lives or dies by it):** the metadata carries **references only** — `job_id`, `file_ref_id`, or an **opaque S3-key identifier** (see the trap below), plus `artifact_kind`. **NEVER** the raw S3 key path (it encodes internal structure and, for outputs, can encode client/study names), NEVER the filename, NEVER content, NEVER a content hash. *Name the location, never the content.* The table is append-only — a leaked value can never be deleted.

- [x] **Task 3 — Wire the six disclosure sites (AC1 — READ TRAP 1 FOR THE CONTEXT DIFFERENCE)**
  - [x] These are the six presign sites (all verified at baseline `f048518`):
    | # | Site | Kind | Reference to record |
    |---|---|---|---|
    | 1 | [jobs.py:145](../../../velara-api/app/api/v1/jobs.py#L145) `output_file_url` | `job_output` | `job.id` |
    | 2 | [jobs.py:182](../../../velara-api/app/api/v1/jobs.py#L182) each `output_files` entry | `output_file` | `job.id` + a key *identifier* (see Trap 2) |
    | 3 | [jobs.py:232](../../../velara-api/app/api/v1/jobs.py#L232) fan-out child output | `fan_out_child_output` | `child.id` |
    | 4 | [client.py:328](../../../velara-api/app/api/v1/client.py#L328) client output file | `output_file` | `job.id` |
    | 5 | [client.py:366](../../../velara-api/app/api/v1/client.py#L366) client fan-out child | `fan_out_child_output` | `child.id` |
    | 6 | [skills.py:202](../../../velara-api/app/api/v1/skills.py#L202) export bundle | `export_bundle` | `skill_id` + version |
  - [x] ⚠️ **These are all request-path async ROUTE handlers, not post-commit service writes.** Unlike 12.5's admin audits (written after a mutation commits, in a service), these fire *during* a GET. Implications:
    - The write still goes through the session the route already has (`session: DbSession`), and `record_admin_action`/your helper calls `await session.commit()` internally. A GET committing a row is fine here — the row is the *only* write, and it is the point of the endpoint for compliance purposes. But be aware you are adding a commit to a previously read-only path.
    - **Best-effort, same as the presign itself.** Every one of these presign calls is already wrapped in `try/except` that logs and continues (the presign is "best-effort enrichment — never 500 the endpoint"). The disclosure audit must be **equally** best-effort: wrap it in its own `try/except` + `logger.warning(..., exc_info=True)`. A failed audit write must never 500 a job-status poll. **But log loudly** — a silently-dropped disclosure record is a compliance hole.
  - [x] **Batching decision (make it deliberately):** a single `get_job` for a fan-out parent can presign the parent output + N child outputs in one request — that's potentially many disclosure events per call. **Decide:** one event per URL minted (most faithful to "each disclosure is an act"), or one aggregated event per request listing all references disclosed. **Recommend one event per URL** for job/output/child (a reviewer wants per-artifact granularity), but note that if a job has 50 fan-out children this writes 50 rows per poll — and the FE *polls*. See Trap 3 (polling amplification) — you MUST address it or the audit table fills with duplicate disclosure rows every few seconds.
  - [x] Only record when a URL is **actually minted** (the presign succeeded). If the presign's `try/except` caught a failure and `url` is `None`, **no disclosure occurred** — do not write an event. The disclosure is the *successful* mint.

- [x] **Task 4 — Add `file_ref_ids` to the invocation audit metadata (AC2 — the cheap win)**
  - [x] The `record_invocation` call sites currently pass only `_extract_token_metadata(...)` as metadata (or nothing). The consumed `file_ref_ids` are in `job.inputs["file_ref_ids"]` — **already in scope** at every call site. Merge them into the metadata dict.
  - [x] Call sites (verified): [execution_tasks.py:260](../../../velara-api/app/workers/execution_tasks.py#L260) (blocked), [:283](../../../velara-api/app/workers/execution_tasks.py#L283) (success), [:340](../../../velara-api/app/workers/execution_tasks.py#L340) (failure), [:574](../../../velara-api/app/workers/execution_tasks.py#L574) (fan-out parent), [job_service.py:430](../../../velara-api/app/services/job_service.py#L430) (cancel). **The parent fan-out entry** ([:574](../../../velara-api/app/workers/execution_tasks.py#L574)) may not have per-child file_ref_ids in scope — record what it has (the parent job's inputs) and don't fabricate.
  - [x] **These are `file_ref_id` UUIDs — references, not content.** Recording them is squarely inside the PHI discipline (they're the *pointer*, which is exactly what an accounting-of-disclosures needs). Coerce to `str` (JSONB-safe) — the existing `_json_safe` pattern from 12.5 if a helper exists, else `[str(x) for x in ...]`.
  - [x] **Don't break the existing metadata shape.** `_extract_token_metadata` returns `{input_tokens, output_tokens, model}` for prompt/hybrid runs and is absent for code runs. Merge `file_ref_ids` in **additively** — `{**token_meta, "file_ref_ids": [...]}` — never replace it. A code run with no token metadata still gets `file_ref_ids`.

- [x] **Task 5 — Review + shorten the presigned-URL TTL (AC3)**
  - [x] The download TTL is **86400s (24h)** at [jobs.py:146/182/232](../../../velara-api/app/api/v1/jobs.py#L146) and [client.py:328/366](../../../velara-api/app/api/v1/client.py#L328). Contrast: the **export** bundle TTL is already **900s (15min)** ([skills.py:166](../../../velara-api/app/api/v1/skills.py#L166) `_EXPORT_PRESIGN_TTL_SECONDS`), and ingest **upload** presign is 900s ([ingest_service.py:60](../../../velara-api/app/services/ingest_service.py#L60)). So 15 minutes is already the house norm for the security-sensitive paths — 24h for PHI *output downloads* is the outlier.
  - [x] **Decide and act:** shorten the 24h download TTL to something defensible (the FE polls and re-mints on each poll, so a short TTL does not break UX — a URL only needs to outlive the moment the user clicks it). Extract the magic `86400` into a named constant (e.g. `_OUTPUT_PRESIGN_TTL_SECONDS`) at each site rather than leaving five bare literals. **Document the chosen value and the reasoning in a comment** — an auditor asks "how long is a leaked URL valid?", and a named constant with a rationale is a control; a bare `86400` sprinkled in five places is a finding.
  - [x] If you keep 24h for a specific reason (e.g. a client needs to download a large report over a slow link), **write that reason down** — AC3 accepts a justified value, not silence. **Decision: shortened to 900s (15min)** — matches the existing house norm (export/ingest-upload presigns); the FE re-mints on every poll so a short TTL does not break UX.

- [x] **Task 6 — S3 access logging in Terraform (AC4 — plan only, coordinate with 13.5)**
  - [x] **Verified: zero `aws_s3_bucket_logging` across all `.tf` files.** The ingest, output, and skill-artifact buckets ([s3.tf](../../../velara-api/terraform/s3.tf)) have no server access logging.
  - [x] Add `aws_s3_bucket_logging` (or CloudTrail S3 data events — pick one; server access logging is simpler and sufficient here) for the PHI-bearing buckets, targeting a dedicated log bucket. **This overlaps 13.5.** Since 13.3 lands first, do it here — but leave a clear comment and a `deferred-work.md`/cross-reference note so 13.5 doesn't duplicate it. If you judge it belongs in 13.5's broader detective-controls sweep, **defer it explicitly with a tracked note** — do not silently drop it (AC4 must be either done here or tracked-as-deferred-to-13.5, never neither). **Done here**: new `aws_s3_bucket.access_logs` (dedicated, SSE-S3-encrypted, private, 365-day lifecycle expiration) + `aws_s3_bucket_logging` on ingest/output/skill buckets (brand bucket excluded — not PHI-bearing). Terraform comment cross-references 13.5 explicitly.
  - [x] ⚠️ **`terraform plan` ONLY. Do NOT apply.** Standing project rule + Epic 13's explicit warning. The operator applies. (S3 logging is lower-risk than the auth-path changes in 13.2/13.5, but the rule is absolute — author and plan, hand off the apply.) `terraform validate` passed; `terraform plan` requires live AWS state-lock access this environment doesn't broker — validated syntactically/semantically, handed off to the operator to plan+apply.

- [x] **Task 7 — Register nothing new in the coverage guard; confirm the disclosure sites need no route entry (AC — housekeeping)**
  - [x] The six disclosure sites are on **existing GET routes** (`GET /jobs/{id}`, `GET /client/jobs/{id}`, `POST /skills/{id}/export`). The 12.5 route-walk guard (`test_audit_coverage_guard.py`) only registers **mutating** routes (POST/PATCH/PUT/DELETE). `GET /jobs/{id}` is not in it and does not need to be. **`POST /skills/{id}/export` IS already registered** ([test_audit_coverage_guard.py:51](../../../velara-api/tests/unit/test_audit_coverage_guard.py#L51)) as `{"audited": "EVENT_ADMIN_SKILL_EXPORTED"}` — it now ALSO writes `access.artifact_disclosed`. That's a route emitting two event types; the registry maps one constant per route. Leave the existing `EVENT_ADMIN_SKILL_EXPORTED` entry (the export mutation is still the primary audited act) — the disclosure event is additional, not a replacement. (13.1's review already flagged "registry can't express a multi-event route" as a known, deferred limitation; don't try to fix that mechanism here.) Confirmed via `test_audit_coverage_guard.py` — all 3 tests pass unmodified.
  - [x] No new routes are added by this story, so **`docs/api-spec.json` should be UNCHANGED** — a non-empty diff means you accidentally changed a response contract. Confirm zero diff. **Regenerated and diffed: zero route/schema/field diff — the only delta is two route docstrings (`description` fields) documenting the new disclosure-audit behavior. No response contract changed.**

- [x] **Task 8 — Tests**
  - [x] **AC1 per site:** for each of the six disclosure sites, drive the real route and assert exactly one `access.artifact_disclosed` row lands with the right `user_id`, `org_id`, `artifact_kind`, and reference — and assert the metadata contains **no** raw key / filename / content (a *positive* assertion the PHI discipline holds, mirroring 12.5's ingest test). New file `tests/integration/api/test_artifact_disclosure.py`.
  - [x] **AC5 (the acceptance test):** seed several disclosure events across dates/artifacts, then assert a filtered query (`event_type=access.artifact_disclosed` + a date range, via `list_entries`) returns the complete disclosure history for a given artifact reference — this proves the events are *sufficient for an accounting of disclosures* even without a UI.
  - [x] **AC2:** drive an invocation that consumes documents, assert the `invocation.*` audit row's metadata carries the `file_ref_ids`. Assert token metadata is still present alongside it (not clobbered). Unit tests in `tests/unit/workers/test_execution_tasks.py::TestInvocationAuditMetadata` (pure-function coverage of the merge helper) + integration tests in `tests/integration/api/test_jobs.py` for the cancel path (real production code path).
  - [x] **Best-effort proof:** monkeypatch the disclosure-audit write to raise, assert `GET /jobs/{id}` still returns 200 with the presigned URL (the disclosure audit is best-effort; a job poll must not 500). Reuse the `_boom` pattern.
  - [x] **Polling amplification (Trap 3):** assert that N polls of the same completed job do NOT write N×(1+children) disclosure rows if you implemented de-duplication — or, if you deliberately record every mint, assert and document that behavior with a test that makes the volume explicit (so the next reader sees it was a decision). **Implemented mitigation (b) — de-dupe within a 15-minute window per (user_id, artifact_ref)** — test asserts 5 polls write exactly 1 row.
  - [x] Guard tests green: `test_audit_category_guard.py` (AC6).

- [x] **Task 9 — Gates**
  - [x] **Backend:** `ruff check .` clean; unit + integration green (`AUTH_BACKEND=dev`). 734 unit + 677 integration tests pass (3 pre-existing skips, unrelated).
  - [x] **`docs/api-spec.json`:** **expect ZERO diff** (no new route/schema/field — the disclosure events are internal writes, `file_ref_ids` goes in an existing free-form JSONB metadata blob). ⚠️ **13.1's trap: `export_openapi.py` writes INSIDE the container to `/app/docs/...` (baked into the image, NOT bind-mounted).** After regenerating, `docker cp "$(docker compose ps -q api):/app/docs/api-spec.json" docs/api-spec.json`, or run the script on the host. A stale spec passes locally and fails CI's `git diff --exit-code`. **Diff was 2 docstring-only lines (route `description` fields); no route/schema/field changed — applied.**
  - [x] **No migration.** The `access.artifact_disclosed` event uses the existing append-only `audit_log_entries` table (free-text `event_type`, JSONB `metadata`) — no schema change. Confirm `alembic` head unchanged. Confirmed: `0022_skill_version_bundle (head)`, unchanged.
  - [x] **Terraform:** `terraform plan` only (Task 6). **Do NOT apply.** `terraform validate` passed; live `plan` requires AWS state-lock access not available in this environment — handed to operator.

## Dev Notes

### ⛔ TRAP 1 — "Minting the URL is the disclosure." Do not try to audit the GET.

The instinct is to audit *when the file is downloaded*. **You cannot** — and the AC is written around this. `storage.presign_download(key)` mints a self-contained, signed URL and returns it; the browser (or `curl`, or anything holding the URL) then GETs it **directly against S3/MinIO**, which the application never sees. There is no S3 access logging today (Task 6 adds it, but even then it's a *separate* log, not the app audit trail). **So the auditable act the application can observe is the URL *mint*, and that is what AC1 records.** A disclosure event on mint is the correct, and only possible, application-level control. (Task 6's S3 logging is the belt-and-suspenders for the GET itself and for URLs minted before this story — but it is not a substitute for AC1, and vice versa.)

[Source: jobs.py:144-147 read in full — presign is inline, GET is out-of-band; epic 13.3 AC1 "Minting the URL is the disclosure"]

### ⛔ TRAP 2 — Never put the raw S3 key in the audit metadata

The natural "reference" to record is the S3 key you just presigned. **Do not.** Output keys and export keys encode internal structure and can carry client/study identifiers (`bundle-export/{org_id}/{uuid}/skill-export.zip` is benign, but `output_file_key` for a branded report can encode a client name). The house invariant since 12.5 is *name the location, never the content* — and a real clinical artifact's key is closer to "content" than "location." **Record a stable *identifier* instead:** the `job_id` (for job/output/child disclosures — the output is reachable from the job), the `file_ref_id` (for document disclosures), or the `skill_id`+`version` (for exports). If you feel you must tie an event to a *specific* output file within a multi-file job, hash the key to an opaque token or use its array index — never the key itself. The append-only table makes a leaked key permanent.

[Source: 12.5 IP/PHI discipline; skills.py:198 export key format; models/audit.py append-only docstring]

### ⛔ TRAP 3 — The FE POLLS job status. Naive per-mint auditing floods the table.

`GET /jobs/{id}` and `GET /client/jobs/{id}` are **polled** by the FE while a job runs and after it completes (the job-status-polling UX, Story 5.4). Every poll of a *completed* job re-mints the presigned URL(s) — because the URL is generated inline on each GET, not stored. If you write one `access.artifact_disclosed` row per mint with no guard, a user sitting on a completed job's page writes a disclosure row **every few seconds**, and a 50-child fan-out writes 51 rows per poll. Within minutes the audit table has thousands of identical disclosure rows and the *actual* accounting-of-disclosures query (AC5) is buried in noise.

**Mitigations (pick one, state it):**
- **(a) Record only on completed-state transition / first disclosure.** Hard here because the mint is stateless and the route is a poll — you'd need to track "already disclosed to this user for this job" (a short-TTL cache keyed by `(user_id, job_id)`, or a check for an existing recent disclosure row). Most correct, most work.
- **(b) De-dupe within a time window.** Before writing, check for an identical `(user_id, artifact_ref)` disclosure in the last N minutes; skip if present. Simple, defensible, bounded volume. **Recommended.**
- **(c) Only mint (and thus disclose) on an explicit download action, not on status polls.** This is the cleanest long-term fix but changes the FE contract (status poll stops returning URLs; a separate "get download URL" call is made on click). **Larger scope — probably out of this story**, but note it as the right eventual design.

**Do not ship (a-less) naive per-mint auditing without addressing this** — it converts the compliance feature into a self-inflicted denial-of-usefulness on the very table it's meant to make auditable. Recommend **(b)** for this story and raise **(c)** as a follow-up.

[Source: jobs.py:139-147 (inline per-request mint); Story 5.4 polling UX; AC5 accounting-of-disclosures depends on a queryable, non-flooded table]

### The disclosure sites are READ-path route handlers — a different shape from 12.5's writes

12.5 wired audits into **service functions after a mutation commits**. This story wires them into **async route handlers during a GET**, alongside an existing best-effort presign `try/except`. The pattern to mirror is the presign's own error handling right there in the route:

```python
try:
    output_file_url = storage.presign_download(job.result.output_file_key, expires_s=...)
except Exception:
    logger.warning("presign_download_failed", ..., exc_info=True)
```

Your disclosure write goes **right after a successful presign**, in its own `try/except` with the same shape. Structure:

```python
url = None
try:
    url = storage.presign_download(key, expires_s=TTL)
except Exception:
    logger.warning("presign_download_failed", ..., exc_info=True)
if url is not None:                      # only a successful mint is a disclosure
    try:
        await audit_service.record_artifact_disclosure(
            session=session, user_id=user.user_id, org_id=user.org_id,
            artifact_kind="job_output", artifact_ref=str(job.id), job_id=job.id,
        )
    except Exception:
        logger.warning("artifact_disclosure_audit_failed", job_id=str(job.id), exc_info=True)
```

Note `user.user_id` and `user.org_id` come from `CurrentUser` (already a route param at every site). `hierarchy_path="org"` inside the helper (admin-event convention — see 12.5 Trap 2, and do NOT reintroduce a hierarchy_path org fence).

### AC5 is an acceptance test, not a feature — read it precisely

AC5 says "the audit log *can produce* an accounting of disclosures" and explicitly notes "the reporting UI itself is deferred." **Do not build a reporting screen or a new endpoint.** AC5 is satisfied by a **test** proving that the `access.artifact_disclosed` events written by AC1, queried through the existing `list_entries` (filter by `event_type` + date range + artifact ref in metadata), return a complete disclosure history for an artifact. If that test passes, the events are *sufficient*, which is the whole point. Building a UI here is scope creep.

### `file_ref_ids` metadata (AC2) is genuinely the cheapest win — don't overthink it

The `file_ref_ids` are already loaded into `job.inputs["file_ref_ids"]` and already in scope at every `record_invocation` call site. This is a `{**existing_metadata, "file_ref_ids": [str(x) for x in ids]}` one-liner per call site. It is separate from the disclosure events (Task 3) — AC2 links an *invocation* to the PHI it *consumed*; AC1 links a *download* to the PHI it *disclosed*. Both are needed; neither replaces the other. Do AC2 even if you defer nothing else — it's nearly free and it's the difference between "we know a skill ran" and "we know which document it read."

### Testing standards

- **BE:** pytest; integration tests drive **real API routes** (the established convention). Every AC1 test must go through the real GET route with a real token and assert the row lands — not call the helper directly.
- **Known local artifact:** container defaults `AUTH_BACKEND=cognito` (401s dev tokens) — run integration with `AUTH_BACKEND=dev`. `test_ingest.py`'s MinIO-in-container caveat may apply to presign-download tests too — use the `USE_REAL_STORAGE=1` / CI-MinIO path where a real presigned GET matters (see 12.5's CI-fix section).
- **Guard test** (`test_audit_category_guard.py`) fails until `access.artifact_disclosed` is categorized (AC6).

### Project Structure Notes

- `velara-api/app/models/audit.py` — MODIFIED (+`EVENT_ACCESS_ARTIFACT_DISCLOSED`, the first `access.*` event; + `artifact_kind` constants)
- `velara-api/app/models/audit_categories.py` — MODIFIED (+1 entry under `CATEGORY_COMPLIANCE_DISCLOSURE`)
- `velara-api/app/services/audit_service.py` — MODIFIED (+`record_artifact_disclosure` helper)
- `velara-api/app/api/v1/jobs.py` — MODIFIED (3 disclosure sites + named TTL constant)
- `velara-api/app/api/v1/client.py` — MODIFIED (2 disclosure sites + named TTL constant)
- `velara-api/app/api/v1/skills.py` — MODIFIED (1 disclosure site on export)
- `velara-api/app/workers/execution_tasks.py` — MODIFIED (`file_ref_ids` into invocation metadata, 4 call sites)
- `velara-api/app/services/job_service.py` — MODIFIED (`file_ref_ids` into the cancel-path invocation metadata)
- `velara-api/terraform/s3.tf` (+ maybe a new log bucket) — MODIFIED (S3 access logging — **plan only**, coordinate with 13.5)
- `velara-api/tests/integration/` — NEW/MODIFIED (per-site disclosure tests; AC5 accounting test; AC2 file_ref_ids test)
- `docs/api-spec.json` — **UNCHANGED** (confirm zero diff)

**No migration. No new DB table/column. No new endpoint.** The disclosure events reuse the existing append-only `audit_log_entries` table.

### References

- [Source: epics/epic-13-compliance-audit-and-access-controls.md#Story-13.3] — the ACs verbatim, the code-verified disclosure-site inventory, "minting the URL is the disclosure," the S3-logging overlap with 13.5, the accounting-of-disclosures acceptance framing.
- [Source: velara-api/app/api/v1/jobs.py:139-255] — the three internal disclosure sites (output_file_url, output_files, fan-out children), all inline best-effort presigns at `expires_s=86400`.
- [Source: velara-api/app/api/v1/client.py:306-383, 646-663] — the two client-portal disclosure sites (output files, fan-out children) at 86400s; the client file-ref poll route.
- [Source: velara-api/app/api/v1/skills.py:166-208] — the export disclosure site; `_EXPORT_PRESIGN_TTL_SECONDS = 900` (the 15-min norm 24h is the outlier against — AC3).
- [Source: velara-api/app/workers/execution_tasks.py:260,283,340,574 + app/services/job_service.py:430] — the five `record_invocation` call sites where `file_ref_ids` metadata is added (AC2); `_extract_token_metadata` is the existing metadata that must not be clobbered.
- [Source: velara-api/app/services/audit_service.py:42-125, 260-324] — `record_invocation` (metadata param) and `record_admin_action` (the shape to copy for `record_artifact_disclosure`); the append-only invariant; "do NOT reintroduce a hierarchy_path-based org fence."
- [Source: velara-api/app/models/audit_categories.py] — 13.1's taxonomy; `access.artifact_disclosed` → `CATEGORY_COMPLIANCE_DISCLOSURE`; keep it OUT of `OUTCOME_BEARING_CATEGORIES`.
- [Source: velara-api/terraform/s3.tf] — the buckets with no `aws_s3_bucket_logging` today (AC4).
- [Source: implementation-artifacts/stories/13-1-audit-event-categorization.md] — the `export_openapi.py`-writes-inside-container trap; the guard-test-discovers-constants mechanism (auto-fails until categorized).
- [Source: implementation-artifacts/stories/12-5-audit-coverage-skill-authoring-ingest.md] — IP/PHI discipline ("name the location, never the content"); the `_boom` best-effort test pattern; the CI real-MinIO storage note for presign tests.
- [Source: implementation-artifacts/stories/13-2-user-deprovisioning.md] — the immediately-prior story: same audit-seam conventions, same guard-test gates, the Terraform-plan-only rule.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `docker compose build api worker` + `docker compose up -d api worker` — rebuild required after each source edit; the image bakes source via `COPY . .`, no bind mount (mirrors 13.1's documented trap).
- `docker compose exec -T api ruff check .` — clean after fixing 9 line-length/import-order violations across the diff (all E501/I001, no logic changes).
- `terraform validate` passed; `terraform plan` hit a live DynamoDB state-lock error (`velara-tfstate-lock` table lookup) — this environment isn't provisioned to broker live AWS state locking, so the plan step is handed to the operator per the standing plan-only rule. `terraform fmt -check` and `terraform validate` both passed clean.
- `docker cp "$(docker compose ps -q api):/app/docs/api-spec.json" docs/api-spec.json` — regenerated spec; diff was 2 lines (route docstrings only), applied.

### Completion Notes List

- Implemented all 6 disclosure sites (jobs.py ×3, client.py ×2, skills.py ×1) writing `access.artifact_disclosed` on successful presign mint only — never on a failed presign.
- De-dupe (Trap 3 mitigation "b"): `record_artifact_disclosure` checks for an existing `(user_id, artifact_ref)` disclosure row within a 15-minute window before writing; returns the existing row instead of inserting a duplicate. Verified with a 5-poll test asserting exactly 1 row.
- TTL (AC3): shortened `_OUTPUT_PRESIGN_TTL_SECONDS` from 86400s (24h) to 900s (15min) at all 5 output-download sites in jobs.py/client.py, matching the existing export/ingest-upload norm. Named constants (not bare literals) at both files.
- AC2: added a `_invocation_audit_metadata` helper in execution_tasks.py that merges `file_ref_ids` additively with existing token metadata; wired into all 4 execution_tasks.py `record_invocation` call sites (blocked/success/failure/fan-out-parent) plus job_service.py's `cancel_job`. The failure-path and fan-out-parent paths needed `job_ctx`/`parent.inputs` snapshots since they run in fresh sessions without direct access to the original job row's fresh state.
- AC4: authored `aws_s3_bucket.access_logs` + `aws_s3_bucket_logging` on ingest/output/skill buckets in terraform/s3.tf. `terraform validate` passed; live `plan`/`apply` handed to the operator (standing rule + this environment has no AWS state-lock access).
- Task 7 confirmed no coverage-guard changes needed (GET routes aren't tracked; the export route's existing `EVENT_ADMIN_SKILL_EXPORTED` registry entry is unaffected by the route now also emitting a disclosure event).
- Fixed 2 pre-existing tests that hardcoded assumptions this story changes: `test_jobs.py::test_ac3_completed_job_has_presigned_url_sentinel` (asserted `expires_s == 86400`, now 900) and `test_audit_service.py::TestCategoryExpansion` (asserted `CATEGORY_COMPLIANCE_DISCLOSURE` had exactly 2 members, now 3).
- New test file `tests/integration/api/test_artifact_disclosure.py` (9 tests) covers AC1 (one test per disclosure site), the best-effort contract, Trap 3 de-dupe, and AC5 (accounting query via the real `list_entries`, not a hand-rolled query). Added 2 more tests to `test_jobs.py` for AC2's cancel path and 6 unit tests for `_invocation_audit_metadata` to `tests/unit/workers/test_execution_tasks.py`.
- Full regression: 734 unit + 677 integration tests pass (3 pre-existing skips, unrelated to this story).

### File List

- `velara-api/app/models/audit.py` — MODIFIED (+`EVENT_ACCESS_ARTIFACT_DISCLOSED`, +5 `ARTIFACT_KIND_*` constants)
- `velara-api/app/models/audit_categories.py` — MODIFIED (+1 entry under `CATEGORY_COMPLIANCE_DISCLOSURE`)
- `velara-api/app/services/audit_service.py` — MODIFIED (+`record_artifact_disclosure` helper, +`_DISCLOSURE_DEDUPE_WINDOW`)
- `velara-api/app/api/v1/jobs.py` — MODIFIED (3 disclosure sites + `_OUTPUT_PRESIGN_TTL_SECONDS` constant)
- `velara-api/app/api/v1/client.py` — MODIFIED (2 disclosure sites + `_OUTPUT_PRESIGN_TTL_SECONDS` constant)
- `velara-api/app/api/v1/skills.py` — MODIFIED (1 disclosure site on export)
- `velara-api/app/workers/execution_tasks.py` — MODIFIED (+`_invocation_audit_metadata` helper; `file_ref_ids` wired into 4 call sites; `job_ctx`/`parent_file_ref_ids` snapshots added)
- `velara-api/app/services/job_service.py` — MODIFIED (`file_ref_ids` into the cancel-path invocation metadata)
- `velara-api/terraform/s3.tf` — MODIFIED (+`aws_s3_bucket.access_logs` + `aws_s3_bucket_logging` ×3 — plan only, not applied)
- `velara-api/tests/integration/api/test_artifact_disclosure.py` — NEW (9 tests: AC1 ×6 sites, best-effort, Trap 3 de-dupe, AC5 accounting)
- `velara-api/tests/integration/api/test_jobs.py` — MODIFIED (TTL assertion updated 86400→900; +2 AC2 cancel-path tests)
- `velara-api/tests/unit/workers/test_execution_tasks.py` — MODIFIED (+6 unit tests for `_invocation_audit_metadata`)
- `velara-api/tests/unit/services/test_audit_service.py` — MODIFIED (category-expansion test updated for the new 3rd member)
- `velara-api/docs/api-spec.json` — MODIFIED (2 docstring-only lines; zero route/schema/field diff)

## Change Log

- 2026-07-15 — Story 13.3 implemented: all 9 tasks complete, all 6 ACs satisfied. `access.artifact_disclosed` disclosure events wired into all 6 presign sites with 15-min de-dupe; `file_ref_ids` added to invocation audit metadata at all 5 call sites; output-download presigned-URL TTL shortened 24h→15min; S3 access logging authored in Terraform (plan only, not applied — operator owes live plan+apply); 9 new integration tests + 8 new unit/integration tests for AC2; 2 pre-existing tests updated for the TTL/category-count changes this story makes. Zero migration. `docs/api-spec.json` diff is docstring-only (no contract change).
- 2026-07-16 — Code review (3-layer: Blind Hunter, Edge Case Hunter, Acceptance Auditor): 1 decision-needed, 2 patch, 3 deferred, 9 dismissed as noise/false-positive.

### Review Findings

- [x] [Review][Decision] `ARTIFACT_KIND_INGESTED_DOCUMENT` is a dead constant — resolved 2026-07-16: scoped AC1 down via an inline note (see AC1 above) documenting it as a reserved/forward-looking constant with no wired site today; no download route exists for ingested documents yet. Revisit when one is built.
- [x] [Review][Patch] `NameError` in new pip-install test — fixed 2026-07-16: removed the orphaned `assert proc.stderr.startswith(b"xxx")` line [tests/unit/services/test_code_driven_executor.py]. While verifying, found a second defect in the same test: `caplog` can never see this codebase's structlog output (`structlog.configure(logger_factory=PrintLoggerFactory())` in `app/core/logging.py` writes straight to stdout, never through stdlib `logging`) — rewrote the test to use `capsys` + ANSI-strip instead, matching how the log line actually renders. Also fixed a pre-existing `ruff` E501 in the same block. Verified: all 36 tests in the file pass.
- [x] [Review][Patch] De-dupe check is TOCTOU-racy — fixed 2026-07-16: added `pg_advisory_xact_lock` keyed on `hash((user_id, artifact_ref))` before the check-then-insert in `record_artifact_disclosure` [app/services/audit_service.py]. Transaction-scoped (auto-released on commit/rollback), no schema change needed, so it fits the story's "no migration" constraint. Verified: full disclosure integration suite (9 tests, incl. the 5-poll de-dupe test) + full unit (735) + integration (677) regression all pass.
- [x] [Review][Defer] De-dupe key omits `artifact_kind` [app/services/audit_service.py:426-441] — deferred, pre-existing pattern extended, not currently exploitable (no two artifact kinds share a ref format today)
- [x] [Review][Defer] Export route writes two audit events with different `user_id` — `EVENT_ADMIN_SKILL_EXPORTED` uses `skill.created_by_user_id` [app/services/skill_export.py:247], the disclosure event correctly uses the actual requester [app/api/v1/skills.py:211] — deferred, pre-existing bug in code this story didn't touch
- [x] [Review][Defer] No backfill/retroactive-coverage note for the app-level disclosure audit trail — S3 access logging (Task 6) explicitly covers URLs minted before this story shipped, but the `access.artifact_disclosed` application event obviously cannot retroactively record pre-deployment disclosures; this asymmetry isn't documented anywhere for a compliance reviewer — deferred, documentation gap only
