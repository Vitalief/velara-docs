---
baseline_commit: 7dd75cf83ae55da98cdfc251d9335ba379fb594f
---

# Story 3.5: Hybrid Skill Execution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to execute hybrid skills where Claude orchestrates the execution and calls Python tools,
so that complex methodology requiring both LLM reasoning and deterministic computation can be expressed as a single skill.

This story fills the **`hybrid` branch** of the `execution_service` runtime router (3.3 built prompt, 3.4 built code; both currently route `hybrid` → `UnsupportedRuntimeError`). Hybrid composes the two existing seams: it runs a **manual Claude tool-use loop** (3.3's `LLMProvider`, extended to pass `tools=` and handle `tool_use`/`tool_result`) where each tool call executes a skill-defined Python function inside a **persistent tool-server subprocess** built on the hardened 3.4 sandbox. It does **not** implement branded output (3.6), fan-out (3.7), or the connector/credential framework (3.8). See **Scope Boundary**.

**Two design decisions (made at story-creation, 2026-06-11):**
1. **Tool declaration → structured multi-part artifact.** A hybrid skill's artifact is **JSON** (a manifest separating `system` prompt + `tools` defs + `code`), distinguished by its `SkillVersion.content_type` (e.g. `application/vnd.velara.hybrid+json`). This is implemented **inside the existing artifact blob** — no skill-model column, no migration — but it **does** introduce the first structured artifact format, which 3.3 explicitly deferred. The format is defined here and must stay backward-compatible with prompt/code (which remain opaque text). See Dev Notes → "Hybrid artifact format".
2. **Tool execution → persistent tool-server subprocess.** One long-lived sandboxed child is spawned per invocation; it loads the skill code once, then services tool calls over a bidirectional protocol on the trusted control channel for the whole conversation. More efficient than per-call cold-start and supports shared in-process state across tool calls — but it is a **substantial new sandbox mode** layered on 3.4's primitives. See Dev Notes → "Persistent tool-server".

## Acceptance Criteria

1. **(Hybrid routing → Claude with tools)** Given a skill with `runtime_type: "hybrid"` is invoked, when the Celery `run_skill` task dispatches it, then `execution_service` routes to the **hybrid runtime**, which parses the structured artifact, starts a persistent tool-server subprocess for the skill's code, and makes a Claude API call with `tools=` definitions **matching the skill's declared code helpers**. [Source: epics/epic-3-skill-execution-engine.md#Story 3.5]

2. **(Tool-use loop)** Given Claude returns a `tool_use` block during execution, when the hybrid runtime processes it, then the named Python function is **called in the tool-server with the provided arguments**, the result is returned to Claude as a `tool_result` (matching `tool_use_id`), and execution continues until Claude stops requesting tools (`stop_reason != "tool_use"`). [Source: epic-3 AC; claude-api tool-use-concepts.md — manual agentic loop]

3. **(Tool error → is_error tool_result)** Given a hybrid skill's tool call raises a Python exception, when the exception is caught, then a **structured error** is returned to Claude as a `tool_result` with `is_error: true` (PHI-safe — no raw traceback to Claude/caller/logs); Claude can handle or propagate it gracefully. The job does **not** fail merely because one tool raised — only an unrecoverable loop/transport failure fails the job. [Source: epic-3 AC; claude-api — error handling in tool results]

4. **(Result stored, completed, audit with call chain)** Given a hybrid skill execution completes, when it finishes, then Claude's final text output is written to the **output bucket** as an S3 object, `output_file_key` + `result_metadata` are stored in `invocation_results`, the job transitions to `completed`, and the audit entry records `runtime_type: "hybrid"` with the **full call chain** (LLM → tool calls → results → final output) captured for audit — without PHI/tool-argument content. [Source: epic-3 AC; PRD EXE-04/USE-01; SEC-04]

5. **(Loop bounded, sandbox + network discipline preserved)** Given a hybrid invocation, when the tool-use loop runs, then it is bounded by a maximum number of turns (`max_tool_turns`) and the overall sandbox/Celery timeout ordering; tool code runs under the **same isolation + network block** as the code runtime (network blocked unless permitted via the connector framework — Story 3.8); and a non-terminating loop fails with a stable `error_code` rather than hanging. [Source: epic-3#Story 3.4 sandbox; epic-3#Story 3.8; PRD EXE-05; stories/3-4 timeout-ordering]

6. **(IP protection — output only)** Given a client-scoped caller invokes a hybrid skill, when the response is returned, then only the final output text + output file references are exposed — the skill's system prompt, tool definitions, tool code, tool arguments, and intermediate tool results are **never** returned by any API surface, log, or error. [Source: epic-3 Story 3.3 AC3 analog; PRD ACL-03/05; SEC-04]

## Tasks / Subtasks

- [x] **Task 1 — Hybrid config settings (AC: 5) — [config.py](../../../velara-api/app/core/config.py)**
  - [x] Add (Field-validated, mirroring the `EXECUTION_*`/`ANTHROPIC_*` precedent): `HYBRID_MAX_TOOL_TURNS: int = Field(default=20, gt=0, le=100)` (max Claude↔tool round trips before failing the loop) and `HYBRID_TOOL_CALL_TIMEOUT_S: int = Field(default=60, gt=0)` (per-tool-call wall-clock cap inside the tool-server). **Coupling guard:** the whole hybrid run still lives under the existing `run_skill` Celery `soft_time_limit=1260/time_limit=1320`; document that `HYBRID_MAX_TOOL_TURNS × (HYBRID_TOOL_CALL_TIMEOUT_S + typical Claude latency)` must stay below the soft limit, and that the tool-server's lifetime is bounded by `EXECUTION_TIMEOUT_S` (1200) as a hard ceiling. See Dev Notes → "Timeout accounting".
  - [x] **No new dependency** — `anthropic==0.50.0` already supports `tools=`/`tool_use`; sandbox is stdlib. **No migration** — head stays `0008_invocation_job_inputs` (the structured artifact rides the existing blob + `content_type`).

- [x] **Task 2 — Hybrid artifact parsing `app/services/hybrid_artifact.py` (AC: 1)** — NEW
  - [x] Define + parse the structured hybrid artifact. Public: `parse_hybrid_artifact(raw: bytes) -> HybridManifest` where `HybridManifest` is a Pydantic model: `system: str`, `code: str`, `tools: list[ToolDef]`; `ToolDef = {name: str, description: str, input_schema: dict}`. Validate: ≥1 tool; every `tool.name` is a valid Python identifier; `input_schema` is a JSON-Schema object (`type: "object"`, `properties`, `required`). See Dev Notes → "Hybrid artifact format" for the exact JSON shape and validation rules.
  - [x] Raise `InvalidHybridArtifactError` (422, `INVALID_HYBRID_ARTIFACT`) on any malformed manifest — message generic (no artifact content echoed). This is detected at **runtime** (the artifact is opaque to the registry); a future Story 2.x certification step could validate at authoring time (flag, don't build).
  - [x] **Build Anthropic tool definitions** from `manifest.tools`: a helper `to_anthropic_tools(manifest) -> list[dict]` producing `[{"name", "description", "input_schema"}, ...]` exactly as the SDK expects. [Source: claude-api tool-use-concepts.md#Tool Definition Structure]

- [x] **Task 3 — Persistent tool-server in the sandbox `app/services/code_sandbox.py` (AC: 2, 3, 5) — MODIFY (additive)**
  - [x] **Do NOT modify** `run_sandboxed`, `SandboxResult`, `_apply_rlimits`, `_HARNESS`, `_CappedReader`, or the network-block/control-channel logic — the code runtime depends on them. **Add** a new persistent mode alongside them.
  - [x] Add `class ToolServer` (a context manager) that spawns one long-lived sandboxed child via the **same** `subprocess.Popen` hardening as `run_sandboxed` (`-I`, `start_new_session=True`, scrubbed env, `cwd=tempdir`, `preexec_fn=_apply_rlimits`, `pass_fds` for the control pipe, network block installed in the harness before skill code). The child loads `manifest.code` once, exposing its top-level functions, then enters a **request loop**: read a framed JSON request `{"tool": name, "args": {...}}` on an input channel → call the named function → write a framed JSON response `{"ok": true, "result": <json>}` or `{"ok": false, "error": "<safe msg>"}` on an output channel. See Dev Notes → "Persistent tool-server" for the harness loop + framing protocol.
  - [x] `ToolServer.call_tool(name: str, args: dict, timeout_s: int) -> ToolCallResult` — sends one request, reads one response under a per-call wall-clock timeout. On timeout/child-death → mark the server dead and surface a `ToolServerError` (the runtime turns it into an `is_error` tool_result for that turn, or fails the job if the server is unrecoverable). On a tool raising inside the child → the child catches it, returns `{"ok": false, "error": <sanitized>}` (never the raw traceback over the wire), and the loop continues (AC3).
  - [x] **Reuse the trusted-control-channel discipline:** the child must not be able to forge a "tool result" that the runtime can't distinguish from a crash — frame every message with a length prefix and validate it; a malformed/short frame or closed pipe = server-dead, not a silent success. Mirror the 3.4 "completed token written last / can't be forged by the skill" invariant. [Source: stories/3-4 Review Patches #8/#9 — trusted inherited-pipe control channel]
  - [x] **Lifecycle:** `__enter__` spawns + waits for a readiness token (child signals "ready" after loading `code` successfully; a `code` that raises at import → `ToolServerError`/`INVALID_HYBRID_ARTIFACT`-adjacent failure before any Claude call). `__exit__` closes the input pipe, waits with a bounded `proc.wait(timeout=5)`, then `os.killpg(SIGKILL)` + `shutil.rmtree(tempdir)` — **always**, even on exception. Cap total server lifetime at `EXECUTION_TIMEOUT_S`.

- [x] **Task 4 — Extend `LLMProvider` for tool use `app/integrations/anthropic_client.py` (AC: 1, 2) — MODIFY (additive)**
  - [x] **Do NOT change** the existing `complete(*, system, user_content, max_tokens) -> LLMResult` method or `LLMResult` — `_run_prompt` (3.3) depends on them unchanged. **Add** a new method to the `LLMProvider` Protocol + `AnthropicProvider`: `create_message(*, system: str, messages: list[dict], tools: list[dict], max_tokens: int) -> LLMTurn` where `LLMTurn` is a dataclass `(content: list, stop_reason: str|None, input_tokens: int, output_tokens: int, model: str)` carrying the **raw `response.content` blocks** (needed to append assistant turns and read `tool_use` blocks) and `stop_reason`. See Dev Notes → "LLMProvider tool-use extension".
  - [x] The `AnthropicProvider.create_message` calls `client.messages.create(model=, max_tokens=, system=, messages=, tools=)` — **still NO `temperature`/`top_p`/`top_k`/`budget_tokens`** (400 on Opus 4.x). Return `resp.content` verbatim (list of blocks), `resp.stop_reason`, usage. **PHI:** log only model/tokens/stop_reason/tool-call **count** — never message content or tool args. [Source: anthropic_client.py#94-132; claude-api models.md Opus-4.x forbidden params]
  - [x] Extend `FakeLLMProvider` (test double) to implement `create_message` with a scripted sequence of turns (text turn → tool_use turn → final text turn) so the loop is unit-testable without a network call. See Dev Notes → "Testing the loop".

- [x] **Task 5 — Hybrid runtime in `execution_service.py` (AC: 1, 2, 3, 4, 6) — MODIFY**
  - [x] In `execute_skill(...)`, **replace** the `raise UnsupportedRuntimeError(runtime_type)` fall-through with `if runtime_type == "hybrid": return await _run_hybrid(...)`, keeping any future runtimes → `UnsupportedRuntimeError`. **Do not touch** the working `prompt`/`code` branches. [Source: execution_service.py#112-134]
  - [x] Add `async def _run_hybrid(*, session, job, skill, llm_provider, skill_storage, output_storage) -> tuple[str, dict]` with full agentic loop, tool dispatch, output write, and call-chain metadata.
  - [x] **`result_metadata` (AC4 call-chain, PHI-safe):** `{"format":"text","char_count":N,"model":...,"runtime":"hybrid","tool_turns":K,"tool_calls":[{"name":..,"is_error":bool,"duration_ms":..}, ...],"input_tokens":sum,"output_tokens":sum,"stop_reason": final}` — names + outcomes + counts only, **never** tool args or results.
  - [x] Define exceptions: `HybridLoopError` (422, `HYBRID_LOOP_EXHAUSTED`), `HybridToolServerError` (422, `HYBRID_TOOL_SERVER_ERROR`). `InvalidHybridArtifactError` in `hybrid_artifact.py`.

- [x] **Task 6 — Error-code mapping `app/workers/execution_tasks.py` (AC: 5) — MODIFY**
  - [x] Add constants `ERROR_CODE_INVALID_HYBRID_ARTIFACT`, `ERROR_CODE_HYBRID_LOOP_EXHAUSTED`, `ERROR_CODE_HYBRID_TOOL_SERVER_ERROR` (alongside the 3.3/3.4 constants). In `_map_error_code(...)`, added `isinstance` branches → these codes, **before** the anthropic block. Anthropic SDK errors raised by `create_message` inside the loop still map via the existing branches — **left unchanged**.

- [x] **Task 7 — Tests (AC: all)**
  - [x] **FLIP the existing test** `test_hybrid_runtime_raises_unsupported` → `test_hybrid_runtime_routes_to_run_hybrid`. Prompt/code tests untouched.
  - [x] Unit `tests/unit/services/test_hybrid_artifact.py`: valid manifest parses; missing `tools`/bad identifier/non-object `input_schema` → `InvalidHybridArtifactError`; `to_anthropic_tools` shape matches the SDK contract. (17 tests, all pass)
  - [x] Unit `tests/unit/services/test_execution_service.py` (hybrid branch): loop calls tool + appends result, tool error → `is_error` + continues, loop exhaustion → `HybridLoopError`, file_ref_id → `build_context_input`, IP protection. (5 new tests, all pass)
  - [x] Unit `tests/unit/services/test_code_sandbox.py` (**Docker/Linux-only**): ToolServer round-trip, tool raising → `is_error`, shared state, network block, timeout kills server, dead server subsequent call raises, lifecycle/orphan reap, bad code at import → `ToolServerError`. (11 new tests, all pass in Docker)
  - [x] Unit `tests/unit/workers/test_execution_tasks.py`: 3 hybrid error codes map correctly; existing anthropic/code mappings unchanged. (5 new tests, all pass)
  - [x] Integration `tests/integration/api/test_invocations.py`: hybrid happy-path (completed + output + audit runtime_type=hybrid + call-chain metadata), IP-protection (no system/code/args in GET /jobs response), 202 POST path. (3 new tests, all pass)
  - [x] **Gates:** `ruff check .` clean AND **383/383 Docker suite green**. No real Anthropic network calls in CI.

### Review Findings

_Code review 2026-06-11 (3-layer adversarial: Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 6 ACs substantively satisfied. 15 findings survive triage (4 dismissed as noise). No Critical findings._

_**Resolution (2026-06-11):** 3 decisions resolved → 2 became patches + 1 doc-relax; **all 10 patches applied & verified**; 3 deferred (logged to deferred-work.md). Gates: `ruff check .` clean, **389/389 Docker suite green** (+6 new regression tests: empty-output fail, max_tokens fail, allow-list reject, tool_turns count, duplicate-name reject, empty-output error-code map). New error code `HYBRID_EMPTY_OUTPUT`; config now fails fast if `HYBRID_MAX_TOOL_TURNS × HYBRID_TOOL_CALL_TIMEOUT_S > EXECUTION_TIMEOUT_S`._

**Decision-needed — RESOLVED 2026-06-11 (all 3 → patch):**

- [x] [Review][Decision→Patch] Empty/`max_tokens`-truncated final text silently written as a 0-byte "completed" output. **Resolved: fail on empty OR max_tokens.** Raise a new `HybridEmptyOutputError` (422, `HYBRID_EMPTY_OUTPUT`) when `final_text.strip()` is empty OR `final_stop_reason == "max_tokens"`. (See patch list below.)
- [x] [Review][Decision→Patch] Tool dispatch not restricted to declared manifest tools. **Resolved: enforce allow-list.** Validate `block.name` against `{t.name for t in manifest.tools}` in `_run_hybrid`; an undeclared name → recoverable `is_error` tool_result. (See patch list below.)
- [x] [Review][Decision→Doc] `input_schema.required` validated only when present. **Resolved: relax the Dev Note** (no code change). Anthropic treats `required` as optional; the lenient validator is correct. Dev Notes "Hybrid artifact format" wording adjusted accordingly.

**Patch (unambiguous fixes):**

- [x] [Review][Patch] Empty/`max_tokens`-truncated final text → fail with `HYBRID_EMPTY_OUTPUT` (from resolved decision #1) — after the loop, if `final_text.strip() == ""` OR `final_stop_reason == "max_tokens"`, raise `HybridEmptyOutputError` (422, `HYBRID_EMPTY_OUTPUT`) instead of writing a 0-byte output + `completed`. Add the error code + `_map_error_code` branch. [execution_service.py:560-611; execution_tasks.py] (blind+edge)
- [x] [Review][Patch] Enforce manifest tool allow-list at dispatch (from resolved decision #2) — in `_run_hybrid`, compute `_allowed = {t.name for t in manifest.tools}`; if `block.name not in _allowed`, append an `is_error` tool_result ("Unknown tool.") and continue (recoverable) rather than calling `server.call_tool`. [execution_service.py:507-519] (blind)
- [x] [Review][Patch] Zero `tool_use` blocks with `stop_reason == "tool_use"` → empty `content: []` user message → Anthropic 400 — If Claude returns `stop_reason == "tool_use"` but no block has `type == "tool_use"`, `tool_results` stays `[]` and `messages.append({"role": "user", "content": []})` runs; the next `create_message` 400s (empty content array), surfacing as a raw `BadRequestError` mapped to `PROMPT_EXECUTION_ERROR` rather than a hybrid error. Guard: if no tool_use blocks were processed, break/treat as terminal (or skip the empty append). [execution_service.py:507-555] (blind+edge)
- [x] [Review][Patch] Per-call timeout never kills the child — `_recv_frame` timeout sets `self._dead = True` and raises `ToolServerError` but never calls `_killpg`; the runaway/sleeping child runs unkilled until `__exit__`/`_shutdown`. The module/class docstrings and the test name `test_tool_timeout_kills_server_raises_tool_server_error` claim a kill-at-timeout, but the test only asserts the raise (no `poll()`/`returncode` check) so it passes anyway. Fix: `_killpg(self._proc)` on the timeout path (and harden the test to assert the child is dead). [code_sandbox.py:737-776, 306-313] (blind)
- [x] [Review][Patch] `HYBRID_TOOL_CALL_TIMEOUT_S` has no upper bound and the loop has no aggregate wall-clock cap — `Field(default=60, gt=0)` with no `le=`, unlike `EXECUTION_TIMEOUT_S` (`le=1200`) and `HYBRID_MAX_TOOL_TURNS` (`le=100`). The `ToolServer` lifetime check is a *pre-call* gate, so a call begun at elapsed≈1199s can still block for the full per-call timeout; and even at defaults `20 × 60s = 1200s` of tool time + Claude latency can exceed Celery `soft_time_limit=1260`, firing `SoftTimeLimitExceeded` mid-loop instead of a hybrid error_code. Fix: add an `le=` bound to `HYBRID_TOOL_CALL_TIMEOUT_S` (e.g. `le=EXECUTION_TIMEOUT_S`-aligned) and/or a model-validator coupling the product to the soft limit, and/or an aggregate deadline in the loop. [config.py:124-127; code_sandbox.py:806-813] (blind+edge)
- [x] [Review][Patch] Duplicate tool names accepted by `parse_hybrid_artifact` → Anthropic 400 mis-mapped to `PROMPT_EXECUTION_ERROR` — validation is per-tool only; two tools named `a` parse fine, then `to_anthropic_tools` emits duplicate names which the API rejects (400) inside the loop. Operator sees an LLM error for a malformed artifact. Fix: add a cross-tool uniqueness check raising `InvalidHybridArtifactError`. [hybrid_artifact.py `_validate_manifest`] (edge)
- [x] [Review][Patch] `_json_safe` emits `NaN`/`Infinity`/`-Infinity` (invalid JSON) into tool_result content — `json.dumps(value)` defaults to `allow_nan=True`; a tool returning `nan`/`inf` (or a structure containing one) yields the non-strict-JSON tokens `NaN`/`Infinity` in the `tool_result.content` sent to Claude. The in-child harness `json.dumps` has the same default, so it isn't normalized there either. Fix: `allow_nan=False` (or sanitize) and handle the resulting error as an `is_error` result. [execution_service.py `_json_safe`] (blind+edge)
- [x] [Review][Patch] Dead `try/except Exception: raise` wrapper around the agentic loop — both `except (HybridLoopError, HybridToolServerError, InvalidHybridArtifactError): raise` and `except Exception: raise` are no-ops; `InvalidHybridArtifactError` is also raised *before* the guarded `run_in_threadpool` call, so it can never come out of that block. Misleading dead code. Fix: remove the wrapper (or make it do real work — wrap/log). [execution_service.py:582-595] (blind+auditor)
- [x] [Review][Patch] `tool_turns` counts assistant messages, not Claude↔tool round trips — `len([m for m in messages if m["role"] == "assistant"])` overcounts by one on the happy path (1 tool turn + 1 final turn = 2 assistant messages). `tool_calls` is accurate; `tool_turns` is misleading for AC4 audit. Fix: count tool-bearing turns (or rename the field). [execution_service.py:579] (auditor)
- [x] [Review][Patch] `if free_inputs:` drops falsy-but-present inputs and stringifies the dict with Python `str()` — `{}`, `0`, `""`, `False` are silently skipped; a present `inputs` dict is interpolated via `f"[Inputs]\n{free_inputs}"` (Python `str()`, single-quoted) rather than the JSON form. Fix: use `if free_inputs is not None:` and `json.dumps(free_inputs)` for a clean representation to the model. [execution_service.py:464-466] (blind)

**Deferred (logged to deferred-work.md):**

- [x] [Review][Defer] No size cap on tool-result content fed back into the conversation — a multi-MB tool return is appended to `messages` and re-sent on every subsequent turn (whole `messages` resent each `create_message`) → quadratic token growth / 413 / cost blowup. Bounded only by the 16MB frame cap. Needs a result-size policy (truncate + flag); deferred — requires design (truncation strategy + signalling to Claude). [execution_service.py:535] (blind)
- [x] [Review][Defer] `_send_frame` write has no timeout — a very large `block.input` plus a wedged child (not back at `_recv`) can block `os.write` on a full request pipe indefinitely, hanging the worker thread (only the read side is deadline-protected). Typical args are small; deferred — needs a non-blocking/`select`-bounded write path. [code_sandbox.py:722-735] (blind)
- [x] [Review][Defer] Diff bundles all of Story 3.4 (`code_sandbox.py`, `_run_code`, Celery decorator 1260/1320, `EXECUTION_*` config) as NEW — baseline `7dd75cf` has no `code_sandbox.py`, so 3.4's code rides along uncommitted in this review. Not a 3.5 code defect; a process/scope-hygiene note. Deferred — confirm 3.4 was never committed and commit/separate appropriately. [code_sandbox.py (whole file); execution_service.py `_run_code`; execution_tasks.py decorator] (auditor)

## Dev Notes

### Scope Boundary (read this first)

- **In scope:** the `hybrid` branch of `execute_skill` (`_run_hybrid`); the structured hybrid artifact format + parser (`hybrid_artifact.py`); the persistent `ToolServer` sandbox mode (additive to `code_sandbox.py`); the `LLMProvider.create_message` tool-use extension (additive to `anthropic_client.py`); the manual agentic loop; hybrid config + error codes; audit call-chain metadata. Reuses the 3.1/3.3/3.4 job/result/audit lifecycle and the runtime-agnostic invocation endpoint **unchanged**.
- **Out of scope (do NOT build — collides with later stories / other epics):**
  - **Branded output** (PDF/PPTX/DOCX/XLSX, `output_tasks.py`) → **Story 3.6**. Hybrid writes **plain text** (Claude's final output), same as prompt/code. [Source: epic-3#163-193]
  - **Location fan-out** → **Story 3.7** (after Epic 4). Leave `fan_out`/`invocation_id` at defaults. [Source: epic-3#197-199]
  - **Per-skill network permitting / external credentials** (`requires:[...]`, Secrets Manager, `MISSING_CREDENTIAL`, connectors) → **Story 3.8**. Tools run with the **same all-network-blocked** sandbox as code; the block is the seam 3.8 opens. [Source: epic-3#233-251]
  - **Kernel-level isolation** (nsjail/gVisor/seccomp/netns, `RLIMIT_NPROC`/fork-block, restricting importable modules) → **Epic 7**. The `ToolServer` inherits 3.4's documented Phase-1 limits (a `ctypes`→libc bypass / fork-bomb is out of scope, noted in code). [Source: stories/3-4 Deferred]
  - **Authoring-time hybrid-artifact validation** (registry/certification rejecting a malformed manifest at create/version time) → **Story 2.x / 6.x (certification)**. 3.5 validates at **runtime** only and fails the job with `INVALID_HYBRID_ARTIFACT`. Flag as an open item; do not modify the skill-create/version contract. [Source: stories/3-3 "structured artifact format … is Story 2.x territory; do not invent here" — 3.5 introduces the format minimally + runtime-only, per the 2026-06-11 decision]
  - **SDK tool-runner / programmatic tool calling / server-side tools** (code_execution, web_search) → not used. We run a **manual** agentic loop against **user-defined** tools executed in our own sandbox (HIPAA: tool code is the skill's, runs on our infra, no Anthropic-side execution). [Source: claude-api tool-use-concepts.md — manual loop vs tool runner; server-side tools]

### What 3.3/3.4 already built that 3.5 reuses (do NOT re-implement or break)

- **`execute_skill` router** — add one `hybrid` branch. **`_run_prompt`/`_run_code` untouched.** [execution_service.py#112-134]
- **`run_skill` task** — unchanged (decorator 1260/1320, success/failure seam, fresh-session handler, `_get_runtime_type` → `"hybrid"` audit automatic). Only `_map_error_code` gains hybrid codes. [execution_tasks.py#47-156,251-303]
- **Invocation endpoint** — runtime-agnostic, **no change**. [invocations.py#66-168]
- **Sandbox primitives** — `subprocess.Popen` hardening, `_apply_rlimits`, network block, trusted control pipe, `_CappedReader`, bounded reaps. `ToolServer` **reuses** these; it does not fork its own hardening. [code_sandbox.py]
- **`LLMProvider`/`AnthropicProvider`/`get_llm_provider()`** — `complete()` unchanged; add `create_message`. [anthropic_client.py]
- **`build_context_input`**, **`job_service` lifecycle**, **`audit_service.record_entry`** (`runtime_type="hybrid"` already valid). **Migration head `0008` — no new migration.** [ingest_service; job_service; audit_service; migrations/versions]

### Hybrid artifact format (the new structured artifact — keep backward-compatible)

A hybrid skill's `SkillVersion` artifact is **JSON** (not opaque text). It is distinguished by `content_type` — use a **distinct** value, e.g. `application/vnd.velara.hybrid+json` (or `application/json`); prompt/code keep their existing text content types and the **opaque-blob** treatment. `_run_hybrid` parses; `_run_prompt`/`_run_code` are unchanged, so **no regression** for them. The artifact stays a single blob at `artifact_key` — **no skill-model column, no migration**; `Skill.input_schema`/`output_schema` (existing JSONB) are skill-level I/O, **not** per-tool — tool defs live in the manifest. [Source: skill_service.py#242-249,433-437 artifact = `content.encode()` + `content_type`; models/skill.py#69-70,151]

```json
{
  "system": "You are a clinical-data analyst. Use the provided tools to compute.",
  "tools": [
    {
      "name": "compute_enrollment_rate",
      "description": "Compute monthly enrollment rate. Call when the user asks for enrollment velocity.",
      "input_schema": {
        "type": "object",
        "properties": { "site_id": {"type": "string"}, "months": {"type": "integer"} },
        "required": ["site_id"]
      }
    }
  ],
  "code": "def compute_enrollment_rate(site_id, months=12):\n    ...\n    return {...}"
}
```

- **Validation (`parse_hybrid_artifact`):** valid JSON object; `system: str` (may be ""), `code: str` (non-empty), `tools: list` (≥1); each tool `name` a valid Python identifier **and** a top-level callable defined in `code` (the runtime can defer the "callable exists" check to the tool-server readiness handshake — a missing function surfaces when the server loads `code`); `description: str`; `input_schema` a JSON-Schema object (`type:"object"`, has `properties`; `required` is an **optional** `list` — validated only when present, matching Anthropic's tool-schema semantics where `required` may be omitted for no-required-arg tools [relaxed per code review 2026-06-11]). Reject extra/missing keys with `InvalidHybridArtifactError` (generic message — never echo artifact content).
- **`to_anthropic_tools(manifest)`** → `[{"name": t.name, "description": t.description, "input_schema": t.input_schema} for t in manifest.tools]` — the exact SDK tool shape. [Source: claude-api tool-use-concepts.md#Tool Definition Structure]

### Persistent tool-server (the new sandbox mode)

One sandboxed child per invocation, reusing **all** of 3.4's `Popen` hardening (`-I`, scrubbed env, `cwd=tempdir`, `start_new_session=True`, `preexec_fn=_apply_rlimits`, network block in the harness, `pass_fds`). Differences from `run_sandboxed`:

- **It is long-lived and bidirectional.** Instead of "read stdin once → exec → write stdout once", the tool-server harness: installs the network block; `exec`s `manifest.code` into a namespace; signals **readiness** on the control pipe (if `code` raises at import → write a `LOAD_FAILED` token, exit → runtime raises `ToolServerError` before any Claude call); then loops: read a **length-prefixed JSON frame** request from an input fd → look up `namespace[req["tool"]]` → call with `**req["args"]` → write a length-prefixed JSON frame response. A tool raising is caught **inside the child**: respond `{"ok": false, "error": <type-name only, sanitized>}` (never the traceback) so the loop continues (AC3). On unknown tool / malformed frame → `{"ok": false, "error": "..."}`.
- **Framing protocol (anti-forgery):** every message is `<4-byte big-endian length><utf-8 JSON>`. The parent validates the length and JSON; a short read, bad length, or closed pipe = **server-dead** → `ToolServerError` (the runtime can't be tricked into reading a partial/forged frame as success — mirrors 3.4's "can't forge the OK token"). Keep the request/response channels **separate from stdout** (use dedicated inherited fds via `pass_fds`, like 3.4's control pipe) so skill `print()`/library noise on stdout can't corrupt the protocol. [Source: stories/3-4 Review Patch #8/#9 trusted control channel]
- **Per-call timeout:** `call_tool(..., timeout_s=HYBRID_TOOL_CALL_TIMEOUT_S)` reads the response under a wall-clock bound (the parent waits on the pipe with a timeout; on expiry → kill the group, mark server dead, `ToolServerError`). `RLIMIT_CPU` in the child is a backstop; the authoritative cap is the parent's read-timeout, same philosophy as `run_sandboxed`.
- **Lifecycle (context manager):** `__enter__` spawn + readiness wait; `__exit__` close input pipe → bounded `proc.wait(timeout=5)` → `killpg(SIGKILL)` → `rmtree(tempdir)` — **always**, even on exception, even on loop error. Total server lifetime capped at `EXECUTION_TIMEOUT_S` (1200) as the hard ceiling regardless of turn count.
- **Shared state:** because the child persists, tool calls share module-level state (a deliberate benefit of this design vs per-call cold-start). Document that tools may rely on in-process state across calls within one invocation, but **never** across invocations (a fresh server per job).

### LLMProvider tool-use extension (additive)

```python
@dataclass
class LLMTurn:
    content: list          # raw response.content blocks (text + tool_use) — append verbatim to messages
    stop_reason: str | None
    input_tokens: int
    output_tokens: int
    model: str

class LLMProvider(Protocol):
    def complete(self, *, system, user_content, max_tokens) -> LLMResult: ...   # UNCHANGED (3.3)
    def create_message(self, *, system: str, messages: list[dict],
                       tools: list[dict], max_tokens: int) -> LLMTurn: ...        # NEW (3.5)
```

`AnthropicProvider.create_message`: `resp = client.messages.create(model=, max_tokens=, system=, messages=messages, tools=tools)` → `LLMTurn(content=resp.content, stop_reason=resp.stop_reason, ...usage..., model=self._model)`. **No** `temperature`/`top_p`/`budget_tokens`. **PHI:** never log `messages`/`tools`/`resp.content`; log model, token counts, stop_reason, and the **number** of `tool_use` blocks. [Source: anthropic_client.py#94-132; claude-api models.md]

### The agentic loop (manual — AC2/AC3)

Canonical manual loop (run the blocking LLM + sandbox calls via `run_in_threadpool` inside the async `_run_hybrid`):

```python
messages = [{"role": "user", "content": user_content}]
tools = to_anthropic_tools(manifest)
for turn_i in range(settings.HYBRID_MAX_TOOL_TURNS):
    turn = llm_provider.create_message(system=manifest.system, messages=messages, tools=tools, max_tokens=...)
    messages.append({"role": "assistant", "content": turn.content})   # MUST append full content (preserves tool_use blocks)
    if turn.stop_reason != "tool_use":
        break                                                          # done → final text in turn.content
    tool_results = []
    for block in turn.content:
        if getattr(block, "type", None) != "tool_use":
            continue
        try:
            res = server.call_tool(block.name, block.input, settings.HYBRID_TOOL_CALL_TIMEOUT_S)
            tool_results.append({"type": "tool_result", "tool_use_id": block.id,
                                 "content": _json_safe(res), "is_error": False})
        except ToolFailed as e:                                        # tool raised in child (recoverable)
            tool_results.append({"type": "tool_result", "tool_use_id": block.id,
                                 "content": "Tool execution failed.", "is_error": True})   # PHI-safe msg
    messages.append({"role": "user", "content": tool_results})         # all results in ONE user message
else:
    raise HybridLoopError()                                            # exhausted max turns still wanting tools
final_text = "".join(b.text for b in messages[-1]["content"] if getattr(b, "type", None) == "text") \
             if isinstance(messages[-1]["content"], list) else ...     # extract from last assistant turn
```

- **Always append the full `turn.content`** before handling tools, and **return every `tool_result` with the matching `tool_use_id`** in a single user message — required by the API or it 400s. [Source: claude-api tool-use-concepts.md#Manual Agentic Loop]
- **`is_error: true`** on a tool that raised (child returns `{"ok": false}`) — Claude adapts; the **job does not fail** (AC3). Only an unrecoverable `ToolServerError` (server dead/timeout/forged frame) or loop exhaustion fails the job.
- **Multiple `tool_use` blocks in one turn** are possible — handle **all** before continuing (the loop above does).
- Distinguish `ToolFailed` (tool raised, recoverable → `is_error` result) from `ToolServerError` (transport/timeout/dead → fail job). `call_tool` raises the right one.

### Timeout accounting (AC5) — three layers now

- **Per tool call:** `HYBRID_TOOL_CALL_TIMEOUT_S` (60) — parent read-timeout on the tool-server pipe.
- **Whole tool-server lifetime:** `EXECUTION_TIMEOUT_S` (1200) hard ceiling (same as code runtime).
- **Whole task:** Celery `soft_time_limit=1260 < time_limit=1320` (unchanged from 3.4). `SoftTimeLimitExceeded` already maps to `EXECUTION_TIMEOUT` (3.4 patch). **Budget rule:** `HYBRID_MAX_TOOL_TURNS × (HYBRID_TOOL_CALL_TIMEOUT_S + Claude latency)` must stay < 1260; with defaults (20 × ~60s tool + ~latency) this is tight — document that operators tuning these must preserve `… < soft_time_limit`. Claude API calls inside the loop carry their own `ANTHROPIC_TIMEOUT_S` (120) + SDK retries. [Source: execution_tasks.py decorator; config.py; stories/3-4 timeout-ordering]

### IP protection & PHI (AC6 — load-bearing)

- Structurally enforced: `InvocationResult` carries only `output_file_key` + `result_metadata` (names/counts, **no** args/results). The manifest (`system`/`tools`/`code`), tool arguments, and intermediate tool results are used in the loop and **discarded** — never persisted, logged, or returned. Errors are `{code,message,request_id}` envelopes; `is_error` tool_result content is a generic "Tool execution failed." (no traceback to Claude either). [Source: PRD ACL-03/05, SEC-04; stories/3-3 IP-protection notes]

### Running tests (Docker source baked, not mounted)

- **No new dep / no migration** → rebuild only because source is baked: `docker compose build api worker && docker compose up -d`. Confirm head: `alembic heads` → `0008_invocation_job_inputs`. [Source: 3.1–3.4 PITFALL]
- Unit (loop/artifact, no real subprocess/network): patch `ToolServer` + scripted `FakeLLMProvider`. Unit (tool-server): **Docker/Linux-only** (`skipif(sys.platform != "linux")`, POSIX sandbox), short timeouts. [Source: stories/3-4 platform caveat]
- Integration: `docker compose exec api pytest tests/integration/api/test_invocations.py`; mock LLM; `_drive_execution` helper (avoids the `asyncio.run()`-in-task vs pytest-loop clash — 3.3/3.4 learning); reuse `dispose_engine_after_test`, `_auth_headers`, `_create_skill_in_db`. [Source: stories/3-3/3-4 Debug Log; test_invocations.py]
- Lint: `ruff check .` (line-length 100, `E,F,I,B,UP,W`, `B008` ignored).

### Project Structure Notes

| File | Action | Purpose |
|------|--------|---------|
| `app/core/config.py` | MODIFY | `HYBRID_*` settings (Field-validated) |
| `app/services/hybrid_artifact.py` | NEW | `parse_hybrid_artifact`, `HybridManifest`/`ToolDef`, `to_anthropic_tools`, `InvalidHybridArtifactError` |
| `app/services/code_sandbox.py` | MODIFY (additive) | `ToolServer` persistent mode + framing protocol; **`run_sandboxed` et al. untouched** |
| `app/integrations/anthropic_client.py` | MODIFY (additive) | `create_message` + `LLMTurn`; **`complete`/`LLMResult` untouched** |
| `app/services/execution_service.py` | MODIFY | `hybrid` branch + `_run_hybrid` + hybrid exceptions; **prompt/code untouched** |
| `app/workers/execution_tasks.py` | MODIFY | 3 hybrid error codes + `_map_error_code` branches; **decorator/seam untouched** |
| `tests/unit/services/test_hybrid_artifact.py` | NEW | manifest parse/validation |
| `tests/unit/services/test_execution_service.py` | MODIFY | flip `test_hybrid_runtime_raises_unsupported`; add hybrid-loop tests |
| `tests/unit/services/test_code_sandbox.py` | MODIFY | `ToolServer` round-trip / error / timeout / reap (Docker-only) |
| `tests/unit/workers/test_execution_tasks.py` | MODIFY | hybrid error-code mapping |
| `tests/integration/api/test_invocations.py` | MODIFY | hybrid happy-path + IP-protection (mocked LLM) |

Architecture names the `execution_service.py` (prompt/code/hybrid router) and `anthropic_client.py` (proxy) slots — this story populates the hybrid path. `hybrid_artifact.py` is a net-new private helper under `services/` (no named slot; consistent with `code_sandbox.py` in 3.4). **No new model/migration/endpoint/dependency.** [Source: architecture/Velara-Architecture-full.md#401,550]

### References

- [Source: epics/epic-3-skill-execution-engine.md#Story 3.5] — story + all 4 epic ACs (route to hybrid with tool defs matching code helpers; `tool_use` → call function → `tool_result` → continue; tool exception → `is_error` tool_result; audit `runtime_type="hybrid"` + full call chain).
- [Source: epics/epic-3-skill-execution-engine.md#Story 3.4/3.6/3.7/3.8] — sandbox isolation reused; output/fan-out/connectors out of scope.
- [Source: prds/.../5-functional-requirements.md] — EXE-03 (hybrid = LLM orchestrates, calls code helpers as tools, "Anthropic SKILL.md pattern"), EXE-04/USE-01 (execution logged), EXE-05 (sandboxed), ACL-03/05 (IP protection), SEC-04 (no PHI in logs/errors).
- [Source: architecture/Velara-Architecture-full.md#14,59,401,525,550] — three runtimes "all sandboxed"; `execution_service.py` prompt/code/hybrid router; `anthropic_client.py` proxy; invocation data flow; EXE-01–06 mapping (architecture names **no** concrete hybrid mechanism — this story defines it per the 2026-06-11 decisions).
- [Source: claude-api/shared/tool-use-concepts.md] — tool definition structure (`name`/`description`/`input_schema`), **manual agentic loop** (loop until `stop_reason != "tool_use"`, append full `response.content`, match `tool_use_id`, all results in one user message), `is_error` tool_result handling, manual-loop-vs-tool-runner (we use manual + user-defined tools), server-side tools NOT used.
- [Source: claude-api/shared/models.md] — Opus 4.x removed `temperature`/`top_p`/`top_k`/`budget_tokens` (400); `claude-opus-4-8` supports tool use (anthropic 0.50.0).
- [Source: velara-api/app/services/execution_service.py#42-360] — `execute_skill` router, `_run_prompt`/`_run_code` (the patterns `_run_hybrid` mirrors: artifact fetch, `build_context_input`, output-bucket write, result_metadata, PHI discipline), `UnsupportedRuntimeError`/`ExecutionTimeoutError`/`CodeExecutionError`.
- [Source: velara-api/app/services/code_sandbox.py] — `run_sandboxed`, `SandboxResult` (`completed`/`network_blocked` from trusted control token), `_apply_rlimits` (RLIMIT_AS/CPU/FSIZE/NOFILE=512), `_HARNESS` (network block before skill exec), `_CappedReader`, `pass_fds` control pipe, `start_new_session`+`killpg`, bounded reaps — **reused** by `ToolServer`.
- [Source: velara-api/app/integrations/anthropic_client.py#31-144] — `LLMProvider`/`LLMResult`/`AnthropicProvider.complete`/`get_llm_provider` — `complete` unchanged; `create_message` added.
- [Source: velara-api/app/workers/execution_tasks.py#39-156,251-303] — error-code constants, `run_skill` decorator (1260/1320), success/failure seam, `_get_runtime_type` (→ `"hybrid"` audit), `_map_error_code` dispatch (hybrid codes added before anthropic block).
- [Source: velara-api/app/services/skill_service.py#214-296,394-487] — artifact stored as `content.encode()` at `artifact_key` with `content_type`; hybrid uses a distinct `content_type` to carry JSON (no migration). `input_schema`/`output_schema` are skill-level (not per-tool).
- [Source: velara-api/app/services/audit_service.py; app/models/audit.py] — `record_entry` validates `runtime_type ∈ {prompt,code,hybrid}` → `"hybrid"` valid; call-chain captured in `result_metadata`, not new audit columns.
- [Source: velara-api/app/api/v1/invocations.py#66-168; app/schemas/invocation.py] — runtime-agnostic endpoint, no change for hybrid.
- [Source: velara-api/app/db/migrations/versions/0008_invocation_job_inputs.py] — current head; no new migration.
- [Source: velara-api/tests/unit/services/test_execution_service.py#16-171] — `FakeLLMProvider` (extend with `create_message`), `_make_skill/_make_job/_make_storage`, `test_hybrid_runtime_raises_unsupported` (FLIP).
- [Source: velara-api/tests/unit/services/test_code_sandbox.py] — Docker/Linux-gated sandbox test patterns (`ToolServer` tests mirror).
- [Source: stories/3-3-prompt-based-skill-execution.md, stories/3-4-code-based-skill-execution.md] — runtime-router discipline, single-error-path seam, trusted control channel, Docker-rebuild PITFALL, asyncio-run-in-task vs pytest-loop caveat, `_drive_execution` integration pattern, IP/PHI discipline, timeout-ordering.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- **Bug: `messages[-2]` → `messages[-1]` in `_run_hybrid` final text extraction.** After the agentic loop breaks on `stop_reason != "tool_use"`, the last appended message is `messages[-1]` (the final assistant turn). The initial implementation used `messages[-2]`, which is the preceding user message (initial input or last tool_results block), producing an empty output_bytes. Fixed to `messages[-1]` before Docker suite; confirmed by integration test `test_hybrid_skill_executes_to_completed_with_output_and_audit` passing.
- **Ruff B904 in `hybrid_artifact.py` and `code_sandbox.py`.** Four `raise ... from e` fixes required: three in `hybrid_artifact.py` (inside `except` clauses for `UnicodeDecodeError`, `json.JSONDecodeError`, and the Pydantic `Exception` catch), one in `code_sandbox.py` (`ToolServerError` inside `except BrokenPipeError`). Auto-fixed with `ruff check . --fix` for UP037/I001; B904 required manual edits.

### Completion Notes List

- Implemented the full hybrid runtime path: artifact parse → persistent ToolServer subprocess → manual Claude agentic loop → PHI-safe result_metadata. No new dependency (anthropic 0.50.0 already supports tools=); migration head stays at `0008_invocation_job_inputs`.
- `ToolServer` reuses 3.4's sandbox hardening verbatim (`_apply_rlimits`, network block, `start_new_session`, `killpg`, `pass_fds`, scrubbed env, `tempdir` rmtree). The framing protocol (4-byte big-endian length + UTF-8 JSON) mirrors the "trusted control channel / can't forge OK token" invariant from 3.4.
- IP protection (AC6): system prompt, tool definitions, code, tool arguments, and intermediate results are used in-loop and discarded — never stored, logged, or returned in any response body.
- PHI discipline: logs emit only job_id/skill_id/model/token counts/stop_reason/tool-call names and counts — never message content, tool args, or response text.
- `result_metadata` captures the full call chain: `{runtime:"hybrid", tool_turns, tool_calls:[{name,is_error,duration_ms}], input_tokens, output_tokens, stop_reason}` satisfying AC4 without leaking IP.
- All 7 tasks complete. 383/383 Docker tests pass. `ruff check .` clean.

### File List

- `app/core/config.py` — MODIFIED: added `HYBRID_MAX_TOOL_TURNS` and `HYBRID_TOOL_CALL_TIMEOUT_S`
- `app/services/hybrid_artifact.py` — NEW: `HybridManifest`, `ToolDef`, `parse_hybrid_artifact`, `to_anthropic_tools`, `InvalidHybridArtifactError`
- `app/services/code_sandbox.py` — MODIFIED (additive): `_TOOL_SERVER_HARNESS`, `ToolServerError`, `ToolCallResult`, `ToolServer` context manager
- `app/integrations/anthropic_client.py` — MODIFIED (additive): `LLMTurn` dataclass, `LLMProvider.create_message` Protocol method, `AnthropicProvider.create_message` implementation
- `app/services/execution_service.py` — MODIFIED: hybrid branch in `execute_skill`, `_run_hybrid`, `HybridLoopError`, `HybridToolServerError`, `_json_safe`
- `app/workers/execution_tasks.py` — MODIFIED: `ERROR_CODE_INVALID_HYBRID_ARTIFACT`, `ERROR_CODE_HYBRID_LOOP_EXHAUSTED`, `ERROR_CODE_HYBRID_TOOL_SERVER_ERROR`, hybrid branches in `_map_error_code`
- `tests/unit/services/test_hybrid_artifact.py` — NEW: 17 tests (parse valid/errors, `to_anthropic_tools`)
- `tests/unit/services/test_execution_service.py` — MODIFIED: `FakeLLMProvider.create_message`, `TestRunHybrid` (5 tests), flipped `test_hybrid_runtime_raises_unsupported`
- `tests/unit/services/test_code_sandbox.py` — MODIFIED (additive): `TestToolServerSuccess` (4), `TestToolServerNetworkBlock` (1), `TestToolServerTimeout` (2), `TestToolServerLifecycle` (2), all Docker/Linux-only
- `tests/unit/workers/test_execution_tasks.py` — MODIFIED: 5 new hybrid error-code mapping tests
- `tests/integration/api/test_invocations.py` — MODIFIED: 3 new hybrid tests (happy-path, IP-protection, 202 path)

### Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-11 | Created `app/services/hybrid_artifact.py` | New structured artifact format for hybrid skills |
| 2026-06-11 | Added `ToolServer` to `app/services/code_sandbox.py` | Persistent sandbox subprocess for per-invocation tool serving |
| 2026-06-11 | Extended `app/integrations/anthropic_client.py` with `create_message`/`LLMTurn` | Tool-use API support for hybrid agentic loop |
| 2026-06-11 | Added `_run_hybrid` to `app/services/execution_service.py` | Hybrid runtime router implementation |
| 2026-06-11 | Added hybrid error codes to `app/workers/execution_tasks.py` | Correct error mapping for hybrid failure modes |
| 2026-06-11 | Fixed `messages[-2]` → `messages[-1]` in `_run_hybrid` | Bug: final text extraction was reading wrong (user) turn |
| 2026-06-11 | Fixed 4× `raise ... from e` (ruff B904) | Explicit exception chaining in `hybrid_artifact.py` and `code_sandbox.py` |
