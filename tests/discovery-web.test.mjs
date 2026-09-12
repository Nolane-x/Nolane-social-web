import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { renderAtomFeed, renderSitemap } from '../src/lib/discovery-web.mjs'

const origin = 'https://social.example'
const agent = { handle: 'nyx', display_name: 'Nyx & Co', updated_at: '2026-09-12T01:00:00.000Z' }
const post = {
  id: 'pst_one', body_markdown: 'Public research & findings', created_at: '2026-09-12T02:00:00.000Z',
  updated_at: '2026-09-12T02:00:00.000Z', author: agent,
}

test('sitemap exposes bounded canonical semantic inventory', () => {
  const xml = renderSitemap({ origin, agents: [agent], topics: [{ tag: 'agents', last_used_at: post.updated_at }], posts: [post] })
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(xml, /https:\/\/social\.example\/agent-view/)
  assert.match(xml, /https:\/\/social\.example\/agents\/nyx/)
  assert.match(xml, /https:\/\/social\.example\/posts\/pst_one/)
  assert.match(xml, /https:\/\/social\.example\/topics\/agents/)
  assert.match(xml, /<lastmod>2026-09-12T02:00:00\.000Z<\/lastmod>/)
})

test('crawler inventory excludes public tombstones and deleted posts', () => {
  const tombstone = { ...post, id: 'pst_deleted', deleted: true, body_markdown: '[post deleted by author]' }
  const rawDeleted = { ...post, id: 'pst_raw_deleted', deleted_at: '2026-09-12T03:00:00.000Z' }
  const sitemap = renderSitemap({ origin, posts: [post, tombstone, rawDeleted] })
  const feed = renderAtomFeed({ origin, posts: [post, tombstone, rawDeleted], updatedAt: post.updated_at })
  assert.match(sitemap, /pst_one/)
  assert.doesNotMatch(sitemap, /pst_deleted|pst_raw_deleted/)
  assert.match(feed, /pst_one/)
  assert.doesNotMatch(feed, /pst_deleted|pst_raw_deleted/)
})

test('Atom feed points entries at canonical post and agent pages and escapes XML', () => {
  const xml = renderAtomFeed({ origin, posts: [post], updatedAt: post.updated_at })
  assert.match(xml, /application\/atom\+xml|<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/)
  assert.match(xml, /href="https:\/\/social\.example\/posts\/pst_one"/)
  assert.match(xml, /uri>https:\/\/social\.example\/agents\/nyx<\/uri>/)
  assert.match(xml, /Public research &amp; findings/)
})

test('robots welcomes AI retrieval crawlers and keeps every crawler out of control routes', () => {
  const robots = fs.readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
  for (const crawler of ['OAI-SearchBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot']) {
    const group = new RegExp(`User-agent: ${crawler}\\nAllow: /\\nDisallow: /admin\\nDisallow: /oauth`)
    assert.match(robots, group)
  }
  assert.match(robots, /User-agent: \*\nAllow: \/\nDisallow: \/admin\nDisallow: \/oauth/)
  assert.match(robots, /Sitemap: https:\/\/social\.nolanestudioai\.workers\.dev\/sitemap\.xml/)
})
