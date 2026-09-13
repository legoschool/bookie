import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../server/api.mjs';
import {openDB,seedTeacher,seedBank} from '../server/db.mjs';
import {FORM,publicItems,score} from '../server/assessment.mjs';
const origin='http://127.0.0.1:4173';
// Synthetic fixtures, not the production diagnostic questions or answers.
const items=Array.from({length:12},(_,i)=>({id:'test'+i,domain:['meaning','context','relation'][i%3],context:'테스트 문맥',prompt:'테스트 문항 '+i,options:['검증 선택 A','검증 선택 B'],answer:0}));
const bank={id:FORM,items};
async function fixture(){const DB=openDB();await seedBank(DB,bank);await seedTeacher(DB,'tea1','long-test-password1');await seedTeacher(DB,'tea2','long-test-password2');
 const call=async(path,method='GET',data,token,from=origin)=>{const r=await handle(new Request(origin+'/api/'+path,{method,headers:{Origin:from,...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB});return {status:r.status,headers:r.headers,body:await r.json()};};
 const t1=(await call('login','POST',{login:'tea1',password:'long-test-password1'})).body.token;
 const t2=(await call('login','POST',{login:'tea2',password:'long-test-password2'})).body.token;
 const cls=(await call('teacher/classes','POST',{name:'검증 학급',grade:2},t1)).body;
 const student=(await call('teacher/students','POST',{classId:cls.id,name:'검증 학생',handle:'kid1',password:'test123456',consent:true},t1)).body;
 const kid=(await call('login','POST',{login:student.login,password:'test123456'})).body.token;
 return {DB,call,t1,t2,cls,student,kid};
}
test('student cannot read diagnostic data through any exposed route',async()=>{const f=await fixture();try{
 for(const path of ['teacher/report?studentId='+f.student.id,'teacher/preview?bookId=bk001&variant=쉬움','teacher/students','teacher/classes'])assert.equal((await f.call(path,'GET',undefined,f.kid)).status,403,path);
 for(const path of ['attempts','results','bookie','bookie/attempts','teacher/report?studentId='+f.student.id])assert.notEqual((await f.call(path)).status,200,path);
 assert.equal((await f.call('teacher/report?studentId='+f.student.id,'GET',undefined,f.t2)).status,404);
 assert.deepEqual((await f.call('teacher/students','GET',undefined,f.t2)).body,[]);
 }finally{f.DB.close();}});
test('submission returns receipt only; scores remain private; duplicates keep first result',async()=>{const f=await fixture();try{
 const attempt=(await f.call('teacher/assign','POST',{studentId:f.student.id},f.t1)).body;
 const a=await f.call('student/assessment','GET',undefined,f.kid);assert.equal(a.body.items.length,12);assert(!JSON.stringify(a.body).match(/"(answer|domain|suggestion|correct)"/));
 assert.equal((await f.call('student/submit','POST',{id:attempt.id,answers:{w1:0}},f.kid)).status,400);
 const answers=Object.fromEntries(items.map(i=>[i.id,i.answer]));
 const result=await f.call('student/submit','POST',{id:attempt.id,answers},f.kid);assert.deepEqual(result.body,{received:true});assert.match(result.headers.get('Cache-Control'),/no-store/);
 const duplicate=await f.call('student/submit','POST',{id:attempt.id,answers:Object.fromEntries(items.map(i=>[i.id,-1]))},f.kid);assert.deepEqual(duplicate.body,{received:true});
 const report=await f.call('teacher/report?studentId='+f.student.id,'GET',undefined,f.t1);assert.equal(report.body.attempts[0].result.correct,12);
 assert.equal((await f.call('student/assessment','GET',undefined,f.kid)).body,null);
 }finally{f.DB.close();}});
test('only owner teacher can assign a reviewed text and student sees no variant',async()=>{const f=await fixture();try{
 const plan={studentId:f.student.id,bookId:'bk001',variant:'쉬움',goal:'장면으로 이유 말하기',reviewed:true};
 assert.equal((await f.call('teacher/plan','POST',plan,f.kid)).status,403);
 assert.equal((await f.call('teacher/plan','POST',plan,f.t2)).status,404);
 assert.equal((await f.call('teacher/plan','POST',{...plan,reviewed:false},f.t1)).status,400);
 assert.equal((await f.call('teacher/plan','POST',plan,f.t1)).status,200);
 const p=(await f.call('student/plan','GET',undefined,f.kid)).body;assert.deepEqual(Object.keys(p).sort(),['bookId','goal','title']);
 const b=(await f.call('student/book?id=bk001','GET',undefined,f.kid)).body;assert.equal(b.title,'토끼와 거북이');assert(!JSON.stringify(b).includes('"variant"'));
 assert.equal((await f.call('student/book?id=bk002','GET',undefined,f.kid)).status,403);
 }finally{f.DB.close();}});
test('growth entries are scoped, idempotent, XSS-safe data and teacher feedback persists',async()=>{const f=await fixture();try{
 await f.call('teacher/plan','POST',{studentId:f.student.id,bookId:'bk001',variant:'중간',goal:'장면 살피기',reviewed:true},f.t1);
 const entry={id:crypto.randomUUID(),bookId:'bk001',before:'<script>alert(1)</script>',after:'거북이가 걸었어요.',sceneId:'S3',question:'',helpUsed:true};
 assert.equal((await f.call('student/entries','POST',entry,f.kid)).status,201);
 await f.call('student/entries','POST',entry,f.kid);
 assert.equal((await f.call('student/entries','GET',undefined,f.kid)).body.length,1);
 assert.equal((await f.call('teacher/feedback','POST',{entryId:entry.id,message:'장면을 붙였구나.'},f.t2)).status,404);
 assert.equal((await f.call('teacher/feedback','POST',{entryId:entry.id,message:'장면을 붙였구나.'},f.kid)).status,403);
 await f.call('teacher/feedback','POST',{entryId:entry.id,message:'장면을 붙였구나.'},f.t1);
 assert.equal((await f.call('student/entries','GET',undefined,f.kid)).body[0].feedback,'장면을 붙였구나.');
 assert.equal((await f.call('teacher/student?studentId='+f.student.id,'DELETE',undefined,f.t1)).status,200);
 assert.equal((await f.call('student/entries','GET',undefined,f.kid)).status,401);
 assert.equal((await f.DB.prepare('SELECT count(*) AS n FROM entries').first()).n,0);
 assert.equal((await f.DB.prepare('SELECT count(*) AS n FROM feedback').first()).n,0);
 }finally{f.DB.close();}});
test('unknown choices, malformed inputs, origin, expiry and repeated login are guarded',async()=>{assert.equal(score(bank,Object.fromEntries(items.map(i=>[i.id,-1]))).correct,0);assert.throws(()=>score(Object.fromEntries(items.map(i=>[i.id,'0']))));assert.equal(publicItems(bank).length,12);const f=await fixture();try{
 assert.equal((await f.call('me','GET',undefined,f.t1,'https://evil.invalid')).status,403);
 for(let i=0;i<15;i++)await f.call('login','POST',{login:'nonexistent',password:'bad'});
 assert.equal((await f.call('login','POST',{login:'nonexistent',password:'bad'})).status,429);
 await f.DB.prepare('UPDATE sessions SET expires=0').run();assert.equal((await f.call('me','GET',undefined,f.t1)).status,401);
 }finally{f.DB.close();}});
