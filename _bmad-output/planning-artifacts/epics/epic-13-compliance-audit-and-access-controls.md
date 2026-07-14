# Epic 13: Compliance — Audit Coverage, Access Lifecycle & Detective Controls

> **Created 2026-07-13** via a HIPAA / SOC 2 gap analysis run against the deployed code (not against the docs). Every finding below is **code-verified at HEAD `cddc082`** — file and line cited. This epic exists because a targeted question ("are we missing any other audits required by HIPAA and SOC 2?") turned up gaps materially larger and more structural than the Story 12.5 remediation that prompted it.
>
> **Epic 12 / Story 12.5 is NOT superseded.** 12.5 (audit coverage for skill-authoring & ingest mutations, plus the anti-regression guard test) stays exactly as scoped and should ship on its own cadence — it is ready-for-dev. This epic is the *rest* of the iceberg 12.5's tip revealed. 12.5's guard test is, in fact, the mechanism several stories here plug into.

## The one-sentence finding

**The audit log is a write-path log: it records who *ran* a skill and who *granted* access — it never records who *read* anything, and it never records who *logged in* (or failed to).** Under HIPAA §164.312(b) and §164.528, the read side is the half that matters most, and it is currently at zero. Separately, **the platform has no way to deprovision a user at all** — not "unaudited," but *absent*.

## Why this was missed (the planning root cause)

`FR-SEC-08` names **HIPAA** and **21 CFR Part 11** as co-equal, first-class compliance frameworks. But only Part 11 was ever decomposed into requirements: `FR-SEC-09` (audit log), `FR-SEC-10` (e-signatures), `FR-SEC-11` (access/authority), `FR-SEC-12` (validation) are *all* Part 11 clauses. **HIPAA's Security Rule obligations were never turned into FRs** — so no story ever carried them, and `docs/compliance-mapping.md` maps §11.10/§11.50/§11.70/§11.300 and nothing else. There is no HIPAA Security Rule mapping and no SOC 2 control matrix in the repo.

The result is a predictable shape: Part 11 cares about *records and signatures* (which the platform does well — append-only partitioned audit table, DB-trigger-enforced, e-signatures bound to skill versions by immutable FK). HIPAA §164.312(b) and SOC 2 CC6 care about *access and accountability* — reads, logins, deprovisioning, detection — which nobody was asked to build. **This epic adds the missing FRs and the stories to satisfy them.**

**New FRs introduced by this epic** (to be added to `requirements-inventory.md`):
- **FR-SEC-13 [P1]** — HIPAA §164.312(b): the audit trail records **access to** ePHI, not only mutation of it. Every disclosure of a PHI-bearing artifact (document, parsed text, skill output) is attributable to a user and a time.
- **FR-SEC-14 [P1]** — HIPAA §164.308(a)(5)(ii)(C): authentication activity — successful login, **failed login**, logout, token revocation, credential reset — is recorded and monitorable.
- **FR-SEC-15 [P1]** — SOC 2 CC6.3: access can be **removed**. A user's platform access can be revoked (disabled) through the platform, promptly, with an audit record.
- **FR-SEC-16 [P1]** — SOC 2 CC7.1/CC7.2: cloud control-plane and data-plane activity is captured by detective controls (CloudTrail, access logging) sufficient to investigate an incident.
- **FR-SEC-17 [P2]** — HIPAA §164.528: the platform can produce an **accounting of disclosures** for a given subject/document over a date range.

**FRs covered:** FR-SEC-13, FR-SEC-14, FR-SEC-15, FR-SEC-16, FR-SEC-17 _(all new)_; strengthens FR-SEC-08 (the HIPAA half, previously undecomposed), FR-SEC-09 (audit completeness).

## Sequencing

> **Renumbered 2026-07-14 via correct-course** (see `sprint-change-proposal-2026-07-14.md`) to insert the new categorization story as **13.1**, running first. The original 13.1→13.6 shifted to 13.2→13.7 — no scope changed, only story numbers. `sprint-log.md`'s historical `13-1`..`13-6` section headers describe the 2026-07-13 planning session and were **not** renumbered; read them as referring to the pre-renumber IDs.

**13.1 (categorization) runs first** — it builds the category taxonomy/mapping mechanism up front so every event type Stories 13.2–13.6 introduce is assigned a category at the point it's added, instead of a retrofit pass at the end. **13.2 → 13.3 are the two that a real auditor tests first and that no compensating control rescues.** 13.4–13.6 are the durable/structural remainder. 13.7 (docs) can be authored in parallel with any of them but should be *finalized last*, since it must describe what actually shipped.

Suggested order: **13.1 (audit event categorization) → 13.2 (deprovisioning) → 13.3 (read/disclosure auditing) → 13.4 (auth events) → 13.5 (detective controls, Terraform) → 13.6 (denials + audit-log-read + hierarchy/attachment coverage) → 13.7 (mapping docs, finalize)**.

⚠️ **13.5 is Terraform against live AWS.** Per standing project rule, **do not `terraform apply` without explicit operator sign-off** — author + plan only, and hand the apply to the operator. The 9.3 lesson (reconfiguring a live service broke the user's Cognito session) applies with full force here: CloudTrail and Cognito threat-protection changes touch the auth path.

---

## Story 13.1: Audit Event Categorization

> **Added 2026-07-14 via correct-course.** **Reality (code-verified):** the audit log filter UI ([AuditLog.tsx:300-316](../../../velara-web/src/features/audit/components/AuditLog.tsx#L300)) is a flat, hand-picked pill list — `All / Success / Failures / Blocked / Grants / Certifications / Lifecycle / Provisioning` ([eventKindMeta.ts:19-43](../../../velara-web/src/features/audit/eventKindMeta.ts#L19)) — that mixes `outcome` values with specific `event_type` literals. Because the query API's `event_type` filter is exact-match only ([audit.py:87](../../../velara-api/app/api/v1/audit.py#L87); `audit_service.py:235`), each pill catches only the one event type it was hand-wired to: "Grants" misses `admin.grant_revoked` and `admin.grant_reaffirmed`; "Provisioning" misses `admin.user_invite_resent`. This is a known, commented limitation ([eventKindMeta.ts:12-17](../../../velara-web/src/features/audit/eventKindMeta.ts#L12)).
>
> There is **no category concept anywhere in the backend** — `event_type` is a free-text `String` column ([audit.py:112](../../../velara-api/app/models/audit.py#L112)) with no enum, no `VALID_EVENT_TYPES` set, and no grouping field. Today there are only 22 event types across two prefixes (`invocation.*`, `admin.*`). Stories 13.2–13.6 add roughly 15 more across new prefixes (`auth.*`, `access.*`, `audit.*`, plus new `admin.*` and a sandbox-security event) — without this story, the existing flat-pill pattern would be extended ad hoc per story, compounding the same exact-match gap for every new event family.

As an admin or compliance reviewer,
I want audit events grouped into a small set of meaningful categories at the top of the audit log,
So that I can filter by "what kind of thing happened" (a skill ran, someone's access changed, someone logged in, a document was disclosed) without needing to know raw `event_type` strings, and so every event family — including the ones this epic is about to add — is filterable by family, not just by exact type.

**Category taxonomy** (final list — event types marked *(new)* are added by later stories in this epic and must be mapped into this taxonomy at the point they're introduced):

| Category | Event types |
|---|---|
| **Skill Execution** | `invocation.success`, `invocation.failure`, `invocation.cancelled`, `invocation.blocked`, `invocation.fan_out` |
| **Skill Maintenance** | `admin.skill_created`, `admin.skill_updated`, `admin.skill_version_created`, `admin.skill_derived`, `admin.skill_draft_content_updated`, `admin.skill_adapter_proposed`, `admin.skill_exported`, `admin.skill_imported`, `admin.skill_promoted`, `admin.document_ingested` |
| **Organization** | `admin.hierarchy_created` / `updated` / `deleted` *(new, 13.6)*, `admin.skill_attached` / `detached` *(new, 13.6)* |
| **Access Control** | `admin.grant_created`, `admin.grant_reaffirmed`, `admin.grant_revoked`, `admin.user_provisioned`, `admin.user_invite_resent`, `admin.user_deprovisioned` / `reprovisioned` / `role_changed` *(new, 13.2)* |
| **Authentication** | `auth.login_succeeded` / `login_failed` / `logout` / `session_revoked` *(new, 13.4)* |
| **Compliance & Disclosure** | `access.artifact_disclosed` *(new, 13.3)*, `audit.log_accessed` *(new, 13.6)*, `admin.certification`, `admin.lifecycle_transition` |
| **Security** | sandbox network-blocked event *(new, 13.6)*, denial/threshold-alarm events if persisted to `audit_log_entries` *(new, 13.4 — depends on that story's "design note" decision)* |

**Acceptance Criteria:**

**Given** the full set of audit `event_type` values (current 22 + all types this epic introduces)
**When** the category mapping is implemented
**Then** every event type resolves to exactly one of the 7 categories above via a single static, code-owned mapping (no DB migration, no backfill) — and a guard test (mirroring 12.5's registry-guard pattern) fails the build if a new `event_type` is introduced anywhere without a category assignment

**Given** the audit log query API
**When** a category filter is requested
**Then** `GET /api/v1/audit` accepts a `category` query param that expands to the full set of `event_type` values in that category server-side (closing the exact-match gap the current FE pills work around) — `event_type` and `outcome` filters continue to work unchanged and can combine with `category`

**Given** the audit log UI's top filter
**When** it renders
**Then** the pill/tab bar is replaced with the 7 categories (plus "All events"), each pill catching every event type in its category — "Success/Failures/Blocked" become a secondary `outcome` filter (still available, now orthogonal to category rather than conflated with it)

**Given** an audit log row
**When** it renders
**Then** the existing per-row icon ([eventTypeIconMeta.ts](../../../velara-web/src/features/audit/eventTypeIconMeta.ts)) is unchanged by this story — only the top-level filter/grouping changes; row-level iconography is out of scope

**Given** this story lands first in Epic 13
**When** Stories 13.2, 13.3, 13.4, and 13.6 each introduce new event types
**Then** each of those stories' own ACs include "assign the new event type(s) to a category" as a sub-step, enforced by this story's guard test — so the taxonomy never drifts out of sync with the real event-type list

**Given** no production data exists yet
**When** this story ships
**Then** no data migration or backfill is required — this is a pure code/mapping change

---

## Story 13.2: User Deprovisioning (Disable / Revoke Access)

> **Severity: the highest in this epic.** Not because it is hard — it is roughly the smallest story here — but because "we cannot revoke a terminated user's access" is the first thing a SOC 2 auditor tests and **no compensating control rescues it.**
>
> **Reality (code-verified):** this capability **does not exist at all.** `AuthProvider` ([auth.py:154-202](../../../velara-api/app/integrations/auth.py#L154)) defines exactly five methods — `issue_token`, `validate_token`, `list_users`, `create_user`, `resend_invite`. There is **no `disable_user`, no `delete_user`.** The users router ([users.py](../../../velara-api/app/api/v1/users.py)) exposes only `GET /users`, `POST /users`, `POST /users/resend-invite` — **no DELETE, no PATCH.** `CognitoAuthProvider` never calls `AdminDisableUser`/`AdminUserGlobalSignOut`, and the ECS task IAM policy grants no such action. An operator's only recourse today is the AWS Cognito console, out-of-band — which produces **no application audit event** (and, per 13.5, no CloudTrail record either).
>
> **Aggravating:** revoking a *grant* (`admin.grant_revoked`, which does exist) removes data **scope** but leaves the **login active**; and the ID token is valid for 8h with no server-side session kill, so even a grant revoke is not effective immediately.

As a platform administrator,
I want to disable a user's access to the platform and immediately invalidate their active sessions,
So that a terminated employee or offboarded client contact cannot log in, and I can evidence that removal to an auditor.

**Acceptance Criteria:**

**Given** an active user
**When** an admin/ma_tech deprovisions them
**Then** the user is **disabled** at the identity provider (Cognito `AdminDisableUser`) — not deleted, so the audit trail's `user_id` references remain resolvable — and an `admin.user_deprovisioned` audit event is written recording the actor, the target, the org, and the UTC timestamp

**Given** a deprovisioned user holding a still-valid (unexpired) ID token
**When** they call any authenticated endpoint
**Then** the request is rejected — **active sessions are killed, not merely prevented from being renewed** (`AdminUserGlobalSignOut`, and/or an authoritative check that the principal is still enabled). An 8-hour window in which a terminated user retains full access is not an acceptable answer to CC6.3.

**Given** a deprovisioned user
**When** an admin views the user directory
**Then** their status renders as disabled/deprovisioned (the directory already surfaces status pills — Story 10.2), and a **re-enable** path exists (also audited, `admin.user_reprovisioned`) so an accidental disable is recoverable

**Given** the role a user holds
**When** it is changed (e.g. `client` → `consultant`, or any escalation)
**Then** the change is audited (`admin.user_role_changed`, old→new) — **role modification is currently impossible in-platform and invisible when done in the console**, and CC6.3 covers *modification* of access, not only grant and revoke

**Given** the IAM policy for the API task role
**When** deprovisioning is invoked
**Then** it has exactly the Cognito actions it needs (`AdminDisableUser`, `AdminEnableUser`, `AdminUserGlobalSignOut`) and no more — least-privilege, and **note the phantom-IAM-action lesson from Story 10.1**: verify each action name against the real Cognito API surface before adding it, since a non-existent action name is accepted by IAM and fails only at call time

**Given** the new `admin.user_deprovisioned`, `admin.user_reprovisioned`, and `admin.user_role_changed` event types this story introduces
**When** they are added
**Then** each is assigned to the **Access Control** category in Story 13.1's mapping, and 13.1's guard test passes

---

## Story 13.3: Audit the Read Path — PHI Access & Disclosure

> **Reality (code-verified):** every path that hands a caller a presigned URL to a PHI-bearing S3 object writes **nothing** to `audit_log_entries`: [jobs.py:145](../../../velara-api/app/api/v1/jobs.py#L145) (`output_file_url`), [jobs.py:182](../../../velara-api/app/api/v1/jobs.py#L182) (each output file), [jobs.py:232](../../../velara-api/app/api/v1/jobs.py#L232) (fan-out child outputs), [client.py:328](../../../velara-api/app/api/v1/client.py#L328) and [client.py:366](../../../velara-api/app/api/v1/client.py#L366) (**client** downloads of their own outputs), [skills.py:188](../../../velara-api/app/api/v1/skills.py#L188) (export bundle).
>
> Worse: the URL is minted and returned, and the **actual S3 GET then happens out-of-band, directly against S3** — and there is **no S3 server access logging** on any bucket (verified: zero `aws_s3_bucket_logging` across all 15 `.tf` files). So the fetch itself is recorded in **no system whatsoever**, and the URL remains live and bearer-shareable for its TTL.
>
> Compounding it: `ingest_service.build_context_input` — the function that reads the extracted PHI text out of S3 and **injects it into an LLM prompt** — writes no audit entry, and **`file_ref_ids` are not carried in the invocation audit event's metadata.** So even the invocation record cannot tell you *which document* was read.

As a compliance reviewer,
I want every access to and disclosure of a PHI-bearing artifact recorded in the audit trail,
So that "who received this data, and when" is answerable — which HIPAA §164.528 requires and the platform currently cannot answer at all.

**Acceptance Criteria:**

**Given** any request that mints a presigned download URL for a job output, an output file, or an ingested document
**When** the URL is issued
**Then** an `access.artifact_disclosed` audit event is written recording the acting `user_id`, `org_id`, the artifact **reference** (job_id / file_ref_id / S3 key identifier — *never* content, never a filename), the artifact kind, and the UTC timestamp. **Minting the URL is the disclosure** — treat it as the auditable act, since the subsequent GET is out-of-band and unobservable to the application.

**Given** a skill invocation that consumes documents
**When** the invocation audit event is written
**Then** its metadata carries the `file_ref_ids` consumed — so every recorded event can be linked to the specific PHI it touched. *(This is a small change at the existing `record_invocation` call site and is the cheapest single win in this epic.)*

**Given** the presigned-URL TTL
**When** a URL is minted
**Then** the TTL is reviewed and justified against the disclosure risk (a 24h bearer-shareable URL to a PHI document is a long window) — shorten it, or document why the current value is right

**Given** the S3 buckets holding ingested documents and outputs
**When** an object is fetched
**Then** S3 server access logging (or CloudTrail data events) captures it — so the out-of-band GET is not a blind spot even for URLs minted before this story. *(Overlaps 13.5; implement in whichever lands first, don't do it twice.)*

**Given** a request for an accounting of disclosures (FR-SEC-17, P2)
**When** it is run for a given document/subject over a date range
**Then** the audit log can produce it — this AC is the *acceptance test* for the events above being sufficient, even if the reporting UI itself is deferred

**Given** the new `access.artifact_disclosed` event type this story introduces
**When** it is added
**Then** it is assigned to the **Compliance & Disclosure** category in Story 13.1's mapping, and 13.1's guard test passes

---

## Story 13.4: Authentication & Authorization Event Auditing

> **Reality (code-verified):** there is **no authentication event of any kind**, in the app or in the cloud layer. Dev login ([auth.py:53-77](../../../velara-api/app/api/v1/auth.py#L53)) writes nothing on success, and its 401 branch writes nothing at all — not even a structlog line with a user identifier. In prod, Cognito owns login and the app never sees it — and **`advanced_security_mode` / `user_pool_add_ons` is not set in `cognito.tf`** (verified absent), so Cognito's own threat-protection and compromised-credential detection are **OFF**, and there is no CloudTrail to capture the events regardless.
>
> **HIPAA §164.308(a)(5)(ii)(C) names log-in monitoring as an explicit implementation specification.** Current coverage: zero. Brute-force and credential-stuffing are neither detected nor evidenced.
>
> Separately, RBAC **denials** (403/404 from `HierarchyScopeError`, `reject_client`, `reject_non_grantor`) reach only `velara_http_exception_handler` ([exceptions.py:68-80](../../../velara-api/app/core/exceptions.py#L68)), which logs `code` + `status_code` + `request_id` — **with no `user_id`, no path, no target resource.** That line cannot distinguish a fat-fingered URL from a client user methodically enumerating another client's jobs.

As a security operator,
I want authentication and authorization events recorded and monitorable,
So that I can detect credential attacks and access probing, and evidence login monitoring to an auditor.

**Acceptance Criteria:**

**Given** a successful authentication
**When** it completes
**Then** an `auth.login_succeeded` event is recorded, attributable to the user, org, and UTC time

**Given** a **failed** authentication (bad credentials, or a rejected/expired/invalid token)
**When** it occurs
**Then** an `auth.login_failed` event is recorded — with enough context to detect a pattern (attempted identity, source, time) and **never** the submitted credential. This is the §164.308(a)(5)(ii)(C) requirement and the current gap is total.

**Given** logout and token/session revocation
**When** they occur
**Then** they are recorded (`auth.logout`, `auth.session_revoked`) — closing the loop with 13.2's session kill

**Given** an authorization **denial** (403/404 from the hierarchy-scope or role guards)
**When** it occurs
**Then** it is recorded with the acting `user_id`, the attempted route, and the target resource — a durable, attributable record, not the current unattributed 90-day CloudWatch warning. **Design note:** decide deliberately whether denials go into `audit_log_entries` (durable, queryable, but high-volume and self-inflicted-noise-prone) or into a separate security-event stream with alarms. Either is defensible; an unattributed structlog line is not.

**Given** repeated failed logins or repeated denials from one principal
**When** they exceed a threshold
**Then** an alarm fires to the existing SNS topic — detection, not just recording (SOC 2 CC7.2). **Note the existing SNS topic has zero subscriptions by design** ("operators subscribe after apply") — an alarm nobody receives is not a detective control; close that loop or say explicitly who subscribes.

**Given** Cognito's own threat protection
**When** the user pool is configured
**Then** `advanced_security_mode` is enabled (compromised-credential + brute-force detection), and MFA enforcement is reviewed — it is currently `OPTIONAL` in non-dev, and optional MFA is weak evidence for CC6.1. ⚠️ **Terraform against the live auth path — plan only; operator applies.**

**Given** the new `auth.login_succeeded`, `auth.login_failed`, `auth.logout`, and `auth.session_revoked` event types this story introduces
**When** they are added
**Then** each is assigned to the **Authentication** category in Story 13.1's mapping (and any denial/threshold-alarm events persisted to `audit_log_entries` are assigned to **Security**), and 13.1's guard test passes

---

## Story 13.5: Cloud Detective Controls (CloudTrail, Access Logging, Config)

> **Reality (verified: zero matches for `cloudtrail`, `guardduty`, `aws_config`, `bucket_logging`, `access_logs`, `aws_wafv2` across all 15 `.tf` files in `velara-api/terraform/`):** there is **no CloudTrail**. No AWS control-plane action is recorded anywhere. This compounds *every* other finding: each place this epic says "an admin could do it in the Cognito console instead," that console action **is also not logged.** There are no ALB access logs, no S3 access logging, no GuardDuty, no AWS Config.
>
> The existing CloudWatch alarms ([cloudwatch.tf](../../../velara-api/terraform/cloudwatch.tf)) are **availability/performance only** — error rate, p95 latency, queue depth. There is not one security alarm.

As a platform operator,
I want cloud control-plane and data-plane activity captured,
So that a security incident can actually be investigated, and so that out-of-band console changes are not invisible.

**Acceptance Criteria:**

**Given** any AWS control-plane action (IAM change, Cognito user disable, security-group edit, RDS change)
**When** it occurs — **including via the console**
**Then** CloudTrail records it, to a dedicated, access-restricted, retained log destination

**Given** an object in the ingest / output / skill-artifact buckets
**When** it is read or written
**Then** S3 access logging (or CloudTrail S3 data events) captures it — closing 13.3's out-of-band-GET blind spot for *all* URLs, including previously minted ones

**Given** an HTTP request to the ALB
**When** it is served
**Then** ALB access logs capture it (currently the `access_logs` block is absent from `alb.tf`)

**Given** the detective-control baseline
**When** it is reviewed
**Then** GuardDuty and AWS Config are each either enabled, or explicitly declined **with the reason recorded** in the SOC 2 control matrix — an auditor accepts a documented risk decision; they do not accept silence

**Given** log retention
**When** CloudTrail and access logs are configured
**Then** retention meets the compliance requirement (note: CloudWatch is currently 90 days, while `audit_log_entries` is indefinite — reconcile these deliberately, because a 90-day security-log horizon is short for breach investigation)

⚠️ **This story is Terraform against live AWS. Author and `plan` only. The operator applies.** Do not apply CloudTrail/Cognito changes unattended.

---

## Story 13.6: Close the Remaining Unaudited-Mutation Surface

> **Reality:** Story 12.5's route-walk guard test surfaces ~42 mutating routes, of which ~20 have no audit decision. 12.5 fixes skill-authoring + ingest and directs the rest to be registered as **explicitly tracked exemptions**. This story is where those exemptions get paid down. **12.5's guard test is the entry point — this story flips registry entries from `exempt` to audited.**

**Confirmed unaudited (code-verified):**
- **Hierarchy CRUD — 12 routes.** `delete_client` / `delete_project` / `delete_study` / `delete_location` ([hierarchy_service.py:307,406,510,639](../../../velara-api/app/services/hierarchy_service.py#L307)) plus the four `update_*` and four `create_*`. Deleting a client **cascades away the grants that hang off it** — silently changing everyone's effective access with **zero record**. The file's only occurrence of "audit" is a schema import.
- **Skill attachments — 4 routes.** `skill_attachment_service.py` has zero audit references.
- **Audit-log reads.** `GET /api/v1/audit` records nothing — an admin can enumerate the org's entire compliance trail, unaccountably. (Auditors care that the audit trail cannot be *reviewed* without a trace, not only that it cannot be tampered with. The append-only trigger covers tampering; nothing covers reading.)
- **Sandbox network-block events.** `code_sandbox.py` returns a `NET_BLOCKED` signal when a running skill probes the network — it produces **no audit event and no alarm**, so a skill testing the sandbox boundary is indistinguishable from a clean run.

As a compliance reviewer,
I want every remaining state-changing and trail-reading operation audited,
So that the "every admin mutation is audited" invariant is true in fact, not just for the surfaces someone remembered.

**Acceptance Criteria:**

**Given** any hierarchy create/update/**delete**
**When** it commits
**Then** it writes an audit event — deletes especially, capturing what was destroyed and the cascade impact (grants removed)

**Given** a skill attachment or detachment
**When** it commits
**Then** it writes an audit event

**Given** a read of the audit log itself
**When** it is served
**Then** it is recorded (`audit.log_accessed`) — resolving the self-referential growth question deliberately (a separate table, or accept it and document why)

**Given** a sandboxed skill attempting a blocked network call
**When** the sandbox blocks it
**Then** it is surfaced as an auditable security event and alarmed — not silently swallowed. *(Note `code_sandbox.py`'s own docstring is candid that the Python-monkeypatch sandbox is escapable by a determined attacker via `ctypes`→libc and that Epic 7 was to replace it with a syscall-level sandbox — **Epic 7 shipped and did not.** The sandbox-hardening question is out of scope for this story; **detecting and recording probes is not.** Raise the hardening question separately.)*

**Given** Story 12.5's guard-test registry
**When** this story completes
**Then** every entry that 12.5 registered as `exempt="not yet audited — known gap"` is either audited or has a **permanent, justified** exemption — the registry is the checklist and it ends this story with no temporary exemptions left

**Given** the new hierarchy create/update/delete, skill attachment/detachment, `audit.log_accessed`, and sandbox network-blocked event types this story introduces
**When** they are added
**Then** the hierarchy and attachment events are assigned to the **Organization** category, `audit.log_accessed` and the sandbox event are assigned to **Compliance & Disclosure** / **Security** respectively in Story 13.1's mapping, and 13.1's guard test passes

---

## Story 13.7: HIPAA & SOC 2 Control Mapping Documents

> **Reality:** `velara-api/docs/compliance-mapping.md` maps **21 CFR Part 11 only** (§11.10 / §11.50 / §11.70 / §11.300). There is **no HIPAA Security Rule mapping** and **no SOC 2 control matrix** anywhere in the repo — despite FR-SEC-08 naming HIPAA as a first-class framework. It is also the artifact an auditor reads *first*, and it currently **overstates coverage**: it marks §11.10(e) "audit trail — IMPLEMENTED," which is true for invocations and misleading given the read-path is at zero.

As a compliance owner,
I want an honest, code-verified control mapping for HIPAA and SOC 2,
So that our first conversation with an auditor starts from an accurate picture rather than a corrected one.

**Acceptance Criteria:**

**Given** the HIPAA Security Rule
**When** the mapping is authored (`docs/hipaa-security-rule-mapping.md`)
**Then** it covers §164.308 (administrative), §164.312 (technical), §164.316 (documentation), and §164.528 (accounting of disclosures), and marks each control **IMPLEMENTED / PARTIAL / GAP / DEFERRED** against **verified code**, citing the implementing file — no aspirational entries

**Given** SOC 2
**When** the control matrix is authored (`docs/soc2-control-matrix.md`)
**Then** it maps the Common Criteria (CC1–CC8, plus A1 availability), names a **control owner** for each, and states the evidence artifact that satisfies it — including honestly recording the controls we have **declined**, with the reason

**Given** the existing Part 11 mapping
**When** it is revised
**Then** the overstated claims are corrected — §11.10(e) is downgraded from a flat "IMPLEMENTED" to an accurate status, and the doc cross-references the two new mappings

**Given** §164.308(a)(1)(ii)(D) (information system activity review)
**When** the data-handling policy is updated
**Then** it defines an actual **log-review procedure** — who reviews the audit log, how often, what triggers escalation. Today's incident-response section is alarm-driven only, and there is no periodic-review control at all.

**Given** every claim in all three documents
**When** it is written
**Then** it is traceable to code or to Terraform — **this epic exists because the docs and the code disagreed**, and the fix is not a better-worded doc but a doc that is *checked*
