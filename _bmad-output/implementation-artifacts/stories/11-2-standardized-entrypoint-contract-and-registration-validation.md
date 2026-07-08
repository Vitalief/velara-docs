---
baseline_commit: 007e50d (velara-api)
---

# Story 11.2: Standardized Entrypoint Contract + Registration-Time Validation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the platform,
I want one standardized code-driven entrypoint contract enforced at registration,
so that skills stop needing bespoke hand-written adapter shims (Epic 5.5 retro Action Item 1).

## Acceptance Criteria

1. **AC1 — Callable-signature validation at registration (bundle path).**
   **Given** the canonical contract `run(input_path, output_dir, params: dict)` ([core-architectural-decisions.md#AI-Skill-Integration-Assistant](../../planning-artifacts/architecture/core-architectural-decisions.md), decision 1)
   **When** a code-driven hybrid is registered **from a ZIP bundle** (create or new version)
   **Then** the registration validator statically checks the declared entrypoint's **callable signature** — the entrypoint module must be present in the bundle, resolvable from the bundle's package root, defined as a synchronous top-level `def`, and the call `func(input_path=…, output_dir=…, params=…)` must bind — and a non-conforming skill is rejected **422** with a NEW stable error code `ENTRYPOINT_CONTRACT_VIOLATION` whose message names the specific problem (module not found / not a function / async / which parameter fails binding) without echoing source bytes. *(The inline manifest-only path carries no code to inspect and keeps today's `module:callable` string-format check — see Dev Notes "Contract boundary".)*

2. **AC2 — A conforming bundle skill runs E2E on the existing runner, no adapter.**
   **Given** a conforming bundle skill (entrypoint matches the contract)
   **When** it is invoked
   **Then** it executes on the existing `code_driven_executor` runner **unchanged in call shape** (`func(input_path=…, output_dir=…, params=dict)`): the executor replaces its Step-2 no-op with real bundle materialization — every `artifact_set` member is fetched from `StorageProvider`, **sha256-verified against the recorded checksum** (byte-for-byte, the 11.1 content-addressed promise enforced at run time), written under the workspace, the resolved package root becomes `bundle_dir`/`sys.path` — and the run produces a valid result envelope. **This closes the accepted 11.1 review gap (deferred-work.md:388): running a bundle version no longer dies with botocore NoSuchKey.**

3. **AC3 — Everything that isn't a bundle-registered code-driven hybrid is unaffected.**
   **Given** the existing LLM-driven hybrid, prompt, and code skills — and the inline (manifest-only, no ZIP) code-driven path
   **When** they are registered and invoked
   **Then** they behave exactly as today: no signature check applies (LLM-driven hybrids have no entrypoint; inline code-driven manifests keep the `_ENTRYPOINT_RE` string check + the Phase-1 requirements-lockfile install mechanism), all existing registration/execution tests pass untouched, and the error-code surface for those paths is unchanged.

4. **AC4 — Clear, specific failures on both sides of the contract.**
   **Given** a bundle whose entrypoint module is missing from the archive, unparseable as Python, resolves to a non-function, or has a non-binding signature
   **When** registration is attempted
   **Then** each case yields 422 `ENTRYPOINT_CONTRACT_VIOLATION` with a distinct, specific message (never a 500, never a generic message) and nothing is persisted;
   **and Given** a stored bundle member whose bytes no longer match its recorded sha256 (integrity drift)
   **When** the skill is invoked
   **Then** the run fails with the existing `CODE_DRIVEN_EXECUTION_ERROR` (a clean mapped job failure, not an unmapped crash).

## Tasks / Subtasks

> **Scope locked at story creation (from the epic ADR + the 11.1 review decision — do not re-litigate):**
> **(S1)** The canonical contract is `run(input_path, output_dir, params: dict)` — exactly the shape the runner already calls ([code_driven_executor.py:135-143](../../../velara-api/app/services/code_driven_executor.py#L135)). The runner's call shape does NOT change; deferred-work.md:214's "option (a) splat kwargs" is REJECTED by the ADR — a skill with named kwargs (the real `velara-protocol-extractor`) is *non-conforming by design* and is Story 11.3's AI-assistant case.
> **(S2)** Executor consumption of bundles IS this story (user decision 2026-07-08, recorded in the 11.1 review + deferred-work.md:388) — not just the registration check.
> **(S3)** Backend-only. No FE changes: the new 422 renders through the existing `SkillBundleUpload`/`SkillForm` inline-error path shipped in 11.1 (`getErrorMessage` shows the response `detail`). No migration, no new config, no new endpoints.

- [x] **Task 1 — Bundle-layout resolution helpers (AC1, AC2) — shared, single source of truth**
  - [x] In [bundle_extractor.py](../../../velara-api/app/services/bundle_extractor.py): extract `find_manifest_path(paths: list[str]) -> str | None` from the existing `find_manifest` (same convention: top-level `manifest.json`, else exactly one `*/manifest.json`; ambiguous/absent → None) and refactor `find_manifest` to use it. Execution needs the *path* against `artifact_set` (no bytes available); registration keeps using `find_manifest`. Do NOT fork the convention into a second implementation.
  - [x] NEW `app/services/entrypoint_contract.py` with `resolve_entrypoint_module(paths: list[str], entrypoint: str) -> tuple[str, str] | None` returning `(package_root, module_file_path)`:
    - Module `a.b` maps to candidate files `a/b.py` then `a/b/__init__.py`.
    - Package roots probed in order: `""` (bundle root), `src/`, `<single-top-level-dir>/`, `<single-top-level-dir>/src/` — where `<single-top-level-dir>` exists only when *every* member shares one first path segment (mirrors `find_manifest`'s single-root-wrap convention). First hit wins; None if no candidate exists.
    - **CRITICAL: the registration validator (Task 2) and the executor (Task 5) MUST both call this helper** — divergent resolution would let registration pass and the run fail (or vice versa). That symmetry is the point of the story.
- [x] **Task 2 — Static callable-signature validator (AC1, AC4) — NEW in `entrypoint_contract.py`**
  - [x] `def validate_entrypoint_contract(files: list[tuple[str, bytes]], entrypoint: str) -> None` — pure, no code execution (**NEVER import/exec the untrusted module in the API process**; the bundle is adversarial input, same posture as [bundle_extractor.py](../../../velara-api/app/services/bundle_extractor.py)):
    - Resolve the module file via Task 1's helper; missing → violation "entrypoint module '<mod>' was not found in the bundle".
    - `ast.parse` the module source; `SyntaxError`/undecodable → violation "entrypoint module could not be parsed" (never echo source — the 5.5.1 IP-discipline: name the location/type, never the content).
    - Locate a **top-level** `ast.FunctionDef` named `<callable>`. An `ast.AsyncFunctionDef` → violation "entrypoint must be a synchronous function" (the runner calls it synchronously; a coroutine return would only fail later as an envelope error). Found only as an import-alias/assignment/class or not at all → violation "entrypoint '<fn>' is not defined as a top-level function in module '<mod>'" (re-exports are NOT followed — first cut; document in the message that the def must live in the declared module).
    - **Signature check = simulated bind, not name pattern-matching:** reconstruct an `inspect.Signature` from the AST's `arguments` (posonly / args / vararg / kwonly / kwarg + defaults; annotations are irrelevant — use `Parameter.empty`) and run `sig.bind(input_path=None, output_dir=None, params={})` in try/except `TypeError`. This is *exactly* the call the runner makes ([code_driven_executor.py:141](../../../velara-api/app/services/code_driven_executor.py#L141)), so it correctly accepts `**kwargs` catch-alls, keyword-only styles, and extra defaulted params, and correctly rejects positional-only collisions, missing params, and extra required params. On `TypeError`, surface a violation naming the failure (e.g. "parameter 'params' cannot be bound" / "required parameter 'model' has no default"). Do not hand-roll binding rules.
    - Decorated defs are accepted on their declared signature (a decorator can rewrap invisibly — static-analysis limitation; note it in the module docstring, not an error).
  - [x] NEW `EntrypointContractViolationError(VelaraHTTPException)` — 422, stable code `ENTRYPOINT_CONTRACT_VIOLATION`, mirroring `InvalidBundleError` ([bundle_extractor.py:67-78](../../../velara-api/app/services/bundle_extractor.py#L67)). Keep it distinct from `INVALID_CODE_DRIVEN_MANIFEST` (manifest fields are fine; the *code* doesn't conform) and from `INVALID_BUNDLE` (zip structure is fine). **This code is load-bearing for Story 11.3:** the AI integration assistant triggers on exactly this signal — never rename it, never fold it into an existing code.
  - [x] Register `ERROR_CODE_ENTRYPOINT_CONTRACT_VIOLATION = "ENTRYPOINT_CONTRACT_VIOLATION"` in the [execution_tasks.py](../../../velara-api/app/workers/execution_tasks.py) constants block, exactly as `ERROR_CODE_INVALID_BUNDLE` was catalogued there in 11.1 (registration-path codes live alongside for the same reason — see the comment at execution_tasks.py:53).
- [x] **Task 3 — Hook validation into bundle registration (AC1, AC3) — `skill_service.py`, one seam**
  - [x] In `_process_bundle` ([skill_service.py:371-385](../../../velara-api/app/services/skill_service.py#L371)) — the single choke point both `_create_skill_from_bundle` and the `create_version` bundle branch already flow through — after `parse_code_driven_manifest`, call `validate_entrypoint_contract(files, manifest.entrypoint)`. Extraction and validation both happen **before any S3 write**, so a rejected bundle persists nothing (same guarantee 11.1 established; no new cleanup path needed).
  - [x] Do NOT touch the inline paths (`create_skill` inline branch, `create_version` inline branch) — the string-format `_ENTRYPOINT_RE` check inside `CodeDrivenHybridManifest` ([code_driven_hybrid.py:33-35,74-82](../../../velara-api/app/services/code_driven_hybrid.py#L33)) remains their only entrypoint validation (AC3; see "Contract boundary" in Dev Notes).
- [x] **Task 4 — Execution: fetch the bundle manifest at run time (AC2) — `execution_service.py`**
  - [x] In `_run_hybrid`, before the artifact fetch ([execution_service.py:698-700](../../../velara-api/app/services/execution_service.py#L698)): branch on `current_ver.is_bundle`. For a bundle, the manifest is a *member*, not the artifact: `manifest_path = find_manifest_path([m["path"] for m in current_ver.artifact_set])`, then `storage.get(f"{current_ver.artifact_key}/{manifest_path}")` (artifact_key is the bundle **prefix** for bundle versions — [skill.py:199-204](../../../velara-api/app/models/skill.py#L199)). Registration guarantees a bundle is code-driven, so parse with `parse_code_driven_manifest` directly and dispatch to `_run_code_driven_hybrid`; defensively map an absent/None `manifest_path` or empty `artifact_set` to `CodeDrivenExecutionError` (tampered/legacy row), never an unhandled exception.
  - [x] Thread the bundle identity through to the executor: pass `bundle_prefix=current_ver.artifact_key` and `artifact_set=current_ver.artifact_set` (new optional keyword params, default None) from `_run_code_driven_hybrid` into `run_code_driven_hybrid`. The prompt (429) and code (543) fetch sites are untouched — bundles are hybrid-only (11.1 review patch enforced `runtime_type == "hybrid"`).
- [x] **Task 5 — Executor: replace the Step-2 no-op with real bundle materialization (AC2, AC4) — `code_driven_executor.py`**
  - [x] In `run_code_driven_hybrid` Step 2 ([code_driven_executor.py:198-205](../../../velara-api/app/services/code_driven_executor.py#L198)): when `artifact_set` is provided, for each member: `skill_storage.get(f"{bundle_prefix}/{path}")` via `run_in_threadpool`, **verify `hashlib.sha256(bytes).hexdigest() == member["sha256"]`** (mismatch → `CodeDrivenExecutionError("Bundle artifact integrity check failed.")` — AC4), re-check the path with `_is_path_safe` from bundle_extractor before any filesystem join (defense-in-depth: extraction guaranteed canonical paths at registration, but the DB row is trusted-at-a-distance), then write to `workspace/bundle/{path}` (`os.makedirs(dirname, exist_ok=True)`; reuse `_write_bytes_sync`). Materialize under `workspace/bundle/` — NOT the workspace root, which already holds `runner.py`/`requirements.txt`/`venv/` (a member named `runner.py` must not collide with ours).
  - [x] `bundle_dir = os.path.join(workspace, "bundle", package_root)` where `package_root` comes from `resolve_entrypoint_module(paths, manifest.entrypoint)` — the SAME helper registration used (Task 1 symmetry). The entrypoint subprocess already runs with `cwd=bundle_dir` (line 390) — keep that.
  - [x] Make the import actually resolve: `python runner.py` puts the *script's* directory (workspace) on `sys.path`, not the cwd — so add ONE line to `_RUNNER_SCRIPT`: `sys.path.insert(0, os.getcwd())` (plus the `os` import). Harmless for the legacy inline path (cwd was already the workspace). Note `_RUNNER_SCRIPT` is an f-string — any literal braces need doubling (none required for this line).
  - [x] When `artifact_set` is None (legacy inline manifest skill): behavior byte-for-byte identical to today — `bundle_dir = workspace`, requirements-lockfile install mechanism unchanged (AC3). Steps 3-10 (venv, pip install of `manifest.requirements`, secrets, inputs, runner, envelope, persist, cleanup) are all unchanged for both paths — a bundle's pinned deps still install from the lockfile; the bundle's own code is now imported from `bundle_dir` instead of needing to be pip-installable.
  - [x] Log per 11.1 discipline: member count + total bytes materialized + duration; never member bytes; member *paths* are acceptable in error messages (11.1 precedent: `InvalidBundleError` names paths).
- [x] **Task 6 — Tests (AC: all)**
  - [x] **Unit `tests/unit/services/test_entrypoint_contract.py` (NEW)** — pure Python, no DB/S3:
    - Conforming: exact three params; extra params with defaults; keyword-only forms (`*, params={}` variants); `**kwargs` catch-all; decorated def; `params` without annotation (annotations must NOT matter).
    - Non-conforming (each asserting the specific message + `ENTRYPOINT_CONTRACT_VIOLATION`): missing one of the three params; positional-only `input_path`; extra required param; `async def`; entrypoint not found; found-as-import-alias (`from .impl import run`); found-as-class; module file absent from bundle; unparseable module.
    - `resolve_entrypoint_module`: bundle-root `a/b.py`; package `a/b/__init__.py`; `src/` layout; single-top-dir wrap; single-top-dir + `src/`; not-found → None. `find_manifest_path`: parity cases with the existing `find_manifest` tests.
  - [x] **Unit `tests/unit/services/test_code_driven_executor.py` (EXTEND)** — mock storage: materialization writes every member under `workspace/bundle/` preserving relative dirs; sha256 mismatch → `CodeDrivenExecutionError`; unsafe recorded path (e.g. `../x` planted in artifact_set) rejected; `artifact_set=None` leaves Step 2 as the no-op (`bundle_dir == workspace`).
  - [x] **Integration `tests/integration/api/test_skills.py` (EXTEND)** — reuse 11.1's bundle-test helpers (`_auth_headers("ma_tech")`, staged-key flow, in-memory zip builders): conforming bundle → 201; signature-mismatch bundle (named-kwargs entrypoint à la the real extractor) → 422 `ENTRYPOINT_CONTRACT_VIOLATION`, nothing persisted; entrypoint-module-absent bundle → 422; inline code-driven create/version still 201 with **no** signature check (AC3); LLM-driven hybrid + prompt/code registration untouched (existing tests must pass unmodified).
  - [x] **Integration `tests/integration/api/test_code_driven_execution.py` (EXTEND)** — the deferred-work.md:388 closure test: register a skill from a real ZIP bundle whose entrypoint module lives IN the bundle (not pip-installed), invoke it, assert the job succeeds with a valid envelope. Manifest `requirements` can be `"# no external deps\n"` — non-empty (passes manifest validation) and `pip install -r` of a comment-only file succeeds, so no editable-install scaffolding is needed for the bundle path. Follow the existing file's venv-based E2E template + Docker skip guard.
- [x] **Task 7 — Gates**
  - [x] `ruff check .` clean. Rebuild the api image (`docker compose build api` — it bakes source) then full suite in-container: `docker compose run --rm -e AUTH_BACKEND=dev api python -m pytest` — baseline 1138 passed; only the 3 known pre-existing `test_ingest.py` MinIO-in-container failures are acceptable.
  - [x] `AUTH_BACKEND=dev .venv/bin/python scripts/export_openapi.py` on the host — expect **no diff** in `docs/api-spec.json` (no new endpoints/schemas; if a diff appears, something widened scope — investigate before committing).
  - [x] No migration (no schema change), no FE changes, no new config — if you are adding any of these, re-read the scope locks.

## Dev Notes

### Why this story is two halves (and both are mandatory)

1. **The epic half (ACs from epic-11):** upgrade registration validation from the `module:callable` *string-format* regex to a real **callable-signature** check against the canonical contract `run(input_path, output_dir, params: dict)`.
2. **The 11.1-review half (user decision 2026-07-08, deferred-work.md:388):** bundle versions registered since 11.1 are certifiable/publishable/invocable but **crash at run time** — `_run_hybrid` does `skill_storage.get(current_ver.artifact_key)` ([execution_service.py:698-700](../../../velara-api/app/services/execution_service.py#L698)) on what is a directory *prefix* for `is_bundle` versions → botocore NoSuchKey → unmapped generic job failure. The interim guard was explicitly declined ("executor consumption of bundles IS Story 11.2"). **This story MUST make bundle skills runnable E2E.** A signature check alone does not satisfy this story.

### The contract, verified against the code

- **Runner call shape (the contract's ground truth):** `_RUNNER_SCRIPT` invokes `func(input_path=input_path, output_dir=sys.argv[3], params=json.loads(sys.argv[4]))` ([code_driven_executor.py:135-143](../../../velara-api/app/services/code_driven_executor.py#L135)). "Conforming" means precisely: *that call binds*. The validator simulates this bind statically (Task 2) — do not invent a parallel definition of conformance.
- **The hand-written 5.5.6 adapter is the conformance witness:** `velara_extractor.adapter:run(input_path, output_dir, params)` (mirrored in [test_adapter_shim.py](../../../velara-api/tests/unit/services/test_adapter_shim.py)) conforms; the raw client skill `velara_extractor.plugin:run(input_path, output_dir=None, *, model=None, …)` does NOT (its kwargs are named, `params` is unknown to it → TypeError — exactly the deferred-work.md:214 failure). 11.2 makes that mismatch a **registration-time 422** instead of a run-time crash; 11.3 makes the AI propose the adapter. Do not "fix" the mismatch by widening the runner call (S1).
- **Contract boundary — where the signature check applies:** only where code is available to inspect, i.e. the ZIP-bundle path. The inline path registers a manifest whose `requirements` lockfile delivers the code at run time (editable/local install — [code_driven_executor.py:198-205](../../../velara-api/app/services/code_driven_executor.py#L198) comment); there is no source to parse at registration. Inline keeps the `_ENTRYPOINT_RE` string check (unchanged). State this boundary in `entrypoint_contract.py`'s docstring so 11.3 inherits it knowingly.

### Static analysis, never import (security posture)

The bundle is **untrusted client-supplied code** ([bundle_extractor.py](../../../velara-api/app/services/bundle_extractor.py) module docstring). Importing the entrypoint module to `inspect.signature` it would execute arbitrary code inside the API process — the exact class of hole 11.1's review hunted. The validator is `ast.parse` + a reconstructed `inspect.Signature` + `sig.bind(...)` in try/except. No exec, no import, no subprocess at registration. (A sandboxed import-and-verify is a materially different capability — the ADR's "test-in-the-loop" note scopes that to a future story.)

### Error-code map after this story (stable, SCREAMING_SNAKE_CASE, never rename)

| Code | Meaning | Introduced |
|---|---|---|
| `INVALID_BUNDLE` | ZIP structurally bad (slip/bomb/symlink/corrupt/empty) | 11.1 |
| `INVALID_CODE_DRIVEN_MANIFEST` | manifest field missing/invalid | 5.5.1 |
| `ENTRYPOINT_CONTRACT_VIOLATION` | zip fine, manifest fine, the **code** doesn't fit the contract | **11.2 (NEW)** |
| `HYBRID_SHAPE_MISMATCH` | code-driven ↔ LLM-driven swap across versions | 5.5.1 |
| `CODE_DRIVEN_EXECUTION_ERROR` | run-time execution failure (now incl. materialization/integrity) | 5.5.3 |

`ENTRYPOINT_CONTRACT_VIOLATION` is Story 11.3's trigger signal (the FE will offer "AI-adapt this skill" on exactly this code) — its stability is a contract with the next story.

### Executor materialization — design constraints (verified)

- `artifact_set` = `[{"path", "sha256", "size", "content_type"}, ...]`; `artifact_key` = `skills/{skill_id}/{version}/{bundle_checksum}` prefix; member object key = `{artifact_key}/{path}` ([skill_service.py:326-368](../../../velara-api/app/services/skill_service.py#L326), [skill.py:199-208](../../../velara-api/app/models/skill.py#L199)).
- Paths in `artifact_set` were canonical-guarded at extraction (`_is_path_safe`, [bundle_extractor.py:84-114](../../../velara-api/app/services/bundle_extractor.py#L84)) — re-check at materialization anyway (rows are not re-validated between write and run).
- All storage/filesystem calls in the executor go through `run_in_threadpool` (established pattern throughout `run_code_driven_hybrid`); hashing up to the bundle cap is CPU-bound — thread-pool it like `_compute_bundle_record` does ([skill_service.py:347-350](../../../velara-api/app/services/skill_service.py#L347)).
- Workspace cleanup is already the `finally` block (Step 10) — materialized bundle files ride along free.
- Subprocess env stays literal-built ([code_driven_executor.py:269-284](../../../velara-api/app/services/code_driven_executor.py#L269)) — materialization must not add env.
- `_validate_requirements` still permits bare local paths (Phase-1 inline mechanism) — leave it; tightening it for bundle skills is optional hardening, NOT this story (note it in Completion Notes if tempted).

### Reuse map — do NOT reinvent

| Need | Reuse |
|---|---|
| Manifest-locate convention | `find_manifest` → refactor out `find_manifest_path` ([bundle_extractor.py:235-258](../../../velara-api/app/services/bundle_extractor.py#L235)) |
| Path-safety at materialization | `_is_path_safe` ([bundle_extractor.py:84](../../../velara-api/app/services/bundle_extractor.py#L84)) — import it, don't copy it |
| 422 exception pattern | `InvalidBundleError` ([bundle_extractor.py:67](../../../velara-api/app/services/bundle_extractor.py#L67)) as the template for `EntrypointContractViolationError` |
| Error-code cataloguing | `ERROR_CODE_INVALID_BUNDLE` in [execution_tasks.py:53-56](../../../velara-api/app/workers/execution_tasks.py#L53) |
| Registration choke point | `_process_bundle` ([skill_service.py:371](../../../velara-api/app/services/skill_service.py#L371)) — one hook covers create + version |
| Byte-write helper | `_write_bytes_sync` ([code_driven_executor.py:713](../../../velara-api/app/services/code_driven_executor.py#L713)) |
| Run-time failure mapping | `CodeDrivenExecutionError` (422 → failed job, already mapped) — no new run-time code |
| E2E execution test harness | [test_code_driven_execution.py](../../../velara-api/tests/integration/api/test_code_driven_execution.py) (venv-based, Docker skip guard) |
| Bundle zip-building test helpers | 11.1's additions in [test_skills.py](../../../velara-api/tests/integration/api/test_skills.py) + [test_skill_service_bundle.py](../../../velara-api/tests/unit/services/test_skill_service_bundle.py) |

### IP / PHI discipline (house invariants)

- Violation messages name the module/callable/parameter and the failure type — **never** source lines, never AST dumps (5.5.1 review lesson: messages built from field location + error type only).
- Log at materialization: member count, total bytes, duration_ms — never member bytes; never `requirements` content (package count only, existing discipline).
- Nothing new is persisted: no schema change, no new columns, no new read-schema fields.

### Previous Story Intelligence (11.1, reviewed 2026-07-08 — direct predecessor)

- Its review found a 🔴 IDOR from trusting a client-supplied key — the same adversarial posture applies here: treat `artifact_set` rows and bundle bytes as untrusted at run time (hence the sha256 re-verify + `_is_path_safe` re-check).
- `zf.read` corruption and non-canonical paths escaped as 500s until patched — the twin lesson for 11.2: every new failure mode must map to a typed 422/`CodeDrivenExecutionError`, never an unhandled exception (AC4).
- "Task checkbox checked but unimplemented" was caught twice in 11.1's review — verify every test subtask against actual test code before marking done.
- All backend tests run **in-container** (host pytest can't reach `postgres:5432`); rebuild the api image first (it bakes source). OpenAPI regen runs on the **host venv** (`AUTH_BACKEND=dev .venv/bin/python scripts/export_openapi.py`) because the container has no source mount.
- Gates baseline after 11.1 review: BE 1138 passed (+3 known `test_ingest.py` MinIO failures), ruff clean, api-spec.json current. FE (untouched this story) baseline: typecheck 0, lint 1 pre-existing `Icon.tsx` warning, vitest 595.

### Git Intelligence Summary

velara-api HEAD is `007e50d` ("fix(skills): Story 11.1 code review — bundle_key org validation + extraction hardening"). Commit convention: `feat(<area>): Story <id> — <short title> (Epic <n>)`. This story lands as **one velara-api commit**, e.g. `feat(skills): Story 11.2 — standardized entrypoint contract + bundle execution (Epic 11)`. **No velara-web commit** (backend-only). The two nested repos are separate from the top-level docs repo — never `git add` across them; cd back to the top-level `velara` for docs commits.

### Sequencing / dependencies

- **Second story of Epic 11** (order: 11.1 ✅ → **11.2** → 11.6 → 11.3 → 11.4 → 11.7 → 11.5). Epic 11 already `in-progress`.
- **Gated by** the AI-Skill-Integration ADR (core-architectural-decisions.md, added 2026-07-06) — read its decision 1 (the contract) and 2 (LLM stays OFF the register path; nothing in 11.2 calls an LLM).
- **Downstream consumers:** 11.3 triggers its propose-flow on `ENTRYPOINT_CONTRACT_VIOLATION` and needs `resolve_entrypoint_module`/AST plumbing to analyze non-conforming bundles — keep `entrypoint_contract.py` import-light and reusable. 11.6's hybrid new-version path re-enters `_process_bundle`, inheriting the check for free. 11.7 (run older version) will pin non-current `SkillVersion`s — Task 4 reads `is_bundle`/`artifact_set` off the *version row it's handed*, which keeps that story compatible.

### Project Structure Notes

- **velara-api only:** NEW `app/services/entrypoint_contract.py`; NEW `tests/unit/services/test_entrypoint_contract.py`; MODIFY `app/services/bundle_extractor.py` (`find_manifest_path` refactor), `app/services/skill_service.py` (`_process_bundle` hook), `app/services/execution_service.py` (`_run_hybrid` bundle branch + pass-through), `app/services/code_driven_executor.py` (Step-2 materialization + `_RUNNER_SCRIPT` sys.path line), `app/workers/execution_tasks.py` (error-code constant); EXTEND `tests/unit/services/test_code_driven_executor.py`, `tests/integration/api/test_skills.py`, `tests/integration/api/test_code_driven_execution.py`.
- No FE files, no migrations, no config, no api-spec diff expected.

### References

- [Source: epics/epic-11-ai-assisted-skill-integration-and-promotion.md#Story-11.2] — story ACs, sequencing, ADR gating.
- [Source: planning-artifacts/architecture/core-architectural-decisions.md#AI-Skill-Integration-Assistant] — the canonical contract, "standardize before you automate", LLM-free register path, seams for 11.2/11.3.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:388] — the bundle-run gap 11.2 MUST close (user decision 2026-07-08); [:214] — the named-kwargs mismatch resolved as "non-conforming by design"; [:207] — venv pre-bake stays deferred (NOT this story).
- [Source: _bmad-output/implementation-artifacts/stories/11-1-multi-file-zip-bundle-upload-and-extraction.md] — bundle storage model, review patches (adversarial posture), test helpers, gates baseline, in-container test recipe.
- [Source: velara-api app/services/code_driven_executor.py:126-205,346-394] — `_RUNNER_SCRIPT`, Step-2 no-op, cwd=bundle_dir, subprocess/threadpool patterns.
- [Source: velara-api app/services/execution_service.py:660-720] — `_run_hybrid` fetch + code-driven dispatch (the bundle branch site); [:429,543] — prompt/code fetch sites (untouched).
- [Source: velara-api app/services/skill_service.py:298-385,489-560,946-1140] — `_compute_bundle_record`, `_write_bundle`, `_process_bundle`, bundle create/version branches.
- [Source: velara-api app/services/bundle_extractor.py] — `_is_path_safe`, `find_manifest`, `InvalidBundleError`, security docstring.
- [Source: velara-api app/services/code_driven_hybrid.py:33-35,74-82,139-228] — `_ENTRYPOINT_RE` (the string check being superseded on the bundle path), manifest parser.
- [Source: velara-api app/models/skill.py:181-208] — `artifact_key`/`artifact_checksum`/`artifact_set`/`is_bundle` semantics.
- [Source: velara-api tests/unit/services/test_adapter_shim.py] — the 5.5.6 hand-written adapter this story's contract standardizes away.
- [Source: velara-api tests/integration/api/test_code_driven_execution.py] — E2E harness (editable-install mechanism the bundle path replaces for bundle skills).
- [Source: project memory — Client Skill Contract (real extractor's named-kwargs entrypoint); Epic 8 Story 8.4 review (rebuild api image); Pre-existing CI Failures Fixed (3 MinIO failures); Story 12.1 Review (nested-repo cwd discipline)].

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- One iteration bug during test authoring: the initial materialization unit test asserted
  `os.path.isfile(bundle_dir/...)` *after* `run_code_driven_hybrid` returned — but the executor's
  `finally` block already `shutil.rmtree`'s the workspace by then, so the assertion always failed
  on an already-deleted path. Fixed by snapshotting the bundle_dir file listing from inside the
  fake `_run_subprocess_capture` (before teardown), not after the call returns.
- One pre-existing-test regression bug: `_make_skill()` in `test_execution_service.py` builds
  `ver = MagicMock()` for the skill's current version; an unset `MagicMock` attribute is truthy,
  so the new `if current_ver.is_bundle:` branch in `_run_hybrid` was incorrectly taken for every
  existing hybrid-runtime test. Fixed by pinning `ver.is_bundle = False` on the shared fixture.

### Completion Notes List

- Implemented both mandatory halves in one story: (1) AC1/AC3/AC4 — static
  callable-signature validation of a ZIP bundle's declared entrypoint against
  the canonical `run(input_path, output_dir, params)` contract, enforced at
  registration only (never at the inline manifest-only path); (2) AC2 — the
  code_driven_executor Step-2 no-op is replaced with real bundle materialization
  (sha256-verified, `_is_path_safe` re-checked, written under `workspace/bundle/`),
  closing the 11.1-review deferral so a bundle skill now runs E2E instead of
  dying with botocore NoSuchKey.
- `resolve_entrypoint_module` is the single shared package-root resolver used by
  both the registration validator (Task 2/3) and the executor (Task 5) —
  registration/run symmetry is structurally guaranteed by construction, not by
  convention alone.
- `ENTRYPOINT_CONTRACT_VIOLATION` registered as a new stable 422 error code,
  kept fully distinct from `INVALID_BUNDLE` and `INVALID_CODE_DRIVEN_MANIFEST`
  per the story's load-bearing requirement for Story 11.3.
- Existing `_BUNDLE_MEMBERS` integration-test fixture in `test_skills.py` used a
  `def run(params)` entrypoint that is non-conforming under the new contract;
  updated it to the canonical `run(input_path, output_dir, params)` shape so the
  ~10 pre-existing bundle tests unrelated to entrypoint-contract behavior
  continue to exercise their own concerns (INVALID_BUNDLE, HYBRID_SHAPE_MISMATCH,
  etc.) without incidentally tripping the new AC1 check.
- `bundle_dir` is normalized with `os.path.normpath` after joining
  `bundle_root + package_root` — `resolve_entrypoint_module` can return a root
  with a trailing slash (e.g. `"myskill/"`), which without normalization would
  leave a trailing-slash cwd; harmless for `subprocess.run(cwd=...)` but
  normalized for cleanliness and stable test assertions.
- Gates: `ruff check .` clean repo-wide; full in-container suite 1178 passed / 3
  failed (the 3 pre-existing `test_ingest.py` MinIO-in-container failures —
  unchanged from the documented baseline, unrelated to this story); host
  `export_openapi.py` produced **zero diff** in `docs/api-spec.json` (confirms
  no endpoint/schema surface changed, as scoped). No migration, no FE changes,
  no new config were introduced.

### File List

- `velara-api/app/services/entrypoint_contract.py` (NEW)
- `velara-api/app/services/bundle_extractor.py` (MODIFIED — extracted `find_manifest_path`)
- `velara-api/app/services/skill_service.py` (MODIFIED — `_process_bundle` hook)
- `velara-api/app/services/execution_service.py` (MODIFIED — `_run_hybrid` bundle branch + `_run_code_driven_hybrid` pass-through)
- `velara-api/app/services/code_driven_executor.py` (MODIFIED — Step-2 materialization + `_RUNNER_SCRIPT` sys.path line)
- `velara-api/app/workers/execution_tasks.py` (MODIFIED — new error-code constant)
- `velara-api/tests/unit/services/test_entrypoint_contract.py` (NEW)
- `velara-api/tests/unit/services/test_bundle_extractor.py` (MODIFIED — `find_manifest_path` parity tests)
- `velara-api/tests/unit/services/test_code_driven_executor.py` (MODIFIED — bundle materialization tests)
- `velara-api/tests/unit/services/test_execution_service.py` (MODIFIED — pinned `ver.is_bundle = False` on the shared skill fixture)
- `velara-api/tests/integration/api/test_skills.py` (MODIFIED — entrypoint-contract integration tests + conforming `_BUNDLE_MEMBERS` fixture)
- `velara-api/tests/integration/api/test_code_driven_execution.py` (MODIFIED — bundle-skill E2E closure test)
