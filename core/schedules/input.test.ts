import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTestDb } from '../db/repositories/testing'
import { createWorkspaceRepository } from '../db/repositories/workspace'
import { createRepoRepository } from '../db/repositories/repo'
import { createIssueRepository } from '../db/repositories/issue'
import { createMemoRepository } from '../db/repositories/memo'
import { createAssetRepository } from '../db/repositories/asset'
import { validateScheduleInput } from './input'
import type { Database } from '../db/open'
import type { ScheduleInput } from '@shared/models'

const NOW = Date.parse('2026-11-02T00:00:00Z')

describe('validateScheduleInput (spec FR-4)', () => {
  let db: Database
  let workspaceId: string
  let repoId: string
  let base: ScheduleInput

  beforeEach(() => {
    db = makeTestDb()
    workspaceId = createWorkspaceRepository(db).create({ name: 'ws' }).id
    repoId = createRepoRepository(db).create({ workspaceId, name: 'api', path: '/tmp/api' }).id
    base = {
      workspaceId, repoId, name: '아침 CI 훑기', trigger: { kind: 'weekdays', time: '09:00' }, timeZone: 'Asia/Seoul',
      conversationMode: 'new', agentKind: 'claude-code', model: null, effort: null, permission: 'read_only',
      prompt: '어젯밤 실패한 CI를 훑어 줘', context: []
    }
  })

  afterEach(() => { db.$client.close() })

  const invalid = (over: Partial<Record<keyof ScheduleInput, unknown>>) =>
    () => validateScheduleInput(db, { ...base, ...over } as ScheduleInput, NOW)

  it('맞는 입력은 다듬어 돌려준다 — 이름 앞뒤 공백, 빈 모델·effort는 null', () => {
    const out = validateScheduleInput(db, { ...base, name: '  아침 CI 훑기 ', model: '  ', effort: '' }, NOW)
    expect(out).toEqual({ ...base, model: null, effort: null })
  })

  it('이름은 한 줄, 1~60자', () => {
    expect(invalid({ name: '  ' })).toThrow(/이름/)
    expect(invalid({ name: '가\n나' })).toThrow(/이름/)
    expect(invalid({ name: 'x'.repeat(61) })).toThrow(/이름/)
  })

  it('홈 workspace로는 만들 수 없다 — 없는 workspace와 같은 말이다 (home-conversation plan §0-8)', () => {
    const homeId = createWorkspaceRepository(db).ensureHome().id
    expect(invalid({ workspaceId: homeId })).toThrow('workspace를 찾을 수 없습니다')
  })

  it('지시는 비울 수 없다', () => {
    expect(invalid({ prompt: '  \n ' })).toThrow(/지시/)
  })

  it('주기·시간대는 clock의 판정 그대로다', () => {
    expect(invalid({ trigger: { kind: 'cron', expr: '*/5 * * * *' } })).toThrow(/10분/)
    expect(invalid({ timeZone: 'Not/AZone' })).toThrow(/시간대/)
  })

  it('repo는 그 workspace 소속이어야 한다', () => {
    const other = createWorkspaceRepository(db).create({ name: 'other' }).id
    const foreign = createRepoRepository(db).create({ workspaceId: other, name: 'web', path: '/tmp/web' }).id
    expect(invalid({ repoId: foreign })).toThrow(/repo/)
    expect(invalid({ repoId: 'nope' })).toThrow(/repo/)
  })

  it('없는 workspace는 거부한다', () => {
    expect(invalid({ workspaceId: 'nope' })).toThrow(/workspace/)
  })

  it('맥락은 그 workspace의 이슈·메모·asset만 — 파일·repo·지시 파일·남의 것은 거부한다', () => {
    const issueId = createIssueRepository(db).create({ workspaceId, title: '이슈' }).id
    const memoId = createMemoRepository(db).create({ workspaceId, title: '메모' }).id
    const assets = createAssetRepository(db)
    const skillId = assets.createAuthored({ workspaceId, kind: 'skill', name: 's', description: null, content: 'x' }).id
    const ok = validateScheduleInput(db, {
      ...base,
      context: [{ type: 'issue', id: issueId }, { type: 'memo', id: memoId }, { type: 'asset', id: skillId }, { type: 'issue', id: issueId }]
    }, NOW)
    // 같은 항목이 두 번이면 하나로
    expect(ok.context).toEqual([{ type: 'issue', id: issueId }, { type: 'memo', id: memoId }, { type: 'asset', id: skillId }])

    expect(invalid({ context: [{ type: 'file', id: `${repoId}:a.ts` }] })).toThrow(/맥락/)
    expect(invalid({ context: [{ type: 'repo', id: repoId }] })).toThrow(/맥락/)
    expect(invalid({ context: [{ type: 'issue', id: 'nope' }] })).toThrow(/맥락/)

    const other = createWorkspaceRepository(db).create({ name: 'other' }).id
    const foreignIssue = createIssueRepository(db).create({ workspaceId: other, title: '남의 이슈' }).id
    expect(invalid({ context: [{ type: 'issue', id: foreignIssue }] })).toThrow(/맥락/)
  })

  it('종류·권한·대화 방식은 정해진 값만', () => {
    expect(invalid({ agentKind: 'codex' })).toThrow()
    expect(invalid({ permission: 'root' })).toThrow()
    expect(invalid({ conversationMode: 'fork' })).toThrow()
  })

  it('WSL repo에서는 OpenCode를 막는다 — 실행 때의 문구와 같다', () => {
    const wslRepo = createRepoRepository(db).create({
      workspaceId, name: 'wsl', path: '\\\\wsl$\\Ubuntu\\home\\me\\api', agentEnv: 'wsl'
    }).id
    expect(invalid({ repoId: wslRepo, agentKind: 'opencode' })).toThrow('WSL repo에서는 OpenCode를 아직 쓸 수 없습니다')
  })
})
