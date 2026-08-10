import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    // Electron 창이 여러 개 동시에 뜨면 서로 방해한다
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
