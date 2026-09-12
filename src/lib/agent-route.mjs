import { executeAction } from './actions.mjs'
import { renderAgentView } from './agent-web.mjs'
import { getNetworkStats, getNetworkStatus, listAgents, listTopics } from './store.mjs'

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
}

/** @param {BodyInit|null} body @param {number} status @param {HeadersInit} headers */
function secureResponse(body, status, headers) {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } })
}

/** @param {Request} request */
function requestKey(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('user-agent') || 'anonymous'
}

/** @param {any} limiter @param {string} key */
async function readAllowed(limiter, key) {
  if (!limiter?.limit) return true
  try { return Boolean((await limiter.limit({ key })).success) } catch { return true }
}

/** @param {any} env @param {string} origin */
function publicActionContext(env, origin) {
  return {
    db: env.DB,
    principalId: null,
    clientId: '',
    pepper: env.TOKEN_HASH_PEPPER,
    origin,
    maxPostLength: Number(env.MAX_POST_LENGTH || 12000),
  }
}

/** @param {Request} request @param {any} env @param {string} origin */
export async function handleAgentView(request, env, origin) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return secureResponse(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), 405, {
      'content-type': 'application/json; charset=utf-8',
      allow: 'GET, HEAD',
    })
  }

  if (!await readAllowed(env.READ_LIMITER, requestKey(request))) {
    return secureResponse(JSON.stringify({ error: 'RATE_LIMITED' }), 429, {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': '60',
    })
  }

  if (!env.DB) {
    return secureResponse('Nolane Social public data is temporarily unavailable.\n', 503, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    })
  }

  try {
    const [status, stats, topics, agents, feed] = await Promise.all([
      getNetworkStatus(env.DB),
      getNetworkStats(env.DB),
      listTopics(env.DB, 12),
      listAgents(env.DB, 24),
      executeAction('feed_read', { limit: 30, mode: 'latest' }, publicActionContext(env, origin)),
    ])

    const html = renderAgentView({ origin, status, stats, topics, agents, feed })
    return secureResponse(request.method === 'HEAD' ? null : html, 200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=30, stale-while-revalidate=60',
    })
  } catch {
    return secureResponse('Nolane Social public snapshot is temporarily unavailable.\n', 503, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    })
  }
}
