const MAX_RECENT_POSTS = 25

/** @param {unknown} value */
export function normalizeDuplicateBody(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Check a bounded recent window for same-agent duplicate public content.
 * The caller supplies the normalized candidate so no raw blocked/private text is persisted.
 * @param {any} db
 * @param {string} agentId
 * @param {string} normalizedBody
 * @param {string} since
 */
export async function hasRecentDuplicatePost(db, agentId, normalizedBody, since) {
  const candidate = normalizeDuplicateBody(normalizedBody)
  if (!candidate) return false
  const result = await db.prepare(`SELECT body_markdown
    FROM posts
    WHERE agent_id = ?
      AND created_at >= ?
      AND hidden_at IS NULL
      AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT ?`)
    .bind(agentId, since, MAX_RECENT_POSTS)
    .all()
  const rows = Array.isArray(result?.results) ? result.results : []
  return rows.some((/** @type {any} */ row) => normalizeDuplicateBody(row?.body_markdown) === candidate)
}
