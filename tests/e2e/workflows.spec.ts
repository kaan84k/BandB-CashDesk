import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import type { Snapshot } from '../../src/lib/domain'

async function records(page:Page){return page.evaluate(()=>JSON.parse(localStorage.getItem('bb-cashdesk-demo-v1')!) as Snapshot)}
async function open(page:Page,path='/'){await page.goto(path);await expect(page.locator('h1')).toBeVisible()}
const total=(s:Snapshot)=>s.accounts.reduce((n,a)=>n+a.openingBalance,0)+s.transactions.reduce((n,t)=>n+(t.type==='income'?t.amount:-t.amount),0)
async function addIncome(page:Page,amount='1,234.56',description='E2E afternoon sales'){
  await open(page)
  await page.getByRole('button',{name:'Add transaction',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Description',{exact:true}).fill(description)
  await dialog.getByLabel('Amount (LKR)',{exact:true}).fill(amount)
  await dialog.getByRole('button',{name:'Save income',exact:true}).click()
  await expect(dialog).not.toBeVisible()
}
test('records income with exact cents and retains it after reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await open(page);const before=total(await records(page));await addIncome(page);await expect(page.getByRole('status')).toContainText('Saved successfully')
  expect(total(await records(page))).toBe(before+123456)
  await page.reload();await expect(page.getByText('E2E afternoon sales',{exact:true})).toBeVisible();expect(total(await records(page))).toBe(before+123456);expect(errors).toEqual([])
})
test('registers and clears a cheque exactly once',async({page})=>{
  await open(page,'/cheques');const before=total(await records(page))
  await page.getByRole('button',{name:'Register cheque',exact:true}).click();const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Cheque number',{exact:true}).fill('E2E100')
  await dialog.getByLabel('Amount (LKR)',{exact:true}).fill('125.35')
  await dialog.getByLabel('Payee',{exact:true}).fill('E2E supplier')
  await dialog.getByLabel('Bank on cheque',{exact:true}).fill('Commercial Bank')
  await dialog.getByRole('button',{name:'Register cheque',exact:true}).click();await expect(dialog).not.toBeVisible();expect(total(await records(page))).toBe(before)
  await page.getByRole('button',{name:'Review cheque E2E100',exact:true}).click();await page.getByLabel('Update status',{exact:true}).selectOption('cleared');await page.getByRole('button',{name:'Update status',exact:true}).click();await expect(dialog).not.toBeVisible()
  const result=await records(page),c=result.cheques.find(c=>c.number==='E2E100')!;expect(result.transactions.filter(t=>t.chequeId===c.id)).toHaveLength(1);expect(total(result)).toBe(before-12535)
  await page.reload();await page.getByRole('button',{name:'Review cheque E2E100',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('finalised');await expect(page.getByRole('button',{name:'Update status',exact:true})).toHaveCount(0)
})
test('records supplier invoices and actual payments independently',async({page})=>{
  await open(page,'/suppliers');await page.getByRole('button',{name:'Add invoice',exact:true}).click();const dialog=page.getByRole('dialog')
  await dialog.getByLabel('Supplier',{exact:true}).selectOption({label:'Serendib Flour Mills'});await dialog.getByLabel('Invoice reference',{exact:true}).fill('E2E-INV-1');await dialog.getByLabel('Amount (LKR)',{exact:true}).fill('500');await dialog.getByRole('button',{name:'Save invoice',exact:true}).click();await expect(dialog).not.toBeVisible()
  await page.getByRole('button',{name:/Serendib Flour Mills/}).click();await expect(dialog).toContainText('E2E-INV-1');await expect(dialog).toContainText('125,500');await dialog.getByRole('button',{name:'Close statement'}).click()
  await open(page,'/transactions');await page.getByRole('button',{name:'Add expense',exact:true}).click();await dialog.getByLabel('Description',{exact:true}).fill('E2E supplier payment');await dialog.getByLabel('Amount (LKR)',{exact:true}).fill('100');await dialog.locator('select[name="supplierId"]').selectOption({label:'Serendib Flour Mills'});await dialog.getByRole('button',{name:'Save expense',exact:true}).click();await expect(dialog).not.toBeVisible()
  await open(page,'/suppliers');await page.getByRole('button',{name:/Serendib Flour Mills/}).click();await expect(dialog).toContainText('125,400');await expect(dialog).toContainText('E2E supplier payment')
})
test('filters records and downloads real Excel and PDF reports',async({page})=>{
  await open(page,'/transactions');await page.getByPlaceholder('Search transactions…').fill('Morning cafe');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('Morning cafe sales')
  await open(page,'/reports');const excelEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel',exact:true}).click();const excel=await excelEvent;expect(excel.suggestedFilename()).toMatch(/\.xlsx$/);const file=await excel.path();const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(file!);expect(workbook.getWorksheet('Cash flow')?.getCell('A1').value).toBe('Date');expect(workbook.getWorksheet('Cash flow')!.rowCount).toBeGreaterThan(1)
  const pdfEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export PDF',exact:true}).click();const pdf=await pdfEvent;expect((await readFile((await pdf.path())!)).subarray(0,5).toString()).toBe('%PDF-')
})
test('restores a valid backup and rejects an inconsistent one without losing records',async({page})=>{
  await open(page,'/settings');const backup=await records(page);await addIncome(page,'88.50','Backup roundtrip sale');await open(page,'/settings')
  await page.getByLabel('Choose backup file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.getByRole('dialog').getByRole('button',{name:'Restore backup',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect((await records(page)).transactions).toHaveLength(backup.transactions.length)
  const broken={...backup,transactions:backup.transactions.filter(t=>!t.chequeId)};await page.getByLabel('Choose backup file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken))});await page.getByRole('dialog').getByRole('button',{name:'Restore backup',exact:true}).click();await expect(page.getByRole('alert')).toContainText('exactly one');expect((await records(page)).transactions).toHaveLength(backup.transactions.length)
})
test('supports branch filtering and mobile navigation without page overflow',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page)
  await page.getByLabel('Select branch',{exact:true}).selectOption({label:'Bakery production'});await expect(page.locator('.balance-card')).toContainText('6,650');await expect(page.locator('.account-mini')).toHaveCount(1)
  await page.getByLabel('Select branch',{exact:true}).selectOption('all')
  if(testInfo.project.name==='mobile'){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Cheques',exact:true}).click();await expect(page.getByRole('button',{name:'Register cheque',exact:true})).toBeVisible()}
  for(const path of ['/','/transactions','/cheques','/suppliers','/accounts','/reminders','/reports','/team','/settings']){await open(page,path);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)}
  expect(errors).toEqual([])
})
