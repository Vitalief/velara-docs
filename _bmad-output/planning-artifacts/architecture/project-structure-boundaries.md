# Project Structure & Boundaries

## velara/ (hub repo)

```
velara/
├── _bmad/
├── _bmad-output/planning-artifacts/
│   ├── architecture.md
│   ├── epics/
│   └── prds/prd-Velara-2026-05-29/
│       ├── prd.md  ├── addendum.md  ├── .decision-log.md
├── design/
│   ├── Velara v3.html  ├── app_v3.jsx  ├── overrides.jsx
│   ├── hierarchy.jsx  ├── client.jsx  ├── data.js
│   ├── styles_v3.css  └── screenshots/
├── docs/Vitalief_Skills_Platform_BRD.docx
└── README.md
```

## velara-api/ (FastAPI backend)

```
velara-api/
├── .github/workflows/
│   ├── ci.yml                      ← lint, test, build on PR
│   └── deploy.yml                  ← ECR push + ECS rolling deploy
├── app/
│   ├── main.py                     ← FastAPI app factory, middleware registration
│   ├── api/v1/
│   │   ├── router.py               ← mounts all sub-routers
│   │   ├── health.py               ← GET /health, GET /health/ready
│   │   ├── auth.py                 ← POST /auth/token (Cognito exchange)
│   │   ├── hierarchy.py            ← clients, projects, studies, locations (ORG)
│   │   ├── skills.py               ← REG-01–REG-09: registry CRUD + lifecycle
│   │   ├── certifications.py       ← CRT-01–CRT-05: certification + validation
│   │   ├── invocations.py          ← INV-01–INV-09: skill invocation
│   │   ├── jobs.py                 ← GET /jobs/{job_id} poll endpoint
│   │   ├── ingest.py               ← ING-01–ING-06: document upload pipeline
│   │   ├── outputs.py              ← OUT-01–OUT-06: output generation
│   │   └── audit.py                ← USE-01–USE-05: audit log queries
│   ├── core/
│   │   ├── config.py               ← Pydantic Settings (env vars + Secrets Manager)
│   │   ├── security.py             ← Cognito JWT validation
│   │   ├── dependencies.py         ← hierarchy_scope dep, current_user dep
│   │   ├── middleware.py           ← request_id injection, PHI sanitizer, X-Ray
│   │   └── exceptions.py           ← domain exceptions + global error handler
│   ├── models/
│   │   ├── base.py                 ← declarative base, ltree column type
│   │   ├── hierarchy.py            ← Organization, Client, Project, Study, Location
│   │   ├── skill.py                ← Skill, SkillVersion (compiled artifact)
│   │   ├── certification.py        ← CertificationRecord, ValidationRecord
│   │   ├── invocation.py           ← InvocationJob, InvocationResult
│   │   ├── access_grant.py         ← UserAccessGrant (user_id, node_id, role)
│   │   ├── audit.py                ← AuditLogEntry (append-only, partitioned)
│   │   └── file_ref.py             ← FileReference (S3 key + metadata)
│   ├── schemas/
│   │   ├── common.py               ← ResponseEnvelope, ErrorEnvelope, PageMeta
│   │   ├── hierarchy.py  ├── skill.py  ├── certification.py
│   │   ├── invocation.py  ├── job.py  ├── ingest.py  ├── output.py
│   ├── services/
│   │   ├── hierarchy_service.py    ← CRUD + ltree path management
│   │   ├── skill_service.py        ← registry lifecycle, compiled artifact mgmt
│   │   ├── certification_service.py← two-key certification state machine
│   │   ├── execution_service.py    ← skill dispatch: prompt/code/hybrid router
│   │   ├── ingest_service.py       ← PDF/DOCX/XLSX parse + S3 upload
│   │   ├── output_service.py       ← branded output generation
│   │   ├── audit_service.py        ← append-only audit log writes
│   │   └── access_service.py       ← RBAC grant resolution
│   ├── workers/
│   │   ├── celery_app.py           ← Celery app factory, broker config
│   │   ├── execution_tasks.py      ← run_skill, fan_out_locations, aggregate_results
│   │   ├── ingest_tasks.py         ← parse_document, extract_chunks
│   │   └── output_tasks.py         ← generate_pdf, generate_pptx, generate_docx
│   ├── db/
│   │   ├── session.py
│   │   └── migrations/             ← Alembic versions
│   └── integrations/
│       ├── anthropic_client.py     ← Claude API wrapper (proxy pattern)
│       ├── s3_client.py            ← presigned URL generation, upload/download
│       └── cognito_client.py       ← token validation helpers
├── tests/
│   ├── conftest.py
│   ├── unit/services/
│   └── integration/api/
├── docker/
│   ├── Dockerfile.api
│   └── Dockerfile.worker
├── docker-compose.yml              ← local dev: postgres, redis, api, worker
├── alembic.ini
├── pyproject.toml
├── .env.example
└── terraform/
    ├── ecs.tf  ├── rds.tf  ├── elasticache.tf  ├── ecr.tf
    ├── iam.tf  ├── alb.tf  ├── vpc.tf  └── variables.tf
```

## velara-web/ (Vite + React frontend)

```
velara-web/
├── .github/workflows/
│   ├── ci.yml                      ← typecheck, lint, test, build
│   └── deploy.yml                  ← build → S3 → CloudFront invalidation
├── src/
│   ├── main.tsx
│   ├── App.tsx                     ← Router, QueryClientProvider, Sentry init
│   ├── routes/
│   │   ├── internal.tsx            ← /internal/* route tree + RequireAuth
│   │   └── client.tsx              ← /client/* route tree + RequireAuth
│   ├── features/
│   │   ├── engagements/            ← ORG hierarchy UI, landing page
│   │   │   ├── components/
│   │   │   │   ├── EngagementTree.tsx  ├── ProjectDetail.tsx
│   │   │   │   ├── StudyDetail.tsx  └── LocationDetail.tsx
│   │   │   ├── hooks/useEngagements.ts
│   │   │   └── types.ts
│   │   ├── skills/                 ← REG-01–REG-09: skill registry
│   │   │   ├── components/
│   │   │   │   ├── SkillRegistry.tsx  ├── SkillDetail.tsx
│   │   │   │   ├── SkillCard.tsx  └── SkillLifecycleBadge.tsx
│   │   │   ├── hooks/useSkills.ts
│   │   │   └── types.ts
│   │   ├── run/                    ← INV-01–INV-09: Run Console (contextual only)
│   │   │   ├── components/
│   │   │   │   ├── RunConsole.tsx  ← skill-first + context-first modes
│   │   │   │   ├── ContextPicker.tsx  ├── JobStatus.tsx  └── RunOutput.tsx
│   │   │   ├── hooks/useRunJob.ts
│   │   │   └── types.ts
│   │   ├── certification/          ← CRT-01–CRT-05: unified cert + validation UI
│   │   │   ├── components/
│   │   │   │   ├── CertificationPanel.tsx  ├── ValidationChecklist.tsx
│   │   │   │   └── CertificationBadge.tsx
│   │   │   ├── hooks/useCertification.ts
│   │   │   └── types.ts
│   │   ├── ingest/                 ← ING-01–ING-06: document upload UI
│   │   │   ├── components/FileUpload.tsx  ├── IngestProgress.tsx
│   │   │   └── hooks/useIngest.ts
│   │   ├── admin/                  ← ACL: access grants, user management
│   │   │   ├── components/AccessGrantTable.tsx
│   │   │   └── hooks/useAdmin.ts
│   │   └── client-portal/          ← ACL-07, client-facing views
│   │       ├── components/
│   │       │   ├── ClientDashboard.tsx  ├── ClientStudy.tsx  └── ClientRun.tsx
│   │       └── hooks/useClientPortal.ts
│   ├── shared/
│   │   ├── components/
│   │   │   ├── AppBar.tsx  ├── NavTabs.tsx  ├── ErrorBoundary.tsx
│   │   │   ├── Skeleton.tsx  └── Toast.tsx
│   │   ├── utils/
│   │   │   ├── dates.ts            ← ISO → display formatter
│   │   │   ├── errors.ts           ← error.code → human message map
│   │   │   └── sentry.ts           ← PHI sanitizer + Sentry config
│   │   └── design-tokens.ts        ← Tailwind token exports from styles_v3.css
│   ├── stores/
│   │   ├── useHierarchyStore.ts    ← active client/project/study selection
│   │   ├── useRunStore.ts          ← active run context, job polling
│   │   └── useRoleStore.ts         ← internal vs client role switcher
│   └── api/
│       ├── client.ts               ← Axios instance, interceptors, request_id header
│       ├── skills.ts  ├── hierarchy.ts  ├── jobs.ts
│       ├── certifications.ts  ├── ingest.ts  └── outputs.ts
├── public/assets/                  ← Vitalief brand assets
├── index.html  ├── vite.config.ts  ├── tailwind.config.ts
├── tsconfig.json  ├── .env.example  ├── package.json
└── terraform/
    ├── cloudfront.tf  ├── s3_frontend.tf  └── variables.tf
```

## FR-to-Structure Mapping

| PRD Section | Backend | Frontend |
|------------|---------|----------|
| ORG-01–06 (hierarchy) | `api/v1/hierarchy.py`, `services/hierarchy_service.py` | `features/engagements/` |
| REG-01–09 (skill registry) | `api/v1/skills.py`, `services/skill_service.py` | `features/skills/` |
| EXE-01–06 (execution) | `services/execution_service.py`, `workers/execution_tasks.py`, `integrations/anthropic_client.py` | `features/run/` |
| LOC-01–06 (location-dependent) | fan-out in `execution_tasks.py`, Location fields in `models/hierarchy.py` | `features/run/ContextPicker.tsx` |
| ING-01–06 (ingest) | `api/v1/ingest.py`, `services/ingest_service.py`, `workers/ingest_tasks.py` | `features/ingest/` |
| OUT-01–06 (output) | `api/v1/outputs.py`, `services/output_service.py`, `workers/output_tasks.py` | `features/run/RunOutput.tsx` |
| ACL-01–07 (access control) | `core/dependencies.py`, `services/access_service.py`, `models/access_grant.py` | `features/admin/`, client-portal guards |
| INV-01–09 (invocation + Run UX) | `api/v1/invocations.py`, `api/v1/jobs.py` | `features/run/RunConsole.tsx` |
| CRT-01–05 (certification) | `api/v1/certifications.py`, `services/certification_service.py` | `features/certification/` |
| USE-01–05 (audit) | `api/v1/audit.py`, `services/audit_service.py`, `models/audit.py` | Internal admin view |
| SEC-01–06 (security) | `core/security.py`, `core/middleware.py`, Cognito, Secrets Manager | `shared/utils/sentry.ts`, RequireAuth wrappers |

## Key Data Flows

**Skill execution (async job):**
`RunConsole → POST /api/v1/invocations/{skill_id}` → `InvocationJob` (status: `queued`) → Celery `run_skill` → `execution_service` routes prompt/code/hybrid → Claude API (proxy) → result → S3 + `InvocationResult` → job `completed` → frontend polls `/api/v1/jobs/{job_id}` → display

**Document ingest:**
`FileUpload → presigned S3 URL` → direct S3 upload → `POST /api/v1/ingest` with S3 key → Celery `parse_document` → extracted content stored → available as skill input context

**Fan-out (location-dependent skills):**
`execution_service` detects location-dependent skill → N `run_skill` Celery tasks dispatched in parallel → parent `aggregate_results` chord awaits all → merged result written → single job `completed`
