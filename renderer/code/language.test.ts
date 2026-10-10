import { describe, it, expect } from 'vitest'
import { languageOf } from './language'

describe('languageOf (docs/sdlc/code-editor/ FR-12)', () => {
  it.each([
    ['src/a.ts', 'typescript'], ['a.mts', 'typescript'], ['a.cts', 'typescript'],
    ['App.tsx', 'tsx'], ['a.js', 'javascript'], ['a.mjs', 'javascript'], ['a.cjs', 'javascript'], ['a.jsx', 'jsx'],
    ['package.json', 'json'], ['a.css', 'css'], ['index.html', 'html'], ['a.htm', 'html'],
    ['README.md', 'markdown'], ['a.markdown', 'markdown'], ['x.py', 'python'],
    ['ci.yml', 'yaml'], ['ci.yaml', 'yaml'],
    // 확장자는 대소문자를 가리지 않는다
    ['NOTES.MD', 'markdown']
  ])('%s → %s', (path, language) => {
    expect(languageOf(path)).toBe(language)
  })

  it.each(['Dockerfile', '.gitignore', 'a.rs', 'a', 'dir.ts/README'])('%s는 평문이다', (path) => {
    expect(languageOf(path)).toBeNull()
  })
})
