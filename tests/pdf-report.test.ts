import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCafePdf } from '../src/lib/pdfReport'
import { createDemo } from '../src/lib/seed'
import type { Snapshot, Transaction } from '../src/lib/domain'

const day = '2026-11-11', generated = new Date('2026-11-11T06:00:00Z')
function fixture() {
  const base = createDemo(), branchId = base.branches[0].id
  const cash = base.accounts.find(a => a.type === 'cash')!, bank = base.accounts.find(a => a.type === 'bank')!
  const transferId = crypto.randomUUID(), dayId = crypto.randomUUID()
  const entry = (description: string, amount: number, type: 'income' | 'expense', extra: Partial<Transaction> = {}): Transaction => ({ id: crypto.randomUUID(), branchId, accountId: cash.id, date: day, description, category: 'Cafe sales', type, amount, method: 'cash', supplierId: null, chequeId: null, ...extra })
  const data: Snapshot = {
    ...base, suppliers: [], invoices: [], cheques: [], audit: [],
    cashDays: [{ id: dayId, branchId, accountId: cash.id, date: day, opening: 100000, openingLedger: 100000, expectedClosing: 102755, closing: 102655, notes: 'Physical cash count' }],
    transfers: [{ id: transferId, branchId, fromAccountId: cash.id, toAccountId: bank.id, date: day, amount: 5000, description: 'DEPOSIT-REFERENCE' }],
    transactions: [entry('Cafe income', 10055, 'income'), entry('Cafe expense', 2300, 'expense'), entry('Cash adjustment', 100, 'expense', { cashDayId: dayId, countKind: 'closing' }), entry('DEPOSIT-REFERENCE', 5000, 'expense', { transferId }), entry('DEPOSIT-REFERENCE', 5000, 'income', { transferId, accountId: bank.id })],
  }
  return { data, entry }
}
function saveReview(name: string, pdf: ReturnType<typeof createCafePdf>) {
  const directory = process.env.CASHDESK_PDF_REVIEW_DIR
  if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(`${directory}/${name}.pdf`, Buffer.from(pdf.output('arraybuffer'))) }
}
async function inspect(pdf: ReturnType<typeof createCafePdf>) {
  const document = await getDocument({ data: new Uint8Array(pdf.output('arraybuffer')), useSystemFonts: false, disableFontFace: true }).promise
  const text: string[] = []
  let inBounds = true
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), viewport = page.getViewport({ scale: 1 })
      for (const item of (await page.getTextContent()).items) {
        if (!('str' in item) || !item.str.trim()) continue
        text.push(item.str)
        const [x, y] = item.transform.slice(4)
        if (x < 39 || x + item.width > viewport.width - 39 || y < 12 || y > viewport.height - 20) inBounds = false
      }
    }
    return { text: text.join(' '), compact: text.join('').replace(/\s+/g, ''), inBounds }
  } finally { await document.destroy() }
}
describe('PDF cashbook reports', () => {
  it('exports all sections in landscape with exact operating totals, signed differences and no transfer duplication', async () => {
    const { data } = fixture(), pdf = createCafePdf(data, day, day, generated), output = (await inspect(pdf)).text
    expect(pdf.output().includes('/FontFile2')).toBe(true)
    expect(pdf.internal.pageSize.getWidth()).toBeGreaterThan(pdf.internal.pageSize.getHeight())
    for (const text of ['OPERATING INCOME', '100.55', 'OPERATING EXPENSES', '23.00', 'NET CASH FLOW', '77.55', '-1.00', '1,026.55', 'Daily opening and closing cash', 'Bank deposits and safe transfers', 'Cheques due in this period', 'Cashbook entries']) expect(output).toContain(text)
    expect(output.split('Daily opening')[0]).not.toContain('74.00') // Expenses must exclude the deposit and count adjustment.
    // One transfer in its register and once in the cashbook, never its receiving leg.
    expect(output.match(/DEPOSIT-REFERENCE/g)).toHaveLength(2)
    expect(output).toContain('Sri Lanka time')
    saveReview('daily', pdf)
  })
  it('keeps uncounted cash distinct from a real zero balance', async () => {
    const { data } = fixture(); data.cashDays[0].closing = null; data.cashDays[0].expectedClosing = null
    const pdf = createCafePdf(data, day, day, generated)
    const output = (await inspect(pdf)).text
    expect(output).toContain('Not counted')
    expect(output).toContain('0.00') // Zero cash movements remain real zeros; an open closing count is not zero.
    saveReview('open-day', pdf)
  })
  it('renders empty sections explicitly rather than omitting them or showing invalid values', async () => {
    const { data } = fixture(); data.transactions = []; data.transfers = []; data.cashDays = []; data.cheques = []
    const pdf = createCafePdf(data, day, day, generated), output = (await inspect(pdf)).text
    for (const text of ['No daily cash counts', 'No bank or safe transfers', 'No cheques are due', 'No cashbook entries']) expect(output).toContain(text)
    expect(output).not.toMatch(/NaN|undefined|Infinity/)
    saveReview('empty', pdf)
  })
  it('paginates long registers with repeated headings and complete page numbering', async () => {
    const { data, entry } = fixture()
    data.transactions = Array.from({ length: 120 }, (_, i) => entry(`ROW-${String(i).padStart(3, '0')} ${'Long supplier purchase description '.repeat(4)}`.slice(0, 160), 12345678901, 'expense'))
    data.accounts[0].name = 'Cafe bank account '.repeat(8)
    const pdf = createCafePdf(data, day, day, generated), parsed = await inspect(pdf), output = parsed.text, pages = pdf.getNumberOfPages()
    expect(pages).toBeGreaterThan(3)
    for (let i = 0; i < 120; i++) expect(output).toContain(`ROW-${String(i).padStart(3, '0')}`)
    expect(output.match(/Entry type/g)!.length).toBeGreaterThan(1)
    for (let page = 1; page <= pages; page++) expect(output).toContain(`Page ${page} of ${pages}`)
    expect(output).toContain('123,456,789.01')
    expect(parsed.inBounds).toBe(true)
    saveReview('long-register', pdf)
  })
  it('filters cheques by due date and separates issued and received totals', async () => {
    const { data } = fixture(), cheque = createDemo().cheques[0]
    data.cheques = [
      { ...cheque, id: crypto.randomUUID(), number: 'ISSUED-CHECK', dueDate: day, type: 'issued', status: 'issued', amount: 90000, payee: 'A supplier with a long business name '.repeat(4).slice(0, 145) + ' PAYEE-END' },
      { ...cheque, id: crypto.randomUUID(), number: 'RECEIVED-CHECK', dueDate: day, type: 'received', status: 'received', amount: 45678 },
      { ...cheque, id: crypto.randomUUID(), number: 'OUTSIDE-PERIOD', dueDate: '2027-01-01', amount: 99999 },
    ]
    const pdf = createCafePdf(data, day, day, generated), parsed = await inspect(pdf), output = parsed.text
    const visibleText = parsed.compact
    for (const value of ['ISSUED-CHECK', 'RECEIVED-CHECK', 'PAYEE-END', '900.00', '456.78', 'Issued cheques - all shown statuses', 'Received cheques - all shown statuses', '77.55']) expect(visibleText).toContain(value.replace(/\s+/g, ''))
    expect(output).not.toContain('OUTSIDE-PERIOD')
    saveReview('cheques', pdf)
  })
  it('rejects empty, impossible and reversed report ranges', () => {
    const { data } = fixture()
    for (const [from, to] of [['', day], ['2026-02-30', day], [day, '2026-11-10']]) expect(() => createCafePdf(data, from, to)).toThrow('valid report date range')
  })
})
