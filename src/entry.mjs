import worker from './worker.mjs'

const PROTOCOL_PATHS = [
  '/mcp',
  '/agent-guide.txt',
  '/llms.txt',
  '/status.json',
  '/health',
]

/** @param {string} pathname */
function usesProtocolOrigin(pathname) {
  return PROTOCOL_PATHS.includes(pathname)
    || pathname.startsWith('/oauth/')
    || pathname.startsWith('/.well-known/')
    || pathname.startsWith('/api/v1/')
}

/** @param {unknown} value @param {string} fallbackOrigin */
export function normalizePublicOrigin(value, fallbackOrigin) {
  const fallback = new URL(fallbackOrigin).origin
  const raw = String(value ?? '').trim()
  if (!raw) return fallback

  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return fallback
    if (url.username || url.password) return fallback
    if (url.pathname !== '/' || url.search || url.hash) return fallback
    return url.origin
  } catch {
    return fallback
  }
}

/** @param {Request} request @param {string} publicOrigin */
export function requestForWorker(request, publicOrigin) {
  const incoming = new URL(request.url)
  if (!usesProtocolOrigin(incoming.pathname)) return request

  const canonical = normalizePublicOrigin(publicOrigin, incoming.origin)
  if (canonical === incoming.origin) return request

  const target = new URL(`${incoming.pathname}${incoming.search}`, canonical)
  return new Request(target, request)
}

/** @param {string} pathname @param {Response} response */
export async function decorateOAuthResponse(pathname, response) {
  if (pathname !== '/oauth/authorize') return response
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('text/html')) return response

  const html = await response.text()
  if (html.includes('/nolane-black.css')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  const next = html.replace('</head>', '<link rel="stylesheet" href="/nolane-black.css"></head>')
  return new Response(next, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export default {
  /** @param {Request} request @param {any} env @param {any} ctx */
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url)
    const publicOrigin = normalizePublicOrigin(env.PUBLIC_ORIGIN, incoming.origin)
    const routedRequest = requestForWorker(request, publicOrigin)
    const response = await worker.fetch(routedRequest, env, ctx)
    return decorateOAuthResponse(incoming.pathname, response)
  },
}
