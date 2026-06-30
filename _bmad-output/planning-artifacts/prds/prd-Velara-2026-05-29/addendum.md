# PRD Addendum: Technical Architecture Decisions

This addendum captures technical architecture decisions and alternatives considered that inform downstream design but fall outside the scope of the PRD itself.

---

## 1. Claude Invocation Proxy Pattern

Skills are not invoked directly by clients. All invocations flow through a platform API intermediary. When Claude (via claude.ai, Claude Code, or the Anthropic API) executes a skill, it calls a platform endpoint. The platform resolves the skill definition, injects methodology content server-side, executes the skill, and returns the output to the caller. Skill internals — prompt templates, retrieval context, embedded logic — never traverse the network to the client.

This proxy architecture is the mechanical implementation behind BRD requirement INV-01. It decouples the invocation interface from the skill definition, allowing the platform to enforce access control, audit logging, and content injection at a single choke point. The caller's experience is a black-box function call: inputs in, outputs out. Future versioning, A/B testing, and rollback can be handled server-side without changes to any client-facing interface.

---

## 2. Compiled Skill Artifact Model for IP Protection

Skills are authored internally in a rich source format: prompt templates, executable code, retrieval references, parameter schemas, and metadata. When a skill is promoted to client-facing state, it is published as a compiled invocable artifact. The artifact exposes only the invocation interface — name, parameter schema, and output contract. The underlying instructions, code, and retrieval configuration are stored server-side and are never returned by any API endpoint.

This is analogous to distributing a compiled binary rather than source code. A client can call the skill and inspect its outputs; they cannot read, copy, or reconstruct the methodology that drives it. This model satisfies ACL-02 (no exposure of proprietary methodology content via API) and ACL-03 (client access limited to invocation results). Internal users with appropriate permissions access the source artifact through a separate, authenticated authoring interface.

---

## 3. Namespace-Isolated Retrieval for Client vs. Internal Invocations

The platform maintains two retrieval namespaces over the methodology corpus. Internal invocations — run by credentialed Vitalief staff or via internal skill pipelines — operate over the full corpus, including proprietary methodology documents, unpublished frameworks, and internal reference material.

Client-facing skill invocations operate over a scoped retrieval namespace that excludes all proprietary methodology content. This namespace contains only content explicitly approved for client-side retrieval (e.g., public guidance, client-uploaded study documents, approved reference data).

Namespace boundaries are enforced at the storage and retrieval layer — not solely at the API layer. A client-facing invocation cannot escalate its retrieval scope by manipulating query parameters or prompt injection, because the retrieval index it queries does not contain the excluded content. This defense-in-depth approach ensures that even a compromised or manipulated prompt cannot extract internal methodology through a client-facing skill path.

---

## 4. Options Considered for HIPAA-Compliant Hosting

Three cloud providers were evaluated for HIPAA-eligible infrastructure:

**AWS (recommended).** Most mature HIPAA-eligible services list. AWS offers a BAA covering a broad set of services. Bedrock provides managed Claude access with a separate Anthropic BAA available for enterprise accounts. Standard compliance pattern: VPC isolation, KMS encryption at rest, CloudTrail audit logging, S3 with object-level logging, RDS with encrypted storage. Strong healthcare reference customer base and audit precedent.

**Azure (strong alternative).** Solid HIPAA/HITECH coverage and well-suited for clients in Microsoft-ecosystem organizations. Azure OpenAI Service is mature; Claude on Azure is available but less established. Preferred if the client base skews toward enterprise Microsoft shops.

**GCP (not recommended at this time).** HIPAA BAA available but healthcare reference track is less established relative to AWS and Azure. Consider revisiting if client demand warrants.

**Recommendation:** Deploy on AWS. Use Bedrock for Claude invocations where possible; fall back to direct Anthropic API under an enterprise BAA if Bedrock model availability lags.

---

## 5. Multi-Invocation Pattern for Location-Dependent Skills

Some skills produce outputs that vary by geographic or regulatory jurisdiction — for example, site feasibility assessments or regulatory requirement summaries. These skills are flagged in their definition as `location-dependent`.

When a location-dependent skill is invoked without a specific location selected, the platform supports two resolution behaviors, declared in the skill definition:

**Prompt mode:** The platform returns an error or prompt response instructing the invoker to specify a location before execution. Invocation is blocked until a location is provided. Used when aggregated output would be misleading or when the skill logic cannot be meaningfully parallelized.

**Fan-out mode:** The platform fans out parallel invocations — one per location associated with the Study — and returns aggregated results in a structured format (e.g., a keyed object or table indexed by location). Used when the skill produces independent, combinable outputs per location and aggregation adds clear value.

The skill definition declares which mode applies. The platform enforces this at invocation time; callers cannot override the declared behavior.
