import { useEffect, useState } from 'react'
import { Bell, CircleAlert, CalendarClock, ArrowRight, Mail, CircleCheck } from 'lucide-react'
import { useScope, useStore, supabase } from '../lib/store'
import { daysUntil, formatDate, reminders } from '../lib/domain'
import { PageHeading, Money, Empty, Badge } from '../components/ui'
import type { PageActions } from './Dashboard'

export default function Reminders({onCheque}:PageActions){
  const data=useScope(),[tab,setTab]=useState('all')
  const items=reminders(data).filter(c=>tab==='all'||(tab==='returned'?c.status==='returned':tab==='overdue'?daysUntil(c.dueDate)<0&&c.status!=='returned':c.status!=='returned'&&daysUntil(c.dueDate)>=0))
  return <><PageHeading eyebrow="A LITTLE PLANNING GOES A LONG WAY" title="One less thing to remember." description="Your upcoming, overdue, and returned cheques, brought into focus."/><div className="reminder-status"><span className="notification-live"><span className="status-dot"/> In-app reminders active</span><span>All dates in Sri Lanka time · Asia/Colombo</span></div><section className="panel"><div className="filter-toolbar"><div className="segmented">{[['all','All reminders'],['upcoming','Next 7 days'],['overdue','Overdue'],['returned','Returned']].map(([v,l])=><button key={v} className={tab===v?'active':''} onClick={()=>setTab(v)}>{l}</button>)}</div><Badge>{items.length} to review</Badge></div><div className="reminder-list">{items.map(c=>{const days=daysUntil(c.dueDate),urgent=c.status==='returned'||days<=0;return <article className={`reminder-item ${urgent?'urgent':''}`} key={c.id}><span className={`reminder-item-icon ${urgent?'peach':'sand'}`}>{urgent?<CircleAlert size={22}/>:<CalendarClock size={22}/>}</span><div className="reminder-item-content"><div><h3>{c.status==='returned'?'Returned cheque needs a follow-up':days<0?'Cheque overdue for confirmation':days===0?'Cheque is due today':days===1?'Cheque is due tomorrow':`Cheque due in ${days} days`}</h3><Badge tone={urgent?'warning':'neutral'}>{c.type==='issued'?'Payment':'Receipt'}</Badge></div><p>{c.payee} · #{c.number} · {formatDate(c.dueDate,{day:'numeric',month:'long',year:'numeric'})}</p><small>{c.status==='returned'?'Confirm the reason with your bank before re-presenting or cancelling.':c.type==='issued'?'Check the account has sufficient funds and confirm clearance with your bank.':'Confirm the deposit has cleared before recording income.'}</small></div><div className="reminder-item-action"><strong><Money value={c.amount}/></strong><button className="text-link" onClick={()=>onCheque(c)}>Review cheque<ArrowRight size={15}/></button></div></article>})}{!items.length&&<Empty title="You're all caught up" description="No cheques need attention in this view." action={<CircleCheck size={24} className="positive"/>}/>}</div></section><EmailDeliveryStatus/></>
}

type Delivery = { id:string; scheduled_date:string; stage:string; status:string; attempts:number; error:string|null }
function EmailDeliveryStatus(){
  const {demo,user}=useStore()
  const [configured,setConfigured]=useState(false),[deliveries,setDeliveries]=useState<Delivery[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const load=async()=>{
    if(!supabase||user?.role!=='owner')return
    setLoading(true);setError('')
    const [settings,history]=await Promise.all([
      supabase.from('reminder_settings').select('enabled,recipients,sender').limit(1),
      supabase.from('notification_deliveries').select('id,scheduled_date,stage,status,attempts,error').order('updated_at',{ascending:false}).limit(10),
    ])
    if(settings.error||history.error)setError('Email status could not be loaded. Please try again.')
    else {const s=settings.data?.[0];setConfigured(Boolean(s?.enabled&&s.recipients?.length&&s.sender));setDeliveries(history.data??[])}
    setLoading(false)
  }
  useEffect(()=>{void load()},[user?.role])
  return <section className="panel email-delivery-panel">
    <div className="email-panel"><span className="soft-icon"><Mail size={23}/></span>
      <div><h2>A timely nudge, in your inbox.</h2>
        <p>{demo?'This demo provides in-app alerts. Ask your workspace administrator to connect daily email reminders for a live workspace.':configured?'Your email recipients are configured. Review recent delivery results below and ask your administrator to verify the daily schedule.':'Ask your workspace administrator to enable daily email reminders. Your in-app alerts are already available.'} Reminders are scheduled for 8:00 AM Sri Lanka time.</p>
        <div className="reminder-timeline">{['7 days before','3 days before','1 day before','Due date','Overdue'].map(x=><span key={x}><Bell size={12}/>{x}</span>)}</div>
      </div><Badge tone={configured?'success':'warning'}>{demo?'Email setup required':user?.role!=='owner'?'Owner managed':configured?'Recipients configured':'Email setup required'}</Badge>
    </div>
    {!demo&&user?.role==='owner'&&<><div className="filter-toolbar"><h3 className="form-section-title">Recent email deliveries</h3><button className="button secondary small" disabled={loading} onClick={()=>void load()}>{loading?'Checking…':'Refresh status'}</button></div>
      {error?<p className="form-error" role="alert">{error}</p>:deliveries.length?<div className="table-scroll"><table><thead><tr><th>Date</th><th>Reminder</th><th>Result</th><th>Attempts</th><th>Details</th></tr></thead><tbody>{deliveries.map(d=><tr key={d.id}><td>{formatDate(d.scheduled_date)}</td><td>{d.stage}</td><td><Badge tone={d.status==='sent'?'success':d.status==='failed'?'returned':'warning'}>{d.status}</Badge></td><td>{d.attempts}</td><td className="muted">{d.error??(d.status==='sent'?'Accepted by email provider':'Awaiting confirmation')}</td></tr>)}</tbody></table></div>:<p className="page-note delivery-empty">{loading?'Loading delivery history…':'No email deliveries recorded yet.'}</p>}
    </>}
  </section>
}
