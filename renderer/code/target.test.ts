import { describe, it, expect } from 'vitest'
import { paneTarget } from './target'
import { groupConversations } from '../conversation'
import type { Repo, Run } from '@shared/models'

const API: Repo = { id: 'r1', workspaceId: 'w', name: 'api', path: String.raw`D:\work\api`, description: null, sortOrder: 0, createdAt: 0 }
const WEB: Repo = { id: 'r2', workspaceId: 'w', name: 'web', path: '/home/me/web', description: null, sortOrder: 1, createdAt: 0 }

function run(over: Partial<Run> & { id: string }): Run {
  return {
    workspaceId: 'w', agentKind: 'claude-code', model: null, effort: null, cwd: '/tmp',
    permission: 'edit', userPrompt: '지시', assembledPrompt: '지시', status: 'succeeded',
    externalSessionId: null, parentRunId: null, rootRunId: over.id, resultText: null, title: null, closedAt: null,
    needsAnswer: false, timeoutMs: null, exitCode: null, errorMessage: null,
    logPath: '/tmp/x.log', reviewedAt: null, reviewedKind: null, startedAt: null,
    endedAt: null, createdAt: 0, contextItems: [], issue: null, usage: null, ...over
  }
}
const conversation = (cwd: string) => groupConversations([run({ id: 'a', cwd })])[0]!

describe('paneTarget (docs/sdlc/code-editor/ FR-6)', () => {
  it('이어 가는 대화는 뿌리 cwd의 repo다 — Windows 경로는 대소문자와 끝 구분자를 가리지 않는다', () => {
    expect(paneTarget(conversation('d:\\WORK\\api\\'), '', [API, WEB])).toEqual({ repo: API })
    expect(paneTarget(conversation('/home/me/web/'), '', [API, WEB])).toEqual({ repo: WEB })
  })

  it('등록하지 않은 cwd의 대화(기타)는 이유다', () => {
    expect(paneTarget(conversation('/tmp/elsewhere'), '', [API, WEB]))
      .toEqual({ repo: null, reason: '이 대화의 작업 디렉토리는 등록된 repo가 아닙니다' })
  })

  it('새 대화는 입력부가 고른 작업 디렉토리의 repo다', () => {
    expect(paneTarget(null, '/home/me/web', [API, WEB])).toEqual({ repo: WEB })
    expect(paneTarget(null, String.raw`D:\work\API`, [API, WEB])).toEqual({ repo: API })
  })

  it('새 대화에서 고를 것이 없거나 아직 안 골랐으면 이유다', () => {
    expect(paneTarget(null, '', [])).toEqual({ repo: null, reason: '먼저 repo를 등록하세요' })
    expect(paneTarget(null, '', [API])).toEqual({ repo: null, reason: '작업 디렉토리를 먼저 고르세요' })
    expect(paneTarget(null, '/tmp/x', [API]))
      .toEqual({ repo: null, reason: '작업 디렉토리가 등록된 repo가 아닙니다' })
  })
})
