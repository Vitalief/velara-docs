# Epic 5.5 Retrospective — Code-Driven Hybrid Skills & Canonical Output Contract
**Date:** 2026-06-27
**Facilitator:** Amelia (Senior Software Engineer)
**Project Lead:** Developer
**Participants:** Amelia (Dev), Winston (Architect), John (PM), Sally (UX), Developer (Project Lead)

---

## Epic Summary

**Epic 5.5: Code-Driven Hybrid Skills & Canonical Output Contract** — The platform can register, validate, and execute code-driven hybrid skills with venv isolation, schema-versioned output contracts, raw-file input, multi-artifact output, and a first-class `blocked` job state. The headline deliverable: the real `velara-protocol-extractor` client skill running E2E on a real 149-page clinical protocol PDF.

### Delivery Metrics
- **Stories delivered:** 6/6 (100%) — 5.5.1 through 5.5.6 all marked done
- **Code review:** 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor) on every story
- **Patches applied:** 10 (5.5.1) + 1 (5.5.2) + 7 (5.5.3) + 3 (5.5.4) + 3 (5.5.5) + 4 (5.5.6) = **28 total**, all verified
- **ACs satisfied:** 25/25
- **Unit tests added:** ~78+; Integration tests added: 12+
- **Regressions in existing runtimes:** 0 — Epics 2 & 3 (prompt, code, LLM-hybrid) stay green; 722+ tests pass
- **Production incidents:** 0 (pre-production phase)
- **Headline gate result:** ARROW NCT03037385 (149pp, 2.1MB PDF) → job 6635015d, completed, schema_version 0.3.0, 10 arms / 16 encounters / 25 activities / 102 instances / 0 QA flags

### What Was Built
- **5.5.1:** Bundle manifest registration + validation — code-driven shape detection by `entrypoint` key, entrypoint regex per-segment validation, IP-safe Pydantic error handling, circular import guard
- **5.5.2:** Schema-versioned output contract — `schema_version` + `consumes` snapshotted per `SkillVersion`; Alembic revision ID length fix
- **5.5.3:** Code-driven venv executor — subprocess sandbox (RLIMIT_AS + RLIMIT_NOFILE + wall-clock timeout + off-thread stdout), literal env (never splat `os.environ`), sentinel-delimited envelope (`__VELARA_ENVELOPE__`)
- **5.5.4:** Raw-file input materialization to `input_dir`; real skill API contract verified against `~/Downloads/velara-protocol-extractor`
- **5.5.5:** Multi-artifact output (dict-keyed), canonical JSON persistence, `blocked` job state as first-class terminal outcome distinct from `failed`
- **5.5.6:** HEADLINE GATE — adapter shim (D1), corrected manifest (D3), real PDF E2E; runtime fixes: event-loop teardown, `:ro` volume, memory cap

---

## What Went Well

### Headline Gate as Binary Success Criterion
The gate story (5.5.6) enforced a binary outcome from day one: real client skill, real protocol PDF, real extraction — or not done. This changed the team's orientation from AC-checkbox completeness to real-world correctness. Three runtime defects (event-loop teardown, read-only volume, memory cap) only appeared under this standard and would have shipped undetected otherwise.

### Client-Artifact-First Design Held
Story 5.5.4 read the actual `velara-protocol-extractor` bytes before closing the execution model. That verification caught two design gaps — `artifacts` modeled as `list[dict]` instead of `dict[str, str | None]`, and named kwargs vs. `params` dict — before the gate story, not during it. The adapter shim (D1) and envelope reconciliation (5.5.5) both flowed from ground truth, not assumptions.

### Docker Integration Tests Caught What Unit Tests Couldn't
All three CRITICAL defects in 5.5.3 were found only by running Docker integration tests against real infrastructure:
- RLIMIT_AS ValueError on macOS → subprocess crashes as INTERNAL, not a resource limit hit
- Stdout deadlock (read before `proc.wait()`) → timeout never fires on long-running skills
- Monkeypatch target doesn't exist → secrets mock silently returns None → ANTHROPIC_API_KEY is None in subprocess

Unit tests with mocks caught zero of these.

### Literal Env Discipline is Now Embedded
The HIGH security defect in 5.5.3 (`{**os.environ}` leaked DB/S3/Redis credentials into the untrusted subprocess) was caught by adversarial review and patched. The corrected pattern — build env from a literal allowlist (PATH, HOME, ANTHROPIC_API_KEY, declared `requires` creds) — is now embedded in the executor and propagated through 5.5.4–5.5.6.

### `blocked` as First-Class State
Separating `blocked` (output held for QA review, no error_code) from `failed` (execution error, has error_code) is conceptually clean and UI-correct. The amber hold treatment vs. red failure communicates intent accurately. The full path — envelope → `JOB_STATUS_BLOCKED` → UI amber panel + artifact downloads — is wired and tested.

### Zero Regressions Across Existing Runtimes
The additive design (code-driven hybrid as a new branch, not a reshape of existing paths) kept Epics 2 & 3 fully green. 722+ tests pass; ruff clean throughout.

---

## What Went Wrong — The Honest Breakdown

### No Formal PM Sign-Off Artifact for Deferred-Work HIGH Items
The Epic 5 retro committed to a formal PM sign-off process for HIGH items in `deferred-work.md`. John reviewed items informally, but no written disposition record exists. The process improvement lived in one person's head, not in the workflow. For a compliance-adjacent product (21 CFR Part 11 in Epic 6), this gap matters more going forward.

### Adapter Shim is a One-Off, Not a Standard
The D1 decision (skill-side adapter shim for the named-kwargs vs. params-dict mismatch) was correct for one skill. But it creates a proliferation risk: every new code-driven skill with a non-conforming arg contract writes its own shim. There is no documented standard for what a code-driven skill's entrypoint must look like. This was identified during the retrospective and resolved — see Action Item 1.

### Epic-List Milestone Framing (Fourth Carry)
Committed in Epic 3 retro, Epic 4 retro, and Epic 5 retro. Still absent. Now a fourth carry with John explicitly owning it before Epic 6 kickoff.

### Cascade-Delete (Fourth Carry — Deliberate)
The Engagements screen non-atomic cascade has carried four epics. **Explicit decision to keep carrying:** Epic 6 has no hierarchy mutations in scope. Risk stays theoretical until real usage load or a data-integrity incident forces the conversation.

---

## Previous Retro (Epic 5) Action-Item Follow-Through

| # | Action | Status | Notes |
|---|--------|--------|-------|
| 1 | `GET /api/v1/skills?q=` backend search story | ✅ Done | Story 5.8 delivered |
| 2 | Skill Registry search wired to `?q=` — frontend story | ✅ Done | Story 5.9 delivered |
| 3 | Consumer-audit checklist before any story changing a shared API shape | ✅ Applied | 5.5.4 explicitly grepped all `execute_skill` callers before adding `ingest_storage` param |
| 4 | Workspace temp-dir pattern for code-driven executor | ✅ Done | 5.5.3 implemented `input_dir` / `output_dir` workspace pattern |
| 5 | Formal PM sign-off artifact for deferred-work HIGH items | ⚠️ Partial | Items reviewed informally; no written disposition record |
| 6 | Backend cascade-delete endpoint (Epic 4 carry) | ❌ Deferred (deliberate) | Fourth carry; explicit decision to revisit under real usage load |
| 7 | Epic-list milestone framing (Epic 3+4 carry) | ❌ Not done | Fourth carry; John owns before Epic 6 kickoff |

---

## Key Insights

1. **A headline gate story changes what "done" means.** Binary outcome (real artifact in, valid output out) eliminates the AC-checkbox escape hatch. Every client-integration epic should have one as its final story.

2. **Run integration tests against live infrastructure before merging.** Docker-gated tests caught 3 CRITICAL defects that unit tests with mocks missed entirely. The 5 extra minutes to spin up Postgres + MinIO saved days of production debugging.

3. **Client-artifact-first design prevents rework.** Reading the real skill bytes in 5.5.4 caught two model mismatches before the gate story. Designing against specs without validating against code creates an epic of rework (see Epic 5.5's own origin story from Epic 3).

4. **Adapter shims need a standard or they proliferate.** One shim is a workaround. Two shims is a pattern. Three shims is a maintenance problem. Standardize the entrypoint contract while the executor is fresh and only one skill exists.

5. **Process improvements must produce artifacts, not just intentions.** The deferred-work PM sign-off commitment from Epic 5 existed only in John's head. For it to be real, there must be a written record: a disposition entry in sprint-status, a story brief note, something checkable.

---

## Next Epic Preview — Epic 6: Certification & Governance

**What Epic 6 builds:** MA Tech and Matt Maxwell execute the two-key certification workflow, advancing skills from `internal_ready` to `client_ready` with immutable certification records and 21 CFR Part 11 electronic signatures.

**Dependencies on Epic 5.5 — all satisfied:**
- `blocked` as first-class job state ✅
- `schema_version` snapshotted per skill version ✅
- `client_ready` lifecycle transition in registry ✅
- D2 resolved: no Phase-1 cert gate on code-driven skills; Epic 6 is where that gate lands ✅

**Flags raised before story creation:**
- Immutability constraint for `certification_records` must be enforced at DB layer, not just application layer (Winston)
- Technical-before-methodological sequencing must be an explicit AC in 6.1, not an implicit assumption (John)
- Unified governance view (single list, not tabs) needs UX validation before 6.2 implementation begins (Sally)

---

## Action Items

### New Stories

| # | Action | Owner | When | Success Criteria |
|---|--------|-------|------|-----------------|
| 1 | Standardize code-driven entrypoint contract: `run(input_path, output_dir, params: dict)` — validator enforces at registration, contract documented as skill onboarding reference | Amelia + Winston | Before or alongside 6.1 | Registration rejects non-conforming entrypoints with clear error code; existing adapter shim documented as reference implementation |

### Process Improvements

| # | Action | Owner | When | Success Criteria |
|---|--------|-------|------|-----------------|
| 2 | Formal PM sign-off artifact for deferred-work HIGH items at epic start | John | Before Epic 6 kickoff | Written disposition record per HIGH item: backlog story / in-scope / accepted limitation — visible in sprint-status or story brief |
| 3 | Epic-list milestone framing (fourth carry — this time it ships) | John | Before Epic 6 kickoff | Each epic in epic-list.md has a "what a consultant can do after this epic" milestone line |
| 4 | Headline gate story as required final story for every client-integration epic | Amelia | Story creation template | Gate story is binary: real artifact in, valid output out — no unit-test escape hatch |

### Epic 6 Critical Path (Before 6.1 Story Written)

| # | Item | Owner |
|---|------|-------|
| 1 | Document DB-layer immutability constraint for `certification_records` | Winston |
| 2 | Clarify technical-before-methodological sequencing as explicit AC | John |
| 3 | Code-driven entrypoint contract story created and queued | Amelia |

### Carry-Forwards (Explicit Decisions)

| # | Item | Decision |
|---|------|---------|
| 5 | Backend cascade-delete endpoint | Deferred deliberately — fourth carry; revisit under real usage load or data-integrity incident |
| 6 | Venv pre-bake at registration | Deferred — Phase 1 trades ~20s pip install latency for simplicity |
| 7 | Egress enforcement (advisory only) | Deferred to Epic 7 infrastructure work |
| 8 | Blocked fan-out child rollup | Deferred — unreachable today, no code-driven fan-out skill exists |

---

## Readiness Assessment

- **Testing & Quality:** 25/25 ACs verified; 722+ tests green; 0 regressions. Integration tests confirm real-skill E2E.
- **Deployment:** Pre-production phase; no deployment milestone for this epic.
- **Stakeholder acceptance:** N/A (internal pre-production).
- **Technical health:** Code-driven hybrid runtime is solid. Existing runtimes (prompt, code, LLM-driven hybrid) unaffected. One open design gap: entrypoint contract not yet standardized (Action Item 1).
- **Blockers for Epic 6:** None. All dependencies satisfied. Three pre-story documentation items (Winston, John, Amelia) before 6.1 story creation.

---

**Amelia (Senior Software Engineer):** "Epic 5.5 delivered 6/6 stories with a real headline gate passed on the actual client skill. The adversarial review process held — 28 patches, all real defects, zero regressions. The client-artifact-first discipline prevented the class of rework that created Epic 5.5 in the first place. The one new systemic gap identified — no standard entrypoint contract for code-driven skills — has a concrete resolution locked before Epic 6 starts."

**Winston (Architect):** "The venv executor is production-ready for Phase 1. The three RLIMIT + timeout + stdout fixes in 5.5.3 make it robust. I'm not worried about Epic 6 dependencies."

**John (PM):** "I own items 2, 3, and the Epic 6 sequencing AC. Not carrying those again."

**Sally (UX Designer):** "Unified governance view validation is on my list before 6.2 gets written. I'll have a design decision ready."
