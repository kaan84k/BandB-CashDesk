import { cashbookRows, dailyCashRows, type Snapshot } from './domain'
export function saveFile(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export async function exportCafeWorkbook(data:Snapshot,from:string,to:string){
  const {Workbook}=await import('exceljs'),book=new Workbook();book.creator='Cashflow';book.created=new Date()
  const add=(title:string,headers:string[],rows:(string|number|null)[][])=>{
    const sheet=book.addWorksheet(title);sheet.addRow(headers);rows.forEach(row=>sheet.addRow(row));sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244C40'}};sheet.columns.forEach((col,i)=>{col.width=i===0?16:24});sheet.views=[{state:'frozen',ySplit:1}]
  }
  add('Daily cash',['Date','Opening LKR','Cash income LKR','Cash expenses LKR','To bank LKR','To safe LKR','Expected closing LKR','Counted closing LKR','Difference LKR'],dailyCashRows(data,from,to).map(d=>[d.date,d.opening/100,d.income/100,d.expenses/100,d.bankDeposits/100,d.safeDeposits/100,d.expected/100,d.closing===null?null:d.closing/100,d.variance===null?null:d.variance/100]))
  add('Cashbook',['Date','Description','Type','Account','Amount LKR'],cashbookRows(data).filter(t=>t.date>=from&&t.date<=to).map(t=>[t.date,t.description,t.transferId?'Transfer':t.cashDayId?'Cash count':t.type,data.accounts.find(a=>a.id===t.accountId)?.name??'',t.amount/100]))
  add('Bank and safe',['Date','From','To','Note','Amount LKR'],data.transfers.filter(t=>t.date>=from&&t.date<=to).map(t=>[t.date,data.accounts.find(a=>a.id===t.fromAccountId)?.name??'',data.accounts.find(a=>a.id===t.toAccountId)?.name??'',t.description,t.amount/100]))
  add('Cheques',['Number','Payee or payer','Type','Due date','Status','Amount LKR'],data.cheques.filter(c=>c.dueDate>=from&&c.dueDate<=to).map(c=>[c.number,c.payee,c.type,c.dueDate,c.status,c.amount/100]))
  const buffer=await book.xlsx.writeBuffer();saveFile(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`cashflow-report-${from}-${to}.xlsx`)
}
export async function exportCafePdf(data:Snapshot,from:string,to:string){
  const {createCafePdf}=await import('./pdfReport')
  createCafePdf(data,from,to).save(`cashflow-report-${from}-${to}.pdf`)
}
