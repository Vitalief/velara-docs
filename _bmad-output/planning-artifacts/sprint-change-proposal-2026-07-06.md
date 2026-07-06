# Sprint Change Proposal — AI-Assisted Skill Integration, Promotion & Lifecycle Polish

**Date:** 2026-07-06
**Author:** Developer (via correct-course)
**Status:** Proposed — awaiting approval
**Scope classification:** **Major** — two new epics (11 + 12), new PRD FR groups, and two architecture ADRs → routes to PM/Architect for Epic 11; Moderate (a batch of independent fixes) for Epic 12.

> **Nature of this change.** This is **not** a defect correction in in-flight work. It is a **forward scope addition** requested by the Project Lead: a new capability epic (AI-assisted skill integration + environment promotion) plus a batch of small, independently-shippable UX fixes. Every claim below is grounded in a source audit of both repos (`velara-api`, `velara-web`) run 2026-07-06; file:line evidence is inline so the proposal is honest about size. The roadmap previously ended at Epic 10 ("no Epic 11 defined"); this proposal **defines Epic 11 and Epic 12**.

---

## Section 1 — Issue Summary

**Trigger.** After Epic 10 closed (Client User Provisioning, done 5/5, 2026-07-06), the Project Lead identified that the **skill on-boarding path is too rigid**. Getting a client-provided skill onto the platform, promoting it to higher environments, and iterating on it currently requires hand-written code changes and out-of-band work every time. The ask is to introduce intelligence into skill integration and to close a cluster of concrete lifecycle/UX gaps.

**The core problem (categorized: *technical limitation discovered during operation* + *new capability requirement*).** Two structural rigidities and five discrete gaps:

### Structural rigidity (the epic's heart)

| # | What the code shows | Evidence |
|---|---|---|
| **R1** | **Skill registration is purely mechanical — no intelligence.** Validation is Pydantic + regex only; the register path imports **no LLM**. Claude is used at *execution* time only. Nothing helps a client skill *fit* the platform contract. | `skill_service.create_skill` + `code_driven_hybrid.parse_code_driven_manifest` — zero anthropic imports; `anthropic_client.py` imported only by `execution_service.py` + `execution_tasks.py`. |
| **R2** | **Adapting a client skill = a hand-written, per-skill adapter shim.** The client `velara-protocol-extractor` needed a bespoke `velara_extractor.adapter:run` to bridge the platform's fixed `func(input_path, output_dir, params=dict)` runner contract to the skill's own named-kwarg signature. The Epic 5.5 retro explicitly flagged this: *"Adapter Shim is a One-Off, Not a Standard… every new code-driven skill with a non-conforming arg contract writes its own shim."* Its **Action Item 1 — standardize the entrypoint contract + enforce at registration — is unbuilt.** | Runner: `code_driven_executor.py:135-143` (fixed `params=dict` contract). Shim mirror: `tests/unit/services/test_adapter_shim.py`. Retro: `epic-5.5-retro-2026-06-27.md:65-66, 127`. |
| **R3** | **No environment promotion / export / import exists at all.** A skill registered in dev must be **re-registered by hand** in staging/prod. No router, no seed script, no export endpoint; each environment has its own DB + S3 skill bucket. | `router.py:23-36` (no promote/export router); `scripts/` holds only `export_openapi.py`; migrations never INSERT skills. |
| **R4** | **Multi-file ZIP bundle upload is deferred.** Today a code-driven "bundle" is the **manifest JSON stored as the artifact** (inline string, ≤1 MiB); real multi-file upload/extraction was punted in Epic 5.5. | `SkillCreate.initial_content` (`schemas/skill.py:187`, `_MAX_CONTENT_LEN=1_048_576`); `code_driven_executor.py:198-205` ("Phase 1: manifest IS the artifact"). |
| **R5** | **New versions cannot be authored from the UI.** The create-version endpoint exists and works, but `SkillEdit.tsx` **only PATCHes metadata** — there is no content editor and **no `createVersion` FE API client** at all. A prompt/code skill's content can only change via a direct API call; a hybrid can't get a new ZIP version because ZIP upload doesn't exist (== R4). | Endpoint: `POST /skills/{id}/versions` (`skills.py:206-235`), immutable auto-bump (`skill_service.py:558-706`). FE gap: `SkillEdit.tsx:107-151` (metadata patch only); no createVersion in `api/skills.ts`. |
| **R6** | **Only the current version is runnable.** `queue_invocation` hard-pins every run to `skill.current_version`; `InvocationRequest` has no version field. There is no way to run an older version to compare outputs across versions. | Pin: `invocations.py:176-179`. No version field: `schemas/invocation.py:18-63`. |

### Discrete lifecycle / UX gaps (five follow-ups)

| # | Ask | Verified reality | Size |
|---|---|---|---|
| **G1** | Export/Import or another way to **promote skills to higher environments** | Absent (== R3). | Epic-core (Epic 11). |
| **G2** | **Warn on duplicate runs** of the same skill in the same context (save AI cost) | No dedup/idempotency/cache logic anywhere for invocations. Natural hook: `queue_invocation` before `create_job`; inputs already hashable (`file_ref_ids` + `inputs`). | Small–Med. |
| **G3** | **Run Console context "always says org," and shows IDs not names** in the audit log for client/project/study/location | The "always org" write-path bug was **mostly fixed 2026-07-02** (context now resolved most-specific-first). The **remaining** defect: the audit surface shows the **raw ltree path of UUIDs** — there is **no UUID→name resolution anywhere** (audit list, detail panel, and fan-out children all render the raw path; the query API resolves `skill_name` but never joins Client/Project/Study/Location names). | Small–Med. |
| **G4** | **No way to mark a skill location-dependent** | **False as stated at the data layer** — `location_dependent` is a fully-wired backend field (model + create/update/read schemas + service + route) and the Run Console *consumes* it. It is a **pure frontend form gap**: `SkillForm.tsx` renders no toggle and `SkillCreateInput`/`SkillUpdateInput` omit the field. | Small. |
| **G5** | **Audit icons are all the same play icon** | A real event-type→icon map exists (`eventTypeIconMeta.ts`), but (a) the **default fallback is `play`** and two live event types (`admin.user_provisioned`, `admin.user_invite_resent`) fall through to it, and (b) the dominant `invocation.success` row **is** `play`. So the "all play" symptom is real, but the fix is *fill the gaps + verify render*, not "build a mapping." | Small. |

**Product decisions (Project Lead, 2026-07-06 — captured via structured elicitation):**
- **AI integration assistant = "AI proposes, human approves."** The assistant analyzes an incoming skill and **generates a review-ready adapter shim + manifest**; a human reviews/edits/approves before registration. AI never silently registers.
- **Behavior-preservation is guaranteed structurally + by governance.** The AI is constrained to author **only the adapter/manifest layer** — the skill's core logic files are **byte-for-byte untouched** (structural proof of "without changing what it does") — **and** the existing **two-key certification re-runs** on the adapted skill before it can reach `client_ready`.
- **Promotion: both mechanisms, phased.** **Export/Import portable bundle files in Phase 1** (unblocks the immediate need); **in-app service-to-service "Promote to staging/prod" as the Phase-2 target.**
- **Real multi-file ZIP bundle upload is in scope** for Epic 11 (closes the deferred R4 gap — the AI assistant needs to inspect/repackage true multi-file skills).
- **New-version authoring from the UI is in scope.** For **prompt/code** skills: an in-UI content editor. For **hybrid** skills: upload a **new ZIP** which is marked as the new version. Chosen model (Project Lead): **draft-mutable-in-place + version-on-publish** — while a skill is `draft`, its content edits in place; a new **immutable** version is minted only on publish. This **softens today's strict "versions are immutable, no UPDATE ever" invariant for the `draft` state only** — a certified/published version stays immutable. Needs a new backend mutable-draft path + Winston's confirmation (see §4.5).
- **Run older versions to compare (admin / ma_tech only).** Grantor-privileged users can select and run a specific historical version to compare outputs across versions. Today runs hard-pin to `current_version`; the `_GRANTOR_ROLES = {admin, ma_tech}` gate already exists for the restriction.
- **"Which version ran" is already captured** (job + audit row carry `skill_version`; the audit detail panel displays it) — **no new work needed**; treated as covered.
- **Structure: split into two epics.** **Epic 11** carries the heavy AI-integration + promotion + versioning work. A separate lightweight **Epic 12** holds the four small UX fixes (G2–G5) so they ship independently without waiting on Epic 11.
- **Audit name resolution: backend-enriched.** The audit query API resolves the ltree UUID segments to names server-side (one place, consistent across list + detail + fan-out).

---

## Section 2 — Impact Analysis

### Epic Impact

- **NEW Epic 11 — AI-Assisted Skill Integration, Versioning & Environment Promotion.** The centerpiece: real ZIP bundle upload, a standardized entrypoint contract enforced at registration, an AI integration assistant (propose → human-approve, adapter-only), **UI-authored new versions** (draft-edit for prompt/code, new-ZIP for hybrid; draft-mutable, immutable-on-publish), **running an older version to compare** (admin/ma_tech), export/import bundles, and the in-app promote path (Phase-2 target, scoped now). Numbered **11** (first free label; roadmap ended at 10).
- **NEW Epic 12 — Skill & Audit Lifecycle Polish.** The four independent quick-fixes (G2 duplicate-run warning, G3 audit context names, G4 location-dependent toggle, G5 audit icons). Small, mostly FE-or-thin-BE, no cross-dependency on Epic 11. Can run in parallel with / ahead of Epic 11.
- **No existing epic is reopened or invalidated.** Epics 2 (Registry), 3 (Execution), 5.5 (Code-Driven Hybrid), and 9 (Audit) stay `done`. Epic 11 **extends** them forward (new FR amendments), exactly as Epic 5.5 extended Epics 2/3 without reopening them. Epic 5.5's unbuilt retro Action Item 1 (standardize entrypoint contract) is **absorbed into Epic 11 Story 11.2** — this is where it belongs by dependency.

### Story Impact

- **Epic 5.5 retro Action Item 1 → Epic 11 Story 11.2.** Previously a dangling retro action; now a first-class story (standardized `run(input_path, output_dir, params: dict)` contract + registration-time signature validation).
- **The `velara-protocol-extractor` adapter shim** (external to both repos; mirrored by `test_adapter_shim.py`) becomes the **worked reference example** the AI assistant must be able to reproduce — a natural acceptance anchor for Story 11.3.
- **No completed story requires rework.** G3's write-path half was already fixed (2026-07-02); Epic 12 adds only the name-resolution read layer on top.

### Artifact Conflicts

- **PRD (`5-functional-requirements.md`):** ADD two FR groups (proposed IDs below; both namespaces are free) —
  - **§5.2a Skill Integration, Versioning & Promotion (`SKL-*`)** — AI-assisted standardization, adapter-only behavior preservation, ZIP bundle upload, UI new-version authoring (draft-edit + version-on-publish), run-older-version-to-compare, export/import, in-app promote. (Promotion folds into `SKL-05`/`SKL-06` — no separate `ENV-*` namespace needed.)
  - AMEND **REG-01** (bundle is the immutable unit — clarify multi-file ZIP is now *built*, not just architected) and **REG-02** (draft-mutable versioning — published versions still immutable); note **REG-08** (version pinning, P2) as adjacent-but-distinct.
  - ADD **skill-lifecycle-polish FRs** for Epic 12 (duplicate-run advisory, audit name resolution, location-dependent authoring control, audit event iconography) — small, likely under existing §5.2 / §5.11 as new rows.
- **Architecture (`core-architectural-decisions.md`):** ADD two ADR blocks (Winston) —
  1. **AI Skill Integration Assistant** — where the LLM enters the *registration* path (new seam, since register is LLM-free today); the adapter-only constraint as an enforced boundary; the propose→human-approve→certify-re-run flow; how a generated adapter is stored (a new immutable version? a pre-registration staging artifact?).
  2. **Environment Promotion & Bundle Portability** — export/import bundle format (signed, content-addressed, PHI/IP boundary reasoning since artifacts leave the platform in Phase 1), and the Phase-2 in-app service-to-service promote path (auth, which lifecycle states are promotable, cross-env identity).
  - ADD (smaller) a note on **multi-file ZIP bundle storage** — resolves the deferred R4 "manifest-as-artifact" model into real per-file storage.
  3. **Draft-mutable versioning** — confirm the model where a `draft` skill's current version content is **mutable in place**, while every published/certified version stays **immutable** (softening the current absolute "no UPDATE ever" invariant to a draft-only exception). Specify how this interacts with content-addressed checksums and the client_ready→draft reset-on-publish rule. (Story 11.6.)
- **UX:** New screens/surfaces (net-new — `design/` mockups don't cover these): the **AI integration review screen** (proposed adapter/manifest diff + approve/edit), the **export/import + promote controls**, and (Epic 12) the **location-dependent toggle** on `SkillForm`, the **duplicate-run confirm dialog**, and **audit name/icon rendering**. UX design (Sally) needed for the two net-new Epic 11 surfaces; Epic 12 items are in-place tweaks to existing screens.
- **`sprint-status.yaml`:** add `epic-11` + its stories and `epic-12` + its stories (all `backlog`); add `epic-11-retrospective` / `epic-12-retrospective` as `optional`; update the `last_updated` header note.

### Technical Impact

- **Epic 11 (largest):**
  - **ZIP bundle upload** — new multipart endpoint + extraction + per-file `StorageProvider` storage; evolves the "manifest-as-artifact" model. Migration likely (artifact-key set vs single key). **Medium–Large.**
  - **Standardized entrypoint contract + registration validation** — enforce `run(input_path, output_dir, params: dict)` callable signature at register time (retro AI1). **Medium.**
  - **AI integration assistant** — **first-ever LLM call on the registration path** (new architectural seam); analyzer + adapter/manifest generator constrained to the adapter layer; propose→approve workflow + review UI; certification re-run wiring. **Large, highest risk** (LLM-authored artifact entering a certification-gated pipeline — the human gate + adapter-only + re-cert are the mitigations).
  - **Export/Import bundles** — signed portable bundle serialize/deserialize + import validation; **PHI/IP surface** (artifact leaves the platform boundary — must reason about what's in the bundle). **Medium.**
  - **In-app promote (Phase-2 target)** — service-to-service cross-env copy; scoped/designed now, built later. **Deferred build.**
  - **New-version authoring from the UI (11.6)** — net-new FE content editor + `createVersion` API client (neither exists — `SkillEdit` patches metadata only), **plus a new backend mutable-draft path** (draft content editable in place; immutable version on publish). ZIP-new-version rides on 11.1. **Medium** (the draft-mutability model is the architecture-sensitive part).
  - **Run older version to compare (11.7)** — add an optional grantor-gated `version` to `InvocationRequest`; resolve the chosen `SkillVersion` instead of `current_version` at the pin point (`invocations.py:176-179`). Job + audit already record `skill_version`, so comparison data flows free. `_GRANTOR_ROLES` gate already exists. **Small–Medium.**
- **Epic 12 (small, parallelizable):**
  - **G4 location toggle** — add `location_dependent` to `SkillForm` + `SkillCreateInput`/`SkillUpdateInput` + patch body. **FE-only, trivial.** Backend already accepts it.
  - **G5 audit icons** — add the two missing event types to `eventTypeIconMeta.ts`; decide whether `invocation.success` keeps `play` or gets a distinct glyph; verify non-play icons render (blocked today partly by admin/cert events being org-fenced — cross-check with the 9.2 org-fence note). **FE-mostly.**
  - **G3 audit context names** — backend enriches the audit response with resolved Client/Project/Study/Location names (join ltree UUID segments → entity names); FE renders names with a graceful "(deleted)" fallback. **Thin BE + FE.**
  - **G2 duplicate-run warning** — advisory check in `queue_invocation` (or a pre-flight endpoint) that hashes `(skill_id, version, resolved_context, inputs)` against recent completed jobs and returns a **warning** the Run Console surfaces as a confirm-before-spend dialog (advisory, non-blocking — user can proceed). **Thin BE + FE.**

---

## Section 3 — Recommended Approach

**Selected path: Hybrid — Option 1 (Direct Adjustment, forward) + two new epics.** No rollback, no MVP reduction (the ask *expands* capability).

- **Two new epics, split by weight and dependency (Project Lead's call):**
  - **Epic 11** = the heavy, architecture-dependent AI-integration + promotion work — deserves its own architecture pass and PM/Architect involvement.
  - **Epic 12** = the four small, independent UX fixes — decoupled so they ship on their own cadence and deliver visible value immediately, without waiting on Epic 11's architecture.
- **Why not the alternatives.** *Rollback (Option 2):* nothing is wrong to revert — rejected. *MVP reduction (Option 3):* opposite of the ask — rejected. *One mega-epic:* rejected — it would gate the trivial G4 toggle behind the largest, riskiest LLM-on-registration work; splitting lets Epic 12 ship this sprint. *Bundle follow-ups into Epic 11:* rejected for the same reason (Project Lead chose the split).

**The two safety guarantees that make the AI centerpiece trustworthy** (baked into the ACs, not aspirational):
1. **Structural** — the AI authors *only* the adapter shim + manifest; the skill's core logic files are stored **byte-for-byte unchanged** (content-addressed checksums prove it). "Without changing what it does" is a mechanical invariant, not a hope.
2. **Governance** — the adapted skill re-enters the **two-key certification** gate before `client_ready`. An AI-proposed adapter cannot reach clients without human technical + methodological sign-off.
Plus the **human-approve gate** at registration (propose, never auto-apply).

**Sequencing recommendation.**
1. **Architecture first** — Winston authors the two Epic 11 ADRs (AI-integration seam + promotion/bundle portability) **before** Epic 11 stories are detailed.
2. **Epic 12 in parallel / immediately** — independent of Epic 11 architecture; can start now. Suggested order: **G4 (trivial) → G5 → G3 → G2**.
3. **Epic 11 story order** — 11.1 ZIP bundle upload → 11.2 standardized entrypoint contract + registration validation → 11.6 UI new-version authoring (draft-edit + version-on-publish; depends on 11.1 for the hybrid-ZIP path) → 11.3 AI integration assistant (propose→approve, adapter-only, re-cert) → 11.4 export/import bundles → 11.7 run older version to compare → 11.5 in-app promote (Phase-2 design + stub). Each detailed one at a time via `create-story`. (11.6/11.7 are versioning stories; 11.7 is independent and can slot anywhere after 11.1.)

**Effort / risk.** Epic 11: **High** effort, **Medium–High** risk (LLM-on-registration is a new seam + external-artifact promotion is a PHI/IP surface; mitigations are the human gate, adapter-only constraint, re-certification, and signed content-addressed bundles). Epic 12: **Low–Medium** effort, **Low** risk (in-place tweaks over stable APIs; G4 is near-trivial). Timeline: Epic 12 is quick net value now; Epic 11 is a substantial forward investment gated on architecture.

---

## Section 4 — Detailed Change Proposals

> Story bodies (full Given/When/Then ACs, dev-context) are authored later via `create-story`. Below are the epic/PRD/architecture/status edits and the story stubs (goal + AC skeleton) that anchor them.

### 4.1 — NEW epic file: `planning-artifacts/epics/epic-11-ai-assisted-skill-integration-and-promotion.md`

```
# Epic 11: AI-Assisted Skill Integration & Environment Promotion

Vitalief can on-board a client-provided skill onto the platform with AI assistance —
the platform proposes a standardized adapter + manifest so the skill fits the runtime
contract *without changing what the skill does* — register true multi-file ZIP bundles,
promote certified skills to higher environments (export/import now; in-app promote next),
and iterate via new immutable versions. Replaces the per-skill hand-written adapter shim
(Epic 5.5 retro Action Item 1) with a standardized contract + an AI integration assistant.

FRs covered: SKL-01..SKL-08 (new), REG-01 (amended — ZIP bundle built), REG-02 (amended —
draft-mutable versioning), EXE-03 (adjacent — code-driven contract standardized).

## Story 11.1: Multi-File ZIP Bundle Upload & Extraction
As an MA Tech developer, I want to upload a skill as a true multi-file ZIP bundle,
So that a client-provided multi-file skill is stored and versioned as-is (closing the
Phase-1 "manifest IS the artifact" deferral).
AC skeleton:
- Given a multipart ZIP upload with a manifest, Then the bundle is extracted, each file
  stored via StorageProvider, and the version records the full artifact set (immutable,
  content-addressed) — the skill's core files are stored byte-for-byte.
- Given a bundle missing a required manifest field, Then registration is rejected 422
  naming the field (existing load-bearing-schema discipline preserved).
- Given the current inline-string path, Then it still works (additive, not a breaking swap).

## Story 11.2: Standardized Entrypoint Contract + Registration-Time Validation
As the platform, I want one standardized code-driven entrypoint contract enforced at
registration, So that skills stop needing bespoke hand-written adapter shims (Epic 5.5
retro AI1). 
AC skeleton:
- Given the canonical contract run(input_path, output_dir, params: dict), Then the
  registration validator checks the declared entrypoint's *callable signature* (not just
  the module:callable string format it checks today) and rejects a non-conforming skill
  with a clear, specific error.
- Given a conforming skill, Then no adapter is needed and it runs on the existing
  code_driven_executor runner unchanged.

## Story 11.3: AI Skill Integration Assistant (Propose → Human-Approve, Adapter-Only)
As an MA Tech developer on-boarding a non-conforming client skill, I want the platform to
analyze it and PROPOSE a standardized adapter + manifest for my review, So that I don't
hand-write a shim — and I stay in control of what registers.
AC skeleton:
- Given a client skill that doesn't match the 11.2 contract, When I request AI assistance,
  Then the assistant analyzes the entrypoint signature / arg shape / output envelope and
  GENERATES a proposed adapter shim + manifest, presented for review as a diff.
- Given the proposal, Then the AI has authored ONLY the adapter + manifest — the skill's
  core logic files are byte-for-byte unchanged (verified by checksum); the review UI shows
  exactly what would be added, and nothing in the core is modifiable by the AI.
- Given I approve (optionally after editing), Then the skill registers with the adapter as
  part of its immutable bundle; if I reject, nothing registers.
- Given an adapted skill, Then it must pass the existing two-key certification before it
  can reach client_ready (governance re-run — no AI-authored adapter reaches clients
  un-certified).
- Reference case: the assistant can reproduce the velara-protocol-extractor adapter
  (params-dict → named-kwargs bridge) that was hand-written in Epic 5.5.

## Story 11.4: Export / Import Portable Skill Bundles
As a Vitalief operator, I want to export a skill+version to a portable signed bundle and
import it into another environment, So that a skill built in dev can move to staging/prod
without hand re-registration.
AC skeleton:
- Given a skill version, Then export produces a signed, content-addressed portable bundle
  (manifest + artifact files + metadata) that validates on import.
- Given an import into a target environment, Then the skill+version is recreated immutably;
  a tampered/invalid bundle is rejected; PHI/IP boundary is respected (bundle contents are
  the skill artifact only — documented in the ADR).
- Given lifecycle governance, Then import lands the skill in an appropriate non-client_ready
  state so target-env certification applies (no promotion of trust across envs by file copy).

## Story 11.5: In-App Environment Promotion (Phase-2 Design + Stub)
As a Vitalief operator, I want a "Promote to staging/prod" action that copies a certified
skill version across environments in-app, So that promotion needs no file download/upload.
AC skeleton (Phase-2 target — design + minimal seam this epic; full build deferred):
- Given a client_ready skill, Then the promote action is available; the architecture for
  the authenticated service-to-service cross-env copy is specified (ADR); a stub/seam lands
  so Phase 2 builds against it. (Export/Import 11.4 is the Phase-1 mechanism.)

## Story 11.6: Author New Skill Versions From the UI (Draft-Edit + Version-on-Publish)
As an MA Tech developer, I want to create new versions of a skill from the UI — edit
content in place for prompt/code skills, upload a new ZIP for hybrid skills — So that I can
iterate without hand-calling the API.
AC skeleton:
- Given a DRAFT prompt/code skill, When I edit its content in the UI and save, Then the
  current draft version's content is updated in place (new mutable-draft backend path);
  the SkillEdit form gains a content editor and a createVersion FE API client (neither
  exists today — SkillEdit only PATCHes metadata).
- Given a DRAFT hybrid skill, When I upload a new ZIP bundle (via Story 11.1), Then it
  replaces the draft's artifact and is marked the current draft content.
- Given I PUBLISH a draft (advance its lifecycle), Then an IMMUTABLE version is minted
  (existing POST /versions immutability + auto-bump), and — per the existing rules — a
  client_ready skill publishing a new version resets to draft and flags derived children
  for re-cert.
- Given a certified/published version, Then it remains immutable (draft-mutability never
  applies to a non-draft version — the strict immutability invariant holds outside draft).

## Story 11.7: Run an Older Skill Version to Compare (admin / ma_tech)
As an admin or MA Tech developer, I want to run a specific older version of a skill, So
that I can compare its output against the current version.
AC skeleton:
- Given InvocationRequest gains an optional version field, When an admin/ma_tech caller
  supplies it, Then the run pins to THAT SkillVersion instead of current_version; the job +
  audit already record skill_version, so the comparison is traceable automatically.
- Given a client or consultant caller (or no version supplied), Then the run uses
  current_version as today — version selection is grantor-gated (_GRANTOR_ROLES already
  exists; reuse it), so only admin/ma_tech can pin an arbitrary version.
- Given a nonexistent or retired-skill version, Then the request is rejected with a clear
  error (no job queued to a bogus version — mirror the existing NoCurrentVersionError guard).
```

### 4.2 — NEW epic file: `planning-artifacts/epics/epic-12-skill-and-audit-lifecycle-polish.md`

```
# Epic 12: Skill & Audit Lifecycle Polish

A batch of independent, high-value fixes to skill authoring and the audit surface, decoupled
from Epic 11 so they ship on their own cadence.

FRs covered: (new small rows) duplicate-run advisory, audit name resolution, location-
dependent authoring control, audit event iconography.

## Story 12.1: Location-Dependent Authoring Control (FE form gap)
As an MA Tech developer, I want a "location-dependent" toggle in the skill create/edit form,
So that I can mark a skill site-specific without a direct API call.
AC skeleton:
- Given the skill form, Then a location_dependent toggle is present; create and edit send it;
  the backend already accepts it (model + schemas + route wired — this is FE-only).
- Given an existing location-dependent skill, Then the edit form reflects its current value.

## Story 12.2: Audit Log Context Names (backend-enriched)
As a consultant reviewing the audit log, I want Client/Project/Study/Location shown by NAME,
not raw UUIDs, So that the audit trail is human-readable.
AC skeleton:
- Given an audit entry with an ltree hierarchy_path of UUID segments, Then the audit query
  API resolves each segment to its entity name server-side and returns names alongside the
  raw path (one place — used by list, detail panel, and fan-out children).
- Given a deleted/unknown entity, Then a graceful fallback ("(deleted <type>)") renders.
- Given the Run Console live context panel, Then it too shows names, not the raw ltree path.

## Story 12.3: Distinct Audit Event Icons
As a consultant scanning the audit log, I want a distinct icon per event type, So that I can
tell invocations, grants, certifications, lifecycle, and provisioning apart at a glance.
AC skeleton:
- Given the event-type icon map, Then the two unmapped event types (admin.user_provisioned,
  admin.user_invite_resent) get distinct icons and the play default no longer masks them.
- Given invocation.success vs other invocation outcomes, Then each renders a visually
  distinct icon (decide: keep play for success, distinct for failure/cancelled/blocked/
  fan_out — the map already differentiates these; verify they actually render).

## Story 12.4: Duplicate-Run Cost Warning (advisory)
As a consultant, I want a warning when I'm about to run a skill with the SAME inputs in the
SAME context as a recent completed run, So that I don't spend AI budget on a duplicate.
AC skeleton:
- Given a run request, When an identical (skill_id, version, resolved_context, inputs-hash)
  completed job exists recently, Then the platform surfaces an advisory warning (with a link
  to the prior result) BEFORE spending — the user may proceed (non-blocking) or reuse.
- Given no prior match, Then no warning; normal flow. Hook point: queue_invocation before
  create_job (inputs already hashable: file_ref_ids + inputs).
```

### 4.3 — Epic list: `planning-artifacts/epics/epic-list.md`

- ADD a dated changelog note at the top (2026-07-06: correct-course — new Epic 11 + Epic 12; see this proposal).
- ADD two new top sections mirroring the existing one-liner convention (Epic 11 + Epic 12 summaries as above).

### 4.4 — PRD: `planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md`

**New §5.2a — Skill Integration & Promotion (Epic 11) — ADD `SKL-*`:**
```
| SKL-01 | Skills can be uploaded as a multi-file ZIP bundle; the bundle is extracted and
          stored as the immutable, content-addressed versioned artifact. | P1 (Epic 11) |
| SKL-02 | A standardized code-driven entrypoint contract (run(input_path, output_dir,
          params: dict)) is enforced at registration, so conforming skills need no adapter. | P1 (Epic 11) |
| SKL-03 | The platform can analyze a non-conforming client skill and PROPOSE a standardized
          adapter + manifest for human review, without modifying the skill's core logic
          (adapter-only; core files stored byte-for-byte unchanged). | P1 (Epic 11) |
| SKL-04 | An AI-proposed adapter is applied only on human approval and the adapted skill must
          re-pass two-key certification before client_ready. | P1 (Epic 11) |
| SKL-05 | Skills can be exported to and imported from a signed, portable bundle file to move
          between environments. | P1 (Epic 11) |
| SKL-06 | Skills can be promoted to higher environments in-app (service-to-service), without
          a file download/upload. | P2 (Epic 11) |
| SKL-07 | New skill versions can be authored from the UI — in-place content editing for
          prompt/code skills and new-ZIP upload for hybrid skills — with draft content
          mutable in place and an immutable version minted on publish. | P1 (Epic 11) |
| SKL-08 | Admin and MA Tech users can invoke a specific (older) skill version to compare
          outputs across versions; other roles run the current version. | P1 (Epic 11) |
```
> **Amends REG-01:** the multi-file ZIP bundle is now *built*, not only architected. **Absorbs Epic 5.5 retro Action Item 1** (standardize entrypoint contract) as SKL-02. **Amends REG-02** — SKL-07's draft-mutability softens the strict "versions are immutable" invariant *for the draft state only* (published versions remain immutable). REG-08 (version pinning to Projects/Engagements, P2) stays distinct — that is scoping a version to an engagement, not selecting a version to run.

**New skill/audit polish rows (Epic 12) — ADD (under §5.2 / §5.11):**
```
| REG-10 | The skill create/edit UI exposes a location-dependent authoring control (LOC-01
          is enforced at execution but was previously unsettable from the UI). | P1 (Epic 12) |
| USE-07 | Audit log displays resolve hierarchy UUID segments to human-readable
          Client/Project/Study/Location names. | P1 (Epic 12) |
| USE-08 | Audit log entries render a distinct icon per event type. | P2 (Epic 12) |
| INV-10 | Before executing, the platform warns when a run duplicates a recent completed run
          with identical inputs and context (advisory, non-blocking). | P2 (Epic 12) |
```
> Final IDs/section placement are the PM's call at apply time; namespaces `SKL-*` and `ENV-*` are confirmed free.

### 4.5 — Architecture: `planning-artifacts/architecture/core-architectural-decisions.md`

- ADD ADR block: **AI Skill Integration Assistant** — the new LLM seam on the *registration* path (register is LLM-free today); the adapter-only enforced boundary + byte-for-byte core preservation; propose→human-approve→certification-re-run flow; how a proposed/approved adapter is persisted into the immutable bundle.
- ADD ADR block: **Environment Promotion & Bundle Portability** — export/import signed content-addressed bundle format + PHI/IP boundary reasoning (artifacts leave the platform in Phase 1); the Phase-2 in-app service-to-service promote path (auth, promotable lifecycle states, cross-env identity, why trust does not copy across envs).
- ADD (smaller) note: **multi-file ZIP bundle storage** resolves the deferred "manifest-as-artifact" model into per-file `StorageProvider` storage.

### 4.6 — `sprint-status.yaml`

- Add `epic-11: backlog` + `11-1..11-7` as `backlog`; `epic-11-retrospective: optional`.
- Add `epic-12: backlog` + `12-1..12-4` as `backlog`; `epic-12-retrospective: optional`.
- Update the `last_updated` header note (2026-07-06 correct-course; new Epics 11 + 12).
- Do **not** flip any prior epic's status.

---

## Section 5 — Implementation Handoff

**Scope classification: Major** (two new epics + new PRD FRs + two architecture ADRs) — but cleanly decomposable, and Epic 12 is independently shippable.

| Work | Recipient | Deliverable |
|---|---|---|
| Epic files + epic-list + PRD FR edits + sprint-status | **PO / Developer** (this workflow applies them on approval) | Updated artifacts (this proposal's §4) |
| Two Epic 11 architecture ADRs (AI-integration seam + promotion/bundle portability) | **Architect (Winston)** | ADR blocks **before** Epic 11 stories are detailed |
| UX for the two net-new Epic 11 surfaces (AI review screen; export/import + promote) | **UX (Sally)** | Designs before 11.3 / 11.4 dev |
| Story detailing (11.1–11.5, 12.1–12.4) | **create-story** per story | Full context-engineered story files |
| Implementation | **Developer (dev-story)** | Code, per story, after each is `ready-for-dev` |

**Success criteria.**
- **Epic 11:** an MA Tech dev uploads a multi-file client skill; the platform proposes a standardized adapter the dev approves (skill core provably unchanged); the adapted skill certifies and runs; new versions are authored from the UI (edit prompt/code content; upload a new hybrid ZIP), draft-mutable and immutable-on-publish; an admin can run an older version to compare outputs; and the skill can be exported/imported (and, Phase 2, promoted in-app) into staging/prod — **no hand-written shim, no manual re-registration.**
- **Epic 12:** a skill can be marked location-dependent from the form; the audit log shows names and distinct per-event icons; and a duplicate run warns before spending AI budget.

**Recommended immediate next steps (post-approval):**
1. Apply the §4 artifact edits (this workflow).
2. Winston authors the two Epic 11 ADR blocks (§4.5).
3. Start **Epic 12** in parallel now (independent of Epic 11 architecture): `create-story 12-1` (trivial location toggle) → 12-2 → 12-3 → 12-4.
4. After the ADRs land: `create-story 11-1` → 11-2 → 11-3 → 11-4 → 11-5, in order.
```
