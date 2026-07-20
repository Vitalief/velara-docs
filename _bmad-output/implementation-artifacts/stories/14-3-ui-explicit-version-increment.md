---
baseline_commit: 6c6e97c (velara-api) / bcafff3 (velara-web)
---

# Story 14.3: Expose Explicit Version Increment in the Skill Edit UI

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an MA Tech developer publishing a new skill version,
I want to set the version number in the UI (e.g. choose a major bump `1.4.0 → 2.0.0`) instead of only getting an automatic minor bump,
so that I control the semver signal a version change sends, without hand-calling the API.

## Acceptance Criteria

1. **AC1 — The version-authoring UI exposes an optional version field.**
   **Given** the new-version / publish flow in the skill edit screen (`SkillContentEditor`, the non-draft "Create new version" surface built in Story 11.6)
   **When** I author a new version
   **Then** an optional **Version** input is shown, pre-filled with (or placeholder-showing) the next auto-minor-bump so the default behavior is unchanged if I leave it alone.

2. **AC2 — Leaving it blank preserves today's auto-bump.**
   **Given** I don't touch the version field
   **When** I publish
   **Then** the request omits `version` and the backend auto-bumps minor exactly as today — no behavior change for the default path.

3. **AC3 — An explicit version is validated with a clear inline error.**
   **Given** I enter a version
   **When** it is not strictly greater than the current version (or not canonical semver)
   **Then** the UI surfaces the backend's `INVALID_VERSION` (422) as a clear inline field error ("must be greater than current `X.Y.Z`") before or upon submit — the user isn't left guessing. Client-side semver + greater-than validation is a nice-to-have that short-circuits the obviously-invalid case before a round trip; the backend remains the source of truth and its 422 must still render inline (not just a generic toast) if a client-side check is bypassed or wrong.

4. **AC4 — Applies to both the inline-content and ZIP-bundle new-version paths.**
   **Given** a prompt/code skill (inline content) or a hybrid skill (ZIP bundle) new version
   **When** I set a version
   **Then** the field works identically on both authoring paths (both route through `SkillContentEditor`'s single `handleSave`, which already branches on `isHybrid` for the artifact but shares one `mutation.mutate` call — the version field must feed into that same shared body for both branches, not be duplicated per-branch).

**Out of scope (unchanged):** the draft in-place edit path (`updateDraftContent` / `PUT /draft-content`, Story 11.6) never sets a version — it re-points the *current* version's artifact with no bump. This story touches **only** the non-draft "Create new version" path (`createVersion` / `POST /versions`).

## Tasks / Subtasks

- [x] **Task 1 — Add the Version field to `SkillContentEditor`'s non-draft path (AC1, AC2, AC4) — `velara-web/src/features/skills/components/SkillContentEditor.tsx`**
  - [x] Add a `version` string state, e.g. `const [version, setVersion] = useState('')`, initialized empty (blank = auto-bump, AC2).
  - [x] Render a new `<Field label="Version (optional)">` **only when `!isDraft`** (the draft path never sets a version — the field must not appear there). Place it once, above or alongside the existing content/bundle inputs, so it applies uniformly whether `isHybrid` renders `SkillBundleUpload` or the plain-content branch renders the textarea (AC4 — one shared field feeding one shared body, not duplicated per runtime-type branch).
  - [x] Compute a **placeholder** showing the next auto-bump: reuse `skill.current_version?.version` (already on `SkillWithVersion.current_version.version`, no new fetch) and a local `bumpMinor(version: string): string` helper (`major.(minor+1).0`) mirroring the backend's `_bump_minor` — if there's no current version, show no placeholder (mirror the backend's `"0.0.0"` fallback only if needed for display; simplest is to omit the placeholder when `current_version` is null, since a skill always has one by the time this non-draft path is reachable). Placeholder text, not a pre-filled value — leaving the input empty must still omit `version` from the request body (AC2 — do not silently coerce placeholder-into-value).
  - [x] In `handleSave`, extend the existing body construction (`const body = bundleKey ? { bundle_key: bundleKey } : { content, content_type: contentType }`) to conditionally add `version: version.trim()` **only when non-empty** and **only when `!isDraft`**: e.g. `...(!isDraft && version.trim() ? { version: version.trim() } : {})`. The draft branch (`updateDraft`) must never receive a `version` key — `SkillDraftContentInput` has no such field and the backend route doesn't accept one.

- [x] **Task 2 — Client-side semver + greater-than validation (AC3) — same file**
  - [x] Add a local `isValidSemver(v: string): boolean` (canonical `X.Y.Z`, non-negative integers, no leading zeros beyond `0` itself — match the backend's `_parse_semver`/`InvalidVersionError` acceptance, see Dev Notes) and a `semverGreaterThan(a: string, b: string): boolean` helper. **Do not import anything** — there is no semver library in this repo; `CertificationHistory.tsx` already hand-rolls an equivalent `parseSemver`/`semverGt` pair (not exported) — write a local equivalent in this file rather than trying to share it across features.
  - [x] On blur or on submit attempt, if `version.trim()` is non-empty and (not canonical semver OR not strictly greater than `skill.current_version?.version`), show an inline field error via `Field`'s `error` prop: `` `Must be greater than current ${current}.` `` (or a canonical-format message if the string doesn't parse as semver at all). This is a **pre-submit UX nicety** — it must not block the actual submit path from also handling the server's 422 (see next bullet); if the client check has a bug or edge case it disagrees with the server on, the server's `INVALID_VERSION` must still be user-visible.
  - [x] The **existing** error-rendering block (`{mutation.error && !showAiAdaptAffordance && <p>{apiMessage ?? getErrorMessage(mutation.error)}</p>}`) already surfaces any 422 `INVALID_VERSION` returned by `createVersion` generically — confirm `getApiMessage` returns the backend's exact message (`"New version 'X' must be greater than current 'Y'."`) and that it renders inline near the button, not as a toast, so AC3's "clear inline field error" is satisfied. If a field-scoped placement is preferred (message under the Version input rather than at the bottom), route the `INVALID_VERSION` case specifically to the `Field`'s `error` prop as well — but do not remove the generic bottom-of-panel handling for other error codes.

- [x] **Task 3 — Frontend tests (AC: all) — `velara-web/src/features/skills/components/SkillEdit.test.tsx` (or a new co-located `SkillContentEditor.test.tsx` if the existing suite only exercises `SkillEdit` at arm's length — check first)**
  - [x] Version field renders for a non-draft skill (`isDraft === false`), both `isHybrid` and inline branches; does **not** render for a `draft` skill.
  - [x] Leaving the field blank and saving calls `createVersion`/`useCreateSkillVersion`'s mutate with a body that has **no `version` key** (assert via the mocked hook's `mutate` call args — `expect(mutate).toHaveBeenCalledWith(expect.not.objectContaining({ version: expect.anything() }), ...)` or equivalent).
  - [x] Entering a valid greater version includes `version` in the mutate body, unchanged otherwise.
  - [x] Entering a version **not** greater than `current_version.version` shows the inline client-side error and does not (or does, then server-rejects — pick whichever matches the implementation) proceed; separately, mock the mutation hook's `error` to a `INVALID_VERSION` `ApiError` shape and assert the message renders inline (covers the server-truth path independent of the client check).
  - [x] Follow the existing suite's pattern: `vi.mock('@/features/skills/hooks/useSkills')`, mocked `useCreateSkillVersion`/`useDraftContent`/`useUpdateDraftContent` return shapes already established in `SkillEdit.test.tsx` (lines ~93-107) — extend those mocks with `current_version: { version: '1.4.0', ... }` fixtures rather than inventing a new mock shape.

- [x] **Task 4 — Gates**
  - [x] `npm run typecheck` → 0 errors.
  - [x] `npm run lint` → 0 new errors (baseline: 1 known pre-existing `Icon.tsx` warning per Story 11.6 — confirm current baseline hasn't shifted before attributing any new warning to this story).
  - [x] `npm run test` (vitest) → record new pass count; no regressions in `SkillEdit.test.tsx` / `SkillContentEditor`-adjacent suites.
  - [x] **No backend changes, no migration, no `docs/api-spec.json` regen** — the `version` field already exists in `SkillVersionCreate`/`create_version` and is already in the OpenAPI contract (confirm with a quick diff-check that nothing changed, do not regenerate speculatively).

## Dev Notes

### This is a pure FE story — the backend already does everything needed

**Verified directly in `velara-api` (do not re-derive, do not touch these files):**

- `create_version` ([skill_service.py:1085-1096](../../../velara-api/app/services/skill_service.py#L1085)) already accepts `version: str | None`. Docstring: *"If version is None, bumps minor from current (e.g. 1.0.0 → 1.1.0). The new version must be strictly greater than the current."*
- The bump/validate logic ([skill_service.py:1124-1125](../../../velara-api/app/services/skill_service.py#L1124)): `new_ver_str = version or _bump_minor(current_ver_str)` then `_assert_version_greater(new_ver_str, current_ver_str)`.
- `_bump_minor` ([skill_service.py:287-289](../../../velara-api/app/services/skill_service.py#L287)): `f"{major}.{minor + 1}.0"` — a minor bump always zeroes the patch.
- `_assert_version_greater` ([skill_service.py:292-296](../../../velara-api/app/services/skill_service.py#L292)) raises `InvalidVersionError` (422, `ERROR_CODE = "INVALID_VERSION"`) with message: `f"New version '{new_version}' must be greater than current '{current_version}'."` — **this exact string is what `getApiMessage` will surface**; AC3's inline copy should not fight it, just make sure it's rendered (not swallowed).
- Semver parsing lives near [skill_service.py:270-296] (`_parse_semver`, referenced at line 275's docstring: *"Raises InvalidVersionError on anything non-canonical (negatives, leading zeros, etc.)"*) — mirror this canonical-form definition in the client-side `isValidSemver` check so the two don't disagree on edge cases like `1.04.0` or `01.2.3`.
- `SkillVersionCreate` schema ([schemas/skill.py:129-146](../../../velara-api/app/schemas/skill.py#L129)): `version: str | None = Field(default=None, max_length=32)` — already optional, already wired, already documented as "service auto-bumps minor if absent." **No schema change.**
- **Contrast with the draft path:** `SkillDraftContentUpdate` ([schemas/skill.py:159+](../../../velara-api/app/schemas/skill.py#L159)) has **no** `version` field by design (11.6 Dev Notes: "mirrors `SkillVersionCreate` minus `version` — an in-place edit never sets a version string"). Do not add one there; the draft path is explicitly excluded from this story's scope.

**Conclusion: zero backend files change. No migration. No `docs/api-spec.json` diff** (the field was already in the contract before this story). If dev-story finds itself editing anything under `velara-api/`, stop and re-read this section — that's a signal of scope creep.

### The exact FE surface to touch (verified by reading the current code, not the epic's guess)

The epic text says "the Story 11.6 `SkillEdit` + `createVersion` surface" — **more precisely**, Story 11.6 built a dedicated child component, `SkillContentEditor.tsx`, mounted inside `SkillEdit.tsx`. `SkillContentEditor` is where `useCreateSkillVersion`/`createVersion` is actually invoked (line 42, `const createVersion = useCreateSkillVersion(skill.id)`) and where `handleSave` builds the mutation body (line 86-102). **This story's entire diff should live in `SkillContentEditor.tsx`** (+ its test file) — `SkillEdit.tsx` itself needs no changes, it just mounts the child.

Current `handleSave` (the exact code you're extending):
```ts
function handleSave() {
  const body = bundleKey ? { bundle_key: bundleKey } : { content, content_type: contentType }
  mutation.mutate(body, { onSuccess: () => { ... } })
}
```
`mutation` is `isDraft ? updateDraft : createVersion` (line 64) — **the same `handleSave` serves both the draft and non-draft paths today.** Your `version` field must only ever be added to the body when `!isDraft` (the draft mutation type, `SkillDraftContentInput`, structurally has no `version` field — TypeScript will catch a misuse here, but be deliberate about it rather than relying on the type error).

`SkillWithVersion.current_version.version` ([types.ts:113-125, 127-130](../../../velara-web/src/features/skills/types.ts#L113)) is already on the `skill` prop passed into `SkillContentEditor` — no new query needed to compute the placeholder or the client-side greater-than check.

### House patterns to follow (verified, do not invent alternatives)

- **`Field` component** ([shared/components/Field.tsx](../../../velara-web/src/shared/components/Field.tsx)) is the house label+input+error wrapper — `<Field label="..." error={...}>`. Use it for the new Version input exactly as the existing Content/Content type fields do (`SkillContentEditor.tsx` lines 181-198) — do not hand-roll a new label/error pattern.
- **`inputCls`/`errorCls`** exported from `Field.tsx` — reuse for the `<input type="text">`, do not restyle.
- **No semver library in the repo** (`package.json` has none; only hand-rolled parsers exist). `CertificationHistory.tsx` ([lines 8-19](../../../velara-web/src/features/certification/components/CertificationHistory.tsx#L8)) has a local, non-exported `parseSemver`/`semverGt` pair used for sorting — same shape you need for the greater-than check, but it is not exported/shared, so write your own local version in `SkillContentEditor.tsx` (do not add a cross-feature import from `certification` into `skills`, and do not extract a shared util for a two-call-site helper — Rule of Three).
- **Error surfacing:** `getApiCode`/`getApiMessage`/`getErrorMessage` from `@/shared/utils/errors` (already imported in this file) are the house pattern for turning an `ApiError` into UI text — reuse them for the `INVALID_VERSION` case rather than inventing new error-parsing.

### Testing standards

- Vitest + Testing Library, jsdom, co-located `*.test.tsx` (existing convention). `SkillEdit.test.tsx` already mocks `useCreateSkillVersion`/`useDraftContent`/`useUpdateDraftContent` from `@/features/skills/hooks/useSkills` (lines ~9-15, ~93-107) — extend those existing mock fixtures with a `current_version` object rather than introducing new mock scaffolding. Check whether `SkillContentEditor` has its own test file today (Story 11.6's File List does not show one — coverage lives inside `SkillEdit.test.tsx`) before deciding whether to add a new file or extend the existing one; prefer extending unless the existing file is already unwieldy.
- No backend tests needed (no backend change).

### Previous Story Intelligence (Story 11.6 — direct predecessor, same component)

- 11.6 built `SkillContentEditor` as **not folded into `SkillForm`** (which stays create-only) — this story's changes belong in that same component, not in `SkillForm.tsx` or `SkillEdit.tsx`.
- 11.6 review found and fixed a stale-mutation-body class of bug (patch: stale `bundle_key` re-submit after success) — be mindful that `handleSave`'s `onSuccess` already resets `bundleKey`/`bundleFile` on a successful bundle save; ensure the new `version` state is **also** cleared (or intentionally left, if there's a reason to keep it, e.g. re-showing the just-set value) on a successful save so a second save doesn't silently resend a now-stale explicit version. Recommend clearing it to `''` alongside the existing bundle-state reset in `onSuccess`, so the placeholder correctly reflects the new current version on the next save.
- 11.6 established the two-mutation-object pattern (`mutation = isDraft ? updateDraft : createVersion`) that this story must respect, not restructure.
- Gate baselines from 11.6 (for regression comparison, may have moved since — re-check current numbers before attributing any new failure to this story): FE typecheck 0 / lint 0 errors (1 known `Icon.tsx` warning) / vitest 621 passed.

### Epic Context

Epic 14 (Skill Upgrade Flexibility) has 3 stories; this is **14.3, the first to be built** (independent, FE-only, explicitly recommended to ship first — see epic file's Story Sequencing table). **14.1** (relax hybrid shape-lock) and **14.2** (AI adapter on upgrade path, depends on 14.1) are unrelated backend/cross-cutting work and share no files with this story. Do not look for or assume any dependency on them.

### Project Structure Notes

- **Frontend only (velara-web):** MODIFY `src/features/skills/components/SkillContentEditor.tsx` (Version field, state, validation, body construction); MODIFY its test coverage (`SkillEdit.test.tsx` or a new co-located test file — see Testing standards above).
- **No backend changes** (velara-api untouched — confirmed above).
- **Two nested repos:** `velara-api` and `velara-web` are separate git repos nested under the top-level `velara` (which holds `_bmad-output` docs) — a third, the top-level docs repo. This story only touches `velara-web`, so only one commit is expected there (no `velara-api` commit at all, since nothing changes). **NEVER push subrepos** — commit-only in `velara-web`; only the top-level docs repo is pushed, and only with explicit permission (project memory: Never Push Subrepos).

### References

- [Source: epics/epic-14-skill-upgrade-flexibility.md#Story-14.3] — story origin, ACs, epic-level investigation notes, sequencing table.
- [Source: velara-api app/services/skill_service.py:1085-1134] — `create_version` (version param, bump/validate logic, docstring); [:270-296] `_parse_semver`/`_bump_minor`/`_assert_version_greater`/`InvalidVersionError`.
- [Source: velara-api app/schemas/skill.py:129-157] — `SkillVersionCreate` (`version` field, already optional); [:159+] `SkillDraftContentUpdate` (deliberately has no `version` — contrast).
- [Source: velara-web src/features/skills/components/SkillContentEditor.tsx] — the entire target surface: `handleSave` (body construction), `mutation = isDraft ? updateDraft : createVersion`, existing `Field`/error-rendering patterns.
- [Source: velara-web src/features/skills/types.ts:23-25, 113-130] — `SkillVersionCreateInput` (`version?: string` already present); `SkillWithVersion.current_version.version` (the value to diff against).
- [Source: velara-web src/features/skills/hooks/useSkills.ts:64-74] — `useCreateSkillVersion` (unmodified; body just gains an optional key).
- [Source: velara-web src/features/certification/components/CertificationHistory.tsx:8-19] — precedent for a local, non-exported semver parse/compare helper (pattern to mirror, not import).
- [Source: velara-web src/shared/components/Field.tsx] — house `Field`/`inputCls`/`errorCls` pattern.
- [Source: _bmad-output/implementation-artifacts/stories/11-6-author-new-skill-versions-from-ui.md] — direct predecessor story that built `SkillContentEditor`; its Dev Notes, review findings (stale-mutation-body bug class), and gate baselines.
- [Source: project memory — Never Push Subrepos; velara-web is a separate nested git repo].

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `Skill` (the prop type `SkillContentEditor` originally declared) lacks `current_version` — only `SkillWithVersion` carries it. Widened `SkillContentEditorProps.skill` to `SkillWithVersion` (the only shape `SkillEdit` ever passes in via `useSkill`, which returns `SkillWithVersion`) rather than adding a second optional prop.
- The house `Field` component (`shared/components/Field.tsx`) renders `<label>` as a sibling of its input children with no `htmlFor`/`id` association — `getByLabelText` cannot resolve it (confirmed by running the new tests red first: 4 failures on that exact query). No prior test in the repo queries a `Field`-wrapped input via `getByLabelText` either (only components with real semantic `<label htmlFor>` markup, e.g. `AIAdapterReview`, `SkillBundleUpload`, use that query). Fixed by adding a small `getVersionInput()` test helper that locates the input via the label text's `nextElementSibling`, and using `getByPlaceholderText` for the content textarea instead. Did not modify `Field.tsx` itself — out of scope for this story and would ripple across every other `Field` consumer.

### Completion Notes List

- **AC1/AC2/AC4:** Added an optional "Version (optional)" `Field` to `SkillContentEditor`, rendered only when `!isDraft` (never on the draft in-place-edit path), positioned once above the runtime-type branch so it applies identically to both the inline-content and hybrid ZIP-bundle new-version flows. Placeholder shows the next auto-minor-bump (`bumpMinor(skill.current_version.version)`); leaving the field blank omits `version` from the mutation body entirely, preserving the exact pre-story auto-bump behavior (verified by a test asserting `mutate` is called with `expect.not.objectContaining({ version: ... })`).
- **AC3:** Added local, non-exported `isValidSemver`/`semverGreaterThan`/`parseSemver` helpers (mirroring the backend's canonical-form acceptance) for a pre-submit inline check (shown after first blur or a submit attempt), plus confirmed the existing generic error-rendering block already surfaces the server's `INVALID_VERSION` 422 message verbatim as a fallback/source-of-truth path — covered independently by a test that mocks the mutation hook's `error` directly (bypassing the client-side check).
- **Version state is cleared on a successful save** (alongside the existing bundle-key reset) so a second save doesn't silently resend a stale explicit version — the placeholder then recomputes from the newly-current version.
- **Zero backend changes** — confirmed `velara-api` git status is clean throughout; the `version` param, bump/validate logic, and `SkillVersionCreate` schema were already fully implemented and unchanged. No migration, no `docs/api-spec.json` diff.
- **Widened `SkillContentEditorProps.skill`** from `Skill` to `SkillWithVersion` (see Debug Log) — the only production caller (`SkillEdit.tsx`) already passes a `SkillWithVersion`, so this is a type-accuracy fix with no behavioral change.
- Gates: typecheck 0 errors; lint 0 errors (1 known pre-existing `Icon.tsx` warning, baseline unchanged); vitest 715 passed across 59 files (SkillEdit.test.tsx alone: 17 passed, up from 10 pre-story).

### File List

**Frontend (velara-web):**
- MODIFIED `src/features/skills/components/SkillContentEditor.tsx` — Version field, state, semver validation helpers, `handleSave` body wiring, widened prop type to `SkillWithVersion`
- MODIFIED `src/features/skills/components/SkillEdit.test.tsx` — new `describe('SkillEdit — explicit version increment (Story 14.3)')` block (8 new tests) + `getVersionInput()` test helper

## Change Log

| Date | Change |
|---|---|
| 2026-07-20 | Story 14.3 drafted (create-story). Pure FE story — backend `version` param already exists and is unchanged. Target surface identified precisely as `SkillContentEditor.tsx` (not `SkillEdit.tsx`, which only mounts it). Epic 14 marked in-progress (first story). Status → ready-for-dev. |
| 2026-07-20 | Story 14.3 implemented (dev-story). Added optional Version field to `SkillContentEditor`'s non-draft path with auto-bump placeholder, client-side semver + greater-than validation, and blank-omits-version wiring into `handleSave`. Widened `SkillContentEditorProps.skill` to `SkillWithVersion` (needed for `current_version`). 8 new frontend tests in `SkillEdit.test.tsx`. Zero backend changes (confirmed). Gates: typecheck 0, lint 0 new errors, vitest 715 passed. Status → review. |
