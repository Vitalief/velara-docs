# Sprint Change Proposal — Velara

**Date:** 2026-06-09
**Author:** Developer (via Correct Course workflow)
**Mode:** Incremental
**Scope classification:** **Moderate** (design-token re-theme + reference updates across artifacts; one new story; no feature work discarded)
**Status:** Approved — edits applied

---

## Section 1 — Issue Summary

**Problem statement.** The client delivered **Vitalief Brand Guidelines** (`design/uploads/Brand Colors.png`), and the design prototype was updated to **V3** across all files. V3 changes both the **color palette** and the **typography**, superseding the "evergreen + Georgia/Source-Sans" theme the project was built around.

**What V3 changes (from `design/styles_v3.css` vs `styles_v2.css`):**

| Aspect | Old (v2) | New (V3 / brand) |
|---|---|---|
| Primary | evergreen green | **Teal `#128F8B`** |
| Ink / dark | dark green | **Navy `#323843`** |
| Secondary | — | **Slate `#4C5270`** |
| Accent / alert | — | **Pink `#F652A0`** / danger `#d4186c` |
| Headings | Georgia | **Poppins** (brand calls for **Nexa** — commercial; Poppins used as approved stand-in) |
| Body | Source Sans 3 | **Open Sans** |
| Mono | IBM Plex Mono | IBM Plex Mono (unchanged) |

**Discovery context.** Client-provided brand asset, received 2026-06-09. Surfaced via the V3 design-folder update (`styles_v3.css`, `app_v3.jsx`, `Velara v3.html`) and the brand-guidelines image.

**Evidence.** `design/uploads/Brand Colors.png` (Vitalief Brand Guidelines: palette + Nexa/Open Sans/Lato fonts); `design/styles_v3.css` (teal-valued tokens, Poppins/Open Sans). The old palette/fonts were referenced in 8 artifacts (architecture ×3, requirements-inventory, Epic 1, Epic 3, PRD full + 2 shards).

**Categorization:** New requirement from stakeholder (brand) — a contained **theming** change.

---

## Section 2 — Impact Analysis

**Epic impact:** Minimal disruption. The web app is a **scaffold only** — no feature screens exist yet (Epics 2+ are backlog), so re-theming the design tokens now means every future screen is built brand-correct from the start.

| Artifact | Impact |
|---|---|
| **Epic 1, Story 1.2** (✅ done) | Ported the *old* evergreen + Georgia/Source-Sans tokens (`styles_v2.css`) into `src/index.css`. Needs re-theming. Kept as as-built record; superseded by new Story 1.6. |
| **Architecture** (core + full + project-structure) | Design-system decision referenced `styles_v2.css` + evergreen + Georgia/Calibri; design-folder tree + `design-tokens.ts` referenced v2 files. |
| **requirements-inventory** | `UX-DR-02` (underline color), `UX-DR-03` (AppBar color), `UX-DR-04` (palette/fonts/source file), `OUT-02` (output brand fonts), prototype-source header. |
| **Epic 3, Story 3.6** (Branded Output) | PDF/PPTX/DOCX brand spec named Calibri/Georgia + Vitalief colors. |
| **PRD** (full + shards `5-functional-requirements`, `13-design-reference`) | `OUT-02` brand fonts; §13 design-reference file links (v2→v3). |

**Story impact:** One **new** story (Epic 1, Story 1.6). No existing backlog story restructured; the done Story 1.2 is annotated, not rewritten.

**Technical impact:** Token re-map in `src/index.css` (Tailwind v4 `@theme`) — palette values + font tokens; self-hosted Poppins/Open Sans (per 1.2's HIPAA decision); branded-output templates (Epic 3) adopt the same fonts/colors. **Nexa** (brand-exact heading font) is a commercial asset deferred until Vitalief supplies licensed files.

---

## Section 3 — Recommended Approach

**Selected: Direct Adjustment** — re-map design tokens + update the references that name the old palette/fonts. No rollback, no MVP change. Effort **Low–Medium**, Risk **Low** (no feature UI built yet).

**Stakeholder decisions (2026-06-09):**
1. **Headings font →** Use **Poppins** now (free, ships immediately, matches the V3 prototype). Treat **Nexa** as an optional later swap once Vitalief provides licensed font files.
2. **Re-theme tracking →** New small **Epic 1 Story 1.6** (keep the done Story 1.2 closed as its as-built record).
3. **Mode →** Incremental.

**Deliberately left untouched:** dated snapshot reports (`implementation-readiness-report-2026-06-02.md`, `architecture-validation-results.md`) — point-in-time records; and the body of the done Story 1.2 (a one-line supersede pointer was added).

---

## Section 4 — Detailed Change Proposals (applied)

### 🆕 New story — Epic 1, Story 1.6: Apply Vitalief V3 Brand Theme
Re-port `src/index.css` from `design/styles_v3.css`:
- **Palette:** teal `#128F8B` (primary), navy `#323843` (ink), slate `#4C5270`, pink `#F652A0` accent, danger `#d4186c`; rename `--green-*` tokens → `--brand-*`.
- **Fonts:** Poppins (headings) + Open Sans (body) + IBM Plex Mono, self-hosted; remove Georgia/Source-Sans.
- **Chrome:** navy/teal AppBar; active nav tab underlined in teal.
- **AC:** build + typecheck pass; matches `Velara v3.html`; no evergreen/Georgia/Source-Sans tokens remain.
- **Dependency (optional):** Nexa XBold/Regular font files from Vitalief for exact-match headings.
- Status `backlog`; sequenced early (before Epic 2 feature UI).

### ✏️ Reference + spec edits
| Artifact | Before → After |
|----------|----------------|
| Epic 1 Story 1.2 | + supersede note → Story 1.6 (as-built record preserved) |
| Architecture (core + full) | Design-system row: `styles_v2.css`→`styles_v3.css`; "evergreen, Georgia/Calibri" → "Vitalief brand teal/navy/slate/pink; Poppins/Open Sans"; tree + `design-tokens.ts` v2→v3 |
| requirements-inventory | UX-DR-02 (evergreen→teal underline), UX-DR-03 (dark-green→navy/teal bar), UX-DR-04 (palette+fonts+`styles_v3.css`), OUT-02 (fonts), prototype-source header v2→v3 |
| Epic 3 Story 3.6 | "Calibri/Georgia + Vitalief colors" → "Open Sans / Poppins (Nexa when licensed) + teal/navy" |
| PRD (full + shards) | OUT-02 fonts; §13 design-reference links `Velara v2.html`/`app_v2.jsx`/`styles_v2.css` → v3 |
| epic-list.md / index.md | + Story 1.6; dated 2026-06-09 note |
| sprint-status.yaml | + `1-6-apply-vitalief-brand-theme: backlog`; `last_updated: 2026-06-09`; history note |

---

## Section 5 — Implementation Handoff

**Scope: Moderate.** All edits above are **applied**.

| Recipient | Responsibility |
|-----------|----------------|
| **Developer (next action)** | `create-story` for **1-6** when ready, then implement the token re-theme in `velara-web` (`src/index.css`). Do it before Epic 2 feature UI so all screens are brand-correct. |
| **Product Owner** | Confirm Poppins-now / Nexa-later is acceptable to the client; track the Nexa font-file request. |
| **Client (Vitalief)** | Provide licensed **Nexa** font files if brand-exact headings are required (otherwise Poppins stands in at $0). |

**Success criteria**
- `velara-web` renders in the Vitalief V3 brand (teal/navy, Poppins/Open Sans); matches `design/Velara v3.html`.
- No evergreen/Georgia/Source-Sans tokens remain; generated documents (Epic 3) adopt the brand fonts/colors.
- All design-token references point at `styles_v3.css`; no `styles_v2` references remain in living artifacts.

---

## Appendix — Change Navigation Checklist Results

| § | Item | Status |
|---|------|--------|
| 1.1–1.3 | Trigger (client brand → V3), problem, evidence | ✅ Done |
| 2.1 | Current epic (Epic 1) — scaffold re-theme, no feature loss | ✅ Done |
| 2.2 | New Story 1.6; done 1.2 annotated not rewritten | ❗ Action-taken |
| 2.3–2.5 | No resequencing; no epics invalidated | ✅ Done |
| 3.1 | PRD: MVP intact; OUT-02 + §13 updated | ❗ Action-taken |
| 3.2 | Architecture: design-system decision re-themed | ❗ Action-taken |
| 3.3 | UI/UX: UX-DR-02/03/04 updated | ❗ Action-taken |
| 3.4 | requirements-inventory, Epic 3, epic-list, index, sprint-status updated | ❗ Action-taken |
| 4.1 | Direct Adjustment | ✅ Viable (selected) |
| 4.2 / 4.3 | Rollback / MVP Review | ❌ Not needed |
| 5.1–5.5 | Proposal compiled | ✅ Done |
| 6.x | Review, approval, sprint-status update, handoff | ✅ Done |
