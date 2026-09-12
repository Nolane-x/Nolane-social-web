import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const index = fs.readFileSync(new URL('public/index.html', root), 'utf8')

function read(path) {
  return fs.readFileSync(new URL(path, root), 'utf8')
}

test('Nolane Black is the final visual authority and uses true black and white', () => {
  assert.match(index, /<link rel="stylesheet" href="\/nolane-black\.css">/)
  const legacyPosition = index.indexOf('/chatgpt-connect.css')
  const blackPosition = index.indexOf('/nolane-black.css')
  assert.ok(legacyPosition >= 0 && blackPosition > legacyPosition, 'Nolane Black must load after legacy product styles')

  const css = read('public/nolane-black.css')
  assert.match(css, /--bg:\s*#000000/i)
  assert.match(css, /--text:\s*#ffffff/i)
  assert.match(css, /--accent:\s*#ffffff/i)
  assert.match(css, /\.brand-mark/)
  assert.match(css, /\.feed-tab\.active::after/)
  assert.match(css, /\.avatar\.tone-0/)
  assert.match(css, /\.system-post/)
  assert.match(css, /\.search-box:focus-within/)
  assert.match(css, /\.rail-card/)
  assert.match(css, /\.pulse-wave\s*\{[^}]*display:\s*none/is)
  assert.match(css, /\.chatgpt-hero-orbit\s*\{[^}]*display:\s*none/is)
  assert.match(css, /\.chatgpt-plan-chip/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /@media \(forced-colors: active\)/)
})

test('Nolane Black neutralizes remaining sci-fi and decorative legacy surfaces', () => {
  const css = read('public/nolane-black.css')
  assert.match(css, /\.topic-signal\s*\{[^}]*background:\s*#111111/is)
  assert.match(css, /\.rail-more\s*\{[^}]*color:\s*#ffffff/is)
  assert.match(css, /\.search-submit\s*\{[^}]*border-radius:\s*7px/is)
  assert.match(css, /\.section-label\s*\{[^}]*text-transform:\s*none/is)
  assert.match(css, /\.agent-tile\s*\{[^}]*background:\s*#050505/is)
  assert.match(css, /\.profile-sky\s*\{[^}]*background:\s*#050505/is)
  assert.match(css, /\.profile-sky::before[^}]*display:\s*none/is)
  assert.match(css, /\.profile-sky::after[^}]*display:\s*none/is)
  assert.match(css, /\.profile-meta a\s*\{[^}]*color:\s*#ffffff/is)
  assert.match(css, /\.soft-chip\s*\{[^}]*border-radius:\s*5px/is)
  assert.match(css, /\.thread-post:not\(:last-child\)::before\s*\{[^}]*background:\s*#242424/is)
  assert.match(css, /\.thread-focus\s*\{[^}]*background:\s*#050505/is)
  assert.match(css, /\.status-orb\s*\{[^}]*box-shadow:\s*none/is)
  assert.match(css, /\.status-orb::before\s*\{[^}]*box-shadow:\s*none/is)
  assert.match(css, /\.principle\s*\{[^}]*background:\s*#050505/is)
  assert.match(css, /\.skeleton::after\s*\{[^}]*display:\s*none/is)
})

test('Nolane Black override itself contains no generic AI color material', () => {
  const css = read('public/nolane-black.css').toLowerCase()
  for (const forbidden of [
    'linear-gradient',
    'radial-gradient',
    '#8065ff',
    '#49cfe0',
    '#8f78ff',
    '#957fff',
    '#7157ff',
    '#8065ff66',
  ]) {
    assert.equal(css.includes(forbidden), false, `Nolane Black must not contain ${forbidden}`)
  }
  assert.doesNotMatch(css, /box-shadow\s*:[^;]*(?:purple|violet|cyan|#(?:8065ff|49cfe0|8f78ff|957fff))/i)
})

test('product metadata is neutral rather than AI-branded', () => {
  assert.match(index, /<meta name="theme-color" content="#000000">/i)
  const manifest = JSON.parse(read('public/manifest.webmanifest'))
  assert.equal(String(manifest.theme_color).toLowerCase(), '#000000')
  assert.equal(String(manifest.background_color).toLowerCase(), '#000000')

  const favicon = read('public/favicon.svg').toLowerCase()
  for (const forbidden of ['#8065ff', '#49cfe0', '#8f78ff', 'lineargradient', 'radialgradient']) {
    assert.equal(favicon.includes(forbidden), false, `favicon must not contain ${forbidden}`)
  }
})
