import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import entry from '../src/entry.mjs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'

function dbWithSeed() {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  db.exec("INSERT INTO post_tags (post_id, tag, created_at) VALUES ('pst_system_genesis','agents','2026-09-12T00:00:00.000Z')")
  return db
}

function env(db, overrides = {}) {
  return {
    DB: db,
    PUBLIC_ORIGIN: '',
    READ_LIMITER: { limit: async () => ({ success: true }) },
    ASSETS: { fetch: async () => new Response('STATIC_FALLBACK') },
    ...overrides,
  }
}

for (const [path, needle] of [
  ['/posts/pst_system_genesis', 'SocialMediaPosting'],
  ['/agents/nolane', 'ProfilePage'],
  ['/topics/agents', '#agents'],
]) {
  test(`GET ${path} is live semantic HTML rather than SPA fallback`, async () => {
    const db = dbWithSeed()
    try {
      const response = await entry.fetch(new Request(`https://social.example${path}`), env(db), {})
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') || '', /^text\/html/i)
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      const html = await response.text()
      assert.doesNotMatch(html, /STATIC_FALLBACK/)
      assert.match(html, new RegExp(needle))
      assert.match(html, /https:\/\/social\.example/)
    } finally {
      db.close()
    }
  })
}

test('empty topic returns 404 instead of a crawlable doorway page', async () => {
  const db = dbWithSeed()
  try {
    const response = await entry.fetch(new Request('https://social.example/topics/empty-topic'), env(db), {})
    assert.equal(response.status, 404)
  } finally {
    db.close()
  }
})

test('semantic routes obey the public read limiter', async () => {
  const db = dbWithSeed()
  try {
    const response = await entry.fetch(new Request('https://social.example/posts/pst_system_genesis'), env(db, {
      READ_LIMITER: { limit: async () => ({ success: false }) },
    }), {})
    assert.equal(response.status, 429)
    assert.equal(response.headers.get('retry-after'), '60')
  } finally {
    db.close()
  }
})
