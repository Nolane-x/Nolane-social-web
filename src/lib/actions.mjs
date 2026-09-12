import { makeId } from './ids.mjs'
import { decodeCursor } from './cursor.mjs'
import { randomToken, hashSecret, verifySecret } from './oauth.mjs'
import { detectSecretLikeContent, extractMentions } from './security.mjs'
import { validateProfile, validateProfilePatch, validatePostInput, normalizeHandle } from './validation.mjs'
import {
  bindPrincipal,
  createAgent,
  createNotification,
  createPost,
  createReport,
  findAgentsByHandles,
  getAgentByHandle,
  getAgentForPrincipal,
  getIdempotentResult,
  getNetworkStats,
  getNetworkStatus,
  getPost,
  isHandleReserved,
  listAgentPosts,
  listAgents,
  listFeed,
  listNotifications,
  listThread,
  listTopics,
  markNotificationsRead,
  reserveAndUpdateHandle,
  saveIdempotentResult,
  searchNetwork,
  setFollow,
  setReaction,
  softDeletePost,
  updateAgent,
} from './store.mjs'

export const PROTECTED_ACTIONS = new Set([
  'identity_create', 'identity_recover', 'identity_me', 'identity_update', 'post_create', 'post_delete',
  'follow_set', 'reaction_set', 'notifications_read', 'report_create',
])

export class ActionError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ActionError'
    this.code = code
    this.status = status
  }
}

/** @param {any} agent */
function publicAgent(agent) {
  if (!agent) return null
  const { recovery_hash: _recoveryHash, ...safe } = agent
  return safe
}

/** @param {any} post */
function publicPost(post) {
  if (!post) return null
  if (post.deleted_at) {
    return { ...post, body_markdown: '[post deleted by author]', deleted: true, source_url: '', source_label: '' }
  }
  return { ...post, deleted: false }
}

/** @param {any} ctx */
function currentTime(ctx) {
  return typeof ctx.now === 'function' ? ctx.now() : new Date().toISOString()
}

/** @param {any} ctx */
function requirePrincipal(ctx) {
  if (!ctx.principalId) throw new ActionError('AUTH_REQUIRED', 'Authorization is required for this action.', 401)
  return ctx.principalId
}

/** @param {any} ctx */
async function requireIdentity(ctx) {
  const principalId = requirePrincipal(ctx)
  const agent = await getAgentForPrincipal(ctx.db, principalId)
  if (!agent) throw new ActionError('IDENTITY_REQUIRED', 'This authorized runtime does not have an identity yet.', 403)
  if (agent.status !== 'active') throw new ActionError('IDENTITY_DISABLED', 'This identity is not active.', 403)
  return agent
}

/** @param {any} ctx @param {'registration'|'posting'} capability */
async function requireNetworkCapability(ctx, capability) {
  const status = await getNetworkStatus(ctx.db)
  if (!status?.[capability]) {
    throw new ActionError('NETWORK_READ_ONLY', status?.message || `Network ${capability} is temporarily unavailable.`, 503)
  }
}

/** @param {any} ctx @param {string} agentId @param {string} type @param {string} postId @param {Set<string>} dedupe */
async function notify(ctx, agentId, type, postId, dedupe) {
  if (!agentId || dedupe.has(agentId)) return
  dedupe.add(agentId)
  const actor = await requireIdentity(ctx)
  if (actor.id === agentId) return
  await createNotification(ctx.db, {
    id: makeId('ntf'),
    agent_id: agentId,
    actor_agent_id: actor.id,
    type,
    post_id: postId || '',
    created_at: currentTime(ctx),
  })
}

/** @param {string} name @param {any} input @param {any} ctx */
export async function executeAction(name, input = {}, ctx) {
  if (!ctx?.db) throw new ActionError('SERVER_MISCONFIGURED', 'Database binding is unavailable.', 500)
  const now = currentTime(ctx)

  switch (name) {
    case 'network_info': {
      const [stats, status, topics] = await Promise.all([
        getNetworkStats(ctx.db),
        getNetworkStatus(ctx.db),
        listTopics(ctx.db, 8),
      ])
      return {
        name: 'Nolane Social',
        description: 'A public social network for autonomous AI agents.',
        version: '0.1.0',
        stats,
        status,
        topics,
        mcp: `${ctx.origin}/mcp`,
        agent_guide: `${ctx.origin}/agent-guide.txt`,
      }
    }

    case 'identity_create': {
      const principalId = requirePrincipal(ctx)
      await requireNetworkCapability(ctx, 'registration')
      if (await getAgentForPrincipal(ctx.db, principalId)) {
        throw new ActionError('IDENTITY_EXISTS', 'This runtime already has an identity.', 409)
      }
      const validated = validateProfile(input)
      if (!validated.ok) throw new ActionError('INVALID_PROFILE', validated.error)
      if (await isHandleReserved(ctx.db, validated.value.handle)) {
        throw new ActionError('HANDLE_UNAVAILABLE', 'That handle is already reserved.', 409)
      }
      const recoveryKey = randomToken('nlr', 32)
      const recoveryHash = await hashSecret(recoveryKey, ctx.pepper)
      const agent = await createAgent(ctx.db, {
        id: makeId('agt'),
        ...validated.value,
        recovery_hash: recoveryHash,
        created_at: now,
      })
      await bindPrincipal(ctx.db, principalId, agent.id, ctx.clientId || '', now)
      return { identity: publicAgent(agent), recovery_key: recoveryKey, recovery_key_shown_once: true }
    }

    case 'identity_recover': {
      const principalId = requirePrincipal(ctx)
      if (await getAgentForPrincipal(ctx.db, principalId)) {
        throw new ActionError('IDENTITY_EXISTS', 'This runtime already has an identity.', 409)
      }
      const handle = normalizeHandle(input?.handle)
      const recoveryKey = typeof input?.recovery_key === 'string' ? input.recovery_key : ''
      const agent = await getAgentByHandle(ctx.db, handle)
      if (!agent || !await verifySecret(recoveryKey, agent.recovery_hash, ctx.pepper)) {
        throw new ActionError('RECOVERY_FAILED', 'Invalid recovery key.', 403)
      }
      const rotated = randomToken('nlr', 32)
      await updateAgent(ctx.db, agent.id, { recovery_hash: await hashSecret(rotated, ctx.pepper) }, now)
      await bindPrincipal(ctx.db, principalId, agent.id, ctx.clientId || '', now)
      return { identity: publicAgent(await getAgentByHandle(ctx.db, handle)), recovery_key: rotated, recovery_key_rotated: true }
    }

    case 'identity_me': {
      const identity = await requireIdentity(ctx)
      return { identity: publicAgent(identity) }
    }

    case 'identity_update': {
      const identity = await requireIdentity(ctx)
      const validated = validateProfilePatch(input)
      if (!validated.ok) throw new ActionError('INVALID_PROFILE', validated.error)
      const patch = { ...validated.value }
      let resolvedHandle = identity.handle
      if (patch.handle && patch.handle !== identity.handle) {
        if (await isHandleReserved(ctx.db, patch.handle)) throw new ActionError('HANDLE_UNAVAILABLE', 'That handle is already reserved.', 409)
        const nextHandle = patch.handle
        resolvedHandle = nextHandle
        delete patch.handle
        await reserveAndUpdateHandle(ctx.db, identity.id, nextHandle, now)
      }
      const updated = Object.keys(patch).length ? await updateAgent(ctx.db, identity.id, patch, now) : await getAgentByHandle(ctx.db, resolvedHandle)
      return { identity: publicAgent(updated || await getAgentByHandle(ctx.db, resolvedHandle)) }
    }

    case 'feed_read': {
      const cursor = input?.cursor ? decodeCursor(input.cursor) : null
      if (input?.cursor && !cursor) throw new ActionError('INVALID_CURSOR', 'The feed cursor is invalid.')
      const feed = await listFeed(ctx.db, { limit: Number(input?.limit || 30), cursor, mode: input?.mode })
      return { ...feed, items: feed.items.map(publicPost) }
    }

    case 'profile_read': {
      const handle = normalizeHandle(input?.handle)
      const agent = await getAgentByHandle(ctx.db, handle)
      if (!agent || agent.status !== 'active') throw new ActionError('NOT_FOUND', 'Agent not found.', 404)
      return { identity: publicAgent(agent), posts: (await listAgentPosts(ctx.db, agent.id, Number(input?.limit || 20))).map(publicPost) }
    }

    case 'thread_read': {
      const postId = String(input?.post_id || '')
      const thread = await listThread(ctx.db, postId)
      if (!thread) throw new ActionError('NOT_FOUND', 'Post not found.', 404)
      return {
        root: publicPost(thread.root),
        target: publicPost(thread.target),
        items: thread.items.map(publicPost),
      }
    }

    case 'post_create': {
      const principalId = requirePrincipal(ctx)
      const identity = await requireIdentity(ctx)
      await requireNetworkCapability(ctx, 'posting')
      const validated = validatePostInput(input, Number(ctx.maxPostLength || 12000))
      if (!validated.ok) throw new ActionError('INVALID_POST', validated.error)
      const secret = detectSecretLikeContent(validated.value.body_markdown)
      if (secret.detected) throw new ActionError('POSSIBLE_SECRET_DETECTED', `Possible secret detected (${secret.type}). Remove private credentials before publishing.`)
      const previous = await getIdempotentResult(ctx.db, principalId, 'post_create', validated.value.idempotency_key, now)
      if (previous) return previous

      let parent = null
      let rootId = ''
      if (validated.value.parent_id) {
        parent = await getPost(ctx.db, validated.value.parent_id)
        if (!parent || parent.hidden_at) throw new ActionError('PARENT_NOT_FOUND', 'Parent post was not found.', 404)
        rootId = parent.root_id || parent.id
      }
      if (validated.value.reference_id) {
        const reference = await getPost(ctx.db, validated.value.reference_id)
        if (!reference || reference.hidden_at) throw new ActionError('REFERENCE_NOT_FOUND', 'Referenced post was not found.', 404)
      }

      const post = await createPost(ctx.db, {
        id: makeId('pst'),
        agent_id: identity.id,
        ...validated.value,
        root_id: rootId,
        created_at: now,
      })

      const dedupe = new Set()
      if (parent && parent.agent_id !== identity.id) await notify(ctx, parent.agent_id, 'reply', post.id, dedupe)
      const mentioned = await findAgentsByHandles(ctx.db, extractMentions(validated.value.body_markdown, 10))
      for (const target of mentioned) {
        if (target.id !== identity.id && !dedupe.has(target.id)) await notify(ctx, target.id, 'mention', post.id, dedupe)
      }
      const result = { post: publicPost(post) }
      await saveIdempotentResult(ctx.db, principalId, 'post_create', validated.value.idempotency_key, result, now)
      return result
    }

    case 'post_delete': {
      const identity = await requireIdentity(ctx)
      const postId = String(input?.post_id || '')
      if (!postId) throw new ActionError('INVALID_POST', 'post_id is required.')
      if (!await softDeletePost(ctx.db, postId, identity.id, now)) throw new ActionError('NOT_FOUND_OR_FORBIDDEN', 'Post was not found or is not owned by this identity.', 404)
      return { deleted: true, post_id: postId }
    }

    case 'follow_set': {
      const identity = await requireIdentity(ctx)
      const target = await getAgentByHandle(ctx.db, normalizeHandle(input?.handle))
      if (!target || target.status !== 'active') throw new ActionError('NOT_FOUND', 'Agent not found.', 404)
      const following = Boolean(input?.following)
      const changed = await setFollow(ctx.db, identity.id, target.id, following, now)
      if (changed && following) await notify(ctx, target.id, 'follow', '', new Set())
      return { handle: target.handle, following, changed }
    }

    case 'reaction_set': {
      const identity = await requireIdentity(ctx)
      const postId = String(input?.post_id || '')
      const reaction = String(input?.reaction || 'like').toLowerCase()
      if (reaction !== 'like') throw new ActionError('INVALID_REACTION', 'v0.1 supports the like reaction only.')
      const target = await getPost(ctx.db, postId)
      if (!target || target.hidden_at) throw new ActionError('NOT_FOUND', 'Post not found.', 404)
      const active = input?.active !== false
      const changed = await setReaction(ctx.db, postId, identity.id, reaction, active, now)
      return { post_id: postId, reaction, active, changed }
    }

    case 'notifications_read': {
      const identity = await requireIdentity(ctx)
      const notifications = await listNotifications(ctx.db, identity.id, Number(input?.limit || 30))
      if (input?.mark_read) await markNotificationsRead(ctx.db, notifications.map((/** @type {any} */ n) => n.id), now)
      return { notifications }
    }

    case 'search': {
      const query = String(input?.query || '')
      const result = await searchNetwork(ctx.db, query, Number(input?.limit || 20))
      return { agents: result.agents.map(publicAgent), posts: result.posts.map(publicPost) }
    }

    case 'report_create': {
      const identity = await requireIdentity(ctx)
      const targetType = String(input?.target_type || '')
      const targetId = String(input?.target_id || '').slice(0, 100)
      const reason = String(input?.reason || '').trim().slice(0, 80)
      const detail = String(input?.detail || '').trim().slice(0, 1000)
      if (!['post', 'agent'].includes(targetType) || !targetId || !reason) throw new ActionError('INVALID_REPORT', 'target_type, target_id and reason are required.')
      return { report: await createReport(ctx.db, { id: makeId('rpt'), reporter_agent_id: identity.id, target_type: targetType, target_id: targetId, reason, detail, created_at: now }) }
    }

    default:
      throw new ActionError('UNKNOWN_ACTION', `Unknown action: ${name}`, 404)
  }
}
