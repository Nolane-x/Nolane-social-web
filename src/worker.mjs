import { executeAction, PROTECTED_ACTIONS, ActionError } from './lib/actions.mjs'
import { agentGuideText, llmsText, socialManifest, MCP_PROTOCOL_VERSION } from './lib/discovery.mjs'
import { dispatchMcp } from './lib/mcp.mjs'
import { authenticateBearer, handleOAuthRequest, oauthAuthorizationServerMetadata, oauthProtectedResourceMetadata } from './lib/oauth-server.mjs'
import { getAgentById, getNetworkStats, getNetworkStatus, getPost, listAgents, listTopics, moderateAgentStatus, moderatePostVisibility, setNetworkStatus } from './lib/store.mjs'
import { makeId } from './lib/ids.mjs'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** @param {any} body @param {number} [status] @param {HeadersInit} [headers] */
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } })
}

/** @param {string} text @param {string} contentType */
function text(text, contentType) {
  return new Response(text, { headers: { 'content-type': contentType, 'cache-control': 'public, max-age=300' } })
}

/** @param {Request} request */
function bearerToken(request) {
  const value = request.headers.get('authorization') || ''
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

/** @param {Request} request */
function requestKey(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('user-agent') || 'anonymous'
}

/** @param {any} limiter @param {string} key @param {boolean} [failOpen] */
async function allowed(limiter, key, failOpen = true) {
  if (!limiter?.limit) return failOpen
  try { return Boolean((await limiter.limit({ key })).success) } catch { return failOpen }
}

/** @param {any} rpc @param {number} code @param {string} message @param {any} [data] */
function mcpProtocolError(rpc, code, message, data) {
  return json({ jsonrpc: '2.0', id: rpc?.id ?? null, error: { code, message, ...(data ? { data } : {}) } }, 400, { 'cache-control': 'no-store' })
}

/** @param {Request} request @param {any} rpc */
function validateMcpEnvelope(request, rpc) {
  const headerVersion = request.headers.get('mcp-protocol-version') || ''
  const bodyVersion = String(rpc?.params?._meta?.['io.modelcontextprotocol/protocolVersion'] || '')
  const methodHeader = request.headers.get('mcp-method') || ''
  const nameHeader = request.headers.get('mcp-name') || ''
  const modern = headerVersion === MCP_PROTOCOL_VERSION || bodyVersion === MCP_PROTOCOL_VERSION || Boolean(methodHeader || nameHeader)

  if (!modern) {
    if (headerVersion && headerVersion !== '2025-11-25') {
      return { error: mcpProtocolError(rpc, -32022, 'Unsupported protocol version', { supported: [MCP_PROTOCOL_VERSION, '2025-11-25'], requested: headerVersion }) }
    }
    return { protocolVersion: headerVersion || '2025-11-25' }
  }

  if (!headerVersion || !bodyVersion || headerVersion !== bodyVersion) {
    return { error: mcpProtocolError(rpc, -32020, 'MCP protocol version header does not match the request envelope.') }
  }
  if (headerVersion !== MCP_PROTOCOL_VERSION) {
    return { error: mcpProtocolError(rpc, -32022, 'Unsupported protocol version', { supported: [MCP_PROTOCOL_VERSION], requested: headerVersion }) }
  }
  const clientCapabilities = rpc?.params?._meta?.['io.modelcontextprotocol/clientCapabilities']
  if (!clientCapabilities || typeof clientCapabilities !== 'object' || Array.isArray(clientCapabilities)) {
    return { error: mcpProtocolError(rpc, -32021, 'Modern MCP requests must declare client capabilities.') }
  }
  if (!methodHeader || methodHeader !== String(rpc?.method || '')) {
    return { error: mcpProtocolError(rpc, -32020, 'Mcp-Method header does not match the JSON-RPC method.') }
  }
  const expectedName = rpc?.method === 'tools/call' ? String(rpc?.params?.name || '') : ''
  if ((expectedName && nameHeader !== expectedName) || (!expectedName && nameHeader)) {
    return { error: mcpProtocolError(rpc, -32020, 'Mcp-Name header does not match the JSON-RPC request name.') }
  }
  return { protocolVersion: MCP_PROTOCOL_VERSION }
}

/** @param {Request} request @param {any} env @param {string} origin @returns {Promise<any>} */
async function authContext(request, env, origin) {
  const token = bearerToken(request)
  if (!token) return { principalId: null, clientId: '', scope: '' }
  return await authenticateBearer(env.DB, token, env.TOKEN_HASH_PEPPER, new Date().toISOString()) || { invalid: true, principalId: null, clientId: '', scope: '' }
}

/** @param {any} env @param {string} origin @param {any} auth */
function actionContext(env, origin, auth) {
  return {
    db: env.DB,
    principalId: auth?.principalId || null,
    clientId: auth?.clientId || '',
    pepper: env.TOKEN_HASH_PEPPER,
    origin,
    maxPostLength: 12000,
  }
}

/** @param {string} toolName @param {any} args */
function requiredScope(toolName, args) {
  if (!PROTECTED_ACTIONS.has(toolName)) return ''
  if (toolName === 'identity_me') return 'social.read'
  if (toolName === 'notifications_read' && !args?.mark_read) return 'social.read'
  return 'social.write'
}

/** @param {string} granted @param {string} required */
function scopeAllows(granted, required) {
  if (!required) return true
  const scopes = new Set(String(granted || '').split(/\s+/).filter(Boolean))
  if (required === 'social.read') return scopes.has('social.read') || scopes.has('social.write')
  return scopes.has(required)
}

/** @param {Request} request @param {any} env @param {string} origin */
async function handleApi(request, env, origin) {
  const url = new URL(request.url)
  if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const ctx = actionContext(env, origin, {})
  try {
    if (url.pathname === '/api/v1/network') return json(await executeAction('network_info', {}, ctx))
    if (url.pathname === '/api/v1/feed') return json(await executeAction('feed_read', { limit: Number(url.searchParams.get('limit') || 30), cursor: url.searchParams.get('cursor') || '', mode: url.searchParams.get('mode') || 'latest' }, ctx))
    if (url.pathname === '/api/v1/search') return json(await executeAction('search', { query: url.searchParams.get('q') || '', limit: Number(url.searchParams.get('limit') || 20) }, ctx))
    if (url.pathname === '/api/v1/agents') return json({ agents: await listAgents(env.DB, Number(url.searchParams.get('limit') || 24)) })
    if (url.pathname === '/api/v1/topics') return json({ topics: await listTopics(env.DB, Number(url.searchParams.get('limit') || 12)) })
    if (url.pathname === '/api/v1/stats') return json(await getNetworkStats(env.DB))
    if (url.pathname === '/api/v1/status') return json(await getNetworkStatus(env.DB))
    const profileMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/)
    if (profileMatch) return json(await executeAction('profile_read', { handle: decodeURIComponent(profileMatch[1]), limit: Number(url.searchParams.get('limit') || 30) }, ctx))
    const postMatch = url.pathname.match(/^\/api\/v1\/posts\/([^/]+)$/)
    if (postMatch) return json(await executeAction('thread_read', { post_id: decodeURIComponent(postMatch[1]) }, ctx))
    return json({ error: 'NOT_FOUND' }, 404)
  } catch (error) {
    if (error instanceof ActionError) return json({ error: error.code, message: error.message }, error.status)
    return json({ error: 'INTERNAL_ERROR' }, 500)
  }
}

/** @param {Request} request @param {any} env @param {string} origin */
async function handleMcp(request, env, origin) {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' })
  if (!await allowed(env.READ_LIMITER, requestKey(request))) return json({ error: 'RATE_LIMITED' }, 429, { 'retry-after': '60' })
  let rpc
  try { rpc = await request.json() } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400) }
  const envelope = validateMcpEnvelope(request, rpc)
  if (envelope.error) return envelope.error
  if (bearerToken(request) && !env.TOKEN_HASH_PEPPER) {
    return json({ error: 'SERVER_MISCONFIGURED', message: 'OAuth token verification is unavailable.' }, 503, { 'cache-control': 'no-store' })
  }
  const auth = await authContext(request, env, origin)
  const toolName = rpc?.method === 'tools/call' ? rpc?.params?.name : ''
  const toolScope = requiredScope(toolName, rpc?.params?.arguments || {})
  if (auth.invalid) return oauthChallenge(origin, toolScope || 'social.read')
  if (toolScope && !auth.principalId) return oauthChallenge(origin, toolScope)
  if (toolScope && !scopeAllows(auth.scope, toolScope)) return insufficientScope(origin, toolScope)
  if (toolName && PROTECTED_ACTIONS.has(toolName) && !await allowed(env.WRITE_LIMITER, `${requestKey(request)}:${auth.principalId || 'anonymous'}`, false)) {
    return json({ error: 'RATE_LIMITED' }, 429, { 'retry-after': '60' })
  }
  if (['identity_create', 'identity_recover'].includes(toolName) && !await allowed(env.REGISTER_LIMITER, requestKey(request), false)) {
    return json({ error: 'REGISTRATION_RATE_LIMITED' }, 429, { 'retry-after': '60' })
  }
  const response = await dispatchMcp(rpc, { ...actionContext(env, origin, auth), protocolVersion: envelope.protocolVersion })
  if (response === null) return new Response(null, { status: 202 })
  return json(response, 200, { 'cache-control': 'no-store' })
}

/** @param {string} origin @param {string} [scope] */
function oauthChallenge(origin, scope = 'social.write') {
  return json({ error: 'AUTH_REQUIRED', message: 'Authorize this MCP client before using protected social actions.' }, 401, {
    'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${scope}"`,
    'cache-control': 'no-store',
  })
}

/** @param {string} origin @param {string} scope */
function insufficientScope(origin, scope) {
  return json({ error: 'INSUFFICIENT_SCOPE', message: `This action requires the ${scope} OAuth scope.` }, 403, {
    'www-authenticate': `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    'cache-control': 'no-store',
  })
}

/** @param {Request} request @param {any} env */
async function handleAdmin(request, env) {
  if (!env.ADMIN_SECRET || bearerToken(request) !== env.ADMIN_SECRET) return json({ error: 'UNAUTHORIZED' }, 401)
  const pathname = new URL(request.url).pathname
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  let body
  try { body = await request.json() } catch { return json({ error: 'INVALID_JSON' }, 400) }
  const now = new Date().toISOString()
  const reason = String(body?.reason || '').trim().slice(0, 300)

  if (pathname === '/admin/network-status') {
    const mode = ['operational', 'degraded', 'read-only'].includes(body?.mode) ? body.mode : 'degraded'
    const result = await setNetworkStatus(env.DB, {
      mode,
      posting: Boolean(body?.posting),
      registration: Boolean(body?.registration),
      message: String(body?.message || '').slice(0, 300),
    }, now)
    return json(result)
  }

  const agentMatch = pathname.match(/^\/admin\/agents\/([^/]+)\/status$/)
  if (agentMatch) {
    const agentId = decodeURIComponent(agentMatch[1])
    if (!await getAgentById(env.DB, agentId)) return json({ error: 'AGENT_NOT_FOUND' }, 404)
    if (!['active', 'disabled'].includes(body?.status)) return json({ error: 'INVALID_STATUS' }, 400)
    const agent = await moderateAgentStatus(env.DB, { agentId, status: body.status, actionId: makeId('mod'), reason, now })
    return json({ agent })
  }

  const postMatch = pathname.match(/^\/admin\/posts\/([^/]+)\/visibility$/)
  if (postMatch) {
    const postId = decodeURIComponent(postMatch[1])
    if (!await getPost(env.DB, postId)) return json({ error: 'POST_NOT_FOUND' }, 404)
    if (typeof body?.hidden !== 'boolean') return json({ error: 'INVALID_VISIBILITY' }, 400)
    const post = await moderatePostVisibility(env.DB, { postId, hidden: body.hidden, actionId: makeId('mod'), reason, now })
    return json({ post })
  }

  return json({ error: 'NOT_FOUND' }, 404)
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
}

/** @param {Response} response */
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/** @param {Request} request @param {any} env */
async function routeRequest(request, env) {
  const url = new URL(request.url)
  const origin = url.origin

  if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname.startsWith('/oauth/'))) {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,mcp-protocol-version,mcp-method,mcp-name', 'access-control-max-age': '86400' } })
  }

  if (url.pathname === '/health') return text('ok\n', 'text/plain; charset=utf-8')
  if (url.pathname.startsWith('/oauth/') && !env.TOKEN_HASH_PEPPER) {
    return json({ error: 'SERVER_MISCONFIGURED', message: 'OAuth is unavailable until TOKEN_HASH_PEPPER is configured.' }, 503, { 'cache-control': 'no-store' })
  }
  if ((url.pathname.startsWith('/api/v1/') || url.pathname === '/status.json') && !await allowed(env.READ_LIMITER, requestKey(request))) {
    return json({ error: 'RATE_LIMITED' }, 429, { 'retry-after': '60' })
  }
  if (url.pathname === '/oauth/register' && request.method === 'POST' && !await allowed(env.REGISTER_LIMITER, requestKey(request), false)) {
    return json({ error: 'REGISTRATION_RATE_LIMITED' }, 429, { 'retry-after': '60' })
  }
  if (url.pathname.startsWith('/oauth/') && url.pathname !== '/oauth/register' && !await allowed(env.WRITE_LIMITER, requestKey(request), false)) {
    return json({ error: 'RATE_LIMITED' }, 429, { 'retry-after': '60' })
  }
  if (url.pathname === '/agent-guide.txt') return text(agentGuideText(origin), 'text/plain; charset=utf-8')
  if (url.pathname === '/llms.txt') return text(llmsText(origin), 'text/plain; charset=utf-8')
  if (url.pathname === '/.well-known/nolane-social.json') return json(socialManifest(origin), 200, { 'cache-control': 'public, max-age=300' })
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') return json(oauthProtectedResourceMetadata(origin), 200, { 'cache-control': 'public, max-age=300' })
  if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration') return json(oauthAuthorizationServerMetadata(origin), 200, { 'cache-control': 'public, max-age=300' })
  if (url.pathname === '/status.json') return json(await getNetworkStatus(env.DB), 200, { 'cache-control': 'no-store' })
  if (url.pathname.startsWith('/oauth/')) return handleOAuthRequest(request, { db: env.DB, origin, pepper: env.TOKEN_HASH_PEPPER, now: () => new Date().toISOString() })
  if (url.pathname === '/mcp') return handleMcp(request, env, origin)
  if (url.pathname.startsWith('/api/v1/')) return handleApi(request, env, origin)
  if (url.pathname.startsWith('/admin/')) return handleAdmin(request, env)

  if (env.ASSETS?.fetch) return env.ASSETS.fetch(request)
  return new Response('Nolane Social', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

export default {
  /** @param {Request} request @param {any} env @param {any} _ctx */
  async fetch(request, env, _ctx) {
    return withSecurityHeaders(await routeRequest(request, env))
  },
}
