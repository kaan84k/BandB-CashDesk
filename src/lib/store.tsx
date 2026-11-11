import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import { applyCommand, validateSnapshot, type Command, type Snapshot } from './domain'
import { createDemo, DEMO_USER } from './seed'
import { connectionMessage, messageOf } from './errors'
import { fetchWithTimeout } from './network'
import { canReadFinance, entryContextSchema, type EntryContext, type PendingInvitation } from './access'

export const clientConfig = __CASHDESK_CONFIG__
export const configError = clientConfig.error
const initialLinkType = new URLSearchParams(window.location.hash.slice(1)).get('type')
export const supabase = clientConfig.mode === 'connected'
  ? createClient(clientConfig.url, clientConfig.key, { global: { fetch: fetchWithTimeout } })
  : null
export const STORAGE_KEY = 'bb-cashdesk-demo-v1'
type Member = Snapshot['members'][number]
type Setup = { name: string; companyName: string; branchName: string; location: string; bankName:string; bankOpening:number; safeOpening:number }
type Store = {
  data: Snapshot | null; entryData:EntryContext|null; invitations:PendingInvitation[]; user: Member | null; session: Session | null
  loading: boolean; error: string; busy: boolean; syncError: string; syncing: boolean
  online: boolean; lastSyncedAt: string | null; workspaceSetup: boolean; branchAccessRequired: boolean; accessRemoved:boolean
  recovery: boolean; setRecovery: (value: boolean) => void
  branch: string; setBranch: (id: string) => void; demo: boolean
  execute: (command: Command) => Promise<boolean>; refresh: () => Promise<boolean>
  setupWorkspace: (fields: Setup) => Promise<void>
  restore: (input: unknown) => Promise<void>; reset: () => Promise<void>
  notice: string; notify: (message: string) => void
}
const Context = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Snapshot | null>(null)
  const [entryData,setEntryData]=useState<EntryContext|null>(null)
  const [invitations,setInvitations]=useState<PendingInvitation[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [workspaceSetup, setWorkspaceSetup] = useState(false)
  const [branchAccessRequired, setBranchAccessRequired] = useState(false)
  const [accessRemoved,setAccessRemoved]=useState(false)
  const [recovery, setRecovery] = useState(initialLinkType === 'recovery' || initialLinkType === 'invite')
  const [branch, setBranch] = useState('all')
  const [notice, setNotice] = useState('')
  const dataRef = useRef<Snapshot | null>(null)
  const entryRef=useRef<EntryContext|null>(null)
  const sessionUser = useRef<string | null>(null)
  const generation = useRef(0)
  const healthy = useRef(false)
  const mutationLock = useRef(false)
  const notify = useCallback((message: string) => setNotice(message), [])
  const replaceData = useCallback((next: Snapshot | null) => { dataRef.current = next; setData(next) }, [])

  const replaceEntry=useCallback((next:EntryContext|null)=>{entryRef.current=next;setEntryData(next)},[])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const refresh = useCallback(async (): Promise<boolean> => {
    const ticket = ++generation.current
    const current = () => ticket === generation.current
    setSyncing(true)
    try {
      if (configError) throw new Error(configError)
      if (supabase) {
        if (!healthy.current) {
          const { data: health, error: healthError } = await supabase.rpc('cashdesk_health')
          if (healthError) throw healthError
          if (!health || health.app !== 'bb-cashdesk' || !Number.isInteger(health.schemaVersion) || health.schemaVersion < clientConfig.requiredSchemaVersion) throw new Error('The Supabase database needs the latest Cashflow migrations. Apply the pending migrations, then try again.')
          healthy.current = true
        }
        const { data: auth, error: authError } = await supabase.auth.getSession()
        if (authError) throw authError
        if (!current()) return false
        const uid = auth.session?.user.id ?? null
        if (sessionUser.current !== uid) { replaceData(null); replaceEntry(null); setInvitations([]); setBranch('all') }
        sessionUser.current = uid
        setSession(auth.session)
        if (!auth.session) {
          replaceData(null); replaceEntry(null); setInvitations([]); setWorkspaceSetup(false); setBranchAccessRequired(false); setAccessRemoved(false)
          setError(''); setSyncError(''); return true
        }
        const { data: state, error: stateError } = await supabase.rpc('cashdesk_workspace_state')
        if (stateError) throw stateError
        if (!current()) return false
        setInvitations(state?.status==='invitation_pending'?state.invitations:[])
        setAccessRemoved(state?.status==='access_removed')
        setWorkspaceSetup(state?.status === 'setup_required')
        setBranchAccessRequired(state?.status === 'branch_access_required')
        if (state?.status !== 'ready') {
          replaceData(null); replaceEntry(null); setError(''); setSyncError(''); return true
        }
        if(state.role==='staff'){
          replaceData(null)
          const {data:entry,error:entryError}=await supabase.rpc('cashdesk_entry_context')
          if(entryError)throw entryError
          if(!current())return false
          replaceEntry(entryContextSchema.parse(entry));setWorkspaceSetup(false);setError('');setSyncError('');setLastSyncedAt(new Date().toISOString());return true
        }
        replaceEntry(null)
        if(!canReadFinance(state.role)){replaceData(null);throw new Error('Your workspace role is not recognised. Ask the owner to review your access.')}
        const { data: raw, error: readError } = await supabase.rpc('cashdesk_snapshot')
        if (readError) throw readError
        const next = validateSnapshot(raw)
        if (!current()) return false
        replaceData(next)
        setBranch(selected => selected === 'all' || next.branches.some(b => b.id === selected) ? selected : 'all')
      } else {
        const raw = localStorage.getItem(STORAGE_KEY)
        const next = raw ? validateSnapshot(JSON.parse(raw)) : createDemo()
        if (!raw) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        if (!current()) return false
        replaceData(next)
      }
      setError(''); setSyncError(''); setLastSyncedAt(new Date().toISOString())
      return true
    } catch (failure) {
      if (current()) {
        const message = connectionMessage(failure)
        if (dataRef.current||entryRef.current) setSyncError(message)
        else setError(message)
      }
      return false
    } finally {
      if (current()) { setLoading(false); setSyncing(false) }
    }
  }, [replaceData,replaceEntry])

  useEffect(() => {
    void refresh()
    const { data: subscription } = supabase?.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if ((next?.user.id ?? null) !== sessionUser.current) {
        ++generation.current
        sessionUser.current = next?.user.id ?? null
        replaceData(null); replaceEntry(null); setInvitations([]); setBranch('all'); setWorkspaceSetup(false); setBranchAccessRequired(false); setAccessRemoved(false)
      }
      setSession(next)
      // Supabase auth callbacks must not await other SDK methods while its lock is held.
      setTimeout(() => void refresh(), 0)
    }) ?? { data: undefined }
    const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) void refresh() }
    const reconnect = () => { setOnline(navigator.onLine); if (navigator.onLine) void refresh() }
    const visible = () => { if (!document.hidden) void refresh() }
    window.addEventListener('storage', storage)
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', reconnect)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    const timer = supabase ? setInterval(visible, 30000) : undefined
    return () => {
      ++generation.current
      subscription?.subscription.unsubscribe()
      window.removeEventListener('storage', storage)
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', reconnect)
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
      clearInterval(timer)
    }
  }, [refresh, replaceData,replaceEntry])

  const user = entryData?.user ?? data?.members.find(m => m.id === (supabase ? session?.user.id : DEMO_USER.id)) ?? null
  const execute = async (command: Command): Promise<boolean> => {
    if ((!data&&!entryData) || !user) throw new Error('No authorised workspace membership. Ask your owner to provision access.')
    if (mutationLock.current) throw new Error('A save is already in progress. Please wait.')
    if (supabase && (!navigator.onLine || syncError)) throw new Error('Refresh the connection before saving. Your form has been kept open.')
    mutationLock.current = true; setBusy(true)
    try {
      if (supabase) {
        const requestId = command.requestId ?? (command.type.startsWith('add') ? command.payload.id : crypto.randomUUID())
        const { error: writeError } = await supabase.rpc('cashdesk_mutate', { command: { ...command, requestId } })
        if(writeError&&(writeError.code==='42501'||/Workspace membership required/.test(writeError.message)))await refresh()
        if (writeError) throw new Error(/fetch|network|timeout|timed out|abort/i.test(messageOf(writeError))
          ? 'The save could not be confirmed. Your form is kept open; retrying the same save will not record it twice.'
          : connectionMessage(writeError))
        // The write is confirmed. A later refresh failure must never be reported as a failed save.
        return await refresh()
      }
      const raw = localStorage.getItem(STORAGE_KEY)
      const latest = raw ? validateSnapshot(JSON.parse(raw)) : data
      if(!latest)throw new Error('Business records are not loaded')
      const actor = latest.members.find(m => m.id === user.id)
      if (!actor) throw new Error('Your membership no longer exists')
      const next = applyCommand(latest, command, actor)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); replaceData(next)
      return true
    } finally { mutationLock.current = false; setBusy(false) }
  }
  const setupWorkspace = async (fields: Setup) => {
    if (!supabase || !session) throw new Error('Sign in before creating a workspace')
    setBusy(true)
    try {
      const { error: setupError } = await supabase.rpc('cashdesk_create_workspace', { profile_name: fields.name, company_name: fields.companyName, branch_name: fields.branchName, branch_location: fields.location, bank_name:fields.bankName, bank_opening:fields.bankOpening, safe_opening:fields.safeOpening })
      if (setupError) throw new Error(messageOf(setupError))
      if (!await refresh()) throw new Error('Your workspace was created, but could not be reloaded. Reconnect and try again.')
    } finally { setBusy(false) }
  }
  const restore = async (input: unknown) => {
    if (supabase) throw new Error('Restore production backups through the database administrator')
    const next = validateSnapshot(input)
    if (!next.members.some(m => m.id === DEMO_USER.id && m.role === 'owner')) throw new Error('Backup must retain the demo owner')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); replaceData(next)
    setError(''); setSyncError(''); setBranch('all')
  }
  const reset = async () => {
    if (supabase) throw new Error('Demo reset is unavailable in a connected workspace')
    await restore(createDemo())
  }
  return <Context.Provider value={{ data, entryData, invitations, user, session, loading, error, busy, syncError, syncing, online, lastSyncedAt, workspaceSetup, branchAccessRequired, accessRemoved, recovery, setRecovery, branch, setBranch, demo: clientConfig.mode === 'demo', execute, refresh, setupWorkspace, restore, reset, notice, notify }}>{children}</Context.Provider>
}
export function useStore() { const s = useContext(Context); if (!s) throw new Error('Missing store provider'); return s }
export function useScope() {
  const s = useStore()
  if (!s.data) throw new Error('Workspace is not loaded')
  const d = s.data
  const cafe = s.branch === 'all' ? d.branches[0].id : s.branch
  const within = (item: { branchId: string }) => item.branchId === cafe
  return { ...d, accounts: d.accounts.filter(within), transactions: d.transactions.filter(within), cheques: d.cheques.filter(within), suppliers: d.suppliers.filter(within), invoices: d.invoices.filter(within), transfers:d.transfers.filter(within), cashDays:d.cashDays.filter(within) }
}
