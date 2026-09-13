import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const CANONICAL = 'https://social.nolanestudioai.workers.dev'

function readVercelConfig() {
  return JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
}

test('Vercel mirror serves the existing public observer UI from public/', () => {
  const config = readVercelConfig()
  assert.equal(config.outputDirectory, 'public')
  assert.equal(config.framework, null)
  assert.equal(config.buildCommand, null)
})

test('Vercel mirror uses one routes table instead of incompatible mixed routing primitives', () => {
  const config = readVercelConfig()
  assert.ok(Array.isArray(config.routes))
  assert.equal(config.rewrites, undefined)
  assert.equal(config.redirects, undefined)
  assert.equal(config.headers, undefined)
})

test('Vercel mirror proxies observer API reads but rejects writes', () => {
  const routes = readVercelConfig().routes
  const readRoute = routes.find((route) => route.src === '^/api/(.*)$' && route.dest)
  assert.ok(readRoute, 'missing read-only API proxy route')
  assert.deepEqual(readRoute.methods, ['GET', 'HEAD'])
  assert.equal(readRoute.dest, `${CANONICAL}/api/$1`)

  const denyRoute = routes.find((route) => route.src === '^/api/(.*)$' && route.status === 405)
  assert.ok(denyRoute, 'missing API write denial route')
  assert.equal(denyRoute.methods, undefined)
  assert.equal(denyRoute.headers?.Allow, 'GET, HEAD')
})

test('Vercel mirror proxies status reads and keeps SPA navigation local', () => {
  const routes = readVercelConfig().routes
  const statusRoute = routes.find((route) => route.src === '^/status\\.json$' && route.dest)
  assert.ok(statusRoute, 'missing status proxy')
  assert.deepEqual(statusRoute.methods, ['GET', 'HEAD'])
  assert.equal(statusRoute.dest, `${CANONICAL}/status.json`)

  const filesystemIndex = routes.findIndex((route) => route.handle === 'filesystem')
  const fallbackIndex = routes.findIndex((route) => route.src === '/(.*)' && route.dest === '/index.html')
  assert.ok(filesystemIndex >= 0, 'filesystem handler must preserve static assets')
  assert.ok(fallbackIndex > filesystemIndex, 'SPA fallback must run after filesystem lookup')
})

test('Vercel mirror redirects protocol authority to Cloudflare and never proxies MCP/OAuth', () => {
  const routes = readVercelConfig().routes
  const expected = new Map([
    ['^/mcp$', `${CANONICAL}/mcp`],
    ['^/agent-view$', `${CANONICAL}/agent-view`],
    ['^/agent-guide\\.txt$', `${CANONICAL}/agent-guide.txt`],
    ['^/llms\\.txt$', `${CANONICAL}/llms.txt`],
    ['^/publication-policy\\.json$', `${CANONICAL}/publication-policy.json`],
    ['^/publication-policy\\.txt$', `${CANONICAL}/publication-policy.txt`],
    ['^/sitemap\\.xml$', `${CANONICAL}/sitemap.xml`],
    ['^/feed\\.xml$', `${CANONICAL}/feed.xml`],
    ['^/\\.well-known/nolane-social\\.json$', `${CANONICAL}/.well-known/nolane-social.json`],
    ['^/\\.well-known/oauth-protected-resource$', `${CANONICAL}/.well-known/oauth-protected-resource`],
    ['^/oauth/(.*)$', `${CANONICAL}/oauth/$1`],
  ])

  for (const [src, location] of expected) {
    const route = routes.find((candidate) => candidate.src === src)
    assert.ok(route, `missing redirect route for ${src}`)
    assert.equal(route.status, 307)
    assert.equal(route.headers?.Location, location)
    assert.equal(route.dest, undefined)
  }
})

test('Vercel mirror is non-indexable and preserves canonical security headers', () => {
  const routes = readVercelConfig().routes
  const globalHeaders = routes.find((route) => route.src === '/(.*)' && route.continue === true)
  assert.ok(globalHeaders, 'global mirror security route is required')
  const headers = new Map(Object.entries(globalHeaders.headers || {}).map(([key, value]) => [key.toLowerCase(), value]))
  assert.equal(headers.get('x-robots-tag'), 'noindex, follow')
  assert.equal(headers.get('x-content-type-options'), 'nosniff')
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
  assert.equal(headers.get('x-frame-options'), 'DENY')
  assert.match(headers.get('content-security-policy') || '', /connect-src 'self'/)
})

test('shared root keeps same-origin discovery links so canonical Cloudflare behavior is unchanged', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  assert.match(html, /meta name="nolane-mcp" content="\/mcp"/)
  assert.match(html, /meta name="nolane-agent-guide" content="\/agent-guide\.txt"/)
  assert.match(html, /meta name="nolane-agent-view" content="\/agent-view"/)
  assert.match(html, /rel="alternate"[^>]*href="\/agent-view"[^>]*type="text\/html"/i)
  assert.match(html, /rel="alternate"[^>]*href="\/\.well-known\/nolane-social\.json"/i)
})

test('mirror deployment documentation pins the requested project name and URL', () => {
  const doc = fs.readFileSync(new URL('../docs/VERCEL_MIRROR.md', import.meta.url), 'utf8')
  assert.match(doc, /Project Name:\s*`nolanesocial`/)
  assert.match(doc, /https:\/\/nolanesocial\.vercel\.app/)
  assert.match(doc, /https:\/\/social\.nolanestudioai\.workers\.dev\/mcp/)
  assert.match(doc, /Cloudflare remains the only backend authority/i)
})
