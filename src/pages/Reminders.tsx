import { useEffect, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { errorMessage } from '../components/EntryForm'
import { Bell, CircleAlert, CalendarClock, ArrowRight, Mail, CircleCheck } from 'lucide-react'
import { useScope, useStore, supabase } from '../lib/store'
import { daysUntil, formatDate, reminders } from '../lib/domain'
import { PageHeading, Money, Empty, Badge, Modal } from '../components/ui'
import type { PageActions } from './Dashboard'

export default function Reminders({onCheque}:PageActions){
  const data=useScope(),[tab,setTab]=useState('all')
  const items=reminders(data).filter(c=>tab==='all'||(tab==='returned'?c.status==='returned':tab==='overdue'?daysUntil(c.dueDate)<0&&c.status!=='returned':c.status!=='returned'&&daysUntil(c.dueDate)>=0))
  return <><PageHeading eyebrow="CHEQUE DUE DATES" title="Cheque reminders." description="Upcoming, overdue and returned cheques that need attention."/><div className="reminder-status"><span className="notification-live"><span className="status-dot"/> In-app reminders active</span><span>All dates in Sri Lanka time · Asia/Colombo</span></div><section className="panel"><div className="filter-toolbar"><div className="segmented">{[['all','All reminders'],['upcoming','Next 7 days'],['overdue','Overdue'],['returned','Returned']].map(([v,l])=><button key={v} className={tab===v?'active':''} onClick={()=>setTab(v)}>{l}</button>)}</div><Badge>{items.length} to review</Badge></div><div className="reminder-list">{items.map(c=>{const days=daysUntil(c.dueDate),urgent=c.status==='returned'||days<=0;return <article className={`reminder-item ${urgent?'urgent':''}`} key={c.id}><span className={`reminder-item-icon ${urgent?'peach':'sand'}`}>{urgent?<CircleAlert size={22}/>:<CalendarClock size={22}/>}</span><div className="reminder-item-content"><div><h3>{c.status==='returned'?'Returned cheque needs a follow-up':days<0?'Cheque overdue for confirmation':days===0?'Cheque is due today':days===1?'Cheque is due tomorrow':`Cheque due in ${days} days`}</h3><Badge tone={urgent?'warning':'neutral'}>{c.type==='issued'?'Payment':'Receipt'}</Badge></div><p>{c.payee} · #{c.number} · {formatDate(c.dueDate,{day:'numeric',month:'long',year:'numeric'})}</p><small>{c.status==='returned'?'Confirm the reason with your bank before re-presenting or cancelling.':c.type==='issued'?'Check the account has sufficient funds and confirm clearance with your bank.':'Confirm the deposit has cleared before recording income.'}</small></div><div className="reminder-item-action"><strong><Money value={c.amount}/></strong><button className="text-link" onClick={()=>onCheque(c)}>Review cheque<ArrowRight size={15}/></button></div></article>})}{!items.length&&<Empty title="You're all caught up" description="No cheques need attention in this view." action={<CircleCheck size={24} className="positive"/>}/>}</div></section><EmailDeliveryStatus/></>
}

type Delivery = { id:string; scheduled_date:string; stage:string; status:string; attempts:number; error:string|null }
function EmailDeliveryStatus(){
  const {demo,user}=useStore()
  const [editing,setEditing]=useState(false),[preferences,setPreferences]=useState({enabled:false,recipients:[] as string[],sender:''})
  const [configured,setConfigured]=useState(false),[deliveries,setDeliveries]=useState<Delivery[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const load=async()=>{
    if(!supabase||user?.role!=='owner')return
    setLoading(true);setError('')
    const [settings,history]=await Promise.all([
      supabase.from('reminder_settings').select('enabled,recipients,sender').limit(1),
      supabase.from('notification_deliveries').select('id,scheduled_date,stage,status,attempts,error').order('updated_at',{ascending:false}).limit(10),
    ])
    if(settings.error||history.error)setError('Email status could not be loaded. Please try again.')
    else {const s=settings.data?.[0];setPreferences({enabled:s?.enabled??false,recipients:s?.recipients??[],sender:s?.sender??''});setConfigured(Boolean(s?.enabled&&s.recipients?.length&&s.sender));setDeliveries(history.data??[])}
    setLoading(false)
  }
  useEffect(()=>{void load()},[user?.role])
  return <section className="panel email-delivery-panel">
    <div className="email-panel"><span className="soft-icon"><Mail size={23}/></span>
      <div><h2>Daily email reminders</h2>
        <p>{demo?'This demo provides in-app alerts. Ask your workspace administrator to connect daily email reminders for a live workspace.':configured?'Your email recipients are configured. Review recent delivery results below and ask your administrator to verify the daily schedule.':'Ask your workspace administrator to enable daily email reminders. Your in-app alerts are already available.'} Reminders are scheduled for 8:00 AM Sri Lanka time.</p>
        <div className="reminder-timeline">{['7 days before','3 days before','1 day before','Due date','Overdue'].map(x=><span key={x}><Bell size={12}/>{x}</span>)}</div>
      </div><Badge tone={configured?'success':'warning'}>{demo?'Email setup required':user?.role!=='owner'?'Owner managed':configured?'Recipients configured':'Email setup required'}</Badge>
    </div>
    {!demo&&user?.role==='owner'&&<><div className="filter-toolbar"><h3 className="form-section-title">Recent email deliveries</h3><div className="heading-actions"><button className="button secondary small" onClick={()=>setEditing(true)}>Email preferences</button><button className="button secondary small" disabled={loading} onClick={()=>void load()}>{loading?'Checking…':'Refresh status'}</button></div></div>
      {error?<p className="form-error" role="alert">{error}</p>:deliveries.length?<div className="table-scroll"><table><thead><tr><th>Date</th><th>Reminder</th><th>Result</th><th>Attempts</th><th>Details</th></tr></thead><tbody>{deliveries.map(d=><tr key={d.id}><td>{formatDate(d.scheduled_date)}</td><td>{d.stage}</td><td><Badge tone={d.status==='sent'?'success':d.status==='failed'?'returned':'warning'}>{d.status}</Badge></td><td>{d.attempts}</td><td className="muted">{d.error??(d.status==='sent'?'Accepted by email provider':'Awaiting confirmation')}</td></tr>)}</tbody></table></div>:<p className="page-note delivery-empty">{loading?'Loading delivery history…':'No email deliveries recorded yet.'}</p>}
    </>}
    {editing&&<EmailPreferences initial={preferences} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);void load()}}/>}
  </section>
}


function EmailPreferences({initial,onClose,onSaved}:{initial:{enabled:boolean;recipients:string[];sender:string};onClose:()=>void;onSaved:()=>void}){
  const {notify}=useStore()
  const [enabled,setEnabled]=useState(initial.enabled),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError('');setBusy(true)
    try{
      const fields=new FormData(event.currentTarget)
      const recipients=String(fields.get('recipients')??'').split(/[\n,]+/).map(s=>s.trim()).filter(Boolean)
      z.array(z.email()).max(10).parse(recipients)
      const {error}=await supabase!.rpc('cashdesk_update_reminder_settings',{email_enabled:enabled,email_recipients:recipients,email_sender:String(fields.get('sender')??'').trim()})
      if(error)throw error
      notify('Email preferences saved. Check recent delivery results after the next scheduled run.');onSaved()
    }catch(failure){setError(errorMessage(failure))}finally{setBusy(false)}
  }
  return <Modal open title="A timely nudge." description="Choose who receives your business’s cheque reminders." onClose={()=>{if(!busy)onClose()}}><form className="entry-form" onSubmit={submit}>
    {error&&<div className="form-error" role="alert">{error}</div>}
    <label className="checkbox-row"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enable daily email reminders</label>
    <label>Recipient emails<textarea name="recipients" rows={3} defaultValue={initial.recipients.join('\n')} placeholder="One email per line, up to 10" required={enabled}/></label>
    <label>Verified sender<input name="sender" defaultValue={initial.sender} placeholder="Your business <finance@yourdomain.lk>" required={enabled} maxLength={254}/></label>
    <p className="form-note">Your administrator must connect the email provider, verify this sender, and enable the daily schedule. Saving preferences alone does not send email or confirm the schedule is running.</p>
    <div className="form-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Saving…':'Save email preferences'}</button></div>
  </form></Modal>
}
