import { fileURLToPath } from 'node:url'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const MAX_URLS = 1000

function cleanOrigin(origin) {
  const url = new URL(String(origin || ''))
  if (url.protocol !== 'https:') throw new Error('IndexNow origin must use HTTPS.')
  return url.origin
}

function canonicalUrls(origin, urls) {
  const result = []
  const seen = new Set()
  for (const value of Array.isArray(urls) ? urls : []) {
    if (result.length >= MAX_URLS) break
    try {
      const url = new URL(String(value), origin)
      if (url.origin !== origin || url.protocol !== 'https:') continue
      url.hash = ''
      const canonical = url.toString()
      if (seen.has(canonical)) continue
      seen.add(canonical)
      result.push(canonical)
    } catch {}
  }
  return result
}

export async function submitIndexNow({ origin, key, urls, fetchImpl = fetch }) {
  const base = cleanOrigin(origin)
  const configuredKey = String(key || '').trim()
  if (!configuredKey) return { submitted: false, reason: 'not_configured', urlCount: 0 }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(configuredKey)) return { submitted: false, reason: 'invalid_configuration', urlCount: 0 }

  const urlList = canonicalUrls(base, urls)
  if (urlList.length === 0) return { submitted: false, reason: 'no_urls', urlCount: 0 }

  try {
    const target = new URL(base)
    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: target.host,
        key: configuredKey,
        keyLocation: `${base}/indexnow-key.txt`,
        urlList,
      }),
    })
    if (!response.ok) return { submitted: false, reason: 'remote_error', status: response.status, urlCount: urlList.length }
    return { submitted: true, reason: 'accepted', status: response.status, urlCount: urlList.length }
  } catch {
    return { submitted: false, reason: 'network_error', urlCount: urlList.length }
  }
}

async function main() {
  const origin = process.env.NOLANE_PRODUCTION_ORIGIN || 'https://social.nolanestudioai.workers.dev'
  const key = process.env.INDEXNOW_KEY || ''
  const urls = process.argv.slice(2)
  const result = await submitIndexNow({ origin, key, urls })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
