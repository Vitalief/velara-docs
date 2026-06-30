# 6. Non-Functional Requirements

## 6.1 Performance

| Requirement | Target |
|-------------|--------|
| Platform overhead per skill invocation (excluding skill runtime) | ≤ 2 seconds at P95 |
| Concurrent skill executions at launch | ≥ 10, with headroom to scale |
| Maximum file upload size | 100 MB per file |
| Skill registry list response (server-side, P95) | ≤ 500 ms at 10k skills, via pagination *(added 2026-06-12 — sprint-change-proposal-2026-06-12.md; Story 5.6/5.7)* |

## 6.2 Reliability

| Requirement | Target |
|-------------|--------|
| Monthly uptime during Vitalief business hours | 99.5% from launch |
| Silent failures | Zero — every execution failure is logged and surfaced to the invoker |
| Skill artifacts and audit log backup | Daily, with off-site retention |

## 6.3 Maintainability

- All platform code is delivered to and resides in a Vitalief-owned repository from Phase 1 day one.
- Platform code, API surface, deployment process, and validation methodology are documented at a level that supports handover to a different vendor.
- Technology choices favor mature, widely-used, open-source options over novel or proprietary alternatives. This protects against vendor lock-in and supports portability.

## 6.4 Compliance and Legal

- HIPAA readiness is built in from day one, not retrofitted. A BAA is in place with the cloud provider and with MA Technologies before PHI-adjacent skills are deployed.
- Data is hosted in the United States by default. Other jurisdictions require explicit Vitalief approval.
- All platform code, skill artifacts, and derived works are owned by Vitalief as work-for-hire. MA Technologies retains no rights to reuse Vitalief-funded work on other client engagements without explicit Vitalief approval.

---
