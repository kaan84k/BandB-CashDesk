import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { addDays, today, validateSnapshot } from '../src/lib/domain'

const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const OWNER=id(1),STAFF=id(2),MANAGER=id(3),OUTSIDER=id(4),CO=id(10),OTHER=id(11),BR=id(20),BR2=id(21),FOREIGN=id(22),BANK=id(30),CASH=id(31),BANK2=id(32),FOREIGN_BANK=id(33)
let db:PGlite
async function login(user=OWNER){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated')}
async function mutate(type:string,payload:Record<string,unknown>){return db.query('select public.cashdesk_mutate($1::jsonb)',[JSON.stringify({type,payload})])}
async function snapshot(){const r=await db.query<{data:unknown}>('select public.cashdesk_snapshot() as data');return validateSnapshot(r.rows[0].data)}
const cheque=(overrides:Record<string,unknown>={})=>({id:crypto.randomUUID(),branchId:BR,accountId:BANK,number:'001100',type:'issued',payee:'Test supplier',supplierId:null,bank:'Test Bank',amount:125050,issueDate:today(),dueDate:addDays(today(),3),status:'issued',notes:'',...overrides})
const transaction=(overrides:Record<string,unknown>={})=>({id:crypto.randomUUID(),branchId:BR,accountId:BANK,type:'income',amount:10001,category:'Cafe sales',description:'Test sale',date:today(),method:'cash',supplierId:null,chequeId:null,...overrides})
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text default 'member@example.com',email_confirmed_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;`)
  for(const name of (await readdir('supabase/migrations')).sort())await db.exec(await readFile('supabase/migrations/'+name,'utf8'))
},30000)
beforeEach(async()=>{
  await db.exec('reset role;truncate auth.users,public.companies cascade')
  await db.exec(`insert into auth.users values('${OWNER}'),('${STAFF}'),('${MANAGER}'),('${OUTSIDER}');insert into public.companies values('${CO}','Cafe'),('${OTHER}','Other company');insert into public.members values('${OWNER}','${CO}','Owner','owner@example.com','owner'),('${STAFF}','${CO}','Staff','staff@example.com','staff'),('${MANAGER}','${CO}','Manager','manager@example.com','manager'),('${OUTSIDER}','${OTHER}','Outsider','outsider@example.com','owner');insert into public.branches values('${BR}','${CO}','Cafe','Colombo'),('${BR2}','${CO}','Bakery','Production'),('${FOREIGN}','${OTHER}','Other','Elsewhere');insert into public.user_branch_access values('${CO}','${STAFF}','${BR}'),('${CO}','${MANAGER}','${BR}');insert into public.accounts values('${BANK}','${CO}','${BR}','Bank','bank','Commercial',100000),('${CASH}','${CO}','${BR}','Till','cash','',5000),('${BANK2}','${CO}','${BR2}','Bakery bank','bank','Sampath',2000),('${FOREIGN_BANK}','${OTHER}','${FOREIGN}','Foreign bank','bank','Test',3000);`)
  await login()
})
afterAll(async()=>{await db?.close()})
describe('PostgreSQL migrations, RLS, and audited RPCs',()=>{
  it('returns a schema-compatible owner snapshot',async()=>{const s=await snapshot();expect(s.branches).toHaveLength(2);expect(s.accounts).toHaveLength(3);expect(s.members).toHaveLength(3)})
  it('limits staff and managers to authorised branches',async()=>{await login(STAFF);const s=(await db.query<{data:{branches:{id:string}[];accounts:unknown[]}}>('select public.cashdesk_entry_context() as data')).rows[0].data;expect(s.branches.map(b=>b.id)).toEqual([BR]);expect(s.accounts).toHaveLength(2);await expect(mutate('addTransaction',transaction({branchId:BR2,accountId:BANK2}))).rejects.toThrow('No access');await login(MANAGER);expect((await snapshot()).branches).toHaveLength(1)})
  it('isolates companies, even when a record ID is known',async()=>{await login(OUTSIDER);expect((await snapshot()).accounts.map(a=>a.id)).toEqual([FOREIGN_BANK]);await expect(mutate('addTransaction',transaction())).rejects.toThrow('No access')})
  it('denies unauthenticated reads and RPC execution',async()=>{await db.exec('reset role;set role anon');await expect(db.query('select * from public.accounts')).rejects.toThrow('permission denied');await expect(db.query('select public.cashdesk_snapshot()')).rejects.toThrow('permission denied')})
  it('rejects direct writes even for workspace owners',async()=>{await expect(db.exec(`update public.accounts set opening_balance=999 where id='${BANK}'`)).rejects.toThrow('permission denied')})
  it('permits staff data entry with exact decimal storage',async()=>{await login(STAFF);await mutate('addTransaction',transaction());await login();const s=await snapshot();expect(s.transactions[0].amount).toBe(10001);expect(s.audit[0].actor).toBe('Staff')})
  it('rejects fractional minor units and future actual transactions',async()=>{await expect(mutate('addTransaction',transaction({amount:100.25}))).rejects.toThrow('Invalid monetary');await expect(mutate('addTransaction',transaction({date:addDays(today(),1)}))).rejects.toThrow('future')})
  it('rejects cross-branch account substitution',async()=>{await expect(mutate('addTransaction',transaction({accountId:BANK2}))).rejects.toThrow('foreign key')})
  it('permits manager accounts but prevents staff account creation',async()=>{const a={id:crypto.randomUUID(),branchId:BR,name:'Savings',type:'bank',bank:'Test Bank',openingBalance:150000};await login(STAFF);await expect(mutate('addAccount',a)).rejects.toThrow('Data-entry');await login(MANAGER);await mutate('addAccount',a);expect((await snapshot()).accounts.find(x=>x.id===a.id)?.openingBalance).toBe(150000)})
  it('creates no movement on issue and exactly one on clearance',async()=>{const c=cheque();await mutate('addCheque',c);expect((await snapshot()).transactions).toHaveLength(0);await mutate('setChequeStatus',{id:c.id,status:'cleared',date:today()});let s=await snapshot();expect(s.transactions).toHaveLength(1);expect(s.transactions[0]).toMatchObject({amount:125050,type:'expense',chequeId:c.id});await expect(mutate('setChequeStatus',{id:c.id,status:'cleared',date:today()})).rejects.toThrow('transition');s=await snapshot();expect(s.transactions).toHaveLength(1);expect(s.audit).toHaveLength(2)})
  it('records received cheques as income',async()=>{const c=cheque({type:'received',status:'received'});await mutate('addCheque',c);await mutate('setChequeStatus',{id:c.id,status:'cleared',date:today()});expect((await snapshot()).transactions[0].type).toBe('income')})
  it('rolls back a clearance and its audit when the date is invalid',async()=>{const c=cheque();await mutate('addCheque',c);await expect(mutate('setChequeStatus',{id:c.id,status:'cleared',date:addDays(today(),1)})).rejects.toThrow('Clearance date');const s=await snapshot();expect(s.cheques[0].status).toBe('issued');expect(s.transactions).toHaveLength(0);expect(s.audit).toHaveLength(1)})
  it('requires a bank account and prevents duplicate cheque numbers',async()=>{await expect(mutate('addCheque',cheque({accountId:CASH}))).rejects.toThrow('bank account');await mutate('addCheque',cheque({number:'AbC'}));await expect(mutate('addCheque',cheque({number:'abc'}))).rejects.toThrow('duplicate key')})
  it('blocks forged cheque transactions',async()=>{await expect(mutate('addTransaction',transaction({method:'cheque'}))).rejects.toThrow('clearance')})
  it('requires re-presentation of returned cheques before clearing',async()=>{const c=cheque();await mutate('addCheque',c);await mutate('setChequeStatus',{id:c.id,status:'returned'});await expect(mutate('setChequeStatus',{id:c.id,status:'cleared',date:today()})).rejects.toThrow('transition');await mutate('setChequeStatus',{id:c.id,status:'presented'});await mutate('setChequeStatus',{id:c.id,status:'cleared',date:today()});expect((await snapshot()).transactions).toHaveLength(1)})
  it('enforces staff clearance limits on the server',async()=>{const c=cheque();await mutate('addCheque',c);await login(STAFF);await expect(mutate('setChequeStatus',{id:c.id,status:'cleared',date:today()})).rejects.toThrow('Data-entry')})
  it('preserves a last owner and restricts role management',async()=>{await expect(mutate('setMemberRole',{id:OWNER,role:'staff'})).rejects.toThrow('at least one owner');await login(MANAGER);await expect(mutate('setMemberRole',{id:STAFF,role:'owner'})).rejects.toThrow('Only the owner');await login();await mutate('setMemberRole',{id:MANAGER,role:'owner'});await mutate('setMemberRole',{id:OWNER,role:'manager'});expect((await snapshot()).members.find(m=>m.id===OWNER)?.role).toBe('manager')})
  it('keeps supplier purchase and payment history relational',async()=>{const supplier=crypto.randomUUID();await mutate('addSupplier',{id:supplier,branchId:BR,name:'Flour',contact:'Nimal',phone:'',email:'',terms:30});const invoice={id:crypto.randomUUID(),branchId:BR,supplierId:supplier,reference:'INV-1',amount:500000,date:today(),dueDate:addDays(today(),30)};await mutate('addInvoice',invoice);await expect(mutate('addInvoice',{...invoice,id:crypto.randomUUID()})).rejects.toThrow('duplicate key');await mutate('addTransaction',transaction({type:'expense',supplierId:supplier}));const s=await snapshot();expect(s.invoices).toHaveLength(1);expect(s.transactions[0].supplierId).toBe(supplier)})
})
describe('reminder scheduling and deduplication',()=>{
  async function prepare(){
    for(const days of [7,3,1,0,-1,2,9])await mutate('addCheque',cheque({number:`N${days+10}`,issueDate:addDays(today(),-10),dueDate:addDays(today(),days)}))
    await db.exec('reset role');await db.query('insert into public.reminder_settings values($1,true,$2,$3)',[CO,['owner@example.com'],'CashDesk <finance@example.com>']);await db.exec('set role service_role')
  }
  async function claim(){const r=await db.query<{data:{id:string;token:string;key:string;stage:string}[]}>('select public.claim_due_reminders() as data');return r.rows[0].data}
  it('claims only 7/3/1/due/overdue stages and never double claims',async()=>{await prepare();const first=await claim();expect(first.map(d=>d.stage).sort()).toEqual(['0-days','1-days','3-days','7-days','overdue'].map(s=>s==='0-days'?'due':s).sort());expect(await claim()).toHaveLength(0)})
  it('retains the provider idempotency key on retry and rejects stale completion tokens',async()=>{await prepare();const first=(await claim())[0];await db.query('update public.notification_deliveries set updated_at=now()-interval \'16 minutes\' where id=$1',[first.id]);const retry=(await claim())[0];expect(retry.key).toBe(first.key);expect(retry.token).not.toBe(first.token);await db.query('select public.finish_reminder($1,$2,true,$3,null)',[first.id,first.token,'provider-old']);expect((await db.query<{status:string}>('select status from public.notification_deliveries where id=$1',[first.id])).rows[0].status).toBe('sending');await db.query('select public.finish_reminder($1,$2,true,$3,null)',[retry.id,retry.token,'provider-new']);expect((await db.query<{status:string}>('select status from public.notification_deliveries where id=$1',[first.id])).rows[0].status).toBe('sent')})
  it('requires the service role to claim or complete deliveries',async()=>{await expect(db.query('select public.claim_due_reminders()')).rejects.toThrow('permission denied')})
})

describe('connected startup and safe financial retries',()=>{
  it('exposes only the schema version to anonymous health checks',async()=>{
    await db.exec('reset role;set role anon')
    const result=await db.query<{health:unknown}>('select public.cashdesk_health() as health')
    expect(result.rows[0].health).toEqual({app:'bb-cashdesk',schemaVersion:5})
    await expect(db.query('select public.cashdesk_workspace_state()')).rejects.toThrow('permission denied')
  })
  it('reports missing branch access separately from first-run setup',async()=>{
    expect((await db.query<{state:{status:string}}>('select public.cashdesk_workspace_state() as state')).rows[0].state.status).toBe('ready')
    await db.exec('reset role');await db.query('delete from public.user_branch_access where user_id=$1',[STAFF]);await login(STAFF)
    expect((await db.query<{state:{status:string}}>('select public.cashdesk_workspace_state() as state')).rows[0].state.status).toBe('branch_access_required')
  })
  it('creates a verified owner in a new private workspace and is safe to retry',async()=>{
    const uid=crypto.randomUUID();await db.exec('reset role');await db.query('insert into auth.users(id,email) values($1,$2)',[uid,'new-owner@example.com']);await login(uid)
    expect((await db.query<{state:{status:string}}>('select public.cashdesk_workspace_state() as state')).rows[0].state.status).toBe('setup_required')
    const args=['Owner Name','New Cafe','First branch','Colombo']
    await db.query('select public.cashdesk_create_workspace($1,$2,$3,$4)',args)
    const first=await snapshot();expect(first.members).toHaveLength(1);expect(first.members[0]).toMatchObject({id:uid,role:'owner',email:'new-owner@example.com'});expect(first.accounts).toHaveLength(3);expect(first.transactions).toHaveLength(0);expect(first.branches).toHaveLength(1)
    await db.query('select public.cashdesk_create_workspace($1,$2,$3,$4)',args)
    expect((await snapshot()).audit).toHaveLength(1)
    await login(OWNER);expect((await snapshot()).branches.map(b=>b.id)).not.toContain(first.branches[0].id)
  })
  it('does not let unverified users create a workspace or members claim ownership',async()=>{
    const uid=crypto.randomUUID();await db.exec('reset role');await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,null)',[uid,'unverified@example.com']);await login(uid)
    await expect(db.query("select public.cashdesk_create_workspace('Owner','Cafe','Branch','')")).rejects.toThrow('Verify your email')
    await login(STAFF);await expect(db.query("select public.cashdesk_create_workspace('Owner','Cafe','Branch','')")).rejects.toThrow('already belong')
  })
  it('returns the same successful result when a save response is lost',async()=>{
    const command={type:'addTransaction',requestId:crypto.randomUUID(),payload:transaction()}
    const save=()=>db.query('select public.cashdesk_mutate($1::jsonb)',[JSON.stringify(command)])
    await save();await save();const s=await snapshot();expect(s.transactions).toHaveLength(1);expect(s.audit).toHaveLength(1)
    await expect(db.query('select public.cashdesk_mutate($1::jsonb)',[JSON.stringify({...command,payload:{...command.payload,amount:99999}})])).rejects.toThrow('different details')
    expect((await snapshot()).transactions[0].amount).toBe(10001)
  })
  it('retries a clearance without creating a second bank movement or audit event',async()=>{
    const c=cheque();await mutate('addCheque',c)
    const command={type:'setChequeStatus',requestId:crypto.randomUUID(),payload:{id:c.id,status:'cleared',date:today()}}
    await db.query('select public.cashdesk_mutate($1::jsonb)',[JSON.stringify(command)]);await db.query('select public.cashdesk_mutate($1::jsonb)',[JSON.stringify(command)])
    const s=await snapshot();expect(s.transactions).toHaveLength(1);expect(s.audit).toHaveLength(2)
    await expect(db.query('select public.cashdesk_apply_command($1::jsonb)',[JSON.stringify(command)])).rejects.toThrow('permission denied')
    await expect(db.query('select * from public.operation_requests')).rejects.toThrow('permission denied')
  })
})

describe('owner reminder preferences',()=>{
  it('saves preferences and audits the change for the current company only',async()=>{
    await db.query('select public.cashdesk_update_reminder_settings($1,$2,$3)',[true,['owner@example.com'],'Cafe <finance@example.com>'])
    const settings=await db.query<{company_id:string;enabled:boolean;recipients:string[]}>('select company_id,enabled,recipients from public.reminder_settings')
    expect(settings.rows).toEqual([{company_id:CO,enabled:true,recipients:['owner@example.com']}])
    expect((await snapshot()).audit[0].action).toBe('reminderSettingsUpdated')
    await login(OUTSIDER);expect((await db.query('select * from public.reminder_settings')).rows).toHaveLength(0)
  })
  it('rejects staff/manager changes and invalid recipients',async()=>{
    await login(MANAGER);await expect(db.query('select public.cashdesk_update_reminder_settings($1,$2,$3)',[true,['owner@example.com'],'Cafe <finance@example.com>'])).rejects.toThrow('Only the owner')
    await login();await expect(db.query('select public.cashdesk_update_reminder_settings($1,$2,$3)',[true,['invalid-address'],'Cafe <finance@example.com>'])).rejects.toThrow('valid email')
  })
})

describe('cafe opening, closing, bank and safe',()=>{
  const call=(command:unknown)=>db.query('select public.cashdesk_mutate($1::jsonb)',[JSON.stringify(command)])
  const openCash=async()=>{const id=crypto.randomUUID();await call({type:'openDay',requestId:id,payload:{id,branchId:BR,accountId:CASH,date:today(),opening:500000,notes:''}});return id}
  it('opens and closes actual cash with a separate counted difference',async()=>{
    const day=await openCash()
    await mutate('addTransaction',transaction({accountId:CASH,amount:100000}))
    await mutate('addTransaction',transaction({accountId:CASH,type:'expense',amount:50000}))
    const safe=crypto.randomUUID();await mutate('addAccount',{id:safe,branchId:BR,name:'Personal safe',type:'safe',bank:'',openingBalance:0})
    for(const [account,amount] of [[BANK,150000],[safe,50000]] as const){const id=crypto.randomUUID();const command={type:'transfer',requestId:id,payload:{id,branchId:BR,fromAccountId:CASH,toAccountId:account,amount,date:today(),description:'Move cafe money'}};await call(command);await call(command)}
    let s=await snapshot();expect(s.transfers).toHaveLength(2);expect(s.transactions.filter(t=>t.transferId)).toHaveLength(4)
    const requestId=crypto.randomUUID(),command={type:'closeDay',requestId,payload:{id:day,closing:345000,notes:'Missing change'}};await call(command);await call(command)
    s=await snapshot();expect(s.cashDays[0]).toMatchObject({opening:500000,expectedClosing:350000,closing:345000})
    expect(s.transactions.filter(t=>t.cashDayId===day)).toHaveLength(1)
    await expect(mutate('addTransaction',transaction({accountId:CASH}))).rejects.toThrow('Closed days')
  })
  it('rejects cash entry before opening and transferring more than available',async()=>{
    await expect(mutate('addTransaction',transaction({accountId:CASH}))).rejects.toThrow('Open the cash day')
    await openCash();const id=crypto.randomUUID();await expect(call({type:'transfer',requestId:id,payload:{id,branchId:BR,fromAccountId:CASH,toAccountId:BANK,amount:500001,date:today(),description:'Deposit'}})).rejects.toThrow('not enough money')
    expect((await snapshot()).transfers).toHaveLength(0)
  })
})

describe('starting a cafe with existing money',()=>{
  it('records starting bank and safe balances and first drawer cash without inventing sales',async()=>{
    const uid=crypto.randomUUID();await db.exec('reset role');await db.query('insert into auth.users(id,email) values($1,$2)',[uid,'cafe-owner@example.com']);await login(uid)
    await db.query('select public.cashdesk_create_workspace($1,$2,$3,$4,$5,$6,$7)',['Cafe Owner','Books & Buns','My cafe','','Commercial Bank',5100000,1200000])
    let s=await snapshot();expect(s.accounts.find(a=>a.type==='bank')?.openingBalance).toBe(5100000);expect(s.accounts.find(a=>a.type==='safe')?.openingBalance).toBe(1200000)
    const cash=s.accounts.find(a=>a.type==='cash')!,id=crypto.randomUUID()
    await db.query('select public.cashdesk_mutate($1::jsonb)',[JSON.stringify({type:'openDay',requestId:id,payload:{id,branchId:cash.branchId,accountId:cash.id,date:today(),opening:500000,notes:''}})])
    s=await snapshot();expect(s.accounts.find(a=>a.type==='cash')?.openingBalance).toBe(500000);expect(s.cashDays[0].opening).toBe(500000);expect(s.transactions).toHaveLength(0)
  })
})

describe('staff privacy and invitations',()=>{
  const NEW=id(99)
  const rpc=async(name:string,args:unknown[]=[])=> (await db.query<{data:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args)).rows[0].data
  const prepare=()=>rpc('cashdesk_prepare_invitation',['  NEW@Example.com ','New teammate',BR])
  async function newUser(verified=true){await db.exec('reset role');await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[NEW,'new@example.com',verified?new Date().toISOString():null]);await login(NEW)}
  it('denies snapshots, raw financial reads and privileged helpers to staff',async()=>{
    await mutate('addTransaction',transaction());await login(STAFF)
    for(const name of ['cashdesk_snapshot','cashdesk_snapshot_base','cashdesk_people'])await expect(rpc(name)).rejects.toThrow()
    for(const table of ['accounts','transactions','cheques','suppliers','supplier_invoices','cash_days','bank_transfers','cheque_events','audit_logs'])expect((await db.query(`select * from public.${table}`)).rows).toHaveLength(0)
    expect((await db.query('select id from public.members')).rows).toEqual([{id:STAFF}])
    await expect(rpc('cashdesk_balance_at',[CASH,today()])).rejects.toThrow('permission denied')
    await expect(db.query('select * from public.staff_invitations')).rejects.toThrow('permission denied')
    const ctx=await rpc('cashdesk_entry_context');expect(ctx.user.id).toBe(STAFF);expect(ctx.accounts).toHaveLength(2)
    expect(JSON.stringify(ctx)).not.toMatch(/openingBalance|opening_count|closing_count|expected|amount|transactions|audit|invoices|cheques|members/)
    expect(ctx.accounts.map((a:{id:string})=>a.id).sort()).toEqual([BANK,CASH].sort())
  })
  it('allows all entry operations, counts without revealing expectations, and idempotent retries',async()=>{
    await login(STAFF)
    const open={id:crypto.randomUUID(),branchId:BR,accountId:CASH,date:today(),opening:100000,notes:'Physical opening count'}
    await expect(mutate('openDay',{...open,notes:''})).rejects.toThrow('note')
    await mutate('openDay',open)
    const command={type:'addTransaction',requestId:crypto.randomUUID(),payload:transaction({accountId:CASH,amount:5000})}
    await rpc('cashdesk_mutate',[command]);await rpc('cashdesk_mutate',[command])
    await mutate('addTransaction',transaction({accountId:CASH,type:'expense',amount:2000}))
    await mutate('transfer',{id:crypto.randomUUID(),branchId:BR,fromAccountId:CASH,toAccountId:BANK,amount:1000,date:today(),description:'Bank deposit'})
    await mutate('addCheque',cheque())
    await mutate('closeDay',{id:open.id,closing:102000,notes:'Physical closing count'})
    const ctx=await rpc('cashdesk_entry_context');expect(ctx.days[0].status).toBe('closed');expect(ctx.days[0]).not.toHaveProperty('closing')
    await login();const s=await snapshot();expect(s.cashDays).toHaveLength(1);expect(s.transfers).toHaveLength(1);expect(s.cheques).toHaveLength(1);expect(s.transactions.filter(t=>t.description==='Test sale')).toHaveLength(2);expect(s.audit.every(a=>a.actor==='Staff')).toBe(true)
  })
  it('denies every administrative command and owner endpoints to staff',async()=>{
    await login(STAFF)
    for(const type of ['setMemberRole','addAccount','addSupplier','addInvoice','setChequeStatus'])await expect(mutate(type,{})).rejects.toThrow('Data-entry')
    await expect(prepare()).rejects.toThrow('owner');await expect(rpc('cashdesk_revoke_invitation',[NEW])).rejects.toThrow('Owner')
    await expect(rpc('cashdesk_create_workspace',['Staff','Other cafe','Cafe'])).rejects.toThrow('already belong')
    await login(MANAGER);await expect(prepare()).rejects.toThrow('owner')
  })
  it('prepares and reuses a normalized invitation and lets only its verified recipient join as staff',async()=>{
    const invite=await prepare();expect(invite.email).toBe('new@example.com');expect((await prepare()).id).toBe(invite.id)
    await login(OUTSIDER);await expect(rpc('cashdesk_accept_invitation',[invite.id])).rejects.toThrow('not found')
    await newUser(false);await expect(rpc('cashdesk_accept_invitation',[invite.id])).rejects.toThrow('Verify')
    await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[NEW]);await login(NEW)
    expect((await rpc('cashdesk_workspace_state')).status).toBe('invitation_pending')
    await expect(rpc('cashdesk_create_workspace',['New','Wrong cafe','Cafe'])).rejects.toThrow('Accept or decline')
    await rpc('cashdesk_accept_invitation',[invite.id]);await rpc('cashdesk_accept_invitation',[invite.id])
    expect(await rpc('cashdesk_workspace_state')).toEqual({status:'ready',role:'staff'})
    const ctx=await rpc('cashdesk_entry_context');expect(ctx.cafe.id).toBe(CO);expect(ctx.user.role).toBe('staff');expect(ctx.branches.map((b:{id:string})=>b.id)).toEqual([BR]);await expect(snapshot()).rejects.toThrow('Financial')
    await login();expect((await snapshot()).members.find(m=>m.id===NEW)?.role).toBe('staff')
  })
  it('revokes and expires invitations without granting membership',async()=>{
    const invitation=await prepare();await rpc('cashdesk_revoke_invitation',[invitation.id]);await newUser();await expect(rpc('cashdesk_accept_invitation',[invitation.id])).rejects.toThrow('no longer active')
    await login();const fresh=await prepare();await db.exec('reset role');await db.query("update public.staff_invitations set expires_at=now()-interval '1 day' where id=$1",[fresh.id]);await login(NEW);await expect(rpc('cashdesk_accept_invitation',[fresh.id])).rejects.toThrow('no longer active');expect((await rpc('cashdesk_workspace_state')).status).toBe('setup_required')
  })
  it('keeps roster isolated and prevents reassignment of an existing member',async()=>{
    await expect(rpc('cashdesk_prepare_invitation',['other@example.com','Other',FOREIGN])).rejects.toThrow('your cafe')
    const invite=await rpc('cashdesk_prepare_invitation',['member@example.com','Existing user',BR]);await login(OUTSIDER);await expect(rpc('cashdesk_accept_invitation',[invite.id])).rejects.toThrow('already belongs');expect((await rpc('cashdesk_people')).members).toHaveLength(1)
    await login();expect((await rpc('cashdesk_people')).members).toHaveLength(3)
  })
  it('allows declining an invitation and reserves delivery completion for the service role',async()=>{
    const invite=await prepare();await expect(rpc('cashdesk_finish_invitation',[invite.id,OWNER,'sent'])).rejects.toThrow('permission denied')
    await newUser();await rpc('cashdesk_decline_invitation',[invite.id]);expect((await rpc('cashdesk_workspace_state')).status).toBe('setup_required')
  })
})
