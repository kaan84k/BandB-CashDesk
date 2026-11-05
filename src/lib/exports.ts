import { formatMoney, type Snapshot, type Transaction } from './domain'

export function saveFile(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export async function exportWorkbook(data:Snapshot,transactions:Transaction[],name='cashdesk-ledger'){
  const {Workbook}=await import('exceljs')
  const book=new Workbook();book.creator='B&B CashDesk';book.created=new Date()
  const sheet=book.addWorksheet('Cash flow')
  sheet.columns=[{header:'Date',key:'date',width:15},{header:'Description',key:'description',width:45},{header:'Type',key:'type',width:14},{header:'Category',key:'category',width:24},{header:'Account',key:'account',width:27},{header:'Method',key:'method',width:15},{header:'Income (LKR)',key:'income',width:20},{header:'Expense (LKR)',key:'expense',width:20}]
  for(const t of transactions)sheet.addRow({date:t.date,description:t.description,type:t.type,category:t.category,account:data.accounts.find(a=>a.id===t.accountId)?.name,method:t.method,income:t.type==='income'?t.amount/100:null,expense:t.type==='expense'?t.amount/100:null})
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244C40'}}
  sheet.getColumn('income').numFmt='#,##0.00';sheet.getColumn('expense').numFmt='#,##0.00';sheet.views=[{state:'frozen',ySplit:1}]
  const buffer=await book.xlsx.writeBuffer();saveFile(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`${name}.xlsx`)
}
export async function exportPdf(data:Snapshot,transactions:Transaction[],from:string,to:string){
  const {jsPDF}=await import('jspdf');const pdf=new jsPDF()
  pdf.setTextColor('#244c40');pdf.setFontSize(22);pdf.text('Books & Buns | CashDesk',16,22);pdf.setFontSize(10);pdf.text(`Cash flow report: ${from} to ${to} | LKR`,16,31)
  const income=transactions.filter(t=>t.type==='income').reduce((n,t)=>n+t.amount,0),expense=transactions.filter(t=>t.type==='expense').reduce((n,t)=>n+t.amount,0)
  pdf.text(`Income: Rs. ${formatMoney(income)}    Expenses: Rs. ${formatMoney(expense)}`,16,42);pdf.text(`Net cash flow: Rs. ${formatMoney(income-expense)}`,16,49)
  let y=62
  for(const t of transactions){const lines=pdf.splitTextToSize(`${t.date}  ${t.type==='income'?'+':'-'} Rs. ${formatMoney(t.amount)}  |  ${t.description}  |  ${data.accounts.find(a=>a.id===t.accountId)?.name??''}`,178);if(y+lines.length*5>277){pdf.addPage();y=20}pdf.setTextColor('#404c43');pdf.text(lines,16,y);y+=lines.length*5+5}
  const pages=pdf.getNumberOfPages();for(let p=1;p<=pages;p++){pdf.setPage(p);pdf.setFontSize(8);pdf.setTextColor('#7a827b');pdf.text(`Actual recorded movements. Uncleared cheques excluded. | Page ${p} of ${pages}`,16,289)}
  pdf.save(`cashdesk-report-${from}-${to}.pdf`)
}
