import { describe, it, expect } from 'vitest'
import { repoRelativePath } from './editPath'

describe('repoRelativePath (docs/sdlc/code-editor/ FR-23)', () => {
  it.each([
    // CLI는 대개 절대 경로를 준다
    [String.raw`D:\work\api\src\auth.ts`, String.raw`D:\work\api`, 'src/auth.ts'],
    // Windows는 대소문자·구분자·끝 구분자를 가리지 않는다 — 돌려주는 경로의 대소문자는 CLI가 준 그대로다
    ['d:/WORK/api/src/Auth.ts', 'D:\\work\\api\\', 'src/Auth.ts'],
    ['/home/me/web/src/app.tsx', '/home/me/web', 'src/app.tsx'],
    ['/home/me/web/src/app.tsx', '/home/me/web/', 'src/app.tsx'],
    // 상대 경로는 repo 기준이다
    ['src/a.ts', '/home/me/web', 'src/a.ts'],
    ['./src/a.ts', '/home/me/web', 'src/a.ts'],
    [String.raw`src\a.ts`, String.raw`D:\work\api`, 'src/a.ts'],
    ['src/../lib/a.ts', '/home/me/web', 'lib/a.ts']
  ])('%s (repo %s) → %s', (cli, repo, rel) => {
    expect(repoRelativePath(cli, repo)).toBe(rel)
  })

  it.each([
    // 밖이다
    [String.raw`D:\work\api2\x.ts`, String.raw`D:\work\api`],
    [String.raw`D:\work\x.ts`, String.raw`D:\work\api`],
    ['/home/me/webapp/x.ts', '/home/me/web'],
    // POSIX 경로는 대소문자를 가린다
    ['/home/me/Web/x.ts', '/home/me/web'],
    ['../x.ts', '/home/me/web'],
    ['src/../../x.ts', '/home/me/web'],
    // repo 자신은 파일이 아니다
    ['/home/me/web', '/home/me/web'],
    ['', '/home/me/web']
  ])('%s (repo %s)는 null이다', (cli, repo) => {
    expect(repoRelativePath(cli, repo)).toBeNull()
  })
})
