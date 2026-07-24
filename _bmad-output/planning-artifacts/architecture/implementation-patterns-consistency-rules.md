# Implementation Patterns & Consistency Rules

## Naming Patterns

**Database — snake_case throughout:**
- Tables: plural snake_case → `skills`, `skill_versions`, `invocation_jobs`, `audit_log_entries`
- Columns: snake_case → `skill_id`, `created_at`, `hierarchy_path`
- Foreign keys: `{table_singular}_id` → `skill_id`, `project_id`, `created_by_user_id`
- Indexes: `idx_{table}_{column(s)}` → `idx_skills_status`, `idx_invocation_jobs_created_at`
- ltree path column: always named `hierarchy_path` on every hierarchical entity

**API endpoints — plural nouns, kebab-case segments:**
- Collections: `GET /api/v1/skills`, `GET /api/v1/invocation-jobs`
- Resource: `GET /api/v1/skills/{skill_id}`
- Actions (non-CRUD verbs): `POST /api/v1/skills/{skill_id}/certify`, `POST /api/v1/invocation-jobs/{job_id}/cancel`
- Path params: snake_case → `{skill_id}`, `{project_id}`
- Query params: snake_case → `?status=draft&client_id=...`
- JSON fields: snake_case in all request/response bodies (Pydantic default)

**Python (velara-api):** PEP 8 — `snake_case` functions/variables, `PascalCase` classes, `SCREAMING_SNAKE_CASE` module constants.

**TypeScript (velara-web):** `camelCase` variables/functions, `PascalCase` components/types/interfaces, `SCREAMING_SNAKE_CASE` constants. File naming: `PascalCase.tsx` components, `camelCase.ts` utilities/hooks.

---

## Structure Patterns

**velara-api:**
```
app/
  api/v1/       ← route handlers, one file per resource (skills.py, jobs.py, …)
  core/         ← config, security, dependencies (auth, scope resolution)
  models/       ← SQLAlchemy ORM models
  schemas/      ← Pydantic request/response schemas
  services/     ← business logic (skill_service.py, execution_service.py, …)
  workers/      ← Celery task definitions
  db/           ← Alembic migrations + session factory
tests/unit/ + tests/integration/   ← co-located with source where practical
```

**velara-web:**
```
src/
  features/           ← one directory per domain
    engagements/      ← components/, hooks/, types.ts
    skills/
    run/
    admin/
    client-portal/
  shared/             ← reusable components, utils, design tokens
  routes/             ← route definitions (internal.tsx, client.tsx)
  stores/             ← Zustand stores
  api/                ← TanStack Query hooks + Axios client
```

Tests are **co-located**: `skill_service_test.py` beside `skill_service.py`; `SkillCard.test.tsx` beside `SkillCard.tsx`.

---

## Format Patterns

**API response envelope (all responses):**
```json
{ "data": { ... }, "meta": { "request_id": "...", "timestamp": "2026-06-02T14:00:00Z" } }
```
**Error envelope:**
```json
{ "error": { "code": "SKILL_NOT_FOUND", "message": "...", "request_id": "..." } }
```
- `code`: SCREAMING_SNAKE_CASE, stable (used for client-side error mapping)
- `message`: user-safe — no PHI, no stack traces
- HTTP status: 200 success, 202 async accepted, 400 validation, 401 unauth, 403 forbidden, 404 not found, 422 schema error, 500 internal
- Dates: ISO 8601 UTC → `"2026-06-02T14:00:00Z"`. Frontend formats for display via `Intl.DateTimeFormat`.

**List endpoint pagination (offset/limit):** *(added 2026-06-12 — sprint-change-proposal-2026-06-12.md; first applied in Story 5.6 to `GET /api/v1/skills`)*
- Query params: `page` (≥1, default 1), `per_page` (default 50, max 200). Existing filters (e.g. `?status=`, `?tag=`) compose with pagination.
- Response carries `PageMeta` (`total`, `page`, `per_page`) — defined in `app/schemas/common.py`. `total` is the filtered count (same filters applied to the `COUNT(*)`).
- Out-of-range `page` → empty `data` + correct `total` (not 404); invalid `page`/`per_page` → 422.
- Backwards compatible: omitting params returns page 1 at default size. Future list endpoints (e.g. hierarchy lists) SHOULD adopt this same shape.

**Stable enum values:**
- Job status: `queued` → `running` → `completed` | `failed` | `cancelled`
- Skill lifecycle: `draft` → `internal_ready` → `client_ready` → `retired`
- Skill visibility: `internal_only` | `paired` | `client_facing`

---

## Communication Patterns

- **Celery tasks:** `velara.workers.{module}.{action}` → `velara.workers.execution.run_skill`
- **Zustand stores:** `use{Domain}Store` → `useSkillStore`, `useRunStore`, `useHierarchyStore`
- **TanStack Query keys:** `[resource, id?]` arrays → `['skills']`, `['skills', skillId]`, `['invocation-jobs', jobId]`

---

## Process Patterns

**Error handling:**
- Python: domain exceptions (`SkillNotFoundError`, `HierarchyScopeError`) raised in services, caught in global FastAPI exception handler → error envelope
- TypeScript: TanStack Query `onError` → Sentry capture (sanitized) → toast notification with `error.code` mapped to human message

**Loading states:** Use TanStack Query `isLoading`/`isFetching`/`isError` directly — no hand-rolled loading booleans. Skeleton for initial load; spinner overlay for mutations. Default `staleTime: 30_000ms` for hierarchy/registry data.

**Optimistic updates:** Only for low-stakes metadata edits. Never for certification state changes or job submissions.

**Auth flow:** All `/internal/*` and `/client/*` routes wrapped in `<RequireAuth>`. Unauthenticated → `/login` with post-auth redirect. Token refresh via Amplify SDK — not hand-rolled.

---

## Observability Patterns

**Backend (velara-api):**

| Layer | Tool | Captures |
|-------|------|---------|
| Structured logging | `structlog` + CloudWatch Logs | Every request lifecycle, job transitions, skill execution events — always with `request_id`, `user_id` (opaque), `hierarchy_path`, `duration_ms` |
| Metrics | CloudWatch Metrics (`aws-embedded-metrics`) | Request count, latency P50/P95/P99, job queue depth, job success/failure rate, skill execution duration by type |
| Distributed tracing | AWS X-Ray (FastAPI middleware) | Full trace per request: handler → service → DB → Celery task → Claude API call |
| Error tracking | Sentry (Python SDK) | Unhandled exceptions, sanitized before send, tagged with `skill_id`, `job_id`, environment |
| Health checks | `GET /health` (liveness) + `GET /health/ready` (readiness) | ECS container health; readiness checks DB + Redis connectivity |

Celery workers: every task emits `task.started` and `task.completed`/`task.failed` log entries with `task_id`, `skill_id`, `job_id`, `duration_ms`. X-Ray trace segments propagate through workers via `aws_xray_sdk.core.patch_all()`.

**Frontend (velara-web):**

| Layer | Tool | Captures |
|-------|------|---------|
| Error tracking | Sentry (React SDK + ErrorBoundary) | JS exceptions, render errors, unhandled rejections — PHI sanitizer applied before send |
| Performance | Sentry Performance (Web Vitals) | LCP, FID, CLS per route |
| API call tracing | TanStack Query + custom logger | Query key, duration, cache hit/miss, error code on failure |
| User action breadcrumbs | Sentry breadcrumbs | Key actions (skill run initiated, cert submitted) — IDs only, no PHI |

**CloudWatch dashboards (one per env):** request latency, error rate, job queue depth, worker throughput, active workers. Alarms: error rate > 1%, P95 latency > 3s, queue depth > 50 for 5+ minutes.

---

## Enforcement Rules (All Agents MUST)

1. Use the established response envelope — never return bare objects or bare arrays from API routes
2. Apply `hierarchy_scope` FastAPI dependency on every route touching hierarchical data — never rely on callers to filter
3. Use `snake_case` for all DB columns and JSON API fields — no camelCase in the API layer
4. Assign a `request_id` (UUID) at request start; carry it through logs, response meta, and error envelopes
5. Never log or return raw exception messages to callers — map through the global error handler
6. Never store file content inline in the database — always S3 key + metadata pattern
7. Co-locate tests with source files
8. Sentry `before_send` hook runs the same PHI sanitizer as the logging middleware — one shared sanitizer, two consumers
9. Sentry DSNs stored in AWS Secrets Manager, injected via ECS task environment — never hardcoded
10. **CI must be green before a push to `development`, no exceptions.** *(Added 2026-07-24 — GitHub Actions
    CI failed on push after Story 16.6's code-review patches: `ruff check .` failed on `scripts/demo_seed_hierarchy.py`
    (2 pre-existing E501 lines, never linted before landing on the branch), and `pytest` failed
    `test_every_mutating_route_is_registered` because Story 16.4's `/studies/{study_id}/protocol` routes were
    never added to the audit-coverage registry — a gap Story 16.6's own Dev Agent Record had already logged as
    a known "pre-existing failure," which is not the same as safe-to-push.)*
    - Run `ruff check .` (backend) and `tsc --noEmit && eslint` (frontend) **in the same environment CI uses**
      — not just inside a possibly-stale local Docker container — before every push to a subrepo's tracked branch.
      Run the full test suite the same way; a "gates green" claim in a story's Dev Agent Record is not a
      substitute for actually re-running them against the exact commit being pushed.
    - A test failure logged as "pre-existing, unrelated to this story" in a Dev Agent Record is a note for the
      reviewer, not a license to push. Fix it or get explicit sign-off to defer it (recorded in
      `deferred-work.md` or the story's Review Findings) BEFORE it reaches `origin/<branch>` — CI failing on
      `development` blocks Deploy for everyone, not just the story that introduced the gap.
    - Whoever pushes (`code-review`, per the never-push-subrepos rule) owns confirming CI is green on that push
      — checking `gh run watch` or the Actions tab is part of "push," not a separate follow-up step.
