# 4. Platform Hierarchy

Every entity in the platform lives within a hierarchy. Access control, skill scoping, and audit logging all resolve against this tree.

```
Organization
└── Client
    └── Project / Engagement
        ├── Study (optional — clinical trial studies)
        │   ├── Location (physical clinical site)
        │   └── Skills (scoped to this Study)
        └── Skills (not Study-scoped — available at Project level)
```

**Organization** — The top-level tenant. Phase 1 deploys with Vitalief as the sole organization. The data model supports multiple organizations for future portability (e.g., licensing the platform to another firm). **Organizations are never surfaced in the UI.** They exist only as a backend tenant concept. The visible hierarchy always starts at Client.

**Client** — A client organization Vitalief serves. Each client is owned by one Organization. Clients are the top-level entity visible in the UI, displayed under the "Engagements" section.

**Project / Engagement** — A named body of work for a Client. Skills can be attached directly to a Project and are available to all authorized users of that Project.

**Study** — A clinical trial or named research study within a Project. Studies are optional — not all Projects have them. Skills can be scoped to a Study rather than the full Project.

**Location** — A physical clinical site within a Study (e.g., a hospital or research center participating in the trial). Locations exist only within Studies. Each Location stores a postal code, which determines Medicare benefits eligibility and may be consumed by location-dependent skills. See §5.4 for location-dependent skill behavior.

**Skill** — The unit of executable methodology. Exists at the Project or Study level. See Section 5.

---
