import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { renderWranglerConfig } from '../tools/prepare-wrangler.mjs'

const source = '{"d1_databases":[{"database_id":"__CLOUDFLARE_D1_DATABASE_ID__"}]}'

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

test('production Wrangler config declares security-critical Worker secrets as required', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))
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
      return new Response(JSON.stringify({ success: true, result: [{ uuid: existingId, name: 'nolane-social' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
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
        return new Response(JSON.stringify({ success: true, result: { uuid: createdId, name: 'nolane-social' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, result: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.equal(created, createdId)
  assert.deepEqual(createCalls.map((call) => call[1]), ['GET', 'POST'])
})

test('deployment preflight provisions missing Worker secrets without replacing existing values', async () => {
  const preflight = await import(new URL('../tools/prepare-cloudflare-deploy.mjs', import.meta.url))
  const generated = []
  const secretFactory = (name) => {
    generated.push(name)
    return `generated-${name}`
  }

  assert.deepEqual(
    preflight.planWorkerSecrets(['TOKEN_HASH_PEPPER', 'ADMIN_SECRET'], {}, secretFactory),
    { missing: [], upload: {} },
  )
  assert.deepEqual(generated, [])

  assert.deepEqual(
    preflight.planWorkerSecrets([], { ADMIN_SECRET: 'operator-value' }, secretFactory),
    {
      missing: [],
      upload: {
        TOKEN_HASH_PEPPER: 'generated-TOKEN_HASH_PEPPER',
        ADMIN_SECRET: 'operator-value',
      },
    },
  )
  assert.deepEqual(generated, ['TOKEN_HASH_PEPPER'])
})

test('generated Worker secrets are independent high-entropy base64url values', async () => {
  const preflight = await import(new URL('../tools/prepare-cloudflare-deploy.mjs', import.meta.url))
  const first = preflight.generateWorkerSecret()
  const second = preflight.generateWorkerSecret()
  assert.match(first, /^[A-Za-z0-9_-]{64}$/)
  assert.match(second, /^[A-Za-z0-9_-]{64}$/)
  assert.notEqual(first, second)
})
