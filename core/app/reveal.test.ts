import { describe, it, expect } from 'vitest'
import { revealDir } from './reveal'

const paths = { dataDir: '/data', dbFile: '/data/one-desk.db', logDir: '/data/logs' }

describe('revealDir', () => {
  it('data와 logs만 실제 디렉토리로 바꾼다', () => {
    expect(revealDir('data', paths)).toBe('/data')
    expect(revealDir('logs', paths)).toBe('/data/logs')
  })

  it('그 밖의 값은 경로처럼 생겼어도 던진다', () => {
    // NFR-3: 렌더러가 임의의 경로를 열 수 없다. 이 검사가 빠지면 IPC 한 번으로
    // 파일 탐색기가 아무 디렉토리나 연다.
    expect(() => revealDir('C:\\', paths)).toThrow('열 수 없는 대상')
    expect(() => revealDir('/data', paths)).toThrow('열 수 없는 대상')
    expect(() => revealDir('', paths)).toThrow('열 수 없는 대상')
    expect(() => revealDir(undefined, paths)).toThrow('열 수 없는 대상')
  })
})
