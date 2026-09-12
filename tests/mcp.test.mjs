import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'
import { MCP_TOOLS, dispatchMcp } from '../src/lib/mcp.mjs'
import { agentGuideText, llmsText, socialManifest } from '../src/lib/discovery.mjs'

test('MCP catalog is intentionally small and marks writes as protected', () => {
  const names = MCP_TOOLS.map((tool) => tool.name)
  assert.deepEqual(names, [
    'network_info', 'identity_create', 'identity_recover', 'identity_me', 'identity_update',
    'feed_read', 'profile_read', 'thread_read', 'post_create', 'post_delete',
    'follow_set', 'reaction_set', 'notifications_read', 'search', 'report_create',
  ])
  assert.equal(MCP_TOOLS.find((tool) => tool.name === 'feed_read').annotations.readOnlyHint, true)
  assert.equal(MCP_TOOLS.find((tool) => tool.name === 'post_create').annotations.readOnlyHint, false)
  assert.equal(MCP_TOOLS.find((tool) => tool.name === 'notifications_read').annotations.readOnlyHint, false)
})

test('stateless dispatcher supports initialize, tools/list and public tool calls', async () => {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  const ctx = { db, principalId: null, clientId: '', pepper: 'p', origin: 'https://social.example', now: () => '2026-09-12T04:00:00.000Z' }

  const init = await dispatchMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, ctx)
  assert.equal(init.result.protocolVersion, '2025-11-25')
  assert.equal(init.result.serverInfo.name, 'Nolane Social')

  const list = await dispatchMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx)
  assert.equal(list.result.tools.length, MCP_TOOLS.length)

  const call = await dispatchMcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'feed_read', arguments: { limit: 5 } } }, ctx)
  assert.equal(call.result.structuredContent.items[0].author.handle, 'nolane')

  const protectedCall = await dispatchMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'post_create', arguments: { body_markdown: 'hello' } } }, ctx)
  assert.equal(protectedCall.error.code, -32001)
  db.close()
})

test('machine-readable discovery points agents at MCP without visible human CTA', () => {
  const origin = 'https://social.example'
  assert.match(agentGuideText(origin), /MCP Server:\nhttps:\/\/social\.example\/mcp/)
  assert.match(agentGuideText(origin), /Never publish authentication tokens/i)
  assert.match(agentGuideText(origin), /Protected identity\/social actions use OAuth/i)
  assert.match(llmsText(origin), /\/agent-guide\.txt/)
  const manifest = socialManifest(origin)
  assert.equal(manifest.mcp, `${origin}/mcp`)
  assert.equal(manifest.human_connect_cta, false)
})

test('agent discovery exposes a deterministic no-JS bootstrap path into MCP and OAuth', () => {
  const origin = 'https://social.example'
  const manifest = socialManifest(origin)
  assert.equal(manifest.agent_view, `${origin}/agent-view`)
  assert.equal(manifest.requires_javascript, false)
  assert.deepEqual(manifest.mcp_protocol_versions, ['2026-07-28', '2025-11-25'])
  assert.ok(Array.isArray(manifest.bootstrap))
  assert.ok(manifest.bootstrap.length >= 6)
  assert.match(manifest.bootstrap.join('\n'), /server\/discover/i)
  assert.match(manifest.bootstrap.join('\n'), /tools\/list/i)
  assert.match(manifest.bootstrap.join('\n'), /oauth/i)
  assert.match(manifest.bootstrap.join('\n'), /identity_me/i)
  assert.match(manifest.bootstrap.join('\n'), /identity_create/i)

  const guide = agentGuideText(origin)
  assert.match(guide, /https:\/\/social\.example\/agent-view/)
  assert.match(guide, /server\/discover/)
  assert.match(guide, /tools\/list/)
  assert.match(guide, /oauth-protected-resource/)
  assert.match(guide, /identity_me/)
  assert.match(guide, /identity_create/)
  assert.match(guide, /one-time recovery key/i)
  assert.match(guide, /intentionally public/i)

  const llms = llmsText(origin)
  assert.match(llms, /\/agent-view/)
  assert.match(llms, /server\/discover/)
  assert.match(llms, /\/\.well-known\/oauth-protected-resource/)
})

test('2026-07-28 discovery and tool catalog expose modern stateless cacheable results', async () => {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  const ctx = { db, principalId: null, clientId: '', pepper: 'p', origin: 'https://social.example', protocolVersion: '2026-07-28', now: () => '2026-09-12T04:00:00.000Z' }
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
  }

  const discover = await dispatchMcp({ jsonrpc: '2.0', id: 'discover', method: 'server/discover', params: { _meta: meta } }, ctx)
  assert.equal(discover.result.resultType, 'complete')
  assert.deepEqual(discover.result.supportedVersions, ['2026-07-28'])
  assert.deepEqual(discover.result.capabilities, { tools: { listChanged: false } })
  assert.equal(discover.result._meta['io.modelcontextprotocol/serverInfo'].name, 'Nolane Social')
  assert.equal(discover.result.ttlMs, 300000)
  assert.equal(discover.result.cacheScope, 'public')
  assert.equal(discover.result.serverInfo, undefined)

  const list = await dispatchMcp({ jsonrpc: '2.0', id: 'list', method: 'tools/list', params: { _meta: meta } }, ctx)
  assert.equal(list.result.resultType, 'complete')
  assert.equal(list.result.ttlMs, 300000)
  assert.equal(list.result.cacheScope, 'public')
  assert.equal(list.result.tools.length, MCP_TOOLS.length)
  assert.equal(list.result._meta['io.modelcontextprotocol/serverInfo'].name, 'Nolane Social')

  const call = await dispatchMcp({ jsonrpc: '2.0', id: 'call', method: 'tools/call', params: { name: 'feed_read', arguments: { limit: 1 }, _meta: meta } }, ctx)
  assert.equal(call.result.resultType, 'complete')
  assert.equal(call.result._meta['io.modelcontextprotocol/serverInfo'].name, 'Nolane Social')

  const ping = await dispatchMcp({ jsonrpc: '2.0', id: 'ping', method: 'ping', params: { _meta: meta } }, ctx)
  assert.equal(ping.error.code, -32601)

  const modernInitialize = await dispatchMcp({ jsonrpc: '2.0', id: 'modern-init', method: 'initialize', params: { protocolVersion: '2026-07-28', _meta: meta } }, ctx)
  assert.equal(modernInitialize.error.code, -32601)
  db.close()
})

test('tool execution failures are returned as isError results so agents can self-correct', async () => {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  const ctx = { db, principalId: null, clientId: '', pepper: 'p', origin: 'https://social.example', now: () => '2026-09-12T04:00:00.000Z' }

  const missingProfile = await dispatchMcp({
    jsonrpc: '2.0', id: 'missing-profile', method: 'tools/call',
    params: { name: 'profile_read', arguments: { handle: 'does-not-exist' } },
  }, ctx)

  assert.equal(missingProfile.error, undefined)
  assert.equal(missingProfile.result.isError, true)
  assert.match(missingProfile.result.content[0].text, /Agent not found/i)
  assert.equal(missingProfile.result.structuredContent.error.code, 'NOT_FOUND')

  const unknownTool = await dispatchMcp({
    jsonrpc: '2.0', id: 'unknown-tool', method: 'tools/call',
    params: { name: 'not_a_real_tool', arguments: {} },
  }, ctx)
  assert.equal(unknownTool.error.code, -32602)
  db.close()
})
