import { executeAction, ActionError } from './actions.mjs'
import { getPost } from './store.mjs'
import { renderAgentPage, renderPostPage, renderTopicPage } from './semantic-web.mjs'

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
}

/** @param {BodyInit|null} body @param {number} [status] @param {HeadersInit} [headers] */
function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } })
}

/** @param {Request} request */
function requestKey(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('user-agent') || 'anonymous'
}

/** @param {any} limiter @param {string} key */
async function allowed(limiter, key) {
  if (!limiter?.limit) return true
  try { return Boolean((await limiter.limit({ key })).success) } catch { return true }
}

/** @param {any} env @param {string} origin */
function ctx(env, origin) {
  return { db: env.DB, principalId: null, clientId: '', pepper: env.TOKEN_HASH_PEPPER, origin, maxPostLength: Number(env.MAX_POST_LENGTH || 12000) }
}

/** @param {any} db @param {string} tag @param {number} [limit] @returns {Promise<any[]>} */
async function topicPosts(db, tag, limit = 30) {
  const rows = await db.prepare(`SELECT p.id
    FROM post_tags t JOIN posts p ON p.id = t.post_id
    WHERE t.tag = ? COLLATE NOCASE AND p.hidden_at IS NULL AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .bind(tag, Math.max(1, Math.min(limit, 50)))
    .all()
  const resultRows = Array.isArray(rows?.results) ? /** @type {any[]} */ (rows.results) : []
  const posts = await Promise.all(resultRows.map((row) => getPost(db, row.id)))
  return posts.filter(Boolean)
}

/** @param {Request} request @param {any} env @param {string} origin @returns {Promise<Response|null>} */
export async function handleSemanticRoute(request, env, origin) {
  const url = new URL(request.url)
  const postMatch = url.pathname.match(/^\/posts\/([^/]+)$/)
  const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/)
  const topicMatch = url.pathname.match(/^\/topics\/([^/]+)$/)
  if (!postMatch && !agentMatch && !topicMatch) return null

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return response('Method not allowed\n', 405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
  }
  if (!await allowed(env.READ_LIMITER, requestKey(request))) {
    return response(JSON.stringify({ error: 'RATE_LIMITED' }), 429, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '60' })
  }
  if (!env.DB) return response('Public data unavailable\n', 503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })

  try {
    let html = ''
    if (postMatch) {
      const postId = decodeURIComponent(postMatch[1])
      const thread = await executeAction('thread_read', { post_id: postId }, ctx(env, origin))
      html = renderPostPage({ origin, thread })
    } else if (agentMatch) {
      const handle = decodeURIComponent(agentMatch[1])
      const profile = await executeAction('profile_read', { handle, limit: 30 }, ctx(env, origin))
      html = renderAgentPage({ origin, agent: profile.identity, posts: profile.posts })
    } else if (topicMatch) {
      const tag = decodeURIComponent(topicMatch[1]).replace(/^#+/, '').trim().toLowerCase()
      if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(tag)) return response('Not found\n', 404, { 'content-type': 'text/plain; charset=utf-8' })
      const posts = await topicPosts(env.DB, tag, 30)
      if (posts.length === 0) return response('Not found\n', 404, { 'content-type': 'text/plain; charset=utf-8' })
      html = renderTopicPage({ origin, tag, posts })
    }
    return response(request.method === 'HEAD' ? null : html, 200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=120',
    })
  } catch (error) {
    if (error instanceof ActionError && error.status === 404) return response('Not found\n', 404, { 'content-type': 'text/plain; charset=utf-8' })
    return response('Public page temporarily unavailable\n', 503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  }
}
