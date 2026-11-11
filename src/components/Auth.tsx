import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, LoaderCircle, LogOut, Sprout } from 'lucide-react'
import { supabase, useStore } from '../lib/store'
import { errorMessage } from './EntryForm'
import { parseMoney } from '../lib/domain'

function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="login-layout"><section className="login-story">
    <div className="brand"><img src="/favicon.svg" width="42" height="42" alt=""/><div><strong>B&B CashDesk</strong><small>BOOKS & BUNS</small></div></div>
    <div><span className="eyebrow">YOUR CAFE, CONNECTED.</span><h1>One workspace.<br/>Every cash movement.</h1><p>A clear view of daily cash, bank deposits, safe transfers and cheques. Built around your cafe.</p><div className="login-illustration"><BookOpen size={96} strokeWidth={1}/><Sprout size={58} strokeWidth={1}/></div></div><small>Clear records. Confident decisions.</small>
  </section><section className="login-main">{children}</section></div>
}

export function Login() {
  const [mode, setMode] = useState<'login'|'signup'|'reset'>('login')
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState('')
  const changeMode = (next: typeof mode) => { setMode(next); setPassword(''); setError(''); setSent('') }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setSent('')
    try {
      if (mode === 'reset') {
        const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) throw error
        setSent('If that account exists, a password reset link will arrive by email. Open it to choose a new password.')
      } else if (mode === 'signup') {
        const { data, error } = await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
        if (error) throw error
        if (!data.session) setSent('Check your email to verify your account, then return here to sign in. Existing teammates need an invitation from their workspace owner.')
      } else {
        const { error } = await supabase!.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false) }
  }
  return <AuthLayout><form onSubmit={submit} className="login-form">
    <span className="eyebrow">YOUR BOOKS & BUNS WORKSPACE</span>
    <h2>{mode === 'reset' ? 'A fresh password.' : mode === 'signup' ? 'Start with a little clarity.' : 'Good to see you again.'}</h2>
    <p>{mode === 'reset' ? 'We’ll email you a link to reset your password.' : mode === 'signup' ? 'Create an owner account for a new business workspace.' : 'Sign in to your Books & Buns workspace.'}</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    {sent && <div className="info-callout" role="status"><Check size={18}/><p>{sent}</p></div>}
    <label>Email address<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@booksandbuns.lk"/></label>
    {mode !== 'reset' && <label>Password<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 12 : undefined} required value={password} onChange={e => setPassword(e.target.value)}/></label>}
    <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <ArrowRight size={17}/>} {busy ? 'Please wait…' : mode === 'reset' ? 'Send reset link' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
    <div className="auth-links">{mode === 'login' ? <><button type="button" onClick={() => changeMode('reset')}>Forgot password?</button><button type="button" onClick={() => changeMode('signup')}>New business? Get started</button></> : <button type="button" onClick={() => changeMode('login')}><ArrowLeft size={14}/>Back to sign in</button>}</div>
    <small>New accounts create a separate private workspace. To join an existing team, ask its owner for access.</small>
  </form></AuthLayout>
}

export function SetPassword() {
  const { setRecovery, refresh } = useStore()
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (password !== confirmation) { setError('The passwords do not match.'); return }
    setBusy(true)
    try {
      const { error } = await supabase!.auth.updateUser({ password })
      if (error) throw error
      setRecovery(false); await refresh()
    } catch (failure) { setError(errorMessage(failure)) } finally { setBusy(false) }
  }
  return <AuthLayout><form className="login-form" onSubmit={submit}><span className="eyebrow">A FRESH START</span><h2>Choose your password.</h2><p>Use at least 12 characters and a password you don’t use elsewhere.</p>{error && <div className="form-error" role="alert">{error}</div>}<label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)}/></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>}Save password</button></form></AuthLayout>
}

export function WorkspaceSetup() {
  const { session, setupWorkspace, busy, refresh } = useStore()
  const [error, setError] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('')
    const fields = new FormData(event.currentTarget)
    const get = (key: string) => String(fields.get(key) ?? '').trim()
    try { await setupWorkspace({ name: get('name'), companyName: get('companyName'), branchName: 'My cafe', location: '', bankName:get('bankName')||'Bank account', bankOpening:parseMoney(get('bankOpening')||'0',true), safeOpening:parseMoney(get('safeOpening')||'0',true) }) }
    catch (failure) { setError(errorMessage(failure)) }
  }
  return <AuthLayout><form className="login-form workspace-setup-form" onSubmit={submit}>
    <span className="eyebrow">LET’S OPEN YOUR CASHDESK</span><h2>Set up your cafe.</h2><p>Start with an empty cash drawer, bank account and personal safe. No sample transactions will be added.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <label>Your name<input name="name" autoComplete="name" maxLength={160} required defaultValue={session?.user.user_metadata?.full_name ?? ''}/></label>
    <label>Cafe name<input name="companyName" maxLength={160} required defaultValue="Books & Buns"/></label>
    <label>Bank name<input name="bankName" maxLength={160} defaultValue="Bank account" required/></label>
    <div className="form-grid"><label>Starting bank balance (LKR)<input name="bankOpening" inputMode="decimal" defaultValue="0" required/></label><label>Starting safe balance (LKR)<input name="safeOpening" inputMode="decimal" defaultValue="0" required/></label></div>
    <p className="form-note">You will count your opening cash when you open your first day.</p>
    <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <ArrowRight size={17}/>}Create private workspace</button>
    <small>Joining an existing team? Ask the owner to grant access to <strong>{session?.user.email}</strong>, then refresh. Creating a workspace does not join an existing business.</small>
    <div className="auth-links"><button type="button" onClick={() => void refresh()}>Refresh invitation status</button><button type="button" onClick={() => void supabase!.auth.signOut()}><LogOut size={14}/>Sign out</button></div>
  </form></AuthLayout>
}

export function JoinCafe(){
  const {invitations,refresh}=useStore()
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const respond=async(id:string,accept:boolean)=>{setBusy(true);setError('');try{const {error}=await supabase!.rpc(accept?'cashdesk_accept_invitation':'cashdesk_decline_invitation',{invitation_id:id});if(error)throw error;await refresh()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  return <AuthLayout><div className="login-form"><span className="eyebrow">YOUR CAFE INVITATION</span><h2>Join your team.</h2><p>Your owner has invited you to enter records in their existing cafe.</p>{error&&<div className="form-error" role="alert">{error}</div>}{invitations.map(i=><section className="join-invitation" key={i.id}><h3>{i.companyName}</h3><p>Invited by {i.invitedBy} · Data-entry access</p><p className="form-note">Record daily activity. Your owner manages balances and reports.</p><div className="settings-actions"><button className="button primary" disabled={busy} onClick={()=>void respond(i.id,true)}>Join cafe</button><button className="button secondary" disabled={busy} onClick={()=>void respond(i.id,false)}>Decline</button></div></section>)}<button className="text-link" disabled={busy} onClick={()=>void supabase!.auth.signOut()}>Sign out</button></div></AuthLayout>
}
