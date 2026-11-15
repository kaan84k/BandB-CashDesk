import { z } from 'zod'
import type { Snapshot, Command } from './domain'
const id=z.string().uuid(), cents=z.number().int().min(0).max(999999999999)
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Enter a valid date')
const month=date.refine(s=>s.endsWith('-01'),'Choose a month')
export const attendanceStatuses=['present','absent','half_day','paid_leave','unpaid_leave','off'] as const
export const attendanceLabels:Record<string,string>={present:'Present',absent:'Absent',half_day:'Half day (½ pay)',paid_leave:'Paid leave',unpaid_leave:'Unpaid leave',off:'Rest day'}
export const employeeSchema=z.object({id,branchId:id,name:z.string().trim().min(1).max(160),phone:z.string().max(40),joined:date,active:z.boolean(),payType:z.enum(['monthly','daily']),rate:cents,allowance:cents,workingDays:z.number().int().min(1).max(31),leaveAllowance:z.number().int().min(0).max(366),epfEnabled:z.boolean(),etfEnabled:z.boolean(),employeeRate:z.number().int().min(0).max(10000),employerRate:z.number().int().min(0).max(10000),etfRate:z.number().int().min(0).max(10000)})
export const attendanceSchema=z.object({id,employeeId:id,date,status:z.enum(attendanceStatuses),note:z.string().max(500)})
export const payrollInputSchema=z.object({id,employeeId:id,month,workingDays:z.number().int().min(1).max(31),scheduledDays:z.number().int().min(0).max(31),allowance:cents,eligible:cents,advance:cents,other:cents,note:z.string().max(500)})
export const payrollCalculationSchema=z.object({basic:cents,absence:cents,earned:cents,gross:cents,eligible:cents,employeeEpf:cents,employerEpf:cents,etf:cents,advance:cents,other:cents,net:cents,cost:cents,paidUnits:z.number(),unpaidUnits:z.number(),recordedDays:z.number().int()})
export const payrollSchema=payrollInputSchema.extend({branchId:id,employeeName:z.string(),joined:date,payType:z.enum(['monthly','daily']),rate:cents,employeeRate:z.number(),employerRate:z.number(),etfRate:z.number(),epfEnabled:z.boolean(),etfEnabled:z.boolean(),calculation:payrollCalculationSchema,status:z.enum(['approved','void']),approvedAt:z.string(),voidReason:z.string().default(''),attendance:z.array(attendanceSchema)})
export const advanceSchema=z.object({id,employeeId:id,branchId:id,amount:cents,date,note:z.string(),transactionId:id})
export const payRecordSchema=z.object({id,payrollId:id,kind:z.enum(['salary','epf','etf']),amount:cents,date,accountId:id,transactionId:id,note:z.string()})
export const attendanceChangeSchema=z.object({id,employeeId:id,from:date,to:date,note:z.string(),at:z.string(),actorName:z.string(),before:z.array(attendanceSchema),after:z.array(attendanceSchema)})
export const employmentSchema=z.object({changes:z.array(attendanceChangeSchema).default([]),employees:z.array(employeeSchema).default([]),attendance:z.array(attendanceSchema).default([]),payrolls:z.array(payrollSchema).default([]),advances:z.array(advanceSchema).default([]),payments:z.array(payRecordSchema).default([])})
export const emptyEmployment=()=>employmentSchema.parse({})
export type Employee=z.infer<typeof employeeSchema>
export type Attendance=z.infer<typeof attendanceSchema>
export type PayrollInput=z.infer<typeof payrollInputSchema>
export type Payroll=z.infer<typeof payrollSchema>
export type Employment=z.infer<typeof employmentSchema>
export type PayrollCalculation=z.infer<typeof payrollCalculationSchema>
export type EmploymentCommand=
 |{type:'saveEmployee';payload:Employee}
 |{type:'setAttendance';payload:{id:string;employeeId:string;from:string;to:string;status:Attendance['status']|'clear';note:string}}
 |{type:'approvePayroll';payload:PayrollInput&{expected:PayrollCalculation}}
 |{type:'voidPayroll';payload:{id:string;reason:string}}
 |{type:'payPayroll';payload:{id:string;payrollId:string;kind:'salary'|'epf'|'etf';amount:number;date:string;accountId:string;note:string}}
 |{type:'addAdvance';payload:{id:string;employeeId:string;amount:number;date:string;accountId:string;note:string}}
export const hrTypes=['saveEmployee','setAttendance','approvePayroll','voidPayroll','payPayroll','addAdvance']
export function monthEnd(value:string){const d=new Date(value+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1,0);return d.toISOString().slice(0,10)}
export function monthDates(value:string){const end=Number(monthEnd(value).slice(-2));return Array.from({length:end},(_,i)=>value.slice(0,8)+String(i+1).padStart(2,'0'))}
export function availableAdvance(hr:Employment,employeeId:string,period:string){return hr.advances.filter(a=>a.employeeId===employeeId&&a.date<=monthEnd(period)).reduce((n,a)=>n+a.amount,0)-hr.payrolls.filter(p=>p.employeeId===employeeId&&p.status==='approved').reduce((n,p)=>n+p.calculation.advance,0)}
export function paymentDue(hr:Employment,p:Payroll,kind:'salary'|'epf'|'etf'){const amount=kind==='salary'?p.calculation.net:kind==='epf'?p.calculation.employeeEpf+p.calculation.employerEpf:p.calculation.etf;return amount-hr.payments.filter(x=>x.payrollId===p.id&&x.kind===kind).reduce((n,x)=>n+x.amount,0)}
const ratio=(n:number,units:number,divisor:number)=>Number((BigInt(n)*BigInt(Math.round(units*2))+BigInt(divisor))/(BigInt(divisor)*2n))
const contribution=(n:number,bps:number)=>Number((BigInt(n)*BigInt(bps)+5000n)/10000n)
export function calculatePayroll(hr:Employment,employee:Employee,raw:PayrollInput):PayrollCalculation{
 const p=payrollInputSchema.parse(raw),end=monthEnd(p.month)
 if(end<employee.joined)throw new Error('This month is before the employee joined')
 const rows=hr.attendance.filter(a=>a.employeeId===employee.id&&a.date>=p.month&&a.date<=end)
 const paidUnits=rows.reduce((n,a)=>n+(a.status==='present'||a.status==='paid_leave'?1:a.status==='half_day'?.5:0),0)
 const unpaidUnits=rows.reduce((n,a)=>n+(a.status==='absent'||a.status==='unpaid_leave'?1:a.status==='half_day'?.5:0),0)
 const recordedDays=rows.filter(a=>a.status!=='off').length
 const eligibleDays=monthDates(p.month).filter(d=>d>=employee.joined).length
 if(p.scheduledDays>p.workingDays||p.scheduledDays>eligibleDays||recordedDays>p.scheduledDays||unpaidUnits>p.scheduledDays)throw new Error('Scheduled days must cover marked working days and fit the employment period')
 const basic=employee.payType==='monthly'?ratio(employee.rate,p.scheduledDays,p.workingDays):ratio(employee.rate,paidUnits+unpaidUnits,1)
 const absence=employee.payType==='monthly'?ratio(employee.rate,unpaidUnits,p.workingDays):ratio(employee.rate,unpaidUnits,1)
 const earned=basic-absence,gross=earned+p.allowance
 if(p.eligible>gross)throw new Error('Eligible earnings cannot exceed gross salary')
 const employeeEpf=employee.epfEnabled?contribution(p.eligible,employee.employeeRate):0,employerEpf=employee.epfEnabled?contribution(p.eligible,employee.employerRate):0,etf=employee.etfEnabled?contribution(p.eligible,employee.etfRate):0
 if(p.advance>Math.max(0,availableAdvance(hr,employee.id,p.month)))throw new Error('Advance deduction exceeds unallocated advances')
 const net=gross-employeeEpf-p.advance-p.other
 if(net<0)throw new Error('Deductions exceed salary; reduce the deductions or carry advances forward')
 return payrollCalculationSchema.parse({basic,absence,earned,gross,eligible:p.eligible,employeeEpf,employerEpf,etf,advance:p.advance,other:p.other,net,cost:gross+employerEpf+etf,paidUnits,unpaidUnits,recordedDays})
}
/** Called only after the owner check; the connected database independently enforces the same rules. */
export function applyEmploymentCommand(next:Snapshot,command:EmploymentCommand,today:string,actorName:string,write:(command:Command)=>void){
 const hr=next.employment,p=command.payload
 const findEmployee=(id:string)=>{const e=hr.employees.find(x=>x.id===id);if(!e)throw new Error('Employee not found');return e}
 const locked=(employeeId:string,period:string)=>hr.payrolls.some(x=>x.employeeId===employeeId&&x.month===period&&x.status==='approved')
 const periodOf=(d:string)=>d.slice(0,7)+'-01'
 if(command.type==='saveEmployee'){
  const e=employeeSchema.parse(command.payload);if(!next.branches.some(b=>b.id===e.branchId))throw new Error('Choose a location in your business')
  const prior=hr.employees.find(x=>x.id===e.id);if(prior&&prior.branchId!==e.branchId)throw new Error('Keep the employee in their original location')
  if(hr.attendance.some(a=>a.employeeId===e.id&&a.date<e.joined)||hr.advances.some(a=>a.employeeId===e.id&&a.date<e.joined))throw new Error('Joining date cannot follow existing attendance')
  if(prior)Object.assign(prior,e);else hr.employees.push(e)
 }else if(command.type==='setAttendance'){
  const a=command.payload,e=findEmployee(a.employeeId);date.parse(a.from);date.parse(a.to)
  if(!e.active)throw new Error('Activate the employee before changing attendance')
  if(a.from>a.to||a.from.slice(0,7)!==a.to.slice(0,7)||a.from<e.joined)throw new Error('Choose dates in one month on or after joining')
  if(a.note.length>500)throw new Error('Keep the note under 500 characters')
  if(locked(e.id,periodOf(a.from)))throw new Error('Attendance is locked by approved payroll. Void unpaid payroll to correct it.')
  const before=structuredClone(hr.attendance.filter(x=>x.employeeId===e.id&&x.date>=a.from&&x.date<=a.to))
  if(before.some(x=>x.status!==a.status||x.note!==a.note)&&!a.note.trim())throw new Error('Add a note explaining the attendance correction')
  for(const day of monthDates(periodOf(a.from)).filter(d=>d>=a.from&&d<=a.to)){
   if(day>today&&!['paid_leave','unpaid_leave','off','clear'].includes(a.status))throw new Error('Actual attendance cannot be dated in the future')
   const prior=hr.attendance.find(x=>x.employeeId===e.id&&x.date===day)
   if(a.status==='clear'){hr.attendance=hr.attendance.filter(x=>x.id!==prior?.id);continue}
   const row=attendanceSchema.parse({id:prior?.id??crypto.randomUUID(),employeeId:e.id,date:day,status:a.status,note:a.note});if(prior)Object.assign(prior,row);else hr.attendance.push(row)
  }
  hr.changes.unshift({id:a.id,employeeId:e.id,from:a.from,to:a.to,note:a.note,at:new Date().toISOString(),actorName,before,after:structuredClone(hr.attendance.filter(x=>x.employeeId===e.id&&x.date>=a.from&&x.date<=a.to))})
 }else if(command.type==='approvePayroll'){
  const raw=command.payload,e=findEmployee(raw.employeeId),p=payrollInputSchema.parse(raw)
  if(p.month>periodOf(today)||locked(e.id,p.month))throw new Error('Choose a current or past month without approved payroll')
  const calculation=calculatePayroll(hr,e,p)
  if(JSON.stringify(calculation)!==JSON.stringify(raw.expected))throw new Error('The calculation changed. Refresh and review before approval.')
  hr.payrolls.push({...p,branchId:e.branchId,employeeName:e.name,joined:e.joined,payType:e.payType,rate:e.rate,employeeRate:e.employeeRate,employerRate:e.employerRate,etfRate:e.etfRate,epfEnabled:e.epfEnabled,etfEnabled:e.etfEnabled,calculation,status:'approved',approvedAt:new Date().toISOString(),voidReason:'',attendance:structuredClone(hr.attendance.filter(a=>a.employeeId===e.id&&periodOf(a.date)===p.month))})
 }else if(command.type==='voidPayroll'){
  const run=hr.payrolls.find(x=>x.id===p.id);if(!run||run.status==='void')throw new Error('Approved payroll not found')
  if(hr.payments.some(x=>x.payrollId===run.id))throw new Error('Paid payroll cannot be voided; record corrections in the next payroll')
  if(!command.payload.reason.trim())throw new Error('Enter a reason for voiding payroll')
  run.status='void';run.voidReason=command.payload.reason.trim()
 }else if(command.type==='payPayroll'||command.type==='addAdvance'){
  const raw=command.payload;date.parse(raw.date);if(raw.date>today)throw new Error('Payments cannot be dated in the future')
  cents.positive().parse(raw.amount);if(raw.note.length>500)throw new Error('Keep the note under 500 characters')
  const account=next.accounts.find(a=>a.id===raw.accountId);if(!account)throw new Error('Account not found')
  let branchId:string,description:string
  if(command.type==='payPayroll'){
   const a=command.payload,run=hr.payrolls.find(x=>x.id===a.payrollId&&x.status==='approved');if(!run)throw new Error('Approved payroll not found')
   if(a.date<run.joined||a.date<run.month||a.amount>paymentDue(hr,run,a.kind))throw new Error('Payment must fit the outstanding amount and pay period')
   branchId=run.branchId;description=`${a.kind==='salary'?'Staff pay':a.kind==='epf'?'EPF contribution':'ETF contribution'} - ${run.month.slice(0,7)}`
   hr.payments.push({...a,transactionId:a.id})
  }else{
   const a=command.payload,e=findEmployee(a.employeeId);if(!e.active||a.date<e.joined)throw new Error('Choose an active employee and a date on or after joining')
   branchId=e.branchId;description='Staff salary advance';hr.advances.push({...a,branchId,transactionId:a.id})
  }
  if(account.branchId!==branchId)throw new Error('Choose an account in the employee’s location')
  write({type:'addTransaction',payload:{id:raw.id,branchId,accountId:raw.accountId,amount:raw.amount,type:'expense',date:raw.date,category:command.type==='addAdvance'?'Staff advance':command.payload.kind==='salary'?'Staff pay':'EPF / ETF',description,method:account.type==='bank'?'transfer':'cash',supplierId:null,chequeId:null}})
 }
}
