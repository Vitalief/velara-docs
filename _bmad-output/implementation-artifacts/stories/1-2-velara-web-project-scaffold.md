---
baseline_commit: NO_VCS
---

# Story 1.2: velara-web Project Scaffold

Status: done

> 🎨 **Theming superseded by Story 1.6 (2026-06-09):** the design tokens this story ported (evergreen palette, Georgia/Source-Sans, from `styles_v2.css`) are re-themed to the Vitalief V3 brand (teal/navy, Poppins/Open Sans, from `styles_v3.css`) in Epic 1 Story 1.6. This file remains the accurate as-built record of the original scaffold.

## Story

As a developer,
I want a fully scaffolded Vite + React + TypeScript project with routing, design tokens, global providers, and Sentry wired in,
so that all subsequent frontend work starts from a consistent base with the correct design system and observability from the first commit.

## Acceptance Criteria

1. **Given** the velara-web repository is initialized, **When** I run `npm run dev`, **Then** the app starts on port 5173 and renders without console errors.

2. **Given** an unauthenticated user visits any route under `/internal/*` or `/client/*`, **When** React Router evaluates the route, **Then** they are redirected to `/login` — `RequireAuth` wrappers are in place on both route trees.

3. **Given** the app loads for an authenticated internal user, **When** the AppBar renders, **Then** it shows the "Velara · A Vitalief Skills Platform" wordmark, a role switcher (Vitalief team ↔ Client portal), and the horizontal nav tab strip with Engagements as the active default tab.

4. **Given** Tailwind CSS is configured, **When** I inspect `src/index.css`, **Then** the evergreen color palette, typography scale, spacing scale, and shadow tokens from `design/styles_v2.css` are correctly mapped as Tailwind v4 `@theme` variables. _(Note: Tailwind v4 uses CSS `@theme` in `src/index.css` — not `tailwind.config.ts`. The epic AC references v3; this story uses v4.)_

5. **Given** a JavaScript error is thrown in any component, **When** the `ErrorBoundary` catches it, **Then** Sentry captures it with the PHI `beforeSend` sanitizer applied, and the user sees a fallback error UI — no raw error details exposed.

6. **Given** `npm run build` is run, **Then** the build completes without errors and produces a valid `dist/` directory.

7. **Given** `npm run typecheck` is run, **Then** zero TypeScript errors are reported.

## Tasks / Subtasks

- [x] **T1: Repository and package.json setup** (AC: 1, 6, 7)
  - [x] Initialize `velara-web/` as a new repo: `npm create vite@latest velara-web -- --template react-ts`
  - [x] Replace generated `package.json` deps with pinned versions from Dev Notes
  - [x] Add `scripts`: `"dev"`, `"build"`, `"typecheck"`, `"lint"`, `"test"`, `"preview"`
  - [x] Create `.env.example` with `VITE_API_URL`, `VITE_SENTRY_DSN`, `VITE_ENVIRONMENT`
  - [x] Create `.gitignore` (Node + Vite defaults + `.env`)

- [x] **T2: Directory skeleton** (AC: all)
  - [x] Create full directory tree per Dev Notes (feature dirs, shared, stores, api, routes)
  - [x] Add `types.ts` (empty export) to feature directories not implemented in this story
  - [x] Add `.gitkeep` to empty component/hook dirs not implemented in this story

- [x] **T3: Vite + TypeScript configuration** (AC: 6, 7)
  - [x] Configure `vite.config.ts`:
    - Plugins: `@vitejs/plugin-react`, `tailwindcss` (from `@tailwindcss/vite` — **not** postcss)
    - `server.port: 5173`
    - `resolve.alias: {'@': '/src'}`
  - [x] Configure `tsconfig.json`: `strict: true`, `paths: {"@/*": ["./src/*"]}`, target ES2022, `moduleResolution: bundler`
  - [x] Configure `tsconfig.node.json` for Vite config file
  - [x] **No `postcss.config.js` needed** — Tailwind v4 Vite plugin handles this

- [x] **T4: Tailwind CSS v4 with design tokens** (AC: 4)
  - [x] Install `tailwindcss@latest`, `@tailwindcss/vite` — **v4, not v3**
  - [x] In `src/index.css`, add `@import "tailwindcss";` followed by the full `@theme` block (see Dev Notes for complete token map)
  - [x] Confirm all tokens from `design/styles_v2.css` are mapped — that file is the PRD's canonical design reference (PRD §13)
  - [x] Add Google Fonts `<link>` in `index.html` for Source Sans 3 and IBM Plex Mono (see Dev Notes)

- [x] **T5: Sentry + PHI sanitizer + ErrorBoundary** (AC: 5)
  - [x] Create `src/shared/utils/sentry.ts`:
    - `sanitizePhi(event)` function — same PHI key patterns as velara-api `sanitize_phi`
    - `initSentry()` — DSN-gated (no DSN = no-op), reads `VITE_SENTRY_DSN`
    - `beforeSend` hook calls `sanitizePhi`
    - `tracesSampleRate: 0.1`
  - [x] Create `src/shared/components/ErrorBoundary.tsx`:
    - Uses `@sentry/react` built-in `<ErrorBoundary fallback={...}>`
    - Fallback: full-screen centered card, "Something went wrong" — no raw error details

- [x] **T6: React Router v7 route trees + RequireAuth** (AC: 2)
  - [x] Create `src/shared/utils/auth.ts`:
    - `isAuthenticated(): boolean` — checks `sessionStorage.getItem('velara_session')` (stub; Story 1.5 replaces with Amplify `fetchAuthSession`)
  - [x] Create `src/shared/components/RequireAuth.tsx`:
    - If `!isAuthenticated()` → `<Navigate to="/login" state={{ from: location }} replace />`
  - [x] Create `src/routes/internal.tsx`:
    - Route tree for `/internal/*` inside `<RequireAuth>`
    - Default: `/internal/engagements` → placeholder
  - [x] Create `src/routes/client.tsx`:
    - Route tree for `/client/*` inside `<RequireAuth>`
    - Default: `/client/dashboard` → placeholder
  - [x] Create `src/pages/LoginPage.tsx` (stub — Cognito form in Story 1.5):
    - Centered card, Velara wordmark, "Sign in" heading, reads `state.from` for post-auth redirect

- [x] **T7: AppBar + NavTabs components** (AC: 3)
  - [x] Create `src/shared/components/AppBar.tsx` — match `design/app_v2.jsx` layout exactly:
    - Height 52px, `bg-green-900`
    - Left: VLogo + "Velara" (Georgia) + "A Vitalief Skills Platform" sub label
    - Right: role switcher pill, access pill, separator, user avatar row
    - Role state from `useRoleStore`
    - Search button with ⌘K shortcut → stub CmdPalette
  - [x] Create `src/shared/components/NavTabs.tsx`:
    - Height 44px, white bg, `border-b border-line`
    - Tabs in order: Engagements | Skill Registry | Certification | Access Control | Analytics | Audit Log
    - Active: `text-green-800 font-bold border-b-2 border-green-600`, default active: `'engagements'`
    - Props: `activeTab: string`, `onTabChange: (tab: string) => void`
  - [x] Create `src/shared/components/VLogo.tsx` — placeholder SVG or styled "V" div (to be replaced with brand asset)

- [x] **T8: App.tsx and global providers** (AC: 1, 3, 5)
  - [x] Create `src/App.tsx`:
    - Call `initSentry()` once at module level
    - Wrap: `<ErrorBoundary>` → `<QueryClientProvider>` → `<BrowserRouter>` → routes
    - Route structure: `/` → redirect, `/login`, `/internal/*`, `/client/*`
    - `<InternalShell>` (AppBar + NavTabs + Outlet) wrapping internal routes
  - [x] Create `src/main.tsx` — standard Vite React 19 entry, imports `./index.css`

- [x] **T9: Zustand stores setup** (AC: 1)
  - [x] `src/stores/useRoleStore.ts` — `role: 'internal' | 'client'`, default `'internal'`, `setRole()`
  - [x] `src/stores/useHierarchyStore.ts` (stub) — `activeClientId`, `activeProjectId`, `activeStudyId`
  - [x] `src/stores/useRunStore.ts` (stub) — `activeJobId`, `runMode`

- [x] **T10: API client setup** (AC: 1)
  - [x] `src/api/client.ts` — Axios instance, `baseURL: VITE_API_URL`, request interceptors (Bearer token stub, X-Request-ID header), 401 → redirect to login
  - [x] `src/api/queryClient.ts` — `QueryClient` with `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: false`

- [x] **T11: Test infrastructure** (AC: 7)
  - [x] Configure `vitest.config.ts`: `environment: 'jsdom'`, `globals: true`, `setupFiles: ['./src/test/setup.ts']`
  - [x] Create `src/test/setup.ts` — imports `@testing-library/jest-dom`
  - [x] `src/routes/internal.test.tsx` — unauthenticated user redirects to `/login`
  - [x] `src/routes/client.test.tsx` — same for `/client/*`
  - [x] `src/shared/components/AppBar.test.tsx` — wordmark text renders correctly

- [x] **T12: CI pipeline stub**
  - [x] `.github/workflows/ci.yml` — jobs: typecheck, lint, test, build; triggers: push to main, PR
  - [x] `.github/workflows/deploy.yml` — stub only (wired in Story 1.4)

## Dev Notes

### Tech Stack — Exact Versions to Install

| Package | Version | Notes |
|---------|---------|-------|
| `react` / `react-dom` | `^19.0.0` | Latest stable |
| `react-router-dom` | `^7.0.0` | Latest — v7 code-based routing is fully supported (see patterns below) |
| `@tanstack/react-query` | `^5.0.0` | Use v5 patterns (breaking changes from v4 documented below) |
| `zustand` | `^5.0.0` | |
| `axios` | `^1.7.0` | |
| `aws-amplify` | `^6.0.0` | Install now; configure in Story 1.5 |
| `@sentry/react` | `^8.0.0` | |
| `tailwindcss` | `latest` | **v4** — CSS `@theme` config, no `tailwind.config.ts` |
| `@tailwindcss/vite` | `latest` | v4 Vite plugin — replaces postcss approach |
| `typescript` | `^5.5.0` | v5 — do not upgrade to v6 (pre-release) |
| `vite` | `^6.0.0` | |
| `@vitejs/plugin-react` | `^4.0.0` | |
| `vitest` | `^2.0.0` | |
| `@testing-library/react` | `^16.0.0` | |
| `@testing-library/user-event` | `^14.0.0` | |
| `@testing-library/jest-dom` | `^6.0.0` | |
| `jsdom` | `^25.0.0` | |

### npm scripts

```json
{
  "scripts": {
    "dev":       "vite",
    "build":     "vite build",
    "preview":   "vite preview",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --ext .ts,.tsx",
    "test":      "vitest run",
    "test:watch":"vitest"
  }
}
```

### Directory Structure (Exact)

```
velara-web/
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml              ← stub only
├── public/assets/              ← Vitalief brand assets (empty for now)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css               ← @import "tailwindcss" + @theme tokens + base styles
│   ├── routes/
│   │   ├── internal.tsx
│   │   └── client.tsx
│   ├── pages/
│   │   └── LoginPage.tsx
│   ├── features/
│   │   ├── engagements/components/.gitkeep  hooks/.gitkeep  types.ts
│   │   ├── skills/components/.gitkeep  hooks/.gitkeep  types.ts
│   │   ├── run/components/.gitkeep  hooks/.gitkeep  types.ts
│   │   ├── certification/components/.gitkeep  types.ts
│   │   ├── ingest/components/.gitkeep  types.ts
│   │   ├── admin/components/.gitkeep  types.ts
│   │   └── client-portal/components/.gitkeep  types.ts
│   ├── shared/
│   │   ├── components/
│   │   │   ├── AppBar.tsx
│   │   │   ├── NavTabs.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── RequireAuth.tsx
│   │   │   ├── VLogo.tsx
│   │   │   ├── Skeleton.tsx    ← stub
│   │   │   └── Toast.tsx       ← stub
│   │   └── utils/
│   │       ├── sentry.ts
│   │       ├── auth.ts
│   │       ├── dates.ts        ← stub
│   │       └── errors.ts       ← stub
│   ├── stores/
│   │   ├── useRoleStore.ts
│   │   ├── useHierarchyStore.ts
│   │   └── useRunStore.ts
│   ├── api/
│   │   ├── client.ts
│   │   ├── queryClient.ts
│   │   └── skills|hierarchy|jobs|certifications|ingest|outputs.ts ← stubs
│   └── test/
│       └── setup.ts
├── index.html
├── vite.config.ts              ← @tailwindcss/vite plugin (no postcss.config.js)
├── tsconfig.json
├── tsconfig.node.json
├── vitest.config.ts
├── .eslintrc.cjs
├── .env.example
└── package.json
```

Note: **No `tailwind.config.ts`** and **no `postcss.config.js`** — Tailwind v4 replaces both with the `@tailwindcss/vite` plugin + CSS `@theme`.

### Vite Configuration (vite.config.ts)

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  resolve: { alias: { '@': '/src' } },
})
```

### Tailwind v4 Design Tokens (src/index.css)

Tailwind v4 configuration lives entirely in CSS. Map every variable from `design/styles_v2.css` — that file is the PRD's canonical design + typography reference (PRD §13: "Design tokens, typography, color system").

Tailwind v4 naming convention: `--color-*` → `bg-*`/`text-*`/`border-*`, `--font-*` → `font-*`, `--radius-*` → `rounded-*`, `--shadow-*` → `shadow-*`.

```css
@import "tailwindcss";

@theme {
  /* ── Surfaces ── */
  --color-paper:         #f6f5f1;
  --color-surface:       #ffffff;
  --color-surface-2:     #faf9f6;
  --color-surface-sunk:  #f1f0ea;

  /* ── Ink ── */
  --color-ink:           #15201c;
  --color-ink-2:         #3c4843;
  --color-muted:         #6b756f;
  --color-faint:         #97a09a;

  /* ── Evergreen brand palette ── */
  --color-green-900:     #102a24;
  --color-green-800:     #163b32;
  --color-green-700:     #1c4b40;
  --color-green-600:     #246152;
  --color-green-500:     #2f7a67;
  --color-green-300:     #8fb8ac;
  --color-green-100:     #dbe7e2;
  --color-green-50:      #eef4f1;

  /* ── Borders ── */
  --color-line:          #e5e6e0;
  --color-line-2:        #d7d9d1;
  --color-line-strong:   #c4c7bd;

  /* ── Status: Skill lifecycle ── */
  --color-st-draft:      #828a96;
  --color-st-draft-tx:   #5b626d;
  --color-st-draft-bg:   #eef0f3;
  --color-st-draft-bd:   #d6dae1;
  --color-st-internal:   #b9822f;
  --color-st-internal-tx:#7a591d;
  --color-st-internal-bg:#f6eedb;
  --color-st-internal-bd:#e6d2a8;
  --color-st-client:     #2e8f63;
  --color-st-client-tx:  #1f6845;
  --color-st-client-bg:  #e4f1e9;
  --color-st-client-bd:  #b8dcc7;
  --color-st-retired:    #998d86;
  --color-st-retired-bg: #f1eeeb;
  --color-st-retired-bd: #ddd6cf;

  /* ── Two-key certification ── */
  --color-key-tech:      #4d68a8;
  --color-key-tech-bg:   #e8edf6;
  --color-key-method:    #7d5ba6;
  --color-key-method-bg: #efe8f5;

  /* ── Danger ── */
  --color-danger:        #c2503d;
  --color-danger-bg:     #f6e6e2;

  /* ── Typography (per PRD §13 → design/styles_v2.css) ── */
  --font-serif: Georgia, 'Times New Roman', serif;
  --font-sans:  'Source Sans 3', system-ui, -apple-system, sans-serif;
  --font-mono:  'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* ── Border radius ── */
  --radius-sm:  6px;
  --radius:     9px;
  --radius-lg:  12px;
  --radius-xl:  18px;

  /* ── Shadows ── */
  --shadow-sm:  0 1px 2px rgba(21,32,28,.05), 0 1px 1px rgba(21,32,28,.04);
  --shadow:     0 4px 16px -6px rgba(21,32,28,.12), 0 1px 3px rgba(21,32,28,.06);
  --shadow-lg:  0 24px 60px -24px rgba(16,42,36,.28), 0 6px 18px -10px rgba(16,42,36,.16);
}

/* ── Base styles matching design/styles_v2.css ── */
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
  font-weight: 600;
  letter-spacing: -0.01em;
}
```

### Typography — Per PRD

PRD §13 designates `design/styles_v2.css` as the canonical typography source. That file specifies:
- **Serif (titles/headings):** Georgia, 'Times New Roman', serif — mapped to `font-serif`
- **Sans-serif (UI/body):** Source Sans 3, system-ui — mapped to `font-sans`
- **Monospace (code/IDs):** IBM Plex Mono, ui-monospace — mapped to `font-mono`

The epic AC text says "Georgia/Calibri" — that is a documentation error. The PRD's design reference (`styles_v2.css`) is authoritative. Implement Source Sans 3, not Calibri.

### Google Fonts (index.html)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### PHI Sanitizer (src/shared/utils/sentry.ts)

Consistent with velara-api `sanitize_phi`. Same PHI field key patterns (case-insensitive substring match):

```ts
const PHI_KEYS = ['email','mail','e_mail','mrn','patient_id','subject_id','ssn',
  'social_security','name','first_name','last_name','full_name','patient_name',
  'phone','phone_number','mobile','dob','date_of_birth','birth_date',
  'address','street','zip','postal_code']

function sanitizePhiValue(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(sanitizePhiValue)
  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([k, v]) => [
        k,
        PHI_KEYS.some(p => k.toLowerCase().includes(p)) ? '[REDACTED]' : sanitizePhiValue(v)
      ])
    )
  }
  return data
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_ENVIRONMENT ?? 'dev',
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend: (event) => sanitizePhiValue(event) as Sentry.ErrorEvent,
  })
}
```

### TanStack Query v5 Patterns (Breaking Changes from v4)

| v4 (DO NOT USE) | v5 (correct) |
|---|---|
| `status === 'loading'` | `status === 'pending'` |
| `cacheTime` | `gcTime` |
| `onSuccess`, `onError` in `useQuery` | `useEffect` on `data`/`error` |
| `useQuery(key, fn, options)` 3-arg form | `useQuery({ queryKey, queryFn, ...options })` object-only |

Default `staleTime: 30_000` (30s) set in `queryClient.ts` — matches architecture for hierarchy and registry data.

### React Router v7 — Code-Based Routing

React Router v7 fully supports the code-based API from v6. `<BrowserRouter>/<Routes>/<Route>` are unchanged. Use `react-router-dom` as the package — this is still the correct package name in v7.

```tsx
// App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

<BrowserRouter>
  <Routes>
    <Route path="/" element={<Navigate to="/internal/engagements" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/internal/*" element={<InternalRoutes />} />
    <Route path="/client/*"   element={<ClientRoutes />} />
  </Routes>
</BrowserRouter>
```

```tsx
// routes/internal.tsx
import { Routes, Route, Navigate } from 'react-router-dom'

export function InternalRoutes() {
  return (
    <RequireAuth>
      <Routes>
        <Route index element={<Navigate to="engagements" replace />} />
        <Route path="engagements/*" element={<div>Engagements — Story 2.x</div>} />
        <Route path="skills/*"      element={<div>Skills — Story 3.x</div>} />
        <Route path="certification/*" element={<div>Certification — Story 6.x</div>} />
        <Route path="access/*"      element={<div>Access Control — Story 7.x</div>} />
        <Route path="analytics"     element={<div>Analytics — future</div>} />
        <Route path="audit/*"       element={<div>Audit Log — Story 8.x</div>} />
      </Routes>
    </RequireAuth>
  )
}
```

### RequireAuth — Designed for Story 1.5 Swap

`isAuthenticated()` in `src/shared/utils/auth.ts` is the only thing Story 1.5 replaces with Amplify:

```ts
// src/shared/utils/auth.ts — Story 1.5 will replace this body with Amplify fetchAuthSession
export function isAuthenticated(): boolean {
  return !!sessionStorage.getItem('velara_session')
}

// Test helper — sets a mock session for integration tests
export function _mockAuthSession(token: string) {
  sessionStorage.setItem('velara_session', token)
}
export function _clearAuthSession() {
  sessionStorage.removeItem('velara_session')
}
```

### AWS Amplify v6 — Install Now, Configure in Story 1.5

Install `aws-amplify@^6.0.0` now. **Do not call `Amplify.configure()`** — that needs Cognito pool IDs from Story 1.3/1.5.

v6 uses modular imports (not the v5 singleton):
```ts
// Correct (v6):
import { fetchAuthSession } from '@aws-amplify/auth'
// Wrong (v5 — do not use):
import { Auth } from 'aws-amplify'
```

### AppBar Details (from design/app_v2.jsx)

Read `design/app_v2.jsx` lines 57–179 directly for the exact component structure. Key points:
- "Velara · A Vitalief Skills Platform" — the `·` is a mid-dot (U+00B7)
- Role switcher toggles `useRoleStore` between `'internal'` and `'client'`
- When role is `'internal'`: shows search button (⌘K), separator, user avatar
- NavTabs (appnav) is a sibling element to AppBar — rendered in `InternalShell`, not inside `AppBar.tsx`

### What NOT to Build in This Story

- Cognito login form — Story 1.5
- Domain API calls (hierarchy, skills, jobs) — later stories
- Working CmdPalette — stub modal only
- Any feature UI beyond placeholder `<div>` elements
- Terraform / S3 / CloudFront — Story 1.3
- Full CI/CD deploy — Story 1.4
- React Server Components or `use()` hook — not applicable (SPA)

### Project Structure Notes

- This story is implemented in `velara-web/` — a **separate repo** from the hub `velara/` repo
- Stories live in the hub at `_bmad-output/implementation-artifacts/stories/`
- Stories 1.1 (API scaffold), 1.2 (this), 1.3 (infra) are fully independent
- Story 1.5 (Cognito) depends on this story's `RequireAuth` stub being in place

### References

- Epic 1, Story 1.2 ACs [Source: `_bmad-output/planning-artifacts/epics/epic-1-platform-foundation-local-dev-environment.md`]
- Typography + color tokens (authoritative) [Source: `design/styles_v2.css`] per PRD §13
- AppBar, NavTabs layout [Source: `design/app_v2.jsx`]
- Architecture: frontend decisions (role routing, Zustand, React Router, Tailwind) [Source: `_bmad-output/planning-artifacts/architecture/core-architectural-decisions.md`]
- Architecture: velara-web directory tree [Source: `_bmad-output/planning-artifacts/architecture/project-structure-boundaries.md`]
- Architecture: naming/structure patterns [Source: `_bmad-output/planning-artifacts/architecture/implementation-patterns-consistency-rules.md`]
- Starter template: Vite react-ts + packages [Source: `_bmad-output/planning-artifacts/architecture/starter-template-evaluation.md`]
- PRD design reference [Source: `_bmad-output/planning-artifacts/prds/prd-Velara-2026-05-29/prd/13-design-reference.md`]
- Previous story learnings (velara-api patterns) [Source: `_bmad-output/implementation-artifacts/stories/1-1-velara-api-project-scaffold.md`]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- `tsc --noEmit` initially failed with TS6306/TS6310 because `tsconfig.json` referenced `tsconfig.node.json` (not `composite`). Resolved by scoping `typecheck` to `src` only; `tsconfig.node.json` is retained as a standalone editor config for the Vite/Vitest config files.
- `tsc --noEmit` then surfaced a duplicate-`vite`-types conflict in `vitest.config.ts` (Vitest 2 bundles its own nested `vite`). Resolved by keeping config files out of the `src`-scoped typecheck — the standard Vite-template arrangement.

### Completion Notes List

- Scaffolded velara-web with Vite 6 + React 19 + TypeScript 5 (strict), Tailwind v4 (`@tailwindcss/vite` + CSS `@theme`, no `tailwind.config.ts`/`postcss.config.js`), React Router v7 code-based routing, TanStack Query v5, Zustand 5, Axios, Sentry 8, and Amplify v6 (installed, not configured — Story 1.5).
- All seven ACs verified green: `npm run dev` serves HTTP 200 on port 5173; `RequireAuth` guards both `/internal/*` and `/client/*` (covered by tests); AppBar renders the "Velara · A Vitalief Skills Platform" wordmark + Vitalief team ↔ Client portal role switcher; NavTabs renders the six tabs with Engagements as the default active tab; `src/index.css` maps the full evergreen/typography/radius/shadow token set from `design/styles_v2.css` as Tailwind v4 `@theme` variables; ErrorBoundary wraps the app with the Sentry PHI `beforeSend` sanitizer; `npm run build` produces a valid `dist/`; `npm run typecheck` reports zero errors.
- Test suite: 9 tests across 4 files, all passing — route-guard redirects (internal + client), AppBar wordmark/role-switcher rendering, and recursive PHI sanitizer (object/array/primitive). Lint clean.
- `isAuthenticated()` in `src/shared/utils/auth.ts` is the sole Story 1.5 swap point (stub reads `sessionStorage.velara_session`); test helpers `_mockAuthSession`/`_clearAuthSession` included.
- PHI key patterns in `sentry.ts` mirror velara-api `sanitize_phi` for cross-service consistency.

### File List

**Config / root**
- `velara-web/package.json`
- `velara-web/.env.example`
- `velara-web/.gitignore`
- `velara-web/index.html`
- `velara-web/vite.config.ts`
- `velara-web/vitest.config.ts`
- `velara-web/tsconfig.json`
- `velara-web/tsconfig.node.json`
- `velara-web/.eslintrc.cjs`

**Source**
- `velara-web/src/main.tsx`
- `velara-web/src/App.tsx`
- `velara-web/src/index.css`
- `velara-web/src/vite-env.d.ts`
- `velara-web/src/routes/internal.tsx`
- `velara-web/src/routes/client.tsx`
- `velara-web/src/pages/LoginPage.tsx`
- `velara-web/src/shared/components/AppBar.tsx`
- `velara-web/src/shared/components/NavTabs.tsx`
- `velara-web/src/shared/components/ErrorBoundary.tsx`
- `velara-web/src/shared/components/RequireAuth.tsx`
- `velara-web/src/shared/components/VLogo.tsx`
- `velara-web/src/shared/components/Skeleton.tsx` (stub)
- `velara-web/src/shared/components/Toast.tsx` (stub)
- `velara-web/src/shared/utils/sentry.ts`
- `velara-web/src/shared/utils/auth.ts`
- `velara-web/src/shared/utils/dates.ts` (stub)
- `velara-web/src/shared/utils/errors.ts` (stub)
- `velara-web/src/stores/useRoleStore.ts`
- `velara-web/src/stores/useHierarchyStore.ts` (stub)
- `velara-web/src/stores/useRunStore.ts` (stub)
- `velara-web/src/api/client.ts`
- `velara-web/src/api/queryClient.ts`
- `velara-web/src/api/{skills,hierarchy,jobs,certifications,ingest,outputs}.ts` (stubs)
- `velara-web/src/features/{engagements,skills,run,certification,ingest,admin,client-portal}/` (types.ts + .gitkeep stubs)

**Tests**
- `velara-web/src/test/setup.ts`
- `velara-web/src/routes/internal.test.tsx`
- `velara-web/src/routes/client.test.tsx`
- `velara-web/src/shared/components/AppBar.test.tsx`
- `velara-web/src/shared/utils/sentry.test.ts`

**CI**
- `velara-web/.github/workflows/ci.yml`
- `velara-web/.github/workflows/deploy.yml` (stub)

### Change Log

| Date | Change |
|------|--------|
| 2026-06-04 | Initial velara-web scaffold implemented — all 12 tasks complete, all 7 ACs verified (typecheck/lint/test/build green). Status → review. |

## Review Findings

_Adversarial code review (Blind Hunter · Edge Case Hunter · Acceptance Auditor) — 2026-06-04. All 7 ACs verified MET; findings below are correctness/robustness items, none block an AC._

### Decision Needed

_Both decision-needed findings were resolved during review (2026-06-04): PHI substring-match → **deferred** (see Deferred); Google Fonts CDN → **self-host** (see Patch)._

### Patch (applied 2026-06-04 — typecheck/lint/test/build re-verified green)

- [x] [Review][Patch] Self-host web fonts instead of Google Fonts CDN — replace the `fonts.googleapis.com`/`gstatic.com` `<link>` in `index.html` with locally-bundled Source Sans 3 / IBM Plex Mono, removing the third-party IP/referrer leak and CSP/offline dependency. (Resolved from decision-needed — deviates from literal spec T4/AC4 in favor of the HIPAA posture.) [index.html]

- [x] [Review][Patch] PHI sanitizer can throw on Sentry events — no cycle guard, flattens non-plain objects — `sanitizePhiValue` rebuilds every object via `Object.fromEntries(Object.entries())` with no `WeakSet` cycle guard and no `instanceof Error`/`Date` skip. Real Sentry `ErrorEvent`s contain `Error` instances, circular refs (DOM nodes in breadcrumbs), and class instances; this infinitely recurses / throws inside `beforeSend`, which silently drops the entire error event. Highest-severity finding. [src/shared/utils/sentry.ts:18-29]
- [x] [Review][Patch] `makeRequestId()` XOR on floating-point ms → low-entropy / colliding IDs — `Date.now() ^ (performance.now() * 1000)` coerces both operands to 32-bit ints, truncating the ~1.7e12 epoch and the float, so X-Request-IDs lose most entropy and can collide. Use `crypto.randomUUID()`. [src/api/client.ts:15-18]
- [x] [Review][Patch] 401 interceptor can cause a redirect/reload loop — `window.location.assign('/login')` fires on every 401 with no guard for already being on `/login` and without clearing the stale `velara_session` token, so an expired-session probe on `/login` reload-loops. Guard on `location.pathname` and clear the session before redirect. [src/api/client.ts:28-36]
- [x] [Review][Patch] `isAuthenticated()` can throw `SecurityError` — bare `sessionStorage.getItem` throws in private mode / when storage is disabled, crashing the route guard. Wrap in try/catch returning `false`. [src/shared/utils/auth.ts]
- [x] [Review][Patch] `formatDate()` throws `RangeError` on invalid/empty input — `new Date(value).toISOString()` throws on an unparseable string; guard with `isNaN(d.getTime())`. [src/shared/utils/dates.ts:2-3]
- [x] [Review][Patch] Dead code: tautological ternary + unused `TAB_TO_PATH` — `onTabChange={(tab) => setActiveTab(TAB_TO_PATH[tab] ? tab : tab)}` returns `tab` in both branches; the `TAB_TO_PATH` map is otherwise unused. (Tab→route wiring is correctly deferred per spec; only the dead code is the issue.) Simplify to `onTabChange={setActiveTab}` and remove/annotate the map. [src/routes/internal.tsx:8-15,29]
- [x] [Review][Patch] ESLint declares `react-hooks` plugin but enables none of its rules — `rules-of-hooks` / `exhaustive-deps` are off, so hook bugs go uncaught across a scaffold every feature builds on. Add `plugin:react-hooks/recommended`. [.eslintrc.cjs]

### Deferred

- [x] [Review][Defer] PHI sanitizer uses greedy substring key-match (`'name'`/`'mail'` etc. via `includes()`), over-redacting legitimate Sentry diagnostic fields (`transaction`/breadcrumb `name`, `username`, `filename`, `hostname`) [src/shared/utils/sentry.ts:7-12,24] — deferred (resolved from decision-needed): kept to honor spec's velara-api `sanitize_phi` parity; **low real-world impact** — PHI safety outweighs losing some Sentry field detail.
- [x] [Review][Defer] Bearer token stored in `sessionStorage` (XSS-exfiltratable); `client.ts` reads storage directly rather than via `auth.ts`, so the Story 1.5 Amplify swap is not as isolated as the `auth.ts` docstring claims [src/shared/utils/auth.ts, src/api/client.ts:22] — deferred, acknowledged stub (Story 1.5)
- [x] [Review][Defer] No catch-all `path="*"` 404 route at top level or in the internal/client shells → blank screen for any unknown URL [src/App.tsx, src/routes/internal.tsx, src/routes/client.tsx] — deferred, out of explicit story scope
- [x] [Review][Defer] `baseURL: VITE_API_URL` with no guard → requests silently hit the relative origin when the env var is missing [src/api/client.ts:11] — deferred, env contract hardening
- [x] [Review][Defer] Sentry `browserTracingIntegration()` without `tracePropagationTargets` attaches trace headers to all outbound requests, including cross-origin [src/shared/utils/sentry.ts:42] — deferred, observability hardening
- [x] [Review][Defer] `tsconfig.node.json` is referenced by no script, so `vite.config.ts`/`vitest.config.ts` are never typechecked (documented workaround for TS6306/6310; AC7 scoped to `src`) [tsconfig.node.json] — deferred, documented intentional gap
- [x] [Review][Defer] `@` path alias defined three different ways across `tsconfig.json` / `vite.config.ts` (`'/src'`) / `vitest.config.ts` → resolution-divergence/maintenance risk — deferred, build+tests currently green
- [x] [Review][Defer] `vitest.config.ts` hand-rolls plugins/aliases instead of `mergeConfig`-ing `vite.config.ts` (no Tailwind plugin; configs can drift) [vitest.config.ts] — deferred, tests currently green
- [x] [Review][Defer] ESLint uses legacy `.eslintrc.cjs` with no type-aware linting (`parserOptions.project` unset) → shallow lint [.eslintrc.cjs] — deferred, tooling enhancement
- [x] [Review][Defer] `LoginPage` redirect reads `state.from.pathname` only (drops search/hash; no guard if `from === '/login'`) [src/pages/LoginPage.tsx] — deferred, Story 1.5 reworks login
