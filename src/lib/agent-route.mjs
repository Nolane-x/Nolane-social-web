import { executeAction } from './actions.mjs'
import { renderAgentView } from './agent-web.mjs'
import { getNetworkStats, getNetworkStatus, listAgents, listTopics } from './store.mjs'

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
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', allow: 'GET, HEAD' },
    })
  }

  if (!await readAllowed(env.READ_LIMITER, requestKey(request))) {
    return new Response(JSON.stringify({ error: 'RATE_LIMITED' }), {
      status: 429,
      headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '60' },
    })
  }

  if (!env.DB) {
    return new Response('Nolane Social public data is temporarily unavailable.\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
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
    return new Response(request.method === 'HEAD' ? null : html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=30, stale-while-revalidate=60',
      },
    })
  } catch {
    return new Response('Nolane Social public snapshot is temporarily unavailable.\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
