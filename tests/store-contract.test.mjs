import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'
import {
  bindPrincipal,
  createAgent,
  createPost,
  getAgentByHandle,
  getAgentForPrincipal,
  getNetworkStats,
  getPost,
  listFeed,
  listTopics,
  setFollow,
  setReaction,
} from '../src/lib/store.mjs'

function setup() {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  return db
}

const agent = {
  id: 'agt_test_nyx',
  handle: 'nyx',
  display_name: 'Nyx',
  bio: 'Testing the social substrate.',
  avatar_url: '',
  interests: ['agents', 'memory'],
  languages: ['en'],
  skills: ['research'],
  model_family: 'self-declared',
  homepage_url: '',
  source_url: '',
  recovery_hash: 'hash',
  created_at: '2026-09-12T03:00:00.000Z',
}

test('schema seeds explicit network system state', async () => {
  const db = setup()
  const stats = await getNetworkStats(db)
  assert.equal(stats.agents, 0)
  assert.equal(stats.posts, 1)
  const feed = await listFeed(db, { limit: 10 })
  assert.equal(feed.items[0].author.handle, 'nolane')
  assert.equal(feed.items[0].author.is_system, true)
  db.close()
})

test('agent and principal persistence round-trip structured metadata', async () => {
  const db = setup()
  await createAgent(db, agent)
  await bindPrincipal(db, 'prn_runtime_1', agent.id, 'client-chatgpt', agent.created_at)

  const byHandle = await getAgentByHandle(db, '@Nyx')
  assert.equal(byHandle.handle, 'nyx')
  assert.deepEqual(byHandle.interests, ['agents', 'memory'])

  const forPrincipal = await getAgentForPrincipal(db, 'prn_runtime_1')
  assert.equal(forPrincipal.id, agent.id)

  const stats = await getNetworkStats(db)
  assert.equal(stats.agents, 1)
  db.close()
})

test('posts feed and topics retain thread and source metadata', async () => {
  const db = setup()
  await createAgent(db, agent)
  await createPost(db, {
    id: 'pst_root',
    agent_id: agent.id,
    body_markdown: 'Persistent identity may matter more than model identity.',
    kind: 'thought',
    parent_id: '',
    root_id: '',
    reference_id: '',
    source_url: 'https://github.com/example/project',
    source_label: 'Research log',
    tags: ['agents', 'identity'],
    created_at: '2026-09-12T03:10:00.000Z',
  })
  await createPost(db, {
    id: 'pst_reply',
    agent_id: agent.id,
    body_markdown: 'A follow-up.',
    kind: 'post',
    parent_id: 'pst_root',
    root_id: 'pst_root',
    reference_id: '',
    source_url: '',
    source_label: '',
    tags: ['identity'],
    created_at: '2026-09-12T03:11:00.000Z',
  })

  const post = await getPost(db, 'pst_root')
  assert.equal(post.reply_count, 1)
  assert.equal(post.source_label, 'Research log')

  const feed = await listFeed(db, { limit: 10 })
  assert.equal(feed.items[0].id, 'pst_reply')
  assert.equal(feed.items[0].author.handle, 'nyx')

  const topics = await listTopics(db, 10)
  assert.equal(topics[0].tag, 'identity')

  const stats = await getNetworkStats(db)
  assert.equal(stats.posts, 3)
  assert.equal(stats.replies, 1)
  db.close()
})

test('follow and reaction toggles update durable counters without duplication', async () => {
  const db = setup()
  await createAgent(db, agent)
  await createAgent(db, { ...agent, id: 'agt_test_kairo', handle: 'kairo', display_name: 'Kairo', recovery_hash: 'hash2' })
  await createPost(db, {
    id: 'pst_signal',
    agent_id: agent.id,
    body_markdown: 'Signal.',
    kind: 'post',
    parent_id: '',
    root_id: '',
    reference_id: '',
    source_url: '',
    source_label: '',
    tags: [],
    created_at: '2026-09-12T03:15:00.000Z',
  })

  assert.equal(await setFollow(db, 'agt_test_kairo', agent.id, true, '2026-09-12T03:16:00.000Z'), true)
  assert.equal(await setFollow(db, 'agt_test_kairo', agent.id, true, '2026-09-12T03:16:01.000Z'), false)
  assert.equal((await getAgentByHandle(db, 'nyx')).follower_count, 1)

  assert.equal(await setReaction(db, 'pst_signal', 'agt_test_kairo', 'like', true, '2026-09-12T03:17:00.000Z'), true)
  assert.equal(await setReaction(db, 'pst_signal', 'agt_test_kairo', 'like', true, '2026-09-12T03:17:01.000Z'), false)
  assert.equal((await getPost(db, 'pst_signal')).reaction_count, 1)
  assert.equal((await getNetworkStats(db)).reactions, 1)

  assert.equal(await setReaction(db, 'pst_signal', 'agt_test_kairo', 'like', false, '2026-09-12T03:18:00.000Z'), true)
  assert.equal((await getPost(db, 'pst_signal')).reaction_count, 0)
  db.close()
})

test('topic discovery excludes hidden and deleted posts', async () => {
  const db = setup()
  await createAgent(db, agent)
  await createPost(db, {
    id: 'pst_visible_topic', agent_id: agent.id, body_markdown: 'Visible.', kind: 'post', parent_id: '', root_id: '', reference_id: '', source_url: '', source_label: '', tags: ['public-topic'], created_at: '2026-09-12T03:20:00.000Z',
  })
  await createPost(db, {
    id: 'pst_hidden_topic', agent_id: agent.id, body_markdown: 'Hidden.', kind: 'post', parent_id: '', root_id: '', reference_id: '', source_url: '', source_label: '', tags: ['hidden-topic'], created_at: '2026-09-12T03:21:00.000Z',
  })
  await createPost(db, {
    id: 'pst_deleted_topic', agent_id: agent.id, body_markdown: 'Deleted.', kind: 'post', parent_id: '', root_id: '', reference_id: '', source_url: '', source_label: '', tags: ['deleted-topic'], created_at: '2026-09-12T03:22:00.000Z',
  })
  await db.prepare('UPDATE posts SET hidden_at = ? WHERE id = ?').bind('2026-09-12T03:23:00.000Z', 'pst_hidden_topic').run()
  await db.prepare('UPDATE posts SET deleted_at = ? WHERE id = ?').bind('2026-09-12T03:23:00.000Z', 'pst_deleted_topic').run()

  const topics = await listTopics(db, 20)
  assert.ok(topics.some(topic => topic.tag === 'public-topic'))
  assert.ok(!topics.some(topic => topic.tag === 'hidden-topic'))
  assert.ok(!topics.some(topic => topic.tag === 'deleted-topic'))
  db.close()
})
