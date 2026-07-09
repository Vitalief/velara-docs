---
baseline_commit: 1fdf2d6 (velara-api) / 179251d (velara-web)
---

# Story 11.9: AI-Assisted Manifest Generation for Unmanifested Client Bundles

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer on-boarding a client-provided skill that ships with **no Velara-shaped `manifest.json` at all**,
I want the platform to detect the missing manifest and PROPOSE a schema-valid `manifest.json` — alongside the adapter, in the SAME review Story 11.3 introduced — so I can upload the client's bundle as-is,
so that on-boarding a raw client deliverable does not require a developer to hand-author manifest JSON before the AI-assist flow can even engage.

## Acceptance Criteria

1. **AC1 — A distinct, stable error code for the missing-manifest case (the FE trigger).**
   **Given** a bundle that contains skill code but **no `manifest.json`** at any recognized location (bundle-root or single-root-wrapped `*/manifest.json`, per `bundle_extractor.find_manifest_path` — [bundle_extractor.py:250-289](../../../velara-api/app/services/bundle_extractor.py#L250))
   **When** I attempt to register it (`POST /skills` or `POST /skills/{id}/versions`, bundle branch)
   **Then** registration fails with a **new, distinct, stable error code** — `MISSING_BUNDLE_MANIFEST` (422) — that is *separate* from `INVALID_CODE_DRIVEN_MANIFEST` (which means a manifest is present but malformed). Today the two are conflated: `_process_bundle` substitutes an empty `b"{}"` for a missing manifest and lets `parse_code_driven_manifest` raise `INVALID_CODE_DRIVEN_MANIFEST "missing required field 'entrypoint'"` ([skill_service.py:383-390](../../../velara-api/app/services/skill_service.py#L383)). This AC splits them. This new code is the trigger signal for this story's FE affordance, exactly the way `ENTRYPOINT_CONTRACT_VIOLATION` is Story 11.3's.

2. **AC2 — The FE reuses the SAME 11.3 review panel — a second entry point, not a second UI.**
   **Given** that missing-manifest registration failure surfaced through `SkillForm`'s create/version mutation error (`apiCode === 'MISSING_BUNDLE_MANIFEST'`)
   **When** the FE surfaces it
   **Then** the SAME `AIAdapterReview` panel introduced in Story 11.3 is offered — one review surface, two entry points (`ENTRYPOINT_CONTRACT_VIOLATION` from 11.3, `MISSING_BUNDLE_MANIFEST` from this story). No second, parallel review component. Because there is no manifest, the FE must NOT require a client-side-readable entrypoint to open the panel (11.3's `readBundleEntrypoint` returns `null` for an unmanifested bundle — [SkillForm.tsx:11-28](../../../velara-web/src/features/skills/components/SkillForm.tsx#L11)).

3. **AC3 — Propose a schema-valid manifest; infer ONLY entrypoint + requirements; output_schema is a human-fill stub.**
   **Given** I request AI assistance on an unmanifested bundle
   **When** the propose call runs
   **Then** the assistant proposes a **schema-valid `manifest.json`** in which:
   - `entrypoint` is **inferred**: the LLM proposes a candidate `module:callable` from the bundle's code, and that candidate is **validated by the existing `resolve_entrypoint_module` static analysis** (never importing/executing the untrusted bundle — [entrypoint_contract.py:80-128](../../../velara-api/app/services/entrypoint_contract.py#L80)). A candidate that does not resolve to a real module in the bundle is rejected (fail-closed), not emitted.
   - `requirements` is the bundle's **lockfile text embedded verbatim** (the assistant locates the lockfile member among the bundle files — `requirements.txt` at bundle-root or single-root-wrapped — and reads it byte-for-byte; mirrors `scaffold_manifest.py`'s embed-verbatim logic, [scaffold_manifest.py:107-111](../../../velara-api/scripts/scaffold_manifest.py#L107)).
   - `output_schema` is an **explicitly-labeled human-fill stub** (`_STUB_OUTPUT_SCHEMA` shape — `{"type":"object","description":"STUB — ... Replace with the real output shape before this skill reaches client_ready."}`, [scaffold_manifest.py:53-60](../../../velara-api/scripts/scaffold_manifest.py#L53)) and `schema_version` a **default** (`"0.1.0"`).
   The AI does **NOT** author the output contract — no whole-bundle return-type analysis. This preserves 11.3's minimal-trust / IP-discipline boundary. This mechanically promotes `scripts/scaffold_manifest.py` into the in-app propose flow.

4. **AC4 — If the inferred entrypoint is itself non-conforming, propose the adapter in the SAME pass.**
   **Given** the inferred/validated entrypoint
   **When** the propose call builds the proposal
   **Then** if that entrypoint does **not** conform to the Story 11.2 contract (`run(input_path, output_dir, params: dict)` per `validate_entrypoint_contract`), the assistant ALSO proposes the `params`-dict → named-kwargs adapter in the same pass (exactly the 11.3 behavior), and the review shows the proposed manifest **+** (optional) adapter together. If the inferred entrypoint already conforms, the proposal is manifest-only (no adapter needed) and the manifest's `entrypoint` points at the client's own callable.

5. **AC5 — Adapter-only, checksum-proven; the AI authors ONLY the manifest and (if needed) the adapter.**
   **Given** the proposed manifest + (optional) adapter
   **When** I review them
   **Then** the same "core files byte-for-byte unchanged, checksum-proven" guarantee from Story 11.3 holds — `core_files_unchanged` lists the sha256 of every OTHER bundle member (everything except the manifest and, if an adapter was proposed, the adapter/entrypoint module). Every other bundle member is unchanged and shown as such; nothing else is AI-modifiable. The proof surfaces PATHS + CHECKSUMS only, never bytes (IP boundary).

6. **AC6 — Approve reuses the UNCHANGED 11.1/11.2 registration path; reject registers nothing.**
   **Given** I approve (optionally after editing the proposed manifest / adapter in the review UI)
   **When** I confirm
   **Then** the assembled bundle (unchanged core files + the NEW manifest + optional adapter) flows through the EXISTING, unmodified Story 11.1/11.2 bundle-registration path — including the registration-time `validate_entrypoint_contract` re-check and the now-present manifest satisfying `parse_code_driven_manifest` — with **no forked "AI register" branch**. A human edit that breaks conformance still 422s `ENTRYPOINT_CONTRACT_VIOLATION` (or `INVALID_CODE_DRIVEN_MANIFEST` for a broken manifest edit), same as any bundle. If I reject, nothing registers. AI-generated manifests carry `ai_adapted: true` (the additive field 11.3 added, [code_driven_hybrid.py:73-77](../../../velara-api/app/services/code_driven_hybrid.py#L73)); they remain fully subject to the unchanged `assert_certified_for_client_ready` certification gate ([skill_service.py:509-514](../../../velara-api/app/services/skill_service.py#L509)) — no new bypass.

7. **AC7 — Reproduces the real reference case end-to-end from the RAW client bundle.**
   **Given** the **raw, unmodified `velara-protocol-extractor` client deliverable** (which ships no Velara-shaped manifest; entrypoint `velara_extractor.plugin:run(input_path, output_dir=None, *, model=None, consensus_runs=1, enrich=False, emit_excel=True, …)` — named kwargs, non-conforming)
   **When** I upload it as-is and run the assistant
   **Then** the flow produces a schema-valid manifest pointing at the `params`-dict → named-kwargs adapter (i.e. AC4's non-conforming branch fires) — the reference case now works end-to-end **from the raw client bundle**, not just from a pre-manifested one. This is the worked acceptance anchor for this story: register the raw deliverable → `MISSING_BUNDLE_MANIFEST` 422 → propose → approve → registers with `ai_adapted: true`.

8. **AC8 — Token spend is attributable (reuse 11.3's audit event).**
   **Given** a propose-flow LLM call (success or failure)
   **When** it completes
   **Then** its `input_tokens`/`output_tokens`/`model` are recorded via `audit_service.record_admin_action` under the EXISTING `admin.skill_adapter_proposed` event 11.3 introduced ([skills.py:206-224](../../../velara-api/app/api/v1/skills.py#L206)) — best-effort, after the response is built, never blocking the response on an audit-write failure. No new audit event type is needed (this is the same propose endpoint).

## Tasks / Subtasks

> **Scope locked at story creation — do not re-litigate:**
> **(S1) This is the completion of 11.3, not a parallel capability.** It reuses 11.3's `propose_adapter` service, the `POST /skills/integration-assistant/propose` endpoint, the `AdapterProposal`/`AdapterProposalResponse` shapes, the `AIAdapterReview.tsx` panel, and the `admin.skill_adapter_proposed` audit event. The delta is: (a) a new `MISSING_BUNDLE_MANIFEST` error code that splits the missing-manifest case out of `INVALID_CODE_DRIVEN_MANIFEST`; (b) making `propose_adapter` synthesize a manifest stub (entrypoint + requirements only) when none exists; (c) a second FE entry point on the new code. **Do NOT fork a second service, endpoint, or review UI.**
> **(S2) Inference depth is MINIMAL and fixed (locked).** The AI infers ONLY `entrypoint` (LLM-proposed candidate, then validated by `resolve_entrypoint_module` static analysis — never import/exec) and `requirements` (lockfile verbatim). `output_schema` = the `scaffold_manifest.py` STUB; `schema_version` = `"0.1.0"` default. The AI does NOT perform whole-bundle return-type analysis and does NOT author the output contract — that stays a human responsibility (preserves 11.3's minimal-trust/IP boundary). If dev finds itself tempted to have the LLM infer output_schema, STOP — that is explicitly out of scope.
> **(S3) The entrypoint is INFERRED, not declared.** Unlike `scaffold_manifest.py` (which takes `--entrypoint` as a required CLI arg) and unlike 11.3 (whose FE reads the entrypoint from the existing manifest client-side), an unmanifested bundle has no declared entrypoint. `resolve_entrypoint_module` is entrypoint-**string-first** (it resolves a *given* `module:callable` to a file; it does NOT discover one — verified). Therefore the LLM proposes the candidate `module:callable` from the bundle code, and `resolve_entrypoint_module` + `validate_entrypoint_contract` VALIDATE it. This keeps the trust boundary correct: LLM proposes, deterministic static analysis is the check. The `entrypoint` field on the propose request/service becomes optional; when absent, the inference path runs.
> **(S4) Approve reuses the UNCHANGED registration path.** The FE assembles the ZIP (unchanged core files + new manifest + optional adapter) and re-posts through the EXISTING presign → PUT → `create_skill`/`create_version` bundle flow. No new "approve"/"AI register" backend endpoint. Story 11.2's `validate_entrypoint_contract` and `parse_code_driven_manifest` re-check the approved artifact exactly as for any bundle.
> **(S5) Reuse the same LLM seam and model.** `AnthropicProvider.complete(system=, user_content=, max_tokens=)` via the `Llm` dependency 11.3 added ([dependencies.py](../../../velara-api/app/core/dependencies.py)); model = `settings.ANTHROPIC_MODEL` (`claude-opus-4-8`). No new client, no tool-use loop, no second model config, single-shot completion. **Never pass `temperature`/`top_p`/`top_k`/`budget_tokens` — they 400 on Opus 4.x** ([anthropic_client.py:161-162](../../../velara-api/app/integrations/anthropic_client.py#L161)).

- [ ] **Task 1 — New `MISSING_BUNDLE_MANIFEST` error code (AC1)**
  - [ ] Add a new exception class in [bundle_extractor.py](../../../velara-api/app/services/bundle_extractor.py) beside `InvalidBundleError` ([bundle_extractor.py:67-78](../../../velara-api/app/services/bundle_extractor.py#L67)): `MissingBundleManifestError(VelaraHTTPException)` with `ERROR_CODE = "MISSING_BUNDLE_MANIFEST"` and `super().__init__(422, self.ERROR_CODE, detail)` — follow the `InvalidBundleError` pattern exactly. **No API-layer wiring is needed**: the global `velara_http_exception_handler` ([exceptions.py:141](../../../velara-api/app/core/exceptions.py#L141)) renders any `VelaraHTTPException` from its own `status_code`/`code`/`message`.
  - [ ] In `_process_bundle` ([skill_service.py:383-390](../../../velara-api/app/services/skill_service.py#L383)): replace `manifest_for_parse = manifest_bytes if manifest_bytes is not None else b"{}"` — when `find_manifest(files)` returns `None`, **raise `MissingBundleManifestError()`** instead of substituting `b"{}"`. Both `create_skill` (call at [skill_service.py:537](../../../velara-api/app/services/skill_service.py#L537)) and `create_version` (call at [skill_service.py:1011](../../../velara-api/app/services/skill_service.py#L1011)) go through `_process_bundle`, so both inherit the new code for free. Extraction is pure (no S3 write before validation), so a rejected bundle still persists nothing.
  - [ ] Document the new code in the error-code table (Dev Notes below already lists it). Mirror `entrypoint_contract.py:54-58`'s explicit anti-conflation discipline — the codebase deliberately keeps `INVALID_BUNDLE` / `INVALID_CODE_DRIVEN_MANIFEST` / `ENTRYPOINT_CONTRACT_VIOLATION` distinct; this adds a fourth, it does not fold into an existing one.

- [ ] **Task 2 — `propose_adapter` synthesizes a manifest stub when none exists (AC3, AC4, AC5)**
  - [ ] Make the `manifest` param of `propose_adapter` ([skill_integration_assistant.py:316-323](../../../velara-api/app/services/skill_integration_assistant.py#L316)) **optional** (`manifest: CodeDrivenHybridManifest | None = None`) and the `entrypoint` param optional (`entrypoint: str | None = None`). When `manifest is None`, run the manifest-synthesis path; otherwise behave exactly as 11.3 (regression-safe — 11.3's callers pass both).
  - [ ] **Entrypoint inference (S3):** when `entrypoint is None`, the LLM must propose the candidate `module:callable`. Two acceptable shapes — pick the one that keeps the single-shot boundary (S5) and surface the choice in Completion Notes:
    - (Preferred) Extend the prompt so the single `complete()` call returns the proposed `entrypoint` string *alongside* the manifest + optional adapter (a third labeled fence, e.g. `# ENTRYPOINT`), then validate that returned string with `resolve_entrypoint_module(paths, candidate)` — reject (fail-closed, typed error) if it doesn't resolve.
    - Feed the LLM a **listing of the bundle's `*.py` module paths + each module's top-level `def` signatures** (built from `ast.parse` + `_signature_from_ast`, the same static-analysis-only helpers, [entrypoint_contract.py:213-248](../../../velara-api/app/services/entrypoint_contract.py#L213)) so it has enough to name a real callable — never hand it a way to invent a path that isn't in the bundle. The returned candidate is ALWAYS re-validated by `resolve_entrypoint_module`; the LLM's proposal is advisory, the static check is the boundary.
  - [ ] **Lockfile discovery + verbatim requirements (S2):** locate the lockfile member among `[path for path, _ in files]` — accept `requirements.txt` at bundle-root or single-root-wrapped `*/requirements.txt` (mirror `find_manifest_path`'s bundle-root-then-single-root logic). Read its bytes verbatim, decode, non-empty-check (mirror [scaffold_manifest.py:107-111](../../../velara-api/scripts/scaffold_manifest.py#L107)). If no lockfile member is found, fail with a clear typed error (a code-driven bundle without a lockfile cannot be installed — do NOT silently emit an empty `requirements`, which would 422 later at `parse_code_driven_manifest`'s non-empty check anyway; surface it now).
  - [ ] **Synthesize the stub manifest:** build `{"entrypoint": <inferred>, "requirements": <lockfile verbatim>, "output_schema": _STUB_OUTPUT_SCHEMA, "schema_version": "0.1.0"}` (promote `_STUB_OUTPUT_SCHEMA` from `scaffold_manifest.py` — either import it or re-declare the identical dict in the assistant module; a shared constant is cleaner). Parse it through `parse_code_driven_manifest` to get a real `CodeDrivenHybridManifest` for the rest of the flow — this proves the synthesized manifest is itself schema-valid before it reaches the human (closes the deferred "updated_manifest never pre-validated" gap for THIS path; [deferred-work.md:397]).
  - [ ] **Adapter branch (AC4):** with the (now-present) manifest and validated entrypoint, run the EXISTING 11.3 logic: if the entrypoint is non-conforming, `propose_adapter` proposes the adapter and repoints the manifest's `entrypoint` to `velara_adapter:run`; if it already conforms, no adapter — the manifest's `entrypoint` stays the client's own callable and `adapter_source`/`adapter_path` are empty/omitted (verify the `AdapterProposal` shape and FE render tolerate the no-adapter case — see Task 5).
  - [ ] **`core_files_unchanged` (AC5):** exclude the manifest path (`find_manifest_path(...) or "manifest.json"` — will be `"manifest.json"` for an unmanifested bundle) AND, if an adapter was proposed, the adapter path + the analyzed entrypoint module — reuse `_compute_core_files_unchanged` ([skill_integration_assistant.py:271-283](../../../velara-api/app/services/skill_integration_assistant.py#L271)). For the manifest-only (conforming-entrypoint) case, only the manifest is excluded; the entrypoint module IS a core-unchanged file.
  - [ ] Never log the entrypoint module source, the lockfile content, the LLM prompt/response, or the adapter/manifest text — IDs, model, token counts, outcome only (house PHI/IP discipline).

- [ ] **Task 3 — Endpoint + request schema accept the no-manifest case (AC1, AC3, AC8)**
  - [ ] In `_extract_and_parse` inside the propose endpoint ([skills.py:184-191](../../../velara-api/app/api/v1/skills.py#L184)): when `find_manifest(files)` returns `None`, do NOT parse `b"{}"`. Instead pass `manifest=None` through to `propose_adapter` (the synthesis path handles it). Keep the existing behavior when a manifest IS present (11.3 path, e.g. the `ENTRYPOINT_CONTRACT_VIOLATION` re-adapt of an already-manifested bundle).
  - [ ] Make `entrypoint` **optional** in `AdapterProposalRequest` ([skill.py:189-197](../../../velara-api/app/schemas/skill.py#L189)) — `entrypoint: str | None = Field(default=None, max_length=255)`. Thread it through as `entrypoint=body.entrypoint` (now possibly `None`) to `propose_adapter`. **api-spec.json WILL diff** (the field becomes optional) — expected, confirm the diff is ONLY that field's nullability, nothing else.
  - [ ] Audit write (AC8): **unchanged** — the existing best-effort `record_admin_action(... EVENT_ADMIN_SKILL_ADAPTER_PROPOSED ...)` at [skills.py:206-224](../../../velara-api/app/api/v1/skills.py#L206) already fires for every propose call. No new audit event. Confirm the metadata still populates (model/tokens/stop_reason) on the synthesis path.

- [ ] **Task 4 — Approve flow reuses the unchanged registration path (AC6)**
  - [ ] **No new backend code.** The FE (Task 5) assembles the ZIP and re-posts to the EXISTING `create_skill`/`create_version` bundle endpoints. Because Task 1 made `_process_bundle` raise `MISSING_BUNDLE_MANIFEST` only when NO manifest exists, and the approved bundle now DOES contain the manifest, registration proceeds normally through `parse_code_driven_manifest` + `validate_entrypoint_contract`. Verify (integration test) that an approved bundle whose manifest/adapter a human intentionally broke still 422s the correct code (`INVALID_CODE_DRIVEN_MANIFEST` for a broken manifest, `ENTRYPOINT_CONTRACT_VIOLATION` for a broken adapter) — no AI-authored-content bypass.
  - [ ] Confirm `ai_adapted: true` is set on the manifest at approve time (FE writes it — 11.3 already does this at [AIAdapterReview.tsx:78-80](../../../velara-web/src/features/skills/components/AIAdapterReview.tsx#L78)); the additive `ai_adapted` field is already accepted by `CodeDrivenHybridManifest` (11.3, [code_driven_hybrid.py:73-77](../../../velara-api/app/services/code_driven_hybrid.py#L73)). No manifest-model change this story.

- [ ] **Task 5 — FE: second entry point on `MISSING_BUNDLE_MANIFEST`, same panel (AC2, AC5, AC6)**
  - [ ] **`src/api/skills.ts`** — make `proposeSkillAdapter`'s `entrypoint` param **optional** (`entrypoint?: string`) and OMIT it from the POST body when undefined ([skills.ts:163-172](../../../velara-web/src/api/skills.ts#L163)). Response type `AdapterProposal` is unchanged (already returns `manifest_path` + `updated_manifest`).
  - [ ] **`src/features/skills/components/SkillForm.tsx`** — this is the main FE work:
    - Broaden the affordance gate ([SkillForm.tsx:235-236](../../../velara-web/src/features/skills/components/SkillForm.tsx#L235)): `showAiAdaptAffordance` matches `apiCode === 'ENTRYPOINT_CONTRACT_VIOLATION'` **OR** `apiCode === 'MISSING_BUNDLE_MANIFEST'` (both with `mode === 'create'` — or version, if applicable — and `bundleFile !== null`). Reuse `getApiCode` from [errors.ts:14-16](../../../velara-web/src/shared/utils/errors.ts#L14).
    - For the missing-manifest code, **skip `readBundleEntrypoint`** (it returns `null` for an unmanifested bundle, [SkillForm.tsx:11-28](../../../velara-web/src/features/skills/components/SkillForm.tsx#L11)) and do NOT gate the panel mount on a truthy `bundleEntrypoint`. Branch on which code fired: `ENTRYPOINT_CONTRACT_VIOLATION` → 11.3 path (read entrypoint client-side, require a string); `MISSING_BUNDLE_MANIFEST` → new path (no entrypoint read, pass `entrypoint={undefined}`).
    - Relax the panel-mount condition ([SkillForm.tsx:527](../../../velara-web/src/features/skills/components/SkillForm.tsx#L527)) so it does not require a truthy `bundleEntrypoint` string when the trigger is missing-manifest. The copy on the affordance button + the panel's `idle` phase must read correctly for the missing-manifest case ("This bundle has no manifest — let the assistant generate one") vs. the contract-violation case.
  - [ ] **`src/features/skills/components/AIAdapterReview.tsx`** — make the `entrypoint` prop **optional** ([AIAdapterReview.tsx:15-28](../../../velara-web/src/features/skills/components/AIAdapterReview.tsx#L15)); make the `idle`-phase copy conditional (contract-violation vs. missing-manifest). **The approve/reassembly path already works unchanged for a net-new manifest**: [AIAdapterReview.tsx:77-80](../../../velara-web/src/features/skills/components/AIAdapterReview.tsx#L77) writes `nextMembers[proposal.manifest_path]` from scratch (`strToU8(JSON.stringify(...))`), so a bundle that never had a manifest simply gains one; `core_files_unchanged` won't list a manifest path, so nothing conflicts. Verify the render tolerates the **no-adapter (manifest-only) proposal** — when the inferred entrypoint already conforms, `adapter_source`/`adapter_path` may be empty; the adapter `<textarea>` + write at [AIAdapterReview.tsx:77](../../../velara-web/src/features/skills/components/AIAdapterReview.tsx#L77) must not emit a bogus empty `velara_adapter.py` member in that case (guard: only write the adapter member when `adapter_path` is non-empty).
  - [ ] **`src/features/skills/components/SkillBundleUpload.tsx`** — no change (its `onFileChange` prop already retains the raw `File` for re-extraction).

- [ ] **Task 6 — Tests (AC: all)**
  - [ ] **BE unit `tests/unit/services/test_skill_integration_assistant.py` (EXTEND)** — (a) `propose_adapter(manifest=None, entrypoint=None, files=<unmanifested bundle>)` with a `FakeLLMProvider` seeded to return a conforming entrypoint candidate → synthesizes a schema-valid stub manifest (entrypoint inferred + validated, requirements = the fixture lockfile verbatim, `output_schema` = the STUB, `schema_version="0.1.0"`); (b) LLM proposes an entrypoint candidate that does NOT resolve in the bundle → fail-closed typed error, not a bogus manifest; (c) no lockfile member in the bundle → clear typed error; (d) `core_files_unchanged` excludes the manifest path and (adapter case) the adapter/entrypoint module, and its checksums match the input bytes exactly; (e) manifest-only case (conforming inferred entrypoint) → no adapter proposed, manifest `entrypoint` = the client callable.
  - [ ] **BE unit — reference case (golden), EXTEND the AC5 golden from 11.3** — build a fixture matching the raw `velara_extractor.plugin:run(...)` named-kwargs signature with NO manifest + a `requirements.txt` member; `FakeLLMProvider` returns the entrypoint candidate + the `params`-dict→named-kwargs adapter. Assert: (a) synthesized manifest is schema-valid and its `entrypoint` points at the adapter (`velara_adapter:run`); (b) the returned adapter passes `validate_entrypoint_contract` AND matches the same behavioral matrix as [test_adapter_shim.py](../../../velara-api/tests/unit/services/test_adapter_shim.py) (per-key coercion, `model=None` omission, `input_paths` drop, unknown-key drop, empty/None params) — AC7's real bar.
  - [ ] **BE integration `tests/integration/api/test_skills.py` (EXTEND)** — (a) register an unmanifested bundle → 422 `MISSING_BUNDLE_MANIFEST` (NOT `INVALID_CODE_DRIVEN_MANIFEST`) — the trigger-signal regression that proves AC1's split; (b) `POST .../propose` with a staged unmanifested bundle and `entrypoint` omitted (LLM mocked via dependency override) → 200 with a proposal carrying a synthesized manifest; (c) approve-flow: assemble a bundle from the (fixture) proposal → `POST` the existing `create_skill` bundle path → 201, stored manifest carries `ai_adapted: true`; (d) a human-broken approved manifest/adapter still 422s the correct code (no bypass); (e) `MISSING_BUNDLE_MANIFEST` regression stays `RejectNonGrantor`-gated on the propose route (admin/ma_tech only — reuse 11.3's role-gate test shape).
  - [ ] **BE audit (AC8)** — after a synthesis-path propose call, assert the `admin.skill_adapter_proposed` row exists with `metadata.input_tokens`/`output_tokens`/`model`; assert the propose call still returns 200 when the audit write is forced to fail (reuse 11.3's best-effort test).
  - [ ] **FE `AIAdapterReview.test.tsx` (EXTEND)** — (a) renders a missing-manifest proposal (manifest + adapter) and approves → assembled-bundle re-upload fires (mock API client); (b) manifest-only proposal (no adapter) → approve does NOT emit an empty adapter member; (c) reject → no API call.
  - [ ] **FE `SkillForm.test.tsx` (EXTEND)** — the affordance appears when `apiCode === 'MISSING_BUNDLE_MANIFEST'` (new) as well as `ENTRYPOINT_CONTRACT_VIOLATION` (existing), and NOT on other bundle-registration codes (`INVALID_BUNDLE`, `INVALID_CODE_DRIVEN_MANIFEST`, `HYBRID_SHAPE_MISMATCH`) nor on a plain inline-content validation error; the missing-manifest path does NOT require a client-side-readable entrypoint to open the panel.

- [ ] **Task 7 — Gates**
  - [ ] `docker compose build api` then `docker compose run --rm -e AUTH_BACKEND=dev api python -m pytest` — baseline is 11.3's post-review number: **1210 passed** in-container (only the 3 known pre-existing `test_ingest.py` MinIO-in-container failures acceptable). New tests add to this, don't regress it. `docker compose run --rm api ruff check .` clean.
  - [ ] `AUTH_BACKEND=dev .venv/bin/python scripts/export_openapi.py` on the host — expect a diff: `AdapterProposalRequest.entrypoint` becomes optional/nullable. Confirm the diff is ONLY that (no new endpoints, no other schema changes) before committing.
  - [ ] FE: `npm run typecheck` (0) / `npm run lint` (baseline: 1 pre-existing `Icon.tsx` warning) / `npm run test` (vitest — baseline 605, + new tests). All clean.
  - [ ] **No migration** — the new error code is an exception class (no DB), the synthesized manifest lives in the bundle's stored JSON blob (no DB column), `ai_adapted` already exists (11.3). If a migration seems necessary, stop and re-read this constraint.

## Dev Notes

### Why this story is bounded the way it is

11.9 is the **completion of 11.3**, discovered on-boarding the real `velara-protocol-extractor` deliverable: 11.3's AI-assist only engages *after* a valid manifest exists (its trigger is `ENTRYPOINT_CONTRACT_VIOLATION`, which fires *inside* `validate_entrypoint_contract` — which only runs *after* `parse_code_driven_manifest` succeeds). A raw client bundle with NO manifest never reaches that trigger; it dies earlier at "missing manifest," today mis-reported as `INVALID_CODE_DRIVEN_MANIFEST`. 11.9 closes that gap so the raw deliverable uploads as-is. The four hard lines from the 11.3 ADR (`core-architectural-decisions.md` § "AI Skill Integration Assistant") still bind here:

1. **Registration stays LLM-free and deterministic.** The propose call is a SEPARATE, read-only step — it never calls `create_skill`. Approve is a human handing the (possibly-edited) proposal back through the SAME unmodified registration path. No "register with AI manifest" branch.
2. **The AI authors ONLY the manifest and (if needed) the adapter — checksum-proven.** `core_files_unchanged` proves every other member is byte-for-byte unchanged. `propose_adapter`'s signature (files in → proposal out, no DB/storage) makes persistence structurally impossible.
3. **Minimal inference / IP discipline.** The AI infers entrypoint + requirements ONLY. `output_schema` stays a human-fill stub; the AI does not analyze the bundle's return types. This is the SAME boundary 11.3 drew — 11.9 does not widen it.
4. **Human + certification double-gate, unchanged.** `ai_adapted: true` skills are fully subject to the two-key certification gate. AC6 is a regression proof, not new logic.

### The critical design nuance — entrypoint is INFERRED, not resolved-from-a-string

This is the single most important thing to get right, and the epic AC's phrasing ("detects the entrypoint via the existing `resolve_entrypoint_module` static analysis") is slightly misleading if read literally:

- `resolve_entrypoint_module(paths, entrypoint)` ([entrypoint_contract.py:80-128](../../../velara-api/app/services/entrypoint_contract.py#L80)) is **entrypoint-string-first** — it takes a `module:callable` string and probes for that exact module file (bundle-root, `src/`, single-top-dir variants). It does **NOT** discover an entrypoint; it validates a *given* one. Verified: there is no discovery function anywhere in `entrypoint_contract.py` or the assistant.
- `scripts/scaffold_manifest.py` sidesteps this by taking `--entrypoint` as a **required CLI arg** — the operator declares it. 11.3's FE sidesteps it by reading the entrypoint from the *existing* manifest client-side.
- An unmanifested bundle has neither. So 11.9's "infer the entrypoint" genuinely means: **the LLM proposes a candidate `module:callable` from the bundle code, and `resolve_entrypoint_module` (static analysis, never import/exec) validates that candidate.** LLM proposes → deterministic check is the boundary. A candidate that doesn't resolve is rejected fail-closed, never emitted. This keeps the untrusted-code posture intact (§ "static-analysis-only" below) while giving the AI the inference role the story wants.

### Lockfile discovery is a second small inference gap

`scaffold_manifest.py` takes the lockfile as an explicit `--requirements` path. The in-app flow has only `files: list[tuple[str, bytes]]`, so the assistant must *locate* the lockfile member itself. Mirror `find_manifest_path`'s bundle-root-then-single-root-wrapped logic for `requirements.txt`. Read it **verbatim** (the manifest `requirements` field is the raw lockfile text — [code_driven_hybrid.py:63-65](../../../velara-api/app/services/code_driven_hybrid.py#L63); the executor writes it straight to `requirements.txt` and pip-installs, [code_driven_executor.py:320-329](../../../velara-api/app/services/code_driven_executor.py#L320)). No lockfile *parsing* — verbatim only.

### The `b"{}"` substitution is in TWO places — both must change

Today the missing-manifest case is funneled into `INVALID_CODE_DRIVEN_MANIFEST` by substituting an empty `b"{}"` and letting the parser complain about a missing `entrypoint`. This happens in:
- `_process_bundle` ([skill_service.py:387](../../../velara-api/app/services/skill_service.py#L387)) — the registration path. → **Task 1** raises `MISSING_BUNDLE_MANIFEST` here.
- The propose endpoint's `_extract_and_parse` ([skills.py:189](../../../velara-api/app/api/v1/skills.py#L189)) — → **Task 3** passes `manifest=None` here instead, so `propose_adapter` synthesizes.

`find_manifest`/`find_manifest_path` return `None` (not an exception) when no manifest is present ([bundle_extractor.py:250-289](../../../velara-api/app/services/bundle_extractor.py#L250)) — so the `is None` check is the exact seam.

### Static-analysis-only posture carries over — do NOT import/exec

The bundle is UNTRUSTED, client-supplied code. Entrypoint inference must use `ast.parse` + `resolve_entrypoint_module` + `_signature_from_ast` (all static — [entrypoint_contract.py](../../../velara-api/app/services/entrypoint_contract.py)) to build the module/signature listing handed to the LLM as prompt content. NEVER `importlib` + `inspect.signature` on the bundle in the API process. This is the same hole 11.1/11.2/11.3 reviews hunted — do not reopen it by taking a shortcut.

### The exact LLM call shape to reuse (verified) — same as 11.3

`llm_provider.complete(system=…, user_content=…, max_tokens=…)` via the `Llm` FastAPI dependency 11.3 added ([dependencies.py]) — a single call, no loop. `model` = `settings.ANTHROPIC_MODEL` = `"claude-opus-4-8"` ([config.py:196](../../../velara-api/app/core/config.py#L196)). **Never pass `temperature`/`top_p`/`top_k`/`budget_tokens` — they 400 on Opus 4.x** ([anthropic_client.py:161-162](../../../velara-api/app/integrations/anthropic_client.py#L161)). `LLMResult` gives `.text`/`.input_tokens`/`.output_tokens`/`.model`/`.stop_reason` — everything the audit write needs. Parse the response with clearly-delimited fenced blocks (11.3 uses `# ADAPTER` / `# MANIFEST`; this story adds an entrypoint fence or folds the entrypoint into the manifest block — dev's call, document it). Do NOT use `output_config.format` / JSON-schema structured outputs (source-blob fragility — 11.3's rationale). Fail closed (typed error) on parse failure.

### Reuse map — do NOT reinvent

| Need | Reuse |
|---|---|
| Missing-manifest detection | `bundle_extractor.find_manifest` / `find_manifest_path` returns `None` — the seam ([bundle_extractor.py:250-289](../../../velara-api/app/services/bundle_extractor.py#L250)) |
| New error code pattern | `InvalidBundleError` ([bundle_extractor.py:67-78](../../../velara-api/app/services/bundle_extractor.py#L67)) — copy the `VelaraHTTPException` + `ERROR_CODE` + `super().__init__(422, …)` shape; global handler needs no wiring |
| Manifest stub shape + STUB output_schema | `scaffold_manifest.py` ([scaffold_manifest.py:53-118](../../../velara-api/scripts/scaffold_manifest.py#L53)) — the reference impl; promote `_STUB_OUTPUT_SCHEMA` + the `{entrypoint,requirements,output_schema,schema_version}` dict |
| Entrypoint resolution (validate a candidate) | `resolve_entrypoint_module` ([entrypoint_contract.py:80-128](../../../velara-api/app/services/entrypoint_contract.py#L80)) — validates the LLM's proposed candidate; does NOT discover |
| Entrypoint conformance check | `validate_entrypoint_contract` ([entrypoint_contract.py:138-210](../../../velara-api/app/services/entrypoint_contract.py#L138)) — decides whether an adapter is needed (AC4) + the registration re-check |
| Signature description for the prompt | `_signature_from_ast` + `_describe_signature` ([entrypoint_contract.py:213-248](../../../velara-api/app/services/entrypoint_contract.py#L213), [skill_integration_assistant.py:193-214](../../../velara-api/app/services/skill_integration_assistant.py#L193)) |
| Manifest parse/validate | `parse_code_driven_manifest` / `CodeDrivenHybridManifest` ([code_driven_hybrid.py:57-233](../../../velara-api/app/services/code_driven_hybrid.py#L57)) — parse the synthesized stub to prove it's schema-valid |
| Propose service | `propose_adapter` ([skill_integration_assistant.py:316](../../../velara-api/app/services/skill_integration_assistant.py#L316)) — EXTEND (optional manifest/entrypoint), don't fork |
| Checksum proof | `_compute_core_files_unchanged` ([skill_integration_assistant.py:271-283](../../../velara-api/app/services/skill_integration_assistant.py#L271)) |
| LLM call + test double | `AnthropicProvider.complete()` via the `Llm` dep; `FakeLLMProvider` ([anthropic_client.py:64](../../../velara-api/app/integrations/anthropic_client.py#L64)) |
| Audit event | `admin.skill_adapter_proposed` — EXISTING ([audit.py], [skills.py:206-224](../../../velara-api/app/api/v1/skills.py#L206)); no new event |
| Registration/re-registration | EXISTING `POST /skills` / `POST /skills/{id}/versions` bundle path, unmodified |
| FE review panel | `AIAdapterReview.tsx` ([AIAdapterReview.tsx](../../../velara-web/src/features/skills/components/AIAdapterReview.tsx)) — EXTEND (optional entrypoint prop + conditional copy), don't fork |
| FE inline-error hook | `getApiCode` + the `SkillForm.tsx` affordance gate ([SkillForm.tsx:235-236](../../../velara-web/src/features/skills/components/SkillForm.tsx#L235)) — add the new code as a second trigger |
| FE bundle re-upload | The presign → PUT → create/version flow the `AIAdapterReview` approve path already uses (fflate reassembly, [AIAdapterReview.tsx:61-93](../../../velara-web/src/features/skills/components/AIAdapterReview.tsx#L61)) |

### Error-code map (this story ADDS one)

| Code | Meaning | Introduced |
|---|---|---|
| `INVALID_BUNDLE` | ZIP structurally bad | 11.1 |
| **`MISSING_BUNDLE_MANIFEST`** | **no `manifest.json` at any recognized location — the trigger for THIS story's FE affordance** | **11.9 (new)** |
| `INVALID_CODE_DRIVEN_MANIFEST` | manifest present but malformed / missing a required field | 5.5.1 |
| `ENTRYPOINT_CONTRACT_VIOLATION` | code doesn't fit the contract — 11.3's FE trigger | 11.2 |
| `HYBRID_SHAPE_MISMATCH` | code-driven ↔ LLM-driven swap across versions | 5.5.1 |
| `CODE_DRIVEN_EXECUTION_ERROR` | run-time execution failure | 5.5.3 |

The propose endpoint's own advisory-step failures are unchanged from 11.3: `ADAPTER_PROPOSAL_PARSE_ERROR` (500, unparseable LLM response), `ADAPTER_PROPOSAL_LLM_ERROR` (502, `anthropic.APIError`). Entrypoint-inference/lockfile-discovery failures in the synthesis path should map to a clear typed error (reuse `AdapterProposalParseError` or a sibling — dev's call; fail closed, do not emit a half-built proposal).

### IP / PHI discipline (house invariants)

- Never log the entrypoint module source, the lockfile content, the LLM prompt/response, or the adapter/manifest text — only IDs, model, token counts, outcome.
- `core_files_unchanged` surfaces PATHS + CHECKSUMS to the review UI, never bytes.
- The propose endpoint reads from the SAME org-scoped `bundle-staging/{org}/` prefix `create_skill`/`presign_bundle` enforce — no second, less-guarded read path.

### Sequencing / dependencies

- **Inserted after 11.3** (recommended order 11.1 ✅ → 11.2 ✅ → 11.6 → 11.3 ✅ → **11.9** → 11.4 → 11.7 → 11.5). Depends on 11.1 (bundle upload), 11.2 (`resolve_entrypoint_module`/`validate_entrypoint_contract` + the contract), and 11.3 (the propose service, endpoint, `AdapterProposal` shapes, `AIAdapterReview` panel, audit event) — all done.
- Epic 11 is already `in-progress`; this is not the first story in the epic, so **no epic-status update is needed**.
- Nothing here requires 11.6 (UI-authored draft-mutable versioning), which is still pending — the propose/approve flow operates on the existing immutable create/version bundle path.

### Project Structure Notes

- **velara-api:** MODIFY `app/services/bundle_extractor.py` (new `MissingBundleManifestError`); MODIFY `app/services/skill_service.py` (`_process_bundle` raises it); MODIFY `app/services/skill_integration_assistant.py` (optional manifest/entrypoint → synthesis path: entrypoint inference, lockfile discovery, stub manifest); MODIFY `app/api/v1/skills.py` (`_extract_and_parse` passes `manifest=None`); MODIFY `app/schemas/skill.py` (`AdapterProposalRequest.entrypoint` optional); EXTEND `tests/unit/services/test_skill_integration_assistant.py` + `tests/integration/api/test_skills.py`; regenerate `docs/api-spec.json`. No new model, no migration.
- **velara-web:** MODIFY `src/api/skills.ts` (`proposeSkillAdapter` entrypoint optional); MODIFY `src/features/skills/components/SkillForm.tsx` (second entry point on `MISSING_BUNDLE_MANIFEST`, no client-side entrypoint read); MODIFY `src/features/skills/components/AIAdapterReview.tsx` (optional entrypoint prop, conditional copy, no-adapter guard); EXTEND `AIAdapterReview.test.tsx` + `SkillForm.test.tsx`. No new dependency (fflate already added in 11.3).
- `api-spec.json` WILL diff (the `entrypoint` field becomes optional) — expected; confirm it is ONLY that.

### References

- [Source: epics/epic-11-ai-assisted-skill-integration-and-promotion.md#Story-11.9] — story ACs, sequencing, the deliberate-insert rationale, the `velara-protocol-extractor` acceptance anchor.
- [Source: _bmad-output/implementation-artifacts/stories/11-3-ai-skill-integration-assistant.md] — the sibling story this completes: `propose_adapter`, `AdapterProposal`/`AdapterProposalResponse`, the `POST /skills/integration-assistant/propose` endpoint, the `admin.skill_adapter_proposed` audit event, the `AIAdapterReview.tsx` panel + fflate reassembly, the `ai_adapted` manifest field, the four ADR boundaries, and 11.3's own review patches (entrypoint parse-guards, `AdapterProposalLlmError`, `manifest_path` exposure).
- [Source: velara-api scripts/scaffold_manifest.py] — the interim, no-LLM reference tool this story promotes: `scaffold_manifest(...)`, `_STUB_OUTPUT_SCHEMA`, `_collect_relative_paths`, the entrypoint-as-declared-arg limitation, `resolve_entrypoint_module` usage, lockfile-verbatim embed. Commit `1fdf2d6`.
- [Source: velara-api app/services/bundle_extractor.py:67-78,250-289] — `InvalidBundleError` (the new error-code pattern to copy), `find_manifest`/`find_manifest_path` (returns `None` when absent — the detection seam), the recognized manifest locations.
- [Source: velara-api app/services/skill_service.py:383-390,537,1011] — `_process_bundle` (the `b"{}"` substitution to replace with `MissingBundleManifestError`), the `create_skill`/`create_version` call sites that inherit the fix.
- [Source: velara-api app/services/entrypoint_contract.py:48-65,80-128,138-248] — `EntrypointContractViolationError`, `resolve_entrypoint_module` (entrypoint-string-first — validates, does not discover), `validate_entrypoint_contract`, `_signature_from_ast`, the AST-only/never-import posture, the anti-conflation discipline for stable codes.
- [Source: velara-api app/services/skill_integration_assistant.py:85-100,113-190,271-323,362-378] — `AdapterProposal`, the prompt builders, `_extract_entrypoint_module`, `_compute_core_files_unchanged`, `find_manifest_path` usage, the `manifest`-required `propose_adapter` signature to extend, `AdapterProposalParseError`/`AdapterProposalLlmError`.
- [Source: velara-api app/api/v1/skills.py:160-235] — the propose endpoint, `_extract_and_parse`'s `b"{}"` substitution, the best-effort `record_admin_action` audit write to preserve, the `RejectNonGrantor` per-route gate.
- [Source: velara-api app/schemas/skill.py:189-214] — `AdapterProposalRequest` (make `entrypoint` optional) / `AdapterProposalResponse` (unchanged — already carries `manifest_path`).
- [Source: velara-api app/services/code_driven_hybrid.py:57-77,167-233] — `CodeDrivenHybridManifest` (`_REQUIRED_FIELDS`, `requirements` = verbatim lockfile text, the existing `ai_adapted` field), `parse_code_driven_manifest` (validate the synthesized stub), `INVALID_CODE_DRIVEN_MANIFEST`.
- [Source: velara-api app/services/code_driven_executor.py:320-329,780-802] — how `manifest.requirements` is consumed (written verbatim to `requirements.txt` + pip-installed; `_validate_requirements` rejects pip directives) — confirms verbatim-embed is correct.
- [Source: velara-api app/core/exceptions.py:27-40,68-80,138-144] — `VelaraHTTPException` base + the global handler that renders any subclass (why the new code needs no API wiring).
- [Source: velara-web src/features/skills/components/SkillForm.tsx:11-28,213-252,498-538] — `readBundleEntrypoint` (returns `null` for an unmanifested bundle — the reason the missing-manifest path must NOT require it), the `showAiAdaptAffordance` gate + `bundleEntrypoint` tri-state, the panel-mount condition to relax.
- [Source: velara-web src/features/skills/components/AIAdapterReview.tsx:15-28,61-93,77-80] — props (make `entrypoint` optional), the fflate approve/reassembly path (already writes `manifest_path` from scratch — works for a net-new manifest), the adapter-member write to guard for the no-adapter case.
- [Source: velara-web src/api/skills.ts:151-172] — `AdapterProposal` type + `proposeSkillAdapter` (make `entrypoint` optional, omit from body when absent).
- [Source: velara-web src/shared/utils/errors.ts:14-16] — `getApiCode` (reuse for the second trigger).
- [Source: velara-api tests/unit/services/test_adapter_shim.py] — the hand-written 5.5.6 adapter behavioral matrix AC7's golden test must match (per-key coercion, `model=None` omission, `input_paths` drop, unknown-key drop, empty/None params).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:397] — the deferred "updated_manifest never pre-validated against `CodeDrivenHybridManifest`" gap; the synthesis path CLOSES it for the no-manifest case by parsing the stub through `parse_code_driven_manifest` before returning.
- [Source: project memory — Client Skill Contract (the real `velara-protocol-extractor` ships no Velara-shaped manifest; named-kwargs entrypoint = the concrete non-conforming case); Story 12.1 Review (nested-repo cwd discipline — velara-api/velara-web are separate git repos from the top-level docs repo, cd back before docs-publish git commands); No Emoji Icons (FE affordance copy uses `<Icon>`, never emoji)].

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
