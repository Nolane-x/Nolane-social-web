import test from 'node:test'
import assert from 'node:assert/strict'
import { runProductionWatchdog } from '../tools/production-watchdog.mjs'

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function fakeFetch() {
  return async (url, init = {}) => {
    const path = new URL(url).pathname
    if (path === '/health') return new Response('ok\n')
    if (path === '/') return new Response('<html><meta name="nolane-agent-view" content="/agent-view"><a href="/sitemap.xml">map</a></html>', { headers: { 'content-type': 'text/html' } })
    if (path === '/robots.txt') return new Response('User-agent: OAI-SearchBot\nAllow: /\nSitemap: https://social.example/sitemap.xml\n')
    if (path === '/sitemap.xml') return new Response('<?xml version="1.0"?><urlset><url><loc>https://social.example/agent-view</loc></url></urlset>', { headers: { 'content-type': 'application/xml' } })
    if (path === '/feed.xml') return new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Nolane Social</title></feed>', { headers: { 'content-type': 'application/atom+xml' } })
    if (path === '/agent-view') return new Response('<html><h1>Nolane Social</h1><p>JavaScript is not required.</p></html>', { headers: { 'content-type': 'text/html' } })
    if (path === '/publication-policy.json') return json({ publication_allowed: true, private_or_internal_material_allowed: false })
    if (path === '/.well-known/nolane-social.json') return json({ version: '0.2.0', mcp: 'https://social.example/mcp', sitemap: 'https://social.example/sitemap.xml' })
    if (path === '/.well-known/oauth-protected-resource') return json({ resource: 'https://social.example/mcp' })
    if (path === '/api/v1/status') return json({ mode: 'operational' })
    if (path === '/mcp' && init.method === 'POST') {
      const rpc = JSON.parse(init.body)
      if (rpc.method === 'server/discover') return json({ jsonrpc: '2.0', id: rpc.id, result: { resultType: 'complete', supportedVersions: ['2026-07-28'] } })
      if (rpc.method === 'tools/list') return json({ jsonrpc: '2.0', id: rpc.id, result: { resultType: 'complete', tools: Array.from({ length: 15 }, (_, i) => ({ name: `tool_${i}` })) } })
    }
    return new Response('missing', { status: 404 })
  }
}

test('production watchdog verifies crawler, OAuth, public API and modern MCP surfaces read-only', async () => {
  const result = await runProductionWatchdog({ origin: 'https://social.example', fetchImpl: fakeFetch() })
  assert.equal(result.ok, true)
  assert.equal(result.toolCount, 15)
  assert.equal(result.checks.length >= 10, true)
  assert.equal(result.checks.every((item) => item.ok), true)
})

test('production watchdog fails with the exact broken surface', async () => {
  const good = fakeFetch()
  const fetchImpl = async (url, init) => new URL(url).pathname === '/health'
    ? new Response('down', { status: 503 })
    : good(url, init)
  await assert.rejects(
    () => runProductionWatchdog({ origin: 'https://social.example', fetchImpl }),
    /health/i,
  )
})
