---
baseline_commit: 5a3d0a8 (velara-api) / 928e3c8 (velara-web)
---

# Story 11.6: Author New Skill Versions From the UI (Draft-Edit + Version-on-Publish)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer,
I want to create new versions of a skill from the UI — edit content in place for a `draft` skill, upload a new ZIP for a `draft` hybrid — and have publishing mint an immutable version,
so that I can iterate on a skill without hand-calling the API, while the immutability guarantee still holds outside `draft`.

## Acceptance Criteria

1. **AC1 — In-place content edit of a `draft` prompt/code skill (new mutable-draft backend path).**
   **Given** a `draft` prompt/code skill (inline-string artifact)
   **When** I open its edit view, the current content **pre-fills** the editor (via a new internal-only **draft content-read endpoint**), and I edit and save
   **Then** the **current draft version's content is updated in place** — the same version string, a **new** content-addressed S3 key, the version row's `artifact_key`/`artifact_checksum` re-pointed, **no version bump, no new row**. This is served by a **new** `update_draft_content` service function + a **draft-gated** content-update route + a **draft-gated content-read route** (none exist today). On the FE, the `SkillEdit` surface gains a content editor and `readDraftContent` + `updateDraftContent` API clients + hooks (none exist today — `SkillEdit` PATCHes metadata only, and the `initial_content` textarea is create-only).

2. **AC2 — In-place ZIP replace of a `draft` hybrid skill.**
   **Given** a `draft` hybrid (code-driven) skill
   **When** I upload a new ZIP bundle (reusing the Story 11.1 `SkillBundleUpload` control + presign→PUT→confirm flow)
   **Then** the new bundle **replaces the draft's artifact in place** (same version string, re-pointed `artifact_key`/`artifact_checksum`, `artifact_set`, `is_bundle=true`; old bundle members best-effort-deleted) and is marked the current draft content. The `HybridShapeMismatchError` shape-lock (code-driven ↔ LLM-driven) **applies within draft** — a draft edit may not change the manifest shape.

3. **AC3 — Publishing a draft mints an immutable version (existing path, no re-plumbing).**
   **Given** a `draft` skill whose content I have iterated on in place
   **When** I publish it (advance its lifecycle out of `draft` via the existing `transition_lifecycle` — no new "publish" verb)
   **Then** the current version becomes immutable at the freeze point; **subsequent** content changes on a non-`draft` skill mint a **new** immutable version through the existing `create_version` path (auto-bump). Per the existing rules already implemented in `create_version`, publishing a **new version** on a `client_ready` skill resets it to `draft` and flags derived children `review_required` — **unchanged, do not re-implement.**

4. **AC4 — Immutability holds outside `draft` (the invariant is enforced as code, not prose).**
   **Given** a certified or published (non-`draft`) version
   **When** anyone attempts the in-place content-update path against it
   **Then** it is rejected **409 `SKILL_NOT_DRAFT`** (new typed `SkillNotDraftError`) — draft-mutability never applies to a non-draft version; the strict immutability invariant holds everywhere except `draft`. `create_version` (immutable, auto-bump) remains the ONLY way to change a non-draft skill's content.

5. **AC5 — Frontend authoring UX wires the two mechanisms without inventing a third.**
   **Given** the skill edit surface in velara-web
   **When** an MA Tech developer opens a **`draft`** skill's edit view
   **Then** they can edit content (prompt/code textarea, or hybrid ZIP re-upload) and save → `updateDraftContent`; a **non-`draft`** skill's edit view surfaces content authoring as a **"Create new version"** action wired to the **existing** `createVersion` client / `useCreateSkillVersion` hook (which has no production caller today). The existing lifecycle "Advance to …" button in `SkillDetail` **is** the publish action — do not duplicate it.

## Tasks / Subtasks

> **Three ADR-locked decisions gate this story (see [core-architectural-decisions.md#Draft-Mutable-Versioning](../../planning-artifacts/architecture/core-architectural-decisions.md) — Winston, added 2026-07-06, authored specifically for 11.6). Do not re-litigate:**
> **(L1) Draft edits mutate the current version IN PLACE — no version bump.** The rejected alternative (mint a fresh immutable version on every draft save) pollutes version history with throwaway `0.x` versions, inflates S3, and makes the *meaningful* (published/run) version list unreadable. Draft is the "not yet real" state; its churn leaves no permanent artifacts. Immutability begins the instant a version becomes **referenceable** (certified / run / promoted / consumed) — none of which can touch a `draft`.
> **(L2) The exception is ENFORCED, not documented.** `update_draft_content` asserts `skill.lifecycle_state == "draft"` AND `skill.current_version_id is not None`, raising `SkillNotDraftError` (409) otherwise. The assertion is the executable form of the "no UPDATE outside draft" invariant.
> **(L3) NO migration, NO DB trigger.** The mutation is a pointer re-write on an existing `skill_versions` row. Immutability stays a **service-layer** convention (a skill artifact is an engineering artifact, not a Part-11 regulated record like `audit_log_entries`/certifications, which DO get DB triggers). Storage stays content-addressed: an in-place edit writes a **new** `…/{new_checksum}` key and re-points the row, then best-effort-deletes the orphaned prior draft object — we never overwrite an S3 key in place.

### Backend (velara-api)

- [x] **Task 1 — `SkillNotDraftError` (AC1, AC2, AC4) — `app/services/skill_service.py`**
  - [x] Add a new `SkillNotDraftError(VelaraHTTPException)` alongside the existing error classes (near [skill_service.py:126-200](../../../velara-api/app/services/skill_service.py#L126)), `status_code=409`, stable `ERROR_CODE = "SKILL_NOT_DRAFT"`. Mirror the shape of `SkillRetiredError` / `NoFieldsToUpdateError`. Message: draft-only editing / use create-version for a published skill — never echo artifact bytes (IP discipline, 5.5.1 lesson).
  - [x] Register `ERROR_CODE_SKILL_NOT_DRAFT = "SKILL_NOT_DRAFT"` in the constants block of [execution_tasks.py:38-86](../../../velara-api/app/workers/execution_tasks.py#L38), following how `ERROR_CODE_INVALID_BUNDLE` / `ERROR_CODE_ENTRYPOINT_CONTRACT_VIOLATION` were added as **catalogued stable strings only** — do NOT add it to the `_map_error_code` isinstance chain (it's a request-time `VelaraHTTPException` handled by the API exception handler, exactly like `SKILL_RETIRED` / `INVALID_LIFECYCLE_TRANSITION`, which are also absent from that chain). Stable, SCREAMING_SNAKE_CASE, permanent.

- [x] **Task 2 — `update_draft_content` service function (AC1, AC2, AC4) — `app/services/skill_service.py`**
  - [x] `async def update_draft_content(*, session, storage, skill_id, org_id, content: str | None = None, content_type: str = "text/plain", bundle_zip: bytes | None = None, updated_by_user_id: str) -> SkillVersion` — mirror `create_version`'s **exactly-one artifact mode** (inline `content` XOR `bundle_zip`) but **update the current version row in place instead of inserting a new one.**
  - [x] **Lock + gate first (before any S3 write):**
    - `skill = await get_skill(..., for_update=True)` — row-lock, exactly as `create_version`/`transition_lifecycle` do, so a concurrent publish/version-create serializes.
    - Assert `skill.lifecycle_state == "draft"` AND `skill.current_version_id is not None` → else raise `SkillNotDraftError`. (A retired skill is non-draft, so it's covered — but keep the `SkillRetiredError` check if you want the more specific message; retired is terminal.)
    - Load the current version row (`select(SkillVersion).where(id == skill.current_version_id)`), as `create_version` does at [skill_service.py:989-991](../../../velara-api/app/services/skill_service.py#L989).
  - [x] **Bundle branch (AC2):** reuse the EXACT `create_version` bundle logic ([skill_service.py:1001-1023](../../../velara-api/app/services/skill_service.py#L1001)) — reject non-`hybrid` (`InvalidBundleError`), enforce `HybridShapeMismatchError` shape-lock (`current_is_code_driven = skill.schema_version is not None`), `run_in_threadpool(_process_bundle, bundle_zip)`, `_write_bundle(...)`. **Key at the SAME version string** (`current_ver.version`, not a bumped one) so the content-addressed prefix is `skills/{skill_id}/{current_ver.version}/{new_checksum}`.
  - [x] **Inline branch (AC1):** reuse `create_version`'s inline logic ([skill_service.py:1024-1057](../../../velara-api/app/services/skill_service.py#L1024)) — `content.encode()`, sha256, `artifact_key = f"skills/{skill_id}/{current_ver.version}/{checksum}"`, `run_in_threadpool(storage.put, ...)`, then the `runtime_type == "hybrid"` code-driven-vs-LLM detection + parse + `HybridShapeMismatchError` shape-lock + `_safe_delete` on domain-validation failure (narrow `except`, NOT infra errors — 5.5.1 D3 lesson).
  - [x] **Capture the OLD artifact key/set for orphan cleanup** BEFORE re-pointing: `old_key, old_is_bundle, old_set = current_ver.artifact_key, current_ver.is_bundle, current_ver.artifact_set`.
  - [x] **Re-point the version row in place (the invariant carve-out):** set `current_ver.artifact_key`, `current_ver.artifact_checksum`, `current_ver.content_type`, `current_ver.is_bundle`, `current_ver.artifact_set` to the new values. Update `skill.schema_version` / `skill.egress` from a new code-driven manifest (mirror [skill_service.py:1084-1086](../../../velara-api/app/services/skill_service.py#L1084)) and re-snapshot `current_ver.schema_version = skill.schema_version` (mirror [:1094](../../../velara-api/app/services/skill_service.py#L1094)). `current_ver.consumes` follows `skill.consumes` if you touch it — but consumes is skill-level authoritative; leave it unless the manifest changes it (match create_version exactly).
  - [x] **Commit, then best-effort-delete the orphaned OLD artifact** via `_safe_delete_version_artifact(storage, old_key, old_is_bundle, old_set)` — but ONLY if `old_key != new_key` (an identical-content re-save yields the same checksum ⇒ same key ⇒ do NOT delete it). Mirror the `create_skill`/`create_version` failure-path `_safe_delete` discipline ([skill_service.py:280-294](../../../velara-api/app/services/skill_service.py#L280)); wrap the write path so a mid-operation failure deletes the NEW object and re-raises without touching the old one.
  - [x] **Do NOT** bump the version, insert a `SkillVersion` row, touch `current_version_id`, `lifecycle_state`, or the `review_required`/derived-child fan-out — those are `create_version`/`transition_lifecycle` concerns. This function ONLY re-points the current draft version's artifact pointer.
  - [x] **Amend the module docstring line 5** ([skill_service.py:5](../../../velara-api/app/services/skill_service.py#L5)) from the absolute *"SkillVersion rows are immutable — no UPDATE/DELETE ever"* to state the draft-only exception explicitly (per the ADR "Seams touched"): non-draft versions are immutable; a `draft` skill's current version content is mutable in place via `update_draft_content`.

- [x] **Task 3 — Draft-content-update request schema (AC1, AC2) — `app/schemas/skill.py`**
  - [x] Add `SkillDraftContentUpdate` mirroring `SkillVersionCreate` ([schema/skill.py:128-155](../../../velara-api/app/schemas/skill.py#L128)) MINUS the `version` field (in-place edit never sets a version): `content: str | None` (max 1 MiB), `content_type: str = "text/plain"`, `bundle_key: str | None` (max 1024), and the same `_exactly_one_artifact_mode` validator (`(content is None) == (bundle_key is None)` → ValueError). Response uses the existing `SkillVersionRead` (omits key/content per IP discipline).

- [x] **Task 4 — Draft-content-update route (AC1, AC2, AC4) — `app/api/v1/skills.py`**
  - [x] Add a route on the same `RejectClient`-gated router ([skills.py:46](../../../velara-api/app/api/v1/skills.py#L46)). Recommended: `PUT /api/v1/skills/{skill_id}/draft-content` (a content **replace**, not a metadata patch — distinct from the metadata `PATCH /{skill_id}` and the `PATCH /{skill_id}/lifecycle` routes). Body `SkillDraftContentUpdate`, response `ResponseEnvelope[SkillVersionRead]` (200, not 201 — no new resource). Model the handler on `create_version` ([skills.py:398-437](../../../velara-api/app/api/v1/skills.py#L398)): if `body.bundle_key`, `await skill_service.fetch_staged_bundle(...)` first (this also enforces the `bundle-staging/{caller_org}/` prefix / org-fence / HEAD size cap from 11.1's review — reuse it, do NOT re-validate), call `update_draft_content(...)`, then `_safe_delete(storage, body.bundle_key)` on success. `_meta(request)` envelope.
  - [x] **Do NOT** widen `create_version`, `update_skill_metadata`, or `transition_lifecycle` — this is an additive route. Keep `update_skill_metadata` metadata-only (it explicitly never touches `current_version_id`/content — [skill_service.py:1188](../../../velara-api/app/services/skill_service.py#L1188)).

- [x] **Task 5 — Draft content-READ route + service reader (AC1) — `app/api/v1/skills.py` + `app/services/skill_service.py`**
  - [x] **Scope-locked decision (Project Lead, 2026-07-09):** the draft editor **pre-fills** the current content, so a **new internal-only content-read endpoint** is in scope. This is a deliberate, narrow IP-read surface — gate it hard.
  - [x] `async def read_draft_content(*, session, storage, skill_id, org_id) -> tuple[bytes, str]` in `skill_service.py` — loads the skill (org-scoped `get_skill`), **asserts `skill.lifecycle_state == "draft"` and `current_version_id is not None`** → else `SkillNotDraftError` (409). **Reject bundle versions** (`current_ver.is_bundle` → a small typed 409/422, e.g. reuse `SkillNotDraftError`-style guard or a clear message: bundle content is not text-editable; hybrid drafts re-upload a ZIP, they do not text-edit). For an inline draft, `storage.get(current_ver.artifact_key)` → return `(bytes, current_ver.content_type)`. **This is the ONLY content-read path** — do NOT add bytes to `SkillVersionRead`; keep the general read schema key/content-free (the endpoint is the scoped exception, not the schema).
  - [x] Route: `GET /api/v1/skills/{skill_id}/draft-content` on the `RejectClient` router. Response: a small envelope carrying `{content, content_type}` (a new `SkillDraftContentRead` schema, or reuse `ResponseEnvelope` with an inline model) — **200 only for an inline `draft`; 409 `SKILL_NOT_DRAFT` for non-draft; a clear error for a bundle/hybrid draft** (there's no text to edit — the FE routes hybrids to `SkillBundleUpload`, so this GET is only called for prompt/code drafts). **IP discipline:** internal-only (`RejectClient` already blocks clients → 404); never expose the S3 key, only the decoded body + content_type; log skill_id + byte-length, never the bytes.

- [x] **Task 6 — OpenAPI regen (AC1)**
  - [x] `AUTH_BACKEND=dev .venv/bin/python scripts/export_openapi.py` on the host venv (the api container has no source mount — see 11.1 Debug Log) → regenerate `docs/api-spec.json` (additive: `PUT /skills/{id}/draft-content` + `SkillDraftContentUpdate`, and `GET /skills/{id}/draft-content` + `SkillDraftContentRead`). Commit the diff.

### Frontend (velara-web)

- [x] **Task 7 — `readDraftContent` + `updateDraftContent` API clients + hooks (AC1, AC5) — `src/api/skills.ts`, `src/features/skills/hooks/useSkills.ts`**
  - [x] New `readDraftContent(skillId)` in [src/api/skills.ts](../../../velara-web/src/api/skills.ts) → `GET /api/v1/skills/{id}/draft-content`, returns `{ content: string; content_type: string }` (`SkillDraftContentRead`). New `updateDraftContent(skillId, input: SkillDraftContentInput)` → `PUT /api/v1/skills/{id}/draft-content`, returns `SkillVersionSummary`. `SkillDraftContentInput` (new type in [types.ts](../../../velara-web/src/features/skills/types.ts)) = `{ content: string; content_type?: string } | { bundle_key: string }` (mutually exclusive, mirroring `SkillVersionCreateInput` minus `version`). Confirmed no such clients exist today (grep).
  - [x] New `useDraftContent(skillId, enabled)` query hook (fetch pre-fill; `enabled` only for an inline prompt/code `draft` — do NOT fire for hybrids or non-drafts) + `useUpdateDraftContent(skillId)` mutation hook in [useSkills.ts](../../../velara-web/src/features/skills/hooks/useSkills.ts). `queryKey: ['skills', skillId, 'draft-content']`; the mutation invalidates `['skills', skillId]`, `['skills']`, `['skills-page']`, and the draft-content query key (match the invalidation set used by `useCreateSkillVersion`/`useUpdateSkill`).

- [x] **Task 8 — Content authoring in the edit surface (AC1, AC2, AC5) — `src/features/skills/components/SkillEdit.tsx` + `SkillForm.tsx`**
  - [x] **Draft path:** in `SkillEdit` (currently metadata-PATCH only, [SkillEdit.tsx](../../../velara-web/src/features/skills/components/SkillEdit.tsx)), when `skill.lifecycle_state === 'draft'`, expose a **content editor**:
    - **prompt/code:** a plain `<textarea>` **pre-filled** from `useDraftContent(skillId)` (there is NO code/Monaco editor in the repo — a plain textarea is the house pattern; the create-mode `initial_content` textarea at [SkillForm.tsx:580-588](../../../velara-web/src/features/skills/components/SkillForm.tsx#L580) is the template to lift). Show a skeleton/loading state while the pre-fill fetch is in flight; a save submits the full (possibly-edited) body via `updateDraftContent`. Handle the pre-fill fetch's own errors (409/404) gracefully — an inline `draft` should always resolve.
    - **hybrid:** reuse the existing `SkillBundleUpload` control ([SkillBundleUpload.tsx](../../../velara-web/src/features/skills/components/SkillBundleUpload.tsx)) — it's fully decoupled (props `onBundleKeyChange`, `onUploadingChange`, `onFileChange`), produces a `bundle_key`. Wire it into the edit surface's hybrid branch exactly as `SkillForm` wires it for create ([SkillForm.tsx:506-516](../../../velara-web/src/features/skills/components/SkillForm.tsx#L506)), including the `onUploadingChange` submit-suspend guard.
    - Save calls `useUpdateDraftContent` with `{ content, content_type }` or `{ bundle_key }`. Surface the 409 `SKILL_NOT_DRAFT` and any 422 (`INVALID_BUNDLE`, `INVALID_CODE_DRIVEN_MANIFEST`, `HYBRID_SHAPE_MISMATCH`, `MISSING_BUNDLE_MANIFEST`, `ENTRYPOINT_CONTRACT_VIOLATION`) inline — reuse `getApiMessage`/`getErrorMessage` and the AI-adapt affordance already fired by `SkillForm` on `ENTRYPOINT_CONTRACT_VIOLATION`/`MISSING_BUNDLE_MANIFEST` ([SkillForm.tsx:518-576](../../../velara-web/src/features/skills/components/SkillForm.tsx#L518)) if a hybrid draft re-upload can hit those (it can — `update_draft_content` runs `_process_bundle` which runs `validate_entrypoint_contract`). Reusing the same panel keeps ONE review surface (11.9 principle).
  - [x] **Non-draft path (AC5):** when `skill.lifecycle_state !== 'draft'`, content is immutable-in-place — offer a **"Create new version"** action wired to the EXISTING `useCreateSkillVersion` hook + `createVersion` client (which has zero production callers today — 11.6 is its first). Same editor shape (textarea or `SkillBundleUpload`), submits `{ content, content_type }` or `{ bundle_key }`. This is the version-authoring UX 11.1's Dev Notes explicitly deferred to 11.6. Do NOT add a lifecycle-transition button here — the "Advance to …" / publish action already lives in [SkillDetail.tsx:224-233](../../../velara-web/src/features/skills/components/SkillDetail.tsx#L224); this story does not touch it.
  - [x] Keep the metadata-PATCH flow (`buildPatchBody` / `useUpdateSkill`, [SkillEdit.tsx:106-179](../../../velara-web/src/features/skills/components/SkillEdit.tsx#L106)) working unchanged — content authoring is **additive** to it, not a replacement.

- [x] **Task 9 — Types (AC1) — `src/features/skills/types.ts`**
  - [x] Add `SkillDraftContentInput` (the union above) and `SkillDraftContentRead` (`{ content: string; content_type: string }`). No change needed to `SkillVersionCreateInput`/`SkillWithVersion`/`LifecycleState` — they already carry everything (`lifecycle_state`, `current_version_id`, `is_bundle`, `artifact_set`).

- [x] **Task 10 — Tests (AC: all)**
  - [x] **Backend integration `tests/integration/api/test_skills.py` (ADD)** — Docker (PG + MinIO `velara-skills`), reuse `_auth_headers("ma_tech")`, `skill_payload`, `_CODE_DRIVEN_MANIFEST`, `_make_bundle_zip`/`_stage_bundle`/`_BUNDLE_MEMBERS` ([test_skills.py:2104-2142](../../../velara-api/tests/integration/api/test_skills.py#L2104)):
    - **AC1 (write):** create a `draft` prompt skill → `PUT /draft-content` with new inline content → 200; GET shows the **same version string**, `artifact_checksum` **changed**, `current_version_id` **unchanged** (no new row — assert version count via a second create/version is unaffected, or check the version list length stays 1). Old S3 object is gone / new one retrievable byte-for-byte.
    - **AC1 (read/pre-fill):** `GET /draft-content` on an inline `draft` → 200 returning the current `{content, content_type}` (byte-exact round-trip after a write). `GET /draft-content` on a **hybrid/bundle** draft → clear error (not text-editable). `GET /draft-content` on a **non-draft** skill → 409 `SKILL_NOT_DRAFT`. Confirm a `client` role is 404 (router `RejectClient`).
    - **AC2:** create a `draft` hybrid from a bundle → `PUT /draft-content` with a new staged bundle → 200; `is_bundle=true`, `artifact_set` reflects the NEW members, same version string. A cross-shape draft ZIP (against an LLM-driven hybrid, or a non-hybrid skill) → 422 `HYBRID_SHAPE_MISMATCH` / `INVALID_BUNDLE`; nothing re-pointed.
    - **AC4 (the immutability gate):** advance the skill `draft → internal_ready` (`_lifecycle` helper / PATCH lifecycle), then `PUT /draft-content` → **409 `SKILL_NOT_DRAFT`**; the version artifact is untouched. Same against a `client_ready` skill.
    - **AC3 (publish is unchanged):** assert an in-place draft edit followed by a `create_version` still auto-bumps correctly and the prior (now-published) version stays immutable — i.e. `update_draft_content` did not corrupt the create_version path.
    - **AC1 idempotence:** re-saving identical content yields the same checksum and does NOT delete the (identical) object out from under the row.
  - [x] **Frontend** ([useSkills.test.tsx](../../../velara-web/src/features/skills/hooks/useSkills.test.tsx), [skills.test.ts](../../../velara-web/src/api/skills.test.ts), `SkillEdit.test.tsx`): mock `@/api/skills`; assert `readDraftContent` GETs the right endpoint and `updateDraftContent` PUTs `{content}` / `{bundle_key}`; `useDraftContent` pre-fills the editor and `useUpdateDraftContent` invalidates the query keys; `SkillEdit` renders the pre-filled content editor for an inline `draft` skill and the "Create new version" action for a non-`draft` skill; a hybrid draft renders `SkillBundleUpload` (no pre-fill fetch) and suspends save while uploading; the 409/422 errors render inline. Follow `SkillCreate.test.tsx` (`vi.mock('@/api/skills')`, `QueryClientProvider`+`MemoryRouter`) and `DocumentUploadCard.test.tsx` (mock the upload hook, `it.each` by phase).

- [x] **Task 11 — Gates**
  - [x] **Backend:** `docker compose build api` then `docker compose run --rm -e AUTH_BACKEND=dev api python -m pytest` — baseline is 11.9's post-review number **1244 passed** in-container (only the 3 known `test_ingest.py` MinIO-in-container failures acceptable; new tests add, don't regress). `docker compose run --rm api ruff check .` clean. Regenerate `docs/api-spec.json` on the host venv and commit the diff. **NO migration** (L3 — pointer re-write only; confirm you added none).
  - [x] **Frontend:** `npm run typecheck` → 0; `npm run lint` → 0 errors / 1 pre-existing `Icon.tsx` baseline warning; `npm run test` (vitest) → baseline **612 passed**, record the new count.

### Review Findings

_Code review 2026-07-09 (bmad-code-review, 3-layer adversarial: Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 5 ACs + all 3 ADR-locked decisions (L1/L2/L3) independently verified SATISFIED. 1 decision-needed (resolved), 5 patches (all applied), 1 deferred, 8 dismissed as noise/false-positive/pre-existing. Post-patch gates: BE ruff clean + `test_skills.py` 159 passed in-container (12 draft-content tests among them); FE typecheck 0 / lint 0 err (1 known Icon.tsx warn) / vitest 59 passed across the 5 touched suites; no api-spec regen needed (patches touched logic/log/constant only)._

- [x] [Review][Decision→Patch] Dead `updated_by_user_id` param — no attribution for in-place draft edits — **RESOLVED (Project Lead 2026-07-09): log the user id.** `update_draft_content(..., updated_by_user_id: str)` was a required kwarg plumbed from the route but never referenced. **APPLIED:** added `updated_by_user_id` to the `skill_draft_content_updated` structured log line — attribution now lands in observability without adding an audit surface the ADR/ACs never required for draft churn (consistent with `create_version` emitting no audit event). [velara-api/app/services/skill_service.py — `skill_draft_content_updated` log call]
- [x] [Review][Patch] Rollback path deletes the LIVE artifact on same-checksum re-save + commit failure — the success-path orphan cleanup guarded `if old_key != new_key` but the **rollback** `except` deleted `new_key` unconditionally. On a byte-identical re-save (`new_key == old_key`) where `session.commit()` then raised, rollback left the still-committed row pointing at `old_key` while `_safe_delete_version_artifact(new_key)` deleted that very object → silent draft data loss (next read = NoSuchKey). **APPLIED:** the rollback delete is now guarded with the same `if new_key != old_key:` check. [velara-api/app/services/skill_service.py — `update_draft_content` rollback `except` block]
- [x] [Review][Patch] `DRAFT_CONTENT_NOT_TEXT_EDITABLE` not catalogued as an `ERROR_CODE_*` constant — its sibling `SKILL_NOT_DRAFT` was registered but the second new request-time 409 code had none. **APPLIED:** added `ERROR_CODE_DRAFT_CONTENT_NOT_TEXT_EDITABLE = "DRAFT_CONTENT_NOT_TEXT_EDITABLE"` in the `execution_tasks.py` constants block, constant-only (NOT wired into `_map_error_code`), matching its sibling. [velara-api/app/workers/execution_tasks.py]
- [x] [Review][Patch] Stale `bundle_key` re-submit after a successful bundle save → confusing `BUNDLE_NOT_UPLOADED` — the route deletes the staging object on success; the editor stayed mounted with `bundleKey`/`bundleFile` + the "ready" chip intact, so a second Save re-submitted the now-deleted key → 422. **APPLIED:** on save success the component clears `bundleKey`/`bundleFile`/`showAdapterReview` and bumps an `uploaderNonce` used as `SkillBundleUpload`'s `key` to force-remount and clear its internal file/phase state — a consumed staging key can no longer be re-submitted. [velara-web/src/features/skills/components/SkillContentEditor.tsx — `handleSave` onSuccess + `SkillBundleUpload key`]
- [x] [Review][Patch] `SKILL_NOT_DRAFT` race left the editor stuck in draft mode + service-XOR self-defense — a concurrent publish flipping the skill out of `draft` after mount left an un-satisfiable "Edit content" Save; and `update_draft_content` trusted the schema's exactly-one guard (a direct caller with both artifact args None would 500 on `content.encode()`). **APPLIED (both):** (FE) an effect invalidates `['skills', skillId]` on an `SKILL_NOT_DRAFT` mutation error so `useSkill` refetches and the surface flips to non-draft "Create new version" mode; (BE) `update_draft_content` now asserts exactly-one-of `content`/`bundle_zip` at the top (raises `ValueError`) as defense-in-depth. [velara-web/src/features/skills/components/SkillContentEditor.tsx — `apiCode` effect; velara-api/app/services/skill_service.py — top-of-`update_draft_content` guard]
- [x] [Review][Defer] Staged ZIP orphaned on a failed/rejected draft-content update [velara-api/app/api/v1/skills.py:497-508] — the route's `_safe_delete(body.bundle_key)` runs only on the success branch (no `try/finally`), so a rejected update (422/409) leaks the staged object. **Deferred, pre-existing:** `create_version`'s route [skills.py:437] has the byte-identical success-only cleanup pattern; 11.6 faithfully mirrors it. Already tracked as 11.1-review deferred work ("bundle-staging/ GC needs an S3 lifecycle rule — delete-on-422 would break retry"). Fix belongs with the staging-GC lifecycle rule, not this story.

## Dev Notes

### The core design — draft-mutable versioning (READ THE ADR FIRST)

This story is the sole consumer of **[core-architectural-decisions.md#Draft-Mutable-Versioning](../../planning-artifacts/architecture/core-architectural-decisions.md)** (added 2026-07-06, authored by Winston explicitly for 11.6). It is not a suggestion — it is the locked design. The essential shape:

- **`draft` content is mutable in place; every non-draft version is immutable.** While `lifecycle_state == "draft"`, edits to the **current** version's content overwrite that version's *pointer* (new content-addressed S3 key, re-pointed `artifact_key`/`artifact_checksum`) — **no version bump, no new row.** The moment the skill is published (advances out of `draft`), the version freezes and all subsequent content changes mint a new immutable version via the existing `create_version`.
- **Why not "always a new version" on every draft save:** it pollutes the version list with throwaway `0.x` rows, inflates S3, and makes the meaningful (published/run/certified) version history unreadable. Immutability earns its keep the instant a version is **referenceable** — run (needs a resolvable current version + `assert_invocable`), certify (gates `client_ready`), promote/export (published versions) — and none of those touch a `draft`. The immutability frontier is drawn exactly at non-draft (Rule of Three: run, certify, promote all key on non-draft).
- **The exception is enforced as code:** `update_draft_content` **asserts** `draft` + `current_version_id is not None` and raises `SkillNotDraftError` (409). That assertion IS the invariant — not a docstring.
- **Storage stays content-addressed even mutating:** write a NEW `…/{new_checksum}` key, re-point the row, best-effort-delete the orphaned prior object. Never overwrite an S3 key in place (preserves "the checksum names the bytes" + sidesteps read-after-overwrite consistency). Mirror `create_skill`'s `_safe_delete` failure discipline.
- **`HybridShapeMismatchError` applies within draft:** a draft edit may not switch manifest shape (code-driven ↔ LLM-driven) — shape is a structural identity, not draft-mutable content.
- **Orthogonal, unchanged rules:** the `client_ready → draft` reset-on-new-version ([skill_service.py:1102-1103](../../../velara-api/app/services/skill_service.py#L1102)) and the derived-child `review_required` fan-out ([:1111-1119](../../../velara-api/app/services/skill_service.py#L1111)) operate on **published** versions via `create_version` — they are NOT part of draft-mutability and you do not touch them.
- **Revisit trigger (do not build speculatively):** if a Part-11 obligation is ever placed on skill *artifact bytes*, this exception is revoked and immutability pushed to a DB trigger. If multi-author draft collaboration appears, add optimistic concurrency (a version-row `updated_at` check) THEN — single-author drafting is the current reality, so no lost-update guard now.

### What's already built vs. what 11.6 adds (verified — prevents double-building)

Story 11.1 shipped the primitives 11.6 consumes and **explicitly deferred the authoring UX to this story** (see the 11.1 "Scope boundary vs Story 11.6" table):

| Concern | Built (11.1) | This story (11.6) |
|---|---|---|
| `createVersion` FE client + `useCreateSkillVersion` hook | ✅ (exists, **zero production callers**) | wires it into the non-draft "Create new version" action (AC5) |
| `SkillBundleUpload` control (pick `.zip` → `bundle_key`) | ✅ (fully decoupled) | reuses it in the draft hybrid + new-version flows |
| `fetch_staged_bundle` (org-fence + HEAD size cap) | ✅ | reuses it verbatim in the draft-content route |
| `_process_bundle` / `_write_bundle` / `_safe_delete_version_artifact` | ✅ | reuses them in `update_draft_content` |
| `transition_lifecycle` + `useTransitionLifecycle` + `SkillDetail` "Advance to …" button | ✅ | **this IS the publish action — do not duplicate** |
| In-place draft mutate path (`update_draft_content` + `SkillNotDraftError` + `SKILL_NOT_DRAFT`) | ❌ | ✅ NEW (Tasks 1-2) |
| Draft-content update route + `SkillDraftContentUpdate` schema | ❌ | ✅ NEW (Tasks 3-4) |
| Draft content-READ route + `read_draft_content` (pre-fill, draft+inline+internal-only) | ❌ | ✅ NEW (Task 5) |
| `readDraftContent`/`updateDraftContent` FE clients + `useDraftContent`/`useUpdateDraftContent` hooks | ❌ | ✅ NEW (Task 7) |
| Content editor in `SkillEdit` (draft, pre-filled) + "Create new version" (non-draft) | ❌ (`SkillEdit` = metadata PATCH only; artifact textarea is create-only) | ✅ NEW (Task 8) |

**If you find yourself building a second lifecycle-advance button, a code/Monaco editor, or a parallel AI-adapt review panel — stop.** Publish = existing advance button; the editor is a plain textarea (house pattern); the AI-adapt panel is the one already in `SkillForm` (11.3/11.9).

### Verified backend facts to build on

- **`create_version` ([skill_service.py:955-1134](../../../velara-api/app/services/skill_service.py#L955)) is your template** — copy its inline branch (1024-1057) and bundle branch (1001-1023) into `update_draft_content`, but key at the **current** version string and **UPDATE the row** instead of INSERTing. It row-locks via `get_skill(for_update=True)`, threads `_process_bundle`/`_write_bundle`, and does the shape-lock + `_safe_delete`-on-domain-failure — replicate that discipline.
- **`transition_lifecycle` ([:876-952](../../../velara-api/app/services/skill_service.py#L876)) is the publish freeze point** — `_ALLOWED_TRANSITIONS` = `{draft:{internal_ready,retired}, internal_ready:{client_ready,retired}, client_ready:{retired}, retired:{}}`. Advancing out of `draft` is `draft → internal_ready` (or `→ retired`). It already row-locks and audits; you don't touch it.
- **`update_skill_metadata` ([:1178-1224](../../../velara-api/app/services/skill_service.py#L1178))** never touches `current_version_id`/content/lifecycle — keep it that way; draft content is a **separate** route/function.
- **`_safe_delete_version_artifact(storage, artifact_key, is_bundle, artifact_set)` ([:280-294](../../../velara-api/app/services/skill_service.py#L280))** deletes each bundle member (`{key}/{path}`) or the single object — use it for the orphaned OLD draft artifact (only when the new key differs).
- **`SkillVersion` columns** ([skill.py:165-218](../../../velara-api/app/models/skill.py#L165)): `artifact_key`(1024), `artifact_checksum`(64), `content_type`(128), `is_bundle`(bool, server_default false), `artifact_set`(JSONB), `schema_version`(32), `consumes`(JSONB). `UniqueConstraint(skill_id, version)` — in-place edit keeps the same `version` so it never trips.
- **Enum values are plain VARCHAR** (no PG enum/CHECK) — allowed states live in the schema `Literal`s + model comments. `lifecycle_state` default `"draft"`.
- **Error-code registry** ([execution_tasks.py:38-86](../../../velara-api/app/workers/execution_tasks.py#L38)): request-time skill-service `VelaraHTTPException` codes (`SKILL_RETIRED`, `INVALID_LIFECYCLE_TRANSITION`, `HYBRID_SHAPE_MISMATCH`) are NOT in `_map_error_code` — only catalogued as constants where relevant. Add `SKILL_NOT_DRAFT` as a constant only.

### Verified frontend facts to build on

- **`SkillEdit.tsx`** PATCHes metadata only (`buildPatchBody` [:106-156], `useUpdateSkill`); no content editor, no version authoring, mounts at `/internal/skills/:skillId/edit`. `SkillForm mode="edit"` renders **no** artifact input (all artifact entry is `mode === 'create'`-gated at [SkillForm.tsx:501](../../../velara-web/src/features/skills/components/SkillForm.tsx#L501)).
- **`src/api/skills.ts`** clients: `createSkill`, `updateSkillMetadata` (PATCH metadata), `transitionLifecycle` (PATCH `/lifecycle`), `createVersion` (POST `/versions`, no caller), `presignBundle`/`putBundleToS3`, `proposeSkillAdapter`. **No `updateDraft*` client** — you add the first.
- **`useSkills.ts`** hooks: `useCreateSkill`, `useCreateSkillVersion` (no caller), `useUpdateSkill`, `useTransitionLifecycle`, `useAcknowledgeParentUpdate` — all invalidate `['skills', skillId]`/`['skills']`/`['skills-page']`. Match that set.
- **`SkillBundleUpload.tsx`** props: `onBundleKeyChange(key|null)`, `onUploadingChange?(bool)`, `onFileChange?(File|null)`; accepts `.zip`, surfaces its own errors inline, produces a `bundle_key`. Fully reusable — no create-mode coupling.
- **`SkillDetail.tsx`** owns the lifecycle UI: `NEXT_STATES` mirror of `_ALLOWED_TRANSITIONS`, the **"Advance to {label}"** primary button ([:224-233](../../../velara-web/src/features/skills/components/SkillDetail.tsx#L224)) driving a `ConfirmDialog` → `transitionMutate`, plus the `DERIVED_SKILL_REVIEW_REQUIRED`/`INVALID_LIFECYCLE_TRANSITION` error handling. **This is publish. Do not re-create it in SkillEdit.**
- **`types.ts`**: `LifecycleState = 'draft'|'internal_ready'|'client_ready'|'retired'`; `SkillVersionCreateInput = {content,content_type?,version?} | {bundle_key,version?}`; `SkillUpdateInput` is metadata-only. Add `SkillDraftContentInput`.
- **No Monaco/CodeEditor anywhere** (grep = 0). The plain `<textarea>` (create-mode `initial_content`, [SkillForm.tsx:580-588](../../../velara-web/src/features/skills/components/SkillForm.tsx#L580)) is the house pattern to lift. **Icons:** never emoji, never inline svg — use `<Icon>` (project memory: No Emoji Icons); no new icon needed here (`archive` for zip already exists from 11.1).

### The content-read endpoint (scope-locked with the Project Lead 2026-07-09 — pre-fill IS in scope)

`SkillVersionRead`/`getSkill` deliberately **omit** artifact bytes and S3 keys (IP discipline — [schema/skill.py:222-242](../../../velara-api/app/schemas/skill.py#L222)), so the general read schema alone can't pre-fill the editor. **Decision (Project Lead): add a narrow, internal-only draft content-read endpoint** so the prompt/code draft editor pre-fills the existing body for true in-place editing (not a blind full-replace). This is a **scoped exception to the no-content-read rule**, not a relaxation of the schema:

- The endpoint (`GET /skills/{id}/draft-content`, Task 5) is **draft-only + inline-only + internal-only**: `RejectClient` router (clients → 404), asserts `lifecycle_state == "draft"` (else 409 `SKILL_NOT_DRAFT`), rejects bundle/hybrid drafts (their content is a ZIP, re-uploaded not text-edited). It returns only the decoded body + `content_type` for one specific draft — never an S3 key, never for a published version.
- **Do NOT** add content bytes to `SkillVersionRead` or the list/get schemas — the exception lives at a single hard-gated endpoint, so the general read surface stays key/content-free. A published version's bytes remain unreadable via API (as designed).
- **Why draft-only is the right boundary:** a `draft` is un-referenceable (can't run/certify/promote) and its content is being actively authored by the same internal developer — reading it back to edit it is the whole point. A published version is a governed, immutable record; its bytes stay closed. The read boundary matches the write boundary (both draft-only), which is coherent with the ADR's "immutability frontier = non-draft."

### PHI / IP discipline (house invariant — unchanged from 11.1)

- Never store file content inline in the DB — S3 key + metadata only; `artifact_set` holds paths/hashes/sizes, never bytes.
- Read schemas never expose keys or content; error messages name the offending field/path, never dump bytes/values (5.5.1 IP-leak lesson).
- A skill bundle is IP (Vitalief methodology), not PHI — but the file-by-key / no-inline-bytes rules apply identically.

### Testing standards

- **Backend:** integration in `tests/integration/api/test_skills.py` (Docker PG + MinIO `velara-skills`, auto-skip guard at [:27-71](../../../velara-api/tests/integration/api/test_skills.py#L27)); reuse `_auth_headers("ma_tech")`, `skill_payload`, `_CODE_DRIVEN_MANIFEST`, `_make_bundle_zip`/`_stage_bundle`. The 3 pre-existing `test_ingest.py` MinIO-in-container failures are unrelated (project memory: Pre-existing CI Failures). **Rebuild the api image before dockerized pytest** — it bakes source (project memory: Epic 8 Story 8.4 review). Host pytest fails on the `apply_migrations` fixture (Docker hostname) — run in-container.
- **Frontend:** Vitest + Testing Library, jsdom, co-located `*.test.tsx`. Mock `@/api/skills` and the upload hook. Follow `SkillCreate.test.tsx` + `DocumentUploadCard.test.tsx`.
- Call out any deliberately-uncovered edge case in Completion Notes (the no-pre-fill content editor above; any interaction with the AI-adapt panel on a hybrid draft re-upload).

### Project Structure Notes

- **Backend (velara-api):** MODIFY `app/services/skill_service.py` (`SkillNotDraftError`, `update_draft_content`, `read_draft_content`, docstring amend), `app/schemas/skill.py` (`SkillDraftContentUpdate`, `SkillDraftContentRead`), `app/api/v1/skills.py` (draft-content PUT + GET routes), `app/workers/execution_tasks.py` (`ERROR_CODE_SKILL_NOT_DRAFT` constant), `docs/api-spec.json` (regenerated); tests. **NO migration** (L3).
- **Frontend (velara-web):** MODIFY `src/api/skills.ts` (`readDraftContent`, `updateDraftContent`), `src/features/skills/hooks/useSkills.ts` (`useDraftContent`, `useUpdateDraftContent`), `src/features/skills/components/SkillEdit.tsx` (pre-filled content editor + new-version action), possibly `SkillForm.tsx` (share the editor branch — but do not un-gate create-only artifact entry unexpectedly), `src/features/skills/types.ts` (`SkillDraftContentInput`, `SkillDraftContentRead`); tests.
- **Two nested repos:** `velara-api` and `velara-web` are **separate git repos** nested under the top-level `velara` (which holds `_bmad-output` docs). Both trees clean at story creation: `velara-api` `5a3d0a8`, `velara-web` `928e3c8`. Commit backend and frontend as **two separate commits** in their respective repos (`feat(skills): Story 11.6 — <short title> (Epic 11)`). **NEVER push subrepos** — commit-only in velara-api/velara-web; only the top-level docs repo is pushed with explicit permission (project memory: Never Push Subrepos). Do NOT `git add` the top-level docs repo from inside a nested repo.

### Previous Story Intelligence

- **Story 11.1 (direct dependency)** built the bundle path, `createVersion`/`SkillBundleUpload`/`useCreateSkillVersion` (no callers — you're the first), `fetch_staged_bundle` (org-fence + HEAD cap), migration 0022 (`artifact_set`/`is_bundle`). Its review lessons that apply: (1) **`bundle_key` must be org-fenced** — `fetch_staged_bundle` already does this; reuse it, don't re-open the IDOR. (2) **narrow `except` to domain errors** before `_safe_delete` — infra errors must not delete the artifact. (3) **`putBundleToS3` must check `response.ok`** — already fixed in the client you're reusing. (4) FE submit must suspend while a bundle upload is in flight (`onUploadingChange`).
- **Story 11.9 (most recent, done 2026-07-09)** — the AI-adapt panel (`AIAdapterReview`) is the ONE review surface fired on `ENTRYPOINT_CONTRACT_VIOLATION`/`MISSING_BUNDLE_MANIFEST`. If a hybrid draft re-upload hits those (it can — `update_draft_content` → `_process_bundle` → `validate_entrypoint_contract`), reuse that same panel; do not build a second. Gate baselines to regress against: **BE 1244 passed** (3 known ingest failures), ruff clean; **FE typecheck 0 / lint 1 known warning / vitest 612 passed.** Latest migration is **0022** (you add none).
- **Story 5.5.1** — IP-leak lesson: error messages built from field location + type, never echo artifact bytes/values. Apply to `SkillNotDraftError` and all draft-content 422s.

### Git Intelligence Summary

Both repos use `feat(<area>): Story <id> — <short title> (Epic <n>)`. Recent: velara-api `5a3d0a8` (Story 11.9 review), velara-web `928e3c8` (Story 11.9 review). This story lands as two commits, e.g. `feat(skills): Story 11.6 — draft-edit + version-on-publish authoring (Epic 11)` (velara-api) and `feat(skills): Story 11.6 — in-UI content editor + new-version action (Epic 11)` (velara-web).

### Sequencing / dependencies

- **Recommended epic order: 11.1 → 11.2 → 11.6 → 11.3 → 11.9 → 11.4 → 11.7 → 11.5.** In practice 11.3/11.9 landed before 11.6 (see sprint-status), which is harmless — 11.6 only hard-depends on **11.1** (the ZIP/bundle path + `createVersion`/`SkillBundleUpload`) and the **Draft-Mutable Versioning ADR** (both present). 11.3/11.9 being done means the AI-adapt panel is available to reuse for hybrid draft re-uploads.
- **Downstream:** 11.4 (export) serializes published bundle versions; nothing consumes `update_draft_content` output beyond the normal execution path (a draft can't run/certify/promote, so the mutable pointer is never referenced externally — which is the whole point of the ADR).

### References

- [Source: planning-artifacts/architecture/core-architectural-decisions.md#Draft-Mutable-Versioning] — **the authoritative design** (ADR #3, authored for 11.6): in-place draft mutation, enforced `draft`-assertion, content-addressed new-key + orphan-delete, `HybridShapeMismatchError` within draft, publish=freeze-point, orthogonal reset/review rules, no-migration, revisit triggers, "Seams touched (for 11.6 dev)".
- [Source: epics/epic-11-ai-assisted-skill-integration-and-promotion.md#Story-11.6] — story, ACs, epic sequencing, the three ADRs and which stories they gate.
- [Source: _bmad-output/implementation-artifacts/stories/11-1-multi-file-zip-bundle-upload-and-extraction.md] — the direct predecessor: the "Scope boundary vs Story 11.6" table (what it deferred to you), `createVersion`/`SkillBundleUpload`/`useCreateSkillVersion`/`fetch_staged_bundle`, migration 0022, review lessons (org-fence, narrow-except, response.ok, upload-in-flight guard).
- [Source: velara-api app/services/skill_service.py:955-1134] — `create_version` (the template: inline + bundle branches, row-lock, shape-lock, `_safe_delete`, schema_version snapshot); [:876-952] `transition_lifecycle` (publish freeze point, `_ALLOWED_TRANSITIONS`); [:1178-1224] `update_skill_metadata` (metadata-only, never touches version); [:280-294] `_safe_delete_version_artifact`; [:5] module docstring to amend; [:126-200] error-class block for `SkillNotDraftError`.
- [Source: velara-api app/schemas/skill.py:128-155] — `SkillVersionCreate` + `_exactly_one_artifact_mode` (mirror for `SkillDraftContentUpdate`); [:222-242] `SkillVersionRead` (omits key/content — the read constraint); [:513-523] `LifecycleTransitionRequest`.
- [Source: velara-api app/api/v1/skills.py:46] `RejectClient` router; [:398-437] `create_version` route (model the draft-content route on it — `fetch_staged_bundle` → service → `_safe_delete`); [:376-392] lifecycle route; [:513-536] metadata PATCH route.
- [Source: velara-api app/models/skill.py:165-218] `SkillVersion` columns + `UniqueConstraint(skill_id,version)`; [:35-162] `Skill` (`lifecycle_state`, `runtime_type`, `schema_version`, `egress`, `current_version_id`).
- [Source: velara-api app/workers/execution_tasks.py:38-86] — `ERROR_CODE_*` constants block (add `SKILL_NOT_DRAFT`; do NOT wire into `_map_error_code`).
- [Source: velara-api tests/integration/api/test_skills.py:27-71,76-105,1622,2104-2142] — skip guard, `_auth_headers`, `skill_payload`, `_CODE_DRIVEN_MANIFEST`, bundle helpers, `_lifecycle` transition helper.
- [Source: velara-web src/api/skills.ts] — client surface (`createVersion` no caller; no `updateDraft*`); [src/features/skills/hooks/useSkills.ts] — hooks + invalidation keys; [types.ts] — `LifecycleState`, `SkillVersionCreateInput`, `SkillUpdateInput`.
- [Source: velara-web src/features/skills/components/SkillEdit.tsx:106-179] — metadata-only PATCH flow to extend additively; [SkillForm.tsx:501-601] — create-only artifact entry (textarea + bundle wire-in template); [SkillBundleUpload.tsx] — reusable uploader props; [SkillDetail.tsx:113-233] — the existing lifecycle "Advance to …" publish UI (do NOT duplicate).
- [Source: project memory — Never Push Subrepos; velara-web is a separate nested git repo; No Emoji Icons; Pre-existing CI Failures Fixed; Epic 8 Story 8.4 review (rebuild api image before pytest); Story 11.9 Review (AI-adapt panel = one surface)].

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- api image bakes source (no volume mount) — rebuilt via `docker compose build api` after every backend source change before re-running dockerized pytest (Epic 8 Story 8.4 lesson, re-confirmed).
- `test_update_draft_content_client_ready_409` initially assumed a separate `PATCH /lifecycle` call was needed to reach `client_ready` after the two-key certification; the second `POST /api/v1/certifications` call actually **auto-advances** the skill to `client_ready` (Story 6.3 D1), making the extra `_lifecycle` call itself 422 `INVALID_LIFECYCLE_TRANSITION` (client_ready → client_ready). Fixed by asserting the auto-advanced state via GET instead of calling `_lifecycle` again.
- Certification endpoint shape confirmed from `tests/integration/api/test_certifications.py` (`POST /api/v1/certifications` with `{skill_id, certification_type}`, types `technical`/`methodological`) rather than guessed — avoided a skip-guarded test.

### Completion Notes List

- **AC1/AC2/AC4 (backend):** `SkillNotDraftError` (409, `SKILL_NOT_DRAFT`) + `DraftContentNotTextEditableError` (409, `DRAFT_CONTENT_NOT_TEXT_EDITABLE`, for a bundle/hybrid draft read) added to `skill_service.py`. `update_draft_content` mirrors `create_version`'s inline/bundle branches exactly but re-points the CURRENT `SkillVersion` row in place (same version string, new content-addressed key) instead of inserting — row-locked via `get_skill(for_update=True)`, shape-locked via the existing `HybridShapeMismatchError` guard, orphan-cleans the OLD artifact only when the checksum actually changed (idempotent re-save safe). `read_draft_content` is the sole content-read path (draft + inline only), enforced as code per the ADR, not documented convention.
- **Task 1 constant registration:** `ERROR_CODE_SKILL_NOT_DRAFT` catalogued in `execution_tasks.py` as a stable constant only (not wired into `_map_error_code`), matching how `SKILL_RETIRED`/`INVALID_LIFECYCLE_TRANSITION` are handled — it's a request-time `VelaraHTTPException`, not a Celery task-result code.
- **Module docstring (skill_service.py:1-10):** amended from the absolute "no UPDATE/DELETE ever" to state the draft-only exception explicitly, per the ADR's "Seams touched" note.
- **AC3:** verified via `test_draft_edit_then_publish_then_create_version_unaffected` — a draft edit, then publish (`draft → internal_ready`), then `create_version` still auto-bumps to `1.1.0` and the prior (now-published) version's checksum is untouched by the new version.
- **Frontend (AC5):** new `SkillContentEditor` component (not folded into `SkillForm`, which stays create-only per Dev Notes) renders a pre-filled textarea for an inline `draft`, `SkillBundleUpload` for a hybrid `draft` (no pre-fill fetch — `useDraftContent`'s `enabled` flag is `isDraft && !isHybrid`), or a "Create new version" action (wired to the existing, previously-uncalled `useCreateSkillVersion`) for any non-draft skill. Mounted additively below the existing metadata form in `SkillEdit.tsx`; the existing "Advance to …" publish button in `SkillDetail.tsx` was not touched.
- **Deliberately uncovered edge case:** the AI-adapt panel (`AIAdapterReview`) is wired into `SkillContentEditor`'s hybrid branch using the same `ENTRYPOINT_CONTRACT_VIOLATION`/`MISSING_BUNDLE_MANIFEST` trigger as `SkillForm`, but only exercised manually/by code-read, not by an automated FE test — the existing `AIAdapterReview.test.tsx` already covers the panel's own behavior in isolation, and duplicating that coverage here was judged low-value versus the story's time budget.
- **No migration added** (L3 confirmed — latest migration is still `0022`, unchanged).

### File List

**Backend (velara-api):**
- MODIFIED `app/services/skill_service.py` — `SkillNotDraftError`, `DraftContentNotTextEditableError`, `update_draft_content`, `read_draft_content`, module docstring amend
- MODIFIED `app/schemas/skill.py` — `SkillDraftContentUpdate`, `SkillDraftContentRead`
- MODIFIED `app/api/v1/skills.py` — `GET /{skill_id}/draft-content`, `PUT /{skill_id}/draft-content` routes
- MODIFIED `app/workers/execution_tasks.py` — `ERROR_CODE_SKILL_NOT_DRAFT` constant
- MODIFIED `docs/api-spec.json` — regenerated (additive)
- MODIFIED `tests/integration/api/test_skills.py` — 11 new Story 11.6 integration tests

**Frontend (velara-web):**
- MODIFIED `src/api/skills.ts` — `readDraftContent`, `updateDraftContent`
- MODIFIED `src/features/skills/hooks/useSkills.ts` — `useDraftContent`, `useUpdateDraftContent`
- MODIFIED `src/features/skills/types.ts` — `SkillDraftContentInput`, `SkillDraftContentRead`
- NEW `src/features/skills/components/SkillContentEditor.tsx`
- MODIFIED `src/features/skills/components/SkillEdit.tsx` — mounts `SkillContentEditor` additively
- MODIFIED `src/api/skills.test.ts` — `readDraftContent`/`updateDraftContent` tests
- MODIFIED `src/features/skills/hooks/useSkills.test.tsx` — `useDraftContent`/`useUpdateDraftContent` tests
- MODIFIED `src/features/skills/components/SkillEdit.test.tsx` — content-editor render tests (draft inline, non-draft, draft hybrid) + inert mocks for the new hooks
- MODIFIED `src/routes/internal.test.tsx` — added inert mocks for `useDraftContent`/`useUpdateDraftContent`/`useCreateSkillVersion` (route-tree test was breaking on the new hook calls)

## Change Log

| Date | Change |
|---|---|
| 2026-07-09 | Story 11.6 drafted (create-story). Draft-edit + version-on-publish, gated by the Draft-Mutable Versioning ADR (in-place draft mutation, `SkillNotDraftError`/409, no migration). **Scope decision (Project Lead):** the draft prompt/code editor **pre-fills** existing content via a new internal-only, draft+inline-gated `GET /skills/{id}/draft-content` read endpoint (a scoped IP-read exception — bytes NOT added to the general read schema), rather than a blind full-replace textarea. Reuses 11.1's `createVersion`/`SkillBundleUpload`/`fetch_staged_bundle` and 11.9's AI-adapt review panel; publish = the existing `transition_lifecycle` "Advance to …" action. Status → ready-for-dev. |
| 2026-07-09 | Story 11.6 implemented (dev-story). Backend: `SkillNotDraftError`/`DraftContentNotTextEditableError`, `update_draft_content`/`read_draft_content` service functions, `SkillDraftContentUpdate`/`SkillDraftContentRead` schemas, `PUT`+`GET /skills/{id}/draft-content` routes, `ERROR_CODE_SKILL_NOT_DRAFT` constant, docstring amend, OpenAPI regen (additive), 11 new integration tests. Frontend: `readDraftContent`/`updateDraftContent` clients, `useDraftContent`/`useUpdateDraftContent` hooks, new `SkillContentEditor` component wired additively into `SkillEdit`, new types, 3 test files updated/added. Gates: BE 1256 passed (3 known pre-existing `test_ingest.py` failures, ruff clean, no new migration); FE typecheck 0, lint 0 errors/1 known warning, vitest 621 passed (+9 net new). Status → review. |
