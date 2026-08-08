import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClientProvider } from './client/ClientProvider'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientProvider client={window.oneDesk}>
      <App />
    </ClientProvider>
  </StrictMode>
)
