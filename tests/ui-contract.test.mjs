import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8')

test('public shell has explicit skip navigation and a bounded route announcement region', () => {
  assert.match(index, /class="skip-link"[^>]*href="#main-content"/)
  assert.doesNotMatch(index, /id="app"[^>]*aria-live=/)
  assert.match(index, /id="route-status"[^>]*aria-live="polite"/)
})

test('feed switcher uses button-state semantics instead of incomplete ARIA tabs', () => {
  assert.doesNotMatch(app, /role="tablist"/)
  assert.doesNotMatch(app, /role="tab"/)
  assert.match(app, /aria-pressed="\$\{mode === 'latest'\}"/)
  assert.match(app, /aria-pressed="\$\{mode === 'conversations'\}"/)
})

test('SPA navigation restores keyboard orientation after route replacement', () => {
  assert.match(app, /function focusMainContent\(/)
  assert.match(app, /await renderCurrent\(\)/)
  assert.match(app, /focusMainContent\(\)/)
})

test('visual system defines high-contrast survival and odd-card grid boundaries', () => {
  assert.match(css, /@media \(forced-colors: active\)/)
  assert.match(css, /\.agent-tile:nth-child\(odd\)/)
  assert.match(css, /\.skip-link/)
  assert.match(css, /\.sr-only/)
})

test('explore uses a full-width agent result pattern and preserves topic discovery on compact layouts', () => {
  assert.match(app, /function agentResultRow\(/)
  assert.match(app, /class="agent-result-list"/)
  assert.match(app, /class="topic-shelf"/)
  assert.match(css, /\.agent-result-list/)
  assert.match(css, /\.topic-shelf/)
})

test('public post cards surface quote/reference relationships instead of hiding reference metadata', () => {
  assert.match(app, /post\.reference_id/)
  assert.match(app, /class="reference-line"/)
  assert.match(css, /\.reference-line/)
})

test('ChatGPT web setup guide is discoverable, live-aware, and explicit about plan boundaries', () => {
  assert.match(index, /src="\/chatgpt-connect\.mjs"/)

  const guideUrl = new URL('../public/chatgpt-connect.mjs', import.meta.url)
  const guideCssUrl = new URL('../public/chatgpt-connect.css', import.meta.url)
  assert.equal(fs.existsSync(guideUrl), true)
  assert.equal(fs.existsSync(guideCssUrl), true)

  const guide = fs.readFileSync(guideUrl, 'utf8')
  const guideCss = fs.readFileSync(guideCssUrl, 'utf8')

  assert.match(guide, /\/connect\/chatgpt/)
  assert.match(guide, /\/mcp/)
  assert.match(guide, /tools\/list/)
  assert.match(guide, /Settings.*Apps.*Advanced Settings.*Developer mode/is)
  assert.match(guide, /Business.*Enterprise.*Edu/is)
  assert.match(guide, /Pro.*read\/fetch/is)
  assert.match(guide, /public/i)
  assert.match(guide, /about-panel/)
  assert.match(guide, /Use with ChatGPT/)
  assert.match(guideCss, /@media \(max-width:/)
  assert.match(guideCss, /@media \(forced-colors: active\)/)
  assert.match(guideCss, /@media \(prefers-reduced-motion: reduce\)/)
})

test('root HTML gives HTTP-only agents a useful no-JavaScript bootstrap surface', () => {
  assert.match(index, /rel="alternate"[^>]*href="\/agent-view"[^>]*type="text\/html"/i)
  assert.match(index, /<script[^>]*type="application\/ld\+json"[^>]*id="nolane-agent-bootstrap"/i)
  assert.match(index, /<noscript>[\s\S]*Nolane Social[\s\S]*\/agent-view[\s\S]*\/agent-guide\.txt[\s\S]*\/llms\.txt[\s\S]*\/mcp[\s\S]*<\/noscript>/i)
  assert.match(index, /name="nolane-agent-view" content="\/agent-view"/i)
  assert.match(index, /name="nolane-mcp" content="\/mcp"/i)
})
