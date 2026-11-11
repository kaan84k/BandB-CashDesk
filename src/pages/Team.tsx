import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MailPlus, ShieldCheck, Users, RefreshCw, Trash2 } from 'lucide-react'
import { supabase, useStore } from '../lib/store'
import type { Role, Snapshot } from '../lib/domain'
import { PageHeading, Badge, Modal } from '../components/ui'
import { errorMessage } from '../components/EntryForm'
type Invite={id:string;name:string;email:string;status:string;emailStatus:string;expiresAt:string}
type Member=Snapshot['members'][number]
export default function Team(){
  const {data,user,demo,execute,notify,online,syncError}=useStore()
  const [members,setMembers]=useState(data!.members),[invitations,setInvitations]=useState<Invite[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [removal,setRemoval]=useState<{member:Member;requestId:string}|null>(null)
  const disabled=busy||!online||Boolean(syncError)
  const load=useCallback(async()=>{if(demo){setMembers(data!.members);return}const {data:people,error}=await supabase!.rpc('cashdesk_people');if(error)throw error;setMembers(people.members);setInvitations(people.invitations)},[data,demo])
  useEffect(()=>{void load().catch(e=>setError(errorMessage(e)))},[load])
  const invite=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);setBusy(true);setError('');setMessage('');try{
    const {data:result,error}=await supabase!.functions.invoke('invite-staff',{body:{name:f.get('name'),email:f.get('email'),branchId:data!.branches[0].id}})
    if(error){let details='';try{details=(await error.context?.json())?.message}catch{}throw new Error(details||errorMessage(error))}
    setMessage(result.message);form.reset();await load()
  }catch(e){setError(errorMessage(e));await load().catch(()=>{})}finally{setBusy(false)}}
  const changeRole=async(id:string,role:Role)=>{setBusy(true);setError('');try{await execute({type:'setMemberRole',requestId:crypto.randomUUID(),payload:{id,role}});notify('Access updated.');await load()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  const revoke=async(id:string)=>{setBusy(true);setError('');try{const {error}=await supabase!.rpc('cashdesk_revoke_invitation',{invitation_id:id});if(error)throw error;await load();setMessage('Invitation revoked.')}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  const remove=async()=>{
    if(!removal||disabled)return
    setBusy(true);setError('');setMessage('')
    try{
      const synced=await execute({type:'removeMember',requestId:removal.requestId,payload:{id:removal.member.id}})
      setMembers(current=>current.filter(m=>m.id!==removal.member.id))
      setMessage(`${removal.member.name}’s access was removed.${synced?'':' Refresh your connection before making another change.'}`)
      setRemoval(null)
      if(!demo)await load().catch(()=>setError('Access was removed, but the team list could not be refreshed. Retry the connection to reload it.'))
    }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
  }
  return <><PageHeading eyebrow="WORKSPACE ADMINISTRATION" title="Team & access." description="Manage who can enter records in your business."/>{error&&!removal&&<div className="form-error standalone-error" role="alert">{error}</div>}{message&&<div className="entry-confirmation" role="status"><ShieldCheck size={20}/>{message}</div>}
    <div className="team-layout"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">PEOPLE</span><h2>Your business team</h2><p>Each person signs in with their own account.</p></div><Users size={21}/></div>
      <div className="team-members">{members.map(m=><div className="team-member" key={m.id}><span className="user-avatar">{m.name.slice(0,2).toUpperCase()}</span><div><strong>{m.name} {m.id===user!.id&&<small>(you)</small>}</strong><p>{m.email}</p></div><div className="team-member-actions"><label className="role-select"><span className="sr-only">Role for {m.name}</span><select aria-label={`Role for ${m.name}`} value={m.role} disabled={disabled||m.id===user!.id} onChange={e=>void changeRole(m.id,e.target.value as Role)}><option value="owner">Owner</option>{m.role==='manager'&&<option value="manager">Manager</option>}<option value="staff">Data entry</option></select></label>{m.id!==user!.id&&<button className="icon-button remove-access-button" title="Remove access" aria-label={`Remove ${m.name}`} disabled={disabled} onClick={()=>{setError('');setRemoval({member:m,requestId:crypto.randomUUID()})}}><Trash2 size={17}/></button>}</div></div>)}</div>
      <div className="access-explainer"><ShieldCheck size={19}/><p><strong>Owner</strong> — all records, balances, reports and team access.<br/><strong>Data entry</strong> — record income, expenses, transfers, cheques and cash counts. Financial views and exports are restricted.</p></div></section>
      <section className="panel invite-panel"><span className="soft-icon"><MailPlus size={24}/></span><h2>Invite a teammate</h2><p>They’ll join this business with data-entry access.</p>{demo?<div className="info-callout"><p>Staff invitations are available in your connected workspace. Demo records stay in this browser.</p></div>:<form className="entry-form" onSubmit={invite}><label>Full name<input name="name" autoComplete="off" maxLength={160} required/></label><label>Email address<input name="email" type="email" autoComplete="off" maxLength={254} required/></label><div className="invite-role"><ShieldCheck size={17}/><span>Data-entry staff</span><Badge>Limited access</Badge></div><button className="button primary" disabled={disabled}>{busy?<RefreshCw size={16} className="spin"/>:<MailPlus size={16}/>}Send invitation</button><p className="form-note">The invitation expires in 7 days. Existing users can sign in and accept it; new users receive an email to set up their login.</p></form>}</section></div>
    {!demo&&<section className="panel invitations-panel"><div className="panel-heading"><div><h2>Invitations</h2><p>Pending access requests for this business.</p></div></div>{invitations.length?<div className="team-members">{invitations.map(i=>{const expired=new Date(i.expiresAt).getTime()<=Date.now();return <div className="team-member" key={i.id}><span className="soft-icon"><MailPlus size={18}/></span><div><strong>{i.name}</strong><p>{i.email}</p><small>{i.status==='pending'&&expired?'Expired':i.status} · {i.emailStatus==='failed'?'Email delivery failed':i.emailStatus==='existing_account'?'Sign in to accept':i.emailStatus==='sent'?'Email sent':'Email pending'}</small></div>{i.status==='pending'&&<button className="button secondary small" disabled={disabled} onClick={()=>void revoke(i.id)}>Revoke</button>}</div>})}</div>:<p className="team-empty">No invitations yet.</p>}</section>}
    {removal&&<Modal open title="Remove access?" description="This person will no longer be able to open or enter records in this business." onClose={()=>{if(!busy){setRemoval(null);setError('')}}}><div className="entry-form"><div className="removal-person"><strong>{removal.member.name}</strong><span>{removal.member.email}</span></div><p className="form-note">Their recorded entries and audit history will be kept. To restore access later, send them a new invitation.</p>{error&&<div className="form-error" role="alert">{error}</div>}<div className="form-footer"><button className="button secondary" disabled={busy} onClick={()=>{setRemoval(null);setError('')}}>Keep access</button><button className="button primary danger-button" disabled={disabled} onClick={()=>void remove()}>{busy?'Removing…':'Remove access'}</button></div></div></Modal>}
  </>
}
