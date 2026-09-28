import { describe, it, expect } from 'vitest'
import { matchFiles } from './match'

describe('matchFiles (FR-6)', () => {
  it('파일명 앞글자 > 파일명 안 > 경로 안 > 글자 건너뛰기 순이고 대소문자를 가리지 않는다', () => {
    const paths = ['src/xrun.ts', 'run/other.ts', 'r/u/n.ts', 'lib/Run.ts']
    expect(matchFiles(paths, 'RUN')).toEqual(['lib/Run.ts', 'src/xrun.ts', 'run/other.ts', 'r/u/n.ts'])
  })

  it('글자 건너뛰기로 RunPanel을 잡는다', () => {
    expect(matchFiles(['renderer/components/RunPanel.tsx', 'README.md'], 'rnpl'))
      .toEqual(['renderer/components/RunPanel.tsx'])
  })

  it('같은 등급은 짧은 경로가 먼저, 그다음 사전순이다', () => {
    expect(matchFiles(['b/a.ts', 'deep/dir/a.ts', 'a/a.ts'], 'a.ts')).toEqual(['a/a.ts', 'b/a.ts', 'deep/dir/a.ts'])
  })

  it('최대 limit개다', () => {
    const paths = Array.from({ length: 80 }, (_, i) => `f${i}.ts`)
    expect(matchFiles(paths, 'f')).toHaveLength(50)
    expect(matchFiles(paths, 'f', 3)).toHaveLength(3)
  })

  it('빈 질의는 얕은 경로부터 사전순이다', () => {
    expect(matchFiles(['z/a.ts', 'b.ts', 'a.ts', 'a/b/c.ts'], '')).toEqual(['a.ts', 'b.ts', 'z/a.ts', 'a/b/c.ts'])
  })

  it('맞는 것이 없으면 빈 목록이다', () => {
    expect(matchFiles(['a.ts'], 'zzz')).toEqual([])
  })
})
