---
baseline_commit: f92389f (Story 17.1 code-review commit — "feat(observability): LangSmith tracing for platform LLM calls")
baseline_commit_note: velara-api head has Story 17.1 (platform tracing, `app/core/tracing.py`) and
  17.3 (certification dry-run gate) both `done`. This is the THIRD Epic 17 story, and the one that
  depends on 17.1's conventions ("do not start 17.2 until 17.1 settled" — sprint-status note). Zero
  file overlap with 17.3. `langsmith==0.10.10` is ALREADY a dependency (17.1 added it) — this story
  adds NO new dependency to `pyproject.toml`.
---

# Story 17.2: AI Adapter Emits LangSmith-Traced Skill Bundles

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want the LLM calls a code-driven hybrid skill bundle makes inside its sandbox to be individually
traced in LangSmith too — not just the platform's own calls,
so that I can inspect and cost in-bundle LLM calls the same way Story 17.1 already lets me inspect
the platform's calls, without widening what a sandboxed bundle can reach.

## ⚠️ SCOPE AND THE CENTRAL DESIGN DECISION — read this first

**Backend only (`velara-api`). No frontend, no new API surface, no migration, no new dependency.**

**This story's epic-level AC1 text ("a provided tracing wrapper the sandbox exposes") describes one
possible mechanism, not a mandate — investigation for this story found that mechanism does not exist
and is the WRONG one to build.** Read this section before writing any code.

### What actually exists today (verified against source, not assumed)

A code-driven hybrid's entrypoint runs as a **subprocess inside a per-skill venv**
(`code_driven_executor.py:341-380`), invoked via a tiny generated `runner.py`
(`code_driven_executor.py:176-184`). The subprocess environment is built from a **literal allowlist**,
never `os.environ` splat (`code_driven_executor.py:414-449`):

```python
injected_env: dict[str, str] = {
    "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    "HOME": workspace,
    **creds,                      # the skill's own declared `requires` creds
    "ANTHROPIC_API_KEY": api_key, # the platform's key, injected explicitly
}
```

**No Velara SDK, tracing wrapper, or `langsmith` module is placed on the venv's `sys.path` or in
`injected_env` today.** A code-driven hybrid that wants to call an LLM must already `pip install
anthropic` via its own `requirements.txt` and read `ANTHROPIC_API_KEY` from the process env directly
— there is no platform-provided calling wrapper of any kind for in-bundle LLM calls. This is a
**pre-existing fact**, not something 17.1 removed.

Separately, and just as important: a code-driven hybrid is **already contractually required** to
self-report its LLM usage back to the platform. `CodeDrivenHybridManifest.reports_usage: bool = false`
(`code_driven_hybrid.py:96`) declares intent; `CodeDrivenResultEnvelope.usage: CodeDrivenUsage | None`
(`code_driven_executor.py:126-152`) carries the actual report — `{input_tokens, output_tokens, model}`
— back through the same sentinel-delimited stdout envelope every code-driven hybrid already emits
(Story 15.5). `code_driven_executor.py:764-771` reads `envelope.usage` and threads it into
`result_metadata`, which `execution_tasks._extract_token_metadata` (`execution_tasks.py:108-117`)
later prices via `compute_cost_usd`. **This reporting path is proven, already-adapted-into by the
AI adapter's existing prompts (see below), and runs in the WORKER PROCESS — which has full access to
`app.core.tracing`, `app.core.config.settings`, and the `langsmith` SDK — not inside the sandbox.**

The AI adapter's authoring prompts (`skill_integration_assistant.py:209-274` `_SYSTEM_PROMPT`,
`:276-343` `_SYNTHESIS_SYSTEM_PROMPT`) **already instruct the LLM to lift usage into the adapter's
returned `usage` key** ("LLM usage reporting" hard rule, both prompts) — this is the exact mechanism
17.2 needs, already half-built for a different reason (pricing, not tracing).

### The decision this story makes (do not silently pick a different one — this IS the design)

**Emit the LangSmith span for a code-driven hybrid's in-bundle LLM call(s) from the WORKER PROCESS,
in `code_driven_executor.py`, immediately after the result envelope is parsed and validated — using
the SAME `envelope.usage` data the pricing seam already consumes — rather than injecting
`LANGSMITH_API_KEY`/`langsmith` into the sandboxed subprocess.**

This satisfies every epic-level AC better than a sandbox-side wrapper would:
- **AC1 ("adapter authors traced calls"):** the adapter's authoring output already MUST emit `usage`
  (existing hard rule) — this story extends the *worker's* handling of that self-reported `usage` to
  also emit a trace, so "the adapter's authored bundle causes a trace to happen" is satisfied without
  the adapter's generated code ever touching `langsmith` itself. The bundle-authoring prompt text is
  amended only to make the pre-existing contract's tracing consequence explicit to the LLM author (see
  Task 1) — the mechanical change is almost entirely in `code_driven_executor.py`, not the adapter.
- **AC3 ("does not widen the sandbox's egress/security surface"):** zero new credentials cross into
  the subprocess env allowlist, zero new packages are required in a bundle's `requirements.txt`, zero
  new imports happen inside the sandbox. The sandbox's surface is **byte-for-byte unchanged**. (Network
  egress itself is already fully open for code-driven hybrids per `code_driven_executor.py:14-15` — "no
  socket block, enforcement deferred to Epic 7" — so there was no egress allowlist to widen either way;
  the concrete surface this AC protects is the env-var injection allowlist, and this design touches it
  not at all.)
- **AC2 ("existing-bundle strategy"):** because the trace is emitted from data the pricing seam already
  requires (`reports_usage`/`usage`), **every already-adapted bundle that already declares
  `reports_usage: true` and reports `usage` gets tracing retroactively, for free, with zero re-adapt**
  — this story's AC2 decision (Task 4) is "trace-forward AND retroactive for any bundle already meeting
  the 15.5 usage contract; no re-adapt campaign needed," which is a stronger outcome than 14.2's
  precedent (14.2's upgrade path is a human-triggered re-propose per skill) because this mechanism does
  not require the bundle's code to change at all.
- **AC4 ("no change to bundle decision logic"):** the adapter's proposal/reject logic
  (`propose_adapter`, `RejectNonGrantor`) is untouched; only the prompt's usage-reporting rule gains an
  explanatory clause (Task 1) and `code_driven_executor.py` gains a span emission (Task 2).

**Reject-and-name-why (per 14.2's own precedent of documenting a rejected design, AC4 of that story):**
a sandbox-side wrapper (inject `LANGSMITH_API_KEY` + a Velara tracing helper module into the venv,
require bundle code to import and call it) was considered and rejected — it would require every
code-driven hybrid to add a new runtime dependency, would put a Vitalief-internal credential inside
untrusted third-party bundle code for the first time ever, and cannot be done retroactively for
already-adapted bundles without a re-adapt campaign. The worker-side design has none of these costs
and reuses a already-shipped, already-tested data path.

## Acceptance Criteria

1. **AC1 — A LangSmith span is emitted for every code-driven hybrid run that reports usage.**
   `run_code_driven_hybrid` (`code_driven_executor.py`) emits one LangSmith span per completed run,
   immediately after `envelope.usage` is parsed (alongside the existing `result_metadata` usage-lift at
   `:764-771`), via the Story 17.1 wrapper `app.core.tracing.trace_llm_call` semantics — carrying
   `model`, `input_tokens`, `output_tokens`, and **computed cost** via the SAME
   `app.core.pricing.compute_cost_usd` Epic 15/17.1 use (never a second pricing source; `None` for an
   unrecognized model, never fabricated `$0`). The span is tagged `call_site="code_driven_hybrid"` (a
   NEW `call_site` value, additive — 17.1's two existing values `"complete"`/`"create_message"` are
   untouched) and carries `run_kind="execution"` (code-driven hybrids execute skills; they are never an
   adapter-propose call — do not wrap this in `traced_run_kind("adaptation")`). Latency is measured for
   the WHOLE sandboxed entrypoint run (subprocess start → exit, the existing `duration_ms` already
   computed at `code_driven_executor.py:~730-740` — reuse it, do not remeasure), since the platform
   cannot see the in-sandbox call's own latency in isolation. A run emits **no span at all** when
   `envelope.usage is None` (no report, or the skill made no LLM calls) OR when
   `envelope.usage.model is None` (a PARTIAL report — `CodeDrivenUsage`'s three fields are each
   independently optional, `code_driven_executor.py:~102-117` — token counts with no model id cannot be
   priced or attributed to a span any more than they can be priced for `result_metadata` today). This
   second case is not hypothetical: it is the exact condition the existing
   `code_driven_usage_contract_violation` warning (`code_driven_executor.py:777-786`) already logs.
   Reusing 17.1's `_emit_span` verbatim (Task 2) gives you this behavior for free — its own guard is
   `if span.model is None: return` — so pass `envelope.usage.model` straight through as the span's
   `model` field (rather than gating span emission on `envelope.usage is not None` alone).

2. **AC2 — Existing-bundle strategy is retroactive-by-construction; no re-adapt campaign.** Documented
   here (per epic AC2's requirement to decide-and-document, not silently pick): because this story's
   mechanism reads the SAME `envelope.usage` self-report the 15.5 pricing seam already requires, **any
   bundle already declaring `reports_usage: true` and populating `usage` gets LangSmith tracing on its
   very next run with zero code changes, zero re-adapt, zero re-upload.** A bundle that does NOT declare
   `reports_usage` or does not populate `usage` (legacy/non-conforming) continues to run exactly as
   before — untraced, cost NULL, unchanged — exactly as it is untraced-for-pricing today. There is no
   migration/backfill: this is forward-tracing for every future run of every already-usage-reporting
   bundle, starting the moment this story ships. The AI adapter's authoring prompts (Task 1) are updated
   so newly-authored/upgraded bundles' generated adapters make the `usage` contract's tracing
   consequence explicit in-prompt — but this is a documentation/clarity change to prompt text, not a
   functional prerequisite for tracing to occur (tracing works for any bundle meeting the EXISTING
   `usage` contract, adapted before or after this story).

3. **AC3 — Sandbox boundary and safe-by-default are preserved; zero surface widening.** No new
   credential, module, or import is added to the sandboxed subprocess's `injected_env`
   (`code_driven_executor.py:441-449`) or its venv's installed packages. The `langsmith` SDK import and
   the `LANGSMITH_API_KEY`/`LANGSMITH_TRACING`/`LANGSMITH_TRACE_CONTENT` settings stay exactly where
   17.1 put them — read only in the WORKER process via `app.core.config.settings` and
   `app.core.tracing`. With LangSmith unconfigured (17.1's existing no-op gate), code-driven hybrid runs
   behave byte-for-byte as before this story — same as 17.1's AC2, inherited verbatim, not re-implemented.
   **Content (`LANGSMITH_TRACE_CONTENT`) is NEVER attached to a code-driven hybrid span** — a
   code-driven hybrid's actual prompt/response text never leaves the sandbox process at all (only the
   self-reported token counts do), so there is no content to attach even in `dev`; the span is
   metadata-only unconditionally, in every environment. Document this explicitly (Task 2) so a future
   reader does not go looking for a content branch that cannot exist here.

4. **AC4 — No change to bundle decision logic.** `propose_adapter`'s proposal/synthesis logic, the
   `RejectNonGrantor` gate, and the adapter's translated-argument-forwarding behavior are unchanged. The
   only `skill_integration_assistant.py` edit is the prompt-text clarification in Task 1 (explanatory
   comment on the existing usage-reporting rule) — no new manifest field, no new adapter output block,
   no change to the two-fenced-code-block output contract either prompt already specifies.

## Tasks / Subtasks

- [ ] **Task 1 — Adapter prompt clarification (AC2, AC4)**
  - [ ] In `skill_integration_assistant.py`, amend the existing "LLM usage reporting" hard-rule
    paragraph in BOTH `_SYSTEM_PROMPT` (`:230-237`) and `_SYNTHESIS_SYSTEM_PROMPT` (`:311-318`) to add
    one clause after the existing rule explaining WHY it matters beyond pricing: usage reported here now
    ALSO drives LangSmith call-level tracing for the run (Story 17.2), not just Epic 15 cost pricing.
    This is prompt-text only — do NOT change the required `usage` dict shape
    (`{"input_tokens", "output_tokens", "model"}`), the two-fenced-code-block output format, or add any
    new output block. Keep the diff to the smallest textual addition that makes the rule's full
    consequence clear to the authoring LLM; do not restructure either prompt.
  - [ ] Do not touch `propose_adapter`, `_synthesize_manifest`, or the `RejectNonGrantor` gate (AC4).

- [ ] **Task 2 — Emit the span in `code_driven_executor.py` (AC1, AC3)**
  - [ ] Import `app.core.tracing` at the point `run_code_driven_hybrid` already computes
    `result_metadata` and reads `envelope.usage` (`code_driven_executor.py:743-771`). Reuse
    `trace_llm_call`'s SHAPE (no-op gate, lazy import, explicit-client, error-swallow, `_cost_field`
    None-never-0 rendering) — either by calling a small NEW function in `app/core/tracing.py` that wraps
    the same `_emit_span` machinery with `call_site="code_driven_hybrid"`, OR by extending
    `trace_llm_call`'s call sites to accept a pre-computed-usage direct-emit path (dev's choice; do NOT
    duplicate the no-op/lazy-import/error-swallow logic inline in `code_driven_executor.py` — it MUST
    reuse `app.core.tracing`'s existing gate and swallow behavior verbatim, since that is the one place
    those safety properties are implemented and tested).
  - [ ] Emit the span ONLY when `envelope.usage is not None` (AC1's "no span for a non-reporting run"
    rule — mirrors `_emit_span`'s existing `if span.model is None: return`). Pass
    `model=envelope.usage.model`, `input_tokens=envelope.usage.input_tokens`,
    `output_tokens=envelope.usage.output_tokens`, `stop_reason=None` (no stop_reason concept for a
    self-reported code-driven run — the field's absence is expected and correct, not a gap), and
    `latency_ms` from the entrypoint's own already-computed `duration_ms`
    (`code_driven_executor.py`, near `:730-740` — locate and reuse the existing variable, do not
    recompute).
  - [ ] Do NOT attach `content_inputs`/`content_outputs` under any settings value — AC3's "metadata-only
    unconditionally" rule. If the reused emission path accepts a content parameter, always pass
    `None`/omit it for this call site; do not thread `settings.LANGSMITH_TRACE_CONTENT` into this
    call site's content decision at all (there is no content available to gate).
  - [ ] `run_kind` stays at its ambient default (`RUN_KIND_EXECUTION`) — do NOT wrap this call in
    `traced_run_kind("adaptation")` (AC1). **Verified for this story (no further investigation needed):**
    `run_code_driven_hybrid` has exactly two callers, both inside `execution_service._run_hybrid`
    (`execution_service.py:804,829`), reached only via `execute_skill` → the Celery task
    (`execution_tasks.py:346`) — a normal job-execution path with no call edge from
    `skill_integration_assistant.py`. The three `traced_run_kind(RUN_KIND_ADAPTATION)` sites live
    entirely inside `skill_integration_assistant.py`'s `propose_adapter`/`_synthesize_manifest`
    machinery (`:790,882,1090`), a separate module with no path into `execution_service.py`. A
    code-driven hybrid execution can therefore NEVER run inside an ambient `"adaptation"` context —
    `run_kind="execution"` is always correct here, unconditionally.

- [ ] **Task 3 — Verify env/config wiring needs zero changes (AC3)**
  - [ ] Confirm `code_driven_executor.py`'s `injected_env` dict (`:441-449`) is untouched by this story
    — no `LANGSMITH_*` key added. This is a verification task, not an implementation task: if a diff
    review shows any `LANGSMITH_*` value entering `injected_env` or the venv's `requirements.txt`
    install step, that is the WRONG design per this story's scope section — stop and reconsider before
    proceeding.
  - [ ] No new `pyproject.toml` dependency (17.1 already added `langsmith==0.10.10`); no `.env.example`/
    `.env.test`/`terraform/README.md` changes (17.1 already documented all four `LANGSMITH_*` vars —
    this story introduces no new setting).

- [ ] **Task 4 — Tests (AC1–AC4)**
  - [ ] **Span-emission test (AC1).** Extend `tests/unit/services/test_code_driven_executor.py` (existing
    subprocess-mocking conventions — locate how the existing tests fake `subprocess.run`/the venv/the
    envelope): with LangSmith tracing enabled (patch `settings.LANGSMITH_TRACING`/`LANGSMITH_API_KEY`)
    and the `langsmith` `RunTree` (or the reused emission function) mocked, run
    `run_code_driven_hybrid` with a fake envelope carrying `usage={"input_tokens": N, "output_tokens":
    M, "model": "<known-model>"}` and assert a span is emitted with `call_site="code_driven_hybrid"`,
    `run_kind="execution"`, the correct token counts, and cost equal to
    `compute_cost_usd(model, N, M)` — same cost-source assertion pattern as 17.1's
    `test_anthropic_client.py::TestProviderTracing`.
  - [ ] **No-span-when-no-usage test (AC1).** Same setup, envelope with `usage=None` (or a legacy
    non-reporting bundle) — assert NO span is emitted (mock's `post`/emit is never called). This is the
    code-driven-hybrid equivalent of 17.1's `TestFailedCallEmitsNoSpan`.
  - [ ] **No-op-when-untraced test (AC3).** With tracing disabled/unconfigured (mirrors `.env.test`'s
    default), assert `run_code_driven_hybrid` behaves byte-for-byte as before this story (same
    `result_metadata`, no langsmith import triggered) — do not hit the network, do not import
    `langsmith`.
  - [ ] **Metadata-only-always test (AC3).** Even with `LANGSMITH_TRACE_CONTENT=true` (dev), assert the
    code-driven-hybrid span carries no content fields — prove the content branch is genuinely
    unreachable for this call site, not merely untested.
  - [ ] **Error-swallow test (AC1/AC3, inherited from 17.1).** If the reused emission path can raise
    (network/SDK failure), assert `run_code_driven_hybrid`'s return value and behavior are unaffected —
    a trace failure must never fail a skill execution, same guarantee 17.1 already proved for platform
    calls.
  - [ ] **Prompt-text test, if one exists for prompt content.** Check whether
    `test_skill_integration_assistant.py` has any existing assertion on `_SYSTEM_PROMPT`/
    `_SYNTHESIS_SYSTEM_PROMPT` literal content (e.g. asserting the usage-reporting rule text is present)
    — if so, update it to tolerate/reflect Task 1's addition; do not add a new prompt-snapshot test if
    none of that style exists today (match existing test density, do not invent a new pattern here).

- [ ] **Task 5 — Gates (Enforcement Rule 10)**
  - [ ] `ruff check .` clean (line-length 100, `select=["E","F","I","B","UP","W"]`).
  - [ ] `pytest` — full suite green against a fresh `velara_test` DB, using the CI-equivalent env
    (`sh -c 'cd /app && set -a && . ./.env.test && set +a && pytest'` inside the docker `api` container
    — see the `project-velara-api-container-test-env` note in Dev Notes; a bare `pytest`/`docker compose
    exec api pytest` gives false 401s because the running container's `.env` has `AUTH_BACKEND=cognito`).
  - [ ] `python scripts/export_openapi.py && git diff --exit-code docs/api-spec.json` — must be a no-op
    (this story adds no route). **Before trusting this diff, check `deferred-work.md` for any
    outstanding pre-17.1/17.3 OpenAPI drift** — 17.1's Dev Agent Record logged that 17.3's spec was
    never regenerated after its own code-review; if that is STILL unresolved when this story starts,
    the diff will show 17.3's routes, not this story's (verified: this story adds none). Do not
    "fix" an unrelated pre-existing drift as a drive-by in this story — flag it in Dev Notes instead if
    still present.
  - [ ] Do NOT commit `velara-api` from this story (never-push-subrepos rule) — only `code-review`
    commits subrepos, post-review. Only the top-level docs repo is committed by `dev-story`.

## Dev Notes

### Why this is a worker-process change, not a sandbox change

The single most important fact this story rests on: **the sandbox subprocess has no access to
`app.core.tracing`, `app.core.config.settings`, or any platform Python module** — it runs in an
isolated per-skill venv with only the bundle's own installed packages and the literal `injected_env`
allowlist (`code_driven_executor.py:414-449`). Meanwhile `run_code_driven_hybrid` itself — the function
that SPAWNS that subprocess and then PARSES its stdout envelope — runs in the Celery worker process,
which has full platform context. The self-reported `usage` field crosses the sandbox boundary via the
existing stdout-envelope contract (Story 15.5) specifically so the platform (not the sandbox) can act
on it — first for pricing, now also for tracing. Emitting the span in the worker, from the parsed
envelope, is not a workaround; it is the same architecture the pricing seam already uses, extended by
one more consumer of the same data.

### What NOT to build (see Story Scope section above for full reasoning)

Do not inject `LANGSMITH_API_KEY` or any tracing helper module into `injected_env` or the sandbox venv.
Do not require bundle `requirements.txt` to add `langsmith`. Do not modify the adapter's OUTPUT FORMAT
(the two-fenced-code-block contract, or the `usage` dict shape) — Task 1's prompt change is explanatory
text only, appended to an existing rule paragraph.

### Reuse map (do NOT rebuild)

- **`app.core.tracing`** (Story 17.1, `app/core/tracing.py`) — the no-op gate (`_tracing_enabled`), lazy
  `langsmith` import, explicit `Client(api_key=...)` construction (`_get_ls_client` — critical: do NOT
  let a new emission path construct its own default `RunTree` with no client, the exact bug 17.1's
  code-review caught and fixed), `_cost_field` (None-never-0), and the error-swallow `try/except`
  pattern in `_emit_span`. Reuse this machinery; do not reimplement any of it for the new call site.
- **`app.core.pricing.compute_cost_usd(model=, input_tokens=, output_tokens=)`** (`pricing.py:68-92`) —
  the ONE cost source, already reused by 17.1 and by `execution_tasks._extract_token_metadata`.
- **`CodeDrivenUsage`/`CodeDrivenResultEnvelope.usage`** (`code_driven_executor.py:103-152`, Story 15.5)
  — the self-reported usage contract this story's span reuses verbatim; do not add a parallel reporting
  mechanism.
- **`envelope.usage` → `result_metadata` lift** (`code_driven_executor.py:764-771`) — the exact point in
  the function where usage becomes available; add the span emission adjacent to this existing block, not
  in a new location.

### Testing standards

- Backend: pytest (`asyncio_mode="auto"`), co-located `tests/unit/...` mirroring `app/...`. Extend
  `tests/unit/services/test_code_driven_executor.py` (existing file, Story 15.5's tests already mock the
  subprocess/envelope machinery) rather than creating a new test file — this is an extension of an
  already-tested function, not a new module.
- Mirror 17.1's test naming/structure precedent (`TestProviderTracing`, `TestFailedCallEmitsNoSpan`,
  `TestExplicitLangSmithClient` in `test_anthropic_client.py` / `test_tracing.py`) for the new
  code-driven-hybrid span tests — do not invent a divergent test-organization style.
- **Container test-env trap (from 17.1's Dev Agent Record, still applicable):** the running `api` docker
  container's `.env` has `AUTH_BACKEND=cognito`; a bare `pytest` inside it gives ~600+ false 401s. Use
  `set -a; . ./.env.test; set +a; pytest` to override with test settings (`AUTH_BACKEND=dev`, all
  `LANGSMITH_*` off). Recreate `velara_test` DB clean before trusting a full-suite run if any no-time-
  window/count-based test looks suspicious (a polluted shared DB has caused false failures before).
- Enforcement Rule 10: CI must be green (`ruff check .` + full `pytest` in the CI-equivalent env, plus
  the OpenAPI no-op check) before any push to `development` — a "gates green" note in Dev Agent Record
  is not a substitute for actually re-running against the pushed commit.

### Project Structure Notes

- No new files expected. Modified: `app/services/code_driven_executor.py` (span emission at the
  `envelope.usage` lift point), `app/services/skill_integration_assistant.py` (prompt-text clarification
  only, both `_SYSTEM_PROMPT` and `_SYNTHESIS_SYSTEM_PROMPT`), possibly `app/core/tracing.py` (if Task 2
  adds a small new function rather than reusing `trace_llm_call` directly — keep it minimal, mirroring
  the existing module's shape).
- Test files: extend `tests/unit/services/test_code_driven_executor.py`; possibly touch
  `tests/unit/services/test_skill_integration_assistant.py` only if an existing prompt-content assertion
  needs updating (verify before assuming).
- No new API surface, no migration, no new dependency, no frontend change.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-17-observability-and-certification-evidence.md#Story-17.2] —
  epic-level AC1-AC4 contract (lines 37-59) this story's ACs expand.
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#L304-333] — the
  LangSmith ADR; item 6 (added 2026-07-24) explicitly scopes 17.2: "the sandbox must not widen egress
  beyond the tracing endpoint the environment already permits... whether existing bundles are re-adapted
  or only trace-forward is a 17.2 story-level decision (its AC2)."
- [Source: _bmad-output/implementation-artifacts/stories/17-1-langsmith-tracing-for-platform-llm-calls.md] —
  previous story; establishes `app/core/tracing.py`'s `trace_llm_call`/`traced_run_kind`/`_emit_span`
  conventions this story reuses verbatim, and the container-test-env trap noted above.
- [Source: _bmad-output/implementation-artifacts/stories/14-2-ai-adapter-on-upgrade-path.md] — precedent
  for an adapter-authoring-touching story: "existing bundle" strategy must be decided-and-documented (not
  silently picked); a rejected-design must be named with reasoning, not just omitted.
- [Source: velara-api/app/core/tracing.py] — the FULL Story 17.1 wrapper: `trace_llm_call` context
  manager, `LLMSpan` dataclass, `_emit_span` (no-span-when-no-model rule at `:209-210`, the direct
  precedent for this story's no-span-when-no-usage rule), `_get_ls_client` (explicit-client requirement
  — critical bug 17.1's code-review fixed, do not regress it here), `traced_run_kind`/`RUN_KIND_EXECUTION`.
- [Source: velara-api/app/services/code_driven_executor.py#L14-15] — module docstring: sandbox network
  egress is fully open, "enforcement deferred to Epic 7" (no egress allowlist exists to widen).
- [Source: velara-api/app/services/code_driven_executor.py#L103-152] — `CodeDrivenUsage` /
  `CodeDrivenResultEnvelope.usage` — the self-reported usage contract this story's span reuses.
- [Source: velara-api/app/services/code_driven_executor.py#L188-230] — `run_code_driven_hybrid` signature
  and docstring (the 10-step flow); this story's span emission belongs in/near Step 8-9.
- [Source: velara-api/app/services/code_driven_executor.py#L414-449] — `injected_env` literal allowlist;
  the sandbox surface AC3 protects; MUST remain untouched by this story.
- [Source: velara-api/app/services/code_driven_executor.py#L743-771] — the exact `envelope.usage` →
  `result_metadata` lift this story's span emission sits adjacent to.
- [Source: velara-api/app/services/skill_integration_assistant.py#L209-274,276-343] — `_SYSTEM_PROMPT` /
  `_SYNTHESIS_SYSTEM_PROMPT`; the existing "LLM usage reporting" hard rule (both prompts) that Task 1
  amends; the two-fenced-code-block output contract that must NOT change.
- [Source: velara-api/app/services/code_driven_hybrid.py#L96] — `CodeDrivenHybridManifest.reports_usage:
  bool = False` — the declared-capability flag AC2's retroactive-tracing argument depends on.
- [Source: velara-api/app/workers/execution_tasks.py#L108-117] — `_extract_token_metadata`; confirms
  `result_metadata`'s usage keys are the SAME ones already consumed downstream for pricing — the
  precedent that this data is trustworthy enough to act on twice (price + trace).
- [Source: velara-api/app/core/pricing.py#L68-92] — `compute_cost_usd`; the ONE cost source, reused here
  exactly as 17.1 reused it.
- [Source: velara-api/tests/unit/services/test_code_driven_executor.py] — existing test file/conventions
  to extend (subprocess/envelope mocking already established by Story 15.5's tests).
- [Source: velara-api/tests/unit/integrations/test_anthropic_client.py, tests/unit/core/test_tracing.py] —
  17.1's span-emission/no-op/error-swallow test patterns to mirror for the new call site.
- [Source: velara-api/pyproject.toml#L34] — `langsmith==0.10.10` already present (17.1); confirms no new
  dependency for this story.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created. Investigation
  disproved the epic's literal AC1 text ("a provided tracing wrapper the sandbox exposes") — no such
  wrapper exists, and building one would widen sandbox credential/dependency surface for no benefit.
  Instead this story emits the LangSmith span from the WORKER process (`code_driven_executor.py`),
  reusing the exact `envelope.usage` self-report the Story 15.5 pricing seam already requires — zero
  sandbox changes, zero new dependency, retroactive tracing for every already-usage-reporting bundle
  with no re-adapt campaign. Verified via Explore agent: (1) the design's factual claims about
  `injected_env`/sandbox isolation hold up against source, (2) `run_code_driven_hybrid` can never run
  inside an ambient `traced_run_kind("adaptation")` context — resolved definitively, not left open,
  (3) caught and fixed a real gap where `envelope.usage is not None` alone would let a PARTIAL usage
  report (tokens but no model id) attempt a span emission; AC1 now gates on `model is None` too,
  matching `_emit_span`'s existing guard and the pre-existing `code_driven_usage_contract_violation`
  warning's own definition of an incomplete report.

### File List
