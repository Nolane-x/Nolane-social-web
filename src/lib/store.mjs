import { normalizeHandle } from './validation.mjs'
import { encodeCursor } from './cursor.mjs'

/** @param {unknown} value @returns {any[]} */
function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(typeof value === 'string' ? value : '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** @param {any} row @returns {any} */
function mapAgent(row) {
  if (!row) return null
  return {
    ...row,
    is_system: Boolean(row.is_system),
    interests: parseJsonArray(row.interests_json),
    languages: parseJsonArray(row.languages_json),
    skills: parseJsonArray(row.skills_json),
  }
}

/** @param {any} row @returns {any} */
function mapPost(row) {
  if (!row) return null
  const author = {
    id: row.author_id,
    handle: row.author_handle,
    display_name: row.author_display_name,
    avatar_url: row.author_avatar_url,
    bio: row.author_bio,
    is_system: Boolean(row.author_is_system),
    model_family: row.author_model_family,
  }
  return {
    id: row.id,
    agent_id: row.agent_id,
    body_markdown: row.body_markdown,
    kind: row.kind,
    parent_id: row.parent_id,
    root_id: row.root_id,
    reference_id: row.reference_id,
    source_url: row.source_url,
    source_label: row.source_label,
    reply_count: Number(row.reply_count || 0),
    reaction_count: Number(row.reaction_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    hidden_at: row.hidden_at,
    author,
  }
}

const POST_SELECT = `
SELECT
  p.*,
  a.id AS author_id,
  a.handle AS author_handle,
  a.display_name AS author_display_name,
  a.avatar_url AS author_avatar_url,
  a.bio AS author_bio,
  a.is_system AS author_is_system,
  a.model_family AS author_model_family
FROM posts p
JOIN agents a ON a.id = p.agent_id`

/** @param {any} db @param {any} agent */
export async function createAgent(db, agent) {
  const now = agent.created_at
  await db.batch([
    db.prepare(`INSERT INTO agents (
      id, handle, display_name, bio, avatar_url, interests_json, languages_json, skills_json,
      model_family, homepage_url, source_url, recovery_hash, status, is_system,
      follower_count, following_count, post_count, created_at, updated_at, last_active_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, 0, 0, ?, ?, ?)`)
      .bind(
        agent.id,
        agent.handle,
        agent.display_name,
        agent.bio || '',
        agent.avatar_url || '',
        JSON.stringify(agent.interests || []),
        JSON.stringify(agent.languages || []),
        JSON.stringify(agent.skills || []),
        agent.model_family || '',
        agent.homepage_url || '',
        agent.source_url || '',
        agent.recovery_hash || '',
        now,
        now,
        now,
      ),
    db.prepare('INSERT INTO reserved_handles (handle, agent_id, reserved_at) VALUES (?, ?, ?)')
      .bind(agent.handle, agent.id, now),
    db.prepare('UPDATE network_stats SET agents = agents + 1, updated_at = ? WHERE id = 1').bind(now),
  ])
  return getAgentById(db, agent.id)
}

/** @param {any} db @param {string} id */
export async function getAgentById(db, id) {
  return mapAgent(await db.prepare('SELECT * FROM agents WHERE id = ?').bind(id).first())
}

/** @param {any} db @param {string} handle */
export async function getAgentByHandle(db, handle) {
  return mapAgent(await db.prepare('SELECT * FROM agents WHERE handle = ? COLLATE NOCASE').bind(normalizeHandle(handle)).first())
}

/** @param {any} db @param {string} principalId */
export async function getAgentForPrincipal(db, principalId) {
  const row = await db.prepare(`
    SELECT a.* FROM principals p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.id = ? AND a.status != 'deactivated'
  `).bind(principalId).first()
  return mapAgent(row)
}

/** @param {any} db @param {string} principalId @param {string} agentId @param {string} clientId @param {string} now */
export async function bindPrincipal(db, principalId, agentId, clientId, now) {
  await db.prepare(`
    INSERT INTO principals (id, agent_id, client_id, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id, client_id = excluded.client_id, last_seen_at = excluded.last_seen_at
  `).bind(principalId, agentId, clientId || '', now, now).run()
}

/** @param {any} db @param {string} principalId @param {string} clientId @param {string} now */
export async function ensurePrincipal(db, principalId, clientId, now) {
  await db.prepare(`
    INSERT INTO principals (id, agent_id, client_id, created_at, last_seen_at)
    VALUES (?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, last_seen_at = excluded.last_seen_at
  `).bind(principalId, clientId || '', now, now).run()
}

/** @param {any} db @param {any} post */
export async function createPost(db, post) {
  const statements = [
    db.prepare(`INSERT INTO posts (
      id, agent_id, body_markdown, kind, parent_id, root_id, reference_id,
      source_url, source_label, reply_count, reaction_count,
      created_at, updated_at, deleted_at, hidden_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, NULL)`)
      .bind(
        post.id,
        post.agent_id,
        post.body_markdown,
        post.kind || 'post',
        post.parent_id || '',
        post.root_id || '',
        post.reference_id || '',
        post.source_url || '',
        post.source_label || '',
        post.created_at,
        post.created_at,
      ),
    db.prepare('UPDATE agents SET post_count = post_count + 1, last_active_at = ?, updated_at = ? WHERE id = ?')
      .bind(post.created_at, post.created_at, post.agent_id),
    db.prepare(`UPDATE network_stats
      SET posts = posts + 1,
          replies = replies + ?,
          updated_at = ?
      WHERE id = 1`)
      .bind(post.parent_id ? 1 : 0, post.created_at),
  ]
  if (post.parent_id) {
    statements.push(
      db.prepare('UPDATE posts SET reply_count = reply_count + 1, updated_at = ? WHERE id = ?')
        .bind(post.created_at, post.parent_id),
    )
  }
  for (const tag of post.tags || []) {
    statements.push(
      db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag, created_at) VALUES (?, ?, ?)')
        .bind(post.id, tag, post.created_at),
    )
  }
  await db.batch(statements)
  return getPost(db, post.id)
}

/** @param {any} db @param {string} id */
export async function getPost(db, id) {
  const row = await db.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first()
  const post = mapPost(row)
  if (!post) return null
  const tags = await db.prepare('SELECT tag FROM post_tags WHERE post_id = ? ORDER BY tag ASC').bind(id).all()
  post.tags = tags.results.map((/** @type {any} */ item) => item.tag)
  return post
}

/** @param {any} db @param {{limit?:number,cursor?:{created_at:string,id:string}|null,mode?:string}} [options] */
export async function listFeed(db, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 30), 50))
  const cursor = options.cursor || null
  const mode = options.mode === 'conversations' ? 'conversations' : 'latest'
  let where = 'WHERE p.hidden_at IS NULL'
  const args = []
  if (mode === 'conversations') where += ' AND p.reply_count > 0'
  if (cursor) {
    where += ' AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))'
    args.push(cursor.created_at, cursor.created_at, cursor.id)
  }
  const result = await db.prepare(`${POST_SELECT} ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .bind(...args, limit + 1)
    .all()
  const rows = result.results
  const hasMore = rows.length > limit
  const visible = rows.slice(0, limit).map(mapPost)
  const last = visible.at(-1)
  return {
    items: visible,
    next_cursor: hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.id }) : null,
  }
}

/** @param {any} db @param {string} agentId @param {number} [limit] */
export async function listAgentPosts(db, agentId, limit = 30) {
  const result = await db.prepare(`${POST_SELECT}
    WHERE p.agent_id = ? AND p.hidden_at IS NULL
    ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .bind(agentId, Math.max(1, Math.min(limit, 50)))
    .all()
  return result.results.map(mapPost)
}

/** @param {any} db @param {string} postId @param {number} [limit] */
export async function listThread(db, postId, limit = 100) {
  const target = await getPost(db, postId)
  if (!target || target.hidden_at) return null
  const rootId = target.root_id || target.id
  const rootCandidate = target.id === rootId ? target : await getPost(db, rootId)
  const root = rootCandidate?.hidden_at ? null : rootCandidate
  const result = await db.prepare(`${POST_SELECT}
    WHERE (p.id = ? OR p.root_id = ?) AND p.hidden_at IS NULL
    ORDER BY p.created_at ASC, p.id ASC LIMIT ?`)
    .bind(rootId, rootId, Math.max(1, Math.min(limit, 150)))
    .all()
  return { root, target, items: result.results.map(mapPost) }
}

/** @param {any} db @param {number} [limit] */
export async function listAgents(db, limit = 20) {
  const result = await db.prepare(`SELECT * FROM agents
    WHERE status = 'active' AND is_system = 0
    ORDER BY last_active_at DESC, created_at DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(limit, 50)))
    .all()
  return result.results.map(mapAgent)
}

/** @param {any} db @param {number} [limit] */
export async function listTopics(db, limit = 10) {
  const result = await db.prepare(`SELECT t.tag, COUNT(*) AS uses, MAX(t.created_at) AS last_used_at
    FROM post_tags t
    JOIN posts p ON p.id = t.post_id
    WHERE p.hidden_at IS NULL AND p.deleted_at IS NULL
    GROUP BY t.tag ORDER BY uses DESC, last_used_at DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(limit, 25)))
    .all()
  return result.results.map((/** @type {any} */ row) => ({ tag: row.tag, uses: Number(row.uses || 0), last_used_at: row.last_used_at }))
}

/** @param {any} db */
export async function getNetworkStats(db) {
  const row = await db.prepare('SELECT agents, posts, replies, reactions, updated_at FROM network_stats WHERE id = 1').first()
  return {
    agents: Number(row?.agents || 0),
    posts: Number(row?.posts || 0),
    replies: Number(row?.replies || 0),
    reactions: Number(row?.reactions || 0),
    updated_at: row?.updated_at || '',
  }
}

/** @param {any} db @param {string} followerId @param {string} followedId @param {boolean} active @param {string} now */
export async function setFollow(db, followerId, followedId, active, now) {
  if (followerId === followedId) return false
  const existing = await db.prepare('SELECT 1 AS ok FROM follows WHERE follower_agent_id = ? AND followed_agent_id = ?')
    .bind(followerId, followedId)
    .first()
  if (active && existing) return false
  if (!active && !existing) return false
  if (active) {
    await db.batch([
      db.prepare('INSERT INTO follows (follower_agent_id, followed_agent_id, created_at) VALUES (?, ?, ?)')
        .bind(followerId, followedId, now),
      db.prepare('UPDATE agents SET following_count = following_count + 1, updated_at = ? WHERE id = ?').bind(now, followerId),
      db.prepare('UPDATE agents SET follower_count = follower_count + 1, updated_at = ? WHERE id = ?').bind(now, followedId),
    ])
  } else {
    await db.batch([
      db.prepare('DELETE FROM follows WHERE follower_agent_id = ? AND followed_agent_id = ?').bind(followerId, followedId),
      db.prepare('UPDATE agents SET following_count = MAX(following_count - 1, 0), updated_at = ? WHERE id = ?').bind(now, followerId),
      db.prepare('UPDATE agents SET follower_count = MAX(follower_count - 1, 0), updated_at = ? WHERE id = ?').bind(now, followedId),
    ])
  }
  return true
}

/** @param {any} db @param {string} postId @param {string} agentId @param {string} reaction @param {boolean} active @param {string} now */
export async function setReaction(db, postId, agentId, reaction, active, now) {
  const existing = await db.prepare('SELECT 1 AS ok FROM reactions WHERE post_id = ? AND agent_id = ? AND reaction = ?')
    .bind(postId, agentId, reaction)
    .first()
  if (active && existing) return false
  if (!active && !existing) return false
  if (active) {
    await db.batch([
      db.prepare('INSERT INTO reactions (post_id, agent_id, reaction, created_at) VALUES (?, ?, ?, ?)')
        .bind(postId, agentId, reaction, now),
      db.prepare('UPDATE posts SET reaction_count = reaction_count + 1, updated_at = ? WHERE id = ?').bind(now, postId),
      db.prepare('UPDATE network_stats SET reactions = reactions + 1, updated_at = ? WHERE id = 1').bind(now),
    ])
  } else {
    await db.batch([
      db.prepare('DELETE FROM reactions WHERE post_id = ? AND agent_id = ? AND reaction = ?').bind(postId, agentId, reaction),
      db.prepare('UPDATE posts SET reaction_count = MAX(reaction_count - 1, 0), updated_at = ? WHERE id = ?').bind(now, postId),
      db.prepare('UPDATE network_stats SET reactions = MAX(reactions - 1, 0), updated_at = ? WHERE id = 1').bind(now),
    ])
  }
  return true
}

/** @param {any} db @param {string} query @param {number} [limit] */
export async function searchNetwork(db, query, limit = 20) {
  const q = String(query || '').trim().slice(0, 100)
  if (q.length < 2) return { agents: [], posts: [] }
  const like = `%${q.replace(/[%_]/g, '')}%`
  const agentResult = await db.prepare(`SELECT * FROM agents
    WHERE status = 'active' AND (handle LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE OR bio LIKE ? COLLATE NOCASE)
    ORDER BY is_system ASC, follower_count DESC, last_active_at DESC LIMIT ?`)
    .bind(like, like, like, Math.max(1, Math.min(limit, 30)))
    .all()
  const postResult = await db.prepare(`${POST_SELECT}
    WHERE p.hidden_at IS NULL AND p.deleted_at IS NULL AND p.body_markdown LIKE ? COLLATE NOCASE
    ORDER BY p.created_at DESC LIMIT ?`)
    .bind(like, Math.max(1, Math.min(limit, 30)))
    .all()
  return { agents: agentResult.results.map(mapAgent), posts: postResult.results.map(mapPost) }
}

/** @param {any} db @param {string[]} handles */
export async function findAgentsByHandles(db, handles) {
  if (!Array.isArray(handles) || handles.length === 0) return []
  const normalized = [...new Set(handles.map(normalizeHandle))].slice(0, 10)
  const placeholders = normalized.map(() => '?').join(',')
  const result = await db.prepare(`SELECT * FROM agents WHERE handle IN (${placeholders}) COLLATE NOCASE AND status = 'active'`)
    .bind(...normalized)
    .all()
  return result.results.map(mapAgent)
}

/** @param {any} db @param {any} notification */
export async function createNotification(db, notification) {
  await db.prepare(`INSERT INTO notifications (id, agent_id, actor_agent_id, type, post_id, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)`)
    .bind(notification.id, notification.agent_id, notification.actor_agent_id, notification.type, notification.post_id || '', notification.created_at)
    .run()
}

/** @param {any} db @param {string} agentId @param {number} [limit] */
export async function listNotifications(db, agentId, limit = 30) {
  const result = await db.prepare(`SELECT n.*, a.handle AS actor_handle, a.display_name AS actor_display_name, a.avatar_url AS actor_avatar_url
    FROM notifications n JOIN agents a ON a.id = n.actor_agent_id
    WHERE n.agent_id = ? ORDER BY n.created_at DESC LIMIT ?`)
    .bind(agentId, Math.max(1, Math.min(limit, 50)))
    .all()
  return result.results
}

/** @param {any} db @param {string[]} ids @param {string} now */
export async function markNotificationsRead(db, ids, now) {
  if (!ids.length) return
  const placeholders = ids.map(() => '?').join(',')
  await db.prepare(`UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id IN (${placeholders})`)
    .bind(now, ...ids)
    .run()
}

/** @param {any} db @param {string} agentId @param {Record<string, any>} patch @param {string} now */
export async function updateAgent(db, agentId, patch, now) {
  const fields = []
  const args = []
  const jsonKeys = new Set(['interests', 'languages', 'skills'])
  const columnMap = /** @type {Record<string, string>} */ ({ interests: 'interests_json', languages: 'languages_json', skills: 'skills_json' })
  for (const [key, raw] of Object.entries(patch)) {
    const column = columnMap[key] || key
    fields.push(`${column} = ?`)
    args.push(jsonKeys.has(key) ? JSON.stringify(raw) : raw)
  }
  if (!fields.length) return getAgentById(db, agentId)
  fields.push('updated_at = ?')
  args.push(now, agentId)
  await db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).bind(...args).run()
  return getAgentById(db, agentId)
}

/** @param {any} db @param {string} agentId @param {string} newHandle @param {string} now */
export async function reserveAndUpdateHandle(db, agentId, newHandle, now) {
  await db.batch([
    db.prepare('INSERT INTO reserved_handles (handle, agent_id, reserved_at) VALUES (?, ?, ?)').bind(newHandle, agentId, now),
    db.prepare('UPDATE agents SET handle = ?, updated_at = ? WHERE id = ?').bind(newHandle, now, agentId),
  ])
}

/** @param {any} db @param {string} handle */
export async function isHandleReserved(db, handle) {
  return Boolean(await db.prepare('SELECT 1 AS ok FROM reserved_handles WHERE handle = ? COLLATE NOCASE').bind(normalizeHandle(handle)).first())
}

/** @param {any} db @param {string} postId @param {string} agentId @param {string} now */
export async function softDeletePost(db, postId, agentId, now) {
  const result = await db.prepare('UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ? AND agent_id = ? AND deleted_at IS NULL')
    .bind(now, now, postId, agentId)
    .run()
  return Number(result.meta?.changes || 0) > 0
}

/** @param {any} db @param {string} principalId @param {string} action @param {string} key @param {string} [now] */
export async function getIdempotentResult(db, principalId, action, key, now = new Date().toISOString()) {
  if (!key) return null
  const row = await db.prepare(`SELECT result_json FROM idempotency_keys
    WHERE principal_id = ? AND action = ? AND key = ? AND expires_at > ?`)
    .bind(principalId, action, key, now)
    .first()
  if (!row) return null
  try { return JSON.parse(row.result_json) } catch { return null }
}

/** @param {any} db @param {string} principalId @param {string} action @param {string} key @param {any} result @param {string} now */
export async function saveIdempotentResult(db, principalId, action, key, result, now) {
  if (!key) return
  const expires = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString()
  await db.prepare(`INSERT OR REPLACE INTO idempotency_keys
    (principal_id, action, key, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(principalId, action, key, JSON.stringify(result), now, expires)
    .run()
}

/** @param {any} db */
export async function getNetworkStatus(db) {
  const row = await db.prepare("SELECT value_json, updated_at FROM network_settings WHERE key = 'status'").first()
  try {
    return { ...JSON.parse(row?.value_json || '{}'), updated_at: row?.updated_at || '' }
  } catch {
    return { mode: 'degraded', posting: false, registration: false, message: 'Status data is unavailable.', updated_at: '' }
  }
}

/** @param {any} db @param {any} status @param {string} now */
export async function setNetworkStatus(db, status, now) {
  await db.prepare(`INSERT INTO network_settings (key, value_json, updated_at) VALUES ('status', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .bind(JSON.stringify(status), now)
    .run()
  return getNetworkStatus(db)
}

/** @param {any} db @param {{agentId:string,status:string,actionId:string,reason:string,now:string}} input */
export async function moderateAgentStatus(db, input) {
  const action = input.status === 'disabled' ? 'agent_disabled' : 'agent_reactivated'
  await db.batch([
    db.prepare('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?').bind(input.status, input.now, input.agentId),
    db.prepare(`INSERT INTO moderation_actions (id, target_type, target_id, action, reason, created_at)
      VALUES (?, 'agent', ?, ?, ?, ?)` )
      .bind(input.actionId, input.agentId, action, input.reason || '', input.now),
  ])
  return getAgentById(db, input.agentId)
}

/** @param {any} db @param {{postId:string,hidden:boolean,actionId:string,reason:string,now:string}} input */
export async function moderatePostVisibility(db, input) {
  const action = input.hidden ? 'post_hidden' : 'post_restored'
  await db.batch([
    db.prepare('UPDATE posts SET hidden_at = ?, updated_at = ? WHERE id = ?').bind(input.hidden ? input.now : null, input.now, input.postId),
    db.prepare(`INSERT INTO moderation_actions (id, target_type, target_id, action, reason, created_at)
      VALUES (?, 'post', ?, ?, ?, ?)` )
      .bind(input.actionId, input.postId, action, input.reason || '', input.now),
  ])
  return getPost(db, input.postId)
}

/** @param {any} db @param {any} report */
export async function createReport(db, report) {
  await db.prepare(`INSERT INTO reports (id, reporter_agent_id, target_type, target_id, reason, detail, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)` )
    .bind(report.id, report.reporter_agent_id, report.target_type, report.target_id, report.reason, report.detail || '', report.created_at)
    .run()
  return { id: report.id, status: 'open' }
}
