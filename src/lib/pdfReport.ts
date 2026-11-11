import { jsPDF } from 'jspdf'
import regularFont from '../assets/fonts/Poppins-Regular.ttf?inline'
import semiboldFont from '../assets/fonts/Poppins-SemiBold.ttf?inline'
import { autoTable, type RowInput } from 'jspdf-autotable'
import { cashbookRows, dailyCashRows, formatDate, isOperating, type Snapshot } from './domain'

const navy = '#17233d', indigo = '#4f46e5', muted = '#64748b', border = '#d8e1ee'
const money = (cents: number) => new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
const date = (value: string) => formatDate(value, { day: '2-digit', month: 'short', year: 'numeric' })
const sum = <T,>(rows: T[], amount: (row: T) => number) => rows.reduce((total, row) => total + amount(row), 0)
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

/** Build the document separately from downloading so its pages can be reviewed and verified. */
export function createCafePdf(data: Snapshot, from: string, to: string, generatedAt = new Date()) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('Choose a valid report date range')

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', putOnlyUsedFonts: true })
  pdf.addFileToVFS('Poppins-Regular.ttf', regularFont.split(',')[1])
  pdf.addFileToVFS('Poppins-SemiBold.ttf', semiboldFont.split(',')[1])
  pdf.addFont('Poppins-Regular.ttf', 'Poppins', 'normal')
  pdf.addFont('Poppins-SemiBold.ttf', 'Poppins', 'bold')
  pdf.setProperties({ title: `Business cashbook | ${from} to ${to}`, subject: 'Daily cash, bank and safe transfers, cheques and cashbook entries', author: 'Cashflow', creator: 'Cashflow' })
  const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight()
  const margin = 14, contentWidth = width - margin * 2, bottom = height - 22
  const period = `${date(from)} to ${date(to)}`
  const timestamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(generatedAt)
  const account = (id: string) => data.accounts.find(a => a.id === id)?.name ?? 'Account unavailable'
  const operating = data.transactions.filter(t => t.date >= from && t.date <= to && isOperating(t))
  const income = sum(operating.filter(t => t.type === 'income'), t => t.amount)
  const expenses = sum(operating.filter(t => t.type === 'expense'), t => t.amount)

  pdf.setFont('Poppins', 'bold').setFontSize(21).setTextColor(navy)
  pdf.text('Business cashbook report', margin, 32)
  pdf.setFont('Poppins', 'normal').setFontSize(10).setTextColor(muted)
  pdf.text(period, margin, 41)
  pdf.setFontSize(8.5).text(`Generated ${timestamp} | Sri Lanka time`, width - margin, 41, { align: 'right' })
  const branches = data.branches.filter(b => data.accounts.some(a => a.branchId === b.id))
  const cafe = (branches.length ? branches : data.branches).map(b => b.name).join(', ')
  pdf.setFontSize(9)
  const cafeLines: string[] = pdf.splitTextToSize(`Business: ${data.companyName || cafe || 'Business workspace'}`, contentWidth)
  pdf.text(cafeLines, margin, 47)
  const summaryTop = 49 + cafeLines.length * 4.3, cardWidth = (contentWidth - 12) / 3
  for (const [index, metric] of [{ title: 'OPERATING INCOME', amount: income }, { title: 'OPERATING EXPENSES', amount: expenses }, { title: 'NET CASH FLOW', amount: income - expenses }].entries()) {
    const x = margin + index * (cardWidth + 6)
    pdf.setFillColor('#f1f4fb').setDrawColor(border).setLineWidth(.2)
    pdf.roundedRect(x, summaryTop, cardWidth, 23, 2, 2, 'FD')
    pdf.setFont('Poppins', 'normal').setFontSize(8.5).setTextColor(muted).text(metric.title, x + 4, summaryTop + 6)
    pdf.setFont('Poppins', 'bold').setFontSize(17).setTextColor(metric.amount < 0 ? '#a53f51' : navy)
    const value = money(metric.amount), available = cardWidth - 8
    if (pdf.getTextWidth(value) > available) pdf.setFontSize(17 * available / pdf.getTextWidth(value))
    pdf.text(value, x + 4, summaryTop + 17)
  }
  let y = summaryTop + 36
  type Grid = { title: string; note: string; headers: string[]; widths: number[]; amounts: number[]; rows: RowInput[]; empty: string; foot?: RowInput[] }
  const grid = ({ title, note, headers, widths, amounts, rows, empty, foot }: Grid) => {
    const section = (at: number, continued = false) => {
      pdf.setFillColor(indigo).rect(margin, at - 4, 1.2, 5, 'F')
      pdf.setFont('Poppins', 'bold').setFontSize(12).setTextColor(navy)
      pdf.text(title, margin + 4, at)
      if (continued) pdf.setFont('Poppins', 'normal').setFontSize(8).setTextColor(muted).text('CONTINUED', width - margin, at, { align: 'right' })
    }
    pdf.setFont('Poppins', 'normal').setFontSize(8.5)
    const noteLines: string[] = pdf.splitTextToSize(note, contentWidth)
    const headingGap = 9 + noteLines.length * 3.4
    // Measure the first row so neither its heading nor its grid header is stranded.
    pdf.setFontSize(9.5)
    const firstRowHeight = Array.isArray(rows[0]) ? Math.max(9, ...rows[0].map((cell, i) => {
      const text = typeof cell === 'object' && cell !== null && 'content' in cell ? String(cell.content) : String(cell ?? '')
      return pdf.splitTextToSize(text, widths[i] - 5).length * 9.5 * 1.15 * 25.4 / 72 + 5
    })) : 14
    if (y + headingGap + 14 + firstRowHeight + (foot?.length ?? 0) * 10 > bottom) { pdf.addPage(); y = 32 }
    const startY = y + headingGap
    autoTable(pdf, {
      startY, margin: { top: 44, bottom: 22, left: margin, right: margin }, tableWidth: contentWidth,
      theme: 'grid', head: [headers], body: rows.length ? rows : [[{ content: empty, colSpan: headers.length, styles: { halign: 'left', textColor: muted, minCellHeight: 14 } }]],
      foot: rows.length ? foot : undefined, showHead: 'everyPage', showFoot: 'lastPage', rowPageBreak: 'avoid', pageBreak: rows.length <= 8 ? 'avoid' : 'auto',
      styles: { font: 'Poppins', fontSize: 9.5, cellPadding: 2.5, minCellHeight: 9, lineColor: border, lineWidth: .15, textColor: navy, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: navy, textColor: '#ffffff', fontStyle: 'bold', fontSize: 9, lineColor: '#34435d', minCellHeight: 12 },
      alternateRowStyles: { fillColor: '#f7f9fd' },
      footStyles: { fillColor: '#eaf0fa', textColor: navy, fontStyle: 'bold', lineColor: border, lineWidth: .2 },
      columnStyles: Object.fromEntries(widths.map((cellWidth, i) => [i, { cellWidth, halign: amounts.includes(i) ? 'right' : 'left' }])),
      didParseCell: cell => {
        if (!amounts.includes(cell.column.index) || cell.cell.colSpan > 1) return
        cell.cell.styles.halign = 'right'
        if (cell.section === 'head') return
        const value = cell.cell.text.join(' ')
        if (/^-?[\d,]+\.\d{2}$/.test(value)) {
          // Never truncate or split a financial amount, including large balances.
          pdf.setFont('Poppins', cell.cell.styles.fontStyle).setFontSize(cell.cell.styles.fontSize)
          const available = cell.cell.width || widths[cell.column.index]
          const textWidth = pdf.getTextWidth(value)
          if (textWidth > available - 5) cell.cell.styles.fontSize = cell.cell.styles.fontSize * (available - 5) / textWidth
          if (value.startsWith('-')) cell.cell.styles.textColor = '#a53f51'
        } else if (cell.section === 'body') cell.cell.styles.textColor = muted
      },
      willDrawPage: ({ pageNumber, cursor }) => {
        const headingY = (cursor?.y ?? startY) - headingGap
        section(headingY, pageNumber > 1)
        pdf.setFont('Poppins', 'normal').setFontSize(8.5).setTextColor(muted)
        pdf.text(noteLines, margin, headingY + 6)
      },
      didDrawPage: ({ cursor }) => { if (cursor) y = cursor.y + 8 },
    })
  }

  const days = dailyCashRows(data, from, to).reverse()
  grid({
    title: 'Daily opening and closing cash',
    note: 'Daily balances are not added together. The totals row includes cash movements only. Not counted means the day is still open.',
    headers: ['Date', 'Opening\ncash', 'Cash\nincome', 'Cash\nexpenses', 'To\nbank', 'To\nsafe', 'Expected\nclosing', 'Counted\nclosing', 'Closing\ndifference'],
    widths: [26, 30, 29, 29, 30, 30, 33, 33, 29], amounts: [1, 2, 3, 4, 5, 6, 7, 8],
    rows: days.map(d => [date(d.date), money(d.opening), money(d.income), money(d.expenses), money(d.bankDeposits), money(d.safeDeposits), money(d.expected), d.closing === null ? 'Not counted' : money(d.closing), d.variance === null ? '--' : money(d.variance)]),
    foot: [['Period total', '--', money(sum(days, d => d.income)), money(sum(days, d => d.expenses)), money(sum(days, d => d.bankDeposits)), money(sum(days, d => d.safeDeposits)), '--', '--', '--']],
    empty: 'No daily cash counts were recorded in this period.',
  })
  const transfers = data.transfers.filter(t => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date))
  grid({
    title: 'Bank deposits and safe transfers', note: 'Internal movements between accounts. These amounts are excluded from operating income and expenses.',
    headers: ['Date', 'From account', 'To account', 'Note', 'Amount'], widths: [26, 46, 46, 111, 40], amounts: [4],
    rows: transfers.map(t => [date(t.date), account(t.fromAccountId), account(t.toAccountId), t.description, money(t.amount)]),
    foot: [[{ content: 'Total moved between accounts', colSpan: 4 }, money(sum(transfers, t => t.amount))]],
    empty: 'No bank or safe transfers were recorded in this period.',
  })
  const cheques = data.cheques.filter(c => c.dueDate >= from && c.dueDate <= to).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  grid({
    title: 'Cheques due in this period', note: 'Selected by due date. Direction totals include all displayed statuses; they are not outstanding balances. Only clearance moves money.',
    headers: ['Cheque no.', 'Payee / payer', 'Bank', 'Direction', 'Due date', 'Status', 'Amount'], widths: [30, 65, 48, 25, 26, 36, 39], amounts: [6],
    rows: cheques.map(c => [c.number, c.payee, c.bank, label(c.type), date(c.dueDate), label(c.status), money(c.amount)]),
    foot: [
      [{ content: 'Issued cheques - all shown statuses', colSpan: 6 }, money(sum(cheques.filter(c => c.type === 'issued'), c => c.amount))],
      [{ content: 'Received cheques - all shown statuses', colSpan: 6 }, money(sum(cheques.filter(c => c.type === 'received'), c => c.amount))],
    ],
    empty: 'No cheques are due in this period.',
  })
  const entries = cashbookRows(data).filter(t => t.date >= from && t.date <= to).reverse()
  grid({
    title: 'Cashbook entries', note: 'In / out includes physical cash-count adjustments. Transfers appear once in Moved, separate from in / out. The summary includes operating entries only.',
    headers: ['Date', 'Entry type', 'Description', 'Account / route', 'In', 'Out', 'Moved'], widths: [26, 28, 80, 63, 24, 24, 24], amounts: [4, 5, 6],
    rows: entries.map(t => {
      const transfer = data.transfers.find(move => move.id === t.transferId)
      return [date(t.date), t.transferId ? 'Transfer' : t.cashDayId ? 'Cash count' : label(t.type), t.description,
        transfer ? `${account(transfer.fromAccountId)} to ${account(transfer.toAccountId)}` : account(t.accountId),
        !t.transferId && t.type === 'income' ? money(t.amount) : '--', !t.transferId && t.type === 'expense' ? money(t.amount) : '--', t.transferId ? money(t.amount) : '--']
    }),
    empty: 'No cashbook entries were recorded in this period.',
  })

  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page)
    pdf.setFont('Poppins', 'bold').setFontSize(12).setTextColor(navy).text('Cashflow', margin, 14)
    pdf.setFont('Poppins', 'normal').setFontSize(8.5).setTextColor(muted)
    pdf.text(page === 1 ? 'BUSINESS CASHBOOK / ALL AMOUNTS IN LKR' : `${period} | All amounts in LKR`, width - margin, 14, { align: 'right' })
    pdf.setDrawColor(border).setLineWidth(.2).line(margin, 21, width - margin, 21)
    pdf.line(margin, height - 16, width - margin, height - 16)
    pdf.setFontSize(8).setTextColor(muted)
    pdf.text('Transfers and cash-count adjustments are excluded from operating income and expenses.', margin, height - 11)
    pdf.text('Cashflow | Business financial records', margin, height - 6)
    pdf.text(`Page ${page} of ${pages}`, width - margin, height - 9, { align: 'right' })
  }
  return pdf
}
