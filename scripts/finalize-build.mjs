import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { loadEnv } from 'vite'
import { resolvePublicConfig, REQUIRED_SCHEMA_VERSION } from '../src/lib/config.ts'

const config = resolvePublicConfig({ ...loadEnv('production', process.cwd(), ''), ...process.env })
if (config.error) throw new Error(config.error)
const assets = (await readdir('dist/assets')).sort()
const workerTemplate = await readFile('public/sw.js', 'utf8')
const buildId = createHash('sha256').update(assets.join('\n')).update(workerTemplate).digest('hex').slice(0, 16)
const html = await readFile('dist/index.html', 'utf8')
const precache = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1])
const worker = workerTemplate.replaceAll('__CASHDESK_BUILD_ID__', buildId).replace('__CASHDESK_PRECACHE__', JSON.stringify(precache))
await writeFile('dist/sw.js', worker)
let revision = process.env.VERCEL_GIT_COMMIT_SHA ?? null
if (!revision) { try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch {} }
const metadata = { app: 'bb-cashdesk', buildId, revision, builtAt: new Date().toISOString(), mode: config.mode, requiredSchemaVersion: REQUIRED_SCHEMA_VERSION }
await writeFile('dist/health.json', JSON.stringify(metadata, null, 2) + '\n')
console.log(`CashDesk build ${buildId}: ${config.mode}; requires database schema ${REQUIRED_SCHEMA_VERSION}.`)
