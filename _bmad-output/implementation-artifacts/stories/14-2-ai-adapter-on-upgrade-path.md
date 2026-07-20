---
baseline_commit: af15651 (velara-api) / 61d3a3c (velara-web)
---

# Story 14.2: AI Adapter Assist on the Skill Upgrade Path

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer upgrading a skill with a non-conforming code-driven bundle,
I want the same AI adapter assist that exists at initial registration to be offered when I create a **new version**,
so that a bundle whose entrypoint signature drifted doesn't hard-fail with a dead 422 and force me out to hand-fix it — the propose→approve→register loop already exists; I just want it reachable from the upgrade path.

**Depends on: Story 14.1 (done).** 14.1 removed the shape-lock that previously fired *before* the adapter was reachable on the LLM→code case (AC3 below cannot pass without it). 14.1 is merged at `af15651`.

**Why this is small (verified in source, not assumed):** The adapter propose route (`POST /api/v1/skills/integration-assistant/propose`) is skill-agnostic and already reuses the same `bundle_key` staging the create-version path uses. On the FE, the reusable review panel (`AIAdapterReview`) is **already wired into `SkillContentEditor`** (the Story 11.6 create-version surface) — but only for the `MISSING_BUNDLE_MANIFEST` case, with a hardcoded `entrypoint={undefined}`. It does **not** yet handle `ENTRYPOINT_CONTRACT_VIOLATION` + `category=="signature"` with a real declared entrypoint. This story fills that gap by porting the more-complete `SkillForm` (registration) wiring onto the version path, exposing the server's `category` so the FE can gate on it, and adding a deterministic `requirements`-from-lockfile backfill for the second reported error. **Mostly FE orchestration + two small BE changes.**

## Acceptance Criteria

1. **AC1 — An adaptable upgrade failure offers AI-assist instead of a dead 422.**
   **Given** `POST /api/v1/skills/{id}/versions` fails with `ENTRYPOINT_CONTRACT_VIOLATION` where the failure `category == "signature"` (the adaptable case)
   **When** the FE surfaces it on the new-version authoring surface (`SkillContentEditor`)
   **Then** it offers "AI-adapt this upgrade," opening the **same** `AIAdapterReview` panel used at initial registration (Stories 11.3/11.9) — one review surface, now reached from a third entry point — and passes the bundle's **real declared entrypoint** (read client-side via `readBundleEntrypoint`), not `undefined`. A `category == "missing"` `ENTRYPOINT_CONTRACT_VIOLATION` does **not** offer the assist (nothing to adapt). The existing `MISSING_BUNDLE_MANIFEST` affordance on this surface is preserved unchanged (it still passes no entrypoint — the assistant infers it).

2. **AC1b (enabling BE change) — the server exposes the violation `category` so the FE can discriminate.**
   **Given** an `EntrypointContractViolationError` (which already carries a `category` attribute of `"signature"` or `"missing"`, `entrypoint_contract.py:73`) but whose category is **not** serialized to the client today
   **When** the error is rendered to JSON
   **Then** the category is surfaced in the response body at `error.details.category` (reusing the existing `_error_response(details=...)` injection seam — **no** `ErrorDetail` schema change, no top-level field), so the FE can read `getApiDetail(err, 'category') === 'signature'`. This is the only mechanism by which AC1's signature-vs-missing discrimination is possible; without it the FE cannot tell the two apart (the rendered `code`/`message` are identical for both categories).

3. **AC2 — The propose→approve→re-version loop reuses the existing machinery unchanged.**
   **Given** I request AI-assist on the staged upgrade bundle
   **When** the propose call runs
   **Then** it calls the existing `POST /skills/integration-assistant/propose` with the same `bundle_key` + declared `entrypoint`; the AI authors **only** the adapter+manifest (core files byte-for-byte unchanged, checksum-proven via `core_files_unchanged` — the Epic 11 guarantee holds); on approve, the FE writes the two members into the bundle, re-stages via presign→PUT, and re-POSTs `/versions` through the **unmodified** `create_version` path (including the registration-time `validate_entrypoint_contract` re-check inside `_process_bundle`). No forked "AI register" branch; no new backend endpoint. The `AIAdapterReview` component's `onApproved(stagingKey)` handoff is reused verbatim — the parent (`SkillContentEditor`) re-submits the returned staging key as its own `bundle_key`.

4. **AC3 — The LLM→code upgrade case works end-to-end (enabled by 14.1).**
   **Given** an LLM-driven hybrid skill and a code-driven (adaptable-signature) replacement bundle
   **When** I upgrade with AI-assist
   **Then** it succeeds end-to-end — because 14.1 already removed the shape-lock that previously fired *before* the adapter was reachable. There is **no cross-shape 422** on this path anymore; the only 422 the adapter needs to bridge is the `signature` contract violation. (This AC is a proof-of-integration test spanning 14.1 + 14.2, not new production code.)

5. **AC4 — The paid LLM call stays behind the stricter gate; audit is preserved.**
   **Given** the propose route's `RejectNonGrantor` (admin/ma_tech only) gate and its `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED` audit (success **and** failure, with token spend)
   **When** the assist is used from the upgrade path
   **Then** both are preserved — the paid call stays on the propose route (**NOT** folded into the looser-gated create-version endpoint), and the adapter-proposed audit fires exactly as today. This is **Design (A)** from the investigation: keep the split propose→approve loop; **reject** any inline `?adapt=true` design that would smuggle a paid LLM call behind `create_version`'s looser gate. No change to the propose route's gate or audit is made or needed.

6. **AC5 — The `missing 'requirements'` case is handled deterministically, not by the LLM.**
   **Given** a code-driven **upgrade** bundle whose `manifest.json` omits `requirements` but which ships a `requirements.txt` lockfile at the bundle root (or single-top-dir-wrapped root)
   **When** the bundle is validated on the create-version / draft-update / create-skill path
   **Then** the `requirements` field is filled **deterministically from the bundled lockfile text** (mirroring the Story 11.9 `_find_lockfile_text` synthesis, read verbatim as utf-8), not fabricated by the LLM — the bundle parses and the version is created. A bundle with **no** lockfile and no manifest `requirements` stays a hard 422 (a code-driven skill with no declared deps can't be installed — silently defaulting to `[]` is **explicitly rejected**). This closes the second error the trigger reported (`Code-driven hybrid manifest is missing required field 'requirements'`) without pretending it's an adapter job. It applies to **all** bundle paths that route through `_process_bundle` (create_skill, create_version, update_draft_content), not just the upgrade path, because the fix lives in the shared parse step.

**Out of scope (do NOT touch):**
- The shape-lock relaxation and per-version egress — that shipped as **Story 14.1** (done). Do not re-touch `HybridShapeMismatchError`, the projection-reset `else` branches, or `skill_versions.egress`.
- The FE explicit-version field — that shipped as **Story 14.3** (done, `SkillContentEditor` lines ~17-45/81-82/113-125/190-201). Do not rewrite it; the AI-adapt affordance sits alongside it on the same surface.
- Any **new** audit event type — reuse `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED`. No `audit_categories.py` / guard-registry interaction (the guard registry must stay green).
- The propose route's auth gate, request/response schema, and service (`propose_adapter`) — they already work verbatim for upgrades. Do **not** add a `bundle_key`-vs-upgrade branch to the service; it is intentionally skill-agnostic and stateless.

## Tasks / Subtasks

- [ ] **Task 1 — Expose `EntrypointContractViolationError.category` in the serialized error body (AC1b) — `velara-api/app/core/exceptions.py`**
  - [ ] In `velara_http_exception_handler` (`exceptions.py:68-94`), before the `return _error_response(...)`, read `category = getattr(exc, "category", None)` and, when non-`None`, pass `details={"category": category}` into `_error_response`. This reuses the existing `details` injection seam (`_error_response` at `exceptions.py:47-65` already does `content["error"]["details"] = jsonable_encoder(details)` — no schema change to `ErrorDetail`).
  - [ ] Result shape: `{"error": {"code": "ENTRYPOINT_CONTRACT_VIOLATION", "message": "...", "request_id": "...", "details": {"category": "signature"}}}`. Confirm the `MISSING_BUNDLE_MANIFEST` and other errors (no `category` attr) are unaffected — `getattr(..., None)` leaves them detail-less exactly as today.
  - [ ] **Guard against regressing the request-validation path:** the ONLY other producer of `error.details` today is `validation_exception_handler` (passes `details=exc.errors()`). Your change is in a different handler (`velara_http_exception_handler`), so the two never collide — verify by reading both handlers. Do not touch `validation_exception_handler`.
  - [ ] `docs/api-spec.json`: adding an optional runtime-only `details.category` does **not** change any declared response schema (`details` is injected post-`model_dump`, not a Pydantic field), so **no api-spec regeneration is expected**. Confirm via `git status` after the change; if a diff appears, investigate before committing (it should not).

- [ ] **Task 2 — Deterministic `requirements`-from-lockfile backfill (AC5) — `velara-api`, shared bundle-parse path**
  - [ ] The fix must live where **all** bundle paths converge: `_process_bundle` (`skill_service.py:431-452`) calls `parse_code_driven_manifest(manifest_bytes)` (line 450), which 422s `INVALID_CODE_DRIVEN_MANIFEST` when `requirements` is absent (`code_driven_hybrid.py:206-211`). Insert the deterministic backfill **before** that raise so a manifest missing only `requirements` is repaired from the bundled lockfile, then parsed normally.
  - [ ] Reuse the Story 11.9 lockfile locator `_find_lockfile_text(files)` (`skill_integration_assistant.py:412-463`) — it already finds `requirements.txt` at the bundle root or single-top-dir root and reads it verbatim as utf-8, raising `ManifestSynthesisError` when absent/empty/undecodable. **Prefer lifting/importing it** (or a small shared equivalent) over duplicating; if importing from `skill_integration_assistant` into `skill_service`/`code_driven_hybrid` creates a cycle, extract the locator into a neutral module (e.g. `app/services/bundle_lockfile.py`) and have both import it. Grep for existing import direction first to pick the clean placement.
  - [ ] **Backfill site & shape:** in `_process_bundle` (the choke point), after `find_manifest` yields `manifest_bytes` but before/at `parse_code_driven_manifest`: if the parsed-or-raw manifest is missing `requirements`, look up the lockfile text from the already-extracted `files`; if found, inject it as the manifest's `requirements` and parse; if **not** found, let the original hard 422 stand (do NOT default to `[]`). Match the existing error semantics — a missing-lockfile case should surface a clear "must ship its dependency lockfile" message (the `_find_lockfile_text` `ManifestSynthesisError` copy is a good model; decide whether to re-raise as `INVALID_CODE_DRIVEN_MANIFEST` for a bundle-that-had-a-manifest vs `MANIFEST_SYNTHESIS_ERROR`, and document the choice — a bundle WITH a manifest but no lockfile is arguably `INVALID_CODE_DRIVEN_MANIFEST`, keeping the manifest-present path's error code stable).
  - [ ] **Only backfill `requirements`.** The other required fields (`entrypoint`, `output_schema`, `schema_version`, `code_driven_hybrid.py:206`) must still 422 if missing — those are not lockfile-derivable and are not in scope. This is a targeted repair, not a general "synthesize the whole manifest" path (that's the 11.9 assistant, gated behind the paid route).
  - [ ] Verify the backfill runs identically for create_skill / create_version / update_draft_content since all three go through `_process_bundle`.

- [ ] **Task 3 — Lift `readBundleEntrypoint` into a shared, exported helper (AC1) — `velara-web`**
  - [ ] Today `readBundleEntrypoint` is a module-private `async function` inside `SkillForm.tsx:15-28` (reads the staged ZIP's `manifest.json` client-side via `fflate` `unzipSync`, returns `entrypoint` string or `null`, never throws). Move it to a shared module (e.g. `src/features/skills/utils/readBundleEntrypoint.ts`), export it, and import it in **both** `SkillForm.tsx` and `SkillContentEditor.tsx`. Keep the behavior byte-for-byte identical (it's a pure `File → Promise<string|null>`); do not change what it parses.
  - [ ] Confirm `SkillForm.tsx` still compiles/behaves identically after the extraction (it currently calls it at `SkillForm.tsx:264` inside the contract-violation `useEffect`).

- [ ] **Task 4 — Wire the signature-adaptable affordance into `SkillContentEditor` (AC1, AC2, AC3) — `velara-web/src/features/skills/components/SkillContentEditor.tsx`**
  - [ ] Add a `getApiDetail`/category read: the FE already reads `apiCode = getApiCode(mutation.error)` (`SkillContentEditor.tsx:102`). Add the `category` read from `error.details.category` (extend the `errors.ts` helpers — see Task 5). Compute `isSignatureViolation = isContractViolation && category === 'signature'`.
  - [ ] Update `showAiAdaptAffordance` (`SkillContentEditor.tsx:107`) so the contract-violation branch only fires for `category === 'signature'` (the `missing` category shows the generic error, no assist). The `MISSING_BUNDLE_MANIFEST` branch is unchanged.
  - [ ] Replicate the `SkillForm` entrypoint-read pattern (`SkillForm.tsx:254-271`): a `useEffect` gated on `showAiAdaptAffordance && bundleFile && isSignatureViolation` that calls the now-shared `readBundleEntrypoint(bundleFile)` into a `bundleEntrypoint` state.
  - [ ] Change the `<AIAdapterReview>` render (`SkillContentEditor.tsx:233-246`) to pass `entrypoint={isMissingManifest ? undefined : (bundleEntrypoint ?? undefined)}` instead of the hardcoded `entrypoint={undefined}` (`SkillContentEditor.tsx:238`) — mirroring `SkillForm.tsx:562-576`. The `onApproved={(stagingKey) => { setBundleKey(stagingKey); ...re-submit... }}` handoff already exists in spirit (SkillContentEditor sets `bundleKey`); wire it so approval re-POSTs `/versions` with the new staging key (reuse the existing `handleSave`/`createVersion` path; do not fork a new mutation).
  - [ ] Preserve the `errorIsStale` guard (`SkillContentEditor.tsx:87,109-111,212`) — swapping the uploaded ZIP must reset the affordance so it never renders against a stale error.
  - [ ] Do **not** disturb the Story 14.3 explicit-version field or the draft-in-place (`updateDraftContent`) path — a `draft` skill still edits in place (no version bump). The AI-adapt affordance is for the non-draft new-version path (and, if a draft ZIP also 422s on signature, may reuse the same panel — confirm the draft path's error handling and keep it consistent, but do not expand scope beyond wiring the existing panel).

- [ ] **Task 5 — Extend the FE error helper to read `error.details.category` (AC1) — `velara-web/src/shared/utils/errors.ts`**
  - [ ] The `ApiError` interface (`errors.ts:9-12`) models `response.data.error.{code, message, details}` but has no typed `category`. Add a helper (e.g. `getApiDetail(err, key)` returning `error.details?.[key]`, or a specific `getApiErrorCategory(err)`) reading `response.data.error.details?.category`. Match the existing `getApiCode`/`getApiMessage` null-safe style (`errors.ts:14-20`).
  - [ ] Note `getApiDetails`/`mapDetailsToFieldErrors` (`errors.ts:22-34`) currently expect `details` to be an **array** of `{loc, msg}` (FastAPI validation shape). Our `category` uses `details` as an **object** (`{category}`). Ensure the new reader tolerates both shapes and does not break `mapDetailsToFieldErrors` (which is only called on `VALIDATION_ERROR`, a different code) — verify by reading those helpers.

- [ ] **Task 6 — Tests (AC1b, AC3, AC4, AC5)**
  - [ ] **BE (velara-api):**
    - [ ] AC1b: a test asserting a signature-category `ENTRYPOINT_CONTRACT_VIOLATION` from `POST /skills/{id}/versions` returns `error.details.category == "signature"`, and a `missing`-category one returns `"missing"`. Reuse existing bundle fixtures from `tests/integration/api/test_skills.py` (the propose-route/entrypoint tests around lines ~2587-4664 already build conforming and non-conforming bundles).
    - [ ] AC5: `test_bundle_requirements_backfilled_from_lockfile` — a code-driven bundle whose `manifest.json` omits `requirements` but ships `requirements.txt` → version created, manifest `requirements` == the lockfile text; and `test_bundle_missing_requirements_and_lockfile_rejected` — no manifest `requirements` AND no lockfile → hard 422 (NOT `[]`). Run these on the `create_version` path AND at least assert once on `create_skill`/`update_draft_content` (or unit-test `_process_bundle` directly) to prove the shared-path claim.
    - [ ] AC3 (proof-of-integration, spans 14.1+14.2): LLM-driven hybrid skill → code-driven adaptable-signature bundle upgrade succeeds through `create_version` with no cross-shape 422 and (if the bundle is conforming) no contract violation — proving the shape-lock no longer blocks the LLM→code upgrade. This is the end-to-end guarantee 14.2 promises; if a signature violation is involved, the propose→approve step is FE-orchestrated, so the BE test asserts the create-version path itself is unblocked given a conforming (post-adapter) bundle.
    - [ ] AC4: assert the propose route still 404s for client/consultant (`RejectNonGrantor`) and still emits `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED` (success + failure) — likely already covered by existing propose tests; confirm they still pass unchanged (this story makes no propose-route change, so this is a regression-guard, not new behavior).
  - [ ] **FE (velara-web):** extend the existing `SkillEdit.test.tsx` / `SkillContentEditor` tests: (1) a `signature` contract-violation on create-version shows the AI-adapt affordance and passes the read entrypoint; (2) a `missing` contract-violation shows the generic error, NOT the affordance; (3) `MISSING_BUNDLE_MANIFEST` still shows the affordance (regression). Mock `readBundleEntrypoint`/the propose call per the existing test patterns (14.3 added `SkillEdit.test.tsx` +201 lines — follow its mocking style).

- [ ] **Task 7 — Gates**
  - [ ] **velara-api:** rebuild the api image before pytest (`docker compose build api` — the image bakes source; project memory). Run `test_skills.py` (and any `test_skill_integration_assistant.py` / `test_code_driven_hybrid.py` touched) with the `AUTH_BACKEND=dev` override (local compose defaults `AUTH_BACKEND=cognito`, which 401s dev-auth test tokens across the suite — documented in 14.1's Debug Log and project memory). Full-repo run: expect the one documented pre-existing flake (`test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped`, append-only-DB re-run sensitivity) — not a regression.
  - [ ] `ruff check` clean on all changed velara-api files.
  - [ ] **velara-web:** run the FE test + lint/typecheck per the project's usual FE gate. Do not push either subrepo (project memory: never push subrepos; code-review commits velara-api/velara-web post-review).
  - [ ] Confirm **no `docs/api-spec.json` diff** (Task 1 note) and **no new audit event** (guard registry green).

## Dev Notes

### The shape of this story: two tiny BE seams + FE orchestration (the panel already exists)

Do not over-engineer. The adapter propose route, its service, its gate, its audit, and the `AIAdapterReview` review panel **all already work** and are **not** modified. The three real pieces of work are:
1. **BE (Task 1):** one handler tweak so the FE can *see* the `signature`-vs-`missing` distinction the server already knows (`error.details.category`). Without this the FE literally cannot implement AC1's discrimination — the two categories render identical JSON today.
2. **BE (Task 2):** a deterministic `requirements`-from-lockfile repair in the shared `_process_bundle` parse step (mirrors 11.9's `_find_lockfile_text`), so the second reported error stops being a dead 422. This is NOT an LLM job and must NOT default to `[]`.
3. **FE (Tasks 3-5):** port the *more complete* `SkillForm` (registration) adapter wiring onto `SkillContentEditor` (the version-authoring surface), which today only half-handles it (`MISSING_BUNDLE_MANIFEST` only, `entrypoint={undefined}` hardcoded at `SkillContentEditor.tsx:238`).

### The critical spec tension, resolved: `category` is not on the wire today (AC1b exists because of this)

The epic's AC1 says the FE gates on `category=="signature"`, but investigation found `EntrypointContractViolationError.category` (`entrypoint_contract.py:73`) is a **Python instance attribute only** — the exception handler (`velara_http_exception_handler`, `exceptions.py:68-94`) serializes **only** `code`/`message`/`request_id`, and its own docstring says "the rendered error is identical either way." So AC1 is **unimplementable as written** until the category is exposed. AC1b is the enabling change and uses the **least-invasive** path: the `_error_response(details=...)` seam already exists (used today only by the request-validation handler), so `error.details.category` needs **no** Pydantic/schema change and **no** api-spec regeneration. Do not add a top-level `category` field or modify `ErrorDetail` — that's a wider blast radius for no benefit.

### `category` semantics — only "signature" is adaptable (this is the whole point of the gate)

`entrypoint_contract.py` raises `category="signature"` when the callable exists but its shape doesn't conform — an adapter **can** bridge it (async-def, not-a-FunctionDef, or `sig.bind` failure). It raises `category="missing"` when the module/callable doesn't exist or can't be parsed — **nothing to adapt** (offering AI-assist would waste a paid LLM call on an impossible fix). AC1's "missing does not offer the assist" is the guard against that. (Sites: `"missing"` at ~169-172/181/189/213-217; `"signature"` at ~220/222-226/232 — read `validate_entrypoint_contract` at `entrypoint_contract.py:156` for the current exact lines.)

### The propose/approve loop is CLIENT-orchestrated — the BE never re-registers on the FE's behalf (AC2)

`propose_adapter` (`skill_integration_assistant.py:830`) is a **pure, stateless** function — "structurally incapable of persisting anything" (its docstring). It receives already-extracted `files` (the *route* stages/extracts from `bundle_key`), authors the adapter+manifest, proves core files unchanged via `_compute_core_files_unchanged` (sha256 per path, `skill_integration_assistant.py:572-584`), and returns an `AdapterProposalResponse`. The FE (`AIAdapterReview.tsx:65-105`) then: unzips the original bundle client-side, writes the adapter member + the `updated_manifest` (stamped `ai_adapted: true`), re-zips, presign→PUTs a fresh staging key, and hands it up via `onApproved(stagingKey)`. The parent re-POSTs `/versions` with that key, which re-runs `validate_entrypoint_contract` inside `_process_bundle` — so the adapter is *proven* to conform on the real registration path, not trusted. **Do not add any server-side "apply the adapter" step.** This split is deliberate (AC4): the paid LLM call is isolated on the `RejectNonGrantor`-gated propose route; the create-version route stays looser-gated and never makes a paid call.

### Why NOT `?adapt=true` on create-version (AC4 — reject this design)

The tempting shortcut is an inline `POST /versions?adapt=true` that proposes+applies+registers in one call. **Reject it.** It would either (a) run the paid LLM call behind `create_version`'s looser gate (a privilege/cost-control regression), or (b) duplicate the propose route's auth+audit. Design (A) — reuse the existing split loop, add zero backend endpoints — preserves the gate and the `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED` audit (success+failure+token-spend) for free. The investigation explicitly chose (A); the FE already implements (A) for `MISSING_BUNDLE_MANIFEST`, so we're extending a proven pattern, not inventing one.

### AC5 — deterministic repair, mirror 11.9, never fabricate

`_process_bundle` (`skill_service.py:431-452`) parses in a fixed order: `extract_bundle` → `find_manifest` (else `MISSING_BUNDLE_MANIFEST`) → `parse_code_driven_manifest` (the `missing required field 'requirements'` 422 fires here, `code_driven_hybrid.py:206-211`) → `validate_entrypoint_contract`. The AC5 fix inserts a lockfile backfill so a manifest missing **only** `requirements` is repaired from the bundled `requirements.txt` **before** the hard raise. Reuse Story 11.9's `_find_lockfile_text` (`skill_integration_assistant.py:412-463`) — it reads the lockfile verbatim as utf-8 (NOT utf-8-sig — Epic 11 AC3 byte-fidelity) from the bundle root or single-top-dir root. **Only `requirements` is lockfile-derivable** — the other required fields (`entrypoint`/`output_schema`/`schema_version`) still 422 if missing. **No lockfile → keep the hard 422; never default to `[]`** (a code-driven skill with no declared deps is uninstallable — a silent `[]` would ship a broken skill). Watch the import direction: if pulling `_find_lockfile_text` from `skill_integration_assistant` into `skill_service`/`code_driven_hybrid` risks a cycle, extract it to a neutral module and import from both.

### Files being modified — current state (read before editing)

**velara-api (baseline `af15651`, 14.1 merged):**
- `app/core/exceptions.py` — `VelaraHTTPException` (3 attrs: status_code/code/message; `exceptions.py:27-40`), `velara_http_exception_handler` (`68-94`, serializes only code/message/request_id via `_error_response`), `_error_response` (`47-65`, has the `details` injection seam). **UPDATE:** surface `category` via `details`.
- `app/services/skill_service.py` — `_process_bundle` (`431-452`, the shared bundle-parse choke point) and `create_version` (`create_version` at `1089`; bundle branch `1137-1156` calls `_process_bundle` at `1148`). 14.1's shape-lock removal already landed here — do NOT re-touch the projection/egress blocks. **UPDATE:** insert the AC5 lockfile backfill in/around `_process_bundle`'s parse step.
- `app/services/code_driven_hybrid.py` — `parse_code_driven_manifest` (`206-211` required-fields loop, raises `INVALID_CODE_DRIVEN_MANIFEST` 422). Decide whether the backfill happens before this call (in `_process_bundle`) or inside it; prefer `_process_bundle` so `parse_code_driven_manifest` stays a pure parser.
- `app/services/skill_integration_assistant.py` — `_find_lockfile_text` (`412-463`) is the pattern to reuse (possibly lift to a shared module). `propose_adapter` (`830`) and its route (`app/api/v1/skills.py:399-514`, gate + audit) are **read-only reference** — do not modify.
- `app/services/entrypoint_contract.py` — `EntrypointContractViolationError` (`48-73`, sets `self.category`), `validate_entrypoint_contract` (`156`). Read-only reference for AC1b — the attr already exists; you're only exposing it.

**velara-web (baseline `61d3a3c`, 14.3 merged):**
- `src/features/skills/components/SkillForm.tsx` — the **template**: `readBundleEntrypoint` (`15-28`, module-private → lift & export), the contract-violation `useEffect` (`254-271`), the `<AIAdapterReview entrypoint={isMissingManifest ? undefined : (bundleEntrypoint ?? undefined)}>` render (`562-576`). Registration-mode wiring is complete here — port it.
- `src/features/skills/components/SkillContentEditor.tsx` — the **target**: already detects both codes (`102-107`), shows the affordance (`216-231`), renders `<AIAdapterReview>` but hardcodes `entrypoint={undefined}` (`238`) and does not read `category`. 14.3's explicit-version field lives here (`~17-45/81-82/113-125/190-201`) — leave it alone. **UPDATE:** add category read, entrypoint read, pass real entrypoint.
- `src/features/skills/components/AIAdapterReview.tsx` — the reusable panel (`props 15-32`, propose call `54-63`, approve/re-stage `65-105`). **Read-only reuse** — do not modify; just pass it the real `entrypoint`.
- `src/shared/utils/errors.ts` — `getApiCode`/`getApiMessage` (`14-20`), `ApiError` shape (`9-12`, no `category`), `getApiDetails`/`mapDetailsToFieldErrors` (`22-34`, array-shaped `details`). **UPDATE:** add a `details.category` reader that tolerates both the object (`{category}`) and array (validation) `details` shapes.
- `src/api/skills.ts` — `proposeSkillAdapter(bundleKey, entrypoint?)` (`215-226`), `createVersion` (`140-149`). **Read-only** — the client functions already send/omit `entrypoint` correctly.

### AC3 is a proof-of-integration, not new code

14.1 already removed every cross-shape 422 on `create_version` (verified: only `InvalidBundleError` "ZIP requires a hybrid skill" remains at the bundle branch). So the LLM→code upgrade is **already unblocked** at the create-version level — AC3's job is a test proving the two stories compose: an LLM-driven skill accepts a code-driven (conforming, post-adapter) bundle as a new version with no cross-shape rejection. If a signature violation is in the loop, the propose→approve is FE-orchestrated (covered by FE tests); the BE AC3 test asserts the create-version path itself no longer blocks the shape change.

### House patterns / traps (project memory)

- **api image bakes source** — rebuild before pytest or you test stale code (project memory: Story 8.4 / Pre-existing CI Failures). Host pytest runs against `velara_test` (conftest forces the DB + autouse `alembic upgrade head`).
- **`AUTH_BACKEND=cognito` local default** — 401s dev-auth test tokens across the whole suite; run pytest with `-e AUTH_BACKEND=dev` (14.1 Debug Log; project memory "host pytest recipe").
- **NEVER push subrepos** (HARD rule) — dev-story commits nothing in velara-api/velara-web; only the top-level docs repo is committed+pushed by the docs step. Both subrepos stay uncommitted working-tree for code-review. (This story is the first Epic 14 change to **both** repos — 14.1 was api-only, 14.3 web-only.)
- **`git checkout -- <path>` on never-committed files wipes ALL changes** — use stash/saved diffs to reset mid-work.
- **No new migration** — this story adds no column and no migration (unlike 14.1). If dev-story finds itself writing a migration, stop and reconsider — AC5 is a parse-time repair, not a schema change.
- **No emoji icons** in velara-web — use `<Icon>` from `src/shared/components/Icon.tsx` (project memory: No Emoji Icons). The affordance banner reuses existing SkillForm/SkillContentEditor markup, so this shouldn't come up, but hold the line.

### Testing standards

- BE integration tests in `tests/integration/api/test_skills.py` (async httpx `client`, `raise_app_exceptions=False`, `celery_eager` inline). The propose-route + entrypoint-contract tests live around lines ~2587-4664 — reuse their conforming/non-conforming bundle builders and `_internal_auth()`; do not invent new fixtures. Unit-level manifest/parse tests in `tests/unit/services/test_code_driven_hybrid.py` and `tests/unit/services/test_skill_integration_assistant.py` — the AC5 lockfile-backfill logic is a good candidate for a focused unit test of `_process_bundle` (or the extracted locator) alongside the integration test.
- FE tests extend `src/features/skills/components/SkillEdit.test.tsx` (14.3 added +201 lines here — follow its mocking style for `createVersion`, the propose call, and `readBundleEntrypoint`).

### Previous Story Intelligence

- **Story 14.1 (this epic, done — the dependency):** removed the shape-lock at all 4 guard sites in `skill_service.py`, added the projection-reset `else` branches, added `skill_versions.egress` (migration 0023). ⚠️ Do NOT re-touch any of that — it's merged at `af15651` and code-reviewed. Its Dev Notes confirm `_process_bundle` is the shared parse choke point and that `create_skill` builds the first version at TWO sites (bundle + inline) — relevant if AC5's backfill needs to hold on the create-skill path too. Its review dismissed a "bundle path never runs `is_code_driven_manifest`" finding as by-design (a bundle is always a code-driven hybrid, enforced by `InvalidBundleError`) — consistent with AC5 only ever touching the code-driven manifest path.
- **Story 11.9 (AI-assisted manifest generation — the pattern AC5 mirrors):** built `_synthesize_manifest`/`_find_lockfile_text`; entrypoint = LLM-proposes / static-validates fail-closed; `MISSING_BUNDLE_MANIFEST` (422). ⭐ Its `_find_lockfile_text` is the exact deterministic lockfile-read AC5 reuses. ⚠️ Its review trap: the FE approve was DROPPING the entrypoint module (packing-list vs checksum-proof confusion) → runtime `ModuleNotFoundError` — `core_files_unchanged` is a checksum PROOF, not a packing list. Since 14.2 reuses `AIAdapterReview`'s approve path verbatim (already fixed in 11.9), this shouldn't recur, but understand the distinction if you touch the reassembly.
- **Story 11.3 (AI skill integration assistant):** built `propose_adapter` + the review panel + `ENTRYPOINT_CONTRACT_VIOLATION` with the signature/missing split. The panel and route this story reuses.
- **Story 11.6 (draft-mutable versioning):** built `SkillContentEditor` (the target surface) + `update_draft_content`. Draft skills edit in place (no bump); non-draft skills create a new version. Keep the AI-adapt affordance on the non-draft version path consistent with the existing draft handling.
- **Story 14.3 (this epic, done):** added the explicit-version field to `SkillContentEditor` — the same file Task 4 edits. No conflict (different concern, different JSX region), but read the current file so you don't clobber the version field.

### Project Structure Notes

- **Full-stack story (both subrepos):** velara-api (2 small BE seams: error-serialization + lockfile backfill) + velara-web (FE orchestration). This is the first Epic 14 story to touch **both** repos.
- **velara-api changes:** `app/core/exceptions.py` (AC1b), `app/services/skill_service.py` and/or a new neutral `bundle_lockfile` module + `code_driven_hybrid.py` (AC5). Read-only reference: `skill_integration_assistant.py`, `entrypoint_contract.py`, `app/api/v1/skills.py` propose route.
- **velara-web changes:** lift `readBundleEntrypoint` to a shared util; edit `SkillContentEditor.tsx` (category read + entrypoint read + real-entrypoint render); extend `errors.ts` (category reader); extend `SkillEdit.test.tsx`. Read-only reuse: `AIAdapterReview.tsx`, `api/skills.ts`.
- **No migration, no new audit event, no api-spec change** — confirm all three at the gate.
- **Two nested repos:** velara-api and velara-web are separate git repos nested under the top-level velara (`_bmad-output` docs). This story touches both (working-tree, uncommitted — code-review commits them). **NEVER push subrepos.**

### References

- [Source: epics/epic-14-skill-upgrade-flexibility.md#Story-14.2] — story origin, ACs, Design (A) decision, dependency on 14.1.
- [Source: planning-artifacts/sprint-change-proposal-2026-07-20.md §4.3] — correct-course detail: AC1 signature-vs-missing, AC4 Design (A) / reject `?adapt=true`, AC5 lockfile backfill / reject `[]` default.
- [Source: _bmad-output/implementation-artifacts/stories/14-1-relax-hybrid-shape-lock.md] — the dependency (done); `_process_bundle` as the shared choke point; shape-lock already removed; `create_skill` two-site first-version fact.
- [Source: velara-api app/core/exceptions.py:27-40] — `VelaraHTTPException` base (status_code/code/message only).
- [Source: velara-api app/core/exceptions.py:47-65] — `_error_response` + the `details` injection seam (`content["error"]["details"] = jsonable_encoder(details)`); [68-94] `velara_http_exception_handler` (serializes only code/message/request_id — the AC1b edit site); [164-176] `validation_exception_handler` (the ONLY current `details` producer — do not touch).
- [Source: velara-api app/schemas/common.py:25-32] — `ErrorDetail`/`ErrorEnvelope` (fixed code/message/request_id; `details` is injected post-`model_dump`, NOT a declared field — so AC1b needs no schema change).
- [Source: velara-api app/services/entrypoint_contract.py:48-73] — `EntrypointContractViolationError` sets `self.category` ("signature"/"missing"), NOT serialized today; [156+] `validate_entrypoint_contract` raise sites (missing vs signature).
- [Source: velara-api app/services/skill_service.py:431-452] — `_process_bundle` (shared parse: extract → find_manifest → parse_code_driven_manifest → validate_entrypoint_contract); [1089] `create_version`; [1137-1156] bundle branch calling `_process_bundle` at 1148. Shape-lock already removed by 14.1 — do not re-touch.
- [Source: velara-api app/services/code_driven_hybrid.py:206-211] — required-fields loop raising `INVALID_CODE_DRIVEN_MANIFEST` on missing `requirements`; [63-65,89-94] the `requirements` field + non-empty validator.
- [Source: velara-api app/services/skill_integration_assistant.py:412-463] — `_find_lockfile_text` (the AC5 deterministic lockfile read to reuse); [830] `propose_adapter` (pure/stateless — read-only); [572-584] `_compute_core_files_unchanged` (checksum guarantee); [654,682,800-805] `_synthesize_manifest` (11.9 pattern reference).
- [Source: velara-api app/api/v1/skills.py:399-514] — propose route (`RejectNonGrantor` gate line ~402, `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED` audit success+failure) — read-only; AC4 regression-guard only.
- [Source: velara-api app/schemas/skill.py:227-257] — `AdapterProposalRequest` (bundle_key + optional entrypoint) / `AdapterProposalResponse` (adapter_path/source, updated_manifest, manifest_path, core_files_unchanged, proposal_non_conforming) — read-only, already correct for upgrades.
- [Source: velara-web src/features/skills/components/SkillForm.tsx:11-28 (readBundleEntrypoint), 254-271 (contract-violation useEffect), 562-576 (AIAdapterReview render w/ real entrypoint)] — the registration-path template to port.
- [Source: velara-web src/features/skills/components/SkillContentEditor.tsx:102-107 (code read), 107 (showAiAdaptAffordance), 216-231 (affordance banner), 233-246 (AIAdapterReview render), 238 (hardcoded entrypoint={undefined} — the bug to fix); 17-45/81-82/113-125/190-201 (14.3 version field — leave alone)] — the target surface.
- [Source: velara-web src/features/skills/components/AIAdapterReview.tsx:15-32 (props), 54-63 (propose), 65-105 (approve/re-stage/onApproved)] — the reusable panel (read-only reuse).
- [Source: velara-web src/shared/utils/errors.ts:9-12 (ApiError, no category), 14-20 (getApiCode/getApiMessage), 22-34 (getApiDetails/mapDetailsToFieldErrors — array-shaped details)] — extend with a `details.category` reader.
- [Source: velara-web src/api/skills.ts:140-149 (createVersion), 215-226 (proposeSkillAdapter — omits null entrypoint)] — read-only client layer.
- [Source: velara-web src/features/skills/components/SkillEdit.test.tsx] — 14.3 added +201 lines; extend for the FE ACs following its mocking style.
- [Source: project memory — [[project-story-11-9-review]] (checksum-proof-not-packing-list trap; _find_lockfile_text origin), [[project-story-11-6-review]] (SkillContentEditor / draft-mutable), [[feedback-never-push-subrepos]], [[project-preexisting-ci-failures-fixed]] (api image bakes source / AUTH_BACKEND=dev), [[project-no-emoji-icons]]].

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-07-20 | Story 14.2 drafted (create-story). Full-stack, depends on 14.1 (done). Two small BE seams: (1) surface `EntrypointContractViolationError.category` via `error.details.category` using the existing `_error_response(details=...)` injection — no schema/api-spec change (AC1b, the enabling change the epic's AC1 silently required since `category` isn't on the wire today); (2) deterministic `requirements`-from-lockfile backfill in the shared `_process_bundle` parse step, mirroring 11.9's `_find_lockfile_text`, no-lockfile stays a hard 422, never defaults to `[]` (AC5). FE: lift `readBundleEntrypoint` to a shared util, port the complete `SkillForm` adapter wiring onto `SkillContentEditor` (which today only half-handles it — `MISSING_BUNDLE_MANIFEST` only, `entrypoint={undefined}` hardcoded), gate on `category=="signature"`, pass the real declared entrypoint (AC1/AC2/AC3). Reuses the propose route + `AIAdapterReview` panel verbatim; keeps the paid LLM call on the `RejectNonGrantor`-gated propose route, rejects the inline `?adapt=true` design (AC4, Design A). No migration, no new audit event. Status → ready-for-dev. |
