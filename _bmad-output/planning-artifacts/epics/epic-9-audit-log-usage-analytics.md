# Epic 9: Audit Log, Usage & Analytics

Operators and consultants can query the immutable, append-only audit log by any combination of hierarchy path, user, skill, time window, and outcome — and analyze platform usage and value in a **Usage & Value (Analytics)** screen with an aggregate **Overview** and a per-user **By-User** view. The audit log doubles as the **21 CFR Part 11** electronic-records trail (secure, UTC-time-stamped, attributable, tamper-evident).

## Story 9.1: Audit Log Write Path

As a platform developer,
I want every skill invocation, access event, and administrative action written to an append-only audit log with the full hierarchy path,
So that the platform has a complete, tamper-resistant record of all significant events.

**Acceptance Criteria:**

**Given** the Alembic migration for `audit_log_entries` runs
**When** I inspect the schema
**Then** the table is partitioned by month (PostgreSQL declarative partitioning on `created_at`) and has: `id`, `event_type`, `user_id`, `hierarchy_path` (ltree), `skill_id`, `skill_version`, `job_id`, `outcome`, `metadata` (JSONB), `created_at`

**Given** any skill invocation completes (success or failure)
**When** `audit_service.record_invocation()` is called
**Then** an `AuditLogEntry` is written with all required fields including full `hierarchy_path` — no fields are nullable except those genuinely optional (e.g., `skill_version` for non-skill events)

**Given** a fan-out invocation completes
**When** audit entries are written
**Then** one parent entry is created with `event_type: "invocation.fan_out"` and N child entries each with `parent_invocation_id` linking to the parent

**Given** an audit log entry is written
**When** any user or process attempts to UPDATE or DELETE that row
**Then** the database-level constraint (trigger or policy) prevents the modification — the table is append-only

**Given** 21 CFR Part 11 electronic-records requirements (FR-SEC-09)
**When** an audit entry is written
**Then** it is attributable to a unique `user_id`, carries a UTC `created_at` timestamp, and is tamper-evident (append-only — no UPDATE/DELETE) — satisfying §11.10(e): a secure, computer-generated, time-stamped audit trail

**Given** an admin action is performed (e.g., granting access, changing a lifecycle state)
**When** `audit_service.record_admin_action()` is called
**Then** an entry is written with `event_type: "admin.*"` and the relevant context

---

## Story 9.2: Audit Log Query API

As a Vitalief consultant or operator,
I want to query the audit log with filters for hierarchy path, user, skill, time window, and outcome,
So that I can investigate any invocation history or compliance question without direct database access.

**Acceptance Criteria:**

**Given** I call `GET /api/v1/audit` with no filters
**When** the response is returned
**Then** I see audit entries within my hierarchy scope — entries outside my granted scope are excluded by the `hierarchy_scope` dependency

**Given** I call `GET /api/v1/audit?client_id={id}&skill_id={id}`
**When** the query runs
**Then** only entries matching both the client hierarchy path and skill ID are returned

**Given** I call `GET /api/v1/audit?from=2026-01-01&to=2026-06-30`
**When** the query runs
**Then** only entries with `created_at` in that range are returned; the query uses the ltree index and partition pruning for efficiency

**Given** I call `GET /api/v1/audit?outcome=failed`
**When** the query runs
**Then** only entries with `outcome: "failed"` are returned

**Given** results are paginated
**When** I call with `?page=2&page_size=50`
**Then** the correct page of results is returned with `meta.total_count` and `meta.next_page` in the response envelope

---

## Story 9.3: Audit Log UI

As a Vitalief consultant or operator,
I want an audit log view in the internal portal with filters and invocation detail drill-down,
So that I can review usage, investigate anomalies, and answer compliance questions from the UI.

**Acceptance Criteria:**

**Given** I navigate to the Audit Log tab
**When** the page loads
**Then** I see a paginated table of audit entries with columns: timestamp, user, event type, skill name, hierarchy path (Client/Project/Study), and outcome badge

**Given** I apply filters (client, skill, time range, outcome)
**When** the filtered query runs
**Then** the table updates to show only matching entries; the active filters are displayed as dismissible chips

**Given** the audit log filters include a date range
**When** I pick a start and end date in the **date-range picker**
**Then** the table shows only entries with `created_at` within that range (calls `GET /api/v1/audit?from=&to=`), and the selected range appears as a dismissible chip

**Given** I click on an audit entry
**When** the detail panel opens
**Then** I see: full hierarchy path, job ID (if applicable), skill version, duration, outcome, and for fan-out invocations — the child invocation list with per-location outcomes

**Given** a fan-out parent entry is shown
**When** I expand it
**Then** the child entries for each location are shown inline with their individual outcomes and output links

**Given** I am a client-scoped user viewing the client portal
**When** I try to access the audit log
**Then** the audit log tab is not present — the audit log is an internal-only surface

---

## Story 9.4: Usage & Value Analytics API

As a Vitalief operator,
I want aggregate and per-user usage/value metrics endpoints,
So that the Usage & Value screen can show platform-wide trends and drill into an individual user's activity.

> Added 2026-06-08 (design: `internal2.jsx` → `Analytics`, FR-USE-06). Analytics is **derived** from existing audit + invocation data — not a new source of truth.

**Acceptance Criteria:**

**Given** I call `GET /api/v1/analytics/overview`
**When** the response is returned
**Then** it includes aggregate metrics within my hierarchy scope: total invocations, success rate, a usage time-series (e.g. last 12 weeks), top skills by run count, and value/hours-saved — all filtered by the `hierarchy_scope` dependency

**Given** I call `GET /api/v1/analytics/users`
**When** the response is returned
**Then** it lists users in scope with summary metrics (invocations, success rate, skills used)

**Given** I call `GET /api/v1/analytics/users/{user_id}`
**When** the response is returned
**Then** it returns that user's metrics: invocations, success rate, skills used, avg runtime, trend, hours-saved, top skills, invocation surfaces (Web/API/Claude), and recent activity (merged invocations + audit)

**Given** analytics queries run
**When** they execute
**Then** they read the existing audit/invocation tables (read-only), respect hierarchy scope, and expose only aggregate counts/durations — no PHI

**Given** a client-scoped token calls any `/api/v1/analytics/*` route
**When** the request is evaluated
**Then** it is rejected — analytics is an internal-only surface (no analytics routes on the client router prefix)

---

## Story 9.5: Usage & Value Analytics UI (Overview + By User)

As a Vitalief operator,
I want a Usage & Value screen with an Overview tab and a By-User tab,
So that I can see platform-wide adoption and value, and analyze metrics for an individual user.

**Acceptance Criteria:**

**Given** I navigate to the Usage & Value (Analytics) tab
**When** the page loads
**Then** the **Overview** tab shows aggregate metrics: total invocations, a usage time-series chart, top skills, and a value/hours-saved summary — sourced from `GET /api/v1/analytics/overview`

**Given** I switch to the **By User** tab
**When** the tab opens
**Then** I can select an individual user and see their metrics: invocations, success rate, skills used, avg runtime, trend, hours-saved, top skills, invocation surfaces, and recent activity — sourced from `GET /api/v1/analytics/users/{user_id}`

**Given** I change the selected user
**When** the selection updates
**Then** the By-User panel re-renders with that user's metrics without a full page reload

**Given** the internal nav strip
**When** it renders
**Then** "Usage & Value" appears as its own tab (per UX-DR-02 / UX-DR-13) — distinct from the Audit Log tab

**Given** I am a client-scoped user
**When** the client portal renders
**Then** the Usage & Value tab is not present — analytics is internal-only
