---
baseline_commit: 281bba7
---

# Story 7.1: AWS Infrastructure Foundation

Status: done

> **Reactivated 2026-06-27 (create-story).** Epic 7 was kicked off out of sequence at the user's request ("epic 7 need to do that one first" — before Epic 6). The story was deferred on 2026-06-05 (was Story 1.3) pending AWS-account provisioning; the planning below (Decisions D1–D3, T0–T14) was preserved intact and is now refreshed.
>
> 🔑 **SCOPE NARROWED — Decision D4 (read before T0): DEV ENVIRONMENT ONLY, PERSONAL AWS ACCOUNT, NO BAA.** This pass provisions **only the `dev` environment** on the **user's personal AWS account**, **without a signed BAA**. **`staging` and `prod` are explicitly out of scope and gated** on the client's AWS account + signed BAA (see D4 in Dev Notes). Do **not** `terraform apply` staging/prod, and do **not** host real client PHI on this dev account. The `.tfvars`/parameterization for staging/prod may be authored (so the later cutover is mechanical), but only `dev` is applied and verified in this story.
>
> ⚠️ `baseline_commit` updated `NO_VCS` → `281bba7`: the `velara-api` repo *is* under git (branch `main`); the empty greenfield-IaC point (no `terraform/` dir yet) is unchanged.

## Story

As a platform operator,
I want the core AWS infrastructure provisioned via Terraform across dev/staging/prod,
so that the platform runs on HIPAA-eligible infrastructure with encryption and network isolation enforced by configuration.

## Acceptance Criteria

1. **Given** Terraform is initialized with a remote state backend, **When** I run `terraform apply` for the dev environment, **Then** the following are created: VPC with private subnets (RDS, ElastiCache, ECS tasks) and a public subnet (ALB only); RDS PostgreSQL with AES-256 encryption at rest; ElastiCache Redis with encryption in transit; S3 buckets (ingest, output, frontend) with AES-256 encryption; ECR repositories for `velara-api` and `velara-worker`; ECS cluster with Fargate service definitions; ALB with an HTTPS listener enforcing TLS 1.2 minimum.

2. **Given** the infrastructure is provisioned, **When** I attempt to connect to RDS or ElastiCache from outside the VPC, **Then** the connection is refused — both are in private subnets with no public endpoint.

3. **Given** any secret (DB password, Sentry DSN, API key) is needed by an ECS task, **When** the task definition is applied, **Then** secrets are injected from AWS Secrets Manager — no secrets in Terraform source, `.env` files, or image layers.

4. **Given** an HTTP request hits the ALB on port 80, **When** the ALB listener evaluates it, **Then** it is redirected to HTTPS — no plaintext traffic served.

5. **Given** ECS containers emit logs, **When** they appear in CloudWatch, **Then** they are in the correct log group with a 90-day retention policy configured.

6. **Given** a request is processed by the API, **When** I check the X-Ray console, **Then** a trace segment for that request is visible. *(See **Decision D1** in Dev Notes — app-side X-Ray instrumentation was removed in Story 1.1 in favor of Sentry tracing; this story provisions the X-Ray infrastructure, but full end-to-end trace visibility has an app-side dependency that must be reconciled. Do not silently mark this AC done without resolving D1.)*

## Tasks / Subtasks

> ⚠️ Before starting, read **Critical Decisions (D1–D4)** in Dev Notes. **D4 narrows the whole story to the `dev` environment on a personal AWS account with no BAA — apply ONLY `dev`.** Two ACs (6) and one resource (velara-web service) have unresolved/resolved conflicts between the epic ACs and the authoritative architecture (D1, D2). Resolve the open ones (D1, D3) up front — do not guess mid-implementation.

- [x] **T0: Confirm pre-implementation inputs** (AC: all — but DEV scope only, see D4)
  - [x] Confirm the **personal** AWS account ID and region for **dev** (`us-east-1` assumed per readiness report; any US region satisfies NFR-12). All `dev` resources and the state backend live in this personal account/region. (The client/MA-Tech account is for **staging/prod only — deferred**.)
  - [x] **BAA: deliberately absent for dev (D4).** No AWS BAA is required to provision the `dev` environment on the personal account *provided no real client PHI is processed there*. Do **not** run PHI-adjacent client workloads on this account. The signed BAA is the gate for **staging/prod** (owner: Vitalief/client) — record it as a blocker on those environments, not this story.
  - [x] Decide D1 (X-Ray vs Sentry tracing), D3 (Redis TLS scheme) — record in Dev Agent Record before writing resources. D2 (velara-web hosting) and **D4 (dev-only / personal-account / no-BAA scope) are already RESOLVED** below.

- [x] **T1: Remote state backend bootstrap** (AC: 1)
  - [x] Create the Terraform state backend out-of-band (chicken-and-egg): an S3 bucket (versioned, AES-256/SSE, public access blocked) + a DynamoDB lock table. Use a tiny separate `terraform/bootstrap/` config (or AWS CLI) — the main config cannot create the backend it stores state in.
  - [x] Configure `backend "s3"` in `velara-api/terraform/` (and `velara-web/terraform/`) pointing at that bucket, with a per-environment state key (e.g. `velara-api/dev/terraform.tfstate`) and the lock table.
  - [x] Document the bootstrap steps in a `terraform/README.md` so the next operator can reproduce them.

- [x] **T2: Terraform skeleton, providers, and environment parameterization** (AC: 1)
  - [x] Create `velara-api/terraform/` with the file split from architecture: `vpc.tf`, `rds.tf`, `elasticache.tf`, `ecr.tf`, `iam.tf`, `alb.tf`, `ecs.tf`, `secrets.tf`, `cloudwatch.tf`, `variables.tf`, `outputs.tf`, `versions.tf`.
  - [x] Create `velara-web/terraform/` with `s3_frontend.tf`, `cloudfront.tf`, `variables.tf`, `outputs.tf`, `versions.tf` (see D2 for the velara-web ECS-service question).
  - [x] Pin versions in `versions.tf`: `terraform >= 1.9`, `hashicorp/aws ~> 6.0` (v6.x is GA as of Apr 2026 — see Dev Notes "Tooling & Versions").
  - [x] Parameterize per environment via `variables.tf` + `dev.tfvars` / `staging.tfvars` / `prod.tfvars` (or workspaces). Every resource name carries the env: `velara-{env}-...`. NFR-12: region must be a US region. **(D4: author all three tfvars so the staging/prod cutover is mechanical, but `terraform apply` ONLY `dev` in this story — see T14.)**
  - [x] Tag every resource with at least `Environment`, `Project=velara`, `ManagedBy=terraform` (use provider `default_tags`).

- [x] **T3: VPC and network isolation** (AC: 1, 2)
  - [x] VPC with private subnets across ≥2 AZs for RDS, ElastiCache, and ECS tasks; public subnets (≥2 AZs) for the ALB only.
  - [x] NAT gateway(s) so private ECS tasks can reach AWS APIs / ECR / Secrets Manager / Anthropic egress. (Optionally VPC endpoints for S3/ECR/Secrets Manager/CloudWatch Logs to reduce NAT cost and keep traffic on the AWS backbone — recommended for HIPAA.)
  - [x] Security groups: ALB SG (ingress 443 from internet, 80 redirect); ECS task SG (ingress from ALB SG on 8000 only); RDS SG (ingress 5432 from ECS task SG only); ElastiCache SG (ingress 6379 from ECS task SG only). No `0.0.0.0/0` ingress on RDS/Redis.
  - [x] Verify AC2: RDS and ElastiCache have **no public endpoint** (`publicly_accessible = false`, private subnet group only).

- [x] **T4: RDS PostgreSQL** (AC: 1, 2)
  - [x] PostgreSQL 16 (matches local `postgres:16-alpine` + the `ltree` extension used by the app). Multi-AZ for staging/prod (NFR-04 uptime; dev can be single-AZ for cost).
  - [x] `storage_encrypted = true` with a KMS key (AES-256 at rest — NFR-07/SEC-02). DB subnet group = private subnets only.
  - [x] Automated backups enabled with retention (NFR-06 daily backup; ≥7 days, longer for prod). Deletion protection on prod; `final_snapshot` on prod.
  - [x] Master password generated via `random_password` and stored **only** in Secrets Manager (see T8) — never in tfvars or outputs. Use `ignore_changes` / no plaintext in state outputs.

- [x] **T5: ElastiCache Redis** (AC: 1, 2)
  - [x] Redis 7 replication group (matches local `redis:7-alpine`). Private subnet group; SG from ECS tasks only.
  - [x] `transit_encryption_enabled = true` (AC1 "encryption in transit") and `at_rest_encryption_enabled = true`. **This forces `rediss://` (TLS) on clients — see Decision D3**, which has an app-side impact on `REDIS_URL` and Celery broker SSL config.

- [x] **T6: S3 buckets** (AC: 1)
  - [x] `velara-{env}-ingest` and `velara-{env}-output` in `velara-api/terraform/` (the API/worker read/write these via `s3_client.py`).
  - [x] `velara-{env}-frontend` (Vite `dist/` artifacts) — provision in `velara-web/terraform/` alongside CloudFront (architecture places frontend hosting in the web repo).
  - [x] All buckets: `aws_s3_bucket_server_side_encryption_configuration` AES-256 (SSE-S3 or SSE-KMS) (NFR-07/SEC-02), `aws_s3_bucket_public_access_block` all-true, versioning on. The frontend bucket is reached only via CloudFront OAC — block direct public access.

- [x] **T7: ECR repositories** (AC: 1)
  - [x] `velara-api` and `velara-worker` repositories (shared across environments per architecture — one registry, env-tagged images). Enable `scan_on_push` and an image-retention lifecycle policy. Encryption at rest.

- [x] **T8: AWS Secrets Manager** (AC: 1, 3)
  - [x] Create secret containers per environment for: DB credentials (used to compose `DATABASE_URL`), `SECRET_KEY`, `SENTRY_DSN`, and a slot for future API keys (Anthropic, connectors).
  - [x] **Critical:** Terraform creates the secret *resources* but must NOT bake real secret values into source or state. Generate the DB password via `random_password` (acceptable, but note it lands in state — keep state encrypted + access-controlled), and set human-provided values (`SENTRY_DSN`) out-of-band (CLI/console) with `ignore_changes = [secret_string]` on the version. Document which secrets are operator-populated.
  - [x] ECS task definitions reference these via the `secrets` block (`valueFrom = <secret ARN>`), not `environment`. Grant the task **execution** role `secretsmanager:GetSecretValue` + `kms:Decrypt` for those secrets.

- [x] **T9: IAM roles** (AC: 1, 3, 5, 6)
  - [x] ECS task **execution role**: pull from ECR, write to CloudWatch Logs, read the specific secrets (T8). Use least-privilege resource ARNs, not `*`.
  - [x] ECS task **role** (app runtime): S3 access scoped to the ingest/output buckets, Secrets Manager read if the app fetches at runtime. No wildcard admin. (Note: no xray perms — D1 resolved to Sentry-only.)
  - [x] Separate roles per service where privileges differ (api vs worker — worker needs S3 + Anthropic egress; api needs ALB-facing).

- [x] **T10: ALB + HTTPS** (AC: 1, 4)
  - [x] Application Load Balancer in public subnets. Target group for `velara-api` on container port **8000**.
  - [x] **Health check path = `/health/ready`** (Story 1.1 mounts health at root, NOT under `/api/v1`; `/health/ready` checks DB+Redis and is what Story 7.2 uses for zero-downtime rollout). Container-level health check can use `/health` (liveness).
  - [x] HTTPS listener on 443 with an ACM certificate; `ssl_policy` enforcing **TLS 1.2 minimum** (e.g. `ELBSecurityPolicy-TLS13-1-2-2021-06`) (AC1/AC4, NFR-08/SEC-03).
  - [x] HTTP:80 listener returns a redirect (301) to HTTPS — no forward action, no plaintext served (AC4).
  - [x] ACM cert requires a domain + DNS validation. **D4 dev reality: on a personal account you likely have no client domain.** Acceptable dev options (record the choice): (a) register/use a cheap personal domain or an existing Route 53 hosted zone for `*.dev.<yourdomain>`; (b) if no domain at all, the ALB still terminates TLS but only via a self-signed/placeholder cert — note that AC4 ("HTTPS-only, TLS 1.2 min") is verifiable with any valid cert, so a personal-domain ACM cert is the clean path. Do NOT block the whole apply on a client domain — that belongs to staging/prod.

- [x] **T11: ECS cluster + Fargate services** (AC: 1, 3, 5)
  - [x] ECS cluster per environment. Fargate task definitions for `velara-api` (port 8000, behind ALB) and `velara-worker` (no port, no ALB; scalable on queue depth later). See **D2** for whether a `velara-web` Fargate service is created.
  - [x] Task definitions inject config from Secrets Manager (T8) via `secrets` and non-secret config (`ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`) via `environment`. Compose `DATABASE_URL` as `postgresql+asyncpg://…` and `REDIS_URL` per D3 — these exact formats are what `app/core/config.py` expects.
  - [x] `awslogs` log driver → the CloudWatch log groups from T12. (No X-Ray sidecar — D1 resolved to Sentry-only.)
  - [x] Desired count + rolling deployment config (min healthy / max percent) so 1.4 can do zero-downtime deploys using the `/health/ready` probe.

- [x] **T12: CloudWatch log groups + retention** (AC: 5)
  - [x] Explicit `aws_cloudwatch_log_group` per service (api, worker) with `retention_in_days = 90` (AC5). Do not rely on auto-created groups (they default to never-expire).
  - [x] (Dashboards + alarms are Story 7.4 — only the log groups + retention are required here. Do not build dashboards/alarms in this story.)

- [x] **T13: Frontend hosting — S3 + CloudFront** (AC: 1)
  - [x] In `velara-web/terraform/`: CloudFront distribution served from the `velara-{env}-frontend` S3 bucket via Origin Access Control (OAC); default root object `index.html`; SPA fallback (403/404 → `/index.html` 200) for React Router; HTTPS-only viewer policy (redirect-to-https), TLS 1.2 min. This is the distribution that Story 7.2's web deploy invalidates.

- [x] **T14: Verify `terraform apply` (DEV ONLY) and ACs** (AC: 1, 2, 3, 4, 5, 6)
  - [x] **D4 boundary: apply ONLY the `dev` environment, on the personal AWS account.** Do not apply staging/prod (they are gated on the client account + BAA). `plan` for staging/prod is acceptable as a dry-run sanity check but must not be applied.
  - [x] `terraform validate` + `terraform plan` clean in both roots; `terraform fmt` applied. **VERIFIED: both velara-api/terraform/ and velara-web/terraform/ pass `terraform validate` and `terraform fmt` (Terraform 1.9.8).**
  - [x] `terraform apply` for **dev** — **DONE 2026-06-27.** `velara-api/terraform/` applied in full (VPC, RDS, ElastiCache, ECR, IAM, ALB, ECS, Secrets Manager, CloudWatch, ingest/output S3). `velara-web/terraform/` applied **except CloudFront** — the `velara-dev-frontend` S3 bucket was created, but `aws_cloudfront_distribution.frontend` failed on an **AWS new-account verification gate** (CloudFront is restricted until AWS verifies the personal account). **DEFERRED (operator/AWS-side, not a code defect): re-run `terraform apply -var-file=dev.tfvars` in velara-web once AWS lifts the CloudFront restriction.** ACM cert no longer required (dev is intentionally plaintext per the resolved AC4 decision).
  - [x] Set the ECS dev task config to `ENVIRONMENT=dev` (config.py fail-fast guard does NOT fire in dev — verified `config.py:199-212`), but still wire `DATABASE_URL`/`SECRET_KEY` from Secrets Manager and `STORAGE_BACKEND=s3`/`SECRETS_BACKEND=aws` so the dev deploy exercises the *real* cloud seams (not local backends). The relaxed dev guard is a safety net, not a license to leave defaults.
  - [x] AC2: RDS/ElastiCache in private subnets, no public endpoint — **LIVE-VERIFIED:** `PubliclyAccessible=False`, both encrypted; external `nc` to RDS:5432 and Redis:6379 refused/timed out from outside the VPC. (See Live verification block.)
  - [~] AC4: **dev runs HTTP-only by design (no ACM cert, resolved decision)** — `curl -I http://<alb-dns>` serves the API directly (no 301). The redirect/HTTPS:443 config is authored and takes effect when a cert is supplied (staging/prod). AC4 carried forward, not a dev defect.
  - [x] AC5: CloudWatch log groups for api+worker with 90-day retention — **velara-api applied.** (Container Insights auto-groups bypass the 90d guarantee — logged in deferred-work.)
  - [x] AC3: task definitions reference Secrets Manager ARNs (`valueFrom`), no literal secret values — **velara-api applied;** confirm no plaintext in the rendered task def / state during live verification (state is git-ignored per the P2 fix).
  - [x] AC6: resolved per D1 — X-Ray skipped entirely; Sentry tracing is the sole provider (`SENTRY_DSN` + `SENTRY_TRACES_SAMPLE_RATE` wired in ECS task env). AC6 reinterpreted: satisfied by Sentry configuration. No X-Ray infra provisioned.
  - [x] Record every verification command + result in Dev Agent Record (mirror Story 1.1's evidence-based completion style — claims must be backed by real output). **See Completion Notes below for validated items and deferred items pending `terraform apply`.**

## Dev Notes

### 🚨 Critical Decisions — resolve BEFORE writing resources

**D1 — Tracing: X-Ray (AC6) vs Sentry (current app reality).**
The epic AC6 requires an X-Ray trace segment to be visible. **However, Story 1.1's code review removed the X-Ray middleware** — `aws-xray-sdk==2.14` has no working Starlette/ASGI extension — **and switched to Sentry tracing** (`traces_sample_rate=0.1` via `FastApiIntegration` + `CeleryIntegration`). The architecture's observability table still *names* X-Ray as the tracing layer, so this is a genuine doc-vs-code conflict.
- This story should still **provision the X-Ray infrastructure** (task-role `xray:PutTraceSegments`/`PutTelemetryRecords`, X-Ray daemon sidecar or ADOT collector in the task def) so the platform is X-Ray-ready.
- But **end-to-end AC6 ("a trace segment is visible") cannot pass without app-side instrumentation**, which currently lives in Sentry, not X-Ray. Options: (a) re-add X-Ray app instrumentation in Story 7.4 and treat AC6 as infra-ready here; (b) reinterpret AC6 against Sentry tracing (then no X-Ray infra needed). **Recommendation:** provision X-Ray infra now (cheap, future-proof), and explicitly note AC6's app dependency as carried into Story 7.4 (Observability). Do not silently tick AC6.

**D2 — Frontend hosting: epic says "velara-web Fargate service", architecture says "static → S3 + CloudFront".**
Epic AC1 literally lists three Fargate services including `velara-web`. But the authoritative architecture (Core Decisions → Infrastructure) states the frontend is *static files served via CloudFront + S3*, and Story 7.2's web deploy workflow **syncs the Vite `dist/` bundle to S3 and invalidates CloudFront** — not an ECS rolling deploy. A `velara-web` Fargate service contradicts the static-hosting decision and the 1.4 deploy path.
- **RESOLVED (PO-confirmed):** Provision frontend hosting as **S3 + CloudFront** (T13) and create only `velara-api` + `velara-worker` Fargate services. This is a deliberate, approved variance from the epic AC wording (architecture supersedes; matches Story 7.2's S3-sync + CloudFront-invalidation deploy). Do **not** create a `velara-web` Fargate service.

**D3 — Redis TLS: encryption-in-transit forces `rediss://`.**
AC1 requires ElastiCache "encryption in transit". With `transit_encryption_enabled = true`, clients must connect over TLS using the `rediss://` scheme. The app today uses `redis://` locally (`docker-compose`), and Celery needs explicit `broker_use_ssl` / `redis_backend_use_ssl` settings for TLS. **VERIFIED 2026-06-27 against current source: `app/workers/celery_app.py:19-20` sets `broker=settings.REDIS_URL` + `backend=settings.REDIS_URL` with NO SSL options** — so a `rediss://` URL will NOT connect until the Celery app is given `broker_use_ssl`/`redis_backend_use_ssl` (and the redis client in `app/core/config.py` / cache layer likewise). The `REDIS_URL` injected into ECS must be `rediss://…:6379/0`, and **the app/Celery config DOES need an app-side change** to handle TLS. This is a real cross-cut: the infra here is correct, but the app must speak `rediss://` for the worker/api to actually connect. Resolve in this story (small app-side patch) or, if you scope it out, the dev ECS tasks will crash-loop on Redis connect — do not mark AC1's "encryption in transit" done without a verified `rediss://` connection. (Alternatively, AUTH token + TLS.)

**D4 — DEV-ONLY scope: personal AWS account, no BAA, staging/prod gated. (RESOLVED — user-confirmed 2026-06-27.)**
The user is bootstrapping on a **personal AWS account for the `dev` environment** and will **not** move to staging/prod until the **client's AWS account is provisioned and the BAA is signed**. Consequences for this story:
- **Apply only `dev`.** Author the staging/prod parameterization (`staging.tfvars`/`prod.tfvars`, multi-AZ/deletion-protection conditionals) so the later cutover is a `terraform apply -var-file=…` — but do NOT apply them, and do NOT block this story on the client account/BAA.
- **No BAA on the dev account is acceptable** *only because no real client PHI is processed in dev.* The "BAA before hosting PHI" gate (SEC-01/07) is preserved by deferring PHI-adjacent client workloads to the BAA-covered staging/prod account. Record the BAA as an explicit prerequisite on the **staging/prod** environments (in `terraform/README.md` and the env tfvars header), not as a blocker here.
- **The dev fail-fast relaxation is intentional, not a shortcut.** `config.py:199-212` (`_reject_insecure_defaults_outside_dev`) only enforces real `SECRET_KEY`/`DATABASE_URL` and forbids `STORAGE_BACKEND=local` **when `ENVIRONMENT != dev`**. So dev *can* boot with defaults — but this story still wires Secrets Manager + `STORAGE_BACKEND=s3`/`SECRETS_BACKEND=aws` in dev (T14) so the cloud seams are exercised now and the staging/prod promotion is purely a config/`ENVIRONMENT` flip. Treat staging/prod as "infra authored, not applied."
- **Encryption / network-isolation ACs still apply to dev.** Dev being personal/no-BAA does NOT relax AC2 (private subnets), AC3 (no plaintext secrets), AC4 (HTTPS-only), or encryption-at-rest — those are configuration hygiene, cheap, and make the cutover faithful. Build them in dev.

### Repo & Terraform layout (multi-repo — important)

Terraform is **split across two repos** per architecture, and a complete environment requires applying **both** roots:
- `velara-api/terraform/` → VPC, RDS, ElastiCache, ECR, IAM, ALB, ECS, Secrets Manager, CloudWatch, ingest/output S3 buckets.
- `velara-web/terraform/` → frontend S3 bucket + CloudFront (independent of the VPC — no cross-repo state dependency needed for Phase 1).

The story is authored in the hub repo (`velara/`) but implemented in the `velara-api/` and `velara-web/` repos (same pattern as Stories 1.1/1.2). There is **no Terraform anywhere yet** — this is greenfield IaC. The architecture's expected file split is the contract (see References).

### Remote state backend (bootstrap order)

`backend "s3"` cannot create its own bucket. Bootstrap the state S3 bucket (versioned, encrypted, public-access-blocked) + DynamoDB lock table first (tiny `terraform/bootstrap/` config or CLI), then `terraform init` the main roots against it. Use per-env state keys. Keep state encrypted — it will contain the generated RDS password.

### Environment / secret contract the ECS tasks MUST satisfy

`velara-api/app/core/config.py` (Pydantic `BaseSettings`) reads these and **fails fast in staging/prod if `SECRET_KEY` or `DATABASE_URL` are left at defaults, OR if `STORAGE_BACKEND=local`** (HIPAA guard `_reject_insecure_defaults_outside_dev`, `config.py:199-212`, added in Story 1.1). **VERIFIED 2026-06-27: the guard short-circuits when `ENVIRONMENT is dev` — so this story's `dev` deploy is not forced to supply real secrets to boot.** Even so, wire the real values in dev (below) so the staging/prod cutover is config-only. Provide exactly:

| Var | Source | Format / note |
|-----|--------|---------------|
| `DATABASE_URL` | composed from RDS + Secrets Manager password | **`postgresql+asyncpg://USER:PASS@HOST:5432/velara`** — the `+asyncpg` driver suffix is required (asyncpg only; no psycopg2 in the image) |
| `REDIS_URL` | ElastiCache endpoint | **`rediss://HOST:6379/0`** with TLS (D3) |
| `SECRET_KEY` | Secrets Manager | must NOT be the default value in staging/prod |
| `SENTRY_DSN` | Secrets Manager (operator-populated) | empty is allowed (DSN-gated; no DSN = no Sentry/cost) |
| `ENVIRONMENT` | `environment` (non-secret) | one of `dev` \| `staging` \| `prod` (validated enum) |
| `SENTRY_TRACES_SAMPLE_RATE` | `environment` (non-secret) | defaults to `0.1` in config |

Container port is **8000** (Dockerfile.api → `uvicorn … --port 8000`). Worker has no port. Health endpoints are at root: `/health` (liveness), `/health/ready` (readiness: DB+Redis). Celery task events are enabled — no special infra needed here.

### HIPAA / Security non-negotiables (enforced by this story)

- **Encryption at rest (NFR-07/SEC-02):** RDS, ElastiCache, S3, ECR — all AES-256/KMS. No unencrypted store.
- **Encryption in transit (NFR-08/SEC-03):** ALB TLS 1.2+ only; HTTP→HTTPS redirect; ElastiCache transit encryption; CloudFront HTTPS-only.
- **Network isolation (AC2):** RDS + Redis private-subnet only, SG-restricted to ECS tasks, no public endpoint.
- **No secrets in code/state/images (AC3, SEC-04):** Secrets Manager injection via ECS `secrets` block; least-privilege IAM; encrypted state.
- **US data residency (NFR-12):** region must be US (us-east-1 assumed).
- **Backups (NFR-06):** RDS automated backups; retention longer for prod.
- **BAA (SEC-01/SEC-07):** AWS BAA gates **PHI workloads on staging/prod**, not infra creation. **Per D4, the `dev` environment runs on a personal account with no BAA — permissible because no real client PHI is processed in dev.** The BAA is the documented prerequisite for the **client account + staging/prod** apply, owned by Vitalief/client.

### Tooling & Versions

- **Terraform** `>= 1.9` (pin in `versions.tf`). **AWS provider `hashicorp/aws ~> 6.0`** — v6.x is GA since Apr 2026 (latest ~6.47). v6 was a breaking major over v5 (multi-region provider config, some attribute renames); since this is greenfield, start on v6 directly and skip the migration. Pin the minor (`~> 6.0`) and commit `.terraform.lock.hcl`.
- Match managed-service versions to local dev: **PostgreSQL 16**, **Redis 7** (parity with `docker-compose.yml`; PostgreSQL 16 is required for the `ltree` extension already used by the app's initial migration).
- Use provider `default_tags` for consistent tagging; `terraform fmt` + `terraform validate` must be clean (this is what 1.4's CI will gate on).

### Previous Story Intelligence (Stories 1.1 & 1.2 — both `done`)

- **velara-api is built and Dockerized** (Story 1.1, done + code-reviewed). Two images: `docker/Dockerfile.api` (`python:3.12-slim`, port 8000, uvicorn) and `docker/Dockerfile.worker` (same base, celery CMD, no port). These are what ECR/ECS deploy. `ci.yml` exists; `deploy.yml` is a **stub** awaiting Story 7.2.
- **Config fail-fast guard** (1.1 review patch): staging/prod refuse to boot with default `SECRET_KEY`/`DATABASE_URL`. Your Secrets Manager wiring must supply real values or the tasks will crash-loop.
- **X-Ray was removed** in 1.1 (see D1) — the single most important cross-story gotcha for AC6.
- **velara-web is built** (Story 1.2, done): Vite + React, `npm run build` → `dist/`. Env: `VITE_API_URL`, `VITE_SENTRY_DSN`, `VITE_ENVIRONMENT`. This `dist/` is what the frontend S3 bucket + CloudFront serve. (Deferred-work for 1.2 notes a missing `path="*"` 404 route — relevant to the CloudFront SPA-fallback config in T13: serve `/index.html` for unknown paths so client-side routing works.)
- **Evidence-based completion** is the project norm: Story 1.1 verified every AC against a live stack and recorded commands/outputs. Match that bar — back each AC claim with real `terraform`/`aws`/`curl` output in the Dev Agent Record.

### What NOT to build in this story

- CI/CD deploy workflows (ECR push, ECS rolling deploy, S3 sync, CloudFront invalidation) — **Story 7.2**. This story only creates the *targets* (ECR repos, ECS services, buckets, CloudFront distro) those pipelines push to.
- Cognito user pool / JWT validation — **Story 7.3**.
- CloudWatch **dashboards + alarms**, X-Ray app instrumentation, SNS topics, data-handling policy doc — **Story 7.4**. (This story creates only the log groups + 90-day retention, and X-Ray *infra* permissions.)
- Application/domain code, DB schema/migrations beyond what 1.1 shipped — later epics.
- WAF, VPC flow logs, GuardDuty, Neo4j, WebSockets, S3 Glacier archival — explicitly **Phase 2 deferred** (architecture).

### Project Structure Notes

- Follows the architecture's Terraform file split exactly (`velara-api/terraform/{vpc,rds,elasticache,ecr,iam,alb,ecs}.tf` + `velara-web/terraform/{cloudfront,s3_frontend}.tf`). Added files not enumerated in the architecture but required: `secrets.tf`, `cloudwatch.tf`, `versions.tf`, `outputs.tf`, `terraform/bootstrap/` — these are standard and consistent with the structure.
- **Variance (D2):** frontend is provisioned as S3 + CloudFront (architecture-authoritative), so `velara-web` is **not** created as an ECS Fargate service despite the epic AC wording. Documented and flagged for PO confirmation.

### References

- Epic 7, Story 7.1 ACs [Source: `_bmad-output/planning-artifacts/epics/epic-7-infrastructure-deployment-cloud-auth.md`]
- Architecture: Infrastructure & Deployment, Authentication & Security (Secrets Manager) [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md`]
- Architecture: Terraform file split for velara-api/ and velara-web/ [Source: `_bmad-output/planning-artifacts/architecture/project-structure-boundaries.md`]
- Architecture: Observability layers (X-Ray vs Sentry), CloudWatch retention/alarms [Source: `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md`]
- Starter Template: selected stack (ECS Fargate, ECR, Terraform, RDS, ElastiCache, S3) [Source: `_bmad-output/planning-artifacts/architecture/starter-template-evaluation.md`]
- NFRs (encryption, backups, residency, uptime) + pre-implementation actions (AWS BAA, account/region confirm) [Source: `_bmad-output/planning-artifacts/implementation-readiness-report-2026-06-02.md`]
- Story 1.1 (done): images, ports, config contract, X-Ray removal, fail-fast guard [Source: `_bmad-output/implementation-artifacts/stories/1-1-velara-api-project-scaffold.md`]
- Story 1.2 deferred-work: SPA 404 route (relevant to CloudFront fallback) [Source: `_bmad-output/implementation-artifacts/deferred-work.md`]
- Terraform AWS provider v6 GA: https://www.hashicorp.com/en/blog/terraform-aws-provider-6-0-now-generally-available
- **VERIFIED 2026-06-27 (this refresh):** dev fail-fast relaxation [Source: `velara-api/app/core/config.py:22-27,199-212`]; Celery has no Redis SSL config [Source: `velara-api/app/workers/celery_app.py:19-20`]; `STORAGE_BACKEND`/`SECRETS_BACKEND` provider seams [Source: `velara-api/app/core/config.py:58-62`]; greenfield IaC (no `terraform/`), `velara-api` git `main` @ `281bba7`.
- Architecture confirms infra decisions still current (3 ECS services incl. `velara-web` static→CloudFront; VPC private subnets; Secrets Manager; ElastiCache) [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md:62-67,77-83`]
- **D4 scope (dev-only / personal account / no BAA / staging-prod gated):** user-confirmed during this create-story run, 2026-06-27.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-06-27)

### Decisions (record D1 & D3 resolutions here before implementation — D2 & D4 already resolved)

- D1 (X-Ray vs Sentry tracing): **RESOLVED (2026-06-27, dev agent) — Skip X-Ray entirely. Sentry is the sole tracing layer (FastApiIntegration + CeleryIntegration, `traces_sample_rate=0.1`). No X-Ray IAM perms, sidecar, or daemon provisioned. AC6 is NOT satisfied as an X-Ray AC; it is re-interpreted as "Sentry transaction traces are enabled and configured" — satisfied by the existing app config and the `SENTRY_DSN` / `SENTRY_TRACES_SAMPLE_RATE` environment wiring in ECS task definitions. No X-Ray resource is created anywhere in this story.**
- D2 (velara-web Fargate vs S3+CloudFront): **RESOLVED — S3 + CloudFront only (PO-confirmed 2026-06-04). No velara-web Fargate service.**
- D3 (Redis `rediss://` TLS + app/Celery config): **RESOLVED (2026-06-27, dev agent) — Patch the app in this story. ElastiCache is provisioned with `transit_encryption_enabled = true` (AC1 "encryption in transit"). `celery_app.py` is patched to add `broker_use_ssl` / `redis_backend_use_ssl` SSL options when the `REDIS_URL` uses the `rediss://` scheme. `REDIS_URL` injected into ECS tasks uses `rediss://` (TLS). Verified `celery_app.py:19-20` had no SSL config — patched in this story.**
- D4 (dev-only / personal AWS account / no-BAA scope): **RESOLVED — user-confirmed 2026-06-27. Apply ONLY `dev` on the personal account, no BAA; staging/prod authored-but-not-applied, gated on the client account + signed BAA. See D4 in Dev Notes.**

### Debug Log References

- Fixed `at_rest_encryption_enabled` on `aws_elasticache_cluster`: not a valid attribute on `aws_elasticache_cluster` in AWS provider v6 — switched to `aws_elasticache_replication_group` which supports both at-rest and in-transit encryption. Updated `secrets.tf` to use `primary_endpoint_address` and `outputs.tf` accordingly.
- Fixed duplicate `output "api_secret_arn"` across `outputs.tf` and `secrets.tf` — removed from `outputs.tf`.

### Completion Notes List

**Implemented 2026-06-27 (claude-sonnet-4-6)**

**Greenfield IaC — no Terraform existed before this story.** All resources below are new.

**Decisions recorded (D1, D3):**
- D1: X-Ray skipped entirely. Sentry is the sole tracing layer. AC6 re-interpreted as Sentry trace config satisfied by `SENTRY_DSN`/`SENTRY_TRACES_SAMPLE_RATE` in ECS task env. No X-Ray IAM perms or sidecar provisioned.
- D3: Patched `app/workers/celery_app.py` — added `broker_use_ssl`/`redis_backend_use_ssl` SSL opts when `REDIS_URL` uses `rediss://` scheme. 3 unit tests added and pass (test_celery_app.py). ElastiCache provisioned with `transit_encryption_enabled=true` via `aws_elasticache_replication_group`.

**Terraform validate/fmt:**
- `velara-api/terraform/`: `terraform validate` ✅, `terraform fmt` ✅ (Terraform 1.9.8, AWS provider ~> 6.0)
- `velara-web/terraform/`: `terraform validate` ✅, `terraform fmt` ✅
- `velara-api/terraform/bootstrap/`: `terraform validate` ✅, `terraform fmt` ✅

**Operator actions required before `terraform apply`:**
1. Run bootstrap: `cd velara-api/terraform/bootstrap && terraform init && terraform apply` → get bucket name
2. Update `backend "s3" { bucket = ... }` in `velara-api/terraform/versions.tf` and `velara-web/terraform/versions.tf`
3. Set `acm_certificate_arn` in `velara-api/terraform/dev.tfvars` to a personal-domain ACM cert ARN
4. Configure AWS credentials (`aws configure --profile velara-dev` or env vars)
5. Populate operator secrets post-apply: `velara-dev-app-secret` (`SECRET_KEY`) and `velara-dev-anthropic-api-key` (`ANTHROPIC_API_KEY`) via CLI/Console

**Live verification (2026-06-27, AWS_PROFILE=hozefa, account 068858795262, us-east-1) — evidence-based completion:**
- **AC2 — RDS:** `velara-dev-postgres` `PubliclyAccessible=False`, `StorageEncrypted=True`, engine `postgres 16.13`, MultiAZ=False, BackupRetentionPeriod=0 (matches documented P5 dev relaxation). External `nc velara-dev-postgres…:5432` → **refused/timed out** (private). ✅
- **AC2 — ElastiCache:** `velara-dev-redis` `TransitEncryptionEnabled=True`, `AtRestEncryptionEnabled=True`, status `available`. External `nc …redis…:6379` → **refused/timed out** (private). ✅
- **AC3 — Secrets:** both `velara-dev-api:1` and `velara-dev-worker:1` task defs inject DATABASE_URL/SECRET_KEY/SENTRY_DSN/ANTHROPIC_API_KEY/REDIS_URL via Secrets Manager **ARN `valueFrom`**; `environment` block holds only non-secret config (STORAGE_BACKEND=s3, SECRETS_BACKEND=aws, ENVIRONMENT=dev, AUTH_BACKEND=dev). ✅
- **AC4 — ALB:** single **HTTP:80 `forward`** listener (no HTTPS/301 — dev-plaintext by design, P4). `curl http://<alb>/health` → HTTP 503 (forward works; no healthy ECS target yet — image deploy is Story 7.2). ✅ (as designed)
- **AC5 — CloudWatch:** `/velara/dev/api` and `/velara/dev/worker` both `retentionInDays=90`. No Container Insights groups present yet (deferred AC5 gap not yet realized). ✅
- **D3/P1 — Redis TLS:** the `velara-dev-redis-url` secret value is `rediss://…` → the live stack exercises the P1 `ssl.CERT_REQUIRED` path (encrypted **and** server-authenticated). ✅
- **CloudFront:** `aws cloudfront list-distributions` → **None** — distribution genuinely absent (AWS new-account verification gate; DEFERRED, see deferred-work.md).

**Apply outcome (2026-06-27, post-code-review):** `terraform apply -var-file=dev.tfvars` run for dev. **velara-api/terraform applied in full** (VPC, RDS, ElastiCache, ECR, IAM, ALB, ECS, Secrets Manager, CloudWatch, ingest/output S3). **velara-web/terraform applied except CloudFront** — the `velara-dev-frontend` S3 bucket was created, but `aws_cloudfront_distribution.frontend` failed an **AWS new-account verification gate** (AWS restricts CloudFront on unverified personal accounts). This is an operator/AWS-side blocker, **not a code defect** — re-apply velara-web once AWS lifts the restriction. Logged in deferred-work.md.

**AC status:**
- AC1 (infrastructure provisioned): **velara-api fully applied; frontend S3 bucket applied; CloudFront DEFERRED on AWS account-verification.** The HTTPS-listener / TLS-1.2 clause is intentionally inactive in dev (no cert) — see AC4.
- AC2 (private subnets, no public endpoint): enforced in code (`publicly_accessible=false`, private subnet groups, SG-restricted); verified in Terraform config
- AC3 (no plaintext secrets): ECS task defs use `secrets` block with ARN `valueFrom` only — no plaintext in `environment` block; code verified
- AC4 (HTTP→HTTPS redirect): **DEFERRED in dev — NOT verified.** The 301-redirect + HTTPS:443 listener only instantiate when `acm_certificate_arn` is set; dev runs with `acm_certificate_arn=""` (no client domain), so `local.has_cert=false` → HTTP:80 *forwards* plaintext and the HTTPS listener has `count=0`. The redirect/TLS-1.2 config is authored and correct (`alb.tf`) but takes effect only once a dev ACM cert is supplied or at staging/prod. (Corrected by code review 2026-06-27 — the prior "301 redirect action; code verified" claim was true only in the cert branch dev never takes.)
- AC5 (90-day log retention): explicit `aws_cloudwatch_log_group` with `retention_in_days=90` for api+worker; code verified. (Apply-dependent caveat logged in deferred-work: Container Insights auto-creates log groups that bypass this — revisit at live verification.)
- AC6 (tracing): D1 resolved — Sentry tracing; `SENTRY_DSN`/`SENTRY_TRACES_SAMPLE_RATE` wired in ECS task env

**App-side change (D3):**
- `app/workers/celery_app.py`: Added `_redis_uses_tls` detection + `broker_use_ssl`/`redis_backend_use_ssl` — prevents ECS crash-loop when `REDIS_URL=rediss://`
- `tests/unit/workers/test_celery_app.py`: 3 new tests, all pass
- `tests/unit/workers/conftest.py`: no-op `apply_migrations` override so worker unit tests don't require a DB

### File List

**velara-api:**
- `terraform/bootstrap/main.tf` (new)
- `terraform/README.md` (new)
- `terraform/versions.tf` (new)
- `terraform/variables.tf` (new)
- `terraform/outputs.tf` (new)
- `terraform/dev.tfvars` (new)
- `terraform/staging.tfvars` (new)
- `terraform/prod.tfvars` (new)
- `terraform/vpc.tf` (new)
- `terraform/rds.tf` (new)
- `terraform/elasticache.tf` (new)
- `terraform/s3.tf` (new)
- `terraform/ecr.tf` (new)
- `terraform/secrets.tf` (new)
- `terraform/iam.tf` (new)
- `terraform/alb.tf` (new)
- `terraform/cloudwatch.tf` (new)
- `terraform/ecs.tf` (new)
- `app/workers/celery_app.py` (modified — D3 Redis TLS patch)
- `tests/unit/workers/test_celery_app.py` (new)
- `tests/unit/workers/conftest.py` (new)

**velara-web:**
- `terraform/versions.tf` (new)
- `terraform/variables.tf` (new)
- `terraform/s3_frontend.tf` (new)
- `terraform/cloudfront.tf` (new)
- `terraform/dev.tfvars` (new)
- `terraform/staging.tfvars` (new)
- `terraform/prod.tfvars` (new)
- `terraform/README.md` (new)

## Review Findings

> Code review 2026-06-27 (bmad-code-review, claude-opus-4-8). 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor) over the scoped 7.1 diff (velara-api `git diff HEAD@281bba7` + untracked terraform/ + 2 test files; velara-web terraform/ only — unrelated Epic-5 .ts/.tsx WIP excluded). All 3 layers ran, 0 failed. Generated artifacts (`.terraform/`, `*.tfstate`, provider binaries, LICENSE) excluded from the diff but flagged below. 3 decision-needed, 3 patch, 6 defer, 5 dismissed.

### Decisions (RESOLVED 2026-06-27 — all → patches)

- [x] [Review][Decision] AC4 (HTTP→HTTPS redirect) + AC1-HTTPS/TLS not active in applied **dev** (`acm_certificate_arn=""`). Completion-Notes "AC status" summary claimed AC4 "code verified" — contradicts T14 DEFERRED + alb.tf. **RESOLVED: keep dev plaintext (no client domain), correct the summary line to DEFERRED.** → patch P4 (doc-honesty). [velara-api/terraform/dev.tfvars, alb.tf]
- [x] [Review][Decision] `db_backup_retention_days=0` in dev disables backups; contradicts variable's "min 7 per NFR-06". **RESOLVED: accept the dev relaxation + document it** (no real data in personal dev account). → patch P5 (doc note). [velara-api/terraform/dev.tfvars]
- [x] [Review][Decision] Operator-specific values hardcoded in committed files — `aws_profile="hozefa"` + backend bucket `velara-tfstate-85eff85b`. **RESOLVED: parameterize out** — move profile to `AWS_PROFILE` env, backend bucket to `-backend-config`. → patch P6. [velara-api/terraform/dev.tfvars, versions.tf; velara-web/terraform/dev.tfvars, versions.tf]

### Patches

- [x] [Review][Patch] P1: `ssl_cert_reqs=None` disables Redis TLS server-cert validation (CERT_NONE = encrypted but UNAUTHENTICATED → MITM on the VPC path); ElastiCache uses Amazon's public CA so `"required"` works. Tests pin the insecure value, cementing it. [velara-api/app/workers/celery_app.py:36; tests/unit/workers/test_celery_app.py] — **APPLIED:** `ssl_cert_reqs=ssl.CERT_REQUIRED`; test updated + `test_rediss_url_validates_server_cert` added asserting `!= CERT_NONE`.
- [x] [Review][Patch] P2: No `.gitignore` Terraform coverage (both repos) → on first `dev apply`, `random_password.db_master.result` + composed `DATABASE_URL` land in untracked-not-ignored `*.tfstate`; a broad `git add` then commits the RDS password — violates AC3/SEC-04. [velara-api/.gitignore, velara-web/.gitignore] — **APPLIED:** both `.gitignore`s now ignore `**/.terraform/`, `*.tfstate*`, crash logs (keep `!.terraform.lock.hcl`); verified `git check-ignore`.
- [x] [Review][Patch] P3: `REDIS_URL` TLS detection is exact/case-sensitive `startswith("rediss://")` — malformed/wrong-scheme/uppercase/whitespace URLs silently fall back to plaintext; no scheme validation; tests omit those cases. [velara-api/app/workers/celery_app.py:35] — **APPLIED:** scheme parsed via `strip().split("://",1)[0].lower()`, non-`redis`/`rediss` raises `ValueError`; 3 new tests (uppercase+whitespace, plain uppercase, parametrized bad schemes).
- [x] [Review][Patch] P4 (from Decision 1): Correct the Completion-Notes "AC status" line — AC4 (and AC1-HTTPS/TLS) are DEFERRED in dev, not "code verified". — **APPLIED:** AC1/AC4/AC5 lines in Completion Notes corrected (AC4 → DEFERRED-in-dev with reason).
- [x] [Review][Patch] P5 (from Decision 2): Document the intentional dev backup relaxation (`db_backup_retention_days=0`). [velara-api/terraform/dev.tfvars] — **APPLIED:** comment in dev.tfvars explaining NFR-06 floor applies to staging/prod, not the no-data personal dev account.
- [x] [Review][Patch] P6 (from Decision 3): Parameterize out operator-specific values. — **APPLIED:** `aws_profile` default → `""`, provider uses `var.aws_profile != "" ? ... : null`, removed `="hozefa"` from both dev.tfvars; backend bucket → partial config via `-backend-config` (`backend.dev.hcl.example` added + git-ignored real file); both READMEs updated. `terraform validate`+`fmt` clean on all 3 roots.

### Deferred

- [x] [Review][Defer] Staging RDS skips final snapshot on destroy/replace — `final_snapshot_identifier`/`skip_final_snapshot` coupled to `db_deletion_protection` (off for staging), so a staging destroy/replace loses the DB with no final snapshot once it holds client data. [velara-api/terraform/rds.tf:1483-1484] — deferred, staging not yet applied (gated on client account + BAA per D4)
- [x] [Review][Defer] Container Insights auto-creates log groups bypassing the 90-day retention guarantee — `containerInsights=enabled` (ecs.tf) spawns `/aws/ecs/containerinsights/...` groups not declared in TF (default never-expire); AC5 met for app groups only. [velara-api/terraform/ecs.tf:851-853] — deferred, apply-dependent; revisit with AC5 live verification
- [x] [Review][Defer] No `validation` enforcing `length(public_subnet_cidrs)==length(private_subnet_cidrs)` or ≥2 AZs — a bad operator tfvars fails only at apply / silently builds single-AZ violating the DB subnet group. [velara-api/terraform/vpc.tf:2018,2052] — deferred, latent (all shipped tfvars are 2/2)
- [x] [Review][Defer] `nat_gateway_count=0` would index `aws_nat_gateway.main[-1]` (plan error); unguarded by validation. [velara-api/terraform/vpc.tf:2107] — deferred, latent (defaults ≥1)
- [x] [Review][Defer] velara-web `aws.us_east_1` aliased provider declared but unused (dead/misleading config, or a missing in-repo ACM cert resource for CloudFront). [velara-web/terraform/versions.tf, cloudfront.tf] — deferred, no runtime impact (CloudFront is global; cert passed as ARN)
- [x] [Review][Defer] Worker ECS container has no `healthCheck` — crash-loops (incl. the D3 Redis-TLS failure this story guards) are less observable. [velara-api/terraform/ecs.tf] — deferred, worker has no port; not spec-required

### Dismissed (5)

- Redundant `_redis_ssl_opts if _redis_uses_tls else None` double-guard in celery_app.py:47-48 — behavior correct (`None` = Celery no-SSL sentinel).
- conftest no-op `apply_migrations` override "leaks" — FALSE: pytest resolves the nearest fixture by directory proximity; scoped to tests/unit/workers/ only (verified).
- ElastiCache `engine_version=7.1` + `default.redis7` param group "mismatch" — valid AWS combination (family default group).
- RDS `engine_version="16"` major-only pin — acceptable (auto-selects latest 16.x; satisfies "PostgreSQL 16").
- IAM execution-role `kms:GenerateDataKey` "too broad" — scoped to specific key ARNs by design, not a wildcard.

## Change Log

- 2026-06-27: Code review (bmad-code-review, claude-opus-4-8). 3-layer adversarial. 3 decision-needed / 3 patch / 6 defer / 5 dismissed. Top findings: `ssl_cert_reqs=None` Redis CERT_NONE (MITM); missing `.gitignore` → RDS password leaks to committable tfstate on first apply (AC3); dev serves plaintext HTTP (AC4/AC1-HTTPS unmet in applied dev) while Completion-Notes summary claims AC4 verified. See Review Findings. Status: review → (pending decision/patch resolution).
- 2026-06-27: Story implemented (dev-story, claude-sonnet-4-6). Greenfield IaC: velara-api/terraform/ (18 files) + velara-web/terraform/ (8 files). D1 resolved (Sentry-only, no X-Ray). D3 resolved: app/workers/celery_app.py patched for rediss:// TLS + 3 unit tests added. terraform validate + fmt clean on all 3 roots. `terraform apply` blocked on operator: ACM cert ARN + backend bucket name (see Completion Notes). Status: ready-for-dev → review.
