import { describe, it, expect } from 'vitest'
import { ancestorsOf, buildTree, visibleRows } from './tree'

const rows = (paths: string[], expanded: string[] = []) =>
  visibleRows(buildTree(paths), new Set(expanded)).map((r) => `${'  '.repeat(r.depth)}${r.kind === 'dir' ? '▸' : '·'}${r.name}`)

describe('buildTree · visibleRows (docs/sdlc/code-editor/ FR-8)', () => {
  it('폴더가 먼저, 이름순(대소문자 무시)이고 폴더는 접힌 채 시작한다', () => {
    expect(rows(['b.ts', 'src/z.ts', 'A.md', 'lib/x.ts', 'Src2/y.ts'])).toEqual([
      '▸lib', '▸src', '▸Src2', '·A.md', '·b.ts'
    ])
  })

  it('펼친 폴더의 아래만 깊이를 붙여 보인다', () => {
    expect(rows(['src/a.ts', 'src/util/b.ts', 'README.md'], ['src'])).toEqual([
      '▸src', '  ▸util', '  ·a.ts', '·README.md'
    ])
    expect(rows(['src/a.ts', 'src/util/b.ts'], ['src', 'src/util'])).toEqual([
      '▸src', '  ▸util', '    ·b.ts', '  ·a.ts'
    ])
  })

  it('접힌 폴더 안을 펼쳐 두었어도 부모가 접히면 안 보인다', () => {
    expect(rows(['src/util/b.ts'], ['src/util'])).toEqual(['▸src'])
  })

  it('줄은 전체 경로와 펼침 여부를 함께 준다', () => {
    const [dir, file] = visibleRows(buildTree(['src/a.ts']), new Set(['src']))
    expect(dir).toEqual({ kind: 'dir', name: 'src', path: 'src', depth: 0, expanded: true })
    expect(file).toEqual({ kind: 'file', name: 'a.ts', path: 'src/a.ts', depth: 1, expanded: false })
  })

  it('한글 이름도 같은 규칙이다', () => {
    expect(rows(['노트/가.md', '노트/나.md'], ['노트'])).toEqual(['▸노트', '  ·가.md', '  ·나.md'])
  })

  it('5만 개 경로를 0.5초 안에 만들고 접힌 줄을 그린다 (NFR-6)', () => {
    const paths = Array.from({ length: 50_000 }, (_, i) => `pkg${i % 50}/src/mod${i % 400}/file${i}.ts`)
    const started = performance.now()
    const shown = visibleRows(buildTree(paths), new Set(['pkg7']))
    expect(performance.now() - started).toBeLessThan(500)
    expect(shown).toHaveLength(51)
  })
})

describe('ancestorsOf', () => {
  it('파일을 보이려면 펼쳐야 할 폴더들이다', () => {
    expect(ancestorsOf('src/a/b.ts')).toEqual(['src', 'src/a'])
    expect(ancestorsOf('b.ts')).toEqual([])
  })
})
