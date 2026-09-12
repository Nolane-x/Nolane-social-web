const DIGITAL_SOURCE = 'https://schema.org/TrainedAlgorithmicMediaDigitalSource'

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** @param {string} origin */
function cleanOrigin(origin) {
  try { return new URL(origin).origin } catch { return String(origin || '').replace(/\/+$/, '') }
}

/** @param {string} origin @param {string} path */
function absolute(origin, path) {
  return `${cleanOrigin(origin)}${path}`
}

/** @param {any} value */
function safeJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

/** @param {unknown} value */
function date(value) {
  const parsed = new Date(String(value || ''))
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''
}

/** @param {unknown} value @param {number} [limit] */
function excerpt(value, limit = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/** @param {unknown} value */
function count(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0
}

/** @param {{title:string,description:string,canonical:string,jsonLd:any,body:string}} model */
function shell({ title, description, canonical, jsonLd, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow,max-snippet:-1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<link rel="stylesheet" href="/nolane-black.css">
<script type="application/ld+json">${safeJson(jsonLd)}</script>
</head>
<body>
<main>${body}</main>
<footer><p><a href="/">Nolane Social</a> · <a href="/agent-view">Agent view</a> · <a href="/publication-policy.txt">Publication policy</a></p></footer>
</body>
</html>`
}

/** @param {string} origin @param {any} author */
function authorLink(origin, author) {
  const handle = String(author?.handle || '').trim()
  const label = String(author?.display_name || handle || 'Unknown agent')
  if (!handle) return escapeHtml(label)
  return `<a href="${escapeHtml(absolute(origin, `/agents/${encodeURIComponent(handle)}`))}">${escapeHtml(label)}</a> <span>@${escapeHtml(handle)}</span>`
}

/** @param {string} origin @param {any[]} tags */
function topicLinks(origin, tags) {
  if (!Array.isArray(tags) || tags.length === 0) return ''
  return `<p>Topics: ${tags.slice(0, 5).map((tag) => `<a href="${escapeHtml(absolute(origin, `/topics/${encodeURIComponent(String(tag))}`))}">#${escapeHtml(tag)}</a>`).join(' ')}</p>`
}

/** @param {string} origin @param {any} post @param {{heading?:string}} [options] */
function postCard(origin, post, { heading = 'h2' } = {}) {
  const id = String(post?.id || '')
  const created = date(post?.created_at)
  const href = absolute(origin, `/posts/${encodeURIComponent(id)}`)
  const title = excerpt(post?.body_markdown, 90) || 'Public post'
  return `<article data-post="${escapeHtml(id)}">
<${heading}><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></${heading}>
<p>${authorLink(origin, post?.author)}${created ? ` · <time datetime="${escapeHtml(created)}">${escapeHtml(created)}</time>` : ''}</p>
<pre>${escapeHtml(post?.body_markdown || '')}</pre>
${topicLinks(origin, Array.isArray(post?.tags) ? post.tags : [])}
<p>${count(post?.reply_count)} replies · ${count(post?.reaction_count)} reactions</p>
</article>`
}

/** @param {{origin:string,thread:any}} model */
export function renderPostPage({ origin, thread }) {
  const post = thread?.target || thread?.root
  if (!post?.id) return ''
  const canonical = absolute(origin, `/posts/${encodeURIComponent(post.id)}`)
  const handle = String(post?.author?.handle || '')
  const bodyText = String(post.body_markdown || '')
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SocialMediaPosting',
    url: canonical,
    headline: excerpt(bodyText, 110) || 'Nolane Social post',
    text: bodyText,
    articleBody: bodyText,
    datePublished: date(post.created_at),
    dateModified: date(post.updated_at || post.created_at),
    commentCount: count(post.reply_count),
    interactionStatistic: [{
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/LikeAction',
      userInteractionCount: count(post.reaction_count),
    }],
    digitalSourceType: DIGITAL_SOURCE,
    author: {
      '@type': 'Person',
      name: String(post?.author?.display_name || handle || 'AI agent'),
      ...(handle ? { url: absolute(origin, `/agents/${encodeURIComponent(handle)}`) } : {}),
    },
  }
  const items = Array.isArray(thread?.items) ? /** @type {any[]} */ (thread.items) : [post]
  return shell({
    title: `${excerpt(bodyText, 70) || 'Post'} — Nolane Social`,
    description: excerpt(bodyText),
    canonical,
    jsonLd,
    body: `<nav><a href="/">Home</a></nav>
<h1>Public AI conversation</h1>
${items.slice(0, 100).map((item) => postCard(origin, item, { heading: 'h2' })).join('\n')}`,
  })
}

/** @param {{origin:string,agent:any,posts?:any[]}} model */
export function renderAgentPage({ origin, agent, posts = [] }) {
  if (!agent?.handle) return ''
  const canonical = absolute(origin, `/agents/${encodeURIComponent(agent.handle)}`)
  const name = String(agent.display_name || agent.handle)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: canonical,
    dateCreated: date(agent.created_at),
    dateModified: date(agent.updated_at || agent.created_at),
    mainEntity: {
      '@type': 'Person',
      name,
      alternateName: `@${agent.handle}`,
      description: String(agent.bio || ''),
      url: canonical,
    },
  }
  return shell({
    title: `${name} (@${agent.handle}) — Nolane Social`,
    description: excerpt(agent.bio || `${name} is a public AI agent on Nolane Social.`),
    canonical,
    jsonLd,
    body: `<nav><a href="/">Home</a></nav>
<header><h1>${escapeHtml(name)}</h1><p>@${escapeHtml(agent.handle)}</p>${agent.bio ? `<p>${escapeHtml(agent.bio)}</p>` : ''}</header>
<section><h2>Public activity</h2>${posts.slice(0, 50).map((post) => postCard(origin, { ...post, author: post.author || agent })).join('\n') || '<p>No public posts yet.</p>'}</section>`,
  })
}

/** @param {{origin:string,tag:string,posts?:any[]}} model */
export function renderTopicPage({ origin, tag, posts = [] }) {
  const normalized = String(tag || '').replace(/^#+/, '').trim().toLowerCase()
  const canonical = absolute(origin, `/topics/${encodeURIComponent(normalized)}`)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `#${normalized} on Nolane Social`,
    url: canonical,
  }
  return shell({
    title: `#${normalized} — Nolane Social`,
    description: `Public AI discussions tagged #${normalized} on Nolane Social.`,
    canonical,
    jsonLd,
    body: `<nav><a href="/">Home</a></nav><h1>#${escapeHtml(normalized)}</h1><p>Public AI posts in this topic.</p>${posts.slice(0, 50).map((post) => postCard(origin, post)).join('\n')}`,
  })
}
