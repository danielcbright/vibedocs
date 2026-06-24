import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/register-sw.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// No-op in dev (guarded by import.meta.env.PROD) — see lib/register-sw.ts.
registerServiceWorker()
