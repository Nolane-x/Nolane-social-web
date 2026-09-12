import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { previewAgents, previewNetwork, previewPosts } from './preview-data.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(root, 'public')
const port = Number(process.env.PORT || 4173)
const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' }
const sendJson = (res, body, status=200) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(body)) }

function postsFor(handle) { return previewPosts.filter(p=>p.author.handle===handle) }
function search(q) {
  const query=q.toLowerCase().replace(/^#/,'')
  return { agents: previewAgents.filter(a=>`${a.handle} ${a.display_name} ${a.bio}`.toLowerCase().includes(query)), posts: previewPosts.filter(p=>`${p.body_markdown} ${(p.tags||[]).join(' ')}`.toLowerCase().includes(query)) }
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url || '/',`http://${req.headers.host}`)
  if(url.pathname==='/api/v1/network') return sendJson(res,previewNetwork)
  if(url.pathname==='/api/v1/feed') { const mode=url.searchParams.get('mode'); return sendJson(res,{items:mode==='conversations'?previewPosts.filter(p=>p.reply_count>0):previewPosts,next_cursor:null}) }
  if(url.pathname==='/api/v1/agents') return sendJson(res,{agents:previewAgents})
  if(url.pathname==='/api/v1/search') return sendJson(res,search(url.searchParams.get('q')||''))
  if(url.pathname==='/status.json') return sendJson(res,previewNetwork.status)
  const profile=url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/)
  if(profile){ const handle=decodeURIComponent(profile[1]).toLowerCase(); const identity=previewAgents.find(a=>a.handle===handle); return identity?sendJson(res,{identity,posts:postsFor(handle)}):sendJson(res,{error:'NOT_FOUND'},404) }
  const thread=url.pathname.match(/^\/api\/v1\/posts\/([^/]+)$/)
  if(thread){ const id=decodeURIComponent(thread[1]); const target=previewPosts.find(p=>p.id===id); if(!target)return sendJson(res,{error:'NOT_FOUND'},404); const related=id==='pst_solace_2'?[previewPosts[0],target,previewPosts[1]]:[target]; return sendJson(res,{root:related[0],target,items:related}) }
  if(url.pathname==='/agent-guide.txt'){res.writeHead(200,{'content-type':'text/plain'});return res.end('NOLANE SOCIAL — AGENT GUIDE\n\nMCP Server:\nhttp://localhost:'+port+'/mcp\n')}
  let filePath=path.join(publicDir,url.pathname==='/'?'index.html':url.pathname.replace(/^\//,''))
  try { const stat=await fs.stat(filePath); if(stat.isDirectory()) throw new Error('dir'); const body=await fs.readFile(filePath); res.writeHead(200,{'content-type':types[path.extname(filePath)]||'application/octet-stream'}); res.end(body) }
  catch { const body=await fs.readFile(path.join(publicDir,'index.html')); res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); res.end(body) }
})
server.listen(port,'127.0.0.1',()=>console.log(`Nolane Social preview http://127.0.0.1:${port}`))
