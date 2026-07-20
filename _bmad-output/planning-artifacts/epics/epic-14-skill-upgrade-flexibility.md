# Epic 14: Skill Upgrade Flexibility

> **Created 2026-07-20** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-20.md`). Trigger: while upgrading two existing hybrid skills after Epic 13 closed, the Project Lead hit two hard walls — a hybrid skill cannot change manifest shape (LLM-driven → code-driven) across versions (`HYBRID_SHAPE_MISMATCH`), and a malformed code-driven bundle 422s on the upgrade path with no AI-assist offered (`missing required field 'requirements'`) even though the AI adapter exists for exactly this at initial registration. A third gap surfaced: the FE never exposes the version field, so there is no way to choose an explicit/major increment. Investigation confirmed the shape-lock is a **projection guard**, not execution-critical — the executor already routes per-version on manifest bytes (`velara-api/app/services/execution_service.py:803`), so mixed-shape histories already run correctly. **Epic 11 stays `done`** — this extends its versioning/adapter model forward (FR amendments only, no reopen), the same way Epic 11 extended 5.5.

Vitalief can evolve an existing skill across a manifest-shape change (LLM-driven ↔ code-driven) as a normal new version, get the same AI adapter assistance on the **upgrade** path that exists at initial registration, and set an explicit version number from the UI instead of only auto-bumping minor. Removes three friction points that force "register a brand-new skill" (losing identity/lineage) or hand-API-calls when iterating on a real client skill.

**FRs covered:** SKL-02 (amended — versioning no longer shape-locked), SKL-03 (amended — AI-assist adapter extends to the create-version path), REG-02 (amended — explicit version selection surfaced in the UI). Supersedes the Story 5.5.1 "single manifest shape per skill" invariant and amends Epic 11 ADR #3 (Draft-Mutable Versioning) — the amendment is inline in Story 14-1.

**Sequencing:** After Epic 13. Three stories: **14-1** (relax shape-lock + per-version egress migration + inline ADR amendment) → **14-2** (AI adapter on the upgrade path; depends on 14-1 for the LLM→code case) → **14-3** (FE explicit-version increment; independent, shippable first). **Recommended dev order: 14-3 → 14-1 → 14-2** (ship the safe independent one first; 14-2 is gated on 14-1).

**Safety guarantees carried forward from Epic 11 (baked into ACs, not aspirational):** the AI adapter (14-2) still authors *only* the adapter+manifest, core files byte-for-byte unchanged (checksum-proven); a shape-changed or adapted skill re-enters two-key certification before `client_ready`; the shape-lock relaxation (14-1) preserves per-version immutability (only `draft` is mutable) and the "a ZIP bundle requires a hybrid skill and is always code-driven" check.

---

## Story 14.1: Relax the Hybrid Manifest Shape-Lock

As an MA Tech developer iterating on a hybrid skill,
I want to publish a code-driven version of a skill that started LLM-driven (and vice versa),
So that evolving a real skill's implementation doesn't force me to abandon it and register a brand-new skill, losing its identity and lineage.

**Context / why this is safe (from investigation):** The shape-lock (`HybridShapeMismatchError`, `velara-api/app/services/skill_service.py:170`) is **not** load-bearing for execution — the executor sniffs each version's manifest bytes independently (`execution_service.py:803`, `is_code_driven_manifest`), never reading `skill.schema_version`. The guard's only real job is keeping two **projection columns** on the skill row (`schema_version`, `egress`) from going stale, because the code only ever *sets* them from a code-driven manifest and never resets them on a downgrade. Relax the guard + fix the projection + fix a latent export egress leak, and cross-shape versioning is safe.

**Acceptance Criteria:**

1. **AC1 — A hybrid skill may change manifest shape across versions.**
   **Given** a hybrid skill whose current version is LLM-driven
   **When** I create a new version with a code-driven bundle/manifest (or the reverse)
   **Then** the new version is created and becomes current — `HYBRID_SHAPE_MISMATCH` is no longer raised for a cross-shape version bump. The 4 guard sites (`skill_service.py:1142, 1171, 1367, 1393`) drop *only* the cross-shape comparison; the "a ZIP bundle requires a hybrid skill and is always code-driven" check (`InvalidBundleError`) is **preserved**.

2. **AC2 — The skill-row projection is re-derived on every version bump, never left stale.**
   **Given** a code-driven skill upgraded to an LLM-driven version
   **When** the version is created
   **Then** `skill.schema_version` is reset to `NULL` **and** `skill.egress` is reset to `[]` (the LLM-version case); and for a code-driven version they are set from the new manifest as today. The row always reflects the **current** version's shape — no stale code-driven metadata after a downgrade. (Add the missing `else` branch at both the create-version [~1214] and draft-edit [~1419] sites; and set `new_version.schema_version` from the actual new version, not the possibly-stale row.)

3. **AC3 — Export egress is per-version, not row-level (fixes a latent leak).**
   **Given** an export of an old LLM version of a now-code-driven skill
   **When** the export envelope is built
   **Then** its `egress` reflects **that version's** shape (empty for LLM), not the skill row's current code-driven egress list. Today `skill_export.py:214` reads row-level `egress` into a per-version envelope — a leak that is latent even now via draft edits and becomes routine once shapes can change. Fix requires a **new `skill_versions.egress` column** snapshotted per version, with a backfill migration.

4. **AC4 — Per-version immutability and draft-only mutability are unchanged.**
   **Given** a published/certified version
   **When** anyone attempts to mutate it
   **Then** it stays immutable — this story relaxes *cross-shape*, not immutability. Draft-mutable-in-place (Epic 11 Story 11.6) still applies only to `draft`.

5. **AC5 — Paired/derived lineage behaves correctly across a parent shape-flip.**
   **Given** a `paired` LLM-driven parent with `client_facing` derived children
   **When** the parent is bumped to a code-driven version
   **Then** existing children are unaffected (derivation snapshots `{parent_skill_id, parent_version}`) and are flagged `review_required=True` via the existing bump fan-out — the intended "parent changed, re-review" signal. `PairedSkillHasChildrenError` (visibility guard) is untouched.

**Inline ADR Amendment (supersedes Story 5.5.1 review-D1 + amends Epic 11 ADR #3):**
> **Decision:** A hybrid skill's manifest shape (LLM-driven ↔ code-driven) MAY change across versions. The skill-row `schema_version`/`egress` are a **re-derived projection of the current version**, not an immutable per-skill property. Egress is snapshotted **per version** (`skill_versions.egress`) so exports and historical reads reflect the shape of the version in hand.
> **Why safe:** execution already routes per-version on manifest bytes; the old invariant protected only the row projection, which is now correctly reset on every bump. Per-version immutability and draft-only mutability are unchanged.
> **Supersedes:** Story 5.5.1 review-D1 "single shape per skill." **Amends:** Epic 11 ADR #3 (Draft-Mutable Versioning) to add the cross-shape allowance.

**Notes:** No new audit event types (no `audit_categories.py` / guard-test interaction). The migration is the one heavyweight; `docs/api-spec.json` unchanged (no request-contract change).

---

## Story 14.2: AI Adapter Assist on the Skill Upgrade Path

_Depends on: Story 14-1 (for the LLM→code case)._

As an MA Tech developer upgrading a skill with a non-conforming code-driven bundle,
I want the same AI adapter assist that exists at initial registration to be offered when I create a **new version**,
So that a bundle whose entrypoint signature drifted doesn't hard-fail with a 422 and force me out to hand-fix it — the propose→approve→register loop already exists; I just want it reachable from the upgrade path.

**Context (from investigation):** The AI adapter (`propose_adapter`, `velara-api/app/services/skill_integration_assistant.py:830`) is **skill-agnostic and already reuses the `bundle_key` staging** the create-version path uses (`skills.py:670`). The "apply" step is client-side (the FE writes the proposed adapter+manifest into the bundle, re-stages, and re-calls create). So this is **mostly FE orchestration** — on an adaptable 422 from an upgrade, offer the existing 11.3/11.9 review panel keyed off the same error code, then re-POST `/versions`. Minimal-to-zero backend change; the propose route works verbatim for upgrades.

**Acceptance Criteria:**

1. **AC1 — An adaptable upgrade failure offers AI-assist instead of a dead 422.**
   **Given** `POST /skills/{id}/versions` fails with `ENTRYPOINT_CONTRACT_VIOLATION` where `category == "signature"` (the adaptable case)
   **When** the FE surfaces it
   **Then** it offers "AI-assist this upgrade," opening the **same** review panel from Stories 11.3/11.9 — one review surface, now a third entry point. A `category == "missing"` failure does **not** offer the assist.

2. **AC2 — The propose→approve→re-version loop reuses the existing machinery unchanged.**
   **Given** I request AI-assist on the staged upgrade bundle
   **When** the propose call runs
   **Then** it calls the existing `/integration-assistant/propose` with the same `bundle_key` + declared entrypoint; the AI authors **only** the adapter+manifest (core files byte-for-byte unchanged, checksum-proven — the Epic 11 guarantee holds); on approve, the FE writes the two members, re-stages, and re-POSTs `/versions` through the **unmodified** create-version path (including the registration-time `validate_entrypoint_contract` re-check). No forked "AI register" branch.

3. **AC3 — The LLM→code upgrade case works end-to-end (depends on 14-1).**
   **Given** an LLM-driven skill and a code-driven replacement bundle
   **When** I upgrade with AI-assist
   **Then** it succeeds — because 14-1 removed the shape-lock that previously fired *before* the adapter was reachable (`skill_service.py:1142`). **⚠️ Without 14-1 this AC cannot pass** — the assist would still 422 on `HYBRID_SHAPE_MISMATCH`. This dependency is explicit.

4. **AC4 — The paid LLM call stays behind the stricter gate; audit is preserved.**
   **Given** the propose route's `RejectNonGrantor` (admin/ma_tech) gate and its `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED` audit (success + failure, with token spend)
   **When** the assist is used from the upgrade path
   **Then** both are preserved — the paid call stays on the propose route (NOT folded into the looser-gated create-version endpoint), and the adapter-proposed audit fires as today. (Design (A) from the investigation — keep the split loop; reject the inline `?adapt=true` design that would smuggle a paid LLM call behind create-version's looser gate.)

5. **AC5 — The `missing 'requirements'` case is handled deterministically, not by the LLM.**
   **Given** a code-driven upgrade bundle whose manifest omits `requirements` but which ships a `requirements.txt` lockfile
   **When** it is validated
   **Then** the requirement is filled **deterministically from the bundled lockfile** (mirroring the Story 11.9 synthesis path), not fabricated by the LLM; a bundle with **no** lockfile and no `requirements` stays a hard 422 (a code-driven skill with no declared deps can't be installed — defaulting to `[]` is explicitly rejected). This closes the second error the trigger reported without pretending it's an adapter job.

**Notes:** No new audit events (reuses `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED`). Mostly FE + a small deterministic-backfill BE change.

---

## Story 14.3: Expose Explicit Version Increment in the Skill Edit UI

_Independent — shippable first._

As an MA Tech developer publishing a new skill version,
I want to set the version number in the UI (e.g. choose a major bump `1.4.0 → 2.0.0`) instead of only getting an automatic minor bump,
So that I control the semver signal a version change sends, without hand-calling the API.

**Context (from investigation):** The backend already supports this — `create_version` accepts an **optional `version`** (`velara-api/app/services/skill_service.py:1094`): omit it and it auto-bumps minor (`1.0.0 → 1.1.0`, `skill_service.py:1124`); supply one and it's accepted only if strictly greater than current (`skill_service.py:1125`). `SkillVersionCreate` already carries the field. **The FE version-authoring UI (Story 11.6) just never surfaces it** — so this is a pure FE gap. No backend change.

**Acceptance Criteria:**

1. **AC1 — The version-authoring UI exposes an optional version field.**
   **Given** the new-version / publish flow in the skill edit screen (the Story 11.6 `SkillEdit` + `createVersion` surface)
   **When** I author a new version
   **Then** an optional **Version** input is shown, pre-filled with (or placeholder-showing) the next auto-minor-bump so the default behavior is unchanged if I leave it alone.

2. **AC2 — Leaving it blank preserves today's auto-bump.**
   **Given** I don't touch the version field
   **When** I publish
   **Then** the request omits `version` and the backend auto-bumps minor exactly as today — no behavior change for the default path.

3. **AC3 — An explicit version is validated with a clear inline error.**
   **Given** I enter a version
   **When** it is not strictly greater than the current version (or not canonical semver)
   **Then** the UI surfaces the backend's `INVALID_VERSION` (422) as a clear inline field error ("must be greater than current `X.Y.Z`") before or upon submit — the user isn't left guessing. (Client-side semver + greater-than hint is a nice-to-have; the backend remains the source of truth.)

4. **AC4 — Applies to both the inline-content and ZIP-bundle new-version paths.**
   **Given** a prompt/code skill (inline content) or a hybrid skill (ZIP bundle) new version
   **When** I set a version
   **Then** the field works identically on both authoring paths (both route through `create_version`'s `version` param).

**Notes:** No backend change, no migration, no new audit event, no `docs/api-spec.json` change — the field already exists in the contract. Smallest of the three; safe to ship first and independent of 14-1/14-2.

---

## Story Sequencing & Dependencies

| Story | Depends on | Ship order | Weight |
|-------|-----------|-----------|--------|
| **14-3** FE explicit version increment | — | 1st (independent) | Light (FE only) |
| **14-1** Relax shape-lock + egress migration | — | 2nd | Heavy (invariant + migration) |
| **14-2** AI adapter on the upgrade path | **14-1** | 3rd | Medium (mostly FE) |

**Recommended order:** 14-3 → 14-1 → 14-2. Per `create-story` discipline, each story is expanded to full implementation detail one at a time when picked up — these epic-level ACs are the contract, not the implementation plan.
