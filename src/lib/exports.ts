import { cashbookRows, dailyCashRows, formatMoney, isOperating, type Snapshot } from './domain'
export function saveFile(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export async function exportCafeWorkbook(data:Snapshot,from:string,to:string){
  const {Workbook}=await import('exceljs'),book=new Workbook();book.creator='B&B CashDesk';book.created=new Date()
  const add=(title:string,headers:string[],rows:(string|number|null)[][])=>{
    const sheet=book.addWorksheet(title);sheet.addRow(headers);rows.forEach(row=>sheet.addRow(row));sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244C40'}};sheet.columns.forEach((col,i)=>{col.width=i===0?16:24});sheet.views=[{state:'frozen',ySplit:1}]
  }
  add('Daily cash',['Date','Opening LKR','Cash income LKR','Cash expenses LKR','To bank LKR','To safe LKR','Expected closing LKR','Counted closing LKR','Difference LKR'],dailyCashRows(data,from,to).map(d=>[d.date,d.opening/100,d.income/100,d.expenses/100,d.bankDeposits/100,d.safeDeposits/100,d.expected/100,d.closing===null?null:d.closing/100,d.variance===null?null:d.variance/100]))
  add('Cashbook',['Date','Description','Type','Account','Amount LKR'],cashbookRows(data).filter(t=>t.date>=from&&t.date<=to).map(t=>[t.date,t.description,t.transferId?'Transfer':t.cashDayId?'Cash count':t.type,data.accounts.find(a=>a.id===t.accountId)?.name??'',t.amount/100]))
  add('Bank and safe',['Date','From','To','Note','Amount LKR'],data.transfers.filter(t=>t.date>=from&&t.date<=to).map(t=>[t.date,data.accounts.find(a=>a.id===t.fromAccountId)?.name??'',data.accounts.find(a=>a.id===t.toAccountId)?.name??'',t.description,t.amount/100]))
  add('Cheques',['Number','Payee or payer','Type','Due date','Status','Amount LKR'],data.cheques.filter(c=>c.dueDate>=from&&c.dueDate<=to).map(c=>[c.number,c.payee,c.type,c.dueDate,c.status,c.amount/100]))
  const buffer=await book.xlsx.writeBuffer();saveFile(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`cafe-report-${from}-${to}.xlsx`)
}
export async function exportCafePdf(data:Snapshot,from:string,to:string){
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF();let y=20
  const line=(text:string,bold=false)=>{const lines=pdf.splitTextToSize(text,178);if(y+lines.length*5>277){pdf.addPage();y=20}pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(bold?12:10);pdf.text(lines,16,y);y+=lines.length*5+4}
  const items=data.transactions.filter(t=>t.date>=from&&t.date<=to&&isOperating(t)),income=items.filter(t=>t.type==='income').reduce((n,t)=>n+t.amount,0),expense=items.filter(t=>t.type==='expense').reduce((n,t)=>n+t.amount,0)
  line('Books & Buns | Cafe cashbook',true);line(`${from} to ${to} | All amounts in LKR`);line(`Income ${formatMoney(income)} | Expenses ${formatMoney(expense)} | Net ${formatMoney(income-expense)}`)
  line('Daily opening and closing cash',true)
  for(const d of dailyCashRows(data,from,to))line(`${d.date} | Opening ${formatMoney(d.opening)} | Cash in ${formatMoney(d.income)} | Cash out ${formatMoney(d.expenses)} | To bank ${formatMoney(d.bankDeposits)} | To safe ${formatMoney(d.safeDeposits)} | Expected closing ${formatMoney(d.expected)} | Counted closing ${d.closing===null?'Open':formatMoney(d.closing)} | Difference ${d.variance===null?'--':formatMoney(d.variance)}`)
  line('Bank deposits and safe transfers',true)
  for(const t of data.transfers.filter(t=>t.date>=from&&t.date<=to))line(`${t.date} | ${data.accounts.find(a=>a.id===t.fromAccountId)?.name} to ${data.accounts.find(a=>a.id===t.toAccountId)?.name} | ${formatMoney(t.amount)} | ${t.description}`)
  line('Cheques due in this period',true)
  for(const c of data.cheques.filter(c=>c.dueDate>=from&&c.dueDate<=to))line(`#${c.number} | ${c.payee} | ${c.type} | Due ${c.dueDate} | ${c.status} | ${formatMoney(c.amount)}`)
  line('Cashbook entries',true)
  for(const t of cashbookRows(data).filter(t=>t.date>=from&&t.date<=to))line(`${t.date} | ${t.transferId?'Transfer':t.cashDayId?'Cash count':t.type} | ${t.description} | ${formatMoney(t.amount)}`)
  for(let p=1;p<=pdf.getNumberOfPages();p++){pdf.setPage(p);pdf.setFontSize(8);pdf.text(`Transfers and cash count adjustments are excluded from sales and expenses. | Page ${p}`,16,289)}
  pdf.save(`cafe-report-${from}-${to}.pdf`)
}
