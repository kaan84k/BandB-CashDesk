import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { LayoutDashboard, BookOpen, ReceiptText, Landmark, Bell, ChartNoAxesCombined, Settings as SettingsIcon, Users, Menu, X, LogOut, RefreshCw, Info, Check, ArrowRight } from 'lucide-react'
import { useStore, supabase } from './lib/store'
import { formatDate, reminders, today, type CashDay, type Cheque, type Transaction } from './lib/domain'
import { EntryForm, ChequeStatusForm, type FormKind } from './components/EntryForm'
import { CashDayForm, TransferForm } from './components/CashForms'
import { Login, SetPassword, WorkspaceSetup, JoinCafe } from './components/Auth'
import { Modal, Money, Badge } from './components/ui'
import Dashboard from './pages/Dashboard'
import StaffEntry from './pages/StaffEntry'
const Team=lazy(()=>import('./pages/Team'))
const Ledger=lazy(()=>import('./pages/Ledger')),Accounts=lazy(()=>import('./pages/Accounts')),Cheques=lazy(()=>import('./pages/Cheques')),Reminders=lazy(()=>import('./pages/Reminders')),Reports=lazy(()=>import('./pages/Reports')),Settings=lazy(()=>import('./pages/Settings'))
export function Brand(){return <div className="brand"><img src="/favicon.svg" alt="" width="42" height="42"/><div><strong>Cashflow</strong><small>BUSINESS CASHBOOK</small></div></div>}
const navigation=[{to:'/',label:'Today',icon:LayoutDashboard},{to:'/transactions',label:'Cashbook',icon:BookOpen},{to:'/accounts',label:'Bank & safe',icon:Landmark},{to:'/cheques',label:'Cheques',icon:ReceiptText},{to:'/reminders',label:'Reminders',icon:Bell},{to:'/reports',label:'Reports',icon:ChartNoAxesCombined}]
export default function App(){
  const store=useStore(),{data,user,loading,error,demo,session,refresh,reset,notice,notify,workspaceSetup,branchAccessRequired,recovery,syncError,syncing,online,lastSyncedAt}=store
  const location=useLocation(),[mobile,setMobile]=useState(false),[form,setForm]=useState<FormKind|null>(null),[cheque,setCheque]=useState<Cheque|null>(null),[transaction,setTransaction]=useState<Transaction|null>(null)
  const [transfer,setTransfer]=useState<{destination?:'bank'|'safe'}|null>(null),[cashDay,setCashDay]=useState<{mode:'open'|'close';day?:CashDay}|null>(null)
  const title=navigation.find(n=>n.to===location.pathname)?.label??(location.pathname==='/entry'?'Data entry':location.pathname==='/team'?'Team & access':'Settings')
  useEffect(()=>{setMobile(false);window.scrollTo(0,0);document.title=`${title} · Cashflow`},[location.pathname,title])
  useEffect(()=>{setMobile(false);setForm(null);setCheque(null);setTransaction(null);setTransfer(null);setCashDay(null)},[user?.id,user?.role])
  if(loading)return <div className="loading-screen"><Brand/><RefreshCw size={22} className="spin"/><p>Opening your cashbook…</p></div>
  if(error)return <div className="loading-screen"><Brand/><h1>Let’s get you connected.</h1><p className="connection-error" role="alert">{error}</p><button className="button primary" onClick={()=>void refresh()}>Try again</button>{session&&<button className="button secondary" onClick={()=>void supabase?.auth.signOut()}>Sign out</button>}{demo&&<button className="button secondary" onClick={()=>{if(window.confirm('Replace this browser’s demo with sample business records?'))void reset()}}>Reset local demo</button>}</div>
  if(!demo&&!session)return <Login/>
  if(!demo&&session&&recovery)return <SetPassword/>
  if(store.invitations.length)return <JoinCafe/>
  if(store.entryData?.role==='staff')return <StaffEntry/>
  if(store.accessRemoved)return <div className="loading-screen"><Brand/><h1>Your access has been removed.</h1><p>Your business owner removed this account’s access. Ask them for a new invitation to restore access.</p><button className="button primary" onClick={()=>void refresh()}>Refresh access</button><button className="button secondary" onClick={()=>void supabase?.auth.signOut()}>Sign out</button></div>
  if(workspaceSetup)return <WorkspaceSetup/>
  if(!data||!user)return <div className="loading-screen"><Brand/><h1>Your business needs access.</h1><p>{branchAccessRequired?'Ask the owner to grant access to the business.':'Ask your business owner to invite you.'}</p><button className="button primary" onClick={()=>void refresh()}>Refresh access</button><button className="button secondary" onClick={()=>void supabase?.auth.signOut()}>Sign out</button></div>
  const count=reminders({...data,cheques:data.cheques.filter(c=>c.branchId===data.branches[0].id)}).length
  const actions={onAdd:setForm,onCheque:setCheque,onTransaction:setTransaction,onTransfer:(destination?:'bank'|'safe')=>setTransfer({destination}),onDay:(mode:'open'|'close',day?:CashDay)=>setCashDay({mode,day})}
  const detailTransfer=data.transfers.find(t=>t.id===transaction?.transferId)
  return <div className="app-shell cafe-shell">
    {mobile&&<button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setMobile(false)}/>}
    <aside className={`sidebar ${mobile?'is-open':''}`}><Link className="brand-link" to="/"><Brand/></Link><button className="sidebar-mobile-close icon-button" aria-label="Close navigation" onClick={()=>setMobile(false)}><X size={20}/></button><div className="nav-section-label">YOUR BUSINESS</div><nav aria-label="Main navigation">{navigation.map(n=><NavLink key={n.to} to={n.to} end={n.to==='/'} className={({isActive})=>`nav-item ${isActive?'active':''}`}><n.icon size={20} strokeWidth={1.7}/><span>{n.label}</span>{n.to==='/reminders'&&count>0&&<span className="nav-count">{count}</span>}</NavLink>)}</nav><div className="cafe-sidebar-footer">{user.role==='owner'&&<NavLink to="/team" className={({isActive})=>`nav-item ${isActive?'active':''}`}><Users size={19}/>Team & access</NavLink>}<NavLink to="/settings" className={({isActive})=>`nav-item ${isActive?'active':''}`}><SettingsIcon size={19}/>Settings & backup</NavLink><div className="cafe-profile"><span className="user-avatar">{user.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><div><strong>{user.name}</strong><small>{demo?'Demo records':user.email}</small></div>{!demo&&<button className="icon-button" aria-label="Sign out" onClick={()=>void supabase!.auth.signOut()}><LogOut size={17}/></button>}</div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={21}/></button><strong>{title}</strong>{demo&&<span className="demo-pill"><span/>Sample records</span>}</div><div className="topbar-actions"><span className="cafe-top-date">{formatDate(today(),{day:'numeric',month:'short',year:'numeric'})}</span><Link className="icon-button notification-button" to="/reminders" aria-label={`${count} cheque reminders`}><Bell size={20}/>{count>0&&<i/>}</Link></div></header>
    <main id="main-content">
      {!demo&&(!online||syncError)&&<div className="connection-banner" role="alert"><Info size={19}/><div><strong>{!online?'You’re offline. Records are read-only.':'Your connection needs a refresh.'}</strong><p>{syncError||'Reconnect before saving. Your open form is kept.'}</p>{lastSyncedAt&&<small>Last synced {new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',hour:'2-digit',minute:'2-digit'}).format(new Date(lastSyncedAt))}</small>}</div><button className="button secondary small" disabled={syncing||!online} onClick={()=>void refresh()}>{syncing?'Refreshing…':'Retry connection'}</button></div>}
      <Suspense fallback={<div className="route-loading"><RefreshCw size={20} className="spin"/>Opening…</div>}><Routes><Route path="/" element={<Dashboard {...actions}/>}/><Route path="/transactions" element={<Ledger {...actions}/>}/><Route path="/accounts" element={<Accounts {...actions}/>}/><Route path="/cheques" element={<Cheques {...actions}/>}/><Route path="/reminders" element={<Reminders {...actions}/>}/><Route path="/reports" element={<Reports/>}/><Route path="/team" element={user.role==='owner'?<Team/>:<Navigate to="/" replace/>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></Suspense>
      <footer className="page-footer"><span>Cashflow · Simple business cashbook</span><span>All amounts in LKR · Sri Lanka time</span></footer>
    </main></div>
    {form&&<EntryForm key={form} kind={form} onClose={()=>setForm(null)}/>}
    {transfer&&<TransferForm destination={transfer.destination} onClose={()=>setTransfer(null)}/>}
    {cashDay&&<CashDayForm mode={cashDay.mode} day={cashDay.day} onClose={()=>setCashDay(null)}/>}
    {cheque&&<ChequeStatusForm key={cheque.id} cheque={data.cheques.find(c=>c.id===cheque.id)??cheque} onClose={()=>setCheque(null)}/>}
    {transaction&&<Modal open title={detailTransfer?'Money transfer':transaction.cashDayId?'Cash count':'Cashbook entry'} description={transaction.description} onClose={()=>setTransaction(null)}><div className="entry-form"><div className="cheque-summary"><h2><Money value={transaction.amount}/></h2><Badge>{detailTransfer?'Transfer':transaction.cashDayId?'Cash count':transaction.type}</Badge></div><div className="detail-grid"><div><small>Date</small><strong>{formatDate(transaction.date,{day:'numeric',month:'long',year:'numeric'})}</strong></div><div><small>{detailTransfer?'From':'Account'}</small><strong>{data.accounts.find(a=>a.id===transaction.accountId)?.name}</strong></div>{detailTransfer&&<div><small>To</small><strong>{data.accounts.find(a=>a.id===detailTransfer.toAccountId)?.name}</strong></div>}</div><p className="form-note">{detailTransfer?'Moving money does not count as sales or expenses.':'Saved entries stay in your cashbook. Record a correction as a new entry with a note.'}</p><button className="button secondary" onClick={()=>setTransaction(null)}>Close</button></div></Modal>}
    {notice&&<div className="toast" role="status"><Check size={17}/>{notice}<button aria-label="Dismiss notification" onClick={()=>notify('')}><X size={15}/></button></div>}
  </div>
}
