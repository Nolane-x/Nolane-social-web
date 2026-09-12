import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_ROOT = 'https://api.cloudflare.com/client/v4'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUIRED_WORKER_SECRETS = ['TOKEN_HASH_PEPPER', 'ADMIN_SECRET']

function requiredText(value, name) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${name} is required`)
  return text
}

function databaseId(record) {
  const value = String(record?.uuid || record?.id || '').trim()
  if (!UUID_RE.test(value)) throw new Error('Cloudflare returned an invalid D1 database UUID')
  return value
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    throw new Error(`Cloudflare API returned a non-JSON response (${response.status})`)
  }
}

async function cloudflareRequest({ accountId, apiToken, pathname, method = 'GET', body, fetchImpl = fetch, allowNotFound = false }) {
  const url = `${API_ROOT}${pathname}`
  const headers = { Authorization: `Bearer ${apiToken}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetchImpl(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (allowNotFound && response.status === 404) return null
  const payload = await readJson(response)
  if (!response.ok || payload?.success === false) {
    const message = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.message || error?.code).filter(Boolean).join('; ')
      : ''
    throw new Error(`Cloudflare API ${method} ${pathname} failed (${response.status})${message ? `: ${message}` : ''}`)
  }
  return payload
}

export async function resolveD1Database({ accountId, apiToken, databaseName, fetchImpl = fetch }) {
  const account = requiredText(accountId, 'CLOUDFLARE_ACCOUNT_ID')
  const token = requiredText(apiToken, 'CLOUDFLARE_API_TOKEN')
  const name = requiredText(databaseName, 'databaseName')
  const collectionPath = `/accounts/${encodeURIComponent(account)}/d1/database`
  const list = await cloudflareRequest({
    accountId: account,
    apiToken: token,
    pathname: `${collectionPath}?name=${encodeURIComponent(name)}&per_page=50`,
    fetchImpl,
  })
  const matches = (Array.isArray(list?.result) ? list.result : []).filter((entry) => entry?.name === name)
  if (matches.length > 1) throw new Error(`Multiple D1 databases named ${name} were returned`)
  if (matches.length === 1) return databaseId(matches[0])

  const created = await cloudflareRequest({
    accountId: account,
    apiToken: token,
    pathname: collectionPath,
    method: 'POST',
    body: { name },
    fetchImpl,
  })
  return databaseId(created?.result)
}

export async function ensureWorkerName({ accountId, apiToken, desiredName, legacyName, fetchImpl = fetch }) {
  const account = requiredText(accountId, 'CLOUDFLARE_ACCOUNT_ID')
  const token = requiredText(apiToken, 'CLOUDFLARE_API_TOKEN')
  const desired = requiredText(desiredName, 'desiredName')
  const legacy = requiredText(legacyName, 'legacyName')
  if (desired === legacy) throw new Error('desiredName must differ from legacyName')

  const workerPath = (nameOrId) => `/accounts/${encodeURIComponent(account)}/workers/workers/${encodeURIComponent(nameOrId)}`
  const [desiredPayload, legacyPayload] = await Promise.all([
    cloudflareRequest({ accountId: account, apiToken: token, pathname: workerPath(desired), fetchImpl, allowNotFound: true }),
    cloudflareRequest({ accountId: account, apiToken: token, pathname: workerPath(legacy), fetchImpl, allowNotFound: true }),
  ])

  const desiredWorker = desiredPayload?.result || null
  const legacyWorker = legacyPayload?.result || null
  const desiredId = String(desiredWorker?.id || '').trim()
  const legacyId = String(legacyWorker?.id || '').trim()

  if (desiredWorker && legacyWorker && desiredId !== legacyId) {
    throw new Error(`Worker name ${desired} already belongs to a different Worker; refusing to overwrite it`)
  }

  if (desiredWorker) {
    if (!desiredId) throw new Error(`Cloudflare returned Worker ${desired} without an immutable id`)
    return { id: desiredId, name: desired, renamed: false }
  }

  if (!legacyWorker) {
    return { id: '', name: desired, renamed: false }
  }

  if (!legacyId) throw new Error(`Cloudflare returned Worker ${legacy} without an immutable id`)
  const renamedPayload = await cloudflareRequest({
    accountId: account,
    apiToken: token,
    pathname: workerPath(legacyId),
    method: 'PATCH',
    body: { name: desired },
    fetchImpl,
  })
  const renamedWorker = renamedPayload?.result || null
  const renamedId = String(renamedWorker?.id || '').trim()
  const renamedName = String(renamedWorker?.name || '').trim()
  if (renamedId !== legacyId || renamedName !== desired) {
    throw new Error(`Cloudflare did not confirm the in-place Worker rename from ${legacy} to ${desired}`)
  }
  return { id: renamedId, name: renamedName, renamed: true }
}

export function planWorkerSecrets(remoteNames, localSecrets = {}) {
  const remote = new Set((remoteNames || []).map((name) => String(name)))
  const missing = []
  const upload = {}
  for (const name of REQUIRED_WORKER_SECRETS) {
    if (remote.has(name)) continue
    const value = localSecrets?.[name]
    if (typeof value === 'string' && value.length > 0) upload[name] = value
    else missing.push(name)
  }
  return { missing, upload }
}

export async function listWorkerSecretNames({ accountId, apiToken, workerName, fetchImpl = fetch }) {
  const account = requiredText(accountId, 'CLOUDFLARE_ACCOUNT_ID')
  const token = requiredText(apiToken, 'CLOUDFLARE_API_TOKEN')
  const script = requiredText(workerName, 'workerName')
  const payload = await cloudflareRequest({
    accountId: account,
    apiToken: token,
    pathname: `/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(script)}/secrets`,
    fetchImpl,
    allowNotFound: true,
  })
  if (!payload) return []
  return (Array.isArray(payload.result) ? payload.result : [])
    .map((secret) => secret?.name)
    .filter((name) => typeof name === 'string' && name.length > 0)
}

function appendGithubEnv(file, values) {
  const lines = Object.entries(values).map(([name, value]) => `${name}=${String(value)}\n`).join('')
  fs.appendFileSync(file, lines)
}

async function main() {
  const accountId = requiredText(process.env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID')
  const apiToken = requiredText(process.env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN')
  const githubEnv = requiredText(process.env.GITHUB_ENV, 'GITHUB_ENV')
  const runnerTemp = requiredText(process.env.RUNNER_TEMP, 'RUNNER_TEMP')
  const databaseName = 'nolane-social'
  const workerName = 'social'
  const legacyWorkerName = 'nolane-social-web'

  const worker = await ensureWorkerName({
    accountId,
    apiToken,
    desiredName: workerName,
    legacyName: legacyWorkerName,
  })
  const d1Id = await resolveD1Database({ accountId, apiToken, databaseName })
  const remoteSecretNames = await listWorkerSecretNames({ accountId, apiToken, workerName })
  const plan = planWorkerSecrets(remoteSecretNames, {
    TOKEN_HASH_PEPPER: process.env.TOKEN_HASH_PEPPER || '',
    ADMIN_SECRET: process.env.ADMIN_SECRET || '',
  })

  if (plan.missing.length) {
    throw new Error(`Missing required Worker secrets in Cloudflare and GitHub Actions: ${plan.missing.join(', ')}`)
  }

  let secretsFile = ''
  if (Object.keys(plan.upload).length) {
    secretsFile = path.join(runnerTemp, 'nolane-social-secrets.json')
    fs.writeFileSync(secretsFile, JSON.stringify(plan.upload), { mode: 0o600 })
  }

  appendGithubEnv(githubEnv, {
    CLOUDFLARE_D1_DATABASE_ID: d1Id,
    NOLANE_SECRETS_FILE: secretsFile,
  })
  process.stdout.write(`Cloudflare preflight ready: Worker=${worker.name}${worker.renamed ? ' (renamed in place)' : ''}; D1=${databaseName}; remote Worker secrets preserved=${remoteSecretNames.length}; uploads=${Object.keys(plan.upload).length}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
