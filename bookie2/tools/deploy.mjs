import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {passwordHash} from '../server/api.mjs';
const project='bookie2-legoschool',database='bookie2-legoschool-db';
if(!existsSync('.local/assessment-bank.json'))throw Error('비공개 진단 문항 파일 .local/assessment-bank.json을 준비해 주세요.');
function wr(args,capture=false){const r=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--yes','wrangler',...args],{shell:process.platform==='win32',windowsHide:true,encoding:'utf8',stdio:capture?'pipe':'inherit'});if(r.status!==0)throw Error('Cloudflare 명령을 완료하지 못했습니다. 로그인과 오류 메시지를 확인해 주세요.');return r.stdout||'';}
const status=wr(['whoami'],true);if(/not authenticated|not logged/i.test(status))throw Error('먼저 npx wrangler login 으로 Cloudflare에 로그인해 주세요.');
mkdirSync('.local',{recursive:true});
let config;
if(existsSync('wrangler.local.json'))config=JSON.parse(readFileSync('wrangler.local.json','utf8'));
else{
 const out=wr(['d1','create',database,'--location','apac','--update-config=false'],true);const id=out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];if(!id)throw Error('새 데이터베이스 ID를 확인하지 못했습니다. D1 대시보드에서 생성 결과를 확인해 주세요.');
 config={name:project,compatibility_date:'2026-09-13',pages_build_output_dir:'public',d1_databases:[{binding:'DB',database_name:database,database_id:id}],vars:{ALLOWED_ORIGINS:'https://legoschool.github.io'}};
 writeFileSync('wrangler.local.json',JSON.stringify(config,null,2));
}
if(config.name!==project||config.d1_databases?.[0]?.database_name!==database)throw Error('부기2 전용 설정이 아닙니다. 배포를 중단했습니다.');
wr(['d1','execute',database,'--remote','--file','server/schema.sql','--config','wrangler.local.json']);
const bank=JSON.parse(readFileSync('.local/assessment-bank.json','utf8'));
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
writeFileSync('.local/bank-seed.sql',`INSERT OR IGNORE INTO assessment_forms VALUES(${quote(bank.id)},${quote(JSON.stringify(bank))});`);
wr(['d1','execute',database,'--remote','--file','.local/bank-seed.sql','--config','wrangler.local.json']);
if(!existsSync('.local/teacher-access.txt')){
 const password=Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');const salt=crypto.randomUUID(),id=crypto.randomUUID(),hash=await passwordHash(password,salt);
 writeFileSync('.local/seed.sql',`INSERT OR IGNORE INTO users VALUES('${id}','teacher','선생님',NULL,'teacher','${salt}','${hash}');`);
 wr(['d1','execute',database,'--remote','--file','.local/seed.sql','--config','wrangler.local.json']);
 writeFileSync('.local/teacher-access.txt',`부기2 교사 입장\n주소: https://${project}.pages.dev/#/login/teacher\n아이디: teacher\n비밀번호: ${password}\n이 파일을 공유하거나 저장소에 올리지 마세요.\n`);
}
if(!existsSync('.local/pages-created')){wr(['pages','project','create',project,'--production-branch','main']);writeFileSync('.local/pages-created',project);}
wr(['pages','deploy','public','--project-name',project,'--branch','main','--config','wrangler.local.json']);
console.log('교사 입장 정보: .local/teacher-access.txt');
