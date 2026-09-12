import test from 'node:test'
import assert from 'node:assert/strict'
import { renderAgentPage, renderPostPage, renderTopicPage } from '../src/lib/semantic-web.mjs'

const origin = 'https://social.example'
const agent = {
  id: 'agt_nyx', handle: 'nyx', display_name: 'Nyx <AI>', bio: 'Public researcher & builder',
  model_family: 'test-model', follower_count: 3, following_count: 2, post_count: 1,
  created_at: '2026-09-12T00:00:00.000Z', updated_at: '2026-09-12T00:00:00.000Z',
}
const post = {
  id: 'pst_one', body_markdown: 'Hello <b>agents</b> #agents', kind: 'research',
  tags: ['agents'], reply_count: 1, reaction_count: 2,
  created_at: '2026-09-12T01:00:00.000Z', updated_at: '2026-09-12T01:00:00.000Z',
  author: agent,
}

test('post page is canonical no-JS SocialMediaPosting with complete Google-facing public data', () => {
  const html = renderPostPage({ origin, thread: { root: post, target: post, items: [post] } })
  assert.match(html, /<link rel="canonical" href="https:\/\/social\.example\/posts\/pst_one">/)
  assert.match(html, /"@type":"SocialMediaPosting"/)
  assert.match(html, /"text":"Hello \\u003cb>agents\\u003c\/b> #agents"/)
  assert.match(html, /"commentCount":1/)
  assert.match(html, /"interactionType":"https:\/\/schema\.org\/LikeAction"/)
  assert.match(html, /"userInteractionCount":2/)
  assert.match(html, /"digitalSourceType":"https:\/\/schema\.org\/TrainedAlgorithmicMediaDigitalSource"/)
  assert.doesNotMatch(html, /digitalsourcetype\/TrainedAlgorithmicMedia/)
  assert.match(html, /href="https:\/\/social\.example\/agents\/nyx"/)
  assert.match(html, /href="https:\/\/social\.example\/topics\/agents"/)
  assert.doesNotMatch(html, /<b>agents<\/b>/)
  assert.match(html, /&lt;b&gt;agents&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<script[^>]+src=/i)
})

test('agent page exposes ProfilePage structured data and recent semantic post links', () => {
  const html = renderAgentPage({ origin, agent, posts: [post] })
  assert.match(html, /<link rel="canonical" href="https:\/\/social\.example\/agents\/nyx">/)
  assert.match(html, /"@type":"ProfilePage"/)
  assert.match(html, /href="https:\/\/social\.example\/posts\/pst_one"/)
  assert.match(html, /Nyx &lt;AI&gt;/)
})

test('topic page is a real semantic collection of visible tagged posts', () => {
  const html = renderTopicPage({ origin, tag: 'agents', posts: [post] })
  assert.match(html, /<link rel="canonical" href="https:\/\/social\.example\/topics\/agents">/)
  assert.match(html, /<h1>#agents<\/h1>/)
  assert.match(html, /href="https:\/\/social\.example\/posts\/pst_one"/)
  assert.doesNotMatch(html, /<script[^>]+src=/i)
})
