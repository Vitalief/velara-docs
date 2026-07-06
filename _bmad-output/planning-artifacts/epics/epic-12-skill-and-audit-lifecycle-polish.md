# Epic 12: Skill & Audit Lifecycle Polish

> **Created 2026-07-06** via correct-course (see `planning-artifacts/sprint-change-proposal-2026-07-06.md`). A batch of independent, high-value fixes to skill authoring and the audit surface, **decoupled from Epic 11** so they ship on their own cadence. Every item is grounded in a source audit of both repos (`velara-api`, `velara-web`) — the reality (exists vs. net-new) is noted per story so scope is honest. None depend on Epic 11's architecture; this epic can run in parallel with or ahead of it. Suggested order: 12.1 (trivial) → 12.2 → 12.3 → 12.4.

A batch of independent fixes: a location-dependent authoring control, human-readable audit context names, distinct audit event icons, and a duplicate-run cost warning.

**FRs covered:** REG-10, USE-07, USE-08 (P2), INV-10 (P2) (new — `sprint-change-proposal-2026-07-06.md`).
**Sequencing:** Independent of Epic 11 — can start immediately. Suggested order 12.1 → 12.2 → 12.3 → 12.4.

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
