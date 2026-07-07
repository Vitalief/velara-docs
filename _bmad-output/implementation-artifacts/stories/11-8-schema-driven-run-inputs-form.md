---
baseline_commit: 6038613d0b195e3ccc33b147bf00c852077041e2
---

# Story 11.8: Schema-Driven Run Inputs Form

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Implementation order:** this story is sequenced to run **BEFORE Story 11.1**, despite its higher number. It is numbered 11.8 only because sprint-status keys must be `epic-story-name` and there is no `11-0` slot; the number is not the run order. It unblocks the whole class of input-taking skills (the first real `code` skill — a Protocol Visit Budget Calculator — and the `velara-protocol-extractor`'s parameters), none of which can be parameterized from the UI today. Epic 11 is already `in-progress`; this story changes no epic state.

## Story

As a non-technical Velara user running a skill,
I want a proper labeled form (not a raw JSON box) for a skill's declared inputs,
so that I can supply run parameters without knowing the skill's internal keys, types, or JSON syntax.

## Acceptance Criteria

1. **AC1 — Internal Run Console renders a form from the skill's `input_schema`.**
   **Given** a skill whose `input_schema` declares top-level properties (string / number / integer / boolean / enum)
   **When** I open it in either Run Console mode (context-first or skill-first)
   **Then** a labeled form field is rendered per property — text for string, number spinner for number/integer, dropdown for `enum`, toggle for boolean — using the schema's `title` (label), `description` (helper text), `default` (pre-filled), `minimum`/`maximum`, and `required`. The user never sees or types JSON.

2. **AC2 — The assembled `inputs` object reaches the backend.**
   **Given** the user fills the form and clicks Run
   **When** the invocation is submitted
   **Then** the values are assembled into an `inputs` object and sent as `payload.inputs` on the invocation request — populating `job.inputs["inputs"]` server-side (the field already exists end-to-end; today nothing on the FE ever sets it). A run with no inputs still works exactly as today.

3. **AC3 — Client-side validation from the schema; no raw JSON ever shown.**
   **Given** the schema declares `required`, types, or `minimum`/`maximum`
   **When** the user submits invalid/missing values
   **Then** per-field errors block submission and render inline (matching the existing `SkillForm` `Field` error pattern). **A raw JSON textarea is never rendered to an end user** under any condition.

4. **AC4 — Graceful absence: no schema → no inputs section.**
   **Given** a skill with `input_schema` null/empty, or containing only unsupported (nested object / array / `oneOf`) properties
   **When** I open it in the Run Console
   **Then** no inputs section renders at all (the run proceeds exactly as today). Unsupported property kinds are silently skipped in this first cut (flat primitives only); a property with no `title` falls back to a humanized key label (e.g. `num_sites` → "Num sites").

5. **AC5 — Client portal renders the same form from a sanitized, IP-safe field projection.**
   **Given** the client portal deliberately hides skill internals (`ClientSkillRead`/`ClientSkill` omit `input_schema` — IP protection "C5")
   **When** a client-portal user opens an input-taking skill
   **Then** the form is driven by a **new derived `run_fields` projection** (label/type/enum/min/max/default per top-level property — **never** the raw schema, never author `description` prose that could leak methodology), assembled into `inputs`, and sent through the client invocation path. The raw `input_schema` is **not** added to the client surface.

## Tasks / Subtasks

> **Two decisions locked with the Project Lead at story creation (do not re-litigate — see Dev Notes "Locked decisions"):**
> **(D1) Client portal uses a sanitized `run_fields` projection**, NOT the raw `input_schema` — preserves the deliberate C5 IP boundary.
> **(D2) FE-only validation now; server-side jsonschema validation is deferred** (the backend already treats `inputs` as an opaque dict; a malformed inputs dict makes a skill compute on bad data but breaches nothing).

- [ ] **Task 1 — Schema→fields interpreter (AC1, AC4) — NEW `src/features/run/inputsSchema.ts`**
  - [ ] `parseInputFields(schema: Record<string, unknown> | null): InputField[]` — walk `schema.properties` (top-level only), producing a typed `InputField[]`:
    - `{ key, label, kind: 'string'|'number'|'integer'|'boolean'|'enum', description?, default?, min?, max?, enumValues?, required }`.
    - `kind`: `type:"boolean"` → `boolean`; `type:"number"|"integer"` → number; presence of `enum` → `enum` (dropdown of `enum` values); else `string`. **Skip** any property whose `type` is `object`/`array`, or that uses `oneOf`/`anyOf`/`allOf`/`$ref` — flat primitives only this cut (AC4).
    - `label` = `property.title` else humanized key (`num_sites` → "Num sites").
    - `required` from the schema's top-level `required: string[]`.
  - [ ] Return `[]` for null/empty schema, or when every property is unsupported (drives AC4's "no section").
  - [ ] Pure function, no React — unit-testable standalone. Values in the schema are `unknown` (FE `input_schema` is `Record<string, unknown> | null`) — narrow defensively.

- [ ] **Task 2 — The form component (AC1, AC3, AC4) — NEW `src/features/run/components/SchemaInputsForm.tsx`**
  - [ ] Props: `{ fields: InputField[]; value: Record<string, unknown>; onChange: (next) => void; errors: Record<string, string> }`. Renders nothing (returns `null`) when `fields` is empty (AC4).
  - [ ] Render per `kind`: text `<input>` (string), `<input type="number">` (number/integer, with `min`/`max`), `<select>` (enum), `<Toggle>` (boolean — reuse [Toggle](../../../velara-web/src/shared/components/Toggle.tsx), the only shared form primitive, props `{checked,onChange,label,id}`). Wrap each in a `Field`-style label + error + helper block.
  - [ ] **`Field`/`inputCls` reuse:** the house `Field` component + `inputCls`/`labelCls`/`errorCls` are **local to `SkillForm.tsx`** ([SkillForm.tsx:8-29](../../../velara-web/src/features/skills/components/SkillForm.tsx#L8), not exported) and there is **no shared `Field`** anywhere. Promote `Field` + the style constants to a shared module (`src/shared/components/Field.tsx`) and re-import in both `SkillForm` and `SchemaInputsForm` — do NOT copy-paste the styles into a second place (that's the drift the reuse rule forbids). Keep `SkillForm` behavior byte-identical after the extraction (its tests must still pass untouched).
  - [ ] Coerce on the way out: number/integer fields → `Number(...)` (not string); boolean → `bool`; empty optional string → omit the key. Assemble a clean `inputs` object.
  - [ ] Helper text = `field.description` (internal only — see Task 5 for why the client path does NOT pass descriptions).

- [ ] **Task 3 — Validation (AC3) — NEW `validateInputs(fields, value): Record<string,string>`**
  - [ ] Flat `{ [key]: message }` errors, matching `SkillForm`'s `FormErrors` shape ([SkillForm.tsx:92-153,252](../../../velara-web/src/features/skills/components/SkillForm.tsx#L92)): required-but-empty, number NaN, `< minimum` / `> maximum`, enum-not-in-list. Returned map is empty when valid.
  - [ ] Called on submit; if non-empty, block the run and `setInputErrors` before rendering — do NOT mutate the existing double-submit / duplicate-check flow.

- [ ] **Task 4 — Wire into both internal Run Console modes (AC1, AC2) — `src/features/run/components/RunConsole.tsx`**
  - [ ] `InvocationPayload.inputs` **already exists** ([jobs.ts:9-17](../../../velara-web/src/api/jobs.ts#L9)) — no type change; just populate it. Add `inputs` to **both** `buildRunPayload()` bodies next to the `file_ref_ids` merge: context-first [RunConsole.tsx:486-503](../../../velara-web/src/features/run/components/RunConsole.tsx#L486) and skill-first [RunConsole.tsx:736-751](../../../velara-web/src/features/run/components/RunConsole.tsx#L736). Only set `inputs` when the assembled object is non-empty (an empty `inputs` with empty `file_ref_ids` is dropped to `None` server-side, [invocations.py:262](../../../velara-api/app/api/v1/invocations.py#L262) — harmless, but don't send `{}`).
  - [ ] **Schema availability per mode (VERIFIED — this is the mechanical gotcha):**
    - **Skill-first** (`RunConsoleSkillFirstInner`): full skill already loaded via `useSkill(skillId)` ([RunConsole.tsx:644](../../../velara-web/src/features/run/components/RunConsole.tsx#L644)) → `skill.input_schema` is directly available.
    - **Context-first** (`RunConsoleInner`): the selected skill is an `AttachedSkill` (from `skillAttachments`), which may NOT carry `input_schema`. **Verify `AttachedSkill`'s type**; if it lacks `input_schema`, fetch the full skill with `useSkill(selectedSkill.id)` (gated `enabled` on a selection) to get the schema. Do not assume it's present.
  - [ ] Render `<SchemaInputsForm>` as a sibling right after `<DocumentUploadCard>` (context-first [~line 593](../../../velara-web/src/features/run/components/RunConsole.tsx#L593); skill-first [~line 855](../../../velara-web/src/features/run/components/RunConsole.tsx#L855)) inside `RunShell`'s left config column. Local state `const [inputsValue, setInputsValue] = useState({})` + `inputErrors`.
  - [ ] `buildRunPayload()` already feeds BOTH the submit path and the duplicate-check pre-flight ([RunConsole.tsx:509,756](../../../velara-web/src/features/run/components/RunConsole.tsx#L509)) — so adding `inputs` there automatically makes inputs part of duplicate identity (correct: same doc + different params = a different run). Confirm the duplicate-check debounce still behaves (inputs change → re-check), no infinite loop.

- [ ] **Task 5 — Client portal: sanitized `run_fields` projection (AC5) — backend + FE**
  - [ ] **Backend — derive a client-safe projection.** Add `run_fields: list[ClientRunField] | None` to `ClientSkillRead` ([schemas/client.py:34-48](../../../velara-api/app/schemas/client.py#L34)). A `ClientRunField` = `{key, label, type, enum?, minimum?, maximum?, default?, required}` — **derived server-side from `skill.input_schema`**, dropping any prose (`description`) and any unsupported (object/array/oneOf) property. Reuse the same top-level-primitives rule as Task 1 (a small pure Python helper, e.g. `client_run_fields(input_schema)` in `app/services/` or alongside the client schema). **Do NOT add `input_schema` itself to any client schema** — the C5 IP boundary stays intact.
  - [ ] `run_fields` is `None`/empty when the skill has no usable primitive inputs (drives AC4's no-section on the client too).
  - [ ] **FE — carry the projection.** Add `runFields?: ClientRunField[]` to `ClientSkill` ([client-portal/types.ts:18-24](../../../velara-web/src/features/client-portal/types.ts#L18)) + map it in `useClientSkills`. Then render the SAME `SchemaInputsForm` from `runFields` (adapt `parseInputFields` to also accept an already-projected `ClientRunField[]`, or add a thin `fieldsFromRunFields()` — one shared renderer, two field sources).
  - [ ] **FE — wire `inputs` through the client invocation path (3 edits, VERIFIED):** `InvokePayload` ([useClientCreateInvocation.ts:5-11](../../../velara-web/src/features/client-portal/hooks/useClientCreateInvocation.ts#L5)) has NO `inputs` — add `inputs?`; thread it into the `mutationFn` destructure/call; add `inputs?` to `createClientInvocation`'s payload param + POST body ([clientPortal.ts:139-156](../../../velara-web/src/api/clientPortal.ts#L139)). The backend client endpoint already accepts `inputs` (same `InvocationRequest`, [client.py:189](../../../velara-api/app/api/v1/client.py#L189)) and reaches `job.inputs["inputs"]` identically ([invocations.py:261-266](../../../velara-api/app/api/v1/invocations.py#L261)).
  - [ ] Render `<SchemaInputsForm>` in [ClientRun.tsx](../../../velara-web/src/features/client-portal/components/ClientRun.tsx) right after `<DocumentUploadCard>` ([~line 124](../../../velara-web/src/features/client-portal/components/ClientRun.tsx#L124)), before the location `<fieldset>`; assemble `inputs` into the payload built at [ClientRun.tsx:59-80](../../../velara-web/src/features/client-portal/components/ClientRun.tsx#L59).

- [ ] **Task 6 — Tests (AC: all)**
  - [ ] **Unit `inputsSchema.test.ts` (NEW):** `parseInputFields` — each primitive kind → correct `InputField`; `title` vs humanized-key label; `required`/`min`/`max`/`enum`/`default` carried; nested object / array / `oneOf` / `$ref` skipped; null/empty schema → `[]`. `validateInputs` — required-empty, NaN, out-of-range, bad enum → errors; valid → `{}`.
  - [ ] **Component `SchemaInputsForm.test.tsx` (NEW):** renders a field per kind; `Toggle` for boolean; dropdown options from `enum`; returns null for empty `fields`; error prop renders inline; `onChange` emits coerced values (number as number, not string).
  - [ ] **`RunConsole.test.tsx` (extend):** the existing `locationSkill`/`nonLocationSkill` fixtures set `input_schema: null` ([RunConsole.test.tsx:80-108](../../../velara-web/src/features/run/components/RunConsole.test.tsx#L80)) — add a fixture WITH a schema and assert: form renders in both modes; filling it + Run calls `mutate` with `payload.inputs` = the assembled object; a null-schema skill renders NO inputs section (AC4 regression); validation blocks submit. Follow the `mutateMock` payload-assertion pattern already in the file.
  - [ ] **`ClientRun.test.tsx` (extend):** add a `runFields` fixture; assert the form renders from `runFields`, the payload carries `inputs`, and a no-`runFields` skill renders no section. The client fixture currently has no schema field ([ClientRun.test.tsx:7-21](../../../velara-web/src/features/client-portal/components/ClientRun.test.tsx#L7)).
  - [ ] **Backend `test_client.py` (or `test_skills.py`) (extend):** `ClientSkillRead.run_fields` is derived correctly (primitives projected, prose/description dropped, nested skipped); raw `input_schema` is NOT present anywhere in the client response (IP regression — assert `"input_schema" not in body`).
  - [ ] **`SkillForm.test.tsx` (regress):** after extracting `Field`/`inputCls` to shared, `SkillForm`'s tests must still pass unchanged (proves the extraction was behavior-neutral).

- [ ] **Task 7 — Gates**
  - [ ] **Backend:** `ruff check .` clean; run suite (3 pre-existing `test_ingest.py` MinIO-in-container failures are unrelated); `python scripts/export_openapi.py` → regenerate `docs/api-spec.json` (additive: `run_fields` on `ClientSkillRead`); commit the diff.
  - [ ] **Frontend:** `npm run typecheck` → 0 errors; `npm run lint` (1 pre-existing `Icon.tsx` warning is baseline); `npx vitest run` green (record new baseline count).

## Dev Notes

### Why this exists (the gap, VERIFIED end-to-end)

The backend has ALWAYS accepted free-form `inputs` — `InvocationRequest.inputs: dict | None` ([schemas/invocation.py:58](../../../velara-api/app/schemas/invocation.py#L58)), placed verbatim into `job.inputs["inputs"]` ([invocations.py:261-266](../../../velara-api/app/api/v1/invocations.py#L261)) and exposed to `code`/`prompt`/`hybrid` runtimes. But **no FE surface has ever populated it.** Verified: both `buildRunPayload()` impls, `ClientRun`, and the client hook all omit `inputs`; `InvocationPayload.inputs` is a declared-but-dead field. `input_schema` is stored + returned but used only for authoring display (`SkillForm` JSON textarea, `SkillDetail` read-only `SchemaBlock`). This story finally connects the two — driven by the schema so **non-technical users get a labeled form, never JSON**.

### Locked decisions (do not re-litigate)

- **D1 — Client portal uses a sanitized `run_fields` projection, NOT raw `input_schema`.** `ClientSkillRead` deliberately omits `input_schema` (IP protection, "C5" — [schemas/client.py](../../../velara-api/app/schemas/client.py); the FE `ClientSkill` mirrors this omission). Rendering a client form requires exposing *something*; the decision is to expose a **derived, prose-free field projection** (labels/types/enums/bounds/defaults) — never the raw schema, never author `description` text. The IP boundary is preserved by construction.
- **D2 — FE-only validation now; server-side jsonschema deferred.** The backend does NO validation of `inputs` against `input_schema` (jsonschema is not a dependency — verified: zero `jsonschema`/`Draft*Validator`/`validate(instance=...)` hits in `app/`). `inputs` is an opaque dict with no size/depth limit. This is acceptable: a malformed inputs dict just makes a skill compute on bad data; it is advisory data, not a security boundary. Server-side validation (add `jsonschema`, validate in `queue_invocation`, 422 `INVALID_INPUTS`) is a **deferred hardening item** — record it in deferred-work.md, don't build it here.

### Scope boundary — flat primitives only (first cut)

**IN:** top-level `string` / `number` / `integer` / `boolean` / `enum` properties with `title` / `description` / `default` / `minimum` / `maximum` / `required`.
**OUT (silently skipped, deferred to a follow-up):** nested `object`, `array` (repeatable rows), `oneOf`/`anyOf`/`allOf`, conditional `if/then`, `$ref`, `pattern`/`format` string validation. If a skill's whole schema is unsupported, the form simply doesn't render (AC4). This covers the Protocol Visit Budget Calculator and the common case; a full JSON-Schema renderer is its own dedicated effort.

### Reuse map — do NOT reinvent

| Need | Reuse / verified fact |
|---|---|
| Labeled field + error + helper | `Field` + `inputCls`/`labelCls`/`errorCls` — **local to [SkillForm.tsx:8-29](../../../velara-web/src/features/skills/components/SkillForm.tsx#L8), not exported. Extract to `src/shared/components/Field.tsx`** and re-import in both places (no copy-paste). |
| Boolean control | `Toggle` — [src/shared/components/Toggle.tsx](../../../velara-web/src/shared/components/Toggle.tsx), the ONLY shared form primitive (`{checked,onChange,label,id}`). |
| Per-field error pattern | `FormErrors` flat map + `mergedErrors` + `<Field error=...>` ([SkillForm.tsx:92-153,252](../../../velara-web/src/features/skills/components/SkillForm.tsx#L92)). |
| Invocation payload type | `InvocationPayload.inputs` already exists ([jobs.ts:11](../../../velara-web/src/api/jobs.ts#L11)) — internal side is type-ready. |
| FE `input_schema` access | FE `Skill.input_schema: Record<string,unknown> | null` ([skills/types.ts:50](../../../velara-web/src/features/skills/types.ts#L50)); skill-first has full `skill` via `useSkill` — context-first may need a `useSkill` fetch (AttachedSkill). |

### The three-edit client wiring (VERIFIED — don't miss one)

Unlike the internal side, the client path has NO `inputs` plumbing. All three must change or inputs silently vanish:
1. `InvokePayload` ([useClientCreateInvocation.ts:5-11](../../../velara-web/src/features/client-portal/hooks/useClientCreateInvocation.ts#L5)) — add `inputs?: Record<string, unknown>`.
2. `mutationFn` destructure + `createClientInvocation(...)` call — thread `inputs`.
3. `createClientInvocation` payload param + POST body ([clientPortal.ts:139-156](../../../velara-web/src/api/clientPortal.ts#L139)) — add `inputs?`.
The backend client endpoint already accepts it (same `InvocationRequest`, same `queue_invocation`) — no backend invocation change needed, only the `ClientSkillRead.run_fields` projection (Task 5).

### `extra="forbid"` — send only allowed fields

`InvocationRequest` sets `model_config = ConfigDict(extra="forbid")` ([schemas/invocation.py:55](../../../velara-api/app/schemas/invocation.py#L55)) — an unknown field 422s (locked by a spec test). The FE must send only `{file_ref_ids?, inputs?, location_id?, study_id?, project_id?, client_id?, fan_out?}`. `inputs` is a nested dict, so schema field keys live INSIDE `inputs` — they are never top-level request fields and never trip `extra="forbid"`. Do not flatten input keys onto the request.

### Testing standards

- **Frontend:** Vitest + Testing Library, jsdom, co-located `*.test.tsx`. `RunConsole.test.tsx` mocks every hook at top + `defaultMocks()` per test, asserts payloads via module-level `mutateMock` ([RunConsole.test.tsx:11-225](../../../velara-web/src/features/run/components/RunConsole.test.tsx#L11)); `ClientRun.test.tsx` inlines static mock returns ([ClientRun.test.tsx:7-55](../../../velara-web/src/features/client-portal/components/ClientRun.test.tsx#L7)). Update the null-`input_schema` fixtures to add schema-bearing variants. Pure-function tests (`inputsSchema.test.ts`) need no DOM.
- **Backend:** the `run_fields` derivation is a pure function — unit-test it directly + one integration assertion that the client response never contains `input_schema` (IP regression). Reuse the client test fixtures.
- Call out in Completion Notes any schema kind deliberately skipped (nested/array/oneOf) so it's a documented gap, not a silent one.

### UI conventions (house rules)

- **No emoji/unicode icons** — use `<Icon name="..."/>` if any icon is needed; the form itself is text inputs so likely none. [Source: project memory — No Emoji Icons]
- **Tailwind-v4 tokens only** — reuse `inputCls`/`labelCls`/`errorCls` exactly (via the shared `Field`); do not invent field styling.
- **Reuse, don't rebuild** — one `SchemaInputsForm`, rendered on internal (from `input_schema`) and client (from `run_fields`) surfaces; one shared `Field`.

### Project Structure Notes

- **Frontend (velara-web):** NEW `src/features/run/inputsSchema.ts` (parser + validator), NEW `src/features/run/components/SchemaInputsForm.tsx`, NEW `src/shared/components/Field.tsx` (extracted from `SkillForm`); MODIFY `src/features/skills/components/SkillForm.tsx` (import shared `Field`), `src/features/run/components/RunConsole.tsx` (both `buildRunPayload` + render + state), `src/features/client-portal/components/ClientRun.tsx`, `src/features/client-portal/types.ts` (`runFields`), `src/features/client-portal/hooks/useClientSkills.ts` (map `run_fields`), `src/features/client-portal/hooks/useClientCreateInvocation.ts` (`inputs`), `src/api/clientPortal.ts` (`inputs` in `createClientInvocation`); tests.
- **Backend (velara-api):** MODIFY `app/schemas/client.py` (`ClientSkillRead.run_fields` + `ClientRunField` model), NEW small `client_run_fields(input_schema)` helper (pure), `docs/api-spec.json` (regenerated); tests. **No migration** (derivation is computed from the existing `input_schema` column).
- **Two nested repos:** `velara-api` and `velara-web` are **separate git repos** under top-level `velara`. Both clean at story creation (`velara-api` `6038613`, `velara-web` `70de32d`). Commit as **two commits** per repo, `feat(<area>): Story 11.8 — <title> (Epic 11)`. Never `git add` the top-level docs repo from inside a nested repo. [Source: project memory — velara-web is a separate nested git repo]

### Sequencing / dependencies

- **Runs BEFORE 11.1** (see header note). Independent of the ZIP-bundle work; touches the run/invocation path + client schema, not skill registration/storage.
- **Unblocks:** the first `code` skill (Protocol Visit Budget Calculator) and any parameterized `prompt`/`hybrid`/`code-driven` skill; the `velara-protocol-extractor`'s named parameters (`model`, `consensus_runs`, `enrich`, ...) become UI-settable once its `input_schema` declares them.
- **Adjacent, non-conflicting:** the duplicate-run pre-flight (Story 12.4) consumes `buildRunPayload()` — adding `inputs` there correctly makes params part of duplicate identity (same doc + different params ≠ duplicate). Verify no debounce loop.

### References

- [Source: velara-api app/schemas/invocation.py:19-63] — `InvocationRequest` (`inputs: dict | None`, `extra="forbid"`, full field list; no `version` field).
- [Source: velara-api app/api/v1/invocations.py:261-266] — `inputs_payload` build → `job.inputs["inputs"]`; the empty-both → `None` edge (`:262`).
- [Source: velara-api app/api/v1/client.py:182-212] — client invoke uses the SAME `InvocationRequest` + `queue_invocation`; `inputs` reaches the job identically.
- [Source: velara-api app/schemas/client.py:34-48] — `ClientSkillRead` (omits `input_schema`, C5) — add `run_fields` here; [app/schemas/skill.py:235] — `SkillRead.input_schema` (internal surface returns it).
- [Source: velara-api — no jsonschema dependency] — backend does NO input validation against `input_schema` (D2 rationale).
- [Source: velara-web src/api/jobs.ts:9-17] — `InvocationPayload.inputs` (exists, unused).
- [Source: velara-web src/features/run/components/RunConsole.tsx:486-503,736-751,644,593,855] — both `buildRunPayload()`, skill-first `useSkill`, DocumentUploadCard render points.
- [Source: velara-web src/features/skills/components/SkillForm.tsx:8-29,92-153,252] — `Field`/`inputCls` (local, extract), `FormErrors`/`mergedErrors` error pattern.
- [Source: velara-web src/shared/components/Toggle.tsx] — the only shared form primitive.
- [Source: velara-web src/features/skills/types.ts:50] — FE `Skill.input_schema` type.
- [Source: velara-web src/features/client-portal/{types.ts:18-24,hooks/useClientCreateInvocation.ts:5-23,components/ClientRun.tsx:59-80,124}] + [src/api/clientPortal.ts:139-156] — client `ClientSkill` (no schema), `InvokePayload` (no inputs), `ClientRun` payload build, `createClientInvocation` — the three-edit wiring.
- [Source: velara-web src/features/run/components/RunConsole.test.tsx:11-225 + client-portal/components/ClientRun.test.tsx:7-55] — test setup patterns; null-`input_schema` fixtures to extend.
- [Source: project memory — No Emoji Icons; velara-web is a separate nested git repo].

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
