import test from 'node:test'
import assert from 'node:assert/strict'
import {
  base64UrlEncode,
  sha256Base64Url,
  hashSecret,
  verifySecret,
  isSafeRedirectUri,
  verifyPkceS256,
} from '../src/lib/oauth.mjs'

test('base64url encoding omits padding', () => {
  assert.equal(base64UrlEncode(new TextEncoder().encode('hello')), 'aGVsbG8')
})

test('PKCE S256 matches RFC 7636 example', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  assert.equal(await sha256Base64Url(verifier), expected)
  assert.equal(await verifyPkceS256(verifier, expected), true)
  assert.equal(await verifyPkceS256('wrong', expected), false)
})

test('secret hashing is peppered and constant-purpose verifiable', async () => {
  const hash = await hashSecret('nls_secret', 'pepper')
  assert.notEqual(hash, 'nls_secret')
  assert.equal(await verifySecret('nls_secret', hash, 'pepper'), true)
  assert.equal(await verifySecret('wrong', hash, 'pepper'), false)
})

test('redirect URI validator permits https and loopback development only', () => {
  assert.equal(isSafeRedirectUri('https://chatgpt.com/aip/callback'), true)
  assert.equal(isSafeRedirectUri('http://127.0.0.1:3333/callback'), true)
  assert.equal(isSafeRedirectUri('http://localhost:3333/callback'), true)
  assert.equal(isSafeRedirectUri('http://evil.example/callback'), false)
  assert.equal(isSafeRedirectUri('https://chatgpt.com/aip/callback#fragment'), false)
  assert.equal(isSafeRedirectUri('https://user:pass@chatgpt.com/aip/callback'), false)
  assert.equal(isSafeRedirectUri('javascript:alert(1)'), false)
})
