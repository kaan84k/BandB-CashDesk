import { expect, test, type Page } from '@playwright/test'
import { applyCommand, type Command } from '../../src/lib/domain'
import { createDemo, DEMO_USER } from '../../src/lib/seed'

async function backend(page: Page, options: { setup?: boolean; missingSchema?: boolean } = {}) {
  let data = createDemo(), setup = options.setup ?? false
  let mutationCalls = 0, loseSaveResponse = false, loseRefresh = false, failNextSnapshot = false
  const receipts = new Map<string, string>(), recoveries: string[] = [], passwords: string[] = []
  const user = { id: DEMO_USER.id, aud: 'authenticated', role: 'authenticated', email: DEMO_USER.email, email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [] }
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url'), 'test-signature'].join('.')
  await page.route('https://cashdesk-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url())
    const body = request.postDataJSON() ?? {}
    const reply = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(value) })
    if (request.method() === 'OPTIONS') { await reply({}); return }
    if (url.pathname.endsWith('/token')) { await reply({ access_token: token, refresh_token: 'test-refresh-token', expires_in: 3600, token_type: 'bearer', user }); return }
    if (url.pathname.endsWith('/logout')) { await reply({}); return }
    if (url.pathname.endsWith('/recover')) { recoveries.push(body.email); await reply({}); return }
    if (url.pathname.endsWith('/user')) { if (request.method() === 'PUT') passwords.push(body.password); await reply(user); return }
    if (url.pathname.endsWith('/signup')) { await reply({ ...user, email_confirmed_at: null }); return }
    if (url.pathname.endsWith('/cashdesk_health')) { await reply(options.missingSchema ? {code:'PGRST202',message:'Could not find function public.cashdesk_health'} : {app:'bb-cashdesk',schemaVersion:4}, options.missingSchema ? 404 : 200); return }
    if (url.pathname.endsWith('/cashdesk_workspace_state')) { await reply({ status: setup ? 'setup_required' : 'ready' }); return }
    if (url.pathname.endsWith('/cashdesk_create_workspace')) {
      setup = false
      data = { ...data, branches: [{ ...data.branches[0], name: body.branch_name, location: body.branch_location }], members: [{ ...DEMO_USER, name: body.profile_name }], accounts: data.accounts.map(a=>({...a,openingBalance:0})), cashDays:[],transfers:[], transactions: [], suppliers: [], invoices: [], cheques: [], audit: [] }
      await reply({created:true}); return
    }
    if (url.pathname.endsWith('/cashdesk_snapshot')) {
      if (failNextSnapshot) { failNextSnapshot = false; await reply({message:'Connection timed out'},503); return }
      await reply(data); return
    }
    if (url.pathname.endsWith('/cashdesk_mutate')) {
      mutationCalls++
      const command = body.command as Command
      const existing = receipts.get(command.requestId!)
      if (!existing) { data = applyCommand(data, command, DEMO_USER); receipts.set(command.requestId!, JSON.stringify(command)) }
      else expect(existing).toBe(JSON.stringify(command))
      if (loseSaveResponse) { loseSaveResponse = false; await route.abort('failed'); return }
      if (loseRefresh) { loseRefresh = false; failNextSnapshot = true }
      await reply(null); return
    }
    if (url.pathname.includes('/rest/v1/')) { await reply([]); return }
    throw new Error(`Unexpected mock endpoint: ${url.pathname}`)
  })
  return {
    token, get data() { return data }, get mutationCalls() { return mutationCalls }, recoveries, passwords,
    loseNextSaveResponse: () => { loseSaveResponse = true },
    failRefreshAfterSave: () => { loseRefresh = true },
  }
}
async function login(page: Page) {
  await page.goto('/')
  await page.getByLabel('Email address').fill(DEMO_USER.email)
  await page.getByLabel('Password',{exact:true}).fill('test-owner-password')
  await page.getByRole('button',{name:'Sign in',exact:true}).click()
}
async function income(page: Page, description: string) {
  await page.getByRole('button',{name:'Record income',exact:true}).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Description',{exact:true}).fill(description)
  await dialog.getByLabel('Amount (LKR)',{exact:true}).fill('123.45')
  return dialog
}

test('signs into a connected workspace and never persists a demo ledger',async({page})=>{
  await backend(page);await login(page)
  await expect(page.locator('h1')).toContainText('Your cafe, today.')
  expect(await page.evaluate(()=>localStorage.getItem('bb-cashdesk-demo-v1'))).toBeNull()
  await page.reload();await expect(page.locator('h1')).toContainText('Your cafe, today.')
  if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();await expect(page.locator('.drawer-balance')).toHaveCount(0)
})
test('guides an owner through creation of an empty private workspace',async({page})=>{
  const state=await backend(page,{setup:true});await login(page)
  await expect(page.getByRole('heading',{name:'Set up your cafe.'})).toBeVisible()
  await page.getByLabel('Your name',{exact:true}).fill('Owner Name')
  await page.getByRole('button',{name:'Create private workspace',exact:true}).click()
  await expect(page.locator('h1')).toContainText('Your cafe, today.')
  await expect(page.locator('.drawer-balance')).toContainText('Open your cash day')
  expect(state.data.transactions).toHaveLength(0)
})
test('explains missing database migrations instead of opening a demo',async({page})=>{
  await backend(page,{missingSchema:true});await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('needs the CashDesk migrations')
  expect(await page.evaluate(()=>localStorage.getItem('bb-cashdesk-demo-v1'))).toBeNull()
})
test('retries a lost save response with the same command and only one movement',async({page})=>{
  const state=await backend(page);await login(page);await expect(page.locator('.drawer-balance')).toBeVisible()
  const before=state.data.transactions.length;state.loseNextSaveResponse()
  const dialog=await income(page,'Safe retry sale');await dialog.getByRole('button',{name:'Save income',exact:true}).click()
  await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('Description',{exact:true})).toHaveValue('Safe retry sale')
  await dialog.getByRole('button',{name:'Save income',exact:true}).click();await expect(dialog).not.toBeVisible()
  expect(state.data.transactions).toHaveLength(before+1);expect(state.mutationCalls).toBe(2)
})
test('keeps a confirmed save successful when the following refresh fails',async({page})=>{
  const state=await backend(page);await login(page);await expect(page.locator('.drawer-balance')).toBeVisible();state.failRefreshAfterSave()
  const dialog=await income(page,'Confirmed server sale');await dialog.getByRole('button',{name:'Save income',exact:true}).click();await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('status')).toContainText('Saved on the server')
  await expect(page.locator('.connection-banner')).toBeVisible();expect(state.mutationCalls).toBe(1)
  await page.getByRole('button',{name:'Retry connection',exact:true}).click();await expect(page.locator('.connection-banner')).toHaveCount(0)
  await expect(page.getByText('Confirmed server sale',{exact:true})).toBeVisible();expect(state.mutationCalls).toBe(1)
})
test('keeps an open form while offline and saves after reconnecting',async({page,context})=>{
  await backend(page);await login(page);await expect(page.locator('.drawer-balance')).toBeVisible()
  const dialog=await income(page,'Reconnect sale');await context.setOffline(true)
  await dialog.getByRole('button',{name:'Save income',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Refresh the connection')
  await expect(dialog.getByLabel('Description',{exact:true})).toHaveValue('Reconnect sale')
  await context.setOffline(false);await dialog.getByRole('button',{name:'Save income',exact:true}).click();await expect(dialog).not.toBeVisible()
})
test('offers password recovery and account confirmation without external emails',async({page})=>{
  const state=await backend(page);await page.goto('/')
  await page.getByRole('button',{name:'Forgot password?',exact:true}).click();await page.getByLabel('Email address').fill(DEMO_USER.email)
  await page.getByRole('button',{name:'Send reset link',exact:true}).click();await expect(page.getByRole('status')).toContainText('If that account exists')
  expect(state.recoveries).toEqual([DEMO_USER.email])
  await page.getByRole('button',{name:'Back to sign in',exact:true}).click();await page.getByRole('button',{name:'New business? Get started',exact:true}).click()
  await page.getByLabel('Email address').fill('new-owner@example.com');await page.getByLabel('Password',{exact:true}).fill('test-new-owner-password')
  await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('status')).toContainText('Check your email')
})


test('completes the password recovery callback before opening financial records',async({page})=>{
  const state=await backend(page)
  const fragment=new URLSearchParams({access_token:state.token,refresh_token:'test-refresh-token',expires_in:'3600',token_type:'bearer',type:'recovery'})
  await page.goto('/#'+fragment.toString())
  await expect(page.getByRole('heading',{name:'Choose your password.'})).toBeVisible()
  await page.getByLabel('New password',{exact:true}).fill('replacement-test-password')
  await page.getByLabel('Confirm password',{exact:true}).fill('replacement-test-password')
  await page.getByRole('button',{name:'Save password',exact:true}).click()
  await expect(page.locator('h1')).toContainText('Your cafe, today.')
  expect(state.passwords).toEqual(['replacement-test-password'])
})
