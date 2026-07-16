---
baseline_commit: d0b858c
---

# Story 13.6: Close the Remaining Unaudited-Mutation Surface

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a compliance reviewer,
I want every remaining state-changing and trail-reading operation audited,
so that the "every admin mutation is audited" invariant is true in fact, not just for the surfaces someone remembered.

**This story pays down the debt 12.5 explicitly deferred.** Story 12.5's route-walk guard (`test_audit_coverage_guard.py`) surfaced ~42 mutating routes and registered **16 of them as tracked `exempt="not yet audited — known gap"`**: the 12 hierarchy-CRUD routes and the 4 skill-attachment routes ([test_audit_coverage_guard.py:140-208](../../../velara-api/tests/unit/test_audit_coverage_guard.py#L140)). 12.5's own Dev Notes called this "an honest deferral" *provided* it was tracked in `deferred-work.md` — which it was. **This story is where those exemptions get paid down.** Plus two the epic adds: the **audit-log read** itself (an admin can enumerate the entire compliance trail unaccountably) and the **sandbox network-block event** (a skill probing the network boundary is currently indistinguishable from a clean run).

## Acceptance Criteria

1. **AC1 — Hierarchy create/update/delete is audited (deletes especially).**
   **Given** any hierarchy create/update/**delete** (client/project/study/location — 12 routes)
   **When** it commits
   **Then** it writes an audit event — deletes especially, capturing what was destroyed. **⚠️ Scope-accuracy note (code-verified):** the epic says "deleting a client **cascades away the grants** that hang off it… with zero record." **That is imprecise and you must not encode it wrongly.** `delete_client`/`delete_project`/`delete_study`/`delete_location` ([hierarchy_service.py:307,406,510,639](../../../velara-api/app/services/hierarchy_service.py#L307)) **guard against children** — a delete with existing child rows raises `HierarchyHasChildrenError` (409) and does NOT proceed. And `access_grants` uses a **polymorphic `node_id` String with NO foreign key** ([access_grant.py:39](../../../velara-api/app/models/access_grant.py#L39)) — so a delete does *not* DB-cascade grants at all; grants keyed to a deleted node simply become orphaned rows. **Audit the delete accurately** (what node was deleted, its type, its id/path) — do not fabricate a "grants cascaded" claim the code doesn't make. (Whether orphaned grants are a separate cleanup concern is out of scope; note it, don't fix it here.)

2. **AC2 — Skill attach/detach is audited (4 routes).**
   **Given** a skill attachment or detachment
   **When** it commits
   **Then** it writes an audit event (`admin.skill_attached` / `admin.skill_detached`) capturing skill_id, node_id, node_type.

3. **AC3 — Reading the audit log is itself recorded.**
   **Given** a read of the audit log itself (`GET /api/v1/audit`)
   **When** it is served
   **Then** it is recorded (`audit.log_accessed`) — **resolving the self-referential growth question deliberately** (an admin listing the trail writes a row to the trail, which the next listing sees…). Decide: a separate table, OR accept it into `audit_log_entries` **with de-dupe** (reuse 13.3/13.4's window) so a polling audit UI doesn't write a row per poll, and document why. See Dev Notes "THE SELF-REFERENCE TRAP."

4. **AC4 — A sandboxed skill's blocked network call is auditable + alarmed, not silently swallowed.**
   **Given** a sandboxed skill attempting a blocked network call
   **When** the sandbox blocks it
   **Then** it is surfaced as an auditable security event and alarmed — not silently swallowed. **Scope fence:** `code_sandbox.py`'s own docstring is candid that the Python-monkeypatch sandbox is escapable via `ctypes→libc` and that Epic 7 was to replace it with a syscall-level sandbox — **Epic 7 shipped and did not.** The sandbox-**hardening** question is OUT of scope for this story; **detecting and recording probes is IN scope.** Raise the hardening gap separately (a `deferred-work.md` note), do not attempt to fix the sandbox here.

5. **AC5 — 12.5's guard registry ends this story with no temporary exemptions.**
   **Given** Story 12.5's guard-test registry
   **When** this story completes
   **Then** every entry 12.5 registered as `exempt="not yet audited — known gap"` is **either audited or has a permanent, justified exemption** — the registry is the checklist and it ends this story with **no temporary exemptions left**. Flip the 16 `known gap` entries to `{"audited": "EVENT_ADMIN_..."}`.

6. **AC6 — New event types are categorized (13.1's guard enforces it).**
   **Given** the new hierarchy create/update/delete, skill attach/detach, `audit.log_accessed`, and sandbox network-blocked event types
   **When** they are added
   **Then** the hierarchy + attachment events are assigned **Organization**, `audit.log_accessed` is assigned **Compliance & Disclosure**, and the sandbox event is assigned **Security** in [audit_categories.py](../../../velara-api/app/models/audit_categories.py) — and Story 13.1's guard test passes. **`CATEGORY_ORGANIZATION` is the LAST of 13.1's three empty-reserved categories to be populated** — after this story, all 7 categories have members.

## Tasks / Subtasks

- [x] **Task 1 — Add the event-type constants + categorize them (all ACs, AC6)**
  - [x] In [app/models/audit.py](../../../velara-api/app/models/audit.py), add (own commented blocks, stable strings, never rename):
    - Hierarchy (Organization): `EVENT_ADMIN_HIERARCHY_CREATED = "admin.hierarchy_created"`, `EVENT_ADMIN_HIERARCHY_UPDATED = "admin.hierarchy_updated"`, `EVENT_ADMIN_HIERARCHY_DELETED = "admin.hierarchy_deleted"`. **One triplet across all four node types** (client/project/study/location) with `node_type` in metadata — NOT 12 separate constants. (12 constants would bloat the taxonomy; the node_type discriminator lives in metadata, matching how `invocation.<outcome>` uses one family with a discriminator.)
    - Attachments (Organization): `EVENT_ADMIN_SKILL_ATTACHED = "admin.skill_attached"`, `EVENT_ADMIN_SKILL_DETACHED = "admin.skill_detached"`.
    - Audit read (Compliance & Disclosure): `EVENT_AUDIT_LOG_ACCESSED = "audit.log_accessed"` — the first `audit.*`-prefix event (a new family).
    - Sandbox (Security): `EVENT_SECURITY_SANDBOX_NETWORK_BLOCKED = "security.sandbox_network_blocked"` — a new `security.*` family. (`CATEGORY_SECURITY` got its first member from 13.4's `access.denied`; this adds a second.)
  - [x] In [audit_categories.py](../../../velara-api/app/models/audit_categories.py): hierarchy ×3 + attach/detach ×2 → `CATEGORY_ORGANIZATION` (the last empty category); `audit.log_accessed` → `CATEGORY_COMPLIANCE_DISCLOSURE`; `security.sandbox_network_blocked` → `CATEGORY_SECURITY`. **None** go in `OUTCOME_BEARING_CATEGORIES`.
  - [x] ⚠️ 13.1's guard auto-fails until each is categorized — same-commit. Fifth story to hit this; routine.

- [x] **Task 2 — Audit hierarchy CRUD (AC1) — thread `acting_user_id` through the service**
  - [x] ⚠️ **The service functions do NOT currently receive the acting user.** `create_client`/`update_client`/`delete_client` (and project/study/location equivalents) take `(session, ..., org_id)` — **no `acting_user_id`** ([hierarchy_service.py:235,288,307](../../../velara-api/app/services/hierarchy_service.py#L235)). The routes have `user: CurrentUser` in scope ([hierarchy.py](../../../velara-api/app/api/v1/hierarchy.py) — e.g. `delete_client` at line 151 passes only `client_id, org_id`). **Thread a new `acting_user_id: str` param through each of the 12 service functions and pass `user.user_id` from each route** — mirrors exactly how 12.5 threaded `acting_user_id` into `confirm_file_ref`. This is the bulk of the mechanical work.
  - [x] Write the audit **after** each function's existing `await session.commit()` + `logger.info(...)`, best-effort (`try/except` + `logger.warning`), `hierarchy_path="org"`, `org_id=org_id`, `user_id=acting_user_id`. **One shared helper** (e.g. `_audit_hierarchy_mutation(session, event_type, actor, org_id, node_type, node_id, **extra)`) called from all 12 sites — do not duplicate the block twelve times.
  - [x] Metadata: `{"node_type": "client"|"project"|"study"|"location", "node_id": str(id), "action": "created"|"updated"|"deleted"}`. For **update**, capture the changed fields (name/description old→new — small, non-PHI, safe) mirroring 12.5's `update_skill_metadata` old→new pattern. For **delete**, capture the node's `hierarchy_path` and name so the record says *what* was destroyed. **Names/descriptions of a client/project are org-internal, not PHI** — safe to log (they're already in `logger.info`); do not log document content or any skill IP.
  - [x] **Event-type choice:** use the single `admin.hierarchy_created/updated/deleted` triplet with `node_type` in metadata (Task 1) — the create route for a client vs a study writes the same `admin.hierarchy_created` with a different `node_type`. Cleaner than 12 constants and the FE audit UI groups them under one Organization category anyway.

- [x] **Task 3 — Audit skill attach/detach (AC2)**
  - [x] `attach_skill` ([skill_attachment_service.py:75](../../../velara-api/app/services/skill_attachment_service.py#L75)) **already receives `attached_by_user_id`** — the actor is in scope. Write `admin.skill_attached` after its `commit()` + `logger.info("skill_attached")` ([:142-151](../../../velara-api/app/services/skill_attachment_service.py#L142)), best-effort. Metadata: `{"skill_id", "node_id", "node_type"}`.
  - [x] ⚠️ **Idempotency trap:** `attach_skill` is idempotent — if the attachment already exists it returns the prior row at [:123-131](../../../velara-api/app/services/skill_attachment_service.py#L123) **without committing anything**. **Do NOT audit that early-return path** — no mutation occurred (mirrors 12.5's rule of auditing only real mutations, not idempotent no-ops). Audit only the real-insert path after the commit.
  - [x] `unattach_skill` ([skill_attachment_service.py:155](../../../velara-api/app/services/skill_attachment_service.py#L155)) — ⚠️ **does NOT receive an acting user** (takes only `skill_id/node_id/node_type/org_id`). Thread `acting_user_id` through it and pass `user.user_id` from the route (same as Task 2's hierarchy threading). Write `admin.skill_detached` after its `delete` + `commit()` + `logger.info("skill_detached")` ([:178-186](../../../velara-api/app/services/skill_attachment_service.py#L178)).

- [x] **Task 4 — Audit the audit-log read (AC3) — READ THE SELF-REFERENCE TRAP**
  - [x] `GET /api/v1/audit` ([audit.py:76](../../../velara-api/app/api/v1/audit.py#L76) `list_audit_entries`) is the read to record as `audit.log_accessed`. The route already has `user: CurrentUser` + `session: DbSession`.
  - [x] ⚠️ **The self-reference + polling trap (see Dev Notes):** every audit-log view writes an `audit.log_accessed` row *into the audit log*, which the next view sees — and the audit UI **polls/paginates**, so naive per-request writes flood the trail with self-referential noise. **Mandatory mitigation:** de-dupe hard (reuse 13.3/13.4's `_*_DEDUPE_WINDOW` pattern — one `audit.log_accessed` per `user_id` per window, e.g. 15 min), OR write to a separate table. **Recommend de-dupe into `audit_log_entries`** (keeps one queryable trail, consistent with 13.4's denial decision) with a comment explaining the growth reasoning. Best-effort, after the read succeeds, `hierarchy_path="org"`.
  - [x] Metadata: `{"filters": <which filters were applied>}` is optional and **must be reference-only** — record *that* the log was accessed and by whom, optionally the filter shape (category/date-range), **never** the returned rows.

- [x] **Task 5 — Audit + alarm the sandbox network block (AC4) — emit in the PARENT, not the sandbox**
  - [x] ⚠️ **The `NET_BLOCKED` token is emitted INSIDE the sandboxed subprocess on a trusted control channel** ([code_sandbox.py:158](../../../velara-api/app/services/code_sandbox.py#L158) `_control("NET_BLOCKED")`) — you **cannot** and must not write an audit row from inside the sandbox (it's untrusted, has no DB session, and the whole point is isolation). The **parent** reads `result.network_blocked: bool` in `execution_service.py` ([:640-650](../../../velara-api/app/services/execution_service.py#L640)) — **that is where the audit + alarm belong.**
  - [x] ⚠️ **CORRECTED during implementation:** the story's "sync Celery context" premise for this call site was wrong. `_run_code_sandbox` does not exist; the real function is `_run_code` in `execution_service.py`, which is `async def` and already holds an open `AsyncSession` — it runs inside `run_skill`'s `asyncio.run(_execute())` wrapper (`execution_tasks.py`), not a bare sync function. Confirmed via code-chain trace before writing the audit call. Used the **async** `audit_service.record_admin_action` (not `_sync`) — correct for this call site's actual context.
  - [x] Emit `security.sandbox_network_blocked` when `result.network_blocked` is True (it currently only appears in a `logger.warning`). Metadata: `{"skill_id", "job_id"}` — reference only. Best-effort.
  - [x] **Alarm (AC4 "and alarmed"):** extended 13.4's existing `security_events` CloudWatch metric filter/alarm with a SECOND `aws_cloudwatch_log_metric_filter` resource (`sandbox_network_blocked`) reading the **worker** log group (not `api` — `code_execution_failed` is emitted by the Celery worker, a different log group than 13.4's `auth_event_recorded`/`access_denial_recorded` API-side lines), feeding the same `SecurityEventCount` metric/namespace so both sources trip the one existing alarm. `terraform fmt -check` + `terraform validate` both pass; plan-only per standing rule (operator applies).
  - [x] **Do NOT touch the sandbox hardening** (the ctypes→libc escape). AC4 fences it out. Added a `deferred-work.md` note that the Python-monkeypatch sandbox remains escapable and Epic 7's syscall-sandbox replacement never shipped — surfaced, not fixed.

- [x] **Task 6 — Flip all 16 guard-registry exemptions to audited (AC5)**
  - [x] In [test_audit_coverage_guard.py](../../../velara-api/tests/unit/test_audit_coverage_guard.py), changed each of the 12 hierarchy-CRUD entries and 4 attachment entries from `{"exempt": "not yet audited — known gap..."}` to `{"audited": "EVENT_ADMIN_HIERARCHY_CREATED"}` (etc. — the create/update/delete + attach/detach constant matching each route+method).
  - [x] ⚠️ **`GET /api/v1/audit` is NOT in this registry** — confirmed; it's a GET, the guard only walks mutating routes. No registry entry added/needed for it or the sandbox event.
  - [x] After the flip, `test_registry_integrity` re-checks that each audited constant `startswith("admin.")` — confirmed passing (all hierarchy/attachment constants are `admin.*`).
  - [x] Updated `deferred-work.md`: added a "Resolved by: 13-6" section closing the 12.5 hierarchy/attachment gap, and a new dated deferral for sandbox-hardening (Task 5).

- [x] **Task 7 — Tests**
  - [x] **Per-route audit tests:** added to `test_hierarchy.py` (create/update/delete for client + project/study/location triplet, deleted-identity assertion, SCOPE-ACCURACY negative assertion for `grants_cascaded`) and `test_skill_attachments.py` (attach/detach for both project and study routes) — all drive the real API route and assert the row lands with correct `user_id`/`org_id`/metadata.
  - [x] **Idempotent-attach negative test:** `test_idempotent_reattach_writes_exactly_one_audit_row` — attaches twice, asserts exactly one `admin.skill_attached` row.
  - [x] **AC3:** new `test_audit_log_read_auditing.py` — one-read-one-event test, reference-only-metadata test, and a 4-reads-in-window dedupe test (uses a fresh per-test principal to avoid cross-test window collisions in the shared, append-only `velara_test` DB).
  - [x] **AC4:** 3 new unit tests in `test_execution_service.py` (`TestRunCode`): network-blocked writes the audit event with correct actor/metadata; a forced audit-write failure doesn't swallow the real `CodeExecutionError`; a non-network failure writes NO sandbox security event.
  - [x] **Best-effort proof:** `test_hierarchy_mutation_audit_survives_write_failure` (hierarchy delete) and `test_audit_log_read_survives_audit_write_failure` (audit read) both monkeypatch the audit write to raise and assert the primary operation still succeeds.
  - [x] **Guard tests green:** `test_audit_coverage_guard.py` and `test_audit_category_guard.py` both pass (8/8).

- [x] **Task 8 — Gates**
  - [x] **Backend:** `ruff check .` clean. Full suite: 1440 passed, 3 skipped (pre-existing env-gated skips), 1 pre-existing test deselected (see Completion Notes). Rebuilt api/worker images after every edit batch.
  - [x] **`docs/api-spec.json`:** confirmed **ZERO diff** — regenerated via `docker cp` (not `exec`, per the container-path trap) and `diff`'d clean against the tracked file.
  - [x] **No migration.** Confirmed `alembic current` still reports `0022_skill_version_bundle (head)`; no new file under `app/db/migrations/versions/`.
  - [x] **Terraform:** `terraform fmt -check` and `terraform validate` both pass on the AC4 metric-filter addition. Plan-only, per standing rule — not applied.

## Dev Notes

### ⛔ THE SELF-REFERENCE TRAP (AC3) — auditing the audit-log read

`audit.log_accessed` records a read of the audit log *into the audit log*. Two compounding hazards:
1. **Self-reference:** the next person viewing the trail sees the previous viewer's `audit.log_accessed` row. This is *fine and correct* (reviewing the trail IS an auditable act) — but it means the event must be reference-only (who + when + optionally filter shape, never the returned rows), or you leak the trail's contents into the trail.
2. **Polling amplification:** the audit UI paginates and (like the jobs UI) may poll. Naive per-request writes flood the trail with `audit.log_accessed` rows — the same hazard 13.3 (disclosure) and 13.4 (denials) both hit and both solved with a **de-dupe window**. Reuse that exact mechanism: one `audit.log_accessed` per `(user_id)` per 15-min window. The CloudWatch/log side (if any) still sees every read; the DB records one per window.

**This is the third time the de-dupe pattern applies** (13.3 disclosures, 13.4 denials, now audit-reads). It's a well-worn tool now — reuse `audit_service`'s existing `_*_DEDUPE_WINDOW` helper, don't reinvent.

### ⛔ TRAP — The sandbox event is emitted by the PARENT (sync worker), not the sandbox

`code_sandbox.py`'s `_control("NET_BLOCKED")` runs **inside the untrusted sandboxed subprocess** on a trusted control channel — it is a *signal*, not an audit site. Auditing from there is impossible (no DB, no session, and it would defeat isolation). The signal bubbles up as `result.network_blocked: bool`, consumed by `execution_service.py:640-650` **in the Celery worker's sync context**. That is the audit site, and because it's sync you use `record_admin_action_sync` (the wrapper that opens its own `session_scope` and `asyncio.run`s), not the async `record_admin_action`. Confirm the exact sync/async context of the specific function you edit — `execution_service` has both sync-worker and (possibly) async paths; match the one you're in. Getting the sync/async wrong is the single most likely runtime bug in this task.

### ⛔ SCOPE-ACCURACY — the epic overstates the delete-cascade; audit what actually happens

The epic says deleting a client "cascades away the grants that hang off it… with zero record." **Code says otherwise, and you must audit the truth, not the epic's paraphrase:**
- `delete_client`/`delete_project`/`delete_study`/`delete_location` **block** on existing children (`HierarchyHasChildrenError` 409) — a client with projects cannot be deleted at all ([hierarchy_service.py:313-318](../../../velara-api/app/services/hierarchy_service.py#L313)). So there is no silent cascade through the hierarchy; you must delete bottom-up.
- `access_grants.node_id` is a **polymorphic String with NO FK** ([access_grant.py:39](../../../velara-api/app/models/access_grant.py#L39)) — deleting a leaf node does **not** DB-cascade its grants; they become **orphaned rows** pointing at a now-gone node_id.

So the accurate audit for a delete is: *"node X (type, id, path) was deleted by user Y."* Do **not** write `{"grants_cascaded": N}` — the code doesn't cascade them. The orphaned-grant cleanup is a real but **separate** concern; note it in `deferred-work.md`, don't solve it here. **Auditing a false claim is worse than not auditing** — an auditor who finds the audit row says "grants cascaded" and the grants table says otherwise will trust neither.

### The mechanical core: thread `acting_user_id`, one shared helper per family

This story is mostly mechanical, and 12.5 already set the exact pattern:
- **Thread `acting_user_id`** through the 12 hierarchy service functions + `unattach_skill` (13 signature changes) — 12.5 did this for `confirm_file_ref`. The routes all have `user: CurrentUser`; pass `user.user_id`.
- **One shared audit helper per family** (`_audit_hierarchy_mutation`, and the attach/detach writes) — 12.5 used `_audit_skill_created` shared across two exits. Don't inline the best-effort block 16 times.
- **Best-effort, after commit, `hierarchy_path="org"`, `org_id` fence** — the invariant convention from every prior audit story. Do NOT touch `list_entries`' org fence (12.5 Trap 2).

### After this story, all 7 categories are populated

13.1 created Organization / Authentication / Security empty. 13.4 populated Authentication (+ Security's first member). **This story populates Organization (hierarchy + attachments) — the last empty one — and adds Security's second member (sandbox).** After 13.6, every one of the 7 categories has real members, and the audit-log category filter is fully meaningful. (13.1's FE dimmed the empty-category pills; if that dimming is data-driven it auto-un-dims — check, but likely no FE work.)

### `docs/api-spec.json` must be zero-diff (like 12.5)

No new route, no schema, no request field. `acting_user_id` is a **service-layer kwarg**, not a request-body field — the API contract is unchanged. 12.5 made exactly this point and shipped a zero-diff spec. If your diff is non-empty, you changed a contract you didn't intend to. Regenerate via `docker cp` (the container-path trap) and confirm empty.

### Testing standards

- **BE:** pytest; integration tests drive **real API routes**. The 16 mutation-audit tests go through the real hierarchy/attachment endpoints. The sandbox test drives `execution_service` via the existing code-execution test fixtures.
- **Known local artifact:** `AUTH_BACKEND=dev` for integration; rebuild image after edits.
- **Guard tests are the gates:** `test_audit_coverage_guard.py` (16 flips + integrity) and `test_audit_category_guard.py` (new constants). Both will move the moment you touch code — that's them working.

### Project Structure Notes

- `velara-api/app/models/audit.py` — MODIFIED (+7 constants: 3 hierarchy, 2 attach/detach, 1 audit-read, 1 sandbox)
- `velara-api/app/models/audit_categories.py` — MODIFIED (Organization ×5, Compliance&Disclosure ×1, Security ×1)
- `velara-api/app/services/hierarchy_service.py` — MODIFIED (12 functions: +`acting_user_id`, shared audit helper)
- `velara-api/app/api/v1/hierarchy.py` — MODIFIED (pass `user.user_id` to the 12 hierarchy calls + the 4 attach/detach calls — the attach routes live here too)
- `velara-api/app/services/skill_attachment_service.py` — MODIFIED (attach audit; `unattach_skill` +`acting_user_id` + detach audit)
- `velara-api/app/api/v1/audit.py` — MODIFIED (`audit.log_accessed` write in `list_audit_entries`, de-duped)
- `velara-api/app/services/execution_service.py` — MODIFIED (`security.sandbox_network_blocked` write in the sync worker path)
- `velara-api/app/services/audit_service.py` — possibly MODIFIED (reuse/extend the de-dupe window helper for audit-reads)
- `velara-api/terraform/cloudwatch.tf` — possibly MODIFIED (extend 13.4's security metric filter for the sandbox event — plan only) OR deferred
- `velara-api/tests/unit/test_audit_coverage_guard.py` — MODIFIED (16 exempt→audited flips)
- `velara-api/tests/integration/` + `tests/unit/` — NEW/MODIFIED (per-route + idempotent-attach + audit-read-dedupe + sandbox + best-effort tests)
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFIED (close the 12.5 hierarchy/attachment gap; open the sandbox-hardening gap)

**No migration. No new DB table/column. No `docs/api-spec.json` change. No FE (unless the empty-category dimming is hardcoded).**

### References

- [Source: epics/epic-13-compliance-audit-and-access-controls.md#Story-13.6] — ACs verbatim; the 12.5-exemption-paydown framing; the delete-cascade claim (⚠️ imprecise — see SCOPE-ACCURACY note); the sandbox hardening-vs-detection fence.
- [Source: velara-api/tests/unit/test_audit_coverage_guard.py:140-208] — the 16 `known gap` exemptions to flip (AC5); the GET-skipping route walk (why audit-read needs no registry entry); `test_registry_integrity`'s `startswith("admin.")` (hierarchy/attachment constants pass it).
- [Source: velara-api/app/services/hierarchy_service.py:235-660] — the 12 CRUD functions (no `acting_user_id` today — thread it); `delete_*`'s child-guard (blocks, doesn't cascade); `_commit_delete`.
- [Source: velara-api/app/models/access_grant.py:39] — polymorphic `node_id` String, NO FK → deletes don't DB-cascade grants (SCOPE-ACCURACY).
- [Source: velara-api/app/services/skill_attachment_service.py:75-186] — `attach_skill` (has `attached_by_user_id`; idempotent early-return trap at :123); `unattach_skill` (no acting user — thread it).
- [Source: velara-api/app/api/v1/hierarchy.py] — the routes for both hierarchy CRUD and skill attach/detach; all have `user: CurrentUser` to source the actor.
- [Source: velara-api/app/api/v1/audit.py:76] — `list_audit_entries`, the read to record as `audit.log_accessed` (AC3, de-duped).
- [Source: velara-api/app/services/code_sandbox.py:119-158] — the `NET_BLOCKED` control-channel signal (emitted in the untrusted child — NOT the audit site); the docstring's candid ctypes→libc escape admission (hardening = out of scope).
- [Source: velara-api/app/services/execution_service.py:640-650] — where `result.network_blocked` is consumed in the SYNC worker (the real audit site; use `record_admin_action_sync`).
- [Source: velara-api/app/services/audit_service.py:286-360] — `record_admin_action` + `record_admin_action_sync` (the sync wrapper for the worker path); the de-dupe-window helper from 13.3/13.4 to reuse for audit-reads.
- [Source: velara-api/app/models/audit_categories.py] — 13.1's taxonomy; Organization is the last empty category (AC6); keep new events out of `OUTCOME_BEARING_CATEGORIES`.
- [Source: implementation-artifacts/stories/12-5-audit-coverage-skill-authoring-ingest.md] — the exact `acting_user_id`-threading + shared-helper + best-effort + zero-api-spec-diff patterns this story repeats; Trap 2 (don't touch the org fence); the deferred-work.md discipline.
- [Source: implementation-artifacts/stories/13-4-auth-and-authz-event-auditing.md] — the de-dupe-window reuse (AC3); the CloudWatch `security_events` metric filter to extend for the sandbox alarm (AC4); the `record_admin_action_sync`/`session_scope` sessionless-context pattern.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

None — no persistent debug log needed; all failures were resolved inline (see Completion Notes).

### Completion Notes List

- **AC1-AC6 all implemented.** All 16 of Story 12.5's tracked `exempt="not yet audited — known gap"` registry entries are now `audited`. Organization is the last of Story 13.1's three empty-reserved categories to be populated; Security now has 2 members (13.4's `access.denied` + this story's `security.sandbox_network_blocked`); Compliance & Disclosure now has 4 members (+ `audit.log_accessed`).
- **Task 5 correction (documented in-task above):** the story's Dev Notes assumed the sandbox-network-block audit site runs in a "sync Celery context" requiring `record_admin_action_sync`. Traced the actual call chain before writing code: `_run_code_sandbox` does not exist in the codebase — the real function is `_run_code` in `execution_service.py`, which is `async def` with an already-open `AsyncSession`, invoked from `run_skill`'s `asyncio.run(_execute())` wrapper in `execution_tasks.py`. Used the async `record_admin_action` — correct for this call site. Flagging this since the story's own "getting this wrong is the single most likely bug" warning pointed at the wrong function name; verified against the real source before implementing, not against the story text.
- **Test-infra note (pre-existing, not introduced by this story):** `tests/integration/api/test_auth_and_authz_auditing.py::test_repeated_denials_are_deduped` fails when re-run against a DB that already has a matching `access.denied` row from a prior run within its 15-minute de-dupe window — `audit_log_entries` is append-only (no DELETE), so this exact-count assertion is inherently re-run-sensitive with a fixed seeded `user_id`. Confirmed via `git show` that this test is byte-identical to Story 13.4's original commit (`3ac939f`) — pre-existing, not a regression. Deselected it for the full-suite confirmation run; all other 1440 tests pass. My own new AC3 dedupe test avoids this trap by using a fresh, never-before-seen `user_id` per test run.
- **Pre-existing test-file collateral:** adding a required `acting_user_id` parameter to 12 `hierarchy_service` functions + `unattach_skill` broke 52 direct (non-HTTP) call sites across 5 existing integration test files (`test_artifact_disclosure.py`, `test_auth_and_authz_auditing.py`, `test_invocations.py`, `test_client_surface.py`, `test_skill_attachments.py`) that call these service functions directly rather than through the HTTP route. Fixed all 52 by adding `acting_user_id="seed_user"` — verified via a paren-depth-aware scan, not just line grep, since several calls span multiple lines.
- **Pre-existing unit-test collateral:** 3 tests in `test_audit_service.py::TestCategoryExpansion` asserted stale "N event types" / "empty category" expectations that this story's AC6 changes intentionally invalidate (Organization was empty, now has 5 members; Security had 1 member, now 2; Compliance & Disclosure had 2, now 4). Updated all 3 to the new correct expectations.
- **Terraform:** extended (not duplicated) Story 13.4's `security_events` alarm — added a second `aws_cloudwatch_log_metric_filter` resource reading the **worker** CloudWatch log group (distinct from 13.4's `api` log group, since `code_execution_failed` is emitted by the Celery worker, not the API request path) into the same `SecurityEventCount` metric/namespace, so one alarm now watches both sources. `fmt`/`validate` clean; plan-only per standing rule.
- **Scope-accuracy honored:** hierarchy-delete audit metadata records `{"node_type", "node_id", "action": "deleted", "name", "hierarchy_path"}` only — never a fabricated `grants_cascaded` claim. A dedicated test (`test_delete_client_writes_hierarchy_deleted_audit_with_identity`) asserts `"grants_cascaded" not in entry.event_metadata`.
- **No FE work required** — Story 13.1's empty-category dimming was already confirmed data-driven in an earlier story; no FE files touched.

### File List

**velara-api (subrepo — not committed by this workflow; committed separately by code-review per project convention):**
- `app/models/audit.py` — MODIFIED (+7 event-type constants: 3 hierarchy, 2 attach/detach, 1 audit-read, 1 sandbox)
- `app/models/audit_categories.py` — MODIFIED (Organization ×5, Compliance & Disclosure ×1, Security ×1)
- `app/services/hierarchy_service.py` — MODIFIED (12 CRUD functions +`acting_user_id`; new `_audit_hierarchy_mutation` shared helper)
- `app/api/v1/hierarchy.py` — MODIFIED (pass `user.user_id` to the 12 hierarchy calls + 2 `unattach_skill` calls)
- `app/services/skill_attachment_service.py` — MODIFIED (`attach_skill` audit write on real-insert path only; `unattach_skill` +`acting_user_id` + detach audit write)
- `app/api/v1/audit.py` — MODIFIED (`audit.log_accessed` best-effort write in `list_audit_entries`, reference-only filter shape)
- `app/services/audit_service.py` — MODIFIED (new `_AUDIT_READ_DEDUPE_WINDOW` + `record_audit_log_access`)
- `app/services/execution_service.py` — MODIFIED (`security.sandbox_network_blocked` write in `_run_code`'s failure branch when `network_blocked=True`)
- `terraform/cloudwatch.tf` — MODIFIED (new `aws_cloudwatch_log_metric_filter.sandbox_network_blocked` on the worker log group, feeding 13.4's existing `SecurityEventCount` metric/alarm; updated alarm description)
- `tests/unit/test_audit_coverage_guard.py` — MODIFIED (16 `exempt`→`audited` flips)
- `tests/unit/services/test_audit_service.py` — MODIFIED (3 stale category-expansion assertions updated to reflect AC6's new category population)
- `tests/unit/services/test_execution_service.py` — MODIFIED (+3 tests: AC4 network-blocked audit write, best-effort survival, non-network-failure no-op)
- `tests/integration/api/test_hierarchy.py` — MODIFIED (+5 tests: create/update/delete audit, project/study/location coverage, best-effort proof)
- `tests/integration/api/test_skill_attachments.py` — MODIFIED (+4 tests: attach/detach audit, idempotent-reattach negative test, study-route coverage)
- `tests/integration/api/test_audit_log_read_auditing.py` — NEW (AC3: write-on-read, reference-only, de-dupe, best-effort tests)
- `tests/integration/api/test_artifact_disclosure.py` — MODIFIED (3 call sites: `acting_user_id="seed_user"` added, pre-existing collateral)
- `tests/integration/api/test_auth_and_authz_auditing.py` — MODIFIED (1 call site: `acting_user_id="seed_user"` added, pre-existing collateral)
- `tests/integration/api/test_invocations.py` — MODIFIED (7 call sites: `acting_user_id="seed_user"` added, pre-existing collateral)
- `tests/integration/api/test_client_surface.py` — MODIFIED (38 call sites: `acting_user_id="seed_user"` added, pre-existing collateral)

**docs repo (this workflow commits these):**
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFIED (12.5 hierarchy/attachment gap marked resolved; new sandbox-hardening deferral)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED (status transitions)
- `_bmad-output/implementation-artifacts/stories/13-6-close-remaining-unaudited-mutations.md` — MODIFIED (this file)

**Confirmed zero-diff (not listed as changed):** `velara-api/docs/api-spec.json` (regenerated + diffed clean); no new file under `velara-api/app/db/migrations/versions/`.

## Change Log

- 2026-07-16 — Story 13.6 implemented: all 8 tasks complete, all 6 ACs met. 16 guard-registry exemptions flipped to audited. Full backend test suite green (1440 passed / 3 pre-existing skips / 1 pre-existing flaky test deselected — see Completion Notes). `docs/api-spec.json` zero-diff confirmed. No migration. Terraform `fmt`/`validate` clean, plan-only.
