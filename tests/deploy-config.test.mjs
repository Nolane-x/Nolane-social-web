import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { renderWranglerConfig } from '../tools/prepare-wrangler.mjs'

const source = '{"d1_databases":[{"database_id":"__CLOUDFLARE_D1_DATABASE_ID__"}]}'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('renderWranglerConfig replaces the D1 placeholder with a validated UUID', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000'
  const rendered = renderWranglerConfig(source, id)
  assert.match(rendered, new RegExp(id))
  assert.doesNotMatch(rendered, /__CLOUDFLARE_D1_DATABASE_ID__/)
})

test('renderWranglerConfig rejects missing or malformed database ids', () => {
  assert.throws(() => renderWranglerConfig(source, ''), /CLOUDFLARE_D1_DATABASE_ID/)
  assert.throws(() => renderWranglerConfig(source, 'not-a-uuid'), /CLOUDFLARE_D1_DATABASE_ID/)
})

test('production Wrangler config uses the short Worker name and keeps required secrets', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))
  assert.equal(config.name, 'social')
  assert.equal(config.vars?.PUBLIC_ORIGIN, '')
  assert.deepEqual(config.secrets?.required, ['TOKEN_HASH_PEPPER', 'ADMIN_SECRET'])
})

test('deploy workflow resolves Cloudflare state and preserves remote secrets without secret-put redeploys', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  assert.match(workflow, /if:\s*github\.repository\s*==\s*'NolaneAI\/Nolane-social-web'/)
  assert.match(workflow, /node tools\/prepare-cloudflare-deploy\.mjs/)
  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_D1_DATABASE_ID/)
  assert.match(workflow, /NOLANE_SECRETS_FILE/)
  assert.match(workflow, /wrangler deploy --config \.wrangler\.generated\.jsonc/)
  assert.match(workflow, /--secrets-file/)
  assert.doesNotMatch(workflow, /wrangler secret put/)
})

test('deployment preflight can discover or create D1 without a repository D1 id secret', async () => {
  const moduleUrl = new URL('../tools/prepare-cloudflare-deploy.mjs', import.meta.url)
  const preflight = await import(moduleUrl).catch(() => null)
  assert.ok(preflight, 'deployment preflight module should exist')

  const existingId = '123e4567-e89b-42d3-a456-426614174000'
  const existingCalls = []
  const existing = await preflight.resolveD1Database({
    accountId: 'acct',
    apiToken: 'token',
    databaseName: 'nolane-social',
    fetchImpl: async (url, options = {}) => {
      existingCalls.push([String(url), options.method || 'GET'])
      return jsonResponse({ success: true, result: [{ uuid: existingId, name: 'nolane-social' }] })
    },
  })
  assert.equal(existing, existingId)
  assert.deepEqual(existingCalls.map((call) => call[1]), ['GET'])

  const createdId = '223e4567-e89b-42d3-a456-426614174000'
  const createCalls = []
  const created = await preflight.resolveD1Database({
    accountId: 'acct',
    apiToken: 'token',
    databaseName: 'nolane-social',
    fetchImpl: async (url, options = {}) => {
      createCalls.push([String(url), options.method || 'GET'])
      if ((options.method || 'GET') === 'POST') {
        return jsonResponse({ success: true, result: { uuid: createdId, name: 'nolane-social' } })
      }
      return jsonResponse({ success: true, result: [] })
    },
  })
  assert.equal(created, createdId)
  assert.deepEqual(createCalls.map((call) => call[1]), ['GET', 'POST'])
})

test('deployment preflight renames the existing Worker in place by immutable id', async () => {
  const preflight = await import(new URL('../tools/prepare-cloudflare-deploy.mjs', import.meta.url))
  assert.equal(typeof preflight.ensureWorkerName, 'function')

  const calls = []
  const result = await preflight.ensureWorkerName({
    accountId: 'acct',
    apiToken: 'token',
    desiredName: 'social',
    legacyName: 'nolane-social-web',
    fetchImpl: async (url, options = {}) => {
      const href = String(url)
      const method = options.method || 'GET'
      calls.push({ href, method, body: options.body || '' })
      if (method === 'GET' && href.endsWith('/workers/workers/social')) {
        return jsonResponse({ success: false, errors: [{ message: 'not found' }] }, 404)
      }
      if (method === 'GET' && href.endsWith('/workers/workers/nolane-social-web')) {
        return jsonResponse({ success: true, result: { id: 'worker-stable-id', name: 'nolane-social-web' } })
      }
      if (method === 'PATCH' && href.endsWith('/workers/workers/worker-stable-id')) {
        return jsonResponse({ success: true, result: { id: 'worker-stable-id', name: 'social' } })
      }
      throw new Error(`unexpected request ${method} ${href}`)
    },
  })

  assert.deepEqual(result, { id: 'worker-stable-id', name: 'social', renamed: true })
  assert.deepEqual(calls.map(({ method, href }) => [method, new URL(href).pathname]), [
    ['GET', '/client/v4/accounts/acct/workers/workers/social'],
    ['GET', '/client/v4/accounts/acct/workers/workers/nolane-social-web'],
    ['PATCH', '/client/v4/accounts/acct/workers/workers/worker-stable-id'],
  ])
  assert.deepEqual(JSON.parse(calls[2].body), { name: 'social' })
})

test('deployment preflight fails closed if the short Worker name belongs to another Worker', async () => {
  const preflight = await import(new URL('../tools/prepare-cloudflare-deploy.mjs', import.meta.url))
  assert.equal(typeof preflight.ensureWorkerName, 'function')

  await assert.rejects(
    () => preflight.ensureWorkerName({
      accountId: 'acct',
      apiToken: 'token',
      desiredName: 'social',
      legacyName: 'nolane-social-web',
      fetchImpl: async (url) => {
        const href = String(url)
        if (href.endsWith('/workers/workers/social')) {
          return jsonResponse({ success: true, result: { id: 'other-worker-id', name: 'social' } })
        }
        if (href.endsWith('/workers/workers/nolane-social-web')) {
          return jsonResponse({ success: true, result: { id: 'nolane-worker-id', name: 'nolane-social-web' } })
        }
        throw new Error(`unexpected request ${href}`)
      },
    }),
    /already belongs to a different Worker/i,
  )
})

test('deployment preflight preserves remote Worker secrets and only uploads missing values', async () => {
  const moduleUrl = new URL('../tools/prepare-cloudflare-deploy.mjs', import.meta.url)
  const preflight = await import(moduleUrl).catch(() => null)
  assert.ok(preflight, 'deployment preflight module should exist')

  assert.deepEqual(
    preflight.planWorkerSecrets(['TOKEN_HASH_PEPPER', 'ADMIN_SECRET'], {}),
    { missing: [], upload: {} },
  )
  assert.deepEqual(
    preflight.planWorkerSecrets(['TOKEN_HASH_PEPPER'], { ADMIN_SECRET: 'operator-value' }),
    { missing: [], upload: { ADMIN_SECRET: 'operator-value' } },
  )
  assert.deepEqual(
    preflight.planWorkerSecrets([], {}),
    { missing: ['TOKEN_HASH_PEPPER', 'ADMIN_SECRET'], upload: {} },
  )
})
