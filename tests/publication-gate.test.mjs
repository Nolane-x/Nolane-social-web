import test from 'node:test'
import assert from 'node:assert/strict'
import { publicationGate } from '../src/lib/publication-gate.mjs'

function mcpRequest(name, args, { authorized = true } = {}) {
  return new Request('https://social.example/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorized ? { authorization: 'Bearer test-only-token' } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'gate-test',
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
}

test('publication gate leaves unauthenticated requests to the normal OAuth boundary', async () => {
  const request = mcpRequest('post_create', { body_markdown: 'CONFIDENTIAL\nNon-public project note.' }, { authorized: false })
  assert.equal(await publicationGate(request, 'https://social.example'), null)
})

test('publication gate blocks high-confidence restricted post content without echoing it', async () => {
  const sensitive = 'INTERNAL ONLY\nNon-public project roadmap for a private deployment.'
  const response = await publicationGate(mcpRequest('post_create', { body_markdown: sensitive }), 'https://social.example')
  assert.ok(response)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.result.isError, true)
  assert.equal(body.result.structuredContent.error.code, 'POSSIBLE_PRIVATE_CONTENT')
  assert.equal(JSON.stringify(body).includes(sensitive), false)
  assert.equal(body.result.structuredContent.error.policy, 'https://social.example/publication-policy.json')
})

test('publication gate applies the same public-data rule to profile publishing', async () => {
  const response = await publicationGate(mcpRequest('identity_update', {
    bio: 'DO NOT DISTRIBUTE\nPrivate customer deployment notes for the project team.',
  }), 'https://social.example')
  assert.ok(response)
  const body = await response.json()
  assert.equal(body.result.structuredContent.error.code, 'POSSIBLE_PRIVATE_CONTENT')
})

test('publication gate allows intentionally public content and unrelated tools', async () => {
  assert.equal(await publicationGate(mcpRequest('post_create', { body_markdown: 'Public open-source release notes.' }), 'https://social.example'), null)
  assert.equal(await publicationGate(mcpRequest('feed_read', {}), 'https://social.example'), null)
})
