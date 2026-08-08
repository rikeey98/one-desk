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
  }
)
