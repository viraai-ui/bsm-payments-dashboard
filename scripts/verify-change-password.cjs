const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),bcrypt=require('bcryptjs')
const root=path.resolve(__dirname,'..'),file=path.join(root,'data/auth-users-store.json'),original=fs.readFileSync(file),port='3241',base=`http://127.0.0.1:${port}`
const oldPassword='QA-Old-Password1!',newPassword='QA-New-Password2!';let server
const cookie=r=>r.headers.getSetCookie()[0].split(';')[0]
async function login(login,password){return fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login,password})})}
async function change(session,body){return fetch(base+'/api/auth/change-password',{method:'POST',headers:{cookie:session,'content-type':'application/json'},body:JSON.stringify(body)})}
async function wait(){for(let i=0;i<80;i++){try{if((await fetch(base)).status)return}catch{}await new Promise(r=>setTimeout(r,150))}throw new Error('server did not start')}
;(async()=>{try{
 const store=JSON.parse(original),now=new Date().toISOString();store.users.push({id:'qa-password-sales',name:'QA Password Sales',email:'qa-password-sales@test.local',username:'qa-password-sales',role:'Salesperson',active:true,passwordHash:await bcrypt.hash(oldPassword,4),createdAt:now,updatedAt:now},{id:'qa-password-admin',name:'QA Password Admin',email:'qa-password-admin@test.local',username:'qa-password-admin',role:'Admin',active:true,passwordHash:await bcrypt.hash(oldPassword,4),createdAt:now,updatedAt:now});fs.writeFileSync(file,JSON.stringify(store,null,2))
 server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',port],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_LOCAL_ONLY:'true'}});await wait()
 let a=await login('qa-password-sales',oldPassword),b=await login('qa-password-sales',oldPassword),admin=await login('qa-password-admin',oldPassword);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(admin.status,200);const sessionA=cookie(a),sessionB=cookie(b),adminSession=cookie(admin)
 assert.equal((await change('',{currentPassword:oldPassword,newPassword,confirmNewPassword:newPassword})).status,401,'authentication required')
 assert.equal((await change(adminSession,{currentPassword:oldPassword,newPassword,confirmNewPassword:newPassword})).status,403,'Salesperson role required')
 assert.equal((await change(sessionA,{currentPassword:'wrong',newPassword,confirmNewPassword:newPassword})).status,400,'wrong current password rejected')
 assert.equal((await change(sessionA,{currentPassword:oldPassword,newPassword,confirmNewPassword:'different'})).status,400,'mismatch rejected')
 const changed=await change(sessionA,{currentPassword:oldPassword,newPassword,confirmNewPassword:newPassword});assert.equal(changed.status,200,'password changed');const renewed=cookie(changed)
 assert.equal((await fetch(base+'/api/auth/me',{headers:{cookie:renewed}})).status,200,'changing session renewed')
 assert.equal((await fetch(base+'/api/auth/me',{headers:{cookie:sessionB}})).status,401,'other session invalidated')
 assert.notEqual((await login('qa-password-sales',oldPassword)).status,200,'old password rejected');assert.equal((await login('qa-password-sales',newPassword)).status,200,'new password accepted')
 const settings=await fetch(base+'/settings',{headers:{cookie:renewed},redirect:'manual'});assert.equal(settings.status,200,'Salesperson can access Settings');const ui=fs.readFileSync(path.join(root,'src/components/PasswordSettings.tsx'),'utf8');for(const label of ['Current Password','New Password','Confirm New Password'])assert.ok(ui.includes(label),`UI includes ${label}`)
 console.log('PASS change-password: auth, role, current-password, mismatch, success, session invalidation, login and UI')
}finally{server?.kill('SIGTERM');fs.writeFileSync(file,original)}})().catch(e=>{console.error(e);process.exitCode=1})
