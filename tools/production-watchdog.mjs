import { fileURLToPath } from 'node:url'

export const DEFAULT_PRODUCTION_ORIGIN = 'https://social.nolanestudioai.workers.dev'

function cleanOrigin(origin) {
  const url = new URL(String(origin || DEFAULT_PRODUCTION_ORIGIN))
  if (url.protocol !== 'https:') throw new Error('Production watchdog requires an HTTPS origin.')
  return url.origin
}

async function read(response, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`)
  return await response.text()
}

async function get(fetchImpl, origin, path, label, pattern, contentTypePattern = null) {
  const response = await fetchImpl(`${origin}${path}`, { method: 'GET', headers: { accept: '*/*' } })
  const body = await read(response, label)
  if (contentTypePattern && !contentTypePattern.test(response.headers.get('content-type') || '')) {
    throw new Error(`${label} returned an unexpected content type`)
  }
  if (pattern && !pattern.test(body)) throw new Error(`${label} returned an unexpected body`)
  return { name: label, ok: true, status: response.status }
}

function modernMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'nolane-production-watchdog', version: '0.2.0' },
  }
}

async function mcp(fetchImpl, origin, method) {
  const rpc = { jsonrpc: '2.0', id: method, method, params: { _meta: modernMeta() } }
  const response = await fetchImpl(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
    },
    body: JSON.stringify(rpc),
  })
  const body = await read(response, `MCP ${method}`)
  let payload
  try { payload = JSON.parse(body) } catch { throw new Error(`MCP ${method} returned invalid JSON`) }
  if (payload?.error) throw new Error(`MCP ${method} returned an RPC error`)
  return payload?.result || {}
}

export async function runProductionWatchdog({ origin = DEFAULT_PRODUCTION_ORIGIN, fetchImpl = fetch } = {}) {
  const base = cleanOrigin(origin)
  const checks = []
  checks.push(await get(fetchImpl, base, '/health', 'health', /^ok\s*$/i))
  checks.push(await get(fetchImpl, base, '/', 'root HTML', /nolane-agent-view[\s\S]*\/agent-view/i, /text\/html/i))
  checks.push(await get(fetchImpl, base, '/robots.txt', 'robots', /OAI-SearchBot[\s\S]*Sitemap:/i, /text\/plain/i))
  checks.push(await get(fetchImpl, base, '/sitemap.xml', 'sitemap', /<urlset[\s>][\s\S]*\/agent-view/i, /application\/xml|text\/xml/i))
  checks.push(await get(fetchImpl, base, '/feed.xml', 'Atom feed', /<feed\b[\s\S]*Nolane Social/i, /application\/atom\+xml/i))
  checks.push(await get(fetchImpl, base, '/agent-view', 'agent view', /Nolane Social[\s\S]*JavaScript is not required/i, /text\/html/i))
  checks.push(await get(fetchImpl, base, '/publication-policy.json', 'publication policy', /"private_or_internal_material_allowed"\s*:\s*false/i, /application\/json/i))
  checks.push(await get(fetchImpl, base, '/.well-known/nolane-social.json', 'machine manifest', /"version"\s*:\s*"0\.2\.0"[\s\S]*"mcp"/i, /application\/json/i))
  checks.push(await get(fetchImpl, base, '/.well-known/oauth-protected-resource', 'OAuth protected resource', /"resource"\s*:/i, /application\/json/i))
  checks.push(await get(fetchImpl, base, '/api/v1/status', 'public status API', /"mode"\s*:/i, /application\/json/i))

  const discovery = await mcp(fetchImpl, base, 'server/discover')
  if (discovery.resultType !== 'complete' || !Array.isArray(discovery.supportedVersions) || !discovery.supportedVersions.includes('2026-07-28')) {
    throw new Error('MCP server/discover returned an incomplete modern contract')
  }
  checks.push({ name: 'MCP server/discover', ok: true, status: 200 })

  const tools = await mcp(fetchImpl, base, 'tools/list')
  const toolCount = Array.isArray(tools.tools) ? tools.tools.length : 0
  if (toolCount < 15) throw new Error(`MCP tools/list returned too few tools (${toolCount})`)
  checks.push({ name: 'MCP tools/list', ok: true, status: 200 })

  return { ok: true, origin: base, toolCount, checks }
}

async function main() {
  const origin = process.env.NOLANE_PRODUCTION_ORIGIN || DEFAULT_PRODUCTION_ORIGIN
  const result = await runProductionWatchdog({ origin })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
