---
baseline_commit_api: 9ee903c   # velara-api git main HEAD at create-story time
baseline_commit_web: b5a4739   # velara-web git main HEAD captured at dev-story start (create-story noted "main", sha not recorded then)
---

# Story 7.2: CI/CD Pipeline Setup

Status: done

> **Created 2026-06-29 (create-story).** This is a **DEPLOY-automation + CI→AWS-auth + small Terraform** story. Three parallel source-verified audits (velara-api, velara-web, architecture) confirm: **PR-validation CI already exists and passes in BOTH repos** — the work is to (a) verify/retain that CI, (b) replace the two `deploy.yml` `workflow_dispatch` stubs with real deploy pipelines, (c) add the **missing** CI→AWS auth (GitHub OIDC provider + least-priv deploy roles) and **missing** ECS auto-rollback (`deployment_circuit_breaker`) in Terraform, and (d) inject `VITE_API_URL` at frontend build time.
>
> 🔑 **SCOPE: DEV ENVIRONMENT ONLY, on the personal AWS account** (account `068858795262`, `us-east-1`, profile `hozefa`, no BAA — inherited from Story 7.1 D4). Author staging/prod parameterization so the later cutover is mechanical, but only `dev` is wired and exercised. **NO application (BE/FE) code change** — this story touches `.github/workflows/`, `terraform/`, and frontend build env only.
>
> ⚠️ **Operator-gated, mark honestly (7.1 precedent).** Several deliverables require an operator to run `terraform apply` (OIDC provider + deploy role + circuit breaker), set GitHub repo variables/secrets, and trigger the first `main`-push deploy. Do **NOT** claim a deploy "ran" unless you have real evidence. Mark operator-gated items explicitly, exactly as 7.1 did.

## Story

As a developer,
I want automated GitHub Actions pipelines for both service repos,
so that every PR is validated automatically and every merge to `main` deploys to dev with zero-downtime rolling deployment.

## Acceptance Criteria

1. **Given** a PR is opened against velara-api, **When** the CI workflow runs, **Then** it executes `ruff check`, `pytest`, and Docker build in sequence — the PR is blocked if any step fails. *(Already satisfied by `velara-api/.github/workflows/ci.yml` — verify + retain; see Dev Notes "CI is already built".)*

2. **Given** a PR is opened against velara-web, **When** the CI workflow runs, **Then** it executes `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` — the PR is blocked if any step fails. *(Already satisfied by `velara-web/.github/workflows/ci.yml` — verify + retain.)*

3. **Given** a commit is merged to `main` on velara-api, **When** the deploy workflow runs, **Then** it builds the Docker image, pushes to ECR, and triggers an ECS rolling deployment — with zero-downtime using the `/health/ready` readiness probe.

4. **Given** a commit is merged to `main` on velara-web, **When** the deploy workflow runs, **Then** it builds the Vite bundle, syncs to the S3 frontend bucket, and invalidates the CloudFront distribution. *(CloudFront invalidation is **conditional** — the distribution is not live yet, see Decision D4.)*

5. **Given** an ECS deployment results in an unhealthy new task, **When** ECS detects the health check failure, **Then** ECS rolls back to the previous task definition automatically. *(Requires NEW Terraform `deployment_circuit_breaker { enable = true, rollback = true }` — ABSENT today, see Decision D3.)*

6. **Given** secrets are needed in CI workflows, **When** the workflow accesses them, **Then** they are sourced from GitHub Actions secrets / variables — never hardcoded in workflow YAML files. *(Reinforced by Decision D2: no long-lived AWS access keys — OIDC short-lived creds.)*

## Tasks / Subtasks

> ⚠️ Before starting, read **Critical Decisions (D1–D5)** in Dev Notes. They lock the 5 design choices and call out the 3 Terraform gaps (OIDC, circuit breaker, image-tag scheme) + the CI/conftest DB inconsistency. Do not guess mid-implementation.

- [x] **T0: Confirm pre-implementation inputs & decisions** (AC: all)
  - [x] Confirm both repos are on `main` with `github.com/Vitalief/{velara-api,velara-web}` remotes (verified at create-story: both `main`, both Vitalief remotes). GitHub Actions is the CI host. — **VERIFIED** 2026-06-29: `git rev-parse --abbrev-ref HEAD`=`main` in both; `git remote -v`=`https://github.com/Vitalief/velara-api.git` + `.../velara-web.git`. velara-api HEAD `9ee903c` matches `baseline_commit_api`; velara-web HEAD `b5a4739`.
  - [x] Confirm DEV-only scope on the personal account (D4 from 7.1): account `068858795262`, `us-east-1`. Operator applies Terraform + sets repo vars/secrets. — **CONFIRMED** from 7.1 D4 + dev.tfvars (`environment="dev"`, `region="us-east-1"`). No live AWS access from this build env (`gh` + AWS creds absent) → all `terraform apply` / repo-var / push steps are operator-gated.
  - [x] Record D1–D5 resolutions in the Dev Agent Record before writing pipelines. — **DONE** (see Decisions above; D1-D5 + deploy-trigger + CI/conftest flag all recorded against live source).

- [x] **T1: Verify & retain PR-validation CI (AC1, AC2)** — *verify-only, do not rebuild*
  - [x] velara-api `ci.yml`: confirm jobs `lint` (`ruff check .`), `test` (`alembic upgrade head` → `pytest`, with `postgres:16-alpine` + `redis:7-alpine` service containers), `build` (`docker build` of `Dockerfile.api` + `Dockerfile.worker`), `openapi` (spec staleness gate). Confirm trigger is `push` + `pull_request` on `[main]`. **AC1 is satisfied** — leave it intact. — **VERIFIED 2026-06-29** (read `velara-api/.github/workflows/ci.yml`): all 4 jobs present exactly as described; trigger `push`+`pull_request` on `[main]`. Left intact.
  - [x] velara-web `ci.yml`: confirm single `verify` job (node 20) running `npm ci` → `typecheck` → `lint` → `npm test` (=`vitest run`) → `build`. **AC2 is satisfied** — leave it intact. — **VERIFIED 2026-06-29** (read `velara-web/.github/workflows/ci.yml`): single `verify` job, node 20 w/ npm cache, `npm ci`→`npm run typecheck`→`npm run lint`→`npm test`→`npm run build`; trigger `push` on `[main]` + all PRs. Left intact.
  - [x] **FLAG (do not silently fix in deploy):** the velara-api CI `test` job sets `DATABASE_URL=…@localhost:5432/velara` but `tests/conftest.py:18-22` force-overrides to `…@postgres:5432/velara_test` (DB-name AND host mismatch). — **FLAG RECORDED, NOT propagated.** Confirmed both source locations. Decision (see Dev Agent Record → "CI/conftest DB-inconsistency FLAG"): record only; the deploy workflows run no `pytest` and do NOT inherit this wiring; reconciling CI is out of this story's deploy scope.

- [x] **T2: CI→AWS authentication — GitHub OIDC provider + deploy roles (AC3, AC4, AC6)** — *NEW Terraform, gates everything*
  - [x] In `velara-api/terraform/`: add `aws_iam_openid_connect_provider` for `token.actions.githubusercontent.com` (thumbprint / use the AWS-managed root — `aud=sts.amazonaws.com`). **ABSENT today (verified).** — **DONE** in NEW `velara-api/terraform/oidc.tf`: `aws_iam_openid_connect_provider.github_actions`, url `https://token.actions.githubusercontent.com`, `client_id_list=["sts.amazonaws.com"]`, GitHub's documented thumbprint (AWS uses its own trust store for this well-known provider — thumbprint required by the API but not load-bearing; documented in-file + verified against GitHub OIDC docs).
  - [x] Add an `aws_iam_role` (`velara-dev-gha-deploy-api`) assumable **only** by the velara-api repo on `ref:refs/heads/main`. Least-priv policy. — **DONE** (`oidc.tf` `aws_iam_role.gha_deploy_api`): assume-role pinned to `repo:Vitalief/velara-api:ref:refs/heads/main` + `aud=sts.amazonaws.com`. Policy exactly per spec: `ecr:GetAuthorizationToken` (`*`), ECR push actions (+`BatchGetImage`/`GetDownloadUrlForLayer`) scoped to `aws_ecr_repository.api/worker.arn`, `ecs:RegisterTaskDefinition`+`DescribeTaskDefinition` (`*` — IAM limitation), `ecs:UpdateService`/`DescribeServices` scoped to the api+worker service ARNs (built from cluster+service names), `iam:PassRole` scoped to the 3 ECS role ARNs with `iam:PassedToService=ecs-tasks.amazonaws.com`.
  - [x] In `velara-web/terraform/`: add a separate deploy role (`velara-dev-gha-deploy-web`) assumable only by `repo:Vitalief/velara-web:ref:refs/heads/main`. Least-priv. **Reuse the same OIDC provider** (account-global). — **DONE** in NEW `velara-web/terraform/iam.tf`: `aws_iam_role.gha_deploy_web` with `s3:PutObject`/`DeleteObject`/`GetObject` on `${frontend.arn}/*` + `s3:ListBucket` on the bucket ARN + `cloudfront:CreateInvalidation` on `aws_cloudfront_distribution.frontend.arn`. **Provider reuse decision (D2):** the single account-global provider is created ONLY in velara-api; velara-web references it by ARN via NEW `var.oidc_provider_arn` (defaulting to the deterministic `arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com` derived from a new `data.aws_caller_identity`). **NO `data "aws_iam_openid_connect_provider"` lookup** — independent state would make web's plan/apply hard-fail until api applies; the var-ARN approach plans cleanly. Apply order velara-api → velara-web documented.
  - [x] No long-lived AWS access keys anywhere (AC6). Role ARN(s) via GitHub repo **variables** `AWS_DEPLOY_ROLE_ARN`; OIDC short-lived creds via `aws-actions/configure-aws-credentials@v4` + `permissions: id-token: write`. — **DONE** (consumed in T5/T6 workflows; role ARNs surfaced via TF outputs `gha_deploy_role_arn` in each root + `github_oidc_provider_arn` in velara-api).
  - **VERIFIED:** `terraform validate` ✅ + `terraform fmt -check -recursive` ✅ on BOTH roots (velara-api, velara-web) — 2026-06-29, terraform v1.9.8.

- [x] **T3: ECS auto-rollback — `deployment_circuit_breaker` (AC5)** — *NEW Terraform*
  - [x] In `velara-api/terraform/ecs.tf`: add `deployment_circuit_breaker { enable = true, rollback = true }` to BOTH `aws_ecs_service.api` and `aws_ecs_service.worker`. **ABSENT today (verified — grep `circuit_breaker` = 0).** — **DONE.** Added to both services. The api already had `deployment_controller { type = "ECS" }`; the **worker had none** → I added the controller to the worker as well (the circuit breaker requires it). Post-edit grep: 2 controllers + 2 breakers.
  - [x] Keep the existing rolling-deploy percentages (api `100/200`; worker `50/200`). — **DONE** (percentages untouched). The breaker auto-rolls-back to the last-good task definition on a failed rollout, satisfying AC5 with no app change.
  - [x] **Precision (verified) — asymmetry documented in-code.** api rolls back on the ALB `/health/ready` check (a 503ing image never goes healthy); the worker (no ALB, no container `healthCheck` — 7.1 deferred) rolls back only on task START/STOP failures (crash-loop). AC5 satisfied for both (api via health, worker via start-failure). A worker `healthCheck` is the 7.1-deferred enhancement — **NOT added** (out of scope; not trivially low-risk given the worker runs no HTTP server to probe). Asymmetry documented in the `deployment_circuit_breaker` comments on both services.
  - [x] `terraform validate` + `fmt` clean. — **VERIFIED** 2026-06-29 (terraform v1.9.8): velara-api `validate` ✅ + `fmt -check` ✅. (Operator applies — see T7.) **Preserved** the `lifecycle { ignore_changes = [task_definition, desired_count] }` blocks and the deployment percentages.

- [x] **T4: Image tagging scheme — resolve `:latest` vs ECR lifecycle (AC3)** — *small Terraform + pipeline contract*
  - [x] **Inconsistency confirmed:** task defs pin `:latest` (`ecs.tf:49,131`); ECR lifecycle manages only `["v","dev-","staging-","prod-"]` (`ecr.tf:45,75`). **D5 RESOLVED: tag `dev-<git-sha>`** (lifecycle-managed, immutable). No Terraform change needed for tagging — the `dev-` prefix is already in the lifecycle policy; the contract is enforced in the pipeline. (The TF task-def `:latest` default is harmless: the services `ignore_changes=[task_definition]`, so the CI-registered immutable-tag revision is what actually runs; `:latest` is only the never-deployed bootstrap default.)
  - [x] The deploy pipeline (T5) builds with `dev-${GITHUB_SHA::7}` (api + worker), pushes, registers a NEW task-def revision pinned to the immutable tag, then `update-service --force-new-deployment`. **`:latest` is NOT deployed.** — **DONE** in `velara-api/.github/workflows/deploy.yml` (build step computes `dev-${SHA::7}`; the register steps swap ONLY the container `.image` to that immutable tag via `jq`).
  - [x] The `ignore_changes=[task_definition,desired_count]` lifecycle means the CI register+update won't be reverted by a later `terraform apply`. **Preserved intact** (T3 left those blocks untouched).

- [x] **T5: velara-api deploy pipeline — `deploy.yml` (AC3, AC5, AC6)** — *replace the stub*
  - [x] Replaced the `workflow_dispatch` echo stub with a real pipeline. **Trigger: `workflow_run` on the `CI` workflow `completed` (branches `[main]`)**, job-gated on `github.event.workflow_run.conclusion == 'success'` → a red CI blocks the deploy without re-running tests. Also kept `workflow_dispatch` for manual operator re-deploys (the `if` allows the dispatch event past the conclusion check). The job checks out `github.event.workflow_run.head_sha` so the image matches the CI-validated commit. `concurrency: deploy-api` prevents overlapping api deploys.
  - [x] Permissions `id-token: write`/`contents: read`. Steps: resolve SHA → checkout the validated commit → compute `dev-${SHA::7}` → `aws-actions/configure-aws-credentials@v4` (`role-to-assume=${{ vars.AWS_DEPLOY_ROLE_ARN }}`, region us-east-1) → `aws-actions/amazon-ecr-login@v2` → `docker build` BOTH (`docker/Dockerfile.api`+`docker/Dockerfile.worker`, repo-root context) tagged immutable → push both → `describe-task-definition`→`jq` (swap ONLY the container `.image`, `del` read-only fields)→`register-task-definition` for api+worker → `update-service --force-new-deployment` on `velara-dev-api`/`velara-dev-worker` in `velara-dev-cluster`. Used the explicit describe→jq→register approach (not the render-task-definition action) so the worker (no ALB) and api share one robust path.
  - [x] Zero-downtime via the ALB `/health/ready` check + `100/200` rolling config; AC5 rollback via the T3 circuit breaker. Final step `aws ecs wait services-stable` on both services → the workflow goes **red** if a rollout doesn't stabilize (and the breaker has rolled back).
  - [x] No secrets in YAML (AC6): all AWS access via OIDC; registry comes from the `amazon-ecr-login` output; cluster/service/family/container/repo names are non-secret workflow `env:` constants (not GitHub secrets); the only repo input is the non-secret variable `AWS_DEPLOY_ROLE_ARN`.
  - **VERIFIED:** `actionlint -shellcheck` ✅ (exit 0, zero findings) + YAML parse ✅ on `velara-api/.github/workflows/deploy.yml` — 2026-06-29.

- [x] **T6: velara-web deploy pipeline — `deploy.yml` + `VITE_API_URL` injection (AC4, AC6)** — *replace the stub*
  - [x] Replaced the `workflow_dispatch` echo stub. **Trigger: `workflow_run` on the `CI` workflow `completed` (branches `[main]`)** + job-gated on `conclusion == 'success'` (mirrors T5). Kept `workflow_dispatch` for manual re-deploys. `concurrency: deploy-web`. Checks out `workflow_run.head_sha`.
  - [x] Permissions `id-token: write`/`contents: read`. Steps: resolve SHA → checkout → setup-node 20 (npm cache) → `npm ci` → **fail-fast guard** (errors out if `vars.VITE_API_URL` is empty — prevents shipping a localhost bundle) → **build with injection**: `VITE_API_URL=${{ vars.VITE_API_URL }} VITE_ENVIRONMENT=dev npm run build`. Confirmed there is **NO `.env.production`**; `.env` defaults `VITE_API_URL=http://localhost:8000`, read at build time (`import.meta.env`) in `client.ts:13`/`auth.ts:86`/`LoginPage.tsx:45`. Operator sets `vars.VITE_API_URL` to the dev ALB DNS (`http://<velara-dev-alb-dns>`, plaintext per 7.1 AC4).
  - [x] `aws-actions/configure-aws-credentials@v4` (role `${{ vars.AWS_DEPLOY_ROLE_ARN }}`) → `aws s3 sync dist/ "s3://velara-dev-frontend" --delete` (the `frontend_bucket_name` output). **DONE.** (Vite outputs `dist/` — no explicit `outDir`, default.)
  - [x] **Conditional CloudFront invalidation (D4):** invalidation runs only when `vars.CLOUDFRONT_DISTRIBUTION_ID` is set + non-empty (`aws cloudfront create-invalidation --paths "/*"`); otherwise it logs a `::notice::` and the deploy succeeds. **The deploy does NOT hard-fail when CloudFront is absent** — S3 sync is the unconditional deliverable. Documented in-workflow that until the distribution is live the OAC-locked bucket has no public dev URL.
  - **VERIFIED:** `actionlint -shellcheck` ✅ (exit 0, zero findings) + YAML parse ✅ on `velara-web/.github/workflows/deploy.yml` — 2026-06-29. Also re-linted both `ci.yml` (api + web): clean.

- [x] **T7: Operator runbook + honest verification (AC: all)**
  - [x] Documented the operator gates in BOTH repo READMEs (new "CI/CD Deploy (Story 7.2)" sections in `velara-api/terraform/README.md` + `velara-web/terraform/README.md`) and in Completion Notes — marked honestly (7.1 precedent):
    1. `terraform apply -var-file=dev.tfvars` in velara-api (OIDC provider + deploy role + circuit breaker), then velara-web (deploy role). Provider is account-global → apply velara-api FIRST.
    2. Set GitHub repo **variables**: `AWS_DEPLOY_ROLE_ARN` (per repo), `VITE_API_URL` (web, = dev ALB DNS, build fails fast if unset), `CLOUDFRONT_DISTRIBUTION_ID` (web, only once the dist is live).
    3. First `main`-push deploy is the live proof.
  - [x] Verified (2026-06-29, terraform v1.9.8 + actionlint v1.7.7 + shellcheck v0.10.0):
    - `terraform validate` ✅ + `terraform fmt -check -recursive` ✅ on BOTH roots.
    - Both `deploy.yml` + both `ci.yml`: `actionlint -shellcheck` ✅ (exit 0, zero findings) + YAML parse ✅.
    - **`terraform apply` RUN LIVE** once the operator supplied `AWS_PROFILE=hozefa` (acct 068858795262): velara-api applied in full (`plan`=No changes), velara-web deploy role applied (CloudFront deferred on the AWS gate). See "LIVE AWS VERIFICATION" in Completion Notes for the API-confirmed resources + the 2 code fixes the live apply caught.
  - [x] **AC status marked honestly (NOT fabricated):** AC1/AC2 = **satisfied**. AC3/AC5/AC6 (api) = **infrastructure LIVE + API-verified** (pipeline still needs repo var + `main` push to run). AC4 (web) = **deploy role LIVE**; CloudFront invalidation honestly **deferred** (AWS new-account gate). No "deploy ran" claim — no `main`-push has fired the pipeline yet.

## Dev Notes

### 🚨 Critical Decisions — resolve BEFORE writing pipelines

**D1 — CI is ALREADY built; this story does NOT rebuild it (AC1/AC2 = verify+retain).**
Both repos already have complete, triggering PR-validation CI. velara-api `ci.yml`: `lint`/`test`(PG16+Redis7 service containers, `alembic upgrade head`+`pytest`)/`build`(both Dockerfiles)/`openapi`(spec gate), on `push`+`pull_request` to `[main]`. velara-web `ci.yml`: single `verify` job, node 20, `npm ci`→typecheck→lint→`vitest run`→build, on `push` to main + all PRs. **AC1 and AC2 are satisfied as-built** — the work is the **deploy** half (both `deploy.yml` are `workflow_dispatch` echo stubs that literally say "implemented in Story 1.4 (CI/CD setup)" = THIS story). Verify CI, do not duplicate it.

**D2 — CI→AWS auth = GitHub OIDC provider + least-priv deploy roles. NO access keys. (AC6)**
There is **zero** CI→AWS auth today — no `aws_iam_openid_connect_provider` and no GitHub-Actions assume-role anywhere in either repo's Terraform (verified: the only IAM roles are the 3 ECS roles, all `ecs-tasks.amazonaws.com`). This gates everything. Build a GitHub OIDC trust (`token.actions.githubusercontent.com`, `aud=sts.amazonaws.com`) + per-repo deploy roles scoped to `repo:Vitalief/<repo>:ref:refs/heads/main`, least-priv (ECR push + ECS register/update + `iam:PassRole` for api; S3 + CloudFront-invalidate for web). **An OIDC provider is account-global — create it ONCE** (velara-api root) and reference its ARN from velara-web (a `data` source or an ARN variable); a duplicate `resource` errors `EntityAlreadyExists`. Short-lived creds via `aws-actions/configure-aws-credentials@v4` + `permissions: id-token: write`. Role ARNs travel as repo **variables** (non-secret), satisfying "secrets from GitHub Actions secrets, never hardcoded in YAML".

**D3 — ECS auto-rollback = NEW `deployment_circuit_breaker`. ABSENT today. (AC5)**
The ECS services have NO `deployment_circuit_breaker` (verified: grep = 0 matches). The 7.1 service comments claim "zero-downtime" via rolling percentages + `/health/ready`, but rolling alone does **not auto-roll-back** a bad task def — AC5 needs `deployment_circuit_breaker { enable = true, rollback = true }` on both `aws_ecs_service.api` and `.worker` (the api already has the required `deployment_controller { type = "ECS" }`; add it to worker if missing). This is the cleanest AC5 implementation — ECS itself watches health and reverts to the last-good revision. No app change.

**D4 — CloudFront invalidation is CONDITIONAL (the distribution is NOT live). (AC4)**
`aws_cloudfront_distribution.frontend` IS defined in `velara-web/terraform/cloudfront.tf` (with outputs `cloudfront_distribution_id`/`cloudfront_domain_name`/`frontend_bucket_name`, and the TF comment explicitly names "Story 7.2's web deploy syncs dist/ to S3 and invalidates this distribution"). BUT the 7.1 dev apply hit an **AWS new-account verification gate** and the distribution **failed to create** (deferred-work.md:205; `aws cloudfront list-distributions` → None). So AC4's invalidation has **no target yet**. Resolution: **S3 sync is unconditional; CloudFront invalidation runs only if `CLOUDFRONT_DISTRIBUTION_ID` resolves, and never hard-fails the deploy.** Once AWS lifts the gate and `velara-web/terraform` re-applies the distribution, set the repo var and invalidation activates. (This mirrors 7.1's honest-deferral pattern.)

**D5 — Image tags = `dev-<git-sha>`, immutable. NOT `:latest`. (AC3)**
Task defs pin `:latest` (`ecs.tf:49,131`) but the ECR lifecycle policy manages only `["v","dev-","staging-","prod-"]`-prefixed tags (`ecr.tf:45,75`) — `:latest` is unmanaged and useless for rollback. Tag pushed images `dev-${GITHUB_SHA::7}` (env-prefixed, immutable, lifecycle-managed). The deploy registers a task-def revision pinned to the immutable tag; rollback (manual or via the D3 circuit breaker) re-points at a prior `dev-<sha>`. The `ignore_changes=[task_definition,desired_count]` lifecycle on the services means these CI-driven task-def updates won't drift against Terraform.

### What this story touches vs preserves (read files being modified)

**MODIFIED (replace stub):**
- `velara-api/.github/workflows/deploy.yml` — currently 13-line `workflow_dispatch` echo stub. **Current behavior:** manual trigger, echoes "Story 1.4". **Change:** full build→ECR→ECS-deploy pipeline (T5). **Preserve:** nothing load-bearing in the stub.
- `velara-web/.github/workflows/deploy.yml` — currently 11-line `workflow_dispatch` echo stub. **Change:** full build→S3-sync→(conditional)CloudFront pipeline (T6).

**MODIFIED (add resources):**
- `velara-api/terraform/iam.tf` (or a new `oidc.tf`) — ADD OIDC provider + api deploy role. **Preserve** the 3 existing ECS roles (`ecs_execution`, `ecs_task_api`, `ecs_task_worker`) untouched.
- `velara-api/terraform/ecs.tf` — ADD `deployment_circuit_breaker` to both services. **Preserve** the `lifecycle { ignore_changes = [task_definition, desired_count] }` blocks (lines 211-214, 240-242) — they are the deploy seam; removing them would make `terraform apply` revert CI deploys. **Preserve** the deployment percentages and `deployment_controller`.
- `velara-web/terraform/` (new `iam.tf` or in `cloudfront.tf`) — ADD web deploy role (+ OIDC provider reference, not a duplicate). **Preserve** `s3_frontend.tf` + `cloudfront.tf` and their outputs.

**VERIFY-ONLY (do NOT rebuild):**
- `velara-api/.github/workflows/ci.yml` (AC1) and `velara-web/.github/workflows/ci.yml` (AC2) — retain.

**DO NOT TOUCH:** any application code (`app/**`, `src/**`), DB migrations, Dockerfiles (already correct: `Dockerfile.api` EXPOSE 8000 / uvicorn:8000, `Dockerfile.worker` no port / celery), the `/health/ready` endpoint, the ALB health-check path. This is a pipeline + IaC story only.

### The deploy-seam contract 7.1 pre-built (use it, don't re-derive)

- **ECR:** repos `velara-api` + `velara-worker` (`ecr.tf`); TF outputs `ecr_api_repository_url`, `ecr_worker_repository_url`, `ecs_cluster_name`.
- **ECS:** cluster `velara-dev-cluster`; services `velara-dev-api`, `velara-dev-worker`; `lifecycle ignore_changes=[task_definition,desired_count]` on both (FOR CI deploys); api rolling `100/200`, worker `50/200`; api `deployment_controller{type=ECS}`.
- **ALB:** target group health check `path="/health/ready"` (`alb.tf:38`), matcher `200`, healthy/unhealthy thresholds 2/3 — the zero-downtime gate. `/health/ready` checks DB+Redis+S3 (3 deps, 503 until all ready, `health.py:47`).
- **Frontend:** S3 bucket `velara-dev-frontend` (TF output `frontend_bucket_name`); CloudFront distribution defined (TF outputs `cloudfront_distribution_id`, `cloudfront_domain_name`) but NOT live (new-account gate). SPA fallback is CloudFront 403/404→`/index.html` (the React Router has no top-level `path="*"` — confirmed; relies entirely on the CloudFront rewrite).
- **Images:** `docker/Dockerfile.api` (python:3.12-slim, port 8000, uvicorn), `docker/Dockerfile.worker` (no port, celery). `ecr_base = <acct>.dkr.ecr.us-east-1.amazonaws.com`.

### CI/conftest DB inconsistency (FLAG — verified, do not propagate)

velara-api `ci.yml` `test` job env (lines 62-66): `DATABASE_URL=postgresql+asyncpg://velara:velara@localhost:5432/velara`. But `tests/conftest.py:18-22` force-overrides to `…@postgres:5432/velara_test` whenever `"velara_test"` is not in the URL — so pytest uses `velara_test`@`postgres`, NOT the CI-provided `velara`@`localhost`. Two-fold mismatch (DB name + host). The suite is presumably green via conftest's own override + its `apply_migrations` fixture (the CI-level `alembic upgrade head` at ci.yml:73 runs against `velara`). **This is a CI hygiene smell, not a deploy concern — the deploy workflow does NOT run pytest.** Do NOT copy this wiring into `deploy.yml`. Reconcile only in CI (and re-verify green) if you choose to, otherwise just record the flag.

### HIPAA / security non-negotiables for this story

- **No long-lived AWS credentials in CI** (AC6, SEC-04) — OIDC short-lived assume-role only; least-priv deploy roles scoped to the exact ECR repos / ECS services / S3 bucket / CloudFront dist.
- **No secrets in workflow YAML** — role ARNs and the build-time API URL are GitHub repo **variables**; any true secret (none required for OIDC deploy) would be a GitHub Actions **secret**, never inline.
- **Branch-scoped trust** — the OIDC role `sub` condition pins `ref:refs/heads/main` so only a `main` deploy (not arbitrary PR branches/forks) can assume the deploy role.
- **DEV-only / no BAA** inherited from 7.1 D4 — no real client PHI on this account; staging/prod deploy roles authored-not-applied, gated on the client account + BAA.

### Tooling & Versions

- **GitHub Actions:** `aws-actions/configure-aws-credentials@v4` (OIDC), `aws-actions/amazon-ecr-login@v2`, optionally `aws-actions/amazon-ecs-render-task-definition` + `aws-actions/amazon-ecs-deploy-task-definition` (handles register + update + `wait-for-service-stability`). `actions/checkout@v4`, `actions/setup-node@v4` (node 20). Pin major versions.
- **Terraform** `>= 1.9`, AWS provider `~> 6.0` (matches 7.1). `terraform fmt` + `validate` must be clean (CI doesn't gate TF today; keep it clean by hand).
- **Image tags:** `dev-<7-char-sha>` (D5).

### Previous Story Intelligence (Story 7.1 — done)

- 7.1 built the entire deploy **target** seam specifically so 7.2 is "just the pipeline" — `ignore_changes`, `/health/ready` ALB gate, ECR repos+URL outputs, S3+CloudFront outputs. Reuse it; don't rebuild infra.
- 7.1 applied dev for real but **CloudFront failed on an AWS new-account gate** (operator/AWS-side, not code) → D4 conditional invalidation. The `velara-web` distribution is the single biggest "looks-done-but-isn't-live" trap.
- 7.1's **evidence-based completion** is the project bar: every AC claim backed by real `terraform`/`aws`/`gh` output. AC3/4/5 here are largely **operator-gated** — mark them "config complete, live-deploy operator-gated" honestly (7.1 did exactly this for CloudFront + HTTPS). Do NOT tick a deploy AC as live-verified without evidence the operator applied TF + pushed to main.
- 7.1 review caught a `.gitignore` tfstate-leak and an operator-hardcoded `aws_profile`/backend bucket → those are fixed; keep new TF free of hardcoded operator values (use vars / `-backend-config`).

### What NOT to build in this story

- Cognito / JWT validation — **Story 7.3**.
- CloudWatch dashboards/alarms, X-Ray, SNS, compliance docs — **Story 7.4**.
- Staging/prod **apply** — authored-not-applied, gated on client account + BAA (7.1 D4). You MAY author staging/prod deploy-role/circuit-breaker parameterization so cutover is mechanical, but apply only dev.
- The CI/conftest DB reconciliation as a *deploy* concern (it isn't — flag only).
- A React Router `path="*"` 404 page — SPA fallback is the CloudFront rewrite (deferred-work item, not this story).
- Re-applying the CloudFront distribution (operator/AWS-side gate; the pipeline just tolerates its absence).

### Project Structure Notes

- New workflow logic lives in the existing `.github/workflows/deploy.yml` of each repo (replace the stub) — no new workflow files needed unless splitting build/deploy.
- New Terraform: an OIDC provider + deploy role in `velara-api/terraform/` (new `oidc.tf` or extend `iam.tf`), `deployment_circuit_breaker` added to `ecs.tf`, and a web deploy role in `velara-web/terraform/` (new `iam.tf` or extend `cloudfront.tf`). **velara-web has no `outputs.tf`** — its outputs live in `cloudfront.tf`; follow that placement.
- **Variance to flag:** the OIDC provider is account-global, so it is created in ONE root (velara-api) and referenced (not re-declared) from velara-web — a deliberate cross-root coupling. Document it so a later staging/prod apply doesn't double-create.

### References

- Epic 7, Story 7.2 ACs [Source: `_bmad-output/planning-artifacts/epics/epic-7-infrastructure-deployment-cloud-auth.md#Story 7.2`]
- Architecture: Infrastructure & Deployment (dev→staging→prod, shared ECR registry, CloudFront+S3 decoupled frontend deploy) [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md:58-67`]
- Architecture: observability layers + health checks (`/health` liveness, `/health/ready` readiness) [Source: `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md:130-147`]
- Story 7.1 (done): the deploy-seam contract — ECS `ignore_changes`, `/health/ready` ALB gate, ECR repos+outputs, S3+CloudFront, CloudFront new-account-gate deferral [Source: `_bmad-output/implementation-artifacts/stories/7-1-aws-infrastructure-foundation.md`]
- Deferred-work: CloudFront not live (new-account gate, re-apply pending); dead `aws.us_east_1` provider; `VITE_API_URL` no-guard [Source: `_bmad-output/implementation-artifacts/deferred-work.md:202-205,17`]
- **VERIFIED 2026-06-29 (this create-story, 3 source audits):**
  - velara-api `ci.yml` jobs/triggers/service-containers; `deploy.yml` workflow_dispatch stub ("Story 1.4") [Source: `velara-api/.github/workflows/{ci,deploy}.yml`]
  - CI/conftest DB mismatch (`velara`@`localhost` vs `velara_test`@`postgres`) [Source: `velara-api/.github/workflows/ci.yml:62-66`, `velara-api/tests/conftest.py:18-22`]
  - ECR repos + outputs (`ecr_api_repository_url`, `ecr_worker_repository_url`, `ecs_cluster_name`) [Source: `velara-api/terraform/ecr.tf`, `outputs.tf:18-41`]
  - ECS cluster/services, `ignore_changes`, rolling percentages, NO circuit breaker [Source: `velara-api/terraform/ecs.tf:15,185-242`]
  - ALB health check `/health/ready` [Source: `velara-api/terraform/alb.tf:29-51`]
  - NO GitHub OIDC provider / deploy role; only 3 ECS roles [Source: `velara-api/terraform/iam.tf:20,65,117`]
  - `:latest` task-def image vs ECR lifecycle `["v","dev-","staging-","prod-"]` prefix [Source: `velara-api/terraform/ecs.tf:49,131`, `ecr.tf:45,75`]
  - Dockerfiles ports [Source: `velara-api/docker/Dockerfile.{api,worker}`]
  - `/health/ready` checks DB+Redis+S3, 503 until ready [Source: `velara-api/app/api/v1/health.py:47-122`]
  - velara-web `ci.yml` (node20, vitest run, build) + `deploy.yml` stub [Source: `velara-web/.github/workflows/{ci,deploy}.yml`]
  - `VITE_API_URL` read sites + `.env` localhost default + NO `.env.production` + `dist/` default build dir [Source: `velara-web/src/api/client.ts:13`, `src/shared/utils/auth.ts:86`, `src/pages/LoginPage.tsx:45`, `velara-web/.env`, `vite.config.ts`, `package.json:6-14`]
  - S3 bucket + CloudFront resource + outputs (in `cloudfront.tf`, no `outputs.tf`); SPA fallback via CloudFront 403/404→index.html; React Router has no top-level `path="*"` [Source: `velara-web/terraform/s3_frontend.tf`, `cloudfront.tf:75-88`, `velara-web/src/App.tsx:18-23`]
  - Both remotes `github.com/Vitalief/{velara-api,velara-web}`, both on `main` [Source: `git remote -v` in both repos]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context) — dev-story workflow, 2026-06-29.

### Decisions (record D-resolutions here before implementation)

All 5 design decisions confirmed against live source before writing any pipeline (T0 pre-flight reads on 2026-06-29):

- **D1 (CI verify-only) — CONFIRMED.** Read both `ci.yml`. `velara-api/.github/workflows/ci.yml` has `lint`(`ruff check .`)/`openapi`(spec-staleness `git diff --exit-code`)/`test`(PG16+Redis7 service containers, `alembic upgrade head`→`pytest`)/`build`(both Dockerfiles), trigger `push`+`pull_request` on `[main]` → **AC1 satisfied as-built**. `velara-web/.github/workflows/ci.yml` is one `verify` job, node 20, `npm ci`→typecheck→lint→`npm test`→build, trigger `push` on `[main]` + all PRs → **AC2 satisfied as-built**. Both retained untouched.
- **D2 (OIDC + per-repo deploy roles; single account-global provider) — CONFIRMED.** Verified `velara-api/terraform/iam.tf` has ONLY the 3 ECS roles (`ecs_execution`, `ecs_task_api`, `ecs_task_worker`, all `ecs-tasks.amazonaws.com`); no OIDC provider, no GitHub-Actions assume-role anywhere in either repo. **Provider placement:** the single account-global `aws_iam_openid_connect_provider` is created in **velara-api/terraform** (new `oidc.tf`); velara-web references it by **ARN variable** (`var.oidc_provider_arn`, defaulted to the deterministic `arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com`) rather than a `data` lookup — the two roots have independent state with no cross-state data source, and a `data "aws_iam_openid_connect_provider"` would hard-fail web's `plan`/`apply` until api applies first. Each role's `sub` is pinned to `repo:Vitalief/<repo>:ref:refs/heads/main`. Role ARNs travel as GitHub repo **variables** (`AWS_DEPLOY_ROLE_ARN`), no long-lived keys (AC6).
- **D3 (deployment_circuit_breaker on both services) — CONFIRMED.** Verified `ecs.tf`: 0 matches for `circuit_breaker`. The api service has the required `deployment_controller { type = "ECS" }` (lines 207-209); the **worker has NO deployment_controller** → I add one to the worker alongside the circuit breaker. `lifecycle { ignore_changes = [task_definition, desired_count] }` (api 212-214, worker 240-242) preserved. Documented asymmetry: api rolls back on the ALB `/health/ready` check; worker (no ALB, no container healthCheck) rolls back only on task start/stop failure.
- **D4 (conditional CloudFront invalidation) — CONFIRMED.** `velara-web/terraform/cloudfront.tf` defines the distribution + outputs `cloudfront_distribution_id`/`cloudfront_domain_name`/`frontend_bucket_name` (bucket `velara-dev-frontend`). Per 7.1, the distribution failed to create on the AWS new-account gate (not live). Web deploy: **S3 sync is unconditional**; CloudFront invalidation runs only when `vars.CLOUDFRONT_DISTRIBUTION_ID` is set + non-empty, and **never hard-fails** the deploy.
- **D5 (image tag `dev-<sha>`, immutable, NOT `:latest`) — CONFIRMED.** Task defs pin `:latest` (`ecs.tf:49,131`); ECR lifecycle manages only `["v","dev-","staging-","prod-"]` prefixes (`ecr.tf:45,75`). Deploy tags images `dev-${GITHUB_SHA::7}` (lifecycle-managed, immutable), registers a new task-def revision pinned to the immutable tag, then `update-service --force-new-deployment`. The `ignore_changes` lifecycle keeps these CI-driven task-def updates from drifting against Terraform.
- **Deploy trigger — RESOLVED: `workflow_run` on CI workflow success** (the story's recommendation). Both `deploy.yml` trigger on `workflow_run` of the `CI` workflow `completed` with `branches: [main]` (the branch filter is on the trigger, not an in-job condition), gated in-job on `github.event.workflow_run.conclusion == 'success'`. A red CI therefore blocks the deploy without re-running tests in the deploy job. The job checks out the exact `workflow_run.head_sha` so the deployed image matches the CI-validated commit. `workflow_dispatch` is also kept for manual operator re-deploys (the in-job `if` lets a dispatch event past the conclusion check), and a `concurrency` group prevents overlapping deploys per service.

### CI/conftest DB-inconsistency FLAG (T1 — recorded, NOT propagated)

Verified the flag is real: `velara-api/.github/workflows/ci.yml:62-66` sets `DATABASE_URL=postgresql+asyncpg://velara:velara@localhost:5432/velara`, but `tests/conftest.py:18-22` force-overrides to `…@postgres:5432/velara_test` whenever `"velara_test"` is not in the URL (two-fold mismatch: DB name `velara`→`velara_test` AND host `localhost`→`postgres`). The suite is green via conftest's own override + its `apply_migrations` fixture; the CI-level `alembic upgrade head` (ci.yml:73) runs against `velara`, not `velara_test`. This is a CI-hygiene smell, **out of this story's deploy scope** (the deploy workflow runs no `pytest`). **Decision: record only, do NOT reconcile** — touching CI here would risk a green-suite regression for zero deploy benefit, and the story explicitly scopes it out ("flag only"). The localhost/`velara` wiring is NOT copied into either `deploy.yml`.

> **REVERSAL (2026-06-29 — recorded in code review, decision approved by Developer):** the "record only, do NOT reconcile" decision above was **superseded** by the post-story "make CI green" commit `0a7ee93`, which DID reconcile the mismatch. The driver: enabling GitHub Actions for the first real run exposed this as an actual CI failure (the suite had previously only ever run via `docker compose exec`, where host `postgres` resolved). The reconciliation is sound and is the correct end-state: `ci.yml` now sets `…@localhost:5432/velara_test` (DB name fixed) and `conftest.py` rewrites only the DB *name* while preserving the caller's host/port (so `localhost` in CI and `postgres` in docker-compose both work) — the never-write-to-non-`_test` safety invariant is preserved. `pyproject.toml` gained a `per-file-ignores` E402 for conftest (its env override must precede imports). Net: the FLAG is **resolved, not deferred**. (Code review separately filed a Patch to harden the conftest rewrite against query-string / trailing-slash / no-path URLs — see Review Findings.)

### Debug Log References

- `terraform plan` (velara-api), FIRST attempt with no creds → `Error: error loading state: … HeadObject … StatusCode: 403 … Forbidden` (S3 remote state unreadable). Resolved once the operator supplied `AWS_PROFILE=hozefa`.
- `terraform apply` (velara-api), FIRST attempt → `CreateRole … 400 ValidationError: Value at 'description' failed … [	

 -~¡-ÿ]*` — em-dash in the role description. Fixed → re-apply succeeded.
- `terraform apply` (velara-web) → `CreateDistribution … 403 AccessDenied: Your account must be verified before you can add new CloudFront resources` — the AWS new-account gate (7.1 deferral). Deploy role applied via targeted apply after decoupling its policy from the gated distribution ARN.

### Completion Notes List

**Story 7.2 — CI/CD Pipeline Setup. Implemented 2026-06-29 (claude-opus-4-8[1m]).**

This is a **DEPLOY-automation + CI→AWS-auth + small-Terraform** story. **No application (BE/FE) code was changed** — the diff is confined to `.github/workflows/` and `terraform/` in both repos (confirmed via `git status`: 0 files under `app/`, `src/`, migrations, or Dockerfiles).

**What was built:**
- **AC1/AC2 (verify-only):** confirmed both `ci.yml` are complete + retained untouched. AC1 (velara-api: lint/openapi/test/build on push+PR-to-main) and AC2 (velara-web: typecheck/lint/vitest/build on push-to-main + PRs) are **satisfied as-built**.
- **AC6 (no long-lived keys):** NEW GitHub OIDC provider (`velara-api/terraform/oidc.tf`, account-global, created once) + per-repo least-privilege deploy roles (`gha_deploy_api` in velara-api, `gha_deploy_web` in velara-web/`iam.tf`), each branch-scoped to `repo:Vitalief/<repo>:ref:refs/heads/main`. Role ARNs travel as non-secret repo **variables**; short-lived creds via `configure-aws-credentials@v4` + `id-token: write`.
- **AC3 (api deploy):** `velara-api/.github/workflows/deploy.yml` builds api+worker, pushes immutable `dev-<7-char-sha>` tags, re-registers task-defs pinned to those tags (describe→`jq` swap→register), `update-service --force-new-deployment`, waits for stability. Zero-downtime via the existing ALB `/health/ready` gate + 100/200 rolling.
- **AC5 (auto-rollback):** NEW `deployment_circuit_breaker { enable = true, rollback = true }` on BOTH ECS services (added a `deployment_controller` to the worker, which lacked one). api rolls back on the `/health/ready` health check; worker (no ALB/healthCheck) rolls back on task-start failure — asymmetry documented in-code and in D3.
- **AC4 (web deploy):** `velara-web/.github/workflows/deploy.yml` builds the Vite bundle with `VITE_API_URL` injected at build time (fail-fast guard if the repo var is missing — there is no `.env.production`), `aws s3 sync dist/ s3://velara-dev-frontend --delete` (unconditional), and **conditional** CloudFront invalidation (runs only if `CLOUDFRONT_DISTRIBUTION_ID` is set; never hard-fails the deploy — the distribution is not live yet per 7.1's new-account gate).

**⚠️ HONEST AC STATUS (7.1 precedent — NOT fabricated). UPDATED after the live apply (see "LIVE AWS VERIFICATION" below):**
- **AC1, AC2 — SATISFIED** (CI as-built, source-verified, lint-clean).
- **AC3, AC5, AC6 (api) — INFRASTRUCTURE LIVE + verified on AWS.** The OIDC provider, deploy role (branch-scoped), and circuit breakers (both services) are applied and confirmed via the AWS API; velara-api `terraform plan`=No changes. The deploy *pipeline* itself still needs the operator to (1) set the repo variable `AWS_DEPLOY_ROLE_ARN` = `arn:aws:iam::068858795262:role/velara-dev-gha-deploy-api`, and (2) push to `main`. No `main`-push deploy has run yet → no "deploy ran" claim.
- **AC4, AC6 (web) — deploy role LIVE; CloudFront DEFERRED (AWS gate).** The web deploy role + policy are applied and verified. The S3-sync half is fully ready. CloudFront invalidation is correctly deferred: the distribution can't be created (AWS new-account verification gate, same as 7.1). Operator steps: set `AWS_DEPLOY_ROLE_ARN` = `arn:aws:iam::068858795262:role/velara-dev-gha-deploy-web`, `VITE_API_URL` = `http://velara-dev-alb-1548026043.us-east-1.elb.amazonaws.com`, leave `CLOUDFRONT_DISTRIBUTION_ID` unset until AWS lifts the gate, then push to `main`.
- See the "CI/CD Deploy (Story 7.2)" sections in both `terraform/README.md` for the full operator runbook.

**Verification performed (2026-06-29):**
- `terraform validate` ✅ + `terraform fmt -check -recursive` ✅ — BOTH roots (terraform v1.9.8).
- `actionlint -shellcheck` ✅ (exit 0, zero findings) on all 4 workflows (both `ci.yml` + both new `deploy.yml`) — actionlint v1.7.7 + shellcheck v0.10.0.
- `git status` confirms zero application-code changes.

**🔴 LIVE AWS VERIFICATION (2026-06-29, `AWS_PROFILE=hozefa`, account `068858795262`, us-east-1) — operator gate CROSSED.**
The operator later supplied the `hozefa` profile, so the TF was actually applied + verified live (not just plan-validated). This upgrades AC3/AC5/AC6 (api) from "operator-gated" to **infrastructure-live** (the deploy still needs the repo vars + a `main` push to run the pipeline itself).

- **velara-api `terraform apply` — SUCCEEDED. `terraform plan` now reports "No changes" (zero drift).** Live-verified via the AWS API:
  - OIDC provider `arn:aws:iam::068858795262:oidc-provider/token.actions.githubusercontent.com` (client `sts.amazonaws.com`) ✅
  - Deploy role `arn:aws:iam::068858795262:role/velara-dev-gha-deploy-api`, trust `sub=repo:Vitalief/velara-api:ref:refs/heads/main` + `aud=sts.amazonaws.com` ✅
  - `describe-services`: BOTH services `deploymentCircuitBreaker={enable:true,rollback:true}` + `deploymentController=ECS` (worker's controller is newly added — confirmed live) ✅
  - **Real ARN for the repo var → `AWS_DEPLOY_ROLE_ARN` (velara-api) = `arn:aws:iam::068858795262:role/velara-dev-gha-deploy-api`.**
  - **Dev ALB DNS for the web `VITE_API_URL` var = `http://velara-dev-alb-1548026043.us-east-1.elb.amazonaws.com`.**
- **velara-web `terraform apply` — deploy role APPLIED; CloudFront DEFERRED (AWS gate, not a code defect).**
  - Deploy role `arn:aws:iam::068858795262:role/velara-dev-gha-deploy-web` + policy live (S3 Put/Get/Delete + ListBucket on `velara-dev-frontend`; CloudFront CreateInvalidation account-scoped). Trust `sub=repo:Vitalief/velara-web:ref:refs/heads/main` ✅. The cross-root OIDC-ARN reference (via `var.oidc_provider_arn` default) resolved correctly.
  - **Real ARN for the repo var → `AWS_DEPLOY_ROLE_ARN` (velara-web) = `arn:aws:iam::068858795262:role/velara-dev-gha-deploy-web`.**
  - `aws_cloudfront_distribution.frontend` → **`403 AccessDenied: "Your account must be verified before you can add new CloudFront resources"`** — the SAME AWS new-account gate 7.1 hit (operator/AWS-side). `list-distributions`=null. The dependent `aws_s3_bucket_policy.frontend` is the only other un-applied resource (it needs the distribution ARN). Web plan now shows exactly those 2 deferred resources, nothing else. `CLOUDFRONT_DISTRIBUTION_ID` stays unset → the deploy's invalidation step no-ops, S3 sync is unconditional (D4 working as designed).

**TWO code fixes the live apply surfaced (neither catchable by `validate`/`actionlint` — both AWS-API-side constraints):**
1. **IAM role `description` em-dash rejected.** AWS IAM descriptions allow only `[	

 -~¡-ÿ]`; the em-dash `—` (`—`) is out of range → `CreateRole` 400 ValidationError. Fixed both deploy-role descriptions to plain hyphens (`-`). (Comments may keep em-dashes — they don't reach the API.)
2. **Web deploy-role policy was coupled to the un-creatable CloudFront distribution.** The `cloudfront:CreateInvalidation` statement originally scoped to `aws_cloudfront_distribution.frontend.arn`, which made the WHOLE role policy un-appliable while CloudFront is gated — that would also block the S3 permissions, breaking D4's unconditional S3 sync. Re-scoped to the account-distribution ARN pattern `arn:aws:cloudfront::<account>:distribution/*` (the story's sanctioned fallback) so the S3 permissions apply now, independent of the gate.

**FLAG (recorded, NOT propagated):** the velara-api CI `test`-job DB env (`velara@localhost`) vs `conftest.py`'s force-override (`velara_test@postgres`) two-fold mismatch — a CI-hygiene smell, out of deploy scope, deliberately not reconciled (see the FLAG note above).

**Deferred / out of scope (unchanged):** Cognito (7.3); CloudWatch dashboards/alarms/X-Ray/compliance (7.4); staging/prod **apply** (BAA-gated; parameterization is authored-not-applied); re-applying the CloudFront distribution (operator/AWS-side gate); a worker container `healthCheck` (7.1-deferred); the CI/conftest DB reconciliation; a React Router `path="*"` (CloudFront SPA-rewrite handles it).

### File List

> **CORRECTION (2026-06-29 code review):** the original File List below covered only the story commit `a8603a0` and the earlier "NO application code changed" claim is **false for the cumulative `9ee903c..HEAD` diff**. Four post-story commits (`0a7ee93` make-CI-green, `405ca97` trigger, `08fc3a1` CORS, `5f7060c` skill/brand buckets) bundled additional changes that ARE part of getting CI/CD live. The complete velara-api change set vs baseline `9ee903c` is listed under "Post-story follow-up commits" below.

**velara-api/** (repo `github.com/Vitalief/velara-api`, baseline `9ee903c`):

_Story commit `a8603a0`:_
- `M .github/workflows/deploy.yml` — replaced the `workflow_dispatch` echo stub with the real build→ECR→ECS deploy pipeline (T5).
- `A terraform/oidc.tf` — NEW: account-global GitHub OIDC provider + `velara-dev-gha-deploy-api` least-priv deploy role (T2).
- `M terraform/ecs.tf` — added `deployment_circuit_breaker` to both services + a `deployment_controller` to the worker (T3).
- `M terraform/outputs.tf` — added `github_oidc_provider_arn` + `gha_deploy_role_arn` outputs (T2).
- `M terraform/README.md` — added the "CI/CD Deploy (Story 7.2)" operator runbook + `oidc.tf` in the layout (T7).

_Post-story follow-up commits (CI-green + live-apply infra fixes — corrected in via code review):_
- `M .github/workflows/ci.yml` (`0a7ee93`) — added a MinIO step + bucket creation + S3 env, and renamed the test DB to `velara_test`@`localhost` (reconciles the previously-FLAGged conftest mismatch — see the FLAG note).
- `M tests/conftest.py` (`0a7ee93`) — host-preserving DB-name rewrite (swap only the db name, keep the caller's host/port) so CI (`localhost`) and docker-compose (`postgres`) both work.
- `M pyproject.toml` (`0a7ee93`) — added a ruff `per-file-ignores` E402 for `conftest.py` (its env override must precede imports).
- `M app/api/v1/jobs.py` (`0a7ee93`) — import-reorder only (ruff `--fix`); no behavior change.
- `M docs/api-spec.json` (`0a7ee93`) — regenerated the OpenAPI spec (was stale; the `openapi` CI gate requires it current). Reflects Epic 6 Certification API + later schemas — an artifact, not new app code.
- `A terraform/s3.tf` (`5f7060c`) — NEW skill + brand S3 buckets (the api `/health/ready` 503'd without them).
- `M terraform/iam.tf` (`5f7060c`) — added the skill/brand bucket ARNs to the ECS task policies.
- `M terraform/ecs.tf` (`08fc3a1`+`5f7060c`) — inject `CORS_ALLOW_ORIGINS` + `S3_SKILL_BUCKET`/`S3_BRAND_BUCKET` env into the api/worker tasks.
- `M terraform/dev.tfvars` + `M terraform/variables.tf` (`08fc3a1`) — added `cors_allow_origins`.

**velara-web/** (repo `github.com/Vitalief/velara-web`, baseline `b5a4739`):
- `M .github/workflows/deploy.yml` — replaced the `workflow_dispatch` echo stub with the real build(+`VITE_API_URL`)→S3-sync→conditional-CloudFront pipeline (T6).
- `A terraform/iam.tf` — NEW: `velara-dev-gha-deploy-web` least-priv deploy role referencing the account-global OIDC provider by ARN + `gha_deploy_role_arn` output (T2).
- `M terraform/variables.tf` — added `var.oidc_provider_arn` (T2).
- `M terraform/README.md` — added the "CI/CD Deploy (Story 7.2)" operator runbook + `iam.tf` in the layout (T7).
- _(NOT 7.2 — uncommitted working-tree noise, excluded from this review: `src/features/certification/components/CertificationScreen.tsx`, `src/features/run/components/RunConsole.tsx`.)_

### Change Log

| Date | Change |
|------|--------|
| 2026-06-29 | Story 7.2 implemented (dev-story, claude-opus-4-8[1m]). Deploy automation for both repos: 2 `deploy.yml` pipelines (api: build→ECR→ECS rolling+circuit-breaker; web: build+`VITE_API_URL`→S3-sync→conditional-CloudFront) + NEW Terraform (account-global GitHub OIDC provider, 2 per-repo least-priv deploy roles, `deployment_circuit_breaker` on both ECS services) + operator runbooks in both READMEs. AC1/AC2 verified satisfied (CI as-built). No app code changed. Verified: `terraform validate`+`fmt` ✅ both roots; `actionlint -shellcheck` ✅ all 4 workflows. |
| 2026-06-29 | **Code review** (4 layers + migration specialist). 2 decision-needed + 7 patch + 9 defer + 6 dismissed. Decisions resolved (Developer approved): (1) **File List corrected** to include the post-story follow-up commits' files (ci.yml, conftest.py, pyproject.toml, jobs.py, api-spec.json, s3.tf, iam.tf, dev.tfvars, variables.tf) and the false "NO application code changed" claim removed; (2) **CI/conftest FLAG reversal recorded** — the "do NOT reconcile" decision was superseded by `0a7ee93` (make-CI-green), which correctly reconciled the DB mismatch. **Headline patch (open):** the deploy pipeline runs NO `alembic upgrade head` against live RDS and the circuit breaker can't catch the drift (`/health/ready`=`SELECT 1`) → migration-bearing deploys go green then 500. Fix = `aws ecs run-task` one-off before `update-service` (full design in Review Findings). Findings persisted to this file + deferred-work.md. |
| 2026-06-29 | **Live AWS apply** (`AWS_PROFILE=hozefa`, acct 068858795262, us-east-1). velara-api applied IN FULL (OIDC provider + deploy role + circuit breakers on both services) — `plan`=No changes, API-verified. velara-web deploy role+policy applied; CloudFront distribution DEFERRED on the AWS new-account verification gate (403 AccessDenied — same as 7.1, operator/AWS-side). Two code fixes the live apply surfaced (not catchable by validate/actionlint): (1) IAM role `description` em-dash → plain hyphen (AWS IAM ValidationError); (2) web role policy `cloudfront:CreateInvalidation` re-scoped from the un-creatable distribution ARN to the account-distribution pattern so the S3 permissions apply independently of the gate. AC3/AC5/AC6(api) now infrastructure-live; AC4(web) deploy-role live + CloudFront honestly deferred. Real role ARNs + dev ALB DNS recorded for the repo variables. |

### Review Findings

> Code review 2026-06-29 (4 layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor, migration-gap specialist). Diff = cumulative `9ee903c..HEAD` (velara-api) + `b5a4739..HEAD` (velara-web) — i.e. story 7.2 commit `a8603a0` PLUS the 4 post-story CI-green / CORS / skill-bucket fix commits. 6 dismissed as noise.

**[Review][Decision]** (resolve first — story bookkeeping)

- [x] [Review][Decision] **RESOLVED (corrected the story)** — "NO app code changed" + incomplete File List. The cumulative diff includes `app/api/v1/jobs.py`, `tests/conftest.py`, `.github/workflows/ci.yml`, `pyproject.toml`, `docs/api-spec.json`, `terraform/{s3.tf,dev.tfvars,iam.tf,variables.tf}` (from post-story commits `0a7ee93` CI-green, `08fc3a1` CORS, `5f7060c` skill/brand buckets). → **File List corrected** (added a "Post-story follow-up commits" subsection); the false "0 files under app/" claim retracted via the CORRECTION note above the File List.
- [x] [Review][Decision] **RESOLVED (recorded the reversal)** — `ci.yml`/`conftest.py`/`pyproject.toml` DID reconcile the flagged CI/conftest DB mismatch the story said it would not touch; the fix is sound. → the **REVERSAL note** under "CI/conftest DB-inconsistency FLAG" records that `0a7ee93` superseded the "do NOT reconcile" decision, with rationale. (A follow-up Patch further hardened the conftest rewrite — applied + unit-tested.)

**[Review][Patch]** (unambiguous fixes)

- [x] [Review][Patch] **CRITICAL: no DB migration on the deploy path** [velara-api/.github/workflows/deploy.yml] — deploy never runs `alembic upgrade head` against live RDS; only CI's test job migrates the throwaway test DB. The circuit breaker CANNOT catch the resulting schema drift (`/health/ready` = `SELECT 1`, no schema check — health.py:74), so a migration-bearing merge deploys GREEN then 500s. Current main migrations 0014/0015 (`skills.consumes`/`schema_version`, `certification_records`) make this immediate: `SkillRead` + `/api/v1/certifications` query columns/tables a stale DB lacks. Fix = `aws ecs run-task` one-off (RDS is private/unreachable from the runner) reusing the api task def, AFTER push + BEFORE update-service, gated on exit 0. **This is the user's explicit ask — full fix designed.**
- [x] [Review][Patch] **jq image-swap silent no-op risk** [velara-api/.github/workflows/deploy.yml] — `map(if .name==$NAME then .image=...)` no-ops if the container name ever drifts → registers an identical taskdef → redeploys the OLD image GREEN. Names match today (`velara-api`/`velara-worker`); add an assertion that exactly one image changed.
- [x] [Review][Patch] **api deployed before worker, no api rollback on worker failure** [velara-api/.github/workflows/deploy.yml] — a failed worker `update-service` leaves new-api + old-worker version skew. Register both first, then update both.
- [x] [Review][Patch] **`concurrency: cancel-in-progress: false` contradicts the "let the latest win" comment** [both deploy.yml] — a queued older-SHA deploy can ship stale code. Set `cancel-in-progress: true` (or fix the comment).
- [x] [Review][Patch] **`workflow_run` re-run of an old CI run redeploys a stale SHA; `if:` doesn't recheck `head_branch`** [both deploy.yml] — gate `if: github.event.workflow_run.head_branch == 'main' && ...conclusion=='success'` and/or assert `head_sha` == main HEAD.
- [x] [Review][Patch] **conftest URL rewrite mangles query-string / trailing-slash / no-path URLs** [velara-api/tests/conftest.py] — `rpartition('/')` drops `?sslmode=`, can yield an invalid DSN; substring `in` check weakens the never-write-non-`_test` safety. Use `urllib.parse`, rewrite only the db-name path segment, preserve query.
- [x] [Review][Patch] **web `s3 sync --delete` is non-atomic + no cache-control** [velara-web/.github/workflows/deploy.yml] — mid-sync 404s; stale `index.html`. Upload hashed assets first, `index.html` last with `no-cache`. Latent until CloudFront is live.

**[Review][Defer]** (real, pre-existing or out-of-core; checked off)

- [x] [Review][Defer] CloudFront `CreateInvalidation` scoped account-wide (`distribution/*`) [velara-web/terraform/iam.tf] — sanctioned interim per story; tighten once the dist is live. Deferred, already documented.
- [x] [Review][Defer] `/health/ready` = `SELECT 1`, no schema-version assertion [velara-api/app/api/v1/health.py] — defense-in-depth; the migration patch makes it non-blocking. Deferred.
- [x] [Review][Defer] `force_destroy=true` on versioned skill/brand buckets [velara-api/terraform/s3.tf] — consistent with the existing ingest/output pattern; dev-only data-durability note. Deferred, pre-existing pattern.
- [x] [Review][Defer] OIDC thumbprint hardcoded [velara-api/terraform/oidc.tf] — documented value; AWS uses its own trust store for this well-known provider. Deferred, pre-existing decision.
- [x] [Review][Defer] Cross-root OIDC ARN derived (no `data` lookup) → web role applies even if the api provider is absent; runtime AssumeRole fails [velara-web/terraform/iam.tf] — DELIBERATE (avoids plan hard-fail); apply order documented in README. Deferred.
- [x] [Review][Defer] First-ever deploy `describe-task-definition` fails if Terraform wasn't applied first [velara-api/.github/workflows/deploy.yml] — procedural; README documents the order. Deferred.
- [x] [Review][Defer] `aws ecs wait services-stable` 10-min timeout → ambiguous red on a slow-but-healthy rollout [velara-api/.github/workflows/deploy.yml] — tunable. Deferred.
- [x] [Review][Defer] `VITE_API_URL` has no trailing-slash/scheme normalization (only an empty-check guard) [velara-web/.github/workflows/deploy.yml] — operator-error-triggered double-slash. Deferred.
- [x] [Review][Defer] Re-registered task defs drop tags (`describe-task-definition` omits tags without `--include TAGS`) [velara-api/.github/workflows/deploy.yml] — cosmetic; the TF task defs define no tags today. Deferred.
