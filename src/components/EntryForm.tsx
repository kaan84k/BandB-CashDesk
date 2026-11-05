import { useState, type FormEvent } from 'react'
import { Check, LoaderCircle, ShieldCheck, ArrowRight } from 'lucide-react'
import { ZodError } from 'zod'
import { Modal, Money } from './ui'
import { useScope, useStore } from '../lib/store'
import { messageOf } from '../lib/errors'
import { allowedStatuses, parseMoney, today, type Cheque, type Command, type ChequeStatus } from '../lib/domain'
export type FormKind='income'|'expense'|'cheque'|'account'
export function errorMessage(error:unknown){return error instanceof ZodError?error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('. '):messageOf(error)}
export function EntryForm({kind,onClose}:{kind:FormKind;onClose:()=>void}){
  const data=useScope(),{execute,busy,notify}=useStore()
  const branchId=data.branches[0].id
  const accounts=data.accounts.filter(a=>kind!=='cheque'||a.type==='bank')
  const [id]=useState(()=>crypto.randomUUID()),[error,setError]=useState(''),[direction,setDirection]=useState<'issued'|'received'>('issued'),[accountType,setAccountType]=useState('bank')
  const titles={income:'Record income',expense:'Record expense',cheque:'Register cheque',account:'Add a money account'}
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError('')
    const f=new FormData(event.currentTarget),s=(key:string)=>String(f.get(key)??'').trim()
    try{
      let command:Command
      if(kind==='income'||kind==='expense'){
        const account=data.accounts.find(a=>a.id===s('accountId'))!
        command={type:'addTransaction',payload:{id,branchId,accountId:account.id,type:kind,amount:parseMoney(s('amount')),date:s('date'),category:s('category'),description:s('description')||s('category'),method:account.type==='bank'?'transfer':'cash',supplierId:null,chequeId:null}}
      }else if(kind==='cheque')command={type:'addCheque',payload:{id,branchId,accountId:s('accountId'),number:s('number'),type:direction,payee:s('payee'),supplierId:null,bank:s('bank'),amount:parseMoney(s('amount')),issueDate:s('issueDate'),dueDate:s('dueDate'),status:direction,notes:s('notes')}}
      else command={type:'addAccount',payload:{id,branchId,name:s('name'),type:s('accountType') as 'bank'|'cash'|'safe',bank:s('bank'),openingBalance:parseMoney(s('openingBalance')||'0',true)}}
      const synced=await execute(command)
      notify(!synced?'Saved on the server. Refresh your connection to see it.':kind==='cheque'?'Cheque registered. Money moves when it clears.':'Saved successfully. Your cashbook is up to date.');onClose()
    }catch(e){setError(errorMessage(e))}
  }
  return <Modal open title={titles[kind]} description={kind==='cheque'?'Keep track of the amount, due date and bank status.':kind==='account'?'Keep your cash drawer, bank and personal safe separate.':'A simple entry in your cafe cashbook.'} onClose={()=>{if(!busy)onClose()}}><form className="entry-form" onSubmit={submit}>
    {error&&<div role="alert" className="form-error">{error}</div>}
    {(kind==='income'||kind==='expense')&&<>
      <div className="form-grid"><label>Amount (LKR)<input name="amount" inputMode="decimal" placeholder="0.00" required autoFocus/></label><label>Date<input name="date" type="date" defaultValue={today()} max={today()} required/></label></div>
      <label>{kind==='income'?'Money received in':'Paid from'}<select aria-label="Account" name="accountId" required defaultValue={accounts.find(a=>a.type==='cash')?.id??accounts[0]?.id??''}><option value="" disabled>Choose where the money is</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Category<select name="category">{(kind==='income'?['Sales','Other income']:['Supplier purchase','Rent','Electricity & water','Staff pay','Transport','Other expense']).map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Description<input name="description" placeholder={kind==='income'?'e.g. Today’s cafe sales':'e.g. Products bought from supplier'} maxLength={160}/></label>
      <p className="form-note">Bank deposits and money moved to your safe belong under “Move money”. They are transfers, not new income or expenses.</p>
    </>}
    {kind==='cheque'&&<>
      <div className="segmented full"><button type="button" className={direction==='issued'?'active':''} onClick={()=>setDirection('issued')}>Issued · paying someone</button><button type="button" className={direction==='received'?'active':''} onClick={()=>setDirection('received')}>Received · being paid</button></div>
      <div className="form-grid"><label>Cheque number<input name="number" pattern="[A-Za-z0-9-]{1,30}" required placeholder="001257"/></label><label>Amount (LKR)<input name="amount" inputMode="decimal" required placeholder="0.00"/></label></div>
      <label>{direction==='issued'?'Payee':'Payer'}<input name="payee" required maxLength={160} placeholder={direction==='issued'?'Supplier or person you are paying':'Person paying you'}/></label>
      <label>Bank on cheque<input name="bank" required maxLength={160} placeholder="e.g. Commercial Bank"/></label>
      <label>Bank account<select aria-label="Bank account" name="accountId" required defaultValue={accounts[0]?.id??''}><option value="" disabled>Choose your bank account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <div className="form-grid"><label>Issue date<input name="issueDate" type="date" defaultValue={today()} required/></label><label>Due date<input name="dueDate" type="date" defaultValue={today()} required/></label></div>
      <label>Notes <span className="optional">optional</span><textarea name="notes" maxLength={1000} rows={2}/></label>
    </>}
    {kind==='account'&&<>
      <label>Name<input name="name" maxLength={160} required placeholder="e.g. Personal safe"/></label>
      <label>Type<select aria-label="Account type" name="accountType" value={accountType} onChange={e=>setAccountType(e.target.value)}><option value="bank">Bank account</option><option value="cash">Cash drawer</option><option value="safe">Personal safe</option></select></label>
      {accountType==='bank'&&<label>Bank name<input name="bank" required maxLength={160} placeholder="e.g. Commercial Bank"/></label>}
      <label>Opening balance (LKR)<input name="openingBalance" inputMode="decimal" defaultValue="0"/></label>
    </>}
    <div className="form-footer"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy?<LoaderCircle size={17} className="spin"/>:<Check size={17}/>} {busy?'Saving…':kind==='cheque'?'Register cheque':kind==='account'?'Save account':'Save '+kind}</button></div>
  </form></Modal>
}
export function ChequeStatusForm({cheque,onClose}:{cheque:Cheque;onClose:()=>void}){
  const {execute,busy,notify,user}=useStore()
  const [status,setStatus]=useState<ChequeStatus>(allowedStatuses(cheque)[0]??cheque.status)
  const [date,setDate]=useState(today())
  const [error,setError]=useState('')
  const [requestId]=useState(()=>crypto.randomUUID())
  const canUpdate=user?.role!=='staff'&&allowedStatuses(cheque).length>0
  const submit=async(e:FormEvent)=>{e.preventDefault();setError('');try{const synced=await execute({type:'setChequeStatus',requestId,payload:{id:cheque.id,status,date}});notify(!synced?'Saved on the server. Refresh your connection to load the updated balances.':status==='cleared'?'Cheque cleared. One bank movement recorded.':'Cheque status updated.');onClose()}catch(e){setError(errorMessage(e))}}
  return <Modal open title={`Cheque #${cheque.number}`} description={`${cheque.payee} · ${cheque.bank}`} onClose={()=>{if(!busy)onClose()}}><form className="entry-form" onSubmit={submit}>
    <div className="cheque-summary"><div><small>{cheque.type==='issued'?'Payment to supplier / payee':'Receipt from payer'}</small><h2><Money value={cheque.amount}/></h2></div><span className={`badge ${cheque.status}`}>{cheque.status}</span></div>
    <div className="detail-grid"><div><small>Issued</small><strong>{cheque.issueDate}</strong></div><div><small>Due</small><strong>{cheque.dueDate}</strong></div></div>
    {cheque.notes&&<p className="form-note">{cheque.notes}</p>}
    {error&&<div className="form-error" role="alert">{error}</div>}
    {canUpdate?<><label>Update status<select aria-label="Update status" value={status} onChange={e=>setStatus(e.target.value as ChequeStatus)}>{allowedStatuses(cheque).map(s=><option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}</select></label>
      {status==='cleared'&&<><label>Cleared on<input type="date" required value={date} min={cheque.issueDate} max={today()} onChange={e=>setDate(e.target.value)}/></label><div className="info-callout"><ShieldCheck size={22}/><p>Clearing will {cheque.type==='issued'?'deduct from':'add to'} the account balance and record exactly one {cheque.type==='issued'?'expense':'receipt'}. A cleared cheque cannot be edited.</p></div></>}
      <div className="form-footer"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:<ArrowRight size={16}/>}Update status</button></div>
    </>:<><p className="form-note">{user?.role==='staff'?'Ask a manager or owner to change cheque status.':'This cheque is finalised. Its recorded history is retained.'}</p><button type="button" className="button secondary" onClick={onClose}>Close</button></>}
  </form></Modal>
}
