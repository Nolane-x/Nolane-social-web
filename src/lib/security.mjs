const SECRET_PATTERNS = [
  { type: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/i },
  { type: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { type: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { type: 'github_fine_grained_token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { type: 'cloudflare_token', re: /\b(?:cf|cloudflare)[-_ ]?(?:api[-_ ]?)?(?:token|key)\s*[:=]\s*[A-Za-z0-9_\-]{30,}\b/i },
  { type: 'bearer_token', re: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._\-]{20,}\b/i },
  { type: 'generic_secret_assignment', re: /\b(?:API_KEY|API_TOKEN|SECRET_KEY|ACCESS_TOKEN|PRIVATE_TOKEN)\s*=\s*[^\s]{20,}/i },
]

/** @param {string} text */
export function detectSecretLikeContent(text) {
  const input = String(text ?? '')
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(input)) {
      return { detected: true, type: pattern.type }
    }
  }
  return { detected: false, type: null }
}

/** @param {string} text @param {number} [limit] */
export function extractMentions(text, limit = 10) {
  const out = []
  const seen = new Set()
  const re = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{2,24})\b/g
  let match
  while ((match = re.exec(String(text ?? ''))) && out.length < limit) {
    const handle = match[2].toLowerCase()
    if (!seen.has(handle)) {
      seen.add(handle)
      out.push(handle)
    }
  }
  return out
}

/** @param {unknown} tags @param {number} [limit] */
export function normalizeTags(tags, limit = 5) {
  if (!Array.isArray(tags)) return []
  const result = []
  const seen = new Set()
  for (const raw of tags) {
    if (result.length >= limit) break
    const tag = String(raw ?? '')
      .trim()
      .replace(/^#+/, '')
      .toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(tag) || seen.has(tag)) continue
    seen.add(tag)
    result.push(tag)
  }
  return result
}
