import { describe, expect, it } from 'vitest'
import { resolvePublicConfig } from '../src/lib/config'

const url='https://cashdesk-test.supabase.co', key='sb_publishable_test_public_key'
const jwt=(role:string,ref='cashdesk-test')=>['header',Buffer.from(JSON.stringify({role,ref})).toString('base64url'),'signature'].join('.')
describe('Vercel and Supabase public configuration',()=>{
  it('keeps local development usable without credentials',()=>expect(resolvePublicConfig({}).mode).toBe('demo'))
  it('rejects silent demo fallback on Vercel',()=>{const result=resolvePublicConfig({VERCEL:'1'});expect(result.mode).toBe('error');expect(result.error).toContain('redeploy')})
  it('allows an explicitly labelled deployment demo',()=>expect(resolvePublicConfig({VERCEL:'1',VITE_CASHDESK_DEMO:'true'}).mode).toBe('demo'))
  it('accepts the app settings and the Vercel integration aliases',()=>{
    for(const env of [{VITE_SUPABASE_URL:url,VITE_SUPABASE_PUBLISHABLE_KEY:key},{NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:jwt('anon')},{SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:key},{VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:jwt('anon')}])expect(resolvePublicConfig(env)).toMatchObject({mode:'connected',url,error:''})
  })
  it('never treats a service-role binding as a public fallback',()=>{const result=resolvePublicConfig({SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:jwt('service_role')});expect(result.mode).toBe('error');expect(result.key).toBe('')})
  it.each(['sb_secret_test_private_value',jwt('service_role'),jwt('authenticated'),'not-a-key'])('rejects a non-public frontend key without echoing it',value=>{const result=resolvePublicConfig({VITE_SUPABASE_URL:url,VITE_SUPABASE_PUBLISHABLE_KEY:value});expect(result.mode).toBe('error');expect(JSON.stringify(result)).not.toContain(value)})
  it('rejects mismatched project keys',()=>expect(resolvePublicConfig({VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:jwt('anon','other-project')}).error).toContain('different project'))
  it.each(['http://public.example.com','https://user:password@cashdesk-test.supabase.co','https://cashdesk-test.supabase.co/rest/v1','https://cashdesk-test.supabase.co/?key=secret'])('rejects invalid project URL %s',value=>expect(resolvePublicConfig({VITE_SUPABASE_URL:value,VITE_SUPABASE_PUBLISHABLE_KEY:key}).mode).toBe('error'))
  it('allows a local Supabase development URL',()=>expect(resolvePublicConfig({VITE_SUPABASE_URL:'http://127.0.0.1:54321',VITE_SUPABASE_PUBLISHABLE_KEY:key}).mode).toBe('connected'))
  it('requires both public settings',()=>expect(resolvePublicConfig({VITE_SUPABASE_URL:url}).mode).toBe('error'))
})
