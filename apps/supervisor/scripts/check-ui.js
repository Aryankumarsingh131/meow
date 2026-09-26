// oxlint-disable-next-line no-unused-expressions
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let authenticated = false;
  let rejectLogin = true;
  const profile = { id:'supervisor-demo', email:'ananya.rao@example.test', role:'supervisor', team_id:'team-demo', team_name:'Riverside District', dataMode:'synthetic' };
  const timestamp = '2026-09-22T09:30:00.000Z';
  const names = ['Kalyanpur Hand Pump','Devnadi Community Tap','Patel Nagar Borewell','Nirmalpur Tank','Sundargram Well','Chandipur Anganwadi'];
  const water_sources = names.map((name,index) => ({ id:'source-'+index, name, locality:name.split(' ')[0], team_id:profile.team_id, version:1 }));
  const cases = names.map((name,index) => ({ id:'RS-10'+(43+index), team_id:profile.team_id, source_id:'source-'+index, screening_id:'sample-'+index, origin:'screening', status:index===4?'closed':'under_review', priority:['critical','critical','urgent','normal','normal','urgent'][index], created_at:timestamp, version:1, closed_at:index===4?timestamp:null, closure_reason:index===4?'Resolved with evidence':null }));
  const screening_records = names.map((name,index) => ({ id:'sample-'+index, source_id:'source-'+index, sample_code:'RS-10'+(43+index), machine_suggestion:'Elevated turbidity indicated. Laboratory review recommended.', human_observation:'The field worker recorded cloudy water after rainfall.', screening_flag:'flagged', captured_at:timestamp, created_by:'worker-demo', capture_name:null }));
  const workspace = { profile, water_sources, cases, screening_records,
    lab_reports:[{ id:'lab-demo', case_id:cases[0].id, source_id:'source-0', screening_id:'sample-0', report_number:'LAB-028', lab_name:'District Water Laboratory', result:'Turbidity at 7.2 NTU', file_name:'report.pdf', file_sha256:'a'.repeat(64), uploaded_at:timestamp, uploaded_by:profile.id, verification_status:'uploaded', verified_at:null, verified_by:null, verification_note:null }],
    case_actions:[], retests:[], resident_communications:[],
    ivr_complaints:[{ id:'complaint-demo', source_id:null, case_id:null, summary:'Cloudy water reported at a community tap.', status:'new', received_at:timestamp, version:1 }],
    audit_log:[{ id:'audit-demo', entity_id:cases[0].id, sequence:1, occurred_at:timestamp, actor_id:profile.id, event:'case.created', event_hash:'b'.repeat(64), previous_hash:'', payload:{} }] };
  await page.unroute('**/api/**');
  await page.route('**/api/**', async route => {
    const path=route.request().url().replace(/^https?:\/\/[^/]+/,'').split('?')[0];
    if(path==='/api/auth/session') return route.fulfill({status:authenticated?200:401,json:authenticated?profile:{error:'Sign in required.'}});
    if(path==='/api/auth/login') { if(rejectLogin) return route.fulfill({status:401,json:{error:'Check your email and password, then try again.'}}); authenticated=true; return route.fulfill({json:profile}); }
    if(path==='/api/auth/logout') {authenticated=false;return route.fulfill({json:{ok:true}});}
    if(path==='/api/supervisor/workspace') return route.fulfill({json:workspace});
    if(path==='/api/supervisor/export') return route.fulfill({contentType:'text/csv',body:'data_mode,metric,count\nsynthetic,total_cases,6\n'});
    if(path==='/api/supervisor/rpc/verify_case_audit') return route.fulfill({json:{valid:true}});
    return route.fulfill({status:400,json:{error:'Fixture mutation is not persisted.'}});
  });
  const nav=label=>page.getByRole('navigation',{name:'Main navigation'}).getByText(label,{exact:true});
  const capture=async name=>{
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));window.scrollTo(0,0);});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+': horizontal overflow');
    await page.screenshot({path:'.impeccable/review/'+name+'.png',fullPage:false,animations:'disabled'});
  };
  await page.setViewportSize({width:1586,height:992});
  await page.goto('http://127.0.0.1:5175/');
  await page.getByRole('heading',{name:'Welcome back.'}).waitFor();
  await capture('reference-login-after');
  await page.setViewportSize({width:390,height:844});
  await capture('reference-login-mobile');
  await page.setViewportSize({width:1586,height:992});
  await page.getByLabel('Email address').fill(profile.email);
  await page.getByLabel('Password',{exact:true}).fill('test-password');
  await page.getByRole('button',{name:'Show password'}).click();
  assert(await page.getByLabel('Password',{exact:true}).getAttribute('type')==='text','Password toggle failed');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Check your email'}).waitFor();
  rejectLogin=false;
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Good morning, Ananya.'}).waitFor();
  await capture('reference-overview-after');
  await page.getByRole('button',{name:'All dates'}).click();
  await page.getByLabel('From').fill('2025-01-01');
  await page.getByLabel('To').fill('2025-12-31');
  await page.getByRole('button',{name:'Apply'}).click();
  assert(await page.getByRole('button',{name:/Total Sources/}).count()===1,'Overview should remain available under date filtering');
  await page.getByRole('button',{name:/2025-01-01/}).click();
  await page.getByRole('button',{name:'Clear dates'}).click();
  await nav('Labs').click();
  await page.getByRole('heading',{name:'Lab Portal'}).waitFor();
  await capture('reference-lab-after');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  assert(await page.getByRole('heading',{name:'RS-1044'}).count()===1,'Next sample failed');
  await page.getByLabel('Filter sample status').selectOption('Pending');
  assert(await page.locator('.reference-lab-queue__list > button').count()===5,'Filter failed');
  await page.getByLabel('Filter sample status').selectOption('all');
  await nav('Overview').click();
  await page.setViewportSize({width:390,height:844});
  await capture('reference-overview-mobile');
  await page.getByRole('button',{name:'Open menu'}).click();
  await nav('Labs').click();
  await capture('reference-lab-mobile');
  await page.setViewportSize({width:768,height:1024});
  await capture('reference-lab-tablet');
  await nav('Overview').click();
  await capture('reference-overview-tablet');
  await page.setViewportSize({width:1586,height:992});
  await nav('Cases').click();
  await page.getByRole('heading',{name:'Cases',exact:true}).waitFor();
  await page.locator('.queue-row').first().click();
  await page.getByRole('heading',{name:names[0],exact:true}).waitFor();
  await nav('Reports').click();
  await page.getByRole('heading',{name:'Current team activity'}).waitFor();
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export aggregate CSV'}).click();
  assert((await downloadEvent).suggestedFilename()==='jalsakshi-safe-summary.csv','CSV export failed');
  assert(errors.length===0,'Browser errors: '+errors.join('; '));
  console.log('Reference UI checks passed: auth, overview, lab queue, responsive widths, case review, reports export.');
}
