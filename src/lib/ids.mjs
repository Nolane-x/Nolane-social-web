const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Create a time-sortable, non-sequential public identifier.
 * @param {string} prefix
 * @returns {string}
 */
export function makeId(prefix) {
  if (!/^[a-z]{2,8}$/.test(prefix)) {
    throw new TypeError('Invalid identifier prefix')
  }
  const time = Date.now().toString(36).padStart(10, '0')
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let random = ''
  for (const byte of bytes) random += ALPHABET[byte % ALPHABET.length]
  return `${prefix}_${time}${random}`
}
