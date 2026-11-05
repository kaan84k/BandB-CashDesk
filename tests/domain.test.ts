import { describe, it, expect, vi, afterEach } from 'vitest'
import { createDemo, DEMO_USER } from '../src/lib/seed'
import { addDays, allowedStatuses, applyCommand, balance, chequeForecast, daysUntil, parseMoney, reminders, supplierBalance, today, validateSnapshot, type Command } from '../src/lib/domain'

const total=(s:ReturnType<typeof createDemo>)=>s.accounts.reduce((n,a)=>n+balance(a,s.transactions),0)
afterEach(()=>vi.useRealTimers())
describe('money and dates',()=>{
  it('parses decimals into exact minor units',()=>{expect(parseMoney('1,234.56')).toBe(123456);expect(parseMoney('0.01')).toBe(1);expect(parseMoney('10.1')).toBe(1010)})
  it('permits an explicit zero opening balance, while requiring positive movements',()=>{expect(parseMoney('0',true)).toBe(0);expect(()=>parseMoney('0')).toThrow()})
  it.each(['-1','0','1.234','1e5','NaN','','Infinity'])('rejects invalid amount %s',value=>expect(()=>parseMoney(value)).toThrow())
  it('uses Colombo dates at the UTC date boundary',()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T20:00:00Z'));expect(today()).toBe('2026-11-05');expect(addDays('2026-11-01',-1)).toBe('2026-10-31');expect(daysUntil('2026-11-07')).toBe(2)})
})
describe('ledger and cheque lifecycle',()=>{
  it('starts with internally consistent, explicitly fictional records',()=>{const s=createDemo();expect(validateSnapshot(s)).toEqual(s);expect(s.members[0].email).toContain('example.com')})
  it('registration does not move funds; clearing moves them exactly once',()=>{
    const s=createDemo(),c={...s.cheques[0],id:crypto.randomUUID(),number:'TEST100',amount:10101}
    const registered=applyCommand(s,{type:'addCheque',payload:c},DEMO_USER)
    expect(total(registered)).toBe(total(s))
    const cleared=applyCommand(registered,{type:'setChequeStatus',payload:{id:c.id,status:'cleared',date:today()}},DEMO_USER)
    expect(total(cleared)).toBe(total(s)-10101);expect(cleared.transactions.filter(t=>t.chequeId===c.id)).toHaveLength(1)
    expect(()=>applyCommand(cleared,{type:'setChequeStatus',payload:{id:c.id,status:'cleared',date:today()}},DEMO_USER)).toThrow()
    expect(allowedStatuses(cleared.cheques.find(x=>x.id===c.id)!)).toEqual([])
  })
  it('received cheque clearance increases the balance',()=>{const s=createDemo(),c=s.cheques.find(c=>c.type==='received')!;const next=applyCommand(s,{type:'setChequeStatus',payload:{id:c.id,status:'cleared',date:today()}},DEMO_USER);expect(total(next)).toBe(total(s)+c.amount)})
  it('supplier balance falls on payment, not cheque issue',()=>{const s=createDemo(),c=s.cheques[0],supplier=s.suppliers.find(p=>p.id===c.supplierId)!;expect(supplierBalance(supplier,s)).toBe(12500000);const next=applyCommand(s,{type:'setChequeStatus',payload:{id:c.id,status:'cleared',date:today()}},DEMO_USER);expect(supplierBalance(supplier,next)).toBe(0)})
  it('returns and cancellations never move funds',()=>{const s=createDemo(),c=s.cheques[0];const returned=applyCommand(s,{type:'setChequeStatus',payload:{id:c.id,status:'returned',date:today()}},DEMO_USER);expect(total(returned)).toBe(total(s));expect(()=>applyCommand(returned,{type:'setChequeStatus',payload:{id:c.id,status:'cleared',date:today()}},DEMO_USER)).toThrow();const cancelled=applyCommand(returned,{type:'setChequeStatus',payload:{id:c.id,status:'cancelled',date:today()}},DEMO_USER);expect(total(cancelled)).toBe(total(s))})
  it('requires an actual clearance date',()=>{const s=createDemo(),c=s.cheques[0];expect(()=>applyCommand(s,{type:'setChequeStatus',payload:{id:c.id,status:'cleared',date:addDays(today(),1)}},DEMO_USER)).toThrow('Clearance date')})
  it('rejects duplicate cheque identities and mismatched branches',()=>{const s=createDemo(),c={...s.cheques[0],id:crypto.randomUUID()};expect(()=>applyCommand(s,{type:'addCheque',payload:c},DEMO_USER)).toThrow('already exists');c.number='NEW';c.branchId=s.branches[1].id;expect(()=>applyCommand(s,{type:'addCheque',payload:c},DEMO_USER)).toThrow('Account must belong')})
  it('prevents fabricated cash movements with cheque references',()=>{const s=createDemo(),t={...s.transactions[0],id:crypto.randomUUID(),chequeId:s.cheques[0].id};expect(()=>applyCommand(s,{type:'addTransaction',payload:t},DEMO_USER)).toThrow('clearance')})
  it('rejects tampered or incomplete backups',()=>{const s=createDemo();s.transactions=s.transactions.filter(t=>!t.chequeId);expect(()=>validateSnapshot(s)).toThrow('exactly one');const t=createDemo();t.transactions.push({...t.transactions[0]});expect(()=>validateSnapshot(t)).toThrow('Duplicate')})
  it('prevents staff clearance and removal of the last owner',()=>{const s=createDemo();const cmd:Command={type:'setChequeStatus',payload:{id:s.cheques[0].id,status:'cleared',date:today()}};expect(()=>applyCommand(s,cmd,{...DEMO_USER,role:'staff'})).toThrow('manager');expect(()=>applyCommand(s,{type:'setMemberRole',payload:{id:DEMO_USER.id,role:'staff'}},DEMO_USER)).toThrow('at least one owner')})
  it('keeps the source immutable and appends audit evidence',()=>{const s=createDemo(),before=JSON.stringify(s);const result=applyCommand(s,{type:'addSupplier',payload:{...s.suppliers[0],id:crypto.randomUUID(),name:'Test supplier'}},DEMO_USER);expect(JSON.stringify(s)).toBe(before);expect(result.audit[0].actor).toBe(DEMO_USER.name);expect(result.suppliers).toHaveLength(s.suppliers.length+1)})
  it('flags returned, overdue, and upcoming cheques and excludes finalised ones',()=>{const s=createDemo(),r=reminders(s);expect(r.some(c=>c.status==='returned')).toBe(true);expect(r.every(c=>!['cleared','cancelled'].includes(c.status))).toBe(true);expect(r.some(c=>daysUntil(c.dueDate)>7)).toBe(false)})
  it('forecasts commitments without counting cleared cheques twice',()=>{const s=createDemo(),forecast=chequeForecast(s);expect(forecast).toHaveLength(31);expect(forecast.at(-1)!.balance).toBe(total(s)-27500000+7500000);const c=s.cheques[0];const cleared=applyCommand(s,{type:'setChequeStatus',payload:{id:c.id,status:'cleared',date:today()}},DEMO_USER);expect(chequeForecast(cleared).at(-1)!.balance).toBe(forecast.at(-1)!.balance)})
})
