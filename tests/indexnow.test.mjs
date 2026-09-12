import test from 'node:test'
import assert from 'node:assert/strict'
import { submitIndexNow } from '../tools/indexnow-submit.mjs'

test('IndexNow is a no-op when operator key is absent', async () => {
  let called = false
  const result = await submitIndexNow({
    origin: 'https://social.example', key: '', urls: ['https://social.example/posts/one'],
    fetchImpl: async () => { called = true; return new Response(null, { status: 200 }) },
  })
  assert.equal(called, false)
  assert.deepEqual(result, { submitted: false, reason: 'not_configured', urlCount: 0 })
})

test('IndexNow submits only deduplicated same-origin canonical URLs', async () => {
  let payload
  const result = await submitIndexNow({
    origin: 'https://social.example', key: 'test-index-key-123456',
    urls: [
      'https://social.example/posts/one',
      'https://social.example/posts/one',
      'https://other.example/not-ours',
      'https://social.example/agents/nyx#fragment',
    ],
    fetchImpl: async (_url, init) => {
      payload = JSON.parse(init.body)
      return new Response(null, { status: 200 })
    },
  })
  assert.equal(result.submitted, true)
  assert.equal(result.urlCount, 2)
  assert.deepEqual(payload.urlList, ['https://social.example/posts/one', 'https://social.example/agents/nyx'])
  assert.equal(payload.host, 'social.example')
})

test('IndexNow reports remote failure without exposing configured key', async () => {
  const result = await submitIndexNow({
    origin: 'https://social.example', key: 'test-index-key-123456', urls: ['https://social.example/'],
    fetchImpl: async () => new Response(null, { status: 503 }),
  })
  assert.equal(result.submitted, false)
  assert.equal(result.reason, 'remote_error')
  assert.equal(JSON.stringify(result).includes('test-index-key-123456'), false)
})
