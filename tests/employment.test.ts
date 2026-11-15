import { describe,it,expect } from 'vitest'
import { createDemo,DEMO_USER } from '../src/lib/seed'
import { applyCommand,today,addDays } from '../src/lib/domain'
import { calculatePayroll,emptyEmployment,availableAdvance,monthEnd,type Employee,type PayrollInput } from '../src/lib/employment'
const period=today().slice(0,7)+'-01'
export function employeeFixture():Employee{return {id:crypto.randomUUID(),branchId:createDemo().branches[0].id,name:'Cashier employee',phone:'0771234567',joined:'2026-01-01',active:true,payType:'monthly',rate:5000000,allowance:0,workingDays:26,leaveAllowance:14,epfEnabled:true,etfEnabled:true,employeeRate:800,employerRate:1200,etfRate:300}}
export function payrollFixture(e:Employee):PayrollInput{return {id:crypto.randomUUID(),employeeId:e.id,month:period,workingDays:26,scheduledDays:26,allowance:0,eligible:5000000,advance:0,other:0,note:''}}
describe('owner-managed employment',()=>{
 it('calculates the agreed 50,000 salary, contribution shares and employer cost exactly',()=>{const e=employeeFixture(),c=calculatePayroll(emptyEmployment(),e,payrollFixture(e));expect(c).toMatchObject({gross:5000000,employeeEpf:400000,employerEpf:600000,etf:150000,net:4600000,cost:5750000})})
 it('prorates monthly absence and daily pay including paid and unpaid leave and half days',()=>{
  const e=employeeFixture(),hr=emptyEmployment();e.rate=2600000
  hr.attendance=['present','paid_leave','unpaid_leave','absent','half_day'].map((status,i)=>({id:crypto.randomUUID(),employeeId:e.id,date:addDays(period,i),status:status as 'present',note:''}))
  const p={...payrollFixture(e),eligible:2350000};expect(calculatePayroll(hr,e,p)).toMatchObject({paidUnits:2.5,unpaidUnits:2.5,basic:2600000,absence:250000,gross:2350000})
  e.payType='daily';e.rate=100000;p.eligible=250000;expect(calculatePayroll(hr,e,p)).toMatchObject({basic:500000,absence:250000,gross:250000})
 })
 it('allows reviewed contribution earnings and optional rates without deducting employer shares',()=>{const e=employeeFixture(),p={...payrollFixture(e),allowance:100000,eligible:5000000};expect(calculatePayroll(emptyEmployment(),e,p).net).toBe(4700000);e.epfEnabled=false;expect(calculatePayroll(emptyEmployment(),e,p)).toMatchObject({employeeEpf:0,employerEpf:0,etf:150000,net:5100000});e.etfEnabled=false;expect(calculatePayroll(emptyEmployment(),e,p).cost).toBe(5100000)})
 it('does not change cash until a salary or contribution payment is recorded',()=>{
  const e=employeeFixture();let d=applyCommand(createDemo(),{type:'saveEmployee',payload:e},DEMO_USER);const before=d.transactions.length,p=payrollFixture(e),c=calculatePayroll(d.employment,e,p)
  d=applyCommand(d,{type:'approvePayroll',payload:{...p,expected:c}},DEMO_USER);expect(d.transactions).toHaveLength(before)
  const bank=d.accounts.find(a=>a.type==='bank')!,id=crypto.randomUUID();d=applyCommand(d,{type:'payPayroll',payload:{id,payrollId:p.id,kind:'salary',amount:4600000,date:today(),accountId:bank.id,note:''}},DEMO_USER)
  expect(d.transactions.filter(t=>t.id===id)).toHaveLength(1);expect(d.employment.payments[0].transactionId).toBe(id)
  expect(()=>applyCommand(d,{type:'payPayroll',payload:{id:crypto.randomUUID(),payrollId:p.id,kind:'salary',amount:1,date:today(),accountId:bank.id,note:''}},DEMO_USER)).toThrow('outstanding')
  expect(()=>applyCommand(d,{type:'voidPayroll',payload:{id:p.id,reason:'Correction'}},DEMO_USER)).toThrow('Paid payroll')
 })
 it('keeps employees separate from login removal and preserves approved salary snapshots',()=>{
  const e=employeeFixture();let d=applyCommand(createDemo(),{type:'saveEmployee',payload:e},DEMO_USER),p=payrollFixture(e)
  d=applyCommand(d,{type:'approvePayroll',payload:{...p,expected:calculatePayroll(d.employment,e,p)}},DEMO_USER)
  d=applyCommand(d,{type:'saveEmployee',payload:{...e,name:'New name',rate:6000000,active:false}},DEMO_USER)
  expect(d.employment.payrolls[0]).toMatchObject({employeeName:e.name,rate:5000000});expect(d.members).toHaveLength(3)
  expect(()=>applyCommand(d,{type:'saveEmployee',payload:e},{...DEMO_USER,role:'manager'})).toThrow('Only the owner')
 })
 it('rejects excessive deductions and invalid schedules and distinguishes approved advance allocations',()=>{
  const e=employeeFixture(),hr=emptyEmployment(),p=payrollFixture(e)
  expect(()=>calculatePayroll(hr,e,{...p,eligible:5000001})).toThrow('Eligible')
  expect(()=>calculatePayroll(hr,e,{...p,other:5000000})).toThrow('Deductions')
  expect(()=>calculatePayroll(hr,e,{...p,scheduledDays:27})).toThrow('Scheduled')
  expect(()=>calculatePayroll(hr,e,{...p,advance:1})).toThrow('advances')
  expect(monthEnd('2024-02-01')).toBe('2024-02-29');expect(availableAdvance(hr,e.id,period)).toBe(0)
 })
})
