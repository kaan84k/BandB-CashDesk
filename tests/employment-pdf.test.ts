import { it,expect } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createDemo,DEMO_USER } from '../src/lib/seed'
import { applyCommand,today } from '../src/lib/domain'
import { calculatePayroll } from '../src/lib/employment'
import { createEmploymentPdf } from '../src/lib/employmentPdf'
import { mkdirSync,writeFileSync } from 'node:fs'
function fixture(){
 let data=createDemo();const e={id:crypto.randomUUID(),branchId:data.branches[0].id,name:'Salary employee',phone:'',joined:'2026-01-01',active:true,payType:'monthly' as const,rate:5000000,allowance:0,workingDays:26,leaveAllowance:0,epfEnabled:true,etfEnabled:true,employeeRate:800,employerRate:1200,etfRate:300}
 data=applyCommand(data,{type:'saveEmployee',payload:e},DEMO_USER)
 const p={id:crypto.randomUUID(),employeeId:e.id,month:today().slice(0,7)+'-01',workingDays:26,scheduledDays:26,allowance:0,eligible:5000000,advance:0,other:0,note:'Reviewed attendance and eligible earnings'}
 data=applyCommand(data,{type:'approvePayroll',payload:{...p,expected:calculatePayroll(data.employment,e,p)}},DEMO_USER)
 return {data,payroll:data.employment.payrolls[0],month:p.month}
}
async function inspect(pdf:ReturnType<typeof createEmploymentPdf>){
 const doc=await getDocument({data:new Uint8Array(pdf.output('arraybuffer')),useSystemFonts:false,disableFontFace:true}).promise
 const text:string[]=[];let inBounds=true
 try{for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),viewport=page.getViewport({scale:1});for(const item of(await page.getTextContent()).items){if(!('str'in item)||!item.str.trim())continue;text.push(item.str);const[x,y]=item.transform.slice(4);if(x<39||x+item.width>viewport.width-39||y<12||y>viewport.height-20)inBounds=false}}return{text:text.join(' '),inBounds}}finally{await doc.destroy()}
}
it('exports a salary slip with the employee deduction and separate employer contributions',async()=>{
 const {data,payroll,month}=fixture(),pdf=createEmploymentPdf(data,month,payroll),result=await inspect(pdf)
 for(const expected of ['Salary slip','Salary employee','50,000.00','4,000.00','46,000.00','6,000.00','1,500.00','57,500.00','Employer contributions'])expect(result.text).toContain(expected)
 expect(result.inBounds).toBe(true);expect(pdf.output().includes('/FontFile2')).toBe(true)
 if(process.env.CASHDESK_PDF_REVIEW_DIR){mkdirSync(process.env.CASHDESK_PDF_REVIEW_DIR,{recursive:true});writeFileSync(process.env.CASHDESK_PDF_REVIEW_DIR+'/salary-slip.pdf',Buffer.from(pdf.output('arraybuffer')))}
})
it('exports monthly attendance, payroll and EPF/ETF summaries and marks voided salary slips',async()=>{
 const {data,payroll,month}=fixture(),pdf=createEmploymentPdf(data,month),result=await inspect(pdf)
 for(const expected of ['Monthly attendance','Approved salary summary','EPF / ETF contribution summary','Monthly totals','Salary employee','10,000.00'])expect(result.text).toContain(expected)
 expect(result.inBounds).toBe(true)
 const voided=createEmploymentPdf(data,month,{...payroll,status:'void',voidReason:'Correction'});expect((await inspect(voided)).text).toContain('Voided salary slip')
 if(process.env.CASHDESK_PDF_REVIEW_DIR)writeFileSync(process.env.CASHDESK_PDF_REVIEW_DIR+'/employment-report.pdf',Buffer.from(pdf.output('arraybuffer')))
})
