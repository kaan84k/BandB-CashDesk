import { z } from 'zod'

export const roles = ['owner', 'manager', 'staff'] as const
export const chequeStatuses = ['issued', 'received', 'presented', 'cleared', 'returned', 'cancelled'] as const
export const categories = ['Cafe sales', 'Bakery sales', 'Packed cookies', 'Other income', 'Ingredients', 'Packaging', 'Salaries', 'Utilities', 'Rent', 'Transport', 'Other expense'] as const
const id = z.string().uuid()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Enter a valid date')
const money = z.number().int().nonnegative().max(999_999_999_999)
const positiveMoney = money.positive('Amount must be greater than zero')
const name = z.string().trim().min(1).max(160)
export const accountSchema = z.object({ id, branchId: id, name, type: z.enum(['bank', 'cash', 'petty']), openingBalance: z.number().int().min(-999_999_999_999).max(999_999_999_999), bank: z.string().max(160).default('') }).refine(a=>a.type!=='bank'||a.bank.trim().length>0,{message:'Bank name is required',path:['bank']})
export const transactionSchema = z.object({ id, branchId: id, accountId: id, type: z.enum(['income', 'expense']), amount: positiveMoney, category: name, description: name, date, supplierId: id.nullable(), chequeId: id.nullable(), method: z.enum(['cash', 'card', 'transfer', 'cheque']) })
export const chequeSchema = z.object({ id, branchId: id, accountId: id, number: z.string().trim().regex(/^[A-Za-z0-9-]{1,30}$/, 'Use letters, numbers or hyphens'), type: z.enum(['issued', 'received']), payee: name, supplierId: id.nullable(), bank: name, amount: positiveMoney, issueDate: date, dueDate: date, status: z.enum(chequeStatuses), notes: z.string().max(1000).default('') }).refine(c => c.dueDate >= c.issueDate, { message: 'Due date must be on or after issue date', path: ['dueDate'] }).refine(c=>!['issued','received'].includes(c.status)||c.status===c.type,{message:'Status does not match cheque direction',path:['status']}).refine(c=>c.type==='issued'||c.supplierId===null,{message:'Received cheques cannot pay a supplier',path:['supplierId']})
export const supplierSchema = z.object({ id, branchId: id, name, contact: z.string().max(160), phone: z.string().max(40), email: z.union([z.literal(''), z.email()]), terms: z.number().int().min(0).max(365) })
export const invoiceSchema = z.object({ id, branchId: id, supplierId: id, reference: name, amount: positiveMoney, date, dueDate: date }).refine(i => i.dueDate >= i.date, {message: 'Due date must follow invoice date', path:['dueDate']})
export const snapshotSchema = z.object({
  version: z.literal(1),
  branches: z.array(z.object({ id, name, location: z.string() })).min(1),
  accounts: z.array(accountSchema), transactions: z.array(transactionSchema), cheques: z.array(chequeSchema),
  suppliers: z.array(supplierSchema), invoices: z.array(invoiceSchema),
  members: z.array(z.object({ id, name, email: z.email(), role: z.enum(roles) })),
  audit: z.array(z.object({ id, action: z.string(), entityId: id, at: z.iso.datetime(), actor: z.string() })),
})
export type Snapshot = z.infer<typeof snapshotSchema>
export type Account = z.infer<typeof accountSchema>
export type Transaction = z.infer<typeof transactionSchema>
export type Cheque = z.infer<typeof chequeSchema>
export type Supplier = z.infer<typeof supplierSchema>
export type Invoice = z.infer<typeof invoiceSchema>
export type Role = typeof roles[number]
export type ChequeStatus = typeof chequeStatuses[number]
export type Command =
  | { type: 'addTransaction'; payload: Transaction }
  | { type: 'addCheque'; payload: Cheque }
  | { type: 'setChequeStatus'; payload: { id: string; status: ChequeStatus; date: string } }
  | { type: 'addAccount'; payload: Account }
  | { type: 'addSupplier'; payload: Supplier }
  | { type: 'addInvoice'; payload: Invoice }
  | { type: 'setMemberRole'; payload: { id: string; role: Role } }

export function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)!.value).join('-')
}
export function addDays(value: string, days: number) { const d = new Date(value + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10) }
export function daysUntil(value: string, reference = today()) { return Math.round((Date.parse(value) - Date.parse(reference)) / 86400000) }
export function formatDate(value: string, options: Intl.DateTimeFormatOptions = { day:'numeric', month:'short' }) { const d=new Date(value+'T00:00:00+05:30');return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('en-GB', { ...options, timeZone:'Asia/Colombo' }).format(d) }
export function formatMoney(cents: number, compact = false) { return new Intl.NumberFormat('en-LK', { maximumFractionDigits: compact ? 1 : 2, minimumFractionDigits: 0, ...(compact ? { notation: 'compact' as const } : {}) }).format(cents / 100) }
export function parseMoney(value: string, allowZero = false) {
  const clean = value.trim().replaceAll(',', '')
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(clean)) throw new Error('Enter a positive amount with up to two decimal places')
  const [whole, fraction = ''] = clean.split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return (allowZero?money:positiveMoney).parse(amount)
}
export function balance(account: Account, transactions: Transaction[]) { return account.openingBalance + transactions.filter(t => t.accountId === account.id).reduce((n,t) => n + (t.type === 'income' ? t.amount : -t.amount), 0) }
export function isPending(c: Cheque) { return ['issued','received','presented'].includes(c.status) }
export function supplierBalance(s: Supplier, data: Snapshot) { return data.invoices.filter(i => i.supplierId === s.id).reduce((n,i) => n+i.amount,0) - data.transactions.filter(t => t.supplierId === s.id && t.type === 'expense').reduce((n,t) => n+t.amount,0) }
export function allowedStatuses(c: Cheque): ChequeStatus[] {
  if (['cleared','cancelled'].includes(c.status)) return []
  if (c.status === 'returned') return ['presented','cancelled']
  if (c.status === 'presented') return ['cleared','returned','cancelled']
  return ['presented','cleared','returned','cancelled']
}
export function reminders(data: Snapshot, reference = today()) {
  return data.cheques.filter(c => c.status === 'returned' || (isPending(c) && daysUntil(c.dueDate, reference) <= 7)).sort((a,b) => (a.status === 'returned' ? -999 : daysUntil(a.dueDate,reference)) - (b.status === 'returned' ? -999 : daysUntil(b.dueDate,reference)))
}
export function chequeForecast(data:Snapshot, reference=today(), days=30) {
  let running=data.accounts.reduce((n,a)=>n+balance(a,data.transactions),0)
  const pending=data.cheques.filter(isPending)
  return Array.from({length:days+1},(_,i)=>{
    const date=addDays(reference,i)
    const movements=pending.filter(c=>i===0?c.dueDate<=date:c.dueDate===date)
    running+=movements.reduce((n,c)=>n+(c.type==='received'?c.amount:-c.amount),0)
    return {date,balance:running}
  })
}
export function validateSnapshot(input: unknown): Snapshot {
  const s = snapshotSchema.parse(input)
  const unique = (items: {id:string}[]) => new Set(items.map(i=>i.id)).size === items.length
  for (const items of [s.accounts,s.transactions,s.cheques,s.suppliers,s.invoices,s.branches,s.members,s.audit]) if (!unique(items)) throw new Error('Duplicate record IDs in backup')
  const branchExists = (bid: string) => s.branches.some(b => b.id === bid)
  for (const item of [...s.accounts,...s.transactions,...s.cheques,...s.suppliers,...s.invoices]) if (!branchExists(item.branchId)) throw new Error('Unknown branch')
  for (const t of [...s.transactions,...s.cheques]) {
    if (!s.accounts.some(a=>a.id===t.accountId && a.branchId===t.branchId)) throw new Error('Account must belong to the selected branch')
    if (t.supplierId && !s.suppliers.some(p=>p.id===t.supplierId && p.branchId===t.branchId)) throw new Error('Supplier must belong to the selected branch')
  }
  for (const i of s.invoices) if (!s.suppliers.some(p=>p.id===i.supplierId && p.branchId===i.branchId)) throw new Error('Invalid invoice supplier')
  const invoiceKeys=s.invoices.map(i=>`${i.supplierId}:${i.reference}`)
  if(new Set(invoiceKeys).size!==invoiceKeys.length)throw new Error('This invoice reference already exists for the supplier')
  for(const t of s.transactions){if(t.date>today())throw new Error('Actual movements cannot be dated in the future');if(t.supplierId&&t.type!=='expense')throw new Error('Supplier payments must be expenses')}
  const chequeKeys = s.cheques.map(c=>`${c.accountId}:${c.type}:${c.number.toLowerCase()}`)
  if (new Set(chequeKeys).size !== chequeKeys.length) throw new Error('This cheque number already exists for the account and direction')
  for (const c of s.cheques) {
    if (s.accounts.find(a=>a.id===c.accountId)?.type !== 'bank') throw new Error('Cheques require a bank account')
    const movements = s.transactions.filter(t=>t.chequeId===c.id)
    if (c.status==='cleared' && (movements.length!==1 || movements[0].amount!==c.amount || movements[0].accountId!==c.accountId || movements[0].type!==(c.type==='issued'?'expense':'income') || movements[0].supplierId!==c.supplierId || movements[0].method!=='cheque')) throw new Error('Cleared cheque must have exactly one matching movement')
    if (c.status==='cleared' && movements[0].date<c.issueDate) throw new Error('Cheque cannot clear before its issue date')
    if (c.status!=='cleared' && movements.length) throw new Error('Uncleared cheque cannot move funds')
  }
  for (const t of s.transactions) if ((t.chequeId && !s.cheques.some(c=>c.id===t.chequeId)) || (t.method==='cheque' && !t.chequeId)) throw new Error('Invalid cheque movement')
  return s
}
export function applyCommand(data: Snapshot, command: Command, actor: {id:string; role:Role; name:string}): Snapshot {
  if (command.type === 'setMemberRole' && actor.role !== 'owner') throw new Error('Only the owner can manage team roles')
  if (['setChequeStatus','addAccount'].includes(command.type) && actor.role === 'staff') throw new Error('A manager or owner must approve this change')
  const next = structuredClone(data)
  const p = command.payload
  if (command.type === 'addTransaction') {
    const t = transactionSchema.parse(command.payload)
    if (t.chequeId || t.method==='cheque') throw new Error('Record cheque movements through cheque clearance')
    if (t.date > today()) throw new Error('Actual movements cannot be dated in the future')
    next.transactions.unshift(t)
  } else if (command.type === 'addCheque') {
    const c = chequeSchema.parse(command.payload)
    if (c.status !== c.type) throw new Error('New cheques must start as issued or received')
    next.cheques.unshift(c)
  } else if (command.type === 'setChequeStatus') {
    const c = next.cheques.find(c=>c.id===command.payload.id)
    if (!c) throw new Error('Cheque not found')
    if (!allowedStatuses(c).includes(command.payload.status)) throw new Error('This cheque status cannot be changed in that way')
    const clearedDate = date.parse(command.payload.date)
    if (command.payload.status==='cleared' && (clearedDate < c.issueDate || clearedDate > today())) throw new Error('Clearance date must be between issue date and today')
    c.status=command.payload.status
    if (c.status==='cleared') next.transactions.unshift({ id:crypto.randomUUID(), branchId:c.branchId, accountId:c.accountId, type:c.type==='issued'?'expense':'income', amount:c.amount, category:'Cheque settlement', description:`Cheque #${c.number} · ${c.payee}`.slice(0,160), date:clearedDate, supplierId:c.supplierId, chequeId:c.id, method:'cheque' })
  } else if (command.type === 'addAccount') next.accounts.push(accountSchema.parse(command.payload))
  else if (command.type === 'addSupplier') next.suppliers.push(supplierSchema.parse(command.payload))
  else if (command.type === 'addInvoice') next.invoices.unshift(invoiceSchema.parse(command.payload))
  else if (command.type === 'setMemberRole') {
    const member = next.members.find(m=>m.id===command.payload.id)
    if (!member) throw new Error('Team member not found')
    if (member.role==='owner' && command.payload.role!=='owner' && next.members.filter(m=>m.role==='owner').length===1) throw new Error('Keep at least one owner')
    member.role = z.enum(roles).parse(command.payload.role)
  }
  next.audit.unshift({ id:crypto.randomUUID(), action:command.type, entityId:p.id, at:new Date().toISOString(), actor:actor.name })
  return validateSnapshot(next)
}
