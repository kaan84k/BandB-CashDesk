import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:true,timeout:30000,
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',timezoneId:'Asia/Colombo',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH??(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}},
  projects:[
    {name:'desktop',testMatch:'workflows.spec.ts',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},
    {name:'mobile',testMatch:'workflows.spec.ts',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},
    {name:'connected',testMatch:'connected.spec.ts',use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:4175'}},
    {name:'connected-mobile',testMatch:'connected.spec.ts',use:{...devices['iPhone 13'],defaultBrowserType:'chromium',baseURL:'http://127.0.0.1:4175'}},
  ],
  webServer:[
    {command:'npm run preview -- --port 4173 --strictPort',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI},
    {command:'npm run dev -- --port 4175 --strictPort',url:'http://127.0.0.1:4175',env:{VITE_CASHDESK_DEMO:'false',VITE_SUPABASE_URL:'https://cashdesk-test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_public_key'},reuseExistingServer:!process.env.CI},
  ],
})
