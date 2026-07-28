---
baseline_commit: 6e1b4f7f9174dca0c1be2a90700379c6d30669a5
baseline_commit_note: velara-api head migration `0030_dry_run_config_study` (Story 17.3 code-review landed);
  velara-web on `development`. This is the SECOND Epic 17 story picked up (17.3 done, 17.1 now).
  Independent of 17.3 (zero shared files). 17.2 DEPENDS ON this story — do not start 17.2 until the
  tracing conventions here are settled. PREREQUISITE SATISFIED: the LangSmith ADR landed 2026-07-24
  (`architecture/core-architectural-decisions.md:304-333`) — this story implements that ADR verbatim,
  it does not re-decide it. Confirmed via grep across both subrepos + pyproject.toml + uv.lock: NO
  langsmith/langchain dependency exists today; this story introduces the first one.
---

# Story 17.1: LangSmith Tracing for Platform LLM Calls

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want every LLM call the platform itself makes to be traced in LangSmith with its own
cost/token/latency data — safely, so that trust-graded environments never leak prompt or response
content to a third-party SaaS,
so that I can inspect and cost individual calls (not just the per-execution aggregate Epic 15 already
stores) without introducing a PHI/IP breach in staging or prod.

## ⚠️ SCOPE — read this first

**Backend only (`velara-api`). No frontend, no new API surface, no client-facing change.** This is
pure instrumentation at the single LLM provider seam plus three new config settings.

**This story implements the LangSmith ADR verbatim — it does not re-decide anything.** The ADR
(`architecture/core-architectural-decisions.md:304-333`, "LLM-Call Observability — LangSmith as an
environment-graded secondary trace sink") already settled: config-gated + safe-by-default (Sentry
precedent), a per-environment content-verbosity switch that **defaults to metadata-only**, and a
**hard boot-time refusal** of full-content tracing outside `dev`. Your job is to build exactly that.
When the ADR and this story text ever seem to differ, the ADR governs — but they are aligned below.

**The single seam you instrument** (verified against source, do NOT hunt for others):
`app/integrations/anthropic_client.py` — `AnthropicProvider.complete(...)` (`:149-186`, returns
`LLMResult`) and `AnthropicProvider.create_message(...)` (`:188-235`, returns `LLMTurn`). Both call
`self._client.messages.create(...)`. Instrumenting these two methods covers **every** LLM call:
- execution prompt path: `execution_service._run_prompt` → `complete` (`execution_service.py:514-518`)
- execution hybrid path: `execution_service._run_hybrid` → `create_message`, **once per tool-use turn**
  (`execution_service.py:895-900`, inside the `HYBRID_MAX_TOOL_TURNS` loop) — one span per turn is the
  correct granularity
- adapter-propose/synthesis: `skill_integration_assistant.py` → `complete`, **3 call sites**
  (`:789-793`, `:880-885`, `:1087-1091`)

All of these receive the provider via the one `@lru_cache`'d factory
`get_llm_provider()` (`anthropic_client.py:238-247`) — through FastAPI DI (`dependencies.py:73`) and
the Celery worker (`execution_tasks.py:349`). There is no second construction path.

**Out of scope (do NOT touch):**
- **Story 17.2** (AI adapter emits LangSmith-traced *in-bundle* calls). This story traces the
  **platform's own** calls only. In-bundle sandbox calls (Epic 15.5 runtime) are 17.2's job and will
  inherit the exact `LANGSMITH_API_KEY` gate + `LANGSMITH_TRACE_CONTENT` grading you establish here.
  Do not modify `skill_integration_assistant.py`'s *authored bundle output* or the sandbox executor.
  (You DO trace `skill_integration_assistant`'s own `complete` calls — those are platform calls, not
  in-bundle calls. The distinction: the adapter *making* a call = platform (trace it); the bundle the
  adapter *writes* making a call at runtime = 17.2.)
- **Epic 15's stored cost.** Do NOT change, rename, or re-source `invocation_results.cost_usd` (15.1)
  or `AnalyticsOverview.token_cost` (15.3). LangSmith is observability *atop* the stored fact (ADR item
  1, AC4). The span's cost is *computed for the span* from the same `pricing.py` — it is not written
  back to any table.
- **Execution logic.** No change to `_run_prompt`/`_run_hybrid`/`execute_skill` behavior, control flow,
  token accumulation, or return values. Instrumentation wraps the provider call; it must be
  behaviorally transparent (a trace failure must never fail an LLM call — see AC2).
- The existing PHI-discipline log lines (`anthropic_client.py:178, 227`) — leave them exactly as-is;
  they are the very boundary this story must not cross.

## Acceptance Criteria

1. **AC1 — LangSmith is wired at the single LLM seam, emitting a metadata span per call.** Tracing is
   added at `app/integrations/anthropic_client.py` so every platform LLM call — `complete` (execution
   prompt + all 3 adapter-propose sites) and `create_message` (hybrid, per tool-use turn) — emits a
   LangSmith span (`run_type="llm"`) carrying: `model`, `input_tokens`, `output_tokens`, **latency**
   (newly measured — none is captured today), and **computed cost** obtained by reusing
   `app.core.pricing.compute_cost_usd(model=, input_tokens=, output_tokens=)` — NOT a second pricing
   source (mirrors 15.1/AC3). An unrecognized model yields `cost=None` on the span (never a fabricated
   `$0` — `compute_cost_usd` already returns `None`; carry that through, do not coalesce to 0).

2. **AC2 — Config-gated, safe-by-default; a trace failure never breaks a call.** LangSmith is enabled
   only when configured via env (`LANGSMITH_API_KEY` set AND `LANGSMITH_TRACING=true`); when
   unconfigured, the wrapper is a **no-op** and the platform runs exactly as today — no hard
   dependency, no startup failure, no behavior change (mirrors `init_sentry`'s
   `if not settings.SENTRY_DSN: return` precedent, `observability.py:34-35`). Additionally, any error
   raised by the LangSmith client (network failure, bad key, SaaS down) is **swallowed** — it must
   never propagate out of `complete`/`create_message` and fail an actual LLM execution. Additive
   instrumentation with **zero load-bearing dependency** (ADR item 1).

3. **AC3 — Content verbosity is environment-graded and defaults to metadata-only.** A new
   `LANGSMITH_TRACE_CONTENT` setting (default **`false`**) governs span payload:
   - **`false` (default, all environments):** the span carries metadata ONLY — model, token counts,
     latency, cost, outcome/stop_reason. It carries **NO** `system`, `user_content`, `messages`,
     `tools`, or response text. This is the floor.
   - **`true` (opt-in, `dev` ONLY):** the span additionally carries the full prompt/output content, for
     an engineer to inspect calls against synthetic dev data.
   The span inputs/outputs must be set **explicitly** by the wrapper (do not let a `@traceable`
   decorator auto-capture arguments — auto-capture would leak `system`/`user_content` by default,
   inverting the safety posture). Use `RunTree` (or `@traceable` with `process_inputs`/`process_outputs`
   redaction) so metadata-only is the *constructed* default and content is attached only in the
   explicitly-permitted branch.

4. **AC4 — Full-content in a trust-graded environment is refused at boot, not trusted to discipline.**
   The `_reject_insecure_defaults_outside_dev` model-validator (`config.py:281-328`) gains a new
   offender check: if `LANGSMITH_TRACE_CONTENT is True` while `ENVIRONMENT` is `staging` or `prod`, the
   settings object **raises at construction** (joining the existing `ANTHROPIC_API_KEY`/`SECRET_KEY`/…
   offenders list, `:319-320` idiom) — the app refuses to boot. Note the enum only has `dev`/`staging`/
   `prod` (there is **no** `local` value — a local Docker stack runs `ENVIRONMENT=dev`), so "dev-only"
   means literally `Environment.dev`. This is the whole safety argument (ADR item 4): full-content in
   prod is not a config option to be trusted, it is a state the code refuses to enter.

5. **AC5 — Additive to Epic 15 cost; nothing about stored cost/execution/analytics changes.** No change
   to `invocation_results.cost_usd`, `AnalyticsOverview.token_cost`, execution behavior, token
   accumulation, or any table/migration. Cost on the span is computed from the same `pricing.py` table
   for observability only. With LangSmith disabled/unconfigured/down, the entire system behaves
   byte-for-byte as before this story (ADR item 1; epic AC4).

6. **AC6 — New env vars are documented and the dependency is declared.** `langsmith` is added to
   `pyproject.toml` `[project].dependencies`; `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`,
   `LANGSMITH_TRACING`, and `LANGSMITH_TRACE_CONTENT` are documented in `.env.example` (new
   `# ── LangSmith tracing ──` section) and `.env.test`; and, because staging/prod would inject
   `LANGSMITH_API_KEY` via Secrets Manager like `ANTHROPIC_API_KEY`, a corresponding row is added to
   `terraform/README.md`'s secrets table (mirroring the `ANTHROPIC_API_KEY` row at
   `terraform/README.md:171`). CI's OpenAPI-diff job is unaffected (no route change) but must still pass.

## Tasks / Subtasks

- [x] **Task 1 — Config: three new settings + the boot-time full-content refusal (AC2, AC3, AC4)**
  - [x] In `app/core/config.py` `Settings` (pydantic v2 `BaseSettings`), add — grouped with a comment
    banner near the Anthropic block (`:207-222`):
    - `LANGSMITH_API_KEY: str = ""` (empty default; injected from Secrets Manager in staging/prod like
      `ANTHROPIC_API_KEY`)
    - `LANGSMITH_PROJECT: str = "velara"` (LangSmith project name; SDK default is `"default"` — set a
      Velara-specific default so unconfigured-but-keyed runs land somewhere sane)
    - `LANGSMITH_TRACING: bool = False` (master on-switch; maps to the SDK's `LANGSMITH_TRACING` env)
    - `LANGSMITH_TRACE_CONTENT: bool = False` (**MUST default false** — this default IS the safety floor,
      AC3/ADR item 4; do not default it true "for convenience")
  - [x] Extend `_reject_insecure_defaults_outside_dev` (`config.py:281-328`), AFTER the dev early-return
    (`:303-304 if self.ENVIRONMENT is Environment.dev: return self`), to append to `offenders`:
    ```python
    if self.LANGSMITH_TRACE_CONTENT:
        offenders.append(
            "LANGSMITH_TRACE_CONTENT (full-content tracing is forbidden in staging/prod — "
            "PHI/IP would leak to a third-party SaaS)"
        )
    ```
    This makes `Settings(ENVIRONMENT=staging, LANGSMITH_TRACE_CONTENT=True, ...)` raise, exactly like the
    `ANTHROPIC_API_KEY` gate at `:319-320`. Do NOT add the check before the dev early-return (dev must be
    allowed to set it true).
  - [x] Note the enum reality: `Environment` (`config.py:22-27`) is `dev`/`staging`/`prod` only. The
    ADR's "dev/local" = `Environment.dev`. No new enum value.

- [x] **Task 2 — The tracing wrapper: a config-gated, safe-by-default, content-graded LLM span (AC1, AC2, AC3)**
  - [x] Create a small tracing helper module — recommended `app/core/tracing.py` (co-located with
    `observability.py`, the pattern it mirrors), NOT inside `anthropic_client.py` (keep the SDK-import
    lazy and the provider file focused). It exposes ONE function the provider calls around each LLM call.
    Recommended shape (a context manager or a thin wrapper — dev's choice, but it MUST):
    - be a **no-op** unless `settings.LANGSMITH_TRACING and settings.LANGSMITH_API_KEY` (AC2). When off,
      do zero work and import nothing heavy.
    - lazily `import langsmith` only when enabled (mirror how `anthropic_client.__init__` and
      `observability.init_sentry` import their SDKs lazily — no top-level import that would load LangSmith
      in every process/test).
    - open a `RunTree(name=..., run_type="llm", project_name=settings.LANGSMITH_PROJECT, inputs=...)` and
      on completion `.end(outputs=...)` + `.post()`/`.patch()` (per the LangSmith SDK manual-tracing API,
      see Dev Notes). Prefer `RunTree` over the `@traceable` decorator precisely because `RunTree` lets
      you set `inputs`/`outputs` **explicitly** — the metadata-only default is then something you
      *construct*, not something you have to remember to strip (AC3).
    - **metadata always** on the span: `model`, `input_tokens`, `output_tokens`, `latency_ms`, `cost_usd`
      (as `str(Decimal)` or float — pick one, be consistent), `stop_reason`, and a `call_site` tag
      (`"complete"` vs `"create_message"`) so spans are filterable. Put token/cost/latency in the run's
      metadata/extra (LangSmith `usage_metadata` / `extra` — see Dev Notes) so they render as
      first-class fields, not buried in a JSON blob.
    - **content only when `settings.LANGSMITH_TRACE_CONTENT` is True** — attach `system`/`user_content`
      (or `messages`/`tools`) as `inputs` and response text as `outputs`. When false, set
      `inputs`/`outputs` to metadata-only dicts (e.g. `{"redacted": true}` or just the shapes/lengths) —
      **never the raw content**. This is the branch AC4 guards at boot.
    - **swallow all tracing errors** (AC2): wrap the span emission in `try/except Exception` and, on
      failure, log a structured warning (`langsmith_trace_failed`, IDs/model/outcome only — never
      content) and continue. A trace must NEVER fail an LLM call. Consider a module-level "already
      warned" guard to avoid log spam if LangSmith is down.
  - [x] Compute cost inside the wrapper via `from app.core.pricing import compute_cost_usd` — call
    `compute_cost_usd(model=result.model, input_tokens=..., output_tokens=...)`. Pass `None` through as
    `None` (unknown model → no cost on span; do NOT coalesce to 0 — the pricing memory note:
    None-as-$0 is the recurring bug class).
  - [x] Measure latency with `time.perf_counter()` around the actual `self._client.messages.create(...)`
    call (none is captured today — this is new; report `latency_ms`).

- [x] **Task 3 — Wire the wrapper into the provider's two methods (AC1)**
  - [x] In `AnthropicProvider.complete` (`anthropic_client.py:149-186`): wrap the
    `self._client.messages.create(...)` call so a span is emitted with `call_site="complete"`,
    `model=self._model`, tokens from `resp.usage.input_tokens/output_tokens`, `stop_reason`, latency, and
    cost. Content (only if `LANGSMITH_TRACE_CONTENT`): inputs `{system, user_content}`, output the
    extracted `output_text`. Return value (`LLMResult`) and all existing behavior/logging unchanged.
  - [x] In `AnthropicProvider.create_message` (`:188-235`): same, `call_site="create_message"`, tokens
    from `resp.usage`, content (if permitted) inputs `{system, messages, tools}`, output `resp.content`
    (stringified). Because `_run_hybrid` calls this once per tool-use turn, one span per turn is emitted
    — correct granularity.
  - [x] Do NOT change the provider's construction, the `get_llm_provider()` `@lru_cache` factory
    (`:238-247`), or the injected `LLMProvider` Protocol surface. The `FakeLLMProvider` test doubles do
    not go through `messages.create`, so they naturally emit no spans — no test-double change needed for
    tracing (they may need the new settings present; see Task 5).
  - [x] Confirm the adapter-propose path is covered transitively: `skill_integration_assistant.py`'s 3
    `complete` calls go through this same method — no edit to that file is required for them to be traced.

- [x] **Task 4 — Dependency + env/secrets documentation (AC6)**
  - [x] Add `langsmith` to `pyproject.toml` `[project].dependencies` (pin a current version — see Dev
    Notes; check `uv.lock` regenerates cleanly). This is a genuinely new dependency — none of
    langsmith/langchain exists today.
  - [x] Add a `# ── LangSmith tracing ──` section to `.env.example` documenting all four vars, each with
    a comment: `LANGSMITH_API_KEY=` (blank in dev = tracing off; Secrets Manager in staging/prod),
    `LANGSMITH_PROJECT=velara`, `LANGSMITH_TRACING=false`, and `LANGSMITH_TRACE_CONTENT=false` with an
    explicit **"dev ONLY — the app refuses to boot in staging/prod if true"** warning comment.
  - [x] Add the same four vars to `.env.test` (all off/false — tests must run with tracing disabled by
    default so no test hits the network).
  - [x] Add a `LANGSMITH_API_KEY` row to `terraform/README.md`'s secrets table (mirror the
    `ANTHROPIC_API_KEY` row at `:171`: secret name e.g. `velara-<env>-langsmith-api-key`, description
    "Optional — enables LangSmith LLM-call tracing; metadata-only in staging/prod").

- [x] **Task 5 — Tests (AC1–AC5) — establishing NEW test patterns (none exist for config/observability)**
  - [x] **Config boot-refusal test (AC4) — NEW pattern.** No `test_config.py` exists today. Create
    `tests/unit/core/test_config.py`. Assert:
    - `Settings(ENVIRONMENT="staging", LANGSMITH_TRACE_CONTENT=True, <other required staging fields>)`
      raises `pydantic.ValidationError` (pydantic wraps the `model_validator` `ValueError`), and the
      message mentions `LANGSMITH_TRACE_CONTENT`. Use the established `pytest.raises(ValidationError)`
      idiom (precedent: `tests/unit/test_consumes_validation.py:44-45`). You must supply the OTHER
      staging offenders (SECRET_KEY, DATABASE_URL, STORAGE_BACKEND, S3_ENDPOINT_URL, SECRETS_BACKEND,
      AUTH_BACKEND, ANTHROPIC_API_KEY, BUNDLE_SIGNING_KEY) with valid non-default values so the ONLY
      offender is `LANGSMITH_TRACE_CONTENT` — otherwise the test passes for the wrong reason. Read
      `_reject_insecure_defaults_outside_dev` (`config.py:281-328`) fully to enumerate them.
    - `Settings(ENVIRONMENT="prod", LANGSMITH_TRACE_CONTENT=True, ...)` likewise raises.
    - `Settings(ENVIRONMENT="dev", LANGSMITH_TRACE_CONTENT=True)` does NOT raise (dev is allowed).
    - `Settings(ENVIRONMENT="staging", LANGSMITH_TRACE_CONTENT=False, ...valid...)` does NOT raise for
      this reason (default is safe in every env).
  - [x] **Wrapper no-op test (AC2).** In `tests/unit/core/` (new `test_tracing.py`): with
    `LANGSMITH_TRACING=false` (or `LANGSMITH_API_KEY=""`), calling the wrapper does nothing, imports no
    langsmith client, and returns/behaves transparently. Mirror how celery-app tests assert reload-time
    behavior with patched settings (`test_celery_app.py:25-35`). Do NOT hit the network.
  - [x] **Wrapper content-gating test (AC3).** With the wrapper ENABLED but `LANGSMITH_TRACE_CONTENT=false`,
    patch the langsmith `RunTree` (mock it) and assert the `inputs`/`outputs` passed to it contain NO
    `system`/`user_content`/`messages`/response text — only metadata (model, tokens, latency, cost,
    stop_reason). With `LANGSMITH_TRACE_CONTENT=true` (dev), assert content IS present. This is the core
    safety test — make it unambiguous.
  - [x] **Wrapper error-swallow test (AC2).** With tracing enabled, make the mocked `RunTree.post()` (or
    `.end`) raise; assert the wrapper swallows it and the LLM call's return value is unaffected (no
    exception propagates). Prove a trace failure can't break execution.
  - [x] **Provider-integration test (AC1).** Extend `tests/unit/integrations/test_anthropic_client.py`
    (existing SDK-patch style, `_make_sdk_response` at `:12-27`, `patch("anthropic.Anthropic", ...)`).
    With tracing enabled and `RunTree` mocked, call `AnthropicProvider.complete(...)` and assert a span
    was emitted with the expected metadata (model, tokens from the fake `resp.usage`, cost via the real
    `compute_cost_usd`, a `call_site="complete"` tag). Do the same for `create_message`
    (`call_site="create_message"`). Assert cost is `None` (not 0) when the fake response's model is
    unknown to `pricing.py`.
  - [x] **Cost-source test (AC1/AC5).** Assert the span's cost equals `compute_cost_usd(model, in, out)`
    for a known model — i.e. it uses the one pricing source, not a second computation. (Pricing test
    conventions: `tests/unit/core/test_pricing.py`.)

- [x] **Task 6 — Gates (Enforcement Rule 10)**
  - [x] `ruff check .` clean (line-length 100, `select=["E","F","I","B","UP","W"]`). Watch E501 on any
    new long comment lines (Rule 10's exact past failure).
  - [x] `pytest` — full suite green against a fresh `velara_test` DB in the same environment CI uses (not
    a stale local container). Confirm the new `langsmith` dependency is installed in that env.
  - [x] `python scripts/export_openapi.py && git diff --exit-code docs/api-spec.json` — must be a no-op
    (this story adds no route; if `api-spec.json` changes, something leaked into the API surface — stop
    and investigate). This is a CI job (`ci.yml:20-39`).
  - [x] Do NOT commit `velara-api` from this story (never-push-subrepos rule) — only `code-review`
    commits subrepos, post-review. Only the top-level docs repo is committed by `dev-story`.

## Dev Notes

### Why this is a thin instrumentation story, not an execution change

Every platform LLM call already funnels through ONE seam —
`AnthropicProvider._client.messages.create(...)`, reached only via `complete` (`anthropic_client.py:149-186`)
and `create_message` (`:188-235`). This was verified exhaustively: `_run_prompt`→`complete`,
`_run_hybrid`→`create_message` (per turn), and `skill_integration_assistant`'s 3 `complete` sites all
go through the injected `LLMProvider`, and the provider is built by exactly one `@lru_cache`'d factory
`get_llm_provider()` (`:238-247`). So wrapping those two methods covers 100% of platform LLM calls with
no per-call-site edits. There is no direct `messages.create` anywhere in the services.

### The safety inversion that makes this a real design task, not just "wire the SDK" (from the ADR)

LangSmith's *entire value* is capturing the two arguments to the call — `system` (Vitalief skill
instructions = **IP**) and `user_content`/`messages` (assembled inputs + protocol documents = **PHI**)
— plus the response. Those are *exactly* the values the codebase has a hard, repeated rule never to let
escape (`anthropic_client.py:178`: `# Never log system/user_content/output_text (potential PHI)`;
`:227`: `# Never log messages / tools / resp.content (potential PHI/IP)`). This is a HIPAA + 21 CFR
Part 11 platform (SEC-04: *"PHI is never written to URLs, log lines, or error messages… enforced at the
platform layer"*). You cannot `sanitize_phi` your way to a useful *and* safe LLM trace — redact the
prompt/output and there's nothing left to inspect. Hence the ADR's answer: **metadata-only is the
floor; full content is a deliberate `dev`-only exception, refused at boot elsewhere.** Build that
posture as the *constructed default* (explicit `RunTree` inputs/outputs), never as a strip-after-the-fact
hook that a future edit could forget.

### The Sentry precedent — right shape, mirror it

`observability.init_sentry` (`observability.py:25-58`) is the exact pattern for a config-gated external
telemetry sink: `if not settings.SENTRY_DSN: return` (no-op when unconfigured, `:34-35`),
`send_default_pii=False` (`:56`), `_before_send=sanitize_phi` on egress, and lazy SDK import inside the
function. LangSmith reuses this *shape* — config-gated, safe-by-default, lazy import. The ONE inversion:
Sentry's PHI is *incidental* (rides in a stack trace, scrubbable), LangSmith's PHI/IP is the *primary
payload* — so instead of a scrub-on-egress hook, you choose content vs metadata up-front. That's why
`LANGSMITH_TRACE_CONTENT` exists and why AC4 hard-refuses it in trust-graded envs.

### LangSmith SDK — the manual-tracing API to use (NO LangChain)

Add `langsmith` only (NOT `langchain` — none of it is here and none is needed; the platform uses the
`anthropic` SDK directly). Trace manually, without LangChain:
- **Env the SDK reads:** `LANGSMITH_API_KEY`, `LANGSMITH_TRACING=true` (master switch), `LANGSMITH_PROJECT`
  (defaults `"default"`). Unconfigured → the SDK sends nothing. Our own `settings.LANGSMITH_*` mirror
  these; gate the wrapper on our settings so behavior is testable without real env, and (recommended)
  set the SDK env from settings at init OR pass `api_key`/`project_name` explicitly to `RunTree`.
- **`RunTree` (preferred here):**
  ```python
  from langsmith.run_trees import RunTree
  run = RunTree(name="anthropic.complete", run_type="llm",
                project_name=settings.LANGSMITH_PROJECT,
                inputs={...})       # metadata-only OR content, per LANGSMITH_TRACE_CONTENT
  run.post()
  # ... make the real messages.create call, time it ...
  run.end(outputs={...})           # metadata-only OR content
  run.patch()
  ```
  `RunTree` is preferred over the `@traceable` decorator BECAUSE it takes `inputs`/`outputs`
  **explicitly** — the metadata-only default is constructed, not stripped. If you instead use
  `@traceable`, you MUST pass `process_inputs=`/`process_outputs=` redactors so it never auto-captures
  `system`/`user_content` — auto-capture is the trap AC3 warns against.
- **Token/cost/latency fields:** attach token counts + cost as run `extra`/metadata (LangSmith supports
  `usage_metadata` / `extra` on a run). Verify the exact field name against the installed version's API
  when implementing — the goal is that model/tokens/latency/cost render as inspectable fields; the exact
  key is an implementation detail, the *contract* (those five metadata fields present, always) is AC1.
- **No-op + error-swallow:** if `not (settings.LANGSMITH_TRACING and settings.LANGSMITH_API_KEY)`, don't
  even import `langsmith`. If enabled but the SDK raises, swallow and warn (AC2). LangSmith batches/posts
  in a background thread by default, but do NOT rely on that for safety — wrap explicitly.

### Reuse map (do NOT rebuild)

- **`app.core.pricing.compute_cost_usd(model=, input_tokens=, output_tokens=)`** (`pricing.py:68-92`) —
  the ONE cost source. Returns `Decimal | None`; `None` for unknown model (never a fabricated default).
  Reuse verbatim for the span cost; carry `None` through as `None`.
- **`init_sentry`** (`observability.py:25-58`) — the config-gated / lazy-import / safe-by-default shape
  to mirror for the tracing wrapper.
- **`resp.usage.input_tokens` / `resp.usage.output_tokens` / `resp.stop_reason`** — already extracted in
  both provider methods (`:168-170`, `:213-215`); reuse those exact values for the span, don't re-derive.

### Testing standards

- Backend: pytest (`asyncio_mode="auto"`), co-located `tests/unit/...` mirroring `app/...`. No
  config/observability test exists today — Task 5 establishes those files (`tests/unit/core/test_config.py`,
  `tests/unit/core/test_tracing.py`). The staging/prod boot-refusal is tested by constructing `Settings(...)`
  and asserting `pydantic.ValidationError` (pydantic wraps the `model_validator` `ValueError`) — precedent
  `tests/unit/test_consumes_validation.py:44-45`. To isolate the `LANGSMITH_TRACE_CONTENT` offender you MUST
  supply all other staging offenders as valid (read `config.py:281-328` for the full list) or the test
  passes for the wrong reason.
- Provider tests: extend `tests/unit/integrations/test_anthropic_client.py` — it already patches
  `anthropic.Anthropic` and builds fake responses via `_make_sdk_response` (`:12-27`). Add a mocked
  `RunTree` and assert span contents. `FakeLLMProvider` doubles (`test_execution_service.py:85-120`)
  bypass `messages.create` entirely, so service/API tests emit no spans and need no change — but they run
  with tracing OFF (`.env.test` all-false), which is the point of AC2.
- Enforcement Rule 10 (`implementation-patterns-consistency-rules.md:150-158`): CI green before any push
  to `development` — `ruff check .` + `pytest` in the SAME env CI uses, plus the OpenAPI-diff job
  (`ci.yml:20-39`) which must stay a no-op since this story adds no route. A "gates green" note is not a
  substitute for actually re-running against the pushed commit; whoever pushes (`code-review`) confirms
  `gh run watch` is green.
- Enforcement Rules 4/5/8 also apply: structured logging with `request_id` (never raw content — the trace
  wrapper's warning logs IDs/model/outcome only, never PHI/IP); no raw exception messages to callers (the
  wrapper swallows tracing errors internally). Rule 8's "one shared PHI sanitizer" ethos is honored here by
  *not sending content at all* in trust-graded envs, rather than sanitizing it.

### Environment reality check (do not assume a "local" env exists)

`Environment` (`config.py:22-27`) has exactly three values: `dev`, `staging`, `prod`. There is NO `local`.
A local Docker stack runs `ENVIRONMENT=dev` and only overrides `SENTRY_ENVIRONMENT="local"` for tagging.
So the ADR's "dev/local ONLY" full-content mode maps to `Environment.dev` — that's the only env where
`LANGSMITH_TRACE_CONTENT=true` is permitted; staging and prod refuse it at boot (AC4).

### Git / build context

- `velara-api`: head migration `0030_dry_run_config_study` (post-17.3 code-review). This story adds NO
  migration (no schema change). Do NOT commit `velara-api` from `dev-story` (never-push-subrepos rule).
- `velara-web`: `development` — untouched by this story (backend-only).
- Only the top-level docs repo is committed by `dev-story`.

### Project Structure Notes

- New file: `app/core/tracing.py` (co-located with `observability.py`; the wrapper + no-op gate + lazy
  langsmith import). New tests: `tests/unit/core/test_config.py`, `tests/unit/core/test_tracing.py`;
  extended `tests/unit/integrations/test_anthropic_client.py`.
- Modified: `app/core/config.py` (4 settings + validator offender), `app/integrations/anthropic_client.py`
  (wrap the two `messages.create` calls), `pyproject.toml` (`langsmith` dep), `.env.example`, `.env.test`,
  `terraform/README.md`.
- No new API surface, no migration, no client-facing change, no new dependency beyond `langsmith`.

### References

- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#L304-333] — the
  LangSmith ADR this story implements verbatim (config-gated secondary sink; environment-graded verbosity;
  metadata-only floor; boot-time full-content refusal outside dev; cost from `pricing.py`; 17.2 inherits).
- [Source: _bmad-output/planning-artifacts/epics/epic-17-observability-and-certification-evidence.md#Story-17.1] —
  parent epic-level AC contract (lines 13-33); this story's AC1-AC5 expand the epic's AC1-AC4, with AC6
  added for dependency/env/secrets documentation.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-24.md#L222-253] — the
  correct-course that created Epic 17 / Story 17.1 (request 4).
- [Source: _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md#5.11] —
  USE-10 (this story's FR): config-gated, environment-graded, metadata-only-in-prod LLM-call observability.
- [Source: _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/5-functional-requirements.md#5.12] —
  SEC-04 (PHI never in logs/URLs/errors — the platform-layer rule the metadata-only floor honors).
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md#L137-163] —
  Enforcement Rules 1-10; Rule 8 (shared PHI sanitizer / Sentry before_send) and Rule 10 (CI-green-before-push).
- [Source: velara-api/app/integrations/anthropic_client.py#L149-186] — `AnthropicProvider.complete`; the
  `messages.create` call to wrap; `resp.usage`/`stop_reason` extraction; PHI-log rule at `:178`.
- [Source: velara-api/app/integrations/anthropic_client.py#L188-235] — `AnthropicProvider.create_message`;
  per-turn hybrid call to wrap; PHI/IP-log rule at `:227`.
- [Source: velara-api/app/integrations/anthropic_client.py#L238-247] — `get_llm_provider()` `@lru_cache`
  factory (the single provider construction path; all call sites go through it).
- [Source: velara-api/app/core/config.py#L281-328] — `_reject_insecure_defaults_outside_dev` validator; dev
  early-return at `:303`; `ANTHROPIC_API_KEY` offender at `:319-320` (the exact idiom AC4 extends).
- [Source: velara-api/app/core/config.py#L22-27] — `Environment` enum (`dev`/`staging`/`prod` only, no `local`).
- [Source: velara-api/app/core/observability.py#L25-58] — `init_sentry`: DSN-gated no-op, `send_default_pii=False`,
  `_before_send`/`sanitize_phi`, lazy SDK import — the shape the tracing wrapper mirrors.
- [Source: velara-api/app/core/pricing.py#L68-92] — `compute_cost_usd(model=, input_tokens=, output_tokens=)`
  → `Decimal | None`; the ONE cost source; `None` (never 0) for unknown model.
- [Source: velara-api/app/services/execution_service.py#L514-518] — `_run_prompt` → `complete` call site
  (covered transitively).
- [Source: velara-api/app/services/execution_service.py#L895-902] — `_run_hybrid` → `create_message` per
  tool-use turn (one span per turn).
- [Source: velara-api/app/services/skill_integration_assistant.py#L789-793,L880-885,L1087-1091] — the 3
  adapter-propose/synthesis `complete` sites (covered transitively; do NOT edit for THIS story — 17.2 owns
  the in-bundle authoring change).
- [Source: velara-api/tests/unit/integrations/test_anthropic_client.py#L12-40] — SDK-patch test convention
  (`_make_sdk_response`, `patch("anthropic.Anthropic", ...)`) to extend for span-emission tests.
- [Source: velara-api/tests/unit/services/test_execution_service.py#L85-120] — `FakeLLMProvider` double
  (bypasses `messages.create`, emits no span, needs no change).
- [Source: velara-api/tests/unit/workers/test_celery_app.py#L25-35,L91] — reload-with-patched-settings +
  `pytest.raises(ValueError)` convention for config-time behavior.
- [Source: velara-api/tests/unit/test_consumes_validation.py#L44-45] — `pytest.raises(ValidationError)`
  precedent for a pydantic validator (the boot-refusal test form).
- [Source: velara-api/tests/conftest.py#L33-55] — session-wide env override (how `Settings()` picks up test
  env before `app.*` import); `.env.test` all-tracing-off keeps tests offline.
- [Source: velara-api/.github/workflows/ci.yml#L10-18,L20-39,L41-129] — CI jobs: `ruff check .`, OpenAPI
  diff (must stay no-op), `pytest` with Postgres/Redis/MinIO, `ENVIRONMENT=dev`.
- [Source: velara-api/.env.example, .env.test, terraform/README.md#L171] — env/secret documentation targets
  for the four new `LANGSMITH_*` vars (mirror the `ANTHROPIC_API_KEY` Secrets Manager row).
- [Source: LangSmith Python SDK — https://github.com/langchain-ai/langsmith-sdk/blob/main/python/README.md] —
  manual `RunTree(run_type="llm")` tracing without LangChain; `LANGSMITH_API_KEY`/`LANGSMITH_TRACING`/
  `LANGSMITH_PROJECT` env; unconfigured = no-op; explicit `inputs`/`outputs` for content control.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — dev-story implementation 2026-07-28.

### Debug Log References

- **LangSmith SDK API verified before coding.** Pinned `langsmith==0.10.10` (latest). Confirmed the
  `RunTree` manual-tracing surface in an isolated venv: `RunTree(name, run_type="llm",
  project_name=..., inputs=..., tags=..., extra=...)` → `.post()` / `.end(outputs=...)` / `.patch()`.
  `project_name` maps to `session_name`; token/cost/latency metadata rides in `extra["metadata"]` and
  renders as first-class run fields. No LangChain needed (platform calls the anthropic SDK directly).
- **OpenAPI-diff gate — TRUE no-op for this story, but surfaced a PRE-EXISTING 17.3 drift.**
  Re-running `scripts/export_openapi.py` produces a 685-line diff — verified `grep` shows **0**
  langsmith/tracing lines; the entire diff is Story 17.3's dry-run certification routes/schemas that
  17.3's code-review never regenerated into the committed `docs/api-spec.json`. Reverted the spec to
  baseline (17.1 adds no API surface, and dev-story must not commit subrepo files); logged the 17.3
  drift + the two pre-existing `test_certifications.py` E501s (fixed inline so Rule 10 is green) to
  `deferred-work.md` for the next pusher/code-review.
- **Integration-suite env trap (cost ~2 wasted full runs).** The running `velara-api` docker `api`
  container is configured for cloud-dev: its `/app/.env` has `AUTH_BACKEND=cognito`, and `conftest.py`
  only forces `DATABASE_URL`. A bare `docker compose exec api pytest` → **626 failures**, all
  `401 Unauthorized` (dev-JWT tokens rejected under cognito). Proved it was NOT my change by
  reproducing identically on the pristine baseline `config.py`. Correct CI-equivalent invocation:
  `sh -c 'cd /app && set -a && . ./.env.test && set +a && pytest'` (exports `.env.test`'s
  `AUTH_BACKEND=dev` etc. to override `.env`). A polluted shared `velara_test` DB also failed one
  no-time-window audit-count test (`test_repeated_denials_are_deduped`: got 4, want 1); recreated the
  DB clean (`DROP/CREATE DATABASE velara_test`) → conftest re-ran migrations → full suite **1618
  passed, 3 skipped, 0 failed**. Saved to memory as `project-velara-api-container-test-env`.
- **Gates (Rule 10), final:** `ruff check .` clean across the whole repo; full pytest suite
  1618 passed / 3 skipped / 0 failed on a fresh `velara_test` DB with `langsmith==0.10.10` installed;
  OpenAPI spec unchanged by this story (no route added).

### Completion Notes List

- **Implemented the LangSmith ADR verbatim — pure additive instrumentation, zero execution change.**
  All 6 tasks complete, all 6 ACs satisfied. New `app/core/tracing.py` exposes one context manager
  `trace_llm_call(call_site=...)` that the provider wraps around each real `messages.create` call; the
  provider records result metadata (and content, unconditionally) onto the yielded span, and the
  wrapper decides content-vs-metadata + emits/​swallows. Wired into both `AnthropicProvider.complete`
  (`call_site="complete"`) and `.create_message` (`call_site="create_message"`); the 3
  `skill_integration_assistant` adapter-propose `complete` sites are covered transitively (no edit).
- **AC1 (span + one cost source):** every platform call emits a `run_type="llm"` span carrying
  model, input/output tokens, newly-measured `latency_ms` (via `time.perf_counter()`), `stop_reason`,
  `call_site`, and cost computed from the SAME `app.core.pricing.compute_cost_usd` Epic 15 uses.
- **AC2 (config-gated, safe-by-default, non-load-bearing):** no-op unless
  `LANGSMITH_TRACING and LANGSMITH_API_KEY` (mirrors `init_sentry`'s DSN gate; imports no langsmith
  when off). All tracing errors are swallowed in `_emit_span` (try/except + warn-once) so a trace
  failure can never fail an LLM call — proven by the error-swallow tests at both wrapper and provider
  level.
- **AC3 (content grading, constructed default):** metadata-only is the *constructed* default via
  explicit `RunTree` inputs/outputs (`{"redacted": true}`); raw `system`/`user_content`/`messages`/
  `tools`/response text attach ONLY when `LANGSMITH_TRACE_CONTENT` is true. Test cross-checks the
  sensitive strings appear NOWHERE in the emitted payload when content is off.
- **AC4 (boot refusal):** `_reject_insecure_defaults_outside_dev` gains a `LANGSMITH_TRACE_CONTENT`
  offender AFTER the dev early-return, so `Settings(ENVIRONMENT=staging|prod,
  LANGSMITH_TRACE_CONTENT=True)` raises `ValidationError` while dev is allowed — full-content in a
  trust-graded env is a state the app refuses to boot into, not a config trusted to discipline.
- **AC5 (additive to Epic 15):** no change to `invocation_results.cost_usd`,
  `AnalyticsOverview.token_cost`, execution behavior, token accumulation, or any table/migration. Cost
  on the span is `None` (never fabricated `$0`) for an unknown model — carried through from
  `compute_cost_usd` (guards the recurring None-as-$0 bug class). **Every cost figure the app shows
  today is byte-for-byte unchanged whether LangSmith is on, off, or down.**
- **AC6 (dep + docs):** `langsmith==0.10.10` added to `pyproject.toml` (uv.lock regenerated cleanly);
  four `LANGSMITH_*` vars documented in `.env.example` (new section, with the dev-only boot-refusal
  warning) and `.env.test` (all off); `LANGSMITH_API_KEY` secrets row added to `terraform/README.md`.
- **Test patterns established (none existed):** new `tests/unit/core/test_config.py` (boot-refusal,
  supplies all OTHER staging offenders as valid so LANGSMITH_TRACE_CONTENT is the sole offender) and
  `tests/unit/core/test_tracing.py` (no-op, content-gating, error-swallow, cost-source); extended
  `tests/unit/integrations/test_anthropic_client.py` with 5 span-emission tests. 29 new/extended tests,
  all green.
- **Not committed (never-push-subrepos):** all `velara-api` changes stay uncommitted for `code-review`
  to commit post-review. Only the top-level docs repo is committed by dev-story.

- Ultimate context engine analysis completed - comprehensive developer guide created. This story
  implements a pre-existing, prescriptive ADR (LangSmith environment-graded trace sink, 2026-07-24) at a
  single verified LLM seam (`AnthropicProvider.complete`/`create_message`). Two independent research
  passes confirmed: the seam is the only LLM call path, no langsmith/langchain dependency exists today,
  no config/observability test file exists (new patterns established), and the `Environment` enum has no
  `local` value (so "dev-only" full-content = `Environment.dev`). The two design decisions the ADR
  already made — metadata-only floor as a *constructed* default (not a strip-hook) and boot-time refusal
  of full-content outside dev — are encoded as AC3/AC4 with explicit test coverage, not left ambiguous.

### File List

All paths under `velara-api/` (backend-only; NOT committed by dev-story — code-review commits post-review):

**New:**
- `app/core/tracing.py` — the config-gated, content-graded LangSmith tracing wrapper (`trace_llm_call`).
- `tests/unit/core/test_config.py` — boot-refusal tests (AC4) — new file, no `test_config.py` existed.
- `tests/unit/core/test_tracing.py` — wrapper no-op / content-gating / error-swallow / cost-source tests.

**Modified:**
- `app/core/config.py` — 4 new `LANGSMITH_*` settings + the `LANGSMITH_TRACE_CONTENT` boot-refusal
  offender in `_reject_insecure_defaults_outside_dev`.
- `app/integrations/anthropic_client.py` — import `trace_llm_call`; wrap the two `messages.create`
  calls in `complete` / `create_message` and record span metadata + content.
- `pyproject.toml` — add `langsmith==0.10.10` to `[project].dependencies`.
- `uv.lock` — regenerated (langsmith + transitive deps: orjson, requests, requests-toolbelt,
  uuid-utils, xxhash, zstandard).
- `.env.example` — new `# ── LangSmith tracing ──` section documenting all four vars.
- `.env.test` — the four vars, all off/false (tests never hit the network).
- `terraform/README.md` — `LANGSMITH_API_KEY` row added to the secrets table.
- `tests/unit/integrations/test_anthropic_client.py` — +5 span-emission tests (`TestProviderTracing`).
- `tests/integration/api/test_certifications.py` — re-wrapped 2 pre-existing over-long docstrings
  (`:1012`, `:1025`) so `ruff check .` is green (Rule 10). PRE-EXISTING from Story 17.3 — no behavior
  change; see `deferred-work.md`.

**Docs repo (committed by dev-story):**
- `_bmad-output/implementation-artifacts/stories/17-1-langsmith-tracing-for-platform-llm-calls.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 17.1 → in-progress → review.
- `_bmad-output/implementation-artifacts/deferred-work.md` — logged pre-existing 17.3 OpenAPI-spec
  drift + the two 17.3 E501s.

## Change Log

- 2026-07-28 — Implemented (dev-story). All 6 tasks / 6 ACs complete. New `app/core/tracing.py`
  (`trace_llm_call` context manager) wired into `AnthropicProvider.complete` / `.create_message`;
  4 `LANGSMITH_*` settings + boot-time full-content refusal in `config.py`; `langsmith==0.10.10` dep;
  env/secrets docs. 29 new/extended tests. Gates green in the CI-equivalent env: ruff clean, full
  pytest 1618 passed / 3 skipped / 0 failed (fresh `velara_test` DB, `.env.test` sourced), OpenAPI
  spec unchanged by this story. Additive to Epic 15 stored cost — every cost figure in the app is
  unchanged whether LangSmith is on/off/down. Status → review.
- 2026-07-27 — Drafted (create-story). Backend-only instrumentation story implementing the 2026-07-24
  LangSmith ADR: a config-gated, safe-by-default, environment-graded tracing wrapper at the single LLM
  provider seam (`complete`/`create_message`), emitting per-call spans with model/tokens/latency/cost
  (cost reused from `pricing.py`, `None` for unknown model), content attached ONLY when
  `LANGSMITH_TRACE_CONTENT=true` and ONLY in `dev` (staging/prod refuse it at boot via the existing
  insecure-defaults validator). Additive to Epic 15 stored cost; no execution change, no migration, no
  API surface, no frontend. New `langsmith` dependency + `.env.example`/`.env.test`/`terraform` docs.
  Depends-on for 17.2 (in-bundle tracing inherits this story's conventions); independent of 17.3.
