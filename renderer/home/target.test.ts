import { describe, it, expect } from 'vitest'
import type { HomeWorkspace } from '@shared/models'
import { targetOf } from './target'

function ws(id: string, repos: string[]): HomeWorkspace {
  return {
    workspaceId: id, name: id, open: 0, doing: 0, doneToday: 0, untriaged: 0,
    repos: repos.map((r) => ({ repoId: r, name: r, path: `/w/${r}`, agentEnv: 'host', open: 0, conversations: 0, state: 'none' }))
  }
}

describe('targetOf (FR-7·FR-11)', () => {
  it('저장된 대상이 요약에 있으면 그것이다', () => {
    expect(targetOf({ workspaceId: 'b', repoId: 'web' }, [ws('a', ['api']), ws('b', ['web'])])).toEqual({ workspaceId: 'b', repoId: 'web' })
  })

  it('저장된 대상의 repo가 사라졌으면 첫 workspace의 첫 repo로 폴백한다 — repo가 없는 workspace는 건너뛴다', () => {
    expect(targetOf({ workspaceId: 'b', repoId: 'gone' }, [ws('a', []), ws('b', ['web', 'api'])])).toEqual({ workspaceId: 'b', repoId: 'web' })
    expect(targetOf(null, [ws('a', []), ws('b', ['web'])])).toEqual({ workspaceId: 'b', repoId: 'web' })
  })

  it('repo가 하나도 없으면 null이다', () => {
    expect(targetOf(null, [ws('a', [])])).toBeNull()
    expect(targetOf({ workspaceId: 'a', repoId: 'x' }, [])).toBeNull()
  })
})
