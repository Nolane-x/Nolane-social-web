import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { D1Sqlite } from './helpers/d1-sqlite.mjs'
import { handleOAuthRequest, authenticateBearer, oauthAuthorizationServerMetadata, oauthProtectedResourceMetadata } from '../src/lib/oauth-server.mjs'
import { sha256Base64Url } from '../src/lib/oauth.mjs'

function setup() {
  const db = new D1Sqlite()
  db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  return db
}

const origin = 'https://social.example'
const pepper = 'pepper-for-oauth-tests'
const now = () => '2026-09-12T05:00:00.000Z'

async function json(response) {
  return JSON.parse(await response.text())
}

test('OAuth metadata advertises MCP protected resource and PKCE authorization code flow', () => {
  const auth = oauthAuthorizationServerMetadata(origin)
  assert.equal(auth.issuer, origin)
  assert.equal(auth.authorization_endpoint, `${origin}/oauth/authorize`)
  assert.equal(auth.token_endpoint, `${origin}/oauth/token`)
  assert.deepEqual(auth.code_challenge_methods_supported, ['S256'])
  assert.equal(auth.authorization_response_iss_parameter_supported, true)

  const resource = oauthProtectedResourceMetadata(origin)
  assert.equal(resource.resource, `${origin}/mcp`)
  assert.deepEqual(resource.authorization_servers, [origin])
  assert.deepEqual(resource.scopes_supported, ['social.read', 'social.write'])
})

test('DCR + authorization code PKCE + refresh flow yields an authenticated principal', async () => {
  const db = setup()
  const ctx = { db, origin, pepper, now }

  const register = await handleOAuthRequest(new Request(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT Test', redirect_uris: ['https://chat.example/callback'], token_endpoint_auth_method: 'none' }),
  }), ctx)
  assert.equal(register.status, 201)
  const client = await json(register)
  assert.match(client.client_id, /^nlc_/)

  const verifier = 'test-verifier-that-is-long-enough-for-pkce-0123456789'
  const challenge = await sha256Base64Url(verifier)
  const authorizeUrl = new URL(`${origin}/oauth/authorize`)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: 'https://chat.example/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'social.read social.write offline_access',
    state: 'state-123',
    resource: `${origin}/mcp`,
  }).toString()
  const consent = await handleOAuthRequest(new Request(authorizeUrl), ctx)
  assert.equal(consent.status, 200)
  const html = await consent.text()
  const requestId = html.match(/name="request_id" value="([^"]+)"/)?.[1]
  assert.match(requestId, /^oar_/)

  const approve = await handleOAuthRequest(new Request(`${origin}/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request_id: requestId, decision: 'approve' }),
  }), ctx)
  assert.equal(approve.status, 302)
  const callback = new URL(approve.headers.get('location'))
  assert.equal(callback.origin + callback.pathname, 'https://chat.example/callback')
  assert.equal(callback.searchParams.get('state'), 'state-123')
  const code = callback.searchParams.get('code')
  assert.match(code, /^nloc_/)

  const token = await handleOAuthRequest(new Request(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code,
      redirect_uri: 'https://chat.example/callback',
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    }),
  }), ctx)
  assert.equal(token.status, 200)
  const issued = await json(token)
  assert.match(issued.access_token, /^nlat_/)
  assert.match(issued.refresh_token, /^nlrt_/)
  assert.equal(issued.token_type, 'Bearer')

  const principal = await authenticateBearer(db, issued.access_token, pepper, now())
  assert.match(principal.principalId, /^prn_/)
  assert.equal(principal.clientId, client.client_id)

  const refreshedResponse = await handleOAuthRequest(new Request(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: issued.refresh_token, resource: `${origin}/mcp` }),
  }), ctx)
  assert.equal(refreshedResponse.status, 200)
  const refreshed = await json(refreshedResponse)
  assert.notEqual(refreshed.access_token, issued.access_token)
  assert.notEqual(refreshed.refresh_token, issued.refresh_token)
  assert.equal(await authenticateBearer(db, issued.access_token, pepper, now()), null)
  assert.match((await authenticateBearer(db, refreshed.access_token, pepper, now())).principalId, /^prn_/)
  db.close()
})

test('authorization rejects unregistered redirects and invalid PKCE exchanges', async () => {
  const db = setup()
  const ctx = { db, origin, pepper, now }
  const register = await handleOAuthRequest(new Request(`${origin}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Client', redirect_uris: ['https://safe.example/callback'] }),
  }), ctx)
  const client = await json(register)

  const bad = await handleOAuthRequest(new Request(`${origin}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent('https://evil.example/callback')}&code_challenge=abc&code_challenge_method=S256`), ctx)
  assert.equal(bad.status, 400)
  db.close()
})

test('authorization and token exchange reject a missing or foreign MCP resource', async () => {
  const db = setup()
  const ctx = { db, origin, pepper, now }
  const register = await handleOAuthRequest(new Request(`${origin}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Resource-bound client', redirect_uris: ['https://client.example/callback'] }),
  }), ctx)
  const client = await json(register)
  const verifier = 'resource-binding-verifier-that-is-long-enough-0123456789'
  const challenge = await sha256Base64Url(verifier)

  const missingResource = new URL(`${origin}/oauth/authorize`)
  missingResource.search = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: 'https://client.example/callback',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'social.read',
  }).toString()
  assert.equal((await handleOAuthRequest(new Request(missingResource), ctx)).status, 400)

  const wrongResource = new URL(missingResource)
  wrongResource.searchParams.set('resource', 'https://other.example/mcp')
  assert.equal((await handleOAuthRequest(new Request(wrongResource), ctx)).status, 400)

  const missingTokenResource = await handleOAuthRequest(new Request(`${origin}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: 'not-used' }),
  }), ctx)
  assert.equal(missingTokenResource.status, 400)
  assert.equal((await json(missingTokenResource)).error, 'invalid_target')

  const wrongTokenResource = await handleOAuthRequest(new Request(`${origin}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: 'not-used', resource: 'https://other.example/mcp' }),
  }), ctx)
  assert.equal(wrongTokenResource.status, 400)
  assert.equal((await json(wrongTokenResource)).error, 'invalid_target')
  db.close()
})

test('authorization rejects unknown scopes instead of silently widening or narrowing consent', async () => {
  const db = setup()
  const ctx = { db, origin, pepper, now }
  const register = await handleOAuthRequest(new Request(`${origin}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Scope client', redirect_uris: ['https://scope.example/callback'] }),
  }), ctx)
  const client = await json(register)
  const challenge = await sha256Base64Url('scope-verifier-that-is-long-enough-0123456789')
  const authorizeUrl = new URL(`${origin}/oauth/authorize`)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: 'https://scope.example/callback',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'social.read unknown.scope',
    resource: `${origin}/mcp`,
  }).toString()

  const response = await handleOAuthRequest(new Request(authorizeUrl), ctx)
  assert.equal(response.status, 400)
  assert.equal((await json(response)).error, 'invalid_scope')
  db.close()
})

test('authorization denial includes the issuer identifier in the callback', async () => {
  const db = setup()
  const ctx = { db, origin, pepper, now }
  const register = await handleOAuthRequest(new Request(`${origin}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Issuer client', redirect_uris: ['https://issuer.example/callback'] }),
  }), ctx)
  const client = await json(register)
  const challenge = await sha256Base64Url('issuer-verifier-that-is-long-enough-0123456789')
  const authorizeUrl = new URL(`${origin}/oauth/authorize`)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: 'https://issuer.example/callback',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'social.read', state: 'deny-state',
    resource: `${origin}/mcp`,
  }).toString()
  const consent = await handleOAuthRequest(new Request(authorizeUrl), ctx)
  const html = await consent.text()
  const requestId = html.match(/name="request_id" value="([^"]+)"/)?.[1]

  const denied = await handleOAuthRequest(new Request(`${origin}/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request_id: requestId, decision: 'deny' }),
  }), ctx)
  assert.equal(denied.status, 302)
  const callback = new URL(denied.headers.get('location'))
  assert.equal(callback.searchParams.get('error'), 'access_denied')
  assert.equal(callback.searchParams.get('state'), 'deny-state')
  assert.equal(callback.searchParams.get('iss'), origin)
  db.close()
})
