---
baseline_commit: 058bd69 (velara-api)
---

# Story 11.3: AI Skill Integration Assistant (Propose → Human-Approve, Adapter-Only)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer on-boarding a non-conforming client skill,
I want the platform to analyze it and PROPOSE a standardized adapter + manifest for my review,
so that I don't hand-write a shim — and I stay in control of what registers.

## Acceptance Criteria

1. **AC1 — Propose a diff, never mutate the bundle.**
   **Given** a client skill bundle whose declared entrypoint fails Story 11.2's `validate_entrypoint_contract` (422 `ENTRYPOINT_CONTRACT_VIOLATION`)
   **When** I request AI assistance on that bundle
   **Then** a new service call — reusing `AnthropicProvider.complete()` ([anthropic_client.py:149](../../../velara-api/app/integrations/anthropic_client.py#L149)), **not** a second LLM client — analyzes the entrypoint's actual signature (via `ast`, never import/exec — same posture as `entrypoint_contract.py`), the manifest's declared `params` shape, and the runner's fixed call shape (`func(input_path=…, output_dir=…, params=dict)`, [code_driven_executor.py:135-143](../../../velara-api/app/services/code_driven_executor.py#L135)), and returns a **proposed adapter module source + updated manifest** as a review artifact. This call does **not** invoke `create_skill`/`create_version` — registration stays synchronous, deterministic, and separate. This is the platform's first LLM call on the *registration* path (execution already calls the LLM; register never has).

2. **AC2 — Adapter-only, enforced by checksum, not by prompt discipline.**
   **Given** the proposal response
   **When** it is generated
   **Then** it contains **only** two new files — the adapter module + the manifest — and a `core_files_unchanged` proof: the sha256 of every OTHER bundle member, computed from the bytes handed to the assistant, listed alongside what will be re-verified byte-for-byte at registration. The assistant's writable set is structurally the adapter+manifest pair; there is no code path by which it can return content for any other bundle path.

3. **AC3 — Human approves (optionally edits), then the unchanged register path runs.**
   **Given** the proposal
   **When** I approve it (optionally after editing the adapter source in the review UI)
   **Then** the approved adapter + manifest are added to the bundle's file set and the WHOLE bundle (unchanged core files + new adapter + updated manifest) flows through the existing `POST /skills` (or `POST /skills/{id}/versions`) bundle-registration path unchanged — including Story 11.2's `validate_entrypoint_contract` re-check (the approved adapter must itself conform; a human edit that breaks conformance still 422s `ENTRYPOINT_CONTRACT_VIOLATION`, same as any other non-conforming bundle)
   **and Given** I reject the proposal
   **When** I decline
   **Then** nothing registers — no service call reaches `create_skill`/`create_version`.

4. **AC4 — AI-adapted skills are not exempt from certification.**
   **Given** a skill whose current version's manifest carries `ai_adapted: true` (set when a version was created from an approved AI proposal)
   **When** it is advanced toward `client_ready`
   **Then** `certification_service.assert_certified_for_client_ready` ([skill_service.py:509-514](../../../velara-api/app/services/skill_service.py#L509)) gates it exactly as today — two-key technical + methodological certification, unchanged code path, no new bypass.

5. **AC5 — Reproduces the real reference case.**
   **Given** the `velara-protocol-extractor` reference case — entrypoint `velara_extractor.plugin:run(input_path, output_dir=None, *, model=None, consensus_runs=1, enrich=False, emit_excel=True, …)` (named kwargs, non-conforming) vs. the canonical `run(input_path, output_dir, params: dict)`
   **When** the assistant is run against a bundle built from it
   **Then** the proposed adapter is a `params`-dict → named-kwargs translation semantically equivalent to the hand-written 5.5.6 adapter (`velara_extractor.adapter:run`, [test_adapter_shim.py](../../../velara-api/tests/unit/services/test_adapter_shim.py)) — same behavioral contract, not just a passing signature: known `params` keys (`model`, `consensus_runs`, `enrich`, `emit_excel`) are forwarded as named kwargs WITH type coercion (`str()`/`int()`/`bool()` respectively); `model=None` is omitted from kwargs rather than forwarded as `None` (lets the plugin's own default apply); the platform-injected `input_paths` key is silently dropped, never forwarded; unknown `params` keys are silently dropped, never raised as errors; `params={}`/`params=None` calls the plugin with only `(input_path, output_dir=output_dir)`. Exact source text need not match; conformance (passes `validate_entrypoint_contract`) AND this behavioral equivalence (Task 6's golden test) are both the bar.

6. **AC6 — Token spend is attributable, not billed silently.**
   **Given** a propose-flow LLM call (success or failure)
   **When** it completes
   **Then** its `input_tokens`/`output_tokens`/`model` are recorded via `audit_service.record_admin_action` ([skill_service.py:931](../../../velara-api/app/services/skill_service.py#L931)) under a new `admin.*`-class event type — best-effort, after the response is built, never blocking the propose response on an audit-write failure (mirrors the existing `try/except` + `logger.warning` pattern at [skill_service.py:923-946](../../../velara-api/app/services/skill_service.py#L923)).

## Tasks / Subtasks

> **Scope locked at story creation (from the epic ADR — do not re-litigate):**
> **(S1)** Reuse `AnthropicProvider.complete(system=, user_content=, max_tokens=)` — the exact seam `execution_service._run_prompt_hybrid` already uses ([execution_service.py:465-469](../../../velara-api/app/services/execution_service.py#L465)). No new LLM client, no tool-use loop, no multi-turn agent (per the ADR's "boring technology" reasoning) — single-shot completion.
> **(S2)** The propose call is synchronous within the request (not a Celery job) — matches "registration is otherwise synchronous today" and the epic's Open Question is resolved this way for the story: no async job queue for this call. If p95 latency testing during dev shows this is untenable, flag it in Completion Notes rather than silently switching to async.
> **(S3)** The assistant NEVER calls `create_skill`/`create_version`/any mutating service function. It is a pure `bundle files in → proposal out` function. Registration (approve step) reuses the **existing unmodified** bundle-registration path — do not fork a second registration code path for AI-adapted bundles.
> **(S4)** Model: reuse `settings.ANTHROPIC_MODEL` (currently `claude-opus-4-8`, [config.py:196](../../../velara-api/app/core/config.py#L196)) via the existing `get_llm_provider()` factory ([anthropic_client.py:238-247](../../../velara-api/app/integrations/anthropic_client.py#L238)) — do NOT introduce a second model config value. This is a single-shot structured code-generation task (signature analysis → adapter source), well within what the existing model/seam handles for prompt-hybrid skill execution today.
> **(S5)** Backend-only for the propose/analyze logic; a minimal FE review screen (diff view + approve/reject) is required per AC3 but keep it a new, isolated feature slice — do not touch `SkillForm`/`SkillBundleUpload` internals beyond adding an entry point.

- [ ] **Task 1 — New service module `app/services/skill_integration_assistant.py` (AC1, AC2)**
  - [ ] `propose_adapter(*, llm_provider: LLMProvider, files: list[tuple[str, bytes]], entrypoint: str, manifest: CodeDrivenHybridManifest) -> AdapterProposal` — pure function, no DB/session/storage args (keeps it trivially unit-testable and structurally incapable of writing anything).
  - [ ] Reuse `resolve_entrypoint_module` + the AST-based signature extraction helpers from [entrypoint_contract.py](../../../velara-api/app/services/entrypoint_contract.py) to build a **structured description** of the non-conforming signature (parameter names, kinds, defaults — the same `inspect.Signature`-shaped data `validate_entrypoint_contract` already reconstructs) — do NOT hand raw source bytes to the prompt beyond the single entrypoint module (IP discipline: minimize what leaves the trust boundary in the prompt; the assistant needs the module's signature and body to write a correct wrapper, not the whole bundle).
  - [ ] Compute `core_files_unchanged`: `{path: sha256_hex}` for every bundle member **except** the entrypoint module and manifest, computed from the exact bytes passed in (reuse the sha256 pattern from `_compute_bundle_record`, [skill_service.py:347-350](../../../velara-api/app/services/skill_service.py#L347) — thread-pool it, hashing is CPU-bound).
  - [ ] Build the prompt: `system` states the canonical contract, the adapter-only constraint, and the required output shape; `user_content` carries the entrypoint module's source + its parsed signature + the manifest's current `entrypoint`/`requirements` fields. Call `llm_provider.complete(system=..., user_content=..., max_tokens=<generous, e.g. 4096>)` — a single call, no loop.
  - [ ] Define `AdapterProposal` (dataclass or Pydantic model): `adapter_path: str`, `adapter_source: str`, `updated_manifest: dict`, `core_files_unchanged: dict[str, str]`, `llm_input_tokens: int`, `llm_output_tokens: int`, `llm_model: str`, `llm_stop_reason: str | None`.
  - [ ] Parse the LLM's response deterministically: instruct it (in the system prompt) to return the adapter source and manifest patch in a fenced, clearly-delimited format (e.g. two labeled code fences) — do NOT use `output_config.format` / structured-outputs JSON schema here, since the payload includes a full Python source file as one field (schema-constrained JSON around a large free-text code blob adds fragility without benefit for a single string-heavy field). Fail closed: if parsing the response into `adapter_path`/`adapter_source`/`updated_manifest` fails, raise a typed `AdapterProposalParseError` (500-mapped or surfaced as a clear "assistant response could not be parsed, try again" — do not half-apply a malformed proposal).
  - [ ] **Validate the proposal before returning it**: run `validate_entrypoint_contract` (or equivalent AST checks) against the proposed adapter source using the SAME static-analysis-only posture as registration — if the AI's own proposal doesn't conform, surface that as a distinct outcome (`proposal_non_conforming: true` + the violation detail) rather than silently returning a broken proposal as if it were good. This is a pre-flight sanity check, not a security boundary (the human + registration re-check are the boundary).

- [ ] **Task 2 — New API endpoint `POST /api/v1/skills/integration-assistant/propose` (AC1, AC2, AC6)**
  - [ ] Add to [skills.py](../../../velara-api/app/api/v1/skills.py) under the existing `router`. **Role-gate decision (verified, not assumed):** the router applies only `RejectClient` ([skills.py:37](../../../velara-api/app/api/v1/skills.py#L37)) — `create_skill`/`presign_bundle`/`create_version` have NO stricter per-route gate, so today `consultant` (an internal, non-grantor role) can already register skills. This story's endpoint has a REAL cost per call (an LLM completion) that the other bundle routes don't — apply `dependencies=[RejectNonGrantor]` (the `_GRANTOR_ROLES = {admin, ma_tech}` primitive, [dependencies.py:117](../../../velara-api/app/core/dependencies.py#L117), same one `access_service`/`users.py` already use) to THIS route specifically, restricting the propose call to admin/ma_tech. Do not silently widen this to match the looser existing routes, and do not silently narrow the existing routes to match this one — this is a scoped, additive gate on the new endpoint only.
  - [ ] Request body: reuses the SAME staged-bundle-key flow as `create_skill`'s `bundle_key` ([skills.py:73-76](../../../velara-api/app/api/v1/skills.py#L73)) — `{bundle_key: str, entrypoint: str}`. Do NOT invent a second upload mechanism; the propose step reads from the same `bundle-staging/{org}/` prefix via `skill_service.fetch_staged_bundle` (reuse, don't fork) and does **not** delete the staged object (the approve step in Task 3 still needs it).
  - [ ] Extract the ZIP's member list via [bundle_extractor.extract_bundle](../../../velara-api/app/services/bundle_extractor.py) (same function `_process_bundle` uses) to get `files: list[tuple[str, bytes]]`, then call `skill_integration_assistant.propose_adapter(...)`.
  - [ ] Response: `ResponseEnvelope[AdapterProposalResponse]` — `adapter_path`, `adapter_source`, `updated_manifest`, `core_files_unchanged` (paths + checksums, for the review UI to render "unchanged" proof), `proposal_non_conforming` + detail if the pre-flight check failed.
  - [ ] Record the admin audit event here (AC6): new `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED = "admin.skill_adapter_proposed"` in [audit.py](../../../velara-api/app/models/audit.py) (alongside the existing `EVENT_ADMIN_*` constants, [audit.py:45-55](../../../velara-api/app/models/audit.py#L45)), written via `audit_service.record_admin_action(session=, event_type=EVENT_ADMIN_SKILL_ADAPTER_PROPOSED, user_id=user.user_id, org_id=user.org_id, hierarchy_path="org", metadata={"llm_model":…, "input_tokens":…, "output_tokens":…, "stop_reason":…, "proposal_non_conforming":…})` — best-effort try/except, never block the response.

- [ ] **Task 3 — Approve flow reuses the existing bundle-registration path unchanged (AC3)**
  - [ ] No new registration code path. The FE review screen, on approve, constructs a NEW in-memory ZIP (staged bundle's unchanged core files + the — possibly human-edited — adapter source + updated manifest) and re-uploads it through the EXISTING presign → `PUT` → `create_skill`/`create_version` `bundle_key` flow ([skills.py:108-138](../../../velara-api/app/api/v1/skills.py#L108) presign, then [skills.py:55-102](../../../velara-api/app/api/v1/skills.py#L55) create). This guarantees Story 11.2's registration-time `validate_entrypoint_contract` re-check applies to the approved artifact exactly as it would to any other bundle — no special-cased trust for AI-authored content (AC3's "unchanged register path" requirement is satisfied *by construction*, not by a new bypass-aware branch).
  - [ ] On successful registration from an AI-approved proposal, set `ai_adapted: true` in the manifest's metadata (a NEW optional manifest field, additive — [code_driven_hybrid.py](../../../velara-api/app/services/code_driven_hybrid.py)'s `CodeDrivenHybridManifest`/`parse_code_driven_manifest` must accept and pass through this field; it is informational only, read by AC4's certification gate check and any future FE badge — it does NOT change registration/execution behavior). Confirm `parse_code_driven_manifest`'s validation does not reject an unrecognized-but-declared optional field before adding it (extend rather than special-case).
  - [ ] Backend: no new endpoint needed for "approve" itself — it IS the existing create/version endpoint, called by the FE with the assembled bundle. Do not add a redundant `/approve` endpoint that re-implements registration.

- [ ] **Task 4 — Certification gate confirmation (AC4)**
  - [ ] No code change expected: `assert_certified_for_client_ready` ([skill_service.py:509-514](../../../velara-api/app/services/skill_service.py#L509)) already gates ALL lifecycle transitions toward `client_ready` regardless of how the version was authored. Add an integration test that registers an AI-adapted skill (via the Task 3 flow) and asserts the SAME 403/422 gate fires on an uncertified `client_ready` transition attempt as for any hand-registered skill — this is a regression-proof, not new logic.

- [ ] **Task 5 — FE review screen (AC3) — new, isolated feature slice**
  - [ ] NEW `src/features/skills/components/AIAdapterReview.tsx` (or similar) — a new component, not a rewrite of `SkillForm.tsx`. **Entry point verified**: the `ENTRYPOINT_CONTRACT_VIOLATION` 422 surfaces through `SkillForm.tsx`'s `error` prop (passed from `SkillCreate.tsx`'s `useCreateSkill()` mutation), NOT through `SkillBundleUpload.tsx` — the upload component's own `phase.error` ([SkillBundleUpload.tsx:47](../../../velara-web/src/features/skills/components/SkillBundleUpload.tsx#L47)) only covers presign/PUT failures, which happen BEFORE the bundle is ever registered; the entrypoint-contract check runs later, inside `create_skill`, when `SkillForm` submits. `SkillForm.tsx:189-192` already destructures `apiCode = error?.response?.data?.error?.code` inline — reuse the shared `getApiCode(err)` helper from `src/shared/utils/errors.ts:14-16` (the canonical version of that same extraction) rather than duplicating the inline destructuring, and add the "AI-adapt this skill" affordance to `SkillForm`'s error-rendering path, conditioned on `apiCode === 'ENTRYPOINT_CONTRACT_VIOLATION'`.
  - [ ] Screen shows: the proposed adapter source (read-only or editable code view), the updated manifest diff, and the `core_files_unchanged` checksum list (labeled clearly as "unchanged — not modified by AI"). Approve → assembles the new ZIP client-side (unchanged core file bytes the user already has from the original upload + adapter + manifest) and re-runs the existing presign+upload+register flow (Task 3). Reject → discards the proposal, no API call.
  - [ ] NEW FE API client function `proposeSkillAdapter(bundleKey, entrypoint)` calling `POST /api/v1/skills/integration-assistant/propose` — follow the existing skills API client module's conventions (same file/pattern as the `createVersion`/bundle-upload clients added in 11.1).

- [ ] **Task 6 — Tests (AC: all)**
  - [ ] **Unit `tests/unit/services/test_skill_integration_assistant.py` (NEW)** — mock `LLMProvider` (the existing `FakeLLMProvider` test double, per [anthropic_client.py:64](../../../velara-api/app/integrations/anthropic_client.py#L64) "unit tests inject a FakeLLMProvider — never import the concrete class"): conforming proposal parses correctly into `AdapterProposal`; malformed/unparseable LLM response → `AdapterProposalParseError`; proposal whose adapter fails the pre-flight `validate_entrypoint_contract` check → `proposal_non_conforming=True` with detail, not silently accepted; `core_files_unchanged` checksums match the input bytes exactly (never touches/reads the entrypoint-module or manifest paths as "unchanged"); the assistant is never handed a way to return content for a path outside `{adapter_path, manifest}` — assert the response schema structurally excludes it.
  - [ ] **Unit — reference case (golden test)**: build a fixture matching the real `velara_extractor.plugin:run(input_path, output_dir=None, *, model=None, consensus_runs=1, enrich=False, emit_excel=True)` non-conforming signature as input to `propose_adapter`, with a `FakeLLMProvider` seeded to return a realistic adapter matching [test_adapter_shim.py](../../../velara-api/tests/unit/services/test_adapter_shim.py)'s `_make_adapter` shape; assert (a) the returned adapter, run through `validate_entrypoint_contract`, PASSES, and (b) executing the returned adapter source against the SAME test matrix as `test_adapter_shim.py` (all-named-params-forwarded-with-coercion, `input_paths`-dropped, empty/None-params, string-to-int coercion, `model=None`-omitted, unknown-keys-dropped) produces identical call behavior — this is AC5's real acceptance bar, not just "it parses."
  - [ ] **Integration `tests/integration/api/test_skills.py` (EXTEND)** — `POST .../propose` with a staged non-conforming bundle → 200 with a proposal body (LLM mocked via dependency override, not a live API call in CI); staged bundle missing/expired key → reuses `fetch_staged_bundle`'s existing 422 (no new error path to test, just confirm passthrough); approve-flow integration test: assemble a bundle from an approved (fixture) proposal and POST to the existing `create_skill` bundle path → 201, manifest carries `ai_adapted: true`, and a subsequent registration-time `validate_entrypoint_contract` still runs (prove no bypass — feed an intentionally-broken "approved" adapter and confirm it still 422s `ENTRYPOINT_CONTRACT_VIOLATION`, same as any bundle).
  - [ ] **Integration — certification gate (AC4)**: register an AI-adapted skill (manifest `ai_adapted: true`), attempt `client_ready` transition without certification → same 403/422 as the existing uncertified-transition test for a hand-registered skill (mirror an existing certification-gate test, don't write bespoke assertions).
  - [ ] **Audit (AC6)**: after a propose call, assert an `admin.skill_adapter_proposed` `AuditLogEntry` row exists with `metadata.input_tokens`/`output_tokens`/`model` populated; assert a propose call still returns 200 to the caller even when the audit write is forced to fail (patch `audit_service.record_admin_action` to raise) — mirrors the existing best-effort pattern's own test coverage for `EVENT_ADMIN_LIFECYCLE_TRANSITION`.
  - [ ] **FE `AIAdapterReview.test.tsx` (NEW)**: renders proposal data; approve triggers the assembled-bundle re-upload flow (mock the API client); reject makes no API call.
  - [ ] **FE `SkillForm.test.tsx` (EXTEND)**: the "AI-adapt this skill" affordance appears ONLY when `apiCode === 'ENTRYPOINT_CONTRACT_VIOLATION'` on the create/version mutation error, not on other bundle-registration error codes (`INVALID_BUNDLE`, `INVALID_CODE_DRIVEN_MANIFEST`, `HYBRID_SHAPE_MISMATCH`, etc.) and not on a plain inline-content validation error.

- [ ] **Task 7 — Gates**
  - [ ] `ruff check .` clean. Rebuild the api image (`docker compose build api`) then full suite in-container: `docker compose run --rm -e AUTH_BACKEND=dev api python -m pytest` — baseline is 11.2's post-review number (1190 passed in-container, +12 from 11.2's own patches; only the 3 known pre-existing `test_ingest.py` MinIO-in-container failures acceptable). Expect the new test files to add to this count, not regress it.
  - [ ] `AUTH_BACKEND=dev .venv/bin/python scripts/export_openapi.py` on the host — expect a diff this time (unlike 11.2): ONE new endpoint (`POST /api/v1/skills/integration-assistant/propose`) + its response schema. No OTHER endpoint/schema changes — if the diff shows anything beyond that, investigate before committing.
  - [ ] FE: `npm run typecheck` / `npm run lint` / `npm run test` (vitest) clean — baseline after 11.2 (backend-only) is unchanged from 11.1's FE baseline: typecheck 0, lint 1 pre-existing `Icon.tsx` warning, vitest 595 + new tests from this story.
  - [ ] No migration expected (manifest's `ai_adapted` field lives in the existing JSON manifest blob stored as part of the bundle artifact, not a new DB column — confirm no schema change is introduced; if a migration seems necessary, stop and re-read the ADR's "changes no prior decision" framing before adding one).

## Dev Notes

### Why this story is bounded the way it is

The ADR (`core-architectural-decisions.md` § "AI Skill Integration Assistant") draws four hard lines this story must respect:

1. **Registration stays LLM-free and deterministic.** The propose call is a SEPARATE, read-only analysis step — it never calls `create_skill`. The approve step is just a human handing the (possibly-edited) proposal back through the SAME unmodified registration path 11.1/11.2 already built and hardened. If you find yourself writing a new "register with AI adapter" code path, stop — that's the ADR's rejected shape.
2. **Adapter-only is mechanical, not a prompt instruction.** "Core files unchanged" is proven by checksum comparison the review UI can show a human, not by trusting the LLM to behave. `propose_adapter`'s signature (files in → proposal out, no DB/storage access) makes it structurally impossible for the function to persist anything, let alone mutate a core file.
3. **Human-approve gate + unchanged certification.** Two independent gates (human at registration, two humans at certification) — this story adds NEITHER a new certification bypass NOR a new "trust the AI" fast path. AC4 is a regression test, not new logic, because the ADR's whole point is that nothing here needs to change in certification.
4. **Boring technology.** Single `complete()` call, no tool-use loop, no agent. If the task ever needs the assistant to *execute* the skill to verify its own proposal, that is explicitly scoped as a DIFFERENT future story behind the same propose→approve gate (ADR: "a materially different capability").

### The exact LLM call shape to reuse (verified against the code)

`execution_service._run_prompt_hybrid` ([execution_service.py:465-469](../../../velara-api/app/services/execution_service.py#L465)) is the direct precedent:

```python
result = llm_provider.complete(
    system=system_text,
    user_content=user_content,
    max_tokens=settings.ANTHROPIC_MAX_TOKENS,
)
```

`AnthropicProvider.complete()` ([anthropic_client.py:149-186](../../../velara-api/app/integrations/anthropic_client.py#L149)) calls `self._client.messages.create(model=self._model, max_tokens=…, system=…, messages=[{"role":"user","content":…}])` — **never pass `temperature`/`top_p`/`top_k`/`budget_tokens`, they 400 on Opus 4.x** (explicit comment at [anthropic_client.py:161-162](../../../velara-api/app/integrations/anthropic_client.py#L161)). `model` comes from `settings.ANTHROPIC_MODEL` = `"claude-opus-4-8"` ([config.py:196](../../../velara-api/app/core/config.py#L196)) via the cached `get_llm_provider()` factory — this IS the current Opus 4.8 model ID and needs no change for this story. Get the provider the same way execution does (constructor injection / `Depends`, not a fresh `get_llm_provider()` call buried in the service — check how `execution_service`'s callers thread `llm_provider` through and mirror it, likely via a FastAPI dependency in the new endpoint).

`LLMResult` gives you `.text`, `.input_tokens`, `.output_tokens`, `.model`, `.stop_reason` — everything Task 2's audit write needs, no extra plumbing.

**Do not use `output_config.format` / JSON-schema structured outputs for the adapter-source field.** The payload is a full Python source file (a large free-text blob) plus a manifest patch — constraining that through strict JSON schema adds fragility (large strings inside JSON escaping, schema-compile overhead) without the benefit structured outputs gives for short structured fields. Use a clearly-delimited fenced-block instruction in the system prompt and parse deterministically; fail closed (typed error) if parsing fails, per Task 1.

### Static-analysis-only posture carries over from 11.2 — do not import/exec

The entrypoint module being analyzed is UNTRUSTED, client-supplied code — exactly the posture `entrypoint_contract.py`'s module docstring establishes and `bundle_extractor.py` enforces. The propose step must extract the module's signature via `ast.parse` (reuse `resolve_entrypoint_module` + the AST-walking helpers already in `entrypoint_contract.py`) and hand that + the raw source text to the LLM as **prompt content**, never by importing/executing the module in the API process to introspect it. This is the same class of hole 11.1's/11.2's reviews hunted for — do not reopen it here by taking a shortcut (e.g. `importlib` + `inspect.signature`) that looks simpler.

### Reuse map — do NOT reinvent

| Need | Reuse |
|---|---|
| Bundle member extraction | `bundle_extractor.extract_bundle` ([bundle_extractor.py](../../../velara-api/app/services/bundle_extractor.py)) — same function `_process_bundle` calls |
| Staged bundle fetch | `skill_service.fetch_staged_bundle` ([skill_service.py](../../../velara-api/app/services/skill_service.py)) — same as `create_skill`'s `bundle_key` path ([skills.py:73-76](../../../velara-api/app/api/v1/skills.py#L73)) |
| Entrypoint signature extraction | `resolve_entrypoint_module` + AST-arg walking from [entrypoint_contract.py](../../../velara-api/app/services/entrypoint_contract.py) — do NOT write a second signature-parsing implementation |
| Pre-flight conformance check on the proposal | `validate_entrypoint_contract` ([entrypoint_contract.py:138](../../../velara-api/app/services/entrypoint_contract.py#L138)) — run it against the proposed adapter before returning the proposal |
| Bundle checksum computation | The sha256 pattern in `_compute_bundle_record` ([skill_service.py:347-350](../../../velara-api/app/services/skill_service.py#L347)) — thread-pool it |
| LLM call | `AnthropicProvider.complete()` via `get_llm_provider()` ([anthropic_client.py](../../../velara-api/app/integrations/anthropic_client.py)) — the SAME seam, not a new client |
| LLM test double | `FakeLLMProvider` (existing — [anthropic_client.py:64](../../../velara-api/app/integrations/anthropic_client.py#L64) docstring references it; find its actual test-fixture location and reuse) |
| Admin audit event write | `audit_service.record_admin_action` ([skill_service.py:931](../../../velara-api/app/services/skill_service.py#L931)) — best-effort try/except pattern, mirror exactly |
| Registration/re-registration path | The EXISTING `POST /skills` / `POST /skills/{id}/versions` bundle-registration endpoints, unmodified — the approve step is a client of these, not a new implementation |
| Manifest parsing | `parse_code_driven_manifest` / `CodeDrivenHybridManifest` ([code_driven_hybrid.py](../../../velara-api/app/services/code_driven_hybrid.py)) — extend to accept the optional `ai_adapted` field, don't fork |
| FE inline-error hook point | `apiCode`/`getApiCode` extraction already wired into [SkillForm.tsx:189-192](../../../velara-web/src/features/skills/components/SkillForm.tsx#L189) — gate the new affordance on `apiCode === 'ENTRYPOINT_CONTRACT_VIOLATION'` there, not in `SkillBundleUpload.tsx` |
| FE bundle re-upload flow | The existing presign → PUT → create/version client functions added in 11.1 — reuse for the approve step's re-upload, don't duplicate |

### Error-code map (unchanged by this story — for context)

| Code | Meaning | Introduced |
|---|---|---|
| `INVALID_BUNDLE` | ZIP structurally bad | 11.1 |
| `INVALID_CODE_DRIVEN_MANIFEST` | manifest field missing/invalid | 5.5.1 |
| `ENTRYPOINT_CONTRACT_VIOLATION` | code doesn't fit the contract — **the trigger signal for this story's FE affordance** | 11.2 |
| `HYBRID_SHAPE_MISMATCH` | code-driven ↔ LLM-driven swap across versions | 5.5.1 |
| `CODE_DRIVEN_EXECUTION_ERROR` | run-time execution failure | 5.5.3 |

This story introduces no new stable error code on the registration path — the propose endpoint's own failure modes (LLM call failure, unparseable response) map to existing generic error handling (5xx / typed `AdapterProposalParseError`), since they are advisory-step failures, not registration rejections.

### IP / PHI discipline (house invariants — apply here too)

- Never log the entrypoint module's source, the LLM prompt/response content, or the adapter source text — only IDs, model, token counts, outcome (mirrors `anthropic_client.py`'s existing PHI discipline comments at every call site).
- The `core_files_unchanged` proof surfaces PATHS and CHECKSUMS to the review UI, never file bytes/content — same "name the location, never the content" discipline as `entrypoint_contract.py`'s violation messages.
- The propose endpoint reads from the SAME `bundle-staging/{org}/` org-scoped prefix validation `create_skill`/`presign_bundle` already enforce — do not add a second, less-guarded read path to staged bundles.

### Sequencing / dependencies

- **Fourth story of Epic 11** in the recommended order (11.1 ✅ → 11.2 ✅ → 11.6 → **11.3**). Per the epic's dependency table, 11.3 depends on 11.1 (bundle upload) and 11.2 (the `ENTRYPOINT_CONTRACT_VIOLATION` trigger signal + `resolve_entrypoint_module`/AST plumbing it reuses) — both are done. **Note:** Story 11.6 (UI-authored versioning, draft-mutable content) is NOT yet done per the recommended order, but nothing in 11.3 requires it — the propose/approve flow operates on the existing immutable create/version bundle path, not the draft-mutation path. If 11.6 lands first, no conflict is expected (11.3 doesn't touch `update_draft_content`).
- **Downstream consumers:** 11.6 (author new versions from UI) may eventually offer "AI-adapt" as an option during draft ZIP re-upload — out of scope for this story; keep `skill_integration_assistant.py` a standalone module with no draft-state assumptions baked in, so 11.6 can call it later without rework.
- Epic 11 already `in-progress`; this is not the first story in the epic, so no epic-status update is needed.

### Project Structure Notes

- **velara-api:** NEW `app/services/skill_integration_assistant.py`; NEW `tests/unit/services/test_skill_integration_assistant.py`; MODIFY `app/api/v1/skills.py` (new `POST .../integration-assistant/propose` endpoint + response schema), `app/models/audit.py` (new `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED` constant), `app/services/code_driven_hybrid.py` (accept optional `ai_adapted` manifest field); EXTEND `tests/integration/api/test_skills.py`.
- **velara-web:** NEW `src/features/skills/components/AIAdapterReview.tsx` + `.test.tsx`; MODIFY the skills feature's API client module (new `proposeSkillAdapter` function) and `SkillForm.tsx` (minimal: offer the AI-adapt affordance when `apiCode === 'ENTRYPOINT_CONTRACT_VIOLATION'` — do not otherwise restructure this component; prefer importing `getApiCode` from `src/shared/utils/errors.ts` over the file's existing inline destructuring).
- No migration (manifest field lives in the existing artifact-stored JSON manifest, not a DB column). `api-spec.json` WILL show a diff this story (new endpoint) — this is expected, unlike 11.2.

### References

- [Source: epics/epic-11-ai-assisted-skill-integration-and-promotion.md#Story-11.3] — story ACs, sequencing, ADR gating, the `velara-protocol-extractor` acceptance anchor.
- [Source: planning-artifacts/architecture/core-architectural-decisions.md#AI-Skill-Integration-Assistant] — the four hard boundaries (standardize-first, propose-not-mutate, adapter-only-by-checksum, human+certification double-gate), why `AnthropicProvider.complete` and not a new client, cost/audit attribution note, revisit trigger.
- [Source: _bmad-output/implementation-artifacts/stories/11-2-standardized-entrypoint-contract-and-registration-validation.md] — `ENTRYPOINT_CONTRACT_VIOLATION` is explicitly documented there as "load-bearing for Story 11.3" (never rename); the static-analysis-only posture; `resolve_entrypoint_module` shared-helper discipline; in-container test recipe; gates baseline (1190 passed, ruff clean, api-spec.json current).
- [Source: _bmad-output/implementation-artifacts/stories/11-1-multi-file-zip-bundle-upload-and-extraction.md] — bundle storage model (`artifact_key`/`artifact_checksum`/`artifact_set`), staged-bundle presign/upload/create flow, FE bundle upload component + inline-error pattern, adversarial-review posture (IDOR precedent — treat all bundle inputs as untrusted).
- [Source: velara-api app/integrations/anthropic_client.py] — `LLMProvider` protocol, `AnthropicProvider.complete()`/`create_message()`, `get_llm_provider()` factory, PHI-never-log discipline, the "no temperature/top_p/top_k/budget_tokens" 400 guard.
- [Source: velara-api app/services/execution_service.py:385-490] — `_run_prompt_hybrid`, the direct precedent for calling `llm_provider.complete()` and recording token usage in metadata/logs.
- [Source: velara-api app/services/entrypoint_contract.py] — `resolve_entrypoint_module`, `validate_entrypoint_contract`, `EntrypointContractViolationError`, the AST-only/never-import security posture, `_signature_from_ast`/`_describe_bind_failure` helpers to reuse for signature description.
- [Source: velara-api app/services/skill_service.py:509-514,915-948] — `assert_certified_for_client_ready` gate (unchanged, AC4's regression anchor); `audit_service.record_admin_action` best-effort call pattern to mirror for AC6.
- [Source: velara-api app/models/audit.py] — existing `EVENT_ADMIN_*` constant family (`admin.grant_created`, `admin.lifecycle_transition`, `admin.certification`, `admin.user_provisioned`, etc.) — the new `admin.skill_adapter_proposed` constant follows this established naming convention.
- [Source: velara-api app/api/v1/skills.py:50-138] — `create_skill`, `presign_bundle` — the exact staged-bundle-key flow the propose endpoint and the approve re-upload both reuse.
- [Source: velara-api tests/unit/services/test_adapter_shim.py] — the hand-written 5.5.6 adapter (`velara_extractor.adapter:run`), the conformance witness AC5's test fixture should shape-match.
- [Source: velara-web src/features/skills/components/SkillForm.tsx:189-192] — `apiCode`/`apiMessage`/`apiFieldErrors` extraction from the create/version mutation error; the real hook point for the new "AI-adapt" affordance on `ENTRYPOINT_CONTRACT_VIOLATION` (NOT `SkillBundleUpload.tsx`, whose own error phase only covers presign/PUT failures that happen before registration).
- [Source: velara-web src/shared/utils/errors.ts:14-16] — `getApiCode(err)`, the canonical helper `SkillForm.tsx` should use (in place of its existing inline destructuring) to gate the new affordance.
- [Source: velara-api tests/unit/services/test_adapter_shim.py:15-125] — exact hand-written adapter behavior: per-key type coercion (`str`/`int`/`bool`), `model=None` omission, `input_paths` silent drop, unknown-key silent drop, empty/None-params positional-only call — the full behavioral matrix AC5's golden test must match.
- [Source: project memory — Epic 9 Stories Reference (audit token tracking under `admin.*`-class events); Client Skill Contract (the real `velara-protocol-extractor`'s named-kwargs entrypoint is the concrete non-conforming case); Story 12.1 Review (nested-repo cwd discipline — velara-api/velara-web are separate git repos from the top-level docs repo)].

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
