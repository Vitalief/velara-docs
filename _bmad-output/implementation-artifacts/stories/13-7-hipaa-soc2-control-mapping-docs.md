---
baseline_commit: 0ecc323
---

# Story 13.7: HIPAA & SOC 2 Control Mapping Documents

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a compliance owner,
I want an honest, code-verified control mapping for HIPAA and SOC 2,
so that our first conversation with an auditor starts from an accurate picture rather than a corrected one.

**This is Epic 13's finale — and its whole thesis is honesty against verified code.** The epic exists because the docs and the code disagreed: `compliance-mapping.md` mapped 21 CFR Part 11 only, overstated §11.10(e) audit coverage, and there was no HIPAA mapping and no SOC 2 matrix. **Two of the three documents already exist** — `hipaa-security-rule-mapping.md` and `soc2-control-matrix.md` were authored during Epic 13 *planning* (2026-07-13, commit `cddc082`) as **gap assessments**. But they were written *before any Epic 13 story shipped*, so **every gap they record is now stale**: they say "❌ GAP — Epic 13.x" for controls that Stories 13.1-13.6 have since **built and shipped**. This story's job is to **re-verify every status against the code that now exists, flip closed gaps to their real status, fix the stale story-number references, and correct the overstated Part 11 claim** — so the three documents describe what *actually shipped*, not what was once missing. **This is finalize-last for a reason: it must describe reality, and reality only settled when 13.6 reached `done`.**

## Acceptance Criteria

1. **AC1 — HIPAA Security Rule mapping is accurate against shipped code.**
   **Given** the HIPAA Security Rule
   **When** the mapping is finalized (`docs/hipaa-security-rule-mapping.md`)
   **Then** it covers §164.308 (administrative), §164.312 (technical), §164.316 (documentation), and §164.528 (accounting of disclosures), and marks each control **IMPLEMENTED / PARTIAL / GAP / DEFERRED** against **verified code**, citing the implementing file — **no aspirational entries, and no stale-GAP entries for controls that now ship.** The doc exists but its statuses predate 13.1-13.6; re-verify every one.

2. **AC2 — SOC 2 control matrix is accurate, owner-attributed, and records declines.**
   **Given** SOC 2
   **When** the control matrix is finalized (`docs/soc2-control-matrix.md`)
   **Then** it maps the Common Criteria (CC1–CC8, plus A1 availability, and C1 confidentiality which already exists), names a **control owner** for each, and states the evidence artifact that satisfies it — **including honestly recording the controls we have declined, with the reason** (notably **AWS Config**, which Story 13.5 explicitly declined with a documented reason to cite here).

3. **AC3 — The Part 11 mapping's overstated claim is corrected.**
   **Given** the existing Part 11 mapping (`docs/compliance-mapping.md`)
   **When** it is revised
   **Then** the overstated claims are corrected — **§11.10(e) is downgraded from a flat "IMPLEMENTED" to an accurate status** (it is already caveated to `PARTIAL` as of the 2026-07-13 planning edit; re-verify it now reflects the *shipped* read-path/auth-path audit coverage, which materially changes the picture), and the doc cross-references the two now-final mappings.

4. **AC4 — A real log-review procedure is defined.**
   **Given** §164.308(a)(1)(ii)(D) (information system activity review)
   **When** the data-handling policy is updated (`docs/data-handling-policy.md`)
   **Then** it defines an actual **log-review procedure** — who reviews the audit log, how often, what triggers escalation. **Today's incident-response section (§9) is alarm-driven only, and there is no periodic-review control at all.** This is a genuine *new* control, not a status flip — the audit-log-read event (`audit.log_accessed`, shipped in 13.6) is the evidence mechanism that makes the review itself auditable.

5. **AC5 — Every claim is traceable to code or Terraform.**
   **Given** every claim in all three documents
   **When** it is written
   **Then** it is traceable to code or to Terraform — **this epic exists because the docs and the code disagreed, and the fix is not a better-worded doc but a doc that is *checked*.** Cite files/paths; do not describe intent as if it were implementation.

## Tasks / Subtasks

- [ ] **Task 0 — Establish ground truth FIRST: what actually shipped in 13.1-13.6 (do this before editing a word)**
  - [ ] ⚠️ **This is a documentation story, but the failure mode is documenting the wrong thing.** Before touching any doc, read the **Dev Agent Record → Completion Notes + File List** of each of `13-1`..`13-6` (all `done`) in `_bmad-output/implementation-artifacts/stories/`, AND spot-check the actual code, to build an accurate "what shipped" ledger. The pre-existing docs were written at `cddc082` (planning) and are **wrong now** — trust the code, not them.
  - [ ] Build the ledger (verify each against code — the story notes tell you where):
    - **13.1** — 7-category audit taxonomy (`audit_categories.py`) + guard test; `category` query param on `GET /api/v1/audit`.
    - **13.2** — user **deprovisioning** shipped: `AuthProvider.disable_user`/`enable_user`/`set_user_role`, `POST /users/deprovision|reprovision` + `PATCH /users/role`, Cognito `AdminDisableUser`/`AdminEnableUser`/`AdminUserGlobalSignOut`/`AdminUpdateUserAttributes` in IAM, the cached enabled-check in `get_current_user` (kills the 8h-token window), `admin.user_deprovisioned/reprovisioned/role_changed` events. **This closes the #1 HIGH gap in both docs (CC6.3 / §164.308(a)(3)(ii)(C)).**
    - **13.3** — read-path disclosure: `access.artifact_disclosed` on every presigned-URL mint (6 sites), `file_ref_ids` in invocation metadata, TTL 24h→15min, S3 access logging on PHI buckets. **Closes the §164.312(b) read-path / §164.528 / CC6.7 gaps.**
    - **13.4** — auth events: `auth.login_succeeded/login_failed/logout/session_revoked` + `access.denied` (de-duped, durable), `POST /auth/logout`, `security_events` CloudWatch metric filter + alarm + `var.security_alert_email` SNS subscription, Cognito `advanced_security_mode = ENFORCED` (non-dev). **Closes §164.308(a)(5)(ii)(C) / CC6.1 / CC7.2 login-monitoring gaps.**
    - **13.5** — detective controls: CloudTrail (multi-region, log-validation, S3 data events on PHI buckets), ALB access logs, VPC flow logs, **GuardDuty ENABLED**, **AWS Config DECLINED (documented reason)**, retention→365d. **Closes CC7.1 / §164.308(a)(1)(ii)(D) cloud-audit gaps.** ⚠️ **All 13.5 TF is `plan`-only, operator-applied — NOT yet live.** The docs must say "authored + planned, pending operator apply," NOT "operating," or they re-commit the exact overstatement sin this epic exists to fix. See Trap 2.
    - **13.6** — remaining mutations: hierarchy CRUD + skill attach/detach audited (`admin.hierarchy_*`, `admin.skill_attached/detached`), `audit.log_accessed`, `security.sandbox_network_blocked`, 12.5's 16 guard-exemptions all flipped to audited. **Closes the CC4.1 audit-read / §164.312(c)(1) unaudited-destruction / CC6.8 sandbox-probe gaps.**
  - [ ] Note what is **still** genuinely open (do NOT mark these closed): sandbox *hardening* (13.6 detected probes but the ctypes→libc escape remains — Epic 7's syscall sandbox never shipped); restore-drill never performed (A1.2/A1.3 — raised separately, not in Epic 13); named control owners + risk register (CC1/CC3 — Vitalief organizational); the Part 11 deferrals (FR-SEC-12 non-repro, IQ/OQ/PQ, printed-name). **An auditor trusts a doc that still says GAP where a gap remains far more than one that marks everything green.**

- [ ] **Task 1 — Finalize `hipaa-security-rule-mapping.md` against shipped code (AC1, AC5)**
  - [ ] Re-verify and flip every status. Concretely, the big flips (verify each against the 13.x code before writing):
    - §164.312(b) AUDIT CONTROLS: `❌ GAP` → **`✅ IMPLEMENTED`** (read path now audited — 13.3; auth path — 13.4; every mutation — 13.6). This is the headline change of the entire document.
    - §164.312(d) person/entity auth: `⚠️ PARTIAL` → **`✅ IMPLEMENTED`** (auth events recorded — 13.4; deprovisioning + session kill — 13.2; ASM enabled — 13.4/13.5).
    - §164.308(a)(3)(ii)(C) termination: `❌ GAP (highest severity)` → **`✅ IMPLEMENTED`** (13.2 deprovisioning).
    - §164.308(a)(5)(ii)(C) log-in monitoring: `❌ GAP` → **`✅ IMPLEMENTED`** (13.4 failed-login events + alarm).
    - §164.308(a)(4) access management: `⚠️ PARTIAL` → **`✅`/`⚠️`** (role modification now exists + audited — 13.2; denials now attributed — 13.4).
    - §164.312(c)(1) integrity: `⚠️ PARTIAL` → **`✅`/`⚠️`** (hierarchy deletes now audited — 13.6; note S3 Object-Lock is still absent if that's still true).
    - §164.528 accounting of disclosures: `❌ GAP` → **`✅`/`⚠️`** (`access.artifact_disclosed` + `file_ref_ids` — 13.3; the reporting UI is still FR-SEC-17-deferred, so PARTIAL is honest if the events exist but no report screen does).
    - §164.308(a)(1)(ii)(D) activity review: `❌ GAP` → **`⚠️ PARTIAL`** (audit-log-read now recorded — 13.6; the *procedure* is defined by AC4/Task 4 — once that lands, re-assess).
    - §164.308(a)(6) incident procedures: `⚠️ PARTIAL` → **`⚠️`/`✅`** (security alarm exists — 13.4; SNS subscription exists but confirmation is operator-owed — keep honest).
  - [ ] ⚠️ **Fix EVERY stale "Epic 13.x" story reference.** The doc was written pre-renumber (before 13.1-categorization was inserted): it says "Epic 13.1" for deprovisioning (now **13.2**), "13.2" for read-path (now **13.3**), "13.3" for auth (now **13.4**), "13.4" for detective controls (now **13.5**), "13.5"/"13.6" for the audit-read/mutation gaps (now **13.6**). **Every one is off-by-one-or-more.** Replace the "remediation: Epic 13.x" pointers with "**implemented in Story 13.x**" using the CORRECT current numbers, or drop the story pointer entirely in favor of the file citation (cleaner for a shipped control). Grep the doc for `13.` and fix each.
  - [ ] Update the header: `Status: ⚠️ Gap assessment` → a post-remediation status (e.g. "Control mapping — verified against shipped code at commit `<final>`, Epic 13 complete"). Update `Effective Date` and the `verified against the code at commit cddc082` line to the final commit.
  - [ ] Rewrite §6 "Summary of gaps → remediation": most rows move from open-gap to **closed** (cite the story that closed each). Keep the genuinely-open ones (sandbox hardening, restore drill, owners) as open with accurate severity.
  - [ ] Preserve the "What is genuinely strong" section (§93) — it's still true and an auditor should still read it — but add the now-shipped detective/lifecycle controls to the credit list.

- [ ] **Task 2 — Finalize `soc2-control-matrix.md` against shipped code (AC2, AC5)**
  - [ ] Same flip-and-verify pass. Big ones:
    - **CC6.3 access removal** (the "single most damaging finding"): `❌ GAP (HIGH)` → **`✅ IMPLEMENTED`** (13.2 — deprovision + role-change + session-kill, all audited). Rewrite the long finding to describe the shipped capability + its evidence.
    - **CC6.7 data movement**: `❌ GAP` → **`✅`/`⚠️`** (13.3 disclosure events + S3 access logging).
    - **CC6.1 logical access**: `⚠️ PARTIAL` → **`✅`/`⚠️`** (13.4 failed-login capture + ASM; MFA still OPTIONAL — keep that caveat, it's real).
    - **CC6.6 external threats**: `⚠️ PARTIAL` → **`⚠️`/`✅`** (13.5 ALB access logs + GuardDuty; WAF still absent — keep if true).
    - **CC6.8 malicious software**: stays **`⚠️ PARTIAL`** (13.6 added probe *detection* — flip that half; sandbox *hardening* remains open — keep that half honest).
    - **CC7.1 detect config changes**: `❌ GAP (HIGH)` → **`⚠️ PARTIAL`** (13.5 CloudTrail + GuardDuty authored — but ⚠️ **plan-only, operator-apply-pending**: do NOT mark `✅ IMPLEMENTED/operating` until the operator has applied. "Authored + planned, apply pending" is the honest status — see Trap 2. AWS Config **declined with reason** — record it here per AC2, citing 13.5's `guardduty.tf` comment).
    - **CC7.2/7.3/7.4 monitor/evaluate/respond**: `⚠️ PARTIAL` → improved (13.4 security alarm; the SNS-subscription-confirmation + operator-apply caveats stay).
    - **CC8.1 change management**: `⚠️ PARTIAL` → improved (12.5 + 13.6 closed the skill-as-code audit holes; the "bind approval to artifact checksum" piece — check whether 11.6's draft-content-checksum work or a later story closed it; keep honest).
  - [ ] **AC2 control-owner requirement:** the matrix currently defaults every owner to "Platform Engineering" and flags that assigning **named** owners is an open CC1 action. **This story can't invent real people's names**, but it MUST make the owner column a real column with a placeholder that forces the action (e.g. `<OWNER: Vitalief compliance to assign>`) rather than the current blanket default — OR keep the honest "unassigned, open action" note. Do not fabricate names. State clearly this is Vitalief's to fill.
  - [ ] **AWS Config decline (AC2):** 13.5 declined it with a documented reason in `guardduty.tf`. Cite that reason verbatim in CC7.1's row — "a documented risk decision is auditable; silence is not."
  - [ ] Update the header status, effective date, and the `assessed at commit cddc082` line. Rewrite §9 "Prioritized remediation" (most rows now closed → cite the story) and add to §10 "What to credit."
  - [ ] ⚠️ **Fix the stale story-number references here too** (same pre-renumber off-by-one as the HIPAA doc — §9's "Story" column says 13.1/13.2/13.3/13.4/13.5 with the OLD numbering).

- [ ] **Task 3 — Correct `compliance-mapping.md` (Part 11) — the overstatement fix (AC3, AC5)**
  - [ ] **§11.10(e) audit trail** is the named overstatement. It's already `PARTIAL` with a 2026-07-13 caveat saying coverage is "write-path only." **Re-verify against shipped code:** the read-path (13.3), auth-path (13.4), and full-mutation (13.6) coverage now EXISTS, so the caveat's "does not record reads/disclosures… nor any authentication activity" is **no longer true**. Update it to reflect the now-comprehensive coverage — this likely moves it from `PARTIAL` toward `IMPLEMENTED` (with any genuinely-remaining caveat, e.g. cryptographic audit-signing is still a Part 11 §11.10 deferral). **Do not overcorrect to a flat IMPLEMENTED if a real gap remains** — the whole point is calibration.
  - [ ] Update the companion-documents callout (§16-20) — the HIPAA + SOC 2 docs are now *finalized control mappings*, not "records real gaps" gap-assessments. Reword accordingly and cross-reference.
  - [ ] Re-check §11.300(c) (immediate deactivation of compromised tokens) — 13.2's `AdminUserGlobalSignOut` + the enabled-check now make this genuinely immediate (was "8h token survives"); strengthen the entry with the shipped session-kill.
  - [ ] Bump version/effective-date; add a Change Log entry noting the Epic 13 finalization.

- [ ] **Task 4 — Define the log-review procedure in `data-handling-policy.md` (AC4)**
  - [ ] Add a new section (or extend §9 incident-response) with a **periodic audit-log-review procedure**: **who** reviews (role — e.g. the security/compliance owner), **how often** (define a cadence — e.g. weekly for security-category events, monthly for a full review), **what they look for** (failed-login clusters, denial patterns, deprovisioning completeness, disclosure accounting), and **what triggers escalation** (into the existing §9 IR flow).
  - [ ] **Tie it to shipped evidence:** the review is now itself auditable — `audit.log_accessed` (13.6) records who reviewed the trail, the `category` filter (13.1) lets the reviewer slice by Authentication/Security/Access-Control/Compliance, and the `security_events` alarm (13.4) is the real-time complement to the periodic review. This is the §164.308(a)(1)(ii)(D) *control*, distinct from the *mechanism*.
  - [ ] This is genuine new prose (not a status flip) — keep it concrete and operator-actionable, not aspirational.

- [ ] **Task 5 — Consistency + traceability pass (AC5)**
  - [ ] **Cross-document consistency:** the same control must not be `✅` in one doc and `❌` in another. The HIPAA §164.312(b), SOC 2 CC6.3/CC6.7/CC7.1, and Part 11 §11.10(e) rows all describe overlapping controls — make their statuses agree.
  - [ ] **Every claim cites code/TF** (AC5). Spot-check that file/line citations still resolve at the final commit (the pre-existing docs cite `jobs.py:145,182,232` etc. — verify those line numbers didn't drift after 13.3's edits; if they did, update or genericize to the function name).
  - [ ] Update `docs/index.md` if it lists/summarizes these docs (it exists — check it reflects the finalized status, not the gap-assessment framing).
  - [ ] ⚠️ **Honest-status discipline (the whole point):** anything 13.5 authored but did not apply (all its Terraform) is "authored + planned, operator-apply pending" — NOT "operating." Anything with an operator-owed follow-up (SNS subscription confirmation, live `terraform apply`, MFA-enforcement decision) keeps that caveat. **The doc's credibility is its accuracy; a single overstated "operating" control an auditor disproves taints the whole set.**

- [ ] **Task 6 — Gates (documentation-only story)**
  - [ ] **NO code change.** This is docs-only: `velara-api/docs/*.md`. No Python, no FE, no Terraform, no tests, no migration, no `api-spec.json`. If any non-`.md` file shows up in your diff, you've drifted.
  - [ ] **Markdown sanity:** tables render, links resolve (the `../../` relative links to epic/story files, and the intra-repo file citations). No broken internal references.
  - [ ] **The "checked doc" standard (AC5):** before marking done, do a final pass asking of every ✅ "can I point to the code/TF line that proves this?" and of every ❌/⚠️ "is this still true at the final commit?" **This story's entire value is that the docs are verified — a plausible-but-unchecked doc is the failure it exists to prevent.**
  - [ ] Record the **final commit hash** the docs were verified against in each doc's header (replacing `cddc082`), so the next reader knows the as-of point.

## Dev Notes

### ⛔ TRAP 1 — The docs already exist and are CONFIDENTLY WRONG. Trust the code, not the docs.

This is not a from-scratch authoring task. `hipaa-security-rule-mapping.md` and `soc2-control-matrix.md` are **already in the repo**, are **well-written**, and are **wrong** — because they were authored at commit `cddc082` during Epic 13 *planning*, before a single remediation story shipped. They confidently mark controls `❌ GAP` that Stories 13.1-13.6 have since built. If you finalize by lightly editing them without re-verifying against the *current* code, you will ship a doc that says "no user deprovisioning exists" when 13.2 shipped exactly that. **The pre-existing statuses are a starting checklist of what to RE-VERIFY, not a source of truth.** Task 0 (build the shipped-ledger from code first) exists precisely to invert your trust: the code is truth, the old doc is a stale to-do list.

### ⛔ TRAP 2 — 13.5's detective controls are AUTHORED, not APPLIED. Do not mark them "operating."

Every prior Epic 13 Terraform task (13.2 IAM, 13.4 Cognito/CloudWatch, 13.5 CloudTrail/GuardDuty/etc.) shipped as **`terraform plan`-only, handed to the operator** — this environment cannot run a live `plan`/`apply` (no AWS creds, `velara-tfstate-lock` DynamoDB inaccessible). So CloudTrail, GuardDuty, ALB logs, VPC flow logs, the security alarm, and Cognito ASM are **written and validated but not confirmed live**. **The honest status is "authored + planned, pending operator apply," NOT "✅ IMPLEMENTED / operating."** This is the *exact* class of overstatement this epic exists to eliminate — an auditor who is told "CloudTrail is operating" and finds it wasn't applied will distrust every other ✅ in the document. Mark cloud detective controls as authored/planned with the apply as an operator-owed action, and say so plainly. (App-code controls — the audit events, deprovisioning, the enabled-check — ARE live in the code and CAN be marked implemented, because they ship in the image, not via `terraform apply`.)

### ⛔ TRAP 3 — The story-number references are all pre-renumber (off by one or more)

Both existing docs were written before the 2026-07-14 correct-course inserted `13.1-audit-event-categorization` as the new first story, which shifted the original 13.1-13.6 to 13.2-13.7. So every "Epic 13.1 / 13.2 / 13.3 / 13.4 / 13.5" pointer in the docs uses the **old** numbering:
- old "13.1" (deprovisioning) → now **13.2**
- old "13.2" (read-path) → now **13.3**
- old "13.3" (auth) → now **13.4**
- old "13.4" (detective controls) → now **13.5**
- old "13.5"/"13.6" (audit-read/mutations) → now **13.6**

Grep both docs for `13.` and fix each — or better, since these controls are now *shipped*, replace "remediation tracked as Epic 13.x" with "implemented in Story 13.x (correct number)" + the file citation. A wrong story reference in a compliance doc is a small thing that reads as sloppiness to an auditor and undercuts the "this is checked" claim.

### What genuinely remains OPEN (mark these honestly — do not green-wash)

Closing gaps is most of this story, but the credibility comes from what you *don't* close:
- **Sandbox hardening** — 13.6 added probe *detection* (`security.sandbox_network_blocked`), but `code_sandbox.py`'s ctypes→libc escape is real and Epic 7's syscall sandbox never shipped. CC6.8 stays `⚠️ PARTIAL`; note hardening is unscoped.
- **Restore drill** — backups are configured; a restore has never been executed/evidenced. A1.2/A1.3 stay `⚠️/❌`. Explicitly "raise separately — not Epic 13."
- **Named control owners + risk register** — CC1/CC3, organizational, Vitalief's to fill. The matrix must force the action, not fabricate names.
- **Part 11 deferrals** — FR-SEC-12 (re-auth at e-signature), IQ/OQ/PQ execution, printed-name denormalization, cryptographic audit-signing. All still deferred; keep them in the Part 11 deferral table.
- **MFA** — stayed `OPTIONAL` in non-dev (13.4 decision); ASM covers brute-force but MFA-enforcement is an operator-scheduled follow-up. CC6.1 keeps that caveat.
- **Operator-owed cloud applies + SNS confirmation** — see Trap 2.

### This is a documentation story — no code, no tests, no gates beyond doc-accuracy

Unlike every other Epic 13 story, there is **no `app/` change, no Terraform, no test, no migration, no api-spec**. The deliverable is four `.md` files in `velara-api/docs/`. There is no guard test to satisfy and no build to pass — which means the *only* quality bar is **accuracy**, and accuracy has no automated check. That's why Task 0 (ground-truth-first) and Task 5 (traceability pass) carry the weight: the discipline that a test provides in other stories, you provide by hand here. The epic's closing line is the acceptance bar: *"the fix is not a better-worded doc but a doc that is checked."*

### Testing standards

No automated tests (docs-only). "Verification" = every ✅ traces to a code/TF citation that resolves at the final commit, every ❌/⚠️ is still true at the final commit, and the three docs agree with each other on shared controls. The pre-existing docs' own maintenance sections state the standard: *"Every claim must remain traceable to code or Terraform."*

### Project Structure Notes

- `velara-api/docs/hipaa-security-rule-mapping.md` — MODIFIED (finalize: re-verify all statuses, flip closed gaps, fix story refs, update header/commit)
- `velara-api/docs/soc2-control-matrix.md` — MODIFIED (finalize: same, + control-owner column, + AWS Config decline)
- `velara-api/docs/compliance-mapping.md` — MODIFIED (§11.10(e) correction, §11.300(c) session-kill, companion-doc reword, version bump)
- `velara-api/docs/data-handling-policy.md` — MODIFIED (new log-review procedure — AC4)
- `velara-api/docs/index.md` — possibly MODIFIED (reflect finalized status if it summarizes these)

**No code. No Terraform. No tests. No migration. No api-spec. Docs only.**

### References

- [Source: epics/epic-13-compliance-audit-and-access-controls.md#Story-13.7] — the ACs verbatim; the "finalize LAST — must describe what shipped" ordering; the §11.10(e) overstatement callout; the "traceable to code, not a better-worded doc" closing standard.
- [Source: velara-api/docs/hipaa-security-rule-mapping.md] — **the existing gap-assessment to finalize** (authored `cddc082`, pre-remediation); its §6 gap→remediation table and stale "Epic 13.x" refs (Trap 3); its "genuinely strong" §93 to preserve.
- [Source: velara-api/docs/soc2-control-matrix.md] — **the existing matrix to finalize**; CC6.3/CC6.7/CC7.1 gap findings to flip; the control-owner open action (AC2); §9 remediation table with stale story numbers.
- [Source: velara-api/docs/compliance-mapping.md] — the Part 11 doc; §11.10(e) `PARTIAL` caveat to re-verify (AC3); §11.300(c) session-kill to strengthen; the companion-doc callout to reword.
- [Source: velara-api/docs/data-handling-policy.md] — §9 incident-response (alarm-driven only — AC4 adds the periodic-review control beside it).
- [Source: implementation-artifacts/stories/13-1..13-6-*.md — Dev Agent Record / Completion Notes] — **the authoritative "what shipped" ledger (Task 0)**; especially 13.2 (deprovisioning + session kill), 13.3 (disclosure + TTL + S3 logging), 13.4 (auth events + ASM + security alarm), 13.5 (CloudTrail/GuardDuty enabled, **AWS Config declined w/ reason**, all plan-only — Trap 2), 13.6 (hierarchy/attachment/audit-read/sandbox events + guard-registry cleared).
- [Source: velara-api/app/models/audit.py + audit_categories.py] — the shipped event-type families (`admin.*`, `auth.*`, `access.*`, `audit.*`, `security.*`) and 7-category taxonomy that are the evidence backbone for the §164.312(b)/CC4.1 claims.
- [Source: velara-api/terraform/cloudtrail.tf, guardduty.tf, cloudwatch.tf, cognito.tf] — the authored-but-plan-only detective controls (Trap 2); the AWS Config decline comment (AC2); `advanced_security_mode` + the `security_events` alarm.
- [Source: memory — Epic 10 Retro Lessons] — "done = reviewed, NOT production-verified; operator has not live-tested most auth" — directly reinforces Trap 2's authored-vs-operating distinction for the compliance docs.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log
