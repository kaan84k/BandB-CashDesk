import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, CalendarDays, Check, CheckCircle2, ChevronRight, ClipboardPenLine, LockKeyhole, LogOut, ReceiptText, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase, useStore } from '../lib/store'
import { parseMoney, today, type Command } from '../lib/domain'
import { errorMessage } from '../components/EntryForm'

type Kind='income'|'expense'|'transfer'|'cheque'|'day'
const actions=[{id:'income' as const,label:'Income',hint:'Sales & receipts',icon:ArrowDownLeft},{id:'expense' as const,label:'Expense',hint:'Purchases & payments',icon:ArrowUpRight},{id:'transfer' as const,label:'Move money',hint:'Cash, bank & safe',icon:ArrowLeftRight},{id:'cheque' as const,label:'Cheque',hint:'Register a cheque',icon:ReceiptText},{id:'day' as const,label:'Daily cash',hint:'Opening & closing',icon:CalendarDays}]
export default function StaffEntry(){
  const {entryData:ctx,execute,busy,syncError,online,refresh,syncing,setRecovery}=useStore()
  const location=useLocation(),navigate=useNavigate()
  const [kind,setKind]=useState<Kind>('income'),[formKey,setFormKey]=useState(0),[error,setError]=useState(''),[confirmation,setConfirmation]=useState('')
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID()),[direction,setDirection]=useState<'issued'|'received'>('issued')
  useEffect(()=>{if(location.pathname!=='/entry')navigate('/entry',{replace:true})},[location.pathname,navigate])
  if(!ctx)return null
  const cafeBranch=ctx.branches[0].id,accounts=ctx.accounts.filter(a=>a.branchId===cafeBranch),drawer=accounts.find(a=>a.type==='cash')
  const active=ctx.days.find(d=>d.accountId===drawer?.id&&d.status==='open'),closed=ctx.days.some(d=>d.accountId===drawer?.id&&d.date===today()&&d.status==='closed')
  const disabled=busy||!online||Boolean(syncError)
  const choose=(next:Kind)=>{setKind(next);setError('');setConfirmation('');setRequestId(crypto.randomUUID());setFormKey(n=>n+1)}
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError('');setConfirmation('')
    const f=new FormData(event.currentTarget),s=(name:string)=>String(f.get(name)??'').trim(),base={id:requestId,branchId:cafeBranch}
    try{
      let command:Command
      if(kind==='income'||kind==='expense'){
        const account=accounts.find(a=>a.id===s('accountId'));if(!account)throw new Error('Choose an account')
        command={type:'addTransaction',requestId,payload:{...base,accountId:account.id,type:kind,amount:parseMoney(s('amount')),date:s('date'),category:s('category'),description:s('description')||s('category'),method:account.type==='bank'?'transfer':'cash',supplierId:null,chequeId:null}}
      }else if(kind==='transfer')command={type:'transfer',requestId,payload:{...base,fromAccountId:s('from'),toAccountId:s('to'),amount:parseMoney(s('amount')),date:s('date'),description:s('description')||'Money transfer'}}
      else if(kind==='cheque')command={type:'addCheque',requestId,payload:{...base,accountId:s('accountId'),number:s('number'),type:direction,payee:s('payee'),supplierId:null,bank:s('bank'),amount:parseMoney(s('amount')),issueDate:s('issueDate'),dueDate:s('dueDate'),status:direction,notes:s('description')}}
      else {
        if(!drawer)throw new Error('Ask your owner to add a cash drawer')
        command=active?{type:'closeDay',requestId,payload:{id:active.id,closing:parseMoney(s('count'),true),notes:s('description')}}:{type:'openDay',requestId,payload:{...base,accountId:drawer.id,date:today(),opening:parseMoney(s('count'),true),notes:s('description')}}
      }
      const synced=await execute(command)
      setConfirmation(synced?'Entry saved to your business.':'Entry saved. Refresh your connection before entering another record.')
      setError('');setFormKey(n=>n+1);setRequestId(crypto.randomUUID())
    }catch(failure){setError(errorMessage(failure))}
  }
  const optionList=(bankOnly=false)=>accounts.filter(a=>!bankOnly||a.type==='bank').map(a=><option key={a.id} value={a.id}>{a.name}</option>)
  return <div className="staff-shell">
    <header className="staff-header"><a href="/entry" className="brand"><img src="/favicon.svg" alt="" width="36" height="36"/><div><strong>Cashflow</strong><small>WORKSPACE</small></div></a><div className="staff-user"><span className="access-pill"><ShieldCheck size={13}/>Data-entry access</span><span>{ctx.user.name}</span><button className="icon-button" aria-label="Change password" onClick={()=>setRecovery(true)}><LockKeyhole size={17}/></button><button className="icon-button" aria-label="Sign out" onClick={()=>void supabase!.auth.signOut()}><LogOut size={18}/></button></div></header>
    <main className="staff-main"><div className="staff-breadcrumb">{ctx.cafe.name}<ChevronRight size={13}/><span>Data entry</span></div><div className="staff-heading"><div><span className="eyebrow">DAILY OPERATIONS</span><h1>Let’s record your next entry.</h1><p>One workspace. Simple, accurate records for your business.</p></div><span className="secure-indicator"><span className="status-dot"/>{online&&!syncError?'Connected workspace':'Connection interrupted'}</span></div>
      {(!online||syncError)&&<div className="connection-banner" role="alert"><div><strong>{!online?'You’re offline. Your form is kept.':'Refresh your connection before saving.'}</strong><p>{syncError}</p></div><button className="button secondary" disabled={!online||syncing} onClick={()=>void refresh()}>Retry connection</button></div>}
      <div className="entry-action-grid">{actions.map(a=><button key={a.id} className={`entry-action ${kind===a.id?'selected':''}`} onClick={()=>choose(a.id)} disabled={busy}><span className="entry-action-icon"><a.icon size={21}/></span><strong>{a.label}</strong><small>{a.hint}</small>{kind===a.id&&<Check size={14} className="selected-check"/>}</button>)}</div>
      <div className="staff-work-grid"><section className="panel staff-form-panel"><div className="panel-heading"><div><span className="eyebrow">NEW RECORD</span><h2>{kind==='day'?(active?'Closing cash count':'Opening cash count'):kind==='cheque'?'Register a cheque':kind==='transfer'?'Move money':kind==='income'?'Record income':'Record expense'}</h2><p>{kind==='day'?'Enter the cash you physically counted. Your owner reviews the reconciliation.':'Your entry is saved to the same business your owner manages.'}</p></div><span className="form-step">01 / 01</span></div>
        {confirmation&&<div className="entry-confirmation" role="status"><CheckCircle2 size={20}/><span>{confirmation}</span></div>}
        {error&&<div className="form-error staff-error" role="alert">{error}</div>}
        {kind==='day'&&!active&&closed?<div className="empty-state"><CheckCircle2 size={28}/><h3>Today’s cash day is closed.</h3><p>Contact your owner if a correction is needed.</p></div>:<form key={formKey} className="entry-form staff-form" onSubmit={submit}>
          {kind==='cheque'&&<label>Cheque type<select aria-label="Cheque type" value={direction} onChange={e=>setDirection(e.target.value as typeof direction)}><option value="issued">Issued — paying someone</option><option value="received">Received — being paid</option></select></label>}
          {kind==='transfer'?<div className="form-grid"><label>From<select aria-label="Transfer from" name="from" defaultValue={drawer?.id} required>{optionList()}</select></label><label>To<select aria-label="Transfer to" name="to" defaultValue={accounts.find(a=>a.type==='bank')?.id} required>{optionList()}</select></label></div>:kind!=='day'&&<label>{kind==='cheque'?'Bank account':'Money account'}<select aria-label="Account" name="accountId" defaultValue={kind==='cheque'?accounts.find(a=>a.type==='bank')?.id:drawer?.id} required>{optionList(kind==='cheque')}</select></label>}
          {kind==='day'?<><p className="form-note">Cash day: {active?.date??today()} · {drawer?.name??'Cash drawer'}</p><label>{active?'Closing cash (LKR)':'Opening cash (LKR)'}<input name="count" inputMode="decimal" placeholder="0.00" required/></label></>:<div className="form-grid"><label>Amount (LKR)<input name="amount" inputMode="decimal" placeholder="0.00" required/></label>{kind==='cheque'?<label>Cheque number<input name="number" pattern="[A-Za-z0-9-]{1,30}" required maxLength={30}/></label>:<label>Date<input name="date" type="date" defaultValue={today()} max={today()} required/></label>}</div>}
          {(kind==='income'||kind==='expense')&&<label>Category<select name="category">{(kind==='income'?['Sales','Other income']:['Supplier purchase','Rent','Electricity & water','Staff pay','Transport','Other expense']).map(c=><option key={c}>{c}</option>)}</select></label>}
          {kind==='cheque'&&<><div className="form-grid"><label>{direction==='issued'?'Payee':'Payer'}<input name="payee" maxLength={160} required/></label><label>Bank on cheque<input name="bank" maxLength={160} required/></label></div><div className="form-grid"><label>Issue date<input name="issueDate" type="date" defaultValue={today()} required/></label><label>Due date<input name="dueDate" type="date" defaultValue={today()} required/></label></div></>}
          <label>{kind==='day'?'Count note':'Description'}<textarea name="description" maxLength={kind==='day'?1000:160} rows={3} placeholder={kind==='day'?'e.g. Counted cash at the end of my shift':'Add a short description'} required={kind==='day'}/></label>
          <div className="staff-form-footer"><span><ShieldCheck size={14}/>Saved with your name and time</span><button className="button primary" disabled={disabled}>{busy?<RefreshCw size={16} className="spin"/>:<Check size={17}/>} {busy?'Saving entry…':'Save entry'}</button></div>
        </form>}
      </section><aside className="staff-guidance"><div className="panel"><span className="guidance-icon"><ClipboardPenLine size={24}/></span><h2>A clear record, every time.</h2><p>Check the account, amount and date before saving. Your owner will see the entry in the business’s cashbook.</p><ul><li><Check size={14}/>Use “Move money” for bank deposits and safe transfers.</li><li><Check size={14}/>Register a cheque when it is issued or received.</li><li><Check size={14}/>Ask your owner to confirm cheque clearance or correct a saved entry.</li></ul></div><div className="entry-access-note"><ShieldCheck size={19}/><div><strong>Focused access</strong><p>This login is for data entry. Business balances and financial reports are available to the owner.</p></div></div></aside></div>
    </main><footer className="staff-footer">Cashflow<span>All amounts in LKR · Sri Lanka time</span></footer>
  </div>
}
