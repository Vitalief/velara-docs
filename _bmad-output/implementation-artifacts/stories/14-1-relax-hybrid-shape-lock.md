---
baseline_commit: 6c6e97c (velara-api) / 61d3a3c (velara-web)
---

# Story 14.1: Relax the Hybrid Manifest Shape-Lock

Status: ready-for-dev

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

- [ ] **Task 1 — Add the per-version `skill_versions.egress` column (model + migration + backfill) (AC3)**
  - [ ] Add `egress` to the `SkillVersion` model — `velara-api/app/models/skill.py` (class `SkillVersion` at line 165, `__tablename__ = "skill_versions"`). Mirror the **parent** `Skill.egress` shape (JSONB, NOT NULL, default `[]`), not the string `schema_version` shape: `egress: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))`. Place it beside the existing per-version `schema_version`/`consumes` snapshot columns (~line 195). **Decision:** use NOT NULL default `[]` (matches `Skill.egress` and keeps reads null-safe) — do NOT copy `schema_version`'s nullable-string shape here. **No GIN index needed** on the per-version column (the row-level `idx_skills_egress` exists for egress-filtered skill queries; there is no per-version egress query surface — do not add an index speculatively).
  - [ ] New Alembic migration — `velara-api/app/db/migrations/versions/0023_skill_version_egress.py`. **Chain `down_revision = "0022_skill_version_bundle"`** (verified current head — no migration lists 0022 as its down_revision). `revision = "0023_skill_version_egress"`. Convention: zero-padded 4-digit sequence + snake_case slug.
    - `upgrade()`: `op.add_column("skill_versions", sa.Column("egress", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")))` — copy the exact shape from migration `0013_code_driven_hybrid.py`'s `skills.egress` add. Then **backfill** existing rows from the parent skill's current egress: `op.execute("UPDATE skill_versions v SET egress = s.egress FROM skills s WHERE v.skill_id = s.id")`. **No append-only trigger dance** (that DISABLE/ENABLE TRIGGER pattern in migration 0020 is specific to `audit_log_entries` — `skill_versions` has no such trigger).
    - `downgrade()`: `op.drop_column("skill_versions", "egress")`.
    - Backfill honesty note (put in the migration docstring): the backfill copies each version's egress from its skill's **current** row-level egress — the best available approximation for historical versions, since per-version egress was never recorded before this column. Going forward, every write site snapshots the true per-version value (Task 3). This is a known, documented approximation, not a silent one.
  - [ ] Template to mirror: `0014_skill_version_schema_contract.py` (the precedent for adding a per-version snapshot column to `skill_versions`) for placement, and `0013_code_driven_hybrid.py` (the JSONB-NOT-NULL-default-`[]` egress column) for the column shape. Backfill pattern: `0020_audit_log_org_id.py` (`op.execute("UPDATE ... SET ... FROM ... WHERE ...")`), minus the trigger dance.

- [ ] **Task 2 — Relax the shape-lock at all 4 guard sites (AC1) — `velara-api/app/services/skill_service.py`**
  - [ ] **Site A — `create_version`, bundle branch (~lines 1140–1142).** Drop the cross-shape lines: `current_is_code_driven = skill.schema_version is not None` and `if not current_is_code_driven: raise HybridShapeMismatchError(current="LLM", attempted="code")`. **KEEP** the immediately-preceding `if skill.runtime_type != "hybrid": raise InvalidBundleError(...)` (~lines 1136–1139) — that is the bundle-is-code-driven-hybrid check, a different guard.
  - [ ] **Site B — `create_version`, inline branch (~lines 1168–1176).** Keep `new_is_code_driven = is_code_driven_manifest(content_bytes)` (line ~1169 — still needed to route parsing at ~1178–1181). Drop only `current_is_code_driven = skill.schema_version is not None` (~1170) and the `if new_is_code_driven != current_is_code_driven: await _safe_delete(...); raise HybridShapeMismatchError(...)` block (~1171–1176).
  - [ ] **Site C — `update_draft_content`, bundle branch (~lines 1365–1367).** Same as Site A: drop the cross-shape `current_is_code_driven`/`raise` lines; **KEEP** the `if skill.runtime_type != "hybrid": raise InvalidBundleError(...)` (~1360–1364).
  - [ ] **Site D — `update_draft_content`, inline branch (~lines 1390–1396).** Same as Site B: keep `new_is_code_driven = is_code_driven_manifest(...)` (needed for routing at ~1398–1401); drop the `current_is_code_driven`/comparison/`_safe_delete`/`raise` block.
  - [ ] **Do NOT delete the `HybridShapeMismatchError` class itself** (line 170) — leave it defined but unraised (removing a public exception class is a wider blast radius; an unraised guard class is harmless and documents the superseded invariant). Update its docstring (lines 171–174) and the two inline comment blocks (~1162–1167, ~1359) that assert the "single shape per skill" invariant to reflect the new re-derived-projection rule — these comments are now WRONG and will mislead the next reader.

- [ ] **Task 3 — Re-derive the projection on every bump/edit + snapshot egress per-version (AC2, AC3) — `velara-api/app/services/skill_service.py`**
  - [ ] **`create_version` projection block (~lines 1213–1224).** Today: `if code_driven_manifest is not None: skill.schema_version = code_driven_manifest.schema_version; skill.egress = code_driven_manifest.egress`. **Add the missing `else`:** `else: skill.schema_version = None; skill.egress = []` (the LLM-version downgrade case). Then snapshot the new version's own projection from the (now-fresh) row: `new_version.schema_version = skill.schema_version` (already present at ~1223) and **add** `new_version.egress = skill.egress`. Because the `else` runs first, both reads are of the freshly-reset row, so the snapshot is correct for both shapes.
  - [ ] **`update_draft_content` projection block (~lines 1418–1421).** Today: `if code_driven_manifest is not None: skill.schema_version = ...; skill.egress = ...; current_ver.schema_version = skill.schema_version`. **Add the missing `else`:** `else: skill.schema_version = None; skill.egress = []; current_ver.schema_version = None; current_ver.egress = []`. And in the `if` branch, **add** `current_ver.egress = skill.egress` alongside the existing `current_ver.schema_version = skill.schema_version`. (An in-place draft edit that flips shape must reset the same 4 fields.)
  - [ ] **`create_skill` initial-version snapshots — TWO sites the epic did NOT call out (verified in source).** Both build the FIRST `SkillVersion` snapshotting `schema_version` but not `egress`:
    - Bundle-based initial version (~line 636 `SkillVersion(...)`, snapshot arg `schema_version=skill.schema_version` at ~647). Add `egress=skill.egress` to that constructor.
    - Inline code-driven initial version (~line 879 `SkillVersion(...)`, snapshot at ~888). Add `egress=skill.egress`.
    - **Why this matters:** if only `create_version`/`update_draft_content` snapshot egress but `create_skill` does not, brand-new skills' first version gets a DB default `[]` egress that disagrees with their (possibly non-empty) code-driven `skill.egress`, and the per-version export (AC3) would read the wrong value for the very first version. The backfill migration papers over pre-existing rows but not rows created after deploy — both create paths must snapshot too.
  - [ ] **Grep sanity check:** after editing, `grep -n "\.egress" app/services/skill_service.py` and confirm every site that sets `skill.egress` from a manifest is paired with a `new_version.egress`/`current_ver.egress`/`version.egress = skill.egress` snapshot, and every LLM-branch `else` resets both `skill.egress = []` and the version's egress. No orphan (skill-set-but-version-not-snapshotted) sites should remain. There are exactly the snapshot sites above; there is no other place `SkillVersion` is constructed with manifest metadata.

- [ ] **Task 4 — Fix the per-version export egress leak (AC3) — `velara-api/app/services/skill_export.py`**
  - [ ] In `export_skill_version` (function at ~line 141), the envelope builder (~line 214) currently reads `"egress": skill.egress` while its neighbors `"schema_version": target_version.schema_version` (~213) and `"consumes": target_version.consumes` (~212) correctly read from `target_version`. Change `"egress": skill.egress` → `"egress": target_version.egress`. Now every envelope field is per-version-consistent. (`target_version` is already resolved earlier in the function, ~lines 161–171, defaulting to `current_version_id` when `version is None`.)
  - [ ] Confirm the export envelope schema version constant (`EXPORT_ENVELOPE_SCHEMA_VERSION`) does **not** need bumping — the envelope's *field set* is unchanged (still has an `egress` key); only the *source* of the value changed. Do not bump it (a bump would break import compatibility for no contract reason). If a reviewer disagrees, note it as a decision, don't silently bump.

- [ ] **Task 5 — Update the 3 shape-lock tests to assert the NEW behavior + add mixed-shape & projection-reset coverage (AC1, AC2, AC5) — `velara-api/tests/integration/api/test_skills.py`**
  - [ ] **`test_hybrid_version_shape_switch_rejected` (~line 2210) — INVERT it.** Rename to e.g. `test_hybrid_version_shape_switch_allowed_projection_resets`. Both cross-shape bumps (code→LLM at ~2234, LLM→code at ~2267) must now return **201**, not 422. Replace the `assert ... == "HYBRID_SHAPE_MISMATCH"` assertions. Then assert the **projection reset (AC2)**: after code→LLM, `GET /skills/{id}` returns `schema_version == None` (JSON `null`) and `egress == []` (invert the existing lines 2247–2248 which assert the stale code-driven values persist); after LLM→code, `schema_version == "0.3.0"` and `egress == ["api.anthropic.com"]` (from `_CODE_DRIVEN_MANIFEST`).
  - [ ] **`test_bundle_version_cross_shape_rejected` (~line 2891) — INVERT.** A ZIP (code-driven) version of an LLM-driven hybrid must now succeed (201) and set the row projection to the bundle manifest's schema_version/egress. Rename accordingly.
  - [ ] **`test_update_draft_content_bundle_cross_shape_rejected` (~line 3905) — INVERT.** A cross-shape draft ZIP against an LLM-driven hybrid must now re-point in place and reset the projection to code-driven values. Rename accordingly.
  - [ ] **NEW test — per-version egress snapshot + export leak fix (AC3).** Create a code-driven skill (`_CODE_DRIVEN_MANIFEST`, egress `["api.anthropic.com"]`); bump to an LLM-driven version (`_LLM_DRIVEN_MANIFEST`). Export the **old code-driven version** by explicit `version` (`GET /skills/{id}/export?version=X.Y.Z` or whatever the export route param is — confirm route) → envelope `egress == ["api.anthropic.com"]`. Export the **current LLM version** → envelope `egress == []`. This proves the leak is fixed (before this story both would have read the row's current egress). Reuse the export round-trip test (`test_export_import_round_trip_*`, ~line 4107) for the export-call shape.
  - [ ] **NEW test — `create_skill` first-version egress snapshot.** Create a code-driven skill; export its (only, current) version → envelope `egress == ["api.anthropic.com"]`. This guards the Task-3 `create_skill` snapshot fix independent of any bump (a bug there would still read the right value via the row for the *current* version, so make this test export a code-driven skill that then gets an LLM version, and assert the *first* version's export egress is non-empty — i.e. fold this into the AC3 test above rather than a redundant current-version-only case).
  - [ ] **NEW test — paired parent shape-flip flags children (AC5).** Build a `paired` LLM-driven parent, derive a `client_facing` child (reuse the existing derive/lineage test helpers — grep `derived_from` / `derive` in test_skills.py), bump the parent to a code-driven version, assert the child's `review_required` is `True` and the child is otherwise unchanged (its `derived_from` snapshot untouched). Confirm `PairedSkillHasChildrenError` is NOT triggered (that guard is on visibility change, not version bump).
  - [ ] Fixtures to reuse (do not reinvent): module-level `_CODE_DRIVEN_MANIFEST` (~line 2015, egress `["api.anthropic.com"]`, schema_version `0.3.0`) and `_LLM_DRIVEN_MANIFEST` (~line 2029, `tools`+`code`, no `entrypoint`) at the top of `test_skills.py`; `_internal_auth()` (~line 90) for auth headers. For the bundle cases, reuse the existing ZIP-building helpers used by `test_bundle_version_*` (~lines 2853–2941).

- [ ] **Task 6 — Gates**
  - [ ] Rebuild the api image before running pytest in-container (the image bakes source — a stale image runs old code and gives false results). Recipe per project memory: `docker compose build api` then `docker compose run --rm api pytest tests/integration/api/test_skills.py -q` (or the project's established in-container pytest invocation). Alternatively the host-pytest recipe against `velara_test` if that's the current convention — check `tests/conftest.py` DB setup (forces `velara_test`, runs `alembic upgrade head` autouse).
  - [ ] **The new migration must apply cleanly** — the autouse conftest fixture runs `alembic upgrade head` before the suite, so a broken migration fails the whole run loudly. Verify `alembic upgrade head` then `alembic downgrade -1` round-trips locally (the `downgrade()` drop_column must reverse the `add_column`).
  - [ ] Run the full `test_skills.py` suite; record the new pass count vs the 11.6-era baseline (~159 passed in-container at that time — re-check current baseline before attributing any delta). No regressions outside the 3 inverted tests.
  - [ ] `ruff check .` (or `ruff check` per project config) → clean.
  - [ ] **No `docs/api-spec.json` change** — no request/response contract changed (the export envelope is not an OpenAPI-modeled response body; the `version` create contract is unchanged). Confirm with a diff-check; do not regenerate speculatively. If `export_openapi.py` is run, remember it writes inside the container — `docker cp` the result out or the host spec goes stale (project memory, Story 13.1 trap).
  - [ ] **No new audit event types** — confirmed: the version-create route already maps to `EVENT_ADMIN_SKILL_VERSION_CREATED` and export/import to `EVENT_ADMIN_SKILL_EXPORTED`/`_IMPORTED` in the guard registry (`tests/unit/test_audit_coverage_guard.py`). This story adds no mutating route, so the guard registry needs no new entry. Do not touch `audit_categories.py` / `app/models/audit.py`.

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

## Dev Agent Record

### Agent Model Used

_(to be filled by dev-story)_

### Debug Log References

_(to be filled by dev-story)_

### Completion Notes List

_(to be filled by dev-story)_

### File List

_(to be filled by dev-story)_

## Change Log

| Date | Change |
|---|---|
| 2026-07-20 | Story 14.1 drafted (create-story). Backend-only: relax the hybrid shape-lock (drop 4 `HybridShapeMismatchError` raises, keep the 2 `InvalidBundleError` bundle-is-hybrid checks), add the missing projection-reset `else` at create_version + update_draft_content, add a new `skill_versions.egress` column (migration `0023`, backfill from `skills.egress`) snapshotted at 4 sites (incl. 2 create_skill sites the epic missed), fix the per-version export egress leak (`skill.egress` → `target_version.egress`). Inline ADR amendment supersedes 5.5.1-D1 + amends Epic 11 ADR #3. No FE change, no api-spec change, no new audit event. 3 shape-lock tests INVERTED + new mixed-shape/export/paired-flip coverage. Status → ready-for-dev. |
