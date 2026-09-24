'use client'

import { useState } from 'react'

export function PasswordSettings() {
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');setNotice('');setBusy(true)
    const form=event.currentTarget, data=new FormData(form)
    const body={currentPassword:data.get('currentPassword'),newPassword:data.get('newPassword'),confirmNewPassword:data.get('confirmNewPassword')}
    try{const response=await fetch('/api/auth/change-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok){setError('Unable to change password. Check the details and try again.');return}form.reset();setNotice('Password changed successfully. Other signed-in sessions have been ended.')}
    catch{setError('Unable to change password. Check the details and try again.')}
    finally{setBusy(false)}
  }
  return <section className="settings-page"><header className="settings-hero"><div><p className="eyebrow">Your account</p><h1>Settings</h1><p>Keep your account secure by using a strong, unique password.</p></div></header>
    {error&&<div className="form-error settings-message" role="alert">{error}</div>}{notice&&<div className="form-success settings-message" role="status">{notice}</div>}
    <div className="settings-list-card"><div className="settings-list-head"><div><h3>Change Password</h3><p>Your new password must be at least 8 characters.</p></div></div>
      <form className="settings-form" onSubmit={submit}><div className="settings-form-grid">
        <label className="settings-form-wide">Current Password<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
        <label>New Password<input name="newPassword" type="password" minLength={8} required autoComplete="new-password" /></label>
        <label>Confirm New Password<input name="confirmNewPassword" type="password" minLength={8} required autoComplete="new-password" /></label>
      </div><div className="settings-modal-actions"><button className="btn red" disabled={busy}>{busy?'Changing…':'Change Password'}</button></div></form>
    </div></section>
}