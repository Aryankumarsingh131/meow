import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {database} from './database.ts'
const credentials=JSON.parse(readFileSync('.demo-credentials.local','utf8'))
const base=process.env.JALSAKSHI_TEST_URL||'http://127.0.0.1:5175'
const db=await database();const source=randomUUID(),sample=randomUUID(),complaint=randomUUID();let caseId:string
try{
 const team=(await db.query('select data_mode from public.teams where id=$1',[credentials.team_id])).rows[0]
 assert.equal(team?.data_mode,'synthetic','Integration test must only write to the demo synthetic team')
 await db.query('begin')
 await db.query("insert into public.water_sources(id,team_id,name,locality) values($1,$2,'Concurrency demonstration','Synthetic test source')",[source,credentials.team_id])
 await db.query("insert into public.screening_records(id,team_id,source_id,sample_code,machine_suggestion,human_observation,screening_flag,captured_at,created_by) values($1,$2,$3,$4,'Synthetic flagged screening','Synthetic worker observation','flagged',now()-interval '1 day',$5)",[sample,credentials.team_id,source,`TEST-${sample.slice(0,8)}`,credentials.worker_id])
 caseId=(await db.query('select id from public.cases where screening_id=$1',[sample])).rows[0].id
 await db.query("insert into public.ivr_complaints(id,team_id,source_id,summary) values($1,$2,$3,'Synthetic simultaneous-escalation test')",[complaint,credentials.team_id,source])
 await db.query('commit')
}catch(e){await db.query('rollback');throw e}finally{await db.end()}
const signIn=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:credentials.email,password:credentials.password})});assert.equal(signIn.status,200)
const cookie=signIn.headers.get('set-cookie')!.split(';')[0]
const headers={Origin:base,'Content-Type':'application/json',Cookie:cookie}
const action=(path:string,body:object)=>fetch(`${base}/api/supervisor/${path}`,{method:'POST',headers,body:JSON.stringify(body)})
let response=await action('rpc/close_case',{p_case_id:caseId,p_expected_version:1,p_reason:'No evidence'})
assert.equal(response.status,422)
response=await action('lab_reports',{case_id:caseId,source_id:source,screening_id:sample,report_number:`SYNTH-${sample.slice(0,8)}`,lab_name:'Synthetic test laboratory',result:'Synthetic clear laboratory result; not a real measurement.',file_name:'synthetic-test.pdf',file_type:'application/pdf',file_base64:Buffer.from('%PDF-1.4\n% Synthetic test attachment\n%%EOF').toString('base64'),expected_case_version:1})
assert.equal(response.status,200,await response.text())
response=await action('rpc/close_case',{p_case_id:caseId,p_expected_version:2,p_reason:'Still unverified'})
assert.equal(response.status,422)
const workspace=await (await fetch(`${base}/api/supervisor/workspace`,{headers})).json() as {lab_reports:Array<{id:string;case_id:string}>}
const report=workspace.lab_reports.find(r=>r.case_id===caseId)!
response=await action('rpc/verify_lab_report',{p_report_id:report.id,p_expected_version:2,p_note:'Synthetic source and sample matched for concurrency test.'});assert.equal(response.status,200,await response.text())
const closures=await Promise.all([action('rpc/close_case',{p_case_id:caseId,p_expected_version:3,p_reason:'First concurrent closure'}),action('rpc/close_case',{p_case_id:caseId,p_expected_version:3,p_reason:'Second concurrent closure'})])
assert.deepEqual(closures.map(r=>r.status).sort(),[200,409])
const audit=await (await action('rpc/verify_case_audit',{p_case_id:caseId})).json() as {valid:boolean};assert.equal(audit.valid,true)
const escalations=await Promise.all([action('rpc/create_case_from_ivr',{p_complaint_id:complaint,p_complaint_version:1,p_source_id:source}),action('rpc/create_case_from_ivr',{p_complaint_id:complaint,p_complaint_version:1,p_source_id:source})]);assert.deepEqual(escalations.map(r=>r.status).sort(),[200,409], JSON.stringify(await Promise.all(escalations.map(async r=>({status:r.status,body:await r.text()})))))
const summary=await (await fetch(`${base}/api/supervisor/export`,{headers})).text()
for(const privateValue of [caseId,source,sample,credentials.email,'Synthetic worker observation','Synthetic test laboratory','file_base64']) assert(!summary.includes(privateValue))
assert.match(summary,/^data_mode,metric,count/)
console.log('PASS: live demo login, missing-evidence rejection, upload != verification, concurrent closure (one success / one conflict), audit chain, concurrent IVR escalation (no duplicate), aggregate export privacy.')
console.log('Synthetic concurrency demonstration records retained in the demo team for inspection.')
