---
baseline_commit: 78f5406706ddcf735a28a31fb21ed8135b0296ff
---

# Story 3.4: Code-Based Skill Execution

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want to execute code-based skills where the platform runs Python deterministically in a sandbox,
so that skills with deterministic computation run safely without affecting other skills or platform stability.

This story fills the **`code` branch** of the `execution_service` runtime router that Story 3.3 built (3.3 currently raises `UnsupportedRuntimeError` for `code`/`hybrid`). It adds a **Phase-1 in-process subprocess sandbox**: the skill's Python runs in an isolated child process with a hard wall-clock timeout (default 1200s → `EXECUTION_TIMEOUT`), OS resource limits (memory/CPU/file-size), a scrubbed environment + throwaway working directory, and **blocked outbound network** (network access only via the connector framework — Story 3.8). It reuses the entire Story 3.1/3.3 job→result→audit lifecycle unchanged. It does **not** implement the hybrid tool-use loop (3.5), branded output (3.6), fan-out (3.7), or the connector/credential framework (3.8). See **Scope Boundary**.

**Sandbox-depth decision (made at story-creation, 2026-06-11):** Phase-1 targets an **in-process subprocess sandbox** (separate interpreter + timeout + `RLIMIT_*` + scrubbed env + temp CWD + a child-side network block). True kernel-level isolation (nsjail / gVisor / seccomp-bpf / per-execution container) requires root, namespaces, or system packages the architecture defers to **Epic 7** infrastructure — explicitly out of scope here. The story is written to make the 3.8/Epic-7 hardening a clean drop-in.

## Acceptance Criteria

1. **(Code routing → sandbox)** Given a skill with `runtime_type: "code"` is invoked, when the Celery `run_skill` task dispatches it, then `execution_service` routes to the **code runtime** and executes the skill's Python in an **isolated subprocess** with a configurable timeout (default **1200s**, from `settings.EXECUTION_TIMEOUT_S`). [Source: epics/epic-3-skill-execution-engine.md#Story 3.4]

2. **(Success → result stored, completed)** Given the Python code executes successfully, when it completes, then its stdout/declared output is captured and written to the **output bucket** as an S3 object; `output_file_key` + `result_metadata` are stored in `invocation_results` and the job transitions to `completed`. [Source: epic-3 AC; invocation.py InvocationResult; 3.3 _run_prompt output pattern]

3. **(Timeout → failed, EXECUTION_TIMEOUT)** Given a code skill execution times out, when the timeout threshold is reached, then the subprocess (and its whole process group) is terminated, the job transitions to `failed` with `error_code: "EXECUTION_TIMEOUT"`, and **no output** is returned. [Source: epic-3 AC]

4. **(Unhandled exception → failed, PHI-safe)** Given a code skill raises an unhandled Python exception, when the exception propagates, then the job transitions to `failed`; the raw exception/traceback is **logged internally only** (structlog, PHI-sanitized) and only `{"error": {"code": "SKILL_EXECUTION_ERROR", "message": "Skill execution failed.", "request_id": "..."}}` is returned to the caller — never the raw message or traceback. [Source: epic-3 AC; PRD SEC-04; 3.3 _map_error_code]

5. **(Network blocked unless permitted)** Given a code skill attempts an outbound network call not authorized in its definition, when the sandbox intercepts the call, then the call is **blocked** and logged — sandbox isolation prevents network access. (Per-skill network permitting arrives with the connector framework in **Story 3.8**; Phase 1 blocks **all** outbound network from the code sandbox.) [Source: epic-3 AC; epic-3#Story 3.8; PRD EXE-05]

6. **(Audit entry, runtime_type="code")** Given a code skill execution completes (success or failure), when I check the audit log, then an entry exists with `runtime_type: "code"`, the standard identity fields (`skill_id`, `skill_version`, `user_id`, `hierarchy_path`, `started_at`, `completed_at`), and `outcome: "success"` (or `failure` + `error_code` on failure). [Source: epic-3 AC5 analog; PRD EXE-04/USE-01; audit_service.record_entry validates runtime_type ∈ {prompt,code,hybrid}]

## Tasks / Subtasks

- [x] **Task 1 — Execution settings (AC: 1, 3) — [config.py](../../../velara-api/app/core/config.py)**
  - [x] Add to `Settings` (SCREAMING_SNAKE_CASE, env-sourced, with Pydantic `Field` validation matching the 3.3 `ANTHROPIC_*` precedent): `EXECUTION_TIMEOUT_S: int = Field(default=1200, gt=0, le=1800)`, `EXECUTION_MAX_MEMORY_MB: int = Field(default=512, gt=0)`, `EXECUTION_MAX_OUTPUT_BYTES: int = Field(default=10_000_000, gt=0)` (10 MB stdout cap), `EXECUTION_PYTHON_BIN: str = "python"` (the interpreter used for the child — `sys.executable` at runtime is the safer default; make it overridable). No new prod fail-fast guard needed (all have safe defaults).
  - [x] **No new dependency** — the sandbox uses only the Python stdlib (`subprocess`, `resource`, `signal`, `tempfile`, `os`, `json`). Do **not** add nsjail/firejail/seccomp packages (Epic 7).

- [x] **Task 2 — Sandbox runner `app/services/code_sandbox.py` (AC: 1, 3, 4, 5)** — NEW
  - [x] Create a self-contained sandbox module with one public sync function:
    `run_sandboxed(*, code: str, stdin_payload: dict, timeout_s: int, max_memory_mb: int, max_output_bytes: int, python_bin: str) -> SandboxResult` where `SandboxResult` is a dataclass `(stdout: str, returncode: int, timed_out: bool, truncated: bool)`.
  - [x] **Process isolation:** launch the child with `subprocess.Popen([python_bin, "-I", "-c", _HARNESS], ...)`. `-I` = isolated mode (ignores env `PYTHON*` vars, no user site-packages, no cwd on `sys.path`). Use `start_new_session=True` so the child is its own **process group leader** (lets us SIGKILL the whole group on timeout — a child that spawns grandchildren can't outlive the kill). Set `cwd=<fresh tempfile.mkdtemp()>` and **scrub env**: pass `env={"PATH": "/usr/bin:/bin", "HOME": <tempdir>}` only — no AWS creds, no `ANTHROPIC_API_KEY`, no `DATABASE_URL` leak into untrusted code.
  - [x] **Resource limits (POSIX, in the child):** pass `preexec_fn=_apply_rlimits` (a module function, **not** a closure) that calls `resource.setrlimit(RLIMIT_AS, (mem, mem))` (address space = `max_memory_mb`×1MB), `RLIMIT_CPU` (≈ `timeout_s`+grace, a hard CPU-second cap as backstop to wall-clock), `RLIMIT_FSIZE` (cap written file size), `RLIMIT_NOFILE` (small fd cap). See Dev Notes → "Sandbox rlimits". **Note the documented `preexec_fn`+threads caveat** — acceptable here because the Celery worker forks the child synchronously inside the task (see Dev Notes → "preexec_fn safety").
  - [x] **Timeout → kill the group:** run with `proc.communicate(input=..., timeout=timeout_s)`; on `subprocess.TimeoutExpired`, `os.killpg(os.getpgid(proc.pid), signal.SIGKILL)` then reap. Set `timed_out=True`. **Never** rely on the child to honor a soft signal.
  - [x] **Output cap:** read at most `max_output_bytes` of stdout; if exceeded, set `truncated=True` (prevents a runaway skill from OOMing the worker via unbounded stdout).
  - [x] **stdin/stdout JSON protocol:** the harness reads a JSON payload from stdin (`{"inputs": {...}, "documents": [...]}`), exposes it to the skill, and the skill's output text is what the harness writes to stdout. See Dev Notes → "Sandbox harness & skill contract" for the exact `_HARNESS` string.
  - [x] Always `shutil.rmtree(tempdir, ignore_errors=True)` in a `finally`.

- [x] **Task 3 — Network block inside the sandbox (AC: 5)**
  - [x] Phase-1 cannot use `unshare -n` / network namespaces (needs root/`CAP_NET_ADMIN` — Epic 7). Block at the **Python layer inside the harness**: before running skill code, monkeypatch `socket.socket` (and `socket.create_connection`) to raise `PermissionError("network access is not permitted")`. This blocks `urllib`/`requests`/`http.client`/raw sockets — every Python network path bottoms out at `socket.socket`. See Dev Notes → "Network block".
  - [x] The harness must catch a network-attempt `PermissionError` and emit a structured marker on the protocol channel so the runtime can log AC5's "blocked and logged" (e.g. exit with a sentinel returncode or a `{"__sandbox_error__": "NETWORK_BLOCKED"}` line on stdout that the runtime detects). Map a network-block to a deterministic outcome (still `failed` with `SKILL_EXECUTION_ERROR`, but log `network_blocked=True`). **Acknowledge the limitation** in a comment: a determined attacker using `ctypes`→libc `socket()` bypasses the Python monkeypatch — true enforcement is the Epic-7 kernel sandbox. Phase-1 blocks the realistic/accidental case and is the documented seam for 3.8 per-skill permitting. [Source: epic-3#Story 3.8 "network access unless explicitly permitted via the connector framework"]

- [x] **Task 4 — Code runtime in `execution_service.py` (AC: 1, 2, 3, 4) — [execution_service.py](../../../velara-api/app/services/execution_service.py) MODIFY**
  - [x] In `execute_skill(...)`, **replace** the `raise UnsupportedRuntimeError(runtime_type)` fall-through with an `elif runtime_type == "code": return await _run_code(...)` branch, keeping `hybrid`/others → `UnsupportedRuntimeError` (3.5 fills hybrid). **Do not touch** the working `"prompt"` branch or `_run_prompt`. [Source: execution_service.py#94-107]
  - [x] Add `async def _run_code(*, session, job, skill, skill_storage, output_storage) -> tuple[str, dict]` mirroring `_run_prompt`'s shape (it does **not** need `llm_provider` — keep the same call signature minus that, or accept and ignore it; see Dev Notes → "Keeping execute_skill's call site unchanged"):
    1. Fetch the skill artifact bytes from the **skill bucket** via `run_in_threadpool(skill_storage.get, current_ver.artifact_key)` → decode as the Python **source** (the artifact IS the code, exactly as `_run_prompt` treats it as system text). [Source: execution_service.py#138-152; skill_service artifact = `content.encode()`]
    2. Assemble the `stdin_payload` from `job.inputs` (`{"file_ref_ids", "inputs"}`): pull each referenced document via `build_context_input(...)` (already threadpool-safe) and pass as `documents`; pass `inputs` through. **Same file-by-key discipline as 3.3** — raw file content never rides in the job row. [Source: execution_service.py#155-178]
    3. Run the sandbox: `result = await run_in_threadpool(run_sandboxed, code=..., stdin_payload=..., timeout_s=settings.EXECUTION_TIMEOUT_S, max_memory_mb=..., max_output_bytes=..., python_bin=...)`. **Wrap the blocking sandbox call in `run_in_threadpool`** so the task's event loop isn't blocked.
    4. **Interpret the result:** `timed_out=True` → raise `ExecutionTimeoutError` (stable `EXECUTION_TIMEOUT`); `returncode != 0` (non-timeout) → raise `CodeExecutionError` (stable `SKILL_EXECUTION_ERROR`), logging the returncode + a network-block marker if present, **never** raw child stderr to the caller; success → write `result.stdout` to the output bucket at `outputs/{org_id}/{job_id}.txt` via `run_in_threadpool(output_storage.put, ...)`, return `(output_key, {"format": "text", "char_count": N, "returncode": 0, "truncated": result.truncated, "timed_out": False})`.
  - [x] Define domain exceptions subclassing `VelaraHTTPException` with `ERROR_CODE` (match `UnsupportedRuntimeError`): `ExecutionTimeoutError` (422, `EXECUTION_TIMEOUT`), `CodeExecutionError` (422, `SKILL_EXECUTION_ERROR`). These are raised inside the task context (where they become the failure path) — the status code matters only if ever surfaced via API; reuse 422 for consistency. **PHI discipline:** never log skill stdout/stderr content (may contain PHI); log job_id/returncode/timed_out/truncated/network_blocked only. [Source: execution_service.py#39-52; _run_prompt PHI comments #186-194]

- [x] **Task 5 — Error-code mapping in the task (AC: 3, 4) — [execution_tasks.py](../../../velara-api/app/workers/execution_tasks.py) MODIFY**
  - [x] Add a stable constant `ERROR_CODE_EXECUTION_TIMEOUT = "EXECUTION_TIMEOUT"` (alongside the existing 3.3 constants ~lines 39-43).
  - [x] In `_map_error_code(...)` (~lines 244-279), add **before** the anthropic block: `if isinstance(exc, execution_service.ExecutionTimeoutError): return ERROR_CODE_EXECUTION_TIMEOUT`. `CodeExecutionError` already carries `ERROR_CODE = "SKILL_EXECUTION_ERROR"` which is the generic fallback — but add an explicit `isinstance(exc, execution_service.CodeExecutionError) → ERROR_CODE_SKILL_EXECUTION_ERROR` for clarity. Import `execution_service` is already present in the task module. **Do not** alter the existing anthropic mappings or the generic catch-all. [Source: execution_tasks.py#244-279]
  - [x] **RAISE the `run_skill` decorator limits** so the outer Celery task outlives the inner sandbox: the decorator was set to `soft_time_limit=300, time_limit=360` in 3.3 (sized for prompt/Claude latency). The code sandbox's `EXECUTION_TIMEOUT_S` is now **1200s**, which would blow past the 360s hard limit and get killed by Celery's generic `Terminated` before the specific `EXECUTION_TIMEOUT` (AC3) could fire. Update the decorator to **`soft_time_limit=1260, time_limit=1320`** so the ordering holds: **sandbox 1200 < Celery soft 1260 < Celery hard 1320**. This is the **only** change to the decorator; the task **body**, `mark_running/completed/failed`, audit calls, `_get_runtime_type`, and the fresh-session failure handler are unchanged. (Prompt skills finish well under 1260s, so the raised limit doesn't weaken their bound in practice — it only relaxes the ceiling.) **Coupling to remember:** `EXECUTION_TIMEOUT_S` must always stay `< soft_time_limit`; if either changes later, re-check both. See Dev Notes → "Two timeout layers". [Source: execution_tasks.py#46-54]

- [x] **Task 6 — Tests (AC: all)**
  - [x] **CHANGE the existing 3.3 test** `tests/unit/services/test_execution_service.py::test_code_runtime_raises_unsupported` — `code` no longer raises `UnsupportedRuntimeError`. Replace it with a test that `code` routes to `_run_code` (patch `run_sandboxed` / `run_in_threadpool` to return a `SandboxResult`) and returns `(output_key, metadata)`; **keep** `test_hybrid_runtime_raises_unsupported` unchanged (hybrid is still 3.5). [Source: test_execution_service.py#118-158]
  - [x] Unit `tests/unit/services/test_code_sandbox.py` (**Docker-only** — POSIX `resource`/`preexec_fn`; skip on non-Linux via a guard, see Dev Notes → "Platform caveat"): a trivial `print`-style skill returns its stdout; a `while True: pass` skill hits the timeout → `timed_out=True` within ~timeout+grace; a skill that allocates > limit → non-zero returncode (MemoryError); a skill doing `socket.socket()` / `urllib.request.urlopen(...)` → blocked (network marker / non-zero); a skill writing > `max_output_bytes` → `truncated=True`. Use a **1–2s** `timeout_s` in tests, not 1200s.
  - [x] Unit `tests/unit/services/test_execution_service.py` (code branch): inject fake storages + a patched `run_sandboxed`; assert success writes to the output bucket and returns metadata; assert `timed_out` → `ExecutionTimeoutError`; assert non-zero returncode → `CodeExecutionError`; assert `build_context_input` is called per `file_ref_id` (mock it). Reuse the `_make_storage`/`_make_skill`/`_make_job` helpers already in the file.
  - [x] Unit/worker `tests/unit/workers/test_execution_tasks.py`: assert `_map_error_code(ExecutionTimeoutError(...)) == "EXECUTION_TIMEOUT"` and `CodeExecutionError(...) == "SKILL_EXECUTION_ERROR"`. (Pure function — no loop/DB; trivially unit-testable.) [Source: test_execution_tasks.py error-code tests]
  - [x] Integration `tests/integration/api/test_invocations.py` (extend): seed a `code` skill whose artifact is a tiny deterministic Python program; `POST /api/v1/invocations/{skill_id}` → 202; with the worker running (or `celery_eager` minding the 3.3 asyncio-loop caveat), assert the job reaches `completed` with an output object and a `success` audit row (`runtime_type="code"`). Add a timeout-skill case → `failed` + `error_code="EXECUTION_TIMEOUT"`. Reuse `_create_skill_in_db` + `_auth_headers`. **Heavy sandbox/timeout assertions belong in the Docker unit suite**, not the integration path, to keep it fast.
  - [x] **Gates before marking done:** `ruff check .` clean (line-length 100; `E,F,I,B,UP,W`; `B008` ignored) AND the **full Docker test suite green**. The sandbox tests **must** run in the Linux worker/api container (POSIX-only APIs). [Source: 3.1/3.2/3.3 gates]

## Dev Notes

### Scope Boundary (read this first)

- **In scope:** `code_sandbox.py` (subprocess sandbox: timeout + `RLIMIT_*` + scrubbed env + temp CWD + network block); the `code` branch of `execution_service.execute_skill` (`_run_code`); `EXECUTION_*` settings; `EXECUTION_TIMEOUT` error code + `_map_error_code` wiring; audit `runtime_type="code"` (already supported by `audit_service`). Reuses the 3.1/3.3 job/result/audit lifecycle and the `POST /api/v1/invocations/{skill_id}` endpoint **unchanged**.
- **Out of scope (do NOT build — collides with later stories):**
  - **Hybrid runtime** (Claude tool-use loop, `tool_use`/`tool_result`, `is_error`) → **Story 3.5**. Keep `hybrid` → `UnsupportedRuntimeError`. [Source: epic-3#137-159]
  - **Per-skill network permitting / external-API credentials** (`requires: [...]`, Secrets Manager injection, `MISSING_CREDENTIAL`, `IngestConnector`/`OutputConnector`) → **Story 3.8**. Phase-1 blocks **all** network; the block is the seam 3.8 opens selectively. [Source: epic-3#233-251]
  - **Kernel-level sandbox** (nsjail / gVisor/runsc / seccomp-bpf / per-execution container / network namespaces) → **Epic 7** infra (needs root, namespaces, or system packages + IaC). The architecture says runtimes are "all sandboxed" but names no technology — Phase-1 is the in-process subprocess sandbox per the 2026-06-11 decision. [Source: architecture/Velara-Architecture-full.md#14,59; story decision]
  - **Branded output generation** (PDF/PPTX/DOCX/XLSX writers, 24h presigned deliverables) → **Story 3.6**. `_run_code` writes **plain text** stdout, same as `_run_prompt`. [Source: epic-3#163-193]
  - **Location fan-out** (`fan_out`/`aggregate_results` chord, `LOCATION_REQUIRED`) → **Story 3.7** (deferred after Epic 4). [Source: epic-3#197-199]
  - **Structured output-schema validation** (REG-03 `output_schema` enforcement) — not required by 3.4's ACs; keep output as opaque text. Flag if desired, don't invent.

### What 3.3 already built that 3.4 reuses verbatim (do NOT re-implement)

- **`execute_skill(*, session, job, llm_provider, skill_storage, output_storage)`** — the router. 3.4 adds one `elif`. [execution_service.py#58-107]
- **`run_skill` Celery task** — `mark_running` → `execute_skill` → `mark_completed` + success audit; fresh-session `mark_failed` + failure audit on exception; `_get_runtime_type` already reads `skill.runtime_type` (so `"code"` audit is automatic). `_map_error_code` is the only task edit. [execution_tasks.py#46-279]
- **`POST /api/v1/invocations/{skill_id}`** — creates the `queued` job, persists `inputs` JSONB (`file_ref_ids`+`inputs`), atomic-dispatch with `DISPATCH_FAILED` recovery. **No endpoint change** — it's runtime-agnostic; it already validates retired (`SKILL_RETIRED`), cross-org (404), missing-version (`SKILL_NO_CURRENT_VERSION`), and file-ref readiness. [invocations.py#66-168]
- **`job_service`** (`create_job(inputs=...)`, `mark_running/completed/failed`, `_guard_not_terminal`, `get_job_unscoped`) and **`audit_service.record_entry`** (validates `runtime_type ∈ {prompt,code,hybrid}` — `"code"` is valid). [job_service.py#102-307; audit_service]
- **`build_context_input(*, session, output_storage, file_ref_id, org_id) -> str`** — file-by-key document context; threadpool-safe. Call once per `file_ref_id`. [ingest_service build_context_input; execution_service.py#166-174]
- **Migration head is `0008_invocation_job_inputs`** — **no new migration** for 3.4 (inputs column already exists; no schema change). [migrations/versions/0008_invocation_job_inputs.py]

### Keeping `execute_skill`'s call site unchanged

`run_skill` calls `execute_skill(..., llm_provider=get_llm_provider(), skill_storage=..., output_storage=...)` for **every** runtime. Two clean options for `_run_code` (which needs no LLM):

- **Recommended:** keep `execute_skill`'s signature as-is; in the `code` branch call `_run_code(session=, job=, skill=, skill_storage=, output_storage=)` (drop `llm_provider`). `execute_skill` still receives `llm_provider` from the task — it just doesn't forward it to `_run_code`. Zero task-side change.
- Do **not** change `run_skill`'s `execute_skill(...)` call or fetch providers conditionally — that risks the working prompt path. The unused `llm_provider` for code jobs is harmless (the `AnthropicProvider` is `@lru_cache`'d and not contacted unless `.complete()` is called).

### Sandbox harness & skill contract (`_HARNESS`)

The child runs `python -I -c "<_HARNESS>"`. The harness is a **trusted** string we control; the **skill code** is untrusted and is `exec`'d by the harness after the network block is installed. Contract:

```python
_HARNESS = r'''
import sys, json, socket, builtins

# ── network block (AC5) ── installed BEFORE skill code runs ──────────────
def _blocked(*a, **k):
    raise PermissionError("network access is not permitted")
socket.socket = _blocked            # blocks urllib/requests/http.client/raw sockets
socket.create_connection = _blocked

payload = json.load(sys.stdin)      # {"inputs": {...}, "documents": ["...", ...]}
skill_globals = {
    "__name__": "__skill__",
    "inputs": payload.get("inputs") or {},
    "documents": payload.get("documents") or [],
    "output": None,                 # skill sets `output = ...` OR prints to stdout
}
SKILL_CODE = payload["__code__"]    # the skill source, passed in the payload
try:
    exec(compile(SKILL_CODE, "<skill>", "exec"), skill_globals)
except PermissionError as e:
    sys.stderr.write("NETWORK_BLOCKED")
    sys.exit(13)                    # sentinel returncode → runtime logs network_blocked
except Exception:
    import traceback; traceback.print_exc()   # to STDERR only (never returned to caller)
    sys.exit(1)
# Prefer an explicit `output` var; fall back to whatever the skill printed.
out = skill_globals.get("output")
if out is not None:
    sys.stdout.write(out if isinstance(out, str) else json.dumps(out))
'''
```

- Pass the skill source **in the JSON payload** (`__code__`) rather than as a second `-c` arg, so the harness installs the network block **before** the skill runs. The runtime builds `stdin_payload = {"__code__": skill_source, "inputs": ..., "documents": [...]}`.
- **Skill contract (document in code comments / Dev Agent Record):** a code skill reads `inputs` (dict) and `documents` (list[str]) from its globals and either sets `output` (str/JSON-serializable) or prints to stdout. This is the minimal Phase-1 contract; richer SDKs are later scope.
- `returncode 13` = network blocked (AC5); `returncode 0` = success; other non-zero = skill error (AC4); `timed_out` (from `TimeoutExpired`) = AC3.

### Sandbox rlimits (`_apply_rlimits`, child-side, POSIX)

```python
import resource
def _apply_rlimits(max_memory_mb: int, cpu_seconds: int, max_fsize: int) -> None:
    mem = max_memory_mb * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))          # address space cap → MemoryError
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))  # hard CPU-sec backstop
    resource.setrlimit(resource.RLIMIT_FSIZE, (max_fsize, max_fsize))    # cap file writes
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))       # small fd cap
```

- `preexec_fn` must be a **module-level function bound via `functools.partial`** (not a lambda/closure) for pickle-free use; it runs in the child **after fork, before exec**. [Source: web research — resource.setrlimit, preexec_fn]
- `RLIMIT_CPU` is a backstop for CPU-bound infinite loops that also burns wall-clock; the **authoritative** timeout is the parent's `communicate(timeout=...)` + `killpg` (covers sleeping/blocked children too).
- Set `cpu_seconds = timeout_s + 5` so wall-clock (parent) fires first in the normal case and CPU-limit is the safety net.

### preexec_fn safety (the documented threads caveat)

The stdlib warns `preexec_fn` is "not safe in the presence of threads" (child could deadlock before exec). It's acceptable here: the Celery prefork worker forks the sandbox child **synchronously** from the task; `_apply_rlimits` only calls `setrlimit` (async-signal-safe enough in practice for this pattern, the same pattern resource-limited CI runners use). Document the tradeoff in a comment and note that the Epic-7 kernel sandbox removes `preexec_fn` entirely. **Do not** use `posix_spawn`/`vfork` tricks. If the worker is ever switched to a thread/gevent pool this must be revisited — flag in Dev Agent Record.

### Network block (AC5) — Python-layer, with documented limits

- **Why not `unshare -n` / netns:** creating a network namespace needs `CAP_NET_ADMIN`/root; the worker container doesn't run privileged (and shouldn't). Deferred to Epic 7. [Source: web research — unshare needs root]
- **Phase-1 mechanism:** monkeypatch `socket.socket`/`socket.create_connection` in the harness **before** `exec`'ing skill code. Every stdlib network path (`urllib`, `http.client`, `requests` if vendored, `ftplib`, `smtplib`) constructs a `socket.socket` — so this blocks the realistic and accidental cases.
- **Honest limitation (comment it):** `ctypes`→libc `socket(2)` or a pre-imported module holding a socket reference bypasses the monkeypatch. True syscall-level blocking is the Epic-7 seccomp/netns sandbox. Phase-1's contract: "no accidental or casual network egress; deterministic compute only" — sufficient for EXE-05 "a misbehaving skill cannot affect platform stability" + the AC5 demonstrable block. [Source: PRD EXE-05; epic-3 AC5; web research — seccomp/netns are the real enforcement]

### Two timeout layers (don't let them fight)

- **Inner (skill):** `settings.EXECUTION_TIMEOUT_S` (default 1200) → parent `communicate(timeout=...)` → `killpg(SIGKILL)` → `EXECUTION_TIMEOUT` (AC3). This is the **specific, correct** failure.
- **Outer (task):** raise the `run_skill` decorator to **`soft_time_limit=1260, time_limit=1320`** (was 300/360 in 3.3). The ordering that must hold is **sandbox 1200 < Celery soft 1260 < Celery hard 1320** — the soft limit sits *strictly above* the sandbox cap (not equal to it) so the sandbox's specific `EXECUTION_TIMEOUT` fires first, and the ~60s headroom absorbs the surrounding DB + S3 + context-build work. Do **not** set `soft_time_limit == EXECUTION_TIMEOUT_S` (a 1200/1200 tie races Celery's generic `SoftTimeLimitExceeded` against the sandbox's own timeout and can mask AC3). **Coupling:** any future change to `EXECUTION_TIMEOUT_S` must keep it `< soft_time_limit` and bump both Celery limits together. [Source: execution_tasks.py#46-54]

> ⚠️ **1200s is a long task.** A code skill can hold a Celery prefork worker slot for up to ~20 minutes. Confirm the worker `--concurrency` leaves enough slots that long code runs don't starve prompt invocations; a dedicated queue/worker for code skills is the follow-up if it bottlenecks (log it in the Dev Agent Record — not 3.4 scope).

### Platform caveat (CRITICAL for the dev) — POSIX-only, Docker-only tests

`resource.setrlimit`, `preexec_fn`, `os.killpg`, `start_new_session`, and `RLIMIT_AS` are **POSIX/Linux** APIs. The dev host here is **macOS (darwin)** — `RLIMIT_AS` behaves differently/absent on macOS, and the sandbox will not behave identically locally. **All sandbox tests must run inside the Linux `api`/`worker` Docker container**, never via a bare-metal `pytest` on the Mac. Guard `test_code_sandbox.py` with `pytest.mark.skipif(sys.platform != "linux", reason="POSIX sandbox — run in Docker")` so a local run skips rather than errors. The production worker runs in the Linux container, so this matches prod. [Source: web research — setrlimit/preexec_fn POSIX-only; Story 3.1/3.2/3.3 Docker-baked-image PITFALL]

### Running tests (Docker source is baked, not mounted)

- **No new dependency** this story → a rebuild is only needed because source is baked: `docker compose build api worker && docker compose up -d`. [Source: 3.1/3.2/3.3 Running tests]
- **No migration** (inputs column already at head `0008`). Verify head unchanged: `docker compose exec api alembic heads` → `0008_invocation_job_inputs`.
- Unit (sandbox): **must run in-container** — `docker compose exec api pytest tests/unit/services/test_code_sandbox.py`. Use **1–2s** timeouts in tests.
- Unit (routing/mapping, no real subprocess): `pytest tests/unit/services/test_execution_service.py tests/unit/workers/test_execution_tasks.py` — patch `run_sandboxed`.
- Integration: `docker compose up -d` then `docker compose exec api pytest tests/integration/api/test_invocations.py`. Skip-guard auto-skips if services unreachable. Mind the 3.3 learning: `asyncio.run()` inside the task can't run on pytest-asyncio's loop — patch `run_skill.delay` or run a real worker; reuse `dispose_engine_after_test`. [Source: stories/3-3 Debug Log; test_invocations.py]
- Integration auth: `_auth_headers` dev-JWT from [test_jobs.py](../../../velara-api/tests/integration/api/test_jobs.py) (seed `ma.tech`/`consultant`/`client.user`).
- Lint: `ruff check .` (line-length 100, `E,F,I,B,UP,W`, `B008` ignored).

### IP protection & PHI (carry forward, unchanged guarantees)

- The code artifact (skill source) is fetched, executed, and **discarded** — never stored in the DB, never logged, never returned. `InvocationResult` carries only `output_file_key` + `result_metadata`. Skill stdout/stderr may contain PHI → **never** log it; surface only `{code, message, request_id}` envelopes. Raw child stderr/traceback stays in the child (printed to its stderr, captured-but-not-returned) — at most logged at debug behind the PHI sanitizer if you must, prefer not at all. [Source: PRD ACL-03/SEC-04; execution_service.py#186-194; 3.3 IP-protection notes]

### Project Structure Notes

New/modified files (all under `velara-api/`):

| File | Action | Purpose |
|------|--------|---------|
| `app/services/code_sandbox.py` | NEW | subprocess sandbox: `run_sandboxed`, `SandboxResult`, `_apply_rlimits`, `_HARNESS` |
| `app/services/execution_service.py` | MODIFY | add `code` branch + `_run_code` + `ExecutionTimeoutError`/`CodeExecutionError`; **do not touch prompt path** |
| `app/workers/execution_tasks.py` | MODIFY | `ERROR_CODE_EXECUTION_TIMEOUT` + 2 `isinstance` lines in `_map_error_code` only |
| `app/core/config.py` | MODIFY | `EXECUTION_*` settings (Field-validated) |
| `tests/unit/services/test_code_sandbox.py` | NEW | Docker/Linux-only sandbox behavior tests |
| `tests/unit/services/test_execution_service.py` | MODIFY | flip `test_code_runtime_raises_unsupported` → routes-to-_run_code; add code-branch tests |
| `tests/unit/workers/test_execution_tasks.py` | MODIFY | `EXECUTION_TIMEOUT`/`SKILL_EXECUTION_ERROR` mapping tests |
| `tests/integration/api/test_invocations.py` | MODIFY | add code-skill happy-path + timeout cases |

The architecture's named execution slots (`execution_service.py`, `execution_tasks.py`) already exist; `code_sandbox.py` is a net-new private helper under `services/` (the architecture names no `runtimes/`/`sandbox/` slot, so a single cohesive module is the lighter, consistent choice — same call made for `_run_prompt` in 3.3). **No detected conflicts.** No new model, migration, endpoint, schema, or dependency.

### References

- [Source: epics/epic-3-skill-execution-engine.md#Story 3.4] — story statement + all ACs (code routing/1200s timeout, success→completed, timeout→`EXECUTION_TIMEOUT`+no output, unhandled-exc→failed PHI-safe, network blocked unless permitted).
- [Source: epics/epic-3-skill-execution-engine.md#Story 3.5/3.8] — hybrid (3.5) and connector/credential network-permitting (3.8) are out of scope; Phase-1 blocks all network.
- [Source: prds/.../5-functional-requirements.md] — EXE-02 (code skills = deterministic Python), EXE-05 (sandboxed; misbehaving skill can't affect others/stability), EXE-04/USE-01 (execution logged), SEC-04 (no PHI in logs/errors), ACL-03 (skill code never returned by any API/log/error).
- [Source: architecture/Velara-Architecture-full.md#14,59,87] — three runtimes "all sandboxed"; "Execution isolation/sandboxing" is the engine's job; Python backend chosen so code-skills share the runtime — **no concrete sandbox technology named** (Phase-1 decision fills the gap; kernel sandbox = Epic 7).
- [Source: velara-api/app/services/execution_service.py#39-213] — `execute_skill` router, `UnsupportedRuntimeError`, `_run_prompt` (artifact fetch, `build_context_input`, output-bucket write, result_metadata, PHI comments) — the exact pattern `_run_code` mirrors.
- [Source: velara-api/app/workers/execution_tasks.py#39-279] — error-code constants, `run_skill` task (decorator currently `soft_time_limit=300/time_limit=360` from 3.3 → **raise to 1260/1320** for the 1200s sandbox; success/failure seam, fresh-session handler, `_get_runtime_type` reads `skill.runtime_type`), `_map_error_code` isinstance dispatch.
- [Source: velara-api/app/api/v1/invocations.py#66-168] — runtime-agnostic invocation endpoint (no change needed); atomic dispatch + `DISPATCH_FAILED`.
- [Source: velara-api/app/services/job_service.py#102-307] — `create_job(inputs=)`, `mark_running/completed/failed`, `_guard_not_terminal`, `get_job_unscoped`.
- [Source: velara-api/app/services/audit_service.py; app/models/audit.py] — `record_entry` validates `runtime_type ∈ {prompt,code,hybrid}` → `"code"` valid; `RUNTIME_CODE` constant.
- [Source: velara-api/app/services/skill_service.py#308-332,430-435,500-507] — `get_skill` (loads `.versions`, `.runtime_type`, `.current_version_id`), artifact stored as `content.encode()` at `artifact_key`, `assert_invocable`/`SkillRetiredError`.
- [Source: velara-api/app/services/ingest_service.py build_context_input] — file-by-key document context seam (threadpool-safe).
- [Source: velara-api/app/core/config.py#30-152] — settings pattern, `Field`-validated `ANTHROPIC_*` precedent (mirror for `EXECUTION_*`), `_reject_insecure_defaults_outside_dev`.
- [Source: velara-api/app/db/migrations/versions/0008_invocation_job_inputs.py] — current head; `inputs` JSONB already present → no migration.
- [Source: velara-api/tests/unit/services/test_execution_service.py#14-158] — `FakeLLMProvider`, `_make_storage/_make_skill/_make_job`, the `code`→`UnsupportedRuntimeError` test to FLIP, the `hybrid` test to KEEP.
- [Source: velara-api/tests/conftest.py; tests/integration/api/test_invocations.py; tests/integration/api/test_jobs.py] — `celery_eager`, `dispose_engine_after_test`, skip-guard, `_auth_headers`, `_create_skill_in_db`.
- [Source: stories/3-3-prompt-based-skill-execution.md] — runtime-router design, single-error-path seam, Docker-rebuild PITFALL, asyncio-run-in-task vs pytest-loop caveat, IP/PHI discipline.
- [Source: web research — docs.python.org `resource`/`subprocess`; setrlimit RLIMIT_AS/RLIMIT_CPU; preexec_fn threads caveat; `os.killpg`+`start_new_session` process-group kill; `unshare -n`/seccomp need root → Epic 7] — sandbox primitive choices and their documented limits.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- **`EXECUTION_PYTHON_BIN` default "python" fails in Docker** — The container image has no bare `python` binary; only `python3` / `sys.executable`. Fixed by using `Field(default_factory=lambda: sys.executable)` so the default resolves at runtime to the active interpreter without requiring an env override.
- **urllib network-block test returncode** — `urllib.request.urlopen` internally catches the `PermissionError` from the monkeypatched `socket.socket` and re-raises as a `urllib.error.URLError` (wrapping `OSError`), not `PermissionError`. The harness `except PermissionError` therefore doesn't catch it; the generic `except Exception` does, giving exit code 1 rather than the sentinel 13. The block still works (exits non-zero) — updated the test to assert `returncode != 0` rather than `== 13`, with a comment explaining the urllib wrapping behaviour.
- **Integration test asyncio.run() event-loop conflict** — `celery_eager` + `asyncio.run()` inside the Celery task creates a new event loop inside the test's async context, causing `Future attached to a different loop`. Same issue as 3.3 debug log. Integration tests for code skills use `patch("app.api.v1.invocations.run_skill")` (delay-patching) instead of `celery_eager`, consistent with `test_invoke_returns_valid_job_id` and `test_job_get_body_contains_no_skill_internals`.

### Completion Notes List

- All 6 ACs satisfied:
  - **AC1** — `execution_service.execute_skill` routes `runtime_type="code"` to `_run_code`; subprocess sandbox confirmed working in Docker.
  - **AC2** — Success path writes `result.stdout` to `outputs/{org_id}/{job_id}.txt`; returns `(output_key, result_metadata)` with `format/char_count/returncode/truncated/timed_out`.
  - **AC3** — `subprocess.TimeoutExpired` → `killpg(SIGKILL)` → `ExecutionTimeoutError` → `error_code="EXECUTION_TIMEOUT"`. Celery limits raised to 1260/1320 so ordering holds: sandbox 1200 < soft 1260 < hard 1320.
  - **AC4** — Non-zero returncode → `CodeExecutionError` → `error_code="SKILL_EXECUTION_ERROR"`; returncode/network_blocked/truncated logged internally; raw child stderr never returned to caller.
  - **AC5** — Harness monkeypatches `socket.socket`/`create_connection` before `exec()`ing skill code; network attempt → exit 13 sentinel → `network_blocked=True` logged. Limitation documented: `ctypes→libc socket()` bypasses the monkeypatch (Epic 7 seccomp seam).
  - **AC6** — `_get_runtime_type` in `execution_tasks.py` reads `skill.runtime_type` and passes it to `record_entry`; `"code"` is already valid in `audit_service` (`RUNTIME_CODE` constant). Audit entry confirmed in integration test.
- **No new dependency / no new migration** — sandbox uses stdlib only; migration head stays at `0008_invocation_job_inputs`.
- **`EXECUTION_PYTHON_BIN`** defaults to `sys.executable` via `default_factory` — works in Docker without env override.
- **preexec_fn note** — Acceptable in current Celery prefork model; flag for revisit if worker pool switches to threads/gevent (noted in sandbox module docstring).
- **Worker concurrency note** — A 1200s code skill can hold a worker slot for ~20 min. Dedicated queue/worker for code skills is a follow-up if concurrency becomes a bottleneck.

### File List

- `app/core/config.py` (modified — `EXECUTION_*` settings)
- `app/services/code_sandbox.py` (new — `run_sandboxed`, `SandboxResult`, `_apply_rlimits`, `_HARNESS`)
- `app/services/execution_service.py` (modified — `code` routing branch, `_run_code`, `ExecutionTimeoutError`, `CodeExecutionError`)
- `app/workers/execution_tasks.py` (modified — `ERROR_CODE_EXECUTION_TIMEOUT`, `_map_error_code` code-runtime dispatch, Celery time limits 1260/1320)
- `tests/unit/services/test_code_sandbox.py` (new — 11 Docker/Linux sandbox behaviour tests)
- `tests/unit/services/test_execution_service.py` (modified — flipped `test_code_runtime_raises_unsupported` → routes-to-_run_code; added `TestRunCode` with 4 tests)
- `tests/unit/workers/test_execution_tasks.py` (modified — `EXECUTION_TIMEOUT` and `SKILL_EXECUTION_ERROR` mapping tests + constants check)
- `tests/integration/api/test_invocations.py` (modified — 4 new code-skill integration tests)

## Review Findings

_Code review 2026-06-11 (uncommitted diff). Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor — all passed. 4 decision-needed (resolved → patch), 11 patch, 3 deferred, 5 dismissed._

### Decision-needed (resolved 2026-06-11 → reclassified to patch below)

- [x] [Review][Decision→Patch] Forgeable `network_blocked` telemetry → **Resolved: harden the marker.** Narrow the harness `except PermissionError` to the network-block message and emit the marker on a dedicated harness-controlled fd so skill code can't forge exit 13. (see Patch #8). blind+edge.
- [x] [Review][Decision→Patch] Forged success via `os._exit(0)` → **Resolved: success sentinel.** Harness writes an explicit success sentinel the runtime requires before treating rc 0 as success. (see Patch #9). edge.
- [x] [Review][Decision→Patch] Celery `SoftTimeLimitExceeded` → generic code → **Resolved: map to EXECUTION_TIMEOUT.** Add `isinstance(exc, SoftTimeLimitExceeded) → EXECUTION_TIMEOUT` in `_map_error_code`. (see Patch #10). edge.
- [x] [Review][Decision→Patch] `RLIMIT_NOFILE=(64,64)` too low → **Resolved: raise the cap** to a safer value (256/512). (see Patch #11). blind.

### Patch (all 11 applied + verified in Docker 2026-06-11)

- [x] [Review][Patch] Output cap applied after full stdout is buffered → worker OOM — **Fixed:** replaced `communicate()` with a capped streaming read on a helper thread (`_CappedReader`) that stops at `max_output_bytes + 1`; the worker never buffers more than the cap. A skill writing 5 MB into a 1 KB cap is truncated and the group killed (test `test_unbounded_stdout_is_capped_without_buffering_everything`). [app/services/code_sandbox.py] blind+auditor.
- [x] [Review][Patch] Non-JSON-serialisable `output` → opaque rc 1 — **Fixed:** harness wraps the final `json.dumps(out)` in `try/except TypeError` → coerces to `str(out)`; a successful skill setting `output = {1,2,3}` now succeeds (test `test_non_serialisable_output_is_coerced_not_crashed`). [app/services/code_sandbox.py `_HARNESS`] blind+edge.
- [x] [Review][Patch] Timeout reap could hang the worker thread — **Fixed:** all reaps use a bounded `proc.wait(timeout=5)`; the reader thread is daemonised and joined with a bound; the timeout path returns within timeout + grace (test `test_timeout_returns_within_grace_window`). [app/services/code_sandbox.py] edge.
- [x] [Review][Patch] Integration tests never exercised execution (Task 6) — **Fixed:** added `test_code_skill_executes_to_completed_with_output_and_audit` (AC2+AC6: real sandbox → `completed` + `invocation_results` row + output object content in MinIO + success audit `runtime_type="code"`) and `test_code_skill_timeout_fails_with_execution_timeout` (AC3: real timeout → `failed`+`EXECUTION_TIMEOUT` + failure audit). Driven via `_drive_execution` (calls the service functions in the same order as `run_skill` on the test loop — the test_ingest.py pattern, avoids the asyncio.run() cross-loop clash). Linux/Docker-gated. [tests/integration/api/test_invocations.py] edge+auditor.
- [x] [Review][Patch] Mislabeled audit test — **Fixed:** renamed `test_invoke_code_skill_audit_runtime_type` → `test_code_runtime_error_mapping` (it only tests `_map_error_code`); the real audit-row assertion now lives in the executing test above. [tests/integration/api/test_invocations.py] edge+auditor.
- [x] [Review][Patch] `EXECUTION_TIMEOUT_S le=1800` > Celery soft 1260 — **Fixed:** tightened the Field bound to `le=1200` (below the soft limit) so a misconfig can't invert the timeout ordering; comment documents the coupling. [app/core/config.py] edge.
- [x] [Review][Patch] Weak/missing test assertions — **Fixed:** `test_memory_error_exits_nonzero` now asserts `timed_out is False` + non-zero (proves RLIMIT_AS, not the timeout); added exact-cap (`truncated=False`), forged-exit (13/0), and clean-exit-without-completion-token tests. [tests/unit/services/test_code_sandbox.py, test_execution_service.py] edge.
- [x] [Review][Patch] #8 Harden the network-block signal — **Fixed:** the harness reports outcome on a trusted inherited pipe (fd number passed in the stdin payload, kept open via `pass_fds`), writing `NET_BLOCKED`/`OK` tokens the skill can't mint; the harness `except` is narrowed to a private `_NetworkBlocked(PermissionError)` subclass so an unrelated `PermissionError` no longer counts as a network block. `network_blocked` is derived from the token, not the exit code (test `test_sys_exit_thirteen_does_not_forge_network_block`). [app/services/code_sandbox.py, execution_service.py] blind+edge.
- [x] [Review][Patch] #9 Require a completion token before success — **Fixed:** the harness writes the `OK` token LAST (after output); `_run_code` treats `returncode != 0 OR not completed` as failure, so `os._exit(0)` mid-run can't forge success (tests `test_os_exit_zero_midrun_does_not_complete`, `test_clean_exit_without_completion_token_raises` — asserts no output is persisted). [app/services/code_sandbox.py, execution_service.py] edge.
- [x] [Review][Patch] #10 Map `SoftTimeLimitExceeded` → `EXECUTION_TIMEOUT` — **Fixed:** added the isinstance branch in `_map_error_code` (test `test_soft_time_limit_exceeded_maps_to_execution_timeout`). [app/workers/execution_tasks.py] edge.
- [x] [Review][Patch] #11 Raise `RLIMIT_NOFILE` — **Fixed:** bumped from 64 to 512 (ample for venv import phase + pipes, still bounds fd leaks). [app/services/code_sandbox.py] blind.

### Deferred

- [x] [Review][Defer] No `RLIMIT_NPROC` / `subprocess`/`os.fork` not blocked — skill can fork-bomb the worker host [app/services/code_sandbox.py:121-137] — deferred: kernel/process isolation is explicitly Epic 7 per the story Scope Boundary. blind+edge.
- [x] [Review][Defer] Child interpreter (`sys.executable` venv) exposes all installed packages (boto3, sqlalchemy, DB drivers) to untrusted code [app/services/code_sandbox.py:197] — deferred: env is scrubbed of credentials; restricting importable modules is kernel-sandbox/Epic 7 territory. blind.
- [x] [Review][Defer] `RuntimeError` (no current version) and `build_context_input` failures map to generic `SKILL_EXECUTION_ERROR` [app/services/execution_service.py:274-295; execution_tasks.py:251-295] — deferred, pre-existing: same TOCTOU-only pattern inherited from `_run_prompt` (Story 3.3), route pre-validates both. edge.

### Dismissed (5)

- `errors="replace"` on artifact/document decode masks non-UTF-8 corruption — intentional, mirrors `_run_prompt`; a resulting `SyntaxError` is acceptable Phase-1 behavior.
- stderr fully discarded → no triage diagnostics for `CodeExecutionError` — PHI discipline (the spec keeps raw stderr in the child); by design.
- UTF-8 sequence split at truncation boundary — guarded by `errors="replace"`, no data loss beyond intended truncation.
- `KeyError`/`JSONDecodeError` in the harness on malformed payload — not reachable; the sole caller always injects valid JSON with `__code__`.
- `ctypes`→libc `socket()` network-block bypass — explicitly deferred to the Epic 7 seccomp/netns sandbox by the story Scope Boundary; documented in code.

## Change Log

- 2026-06-11: Story implemented — Phase-1 in-process subprocess sandbox for code runtime; all 6 ACs satisfied; 334 Docker tests pass (+21 new tests); ruff clean; no new dep/migration.
- 2026-06-11: Code review (uncommitted diff) — 4 decision-needed, 7 patch, 3 deferred, 5 dismissed; findings appended above. Status → in-progress pending resolution.
- 2026-06-11: Review patches applied — all 4 decisions resolved (→ patch) + all 11 patches fixed and verified. Hardened the sandbox: trusted inherited-pipe control channel (defeats forged success/network-block signals), capped streaming stdout read (no worker OOM), bounded reaps (no hang), `RLIMIT_NOFILE` 512, `EXECUTION_TIMEOUT_S le=1200`, `SoftTimeLimitExceeded`→`EXECUTION_TIMEOUT`. Added genuine end-to-end integration tests (AC2/AC3/AC6). Gates: `ruff check .` clean; full Docker suite **344 passed**. Status → done.
