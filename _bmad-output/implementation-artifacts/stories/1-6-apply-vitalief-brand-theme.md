---
baseline_commit: 5542d45b089c2870fe85e0ca7a46a3e34a8b28a3
---

# Story 1.6: Apply Vitalief V3 Brand Theme

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the platform's design tokens re-mapped to the Vitalief V3 brand (from the client's brand guidelines),
so that every screen built from here on uses the correct brand colors and fonts.

> Added 2026-06-09 (see [sprint-change-proposal-2026-06-09.md](../../planning-artifacts/sprint-change-proposal-2026-06-09.md)). Source of truth: client `design/uploads/Brand Colors.png` → [design/styles_v3.css](../../../design/styles_v3.css) / [design/app_v3.jsx](../../../design/app_v3.jsx) / [design/Velara v3.html](../../../design/Velara%20v3.html). Re-themes the **done** Story 1.2 scaffold; no feature screens exist yet (Epics 2+ are backlog), so this is a low-risk, high-leverage token swap done **before** Epic 2 UI so every future screen is born brand-correct.

## Acceptance Criteria

1. **Given** [src/index.css](../../../velara-web/src/index.css) (Tailwind v4 `@theme`) is updated from `design/styles_v3.css`, **When** I inspect the tokens, **Then** the Vitalief brand palette is mapped — primary teal `#128F8B`, ink navy `#323843`, slate `#4C5270`, pink `#F652A0` accent, danger `#d4186c` — replacing the evergreen values, and the `--color-green-*` tokens are renamed to `--color-brand-*` for clarity.

2. **Given** the typography tokens are updated, **When** I inspect the font setup, **Then** headings use **Poppins**, body uses **Open Sans**, mono stays **IBM Plex Mono** — self-hosted via `@fontsource` (no third-party CDN, per Story 1.2's HIPAA decision); the Georgia / Source Sans 3 fonts are removed.

3. **Given** Vitalief has not yet provided licensed **Nexa** font files (the brand-exact heading font), **When** the theme is applied, **Then** Poppins is used for headings as the approved stand-in; swapping in Nexa later is a font-file + token change only.

4. **Given** the AppBar and nav chrome render, **When** I view the app, **Then** the AppBar is the navy/teal brand bar and the active nav tab is underlined in brand teal (per UX-DR-02 / UX-DR-03).

5. **Given** the re-theme is complete, **When** I run `npm run build` and `npm run typecheck`, **Then** both pass, the running app visually matches `design/Velara v3.html`, and **no evergreen / Georgia / Source-Sans tokens or `green-*` utility classes remain** in `src/index.css` or the components.

**Dependencies:** Optional — Nexa XBold/Regular font files from Vitalief (brand asset, per PRD A5) for exact-match headings. The story ships complete with Poppins; Nexa is a later font-file + token swap. [Source: `design/styles_v3.css`, `design/app_v3.jsx`, `design/uploads/Brand Colors.png`]

## Tasks / Subtasks

- [x] **Task 1 — Re-map the `@theme` color + geometry tokens in `src/index.css`** (AC: #1)
  - [x] Replace the entire `@theme { … }` block with the V3 token map in **Dev Notes → "Complete `@theme` target"** (copy-paste ready). Surfaces, ink, borders, status, two-key, danger, radius, shadow all change values per `styles_v3.css`.
  - [x] Rename every `--color-green-*` → `--color-brand-*` (values become the teal/navy scale). Add the new `--color-brand-400` rung (V3 adds it).
  - [x] Add `--color-slate: #4C5270` and `--color-accent: #F652A0` (pink) — new in V3.
  - [x] Update `--color-danger` to `#d4186c` and `--color-danger-bg` to `#fde8f3`.
- [x] **Task 2 — Re-map typography tokens + base styles** (AC: #2, #3)
  - [x] Set `--font-serif: 'Poppins', …` (headings stand-in for Nexa), `--font-sans: 'Open Sans', …` (body), keep `--font-mono: 'IBM Plex Mono', …`. (Keep the **token key names** `--font-serif/sans/mono` so existing `font-serif`/`font-sans`/`font-mono` utilities keep working — see Dev Notes "Why keep the font-token keys".)
  - [x] Update the base `body` rule (`var(--font-sans)`, `var(--color-paper)`, `var(--color-ink)`) and the `h1–h4` rule (`var(--font-serif)`, `font-weight: 700`, `letter-spacing: -0.02em`) to match `styles_v3.css`.
- [x] **Task 3 — Swap the self-hosted font packages** (AC: #2, #3)
  - [x] `package.json`: remove `@fontsource/source-sans-3`; add `@fontsource/poppins` and `@fontsource/open-sans` (same `^5.x` line as the other `@fontsource` deps). Keep `@fontsource/ibm-plex-mono`.
  - [x] Run `npm install` (the two new packages are **not** in `node_modules` yet).
  - [x] [src/main.tsx](../../../velara-web/src/main.tsx): replace the four `@fontsource/source-sans-3/*.css` imports with Open Sans `400/500/600/700` + Poppins `500/600/700`; leave the IBM Plex Mono imports. Update the comment.
  - [x] **Do NOT** add the Google Fonts `<link>` that appears in `design/Velara v3.html` — that is a CDN and violates the Story 1.2 no-third-party-CDN HIPAA decision. Self-host only.
- [x] **Task 4 — Rename `green-*` utility classes in components → `brand-*`** (AC: #1, #5) — **mandatory, see the gotcha below**
  - [x] [src/shared/components/AppBar.tsx](../../../velara-web/src/shared/components/AppBar.tsx): `bg-green-900`→`bg-brand-900`, `text-green-900`→`text-brand-900` (×2), `bg-green-600`→`bg-brand-600`.
  - [x] [src/shared/components/NavTabs.tsx](../../../velara-web/src/shared/components/NavTabs.tsx): `border-green-600`→`border-brand-600`, `text-green-800`→`text-brand-800`.
  - [x] [src/pages/LoginPage.tsx](../../../velara-web/src/pages/LoginPage.tsx): `text-green-900`→`text-brand-900`, `ring-green-700`→`ring-brand-700` (×2), `bg-green-800`→`bg-brand-800`, `hover:bg-green-700`→`hover:bg-brand-700`.
- [x] **Task 5 — Update the AppBar dark-bar chrome to V3 navy/teal** (AC: #4, #5)
  - [x] Update the hardcoded evergreen-tinted text hexes on the dark AppBar to the V3 blue-grey set (mapping table in Dev Notes). Also update the `LoginPage` `VLogo color="#102a24"` → `"#323843"` (navy).
  - [x] Refresh the JSDoc/comments in `AppBar.tsx` and `NavTabs.tsx` that say "evergreen background" / "app_v2.jsx" → "navy brand bar" / "app_v3.jsx" (doc accuracy).
- [x] **Task 6 — Verify** (AC: #5)
  - [x] `npm run typecheck` → 0 errors; `npm run lint` → clean; `npm run test` → all green (no regressions); `npm run build` → clean `dist/`.
  - [x] `npm run dev` and eyeball against `design/Velara v3.html`: navy AppBar, teal primary buttons, teal active-tab underline, Poppins headings, Open Sans body. Confirm `grep -rn "green-[0-9]\|Georgia\|Source.?Sans\|evergreen" src` returns **nothing** (comments included).

## Dev Notes

### Scope & intent

This is a **theming-only** story: re-point the design tokens and the handful of places that hardcode the old palette. **No features, routes, data, or component structure change.** The web app is a scaffold (Story 1.2, done) with only the app shell, login, and placeholder routes — so there is almost no surface area, which is exactly why we re-theme now. The canonical source of truth is `design/styles_v3.css` (the V3 prototype's stylesheet); `design/Velara v3.html` is the visual target; `design/app_v3.jsx` shows the chrome.

### 🚨 CRITICAL GOTCHA — the `green-*` → `brand-*` rename is a silent-regression trap

Tailwind v4 ships a **built-in default `green` palette**. Today `src/index.css` *overrides* `--color-green-900` etc. in `@theme`, so `bg-green-900` renders our evergreen. **The moment you rename the tokens to `--color-brand-*` and remove `--color-green-*`, every `bg-green-900` / `text-green-800` / `border-green-600` / `ring-green-700` in the components silently falls back to Tailwind's stock bright-green palette** — `npm run build` and `npm run typecheck` will still pass, but the UI will be wrong (generic green buttons/tabs, not teal). This is why **Task 4 is mandatory and must land in the same change as Task 1.** After the rename, `grep -rn "green-[0-9]" src` must return zero hits. The exact, complete list of utility-class sites is in Task 4 (verified against the current tree — there are no others).

### Files to modify (current-state analysis — read before editing)

| File | Current state (as-built) | What this story changes | Must preserve |
|---|---|---|---|
| `velara-web/src/index.css` | `@import "tailwindcss"` + `@theme` with **evergreen** `--color-green-*`, Georgia/Source-Sans `--font-*`, evergreen-tinted shadows; base `body`/`h1–h4`. | Full token re-map to V3 (palette, fonts, shadows); `green-*`→`brand-*`; add slate + accent; base styles to weight-700/-0.02em headings. | The Tailwind v4 `@theme` mechanism (no `tailwind.config.ts`, no `postcss.config.js`); token **structure** and the `--color-*`/`--font-*`/`--radius-*`/`--shadow-*` naming convention that drives utilities. |
| `velara-web/src/main.tsx` | Imports `@fontsource/source-sans-3/{400,500,600,700}` + `@fontsource/ibm-plex-mono/{400,700}`, then `./index.css`. | Swap Source Sans → Open Sans + Poppins imports. | Import order (fonts before `./index.css`), `<StrictMode>`, `createRoot` — untouched. |
| `velara-web/package.json` | `@fontsource/source-sans-3`, `@fontsource/ibm-plex-mono` deps. | `- source-sans-3`, `+ open-sans`, `+ poppins`. | Everything else; keep `^5.x` versioning to match. |
| `velara-web/src/shared/components/AppBar.tsx` | 52px dark bar, `bg-green-900`, evergreen-tinted text hexes, role switch, access pill, search, user row. JSDoc says "evergreen / app_v2.jsx". | `green-*`→`brand-*`; dark-bar text hexes → V3 blue-grey; comment refresh. | All structure, behavior, the ⌘K palette, role-switch logic, the rendered text strings ("Velara", "A Vitalief Skills Platform", "Full access", "Search") — **AppBar.test.tsx asserts these and must keep passing.** |
| `velara-web/src/shared/components/NavTabs.tsx` | 44px white strip; active tab `border-green-600 text-green-800`. | `green-*`→`brand-*` (active underline becomes teal). JSDoc refresh. | The 6 tabs, `activeTab`/`onTabChange` contract, default behavior. |
| `velara-web/src/pages/LoginPage.tsx` | Dev login; uses `text-green-900`, `ring-green-700`, `bg-green-800/700`, `VLogo color="#102a24"`. | `green-*`→`brand-*`; `VLogo` color → navy `#323843`. | All Story 1.4 login logic + Story 1.5 `usePageTitle('Sign In')` — untouched. |

There is **no `tailwind.config.ts`** and **no `design-tokens.ts`** in `velara-web` (Tailwind v4 is CSS-first; tokens live entirely in `src/index.css @theme`). The architecture docs mention a `design-tokens.ts` "token export" — that is aspirational/stale; the **as-built reality from Story 1.2 is `src/index.css`**. Do **not** create a `design-tokens.ts`. [Source: 1-2-velara-web-project-scaffold.md#Tailwind-v4-Design-Tokens]

### Complete `@theme` target for `src/index.css` (copy-paste ready)

Translated from `design/styles_v3.css :root` into Tailwind v4 `@theme` naming (`--paper`→`--color-paper`, `--green-*`→`--color-brand-*`, `--r-*`→`--radius-*`, `--sh*`→`--shadow*`, `--serif/sans/mono`→`--font-serif/sans/mono`):

```css
@import "tailwindcss";

@theme {
  /* ── Surfaces ── */
  --color-paper:         #f4f6f9;
  --color-surface:       #ffffff;
  --color-surface-2:     #f8f9fc;
  --color-surface-sunk:  #edf0f4;

  /* ── Ink ── */
  --color-ink:           #323843;   /* navy */
  --color-ink-2:         #4c5270;   /* slate */
  --color-muted:         #6b7280;
  --color-faint:         #9ca3af;

  /* ── Vitalief brand palette — teal/navy scale (was evergreen --green-*) ── */
  --color-brand-900:     #2e3440;   /* navy — AppBar background */
  --color-brand-800:     #128f8b;   /* primary teal */
  --color-brand-700:     #0d6b68;
  --color-brand-600:     #128f8b;
  --color-brand-500:     #18a8a5;
  --color-brand-400:     #34c5c2;   /* new in V3 */
  --color-brand-300:     #7edbd8;
  --color-brand-100:     #c8f0ee;
  --color-brand-50:      #e6f8f8;

  /* ── Accents (new in V3) ── */
  --color-slate:         #4c5270;
  --color-accent:        #f652a0;   /* pink */

  /* ── Borders ── */
  --color-line:          #e2e6ec;
  --color-line-2:        #d1d7e0;
  --color-line-strong:   #bec5d0;

  /* ── Status: Skill lifecycle ── */
  --color-st-draft:      #828a96;
  --color-st-draft-tx:   #5b626d;
  --color-st-draft-bg:   #eef0f3;
  --color-st-draft-bd:   #d6dae1;
  --color-st-internal:   #4c5270;
  --color-st-internal-tx:#363b54;
  --color-st-internal-bg:#eceef5;
  --color-st-internal-bd:#c8ccdd;
  --color-st-client:     #128f8b;
  --color-st-client-tx:  #0d6b68;
  --color-st-client-bg:  #e6f8f8;
  --color-st-client-bd:  #a8dedd;
  --color-st-retired:    #998d86;
  --color-st-retired-bg: #f1eeeb;
  --color-st-retired-bd: #ddd6cf;

  /* ── Two-key certification ── */
  --color-key-tech:      #128f8b;
  --color-key-tech-bg:   #e6f8f8;
  --color-key-method:    #4c5270;
  --color-key-method-bg: #eceef5;

  /* ── Danger ── */
  --color-danger:        #d4186c;
  --color-danger-bg:     #fde8f3;

  /* ── Typography (Vitalief V3 → design/styles_v3.css) ── */
  --font-serif: 'Poppins', system-ui, -apple-system, sans-serif;   /* headings — Nexa stand-in */
  --font-sans:  'Open Sans', system-ui, -apple-system, sans-serif; /* body / UI */
  --font-mono:  'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* ── Border radius ── */
  --radius-sm:  6px;
  --radius:     9px;
  --radius-lg:  12px;
  --radius-xl:  18px;

  /* ── Shadows (navy-tinted) ── */
  --shadow-sm:  0 1px 2px rgba(50,56,67,.05), 0 1px 1px rgba(50,56,67,.04);
  --shadow:     0 4px 16px -6px rgba(50,56,67,.12), 0 1px 3px rgba(50,56,67,.06);
  --shadow-lg:  0 24px 60px -24px rgba(30,35,48,.28), 0 6px 18px -10px rgba(30,35,48,.16);
}

/* ── Base styles matching design/styles_v3.css ── */
body {
  font-family: var(--font-sans);
  background-color: var(--color-paper);
  color: var(--color-ink);
  font-size: 14.5px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 {
  font-family: var(--font-serif);
  font-weight: 700;
  letter-spacing: -0.02em;
}
```

> Optional polish (matches V3, not required by ACs): add `::selection { background: var(--color-brand-100); }` to the base block. The full `styles_v3.css` also defines many component classes (`.btn`, `.card`, `.appbar`, …); the velara-web scaffold builds chrome with **Tailwind utilities, not those classes**, so do not port the component CSS — only the tokens + base typography belong in `index.css`.

### Fonts — self-hosted via `@fontsource` (HIPAA: no third-party CDN)

Story 1.2 deliberately moved off Google Fonts to **self-hosted `@fontsource` packages** (privacy/CSP/offline; the `index.html` comment and `main.tsx` document this). Keep that pattern. The V3 prototype HTML uses a Google Fonts `<link>` for convenience — **ignore it.**

New `src/main.tsx` font imports (weights chosen to cover real usage: headings/wordmark are 700, subheads 600; body 400–700; the prototype requests Poppins 400–800 and Open Sans 400–700 via CDN, we self-host the used subset):

```ts
// Self-hosted fonts (no third-party CDN — privacy/CSP/offline, per Story 1.2 HIPAA decision).
// Weights match the design tokens in index.css: Open Sans 400/500/600/700 (body),
// Poppins 500/600/700 (headings — Nexa stand-in), IBM Plex Mono 400/700.
import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/500.css'
import '@fontsource/open-sans/600.css'
import '@fontsource/open-sans/700.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/700.css'
import './index.css'
```

**Nexa (AC #3):** brand-exact heading font, commercial, not yet licensed. Poppins is the approved stand-in. When Vitalief delivers the files, the later swap is: add the Nexa `@fontsource`/local `@font-face`, change `--font-serif` to `'Nexa'`, drop Poppins — token + font-file only, no component edits. Document this in a code comment near `--font-serif`.

#### Why keep the `--font-serif` / `--font-sans` / `--font-mono` token **keys**

`styles_v3.css` renames them to `--serif/--sans/--mono`, but in Tailwind v4 the **key name generates the utility** (`--font-serif` → `font-serif`). The scaffold's `AppBar.tsx` (wordmark) and `LoginPage.tsx` use `font-serif`. Keep the keys (`--font-serif` etc.) and only change the **values** to avoid breaking those utilities. The "serif" key is now just an alias for "heading font (Poppins)" — note that in a comment. (Renaming to `--font-heading`/`--font-body` is a larger, out-of-scope churn that would force more component edits for no AC benefit.)

### AppBar dark-bar chrome — V3 navy/teal (AC #4, #5)

The AppBar background flips evergreen→navy automatically via `bg-green-900`→`bg-brand-900` (token value `#2e3440`). But the **hardcoded evergreen-tinted text hexes** on the dark bar will clash against navy — update them to the V3 blue-grey set from `styles_v3.css` `.appbar*` / `.roleswitch`:

| `AppBar.tsx` line(s) | Element | Old (evergreen-tinted) | New (V3 blue-grey) |
|---|---|---|---|
| 56 | "A Vitalief Skills Platform" sub | `#5e8278` | `#6a9eb8` |
| 66 | Search button text | `#9fb5ac` | `#8ab8cc` |
| 66, 82, 91, 116 | hover / user name | `#dfeae5` | `#d5e8f2` |
| 69, 117 | ⌘K kbd / "Methodology key" | `#6a8f85` | `#6da8bc` |
| 82, 91 | role-switch inactive text | `#8aaea6` | `#8ab8cc` |
| 100 | access pill text | `#9bbdb5` | `#8ab8cc` |

The access-status dots at line 103 (`#6fd6b8` / `#7cc0d8`) read fine on navy and are optional to touch. Role-switch **active** text is `text-green-900`→`text-brand-900` (navy on white pill) — handled by Task 4. NavTabs active underline becomes teal automatically once `border-green-600`→`border-brand-600`.

### What must be preserved (don't break)

- **AppBar.test.tsx** (content-based) must stay green: it asserts the strings "Velara", "A Vitalief Skills Platform", role buttons "Vitalief team" / "Client portal", "Full access", "Search". Don't rename those strings. No test asserts colors/classes, so the rename itself won't break tests — but run the full suite to confirm.
- **`useDocumentTitle` / route titles (Story 1.5)** and **auth/login flow (Story 1.4)** are untouched — only LoginPage's color classes and `VLogo` color change.
- The Tailwind v4 wiring (`@tailwindcss/vite` plugin, no config files), the `meta` envelope, ErrorBoundary/Sentry, and all `--color-*`→utility mappings stay intact.
- `dist/` is build output — it regenerates on `npm run build`; don't hand-edit it.

### Testing requirements

No new test is required by the ACs, but the change is verified by the existing gates plus a visual check:
- `npm run typecheck` (0 errors), `npm run lint` (clean), `npm run test` (existing Vitest suite — ~48 tests from Story 1.5 — all pass, 0 regressions), `npm run build` (clean `dist/`).
- **Grep gate (AC #5):** `grep -rn "green-[0-9]\|Georgia\|Source.?Sans\|evergreen\|styles_v2" velara-web/src` → no matches (comments included). `grep -rn "fonts.googleapis\|fonts.gstatic" velara-web` → no matches (HIPAA no-CDN).
- **Visual (AC #4, #5):** `npm run dev`, compare the shell to `design/Velara v3.html` — navy AppBar, teal primary button + active-tab underline, Poppins headings, Open Sans body. Optionally add a small Vitest assertion that `NavTabs` active tab carries `border-brand-600`/`text-brand-800` and `AppBar` header carries `bg-brand-900`, to lock the rename against future regressions (optional, not required).

### Project Structure Notes

- Token home is `velara-web/src/index.css` (`@theme`) — single source; no `tailwind.config.ts` / `postcss.config.js` / `design-tokens.ts` (Tailwind v4 CSS-first). Matches architecture's "design tokens from `design/styles_v3.css` ported to the Tailwind config." [Source: architecture/core-architectural-decisions.md#Design-system]
- Naming convention to honor when adding tokens: `--color-*`→`bg-*`/`text-*`/`border-*`/`ring-*`, `--font-*`→`font-*`, `--radius-*`→`rounded-*`, `--shadow-*`→`shadow-*`. [Source: 1-2-velara-web-project-scaffold.md#Tailwind-v4-naming-convention]
- No conflicts/variances introduced — this is a value-and-rename pass within the established structure.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-1-platform-foundation-local-dev-environment.md#Story-1.6] — story statement + 5 ACs + Nexa dependency.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-09.md] — V3 re-theme rationale, palette/font deltas, Poppins-now/Nexa-later decision, scope = Story 1.6 only.
- [Source: design/styles_v3.css] — canonical V3 token values (palette, fonts, shadows, base styles).
- [Source: design/Velara v3.html] — visual target (note: its Google Fonts `<link>` is **not** to be copied — self-host).
- [Source: design/app_v3.jsx] — chrome reference (AppBar / nav).
- [Source: design/uploads/Brand Colors.png] — Vitalief brand guidelines (teal/navy/slate/pink; Nexa/Open Sans).
- [Source: _bmad-output/planning-artifacts/architecture/core-architectural-decisions.md#Design-system] & [Velara-Architecture-full.md#L178] — design-system decision now names `styles_v3.css` + V3 tokens.
- [Source: _bmad-output/implementation-artifacts/stories/1-2-velara-web-project-scaffold.md] — as-built scaffold: Tailwind v4 `@theme`, self-hosted `@fontsource` HIPAA decision, no config files.
- [Source: requirements-inventory] UX-DR-02 (active-tab underline = teal), UX-DR-03 (navy/teal AppBar), UX-DR-04 (palette/fonts/source file), OUT-02 (branded-output fonts — Epic 3 adopts the same later).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- Replaced the entire `@theme` block in `src/index.css` with V3 token values from `design/styles_v3.css`: teal/navy brand palette (`--color-brand-*`), navy ink, V3-tinted borders/shadows, updated status/two-key/danger tokens, new `--color-slate` + `--color-accent` (pink). AC#1 satisfied.
- Updated typography tokens: `--font-serif` → Poppins (heading/Nexa stand-in), `--font-sans` → Open Sans (body); kept `--font-serif/sans/mono` key names so all existing `font-serif`/`font-sans` Tailwind utilities keep working without component edits. Updated `h1–h4` base rule: `font-weight: 700`, `letter-spacing: -0.02em`. Added Nexa swap-in comment. AC#2 + AC#3 satisfied.
- `package.json`: removed `@fontsource/source-sans-3`, added `@fontsource/open-sans` + `@fontsource/poppins` (`^5.x`). Ran `npm install`. Updated `main.tsx` imports: Open Sans 400/500/600/700 + Poppins 500/600/700 + IBM Plex Mono 400/700; updated the HIPAA self-host comment. No CDN link added. AC#2 satisfied.
- Renamed all `green-*` Tailwind utility classes → `brand-*` in AppBar, NavTabs, LoginPage (5 files; exact sites per Task 4). Prevents silent fallback to Tailwind's built-in green palette now that `--color-green-*` tokens are removed. AC#1 + AC#5 satisfied.
- Updated AppBar dark-bar hardcoded hex values to V3 blue-grey set per Dev Notes mapping table (6 replacements). Updated `LoginPage` `VLogo color` `#102a24` → `#323843` (navy). Refreshed JSDoc in AppBar and NavTabs from `app_v2.jsx`/evergreen → `app_v3.jsx`/navy. AC#4 satisfied.
- All gates: `typecheck` 0 errors, `lint` clean, `49/49 tests` pass (0 regressions), `build` clean. Grep gate: `grep -rn "green-[0-9]\|Georgia\|Source.?Sans\|evergreen\|styles_v2" src/` → 0 hits. CDN gate: no `fonts.googleapis`/`fonts.gstatic` in any source file. AC#5 satisfied.

### File List

- src/index.css (MODIFIED)
- src/main.tsx (MODIFIED)
- package.json (MODIFIED)
- package-lock.json (MODIFIED)
- src/shared/components/AppBar.tsx (MODIFIED)
- src/shared/components/NavTabs.tsx (MODIFIED)
- src/pages/LoginPage.tsx (MODIFIED)

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-09 | Story created. Context-engine analysis against Epic 1 Story 1.6 ACs, `design/styles_v3.css` (token source of truth), the live `velara-web` scaffold (`src/index.css` Tailwind v4 `@theme`, `main.tsx` self-hosted `@fontsource`, AppBar/NavTabs/LoginPage utility usage), and Story 1.2's HIPAA self-hosted-font + no-config-file decisions. Key guardrail surfaced: the `--color-green-*`→`--color-brand-*` rename silently falls back to Tailwind v4's built-in green palette unless all `green-*` utility classes are renamed in lockstep — Task 4 made mandatory. Status → ready-for-dev. |
| 2026-06-09 | Implementation complete. Replaced full `@theme` block, swapped `source-sans-3` for `open-sans` + `poppins` (@fontsource, self-hosted), renamed all `green-*` utilities → `brand-*` in AppBar/NavTabs/LoginPage, updated AppBar dark-bar hexes to V3 blue-grey, updated VLogo color to navy, refreshed JSDoc. All 5 ACs satisfied. 49/49 tests pass, typecheck/lint/build clean, grep gate clean. Status → review. |

## Review Findings

_Adversarial code review 2026-06-09 — three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). The Acceptance Auditor verified **all 5 ACs PASS** against the canonical `design/styles_v3.css`; build / typecheck / 49 tests all green; both grep gates clean (no `green-*` / Georgia / Source-Sans residue, no Google-Fonts CDN). The items below are quality / design-fidelity refinements, not AC failures._

### Patch (unchecked — fixable now)

- [x] [Review][Patch] Brand "Velara" wordmark missing an explicit weight — renders **Poppins 500** but V3 design mandates **700** [src/shared/components/AppBar.tsx:51] + [src/pages/LoginPage.tsx:77]. The wordmark uses `font-serif` (Poppins) with no weight class → inherits the body default 400; since Poppins 400 is not imported, CSS font-weight matching renders it at 500. `design/styles_v3.css:110` specifies `.appbar-brand { font-weight: 700 }`. **FIXED 2026-06-09:** added `font-bold` to both wordmark elements (700 already imported). _(Corrects the Blind/Edge "system-ui fallback" claim, which was a false positive — the wordmark does render in Poppins.)_
- [x] [Review][Patch] _(Low / optional)_ Normalize the new font dep version ranges `^5.x` → `^5.2.7` to match the sibling `@fontsource/*` convention and the resolved lockfile version [package.json:18-19]. **FIXED 2026-06-09:** updated `^5.x` → `^5.2.7` in both `package.json` and the `package-lock.json` root-deps mirror (keeps `npm ci` consistent).

### Defer (pre-existing — not caused by this change)

- [x] [Review][Defer] AppBar dark-bar accent colors are hardcoded hex literals (`#6a9eb8`, `#8ab8cc`, `#d5e8f2`, `#6da8bc`, status dots `#6fd6b8`/`#7cc0d8`) rather than `@theme` tokens [src/shared/components/AppBar.tsx] — deferred, pre-existing (the dark-bar colors were always hardcoded literals; this story only swapped their values). Logged in `deferred-work.md`.

### Dismissed as noise (~15 — verified false positives or intentional)

- **"Wordmark falls back to system-ui / wrong typeface"** — false; CSS weight-matching renders Poppins 500 (real residue patched above).
- **`brand-800 == brand-600 == #128f8b`**, navy **`brand-900`**, non-monotonic teal scale — faithful 1:1 transcriptions of `design/styles_v3.css` (Auditor-confirmed).
- **`^5.x` "invalid semver"** — valid (`>=5.0.0 <6.0.0-0`); **package.json↔lock "incoherence"** — `npm ci` passes.
- **Access-pill status dots `#6fd6b8`/`#7cc0d8` left unchanged** — spec-acknowledged (Dev Notes), read fine on navy.
- **`--shadow-lg` navy tint**, **`#4c5270` shared across ink-2/st-internal/key-method/slate**, **`--font-serif` key holding Poppins** — all intentional / established token patterns (AC#3).
- **Dead palette tokens** `brand-400/500/300/100/50`, `--color-slate`, `--color-accent` — intentional V3 palette scaffolding required by AC#1; no feature screens consume them yet (Epics 2+ backlog).
- **Pre-existing `act()` test warnings** — unrelated test hygiene.
