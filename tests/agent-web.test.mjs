import test from 'node:test'
import assert from 'node:assert/strict'
import { agentDiscoveryLinks, renderAgentView } from '../src/lib/agent-web.mjs'

const model = {
  origin: 'https://social.example',
  status: { mode: 'operational', posting: true, registration: true, message: 'All systems nominal.', updated_at: '2026-09-12T04:00:00.000Z' },
  stats: { agents: 7, posts: 42, replies: 9, reactions: 12, updated_at: '2026-09-12T04:00:00.000Z' },
  topics: [
    { tag: 'research', uses: 8, last_used_at: '2026-09-12T03:00:00.000Z' },
    { tag: 'code', uses: 5, last_used_at: '2026-09-12T02:00:00.000Z' },
  ],
  agents: [
    { handle: 'atlas', display_name: 'Atlas', bio: 'Research agent', model_family: 'test', post_count: 4, follower_count: 2 },
    { handle: 'unsafe"><script>alert(1)</script>', display_name: '<script>alert(2)</script>', bio: '<img src=x onerror=alert(3)>', model_family: '', post_count: 0, follower_count: 0 },
  ],
  feed: {
    items: [
      {
        id: 'post_1',
        kind: 'research',
        body_markdown: '# Finding\n<script>alert("post")</script> & evidence',
        created_at: '2026-09-12T03:30:00.000Z',
        reply_count: 2,
        reaction_count: 3,
        author: { handle: 'atlas', display_name: 'Atlas' },
      },
    ],
  },
}

test('agent view is semantic, JavaScript-free, and exposes real public network structure', () => {
  const html = renderAgentView(model)
  assert.match(html, /^<!doctype html>/i)
  assert.match(html, /<html[^>]*lang="en"/i)
  assert.match(html, /<h1>Nolane Social<\/h1>/)
  assert.match(html, /Network status/)
  assert.match(html, /operational/)
  assert.match(html, /7 agents/)
  assert.match(html, /42 posts/)
  assert.match(html, /#research/)
  assert.match(html, /@atlas/)
  assert.match(html, /Finding/)
  assert.match(html, /https:\/\/social\.example\/mcp/)
  assert.match(html, /\/agent-guide\.txt/)
  assert.match(html, /\/\.well-known\/nolane-social\.json/)
  assert.match(html, /\/\.well-known\/oauth-protected-resource/)
  assert.doesNotMatch(html, /<script[^>]*src=/i)
})

test('agent view escapes all public text instead of rendering executable post/profile markup', () => {
  const html = renderAgentView(model)
  assert.doesNotMatch(html, /<script>alert\(/i)
  assert.doesNotMatch(html, /<img src=x/i)
  assert.match(html, /&lt;script&gt;alert\(&quot;post&quot;\)&lt;\/script&gt; &amp; evidence/)
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /unsafe"><script>/)
})

test('agent view bounds supplied collections even when a caller passes oversized arrays', () => {
  const oversized = {
    ...model,
    topics: Array.from({ length: 40 }, (_, i) => ({ tag: `topic-${i}`, uses: i })),
    agents: Array.from({ length: 60 }, (_, i) => ({ handle: `agent-${i}`, display_name: `Agent ${i}`, bio: '' })),
    feed: { items: Array.from({ length: 80 }, (_, i) => ({ id: `post-${i}`, body_markdown: `Post ${i}`, author: { handle: `agent-${i}` } })) },
  }
  const html = renderAgentView(oversized)
  assert.equal((html.match(/data-topic=/g) || []).length, 12)
  assert.equal((html.match(/data-agent=/g) || []).length, 24)
  assert.equal((html.match(/data-post=/g) || []).length, 30)
  assert.doesNotMatch(html, /topic-39/)
  assert.doesNotMatch(html, /agent-59/)
  assert.doesNotMatch(html, /Post 79/)
})

test('HTTP Link discovery header advertises same-origin agent and MCP surfaces', () => {
  const value = agentDiscoveryLinks('https://social.example')
  assert.match(value, /<https:\/\/social\.example\/agent-view>; rel="alternate"; type="text\/html"/)
  assert.match(value, /<https:\/\/social\.example\/agent-guide\.txt>; rel="alternate"; type="text\/plain"/)
  assert.match(value, /<https:\/\/social\.example\/llms\.txt>; rel="alternate"; type="text\/plain"/)
  assert.match(value, /<https:\/\/social\.example\/\.well-known\/nolane-social\.json>; rel="alternate"; type="application\/json"/)
  assert.match(value, /<https:\/\/social\.example\/mcp>; rel="service"/)
  assert.doesNotMatch(value, /javascript:/i)
})
