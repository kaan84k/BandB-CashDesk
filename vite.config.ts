import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolvePublicConfig } from './src/lib/config'

export default defineConfig(({mode, command}) => {
  const config = resolvePublicConfig({ ...loadEnv(mode, process.cwd(), ''), ...process.env })
  if (command === 'build' && config.error) throw new Error(config.error)
  return {
    plugins: [react(), tailwindcss()],
    define: { __CASHDESK_CONFIG__: JSON.stringify(config) },
    test: { include: ['tests/**/*.test.ts'] },
    build: { chunkSizeWarningLimit: 650 },
  }
})
