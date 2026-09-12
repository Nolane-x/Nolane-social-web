# Nolane Black + Canonical Origin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic AI visual styling with Nolane Black and add a migration-safe canonical-origin boundary for a future short domain.

**Architecture:** Keep the existing app and API intact. Add one final CSS layer that neutralizes legacy decorative styling, one Worker entry adapter that rewrites protocol request origin only when `PUBLIC_ORIGIN` is valid/configured, and tests that lock both contracts. Do not advertise `social.nolane.ai` until Cloudflare routing is proven.

**Tech Stack:** Cloudflare Workers, Static Assets, D1, vanilla ES modules/CSS, Node test runner, TypeScript checkJS.

**Spec:** `docs/superpowers/specs/2026-09-12-nolane-black-origin-design.md`

## Global Constraints

- Canvas `#000000`, primary text `#ffffff`.
- No purple/cyan glow, gradient identity material, fake pulse visualization, or decorative pill saturation in rendered product chrome.
- Semantic green/amber/red only for real status; no glow.
- Preserve current MCP/OAuth/API behavior when `PUBLIC_ORIGIN` is unset.
- `PUBLIC_ORIGIN` must be HTTPS and must never silently point clients at an unprovisioned domain.
- Do not rename Worker service or account-wide workers.dev subdomain.
- Keep all existing accessibility contracts.

---

### Task 1: Lock Nolane Black visual contract

**Files:**
- Create: `tests/nolane-black.test.mjs`
- Create: `public/nolane-black.css`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: existing `styles.css`, `chatgpt-connect.css`, `app.mjs` class names.
- Produces: final cascade layer `/nolane-black.css` loaded after all existing styles.

- [ ] **Step 1: Write the failing test**

Assert that `index.html` links `/nolane-black.css` after legacy CSS and that the new stylesheet contains true-black/white root tokens plus explicit neutralization selectors for brand SVG, tabs, avatars, system posts, links, search focus, rail cards, pulse waveform, ChatGPT hero/orbit/plan chips, reduced motion, and forced colors. Assert the override itself contains no `linear-gradient`, `radial-gradient`, purple/cyan legacy hex values, or glow box shadows.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- tests/nolane-black.test.mjs`
Expected: FAIL because `/nolane-black.css` is not linked and does not exist.

- [ ] **Step 3: Implement minimal visual layer**

Create the final cascade layer using neutral surfaces and white structural emphasis. Hide `.pulse-wave` entirely; preserve numeric network stats. Neutralize avatar tones to deterministic grayscale through existing tone classes instead of adding new data/model dependencies. Remove ChatGPT orbit decoration from layout.

- [ ] **Step 4: Verify GREEN**

Run: `npm run check`
Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit**

Commit message: `feat: apply Nolane Black visual system`

### Task 2: Add canonical-origin adapter without changing current production origin

**Files:**
- Create: `src/entry.mjs`
- Create: `tests/public-origin.test.mjs`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: default Worker export from `src/worker.mjs`.
- Produces: `normalizePublicOrigin(value): string` and Worker `fetch()` wrapper.

- [ ] **Step 1: Write the failing test**

Test exported origin normalization and request rewriting behavior: empty/invalid/http values fall back to incoming request origin; valid HTTPS origin strips trailing slash; protocol paths use canonical origin; static paths retain incoming origin.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- tests/public-origin.test.mjs`
Expected: FAIL because `src/entry.mjs` does not exist.

- [ ] **Step 3: Implement minimal adapter**

`entry.mjs` imports the existing worker. For machine/auth protocol paths, clone the request onto canonical origin before dispatch. For static UI paths, use the original request. If `/oauth/authorize` returns HTML, inject `<link rel="stylesheet" href="/nolane-black.css">` before `</head>` so OAuth visually matches without rewriting OAuth internals.

Update `wrangler.jsonc` main to `./src/entry.mjs` and add `PUBLIC_ORIGIN` as an empty string. Empty means current request origin remains canonical.

- [ ] **Step 4: Verify GREEN**

Run: `npm run check`
Expected: all tests and typecheck pass; existing OAuth/MCP tests remain unchanged.

- [ ] **Step 5: Commit**

Commit message: `feat: add migration-safe public origin boundary`

### Task 3: Finish metadata and monochrome identity

**Files:**
- Modify: `public/index.html`
- Modify: `public/favicon.svg`
- Modify: `public/manifest.webmanifest`
- Extend: `tests/nolane-black.test.mjs`

**Interfaces:**
- Consumes: current product metadata.
- Produces: monochrome favicon/theme and canonical metadata placeholder that uses the current document origin rather than an unprovisioned hard-coded domain.

- [ ] **Step 1: Extend failing test**

Require black theme color, monochrome favicon source, and neutral manifest colors.

- [ ] **Step 2: Verify RED**

Run targeted test and confirm old colored theme/favicons fail it.

- [ ] **Step 3: Implement metadata cleanup**

Use true black theme/background and white monochrome mark. Do not hard-code `social.nolane.ai` into browser metadata until routing exists.

- [ ] **Step 4: Run full verification**

Run: `npm run check`
Expected: all tests/typecheck green.

- [ ] **Step 5: Commit**

Commit message: `chore: align product metadata with Nolane Black`

### Task 4: Integration and production delivery

**Files:** no new product files unless verification exposes a defect.

- [ ] **Step 1: Open fork PR**

Target `Nolane-x/main`; require CI green.

- [ ] **Step 2: Merge fork PR only after CI green**

Record merge SHA.

- [ ] **Step 3: Open upstream PR**

`Nolane-x/main -> NolaneAI/main`; verify diff contains only this work.

- [ ] **Step 4: Merge upstream after production CI green**

Use expected head SHA to prevent race.

- [ ] **Step 5: Verify Cloudflare deployment**

Confirm new CSS/entry/metadata assets uploaded, D1 unchanged, remote Worker secrets preserved, and a new Worker version ID emitted.

- [ ] **Step 6: Domain follow-through**

Do not set `PUBLIC_ORIGIN` to `https://social.nolane.ai` until domain ownership/Cloudflare zone routing is proven. If the domain is not owned, keep current origin and document the short-domain target rather than emitting broken OAuth metadata.
