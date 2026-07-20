# Sprint Change Proposal — Per-Execution Cost Tracking

**Date:** 2026-07-20
**Trigger:** Operator question — "Are we tracking the cost of each skill execution individually? Really need that in the system." — plus a follow-up: "Need to track one more cost which is the cost of adapting a skill."
**Prepared via:** correct-course workflow (batch mode)

---

## 1. Issue Summary

**Problem statement:** No individual skill execution has a queryable cost. The platform computes and stores token counts (`input_tokens`/`output_tokens`/`model`) for prompt and hybrid runs, but only inside an untyped JSONB blob (`InvocationResult.result_metadata`) — never for code-runtime skills, which have no tokens to price at all. A single hardcoded pricing table converts tokens to dollars, but only inside `analytics_service.py`, and only to produce **one platform-wide aggregate number** (`AnalyticsOverview.token_cost`) shown on the Analytics Overview tab. There is no per-invocation, per-skill, or even per-user cost anywhere in the API or UI — despite the per-user analytics endpoint already breaking out other metrics (invocations, success rate) that way.

**Discovery context:** Surfaced directly from operator use of the shipped Epic 9 Analytics screen, not from a story defect or a bug report. This is new scope Epic 9 was never asked to cover — FR-USE-06 (the requirement Epic 9 implements) explicitly promises only "aggregate (Overview) and per-user" usage/value metrics; it never promises per-invocation or per-skill cost.

**Evidence (grounded in current source, verified this session):**
- `velara-api/app/models/invocation.py:49-199` — `InvocationJob` has zero cost/token columns; `InvocationResult.result_metadata` (JSONB, nullable) is the only place token data lives, and only for prompt (`execution_service.py:516-525`) and hybrid (`execution_service.py:1040-1049`) runs. Code runtime (`execution_service.py:682-687`) carries no model/token fields at all.
- `velara-api/app/services/analytics_service.py:37-40` — the entire pricing model is a 2-line hardcoded dict, one entry (`claude-opus-4-8`), with a defaulting fallback (`_DEFAULT_PRICING`, line 43) that would silently misprice any future model change until manually updated.
- `velara-api/app/services/analytics_service.py:174-181` (docstring) — **documented, intentional gap**: failure/cancelled/code-runtime rows have no `event_metadata` and are excluded from the cost sum entirely, contributing an invisible $0 rather than an explicit "unknown."
- `velara-api/app/schemas/analytics.py` — `SkillRun` (lines 20-27), `AnalyticsUserSummary` (43-50), and `AnalyticsUserDetail` (76-89) all omit cost entirely, even though `AnalyticsUserDetail` already carries `hours_saved`, `top_skills`, and other derived metrics at the per-user grain.
- `velara-api/app/schemas/job.py` — `JobResult` (38-53) and `JobSummary` (136-155) have no cost/token fields; a per-job cost is not reachable through any typed API response today.
- `velara-web/src/features/run/components/JobsHistory.tsx` and `RunConsole.tsx` — confirmed zero token/cost rendering anywhere, even though the raw `result_metadata` payload already contains token counts for prompt/hybrid jobs today.

**A second, distinct LLM-spend path exists with the identical gap — AI-assisted skill adaptation (Story 11.3/14.2's `propose_adapter`):**
- `velara-api/app/services/skill_integration_assistant.py:137-157` — `AdapterProposal` already carries `llm_input_tokens`/`llm_output_tokens`/`llm_model`/`llm_stop_reason` per propose call (the same raw shape as execution's `runtime_metadata`).
- `velara-api/app/api/v1/skills.py:519-529` (success) and `:492-499` (failure, AC8 "success or failure" spend accounting) — these tokens are written into `admin.skill_adapter_proposed` audit-event `metadata` (JSONB) — **but no dollar cost is ever computed for them**, on either the success or failure path.
- This is a **separate write path** entirely from skill execution — it lives on `audit_log_entries`, not `invocation_results` — so it is not covered by Stories 15.1-15.3 as scoped; it needs its own story (15.4) sharing the same relocated pricing table from 15.1.

---

## 2. Impact Analysis

### Epic Impact

- **Epic 9 (Audit Log, Usage & Analytics) — `done`, unaffected.** Its own ACs (FR-USE-06 as originally scoped) are fully met. This is not an Epic 9 defect — it is new scope Epic 9 was never asked to cover. Epic 9's stories/ACs are **not** reopened or rewritten.
- **Epic 14 (Skill Upgrade Flexibility) — `in-progress` (14-2 in review), unaffected.** No file overlap: Epic 14 touches `skill_service.py`/`skill_integration_assistant.py`/manifest handling; this change touches `execution_service.py`/`invocation.py`/`analytics_service.py`/job & analytics schemas. No shared migration head conflict once sequenced after Epic 14's current head.
- **No other epic is invalidated or requires resequencing.** This is purely additive.
- **New epic required: Epic 15 — Per-Execution Cost Tracking.** Follows the established pattern this project has used five times already (Epics 10-14) for legitimate net-new scope discovered post-launch, rather than reopening a closed epic.

### Story Impact

Four new stories (detailed in Section 4). No existing story's acceptance criteria change.

### Artifact Conflicts

- **PRD:** No conflict with core goals; **FR-USE-06 needs amendment** (additive, mirroring how Epic 13 added FR-SEC-13..17 rather than rewriting FR-SEC-08) to state that per-invocation and per-skill cost are also platform requirements, not just aggregate/per-user.
- **Architecture / data model:** New Alembic migration required (`0024_invocation_cost_tracking`, chained off verified head `0023_skill_version_egress`) adding structured `input_tokens`/`output_tokens`/`model`/`cost_usd` columns to `InvocationResult`. This follows the identical "promote JSONB-buried data to a structured column" pattern Story 14.1 just established for `skill_versions.egress` — a directly reusable precedent, not a novel pattern.
- **Execution engine:** `execution_service.py`'s `_run_prompt`/`_run_hybrid` already compute the raw inputs needed (`model`, `input_tokens`, `output_tokens`) — no LLM-call-site changes needed, only a downstream write. The natural insertion point is confirmed precisely: right after `execute_skill()` returns `(output_file_key, result_metadata)` in `execution_tasks.py:256`, before the blocked-check at line 269 and before `mark_completed`/`mark_blocked` are called (lines 278-282, 301-305). `_run_code` rows get an explicit `cost_usd=0`/`input_tokens=None`/`output_tokens=None` — never silently omitted, closing the documented completeness gap.
- **Pricing table:** `_MODEL_PRICING` needs to move to (or be duplicated into) a location reachable from the execution path, not just `analytics_service.py`. This is a genuine design decision for the story author: compute-and-store cost at execution time (recommended — makes cost immutable and audit-consistent per invocation, matches the "append-only, attributable" ethos already established for the audit log) vs. compute-at-analytics-read-time from stored token counts (cheaper to ship, but re-derives a number that should be a permanent fact about a completed execution, and re-litigates pricing on every query). **Recommend compute-and-store-at-execution.**
- **File-by-key / IP discipline** (execution-engine-patterns.md §6): cost/token fields fit the existing pattern cleanly — "only names/counts go into `result_metadata`" already covers token counts; a computed dollar figure is the same class of metadata, not raw content. No conflict with the established invariant.
- **Client-facing IP boundary:** `ClientJobRead`/`ClientJobSummary` (job.py:213-261) deliberately exclude internal fields today. Whether a client ever sees cost is an explicit story-level decision — default assumption (matching every other internal-cost figure in this system) is **internal-only, never exposed to `ClientJobRead`.**
- **UI/UX:** No existing wireframe shows per-job or per-skill cost. New UI surface, not a revision — a cost column/badge on Jobs History and Run Console detail, plus new per-skill/per-user cost breakdowns on the existing Analytics Overview/By-User tabs (extending, not replacing, Story 9.5's shipped screens).
- **Adapter-propose cost (Story 15.4):** `skill_integration_assistant.py`'s `AdapterProposal` and the `admin.skill_adapter_proposed` audit write in `skills.py` are an entirely separate LLM-spend path from skill execution (audit-log JSONB metadata, not `InvocationResult`). Adding cost here means computing `cost_usd` from the already-captured `llm_input_tokens`/`llm_output_tokens`/`llm_model` at both the success write site (`skills.py:519-529`) and the failure write site (`skills.py:492-499` — the AC8 "failed call still audits spend" path), using the same relocated pricing table from 15.1. No new column needed on `AdapterProposal` itself if cost is computed at the audit-write call site rather than inside the dataclass — a story-level decision, but computing it in `skill_integration_assistant.py` alongside the other `llm_*` fields is the more consistent placement (mirrors 15.1's "compute at the point token counts are already known" principle).
- **Other artifacts:** No IaC/CI/deployment impact. `docs/api-spec.json` will need regeneration once new response fields land (standard, established step). New unit tests for the moved pricing computation + integration tests proving cost persists across prompt/hybrid/code paths, and across the adapter-propose success/failure paths.

### Technical Impact Summary

Backend: one migration (`0024`), an `execution_tasks.py` write-path addition, a pricing-table relocation (shared by both the execution path AND the adapter-propose path), `job.py`/`analytics.py` schema extensions, `analytics_service.py` query changes to read the new structured column instead of parsing JSONB, and a `cost_usd` computation added to the `admin.skill_adapter_proposed` audit metadata (success + failure). Frontend: typed job/analytics API client updates, a cost column/badge in Jobs History + Run Console, new per-skill/per-user cost breakdowns in Analytics; adapter-propose cost is audit-log-only (surfaced via the existing Audit Log UI's detail panel, not a new screen). Risk concentrated in the migration (a live, frequently-written table) — mitigated by the additive-nullable-column pattern already proven safe in Story 14.1's `0023`. Historical rows cannot be backfilled with true cost (token data was never captured structurally before); this is a documented approximation, matching the project's established backfill-gap precedent (e.g., 14.1's egress backfill).

---

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment (new Epic 15 within the existing epic structure).**

- **Rollback (Option 2):** Not viable — there is nothing broken to roll back; this is a net-new capability.
- **MVP Review (Option 3):** Not viable/not needed — doesn't touch MVP scope or PRD core goals; purely additive requirement.
- **Direct Adjustment (Option 1):** Viable and recommended.
  - **Effort: Medium.** Reuses two already-proven patterns (JSONB→structured-column migration from 14.1; existing token-capture code in `execution_service.py` and `skill_integration_assistant.py`) rather than inventing new architecture. Four stories, sequenced to isolate the risky migration first; the adapter-propose story (15.4) is small — it reuses 15.1's pricing table against data that's already fully captured, no new columns.
  - **Risk: Low-Medium.** The only genuine risk locus is the migration touching a live table — mitigated by following the additive-nullable-column convention exactly as 14.1 did, with a documented backfill approximation (or explicit `NULL` for pre-migration rows, story author's call) rather than fabricated history.
  - **Timeline impact:** Additive; does not block Epic 14 (different files, can run in parallel or sequenced after — recommend **after**, simply because Epic 14 is actively in flight, not due to any technical dependency).

---

## 4. Detailed Change Proposals

### 4.1 PRD Amendment — FR-USE-06

**File:** `_bmad-output/planning-artifacts/epics/requirements-inventory.md`

**OLD:**
> FR-USE-06 [P1]: Usage analytics — the platform surfaces **aggregate (Overview)** and **per-user** usage/value metrics (invocations, success rate, top skills, runtime, value/hours-saved, breakdown by invocation surface) in a **Usage & Value** screen. Per-user analysis lets an operator select an individual user and analyze their metrics.

**NEW:**
> FR-USE-06 [P1]: Usage analytics — the platform surfaces **aggregate (Overview)** and **per-user** usage/value metrics (invocations, success rate, top skills, runtime, value/hours-saved, breakdown by invocation surface) in a **Usage & Value** screen. Per-user analysis lets an operator select an individual user and analyze their metrics.
> FR-USE-07 [P1]: **(Added 2026-07-20, Epic 15.)** Every skill invocation that makes an LLM call records its own token counts and computed dollar cost as a durable, queryable fact of that execution — not only as an input to a platform-wide aggregate. Cost is surfaced per-invocation (Job detail), per-skill, and per-user (extending the existing Usage & Value screen), and a code-runtime or failed/cancelled invocation records an explicit zero/null cost rather than being silently excluded from any total.

**Rationale:** Additive numbering (mirrors Epic 13's FR-SEC-13..17 pattern) — does not rewrite or reinterpret the original FR-USE-06, which remains fully satisfied by Epic 9 as shipped.

### 4.2 New Epic — Epic 15: Per-Execution Cost Tracking

**File:** `_bmad-output/planning-artifacts/epics/epic-15-per-execution-cost-tracking.md` (new)

```markdown
# Epic 15: Per-Execution Cost Tracking

> **Created 2026-07-20** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-20-cost-tracking.md`).
> Trigger: an operator asked whether individual skill executions are cost-tracked and found only a single
> platform-wide aggregate dollar figure (Analytics Overview's `token_cost`) — no per-invocation, per-skill, or
> per-user cost anywhere. Token counts already exist for prompt/hybrid runs (`execution_service.py`) but are
> buried in an untyped `result_metadata` JSONB blob; code-runtime skills carry no cost data at all. A second,
> distinct LLM-spend path — AI-assisted skill adaptation (`propose_adapter`, Story 11.3/14.2) — has the
> identical gap: tokens/model are captured (`AdapterProposal.llm_*`) but never priced.
> **Epic 9 stays `done`** — FR-USE-06 (Epic 9's own scope) is fully met as written; this epic adds FR-USE-07,
> new scope Epic 9 was never asked to cover, the same way Epic 14 extended Epic 11's model forward.

Every skill invocation, and every AI-assisted skill-adaptation call, that makes an LLM call records its own
token counts and computed dollar cost as a permanent, queryable fact — surfaced per-invocation, per-skill,
per-user, and per-adaptation — closing the gap where cost only ever existed as a single opaque platform-wide
number.

**FRs covered:** FR-USE-07 (new).

**Sequencing:** After Epic 14 (no technical dependency — different files; sequenced after simply because
Epic 14 is actively in flight). Four stories: **15.1** (persist structured cost at execution time — the
risk-bearing migration story) → **15.2** (surface cost on the Job API + Run Console/Jobs History UI, depends
on 15.1) → **15.3** (per-skill/per-user cost in Analytics, depends on 15.1; independent of 15.2) → **15.4**
(cost the adapter-propose LLM spend, depends on 15.1 for the shared pricing table only; independent of 15.2
and 15.3).

---

## Story 15.1: Persist Structured Per-Execution Cost at Write Time

As a platform operator,
I want every completed invocation to record its own token counts and computed dollar cost as structured,
queryable data,
So that cost is a permanent fact about that specific execution, not something re-derived later from an
opaque blob.

**Context (from investigation):** `execution_service.py`'s `_run_prompt` (`:516-525`) and `_run_hybrid`
(`:1040-1049`) already compute `model`/`input_tokens`/`output_tokens` into `runtime_metadata`; `_run_code`
(`:682-687`) has none (nothing to price). This data currently only reaches `InvocationResult.result_metadata`
(JSONB). The pricing table (`analytics_service.py:37-43`, one entry: `claude-opus-4-8`) lives only in the
analytics read path today.

**Acceptance Criteria:**

1. **AC1 — Structured columns exist.** A new Alembic migration (chained off the verified current head)
   adds `input_tokens` (int, nullable), `output_tokens` (int, nullable), `model` (string, nullable), and
   `cost_usd` (numeric, nullable) to `invocation_results`. Additive, nullable columns — matches the Story
   14.1 precedent (`skill_versions.egress`) for a live-table-safe migration.

2. **AC2 — Cost is computed and stored at execution time, not query time.** In `execution_tasks.py`, right
   after `execute_skill()` returns `(output_file_key, result_metadata)` (the confirmed insertion point,
   before the blocked-check and before `mark_completed`/`mark_blocked`), compute `cost_usd` from the
   `result_metadata`'s `model`/`input_tokens`/`output_tokens` and persist all four fields onto the
   `InvocationResult` row being written.

3. **AC3 — The pricing table has one source of truth.** `_MODEL_PRICING` moves out of `analytics_service.py`
   into a location importable by both the execution path and the analytics path (no duplicated pricing
   data). An unrecognized model logs a warning and stores `cost_usd=NULL` (never silently defaults to a
   wrong model's price — this changes today's `_DEFAULT_PRICING` fallback behavior, a deliberate
   correctness fix).

4. **AC4 — Code-runtime and failed/cancelled invocations get an explicit cost, never silent omission.** A
   code-runtime completion stores `cost_usd=0`, `input_tokens=NULL`, `output_tokens=NULL`, `model=NULL`
   (there is nothing to price). A failed or cancelled invocation that never reached an LLM call likewise
   stores an explicit `cost_usd=0` rather than leaving the row absent from any future aggregation. This
   closes the `analytics_service.py:174-181` documented gap where such rows silently contributed $0 by
   being excluded rather than by being explicitly zero.

5. **AC5 — Historical rows are not fabricated.** Pre-migration `invocation_results` rows get `NULL` for all
   four new columns (no backfill attempt) — token data was never captured structurally before this story,
   so there is nothing accurate to backfill. This is a documented approximation, matching the project's
   established backfill-gap precedent.

**Out of scope:** Surfacing cost in any API response or UI (Stories 15.2/15.3). Changing the LLM call sites
themselves (`_run_prompt`/`_run_hybrid` already produce the needed raw data).

---

## Story 15.2: Surface Per-Invocation Cost on the Job API and UI

_Depends on: Story 15.1._

As a Vitalief operator,
I want to see the token cost of an individual job in the Jobs History and Run Console,
So that I can understand what a specific execution cost without cross-referencing Analytics.

**Acceptance Criteria:**

1. **AC1 — `JobResult` exposes cost.** `GET /api/v1/jobs/{job_id}` includes `input_tokens`, `output_tokens`,
   `model`, and `cost_usd` on the result object (reading the new Story 15.1 columns, not `result_metadata`
   parsing).

2. **AC2 — `JobSummary` (list rows) exposes cost.** `GET /api/v1/jobs` list rows include `cost_usd` so Jobs
   History can render a cost column without an N+1 detail fetch per row.

3. **AC3 — Jobs History UI renders cost.** A cost column/badge appears in the Jobs History table and job
   detail panel, formatted via the existing `fmtUsd` helper (`analyticsFormat.ts`) — reused, not
   reimplemented. A `cost_usd=0` code-runtime job shows "—" or "$0.00" (story author's UX call), never a
   blank/missing cell that reads as "unknown."

4. **AC4 — Client-facing surface is unaffected.** `ClientJobRead`/`ClientJobSummary` do **not** expose cost
   — matches the existing IP-boundary convention (clients never see internal cost figures, same as they
   never see skill internals).

**Out of scope:** Per-skill/per-user aggregation (Story 15.3).

---

## Story 15.3: Per-Skill and Per-User Cost in Analytics

_Depends on: Story 15.1. Independent of Story 15.2._

As a Vitalief operator,
I want to see cost broken out by skill and by user in the Usage & Value screen,
So that I can identify which skills or users are driving LLM spend, not just the platform-wide total.

**Acceptance Criteria:**

1. **AC1 — `SkillRun` carries cost.** The `top_skills` breakdown (used on both Overview and per-user
   detail) adds a `cost_usd` field per skill, summed from the new structured `InvocationResult` columns.

2. **AC2 — `AnalyticsUserSummary` and `AnalyticsUserDetail` carry cost.** Both gain a `cost_usd` field —
   closing the gap where these already break out `invocations`/`success_rate`/`hours_saved` per user but
   never cost.

3. **AC3 — `analytics_service.py` reads the structured column, not JSONB.** `_token_cost()` (or its
   replacement) sums the new `InvocationResult.cost_usd` column directly instead of parsing
   `event_metadata` JSONB text with a regex guard — simpler, faster, and no longer silently excludes
   code-runtime/failed rows (they now have an explicit `cost_usd=0`, correctly included in every sum).

4. **AC4 — Existing `AnalyticsOverview.token_cost` figure is unchanged in meaning.** The platform-wide
   aggregate still exists and still means the same thing — this story adds granularity, it does not change
   or rename the existing field (stable-field-name discipline, mirrors the project's stable-error-code
   convention).

5. **AC5 — UI renders the new breakdowns.** Overview's Top Skills list shows per-skill cost; By-User shows
   the selected user's cost alongside their existing metrics — extending Story 9.5's shipped screens, not
   replacing them.

**Out of scope:** Per-invocation display (Story 15.2, already shipped by the time this runs if sequenced as
recommended). Adapter-propose cost (Story 15.4 — a separate write path, not part of `invocation_results`).

---

## Story 15.4: Cost the AI-Assisted Skill-Adaptation LLM Call

_Depends on: Story 15.1 (shared pricing table only — no shared schema, no shared write path)._

As a Vitalief operator,
I want the AI integration assistant's propose calls (both new-skill registration and Story 14.2's upgrade
path) to record their computed dollar cost, not just raw token counts,
So that adaptation spend is visible in the same audited, priced way execution spend is — currently it is
the only remaining LLM call in the system with tokens captured but never priced.

**Context (from investigation):** `AdapterProposal` (`skill_integration_assistant.py:137-157`) already
carries `llm_input_tokens`/`llm_output_tokens`/`llm_model`/`llm_stop_reason` — the identical raw shape
`runtime_metadata` has for execution. The propose route (`skills.py`) writes these into the
`admin.skill_adapter_proposed` audit event's `metadata` JSONB at **two** sites: the success path
(`skills.py:519-529`) and the failure path (`skills.py:492-499`, the AC8 "a failed call still audits its
spend" case established in Story 11.3). Neither site computes a dollar figure. This is a **separate write
path** from skill execution — `audit_log_entries`, not `invocation_results` — so it is untouched by
Stories 15.1-15.3 and needs its own story.

**Acceptance Criteria:**

1. **AC1 — Adapter-propose cost is computed using the same pricing table as execution.** No second pricing
   table, no duplicated per-model rates — this story imports the exact pricing lookup Story 15.1 relocated
   out of `analytics_service.py`. An unrecognized model behaves identically to 15.1/AC3: log a warning,
   store no cost (never a silently wrong default price).

2. **AC2 — Both the success and failure audit-write sites get `cost_usd`.** `admin.skill_adapter_proposed`
   `metadata` gains a `cost_usd` field alongside the existing `llm_model`/`input_tokens`/`output_tokens`/
   `stop_reason` at both `skills.py:519-529` (success) and `skills.py:492-499` (failure) — preserving the
   existing AC8 guarantee that a failed propose call still has its spend attributed, now priced as well as
   counted.

3. **AC3 — No new column, no new audit event type.** `cost_usd` lands inside the existing `metadata` JSONB
   on the existing `admin.skill_adapter_proposed` event — this is intentionally lighter-weight than 15.1's
   structured-column approach, because adapter-propose calls are low-volume, admin-gated
   (`RejectNonGrantor`), and already queryable via the existing Audit Log API/UI; there is no per-skill/
   per-user rollup requirement for this cost the way there is for execution cost. If a future story needs
   aggregation over adapter-propose spend, promoting it to a structured column then is the natural next
   step — not preemptively built here.

4. **AC4 — Audit Log UI shows the cost.** The existing Audit Log detail panel (Story 9.3), when it renders
   an `admin.skill_adapter_proposed` entry's metadata, displays the new `cost_usd` field using the same
   `fmtUsd` formatter as every other cost figure in the system — no new UI surface, an extension of the
   existing detail-panel metadata rendering.

**Out of scope:** Any change to `propose_adapter`'s decision logic, the adapter-authoring prompts, or the
`RejectNonGrantor` gate — this story only adds a computed field alongside data that already exists. No
per-skill/per-adapter-call aggregation surface (explicitly deferred per AC3).
```

---

## 5. Implementation Handoff

**Scope classification: Moderate.**

- Not **Minor** — this spans a schema migration, an execution-path write, two schema files, an analytics query rewrite, and three UI/audit surfaces; too much surface area for direct single-pass implementation without story-level detailing first.
- Not **Major** — no PRD MVP redefinition, no architectural pattern invention (both key patterns — additive-column migration, JSONB→structured promotion — are directly reused from Story 14.1), no PM/Architect strategic reconsideration needed.

**Routed to: Product Owner / Developer agents**, via the same `create-story` → `dev-story` → `code-review` pipeline used for every other epic in this project.

**Responsibilities:**
- **PO/story-author (`create-story`):** Expand each of the four stories above to full implementation detail — in particular, resolve the two decisions this proposal flagged rather than fully closing (pricing-table target module location; exact UX treatment of a `$0.00` vs. `—` code-runtime cost cell).
- **Developer (`dev-story`):** Implement in the sequenced order (15.1 → 15.2 / 15.3 / 15.4, with 15.2, 15.3, and 15.4 all independent of each other once 15.1 lands).
- **Code review:** Standard 3-layer adversarial review per this project's established convention, with particular attention to the migration's live-table safety and the pricing-fallback behavior change (AC3 of 15.1 and AC1 of 15.4 — no more silent mispricing default anywhere in the system).

**Success criteria:** A completed invocation of any runtime type has an explicit, non-null-by-omission cost fact attached to it; that cost is visible on the individual job (15.2) and rolled up per-skill/per-user (15.3) in the existing Analytics screen; every adapter-propose LLM call (success or failure) has a priced cost visible in the Audit Log (15.4) — with the platform-wide Overview figure unchanged in meaning throughout.

---

## Sprint Status Update (pending approval)

Add to `_bmad-output/implementation-artifacts/sprint-status.yaml`:

```yaml
  # ─────────────────────────────────────────────────────────
  # Epic 15: Per-Execution Cost Tracking
  #   Added 2026-07-20 via correct-course (sprint-change-proposal-2026-07-20-cost-tracking.md).
  #   Trigger: operator asked whether per-execution cost is tracked (found only one platform-wide
  #   aggregate figure, Analytics Overview token_cost, no per-invocation/per-skill/per-user cost anywhere),
  #   then asked to also track the cost of AI-assisted skill adaptation (propose_adapter, Story 11.3/14.2) —
  #   a second, separate LLM-spend path with the identical tokens-captured-but-never-priced gap.
  #   Epic 9 stays done (FR-USE-06 fully met); this epic adds FR-USE-07 (new scope).
  #   Dev order: 15-1 (migration + execution-path write, risk-bearing) → 15-2 / 15-3 / 15-4 (all three
  #   depend on 15-1 — 15-4 only for the shared pricing table, no shared schema — independent of each other).
  # ─────────────────────────────────────────────────────────
  epic-15: backlog
  15-1-persist-structured-per-execution-cost: backlog
  15-2-surface-per-invocation-cost-job-api-ui: backlog
  15-3-per-skill-and-per-user-cost-analytics: backlog
  15-4-cost-the-ai-assisted-skill-adaptation-llm-call: backlog
```
