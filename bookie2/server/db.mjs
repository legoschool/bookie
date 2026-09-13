import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {passwordHash} from './api.mjs';
export function openDB(path=':memory:'){
 const raw=new DatabaseSync(path);raw.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const db={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return raw.prepare(sql).get(...args)||null;},async all(){return {results:raw.prepare(sql).all(...args)};},async run(){const r=raw.prepare(sql).run(...args);return {meta:{changes:r.changes}};}};},async batch(stmts){raw.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());raw.exec('COMMIT');return r;}catch(e){raw.exec('ROLLBACK');throw e;}},close(){raw.close();}};return db;
}
export async function seedTeacher(db,login,password,name='선생님'){
 if(password.length<12)throw Error('교사 비밀번호는 12자 이상으로 정해 주세요.');
 const salt=crypto.randomUUID();await db.prepare('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'teacher',name,null,login.toLowerCase(),salt,await passwordHash(password,salt)).run();
}

export async function seedBank(db,bank){await db.prepare('INSERT OR IGNORE INTO assessment_forms VALUES(?,?)').bind(bank.id,JSON.stringify(bank)).run();}
