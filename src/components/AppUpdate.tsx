import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

export function AppUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [chunkChanged, setChunkChanged] = useState(false)
  const [reloading, setReloading] = useState(false)
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    let active = true
    let stopWatching = () => {}
    const check = (candidate: ServiceWorkerRegistration) => {
      if (candidate.waiting && navigator.serviceWorker.controller && active) setRegistration(candidate)
    }
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(candidate => {
      if (!active) return
      check(candidate)
      const found = () => {
        const installing = candidate.installing
        installing?.addEventListener('statechange', () => { if (installing.state === 'installed') check(candidate) })
      }
      candidate.addEventListener('updatefound', found)
      stopWatching = () => candidate.removeEventListener('updatefound', found)
      void candidate.update().catch(() => {})
    }).catch(() => {})
    const staleChunk = (event: Event) => { event.preventDefault(); setChunkChanged(true) }
    window.addEventListener('vite:preloadError', staleChunk)
    return () => { active = false; stopWatching(); window.removeEventListener('vite:preloadError', staleChunk) }
  }, [])
  if (!registration && !chunkChanged) return null
  const reload = () => {
    setReloading(true)
    if (!registration?.waiting) { window.location.reload(); return }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  }
  return <div className="app-update" role="status"><div><strong>A newer CashDesk is ready.</strong><span>Finish your current entry, then reload to update.</span></div><button className="button secondary small" disabled={reloading} onClick={reload}><RefreshCw size={14}/>{reloading ? 'Updating…' : 'Reload app'}</button></div>
}
