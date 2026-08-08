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
    // 127.0.0.1로 고정한다. 기본값 'localhost'로 두면 Vite가 IPv6 [::1]에만 바인딩하는데,
    // /etc/hosts는 localhost를 IPv4와 IPv6 양쪽으로 해석하므로 Electron이 127.0.0.1을
    // 먼저 시도했다가 ERR_TIMED_OUT으로 멈춘다. 주소 계열을 양쪽 다 IPv4로 맞춰 없앤다.
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { rollupOptions: { input: { index: resolve('renderer/index.html') } } }
  }
})
