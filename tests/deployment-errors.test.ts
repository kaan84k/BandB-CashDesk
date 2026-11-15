import { expect, it } from 'vitest'
// @ts-expect-error The workflow helper runs directly as JavaScript in Node.
import { redactDeploymentOutput, deploymentAnnotation } from '../scripts/supabase-command.mjs'

it('redacts configured secrets, connection strings and tokens from deployment errors', () => {
  const env = { SUPABASE_ACCESS_TOKEN: 'example-access-token', SUPABASE_DB_PASSWORD: 'example/p@ss', SUPABASE_PROJECT_REF: 'example-project' }
  const input = 'example-access-token example/p@ss example%2Fp%40ss example-project postgres://user:password@db:5432/postgres sb_secret_example sbp_example eyJabc.def.ghi ERROR: relation already exists'
  const output = redactDeploymentOutput(input, env)
  for (const secret of [...Object.values(env), 'example%2Fp%40ss', 'user:password', 'sb_secret_example', 'sbp_example', 'eyJabc.def.ghi']) expect(output).not.toContain(secret)
  expect(output).toContain('ERROR: relation already exists')
})

it('escapes multiline deployment errors as one GitHub annotation', () => {
  expect(deploymentAnnotation('Database', 'ERROR: 50%\r\n::warning::example')).toBe('::error::Database failed.%0AERROR: 50%25%0D%0A::warning::example')
})
