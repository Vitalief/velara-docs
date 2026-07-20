---
baseline_commit: 6c6e97c (velara-api) / 61d3a3c (velara-web)
---

# Story 14.1: Relax the Hybrid Manifest Shape-Lock

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer iterating on a hybrid skill,
I want to publish a code-driven version of a skill that started LLM-driven (and vice versa),
so that evolving a real skill's implementation doesn't force me to abandon it and register a brand-new skill, losing its identity and lineage.

**Why this is safe (verified in source, not assumed):** The shape-lock (`HybridShapeMismatchError`, `skill_service.py:170`) is **not** load-bearing for execution — the executor sniffs each version's manifest bytes independently (`execution_service.py`, `is_code_driven_manifest`), never reading `skill.schema_version`. The guard's only real job is keeping two **projection columns** on the skill row (`schema_version`, `egress`) from going stale, because the code only ever *sets* them from a code-driven manifest and never *resets* them on a downgrade. Relax the guard + add the missing projection-reset `else` branches + snapshot egress per-version + fix a latent export egress leak, and cross-shape versioning is safe.

## Acceptance Criteria

1. **AC1 — A hybrid skill may change manifest shape across versions.**
   **Given** a hybrid skill whose current version is LLM-driven (or code-driven)
   **When** I create a new version with a code-driven bundle/manifest (or the reverse)
   **Then** the new version is created and becomes current — `HYBRID_SHAPE_MISMATCH` is **never raised** for a cross-shape version bump on either the `create_version` path or the `update_draft_content` path. The cross-shape comparison is dropped at **all 4 guard sites**; the separate **"a ZIP bundle requires a hybrid skill (bundles are code-driven hybrids)"** check (`InvalidBundleError`, 2 sites) is **preserved unchanged**.

2. **AC2 — The skill-row projection is re-derived on every version bump/edit, never left stale.**
   **Given** a code-driven skill upgraded to an LLM-driven version (the downgrade case that today would leave stale metadata)
   **When** the version is created (or the draft is edited in place to LLM-driven)
   **Then** `skill.schema_version` is reset to `NULL` **and** `skill.egress` is reset to `[]`; and for a code-driven version they are set from the new manifest as today. The row always reflects the **current** version's shape — no stale code-driven metadata after a downgrade. (Add the missing `else` branch at the `create_version` projection block **and** the `update_draft_content` projection block; and snapshot `new_version.schema_version` so it reflects the actual new version, not a possibly-stale row.)

3. **AC3 — Export egress is per-version, not row-level (fixes a latent leak).**
   **Given** an export of an old LLM version of a now-code-driven skill (or any non-current version)
   **When** the export envelope is built
   **Then** its `egress` reflects **that version's** shape (empty `[]` for an LLM version), not the skill row's current code-driven egress list. This requires a **new `skill_versions.egress` column** snapshotted per version (with a backfill migration), and repointing `skill_export.py`'s envelope builder to read `target_version.egress` instead of `skill.egress`. This leak is latent even today (an export of a non-current version after any egress change reads the wrong list); it becomes routine once shapes can change.

4. **AC4 — Per-version immutability and draft-only mutability are unchanged.**
   **Given** a published/certified version
   **When** anyone attempts to mutate it
   **Then** it stays immutable — this story relaxes *cross-shape*, not immutability. Draft-mutable-in-place (Epic 11 Story 11.6 — re-point the current version's artifact, no bump) still applies **only** to a `draft` skill; the `SkillNotDraftError` guard on the draft-content route is untouched.

5. **AC5 — Paired/derived lineage behaves correctly across a parent shape-flip.**
   **Given** a `paired` LLM-driven parent with `client_facing` derived children
   **When** the parent is bumped to a code-driven version
   **Then** existing children are unaffected (derivation snapshots `{parent_skill_id, parent_version}` — it does not re-copy the parent artifact) and are flagged `review_required=True` via the existing bump fan-out (the intended "parent changed, re-review" signal). `PairedSkillHasChildrenError` (the visibility-change guard, not the version-bump path) is untouched.

**Inline ADR Amendment (supersedes Story 5.5.1 review-D1 + amends Epic 11 ADR #3 — Draft-Mutable Versioning):**
> **Decision:** A hybrid skill's manifest shape (LLM-driven ↔ code-driven) MAY change across versions. The skill-row `schema_version`/`egress` are a **re-derived projection of the current version**, not an immutable per-skill property. Egress is snapshotted **per version** (`skill_versions.egress`) so exports and historical reads reflect the shape of the version in hand.
> **Why safe:** execution already routes per-version on manifest bytes (`is_code_driven_manifest` on each version's artifact), never on `skill.schema_version`; the old invariant protected only the row projection, which is now correctly reset on every bump/edit. Per-version immutability and draft-only mutability are unchanged.
> **Supersedes:** Story 5.5.1 review-D1 "single manifest shape per skill." **Amends:** Epic 11 ADR #3 (Draft-Mutable Versioning) to add the cross-shape allowance (the draft in-place edit path may now flip shape as well, with the same projection reset).

**Out of scope (do NOT touch):**
- The AI adapter on the upgrade path — that is **Story 14.2** (depends on this story for the LLM→code case). This story only removes the shape-lock so the adapter *becomes reachable*; it does not wire the adapter in.
- The `missing 'requirements'` deterministic backfill — also **Story 14.2** (AC5 there). This story does not change manifest-`requirements` handling.
- The FE explicit-version-increment field — that shipped as **Story 14.3** (done). No FE change is expected in this story.

## Tasks / Subtasks

- [x] **Task 1 — Add the per-version `skill_versions.egress` column (model + migration + backfill) (AC3)**
  - [x] Added `egress` to the `SkillVersion` model (`velara-api/app/models/skill.py`) — JSONB NOT NULL default `[]`, placed beside `schema_version`/`consumes`.
  - [x] New Alembic migration `velara-api/app/db/migrations/versions/0023_skill_version_egress.py`, chained off verified head `0022_skill_version_bundle`. `upgrade()` adds the column + backfills from `skills.egress` via `op.execute(UPDATE ... FROM ...)`; `downgrade()` drops the column. Backfill approximation documented in the migration docstring.
  - [x] Mirrored `0014`/`0013`/`0020` templates as planned.

- [x] **Task 2 — Relax the shape-lock at all 4 guard sites (AC1) — `velara-api/app/services/skill_service.py`**
  - [x] **Site A — `create_version`, bundle branch.** Dropped the cross-shape comparison/raise; kept `InvalidBundleError` runtime_type check.
  - [x] **Site B — `create_version`, inline branch.** Kept `new_is_code_driven` (used for parse routing); dropped the comparison/`_safe_delete`/raise block.
  - [x] **Site C — `update_draft_content`, bundle branch.** Same pattern as Site A.
  - [x] **Site D — `update_draft_content`, inline branch.** Same pattern as Site B.
  - [x] `HybridShapeMismatchError` class left defined (not raised anywhere now); docstring updated. Both inline invariant comment blocks (create_version bundle+inline, update_draft_content bundle) rewritten to describe the new re-derived-projection rule.

- [x] **Task 3 — Re-derive the projection on every bump/edit + snapshot egress per-version (AC2, AC3) — `velara-api/app/services/skill_service.py`**
  - [x] `create_version` projection block: added the missing `else` (resets `skill.schema_version`/`skill.egress` to `None`/`[]`); `new_version.egress = skill.egress` added alongside the existing `new_version.schema_version` snapshot.
  - [x] `update_draft_content` projection block: added the missing `else` (resets `skill.schema_version`/`skill.egress`); `current_ver.schema_version`/`current_ver.egress` now set unconditionally from the (freshly re-derived) `skill.*` values after the if/else, covering both branches.
  - [x] Both `create_skill` initial-version snapshot sites (`_create_skill_from_bundle` and the inline path in `create_skill`) now pass `egress=skill.egress` into the `SkillVersion(...)` constructor.
  - [x] Grep sanity check run — every `skill.egress =` write site is paired with a version-level snapshot; no orphan sites found.

- [x] **Task 4 — Fix the per-version export egress leak (AC3) — `velara-api/app/services/skill_export.py`**
  - [x] `export_skill_version`'s envelope builder: `"egress": skill.egress` → `"egress": target_version.egress`.
  - [x] `EXPORT_ENVELOPE_SCHEMA_VERSION` left unbumped — field set unchanged, only the value's source changed.

- [x] **Task 5 — Update the 3 shape-lock tests to assert the NEW behavior + add mixed-shape & projection-reset coverage (AC1, AC2, AC5) — `velara-api/tests/integration/api/test_skills.py`**
  - [x] `test_hybrid_version_shape_switch_rejected` → **`test_hybrid_version_shape_switch_allowed_projection_resets`**: both cross-shape bumps now assert 201 + correct projection reset (code→LLM: `schema_version is None`, `egress == []`; LLM→code: `schema_version == "0.3.0"`, `egress == [...]`).
  - [x] `test_bundle_version_cross_shape_rejected` → **`test_bundle_version_cross_shape_allowed`**: ZIP version of an LLM-driven hybrid now 201, projection set from the bundle manifest.
  - [x] `test_update_draft_content_bundle_cross_shape_rejected` → **`test_update_draft_content_bundle_cross_shape_allowed_projection_resets`**: cross-shape draft ZIP now 200, re-points in place, projection set.
  - [x] NEW `test_export_egress_is_per_version_not_row_level` (AC3): code-driven skill bumped to LLM; exports the OLD version by explicit `?version=0.3.0` (egress `["api.anthropic.com"]`) and the CURRENT version (egress `[]`) — reads `velara-export.json` out of the downloaded ZIP. Also covers the `create_skill` first-version snapshot (the old version's export only has the right egress if the very first version snapshotted it correctly).
  - [x] NEW `test_paired_parent_shape_flip_flags_child_lineage_unaffected` (AC5): paired LLM-driven parent + client_facing child; parent bumped to code-driven; child `review_required=True`, `derived_from` snapshot untouched.
  - [x] Reused `_CODE_DRIVEN_MANIFEST`/`_LLM_DRIVEN_MANIFEST`/`_internal_auth()`/`_export_skill`/`_download`/`_io_bytes`/`_create_paired_parent`/`_child_payload` — no new fixtures invented.

- [x] **Task 6 — Gates**
  - [x] Rebuilt the api image before running pytest in-container (`docker compose build api`).
  - [x] Migration round-trip verified: `alembic upgrade head` (clean apply, 0022→0023) then `alembic downgrade -1` then `alembic upgrade head` again — clean both directions.
  - [x] Full `test_skills.py` suite: **200 passed**, 0 failed (was 159 at the 11.6 baseline; this story added net new coverage). Two of my new tests initially failed on first run due to test-authoring mistakes (not source bugs) — fixed and re-verified green: (1) the paired-parent test's derived child inherited `runtime_type="hybrid"` from the parent by default and choked on non-JSON content — fixed by passing an explicit `runtime_type: "prompt"` in the derive payload; (2) the export-egress test queried the old version by the manifest's `schema_version` ("0.3.0") instead of the `SkillVersion.version` semver string ("1.0.0") — fixed to use the correct field.
  - [x] Full repo test suite: **1442 passed**, 1 pre-existing unrelated failure (`test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped` — the documented append-only-DB re-run-sensitivity flake from Story 13.6, in a file this story never touches).
  - [x] `ruff check` on all changed files → clean.
  - [x] **No `docs/api-spec.json` change** — confirmed via `git status` (no diff). `SkillVersionRead` (the version-read response schema) deliberately does not expose `egress` — it's a DB-internal projection consumed only by the export envelope builder, not part of the public read contract, so no schema/api-spec change was needed.
  - [x] **No new audit event types** — confirmed unchanged; guard registry untouched.
  - [x] **Discovered environment quirk (not a story bug):** the local `docker-compose.yml` `api` service sets `AUTH_BACKEND=cognito`, which makes `DevAuthProvider`-issued test tokens 401 across the ENTIRE suite (198 unrelated failures on first run) — this reproduces on unmodified `main` too (pre-existing environment default, not caused by this story). Fix: run pytest with `-e AUTH_BACKEND=dev` override, matching the documented project convention (project memory: "host pytest recipe AUTH_BACKEND=dev overrides .env cognito").

## Dev Notes

### The one heavyweight is the migration; everything else is surgical

This is a backend-only story (velara-api). **No FE change, no `docs/api-spec.json` change, no new audit event.** The single migration (`0023_skill_version_egress`) is the highest-risk artifact because a broken migration fails the entire test suite (autouse `alembic upgrade head`) and, on deploy, blocks the release. Get the column shape and backfill right first, then the code changes are mechanical.

### The invariant being relaxed is a projection guard, not an execution guard (this is the whole safety argument)

The shape-lock existed to keep `skill.schema_version`/`skill.egress` (two **row-level projection columns**) from going stale, because the code sets them from a code-driven manifest but never resets them. Execution does **not** read `skill.schema_version` — `execution_service` calls `is_code_driven_manifest` on **each version's own artifact bytes** to route LLM-driven vs code-driven per version. So mixed-shape version histories already execute correctly today; the guard only ever protected the projection. The fix is: (1) drop the guard, (2) add the missing `else` so the projection is *reset* (not just set) on every bump/edit, (3) snapshot egress per-version so exports/historical reads don't depend on the mutable row. After that, the projection can never be stale and there is no execution correctness gap.

### The two distinct checks at the guard sites — drop one, keep the other

At each bundle branch there are TWO guards that look similar:
- **KEEP:** `if skill.runtime_type != "hybrid": raise InvalidBundleError("A ZIP bundle ... requires a hybrid skill (bundles are code-driven hybrids).")` — this rejects a ZIP against a *prompt/code* (non-hybrid) skill. Still correct; still wanted.
- **DROP:** `current_is_code_driven = skill.schema_version is not None` + `raise HybridShapeMismatchError(...)` — this is the cross-shape lock being relaxed.

The inline branches only have the DROP guard (no `InvalidBundleError`). In the inline branches, `new_is_code_driven = is_code_driven_manifest(content_bytes)` must **survive** the deletion — it is reused a few lines down to route `parse_code_driven_manifest` vs `parse_hybrid_artifact`. Only the `current_is_code_driven`/comparison/raise lines go.

### The projection-reset `else` is the crux of AC2 — verified current code

`create_version` (~1213):
```python
if code_driven_manifest is not None:
    skill.schema_version = code_driven_manifest.schema_version
    skill.egress = code_driven_manifest.egress
# ── ADD: ──
else:
    skill.schema_version = None
    skill.egress = []
...
new_version.schema_version = skill.schema_version   # existing (~1223)
new_version.egress = skill.egress                   # ── ADD ──
```
`update_draft_content` (~1418) — the same, plus `current_ver` gets the same two fields reset in the `else` and set in the `if`:
```python
if code_driven_manifest is not None:
    skill.schema_version = code_driven_manifest.schema_version
    skill.egress = code_driven_manifest.egress
    current_ver.schema_version = skill.schema_version   # existing
    current_ver.egress = skill.egress                   # ── ADD ──
else:
    skill.schema_version = None
    skill.egress = []
    current_ver.schema_version = None                   # ── ADD ──
    current_ver.egress = []                             # ── ADD ──
```
Order matters: run the `if/else` on `skill.*` first, then read `skill.schema_version`/`skill.egress` into the version snapshot — so the snapshot is always of the freshly-reset row, correct for both shapes. (Do not source `new_version.egress` directly from `code_driven_manifest.egress`, because in the `else` case there is no manifest — reading the just-reset `skill.egress` handles both cases uniformly.)

### The TWO create_skill snapshot sites the epic missed (found by reading source, not the epic)

The correct-course epic named only the create-version (~1214) and draft-edit (~1419) sites. But `create_skill` builds the FIRST `SkillVersion` at **two** places — a bundle-based path (`SkillVersion(...)` ~line 636, snapshot `schema_version=skill.schema_version` ~647) and an inline code-driven path (`SkillVersion(...)` ~line 879, snapshot ~888). Both snapshot `schema_version` but **not** `egress`. Add `egress=skill.egress` to both constructors. Without this, a brand-new code-driven skill's first version row gets the DB default `[]` egress (disagreeing with the skill's non-empty code-driven egress), and its per-version export (AC3) reads the wrong value. The backfill fixes pre-existing rows; these two edits fix rows created after deploy. **If dev-story only edits create_version/update_draft_content and skips create_skill, AC3 has a hole for newly-created skills — the mixed-shape export test (Task 5) must exercise the first version's egress to catch this.**

### The export leak (AC3) — a one-line fix that the new column enables

`skill_export.py` builds the envelope with `"egress": skill.egress` (~line 214) — row-level — while `schema_version`/`consumes` (~213/212) correctly read `target_version.*`. Once `skill_versions.egress` exists and is snapshotted, flip line 214 to `target_version.egress`. This is the actual leak fix; the column + snapshots are the enabling work. The envelope's *field set* is unchanged (still has `egress`), so `EXPORT_ENVELOPE_SCHEMA_VERSION` does **not** bump (a bump would break import compatibility for no contract change).

### AC5 — paired lineage across a shape-flip is already handled by the existing fan-out

Derivation snapshots `{parent_skill_id, parent_version}` as JSONB on the child (`Skill.derived_from`); it does **not** re-copy the parent artifact. So a parent shape-flip cannot corrupt a child's content. The existing `create_version` fan-out (~lines 1234–1248) already flags every child `review_required=True, updated_at=now` in the SAME transaction as the version create — that is exactly the "parent changed, go re-review" signal we want, and it fires regardless of whether the bump was a shape-flip. So AC5 needs **no new code** — just a test proving the flag fires on a cross-shape parent bump and the child is otherwise untouched. Do NOT confuse this with `PairedSkillHasChildrenError` (~raise at 1588–1593) which guards *visibility changes off `paired`*, an unrelated path.

### The `HybridShapeMismatchError` class — leave it defined, stop raising it

Delete the 4 raises, not the class (line 170). Keeping the class defined-but-unraised is deliberate: it's a public exception constant, its removal has a wider blast radius, and leaving it documents the superseded invariant. Update its docstring and the two inline invariant comment blocks (~1162–1167, ~1359) so they don't lie to the next reader (they currently assert "a hybrid skill keeps a single shape across all its versions" — now false). This is the ADR amendment's on-the-ground footprint.

### House patterns / traps (project memory)

- **api image bakes source** — rebuild before pytest or you test stale code (project memory: Story 8.4 / Pre-existing CI Failures). Host pytest runs against `velara_test` (conftest forces the DB name + `alembic upgrade head` autouse). CI runs pytest on the runner with localhost MinIO — presigned-PUT assertions can false-fail if run via `docker compose exec` (localhost ≠ in-container minio); this story doesn't add presign assertions, but keep it in mind for the export round-trip test.
- **Migration head drift** — always chain off the verified current head (`0022_skill_version_bundle`), never a hardcoded guess. Confirm no other migration already claims 0023.
- **`git checkout -- <path>` on never-committed files wipes ALL changes** (project memory, 13.4) — use stash/saved diffs if you need to reset mid-work; velara-api changes here are uncommitted working-tree until code-review.
- **NEVER push subrepos** (HARD rule, project memory: Never Push Subrepos) — dev-story commits nothing in velara-api/velara-web; only the top-level docs repo is committed+pushed by the docs-publish step. velara-api changes stay uncommitted working-tree for code-review to commit post-review.

### Testing standards

- Integration tests in `tests/integration/api/test_skills.py` (async httpx `client` fixture, `raise_app_exceptions=False`, `celery_eager` inline). Reuse `_CODE_DRIVEN_MANIFEST`/`_LLM_DRIVEN_MANIFEST`/`_internal_auth()`. The 3 shape-lock tests are INVERTED (not deleted) so the shape-change contract stays covered — an inverted test proving "cross-shape now succeeds + projection resets correctly" is stronger coverage than deletion.
- Unit-level manifest behavior lives in `tests/unit/services/test_code_driven_hybrid.py` — no change needed there (manifest parsing is unchanged; only its persistence/projection changes).
- The migration is exercised by the autouse `alembic upgrade head`; a dedicated migration unit test is not the project convention (none exist), but DO manually verify `upgrade`/`downgrade -1` round-trip.

### Previous Story Intelligence

- **Story 11.6 (Draft-Mutable Versioning — the ADR this story amends):** built `update_draft_content` (re-point current version's artifact in place, no bump; `draft` only). ⭐ Its review found the **write→commit→delete-old rollback trap** — a bug CLASS in `skill_service`: any function that writes a new content-addressed artifact, commits, then best-effort-deletes the old one must apply the identical-key guard (`if new_key != old_key`) on BOTH the success cleanup AND the rollback except. This story edits the same `update_draft_content` function's projection block — do NOT disturb its `_safe_delete`/rollback logic; only add the projection `else` inside the existing try. If your projection-reset `else` throws (it can't — pure attribute assignment), it's inside the committed txn, not the artifact-cleanup path. (Ref: [[project-story-11-6-review]].)
- **Story 14.3 (same epic, done):** pure-FE explicit-version field in `SkillContentEditor`. No overlap with this story's files; do not look for a dependency. It did establish that velara-api was untouched and clean at `6c6e97c` — this story is the first Epic 14 velara-api change.
- **Story 5.5.1 (the invariant being superseded):** established "single manifest shape per skill" (review-D1) — precisely the constraint this story's ADR amendment lifts.

### Project Structure Notes

- **Backend only (velara-api):**
  - MODIFY `app/models/skill.py` — add `SkillVersion.egress` column.
  - NEW `app/db/migrations/versions/0023_skill_version_egress.py` — add column + backfill.
  - MODIFY `app/services/skill_service.py` — drop 4 shape-lock raises; add 2 projection `else` branches; add egress snapshot at 4 constructor/snapshot sites (2 in create_skill, 1 in create_version, 1 in update_draft_content); update docstring + 2 comment blocks.
  - MODIFY `app/services/skill_export.py` — 1 line: `skill.egress` → `target_version.egress`.
  - MODIFY `tests/integration/api/test_skills.py` — invert 3 tests; add mixed-shape/export/paired-flip coverage.
- **No velara-web change.** If dev-story finds itself editing anything under `velara-web/`, stop — that's scope creep (14-3 already shipped the only FE piece Epic 14 needs so far).
- **Two nested repos:** `velara-api` and `velara-web` are separate git repos nested under the top-level `velara` (which holds `_bmad-output` docs). This story touches only `velara-api` (working-tree, uncommitted — code-review commits it). **NEVER push subrepos** — only the top-level docs repo is committed+pushed by dev-story's docs step.

### References

- [Source: epics/epic-14-skill-upgrade-flexibility.md#Story-14.1] — story origin, ACs, inline ADR amendment, investigation notes, sequencing.
- [Source: planning-artifacts/sprint-change-proposal-2026-07-20.md §4.2] — correct-course detail: the 4 guard sites, the missing `else`, the export egress leak, the two latent correctness bugs.
- [Source: velara-api app/services/skill_service.py:170-185] — `HybridShapeMismatchError` (class to leave defined-but-unraised, docstring to update).
- [Source: velara-api app/services/skill_service.py:1140-1142, 1168-1176] — `create_version` cross-shape guards to drop (bundle + inline); adjacent `InvalidBundleError` at 1136-1139 to KEEP.
- [Source: velara-api app/services/skill_service.py:1365-1367, 1390-1396] — `update_draft_content` cross-shape guards to drop; `InvalidBundleError` at 1360-1364 to KEEP.
- [Source: velara-api app/services/skill_service.py:1213-1224] — `create_version` projection block (add `else` + `new_version.egress`).
- [Source: velara-api app/services/skill_service.py:1418-1421] — `update_draft_content` projection block (add `else` + `current_ver.egress`).
- [Source: velara-api app/services/skill_service.py:~636/647, ~879/888] — the TWO `create_skill` initial-version snapshot sites (add `egress=skill.egress`).
- [Source: velara-api app/services/skill_service.py:1234-1248] — the paired-child `review_required=True` fan-out (AC5 — no change, test only); `PairedSkillHasChildrenError` raise at ~1588-1593 (unrelated, do not touch).
- [Source: velara-api app/services/skill_service.py:266-296] — `_SEMVER_RE`/`_parse_semver`/`_bump_minor`/`_assert_version_greater`/`InvalidVersionError` (context; unchanged by this story).
- [Source: velara-api app/services/code_driven_hybrid.py:71,144-164] — `CodeDrivenHybridManifest.egress` (`list[str]`); `is_code_driven_manifest` (the per-version shape router execution uses — proves the guard isn't execution-critical).
- [Source: velara-api app/models/skill.py:35,95-101 (Skill.egress/schema_version); 165-206 (SkillVersion columns)] — the model to extend; `Skill.egress` = JSONB NOT NULL default `[]`; `SkillVersion` already has per-version `schema_version` (mirror it for `egress`).
- [Source: velara-api app/services/skill_export.py:141,161-171,212-214] — `export_skill_version`; the `"egress": skill.egress` leak at ~214 (→ `target_version.egress`).
- [Source: velara-api app/db/migrations/versions/0022_skill_version_bundle.py] — current head (down_revision target); [0014_skill_version_schema_contract.py] per-version-column template; [0013_code_driven_hybrid.py] JSONB egress column shape; [0020_audit_log_org_id.py] backfill pattern.
- [Source: velara-api tests/integration/api/test_skills.py:2015 (_CODE_DRIVEN_MANIFEST), 2029 (_LLM_DRIVEN_MANIFEST), 2210/2891/3905 (the 3 tests to invert), 4107 (export round-trip helper), ~90 (_internal_auth)].
- [Source: velara-api tests/conftest.py:48-55,149-160] — `velara_test` DB force + autouse `alembic upgrade head`.
- [Source: velara-api tests/unit/test_audit_coverage_guard.py:40-52] — version-create/export/import already mapped to existing audit events (confirms NO new audit event).
- [Source: _bmad-output/implementation-artifacts/stories/11-6-author-new-skill-versions-from-ui.md] — Draft-Mutable Versioning ADR (amended here); the rollback-cleanup bug class in the same `update_draft_content` function.
- [Source: project memory — [[project-story-11-6-review]], [[feedback-never-push-subrepos]], [[project-preexisting-ci-failures-fixed]] (api image bakes source), [[project-story-13-1-review]] (export_openapi container-path trap)].

### Review Findings

_Code review 2026-07-20 (adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 5 ACs verified MET against source. 2 patches, 1 decision, 6 dismissed as false-positive/non-actionable._

- [x] [Review][Decision → Dismissed] Cross-shape draft in-place edit does not re-flag derived children — `update_draft_content` (skill_service.py:1418) re-derives the projection but, unlike `create_version` (which fans out `review_required=True` at skill_service.py:1245), never re-flags derived children on a shape-flipping in-place draft edit. **Resolved 2026-07-20: dismissed as out of scope** — AC5 scoped the re-review signal to the version-bump path; a pre-publish draft edit re-flagging children before the change ships would be premature. Children re-review on the next actual publish (`create_version`), the correct trigger.

- [x] [Review][Patch] Stale route docstring still advertised the removed 422 HYBRID_SHAPE_MISMATCH (feeds OpenAPI description) [app/api/v1/skills.py:779] — FIXED: docstring now states the shape MAY change and the projection is re-derived.
- [x] [Review][Patch] Stale `create_version` service docstring claimed a cross-shape swap is rejected HYBRID_SHAPE_MISMATCH [app/services/skill_service.py:1107] — FIXED: docstring now describes the re-derived projection (Story 14.1).

**Dismissed (recorded for traceability, not actionable):**
- Migration backfill "reintroduces the leak" for pre-migration rows (blind+edge) — inherent to per-version egress never having been recorded; explicitly documented as an approximation in the migration docstring, matches the project's 0020 backfill pattern. The fix is correct for all go-forward writes.
- `downgrade()` drops the column / not data-idempotent (blind) — standard additive-column downgrade; expected.
- `create_skill` LLM path relies on flush-materialized `default=list` (blind) — verified safe today (read is post-`session.flush()`); speculative future-fragility only.
- Non-hybrid `else` "wipes" the projection at both sites (edge) — false positive: for non-hybrid (prompt/code) skills `schema_version`/`egress` are already `None`/`[]` (only ever set from a code-driven hybrid manifest), so the `else` is a no-op.
- Bundle path never runs `is_code_driven_manifest` (edge) — by design: a bundle is always a code-driven hybrid (enforced by the preserved `InvalidBundleError` check); `_process_bundle` always yields a manifest.
- Shared list aliasing between skill row and version row egress (edge) — `manifest.egress` is a fresh list per Pydantic parse; JSONB is never mutated in place on these paths, so the shared reference is never observed.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Local `docker-compose.yml` sets `AUTH_BACKEND=cognito` for the `api` service — `DevAuthProvider`-issued test bearer tokens 401 against every route when the suite runs without an override, producing ~198 unrelated failures on first run. Confirmed pre-existing (reproduces on unmodified code, unrelated to this story's files). Fixed by running pytest with `-e AUTH_BACKEND=dev`, matching the documented project convention.
- Two of my own new tests failed on first green-run attempt (test-authoring bugs, not source bugs): (1) `test_paired_parent_shape_flip_flags_child_lineage_unaffected` — the derive route defaults a child's `runtime_type` to the parent's when omitted (`skill_service.py` `derive_skill`); since my parent was `hybrid`, the child's plain-text content failed hybrid-artifact JSON validation. Fixed by passing an explicit `runtime_type: "prompt"` in the derive payload (the child's own shape is irrelevant to AC5). (2) `test_export_egress_is_per_version_not_row_level` — queried the old version by the manifest's `schema_version` field ("0.3.0") instead of the `SkillVersion.version` semver string ("1.0.0"); these are two distinct fields (manifest output-schema version vs. the skill version). Fixed to query by the correct version string.
- One pre-existing unrelated test failure in the full-repo run: `tests/integration/api/test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped` — a documented append-only-DB re-run-sensitivity flake (Story 13.6 review memory), in a file this story never touches. Not a regression.

### Completion Notes List

- **AC1 (shape-lock relaxed):** All 4 `HybridShapeMismatchError` raise sites removed from `skill_service.py` — 2 in `create_version` (bundle + inline branches), 2 in `update_draft_content` (bundle + inline branches). The distinct, unrelated `InvalidBundleError` "ZIP bundle requires a hybrid skill" checks were preserved unchanged at both bundle-branch sites. `HybridShapeMismatchError` itself is left defined (not raised anywhere) with an updated docstring documenting the superseded invariant.
- **AC2 (projection re-derived, never stale):** Added the missing `else` branch at both the `create_version` and `update_draft_content` projection blocks — a non-code-driven version now explicitly resets `skill.schema_version = None` / `skill.egress = []` (previously only the code-driven `if` branch existed, so a downgrade left prior values stale). `new_version`/`current_ver` schema_version AND egress are now snapshotted from the freshly re-derived skill-row values in both functions, so a version's own snapshot is always correct for whichever shape it actually has.
- **AC3 (per-version egress + export leak fixed):** New `SkillVersion.egress` JSONB NOT NULL DEFAULT `[]` column (migration `0023_skill_version_egress`, chained off verified head `0022_skill_version_bundle`, with a documented-approximation backfill from the parent skill's current egress). Snapshotted at all 4 version-construction sites: both `create_skill` initial-version paths (bundle-based `_create_skill_from_bundle` and the inline path — two sites the epic's investigation had NOT called out, found by reading the actual source) plus `create_version` and `update_draft_content`. `skill_export.py`'s envelope builder now reads `target_version.egress` instead of the row-level `skill.egress`, fixing the latent per-version export leak. `EXPORT_ENVELOPE_SCHEMA_VERSION` left unbumped (field set unchanged, only the value's source changed).
- **AC4 (immutability unchanged):** No changes to lifecycle-state guards, `SkillNotDraftError`, or per-version immutability — verified by the unchanged, still-passing draft/publish/certification test suites.
- **AC5 (paired lineage across shape-flip):** No code change needed — the existing version-bump child-flagging fan-out (`review_required=True` in the same transaction) already fires unconditionally on any parent bump, shape-flip or not, and derivation's `derived_from` snapshot is untouched by a parent's later shape change. Added a new test proving this explicitly for a shape-flipping bump.
- **Inline ADR amendment:** Landed as originally drafted in the story — supersedes Story 5.5.1 review-D1, amends Epic 11 ADR #3. No separate architect session; documented in the story body itself, plus in-code docstring/comment updates at every touched guard/projection site.
- **Zero FE changes** (velara-web untouched, confirmed by `git status` in that repo). **No `docs/api-spec.json` change** (confirmed via diff — no request/response contract changed; `SkillVersionRead` deliberately does not expose the new `egress` column, since it's a DB-internal projection consumed only by the export envelope, not part of the public version-read contract). **No new audit event types** (guard registry unchanged).
- Gates: migration upgrade/downgrade/upgrade round-trip clean; `test_skills.py` 200 passed (0 failed); full repo suite 1442 passed / 1 pre-existing unrelated flake; `ruff check` clean on all changed files.

### File List

**Backend (velara-api):**
- MODIFIED `app/models/skill.py` — added `SkillVersion.egress` JSONB NOT NULL DEFAULT `[]` column.
- NEW `app/db/migrations/versions/0023_skill_version_egress.py` — adds the column + backfills from `skills.egress`; chains off head `0022_skill_version_bundle`.
- MODIFIED `app/services/skill_service.py` — dropped 4 `HybridShapeMismatchError` raise sites (kept the 2 unrelated `InvalidBundleError` checks); updated the exception class docstring + inline invariant comments; added the missing projection-reset `else` branch in `create_version` and `update_draft_content`; added `egress` snapshot at all 4 `SkillVersion` construction/update sites (`_create_skill_from_bundle`, `create_skill` inline path, `create_version`, `update_draft_content`).
- MODIFIED `app/services/skill_export.py` — `export_skill_version`'s envelope builder now reads `target_version.egress` instead of `skill.egress` (1-line fix).
- MODIFIED `tests/integration/api/test_skills.py` — inverted 3 shape-lock tests to assert the new allowed-with-projection-reset behavior (`test_hybrid_version_shape_switch_allowed_projection_resets`, `test_bundle_version_cross_shape_allowed`, `test_update_draft_content_bundle_cross_shape_allowed_projection_resets`); added `test_export_egress_is_per_version_not_row_level` (AC3) and `test_paired_parent_shape_flip_flags_child_lineage_unaffected` (AC5).

**No velara-web changes.**

## Change Log

| Date | Change |
|---|---|
| 2026-07-20 | Story 14.1 drafted (create-story). Backend-only: relax the hybrid shape-lock (drop 4 `HybridShapeMismatchError` raises, keep the 2 `InvalidBundleError` bundle-is-hybrid checks), add the missing projection-reset `else` at create_version + update_draft_content, add a new `skill_versions.egress` column (migration `0023`, backfill from `skills.egress`) snapshotted at 4 sites (incl. 2 create_skill sites the epic missed), fix the per-version export egress leak (`skill.egress` → `target_version.egress`). Inline ADR amendment supersedes 5.5.1-D1 + amends Epic 11 ADR #3. No FE change, no api-spec change, no new audit event. 3 shape-lock tests INVERTED + new mixed-shape/export/paired-flip coverage. Status → ready-for-dev. |
| 2026-07-20 | Story 14.1 implemented (dev-story). All 5 ACs satisfied: shape-lock removed at all 4 guard sites; projection re-derived (not just set) on every bump/edit via new `else` branches; new per-version `skill_versions.egress` column (migration `0023`) snapshotted at all 4 construction sites incl. the 2 `create_skill` sites the epic's investigation missed; export envelope leak fixed (`target_version.egress`); paired-lineage fan-out verified to already handle a parent shape-flip correctly (test-only, no code change). 3 shape-lock tests inverted, 2 new tests added (per-version export egress, paired shape-flip). Discovered and worked around a pre-existing local-env quirk (`AUTH_BACKEND=cognito` default breaks dev-auth test tokens; use `AUTH_BACKEND=dev` override). Migration round-trip verified. `test_skills.py`: 200/200 passed. Full repo suite: 1442 passed, 1 pre-existing unrelated flake (documented append-only-DB re-run sensitivity, Story 13.6). Ruff clean. No FE change, no api-spec change, no new audit event — all confirmed. Status → review. |
