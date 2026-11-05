import { useState, type FormEvent } from 'react'
import { Check, LoaderCircle, ShieldCheck, ArrowRight } from 'lucide-react'
import { ZodError } from 'zod'
import { Modal, Money } from './ui'
import { useStore } from '../lib/store'
import { allowedStatuses, categories, parseMoney, today, type Cheque, type Command, type ChequeStatus } from '../lib/domain'

export type FormKind = 'income'|'expense'|'cheque'|'account'|'supplier'|'invoice'
export function errorMessage(e:unknown){return e instanceof ZodError?e.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('. '):e instanceof Error?e.message:'Something went wrong. Please try again.'}
const titles:Record<FormKind,[string,string]>={
  income:['Record income','Keep track of every sale, receipt, and little win.'],expense:['Record an expense','A clear record of where your money goes.'],cheque:['Register a cheque','Track a commitment now. Move funds only when it clears.'],account:['Add an account','Give every rupee a home.'],supplier:['Add a supplier','Keep the people behind your business close.'],invoice:['Record a supplier invoice','Track a purchase on credit. This does not move cash.'],
}
export function EntryForm({kind,onClose}:{kind:FormKind;onClose:()=>void}){
  const {data,branch,execute,busy,notify}=useStore()
  const [branchId,setBranchId]=useState(branch==='all'?data!.branches[0].id:branch)
  const [direction,setDirection]=useState<'issued'|'received'>('issued')
  const [accountType,setAccountType]=useState('bank')
  const [error,setError]=useState('')
  const [supplierId,setSupplierId]=useState('')
  const suppliers=data!.suppliers.filter(s=>s.branchId===branchId)
  const accounts=data!.accounts.filter(a=>a.branchId===branchId && (kind!=='cheque'||a.type==='bank'))
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setError('')
    const f=new FormData(e.currentTarget)
    const s=(name:string)=>String(f.get(name)??'').trim()
    try{
      const base={id:crypto.randomUUID(),branchId}
      let command:Command
      if(kind==='income'||kind==='expense')command={type:'addTransaction',payload:{...base,accountId:s('accountId'),amount:parseMoney(s('amount')),type:kind,category:s('category'),description:s('description'),date:s('date'),method:s('method') as 'cash'|'card'|'transfer',supplierId:kind==='expense'&&s('supplierId')?s('supplierId'):null,chequeId:null}}
      else if(kind==='cheque')command={type:'addCheque',payload:{...base,accountId:s('accountId'),number:s('number'),type:direction,payee:s('payee'),supplierId:direction==='issued'&&s('supplierId')?s('supplierId'):null,bank:s('bank'),amount:parseMoney(s('amount')),issueDate:s('issueDate'),dueDate:s('dueDate'),status:direction,notes:s('notes')}}
      else if(kind==='account')command={type:'addAccount',payload:{...base,name:s('name'),type:s('accountType') as 'bank'|'cash'|'petty',bank:s('bank'),openingBalance:s('openingBalance')?parseMoney(s('openingBalance'),true):0}}
      else if(kind==='supplier')command={type:'addSupplier',payload:{...base,name:s('name'),contact:s('contact'),email:s('email'),phone:s('phone'),terms:Number(s('terms'))}}
      else command={type:'addInvoice',payload:{...base,supplierId:s('supplierId'),reference:s('reference'),amount:parseMoney(s('amount')),date:s('date'),dueDate:s('dueDate')}}
      await execute(command);notify(kind==='cheque'?'Cheque registered. Your bank balance is unchanged.':kind==='invoice'?'Invoice recorded. Supplier balance updated.':'Saved successfully. Your workspace is up to date.');onClose()
    }catch(e){setError(errorMessage(e))}
  }
  return <Modal open title={titles[kind][0]} description={titles[kind][1]} onClose={()=>{if(!busy)onClose()}}><form onSubmit={submit} className="entry-form">
    {error&&<div className="form-error" role="alert">{error}</div>}
    {kind==='cheque'&&<div className="segmented full"><button type="button" className={direction==='issued'?'active':''} onClick={()=>{setDirection('issued');setSupplierId('')}}>Issued · money out</button><button type="button" className={direction==='received'?'active':''} onClick={()=>{setDirection('received');setSupplierId('')}}>Received · money in</button></div>}
    <label>Branch<select value={branchId} onChange={e=>{setBranchId(e.target.value);setSupplierId('')}}>{data!.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    {(kind==='income'||kind==='expense')&&<>
      <label>Description<input name="description" placeholder={kind==='income'?'e.g. Afternoon cafe sales':'e.g. Fresh ingredients'} maxLength={160} required autoFocus/></label>
      <div className="form-grid"><label>Amount (LKR)<input name="amount" inputMode="decimal" placeholder="0.00" required pattern="[0-9,]+(\.[0-9]{1,2})?"/></label><label>Date<input type="date" name="date" defaultValue={today()} max={today()} required/></label></div>
      <div className="form-grid"><label>Category<select name="category">{categories.filter(c=>kind==='income'?['Cafe sales','Bakery sales','Packed cookies','Other income'].includes(c):!['Cafe sales','Bakery sales','Packed cookies','Other income'].includes(c)).map(c=><option key={c}>{c}</option>)}</select></label><label>Payment method<select name="method"><option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Bank transfer</option></select></label></div>
      {kind==='expense'&&<label>Supplier <span className="optional">optional · reduces credit balance</span><select name="supplierId"><option value="">No supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    </>}
    {kind==='cheque'&&<>
      <div className="form-grid"><label>Cheque number<input name="number" placeholder="001257" pattern="[A-Za-z0-9-]{1,30}" required autoFocus/></label><label>Amount (LKR)<input name="amount" inputMode="decimal" placeholder="0.00" required/></label></div>
      {direction==='issued'&&<label>Supplier <span className="optional">optional</span><select name="supplierId" value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Other payee</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <label>{direction==='issued'?'Payee':'Payer'}<input key={supplierId+direction} name="payee" defaultValue={suppliers.find(s=>s.id===supplierId)?.name??''} placeholder={direction==='issued'?'Who are you paying?':'Who is paying you?'} maxLength={160} required/></label>
      <label>Bank on cheque<input name="bank" placeholder="e.g. Commercial Bank" maxLength={160} required/></label>
      <div className="form-grid"><label>Issue date<input name="issueDate" type="date" defaultValue={today()} required/></label><label>Due date<input name="dueDate" type="date" defaultValue={today()} required/></label></div>
      <label>Notes <span className="optional">optional</span><textarea name="notes" placeholder="Anything to remember about this cheque" maxLength={1000} rows={2}/></label>
    </>}
    {(kind==='income'||kind==='expense'||kind==='cheque')&&<label>{kind==='cheque'?'Settlement account':'Account'}<select name="accountId" key={branchId} required defaultValue={accounts[0]?.id??''}><option value="" disabled>Select an account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>{!accounts.length&&<small className="negative">Add {kind==='cheque'?'a bank':'an'} account for this branch first.</small>}</label>}
    {kind==='account'&&<>
      <label>Account name<input name="name" required placeholder="e.g. Main current account" maxLength={160} autoFocus/></label>
      <label>Account type<select name="accountType" value={accountType} onChange={e=>setAccountType(e.target.value)}><option value="bank">Bank account</option><option value="cash">Cash till</option><option value="petty">Petty cash</option></select></label>
      {accountType==='bank'&&<label>Bank name<input name="bank" placeholder="e.g. Commercial Bank" maxLength={160} required/></label>}
      <label>Opening balance (LKR)<input name="openingBalance" placeholder="0.00" inputMode="decimal"/></label>
      <p className="form-note">Set the starting balance before recorded movements. Subsequent income and expenses are added to this amount.</p>
    </>}
    {kind==='supplier'&&<>
      <label>Supplier name<input name="name" placeholder="e.g. Serendib Flour Mills" maxLength={160} autoFocus required/></label>
      <label>Contact person<input name="contact" maxLength={160} placeholder="Name of your contact"/></label>
      <div className="form-grid"><label>Phone<input name="phone" type="tel" placeholder="+94" maxLength={40}/></label><label>Payment terms (days)<input name="terms" type="number" min="0" max="365" defaultValue="30" required/></label></div>
      <label>Email<input name="email" type="email" placeholder="supplier@example.com"/></label>
    </>}
    {kind==='invoice'&&<>
      <label>Supplier<select aria-label="Supplier" name="supplierId" required defaultValue=""><option value="" disabled>Choose a supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="form-grid"><label>Invoice reference<input name="reference" required placeholder="INV-001" maxLength={160}/></label><label>Amount (LKR)<input name="amount" inputMode="decimal" placeholder="0.00" required/></label></div>
      <div className="form-grid"><label>Invoice date<input name="date" type="date" defaultValue={today()} required/></label><label>Due date<input name="dueDate" type="date" defaultValue={today()} required/></label></div>
      <p className="form-note">Record payments as supplier expenses, or clear a supplier-linked cheque. Both reduce the supplier balance once.</p>
    </>}
    <div className="form-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>{busy?<LoaderCircle size={17} className="spin"/>:<Check size={17}/>} {busy?'Saving…':kind==='cheque'?'Register cheque':kind==='invoice'?'Save invoice':'Save '+(kind==='account'?'account':kind==='supplier'?'supplier':kind)}</button></div>
  </form></Modal>
}
export function ChequeStatusForm({cheque,onClose}:{cheque:Cheque;onClose:()=>void}){
  const {execute,busy,notify,user}=useStore()
  const [status,setStatus]=useState<ChequeStatus>(allowedStatuses(cheque)[0]??cheque.status)
  const [date,setDate]=useState(today())
  const [error,setError]=useState('')
  const canUpdate=user?.role!=='staff'&&allowedStatuses(cheque).length>0
  const submit=async(e:FormEvent)=>{e.preventDefault();setError('');try{await execute({type:'setChequeStatus',payload:{id:cheque.id,status,date}});notify(status==='cleared'?'Cheque cleared. One bank movement recorded.':'Cheque status updated.');onClose()}catch(e){setError(errorMessage(e))}}
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
