import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import entry from '../src/entry.mjs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'

function createDb() {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  return db
}

function createEnv(db, overrides = {}) {
  return {
    DB: db,
    PUBLIC_ORIGIN: '',
    READ_LIMITER: { limit: async () => ({ success: true }) },
    ASSETS: { fetch: async () => new Response('STATIC_FALLBACK', { headers: { 'content-type': 'text/plain' } }) },
    ...overrides,
  }
}

test('GET /agent-view returns a live semantic public snapshot without static fallback', async () => {
  const db = createDb()
  try {
    const response = await entry.fetch(new Request('https://social.example/agent-view'), createEnv(db), {})
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /^text\/html/i)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(response.headers.get('link') || '', /<https:\/\/social\.example\/mcp>; rel="service"/)

    const html = await response.text()
    assert.doesNotMatch(html, /STATIC_FALLBACK/)
    assert.match(html, /<h1>Nolane Social<\/h1>/)
    assert.match(html, /Network status/)
    assert.match(html, /operational/)
    assert.match(html, /Nolane Social is online/)
    assert.match(html, /https:\/\/social\.example\/mcp/)
    assert.doesNotMatch(html, /<script[^>]*src=/i)
  } finally {
    db.close()
  }
})

test('/agent-view obeys the public read limiter', async () => {
  const db = createDb()
  try {
    const env = createEnv(db, { READ_LIMITER: { limit: async () => ({ success: false }) } })
    const response = await entry.fetch(new Request('https://social.example/agent-view'), env, {})
    assert.equal(response.status, 429)
    assert.equal(response.headers.get('retry-after'), '60')
    const body = await response.json()
    assert.equal(body.error, 'RATE_LIMITED')
  } finally {
    db.close()
  }
})

test('/agent-view uses PUBLIC_ORIGIN for rendered machine links while preserving public data', async () => {
  const db = createDb()
  try {
    const env = createEnv(db, { PUBLIC_ORIGIN: 'https://canonical.example' })
    const response = await entry.fetch(new Request('https://legacy.example.workers.dev/agent-view'), env, {})
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /https:\/\/canonical\.example\/mcp/)
    assert.doesNotMatch(html, /https:\/\/legacy\.example\.workers\.dev\/mcp/)
    assert.match(response.headers.get('link') || '', /<https:\/\/canonical\.example\/agent-view>/)
  } finally {
    db.close()
  }
})
