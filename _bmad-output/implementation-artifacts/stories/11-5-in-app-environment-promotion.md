---
baseline_commit: 84812d8 (velara-api) / 1ee012e (velara-web)  # refreshed 2026-07-13 after the revert
---

# Story 11.5: In-App Environment Promotion (Phase-2 Design + Stub)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief operator,
I want a "Promote to staging/prod" action on a `client_ready` skill that copies it across environments in-app,
so that promotion needs no file download/upload — and, until that transport exists, I want the seam, the design, and an honest UI that tells me to use Export/Import instead.

## Acceptance Criteria

> ⚠️ **Read the scope note in Tasks first.** This story is **design + seam**, NOT the working cross-environment transport. The epic AC says so explicitly ("Phase-2 target — design + minimal seam this epic; full build deferred"). An implementation that opens a real network path between environments has *exceeded* this story and must be rejected.

1. **AC1 — The ADR actually answers the three Phase-2 questions it currently defers.**
   **Given** the governing ADR ([core-architectural-decisions.md#Environment-Promotion](../../planning-artifacts/architecture/core-architectural-decisions.md), lines 252-269) says the Phase-2 path is "an **authenticated service-to-service call**" and nothing more
   **When** this story lands
   **Then** the ADR is **amended** to specify what it currently only names as hard: **(a) the auth mechanism** for source-env → target-env identity; **(b) the promotable lifecycle-state predicate**; **(c) cross-environment identity + the promotion topology** (which env may promote to which). ⭐ **This is the story's headline deliverable.** The epic AC1 reads "the architecture ... is specified (ADR)" as if it were already true — **it is not**. The ADR explicitly *defers* all three ("Phase 1 ships export/import ... **without waiting on cross-environment networking + identity**"), and the epic itself still lists key management as an [Open Question](../../planning-artifacts/epics/epic-11-ai-assisted-skill-integration-and-promotion.md) ("where does the signing key live per environment, and **how is it rotated?**"). The amendment must confront the blocker the ADR never saw (see AC2).

2. **AC2 — The amendment confronts the symmetric-key problem head-on: HMAC proves integrity, NOT sender identity.**
   **Given** signing today is **symmetric HMAC-SHA256** with a **per-environment** `BUNDLE_SIGNING_KEY` ([config.py:226-233](../../../velara-api/app/core/config.py#L226), [skill_export.py:118-135](../../../velara-api/app/services/skill_export.py#L118))
   **When** the ADR amendment specifies the Phase-2 auth
   **Then** it must state plainly that **a shared symmetric key cannot authenticate a promoting environment** — it proves *the bytes were not tampered with by someone lacking the key*, not *who sent them*. Any environment holding the key can forge a bundle indistinguishable from any other's. Two environments sharing one key means **prod trusts anything dev can mint**, which inverts the trust-grading the ADR's whole Context paragraph rests on (`terraform/README.md` gates staging/prod behind a signed BAA). The amendment must pick and justify **one** resolution — the recommendation to write up, unless the architect overrules: **the transport carries the identity, the signature keeps carrying only integrity.** I.e. Phase 2 authenticates the *caller* with a real cross-env principal (AWS SigV4 / IAM role assumption across accounts, or an OIDC machine token), and the existing per-env HMAC stays exactly what it is — an integrity check the *target* performs with *its own* key on a bundle it re-signs on landing. **Do NOT propose "just share one key across all environments"** — that is the inversion, written down.

3. **AC3 — A `PromotionProvider` seam lands, following the established provider-abstraction pattern verbatim.**
   **Given** this codebase has one canonical provider-seam shape — `typing.Protocol` + concrete impls + an `@lru_cache` factory keyed on a `Literal` config selector + an `Annotated[..., Depends(...)]` alias ([auth.py:154,294,491,773](../../../velara-api/app/integrations/auth.py#L154), [storage.py:24,77,188](../../../velara-api/app/integrations/storage.py#L24), [secrets.py:42,54,69,96](../../../velara-api/app/integrations/secrets.py#L42))
   **When** the seam lands
   **Then** a NEW `app/integrations/promotion.py` defines `class PromotionProvider(Protocol)` + a `DisabledPromotionProvider` (the ONLY impl this story ships) + `@lru_cache(maxsize=1) def get_promotion_provider()` keyed on a NEW `PROMOTION_BACKEND: Literal["disabled", "remote"] = "disabled"` setting, and `core/dependencies.py` gains the `Promotion` DI alias. `DisabledPromotionProvider.promote(...)` **raises `PromotionNotConfiguredError` (422 `PROMOTION_NOT_CONFIGURED`)** — it does not silently no-op, and it does not secretly fall back to Export. Phase 2 adds a `RemotePromotionProvider` and flips the selector; **nothing else changes.** That "nothing else changes" is the seam's entire reason to exist and is what AC3 is testing.

4. **AC4 — `POST /api/v1/skills/{skill_id}/promote` exists, is grantor-gated, and enforces the promotable-state predicate BEFORE reaching the seam.**
   **Given** the epic AC ("**Given** a `client_ready` skill / **Then** the promote action is available")
   **When** a grantor calls promote
   **Then** the route validates in this order and **rejects a non-promotable skill before the provider is ever consulted**: org-scoped `get_skill` (404 cross-org) → **`client_ready` gate** → resolve the target version → `PromotionProvider.promote(...)`. A skill in `draft` / `internal_ready` / `retired` is rejected **422 `SKILL_NOT_PROMOTABLE`** (new code) *without* calling the provider, so the state rule is enforced by Velara and not delegated to a future transport. ⭐ **This gate is genuinely NEW code — `export_skill_version` has NO lifecycle check at all today** ([skill_export.py:141](../../../velara-api/app/services/skill_export.py#L141) — you can export a `draft`); do not assume export already does this. Grantor-gate with per-route `RejectNonGrantor` (the router already carries `RejectClient`). With `PROMOTION_BACKEND=disabled` (every environment today) a *valid, promotable* request therefore terminates in **422 `PROMOTION_NOT_CONFIGURED`** — the honest answer, not a fake success.

5. **AC5 — Promotion is NOT a lifecycle transition on the source skill, and the "trust does not copy" rule is preserved in the design.**
   **Given** `_ALLOWED_TRANSITIONS` makes `client_ready` terminal-except-retire ([skill_service.py:59-64](../../../velara-api/app/services/skill_service.py#L59))
   **When** promote runs
   **Then** it **does not mutate the source skill's `lifecycle_state`** — promoting is an export-shaped *read* of a `client_ready` skill, not a state change on it. The source stays `client_ready`; there is no `promoted` state and none is added. **AND** the ADR amendment restates the load-bearing rule for the Phase-2 path: the promoted skill lands **non-`client_ready` (i.e. `draft`) in the target with ZERO certification records copied**, exactly as `import_skill_bundle` does today ([skill_export.py:270](../../../velara-api/app/services/skill_export.py#L270) — the re-create branches at ~387/413 land `draft` and copy no cert rows; the docstring states the rule) — target-environment two-key certification must re-run. The ADR's revisit trigger forbids the shortcut in as many words: *"Never add a 'promote already-certified as certified' shortcut that skips target-environment re-certification."* No task in this story may weaken that.

6. **AC6 — The promote payload REUSES the 11.4 signed envelope; no second bundle format is invented.**
   **Given** the ADR: the Phase-2 path is "the same decision minus the file", "carrying the same signed content-addressed payload"
   **When** the seam's `promote()` signature is designed
   **Then** it takes the **existing** `export_skill_version(...) -> (zip_bytes, envelope)` output ([skill_export.py:141](../../../velara-api/app/services/skill_export.py#L141)) as its payload — **do NOT author a new envelope, a new digest scheme, or a second signer.** The envelope already carries `environment` as *provenance* and embeds no target-specific identifier, exactly as the ADR's revisit trigger requires ("avoid embedding environment-specific identifiers in the signed payload"). The route therefore calls the existing exporter and hands the result to the seam. This story adds **zero** new serialization code.

7. **AC7 — Promote records a best-effort admin audit event, and the FE renders it.**
   **Given** the existing audit seam ([audit_service.record_admin_action](../../../velara-api/app/services/audit_service.py#L260), canonical call site [skill_service.py:1027-1051](../../../velara-api/app/services/skill_service.py#L1027))
   **When** a promote is *attempted* — including the `PROMOTION_NOT_CONFIGURED` outcome
   **Then** a new `EVENT_ADMIN_SKILL_PROMOTED = "admin.skill_promoted"` constant is added to [audit.py](../../../velara-api/app/models/audit.py) and written best-effort (`try/except`, after the operation, never rolls back), metadata = IDs/target-env/digest only. ⭐ **AND the two Story-12.5 guards are satisfied in the SAME change — both are hard CI gates:** (a) the **BE audit-coverage guard** ([test_audit_coverage_guard.py](../../../velara-api/tests/unit/test_audit_coverage_guard.py)) walks the **live route table** and fails on any mutating route absent from its hand-maintained `REGISTRY` — the new promote route MUST be registered (Task 5b); (b) the **FE icon completeness test** ([eventTypeIconMeta.test.ts](../../../velara-web/src/features/audit/eventTypeIconMeta.test.ts)) requires **two** edits — the icon map AND the hand-maintained `ALL_EVENT_TYPES` array — and the mapping must be **non-default** (Task 7). 12.5 exists *because* new event types kept shipping without their icon entry and silently fell back to the `play` glyph. Do not split these across stories.

8. **AC8 — The FE Promote action is honest: it appears on `client_ready` skills, is grantor-gated, and tells the truth when promotion is not configured.**
   **Given** the skill detail action cluster ([SkillDetail.tsx:233-289](../../../velara-web/src/features/skills/components/SkillDetail.tsx#L233))
   **When** a grantor views a `client_ready` skill
   **Then** a **Promote** button renders beside Export, gated on **both** `isGrantor()` ([auth.ts:104](../../../velara-web/src/shared/utils/auth.ts#L104)) **and** `skill.lifecycle_state === 'client_ready'`, and on `PROMOTION_NOT_CONFIGURED` it surfaces a specific, non-alarming message — *"In-app promotion isn't enabled in this environment yet. Use **Export** and import the bundle into the target environment."* — with the Export action right there. It must NOT render a generic red error, and it must NOT pretend the promote succeeded. ⭐ Note the existing Export button is **NOT** client-side role-gated (it 404s for a consultant who clicks it — [SkillDetail.tsx:279-280](../../../velara-web/src/features/skills/components/SkillDetail.tsx#L279) admits this in a comment); do **not** copy that mistake into Promote. Use `<Icon>` — never emoji ([Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx)).

## Tasks / Subtasks

> **Scope + decisions locked at story creation (resolved with the Project Lead — do NOT re-litigate):**
>
> **(L1) THIS STORY DOES NOT BUILD THE CROSS-ENVIRONMENT TRANSPORT.** No HTTP call from one environment's API to another's. No VPC peering, no cross-account IAM, no target-environment URL registry, no Terraform. The epic AC is explicit: *"design + minimal seam this epic; full build deferred"*, and *"Export/Import (Story 11.4) is the Phase-1 mechanism ... in-app promote does not block this epic's close."* The ADR sequenced it deliberately: in-app promote *"needs cross-environment service identity, network reachability between isolated VPCs, and a trust model ... real infrastructure that touches the Epic 7 networking boundary."* **If you find yourself writing an `httpx` call to another environment, STOP — you have left this story.**
>
> **(L2) The headline deliverable is the ADR AMENDMENT, not the code.** The code is ~1 provider file + 1 route + 1 button. The *hard* part — and the reason this story exists at the end of the epic — is answering the three questions the ADR punted: **auth mechanism**, **promotable states**, **cross-env identity/topology**. AC1/AC2. Write it as an amendment to the existing `## Environment Promotion & Bundle Portability` section in [core-architectural-decisions.md](../../planning-artifacts/architecture/core-architectural-decisions.md) (lines 252-269), following that file's house ADR shape exactly: `**Context**` → `**Decision**` (numbered) → `**Why X not Y**` → `**Revisit trigger**` → `**Seams touched**`. Do not create a new `adr/` directory — this repo has none; every ADR is an `##` section in that one file.
>
> **(L3) ⭐ THE SYMMETRIC-KEY TRAP — the thing the ADR never saw.** `BUNDLE_SIGNING_KEY` is **symmetric HMAC-SHA256, per-environment** ([config.py:226-233](../../../velara-api/app/core/config.py#L226)). A bundle signed in dev verifies **only** where the same key is configured. So a naive Phase-2 promote has exactly two options and **both are wrong**: (a) *share one key across dev/staging/prod* → prod now trusts anything dev can mint, which **inverts** the trust-grading the ADR's entire Context paragraph is built on (staging/prod are BAA-gated *because* they are more trusted); (b) *keep per-env keys* → the target simply **cannot verify** a bundle the source signed, and promote is dead on arrival. The resolution to write into the ADR: **integrity and identity are different jobs.** The HMAC stays an integrity check performed by an environment **with its own key**; the *sender's identity* comes from the **transport** (cross-account IAM/SigV4 or an OIDC machine token), which is the "authenticated service-to-service call" the ADR already asked for but never specified. On landing, the target re-validates the content-address digest and re-signs with **its own** key. Say this explicitly, including *why* key-sharing is rejected — a future dev will otherwise "fix" the verify failure by sharing the key, and that is a security regression with a plausible-looking diff.
>
> **(L4) `client_ready` is TERMINAL-except-retire — promote is NOT a lifecycle transition.** `_ALLOWED_TRANSITIONS` ([skill_service.py:59-64](../../../velara-api/app/services/skill_service.py#L59)) allows `client_ready → {retired}` only. Do **not** add a `promoted` state, do **not** widen the transition map, do **not** call `transition_lifecycle` on the source. Promote *reads* a `client_ready` skill and ships its bytes; the source is unchanged. (And there is **no `certified` lifecycle state** — the states are `draft | internal_ready | client_ready | retired`; "certification" is a separate append-only `certification_records` table whose two-key completeness *gates* `internal_ready → client_ready`. Any code or prose saying "certified state" is wrong.)
>
> **(L5) Reuse the 11.4 envelope verbatim — write ZERO new serialization.** `export_skill_version(...)` already returns `(zip_bytes, envelope)` with a content-address digest and an HMAC signature, and already omits target-specific identifiers. The promote route calls it and hands the result to the seam. Do not invent a second format, a second digest, or a second signer. **Do not touch `skill_export.py`'s existing functions** beyond (if genuinely needed) *reading* them.
>
> **(L6) 11.4's `skill_export.py` has NOT had an adversarial code-review pass.** `sprint-status.yaml:206` marks 11-4 `done` and it **stays done — this story does not reopen it, does not fix it, and does not depend on fixing it.** But note for context: its story file header still reads `Status: review`, it carries no Review Findings section, and the sprint-log has no `code-review … → done` line for it (compare 11-6 / 11-7 / 12-5, which all do). So treat `skill_export.py` as *working but unreviewed*: **read it before you build on it, don't assume its edges were adversarially probed.** Anything you find that is genuinely broken → note it in `deferred-work.md`; do **not** silently absorb fixes into this story.

- [ ] **Task 1 — ⭐ ADR amendment: answer the three deferred Phase-2 questions (AC1, AC2, AC5, L2, L3) — `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md`**
  - [ ] Amend the existing `## Environment Promotion & Bundle Portability` section (lines 252-269). Keep the existing text; **append** a clearly-marked Phase-2 amendment block (e.g. `### Phase-2 in-app promote — the deferred design, resolved (added {date}, Story 11.5)`) so the Phase-1 record stays intact and the diff is legible.
  - [ ] **(a) Auth mechanism.** Specify the authenticated service-to-service call. Lead with the L3 finding: **HMAC = integrity, NOT identity.** Recommended decision to write up: the *transport* carries identity (cross-account **AWS SigV4 / IAM role assumption** between the source and target ECS task roles — the house is already all-AWS, Epic 7 owns the account/VPC boundary; an OIDC machine token is the alternative to name and reject-or-defer), while the HMAC stays a per-environment integrity check. Explicitly **reject key-sharing** and say why (it inverts the BAA trust-grading). Answer the epic's still-open question — **key rotation**: with per-env keys and re-signing on landing, rotation is a per-environment operation with no cross-env coordination, which is precisely why this shape is chosen.
  - [ ] **(b) Promotable lifecycle states.** The ADR never encodes a predicate. Write it: **`client_ready` only** (per the epic AC), stating the reasoning — a version becomes *referenceable* (certified/run/promoted) exactly at non-draft, and promotion is the act of moving a skill Vitalief has already two-key-certified *here*. Note that `export` deliberately has **no** such gate (any state is exportable — export is an operator escape hatch; promote is a governed act) and that this asymmetry is intentional, not an oversight.
  - [ ] **(c) Cross-environment identity + topology.** Which environment may promote to which. Recommend a **directed, non-cyclic** topology (`dev → staging → prod`), and state that prod is never a *source*. Specify how the target is named (a config-declared target registry per environment — **not** a caller-supplied URL, which would be an SSRF surface) and that the target authenticates the *source principal*, not the bundle.
  - [ ] **Restate the load-bearing rule for Phase 2 (AC5):** the promoted skill lands **`draft`, zero certification records copied**, target-env two-key certification re-runs. The ADR's existing revisit trigger already forbids the shortcut — carry that sentence forward verbatim so it cannot be lost.
  - [ ] **Correct an ADR/code drift while you're in there:** the ADR (line 260) says the signing key is *"per-environment, **from Secrets Manager**"*. In the shipped code it is a plain `Settings` field (`BUNDLE_SIGNING_KEY`, [config.py:226-233](../../../velara-api/app/core/config.py#L226)) whose own comment says it is *"**NOT** routed through SecretsProvider (reserved for per-skill connector creds fetched at execution time)"* — it is injected as an **env var** from Secrets Manager via the ECS task definition, mirroring `ANTHROPIC_API_KEY`. Both descriptions are *about* Secrets Manager, but the mechanism differs; say what the code actually does, since Phase 2's key handling builds directly on it.
  - [ ] Follow the house ADR shape (`Context` → numbered `Decision` → `Why X not Y` → `Revisit trigger` → `Seams touched`). This is a **planning-artifact edit** — it lands in the top-level docs repo commit, not a subrepo.

- [ ] **Task 2 — `PromotionProvider` seam (AC3, AC6) — NEW `velara-api/app/integrations/promotion.py`**
  - [ ] Model the file **exactly** on [auth.py](../../../velara-api/app/integrations/auth.py) / [secrets.py](../../../velara-api/app/integrations/secrets.py): a `Protocol` base, concrete impl(s), domain exceptions in the same module, and an `@lru_cache` factory. Structural typing — impls do **not** subclass the Protocol (see `DevAuthProvider`, [auth.py:294](../../../velara-api/app/integrations/auth.py#L294)).
  - [ ] `class PromotionProvider(Protocol)` with ONE method. Suggested shape — the payload is the 11.4 envelope, per L5:
    ```python
    async def promote(self, *, target_environment: str, zip_bytes: bytes, envelope: dict) -> PromotionResult: ...
    ```
    `PromotionResult` = a frozen dataclass in the same module (mirror `AuthPrincipal`, [auth.py:36](../../../velara-api/app/integrations/auth.py#L36)) carrying at minimum the target env + the remote skill id (`str | None` — unknown until Phase 2 actually returns one).
  - [ ] `class DisabledPromotionProvider:` — **the only impl this story ships.** `promote()` raises `PromotionNotConfiguredError`. Docstring must say: *the seam exists so Phase 2 adds a `RemotePromotionProvider` and flips `PROMOTION_BACKEND` — no call site changes.* Do **not** ship a `RemotePromotionProvider` skeleton full of `pass`/`NotImplementedError` bodies; an empty class invites someone to "just finish it." The Protocol **is** the contract.
  - [ ] `class PromotionNotConfiguredError(VelaraHTTPException)` → `ERROR_CODE = "PROMOTION_NOT_CONFIGURED"`, **422**, IP-safe detail ("In-app promotion is not configured in this environment. Use export/import."). Mirror the 11.4 error classes ([skill_export.py:64-112](../../../velara-api/app/services/skill_export.py#L64)) — they are rendered by the global handler, so **no API-layer wiring is needed**.
  - [ ] `@lru_cache(maxsize=1) def get_promotion_provider() -> PromotionProvider` branching on `settings.PROMOTION_BACKEND`. Mirror [auth.py:773-791](../../../velara-api/app/integrations/auth.py#L773). With `"remote"` selected but unimplemented, **raise a clear config error at factory time** — never fall through to `Disabled` (a silent downgrade would make a misconfigured prod look "working").

- [ ] **Task 3 — Config selector (AC3) — `velara-api/app/core/config.py`**
  - [ ] Add `PROMOTION_BACKEND: Literal["disabled", "remote"] = "disabled"` in the **provider-backend-selectors** block (lines 52-66, beside `AUTH_BACKEND`/`STORAGE_BACKEND`/`SECRETS_BACKEND`), with the house comment style.
  - [ ] **Do NOT add it to `_reject_insecure_defaults_outside_dev`** ([config.py:265](../../../velara-api/app/core/config.py#L265)). `disabled` is the correct, safe value in **every** environment today — including prod. That guard is for values that are *insecure* outside dev (`AUTH_BACKEND=dev`, an empty `BUNDLE_SIGNING_KEY`); `PROMOTION_BACKEND=disabled` is neither insecure nor a placeholder. Adding it there would **brick every staging/prod boot** on a feature that does not exist yet. If you feel the urge, re-read this bullet.

- [ ] **Task 4 — DI alias (AC3) — `velara-api/app/core/dependencies.py`**
  - [ ] Add the thin wrapper + `Annotated` alias beside the existing ones ([dependencies.py:42-51,83-87](../../../velara-api/app/core/dependencies.py#L42)):
    ```python
    def _promotion() -> PromotionProvider:
        return get_promotion_provider()

    Promotion = Annotated[PromotionProvider, Depends(_promotion)]
    ```
    Pure DI, no per-request logic — copy the `SkillStorage`/`Secrets`/`Llm` shape, not the `get_current_user` shape.

- [ ] **Task 5 — `POST /api/v1/skills/{skill_id}/promote` (AC4, AC5, AC6, AC7) — `velara-api/app/api/v1/skills.py`**
  - [ ] Add beside the 11.4 export/import section (line 150+). Mirror `export_skill` ([skills.py:155-196](../../../velara-api/app/api/v1/skills.py#L155)) — same decorator shape, `dependencies=[RejectNonGrantor]` (the router already carries `RejectClient`, [skills.py:51](../../../velara-api/app/api/v1/skills.py#L51)).
  - [ ] Request body `SkillPromoteRequest` (NEW, `app/schemas/skill.py`, beside `SkillImportRequest` at line 273): `target_environment: str` + optional `version: str | None = None` (mirror export's optional version). **Constrain `target_environment` to the `Environment` enum** ([config.py:22](../../../velara-api/app/core/config.py#L22)) — it is **never** a free-form URL (that would be an SSRF surface; the target is resolved from config, per Task 1c).
  - [ ] Response `SkillPromoteResponse` (NEW): target env + a promoted-skill reference (nullable) + the `content_address_digest`. Wrap in `ResponseEnvelope[...]` like every other route.
  - [ ] **Ordering is load-bearing (AC4)** — enforce, in this exact order, and **reject before the provider is consulted**:
    1. `skill_service.get_skill(session, skill_id, org_id=user.org_id)` → org-scoped, 404 cross-org (already `selectinload`s `.versions`, [skill_service.py:889](../../../velara-api/app/services/skill_service.py#L889)).
    2. **`if skill.lifecycle_state != "client_ready": raise SkillNotPromotableError(...)`** → NEW, 422 `SKILL_NOT_PROMOTABLE`. ⭐ Genuinely new — `export_skill_version` has **zero** lifecycle checks.
    3. Reject a `target_environment` equal to the current `settings.ENVIRONMENT` → 422 (promoting to yourself is a no-op / a mistake worth naming).
    4. `skill_export.export_skill_version(...)` → the `(zip_bytes, envelope)` payload (L5 — reuse, don't rebuild).
    5. `await promotion.promote(target_environment=..., zip_bytes=..., envelope=...)` → today always raises `PROMOTION_NOT_CONFIGURED` (422).
  - [ ] **Audit (AC7) — ⚠️ the canonical block is SUCCESS-PATH-ONLY and must be ADAPTED, not copied verbatim.** AC7 requires the **attempt** to be audited *including* the `PROMOTION_NOT_CONFIGURED` outcome — but step 5 **raises**, so a post-call audit block placed after `promote()` (the shape at [skill_service.py:1029-1048](../../../velara-api/app/services/skill_service.py#L1029)) would **never execute** on the 422 path: the exception propagates straight out of the route. Copying it verbatim ships a route whose own Task-8 integration test fails. **Wrap the call instead** — audit on both paths, re-raise on the failure path:
    ```python
    outcome = "success"
    try:
        result = await promotion.promote(target_environment=..., zip_bytes=..., envelope=...)
    except PromotionNotConfiguredError:
        outcome = "not_configured"
        await _audit_promote(..., outcome=outcome)   # best-effort, its own try/except
        raise                                        # ← the 422 still reaches the caller
    await _audit_promote(..., outcome=outcome)
    ```
    The *inner* audit helper keeps the canonical best-effort shape (`try/except Exception` + `logger.warning`, never rolls back the request). Metadata: `{"skill_id", "version", "source_environment", "target_environment", "content_address_digest", "outcome"}` — **IDs, env names, and hashes only; never artifact bytes**. An operator *attempting* a promote is itself the audit-worthy act (and Epic 13's whole thesis is that failed/attempted actions go unrecorded — don't add another).
  - [ ] Attribute to **the caller** — the `CurrentUser` principal, i.e. `user.user_id` (`AuthPrincipal`, [auth.py:36](../../../velara-api/app/integrations/auth.py#L36); confirm the exact field name when you open it). ⚠️ **Do NOT** attribute to `skill.created_by_user_id` — that is precisely the 11.4 export-audit defect flagged in Dev Notes ([skill_export.py:247](../../../velara-api/app/services/skill_export.py#L247)).
  - [ ] `EVENT_ADMIN_SKILL_PROMOTED = "admin.skill_promoted"` → add to [audit.py](../../../velara-api/app/models/audit.py) beside the other `EVENT_ADMIN_*` constants (~line 61-78). **No migration** — `event_type` is a free-form `String` column.
  - [ ] **api-spec.json WILL diff** — the new route + 2 new schemas. Regenerate on the **host venv** (`AUTH_BACKEND=dev .venv/bin/python scripts/export_openapi.py`) — `docker compose run api` has **no bind mount**, so an in-container regen writes nowhere useful (11.4 lesson). Confirm the diff is **additive only**.

- [ ] **Task 5b — ⭐ REGISTER the new route in the 12.5 audit-coverage guard (AC4, AC7) — `velara-api/tests/unit/test_audit_coverage_guard.py`**
  - [ ] **This is a HARD CI GATE, not a nicety — skip it and the build goes red.** Story 12.5 shipped a guard that walks the **live app's route table** for every non-GET/HEAD/OPTIONS `(method, path)` and asserts each one has an entry in a **hand-maintained `REGISTRY`** dict. `test_every_mutating_route_is_registered` computes `live_routes - set(REGISTRY.keys())` and **fails on any unregistered mutating route** — by design, "the registry cannot be 'completed' by only listing routes someone already remembered to add."
  - [ ] Add the entry beside the 11.4 ones ([test_audit_coverage_guard.py:51-52](../../../velara-api/tests/unit/test_audit_coverage_guard.py#L51)):
    ```python
    ("POST", "/api/v1/skills/{skill_id}/promote"): {"audited": "EVENT_ADMIN_SKILL_PROMOTED"},
    ```
    The path string must match FastAPI's registered route path **exactly** (templated param names included) or `test_registry_has_no_stale_entries` fires instead.
  - [ ] `test_registry_integrity` additionally asserts the referenced constant **exists in `app.models.audit`** and its value **starts with `"admin."`** — so Task 5's `EVENT_ADMIN_SKILL_PROMOTED = "admin.skill_promoted"` must land *with* this entry. Entries must set **exactly one** of `audited` / `exempt` — never both, never neither.

- [ ] **Task 6 — FE: honest Promote action (AC8) — `velara-web/src/api/skills.ts` + `hooks/useSkills.ts` + `components/SkillDetail.tsx`**
  - [ ] `src/api/skills.ts`: add `promoteSkill(skillId, targetEnvironment, version?)` → `POST /api/v1/skills/{id}/promote`. Mirror `exportSkill` ([skills.ts:239](../../../velara-web/src/api/skills.ts#L239)).
  - [ ] `hooks/useSkills.ts`: add `usePromoteSkill()` mutation. Mirror `useImportSkill` ([useSkills.ts:125](../../../velara-web/src/features/skills/hooks/useSkills.ts#L125)).
  - [ ] `SkillDetail.tsx`: add a **Promote** button to the action cluster ([lines 233-289](../../../velara-web/src/features/skills/components/SkillDetail.tsx#L233)), immediately after Export. **Double-gate it:** `{isGrantor() && skill.lifecycle_state === 'client_ready' && ( ... )}`. Import `isGrantor` from [`@/shared/utils/auth`](../../../velara-web/src/shared/utils/auth.ts#L104) — this is the **first** use of `isGrantor()` in the skills feature; the existing Export button is deliberately NOT gated and 404s for consultants ([SkillDetail.tsx:279-280](../../../velara-web/src/features/skills/components/SkillDetail.tsx#L279) says so in a comment). **Do not copy that.**
  - [ ] Target-environment choice: a minimal control (a `<select>` of the non-current environments) — reuse the `VersionSelector`-style inline pattern from [RunConsole.tsx](../../../velara-web/src/features/run/components/RunConsole.tsx). Do **not** build a modal for this; a modal is 11.4's Import shape and is heavier than a 2-option picker warrants.
  - [ ] **The honest error (AC8's point):** on `PROMOTION_NOT_CONFIGURED`, render a **neutral informational** message (not a red failure): *"In-app promotion isn't enabled in this environment yet. Use **Export** and import the bundle into the target environment."* Use the `getApiCode(err)` → curated-copy pattern 11.4 established (`IMPORT_ERROR_MESSAGES`, [SkillRegistry.tsx:15-33](../../../velara-web/src/features/skills/components/SkillRegistry.tsx#L15)). Every other error falls through to `getErrorMessage(err)`.
  - [ ] `<Icon>` only — never emoji. `upload` / `arrow-up` (whichever exists) — **check [Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx) first**; if no suitable glyph exists, add one there rather than reaching for a unicode character.

- [ ] **Task 7 — FE audit icon mapping — TWO files, both mandatory (AC7) — `velara-web/src/features/audit/`**
  - [ ] ⭐ **This is a HARD CI GATE. Story 12.5's completeness test WILL fail if you add the BE event constant (Task 5) and skip either half of this task.** It exists precisely because 11.3/11.4 shipped event types with no icon entry and they silently fell back to the `play` glyph.
  - [ ] **(1) `eventTypeIconMeta.ts`** — add `'admin.skill_promoted': { icon: '<icon>', colorClass: '<class>' }` beside the 11.4 entries ([eventTypeIconMeta.ts:33-34](../../../velara-web/src/features/audit/eventTypeIconMeta.ts#L33)). ⚠️ The mapping **must be non-default**: the test asserts every event type resolves to something *other* than `DEFAULT_META = { icon: 'play', colorClass: 'text-brand-600' }` (`invocation.success` is the one whitelisted exception). Picking `play`/`text-brand-600` fails with `"...resolves to the DEFAULT_META fallback (play) — add a real map entry"`.
  - [ ] ⚠️ **PICK A DISTINCT `(icon, colorClass)` PAIR — the obvious choice is already taken.** The same file has a **collision test** (Story 12.3 — distinct icons per event type), and `'admin.skill_imported'` **already owns `{ icon: 'upload', colorClass: 'text-brand-700' }`**. Reusing that pair (the natural pick, since Task 6 also reaches for `upload`) **will fail the collision test** unless added to `KNOWN_SHARED_GROUPS` — don't do that; promotion is a distinct act and deserves a distinct glyph. Check [Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx) for a free glyph (`upload`/`download` exist; add a new one there if nothing fits — never a unicode/emoji character).
  - [ ] **(2) `eventTypeIconMeta.test.ts`** — add `'admin.skill_promoted'` to the **hand-maintained `ALL_EVENT_TYPES` array** ([eventTypeIconMeta.test.ts:9-31](../../../velara-web/src/features/audit/eventTypeIconMeta.test.ts#L9)). ⭐ **This array is NOT auto-derived, and this is the subtle trap:** it is a hardcoded TS list (its own comment: *"Kept here (not imported) because the FE cannot import the Python constants … this list IS the completeness contract, and a maintained duplicate is the honest mechanism"*). So the FE guard is **opt-in** — if you add the BE constant and touch neither FE file, **the FE suite stays green** and the new event silently renders the `play` fallback: *exactly* the 11.3/11.4 bug 12.5 existed to kill, reintroduced. The guard only protects you if you enlist in it. Source of truth for this list = `velara-api/app/models/audit.py`'s `EVENT_*` block.

- [ ] **Task 8 — Tests (AC: all)**
  - [ ] **BE unit — the seam (`tests/unit/integrations/test_promotion.py`, NEW):** `get_promotion_provider()` returns `DisabledPromotionProvider` when `PROMOTION_BACKEND=disabled`; `DisabledPromotionProvider.promote(...)` raises `PromotionNotConfiguredError` with code `PROMOTION_NOT_CONFIGURED` / 422; the factory raises a clear config error (does **not** silently return `Disabled`) when `PROMOTION_BACKEND=remote`. **Clear the `@lru_cache` between tests** — `get_promotion_provider.cache_clear()` (the other provider factories are cached the same way; a stale cached provider across tests is a classic false green).
  - [ ] **BE integration (`tests/integration/api/test_skills.py`, EXTEND):**
    - `client_ready` skill + grantor + valid target → **422 `PROMOTION_NOT_CONFIGURED`** (the honest terminal state today). ⭐ This is the story's real integration assertion.
    - `draft` / `internal_ready` / `retired` skill → **422 `SKILL_NOT_PROMOTABLE`**, and assert the provider was **never called** (the gate fires first — AC4's ordering). ⚠️ **Spy it via `app.dependency_overrides[_promotion] = lambda: spy`** — patching `get_promotion_provider` will NOT work, it is `@lru_cache`d *and* already resolved through `Depends(_promotion)`. Override the **dependency function** (`_promotion`, from `core/dependencies.py`), and clear the override in teardown. Getting this wrong yields a false green.
    - `target_environment` == current environment → 422.
    - consultant → **404** (per-route `RejectNonGrantor`); client → **404** (router `RejectClient`).
    - cross-org skill → **404** (org-scoped `get_skill`).
    - the audit event is written on the attempt (assert an `admin.skill_promoted` row with `user_id` == **the caller**, and the `PROMOTION_NOT_CONFIGURED` outcome in metadata).
    - **the source skill's `lifecycle_state` is UNCHANGED after a promote attempt** (AC5 — promote is not a transition; lock it with a regression test).
  - [ ] **FE (`SkillDetail.test.tsx`, EXTEND):** Promote renders for a grantor on a `client_ready` skill; **hidden** for a non-grantor (mock `isGrantor()`); **hidden** on a `draft`/`internal_ready`/`retired` skill; `PROMOTION_NOT_CONFIGURED` renders the informational "use Export" copy (**not** a red error); `promoteSkill` client shape (`skills.test.ts`).
  - [ ] **⭐ FE mock hygiene (the 11.4 → 11.7 lesson, twice-burned):** every test that mocks `@/api/skills` or `@/features/skills/hooks/useSkills` must be updated with the NEW `promoteSkill` / `usePromoteSkill` exports — a **partial factory mock missing a new export breaks unrelated suites**. 11.4 shipped this bug (`routes/internal.test.tsx`'s `useSkills` mock was missing `useImportSkill`); 11.7 hit the identical class with `useSkillVersions`. **Grep `vi.mock('@/api/skills'` and `vi.mock('@/features/skills/hooks/useSkills'` and fix EVERY hit** — do not assume the one you're editing is the only one.

- [ ] **Task 9 — Gates**
  - [ ] **Backend:** `docker compose build api` then `docker compose run --rm -e AUTH_BACKEND=dev api python -m pytest`. Baseline = 12.5's post-dev number (**1322 passed**); the 3 known pre-existing `test_ingest.py` MinIO-hostname failures are **acceptable and NOT CI blockers** (localhost ≠ minio inside the container network for this run mode). `ruff check .` clean.
  - [ ] **api-spec:** regenerate on the **host venv** (`AUTH_BACKEND=dev .venv/bin/python scripts/export_openapi.py`); expect an **additive-only** diff = the new promote route + `SkillPromoteRequest`/`SkillPromoteResponse`. Update the [`test_openapi.py`](../../../velara-api/tests/integration/api/test_openapi.py) spec-lock if it asserts an exact route/field set.
  - [ ] **NO migration.** `event_type` is a free-form `String`; `PROMOTION_BACKEND` is a `Settings` env var; no model, no column, no table. **If a migration seems necessary, STOP and re-read this constraint** — you have almost certainly drifted into building the Phase-2 transport (L1).
  - [ ] **FE:** `npm run typecheck` (0) / `npm run lint` (baseline: 1 pre-existing `Icon.tsx` warning) / `npm run test` (vitest — baseline **654 passed**; record the new number).
  - [ ] **Operator-owed, NOT built here** (no live TF apply from dev-story — the 9.3 lesson): nothing new. `PROMOTION_BACKEND` defaults to `disabled` everywhere and needs no provisioning. ⚠️ **Carry-forward from 11.4, still open:** staging/prod need `BUNDLE_SIGNING_KEY` in Secrets Manager + the ECS task-def, or **they will refuse to boot** (the `_reject_insecure_defaults_outside_dev` guard lists it). That is 11.4's debt, not this story's — but it is the thing that would bite an operator who deploys this epic.

## Dev Notes

### Why this story's real work is an ADR, not a feature

Read AC1 twice. The epic AC says *"the architecture for the authenticated service-to-service cross-environment copy **is specified (ADR)**"* — phrased as if the specification already exists and this story merely lands a stub against it. **It does not exist.** The ADR ([core-architectural-decisions.md:252-269](../../planning-artifacts/architecture/core-architectural-decisions.md)) is real, is good, and answers Phase 1 completely — but on Phase 2 it says exactly this much:

> *"The Phase-2 path replaces download/upload with an **authenticated service-to-service call** from the source environment's API to the target's, carrying the same signed content-addressed payload."*

That is the whole treatment. It names no auth mechanism, encodes no promotable-state predicate, and defines no cross-environment identity — and it says so, deliberately: *"Phase 1 ships export/import as the working mechanism so promotion is unblocked **without waiting on cross-environment networking + identity**."* The sprint-change-proposal that commissioned the ADR asked for all three by name (*"the Phase-2 in-app service-to-service promote path (auth, which lifecycle states are promotable, cross-env identity)"*), and the epic still lists key rotation as an **Open Question**. So the design work was scoped, deferred, and never done. **This story does it.** The stub is the easy half.

### ⭐ The symmetric-key trap (L3) — the trap the ADR itself walked past

This is the single most important thing in this story, and it is invisible from the epic:

`BUNDLE_SIGNING_KEY` is **symmetric HMAC-SHA256**, **per-environment** ([config.py:226-233](../../../velara-api/app/core/config.py#L226); `_sign`/`_verify` at [skill_export.py:118-135](../../../velara-api/app/services/skill_export.py#L118)). The 11.4 story locked this deliberately (its L2: *"NOT JWT/asymmetric"*) and it was the right call **for a file an operator carries by hand** — the operator *is* the identity.

Take the human out of the loop and that breaks. An HMAC proves *"someone holding this key produced these bytes."* It does **not** prove *who*. So a service-to-service promote has two naive options:

- **Share one key across environments** → the target can now verify. But **any** environment holding the key can mint a bundle **indistinguishable** from any other's. Prod would trust anything dev can produce — which **inverts the trust-grading the ADR's own Context paragraph rests on** (`terraform/README.md` gates staging/prod behind a signed BAA *because they are more trusted*). This is a security regression that arrives as a one-line config change and looks like a bug fix.
- **Keep per-env keys** → the target **cannot verify** the source's signature at all. Promote is dead on arrival.

The way out is to stop asking one primitive to do two jobs: **integrity ≠ identity.**
- **Identity** comes from the **transport** — a genuine cross-environment principal (cross-account **AWS SigV4 / IAM role assumption** between ECS task roles; or an OIDC machine token). This *is* the "authenticated service-to-service call" the ADR asked for and never specified.
- **Integrity** stays the HMAC — but each environment signs and verifies **with its own key**. The target re-validates the content-address digest (which is key-independent — `sha256` over sorted `(path, sha256)` pairs, [skill_service.py:324](../../../velara-api/app/services/skill_service.py#L324)) and **re-signs on landing** with its own key.

**Write the rejection of key-sharing into the ADR explicitly**, with the reason. Otherwise a future dev debugging a `BUNDLE_SIGNATURE_INVALID` across environments will "fix" it by sharing the key, the diff will look trivially correct, and the BAA trust boundary will be gone.

### There is no `certified` state — and `client_ready` is terminal

Two facts that invalidate the most natural-sounding wrong implementations:

1. **The lifecycle enum is `draft | internal_ready | client_ready | retired`** ([skill.py:55-57](../../../velara-api/app/models/skill.py#L55), [schemas/skill.py:25](../../../velara-api/app/schemas/skill.py#L25)). There is **no `certified` state.** "Certification" is a separate **append-only** `certification_records` table ([certification.py:26-83](../../../velara-api/app/models/certification.py#L26)) whose two-key completeness (one `technical` + one `methodological`, unique per **version**) *gates* the `internal_ready → client_ready` transition. Prose or code saying "a certified skill" means *a skill in `client_ready`*.
2. **`client_ready` is terminal-except-retire** — `_ALLOWED_TRANSITIONS` is `{"client_ready": {"retired"}}` ([skill_service.py:59-64](../../../velara-api/app/services/skill_service.py#L59)). So **promote cannot be modeled as a lifecycle transition**, and there is no state to move the source *to*. Promote is an **export-shaped read** of a `client_ready` skill: the source is untouched. Do not add a `promoted` state; do not widen the map; do not call `transition_lifecycle`. AC5 locks this and a regression test enforces it.

### Promote vs Export — the deliberate asymmetry (don't "fix" it)

`export_skill_version` has **no lifecycle gate whatsoever** — you can export a `draft` today ([skill_export.py:141](../../../velara-api/app/services/skill_export.py#L141)). Promote **must** gate on `client_ready` (epic AC + AC4). That asymmetry is **intentional** and worth stating in the ADR so nobody "harmonizes" them later:

- **Export** is an operator escape hatch — a human downloads a file and takes responsibility for what they do with it. Gating it would break legitimate workflows (backing up a draft, moving WIP between dev machines).
- **Promote** is a **governed act** — the platform itself pushes a skill into a more-trusted environment. It should only do that for something Vitalief has already two-key-certified *here*.

Do **not** add a lifecycle gate to export as a drive-by "consistency" fix. Different acts, different rules.

### The audit-attribution trap (learn from 11.4, don't inherit it)

11.4's export audit event is written with `user_id=skill.created_by_user_id` ([skill_export.py:248](../../../velara-api/app/services/skill_export.py#L248)) — **the skill's creator, not the operator who ran the export.** So an export by operator B of a skill created by operator A is attributed to **A**. For an audit event whose entire purpose is *"who did this thing"*, that is wrong.

**Promote must attribute to the caller: `user_id=user.user_id`.** Given Epic 13's whole thesis is that the audit log doesn't record who did what, do not ship a third event with the same defect. (11.4 stays `done` — this is a note about *your* new code, not a mandate to go fix its code.)

### 11.4 is `done`, but `skill_export.py` was never adversarially reviewed (L6)

`sprint-status.yaml:206` marks 11-4 `done` and **it stays done — this story neither reopens nor fixes it.** Context only, so you calibrate your trust: 11-4's story file header still reads `Status: review`, it has no Review Findings section, and the sprint-log carries no `code-review … → done` line for it (11-6, 11-7, and 12-5 all do, with detailed findings). Every other Epic-11 story went `review → code-review → done`.

Practical consequence: **read `skill_export.py` before building on it.** Its edges have not been probed by a hostile reader the way 11.6's and 11.7's were. You are *reusing* `export_skill_version` (L5), not modifying it — so this is a "know what you're standing on" note, not a work item. Anything genuinely broken that you trip over → record it in `deferred-work.md` and keep going.

### Reuse map — do NOT reinvent

| Need | Reuse |
|---|---|
| Provider-seam shape (Protocol + impls + `@lru_cache` factory + `Annotated` DI alias) | `AuthProvider` ([auth.py:154,294,491,773](../../../velara-api/app/integrations/auth.py#L154)) — the closest analogue (dev impl + cloud impl). Also `SecretsProvider` ([secrets.py:42,54,69,96](../../../velara-api/app/integrations/secrets.py#L42)), `StorageProvider` ([storage.py:24,77,188](../../../velara-api/app/integrations/storage.py#L24)) |
| Frozen-dataclass provider contract | `AuthPrincipal` ([auth.py:36](../../../velara-api/app/integrations/auth.py#L36)) — the shape for `PromotionResult` |
| Config backend selector | `AUTH_BACKEND` / `STORAGE_BACKEND` / `SECRETS_BACKEND` `Literal`s ([config.py:52-66](../../../velara-api/app/core/config.py#L52)) |
| DI alias (pure, no per-request logic) | `SkillStorage` / `Secrets` / `Llm` ([dependencies.py:42-51,83-87](../../../velara-api/app/core/dependencies.py#L42)) |
| 422 typed error (rendered by the global handler — no API wiring) | the 11.4 error classes ([skill_export.py:64-112](../../../velara-api/app/services/skill_export.py#L64)) |
| **The promote payload** (signed, content-addressed, no target-specific ids) | `export_skill_version(...) -> (zip_bytes, envelope)` ([skill_export.py:141](../../../velara-api/app/services/skill_export.py#L141)) — **reuse verbatim, write zero new serialization** |
| Content-address digest (key-independent, reorder-stable) | `_compute_bundle_record` ([skill_service.py:324](../../../velara-api/app/services/skill_service.py#L324)) |
| Org-scoped skill fetch (404 cross-org, eager-loads `.versions`) | `get_skill` ([skill_service.py:889](../../../velara-api/app/services/skill_service.py#L889)) |
| Route shape to mirror (grantor-gated, optional `?version=`) | `export_skill` ([skills.py:155-196](../../../velara-api/app/api/v1/skills.py#L155)) |
| Grantor gate (BE) | per-route `RejectNonGrantor` ([dependencies.py:231](../../../velara-api/app/core/dependencies.py#L231); `_GRANTOR_ROLES` frozenset ~[:123](../../../velara-api/app/core/dependencies.py#L123)) + router `RejectClient` ([skills.py:51](../../../velara-api/app/api/v1/skills.py#L51)) |
| Best-effort admin audit (post-commit, never rolls back) | `record_admin_action` ([audit_service.py:260](../../../velara-api/app/services/audit_service.py#L260)); canonical call site [skill_service.py:1027-1051](../../../velara-api/app/services/skill_service.py#L1027) |
| FE grantor gate | `isGrantor()` ([auth.ts:104](../../../velara-web/src/shared/utils/auth.ts#L104)) — component-level `{isGrantor() && ...}` pattern |
| FE curated error copy by API code | `IMPORT_ERROR_MESSAGES` + `getApiCode(err)` ([SkillRegistry.tsx:15-33](../../../velara-web/src/features/skills/components/SkillRegistry.tsx#L15)) |
| FE mutation hook | `useImportSkill` ([useSkills.ts:125](../../../velara-web/src/features/skills/hooks/useSkills.ts#L125)) |
| FE action-cluster placement | `SkillDetail.tsx` action row ([lines 233-289](../../../velara-web/src/features/skills/components/SkillDetail.tsx#L233)) |
| Icons (never emoji) | `<Icon>` ([Icon.tsx](../../../velara-web/src/shared/components/Icon.tsx)) |

### Error-code map

| Code | HTTP | Meaning | Source |
|---|---|---|---|
| `PROMOTION_NOT_CONFIGURED` | 422 | in-app promotion has no transport in this environment (**the terminal state for every valid request today**) | **NEW** — `DisabledPromotionProvider` |
| `SKILL_NOT_PROMOTABLE` | 422 | skill is not `client_ready` | **NEW** — the route gate (AC4) |
| — | 404 | cross-org skill / consultant / client | existing `get_skill` + `RejectNonGrantor` + `RejectClient` |

### IP / PHI discipline (house invariants)

- The promote payload **is** the 11.4 export envelope, whose boundary the ADR already fixed: *"if it isn't the skill itself, it isn't in the bundle"* — skill artifact + manifest + schemas + metadata, and **never** any invocation input, output, document reference, or run history. Reusing `export_skill_version` (L5) inherits that assertion for free. **Do not widen it.**
- Audit metadata = **IDs, environment names, and hashes only**. Never artifact bytes, never envelope field *values*.
- Error details must be IP-safe — mirror the 11.4 error strings, which deliberately never echo bytes or S3 keys.

### Sequencing / dependencies

- Epic order: 11.1 ✅ → 11.2 ✅ → 11.6 ✅ → 11.3 ✅ → 11.9 ✅ → 11.4 ✅ → 11.7 ✅ → **11.5** (deliberately LAST — the epic scoped it as the Phase-2 design + stub, and its AC explicitly states it "does not block this epic's close").
- **Depends on 11.4** (done) — reuses `export_skill_version` + the signed envelope. No other code dependency.
- Epic 11 is already `in-progress`; this is not the first story → **no epic-status flip needed.** This is the **final Epic 11 story** — after it, `epic-11-retrospective` (currently `optional`) is the only remaining entry.
- **Interacts with Story 12.5** — the FE audit-icon completeness test 12.5 added **will fail** if Task 5's BE event constant lands without Task 7's FE icon entry. They are one change.

### Project Structure Notes

- **_bmad-output (docs repo — the ONLY repo dev-story commits):** MODIFY `planning-artifacts/architecture/core-architectural-decisions.md` (⭐ the ADR amendment — Task 1, the headline).
- **velara-api:** NEW `app/integrations/promotion.py` (`PromotionProvider` Protocol + `DisabledPromotionProvider` + `PromotionNotConfiguredError` + `get_promotion_provider`); MODIFY `app/core/config.py` (`PROMOTION_BACKEND` selector — **not** in the boot-guard); MODIFY `app/core/dependencies.py` (`Promotion` DI alias); MODIFY `app/api/v1/skills.py` (`POST /{skill_id}/promote`); MODIFY `app/schemas/skill.py` (`SkillPromoteRequest`/`SkillPromoteResponse`); MODIFY `app/models/audit.py` (`EVENT_ADMIN_SKILL_PROMOTED`); ⭐ MODIFY `tests/unit/test_audit_coverage_guard.py` (**register the new route — hard CI gate**, Task 5b); NEW `tests/unit/integrations/test_promotion.py`; EXTEND `tests/integration/api/test_skills.py`; REGENERATE `docs/api-spec.json`. **No new model, no migration.**
- **velara-web:** MODIFY `src/api/skills.ts` (`promoteSkill`); MODIFY `src/features/skills/hooks/useSkills.ts` (`usePromoteSkill`); MODIFY `src/features/skills/components/SkillDetail.tsx` (double-gated Promote button + target-env picker + honest not-configured copy); ⭐ MODIFY **both** `src/features/audit/eventTypeIconMeta.ts` (the non-default `admin.skill_promoted` mapping) **and** `src/features/audit/eventTypeIconMeta.test.ts` (the hand-maintained `ALL_EVENT_TYPES` array) — **hard CI gate**, Task 7; EXTEND `SkillDetail.test.tsx` / `skills.test.ts`; **fix every `vi.mock('@/api/skills'` and `vi.mock('.../useSkills'` factory** for the new exports.
- ⚠️ **Repo discipline** ([memory: never-push-subrepos]): `velara-api` and `velara-web` are **separate nested git repos**. `dev-story` commits **only** the top-level `_bmad-output/` docs repo; the subrepos are committed by `code-review`, post-review. Also: `cd`-ing into a subrepo shifts the Bash cwd — `cd` back before running docs-publish git commands.
- `api-spec.json` WILL diff (new route + 2 schemas) — expected; confirm it is **only** that.

### References

- [Source: epics/epic-11-ai-assisted-skill-integration-and-promotion.md#Story-11.5] — the ACs ("Phase-2 target — design + minimal seam this epic; full build deferred"; "**Given** a `client_ready` skill … the promote action is available"; "Export/Import (Story 11.4) is the Phase-1 mechanism — in-app promote does not block this epic's close"), the dependency table (11.5 depends on 11.4), the 3-ADR gate, and the still-**open** question on signing-key rotation.
- [Source: planning-artifacts/architecture/core-architectural-decisions.md:252-269] — ⭐ the governing ADR (`## Environment Promotion & Bundle Portability`). Item 4 = the entire Phase-2 treatment ("an authenticated service-to-service call", three sentences). The revisit trigger's hard prohibition ("Never add a 'promote already-certified as certified' shortcut"). The trust-grading Context (staging/prod BAA-gated via `terraform/README.md`) that the symmetric-key trap would invert. **This file is what Task 1 amends.**
- [Source: planning-artifacts/sprint-change-proposal-2026-07-06.md] — the ADR commissioning line: *"the Phase-2 in-app service-to-service promote path (**auth, which lifecycle states are promotable, cross-env identity**, why trust does not copy across envs)"* — the three questions Task 1 answers. Also R3 ("No environment promotion / export / import exists at all") and the risk sizing (in-app promote = "Deferred build").
- [Source: _bmad-output/implementation-artifacts/stories/11-4-export-import-portable-skill-bundles.md] — the direct dependency. Its L1 ("in-app service-to-service promote is Story 11.5 — design + stub, NOT built here"), L2 (signing = symmetric HMAC, per-env `Settings` key, "NOT JWT/asymmetric" — the decision that becomes this story's central problem), L4 (import lands `draft`, copies zero certification rows — "trust does not copy"). Its FE-mock-hygiene lesson.
- [Source: velara-api app/core/config.py:22,47,52-66,226-233,265,301-306] — `Environment` enum (`dev|staging|prod`), the existing `ENVIRONMENT` setting, the provider-selector block (where `PROMOTION_BACKEND` goes), `BUNDLE_SIGNING_KEY` (⭐ symmetric, per-env), and `_reject_insecure_defaults_outside_dev` (**which `PROMOTION_BACKEND` must NOT be added to**).
- [Source: velara-api app/integrations/auth.py:36,154,294,491,773-791] — the canonical provider seam to copy: `AuthPrincipal` frozen dataclass, `AuthProvider(Protocol)`, `DevAuthProvider`/`CognitoAuthProvider` (structural typing, no subclassing), `@lru_cache` factory branching on the config `Literal`.
- [Source: velara-api app/integrations/secrets.py:42,54,69,96] / [app/integrations/storage.py:24,77,188] — the two sibling seams (Protocol + impls + cached factory).
- [Source: velara-api app/core/dependencies.py:42-51,83-87,123] — the `Annotated[..., Depends(...)]` DI aliases (`SkillStorage`/`Secrets`/`Llm`) and `_GRANTOR_ROLES`/`RejectNonGrantor`.
- [Source: velara-api app/services/skill_export.py:64-112,118-135,141-268,270-447] — the 11.4 module: the four 422 error classes (the shape to mirror), `_sign`/`_verify`/`_canonical_envelope_bytes` (⭐ symmetric HMAC), `export_skill_version` (**the payload to reuse; note it has NO lifecycle gate**), `import_skill_bundle` (lands `draft`, zero certs). ⚠️ Its export audit attributes to `skill.created_by_user_id` — **do not copy** (line 248).
- [Source: velara-api app/services/skill_service.py:59-64,324-349,889,973-1053,1027-1051,1498-1526] — `_ALLOWED_TRANSITIONS` (⭐ `client_ready` terminal-except-retire), `_compute_bundle_record` (content-address digest), `get_skill` (org-scoped), `transition_lifecycle` (**not** used by promote) and its **canonical best-effort audit block to copy verbatim**, `assert_invocable`/`assert_can_advance`.
- [Source: velara-api app/models/skill.py:35,55-57,72-76,165-218] — `Skill.lifecycle_state` (VARCHAR, `draft|internal_ready|client_ready|retired` — **no `certified`**), `current_version_id`, `SkillVersion`.
- [Source: velara-api app/models/certification.py:26-83] / [app/services/certification_service.py:116,410,436] — the two-key gate: `certification_records` (append-only, unique per `(skill_version_id, certification_type)`), `record_certification` auto-advancing to `client_ready` on the second key, `assert_certified_for_client_ready`. Why "trust does not copy": the target org has **no** rows, so both keys are re-required there.
- [Source: velara-api app/api/v1/skills.py:51,150-232,465-481] — router `RejectClient`; the 11.4 export/import section (the route shape to mirror, `_EXPORT_PRESIGN_TTL_SECONDS`); `PATCH /{skill_id}/lifecycle` (the transition route promote must **not** use).
- [Source: velara-api app/models/audit.py:35-78,88,172] — the `EVENT_ADMIN_*` constants (where `EVENT_ADMIN_SKILL_PROMOTED` goes; "stable — do not rename after production deployment"), `AuditLogEntry` (append-only, monthly-partitioned; the JSONB column is `event_metadata` → DB `"metadata"`).
- [Source: velara-api app/services/audit_service.py:260-309] — `record_admin_action` (best-effort, post-mutation, `hierarchy_path="org"` for non-hierarchy-scoped events).
- [Source: velara-web src/features/skills/components/SkillDetail.tsx:16-28,62,233-289] — the action cluster (Promote goes after Export), the FE lifecycle-state mirror, and ⚠️ the **un-gated** Export button (lines 279-280 admit it 404s for consultants — **do not copy**).
- [Source: velara-web src/api/skills.ts:230-262] / [src/features/skills/hooks/useSkills.ts:125] — `exportSkill`/`importSkill` + `useImportSkill` (the client + hook shapes to mirror).
- [Source: velara-web src/shared/utils/auth.ts:97-118] — `GRANTOR_ROLES` / `isGrantor()` (the FE gate; **first** use in the skills feature).
- [Source: velara-web src/features/skills/components/SkillRegistry.tsx:15-33] — `IMPORT_ERROR_MESSAGES` + `getApiCode(err)` → curated copy (the pattern for AC8's honest `PROMOTION_NOT_CONFIGURED` message).
- [Source: velara-web src/features/audit/eventTypeIconMeta.ts:33-34] — the 11.4 event→icon entries; ⭐ Story 12.5's **completeness test will fail** if the new BE event type has no entry here.
- [Source: _bmad-output/implementation-artifacts/stories/12-5-audit-coverage-skill-authoring-ingest.md] — the audit-coverage guard test + the FE icon-map completeness test that constrain Tasks 5/7.

## Dev Agent Record

> ⚠️ **The previous implementation of this story was REVERTED on 2026-07-13** at the
> Project Lead's request, before it was ever committed. The working tree is back to a
> clean HEAD and every task above has been unchecked — this story is `ready-for-dev`
> again and should be implemented fresh.
>
> Nothing was pushed: the reverted work existed only as uncommitted changes in
> `velara-api` and `velara-web`. It is preserved and recoverable:
>
> - **velara-api** — `git stash` entry: *"promotion feature (reverted 2026-07-13, story
>   back to ready-for-dev)"*. Recover with `git stash apply` (or `git stash pop`) in
>   `velara-api`. Roughly 700 lines: `app/integrations/promotion.py` (new,
>   `PromotionProvider` seam), `POST /api/v1/skills/{skill_id}/promote`, config +
>   dependency wiring, an `admin.skill_promoted` audit event, its audit-coverage-guard
>   registry entry, and tests.
> - **velara-web** — 473 lines across 9 files (`SkillDetail.tsx` Promote action,
>   `skills.ts`/`useSkills.ts` client, the `admin.skill_promoted` audit icon, and tests).
>
> ⚠️ **`docs/api-spec.json` was also reverted.** The reverted branch had regenerated it
> with the `/promote` route (~140 lines of drift). Whoever re-implements this must
> re-run the spec export before committing — the `openapi` CI job hard-fails on a stale
> spec.

_(No completed-work record: there is no completed work. The Story, Acceptance Criteria,
Tasks and Dev Notes above are the spec and remain valid.)_

## Change Log

- 2026-07-13 — Story 11.5 drafted (create-story). Final Epic 11 story. Scope locked with the Project Lead: **design + seam**, not the cross-environment transport. Headline deliverable is the **ADR amendment** answering the three Phase-2 questions the existing ADR explicitly defers (auth mechanism / promotable states / cross-env identity), including the **symmetric-key trap** (HMAC proves integrity, not sender identity — key-sharing would invert the BAA trust-grading). Code = a `PromotionProvider` Protocol seam + `DisabledPromotionProvider` (raises `PROMOTION_NOT_CONFIGURED`), a `client_ready`-gated `POST /skills/{id}/promote`, and an honest FE Promote button that points at Export. Status → ready-for-dev.
- 2026-07-13 — Implementation complete (dev-story). All 9 tasks done: ADR amendment landed; `PromotionProvider` seam + config selector + DI alias; grantor-gated `POST /skills/{id}/promote` enforcing `client_ready` before the provider is consulted, reusing the 11.4 signed envelope with zero new serialization; route registered in the 12.5 audit-coverage guard; FE Promote button double-gated on `isGrantor()` + `client_ready` with an honest not-configured message; FE audit icon mapping added to both required files; 21 new tests across BE unit/integration and FE. Gates green: BE 1337 passed / ruff clean; FE typecheck 0 / lint 1 pre-existing warning / vitest 663 passed. No migration. Status → review.
