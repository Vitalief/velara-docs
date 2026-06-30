# Epic 5.5: Code-Driven Hybrid Skills & Canonical Output Contract

> **Created 2026-06-18** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-06-18.md`). **Renumbered 2026-06-25: Epic 10 → Epic 5.5** to sit positionally right after Epic 5, where it belongs by dependency (Epics 6–9 keep their numbers). Trigger: the client delivered the first real foundation skill — `velara-protocol-extractor` — a genuine **hybrid** skill whose shape (code drives, LLM is a callee; multi-file; deps; network; raw-file; schema-versioned multi-artifact output behind a QA gate) the hybrid runtime as built (LLM drives, code = sandboxed stdlib tools) cannot host. Epics 2 & 3 stay `done`; all net-new work lands here. **Sequenced after Epic 5.**

The hybrid runtime is widened to support a second execution shape — **code-driven, trusted** hybrid skills — without adding a new `runtime_type`. The platform gains a first-class **schema-versioned output contract** so the client's downstream skill pipeline (coding → coverage → budget → CTA → ops) can bind to one canonical model. The epic's headline gate is the client `velara-protocol-extractor` running **end-to-end on the platform**.

**FRs covered:** FR-EXE-03 (amended — hybrid supports code-driven trusted shape), FR-EXE-05 (qualified — tiered sandbox), FR-REG-03 (activated — input/output schema load-bearing), FR-ING-01 (extended — raw-file-by-reference), FR-OUT-01 (extended — canonical JSON + multi-artifact), **new** FR-OUT-05 (schema-versioned output contract), **new** FR-EXE-09 (QA `blocked` job state).
**Sequencing:** After Epic 5 (depends on the execution loop + Run Console). Phase-1 isolation = per-skill venv; **true container isolation deferred to an Epic 7 story** (forward dependency, not part of Epic 5.5's close).
**Strip/keep boundary for the client skill:** keep `model.py` + `extract/ingest/pipeline/projections`; strip `_client()` creds bootstrap, `plugin.py`/`cli.py` filesystem I/O, `bridges/qa/gold/runs/corpus`. See proposal §3.

---

## ⚠️ THE CLIENT SKILL — location + verified contract (read this before any 5.5.x story)

The skill this entire epic exists to run — `velara-protocol-extractor` — is **NOT in the repo** (decision: reference by path, do not vendor). It lives at:

- **Extracted bundle:** `~/Downloads/velara-protocol-extractor/` (source under `src/velara_extractor/`)
- **Deliverable zip:** `~/Downloads/velara-protocol-extractor_deliverable_2026-06-15.zip`
- **Real test protocols:** `~/Downloads/ARROW_NCT03037385_protocol.pdf`, `~/Downloads/Protocol_NCT05375838.pdf`

**Verified ground-truth contract** (read from the bundle 2026-06-26 — trust the CODE, the bundled `plugin/manifest.json` is stale):

- **Entrypoint:** `velara_extractor.plugin:run(input_path, output_dir=None, *, model=None, consensus_runs=1, enrich=True, emit_excel=True)` — takes **named keyword args, NOT a `params` dict**.
- **Raw file by path:** `ingest.py:150` `pdfplumber.open(path)` + `ingest.py:193` `fitz.open(path)` — needs the raw **PDF/DOCX on disk** at `input_path` (this is what Story 5.5.4 delivers).
- **Returns:** `{status: ok|blocked, schema_version, canonical, billing_grid, artifacts: {canonical_json, excel}, qa: {releasable, egregious, warnings}}`.
- **Creds:** `_client()` = `anthropic.Anthropic()` reads `ANTHROPIC_API_KEY` from env (5.5.3 injects it).
- **Real `schema_version` = `0.3.0`** (`model.py:33`), NOT the `0.1.0` in the stale bundled manifest.

**TWO verified mismatches between the real skill and the 5.5.3 executor — both BLOCK the 5.5.6 headline gate** (full detail + fix paths in `implementation-artifacts/deferred-work.md` under the 5.5-4 create-story entry):

1. **Runner arg shape** — the 5.5.3 runner calls `func(..., params=dict)`; the real `run()` takes named kwargs → `TypeError`, skill never starts. Fix = a 5.5.6/architect decision (runner `**params` splat **or** a 5.5.6 adapter shim). Changes the contract every code-driven skill binds to.
2. **`artifacts` dict vs list** — real returns a role-keyed dict + a `billing_grid` key; `CodeDrivenResultEnvelope` wants `list[dict]` → `CODE_DRIVEN_ENVELOPE_ERROR`. **Story 5.5.5 must reshape the envelope** to the real skill's output.

---

## Story 5.5.1: Register a Code-Driven Hybrid Skill (Bundle Artifact + Manifest)

As an MA Tech developer,
I want to register a hybrid skill whose artifact is a multi-file bundle with a declared entrypoint, dependency lockfile, schemas, secrets, and egress declarations,
So that code-driven hybrid skills can live in the registry as immutable versioned artifacts alongside prompt/code/LLM-driven-hybrid skills.

**Acceptance Criteria:**

**Given** a hybrid skill bundle (zip/dir) with a manifest declaring `entrypoint` (`module:callable`), `requirements`/lockfile, `input_schema`, `output_schema` + `schema_version`, `requires` (secrets), and declared egress destinations
**When** I register it via the skill API
**Then** the **bundle** is stored as one immutable versioned artifact via `StorageProvider` with `runtime_type = hybrid` (FR-REG-01 — the bundle is the immutable unit), and the manifest metadata is persisted and retrievable (FR-REG-03)

**Given** a bundle missing a required manifest field (entrypoint, `output_schema`/`schema_version`, or lockfile)
**When** I attempt to register it
**Then** registration is rejected 422 with a clear, specific error naming the missing field (FR-REG-03 — schemas are load-bearing, not optional)

**Given** the existing LLM-driven hybrid manifest shape (`{system, tools[], code}`)
**When** it is registered
**Then** it still validates and is unaffected — manifest-shape detection distinguishes the two without a new `runtime_type` (both hybrid shapes coexist) (FR-EXE-03)

---

## Story 5.5.2: Schema-Versioned Skill Output Contract (Registry Metadata)

As a platform developer building downstream skills,
I want a skill's output schema and `schema_version` to be first-class, queryable registry metadata, and a way for a skill to declare the upstream schema it consumes,
So that a pipeline of skills can bind to one canonical, versioned data contract.

**Acceptance Criteria:**

**Given** a code-driven hybrid declaring an `output_schema` + `schema_version`
**When** it is registered
**Then** the schema + version are persisted as first-class registry metadata and exposed via the skill read API (FR-REG-03 activated, FR-OUT-05)

**Given** a skill declaring an upstream schema (and version) it consumes
**When** it is registered
**Then** the consumes-declaration is persisted, so a downstream skill's input can be validated against the upstream producer's contract before a pipeline runs (FR-OUT-05)

**Given** two versions of a skill with different `schema_version`s
**When** I query the registry
**Then** each version's output contract is independently resolvable (supports the immutable-version contract — FR-REG-01)

---

## Story 5.5.3: Code-Driven Hybrid Executor (Phase-1 Venv)

As a consultant,
I want the platform to execute a code-driven hybrid skill in an isolated per-skill venv with its dependencies installed, network egress permitted, platform secrets injected, and resource limits enforced,
So that a skill that drives its own multi-pass/vision LLM orchestration runs on the platform.

**Acceptance Criteria:**

**Given** a registered code-driven hybrid
**When** it is invoked and the Celery `run_skill` task dispatches it
**Then** `execution_service.execute_skill` enters the existing `runtime_type == "hybrid"` branch and **sub-dispatches by manifest shape** to the new code-driven executor (the LLM-driven `_run_hybrid` path is unchanged for `{system, tools[], code}` manifests) (FR-EXE-03)

**Given** the executor runs the bundle
**When** it starts
**Then** a per-skill venv is created with the lockfile deps installed; **network egress to the manifest's declared destinations is allowed** (in contrast to the adversarial sandbox's hard socket block); `ANTHROPIC_API_KEY` and the skill's declared `requires` secrets are injected as env via `SecretsProvider` (reusing the `_resolve_credentials` seam); and wall-clock + memory + output limits are enforced (FR-EXE-05)

**Given** the skill calls its entrypoint `module:callable` with `{input_path, output_dir, params}`
**When** it returns
**Then** the platform captures the result envelope `{status, schema_version, canonical, artifacts[], qa}` (handed to Story 5.5.5 for persistence)

**Given** a buggy or runaway skill (the trusted path is for stability, not against hostile code — trust is established by Epic 6 certification)
**When** it runs
**Then** its venv isolation + resource/timeout limits prevent it from affecting other skills or platform stability; a timeout or crash yields `failed`, never a silent hang

---

## Story 5.5.4: Raw-File Input to Code-Driven Hybrids

As a code-driven hybrid skill,
I want the original uploaded file available by path (not only pre-parsed text),
So that I can do my own ingestion — including page rasterization for a vision pass.

**Acceptance Criteria:**

**Given** an invocation with `file_ref_ids`
**When** a code-driven hybrid executes
**Then** the original uploaded file is materialized to a path inside the skill's venv working dir and passed as `input_path` — augmenting the current text-only `build_context_input` seam, so the skill can read the raw bytes (e.g. for page rasterization) (FR-ING-01)

**Given** the raw-file path is provided
**When** the skill reads it
**Then** the S3-key-reference pattern and PHI discipline are preserved — the file is pulled from `StorageProvider` by key, written only to the ephemeral venv workspace, cleaned up after the run, and never logged

**Given** a prompt or LLM-driven-hybrid skill
**When** it executes
**Then** its existing text-only context seam (`build_context_input` → `[Document N]` blocks) is unchanged — raw-file materialization applies only to the code-driven path

---

## Story 5.5.5: Multi-Artifact + Canonical-JSON Output + `blocked` Job State

As a consultant,
I want a single run to persist multiple artifacts (canonical JSON + Excel), expose the typed canonical output, and surface a `blocked` job state when a QA egregious flag fires,
So that the full structured result is captured and downstream skills refuse to consume an unsafe output.

**Acceptance Criteria:**

**Given** a code-driven hybrid returns N artifacts + a `canonical_json` typed output
**When** the job completes
**Then** all artifacts persist to `StorageProvider`, and `InvocationResult` carries the full artifact set — note this requires evolving `InvocationResult` from today's single `output_file_key` to a **multi-artifact** persistence shape (migration), with each artifact's key, format, and content-type recorded; the canonical JSON `{schema_ref, schema_version, data}` is independently retrievable (FR-OUT-01, FR-OUT-05)

**Given** the skill's envelope reports `status: blocked` (egregious QA flag)
**When** the job finishes
**Then** the job reaches a new terminal status `blocked` — added to the job-status enum alongside `completed`/`failed`/`cancelled` and to `JOB_TERMINAL_STATUSES`, **distinct from `failed`** — and the Run Console surfaces it as human-resolution-required (FR-EXE-09)

**Given** a `blocked` upstream output
**When** a downstream skill attempts to consume it (via the schema-versioned consumes-declaration from Story 5.5.2)
**Then** consumption is refused before the downstream skill executes (FR-EXE-09)

**Given** the multi-artifact result
**When** displayed in the Run Console
**Then** all artifacts are individually downloadable via presigned URLs

---

## Story 5.5.6: Adapt & Run the Client Protocol-Extractor End-to-End (HEADLINE GATE)

As Vitalief,
I want the client `velara-protocol-extractor` adapted to the finalized platform contract and running end-to-end,
So that the first real foundation skill works on the platform — proving the widened hybrid runtime + output contract.

**Acceptance Criteria:**

**Given** the client skill adapted per the strip/keep boundary (keep `model.py` + extraction core; strip its `_client()` creds bootstrap, `plugin.py`/`cli.py` filesystem I/O, and `bridges/qa/gold/runs/corpus`)
**When** it is registered as a code-driven hybrid and certified
**Then** it appears in the registry with its declared `schema_version` and is invocable

**Given** a real protocol PDF uploaded through the Run Console
**When** the skill is invoked
**Then** it runs end-to-end — its own vision/locator + extraction + consensus + enrichment passes execute with platform-injected credentials and egress — and produces the canonical JSON (validating against its `output_schema`) + the Excel workbook + the QA envelope

**Given** the completed run
**When** I view it in the Run Console
**Then** all artifacts are downloadable, and an egregious QA flag (if any) is surfaced as `blocked`

> **Epic 5.5 does not close until Story 5.5.6 passes** — the client skill running E2E on the platform is the headline acceptance gate.

---

## Story Sequencing & Dependencies

The stories have a real build-order chain — the PO should sequence them, not parallelize blindly:

| Story | Depends on | Why |
|-------|-----------|-----|
| **5.5.1** Register bundle + manifest | Epic 2 registry (done) | Foundation — nothing executes until a code-driven hybrid can be registered |
| **5.5.2** Schema-versioned output contract | 5.5.1 | The consumes/produces metadata attaches to the registered skill |
| **5.5.3** Code-driven executor (venv) | 5.5.1; Epic 3 execution loop (done) | Needs a registered bundle to run; extends the `hybrid` branch |
| **5.5.4** Raw-file input | 5.5.3 | Feeds the executor the original file by path |
| **5.5.5** Multi-artifact + canonical output + `blocked` | 5.5.3 (envelope), 5.5.2 (consumes-check) | Persists what the executor returns; `blocked`-consumption rule needs 5.5.2's declaration |
| **5.5.6** Adapt + run client skill E2E (**HEADLINE GATE**) | **5.5.1–5.5.5 all** | The integration proof — exercises every prior story end-to-end |

**Recommended order:** 5.5.1 → 5.5.2 → 5.5.3 → 5.5.4 → 5.5.5 → 5.5.6. Stories 5.5.2 and 5.5.4 can overlap with 5.5.3 once 5.5.1 lands, but **5.5.6 starts only after 5.5.1–5.5.5 are done**. Per `create-story` discipline, each story is expanded to full implementation detail (dev notes, tasks, file touchpoints) one at a time when picked up — these epic-level ACs are the contract, not the implementation plan.

## Deferred to Epic 7 (forward dependency — not part of Epic 5.5's close)

- **7-x (isolation hardening):** replace the Phase-1 per-skill venv with **true container/kernel isolation** (gVisor / dedicated ECS task) and enforce the egress policy at the network layer. Must land before code-driven hybrids run against PHI in a client-facing context. No change to the Epic 5.5 invocation/output contract.

## Open Questions (carry to the client / architect)

- **Bundle dependency install at runtime vs. pre-baked:** does the Phase-1 venv `pip install` from the lockfile **per run** (simpler, slower, needs egress to PyPI) or is the venv **built once at registration/certification** and reused (faster, but a registration-time build step)? Architect call — affects 5.5.1 and 5.5.3.
- **Egress allow-list granularity:** is the declared-egress enforcement Phase-1 advisory (venv has open egress; manifest documents intent) or actually enforced (needs the network-layer policy that's deferred to Epic 7)? If advisory in Phase 1, 5.5.3's egress AC is "permitted + documented", and true enforcement lands with the Epic 7 isolation story.
- **`schema_version` bump policy** (from the client BRD §10): confirm with the client when a `schema_version` increments and how downstream consumes-declarations pin/range against it.
