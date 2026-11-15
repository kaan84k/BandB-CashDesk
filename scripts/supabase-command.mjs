import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function redactDeploymentOutput(value, env = process.env) {
  let text = String(value).replace(/\u001b\[[0-9;]*m/g, '')
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF']) {
    const secret = env[name]
    if (!secret) continue
    for (const form of new Set([secret, encodeURIComponent(secret)])) text = text.replaceAll(form, '[redacted]')
  }
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted database URL]')
    .replace(/\b(?:sb_secret_|sbp_)[A-Za-z0-9_-]+/g, '[redacted token]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted JWT]')
}

export function deploymentAnnotation(stage, detail) {
  const escape = text => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  return `::error::${escape(stage + ' failed.\n' + detail)}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stage, executable, ...args] = process.argv.slice(2)
  if (!stage || executable !== 'supabase') throw new Error('Usage: node scripts/supabase-command.mjs <stage> supabase <arguments>')
  const result = spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const output = redactDeploymentOutput([result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n'))
  // Prevent CLI text from being interpreted as additional workflow commands.
  if (output) console.log(output.replace(/^::/gm, ' ::'))
  if (result.status !== 0) {
    const detail = output.trim().split('\n').filter(line => line.trim()).slice(-25).join('\n').slice(-12000)
    console.log(deploymentAnnotation(stage, detail || 'The Supabase CLI did not return an error message.'))
    process.exitCode = result.status || 1
  }
}
