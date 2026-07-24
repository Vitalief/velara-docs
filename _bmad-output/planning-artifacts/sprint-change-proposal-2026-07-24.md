# Sprint Change Proposal — 2026-07-24

**Author:** Developer (via correct-course)
**Trigger:** Five stakeholder change requests raised after Epic 16 completion — two deployed-dev bugs in the Run Console, one already-satisfied version-gate request, LangSmith per-LLM-call cost tracking, and a new certification dry-run gate.
**Mode:** Batch
**Scope classification:** **Moderate** — 2 amendments to a `done` epic (Epic 16) + 1 new epic (Epic 17). No PRD/architecture invalidation; all items extend the existing model the way Epics 14/15/16 extended their predecessors.

---

## Section 1 — Issue Summary

Five requests were raised against the running dev deployment and the shipped feature set:

1. **Run Console opens the last run whenever opened from anywhere (BUG).** Opening the Run Console from any entry point surfaces a previously-completed job's status/output instead of an empty "Run to invoke" state.
2. **"Run" from an engagement screen shows every attached skill (BUG/UX).** Clicking Run on a *specific* skill from a Project/Study screen opens the console showing the whole attached-skill picker with that skill merely pre-selected — the user expects the console locked to just that one skill.
3. **~~Skill version visibility~~ → Run Console version *selector* should be admin/ma_tech only (CORRECTED, ALREADY SATISFIED).** Original phrasing was "version should only show to admin/ma-tech"; corrected in-session to: the **version selector/pin on the Run Console** should be grantor-only, everyone else runs the latest published version. Version *display* elsewhere is fine for all roles.
4. **LangSmith for per-individual-LLM-call cost tracking (NEW CAPABILITY).** Track each individual LLM call (not just the per-execution aggregate Epic 15 already stores). Clarified in-session: this also requires **re-changing the AI adapter** so newly authored/upgraded **skill bundles** emit LangSmith-traced LLM calls (bundle code makes its own LLM calls inside the sandbox).
5. **Certification dry-run trail: 5 documented runs before the technical key can be turned (NEW FLOW).** Before an `ma_tech` member records the technical certification (Epic 6, "turn the key"), they must be able to perform and retain a trail of **5 runs of the skill with different outputs** as documented evidence.

**How discovered:** Direct operator/stakeholder feedback on the deployed dev environment and the certification workflow, 2026-07-24.

---

## Section 2 — Impact Analysis

### Evidence gathered (code-grounded, not speculative)

| # | Finding | Source |
|---|---|---|
| 1 | `JobStatusPanel` restores `activeJobId` from `sessionStorage` at mount; the `hydratedJobId` one-shot guard clears it **only if the job is TERMINAL**. A terminal restored job is meant to be cleared — but the request says the last run still appears, so the guard is not firing as intended in deployed dev (candidate causes: `hydratedJobId` not set on hydration, `partialize` persisting more than intended, or the terminal-status set / effect-deps not matching). Root-cause is part of the fix story. | `RunConsole.tsx:1134-1158`, `useRunStore.ts` |
| 2 | Context-first Run Console renders the **entire** `availableSkills` list (project + study attachments) as a `role="listbox"` picker, with `preSelectedSkillId` only setting the initial selection — it does not lock to one skill. Skill-*first* mode already locks (`RunConsoleSkillFirstInner`). | `RunConsole.tsx:487-501, 670-696` |
| 3 | **Already satisfied.** `_resolve_target_version(skill, requested_version, is_grantor)` honors a version pin only for grantors; "a non-grantor's `version` is silently ignored" → they get `current_version`. FE `VersionSelector` is gated behind `isRunGrantor = isGrantor()` in **both** run modes. `isGrantor()` === `admin`/`ma_tech`. | `invocations.py:77-98`, `RunConsole.tsx:542,699,828,833`, `auth.test.ts` |
| 4 | No LangSmith/LangChain anywhere today. LLM calls route through a single seam, `app/integrations/anthropic_client.py` (`LLMProvider`), used by `execution_service.py`. Skill **bundles** (code-driven hybrid) make their own LLM calls inside the sandbox — those are authored by the AI adapter (`skill_integration_assistant.py`), the same seam Epic 14 changed. | grep (no hits), `execution_service.py:38`, Epic 15 context |
| 5 | Certification is append-only (`CertificationRecord`, `certification_records`) with `technical_certified`/`methodological_certified` flags; there is **no "test run" / dry-run concept** linking `InvocationJob`s to a pending certification today. Request 5 is genuinely net-new: a gate BEFORE Story 6.2's technical key. | `models/certification.py`, `certification_service.py`, Epic 6 |

### Epic impact

- **Epic 16 (done → amended):** +2 fix stories (16.7, 16.8). Both regress against Run Console behavior Epic 16 touched (16.5 menu consolidation and the engagement-screen Run affordances). Epic 16 flips `done → in-progress` while these land.
- **Epic 17 (NEW):** 3 stories — LangSmith platform tracing, LangSmith adapter-bundle emission, Certification 5-run gate.
- **Epic 5 (done):** unchanged in file, but 16.7/16.8 amend behavior its ACs 5.2/5.4 described. Noted as superseded-going-forward (same pattern Epic 16 used on Epics 3/4/5/8). No re-open of Epic 5.
- **Epic 6 (done):** unchanged in file; Epic 17's cert-gate story adds a pre-6.2 requirement. Noted as extended-going-forward; no re-open of Epic 6.
- **Epic 15 (done):** unchanged; Epic 17's LangSmith work is additive observability alongside 15.x's stored cost (does not change `invocation_results` cost, does not rename `AnalyticsOverview.token_cost`).

### Story impact

- **Request 3 → no story.** Documented as already-satisfied (Story 11.7). Evidence in Section 4.

### Artifact conflicts

- **PRD:** no invalidation. LangSmith relates to FR-USE-07 (Epic 15's cost FR) as an observability extension; certification dry-run relates to Epic 6's governance FRs (FR-SEC-10 signature manifestation stays intact). New FRs are introduced at epic level, mirroring how 14/15/16 added FRs via correct-course.
- **Architecture:** LangSmith introduces a new external dependency + tracing config — an ADR-worthy addition (LangSmith client, env config, PII/IP-in-traces boundary). Flagged for the architect in handoff. No existing architectural decision is contradicted.
- **UX:** minor — 16.8 changes the Run Console skill area from a picker to a locked single-skill card (skill-first idiom already exists to mirror); cert 5-run gate needs a small "certification dry-runs" surface on the Certification detail panel (Epic 6 UI). No new screens.

### Technical impact

- **16.7/16.8:** FE-only (velara-web), no schema, no backend. Low risk.
- **17 LangSmith:** new dependency (`langsmith`), env/config, tracing wrappers at the `LLMProvider` seam + adapter-propose; **adapter-bundle story mutates generated skill code** (higher risk — touches the authoring prompt/templates, echoes Epic 14.2). Decision needed in-story: re-adapt existing bundles or trace-forward only.
- **17 cert gate:** new join/link between dry-run `InvocationJob`s and a pending certification, + a gate check in the technical-certification write path (`POST /api/v1/certifications`), + FE surface. Backend + FE. Medium.

---

## Section 3 — Recommended Approach

**Direct Adjustment** (no rollback, no MVP reduction):

- **Requests 1 & 2 → amend Epic 16** as fix-stories **16.7** and **16.8** (per operator direction). Keeps the Run Console bugs with the engagement work they regress against; Epic 16 becomes the active sprint epic again.
- **Request 3 → drop** (already satisfied by Story 11.7; evidence recorded).
- **Requests 4 & 5 → new Epic 17**, with LangSmith split into **two** stories (platform tracing + adapter-bundle emission) per operator direction, plus the certification dry-run gate.

**Rationale:** Every item extends the existing model rather than replacing it — the established correct-course pattern here. The two bugs are cheap FE fixes that should ship first (they affect deployed dev now). LangSmith is the only item introducing new infrastructure and carries an ADR + the adapter-mutation risk, so it is isolated in its own epic and split so the risky bundle-authoring change is a discrete, separately-reviewable story.

**Effort / risk / sequence:**

| Item | Effort | Risk | Sequence |
|---|---|---|---|
| 16.7 Run Console last-run leak | Light (FE) | Low | 1st — deployed-dev bug |
| 16.8 Engagement Run → single skill | Light (FE) | Low | 1st — deployed-dev UX |
| 17.1 LangSmith platform tracing | Medium (dep + config + seam) | Medium (new external dep, IP-in-traces boundary) | After ADR |
| 17.2 LangSmith adapter-bundle emission | Medium-Heavy (mutates authored bundles) | Higher (adapter re-change, à la 14.2) | After 17.1 |
| 17.3 Certification 5-run dry-run gate | Medium (link + gate + FE) | Medium (governance path — must not weaken 6.1 immutability / FR-SEC-10) | Independent of 17.1/17.2 |

---

## Section 4 — Detailed Change Proposals

### 4.0 — Request 3: NO CHANGE (already satisfied)

> **Finding:** Story 11.7 already implements exactly this. The Run Console `VersionSelector` renders only when `isRunGrantor = isGrantor()` (`admin`/`ma_tech`) in both context-first (`RunConsole.tsx:699`) and skill-first (`:828-833`) modes. The backend `_resolve_target_version` (`invocations.py:77-98`) honors a `version` pin **only for grantors**; a non-grantor's `version` is "silently ignored" → they run `current_version` (the latest published). This is backend-enforced, not FE-cosmetic. **No story created.** If deployed-dev appears to contradict this, re-open as a bug (operator chose "drop — already satisfied").

---

### 4.1 — Epic 16, NEW Story 16.7: Fix Run Console Restoring a Stale Completed Job

**File:** `epic-16-engagement-model-refinement.md` (append after 16.6)

```
## Story 16.7: Run Console No Longer Reopens a Stale Completed Job

_Fix. FRONTEND (velara-web). Independent of 16.1-16.6._

As a Vitalief consultant,
I want the Run Console to open empty ("Run to invoke") unless I have an
in-flight job or explicitly opened a specific job,
So that a previously-finished run doesn't reappear every time I open the
console from anywhere.

**Context (from investigation):** `activeJobId` is persisted to sessionStorage
solely so polling survives a mid-run refresh (`useRunStore.ts`). `JobStatusPanel`
(`RunConsole.tsx:1134-1158`) restores it at mount and is supposed to clear it via
the `hydratedJobId` one-shot guard when the restored job is already TERMINAL —
but in deployed dev a completed job still shows. This story root-causes why the
guard is not firing (candidates: `hydratedJobId` not set at hydration, over-broad
`partialize`, `TERMINAL_JOB_STATUSES` mismatch, or effect-dependency timing) and
fixes it so the intended behavior holds.

**Acceptance Criteria:**

1. **AC1 — Empty by default.** Opening the Run Console from any entry point
   (nav, skill detail, engagement screen) with no in-flight job shows the empty
   "No job running. Click Run to invoke a skill." state — never a
   previously-completed job's status/output.

2. **AC2 — In-flight jobs still survive a refresh.** A job that is still
   queued/running when the tab is refreshed IS restored and polling resumes
   (the one behavior sessionStorage persistence exists to protect — must not
   regress).

3. **AC3 — Explicit reopen still works.** Selecting a specific job from Jobs
   History (which sets `activeJobId` before navigating) still opens that job —
   the fix must distinguish "explicitly opened" from "stale restore" (the exact
   distinction `hydratedJobId` was built to make).

4. **AC4 — Root cause documented + regression test.** The dev record states the
   actual root cause; a test covers "terminal job in sessionStorage → console
   opens empty" and "running job in sessionStorage → console restores it."

**Notes:** FE-only. No API/schema change. Do not remove sessionStorage
persistence — narrow the restore, don't delete it (AC2).
```

---

### 4.2 — Epic 16, NEW Story 16.8: Lock the Run Console to a Single Skill When Launched from an Engagement Skill Row

**File:** `epic-16-engagement-model-refinement.md` (append after 16.7)

```
## Story 16.8: Engagement-Screen "Run" Opens the Console Locked to That One Skill

_Fix/UX. FRONTEND (velara-web). Independent of 16.1-16.7._

As a Vitalief consultant,
I want clicking "Run" on a specific skill from a Project or Study screen to open
the Run Console showing only that skill,
So that I'm running the skill I clicked, not re-picking it from the full list of
everything attached in that context.

**Context (from investigation):** In context-first mode the console renders the
entire `availableSkills` picker (project + study attachments) as a
`role="listbox"` and only pre-*selects* the clicked skill (`RunConsole.tsx:
487-501, 670-696`). Skill-first mode already locks to one skill
(`RunConsoleSkillFirstInner`) — this story brings the engagement-launched
context-first path in line with that locked idiom, for the case where a single
skill was explicitly chosen.

**Acceptance Criteria:**

1. **AC1 — Launched-with-a-skill = locked single skill.** When the console is
   opened from an engagement skill row (a specific `skillId` is supplied), the
   skill area shows only that one skill as a locked card (mirroring skill-first
   mode's locked card), not the full picker. Context (Client/Project/Study)
   stays pre-scoped and locked exactly as it is today (5.2 behavior preserved).

2. **AC2 — No-skill context launch still shows the picker.** If the console is
   opened context-first WITHOUT a specific skill (e.g. a future "Run something
   here" affordance), the multi-skill picker still renders — this story narrows
   only the explicit-skill launch path, it does not remove the picker component.

3. **AC3 — Run behavior unchanged.** The invocation payload, version handling
   (grantor-only selector per 11.7), location selector for location-dependent
   skills, and study-protocol handling (16.4) all behave exactly as today for
   the locked skill.

4. **AC4 — Back navigation unchanged.** Back still returns to the originating
   Project/Study screen (5.2 AC preserved).

**Notes:** FE-only. Reuse skill-first mode's locked-card presentation rather than
inventing a new one. No API/schema change.
```

---

### 4.3 — NEW Epic 17: Observability & Certification Evidence

**File:** NEW `epic-17-observability-and-certification-evidence.md`

```
# Epic 17: LLM-Call Observability & Certification Evidence

> **Created 2026-07-24** via correct-course (see
> `planning-artifacts/sprint-change-proposal-2026-07-24.md`). Trigger: operator
> requests for (a) per-individual-LLM-call tracking via LangSmith — extending
> Epic 15's per-execution cost with call-level tracing, including inside
> AI-authored skill bundles — and (b) a documented 5-run dry-run trail before an
> ma_tech member can turn the technical certification key. **Epics 6 and 15 stay
> `done`** — this epic extends their scope forward (LangSmith is observability
> atop 15's stored cost; the cert dry-run gate is a new pre-condition on 6.2's
> technical key), the same pattern Epic 15 used on Epic 9 and Epic 16 used on 3/4/5/8.

**FRs covered:** FR-USE-09 (new — call-level LLM observability), FR-CERT-04
(new — technical-certification evidence gate). [FR numbers provisional — confirm
against PRD FR registry during story creation.]

**Sequencing:** 17.1 (platform LangSmith tracing) is the backbone; 17.2 (adapter
emits LangSmith-traced bundles) depends on 17.1's tracing conventions being
settled. 17.3 (certification dry-run gate) is independent of both. An
architecture ADR for the LangSmith dependency (external service, config, and the
IP/PII-in-traces boundary) should land before 17.1.

---

## Story 17.1: LangSmith Tracing for Platform LLM Calls

As a Vitalief operator,
I want every LLM call the platform itself makes to be traced in LangSmith with
its own cost/token/latency data,
So that I can inspect and cost individual calls — not just the per-execution
aggregate Epic 15 already stores.

**Acceptance Criteria (epic-level contract):**

1. **AC1 — LangSmith is wired at the single LLM seam.** Tracing is added at
   `app/integrations/anthropic_client.py` (`LLMProvider`) so every platform LLM
   call (execution `_run_prompt`/`_run_hybrid`, and the adapter-propose call)
   emits a LangSmith span with model, input/output tokens, latency, and computed
   cost (reusing `app/core/pricing.py`, NOT a second pricing source).

2. **AC2 — Config-gated, safe-by-default.** LangSmith is enabled via env/config
   (API key, project name); when unconfigured the platform runs exactly as today
   (no hard dependency, no startup failure — mirrors the Sentry
   `init_sentry`-noops-without-DSN precedent).

3. **AC3 — IP/PII boundary respected.** What is sent to LangSmith honors the
   existing IP-protection boundary (no skill internals/prompts leak to clients;
   decide explicitly what trace payloads contain vs. redact — an ADR-level call).
   Client-facing surfaces are unaffected.

4. **AC4 — Relationship to Epic 15 cost is additive.** LangSmith traces do NOT
   replace or change the stored `invocation_results.cost_usd` (15.1) or
   `AnalyticsOverview.token_cost` (15.3) — this is an observability layer atop the
   stored fact, not a rename or a second source of truth.

**Notes:** Requires the LangSmith ADR first. No change to execution logic — only
instrumentation at the provider seam.

---

## Story 17.2: AI Adapter Emits LangSmith-Traced Skill Bundles

_Depends on: Story 17.1 (tracing conventions must be settled first)._

As a Vitalief operator,
I want AI-authored/upgraded skill bundles to make their in-sandbox LLM calls
through LangSmith tracing too,
So that the individual LLM calls a code-driven hybrid skill makes at runtime are
observable, not just the platform's own calls.

**Context:** Code-driven hybrid bundles make their own LLM calls inside the
sandbox (Epic 15.5). Those call sites are authored by the AI adapter
(`skill_integration_assistant.py`) — the same seam Epic 14.2 re-changed to thread
new requirements into generated bundles. This story updates the adapter's
authoring so new/upgraded bundles emit LangSmith-traced calls.

**Acceptance Criteria (epic-level contract):**

1. **AC1 — Adapter authors traced calls.** The adapter's bundle-authoring output
   makes in-bundle LLM calls through the LangSmith-traced path/convention
   established in 17.1 (e.g. a provided tracing wrapper the sandbox exposes),
   rather than raw untraced calls.

2. **AC2 — Existing-bundle strategy is an explicit decision.** The story decides
   and documents whether previously-authored bundles are re-adapted (a re-run of
   the adapter, echoing 14.2's upgrade path) or only trace-forward from this
   story — with the rationale and any migration/backfill implications stated.

3. **AC3 — Sandbox boundary + safe-by-default preserved.** In-bundle tracing
   honors the same config-gating as 17.1 (no LangSmith config → bundles run
   untraced, unbroken) and does not widen the sandbox's egress/security surface
   beyond what the tracing endpoint requires.

4. **AC4 — No change to bundle decision logic.** Only the LLM-call plumbing in
   authored bundles changes — not the adapter's proposal logic, the authoring
   prompts' intent, or the `RejectNonGrantor` gate.

**Notes:** Higher-risk (mutates generated skill code) — keep isolated and
separately reviewable, per the Epic 14.2 precedent.

---

## Story 17.3: Certification Dry-Run Evidence Gate (5 Runs Before the Technical Key)

As an MA Tech member,
I want to perform and retain a trail of 5 runs of a skill with differing outputs
before I can record its technical certification,
So that there is documented evidence the skill was exercised before I turn the
technical key.

**Context:** Certification is append-only today (`CertificationRecord`) with no
"test run"/dry-run concept linking `InvocationJob`s to a pending technical
certification (Epic 6.1/6.2). This story adds that gate BEFORE Story 6.2's
"Record Technical Certification" action — it does not weaken 6.1's immutability
or the FR-SEC-10 signature manifestation.

**Acceptance Criteria (epic-level contract):**

1. **AC1 — Dry-run trail is captured against a skill version.** An ma_tech member
   can associate/record up to (at least) 5 certification dry-runs for a specific
   skill version — each linking to an actual `InvocationJob` (reusing the
   existing invocation path, not a parallel runner) with its output, so the trail
   is real executions, not free-text.

2. **AC2 — "Different outputs" is captured/attested.** The 5 runs' distinct
   outputs are visible in the trail (the intent is evidence the skill was
   exercised across varied inputs). Whether "differing" is enforced
   automatically or attested by the certifier is a story-level decision to
   document — do not silently pick one.

3. **AC3 — Technical key is gated on the trail.** `POST /api/v1/certifications`
   for `certification_type=technical` is rejected (422, new stable error code,
   e.g. `CERTIFICATION_EVIDENCE_INSUFFICIENT`) unless the required dry-run trail
   (≥5 runs) exists for that exact skill version — mirroring the existing
   `CERTIFICATION_INCOMPLETE`/`RECERTIFICATION_REQUIRED` gate idiom (6.1).

4. **AC4 — Immutability + signature manifestation preserved.** The dry-run trail
   is additive evidence; it does not alter the append-only `CertificationRecord`
   contract, and the FR-SEC-10 electronic-signature manifestation (signer, UTC
   timestamp, meaning) is unchanged. Methodological certification (6.3) is NOT
   gated by this story — technical only, per the request.

5. **AC5 — Re-certification on a new version requires a fresh trail.** When a new
   skill version requires re-certification (6.4), the dry-run evidence does not
   carry over — a new version needs its own ≥5-run trail before its technical key
   (consistent with 6.4's "certifications do not carry over").

6. **AC6 — UI surface on the Certification detail panel.** The technical
   certification detail (Epic 6.2 UI) shows the dry-run trail and its
   count/status, and blocks/enables the "Record Technical Certification" button
   accordingly — extending 6.2's panel, not a new screen.

**Notes:** Backend (link + gate + error code) + FE (trail panel). Must not weaken
6.1 immutability or FR-SEC-10. Reuse the existing invocation/job path for the runs.

---

## Story Sequencing & Dependencies

| Story | Depends on | Ship order | Weight |
|-------|-----------|-----------|--------|
| **17-1** LangSmith platform tracing | LangSmith ADR | 1st (after ADR) | Medium |
| **17-2** Adapter emits LangSmith-traced bundles | **17-1** | after 17-1 | Medium-Heavy (mutates bundles) |
| **17-3** Certification dry-run evidence gate | — | any time | Medium |

**Recommended order:** LangSmith ADR → 17-1 → 17-2; 17-3 independent. Per
create-story discipline, each story is expanded to full implementation detail
when picked up — these epic-level ACs are the contract, not the implementation plan.
```

---

## Section 5 — Implementation Handoff

**Scope: Moderate.** Backlog reorganization + one architectural decision.

| Recipient | Responsibility |
|---|---|
| **Solution Architect** | Author a LangSmith ADR before Epic 17.1: external dependency, config/secret management, and the IP/PII-in-traces boundary (what trace payloads may contain vs. must redact). This is the one net-new infrastructure decision. |
| **Product Owner / create-story** | Add 16.7, 16.8 to Epic 16 (flip Epic 16 `done → in-progress`); create Epic 17 file + sprint-status entries for 17.1/17.2/17.3. Confirm provisional FR numbers (FR-USE-09, FR-CERT-04) against the PRD FR registry. |
| **Developer (dev-story)** | Implement in sequence: 16.7 → 16.8 (deployed-dev bugs first) → 17.1 → 17.2, with 17.3 slotted per capacity. Each expanded to full detail via create-story at pickup. |

**Success criteria:**
- 16.7: Run Console opens empty by default; in-flight jobs still restore; regression test present.
- 16.8: engagement Run opens locked to the clicked skill; picker still available for context-only launch.
- 17.1: individual platform LLM calls visible/costed in LangSmith; safe-by-default when unconfigured; Epic 15 stored cost unchanged.
- 17.2: AI-authored bundles emit traced calls; existing-bundle strategy documented.
- 17.3: technical key blocked until a ≥5-run dry-run trail exists for the version; immutability + FR-SEC-10 intact.
- Request 3: closed as already-satisfied (Story 11.7), no code change.

---

## Appendix — Requests → Disposition

| # | Request | Disposition |
|---|---|---|
| 1 | Run Console opens last run | **Epic 16 → Story 16.7** (bug fix) |
| 2 | Engagement Run shows all skills | **Epic 16 → Story 16.8** (fix/UX) |
| 3 | Version selector admin/ma_tech only | **No change — already satisfied by Story 11.7** (backend-enforced) |
| 4 | LangSmith per-LLM-call tracking (+ adapter bundle change) | **Epic 17 → Stories 17.1 + 17.2** |
| 5 | Certification 5-run evidence gate | **Epic 17 → Story 17.3** |
