---
baseline_commit: 6038613d0b195e3ccc33b147bf00c852077041e2
---

# Story 11.1: Multi-File ZIP Bundle Upload & Extraction

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer,
I want to upload a skill as a true multi-file ZIP bundle,
so that a client-provided multi-file skill is stored and versioned as-is — closing the Phase-1 "manifest IS the artifact" deferral.

## Acceptance Criteria

1. **AC1 — Bundle stored as an immutable, content-addressed multi-file artifact set.**
   **Given** a ZIP upload whose contents include a code-driven hybrid manifest (`entrypoint`, `requirements`/lockfile, `output_schema` + `schema_version`)
   **When** I register a new skill (or a new version of an existing hybrid skill) from that bundle
   **Then** the bundle is extracted, **each file is stored via `StorageProvider`** under the skill bucket, and the `SkillVersion` records the **full artifact set** (every member file's relative path + per-file sha256 + a bundle-level checksum) — immutable and content-addressed; the skill's core files are stored **byte-for-byte** (a re-extract yields identical per-file checksums).

2. **AC2 — Missing required manifest field → 422 naming the field.**
   **Given** a bundle whose manifest is missing a required field (`entrypoint`, `output_schema`/`schema_version`, or `requirements`/lockfile), or that omits the manifest entirely
   **When** I attempt to register (or version) it
   **Then** registration is rejected **422** with a clear, specific error naming the missing field — reusing the existing `INVALID_CODE_DRIVEN_MANIFEST` error and the Story 5.5.1 load-bearing-schema discipline; nothing is left persisted (the extracted objects are cleaned up on failure).

3. **AC3 — Inline-string artifact path still works (additive, not a breaking swap).**
   **Given** the current inline-string artifact path (`SkillCreate.initial_content` / `SkillVersionCreate.content`)
   **When** a prompt/code skill — or an LLM-driven hybrid, or even a code-driven hybrid whose manifest is a single JSON string — is registered without a ZIP
   **Then** it still works exactly as today: single-object artifact, `text/plain`/`+json` content type, unchanged 201 response. ZIP upload is a **new, additive** ingress; it does not replace or alter the inline path.

4. **AC4 — Frontend: a minimal bundle-upload primitive wired to a new `createVersion` client.**
   **Given** the skill create/edit surface in velara-web
   **When** an MA Tech developer selects a `.zip` bundle
   **Then** a reusable `SkillBundleUpload` control uploads it via the presigned-PUT→confirm flow and a **new `createVersion` FE API client** posts the bundle reference — surfacing the 422 field-named error inline on failure. *(This story ships only the upload primitive + the `createVersion` client; the full draft-edit / version-authoring UX is **Story 11.6** and is out of scope here — see "Scope boundary vs Story 11.6" in Dev Notes.)*

## Tasks / Subtasks

> **Two locked decisions gate this story (resolved with the Project Lead at story creation — see Dev Notes "Locked decisions"):**
> **(D1) Upload mechanism = presigned-PUT + confirm**, NOT FastAPI multipart. The epic's AC1 wording "multipart ZIP upload" is illustrative; every existing upload in the codebase uses presigned-PUT direct-to-S3, and "file content travels by object key only" is a load-bearing invariant ([implementation-patterns-consistency-rules.md#Enforcement-Rules](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md) rule 6; [execution-engine-patterns.md#6](../../planning-artifacts/architecture/execution-engine-patterns.md)).
> **(D2) Scope = backend + a minimal FE upload primitive.** The full new-version authoring UX is Story 11.6.

- [ ] **Task 1 — ZIP extraction service (AC1, AC2) — NEW `app/services/bundle_extractor.py`**
  - [ ] `def extract_bundle(zip_bytes: bytes) -> list[tuple[str, bytes]]` — extract a ZIP into an ordered list of `(relative_path, file_bytes)`. There is **zero existing zip code in the repo** (verified `grep zipfile/ZipFile/extractall` → no hits in `app/`) — this is greenfield; use stdlib `zipfile.ZipFile(io.BytesIO(zip_bytes))`.
  - [ ] **Security hardening (do NOT skip — this is untrusted client-supplied input):**
    - **Zip-slip guard:** reject any member whose normalized path escapes the root (`..`, absolute paths, or a resolved path outside the extraction root). Mirror the path-escape guard already used for skill *output* artifacts in [code_driven_executor.py](../../../velara-api/app/services/code_driven_executor.py) (multi-artifact path-escape check).
    - **Zip-bomb guard:** cap total uncompressed size and per-file size. Reuse the existing decompression-bomb precedent — [ingest_tasks.py:39](../../../velara-api/app/workers/ingest_tasks.py#L39) `_MAX_EXTRACTED_CHARS = 50 * 1024 * 1024` raising `ParsedTooLargeError`. Add a bundle equivalent (config-driven; see Task 6). Reject symlinks and non-regular members.
    - Reject an empty archive and a non-ZIP payload (bad magic) with a clear 422.
  - [ ] `def find_manifest(files: list[tuple[str, bytes]]) -> bytes | None` — locate the manifest inside the bundle. Convention: a top-level `manifest.json` (or a single `*/manifest.json`). Return its raw bytes for validation; return None if absent (→ Task 3 raises the missing-`entrypoint` 422 via the existing detector, since an entrypoint-less/absent manifest routes to the code-driven parser per [code_driven_hybrid.py:139-159](../../../velara-api/app/services/code_driven_hybrid.py#L139)).
  - [ ] Raise a typed `InvalidBundleError` (new, `VelaraHTTPException` subclass, 422, stable code `INVALID_BUNDLE`) for structural failures (not-a-zip, zip-slip, oversize, empty). Manifest *field* errors keep flowing through the existing `INVALID_CODE_DRIVEN_MANIFEST` (Task 3) — do not collapse the two.

- [ ] **Task 2 — Bundle storage helper: store the extracted set content-addressed (AC1) — extend `app/services/skill_service.py`**
  - [ ] `async def _write_bundle(*, storage, skill_id, version, files: list[tuple[str, bytes]]) -> tuple[str, str, list[dict]]` returning `(bundle_prefix, bundle_checksum, artifact_set)`.
    - Per-file key: `skills/{skill_id}/{version}/{bundle_checksum}/{relative_path}` — extends the existing single-object convention `skills/{skill_id}/{version}/{sha256}` ([skill_service.py:295](../../../velara-api/app/services/skill_service.py#L295)) by adding the bundle-checksum directory + the member path. Store each member via `storage.put(key, bytes, content_type)` ([storage.py:125](../../../velara-api/app/integrations/storage.py#L125); content_type per member — infer or default `application/octet-stream`).
    - **`bundle_checksum`** = a deterministic hash over the sorted `(path, per_file_sha256)` pairs (so the whole bundle is content-addressed and reorder-stable). Each member's own sha256 is `hashlib.sha256(bytes).hexdigest()` (same `hashlib` already imported at [skill_service.py:14](../../../velara-api/app/services/skill_service.py#L14)).
    - **`artifact_set`** = `[{"path": ..., "sha256": ..., "size": ..., "content_type": ...}, ...]` — the machine record of what was stored, persisted on `SkillVersion` (Task 4).
  - [ ] **Orphan cleanup on failure:** if any `put` fails mid-loop, best-effort-delete the members already written before re-raising — extend the existing `_safe_delete` discipline ([skill_service.py:244-255](../../../velara-api/app/services/skill_service.py#L244)) to a `_safe_delete_prefix` (loop over the artifact_set keys). This mirrors the known single-object orphan pattern and the deferred multi-artifact-orphan note (deferred-work.md:230).

- [ ] **Task 3 — Validate the bundle's manifest at registration (AC2) — reuse existing seam, do NOT reinvent**
  - [ ] After extraction, run the located manifest bytes through the **existing** `is_code_driven_manifest` / `parse_code_driven_manifest` in [code_driven_hybrid.py](../../../velara-api/app/services/code_driven_hybrid.py) — this already raises `InvalidCodeDrivenManifestError` (422, `INVALID_CODE_DRIVEN_MANIFEST`) naming the missing field via `_REQUIRED_FIELDS = ("entrypoint", "requirements", "output_schema", "schema_version")` ([code_driven_hybrid.py:201-206](../../../velara-api/app/services/code_driven_hybrid.py#L201)). Do NOT write a second validator.
  - [ ] Populate `skill.schema_version` and `skill.egress` from the parsed manifest exactly as the inline path does today ([skill_service.py:350-352](../../../velara-api/app/services/skill_service.py#L350)).
  - [ ] **Preserve the `HybridShapeMismatchError` guard** ([skill_service.py:609-614](../../../velara-api/app/services/skill_service.py#L609)) on the version path: a `draft`/existing hybrid's shape (code-driven ↔ LLM-driven) may not switch across a new bundle version. A ZIP-versioned skill must already be (or become) code-driven; reject a cross-shape swap with the existing 422 `HYBRID_SHAPE_MISMATCH`.
  - [ ] **BOM note:** the existing detector decodes with plain `utf-8` (not `utf-8-sig`) — a BOM-prefixed manifest misroutes to the wrong error code (deferred-work.md:303). This story does NOT need to fix that, but if the ZIP path re-reads the manifest, decode consistently with the existing code so behavior matches (don't accidentally "fix" it here and diverge — that's a separate deferred item).

- [ ] **Task 4 — Persist the artifact set on `SkillVersion` — NEW migration `0022_skill_version_bundle.py`**
  - [ ] Add to `skill_versions`:
    - `artifact_set JSONB NULL` — the `[{path, sha256, size, content_type}]` record; NULL for single-object (inline-path) versions, so AC3's inline path is a clean no-op.
    - `is_bundle BOOLEAN NOT NULL DEFAULT false` — fast discriminator (a bundle version vs. the legacy single-object artifact).
  - [ ] Keep `artifact_key` meaning-compatible: for a bundle, set `artifact_key = {bundle_prefix}` (the directory prefix) and `artifact_checksum = {bundle_checksum}` — so existing readers that only touch those two columns don't break, and the executor can list-under-prefix. Do NOT drop or repurpose `artifact_key`/`artifact_checksum`.
  - [ ] Migration: revision `0022_skill_version_bundle`, `down_revision = "0021_file_ref_content_hash"` (latest is 0021). Follow the additive `op.add_column(..., server_default=...)` pattern of [0013_code_driven_hybrid.py](../../../velara-api/app/db/migrations/versions/0013_code_driven_hybrid.py); round-trip `downgrade` drops both columns.
  - [ ] Add `artifact_set` / `is_bundle` to `SkillVersion` model ([skill.py:165-208](../../../velara-api/app/models/skill.py#L165)) and — **read-side IP check** — do NOT expose `artifact_set` file *bytes* or S3 keys via `SkillVersionRead` (it already omits `artifact_key`/content, [schema/skill.py:141-156](../../../velara-api/app/schemas/skill.py#L141)). It is acceptable to expose the *manifest* of the set (paths + sizes + checksums, no bytes) if the FE needs to show "N files stored" — but never a key or file content. Confirm with the IP-protection docstring before adding any field to the Read schema.

- [ ] **Task 5 — Bundle upload + confirm endpoints (AC1, AC2) — extend `app/api/v1/skills.py`**
  - [ ] **Presign:** `POST /api/v1/skills/{skill_id}/bundle/presign` (versioning an existing skill) and a create-flow variant, OR a skill-less presign that mints a staging key — resolve the exact shape by mirroring the ingest presign/confirm split ([ingest.py:45-108](../../../velara-api/app/api/v1/ingest.py#L45), [ingest_service.py:175-353](../../../velara-api/app/services/ingest_service.py#L175)). Presign a PUT for `content_type = "application/zip"` to the **skill bucket** (`SkillStorage` DI, [dependencies.py:80](../../../velara-api/app/core/dependencies.py#L80)); return `{upload_url, staging_key}`.
  - [ ] **Confirm/extract:** `POST /api/v1/skills/{skill_id}/versions` gains a bundle mode — accept `{bundle_key}` (the staged ZIP key) as an **additive** alternative to the inline `content`. On confirm: `storage.get(staging_key)` → `extract_bundle` (Task 1) → `find_manifest` + validate (Task 3) → `_write_bundle` (Task 2) → insert immutable `SkillVersion` with `is_bundle=true` + `artifact_set` → best-effort-delete the staging ZIP. For **create**, the same bundle branch in `create_skill`.
  - [ ] Router stays `RejectClient`-gated (already router-level, [skills.py:35](../../../velara-api/app/api/v1/skills.py#L35)) — bundle registration is internal-only. Response envelope + error envelope per house rules (never bare objects).
  - [ ] **Do NOT** add a bundle field to the request in a way that breaks `SkillVersionCreate`'s existing inline contract — make `content` and `bundle_key` mutually-exclusive-optional (exactly one required), validated in the schema. Keep the change additive (AC3).

- [ ] **Task 6 — Config: bundle size limits (AC1, AC2)**
  - [ ] Add to [config.py](../../../velara-api/app/core/config.py) (mirror the `Field(default=..., gt=0)` convention used by `EXECUTION_MAX_OUTPUT_BYTES` et al.): `SKILL_BUNDLE_MAX_TOTAL_BYTES` (uncompressed cap), `SKILL_BUNDLE_MAX_FILE_BYTES` (per-member cap), `SKILL_BUNDLE_MAX_FILES` (member count cap). Note: current upload size limit (100 MB) is a **hardcoded module constant** in [ingest_service.py:59](../../../velara-api/app/services/ingest_service.py#L59), NOT config — but for a new, security-sensitive extraction path, config-driven caps are the right call (they're the zip-bomb defense).
  - [ ] The extraction service (Task 1) reads these and raises `INVALID_BUNDLE` 422 on breach.

- [ ] **Task 7 — Frontend: `SkillBundleUpload` control + `createVersion` client (AC4) — velara-web**
  - [ ] **New `createVersion` API client** in [src/api/skills.ts](../../../velara-web/src/api/skills.ts) — confirmed to NOT exist today (grep). Signature `createVersion(skillId, { bundle_key } | { content, content_type }, version?)` → `POST /api/v1/skills/{id}/versions`, returns `SkillWithVersion`. Add matching `useCreateSkillVersion` hook in [src/features/skills/hooks/useSkills.ts](../../../velara-web/src/features/skills/hooks/useSkills.ts) following the `useCreateSkill` pattern (invalidate `['skills', skillId]`, `['skills']`, `['skills-page']`).
  - [ ] **New `SkillBundleUpload.tsx`** under [src/features/skills/components/](../../../velara-web/src/features/skills/components/). Reuse the presign→PUT→confirm→poll primitives in [src/api/ingest.ts](../../../velara-web/src/api/ingest.ts) / [useIngest.ts](../../../velara-web/src/features/run/hooks/useIngest.ts) **parameterized by `basePath`** — do NOT import `DocumentUploadCard` across features (it's single-file and lives under `features/run`); a skills-owned control that accepts a `.zip` (single file, `accept=".zip"`) is cleaner. Surface the inline 422 field-named error on failure.
  - [ ] **Icon:** no `zip`/`archive` glyph exists. Per the hard house rule, add ONE entry (e.g. `archive`) to the `ICONS` map in [Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx) and render `<Icon name="archive" />` — never an emoji, never an inline `<svg>` at the call site (`DocumentUploadCard`'s inline-svg is a pre-existing house-rule violation; do not copy it).
  - [ ] **Wire-in point (minimal):** expose the control in the create flow's hybrid path only. Do NOT build the full draft-edit content editor or the metadata/version-authoring UX — that is Story 11.6. Keep this to: pick a `.zip` → upload → get a `bundle_key` → submit via `createVersion`/`createSkill`.

- [ ] **Task 8 — Error code registration (AC2)**
  - [ ] Register `InvalidBundleError` (code `INVALID_BUNDLE`, 422) as a `VelaraHTTPException` subclass so the global handler auto-renders the error envelope — mirror `InvalidCodeDrivenManifestError` ([code_driven_hybrid.py:45-51](../../../velara-api/app/services/code_driven_hybrid.py#L45)). If the `_map_error_code` table in [execution_tasks.py](../../../velara-api/app/workers/execution_tasks.py) is where registration-path codes are catalogued, add `ERROR_CODE_INVALID_BUNDLE` there too (follow how `ERROR_CODE_INVALID_CODE_DRIVEN_MANIFEST` was added in 5.5.1). Stable, SCREAMING_SNAKE_CASE, permanent — never rename.

- [ ] **Task 9 — Tests (AC: all)**
  - [ ] **Unit `tests/unit/services/test_bundle_extractor.py` (NEW)** — pure Python, no DB/S3: valid multi-file zip → ordered `(path, bytes)`; zip-slip member (`../evil`, absolute path) rejected `INVALID_BUNDLE`; oversize total / oversize member / too-many-files rejected; symlink/non-regular member rejected; empty archive rejected; non-zip bytes rejected; `find_manifest` locates top-level `manifest.json`, returns None when absent; per-file + bundle checksums are deterministic and reorder-stable.
  - [ ] **Integration `tests/integration/api/test_skills.py` (ADD)** — Docker (PG + MinIO `velara-skills` bucket), auto-skip guard already present ([test_skills.py:65](../../../velara-api/tests/integration/api/test_skills.py#L65)); reuse `_auth_headers("ma_tech")` and the `_CODE_DRIVEN_MANIFEST` fixture ([test_skills.py:1622](../../../velara-api/tests/integration/api/test_skills.py#L1622)):
    - Register a code-driven hybrid from a real multi-file ZIP → 201; `is_bundle=true`; `artifact_set` records every member; each member is retrievable from storage byte-for-byte; `schema_version`/`egress` populated (AC1).
    - Bundle missing `entrypoint` (or manifest absent) → 422 `INVALID_CODE_DRIVEN_MANIFEST` naming `entrypoint`; nothing persisted (AC2). Missing `output_schema`/`requirements` likewise.
    - Zip-slip / oversize bundle → 422 `INVALID_BUNDLE`; nothing persisted.
    - Inline path unchanged: existing `test_create_skill_returns_201_and_draft` and `test_create_version_increments_and_preserves` still pass untouched; add an explicit AC3 test asserting an inline create yields `is_bundle=false`, `artifact_set IS NULL` (AC3).
    - New bundle **version** of an existing hybrid → 201, auto-bump, immutable prior version intact; cross-shape ZIP version rejected `HYBRID_SHAPE_MISMATCH`.
  - [ ] **Frontend** `SkillBundleUpload.test.tsx` (NEW) + `skills.test.ts` (extend) + `useSkills.test.tsx` (extend): mock `useIngest`/`api/ingest` (drive by phase, `it.each` per the [DocumentUploadCard.test.tsx](../../../velara-web/src/features/run/components/DocumentUploadCard.test.tsx) template) and `createVersion` (`vi.mock('@/api/skills')`); assert the control uploads a `.zip`, calls `createVersion` with `{bundle_key}`, and renders the field-named 422 inline.

- [ ] **Task 10 — Gates**
  - [ ] **Backend:** `ruff check .` clean; run the full suite (note: 3 pre-existing `test_ingest.py` MinIO-in-container failures are unrelated/expected per project history — don't chase them); apply migration 0022 and confirm round-trip (downgrade→upgrade) clean; `python scripts/export_openapi.py` → regenerate `docs/api-spec.json` (additive: new bundle endpoints + `artifact_set`/`is_bundle` on the read schema if exposed) and commit the diff.
  - [ ] **Frontend:** `npm run typecheck` → 0 errors; `npm run lint` (1 pre-existing `Icon.tsx` warning is baseline); `npx vitest run` green (record new baseline count).

## Dev Notes

### Locked decisions (resolved with Project Lead at story creation — do not re-litigate)

- **D1 — Upload mechanism = presigned-PUT + confirm, NOT FastAPI multipart.** The epic AC1's "multipart ZIP upload" is illustrative wording. There is **no FastAPI `UploadFile`/multipart ingress anywhere in the codebase** (verified) — every upload is presign→PUT-direct-to-S3→confirm ([ingest.py](../../../velara-api/app/api/v1/ingest.py), [useIngest.ts](../../../velara-web/src/features/run/hooks/useIngest.ts)). Routing large bundle bytes through the API process would cut against the load-bearing "file content travels by object key only" invariant ([implementation-patterns-consistency-rules.md](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md) rule 6; [execution-engine-patterns.md#6](../../planning-artifacts/architecture/execution-engine-patterns.md)). Presign the `.zip` to the skill bucket, then extract server-side in the confirm handler.
- **D2 — Scope = backend + a minimal FE upload primitive** (the `SkillBundleUpload` control + the `createVersion` client). The **full** new-version authoring UX — draft-mutable content editor, version-on-publish, the `SkillEdit` content surface — is **Story 11.6** and is explicitly out of scope here (see below).

### What "closes the Phase-1 'manifest IS the artifact' deferral" actually means (VERIFIED, read in full)

Today a code-driven "bundle" is a **single JSON object** — the manifest itself — stored as the skill's one artifact. Verified end-to-end:
- **Register:** `create_skill` writes `initial_content.encode()` (the manifest JSON string, `_MAX_CONTENT_LEN = 1 MiB`, [schema/skill.py:33,187](../../../velara-api/app/schemas/skill.py#L187)) to a single key `skills/{skill_id}/{version}/{sha256}` ([skill_service.py:293-300](../../../velara-api/app/services/skill_service.py#L293)). Same for `create_version` ([skill_service.py:593-597](../../../velara-api/app/services/skill_service.py#L593)).
- **Execute:** `_run_hybrid` does `skill_storage.get(current_ver.artifact_key)` → `parse_code_driven_manifest(artifact_bytes)` ([execution_service.py:698-709](../../../velara-api/app/services/execution_service.py#L698)), then hands the parsed manifest to the executor.
- **Extract:** the executor's Step 2 is a literal **no-op** — `bundle_dir = workspace` ([code_driven_executor.py:198-205](../../../velara-api/app/services/code_driven_executor.py#L198)); the skill package is expected to be pip-installable from the manifest's `requirements` lockfile (local path). There is **no multi-file skill bundle stored anywhere** (deferred-work.md:206).

This story stores the **real multi-file bundle** as the immutable, content-addressed artifact set. **Scope line:** 11.1 is the *storage/registration* half. The executor consuming the extracted bundle (replacing the Step-2 no-op with real extraction into `bundle_dir` + pip-installing from the bundle) is a downstream consumer — **NOT in this story**. Leave `code_driven_executor.py` Step 2 as-is; note it as the natural next consumer (the standardized entrypoint contract is Story 11.2). Do not widen scope into the runner (there's also a known `params`-kwarg contract mismatch vs. the real extractor, deferred-work.md:214 — not this story's problem).

### Scope boundary vs Story 11.6 (STRICT — prevents double-building)

| Concern | This story (11.1) | Story 11.6 |
|---|---|---|
| ZIP extract + per-file storage + artifact-set model + migration | ✅ | — |
| Bundle presign/confirm endpoints + 422 validation | ✅ | — |
| `createVersion` FE API client + `useCreateSkillVersion` hook | ✅ (create it) | reuses it |
| `SkillBundleUpload` upload primitive (pick `.zip` → upload → `bundle_key`) | ✅ | reuses it |
| Draft-mutable in-place content edit path (`update_draft_content`) | ❌ | ✅ |
| `SkillEdit` content editor / version-on-publish UX | ❌ | ✅ |
| Prompt/code in-UI content editor | ❌ | ✅ |

If you find yourself editing `SkillEdit.tsx`'s metadata-PATCH flow or building a content editor, you've crossed into 11.6 — stop.

### The artifact/storage model — VERIFIED facts to build on

- **`SkillVersion` holds the pointer, never bytes:** `artifact_key String(1024)`, `artifact_checksum String(64)` (sha256 hex), `content_type String(128)` ([skill.py:181-184](../../../velara-api/app/models/skill.py#L181)). No inline `content`/`code`/`prompt` column, no `manifest`/`entrypoint`/`lockfile` column — manifest fields live *inside* the artifact bytes for hybrids. Module docstring: "artifact content lives in object storage (S3-key-reference); only metadata and storage keys are persisted."
- **Immutability is service-layer convention, not a DB trigger** ([skill_service.py:5](../../../velara-api/app/services/skill_service.py#L5); core-architectural-decisions.md#Draft-Mutable-Versioning confirms "no DB trigger on `skill_versions`" as of 2026-07-06). `create_version` only INSERTs + re-points `current_version_id`; never UPDATEs a version row. Your bundle version follows the same discipline — a new immutable row, auto-bump `_bump_minor` ([skill_service.py:220](../../../velara-api/app/services/skill_service.py#L220)).
- **Content-addressing convention:** the last key segment is the content hash (`skills/{skill_id}/{version}/{sha256}`). Extend, don't replace: bundle = `skills/{skill_id}/{version}/{bundle_checksum}/{member_path}`. `FileReference.content_sha256` ([file_ref.py:78](../../../velara-api/app/models/file_ref.py#L78), migration 0021) is the parallel precedent for a stored content hash.
- **`StorageProvider` (Protocol, [storage.py:24](../../../velara-api/app/integrations/storage.py#L24)):** `put(key, data, content_type)`, `get(key)`, `presign_upload(key, content_type, expires_s)`, `presign_download`, `head`, `get_range`, `delete`, `check_ready`. Skill bucket via `get_skill_storage()` / `SkillStorage` DI. Callers type against the Protocol, never the concrete `S3StorageProvider` — same discipline as every other seam.

### Reuse map — do NOT reinvent

| Need | Reuse (don't rebuild) |
|---|---|
| Manifest field validation + 422 naming the field | `is_code_driven_manifest` / `parse_code_driven_manifest` / `_REQUIRED_FIELDS` ([code_driven_hybrid.py:139-206](../../../velara-api/app/services/code_driven_hybrid.py#L139)) |
| Manifest error code | `INVALID_CODE_DRIVEN_MANIFEST` (existing) — only add `INVALID_BUNDLE` for *structural* zip errors |
| Cross-shape version guard | `HybridShapeMismatchError` / `HYBRID_SHAPE_MISMATCH` ([skill_service.py:609-614](../../../velara-api/app/services/skill_service.py#L609)) |
| S3 orphan cleanup on failure | `_safe_delete` ([skill_service.py:244-255](../../../velara-api/app/services/skill_service.py#L244)) → extend to a prefix-delete |
| Semver | `_SEMVER_RE`/`_parse_semver`/`_bump_minor` ([skill_service.py:202-225](../../../velara-api/app/services/skill_service.py#L202)) — do NOT define a second regex |
| Presign→PUT→confirm HTTP flow | `ingest_service.create_file_ref`/`confirm_file_ref` shape ([ingest_service.py:175-353](../../../velara-api/app/services/ingest_service.py#L175)); FE `api/ingest.ts` + `useIngest.ts` (`basePath`-parameterized) |
| Zip-bomb precedent | `_MAX_EXTRACTED_CHARS` / `ParsedTooLargeError` ([ingest_tasks.py:39](../../../velara-api/app/workers/ingest_tasks.py#L39)) |
| Path-escape guard precedent | multi-artifact path-escape check in [code_driven_executor.py](../../../velara-api/app/services/code_driven_executor.py) |
| FE upload-control test pattern | `DocumentUploadCard.test.tsx` (mock `useIngest`, `it.each` by phase) |

### Security — this is untrusted, client-supplied input

The ZIP comes from a client-provided skill. Treat extraction adversarially:
- **Zip-slip** (path traversal via `../` or absolute member paths) is the classic CVE class — the extraction service MUST reject any member resolving outside the root. Non-negotiable, unit-tested.
- **Zip-bomb** (huge uncompressed expansion) — cap total + per-file + file-count (config, Task 6). The document parser already guards this class ([ingest_tasks.py:39](../../../velara-api/app/workers/ingest_tasks.py#L39)).
- **Symlinks / special members** — reject; store only regular files.
- **`_ZIP_MAGIC = b"PK\x03\x04"` collides with DOCX/XLSX** (which are ZIP containers, [ingest_service.py:57](../../../velara-api/app/services/ingest_service.py#L57)) — irrelevant here (skill bucket, not ingest), but don't reuse the ingest MIME allow-list; a skill bundle is `application/zip`, validated by presence-of-manifest, not by document MIME sniffing.

### PHI / IP discipline (house invariant)

- **Never store file content inline in the DB** — S3 key + metadata only ([implementation-patterns-consistency-rules.md](../../planning-artifacts/architecture/implementation-patterns-consistency-rules.md) rule 6). The `artifact_set` JSONB holds paths/hashes/sizes — never bytes.
- **Read schemas never expose keys or bytes** — `SkillVersionRead` deliberately omits `artifact_key`/content ([schema/skill.py:141](../../../velara-api/app/schemas/skill.py#L141)). If the FE shows "N files stored," expose only the path/size/checksum manifest, never a key or content.
- **Logging:** log member count + bundle checksum; never log member bytes, never log full `requirements` (log package count, per the 5.5.1 discipline).
- A skill bundle is **IP (Vitalief methodology), not PHI** — but the file-by-key + no-inline-bytes rules apply identically.

### Frontend — VERIFIED current state

- **Artifact entry today is a single plain `<textarea>` (`initial_content`)** shown only in create mode ([SkillForm.tsx:431-451](../../../velara-web/src/features/skills/components/SkillForm.tsx)); no code editor, no upload, no branching by `runtime_type`. Edit mode only PATCHes metadata (`buildPatchBody`, [SkillEdit.tsx:106-156](../../../velara-web/src/features/skills/components/SkillEdit.tsx)).
- **No `createVersion` FE client or `/versions` reference exists** (grep-confirmed) — you are adding the first one. Types in [src/features/skills/types.ts](../../../velara-web/src/features/skills/types.ts) (`SkillCreateInput`, `SkillWithVersion`, `SkillVersionSummary`).
- **`useIngest`/`api/ingest.ts`** are `basePath`-parameterized (presign→PUT→confirm→poll every 3s, 40 attempts). `DocumentUploadCard` is single-file, lives under `features/run`, and inlines raw `<svg>` (house-rule violation — do NOT copy). Build a skills-owned `SkillBundleUpload` instead.
- **Icons:** `Icon.tsx` house rule — never emoji, never inline svg at call sites; add an `archive` entry to the `ICONS` map. Closest existing glyphs: `layers`, `file`, `upload`. [Source: project memory — No Emoji Icons]

### Testing standards

- **Backend:** unit tests for the pure extraction/checksum logic (no Docker); integration tests in `tests/integration/api/test_skills.py` (Docker PG + MinIO `velara-skills` bucket, auto-skip guard [test_skills.py:65](../../../velara-api/tests/integration/api/test_skills.py#L65)). Reuse `_auth_headers("ma_tech")` and `_CODE_DRIVEN_MANIFEST`. The 3 pre-existing `test_ingest.py` MinIO-in-container failures are unrelated — CI runs pytest on the runner where `localhost ≠ minio-in-container` (project memory: Pre-existing CI Failures). Rebuild the api image before running dockerized pytest — it bakes source (project memory: Epic 8 Story 8.4 review).
- **Frontend:** Vitest + Testing Library, jsdom, co-located `*.test.tsx`. Mock `useIngest`/`api/ingest` and `createVersion`. Follow `SkillCreate.test.tsx` (`vi.mock('@/api/skills')`, `QueryClientProvider`+`MemoryRouter`) and `DocumentUploadCard.test.tsx` (mock the hook, `it.each` by phase).
- Call out in Completion Notes any edge case deliberately left uncovered (e.g. nested-directory manifest location, mixed inline+bundle in one request) rather than silently gapping it.

### Project Structure Notes

- **Backend (velara-api):** NEW `app/services/bundle_extractor.py`; NEW `app/db/migrations/versions/0022_skill_version_bundle.py`; MODIFY `app/services/skill_service.py` (bundle write helper + create/version bundle branch), `app/models/skill.py` (`artifact_set`, `is_bundle`), `app/schemas/skill.py` (`SkillVersionCreate` bundle field + read-schema manifest exposure decision), `app/api/v1/skills.py` (presign + confirm endpoints), `app/core/config.py` (bundle caps), `app/core/exceptions.py`/`app/workers/execution_tasks.py` (`INVALID_BUNDLE`), `docs/api-spec.json` (regenerated); tests.
- **Frontend (velara-web):** NEW `src/features/skills/components/SkillBundleUpload.tsx` (+ test); MODIFY `src/api/skills.ts` (`createVersion`), `src/features/skills/hooks/useSkills.ts` (`useCreateSkillVersion`), `src/shared/components/Icon.tsx` (`archive`), the create flow's hybrid path (minimal wire-in); tests.
- **Two nested repos:** `velara-api` and `velara-web` are **separate git repos** nested under the top-level `velara` (which holds `_bmad-output` docs). Both working trees are **clean and committed** as of this story's creation (12.4 landed in both: `velara-api` `6038613`, `velara-web` `70de32d`). Commit this story's backend and frontend as **two separate commits** in their respective repos, per the `feat(<area>): Story <id> — <short title> (Epic <n>)` convention. Do NOT `git add` the top-level docs repo from inside a nested repo. [Source: project memory — Story 12.1 Review / velara-web is a separate nested git repo]

### Previous Story Intelligence

- **Story 5.5.1 (direct predecessor — the manifest-registration path this extends):** built `code_driven_hybrid.py` (parser + detection + `INVALID_CODE_DRIVEN_MANIFEST`), the `create_skill`/`create_version` hybrid validation hooks (after S3 write, `_safe_delete` on failure), migration 0013 (`schema_version`/`egress`), and the `HybridShapeMismatchError` cross-shape guard. Its review lessons that apply here: (1) **manifest detection strengthened** so an entrypoint-less/absent manifest still routes to the code-driven parser and gets the targeted "missing entrypoint" 422 — your `find_manifest`-returns-None case relies on this. (2) **IP leak:** 422 messages must be built from field location + error type, never echo artifact bytes or field *values* — apply the same to `INVALID_BUNDLE` messages (name the offending path, never dump member bytes). (3) **Narrow `except` to domain exceptions** before `_safe_delete` — infra errors must NOT delete the artifact. (4) `_safe_delete` orphan cleanup is the established failure discipline.
- **Story 12.4 (most recent):** added `FileReference.content_sha256` (migration 0021) — the content-hash-at-ingest precedent and the reason latest migration is 0021. Gates baseline to regress against: FE vitest 553/553, eslint 1 pre-existing `Icon.tsx` warning; BE ruff clean, 3 pre-existing `test_ingest.py` MinIO failures.

### Git Intelligence Summary

Recent commits confirm the `feat(<area>): Story <id> — <short title> (Epic <n>)` convention on both repos (`velara-api` `6038613` "Story 12.4 — duplicate-run cost warning (Epic 12)"; `velara-web` `70de32d` "Story 12.4 — duplicate-run advisory banner"). This story lands as two commits, e.g. `feat(skills): Story 11.1 — multi-file ZIP bundle upload & extraction (Epic 11)` in velara-api and `feat(skills): Story 11.1 — bundle upload control + createVersion client (Epic 11)` in velara-web.

### Sequencing / dependencies

- **FIRST story of Epic 11.** Epic 11 is `backlog` → this story flips it to `in-progress`. Recommended epic order: **11.1 → 11.2 → 11.6 → 11.3 → 11.4 → 11.7 → 11.5** ([epic-11…md#Story-Sequencing](../../planning-artifacts/epics/epic-11-ai-assisted-skill-integration-and-promotion.md)).
- **Architecture-gated epic, but 11.1 is NOT gated on the three ADRs** — those cover 11.2/11.3 (AI-integration seam), 11.4/11.5 (promotion/portability), and 11.6 (draft-mutable versioning). 11.1's storage semantics ARE, however, described authoritatively in the **Draft-Mutable Versioning ADR** (core-architectural-decisions.md, added 2026-07-06): content-addressed keys, S3 object immutability preserved even as a draft version row re-points its pointer, `HybridShapeMismatchError` shape-lock. Read that block before designing the storage layout.
- **Downstream consumers of what 11.1 builds:** 11.6 reuses the `createVersion` client + `SkillBundleUpload`; 11.3 (AI assistant) inspects/repackages the multi-file bundle; 11.4 (export) serializes the bundle. Design the `artifact_set` record so those can enumerate members without re-extracting.

### References

- [Source: epics/epic-11-ai-assisted-skill-integration-and-promotion.md#Story-11.1] — story, ACs, "closes the manifest-IS-the-artifact deferral" framing, epic sequencing, the three ADRs (and which stories they gate).
- [Source: planning-artifacts/sprint-change-proposal-2026-07-06.md] — R4 gap definition (manifest-as-artifact, `initial_content` ≤ 1 MiB, `code_driven_executor.py:198-205` Phase-1 no-op); "ZIP bundle upload — new multipart endpoint + extraction + per-file StorageProvider storage; evolves the manifest-as-artifact model. Migration likely (artifact-key set vs single key). Medium–Large."
- [Source: planning-artifacts/architecture/core-architectural-decisions.md#Draft-Mutable-Versioning] — content-addressed storage, S3 object immutability, `skills/{skill_id}/{version}/{checksum}` key, shape-lock; the hybrid new-version-via-ZIP rule.
- [Source: planning-artifacts/architecture/implementation-patterns-consistency-rules.md] — response/error envelopes, snake_case, migration naming, "never store file content inline in the DB" (rule 6), co-located tests.
- [Source: planning-artifacts/architecture/execution-engine-patterns.md#6] — file-by-key / IP discipline (skill artifact bytes fetched-used-discarded, never stored inline).
- [Source: _bmad-output/implementation-artifacts/stories/5.5-1-register-code-driven-hybrid-bundle-manifest.md] — full predecessor story: manifest parser, validation hooks, migration 0013, review findings (IP-leak, narrow-except, detection-strengthening lessons).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:206,214,230,303] — the zip-extraction deferral, the runner `params`-kwarg mismatch, the multi-artifact orphan-GC gap, the BOM decode note.
- [Source: velara-api app/services/skill_service.py:244-706] — `_safe_delete`, `create_skill` (261-391), `create_version` (558-706), semver helpers, sha256 key formation, `HybridShapeMismatchError`.
- [Source: velara-api app/services/code_driven_hybrid.py:27-228] — `CodeDrivenHybridManifest`, `is_code_driven_manifest`, `parse_code_driven_manifest`, `_REQUIRED_FIELDS`, `INVALID_CODE_DRIVEN_MANIFEST`.
- [Source: velara-api app/services/code_driven_executor.py:135-205] — runner script/entrypoint contract, Step-2 no-op `bundle_dir = workspace` (the deferral this story closes; executor consumption is OUT of scope).
- [Source: velara-api app/services/execution_service.py:692-719] — how the artifact is fetched + parsed at run time (`skill_storage.get(artifact_key)` → `parse_code_driven_manifest`).
- [Source: velara-api app/models/skill.py:165-208] — `SkillVersion` columns (`artifact_key`/`artifact_checksum`/`content_type`); [app/models/skill.py:35-162] — `Skill` (`schema_version`/`egress`, no artifact column).
- [Source: velara-api app/integrations/storage.py:24-222] — `StorageProvider` Protocol, `S3StorageProvider`, `get_skill_storage()`; [app/core/dependencies.py:80] — `SkillStorage` DI.
- [Source: velara-api app/services/ingest_service.py:175-353] — presign/confirm reference flow, `_build_ingest_key`, `content_sha256` at confirm; [app/workers/ingest_tasks.py:39] — zip-bomb `_MAX_EXTRACTED_CHARS` precedent.
- [Source: velara-api app/api/v1/skills.py:35,48-235] — router `RejectClient`, `create_skill`, `create_version` endpoints; [app/schemas/skill.py:33,128-254] — `SkillCreate.initial_content`, `SkillVersionCreate.content`, `SkillVersionRead` (omits key/content).
- [Source: velara-api app/db/migrations/versions/0021_file_ref_content_hash.py] — latest migration (0022 is next); [0013_code_driven_hybrid.py] — additive-column migration pattern.
- [Source: velara-web src/api/skills.ts] — no `createVersion` today (add it); [src/features/skills/types.ts] — `SkillCreateInput`/`SkillWithVersion`.
- [Source: velara-web src/api/ingest.ts + src/features/run/hooks/useIngest.ts] — `basePath`-parameterized presign→PUT→confirm→poll to reuse; [src/features/run/components/DocumentUploadCard.tsx] — single-file, inline-svg (do NOT copy); [src/features/skills/components/SkillForm.tsx:431-451] + [SkillEdit.tsx:106-156] — current artifact-textarea / metadata-only-edit reality.
- [Source: velara-web src/shared/components/Icon.tsx] — `ICONS` map, house rule (add `archive`).
- [Source: project memory — No Emoji Icons; velara-web is a separate nested git repo; Pre-existing CI Failures Fixed; Epic 8 Story 8.4 review (rebuild api image before pytest)].

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
