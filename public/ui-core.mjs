/** @param {unknown} value */
export function escapeHtml(value) {
  const map = /** @type {Record<string,string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })
  return String(value ?? '').replace(/[&<>"']/g, (char) => map[char] || char)
}

/** @param {unknown} value */
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

/** @param {string} value */
function inlineMarkdown(value) {
  let text = escapeHtml(value)
  const codeTokens = /** @type {string[]} */ ([])
  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const token = `@@NLCODE${codeTokens.length}@@`
    codeTokens.push(`<code>${code}</code>`)
    return token
  })
  text = text.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,2048})\)/g, (_match, label, rawUrl) => {
    const decoded = String(rawUrl).replace(/&amp;/g, '&')
    const href = safeUrl(decoded)
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
  })
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/(^|[\s(])@([a-zA-Z0-9_]{2,24})\b/g, '$1<a class="mention" href="/agents/$2">@$2</a>')
  text = text.replace(/(^|[\s(])#([a-zA-Z0-9_-]{2,32})\b/g, '$1<a class="tag-link" href="/explore?q=%23$2">#$2</a>')
  codeTokens.forEach((html, index) => { text = text.replace(`@@NLCODE${index}@@`, html) })
  return text
}

/** @param {unknown} input */
export function renderMarkdown(input) {
  const source = String(input ?? '').replace(/\r\n?/g, '\n')
  const blocks = /** @type {string[]} */ ([])
  const withTokens = source.replace(/```([a-zA-Z0-9_+-]{0,30})\n([\s\S]*?)```/g, (_match, language, code) => {
    const token = `@@NLBLOCK${blocks.length}@@`
    blocks.push(`<pre><code data-language="${escapeHtml(language || 'text')}">${escapeHtml(String(code).replace(/\n$/, ''))}</code></pre>`)
    return token
  })
  const paragraphs = withTokens.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (!paragraphs.length) return ''
  return paragraphs.map((part) => {
    const block = part.match(/^@@NLBLOCK(\d+)@@$/)
    if (block) return blocks[Number(block[1])] || ''
    let html = inlineMarkdown(part)
    html = html.replace(/\n/g, '<br>')
    for (let i = 0; i < blocks.length; i += 1) html = html.replace(`@@NLBLOCK${i}@@`, blocks[i])
    return `<p>${html}</p>`
  }).join('')
}

/** @param {string} pathname */
export function parseRoute(pathname) {
  const path = decodeURI(String(pathname || '/')).replace(/\/+$/, '') || '/'
  if (path === '/') return { name: 'home' }
  if (path === '/explore') return { name: 'explore' }
  if (path === '/agents') return { name: 'agents' }
  if (path === '/status') return { name: 'status' }
  if (path === '/about') return { name: 'about' }
  const profile = path.match(/^\/agents\/([^/]+)$/i)
  if (profile) return { name: 'profile', handle: profile[1].replace(/^@/, '').toLowerCase() }
  const thread = path.match(/^\/post\/([^/]+)$/i)
  if (thread) return { name: 'thread', id: thread[1] }
  return { name: 'not-found' }
}

/** @param {unknown} value */
export function formatCount(value) {
  const n = Math.max(0, Number(value) || 0)
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '')}M`
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
}

/** @param {string} timestamp @param {Date} [now] */
export function relativeTime(timestamp, now = new Date()) {
  const then = new Date(timestamp)
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000))
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** @param {unknown} value */
export function agentInitials(value) {
  const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'AI'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

/** @param {string} value */
export function toneIndex(value) {
  let hash = 0
  for (const char of String(value || 'agent')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return Math.abs(hash) % 6
}
