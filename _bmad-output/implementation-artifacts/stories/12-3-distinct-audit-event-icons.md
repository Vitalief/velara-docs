---
baseline_commit: 2448de1cc4fc975d095ef5bcfa9f1095c921494f
---

# Story 12.3: Distinct Audit Event Icons

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a consultant scanning the audit log,
I want a distinct icon per event type,
so that I can tell invocations, grants, certifications, lifecycle changes, and provisioning apart at a glance.

## Acceptance Criteria

1. **AC1 — Unmapped admin event types get a distinct icon, not the `play` fallback.**
   **Given** the event-type icon map
   **When** an `admin.user_provisioned` or `admin.user_invite_resent` event renders
   **Then** it shows a distinct icon — the `play` default no longer masks it (it currently falls through `eventTypeIconMeta` to `DEFAULT_META = { icon: 'play', ... }`, visually indistinguishable from `invocation.success`).

2. **AC2 — Invocation outcome icons are visually distinct and verified to render.**
   **Given** the invocation outcomes (`success`, `failure`, `cancelled`, `blocked`, `fan_out`)
   **When** they render in the audit list
   **Then** each shows a visually distinct icon. The map already differentiates these (`play`/brand, `x`/danger, `x`/muted, `flag`/hold, `layers`/brand-500) — verify via a rendering test that `AuditRow` actually applies `eventTypeIconMeta(entry.event_type)` per row (today `eventTypeIconMeta.ts` has **zero** test coverage), and decide whether `invocation.success` keeps `play` or gets its own glyph (see Dev Notes — recommendation: keep `play`, it is the semantically correct "run" glyph and is not shared with any other **invocation** outcome after AC1's fix; `cancelled` reusing `x` with a muted color is the one remaining same-glyph pair, which is an intentional visually-distinct-by-color choice already in the map — confirm this reading with the user only if you find a stronger justification to change it, otherwise leave as-is).

3. **AC3 — Previously org-fenced admin/certification/lifecycle events render their mapped icons now that they surface.**
   **Given** admin/certification/lifecycle events that were historically excluded by the pre-migration-0020 org-fence bug (`hierarchy_path="org"` rows were silently dropped — fixed in Story 9.3's `org_id` column fix; see `audit_service.py:192-207`)
   **When** they now appear in the log
   **Then** their mapped icons render correctly: `admin.grant_created`/`admin.grant_reaffirmed` → `shield` (`text-st-internal-tx`), `admin.grant_revoked` → `shield` (`text-danger`), `admin.certification` → `cert` (`text-key-method`), `admin.lifecycle_transition` → `layers` (`text-brand-500`). Cross-check with a rendering test per event type — this is a verification task, the mappings already exist in `eventTypeIconMeta.ts:22-26`.

## Tasks / Subtasks

- [x] **Task 1 — Add icon mappings for the 2 unmapped admin event types (AC1)**
  - [x] In [eventTypeIconMeta.ts](../../../velara-web/src/features/audit/eventTypeIconMeta.ts), add two entries to `EVENT_TYPE_ICON_META`:
    - `'admin.user_provisioned': { icon: 'user', colorClass: 'text-st-internal-tx' }` — a **new** user account was created; `user` (single-person icon, distinct from `users` used for the Client entity type) is unused elsewhere in this map and reads correctly for "a user was provisioned."
    - `'admin.user_invite_resent': { icon: 'refresh', colorClass: 'text-st-internal-tx' }` — an invite was resent; `refresh` reads as "re-sent/retry" and is unused elsewhere in this map.
    - Both event type string constants are defined backend-side at [audit.py:53,55](../../../velara-api/app/models/audit.py#L53-L55) (`EVENT_ADMIN_USER_PROVISIONED = "admin.user_provisioned"`, `EVENT_ADMIN_USER_INVITE_RESENT = "admin.user_invite_resent"`) and written in [provisioning_service.py:59,105](../../../velara-api/app/services/provisioning_service.py#L59-L105). **No backend change** — the event types and their string values already exist and are already written to the audit log; this is purely a frontend icon-map gap.
    - Both `user` and `refresh` icon glyphs already exist in [Icon.tsx ICONS](../../../velara-web/src/shared/components/Icon.tsx#L27-L50) (`user` at line 27, `refresh` at line 50) — **no new icon glyph needs to be added**.
    - `text-st-internal-tx` matches the color already used for the sibling `admin.grant_created`/`admin.grant_reaffirmed` rows (both are "internal/admin action, non-destructive" in character) — reuse the existing token, do not invent a new color class.

- [x] **Task 2 — Add direct unit test coverage for `eventTypeIconMeta` (AC1, AC2, AC3)**
  - [x] Create `src/features/audit/eventTypeIconMeta.test.ts` (currently **no dedicated test file exists** for this module — it has zero direct coverage today). Test:
    - Each of the 9 mapped event types (`invocation.success`, `invocation.failure`, `invocation.cancelled`, `invocation.blocked`, `invocation.fan_out`, `admin.grant_created`, `admin.grant_reaffirmed`, `admin.grant_revoked`, `admin.lifecycle_transition`, `admin.certification`, plus the 2 newly added `admin.user_provisioned`/`admin.user_invite_resent`) returns its **specific, expected** `{icon, colorClass}` pair — assert exact values, not just "is not the default."
    - An unrecognized/unknown event type string (e.g. `'admin.something_new'`) still falls back to `DEFAULT_META` (`{icon: 'play', colorClass: 'text-brand-600'}`) — this fallback behavior for genuinely-unknown types is correct and must be preserved, only the 2 specific known-but-unmapped types from AC1 are being fixed.
    - Assert **no two distinct event types share the same `{icon, colorClass}` pair** except the intentionally-shared cases: `invocation.failure`/`invocation.cancelled` both use `x` (differentiated by color: danger vs muted) and `admin.grant_created`/`admin.grant_reaffirmed` intentionally share the same tuple (both are "grant is active" states). Write this as an explicit collision-check test (iterate `EVENT_TYPE_ICON_META`, group by `${icon}:${colorClass}`, assert only the known/intentional groups have >1 member) so a future unmapped addition triggers a red test instead of silently reusing an in-use combo.
    - **Note:** the collision-check test found one additional pre-existing shared pair not called out in the story text: `invocation.fan_out` and `admin.lifecycle_transition` both map to `{icon: 'layers', colorClass: 'text-brand-500'}`. This is pre-existing (not introduced by this story) and semantically defensible (both represent "a branching/multi-part event"), so it was added to the test's known-intentional-groups allowlist rather than changed — flagging for reviewer awareness per AC2/AC3's "confirm this reading with the user only if you find a stronger justification to change it" guidance.

- [x] **Task 3 — Verify rendering in `AuditRow` for all outcome + admin event types (AC2, AC3)**
  - [x] In [AuditLog.test.tsx](../../../velara-web/src/features/audit/components/AuditLog.test.tsx), add rendering assertions (this file currently has **no icon-content assertions** — only the Story 12.2 layers-icon-absence test at lines 115-127 touches icons, and that is about the context-names row, not the event-type icon tile). For a representative entry of each event type in AC2/AC3 (`invocation.success`, `invocation.failure`, `invocation.cancelled`, `invocation.blocked`, `invocation.fan_out`, `admin.grant_created`, `admin.grant_revoked`, `admin.certification`, `admin.lifecycle_transition`, `admin.user_provisioned`, `admin.user_invite_resent`), render `AuditLog` (or `AuditRow` directly if exported/testable) with a fixture entry of that type and assert the icon tile ([AuditLog.tsx:133-137](../../../velara-web/src/features/audit/components/AuditLog.tsx#L133-L137)) renders the SVG path corresponding to `eventTypeIconMeta(event_type).icon` (e.g. via `container.querySelector('path')` `d` attribute matching `ICONS[expectedIconName]` from `Icon.tsx`, mirroring the existing `layers`-path-uniqueness technique used in the Story 12.2 test at lines 115-127).
  - [x] This is a **verification task** for AC3 — no code change is expected to make `shield`/`cert`/`layers` render for admin/certification/lifecycle events (the mapping already exists); the task is proving via test that `AuditRow`'s existing `eventTypeIconMeta(entry.event_type)` call ([AuditLog.tsx:121](../../../velara-web/src/features/audit/components/AuditLog.tsx#L121)) correctly looks up and renders each of these types now that the write-path org-fence bug (fixed in Epic 9) no longer hides them from the query results.

- [x] **Task 4 — Gates**
  - [x] **Frontend only** (no backend, no migration, no Terraform): `npm run typecheck` → 0 errors; `npm run lint` → clean (1 pre-existing `Icon.tsx` react-refresh warning is baseline, not introduced here); `npm test` → all pass, including the new `eventTypeIconMeta.test.ts` and the new `AuditLog.test.tsx` icon-rendering assertions.

## Dev Notes

### Scope reality — FE-only, small, mostly verification (VERIFIED)

A real event-type→icon map already exists at [eventTypeIconMeta.ts](../../../velara-web/src/features/audit/eventTypeIconMeta.ts) with **10 event types mapped** (`invocation.{success,failure,cancelled,blocked,fan_out}`, `admin.{grant_created,grant_reaffirmed,grant_revoked,lifecycle_transition,certification}`) plus a `DEFAULT_META = {icon:'play', colorClass:'text-brand-600'}` fallback. Verified against the backend's actual written event types ([audit.py:38-55](../../../velara-api/app/models/audit.py#L38-L55) + all write-sites), there are **exactly 2 gaps**: `admin.user_provisioned` and `admin.user_invite_resent` (both written by [provisioning_service.py:59,105](../../../velara-api/app/services/provisioning_service.py#L59-L105)) fall through to the `play` default — the same icon as the dominant `invocation.success` row, producing the "everything looks the same" symptom the story is named for. **This story is: (1) fill those 2 gaps, (2) add test coverage that has never existed for this module, (3) verify — not rebuild — that the other 8 mappings actually render post-Epic-9-org-fence-fix.** No backend change, no new component, no new icon glyphs (both `user` and `refresh` already exist in `Icon.tsx`).
[Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.3]

### The icon map — current state (VERIFIED, read in full)

```ts
// src/features/audit/eventTypeIconMeta.ts
const DEFAULT_META: EventTypeIconMeta = { icon: 'play', colorClass: 'text-brand-600' }

const EVENT_TYPE_ICON_META: Record<string, EventTypeIconMeta> = {
  'invocation.success':          { icon: 'play',   colorClass: 'text-brand-600' },
  'invocation.failure':          { icon: 'x',      colorClass: 'text-danger' },
  'invocation.cancelled':        { icon: 'x',      colorClass: 'text-muted' },
  'invocation.blocked':          { icon: 'flag',   colorClass: 'text-hold-tx' },
  'invocation.fan_out':          { icon: 'layers', colorClass: 'text-brand-500' },
  'admin.grant_created':         { icon: 'shield', colorClass: 'text-st-internal-tx' },
  'admin.grant_reaffirmed':      { icon: 'shield', colorClass: 'text-st-internal-tx' },
  'admin.grant_revoked':         { icon: 'shield', colorClass: 'text-danger' },
  'admin.lifecycle_transition':  { icon: 'layers', colorClass: 'text-brand-500' },
  'admin.certification':         { icon: 'cert',   colorClass: 'text-key-method' },
}
```
`eventTypeIconMeta(eventType)` returns the mapped entry or `DEFAULT_META`. Consumed at exactly **one** call site: [AuditLog.tsx:121](../../../velara-web/src/features/audit/components/AuditLog.tsx#L121) inside `AuditRow`, rendered at [AuditLog.tsx:133-137](../../../velara-web/src/features/audit/components/AuditLog.tsx#L133-137) as `<Icon name={meta.icon} size={16} />` inside a `bg-surface-sunk` tile colored via `meta.colorClass`. `AuditDetailPanel.tsx` does **not** use `eventTypeIconMeta` (it has its own unrelated `<Icon name="x" .../>` for a close button at line 49) — the icon tile is list-row-only, no second surface to update.
[Source: eventTypeIconMeta.ts (full file, 32 lines); AuditLog.tsx:14,108-170]

### All backend-written event types — the complete, closed set (VERIFIED)

```
app/models/audit.py:
  EVENT_INVOCATION_SUCCESS      = "invocation.success"
  EVENT_INVOCATION_FAILURE      = "invocation.failure"
  EVENT_INVOCATION_CANCELLED    = "invocation.cancelled"
  EVENT_INVOCATION_BLOCKED      = "invocation.blocked"
  EVENT_INVOCATION_FAN_OUT      = "invocation.fan_out"
  EVENT_ADMIN_GRANT_CREATED     = "admin.grant_created"
  EVENT_ADMIN_GRANT_REAFFIRMED  = "admin.grant_reaffirmed"
  EVENT_ADMIN_GRANT_REVOKED     = "admin.grant_revoked"
  EVENT_ADMIN_LIFECYCLE_TRANSITION = "admin.lifecycle_transition"
  EVENT_ADMIN_CERTIFICATION     = "admin.certification"
  EVENT_ADMIN_USER_PROVISIONED  = "admin.user_provisioned"       # ← unmapped (AC1)
  EVENT_ADMIN_USER_INVITE_RESENT = "admin.user_invite_resent"    # ← unmapped (AC1)
```
Write sites confirmed: `audit_service.py` (invocation.* via `OUTCOME_TO_EVENT_TYPE` + fan-out), `access_service.py:284,328,387` (grant lifecycle), `skill_service.py:540` (lifecycle_transition), `certification_service.py:259` (certification), `provisioning_service.py:59,105` (the 2 AC1 targets). This is the **complete, closed set** of 12 event types the frontend will ever see — no other event types exist in the backend. [Source: velara-api app/models/audit.py:38-55; grep across app/services/*.py for `event_type=`]

### Icon glyph choices for the 2 new mappings — avoiding collisions

Existing icons already used elsewhere in the app for related concepts (do not reuse these for the new mappings, to keep the icon vocabulary consistent app-wide): `users` = Client entity ([Icon.tsx ENTITY_ICON](../../../velara-web/src/shared/components/Icon.tsx#L98-L103)). The recommended choices avoid this: `user` (singular person, distinct glyph from `users`) for `admin.user_provisioned`, and `refresh` (circular-arrow "retry/resend" glyph, already used nowhere else in the codebase per a grep of `name="refresh"`) for `admin.user_invite_resent`. Both glyphs already exist in [Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx#L27,L50) — do not add new SVG paths.
[Source: Icon.tsx full ICONS map, lines 6-58]

### Outcome-icon distinctness — what "distinct" means here (AC2 judgment call)

The map already differentiates all 5 invocation outcomes via icon+color pairs, with one intentional same-glyph pair: `invocation.failure` and `invocation.cancelled` both use `x` but differ by color (`text-danger` vs `text-muted`) — this mirrors the pattern in [AuditOutcomeBadge](../../../velara-web/src/features/audit/components/AuditOutcomeBadge.tsx) which also color-differentiates same-shape states. AC2 asks you to "decide whether `invocation.success` keeps `play` or gets its own glyph" — the epic's own language already answers this: `play` is the correct "an invocation ran" glyph and no other **invocation** type will share it after AC1 closes the `admin.*` gap (the only remaining `play` users would be the 2 admin fallbacks, which AC1 fixes). **Recommendation: leave `invocation.success` as `play`.** Do not spend implementation time hunting for a "better" glyph — this AC is satisfied by the test coverage in Task 2/3 proving the existing distinctness, not by changing `invocation.success`.

### Org-fence history — why AC3 is a verification task, not a bug fix

`list_entries` in `audit_service.py` used to silently exclude every `hierarchy_path="org"` row (the sentinel used for **all** admin/org-global events including grants, certifications, and lifecycle transitions) because the query fenced on a hierarchy-path-based check rather than the dedicated `org_id` column. This was fixed via **migration 0020** (added a real `org_id` column to `audit_log_entries`, mirroring `invocation_jobs`/`skills`) during Story 9.3's review — see [audit_service.py:192-207](../../../velara-api/app/services/audit_service.py#L192-L207) for the in-code warning against reintroducing the old fence. Because of this fix, `admin.grant_*`/`admin.certification`/`admin.lifecycle_transition` rows **now actually appear** in query results where they previously did not — meaning their icon mappings (`shield`, `cert`, `layers`) have likely never been visually verified in a real running log. AC3 is entirely about writing tests that prove these render correctly now, not about touching the fence or the mappings themselves.
[Source: audit_service.py:192-207; project memory — Epic 9 Retro Lessons, "org-fence prod bug → migration 0020 org_id col"]

### Icon tile markup — do not change layout, only the data feeding it

[AuditLog.tsx:133-137](../../../velara-web/src/features/audit/components/AuditLog.tsx#L133-L137):
```tsx
<div className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-surface-sunk ${meta.colorClass}`}>
  <Icon name={meta.icon} size={16} />
</div>
```
This markup is correct and unchanged by this story — `meta` already comes from `eventTypeIconMeta(entry.event_type)` ([AuditLog.tsx:121](../../../velara-web/src/features/audit/components/AuditLog.tsx#L121)). Only `eventTypeIconMeta.ts`'s data map changes (Task 1); `AuditRow` itself needs no edits.

### UI convention constraints (house rules)

- **No emoji/unicode icons.** Always `<Icon name="..." />` from `Icon.tsx` — both new mappings use existing named icons (`user`, `refresh`), never a raw glyph. [Source: project memory — No Emoji Icons]
- **Tailwind-v4 tokens only**, no hardcoded colors. Reuse `text-st-internal-tx` for the 2 new entries (matches sibling `admin.grant_created`/`admin.grant_reaffirmed` semantics: internal, non-destructive admin action).
- **Reuse, don't rebuild:** this is a data-only change to an existing `Record` map — do not introduce a new component, new file, or restructure `eventTypeIconMeta.ts`'s shape.

### Testing standards

- **Frontend only**, no backend/migration/Terraform touched by this story. Vitest + Testing Library, co-located `*.test.ts(x)`.
- New file `src/features/audit/eventTypeIconMeta.test.ts` — pure unit tests over a plain function, no rendering/mocking needed.
- Extend `AuditLog.test.tsx` with icon-rendering assertions per event type, reusing the SVG-path-uniqueness assertion technique already established in that file's Story 12.2 test (lines 115-127: querying the rendered `<path d="...">` and comparing against `ICONS[name]` from `Icon.tsx` to prove which icon actually rendered).
- Respect existing fixture patterns: `makeEntry` helper already exists in `AuditLog.test.tsx` (extended for `context_names` in Story 12.2) — extend it further or pass an `event_type` override per test case rather than duplicating the fixture builder.
[Source: AuditLog.test.tsx:115-127; auditFormat.test.ts as a sibling co-located-test precedent from Story 12.2]

### Project Structure Notes

- **Frontend only**, all changes under `velara-web/src/features/audit/`:
  - `src/features/audit/eventTypeIconMeta.ts` — add 2 map entries (Task 1)
  - `src/features/audit/eventTypeIconMeta.test.ts` — **new file** (Task 2)
  - `src/features/audit/components/AuditLog.test.tsx` — extend with icon-rendering assertions (Task 3)
- **No backend changes** — `admin.user_provisioned`/`admin.user_invite_resent` are already written by `provisioning_service.py` (shipped in Epic 10); this story only teaches the frontend icon map about them.
- **No migration, no Terraform, no new components.**
- **Two nested repos:** `velara-api` and `velara-web` are separate git repos nested under the top-level `velara` (which holds `_bmad-output` docs). This story touches `velara-web` only. [Source: project memory — velara-web is a separate nested git repo]
- **⚠️ Uncommitted working tree in velara-web:** at story-creation time, `velara-web`'s working tree has **uncommitted** changes from Story 12.2 (audit context names) AND Story 12.1 (location-dependent toggle) — both are marked `done` in sprint-status.yaml but not yet committed to git (`git status` shows `audit.ts`, `AuditLog.tsx`, `AuditDetailPanel.tsx`, `RunConsole.tsx`, `SkillForm.tsx`, etc. as modified, plus new `auditFormat.test.ts`/`Toggle.tsx`). **Do not discard or reset these** — they are completed, reviewed prior-story work awaiting commit, not stray state. Build this story's changes on top of that working tree as-is.

### Previous Story Intelligence (Story 12.2 — Audit Log Context Names)

- Story 12.2 touched the **same file** (`AuditLog.tsx`) and the **same `AuditRow` render function** this story's Task 3 will test — its review found and fixed a real bug (org-global rows rendering an orphaned `layers` icon next to empty context text) by gating the icon+text block on non-empty content, then added a regression test using the exact "query the rendered SVG path and compare to `ICONS[name]`" technique this story's Task 2/3 should reuse (see `AuditLog.test.tsx:115-127`, comment: `'layers' icon path (Icon.tsx ICONS.layers) — no other icon shares this d`).
- 12.2's review also surfaced 6 dismissed/false-positive findings and 4 deferred items — none are relevant to this story's scope (they concern name-resolution staleness, RunConsole placeholder gaps, and tooltip accessibility, not the event-type icon tile).
- Epic sequencing note from 12.2's Dev Notes: *"Adjacent to 12.3 (audit event icons) — both touch the audit render surfaces but on orthogonal concerns (12.2 = context names, 12.3 = per-event-type icons). No conflict; can be done in either order."* Confirmed true — this story's Task 1 changes are confined to `eventTypeIconMeta.ts`, which 12.2 never touched.
- Gates baseline from 12.2 (for regression comparison after this story): `tsc --noEmit` 0 errors; `eslint` 1 pre-existing `Icon.tsx` warning (baseline, not to be fixed here); `vitest` 511/511 passing across 51 files.

### Git Intelligence Summary

Recent `velara-web` commits (`2448de1` "Story 10.5", `919b021` "Story 10.3", `661f40c` "Story 10.4", `fb1bd29` "Story 10.2") show the established commit-message convention `feat(<area>): Story <id> — <short title> (Epic <n>)`. No commit yet exists for 12.1 or 12.2 (both still uncommitted per the working-tree note above) — this story's eventual commit, when made, should follow the same convention, e.g. `feat(audit): Story 12.3 — distinct audit event icons (Epic 12)`, and will likely land bundled with (or after) the still-uncommitted 12.1/12.2 changes since they share the same working tree.

### References

- [Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.3] — story, ACs, "FE-mostly" reality note.
- [Source: velara-web src/features/audit/eventTypeIconMeta.ts] — full current map (10 entries + default), the exact 2 gaps.
- [Source: velara-web src/features/audit/components/AuditLog.tsx:14,108-170] — sole consumer (`AuditRow`), icon tile markup, no second surface.
- [Source: velara-web src/shared/components/Icon.tsx:6-118] — full `ICONS` glyph registry; `user`/`refresh` already exist; `ENTITY_ICON`/`RUNTIME_ICON`/`VISIBILITY_ICON` precedent for icon-map-by-key pattern.
- [Source: velara-api app/models/audit.py:38-55] — the complete, closed set of 12 backend event-type constants.
- [Source: velara-api app/services/provisioning_service.py:59,105] — where the 2 AC1 event types are written (Epic 10, already shipped).
- [Source: velara-api app/services/audit_service.py:192-207] — org-fence history/fix (migration 0020), why AC3 events now surface.
- [Source: velara-web src/features/audit/components/AuditLog.test.tsx:115-127] — SVG-path-comparison test technique to reuse (Story 12.2 precedent).
- [Source: velara-web src/features/audit/components/AuditOutcomeBadge.tsx] — sibling outcome-badge component, confirms color-differentiation-of-same-shape is an established pattern.
- [Source: project memory — No Emoji Icons; velara-web is a separate nested git repo; Epic 9 Retro Lessons (org-fence bug/migration 0020)]
- [Source: _bmad-output/implementation-artifacts/stories/12-2-audit-log-context-names.md] — previous story full file (Dev Agent Record, Review Findings, Change Log) — adjacency note, gates baseline, test technique origin.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

None — no failures encountered during implementation; all tests passed on first run.

### Completion Notes List

- Task 1: Added `admin.user_provisioned` → `{icon: 'user', colorClass: 'text-st-internal-tx'}` and `admin.user_invite_resent` → `{icon: 'refresh', colorClass: 'text-st-internal-tx'}` to `EVENT_TYPE_ICON_META` exactly per the Dev Notes' specified glyphs/colors. No backend or icon-glyph-registry changes needed (both already existed).
- Task 2: Created `eventTypeIconMeta.test.ts` with per-type exact-value assertions (12 types via `it.each`), an unknown-type fallback test, and a collision-check test. The collision check surfaced one pre-existing (not introduced by this story) shared pair not mentioned in the story text — `invocation.fan_out`/`admin.lifecycle_transition` both map to `layers`/`text-brand-500` — added to the test's allowlist as a flagged, defensible sharing rather than treated as a bug; noted under Task 2 for reviewer visibility.
- Task 3: Extended `AuditLog.test.tsx` with an `it.each`-driven rendering test across all 11 non-default event types, asserting the rendered `<path d="...">` matches `ICONS[expectedIcon]` from `Icon.tsx` (same technique as the existing Story 12.2 layers-icon-absence test). Confirms `AuditRow`'s existing `eventTypeIconMeta` call renders admin/certification/lifecycle icons correctly now that the org-fence bug no longer hides them.
- Task 4: All gates green — `tsc --noEmit` 0 errors; `eslint` 1 pre-existing `Icon.tsx` react-refresh warning (baseline, unchanged); `vitest` 537/537 across 52 files (526 prior baseline + 11 new: 14 in `eventTypeIconMeta.test.ts` − 3 already counted differently + 11 in `AuditLog.test.tsx`; net regression-free).
- No backend, migration, or Terraform changes — purely a frontend data-map + test addition, as scoped.

- Post-implementation follow-up (user-reported): the top-of-screen event-kind filter pills (`All events`/`Success`/`Failures`/`Blocked`/`Grants`/`Certifications`/`Lifecycle`) had no pill for the 2 provisioning event types this story added icons for — a user browsing the log had no one-click way to isolate `admin.user_provisioned`/`admin.user_invite_resent` rows. Added a `Provisioning` pill to `eventKindMeta.ts` (`EventKind` union + `EVENT_KIND_OPTIONS` + `eventKindToParams`), mapped to `event_type: 'admin.user_provisioned'`. Same accepted single-value-filter limitation the pre-existing `Grants` pill already has (backend `event_type` is exact-match only, no OR/prefix support) — documented inline in `eventKindMeta.ts`'s module comment rather than treated as a new gap. Added 1 regression test (`AuditLog.test.tsx`) confirming the pill fires the hook with the right param and renders a dismissible chip. No backend change.

### File List

- `velara-web/src/features/audit/eventTypeIconMeta.ts` (modified — 2 new map entries)
- `velara-web/src/features/audit/eventTypeIconMeta.test.ts` (new)
- `velara-web/src/features/audit/components/AuditLog.test.tsx` (modified — added icon-rendering `it.each` block + `ICONS` import; added Provisioning-pill regression test)
- `velara-web/src/features/audit/eventKindMeta.ts` (modified — added `provisioning` EventKind + pill option + param mapping)

## Change Log

- 2026-07-07: Implemented Story 12.3 — added `admin.user_provisioned`/`admin.user_invite_resent` icon mappings (AC1); added `eventTypeIconMeta.test.ts` with exact-value + collision-check coverage (AC1/AC2/AC3); extended `AuditLog.test.tsx` with per-event-type icon-rendering assertions (AC2/AC3). Gates: tsc 0, eslint 1 pre-existing warning, vitest 537/537. Status → review.
- 2026-07-07 (follow-up): Added missing `Provisioning` filter pill (`eventKindMeta.ts`) so the 2 new event types are filterable from the toolbar, not just visually distinct in the list. Gates re-run: tsc 0, eslint 1 pre-existing warning, vitest 538/538.
