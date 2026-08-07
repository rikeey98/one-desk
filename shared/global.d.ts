import type { OneDeskClient } from './client'

declare global {
  interface Window {
    oneDesk: OneDeskClient
  }
}

export {}
