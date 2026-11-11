import { describe, expect, it, vi } from 'vitest'
import { createReminderHandler } from '../supabase/functions/cheque-reminders/handler'

const delivery={id:crypto.randomUUID(),token:crypto.randomUUID(),key:'cashdesk/test/2026-11-05/due',recipients:['owner@example.com'],sender:'Business <business@example.com>',payee:'Example supplier',number:'100',amount:1250.50,dueDate:'2026-11-05',type:'issued',stage:'due'}
function fixture(options:{missing?:string;providerFailure?:boolean;claimFailure?:boolean;finishFailure?:boolean;empty?:boolean}={}){
  const rpc=vi.fn(async(name:string)=>name==='claim_due_reminders'?{data:options.empty?[]:[delivery],error:options.claimFailure?'claim error':null}:{data:null,error:options.finishFailure?'finish error':null})
  const fetcher=vi.fn(async()=>options.providerFailure?new Response('Unavailable',{status:503}):Response.json({id:'test-provider-id'}))
  const handler=createReminderHandler({env:name=>name===options.missing?undefined:name==='REMINDER_CRON_SECRET'?'test-cron-secret':name==='SUPABASE_URL'?'https://example.supabase.co':'test-only-value',database:()=>({rpc}),fetch:fetcher as typeof fetch})
  const request=(secret='test-cron-secret')=>new Request('https://example.test/reminders',{method:'POST',headers:{'x-cron-secret':secret}})
  return {handler,rpc,fetcher,request}
}
describe('email handler without external delivery',()=>{
  it('rejects incorrect or absent Cron authentication before any database work',async()=>{const f=fixture();expect((await f.handler(f.request('wrong'))).status).toBe(401);expect(f.rpc).not.toHaveBeenCalled();const m=fixture({missing:'REMINDER_CRON_SECRET'});expect((await m.handler(m.request())).status).toBe(401)})
  it('rejects other HTTP methods',async()=>{const f=fixture();expect((await f.handler(new Request('https://example.test'))).status).toBe(405)})
  it('reports missing configuration without attempting email',async()=>{const f=fixture({missing:'RESEND_API_KEY'});expect((await f.handler(f.request())).status).toBe(503);expect(f.fetcher).not.toHaveBeenCalled()})
  it('preserves the idempotency key and completes the claimed delivery',async()=>{const f=fixture(),response=await f.handler(f.request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({sent:1,failed:0});const options=f.fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(options[1].headers).toMatchObject({'Idempotency-Key':delivery.key});const body=JSON.parse(String(options[1].body));expect(body.to).toEqual(delivery.recipients);expect(body.text).toContain('1,250.50');expect(f.rpc).toHaveBeenCalledWith('finish_reminder',expect.objectContaining({token:delivery.token,delivered:true,provider:'test-provider-id'}))})
  it('records provider rejection as a failure and returns a failing HTTP result',async()=>{const f=fixture({providerFailure:true});const response=await f.handler(f.request());expect(response.status).toBe(502);expect(f.rpc).toHaveBeenCalledWith('finish_reminder',expect.objectContaining({delivered:false,failure:'Email provider returned HTTP 503'}))})
  it('reports unconfirmed database completion rather than claiming success',async()=>{const f=fixture({finishFailure:true}),response=await f.handler(f.request());expect(response.status).toBe(502);expect(await response.json()).toMatchObject({sent:0,failed:1})})
  it('does not send when claiming fails or no reminders qualify',async()=>{const f=fixture({claimFailure:true});expect((await f.handler(f.request())).status).toBe(500);expect(f.fetcher).not.toHaveBeenCalled();const e=fixture({empty:true});expect(await (await e.handler(e.request())).json()).toEqual({claimed:0,sent:0,failed:0});expect(e.fetcher).not.toHaveBeenCalled()})
})
