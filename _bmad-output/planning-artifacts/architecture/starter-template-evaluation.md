# Starter Template Evaluation

## Primary Technology Domain

Full-stack web application + REST API + background job processing + LLM integration (enterprise complexity, HIPAA BAA-grade)

## Repo Structure

Multi-repo strategy with a hub/docs repo as the planning and design anchor:

```
velara/          ← this repo — hub repo (PRD, architecture, epics, design prototype)
velara-api/      ← FastAPI backend service
velara-web/      ← React/Vite frontend
```

BMad planning artifacts (PRD, architecture, epics, stories) live in the hub repo. Each service repo gets its own BMad install for story execution only (`bmad-dev-story`). Stories are authored in the hub and executed in the relevant service repo.

## Starter Options Considered

**PostgreSQL vs Neo4j for hierarchy storage:**
The Org → Client → Project → Study → Location tree, skill derivation lineage, and RBAC traversal are genuinely graph-shaped. Neo4j Aura Enterprise is HIPAA-eligible but less operationally proven in that context than AWS RDS PostgreSQL. Decision: PostgreSQL with `ltree` extension for Phase 1 — handles ancestor/descendant traversal efficiently without adding graph DB operational overhead. Neo4j deferred to Phase 2 evaluation pending Phase 1 complexity data.

**Backend runtime:**
Python (FastAPI) is the natural choice — skill execution includes Python code-based skills (EXE-02), so the backend runtime and the skill runtime are the same language. Avoids a cross-language execution bridge.

**Frontend:**
Vite + React aligns directly with the existing design prototype (JSX components → TSX). Fast dev server, clean production build, no framework lock-in.

## Selected Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend API | FastAPI (Python 3.12+) | Async, fast, Pydantic v2 validation, natural fit for Python skill execution |
| ORM / Migrations | SQLAlchemy (async) + Alembic | Production-tested, async-native, clean migration workflow |
| Database | PostgreSQL (AWS RDS) + `ltree` | HIPAA-eligible managed service, ltree for hierarchy traversal, ACID compliance |
| Background jobs | Celery + Redis (AWS ElastiCache) | Async skill execution, fan-out multi-location runs, file processing |
| File storage | AWS S3 | HIPAA-eligible, presigned URLs for secure upload/download, lifecycle policies |
| Frontend | Vite + React + TypeScript | Aligns with prototype, fast dev, type-safe |
| Data fetching | TanStack Query | Server state management, caching, background refetch |
| Styling | Tailwind CSS | Matches the design system tokens from the prototype |
| Deployment | AWS ECS (Fargate) + ECR | Containerized, serverless compute, no cluster management |
| Infrastructure | Terraform | IaC, repeatable deployments, Vitalief-owned state |
| CI/CD | GitHub Actions | Per-repo pipelines, Docker build + push to ECR, ECS rolling deploys |

## Initialization Commands

**velara-api:**
```bash
# Based on fastapi/full-stack-fastapi-template as reference
pip install fastapi uvicorn[standard] sqlalchemy[asyncio] asyncpg alembic pydantic-settings celery redis boto3 anthropic python-multipart
```

**velara-web:**
```bash
npm create vite@latest velara-web -- --template react-ts
# Add: react-router-dom @tanstack/react-query tailwindcss axios
```

**Note:** Repository initialization and base project scaffolding should be the first implementation story in each service repo.
