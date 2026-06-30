# Epic 7: Infrastructure, Deployment & Cloud Auth

The platform is provisioned onto HIPAA-eligible AWS infrastructure via Terraform across dev/staging/prod, deployed automatically through GitHub Actions CI/CD, secured with AWS Cognito authentication, and observable through CloudWatch + X-Ray. This epic **lands the cloud foundation just before the platform must be hosted for client-facing use** — satisfying the HIPAA gate "BAA in place and infra provisioned before any PHI-adjacent skill is hosted" (FR-SEC-01/07).

> **Origin (2026-06-05):** These four stories were originally Epic 1 stories 1.3–1.6. They were relocated here so that the client's AWS-account / GitHub-repo provisioning timeline no longer blocks feature development. The provider abstractions and dev-auth shim built in Epic 1 (Stories 1.3/1.4) make the cutover below a configuration change. **Prerequisite: client has provisioned the AWS account and the Vitalief-owned GitHub repositories.** See `sprint-change-proposal-2026-06-05.md`.

## Story 7.1: AWS Infrastructure Foundation

As a platform operator,
I want the core AWS infrastructure provisioned via Terraform across dev/staging/prod,
So that the platform runs on HIPAA-eligible infrastructure with encryption and network isolation enforced by configuration.

**Acceptance Criteria:**

**Given** Terraform is initialized with remote state backend
**When** I run `terraform apply` for the dev environment
**Then** the following are created: VPC with private subnets (RDS, ElastiCache, ECS tasks) and public subnet (ALB only); RDS PostgreSQL with AES-256 encryption at rest; ElastiCache Redis with encryption in transit; S3 buckets (ingest, output, frontend) with AES-256 encryption; ECR repositories for `velara-api` and `velara-worker`; ECS cluster with three Fargate service definitions (`velara-api`, `velara-worker`, `velara-web`); ALB with HTTPS listener enforcing TLS 1.2 minimum

**Given** the infrastructure is provisioned
**When** I attempt to connect to RDS or ElastiCache from outside the VPC
**Then** the connection is refused — both are in private subnets with no public endpoint

**Given** any secret (DB password, Sentry DSN, API key) is needed by an ECS task
**When** the task definition is applied
**Then** secrets are injected from AWS Secrets Manager — no secrets in Terraform source, `.env` files, or image layers

**Given** an HTTP request hits the ALB on port 80
**When** the ALB listener evaluates it
**Then** it is redirected to HTTPS — no plaintext traffic served

**Given** ECS containers emit logs
**When** they appear in CloudWatch
**Then** they are in the correct log group with a 90-day retention policy configured

**Given** a request is processed by the API
**When** I check the X-Ray console
**Then** a trace segment for that request is visible

**Given** the `StorageProvider` and `SecretsProvider` abstractions from Story 1.3 exist
**When** the ECS task environment sets `STORAGE_BACKEND=s3` and `SECRETS_BACKEND=aws`
**Then** the application uses real S3 and Secrets Manager with **no application code changes** — only configuration

---

## Story 7.2: CI/CD Pipeline Setup

As a developer,
I want automated GitHub Actions pipelines for both service repos,
So that every PR is validated automatically and every merge to `main` deploys to dev with zero-downtime rolling deployment.

**Acceptance Criteria:**

**Given** a PR is opened against velara-api
**When** the CI workflow runs
**Then** it executes `ruff check`, `pytest`, and Docker build in sequence — the PR is blocked if any step fails

**Given** a PR is opened against velara-web
**When** the CI workflow runs
**Then** it executes `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` — the PR is blocked if any step fails

**Given** a commit is merged to `main` on velara-api
**When** the deploy workflow runs
**Then** it builds the Docker image, pushes to ECR, and triggers an ECS rolling deployment — with zero-downtime using the `/health/ready` readiness probe

**Given** a commit is merged to `main` on velara-web
**When** the deploy workflow runs
**Then** it builds the Vite bundle, syncs to the S3 frontend bucket, and invalidates the CloudFront distribution

**Given** an ECS deployment results in an unhealthy new task
**When** ECS detects the health check failure
**Then** ECS rolls back to the previous task definition automatically

**Given** secrets are needed in CI workflows
**When** the workflow accesses them
**Then** they are sourced from GitHub Actions secrets — never hardcoded in workflow YAML files

---

## Story 7.3: Cognito Authentication

As a Vitalief consultant or MA Tech developer,
I want to log in with my username and password against AWS Cognito,
So that my identity is verified by a HIPAA-eligible, SSO-ready provider and the local dev-auth shim is replaced for production.

> **Cutover:** This story swaps the `DevAuthProvider` (Epic 1, Story 1.4) for `CognitoAuthProvider`. Because both implement the same `AuthProvider` interface and JWT claims contract (`user_id`, `org_id`, role), the swap is a configuration change (`AUTH_BACKEND=cognito`) plus the frontend Amplify wiring inside `auth.ts` — no route or feature code changes.

> **Epic 6 forward-dependencies (added by Epic 6 retrospective, 2026-06-29):** Two Epic 6 certification deferrals become actionable the moment a real auth provider exists — capture both when this story is created:
> 1. **FR-SEC-12 — e-signature cryptographic re-auth.** Epic 6 records the signer as `certifier_user_id` + role, NOT a re-authenticated cryptographic signature (21 CFR Part 11 §11.200 signature-component binding). With Cognito in place, evaluate whether recording a certification should require password re-authentication-on-sign. [deferred in Epic 6; requirements-inventory FR-SEC-12]
> 2. **Printed-name resolution.** Certification badges + history render the raw `certifier_user_id` (UUID), not a human printed name (Epic 6 Decision D-signer / D2 — no User directory until Cognito). Once Cognito provides a user directory, resolve `certifier_user_id` → display name/email for the cert badge, tooltip, history rows, and the Part 11 e-signature attestation string. [velara-web cert components; deferred-work.md "no display name until Epic 7"]

**Acceptance Criteria:**

**Given** a user navigates to `/login`
**When** they enter valid credentials and submit
**Then** they are authenticated via AWS Cognito, a JWT is issued, and they are redirected to `/internal/engagements`

**Given** a logged-in user's Cognito session expires
**When** they make an API call
**Then** the Amplify SDK silently refreshes the token without requiring re-login; if refresh fails, they are redirected to `/login` with a session-expired message

**Given** a user enters incorrect credentials
**When** Cognito rejects the authentication
**Then** the UI shows "Invalid username or password." — no field-specific hint is exposed

**Given** a valid Cognito JWT is present in a request
**When** FastAPI processes the request
**Then** it validates the JWT signature against the Cognito JWKS endpoint, extracts `user_id` and `org_id` from claims, and allows the request — through the same provider-agnostic dependency used by the dev-auth shim

**Given** a request arrives with an expired or invalid JWT
**When** FastAPI validates the token
**Then** the request is rejected with HTTP 401 and `{"error": {"code": "UNAUTHORIZED", "message": "Authentication required.", "request_id": "..."}}`

**Given** a user clicks "Log out"
**When** the logout completes
**Then** the Cognito session is invalidated, local tokens cleared, and the user redirected to `/login`

**Given** the Cognito user pool is configured
**When** I inspect the pool federation settings
**Then** a SAML/OIDC identity provider slot exists and is ready to accept Azure AD configuration (not activated — Phase 2 prep)

---

## Story 7.4: Cloud Observability, HIPAA & 21 CFR Part 11 Compliance Baseline

As a platform operator,
I want CloudWatch dashboards, alarms, distributed tracing, and the data handling policy documented,
So that the platform meets HIPAA obligations and every failure is surfaced without risk of PHI exposure.

> **Note:** Local structured logging (structlog), the PHI sanitizer, and Sentry error tracking already ship in the Epic 1 scaffolds (Stories 1.1/1.2) and are not blocked. This story adds the **cloud** observability surfaces (CloudWatch metrics/dashboards/alarms, X-Ray) and finalizes the data-handling policy. The data-handling-policy document has no AWS dependency and may be drafted earlier if convenient.

**Acceptance Criteria:**

**Given** the platform is running
**When** I open the CloudWatch dashboard for dev
**Then** I see metrics for: API request count, P50/P95/P99 latency, error rate, Celery queue depth, and worker task throughput — all updating in real time

**Given** error rate exceeds 1% or P95 latency exceeds 3s for 5 continuous minutes
**When** the CloudWatch alarm triggers
**Then** a notification is sent to the configured SNS topic

**Given** a request trace completes
**When** I view it in X-Ray
**Then** the trace shows the full span: API handler → service → DB query → (if applicable) Celery task enqueue

**Given** an unhandled exception occurs in the API or a Celery task
**When** Sentry captures it
**Then** the event is tagged with `environment`, `skill_id` (if applicable), `job_id` (if applicable), and the PHI `before_send` sanitizer has run — no PHI-pattern fields in the Sentry payload

**Given** any log line is written
**When** I inspect it in CloudWatch Logs
**Then** it is structured JSON containing `request_id`, `level`, `timestamp`, `message` — never a raw email address, MRN, or PHI value

**Given** `docs/data-handling-policy.md` exists in the velara hub repo
**When** Vitalief reviews it
**Then** it covers: data classification, retention schedules, encryption at rest and in transit, access control model, BAA status, incident response procedure, and PHI handling rules

**Given** 21 CFR Part 11 applies to the platform (FR-SEC-09–12)
**When** the compliance baseline is prepared
**Then** `docs/compliance-mapping.md` maps each Part 11 clause (§11.10 controls, §11.50/§11.70 e-signatures, §11.300 identification codes) to its implementing control — audit log → Epic 9, certification e-signatures → Epic 6, RBAC/auth → Epic 7/8 — and `docs/validation-plan.md` defines the computer-system validation plan (IQ/OQ/PQ scope)

**Given** the Phase 1 compliance scope (FR-SEC-12)
**When** the validation plan is reviewed
**Then** it explicitly records that **formal IQ/OQ/PQ execution and full e-signature non-repudiation are deferred** to a tracked compliance backlog — Phase 1 delivers the plan, the clause mapping, and the cheap gap-closing controls (e-signature manifestation in Epic 6, audit attributability in Epic 9)

---
