---
baseline_commit: 6c5eab0
---

# Story 12.2: Audit Log Context Names (Backend-Enriched)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a consultant reviewing the audit log,
I want Client/Project/Study/Location shown by **name**, not raw UUIDs,
so that the audit trail is human-readable.

## Acceptance Criteria

1. **AC1 — Server resolves the path to entity names, in one place, consumed by list + detail + fan-out children.**
   **Given** an audit entry with an ltree `hierarchy_path` of UUID segments
   **When** the audit query API (`GET /api/v1/audit`) returns it
   **Then** each hierarchy segment is resolved to its entity name **server-side** and returned **alongside** the raw `hierarchy_path` (the raw path is preserved, not replaced). The same enriched response feeds the list rows, the detail panel, **and** the fan-out children (which are just more audit rows fetched via `?parent_invocation_id=`), so resolution lives in exactly one place.

2. **AC2 — Graceful fallback for deleted / unresolvable segments.**
   **Given** a deleted or unknown entity id in the path (a segment whose UUID no longer exists in its table), **or** the org-root segment (which is not a per-entity UUID)
   **When** names are resolved
   **Then** a graceful fallback renders (e.g. `(deleted study)`) — never a crash, never a blank, never a leaked raw UUID. The org root segment is **omitted** from the displayed name chain (matching today's `prettifyPath` / breadcrumb convention that never shows the org root).

3. **AC3 — Audit list, detail panel, and fan-out children render names.**
   **Given** the three audit render surfaces — the list row context line, the detail panel "Hierarchy path" field, and the detail panel fan-out "Locations" children
   **When** they render an entry
   **Then** each shows the resolved name chain (e.g. `Acme Health › CTMS Migration › Phase II › Boston Site`), not the raw dot-joined UUID path. The raw path remains available (e.g. as a `title`/tooltip) for debugging, but is not the primary display.

4. **AC4 — Run Console live context panel shows names, not the raw ltree path.**
   **Given** the Run Console Job Status panel's "Context" line
   **When** it displays the run context for a completed job
   **Then** it shows entity names, not `job.hierarchy_path.replace(/\./g, ' › ')` on raw UUID segments. (The Run Console already loads Client/Project/Study names via `useProjectContext`/`useStudyContext` and renders them in `LockedContextPanel` — this AC removes the redundant raw-UUID line and shows names instead.)

5. **AC5 — No regression; org isolation and existing response contract preserved.**
   **Given** the existing audit query behavior (org fence by `org_id` column, scope filtering, pagination envelope, `skill_name`/`metadata` keys)
   **When** the enrichment is added
   **Then** none of it changes — the new field is **additive**; org-global (`"org"`) and admin rows return an empty/omitted name chain without error; `docs/api-spec.json` is regenerated to include the new field; all existing tests pass.

## Tasks / Subtasks

### Backend — `velara-api` (resolution + schema)

- [ ] **Task 1 — Add a batched path→names resolver in `hierarchy_service` (AC1, AC2, AC5)**
  - [ ] Add a new function to [hierarchy_service.py](../../../velara-api/app/services/hierarchy_service.py) — e.g. `async def resolve_hierarchy_names(session: AsyncSession, hierarchy_paths: list[str]) -> dict[str, list[HierarchySegmentName]]`. It takes the **distinct** set of raw ltree paths across the whole page and returns, per path, an ordered list of resolved segment names.
  - [ ] **Parse each path** by splitting on `.`; for each segment, split on the **first** `_` into `(prefix, hex)`. Prefixes are exactly `org | client | project | study | location` (see Dev Notes §Segment format). The `org_...` root is **not** a UUID — skip it (do not attempt a lookup; it is never displayed). For `client|project|study|location`, `hex` is a 32-char hyphen-stripped UUID → **reinsert dashes** (`8-4-4-4-12`) to reconstruct `uuid.UUID`. Guard against malformed segments (wrong length, non-hex) → treat as unresolvable (fallback), never raise.
  - [ ] **Batch-resolve, one query per level** — mirror [access_service.py:201-222](../../../velara-api/app/services/access_service.py#L201-L222) exactly: group ids by node_type, then `select(Model.id, Model.name).where(Model.id.in_(ids))` per table using the `_MODELS = {"client": Client, "project": Project, "study": Study, "location": Location}` dict, building an `{id: name}` map. **Do NOT** do an N+1 per-segment `get_*` call (there can be up to `per_page`×4 segments; the access_service pattern exists specifically to avoid that storm — comment at [access_service.py:172-177](../../../velara-api/app/services/access_service.py#L172-L177)).
  - [ ] For each segment, produce `{ node_type: "client|project|study|location", name: <resolved name or None> }`. A `None` name means "unresolvable" → the FE renders the `(deleted <type>)` fallback (AC2). **Do not** substitute the raw UUID.
  - [ ] Define the segment shape as a small Pydantic model in [app/schemas/audit.py](../../../velara-api/app/schemas/audit.py) — e.g. `class HierarchySegmentName(BaseModel): node_type: str; name: str | None`. (Keep it in the audit schema module since that is where it is consumed; do not create a new file.)

- [ ] **Task 2 — Add the resolved field to `AuditRead` (AC1, AC5)**
  - [ ] In [audit.py schema](../../../velara-api/app/schemas/audit.py#L13-L47), add a field alongside `hierarchy_path` and `skill_name`: `context_names: list[HierarchySegmentName] = Field(default_factory=list)`. **Additive only** — do **not** remove or rename `hierarchy_path` (the raw path stays; AC1/AC3 keep it as a tooltip). Default empty list so org-global/admin rows serialize cleanly (AC5).
  - [ ] Field name is `context_names` (snake_case JSON key, no alias — matches the house convention; the FE reads the JSON key verbatim). [Source: architecture/implementation-patterns-consistency-rules.md — JSON fields snake_case]

- [ ] **Task 3 — Enrich the response in the router (AC1)**
  - [ ] In [audit.py router](../../../velara-api/app/api/v1/audit.py#L143-L149), extend the existing `model_copy(update=...)` assembly. **Collect the distinct `hierarchy_path`s from `rows` once**, call `resolve_hierarchy_names(session, distinct_paths)` a **single** time (one batched resolution for the whole page — not per row), then patch each item: `.model_copy(update={"skill_name": skill_name, "context_names": names_by_path.get(str(entry.hierarchy_path), [])})`. This keeps resolution in one place feeding list, detail, and fan-out children (all three consume `AuditRead`). Do **not** push resolution into `list_entries`' query — the batched post-step is simpler and mirrors how `skill_name` is already patched.
  - [ ] The `session` is already in scope in the handler (it is a `DbSession` dep). Pass it to the resolver.

- [ ] **Task 4 — Backend tests (AC1, AC2, AC5)**
  - [ ] In [test_audit_service.py](../../../velara-api/tests/integration/services/test_audit_service.py) (the 9.2 GET-route block, ~lines 598-1194): add a test that seeds a real client→project→study (or reuse `_create_client_node`) node, records an invocation entry on that path, and asserts the response item's `context_names` is an ordered list of `{node_type, name}` with the **real names** (not UUIDs), and that the raw `hierarchy_path` is still present (AC1). Assert response-shape block near [lines 1083-1113](../../../velara-api/tests/integration/services/test_audit_service.py#L1083-L1113) style.
  - [ ] Add an AC2 test: an entry whose path references a **deleted** entity id (seed a path segment for an id not in the table, or delete the node after) → the matching segment's `name` is `None` (FE renders `(deleted ...)`); no 500.
  - [ ] Add an AC5 test: an **admin** event (path `"org"`) and an org-global invocation → `context_names == []`, no error. (Mirror the existing admin-null-skill_name test at [lines 1116-1133](../../../velara-api/tests/integration/services/test_audit_service.py#L1116-L1133).)
  - [ ] Respect the Postgres guard: these live under the module's `pytest.mark.skipif(not _PG_AVAILABLE)` ([test_audit_service.py:45-69](../../../velara-api/tests/integration/services/test_audit_service.py#L45-L69)). Run with a reachable test Postgres (see Testing standards).

- [ ] **Task 5 — Regenerate the OpenAPI spec (AC5)**
  - [ ] Run `python scripts/export_openapi.py` from `velara-api/` → rewrites [docs/api-spec.json](../../../velara-api/docs/api-spec.json) (deterministic, sorted). Commit the diff. **The `openapi` CI job `git diff --exit-code`s this file — a stale spec fails the build** ([scripts/export_openapi.py:8-10](../../../velara-api/scripts/export_openapi.py#L8-L10)). No Postgres/Redis needed to run it.

### Frontend — `velara-web` (render names on 4 surfaces)

- [ ] **Task 6 — Add `context_names` to the audit wire type (AC1, AC3)**
  - [ ] In [src/api/audit.ts](../../../velara-web/src/api/audit.ts#L15-L33), add to `AuditEntry`: `context_names: HierarchySegmentName[]` where `interface HierarchySegmentName { node_type: string; name: string | null }`. Field name matches the backend JSON key verbatim (`context_names`). Do **not** remove `hierarchy_path` — keep it for the tooltip.

- [ ] **Task 7 — Render names in the three audit surfaces (AC2, AC3)**
  - [ ] Add a small display helper — e.g. `formatContextNames(segments)` in [auditFormat.ts](../../../velara-web/src/features/audit/auditFormat.ts) — that maps each segment to its `name`, applying the `(deleted <node_type>)` fallback when `name` is `null` (mirror the analytics `?? '(deleted skill)'` pattern at [OverviewTab.tsx:93](../../../velara-web/src/features/analytics/components/OverviewTab.tsx#L93)), and joins with ` › `. Return `''`/`—` for an empty list (org-global rows). **`prettifyPath` is now superseded for display** — you may keep it or route through the new helper; do not leave two competing formatters wired to the same surface.
  - [ ] **Surface A — list row** [AuditLog.tsx:151-156](../../../velara-web/src/features/audit/components/AuditLog.tsx#L151-L156): render `formatContextNames(entry.context_names)` instead of `prettifyPath(entry.hierarchy_path)`. Keep the raw path as the `title` tooltip (`title={entry.hierarchy_path}`). Keep the `<Icon name="layers" .../>`.
  - [ ] **Surface B — detail panel "Hierarchy path" field** [AuditDetailPanel.tsx:60-65](../../../velara-web/src/features/audit/components/AuditDetailPanel.tsx#L60-L65): render the name chain; keep raw path as tooltip. Consider relabeling "Hierarchy path" → "Context" for humans (optional — confirm with the mock; not required by an AC).
  - [ ] **Surface C — fan-out children** [AuditDetailPanel.tsx:126-135](../../../velara-web/src/features/audit/components/AuditDetailPanel.tsx#L126-L135): render each `child`'s resolved names (the child rows carry their own `context_names` — they are full `AuditEntry` rows from `useAuditChildren`). Each child's leaf is its Location, so the name chain naturally ends in the location name.
  - [ ] **Optional reuse:** the existing [Breadcrumb / Crumb](../../../velara-web/src/features/engagements/components/Breadcrumb.tsx) component renders a `Client › Project › Study` trail with chevrons and never shows the org root — reuse it for a richer chip trail if it fits the audit row density, or keep the plain ` › ` string join. Either is acceptable; do not build a third path component.

- [ ] **Task 8 — Fix the Run Console context line (AC4)**
  - [ ] In [RunConsole.tsx:885-890](../../../velara-web/src/features/run/components/RunConsole.tsx#L885-L890), the "Context" line does `job.hierarchy_path.replace(/\./g, ' › ')` on raw UUIDs. RunConsole **already** has resolved names in scope: `clientName`/`projectName`/`studyName` from `useProjectContext`/`useStudyContext` ([RunConsole.tsx:339-350](../../../velara-web/src/features/run/components/RunConsole.tsx#L339-L350)) and already renders them in `LockedContextPanel` ([RunConsole.tsx:66-114](../../../velara-web/src/features/run/components/RunConsole.tsx#L66-L114)).
  - [ ] Replace the raw-path line with a name chain built from those already-loaded names (`[clientName, projectName, studyName].filter(Boolean).join(' › ')`), OR remove the redundant line entirely if `LockedContextPanel` already conveys the same context in that view. **Do not** add a backend dependency here — this is the `job` (a `JobReadWithResult`), not an audit entry; it does not carry `context_names`. Keep the `!== 'org'` guard so org-global runs show nothing.

- [ ] **Task 9 — Frontend tests (AC2, AC3, AC5)**
  - [ ] Update the fan-out children assertions in [AuditLog.test.tsx:229-241](../../../velara-web/src/features/audit/components/AuditLog.test.tsx#L229-L241): they currently `getByText('org_org_vitalief.client_abc.loc_1')` on the **raw** child path. Add `context_names` to the child fixtures and assert the rendered **names** instead. **This is the one existing assertion that breaks** — the list row (Surface A) and detail core field (Surface B) have no raw-path string assertion today.
  - [ ] Add fixtures with `context_names` to `makeEntry` in both [audit.test.ts](../../../velara-web/src/api/audit.test.ts#L13-L34) and [AuditLog.test.tsx](../../../velara-web/src/features/audit/components/AuditLog.test.tsx#L68-L89) so the new field is present (empty list is a valid default for org rows).
  - [ ] Add an AC2 test: a segment with `name: null` renders `(deleted <node_type>)`.
  - [ ] RunConsole (AC4): the RunConsole test asserts `LockedContextPanel` names, **not** the raw `.replace(...)` line ([RunConsole.test.tsx](../../../velara-web/src/features/run/components/RunConsole.test.tsx) — grep-confirmed no assertion on the raw line), so removing/replacing that line has no existing test to update; optionally add a positive assertion that the context line shows a name.

- [ ] **Task 10 — Gates**
  - [ ] **Backend:** `ruff check .` clean; `pytest tests/integration/services/test_audit_service.py` (+ full suite) green against a reachable test Postgres; `python scripts/export_openapi.py` produces a committed, in-sync `docs/api-spec.json`.
  - [ ] **Frontend:** `tsc --noEmit` → 0 errors; `eslint src --ext .ts,.tsx` clean (the single pre-existing `Icon.tsx` react-refresh warning is the known baseline — not introduced here); `vitest run` → all pass (only the `AuditLog.test.tsx` child-path assertions change).

## Dev Notes

### Scope reality — thin BE (resolution) + FE (render across 4 surfaces)

The write-path "always org" bug was **already fixed 2026-07-02** (context now resolves most-specific-first). The **remaining** gap this story closes: the audit surface renders the **raw ltree path of UUID segments** because **no UUID→name resolution exists anywhere** — the query API resolves `skill_name` but never joins hierarchy entity names, and all three FE audit surfaces plus the Run Console context line print raw UUIDs. Backend adds one batched resolver + one additive response field; frontend consumes it on 3 audit surfaces and reuses already-loaded names on the 4th (Run Console).
[Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.2; sprint-change-proposal-2026-07-06.md §G3 / Story-12.2 / §USE-07]

### The ltree segment format — the parsing contract (VERIFIED)

Authoritative source: [hierarchy.py module docstring, lines 8-14](../../../velara-api/app/models/hierarchy.py#L8-L14). Segment builder [hierarchy_service.py:100-102](../../../velara-api/app/services/hierarchy_service.py#L100-L102):

```
org_{org_id_sanitized}.client_{uuid32}.project_{uuid32}.study_{uuid32}.location_{uuid32}
```

- Segments are **dot-separated** (`.`). Within a segment, prefix and value are joined by a **single `_`**; split on the **first** `_` only.
- The UUID in `client|project|study|location` segments is **hyphen-stripped** (`str(uuid).replace('-', '')` → 32 lowercase hex chars). To look it up: reinsert dashes at positions 8-4-4-4-12 and build a `uuid.UUID`.
- The **root `org_...` segment is NOT a UUID** — it is the JWT `org_id` string with illegal chars → `_` ([_org_segment, hierarchy_service.py:109-119](../../../velara-api/app/services/hierarchy_service.py#L109-L119)). E.g. `org_id="org_vitalief"` → root `org_org_vitalief`. It has no per-entity name (`Organization` is internal-only, never API-exposed — [hierarchy.py:29](../../../velara-api/app/models/hierarchy.py#L29)). **Skip it in resolution; never display it** (matches `prettifyPath` / `Breadcrumb`, which both drop the org root).
- **Variable depth:** a path may have 0 hierarchy segments (bare `"org"` sentinel for admin/org-global events), or 1–4 (client only … through location). Fan-out **parent** entries carry the **study** path (no location); fan-out **child** entries carry the full **location** path. Handle any depth without assuming 4.
- Tests use synthetic non-UUID segments like `client_abc` / `project_x` — real rows use 32-hex. Your parser must reconstruct real UUIDs from 32-hex; a malformed/short segment (like a test's `client_abc`) simply won't resolve → `name: None` → fallback. That's fine and testable.
[Source: hierarchy.py:8-14; hierarchy_service.py:100-119, 180, 271-273, 376, 488-490; verified by subagent against velara-api]

### Hierarchy data model — separate tables, `name` column, batched lookup (VERIFIED)

**Separate per-level tables** (NOT a unified `hierarchy_nodes` table). Each has `id` (uuid PK) + `name: String(255)` + `hierarchy_path`:
- `Client` [hierarchy.py:56](../../../velara-api/app/models/hierarchy.py#L56) — `name` at :64
- `Project` [hierarchy.py:83](../../../velara-api/app/models/hierarchy.py#L83) — `name` at :94
- `Study` [hierarchy.py:113](../../../velara-api/app/models/hierarchy.py#L113) — `name` at :124
- `Location` [hierarchy.py:143](../../../velara-api/app/models/hierarchy.py#L143) — `name` at :154

The name column is **`name`** everywhere (never `title`/`label`).

**Batched fetch-by-ids — copy this pattern exactly** ([access_service.py:201-222](../../../velara-api/app/services/access_service.py#L201-L222)):
```python
_MODELS = {"client": Client, "project": Project, "study": Study, "location": Location}
# group ids by node_type, then one query per level:
model = _MODELS[node_type]
rows = (await session.execute(
    select(model.id, model.name).where(model.id.in_(ids)))).all()
found = {row.id: row.name for row in rows}
```
Session pattern: services take `session: AsyncSession` as the first param; `await session.execute(stmt)` then `.all()`. [Source: db/session.py:27-47; access_service.py:201-222]

### Where resolution lands — router post-step, one batched call per page

The router already patches `skill_name` via `model_copy(update=...)` over `rows` (a list of `(AuditLogEntry, skill_name)` tuples) at [audit.py:143-146](../../../velara-api/app/api/v1/audit.py#L143-L146). Add the name enrichment **there**, not inside `list_entries`' SQL:
1. Collect the **distinct** `str(entry.hierarchy_path)` across the page.
2. Call `resolve_hierarchy_names(session, distinct_paths)` **once** → `{path: [segments]}`.
3. `.model_copy(update={"skill_name": skill_name, "context_names": names_by_path.get(str(entry.hierarchy_path), [])})`.

This keeps resolution in **one place** feeding list + detail + fan-out children (all three are `AuditRead` rows — the detail panel reuses the row object already in hand; children are separate `?parent_invocation_id=` rows that also go through this same handler). One batched resolution per page = at most 4 SQL queries regardless of page size. [Source: audit.py:75-149; audit_service.py:170-257]

### Org fence stays on the `org_id` column — do NOT touch it

`audit_log_entries.org_id` exists (migration 0020) and `list_entries` fences on it directly ([audit.py:108](../../../velara-api/app/models/audit.py#L108); [audit_service.py:220](../../../velara-api/app/services/audit_service.py#L220)). The service explicitly warns against reintroducing a hierarchy_path-based org fence ([audit_service.py:192-200](../../../velara-api/app/services/audit_service.py#L192-L200)). Resolution is a **display** concern layered on top of the already-scoped rows — it must **not** alter the query, the fence, or which rows are returned. Resolve only the paths the (already org-fenced) query returned. [Source: audit.py:108-116; audit_service.py:192-200]

### The `AuditRead` alias precedent — mirror it for the new field

`metadata` uses `validation_alias="event_metadata"` so the ORM attr is read but the JSON key stays `metadata` ([audit.py schema:16-23, 46](../../../velara-api/app/schemas/audit.py#L16-L46)). `context_names` needs **no** alias — it is a computed field patched via `model_copy` (like `skill_name`), not an ORM column. Just declare `context_names: list[HierarchySegmentName] = Field(default_factory=list)` and default it empty so admin/org rows serialize cleanly. Config is already `from_attributes=True, populate_by_name=True`. [Source: audit.py schema:13-47]

### FE render surfaces — the four targets (VERIFIED)

| # | Surface | File:line | Today |
|---|---------|-----------|-------|
| A | Audit list row context | [AuditLog.tsx:151-156](../../../velara-web/src/features/audit/components/AuditLog.tsx#L151-L156) | `prettifyPath(entry.hierarchy_path)` (strips org root only, raw UUIDs) |
| B | Audit detail "Hierarchy path" field | [AuditDetailPanel.tsx:60-65](../../../velara-web/src/features/audit/components/AuditDetailPanel.tsx#L60-L65) | raw `entry.hierarchy_path` |
| C | Audit detail fan-out children ("Locations") | [AuditDetailPanel.tsx:126-135](../../../velara-web/src/features/audit/components/AuditDetailPanel.tsx#L126-L135) | raw `child.hierarchy_path` |
| D | Run Console context line | [RunConsole.tsx:885-890](../../../velara-web/src/features/run/components/RunConsole.tsx#L885-L890) | `job.hierarchy_path.replace(/\./g,' › ')` |

- The audit wire type + `.data.data` unwrap: [src/api/audit.ts](../../../velara-web/src/api/audit.ts#L15-L56). There is **no GET-by-id** — the detail panel reuses the in-hand row; children come from `useAuditChildren(parentJobId)` ([useAudit.ts:20-27](../../../velara-web/src/features/audit/hooks/useAudit.ts#L20-L27)) as separate rows. So A, B, C **all** consume the same enriched `AuditEntry` — no extra fetch needed.
- **Surface D is self-contained on the FE** — RunConsole already resolves and displays names (`LockedContextPanel`, `clientName`/`projectName`/`studyName`). The raw `.replace()` line is a redundant duplicate; fix it with names already in scope, **no backend field needed** (the `job` object is a `JobReadWithResult`, not an `AuditEntry`). [Source: RunConsole.tsx:66-114, 339-350, 885-890]

### Graceful-fallback convention — mirror analytics `?? '(deleted skill)'`

Analytics already renders `{s.name ?? '(deleted skill)'}` ([OverviewTab.tsx:93](../../../velara-web/src/features/analytics/components/OverviewTab.tsx#L93), [ByUserTab.tsx:60](../../../velara-web/src/features/analytics/components/ByUserTab.tsx#L60); asserted in `AnalyticsScreen.test.tsx:145-152`). Use the same shape for an unresolvable segment: `segment.name ?? \`(deleted ${segment.node_type})\``. The audit row already null-coalesces `skill_name ?? event_type` and `userNameById.get(user_id) ?? user_id` — same house pattern. [Source: analytics components; AuditLog.tsx:139,497]

### UI convention constraints (house rules)

- **No emoji / unicode icons.** Use `<Icon name="..." />` from [Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx). The audit row already uses `<Icon name="layers" size={11} .../>` beside the path — keep it. The ` › ` chevron in a plain string join is a text separator, not an icon (acceptable; it's the same char `prettifyPath`/`Breadcrumb` context already uses). [Source: project memory — No Emoji Icons rule]
- **Tailwind-v4 tokens** on these surfaces: `text-ink`, `text-ink-2`, `text-muted`, `text-faint`, `bg-surface`/`-2`, `border-line`, `brand-700`/`-800`. The path spans use `font-mono text-faint` today — resolved **names** read better in the normal font; drop `font-mono` for the name chain (keep it only if you still show the raw UUID as a secondary line/tooltip). Do not hardcode colors. [Source: subagent FE report; Tailwind-v4 tokens]
- **Reuse, don't rebuild:** the [Breadcrumb/Crumb](../../../velara-web/src/features/engagements/components/Breadcrumb.tsx) component already renders `Client › Project › Study` and drops the org root — reuse it if it fits, else a plain ` › ` join. Do **not** add a third path-display component. [Source: subagent FE report]

### Testing standards

- **Backend:** integration tests in [tests/integration/services/test_audit_service.py](../../../velara-api/tests/integration/services/test_audit_service.py) (single file covers both 9.1 service + 9.2 route). Module is guarded by `pytest.mark.skipif(not _PG_AVAILABLE)` — a reachable test Postgres is required (`DATABASE_URL` default `postgresql+asyncpg://velara:velara@postgres:5432/velara_test`; `REQUIRE_POSTGRES=1` turns silent skips into failures in CI). Reuse `_create_client_node` / `_seed_invocation_entry*` fixtures. [Source: test_audit_service.py:45-69, 615-704; conftest.py:64-103]
- **Frontend:** Vitest + Testing Library, co-located `*.test.tsx`. Mock the audit hooks and the `apiClient`; the `.data.data` double-envelope is exercised by [audit.test.ts:36-56](../../../velara-web/src/api/audit.test.ts#L36-L56). Only [AuditLog.test.tsx:229-241](../../../velara-web/src/features/audit/components/AuditLog.test.tsx#L229-L241) has raw-path string assertions to update. [Source: architecture — co-located tests; subagent FE report]
- Assert BE response shape by JSON keys (`context_names` is a list of `{node_type, name}`); assert FE rendered **names**, with a `(deleted ...)` case for `name: null`.

### Project Structure Notes

- **Backend** changes: [app/services/hierarchy_service.py](../../../velara-api/app/services/hierarchy_service.py) (new resolver), [app/schemas/audit.py](../../../velara-api/app/schemas/audit.py) (new segment model + field), [app/api/v1/audit.py](../../../velara-api/app/api/v1/audit.py) (router enrichment), [docs/api-spec.json](../../../velara-api/docs/api-spec.json) (regenerated), tests. **No migration** (read-side resolution only; no schema change to any table). No new files needed — extend existing modules.
- **Frontend** changes under [src/features/audit/](../../../velara-web/src/features/audit/) + [src/api/audit.ts](../../../velara-web/src/api/audit.ts) + [src/features/run/components/RunConsole.tsx](../../../velara-web/src/features/run/components/RunConsole.tsx). Consistent with one-directory-per-domain. No new components required (reuse Breadcrumb or a string join).
- **Two nested repos:** `velara-api` and `velara-web` are **separate git repos** nested under the top-level `velara` (which holds `_bmad-output` docs). Commits to each land in their own repo. [Source: project memory — velara-web is a separate nested git repo]

### Sequencing / dependencies

- **Second story of Epic 12** (epic already `in-progress` from 12.1). Independent of Epic 11. Suggested order 12.1 (done) → **12.2 (this)** → 12.3 → 12.4. [Source: epics/epic-12…md]
- **Builds on** Story 9.2 (audit query API) and the 2026-07-02 write-path context fix — both shipped. This story is purely additive read-side enrichment. [Source: sprint-status.yaml history; project memory — Epic 9]
- **Adjacent to 12.3** (audit event icons) — both touch the audit render surfaces but on orthogonal concerns (12.2 = context names, 12.3 = per-event-type icons). No conflict; can be done in either order.

### References

- [Source: epics/epic-12-skill-and-audit-lifecycle-polish.md#Story-12.2] — story, ACs, "thin BE (resolution) + FE (render)" reality note.
- [Source: planning-artifacts/sprint-change-proposal-2026-07-06.md §G3 / Story-12.2 / §USE-07] — root cause (query API resolves skill_name but not hierarchy names; raw UUID path everywhere) + USE-07 FR.
- [Source: architecture/implementation-patterns-consistency-rules.md] — snake_case JSON fields, co-located tests, feature-folder structure.
- [Source: velara-api app/models/hierarchy.py:8-14,28-174 / app/services/hierarchy_service.py:100-119 / app/services/access_service.py:201-222 / app/schemas/audit.py:13-54 / app/api/v1/audit.py:75-149 / app/services/audit_service.py:170-257 / app/models/audit.py:108-116 / scripts/export_openapi.py] — verified segment format, hierarchy models, batched-lookup pattern, resolution insertion point, org-fence, spec regeneration.
- [Source: velara-web src/api/audit.ts / src/features/audit/components/AuditLog.tsx:151-156 / AuditDetailPanel.tsx:60-65,126-135 / auditFormat.ts:63-72 / hooks/useAudit.ts / src/features/run/components/RunConsole.tsx:66-114,339-350,885-890 / src/features/engagements/components/Breadcrumb.tsx / src/features/analytics/components/OverviewTab.tsx:93] — the 4 render surfaces, wire type, prettifyPath (superseded), Breadcrumb reuse, deleted-fallback pattern.
- [Source: project memory] — No Emoji Icons (use `<Icon>`); velara-web is a separate nested git repo; Epic 9 audit write/read path.

## Dev Agent Record

### Agent Model Used

<!-- to be filled by dev agent -->

### Debug Log References

### Completion Notes List

### File List
