import { afterEach, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from '../src/lib/network'
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
it('times out a hanging connection and clears its timer',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn((_input:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason)))))
  const request=expect(fetchWithTimeout('https://example.test',{},1000)).rejects.toMatchObject({name:'TimeoutError'})
  await vi.advanceTimersByTimeAsync(1000);await request;expect(vi.getTimerCount()).toBe(0)
})
it('preserves caller cancellation and cleans up successful requests',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>new Response('OK')));expect((await fetchWithTimeout('https://example.test')).status).toBe(200);expect(vi.getTimerCount()).toBe(0)
  const controller=new AbortController();vi.stubGlobal('fetch',vi.fn((_input:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{if(init.signal!.aborted)reject(init.signal!.reason);else init.signal!.addEventListener('abort',()=>reject(init.signal!.reason))})))
  const result=expect(fetchWithTimeout('https://example.test',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});controller.abort();await result;expect(vi.getTimerCount()).toBe(0)
})
