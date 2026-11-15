import { jsPDF } from 'jspdf'
import { autoTable, type RowInput } from 'jspdf-autotable'
import regular from '../assets/fonts/Poppins-Regular.ttf?inline'
import semibold from '../assets/fonts/Poppins-SemiBold.ttf?inline'
import type { Snapshot } from './domain'
import { formatDate } from './domain'
import { attendanceLabels, monthEnd, paymentDue, type Payroll } from './employment'
const money=(n:number)=>new Intl.NumberFormat('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100)
export function createEmploymentPdf(data:Snapshot,month:string,payroll?:Payroll){
 const hr=data.employment,pdf=new jsPDF({orientation:payroll?'portrait':'landscape',format:'a4',putOnlyUsedFonts:true})
 pdf.addFileToVFS('Poppins-Regular.ttf',regular.split(',')[1]);pdf.addFileToVFS('Poppins-SemiBold.ttf',semibold.split(',')[1]);pdf.addFont('Poppins-Regular.ttf','Poppins','normal');pdf.addFont('Poppins-SemiBold.ttf','Poppins','bold')
 const width=pdf.internal.pageSize.getWidth(),height=pdf.internal.pageSize.getHeight(),margin=14,period=formatDate(month,{month:'long',year:'numeric'})
 pdf.setProperties({title:payroll?`Salary slip - ${payroll.employeeName} - ${period}`:`Employees and salary - ${period}`,author:'Cashflow',creator:'Cashflow'})
 pdf.setFont('Poppins','bold').setFontSize(20).setTextColor('#17233d').text(payroll?(payroll.status==='void'?'Voided salary slip':'Salary slip'):'Employees & salary report',margin,32)
 pdf.setFont('Poppins','normal').setFontSize(10).setTextColor('#64748b')
 const business=pdf.splitTextToSize(`${data.companyName??data.branches[0].name} | ${period}${payroll?' | '+payroll.employeeName:''}`,width-margin*2)
 pdf.text(business,margin,41);let y=46+business.length*4
 const table=(title:string,headers:string[],rows:RowInput[],amountColumns:number[]=[])=>{
  if(y+35>height-23){pdf.addPage();y=32}
  const gap=10,startY=y+gap
  const widths=headers.length===8?[52,31,31,31,31,31,31,31]:headers.length===7?[65,34,34,34,34,34,34]:headers.length===3?[27,44,width-margin*2-71]:headers.length===2?[width-margin*2-58,58]:undefined
  autoTable(pdf,{columnStyles:widths?Object.fromEntries(widths.map((cellWidth,i)=>[i,{cellWidth}])):{},startY,margin:{top:39,bottom:23,left:margin,right:margin},theme:'grid',head:[headers],body:rows.length?rows:[[{content:'No records for this period.',colSpan:headers.length}]],showHead:'everyPage',rowPageBreak:'avoid',pageBreak:rows.length<=6?'avoid':'auto',styles:{font:'Poppins',fontSize:9,cellPadding:2.6,minCellHeight:9,lineColor:'#d8e1ee',lineWidth:.15,textColor:'#253c5d',overflow:'linebreak'},headStyles:{fillColor:'#17233d',fontStyle:'bold',textColor:'#ffffff',fontSize:8.5},alternateRowStyles:{fillColor:'#f5f7fc'},didParseCell:cell=>{if(amountColumns.includes(cell.column.index)&&cell.cell.colSpan===1){cell.cell.styles.halign='right';const value=cell.cell.text.join(' ');if(cell.section!=='head'&&/^-?[\d,]+\.\d{2}$/.test(value)&&widths){pdf.setFont('Poppins','normal').setFontSize(9);const available=widths[cell.column.index]-5.2;if(pdf.getTextWidth(value)>available)cell.cell.styles.fontSize=9*available/pdf.getTextWidth(value)}}},willDrawPage:({cursor,pageNumber})=>{pdf.setFont('Poppins','bold').setFontSize(12).setTextColor('#17233d');pdf.text(title+(pageNumber>1?' (continued)':''),margin,(cursor?.y??startY)-gap+3)},didDrawPage:({cursor})=>{if(cursor)y=cursor.y+12}})
 }
 if(payroll){
  const p=payroll,c=p.calculation
  table('Earnings and deductions',['Item','LKR'],[['Pay basis',p.payType==='monthly'?`Monthly / ${p.workingDays} working days`:'Daily wage'],['Basic for period',money(c.basic)],['Unpaid absence deduction','-'+money(c.absence)],['Allowances',money(p.allowance)],['Gross salary',money(c.gross)],['EPF / ETF eligible earnings',money(c.eligible)],[`Employee EPF (${p.epfEnabled?p.employeeRate/100:0}%)`,'-'+money(c.employeeEpf)],['Advance deduction','-'+money(c.advance)],['Other deductions','-'+money(c.other)],['Take-home salary',money(c.net)],['Salary paid to date',money(c.net-paymentDue(hr,p,'salary'))],['Salary remaining',p.status==='void'?'Voided':money(paymentDue(hr,p,'salary'))]],[1])
  table('Employer contributions',['Item','LKR'],[[`Employer EPF (${p.epfEnabled?p.employerRate/100:0}%)`,money(c.employerEpf)],[`Employer ETF (${p.etfEnabled?p.etfRate/100:0}%)`,money(c.etf)],['Total employer cost',money(c.cost)],['EPF remaining',p.status==='void'?'Voided':money(paymentDue(hr,p,'epf'))],['ETF remaining',p.status==='void'?'Voided':money(paymentDue(hr,p,'etf'))]],[1])
  table(`Attendance snapshot · ${p.status}`,['Date','Status','Note'],p.attendance.map(a=>[formatDate(a.date),attendanceLabels[a.status],a.note]))
  table('Payroll record',['Field','Value'],[['Approved',new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',day:'numeric',month:'short',year:'numeric'}).format(new Date(p.approvedAt))],['Paid / unpaid units',`${c.paidUnits} / ${c.unpaidUnits}`],['Scheduled days',String(p.scheduledDays)],['Payroll note',p.note||'—'],['Status',p.status==='void'?`Voided: ${p.voidReason}`:'Approved'],['Reference',p.id]])
 }else{
  const employees=hr.employees.filter(e=>e.joined<=monthEnd(month)),runs=hr.payrolls.filter(p=>p.month===month&&p.status==='approved')
  table('Monthly attendance',['Employee','Present','Half day','Paid leave','Unpaid leave','Absent','Rest day'],employees.map(e=>{const rows=hr.attendance.filter(a=>a.employeeId===e.id&&a.date.startsWith(month.slice(0,7)));return[e.name,...['present','half_day','paid_leave','unpaid_leave','absent','off'].map(s=>String(rows.filter(a=>a.status===s).length))]}))
  table('Approved salary summary · LKR',['Employee','Gross','Employee EPF','Advances','Other deductions','Take-home','Salary paid','Remaining'],runs.map(p=>[p.employeeName,money(p.calculation.gross),money(p.calculation.employeeEpf),money(p.calculation.advance),money(p.calculation.other),money(p.calculation.net),money(p.calculation.net-paymentDue(hr,p,'salary')),money(paymentDue(hr,p,'salary'))]),[1,2,3,4,5,6,7])
  table('EPF / ETF contribution summary · LKR',['Employee','Eligible earnings','Employee EPF','Employer EPF','EPF total','EPF remaining','ETF','ETF remaining'],runs.map(p=>[p.employeeName,money(p.calculation.eligible),money(p.calculation.employeeEpf),money(p.calculation.employerEpf),money(p.calculation.employeeEpf+p.calculation.employerEpf),money(paymentDue(hr,p,'epf')),money(p.calculation.etf),money(paymentDue(hr,p,'etf'))]),[1,2,3,4,5,6,7])
  const total=(field:'employeeEpf'|'employerEpf'|'etf'|'net'|'cost')=>runs.reduce((n,p)=>n+p.calculation[field],0)
  table('Monthly totals',['Item','LKR'],[['Take-home salaries',money(total('net'))],['Employee EPF',money(total('employeeEpf'))],['Employer EPF',money(total('employerEpf'))],['EPF payable',money(total('employeeEpf')+total('employerEpf'))],['Employer ETF',money(total('etf'))],['Total employer cost',money(total('cost'))]],[1])
 }
 for(let page=1;page<=pdf.getNumberOfPages();page++){
  pdf.setPage(page);pdf.setFont('Poppins','bold').setFontSize(11).setTextColor('#17233d').text('Cashflow',margin,14)
  pdf.setFont('Poppins','normal').setFontSize(8).setTextColor('#64748b').text('PRIVATE EMPLOYEE RECORDS | ALL AMOUNTS IN LKR',width-margin,14,{align:'right'})
  pdf.setDrawColor('#d8e1ee').line(margin,21,width-margin,21).line(margin,height-17,width-margin,height-17)
  const footer=pdf.splitTextToSize('Employer EPF and ETF are business costs, not employee salary deductions. Payments are recorded separately from approval.',width-margin*2-30)
  pdf.setFontSize(7).text(footer,margin,height-12);pdf.text(`Page ${page} of ${pdf.getNumberOfPages()}`,width-margin,height-9,{align:'right'})
 }
 return pdf
}
