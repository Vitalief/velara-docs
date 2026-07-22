---
baseline_commit: 6024f2f (velara-api)
---

# Story 15.6: Verify a Declared `reports_usage` Is Actually Honored (Static Check + Assist Re-Routing)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want the platform to verify at registration time that a code-driven hybrid skill declaring `reports_usage: true` actually returns a `usage` key,
so that a silently-broken declaration can never register clean and run forever priced NULL, the way `velara-protocol-extractor` v2.1.0 did.

**Why this is a real defect, not a nice-to-have (found live, 2026-07-21/22, same night as 15.5's code review):** Story 15.5 built the `reports_usage: bool` manifest declaration and a registration-time gate that catches an OMITTED declaration (routes to AI-assist). It also added an execution-time `code_driven_usage_contract_violation` warning log for a skill that declares `true` but returns no usable `usage`. Both mechanisms worked exactly as designed — and the gap between them still let a real skill run priced NULL in production:

`velara-protocol-extractor` v2.1.0 declared `reports_usage: true` (honestly — the skill genuinely makes 8 LLM calls per run and self-reports `input_tokens`/`output_tokens`/`model` inside its own `canonical.metadata`). Its registered adapter (`velara_adapter.py`, produced by the Epic 14 AI integration assistant) forwarded the client function's return value **unchanged** — it never lifted that self-reported usage into the envelope's reserved `usage` field. Registration succeeded (the manifest declared the boolean correctly — 15.5's gate has nothing further to check). Every execution correctly logged `code_driven_usage_contract_violation` — a warning line in a Celery worker's CloudWatch stream nobody was watching — and correctly priced NULL rather than fabricating a number. The operator only discovered it because they were manually watching cost figures after an unrelated worker-staleness incident and noticed a "—" that should have been a dollar amount.

**Re-registering with AI-assist did not fix it either.** A live test of `propose_adapter` (same session, same night) against this exact skill failed twice to produce an adapter that lifts usage into the envelope — the adapter-authoring LLM call is a *generative* task (write code that notices a specific nested field and forwards it) and proved unreliable at it on the model available. The eventual fix was a hand-written, deterministic 5-line patch — not something this story should require repeating per-skill going forward.

**The gap, precisely:** nothing at REGISTRATION time checks whether a `reports_usage: true` skill's own code path actually constructs a `usage` key. The execution-time check (15.5) is real but too late and too quiet — it fires after the skill is already live and serving real jobs, and only a human reading worker logs would ever see it. This story moves the check earlier (registration) and makes it load-bearing (blocks a broken registration, same as every other entrypoint-contract check), using the SAME static-analysis, never-import/exec posture `entrypoint_contract.py` already established for Story 11.2.

## Acceptance Criteria

1. **AC1 — A registration-time static check detects whether a `reports_usage: true` code-driven hybrid's entrypoint plausibly returns a `usage` key.**
   New function (e.g. `app/services/usage_contract.py: detect_reports_usage_without_emission`) that, given the bundle's files and the resolved entrypoint AST node (reuse `entrypoint_contract.resolve_entrypoint_module` + the existing top-level-binding walk — do not re-implement bundle/package-root resolution), walks the function body's `return` statements looking for a `usage` key in a returned dict literal (`ast.Dict` with a string key `"usage"`, or a `**spread` of a variable that was itself built as a dict literal containing `"usage"` earlier in the same function — first cut, most permissive reasonable match, documented limitations per the `entrypoint_contract.py` precedent). Never imports or executes the untrusted module — `ast.walk`/`ast.NodeVisitor` only, mirroring `validate_entrypoint_contract`'s existing posture.

2. **AC2 — `reports_usage: true` + no statically-detectable `usage` key is a registration-time synthesizable gap, not a silent pass.**
   Wire the new check into the SAME registration flow 15.5's `_manifest_missing_synthesizable_field` already gates: when a manifest declares `reports_usage: true` AND the static check from AC1 finds no `usage` key in the entrypoint's return, treat it as a synthesizable-gap manifest (same `MalformedBundleManifestError` → `propose_adapter` route as an omitted declaration). No new error code — this is the SAME `MALFORMED_BUNDLE_MANIFEST` signal, now covering "declared but unimplemented" alongside "declared" being missing entirely. `reports_usage: false` skips this check entirely (an honest no-LLM skill has nothing to verify). Bundle-registration path only (mirrors 15.5's own scope note — inline authoring gets AC2's check treated as a hard 422 like 15.5's `_require_inline_reports_usage_declaration`, not an assist route, since inline has no staged bundle to adapt).

3. **AC3 — A false negative (static check says "no usage key" but the code is too dynamic to analyze) fails OPEN to registration, never blocks a genuinely-conforming skill.**
   The AST walk is necessarily incomplete (usage assembled via a helper function call, a comprehension, an indirect return through a variable reassigned across branches, etc. — same class of gap `entrypoint_contract.py`'s own docstring already accepts for signature decorators/conditional defs). When the walk cannot conclusively determine the return shape (rather than conclusively finding no `usage` key), the check must NOT flag a gap — false negatives here mean the execution-time 15.5 log remains the backstop, not a false 422 blocking a valid skill from ever registering. Document this explicitly: AC1's function returns a 3-state result (`usage_detected` / `usage_absent` / `undetermined`), and only `usage_absent` triggers AC2's gap routing.

4. **AC4 — `velara-protocol-extractor` (or an equivalent fixture) demonstrates the check catches the exact bug this story is fixing.**
   A unit test fixture built from the ACTUAL failure shape: an entrypoint that returns a dict literal built from a wrapped client call's result, with no `usage` key anywhere in the returned literal — must resolve to `usage_absent`. A second fixture with the fixed shape (returns a dict literal that includes a `"usage"` key, built the way the hand-patched v2.2.0 adapter does it) must resolve to `usage_detected`.

5. **AC5 — Existing registration behavior for `reports_usage: false` and for a conforming `usage`-emitting skill is unaffected.**
   No new false-positive routing for either case (a `false`-declaring skill, or a `true`-declaring skill whose entrypoint straightforwardly returns a dict literal with `usage`). Existing Story 15.5 tests (`test_reports_usage_true_registers_normally`, `test_reports_usage_false_is_an_honest_declaration_not_a_gap`, and the bundle integration fixtures) continue to pass unmodified — this story extends the gate condition, it does not change 15.5's existing pass/fail outcomes for those cases.

6. **AC6 — Document the residual gap for the record.**
   This story closes the "obviously never returns usage" case (a plain returned-dict-literal, which is the actual shape both the broken and fixed `velara-protocol-extractor` adapters used). It explicitly does NOT attempt LLM-judge analysis of harder-to-statically-resolve cases, and does NOT execute the entrypoint against sample data to verify at runtime — both are real, deferred follow-ups (see Dev Notes) once this cheaper, deterministic layer's false-negative rate is observed in practice.

**Out of scope (do NOT touch):**
- LLM-judge verification of dynamically-constructed `usage` shapes (AC3's `undetermined` case) — deferred; revisit only if the static check's false-negative rate proves material.
- Execution-based verification (actually running the entrypoint/adapter against sample/gold fixtures and inspecting the real envelope) — deferred; a materially higher-confidence but higher-cost follow-up.
- The AI-assist adapter-authoring prompt's reliability at generating usage-lifting code — a separate, already-identified gap (2/2 live failures during 15.5's review); this story does not attempt to fix adapter-authoring quality, only to make an unfixed adapter block registration instead of registering silently.
- `code_driven_executor.py`'s execution-time `code_driven_usage_contract_violation` log (15.5) — stays as the runtime backstop; unchanged.
- The manifest's `reports_usage` field itself, `_manifest_missing_synthesizable_field`'s existing omitted-key check, and the pricing seam (`_extract_cost_fields`/`compute_cost_usd`) — all reused as-is, no changes.
- Any UI surfacing of a detected violation — backend/registration-gate only, matching 15.5's scope.

## Tasks / Subtasks

- [x] **Task 1 — Static return-shape analysis (AC1, AC3) — new `app/services/usage_contract.py`**
  - [x] `detect_reports_usage_without_emission(files, entrypoint) -> Literal["usage_detected", "usage_absent", "undetermined"]`. Reuse `entrypoint_contract.resolve_entrypoint_module` for bundle/package-root resolution; do not duplicate it.
  - [x] Walk the resolved entrypoint's `FunctionDef` body: for each `return` statement, inspect the returned expression. A returned `ast.Dict` literal is checked directly for a string key `"usage"`. A returned `ast.Name` is traced to its last top-level assignment WITHIN the same function body (best-effort, single-hop) before falling back to `undetermined`. Anything else (comprehension, call result, conditional expression, multiple divergent return shapes) → `undetermined`. **Implementation refinement (verified against AC4's real fixtures):** a `Name` traced to a top-level assignment whose RHS is NOT a dict literal (e.g. an opaque call result — the actual v2.1.0 shape) resolves `usage_absent`, not `undetermined` — nothing in the function's visible source ever writes a `usage` key onto it, which is what the walk is asked to determine, not simulate. A `Name` with NO top-level assignment at all (only reassigned across divergent branches, or comprehension-bound) remains `undetermined`. A `name["usage"] = ...` subscript-add is traced independently (including into nested blocks, since it can only ADD a key) and wins regardless of the base assignment's shape — this resolves the v2.2.0 fixed shape correctly.
  - [x] No `usage` key found in ANY resolvable return path (and at least one return was resolvable) → `usage_absent`. A `usage` key found in every resolvable return path → `usage_detected`. Mixed/partial/no resolvable returns → `undetermined`.

- [x] **Task 2 — Wire into registration gate (AC2, AC5) — `app/services/skill_service.py`**
  - [x] In `_process_bundle`, after `validate_entrypoint_contract` succeeds and the manifest declares `reports_usage: true`, call `detect_reports_usage_without_emission`. On `usage_absent`, raise the SAME `MalformedBundleManifestError` 15.5 raises for an omitted declaration (no new error code).
  - [x] `usage_detected` and `undetermined` both register normally (AC3 — fail open). `reports_usage: false` skips the call entirely.
  - [x] Inline authoring path (`_require_inline_reports_usage_declaration`'s call sites): documented as an intentional, unavoidable scope gap rather than wired to raise — the inline path (Story 5.5.1) delivers its code via a requirements-lockfile install at run time, not bundle bytes available to inspect at registration (same posture `entrypoint_contract.py` already documents for this path: "no source to parse at registration"). Running `detect_reports_usage_without_emission` there would always resolve `undetermined` (no `files` to search) — a no-op, not real coverage. The execution-time 15.5 log remains the only backstop for a `reports_usage: true` inline manifest with an unimplemented adapter; documented explicitly in `_require_inline_reports_usage_declaration`'s docstring, not silently skipped.

- [x] **Task 3 — Tests (AC4, AC5)**
  - [x] Fixture entrypoint matching the ACTUAL v2.1.0 broken shape (wraps a client call, returns its result dict unchanged, no `usage` key) → `usage_absent`.
  - [x] Fixture entrypoint matching the hand-patched v2.2.0 shape (constructs `result["usage"] = {...}` before returning `result`) → `usage_detected` (exercises the single-hop `ast.Name`-to-assignment trace, including the subscript-add nested inside an `if` block — the real fixed adapter's actual shape).
  - [x] Fixture with a returned dict literal built inline including `"usage": {...}` directly → `usage_detected`.
  - [x] Fixture with a comprehension/conditional/helper-function-derived return → `undetermined`, and confirm registration proceeds (fail-open, AC3).
  - [x] Registration integration test: `reports_usage: true` + `usage_absent` fixture bundle → `MALFORMED_BUNDLE_MANIFEST` (bundle path, `test_process_bundle_rejects_v210_broken_shape_reports_usage_true`). Inline path has no static check to integration-test (see Task 2 note) — covered instead by the existing `_require_inline_reports_usage_declaration` declaration-gate tests, unmodified.
  - [x] Regression: existing 15.5 tests for `reports_usage: true`/`false` registration continue to pass unmodified. Blast-radius fix: several PRE-EXISTING shared bundle fixtures (`_MANIFEST_NO_REQS`/`_CONFORMING_PLUGIN` in `test_skill_service_bundle.py`; `_CODE_DRIVEN_MANIFEST`/`_BUNDLE_MEMBERS` and 3 AI-adapted-flow fixtures in `test_skills.py`) declared `reports_usage: True` incidentally (to satisfy 15.5's declaration gate) while pairing it with a plugin/adapter that never emits `usage` — now correctly caught by this story's new gate. Since none of those tests assert usage-emission behavior, fixed by declaring an honest `reports_usage: False` on those specific fixtures (mirrors the precedent set by 15.5's own blast-radius fix across 34 fixtures) rather than weakening the new check.

- [x] **Task 4 — Gates**
  - [x] Rebuild api + worker before pytest (source is baked, not mounted).
  - [x] Full suite green (1534 passed, 1 pre-existing flake `test_repeated_denials_are_deduped`, 3 skipped); ruff clean; no api-spec diff (internal registration logic only, confirmed via `scripts/export_openapi.py`).

## Dev Notes

### This is a registration-time MOVE of an existing check, not a new invariant

Story 15.5 already established the invariant ("a run that made LLM calls is never free, silently") and the enforcement PATTERN (declared manifest capability → registration-time gate → existing `propose_adapter` route). This story does not invent new architecture — it extends AC1's static-analysis technique (already used by `entrypoint_contract.py` for signature checking) to also look at what the entrypoint RETURNS, and hangs the result on the SAME gate 15.5 built for the declaration check. Read `entrypoint_contract.py`'s module docstring before starting Task 1 — the security posture (never import/exec untrusted code), the package-root resolution convention, and the "known static-analysis limitation" framing all apply identically here and should be extended, not reinvented.

### The exact live bug this fixes

`velara-protocol-extractor` v2.1.0's `velara_adapter.py`:
```python
def run(input_path, output_dir, params):
    ...
    result = client_run(input_path, **kwargs)
    return result
```
No `usage` key anywhere in the function. Manifest declared `reports_usage: true` (honestly — the wrapped `client_run` DOES make LLM calls and self-reports `input_tokens`/`output_tokens`/`model` nested inside its own `canonical.metadata`, just never lifted to the envelope's reserved field). This registered clean under 15.5's gate (which only checks the manifest declares the boolean) and ran silently priced NULL for at least 3 production jobs before discovery. The hand-written fix (now live as v2.2.0) is the `usage_detected` shape Task 3's second fixture should mirror:
```python
    result = client_run(input_path, **kwargs)
    metadata = (result or {}).get("canonical", {}).get("metadata") or {}
    if metadata.get("input_tokens") is not None or ...:
        result["usage"] = {"input_tokens": ..., "output_tokens": ..., "model": ...}
    return result
```
Note this is a `usage_absent`-would-need-`undetermined`-tolerance case if analyzed naively (the dict key is added via subscript assignment, not a literal in the `return` statement) — Task 1's single-hop `ast.Name` trace exists specifically to resolve this real shape correctly as `usage_detected`, not to over-fit a toy example.

### Why AI-assist adapter-authoring is explicitly NOT this story's fix

During 15.5's code review (same session), `propose_adapter` was run live against this exact skill twice. Both times, the LLM produced a syntactically valid, signature-conforming adapter that STILL forwarded the client's result unchanged — the same bug, regenerated. Two real bugs in the assist path were found and fixed in that session (the prompt didn't show the LLM the manifest's current `reports_usage` value; the manifest-merge guard could accept a downgraded value from the LLM instead of protecting an established `true`) — but the LLM's ability to reliably author the *specific* code that lifts a nested field into a new top-level key was not fixed, because it is a generative-reliability problem, not a wiring bug. This story does not re-attempt that. It only ensures a skill in this state can no longer register clean and run silently broken — the human approving an AI-assist proposal (or fixing the adapter by hand, as was done live) still owns getting the adapter actually correct; this story just makes sure "correct" is checked before anything goes live, not discovered later via a buried log line.

### Why static-analysis, not execution, for the registration-time check

Same reasoning `entrypoint_contract.py` already documents: the bundle is untrusted, client-supplied code. Running it (even against sample data) at registration time is a materially larger security surface than parsing its AST — and this story's whole point is to make the CHEAP check (declaration presence, 15.5) and the CHEAP-ISH check (return-shape static analysis, this story) both load-bearing before reaching for the EXPENSIVE check (real execution) as a later, opt-in escalation.

### References

- [Source: _bmad-output/implementation-artifacts/stories/15-5-capture-code-driven-hybrid-sandbox-llm-usage.md] — parent story; this story closes the registration-time verification gap its own code review discovered live in production the same night.
- [Source: velara-api/app/services/entrypoint_contract.py] — the static-analysis pattern and security posture (never import/exec untrusted code) this story extends to return-shape checking.
- [Source: velara-api/app/services/code_driven_executor.py] — the `code_driven_usage_contract_violation` execution-time log (15.5); stays as the runtime backstop, unchanged by this story.
- [Source: velara-api/app/services/skill_service.py#_manifest_missing_synthesizable_field] — the existing registration gate this story's AC2 extends (same `MalformedBundleManifestError` signal, new triggering condition).
- [Source: velara-api/app/services/skill_integration_assistant.py] — `propose_adapter`; reused as-is for the routing destination, NOT modified by this story (its adapter-authoring reliability is a separate, already-flagged gap).
- Live incident, 2026-07-21/22: `velara-protocol-extractor` skill_id `6c9f68a8-98cc-4c57-9b86-71a32eb688f3`, v2.1.0 (broken adapter) → v2.2.0 (hand-patched fix, current). Jobs `49ea9ab2`/`d51b2d35` ran priced NULL/$0 before the fix; `607a0c20` manually backfilled to $1.402670 from self-reported metadata (one-off, not a policy change — see [[project-llm-pricing-table]]'s NO-backfill rule). Job `7b4f8ba6` (post-fix, v2.2.0) priced correctly: $1.505080.

## Dev Agent Record

### Implementation Plan

- **Task 1**: New `app/services/usage_contract.py`, mirroring `entrypoint_contract.py`'s security posture (`ast.parse` + walk only, never import/exec). `detect_reports_usage_without_emission` resolves the entrypoint via the existing `resolve_entrypoint_module`, locates the callable's last top-level binding (same "last binding wins" convention as `validate_entrypoint_contract`), then classifies every `return` statement in the function. Classification handles: a returned dict literal (checked directly for a `"usage"` key); a returned `Name` traced to its last top-level assignment (a dict literal resolves directly; any other RHS — an opaque call, the actual `velara-protocol-extractor` v2.1.0 shape — resolves `usage_absent`, since nothing in the visible source adds the key); a `name["usage"] = ...` subscript-add anywhere in the function (including nested inside `if`/`for`/`try` blocks, since a subscript-add can only ADD a key and never risks a false positive) checked independently and taking precedence; anything else (comprehension, direct call/conditional-expression return, no top-level assignment at all) resolves `undetermined`. A `_walk_same_scope` helper stops the subscript-add scan at nested `def`/`lambda` boundaries so a nested function's own locals are never mistaken for the outer function's variable.
- **Task 2**: Wired into `_process_bundle` immediately after `validate_entrypoint_contract` succeeds — only inspects entrypoints already known to conform to the call signature. `reports_usage: true` + `usage_absent` raises the same `MalformedBundleManifestError` 15.5 raises for an omitted declaration (no new error code, same `propose_adapter` route). `usage_detected`/`undetermined` register normally; `reports_usage: false` skips the call. The inline authoring path (`_require_inline_reports_usage_declaration`) is NOT wired to this check — inline has no bundle `files` to statically analyze (the code arrives via a lockfile install at run time, same gap `entrypoint_contract.py` already documents for this path) — documented explicitly in that function's docstring as an intentional, unavoidable scope boundary rather than silently skipped.
- **Task 3**: Unit tests (`test_usage_contract.py`, 17 cases) cover AC1/AC3's classification directly, including the exact v2.1.0/v2.2.0 shapes (AC4), nested-scope isolation, and every fail-open path (comprehension, conditional expression, divergent branches, unresolvable module/callable). Integration-level tests (`test_skill_service_bundle.py`) exercise the full `_process_bundle` gate end-to-end against the real v2.1.0/v2.2.0 adapter source. Regression fix: several pre-existing shared test fixtures (both files, plus `test_skills.py`) declared `reports_usage: True` to satisfy 15.5's declaration gate while pairing it with a plugin/adapter that never emits `usage` — now correctly caught by the new gate. Since none of those tests assert usage-emission behavior, fixed by declaring an honest `reports_usage: False` (same pattern 15.5 itself used across its own 34-fixture blast radius), not by weakening the check.
- **Task 4**: Rebuilt `api`+`worker` images (source is baked, not mounted), ran the full suite inside the container with `AUTH_BACKEND=dev` (the container's default `.env` `AUTH_BACKEND=cognito` breaks all dev-auth integration tests — an environment-invocation detail, not a code issue), ran `ruff check .`, and regenerated `docs/api-spec.json` via `scripts/export_openapi.py` (must run with `PYTHONPATH=/app` inside the container; the image bakes docs, not mounts them, so the fresh copy must be `docker cp`'d out to diff against the committed one).

### Completion Notes

- All 4 tasks complete, all ACs met. `usage_contract.py` implements the 3-state (`usage_detected`/`usage_absent`/`undetermined`) static check exactly as AC1/AC3 specify, verified against both the actual live-incident broken shape and the hand-patched fixed shape (AC4).
- Full suite: 1534 passed, 1 pre-existing flake (`test_repeated_denials_are_deduped`, documented in prior story memory as re-run-sensitive against the append-only `velara_test` DB — unrelated to this story), 3 skipped. Ruff clean. No `api-spec.json` diff (internal registration logic only, no route/schema changes).
- Scope note carried into the story record: the inline authoring path cannot run AC1's check at all (no bundle source at registration) — this is a real, deliberately-accepted residual gap for that path specifically, distinct from AC6's already-documented deferred-work items (LLM-judge analysis, execution-based verification). The execution-time 15.5 log remains the only backstop for an inline `reports_usage: true` manifest with an unimplemented adapter.
- Not committed to velara-api (subrepo) — per project convention, dev-story does not commit/push the velara-api subrepo; only this top-level docs repo is committed here.

## File List

- `velara-api/app/services/usage_contract.py` (new) — AC1/AC3 static return-shape classifier.
- `velara-api/app/services/skill_service.py` (modified) — AC2 registration-gate wiring in `_process_bundle`; docstring updates on `_process_bundle` and `_require_inline_reports_usage_declaration`.
- `velara-api/tests/unit/services/test_usage_contract.py` (new) — AC1/AC3/AC4 unit tests for `detect_reports_usage_without_emission`.
- `velara-api/tests/unit/services/test_skill_service_bundle.py` (modified) — AC4/AC5 `_process_bundle` integration tests for the v2.1.0/v2.2.0 shapes; `_MANIFEST_NO_REQS` fixture `reports_usage` corrected to `False` (regression fix, unrelated to what those tests assert).
- `velara-api/tests/integration/api/test_skills.py` (modified) — `_CODE_DRIVEN_MANIFEST` and 3 AI-adapted-flow fixtures' `reports_usage` corrected to `False` (regression fix — these fixtures pair with plugins/adapters that never emit `usage` and are not testing usage-emission behavior).

## Change Log

- 2026-07-22 — Drafted Story 15.6 after a live production incident the same night as 15.5's code review: `velara-protocol-extractor` declared `reports_usage: true` honestly but its adapter never emitted the envelope `usage` field, registered clean under 15.5's gate (which only checks the DECLARATION, not whether it's honored), and ran priced NULL for at least 3 jobs before a human noticed via manual cost inspection. Live re-test of AI-assist (`propose_adapter`) failed twice to auto-fix the adapter; fixed by hand instead (v2.2.0, verified pricing correctly on job `7b4f8ba6`). This story moves verification to registration time via static AST analysis of the entrypoint's return shape (same never-import/exec posture as `entrypoint_contract.py`), fails open on ambiguous code (no false-positive 422s), and routes a detected `usage_absent` case through the SAME assist flow 15.5 already built — no new error code, no execution of untrusted code. Status: ready-for-dev.
- 2026-07-22 — Implemented: new `usage_contract.py` (3-state static AST classifier, AC1/AC3), wired into `_process_bundle`'s registration gate after `validate_entrypoint_contract` succeeds (AC2), verified against both the real v2.1.0 broken shape and v2.2.0 fixed shape (AC4). Inline authoring path documented as an intentional scope gap (no bundle source to analyze at registration), not wired. Fixed a blast-radius regression across pre-existing 15.5 fixtures that incidentally paired `reports_usage: true` with a non-usage-emitting plugin. Gates: full suite 1534 passed / 1 pre-existing flake / 3 skipped; ruff clean; no api-spec diff. Not committed to velara-api (subrepo). Status: review.
