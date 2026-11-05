import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/dm-serif-display/400.css'
import './styles.css'
import App from './App'
import { StoreProvider } from './lib/store'

class ErrorBoundary extends Component<{children:ReactNode},{error:Error|null}>{
  state:{error:Error|null}={error:null}
  static getDerivedStateFromError(error:Error){return {error}}
  render(){if(this.state.error)return <div className="loading-screen"><h1>CashDesk couldn’t open this view.</h1><p>Your saved records have not been removed. Reload to try again.</p><button className="button primary" onClick={()=>location.reload()}>Reload CashDesk</button></div>;return this.props.children}
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><BrowserRouter><StoreProvider><App/></StoreProvider></BrowserRouter></ErrorBoundary></StrictMode>)
if(import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{/* App remains usable if browser policy blocks offline caching. */})})
