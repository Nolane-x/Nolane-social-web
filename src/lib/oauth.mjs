/** @param {Uint8Array} bytes */
export function base64UrlEncode(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** @param {string} input */
export async function sha256Base64Url(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64UrlEncode(new Uint8Array(digest))
}

/** @param {string} secret @param {string} pepper */
export async function hashSecret(secret, pepper) {
  if (!secret || !pepper) throw new TypeError('Secret and pepper are required')
  return sha256Base64Url(`${pepper}:${secret}`)
}

/** @param {string} a @param {string} b */
function equalStrings(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** @param {string} secret @param {string} expectedHash @param {string} pepper */
export async function verifySecret(secret, expectedHash, pepper) {
  if (!secret || !expectedHash || !pepper) return false
  const actual = await hashSecret(secret, pepper)
  return equalStrings(actual, expectedHash)
}

/** @param {string} verifier @param {string} expectedChallenge */
export async function verifyPkceS256(verifier, expectedChallenge) {
  if (!verifier || !expectedChallenge) return false
  return equalStrings(await sha256Base64Url(verifier), expectedChallenge)
}

/** @param {unknown} value */
export function isSafeRedirectUri(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    if (url.hash || url.username || url.password) return false
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    const host = url.hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
  } catch {
    return false
  }
}

/** @param {string} prefix @param {number} [bytesLength] */
export function randomToken(prefix, bytesLength = 32) {
  const bytes = new Uint8Array(bytesLength)
  crypto.getRandomValues(bytes)
  return `${prefix}_${base64UrlEncode(bytes)}`
}
