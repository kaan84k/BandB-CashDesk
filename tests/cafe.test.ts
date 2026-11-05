import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCommand, balance, dailyCashRows, isOperating, today, validateSnapshot, addDays, type Snapshot, type Command } from '../src/lib/domain'
import { createDemo, DEMO_USER } from '../src/lib/seed'
function emptyCafe(){const s=createDemo();s.transactions=[];s.transfers=[];s.cashDays=[];s.cheques=[];s.suppliers=[];s.invoices=[];s.audit=[];s.accounts.forEach(a=>a.openingBalance=a.type==='cash'?100000:a.type==='bank'?500000:0);return s}
function run(s:Snapshot,type:Command['type'],payload:unknown){return applyCommand(s,{type,payload} as Command,DEMO_USER)}
function open(s:Snapshot){const cash=s.accounts.find(a=>a.type==='cash')!;return run(s,'openDay',{id:crypto.randomUUID(),branchId:cash.branchId,accountId:cash.id,date:today(),opening:100000,notes:''})}
function entry(s:Snapshot,type:'income'|'expense',amount:number){const cash=s.accounts.find(a=>a.type==='cash')!;return run(s,'addTransaction',{id:crypto.randomUUID(),branchId:cash.branchId,accountId:cash.id,date:today(),type,amount,category:type==='income'?'Sales':'Supplier purchase',description:type==='income'?'Cafe sales':'Supplier products',method:'cash',supplierId:null,chequeId:null})}
function move(s:Snapshot,to:'bank'|'safe',amount:number){const from=s.accounts.find(a=>a.type==='cash')!,target=s.accounts.find(a=>a.type===to)!;return run(s,'transfer',{id:crypto.randomUUID(),branchId:from.branchId,fromAccountId:from.id,toAccountId:target.id,date:today(),amount,description:`Cash to ${to}`})}
afterEach(()=>vi.useRealTimers())
describe('one cafe daily cashbook',()=>{
  it('opens the day and keeps bank deposits and safe movements out of sales',()=>{
    let s=open(emptyCafe());const totalBefore=s.accounts.reduce((n,a)=>n+balance(a,s.transactions),0)
    s=entry(s,'income',50000);s=entry(s,'expense',20000);s=move(s,'bank',30000);s=move(s,'safe',10000)
    expect(balance(s.accounts.find(a=>a.type==='cash')!,s.transactions)).toBe(90000)
    expect(balance(s.accounts.find(a=>a.type==='safe')!,s.transactions)).toBe(10000)
    expect(s.accounts.reduce((n,a)=>n+balance(a,s.transactions),0)).toBe(totalBefore+30000)
    expect(s.transactions.filter(t=>isOperating(t)&&t.type==='income').reduce((n,t)=>n+t.amount,0)).toBe(50000)
    expect(s.transfers).toHaveLength(2)
    const day=s.cashDays[0];s=run(s,'closeDay',{id:day.id,closing:91000,notes:'Extra change found'})
    expect(dailyCashRows(s,today(),today())[0]).toMatchObject({opening:100000,income:50000,expenses:20000,bankDeposits:30000,safeDeposits:10000,expected:90000,closing:91000,variance:1000})
    expect(s.transactions.filter(isOperating)).toHaveLength(2)
  })
  it('requires opening cash and protects closed days from further cash changes',()=>{
    expect(()=>entry(emptyCafe(),'income',1000)).toThrow('Open the cash day')
    let s=open(emptyCafe());s=run(s,'closeDay',{id:s.cashDays[0].id,closing:100000,notes:''})
    expect(()=>entry(s,'income',1000)).toThrow('Closed days')
    expect(()=>move(s,'bank',1000)).toThrow('Closed days')
    expect(()=>run(s,'closeDay',{id:s.cashDays[0].id,closing:100000,notes:''})).toThrow('already closed')
    vi.useFakeTimers();vi.setSystemTime(new Date(addDays(today(),1)+'T12:00:00Z'))
    const cash=s.accounts.find(a=>a.type==='cash')!;s=run(s,'openDay',{id:crypto.randomUUID(),branchId:cash.branchId,accountId:cash.id,date:today(),opening:100000,notes:''});expect(s.cashDays).toHaveLength(2)
  })
  it('requires a reason for differences and does not allow spending missing cash',()=>{
    const s=open(emptyCafe())
    expect(()=>run(s,'closeDay',{id:s.cashDays[0].id,closing:99000,notes:''})).toThrow('note explaining')
    expect(()=>entry(s,'expense',100001)).toThrow('not enough money')
    expect(()=>move(s,'safe',100001)).toThrow('not enough money')
  })
  it('rejects incomplete transfers and altered cash-count backups',()=>{
    const s=move(open(emptyCafe()),'bank',5000);s.transactions=s.transactions.filter(t=>!(t.transferId&&t.type==='income'));expect(()=>validateSnapshot(s)).toThrow('two matching')
    let other=open(emptyCafe());other=run(other,'closeDay',{id:other.cashDays[0].id,closing:99000,notes:'Missing change'});other.transactions=[];expect(()=>validateSnapshot(other)).toThrow('adjustment does not match')
  })
})
