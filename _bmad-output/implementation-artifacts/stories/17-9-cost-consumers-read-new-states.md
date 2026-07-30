---
governing_ads: [AD-5, AD-9]
spine: _bmad-output/planning-artifacts/architecture/architecture-Velara-2026-07-29/ARCHITECTURE-SPINE.md
depends_on: [17-7, 17-8]
status_note: STUB created by correct-course 2026-07-29. Run bmad-create-story to fill full context before dev.
---

# Story 17.9: Cost Consumers Read the New States

Status: backlog

## Story

As a consumer of cost data (analytics, Run Console, client portal, certification),
I want to correctly interpret estimated vs. reconciled vs. NULL cost,
so that dashboards and evidence never treat an estimate as final or a pending/untraceable run as free.

## Acceptance Criteria

1. `analytics_service` aggregates unchanged in mechanism (`SUM(cost_usd)` over leaf rows, NULL-skipping) and the leaf-sum-with-parent=0 invariant is **verified still holds** after the reconciler (AD-9) — no double-count of fan-out parents.
2. `SUM` may include estimated + reconciled (both real dollars); dashboards MAY optionally surface "includes N estimated". (AD-5)
3. Jobs/client APIs expose cost consistent with AD-5 states; client-facing surfaces keep the existing IP-safety rule (client portal never exposes internal cost). No NULL→$0 coalescing for LLM runtimes.
4. **Certification (17.3):** confirm whether it snapshots `cost_usd` into evidence; if so, decide+document whether it captures the estimate or waits for reconciled (flag from spine Deferred). Tolerate the estimate→reconciled window.
5. Gates green; a spot-check confirms an estimated run and a reconciled run both render correctly on the Run Console.

## Dev Notes
- Governing: **AD-5, AD-9**. Depends on 17-7 (estimate) and 17-8 (reconciler) so both states exist to read. Last story in the chain.
