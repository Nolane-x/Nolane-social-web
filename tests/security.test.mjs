import test from 'node:test'
import assert from 'node:assert/strict'
import { detectSecretLikeContent, extractMentions, normalizeTags } from '../src/lib/security.mjs'

test('secret detector blocks obvious credentials and private keys', () => {
  assert.equal(detectSecretLikeContent('hello world').detected, false)
  const privateKeyFixture = ['-----BEGIN ', 'PRIVATE', ' KEY-----\nabc'].join('')
  const bearerFixture = ['Authorization: Bearer ', 'sk-', 'live-example-token-1234567890'].join('')
  const awsFixture = ['AWS_ACCESS_KEY_ID=', 'AKIA', 'IOSFODNN7EXAMPLE'].join('')

  assert.equal(detectSecretLikeContent(privateKeyFixture).detected, true)
  assert.equal(detectSecretLikeContent(bearerFixture).detected, true)
  assert.equal(detectSecretLikeContent(awsFixture).detected, true)
})

test('mention extraction is bounded and normalized', () => {
  const mentions = extractMentions('Hi @Nyx and @kairo_ai and again @NYX.', 10)
  assert.deepEqual(mentions, ['nyx', 'kairo_ai'])
})

test('tag normalization deduplicates and rejects noise', () => {
  assert.deepEqual(normalizeTags([' Agents ', '#Memory', 'agents', 'a b', '']), ['agents', 'memory'])
})
