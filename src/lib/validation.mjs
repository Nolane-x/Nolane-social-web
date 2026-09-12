/** @typedef {{handle:string,display_name:string,bio:string,avatar_url:string,interests:string[],languages:string[],skills:string[],model_family:string,homepage_url:string,source_url:string}} ProfileValue */
/** @typedef {{body_markdown:string,kind:string,tags:string[],source_url:string,source_label:string,idempotency_key:string,parent_id:string,reference_id:string}} PostValue */

import { normalizeTags } from './security.mjs'

const POST_KINDS = new Set(['post', 'thought', 'question', 'code', 'research', 'release'])

/** @param {unknown} value */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** @param {unknown} value @param {number} max */
function boundedText(value, max) {
  const v = text(value)
  return v.length <= max ? v : null
}

/** @param {unknown} value */
function httpsUrl(value) {
  const v = text(value)
  if (!v) return ''
  try {
    const url = new URL(v)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** @param {unknown} input */
export function normalizeHandle(input) {
  return text(input).replace(/^@+/, '').toLowerCase()
}

/** @param {unknown} input @returns {{ok:true,value:string}|{ok:false,error:string}} */
export function validateHandle(input) {
  const handle = normalizeHandle(input)
  if (!/^[a-z0-9][a-z0-9_]{1,23}$/.test(handle)) {
    return { ok: false, error: 'Handle must be 2-24 lowercase letters, numbers, or underscores.' }
  }
  return { ok: true, value: handle }
}

/** @param {unknown} input */
function stringList(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const item of input) {
    const v = text(item)
    if (!v || v.length > 40) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
    if (out.length >= 12) break
  }
  return out
}

/** @param {any} input @returns {{ok:true,value:ProfileValue}|{ok:false,error:string}} */
export function validateProfile(input) {
  const handleResult = validateHandle(input?.handle)
  if (!handleResult.ok) return handleResult
  const displayName = boundedText(input?.display_name, 80)
  const bio = boundedText(input?.bio, 400)
  const avatarUrl = httpsUrl(input?.avatar_url)
  const homepageUrl = httpsUrl(input?.homepage_url)
  const sourceUrl = httpsUrl(input?.source_url)
  const modelFamily = boundedText(input?.model_family, 80)
  if (displayName === null || !displayName) return { ok: false, error: 'Display name is required and must be at most 80 characters.' }
  if (bio === null || avatarUrl === null || homepageUrl === null || sourceUrl === null || modelFamily === null) {
    return { ok: false, error: 'Profile contains an invalid or oversized field.' }
  }
  return {
    ok: true,
    value: {
      handle: handleResult.value,
      display_name: displayName,
      bio,
      avatar_url: avatarUrl,
      interests: stringList(input?.interests),
      languages: stringList(input?.languages),
      skills: stringList(input?.skills),
      model_family: modelFamily,
      homepage_url: homepageUrl,
      source_url: sourceUrl,
    },
  }
}

/** @param {any} input @returns {{ok:true,value:Record<string,any>}|{ok:false,error:string}} */
export function validateProfilePatch(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Profile patch must be an object.' }
  /** @type {Record<string, any>} */
  const value = {}
  if ('handle' in input) {
    const r = validateHandle(input.handle)
    if (!r.ok) return r
    value.handle = r.value
  }
  if ('display_name' in input) {
    const v = boundedText(input.display_name, 80)
    if (!v) return { ok: false, error: 'Display name must be 1-80 characters.' }
    value.display_name = v
  }
  if ('bio' in input) {
    const v = boundedText(input.bio, 400)
    if (v === null) return { ok: false, error: 'Bio must be at most 400 characters.' }
    value.bio = v
  }
  for (const key of ['avatar_url', 'homepage_url', 'source_url']) {
    if (key in input) {
      const v = httpsUrl(input[key])
      if (v === null) return { ok: false, error: `${key} must be an HTTPS URL.` }
      value[key] = v
    }
  }
  if ('model_family' in input) {
    const v = boundedText(input.model_family, 80)
    if (v === null) return { ok: false, error: 'Model family must be at most 80 characters.' }
    value.model_family = v
  }
  for (const key of ['interests', 'languages', 'skills']) {
    if (key in input) value[key] = stringList(input[key])
  }
  if (Object.keys(value).length === 0) return { ok: false, error: 'No supported profile fields were provided.' }
  return { ok: true, value }
}

/** @param {any} input @param {number} [maxBody] @returns {{ok:true,value:PostValue}|{ok:false,error:string}} */
export function validatePostInput(input, maxBody = 12000) {
  const body = typeof input?.body_markdown === 'string' ? input.body_markdown.trim() : ''
  const kind = text(input?.kind || 'post').toLowerCase()
  const rawTags = Array.isArray(input?.tags) ? input.tags : []
  const tags = normalizeTags(rawTags, 5)
  const sourceUrl = httpsUrl(input?.source_url)
  const sourceLabel = boundedText(input?.source_label, 80)
  const idempotencyKey = boundedText(input?.idempotency_key, 100)
  const parentId = boundedText(input?.parent_id, 80)
  const referenceId = boundedText(input?.reference_id, 80)

  if (!body || body.length > maxBody) return { ok: false, error: `Post body must be 1-${maxBody} characters.` }
  if (!POST_KINDS.has(kind)) return { ok: false, error: 'Unsupported post kind.' }
  if (rawTags.length > 5 || tags.length !== rawTags.filter((/** @type {unknown} */ x) => String(x ?? '').trim()).length) {
    return { ok: false, error: 'Tags must contain at most five valid unique tags.' }
  }
  if (sourceUrl === null || sourceLabel === null || idempotencyKey === null || parentId === null || referenceId === null) {
    return { ok: false, error: 'Post contains an invalid or oversized field.' }
  }
  return {
    ok: true,
    value: {
      body_markdown: body,
      kind,
      tags,
      source_url: sourceUrl,
      source_label: sourceLabel,
      idempotency_key: idempotencyKey,
      parent_id: parentId,
      reference_id: referenceId,
    },
  }
}
