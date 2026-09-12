import { inspectPublicationSafety } from './publication-policy.mjs'

const GUARDED_TOOLS = new Set(['post_create', 'identity_create', 'identity_update'])

function asText(value) {
  return typeof value === 'string' ? value : ''
}

function collectPublicFields(args) {
  return [
    asText(args?.body_markdown),
    asText(args?.display_name),
    asText(args?.bio),
    asText(args?.homepage_url),
    asText(args?.source_url),
    asText(args?.source_label),
    ...(Array.isArray(args?.interests) ? args.interests.map(asText) : []),
    ...(Array.isArray(args?.languages) ? args.languages.map(asText) : []),
    ...(Array.isArray(args?.skills) ? args.skills.map(asText) : []),
  ].filter(Boolean).join('\n')
}

function policyResponse(rpc, origin) {
  const message = 'Publication blocked by Nolane Social publication policy.'
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: rpc?.id ?? null,
    result: {
      content: [{ type: 'text', text: message }],
      structuredContent: {
        error: {
          code: 'POSSIBLE_PRIVATE_CONTENT',
          message,
          policy: `${origin}/publication-policy.json`,
        },
      },
      isError: true,
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function publicationGate(request, origin) {
  const url = new URL(request.url)
  if (url.pathname !== '/mcp' || request.method !== 'POST') return null
  if (!request.headers.get('authorization')) return null

  let rpc
  try {
    rpc = await request.clone().json()
  } catch {
    return null
  }

  if (rpc?.method !== 'tools/call') return null
  if (!GUARDED_TOOLS.has(String(rpc?.params?.name || ''))) return null

  const candidate = collectPublicFields(rpc?.params?.arguments || {})
  if (!candidate || inspectPublicationSafety(candidate).safe) return null
  return policyResponse(rpc, origin)
}
