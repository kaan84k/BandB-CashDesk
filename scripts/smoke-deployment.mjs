import { pathToFileURL } from 'node:url'

export async function checkDeployment(target, { allowDemo = false } = {}) {
  const origin = new URL(target)
  if (origin.username || origin.password || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Use the public HTTPS app URL.')
  const get = async path => {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20000), redirect: 'follow', cache: 'no-store' })
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}. Check Vercel deployment protection, build status, and routing.`)
    return response
  }
  const metadataResponse = await get('/health.json')
  if (!metadataResponse.headers.get('content-type')?.includes('json')) throw new Error('The deployment does not serve health.json. Deploy the latest build and check SPA routing.')
  const metadata = await metadataResponse.json()
  if (metadata.app !== 'bb-cashdesk' || !metadata.buildId) throw new Error('The URL is not serving a current CashDesk build.')
  if (metadata.mode !== 'connected' && !allowDemo) throw new Error('This deployment is running the local demo. Configure the public Supabase settings in Vercel and redeploy.')
  for (const path of ['/', '/cheques', '/transactions', '/reports', '/entry', '/team']) {
    const response = await get(path), html = await response.text()
    if (!response.headers.get('content-type')?.includes('text/html') || !html.includes('id="root"')) throw new Error(`${path} is not serving the application document.`)
    if (path === '/') {
      const script = html.match(/<script[^>]+src="([^"]+)"/)
      if (!script) throw new Error('No application script found.')
      const url = new URL(script[1], origin)
      if (url.origin !== origin.origin) throw new Error('Unexpected external application script.')
      const asset = await get(url.pathname)
      if (!/javascript/.test(asset.headers.get('content-type') ?? '')) throw new Error('The application script is being rewritten to HTML.')
    }
  }
  const workerResponse = await get('/sw.js'), worker = await workerResponse.text()
  if (!/javascript/.test(workerResponse.headers.get('content-type') ?? '') || !worker.includes(metadata.buildId) || worker.includes('__CASHDESK_BUILD_ID__')) throw new Error('The service worker does not match the deployed build.')
  const manifest = await (await get('/manifest.webmanifest')).json()
  for (const icon of manifest.icons ?? []) {
    const response = await get(icon.src)
    if (!response.headers.get('content-type')?.includes('image/')) throw new Error('An installation icon is being rewritten to HTML.')
  }
  return { mode: metadata.mode, revision: metadata.revision, buildId: metadata.buildId, requiredSchemaVersion: metadata.requiredSchemaVersion }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] ?? process.env.CASHDESK_APP_URL
  if (!target) { console.error('Usage: npm run smoke:deployment -- https://your-app.vercel.app'); process.exitCode = 1 }
  else {
    try { console.log('Deployment assets verified:', await checkDeployment(target, { allowDemo: process.env.CASHDESK_ALLOW_DEMO_SMOKE === 'true' })) }
    catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
