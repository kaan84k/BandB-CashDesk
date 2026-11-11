import { z } from 'zod'

export const roles = ['owner', 'manager', 'staff'] as const
export const chequeStatuses = ['issued', 'received', 'presented', 'cleared', 'returned', 'cancelled'] as const
export const categories = ['Sales', 'Other income', 'Supplier purchase', 'Rent', 'Electricity & water', 'Staff pay', 'Transport', 'Other expense'] as const
const id = z.string().uuid()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Enter a valid date')
const money = z.number().int().nonnegative().max(999_999_999_999)
const positiveMoney = money.positive('Amount must be greater than zero')
const name = z.string().trim().min(1).max(160)
export const accountSchema = z.object({ id, branchId: id, name, type: z.enum(['bank', 'cash', 'safe', 'petty']), openingBalance: z.number().int().min(-999_999_999_999).max(999_999_999_999), bank: z.string().max(160).default('') }).refine(a=>a.type!=='bank'||a.bank.trim().length>0,{message:'Bank name is required',path:['bank']})
export const transactionSchema = z.object({ id, branchId: id, accountId: id, type: z.enum(['income', 'expense']), amount: positiveMoney, category: name, description: name, date, supplierId: id.nullable(), chequeId: id.nullable(), method: z.enum(['cash', 'card', 'transfer', 'cheque']), transferId:id.nullish(), cashDayId:id.nullish(), countKind:z.enum(['opening','closing']).nullish() })
export const chequeSchema = z.object({ id, branchId: id, accountId: id, number: z.string().trim().regex(/^[A-Za-z0-9-]{1,30}$/, 'Use letters, numbers or hyphens'), type: z.enum(['issued', 'received']), payee: name, supplierId: id.nullable(), bank: name, amount: positiveMoney, issueDate: date, dueDate: date, status: z.enum(chequeStatuses), notes: z.string().max(1000).default('') }).refine(c => c.dueDate >= c.issueDate, { message: 'Due date must be on or after issue date', path: ['dueDate'] }).refine(c=>!['issued','received'].includes(c.status)||c.status===c.type,{message:'Status does not match cheque direction',path:['status']}).refine(c=>c.type==='issued'||c.supplierId===null,{message:'Received cheques cannot pay a supplier',path:['supplierId']})
export const supplierSchema = z.object({ id, branchId: id, name, contact: z.string().max(160), phone: z.string().max(40), email: z.union([z.literal(''), z.email()]), terms: z.number().int().min(0).max(365) })
export const invoiceSchema = z.object({ id, branchId: id, supplierId: id, reference: name, amount: positiveMoney, date, dueDate: date }).refine(i => i.dueDate >= i.date, {message: 'Due date must follow invoice date', path:['dueDate']})
export const transferSchema = z.object({id,branchId:id,fromAccountId:id,toAccountId:id,amount:positiveMoney,date,description:name}).refine(t=>t.fromAccountId!==t.toAccountId,{message:'Choose two different places for the money'})
export const cashDaySchema = z.object({id,branchId:id,accountId:id,date,opening:money,openingLedger:z.number().int(),closing:money.nullable(),expectedClosing:z.number().int().nullable(),notes:z.string().max(2000).default('')})
export const snapshotSchema = z.object({
  version: z.literal(1),
  companyName: name.optional(),
  branches: z.array(z.object({ id, name, location: z.string() })).min(1),
  accounts: z.array(accountSchema), transactions: z.array(transactionSchema), cheques: z.array(chequeSchema),
  suppliers: z.array(supplierSchema), invoices: z.array(invoiceSchema),
  transfers:z.array(transferSchema).default([]), cashDays:z.array(cashDaySchema).default([]),
  members: z.array(z.object({ id, name, email: z.email(), role: z.enum(roles) })),
  audit: z.array(z.object({ id, action: z.string(), entityId: id, at: z.iso.datetime(), actor: z.string() })),
})
export type Snapshot = z.infer<typeof snapshotSchema>
export type Transfer = z.infer<typeof transferSchema>
export type CashDay = z.infer<typeof cashDaySchema>
export type Account = z.infer<typeof accountSchema>
export type Transaction = z.infer<typeof transactionSchema>
export type Cheque = z.infer<typeof chequeSchema>
export type Supplier = z.infer<typeof supplierSchema>
export type Invoice = z.infer<typeof invoiceSchema>
export type Role = typeof roles[number]
export type ChequeStatus = typeof chequeStatuses[number]
export type Command = (
  | { type: 'addTransaction'; payload: Transaction }
  | { type: 'addCheque'; payload: Cheque }
  | { type: 'setChequeStatus'; payload: { id: string; status: ChequeStatus; date: string } }
  | { type: 'addAccount'; payload: Account }
  | { type:'transfer'; payload:Transfer }
  | { type:'openDay'; payload:{id:string;branchId:string;accountId:string;date:string;opening:number;notes:string} }
  | { type:'closeDay'; payload:{id:string;closing:number;notes:string} }
  | { type: 'addSupplier'; payload: Supplier }
  | { type: 'addInvoice'; payload: Invoice }
  | { type: 'removeMember'; payload: {id:string} }
  | { type: 'setMemberRole'; payload: { id: string; role: Role } }
) & { requestId?: string }

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
  for (const items of [s.accounts,s.transactions,s.cheques,s.suppliers,s.invoices,s.branches,s.members,s.audit,s.transfers,s.cashDays]) if (!unique(items)) throw new Error('Duplicate record IDs in backup')
  const branchExists = (bid: string) => s.branches.some(b => b.id === bid)
  for (const item of [...s.accounts,...s.transactions,...s.cheques,...s.suppliers,...s.invoices,...s.transfers,...s.cashDays]) if (!branchExists(item.branchId)) throw new Error('Unknown branch')
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
  validateCafeRecords(s)
  return s
}
export function applyCommand(data: Snapshot, command: Command, actor: {id:string; role:Role; name:string}): Snapshot {
  if (['setMemberRole','removeMember'].includes(command.type) && actor.role !== 'owner') throw new Error('Only the owner can manage team roles')
  if (['setChequeStatus','addAccount'].includes(command.type) && actor.role === 'staff') throw new Error('A manager or owner must approve this change')
  const next = structuredClone(data)
  const p = command.payload
  if (command.type === 'addTransaction') {
    const t = transactionSchema.parse(command.payload)
    if (t.transferId||t.cashDayId) throw new Error('Use the money transfer or daily cash form for these entries')
    requireOpenCashDay(next,t.accountId,t.date)
    if (t.chequeId || t.method==='cheque') throw new Error('Record cheque movements through cheque clearance')
    const payingAccount=next.accounts.find(a=>a.id===t.accountId)
    if(t.type==='expense'&&payingAccount&&['cash','safe'].includes(payingAccount.type)&&balanceOn(payingAccount,next.transactions,t.date)<t.amount)throw new Error('There is not enough money in that cash drawer or safe')
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
  } else if (command.type==='transfer'||command.type==='openDay'||command.type==='closeDay') {
    applyCafeCommand(next,command)
  } else if (command.type === 'addAccount') next.accounts.push(accountSchema.parse(command.payload))
  else if (command.type === 'addSupplier') next.suppliers.push(supplierSchema.parse(command.payload))
  else if (command.type === 'addInvoice') next.invoices.unshift(invoiceSchema.parse(command.payload))
  else if (command.type === 'removeMember') {
    if(command.payload.id===actor.id)throw new Error('You cannot remove your own access')
    const member=next.members.find(m=>m.id===command.payload.id)
    if(!member)throw new Error('Team member not found')
    if(member.role==='owner'&&next.members.filter(m=>m.role==='owner').length<=1)throw new Error('Keep at least one owner')
    next.members=next.members.filter(m=>m.id!==member.id)
  }
  else if (command.type === 'setMemberRole') {
    const member = next.members.find(m=>m.id===command.payload.id)
    if (!member) throw new Error('Team member not found')
    if (member.role==='owner' && command.payload.role!=='owner' && next.members.filter(m=>m.role==='owner').length===1) throw new Error('Keep at least one owner')
    member.role = z.enum(roles).parse(command.payload.role)
  }
  next.audit.unshift({ id:crypto.randomUUID(), action:command.type, entityId:p.id, at:new Date().toISOString(), actor:actor.name })
  return validateSnapshot(next)
}

export function isOperating(t:Transaction) { return !t.transferId && !t.cashDayId }
export function balanceOn(account:Account,transactions:Transaction[],day:string,before=false) { return balance(account,transactions.filter(t=>before?t.date<day:t.date<=day)) }
export function requireOpenCashDay(data:Snapshot,accountId:string,day:string) {
  const account=data.accounts.find(a=>a.id===accountId)
  if(account?.type!=='cash')return
  if(!data.cashDays.some(d=>d.accountId===accountId&&d.date===day&&d.closing===null))throw new Error('Open the cash day before recording cash. Closed days cannot be changed.')
}
export function validateCafeRecords(s:Snapshot) {
  for(const transfer of s.transfers){
    for(const accountId of [transfer.fromAccountId,transfer.toAccountId])if(!s.accounts.some(a=>a.id===accountId&&a.branchId===transfer.branchId))throw new Error('Transfer accounts must belong to your business')
    const legs=s.transactions.filter(t=>t.transferId===transfer.id)
    if(legs.length!==2||!legs.some(t=>t.type==='expense'&&t.accountId===transfer.fromAccountId&&t.amount===transfer.amount)||!legs.some(t=>t.type==='income'&&t.accountId===transfer.toAccountId&&t.amount===transfer.amount)||legs.some(t=>t.date!==transfer.date||t.chequeId||t.cashDayId))throw new Error('Each transfer must have exactly two matching account movements')
  }
  const days=new Set<string>(),openAccounts=new Set<string>()
  for(const d of s.cashDays){
    if(!s.accounts.some(a=>a.id===d.accountId&&a.branchId===d.branchId&&a.type==='cash'))throw new Error('Daily cash counts require your cash drawer')
    if(d.date>today())throw new Error('A cash day cannot be in the future')
    if(d.closing===null){if(openAccounts.has(d.accountId))throw new Error('Only one cash day may be open');openAccounts.add(d.accountId)}
    const key=d.accountId+':'+d.date;if(days.has(key))throw new Error('This cash day is already recorded');days.add(key)
    if((d.closing===null)!==(d.expectedClosing===null))throw new Error('Incomplete closing cash record')
    for(const kind of ['opening','closing'] as const){const difference=kind==='opening'?d.opening-d.openingLedger:d.closing===null?0:d.closing-d.expectedClosing!;const adjustments=s.transactions.filter(t=>t.cashDayId===d.id&&t.countKind===kind);if(adjustments.length!==(difference===0?0:1)||adjustments.some(t=>t.amount!==Math.abs(difference)||t.type!==(difference>0?'income':'expense')))throw new Error('Cash count adjustment does not match the recorded difference')}
    if(d.closing!==null&&balanceOn(s.accounts.find(a=>a.id===d.accountId)!,s.transactions,d.date)!==d.closing)throw new Error('Closing count does not match the cash ledger')
  }
  for(const t of s.transactions){
    if(t.transferId&&!s.transfers.some(x=>x.id===t.transferId))throw new Error('Unknown money transfer')
    if(t.cashDayId&&!s.cashDays.some(d=>d.id===t.cashDayId&&d.accountId===t.accountId&&d.date===t.date))throw new Error('Unknown daily cash adjustment')
    if(Boolean(t.cashDayId)!==Boolean(t.countKind))throw new Error('Incomplete cash count adjustment')
  }
}
function applyCafeCommand(data:Snapshot,command:Extract<Command,{type:'transfer'|'openDay'|'closeDay'}>) {
  if(command.type==='transfer'){
    const t=transferSchema.parse(command.payload)
    if(t.date>today())throw new Error('A transfer cannot be dated in the future')
    requireOpenCashDay(data,t.fromAccountId,t.date);requireOpenCashDay(data,t.toAccountId,t.date)
    const source=data.accounts.find(a=>a.id===t.fromAccountId&&a.branchId===t.branchId)
    if(!source)throw new Error('Source account not found')
    if(source.type!=='bank'&&balanceOn(source,data.transactions,t.date)<t.amount)throw new Error('There is not enough money in that cash drawer or safe')
    data.transfers.unshift(t)
    for(const type of ['expense','income'] as const)data.transactions.unshift({id:crypto.randomUUID(),branchId:t.branchId,accountId:type==='expense'?t.fromAccountId:t.toAccountId,type,amount:t.amount,category:'Money transfer',description:t.description,date:t.date,method:'transfer',supplierId:null,chequeId:null,transferId:t.id})
    return
  }
  const notes=command.payload.notes.trim()
  if(notes.length>1000)throw new Error('Keep the note under 1,000 characters')
  let day:CashDay,expected:number,counted:number,kind:'opening'|'closing'
  if(command.type==='openDay'){
    const p=command.payload;date.parse(p.date);money.parse(p.opening)
    const account=data.accounts.find(a=>a.id===p.accountId&&a.branchId===p.branchId&&a.type==='cash')
    if(!account)throw new Error('Choose the cash drawer')
    if(p.date>today())throw new Error('The cash day cannot be in the future')
    if(data.cashDays.some(d=>d.accountId===p.accountId&&(d.date>=p.date||d.closing===null)))throw new Error('Close the previous day first. Each date can be opened once.')
    if(data.transactions.some(t=>t.accountId===p.accountId&&t.date>p.date))throw new Error('An earlier day cannot be opened after later cash movements')
    if(account.openingBalance===0&&!data.cashDays.some(d=>d.accountId===account.id)&&!data.transactions.some(t=>t.accountId===account.id))account.openingBalance=p.opening
    expected=balanceOn(account,data.transactions,p.date,true);counted=p.opening;kind='opening'
    day={id:p.id,branchId:p.branchId,accountId:p.accountId,date:p.date,opening:counted,openingLedger:expected,closing:null,expectedClosing:null,notes}
    data.cashDays.unshift(day)
  }else{
    money.parse(command.payload.closing)
    const existing=data.cashDays.find(d=>d.id===command.payload.id)
    if(!existing||existing.closing!==null)throw new Error('This cash day is already closed or could not be found')
    day=existing;expected=balanceOn(data.accounts.find(a=>a.id===day.accountId)!,data.transactions,day.date);counted=command.payload.closing;kind='closing'
    day.closing=counted;day.expectedClosing=expected;day.notes=[day.notes,notes].filter(Boolean).join('\n').slice(0,2000)
  }
  const difference=counted-expected
  if(difference&&!notes)throw new Error('Add a note explaining the cash count difference')
  if(difference)data.transactions.unshift({id:crypto.randomUUID(),branchId:day.branchId,accountId:day.accountId,type:difference>0?'income':'expense',amount:Math.abs(difference),category:'Cash count adjustment',description:`${kind==='opening'?'Opening':'Closing'} cash count: ${notes}`.slice(0,160),date:day.date,method:'cash',supplierId:null,chequeId:null,cashDayId:day.id,countKind:kind})
}
export function dailyCashRows(data:Snapshot,from:string,to:string) {
  const cash=data.accounts.find(a=>a.type==='cash')
  if(!cash)return []
  return data.cashDays.filter(d=>d.accountId===cash.id&&d.date>=from&&d.date<=to).sort((a,b)=>b.date.localeCompare(a.date)).map(d=>{
    const tx=data.transactions.filter(t=>t.accountId===cash.id&&t.date===d.date)
    const transfers=data.transfers.filter(t=>t.date===d.date)
    const outTo=(type:string)=>transfers.filter(t=>t.fromAccountId===cash.id&&data.accounts.find(a=>a.id===t.toAccountId)?.type===type).reduce((n,t)=>n+t.amount,0)
    return {...d,income:tx.filter(t=>isOperating(t)&&t.type==='income').reduce((n,t)=>n+t.amount,0),expenses:tx.filter(t=>isOperating(t)&&t.type==='expense').reduce((n,t)=>n+t.amount,0),bankDeposits:outTo('bank'),safeDeposits:outTo('safe'),expected:d.expectedClosing??balanceOn(cash,data.transactions,d.date),variance:d.closing===null?null:d.closing-d.expectedClosing!}
  })
}
export function cashbookRows(data:Snapshot,accountId='all') {
  return [...data.transactions].filter(t=>accountId==='all'?!t.transferId||t.type==='expense':t.accountId===accountId).sort((a,b)=>b.date.localeCompare(a.date))
}
