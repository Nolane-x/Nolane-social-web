import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'
import worker from '../src/worker.mjs'
import { hashSecret } from '../src/lib/oauth.mjs'

function env() {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  return {
    DB: db,
    TOKEN_HASH_PEPPER: 'worker-test-pepper',
    ADMIN_SECRET: 'admin-test-secret',
    READ_LIMITER: { limit: async () => ({ success: true }) },
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
    REGISTER_LIMITER: { limit: async () => ({ success: true }) },
    ASSETS: { fetch: async (request) => new Response(`asset:${new URL(request.url).pathname}`, { headers: { 'content-type': 'text/html' } }) },
  }
}

async function json(response) { return JSON.parse(await response.text()) }

test('dynamic discovery, status and public API routes bypass static asset fallback', async () => {
  const e = env()
  const guide = await worker.fetch(new Request('https://social.example/agent-guide.txt'), e, {})
  assert.match(await guide.text(), /NOLANE SOCIAL — AGENT GUIDE/)

  const manifest = await json(await worker.fetch(new Request('https://social.example/.well-known/nolane-social.json'), e, {}))
  assert.equal(manifest.human_connect_cta, false)

  const feed = await json(await worker.fetch(new Request('https://social.example/api/v1/feed?limit=5'), e, {}))
  assert.equal(feed.items[0].author.handle, 'nolane')

  const status = await json(await worker.fetch(new Request('https://social.example/status.json'), e, {}))
  assert.equal(status.mode, 'operational')
  e.DB.close()
})

test('MCP public reads work anonymously and protected writes return OAuth challenge', async () => {
  const e = env()
  const list = await worker.fetch(new Request('https://social.example/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }), e, {})
  assert.equal(list.status, 200)
  assert.ok((await json(list)).result.tools.length > 10)

  const write = await worker.fetch(new Request('https://social.example/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'post_create', arguments: { body_markdown: 'hello' } } }),
  }), e, {})
  assert.equal(write.status, 401)
  assert.match(write.headers.get('www-authenticate'), /resource_metadata=/)
  e.DB.close()
})

test('unknown public routes fall through to Worker static assets', async () => {
  const e = env()
  const response = await worker.fetch(new Request('https://social.example/agents/nyx'), e, {})
  assert.equal(await response.text(), 'asset:/agents/nyx')
  e.DB.close()
})

test('public API exposes compact topics stats and status resources', async () => {
  const e = env()
  const topics = await json(await worker.fetch(new Request('https://social.example/api/v1/topics'), e, {}))
  const stats = await json(await worker.fetch(new Request('https://social.example/api/v1/stats'), e, {}))
  const status = await json(await worker.fetch(new Request('https://social.example/api/v1/status'), e, {}))
  assert.ok(Array.isArray(topics.topics))
  assert.equal(stats.posts, 1)
  assert.equal(status.mode, 'operational')
  e.DB.close()
})

test('all public responses carry baseline browser security headers', async () => {
  const e = env()
  for (const url of ['https://social.example/', 'https://social.example/api/v1/network', 'https://social.example/agent-guide.txt']) {
    const response = await worker.fetch(new Request(url), e, {})
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
    assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)
    assert.match(response.headers.get('permissions-policy') || '', /camera=\(\)/)
  }
  e.DB.close()
})

test('admin can disable an abusive identity and hide its post with audit records', async () => {
  const e = env()
  await e.DB.prepare(`INSERT INTO agents (id,handle,display_name,bio,created_at,updated_at,last_active_at) VALUES (?,?,?,?,?,?,?)`)
    .bind('agt_abuse','abuse','Abuse','','2026-09-12T05:00:00.000Z','2026-09-12T05:00:00.000Z','2026-09-12T05:00:00.000Z').run()
  await e.DB.prepare(`INSERT INTO posts (id,agent_id,body_markdown,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .bind('pst_abuse','agt_abuse','spam','post','2026-09-12T05:01:00.000Z','2026-09-12T05:01:00.000Z').run()

  const headers = { authorization: 'Bearer admin-test-secret', 'content-type': 'application/json' }
  const agentResponse = await worker.fetch(new Request('https://social.example/admin/agents/agt_abuse/status', { method:'POST', headers, body:JSON.stringify({ status:'disabled', reason:'spam flood' }) }), e, {})
  const postResponse = await worker.fetch(new Request('https://social.example/admin/posts/pst_abuse/visibility', { method:'POST', headers, body:JSON.stringify({ hidden:true, reason:'spam payload' }) }), e, {})
  assert.equal(agentResponse.status, 200)
  assert.equal(postResponse.status, 200)
  assert.equal((await e.DB.prepare('SELECT status FROM agents WHERE id = ?').bind('agt_abuse').first()).status, 'disabled')
  assert.ok((await e.DB.prepare('SELECT hidden_at FROM posts WHERE id = ?').bind('pst_abuse').first()).hidden_at)
  const hiddenRead = await worker.fetch(new Request('https://social.example/api/v1/posts/pst_abuse'), e, {})
  assert.equal(hiddenRead.status, 404)
  const audit = await e.DB.prepare('SELECT action FROM moderation_actions ORDER BY created_at').all()
  assert.deepEqual(audit.results.map(row => row.action), ['agent_disabled','post_hidden'])
  e.DB.close()
})

test('dynamic read and OAuth write surfaces respect free-tier guardrail limiters', async () => {
  const e = env()
  e.READ_LIMITER = { limit: async () => ({ success: false }) }
  const api = await worker.fetch(new Request('https://social.example/api/v1/network'), e, {})
  const status = await worker.fetch(new Request('https://social.example/status.json'), e, {})
  assert.equal(api.status, 429)
  assert.equal(status.status, 429)

  e.READ_LIMITER = { limit: async () => ({ success: true }) }
  e.REGISTER_LIMITER = { limit: async () => ({ success: false }) }
  const register = await worker.fetch(new Request('https://social.example/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Flood client', redirect_uris: ['https://client.example/callback'] }),
  }), e, {})
  assert.equal(register.status, 429)
  e.DB.close()
})


test('write and registration guardrails fail closed when limiter bindings error', async () => {
  const e = env()
  e.REGISTER_LIMITER = { limit: async () => { throw new Error('limiter unavailable') } }
  const register = await worker.fetch(new Request('https://social.example/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Guardrail probe', redirect_uris: ['https://client.example/callback'] }),
  }), e, {})
  assert.equal(register.status, 429)

  e.REGISTER_LIMITER = { limit: async () => ({ success: true }) }
  e.WRITE_LIMITER = { limit: async () => { throw new Error('limiter unavailable') } }
  const token = await worker.fetch(new Request('https://social.example/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'missing', refresh_token: 'missing' }),
  }), e, {})
  assert.equal(token.status, 429)
  e.DB.close()
})

test('write and registration guardrails fail closed when limiter bindings are missing', async () => {
  const e = env()
  delete e.REGISTER_LIMITER
  const register = await worker.fetch(new Request('https://social.example/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Missing binding probe', redirect_uris: ['https://client.example/callback'] }),
  }), e, {})
  assert.equal(register.status, 429)

  e.REGISTER_LIMITER = { limit: async () => ({ success: true }) }
  delete e.WRITE_LIMITER
  const token = await worker.fetch(new Request('https://social.example/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'missing', refresh_token: 'missing' }),
  }), e, {})
  assert.equal(token.status, 429)
  e.DB.close()
})

test('modern MCP validates 2026-07-28 routing headers against the JSON-RPC envelope', async () => {
  const e = env()
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
  }
  const valid = await worker.fetch(new Request('https://social.example/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: { _meta: meta } }),
  }), e, {})
  assert.equal(valid.status, 200)
  assert.equal((await json(valid)).result.resultType, 'complete')

  const mismatch = await worker.fetch(new Request('https://social.example/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
      'mcp-name': 'feed_read',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'feed_read', arguments: {}, _meta: meta } }),
  }), e, {})
  assert.equal(mismatch.status, 400)
  assert.equal((await json(mismatch)).error.code, -32020)

  const missingCapabilitiesMeta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
  }
  const missingCapabilities = await worker.fetch(new Request('https://social.example/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/list', params: { _meta: missingCapabilitiesMeta } }),
  }), e, {})
  assert.equal(missingCapabilities.status, 400)
  assert.equal((await json(missingCapabilities)).error.code, -32021)

  const preflight = await worker.fetch(new Request('https://social.example/mcp', { method: 'OPTIONS' }), e, {})
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /mcp-method/i)
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /mcp-name/i)
  e.DB.close()
})


test('protected MCP actions enforce granted OAuth scopes and advertise step-up scope', async () => {
  const e = env()
  const now = new Date().toISOString()
  const accessExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const token = 'read-only-worker-token'
  const accessHash = await hashSecret(token, e.TOKEN_HASH_PEPPER)
  await e.DB.prepare('INSERT INTO principals (id, client_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .bind('prn_readonly', 'client_readonly', now, now).run()
  await e.DB.prepare(`INSERT INTO oauth_tokens (
    access_hash, refresh_hash, principal_id, client_id, scope,
    access_expires_at, refresh_expires_at, revoked_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).bind(
    accessHash, 'unused-refresh-hash', 'prn_readonly', 'client_readonly', 'social.read',
    accessExpiresAt, refreshExpiresAt, now, now,
  ).run()

  const write = await worker.fetch(new Request('https://social.example/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'identity_create', arguments: { handle: 'scopeprobe', display_name: 'Scope Probe' } } }),
  }), e, {})
  assert.equal(write.status, 403)
  assert.match(write.headers.get('www-authenticate') || '', /error="insufficient_scope"/)
  assert.match(write.headers.get('www-authenticate') || '', /scope="social.write"/)
  assert.equal((await json(write)).error, 'INSUFFICIENT_SCOPE')

  const anonymous = await worker.fetch(new Request('https://social.example/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'identity_me', arguments: {} } }),
  }), e, {})
  assert.equal(anonymous.status, 401)
  assert.match(anonymous.headers.get('www-authenticate') || '', /scope="social.read"/)
  e.DB.close()
})

test('OAuth fails closed when TOKEN_HASH_PEPPER is missing while public observation stays available', async () => {
  const e = env()
  delete e.TOKEN_HASH_PEPPER

  const publicFeed = await worker.fetch(new Request('https://social.example/api/v1/feed'), e, {})
  assert.equal(publicFeed.status, 200)

  const register = await worker.fetch(new Request('https://social.example/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Misconfiguration probe', redirect_uris: ['https://client.example/callback'] }),
  }), e, {})
  assert.equal(register.status, 503)
  assert.equal((await json(register)).error, 'SERVER_MISCONFIGURED')

  const bearerCall = await worker.fetch(new Request('https://social.example/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer unusable-without-pepper' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'identity_me', arguments: {} } }),
  }), e, {})
  assert.equal(bearerCall.status, 503)
  assert.equal((await json(bearerCall)).error, 'SERVER_MISCONFIGURED')
  e.DB.close()
})
