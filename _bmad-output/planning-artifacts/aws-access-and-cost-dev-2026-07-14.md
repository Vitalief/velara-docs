# Velara — AWS Access Requirements & Dev-Environment Cost Estimate

**Date:** 2026-07-14
**Scope:** The **dev** environment exactly as currently defined in Terraform — `velara-api/terraform/` (applied with `dev.tfvars`) and `velara-web/terraform/`.
**Region:** `us-east-1`
**Purpose:** Hand to the client's AWS administrator so they can grant the access we need, and so they know the monthly run-rate before we apply.

---

## 1. Executive summary

| | |
|---|---|
| **Fixed monthly cost (dev)** | **~$124 – $150 / month** |
| **Realistic all-in with logs & data transfer** | **~$135 – $165 / month** |
| **Biggest single line item** | NAT Gateway — **$32.85/mo idle**, before a single byte moves |
| **Access model requested** | One IAM role (`AdministratorAccess`-equivalent, or the scoped policy in §4) for Terraform apply, plus a GitHub OIDC role for CI |
| **Nothing is click-ops** | 100% of the infrastructure is Terraform-managed across the two repos |

> ⚠️ **Three assumptions that would have been wrong from a 2024-era estimate.** All prices below were verified against the AWS Price List API on 2026-07-14, not quoted from memory. See §5 for the three items that materially changed: **public IPv4 is now billed**, **Cognito's free tier dropped 50k → 10k MAU**, and **the 12-month Free Tier no longer exists for accounts created after 2025-07-15** — which almost certainly includes this new client account.

---

## 2. Every AWS service we need — and what we create in each

This is the complete list. It is derived directly from the Terraform, not from recollection.

### 2.1 `velara-api/terraform/` — backend infrastructure

| Service | Resources we create | Why |
|---|---|---|
| **VPC** | 1 VPC, 2 private + 2 public subnets, 1 Internet Gateway, **1 NAT Gateway** + 1 Elastic IP, 2 route tables, 4 security groups | Network isolation. Dev uses a **single** NAT (saves ~$33/mo vs. the 2-AZ default) |
| **RDS** | 1 PostgreSQL 16 instance (`db.t3.micro`, Single-AZ, 20 GB gp3, autoscaling to 100 GB), 1 subnet group | Primary datastore. Encrypted at rest with a customer-managed KMS key |
| **ElastiCache** | 1 Redis 7.1 replication group (`cache.t3.micro`, 1 node), 1 subnet group | Celery broker + result backend. TLS-in-transit enforced (`rediss://`) |
| **ECS** | 1 Fargate cluster (Container Insights **enabled**), 2 task definitions (api, worker), 2 services | Runs the API and the async worker |
| **ECR** | 2 repositories (`velara-api`, `velara-worker`) + lifecycle policies | Container images |
| **ELB** | 1 public Application Load Balancer, 1 target group, 2 listeners (HTTP/HTTPS) | Fronts the API |
| **S3** | **4 buckets**: `ingest`, `output`, `skill`, `brand` — all versioned, KMS-encrypted, public access blocked | Document ingest, generated outputs, skill bundles, brand assets |
| **Secrets Manager** | **5 secrets**: DB URL, app secret key, Sentry DSN, Anthropic API key, Redis URL | Runtime credentials |
| **KMS** | **4 customer-managed keys** (RDS, S3, Secrets, Redis) + 4 aliases | Encryption at rest (HIPAA/NFR-07) |
| **CloudWatch** | 2 log groups (90-day retention), **3 alarms**, 1 dashboard, 1 metric filter, 1 SNS topic | Observability + alerting |
| **Cognito** | 1 user pool, 1 app client, 1 domain, 1 identity provider | Authentication |
| **IAM** | 4 roles + 4 inline policies, 1 OIDC provider (GitHub Actions) | Task execution + CI deploy |

### 2.2 `velara-web/terraform/` — frontend infrastructure

| Service | Resources we create | Why |
|---|---|---|
| **S3** | 1 bucket (`frontend`) — versioned, encrypted, **public access fully blocked** | Hosts the built SPA |
| **CloudFront** | 1 distribution (`PriceClass_100`) + 1 Origin Access Control | Serves the SPA. OAC-only — the bucket is not publicly reachable |
| **IAM** | 1 role + 1 policy | CI deploy (S3 sync + CloudFront invalidation) |

### 2.3 Terraform state backend (`velara-api/terraform/bootstrap/`)

| Service | Resources | Why |
|---|---|---|
| **S3** | 1 versioned, encrypted state bucket | Terraform remote state |
| **DynamoDB** | 1 table | State locking |

> This bootstrap is a **one-time** apply that must run **first** on the client account, before any other Terraform.

---

## 3. Monthly cost breakdown — dev environment

Verified against the **AWS Price List API**, `us-east-1`, 730 hrs/month, on-demand.

### 3.1 Fixed costs (billed whether or not anyone uses the system)

| Service | Configuration | Unit price | **Monthly** |
|---|---|---:|---:|
| **NAT Gateway** | 1 gateway | $0.045/hr | **$32.85** |
| **ECS Fargate — worker** | 0.5 vCPU, 2 GB, 1 task | $0.04048/vCPU-hr + $0.004445/GB-hr | **$21.26** |
| **ALB** | 1 ALB + ~1 LCU | $0.0225/hr + $0.008/LCU-hr | **$22.27** |
| **RDS PostgreSQL** | `db.t3.micro`, Single-AZ | $0.018/hr | **$13.14** |
| **ElastiCache Redis** | `cache.t3.micro`, 1 node | $0.017/hr | **$12.41** |
| **ECS Fargate — api** | 0.25 vCPU, 0.5 GB, 1 task | $0.04048/vCPU-hr + $0.004445/GB-hr | **$9.01** |
| **KMS** | 4 customer-managed keys | $1.00/key/mo | **$4.00** |
| **Public IPv4** | 1 address (the NAT Gateway's EIP) | $0.005/hr | **$3.65** ⚠️ |
| **RDS storage** | 20 GB gp3 | $0.115/GB-mo | **$2.30** |
| **Secrets Manager** | 5 secrets | $0.40/secret/mo | **$2.00** |
| **CloudWatch alarms** | 3 standard alarms | $0.10/alarm/mo | **$0.30** |
| | | **Fixed subtotal** | **≈ $123.19** |

### 3.2 Variable costs (depend on usage — dev is light)

| Service | Driver | Unit price | **Est. monthly (dev)** |
|---|---|---:|---:|
| **ECS Container Insights** | Per-metric, scales with cluster/task/container count | $0.07/metric/mo | **$10 – $25** ⚠️ |
| **CloudWatch Logs** | Ingest + 90-day storage | $0.50/GB in · $0.03/GB-mo | **$2 – $8** |
| **NAT data processing** | Every GB out of the private subnets | $0.045/GB | **$1 – $5** |
| **S3** | 5 buckets, light dev usage | $0.023/GB-mo + requests | **$1 – $3** |
| **ECR** | 2 repos of container images | $0.10/GB-mo | **$1 – $3** |
| **DynamoDB** | State-lock table, near-zero traffic | on-demand | **~$0.01** |
| **CloudFront** | Under the perpetual 1 TB / 10M-request free tier | — | **$0.00** |
| **Cognito** | Well under 10,000 MAU | — | **$0.00** |
| **ACM** | Public certs are free | — | **$0.00** |
| | | **Variable subtotal** | **≈ $15 – $45** |

### 3.3 Total

| | |
|---|---:|
| Fixed | ~$123 |
| Variable (typical dev) | ~$15 – $45 |
| **Expected monthly total** | **≈ $140 (range $135 – $165)** |

**Do not assume the AWS Free Tier will reduce this.** See §5.3.

---

## 4. Access we need on the client account

We need **two** IAM principals. The simplest path is to grant the first one broadly and let Terraform manage everything else.

### 4.1 Terraform apply role (a human/operator role)

This role creates and manages every resource in §2. It needs **create, read, update, delete, and tag** on:

`ec2` (VPC, subnets, NAT, EIP, IGW, route tables, security groups) · `rds` · `elasticache` · `ecs` · `ecr` · `elasticloadbalancing` · `s3` · `secretsmanager` · `kms` · `logs` · `cloudwatch` · `sns` · `cognito-idp` · `cloudfront` · `dynamodb` · `iam` (create roles/policies + `iam:PassRole`) · `sts`

> **Recommendation: grant `AdministratorAccess` for the dev account.** Terraform needs to create IAM roles and KMS keys, which is already effectively administrative — a hand-scoped policy that permits those is not meaningfully safer, and it will cost us days of `AccessDenied` iteration. If the client's policy forbids this, we can work to a scoped policy, but expect a slower first apply.
>
> `iam:CreateRole` + `iam:PassRole` is the non-negotiable core. Without it, **nothing** can be provisioned.

### 4.2 GitHub Actions OIDC deploy role (CI — no long-lived keys)

Already defined in `oidc.tf`. It federates GitHub Actions into AWS via OIDC (**no static access keys are ever stored**). Its permissions are already tightly scoped to exactly these actions:

```
ecr:GetAuthorizationToken, BatchCheckLayerAvailability, BatchGetImage,
    GetDownloadUrlForLayer, InitiateLayerUpload, UploadLayerPart,
    CompleteLayerUpload, PutImage
ecs:DescribeServices, DescribeTaskDefinition, DescribeTasks,
    RegisterTaskDefinition, RunTask, UpdateService
s3:GetObject, GetObjectVersion, PutObject, DeleteObject, ListBucket
secretsmanager:GetSecretValue
kms:Decrypt, GenerateDataKey
cloudwatch:PutMetricData
iam:PassRole   (scoped to the ECS task roles only)
sts:AssumeRoleWithWebIdentity
```

To create this role, the client must allow us to register a **GitHub OIDC identity provider** in IAM (`iam:CreateOpenIDConnectProvider`).

### 4.3 Account-level prerequisites (the client admin must confirm)

1. **Service quotas** — a brand-new account has low defaults. Confirm we can run: 1 VPC, 1 NAT Gateway, 1 RDS instance, 1 ElastiCache node, ~2–4 Fargate tasks, 1 ALB, 1 CloudFront distribution. All well within standard defaults, but new accounts occasionally ship with a **0** Fargate vCPU quota until first use.
2. **Region** — `us-east-1` must not be blocked by an SCP.
3. **No SCP** denying `iam:*`, `kms:*`, or `cloudfront:*`.
4. **Billing alerts** — we recommend the client sets a budget alarm at **$200/mo** for dev, so an unexpected spike is caught early.
5. **BAA** — ⚠️ the dev environment currently holds **no real client PHI** by design (`dev.tfvars` is explicit about this, and backups are disabled accordingly). **If the client intends to put real PHI in dev, we must first sign a BAA with AWS and turn `db_backup_retention_days` back on.** Please confirm the intent here.

---

## 5. Three things that break a naïve estimate

### 5.1 ⚠️ Public IPv4 addresses are now billed

Since Feb 2024, AWS charges **$0.005/hr for every public IPv4 address**, in use or idle. Our NAT Gateway's Elastic IP is one → **+$3.65/mo**. This line item did not exist in older estimates and is routinely missed.

*Note:* the ALB also consumes public IPs. It is billed within the ALB's hourly rate rather than separately, so it is not double-counted above — but if we ever move Fargate tasks to public subnets, each one adds its own $3.65/mo.

### 5.2 ⚠️ Cognito's free tier shrank 5×

Pools created **after 2024-11-22** default to the **Essentials** tier with a **10,000 MAU** free allowance — down from 50,000. We are far below 10k, so **the cost is still $0**, but the headroom is much smaller than the old figure suggests.

### 5.3 ⚠️ There is very likely **no** 12-month Free Tier on this account

AWS **abolished** the 12-month Free Tier for accounts created **on or after 2025-07-15**. A newly-created client account gets **$100 in credits (up to $200)** that **expire after 6 months**, instead.

**Practical consequence:** the old "RDS `db.t3.micro` is free for 750 hrs/month" assumption is **dead**. Our `dev.tfvars` even carries a comment saying `db.t3.micro` was chosen *because* it is "the only Free Tier eligible PostgreSQL instance class" — that rationale **no longer holds on a new account**, though `db.t3.micro` remains a perfectly sensible cheap choice on its own merits.

**Plan for the full ~$140/mo from month one.** The signup credits merely defer the first ~1.5 months.

*Still genuinely free, under any regime:* CloudFront's 1 TB/10M requests, Cognito's 10k MAU, 3 CloudWatch dashboards, KMS's first 20k requests, and ACM public certificates.

---

## 6. How to cut the bill, if the client wants it lower

| Action | Saving | Trade-off |
|---|---:|---|
| **Add S3 + ECR Gateway VPC endpoints** | ~$1–5/mo, and grows | **None — do this regardless.** Gateway endpoints are free and stop S3/ECR traffic being billed as NAT data processing. |
| **Replace the NAT Gateway with a NAT instance** | ~$30/mo | A `t4g.nano` NAT instance is ~$3/mo vs. $32.85. Adds a box to maintain — reasonable for dev, not for prod. |
| **Turn off ECS Container Insights** | $10–25/mo | Lose per-task CloudWatch metrics. This is the **least predictable** line item; if dev observability is not load-bearing, it is the easiest win. |
| **Shut dev down outside working hours** | up to ~50% of Fargate + RDS + Redis (~$28/mo) | Requires a scheduled scale-to-zero. Sensible if dev is only used on weekdays. |
| **Drop CloudWatch log retention 90 → 30 days** | $1–5/mo | Less log history. Dev only — do **not** do this in prod (HIPAA). |
| **Combined realistic floor** | **~$75–85/mo** | With NAT instance + Insights off + VPC endpoints. |

---

## 7. What we need from the client, concretely

1. ✅ An IAM role we can assume, with the access in **§4.1** (`AdministratorAccess` on the dev account strongly preferred).
2. ✅ Permission to create a **GitHub OIDC identity provider** (§4.2).
3. ✅ Confirmation that `us-east-1` is permitted and no SCP blocks `iam:*` / `kms:*` / `cloudfront:*`.
4. ✅ A decision on **§4.3.5** — will real PHI ever land in dev? (If yes: BAA first, backups on.)
5. ✅ Acknowledgement of the **~$140/month** dev run-rate, and a budget alarm at ~$200.

Once we have (1) and (2), the provisioning order is: **bootstrap** (state bucket + lock table) → **`velara-api/terraform`** → **`velara-web/terraform`**.

---

### Appendix — pricing sources

All unit prices verified 2026-07-14 against the **AWS Price List Bulk API** (the same data behind the AWS console and pricing calculator), supplemented by the official pricing pages for Cognito, CloudFront plans, and Free Tier policy. Notable correction applied during verification: the Fargate **memory** rate is **$0.004445/GB-hr** — widely mis-cited as ~$0.0444 (10× high), which would have inflated the worker task from $21/mo to ~$79/mo.
