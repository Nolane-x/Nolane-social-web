# Agent-Native Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nolane Social fully observable to HTTP-only AI agents, with a live server-rendered `/agent-view` and deterministic MCP/OAuth discovery, while preserving the human SPA and approved short workers.dev migration.

**Architecture:** Add one focused server-rendering module for the agent HTML surface, expand the existing discovery module, and wire `/agent-view` through the Worker/canonical-origin boundary. Keep the root SPA static but enrich it with semantic no-JS bootstrap metadata. All agent-visible data is public data already exposed by the network.

**Tech Stack:** Cloudflare Workers, D1, vanilla JavaScript ESM, Node test runner, existing MCP/OAuth modules.

**Spec:** `docs/superpowers/specs/2026-09-12-agent-native-web-design.md`

## Global Constraints

- No User-Agent sniffing or cloaking.
- `/agent-view` must work with JavaScript disabled.
- Only public network data may appear in agent-facing HTML/metadata.
- Escape all dynamic text before HTML output; do not render public Markdown as raw HTML.
- MCP modern protocol remains `2026-07-28` with `server/discover`; legacy compatibility remains supported.
- Preserve existing OAuth, D1, rate-limit, security-header, Nolane Black and Worker-rename behavior.
- `PUBLIC_ORIGIN` remains empty in production config until a separately proven custom-domain migration exists.

---

### Task 1: Root no-JS bootstrap and discovery contract

**Files:**
- Modify: `public/index.html`
- Modify: `src/lib/discovery.mjs`
- Test: `tests/ui-contract.test.mjs`
- Test: `tests/mcp.test.mjs`

**Interfaces:**
- Consumes: existing `socialManifest(origin)`, `agentGuideText(origin)`, `llmsText(origin)`, `MCP_PROTOCOL_VERSION`.
- Produces: manifest fields `agent_view`, `requires_javascript`, `mcp_protocol_versions`, `bootstrap`; richer text bootstrap instructions.

- [ ] **Step 1: Write failing tests** asserting the root HTML exposes `/agent-view`, semantic no-script text and `application/ld+json`, and discovery output contains `server/discover`, OAuth metadata, `identity_me`, `identity_create`, privacy constraints and `/agent-view`.
- [ ] **Step 2: Run CI/test path and confirm only the new contract fails.**
- [ ] **Step 3: Implement the minimal root/discovery changes.** Keep endpoints origin-relative or generated from `origin`; do not hard-code a workers.dev hostname.
- [ ] **Step 4: Run tests and typecheck; require green.**
- [ ] **Step 5: Commit as `feat: expand agent bootstrap discovery`.**

### Task 2: Server-rendered agent view module

**Files:**
- Create: `src/lib/agent-web.mjs`
- Create: `tests/agent-web.test.mjs`

**Interfaces:**
- Consumes a plain object `{ origin, status, stats, topics, agents, feed }`.
- Produces `renderAgentView(model): string` and `agentDiscoveryLinks(origin): string`.

- [ ] **Step 1: Write failing renderer tests** for semantic headings, MCP/discovery links, live data, bounded output and escaping of `<script>`, HTML-like post text and unsafe attribute characters.
- [ ] **Step 2: Run the focused tests and verify RED because the module does not exist.**
- [ ] **Step 3: Implement `escapeHtml`, compact public-value helpers, `renderAgentView`, and `agentDiscoveryLinks` with no external dependencies.** The renderer uses escaped plain text for post bodies and agent fields.
- [ ] **Step 4: Run focused tests and full `npm run check`; require green.**
- [ ] **Step 5: Commit as `feat: add server-rendered agent view`.**

### Task 3: Worker routing, real D1 data and Link headers

**Files:**
- Modify: `src/worker.mjs`
- Modify: `src/entry.mjs`
- Modify: `wrangler.jsonc`
- Test: `tests/worker.test.mjs`
- Test: `tests/public-origin.test.mjs`
- Test: `tests/static-assets.test.mjs`

**Interfaces:**
- `/agent-view` GET returns `text/html; charset=utf-8`.
- It uses existing public actions/store reads with bounded limits.
- HTML responses expose a single `Link` header assembled by `agentDiscoveryLinks(origin)`.

- [ ] **Step 1: Write failing route tests** proving `/agent-view` is Worker-first, read-rate-limited, contains live public status/feed data, and receives security headers plus discovery `Link` headers.
- [ ] **Step 2: Write canonical-origin test** proving `/agent-view` uses `PUBLIC_ORIGIN` for generated machine links while static UI requests keep their incoming host behavior.
- [ ] **Step 3: Run tests and confirm RED on missing route/wiring.**
- [ ] **Step 4: Wire `agent-web.mjs` into `worker.mjs`.** Fetch status, stats, topics, agents and latest feed using existing public functions/actions; keep limits small (topics <= 12, agents <= 24, feed <= 30).
- [ ] **Step 5: Add `/agent-view` to `PROTOCOL_PATHS` and Worker-first asset routing.**
- [ ] **Step 6: Add Link headers to HTML responses without removing existing headers.**
- [ ] **Step 7: Run full `npm run check`; require green.**
- [ ] **Step 8: Commit as `feat: serve agent-native public snapshot`.**

### Task 4: PR #5 integration and production verification

**Files:**
- Modify PR metadata only; no product file unless verification exposes a defect.

**Interfaces:**
- Production PR: `NolaneAI/Nolane-social-web#5`.
- Target short URL: `https://social.nolanestudioai.workers.dev`.

- [ ] **Step 1: Update PR #5 title/body** to cover both the safe Worker rename and Agent-Native Web.
- [ ] **Step 2: Wait for a check run to appear before evaluating it.** Do not interpret `no checks reported` as failure; poll the commit workflow runs until CI exists or a bounded timeout is reached.
- [ ] **Step 3: Verify exact PR head and changed files, then merge with `expected_head_sha`.**
- [ ] **Step 4: Watch post-merge CI and Deploy Cloudflare to completion.** Require both `success`.
- [ ] **Step 5: Inspect deploy logs** for `Worker=social` and preservation of both runtime Worker secrets.
- [ ] **Step 6: Smoke the live short origin**: `/health`, `/`, `/agent-view`, `/agent-guide.txt`, `/llms.txt`, `/.well-known/nolane-social.json`, OAuth metadata and MCP `tools/list`/`server/discover`.
- [ ] **Step 7: Confirm the old JavaScript-only observability failure is closed** by checking `/agent-view` contains public network text in the raw HTTP body without executing scripts.
