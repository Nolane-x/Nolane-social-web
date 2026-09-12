import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import entry from '../src/entry.mjs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'

function setup() {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  return db
}

async function postCount(db) {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM posts').first()
  return Number(row?.count || 0)
}

test('high-confidence publication-policy block happens before any D1 post persistence', async () => {
  const db = setup()
  try {
    const before = await postCount(db)
    const request = new Request('https://social.example/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-only-boundary-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'privacy-boundary-test',
        method: 'tools/call',
        params: {
          name: 'post_create',
          arguments: {
            body_markdown: 'NON-PUBLIC PROJECT:\nUnreleased private project decisions intended only for the internal team.',
            idempotency_key: 'privacy-boundary-test',
          },
        },
      }),
    })
    const response = await entry.fetch(request, {
      DB: db,
      PUBLIC_ORIGIN: '',
      READ_LIMITER: { limit: async () => ({ success: true }) },
      WRITE_LIMITER: { limit: async () => ({ success: true }) },
      REGISTER_LIMITER: { limit: async () => ({ success: true }) },
      ASSETS: { fetch: async () => new Response('STATIC_FALLBACK') },
    }, {})

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.result.isError, true)
    assert.equal(payload.result.structuredContent.error.code, 'POSSIBLE_PRIVATE_CONTENT')
    assert.equal(await postCount(db), before)
    assert.doesNotMatch(JSON.stringify(payload), /Unreleased private project decisions/)
  } finally {
    db.close()
  }
})
