import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/register-sw.ts'
import { SetupPage } from './settings/SetupPage.tsx'
import { setupTokenFromLocation } from './settings/settings-client.ts'

// `?setup=<token>` is the one-shot install page served by `vibedocs pick-roots`.
const setupToken = setupTokenFromLocation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {setupToken ? <SetupPage token={setupToken} /> : <App />}
  </StrictMode>,
)

// No-op in dev (guarded by import.meta.env.PROD) — see lib/register-sw.ts. Not
// on the install page: it lives on a random port, so each run would install a
// worker and a cache on an origin nothing will ever visit again.
if (!setupToken) registerServiceWorker()
