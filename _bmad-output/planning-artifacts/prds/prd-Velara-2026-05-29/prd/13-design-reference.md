# 13. Design Reference

A working UI prototype exists in [`design/`](../../../../design/) at the project root. It is the canonical visual reference for all web interface requirements in this PRD.

| File | Contents |
|------|----------|
| [`design/Velara v3.html`](../../../../design/Velara%20v3.html) | Entry point — open in a browser to run the prototype |
| [`design/app_v3.jsx`](../../../../design/app_v3.jsx) | Root app, routing, role switcher (Internal ⇄ Client) |
| [`design/overrides.jsx`](../../../../design/overrides.jsx) | Run UX, entity detail, client portal (latest overrides) |
| [`design/hierarchy.jsx`](../../../../design/hierarchy.jsx) | Engagements tree — Client → Project → Study → Location |
| [`design/client.jsx`](../../../../design/client.jsx) | Client portal views |
| [`design/data.js`](../../../../design/data.js) | Sample data — hierarchy, skills, invocations, audit log |
| [`design/styles_v3.css`](../../../../design/styles_v3.css) | Design tokens, typography, color system (V3 Vitalief brand) |

**How to use this reference during development:**
- Open `Velara v3.html` in a browser to interact with the full prototype before building any screen
- The prototype has two modes switchable via the role bar: **Vitalief team** (internal) and **Client portal**
- `data.js` documents the expected data shape for every entity — use it as a guide for API contracts and seed data
- The prototype is browser-runnable as-is (no build step) — treat it as a living spec, not production code

*See `addendum.md` for technical architecture decisions, IP protection patterns, and options-considered documentation.*
