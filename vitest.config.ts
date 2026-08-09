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
          // .tsx만 잡으면 JSX 없는 렌더러 테스트(.ts)가 어느 프로젝트에도
          // 걸리지 않아 실행되지 않은 채로 통과한 것처럼 보인다.
          include: ['renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['./renderer/vitest.setup.ts']
        }
      }
    ]
  }
})
