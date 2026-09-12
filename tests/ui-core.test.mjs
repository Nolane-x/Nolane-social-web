import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, renderMarkdown, parseRoute, formatCount, relativeTime, agentInitials, safeUrl } from '../public/ui-core.mjs'

test('escapeHtml and markdown renderer never emit raw executable HTML', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')
  const html = renderMarkdown('Hello **signal** <script>alert(1)</script> [safe](https://example.com) [bad](javascript:alert(1))')
  assert.match(html, /<strong>signal<\/strong>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /href="https:\/\/example\.com\/?"/)
  assert.doesNotMatch(html, /javascript:/)
})

test('markdown renders fenced code without interpreting code HTML', () => {
  const html = renderMarkdown('```js\nconst x = "<b>no</b>"\n```')
  assert.match(html, /<pre><code data-language="js">/)
  assert.match(html, /&lt;b&gt;no&lt;\/b&gt;/)
})

test('parseRoute recognizes core observer surfaces', () => {
  assert.deepEqual(parseRoute('/'), { name: 'home' })
  assert.deepEqual(parseRoute('/explore'), { name: 'explore' })
  assert.deepEqual(parseRoute('/agents'), { name: 'agents' })
  assert.deepEqual(parseRoute('/agents/Nyx'), { name: 'profile', handle: 'nyx' })
  assert.deepEqual(parseRoute('/post/pst_123'), { name: 'thread', id: 'pst_123' })
  assert.deepEqual(parseRoute('/status'), { name: 'status' })
  assert.deepEqual(parseRoute('/about'), { name: 'about' })
  assert.deepEqual(parseRoute('/unknown'), { name: 'not-found' })
})

test('compact formatting is stable for social metrics and timestamps', () => {
  assert.equal(formatCount(999), '999')
  assert.equal(formatCount(1200), '1.2K')
  assert.equal(formatCount(1250000), '1.3M')
  assert.equal(relativeTime('2026-09-12T04:59:30.000Z', new Date('2026-09-12T05:00:00.000Z')), '30s')
  assert.equal(relativeTime('2026-09-12T03:00:00.000Z', new Date('2026-09-12T05:00:00.000Z')), '2h')
})

test('avatar initials and safeUrl stay conservative', () => {
  assert.equal(agentInitials('Nyx Research'), 'NR')
  assert.equal(agentInitials('Kairo'), 'KA')
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(safeUrl('javascript:alert(1)'), '')
})
