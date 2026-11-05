import { describe, it, expect } from 'vitest'
import { baseIssueOf, cwdMismatch, pickCwd, type CwdInput } from './cwdRule'
import type { ContextChip } from './context'
import type { Repo } from '@shared/models'

function repo(id: string): Repo {
  return { id, workspaceId: 'w1', name: id, path: `/tmp/${id}`, description: null, sortOrder: 0, agentEnv: 'host', createdAt: 0 }
}

const API = repo('api')
const WEB = repo('web')
const DOCS = repo('docs')
const REPOS = [API, WEB, DOCS]

function input(over: Partial<CwdInput> = {}): CwdInput {
  return { repos: REPOS, draftCwd: null, pickedCwd: null, issue: null, selectedPath: null, current: '', ...over }
}

function issue(...repoIds: string[]) {
  return { repoIds, assigned: true }
}

describe('pickCwd — 앞 칸이 있으면 뒤를 보지 않는다', () => {
  const everything = input({
    draftCwd: '/tmp/docs', pickedCwd: '/tmp/web', issue: issue('api'), selectedPath: '/tmp/web', current: '/tmp/web'
  })

  it('"다시 실행"의 경로가 전부를 이긴다', () => {
    expect(pickCwd(everything)).toEqual({ cwd: '/tmp/docs', missing: null })
  })

  it('"다시 실행"의 경로가 목록에 없으면 그대로 두고 알린다 — 첫 repo로 떨어뜨리지 않는다', () => {
    expect(pickCwd(input({ draftCwd: '/tmp/gone' }))).toEqual({ cwd: '/tmp/gone', missing: '/tmp/gone' })
  })

  it('알약으로 고른 경로가 이슈를 이긴다', () => {
    expect(pickCwd({ ...everything, draftCwd: null }).cwd).toBe('/tmp/web')
  })

  it('지금 workspace에 없는 알약 값은 건너뛴다', () => {
    expect(pickCwd(input({ pickedCwd: '/tmp/other', issue: issue('api') })).cwd).toBe('/tmp/api')
  })

  it('이슈의 repo가 사이드바를 이긴다', () => {
    expect(pickCwd(input({ issue: issue('api'), selectedPath: '/tmp/web', current: '/tmp/web' })).cwd).toBe('/tmp/api')
  })

  it('이슈가 없으면 사이드바를 따른다', () => {
    expect(pickCwd(input({ selectedPath: '/tmp/web', current: '/tmp/api' })).cwd).toBe('/tmp/web')
  })

  it('사이드바 선택이 없으면 지금 값을 유지한다', () => {
    expect(pickCwd(input({ current: '/tmp/web' })).cwd).toBe('/tmp/web')
  })

  it('지금 값이 이 workspace의 repo가 아니면 첫 repo다', () => {
    expect(pickCwd(input({ current: '/tmp/other' })).cwd).toBe('/tmp/api')
  })

  it('repo가 없으면 빈 값이다', () => {
    expect(pickCwd(input({ repos: [] })).cwd).toBe('')
  })
})

describe('pickCwd — 이슈의 repo는 정확히 하나일 때만 따른다', () => {
  it('repo 태그가 둘이면 고르지 않는다', () => {
    expect(pickCwd(input({ issue: issue('web', 'docs'), selectedPath: '/tmp/api' })).cwd).toBe('/tmp/api')
  })

  it('태그가 없으면 고르지 않는다', () => {
    expect(pickCwd(input({ issue: issue(), current: '/tmp/web' })).cwd).toBe('/tmp/web')
  })

  it('이 workspace의 repo만 센다 — 다른 태그가 함께 있어도 하나면 따른다', () => {
    expect(pickCwd(input({ issue: issue('gone', 'web') })).cwd).toBe('/tmp/web')
  })
})

describe('baseIssueOf — 작업 디렉토리의 기준 이슈', () => {
  const pending = { id: 'p1', title: '할당 예정', repoIds: ['web'] }
  const picked = (id: string, ...repoIds: string[]): ContextChip => ({ type: 'issue', id, label: id, repoIds })
  const memo: ContextChip = { type: 'memo', id: 'm1', label: '메모' }

  it('할당 예정 이슈가 담은 이슈를 이긴다', () => {
    expect(baseIssueOf(pending, [picked('i1', 'api')])).toEqual({ repoIds: ['web'], assigned: true })
  })

  it('할당 예정 이슈에 repo가 없어도 담은 이슈로 넘어가지 않는다', () => {
    expect(baseIssueOf({ ...pending, repoIds: [] }, [picked('i1', 'api')])).toEqual({ repoIds: [], assigned: true })
  })

  it('이슈를 하나만 담았으면 그 이슈다', () => {
    expect(baseIssueOf(null, [picked('i1', 'api')])).toEqual({ repoIds: ['api'], assigned: false })
  })

  it('곁에 다른 종류를 담아도 이슈가 하나면 그 이슈다', () => {
    expect(baseIssueOf(null, [memo, picked('i1', 'api')])).toEqual({ repoIds: ['api'], assigned: false })
  })

  it('이슈를 둘 담았으면 repo가 같아도 기준이 없다', () => {
    expect(baseIssueOf(null, [picked('i1', 'api'), picked('i2', 'api')])).toBeNull()
  })

  it('이슈를 담지 않았으면 기준이 없다', () => {
    expect(baseIssueOf(null, [memo])).toBeNull()
  })
})

describe('cwdMismatch', () => {
  it('지금 repo가 이슈의 repo가 아니면 이슈의 repo들을 준다', () => {
    expect(cwdMismatch(REPOS, issue('web', 'docs'), '/tmp/api')).toEqual([WEB, DOCS])
  })

  it('지금 repo가 이슈의 repo 중 하나면 없다', () => {
    expect(cwdMismatch(REPOS, issue('web', 'docs'), '/tmp/docs')).toEqual([])
  })

  it('이슈가 없으면 없다', () => {
    expect(cwdMismatch(REPOS, null, '/tmp/api')).toEqual([])
  })

  it('이슈의 repo가 이 workspace에 없으면 없다 — 기준이 없다', () => {
    expect(cwdMismatch(REPOS, issue('gone'), '/tmp/api')).toEqual([])
  })
})
