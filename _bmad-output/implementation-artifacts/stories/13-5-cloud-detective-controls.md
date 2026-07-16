---
baseline_commit: 857318c
---

# Story 13.5: Cloud Detective Controls (CloudTrail, Access Logging, Config)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform operator,
I want cloud control-plane and data-plane activity captured,
so that a security incident can actually be investigated, and so that out-of-band console changes are not invisible.

**This story compounds every other Epic 13 finding.** There is **no CloudTrail** — no AWS control-plane action is recorded anywhere (verified: zero matches for `cloudtrail`, `guardduty`, `aws_config` across all 15 `.tf` files at baseline `857318c`). Every place this epic said "an admin could do it in the Cognito console instead" (13.2 deprovisioning, 13.4 MFA changes), **that console action is also not logged.** The existing CloudWatch alarms are availability/performance only (error rate, p95 latency, queue depth) plus the one security alarm 13.4 just added — but **no CloudTrail, no GuardDuty, no AWS Config, no ALB access logs, no VPC flow logs.** This is the detective-controls backbone SOC 2 CC7.1/CC7.2 requires.

**⚠️ This story is Terraform against live AWS. Author and `plan` only. The operator applies.** CloudTrail and any auth-adjacent changes touch the control plane; the 9.3 lesson (reconfiguring a live service broke the user's Cognito session) applies. Do not `apply` unattended.

## Acceptance Criteria

1. **AC1 — CloudTrail records all control-plane actions, including console actions.**
   **Given** any AWS control-plane action (IAM change, Cognito user disable, security-group edit, RDS change)
   **When** it occurs — **including via the console**
   **Then** CloudTrail records it, to a dedicated, access-restricted, retained log destination

2. **AC2 — S3 object access is captured (already done by 13.3 for PHI buckets — do NOT redo).**
   **Given** an object in the ingest / output / skill-artifact buckets
   **When** it is read or written
   **Then** S3 access logging (or CloudTrail S3 data events) captures it. **⚠️ Story 13.3 ALREADY shipped `aws_s3_bucket_logging` on the ingest/output/skill buckets** ([s3.tf:212-286](../../../velara-api/terraform/s3.tf#L212)), with an explicit comment: *"13.5 must NOT re-add logging for these buckets, only extend to any NEW buckets/detective controls it introduces."* **Honor that.** This story's AC2 obligation is: (a) confirm the 13.3 coverage is sufficient, (b) decide whether to *additionally* enable CloudTrail **S3 data events** for these buckets (server access logs and data events are complementary — data events give you the IAM principal + API context that raw S3 access logs lack), and (c) extend logging to any bucket 13.3 excluded (the `brand` bucket — non-PHI, likely fine to leave, but state the call).

3. **AC3 — ALB access logs capture every HTTP request.**
   **Given** an HTTP request to the ALB
   **When** it is served
   **Then** ALB access logs capture it. **The `access_logs` block is absent from `alb.tf`** ([alb.tf:15-25](../../../velara-api/terraform/alb.tf#L15), verified) — add it, targeting an S3 bucket with the required ELB log-delivery bucket policy.

4. **AC4 — GuardDuty and AWS Config are enabled, or explicitly declined with a recorded reason.**
   **Given** the detective-control baseline
   **When** it is reviewed
   **Then** GuardDuty and AWS Config are each either enabled, **or explicitly declined with the reason recorded** in the SOC 2 control matrix (Story 13.7). **An auditor accepts a documented risk decision; they do not accept silence.** Make the call deliberately per control (they have real cost/operational implications) and write the decision + reason so 13.7 can cite it.

5. **AC5 — Log retention meets the compliance requirement, reconciled against the 90-day CloudWatch horizon.**
   **Given** log retention
   **When** CloudTrail and access logs are configured
   **Then** retention meets the compliance requirement. **Note: CloudWatch is currently 90 days** ([cloudwatch.tf:8,14](../../../velara-api/terraform/cloudwatch.tf#L8)), while `audit_log_entries` is **indefinite** — reconcile these deliberately, because a **90-day security-log horizon is short for breach investigation** (the industry norm/expectation is often 1 year for security-relevant logs; 13.3's S3 access-log bucket already uses `expiration { days = 365 }`). Set CloudTrail/access-log retention explicitly and justify it.

## Tasks / Subtasks

- [ ] **Task 1 — CloudTrail: a multi-region trail to a dedicated, locked-down bucket (AC1, AC5)**
  - [ ] Create a new `terraform/cloudtrail.tf`. Define an `aws_cloudtrail` (`is_multi_region_trail = true`, `enable_log_file_validation = true`, `include_global_service_events = true`) writing to a **dedicated CloudTrail S3 bucket** — do NOT reuse 13.3's `aws_s3_bucket.access_logs` (that's for S3 *server access logs*; CloudTrail needs its own bucket with a CloudTrail-specific bucket policy granting `cloudtrail.amazonaws.com` `s3:PutObject`/`s3:GetBucketAcl`).
  - [ ] **Reuse the 13.3 access-logs bucket pattern as the template** for the new CloudTrail bucket: `aws_s3_bucket` + `force_destroy = var.environment == "dev"` + SSE + `public_access_block` (all four flags true) + a `lifecycle_configuration` for retention (AC5 — set it to 365 days minimum, matching 13.3's access-log bucket; justify in a comment). The [s3.tf:229-268](../../../velara-api/terraform/s3.tf#L229) block is the exact shape to copy.
  - [ ] **Encryption:** CloudTrail supports SSE-KMS. There are 4 dedicated KMS keys today (one per service: rds/redis/s3/secrets). **Create a dedicated `aws_kms_key.cloudtrail`** (not reuse of `aws_kms_key.s3`, whose policy doesn't grant the CloudTrail service principal) with a key policy granting `cloudtrail.amazonaws.com` `kms:GenerateDataKey*`. This mirrors the per-service-key convention. (If the KMS key policy proves fiddly, SSE-S3/AES256 on the bucket is an acceptable fallback — 13.3's access-log bucket uses AES256 for exactly the "log-delivery service can't use our KMS key" reason. State which you chose and why.)
  - [ ] **Log-file validation ON** (`enable_log_file_validation = true`) — this is the tamper-evidence control an auditor looks for (digest files), and it's one line.
  - [ ] **Data events decision (ties to AC2):** decide whether to add an `event_selector` / `advanced_event_selector` for **S3 data events** on the PHI buckets (ingest/output/skill). Data events are **billed per event** and high-volume — scope them to the PHI buckets only, not account-wide, if you enable them. **Recommend:** enable S3 data events for the three PHI buckets (they give you "which IAM principal GET'd which object" — the exact out-of-band-GET attribution 13.3's server access logs approximate but without the principal). Management events are always on and free. Document the cost tradeoff.
  - [ ] Add a `terraform/outputs.tf` output for the CloudTrail bucket name / trail ARN (mirrors the existing outputs pattern — 13.7's control matrix will cite it).

- [ ] **Task 2 — ALB access logs (AC3)**
  - [ ] Add an `access_logs` block to `aws_lb.main` ([alb.tf:15](../../../velara-api/terraform/alb.tf#L15)): `access_logs { bucket = <alb-log-bucket>; prefix = "alb"; enabled = true }`.
  - [ ] ALB access logs require a bucket with a **specific bucket policy** granting the regional ELB log-delivery account (or, in newer regions, `logdelivery.elasticloadbalancing.amazonaws.com`) `s3:PutObject`. **This is the fiddly part** — the exact principal differs by region/partition. Use the `aws_elb_service_account` data source (the canonical way to get the right account ID per region) for the bucket policy, OR the newer service-principal form. **Verify against current AWS docs** — this is the ALB-logging equivalent of 13.2's phantom-IAM-action trap: a wrong principal is silently accepted at plan time and only fails when logs don't appear.
  - [ ] **Decide the bucket:** a dedicated `alb-logs` bucket, OR a prefix in the CloudTrail bucket, OR 13.3's `access_logs` bucket (it already exists and is for logs — but its policy would need extending for ELB delivery). **Recommend a dedicated bucket** for a clean per-source policy; state the choice. Same SSE/public-access-block/retention shape as Task 1.

- [ ] **Task 3 — VPC flow logs (AC1-adjacent — network-plane detective control)**
  - [ ] The epic's AC1 names "control-plane and data-plane activity." **VPC flow logs are not explicitly in an AC but are the standard network-plane detective control** and a routine SOC 2 CC7.1 expectation — `vpc.tf` has **no `aws_flow_log`** (verified). **Decision:** add `aws_flow_log` on `aws_vpc.main` (to CloudWatch Logs or the CloudTrail/log bucket), OR explicitly decline it in the AC4 "documented risk decision" bucket. **Recommend adding it** (it's cheap and standard) but it's a defensible AC4-style decline if you'd rather keep this story's scope tight — either way, **make the call explicit** and feed it to 13.7. Do not silently omit it.

- [ ] **Task 4 — GuardDuty + AWS Config: enable or documented-decline (AC4)**
  - [ ] **GuardDuty** (`aws_guardduty_detector`): threat detection over CloudTrail/VPC-flow/DNS logs. One resource to enable; it has a cost that scales with account activity. **Make the call:** enable (recommended for the compliance posture — it's the CC7.1 detective control that consumes the logs the rest of this story produces) OR decline-with-reason.
  - [ ] **AWS Config** (`aws_config_configuration_recorder` + `aws_config_delivery_channel` + a recorder status): continuous config-compliance recording. **Heavier** — it needs a recorder, a delivery channel to an S3 bucket, an IAM role, and (to be useful) config rules. This is the one most defensibly *deferred* with a documented reason (cost + operational weight for a single-account dev deployment). **Recommend:** enable GuardDuty; **document-decline AWS Config for now** with a clear reason (cost/operational weight; revisit at multi-account/prod-scale) — but that's a judgment call, make it explicitly.
  - [ ] ⚠️ **Whatever you enable or decline, write the decision + reasoning into the story's Dev Agent Record AND flag it for Story 13.7's SOC 2 control matrix.** AC4's whole point is that a *documented* decline is acceptable and *silence* is not. 13.7 will cite these decisions — give it something to cite.

- [ ] **Task 5 — Retention reconciliation (AC5)**
  - [ ] CloudWatch log groups are **90 days** ([cloudwatch.tf:8,14](../../../velara-api/terraform/cloudwatch.tf#L8)); `audit_log_entries` is indefinite; 13.3's S3 access-log bucket is **365 days**. **Reconcile deliberately:** set CloudTrail + ALB-log + any new log-bucket retention to a justified value (recommend ≥365 days for security-relevant logs), and **decide whether to bump the CloudWatch 90-day retention** for the security-relevant log groups. **The epic explicitly flags 90 days as short for breach investigation.** Document the final retention posture per log type — this is an AC5 deliverable and a 13.7 citation.
  - [ ] Consider a `var.log_retention_days` variable (default 365) so retention is one tunable rather than scattered literals — mirrors how `var.security_alert_email` (13.4) and `var.db_backup_retention_days` centralize other operational knobs. Optional but tidy.

- [ ] **Task 6 — Gates (Terraform-only story)**
  - [ ] `terraform fmt -check` clean on every touched/new file.
  - [ ] `terraform validate` passes. ⚠️ **A live `terraform plan` requires AWS credentials + state-lock access this environment does NOT have** — every prior Epic 13 TF task hit the same wall (`velara-tfstate-lock` DynamoDB lookup fails). So `validate` + `fmt` are the automatable gates; **the live `plan` is handed to the operator.** State this in the completion notes exactly as 13.3/13.4 did.
  - [ ] **`terraform validate` catches real errors but NOT everything** — the Terraform-AWS-apply-gotchas are real: an IAM policy description with non-ASCII chars, a bucket policy with the wrong service principal, or a resource coupled to a gated resource all pass `validate` and fail only at `apply`. **Be especially careful with the two bucket policies (CloudTrail Task 1, ALB Task 2)** — they are the most apply-only-failure-prone parts. Cross-check both principals against current AWS docs.
  - [ ] **NO application code changes.** This is a pure-infrastructure story: no Python, no FE, no `audit_log_entries` events, no new `event_type` constants (so **no `audit_categories.py` change and no guard-test interaction** — a nice change from 13.1-13.4). No migration. No `docs/api-spec.json` change. If you find yourself editing `app/`, you have gone off the rails.
  - [ ] ⚠️ **DO NOT `terraform apply`.** Author + plan; operator applies. (CloudTrail is lower-risk than the auth-path changes in 13.2/13.4, but the standing rule is absolute.)

## Dev Notes

### ⛔ TRAP 1 — 13.3 already shipped S3 access logging. Do NOT re-add it.

The single most likely way to waste effort or create a conflict here: **re-adding S3 bucket logging that 13.3 already shipped.** [s3.tf:212-286](../../../velara-api/terraform/s3.tf#L212) defines `aws_s3_bucket.access_logs` + `aws_s3_bucket_logging` for ingest/output/skill, and its own comment tells you directly: *"This AC overlaps Story 13.5 (cloud detective controls); 13.3 lands first per the epic's story order, so it owns this here — 13.5 must NOT re-add logging for these buckets, only extend to any NEW buckets/detective controls it introduces."* Re-declaring `aws_s3_bucket_logging.ingest` (etc.) is a duplicate-resource error at `plan`. Your AC2 job is the *complementary* controls (CloudTrail data events for principal-level attribution) and any bucket 13.3 skipped — not a redo. Read s3.tf's Story-13.3 block in full before touching anything S3.

### ⛔ TRAP 2 — 13.4 already added `var.security_alert_email` + the security alarm + SNS subscription

13.4 added `var.security_alert_email` ([variables.tf:184](../../../velara-api/terraform/variables.tf#L184)), an `aws_sns_topic_subscription.security_alert_email` (conditional on that var), and the `security_events` metric filter + alarm in `cloudwatch.tf`. **Do not re-add any of those.** If GuardDuty (Task 4) should notify someone, wire its findings to the **existing** `aws_sns_topic.alerts` (or a GuardDuty-native destination) — reuse, don't recreate. Check `cloudwatch.tf` for what's already there before adding any SNS/alarm resource.

### ⛔ TRAP 3 — The two bucket policies are the apply-only-failure landmines

`terraform validate` will happily accept a CloudTrail or ALB-log bucket policy with the **wrong service principal or account ID**, and it fails only at `apply` when logs silently never appear. Two specifics:
- **CloudTrail bucket policy:** must grant `cloudtrail.amazonaws.com` `s3:GetBucketAcl` (on the bucket) + `s3:PutObject` (on `${bucket}/AWSLogs/${account_id}/*`) with the `aws:SourceArn`/`s3:x-amz-acl = bucket-owner-full-control` conditions AWS now requires. The `data.aws_caller_identity.current.account_id` is already available ([secrets.tf:15](../../../velara-api/terraform/secrets.tf#L15)) — use it for the resource ARN.
- **ALB access-log bucket policy:** the delivery principal differs by region. Old regions use a **regional ELB account ID** (get it via the `aws_elb_service_account` data source — the canonical, region-correct way); newer regions use the `logdelivery.elasticloadbalancing.amazonaws.com` service principal. **Using the wrong one is exactly the Story 10.1 phantom-IAM-action class of bug** — accepted silently, fails at runtime. Verify against current AWS docs for `var.region`.

Both are the reason this story is `plan`-and-hand-off: the operator's real `plan`/`apply` against the live account is where a wrong principal surfaces. Author them carefully, but expect the operator to be the one who confirms delivery works.

### This is a Terraform-ONLY story — a clean break from 13.1-13.4

The prior four Epic 13 stories all touched `app/` (event constants, `audit_categories.py`, the guard tests, route handlers). **This one does not.** No new `event_type`, so:
- **No `audit_categories.py` change**, and **no `test_audit_category_guard.py` interaction** — the guard that auto-failed in every prior story is silent here because you're adding zero event constants.
- **No `test_audit_coverage_guard.py` interaction** — no new routes.
- **No `docs/api-spec.json` change**, **no migration**, **no FE change.**

If any of those files show up in your diff, you have drifted out of scope. The entire deliverable is `terraform/*.tf` (+ maybe a `variables.tf`/`outputs.tf` line). This also means the gates are just `terraform fmt -check` + `validate` — no pytest/vitest/ruff run is *required* by this story's changes (though running the suite to confirm you broke nothing is cheap and wise).

### The plan-only reality (carried from every Epic 13 TF task)

Every prior Epic 13 Terraform task (13.2 IAM, 13.3 S3 logging, 13.4 Cognito ASM + CloudWatch) reports the same thing: `terraform validate` + `fmt -check` pass locally, but a live `terraform plan` **cannot run in this environment** — there are no AWS credentials and the `velara-tfstate-lock` DynamoDB state-lock lookup fails. That is expected and consistent. **Your automatable gates are `validate` + `fmt`; the live `plan` (and the `apply`) go to the operator.** Say so in the completion notes, exactly as 13.3/13.4 did — it is not a failure, it is the standing operating model for infra changes in this repo.

### Retention: the numbers already in the repo (AC5)

- CloudWatch log groups (`api`, `worker`): **90 days** ([cloudwatch.tf:8,14](../../../velara-api/terraform/cloudwatch.tf#L8)).
- `audit_log_entries`: **indefinite** (append-only, never pruned — DB-trigger-enforced).
- 13.3's S3 access-log bucket: **365 days** ([s3.tf:266](../../../velara-api/terraform/s3.tf#L266)).
- RDS backups: `var.db_backup_retention_days`.

AC5 wants these reconciled deliberately. The cleanest story: set all **security-relevant** logs (CloudTrail, ALB, flow logs) to **≥365 days** to match 13.3's precedent and clear the "90 days is short for breach investigation" concern, and decide explicitly whether the 90-day CloudWatch app-log retention should rise too (it holds the `security_events`-source structured logs 13.4's alarm reads — a case for bumping it). Document the final posture; 13.7 cites it.

### Reference the existing resource shapes — don't invent conventions

Everything you need has a template already in the repo:
- **Bucket + SSE + public-access-block + lifecycle:** 13.3's `access_logs` bucket ([s3.tf:229-268](../../../velara-api/terraform/s3.tf#L229)).
- **KMS key + alias:** any of the 4 per-service keys (e.g. [s3.tf:12-22](../../../velara-api/terraform/s3.tf#L12)).
- **Data sources:** `data.aws_caller_identity.current` + `data.aws_region.current` ([secrets.tf:15-16](../../../velara-api/terraform/secrets.tf#L15)) — already declared, reuse them (don't redeclare — duplicate data sources with the same name across files is fine in TF, but reuse the existing ones for clarity).
- **A conditional, env-driven resource:** 13.4's `aws_sns_topic_subscription.security_alert_email` (count on a var) and the `var.environment == "dev"` guards throughout.
- **Outputs:** the `outputs.tf` pattern (name + description + value).

Match the tagging convention (`tags = { Name = "${local.name_prefix}-..." }`) on every new resource — it's universal in this codebase.

### Testing standards

There is no unit/integration test for Terraform in this repo — the "test" is `terraform validate` + `fmt -check` + the operator's `plan`. **Do not invent a TF testing framework.** The verification that matters is: (1) `validate` passes, (2) `fmt -check` passes, (3) the two bucket policies are cross-checked against current AWS docs (Trap 3), (4) the enable/decline decisions (Task 4) are documented for 13.7. If you want belt-and-suspenders, `terraform plan` against a throwaway/localstack target is optional and not required.

### Project Structure Notes

- `velara-api/terraform/cloudtrail.tf` — **NEW** (trail + dedicated bucket + bucket policy + KMS key; Task 1)
- `velara-api/terraform/alb.tf` — MODIFIED (`access_logs` block on `aws_lb.main`; Task 2)
- `velara-api/terraform/s3.tf` — possibly MODIFIED (ALB-log / CloudTrail bucket if co-located here rather than in cloudtrail.tf; do NOT touch the 13.3 access-logs block)
- `velara-api/terraform/vpc.tf` — possibly MODIFIED (`aws_flow_log`; Task 3, if not declined)
- `velara-api/terraform/guardduty.tf` (or in cloudtrail.tf) — **NEW/MODIFIED** (GuardDuty detector; AWS Config if enabled; Task 4)
- `velara-api/terraform/cloudwatch.tf` — possibly MODIFIED (retention bump; Task 5 — do NOT touch 13.4's security alarm/subscription)
- `velara-api/terraform/variables.tf` — possibly MODIFIED (`var.log_retention_days`; Task 5, optional)
- `velara-api/terraform/outputs.tf` — MODIFIED (CloudTrail bucket/trail output; Task 1)

**No application code. No migration. No `docs/api-spec.json`. No FE. Plan only — operator applies.**

### References

- [Source: epics/epic-13-compliance-audit-and-access-controls.md#Story-13.5] — ACs verbatim; the "zero cloudtrail/guardduty/aws_config across 15 tf files" finding; the "console actions are also unlogged" compounding point; the availability-only-alarms observation; the plan-only warning.
- [Source: velara-api/terraform/s3.tf:212-286] — **13.3's `access_logs` bucket + `aws_s3_bucket_logging` (Trap 1 — do NOT re-add); the exact bucket/SSE/public-access/lifecycle shape to copy** for the CloudTrail/ALB-log buckets; the `expiration { days = 365 }` retention precedent (AC5); the AES256-not-KMS rationale for log-delivery buckets.
- [Source: velara-api/terraform/alb.tf:15-25] — `aws_lb.main` with **no `access_logs` block** (AC3); the `local.has_cert`/`var.environment` conditional patterns.
- [Source: velara-api/terraform/cloudwatch.tf:6-14] — CloudWatch log groups at **90 days** (AC5 reconciliation); [and 13.4's `security_events` metric filter + alarm + `aws_sns_topic_subscription.security_alert_email` — Trap 2, do NOT re-add].
- [Source: velara-api/terraform/variables.tf:184] — `var.security_alert_email` already exists (13.4); the variable conventions to mirror for a `var.log_retention_days`.
- [Source: velara-api/terraform/secrets.tf:15-16] — `data.aws_caller_identity.current` + `data.aws_region.current`, already declared (reuse for bucket policies / trail ARNs).
- [Source: velara-api/terraform/s3.tf:12-22] — the per-service `aws_kms_key` + `aws_kms_alias` shape (for a dedicated CloudTrail key).
- [Source: velara-api/terraform/vpc.tf] — `aws_vpc.main` with no `aws_flow_log` (Task 3).
- [Source: implementation-artifacts/stories/13-4-auth-and-authz-event-auditing.md] — the plan-only/state-lock reality (validate+fmt are the gates; live plan → operator); `var.security_alert_email` + SNS-subscription already shipped; the ENFORCED-ASM decision that this story's CloudTrail now makes *auditable* (console MFA/ASM changes become CloudTrail events).
- [Source: implementation-artifacts/stories/13-3-audit-read-path-phi-disclosure.md] — the S3-access-logging that 13.3 owns (Trap 1); the plan-only DynamoDB-state-lock note.
- [Source: memory — Terraform AWS Apply Gotchas] — validate/actionlint miss apply-only defects (non-ASCII IAM description; policy coupled to a gated resource); dev-account facts (account 068858795262, gha-deploy roles) — relevant when the operator runs the live plan.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log
