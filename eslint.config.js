import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'drizzle/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'electron', message: 'core/는 electron에 의존하지 않는다 (설계 §4 규칙 1).' }
        ],
        patterns: [
          { group: ['**/electron/**'], message: 'core/는 electron/ 코드를 참조하지 않는다.' }
        ]
      }]
    }
  },
  {
    files: ['renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/core/**', '@core/*'], message: 'renderer/는 core/를 직접 쓰지 않는다. window.oneDesk를 통해라 (설계 §4 규칙 2).' },
          { group: ['electron', 'node:*', 'fs', 'path'], message: 'renderer/에서 Node API를 쓸 수 없다.' }
        ]
      }]
    }
  },
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/core/**', '@core/*', '**/shared/**', '@shared/*'], message: 'e2e/는 core/와 shared/를 직접 import하지 않는다. 빌드된 앱을 UI로만 조작한다. tsconfig.node.json에는 @core/* 별칭이 있어 타입 검사는 통과하지만 vitest.e2e.config.ts에는 별칭이 없어 런타임에 해석 실패한다.' }
        ]
      }]
    }
  }
)
