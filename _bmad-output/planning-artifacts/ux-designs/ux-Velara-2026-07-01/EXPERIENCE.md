---
status: final
updated: 2026-07-01
scope: Velara internal-admin UX — Access Control skill attach/detach (Story 8.6) + Client User Provisioning (Epic 10)
design: ./DESIGN.md
sources:
  - design/internal3.jsx (AccessControl prototype — layout of record)
  - design/data.js (skillAssignments model)
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md (2026-07-01 ADRs: skill_attachment, provisioning)
  - _bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29 (ACL-08, ACL-09, USR-01..03)
  - _bmad-output/planning-artifacts/epics/epic-8-access-control-client-portal.md (Story 8.6)
  - _bmad-output/planning-artifacts/epics/epic-list.md (Epic 10)
---

# Velara Admin UX — Experience Spine

Two internal-admin surfaces added by the 2026-07-01 correct-course. Both are **internal-admin only** (`consultant` / `ma_tech`, behind `RequireInternal`) and live inside the existing internal app shell. Visual identity: `{design}` (Vitalief V3). This spine owns *how it works*.

> **Key-screen mock:** [`mockups/admin-surfaces-mock.html`](./mockups/admin-surfaces-mock.html) — the 5 key screens (scalable client selector · assignment cards · attach panel · provisioning flow · Users list) rendered in the real V3 theme. **The spines win on any conflict with the mock.**

## Foundation

- **Form factor:** desktop web, inside the existing internal shell (left nav + top bar + content). No mobile target — these are back-office admin tasks done at a desk.
- **UI system:** the internal app's own component set (V3). New behavior extends it; it does not import a third-party system.
- **Actors:** Vitalief consultants / MA-tech (internal admins). Clients never see these screens.
- **Backing contracts (from the 2026-07-01 ADRs — behavior must match):**
  - Skill attachment = one polymorphic `skill_attachment(skill_id, node_id, node_type∈{project,study}, org_id, attached_by, attached_at)`, UNIQUE per (skill, node, type, org). Client availability = **attached ∩ granted ∩ client_facing/client_ready**.
  - Provisioning = `AuthProvider.create_user` → Cognito `AdminCreateUser` **default-invite** (Cognito emails the temp password; user sets their own on first login). `org_id`/`role` set **server-side** from the admin's input.
  - Create-user and grant are **distinct operations** (USR-01 vs ACL-08/8.1); Story 10.3 chains them.

## Information Architecture

Two client-scoped surfaces, both gated by the **client selector** (one client active at a time):

```
Internal app (RequireInternal)
├── Access Control  (nav tab — exists)
│    client-selector ─┐
│                     └─ per selected client:
│                        • Project cards → [Attach skill]
│                        │   ├ Project-level skills band (chips, detachable)
│                        │   └ Study rows → [Attach] (chips, detachable)
│                        (grant control also lives here — existing, for existing users)
└── Users  (nav tab — NET-NEW, Epic 10)
     client-selector ─┐
                       └─ per selected client:
                          • Client-users table (name / email / access / status / resend)
                          • [Add user] → create+invite+grant flow (overlay, 3 steps)
```

**Surface closure:** ACL-09 (attach skills) → Access Control cards + attach panel. ACL-08 (manage grants) → existing grant control (unchanged). USR-01/02 (create+invite) → Add-user flow. USR-03 (manage users) → Users table. 10.3 (create→grant) → the flow's Step 2. Every stated need has a surface; every surface has a flow that lands there.

## Voice and Tone

Plain, precise, reassuring — these are consequential admin actions (who can see a client's data). Say what will happen before it happens.
- Attach empty state: "No skills attached to this study yet."
- Attach guardrail note: "Only client-ready skills appear — internal-only skills can't reach clients."
- Invite callout: "Cognito emails <name> a secure invitation with a temporary password. They set their own password on first sign-in — Velara never sees or stores it."
- Detach confirm: "Detach <skill> from <study>? Clients on this engagement will no longer see it." · [Cancel] [Detach]
- Never expose internals in copy (no skill instructions/code/version internals on any client-adjacent label).

## Component Patterns (behavioral)

- **Client selector** — combobox. Closed = current-client trigger. Click/Enter/Space opens; typing filters by name OR code (case-insensitive, substring); ↑/↓ move the highlight, Enter selects, Esc closes and restores. Selecting sets the client scope for the whole surface and collapses. Paused clients are selectable (an admin may still manage a paused engagement). Persists the last-selected client per session.
- **Skill chip** — displays name (+ "Outputs" marker on project-level client-facing skills). Hover or keyboard-focus reveals the detach ✕. ✕ → detach confirm (see State Patterns). Chip is not a navigation target here (the prototype's onOpen is out of scope for these stories).
- **Attach side panel** — opens right-docked from any Attach button; **stays open** after an attach so the admin can attach several across studies; cards remain visible behind a light scrim and update live (new chip appears in the target card). Search filters the **client-ready** candidate list. Each row: attach button; already-attached rows are disabled + "Attached ✓". Close via ✕, Esc, or clicking outside.
- **Add-user flow (overlay, 3 steps)** — launched from Users → [Add user]. Step 1 form (name, email, client-engagement [defaults to selected client], role [Client]). Submit = create + invite. On success advances **in place** to Step 2 (the reused, pre-filled grant control) — no tab redirect. Step 3 confirmation with "Add another" / "View in Users."
- **Users table** — sortable-ready; status pills; per-row Resend (invited only). Row → user detail is a later concern (not in these stories); keep the row action set minimal.

## State Patterns

Every async surface: **loading → loaded → empty → error**, plus the mutation states.
- **Client selector:** loading (skeleton trigger) · loaded · empty ("No clients yet") · error (inline retry). Filtering with no match: "No clients match '<q>'."
- **Skill assignment cards:** loading (skeleton chips) · loaded · **empty per level** ("No skills attached to this project/study yet.") · error.
- **Attach panel candidate list:** loading · loaded · empty ("No client-ready skills available to attach") · no-search-match ("No skills match '<q>'") · error. **Attach action:** optimistic chip insert → on failure, remove + toast error. **Duplicate guard:** already-attached rows disabled (mirrors the UNIQUE constraint) so the duplicate state is unreachable via UI.
- **Detach:** ✕ → **confirm dialog** ("Detach <skill> from <study>? Clients on this engagement will no longer see it.") → [Detach] removes the chip; on failure re-insert + toast. (Deliberate friction: detaching is destructive to a client's access.)
- **Create user:** submitting (button spinner, form locked) → success (advance to Step 2) → **error cases with distinct copy:** duplicate email ("A user with this email already exists"), invalid email, Cognito/backend failure ("Couldn't create the account — try again"). Never lose the entered form values on error.
- **Grant step (Step 2):** reuses the existing grant control's states; pre-filled user is read-only in this context.
- **Resend invite:** click → "Invitation resent to <email>" toast; disable briefly to prevent double-send.
- **Toasts** carry an Undo only where safe; **detach has NO undo** (it went through a confirm instead) — consistent with "deliberate for destructive, fluid for constructive."

## Interaction Primitives

- **Attach = fluid & bulk** (stay-open side panel, live chips, optimistic). **Detach = deliberate** (confirm dialog). **Create = guided** (stepper). This asymmetry is the product's personality — encode it consistently.
- Optimistic UI for attach only (low-stakes, reversible). Never optimistic for create-user or grant (identity/access — must confirm server success).
- The client selector governs both tabs; switching client re-scopes in place (no full-page reload).

## Accessibility Floor

- **Client selector** = a proper combobox: `role="combobox"` + `aria-expanded`, listbox with `role="option"` + `aria-selected`; full keyboard (open, type-filter, ↑/↓, Enter, Esc); focus returns to the trigger on close.
- **Side panel & dialogs** = focus-trapped; Esc closes; focus returns to the invoking control; `aria-labelledby` the panel/dialog title. Background inert while open.
- **Detach confirm** = `role="alertdialog"`; default focus on Cancel (not the destructive action).
- **Stepper** communicates current/complete state to SR (not color-only): `aria-current="step"` + text.
- **Status pills** never rely on color alone — the word ("Invited" / "Active") is always present.
- Keyboard reachable: every Attach/Detach/Add-user/Resend is a real button, tab-ordered. Visible focus rings (V3 default). Touch/click targets ≥ 32px.
- Contrast inherits V3 (validated palette); the net-new amber Invited pill must meet AA against its background — verify at build.

## Key Flows

### Flow 1 — Dana attaches a skill to a study (Story 8.6 / ACL-09)
Dana, a Vitalief consultant, is standing up the BILH oncology engagement before the client's Monday kickoff. She opens **Access Control**, and instead of hunting a wall of client buttons, she clicks the client selector, types "bi", and BILH is right there — one keystroke. The screen fills with BILH's projects. On the **ONC-204** study row she clicks **Attach**. A panel slides in from the right; the cards stay visible beside it. She types "site" and "Site Activation Risk" surfaces — she notes "Governance Memo" is greyed with "Attached ✓" (already on it). She clicks **Attach**, and — *climax* — a new chip blooms into the ONC-204 card *behind* the still-open panel. She immediately searches "startup," attaches "Startup Timeline" to the same study, then scrolls to ONC-207 and attaches there too, never once reopening the panel. Three skills, three studies, one fluid sitting. She closes the panel; the engagement's skill surface is set. She never worried about exposing an internal skill — the panel simply never offered one.

### Flow 2 — Dana onboards a new client user (Epic 10 / USR-01..03, 10.3)
The BILH ops director, **Susan Whitfield**, needs access before kickoff — she has no login yet. Dana opens the **Users** tab (BILH already scoped), clicks **Add user**. An overlay opens: she types Susan's name and BILH email; engagement pre-fills to BILH, role to Client. She reads the calm callout — Cognito will email Susan a secure temporary-password invite; Velara never stores the password — and clicks **Create & send invite**. The overlay advances *in place* to **Step 2: Grant access**, the familiar grant control already filled with Susan's name; Dana grants her the BILH Oncology Network and confirms. *Climax:* Step 3 — "Susan is invited and granted access." Dana clicks "View in Users" and sees Susan in the table with an amber **Invited** pill. Two days later Susan clicks her email link, sets her password, logs into the client portal, and the pill has turned teal — **Active**. Dana onboarded a client without leaving the flow, sending an email by hand, or ever touching a password.

## Inspiration & Anti-patterns

- **Inherit, don't reinvent:** the assignment layout is the prototype's; the selector borrows the app's own search idiom. A returning consultant should feel zero seam.
- **Anti-pattern avoided — the wall of buttons:** the horizontal client-button row doesn't scale; the searchable selector replaces it. (The explicit reason this UX pass exists.)
- **Anti-pattern avoided — footgun by warning:** rather than *warn* an admin not to expose internal skills, the attach list *cannot* contain them. Make the wrong thing impossible, not merely discouraged.
- **Anti-pattern avoided — onboarding scavenger hunt:** create-then-"now go find where to grant" is replaced by an in-place stepper.
