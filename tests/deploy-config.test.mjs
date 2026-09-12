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

test('deploy workflow uploads code and Worker secrets atomically instead of secret-put redeploys', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  assert.match(workflow, /wrangler deploy --config \.wrangler\.generated\.jsonc --secrets-file/)
  assert.match(workflow, /RUNNER_TEMP/)
  assert.match(workflow, /if: github\.repository == 'NolaneAI\/Nolane-social-web'/)
  assert.doesNotMatch(workflow, /wrangler secret put/)
})
