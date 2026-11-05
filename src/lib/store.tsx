import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { applyCommand, validateSnapshot, type Command, type Snapshot } from './domain'
import { createDemo, DEMO_USER } from './seed'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export let configError = Boolean(url) !== Boolean(key) ? 'Set both Supabase environment variables, or leave both blank to use the demo.' : ''
export let supabase:SupabaseClient|null = null
if(url&&key){try{supabase=createClient(url,key)}catch{configError='The configured Supabase URL is invalid. Check the public client configuration and rebuild.'}}
export const STORAGE_KEY = 'bb-cashdesk-demo-v1'
type Member = Snapshot['members'][number]
type Store = {
  data: Snapshot | null; user: Member | null; session: Session | null; loading: boolean; error: string; busy: boolean;
  branch: string; setBranch: (id:string)=>void; demo: boolean;
  execute: (command:Command)=>Promise<void>; refresh: ()=>Promise<void>;
  restore: (input:unknown)=>Promise<void>; reset: ()=>Promise<void>;
  notice: string; notify: (message:string)=>void;
}
const Context = createContext<Store | null>(null)
export function StoreProvider({children}:{children:ReactNode}) {
  const [data,setData]=useState<Snapshot|null>(null)
  const [session,setSession]=useState<Session|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [branch,setBranch]=useState('all')
  const [notice,setNotice]=useState('')
  const notify=useCallback((message:string)=>setNotice(message),[])
  useEffect(()=>{ if(notice) {const t=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(t)} },[notice])
  const refresh=useCallback(async()=>{
    setError('')
    try {
      if (configError) throw new Error(configError)
      if (supabase) {
        const {data:auth,error:authError}=await supabase.auth.getSession()
        if(authError) throw authError
        setSession(auth.session)
        if(!auth.session) {setData(null);return}
        const {data:raw,error:readError}=await supabase.rpc('cashdesk_snapshot')
        if(readError) throw readError
        setData(validateSnapshot(raw))
      } else {
        const raw=localStorage.getItem(STORAGE_KEY)
        const next=raw?validateSnapshot(JSON.parse(raw)):createDemo()
        if(!raw) localStorage.setItem(STORAGE_KEY,JSON.stringify(next))
        setData(next)
      }
    } catch(e) {setError(e instanceof Error?e.message:'Could not load CashDesk')} finally {setLoading(false)}
  },[])
  useEffect(()=>{
    void refresh()
    const {data:subscription}=supabase?.auth.onAuthStateChange((_event,s)=>{setSession(s);setTimeout(()=>void refresh(),0)}) ?? {data:undefined}
    const onStorage=(e:StorageEvent)=>{if(e.key===STORAGE_KEY)void refresh()}
    window.addEventListener('storage',onStorage)
    const timer=supabase?setInterval(()=>{if(!document.hidden) void refresh()},30000):undefined
    return()=>{subscription?.subscription.unsubscribe();window.removeEventListener('storage',onStorage);clearInterval(timer)}
  },[refresh])
  const user=data?.members.find(m=>m.id===(supabase?session?.user.id:DEMO_USER.id))??null
  const execute=async(command:Command)=>{
    if(!data||!user) throw new Error('No authorised workspace membership. Ask your owner to provision access.')
    setBusy(true)
    try {
      if(supabase) {
        const {error:writeError}=await supabase.rpc('cashdesk_mutate',{command})
        if(writeError) throw writeError
        await refresh()
      } else {
        const raw=localStorage.getItem(STORAGE_KEY)
        const latest=raw?validateSnapshot(JSON.parse(raw)):data
        const actor=latest.members.find(m=>m.id===user.id)
        if(!actor)throw new Error('Your membership no longer exists')
        const next=applyCommand(latest,command,actor)
        localStorage.setItem(STORAGE_KEY,JSON.stringify(next));setData(next)
      }
    } finally {setBusy(false)}
  }
  const restore=async(input:unknown)=>{
    if(supabase)throw new Error('Restore production backups through the database administrator')
    const next=validateSnapshot(input)
    if(!next.members.some(m=>m.id===DEMO_USER.id&&m.role==='owner'))throw new Error('Backup must retain the demo owner')
    localStorage.setItem(STORAGE_KEY,JSON.stringify(next));setData(next);setError('');setBranch('all')
  }
  const reset=async()=>{if(supabase)throw new Error('Demo reset is unavailable in a connected workspace');await restore(createDemo())}
  return <Context.Provider value={{data,user,session,loading,error,busy,branch,setBranch,demo:!supabase,execute,refresh,restore,reset,notice,notify}}>{children}</Context.Provider>
}
export function useStore(){const s=useContext(Context);if(!s)throw new Error('Missing store provider');return s}
export function useScope(){const s=useStore();if(!s.data)throw new Error('Workspace is not loaded');const d=s.data;const within=(item:{branchId:string})=>s.branch==='all'||item.branchId===s.branch;return {...d,accounts:d.accounts.filter(within),transactions:d.transactions.filter(within),cheques:d.cheques.filter(within),suppliers:d.suppliers.filter(within),invoices:d.invoices.filter(within)}}
