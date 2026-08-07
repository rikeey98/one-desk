import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('core'),
      '@shared': resolve('shared'),
      '@renderer': resolve('renderer')
    }
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'core', environment: 'node', include: ['core/**/*.test.ts'] }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['renderer/**/*.test.tsx'],
          setupFiles: ['./renderer/vitest.setup.ts']
        }
      }
    ]
  }
})
