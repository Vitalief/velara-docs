# Epic 11: AI-Assisted Skill Integration, Versioning & Environment Promotion

> **Created 2026-07-06** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-06.md`). Trigger: after Epic 10 closed, the Project Lead identified that the skill on-boarding path is too rigid — getting a client-provided skill onto the platform, iterating on versions, and promoting it to higher environments requires hand-written code changes and out-of-band work every time. This epic introduces **intelligence** into skill integration (an AI assistant that standardizes a skill to fit the platform *without changing what it does*), real **multi-file ZIP bundle** upload, **UI-authored versioning**, **running older versions to compare**, and **environment promotion** (export/import now; in-app promote next). Epics 2, 3, and 5.5 stay `done` — this extends them forward (FR amendments only, no reopen). **Absorbs Epic 5.5 retro Action Item 1** (standardize the code-driven entrypoint contract at registration), previously a dangling action.

Vitalief can on-board a client-provided skill onto the platform with AI assistance — the platform proposes a standardized adapter + manifest so the skill fits the runtime contract **without changing what the skill does** — register true multi-file ZIP bundles, author new versions from the UI, run an older version to compare outputs, and promote certified skills to higher environments (export/import in Phase 1; in-app promote as the Phase-2 target). Replaces the per-skill hand-written adapter shim (Epic 5.5) with a standardized contract + an AI integration assistant.

**FRs covered:** SKL-01, SKL-02, SKL-03, SKL-04, SKL-05, SKL-06 (P2), SKL-07, SKL-08 (new — `sprint-change-proposal-2026-07-06.md`), REG-01 (amended — multi-file ZIP bundle now built), REG-02 (amended — draft-mutable versioning; published versions still immutable), EXE-03 (adjacent — code-driven entrypoint contract standardized).
**Sequencing:** After Epic 10. **Architecture-gated** — Winston authors three ADR blocks (AI-integration seam; promotion/bundle portability; draft-mutable versioning) before the dependent stories are detailed. Recommended order: 11.1 → 11.2 → 11.6 → 11.3 → 11.9 → 11.4 → 11.7 → 11.5.

**Two safety guarantees make the AI centerpiece trustworthy (baked into the ACs, not aspirational):**
1. **Structural** — the AI authors *only* the adapter shim + manifest; the skill's core logic files are stored **byte-for-byte unchanged** (content-addressed checksums prove it). "Without changing what it does" is a mechanical invariant.
2. **Governance** — the adapted skill re-enters the **two-key certification** gate before `client_ready`. An AI-proposed adapter cannot reach clients without human technical + methodological sign-off.
Plus a **human-approve gate** at registration (propose, never auto-apply).

---

## Story 11.1: Multi-File ZIP Bundle Upload & Extraction

As an MA Tech developer,
I want to upload a skill as a true multi-file ZIP bundle,
So that a client-provided multi-file skill is stored and versioned as-is — closing the Phase-1 "manifest IS the artifact" deferral.

**Acceptance Criteria:**

**Given** a multipart ZIP upload with a manifest
**When** I register (or version) the skill
**Then** the bundle is extracted, each file is stored via `StorageProvider`, and the version records the full artifact set (immutable, content-addressed) — the skill's core files are stored byte-for-byte

**Given** a bundle missing a required manifest field (entrypoint, `output_schema`/`schema_version`, or lockfile)
**When** I attempt to register it
**Then** registration is rejected 422 naming the missing field — the existing load-bearing-schema discipline (Story 5.5.1) is preserved

**Given** the current inline-string artifact path
**When** a prompt/code skill is registered without a ZIP
**Then** it still works — ZIP upload is additive, not a breaking swap of the inline path

---

## Story 11.2: Standardized Entrypoint Contract + Registration-Time Validation

As the platform,
I want one standardized code-driven entrypoint contract enforced at registration,
So that skills stop needing bespoke hand-written adapter shims (Epic 5.5 retro Action Item 1).

**Acceptance Criteria:**

**Given** the canonical contract `run(input_path, output_dir, params: dict)`
**When** a code-driven hybrid is registered
**Then** the registration validator checks the declared entrypoint's **callable signature** (not just the `module:callable` *string format* it checks today) and rejects a non-conforming skill with a clear, specific error

**Given** a conforming skill
**When** it is invoked
**Then** no adapter is needed and it runs on the existing `code_driven_executor` runner unchanged

**Given** the existing LLM-driven hybrid and prompt/code skills
**When** they are registered
**Then** they are unaffected — the signature check applies to the code-driven path only

---

## Story 11.3: AI Skill Integration Assistant (Propose → Human-Approve, Adapter-Only)

As an MA Tech developer on-boarding a non-conforming client skill,
I want the platform to analyze it and PROPOSE a standardized adapter + manifest for my review,
So that I don't hand-write a shim — and I stay in control of what registers.

**Acceptance Criteria:**

**Given** a client skill that doesn't match the Story 11.2 contract
**When** I request AI assistance
**Then** the assistant analyzes the entrypoint signature / arg shape / output envelope and **generates a proposed adapter shim + manifest**, presented for review as a diff (this is the platform's **first LLM call on the registration path** — register is LLM-free today)

**Given** the proposal
**When** I review it
**Then** the AI has authored **only** the adapter + manifest — the skill's core logic files are byte-for-byte unchanged (verified by checksum); the review UI shows exactly what would be added, and nothing in the core is modifiable by the AI

**Given** I approve (optionally after editing) the proposal
**When** I confirm
**Then** the skill registers with the adapter as part of its immutable bundle; if I reject, nothing registers

**Given** an AI-adapted skill
**When** it is advanced toward `client_ready`
**Then** it must pass the existing two-key certification (technical + methodological) first — no AI-authored adapter reaches clients un-certified

**Given** the `velara-protocol-extractor` reference case
**When** the assistant is run against it
**Then** it can reproduce the `params`-dict → named-kwargs adapter that was hand-written in Epic 5.5 (the worked acceptance anchor)

---

## Story 11.9: AI-Assisted Manifest Generation for Unmanifested Client Bundles

As an MA Tech developer on-boarding a client-provided skill that ships with **no Velara-shaped manifest at all** (or a non-conforming one),
I want the platform to detect the missing manifest and PROPOSE a schema-valid `manifest.json` — alongside the adapter, in the same review — so I can upload the client's bundle as-is,
So that on-boarding a raw client deliverable does not require a developer to hand-author manifest JSON before the AI-assist flow (Story 11.3) can even engage.

> **Scope note (locked at story creation — do not re-litigate):** This story CLOSES the gap between Epic-11 AC1's promise ("generates a proposed adapter shim **+ manifest**") and Story 11.3's narrower delivery (which only *patched an existing* manifest's `entrypoint`). It is the completion of the AI-assist capability 11.3 started — the two are a pair. **Inference depth is deliberately minimal (locked):** the AI infers ONLY the `entrypoint` (detected from bundle code via the existing `resolve_entrypoint_module` static analysis) and `requirements` (the bundle's lockfile verbatim); `output_schema` is emitted as a clearly-labeled **human-fill stub** and `schema_version` as a default. The AI does NOT author the output contract — that stays a human responsibility, preserving 11.3's minimal-trust / IP-discipline boundary (the assistant does not perform whole-bundle return-type analysis). This mechanically mirrors the interim `scripts/scaffold_manifest.py` tool, promoted into the in-app propose flow.

**Acceptance Criteria:**

**Given** a bundle that contains skill code but no `manifest.json` at any recognized location (bundle-root or single-root-wrapped `*/manifest.json`, per `bundle_extractor.find_manifest`)
**When** I attempt to register it
**Then** registration fails with a **distinct, stable error code** for the missing-manifest case (separate from `INVALID_CODE_DRIVEN_MANIFEST`, which means a manifest is present but malformed) — this new code is the trigger signal for this story's FE affordance, the same way `ENTRYPOINT_CONTRACT_VIOLATION` is 11.3's

**Given** that missing-manifest registration failure
**When** the FE surfaces it
**Then** the SAME AI-adapt review panel introduced in Story 11.3 is offered (one review surface, two entry points) — no second, parallel review UI

**Given** I request AI assistance on an unmanifested bundle
**When** the propose call runs
**Then** the assistant detects the entrypoint via the existing `resolve_entrypoint_module` static analysis (never importing/executing the untrusted bundle), reads the lockfile for `requirements`, and proposes a **schema-valid `manifest.json`** — with `output_schema` as an explicitly-labeled human-fill stub and a default `schema_version` — AND, if that detected entrypoint is itself non-conforming to the Story 11.2 contract, proposes the adapter in the SAME pass; the review shows the proposed manifest + (optional) adapter together

**Given** the proposed manifest + adapter
**When** I review them
**Then** the same "adapter-only, core files byte-for-byte unchanged, checksum-proven" guarantee from Story 11.3 holds — the AI has authored ONLY the manifest and (if needed) the adapter; every other bundle member is unchanged and shown as such; nothing else is AI-modifiable

**Given** I approve (optionally after editing the proposed manifest / adapter)
**When** I confirm
**Then** the assembled bundle (unchanged core files + proposed manifest + optional adapter) flows through the EXISTING, unmodified Story 11.1/11.2 bundle-registration path — including the registration-time `validate_entrypoint_contract` re-check — with no forked "AI register" branch; if I reject, nothing registers

**Given** the raw, unmodified `velara-protocol-extractor` client deliverable (which ships no Velara-shaped manifest)
**When** I upload it as-is and run the assistant
**Then** the flow produces a schema-valid manifest pointing at `velara_extractor.plugin:run` AND the `params`-dict → named-kwargs adapter (the reference case now works end-to-end from the raw client bundle, not just from a pre-manifested one) — the worked acceptance anchor for this story

---

## Story 11.4: Export / Import Portable Skill Bundles

As a Vitalief operator,
I want to export a skill+version to a portable signed bundle and import it into another environment,
So that a skill built in dev can move to staging/prod without hand re-registration.

**Acceptance Criteria:**

**Given** a skill version
**When** I export it
**Then** the platform produces a signed, content-addressed portable bundle (manifest + artifact files + metadata) that validates on import

**Given** an import into a target environment
**When** I upload a bundle
**Then** the skill+version is recreated immutably; a tampered or invalid bundle is rejected with a clear error; the PHI/IP boundary is respected (bundle contents are the skill artifact only — documented in the ADR)

**Given** lifecycle governance
**When** a skill is imported
**Then** it lands in an appropriate non-`client_ready` state so target-environment certification applies — trust does not copy across environments by file copy

---

## Story 11.5: In-App Environment Promotion (Phase-2 Design + Stub)

As a Vitalief operator,
I want a "Promote to staging/prod" action that copies a certified skill version across environments in-app,
So that promotion needs no file download/upload.

**Acceptance Criteria (Phase-2 target — design + minimal seam this epic; full build deferred):**

**Given** a `client_ready` skill
**When** I view it
**Then** the promote action is available; the architecture for the authenticated service-to-service cross-environment copy is specified (ADR); a stub/seam lands so Phase 2 builds against it

**Given** the Phase-1 need
**When** promotion is required now
**Then** Export/Import (Story 11.4) is the Phase-1 mechanism — in-app promote does not block this epic's close

---

## Story 11.6: Author New Skill Versions From the UI (Draft-Edit + Version-on-Publish)

As an MA Tech developer,
I want to create new versions of a skill from the UI — edit content in place for prompt/code skills, upload a new ZIP for hybrid skills,
So that I can iterate without hand-calling the API.

**Acceptance Criteria:**

**Given** a `draft` prompt/code skill
**When** I edit its content in the UI and save
**Then** the current draft version's content is updated in place (a new mutable-draft backend path); the `SkillEdit` form gains a content editor and a `createVersion` FE API client — neither exists today (`SkillEdit` only PATCHes metadata)

**Given** a `draft` hybrid skill
**When** I upload a new ZIP bundle (via Story 11.1)
**Then** it replaces the draft's artifact and is marked the current draft content

**Given** I publish a draft (advance its lifecycle)
**When** the transition applies
**Then** an **immutable** version is minted (existing `POST /versions` immutability + auto-bump); per the existing rules, a `client_ready` skill publishing a new version resets to `draft` and flags derived children for re-certification

**Given** a certified or published version
**When** anyone attempts to mutate it
**Then** it remains immutable — draft-mutability never applies to a non-draft version; the strict immutability invariant holds outside `draft`

---

## Story 11.7: Run an Older Skill Version to Compare (admin / ma_tech)

As an admin or MA Tech developer,
I want to run a specific older version of a skill,
So that I can compare its output against the current version.

**Acceptance Criteria:**

**Given** `InvocationRequest` gains an optional `version` field
**When** an admin/ma_tech caller supplies it
**Then** the run pins to **that** `SkillVersion` instead of `current_version`; the job + audit already record `skill_version`, so the comparison is traceable automatically

**Given** a client or consultant caller (or no `version` supplied)
**When** the skill is invoked
**Then** the run uses `current_version` as today — version selection is grantor-gated (`_GRANTOR_ROLES = {admin, ma_tech}` already exists; reuse it), so only admin/ma_tech can pin an arbitrary version

**Given** a nonexistent version or a retired skill
**When** a version-pinned run is requested
**Then** it is rejected with a clear error — no job is queued to a bogus version (mirror the existing `NoCurrentVersionError` guard)

---

## Story Sequencing & Dependencies

| Story | Depends on | Why |
|-------|-----------|-----|
| **11.1** ZIP bundle upload | Epic 2 registry, Epic 5.5 (done) | Foundation — real multi-file artifact; the hybrid new-version path needs it |
| **11.2** Standardized entrypoint contract | Epic 5.5 executor (done) | The register-time signature check the AI assistant targets |
| **11.6** UI new-version authoring | 11.1 (hybrid ZIP path) | Draft-mutable path + content editor; ZIP-new-version rides on 11.1 |
| **11.3** AI integration assistant | 11.1, 11.2 | Analyzes bundles against the standardized contract; proposes the adapter |
| **11.9** AI-assisted manifest generation | 11.1, 11.2, 11.3 | Completes Epic-11 AC1's "adapter shim **+ manifest**" promise 11.3 under-delivered; lets a raw, unmanifested client bundle upload as-is. Extends 11.3's propose flow + review UI |
| **11.4** Export/import bundles | 11.1 | Serializes the multi-file bundle |
| **11.7** Run older version to compare | Epic 5 invocation loop (done) | Independent — can slot anywhere after 11.1; needs versions to exist |
| **11.5** In-app promote (Phase-2 design) | 11.4 | Export/import is the Phase-1 mechanism it supersedes later |

**Recommended order:** 11.1 → 11.2 → 11.6 → 11.3 → 11.9 → 11.4 → 11.7 → 11.5. Per `create-story` discipline, each story is expanded to full implementation detail one at a time when picked up — these epic-level ACs are the contract, not the implementation plan. **11.9 is a deliberate insert (2026-07-09):** discovered during real client-bundle on-boarding (the `velara-protocol-extractor` deliverable ships no Velara-shaped manifest) that 11.3's AI-assist only engages *after* a valid manifest exists — closing that gap is 11.9, scheduled immediately after 11.3 as the completion of the same capability.

## Architecture ADRs required before dev (Winston)

1. **AI Skill Integration Assistant** — the new LLM seam on the *registration* path (register is LLM-free today); the adapter-only enforced boundary + byte-for-byte core preservation; the propose → human-approve → certification-re-run flow; how a proposed/approved adapter is persisted into the immutable bundle. (Stories 11.2/11.3.)
2. **Environment Promotion & Bundle Portability** — export/import signed content-addressed bundle format + PHI/IP boundary reasoning (artifacts leave the platform in Phase 1); the Phase-2 in-app service-to-service promote path (auth, promotable lifecycle states, cross-env identity, why trust does not copy across environments). (Stories 11.4/11.5.)
3. **Draft-Mutable Versioning** — confirm the model where a `draft` skill's current version content is mutable in place while every published/certified version stays immutable (softening the current absolute "no UPDATE ever" invariant to a draft-only exception); how this interacts with content-addressed checksums and the `client_ready` → `draft` reset-on-publish rule. (Story 11.6.)

## Open Questions (carry to the architect)

- **AI assistant model + cost:** which Claude model backs the integration assistant, and is analysis run synchronously at request time or as an async job (registration is otherwise synchronous today)?
- **Bundle signing key management:** where does the export/import signing key live per environment (Secrets Manager), and how is it rotated?
- **Draft-mutability storage:** does an in-place draft edit overwrite the same content-addressed key, or write a new key and re-point the draft version row? (Checksum semantics.)
