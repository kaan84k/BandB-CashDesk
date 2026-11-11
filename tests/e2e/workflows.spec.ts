import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import type { Snapshot } from '../../src/lib/domain'
async function records(page:Page){return page.evaluate(()=>JSON.parse(localStorage.getItem('bb-cashdesk-demo-v1')!) as Snapshot)}
async function open(page:Page,path='/'){await page.goto(path);await expect(page.locator('main h1')).toBeVisible()}
const total=(s:Snapshot)=>s.accounts.reduce((n,a)=>n+a.openingBalance,0)+s.transactions.reduce((n,t)=>n+(t.type==='income'?t.amount:-t.amount),0)
const drawer=(s:Snapshot)=>s.accounts.find(a=>a.type==='cash')!
const drawerBalance=(s:Snapshot)=>drawer(s).openingBalance+s.transactions.filter(t=>t.accountId===drawer(s).id).reduce((n,t)=>n+(t.type==='income'?t.amount:-t.amount),0)
async function addIncome(page:Page,description='Afternoon business sales'){
  await open(page);await page.getByRole('button',{name:'Record income',exact:true}).click();const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Description',{exact:true}).fill(description);await dialog.getByLabel('Amount (LKR)',{exact:true}).fill('123.45');await dialog.getByRole('button',{name:'Save income',exact:true}).click();await expect(dialog).not.toBeVisible()
}
test('records business income with exact cents and keeps it after reload',async({page})=>{
  await open(page);const before=total(await records(page));await addIncome(page)
  expect(total(await records(page))).toBe(before+12345);await page.reload();await expect(page.getByText('Afternoon business sales',{exact:true})).toBeVisible()
})
test('records bank deposits and safe transfers without increasing sales or total money',async({page})=>{
  await open(page);const before=await records(page),incomeBefore=before.transactions.filter(t=>!t.transferId&&!t.cashDayId&&t.type==='income').reduce((n,t)=>n+t.amount,0)
  for(const [button,amount] of [['Deposit to bank','1000'],['Move to safe','500']] as const){await page.getByRole('button',{name:button,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Amount (LKR)',{exact:true}).fill(amount);await dialog.getByRole('button',{name:'Save transfer',exact:true}).click();await expect(dialog).not.toBeVisible()}
  const after=await records(page);expect(total(after)).toBe(total(before));expect(drawerBalance(after)).toBe(drawerBalance(before)-150000);expect(after.transfers).toHaveLength(before.transfers.length+2)
  expect(after.transactions.filter(t=>!t.transferId&&!t.cashDayId&&t.type==='income').reduce((n,t)=>n+t.amount,0)).toBe(incomeBefore)
})
test('closes the day with a separate cash-count difference and exports the daily report',async({page})=>{
  await open(page);const before=await records(page),count=(drawerBalance(before)-1000)/100
  await page.getByRole('button',{name:'Close day',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Closing cash (LKR)',{exact:true}).fill(count.toFixed(2));await dialog.locator('textarea[name="notes"]').fill('Change difference');await dialog.getByRole('button',{name:'Close day',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Day closed',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Record income',exact:true}).click();await dialog.getByLabel('Amount (LKR)',{exact:true}).fill('100');await dialog.getByRole('button',{name:'Save income',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Closed days');await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
  await open(page,'/reports');const xlsxEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel',exact:true}).click();const xlsx=await xlsxEvent,book=new ExcelJS.Workbook();await book.xlsx.readFile((await xlsx.path())!);expect(book.getWorksheet('Daily cash')!.getCell('H2').value).toBe(count);expect(book.getWorksheet('Bank and safe')).toBeDefined()
  const pdfEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export PDF',exact:true}).click();expect((await readFile((await(await pdfEvent).path())!)).subarray(0,5).toString()).toBe('%PDF-')
})
test('registers and clears a cheque exactly once',async({page})=>{
  await open(page,'/cheques');const before=total(await records(page));await page.getByRole('button',{name:'Register cheque',exact:true}).click();const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Cheque number',{exact:true}).fill('CAFE100');await dialog.getByLabel('Amount (LKR)',{exact:true}).fill('125.35');await dialog.getByLabel('Payee',{exact:true}).fill('Business products supplier');await dialog.getByLabel('Bank on cheque',{exact:true}).fill('Commercial Bank');await dialog.getByRole('button',{name:'Register cheque',exact:true}).click();await expect(dialog).not.toBeVisible();expect(total(await records(page))).toBe(before)
  await page.getByRole('button',{name:'Review cheque CAFE100',exact:true}).click();await dialog.getByLabel('Update status',{exact:true}).selectOption('cleared');await dialog.getByRole('button',{name:'Update status',exact:true}).click();await expect(dialog).not.toBeVisible();const after=await records(page),cheque=after.cheques.find(c=>c.number==='CAFE100')!;expect(after.transactions.filter(t=>t.chequeId===cheque.id)).toHaveLength(1);expect(total(after)).toBe(before-12535)
})
test('restores business records from a valid backup',async({page})=>{
  await open(page);const before=await records(page);await addIncome(page,'Backup test sale');await open(page,'/settings')
  await page.getByLabel('Choose backup file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(before))});await page.getByRole('dialog').getByRole('button',{name:'Restore backup',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect((await records(page)).transactions).toHaveLength(before.transactions.length)
})
test('keeps business navigation simple and fits phone screens',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page)
  if(testInfo.project.name==='mobile'){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Bank & safe',exact:true}).click();await expect(page.locator('main h1')).toContainText('Bank & safe')}
  for(const path of ['/','/transactions','/accounts','/cheques','/reminders','/reports','/settings']){await open(page,path);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)}
  await open(page,'/transactions');await page.getByPlaceholder('Search cashbook…').fill('Morning sales');await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Suppliers',exact:true})).toHaveCount(0);await expect(page.locator('body')).not.toContainText('Bakery production');expect(errors).toEqual([])
})
