export const REQUIRED_SCHEMA_VERSION = 5

export type PublicConfig = {
  mode: 'connected' | 'demo' | 'error'
  url: string
  key: string
  error: string
  requiredSchemaVersion: number
}

/** Only these explicitly public settings may enter the browser bundle. */
export function resolvePublicConfig(env: Record<string, string | undefined>): PublicConfig {
  const result: PublicConfig = { mode: 'demo', url: '', key: '', error: '', requiredSchemaVersion: REQUIRED_SCHEMA_VERSION }
  const fail = (message: string): PublicConfig => ({ ...result, mode: 'error', error: message })
  if (env.VITE_CASHDESK_DEMO === 'true') return result
  const pick = (names: string[]) => names.map(name => env[name]?.trim()).find(Boolean) ?? ''
  const url = pick(['VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'SUPABASE_URL'])
  const key = pick([
    'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY',
  ])
  if (!url && !key) {
    return env.VERCEL === '1' || env.VITE_CASHDESK_REQUIRE_SUPABASE === 'true'
      ? fail('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the Vercel project, then redeploy. For an intentional demonstration only, set VITE_CASHDESK_DEMO=true.')
      : result
  }
  if (!url || !key) return fail('Both the Supabase project URL and its public publishable/anon key are required. Check the Vercel environment variables and redeploy.')
  let parsed: URL
  try {
    parsed = new URL(url)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname) || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))) throw new Error()
  } catch { return fail('The Supabase URL must be the HTTPS project URL, without a password, path, or query string.') }
  if (!key.startsWith('sb_publishable_')) {
    try {
      const parts = key.split('.')
      if (parts.length !== 3) throw new Error()
      const claims = JSON.parse(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/')))
      if (claims.role !== 'anon') throw new Error()
      if (parsed.hostname.endsWith('.supabase.co') && claims.ref && claims.ref !== parsed.hostname.split('.')[0]) return fail('The public Supabase key belongs to a different project. Use the URL and public key from the same project.')
    } catch { return fail('Use a Supabase publishable key or legacy anon key. Secret, service-role, and user-session keys must never be used in the frontend.') }
  } else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return fail('The Supabase publishable key has an invalid format.')
  return { ...result, mode: 'connected', url: parsed.origin, key }
}
