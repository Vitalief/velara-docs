# Project Context Analysis

## Requirements Overview

**Functional Requirements:**

70+ FRs across 13 sections covering: organizational hierarchy management (ORG), skill registry and lifecycle (REG), skill execution engine (EXE), location-dependent skill behavior (LOC), document ingest (ING), output generation (OUT), access control and IP protection (ACL), invocation (INV), certification workflow (CRT), connector framework (CON/API), usage tracking and audit (USE), security and compliance (SEC), and portability (POR).

Key architectural FRs:
- Hierarchical multi-tenancy: every query, access check, and audit log resolves against a 5-level tree (Org → Client → Project → Study → Location)
- Three skill runtime types: prompt (LLM), code (Python), hybrid (LLM orchestrating code tools) — each a distinct execution path, all sandboxed
- IP protection as a structural guarantee: no API route exposes skill internals to client-scoped tokens (not just RBAC — enforced at the API surface layer)
- Fan-out parallel execution: location-dependent skills trigger N parallel invocations, one per clinical site, with aggregated results
- File processing both ends: ingest PDF/DOCX/XLSX up to 100MB; output branded PDF/PPTX/DOCX/XLSX
- Immutable audit log: append-only, full hierarchy path on every entry, 7-year retention
- Claude proxy pattern: Claude calls platform endpoint; platform executes skill server-side and returns only output
- Two-key certification workflow: stateful governance with role-gated approval steps

**Non-Functional Requirements:**

| NFR | Target |
|-----|--------|
| Platform invocation overhead | ≤ 2s at P95 |
| Concurrent skill executions | ≥ 10 at launch, scalable |
| File upload size | 100 MB per file |
| Uptime (business hours) | 99.5% monthly |
| Silent failures | Zero — every failure logged and surfaced |
| Audit log retention | 7 years |
| Encryption at rest | AES-256 |
| Encryption in transit | TLS 1.2+ |
| PHI in URLs/logs/errors | Never — architectural enforcement |

**Scale & Complexity:**

- Primary domain: Full-stack web + REST API + background job processing + LLM integration
- Complexity level: **Enterprise**
- Compliance tier: HIPAA BAA-grade
- Estimated architectural components: ~10 distinct services/modules

## Technical Constraints & Dependencies

- Cloud: AWS preferred (most mature HIPAA-eligible services list; Anthropic BAA available via Bedrock or direct API enterprise agreement)
- Containerization: Docker required; infrastructure-as-code required
- Dependencies: open-source preferred; no proprietary dependencies that would prevent client-side deployment
- Vitalief-specific config (brand assets, org identity) must be parameterized, not hard-coded
- All code and artifacts owned by Vitalief as work-for-hire from day one

## Cross-Cutting Concerns Identified

| Concern | Affects |
|---------|---------|
| PHI protection | Storage, API responses, logging, error messages — every layer |
| Hierarchy-scoped RBAC | Every data query, every API endpoint |
| Immutable audit trail | All write operations and all skill invocations |
| IP protection (skill internals never exposed) | Storage layer + all API routes for client-scoped tokens |
| Execution isolation/sandboxing | Skill execution engine — prompt, code, and hybrid runtimes |
| Async file processing | Ingest pipeline, output generation, fan-out multi-location runs |
