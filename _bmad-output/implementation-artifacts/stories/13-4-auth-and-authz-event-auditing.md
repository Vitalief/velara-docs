---
baseline_commit: e5281dc
---

# Story 13.4: Authentication & Authorization Event Auditing

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a security operator,
I want authentication and authorization events recorded and monitorable,
so that I can detect credential attacks and access probing, and evidence login monitoring to an auditor.

**The gap is total.** There is **no authentication event of any kind** today, in the app or the cloud layer. Dev login ([auth.py:53-77](../../../velara-api/app/api/v1/auth.py#L53)) writes nothing on success, and its 401 branch writes nothing at all — not even a structlog line with a user identifier. In prod, Cognito owns login and the app never sees it — and **`advanced_security_mode` / `user_pool_add_ons` is not set in `cognito.tf`** (verified absent), so Cognito's own threat-protection and compromised-credential detection are **OFF**. Separately, RBAC **denials** (403/404 from `HierarchyScopeError`, `reject_client`, `reject_non_grantor`) reach only `velara_http_exception_handler` ([exceptions.py:68-80](../../../velara-api/app/core/exceptions.py#L68)), which logs `code` + `status_code` + `request_id` — **no `user_id`, no path, no target resource.** That line cannot distinguish a fat-fingered URL from a client user methodically enumerating another client's jobs. **HIPAA §164.308(a)(5)(ii)(C) names log-in monitoring as an explicit implementation specification; current coverage is zero.**

## Acceptance Criteria

1. **AC1 — Successful authentication is recorded.**
   **Given** a successful authentication
   **When** it completes
   **Then** an `auth.login_succeeded` event is recorded, attributable to the user, org, and UTC time

2. **AC2 — Failed authentication is recorded, with enough context to detect a pattern and NEVER the credential.**
   **Given** a **failed** authentication (bad credentials, or a rejected/expired/invalid token)
   **When** it occurs
   **Then** an `auth.login_failed` event is recorded — with enough context to detect a pattern (attempted identity, source, time) and **never** the submitted credential. This is the §164.308(a)(5)(ii)(C) requirement and the current gap is total.

3. **AC3 — Logout and session/token revocation are recorded.**
   **Given** logout and token/session revocation
   **When** they occur
   **Then** they are recorded (`auth.logout`, `auth.session_revoked`) — closing the loop with 13.2's session kill (a deprovision-driven global sign-out is a `session_revoked`).

4. **AC4 — Authorization denials are recorded, attributably.**
   **Given** an authorization **denial** (403/404 from the hierarchy-scope or role guards)
   **When** it occurs
   **Then** it is recorded with the acting `user_id`, the attempted route, and the target resource — a durable, attributable record, not the current unattributed CloudWatch warning. **⚠️ Design decision required (see Dev Notes "THE DESIGN NOTE"):** decide deliberately whether denials go into `audit_log_entries` (durable, queryable, but high-volume and self-inflicted-noise-prone) or a separate security-event stream with alarms. **Either is defensible; an unattributed structlog line is not.**

5. **AC5 — Repeated failures/denials from one principal fire an alarm.**
   **Given** repeated failed logins or repeated denials from one principal
   **When** they exceed a threshold
   **Then** an alarm fires to the existing SNS topic — detection, not just recording (SOC 2 CC7.2). **Note the existing SNS topic (`aws_sns_topic.alerts`) has ZERO subscriptions by design** ("operators subscribe after apply") — an alarm nobody receives is not a detective control. **Close that loop or say explicitly who subscribes** (a variable-driven subscription, or a documented operator runbook step).

6. **AC6 — Cognito threat protection is enabled; MFA posture reviewed.**
   **Given** Cognito's own threat protection
   **When** the user pool is configured
   **Then** `advanced_security_mode` is enabled (compromised-credential + brute-force detection), and MFA enforcement is reviewed — it is currently `OPTIONAL` in non-dev ([cognito.tf:69](../../../velara-api/terraform/cognito.tf#L69)), and optional MFA is weak evidence for CC6.1. ⚠️ **Terraform against the live auth path — plan only; operator applies.**

7. **AC7 — New event types are categorized (13.1's guard enforces it).**
   **Given** the new `auth.login_succeeded` / `auth.login_failed` / `auth.logout` / `auth.session_revoked` event types this story introduces
   **When** they are added
   **Then** each is assigned to the **Authentication** category in [audit_categories.py](../../../velara-api/app/models/audit_categories.py) (and any denial/threshold-alarm events **persisted to `audit_log_entries`** are assigned to **Security**), and Story 13.1's guard test passes. **These are the FIRST `auth.*` events** — a new event family. **Authentication is one of the three categories 13.1 created EMPTY** ([audit_categories.py:72](../../../velara-api/app/models/audit_categories.py#L72)) precisely for this story to populate.

## Tasks / Subtasks

- [ ] **Task 1 — Add the event-type constants + categorize them (AC1-4, AC7)**
  - [ ] In [app/models/audit.py](../../../velara-api/app/models/audit.py), add the `auth.*` family in its own commented block: `EVENT_AUTH_LOGIN_SUCCEEDED = "auth.login_succeeded"`, `EVENT_AUTH_LOGIN_FAILED = "auth.login_failed"`, `EVENT_AUTH_LOGOUT = "auth.logout"`, `EVENT_AUTH_SESSION_REVOKED = "auth.session_revoked"`. Stable strings, never rename (append-only).
  - [ ] **If** you persist denials to `audit_log_entries` (see THE DESIGN NOTE), add `EVENT_ACCESS_DENIED = "access.denied"` (or `security.access_denied`) too. **If** you route denials to a separate stream, you do NOT add a constant here — but you must still say so.
  - [ ] In [app/models/audit_categories.py](../../../velara-api/app/models/audit_categories.py): the four `auth.*` → `CATEGORY_AUTHENTICATION` (the empty category 13.1 reserved). A persisted `access.denied` → `CATEGORY_SECURITY` (also an empty-today category). Do NOT add any of these to `OUTCOME_BEARING_CATEGORIES` — they have no invocation outcome.
  - [ ] ⚠️ **13.1's guard test auto-discovers `EVENT_*` constants and FAILS until each is categorized** — categorize in the same commit. This is the third story to hit this; it's routine now.

- [ ] **Task 2 — A dev-login audit at the app seam (AC1, AC2 — dev backend)**
  - [ ] [auth.py login route:53-77](../../../velara-api/app/api/v1/auth.py#L53) is the **dev-only** login (`AUTH_BACKEND=dev`). On success (after `issue_token`), write `auth.login_succeeded`; on the `principal is None` 401 branch ([auth.py:67-68](../../../velara-api/app/api/v1/auth.py#L67)), write `auth.login_failed` with the **attempted username** and request source — **never a password** (the dev shim has no password field, but hold the discipline: log the attempted identity, not any credential).
  - [ ] The login route has a `request: Request` but **no `session` param** today. Add `session: DbSession` to the route signature (it's a normal route — `Depends` works). Write the audit via `audit_service.record_admin_action` (or a small `record_auth_event` helper — see Task 4) with `hierarchy_path="org"`, `outcome=None`.
  - [ ] **Best-effort:** wrap in `try/except` + `logger.warning`. A failed audit write must not turn a successful login into a 500, nor mask the real 401 on the failure path. **But on the failure path, write the audit BEFORE raising the 401** (or in a `finally`) — the whole point is that failed logins are recorded, so don't let the `raise` skip the write.
  - [ ] Metadata for `login_failed`: `{"attempted_username": body.username, "source_ip": <client ip>}`. For the source IP see Trap 2 (X-Forwarded-For behind the ALB).
  - [ ] ⚠️ **Flip the coverage-guard registry entry for `POST /api/v1/auth/login`.** It is currently registered `exempt` ("dev-auth-shim login helper … no admin action occurs here") at [test_audit_coverage_guard.py:125](../../../velara-api/tests/unit/test_audit_coverage_guard.py#L125). Once this route audits `auth.login_succeeded`/`auth.login_failed`, that exemption is **false** — but the registry maps one constant per route and this route now writes two `auth.*` events (neither an `admin.*`). The guard's `test_registry_integrity` asserts an audited constant `startswith("admin.")` ([test_audit_coverage_guard.py:276](../../../velara-api/tests/unit/test_audit_coverage_guard.py#L276)) — an `auth.*` constant will FAIL that assertion. **You must relax the guard's integrity check to accept `auth.`/`access.` prefixes, OR keep the entry `exempt` with an updated reason** ("audited via the auth-event seam as `auth.login_*`, not `record_admin_action` — a different-seam exemption, mirroring the invocation-path exemptions"). **Recommend the latter** (exempt-with-updated-reason) — it's consistent with how the invocation routes are exempted (audited via a different seam), needs no guard-mechanism change, and the reason is now truthful. Do NOT leave the stale "no admin action occurs here" reason — it's now false.

- [ ] **Task 3 — Failed-auth at the token-validation seam (AC2 — covers prod + expired/invalid tokens)**
  - [ ] The dev-login failure (Task 2) only covers the dev shim. In **prod**, Cognito owns login and the app never sees it — but the app **does** see every **rejected token**: `get_current_user` ([dependencies.py:138-164](../../../velara-api/app/core/dependencies.py#L138)) raises 401 on a missing/invalid/expired token AND (since 13.2) on a **disabled** user. **These 401s are auth failures and belong in the trail** — a burst of invalid-token 401s from one source is exactly the credential-stuffing signal AC2 wants.
  - [ ] Add an `auth.login_failed` (or a distinct `auth.token_rejected` — decide) write in `get_current_user`'s except branches. ⚠️ **Two hard constraints:**
    - **No `session` in `get_current_user`.** It's the auth dependency; it takes `request` + `credentials` only. Writing an audit row here needs its own `session_scope()` (the `record_admin_action_sync`/`session_scope` pattern at [audit_service.py:158,349](../../../velara-api/app/services/audit_service.py#L158)). **This is an async context** — use an `async with session_scope() as s: await audit_service.record_...(session=s, ...)`, best-effort.
    - **A rejected token often has no resolvable `user_id`** (that's why it was rejected). Record what you *can*: the source IP, the token's `sub` **if** it decoded far enough to have one (an expired-but-well-formed token has a readable `sub`; a garbage token does not), and the failure reason class (`expired` / `invalid` / `disabled`). **Never log the raw token.**
  - [ ] ⚠️ **VOLUME TRAP:** `get_current_user` runs on **every authenticated request**. If a client holds an expired token and the FE keeps polling, you write an `auth.login_failed` row *per request* — the same flooding hazard 13.3 hit with disclosure events (its Trap 3). **Apply the same mitigation:** a short-TTL de-dupe window keyed by `(source_ip, sub_or_ip, reason)`, OR only record the *first* rejection in a window. Reuse 13.3's `record_artifact_disclosure` de-dupe approach (it already established the `_DISCLOSURE_DEDUPE_WINDOW` pattern in `audit_service`). **Do not ship per-request failed-auth writes without this** — it converts the audit table into a self-DoS.

- [ ] **Task 4 — Logout + session-revocation events (AC3)**
  - [ ] `auth.session_revoked`: **13.2 already added `disable_user` → `AdminUserGlobalSignOut`** in `provisioning_service.deprovision_user`. Add an `auth.session_revoked` audit write there (best-effort, beside the existing `admin.user_deprovisioned` write) — a deprovision revokes sessions, and that revocation should appear in the Authentication trail too, cross-referable to the deprovision. (Two events for one act is correct here: one records the *admin action*, one records the *session lifecycle*.)
  - [ ] `auth.logout`: there is **no logout endpoint today** (the FE clears its token client-side; Cognito logout is via the hosted-UI redirect). **Decision:** either (a) add a thin `POST /api/v1/auth/logout` that records the event and (in prod) calls `AdminUserGlobalSignOut` for the caller, or (b) record logout only where the app observes it (the deprovision path already covers forced revocation). **Recommend (a)** — an explicit logout endpoint is the honest place to record `auth.logout`, it's small, and it gives the FE a real logout call instead of a silent client-side token drop. If you add it, register it in the coverage guard (Task 6) and it's `RejectClient`-free (any authenticated user may log themselves out).
  - [ ] If you add the logout route, the FE should call it on sign-out — but a full FE logout-wiring may be out of scope; at minimum the endpoint exists and is audited. State what you did.

- [ ] **Task 5 — Authorization-denial auditing (AC4 — READ THE DESIGN NOTE FIRST)**
  - [ ] Denials converge at **one seam**: `velara_http_exception_handler` ([exceptions.py:68-80](../../../velara-api/app/core/exceptions.py#L68)) handles every `VelaraHTTPException`, including `HierarchyScopeError` (403), `reject_client`/`reject_non_grantor` (404), and `reject_non_ma_tech` (404). This is the **single place** to catch all denials — do NOT scatter writes across the individual guards.
  - [ ] ⚠️ **But not every `VelaraHTTPException` is a denial.** The handler also fires for 409s, 422s, 404-not-found (a genuinely missing row), etc. **Filter to security-relevant denials:** the 403 `FORBIDDEN` (`HierarchyScopeError`) and the 404 `NOT_FOUND` raised by the role guards. **Distinguishing a guard-404 from a real-missing-row-404 is the hard part** — both are `(404, "NOT_FOUND")`. Options: give the guards a distinct code (e.g. `reject_*` raises `(404, "NOT_FOUND")` but you add a marker), or audit only the 403s + a separate hook in the guards themselves. **Recommend:** audit the 403 `FORBIDDEN` denials at the handler (unambiguous), and for the role-guard 404s, write the audit **in the guard functions** (`reject_client`/`reject_non_grantor`/`reject_non_ma_tech` in `dependencies.py`) where the intent is unambiguous — they have `user: CurrentUser` in scope. This is a deliberate split; document it.
  - [ ] **The handler has NO `session` and NO `user`** — it's a Starlette exception handler ([exceptions.py:68](../../../velara-api/app/core/exceptions.py#L68)), not a route. To audit there you need: (1) the principal — pull it from `request.state` if the app stashes it, or re-decode from the `Authorization` header (best-effort; a denial implies a *valid* token that lacked *authorization*, so the token is decodable); (2) a `session_scope()` of its own. The attempted route is `request.url.path`; the method is `request.method`. **This is why auditing the role-404s in the guards (which have `user` + can take `session`) is cleaner** — prefer that where possible.
  - [ ] **VOLUME TRAP again:** denials can be high-volume (a misconfigured client polling an out-of-scope resource). Apply the same de-dupe window as Task 3. AC4's own text warns denials are "high-volume and self-inflicted-noise-prone."
  - [ ] Metadata: `{"user_id": <sub>, "attempted_route": request.url.path, "method": request.method, "denial_code": exc.code, "status": exc.status_code}`. Route path only — **never** query strings or bodies (they can carry PHI/IP).

- [ ] **Task 6 — A security threshold alarm on the existing SNS topic (AC5 — Terraform, plan only)**
  - [ ] The infra exists: `aws_sns_topic.alerts` ([cloudwatch.tf:22](../../../velara-api/terraform/cloudwatch.tf#L22)) + three availability alarms (`error_rate`, `p95_latency`, `queue_depth`) that all `alarm_actions = [aws_sns_topic.alerts.arn]`. **There is not one security alarm.** Add one: a CloudWatch metric alarm on repeated failed-auth / denial events exceeding a threshold in a window, firing to `alerts`.
  - [ ] **The metric source matters.** The existing alarms read ALB/AWS metrics. A failed-auth alarm needs a metric the app emits — either (a) a **CloudWatch custom metric / metric filter** over the app's structured logs (the `auth.login_failed` structlog lines → a metric filter counting them per principal/IP), or (b) if `advanced_security_mode` is enabled (AC6), Cognito's own compromised-credential metrics. **Recommend a log-metric-filter** on the `auth.login_failed` / `access.denied` structured log events (they're emitted regardless of the audit-row decision) — it's the most direct and doesn't depend on Cognito ASM landing. Copy the `error_rate` alarm's shape ([cloudwatch.tf:36-78](../../../velara-api/terraform/cloudwatch.tf#L36)).
  - [ ] **AC5's SNS-subscription gap:** the topic has zero subscribers. **Close the loop:** add a `var.security_alert_email` (or reuse an existing alerting var) that creates an `aws_sns_topic_subscription`, OR document explicitly in the story completion notes + the SOC 2 matrix (13.7) that operators must subscribe post-apply and name who. "An alarm nobody receives is not a detective control" — pick one and make it real.
  - [ ] ⚠️ **`terraform plan` ONLY. Do NOT apply.** (Same as every Epic 13 TF task; and per 13.3's note, this environment can't broker live AWS state-locking anyway — the plan is handed to the operator.)

- [ ] **Task 7 — Cognito advanced_security_mode + MFA review (AC6 — Terraform, plan only)**
  - [ ] Add `user_pool_add_ons { advanced_security_mode = "ENFORCED" }` (or `"AUDIT"` first — see the trade below) to `aws_cognito_user_pool.main` ([cognito.tf:23](../../../velara-api/terraform/cognito.tf#L23)). `AUDIT` = detect + log but don't block; `ENFORCED` = detect + take automatic action (block/MFA-challenge risky logins). **Recommend `ENFORCED`** for the compliance posture, but note `AUDIT` is a lower-risk first step if the operator wants to observe before enforcing — state which and why.
  - [ ] MFA: `mfa_configuration` is `OPTIONAL` in non-dev ([cognito.tf:69](../../../velara-api/terraform/cognito.tf#L69)). AC6 says "reviewed," not necessarily "forced to ON" — **make and document the call.** Forcing MFA to `ON` is a real UX/rollout change (every user must enrol a TOTP) and touches the live auth path; a defensible answer is "reviewed, staying OPTIONAL for now with ASM covering brute-force, MFA-enforcement tracked as a separate operator-scheduled change." Write the reasoning down — AC6 accepts a justified posture, not silence.
  - [ ] ⚠️ **This is Terraform against the LIVE AUTH PATH. Plan only; operator applies.** The 9.3 lesson (reconfiguring a live service broke the user's Cognito session) applies with full force — ASM and MFA changes touch every login. Author + plan, hand off.

- [ ] **Task 8 — Tests**
  - [ ] **AC1/AC2 (dev login):** drive `POST /api/v1/auth/login` with a valid seed username → assert one `auth.login_succeeded`; with an unknown username → assert one `auth.login_failed` carrying `attempted_username` and **NOT** any credential field. (The dev shim is the testable login path; the prod Cognito path is covered by Task 3's token-rejection tests.)
  - [ ] **AC2 (token rejection):** call any protected route with an expired/garbage token → assert `auth.login_failed`/`auth.token_rejected` with source + reason, no raw token. Assert the de-dupe: N rejected requests in the window → 1 row (Trap in Task 3).
  - [ ] **AC3:** the deprovision path (13.2) now also writes `auth.session_revoked` — assert it lands alongside `admin.user_deprovisioned`. If you added `POST /auth/logout`, test it writes `auth.logout`.
  - [ ] **AC4:** trigger a `HierarchyScopeError` (a client hitting an out-of-scope resource) → assert `access.denied` (or the separate-stream record) with `user_id` + `attempted_route`, NOT query/body. Trigger a `reject_non_grantor` 404 → assert the guard-side denial audit. Assert de-dupe.
  - [ ] **Never-log-the-credential** is a positive assertion in every failed-auth test (mirror 12.5/13.3's PHI-negative assertions): assert the metadata contains no password/token/secret field.
  - [ ] Guard tests green: `test_audit_category_guard.py` (AC7). If you added `POST /auth/logout`, register it in `test_audit_coverage_guard.py` (AC — Task 6 of the coverage guard).

- [ ] **Task 9 — Gates**
  - [ ] **Backend:** `ruff check .` clean; unit + integration green (`AUTH_BACKEND=dev`). ⚠️ **Rebuild the api/worker image after each source edit** — `COPY . .`, no bind mount (13.3's documented trap).
  - [ ] **`docs/api-spec.json`:** if you added `POST /auth/logout`, expect an **additive** diff (one route); otherwise **zero diff**. ⚠️ **Regenerate via `docker cp "$(docker compose ps -q api):/app/docs/api-spec.json" docs/api-spec.json`, NOT `exec`** (13.1/13.3 trap: the script writes inside the container to a non-mounted path). CI `git diff --exit-code`s it.
  - [ ] **No migration.** All new events reuse the append-only `audit_log_entries` table (free-text `event_type`, JSONB `metadata`). Confirm `alembic` head unchanged.
  - [ ] **Terraform:** `terraform validate` + `fmt -check` clean; `plan` handed to operator (Tasks 6, 7). **Do NOT apply.**

## Dev Notes

### ⛔ THE DESIGN NOTE (AC4) — audit_log_entries vs. a separate security stream. DECIDE IT EXPLICITLY.

The epic hands you a real fork and refuses to pick for you: *"decide deliberately whether denials go into `audit_log_entries` (durable, queryable, but high-volume and self-inflicted-noise-prone) or into a separate security-event stream with alarms. Either is defensible; an unattributed structlog line is not."*

**The two options:**
- **(A) Persist denials to `audit_log_entries`** (as `access.denied`, category `Security`). Pro: one queryable trail, reuses everything (categorization, list API, org fence, the whole 13.1-13.3 machinery), and an auditor can run "show me every denial for user X" through the existing audit UI. Con: denials are high-volume; without aggressive de-dupe the append-only table fills with a misconfigured client's poll loop.
- **(B) A separate security-event stream** — structured logs → CloudWatch log-metric-filter → alarm, **not** a DB row per denial. Pro: no DB-flooding, purpose-built for alerting (AC5). Con: it's a *log*, not the queryable append-only audit trail; "produce every denial for user X over 90 days" is a Logs Insights query with a 90-day retention horizon, not an indefinite audit record.

**Recommendation: a hybrid, and it's the honest answer.**
- **De-duped, attributed denial rows in `audit_log_entries`** (option A) for the *durable, per-principal accountability* AC4 asks for — but **de-duped hard** (one row per `(user_id, denial_class)` per window, per Task 5's volume trap) so the table records "user X was denied access to resources of kind Y, first seen at T, N times" rather than N raw rows.
- **The CloudWatch log-metric-filter + alarm** (option B) for the *detection* AC5 asks for — fed by the structured `access.denied` log line, which you emit regardless.

This gives durable attribution AND real-time detection without either flooding the DB or losing the queryable trail. **Whatever you choose, write the decision and its reasoning into the story's Dev Agent Record** — this is exactly the kind of call an auditor asks you to justify, and "we logged it somewhere" is not an answer. If you disagree with the hybrid and want pure-A or pure-B, that's fine — but state it and say why.

[Source: epic 13.4 AC4 design note; 13.3's Trap 3 de-dupe precedent; cloudwatch.tf log-metric-filter capability]

### ⛔ TRAP 1 — `get_current_user` and the exception handler have NO `session` and NO clean `user`

Two of the natural audit sites are **not** ordinary routes:
- `get_current_user` ([dependencies.py:138](../../../velara-api/app/core/dependencies.py#L138)) is the auth **dependency** — it takes `request` + `credentials`, no `session`. To write an audit row you open your own `async with session_scope() as s` (the pattern already used by `record_admin_action_sync` at [audit_service.py:349](../../../velara-api/app/services/audit_service.py#L349), but you're in async context so use `session_scope` directly, not the sync wrapper).
- `velara_http_exception_handler` ([exceptions.py:68](../../../velara-api/app/core/exceptions.py#L68)) is a **Starlette exception handler** — `(request, exc)`, no `session`, no `user`. Same `session_scope()` approach; pull the principal from `request` (see Trap 3).

**Both must be best-effort + de-duped.** A failing audit write in the auth seam must never convert a 401 into a 500, and must never be so slow (a synchronous Cognito/DB call per request) that it stalls the event loop — offload blocking work to the threadpool exactly as 13.2's `_is_user_enabled_cached` does ([dependencies.py:117-123](../../../velara-api/app/core/dependencies.py#L117)).

### ⛔ TRAP 2 — Source IP behind the ALB is `X-Forwarded-For`, not the socket peer

Every "detect a pattern (attempted identity, source)" AC needs the client IP. Behind the ALB, `request.client.host` is the **ALB's** IP, not the attacker's. The real client IP is the **first** address in the `X-Forwarded-For` header. Use `request.headers.get("x-forwarded-for", "").split(",")[0].strip()` with a fallback to `request.client.host` for local/dev. **Do not record the ALB IP as the source** — it makes every attacker look like one host and defeats the entire point of AC2/AC5. (Confirm whether the app already has a helper for this — check middleware; if not, add a small one so all four sites agree.)

### ⛔ TRAP 3 — VOLUME. Every failed-auth/denial site runs on the hot path.

This is the single biggest risk in the story and it repeats at three sites (Task 3 token rejection, Task 5 denials, and to a lesser extent Task 2 dev login). `get_current_user` and the exception handler fire on **every request**. A client polling with an expired token, or a misconfigured client hammering an out-of-scope resource, will generate a failed-auth/denial **per request — several per second**. Naive per-event auditing:
1. floods the append-only `audit_log_entries` table (which can never be pruned — it's append-only by DB trigger),
2. buries the real signal (a genuine attack) in self-inflicted noise, and
3. adds a DB write to the auth hot path.

**Mitigation is mandatory, not optional:** a short-TTL de-dupe window keyed by `(source_ip_or_sub, event_class)` — write the *first* occurrence in the window, increment/skip the rest. **13.3 already built this exact pattern** (`record_artifact_disclosure`'s `_DISCLOSURE_DEDUPE_WINDOW`, 15 min, keyed by `(user_id, artifact_ref)`) — reuse its shape. The CloudWatch metric filter (AC5) still counts **every** structured-log line (logs are cheap and retention-bounded), so detection stays real-time even though the DB records one row per window. **This is the reconciliation: logs for detection/volume, de-duped DB rows for durable attribution.**

### The Authentication + Security categories were created EMPTY for exactly this

13.1 deliberately created `CATEGORY_AUTHENTICATION` and `CATEGORY_SECURITY` with zero members ([audit_categories.py:72](../../../velara-api/app/models/audit_categories.py#L72) "Organization, Authentication, Security: no live event types yet"), and 13.1's FE review marked the empty category pills as dashed/dimmed with "not built yet" tooltips. **This story is what populates Authentication** (and possibly Security, if you persist denials per THE DESIGN NOTE). After this lands, those pills light up. No FE work is required for that — the pills already exist and render whatever the category resolves to; you're just giving them members. (If you want the dimmed/"not built yet" treatment removed for Authentication now that it has members, that's a small FE touch — check whether 13.1's dimming is data-driven (auto-un-dims when members exist) or hardcoded. If data-driven, nothing to do.)

### Dev vs. prod login: two different worlds, both must be covered

- **Dev (`AUTH_BACKEND=dev`):** the app owns login ([auth.py:53](../../../velara-api/app/api/v1/auth.py#L53)) — Task 2 audits it directly. This is the *testable* path.
- **Prod (`AUTH_BACKEND=cognito`):** Cognito owns login; the app **never sees a login attempt**, only the resulting token on subsequent requests. So in prod, `auth.login_succeeded` can only be inferred (the first successful `get_current_user` for a token you haven't seen), and `auth.login_failed` for *credential* failures lives in **Cognito**, not the app — which is exactly why AC6's `advanced_security_mode` matters (it's the only place prod credential-failure detection can happen). **Set expectations honestly in the completion notes:** the app-level `auth.*` events fully cover the dev path and the *token-rejection* slice of prod; prod *credential-entry* failures are covered by Cognito ASM (AC6), not by app audit rows. Don't claim the app audits prod login failures — it structurally cannot.

### Reuse everything from 13.1-13.3 — this is the fourth audit story

The machinery is proven: `record_admin_action` (the write seam, best-effort, `hierarchy_path="org"`, `org_id` fence), the category guard (auto-fails until categorized), the coverage guard (register new mutating routes), 13.3's de-dupe window, the `docker cp` spec-regen trap, the Terraform-plan-only rule, the PHI-negative test assertions. **Do not invent new mechanisms.** The only genuinely new design work is THE DESIGN NOTE (where denials live) and the source-IP extraction (Trap 2).

### Testing standards

- **BE:** pytest; integration tests drive **real routes/seams** with real tokens. The failed-auth tests must go through the real 401 path (expired/garbage token), not call the helper directly.
- **Known local artifact:** container defaults `AUTH_BACKEND=cognito` (401s dev tokens) — run integration with `AUTH_BACKEND=dev`. Note this story's dev-login tests specifically exercise the `AUTH_BACKEND=dev` path, so they're naturally aligned.
- **Guard tests** (`test_audit_category_guard.py`, `test_audit_coverage_guard.py`) are gates.

### Project Structure Notes

- `velara-api/app/models/audit.py` — MODIFIED (+4 `EVENT_AUTH_*`; +1 `EVENT_ACCESS_DENIED` if persisting denials)
- `velara-api/app/models/audit_categories.py` — MODIFIED (+4 under `CATEGORY_AUTHENTICATION`; +1 under `CATEGORY_SECURITY` if persisting denials)
- `velara-api/app/services/audit_service.py` — MODIFIED (maybe a `record_auth_event` helper; reuse the de-dupe window)
- `velara-api/app/api/v1/auth.py` — MODIFIED (dev-login success/failure audit; maybe `POST /auth/logout`)
- `velara-api/app/core/dependencies.py` — MODIFIED (token-rejection audit in `get_current_user`; role-guard denial audit in `reject_*`)
- `velara-api/app/core/exceptions.py` — MODIFIED (403-denial audit in the handler, if that's where you put it)
- `velara-api/app/services/provisioning_service.py` — MODIFIED (+`auth.session_revoked` beside the 13.2 deprovision write)
- `velara-api/terraform/cognito.tf` — MODIFIED (`user_pool_add_ons`/ASM; MFA review) — **plan only**
- `velara-api/terraform/cloudwatch.tf` — MODIFIED (security metric-filter + alarm + maybe SNS subscription) — **plan only**
- `velara-api/tests/integration/` + `tests/unit/` — NEW/MODIFIED (auth-event tests, denial tests, de-dupe tests, credential-negative assertions)
- `docs/api-spec.json` — additive (one route) if `/auth/logout` added, else unchanged

**No migration. No new DB table/column.** (New events reuse `audit_log_entries`.)

### References

- [Source: epics/epic-13-compliance-audit-and-access-controls.md#Story-13.4] — ACs verbatim, the design-note fork, the SNS-zero-subscriptions warning, the §164.308(a)(5)(ii)(C) framing, the ASM/MFA review.
- [Source: velara-api/app/api/v1/auth.py:53-107] — the dev-login route (success + `principal is None` failure branch), `/me`, `/dev-users`; the "Cognito owns login in prod" structural note.
- [Source: velara-api/app/core/dependencies.py:100-164] — `get_current_user` (the token-validation seam, its 401 branches, 13.2's enabled-check + threadpool-offload pattern to mirror); `reject_client`/`reject_non_grantor`/`reject_non_ma_tech` (the denial guards, lines 284-345) and `HierarchyScopeValue.assert_in_scope` (403 denial).
- [Source: velara-api/app/core/exceptions.py:68-80] — `velara_http_exception_handler`, the single denial convergence point, currently logging only code/status/request_id (no user/path/target — the AC4 gap); no session/user in scope (Trap 1).
- [Source: velara-api/app/services/hierarchy_service.py:71-75] — `HierarchyScopeError` (403 FORBIDDEN, code `FORBIDDEN`) — the unambiguous denial to audit at the handler.
- [Source: velara-api/app/services/audit_service.py:286-360] — `record_admin_action` (the write seam to copy) + `record_admin_action_sync`/`session_scope` (the self-owned-session pattern for the sessionless auth seam).
- [Source: velara-api/app/models/audit_categories.py:72] — the empty `CATEGORY_AUTHENTICATION` / `CATEGORY_SECURITY` reserved by 13.1 for this story; keep them out of `OUTCOME_BEARING_CATEGORIES`.
- [Source: velara-api/terraform/cognito.tf:23,69] — `aws_cognito_user_pool.main` (add `user_pool_add_ons`/ASM); `mfa_configuration` OPTIONAL in non-dev (AC6 review).
- [Source: velara-api/terraform/cloudwatch.tf:18-78] — `aws_sns_topic.alerts` (zero subscriptions — AC5's loop to close) + the `error_rate` alarm shape to copy for a security alarm.
- [Source: implementation-artifacts/stories/13-3-audit-read-path-phi-disclosure.md] — the de-dupe-window pattern (Trap 3 reuse), the `docker cp` spec-regen trap, the `terraform plan` state-lock note (plan handed to operator), the PHI/credential-negative test convention.
- [Source: implementation-artifacts/stories/13-2-user-deprovisioning.md] — `AdminUserGlobalSignOut` in the deprovision path (where `auth.session_revoked` attaches); the threadpool-offload pattern for blocking calls on the auth seam; the phantom-IAM-action lesson (verify any new Cognito action name).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log
