import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const moduleUrl = new URL('../src/entry.mjs', import.meta.url)
const loaded = await import(moduleUrl).catch(() => null)

const wrangler = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))

test('public origin adapter exists and leaves production origin unchanged by default', () => {
  assert.ok(loaded, 'src/entry.mjs should exist')
  assert.equal(wrangler.main, './src/entry.mjs')
  assert.equal(wrangler.vars?.PUBLIC_ORIGIN, '')
})

test('normalizePublicOrigin accepts only clean HTTPS origins', () => {
  assert.ok(loaded)
  const fallback = 'https://old.example.workers.dev'
  assert.equal(loaded.normalizePublicOrigin('', fallback), fallback)
  assert.equal(loaded.normalizePublicOrigin('http://social.example.com', fallback), fallback)
  assert.equal(loaded.normalizePublicOrigin('https://user:pass@social.example.com', fallback), fallback)
  assert.equal(loaded.normalizePublicOrigin('https://social.example.com/path', fallback), fallback)
  assert.equal(loaded.normalizePublicOrigin('https://social.example.com?x=1', fallback), fallback)
  assert.equal(loaded.normalizePublicOrigin('https://social.example.com/#x', fallback), fallback)
  assert.equal(loaded.normalizePublicOrigin('https://social.example.com/', fallback), 'https://social.example.com')
})

test('protocol requests use canonical origin while static UI requests keep incoming host', () => {
  assert.ok(loaded)
  const canonical = 'https://social.example.com'
  const protocol = new Request('https://old.example.workers.dev/mcp?x=1', { method: 'POST', body: '{}' })
  const staticPage = new Request('https://old.example.workers.dev/about')

  const rewritten = loaded.requestForWorker(protocol, canonical)
  const untouched = loaded.requestForWorker(staticPage, canonical)

  assert.equal(rewritten.url, 'https://social.example.com/mcp?x=1')
  assert.equal(rewritten.method, 'POST')
  assert.equal(untouched.url, staticPage.url)
})

test('OAuth authorization HTML receives the Nolane Black stylesheet without losing headers', async () => {
  assert.ok(loaded)
  const input = new Response('<!doctype html><html><head><title>Authorize</title></head><body>ok</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' },
  })
  const output = await loaded.decorateOAuthResponse('/oauth/authorize', input)
  const html = await output.text()
  assert.match(html, /<link rel="stylesheet" href="\/nolane-black\.css">/)
  assert.equal(output.headers.get('x-frame-options'), 'DENY')
})
