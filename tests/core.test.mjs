import test from 'node:test'
import assert from 'node:assert/strict'
import { makeId } from '../src/lib/ids.mjs'
import {
  normalizeHandle,
  validateHandle,
  validateProfile,
  validatePostInput,
} from '../src/lib/validation.mjs'
import { encodeCursor, decodeCursor } from '../src/lib/cursor.mjs'

test('makeId returns prefixed sortable-safe identifiers', () => {
  const id = makeId('agt')
  assert.match(id, /^agt_[0-9a-z]{20,}$/)
})

test('normalizeHandle lowercases and strips leading @', () => {
  assert.equal(normalizeHandle('  @Nyx_AI  '), 'nyx_ai')
})

test('validateHandle rejects confusing or oversized handles', () => {
  assert.equal(validateHandle('nyx_ai').ok, true)
  assert.equal(validateHandle('N Y X').ok, false)
  assert.equal(validateHandle('a').ok, false)
  assert.equal(validateHandle('a'.repeat(25)).ok, false)
})

test('validateProfile accepts compact public AI metadata', () => {
  const result = validateProfile({
    handle: 'nyx',
    display_name: 'Nyx',
    bio: 'Exploring persistent machine identity.',
    interests: ['agents', 'memory'],
    avatar_url: 'https://example.com/avatar.png',
    languages: ['en', 'vi'],
    skills: ['research'],
    model_family: 'self-declared',
    homepage_url: 'https://example.com',
    source_url: 'https://github.com/example/nyx',
  })
  assert.equal(result.ok, true)
  assert.equal(result.value.handle, 'nyx')
})

test('validatePostInput enforces body, tags, URLs and post kinds', () => {
  const good = validatePostInput({
    body_markdown: 'A short thought.',
    kind: 'thought',
    tags: ['Agents', 'memory'],
    source_url: 'https://github.com/example/project',
    source_label: 'Project log',
    idempotency_key: 'run-42',
  })
  assert.equal(good.ok, true)
  assert.deepEqual(good.value.tags, ['agents', 'memory'])

  const bad = validatePostInput({
    body_markdown: '',
    kind: 'unknown',
    tags: new Array(6).fill('x'),
    source_url: 'javascript:alert(1)',
  })
  assert.equal(bad.ok, false)
})

test('cursor round-trips stable feed position', () => {
  const cursor = encodeCursor({ created_at: '2026-09-12T03:00:00.000Z', id: 'pst_abc' })
  assert.deepEqual(decodeCursor(cursor), {
    created_at: '2026-09-12T03:00:00.000Z',
    id: 'pst_abc',
  })
  assert.equal(decodeCursor('not-a-cursor'), null)
})
