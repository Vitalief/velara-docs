# Sprint Change Proposal — New Epic 5.5: Code-Driven Hybrid Skills & Canonical Output Contract

- **Date:** 2026-06-18
- **Author:** Developer (via bmad-correct-course)
- **Trigger:** Client delivered the first real foundation skill — `velara-protocol-extractor` (deliverable zip, 2026-06-15) — a genuine **hybrid** skill that our hybrid runtime, as built, is too narrow to host.
- **Scope classification:** **Major** (redefines the hybrid runtime's capabilities + adds an inter-skill data contract; amends PRD FRs and a core architecture decision; all new work lands in a **new Epic 5.5**, no done epics reopened). Requires PM/Architect involvement.
- **Status:** **Approved 2026-06-18** — routed to PM (FR amendments + Epic 5.5 authoring) and Solution Architect (runtime/contract design). *(v1 proposed a 4th "package" runtime — corrected: it's a hybrid skill. v3: all work in NEW Epic 5.5 after Epic 5; Epics 2 & 3 stay done; E2E run of the client skill is Epic 5.5's headline gate.)*
- **Renumbered 2026-06-25:** created and approved as **Epic 10**; renumbered to **Epic 5.5** to sit positionally right after Epic 5 (where it belongs by dependency). Epics 6–9 keep their numbers. Story IDs 10-1..10-6 → 5.5-1..5.5-6.

---

## 1. Issue Summary

The client delivered the first production foundation skill, `velara-protocol-extractor` v0.4.1 (BRD owner: Matt Maxwell). It is a **hybrid skill** (per FR-EXE-03: "an LLM orchestrates the execution and calls code helpers") — but its hybrid *shape* is the inverse of what our hybrid runtime assumed, and it exercises hybrid capabilities our implementation never built. Specifically it:

- Is a **multi-module Python package** (`src/velara_extractor/…`) with a stable entrypoint, not a single artifact blob.
- **Drives its own multi-pass LLM orchestration** — a Sonnet **vision locator** for SoA pages, an Opus **structured-extraction** pass, **multi-run consensus**, and an **enrichment** pass — i.e. *the skill's code calls the LLM*, repeatedly, with vision (`extract.py`, `pipeline.py`).
- Does **hybrid ingestion** — pdfplumber/PyMuPDF text+geometry **plus page rasterization for a vision pass** — needing the **raw PDF bytes on a filesystem**, not pre-parsed text (`ingest.py`).
- Depends on **third-party packages** — `pdfplumber`, `PyMuPDF`, `openpyxl`, `anthropic`, `pydantic` (`requirements.txt`).
- Emits a **versioned canonical data contract** (`ProtocolExtraction`, `SCHEMA_VERSION = 0.3.0`) **plus two artifacts** (canonical JSON + Excel) **plus a structured envelope** (`billing_grid`, `qa`) behind a **QA release gate** (`status: ok | blocked`).

**The mismatch (not a missing runtime — a too-narrow one):** Our hybrid runtime (`hybrid_artifact.py`, `execution_service._run_hybrid`) models a hybrid skill as a **JSON manifest** `{system, tools[], code}` where the **platform drives the LLM loop** and the skill's Python is only **tool helpers** running in the **network-blocked, stdlib-only ToolServer sandbox** (`code_sandbox.py`). The client skill is the inverse: **the skill's code drives**, the **LLM is a callee** (vision/consensus/multi-pass), the code is **multi-file with heavy deps**, and it needs **network + the raw file**. Same runtime category (LLM + code = hybrid); capabilities we never built.

**Reframing (locked with user):** This skill is a **reference implementation, not a sealed artifact**. We do **meet-in-the-middle**: strip the parts that don't belong on-platform (its own LLM creds bootstrap, filesystem I/O, CLI/plugin shell), keep the high-value core (canonical model + extraction logic), and **widen the hybrid runtime** just enough to host it cleanly — generically, for future hybrid skills of either shape.

**Issue type:** New stakeholder requirement **+** technical limitation discovered (hybrid runtime too narrow).

**Evidence:** Client zip `velara-protocol-extractor_deliverable_2026-06-15.zip` — `BUSINESS_REQUIREMENTS.md` (FR-1..24, NFR-1..9, AC-1..8), `plugin/manifest.json`, `src/velara_extractor/{plugin,pipeline,extract,ingest,model,projections}.py`, `requirements.txt`, `schema/procedure_schema.json`.

---

## 2. Conflict Map (skill vs. the hybrid runtime as built)

| # | Skill needs | Hybrid runtime today | Verdict |
|---|---|---|---|
| C1 | Multi-file code package (`src/…`) | Hybrid artifact = one JSON manifest with an inline `code` string (`hybrid_artifact.py`) | **Conflict** |
| C2 | 3rd-party deps (pdfplumber, PyMuPDF, openpyxl, anthropic, pydantic) | ToolServer = stdlib-only, no install step (`code_sandbox.py`) | **Conflict** |
| C3 | Code calls the LLM itself (vision/consensus/multi-pass) | Platform owns the LLM loop; skill code is tool-callee only (`_run_hybrid`) | **Conflict (shape)** |
| C4 | Network egress (to Anthropic) | ToolServer **blocks all sockets** | **Conflict** |
| C5 | Raw PDF bytes on a filesystem (rasterizes pages) | Platform passes **pre-parsed text** (`build_context_input`) | **Conflict** |
| C6 | 2 artifacts + structured envelope (`canonical_json`, `excel`, `qa`) | One branded file via `render_output` | **Conflict** |
| C7 | Versioned data contract (`schema_version`) for downstream skills | No inter-skill output-schema concept (metadata slot exists, unused) | **Gap** |
| C8 | QA gate `status: ok\|blocked` | Terminal `completed/failed` only | **Gap** |

**Lucky alignments (reduce the change):**
- **It is already hybrid** — no new `runtime_type`, no new lifecycle/visibility/certification path. We extend an existing category.
- **FR-REG-03** already lists skill metadata `input schema, output schema` — designed-in, unused; the data-contract work fills an existing slot.
- **FR-ING-04 / FR-OUT-03** already promise connector frameworks that don't disturb the execution layer — the wider input/output fits that seam.
- `output_format = xlsx` + `render_output` already exist; `InvocationResult.output_files` is already a **list** — multi-artifact is additive.
- The skill already ships an **adapter** (`plugin.py`) — exactly the platform↔skill boundary we standardize.

---

## 3. Strip / Keep / Platform-Provides boundary (the meet-in-the-middle)

| Part of client skill | Action | Rationale |
|---|---|---|
| `model.py` (canonical USDM model + `SCHEMA_VERSION`) | **KEEP verbatim** | Zero platform coupling; the contract downstream skills bind to — the crown jewel. |
| `extract.py`, `ingest.py`, `pipeline.py`, `projections.py` | **KEEP, adapt seams** | The real extraction logic; only its LLM client + filesystem I/O seams change. |
| `_client()` = `anthropic.Anthropic()` direct | **STRIP creds path → platform injects key** | Platform owns model creds via `SecretsProvider`; skill keeps its multi-pass/vision orchestration (locked decision). |
| `plugin.py`, `cli.py`, raw `open().write()` | **STRIP** | Platform owns invocation + artifact persistence (writes to `StorageProvider`, not local disk). |
| `bridges/`, `qa/`, `gold/`, `runs/`, `corpus/` | **STRIP from runtime bundle** (retain in skill repo) | Not needed to execute on-platform. |
| Raw-PDF access for the vision pass | **PLATFORM PROVIDES** (pass file ref/path, not only text) | Genuinely required; future hybrid skills will want the original file. |
| Multi-artifact + structured envelope + schema version | **PLATFORM PROVIDES** (widened output contract) | Generalizes to the whole downstream skill pipeline. |

---

## 4. Recommended Approach

**Option 1 — Widen the existing hybrid runtime + add a canonical-output contract (chosen).** No 4th runtime.

- **Effort:** Large · **Risk:** Medium · **Type:** Major (PM/Architect).
- **Locked design decisions (user):**
  1. **No new runtime** — this is a **hybrid** skill; we extend the hybrid runtime's capabilities, not the runtime taxonomy.
  2. **LLM ownership:** Platform **injects `ANTHROPIC_API_KEY` (via `SecretsProvider`) + grants network egress** to *trusted, certified* hybrid skills; the skill keeps its own multi-pass/vision/consensus orchestration. We do **not** force its calls through the platform's single-call interface.
  3. **Data contract:** Introduce a **first-class schema-versioned skill output** (typed canonical JSON + schema ref) downstream skills consume — filling the existing-but-unused FR-REG-03 `output schema` slot.
  4. **Isolation, phased:** **Phase 1 (local dev)** runs the widened hybrid skill in a **per-skill venv** (deps installed, egress allowed, secrets injected, raw file available); **true container/kernel isolation (gVisor/ECS task) is deferred to Epic 7** (AWS infra), consistent with how the platform already defers hardening to Epic 7.

- **Why this over the alternatives:**
  - *Add a 4th "package" runtime (rejected — user):* it's already hybrid; a new runtime duplicates lifecycle/visibility/certification surface for no semantic gain.
  - *Force all LLM calls through the platform interface (rejected — user):* large rewrite of the skill's locator/consensus/vision orchestration; constrains future hybrid skills to our call shape.
  - *Keep output an opaque artifact (rejected — user):* defers the inter-skill contract the client's whole skill pipeline (coding → coverage → budget → CTA → ops) depends on.

### Locked design parameters

- **Two hybrid sub-shapes under one `runtime_type = "hybrid"`:**
  - *(existing)* **LLM-driven** — platform runs the loop, skill code = sandboxed stdlib tools (untouched; stays in the adversarial ToolServer sandbox).
  - *(new)* **code-driven, trusted** — the skill's multi-file code drives, calls the LLM itself, bears deps, gets egress + injected secrets + raw-file access. Distinguished by the **hybrid artifact manifest** (a declared entrypoint + `requirements` + `trusted` capabilities) and **gated by certification** (Epic 6), not the adversarial sandbox.
- **Hybrid artifact may be a bundle** (zip/dir) with an entrypoint (`module:callable`) + lockfile — still one immutable versioned artifact key (the *bundle* is the artifact; FR-REG-01 holds).
- **Execution (code-driven hybrid):** per-skill venv (Phase 1) with deps installed, **network egress to declared destinations**, **`SecretsProvider` env injection** (`ANTHROPIC_API_KEY`), the **raw uploaded file available by path**, plus resource + wall-clock limits. Container isolation in Epic 7.
- **Invocation envelope (platform ↔ code-driven hybrid):** platform calls the entrypoint with `{input_path, output_dir, params}` and receives `{status, schema_version, canonical, artifacts[], qa}`. The skill's `plugin.py` is exactly this adapter — we standardize its shape.
- **Output contract:** new **`canonical_json` output type** `{schema_ref, schema_version, data}` alongside branded artifacts; `InvocationResult.output_files` carries N artifacts (already a list).
- **New job state `blocked`** (QA egregious gate): distinct from `failed`; "ran, but a human must resolve before downstream consumes." Downstream skills refuse non-`ok` upstream output.

---

## 5. Detailed Change Proposals (by artifact)

### 5a. PRD / Requirements Inventory
- **FR-EXE-03 (amend):** the hybrid runtime supports **both** LLM-driven (platform loop + sandboxed tools) **and** code-driven trusted hybrids (multi-file, dependency-bearing, network-permitted, secret-injected, raw-file-aware, certification-gated).
- **FR-EXE-05 (qualify):** "sandboxed" is **tiered** — adversarial ToolServer sandbox for LLM-driven hybrids & code skills; **isolated-but-trusted** venv/container for code-driven hybrids (isolation for platform stability, not against hostile code).
- **FR-REG-01 (clarify):** the immutable versioned artifact MAY be a **multi-file bundle**.
- **FR-REG-03 (activate):** `input schema`/`output schema` become **populated and load-bearing** for code-driven hybrids.
- **FR-ING-01 (extend):** skills may receive the **raw uploaded file by reference/path**, not only pre-parsed text.
- **FR-OUT-01 (extend):** outputs include **canonical JSON conforming to a versioned schema** + **multiple artifacts per run**, alongside branded office files.
- **New FR-OUT-05 (data contract):** platform persists a skill's output schema + `schema_version`; downstream skills declare the upstream schema they consume.
- **New FR-EXE-09 (QA gate / blocked):** a run may end `blocked` (human-resolution-required); `blocked` outputs are not consumable downstream.

### 5b. Sequencing — NEW Epic 5.5 (Epics 2 & 3 stay `done`)
**Per user: do NOT reopen done epics.** All net-new work lands in a **new Epic 5.5 — Code-Driven Hybrid Skills & Canonical Output Contract**, sequenced **after Epic 5** (it depends on the Run Console + execution loop landing first). Epics 2, 3 stay closed; only forward references (FR amendments, architecture notes) are recorded against them, not reopened scope.

**Epic 5.5 stories (proposed):**
- **5.5-1 (registry):** register a **code-driven hybrid** — bundle artifact + manifest (entrypoint, `requirements`/lockfile, declared input/output schema + `schema_version`, declared secrets, declared egress destinations, `trusted` capability flags). *(Extends Epic 2 surface without reopening it.)*
- **5.5-2 (data contract):** persist & expose **output schema + schema_version** as first-class registry metadata (activates the FR-REG-03 slot); downstream-consumes declaration.
- **5.5-3 (runtime):** code-driven hybrid executor — per-skill **venv** (Phase 1) with lockfile deps, **egress allowed**, **`SecretsProvider` injection**, **raw-file availability**, resource/timeout limits, adapter call to `module:callable`, envelope capture. Sub-dispatch inside the existing `hybrid` branch of `execution_service`.
- **5.5-4 (raw-file input):** hand the **original uploaded file** to a code-driven hybrid (augment `build_context_input`'s text-only seam) preserving S3-key-reference + PHI discipline.
- **5.5-5 (multi-artifact + canonical output + blocked state):** persist N artifacts + the `canonical_json` typed output + the `blocked` job state; extend `InvocationResult`/job-status model + Run Console download UI.
- **5.5-6 (skill adaptation + E2E):** adapt the client `velara-protocol-extractor` to the finalized contract (strip/keep per §3) and **run it end-to-end on the platform** — the epic's headline acceptance gate.
- **Epic 7 (later, not now):** one Epic-7 story replaces the Phase-1 venv with **true container/kernel isolation** (gVisor / dedicated ECS task) + network-layer egress policy. Recorded as a forward dependency; not part of Epic 5.5's close.

### 5e. Architecture
- **Amend** "Three skill runtime types" decision: still **three**, but document that **hybrid has two execution shapes** (LLM-driven sandboxed vs. code-driven trusted) with **sandbox tiering** and **egress policy** rationale (certification gates the trusted path).
- Document the **code-driven hybrid invocation envelope** and the **inter-skill data contract** (schema registry) as Implementation Patterns.

### 5f. The client skill (adaptation — separate deliverable)
- Repoint `_client()` to the **platform-injected** `ANTHROPIC_API_KEY`; keep all orchestration.
- Replace `plugin.py` filesystem writes with returning artifacts to the platform adapter (platform persists to `StorageProvider`).
- Drop `cli.py`, `bridges/`, `qa/`, `gold/`, `runs/`, `corpus/` from the runtime bundle (retain in source repo).
- Keep `model.py`, `extract.py`, `ingest.py`, `pipeline.py`, `projections.py` as the bundle core.

---

## 6. Implementation Handoff

- **Scope classification:** **Major** — redefines the hybrid runtime's capability surface + adds the inter-skill data contract. All net-new work in **new Epic 5.5** (after Epic 5); Epics 2 & 3 stay `done`.
- **Route to:** **PM** (FR-EXE-03/05 amendments + new FR-OUT-05/EXE-09; author Epic 5.5) and **Solution Architect** (hybrid sub-shape dispatch, venv-now/container-in-Epic-7 isolation, egress policy, data-contract registry, invocation envelope).
- **Then:** PO sequences Epic 5.5 stories (5.5-1..5.5-6); Dev widens the hybrid runtime + contract; the client skill is adapted (5.5-6) and run E2E as the close gate.
- **Open questions to resolve with client (their BRD §10):** finalize the invocation envelope (their open Q1 — we now define it), `schema_version` bump policy, and the eligibility-criterion-link contract (their Q6) for the future eligibility skill.

### Epic 5.5 success criteria
- **HEADLINE GATE: the client `velara-protocol-extractor` runs end-to-end on the platform** — registered as a code-driven hybrid, certified, invoked from the Run Console against a real protocol PDF, producing the canonical JSON (schema-validated) + Excel + envelope, downloadable from the UI. *(Epic 5.5 does not close until this passes.)*
- A code-driven hybrid registers with a bundle + declared schema and executes through the hybrid branch of `execution_service` with egress + injected secrets + raw-file access (Phase-1 venv).
- An egregious QA flag yields a `blocked` job downstream skills refuse to consume.
- LLM-driven hybrid, prompt, and code skills are unaffected (regression-clean).
- A later Epic 7 story swaps venv → container isolation with no contract change.
