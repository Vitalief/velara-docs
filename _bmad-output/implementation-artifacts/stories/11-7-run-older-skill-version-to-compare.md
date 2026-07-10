---
baseline_commit: 5d61b11 (velara-api) / 90b628a (velara-web)
---

# Story 11.7: Run an Older Skill Version to Compare (admin / ma_tech)

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an admin or MA Tech developer,
I want to run a specific older version of a skill (not just the current version),
so that I can compare its output against the current version's output.

## Acceptance Criteria

1. **AC1 — A grantor-supplied `version` pins the run to THAT `SkillVersion`, and it is genuinely EXECUTED (not just recorded).**
   **Given** `InvocationRequest` gains an optional `version: str | None = None` field
   **When** an **admin/ma_tech** caller supplies it
   **Then** the run pins to that `SkillVersion` — the job row (`InvocationJob.skill_version`) and the invocation audit event (`AuditLogEntry.skill_version`) record the pinned version (already wired: both are set from the single resolved `skill_version_str`), **AND the worker actually fetches and runs THAT version's artifact bytes**. ⭐ This is the load-bearing part the epic AC understates: today all three executor paths (`_run_prompt`/`_run_code`/`_run_hybrid`) resolve the artifact from `skill.current_version_id`, **ignoring `job.skill_version`** — so without this fix a pinned run would *record* the old version but *execute* the current artifact, producing identical output and an audit that lies. The executor must resolve the artifact from `job.skill_version`.

2. **AC2 — Version selection is grantor-gated; a non-grantor (client/consultant) or an omitted `version` runs `current_version` exactly as today.**
   **Given** a client or consultant caller, OR no `version` supplied
   **When** the skill is invoked
   **Then** the run uses `current_version` as today — the `version` pin is honored **only** for `_GRANTOR_ROLES = {admin, ma_tech}` (reuse the existing constant). A non-grantor who supplies `version` is **silently ignored** (falls back to `current_version`, per the epic AC "a client or consultant caller … uses `current_version` as today") — NOT a 403. Because `queue_invocation` is shared by the internal, client, and `/invoke`-proxy surfaces, the gate is an **in-handler role check** (`user.role in _GRANTOR_ROLES`), never a route-level `RejectNonGrantor` (which would 404 clients who are legitimately allowed to invoke `current_version`).

3. **AC3 — A nonexistent version is rejected with a clear error; a retired skill is already blocked; no job is queued to a bogus version.**
   **Given** a grantor supplies a `version` string that does not exist for the skill (no matching `SkillVersion` row)
   **When** a version-pinned run is requested
   **Then** it is rejected **404 `SKILL_VERSION_NOT_FOUND`** (reuse the existing `SkillVersionNotFoundError`) **before** any job is created — mirroring the existing `NoCurrentVersionError` synchronous-guard discipline (no job queued to a bogus version the worker would hard-fail on). **Given** a retired skill, **When** any run (pinned or not) is requested, **Then** it is already rejected **422 `SKILL_RETIRED`** by the existing `assert_invocable` (which fires on the skill's `lifecycle_state` before version resolution — no new work, but a regression test locks it).

4. **AC4 — The duplicate-run advisory (Story 12.4) and the executor stay consistent with the pinned version.**
   **Given** a version-pinned run
   **When** the pre-flight duplicate check (`POST /{skill_id}/check-duplicate`) runs and when the worker executes
   **Then** both resolve the SAME pinned version as `queue_invocation` — the duplicate check compares against the pinned `skill_version` (not `current_version`), and the executor runs the pinned artifact. Version resolution is a **single shared helper** used by `queue_invocation`, `check_duplicate`, and the three executor sites — they must never drift (three independent `current_version_id` lookups exist today; the pin must be applied consistently or the feature is subtly broken on one path).

5. **AC5 — Frontend: an admin/ma_tech version selector in the Run Console pins the run; the comparison is traceable via the audit log.**
   **Given** the internal Run Console
   **When** an **admin/ma_tech** user opens a skill's run surface
   **Then** a **version selector** (defaulting to "Current (vX.Y.Z)") lets them pick an older version to run; it is gated on `isGrantor()` (hidden for consultants — RunConsole is internal-not-grantor-facing) and populated from a **new** `GET /api/v1/skills/{id}/versions` read endpoint (none exists today — `SkillWithVersion` only carries `current_version`). The selected version threads through `buildRunPayload()` into both the submit (`createInvocation`) and the pre-flight (`checkDuplicateInvocation`) calls. The client portal run surface (`ClientRun`) is unchanged — it never sends `version`.

## Tasks / Subtasks

> **Scope + decisions locked at story creation (resolved with the Project Lead — do NOT re-litigate):**
>
> **(L1) The executor MUST run the pinned version — this is the headline, not a footnote.** The epic AC ("the job + audit already record `skill_version`, so the comparison is traceable automatically") is TRUE only for the *record*. All three executor paths resolve the artifact from `skill.current_version_id` and ignore `job.skill_version` ([execution_service.py:420-430](../../../velara-api/app/services/execution_service.py#L420), [536-544](../../../velara-api/app/services/execution_service.py#L536), [692-704](../../../velara-api/app/services/execution_service.py#L692)). Without fixing these, a pinned run executes the CURRENT artifact — the outputs are identical and the audit is a lie. **Resolve the artifact from `job.skill_version` (fall back to `current_version_id` only when `job.skill_version` is null/legacy).** `job` is passed into all three `_run_*` functions ([execution_service.py:341-374](../../../velara-api/app/services/execution_service.py#L341)), so `job.skill_version` is in scope.
>
> **(L2) Grantor gate is an IN-HANDLER role check, non-grantor `version` is SILENTLY IGNORED.** `queue_invocation` is shared verbatim by the internal route ([invocations.py:423](../../../velara-api/app/api/v1/invocations.py#L423)), the client route ([client.py:201](../../../velara-api/app/api/v1/client.py#L201)), and the `/invoke` proxy ([invoke.py:77](../../../velara-api/app/api/v1/invoke.py#L77)), all taking the SAME `InvocationRequest`. A route-level `RejectNonGrantor` would 404 clients who legitimately invoke `current_version`. So gate INSIDE the resolver: `if body.version is not None and user.role in _GRANTOR_ROLES:` pin; else use current. A non-grantor supplying `version` → ignored, run current (matches the epic AC wording; the client FE never sends `version` anyway). Precedent: [users.py:37,49](../../../velara-api/app/api/v1/users.py#L37) — but note that precedent is cited for the **placement** pattern (in-handler role check on a shared route) ONLY; `users.py` RAISES 403, whereas 11.7 deliberately does the opposite (silent fallback to current, NOT 403 — do not copy the 403-raising shape).
>
> **(L3) Full-stack — build the FE version selector + a new list-versions read.** No `GET /versions` endpoint exists (only `POST /versions` create), and `SkillWithVersion` carries only `current_version`, not a `versions[]` list ([types.ts:127-130](../../../velara-web/src/features/skills/types.ts#L127)). Add the BE read + FE client + a grantor-gated selector in BOTH RunConsole payload builders.
>
> **(L4) Single shared version resolver — do NOT duplicate the pin logic.** The `current_version_id` lookup exists in FIVE places today: `queue_invocation` ([invocations.py:243](../../../velara-api/app/api/v1/invocations.py#L243)), `check_duplicate` ([invocations.py:470](../../../velara-api/app/api/v1/invocations.py#L470)), and the three executor sites. Extract ONE helper (`_resolve_target_version(skill, requested_version, is_grantor) -> SkillVersion`) and use it everywhere the pin matters, so a client-vs-grantor / pinned-vs-current divergence is structurally impossible. Model it on the existing `skill_export.py` resolver ([skill_export.py:162-171](../../../velara-api/app/services/skill_export.py#L162)) — the exact "resolve pinned version, else current, else `SkillVersionNotFoundError`" shape.
>
> **(L5) IP boundary unchanged.** `version` is a runtime semver string, NOT skill internals — safe to add to `InvocationRequest` (whose `extra="forbid"` + IP docstring forbid prompt/artifact fields, [invocation.py:6-8,55](../../../velara-api/app/schemas/invocation.py#L6)). The new list-versions read returns `SkillVersionRead` (paths/checksums/metadata only — already omits artifact keys/bytes, [skill.py:283-303](../../../velara-api/app/schemas/skill.py#L283)); it does NOT expose artifact content.

- [ ] **Task 1 — Add optional `version` to `InvocationRequest` (AC1, AC2, AC5) — `app/schemas/invocation.py`**
  - [ ] Add `version: str | None = None` to `InvocationRequest` ([invocation.py:19-63](../../../velara-api/app/schemas/invocation.py#L19)). It is inherited automatically by `InvokeRequest` ([invocation.py:66](../../../velara-api/app/schemas/invocation.py#L66)) and used by the client route (same schema). Keep `extra="forbid"` — the field is now a KNOWN field, so a supplied `version` no longer 422s as an unknown key. Optional `max_length=32` (mirrors the `SkillVersion.version` `String(32)` column) + a light semver-shape validator is NICE-TO-HAVE but not required (an unresolvable string 404s at resolution anyway — see Task 2); do NOT over-validate.
  - [ ] **api-spec.json WILL diff** — `InvocationRequest`/`InvokeRequest` gain the optional `version` field. There is a spec-lock test ([tests/integration/api/test_openapi.py](../../../velara-api/tests/integration/api/test_openapi.py), cited in the schema docstring) — update it if it asserts the exact field set. Confirm the diff is ONLY the additive `version` field.

- [ ] **Task 2 — Shared version resolver + apply the pin in `queue_invocation` (AC1, AC2, AC3, AC4, L4) — `app/api/v1/invocations.py`**
  - [ ] Add `_resolve_target_version(skill, requested_version: str | None, is_grantor: bool) -> SkillVersion` (module-level helper, or in `skill_service` if cleaner — dev's call, but ONE definition). Logic mirrors [skill_export.py:162-171](../../../velara-api/app/services/skill_export.py#L162):
    - If `requested_version is not None AND is_grantor`: `target = next((v for v in skill.versions if v.version == requested_version), None)`; if `None` → raise `SkillVersionNotFoundError(skill.id, requested_version)` ([skill_service.py:76-84](../../../velara-api/app/services/skill_service.py#L76), 404 `SKILL_VERSION_NOT_FOUND`).
    - Else (no version, or non-grantor): `target = next((v for v in skill.versions if v.id == skill.current_version_id), None)`; if `None` → raise `NoCurrentVersionError(skill.id)` ([invocations.py:56-71](../../../velara-api/app/api/v1/invocations.py#L56), 422). Preserves today's behavior exactly.
    - `skill.versions` is already eager-loaded by `get_skill` (`selectinload(Skill.versions)`, [skill_service.py:837](../../../velara-api/app/services/skill_service.py#L837)) and org-scoped — no new query, and cross-org is already 404'd by `get_skill`.
  - [ ] In `queue_invocation` ([invocations.py:243-246](../../../velara-api/app/api/v1/invocations.py#L243)): replace the inline `current_ver = next(...)` + `NoCurrentVersionError` block with `current_ver = _resolve_target_version(skill, body.version, user.role in _GRANTOR_ROLES)`; keep `skill_version_str = current_ver.version`. **Order matters:** `assert_invocable(skill)` at [invocations.py:237](../../../velara-api/app/api/v1/invocations.py#L237) must stay BEFORE resolution so a retired skill 422s before a version lookup (AC3). Import `_GRANTOR_ROLES` from `app.core.dependencies` ([dependencies.py:123](../../../velara-api/app/core/dependencies.py#L123)).
  - [ ] The resolved `skill_version_str` already threads unchanged into all three job-creation branches — fan-out `dispatch_fan_out(skill_version=...)` ([invocations.py:295](../../../velara-api/app/api/v1/invocations.py#L295)), single-location `create_job(skill_version=...)` ([invocations.py:330](../../../velara-api/app/api/v1/invocations.py#L330)), non-location `create_job(skill_version=...)` ([invocations.py:365](../../../velara-api/app/api/v1/invocations.py#L365)) — so the pinned version lands on the job + (downstream) the audit with no further change. Verify fan-out children inherit the pinned parent version (children are created from `skill_version=parent_skill_version` — [execution_service.py:1092-1113](../../../velara-api/app/services/execution_service.py#L1092)).
  - [ ] In `check_duplicate` ([invocations.py:465-503](../../../velara-api/app/api/v1/invocations.py#L465)): replace its own inline `current_ver = next(...)` ([invocations.py:470-472](../../../velara-api/app/api/v1/invocations.py#L470)) with the SAME `_resolve_target_version(skill, body.version, user.role in _GRANTOR_ROLES)`, so the duplicate advisory compares against the PINNED version (`find_recent_duplicate(skill_version=...)`, [invocations.py:488-495](../../../velara-api/app/api/v1/invocations.py#L488)). Keep the existing swallow-all-errors behavior (advisory-only) — but a `SkillVersionNotFoundError` here should NOT surface (it's caught by the existing `except Exception: duplicate_of = None`, [invocations.py:501-503](../../../velara-api/app/api/v1/invocations.py#L501)); confirm that a bogus pinned version in a duplicate-check just returns "no duplicate," not a 404 (the real 404 comes from the submit path).

- [ ] **Task 3 — Executor runs the PINNED version's artifact (AC1, L1) — `app/services/execution_service.py`**
  - [ ] This is the headline. At all THREE sites replace `current_ver = next((v for v in skill.versions if v.id == skill.current_version_id), None)` with a resolution keyed on `job.skill_version`:
    - `_run_prompt` ([execution_service.py:420-430](../../../velara-api/app/services/execution_service.py#L420))
    - `_run_code` ([execution_service.py:536-544](../../../velara-api/app/services/execution_service.py#L536))
    - `_run_hybrid` ([execution_service.py:692-704](../../../velara-api/app/services/execution_service.py#L692)) — this single `current_ver` resolution feeds BOTH the `is_bundle` branch ([execution_service.py:704-744](../../../velara-api/app/services/execution_service.py#L704), reads `current_ver.artifact_set`/`artifact_key` then calls `_run_code_driven_hybrid(bundle_prefix=..., artifact_set=...)`) AND the inline branch ([execution_service.py:746-764](../../../velara-api/app/services/execution_service.py#L746)). **`_run_code_driven_hybrid` does NOT do its own version lookup** — it receives `bundle_prefix`/`artifact_set` from `_run_hybrid`. So fixing the ONE `current_ver` line at 692 covers the bundle sub-path and the code-driven-hybrid path; there is NO separate 4th site to fix. Confirm this by reading through the `is_bundle` branch — every artifact reference derives from the single `current_ver`.
  - [ ] Resolution: `target_ver = next((v for v in skill.versions if v.version == job.skill_version), None)`; **fall back** to `next((v for v in skill.versions if v.id == skill.current_version_id), None)` when `job.skill_version` is null/absent/unmatched (legacy jobs queued before this story, and any job whose `skill_version` no longer resolves). Keep the existing `if target_ver is None: raise RuntimeError("... no current version")` guard. **A shared helper** (`_resolve_version_for_execution(skill, job.skill_version)`) is cleaner than three copies — one definition, three call sites. NOTE: this executor-side resolution does NOT take `is_grantor` (the grantor gate already ran at queue time; `job.skill_version` is the already-decided pin) — do not re-gate here.
  - [ ] **Regression guard (the trap this story exists to close):** an existing non-pinned run (or a legacy job) still runs `current_version` — because `job.skill_version` for a normal run IS the current version at queue time, and the fallback covers null. Add a unit test per runtime asserting that when `job.skill_version` points at an OLDER version, the artifact fetched is that older version's `artifact_key`, not the current one (the bug this story fixes).
  - [ ] **Immutability safety:** because versions are immutable (published/certified) and content-addressed, fetching an older version's `artifact_key` is safe — the bytes are exactly what that version stored. A `draft` skill has only one (current) version, so pinning an older version implies a non-draft skill with history; no draft-mutability interaction.

- [ ] **Task 4 — New list-versions read endpoint (AC5) — `app/api/v1/skills.py`**
  - [ ] `GET /api/v1/skills/{skill_id}/versions` → `ResponseEnvelope[list[SkillVersionRead]]`. Mirror the `get_skill` route shape ([skills.py:411-431](../../../velara-api/app/api/v1/skills.py#L411)): `skill = await skill_service.get_skill(session, skill_id, org_id=user.org_id)` (org-scoped, 404 cross-org, already `selectinload`s `.versions`), then `[SkillVersionRead.model_validate(v) for v in sorted(skill.versions, key=... semver desc)]`. Router-level `RejectClient` already applies (skills router, [skills.py:48](../../../velara-api/app/api/v1/skills.py#L48)) — so clients 404, internal roles (incl. consultant) can list; the FE additionally hides the selector for non-grantors (Task 6). No per-route `RejectNonGrantor` needed on the read (listing versions is harmless internal metadata; the PRIVILEGE is on *pinning*, enforced in Task 2). Sort newest-first so the FE selector shows current + recent versions at the top.
  - [ ] `SkillVersionRead` already exposes only version/checksum/metadata (never artifact bytes/keys — [skill.py:283-303](../../../velara-api/app/schemas/skill.py#L283)); no new schema. api-spec.json diff = the new route.

- [ ] **Task 5 — FE api client + types (AC5) — `velara-web/src/api/jobs.ts` + `src/api/skills.ts` + skill types**
  - [ ] **`src/api/jobs.ts`** — add `version?: string` to `InvocationPayload` ([jobs.ts:9-17](../../../velara-web/src/api/jobs.ts#L9)). It flows through the existing `createInvocation` ([jobs.ts:131-134](../../../velara-web/src/api/jobs.ts#L131)) and `checkDuplicateInvocation` ([jobs.ts:136-145](../../../velara-web/src/api/jobs.ts#L136)) unchanged (they spread the payload).
  - [ ] **`src/api/skills.ts`** — add `listSkillVersions(skillId): Promise<SkillVersionSummary[]>` → `GET /api/v1/skills/{id}/versions` (unwrap `res.data.data`, mirror `getSkill` [skills.ts:64-67](../../../velara-web/src/api/skills.ts#L64)). Reuse the existing `SkillVersionSummary` type ([types.ts:113-125](../../../velara-web/src/features/skills/types.ts#L113)) — it already matches `SkillVersionRead`. Add a `useSkillVersions(skillId, enabled)` query hook (only fetch when the panel is open + caller is grantor).

- [ ] **Task 6 — FE version selector in Run Console (AC5) — `velara-web/src/features/run/components/RunConsole.tsx`**
  - [ ] Add a **version selector** to BOTH run flows (engagement-origin + skill-first). Gate it on `isGrantor()` ([auth.ts:101-107](../../../velara-web/src/shared/utils/auth.ts#L101)) — RunConsole is internal-not-grantor-facing ([internal.tsx:55,81,121-124](../../../velara-web/src/routes/internal.tsx#L55)), so a consultant can reach it but must NOT see/use the selector. Populate from `useSkillVersions(skill.id, isGrantor())`; default option = "Current (v{current_version.version})" mapping to `version: undefined` (omit → BE runs current).
  - [ ] Thread the selected version through BOTH `buildRunPayload()` bodies ([RunConsole.tsx:495](../../../velara-web/src/features/run/components/RunConsole.tsx#L495) and [~765](../../../velara-web/src/features/run/components/RunConsole.tsx#L765)) — add `if (selectedVersion) payload = { ...payload, version: selectedVersion }`. Because `buildRunPayload()` feeds BOTH `handleRun` (submit) AND `duplicateCheckPayload` (pre-flight, [RunConsole.tsx:520](../../../velara-web/src/features/run/components/RunConsole.tsx#L520)), the pin is automatically consistent across submit + duplicate-check — do NOT thread it separately.
  - [ ] Keep the default "Current" behavior a pure no-op (omit `version`) so non-pinned runs are byte-identical to today. The selector defaults to Current; only an explicit older-version pick sends `version`. Show the picked version in the run context so the user knows they're comparing (e.g. "Running v1.2.0" badge). Use `<Icon>` for any chevron/glyph — no emoji ([Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx)).
  - [ ] **Client portal untouched:** `ClientRun`/`clientPortal.ts` have no `version` field and must NOT gain one ([clientPortal.ts:142-160](../../../velara-web/src/api/clientPortal.ts#L142)).

- [ ] **Task 7 — Tests (AC: all)**
  - [ ] **BE unit `tests/unit/...` — the resolver + executor fix:**
    - `_resolve_target_version`: grantor + valid version → that version; grantor + bogus version → `SkillVersionNotFoundError`; non-grantor + version → current (ignored); no version → current; no current → `NoCurrentVersionError`.
    - Executor (per runtime, `_run_prompt`/`_run_code`/`_run_hybrid`): a job whose `skill_version` is an OLDER version fetches that version's `artifact_key` (⭐ the fix); a job whose `skill_version` is null/legacy falls back to current. Reuse existing execution-service test fixtures.
  - [ ] **BE integration `tests/integration/api/test_invocations.py` (EXTEND):**
    - admin/ma_tech pins an older `version` → 202; the job row + audit event record the PINNED version (assert `InvocationJob.skill_version` == pinned, `AuditLogEntry.skill_version` == pinned after the worker runs — or assert at queue time on the job row).
    - client/consultant supplies `version` → 202 but runs `current_version` (job.skill_version == current) — the ignore behavior (AC2).
    - grantor pins a nonexistent version → 404 `SKILL_VERSION_NOT_FOUND`, NO job created (assert job count unchanged).
    - retired skill + version pin → 422 `SKILL_RETIRED` (assert_invocable fires first).
    - no version supplied → unchanged current-version behavior (regression).
    - duplicate-check with a pinned version compares against the pinned version (Story 12.4 interaction) — a prior run of a DIFFERENT version is NOT flagged as a duplicate.
    - the `/invoke` proxy and client route inherit the field but the client route ignores it (non-grantor).
  - [ ] **BE integration — list-versions read:** `GET /{id}/versions` returns all versions newest-first (internal role 200; client 404 via RejectClient); org-scoped (cross-org 404).
  - [ ] **FE `RunConsole.test.tsx` (EXTEND) + `jobs.test.ts`/`skills.test.ts`:** the selector renders for a grantor and is HIDDEN for a consultant (mock `isGrantor()`); picking an older version threads `version` into `createInvocation` AND `checkDuplicateInvocation`; "Current" default omits `version`; `listSkillVersions` client shape. Mock `@/api/skills`/`@/api/jobs`.
  - [ ] **FE mock hygiene (11.4 lesson):** any test that mocks `@/features/skills/hooks/useSkills` or `@/api/skills` must include the NEW `useSkillVersions`/`listSkillVersions` exports — a partial mock missing a new export breaks unrelated suites (11.4 hit this exact class with `useImportSkill`). Grep for existing `vi.mock('@/api/skills'` / `vi.mock('.../useSkills'` and update each.

- [ ] **Task 8 — Gates**
  - [ ] **Backend:** `docker compose build api` then `docker compose run --rm -e AUTH_BACKEND=dev api python -m pytest` — baseline is 11.4's post-dev number (see sprint-status; the `test_skills.py`/`test_skill_export.py` suites pass whenever MinIO is healthy; the 3 known `test_ingest.py` MinIO failures + the pre-existing local-only `test_code_driven_execution.py` subprocess-hang are acceptable and NOT CI blockers). `ruff check .` clean.
  - [ ] **api-spec:** `AUTH_BACKEND=dev .venv/bin/python scripts/export_openapi.py` → regenerate `docs/api-spec.json`; expect a diff = the additive `version` field on `InvocationRequest`/`InvokeRequest` + the new `GET /skills/{id}/versions` route. Update the `test_openapi.py` spec-lock if it asserts the exact `InvocationRequest` field set. Confirm the diff is ONLY those.
  - [ ] **No migration** — `InvocationJob.skill_version` ([invocation.py:68](../../../velara-api/app/models/invocation.py#L68)) and `AuditLogEntry.skill_version` ([audit.py:99](../../../velara-api/app/models/audit.py#L99)) already exist; the `version` request field is not persisted as a column (it resolves to the existing `skill_version` value); the list-versions read reuses `SkillVersion`/`SkillVersionRead`. If a migration seems necessary, STOP and re-read this constraint.
  - [ ] **FE:** `npm run typecheck` (0) / `npm run lint` (baseline: 1 pre-existing `Icon.tsx` warning) / `npm run test` (vitest — record the new baseline; +new tests). All clean.

## Dev Notes

### Why this story's real work is the EXECUTOR, not the schema

The epic AC reads as a trivial "add a `version` field, the job/audit already record it." That is a trap. The research verified: the job row (`InvocationJob.skill_version`, [invocation.py:68-70](../../../velara-api/app/models/invocation.py#L68)) and the audit event (`AuditLogEntry.skill_version`, [audit.py:99](../../../velara-api/app/models/audit.py#L99)) DO faithfully record whatever `skill_version` is pinned at queue time — the audit path passes `job.skill_version` verbatim ([execution_tasks.py:263,286,343](../../../velara-api/app/workers/execution_tasks.py#L263)). **But the worker executes `skill.current_version_id`, not `job.skill_version`** ([execution_service.py:420,536,692](../../../velara-api/app/services/execution_service.py#L420)). So without Task 3, a version-pinned run records "v1.2.0" while running the v1.5.0 artifact — the outputs are identical to a current-version run and the audit is false. **The whole point of the story (compare an OLDER version's OUTPUT vs current) requires the executor fix.** This is why it's a locked headline (L1), not an optional nicety.

### The three resolution sites that must agree (single helper — L4)

The `current_version_id` lookup — `next((v for v in skill.versions if v.id == skill.current_version_id), None)` — is copy-pasted in FIVE places:
1. `queue_invocation` ([invocations.py:243](../../../velara-api/app/api/v1/invocations.py#L243)) — the pin site.
2. `check_duplicate` ([invocations.py:470](../../../velara-api/app/api/v1/invocations.py#L470)) — must match the pin so the advisory compares the right version.
3. `_run_prompt` ([execution_service.py:420](../../../velara-api/app/services/execution_service.py#L420)) — executor.
4. `_run_code` ([execution_service.py:536](../../../velara-api/app/services/execution_service.py#L536)) — executor.
5. `_run_hybrid` ([execution_service.py:692](../../../velara-api/app/services/execution_service.py#L692)) — executor.

The QUEUE side (1, 2) resolves from `body.version` (grantor-gated) → `SkillVersion`. The EXECUTOR side (3, 4, 5) resolves from the already-decided `job.skill_version` (no re-gating — the pin is a fait accompli by run time). Two helpers, one purpose each: `_resolve_target_version(skill, body.version, is_grantor)` for the queue, `_resolve_version_for_execution(skill, job.skill_version)` for the worker. Do NOT leave five ad-hoc copies — a divergence (e.g. fixing only 2 of 3 executor paths) is exactly the checkbox-vs-reality class the 11.1/11.2 reviews kept catching.

### The grantor gate is per-REQUEST, so it lives in the handler (not the route) — L2

`queue_invocation` is the single pipeline for THREE surfaces: internal (`invocations.py`, `RejectClient`-gated — admin/ma_tech/consultant reach it), client (`client.py`, calls `queue_invocation` verbatim — clients reach it), and the `/invoke` proxy. All share `InvocationRequest`. A route-level `RejectNonGrantor` on `invocations.py` would NOT help (it wouldn't cover the client route, and it would wrongly 404 nothing useful) and CANNOT go on the client route (clients must invoke current_version). So the gate is `user.role in _GRANTOR_ROLES` INSIDE the resolver — the `users.py:37,49` precedent (which explicitly documents WHY it avoids a route-level dep: [users.py:108-109](../../../velara-api/app/api/v1/users.py#L108)). A non-grantor's `version` is ignored (fall back to current), matching the epic AC "a client or consultant caller … uses current_version as today." The client FE never sends `version` anyway ([clientPortal.ts:142-160](../../../velara-web/src/api/clientPortal.ts#L142)) — the in-handler ignore is defense-in-depth for the shared schema.

### The retired guard is already correct — do NOT add a version-level check

`assert_invocable` ([skill_service.py:1382-1389](../../../velara-api/app/services/skill_service.py#L1382)) checks the SKILL's `lifecycle_state == "retired"` and fires at [invocations.py:237](../../../velara-api/app/api/v1/invocations.py#L237), BEFORE version resolution. `SkillVersion` has no per-version lifecycle field (retirement is a whole-skill property — [skill.py:165-218](../../../velara-api/app/models/skill.py#L165)). So a version-pinned run of a retired skill is already 422 `SKILL_RETIRED`. Keep `assert_invocable` before `_resolve_target_version`; a regression test locks it (AC3). Do NOT invent a per-version retirement concept.

### 404 (unknown version) vs 422 (no current version) — deliberate

- A grantor asks for a version that doesn't exist → **404 `SKILL_VERSION_NOT_FOUND`** (`SkillVersionNotFoundError`, [skill_service.py:76-84](../../../velara-api/app/services/skill_service.py#L76)) — "you asked for a resource that isn't there." Reuse the exact error 11.4's `skill_export` uses ([skill_export.py:171](../../../velara-api/app/services/skill_export.py#L171)).
- A skill has no resolvable current version → **422 `SKILL_NO_CURRENT_VERSION`** (`NoCurrentVersionError`, [invocations.py:56-71](../../../velara-api/app/api/v1/invocations.py#L56)) — "this skill is internally unrunnable." Unchanged.
Both fire synchronously BEFORE `create_job`, so no bogus job is queued (the existing discipline the epic AC references).

### Reuse map — do NOT reinvent

| Need | Reuse |
|---|---|
| "Resolve pinned version, else current, else 404" | `skill_export.py` resolver ([skill_export.py:162-171](../../../velara-api/app/services/skill_export.py#L162)) — the exact shape (Story 11.4) |
| Unknown-version error | `SkillVersionNotFoundError` (404 `SKILL_VERSION_NOT_FOUND`, [skill_service.py:76-84](../../../velara-api/app/services/skill_service.py#L76)) |
| No-current-version error | `NoCurrentVersionError` (422, [invocations.py:56-71](../../../velara-api/app/api/v1/invocations.py#L56)) |
| Retired guard (unchanged) | `assert_invocable` ([skill_service.py:1382](../../../velara-api/app/services/skill_service.py#L1382)) |
| Grantor set + in-handler check | `_GRANTOR_ROLES` ([dependencies.py:123](../../../velara-api/app/core/dependencies.py#L123)); in-handler pattern [users.py:37,49](../../../velara-api/app/api/v1/users.py#L37) |
| Version list already loaded | `get_skill` `selectinload(Skill.versions)` ([skill_service.py:837](../../../velara-api/app/services/skill_service.py#L837)) — no new query |
| Job records skill_version | `create_job(skill_version=...)` → `InvocationJob.skill_version` ([job_service.py:193](../../../velara-api/app/services/job_service.py#L193), [invocation.py:68](../../../velara-api/app/models/invocation.py#L68)) |
| Audit records skill_version | `record_invocation(skill_version=job.skill_version)` ([execution_tasks.py:263](../../../velara-api/app/workers/execution_tasks.py#L263), [audit.py:99](../../../velara-api/app/models/audit.py#L99)) |
| List-versions read schema | `SkillVersionRead` ([skill.py:283-303](../../../velara-api/app/schemas/skill.py#L283)) — no new schema |
| Skill GET route to mirror | `get_skill` ([skills.py:411-431](../../../velara-api/app/api/v1/skills.py#L411)) |
| FE payload + POST | `InvocationPayload` + `createInvocation`/`checkDuplicateInvocation` ([jobs.ts:9-17,131-145](../../../velara-web/src/api/jobs.ts#L9)) |
| FE payload builders (both flows) | `buildRunPayload()` ([RunConsole.tsx:495](../../../velara-web/src/features/run/components/RunConsole.tsx#L495), [~765](../../../velara-web/src/features/run/components/RunConsole.tsx#L765)) — feeds submit + duplicate-check |
| FE grantor gate | `isGrantor()` ([auth.ts:101-107](../../../velara-web/src/shared/utils/auth.ts#L101)) |
| FE version summary type | `SkillVersionSummary` ([types.ts:113-125](../../../velara-web/src/features/skills/types.ts#L113)) |

### Error-code map (this story ADDS none — reuses existing)

| Code | Meaning | Source |
|---|---|---|
| `SKILL_VERSION_NOT_FOUND` (404) | grantor pinned a nonexistent version | `SkillVersionNotFoundError` (11.4-era) |
| `SKILL_NO_CURRENT_VERSION` (422) | skill has no resolvable current version | `NoCurrentVersionError` (existing) |
| `SKILL_RETIRED` (422) | run requested against a retired skill (pinned or not) | `assert_invocable` (existing) |

### IP / PHI discipline (house invariants)

- `version` is a runtime semver string — NOT skill internals. `InvocationRequest`'s IP boundary (no prompt/artifact fields, `extra="forbid"`, [invocation.py:6-8,55](../../../velara-api/app/schemas/invocation.py#L6)) is preserved.
- The list-versions read returns `SkillVersionRead` — version/checksum/metadata only, never artifact keys or bytes ([skill.py:283-303](../../../velara-api/app/schemas/skill.py#L283)). Do NOT add artifact content to it.
- Never log artifact bytes; the pinned version string + IDs are safe to log (mirrors existing `invocation_queued` logs).

### Sequencing / dependencies

- Recommended epic order 11.1 ✅ → 11.2 ✅ → 11.6 ✅ → 11.3 ✅ → 11.9 ✅ → 11.4 (review) → **11.7** → 11.5. Independent of 11.4 and 11.5 (the version-pin needs only that multiple versions exist — Epic 2 registry + Epic 5 invocation loop, both done). Slots anywhere after versions can exist; picked before 11.5 (in-app promote) per the recommended order.
- Epic 11 is already `in-progress`; this is NOT the first story → **no epic-status update needed**.
- Interacts with **Story 12.4** (duplicate-run advisory) — the pin must be consistent in `check_duplicate` (Task 2) so a pinned run's advisory compares the right version. Interacts with **Story 11.4** only via the reused `skill_export` resolver pattern + `SkillVersionNotFoundError` (no code dependency).

### Project Structure Notes

- **velara-api:** MODIFY `app/schemas/invocation.py` (`version` field); MODIFY `app/api/v1/invocations.py` (`_resolve_target_version` helper + apply in `queue_invocation` + `check_duplicate`); MODIFY `app/services/execution_service.py` (executor resolves `job.skill_version` at 3 sites — the headline); MODIFY `app/api/v1/skills.py` (new `GET /{id}/versions`); EXTEND `tests/integration/api/test_invocations.py` + `tests/unit/...` (resolver + executor) + `tests/integration/api/test_skills.py` (list-versions); UPDATE `tests/integration/api/test_openapi.py` (spec lock) + regenerate `docs/api-spec.json`. **No new model, no migration.**
- **velara-web:** MODIFY `src/api/jobs.ts` (`InvocationPayload.version`); MODIFY `src/api/skills.ts` (`listSkillVersions`) + `useSkills.ts` (`useSkillVersions`); MODIFY `src/features/run/components/RunConsole.tsx` (grantor-gated version selector in BOTH flows + both `buildRunPayload`); EXTEND `RunConsole.test.tsx` + api tests. NO change to `ClientRun`/`clientPortal.ts`.
- `api-spec.json` WILL diff (additive `version` field + new list-versions route) — expected; confirm it is ONLY that.

### References

- [Source: epics/epic-11-ai-assisted-skill-integration-and-promotion.md#Story-11.7] — the ACs (optional `version`, grantor-gated, nonexistent/retired guard, "job + audit already record skill_version"), and the sequencing table (11.7 independent, slots after 11.1, before 11.5).
- [Source: planning-artifacts/sprint-change-proposal-2026-07-06.md] — R6 gap: "Only the current version is runnable. `queue_invocation` hard-pins every run to `skill.current_version`; `InvocationRequest` has no version field." (The exact gap this closes.)
- [Source: _bmad-output/implementation-artifacts/stories/11-4-export-import-portable-skill-bundles.md] — the sibling that introduced the reusable version resolver (`skill_export.py:162-171`) + `SkillVersionNotFoundError`; its FE-mock-hygiene lesson (a partial mock missing a new export breaks unrelated suites).
- [Source: velara-api app/api/v1/invocations.py:53,56-71,202-403,406-429,432-508] — router `RejectClient`, `NoCurrentVersionError`, `queue_invocation` (the pin at 243-246 + 3 job-creation branches), `invoke_skill`, `check_duplicate` (parallel pin at 470-492).
- [Source: velara-api app/services/execution_service.py:297-376,382-430,503-544,660-704,1092-1113] — `execute_skill` dispatch (passes `job` to all 3 `_run_*`), the three `current_version_id` artifact resolutions to change, fan-out child version inheritance.
- [Source: velara-api app/schemas/invocation.py:6-8,19-63,66] — `InvocationRequest` (`extra="forbid"`, IP docstring, add `version`), `InvokeRequest` inheritance.
- [Source: velara-api app/services/skill_export.py:141-171] — the "resolve pinned version, else current, else SkillVersionNotFoundError" resolver to model on.
- [Source: velara-api app/services/skill_service.py:76-84,837,1382-1389] — `SkillVersionNotFoundError` (404), `get_skill` selectinload of `.versions` (org-scoped), `assert_invocable` (skill-level retired guard).
- [Source: velara-api app/core/dependencies.py:106,115,123,213-231] — `_INTERNAL_ROLES`, `_GRANTOR_ROLES`, `reject_non_grantor`/`RejectNonGrantor` (why the gate is in-handler, not route-level).
- [Source: velara-api app/api/v1/users.py:37,49,108-109] — the in-handler `if user.role not in _GRANTOR_ROLES` precedent + the documented reason it avoids a route-level dep.
- [Source: velara-api app/api/v1/client.py:37,182-212] — the client invocation route reusing `queue_invocation` verbatim with the same `InvocationRequest` (why the grantor gate must be in the shared resolver).
- [Source: velara-api app/api/v1/skills.py:48,411-431,488-526] — router `RejectClient`, the `get_skill` GET route to mirror for list-versions, the existing `POST /versions` create (list is net-new).
- [Source: velara-api app/models/invocation.py:68-70] / [app/models/audit.py:99] — `InvocationJob.skill_version` / `AuditLogEntry.skill_version` columns (already present — no migration; the "traceable automatically" claim's basis).
- [Source: velara-api app/workers/execution_tasks.py:204,260-263,283-286,340-343,508,574-577] — where the audit records `job.skill_version` (already pin-faithful).
- [Source: velara-api app/services/job_service.py:170-215] — `create_job(skill_version=...)` writing the job row.
- [Source: velara-web src/api/jobs.ts:9-17,131-145] — `InvocationPayload` (+`version?`), `createInvocation`/`checkDuplicateInvocation`.
- [Source: velara-web src/features/run/components/RunConsole.tsx:495,520,717-722,765] — both `buildRunPayload()` bodies (feed submit + duplicate-check), the `skillNoVersion` disabled-state, no existing version selector.
- [Source: velara-web src/features/skills/types.ts:113-130] — `SkillVersionSummary` (reuse) + `SkillWithVersion` (only `current_version`, no `versions[]` — the FE gap).
- [Source: velara-web src/api/skills.ts:64-67] — `getSkill` client shape to mirror for `listSkillVersions`.
- [Source: velara-web src/shared/utils/auth.ts:97-112] — `GRANTOR_ROLES`/`isGrantor()`/`isInternal()` (gate the selector).
- [Source: velara-web src/routes/internal.tsx:55,81,121-124] — RunConsole is `RequireInternal` (NOT `RequireGrantor`) — so a consultant reaches it; the selector must be `isGrantor()`-gated in-component.
- [Source: velara-web src/api/clientPortal.ts:142-160] / src/features/client-portal/components/ClientRun.tsx — the client run path (no `version` field; must stay unchanged).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
