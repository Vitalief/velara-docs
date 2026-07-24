# Epic 15: Per-Execution Cost Tracking

> **Created 2026-07-20** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-20-cost-tracking.md`). Trigger: an operator asked whether individual skill executions are cost-tracked and found only a single platform-wide aggregate dollar figure (Analytics Overview's `token_cost`) — no per-invocation, per-skill, or per-user cost anywhere. Token counts already exist for prompt/hybrid runs (`execution_service.py`) but are buried in an untyped `result_metadata` JSONB blob; code-runtime skills carry no cost data at all. A second, distinct LLM-spend path — AI-assisted skill adaptation (`propose_adapter`, Story 11.3/14.2) — has the identical gap: tokens/model are captured (`AdapterProposal.llm_*`) but never priced. **Epic 9 stays `done`** — FR-USE-06 (Epic 9's own scope) is fully met as written; this epic adds FR-USE-07, new scope Epic 9 was never asked to cover, the same way Epic 14 extended Epic 11's model forward.

Every skill invocation, and every AI-assisted skill-adaptation call, that makes an LLM call records its own token counts and computed dollar cost as a permanent, queryable fact — surfaced per-invocation, per-skill, per-user, and per-adaptation — closing the gap where cost only ever existed as a single opaque platform-wide number.

**FRs covered:** USE-09 (new — per-execution/per-skill/per-user cost). _(Corrected 2026-07-24: previously cited the non-existent `FR-USE-07`; the real requirement is now recorded as PRD §5.11 USE-09 — see readiness-report finding F1/F2.)_

**Sequencing:** After Epic 14 (no technical dependency — different files; sequenced after simply because Epic 14 is actively in flight). Four stories: **15.1** (persist structured cost at execution time — the risk-bearing migration story) → **15.2** (surface cost on the Job API + Run Console/Jobs History UI, depends on 15.1) → **15.3** (per-skill/per-user cost in Analytics, depends on 15.1; independent of 15.2) → **15.4** (cost the adapter-propose LLM spend, depends on 15.1 for the shared pricing table only; independent of 15.2 and 15.3).

---

## Story 15.1: Persist Structured Per-Execution Cost at Write Time

As a platform operator,
I want every completed invocation to record its own token counts and computed dollar cost as structured, queryable data,
So that cost is a permanent fact about that specific execution, not something re-derived later from an opaque blob.

**Context (from investigation):** `execution_service.py`'s `_run_prompt` (`:516-525`) and `_run_hybrid` (`:1040-1049`) already compute `model`/`input_tokens`/`output_tokens` into `runtime_metadata`; `_run_code` (`:682-687`) has none (nothing to price). This data currently only reaches `InvocationResult.result_metadata` (JSONB). The pricing table (`analytics_service.py:37-43`, one entry: `claude-opus-4-8`) lives only in the analytics read path today.

**Acceptance Criteria:**

1. **AC1 — Structured columns exist.** A new Alembic migration (chained off the verified current head) adds `input_tokens` (int, nullable), `output_tokens` (int, nullable), `model` (string, nullable), and `cost_usd` (numeric, nullable) to `invocation_results`. Additive, nullable columns — matches the Story 14.1 precedent (`skill_versions.egress`) for a live-table-safe migration.

2. **AC2 — Cost is computed and stored at execution time, not query time.** In `execution_tasks.py`, right after `execute_skill()` returns `(output_file_key, result_metadata)` (the confirmed insertion point, before the blocked-check and before `mark_completed`/`mark_blocked`), compute `cost_usd` from the `result_metadata`'s `model`/`input_tokens`/`output_tokens` and persist all four fields onto the `InvocationResult` row being written.

3. **AC3 — The pricing table has one source of truth.** `_MODEL_PRICING` moves out of `analytics_service.py` into a location importable by both the execution path and the analytics path (no duplicated pricing data). An unrecognized model logs a warning and stores `cost_usd=NULL` (never silently defaults to a wrong model's price — this changes today's `_DEFAULT_PRICING` fallback behavior, a deliberate correctness fix).

4. **AC4 — Code-runtime and failed/cancelled invocations get an explicit cost, never silent omission.** A code-runtime completion stores `cost_usd=0`, `input_tokens=NULL`, `output_tokens=NULL`, `model=NULL` (there is nothing to price). A failed or cancelled invocation that never reached an LLM call likewise stores an explicit `cost_usd=0` rather than leaving the row absent from any future aggregation. This closes the `analytics_service.py:174-181` documented gap where such rows silently contributed $0 by being excluded rather than by being explicitly zero.

5. **AC5 — Historical rows are not fabricated.** Pre-migration `invocation_results` rows get `NULL` for all four new columns (no backfill attempt) — token data was never captured structurally before this story, so there is nothing accurate to backfill. This is a documented approximation, matching the project's established backfill-gap precedent.

**Notes:** Surfacing cost in any API response or UI is out of scope (Stories 15.2/15.3). No change to the LLM call sites themselves (`_run_prompt`/`_run_hybrid` already produce the needed raw data).

---

## Story 15.2: Surface Per-Invocation Cost on the Job API and UI

_Depends on: Story 15.1._

As a Vitalief operator,
I want to see the token cost of an individual job in the Jobs History and Run Console,
So that I can understand what a specific execution cost without cross-referencing Analytics.

**Acceptance Criteria:**

1. **AC1 — `JobResult` exposes cost.** `GET /api/v1/jobs/{job_id}` includes `input_tokens`, `output_tokens`, `model`, and `cost_usd` on the result object (reading the new Story 15.1 columns, not `result_metadata` parsing).

2. **AC2 — `JobSummary` (list rows) exposes cost.** `GET /api/v1/jobs` list rows include `cost_usd` so Jobs History can render a cost column without an N+1 detail fetch per row.

3. **AC3 — Jobs History UI renders cost.** A cost column/badge appears in the Jobs History table and job detail panel, formatted via the existing `fmtUsd` helper (`analyticsFormat.ts`) — reused, not reimplemented. A `cost_usd=0` code-runtime job shows "—" or "$0.00" (story author's UX call), never a blank/missing cell that reads as "unknown."

4. **AC4 — Client-facing surface is unaffected.** `ClientJobRead`/`ClientJobSummary` do **not** expose cost — matches the existing IP-boundary convention (clients never see internal cost figures, same as they never see skill internals).

**Notes:** Per-skill/per-user aggregation is out of scope (Story 15.3).

---

## Story 15.3: Per-Skill and Per-User Cost in Analytics

_Depends on: Story 15.1. Independent of Story 15.2._

As a Vitalief operator,
I want to see cost broken out by skill and by user in the Usage & Value screen,
So that I can identify which skills or users are driving LLM spend, not just the platform-wide total.

**Acceptance Criteria:**

1. **AC1 — `SkillRun` carries cost.** The `top_skills` breakdown (used on both Overview and per-user detail) adds a `cost_usd` field per skill, summed from the new structured `InvocationResult` columns.

2. **AC2 — `AnalyticsUserSummary` and `AnalyticsUserDetail` carry cost.** Both gain a `cost_usd` field — closing the gap where these already break out `invocations`/`success_rate`/`hours_saved` per user but never cost.

3. **AC3 — `analytics_service.py` reads the structured column, not JSONB.** `_token_cost()` (or its replacement) sums the new `InvocationResult.cost_usd` column directly instead of parsing `event_metadata` JSONB text with a regex guard — simpler, faster, and no longer silently excludes code-runtime/failed rows (they now have an explicit `cost_usd=0`, correctly included in every sum).

4. **AC4 — Existing `AnalyticsOverview.token_cost` figure is unchanged in meaning.** The platform-wide aggregate still exists and still means the same thing — this story adds granularity, it does not change or rename the existing field (stable-field-name discipline, mirrors the project's stable-error-code convention).

5. **AC5 — UI renders the new breakdowns.** Overview's Top Skills list shows per-skill cost; By-User shows the selected user's cost alongside their existing metrics — extending Story 9.5's shipped screens, not replacing them.

**Notes:** Per-invocation display is covered by Story 15.2 (already shipped by the time this runs, if sequenced as recommended). Adapter-propose cost is Story 15.4 — a separate write path, not part of `invocation_results`.

---

## Story 15.4: Cost the AI-Assisted Skill-Adaptation LLM Call

_Depends on: Story 15.1 (shared pricing table only — no shared schema, no shared write path)._

As a Vitalief operator,
I want the AI integration assistant's propose calls (both new-skill registration and Story 14.2's upgrade path) to record their computed dollar cost, not just raw token counts,
So that adaptation spend is visible in the same audited, priced way execution spend is — currently it is the only remaining LLM call in the system with tokens captured but never priced.

**Context (from investigation):** `AdapterProposal` (`skill_integration_assistant.py:137-157`) already carries `llm_input_tokens`/`llm_output_tokens`/`llm_model`/`llm_stop_reason` — the identical raw shape `runtime_metadata` has for execution. The propose route (`skills.py`) writes these into the `admin.skill_adapter_proposed` audit event's `metadata` JSONB at **two** sites: the success path (`skills.py:519-529`) and the failure path (`skills.py:492-499`, the AC8 "a failed call still audits its spend" case established in Story 11.3). Neither site computes a dollar figure. This is a **separate write path** from skill execution — `audit_log_entries`, not `invocation_results` — so it is untouched by Stories 15.1-15.3 and needs its own story.

**Acceptance Criteria:**

1. **AC1 — Adapter-propose cost is computed using the same pricing table as execution.** No second pricing table, no duplicated per-model rates — this story imports the exact pricing lookup Story 15.1 relocated out of `analytics_service.py`. An unrecognized model behaves identically to 15.1/AC3: log a warning, store no cost (never a silently wrong default price).

2. **AC2 — Both the success and failure audit-write sites get `cost_usd`.** `admin.skill_adapter_proposed` `metadata` gains a `cost_usd` field alongside the existing `llm_model`/`input_tokens`/`output_tokens`/`stop_reason` at both `skills.py:519-529` (success) and `skills.py:492-499` (failure) — preserving the existing AC8 guarantee that a failed propose call still has its spend attributed, now priced as well as counted.

3. **AC3 — No new column, no new audit event type.** `cost_usd` lands inside the existing `metadata` JSONB on the existing `admin.skill_adapter_proposed` event — this is intentionally lighter-weight than 15.1's structured-column approach, because adapter-propose calls are low-volume, admin-gated (`RejectNonGrantor`), and already queryable via the existing Audit Log API/UI; there is no per-skill/per-user rollup requirement for this cost the way there is for execution cost. If a future story needs aggregation over adapter-propose spend, promoting it to a structured column then is the natural next step — not preemptively built here.

4. **AC4 — Audit Log UI shows the cost.** The existing Audit Log detail panel (Story 9.3), when it renders an `admin.skill_adapter_proposed` entry's metadata, displays the new `cost_usd` field using the same `fmtUsd` formatter as every other cost figure in the system — no new UI surface, an extension of the existing detail-panel metadata rendering.

**Notes:** No change to `propose_adapter`'s decision logic, the adapter-authoring prompts, or the `RejectNonGrantor` gate — this story only adds a computed field alongside data that already exists. No per-skill/per-adapter-call aggregation surface (explicitly deferred per AC3).

---

## Story 15.5: Capture Code-Driven Hybrid Sandbox LLM Usage

_Depends on: Story 15.1 (columns + write-path seam). Added 2026-07-21 after a live defect._

As a Vitalief operator,
I want a code-driven hybrid skill's real LLM usage (spent inside its sandbox) captured and priced,
So that its per-execution cost is a true dollar figure, not a silent $0.00 on our most expensive runtime.

**Context (from a live finding):** Epic 15's investigation modeled `prompt`/`hybrid`/`code` runtimes but missed **code-driven hybrid** (`code_driven_executor.py`) — a fourth path where LLM calls run inside the sandbox and usage is never surfaced in the result envelope (`CodeDrivenResultEnvelope` has no usage field). `_extract_cost_fields` therefore mis-classified every code-driven hybrid as a free "code run" and stored `cost_usd=0`. Confirmed live: a `velara-protocol-extractor` run stored $0 for a real $1.38 execution (139K in / 27K out on opus-4-8). An interim discriminator fix (LLM-using runtime with no usage → NULL, not $0) was applied immediately; this story is the proper fix.

**Acceptance Criteria (summary — see the story file for full detail):**

1. **AC1** — `CodeDrivenResultEnvelope` gains a first-class, validated `usage` field (`input_tokens`/`output_tokens`/`model`), optional on the model but contractually required.
2. **AC2** — reported usage is threaded to the write-path top-level token keys and priced by **our** `app/core/pricing.py` table (never the skill's self-reported `est_cost_usd`).
3. **AC3** — a code-driven hybrid reporting no usage stores `cost_usd=NULL` (unknown), never `$0`; a genuine `code` run still stores `$0`.
4. **AC4** — a completed code-driven hybrid with missing usage is an **AI-Adapter trigger** (runtime-observed, mirroring `ENTRYPOINT_CONTRACT_VIOLATION`), since the static entrypoint contract only validates the input signature, not the return shape.
5. **AC5** — the usage requirement is documented for skill authors; `velara-protocol-extractor` updated to emit `usage`.
6. **AC6** — existing runtimes and the "genuine code run = $0" case are provably unaffected.

**Notes:** Backend + contract only — no migration (15.1's columns already exist), no FE, no new audit event. Reuses the pricing table and the adapter propose flow; does not modify either's core logic.

---

## Story Sequencing & Dependencies

| Story | Depends on | Ship order | Weight |
|-------|-----------|-----------|--------|
| **15-1** Persist structured cost at write time | — | 1st | Heavy (migration + shared pricing relocation) |
| **15-2** Surface per-invocation cost (Job API + UI) | **15-1** | 2nd (or parallel w/ 15-3/15-4) | Medium |
| **15-3** Per-skill/per-user cost in Analytics | **15-1** | 2nd (or parallel w/ 15-2/15-4) | Medium |
| **15-4** Cost the adapter-propose LLM call | **15-1** (pricing table only) | 2nd (or parallel w/ 15-2/15-3) | Light |
| **15-5** Capture code-driven hybrid sandbox usage | **15-1** | after 15-1 (added 2026-07-21 from a live defect) | Medium (envelope contract + adapter trigger) |

**Recommended order:** 15-1 → (15-2, 15-3, 15-4, 15-5 in any order — no interdependency once 15-1 lands). 15-5 is worth prioritizing before 15-3, since per-skill/per-user analytics (15-3) will under-report until code-driven hybrids are priced. Per `create-story` discipline, each story is expanded to full implementation detail one at a time when picked up — these epic-level ACs are the contract, not the implementation plan.
