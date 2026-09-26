import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { database } from './database.ts'
const db=await database();let passed=0
const ids={team:randomUUID(),otherTeam:randomUUID(),supervisor:randomUUID(),other:randomUUID(),worker:randomUUID(),source:randomUUID(),otherSource:randomUUID(),screening:randomUUID()}
async function asUser(id:string){await db.query('reset role');await db.query("select set_config('request.jwt.claims',$1::text,true)",[JSON.stringify({sub:id,role:'authenticated'})]);await db.query('set local role authenticated')}
async function rejected(sql:string,params:unknown[],code:string){await db.query('savepoint reject_test');try{await db.query(sql,params);assert.fail('Expected rejection')}catch(e){assert.equal((e as {code?:string}).code,code)}finally{await db.query('rollback to savepoint reject_test')}passed++}
try{
 await db.query('begin')
 await db.query("insert into public.teams(id,name) values($1::uuid,'Rollback test'),($2::uuid,'Other team')",[ids.team,ids.otherTeam])
 for(const id of [ids.supervisor,ids.other,ids.worker]) await db.query("insert into auth.users(id,email) values($1::uuid,$1::text || '@test.local')",[id])
 await db.query("insert into public.profiles(id,role,team_id,email) values($1::uuid,'supervisor',$4::uuid,$1::text || '@test.local'),($2::uuid,'supervisor',$5::uuid,$2::text || '@test.local'),($3::uuid,'worker',$4::uuid,$4::text || '@test.local')",[ids.supervisor,ids.other,ids.worker,ids.team,ids.otherTeam])
 await db.query("insert into public.water_sources(id,team_id,name) values($1::uuid,$3::uuid,'Source A'),($2::uuid,$3::uuid,'Source B')",[ids.source,ids.otherSource,ids.team])
 await db.query("insert into public.screening_records(id,team_id,source_id,sample_code,machine_suggestion,human_observation,screening_flag,captured_at,created_by) values($1::uuid,$2::uuid,$3::uuid,'TEST-1','uncertain','worker observed haze','uncertain',now()-interval '2 days',$4::uuid)",[ids.screening,ids.team,ids.source,ids.worker])
 const caseId=(await db.query('select id from public.cases where screening_id=$1::uuid',[ids.screening])).rows[0].id
 await asUser(ids.other)
 assert.equal((await db.query('select * from public.cases where id=$1::uuid',[caseId])).rowCount,0);passed++
 await rejected("select public.close_case($1::uuid,1,'outside jurisdiction')",[caseId],'42501')
 await asUser(ids.worker)
 assert.equal((await db.query('select * from public.cases')).rowCount,0);passed++
 await asUser(ids.supervisor)
 await rejected("update public.cases set status='closed' where id=$1::uuid",[caseId],'42501')
 await rejected("update public.profiles set role='worker' where id=$1::uuid",[ids.supervisor],'42501')
 await rejected("select public.close_case($1::uuid,1,'no evidence')",[caseId],'23514')
 const reportSql="insert into public.lab_reports(team_id,case_id,source_id,screening_id,report_number,lab_name,result,file_name,file_type,file_base64,expected_case_version) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'TEST','Test lab','No contaminant detected','test.pdf','application/pdf','JVBERi0xLjQ=',1) returning id"
 await rejected(reportSql,[ids.team,caseId,ids.otherSource,ids.screening],'23514')
 const report=(await db.query(reportSql,[ids.team,caseId,ids.source,ids.screening])).rows[0].id
 assert.equal((await db.query('select verification_status from public.lab_reports where id=$1::uuid',[report])).rows[0].verification_status,'uploaded');passed++
 await rejected("select public.close_case($1::uuid,2,'uploaded is not verified')",[caseId],'23514')
 await rejected("update public.lab_reports set verification_status='verified' where id=$1::uuid",[report],'42501')
 await db.query("select public.verify_lab_report($1::uuid,2,'Matched report and sample')",[report]);passed++
 await rejected("select public.close_case($1::uuid,2,'stale supervisor')",[caseId],'PT409')
 await db.query("select public.close_case($1::uuid,3,'Confirmed evidence reviewed')",[caseId]);passed++
 await rejected("select public.close_case($1::uuid,3,'duplicate closure')",[caseId],'23505')
 assert.equal((await db.query('select public.verify_case_audit($1::uuid) valid',[caseId])).rows[0].valid,true);passed++
 await rejected('update public.audit_log set event=$1::text where entity_id=$2::uuid',['tampered',caseId],'42501')
 await db.query('reset role')
 const second=(await db.query("insert into public.cases(team_id,source_id,origin) values($1::uuid,$2::uuid,'ivr') returning id",[ids.team,ids.source])).rows[0].id
 await asUser(ids.supervisor)
 const retest=(await db.query("insert into public.retests(team_id,case_id,due_at,instructions,expected_case_version) values($1::uuid,$2::uuid,now()+interval '1 day','Collect follow-up',1) returning id",[ids.team,second])).rows[0].id
 await rejected('update public.retests set linked_screening_id=$1::uuid,expected_case_version=2 where id=$2::uuid',[ids.screening,retest],'23514')
 await rejected("insert into public.resident_communications(team_id,case_id,channel,message_summary,delivery_status,delivery_reference,expected_case_version) values($1::uuid,$2::uuid,'sms','update','sent','REF',2)",[ids.team,second],'23502')
 await asUser(ids.worker)
 const followup=(await db.query("insert into public.screening_records(team_id,source_id,sample_code,machine_suggestion,human_observation,screening_flag,captured_at) values($1::uuid,$2::uuid,'FOLLOWUP','clear','Worker confirmed clear','clear',now()) returning id",[ids.team,ids.source])).rows[0].id
 await asUser(ids.supervisor)
 await db.query('update public.retests set linked_screening_id=$1::uuid,expected_case_version=2 where id=$2::uuid',[followup,retest]);passed++
 await db.query("select public.close_case($1::uuid,3,'Completed retest reviewed')",[second]);passed++
 await db.query('rollback')
 console.log(`PASS: ${passed} database checks (RLS, guarded verification/closure, stale writes, audit chain, retest identity, sent timestamp). All fixtures rolled back.`)
}catch(error){await db.query('rollback');console.error(error instanceof Error?error.message:'Database test failed');process.exitCode=1}finally{await db.end()}

