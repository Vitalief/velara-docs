---
status: final
updated: 2026-07-01
scope: Velara internal-admin UX — Access Control skill attach/detach + Client User Provisioning
inherits: design/styles_v3.css (Vitalief V3 brand system — the internal app's existing token set)
sources:
  - design/internal3.jsx (AccessControl prototype — layout of record)
  - design/data.js (skillAssignments model)
  - design/styles_v3.css (V3 brand tokens)
  - _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md (2026-07-01 ADRs)
colors:
  surface: "#ffffff"
  surface-2: "#f8f9fc"
  surface-sunk: "#edf0f4"
  paper: "#f4f6f9"
  ink: "#323843"
  ink-2: "#4C5270"
  muted: "#6b7280"
  faint: "#9ca3af"
  brand: "#128F8B"        # teal — --green-800
  brand-hover: "#0d6b68"  # --green-700
  brand-deep: "#2e3440"   # navy — --green-900
  brand-50: "#e6f8f8"     # teal wash — selected rows, client badge bg
  brand-100: "#c8f0ee"
  line: "#e2e6ec"
  line-2: "#d1d7e0"
  line-strong: "#bec5d0"
  status-client-bg: "#e6f8f8"
  status-client-tx: "#0d6b68"
  status-client-bd: "#a8dedd"
  status-internal-bg: "#eceef5"
  status-internal-tx: "#363b54"
  status-draft-bg: "#eef0f3"
  status-draft-tx: "#5b626d"
  invited-bg: "#fff7ed"     # amber — invited pill (net-new; only new status color)
  invited-tx: "#b45309"
  invited-bd: "#fcd9a8"
  danger: "#d4186c"         # detach ✕ hover, destructive confirm
  danger-bg: "#fde8f3"
typography:
  heading: "Poppins, system-ui, -apple-system, sans-serif"   # --serif
  body: "Open Sans, system-ui, -apple-system, sans-serif"    # --sans
  mono: "IBM Plex Mono, ui-monospace, Menlo, monospace"      # --mono (codes, ids)
rounded:
  sm: "6px"    # chips, inputs, badges
  md: "9px"    # skill chips, buttons, selector
  lg: "12px"   # cards, panels, modals
  xl: "18px"
spacing:
  card-pad-x: "18px"
  card-pad-y: "12px-14px"
  section-gap: "18px-22px"
  chip-gap: "8px"
components:
  button-primary: "bg brand / white text / radius md — Attach, Create & invite, Add user"
  button-ghost: "transparent / line-2 border / ink-2 text — secondary, per-study Attach"
  badge-client: "brand-50 bg / status-client-tx / client-ready & Outputs markers"
  badge-invited: "invited-bg / invited-tx — Invited status pill (net-new)"
  badge-active: "status-client-bg / status-client-tx — Active status pill"
  skill-chip: "line border / radius md / hover reveals detach ✕ (danger on hover)"
  side-panel: "right-docked / sh-lg / cards stay visible behind"
elevation:
  sh-sm: "0 1px 2px rgba(50,56,67,.05), 0 1px 1px rgba(50,56,67,.04)"
  sh: "0 4px 16px -6px rgba(50,56,67,.12), 0 1px 3px rgba(50,56,67,.06)"
  sh-lg: "0 24px 60px -24px rgba(30,35,48,.28), 0 6px 18px -10px rgba(30,35,48,.16)"
---

# Velara Admin UX — Design Spine

> These two surfaces live **inside the existing internal app**. This spine **inherits `design/styles_v3.css` (Vitalief V3)** wholesale — it does not invent a visual language. Tokens above are named references to the V3 `:root` variables so the dev wires to the real CSS custom properties, not hard-coded hex. Only genuinely new visual elements are called out as **[net-new]**.

## Brand & Style

Vitalief V3: calm, clinical, trustworthy. Teal (`{colors.brand}`) is the single accent — used sparingly for primary actions, selected state, and the client-facing "Outputs" marker. Navy/slate ink (`{colors.ink}` / `{colors.ink-2}`) carries structure. Generous whitespace, hairline borders (`{colors.line}`), soft radii. Poppins for headings, Open Sans for body, IBM Plex Mono for codes and IDs (BILH, STD-ONC204). The admin surfaces must feel like the *same product* as Skill Registry and the Engagements screen — a returning consultant should notice no seam.

## Colors

Inherit the full V3 palette. Roles that matter here:
- **Teal `{colors.brand}` / hover `{colors.brand-hover}`** — primary buttons (Attach, Create & invite, Add user), the active client in the selector, selected list rows (`{colors.brand-50}` wash), the "Outputs / client-ready" badge.
- **Ink `{colors.ink}` / ink-2 `{colors.ink-2}` / muted `{colors.muted}` / faint `{colors.faint}`** — text hierarchy; section labels (uppercase, letter-spaced) use `{colors.faint}`.
- **Status pills:** Active reuses client teal (`{colors.status-client-bg}`); **[net-new] Invited = amber** (`{colors.invited-bg}` / `{colors.invited-tx}` / `{colors.invited-bd}`) — the one color added, because "invited but not yet active" has no existing V3 status and must read as *pending*, distinct from active-teal and draft-grey.
- **Danger `{colors.danger}`** — detach ✕ on hover and the destructive confirm dialog only. Never for structure.

## Typography

Per V3. Headings Poppins 600–700; screen titles ~16px, card titles ~15px, study titles ~13.5px. Body Open Sans 400/600. Codes and IDs in IBM Plex Mono at reduced weight/size in `{colors.faint}` (e.g. `PRJ-BILH-ONC`, `STD-ONC204`). Uppercase micro-labels (section keys, field labels) at 11–11.5px, letter-spacing .04–.06em, `{colors.faint}`.

## Layout & Spacing

Inherits the internal shell (left nav + top bar + content). Content max-width ~1080px. The Access Control and Users screens share the **client-scoped** pattern: a top bar carrying the **client selector** (see Components), then the scoped content. Cards use `{rounded.lg}`, `{spacing.card-pad-x}` horizontal padding, hairline `{colors.line}` dividers between project header / project-skill band / each study row. Skill chips wrap with `{spacing.chip-gap}`.

## Elevation & Depth

Flat by default (hairline borders do the work). Elevation is reserved for **transient surfaces**: the client-selector dropdown and the attach side panel use `{elevation.sh-lg}`; cards use at most `{elevation.sh-sm}`. The attach panel's scrim dims the background to `rgba(30,35,48,.32)` while keeping cards visible behind it.

## Shapes

Rounded, never sharp. `{rounded.sm}` inputs/badges, `{rounded.md}` chips/buttons/selector, `{rounded.lg}` cards/panels. Avatars: skill/entity icons in soft-tinted rounded squares (teal-50 for client-ready skills, lilac for studies, sand for projects — inherited from the prototype); user avatars are navy circles with initials.

## Components

- **Client selector [net-new]** — replaces the prototype's horizontal button row. Collapsed: a trigger (mono avatar chip + client name + code chip + chevron), `{rounded.md}`, `{colors.line-2}` border. Open: `{elevation.sh-lg}` dropdown with a search input (magnifier + placeholder "Search clients by name or code…") over a scrollable list; each option = avatar + name + "code · lead" sub-line; active option tinted `{colors.brand-50}` with a teal check; paused clients at ~55% opacity but selectable. Reuses the V3 `side-search` input styling.
- **Skill chip** — inherited; gains a hover-revealed detach ✕ (neutral `{colors.faint}` → `{colors.danger}` on hover).
- **Attach side panel [net-new behavior]** — right-docked, `{elevation.sh-lg}`; header states target ("to ONC-204 · Study · <project>"); client-ready-only search list; already-attached rows disabled with "Attached ✓". Visual shell is standard V3 panel; the *right-dock + stay-open* behavior is the new part (see EXPERIENCE.md).
- **Provisioning form** — standard V3 fields (label + input/select), 2-col grid; a teal-wash `{colors.brand-50}` callout explaining the Cognito invite.
- **Stepper [net-new]** — 3 dots (Create & invite → Grant access → Done); current = filled teal, done = teal-50 ring + check, upcoming = faint.
- **Users table** — standard table; status pills (Invited amber / Active teal); mono-initial navy avatars; row action "Resend".

## Do's and Don'ts

- **Do** wire to V3 CSS custom properties by name — never hard-code hex that duplicates a token.
- **Do** keep teal scarce: primary action, selected state, client-ready marker. Not decoration.
- **Do** use the amber Invited pill *only* for the pending-activation state.
- **Don't** introduce a new font, radius, or shadow — the V3 set covers every element here.
- **Don't** let any of these internal-admin surfaces leak into the client portal's visual language (they are internal chrome).
- **Don't** style destructive actions (detach, deactivate) in teal — that's `{colors.danger}` territory.
