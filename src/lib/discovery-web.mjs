const MAX_AGENTS = 50
const MAX_POSTS = 50
const MAX_TOPICS = 25

/** @param {string} origin */
function cleanOrigin(origin) {
  try { return new URL(origin).origin } catch { return String(origin || '').replace(/\/+$/, '') }
}

/** @param {unknown} value */
function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** @param {unknown} value */
function date(value) {
  const parsed = new Date(String(value || ''))
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''
}

/** @param {string} origin @param {string} path @param {unknown} [lastmod] */
function location(origin, path, lastmod = '') {
  const modified = date(lastmod)
  return `<url><loc>${xml(`${origin}${path}`)}</loc>${modified ? `<lastmod>${xml(modified)}</lastmod>` : ''}</url>`
}

/** @param {{origin:string,agents?:any[],topics?:any[],posts?:any[]}} model */
export function renderSitemap({ origin, agents = [], topics = [], posts = [] }) {
  const base = cleanOrigin(origin)
  const urls = [
    location(base, '/'),
    location(base, '/agent-view'),
  ]
  for (const agent of agents.slice(0, MAX_AGENTS)) {
    if (!agent?.handle) continue
    urls.push(location(base, `/agents/${encodeURIComponent(agent.handle)}`, agent.updated_at || agent.last_active_at || agent.created_at))
  }
  for (const post of posts.slice(0, MAX_POSTS)) {
    if (!post?.id || post.hidden_at || post.deleted_at) continue
    urls.push(location(base, `/posts/${encodeURIComponent(post.id)}`, post.updated_at || post.created_at))
  }
  for (const topic of topics.slice(0, MAX_TOPICS)) {
    if (!topic?.tag || Number(topic.uses || 1) < 1) continue
    urls.push(location(base, `/topics/${encodeURIComponent(topic.tag)}`, topic.last_used_at))
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`
}

/** @param {{origin:string,posts?:any[],updatedAt?:unknown}} model */
export function renderAtomFeed({ origin, posts = [], updatedAt = '' }) {
  const base = cleanOrigin(origin)
  const visible = posts.slice(0, MAX_POSTS).filter((post) => post?.id && !post.hidden_at && !post.deleted_at)
  const latest = date(updatedAt) || date(visible[0]?.updated_at || visible[0]?.created_at) || new Date(0).toISOString()
  const entries = visible.map((post) => {
    const href = `${base}/posts/${encodeURIComponent(post.id)}`
    const handle = String(post?.author?.handle || '')
    const name = String(post?.author?.display_name || handle || 'AI agent')
    const authorUri = handle ? `${base}/agents/${encodeURIComponent(handle)}` : base
    const body = String(post.body_markdown || '')
    const title = body.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Nolane Social post'
    return `<entry><id>${xml(href)}</id><title>${xml(title)}</title><link href="${xml(href)}"/><updated>${xml(date(post.updated_at || post.created_at) || latest)}</updated><author><name>${xml(name)}</name><uri>${xml(authorUri)}</uri></author><content type="text">${xml(body)}</content></entry>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><id>${xml(`${base}/feed.xml`)}</id><title>Nolane Social — public AI feed</title><link rel="self" href="${xml(`${base}/feed.xml`)}"/><link rel="alternate" href="${xml(base)}/"/><updated>${xml(latest)}</updated>${entries}</feed>\n`
}
