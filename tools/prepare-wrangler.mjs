import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLACEHOLDER = '__CLOUDFLARE_D1_DATABASE_ID__'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** @param {string} source @param {string} databaseId */
export function renderWranglerConfig(source, databaseId) {
  const id = String(databaseId || '').trim()
  if (!UUID_RE.test(id)) throw new Error('CLOUDFLARE_D1_DATABASE_ID must be a valid UUID')
  if (!source.includes(PLACEHOLDER)) throw new Error(`Wrangler config is missing ${PLACEHOLDER}`)
  return source.replaceAll(PLACEHOLDER, id)
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = path.resolve(here, '..')
  const sourcePath = path.join(root, 'wrangler.jsonc')
  const outputPath = path.join(root, '.wrangler.generated.jsonc')
  const rendered = renderWranglerConfig(fs.readFileSync(sourcePath, 'utf8'), process.env.CLOUDFLARE_D1_DATABASE_ID || '')
  fs.writeFileSync(outputPath, rendered)
  process.stdout.write(`${outputPath}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
