---
title: 'Internal AppBar cleanup — real username, drop role toggle & access pill, widen search'
type: 'refactor'
created: '2026-07-02'
status: 'done'
context: []
baseline_commit: 'velara-web@b64707665132e106a0795d7f80c1cbc6a8254f3d'  # velara-web is a nested git repo (gitignored at root); diff scoped to the 5 changed files
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The internal top bar shows a hardcoded user ("M. Maxwell" / "MM" / "Methodology key") instead of the signed-in user, and carries a Vitalief-team ↔ Client-portal role toggle plus a "Full access" / "Outputs only" access pill that are dead weight — the AppBar only ever renders inside the internal-only shell, so the toggle can't actually switch experiences and the pill never says anything but "Full access". They crowd the bar and shrink the search control.

**Approach:** Source the display name from the Cognito ID token (extend `login()` to persist `name`/`email` on the stored user), render it in the AppBar with an email→initials fallback. Remove the role switcher and the access pill from the AppBar, and remove the internal-only conditional wrappers so the search, user row, and logout render unconditionally in the internal shell. Let the search sit next to the freed space (its left `flex-1` spacer already pushes the right cluster over, so removing siblings naturally gives search more room).

## Boundaries & Constraints

**Always:**
- Keep `useRoleStore` and its `setRole` call in `LoginPage.tsx` intact — it still drives the post-login shell redirect. Only AppBar stops reading it.
- Display name resolution order: `user.name` → `user.email` → `'User'`. Avatar initials derive from the same resolved string (first letters of up to two words, uppercased; email → first two chars before `@`).
- Name/email are read from ID-token claims synchronously (no network call added to the bar), mirroring the existing `custom:org_id`/`custom:role` extraction in `login()`.
- Preserve the existing hard-redirect logout behavior and its comment (guard-race fix).
- No emoji/unicode-glyph icons (project rule); the only allowed glyph remains ⌘ in the ⌘K hint.

**Ask First:**
- If sourcing the name any way other than ID-token claims becomes necessary (e.g. token lacks `name` AND `email`), HALT rather than adding a `/api/v1/users` fetch to the AppBar.

**Never:**
- Do not touch `ClientAppBar.tsx` (it already omits all of this).
- Do not delete `useRoleStore.ts` or change `LoginPage`'s redirect logic.
- Do not add a network request or loading state to the AppBar.
- Do not change the AppBar's height, background, wordmark, sub-label, ⌘K palette internals, or logout behavior beyond removing the now-unnecessary `role === 'internal'` gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Name present | stored user `{ name: 'Jane Doe', email: 'jane@x.com' }` | Bar shows "Jane Doe", avatar "JD" | N/A |
| Name empty, email present | `{ name: '', email: 'jane@x.com' }` | Bar shows "jane@x.com", avatar "JA" | N/A |
| Name & email empty | `{ name: '', email: '' }` (or legacy session missing both) | Bar shows "User", avatar "U" | No crash |
| No stored user | `getCurrentUser()` returns null | Bar shows "User", avatar "U" | No crash |

</frozen-after-approval>

## Code Map

- `velara-web/src/shared/components/AppBar.tsx` -- internal top bar; remove role switcher (311–330), access pill (334–340), `role === 'internal'` wrappers (296–309, 342–355); render real user row; drop `useRoleStore` import + destructure.
- `velara-web/src/shared/utils/auth.ts` -- `AuthUser` interface (29–33) gains `name`/`email`; `login()` (165–170) reads `name`/`email` claims; `_mockAuthSession` (204–209) adds the two fields.
- `velara-web/src/shared/components/AppBar.test.tsx` -- test at 29–36 asserts the removed elements; update to assert removal + real-name rendering.
- `velara-web/src/pages/LoginPage.tsx` -- reference only; `useRoleStore.setRole` here must remain untouched.

## Tasks & Acceptance

**Execution:**
- [x] `velara-web/src/shared/utils/auth.ts` -- add `name: string` and `email: string` to `AuthUser`; in `login()` read `claims['name']`/`claims['email']` (`?? ''`) into the user object (do NOT add them to the required-claims validation — they're optional); add both fields to the `_mockAuthSession` default user.
- [x] `velara-web/src/shared/components/AppBar.tsx` -- remove the role-switcher block, the access-status pill, and the two `role === 'internal'` conditional wrappers (search cluster and user row now render unconditionally); remove the `useRoleStore` import and the `const { role, setRole } = useRoleStore()` line; add a small helper to resolve display name (`name || email || 'User'`) and initials, and render them in place of the hardcoded "MM"/"M. Maxwell"/"Methodology key" (drop the "Methodology key" subtitle — no real equivalent; render the email as the subtitle when it differs from the shown name, else omit the subtitle).
- [x] `velara-web/src/shared/components/AppBar.test.tsx` -- replace the "role switcher" test: assert `queryByRole('button', { name: 'Client portal' })` is null, `queryByText('Full access')` is null, and that a seeded user name renders (set a `velara_user` with a known `name` in a `beforeEach`, or via `_mockAuthSession`, and assert `getByText` for it); keep the wordmark, Search, ⌘K-palette, and Log-out tests green.

_Note: `auth.test.ts`, `LoginPage.test.tsx` also updated — they build typed `AuthUser` mocks that required the two new fields; a `login()` claim-capture test was added._

**Acceptance Criteria:**
- Given a signed-in internal user whose ID token carries `name`, when the internal AppBar renders, then it displays that name and initials (not "M. Maxwell"/"MM").
- Given the internal AppBar, when it renders, then there is no "Vitalief team"/"Client portal" role switcher and no "Full access"/"Outputs only" pill.
- Given the removed siblings, when the bar renders, then the ⌘K search control and Log-out button remain present and functional (palette opens on ⌘K).
- Given a user logging in, when redirected post-login, then `LoginPage`'s role-based redirect still works (`useRoleStore` unchanged).
- Given `npm run typecheck`, `npm run lint`, and `npm test`, when run, then all pass.

## Spec Change Log

- **2026-07-02 — review patches (no loopback).** Three-reviewer pass (blind / edge-case / acceptance auditor): acceptance auditor fully compliant; no intent_gap/bad_spec. Two `patch`-class fixes applied to `resolveUserDisplay` in `AppBar.tsx`: (1) trim `name`/`email` before the `||` fallback so a whitespace-only claim falls through name→email→'User' instead of rendering a blank identity row; (2) strip non-alphanumerics from initials and apply the `'U'` fallback to both branches so a stray leading `@`/punctuation never surfaces as an avatar glyph. Added an AppBar regression test for the whitespace-name→email fallback. Rejected: `useRoleStore.role` being write-only (spec explicitly keeps the store + LoginPage's `setRole`) and a Code-Map path imprecision (correct files untouched).

## Design Notes

The AppBar renders only inside `InternalShell`, which is wrapped by `RequireInternal` — so `role` was effectively always `'internal'` inside it; the toggle to `'client'` merely hid controls without switching shells. Removing the store read is therefore behavior-preserving for the internal bar. `useRoleStore` legitimately survives because `LoginPage` uses `setRole` to pick the initial shell.

Name/initials helper (illustrative, ~8 lines):
```ts
const u = getCurrentUser()
const displayName = u?.name || u?.email || 'User'
const initials = displayName.includes('@')
  ? displayName.slice(0, 2).toUpperCase()
  : displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'U'
```

## Verification

**Commands:**
- `cd velara-web && npm run typecheck` -- expected: no errors (new `AuthUser` fields resolve everywhere).
- `cd velara-web && npm run lint` -- expected: no new lint errors (unused `useRoleStore` import removed).
- `cd velara-web && npm test` -- expected: all suites pass, including the updated `AppBar.test.tsx`.

**Manual checks:**
- Run `npm run dev`, sign in as a seed internal user, confirm the bar shows the real name (or email fallback), no role toggle, no access pill, and the search sits with more room; ⌘K still opens the palette; Log out still redirects to /login.

## Suggested Review Order

**Username source (data)**

- Entry point — the real display name is resolved here, name→email→'User' with trim guards.
  [`AppBar.tsx:266`](../../velara-web/src/shared/components/AppBar.tsx#L266)

- `AuthUser` gains `name`/`email`; these carry the identity into the bar.
  [`auth.ts:29`](../../velara-web/src/shared/utils/auth.ts#L29)

- `login()` reads the standard OIDC `name`/`email` claims (optional — not in the required-claims check).
  [`auth.ts:177`](../../velara-web/src/shared/utils/auth.ts#L177)

**AppBar UI cleanup**

- User row now renders resolved name/initials in place of hardcoded "M. Maxwell"/"MM".
  [`AppBar.tsx:339`](../../velara-web/src/shared/components/AppBar.tsx#L339)

- Search + user row render unconditionally (role switcher, access pill, and `role === 'internal'` gates removed); `useRoleStore` import dropped.
  [`AppBar.tsx:329`](../../velara-web/src/shared/components/AppBar.tsx#L329)

**Tests**

- AppBar: asserts real-name render, "User"/email fallbacks, and absence of the role switcher / access pill.
  [`AppBar.test.tsx:33`](../../velara-web/src/shared/components/AppBar.test.tsx#L33)

- auth: verifies `login()` captures `name`/`email` claims from the ID token.
  [`auth.test.ts:150`](../../velara-web/src/shared/utils/auth.test.ts#L150)

- LoginPage: typed `AuthUser` mocks extended with the new fields (redirect logic unchanged).
  [`LoginPage.test.tsx:51`](../../velara-web/src/pages/LoginPage.test.tsx#L51)
