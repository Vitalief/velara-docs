---
governing_ads: [AD-2]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: []
enables: [17-6, 17-7, 17-8]
baseline_commit: c702131df0796bde2c754942b99fe4c1b430039d
fixes: "Live wrong-cost bug — hand-rolled stream/multi-model capture recorded only 1 of N calls (32013/110)."
status_note: >
  Filled from STUB by bmad-create-story 2026-07-30. Governing artifact is the ARCHITECTURE-SPINE
  (status: final), specifically AD-2. Source citations verified against live source at baseline via a
  full call-site sweep + langsmith 0.10.10 wrap_anthropic ground-truth (container source inspection).
  Two operator decisions folded in (2026-07-30): (1) SLIM the sandbox shim now + KEEP totals() so cost
  VALUE is not left worse in the interim (trace-nesting deferred to 17-6); (2) run_kind becomes STATIC
  per-factory wrap tags (execution/adaptation), dropping the traced_run_kind ContextVar.
---

# Story 17.5: `wrap_anthropic` Seam — Delete Hand-Rolled Tracing

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the platform,
I want every Anthropic client to be traced by `langsmith.wrappers.wrap_anthropic` instead of our own
wrappers,
so that per-call, per-model, and streaming usage/cost are captured by LangSmith's tested code — not
by bespoke logic that has repeatedly miscounted.

## ⚠️ SCOPE — read this first

**Backend only (`velara-api`). This is a DELETION-AND-REPLACE refactor of the tracing SEAM, not a
behavior/feature story.** You delete the two hand-rolled tracing implementations
(`app/core/tracing.py` and the sandbox `velara_trace.py` custom span/stream classes) and route every
Anthropic client through `langsmith.wrappers.wrap_anthropic(...)` instead. **Zero product behavior
change** for a user: jobs run identically, and the persisted **cost VALUE** is unchanged (it still
comes from the old `pricing.py` / envelope path — 17-7/17-8 change that later). What changes is
*which code produces the LangSmith spans*.

**This story is NOT (do these later — do not reach into them):**
- **AD-7 / one-parent-trace-per-invocation + `RunTree.from_headers()` sandbox propagation → Story 17-6.**
  17-5 does the wrap seam only; it does **not** open a single invocation-scoped parent trace, does
  **not** persist `langsmith_run_id`, and does **not** wire cross-process trace headers. If you find
  yourself calling `get_current_run_tree()`, `to_headers()`, `from_headers()`, or `tracing_context()`,
  or writing to the `langsmith_run_id` column — **STOP, that is 17-6.**
- **Estimate write / slim `pricing.py` → 17-7.** Do not touch `pricing.py`, `execution_tasks.py`'s
  completion write, or `cost_is_estimated`.
- **Reconciler → 17-8.** No new Celery task.

**Governing invariant: AD-2** (`ARCHITECTURE-SPINE.md:62-66`). The invariant is the **wrap mechanism**:
no Anthropic client reaches a call site un-wrapped; all clients come through
`wrap_anthropic(anthropic.Anthropic(...))`; **no custom `RunTree`, `_emit_span`, `LLMSpan`,
`_TracedClient`/`_TracedStream`/`_TracedMessages` remains anywhere.** The two shipped provider
factories (`get_llm_provider`, `get_adapter_llm_provider` — different *models*, Story 17.2) both stand
and both return wrapped clients.

## Acceptance Criteria

1. **AC1 — Both platform provider clients are obtained via `wrap_anthropic`, with the `run_kind` split
   preserved as STATIC wrap tags.** In `app/integrations/anthropic_client.py`, `AnthropicProvider`'s
   `self._client` (built at `:143-148`) is wrapped: `self._client = wrap_anthropic(anthropic.Anthropic(...),
   tracing_extra={"client": <explicit ls client>, "tags": [f"run_kind:{run_kind}"]})`. The `run_kind`
   is passed **into `AnthropicProvider.__init__`** and set per-factory: `get_llm_provider()` →
   `run_kind="execution"`, `get_adapter_llm_provider()` → `run_kind="adaptation"` (they are already two
   separate `@lru_cache` clients — `:265-292` — so a static per-factory tag correctly reproduces the old
   per-call `run_kind` filter dimension without any ContextVar). The `traced_run_kind` ContextVar
   mechanism is **deleted** (see AC5), and the 3 adapter-propose call sites that used it
   (`skill_integration_assistant.py:808,900,1115`) drop the `with traced_run_kind(...)` wrapper —
   their calls already receive the adapter provider (injected via `dependencies.py:81
   `_adapter_llm_provider()` → `get_adapter_llm_provider()`), which now carries `run_kind:adaptation`
   statically. (Verified: the 3 sites call `.complete(...)` on an injected `llm_provider` param that is
   the adapter provider at every current caller — a future caller passing the execution provider would
   mis-tag, so keep the injection wiring intact.)

2. **AC2 — Metadata-only PHI floor is preserved via the explicit LangSmith `Client`, NOT lost to
   wrap_anthropic's default full-content capture.** `wrap_anthropic` **sends full inputs+outputs
   (system prompt + messages + response text) by default** (verified: langsmith 0.10.10 folds `system`
   into the messages array and submits it). This would egress skill-IP + PHI — forbidden in
   staging/prod. The floor is reinstated at the injected client:
   `Client(api_key=settings.LANGSMITH_API_KEY, hide_inputs=<redact>, hide_outputs=<redact>)`, where
   `<redact>` is `True` (metadata-only) **unless** `settings.LANGSMITH_TRACE_CONTENT` is true (dev
   only). i.e. `hide_inputs = not settings.LANGSMITH_TRACE_CONTENT` (same for outputs). This preserves
   17.1's exact content-grading contract (`LANGSMITH_TRACE_CONTENT=false` default = metadata only; the
   `config.py` staging/prod boot-refusal at `:367-369` is untouched and still forbids content-on
   there). Token/model/cost metadata is carried in `usage_metadata`/`ls_*` fields, NOT in `inputs`, so
   hiding inputs does **not** strip usage — verified.

3. **AC3 — Explicit LangSmith client (key NOT from `os.environ`) is injected via `tracing_extra`.**
   The current `_get_ls_client` exists because `settings.LANGSMITH_API_KEY` is sourced from `.env` /
   Secrets Manager and **never lands in `os.environ`**, so a default-client `RunTree` would post with no
   credential (silent no-op). `wrap_anthropic` accepts an explicit client via
   `tracing_extra={"client": Client(api_key=settings.LANGSMITH_API_KEY, ...)}` (verified:
   `TracingExtra.client`; it propagates to nested child runs too). Build this client the same lazy,
   cached, settings-sourced way `_get_ls_client` did — but it now lives at the wrap site
   (`anthropic_client.py`), because `tracing.py` is deleted. Do **not** rely on env-var auth.

4. **AC4 — `wrap_anthropic` covers `.create` / `.stream` / `beta.messages.create` natively; no
   story-authored stream/multi-model capture remains.** Verified against langsmith 0.10.10 source:
   the wrapper patches `messages.create`, `messages.stream` (dedicated stream wrapper that reads usage
   at stream-end via `get_final_message()` / `_reduce_chat_chunks` — exactly what the hand-rolled
   `_StreamProxy` did), and — conditionally, only when the installed anthropic SDK exposes `.beta`
   (`hasattr(client, "beta")` gate in the wrapper) — `beta.messages.create` / `beta.messages.parse`.
   Do not assert beta-wrapping unconditionally in a test. Each call is an independent
   traced run, so **N calls across M models → N distinct llm runs** — this is the structural fix for
   the live "captured only 1 of N calls" undercount bug. The provider's `complete`/`create_message`
   methods lose their `with trace_llm_call(...)` blocks and their `span.record(...)` calls entirely —
   the wrapped client traces transparently. When tracing is off (no `LANGSMITH_TRACING` /
   `LANGSMITH_API_KEY`), the wrapped client is a transparent pass-through (verified no-op) — AD-6's
   tracing-off contract holds.

5. **AC5 — All hand-rolled tracing is deleted; nothing bespoke remains.**
   - **Delete `app/core/tracing.py` entirely** — `_get_ls_client`, `LLMSpan`, `trace_llm_call`,
     `record_code_driven_span`, `_emit_span`, `traced_run_kind`, `_run_kind`, `RUN_KIND_EXECUTION`,
     `RUN_KIND_ADAPTATION`. Sole importers are `anthropic_client.py:27`, `code_driven_executor.py:859`,
     `skill_integration_assistant.py:36` — all rewired below. **No `RunTree` construction remains in
     `tracing.py` (file gone).**
   - **`code_driven_executor.py`**: delete the `record_code_driven_span` import+call
     (`:859-866`). The gate that precedes it (envelope has priceable usage) and the `result["usage"]`
     population from `velara_trace.totals()` **stay** (that is the cost VALUE path — see AC6).
   - **Sandbox `velara_trace.py`**: delete the bespoke span/stream classes `_TracedClient`,
     `_TracedStream`, `_StreamProxy`, `_TracedMessages`, and the module-local `_emit_span` /
     `_record_from_response`. See AC6 for exactly what the slimmed shim collapses to.

6. **AC6 — Sandbox shim collapses to a `wrap_anthropic` monkeypatch + KEEP the local token
   accumulator/`totals()` (cost VALUE preserved in the interim).** Per the operator decision, 17-5
   does **not** delete the sandbox usage path — only its bespoke span code. The slimmed
   `velara_trace.py` is:
   - `install()` — monkeypatch `anthropic.Anthropic` → `wrap_anthropic(real_Anthropic(...))` (so a
     skill's own internally-built client is traced with zero cooperation, the AD-2 backstop), plus its
     auto-`install()`-on-import.
   - `client(**kwargs)` — returns `wrap_anthropic(anthropic.Anthropic(...))` (the explicit path the
     adapter rewrites to).
   - **KEEP** the process-global token accumulator (`_input_tokens_total`, `_output_tokens_total`,
     `_last_model`, `_call_count`, `_record_usage`) and **`totals()`** — this is what
     `code_driven_executor._RUNNER_SCRIPT` copies into `result["usage"]` (`:201`) to drive Run Console
     cost. But it can no longer pigg-back on the deleted `_TracedMessages`. Wire the accumulator by
     wrapping the returned/patched client's `messages.create`/`.stream`/`.parse` in a **thin
     usage-only recorder** (no span emission — `wrap_anthropic` owns spans now; this recorder ONLY
     increments the token totals from the response's `usage`). Keep it minimal: it is a token counter,
     not a tracer.
   - **`langsmith` is NOT guaranteed present in the sandbox venv.** ⚠️ The sandbox venv is built ONLY
     from `manifest.requirements` (`code_driven_executor.py:407-422`, `pip install -r requirements.txt`);
     the platform injects only the 3 `LANGSMITH_*` **env vars** (`:507-511`), NOT the langsmith or
     anthropic packages. So the `wrap_anthropic` import **MUST be guarded** and fall back to the raw
     `anthropic.Anthropic` client when `langsmith` is absent — exactly as today's shim swallows its
     `from langsmith.run_trees import RunTree` in a `try/except` (`velara_trace.py:98-99`). Usage
     accumulation via `totals()` must keep working in the un-traced fallback. Keep `import anthropic`
     lazy/local too.
   - **Trace-nesting is explicitly deferred to 17-6**: in the interim, when tracing IS enabled and
     langsmith IS available, in-sandbox `wrap_anthropic` calls emit as their own trace (not nested under
     the worker's), because header propagation (`from_headers()`) is 17-6. This is acceptable and does
     **not** make cost worse — the cost VALUE still flows through `totals()` → envelope → old pricing
     path, unchanged from today. `LANGSMITH_*` env injection (`code_driven_executor.py:507-511`) **stays**.

7. **AC7 — Adapter-prompt references to `velara_trace` stay TRUE to the actual (unchanged) contract —
   which is that the adapter does NOT set `usage`.** READ THE CURRENT PROMPT BEFORE EDITING: it already
   tells the adapter the platform handles usage **automatically** and the adapter *"must NOT ... set any
   `usage` key"* (`skill_integration_assistant.py:242, :335`); `velara_trace.client()` is *"OPTIONAL
   (clarity only, not required)"* (`:251`). The **runner** auto-injects `totals()` into `result["usage"]`
   after the adapter returns (`code_driven_executor.py:199-206`: "an adapter-set `usage` is respected
   and never overwritten"). So there is **NO `totals()`-wiring instruction to preserve — do NOT add
   one.** This story's only obligation here: the slimmed shim keeps the SAME external contract
   (monkeypatch interception + `velara_trace.client()` still returns a traced client + `totals()` still
   accumulates), so these prompt clauses **remain accurate as written and most/all need NO change.**
   Check each of the 6 cited clauses (`:244,251,269,270,678,1055`) — none currently describes bespoke
   span internals (they describe interception/wiring), so verify there is even anything to reword; only
   touch a clause if the slimmed shim actually changed the behavior it describes. The
   `_CONFORMING_ADAPTER_SOURCE` fixture (`test_skills.py:3505-3526`) — which *does* itself call
   `velara_trace.client()` + set `totals()` (a harmless adapter-set usage the runner respects) — stays
   valid unchanged.

8. **AC8 — Gates: `ruff` clean; full `pytest` green in the CI-equivalent env; tracing tests
   deleted/rewritten to the wrapper; no OpenAPI diff.**
   - **Delete** `tests/unit/core/test_tracing.py` and `tests/unit/services/test_velara_trace_shim.py`
     (both test removed internals wholesale).
   - **Rewrite** the span-emission assertions in `tests/unit/integrations/test_anthropic_client.py`
     (`TestProviderTracing`), `tests/unit/services/test_code_driven_executor.py` (span block), and the
     `run_kind`/`velara_trace` assertions in `tests/unit/services/test_skill_integration_assistant.py`
     to the new model — assert that clients are wrapped and that `run_kind` tags are present via the
     wrap config, NOT that `RunTree`/`_emit_span` was called. Keep the no-op-when-tracing-off and
     usage-accumulation (`totals()`) assertions.
   - `tests/unit/core/test_config.py` LANGSMITH-settings tests: the 4 `LANGSMITH_*` settings and the
     staging/prod content boot-refusal **all survive** (they now gate the injected-client redaction),
     so this file should need little/no change — verify it still passes.
   - `python scripts/export_openapi.py` → **zero** `docs/api-spec.json` diff (no schema surface here).

## Tasks / Subtasks

- [x] **Task 1 — Rewrite `anthropic_client.py` onto `wrap_anthropic`** (AC: 1, 2, 3, 4)
  - [x] Remove `from app.core.tracing import trace_llm_call` (`:27`).
  - [x] Add a lazy, cached, settings-sourced LangSmith `Client` builder at module scope (port
        `_get_ls_client`'s explicit-key rationale verbatim into a comment — the key is never in
        `os.environ`). Build it with `hide_inputs = not settings.LANGSMITH_TRACE_CONTENT`,
        `hide_outputs = not settings.LANGSMITH_TRACE_CONTENT`.
  - [x] Add a `run_kind: str` parameter to `AnthropicProvider.__init__`. After building
        `anthropic.Anthropic(...)` (`:143-148`), wrap it:
        `self._client = wrap_anthropic(raw, tracing_extra={"client": _ls_client(), "tags": [f"run_kind:{run_kind}"]})`
        — but ONLY wrap when tracing is enabled/available; when unconfigured, `wrap_anthropic` is a safe
        transparent pass-through so wrapping unconditionally is also fine (verified) — prefer
        unconditional wrap for simplicity, matching the "no client reaches a call site un-wrapped"
        invariant. (Import `wrap_anthropic` lazily inside `__init__`, mirroring the existing lazy
        `import anthropic` at `:130`, so a non-tracing process/test still imports nothing new eagerly.)
  - [x] In `complete` (`:150-200`) and `create_message` (`:202-262`): delete the
        `with trace_llm_call(...) as span:` blocks and both `span.record(...)` calls. The body
        (`self._client.messages.create(...)` + result extraction + the existing PHI-safe `logger.info`)
        stays exactly as-is — the wrapped client traces transparently. Keep the "DO NOT pass
        temperature/top_p/..." comments.
  - [x] `get_llm_provider()` (`:266`) passes `run_kind="execution"`; `get_adapter_llm_provider()`
        (`:278`) passes `run_kind="adaptation"`. Keep both `@lru_cache(maxsize=1)`.
- [x] **Task 2 — Delete `app/core/tracing.py`** (AC: 5)
  - [x] `git rm app/core/tracing.py`. Confirm no remaining importers (grep `from app.core.tracing`,
        `import app.core.tracing` → zero after Tasks 1/3/4).
- [x] **Task 3 — Rewire `code_driven_executor.py`** (AC: 5, 6)
  - [x] Delete the `from app.core.tracing import record_code_driven_span` import + the
        `record_code_driven_span(...)` call (`:859-866`). Keep the surrounding priceable-usage gate and
        the `reports_usage`-violation log below it.
  - [x] Keep `_write_velara_trace_shim` (`:210-233`), the shim write into `bundle_dir` (`:587`), the
        `import velara_trace` backstop in `_RUNNER_SCRIPT` (`:180-187`), the `totals()`→`result["usage"]`
        injection (`:199-206`), and the `LANGSMITH_*` env injection (`:507-511`) — all still needed
        (AC6). No change here beyond removing the span call.
- [x] **Task 4 — Rewire `skill_integration_assistant.py`** (AC: 1, 7)
  - [x] Remove `from app.core.tracing import RUN_KIND_ADAPTATION, traced_run_kind` (`:36`).
  - [x] Delete the `with traced_run_kind(RUN_KIND_ADAPTATION):` wrappers at `:808, :900, :1115` (leave
        the LLM calls inside — they already use `get_adapter_llm_provider()`, now statically tagged
        `run_kind:adaptation`).
  - [x] Review the prompt clauses mentioning `velara_trace` (`:244,251,269,270,678,1055`) — per AC7 the
        adapter contract is UNCHANGED (adapter does NOT set `usage`; runner auto-injects `totals()`), and
        none of these clauses describes bespoke span internals, so they most likely need **no edit**.
        Only reword a clause if the slimmed shim actually changed the behavior it states. Do NOT invent a
        "set `usage`" instruction — that would contradict the prompt (`:242,:335`) and the runner
        (`code_driven_executor.py:199-206`).
- [x] **Task 5 — Slim the sandbox `velara_trace.py`** (AC: 5, 6)
  - [x] Delete `_TracedClient`, `_TracedStream`, `_StreamProxy`, `_TracedMessages`, module-local
        `_emit_span`, `_record_from_response`.
  - [x] Rebuild `client()` and `install()` on `wrap_anthropic(anthropic.Anthropic(...))`. Keep the
        `import anthropic` local, the `ANTHROPIC_API_KEY`-from-env read, and the auto-`install()` on
        import + idempotency guard.
  - [x] KEEP `_record_usage`, the 4 module globals, and `totals()`. Wire the accumulator with a thin
        usage-only recorder around the wrapped client's `messages.create/.stream/.parse` responses (NO
        span emission — wrap_anthropic owns spans). `totals()` shape unchanged
        (`{input_tokens, output_tokens, model}` or `None` when `_call_count == 0`).
  - [x] This module still has NO `app.*` import (runs in the sandbox venv). `wrap_anthropic`
        (`langsmith.wrappers`) is **not guaranteed installed** in that venv (it's built from
        `manifest.requirements` only — the platform injects env vars, not packages). **Guard the
        `wrap_anthropic` import** so that when `langsmith` is absent the client is the raw
        `anthropic.Anthropic` (still accumulates usage via the recorder, just no spans) — mirror the
        existing swallowed-`ImportError` shape at `velara_trace.py:98-99`.
- [x] **Task 6 — Tests + gates** (AC: 8)
  - [x] `git rm tests/unit/core/test_tracing.py tests/unit/services/test_velara_trace_shim.py`.
  - [x] Rewrite span assertions in `test_anthropic_client.py` (`TestProviderTracing`),
        `test_code_driven_executor.py` (span block), `test_skill_integration_assistant.py` (run_kind +
        velara_trace). Assert wrapping + tag presence + no-op-off + usage accumulation; do NOT assert on
        `RunTree`/`_emit_span`.
  - [x] Update `_CONFORMING_ADAPTER_SOURCE` in `test_skills.py` only if the slimmed contract changed
        what the adapter writes (it should not — client()/totals() survive).
  - [x] `ruff check .` clean; run the affected unit + integration suites; `python scripts/export_openapi.py`
        → zero `docs/api-spec.json` diff.

### Review Findings

- [x] [Review][Patch] Sandbox skill content (PHI + skill IP) leaks to LangSmith when tracing is on [app/services/sandbox_assets/velara_trace.py:240] — `_wrap_if_available` calls `wrap_anthropic(raw)` with no `tracing_extra`/explicit `Client`; langsmith defaults `hide_inputs`/`hide_outputs` to `False`, and the sandbox env never injects `LANGSMITH_TRACE_CONTENT` or `HIDE_INPUTS`/`HIDE_OUTPUTS` — full skill prompt/response content ships to LangSmith whenever tracing is enabled, violating AC2's metadata-only PHI floor. No test in this diff exercises the sandbox wrap with real hide_inputs/hide_outputs assertions. **Fixed:** `_wrap_if_available` now builds an explicit `Client(hide_inputs=True, hide_outputs=True)` and passes it via `tracing_extra`; added `test_wrap_anthropic_call_hides_content_unconditionally` + a construction-failure regression test.
- [x] [Review][Patch] `_get_ls_client()` constructs a real network client unconditionally, even when tracing is off [app/integrations/anthropic_client.py:194] — evaluated as a plain function argument before `wrap_anthropic` runs, so a real `langsmith.Client()` (background thread + outbound `GET /info`) is built on every `AnthropicProvider` construction regardless of `LANGSMITH_TRACING`/`LANGSMITH_API_KEY` — contradicts AC4/AD-6's zero-network-I/O-when-off guarantee. Every test mocks `_get_ls_client` away, so the genuinely-off path is untested. **Fixed:** added `_tracing_enabled()` gate; `_get_ls_client()` returns `None` when unconfigured, and the call site omits the `client` key from `tracing_extra` entirely (not `client=None`) rather than passing it through. Added 3 regression tests proving `langsmith.Client` is never constructed when tracing is off.
- [x] [Review][Patch] `messages.parse` usage is accumulated but silently never traced [app/services/sandbox_assets/velara_trace.py:245-253] — `wrap_anthropic` does not patch top-level non-beta `messages.parse`; the shim docstring implies uniform create/stream/parse coverage, true for usage accumulation but false for tracing. **Fixed:** docstring reworded to clarify `.parse()` is usage-only, not traced by the underlying wrap.
- [x] [Review][Patch] `LANGSMITH_PROJECT` injected into sandbox env but never read [app/services/code_driven_executor.py:512] — flagged as dead config; on inspection it's read directly by the langsmith SDK/`wrap_anthropic` for run routing, not truly dead. **Fixed:** corrected the comment to describe this accurately instead of removing the injection.

## Dev Notes

### Governing invariant — AD-2 (verbatim intent)

`ARCHITECTURE-SPINE.md:62-66`: "Every Anthropic client passes through `wrap_anthropic`; no hand-rolled
tracing. … No custom `RunTree`, no `_emit_span`, no `_TracedClient`/`_TracedStream`/`_TracedMessages`.
The two shipped provider factories (`get_llm_provider`, `get_adapter_llm_provider` — different *models*,
Story 17.2) both stand and both return wrapped clients. The sandbox shim installs `wrap_anthropic` via
monkeypatch of `anthropic.Anthropic` so a skill's own internally-built client is traced with zero skill
cooperation. `wrap_anthropic` handles `.create` / `.stream` / `beta.create` natively (verified)."

### The exact deletion/rewire surface (verified against baseline via full call-site sweep)

| File | Change |
| --- | --- |
| `app/integrations/anthropic_client.py` | Rewrite: drop `trace_llm_call` import+usage (`:27,157,177,218,238`); add lazy explicit LS `Client` builder w/ `hide_inputs/outputs`; add `run_kind` param; wrap `self._client` with `wrap_anthropic`; factories pass execution/adaptation. |
| `app/core/tracing.py` | **DELETE (whole file, 361 lines).** |
| `app/services/code_driven_executor.py` | Delete `record_code_driven_span` import+call (`:859-866`). Keep shim writer/env-injection/totals-injection. |
| `app/services/skill_integration_assistant.py` | Drop `traced_run_kind`/`RUN_KIND_ADAPTATION` import (`:36`) + 3 `with traced_run_kind(...)` sites (`:808,900,1115`); reword `velara_trace` prompt clauses (`:244,251,269,270,678,1055`). |
| `app/services/sandbox_assets/velara_trace.py` | Slim: delete bespoke span/stream classes; rebuild `client()`/`install()` on `wrap_anthropic`; KEEP accumulator + `totals()`. |
| `tests/unit/core/test_tracing.py` | **DELETE.** |
| `tests/unit/services/test_velara_trace_shim.py` | **DELETE.** |
| `tests/unit/integrations/test_anthropic_client.py` | Rewrite `TestProviderTracing` span assertions → wrap+tag assertions. |
| `tests/unit/services/test_code_driven_executor.py` | Rewrite span block; keep usage/totals assertions. |
| `tests/unit/services/test_skill_integration_assistant.py` | Rewrite run_kind (`:78-85,155`) + velara_trace assertions to slimmed contract. |
| `tests/integration/api/test_skills.py` | `_CONFORMING_ADAPTER_SOURCE` (`:3505-3526`) — update only if slimmed contract changed adapter output (it should not). |

**Do NOT touch (orthogonal — verified):** `app/models/invocation.py`, migration `0031`, and
`tests/integration/services/test_invocation_cost_states_migration.py` — the `langsmith_run_id` column
is Story 17.4's persisted trace-linkage, populated by 17-6, unrelated to the wrap seam. `pricing.py`,
`execution_tasks.py` completion write, `config.py` `LANGSMITH_*` settings (they survive and now gate
the injected-client redaction — no change), and `app/api/v1/skills.py` (no tracing reference there).

### langsmith 0.10.10 `wrap_anthropic` — ground-truthed facts you can rely on

Verified by inspecting the installed container source
(`/usr/local/lib/python3.12/site-packages/langsmith/wrappers/_anthropic.py`) + `client.py`:

- **Signature:** `wrap_anthropic(client, *, tracing_extra=None, chat_name="ChatAnthropic",
  completions_name="Anthropic")`. `TracingExtra` = `{metadata?, tags?, client?}` (TypedDict, total=False).
- **Explicit LS client (AC3):** pass `tracing_extra={"client": Client(api_key=...)}`. Resolution in
  `_setup_run`: `langsmith_extra.get("client", client) or _context._CLIENT.get()` — your injected client
  wins and propagates to nested runs. **You do NOT need the key in `os.environ`.**
- **Content redaction (AC2):** `Client(hide_inputs=bool_or_callable, hide_outputs=bool_or_callable)`
  applied in `_run_transform` at submission, **independent of and after** the wrapper's own
  `process_inputs=_strip_not_given`, so it reliably strips content. `True` → inputs become `{}`. Note
  the wrapper folds `system` into messages, so hiding is **mandatory**, not optional, for the PHI floor.
  `usage_metadata`/`ls_model_name`/token counts live in metadata, NOT inputs — hiding inputs does not
  lose usage/cost/model.
- **Coverage (AC4):** patches `messages.create`, `messages.stream` (usage read at stream-end),
  `beta.messages.create`, `beta.messages.parse`, `completions.create`. Each call = an independent
  `run_type="llm"` run → multi-call/multi-model is structurally correct (the undercount fix).
- **Trace-off (AD-6):** when tracing not enabled and no parent run, `_setup_run` returns the original
  function — transparent pass-through, zero network I/O. Wrapping unconditionally is safe.
- **Nesting:** a wrapped call auto-nests under the current run tree if one is active — but **opening
  that parent tree is 17-6, not here.** Also note: being *inside* an active parent trace forces tracing
  ON regardless of the env flag — relevant to 17-6's trace-off contract, not 17-5.
- **`total_cost`:** computed **server-side** by LangSmith from `ls_model_name` + `usage_metadata`. 17-8's
  reconciler reads it; 17-5 neither reads nor persists it.

### run_kind: ContextVar → static per-factory tags (operator decision)

The old design used a per-call `_run_kind` ContextVar + `traced_run_kind("adaptation")` at 3 adapter
sites because a single shared client couldn't distinguish intent. But we already have **two** cached
clients: `get_llm_provider` (execution model) and `get_adapter_llm_provider` (adapter model). Since
`wrap_anthropic` bakes `tracing_extra["tags"]` statically at wrap time, tag each factory's client at
construction — `run_kind:execution` vs `run_kind:adaptation` — and delete the ContextVar entirely. The
LangSmith filter dimension (monthly cost by execution vs adaptation) is preserved. This is why AC1 adds
`run_kind` to `__init__` rather than threading it per-call.

### Sandbox interim (operator decision: slim now, keep totals)

17-5 deletes the sandbox's bespoke span/stream code but **keeps** the token accumulator + `totals()`,
because that is the cost VALUE feed (`totals()` → runner auto-injects `result["usage"]` at
`code_driven_executor.py:199-206` → old pricing). Trace-*nesting* (the sandbox trace joining the
worker's one trace via `from_headers()`) is AD-7 = **Story 17-6**. In the 17-5→17-6 window the
in-sandbox wrapper, when tracing is on AND langsmith is available in the venv, emits its own (un-nested)
trace — this does not regress cost (value still flows through `totals()`), satisfying the stub's "don't
leave cost worse" note. Keep the `LANGSMITH_*` sandbox env injection (`:507-511`). NOTE: `langsmith` is
not guaranteed in the sandbox venv (built from `manifest.requirements`), so the wrapper import is
guarded and the un-traced path still accumulates usage — see AC6.

### Why this is the live-bug fix

The stub's `fixes:` header — "hand-rolled stream/multi-model capture recorded only 1 of N calls
(32013/110)" — is the `_StreamProxy`/`_TracedMessages` single-slot capture and the platform
`trace_llm_call` per-call span that, combined, undercounted multi-call runs. `wrap_anthropic` creates
one independent llm run per call natively, so N calls → N runs → correct usage. This story is the
seam swap that makes that true; 17-6 then unifies them under one trace, and 17-8 reconciles cost from
LangSmith's per-run `total_cost`.

### Testing

- **Framework:** pytest. Unit tests under `tests/unit/`; integration under `tests/integration/`
  (Postgres-gated). Per [Memory: project-velara-api-container-test-env]: the `api` container runs
  `AUTH_BACKEND=cognito` via its `.env`; run integration tests with `set -a; . ./.env.test` against a
  freshly-recreated clean `velara_test`.
- **CRITICAL [Memory: project-container-stale-baked-test-file]:** the `api`/`worker` containers **bake
  source into the image — there is NO bind mount.** After editing any file, `docker cp` it into the
  container (or rebuild) BEFORE running in-container pytest, and verify the container actually has your
  change (grep a new symbol / compare line counts) — otherwise `pytest` runs the stale baked copy and
  "passes" against old code. This bit Story 17.4's review. Rebuilds fill VM disk —
  `docker builder prune -a -f` first if rebuilding.
- **What to assert (rewrites):** that `AnthropicProvider._client` is a wrapped client (e.g. patch
  `langsmith.wrappers.wrap_anthropic` and assert it was called with the right `tracing_extra` tags /
  redaction flags); that `complete`/`create_message` still return correct `LLMResult`/`LLMTurn` with a
  `FakeLLMProvider`-style double or a mocked `messages.create`; that tracing-off is a transparent
  pass-through (no langsmith network); that `velara_trace.totals()` still accumulates across calls and
  returns `None` before any call. **Do NOT** assert `RunTree`/`_emit_span` were constructed — they're
  gone.
- **Gates:** `ruff check .` clean; affected unit suites + `test_skills.py`/`test_code_driven_executor.py`
  green; `python scripts/export_openapi.py` → zero `docs/api-spec.json` diff (run with `PYTHONPATH=/app`
  inside the container per 17.4's note).

### Project Structure Notes

- Provider seam: `app/integrations/anthropic_client.py` (NOT `app/core/` — the stub's path was wrong;
  corrected here). Mirrors StorageProvider/SecretsProvider Protocol pattern.
- Sandbox assets: `app/services/sandbox_assets/velara_trace.py` is written into the workspace at
  execution time by `code_driven_executor._write_velara_trace_shim` — it must remain `app.*`-import-free.
- `langsmith==0.10.10` already pinned (`pyproject.toml:34`); `wrap_anthropic` is in `langsmith.wrappers`
  — the dep stays. No new dependency.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-2] `:62-66` — the governing wrap-mechanism invariant (verbatim in Dev Notes).
- [Source: ARCHITECTURE-SPINE.md#AD-6] `:86-90` — tracing-off keeps the estimate; wrapped client must no-op when off.
- [Source: ARCHITECTURE-SPINE.md#AD-7] `:92-96` — ONE parent trace + header propagation = **Story 17-6**, explicitly out of 17-5 scope.
- [Source: ARCHITECTURE-SPINE.md#Structural-Seed] `:163` — "Sandbox velara_trace.py collapses to monkeypatch anthropic.Anthropic → wrap_anthropic(real()), plus a local token accumulator for the DB write."
- [Source: velara-api/app/core/tracing.py] `:1-362` — the whole hand-rolled implementation being deleted (symbols: `trace_llm_call` `:168`, `LLMSpan` `:120`, `record_code_driven_span` `:200`, `_emit_span` `:250`, `traced_run_kind` `:96`, `_run_kind` `:92`, `_get_ls_client` `:58`).
- [Source: velara-api/app/integrations/anthropic_client.py] `:143-148` client build, `:157/:218` `trace_llm_call` sites, `:177/:238` `span.record`, `:265-292` the two `@lru_cache` factories.
- [Source: velara-api/app/services/sandbox_assets/velara_trace.py] `:88-284` bespoke classes to delete; `:271` `client()`, `:287` `totals()`, `:306` `install()`, `:77-85` `_record_usage` + globals to KEEP.
- [Source: velara-api/app/services/code_driven_executor.py] `:859-866` `record_code_driven_span` call (delete), `:180-233` shim writer/backstop (keep), `:199-206` `totals()`→`usage` (keep), `:507-511` `LANGSMITH_*` env injection (keep).
- [Source: velara-api/app/services/skill_integration_assistant.py] `:36` import, `:808/:900/:1115` `traced_run_kind` sites, `:244/:251/:269/:270/:678/:1055` `velara_trace` prompt clauses.
- [Source: velara-api/app/core/config.py] `:270-289` the 4 `LANGSMITH_*` settings (survive), `:367-369` staging/prod content boot-refusal (untouched).
- [Source: langsmith 0.10.10 `langsmith/wrappers/_anthropic.py` + `client.py`] — `wrap_anthropic` signature, `TracingExtra.client`, `hide_inputs/hide_outputs`, `.create/.stream/.beta` coverage, trace-off pass-through (ground-truthed in-container 2026-07-30).
- [Source: _bmad-output/implementation-artifacts/stories/17-6-invocation-scoped-trace-sandbox-header-propagation.md] — AD-7 parent-trace + header work that depends_on 17-5; the boundary this story must not cross.
- [Memory: project-container-stale-baked-test-file] — `api` container bakes source; `docker cp` + verify before trusting in-container pytest.
- [Memory: project-velara-api-container-test-env] — `.env.test` + clean `velara_test` for integration tests.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Container bakes source (no bind mount) — per [Memory: project-container-stale-baked-test-file],
  `docker cp`'d every changed file into the `api` container after each edit and verified sync (grep a
  new symbol / compare line counts) before trusting any in-container `pytest`/`ruff` run. A blanket
  `docker cp . <container>:/app` was used once mid-run as a full-workspace resync; confirmed healthy via
  `ruff check` + a smoke import afterward.
- Recreated `velara_test` clean (`DROP DATABASE` + `CREATE DATABASE ... OWNER velara`) and ran
  `alembic upgrade head` before the integration suite, per the container-test-env convention.
- `test_wrap_anthropic_is_called_unconditionally` initially failed (0 calls recorded) — root cause: the
  test called the `_make_provider()` helper, which itself opens a *nested* `patch("langsmith.wrappers
  .wrap_anthropic", ...)` context that shadows the outer test's patch, so the outer mock never observes
  the call. Fixed by constructing `AnthropicProvider` directly in the test instead of through the helper.
- `tests/unit/core/test_config.py::test_default_value_is_false` fails in this container — confirmed
  PRE-EXISTING and unrelated to this story: `config.py` and `test_config.py` are untouched by the diff
  (`git diff --stat HEAD -- app/core/config.py tests/unit/core/test_config.py` is empty). Root cause is
  a container-environment leak: the `api` container's `.env` sets `LANGSMITH_TRACING=true` and
  `LANGSMITH_TRACE_CONTENT=true` in the actual process environment, and `Settings(_env_file=None, ...)`
  still reads live `os.environ` (pydantic-settings does not gate on `_env_file` for process env vars) —
  so the test's "defaults are false" assertion fails against this container's env regardless of code.
  Verified with `unset LANGSMITH_TRACE_CONTENT` — still fails on `LANGSMITH_TRACING`. Left unfixed
  (out of this story's scope; `config.py` is explicitly on the "do not touch" list).

### Completion Notes List

- **AC1** — `AnthropicProvider.__init__` gained a required `run_kind: str` param; `get_llm_provider()`
  passes `"execution"`, `get_adapter_llm_provider()` passes `"adaptation"`. Both remain
  `@lru_cache(maxsize=1)` singletons, so the tag is baked once per factory at construction — no
  ContextVar. The 3 `skill_integration_assistant.py` adapter-propose sites (`:808→`, `:900→` (now
  `:807`, `:898` after unwrap-dedent), `:1108→`) dropped their `with traced_run_kind(...)` blocks; they
  already call through the injected adapter provider.
- **AC2/AC3** — `_get_ls_client()` (module-scope in `anthropic_client.py`, replacing the deleted
  `tracing.py`'s version) builds an explicit `langsmith.Client(api_key=settings.LANGSMITH_API_KEY,
  hide_inputs=not LANGSMITH_TRACE_CONTENT, hide_outputs=not LANGSMITH_TRACE_CONTENT)`, cached
  module-globally. Injected into every wrap via `tracing_extra={"client": ..., "tags": [...]}`.
- **AC4** — `wrap_anthropic` is called unconditionally in `AnthropicProvider.__init__` (imported lazily
  inside `__init__`, mirroring the existing lazy `anthropic`/`httpx` imports); `complete`/`create_message`
  lost their `with trace_llm_call(...)`/`span.record(...)` blocks entirely — the wrapped client traces
  transparently. No story-authored stream/multi-model capture remains.
- **AC5** — `app/core/tracing.py` deleted whole-file (361 lines; confirmed zero remaining importers via
  grep before deletion). `record_code_driven_span` import+call removed from `code_driven_executor.py`
  (the platform-side "span from self-reported usage" mechanism is gone — in-sandbox calls now trace
  directly via the slimmed shim's own `wrap_anthropic` use). `traced_run_kind`/`RUN_KIND_ADAPTATION`
  import + all 3 call sites removed from `skill_integration_assistant.py`.
- **AC6** — Sandbox `velara_trace.py` rebuilt: bespoke `_TracedClient`/`_TracedStream`/`_StreamProxy`/
  `_TracedMessages`/module `_emit_span` deleted; replaced with `_UsageClient`/`_UsageStream`/
  `_UsageStreamProxy`/`_UsageMessages` (usage-accumulation only, no span code) wrapping a client that
  `_wrap_if_available()` traces via `wrap_anthropic` IF BOTH the tracing env vars are set AND
  `langsmith.wrappers` is importable — guarded with a bare `except Exception`, falling back to the raw
  untraced client (usage accumulation still works either way). `totals()`/`_record_usage`/the 4 module
  globals are unchanged in shape and behavior. `client()` and `install()` both route through
  `_wrap_if_available`. Confirmed via test that the guarded import genuinely tolerates `langsmith`
  being absent (simulated via a `builtins.__import__` block, not just an exception side-effect on an
  already-imported name).
- **AC7** — Verified (not assumed) that none of the 6 `velara_trace` prompt clauses in
  `skill_integration_assistant.py` describe bespoke span internals — they describe interception/wiring,
  which is unchanged externally by the slimmed shim. Zero prompt text edits were needed; only the one
  stale in-code comment referencing `app.core.tracing` (in `code_driven_executor.py`'s env-injection
  block) was reworded for accuracy.
- **AC8** — Deleted `tests/unit/core/test_tracing.py` and the old `tests/unit/services/
  test_velara_trace_shim.py` (both tested removed internals wholesale); wrote a new
  `test_velara_trace_shim.py` covering the slimmed shim's usage accumulation (create/stream/
  get_final_message-at-stream-end/exit-fallback), the guarded `wrap_anthropic` import (env-gate-closed,
  langsmith-absent, wrap-failure — all three fall back to accumulation-only), and `install()` idempotency.
  Rewrote `test_anthropic_client.py`'s `TestProviderTracing` to assert wrap CONFIGURATION (explicit
  client, redaction flags, run_kind tag, unconditional wrap) instead of `RunTree` construction. Removed
  the now-dead span-emission test block from `test_code_driven_executor.py` (the mechanism it tested no
  longer exists) and its `app.core.tracing` import. Rewrote the one `run_kind`-dependent test in
  `test_skill_integration_assistant.py` (the old test read an ambient ContextVar the `FakeLLMProvider`
  double can no longer observe — the tag is now static-per-real-provider, orthogonal to test doubles).
  `test_config.py` needed no change (confirmed, see Debug Log for its one pre-existing unrelated
  failure). `_CONFORMING_ADAPTER_SOURCE` in `test_skills.py` needed no change (its `velara_trace.client()`
  + `totals()` usage is the harmless adapter-set-usage case the runner still respects).
- **Gates**: `ruff check .` clean repo-wide. Full suite: 837 unit + 789 integration = 1626 passed, 3
  pre-existing skips, 1 pre-existing FAILURE unrelated to this diff (`test_config.py::
  test_default_value_is_false`, container-env leak — see Debug Log). `python scripts/export_openapi.py`
  → zero diff to `docs/api-spec.json` (confirmed via `git diff --exit-code`).
- **Zero product behavior change** confirmed: cost VALUE still flows through the unchanged
  `pricing.py`/envelope path; no other production file outside the story's declared surface was touched.
- **Scope boundary held**: no `get_current_run_tree()`/`to_headers()`/`from_headers()`/
  `tracing_context()`/`langsmith_run_id` write anywhere in the diff (verified by grep) — AD-7/Story 17-6
  territory was not entered. `pricing.py`, `execution_tasks.py`'s completion write, and
  `cost_is_estimated` were not touched (17-7 territory).

### File List

- `app/integrations/anthropic_client.py` (modified — wrap_anthropic seam, explicit LS client, run_kind param)
- `app/core/tracing.py` (deleted — 361 lines, whole file)
- `app/services/code_driven_executor.py` (modified — removed record_code_driven_span import+call; kept shim writer/env-injection/totals-injection; reworded one stale comment)
- `app/services/skill_integration_assistant.py` (modified — removed traced_run_kind import + 3 call sites; no prompt text changes needed)
- `app/services/sandbox_assets/velara_trace.py` (modified — bespoke span/stream classes deleted; rebuilt on wrap_anthropic with guarded import; usage accumulator/totals() kept)
- `tests/unit/core/test_tracing.py` (deleted)
- `tests/unit/services/test_velara_trace_shim.py` (rewritten — new tests for the slimmed shim)
- `tests/unit/integrations/test_anthropic_client.py` (rewritten — TestProviderTracing asserts wrap config, not RunTree; run_kind param added to all provider constructions)
- `tests/unit/services/test_code_driven_executor.py` (modified — removed dead span-emission test block + tracing import)
- `tests/unit/services/test_skill_integration_assistant.py` (modified — rewrote the run_kind-dependent test; FakeLLMProvider no longer reads the deleted ContextVar)

## Change Log

- 2026-07-30: Story drafted from STUB by create-story. Governing AD-2. Two operator decisions folded:
  slim-shim-keep-totals (interim cost preserved) + static-per-factory run_kind tags. Deletion surface,
  wrap_anthropic behavior, and the 17-5/17-6 boundary verified against live source + container-installed
  langsmith 0.10.10.
- 2026-07-30: Implemented Story 17.5. Deleted app/core/tracing.py (361 lines) and the sandbox
  velara_trace.py's bespoke span/stream classes; every Anthropic client now routes through
  langsmith.wrappers.wrap_anthropic with an explicit LangSmith Client (metadata-only PHI floor via
  hide_inputs/hide_outputs) and a static run_kind wrap-time tag (execution/adaptation), replacing the
  ContextVar. Sandbox shim slimmed to usage-accumulation + a guarded wrap_anthropic monkeypatch (falls
  back to untraced when langsmith is absent from the skill's own venv — it is never platform-injected).
  Zero product/cost-VALUE change. Gates: ruff clean, 1626/1627 tests passed (1 pre-existing, unrelated
  container-env failure), zero OpenAPI diff.
