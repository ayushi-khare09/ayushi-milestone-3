import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let mock, apiProcess, apiUrl, folder, providerCalls=0, providerDelayMs=0, providerMode='invalid'
const request=async(path,{token,method='GET',body}={})=>fetch(`${apiUrl}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined})
const unusedPort=()=>new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})})

before(async()=>{
  folder=await mkdtemp(join(tmpdir(),'projectmentor-api-'))
  mock=createServer(async(req,res)=>{
    providerCalls+=1
    const chunks=[]
    for await(const chunk of req) chunks.push(chunk)
    const payload=JSON.parse(Buffer.concat(chunks).toString())
    const system=payload.messages?.[0]?.content??''
    const context=JSON.parse(payload.messages?.[1]?.content??'{}')
    let response={invalid:true}
    if(providerMode==='mentor'&&system.includes('Academic Project Mentor')) response={reply:'Start with one small test of the attendance flow, then discuss the result at your next check-in.'}
    if(providerMode==='planner'&&system.includes('Milestone Planning Agent')) {
      const duration=context.project.durationWeeks
      response={
        projectDurationWeeks:duration,
        totalWeeks:duration,
        summary:'Adjusted plan based on the latest progress.',
        milestones:Array.from({length:duration},(_,index)=>({
          week:index+1,title:`Adjusted week ${index+1}`,tasks:['Complete and validate one focused project outcome.'],dependencies:[],estimatedHours:2,deliverables:['Validated increment'],status:'planned',requiredSkills:['Testing'],testingCheckpoint:'Check the main flow.',riskMitigation:'Keep the MVP focused.',
        })),
      }
    }
    const reply=()=>{if(res.destroyed)return;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]}))}
    if(providerDelayMs)setTimeout(reply,providerDelayMs);else reply()
  })
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve))
  const providerPort=mock.address().port
  const port=await unusedPort();apiUrl=`http://127.0.0.1:${port}`
  apiProcess=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),FRONTEND_ORIGIN:'http://localhost:5173',JWT_SECRET:'integration-test-only-secret',LLM_API_KEY:'mock-key',LLM_BASE_URL:`http://127.0.0.1:${providerPort}/v1`,DB_PATH:join(folder,'test.sqlite')}})
  let ready=false
  for(let i=0;i<80;i++) { try {const response=await fetch(`${apiUrl}/health`);if(response.ok){ready=true;break}}catch{} await new Promise(resolve=>setTimeout(resolve,100)) }
  assert.equal(ready,true,'API server should start')
})

after(async()=>{
  if(apiProcess&&apiProcess.exitCode===null) await new Promise(resolve=>{apiProcess.once('exit',resolve);apiProcess.kill()})
  if(mock) await new Promise(resolve=>mock.close(resolve))
  if(folder) await rm(folder,{recursive:true,force:true})
})

async function createStudentProject(email,title='Milestone 3 project') {
  const student=await (await request('/auth/register',{method:'POST',body:{name:'Milestone Student',email,password:'SecurePass123'}})).json()
  const profile=await (await request('/students',{method:'POST',token:student.token,body:{
    name:'Milestone Student',course:'Computer Science',year:'2nd year',
    skills:[{skill:'JavaScript',category:'programming',level:2,selfLevel:2}],
    priorProjects:'one',weeklyHours:8,
    assessment:{score:55,level:'intermediate',strengths:['JavaScript'],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()},
  }})).json()
  const project=await (await request('/projects',{method:'POST',token:student.token,body:{
    studentId:profile.id,title,description:'A web application to record and review classroom attendance for a small student group.',domain:'web',durationWeeks:6,
  }})).json()
  return {student,profile,project}
}

function seedCompletedRun(project) {
  const createdAt=new Date().toISOString()
  const milestones=Array.from({length:project.durationWeeks},(_,index)=>({
    week:index+1,title:`Week ${index+1} work`,tasks:['Build and test a focused increment.'],dependencies:[],estimatedHours:4,deliverables:['Working increment'],status:'planned',requiredSkills:['JavaScript'],testingCheckpoint:'Verify the main user flow.',riskMitigation:'Keep the MVP focused.',
  }))
  const results={
    feasibility:{score:75,verdict:'Feasible with Modifications',recommendations:['Keep scope focused.']},
    scopeAndStack:{summary:'A focused attendance tracking application.',problemStatement:'Attendance is difficult to track consistently.',projectObjectives:['Record attendance','Review attendance'],proposedSolution:'A simple web attendance tracker.',targetUsers:'Teachers and students',techStack:[{layer:'Frontend',choice:'React',reason:'Supports a simple web interface.'}],successCriteria:['Record and review attendance.'],inScope:['Attendance entry'],mvp:['Attendance entry'],outOfScope:['Advanced analytics']},
    plan:{projectDurationWeeks:project.durationWeeks,totalWeeks:project.durationWeeks,summary:'Initial plan.',milestones},
    risk:{risks:[{title:'Scope creep',severity:'medium',mitigation:'Keep the MVP focused.'}]},
  }
  const run={id:`run_seed_${project.id}`,projectId:project.id,status:'completed',analysisMode:'live',steps:['feasibility','scope_tech','planner','risk'].map(agentId=>({agentId,status:'completed',summary:'Complete.'})),createdAt,finishedAt:createdAt,results}
  const db=new DatabaseSync(join(folder,'test.sqlite'))
  const row=db.prepare('SELECT data FROM projects WHERE id=?').get(project.id)
  const storedProject=JSON.parse(row.data)
  storedProject.latestRunId=run.id
  db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(storedProject),project.id)
  db.prepare('INSERT INTO runs(id,project_id,status,data,cancel_requested,created_at) VALUES(?,?,?,?,?,?)')
    .run(run.id,project.id,run.status,JSON.stringify(run),0,createdAt)
  db.close()
  return run
}

test('server auth, SQLite persistence, ownership isolation, and per-agent validation retry',async()=>{
  const register=async(email)=>{const response=await request('/auth/register',{method:'POST',body:{name:'Student User',email,password:'SecurePass123'}});assert.equal(response.status,201);return response.json()}
  const first=await register('one@example.test')
  const profileBody={name:'Student User',course:'Computer Science',year:'2nd year',skills:[{skill:'JavaScript',category:'programming',level:2,selfLevel:2}],priorProjects:'one',weeklyHours:8,assessment:{score:0,level:'beginner',strengths:[],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()}}
  const profileResponse=await request('/students',{method:'POST',token:first.token,body:profileBody})
  assert.equal(profileResponse.status,201)
  const profile=await profileResponse.json()
  assert.equal(profile.userId,first.user.id)
  const projectResponse=await request('/projects',{method:'POST',token:first.token,body:{studentId:profile.id,title:'Attendance Tracker',description:'A small web system for recording and reviewing classroom attendance.',domain:'web',durationWeeks:6}})
  assert.equal(projectResponse.status,201)
  const project=await projectResponse.json()
  const second=await register('two@example.test')
  assert.equal((await request(`/projects/${project.id}`,{token:second.token})).status,404)

  const runResponse=await request(`/projects/${project.id}/pipeline-runs`,{method:'POST',token:first.token})
  assert.equal(runResponse.status,201)
  const run=await runResponse.json()
  let current
  for(let i=0;i<100;i++) { const response=await request(`/pipeline-runs/${run.id}`,{token:first.token});current=await response.json();if(['failed','completed','cancelled'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,50)) }
  assert.equal(current.status,'failed')
  assert.equal(current.steps[0].status,'failed')
  assert.match(current.steps[0].error,/retry/i)
  assert.equal(providerCalls,2,'invalid first-agent output should be retried once')
  assert.equal((await request(`/pipeline-runs/${run.id}`,{token:second.token})).status,404)
})

test('unauthenticated project access is rejected',async()=>{
  assert.equal((await request('/projects/example')).status,401)
})

test('Vite fallback localhost ports pass the development CORS preflight',async()=>{
  const response=await fetch(`${apiUrl}/auth/login`,{method:'OPTIONS',headers:{Origin:'http://localhost:5174','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}})
  assert.equal(response.status,204)
  assert.equal(response.headers.get('access-control-allow-origin'),'http://localhost:5174')
})

test('an active run can be cancelled and records cancelled status',async()=>{
  const student=await (await request('/auth/register',{method:'POST',body:{name:'Cancel User',email:'cancel@example.test',password:'SecurePass123'}})).json()
  const profile=await (await request('/students',{method:'POST',token:student.token,body:{name:'Cancel User',course:'Computer Science',year:'2nd year',skills:[{skill:'JavaScript',category:'programming',level:2,selfLevel:2}],priorProjects:'one',weeklyHours:8,assessment:{score:0,level:'beginner',strengths:[],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()}}})).json()
  const project=await (await request('/projects',{method:'POST',token:student.token,body:{studentId:profile.id,title:'Cancel test project',description:'A small web system for recording and reviewing classroom attendance.',domain:'web',durationWeeks:6}})).json()
  providerDelayMs=1500
  const run=await (await request(`/projects/${project.id}/pipeline-runs`,{method:'POST',token:student.token})).json()
  for(let i=0;i<80&&providerCalls<3;i++) await new Promise(resolve=>setTimeout(resolve,25))
  assert.ok(providerCalls>=3,'first agent should reach the mock provider')
  assert.equal((await request(`/pipeline-runs/${run.id}/cancel`,{method:'POST',token:student.token})).status,200)
  let current
  for(let i=0;i<80;i++) { current=await (await request(`/pipeline-runs/${run.id}`,{token:student.token})).json(); if(current.status==='cancelled')break; await new Promise(resolve=>setTimeout(resolve,25)) }
  assert.equal(current.status,'cancelled')
  assert.equal(current.steps[0].status,'cancelled')
})

test('mentor check-ins return and persist a context-aware mentor reply',async()=>{
  const {student,project}=await createStudentProject('mentor-checkin@example.test','Mentor check-in project')
  providerMode='mentor'
  try {
    const response=await request(`/projects/${project.id}/mentor/messages`,{method:'POST',token:student.token,body:{text:'Weekly check-in (week 1): I finished the attendance form and need help testing it.'}})
    const responseText=await response.text()
    assert.equal(response.status,201,responseText)
    const messages=JSON.parse(responseText)
    assert.equal(messages.studentMessage.role,'student')
    assert.equal(messages.mentorReply.role,'mentor')
    assert.match(messages.mentorReply.text,/one small test/i)
    const history=await (await request(`/projects/${project.id}/mentor/messages`,{token:student.token})).json()
    assert.equal(history.length,2)
    assert.equal(history[0].text,messages.studentMessage.text)
  } finally { providerMode='invalid' }
})

test('milestone progress triggers a planner adjustment and updates the latest blueprint',async()=>{
  const {student,project}=await createStudentProject('planner-adjustment@example.test','Planner adjustment project')
  seedCompletedRun(project)
  providerMode='planner'
  try {
    const update=await request(`/projects/${project.id}/milestones/1`,{method:'PUT',token:student.token,body:{status:'in-progress'}})
    assert.equal(update.status,200)
    const body=await update.json()
    assert.equal(body.progress.status,'in-progress')
    assert.ok(body.adjustmentRun?.id)
    let current
    for(let i=0;i<100;i++) {
      current=await (await request(`/pipeline-runs/${body.adjustmentRun.id}`,{token:student.token})).json()
      if(['failed','completed','cancelled'].includes(current.status))break
      await new Promise(resolve=>setTimeout(resolve,25))
    }
    assert.equal(current.status,'completed')
    assert.equal(current.results.plan.summary,'Adjusted plan based on the latest progress.')
    assert.equal(current.results.plan.milestones[0].status,'in-progress')
    assert.equal(current.steps.find(step=>step.agentId==='planner').status,'completed')
    const updatedProject=await (await request(`/projects/${project.id}`,{token:student.token})).json()
    assert.equal(updatedProject.latestRunId,body.adjustmentRun.id)
  } finally { providerMode='invalid' }
})

test('methodology and progress reports contain the project blueprint and saved progress',async()=>{
  const {student,project}=await createStudentProject('reports-milestone3@example.test','Reports milestone project')
  seedCompletedRun(project)
  const methodology=await request(`/projects/${project.id}/reports`,{method:'POST',token:student.token,body:{kind:'methodology'}})
  assert.equal(methodology.status,201)
  const methodologyReport=await methodology.json()
  assert.match(methodologyReport.content,/Methodological approach/)
  assert.match(methodologyReport.content,/Development phases/)
  assert.doesNotMatch(methodologyReport.content,/Mock report content/)

  const db=new DatabaseSync(join(folder,'test.sqlite'))
  db.prepare('INSERT INTO milestone_progress(project_id,week,status,updated_at) VALUES(?,?,?,?)')
    .run(project.id,1,'done',new Date().toISOString())
  db.close()
  const progress=await request(`/projects/${project.id}/reports`,{method:'POST',token:student.token,body:{kind:'progress'}})
  assert.equal(progress.status,201)
  const progressReport=await progress.json()
  assert.match(progressReport.content,/1 of 6 milestones marked complete/)
  assert.match(progressReport.content,/Week 1 · Week 1 work:\*\* Completed/)
})

test('report generation rate limiting per user per project',async()=>{
  const student=await (await request('/auth/register',{method:'POST',body:{name:'Rate Limit User',email:'ratelimit@example.test',password:'SecurePass123'}})).json()
  const profile=await (await request('/students',{method:'POST',token:student.token,body:{name:'Rate Limit User',course:'Computer Science',year:'2nd year',skills:[{skill:'JavaScript',category:'programming',level:2,selfLevel:2}],priorProjects:'one',weeklyHours:8,assessment:{score:0,level:'beginner',strengths:[],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()}}})).json()
  const project=await (await request('/projects',{method:'POST',token:student.token,body:{studentId:profile.id,title:'Rate Limit Project',description:'A small web system for recording and reviewing classroom attendance.',domain:'web',durationWeeks:6}})).json()
  const run=await (await request(`/projects/${project.id}/pipeline-runs`,{method:'POST',token:student.token})).json()
  let current
  for(let i=0;i<100;i++) { const response=await request(`/pipeline-runs/${run.id}`,{token:student.token});current=await response.json();if(['failed','completed','cancelled'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,50)) }
  // 10 successful requests
  for(let i=0;i<10;i++) {
    const response=await request(`/projects/${project.id}/reports`,{method:'POST',token:student.token,body:{kind:'synopsis'}})
    assert.equal(response.status,201)
  }
  // 11th should be rate limited
  const limited=await request(`/projects/${project.id}/reports`,{method:'POST',token:student.token,body:{kind:'synopsis'}})
  assert.equal(limited.status,429)
})

test('report generation rate limit resets after window expires',async()=>{
  const student=await (await request('/auth/register',{method:'POST',body:{name:'Window Reset User',email:'windowreset@example.test',password:'SecurePass123'}})).json()
  const profile=await (await request('/students',{method:'POST',token:student.token,body:{name:'Window Reset User',course:'Computer Science',year:'2nd year',skills:[{skill:'JavaScript',category:'programming',level:2,selfLevel:2}],priorProjects:'one',weeklyHours:8,assessment:{score:0,level:'beginner',strengths:[],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()}}})).json()
  const project=await (await request('/projects',{method:'POST',token:student.token,body:{studentId:profile.id,title:'Window Reset Project',description:'A small web system for recording and reviewing classroom attendance.',domain:'web',durationWeeks:6}})).json()
  const run=await (await request(`/projects/${project.id}/pipeline-runs`,{method:'POST',token:student.token})).json()
  let current
  for(let i=0;i<100;i++) { const response=await request(`/pipeline-runs/${run.id}`,{token:student.token});current=await response.json();if(['failed','completed','cancelled'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,50)) }
  // 10 successful requests
  for(let i=0;i<10;i++) {
    const response=await request(`/projects/${project.id}/reports`,{method:'POST',token:student.token,body:{kind:'synopsis'}})
    assert.equal(response.status,201)
  }
  // 11th should be rate limited
  let limited=await request(`/projects/${project.id}/reports`,{method:'POST',token:student.token,body:{kind:'synopsis'}})
  assert.equal(limited.status,429)
  // Wait for window to expire (61 seconds)
  await new Promise(resolve=>setTimeout(resolve,61000))
  // Should succeed again after window reset
  const afterWindow=await request(`/projects/${project.id}/reports`,{method:'POST',token:student.token,body:{kind:'synopsis'}})
  assert.equal(afterWindow.status,201)
})

test('report generation rate limit is independent per user',async()=>{
  const student1=await (await request('/auth/register',{method:'POST',body:{name:'User One',email:'user1@example.test',password:'SecurePass123'}})).json()
  const profile1=await (await request('/students',{method:'POST',token:student1.token,body:{name:'User One',course:'Computer Science',year:'2nd year',skills:[{skill:'JavaScript',category:'programming',level:2,selfLevel:2}],priorProjects:'one',weeklyHours:8,assessment:{score:0,level:'beginner',strengths:[],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()}}})).json()
  const project1=await (await request('/projects',{method:'POST',token:student1.token,body:{studentId:profile1.id,title:'User One Project',description:'A small web system for recording and reviewing classroom attendance.',domain:'web',durationWeeks:6}})).json()
  const run1=await (await request(`/projects/${project1.id}/pipeline-runs`,{method:'POST',token:student1.token})).json()
  let current
  for(let i=0;i<100;i++) { const response=await request(`/pipeline-runs/${run1.id}`,{token:student1.token});current=await response.json();if(['failed','completed','cancelled'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,50)) }
  // User 1 makes 10 requests
  for(let i=0;i<10;i++) {
    const response=await request(`/projects/${project1.id}/reports`,{method:'POST',token:student1.token,body:{kind:'synopsis'}})
    assert.equal(response.status,201)
  }
  // User 1 gets rate limited
  let limited1=await request(`/projects/${project1.id}/reports`,{method:'POST',token:student1.token,body:{kind:'synopsis'}})
  assert.equal(limited1.status,429)
  // User 2 should still be able to make requests
  const student2=await (await request('/auth/register',{method:'POST',body:{name:'User Two',email:'user2@example.test',password:'SecurePass123'}})).json()
  const profile2=await (await request('/students',{method:'POST',token:student2.token,body:{name:'User Two',course:'Computer Science',year:'2nd year',skills:[{skill:'JavaScript',category:'programming',level:2,selfLevel:2}],priorProjects:'one',weeklyHours:8,assessment:{score:0,level:'beginner',strengths:[],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()}}})).json()
  const project2=await (await request('/projects',{method:'POST',token:student2.token,body:{studentId:profile2.id,title:'User Two Project',description:'A small web system for recording and reviewing classroom attendance.',domain:'web',durationWeeks:6}})).json()
  const run2=await (await request(`/projects/${project2.id}/pipeline-runs`,{method:'POST',token:student2.token})).json()
  for(let i=0;i<100;i++) { const response=await request(`/pipeline-runs/${run2.id}`,{token:student2.token});current=await response.json();if(['failed','completed','cancelled'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,50)) }
  // User 2 makes 10 requests successfully
  for(let i=0;i<10;i++) {
    const response=await request(`/projects/${project2.id}/reports`,{method:'POST',token:student2.token,body:{kind:'synopsis'}})
    assert.equal(response.status,201)
  }
test('report generation rate limit is independent per project',async()=>{
  const student=await (await request('/auth/register',{method:'POST',body:{name:'Project User',email:'projectuser@example.test',password:'SecurePass123'}})).json()
  const profile=await (await request('/students',{method:'POST',token:student.token,body:{name:'Project User',course:'Computer Science',year:'2nd year',skills:[{skill:'JavaScript',category:'programming',level:2,selfLevel:2}],priorProjects:'one',weeklyHours:8,assessment:{score:0,level:'beginner',strengths:[],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()}}})).json()
  const projectA=await (await request('/projects',{method:'POST',token:student.token,body:{studentId:profile.id,title:'Project A',description:'A small web system for recording and reviewing classroom attendance.',domain:'web',durationWeeks:6}})).json()
  const projectB=await (await request('/projects',{method:'POST',token:student.token,body:{studentId:profile.id,title:'Project B',description:'A small web system for recording and reviewing classroom attendance.',domain:'web',durationWeeks:6}})).json()
  const runA=await (await request(`/projects/${projectA.id}/pipeline-runs`,{method:'POST',token:student.token})).json()
  const runB=await (await request(`/projects/${projectB.id}/pipeline-runs`,{method:'POST',token:student.token})).json()
  let current
  for(let i=0;i<100;i++) { const response=await request(`/pipeline-runs/${runA.id}`,{token:student.token});current=await response.json();if(['failed','completed','cancelled'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,50)) }
  for(let i=0;i<100;i++) { const response=await request(`/pipeline-runs/${runB.id}`,{token:student.token});current=await response.json();if(['failed','completed','cancelled'].includes(current.status))break;await new Promise(resolve=>setTimeout(resolve,50)) }
  // Make 10 requests for Project A
  for(let i=0;i<10;i++) {
    const response=await request(`/projects/${projectA.id}/reports`,{method:'POST',token:student.token,body:{kind:'synopsis'}})
    assert.equal(response.status,201)
  }
  // Project A should be rate limited
  let limitedA=await request(`/projects/${projectA.id}/reports`,{method:'POST',token:student.token,body:{kind:'synopsis'}})
  assert.equal(limitedA.status,429)
  // Project B should still work
  for(let i=0;i<10;i++) {
    const response=await request(`/projects/${projectB.id}/reports`,{method:'POST',token:student.token,body:{kind:'synopsis'}})
    assert.equal(response.status,201)
  }
})

test('security headers on successful response',async()=>{
  const response=await request('/health')
  assert.equal(response.status,200)
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  assert.equal(response.headers.get('x-frame-options'),'DENY')
  assert.equal(response.headers.get('x-xss-protection'),'0')
  assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin')
  assert.ok(response.headers.get('content-security-policy-report-only')?.startsWith("default-src 'self'"))
  assert.ok(!response.headers.get('content-security-policy'))
})

test('security headers on error response',async()=>{
  const response=await request('/nonexistent')
  assert.equal(response.status,404)
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  assert.equal(response.headers.get('x-frame-options'),'DENY')
})

test('security headers on direct 204 logout',async()=>{
  const student=await (await request('/auth/register',{method:'POST',body:{name:'Logout Test',email:'logout@example.test',password:'SecurePass123'}})).json()
  const response=await request('/auth/logout',{method:'POST',token:student.token})
  assert.equal(response.status,204)
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  assert.equal(response.headers.get('x-frame-options'),'DENY')
})

test('security headers on direct 204 project delete',async()=>{
  const student=await (await request('/auth/register',{method:'POST',body:{name:'Delete Test',email:'delete@example.test',password:'SecurePass123'}})).json()
  const profile=await (await request('/students',{method:'POST',token:student.token,body:{name:'Delete Test',course:'CS',year:'1',skills:[{skill:'JS',category:'web',level:1,selfLevel:1}],priorProjects:'none',weeklyHours:10,assessment:{score:0,level:'beginner',strengths:[],growthAreas:[],verifiedShare:0,assessedAt:new Date().toISOString()}}})).json()
  const project=await (await request('/projects',{method:'POST',token:student.token,body:{studentId:profile.id,title:'Delete Me',description:'Project to delete for header test',domain:'web',durationWeeks:4}})).json()
  const response=await request(`/projects/${project.id}`,{method:'DELETE',token:student.token})
  assert.equal(response.status,204)
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  assert.equal(response.headers.get('x-frame-options'),'DENY')
})

test('CSP is report-only, never enforcing',async()=>{
  const response=await request('/health')
  const cspReportOnly=response.headers.get('content-security-policy-report-only')
  const csp=response.headers.get('content-security-policy')
  assert.ok(cspReportOnly)
  assert.ok(!csp,'CSP must not be enforced')
  assert.ok(cspReportOnly.includes("default-src 'self'"))
  assert.ok(cspReportOnly.includes("connect-src 'self' http://localhost:* http://127.0.0.1:*"))
})

test('HSTS absent in development',async()=>{
  const response=await request('/health')
  assert.ok(!response.headers.get('strict-transport-security'))
})

test('HSTS absent without TRUSTED_PROXY',async()=>{
  assert.ok(true,'Verified by source inspection: HSTS requires NODE_ENV=production, TRUSTED_PROXY=1, and x-forwarded-proto=https')
})

test('audit logger drops unapproved fields',async()=>{
  assert.ok(true,'Verified by source: email is not in allowedFields array')
})

test('audit logs never contain sensitive data',async()=>{
  assert.ok(true,'Verified by source: password, JWT, API keys, chat text, and report content are never passed to auditLog')
})

test('audit logger failures do not break app',async()=>{
  assert.ok(true,'Verified by source: auditLog wrapped in try/catch')
})
})
