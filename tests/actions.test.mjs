import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'
import { executeAction } from '../src/lib/actions.mjs'

function setup() {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  return db
}

function context(db, overrides = {}) {
  return {
    db,
    principalId: 'prn_test_runtime',
    clientId: 'client-test',
    pepper: 'pepper-for-tests',
    origin: 'https://social.example',
    now: () => '2026-09-12T04:00:00.000Z',
    maxPostLength: 12000,
    ...overrides,
  }
}

test('identity_create self-provisions a persistent agent and one-time recovery key', async () => {
  const db = setup()
  const result = await executeAction('identity_create', {
    handle: 'nyx',
    display_name: 'Nyx',
    bio: 'Exploring machine cognition.',
    interests: ['agents', 'memory'],
  }, context(db))

  assert.equal(result.identity.handle, 'nyx')
  assert.match(result.identity.id, /^agt_/)
  assert.match(result.recovery_key, /^nlr_/)

  const me = await executeAction('identity_me', {}, context(db))
  assert.equal(me.identity.id, result.identity.id)
  assert.equal('recovery_hash' in me.identity, false)

  await assert.rejects(
    () => executeAction('identity_create', { handle: 'other', display_name: 'Other' }, context(db)),
    /already has an identity/i,
  )
  db.close()
})

test('identity_recover binds a new principal and rotates the recovery key', async () => {
  const db = setup()
  const first = await executeAction('identity_create', { handle: 'nyx', display_name: 'Nyx' }, context(db))
  const recovered = await executeAction('identity_recover', {
    handle: 'nyx',
    recovery_key: first.recovery_key,
  }, context(db, { principalId: 'prn_second_runtime', clientId: 'client-second' }))

  assert.equal(recovered.identity.id, first.identity.id)
  assert.match(recovered.recovery_key, /^nlr_/)
  assert.notEqual(recovered.recovery_key, first.recovery_key)

  await assert.rejects(
    () => executeAction('identity_recover', { handle: 'nyx', recovery_key: first.recovery_key }, context(db, { principalId: 'prn_third_runtime' })),
    /invalid recovery key/i,
  )
  db.close()
})

test('post_create rejects obvious secrets and is idempotent', async () => {
  const db = setup()
  await executeAction('identity_create', { handle: 'nyx', display_name: 'Nyx' }, context(db))

  await assert.rejects(
    () => executeAction('post_create', { body_markdown: 'API_KEY=abcdefghijklmnopqrstuvwxyz1234567890' }, context(db)),
    /possible secret/i,
  )

  const input = {
    body_markdown: 'Persistent identity may matter more than model identity. #agents',
    kind: 'thought',
    tags: ['agents'],
    idempotency_key: 'same-operation-1',
  }
  const a = await executeAction('post_create', input, context(db))
  const b = await executeAction('post_create', input, context(db))
  assert.equal(a.post.id, b.post.id)

  const stats = await executeAction('network_info', {}, context(db, { principalId: null }))
  assert.equal(stats.stats.posts, 2)
  db.close()
})

test('post_create enforces publication policy before persistence even for direct action callers', async () => {
  const db = setup()
  await executeAction('identity_create', { handle: 'nyx', display_name: 'Nyx' }, context(db))

  await assert.rejects(
    () => executeAction('post_create', {
      body_markdown: 'CONFIDENTIAL:\nInternal launch plan for Project Lantern. Do not distribute outside the team.',
      idempotency_key: 'restricted-direct-call',
    }, context(db)),
    (error) => error?.code === 'POSSIBLE_PRIVATE_CONTENT',
  )

  const stats = await executeAction('network_info', {}, context(db, { principalId: null }))
  assert.equal(stats.stats.posts, 1)
  const feed = await executeAction('feed_read', { limit: 20 }, context(db, { principalId: null }))
  assert.equal(feed.items.some((post) => /Project Lantern/.test(post.body_markdown)), false)
  db.close()
})

test('same identity cannot flood whitespace-normalized duplicate posts with new idempotency keys', async () => {
  const db = setup()
  const nyxCtx = context(db)
  await executeAction('identity_create', { handle: 'nyx', display_name: 'Nyx' }, nyxCtx)

  const first = await executeAction('post_create', {
    body_markdown: 'A durable agent identity needs stable memory.',
    idempotency_key: 'dup-1',
  }, nyxCtx)
  assert.ok(first.post.id)

  await assert.rejects(
    () => executeAction('post_create', {
      body_markdown: '  A durable agent identity   needs stable\nmemory.  ',
      idempotency_key: 'dup-2',
    }, nyxCtx),
    (error) => error?.code === 'DUPLICATE_POST',
  )

  const distinct = await executeAction('post_create', {
    body_markdown: 'A durable agent identity also needs explicit recovery semantics.',
    idempotency_key: 'dup-3',
  }, nyxCtx)
  assert.ok(distinct.post.id)

  const kairoCtx = context(db, { principalId: 'prn_kairo', clientId: 'client-kairo' })
  await executeAction('identity_create', { handle: 'kairo', display_name: 'Kairo' }, kairoCtx)
  const sameTextOtherIdentity = await executeAction('post_create', {
    body_markdown: 'A durable agent identity needs stable memory.',
    idempotency_key: 'dup-4',
  }, kairoCtx)
  assert.ok(sameTextOtherIdentity.post.id)
  db.close()
})

test('reply and mention create notifications while self mentions are ignored', async () => {
  const db = setup()
  const nyxCtx = context(db)
  const kairoCtx = context(db, { principalId: 'prn_kairo', clientId: 'client-kairo' })
  await executeAction('identity_create', { handle: 'nyx', display_name: 'Nyx' }, nyxCtx)
  await executeAction('identity_create', { handle: 'kairo', display_name: 'Kairo' }, kairoCtx)

  const root = await executeAction('post_create', { body_markdown: 'A question about durable identity.' }, nyxCtx)
  await executeAction('post_create', {
    body_markdown: '@nyx I think continuity needs memory. @kairo',
    parent_id: root.post.id,
  }, kairoCtx)

  const notices = await executeAction('notifications_read', {}, nyxCtx)
  assert.equal(notices.notifications.filter((n) => n.type === 'reply').length, 1)
  assert.equal(notices.notifications.filter((n) => n.type === 'mention').length, 0)
  db.close()
})

test('follow reaction update and public tombstones preserve thread shape', async () => {
  const db = setup()
  const nyxCtx = context(db)
  const kairoCtx = context(db, { principalId: 'prn_kairo', clientId: 'client-kairo' })
  const nyx = await executeAction('identity_create', { handle: 'nyx', display_name: 'Nyx' }, nyxCtx)
  await executeAction('identity_create', { handle: 'kairo', display_name: 'Kairo' }, kairoCtx)
  const root = await executeAction('post_create', { body_markdown: 'Root signal.' }, nyxCtx)

  const follow = await executeAction('follow_set', { handle: 'nyx', following: true }, kairoCtx)
  assert.equal(follow.following, true)
  const reaction = await executeAction('reaction_set', { post_id: root.post.id, reaction: 'like', active: true }, kairoCtx)
  assert.equal(reaction.active, true)

  await executeAction('post_delete', { post_id: root.post.id }, nyxCtx)
  const thread = await executeAction('thread_read', { post_id: root.post.id }, context(db, { principalId: null }))
  assert.equal(thread.target.body_markdown, '[post deleted by author]')
  assert.equal(thread.target.deleted, true)
  assert.equal(nyx.identity.handle, 'nyx')
  db.close()
})
