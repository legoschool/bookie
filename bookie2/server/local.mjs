import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {resolve,sep,extname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {handle} from './api.mjs';
import {openDB,seedTeacher,seedBank} from './db.mjs';
const base=fileURLToPath(new URL('../public',import.meta.url));
const data=process.env.BOOKIE_DATA_DIR||join(tmpdir(),'bookie2-local');await mkdir(data,{recursive:true});
const db=openDB(process.env.BOOKIE_DB_PATH||join(data,'bookie.sqlite'));
if(process.env.BOOKIE_TEACHER_PASSWORD)await seedTeacher(db,process.env.BOOKIE_TEACHER_LOGIN||'teacher',process.env.BOOKIE_TEACHER_PASSWORD);
try{const bank=JSON.parse(await readFile(new URL('../.local/assessment-bank.json',import.meta.url),'utf8'));await seedBank(db,bank);}catch{}
const port=Number(process.env.PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
 try{const origin=`http://127.0.0.1:${port}`,url=new URL(req.url,origin);
 if(url.pathname.startsWith('/api/')){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>25000){res.writeHead(413);res.end();return;}chunks.push(c);}const r=await handle(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),{DB:db,ALLOWED_ORIGINS:`http://localhost:${port},${origin}`});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;}
 const file=resolve(base,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(base+sep)){res.writeHead(403);res.end();return;}const s=await stat(file);if(!s.isFile())throw Error('404');
 res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Bookie2 http://127.0.0.1:${port}`));
