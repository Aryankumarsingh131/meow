import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { database } from './database.ts'
const db=await database()
const team=randomUUID(),supervisor=randomUUID(),worker=randomUUID()
const email='demo.supervisor@jalsakshi.local'
const password=`Jal!${randomBytes(12).toString('base64url')}`
try{
 await db.query('begin')
 if((await db.query('select id from auth.users where email=$1',[email])).rowCount) throw new Error('Demo user already exists; no credentials or roles changed.')
 await db.query("insert into public.teams(id,name,data_mode) values($1,'Riverside Demo District','synthetic')",[team])
 for(const [id,account,secret,role] of [[supervisor,email,password,'supervisor'],[worker,'demo.worker@jalsakshi.local',randomBytes(32).toString('hex'),'worker']]){
  await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change_token_current,email_change,reauthentication_token) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,extensions.crypt($3,extensions.gen_salt('bf')),now(),'{\"provider\":\"email\",\"providers\":[\"email\"]}','{}',now(),now(),'','','','','','')",[id,account,secret])
  await db.query("insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at) values($1::uuid,$1::uuid,$1::text,jsonb_build_object('sub',$1::text,'email',$2::text,'email_verified',true),'email',now(),now())",[id,account])
  await db.query('insert into public.profiles(id,role,team_id) values($1,$2,$3)',[id,role,team])
 }
 const sources=[['Patel Nagar Hand Pump','Kalyanpur · Ward 4','flagged','Low residual chlorine suggested by strip analysis.','Worker observed a cracked drainage apron and stagnant water.'],['Shanti Nagar Borewell','Near primary health centre','uncertain','Image confidence insufficient; laboratory confirmation recommended.','Worker observed clear water with an unusual odour.'],['School Tube Well','Sector 4','flagged','Elevated nitrate suggested; this is a screening indication.','Worker reports discoloration following recent repairs.']]
 for(let i=0;i<sources.length;i++){
  const source=randomUUID(); const [name,locality,flag,machine,human]=sources[i]
  await db.query('insert into public.water_sources(id,team_id,name,locality) values($1,$2,$3,$4)',[source,team,name,locality])
  await db.query("insert into public.screening_records(team_id,source_id,sample_code,machine_suggestion,human_observation,screening_flag,captured_at,created_by) values($1,$2,$3,$4,$5,$6,now()-interval '1 day',$7)",[team,source,`DEMO-SAMPLE-${i+1}`,machine,human,flag,worker])
  if(i===0) await db.query("insert into public.ivr_complaints(team_id,source_id,summary) values($1,$2,'Synthetic caller report: intermittent odour near the hand pump. No personal caller data stored.')",[team,source])
 }
 await db.query('commit')
 writeFileSync('.demo-credentials.local',JSON.stringify({email,password,team_id:team,supervisor_id:supervisor,worker_id:worker},null,2))
 console.log(JSON.stringify({email,password,team:'Riverside Demo District'}))
}catch(e){await db.query('rollback');console.error(e instanceof Error?e.message:'Demo seed failed');process.exitCode=1}finally{await db.end()}
