---
baseline_commit: 26ea562 (velara-api, branch development) / eda4a2f (velara-web, branch story/14-2-ai-adapter-upgrade-path)
---

# Story 15.4: Cost the AI-Assisted Skill-Adaptation LLM Call

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want the AI integration assistant's propose calls (both new-skill registration and Story 14.2's upgrade path) to record their computed dollar cost, not just raw token counts,
so that adaptation spend is visible in the same audited, priced way execution spend is — currently it is the only remaining LLM call in the system with tokens captured but never priced.

**Why this is the right shape (verified in source):** This is the epic's **light** story — a computed field added alongside data that already exists, on a **separate write path** from skill execution. The adapter-propose LLM call already captures `llm_model`/`llm_input_tokens`/`llm_output_tokens`/`llm_stop_reason` (an `AdapterProposal` on success, an `LLMResult` off a typed exception on failure), and already writes them into the `admin.skill_adapter_proposed` audit event's `metadata` JSONB at **two** call sites in `skills.py` (success + failure). Neither site prices them. This story imports the exact `compute_cost_usd` from `app/core/pricing.py` that Story 15.1 relocated (already the single source of truth — Story 15.3 confirmed it), computes `cost_usd` from the already-captured usage at both sites, and stores it in the same `metadata` dict. No new column, no new audit event, no new endpoint, no migration.

**This is a full-stack story** (velara-api + velara-web) but a small one. The BE change is two `metadata`-dict additions plus a shared pricing helper call; the FE change is a single formatted row in the existing generic audit-metadata renderer. `docs/api-spec.json` **does not change** — `cost_usd` lands inside the untyped `metadata: dict` JSONB, not a typed response schema (unlike 15.2/15.3 which added typed fields). Confirm this in the gates.

## Acceptance Criteria

1. **AC1 — Adapter-propose cost is computed using the same pricing table as execution.**
   **Given** an adapter-propose LLM call that captured `llm_model`/`llm_input_tokens`/`llm_output_tokens` (on either the success or failure path)
   **When** the `admin.skill_adapter_proposed` audit event is written
   **Then** `cost_usd` is computed by calling `app.core.pricing.compute_cost_usd(model=..., input_tokens=..., output_tokens=...)` — the **exact same** function the execution write path uses (`execution_tasks.py`), no second pricing table, no duplicated per-model rates. An **unrecognized model** behaves identically to Story 15.1/AC3 and 15.5's hard lesson: `compute_cost_usd` returns `None` for an unknown model, and that `None` is stored as `cost_usd: null` (JSON null) in the metadata — **never** a silently-wrong default price, and **never** a fabricated `$0`. The `compute_cost_usd` call itself already emits the `pricing_unrecognized_model` warning log; this story does not add a second warning.

2. **AC2 — Both the success and failure audit-write sites get `cost_usd`.**
   **Given** the two existing `admin.skill_adapter_proposed` write sites — the **success path** (`skills.py:518-536`, reading `proposal.llm_*`) and the **failure path** (`skills.py:491-506`, reading `failed_llm_result.*`, the AC8 "a failed call still audits its spend" case)
   **When** either site writes its `metadata` dict
   **Then** each dict gains a `cost_usd` key alongside the existing `llm_model`/`input_tokens`/`output_tokens`/`stop_reason` — preserving the existing AC8 guarantee that a failed propose call still has its spend attributed, now **priced** as well as counted. The two sites read usage from **different objects with different attribute names** (success: `proposal.llm_model`/`proposal.llm_input_tokens`/`proposal.llm_output_tokens`; failure: `failed_llm_result.model`/`.input_tokens`/`.output_tokens`) — both must be handled correctly.

3. **AC3 — Partial / absent usage prices to `null`, never a fabricated `$0` (the 15.5 headline trap, applied here).**
   **Given** a propose call where usage is incomplete or absent — the success-path "no LLM call was needed" case (`AdapterProposal` carries `llm_model=None`, `llm_input_tokens=None`, `llm_output_tokens=None` when the client's declared entrypoint already conformed; see `skill_integration_assistant.py:150-157`), OR a model that is present but with a `None` token split
   **When** cost is computed
   **Then** `cost_usd` is `null` (unknown/nothing-to-price), **not** `$0`. Concretely: if `llm_model is None`, do **not** call `compute_cost_usd` at all (it would return `None` anyway, but skipping is clearer and avoids the spurious `pricing_unrecognized_model` warning for a legitimately-absent call) — store `cost_usd: null`. This mirrors Story 15.5's proven bug class: `compute_cost_usd` coerces `None` tokens via `input_tokens or 0`, so **a present model with a `None` token split would compute a real (under-)price, not null** — but for this write path that is acceptable and correct **only if** both token counts are genuinely present; if the model is present but tokens are `None`, the honest value is `null` (unpriceable), so gate the compute on model-present-AND-both-token-counts-present. See Dev Notes "The 15.5 partial-usage trap" for the exact guard.

4. **AC4 — No new column, no new audit event type, no new endpoint, no migration, no `docs/api-spec.json` change.**
   **Given** the intentionally lighter-weight design (adapter-propose calls are low-volume, admin-gated via `RejectNonGrantor`, already queryable via the existing Audit Log API/UI)
   **When** this story ships
   **Then** `cost_usd` lands **inside** the existing `metadata` JSONB on the existing `admin.skill_adapter_proposed` event — no `InvocationResult`-style structured column, no new event constant, no per-skill/per-user rollup surface, no schema/OpenAPI change. If a future story needs aggregation over adapter-propose spend, promoting it to a structured column then is the natural next step — **not** preemptively built here. `git status`/`git diff` must show **zero** change to migrations, `app/core/pricing.py` itself, `execution_tasks.py`, any `*.py` schema in `app/schemas/`, and `docs/api-spec.json`.

5. **AC5 — Audit Log UI shows the cost, formatted as currency.**
   **Given** the existing Audit Log detail panel (Story 9.3: `AuditDetailPanel.tsx`), which renders an entry's `metadata` as a **generic key/value dump** (`Object.entries(entry.metadata).map(...)`, `:102-109`) with no per-field formatting
   **When** it renders an `admin.skill_adapter_proposed` entry whose `metadata` now contains `cost_usd`
   **Then** the `cost_usd` value is displayed **formatted as currency via the existing `fmtUsd` helper** (`@/features/analytics/analyticsFormat`) — the same formatter every other cost figure in the system uses — **not** as the raw stringified number the generic dump would otherwise produce (`0.006105` → must render `$0.01`, not `"0.006105"`). A `cost_usd: null` (unpriceable) row renders `"—"` (mirroring the `fmtCost` null-guard pattern in `JobsHistory.tsx`/`RunConsole.tsx`), never `"$NaN"` or a blank that reads as "unknown by omission." This is an **extension of the existing generic metadata renderer** (special-case the `cost_usd` key inside the existing map), not a new UI surface.

**Out of scope (do NOT touch):**
- `propose_adapter`'s decision logic, the adapter-authoring prompts, the manifest-synthesis logic, or the `RejectNonGrantor` gate — this story only adds a computed field alongside data that already exists.
- Per-skill / per-adapter-call **aggregation** surface (a "total adapter spend" rollup) — explicitly deferred per AC4; the value is queryable per-event via the existing Audit Log, that is sufficient for now.
- `app/core/pricing.py` itself — this story **imports** `compute_cost_usd`, it does **not** add/change a pricing rate or the table (Story 15.1 owns that; 15.5 last expanded it). No edit to that file.
- The **execution** write path (`execution_tasks.py`, `InvocationResult`, `job_service`) — that is Stories 15.1/15.2/15.3/15.5; this is a separate write path (`audit_log_entries`, not `invocation_results`).
- Any `Client*` schema/route or client-portal FE — adapter-propose is admin-only (`RejectNonGrantor`); clients never reach it.
- The generic `formatMetaValue` helper (`auditFormat.ts:51-61`) and every **other** metadata key's rendering — only the `cost_usd` key gets special-cased; all other keys keep their existing generic dump. Do not reformat `input_tokens`/`output_tokens`/`llm_model`/`stop_reason`/etc.

## Tasks / Subtasks

- [x] **Task 1 — Add a small cost helper + import `compute_cost_usd` (AC1, AC3) — `velara-api/app/api/v1/skills.py`**
  - [x] Add the import `from app.core.pricing import compute_cost_usd` (top-level import block of `skills.py`; the file currently imports **nothing** cost-related — verified). Follow the file's existing import ordering/grouping convention.
  - [x] Add a tiny module-level (or inline-in-function) helper that computes the priced value defensively, e.g.:
    ```python
    def _adapter_cost_usd(*, model, input_tokens, output_tokens):
        # Unpriceable unless we have BOTH a model AND a real token split.
        # A present model with a None token split would let compute_cost_usd's
        # `input_tokens or 0` fabricate an under-price — that is the Story 15.5
        # partial-usage trap. Honest answer for incomplete usage is None (null).
        if model is None or input_tokens is None or output_tokens is None:
            return None
        cost = compute_cost_usd(
            model=model, input_tokens=input_tokens, output_tokens=output_tokens
        )
        return float(cost) if cost is not None else None
    ```
  - [x] **Return `float | None`, not `Decimal | None`.** `compute_cost_usd` returns a `Decimal` (or `None`). This value goes into a JSONB `metadata` dict that is JSON-serialized on the audit-log read path — a bare `Decimal` is not JSON-serializable and would either 500 the audit-query response or be silently coerced inconsistently. Cast the non-None result to `float` (matching the `token_cost: float` / analytics wire convention, and the fact that `metadata` is untyped JSONB where a float round-trips cleanly). Confirm how the OTHER numeric metadata values (`input_tokens`, etc.) are stored today — they are plain ints, JSON-native; `float` is the JSON-native analogue for the dollar figure.
  - [x] Do **not** re-quantize/round beyond what `float(Decimal)` does — `fmtUsd` on the FE handles display rounding to cents. Storing the full-precision float keeps the stored fact faithful (mirrors how `InvocationResult.cost_usd` stores `Numeric(12,6)`, not a pre-rounded 2-dp figure).

- [x] **Task 2 — Price the success-path audit write (AC1, AC2, AC3) — `velara-api/app/api/v1/skills.py:518-536`**
  - [x] In the success-path `metadata={...}` dict (currently `:525-531`, inside the `try` at `:518`), add `"cost_usd": _adapter_cost_usd(model=proposal.llm_model, input_tokens=proposal.llm_input_tokens, output_tokens=proposal.llm_output_tokens)`.
  - [x] Keep all existing keys unchanged (`llm_model`, `input_tokens`, `output_tokens`, `stop_reason`, `proposal_non_conforming`). Only **add** `cost_usd`.
  - [x] The "no LLM call was needed" success case (`proposal.llm_model is None`, all `llm_*` None — the conforming-entrypoint path per `skill_integration_assistant.py:150-157`) flows through the helper's model-None guard → `cost_usd: None`. Verify this is what happens (do not special-case it separately).

- [x] **Task 3 — Price the failure-path audit write (AC1, AC2, AC3) — `velara-api/app/api/v1/skills.py:491-506`**
  - [x] In the failure-path `metadata={...}` dict (currently `:498-505`, inside the `if failed_llm_result is not None:` block at `:490`), add `"cost_usd": _adapter_cost_usd(model=failed_llm_result.model, input_tokens=failed_llm_result.input_tokens, output_tokens=failed_llm_result.output_tokens)`.
  - [x] **Note the different attribute names** on this path: `failed_llm_result` is an `LLMResult` (`.model`/`.input_tokens`/`.output_tokens`), NOT an `AdapterProposal` (`.llm_model`/`.llm_input_tokens`/`.llm_output_tokens`). Do not copy-paste the success-path attribute names here.
  - [x] Keep all existing keys unchanged (`llm_model`, `input_tokens`, `output_tokens`, `stop_reason`, `outcome`, `error_code`). Only **add** `cost_usd`. This failure site only runs when `failed_llm_result is not None` (an actual paid call was made before the failure), so `model`/tokens are present on `LLMResult` (non-optional there) and cost will normally be a real figure — but the helper still guards defensively.

- [x] **Task 4 — Backend tests (AC1, AC2, AC3) — `velara-api/tests/integration/api/test_skills.py`**
  - [x] **Extend the existing success-audit test** `test_propose_synthesis_records_audit_with_tokens` (`:3849`) — it already stubs the LLM to `claude-opus-4-8`, `input_tokens=111`, `output_tokens=222` and asserts those in the metadata. Add: `assert items[0]["metadata"]["cost_usd"] == pytest.approx(0.006105)`. **Derivation:** opus-4-8 = $5/MTok in, $25/MTok out → `111 * 5/1_000_000 + 222 * 25/1_000_000 = 0.000555 + 0.005550 = 0.006105`. (Confirm the fixture's rates match `_MODEL_PRICING_PER_MTOK` at import — if the stubbed model or token counts differ in the current file, recompute from the actual stub values; do not hard-code `0.006105` blindly — read the test's actual `_synthesis_llm_response`/`_FakeLLMProvider` stub first.)
  - [x] **Extend the existing failure-audit test** `test_propose_synthesis_failed_call_still_audits_tokens` (`:3881`) — same stub (opus-4-8, 111/222). Add `assert failure_rows[0]["metadata"]["cost_usd"] == pytest.approx(0.006105)` alongside the existing token/error_code asserts. This proves AC2's failure-path pricing.
  - [x] Also extend the older non-synthesis audit test `test_propose_adapter_audit_event_recorded` (`:3516`) if it asserts token metadata — add the matching `cost_usd` assertion using its own stub's model/token values (read the stub; it may use a different model/counts than the synthesis tests).
  - [x] **New test — unknown-model prices to null (AC1/AC3):** add a test that stubs the LLM to return a model **not** in `_MODEL_PRICING` (e.g. `"claude-nonexistent-9"`) with real token counts, drives a propose call, and asserts the audit row's `metadata["cost_usd"] is None` (JSON null) — never `0`, never a fabricated price. Reuse the existing `_FakeLLMProvider`/`_synthesis_llm_response` stub shape with an unknown model string.
  - [x] **New test — no-LLM-call success prices to null (AC3):** if a fixture exists for the "conforming entrypoint, no LLM call" success path (where `AdapterProposal.llm_model is None` — see `test_propose_synthesis_manifest_only_for_conforming_entrypoint` at `:3624`, which may exercise this), assert its audit row's `metadata["cost_usd"] is None`. If that test does not write an audit row / does not exercise the None-usage path, add a focused test that does. Confirm against source whether the conforming path writes the success audit event at all — if it writes with all-None `llm_*`, `cost_usd` must be null there too.
  - [x] Keep every existing assertion in these tests green — this story only **adds** `cost_usd` assertions and does not change any existing token/model/outcome/error_code assertion.

- [x] **Task 5 — FE: render `cost_usd` as currency in the audit detail panel (AC5) — `velara-web/src/features/audit/components/AuditDetailPanel.tsx`**
  - [x] Import `fmtUsd`: `import { fmtUsd } from '@/features/analytics/analyticsFormat'` (currently NOT imported in this file — the audit feature does not use `fmtUsd` today; this is the first cross-import from analytics into audit, matching how `JobsHistory`/`RunConsole` already import it). Confirm the `@/` alias resolves (it does elsewhere in the file's imports).
  - [x] In the generic metadata map (`:102-109`), special-case the `cost_usd` key so it renders via `fmtUsd` instead of the generic `formatMetaValue`. The value is typed `unknown` (`metadata: Record<string, unknown>`), so narrow it: render `typeof value === 'number' ? fmtUsd(value) : '—'` for the `cost_usd` key. A `null`/absent `cost_usd` → `'—'` (never `$NaN`). Suggested minimal shape inside the map's `<span>`:
    ```tsx
    {key === 'cost_usd'
      ? (typeof value === 'number' ? fmtUsd(value) : '—')
      : formatMetaValue(value)}
    ```
  - [x] Do **not** reformat any other key — `input_tokens`, `output_tokens`, `llm_model`, `stop_reason`, `outcome`, `error_code`, `proposal_non_conforming` all keep the generic `formatMetaValue` rendering. Only `cost_usd` is special-cased.
  - [x] Do **not** add a separate dedicated field-row (like the Job ID row at `:69-80`) — the epic AC says "an extension of the existing detail-panel metadata rendering," and a `cost_usd` key is only present on `skill_adapter_proposed` events; keeping it inside the generic metadata block (which only renders when metadata is non-empty) is the lighter, correct placement. (A dedicated row would also need to be conditionally hidden for every non-adapter event, which the generic block already handles for free.)

- [x] **Task 6 — FE tests (AC5) — `velara-web/src/features/audit/components/AuditLog.test.tsx`**
  - [x] The detail-panel test already seeds `metadata` (`:86`) and opens the detail panel (assertions at `:347-349`), but asserts **nothing** about metadata content today. Add `cost_usd` to a seeded `skill_adapter_proposed`-style entry's metadata (e.g. `cost_usd: 0.006105`) and assert the panel renders the **formatted** figure — `screen.getByText('$0.01')` (fmtUsd rounds 0.006105 to 2 dp → `$0.01`; verify the exact rounded string `Intl.NumberFormat` produces for your seeded value before asserting).
  - [x] Add a second assertion (or a second seeded entry) covering the null case: a metadata with `cost_usd: null` renders `'—'`, never `'$NaN'`. Follow the file's existing detail-open pattern (find the entry, click/open, `getByText`).
  - [x] Confirm `npm run typecheck` passes — the `unknown`-narrowing in Task 5 must satisfy `tsc` (the `typeof value === 'number'` guard is what makes `fmtUsd(value)` type-check against `metadata: Record<string, unknown>`).

- [x] **Task 7 — Gates**
  - [x] **BE:** rebuild the api image before pytest (`docker compose build api` — source is baked, not mounted — the documented Epic 15 gotcha). Run with `AUTH_BACKEND=dev` (`docker-compose.yml` defaults `api` to `cognito`, which 401s dev-token tests — the documented gotcha hit in Stories 15.2/15.3/15.6). Green: `tests/integration/api/test_skills.py` (full file, including the extended + new propose-audit cost tests), then the full suite. Note the one documented pre-existing flake (`test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped`) so it is not mistaken for a regression.
  - [x] `ruff check` on all changed BE files → clean.
  - [x] **Confirm the negative-space AC4 invariants via `git status`/`git diff`:** the **only** BE files changed are `app/api/v1/skills.py` and `tests/integration/api/test_skills.py`. **No** migration, **no** edit to `app/core/pricing.py`, **no** edit to `app/workers/execution_tasks.py`, **no** change to any `app/schemas/*.py`, and — critically — **no** `docs/api-spec.json` diff (`cost_usd` lives in untyped JSONB, not a typed schema; if the spec changed, something is wrong — investigate before committing).
  - [x] **FE:** `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint`), `npm test` (`vitest run`) — all clean/green. Only `AuditDetailPanel.tsx` and `AuditLog.test.tsx` should change on the FE side (no new interface/type file — `metadata` stays `Record<string, unknown>`).

## Dev Notes

### The two write sites read usage from two different object shapes — do not conflate them

The single most common way to break this story is to copy the success-path field names onto the failure path (or vice versa). They are genuinely different objects:

- **Success path** (`skills.py:518-536`): reads from `proposal`, an `AdapterProposal` **dataclass** (`skill_integration_assistant.py:136-160`). Fields are `llm_`-prefixed: `proposal.llm_model`, `proposal.llm_input_tokens`, `proposal.llm_output_tokens`, `proposal.llm_stop_reason`. **All four are `X | None`** — they are `None` when the client's declared entrypoint already conformed and no LLM call was made (`skill_integration_assistant.py:150-157`, an honest "no spend" signal). So the success path legitimately produces `cost_usd: null` for the conforming-entrypoint case.
- **Failure path** (`skills.py:491-506`): reads from `failed_llm_result = getattr(propose_exc, "llm_result", None)` (`:489`), an `LLMResult` (`anthropic_client.py:32-42`) pulled off a typed exception (`AdapterProposalParseError` / `ManifestSynthesisError`, which carry `.llm_result`). Fields are **un-prefixed**: `failed_llm_result.model`, `.input_tokens`, `.output_tokens`, `.stop_reason`. On `LLMResult`, `model`/`input_tokens`/`output_tokens` are non-optional (a real paid call happened), and this failure block only runs `if failed_llm_result is not None` — so cost is normally a real figure here.

The `_adapter_cost_usd` helper (Task 1) normalizes both by taking `model`/`input_tokens`/`output_tokens` as keyword args — call it with the right attribute names at each site.

### The 15.5 partial-usage trap — why the helper guards on ALL THREE being present, not just model

This is the epic's own hard-won lesson ([[project-story-15-5-review]]), and it applies verbatim here. `compute_cost_usd` (`pricing.py:87-92`) does `in_tokens = input_tokens or 0` / `out_tokens = output_tokens or 0` — so if you call it with a **present model but a `None` token split**, it does **not** return `None`; it fabricates a real (wrong, under-counted) price by treating the missing tokens as zero. In Story 15.5 this exact pattern — a usage report carrying `model` but no token counts — threaded `None`s that passed a key-presence filter and let `input_tokens or 0` store a lying `$0`. The fix required gating cost computation on **both** the model AND both token counts being genuinely present:

```python
if model is None or input_tokens is None or output_tokens is None:
    return None   # unpriceable / incomplete → null, NEVER a fabricated figure
```

Do not "simplify" this to just `if model is None`. A present model with `None` tokens is exactly the shape that fabricates the forbidden `$0`. (In practice the `LLMResult` failure path always has both tokens, and the `AdapterProposal` success path has either all-three or all-None — but the guard is the contract, not an assumption about current callers.)

### Why `null`, not `$0`, for unpriceable — and why that is different from execution's `code`-run `$0`

Story 15.1/AC4 stores an explicit `cost_usd=0` for a genuine **code-runtime** invocation (there is truly nothing to price — no LLM call). That is a real, correct `$0`. This story has no such "genuinely free" case: an adapter-propose call that reached the LLM incurred real spend; one that did not (`llm_model is None`, conforming entrypoint) incurred **no** spend but also has **no model to price against** — the honest representation is `null` (unknown/not-applicable), not `$0`. Storing `$0` for a no-LLM-call propose would be indistinguishable from "a call that cost exactly zero," which is not a thing that happens. `null` → UI `"—"` correctly communicates "no priced call here." This is the same null-vs-zero discipline the whole epic turns on.

### `cost_usd` must be `float`, not `Decimal`, in the metadata dict

`compute_cost_usd` returns a `Decimal` (`pricing.py:68-92`, exact-Decimal money math, no float). But `metadata` is JSONB serialized on the audit read path (`GET /api/v1/audit` → JSON response). A raw `Decimal` is not JSON-serializable and would break serialization (or be coerced inconsistently depending on the encoder). Cast to `float` in the helper (Task 1). This is a display/wire figure at this layer, not a money-arithmetic figure — the exact-Decimal invariant matters at the **execution** write path where costs are summed (`InvocationResult.cost_usd` is `Numeric(12,6)`); here it is a single leaf value rendered once via `fmtUsd`, so `float` is correct and matches the sibling ints in the same dict being JSON-native. (Contrast Story 15.2, which added a `field_serializer` to coerce a stored `Decimal` column to float on a **typed** schema — there is no typed schema here, so no serializer; the `float()` cast in the helper is the equivalent.)

### The FE renderer is a generic dump — a raw `cost_usd` key would auto-appear WRONG, so you must special-case it

`AuditDetailPanel.tsx:97-112` renders `metadata` as `Object.entries(entry.metadata).map(...)` with each value passed to `formatMetaValue` (`auditFormat.ts:51-61`), which `String()`s primitives. So if you do nothing on the FE, `cost_usd` **will still appear** — but as a raw stringified float (`0.006105` → `"0.006105"`, no `$`, no cents). AC5 requires currency formatting, so you must special-case the `cost_usd` key inside the map to call `fmtUsd` (Task 5). This is a real behavior change even though the key "already renders" — do not skip Task 5 thinking the generic dump is sufficient. `metadata` is typed `Record<string, unknown>` (`api/audit.ts:36`), so narrow the value with `typeof value === 'number'` before `fmtUsd(value)` (which takes a `number` and has no null guard — returns `$NaN` for null/non-number).

### `fmtUsd` has no null guard — the `'—'` fallback is on you

`fmtUsd(n: number)` (`analyticsFormat.ts:14-22`) formats via `Intl.NumberFormat` currency; passed `null`/`undefined`/a string it produces `"$NaN"`. `JobsHistory.tsx:23-26` and `RunConsole.tsx:66-69` established the null-safe idiom `fmtCost(v) => v == null ? '—' : fmtUsd(v)`. Here, since the value is `unknown` from JSONB, fold the guard into the narrow: `typeof value === 'number' ? fmtUsd(value) : '—'`. A `cost_usd: null` (unpriceable) or absent key → `'—'`.

### Files being modified (read current state before editing)

**velara-api:**
- `app/api/v1/skills.py` — add `from app.core.pricing import compute_cost_usd` (top imports); add `_adapter_cost_usd` helper; add `"cost_usd": ...` to the success-path metadata dict (`:525-531`, reading `proposal.llm_*`) and the failure-path metadata dict (`:498-505`, reading `failed_llm_result.*`). No other change to the route (`propose_skill_adapter`, `:405`) — decision logic, `RejectNonGrantor` guard, synthesis logic all untouched.
- `tests/integration/api/test_skills.py` — extend `test_propose_synthesis_records_audit_with_tokens` (`:3849`), `test_propose_synthesis_failed_call_still_audits_tokens` (`:3881`), and (if it asserts tokens) `test_propose_adapter_audit_event_recorded` (`:3516`) with `cost_usd` asserts; add an unknown-model→null test and a no-LLM-call→null test.
- **Untouched:** `app/core/pricing.py`, `app/workers/execution_tasks.py`, all `app/schemas/*.py`, `app/services/skill_integration_assistant.py` (read-only — its `AdapterProposal` shape is consumed, not changed), all migrations, `docs/api-spec.json`.

**velara-web:**
- `src/features/audit/components/AuditDetailPanel.tsx` — import `fmtUsd`; special-case the `cost_usd` key in the metadata map (`:102-109`).
- `src/features/audit/components/AuditLog.test.tsx` — seed `cost_usd` in a detail-panel entry's metadata; assert the formatted figure renders + the null case renders `'—'`.
- **Untouched:** `src/api/audit.ts` (`metadata` stays `Record<string, unknown>` — no typed field added), `auditFormat.ts` (`formatMetaValue` unchanged), `eventTypeIconMeta.ts`, any analytics/client-portal file.

### Testing standards

- **BE:** pytest under `docker compose exec -e AUTH_BACKEND=dev api`; **rebuild the api image first** (`docker compose build api`). The existing propose tests use `_FakeLLMProvider(_synthesis_llm_response(...))` to stub the LLM with deterministic token counts (`input_tokens=111`, `output_tokens=222`, `model="claude-opus-4-8"`) and `_override_llm_provider`/`_clear_llm_override` to install/remove the stub — reuse this exact harness for the new tests; do not invent a new stubbing convention. Assert cost via the `GET /api/v1/audit?event_type=admin.skill_adapter_proposed` response's `metadata["cost_usd"]` (the same read path the tests already use for `input_tokens`/`output_tokens`). Use `pytest.approx(...)` for the float cost (avoid exact float `==`).
- **FE:** vitest + `@testing-library/react`; extend `AuditLog.test.tsx`. Gates: `npm run typecheck`, `npm run lint`, `npm test`.

### Project Structure Notes

- No new files on either side — all edits land in existing route/test/component/test files. No migration, no new module, no new route, no new schema, no OpenAPI change.
- FE `metadata` is deliberately left untyped (`Record<string, unknown>`) — do **not** introduce a typed `SkillAdapterProposedMetadata` interface for this one field; the generic renderer + a single key special-case is the established, lighter pattern (matches how every other `skill_adapter_proposed` metadata key is rendered today).
- velara-api is on branch `development` at `26ea562` (Story 15.3's api commit, tip of branch) — implement on top of this baseline.
- velara-web is still on branch `story/14-2-ai-adapter-upgrade-path` at `eda4a2f` (a known housekeeping state noted since 14.2/15.2/15.3 — not switched back to `main`/`development`). Implement here; code-review handles branch/commit hygiene per the never-push-subrepos rule (dev-story does **not** commit the subrepos — only the top-level docs repo).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-15-per-execution-cost-tracking.md#Story 15.4] — the epic-level ACs this story implements.
- [Source: _bmad-output/implementation-artifacts/stories/15-3-per-skill-and-per-user-cost-analytics.md] — confirmed `compute_cost_usd`/`_MODEL_PRICING` is already the single pricing source of truth (15.1 relocated it out of `analytics_service.py`); the `fmtUsd`/`float`-wire discipline.
- [Source: velara-api/app/core/pricing.py#L68-L92] — `compute_cost_usd(*, model, input_tokens, output_tokens) -> Decimal | None`: KEYWORD-ONLY; returns `None` for unknown/None model (logs `pricing_unrecognized_model`); coerces `None` tokens via `input_tokens or 0` (the partial-usage trap this story guards against); returns unrounded `Decimal`.
- [Source: velara-api/app/api/v1/skills.py#L405-L536] — `propose_skill_adapter` route; success-path audit write (`:518-536`, metadata `:525-531`, reads `proposal.llm_*`); failure-path audit write (`:491-506`, metadata `:498-505`, reads `failed_llm_result.*`); `RejectNonGrantor` guard (`:403`); `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED` local import (`:426`).
- [Source: velara-api/app/services/skill_integration_assistant.py#L136-L160] — `AdapterProposal` dataclass; `llm_input_tokens`/`llm_output_tokens`/`llm_model`/`llm_stop_reason` all `X | None` (None on the no-LLM-call conforming-entrypoint success case, `:150-157`).
- [Source: velara-api/app/services/skill_integration_assistant.py#L56-L130] — the typed failure exceptions (`AdapterProposalParseError`, `ManifestSynthesisError`) carrying `llm_result` (an `LLMResult`); `AdapterProposalLlmError` (no `llm_result`, API-call-failed case).
- [Source: velara-api/app/integrations/anthropic_client.py#L32-L42] — `LLMResult`: `input_tokens: int`, `output_tokens: int`, `model: str`, `stop_reason: str | None` (the failure-path object's un-prefixed field names).
- [Source: velara-api/app/models/audit.py#L65] — `EVENT_ADMIN_SKILL_ADAPTER_PROPOSED = "admin.skill_adapter_proposed"`.
- [Source: velara-api/tests/integration/api/test_skills.py#L3516,#L3849,#L3881] — existing propose-audit tests to extend (`test_propose_adapter_audit_event_recorded`, `test_propose_synthesis_records_audit_with_tokens`, `test_propose_synthesis_failed_call_still_audits_tokens`); the `_FakeLLMProvider`/`_synthesis_llm_response`/`_override_llm_provider` stub harness (opus-4-8, 111/222 tokens).
- [Source: velara-web/src/features/audit/components/AuditDetailPanel.tsx#L97-L112] — the generic metadata renderer to special-case `cost_usd` in.
- [Source: velara-web/src/features/audit/auditFormat.ts#L51-L61] — `formatMetaValue` (unchanged; only `cost_usd` bypasses it).
- [Source: velara-web/src/api/audit.ts#L20-L39] — `AuditEntry` with `metadata: Record<string, unknown> | null` (untyped — narrow the value, don't add a typed field).
- [Source: velara-web/src/features/analytics/analyticsFormat.ts#L14-L22] — `fmtUsd(n: number, compact=false)` (no null guard — wrap defensively).
- [Source: velara-web/src/features/run/components/JobsHistory.tsx#L23-L26 / RunConsole.tsx#L66-L69] — the `fmtCost`/`v == null ? '—' : fmtUsd(v)` null-guard idiom to mirror.
- [Source: velara-web/src/features/audit/components/AuditLog.test.tsx#L86,#L347-L349] — the detail-panel test to extend (currently asserts no metadata content).

### Review Findings

3-layer adversarial code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, all Opus) on 2026-07-22. Acceptance Auditor confirmed all 5 ACs MET, File List exact, all AC4 negative-space invariants honored (no migration / no `pricing.py` / `execution_tasks.py` / `app/schemas/*` / `docs/api-spec.json` change). No `high`/`medium` findings. 0 patches, 4 deferred, 6 dismissed as noise.

- [x] [Review][Defer] Cost helper guards `None` but not the numeric edge of tokens (zero-input→`$0.00`, negative→negative cost) [velara-api/app/api/v1/skills.py:73-96] — deferred, defensive-only. Blind Hunter (zero-token "fabricated $0") + Edge Case Hunter (negative-token) converge on the same root: `_adapter_cost_usd` gates on `is None`, not on value. **Verified unreachable via the real Anthropic path** — every propose call sends a non-empty `system`+`user_content` prompt, so `resp.usage.input_tokens` is structurally `> 0` on any billed call (a `$0.00` requires input AND output both 0), and the Anthropic API never returns negative usage. The design invariant ("never a fabricated `$0` for an *unpriceable* call") is not violated: a genuine `$0.00` here cannot occur. A future `input_tokens >= 0`/`output_tokens >= 0` guard (BE) + `value >= 0` narrow (FE `AuditDetailPanel.tsx`) would harden defensively but fixes no live path.
- [x] [Review][Defer] `float()` cast reintroduces binary-float drift vs the execution path's exact-`Decimal` `Numeric(12,6)` column [velara-api/app/api/v1/skills.py:96] — deferred, spec-endorsed wire convention. JSONB `metadata` is JSON-serialized on the audit read path and a bare `Decimal` is not JSON-native; `float` is required here and matches the sibling ints in the same dict. This is the same numeric-fidelity class Story 15.2 deferred (typed-schema `field_serializer`→float). Only matters if adapter-propose spend is ever summed as money — not a current surface (AC4 defers aggregation).
- [x] [Review][Defer] Sub-cent costs collapse to `$0.01`/`$0.00` in the UI (`fmtUsd` `maximumFractionDigits: 2`) [velara-web/src/features/audit/components/AuditDetailPanel.tsx:113] — deferred, platform-wide convention. Matches the existing `fmtCost`→`fmtUsd` rendering used for job costs (`JobsHistory.tsx`, `RunConsole.tsx`); full precision is retained in the API payload. Display-fidelity limitation, internally consistent.
- [x] [Review][Defer] `admin.skill_adapter_proposed` metadata key asymmetry — the failure dict omits `proposal_non_conforming`; the success dict omits `outcome`/`error_code` [velara-api/app/api/v1/skills.py:498-535,559-568] — deferred, pre-existing (not introduced by this diff). Any future aggregate over this event type must treat every metadata key as optional. The diff adds `cost_usd` to both dicts without reconciling the pre-existing divergence, which is out of scope for this light story.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- Verified test-has-teeth on BOTH sides before finalizing: temporarily forced `_adapter_cost_usd` to always return `None` → the 3 pricing assertions (`test_propose_adapter_audit_event_recorded`, `test_propose_synthesis_records_audit_with_tokens`, `test_propose_synthesis_failed_call_still_audits_tokens`) correctly failed; the 2 null-tests correctly stayed green (they expect null). Temporarily reverted the FE `cost_usd` special-case → both new FE tests correctly failed (raw `0.006105` rendered / no `$0.01`). Restored both.
- api image bakes source (rebuild before pytest); ran with `AUTH_BACKEND=dev` (the documented Epic 15 gotcha — container `.env` defaults to `cognito` which 401s dev-token tests).
- Full BE suite: 1550 passed / 2 pre-existing flakes (`test_repeated_denials_are_deduped`, `test_presign_returns_file_ref_id_and_url` — both confirmed unrelated, pass in isolation) / 3 skipped.

### Completion Notes List

- **Task 1 (AC1, AC3):** Added `from app.core.pricing import compute_cost_usd` + a module-level `_adapter_cost_usd(*, model, input_tokens, output_tokens) -> float | None` helper in `skills.py`. Gates on **all three** (model AND both token counts) being present before pricing — the Story 15.5 partial-usage trap: `compute_cost_usd` coerces `None` tokens via `input_tokens or 0`, so a present model with a `None` token split would fabricate an under-price; the honest answer for incomplete usage is `None` (→ JSON null → UI "—"), never a fabricated `$0`. Casts the `Decimal` result to `float` (JSONB `metadata` is JSON-serialized on the audit read path; a bare `Decimal` isn't JSON-serializable).
- **Task 2 (AC2 success path):** Added `"cost_usd": _adapter_cost_usd(model=proposal.llm_model, input_tokens=proposal.llm_input_tokens, output_tokens=proposal.llm_output_tokens)` to the success-path metadata dict. The "no LLM call needed" conforming-entrypoint case (all `llm_*` None) flows through the helper's model-None guard → `cost_usd: null` (verified by the new no-LLM-call test).
- **Task 3 (AC2 failure path):** Added `cost_usd` to the failure-path metadata dict, reading the **un-prefixed** `LLMResult` attribute names (`failed_llm_result.model`/`.input_tokens`/`.output_tokens`) — NOT the success path's `llm_`-prefixed `AdapterProposal` names. Commented the distinction inline to prevent a future copy-paste error.
- **Task 4 (BE tests):** Extended the 3 existing propose-audit tests with `cost_usd == pytest.approx(0.006105)` asserts (opus-4-8 @ $5/$25 per MTok × 111/222 tokens = 0.006105). Added 2 new tests: `test_propose_synthesis_unknown_model_prices_cost_null` (unknown model → `cost_usd is None`, tokens still recorded) and `test_propose_no_llm_call_prices_cost_null` (declared-entrypoint-conforms path → 0 LLM calls, `llm_model`/`cost_usd` both None). Parametrized `_FakeLLMProvider` with an optional `model=` kwarg (default unchanged) for the unknown-model case.
- **Task 5 (AC5 FE):** Imported `fmtUsd` into `AuditDetailPanel.tsx` (first analytics→audit cross-import, matching Jobs/RunConsole); special-cased the `cost_usd` key in the generic metadata map — `key === 'cost_usd' ? (typeof value === 'number' ? fmtUsd(value) : '—') : formatMetaValue(value)`. Every other key keeps `formatMetaValue`. Note: the current `fmtUsd` (analyticsFormat.ts:14-22) already has a `null`/`NaN` guard returning `'—'` (added in the 15.3 review, more robust than this story's draft assumed), but the `typeof value === 'number'` narrow is still required to type-check against `metadata: Record<string, unknown>` and covers the non-number-but-non-null case.
- **Task 6 (FE tests):** Added 2 tests to `AuditLog.test.tsx` — a `skill_adapter_proposed` entry with `cost_usd: 0.006105` renders `$0.01` (not the raw `0.006105`), and a `cost_usd: null` entry renders `—` (never `$NaN`).
- **Task 7 (Gates):** BE ruff clean; full suite 1550 pass / 2 pre-existing flakes / 3 skipped. **AC4 negative-space confirmed:** only `skills.py` + `test_skills.py` changed on BE; `docs/api-spec.json` regenerated → **zero diff** (`cost_usd` lives in untyped JSONB, not a typed schema); no migration, no `pricing.py`/`execution_tasks.py`/`app/schemas/*` edit. FE: typecheck clean, lint clean (1 pre-existing `Icon.tsx` warning, unrelated), 737 tests pass; only `AuditDetailPanel.tsx` + `AuditLog.test.tsx` changed. Not committed to velara-api/velara-web (subrepos, per never-push-subrepos — dev-story commits only the top-level docs repo).

### File List

**Modified (velara-api):**
- `velara-api/app/api/v1/skills.py` — `compute_cost_usd` import; `_adapter_cost_usd` helper; `cost_usd` added to the success-path (reads `proposal.llm_*`) and failure-path (reads `failed_llm_result.*`) `admin.skill_adapter_proposed` metadata dicts.
- `velara-api/tests/integration/api/test_skills.py` — `cost_usd` asserts on 3 existing propose-audit tests; 2 new tests (unknown-model→null, no-LLM-call→null); `_FakeLLMProvider` gains an optional `model=` kwarg.

**Modified (velara-web):**
- `velara-web/src/features/audit/components/AuditDetailPanel.tsx` — `fmtUsd` import; `cost_usd` key special-cased in the generic metadata renderer.
- `velara-web/src/features/audit/components/AuditLog.test.tsx` — 2 tests (currency render + null "—").

## Change Log

- 2026-07-22 — Implemented Story 15.4. Prices the `admin.skill_adapter_proposed` audit event's already-captured token/model usage at BOTH write sites via the shared `compute_cost_usd` (new `_adapter_cost_usd` helper in `skills.py`), casting the `Decimal` to `float` for the JSONB metadata. Carries forward the 15.5 partial-usage trap: gates on model AND both token counts present → stores `null` (never a fabricated `$0`) for incomplete/absent usage (unknown model, and the conforming-entrypoint no-LLM-call success case). FE: special-cases `cost_usd` in `AuditDetailPanel.tsx`'s generic metadata renderer to format via `fmtUsd`, with a `'—'` null guard. 5 BE cost tests (3 extended + 2 new: unknown-model→null, no-LLM-call→null), 2 new FE tests — both verified test-has-teeth. AC4 negative-space confirmed: only 2 BE + 2 FE files changed, ZERO api-spec diff, no migration/pricing/execution/schema edit. Gates: BE full suite 1550 pass / 2 pre-existing flakes / 3 skipped, ruff clean; FE typecheck+lint clean, 737 tests pass. Completes Epic 15. Not committed to subrepos (per never-push-subrepos). Status → review.
- 2026-07-22 — Drafted Story 15.4 (cost the AI-assisted skill-adaptation LLM call). Prices the `admin.skill_adapter_proposed` audit event's already-captured token/model usage at both write sites (success path reading `proposal.llm_*` at `skills.py:518-536`; failure path reading `failed_llm_result.*` at `:491-506`) by importing the shared `compute_cost_usd` from `app/core/pricing.py` — no second pricing table, no new column, no new audit event, no migration, no OpenAPI change (`cost_usd` lands in untyped `metadata` JSONB). Carries forward the Story 15.5 partial-usage headline trap: the cost helper gates on model AND both token counts being present, storing `null` (not a fabricated `$0`) for incomplete/absent usage (incl. the conforming-entrypoint no-LLM-call success case). FE: special-case the `cost_usd` key in `AuditDetailPanel.tsx`'s generic metadata renderer to format via `fmtUsd` (raw key would otherwise dump an unformatted float), with a `'—'` null guard. Full-stack but light: 2 BE files (route + tests), 2 FE files (detail panel + test).
