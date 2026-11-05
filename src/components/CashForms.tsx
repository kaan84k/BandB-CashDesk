import { useState, type FormEvent } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { balanceOn, parseMoney, today, type CashDay } from '../lib/domain'
import { useScope, useStore } from '../lib/store'
import { Modal, Money } from './ui'
import { errorMessage } from './EntryForm'
export function TransferForm({destination,onClose}:{destination?:'bank'|'safe';onClose:()=>void}){
  const data=useScope(),{execute,busy,notify}=useStore(),[id]=useState(()=>crypto.randomUUID()),[error,setError]=useState('')
  const drawer=data.accounts.find(a=>a.type==='cash')
  const [from,setFrom]=useState(drawer?.id??data.accounts[0]?.id??'')
  const [to,setTo]=useState(data.accounts.find(a=>a.type===(destination??'bank'))?.id??(destination?'':data.accounts.find(a=>a.id!==from)?.id??''))
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError('');const f=new FormData(event.currentTarget)
    try{
      const description=String(f.get('description')??'').trim()||`${data.accounts.find(a=>a.id===from)?.name} → ${data.accounts.find(a=>a.id===to)?.name}`
      const synced=await execute({type:'transfer',requestId:id,payload:{id,branchId:data.branches[0].id,fromAccountId:from,toAccountId:to,amount:parseMoney(String(f.get('amount'))),date:String(f.get('date')),description}})
      notify(synced?'Money moved. Your sales and expenses are unchanged.':'Transfer saved. Refresh the connection to see the balances.');onClose()
    }catch(e){setError(errorMessage(e))}
  }
  return <Modal open title={destination==='bank'?'Deposit to bank':destination==='safe'?'Move money to safe':'Move money'} description="Record money moved between your cash drawer, bank and personal safe." onClose={()=>{if(!busy)onClose()}}><form className="entry-form" onSubmit={submit}>
    {error&&<div className="form-error" role="alert">{error}</div>}
    <label>From<select aria-label="Transfer from" value={from} onChange={e=>setFrom(e.target.value)} required>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>To<select aria-label="Transfer to" value={to} onChange={e=>setTo(e.target.value)} required><option value="" disabled>Choose destination</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <div className="form-grid"><label>Amount (LKR)<input name="amount" inputMode="decimal" placeholder="0.00" required autoFocus/></label><label>Date<input name="date" type="date" defaultValue={today()} max={today()} required/></label></div>
    <label>Note <span className="optional">optional</span><input name="description" maxLength={160} placeholder="e.g. Afternoon bank deposit"/></label>
    <p className="form-note">This changes where your money is kept. It does not change your total money or count as a sale or expense.</p>
    <div className="form-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}><ArrowRight size={17}/>{busy?'Saving…':'Save transfer'}</button></div>
  </form></Modal>
}
export function CashDayForm({mode,day,onClose}:{mode:'open'|'close';day?:CashDay;onClose:()=>void}){
  const data=useScope(),{execute,busy,notify}=useStore(),[requestId]=useState(()=>crypto.randomUUID()),[error,setError]=useState('')
  const drawer=data.accounts.find(a=>a.id===day?.accountId)??data.accounts.find(a=>a.type==='cash')
  const date=day?.date??today(),expected=drawer?balanceOn(drawer,data.transactions,date,mode==='open'):0
  const [count,setCount]=useState((Math.max(0,expected)/100).toFixed(2))
  const firstOpening=mode==='open'&&drawer?.openingBalance===0&&!data.cashDays.some(d=>d.accountId===drawer?.id)&&!data.transactions.some(t=>t.accountId===drawer?.id)
  let difference=0;try{difference=firstOpening?0:parseMoney(count,true)-expected}catch{}
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError('');const f=new FormData(event.currentTarget)
    try{
      if(!drawer)throw new Error('Add your cash drawer first under Bank & safe')
      const amount=parseMoney(count,true),notes=String(f.get('notes')??'').trim()
      const synced=await execute(mode==='open'?{type:'openDay',requestId,payload:{id:requestId,branchId:drawer.branchId,accountId:drawer.id,date,opening:amount,notes}}:{type:'closeDay',requestId,payload:{id:day!.id,closing:amount,notes}})
      notify(synced?(mode==='open'?'Day opened. You can now record cash sales and expenses.':'Day closed. Your closing cash is saved.'):'Saved on the server. Refresh your connection to see it.');onClose()
    }catch(e){setError(errorMessage(e))}
  }
  return <Modal open title={mode==='open'?'Open cash day':'Close cash day'} description={`${date} · Count the money physically in your cash drawer.`} onClose={()=>{if(!busy)onClose()}}><form className="entry-form" onSubmit={submit}>
    {error&&<div className="form-error" role="alert">{error}</div>}
    <div className="cash-count-expected"><span>{mode==='open'?'Previous cash balance':'Expected cash in drawer'}</span><strong><Money value={expected}/></strong></div>
    <label>{mode==='open'?'Opening cash (LKR)':'Closing cash (LKR)'}<input inputMode="decimal" value={count} onChange={e=>setCount(e.target.value)} required autoFocus/></label>
    {difference!==0&&<div className="info-callout"><p>There is a difference of <Money value={difference}/>. It will be recorded separately as a cash count adjustment, not as sales or expenses.</p></div>}
    <label>Note {difference===0&&<span className="optional">optional</span>}<textarea name="notes" maxLength={1000} rows={2} required={difference!==0} placeholder={difference?'Explain the difference':'Anything to remember about this day'}/></label>
    <div className="form-footer"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}><Check size={17}/>{busy?'Saving…':mode==='open'?'Open day':'Close day'}</button></div>
  </form></Modal>
}
