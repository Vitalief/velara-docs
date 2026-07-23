---
baseline_commit: 8bcdb35 (top-level docs repo); velara-web on branch `development` (head 64171e7) when picked up. velara-api unaffected by this story (verify with `git status` before starting — do not touch it).
---

# Story 16.5: Consolidate Engagement-Screen Actions into a Single Menu

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Vitalief consultant,
I want each Client/Project/Study/Location card to expose its actions through a single menu instead of a row of separate buttons,
so that engagement screens are legible instead of cluttered.

## ⚠️ SCOPE — read this first

This story is **frontend-only** (`velara-web`). No backend route, schema, service, or migration
changes — every action this story touches already exists and already works; this story only
changes **HOW** those actions are presented, never **WHAT** they do or **WHO** can do them.

- Build the **first shared `Menu`/overflow-menu primitive** in `src/shared/components/` (confirmed:
  none exists — `grep -rliE "menu|dropdown|popover" src/shared/components/` returns zero hits).
- Consolidate `DetailActions` (Edit/Delete) into that menu on every detail header that renders it.
- Consolidate each header's entity-specific "Add" action (Add Project, Add Location, Add Study) into
  the same menu.
- **Do NOT** touch the per-skill **Run** button — it stays a distinct, always-visible primary action.
- **Do NOT** touch `NodeSkillAttachControls`'s own internal "+ Attach skill" trigger — see the scope
  decision below.
- **Do NOT** touch the row-level "Remove" buttons inside `StudyLocationsCard`/`StudyProtocolCard` —
  see the scope decision below.

**Two scope calls this story makes explicit (the epic-level AC text is ambiguous on both — resolve
them exactly this way, do not re-litigate):**

1. **`NodeSkillAttachControls`'s own trigger button is OUT of scope.** The epic AC2 text says
   "attach controls (per 16.3) collapse into the menu," but as shipped by Story 16.3,
   `NodeSkillAttachControls` (`src/features/admin/components/NodeSkillAttachControls.tsx`) is a
   **self-contained** component with its own "+ Attach skill" trigger (`:53-59`) and its own
   per-attached-skill detach chips (`:65-76`) — it is invoked from exactly one place, the Client
   detail's "Client skills" card header (`EngagementsScreen.tsx:888-892`), not from `DetailActions`
   or any card this story restructures. Folding its internal trigger into the new header menu would
   require reaching into a component Story 16.3 built as self-contained, for a single call site, with
   no reuse benefit. **Leave `NodeSkillAttachControls` exactly as it renders today** — its trigger
   button stays visible next to (not inside) the new "⋯" menu on the Client header. This story's
   AC2 is satisfied by consolidating `DetailActions` + the `ChildListCard`/`StudyLocationsCard`
   header "Add" button only.
2. **Row-level actions stay row-level; a header with only ONE action stays a plain button, never a
   one-item menu.** `StudyLocationsCard`'s per-Location "Remove" button (`:1075-1081`) and
   `StudyProtocolCard`'s "Remove" button (`:1136-1144`) are **row actions** (they act on one list item
   / one attached document), the same category as the per-skill "Run" button the epic explicitly keeps
   visible (AC3) — not **header** actions (which act on the entity the whole card/screen represents).
   A menu exists to consolidate 2+ actions; wrapping a single action in a one-item menu adds a click
   without reducing clutter. Verified against source: `ChildListCard`'s header (`:967-971`),
   `StudyLocationsCard`'s header (`:1037-1042`, "Associate Location"), and `StudyProtocolCard`'s header
   (`:1109-1114`, "Add Protocol") each render **exactly one** action button — none of them share a
   header with a second action (Edit/Delete for these cards live on the *parent* `DetailActions`, a
   separate header entirely). **All three stay plain, unwrapped buttons, unchanged.** The only header
   actions that consolidate into the new menu are the 4 `DetailActions` sites (Client/Project/Study/
   Location), because those are the only headers with 2+ actions today (Edit alone, or Edit+Delete).

## Acceptance Criteria

1. **AC1 — A shared `Menu`/dropdown component is introduced.** New file
   `src/shared/components/Menu.tsx` — confirmed no Menu/Dropdown/Popover primitive exists anywhere
   in `src/shared/components/` today. It must be a **generic, reusable primitive** (not an
   Engagements-only one-off): a trigger button + a positioned popup list of items, each item taking
   a label, an optional icon, an `onClick`, an optional `variant` (`'default' | 'danger'` — Delete
   needs to render styled like it does today, `text-danger`), and an optional `disabled`. Follows
   this codebase's existing dismiss/focus conventions (see Dev Notes "Reuse map" — three near-
   identical hand-rolled implementations already exist; do not add a 4th divergent one or reach for
   a new library).

2. **AC2 — Every per-entity header action consolidates into that menu.** `DetailActions`
   (`EngagementsScreen.tsx:919-941`) and each header's "Add" button collapse into a single "⋯" menu
   per card/detail header, replacing the always-visible button row:
   - **ClientDetail header** (`:851`): Edit → menu. (Note: ClientDetail's `DetailActions` call passes
     `onEdit` only, no `onDelete` — Clients have no delete action anywhere in this screen; confirm
     this is still true before assuming a Delete item belongs here — grep `onDelete` on the
     `ClientDetail` call site to be sure, do not add a Delete menu item that doesn't correspond to a
     real handler.)
   - **`ChildListCard`/`StudyLocationsCard`/`StudyProtocolCard` "Add X" header buttons
     (`:967-971`, `:1037-1042`, `:1109-1114`) stay plain buttons, unchanged** — per Scope decision #2
     above, none of these headers has a second action to consolidate with. **This AC's real
     consolidation targets are only the 4 `DetailActions` sites** below.
   - **ProjectDetail header** (`:1186`): Edit → menu.
   - **StudyDetail header** (`:1281`): Edit + Delete (`deleteLabel="Delete study {name}"`) → menu,
     2 items.
   - **LocationDetail header** (`:1383`): Edit + Delete → menu, 2 items.

3. **AC3 — "Run" stays a primary, visible action per skill row.** The per-skill Run button in
   `ProjectDetail` (`:1226-1230`) and `StudyDetail` (`:1334-1338`) is **untouched** — still a direct,
   visible button inside each skill row's `.map()`, never moved into a menu. This also means: do
   **not** touch `NodeSkillAttachControls`'s own detach chips (`:65-76`) or `StudyLocationsCard`'s
   per-row Remove (`:1075-1081`) or `StudyProtocolCard`'s Remove (`:1136-1144`) — see Scope decision
   #2 above; they are the same class of "row action, not header action" as Run, and stay visible.

4. **AC4 — No functional regression.** Every action reachable today remains reachable — clicking the
   new "⋯" trigger opens the menu, each item performs exactly the handler it performs today (`onEdit`,
   `onDelete`/`requestDelete*`, etc. — reuse the existing handlers verbatim, do not rewrite their
   logic). The existing `ConfirmDialog` delete flow (driven by lifted `deleteTarget` state,
   `EngagementsScreen.tsx:1684`, dialog rendered once at `:1997-2008`) is unaffected — a menu item's
   `onClick` calls the same `requestDeleteStudy`/`requestDeleteLocation` handlers that the current
   Delete button calls, then closes the menu; the dialog itself opens independently of the menu's own
   open/closed state, so there is no interference to guard against, only to preserve.

**Out of scope (do NOT touch):**
- `NodeSkillAttachControls`'s internal trigger/detach UI (Scope decision #1).
- Row-level Remove buttons in `StudyLocationsCard`/`StudyProtocolCard` (Scope decision #2).
- The per-skill Run button (AC3).
- Any backend route, schema, or service — this is a pure `velara-web` UI change.
- WHAT actions exist or WHO can perform them (that's 16.2/16.3/8.7's territory) — this story only
  changes HOW existing actions are presented.
- `EntityModal`, `ConfirmDialog`, `AssociateLocationPanel` internals — reused as-is, not refactored to
  share code with the new `Menu` (see Dev Notes: three divergent copies already exist; unifying them
  is a larger, separate refactor this story does not attempt — only the NEW header-action surface
  gets the new `Menu` component).

## Tasks / Subtasks

- [ ] **Task 1 — Build the shared `Menu` component (AC1)** — new file
      `src/shared/components/Menu.tsx`
  - [ ] Design as a generic trigger+popup: `<Menu trigger={<button>...</button>} items={[{label, icon?, onClick, variant?, disabled?}]} />`
    or a compound-component form (`<Menu><Menu.Trigger/><Menu.Item/></Menu>`) — dev's call; prefer
    the flatter `items` prop shape to match this codebase's existing preference for plain props over
    compound-component patterns (no compound components exist elsewhere in `shared/components/`).
  - [ ] **Trigger button**: renders `<Icon name="dots" size={13} />` (`Icon.tsx:36` — the only
    overflow-menu-shaped glyph in the set; it is a vertical 3-dot "kebab," confirmed no horizontal
    variant exists — do not invent a new icon or use emoji, HARD rule, see `Icon.tsx:1-4`). Style to
    match the existing icon-button footprint used by `DetailActions`'s buttons (`rounded-md border
    border-line-2 bg-surface px-2.5 py-1.5`, `EngagementsScreen.tsx:927-933`) so it doesn't look out
    of place next to `NodeSkillAttachControls`'s own trigger on the Client header.
  - [ ] **Dismiss behavior** — follow the established idiom from the three existing hand-rolled
    implementations (do not add a 4th divergent one, do not pull in a new npm dependency):
    - Escape closes the menu (see `ConfirmDialog.tsx:32-39`, `AssociateLocationPanel.tsx:56-88` for
      the `useEffect` + `keydown` listener pattern to mirror).
    - Click-outside closes the menu (see `AssociateLocationPanel.tsx:103-107`'s scrim-click pattern,
      or a `document` click listener that checks `event.target` against a `ref` — either is fine,
      pick whichever is less code for a popup that has no backdrop scrim, since this is an inline
      dropdown, not a full panel).
    - Clicking an item closes the menu **after** calling its `onClick` (do not close-then-call, or a
      state update inside `onClick` may race the unmount).
    - Focus: return focus to the trigger button on close (mirror
      `AccessControl.tsx:169`'s focus-restore pattern — `previouslyFocused.current?.focus()`).
    - **No full Tab-focus-trap needed** — unlike `EntityModal`/`ConfirmDialog` (which are modal
      overlays blocking the whole page), this is a small anchored popup; Escape + click-outside +
      focus-restore is sufficient and matches the weight of what's being built. Do not over-build a
      full modal-grade trap for a menu of 1-2 items.
  - [ ] Each item: `role="menuitem"`, the trigger `aria-haspopup="menu"` + `aria-expanded`. Delete-type
    items render with `variant="danger"` → the same `text-danger` styling `DetailActions`'s Delete
    button uses today (`EngagementsScreen.tsx:930`), so the visual weight of a destructive action is
    preserved inside the menu, not flattened to look identical to Edit.

- [ ] **Task 2 — Replace `DetailActions` internals with `Menu` (AC2, AC4)** —
      `EngagementsScreen.tsx:919-941`
  - [ ] Keep the `DetailActions` component (same name, same call sites, same props —
    `onEdit`/`onDelete`/`deleteLabel`) so none of its 4 call sites (`:851`, `:1186`, `:1281`, `:1383`)
    need to change — only its **internals** change from a `<div>` of buttons to a single `<Menu>`
    with 1 or 2 items (Edit always; Delete only when `onDelete` is passed — mirror the existing
    `{onDelete && (...)}` conditional, now as a conditional item in the `items` array instead of a
    conditional `<button>`).
  - [ ] Delete item: `label: 'Delete'`, `icon: 'trash'`, `variant: 'danger'`, `onClick: onDelete`,
    and thread `deleteLabel` through as the item's `aria-label` (tests assert on
    `getByRole('button', { name: /Delete study .../i })` today — see Task 4; decide whether the new
    menu item itself carries that aria-label, or whether it's only meaningful on the old top-level
    button — **the item needs an accessible name a test can still target**, so keep `deleteLabel` as
    the item's title/aria-label, not just visible text).
  - [ ] Edit item: `label: 'Edit'`, `icon: 'edit'`, `onClick: onEdit`.

- [ ] **Task 3 — Decide + implement card-header consolidation scope (AC2)**
  - [ ] Per the Scope decision above: audit each of `ChildListCard` (`:946-1013`, "Add" button
    `:967-971`), `StudyLocationsCard` (`:1015-1086`, "Associate Location" button `:1037-1042`), and
    `StudyProtocolCard` (`:1094-1148`, "Add Protocol" button `:1109-1114`) — confirm each header has
    **exactly one** action button today (no Edit/Delete alongside the Add/Associate button at that
    card's own header — those live on the *parent* `DetailActions`, a separate header). If confirmed
    (expected outcome, verify against current source before writing code), **leave these three
    "Add X" buttons as plain buttons, unchanged** — do not wrap a single action in a menu. Only the 4
    `DetailActions` sites (Task 2) get the new `Menu`.
  - [ ] If the audit finds a header that in fact has 2+ actions today (i.e. this story's own
    understanding above is wrong against current `development` HEAD), consolidate that header's
    actions into a `Menu` the same way as Task 2, and note the correction in the Dev Agent Record.

- [ ] **Task 4 — Update tests (AC4)** — `EngagementsScreen.test.tsx`
  - [ ] Every test that queries a now-menu-nested action must open the menu first, then query the
    item. Representative sites needing this change (not exhaustive — grep the full file for every
    `getByRole('button', ...)` against Edit/Delete text before considering this done):
    - `:481` — `Edit` button query.
    - `:714` — `Delete study {name}` query (opens menu, was a direct click before).
    - `:720` — `^Delete study$` confirm-button query (inside `ConfirmDialog` — unaffected, this is
      the dialog's own confirm button, not a menu item; only the trigger sequence before it changes).
  - [ ] `StudyLocationsCard`'s `:783` (`Associate Location`) and `StudyProtocolCard`'s `:751`
    (`Remove protocol from this study`) queries are **unaffected** if Task 3's audit confirms those
    stay plain buttons — do not touch these tests unless Task 3 finds otherwise.
  - [ ] Add new `Menu.test.tsx` (co-located, `src/shared/components/Menu.test.tsx`): trigger opens
    the menu, Escape closes it, click-outside closes it, item click fires its `onClick` and closes
    the menu, focus returns to the trigger on close.
  - [ ] Gates: `tsc --noEmit` + `eslint` clean; `vitest run` green (0 regressions). Both wholesale
    `useEngagements`-mock files (`src/routes/internal.test.tsx`, `src/pages/LogoutFlow.test.tsx`) are
    **not** affected by this story (no new hooks added — this is a pure presentation change with zero
    API-layer surface), but re-run them anyway as part of the full suite to confirm.

## Dev Notes

### The exact change surface (verified against source — line numbers current on `development` @ `64171e7`)

| File | What changes |
|---|---|
| `src/shared/components/Menu.tsx` (new) | The shared overflow-menu primitive (AC1). |
| `src/shared/components/Menu.test.tsx` (new) | Co-located tests for the primitive. |
| `EngagementsScreen.tsx:919-941` | `DetailActions` internals rewritten to render `<Menu>` instead of a button row. Same external props/call sites. |
| `EngagementsScreen.test.tsx` | Update tests that query Edit/Delete buttons to open the menu first (Task 4). |

**No other files change.** This is deliberately the smallest possible change surface — one new
component, one existing component's internals, one test file. If your diff is touching
`ChildListCard`, `StudyLocationsCard`, or `StudyProtocolCard` beyond what Task 3's audit justifies,
stop and re-check the scope decisions above.

### ⚠️ Non-obvious traps (verified against source — read before writing code)

**Trap 1 — `NodeSkillAttachControls` is NOT a `DetailActions` call site.** It's tempting to read
epic AC2's "attach controls (per 16.3) collapse into the menu" literally and go looking for how to
merge `NodeSkillAttachControls`'s trigger into a `Menu`. Don't. `NodeSkillAttachControls`
(`src/features/admin/components/NodeSkillAttachControls.tsx:20`) is invoked exactly once, on the
Client header's "Client skills" card (`EngagementsScreen.tsx:888-892`) — a **different** header than
the one carrying `DetailActions` (the Client entity header at `:851`, a separate `<Card>` above the
skills card). They are not competing for the same menu. Leave `NodeSkillAttachControls` completely
untouched (Scope decision #1).

**Trap 2 — most "Add X" buttons don't actually need a menu.** A menu exists to *consolidate 2+
actions*. `ChildListCard`, `StudyLocationsCard`, and `StudyProtocolCard` headers each render exactly
**one** action button today (verified: `:967-971`, `:1037-1042`, `:1109-1114`) — there is nothing to
consolidate them *with* at that header. Wrapping a single button in a one-item menu adds a click
without reducing clutter — the opposite of this story's purpose. Task 3 requires an explicit
verification pass (re-read current source, don't trust this story's snapshot blindly, code moves) but
the expected, verified-at-authoring-time outcome is: **only the 4 `DetailActions` sites
(ClientDetail/ProjectDetail/StudyDetail/LocationDetail headers) get the new `Menu`.**

**Trap 3 — ClientDetail's `DetailActions` call has no `onDelete`.** `EngagementsScreen.tsx:851`
calls `<DetailActions onEdit={onEdit} />` — no `onDelete` prop. There is no Client-delete action
anywhere in this screen today. Do not add a Delete menu item to the Client header menu; it would be a
functional **addition** (a new capability), which AC4 explicitly forbids ("pure UI consolidation, not
a scope change").

**Trap 4 — the Delete item needs to keep its accessible name.** `EngagementsScreen.test.tsx:714`
queries `getByRole('button', { name: /Delete study ONC-204 Phase II/i })` — driven by
`DetailActions`'s `deleteLabel` prop threaded to `aria-label` (`:929` today). When Delete becomes a
menu item instead of a top-level button, that same dynamic `aria-label` (or an equivalent accessible
name) must still resolve on the item itself — a test opening the menu then querying by that same name
must still find it. Don't flatten every item to a generic "Delete" with no dynamic study name; you'll
silently break test specificity (two Studies in a list test would both match a bare "Delete").

**Trap 5 — item `onClick` order: call handler THEN close, not close THEN call.** If the menu's own
`onClick` wrapper closes the popup (unmounting it) before invoking the item's real `onClick`, and that
`onClick` synchronously reads any menu-local state (unlikely here, since handlers are all lifted
props like `onEdit`/`onDelete`, but keep the ordering discipline anyway) — call the real handler
first, then close. This also matters because `requestDeleteStudy`/`requestDeleteLocation`
(`EngagementsScreen.tsx:1789-1801`) just set `deleteTarget` state; they don't care about menu
lifecycle, but establishing "handler first, close second" as the pattern avoids a future bug once a
menu item's handler does something that depends on the menu still being mounted (e.g. a toast anchored
to the trigger).

**Trap 6 — don't reach for a new dependency.** No portal/positioning library (`@floating-ui/react`,
`radix-ui`, etc.) exists in this codebase's `package.json` today (confirmed: three existing
dismissible-UI implementations are all hand-rolled `useEffect`+`useRef`, no shared library). Adding
one for a single dropdown is exactly the kind of "not boring technology" this codebase's architecture
docs steer against — build `Menu` the same hand-rolled way `ConfirmDialog`/`AssociateLocationPanel`
already do.

### Reuse map (do NOT rebuild)

- **Dismiss/focus idiom** (Escape + click-outside + focus-restore) — three existing hand-rolled
  implementations to mirror, pick the lightest since `Menu` is a small anchored popup, not a full
  modal:
  - `src/features/skills/components/ConfirmDialog.tsx:26-58` — focus-on-open, Escape, Tab-trap,
    click-outside-to-cancel.
  - `src/features/engagements/components/AssociateLocationPanel.tsx:56-107` — combined
    focus+Escape+Tab-trap+focus-restore effect, scrim click-outside.
  - `src/features/admin/components/AccessControl.tsx` — `DetachDialog` Escape (`:82`), `AttachPanel`
    focus-restore (`:169`) + Escape (`:172`) + `role="dialog"` (`:223`).
- **Icon** — `src/shared/components/Icon.tsx:36` (`dots` glyph, vertical kebab — the only
  overflow-menu-shaped icon; `Icon.tsx:64-96` for the component's render pattern). **Never emoji**
  (HARD codebase rule, `Icon.tsx:1-4`).
- **Existing button styling to match** — `DetailActions`'s current buttons
  (`EngagementsScreen.tsx:927-933` Delete, `:936-940` Edit) for the trigger's visual weight and the
  danger-variant styling to carry into the menu item.
- **Delete flow (unaffected, just re-triggered from a menu item)** — `deleteTarget` state
  (`EngagementsScreen.tsx:1684`), `requestDeleteStudy`/`requestDeleteLocation`/
  `requestDisassociateLocation` handlers (`:1789-1801`), single `ConfirmDialog` instance
  (`:1997-2008`). Not nested inside any trigger's DOM subtree — a menu closing on item-click cannot
  interfere with it opening.

### Data model & flow facts (verified)

- `DetailActions` call sites and their exact prop shapes (all verified against
  `EngagementsScreen.tsx` on `development` @ `64171e7`):
  - ClientDetail `:851` → `<DetailActions onEdit={onEdit} />` (Edit only, no Delete).
  - ProjectDetail `:1186` → `<DetailActions onEdit={onEdit} />` (Edit only, no Delete).
  - StudyDetail `:1281` → `<DetailActions onEdit={onEdit} onDelete={onDelete} deleteLabel={\`Delete study ${study.name}\`} />`
    (Edit + Delete).
  - LocationDetail `:1383` → `<DetailActions onEdit={onEdit} onDelete={onDelete} deleteLabel={\`Delete location ${location.name}\`} />`
    (Edit + Delete, verified).
- `NodeSkillAttachControls` (`src/features/admin/components/NodeSkillAttachControls.tsx`, 99 lines):
  self-contained trigger (`:53-59`) + detach chips (`:65-76`) + `AttachPanel`/`DetachDialog`
  (`:85-97`). Invoked only from `EngagementsScreen.tsx:888-892` (Client header). Project (`:1199-1216`)
  and Study (`:1305-1324`) render read-only "Available skills" lists with no attach control (empty
  state text "No skills available — attach at the Client." at `:1216`/`:1324`, verified).
- Per-skill Run buttons: ProjectDetail `:1226-1230` (inside `.map()` starting `:1219`), StudyDetail
  `:1334-1338` (inside `.map()` starting `:1327`). Structurally nested inside the skills-list map, not
  inside any header component this story touches.
- `Icon` name set: `src/shared/components/Icon.tsx:6-60` (`ICONS` map). `dots` at `:36` is the only
  kebab/overflow glyph; no horizontal 3-dot variant exists.
- `shared/components/` full inventory (confirms no Menu exists today): `AppBar.tsx`,
  `ErrorBoundary.tsx`, `Field.tsx`, `Icon.tsx`, `NavTabs.tsx`, `RequireAuth.tsx`, `RequireClient.tsx`,
  `RequireGrantor.tsx`, `RequireInternal.tsx`, `Skeleton.tsx`, `Toast.tsx`, `Toggle.tsx`, `VLogo.tsx`,
  `navTabsData.ts`.

### Testing standards

- Frontend only: Vitest + React Testing Library, co-located `*.test.tsx`
  (`src/shared/components/Menu.test.tsx` new; `EngagementsScreen.test.tsx` updated). No backend test
  changes — this story has zero `velara-api` surface.
- `tsc --noEmit` + `eslint` clean; `vitest run` green, 0 regressions. Re-run the two wholesale
  `useEngagements`-mock files (`src/routes/internal.test.tsx`, `src/pages/LogoutFlow.test.tsx`) as
  part of the full suite even though this story adds no new hooks — confirm they still pass rather
  than assuming.
- No backend rebuild needed (no `velara-api` change). No `docs/api-spec.json` regen (no route/schema
  change).

### Git / build context

- `velara-web` on `development` (head `64171e7`) — separate nested git repo from the top-level docs
  repo; `cd`ing there shifts Bash cwd, `cd` back for docs-publish git commands.
- `velara-api` is on `development` (head `e6ded75`) but **untouched by this story** — do not `cd`
  into it, do not rebuild its image, do not run its test suite for this story.
- Do NOT commit `velara-web` (never-push-subrepos rule — dev-story only commits the top-level docs
  repo; code-review commits the subrepo post-review).

### Project Structure Notes

- Frontend only: `src/shared/components/Menu.tsx` (new) + `Menu.test.tsx` (new, co-located, matches
  the existing `NavTabs.tsx`/`NavTabs.test.tsx`, `RequireGrantor.tsx`/`RequireGrantor.test.tsx`
  co-location convention already established in this directory);
  `src/features/engagements/components/EngagementsScreen.tsx` (internals of `DetailActions` only) +
  its co-located `EngagementsScreen.test.tsx`. No new directories. No backend directories touched.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-16-engagement-model-refinement.md#Story-16.5] —
  parent epic story (the epic-level AC contract this story expands and, in two places, narrows with
  an explicit scope decision — see "⚠️ SCOPE" above).
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-20-engagement-model-refinement.md#4.2] —
  original correct-course proposal; confirms "no `Menu`/`Dropdown` component exists" and the
  Run-stays-visible / no-functional-regression intent.
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L919-L941] —
  `DetailActions`, the primary rewrite target.
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L815-L1013] —
  `ClientDetail` + `ChildListCard`, confirms single-action headers (Trap 2).
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L1015-L1148] —
  `StudyLocationsCard` + `StudyProtocolCard`, confirms header action counts (Task 3 audit baseline).
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L1150-L1346] —
  `ProjectDetail` + `StudyDetail`, confirms per-skill Run button placement (AC3) and `DetailActions`
  call-site prop shapes.
- [Source: velara-web/src/features/admin/components/NodeSkillAttachControls.tsx] — confirmed
  self-contained, single call site, out of scope (Scope decision #1 / Trap 1).
- [Source: velara-web/src/shared/components/Icon.tsx#L6-L60,L36] — `ICONS` map + the `dots` glyph to
  use for the menu trigger; no-emoji rule at `:1-4`.
- [Source: velara-web/src/features/skills/components/ConfirmDialog.tsx#L26-L58] — dismiss/focus idiom
  #1 to mirror.
- [Source: velara-web/src/features/engagements/components/AssociateLocationPanel.tsx#L56-L107] —
  dismiss/focus idiom #2 to mirror.
- [Source: velara-web/src/features/admin/components/AccessControl.tsx] — dismiss/focus idiom #3
  (`DetachDialog`/`AttachPanel`) to mirror.
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.tsx#L1684,L1789-L1801,L1997-L2008] —
  the lifted `deleteTarget` state + `ConfirmDialog` instance the new menu's Delete item re-triggers,
  unmodified.
- [Source: velara-web/src/features/engagements/components/EngagementsScreen.test.tsx#L481,L714,L720,L751,L783] —
  existing test assertions that change (open-menu-first) vs. stay as-is, per Task 4.
- [Source: _bmad-output/implementation-artifacts/stories/16-4-study-creation-time-protocol-upload.md] —
  prior Epic 16 story: confirms `StudyProtocolCard` exists and its header button shape (relevant to
  Task 3's audit), the never-push-subrepos discipline, and the doc's own precedent for "explicit scope
  decision documented up front" story structure.
- [Source: _bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md] —
  frontend structure conventions (feature-first directories, `shared/` for reusable components,
  co-located tests, `PascalCase.tsx` naming) — all followed by this story's file placement.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-07-23 — Story drafted (create-story). Frontend-only, zero backend surface. Narrows the epic's
  literal AC2 ("attach controls collapse into the menu") via two explicit scope decisions, both
  verified against current source before being written: (1) `NodeSkillAttachControls`'s own trigger
  is a self-contained, single-call-site component on a *different* header than `DetailActions` and is
  left untouched; (2) row-level Remove actions (`StudyLocationsCard`, `StudyProtocolCard`) are the
  same class as the epic's own Run-stays-visible carve-out and stay visible — only the 4
  `DetailActions` sites (Client/Project/Study/Location headers) are confirmed to have 2+ actions
  worth consolidating; every other header's lone "Add X" button is confirmed single-action and
  explicitly kept as a plain button rather than wrapped in a one-item menu.
