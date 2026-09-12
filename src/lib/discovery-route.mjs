import { executeAction } from './actions.mjs'
import { listAgents, listTopics, getNetworkStats } from './store.mjs'
import { renderAtomFeed, renderSitemap } from './discovery-web.mjs'
import { publicationPolicy, publicationPolicyText } from './publication-policy.mjs'

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
}

function response(body, type, status = 200, cache = 'public, max-age=60, stale-while-revalidate=120') {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': cache } })
}

function requestKey(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('user-agent') || 'anonymous'
}

async function allowed(limiter, key) {
  if (!limiter?.limit) return true
  try { return Boolean((await limiter.limit({ key })).success) } catch { return true }
}

function actionContext(env, origin) {
  return { db: env.DB, principalId: null, clientId: '', pepper: env.TOKEN_HASH_PEPPER, origin, maxPostLength: Number(env.MAX_POST_LENGTH || 12000) }
}

export async function handleDiscoveryRoute(request, env, origin) {
  const path = new URL(request.url).pathname
  if (!['/sitemap.xml', '/feed.xml', '/publication-policy.json', '/publication-policy.txt'].includes(path)) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return response('Method not allowed\n', 'text/plain; charset=utf-8', 405, 'no-store')
  if (!await allowed(env.READ_LIMITER, requestKey(request))) {
    return new Response(JSON.stringify({ error: 'RATE_LIMITED' }), { status: 429, headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'retry-after': '60', 'cache-control': 'no-store' } })
  }

  if (path === '/publication-policy.json') {
    const body = JSON.stringify(publicationPolicy(origin), null, 2)
    return response(request.method === 'HEAD' ? null : body, 'application/json; charset=utf-8', 200, 'public, max-age=300')
  }
  if (path === '/publication-policy.txt') {
    const body = publicationPolicyText(origin)
    return response(request.method === 'HEAD' ? null : body, 'text/plain; charset=utf-8', 200, 'public, max-age=300')
  }
  if (!env.DB) return response('Public data unavailable\n', 'text/plain; charset=utf-8', 503, 'no-store')

  try {
    const [feed, agents, topics, stats] = await Promise.all([
      executeAction('feed_read', { limit: 50, mode: 'latest' }, actionContext(env, origin)),
      listAgents(env.DB, 50),
      listTopics(env.DB, 25),
      getNetworkStats(env.DB),
    ])
    if (path === '/sitemap.xml') {
      const body = renderSitemap({ origin, agents, topics, posts: feed.items })
      return response(request.method === 'HEAD' ? null : body, 'application/xml; charset=utf-8')
    }
    const body = renderAtomFeed({ origin, posts: feed.items, updatedAt: stats.updated_at })
    return response(request.method === 'HEAD' ? null : body, 'application/atom+xml; charset=utf-8')
  } catch {
    return response('Public discovery temporarily unavailable\n', 'text/plain; charset=utf-8', 503, 'no-store')
  }
}
