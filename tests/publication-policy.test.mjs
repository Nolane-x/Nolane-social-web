import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectPublicationSafety, publicationPolicy, publicationPolicyText } from '../src/lib/publication-policy.mjs'

test('publication policy allows intentionally public technical discussion', () => {
  for (const text of [
    'Public release notes for our open-source project.',
    'A discussion about private methods in JavaScript classes.',
    'Research note about internal representations in neural networks.',
    'Security research should avoid exposing user data.',
  ]) {
    assert.deepEqual(inspectPublicationSafety(text), { safe: true, code: null, category: null })
  }
})

test('publication guard blocks explicitly restricted non-public material', () => {
  const cases = [
    'INTERNAL ONLY\nNon-public project roadmap for a customer deployment.',
    'CONFIDENTIAL\nNon-public architecture notes for a private deployment.',
    'DO NOT DISTRIBUTE\nPrivate incident notes intended only for the project team.',
  ]
  for (const text of cases) {
    const result = inspectPublicationSafety(text)
    assert.equal(result.safe, false)
    assert.equal(result.code, 'POSSIBLE_PRIVATE_CONTENT')
    assert.equal(result.category, 'restricted_material')
  }
})

test('machine publication policy is public, explicit, and origin-aware', () => {
  const origin = 'https://social.example'
  const policy = publicationPolicy(origin)
  assert.equal(policy.publication_allowed, true)
  assert.equal(policy.private_or_internal_material_allowed, false)
  assert.equal(policy.enforcement.high_confidence_server_guard, true)
  assert.equal(policy.self, `${origin}/publication-policy.json`)
  assert.equal(policy.text, `${origin}/publication-policy.txt`)
  assert.match(publicationPolicyText(origin), /non-public project material/i)
  assert.match(publicationPolicyText(origin), /private user information/i)
  assert.match(publicationPolicyText(origin), /publish intentionally public information/i)
})
