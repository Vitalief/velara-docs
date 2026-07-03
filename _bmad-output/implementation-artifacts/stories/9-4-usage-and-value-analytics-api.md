---
baseline_commit: 6c36466d8f7fed0cc64c689c9d81a56bc42aa1ad
---

# Story 9.4: Usage & Value Analytics API

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want aggregate and per-user usage/value metrics endpoints,
so that the Usage & Value screen can show platform-wide trends and drill into an individual user's activity.

> Analytics is **derived** (read-only) from the existing `audit_log_entries` table (evolved in 9.1, queried in 9.2) — it is **not** a new source of truth. This story adds an aggregation surface, a greenfield **token-cost pricing map**, and greenfield **value/hours-saved config constants**. It writes **no** new invocation data.

## Acceptance Criteria

1. **Overview aggregate.** Given I call `GET /api/v1/analytics/overview`, when the response is returned, then it includes aggregate metrics **within my hierarchy scope**: `total_invocations`, `success_rate`, a weekly **usage time-series** (`series`: 12 buckets of `{week_start, count}` for the last 12 weeks), `top_skills` (top 6 by run count, `{skill_id, name, runs}`), and value metrics — `hours_saved`, `value_cost_avoided` (dollars), and `token_cost` (dollars of LLM spend) — all filtered by the `HierarchyScope` dependency and org-fenced by `org_id`.

2. **Users-in-scope list.** Given I call `GET /api/v1/analytics/users`, when the response is returned, then it lists **users who have activity in scope** (distinct `user_id` from audit rows within scope), each with summary metrics: `user_id`, resolved `name` (from the auth directory), `invocations`, `success_rate`, `skills_used` (distinct skill count).

3. **Per-user drill-down.** Given I call `GET /api/v1/analytics/users/{user_id}`, when the response is returned, then it returns that user's metrics: `invocations`, `success_rate`, `skills_used`, `avg_runtime_ms`, `trend_pct` (vs the prior 12-week window), `hours_saved`, `top_skills` (`{skill_id, name, runs}`), `weekly` (12-bucket activity series), and `recent_activity` (the user's last 7 audit entries, actor-filtered, newest first). A `user_id` with no in-scope activity returns **404** (existence-hiding on this internal surface).

4. **Read-only, aggregate-only, no PHI.** Given any analytics query runs, when it executes, then it reads only `audit_log_entries` (+ a `skills` outer join for names, + the auth directory for user names) — **read-only, no mutation** — respects hierarchy scope + org fence, and exposes only aggregate counts/durations/derived dollars — **no PHI, no `event_metadata` blob, no `inputs`/output content**.

5. **Internal-grantor-only.** Given a **client-scoped** OR **consultant-scoped** token calls any `/api/v1/analytics/*` route, when the request is evaluated, then it is **404'd** by `RejectNonGrantor` (analytics is an oversight surface — `admin`/`ma_tech` only, mirroring `/api/v1/audit`). No analytics routes exist on any client router prefix.

6. **Token cost derivation (greenfield pricing map).** Given invocation audit rows carry `event_metadata.input_tokens`/`output_tokens`/`model` (written by 9.1 for `prompt`/`hybrid` runs), when `token_cost` is computed, then it sums `Σ(input_tokens × in_price + output_tokens × out_price)` over the in-scope rows using a **pricing map keyed by model string** (this story owns it — seed `claude-opus-4-8`). `code` runs and `failure`/`cancelled` rows carry **no** token metadata and contribute `$0` — this is a documented completeness gap, not a bug (see Dev Notes).

7. **Value metrics (config-driven).** Given `hours_saved` and `value_cost_avoided` have no upstream data source, when they are computed, then they are derived from **config constants this story owns**: `hours_saved = in_scope_SUCCESSFUL_invocation_count × MINUTES_SAVED_PER_RUN / 60` (default `MINUTES_SAVED_PER_RUN = 42`, matching the mock's "modeled at 42 min / run") and `value_cost_avoided = hours_saved × BLENDED_LABOR_RATE_USD` (a configurable $/hour). Both constants live in `app/core/config.py` (tunable without a migration) and the response documents the modeling assumption (`minutes_saved_per_run` echoed in the payload). *(AMENDED per review decision 2026-07-03: the formula counts `outcome="success"` rows only — a failed/blocked/cancelled run saves nobody 42 minutes; the original text said total invocation count.)*

> **DESCOPED from this story (product decision 2026-07-03):** the **invocation-surface breakdown (Web/API/Claude)** in the epic's per-user AC. That dimension is **not persisted anywhere** — all three entrypoints (`invocations.py`, `invoke.py` Claude-proxy, `client.py`) call the identical `queue_invocation` and differ only by a `log_prefix` string; there is no `surface`/`source` column on `invocation_jobs` or the audit table. Building it requires a schema addition + stamping at 3 entrypoints, which is out of scope for a "derived from existing data" story. `recent_activity`'s per-row `surface` and the per-user `surfaces[]` array are therefore **omitted** from the API contract. 9.5 (the UI) omits the "By surface" card accordingly. Track the surface-tracking work as a follow-up (see Dev Notes → Descope & follow-ups).

## Tasks / Subtasks

- [x] **Task 1 — Pricing map + value config (AC: #6, #7)**
  - [x] Add to `app/core/config.py` (`Settings`): `MINUTES_SAVED_PER_RUN: int = 42` and `BLENDED_LABOR_RATE_USD: float = 150.0` (pick a sensible default; it is a modeling assumption, tunable via env — document the choice in the story's Completion Notes). These are the value-model constants (AC7).
  - [x] Add a **pricing map** for LLM token cost. Prefer a small module constant over config-env (a nested dict is awkward in env). Create `app/services/analytics_service.py` (NEW) and define at module top:
    ```python
    # USD per single token. Keyed by the model string stored in audit event_metadata["model"].
    # Only claude-opus-4-8 appears in data today (settings.ANTHROPIC_MODEL); author as a map so
    # future model changes just add a key. Prices are illustrative defaults — confirm before prod.
    _MODEL_PRICING: dict[str, tuple[float, float]] = {
        # model: (input_usd_per_token, output_usd_per_token)
        "claude-opus-4-8": (15.0 / 1_000_000, 75.0 / 1_000_000),
    }
    _DEFAULT_PRICING = (15.0 / 1_000_000, 75.0 / 1_000_000)  # fallback for an unknown model string
    ```
    Use the current published Opus pricing you can confirm at build time; if unsure, keep the placeholder and flag it in Completion Notes. **Unknown model → fall back to `_DEFAULT_PRICING` (do NOT drop the row or raise)** so a future model swap never silently zeros cost.
  - [x] `code`-runtime rows and `failure`/`cancelled` rows have `event_metadata = NULL` (no tokens) — they contribute `$0` and must not error (`.get("input_tokens", 0)`, guard `event_metadata is None`).

- [x] **Task 2 — Service: `analytics_service` aggregation functions (AC: #1–#4, #6, #7)**
  - [x] NEW file `app/services/analytics_service.py`. **There is NO existing aggregation idiom in the codebase** (grep confirms: no `group_by`, `func.avg`, `func.sum`, `func.date_trunc`, `distinct(column)` anywhere — only `func.count()` for pagination). You are building the first aggregation surface. Import fresh from `sqlalchemy`: `func`, `select`, `text`, `distinct`, `and_`.
  - [x] **Reuse the exact WHERE-list base from `audit_service.list_entries` (`app/services/audit_service.py:217-227`)** — factor a private helper so overview + users + per-user all share identical scope/org semantics:
    ```python
    def _scope_where(*, org_id: str, scope_paths: list[str] | None,
                     user_id: str | None = None) -> list:
        # returns None-sentinel meaning "empty scope → zero rows" so callers short-circuit
        where = [AuditLogEntry.org_id == org_id]                      # org fence (0020 col; NOT a path fence)
        if scope_paths is not None:
            where.append(text("hierarchy_path <@ ANY(CAST(:paths AS ltree[]))").bindparams(paths=scope_paths))
        if user_id is not None:
            where.append(AuditLogEntry.user_id == user_id)
        return where
    ```
    ⚠️ **Empty-scope short-circuit (copy from `list_entries:217`):** callers must check `if scope_paths is not None and len(scope_paths) == 0: return <empty>` BEFORE building the query — never `CAST` an empty ltree array. (Internal grantor roles are `unrestricted=True` → `scope_paths=None` → no ltree filter, only the org fence.)
  - [x] ⚠️ **Only count INVOCATION events, not admin events.** Audit rows include `admin.*` events (grant/lifecycle/certification) with `hierarchy_path="org"`, `outcome=NULL`, `skill_id=NULL`. Analytics is about *invocations* — filter to invocation rows: add `AuditLogEntry.event_type.like("invocation.%")` (or `AuditLogEntry.outcome.isnot(None)`) to every aggregation WHERE list. **Also exclude the fan-out PARENT row** (`event_type = "invocation.fan_out"`, `outcome=NULL`) from success-rate/count math so a fan-out job isn't double-counted (parent + children) — count the child leaf entries. Filtering on `outcome.isnot(None)` naturally excludes both admin rows and the fan-out parent (both have `outcome=NULL`). Use that as the invocation predicate and document it.
  - [x] **`overview(session, *, org_id, scope_paths) -> AnalyticsOverview` (AC1, #6, #7):**
    - `total_invocations` = `select(func.count()).where(*inv_where)` `.scalar_one()`.
    - `success_rate` = `count(outcome="success") / total_invocations` (float %, 1 decimal; `0.0` when total is 0 — guard div-by-zero). Compute both counts in one pass with `func.count()` + a filtered count, or two cheap counts.
    - **Weekly time-series (`series`, 12 buckets):** greenfield — no precedent. Use `func.date_trunc('week', AuditLogEntry.created_at)` grouped:
      ```python
      week = func.date_trunc("week", AuditLogEntry.created_at).label("week")
      stmt = (select(week, func.count().label("n")).where(*inv_where, AuditLogEntry.created_at >= window_start)
              .group_by(week).order_by(week))
      ```
      Then **densify to exactly 12 weekly buckets** in Python (fill missing weeks with 0) so the FE always gets 12 ordered `{week_start, count}` — DB returns only weeks that have rows. `window_start` = start of the ISO week 11 weeks before the current week (12 buckets inclusive). ⚠️ `date_trunc('week', ...)` returns **Monday-anchored** week starts (Postgres ISO week) — anchor your Python bucket keys the same way. **`datetime.now()`/`datetime.now(UTC)` is the current time** — the service may call it (services can; only workflow *scripts* forbid it). Use `datetime.now(UTC)`.
    - **`top_skills` (top 6):** `select(AuditLogEntry.skill_id, Skill.name, func.count().label("runs")).outerjoin(Skill, ...).where(*inv_where, AuditLogEntry.skill_id.isnot(None)).group_by(AuditLogEntry.skill_id, Skill.name).order_by(func.count().desc()).limit(6)`. Return `[{skill_id, name, runs}]`. `name` survives skill deletion via the outer join (may be None — the FE tolerates it, matches `AuditRead.skill_name`).
    - **`token_cost` (AC6):** you need per-row `input_tokens`/`output_tokens`/`model` from the JSONB. Two viable approaches — pick the SQL-aggregation one for scale, or the row-scan one for clarity:
      - **SQL:** `func.sum(cast(AuditLogEntry.event_metadata["input_tokens"].astext, Integer))` grouped by `event_metadata["model"].astext` — SQLAlchemy JSONB `["key"].astext` + `cast(..., Integer)`. Group by model so each model's tokens multiply by its own price, then sum in Python via `_MODEL_PRICING`.
      - **Row-scan (simpler, fine at current volume):** select `event_metadata` for in-scope success/blocked rows where `event_metadata IS NOT NULL`, iterate, `price = _MODEL_PRICING.get(m["model"], _DEFAULT_PRICING)`, accumulate. **Recommend the SQL-grouped approach** but the row-scan is acceptable — note the choice. Only `success`/`blocked` rows carry tokens (failure/cancel/code = NULL → skipped naturally by `event_metadata IS NOT NULL`).
    - **`hours_saved` / `value_cost_avoided` (AC7):** `hours_saved = total_invocations × settings.MINUTES_SAVED_PER_RUN / 60`; `value_cost_avoided = hours_saved × settings.BLENDED_LABOR_RATE_USD`. Echo `minutes_saved_per_run` in the payload (the mock labels "modeled at 42 min / run").
  - [x] **`list_users(session, *, org_id, scope_paths) -> list[AnalyticsUserSummary]` (AC2):**
    - Distinct users with activity: `select(AuditLogEntry.user_id, func.count(), func.count(distinct(AuditLogEntry.skill_id)), <success count>).where(*inv_where).group_by(AuditLogEntry.user_id)`. Compute per-user `invocations`, `success_rate`, `skills_used` in the grouped query.
    - **Name resolution:** audit stores only opaque `user_id`, not a name. Resolve names via the auth directory: `get_auth_provider().list_users()` → `{u.user_id: u.name}` map, splice `name` (fallback to `user_id` when the directory has no entry — a user may have left). Do this ONCE per request (not per row). See `app/integrations/auth.py:129-185` (`AuthProvider.list_users` / `UserSummary`).
  - [x] **`user_detail(session, *, org_id, scope_paths, user_id) -> AnalyticsUserDetail | None` (AC3):**
    - Add `user_id` to the WHERE base. **If the user has zero in-scope invocation rows → return `None`** (route → 404).
    - `invocations`, `success_rate`, `skills_used` as above (scoped to the user).
    - `avg_runtime_ms` = `func.avg(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)` over rows where both timestamps are non-null — express via `text()` or `func.avg(func.extract('epoch', AuditLogEntry.completed_at - AuditLogEntry.started_at) * 1000)`. Round to int ms; `None`/`0` when no timed rows.
    - `weekly` = the same 12-bucket densified series but user-scoped.
    - `trend_pct` = `(this_window_count - prior_window_count) / prior_window_count × 100` where prior_window = the 12 weeks *before* `window_start`. Guard prior=0 (→ `None` or `+100`-style; pick `None` and document). One extra count query.
    - `top_skills` (user-scoped, top 5 — the mock shows up to 5 per user; use 5 or reuse 6, note the choice) via the same grouped skill query.
    - `recent_activity` = the user's **last 7 audit rows** newest-first (NOT only invocations — the mock merges invocation + admin events for the actor). Reuse `audit_service.list_entries(session, org_id=..., page=1, per_page=7, scope_paths=..., user_id=user_id)` — it already returns `(rows, total)` newest-first with `skill_name`. Map each to a lean `{id, created_at, event_type, skill_name, outcome}` activity row (**no `event_metadata`, no PHI** — AC4). ✅ This reuses 9.2's shipped query verbatim; do not re-implement.
  - [x] **Read-only guarantee (AC4):** no `session.add`/`commit`/`flush` anywhere in this module. Every function is a pure read.

- [x] **Task 3 — Schemas: `app/schemas/analytics.py` (AC: #1–#3)**
  - [x] NEW file. All `BaseModel` with `model_config = ConfigDict(from_attributes=True)` where reading ORM rows; plain models for computed aggregates. Mirror `app/schemas/audit.py` style.
  - [x] `WeeklyBucket`: `week_start: date` (or `datetime`), `count: int`.
  - [x] `SkillRun`: `skill_id: uuid.UUID | None`, `name: str | None`, `runs: int`.
  - [x] `AnalyticsOverview`: `total_invocations: int`, `success_rate: float`, `series: list[WeeklyBucket]`, `top_skills: list[SkillRun]`, `hours_saved: float`, `value_cost_avoided: float`, `token_cost: float`, `minutes_saved_per_run: int`.
  - [x] `AnalyticsUserSummary`: `user_id: str`, `name: str`, `invocations: int`, `success_rate: float`, `skills_used: int`.
  - [x] `AnalyticsUsersData`: `users: list[AnalyticsUserSummary]` (single object under `data` — NOT paginated; the user set is small. If you prefer pagination for symmetry, wrap in `PageMeta` like `AuditListData` and note it — but a flat list is acceptable and simpler; the mock renders a chip strip, not a paginated table).
  - [x] `ActivityRow`: `id: uuid.UUID`, `created_at: datetime`, `event_type: str`, `skill_name: str | None`, `outcome: str | None`.
  - [x] `AnalyticsUserDetail`: `user_id: str`, `name: str`, `invocations: int`, `success_rate: float`, `skills_used: int`, `avg_runtime_ms: int | None`, `trend_pct: float | None`, `hours_saved: float`, `top_skills: list[SkillRun]`, `weekly: list[WeeklyBucket]`, `recent_activity: list[ActivityRow]`.

- [x] **Task 4 — Routes: `app/api/v1/analytics.py` (AC: #1–#5)**
  - [x] NEW file. Copy the router shape from `app/api/v1/audit.py:25,34-38`:
    - `router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"], dependencies=[RejectNonGrantor])` — `RejectNonGrantor` is the AC5 gate (admin/ma_tech only; client AND consultant → 404). Import from `app.core.dependencies`.
    - Copy the `_meta(request)` helper verbatim (`audit.py:34-38`).
  - [x] `GET "/overview"` → `overview` (`response_model=ResponseEnvelope[AnalyticsOverview]`). *(Originally written as `GET ""` — corrected by review 2026-07-03 to match AC1 + the 9.5 handoff contract.)* Params: `request: Request, user: CurrentUser, session: DbSession, scope: HierarchyScope`. Derive `paths = None if scope.unrestricted else scope.scope_paths` (`audit.py:99`). Empty-scope handled inside the service (returns a zeroed overview). Call `analytics_service.overview(session, org_id=user.org_id, scope_paths=paths)`; wrap in `ResponseEnvelope(data=..., meta=_meta(request))`.
  - [x] `GET "/users"` → `list_users` (`response_model=ResponseEnvelope[AnalyticsUsersData]`). Same deps; `data=AnalyticsUsersData(users=...)`.
  - [x] `GET "/users/{user_id}"` → `user_detail` (`response_model=ResponseEnvelope[AnalyticsUserDetail]`). `user_id: str` path param. If the service returns `None` → raise `VelaraHTTPException(404, "NOT_FOUND", "Not found.")` (grep the exact 404 helper other routes use — `audit.py`/`jobs.py` propagate `*NotFoundError`; here raise directly). Route ordering: define `/users` and `/users/{user_id}` — FastAPI resolves the static `/users` before the param route as long as `/users` (exact) is declared; declare the exact `/users` route BEFORE `/users/{user_id}` to be safe, or rely on FastAPI's specificity (test both).
  - [x] Register in `app/api/v1/router.py`: add `analytics` to the import tuple (`router.py:5-19`) and `api_router.include_router(analytics.router)` after the `audit` line (`router.py:34`).
  - [x] **No POST/PUT/PATCH/DELETE** — read surface only.

- [x] **Task 5 — Tests (AC: #1–#7) — live Postgres**
  - [x] Extend `tests/integration/services/test_audit_service.py` (has `_auth_headers(role)` minting dev tokens for `ma_tech`/`consultant`/`client`/`admin` at ~L86-95, plus audit-seeding helpers) **or** create `tests/integration/api/test_analytics.py` (copy the `_postgres_reachable()` skip guard + `_auth_headers` + envelope-assertion pattern from `test_certifications.py`/`test_audit_service.py`). Seed invocation audit rows via `audit_service.record_invocation(...)` (or direct `AuditLogEntry` inserts with `event_type="invocation.success"`, `outcome`, `org_id`, `hierarchy_path`, `event_metadata={"input_tokens":..,"output_tokens":..,"model":"claude-opus-4-8"}`).
  - [x] **AC5 (auth) — do this first, it's the cheapest signal:** `client` token → **404** on all three routes; **`consultant` token → 404** (the `RejectNonGrantor` distinction from `RejectClient` — a consultant reaching audit rows would be the bug); `ma_tech`/`admin` → 200.
  - [x] **AC1 (overview):** seed N success + M failure invocation rows in one org/scope → assert `total_invocations = N+M`, `success_rate ≈ N/(N+M)*100`. Seed rows across ≥2 distinct weeks → assert `len(series) == 12` and the right buckets carry the right counts (0-fill verified). Seed 7+ distinct skills → assert `top_skills` has ≤6, ordered desc by `runs`. **Assert admin rows and fan-out parent rows are EXCLUDED** from the counts (seed an `admin.grant_created` row + an `invocation.fan_out` parent → they must not inflate `total_invocations`).
  - [x] **AC6 (token cost):** seed success rows with known `input_tokens`/`output_tokens`/`model="claude-opus-4-8"` → assert `token_cost` = the hand-computed `Σ(in×in_price + out×out_price)`. Seed a `code`-runtime row (`event_metadata=None`) and a `failure` row (no metadata) → assert they contribute `$0` (don't raise). Seed a row with an **unknown model string** → assert it uses `_DEFAULT_PRICING` (not dropped, not zero).
  - [x] **AC7 (value):** assert `hours_saved == total_invocations * 42 / 60` and `value_cost_avoided == hours_saved * BLENDED_LABOR_RATE_USD`; `minutes_saved_per_run == 42` in the payload.
  - [x] **AC2 (users list):** seed rows for ≥2 distinct `user_id`s → assert both appear with correct per-user `invocations`/`skills_used`/`success_rate`; assert `name` is resolved from the auth directory (seed a `user_id` that maps to a `DevAuthProvider` seed user → real name; and one that doesn't → falls back to `user_id`).
  - [x] **AC3 (per-user):** `GET /users/{seeded_user}` → correct scalars + `weekly` (12 buckets) + `recent_activity` (≤7, newest-first, no `event_metadata` key in the JSON). `GET /users/{unknown_user}` → **404**. Assert `avg_runtime_ms` computed from `started_at`/`completed_at` on a row with a known duration. `trend_pct` guard: a user with prior-window rows → a number; with none → `None`.
  - [x] **Scope (AC1/#4):** call the **service** directly with `scope_paths=[deep_client_path]` (like `test_access_grants.py:350` calls scope functions directly against a live session) → only descendant-or-self rows counted; an org-global (`hierarchy_path="org"`) invocation row is excluded from a client path but INCLUDED for an unrestricted internal caller (`scope_paths=None`). Two-org fence: seed org A + org B, assert an org-A caller's overview never counts org-B rows (org_id fence).
  - [x] **Run on live Postgres.** `date_trunc`, JSONB `->>`, ltree `<@` are meaningless against a mock (Epic 6/8/9.1 integrity lesson). Set **`AUTH_BACKEND=dev`** for API-driven tests (the dev container defaults to `cognito` → 401s DevAuthProvider tokens): `docker compose exec -e AUTH_BACKEND=dev api pytest ...`. **Rebuild the `api` image before pytest** (it bakes source — 9.1/9.2/8.4 lesson).

- [x] **Task 6 — Gates & handoff**
  - [x] `ruff check` / `ruff format --check` clean on all touched files.
  - [x] **Regenerate the OpenAPI spec** — `velara-api/docs/api-spec.json` is a review gate (regenerated in 8.5/9.2). Run the export (9.2 note: `PYTHONPATH=/app python scripts/export_openapi.py`, not `docker exec` cwd-relative) so the 3 new `/api/v1/analytics*` paths appear. Verify byte-identical across two runs (determinism).
  - [x] **NO migration** this story (unlike 9.1/9.2). Analytics is pure read over existing tables + config/const additions. (Confirm: head is `0020_audit_log_org_id`; you add no `versions/*.py`.)
  - [x] Handoff note for **9.5** (Usage & Value UI): the FE consumes `GET /api/v1/analytics/overview` → `{data: AnalyticsOverview, meta}`, `GET /api/v1/analytics/users` → `{data: {users: [...]}, meta}`, `GET /api/v1/analytics/users/{user_id}` → `{data: AnalyticsUserDetail, meta}`. **The `surfaces[]` breakdown and per-activity `surface` are NOT supplied** (descoped — no data source); 9.5 must omit the "By surface" card and the surface segment of `recent_activity` detail lines. The mock's hardcoded value stats beyond hours/cost-avoided (`6.2× proposal velocity`, `governed invocations`, `reusable IP assets`, `+18% vs prior`) are **not** in the API — 9.5 should drop them or treat as static prose until a story adds them (call out at 9.5 create-story).

### Review Findings

<!-- bmad-code-review 2026-07-03 — 3-layer adversarial (Blind Hunter, Edge Case Hunter, Acceptance Auditor); all layers ran. 7 findings dismissed as noise/spec-compliant. -->

- [x] [Review][Patch] **(was Decision — RESOLVED 2026-07-03: move to `/overview`)** Overview route URL contradicts AC1 + the 9.5 handoff — AC1/handoff say `GET /api/v1/analytics/overview`, route is `@router.get("")`. Decision: the AC/handoff URL is canonical; rename the route to `/overview`, update tests, regenerate the spec. **APPLIED** — route + tests + spec all now serve `/api/v1/analytics/overview`. [app/api/v1/analytics.py:33]
- [x] [Review][Patch] **(was Decision — RESOLVED 2026-07-03: success-only)** Value metrics counted failed/blocked/cancelled runs as hours-saved dollars. Decision: compute `hours_saved`/`value_cost_avoided` from `outcome="success"` rows only; AC7 amended; tests updated (failure row asserted NOT to count). **APPLIED.** [app/services/analytics_service.py:181-185]
- [x] [Review][Patch] **(was Decision — RESOLVED 2026-07-03: fill real prices)** `_MODEL_PRICING` shipped placeholder Opus figures ($15/$75 per MTok). **APPLIED** — confirmed against the published Anthropic rate card 2026-07-03: `claude-opus-4-8` = **$5/MTok input, $25/MTok output** (placeholder overstated cost 3×); `_DEFAULT_PRICING` now references the map entry (no drift). [app/services/analytics_service.py:38-44]
- [x] [Review][Patch] **Uncaught `UserDirectoryError` → 500 on both user endpoints under Cognito.** **APPLIED** — new `_user_names()` helper catches `UserDirectoryError` → `{}` (names degrade to raw user_ids; metrics unaffected). Sibling `users.py` keeps its 502 (empty picker must be an error there). [app/services/analytics_service.py]
- [x] [Review][Patch] **`_token_cost` 500s the overview permanently on any non-integer token value.** **APPLIED** — numeric-string regex guards (`~ '^[0-9]+(\.[0-9]+)?$'`, NULL-tolerant) exclude malformed rows ($0, consistent with the no-token gap); cast switched Integer→`Numeric` (survives >int4 and floats); `_DEFAULT_PRICING = _MODEL_PRICING["claude-opus-4-8"]`. New regression test seeds a malformed + a 3B-token row. [app/services/analytics_service.py]
- [x] [Review][Patch] **Week bucketing depends on the DB session timezone.** **APPLIED** — `date_trunc('week', timezone('UTC', created_at))` pins truncation to UTC to match the Python-side UTC Monday bucket keys; all window bounds now bind tz-aware UTC datetimes (`_utc_midnight`) instead of bare dates. [app/services/analytics_service.py]
- [x] [Review][Patch] **`_top_skills` has no deterministic tiebreaker at the LIMIT cutoff.** **APPLIED** — `.order_by(func.count().desc(), AuditLogEntry.skill_id)` (list_entries idiom) + a tie-determinism regression test. [app/services/analytics_service.py]
- [x] [Review][Patch] **New config constants lack Field bounds.** **APPLIED** — `Field(default=42, gt=0)` / `Field(default=150.0, ge=0)`, matching neighboring settings; bad env values now fail fast at startup. [app/core/config.py:203-204]
- [x] [Review][Patch] **Test hardening — several checked subtasks were weaker than their [x] claims.** **APPLIED** (24 → 30 tests): (a) exact success-rate math (3/4 = 75.0) on a path-isolated scope; (b) 12-bucket test asserts bucket PLACEMENT (index 11 = now, index 6 = 5 weeks ago, rest 0); (c) `recent_activity` newest-first asserted on distinct timestamps; (d) the "code run" row now really seeds `runtime_type="code"` (`_seed_entry` grew a param); (e) org-fence test now asserts `overview` before/after an org-B insert (plus the original `list_users` check); (f) unauthenticated → 401 on all 3 routes; (g) new gate test proves `/users/{id}` 404s client/consultant on a URL that 200s for ma_tech. [tests/integration/api/test_analytics.py]
- [x] [Review][Defer] **Unbounded all-time aggregate scans + unpaginated users list** [app/services/analytics_service.py:135-177,237-246] — deferred, accepted at current volume (spec chose all-time totals + flat list); revisit with a created_at floor/caching/pagination as the audit log grows.
- [x] [Review][Defer] **Blocking sync Cognito `ListUsers` pagination on the event loop** [app/services/analytics_service.py:251,313] — deferred, pre-existing 8.5 pattern (users.py does the same); now reached from 2 more endpoints, and `user_detail` fetches the full directory to resolve one name. Revisit with `run_in_executor`/caching or a `get_user(id)` provider method.

## Dev Notes

### What this story IS (and is NOT)

**IS:** three NEW internal-grantor-only read endpoints under `GET /api/v1/analytics/*` that **aggregate** the existing `audit_log_entries` table (9.1 write path, 9.2 query API — both DONE + merged). Plus the platform's **first aggregation code** (no `group_by`/`avg`/`sum`/`date_trunc` exists yet), a greenfield **token→$ pricing map**, and greenfield **value config constants** (hours-saved / cost-avoided). Reuses `HierarchyScope` + `RejectNonGrantor` (8.1/8.7 + the 2026-07-02 consultant-exclusion). Reuses `audit_service.list_entries` verbatim for per-user recent-activity.

**IS NOT:** any write path (analytics never mutates — AC4), any migration (pure read + config), any UI (9.5), any new invocation-surface tracking (descoped — no data source), the audit query API (9.2, done). Do NOT touch `record_invocation`/`record_admin_action`, `queue_invocation`, or any write caller.

### The sibling template: `app/api/v1/audit.py` (9.2, just shipped)

Structurally the closest analog for the ROUTE layer (same deps, same envelope, same `_meta`, same scope-derivation). The SERVICE layer, however, has **no template** — this is the first aggregation surface. Base the WHERE-clause construction on `audit_service.list_entries` (`app/services/audit_service.py:170-257`) but the `func.count/avg/sum` + `group_by` + `date_trunc` are all net-new.

### The scope + org idioms (get these exactly right — copy from `list_entries`)

- **Org fence (post-0020):** `AuditLogEntry.org_id == org_id` — `audit_log_entries` now HAS an `org_id` column (migration 0020, the 9.2 post-review fix). **Do NOT** fence by a hierarchy_path prefix (`'org' <@ org_root` is FALSE → silently drops org-global invocation rows; this exact bug is what 0020 fixed — see `project-epic9-audit-query-api` memory + `audit_service.py:191-200` docstring).
- **Hierarchy scope (`<@` ltree):** `text("hierarchy_path <@ ANY(CAST(:paths AS ltree[]))").bindparams(paths=scope_paths)` — asyncpg has no ltree codec; bind a `list[str]` and CAST server-side. `<@` = descendant-or-self.
- **Empty-scope short-circuit:** `if scope_paths is not None and len(scope_paths) == 0: return <empty result>` BEFORE building the query — never CAST an empty array. Internal grantor roles are `unrestricted=True` → route passes `scope_paths=None` → org fence only.
- **Route derivation:** `paths = None if scope.unrestricted else scope.scope_paths` (`audit.py:99`).

### Invocation-only filter (the aggregation gotcha)

The audit table is a **general** event log — it holds `admin.*` rows (grant/lifecycle/cert; `outcome=NULL`, `skill_id=NULL`, `hierarchy_path="org"`) and fan-out **parent** rows (`event_type="invocation.fan_out"`, `outcome=NULL`). Analytics counts **invocations**, so every aggregation must filter to invocation *leaf* rows. **Use `AuditLogEntry.outcome.isnot(None)`** as the invocation predicate — it excludes both admin rows AND the fan-out parent in one clause (both have `outcome=NULL`), leaving the child leaf entries and single-job entries. Document this in a service comment. (Cross-check: `event_type` values are `invocation.success|failure|cancelled|blocked|fan_out` + `admin.*` per `app/models/audit.py`.)

### Token cost — what's actually in the data (AC6)

- 9.1 forwards `event_metadata = {"input_tokens", "output_tokens", "model"}` for `prompt`/`hybrid` runs at the **success/blocked** audit sites only (`execution_tasks.py:82,85-94,252,275`). The **failure** site (`execution_tasks.py:319-333`) and **cancel** site (`job_service.py:303-315`) pass NO metadata → those rows have `event_metadata=NULL`. `code` runs never produce tokens (`event_metadata=NULL`). **So token/cost sums are complete only for successful/blocked prompt/hybrid runs — a documented gap, not a bug.** Summing over `event_metadata IS NOT NULL` naturally handles this.
- **Only one model string exists in data today: `"claude-opus-4-8"`** (`settings.ANTHROPIC_MODEL`, `config.py:184`, propagated verbatim). Author the pricing map keyed by the model string anyway (future-proof) with `_DEFAULT_PRICING` fallback so a model swap never zeros cost.
- ⚠️ **Confirm real Opus pricing** before shipping the map — the numbers in Task 1 are illustrative placeholders. If you can't confirm, keep them and flag loudly in Completion Notes so the reviewer/PM sets real prices. The pricing is a config concern, not correctness — the *derivation* is what this story owns.

### Value metrics — config-driven, no data source (AC7)

`hours_saved` and `value_cost_avoided` have **zero** upstream source (repo-wide grep: no `hours_saved`/`time_saved`/`value_*`/`minutes_saved` anywhere). Product decision (2026-07-03): derive them from config constants this story owns — `MINUTES_SAVED_PER_RUN=42` (matches the mock's stated "modeled at 42 min / run", `internal2.jsx:298`) and `BLENDED_LABOR_RATE_USD` ($/hour). `hours_saved = invocations × 42/60`; `value_cost_avoided = hours_saved × rate`. The dollar figure is **value delivered / "delivery cost avoided"** (the mock's `$412K` label `internal2.jsx:357`), NOT token spend — keep `value_cost_avoided` (labor value) and `token_cost` (LLM spend) as two distinct fields.

### User identity & name resolution (AC2/#3)

There is **no users DB table.** The right source for "users with activity" is **distinct `user_id` from in-scope audit rows** (the audit table carries `user_id`, is org+scope-fenced, and `{user_id}` in the route is naturally an audit user_id). Audit stores only the opaque `user_id`, not a name — resolve display names via the **auth directory**: `get_auth_provider().list_users()` → `UserSummary{user_id, name, email, role}` → build a `{user_id: name}` map ONCE per request, splice `name` (fallback to `user_id` for departed users). See `app/integrations/auth.py:129-185`; `DevAuthProvider._SEED_USERS` seeds 6 users for tests. Do NOT filter the directory by role here (it's a grantee picker, not activity).

### Descope & follow-ups (surface breakdown)

The epic's per-user AC lists "invocation surfaces (Web/API/Claude)". **Descoped 2026-07-03** — unbuildable from existing data: `invocations.py` (Web/API), `invoke.py` (Claude proxy), and `client.py` (Client Portal) all call the identical `queue_invocation`, distinguished only by a `log_prefix` string (`invoke.py:63-67`, `client.py:197-201`) — nothing persists the surface on `invocation_jobs` or the audit table. Building it needs a `surface`/`source` column + stamping at 3 entrypoints (+ a migration + audit-metadata plumbing), which belongs in its own story, not a "derived from existing data" analytics API. The API omits `surfaces[]` and per-activity `surface`; 9.5 omits the "By surface" card. **Follow-up:** a future story adds a `surface` column stamped at the 3 entrypoints, forwarded into audit metadata, then re-enables the breakdown here.

### Files being touched

- `app/core/config.py` (ADD `MINUTES_SAVED_PER_RUN`, `BLENDED_LABOR_RATE_USD` — no other change)
- `app/services/analytics_service.py` (NEW — `overview`, `list_users`, `user_detail` + `_MODEL_PRICING`/`_DEFAULT_PRICING` + `_scope_where` helper)
- `app/schemas/analytics.py` (NEW — the ~7 response schemas)
- `app/api/v1/analytics.py` (NEW — 3 routes)
- `app/api/v1/router.py` (register the new router)
- `tests/integration/services/test_audit_service.py` (extend) OR `tests/integration/api/test_analytics.py` (NEW)
- `velara-api/docs/api-spec.json` (regenerate — spec gate)
- **NO migration** (pure read + config).

### Test environment gotchas (from 9.1/9.2)

- `AUTH_BACKEND=dev` required for API-driven tests (dev container defaults to `cognito` → 401s DevAuthProvider tokens): `docker compose exec -e AUTH_BACKEND=dev api pytest ...`.
- **Rebuild the `api` image before pytest** (it bakes source).
- `tests/conftest.py` forces `velara_test` DB + `alembic upgrade head` (session autouse). `client` fixture = ASGI `httpx.AsyncClient`. `DevAuthProvider` seeds `ma.tech`→`org_vitalief`, `client.user`→`org_client_001` (two orgs for cross-org isolation).
- ⚠️ **Org-root subtlety (9.2 debug lesson):** the actual `hierarchy_path` root a real client/project/study is built from is `_org_segment(org_id) = "org_" + org_id` (e.g. `org_org_vitalief`), NOT the raw `org_id` string. But post-0020, analytics fences on the `org_id` **column** (`AuditLogEntry.org_id == org_id`), not a path prefix — so seed rows with `org_id="org_vitalief"` (the raw JWT value) and a `hierarchy_path` under the scope you're testing. Keep `org_id=` seed values = the raw org string; keep `hierarchy_path=` seed values = a real `org_<orgid>.client_<id>...` path (or `"org"` for org-global).
- Pre-existing unrelated failures: 3 `test_ingest.py` MinIO presign tests fail in-container (localhost/minio hostname mismatch) — NOT a regression, ignore.

### Project Structure Notes

- Route file per resource in `app/api/v1/`; service in `app/services/`; schemas in `app/schemas/`. This story adds one of each + two config constants — fully aligned, no structural variance, no migration.
- Query params (if any added later) snake_case; response envelope + `ResponseMeta` mandatory (never bare objects). The overview and user-detail responses are single objects under `data` (no `PageMeta`); the users list is a flat `{users: [...]}` (small set — no pagination).

### References

- [Source: epics/epic-9-audit-log-usage-analytics.md#Story 9.4] — the 5 epic ACs (overview aggregate, users list, per-user drill-down, read-only/no-PHI, internal-only). Note the surface-breakdown descope and the field-name concretization here.
- [Source: velara-api/app/api/v1/audit.py:25,34-38,75-99,148-149] — **the route template**: `RejectNonGrantor` router dep, `_meta(request)`, `HierarchyScope`→`paths = None if scope.unrestricted else scope.scope_paths`, `ResponseEnvelope(data=..., meta=_meta(request))`.
- [Source: velara-api/app/services/audit_service.py:170-257] — **the WHERE-clause base to reuse**: `AuditLogEntry.org_id == org_id` org fence, `text("hierarchy_path <@ ANY(CAST(:paths AS ltree[]))")` scope filter, empty-scope short-circuit (:217), the `'org' <@ org_root` anti-pattern docstring (:191-200) that 0020 fixed.
- [Source: velara-api/app/core/dependencies.py:117,178,204-225] — `_GRANTOR_ROLES={"admin","ma_tech"}`, `RejectNonGrantor` (:225, consultant+client→404), `HierarchyScope`/`HierarchyScopeValue` (:120-178), `CurrentUser`/`DbSession`.
- [Source: velara-api/app/models/audit.py] — the table 9.4 aggregates: `event_type`, `outcome` (`success|failure|cancelled|blocked`, NULL for admin/fan-out-parent), `user_id`, `org_id` (0020), `hierarchy_path`, `skill_id`, `created_at`, `started_at`/`completed_at`, `event_metadata`→col `"metadata"` (JSONB with `input_tokens`/`output_tokens`/`model` for prompt/hybrid). `OUTCOME_*`/event_type constants.
- [Source: velara-api/app/workers/execution_tasks.py:82,85-94,252,275,319-333] — token-metadata extraction (`_TOKEN_METADATA_KEYS`, `_extract_token_metadata`); success/blocked forward tokens, **failure does NOT** → NULL metadata gap.
- [Source: velara-api/app/core/config.py:184] — `ANTHROPIC_MODEL="claude-opus-4-8"` = the only model string in token metadata today; where the two new value constants go.
- [Source: velara-api/app/integrations/auth.py:61-74,129-185,273-299] — `UserSummary{user_id,name,email,role}`, `AuthProvider.list_users`, `DevAuthProvider._SEED_USERS` (name resolution for AC2/#3).
- [Source: velara-api/app/schemas/audit.py:13-54] — schema style to mirror (`ConfigDict(from_attributes=True)`, `{items/users, ...}` under `data`).
- [Source: velara-api/app/schemas/common.py:15-38] — `ResponseEnvelope`/`ResponseMeta`/`PageMeta` shapes.
- [Source: velara-api/app/api/v1/router.py:5-19,34] — register the new `analytics` router after `audit`.
- [Source: velara-api/app/api/v1/invoke.py:63-67 + invocations.py:135,162 + client.py:197-201] — the three invocation entrypoints all call `queue_invocation`, distinguished only by `log_prefix` → why surface is unbuildable (descope rationale).
- [Source: design/internal2.jsx:171-505 (Analytics fn) + design/data.js:227-262] — the mock 9.5 renders; the field inventory the API supplies (overview KPIs, 12-week `series`, top-6 skills, per-user scalars, `weekly`, `recent_activity`); "42 min/run" (:298) + "$ delivery cost avoided" (:357) value framing. `surfaces[]` (mock :182-240) is the descoped card.
- [Source: velara-api/tests/integration/services/test_audit_service.py:83-95] — `_auth_headers(role)` dev-token minting; audit seeding to extend.
- [Source: velara-api/tests/integration/api/test_access_grants.py:350-401] — calling a scope function directly against a live session (template for the service-level scope test).
- [Source: story 9-2-audit-log-query-api.md] — the shipped query API this story reuses (`list_entries` for recent-activity); `AUTH_BACKEND=dev` + rebuild-image + spec-regen + org-root-`_org_segment` debug notes; the 0020 org_id-column fix.
- [Source: story 9-1-audit-log-write-path.md] — the write path + token-metadata forwarding 9.4 reads; the failure/cancel no-metadata gap.
- Forward-dep: **9.5** (Usage & Value UI consumes all three endpoints; surfaces card omitted; static mock value-stats not API-supplied).
- Memory: `project-consultant-oversight-exclusion` (gate Analytics with `RejectNonGrantor` — the explicit "when 9.4/9.5 built" directive), `project-epic9-audit-query-api` (0020 org_id fix, ltree idiom), `project-epic9-audit-write-path` (token-cost folded into 9.1, cost→9.4).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Code)

### Debug Log References

- `docker compose build api` + `docker compose up -d api` — rebuilt the `api` image twice (source is baked, not bind-mounted for the `api`/`worker` services) so new modules and the new test file were picked up before running ruff/pytest.
- `docker compose exec -T -e AUTH_BACKEND=dev api pytest tests/integration/api/test_analytics.py -v` → 24/24 passed.
- `docker compose exec -T -e AUTH_BACKEND=dev api pytest -q` (full suite) → 1016 passed, 3 pre-existing failures (`test_ingest.py` MinIO presign localhost/minio hostname mismatch — documented in story Dev Notes as NOT a regression).
- `docker compose exec -T api ruff check` / `ruff format --check` on all touched files → clean.
- `PYTHONPATH=/app python scripts/export_openapi.py` run twice → byte-identical `docs/api-spec.json`, confirms all 3 new `/api/v1/analytics*` paths registered.

### Completion Notes List

- Implemented all 3 read-only endpoints (`GET /api/v1/analytics`, `/users`, `/users/{user_id}`) exactly per the story's Dev Notes/task breakdown — no scope creep.
- **Token pricing (AC6):** used the story's provided illustrative Opus pricing ($15/$75 per 1M input/output tokens) verbatim in `_MODEL_PRICING`. These are **placeholder figures per the story's own instruction** ("if you can't confirm, keep them and flag loudly") — not verified against a real, current published rate card. **Flagging for reviewer/PM: confirm real Opus pricing before this ships to prod”; `_DEFAULT_PRICING` fallback covers any future/unknown model string so a model swap never silently zeros cost.**
- **Value constants (AC7):** `MINUTES_SAVED_PER_RUN=42` (matches the mock's stated modeling assumption) and `BLENDED_LABOR_RATE_USD=150.0` (a reasonable blended US consulting/technical labor rate — a modeling assumption, not sourced from any product data; tunable via env without a migration).
- **Token cost query approach:** used the SQL-grouped approach (group by `event_metadata["model"].astext`, `func.sum(cast(...))` for input/output token sums) rather than the row-scan alternative, per the story's stated preference ("Recommend the SQL-grouped approach").
- **Top-skills count:** overview uses top 6 (AC1), per-user drill-down uses top 5 (AC3) — both explicitly called out as acceptable choices in the story.
- **`trend_pct`:** `None` when the prior 12-week window has zero rows (story's suggested guard choice), otherwise `(this-prior)/prior*100`.
- Reused `audit_service.list_entries` verbatim for `recent_activity` (no reimplementation) and reused the exact `_scope_where`/empty-scope-short-circuit idiom from `audit_service.list_entries`.
- No migration added — pure read + 2 new config constants, as scoped.
- `app/services/analytics_service.py` reformatted once by `ruff format` inside the container after authoring (container has no bind mount for `app`/`tests`, so the formatted copy was pulled out and written back to the host file — noted here since it's an unusual mechanical step, not a design decision).

### File List

- `velara-api/app/core/config.py` (modified — added `MINUTES_SAVED_PER_RUN`, `BLENDED_LABOR_RATE_USD`)
- `velara-api/app/services/analytics_service.py` (new — `overview`, `list_users`, `user_detail` + `_MODEL_PRICING`/`_DEFAULT_PRICING` + `_scope_where`/`_invocation_where` helpers)
- `velara-api/app/schemas/analytics.py` (new — response schemas: `WeeklyBucket`, `SkillRun`, `AnalyticsOverview`, `AnalyticsUserSummary`, `AnalyticsUsersData`, `ActivityRow`, `AnalyticsUserDetail`)
- `velara-api/app/api/v1/analytics.py` (new — 3 routes, `RejectNonGrantor`-gated)
- `velara-api/app/api/v1/router.py` (modified — registered the `analytics` router after `audit`)
- `velara-api/tests/integration/api/test_analytics.py` (new — 24 tests covering AC1–AC7)
- `velara-api/docs/api-spec.json` (regenerated — 3 new `/api/v1/analytics*` paths; verified deterministic across two export runs)

## Change Log

- 2026-07-03: Implemented Story 9.4 — Usage & Value Analytics API. 3 new `GET /api/v1/analytics/{overview,users,users/{user_id}}` endpoints (internal-grantor-only, `RejectNonGrantor`), the platform's first aggregation service (`analytics_service.py`), a greenfield token-cost pricing map, and greenfield value/hours-saved config constants. No migration. 24 new integration tests (all AC1–AC7), full regression suite green (1016 passed, 3 pre-existing unrelated `test_ingest.py` failures). OpenAPI spec regenerated.
- 2026-07-03: Code review (3-layer adversarial) → done. 3 decisions resolved with the user (overview route moved to `/api/v1/analytics/overview` per AC1/9.5-handoff; value metrics restricted to successful runs, AC7 amended; real Opus pricing filled in — $5/$25 per MTok, placeholder had overstated 3×) + 6 patches applied (UserDirectoryError graceful degradation, malformed-token-value guard + Numeric cast, UTC-pinned week bucketing/window bounds, top-skills skill_id tiebreaker, config Field bounds, test hardening 24→30 tests). 2 deferred to deferred-work.md (unbounded all-time scans + unpaginated users list; blocking sync Cognito ListUsers). 7 findings dismissed as spec-compliant/noise. Gates: ruff clean, 30/30 analytics tests, full suite 1022 passed (same 3 pre-existing ingest failures), spec regenerated byte-identical with the new `/overview` path.
