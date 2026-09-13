// The answer bank lives only in the server database. This module contains no answer key.
export const FORM='vocabulary-pilot-v1';
export const domains={meaning:'낱말 뜻',context:'문맥 속 뜻',relation:'낱말 관계'};
export function validateBank(bank){
 if(!bank||!Array.isArray(bank.items)||bank.items.length!==12)throw Error('검토한 12문항을 서버에 등록해 주세요.');
 const ids=new Set();
 for(const q of bank.items){if(typeof q.id!=='string'||ids.has(q.id)||!domains[q.domain]||typeof q.context!=='string'||typeof q.prompt!=='string'||!Array.isArray(q.options)||q.options.length<2||q.options.some(o=>typeof o!=='string')||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length)throw Error('문항 형식을 확인해 주세요.');ids.add(q.id);}
 return bank;
}
export const publicItems=bank=>validateBank(bank).items.map(({id,context,prompt,options})=>({id,context,prompt,options}));
export function score(bank,answers){
 const items=validateBank(bank).items;
 if(!answers||Array.isArray(answers)||typeof answers!=='object'||Object.keys(answers).length!==items.length)throw Error('모든 문항에 응답해 주세요.');
 const detail={};for(const d of Object.keys(domains))detail[d]={correct:0,total:0,unknown:0};
 for(const q of items){const a=answers[q.id];if(!Number.isInteger(a)||a < -1||a>=q.options.length)throw Error('응답 형식이 맞지 않습니다.');detail[q.domain].total++;if(a===q.answer)detail[q.domain].correct++;if(a===-1)detail[q.domain].unknown++;}
 const correct=Object.values(detail).reduce((n,d)=>n+d.correct,0);
 return {form:bank.id,correct,total:items.length,domains:detail,suggestion:correct<=5?'쉬움':correct<=9?'중간':'어려움',note:'자체 제작 시범 문항입니다. 표준화 검사나 학년 규준이 아니며 교사가 응답과 수업 관찰을 함께 확인합니다.'};
}
