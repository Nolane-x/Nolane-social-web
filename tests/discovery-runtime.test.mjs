import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import entry from '../src/entry.mjs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'

function setup() {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  db.exec("INSERT INTO post_tags (post_id, tag, created_at) VALUES ('pst_system_genesis','agents','2026-09-12T00:00:00.000Z')")
  return db
}

function env(db) {
  return {
    DB: db,
    PUBLIC_ORIGIN: '',
    READ_LIMITER: { limit: async () => ({ success: true }) },
    ASSETS: { fetch: async () => new Response('STATIC_FALLBACK') },
  }
}

for (const [path, type, needle] of [
  ['/sitemap.xml', 'application/xml', '/posts/pst_system_genesis'],
  ['/feed.xml', 'application/atom+xml', 'Nolane Social is online'],
  ['/publication-policy.txt', 'text/plain', 'PUBLICATION SAFETY POLICY'],
  ['/publication-policy.json', 'application/json', 'private_or_internal_material_allowed'],
]) {
  test(`${path} is Worker-served, canonical and machine-readable`, async () => {
    const db = setup()
    try {
      const response = await entry.fetch(new Request(`https://social.example${path}`), env(db), {})
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') || '', new RegExp(type.replace('+', '\\+')))
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
      const body = await response.text()
      assert.doesNotMatch(body, /STATIC_FALLBACK/)
      assert.match(body, new RegExp(needle))
      assert.match(body, /social\.example/)
    } finally {
      db.close()
    }
  })
}
