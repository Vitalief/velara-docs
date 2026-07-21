---
baseline_commit: TBD (velara-api) — set at dev-story pickup
---

# Story 15.5: Capture Code-Driven Hybrid Sandbox LLM Usage (Envelope Usage Contract + Adapter Enforcement)

Status: draft

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want a code-driven hybrid skill's real LLM token usage (spent inside its sandbox) to be captured and priced,
so that its per-execution cost is a true dollar figure — not a silent $0.00 that hides the single most expensive runtime we have.

**Why this is a real defect, not a nice-to-have (verified in source + live data):** Epic 15's investigation examined `execution_service.py`'s `_run_prompt`/`_run_hybrid`/`_run_code` and concluded "prompt/hybrid carry tokens; code carries none → price accordingly." It never examined the **code-driven hybrid** runtime (`app/services/code_driven_executor.py`), which is a *different* execution path: the skill makes its LLM calls **inside the sandboxed subprocess**, and the executor builds `result_metadata` (`code_driven_executor.py:707-719`) from the returned `CodeDrivenResultEnvelope` — which has **no reserved field for token usage** (`status`/`schema_version`/`canonical`/`artifacts`/`qa`/`billing_grid`, `code_driven_executor.py:102-118`). So the top-level `input_tokens`/`output_tokens`/`model` keys that `execution_tasks._extract_cost_fields` looks for are **never present**, and `_extract_cost_fields` mis-classifies every code-driven hybrid as a free "code run" → stores `cost_usd = Decimal("0")`.

**Confirmed on live data 2026-07-21:** a real `velara-protocol-extractor` run (job `49ea9ab2`) stored `cost_usd=0.000000` while actually spending **$1.38** (139,260 input + 27,252 output tokens on `claude-opus-4-8`, 8 LLM calls — the skill even self-reports `est_cost_usd: 1.3125` inside its **domain** `canonical.data.metadata` payload). That payload is one skill's private convention: `canonical` is typed as a bare `dict`, and nothing models or requires those keys, so reading them would hard-code a single skill's shape that future code-driven skills will not emit.

**Interim mitigation already applied (2026-07-21, NOT this story):** `_extract_cost_fields` now checks `result_metadata["runtime"]` — an LLM-using runtime (`_LLM_USING_RUNTIMES = {prompt, hybrid, code_driven_hybrid}`) with no reported usage stores `cost_usd=NULL` ("unknown"), not a lying `$0`. So today code-driven hybrids render "—", not "$0.00". **This story replaces "unknown" with the real number** by giving the envelope a first-class usage field and enforcing that skills populate it.

**This is a backend + contract story** (velara-api only). It changes the code-driven hybrid **envelope contract**, threads usage into the existing write-path pricing seam, and wires a missing-usage run into the **AI Adapter** (Epic 14 / `skill_integration_assistant.py`) as a runtime-triggered adaptation. No FE, no migration (15.1's columns already exist), no new audit event.

## Acceptance Criteria

1. **AC1 — The code-driven hybrid envelope has a first-class `usage` field.**
   `CodeDrivenResultEnvelope` (`code_driven_executor.py:102-118`) gains an optional `usage` field with a validated shape carrying `input_tokens: int | None`, `output_tokens: int | None`, and `model: str | None` (a small `BaseModel`, not a bare `dict`, so it is schema-validated like the rest of the envelope). It is **optional on the Pydantic model** (a non-conforming skill must still parse so it can be routed to the adapter per AC4 — a hard-required field would raise the generic `CODE_DRIVEN_ENVELOPE_ERROR` and lose the "missing usage" signal), but **semantically required by contract** (AC4 enforces its presence).

2. **AC2 — Reported usage is threaded to the write-path pricing seam and priced by our table.**
   When `envelope.usage` is present with token counts, `run_code_driven_hybrid`'s `result_metadata` (`code_driven_executor.py:707-719`) surfaces `input_tokens`/`output_tokens`/`model` at the **top level** (the keys `_extract_token_metadata` reads), so `_extract_cost_fields` prices them via `compute_cost_usd` against **our** `app/core/pricing.py` table — never the skill's self-reported `est_cost_usd` (which uses rates we do not control or audit). An unrecognized model behaves exactly as 15.1/AC3: `cost_usd=NULL`, tokens still recorded.

3. **AC3 — A code-driven hybrid that reports NO usage stores `cost_usd=NULL`, never `$0`.**
   Formalizes the interim fix as the permanent, tested contract for this runtime: absence of usage on an LLM-using runtime is "unknown" (NULL), because a run that made LLM calls is never free. A genuine `code` run (no LLM) still stores an explicit `cost_usd=0` per 15.1/AC4 — that behavior is unchanged. The discriminator is the `runtime` marker (`_LLM_USING_RUNTIMES`), not the mere absence of keys.

4. **AC4 — A completed code-driven hybrid with missing usage is an AI-Adapter trigger.**
   A code-driven hybrid whose envelope omits `usage` (or reports it empty) is a **contract violation** surfaced the same way `ENTRYPOINT_CONTRACT_VIOLATION` is today (`entrypoint_contract.py:48-73`): a typed error (`CODE_DRIVEN_USAGE_CONTRACT_VIOLATION` or equivalent, category-tagged like the existing contract errors) that makes the skill eligible for the AI Adapter's propose flow (`skill_integration_assistant.propose_adapter`, `skill_integration_assistant.py:952+`). The adapter proposes an entrypoint/adapter patch that makes the skill emit `usage` in its envelope. **The static entrypoint contract only validates the input signature (`validate_entrypoint_contract`, `entrypoint_contract.py:156-232`); it cannot inspect the return shape** — so enforcement is **runtime-observed → adapt** (the run completes once, then non-compliance is known and the adapter is offered), NOT a pre-execution static gate. This is the deliberate, documented model (chosen over manifest-declared-and-verified 2026-07-21).

5. **AC5 — The usage contract is documented for skill authors.**
   The code-driven hybrid entrypoint/envelope contract documentation (wherever the envelope shape is specified for skill authors — the docstring on `CodeDrivenResultEnvelope`, and any bundle/skill-authoring reference doc) states that an LLM-using code-driven hybrid MUST return `usage` with its token counts and model, and explains that omitting it makes the skill non-conforming (adapter-eligible) and its cost unknowable. `velara-protocol-extractor` is updated (or a bridge is documented) to emit `usage` from its existing internal counters — it already has `input_tokens`/`output_tokens`/`model` in hand, so this is a small change at its envelope-return site.

6. **AC6 — Existing runtimes and the "genuine code run = $0" case are provably unaffected.**
   Regular `hybrid` (`execution_service.py:1040-1049`) and `prompt` pricing are unchanged (they already surface top-level tokens). A `code` runtime with no LLM still stores `cost_usd=0`. Fan-out parent roll-up (`execution_tasks.py:632-640`) is unaffected. Tests assert each of these did not regress.

**Out of scope (do NOT touch):**
- The pricing table / `compute_cost_usd` (`app/core/pricing.py`) — reused as-is (the full model lineup was added in the 15.2 follow-up 2026-07-21).
- `_run_prompt` / `_run_hybrid` / `_run_code` LLM call sites and the regular hybrid write path — they already report usage correctly.
- Analytics aggregation (`analytics_service.py`) and the Job API/UI surfacing — 15.3 / 15.2 own those; once this story lands, a priced code-driven hybrid simply flows through the already-built read/display paths.
- Migration / `InvocationResult` columns — 15.1's columns already hold everything; this story only changes what gets written into them.
- The AI Adapter's authoring prompts / decision logic / `RejectNonGrantor` gate — this story adds a new *trigger signal*, it does not rewrite the propose flow.
- Manifest-declared-usage enforcement (the rejected "declare + verify at registration" model) — explicitly not built; enforcement is runtime-observed per AC4.

## Tasks / Subtasks

- [ ] **Task 1 — Add the `usage` field to the envelope contract (AC1) — `app/services/code_driven_executor.py`**
  - [ ] Define a small `CodeDrivenUsage(BaseModel)` with `input_tokens: int | None = None`, `output_tokens: int | None = None`, `model: str | None = None`.
  - [ ] Add `usage: CodeDrivenUsage | None = None` to `CodeDrivenResultEnvelope`. Optional on the model (so a non-conforming skill still parses — see AC1 rationale and AC4).
  - [ ] Update the `CodeDrivenResultEnvelope` docstring to state that `usage` is contractually required for any code-driven hybrid that makes LLM calls (AC5).

- [ ] **Task 2 — Thread reported usage into `result_metadata` top-level keys (AC2) — `app/services/code_driven_executor.py`**
  - [ ] In `run_code_driven_hybrid`'s `result_metadata` build (`:707-719`), when `envelope.usage` is present, add top-level `input_tokens`/`output_tokens`/`model` from it (the exact keys `_extract_token_metadata` reads at `execution_tasks.py:105`). Keep `runtime="code_driven_hybrid"` (the discriminator).
  - [ ] Do NOT read the skill's domain `canonical.data.metadata` — usage comes ONLY from the reserved `usage` field (that is the whole point of the contract).

- [ ] **Task 3 — Formalize NULL-not-$0 for missing usage (AC3) — `app/workers/execution_tasks.py`**
  - [ ] Confirm/keep the interim `_LLM_USING_RUNTIMES` discriminator in `_extract_cost_fields` (already applied 2026-07-21). Ensure `code_driven_hybrid` is in the set and covered by a test asserting NULL (not $0) when usage is absent.

- [ ] **Task 4 — Make missing usage an AI-Adapter trigger (AC4) — `code_driven_executor.py` + adapter seam**
  - [ ] Introduce a typed, category-tagged contract error (e.g. `CodeDrivenUsageContractViolation` / `CODE_DRIVEN_USAGE_CONTRACT_VIOLATION`) raised or recorded when a completed code-driven hybrid returns no `usage`. Model it on `EntrypointContractViolationError` (`entrypoint_contract.py:48-73`) incl. a `.category`.
  - [ ] Decide (and document) the surfacing point: because enforcement is post-execution, the run still COMPLETES (output is valid; only cost is unknown). The violation must be recorded/surfaced such that the skill becomes adapter-eligible WITHOUT failing the user's job. Options to resolve during dev/architect review: (a) attach a non-fatal contract-warning to the job/skill that the adapter route reads; (b) surface it on the skill's version state so the Integration Assistant offers a proposal. Pick the seam that matches how `ENTRYPOINT_CONTRACT_VIOLATION` already flows into `propose_adapter`.
  - [ ] Wire the adapter propose path (`skill_integration_assistant.py`) to recognize the new violation as a proposable case (an entrypoint patch that makes the skill emit `usage`). Reuse the existing static re-validation fail-closed seam (`skill_integration_assistant.py:1084-1092`) pattern.

- [ ] **Task 5 — Update the real skill + author docs (AC5) — `velara-protocol-extractor` + contract docs**
  - [ ] Update `velara-protocol-extractor`'s entrypoint to return `usage` (it already has `input_tokens`/`output_tokens`/`model` internally — the numbers currently buried in its domain `canonical.data.metadata`). NOTE: this skill lives OUTSIDE the repo (per [[project-client-skill-contract]] it is in ~/Downloads / client-provided) — coordinate the change or document a temporary read-bridge with an explicit removal trigger.
  - [ ] Document the `usage` requirement in the code-driven hybrid authoring/contract reference.

- [ ] **Task 6 — Tests (AC2, AC3, AC4, AC6)**
  - [ ] Envelope with `usage` present → `result_metadata` has top-level tokens → priced correctly (`test_execution_tasks.py` seam-style, mirroring `test_cost_persisted_for_hybrid_runtime_known_model`).
  - [ ] Envelope with NO `usage` on `runtime=code_driven_hybrid` → `cost_usd=NULL` (already added 2026-07-21: `test_cost_null_not_zero_for_llm_runtime_missing_usage`).
  - [ ] Genuine `code` run (no runtime marker) → still `cost_usd=0` (existing `test_cost_persisted_for_code_runtime_is_explicit_zero` — assert unchanged).
  - [ ] Unknown model in `usage` → NULL, tokens still recorded (mirror `test_cost_unknown_model_is_null_not_mispriced`).
  - [ ] The contract-violation → adapter-eligible path (new): a completed code-driven hybrid with no usage produces the typed violation / adapter-eligibility signal.
  - [ ] `CodeDrivenResultEnvelope.model_validate` still accepts a well-formed envelope both WITH and WITHOUT `usage` (no `CODE_DRIVEN_ENVELOPE_ERROR` for the missing-usage case — that must reach the adapter, not fail as malformed).

- [ ] **Task 7 — Gates**
  - [ ] Rebuild the api + worker images before pytest (source is baked). Run with `AUTH_BACKEND=dev`.
  - [ ] Green: `tests/integration/workers/test_execution_tasks.py`, `tests/unit/core/test_pricing.py`, the code-driven executor tests, the integration-assistant/adapter tests, then the full suite. Note the documented pre-existing flake (`test_repeated_denials_are_deduped`).
  - [ ] `ruff check` on all changed BE files → clean.
  - [ ] If any envelope-shape change alters `docs/api-spec.json`, regenerate + commit it (the envelope is internal, so likely no spec diff — confirm).

## Dev Notes

### The core insight: code-driven hybrid is a THIRD LLM-using runtime the epic missed

Epic 15 modeled three runtimes (`prompt`, `hybrid`, `code`) and priced them by "are top-level tokens present." But `code_driven_hybrid` (`code_driven_executor.py`) is a fourth path where the LLM calls happen inside the sandbox and the usage is not surfaced in the envelope. So the "no tokens = free code run" discriminator silently mis-prices the single most expensive runtime. The interim fix (NULL-not-$0) stops the *lie*; this story restores the *truth* by making the sandbox report usage through a reserved contract field.

### Why NOT read the skill's `canonical.data.metadata` (the tempting shortcut)

The real skill DOES emit `input_tokens`/`output_tokens`/`model`/`est_cost_usd`/`n_llm_calls` — but inside its **domain** canonical payload, mixed with clinical data (`soa_pages`, `page_count`). `canonical` is a bare `dict`; those keys are un-modeled, un-validated, and specific to this one skill. Reading them hard-codes a private convention that the next code-driven skill author has no reason to follow — re-arming the exact $0 bug for every future skill. The reserved `usage` field + adapter enforcement is what makes it a *contract*, not a lucky read.

### Enforcement is runtime-observed, not static (the key constraint)

`validate_entrypoint_contract` (`entrypoint_contract.py:156-232`) statically checks only the entrypoint's INPUT signature (`sig.bind(input_path=None, output_dir=None, params={})`). There is no static inspection of what the skill RETURNS — the envelope is only validated at execution time (`code_driven_executor.py:588`). You cannot statically prove a Python function will populate `usage`. So "must report usage" is enforced by: run once → observe missing usage → mark adapter-eligible → adapter proposes the patch. This mirrors how `ENTRYPOINT_CONTRACT_VIOLATION` already becomes a `propose_adapter` trigger. (The rejected alternative — declare `emits_usage` in the manifest and verify at registration — was considered and set aside 2026-07-21 for being a heavier manifest-schema change; runtime-observed adaptation reuses existing machinery.)

### Cost source = OUR pricing table, always

When `usage` reports tokens+model, price via `compute_cost_usd` against `app/core/pricing.py` (full Anthropic lineup added in the 15.2 follow-up 2026-07-21). Never store the skill's self-reported `est_cost_usd` — it uses rates we don't control or audit, and the whole point of the pricing table is one auditable source of truth ([[project-llm-pricing-table]]).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-15-per-execution-cost-tracking.md] — parent epic; this story closes the code-driven-hybrid gap the epic's investigation did not cover.
- [Source: _bmad-output/implementation-artifacts/stories/15-1-persist-structured-per-execution-cost.md] — AC4 "code run = $0" (the assumption that mis-fires for code-driven hybrids); the `_extract_cost_fields` seam.
- [Source: velara-api/app/services/code_driven_executor.py#L102-L118] — `CodeDrivenResultEnvelope` (add `usage`).
- [Source: velara-api/app/services/code_driven_executor.py#L707-L719] — `result_metadata` build (thread usage to top-level keys).
- [Source: velara-api/app/services/code_driven_executor.py#L588] — the ONLY envelope validation point (execution-time).
- [Source: velara-api/app/workers/execution_tasks.py#L105-L153] — `_extract_token_metadata` / `_extract_cost_fields` + the `_LLM_USING_RUNTIMES` interim discriminator (2026-07-21).
- [Source: velara-api/app/services/entrypoint_contract.py#L48-L73,#L156-L232] — `EntrypointContractViolationError` (category-tagged model for the new violation) + static signature-only validation (why enforcement is runtime-observed).
- [Source: velara-api/app/services/skill_integration_assistant.py#L952-L1121,#L1084-L1092] — `propose_adapter` flow + fail-closed static re-validation seam to reuse.
- [Source: velara-api/app/services/skill_service.py#L493-L548] — registration-time static contract check (does NOT inspect return shape).
- [Source: velara-api/app/core/pricing.py] — `compute_cost_usd` + full model lineup (reuse; do not modify). See [[project-llm-pricing-table]].
- [Source: velara-api/app/services/code_driven_hybrid.py#L144] — `REQUIRED_MANIFEST_FIELDS` (the manifest contract; unchanged unless the rejected declare-and-verify model is revisited).

## Change Log

- 2026-07-21 — Drafted Story 15.5 after a live code-driven hybrid job (velara-protocol-extractor) reported $0.00 for a ~$1.38 execution. Root cause: code-driven hybrid LLM calls happen inside the sandbox and their usage is never surfaced in the `CodeDrivenResultEnvelope` (no usage field), so `_extract_cost_fields` mis-classified them as free code runs. Interim NULL-not-$0 discriminator applied to `execution_tasks.py` immediately; this story adds a first-class envelope `usage` contract, threads it into the existing write-path pricing seam, and makes a missing-usage run an AI-Adapter trigger (runtime-observed enforcement — the static contract checks only the input signature, so usage can't be gated pre-execution). Backend + contract only; no migration, no FE, no new audit event.
