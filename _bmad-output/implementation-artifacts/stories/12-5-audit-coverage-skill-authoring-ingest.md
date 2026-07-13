---
baseline_commit: cddc082e9e9d5386073665ad52416a96201c8ccf
---

# Story 12.5: Audit Coverage for Skill-Authoring & Ingest Mutations

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a compliance reviewer (and any admin/ma_tech operator),
I want every skill-authoring and document-ingest mutation to write an audit event, the same way execution, grants, certification, lifecycle, and provisioning already do,
so that "who created/changed/derived this skill, and who uploaded this document, and when" is answerable from the audit log — not a blind spot.

## Acceptance Criteria

1. **AC1 — Skill creation and version creation are audited.**
   **Given** an admin/ma_tech operator creates a skill (`create_skill`) or a new immutable version (`create_version`)
   **When** the mutation commits
   **Then** an `admin.skill_created` / `admin.skill_version_created` audit event is written **best-effort** (try/except + `logger.warning`, AFTER the mutation commits — an audit-write failure must **never** roll back the successful mutation), carrying at minimum `skill_id`, `version`, `runtime_type`, `visibility`, plus the acting `user_id`/`org_id`.

2. **AC2 — Metadata edit and derivation are audited.**
   **Given** a skill-metadata edit (`update_skill_metadata`) or a client-skill derivation (`derive_skill`)
   **When** it commits
   **Then** an `admin.skill_updated` / `admin.skill_derived` event is written best-effort — the edit capturing **what changed** (old→new value for each changed field, `visibility` above all, since `visibility → client_facing` is an access-surface change), and the derivation capturing the parent and derived skill IDs.

3. **AC3 — Document ingest is audited, with IP/PHI discipline.**
   **Given** a document is ingested (client protocol upload) through **either** the internal `/api/v1/ingest` router **or** the client-portal `/api/v1/client/ingest` router
   **When** the upload confirm completes
   **Then** an `admin.document_ingested` event is written best-effort, recording the acting user, org, and a document **reference** — `file_ref_id`, `content_type`, `size_bytes` — and **never** the document bytes, the parsed text, the content hash, or the original filename. *Name the location, never the content.*

4. **AC4 — A guard test fails CI if any admin-mutation entry point lacks an audit write.**
   **Given** the full set of state-changing admin/mutation entry points
   **When** the test suite runs
   **Then** a **guard/regression test fails** if any of them lacks an audit write — implemented as an explicit, reviewed **registry** of every mutation entry point, each marked `audited` or `exempt: "<reason>"`, cross-checked against the live route/service surface so that **adding a new mutation without a decision fails the build**. *This anti-regression mechanism is the point of the story, not just backfilling today's holes.*

5. **AC5 — Reuse the existing seam; no new mechanism.**
   **Given** any of the new events
   **When** it is written
   **Then** it goes through the **existing** `audit_service.record_admin_action` seam with `hierarchy_path="org"` (skills are org-global, not hierarchy-scoped — mirroring every existing admin event). **No new migration, no new DB column, no new audit-write mechanism.**

6. **AC6 — Every event type the backend can write has a distinct audit-log icon.**
   **Given** the FE audit-log event-type→icon map
   **When** any `admin.*` event type the backend writes is rendered
   **Then** it shows a mapped, non-default icon — the `play` fallback no longer masks any real event type — and a test asserts **every** backend event-type constant has a map entry (closing 12.3's coverage for good, not just for today's five).

## Tasks / Subtasks

- [x] **Task 1 — Add the five event-type constants (AC1, AC2, AC3, AC5)**
  - [x] In [velara-api/app/models/audit.py](../../../velara-api/app/models/audit.py), beside the existing `EVENT_ADMIN_*` block (which today ends at `EVENT_ADMIN_SKILL_EXPORTED` / `EVENT_ADMIN_SKILL_IMPORTED`), add: `EVENT_ADMIN_SKILL_CREATED = "admin.skill_created"`, `EVENT_ADMIN_SKILL_VERSION_CREATED = "admin.skill_version_created"`, `EVENT_ADMIN_SKILL_UPDATED = "admin.skill_updated"`, `EVENT_ADMIN_SKILL_DERIVED = "admin.skill_derived"`, `EVENT_ADMIN_DOCUMENT_INGESTED = "admin.document_ingested"`.
  - [x] Each gets a one-line comment naming the story, matching the house style of the constants already there. **Values are stable strings — never rename after deploy** (the file says so; the audit table is append-only, so a renamed event type orphans every historical row).
  - [x] Do **not** add them to `OUTCOME_TO_EVENT_TYPE` — that map is invocation-only.

- [x] **Task 2 — Audit `create_skill`, WITHOUT double-emitting for derive and import (AC1, AC2 — READ THE TRAP BELOW)**
  - [x] `create_skill` ([skill_service.py:645](../../../velara-api/app/services/skill_service.py#L645)) has **three** callers, only one of which is a plain "operator created a skill": the route ([skills.py:91](../../../velara-api/app/api/v1/skills.py#L91)); `derive_skill` ([skill_service.py:1516](../../../velara-api/app/services/skill_service.py#L1516)); and `skill_export.import_skill` ([skill_export.py:394](../../../velara-api/app/services/skill_export.py#L394), which **already** writes `admin.skill_imported`).
  - [x] **A naive audit write inside `create_skill` therefore emits a spurious `admin.skill_created` for every derive AND every import** — a derive would log create+derived, an import would log create+imported. Resolve it explicitly with an `emit_audit: bool = True` keyword-only parameter on `create_skill`, passed `False` by `derive_skill` and by `import_skill` (each of which writes its own, more specific event). Default `True` so the route path — and any future caller — is audited **by default**; a caller must opt *out* deliberately.
  - [x] Write the event AFTER the mutation's `await session.commit()` succeeds and after the existing `logger.info("skill_created", ...)`, in a `try/except` that logs `logger.warning("skill_created_audit_failed", skill_id=..., exc_info=True)` and swallows. Metadata: `{"skill_id", "version" (the `initial_version`), "runtime_type", "visibility", "name", "is_bundle"}`.
  - [x] ⚠️ **`create_skill`'s two artifact paths do NOT converge — there is no single success point.** The bundle branch delegates to `_create_skill_from_bundle` and then does a bare `return skill` at [skill_service.py:719](../../../velara-api/app/services/skill_service.py#L719), *before* the inline path's own commit + `logger.info("skill_created")` (~[:807-820](../../../velara-api/app/services/skill_service.py#L807)). And `_create_skill_from_bundle` is **itself** called directly by `skill_export.import_skill`'s bundle-shaped path ([skill_export.py:366](../../../velara-api/app/services/skill_export.py#L366)) — so putting the audit write *inside* `_create_skill_from_bundle` re-creates the exact double-emit bug in a new place (every bundle import would log `skill_created` + `skill_imported`).
  - [x] **The fix:** keep the audit write in `create_skill` and emit it at **both** of its exits — once just before the bundle branch's `return skill`, once on the inline path's success — each guarded by `if emit_audit:` and each in its own best-effort try/except. Factor the write into a small module-local helper (e.g. `async def _audit_skill_created(...)`) so the two exits share one body rather than duplicating it. Do **not** put it in `_create_skill_from_bundle`.
  - [x] *(Sanity check: `derive_skill` passes `initial_content` and never `bundle_zip`, so a derive always takes the inline exit — but wire `emit_audit=False` regardless; the guarantee should not depend on that.)*

- [x] **Task 3 — Audit `create_version`, `update_skill_metadata`, `derive_skill` (AC1, AC2)**
  - [x] `create_version` ([skill_service.py:985](../../../velara-api/app/services/skill_service.py#L985)) — after the commit + `session.refresh(new_version)` + the existing `logger.info("skill_version_created", ...)`. Metadata: `{"skill_id", "version": new_ver_str, "runtime_type": skill.runtime_type, "visibility": skill.visibility, "is_bundle"}`.
  - [x] `update_skill_metadata` ([skill_service.py:1414](../../../velara-api/app/services/skill_service.py#L1414)) — **capture old→new** (AC2). The function does `for key, value in fields.items(): setattr(skill, key, value)`; snapshot the **old** values with `getattr(skill, key)` **BEFORE** that loop (after the loop they're gone). Metadata: `{"skill_id", "changed_fields": {key: {"from": <old>, "to": <new>}, ...}}`. Coerce values to a JSON-safe form (`str()` non-primitives) — `event_metadata` is JSONB and a non-serializable value would raise at commit, defeating the "never blocks the mutation" promise *inside* the best-effort try/except (it would be swallowed, but you'd silently lose the audit row — so serialize properly, don't rely on the swallow).
  - [x] `derive_skill` ([skill_service.py:1466](../../../velara-api/app/services/skill_service.py#L1466)) — after the second (lineage-link) commit succeeds, since only then is the derivation truly complete. Metadata: `{"parent_skill_id", "child_skill_id" (= `child.id`), "parent_version", "visibility": "client_facing"}`. Pass `emit_audit=False` to its inner `create_skill` call (Task 2).
  - [x] All three: the same best-effort `try/except` + `logger.warning(...)` shape, `hierarchy_path="org"`, local `from app.models.audit import ...` / `from app.services import audit_service` imports inside the try (matching every existing call site — this is a deliberate circular-import avoidance, keep it).

- [x] **Task 4 — Audit document ingest at confirm, covering BOTH routers (AC3)**
  - [x] The audit write belongs in `ingest_service.confirm_file_ref` ([ingest_service.py](../../../velara-api/app/services/ingest_service.py)), **not** in the routers — because there are **two** routers calling it ([api/v1/ingest.py:93](../../../velara-api/app/api/v1/ingest.py#L93) internal, and [api/v1/client.py:636](../../../velara-api/app/api/v1/client.py#L636) client-portal, added for client document upload) and a router-level write would silently miss one. One write in the service covers both.
  - [x] Hook it at **confirm**, not presign: presign only mints a pending row + a URL — the bytes may never arrive. `confirm_file_ref` is where a real, validated document has actually landed.
  - [x] `confirm_file_ref` needs the acting `user_id`, which it does **not currently receive** — it takes only `session`/`storage`/`file_ref_id`/`org_id`. Two options; prefer (a): **(a)** use `ref.created_by_user_id` (already on the loaded `FileReference` row — the person who presigned it, which is the uploader) — zero signature change, zero caller change; **(b)** thread a new `acting_user_id` param through both routers. Use (a) unless you find a reason the confirmer can differ meaningfully from the presigner.
  - [x] Write it after the final `await session.commit()` / `session.refresh(ref)` + the existing `logger.info("file_ref_confirmed", ...)`, in the same best-effort try/except. Metadata: `{"file_ref_id", "content_type", "size_bytes"}` — **and nothing else**.
  - [x] **IP/PHI discipline (AC3), non-negotiable:** do **NOT** put `original_filename` (a real clinical protocol filename is itself sensitive), `content_sha256`, `ingest_key`, `parsed_content_key`, or any bytes into the metadata. Reference and shape only. If in doubt, leave it out — this table is append-only, so a leaked value can never be deleted.
  - [x] The four **failure/rejection** paths in `confirm_file_ref` (0-byte, oversize, bad MIME, magic-bytes mismatch) each commit a `rejected` row and raise. Do **not** audit those — AC3 says "when the upload/confirm **completes**". A rejected upload never becomes a usable document.

- [x] **Task 5 — The guard test: an explicit mutation registry that fails on an unregistered mutation (AC4 — THE POINT OF THE STORY)**
  - [x] Create `velara-api/tests/unit/test_audit_coverage_guard.py` (a top-level test, not under `services/` — it guards the whole app surface, not one service).
  - [x] Build an explicit, **hand-maintained registry** keyed by `(method, path)`: every mutating route, mapped to either its audit event type or an explicit `exempt="<reason>"`. This is the durable artifact — the registry *is* the reviewed decision record.
  - [x] Make the guard **actually catch a new unregistered mutation** — a registry that only lists what you already thought of guards nothing. Discover the live surface programmatically: walk `app.main.app.routes` ([main.py:89](../../../velara-api/app/main.py#L89) exposes `app`) for every non-GET/HEAD/OPTIONS method (POST/PATCH/PUT/DELETE) and assert each `(method, path)` is present in the registry. A new mutating route with no registry entry then fails with a message telling the author what to do. Route-level discovery is the reliable seam: exhaustive, it's where a mutation actually enters the system, and it can't be defeated by a service function nobody calls.
  - [x] ⚠️ **The registry is ~42 routes, not ~7.** The walk surfaces the whole mutating surface, and **roughly 20 of them have no audit decision today** — this is a bigger judgment exercise than "the five the epic listed, plus two." Budget for it. Expect at minimum:
    - **Audited after this story (the epic's five + existing coverage):** skill create / version / metadata-patch / derive / lifecycle; ingest confirm (×2 routers); grant create/revoke; certification; user provision + invite-resend; skill export/import; adapter-propose.
    - **Genuinely unaudited, needs a decision — NOT mentioned by the epic:** `PUT /skills/{id}/draft-content` and `POST /skills/{id}/acknowledge-parent-update` (see Dev Notes below — recommend auditing the first); **hierarchy CRUD** — `POST/PATCH/DELETE` on `/clients`, `/projects`, `/studies`, `/locations` (**12 routes**, entirely unaudited); **skill attachments** — `POST/DELETE /{projects,studies}/{id}/skills` (**4 routes**, unaudited).
    - **Almost certainly `exempt` — but each still needs its reason written down:** `POST /auth/login`; the presign routes (`/skills/bundle/presign`, `/ingest/presign`, client `/ingest/presign` — presign mints a pending row and a URL; the bytes may never arrive, and confirm is the audited event); `POST /invocations/{skill_id}/check-duplicate` (a POST that is read-only — Story 12.4); `POST /jobs/{job_id}/cancel` (audited by the **execution** path as `invocation.cancelled`, not via `record_admin_action` — a legitimate exemption, but say so).
    - **Scope call — make it deliberately, and say which you chose:** the hierarchy + attachment routes (16 of them) are a real, unaudited admin surface, but they are **not in this story's ACs**. Registering them `exempt="not yet audited — tracked, see deferred-work.md"` is an acceptable, honest outcome **provided you add them to `deferred-work.md`**; silently omitting them from the registry is not. Auditing all 16 here would roughly double the story. Recommend: register-as-known-gap + defer, and raise it with the user if you disagree.
  - [x] Do not leave any route silently unregistered — that is precisely the failure mode this story exists to end.
  - [x] Assert the registry's own integrity: every entry is either audited-with-a-real-event-type (the constant must exist in `app.models.audit`) or exempt-with-a-non-empty-reason — never both, never neither.
  - [x] Keep the guard a **unit** test (no DB, no Postgres) so it runs in every CI invocation, not only when Postgres is reachable — the several `_postgres_reachable()`-skipped integration tests must not be where the anti-regression invariant lives.

- [x] **Task 6 — Behavior tests for the five new events (AC1, AC2, AC3)**
  - [x] Integration tests in [tests/integration/api/test_skills.py](../../../velara-api/tests/integration/api/test_skills.py): drive each mutation through its **real API route** (not by calling the service function directly) and assert the expected `admin.*` row lands in `audit_log_entries` with the right `user_id`, `org_id`, `hierarchy_path="org"`, and metadata keys. This is the convention `test_audit_service.py`'s AC7 block already sets ("exercised end-to-end via the real API routes … so the wiring is actually proven") — follow it.
  - [x] **A derive emits exactly ONE `admin.skill_derived` and ZERO `admin.skill_created`** (Task 2's trap — assert the count, not just the presence). Same for import: exactly one `admin.skill_imported`, zero `admin.skill_created`.
  - [x] `update_skill_metadata` on `visibility`: assert the row's metadata carries the old→new pair (the AC2 access-surface case).
  - [x] Ingest: drive `POST /api/v1/ingest/confirm` **and** the client-portal confirm; assert one `admin.document_ingested` each; assert the metadata contains **no** `original_filename` / `content_sha256` / key fields (a positive assertion that the PHI discipline holds, not just that the happy fields are present).
  - [x] **Best-effort proof:** for at least one mutation, monkeypatch `audit_service.record_admin_action` to raise and assert the mutation still returns 2xx and the row still exists. **Reuse the existing pattern** — [test_skills.py:2965](../../../velara-api/tests/integration/api/test_skills.py#L2965) already does exactly this (`monkeypatch.setattr(audit_service, "record_admin_action", _boom)`); copy its shape rather than inventing a new one.

- [x] **Task 7 — Frontend: close the event-type→icon gap for good (AC6)**
  - [x] [velara-web/src/features/audit/eventTypeIconMeta.ts](../../../velara-web/src/features/audit/eventTypeIconMeta.ts) is **already missing three event types** the backend writes today — `admin.skill_adapter_proposed` (11.3), `admin.skill_exported` and `admin.skill_imported` (11.4) — all three currently fall through to the `play` DEFAULT_META. Story 12.3 filled the two provisioning types and the map has drifted again since. This story adds five more.
  - [x] Add map entries for all **eight** missing types: the three above plus `admin.skill_created`, `admin.skill_version_created`, `admin.skill_updated`, `admin.skill_derived`, `admin.document_ingested` (plus a 9th if you audit `update_draft_content` in Task 5). Use existing `IconName` values from [Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx) and V3 brand color tokens only — **do not invent an icon name and do not use an emoji** (hard project rule: icons come from `<Icon>`, never a unicode glyph). The registry has ~43 glyphs (`file`, `edit`, `branch`, `upload`, `plus`, `archive`, `code`, `sparkle`, `download`, `pin`… ) — enough for 8 distinct pairs.
  - [x] ⚠️ **[eventTypeIconMeta.test.ts](../../../velara-web/src/features/audit/eventTypeIconMeta.test.ts) has a collision test that WILL go red.** Its third case ("has no icon+color collisions except the intentionally-shared groups") holds its own hardcoded `ALL_EVENT_TYPES` list plus a `KNOWN_SHARED_GROUPS` allow-list of the three deliberate duplicates. Adding 8 entries means updating **both** lists — and any new `icon+colorClass` pair that collides with an existing one fails unless you add it to `KNOWN_SHARED_GROUPS` (i.e. every reuse must be a *declared* reuse). Prefer genuinely distinct pairs; that's the point of AC6.
  - [x] Also note the second existing test asserts an **unrecognized** event type falls back to `DEFAULT_META` — keep it, but make sure its fixture (`'admin.something_new'`) stays a *fake* event type, not one you just added to the map.
  - [x] Then add the completeness test: pin the **full** expected event-type list and assert every entry resolves to a **non-default** icon — so the next backend event type added without a map entry fails a test instead of silently rendering as `play`. The FE cannot import the Python constants, so a maintained list is the honest mechanism; comment it with an explicit pointer to `velara-api/app/models/audit.py` (the `EVENT_*` block) so the next author knows where the source of truth lives. This is the FE half of AC4's anti-regression bargain.

- [x] **Task 8 — Gates**
  - [x] **Backend:** `ruff check .` clean; unit suite green; integration suite green (run with `AUTH_BACKEND=dev` — the container default is `cognito` and 401s dev tokens; known local artifact, see Dev Notes).
  - [x] **`docs/api-spec.json`:** regenerate via `python scripts/export_openapi.py`. **Expect ZERO diff** — this story adds no endpoint, no schema, no field. A non-empty diff means you changed a request/response contract somewhere you did not intend to; investigate before committing it.
  - [x] **No migration.** If you find yourself writing one, stop — AC5 says the table already carries everything. Confirm `alembic` head is unchanged.
  - [x] **Frontend:** `npm run typecheck` → 0; `npm run lint` → no NEW warnings (1 pre-existing `Icon.tsx` warning is the baseline); `npx vitest run` → all green.

## Dev Notes

### The audit machinery is sound — this is missing wiring, not a broken mechanism (VERIFIED)

The `record_admin_action` seam works and is proven at **eleven** live call sites. Nothing about the mechanism needs changing; five (or seven — see below) call sites were simply never written, because the audit layer was built execution-first in Epic 9 and admin coverage was then added piecemeal, per-story, only where a story happened to call for it. Skill *authoring* and ingest were never on any story's checklist and fell through the seam between epics. **Do not redesign anything.** Copy the existing pattern verbatim and wire it up.

The canonical pattern to copy is `transition_lifecycle` ([skill_service.py:955-978](../../../velara-api/app/services/skill_service.py#L955-L978)) — read it first, it is the exemplar named by the epic:

```python
    # Best-effort audit write AFTER the mutation commits (Story 9.1 Task 4) — an
    # audit-write failure must never roll back a successful transition. Skills
    # are org-global (not hierarchy-scoped), so hierarchy_path is the org root.
    try:
        from app.models.audit import EVENT_ADMIN_LIFECYCLE_TRANSITION
        from app.services import audit_service

        await audit_service.record_admin_action(
            session=session,
            event_type=EVENT_ADMIN_LIFECYCLE_TRANSITION,
            user_id=updated_by_user_id,
            org_id=org_id,
            hierarchy_path="org",
            metadata={"skill_id": str(skill_id), "from_state": old_state, "to_state": to_state},
        )
    except Exception:
        logger.warning("skill_lifecycle_transition_audit_failed", skill_id=str(skill_id), exc_info=True)
```

Three details in there are load-bearing, not incidental:
1. **The imports are local, inside the try.** Every existing call site does this (`skill_service`, `certification_service`, `skill_export`, `skills.py`). It is deliberate circular-import avoidance. Keep it; don't "clean it up" to module-level imports.
2. **The write happens AFTER the mutation's `commit()`.** `record_admin_action` itself calls `session.add(entry)` + `await session.commit()` — so it commits on the *same session*. Writing it before the mutation commits would fold the audit row into the mutation's transaction and break the "never rolls back the mutation" guarantee. After the commit, the mutation is already durable and a failing audit write can only lose the audit row (which is what "best-effort" means).
3. **`hierarchy_path="org"`** — the literal string, not an org-derived ltree path. See the trap below before you second-guess this.
[Source: skill_service.py:955-978; audit_service.py record_admin_action; verified by reading all 11 existing call sites]

### ⛔ TRAP 1 — `create_skill` has three callers; a naive audit write double-emits

This is the single most likely way to get this story wrong, and it is invisible unless you grep the callers. `create_skill` is called by:

| Caller | Should emit | Currently emits |
|---|---|---|
| `POST /api/v1/skills` route ([skills.py:91](../../../velara-api/app/api/v1/skills.py#L91)) | `admin.skill_created` | *(nothing — this story's gap)* |
| `derive_skill` ([skill_service.py:1516](../../../velara-api/app/services/skill_service.py#L1516)) | `admin.skill_derived` **only** | *(nothing — this story's gap)* |
| `skill_export.import_skill` ([skill_export.py:394](../../../velara-api/app/services/skill_export.py#L394)) | `admin.skill_imported` **only** | ✅ `admin.skill_imported` (11.4, already correct) |

Put the audit write in `create_skill` unconditionally and you get `skill_created` + `skill_derived` for every derive, and `skill_created` + `skill_imported` for every import. Both are wrong: a derived skill was not "created" by an operator authoring it, and an imported skill was not authored at all — conflating them corrupts the compliance answer to "who authored this skill." The `emit_audit: bool = True` opt-out in Task 2 is the fix; the count assertions in Task 6 are how you prove it.

**And there is a second layer to the same trap.** `_create_skill_from_bundle` ([skill_service.py:522](../../../velara-api/app/services/skill_service.py#L522)) is a *shared* helper with **two** callers of its own: `create_skill`'s bundle branch, and `skill_export.import_skill`'s bundle-shaped path ([skill_export.py:366](../../../velara-api/app/services/skill_export.py#L366)) — which bypasses `create_skill` entirely and already writes `admin.skill_imported`. It also has its own commit and its own `logger.info("skill_created", ..., is_bundle=True)` at [:632](../../../velara-api/app/services/skill_service.py#L632), which makes it look like the natural audit site. **It is not.** An audit write there re-creates the identical double-emit bug for every bundle import. The `logger.info("skill_created")` line appearing in two places is a red herring — a structured log is allowed to be redundant; an append-only audit row is not.

Audit **only in `create_skill`**, at both of its exits (Task 2), gated on `emit_audit`. Never in `_create_skill_from_bundle`.
[Source: grep of every `create_skill(` and `_create_skill_from_bundle(` caller in app/; skill_service.py:522-820 and skill_export.py:358-440 read in full]

### ⛔ TRAP 2 — `hierarchy_path="org"` looks like a known bug. It is NOT. Do not "fix" it.

There is a long, emphatic entry in `deferred-work.md` (from the 9.2 review) arguing that `hierarchy_path="org"` made admin events **invisible** to `GET /api/v1/audit`, because the org fence was `hierarchy_path <@ 'org_org_vitalief'` and `'org' <@ 'org_org_vitalief'` is FALSE under ltree containment. That was a real, live, confirmed bug. **It was fixed — at the query layer, not the write layer.** Migration 0020 added a real `org_id` column to `audit_log_entries`, and `list_entries` now fences on `org_id == :org_id` directly. The `audit_service.list_entries` docstring says so explicitly and ends with: *"Do NOT reintroduce a hierarchy_path-based org fence."*

So: `hierarchy_path="org"` is the **correct, current convention** for every admin event (AC5 mandates it), the org fence is carried by `org_id`, and the deferred-work entry proposing an `_org_segment(org_id)` write-path change is **superseded and must not be actioned here**. Pass `org_id=org_id` on every `record_admin_action` call (it is a required kwarg — you cannot forget it) and `hierarchy_path="org"`. If you find yourself editing `list_entries` or a migration, you have gone off the rails.
[Source: audit_service.py:list_entries docstring; models/audit.py:org_id comment; migration 0020; deferred-work.md 9.2 entry — resolved, not open]

### Mutations the epic's inventory MISSED — decide these explicitly (AC4)

The epic (written 2026-07-09) lists five unaudited mutations. Reading the current `skill_service` end-to-end surfaces **two more** that the epic did not know about, both of which a "no admin mutation goes unaudited" invariant must confront. This is exactly the class of gap AC4's registry exists to end, so do not quietly skip them:

- **`update_draft_content`** ([skill_service.py:1179](../../../velara-api/app/services/skill_service.py#L1179), Story 11.6, `PUT /api/v1/skills/{id}/draft-content`) — re-points the current **draft** version's artifact **in place**: same version string, new content-addressed S3 key, no new version row. It is a **content change with no who/when**, functionally the same severity the epic assigns `create_version` (HIGH). The Draft-Mutable Versioning ADR makes this legitimate *behavior*, but "draft content is mutable" is an argument for auditing it, not against. **Strong recommendation: audit it** (`admin.skill_draft_content_updated`, metadata `{skill_id, version, is_bundle}` — never the content itself).
- **`acknowledge_parent_update`** ([skill_service.py:1594](../../../velara-api/app/services/skill_service.py#L1594), `POST /api/v1/skills/{id}/acknowledge-parent-update`) — clears `review_required`, which is the gate blocking a derived skill's advance to `client_ready`. Someone is releasing a governance gate. Lower severity than the above (the subsequent `transition_lifecycle` **is** audited, so the *release* is on the record even if the *acknowledgement* isn't) — a defensible `exempt` if you write the reason down. **Decide and register it; don't leave it unregistered.**

And the route-walk goes further still: **the entire hierarchy CRUD surface (12 mutating routes on `/clients`, `/projects`, `/studies`, `/locations`) and the skill-attachment surface (4 routes) are also completely unaudited today.** Someone can create, rename, or delete a client/project/study — or attach a skill to a study — with no audit record. That is genuinely out of this story's ACs, and auditing all 16 would roughly double it. But the guard test will surface them whether you like it or not, which is the mechanism working as designed. **Register them with an explicit `exempt="not yet audited — known gap, tracked in deferred-work.md"` and add the entry to `deferred-work.md`.** That is an honest deferral. Quietly leaving them out of the registry to keep it small is not — it would reproduce, inside the very test built to prevent it, the exact "nobody put it on a checklist" failure that created this story.

**The registry is the deliverable.** A guard test that only knows about the mutations you already remembered protects nothing.
[Source: skill_service.py read in full; route-walk of app.main.app across all v1 routers]

### The five (or seven) call sites — exact locations, VERIFIED against current HEAD

⚠️ **The epic's line numbers are stale** (it cites `create_skill` at 617, `create_version` at 951, `update_skill_metadata` at 1174, `derive_skill` at 1226 — the file has grown since 11.6/11.7/11.9). These are the current ones at baseline `cddc082`:

| Mutation | Current location | Commit point to hook after |
|---|---|---|
| `create_skill` | [skill_service.py:645](../../../velara-api/app/services/skill_service.py#L645) | **TWO exits, no convergence** — before the bundle branch's `return skill` ([:719](../../../velara-api/app/services/skill_service.py#L719)) **and** on the inline path's success ([:807-820](../../../velara-api/app/services/skill_service.py#L807)). Never inside `_create_skill_from_bundle`. See Trap 1. |
| `create_version` | [skill_service.py:985](../../../velara-api/app/services/skill_service.py#L985) | after `await session.refresh(new_version)` + `logger.info("skill_version_created")` |
| `update_skill_metadata` | [skill_service.py:1414](../../../velara-api/app/services/skill_service.py#L1414) | after `refresh(skill)` + `logger.info("skill_metadata_updated")` — **snapshot old values BEFORE the setattr loop** |
| `derive_skill` | [skill_service.py:1466](../../../velara-api/app/services/skill_service.py#L1466) | after the **second** (lineage-link) commit + `logger.info("skill_derived")` |
| `confirm_file_ref` | [ingest_service.py](../../../velara-api/app/services/ingest_service.py) `confirm_file_ref` | after the final `commit()` / `refresh(ref)` + `logger.info("file_ref_confirmed")` — **the success path only, not the four `rejected` paths** |
| *(+ decide)* `update_draft_content` | [skill_service.py:1179](../../../velara-api/app/services/skill_service.py#L1179) | after the commit + `logger.info("skill_draft_content_updated")` |
| *(+ decide)* `acknowledge_parent_update` | [skill_service.py:1594](../../../velara-api/app/services/skill_service.py#L1594) | after the commit + `logger.info("skill_parent_update_acknowledged")` |

Every one of these already has a `logger.info(...)` on its success path with the exact fields you need — the structured-log call is your marker for "the mutation is durable, the audit write goes right here." Don't remove or change those log lines; add beside them.
[Source: all functions read in full at baseline commit cddc082]

### Ingest: TWO routers call the same service function

`ingest_service.confirm_file_ref` is called from **both** [api/v1/ingest.py:93](../../../velara-api/app/api/v1/ingest.py#L93) (internal, `RejectClient`-gated) and [api/v1/client.py:636](../../../velara-api/app/api/v1/client.py#L636) (the client-portal upload surface added so clients can attach their own source documents). `create_file_ref` (presign) likewise has two callers. **Audit in the service, not the router** — a router-level write covers one surface and silently misses the other, and the client-portal one is precisely the PHI-bearing case AC3 is about (a client uploading their own protocol document). This is the same "one seam, two callers" shape as Trap 1; the fix is the same: put the write where the callers converge.
[Source: grep of `ingest_service.confirm_file_ref` callers]

### IP/PHI discipline on the ingest event (AC3) — what NOT to log

`FileReference` carries `original_filename`, `content_sha256`, `ingest_key`, `parsed_content_key`, `content_type`, `size_bytes`. Only the last two, plus the row `id`, may go into the audit metadata. **`original_filename` is the trap** — it is the most natural thing to log and the most sensitive: a real clinical protocol filename (`ACME-2024-ONC-017_Protocol_v3_Site_Amendment.pdf`) leaks the sponsor, the indication, the site, and the amendment state, and the audit table is **append-only** (a DB trigger enforces it — migrations 0006/0018) so a leaked value **can never be deleted**. The existing audit invariant is *name the location, never the content*: every existing event logs IDs and state transitions, never payloads. Hold that line.
[Source: models/file_ref.py; models/audit.py append-only docstring; AC3]

### The guard test is the actual deliverable (AC4)

Backfilling five call sites is an afternoon. The reason this story exists as a story — rather than a one-line fix — is that the *same class of gap* has now recurred across four epics, and the epic text says so outright: *"the anti-regression mechanism is the point of the story, not just backfilling today's five holes."* Two independent confirmations that the gap-class is live and still widening:
- The **backend** gap this story fixes (five unaudited mutations, found by an operator using deployed dev, not by any test).
- The **frontend** mirror of it (Task 7): three event types shipped since 12.3 — `admin.skill_adapter_proposed`, `admin.skill_exported`, `admin.skill_imported` — and *all three* silently render with the `play` fallback icon today, because nothing fails when the map drifts.

Both are the same failure mode: **a coverage invariant with no test to enforce it.** So the guard must fail on a mutation *you did not think of*, which means discovering the live surface (walk the app's routes) and checking it against the registry — not just asserting that the entries you hand-wrote are present. A registry test that enumerates only known-good entries is theater; it passes forever and catches nothing. The failure message matters too: when it fires for a future author, it should tell them *what to do* ("route X is a mutation with no audit decision — add an audit write, or register it exempt with a reason in tests/unit/test_audit_coverage_guard.py"), because that author will be mid-way through an unrelated story and will otherwise just add their route to the list to make the red go away.

### Testing standards

- **BE:** pytest. Unit tests live in `tests/unit/services/`; the AC4 guard goes at `tests/unit/` top level (it guards the app, not a service) and must be **DB-free** so it runs in every CI invocation — several integration tests are `_postgres_reachable()`-skipped, and the anti-regression invariant must not live behind a skip.
- **Integration** tests drive **real API routes** (the convention `test_audit_service.py`'s AC7 block set deliberately: *"exercised end-to-end via the real API routes, not by calling the service function directly, so the wiring is actually proven"*). New skill-mutation audit tests go in `tests/integration/api/test_skills.py`; ingest ones in `tests/integration/api/test_ingest.py`.
- **Known local artifact:** the API container defaults to `AUTH_BACKEND=cognito`, which 401s dev tokens — run the integration suite with an `AUTH_BACKEND=dev` override. Also, `test_ingest.py` has 3 known-failing MinIO-in-container tests on the *host* runner (localhost ≠ minio in-container); that's the documented pre-existing baseline, not something you broke. Re-baseline before you start so you can tell your failures from the inherited ones.
- **FE:** vitest + Testing Library, colocated (`eventTypeIconMeta.test.ts` beside the map).

### Project Structure Notes

Every file this story touches already exists — **there is no new module, no new endpoint, no new schema, no new migration.** Additive edits only:

- `velara-api/app/models/audit.py` — +5 (or +6) event-type constants.
- `velara-api/app/services/skill_service.py` — audit writes in 4 (or 6) functions; one new `emit_audit` kwarg on `create_skill`.
- `velara-api/app/services/skill_export.py` — pass `emit_audit=False` at the `create_skill` call.
- `velara-api/app/services/ingest_service.py` — audit write in `confirm_file_ref`.
- `velara-api/tests/unit/test_audit_coverage_guard.py` — **NEW** (the only new file on the backend).
- `velara-api/tests/integration/api/test_skills.py`, `test_ingest.py` — new tests.
- `velara-web/src/features/audit/eventTypeIconMeta.ts` + `.test.ts` — 8 map entries + a completeness test.

The `docs/api-spec.json` diff should be **empty**. If it isn't, you changed a contract you didn't mean to.

### References

- [Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.5] — ACs, the unaudited-mutation inventory + severities, the "already audited — do not touch" list, the no-migration/reuse-the-seam constraint.
- [Source: planning-artifacts/sprint-change-proposal-2026-07-09.md] — the correct-course that added this story: discovery in deployed dev, the piecemeal-coverage root cause, the guard test as the durable win.
- [Source: velara-api/app/services/audit_service.py] — `record_admin_action` signature/semantics; `list_entries`' "do NOT reintroduce a hierarchy_path-based org fence" (Trap 2).
- [Source: velara-api/app/models/audit.py] — event-type constants (incl. `EVENT_ADMIN_SKILL_EXPORTED`/`IMPORTED`, which the epic's list omits); append-only invariant; `org_id` vs `hierarchy_path` roles.
- [Source: velara-api/app/services/skill_service.py:955-978] — `transition_lifecycle`, the best-effort pattern to copy verbatim.
- [Source: velara-api/tests/integration/api/test_skills.py:2965] — the existing `monkeypatch.setattr(audit_service, "record_admin_action", _boom)` best-effort test shape to reuse.
- [Source: implementation-artifacts/deferred-work.md] — the 9.2 `hierarchy_path="org"` entry (**resolved by migration 0020, superseded — do not action**); the dead `record_admin_action_sync` note (still dead; this story does not need it).
- [Source: implementation-artifacts/stories/12-4-duplicate-run-cost-warning.md] — prior Epic 12 story: gate conventions, api-spec regeneration step.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (bmad-dev-story)

### Debug Log References

None — no blocking failures. `docker compose run --rm -e AUTH_BACKEND=dev api python -m pytest` reproduces the 3 pre-existing `test_ingest.py` MinIO-hostname failures (documented known non-blocker, unrelated to this story). One benign `RuntimeWarning` surfaced in a pre-existing mocked unit test (`test_execution_service.py::TestRequiresPatchRoute::test_requires_persisted_via_setattr_loop`) — its `session = AsyncMock()` doesn't fully support the new best-effort audit write `update_skill_metadata` now makes; the write is correctly swallowed by the try/except (proving the "never blocks the mutation" guarantee even under an incomplete mock) and the test still passes. Left unchanged — not a regression, just an artifact of a mock stricter tests didn't need before.

### Completion Notes List

- **Task 1**: Added 6 event-type constants to `app/models/audit.py` (5 required by the epic + `EVENT_ADMIN_SKILL_DRAFT_CONTENT_UPDATED`, an explicit scope addition — see Task 3). Not added to `OUTCOME_TO_EVENT_TYPE` (invocation-only map, correctly left untouched).
- **Task 2 (Trap 1)**: Added `emit_audit: bool = True` to `create_skill`, and a shared `_audit_skill_created(...)` helper called at BOTH of its exits (bundle branch's early return, inline path's success) — never inside `_create_skill_from_bundle` (confirmed via the bundle-shaped import test, which exercises that helper directly and asserts zero `admin.skill_created` rows). `derive_skill` and `skill_export.import_skill` both pass `emit_audit=False` and write their own more specific event.
- **Task 3**: Audited `create_version` (after its `logger.info`), `update_skill_metadata` (old→new snapshot taken BEFORE the `setattr` loop, JSON-safe coercion via a local `_json_safe`), `derive_skill` (after the lineage-link commit). Additionally audited `update_draft_content` (Story 11.6's in-place draft re-point) per the Dev Notes' "strong recommendation" — a genuine content change with no prior who/when record.
- **Task 4**: Audited `ingest_service.confirm_file_ref` (the single convergence point for both the internal and client-portal ingest routers) using `ref.created_by_user_id` (option (a) — zero signature change). Metadata is reference-only: `file_ref_id`, `content_type`, `size_bytes` — verified by a positive test assertion that `original_filename`/`content_sha256`/`ingest_key`/`parsed_content_key` are absent.
- **Task 5 (the deliverable)**: `tests/unit/test_audit_coverage_guard.py` walks `app.main.app.routes` for the live mutating surface (confirmed 42 routes, matching the story's prediction) and cross-checks against a hand-maintained `REGISTRY` — 16 audited, 10 exempt-with-reason (presign×3, invocation/proxy/cancel/duplicate-check×5, auth login×1, acknowledge-parent-update×1), 16 registered `exempt="not yet audited — known gap"` for hierarchy CRUD + skill attachments (genuinely out of this story's ACs per the Dev Notes' explicit scope decision) — added to `deferred-work.md` as required. Proved the guard actually catches a new unregistered route (not just theater) by removing an entry and confirming it fails with the missing route named. 3 tests: registration completeness, no-stale-entries, and registry self-integrity (every entry audited-with-a-real-constant XOR exempt-with-a-reason).
- **Task 6**: Full behavior-test coverage across `test_skills.py`, `test_ingest.py`, and `test_client_surface.py` (new client-portal ingest confirm coverage — none existed before). Headline: two count-based double-emit-trap tests (`func.count()`, not just presence) proving a derive emits exactly one `admin.skill_derived` + zero `admin.skill_created`, and a bundle-shaped import emits exactly one `admin.skill_imported` + zero `admin.skill_created` (the second, harder case — exercises `_create_skill_from_bundle` directly). Best-effort proof via the existing `_boom` monkeypatch pattern (test_skills.py:2965) reused verbatim for both a skill-create and an ingest-confirm mutation.
- **Task 7**: Added 9 new event-type→icon map entries (the 3 already-drifted 11.3/11.4 types + 6 for this story), all genuinely distinct icon+color pairs (verified no new collisions beyond the 3 pre-existing intentional shared groups). Added a completeness test asserting every entry in a maintained `ALL_EVENT_TYPES` list (commented with an explicit pointer to `app/models/audit.py`, since the FE cannot import the Python constants) resolves to a non-default icon.
- **Task 8**: `docker compose build api` + full pytest: 1322 passed, only the 3 known pre-existing `test_ingest.py` MinIO failures. `ruff check .` clean repo-wide. `docs/api-spec.json` regenerated — **zero diff**, confirmed (this story adds no endpoint/schema/field). No migration — confirmed no new alembic revision. FE: `npm run typecheck` 0 errors, `npm run lint` 0 errors / 1 pre-existing baseline warning, `npx vitest run` 654 passed (57 files).

### File List

**velara-api:**
- `app/models/audit.py` — MODIFIED (6 new `EVENT_ADMIN_*` constants)
- `app/services/skill_service.py` — MODIFIED (`_audit_skill_created` helper + `emit_audit` kwarg on `create_skill`; audit writes in `create_version`, `update_skill_metadata`, `derive_skill`, `update_draft_content`)
- `app/services/skill_export.py` — MODIFIED (`emit_audit=False` on its `create_skill` call)
- `app/services/ingest_service.py` — MODIFIED (audit write in `confirm_file_ref`)
- `tests/unit/test_audit_coverage_guard.py` — NEW (the AC4 guard test + mutation registry)
- `tests/integration/api/test_skills.py` — MODIFIED (behavior tests for the 6 new events, incl. double-emit-trap count assertions)
- `tests/integration/api/test_ingest.py` — MODIFIED (behavior tests for `admin.document_ingested`, incl. PHI-negative assertions)
- `tests/integration/api/test_client_surface.py` — MODIFIED (client-portal ingest confirm audit coverage — new)

**velara-web:**
- `src/features/audit/eventTypeIconMeta.ts` — MODIFIED (9 new icon/color map entries)
- `src/features/audit/eventTypeIconMeta.test.ts` — MODIFIED (9 new fixture cases, hoisted `ALL_EVENT_TYPES`, new completeness test)

**velara (top-level docs):**
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFIED (new entry: hierarchy CRUD + skill-attachment audit gap, tracked per Story 12.5's explicit scope decision)

## Change Log

- 2026-07-13 — Story 12.5 implemented: 6 skill-authoring/ingest mutations gained best-effort audit writes (create_skill/create_version/update_skill_metadata/derive_skill/update_draft_content/confirm_file_ref), closing the two double-emit traps (create_skill's 3 callers, the shared _create_skill_from_bundle helper) with an `emit_audit` kwarg. AC4's guard test (the actual deliverable) walks the live 42-route mutating surface and cross-checks a reviewed registry, catching any future unaudited mutation; 16 hierarchy/attachment routes registered as a tracked, honest known-gap rather than silently omitted. FE icon-map coverage closed for 9 event types (3 already-drifted + 6 new). All 8 tasks complete, all ACs satisfied, all gates green (zero api-spec diff, no migration). Status → review.
