---
baseline_commit: e34fec9e01f61c55287a6bf695d14403ab325329
---

# Story 9.2: Audit Log Query API

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant or operator,
I want to query the audit log with filters for hierarchy path, user, skill, time window, and outcome,
so that I can investigate any invocation history or compliance question without direct database access.

## Acceptance Criteria

1. **Scoped default list.** Given I call `GET /api/v1/audit` with no filters, when the response is returned, then I see audit entries **within my hierarchy scope** — entries outside my granted scope are excluded by the `HierarchyScope` dependency. Internal roles (`ma_tech`/`consultant`/`admin`) are unrestricted and see all org entries; a client-scoped token is **404'd** by `RejectClient` (this is an internal-only surface, mirroring `/jobs`, `/certifications`).

2. **Compound filters (client + skill).** Given I call `GET /api/v1/audit?client_id={id}&skill_id={id}`, when the query runs, then only entries whose `hierarchy_path` is descendant-or-self of that client's path **AND** whose `skill_id` matches are returned. `client_id` resolves to its ltree path via `hierarchy_service.get_client` (cross-org `client_id` → 404, same tenancy convention as everywhere else).

3. **Time window + partition pruning.** Given I call `GET /api/v1/audit?from=2026-01-01&to=2026-06-30`, when the query runs, then only entries with `created_at` in `[from, to]` are returned; the query is expressed so PostgreSQL uses **partition pruning** on `created_at` (monthly partitions from 0018) and the **GiST ltree index** for the scope filter (see Task 1 — this story adds the missing GiST index). `from`/`to` are UTC dates or datetimes; a `from` with no time = start-of-day UTC, a `to` with no time = end-of-day UTC (inclusive) — document and test the boundary.

4. **Outcome filter.** Given I call `GET /api/v1/audit?outcome=failed`, when the query runs, then only entries with `outcome="failure"` are returned. ⚠️ **The stored value is `"failure"`, not `"failed"`** (`app/models/audit.py:26` `OUTCOME_FAILURE="failure"`; `execution_tasks.py:323,526` write `"failure"`). The epic AC literally writes `?outcome=failed`, so **accept `failed` as an alias for `failure`** (and accept the four canonical values `success|failure|cancelled|blocked`). Reject any other value with **422** (validate against the allowed set — do NOT silently return zero rows for a typo).

5. **Pagination envelope.** Given results are paginated, when I call with `?page=2&per_page=50`, then the correct page is returned inside the project's standard `PageMeta` (`total`, `page`, `per_page`) — **NOT** the epic's literal `page_size`/`total_count`/`next_page` (those field names do not exist in this codebase; follow the established convention in `app/schemas/common.py` and `implementation-patterns-consistency-rules.md#List endpoint pagination`). `total` is the filtered count. Out-of-range `page` → empty `items` + correct `total` (not 404); invalid `page`/`per_page`/`outcome`/date → 422. `per_page` max 200, default 50; `page` default 1.

6. **Read schema (AuditRead) with skill_name.** Given entries are returned, when serialized, then each row carries the full audit columns (`id`, `event_type`, `user_id`, `hierarchy_path`, `skill_id`, `skill_version`, `job_id`, `parent_invocation_id`, `runtime_type`, `fan_out`, `outcome`, `error_code`, `started_at`, `completed_at`, `metadata`→`event_metadata`, `created_at`) **plus a resolved `skill_name`** from a LEFT OUTER JOIN on `skills` (so the row survives skill deletion; `skill_name=None` for admin/non-skill events). This is a **read-only** surface — no UPDATE/DELETE, no presigned URLs, no PHI beyond what audit already stores.

## Tasks / Subtasks

- [x] **Task 1 — Migration 0019: add GiST ltree index on `audit_log_entries.hierarchy_path` (AC: #1, #2, #3)**
  - [x] **Migration number is 0019.** Head is `0018_partition_audit_log` (verify: `alembic heads`). `down_revision = "0018_partition_audit_log"`.
  - [x] **Why a migration:** 0018 created indexes only on `skill_id`, `job_id`, `parent_invocation_id`, `created_at`, `user_id`, `event_type` — **there is NO index on `hierarchy_path`.** Every hierarchy table has `Index(..., "hierarchy_path", postgresql_using="gist")` (`app/models/hierarchy.py:79`), but the audit table does not. AC3 explicitly requires "the query uses the ltree index and partition pruning for efficiency" — so the GiST index is an AC-driven requirement, not a nice-to-have.
  - [x] Add a GiST index on `hierarchy_path`. On a **partitioned** parent, `CREATE INDEX ... USING gist (hierarchy_path)` on the parent **propagates to all existing and future partitions** automatically (PG11+ partitioned-index propagation — unlike the TRUNCATE trigger from 0018, which does not propagate). Name it `idx_audit_log_entries_hierarchy_path_gist`. Use raw `op.execute("CREATE INDEX ... USING gist (...)")` (SQLAlchemy's `Index(postgresql_using="gist")` also works — match 0018's raw-DDL style for consistency; check how 0018 declares its indexes).
  - [x] Also add the index declaration to the ORM `__table_args__` in `app/models/audit.py` so model and DB stay in sync (mirror the pattern of the existing 6 `Index(...)` entries there; add `Index("idx_audit_log_entries_hierarchy_path_gist", "hierarchy_path", postgresql_using="gist")`). The migration is the source of truth for the live DB; the ORM entry keeps `create_all`/metadata reflection honest.
  - [x] `down` drops the index. Verify `downgrade`→`upgrade` clean on a fresh `velara_test`.
  - [x] ⚠️ Do NOT recreate/alter the partition structure or the append-only trigger — this migration ONLY adds an index. Keep it small.

- [x] **Task 2 — Pydantic schemas: `AuditRead` + `AuditListData` (AC: #5, #6)**
  - [x] NEW file `app/schemas/audit.py` (none exists today). Mirror the **job schema shape** (`app/schemas/job.py` `JobSummary`/`JobListData`), NOT a bespoke design.
  - [x] `AuditRead(BaseModel)` with `model_config = ConfigDict(from_attributes=True)` and every audit column. **Map the reserved-name column:** the ORM attribute is `event_metadata` (DB column `"metadata"`) — expose it in the API as `metadata` via a Pydantic alias, or expose it as `metadata` field populated from `event_metadata`. Simplest: `metadata: dict | None = Field(default=None, alias="event_metadata")` with `model_config = ConfigDict(from_attributes=True, populate_by_name=True)` so `AuditRead.model_validate(orm_row)` reads `orm_row.event_metadata` and serializes it as `"metadata"`. Confirm the serialized JSON key is `metadata` (the audit table's public contract) — add a test asserting the response body key.
  - [x] Add `skill_name: str | None = None` (resolved via outer join in the service, spliced in at the route like `JobSummary` does — `model_copy(update={"skill_name": skill_name})`).
  - [x] `AuditListData(BaseModel)` = `items: list[AuditRead]` + `page: PageMeta` (identical shape to `JobListData` at `app/schemas/job.py:158`).
  - [x] Types: `id: uuid.UUID`, `created_at`/`started_at`/`completed_at`: `datetime | None` (created_at non-optional), `hierarchy_path: str`, `skill_id`/`job_id`/`parent_invocation_id`: `uuid.UUID | None`, `fan_out: bool`, others `str | None` per the model's nullability.

- [x] **Task 3 — Service: `audit_service.list_entries(...) -> (rows, total)` (AC: #1–#6)**
  - [x] Add to `app/services/audit_service.py` (the existing writer module — keep the read query beside the writes; it's the single audit module). Signature mirrors `job_service.list_jobs`:
    ```python
    async def list_entries(*, session, org_id: str, page: int, per_page: int,
        scope_paths: list[str] | None = None, client_path: str | None = None,
        skill_id: uuid.UUID | None = None, user_id: str | None = None,
        outcome: str | None = None, event_type: str | None = None,
        from_dt: datetime | None = None, to_dt: datetime | None = None,
    ) -> tuple[list[tuple[AuditLogEntry, str | None]], int]:
    ```
  - [x] **⚠️ There is NO `org_id` column on `audit_log_entries`.** Unlike `invocation_jobs`, the audit table has no `org_id` — org isolation comes THROUGH the hierarchy path (every row's `hierarchy_path` is rooted at the caller's org segment) and through `client_id`/scope resolution which already enforce org via `get_client`/`resolve_scope_paths`. Do NOT add a bogus `AuditLogEntry.org_id == org_id` filter (it will fail — no such column). **How org isolation actually holds:** internal roles are org-global-by-design (the architect ruling — see `dependencies.py:90-109`), and `hierarchy_path`/`client_id` resolution is org-scoped. If a stricter org boundary is needed on the raw list, filter `hierarchy_path <@ CAST(:org_root AS ltree)` where `org_root` = the org segment — **flag this to the reviewer**: confirm whether internal audit list should be org-fenced by the org ltree root, or is intentionally org-global for internal operators (default: match the `list_jobs` behavior, which fences by `org_id` — since audit lacks that column, fence by the org ltree prefix derived from the caller). Pick org-ltree-prefix fencing and note it.
  - [x] **Scope filter (the core ltree idiom — copy verbatim):**
    ```python
    if scope_paths is not None and len(scope_paths) == 0:
        return [], 0                       # no grants → zero rows, never CAST an empty array
    where = []
    if scope_paths is not None:            # None = unrestricted internal role
        where.append(text("hierarchy_path <@ ANY(CAST(:paths AS ltree[]))").bindparams(paths=scope_paths))
    if client_path is not None:            # client_id filter → its ltree path, descendant-or-self
        where.append(text("hierarchy_path <@ CAST(:cpath AS ltree)").bindparams(cpath=client_path))
    ```
    This is the ONLY ltree idiom used in the codebase (5 call sites: `hierarchy_service.py:210/309/413/530`, `job_service.py:235`). asyncpg CANNOT bind an `ltree`/`ltree[]` value directly — it binds a `list[str]`/`str` and the SQL `CAST(... AS ltree[])`/`CAST(... AS ltree)` does the element conversion server-side. **Never** try to bind an ltree type through the ORM here.
  - [x] Scalar filters compose as plain equality: `if skill_id is not None: where.append(AuditLogEntry.skill_id == skill_id)`; same for `user_id`, `outcome`, `event_type`.
  - [x] Time window: `if from_dt is not None: where.append(AuditLogEntry.created_at >= from_dt)`; `if to_dt is not None: where.append(AuditLogEntry.created_at <= to_dt)`. Keeping these as direct `created_at` comparisons is what lets Postgres do partition pruning — do NOT wrap `created_at` in a function.
  - [x] Count + paginated rows (mirror `list_jobs:239-253`):
    ```python
    count_stmt = select(func.count()).select_from(AuditLogEntry).where(*where)
    total = (await session.execute(count_stmt)).scalar_one()
    rows_stmt = (
        select(AuditLogEntry, Skill.name)
        .outerjoin(Skill, AuditLogEntry.skill_id == Skill.id)
        .where(*where)
        .order_by(AuditLogEntry.created_at.desc(), AuditLogEntry.id.desc())  # PK tiebreaker — created_at not unique
        .limit(per_page).offset((page - 1) * per_page)
    )
    rows = list((await session.execute(rows_stmt)).all())   # rows = [(AuditLogEntry, skill_name|None), ...]
    return rows, total
    ```
  - [x] **Column ambiguity note:** the outer join brings in `skills` which also has no `hierarchy_path`, so `text("hierarchy_path <@ ...")` is unambiguous — but if the reviewer flags it, qualify as `text("audit_log_entries.hierarchy_path <@ ANY(...)")` (the qualified form is already used in `skill_attachment_service.py:270`).
  - [x] Keep this **read-only** — no `session.add`/`commit`. The audit table is append-only; a query must never mutate it.

- [x] **Task 4 — Route: `GET /api/v1/audit` on a new internal router (AC: #1–#6)**
  - [x] NEW file `app/api/v1/audit.py`. Copy the `jobs.py` list-route structure exactly:
    - `router = APIRouter(prefix="/api/v1/audit", tags=["audit"], dependencies=[RejectClient])` — `RejectClient` makes it internal-only (client token → 404). Add a `_meta(request)` helper (copy from `jobs.py`/`certifications.py`).
    - `@router.get("", response_model=ResponseEnvelope[AuditListData])`.
    - Params: `request: Request, user: CurrentUser, session: DbSession, scope: HierarchyScope`, then `page: Annotated[int, Query(ge=1, le=100_000)] = 1`, `per_page: Annotated[int, Query(ge=1, le=200)] = 50`, and optional filters `client_id: Annotated[uuid.UUID | None, Query()] = None`, `skill_id: ... = None`, `user_id: Annotated[str | None, Query()] = None`, `outcome: Annotated[str | None, Query()] = None`, `event_type: Annotated[str | None, Query()] = None`, `from_: Annotated[date | datetime | None, Query(alias="from")] = None` (⚠️ `from` is a Python keyword — MUST use `Query(alias="from")` and a param named `from_` or `from_dt`), `to: Annotated[date | datetime | None, Query()] = None`.
  - [x] In the handler:
    - `paths = None if scope.unrestricted else scope.scope_paths` (the established idiom).
    - Resolve `client_id` → path: `client_path = None; if client_id is not None: client_path = str((await hierarchy_service.get_client(session, client_id, user.org_id)).hierarchy_path)` — this 404s a cross-org/unknown client (do NOT catch; let `ClientNotFoundError` propagate to the global handler → 404 envelope).
    - **Normalize `outcome`:** because the epic AC requires accepting `?outcome=failed` (UX consistency) but the stored value is `"failure"`, do NOT use a strict `Literal` type on this param (a `Literal["success","failure","cancelled","blocked"]` would 422 the epic's `failed`). Instead take `outcome: Annotated[str | None, Query()] = None`, then in the handler map `"failed"→"failure"` and validate the result ∈ `VALID_OUTCOMES` (`{success, failure, cancelled, blocked}`, importable from `app.services.audit_service`/`app.models.audit`) else raise `VelaraHTTPException(422, "VALIDATION_ERROR", ...)` (grep the exact code other 422s use). ⚠️ **Do NOT reuse `jobs.py`'s `JobStatusLiteral`** — that `"failed"` value is `InvocationJob.status`, a DIFFERENT enum from `AuditLogEntry.outcome`. Same optional validation for `event_type` if you choose to validate it (equality filter is safe without; a bad value just yields empty — acceptable).
    - **Normalize dates:** if `from_`/`to` arrive as `date` (no time), coerce `from_` → `datetime(y,m,d, tzinfo=UTC)` (00:00:00) and `to` → end-of-day inclusive (either `datetime(y,m,d,23,59,59,999999,UTC)` or add 1 day and use `< to_next` — pick the inclusive-`<=`-end-of-day approach and TEST the boundary). If they arrive as full datetimes, use as-is (assume UTC if naive — but FastAPI parses ISO `Z`/offset fine).
    - Call `audit_service.list_entries(...)`, then splice skill_name like jobs:
      ```python
      items = [AuditRead.model_validate(row).model_copy(update={"skill_name": name}) for row, name in rows]
      data = AuditListData(items=items, page=PageMeta(total=total, page=page, per_page=per_page))
      return ResponseEnvelope(data=data, meta=_meta(request))
      ```
  - [x] Register the router: add `audit` to the imports and `api_router.include_router(audit.router)` in `app/api/v1/router.py` (place near `jobs`/`certifications`).
  - [x] **No PUT/PATCH/DELETE** — read surface only (Starlette auto-405s undeclared methods).

- [x] **Task 5 — Tests (AC: #1–#6) — live Postgres**
  - [x] Extend `tests/integration/services/test_audit_service.py` (it already writes audit rows via `record_invocation`/`record_admin_action` and has the `_auth_headers(role)` helper at L86-95 minting `DevAuthProvider` tokens for `ma_tech`/`consultant`/`client`/`admin`). Reuse its seeding to insert entries at known hierarchy paths, then query `GET /api/v1/audit`. (A new `tests/integration/api/test_audit.py` is equally fine — if you go that route, copy the `_postgres_reachable()` skip guard + `_auth_headers` + envelope-assertion pattern from `tests/integration/api/test_certifications.py:24-82,376-402`. Seed orgs: `DevAuthProvider` seeds `ma.tech`→`org_vitalief`, `client.user`→`org_client_001` — use two orgs to test cross-org isolation.)
  - [x] **AC1 (scope):** as `ma_tech` (unrestricted) → sees all seeded entries. As a **client** user with a grant at a client node → sees only entries whose `hierarchy_path` is descendant-or-self of the grant; entries at a sibling/parent path are excluded. **BUT** a client hitting `/api/v1/audit` must get **404** (RejectClient) — so the "client sees only in-scope" assertion is exercised by granting scope to an *internal* test? No: internal roles are unrestricted. To test the `<@` scope filter at the service layer, call `audit_service.list_entries(scope_paths=[client_path])` **directly** against a live session (like `test_access_grants.py:350` calls `resolve_scope_paths` directly) — the route-level scope path only matters for external roles, and external roles are 404'd here. **Add a test asserting a `client`-role token → 404** on the route (AC1 internal-only), and a **service-level** test asserting `scope_paths=[deep_path]` filters correctly (descendant-or-self semantics, incl. that an org-global `hierarchy_path="org"` row is excluded from any client path — see `job_service.py:222-223`).
  - [x] **AC2 (client_id + skill_id):** seed entries under client A and client B (+ different skills); `?client_id={A}&skill_id={S}` returns only the A∩S intersection. `?client_id={cross-org-or-bogus}` → 404.
  - [x] **AC3 (time window):** seed entries with distinct `created_at`; `?from=&to=` returns only in-range. Test the inclusive end-of-day boundary (an entry stamped 23:30 on the `to` date is included). Optionally assert partition pruning via `EXPLAIN` (nice-to-have; the index/pruning is a perf property, assert correctness of results primarily).
  - [x] **AC4 (outcome):** `?outcome=failed` returns the `"failure"` rows (proves the alias mapping); `?outcome=failure` also works; `?outcome=bogus` → 422.
  - [x] **AC5 (pagination):** `total` correct; out-of-range `page` → empty `items` + correct `total`; `per_page=0`/`page=0` → 422; envelope carries `page: {total, page, per_page}`.
  - [x] **AC6 (schema + skill_name):** an invocation entry serializes `skill_name` (from the join) and the JSON key is `metadata` (not `event_metadata`); an admin entry serializes `skill_name=null` and its `metadata` (e.g. grant details). Assert the full column set is present.
  - [x] **Run on live Postgres** — the ltree `<@`, GiST index, and partition behavior are meaningless against a mock (Epic 6/8/9.1 integrity lesson). **`AUTH_BACKEND=dev`** must be set for API-driven tests (9.1 note: the dev container defaults to `cognito`, which 401s DevAuthProvider tokens — run `docker compose exec -e AUTH_BACKEND=dev api pytest ...`, matching `test_access_grants.py`). **Rebuild the api image before pytest** (it bakes source — 9.1/8.4 lesson).

- [x] **Task 6 — Gates & handoff**
  - [x] `ruff check`/`ruff format --check` clean on all touched files. Migration `downgrade`→`upgrade` clean on fresh `velara_test`.
  - [x] Regenerate the OpenAPI spec if the project checks it in (`api-spec.json` was regenerated in 8.5 — check whether a spec file exists and is a review gate; if so, regenerate so the new `/api/v1/audit` path appears).
  - [x] Handoff note for **9.3** (Audit Log UI): the FE consumes `GET /api/v1/audit` returning `{data: {items: AuditRead[], page: PageMeta}, meta}`; fields the table needs — `created_at`, `user_id`, `event_type`, `skill_name`, `hierarchy_path`, `outcome`; filters map to query params `client_id`/`skill_id`/`user_id`/`outcome`/`event_type`/`from`/`to`/`page`/`per_page`. **Fan-out drill-down (9.3):** child entries are separate rows linked by `parent_invocation_id` (not an inline `children[]`). 9.3 will want to fetch a parent's children — **consider adding a `parent_invocation_id` filter now** (trivial: `if parent_invocation_id is not None: where.append(AuditLogEntry.parent_invocation_id == parent_invocation_id)`) so 9.3 can query `?parent_invocation_id={id}` for the fan-out child list. **Add this filter param** (cheap, and 9.3 needs it — Epic-8-retro "record the field your consumer needs" rule).

## Dev Notes

### What this story is (and is NOT)

**IS:** one NEW internal-only read endpoint `GET /api/v1/audit` over the `audit_log_entries` table that 9.1 evolved into a partitioned general event log. Pure query surface: filter → paginate → serialize. Plus ONE small migration (a GiST ltree index that 9.1 didn't create).

**IS NOT:** any write path (9.1 owns that), any UI (9.3), any analytics/aggregation/cost derivation (9.4/9.5), any new auth mechanism (reuse `HierarchyScope` + `RejectClient` from 8.1/8.7). Do NOT touch `record_invocation`/`record_admin_action` or the write callers.

### The gold-standard template: `job_service.list_jobs` + `jobs.py` list route

This story is **structurally identical** to the jobs list. Copy it, don't invent:
- Service `list_jobs` (`app/services/job_service.py:203-254`): `(rows, total)` return, ltree scope filter, `select(count())` then `select(Model, Skill.name).outerjoin(Skill,...)`, PK tiebreaker in `order_by`, `.limit/.offset`, empty-scope short-circuit.
- Route `list_jobs` (`app/api/v1/jobs.py:65-105`): `scope: HierarchyScope` → `paths = None if scope.unrestricted else scope.scope_paths`, splice skill_name via `model_copy(update={"skill_name": name})`, wrap in `AuditListData` + `PageMeta` + `ResponseEnvelope`.
- Schema `JobSummary`/`JobListData` (`app/schemas/job.py:136-167`): `from_attributes=True`, `skill_name: str | None = None`, `page: PageMeta`.

### The ltree containment idiom (the ONE thing to get right)

```python
text("hierarchy_path <@ ANY(CAST(:paths AS ltree[]))").bindparams(paths=scope_paths)  # scope: list of granted paths
text("hierarchy_path <@ CAST(:cpath AS ltree)").bindparams(cpath=client_path)          # single client_id filter
```
- `<@` = "is a descendant-or-self of" (directional: `descendant <@ ancestor` is TRUE; an ancestor is NOT `<@` a deeper path). A row at `org.client_7.project_3` matches a grant on `org.client_7`; it does NOT match a grant on `org.client_7.project_3.study_2`.
- Bind a **plain `list[str]`/`str`** — asyncpg encodes it as a text array/text; the SQL `CAST(... AS ltree[])` converts server-side. `LtreeType` (`app/models/base.py`) is a `UserDefinedType` with NO codec; it only handles scalar column read/write, NOT array binds — which is exactly why every scope query drops to `text(...)`.
- **Empty scope_paths → return `([], 0)` immediately.** Never `CAST` an empty array (ambiguous/degenerate). `resolve_scope_paths` returns `[]` for a user with no grants; `HierarchyScope` gives internal roles `unrestricted=True` (→ pass `scope_paths=None`, no filter).

### ⚠️ NEW: `audit_log_entries` has no GiST index on `hierarchy_path` (Task 1 fixes it)

0018 indexed `skill_id`/`job_id`/`parent_invocation_id`/`created_at`/`user_id`/`event_type` — **not** `hierarchy_path`. A `<@ ANY(...)` scope scan is therefore a seq-scan-per-partition today. Every hierarchy table has `postgresql_using="gist"` on its path; the audit table must too. AC3 says the query must use "the ltree index and partition pruning" — so the index is required, and pairing scope filters with a `created_at` range lets partition pruning (monthly partitions) + this new GiST index carry the load. **This story needs migration 0019** (contrary to the naive "no migration" assumption — the perf AC forces it).

### ⚠️ No `org_id` column on the audit table

`invocation_jobs` has `org_id`; `audit_log_entries` does NOT (check `app/models/audit.py` — the model has `user_id`, `hierarchy_path`, but no `org_id`). Do not filter by `AuditLogEntry.org_id` (compile error / attribute error). Org isolation is carried by the ltree `hierarchy_path` (rooted at the org segment) and by `client_id`/scope resolution (both org-scoped via `get_client`/`resolve_scope_paths`). For an internal (unrestricted) caller, fence the raw list by the caller's **org ltree root** (`text("hierarchy_path <@ CAST(:org_root AS ltree)")` where `org_root` is the org segment) so an internal operator can't see another org's audit — **or** confirm with the reviewer that internal operators are intentionally cross-org (the 8.1 ruling makes internal roles org-global, but that's about the engagement hierarchy within their org; cross-*org* leakage would be a real defect). **Default: fence by org ltree root; flag the decision in the story handoff.** Derive the org segment from `user.org_id` via `hierarchy_service._org_segment(org_id)` (defined in `app/services/hierarchy_service.py`, re-exported/used by `access_service.py:27,178`).

### outcome value trap (AC4)

Stored value is `"failure"` (`OUTCOME_FAILURE`), never `"failed"`. The epic's `?outcome=failed` example would return zero rows against the real data. Map `failed→failure` in the route, validate against `VALID_OUTCOMES` (`{success, failure, cancelled, blocked}` — importable from `app.services.audit_service` or `app.models.audit`), 422 on anything else.

### `metadata` reserved-name (AC6 serialization)

ORM attribute is `event_metadata` (DB column literally `"metadata"` — `metadata` is reserved on `DeclarativeBase`). The **public API key must be `metadata`** (that's the audit contract, and what 9.3/9.4 expect). Use a Pydantic alias: `metadata: dict | None = Field(default=None, alias="event_metadata")` + `model_config = ConfigDict(from_attributes=True, populate_by_name=True)`, and assert the serialized key in a test.

### Internal-only enforcement (reuse, don't rebuild)

`dependencies=[RejectClient]` on the router → any non-internal role (client) gets **404 NOT_FOUND** (existence-hiding, matches `/jobs`, `/certifications`, `/skills`, `/hierarchy`). `HierarchyScope` gives internal roles `unrestricted=True`. Auth (401) runs before RejectClient (404). No new auth code.

### Files being touched

- `app/db/migrations/versions/0019_*.py` (NEW — GiST index only)
- `app/models/audit.py` (add the GiST `Index(...)` to `__table_args__` — no schema/column change)
- `app/schemas/audit.py` (NEW — `AuditRead`, `AuditListData`)
- `app/services/audit_service.py` (ADD `list_entries`; do NOT touch the write functions)
- `app/api/v1/audit.py` (NEW — the route)
- `app/api/v1/router.py` (register the new router)
- `tests/integration/services/test_audit_service.py` (extend with query tests) — or a new `tests/integration/api/test_audit.py` if cleaner (the existing file already has the seeding + `_auth_headers`; extending it is less setup).

### Test environment gotchas (from 9.1)

- `AUTH_BACKEND=dev` required for API-driven tests (dev container defaults to `cognito` → 401s DevAuthProvider tokens). `docker compose exec -e AUTH_BACKEND=dev api pytest ...`.
- Rebuild the `api` image before `pytest` (it bakes source).
- `tests/conftest.py` forces `velara_test` DB + runs `alembic upgrade head` (session autouse). `client` fixture = ASGI `httpx.AsyncClient`.
- Pre-existing unrelated failures: 3 `test_ingest.py` MinIO presign tests fail in-container (localhost/minio hostname mismatch) — NOT a regression, ignore.

### Project Structure Notes

- Route file per resource in `app/api/v1/`; service in `app/services/`; schema in `app/schemas/`; migration in `app/db/migrations/versions/`. This story adds one of each — fully aligned, no structural variance.
- Query params snake_case (`client_id`, `skill_id`, `user_id`, `from`, `to`, `page`, `per_page`). `from` needs `Query(alias="from")` (Python keyword). Pagination follows the project standard (`PageMeta`), overriding the epic's `page_size`/`total_count`/`next_page` field names (which don't exist here).
- Response envelope + `PageMeta` are mandatory (never bare arrays/objects).

### References

- [Source: epics/epic-9-audit-log-usage-analytics.md#Story 9.2] — the 5 ACs (scoped default, compound filter, time window + index/pruning, outcome, pagination). Note the field-name overrides in AC5.
- [Source: implementation-patterns-consistency-rules.md#List endpoint pagination] — `page`/`per_page`/`PageMeta`, `total`=filtered count, out-of-range→empty, invalid→422. Query params snake_case.
- [Source: architecture/core-architectural-decisions.md:14] — "All queries include a `path <@ :scope_path` filter derived from access grants, applied in a FastAPI dependency." (`HierarchyScope` resolves paths; this query applies `<@ ANY`.)
- [Source: architecture/core-architectural-decisions.md:9,94] — audit log is a partitioned append-only PostgreSQL table; Part 11 §11.10(e) trail is Epic 9. This query surface reads it; it must never mutate.
- [Source: velara-api/app/services/job_service.py:203-254] — **the template**: `list_jobs` (scope filter, count+rows, outerjoin skill_name, PK tiebreaker, empty-scope short-circuit).
- [Source: velara-api/app/api/v1/jobs.py:65-105] — **the route template**: `HierarchyScope`→paths, skill_name splice, `PageMeta`, envelope.
- [Source: velara-api/app/schemas/job.py:136-167] — `JobSummary`/`JobListData` schema shape to mirror.
- [Source: velara-api/app/services/certification_service.py:368-406] — alternate `(rows, total)` count+paginate reference.
- [Source: velara-api/app/api/v1/certifications.py:82-103] — alternate paginated-envelope route reference; `dependencies=[RejectClient]`, `_meta(request)`.
- [Source: velara-api/app/core/dependencies.py:112-196] — `HierarchyScopeValue` (`scope_paths`/`unrestricted`/`in_scope`/`assert_in_scope`), `_hierarchy_scope`, `reject_client`/`RejectClient`, `_INTERNAL_ROLES`. THE scope + internal-only seam.
- [Source: velara-api/app/services/hierarchy_service.py:187-213] — `get_client` (client_id→row, cross-org 404); `list_clients` (canonical `<@ ANY(CAST(:paths AS ltree[]))` idiom).
- [Source: velara-api/app/services/access_service.py:149-233] — `resolve_scope_paths` (grant→ltree path strings), `_org_segment`/`_path_in_org` (org root helpers).
- [Source: velara-api/app/services/skill_attachment_service.py:270-286] — table-qualified ltree filter (`text("projects.hierarchy_path <@ ...")`) for the join-ambiguity case.
- [Source: velara-api/app/models/audit.py] — the schema 9.2 queries: columns, `event_metadata`→`"metadata"`, `OUTCOME_FAILURE="failure"`, existing indexes (NO hierarchy_path index → Task 1).
- [Source: velara-api/app/models/base.py:19-37] — `LtreeType` (UserDefinedType, no codec — why array binds go through `text()` CAST).
- [Source: velara-api/app/schemas/common.py:35-40] — `PageMeta`; `ResponseEnvelope`/`ResponseMeta`.
- [Source: velara-api/app/api/v1/router.py] — register the new `audit` router here.
- [Source: velara-api/tests/integration/services/test_audit_service.py:83-95] — `_auth_headers(role)` dev-token minting for ma_tech/consultant/client/admin; existing audit seeding to extend.
- [Source: velara-api/tests/integration/api/test_access_grants.py:350-401] — calling a scope function directly against a live session (template for the service-level `<@` test).
- [Source: story 9-1-audit-log-write-path.md] — the write path + schema evolution 9.2 reads; `AUTH_BACKEND=dev` + rebuild-image test notes; handoff explicitly names 9.2 as the query API consuming `event_type`/`metadata`/`parent_invocation_id` + partition pruning.
- Forward-deps: **9.3** (Audit UI consumes this endpoint; add the `parent_invocation_id` filter for fan-out drill-down); **9.4** (analytics reads the same table but aggregates — different surface).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Migration revision id `0019_audit_log_hierarchy_gist_index` (35 chars) exceeded `alembic_version.version_num VARCHAR(32)` and raised `StringDataRightTruncationError` mid-upgrade; the transactional DDL rolled back cleanly (DB stayed at 0018, no partial index). Renamed the revision id to `0019_audit_hierarchy_gist` (25 chars) — under the limit — and re-ran clean.
- `CREATE INDEX ... USING gist (hierarchy_path)` on the partitioned parent shows up in `\di` as a `partitioned index` and confirmed present on all 6 partitions without any per-partition DDL — the PG11+ partitioned-index propagation the Dev Notes described held as documented.
- First test-suite pass had 9 failures, all from the same root cause: several new 9.2 tests hardcoded `hierarchy_path="org_vitalief"` (the raw JWT `org_id`), but the service's org-fencing filter matches on `_org_segment(org_id)` = `"org_" + org_id` = `"org_org_vitalief"` — the actual root every real client/project/study `hierarchy_path` is built from. Fixed by introducing an `_ORG_ROOT = "org_org_vitalief"` test constant and using it everywhere a seeded row needs to be visible to an `org_vitalief`-org caller (org_id= params were correctly left as the raw `"org_vitalief"` string — only hierarchy_path= seed values were wrong).
- `Field(alias="event_metadata")` on `AuditRead.metadata` serialized the response body key as `event_metadata` (not `metadata`) — FastAPI's `response_model` defaults to `by_alias=True`, and a plain `alias` applies to both validation AND serialization. Fixed by switching to `validation_alias="event_metadata"` (validation-only), which reads the ORM attribute correctly while the serialized JSON key stays the field name `metadata`. Verified with a direct Pydantic repro before touching the route.
- `scripts/export_openapi.py` failed with `ModuleNotFoundError: No module named 'app'` when run via `docker exec ... python scripts/export_openapi.py` (cwd-relative sys.path[0] resolution differs inside `docker exec`); ran with `PYTHONPATH=/app` instead. Regenerated spec is byte-identical across two consecutive runs (md5 verified) — determinism intact.
- Dev container's default DB (not `velara_test`) was still at migration `0017` — applied 0018+0019 to it directly for route smoke-testing (safe: no real data in this dev environment). `velara_test` is recreated from scratch for the actual pytest run per project convention.
- Pre-existing/unrelated: 3 `test_ingest.py` MinIO presign failures persist in this container (same environment artifact noted in Story 9.1 — localhost/minio hostname mismatch, not a regression).

### Completion Notes List

- Migration 0019 adds one GiST index (`idx_audit_log_entries_hierarchy_path_gist`) on `audit_log_entries.hierarchy_path`, propagated automatically to all partitions (verified as a `partitioned index` in `\di`). Down/up verified clean. Mirrored the identical `Index(..., postgresql_using="gist")` entry into the ORM `__table_args__` so model and DB stay in sync.
- New `app/schemas/audit.py`: `AuditRead` (every audit column + `skill_name` + `metadata` field reading the ORM's `event_metadata` via `validation_alias` so the serialized key stays `metadata`) and `AuditListData` (mirrors `JobListData`).
- New `audit_service.list_entries(...)` added to the existing writer module (kept read query alongside writes per the story's explicit instruction). Implements the `<@ ANY(...)` scope filter, an additional `<@` client_path filter, plain-equality filters (skill_id/user_id/outcome/event_type/parent_invocation_id), direct `created_at` range comparisons (partition-pruning-friendly, no function wrapping), and the count+paginated-rows pattern mirroring `list_jobs`. **Decision applied (per Dev Notes default): every call is fenced by the caller's org ltree root** (`hierarchy_path <@ CAST(:org_root AS ltree)` where `org_root = _org_segment(org_id)`) since `audit_log_entries` has no `org_id` column — this prevents an internal (unrestricted) operator in one org from ever seeing another org's audit trail. Added the `parent_invocation_id` filter proactively per the 9.3 handoff note (fan-out drill-down).
- New `app/api/v1/audit.py`: `GET /api/v1/audit` on an internal-only router (`RejectClient`). Handles `client_id`→path resolution (404 on cross-org/unknown, propagated from `ClientNotFoundError`), the `failed`→`failure` outcome alias + `VALID_OUTCOMES` validation (422 on anything else), and `from`/`to` date-or-datetime normalization (bare date → start-of-day UTC for `from`, inclusive end-of-day 23:59:59.999999 UTC for `to`; full datetimes used as-is, naive assumed UTC). Registered in `app/api/v1/router.py`.
- Tests: 24 new tests appended to `tests/integration/services/test_audit_service.py` covering AC1 (client-role 404 + unrestricted-role visibility + service-level scope-filter descendant-or-self semantics incl. org-global-row exclusion + empty-scope short-circuit + org-fencing across two orgs), AC2 (client_id+skill_id compound filter + bogus client_id 404), AC3 (time window incl. the inclusive 23:30-on-`to`-date boundary), AC4 (failed→failure alias + bogus outcome 422), AC5 (pagination total/out-of-range-page/invalid-page-and-per_page 422), AC6 (skill_name join + `metadata` JSON key assertion + admin-entry null skill_name), plus the proactive `parent_invocation_id` filter test. All 33 tests in the file pass (9 pre-existing 9.1 + 24 new 9.2).
- Gates: `ruff check`/`ruff format --check` clean on all touched files; full suite 984 passed / 3 pre-existing-unrelated failures (`test_ingest.py` MinIO presign env issue, same as 9.1); migration `downgrade`→`upgrade` verified clean on a freshly created `velara_test`. OpenAPI spec regenerated (`docs/api-spec.json`, 44→49 paths, new `/api/v1/audit`) and confirmed byte-identical across two runs.
- Handoff for 9.3 confirmed: response shape `{data: {items: AuditRead[], page: PageMeta}, meta}`; the `parent_invocation_id` filter is already live so 9.3's fan-out drill-down needs no further backend work.

### File List

- velara-api/app/db/migrations/versions/0019_audit_hierarchy_gist.py (NEW)
- velara-api/app/models/audit.py
- velara-api/app/schemas/audit.py (NEW)
- velara-api/app/services/audit_service.py
- velara-api/app/api/v1/audit.py (NEW)
- velara-api/app/api/v1/router.py
- velara-api/tests/integration/services/test_audit_service.py
- velara-api/docs/api-spec.json

## Review Findings

_Code review 2026-07-02 (3-layer adversarial: Blind Hunter, Edge Case Hunter, Acceptance Auditor + per-finding empirical verification). 1 decision-needed, 2 patch, 1 defer, 10 dismissed as noise/false-positive. Diff reviewed: velara-api uncommitted working tree (audit.py/schemas/service/model/migration/tests/spec)._

- [x] [Review][Decision→Defer] **Org-global admin events (`hierarchy_path="org"`) are invisible on GET /api/v1/audit for EVERY caller** — The service fences every query with `hierarchy_path <@ CAST(:org_root AS ltree)` where `org_root = _org_segment(org_id) = "org_org_vitalief"` [app/services/audit_service.py:204-205]. But skill lifecycle transitions [app/services/skill_service.py:542] and certifications [app/services/certification_service.py:261] write audit rows with the literal single-label `hierarchy_path="org"`. Empirically confirmed against live Postgres: `'org'::ltree <@ 'org_org_vitalief'::ltree` = **FALSE** (whole-label match, not prefix). So those two entire classes of admin audit events can never be returned by the query API — including for unrestricted internal operators. This contradicts AC1 ("internal roles … see all org entries") and AC6 (admin events are first-class rows with `skill_name=None`), and undercuts the Part 11 compliance-trail purpose that 9.1 wired lifecycle/certification events into the log for. The test suite's blind spot: `test_list_entries_scope_paths_filters_descendant_or_self` [tests/.../test_audit_service.py:730] deliberately asserts the `"org"` row is excluded for a *client-scoped* caller (correct), but NO test asserts an *unrestricted* internal caller can see an `hierarchy_path="org"` admin row. **DECISION (Developer, 2026-07-02): fix the write path, not the query fence** — the root cause is 9.1 writing the literal `"org"` instead of the real org root; those admin events should live inside the org subtree. Deferred to a follow-up (touches 9.1 write callers + the `"org"` convention + a backfill for existing rows) — see deferred-work.md.

- [x] [Review][Patch] **Bare-integer `from`/`to` silently coerced to a Unix-timestamp date (no 422)** [velara-api/app/api/v1/audit.py:29,39-58] — `TypeAdapter(date | datetime)` interprets a bare-int string as a Unix timestamp: empirically `?from=1710460800` → `date(2024-03-15)`, and `?from=2024` (user meaning "the year 2024") → `datetime(1970-01-01 00:33:44 UTC)`. Result is a silently-wrong time window returned as 200, not the 422 AC3/AC5 imply for a bad date. **FIXED 2026-07-02**: `_parse_boundary` now rejects a purely-numeric (bare-int) string with 422 `VALIDATION_ERROR` before the TypeAdapter runs; ISO dates/datetimes still parse. Regression test `test_audit_route_bare_integer_date_returns_422` added (passes).

- [x] [Review][Patch] **Inverted range (`from > to`) returns a silent empty page** [velara-api/app/api/v1/audit.py:102-103] — `?from=2026-06-01&to=2026-01-01` yields `created_at >= Jun AND created_at <= Jan` → always empty, 200 OK, `total: 0`. On a compliance/audit surface an operator can't distinguish a from/to typo from "no activity." **FIXED 2026-07-02**: the handler now raises 422 `VALIDATION_ERROR` ("'from' must be on or before 'to'.") when `from_dt > to_dt`; equal from/to (single-day query) stays valid. Regression test `test_audit_route_inverted_range_returns_422` added (passes).

- [x] [Review][Defer] **Deep-page OFFSET pagination is unbounded-ish** [velara-api/app/services/audit_service.py:239] — `page` capped at `le=100_000` × `per_page` up to 200 allows `.offset(~20,000,000)`, a full-partition scan per deep-page request (+ a `func.count()` scan on every page). A pre-existing pattern inherited verbatim from `list_jobs` (`jobs.py` has the identical shape), not introduced by this change — deferred, pre-existing.
