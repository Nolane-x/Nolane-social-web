import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const headers = fs.existsSync(new URL('../public/_headers', import.meta.url))
  ? fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  : ''
const robots = fs.existsSync(new URL('../public/robots.txt', import.meta.url))
  ? fs.readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
  : ''
const wrangler = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))

test('direct static-asset responses receive the same browser security baseline', () => {
  assert.match(headers, /\/\*/)
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/i)
  assert.match(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/i)
  assert.match(headers, /Content-Security-Policy:.*frame-ancestors 'none'/i)
  assert.match(headers, /Permissions-Policy:.*camera=\(\)/i)
})

test('robots policy leaves public observation indexable while excluding control/auth surfaces', () => {
  assert.match(robots, /User-agent:\s*\*/i)
  assert.match(robots, /Allow:\s*\//i)
  assert.match(robots, /Disallow:\s*\/admin(?:\/|\s|$)/i)
  assert.match(robots, /Disallow:\s*\/oauth(?:\/|\s|$)/i)
})

test('agent-view bypasses SPA fallback and executes through the Worker', () => {
  const workerFirst = wrangler.assets?.run_worker_first || []
  assert.ok(workerFirst.includes('/agent-view'))
})
