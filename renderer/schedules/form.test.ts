import { describe, it, expect } from 'vitest'
import { conversationBreaks, draftOf, emptyDraft, inputOf, isDirty, raisesToFull } from './form'
import type { Repo, Schedule, Workspace } from '@shared/models'

const WS = {
  id: 'w1', name: '회사', defaultAgentKind: 'claude-code', defaultModelClaude: 'opus', defaultModelOpencode: null,
  defaultEffortClaude: 'high', defaultVariantOpencode: null, defaultPermission: 'edit'
} as Workspace
const REPOS = [
  { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', agentEnv: 'host' },
  { id: 'r2', workspaceId: 'w1', name: 'web', path: '/tmp/web', agentEnv: 'host' }
] as Repo[]

const SAVED: Schedule = {
  id: 's1', workspaceId: 'w1', repoId: 'r1', name: '아침', trigger: { kind: 'weekly', days: [1, 3], time: '07:30' },
  timeZone: 'Asia/Seoul', conversationMode: 'continue', conversationId: 'root-1', agentKind: 'claude-code', model: null,
  effort: null, permission: 'read_only', prompt: '훑어 줘', context: [{ type: 'issue', id: 'i1' }], enabled: true,
  disabledReason: null, anchorAt: 1, consecutiveFailures: 0, createdAt: 1, updatedAt: 1
}

describe('emptyDraft — 실행 패널과 같은 기본값 (spec FR-28)', () => {
  it('workspace의 기본 agent·모델·effort·권한과 첫 repo, 평일 09:00, 새 대화', () => {
    const d = emptyDraft(WS, REPOS)
    expect(d).toMatchObject({
      workspaceId: 'w1', repoId: 'r1', agentKind: 'claude-code', model: 'opus', effort: 'high', permission: 'edit',
      triggerKind: 'weekdays', time: '09:00', conversationMode: 'new', name: '', prompt: '', context: []
    })
    expect(inputOf(d, 'Asia/Seoul').trigger).toEqual({ kind: 'weekdays', time: '09:00' })
  })

  it('repo가 없으면 빈 칸이다', () => {
    expect(emptyDraft(WS, []).repoId).toBe('')
  })
})

describe('draftOf · inputOf — 저장된 것을 그대로 되돌린다', () => {
  it('왕복해도 같은 입력이다', () => {
    const input = inputOf(draftOf(SAVED), SAVED.timeZone)
    expect(input).toEqual({
      workspaceId: 'w1', repoId: 'r1', name: '아침', trigger: { kind: 'weekly', days: [1, 3], time: '07:30' },
      timeZone: 'Asia/Seoul', conversationMode: 'continue', agentKind: 'claude-code', model: null, effort: null,
      permission: 'read_only', prompt: '훑어 줘', context: [{ type: 'issue', id: 'i1' }]
    })
  })

  it('다른 종류의 칸은 기본값으로 채워 둔다 — 종류를 바꿔도 칸이 비지 않게', () => {
    const d = draftOf({ ...SAVED, trigger: { kind: 'cron', expr: '0 9 * * 1' } })
    expect(d).toMatchObject({ triggerKind: 'cron', cron: '0 9 * * 1', time: '09:00', everyHours: 3, minute: 0 })
    expect(inputOf({ ...d, triggerKind: 'hourly' }, 'UTC').trigger).toEqual({ kind: 'hourly', everyHours: 3, minute: 0 })
  })

  it('빈 모델·effort는 null, 이름은 다듬는다', () => {
    const input = inputOf({ ...draftOf(SAVED), name: '  저녁 ', model: ' ', effort: '' }, 'UTC')
    expect(input).toMatchObject({ name: '저녁', model: null, effort: null })
  })
})

describe('isDirty — 저장 버튼은 바뀐 것이 있을 때만 (FR-31)', () => {
  it('저장된 그대로면 거짓, 한 칸이라도 바꾸면 참', () => {
    expect(isDirty(draftOf(SAVED), SAVED)).toBe(false)
    expect(isDirty({ ...draftOf(SAVED), prompt: '다른 지시' }, SAVED)).toBe(true)
    expect(isDirty({ ...draftOf(SAVED), days: [1, 3, 5] }, SAVED)).toBe(true)
  })

  it('쓰지 않는 종류의 칸만 바꾼 것은 바뀐 것이 아니다', () => {
    expect(isDirty({ ...draftOf(SAVED), cron: '0 0 * * *' }, SAVED)).toBe(false)
  })

  it('새 정기 실행은 늘 저장할 것이 있다', () => {
    expect(isDirty(emptyDraft(WS, REPOS), null)).toBe(true)
  })
})

describe('raisesToFull — 전체 허용으로 "올릴 때"만 묻는다 (FR-29)', () => {
  it('저장된 것보다 올리면 참, 이미 전체 허용이면 거짓', () => {
    expect(raisesToFull({ ...draftOf(SAVED), permission: 'full' }, SAVED)).toBe(true)
    expect(raisesToFull({ ...draftOf(SAVED), permission: 'edit' }, SAVED)).toBe(false)
    const full = { ...SAVED, permission: 'full' as const }
    expect(raisesToFull({ ...draftOf(full), prompt: '바뀜' }, full)).toBe(false)
  })

  it('처음 만들 때 전체 허용이면 올리는 것이다', () => {
    expect(raisesToFull({ ...emptyDraft(WS, REPOS), permission: 'full' }, null)).toBe(true)
    expect(raisesToFull(emptyDraft(WS, REPOS), null)).toBe(false)
  })
})

describe('conversationBreaks — 이어 가던 대화가 끊기는가 (FR-30)', () => {
  it('이어 감에서 agent·repo를 바꾸거나 새 대화로 바꾸면 참', () => {
    expect(conversationBreaks({ ...draftOf(SAVED), agentKind: 'opencode' }, SAVED)).toBe(true)
    expect(conversationBreaks({ ...draftOf(SAVED), repoId: 'r2' }, SAVED)).toBe(true)
    expect(conversationBreaks({ ...draftOf(SAVED), conversationMode: 'new' }, SAVED)).toBe(true)
    expect(conversationBreaks({ ...draftOf(SAVED), model: 'opus' }, SAVED)).toBe(false)
  })

  it('이어 가던 대화가 아직 없으면 끊길 것이 없다', () => {
    const fresh = { ...SAVED, conversationId: null }
    expect(conversationBreaks({ ...draftOf(fresh), agentKind: 'opencode' }, fresh)).toBe(false)
    expect(conversationBreaks(emptyDraft(WS, REPOS), null)).toBe(false)
  })
})
