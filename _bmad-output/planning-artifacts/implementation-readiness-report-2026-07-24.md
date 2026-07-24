---
stepsCompleted: [step-01-document-discovery, step-02-prd-analysis, step-03-epic-coverage-validation, step-04-ux-alignment, step-05-epic-quality-review, step-06-final-assessment]
readinessStatus: READY (with recommended PRD-traceability remediation — non-blocking)
findingsCount: 6
findings: [F1-phantom-FR-anchors-High, F2-no-cost/observability-FR-High, F3-no-cert-evidence-FR-Medium, M2-17.2-indirect-value-Minor, M3-17.2-bundle-migration-decision-Minor, W1-cert-governance-UX-Low]
filesIncluded:
  prd: prds/prd-Velara-2026-05-29/prd/ (sharded — index.md + 13 section files)
  architecture: architecture/ (sharded — index.md + 8 files, incl. core-architectural-decisions.md w/ 2026-07-24 LangSmith ADR)
  epics: epics/ (17 epics + epic-list.md; focus: epic-16 amended, epic-17 new)
  ux: ux-designs/ux-Velara-2026-07-01/ (DESIGN.md, EXPERIENCE.md)
assessmentScope: >
  Newly-planned work from correct-course 2026-07-24 — Epic 16 Stories 16.7/16.8
  (FE bug fixes) and Epic 17 Stories 17.1/17.2/17.3 (LangSmith + certification
  evidence gate), plus the 2026-07-24 LangSmith ADR. Epics 1-15 and 16.1-16.6 are
  already implemented/done and out of scope for re-validation.
---

# Implementation Readiness Assessment Report

**Date:** 2026-07-24
**Project:** Velara
**Assessor:** Winston (System Architect) via implementation-readiness workflow
**Scope:** Readiness of the correct-course 2026-07-24 additions — Epic 16 (16.7, 16.8) + Epic 17 (17.1, 17.2, 17.3) + the LangSmith ADR — before dev picks them up.

## Document Inventory

| Type | Format | Location | Status |
|------|--------|----------|--------|
| PRD | Sharded | `prds/prd-Velara-2026-05-29/prd/` (`index.md` + `1-…13-…` sections; FRs in `5-functional-requirements.md`) | ✅ Found, no duplicate |
| Architecture | Sharded | `architecture/` (`index.md` + 8 files; decisions in `core-architectural-decisions.md`, now incl. the 2026-07-24 LangSmith ADR) | ✅ Found, no duplicate |
| Epics & Stories | Multi-file | `epics/` (17 epic files + `epic-list.md`; Epic 16 amended, Epic 17 new this session) | ✅ Found |
| UX | Sharded | `ux-designs/ux-Velara-2026-07-01/` (`DESIGN.md`, `EXPERIENCE.md`) | ✅ Found |

**Duplicates:** None. (PRD folder has `index.md` = shard TOC and `product-requirements-document.md` = thin cover header; not a whole/sharded conflict.)
**Missing:** None of the four required document types is missing.

## PRD Analysis

The PRD (`prds/prd-Velara-2026-05-29/prd/`) numbers requirements by **domain prefix** (`ORG-`, `REG-`, `SKL-`, `EXE-`, `LOC-`, `ING-`, `OUT-`, `ACL-`, `USR-`, `INV-`, `CRT-`, `API-`/`CON-`, `USE-`, `SEC-`, `POR-`), Priority P1/P2/P3. NFRs are a prose/table section (§6), **not numbered**. Requirements relevant to the Epic 16/17 additions are extracted below; the full registry was read.

### Functional Requirements — relevant to this assessment's scope

**Invocation / Run Console (§5.8) — anchors for Epic 16 Stories 16.7/16.8:**
- **INV-05** — Run interface launched contextually (Engagements = context-first; skill detail = skill-first); not a top-level nav item. P1.
- **INV-06** — Context-first mode: Client→Project→Study pre-populated from the originating entity; **the user selects the skill to run**. P1.
- **INV-07** — Skill-first mode: **skill is pre-selected and locked**; context picker unrestricted. P1.
- **INV-08** — Both modes provide a back button to the originating screen. P1.
- **INV-09** — Project-attached skills visible/runnable from Project and from each Study under it. P1.
- **INV-10** — Warn on duplicate recent run (advisory, non-blocking). P2 (Epic 12).
- Run-UX prose (§5.8): *"Context-first … The user **selects a skill** from those available at that level"* / *"Skill-first … **pre-selected and locked**."*

**Certification (§5.9) — anchors for Epic 17 Story 17.3:**
- **CRT-01** — Two-key certification; both keys before `client-ready`. P1.
- **CRT-02** — Technical certification (MA Tech key): executes without error; **handles representative and adversarial inputs**; code review; description triggers Claude; outputs match schema. P1.
- **CRT-03** — Methodological certification (Matt key). P1.
- **CRT-04** — Both recorded against the specific version; new version requires re-cert. P1.
- **CRT-05** — Cert record fields immutable. P1.

**Usage/Audit (§5.11) — anchors for Epic 17 Story 17.1 (LangSmith):**
- **USE-01** — Every invocation logged (…runtime duration, outcome, input/output refs…). P1.
- **USE-03** — Usage queryable by hierarchy/user/skill/time/outcome. P1.
- **USE-06** — Value-reporting view for renewals. P2.
- **USE-07 / USE-08** — audit-display name-resolution / per-event-type icon (Epic 12). *(These are the REAL USE-07/USE-08 in the PRD — see Finding F1.)*

**Security/Compliance (§5.12) & §6.4 — governing constraints on Epic 17:**
- **SEC-01/SEC-07** — BAA-eligible cloud + signed BAA before any PHI-adjacent skill. P1.
- **SEC-03** — TLS 1.2+ in transit. P1.
- **SEC-04** — **PHI is never written to URLs, log lines, or error messages — architectural, platform-enforced, not skill-level.** P1. *(This is the constraint the LangSmith ADR is built to honor.)*
- **§6.4 Compliance** — HIPAA built-in from day one; data hosted in the US by default; skill artifacts/IP are Vitalief-owned work-for-hire.

### Non-Functional Requirements
§6 (unnumbered): Performance (≤2s P95 platform overhead; ≥10 concurrent execs; ≤500ms registry list P95), Reliability (99.5% uptime; zero silent failures; daily backup), Maintainability (Vitalief-owned repo; vendor-handover-grade docs; mature OSS preferred), Compliance/Legal (HIPAA day-one; US hosting; Vitalief IP ownership).

### PRD Completeness Assessment — ⚠️ requirements-traceability gaps found

The PRD is thorough and well-maintained for everything through Epic 14, but **the correct-course epics created after 2026-07-20 (Epics 15, 16, 17) cite FR numbers that do not exist in the PRD registry, and the PRD was never amended to add the requirements those epics deliver.** This is a real traceability break, not a cosmetic one, and it is **pre-existing** — Epic 17 inherits and continues it rather than originating it.

- **F1 (High) — FR-numbering-scheme drift + non-existent anchors.** Epics 15/16/17 use an `FR-<DOMAIN>-NN` scheme that the PRD does not use (the PRD uses bare `USE-07`, not `FR-USE-07`). Worse, the numbers **collide with different real requirements**:
  - Epic 15 claims **`FR-USE-07`** (cost) — but the PRD's real **USE-07** is *audit name-resolution* (Epic 12).
  - Epic 16 claims **`FR-USE-08`** (run-history) — but the PRD's real **USE-08** is *audit event-type icons* (Epic 12).
  - Epic 17 claims **`FR-USE-09`** and **`FR-CERT-04`** — the PRD has **no USE-09** (registry stops at USE-08) and **no CRT-06+** (stops at CRT-05); `FR-CERT-04` also mis-numbers (would be CRT-06, since CRT-04 already exists and means something else).
- **F2 (High) — No PRD requirement exists for cost tracking OR LLM observability at all.** Epic 15 (cost, done & shipped) and Epic 17.1/17.2 (LangSmith) both trace to phantom FRs. The functional requirement for "per-execution / per-call cost & LLM observability" was never written into §5.11. The capability shipped (Epic 15) without a PRD anchor; Epic 17 extends a requirement that isn't recorded.
- **F3 (Medium) — Certification-evidence gate (17.3) has no PRD requirement.** §5.9 CRT-02 lists technical-certification *criteria* ("handles representative and adversarial inputs") but nothing requires a **documented 5-run evidence trail** as a precondition to the key. 17.3 introduces a new governance obligation with no CRT-row to trace to.

**Consequence for readiness:** none of these block *implementation* of 16.7/16.8/17.x (the epics/stories carry enough detail to build from), but they mean the **PRD no longer tells the truth about what the platform does** for cost/observability/cert-evidence. Recommended remediation is in the final report; the cleanest fix is to add real PRD rows (USE-09 cost-tracking [retroactive, Epic 15], USE-10 LLM-call observability [Epic 17], CRT-06 technical-certification evidence gate [Epic 17]) and correct the epics' `FRs covered` lines to the PRD's actual prefix scheme.

## Epic Coverage Validation

Scope: the FRs that the correct-course additions (16.7, 16.8, 17.1, 17.2, 17.3) build on, satisfy, or supersede — plus the phantom-FR findings from PRD Analysis. This is a targeted trace, not a full-registry sweep (Epics 1–14 coverage is already validated in `architecture-validation-results.md`).

### Coverage Matrix — in-scope requirements

| PRD Req | Requirement (abbrev) | Epic/Story Coverage | Status |
|---------|----------------------|---------------------|--------|
| INV-05 | Run interface launched contextually | Epic 5 (5.2/5.3), unchanged | ✅ Covered |
| INV-06 | Context-first: context pre-populated; **user selects skill** | Epic 5 5.2; **Story 16.8 narrows** for the explicit-skill launch | ✅ Covered + amended |
| INV-07 | Skill-first: **skill pre-selected & locked** | Epic 5 5.3; 16.8 reuses this locked idiom | ✅ Covered |
| INV-08 | Both modes: back to originating screen | Epic 5 5.2; 16.8 AC4 preserves | ✅ Covered |
| — | Run Console restores active job across refresh | Epic 5 **5.4** (`activeJobId` localStorage/session restore); **Story 16.7 fixes** the over-restore regression | ✅ Covered + fix |
| CRT-01 | Two-key certification before `client-ready` | Epic 6 (6.1–6.3) | ✅ Covered |
| CRT-02 | Technical cert criteria (adversarial inputs, etc.) | Epic 6 6.2; **Story 17.3 adds a pre-key evidence gate** | ✅ Covered + extended |
| CRT-04 | Cert recorded per version; re-cert on new version | Epic 6 6.1/6.4; 17.3 AC5 requires fresh trail per version | ✅ Covered |
| CRT-05 | Cert record immutable | Epic 6 6.1; 17.3 AC4 preserves | ✅ Covered |
| USE-01/03 | Invocation logged, queryable | Epic 9; **17.1 LangSmith is additive observability** atop this | ✅ Covered + additive |
| SEC-04 | PHI never in URLs/logs/errors — platform-enforced | Epic 1/13; **LangSmith ADR (2026-07-24) is the governing constraint on 17.1/17.2** | ✅ Covered (ADR honors it) |
| **USE-07 (cost)** | *claimed by Epic 15 as `FR-USE-07`* | **PRD has no cost FR** — USE-07 is audit-name-resolution | ❌ **Phantom (F2)** |
| **USE-09 (LLM observ.)** | *claimed by Epic 17 as `FR-USE-09`* | **PRD has no USE-09** | ❌ **Phantom (F1/F2)** |
| **CRT-06 (cert evidence)** | *claimed by Epic 17 as `FR-CERT-04`* | **PRD has no such CRT row** | ❌ **Phantom (F1/F3)** |

### Missing Requirements (reverse-traceability: work with no PRD anchor)

**No implementation gap** — every new *story* has an epic home and buildable ACs. The gaps are **requirements not written back into the PRD**:

1. **Cost tracking (Epic 15, shipped) — no PRD FR.** Should be a real §5.11 row, e.g. **USE-09 — Per-execution/per-skill/per-user cost is recorded and surfaced (P1, Epic 15)**. Retroactive; the capability is live.
2. **LLM-call observability (Epic 17.1/17.2) — no PRD FR.** Should be **USE-10 — Individual LLM calls are traced (cost/latency/tokens) via a config-gated, environment-graded secondary sink; metadata-only in trust-graded environments (P2, Epic 17)** — worded to match the LangSmith ADR's boundary.
3. **Technical-certification evidence gate (Epic 17.3) — no PRD FR.** Should be **CRT-06 — Before the technical certification key is recorded, a documented trail of ≥5 dry-runs with differing outputs must exist for that skill version (P1, Epic 17)**.

### Coverage Statistics (in-scope trace)

- In-scope PRD anchor requirements traced: **11** (INV-05/06/07/08, CRT-01/02/04/05, USE-01/03, SEC-04) → **all covered**, several amended/extended by the new stories (correctly noted as forward-amendments in the epic files).
- New stories with a valid epic home + buildable ACs: **5 / 5** (16.7, 16.8, 17.1, 17.2, 17.3).
- Requirements delivered by these + prior correct-course epics but **absent from the PRD registry: 3** (cost, LLM-observability, cert-evidence) → the F1/F2/F3 traceability break.
- **Implementation-readiness verdict for coverage:** the new work is buildable and every anchor FR is covered; the defect is **documentation traceability** (PRD not kept in sync), pre-existing since Epic 15, which Epic 17 should be the trigger to fix.

## UX Alignment Assessment

### UX Document Status
**Found** — two "spine" documents: `DESIGN.md` (Design Spine: brand, colors, typography, layout, components, do's/don'ts) and `EXPERIENCE.md` (Experience Spine: IA, voice, behavioral component patterns, state patterns, interaction primitives, accessibility floor, + two exemplar flows). These are **pattern/primitive specs, not a per-screen catalog** — by design, they establish reusable spine patterns rather than wireframe every screen. Only two flows are narrated as exemplars (Story 8.6 skill-attachment; Epic 10 user-onboarding).

### Alignment — the three in-scope stories with UX surface

- **16.8 (engagement Run → locked single skill) — ✅ aligned, reuses an existing pattern.** The skill-first mode "skill pre-selected and locked" presentation (PRD INV-07; already shipped in `RunConsoleSkillFirstInner`) is the exact idiom 16.8 reuses for the engagement-launch case. This is a **spine-consistent reuse**, not a new pattern — the story's own AC1 says "mirroring skill-first mode's locked card." No new UX design needed; it applies an established one. The Design Spine's card/component conventions cover the locked card.
- **16.7 (Run Console stale-job fix) — ✅ aligned, maps to the State Patterns section.** This is a state-correctness fix (empty state vs. restored-job state), squarely in `EXPERIENCE.md`'s "State Patterns" territory. No new visual surface; it corrects *when* the existing empty/active states render.
- **17.3 (certification dry-run evidence panel) — ⚠️ aligned-by-pattern, but the Certification governance screen is not narrated in the UX spine.** 17.3 AC6 extends the Epic 6.2 technical-certification detail panel with a dry-run trail + gated button. The Design/Experience spines give the primitives to build it (panel, list, state-gated button, the slide-in panel pattern from Flow 1), so it is **buildable spine-consistently** — but there is **no exemplar flow or screen note for the Certification/governance surface** the way there is for attachment and onboarding. This is the only story where a designer might reasonably want a quick pattern confirmation (how the evidence trail reads, how the blocked→enabled key transition is signalled) before build. Low risk given the reusable primitives, but worth a note.

### Warnings

- **W1 (Low) — Certification governance UX is unspecified beyond primitives.** The cert screen (Epic 6.2, and now 17.3's evidence gate) has no dedicated flow in the Experience Spine. Not a blocker — the spine's primitives + Epic 6.2's shipped screen cover it — but 17.3 is the story most likely to benefit from a 15-minute UX pattern check (evidence-trail presentation, key-gating affordance) at create-story time. Recommend a quick UX-designer (Sally) consult when 17.3 is drafted, not a full UX doc.
- **17.1 / 17.2 (LangSmith) — no UX surface, correctly.** Confirmed: no user-facing UI (traces live in LangSmith's own console; the ADR and epic explicitly add no new API/FE surface). No UX alignment needed. This is correct scoping, not a gap.

### Architecture ↔ UX
No conflict. The new work touches no performance/responsiveness target in §6, and the Design Spine's component set supports the locked-card and evidence-panel surfaces. The LangSmith ADR is backend-only and does not intersect the UX spine.

## Epic Quality Review

Applied the create-epics-and-stories standards to the five new stories. I reviewed my own additions with the same rigor I'd apply to anyone's — the LangSmith epic in particular needed an honest "is this a technical-milestone epic?" test.

### Epic-level checks

**Epic 16 (amended):** Already a valid user-value epic (engagement-model refinement). 16.7/16.8 slot in as fixes to shipped behavior. ✅ No independence issue — both are `Independent of 16.1-16.6/16.7`, correctly stated, no forward dependency.

**Epic 17 (new) — user-value check (the important one):**
- **Title "LLM-Call Observability & Certification Evidence"** — borderline-technical on its face, so I pushed on it. Verdict: **passes, but barely, and only because the stories are framed by operator/user outcome.** 17.1's user is "a Vitalief operator who wants to inspect and cost individual LLM calls"; 17.3's user is "an MA Tech member who wants documented evidence before turning the key." Those are real personas with real outcomes, not "instrument the LLM client." **17.2 is the weakest** — "adapter emits traced bundles" reads closest to a technical milestone; its user value is indirect (operator observability *of* bundle calls), riding on 17.1. It survives because it's a dependent story *within* a user-value epic, not a standalone epic. ⚠️ Minor flag M2 below.
- **Independence:** Epic 17 stands alone — it needs Epics 6 and 15 (both `done`), never a *future* epic. ✅ No forward epic dependency.

### Story-level checks

| Story | User value | Independent? | ACs testable? | Sizing | Verdict |
|-------|-----------|--------------|---------------|--------|---------|
| 16.7 | ✅ clear (empty console, no stale job) | ✅ | ✅ 4 ACs, incl. regression test (AC4) | Light FE | **Ready** |
| 16.8 | ✅ clear (run the skill I clicked) | ✅ | ✅ 4 ACs, preserves 5.2 behavior explicitly | Light FE | **Ready** |
| 17.1 | ✅ (operator inspects/costs calls) | ✅ (needs ADR, done) | ✅ 4 ACs, config-gated/safe-by-default measurable | Medium | **Ready** |
| 17.2 | ⚠️ indirect (see M2) | ✅ depends on 17.1 (**backward**, valid) | ✅ 4 ACs; AC2 defers a real decision to story-time (valid) | Medium-Heavy | **Ready w/ note** |
| 17.3 | ✅ clear (evidence before the key) | ✅ | ✅ 6 ACs, strong; error code + immutability preserved | Medium | **Ready** |

### Dependency analysis
- **No forward dependencies anywhere.** All three dependency edges point backward or sideways: 16.7/16.8 → none; 17.1 → LangSmith ADR (now written); 17.2 → 17.1; 17.3 → none. ✅
- **17.1 depends on an ADR, not a story** — correctly modeled as a pre-condition in the epic ("ADR before 17.1"), and the ADR is now in `core-architectural-decisions.md`. ✅ The blocker the correct-course proposal named is cleared.
- **Schema/table timing:** 17.3 introduces a dry-run↔certification link (new table/columns) — correctly created by the story that needs it, not upfront. ✅ 16.7/16.8/17.1/17.2 add no schema.

### Acceptance-criteria quality
- **16.7 AC2** ("in-flight jobs still survive a refresh — must not regress") — excellent: it names the one behavior the fix must NOT break, turning a vague bug-fix into a testable contract. ✅
- **16.8 AC1/AC2** cleanly separate the two launch paths (with-skill = locked; without-skill = picker survives) — testable and unambiguous. ✅
- **17.1 AC2/AC3** (safe-by-default; IP/PII boundary) are testable against the ADR's rules; **AC4** (additive to Epic 15 cost) is a clear non-regression assertion. ✅
- **17.3 ACs** are the strongest of the set — 6 ACs covering the gate (AC3, with a named stable error code), immutability preservation (AC4), fresh-trail-per-version (AC5), and the UI (AC6). One deliberate open decision (AC2: enforce-vs-attest "different outputs") is correctly flagged as a story-time call, not left silent. ✅

### Findings

- **M2 (Minor) — Story 17.2's user value is indirect; keep it framed by outcome at create-story.** "Adapter emits LangSmith-traced bundles" is the one story that could drift into a technical-milestone framing. It's legitimate (observability of in-bundle LLM calls is the operator outcome), but when 17.2 is expanded, lead its story statement with the operator-visible benefit ("so an operator can see the individual LLM calls a skill makes at runtime"), not the mechanism. No structural defect; a framing guardrail.
- **M3 (Minor) — 17.2 AC2 defers a real scope decision (re-adapt existing bundles vs. trace-forward).** This is *correctly* deferred to story-time (it's an implementation judgment), but flag it as a decision that carries a migration implication — if "re-adapt existing," that's a batch operation over shipped skills that needs its own verification. Name it explicitly at create-story so it isn't discovered mid-build.

### Best-practices compliance summary
- [x] Epics deliver user value (17.1/17.3 clearly; 17.2 indirectly — M2)
- [x] Epics function independently (17 needs only done epics)
- [x] Stories appropriately sized (all Light–Medium-Heavy, none epic-sized)
- [x] No forward dependencies (all edges backward/sideways)
- [x] Tables created when needed (17.3 only; others schema-free)
- [x] Clear, testable acceptance criteria (all five)
- [⚠️] Traceability to FRs maintained — **NO** (F1/F2/F3 from PRD Analysis: phantom FR anchors). This is the one best-practice the new work fails, and it's pre-existing/inherited.

**No 🔴 Critical or 🟠 Major structural violations.** The stories are well-formed, independent, testable, and correctly sequenced. All findings are 🟡 Minor (M2, M3) or the inherited traceability break (F1–F3, documentation not structure).

## Summary and Recommendations

### Overall Readiness Status

**READY TO IMPLEMENT — with one documentation-remediation action recommended before/alongside build (not a blocker).**

The five new stories (16.7, 16.8, 17.1, 17.2, 17.3) are structurally sound: valid user value, epic-independent, no forward dependencies, correctly sequenced, testable ACs, and schema created only where needed (17.3). The LangSmith ADR that the correct-course proposal named as the blocker on 17.1 is written and internally consistent, so 17.1 is unblocked. Every PRD anchor requirement the new work builds on (INV-05/06/07/08, CRT-01/02/04/05, USE-01/03, SEC-04) is covered, with the amendments correctly recorded as forward-amendments in the epic files.

The **one real defect is requirements traceability** — and it is **pre-existing and inherited**, not introduced by this session's work.

### Critical Issues Requiring Immediate Action

**None are structural blockers.** The highest-severity items are documentation-traceability breaks (High severity for *correctness of the PRD as a record*, not for *ability to build*):

- **F1/F2 (High) — Cost tracking (Epic 15, already shipped) and LLM observability (Epic 17) trace to FR numbers that do not exist in the PRD, and collide with different real requirements** (`FR-USE-07` ≠ PRD's real USE-07 = audit name-resolution; `FR-USE-08` ≠ PRD's real USE-08 = audit icons; `FR-USE-09`/`FR-CERT-04` don't exist). The PRD does not record a cost-tracking or observability requirement at all. **A shipped capability (Epic 15 cost) has no PRD anchor** — that is the sharpest expression of the gap.
- **F3 (Medium) — the 17.3 certification evidence gate has no CRT requirement** in §5.9.

### Recommended Next Steps

1. **Amend the PRD (§5.11 and §5.9) to close the traceability break — the highest-value action.** Add three real rows in the PRD's own prefix scheme:
   - **USE-09 — Per-execution / per-skill / per-user cost is recorded and surfaced** (P1, Epic 15 — retroactive; the capability is live).
   - **USE-10 — Individual LLM calls are traced (cost/latency/tokens) via a config-gated, environment-graded secondary sink; metadata-only in trust-graded environments** (P2, Epic 17 — word it to the LangSmith ADR's boundary).
   - **CRT-06 — A documented trail of ≥5 dry-runs with differing outputs must exist for a skill version before its technical certification key is recorded** (P1, Epic 17).
   This is a PM (John) task — I can hand it off, or Winston can draft the rows for John to approve.
2. **Correct the `FRs covered` lines in Epics 15, 16, and 17** to the PRD's actual prefix scheme (`USE-09`/`USE-10`/`CRT-06`, not `FR-USE-*`/`FR-CERT-*`), once step 1 assigns the real numbers. Small edit; removes the phantom-anchor drift permanently.
3. **Proceed to create-story for 16.7 and 16.8 now** — they are the live deployed-dev fixes, fully ready, zero open questions, and independent of the PRD remediation.
4. **When 17.2 is drafted, apply the two minor guardrails (M2, M3):** lead its story statement with the operator-visible outcome (not the mechanism), and explicitly name the re-adapt-existing-bundles-vs-trace-forward decision (AC2) as a scope call with a possible migration implication.
5. **When 17.3 is drafted, book a 15-minute UX (Sally) pattern check (W1)** for the evidence-trail presentation and the blocked→enabled key affordance — the cert governance surface has primitives but no exemplar flow in the UX spine.

### Final Note

This assessment identified **6 findings across 3 categories** (traceability: F1/F2/F3; epic-quality: M2/M3; UX: W1). **None blocks implementation.** The stories are buildable as written; 16.7/16.8 can start immediately. The one thing worth fixing before the plan is considered truly complete is the PRD traceability break (F1–F3) — the PRD currently under-records what the platform actually does for cost, observability, and certification evidence. That is a documentation-integrity fix, best done as a quick PM amendment, and Epic 17 is the natural trigger to finally close it (it has been open since Epic 15).

**Assessor:** Winston (System Architect) · **Date:** 2026-07-24

## Amendment Applied — Requirements-Traceability Remediation (2026-07-24)

Findings F1/F2/F3 are **resolved**. Root cause was deeper than first assessed: not "phantom FRs," but **two divergent requirements registries** — the PRD §5 (bare IDs) and `epics/requirements-inventory.md` (`FR-` prefix), which had drifted (e.g. `FR-USE-07`=cost in the inventory vs. §5 `USE-07`=audit-name-resolution). Per operator decision, **the PRD is now the single source of truth** and the inventory is retired.

Actions taken:
- **Merged into PRD §5 (lossless):** the inventory's PRD-absent content — `ORG-07` (Engagements search) and the full 21 CFR Part 11 + HIPAA + SOC 2 compliance decomposition `SEC-09..SEC-17` (tied to done Epics 6/7/8/9/13, verbatim with amendment notes). Verified: all 11 present, no duplicate IDs.
- **Added the three new capability rows:** `USE-09` (per-execution cost — retroactive, Epic 15), `USE-10` (LangSmith LLM-call observability — Epic 17, boundary set by the 2026-07-24 ADR), `CRT-06` (technical-certification 5-run evidence gate — Epic 17).
- **PRD §5.0 note** declares §5 authoritative and records the numbering reconciliation.
- **Retired `requirements-inventory.md`** to a tombstone banner (frozen; FR→Epic cross-walk preserved as reference; "add FRs to the PRD, not here").
- **Corrected the active-work `FRs covered` lines** in Epics 15/16/17 to bare PRD IDs; **banner added to `epic-list.md`** naming the PRD authoritative (legacy `FR-` prefixes on done-epic rows left as historical record per operator decision — a full sweep was scoped out as cosmetic on completed work).

Residual (non-blocking, noted for a future pass): `epic-list.md`'s ~20 done-epic "FRs covered" rows still carry the legacy `FR-` prefix (governed now by the banner). `requirements-inventory.md`'s frozen body likewise. Neither affects buildability; both are covered by explicit pointers to the PRD.

**Readiness verdict unchanged: READY.** The one High-severity documentation defect the assessment surfaced (F1/F2) is now closed at the source — the PRD once again truthfully records what the platform does for cost, observability, certification evidence, and the previously-undecomposed compliance frameworks.
