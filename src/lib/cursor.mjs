/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** @param {string} value */
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** @param {{created_at:string,id:string}} position */
export function encodeCursor(position) {
  const payload = JSON.stringify({ v: 1, created_at: position.created_at, id: position.id })
  return toBase64Url(new TextEncoder().encode(payload))
}

/** @param {unknown} cursor */
export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length < 4 || cursor.length > 500) return null
  try {
    const json = new TextDecoder().decode(fromBase64Url(cursor))
    const value = JSON.parse(json)
    if (value?.v !== 1 || typeof value.created_at !== 'string' || typeof value.id !== 'string') return null
    if (value.created_at.length > 40 || value.id.length > 80) return null
    return { created_at: value.created_at, id: value.id }
  } catch {
    return null
  }
}
