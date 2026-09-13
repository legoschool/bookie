import {FORM,publicItems,score} from './assessment.mjs';
import books from './books.mjs';
const variants=['쉬움','중간','어려움'];
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256));}
const digest=async s=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
function fail(status,message){throw Object.assign(Error(message),{status});}
function txt(x,max=500,required=true){if(typeof x!=='string'||x.length>max||(required&&!x.trim()))fail(400,'입력 내용을 확인해 주세요.');return x.trim();}
const book=id=>books.find(b=>b.id===id);
function cleanBook(b,v){const l=b.levels[v];return {id:b.id,title:b.title,author:b.author,scenes:l.scenes,vocabulary:l.vocabulary||[],activities:l.activities.map(a=>({title:a.title,questions:a.questions,evidenceScenes:a.evidenceScenes,help:a.help,retry:a.retry}))};}
export async function handle(request,env){
 const u=new URL(request.url); const path=u.pathname.replace(/^.*\/api\/?/,''); const method=request.method;
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Vary':'Origin'};
 const origin=request.headers.get('origin');
 const permitted=new Set([u.origin,...(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)]);
 if(origin&&!permitted.has(origin))return new Response(JSON.stringify({error:'허용되지 않은 접속 주소입니다.'}),{status:403,headers});
 if(origin)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'});
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(method==='OPTIONS')return new Response(null,{status:204,headers});
 if(path==='health')return json({ready:!!env.DB,service:'bookie2'});
 if(!env.DB)return json({error:'부기2 서버를 연결해 주세요.'},503);
 const db=env.DB;
 const one=(sql,...args)=>db.prepare(sql).bind(...args).first();
 const all=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
 async function bankFor(id=FORM){const row=await one('SELECT bank FROM assessment_forms WHERE id=?',id);if(!row)fail(503,'서버에 검토한 진단 문항을 등록해 주세요.');return JSON.parse(row.bank);}
 async function body(){const raw=await request.text();if(raw.length>20000)fail(413,'입력한 글이 너무 깁니다.');try{return JSON.parse(raw);}catch{fail(400,'요청 형식을 확인해 주세요.');}}
 async function rate(key,max=15){const t=Date.now();await run('INSERT INTO limits(key,count,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset < ? THEN 1 ELSE count+1 END, reset=CASE WHEN reset < ? THEN ? ELSE reset END',key,t+900000,t,t,t+900000); const r=await one('SELECT count FROM limits WHERE key=?',key);if(r.count>max)fail(429,'잠시 뒤 다시 시도해 주세요.');}
 try{
  if(path==='login'&&method==='POST'){
   const b=await body();const login=txt(b.login,100).toLowerCase();const pw=txt(b.password,128);
   await rate('login:'+await digest(login));await rate('ip:'+await digest(request.headers.get('cf-connecting-ip')||'local'),100);
   const user=await one('SELECT * FROM users WHERE login=?',login);
   const hash=await passwordHash(pw,user?.salt||'not-an-account');
   if(!user||user.hash!==hash)fail(401,'입장 정보가 맞지 않습니다.');
   const token=hex(crypto.getRandomValues(new Uint8Array(32)));
   await run('INSERT INTO sessions VALUES(?,?,?)',await digest(token),user.id,Date.now()+8*3600000);
   return json({token,user:{id:user.id,name:user.name,role:user.role}});
  }
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  const me=await one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',await digest(token),Date.now());
  if(!me)fail(401,'로그인이 필요합니다.');
  const teacher=()=>{if(me.role!=='teacher')fail(403,'담당 교사만 볼 수 있습니다.');};
  const student=()=>{if(me.role!=='student')fail(403,'학생 계정으로 열어 주세요.');};
  async function owns(id){teacher();const s=await one('SELECT u.id FROM users u JOIN classes c ON c.id=u.class_id WHERE u.id=? AND c.teacher_id=? AND u.role=?',id,me.id,'student');if(!s)fail(404,'학생을 찾을 수 없습니다.');}
  if(path==='logout'&&method==='POST'){await run('DELETE FROM sessions WHERE token=?',await digest(token));return json({ok:true});}
  if(path==='me'&&method==='GET')return json({id:me.id,name:me.name,role:me.role});
  if(path==='teacher/classes'){
   teacher();
   if(method==='GET')return json(await all('SELECT * FROM classes WHERE teacher_id=?',me.id));
   if(method==='POST'){const b=await body();const name=txt(b.name,80);if(!Number.isInteger(b.grade)||b.grade<1||b.grade>6)fail(400,'학년을 확인해 주세요.'); const id=uid(),code=hex(crypto.getRandomValues(new Uint8Array(4))).toUpperCase();await run('INSERT INTO classes VALUES(?,?,?,?,?)',id,me.id,name,code,b.grade);return json({id,name,code,grade:b.grade},201);}
  }
  if(path==='teacher/students'){
   teacher();
   if(method==='GET')return json(await all('SELECT u.id,u.name,u.class_id,c.name AS class_name,c.grade,c.code FROM users u JOIN classes c ON c.id=u.class_id WHERE c.teacher_id=? ORDER BY u.name',me.id));
   if(method==='POST'){const b=await body();const c=await one('SELECT * FROM classes WHERE id=? AND teacher_id=?',b.classId,me.id);if(!c)fail(404,'학급을 찾을 수 없습니다.');if(b.consent!==true)fail(400,'계정 생성 동의 확인을 표시해 주세요.');const name=txt(b.name,50),handle=txt(b.handle,30).toLowerCase(),password=txt(b.password,128);if(!/^[a-z0-9]{2,20}$/.test(handle)||password.length<6)fail(400,'학생 아이디는 영문·숫자 2~20자, 비밀번호는 6자 이상으로 정해 주세요.');const id=uid(),salt=uid(),hash=await passwordHash(password,salt),login=c.code.toLowerCase()+':'+handle;await run('INSERT INTO users VALUES(?,?,?,?,?,?,?)',id,'student',name,c.id,login,salt,hash);return json({id,name,login},201);}
  }
  if(path==='teacher/assign'&&method==='POST'){
   const b=await body();await owns(b.studentId);await bankFor();
   const open=await one("SELECT id FROM attempts WHERE student_id=? AND status='open'",b.studentId);if(open)return json(open);
   const id=uid();await run('INSERT INTO attempts(id,student_id,form,created) VALUES(?,?,?,?)',id,b.studentId,FORM,now());return json({id},201);
  }
  if(path==='student/assessment'&&method==='GET'){
   student();const a=await one("SELECT id,form FROM attempts WHERE student_id=? AND status='open'",me.id);return json(a?{id:a.id,items:publicItems(await bankFor(a.form))}:null);
  }
  if(path==='student/submit'&&method==='POST'){
   student();const b=await body();const a=await one('SELECT * FROM attempts WHERE id=? AND student_id=?',b.id,me.id);if(!a)fail(404,'활동을 찾을 수 없습니다.');
   if(a.status==='submitted')return json({received:true});
   let result;try{result=score(await bankFor(a.form),b.answers);}catch(e){fail(400,e.message);}
   await run("UPDATE attempts SET answers=?,result=?,status='submitted',submitted=? WHERE id=? AND student_id=? AND status='open'",JSON.stringify(b.answers),JSON.stringify(result),now(),a.id,me.id);
   return json({received:true});
  }
  if(path==='teacher/report'&&method==='GET'){
   const id=u.searchParams.get('studentId');await owns(id);
   const attempts=await all("SELECT id,form,status,result,answers,created,submitted FROM attempts WHERE student_id=? ORDER BY created",id);
   const plan=await one('SELECT * FROM plans WHERE student_id=?',id);
   const entries=await all('SELECT e.*,f.message AS feedback FROM entries e LEFT JOIN feedback f ON f.entry_id=e.id WHERE e.student_id=? ORDER BY e.created',id);
   const reportBank=attempts.length?await bankFor(attempts.at(-1).form):null;
   return json({items:reportBank?.items||[],attempts:attempts.map(a=>({...a,result:a.result?JSON.parse(a.result):null,answers:a.answers?JSON.parse(a.answers):null})),plan,entries:entries.map(e=>({...e,payload:JSON.parse(e.payload)}))});
  }
  if(path==='teacher/preview'&&method==='GET'){
   teacher();const b=book(u.searchParams.get('bookId')),v=u.searchParams.get('variant');if(!b||!variants.includes(v))fail(400,'본문을 선택해 주세요.');return json({...cleanBook(b,v),status:b.status});
  }
  if(path==='teacher/plan'&&method==='POST'){
   const b=await body();await owns(b.studentId);if(!book(b.bookId)||!variants.includes(b.variant)||b.reviewed!==true)fail(400,'책과 본문을 확인한 뒤 검토 완료를 표시해 주세요.');
   const goal=txt(b.goal,240);await run('INSERT INTO plans VALUES(?,?,?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET book_id=excluded.book_id,variant=excluded.variant,goal=excluded.goal,teacher_id=excluded.teacher_id,reviewed=excluded.reviewed,updated=excluded.updated',b.studentId,b.bookId,b.variant,goal,me.id,1,now());return json({ok:true});
  }
  if(path==='student/plan'&&method==='GET'){
   student();const p=await one('SELECT * FROM plans WHERE student_id=?',me.id);return json(p?{bookId:p.book_id,title:book(p.book_id).title,goal:p.goal}:null);
  }
  if(path==='student/book'&&method==='GET'){
   student();const id=u.searchParams.get('id');const b=book(id);if(!b)fail(404,'책을 찾을 수 없습니다.');const p=await one('SELECT variant FROM plans WHERE student_id=? AND book_id=?',me.id,id);
   // Only teacher-reviewed assignments are served in real classrooms.
   if(!p)fail(403,'선생님이 준비한 책을 먼저 열어 주세요.');return json(cleanBook(b,p.variant));
  }
  if(path==='student/entries'){
   student();
   if(method==='GET'){const entries=await all('SELECT e.id,e.book_id,e.payload,e.created,f.message AS feedback FROM entries e LEFT JOIN feedback f ON e.id=f.entry_id WHERE e.student_id=? ORDER BY e.created',me.id);return json(entries.map(e=>({...e,payload:JSON.parse(e.payload)})));}
   if(method==='POST'){
    const b=await body();if(!/^[a-zA-Z0-9-]{10,80}$/.test(b.id||''))fail(400,'기록 번호가 맞지 않습니다.');
    const p=await one('SELECT * FROM plans WHERE student_id=? AND book_id=?',me.id,b.bookId);if(!p)fail(403,'선생님이 준비한 책에서 기록해 주세요.');
    const source=book(b.bookId),l=source.levels[p.variant];const scene=l.scenes.find(s=>s.id===b.sceneId);if(!scene)fail(400,'근거 장면을 골라 주세요.');
    const payload={before:txt(b.before,2000),after:txt(b.after,2000),question:txt(b.question,500,false),sceneId:scene.id,sceneText:scene.text,goal:p.goal,title:source.title,helpUsed:b.helpUsed===true};
    await run('INSERT INTO entries VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING',b.id,me.id,b.bookId,JSON.stringify(payload),now());
    const saved=await one('SELECT student_id FROM entries WHERE id=?',b.id);if(saved.student_id!==me.id)fail(409,'새 기록으로 다시 저장해 주세요.');return json({saved:true,id:b.id},201);
   }
  }
  if(path==='teacher/feedback'&&method==='POST'){
   teacher();const b=await body();const e=await one('SELECT student_id FROM entries WHERE id=?',b.entryId);if(!e)fail(404,'기록을 찾을 수 없습니다.');await owns(e.student_id);const message=txt(b.message,1000);await run('INSERT INTO feedback VALUES(?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET message=excluded.message,updated=excluded.updated',b.entryId,me.id,message,now());return json({ok:true});
  }
  if(path==='teacher/student'&&method==='DELETE'){
   const id=u.searchParams.get('studentId');await owns(id);
   await db.batch([db.prepare('DELETE FROM feedback WHERE entry_id IN (SELECT id FROM entries WHERE student_id=?)').bind(id),...['entries','attempts','plans'].map(t=>db.prepare(`DELETE FROM ${t} WHERE student_id=?`).bind(id)),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id),db.prepare('DELETE FROM users WHERE id=?').bind(id)]);return json({deleted:true});
  }
  fail(404,'요청한 기능을 찾을 수 없습니다.');
 }catch(e){return json({error:e.status?e.message:'저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'},e.status||500);}
}
