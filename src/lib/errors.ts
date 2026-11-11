export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return 'The request could not be completed. Please try again.'
}

export function connectionMessage(error: unknown): string {
  const message = messageOf(error)
  const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
  if (code === 'PGRST202' || code === 'PGRST205' || /could not find.*(function|table)|schema cache/i.test(message)) return 'The Supabase database needs the Cashflow migrations. Apply the pending files in supabase/migrations, then try again.'
  if (/invalid api key|invalid jwt|jwt expired/i.test(message)) return 'Supabase could not authorise the connection. Check the public project settings or sign in again.'
  if (/fetch|network|offline|timeout|timed out|abort/i.test(message)) return 'The connection was interrupted. Check your internet connection, then try again.'
  return message
}
