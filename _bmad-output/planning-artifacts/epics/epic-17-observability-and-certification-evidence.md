# Epic 17: LLM-Call Observability & Certification Evidence

> **Created 2026-07-24** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-24.md`). Trigger: operator requests for (a) per-individual-LLM-call tracking via LangSmith — extending Epic 15's per-execution cost with call-level tracing, including inside AI-authored skill bundles — and (b) a documented 5-run dry-run trail before an ma_tech member can turn the technical certification key. **Epics 6 and 15 stay `done`** — this epic extends their scope forward (LangSmith is observability atop 15's stored cost; the cert dry-run gate is a new pre-condition on 6.2's technical key), the same pattern Epic 15 used on Epic 9 and Epic 16 used on 3/4/5/8.

Every LLM call the platform makes — including calls made from inside AI-authored skill bundles — is individually traced in LangSmith with its own cost/token/latency, and no skill can have its technical certification key turned until a documented trail of at least five dry-runs with differing outputs exists for that exact version.

**FRs covered:** USE-10 (new — call-level LLM observability via LangSmith), CRT-06 (new — technical-certification evidence gate). _(Finalized 2026-07-24: the provisional `FR-USE-09`/`FR-CERT-04` from drafting are replaced by the real PRD rows now added — §5.11 **USE-10** and §5.9 **CRT-06**. USE-09 was taken by Epic 15's retroactive cost row, so LLM observability is USE-10. See readiness-report finding F1/F2/F3.)_

**Sequencing:** 17.1 (platform LangSmith tracing) is the backbone; 17.2 (adapter emits LangSmith-traced bundles) depends on 17.1's tracing conventions being settled. 17.3 (certification dry-run gate) is independent of both. **An architecture ADR for the LangSmith dependency (external service, config/secret management, and the IP/PII-in-traces boundary) should land before 17.1.**

---

## Story 17.1: LangSmith Tracing for Platform LLM Calls

As a Vitalief operator,
I want every LLM call the platform itself makes to be traced in LangSmith with its
own cost/token/latency data,
So that I can inspect and cost individual calls — not just the per-execution
aggregate Epic 15 already stores.

**Context (from investigation):** No LangSmith/LangChain exists in the codebase today. All platform LLM calls route through a single seam, `app/integrations/anthropic_client.py` (`LLMProvider`), consumed by `execution_service.py` (`_run_prompt`/`_run_hybrid`) and the adapter-propose path. `app/core/pricing.py` is already the one pricing source of truth (Epic 15.1).

**Acceptance Criteria (epic-level contract):**

1. **AC1 — LangSmith is wired at the single LLM seam.** Tracing is added at `app/integrations/anthropic_client.py` (`LLMProvider`) so every platform LLM call (execution `_run_prompt`/`_run_hybrid`, and the adapter-propose call) emits a LangSmith span with model, input/output tokens, latency, and computed cost (reusing `app/core/pricing.py`, NOT a second pricing source).

2. **AC2 — Config-gated, safe-by-default.** LangSmith is enabled via env/config (API key, project name); when unconfigured the platform runs exactly as today (no hard dependency, no startup failure — mirrors the Sentry `init_sentry`-noops-without-DSN precedent).

3. **AC3 — IP/PII boundary respected.** What is sent to LangSmith honors the existing IP-protection boundary (no skill internals/prompts leak to clients; decide explicitly what trace payloads contain vs. redact — an ADR-level call). Client-facing surfaces are unaffected.

4. **AC4 — Relationship to Epic 15 cost is additive.** LangSmith traces do NOT replace or change the stored `invocation_results.cost_usd` (15.1) or `AnalyticsOverview.token_cost` (15.3) — this is an observability layer atop the stored fact, not a rename or a second source of truth.

**Notes:** Requires the LangSmith ADR first. No change to execution logic — only instrumentation at the provider seam.

---

## Story 17.2: AI Adapter Emits LangSmith-Traced Skill Bundles

_Depends on: Story 17.1 (tracing conventions must be settled first)._

As a Vitalief operator,
I want AI-authored/upgraded skill bundles to make their in-sandbox LLM calls
through LangSmith tracing too,
So that the individual LLM calls a code-driven hybrid skill makes at runtime are
observable, not just the platform's own calls.

**Context (from investigation):** Code-driven hybrid bundles make their own LLM calls inside the sandbox (Epic 15.5 established this runtime). Those call sites are authored by the AI adapter (`skill_integration_assistant.py`) — the same seam Epic 14.2 re-changed to thread new requirements into generated bundles. This story updates the adapter's authoring so new/upgraded bundles emit LangSmith-traced calls.

**Acceptance Criteria (epic-level contract):**

1. **AC1 — Adapter authors traced calls.** The adapter's bundle-authoring output makes in-bundle LLM calls through the LangSmith-traced path/convention established in 17.1 (e.g. a provided tracing wrapper the sandbox exposes), rather than raw untraced calls.

2. **AC2 — Existing-bundle strategy is an explicit decision.** The story decides and documents whether previously-authored bundles are re-adapted (a re-run of the adapter, echoing 14.2's upgrade path) or only trace-forward from this story — with the rationale and any migration/backfill implications stated.

3. **AC3 — Sandbox boundary + safe-by-default preserved.** In-bundle tracing honors the same config-gating as 17.1 (no LangSmith config → bundles run untraced, unbroken) and does not widen the sandbox's egress/security surface beyond what the tracing endpoint requires.

4. **AC4 — No change to bundle decision logic.** Only the LLM-call plumbing in authored bundles changes — not the adapter's proposal logic, the authoring prompts' intent, or the `RejectNonGrantor` gate.

**Notes:** Higher-risk (mutates generated skill code) — keep isolated and separately reviewable, per the Epic 14.2 precedent.

---

## Story 17.3: Certification Dry-Run Evidence Gate (5 Runs Before the Technical Key)

As an MA Tech member,
I want to perform and retain a trail of 5 runs of a skill with differing outputs
before I can record its technical certification,
So that there is documented evidence the skill was exercised before I turn the
technical key.

**Context (from investigation):** Certification is append-only today (`CertificationRecord`, `certification_records`) with `technical_certified`/`methodological_certified` flags; there is **no "test run"/dry-run concept** linking `InvocationJob`s to a pending technical certification (Epic 6.1/6.2). This story adds that gate BEFORE Story 6.2's "Record Technical Certification" action — it does not weaken 6.1's immutability or the FR-SEC-10 signature manifestation.

**Acceptance Criteria (epic-level contract):**

1. **AC1 — Dry-run trail is captured against a skill version.** An ma_tech member can associate/record up to (at least) 5 certification dry-runs for a specific skill version — each linking to an actual `InvocationJob` (reusing the existing invocation path, not a parallel runner) with its output, so the trail is real executions, not free-text.

2. **AC2 — "Different outputs" is captured/attested.** The 5 runs' distinct outputs are visible in the trail (the intent is evidence the skill was exercised across varied inputs). Whether "differing" is enforced automatically or attested by the certifier is a story-level decision to document — do not silently pick one.

3. **AC3 — Technical key is gated on the trail.** `POST /api/v1/certifications` for `certification_type=technical` is rejected (422, new stable error code, e.g. `CERTIFICATION_EVIDENCE_INSUFFICIENT`) unless the required dry-run trail (≥5 runs) exists for that exact skill version — mirroring the existing `CERTIFICATION_INCOMPLETE`/`RECERTIFICATION_REQUIRED` gate idiom (6.1).

4. **AC4 — Immutability + signature manifestation preserved.** The dry-run trail is additive evidence; it does not alter the append-only `CertificationRecord` contract, and the FR-SEC-10 electronic-signature manifestation (signer, UTC timestamp, meaning) is unchanged. Methodological certification (6.3) is NOT gated by this story — technical only, per the request.

5. **AC5 — Re-certification on a new version requires a fresh trail.** When a new skill version requires re-certification (6.4), the dry-run evidence does not carry over — a new version needs its own ≥5-run trail before its technical key (consistent with 6.4's "certifications do not carry over").

6. **AC6 — UI surface on the Certification detail panel.** The technical certification detail (Epic 6.2 UI) shows the dry-run trail and its count/status, and blocks/enables the "Record Technical Certification" button accordingly — extending 6.2's panel, not a new screen.

**Notes:** Backend (link + gate + error code) + FE (trail panel). Must not weaken 6.1 immutability or FR-SEC-10. Reuse the existing invocation/job path for the runs.

---

## Story Sequencing & Dependencies

| Story | Depends on | Ship order | Weight |
|-------|-----------|-----------|--------|
| **17-1** LangSmith platform tracing | LangSmith ADR | 1st (after ADR) | Medium |
| **17-2** Adapter emits LangSmith-traced bundles | **17-1** | after 17-1 | Medium-Heavy (mutates bundles) |
| **17-3** Certification dry-run evidence gate | — | any time | Medium |

**Recommended order:** LangSmith ADR → 17-1 → 17-2; 17-3 independent. Per `create-story` discipline, each story is expanded to full implementation detail when picked up — these epic-level ACs are the contract, not the implementation plan.
