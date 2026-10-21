import { describe, it, expect } from 'vitest'
import { pathKey, repoOfCwd } from './repoPath'

const api = { id: 'api', path: '/work/api' }
const web = { id: 'web', path: 'C:\\work\\web' }
const repos = [api, web]

describe('repoOfCwd', () => {
  it('경로로 repo 찾기는 한 함수다 — 도크 구획·코드 칸·인박스 묶음·홈 요약이 같이 쓴다 (inbox-views NFR-2)', () => {
    expect(repoOfCwd('/work/api/', repos)).toBe(api)
    expect(repoOfCwd('c:/WORK/web\\', repos)).toBe(web)
    // posix 경로는 대소문자가 다르면 다른 디렉토리다
    expect(repoOfCwd('/work/API', repos)).toBeNull()
    expect(repoOfCwd('/work/api', [])).toBeNull()
  })

  it('WSL UNC의 두 접두사는 같은 폴더다 — `\\\\wsl.localhost\\U\\a`와 `\\\\wsl$\\U\\a` (wsl-support §4의 9)', () => {
    const wsl = { id: 'wsl', path: '\\\\wsl$\\Ubuntu\\home\\me\\proj' }
    const all = [...repos, wsl]
    expect(repoOfCwd('\\\\wsl.localhost\\Ubuntu\\home\\me\\proj', all)).toBe(wsl)
    expect(repoOfCwd('\\\\WSL$\\Ubuntu\\home\\me\\proj\\', all)).toBe(wsl)
    // Linux 경로 부분은 대소문자가 다르면 다른 디렉토리다 — Windows 규칙으로 접지 않는다
    expect(repoOfCwd('\\\\wsl$\\Ubuntu\\home\\me\\PROJ', all)).toBeNull()
  })
})

describe('pathKey', () => {
  it('Windows 경로는 구분자와 대소문자를 접고 posix는 그대로다', () => {
    expect(pathKey('C:/Work/Web/')).toBe('c:\\work\\web')
    expect(pathKey('/work/API/')).toBe('/work/API')
  })
})
