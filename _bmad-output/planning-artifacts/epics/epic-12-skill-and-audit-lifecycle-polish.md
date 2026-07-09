# Epic 12: Skill & Audit Lifecycle Polish

> **Created 2026-07-06** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-06.md`). A batch of independent, high-value fixes to skill authoring and the audit surface, **decoupled from Epic 11** so they ship on their own cadence. Every item is grounded in a source audit of both repos (`velara-api`, `velara-web`) — the reality (exists vs. net-new) is noted per story so scope is honest. None depend on Epic 11's architecture; this epic can run in parallel with or ahead of it. Suggested order: 12.1 (trivial) → 12.2 → 12.3 → 12.4.
>
> **Reopened 2026-07-09** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-09.md`) to add **Story 12.5** — audit coverage for skill-authoring & ingest mutations. A **live compliance gap in deployed dev** (a created skill wrote no audit event) that is thematically at home here, in the audit-lifecycle epic, rather than in Epic 11 (AI integration). 12.5 has no dependency on 12.1–12.4 and can be picked up on its own.

A batch of independent fixes: a location-dependent authoring control, human-readable audit context names, distinct audit event icons, a duplicate-run cost warning, and audit coverage for the previously-unaudited skill-authoring & ingest mutations.

**FRs covered:** REG-10, USE-07, USE-08 (P2), INV-10 (P2) (new — `sprint-change-proposal-2026-07-06.md`); audit-coverage remediation (new — `sprint-change-proposal-2026-07-09.md`).
**Sequencing:** Independent of Epic 11 — can start immediately. Suggested order 12.1 → 12.2 → 12.3 → 12.4 → 12.5. **12.5 is a compliance-gap remediation** — prioritize it ahead of remaining Epic 11 *feature* work if audit completeness is a release gate (user to confirm at pickup).

---

## Story 12.1: Location-Dependent Authoring Control

As an MA Tech developer,
I want a "location-dependent" toggle in the skill create/edit form,
So that I can mark a skill site-specific without a direct API call.

> **Reality:** `location_dependent` is a **fully-wired backend field** (model `skill.py:65`; create/update/read schemas; service; route) and the Run Console *consumes* it. This is a **pure frontend form gap** — `SkillForm.tsx` renders no toggle and `SkillCreateInput`/`SkillUpdateInput` omit the field. **FE-only, near-trivial.**

**Acceptance Criteria:**

**Given** the skill create/edit form
**When** it renders
**Then** a `location_dependent` toggle is present; create and edit send it; the backend already accepts it (no backend change)

**Given** an existing location-dependent skill
**When** I open it in the edit form
**Then** the toggle reflects its current value, and clearing/setting it patches correctly

**Given** a location-dependent skill created via the toggle
**When** it is invoked in the Run Console
**Then** the existing location-prompt / fan-out behavior fires (proving the toggle wires end-to-end)

---

## Story 12.2: Audit Log Context Names (Backend-Enriched)

As a consultant reviewing the audit log,
I want Client/Project/Study/Location shown by name, not raw UUIDs,
So that the audit trail is human-readable.

> **Reality:** the write-path "always org" bug was **mostly fixed 2026-07-02** (context now resolved most-specific-first). The **remaining** gap: the audit surface renders the **raw ltree path of UUID segments** — no UUID→name resolution exists anywhere (audit list, detail panel, and fan-out children all render the raw path; the query API resolves `skill_name` but never joins hierarchy entity names). **Thin BE (resolution) + FE (render).**

**Acceptance Criteria:**

**Given** an audit entry with an ltree `hierarchy_path` of UUID segments
**When** the audit query API returns it
**Then** each segment is resolved to its entity name **server-side** and returned alongside the raw path — one place, consumed by the list, the detail panel, and fan-out children

**Given** a deleted or unknown entity in the path
**When** the name is resolved
**Then** a graceful fallback renders (e.g. "(deleted study)") — no crash, no blank

**Given** the Run Console live context panel
**When** it displays the run context
**Then** it shows names, not the raw ltree path (it currently `.replace(/\./g,' › ')` on UUID segments)

---

## Story 12.3: Distinct Audit Event Icons

As a consultant scanning the audit log,
I want a distinct icon per event type,
So that I can tell invocations, grants, certifications, lifecycle changes, and provisioning apart at a glance.

> **Reality:** a real event-type→icon map exists (`eventTypeIconMeta.ts`), but (a) the **default fallback is `play`** and two live event types (`admin.user_provisioned`, `admin.user_invite_resent`) fall through to it, and (b) the dominant `invocation.success` row **is** `play`. So the "all play" symptom is real, but the fix is *fill the gaps + verify render*, not "build a mapping." **FE-mostly.**

**Acceptance Criteria:**

**Given** the event-type icon map
**When** an `admin.user_provisioned` or `admin.user_invite_resent` event renders
**Then** it shows a distinct icon — the `play` default no longer masks it

**Given** the invocation outcomes (`success`, `failure`, `cancelled`, `blocked`, `fan_out`)
**When** they render
**Then** each shows a visually distinct icon (the map already differentiates these — verify they actually render, and decide whether `invocation.success` keeps `play` or gets its own glyph)

**Given** admin/certification/lifecycle events that were historically org-fenced (see the 9.2 org-fence note)
**When** they now appear in the log
**Then** their mapped icons (`shield`, `cert`, `layers`) render — cross-check that the write-path fence fix surfaces them

---

## Story 12.4: Duplicate-Run Cost Warning (Advisory)

As a consultant,
I want a warning when I'm about to run a skill with the same inputs in the same context as a recent completed run,
So that I don't spend AI budget on a duplicate.

> **Reality:** no dedup / idempotency / cache logic exists for invocations anywhere. The natural hook is `queue_invocation` before `create_job`; inputs are already hashable (`file_ref_ids` + `inputs`, built at `invocations.py:194-199`). The only existing guard is a double-submit guard on the in-flight mutation — not a repeat-of-completed check. **Thin BE + FE.**

**Acceptance Criteria:**

**Given** a run request
**When** an identical `(skill_id, version, resolved_context, inputs-hash)` **completed** job exists within a recent window
**Then** the platform surfaces an **advisory** warning (with a link to the prior result) **before** spending — the user may proceed (non-blocking) or reuse the prior output

**Given** no prior match
**When** the run is requested
**Then** no warning appears; normal flow proceeds

**Given** the hook point
**When** the check runs
**Then** it is evaluated in `queue_invocation` before `create_job` (or a pre-flight endpoint the Run Console calls), hashing the already-available inputs payload — advisory only, never blocking a deliberate re-run

---

## Story 12.5: Audit Coverage for Skill-Authoring & Ingest Mutations

> **Added 2026-07-09** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-09.md`). **Reopens Epic 12** (all 12.1–12.4 done). Discovered live in **deployed dev**: creating a skill produced **no audit event** — only its later *execution* was logged. Belongs here (the "Audit Lifecycle" epic), not Epic 11 — this is an observability/compliance concern, orthogonal to AI-assisted integration.

As a compliance reviewer (and any admin/ma_tech operator),
I want every skill-authoring and document-ingest mutation to write an audit event, the same way execution, grants, certification, lifecycle, and provisioning already do,
So that "who created/changed/derived this skill, and who uploaded this document, and when" is answerable from the audit log — not a blind spot.

> **Reality (source-audited 2026-07-09, `velara-api`):** the audit layer was built **execution-first** (Epic 9) and admin-mutation coverage was added **piecemeal, per-story**, only where a story called for it — grants (Epic 8), lifecycle + certification (Epic 9), provisioning (Epic 10), adapter-propose (11.3). **Skill authoring and ingest were never on any story's audit checklist** and fell through the seam between epics. Confirmed **unaudited** mutations, with severity:
> - `create_skill` ([skill_service.py:617](../../../velara-api/app/services/skill_service.py#L617)) — **HIGH**: a new skill (incl. client-facing) enters the system with zero audit trail.
> - `create_version` ([skill_service.py:951](../../../velara-api/app/services/skill_service.py#L951)) — **HIGH**: a new immutable version is a content change with no who/when.
> - `update_skill_metadata` ([skill_service.py:1174](../../../velara-api/app/services/skill_service.py#L1174)) — **MEDIUM**: `visibility`/`output_format` are editable; flipping `visibility` to `client_facing` is an access-surface change, unlogged.
> - `derive_skill` ([skill_service.py:1226](../../../velara-api/app/services/skill_service.py#L1226)) — **MEDIUM**: creates a paired client-facing skill — IP-boundary-relevant — unlogged.
> - document ingest ([ingest_service.py](../../../velara-api/app/services/ingest_service.py) / [api/v1/ingest.py](../../../velara-api/app/api/v1/ingest.py)) — **MEDIUM–HIGH**: client protocol documents (potential PHI) are uploaded with no audit record of the upload.
>
> **Already audited (working, for contrast — do not touch):** `invocation.success/.failure/.cancelled/.blocked/.fan_out`; `admin.grant_created/.grant_reaffirmed/.grant_revoked`; `admin.lifecycle_transition`; `admin.certification`; `admin.user_provisioned/.user_invite_resent`; `admin.skill_adapter_proposed`. **Thin BE, additive, no migration** — the `audit_log` table + `org_id` column (migration 0020) already carry everything; new event types reuse the existing `record_admin_action` seam. **No FE work** — the 9.3 audit viewer renders any event type generically, so new events surface automatically (icon coverage is the only FE follow-on, and it rides Story 12.3's existing `eventTypeIconMeta.ts` map).

**Acceptance Criteria:**

**Given** an admin/ma_tech operator creates a skill (`create_skill`) or a new version (`create_version`)
**When** the mutation commits
**Then** a new `admin.skill_created` / `admin.skill_version_created` audit event is written **best-effort** (mirrors the existing try/except + `logger.warning` pattern at [skill_service.py:923-946](../../../velara-api/app/services/skill_service.py#L923) — an audit-write failure must **never** roll back the successful mutation), carrying at minimum `skill_id`, `version`, `runtime_type`, `visibility`, and the acting `user_id`/`org_id`

**Given** a skill-metadata edit (`update_skill_metadata`) or a client-skill derivation (`derive_skill`)
**When** it commits
**Then** a corresponding new `admin.skill_updated` / `admin.skill_derived` event is written best-effort, capturing what changed (e.g. old→new `visibility`) for the edit, and the parent/derived skill IDs for the derivation

**Given** a document is ingested (client protocol upload)
**When** the upload/confirm completes
**Then** an `admin.document_ingested` event is written best-effort, recording the acting user, org, and a document reference — **never the document bytes or filename content beyond an ID/reference** (IP/PHI discipline: name the location, never the content, per the existing audit-write invariants)

**Given** the full set of admin/mutation service functions
**When** the test suite runs
**Then** a **guard/regression test fails CI if any admin-mutation entry point lacks an audit write** — so this class of gap cannot silently reopen (the anti-regression mechanism is the point of the story, not just backfilling today's five holes)

**Given** any of the new events
**When** it is written
**Then** it reuses the **existing** `audit_service.record_admin_action` seam with `hierarchy_path="org"` (skills are org-global, not hierarchy-scoped — mirrors every existing admin event); **no new migration, no new DB column, no new audit-write mechanism** is introduced
