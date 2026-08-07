import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const alias = {
  '@core': resolve('core'),
  '@shared': resolve('shared'),
  '@renderer': resolve('renderer')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('electron/main.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('electron/preload.ts') } } }
  },
  renderer: {
    root: 'renderer',
    plugins: [react()],
    resolve: { alias: { '@shared': alias['@shared'], '@renderer': alias['@renderer'] } },
    build: { rollupOptions: { input: { index: resolve('renderer/index.html') } } }
  }
})
