# Sprint Change Proposal — 2026-07-20

**Skill Upgrade Flexibility (New Epic 14)**

Prepared via the `correct-course` workflow. Change scope: **Moderate** (backlog addition — one new epic, three stories; one architecture ADR amendment inline; one DB migration). Mode: Incremental (all four proposals approved individually).

---

## Section 1 — Issue Summary

**What triggered it.** While upgrading two existing hybrid skills after Epic 13 closed, the Project Lead hit two hard walls and surfaced a third gap:

1. `Code-driven hybrid manifest is missing required field 'requirements'.` — an upgrade bundle whose manifest omits `requirements` hard-fails 422 with no assist.
2. `Cannot change a hybrid skill's manifest shape across versions: the current version is LLM-driven; the new version is code-driven. Register a new skill for a different shape.` — the shape-lock blocks evolving an LLM-driven skill into a code-driven one.
3. **No UI version increment.** The backend `create_version` already accepts an optional explicit `version`, but the FE never surfaces it — so users can only get an automatic minor bump, never choose a major increment, without hand-calling the API.

**Why it matters.** The platform has an **AI adapter** built precisely to standardize a non-conforming skill (Epic 11, Stories 11.3/11.9), yet it is not reachable from the upgrade path, and the shape-lock fires before the adapter could even help. Iterating on a real client skill therefore forces "register a brand-new skill" (losing identity/lineage) or out-of-band API calls.

**Evidence.** Both verbatim error strings above; a two-agent code investigation established:
- The shape-lock (`HybridShapeMismatchError`, `skill_service.py:170`) is a **projection guard, not execution-critical** — the executor routes per-version on manifest bytes (`execution_service.py:803`, `is_code_driven_manifest`), never on `skill.schema_version`. Mixed-shape version histories already execute correctly today.
- The AI adapter (`propose_adapter`, `skill_integration_assistant.py:830`) is **skill-agnostic and already reuses `bundle_key` staging** — the "apply" is client-side, so wiring it into upgrade is mostly FE orchestration.
- `create_version` already accepts an optional `version` (`skill_service.py:1094`); the FE gap is the only reason it can't be set.
- Two latent correctness bugs would surface if the shape-lock were lifted naively: the skill-row `schema_version`/`egress` projection is never reset on a downgrade, and `skill_export.py:214` reads row-level egress into a per-version envelope (a leak, latent even today via draft edits).

**Issue type:** Technical limitation discovered during use (not a failed approach, not a strategic pivot).

---

## Section 2 — Impact Analysis

**Epic impact.**
- No in-flight epic is affected — Epic 13 is `done` (7/7); all prior epics `done`.
- **New Epic 14** is added (distinct theme: skill-upgrade flexibility). Epic 11 (the conceptual parent — AI-assisted integration/versioning) stays `done`; Epic 14 extends it forward via FR amendments only, exactly as Epic 5.5 → Epic 11 did. No existing epic reopened or resequenced.

**Story impact.** Three net-new stories (14-1, 14-2, 14-3). No existing story changes.

**Artifact conflicts.**
- **PRD:** minor FR-amendment note — SKL-02 (versioning no longer shape-locked), SKL-03 (adapter extends to create-version), REG-02 (explicit version selection in UI). No MVP scope change.
- **Architecture:** Story 14-1 **supersedes the Story 5.5.1 "single manifest shape per skill" invariant** and **amends Epic 11 ADR #3 (Draft-Mutable Versioning)**. Per decision, this is handled as an **inline ADR-amendment section inside Story 14-1**, not a separate architect session.
- **UI/UX:** Stories 14-2 and 14-3 touch the Story 11.6 `SkillEdit` / version-authoring surface and reuse the 11.3/11.9 adapter review panel — no net-new screen.
- **Other / migration + testing:** Story 14-1 carries a **DB migration** (new `skill_versions.egress` column + backfill) and data-integrity tests (mixed-shape history, projection reset, per-version export egress). **No new audit event types** → no `audit_categories.py` / guard-test interaction. `docs/api-spec.json` unchanged (no request-contract change).

**Technical impact.** Backend: `skill_service.py` (guard relaxation + projection reset), `skill_export.py` (per-version egress), one migration, a deterministic `requirements`-from-lockfile backfill. FE: version-authoring form (14-3) + adapter-assist entry point on the upgrade 422 (14-2). Risk is concentrated in 14-1 (invariant + migration) and is Medium — the investigation proved the invariant is a projection guard, not execution-critical.

---

## Section 3 — Recommended Approach

**Selected: Option 1 — Direct Adjustment via a new Epic 14 (three stories).**

- **Option 2 (Rollback):** N/A — nothing to revert; this is forward scope.
- **Option 3 (MVP Review):** N/A — MVP unaffected; the change is additive flexibility.

**Rationale.** The three drivers are all skill-upgrade/versioning/AI-adapter concerns — squarely the domain Epic 11 established. Adding them as a clean new epic (rather than reopening the closed Epic 11) keeps the theme distinct and matches the project's established pattern of appending forward scope via correct-course. The heavy story (14-1) is isolated from the two lighter, partly-independent ones (14-2 depends on 14-1; 14-3 is fully independent and shippable first), so risk and dependency are cleanly separated.

**Effort:** Medium (14-1 has a migration + invariant change; 14-2 is mostly FE + a small deterministic backfill; 14-3 is FE-only). **Risk:** Medium, concentrated in 14-1. **Timeline:** additive; does not block anything in flight.

**Classification:** Moderate (backlog reorganization — new epic + stories, one inline ADR amendment, one migration; not a fundamental replan).

---

## Section 4 — Detailed Change Proposals

### 4.1 NEW Epic 14 — Skill Upgrade Flexibility
`planning-artifacts/epics/epic-14-skill-upgrade-flexibility.md`

Vitalief can evolve an existing skill across a manifest-shape change (LLM-driven ↔ code-driven) as a normal new version, get the same AI adapter assistance on the **upgrade** path that exists at initial registration, and set an explicit version number from the UI instead of only auto-bumping minor. Epic 11 stays `done` (FR amendments only, no reopen). FRs: SKL-02 (amended), SKL-03 (amended), REG-02 (amended). Supersedes Story 5.5.1 "single manifest shape per skill"; amends Epic 11 ADR #3 (inline in 14-1). Sequencing: after Epic 13; dev order **14-3 → 14-1 → 14-2**.

### 4.2 NEW Story 14-1 — Relax the Hybrid Manifest Shape-Lock
- **AC1** cross-shape version bump no longer raises `HYBRID_SHAPE_MISMATCH` (4 guard sites relax the cross-shape comparison only; bundle-is-code-driven check preserved).
- **AC2** skill-row projection (`schema_version`, `egress`) re-derived on every bump — reset to `NULL`/`[]` for an LLM version (adds the missing `else` at create-version ~1214 + draft-edit ~1419).
- **AC3** export egress is **per-version** — new `skill_versions.egress` column + backfill migration; `skill_export.py:214` repointed (fixes a latent leak).
- **AC4** per-version immutability + draft-only mutability unchanged.
- **AC5** paired/derived lineage correct across a parent shape-flip (children snapshot parent version; flagged `review_required`).
- **Inline ADR amendment:** shape may change across versions; row `schema_version`/`egress` is a re-derived projection; egress snapshotted per-version. Supersedes 5.5.1-D1; amends Epic 11 ADR #3.
- No new audit events; migration is the one heavyweight.

### 4.3 NEW Story 14-2 — AI Adapter Assist on the Skill Upgrade Path (depends on 14-1)
- **AC1** an adaptable upgrade 422 (`ENTRYPOINT_CONTRACT_VIOLATION`, `category=="signature"`) offers the existing 11.3/11.9 review panel; `category=="missing"` does not.
- **AC2** reuses the propose→approve→re-version loop unchanged (adapter authors only adapter+manifest, checksum-proven; re-POST through the unmodified create-version path).
- **AC3** LLM→code upgrade works end-to-end — **requires 14-1** (shape-lock previously fired before the adapter was reachable). Explicit dependency.
- **AC4** paid LLM call stays on the `RejectNonGrantor`-gated propose route; `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED` audit preserved (Design A; reject inline `?adapt=true`).
- **AC5** `missing 'requirements'` filled **deterministically from a bundled `requirements.txt`** (mirrors 11.9 synthesis); no-lockfile stays a hard 422 (defaulting to `[]` explicitly rejected). Not an LLM job.
- Mostly FE orchestration + a small deterministic-backfill BE change; no new audit events.

### 4.4 NEW Story 14-3 — Expose Explicit Version Increment in the Skill Edit UI (independent)
- **AC1** optional Version input in the 11.6 new-version/publish form, pre-filled with the next auto-minor-bump.
- **AC2** blank → omits `version` → backend auto-bumps minor (no behavior change).
- **AC3** explicit non-greater / non-semver → clear inline `INVALID_VERSION` error.
- **AC4** works on both inline-content and ZIP-bundle new-version paths.
- **No backend change, no migration, no new audit event, no `api-spec.json` change** — the field already exists in the contract. Smallest; shippable first.

---

## Section 5 — Implementation Handoff

**Scope classification: Moderate.**

- **Product Owner / planning:** create Epic 14 file; add the three stories to `sprint-status.yaml` as `backlog`; add the PRD FR-amendment note (SKL-02/SKL-03/REG-02). (This proposal + the epic header are the artifacts.)
- **Developer (via `create-story` → `dev-story` → `code-review`, per project discipline):** implement 14-3 first (independent, FE-only), then 14-1 (invariant + migration — the risk-bearing story; the inline ADR amendment is its architecture record), then 14-2 (adapter-on-upgrade; gated on 14-1). Each story expanded to full implementation detail at `create-story` time.
- **No architect session required** — the ADR change is folded into Story 14-1 per decision.

**Success criteria.** A hybrid skill can be upgraded LLM→code as a new version (14-1); an adaptable upgrade 422 offers AI-assist and the reference client skill upgrades end-to-end (14-2); a user can set an explicit/major version from the edit screen with auto-bump preserved as the default (14-3). Every story ships with tests + code review, matching the compliance-audited-codebase standard established through Epic 13.

---

## Dev order & dependencies

| Story | Depends on | Ship order | Weight |
|-------|-----------|-----------|--------|
| **14-3** FE version increment | — | 1st (independent) | Light (FE only) |
| **14-1** Relax shape-lock + egress migration | — | 2nd | Heavy (invariant + migration) |
| **14-2** AI adapter on upgrade path | **14-1** | 3rd | Medium (mostly FE) |
