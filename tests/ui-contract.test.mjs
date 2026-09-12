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
