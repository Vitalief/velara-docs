# 8. Skill Authoring (Out of Platform Scope, but Relevant)

The platform is not an authoring tool in Phase 1. Skills are authored externally (Claude via claude.ai or Claude Code) and submitted to MA Technologies for technical validation.

**Skill format requirements (for validation compatibility):**

- Skills follow the Anthropic SKILL.md pattern extended with Vitalief-specific metadata fields.
- Required metadata: name, description, author, version (semantic — major.minor.patch), lifecycle state, internal/client designation, runtime type, input schema, output schema, location-dependent flag.
- Optional: reference files, example inputs/outputs, change log, dependency list.
- Major version bumps indicate breaking input/output schema changes. Minor = new non-breaking functionality. Patch = fixes only.
- Every version change is logged with author, date, summary, and re-certification status.

---
