import { describe, it, expect, beforeEach } from 'vitest'
import { makeTestDb } from './testing'
import { createWorkspaceRepository } from './workspace'
import type { Database } from '../open'

describe('WorkspaceRepository', () => {
  let db: Database
  let repo: ReturnType<typeof createWorkspaceRepository>

  beforeEach(() => {
    db = makeTestDb()
    repo = createWorkspaceRepository(db)
  })

  it('생성한 workspace를 목록에서 찾을 수 있다', () => {
    const created = repo.create({ name: '사내 플랫폼' })
    expect(created.id).toBeTruthy()
    expect(created.name).toBe('사내 플랫폼')
    expect(created.defaultPermission).toBe('edit')

    const all = repo.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.id).toBe(created.id)
  })

  it('이름순으로 정렬해서 반환한다', () => {
    repo.create({ name: '하나' })
    repo.create({ name: '가나' })
    repo.create({ name: '나나' })
    expect(repo.list().map((w) => w.name)).toEqual(['가나', '나나', '하나'])
  })

  it('삭제하면 목록에서 사라진다', () => {
    const w = repo.create({ name: '지울것' })
    repo.remove(w.id)
    expect(repo.list()).toHaveLength(0)
  })
})

describe('WorkspaceRepository.rename', () => {
  it('이름을 바꾸고 바뀐 행을 돌려준다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '옛 이름' })

    const renamed = repo.rename(created.id, '새 이름')

    expect(renamed.name).toBe('새 이름')
    expect(repo.list().map((w) => w.name)).toEqual(['새 이름'])
  })

  it('앞뒤 공백을 떼어낸다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '이름' })

    expect(repo.rename(created.id, '  다듬은 이름  ').name).toBe('다듬은 이름')
  })

  it('빈 이름은 거부한다 — 목록에서 못 알아보는 workspace가 생긴다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '이름' })

    expect(() => repo.rename(created.id, '   ')).toThrow('이름은 비울 수 없습니다')
    expect(repo.list()[0]!.name).toBe('이름')
  })

  it('updatedAt을 올린다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '이름' })

    const renamed = repo.rename(created.id, '새 이름')

    expect(renamed.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('없는 id면 던진다 — 조용히 넘어가면 화면이 왜 안 바뀌는지 알 수 없다', () => {
    const db = makeTestDb()
    expect(() => createWorkspaceRepository(db).rename('없음', '이름')).toThrow('workspace를 찾을 수 없습니다')
  })
})

describe('WorkspaceRepository.updateDefaults', () => {
  it('실행 기본값 셋을 세우고 바뀐 행을 돌려준다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })
    expect(created.defaultAgentKind).toBe('claude-code')
    expect(created.defaultModelClaude).toBeNull()

    const next = repo.updateDefaults({
      id: created.id,
      defaultAgentKind: 'opencode',
      defaultModelClaude: 'sonnet',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultModelOpencode: 'anthropic/claude-sonnet-4-5', defaultPermission: 'edit'
    })

    expect(next.defaultAgentKind).toBe('opencode')
    expect(next.defaultModelClaude).toBe('sonnet')
    expect(next.defaultModelOpencode).toBe('anthropic/claude-sonnet-4-5')
    // 돌려준 행만이 아니라 저장된 행도 확인한다 — returning만 맞고 UPDATE가
    // 엉뚱한 행에 갔어도 위 단언은 통과한다.
    expect(repo.list()[0]!.defaultModelClaude).toBe('sonnet')
  })

  it('agent별 모델을 서로 다른 칸에 담는다', () => {
    // 한 칸에 담으면 agent를 바꿨을 때 상대가 모르는 이름이 넘어간다 (설계 §199).
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })

    const next = repo.updateDefaults({
      id: created.id,
      defaultAgentKind: 'claude-code',
      defaultModelClaude: 'opus',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultModelOpencode: 'openai/gpt-5', defaultPermission: 'edit'
    })

    expect(next.defaultModelClaude).toBe('opus')
    expect(next.defaultModelOpencode).toBe('openai/gpt-5')
  })

  it('빈 모델은 null로 저장한다 — null이 "CLI 기본값에 맡긴다"이다', () => {
    // 빈 문자열을 그대로 두면 RunPanel이 그것을 기본값으로 채우고 어댑터가 -m ''를 붙인다.
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })
    repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultModelClaude: 'sonnet', defaultModelOpencode: 'openai/gpt-5', defaultPermission: 'edit'
    })

    const cleared = repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultModelClaude: '', defaultModelOpencode: '   ', defaultPermission: 'edit'
    })

    expect(cleared.defaultModelClaude).toBeNull()
    expect(cleared.defaultModelOpencode).toBeNull()
  })

  it('모델의 앞뒤 공백을 떼어낸다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })

    const next = repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultModelClaude: '  sonnet  ', defaultModelOpencode: null, defaultPermission: 'edit'
    })

    expect(next.defaultModelClaude).toBe('sonnet')
  })

  it('effort와 variant를 서로 다른 칸에 담는다', () => {
    // 모델과 같은 이유다 (설계 §199) — claude의 'high'와 opencode의 'high'는
    // 다른 것을 가리킨다. 한 칸에 담으면 agent를 바꾼 순간 값이 새어 넘어간다.
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })
    expect(created.defaultEffortClaude).toBeNull()
    expect(created.defaultVariantOpencode).toBeNull()

    const next = repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultModelClaude: null, defaultModelOpencode: null,
      defaultEffortClaude: 'high',
      defaultVariantOpencode: 'minimal',
      defaultPermission: 'edit'
    })

    expect(next.defaultEffortClaude).toBe('high')
    expect(next.defaultVariantOpencode).toBe('minimal')
    // 저장된 행도 본다 — returning만 맞고 UPDATE가 엉뚱한 행에 갔어도 위는 통과한다.
    expect(repo.list()[0]!.defaultEffortClaude).toBe('high')
    expect(repo.list()[0]!.defaultVariantOpencode).toBe('minimal')
  })

  it('빈 effort는 null로 저장한다', () => {
    // null이 "CLI 자신의 기본값에 맡긴다"는 뜻이라 빈 칸과 같은 자리여야 한다 —
    // ''를 그대로 두면 어댑터가 `--effort ''`를 붙인다 (모델과 같은 규칙).
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })
    repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultModelClaude: null, defaultModelOpencode: null,
      defaultEffortClaude: 'max', defaultVariantOpencode: 'high',
      defaultPermission: 'edit'
    })

    const cleared = repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultModelClaude: null, defaultModelOpencode: null,
      defaultEffortClaude: '', defaultVariantOpencode: '   ',
      defaultPermission: 'edit'
    })

    expect(cleared.defaultEffortClaude).toBeNull()
    expect(cleared.defaultVariantOpencode).toBeNull()
  })

  it('표에 없는 effort 값도 그대로 저장한다', () => {
    // CLI가 이 값을 검증하지 않는다(`--effort bogus`도 통과, 2026-09-22 실측).
    // 저장소가 흉내내면 판정이 두 벌이 되고, 새 단계가 생기면 앱이 먼저 막는다.
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })

    const next = repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultModelClaude: null, defaultModelOpencode: null,
      defaultEffortClaude: 'ultra', defaultVariantOpencode: null,
      defaultPermission: 'edit'
    })

    expect(next.defaultEffortClaude).toBe('ultra')
  })

  it('이름과 CLI 경로는 건드리지 않는다', () => {
    // 이 메서드가 여는 것은 "실행 기본값"뿐이다. 넓히면 무엇이 덮이는지 흐려진다.
    // 경로는 updatePaths의 몫이다 — 고치는 때가 달라 일부러 갈라 두었다.
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: '사내 플랫폼' })

    const next = repo.updateDefaults({
      id: created.id, defaultAgentKind: 'opencode',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultModelClaude: null, defaultModelOpencode: null, defaultPermission: 'edit'
    })

    expect(next.name).toBe('사내 플랫폼')
    expect(next.claudePath).toBeNull()
    expect(next.opencodePath).toBeNull()
  })

  it('updatedAt을 올린다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })

    const next = repo.updateDefaults({
      id: created.id, defaultAgentKind: 'opencode',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultModelClaude: null, defaultModelOpencode: null, defaultPermission: 'edit'
    })

    expect(next.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('없는 id면 던진다 — rename과 같은 이유다', () => {
    const db = makeTestDb()
    expect(() => createWorkspaceRepository(db).updateDefaults({
      id: '없음', defaultAgentKind: 'claude-code',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultModelClaude: null, defaultModelOpencode: null, defaultPermission: 'edit'
    })).toThrow('workspace를 찾을 수 없습니다')
  })
})

describe('WorkspaceRepository.updateDefaults — 권한', () => {
  it('기본 권한을 세운다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })
    expect(created.defaultPermission).toBe('edit')

    const next = repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultModelClaude: null, defaultModelOpencode: null,
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultPermission: 'read_only'
    })

    expect(next.defaultPermission).toBe('read_only')
    expect(repo.list()[0]!.defaultPermission).toBe('read_only')
  })

  it('전체 허용도 저장한다 — 확인 절차는 화면의 몫이다', () => {
    // 저장소가 막으면 MCP나 스크립트가 같은 값을 쓸 길이 아예 없어진다.
    // 별도 확인(설계 §403)은 사용자에게 묻는 일이라 UI에 있다.
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })

    expect(repo.updateDefaults({
      id: created.id, defaultAgentKind: 'claude-code',
      defaultModelClaude: null, defaultModelOpencode: null,
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultPermission: 'full'
    }).defaultPermission).toBe('full')
  })
})

describe('WorkspaceRepository.updatePaths', () => {
  it('두 경로를 세우고 바뀐 행을 돌려준다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })
    expect(created.claudePath).toBeNull()

    const next = repo.updatePaths({
      id: created.id,
      claudePath: '/opt/bin/claude',
      opencodePath: '/opt/bin/opencode'
    })

    expect(next.claudePath).toBe('/opt/bin/claude')
    expect(next.opencodePath).toBe('/opt/bin/opencode')
    expect(repo.list()[0]!.claudePath).toBe('/opt/bin/claude')
  })

  it('agent별 경로를 서로 다른 칸에 담는다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })

    const next = repo.updatePaths({
      id: created.id, claudePath: '/a/claude', opencodePath: '/b/opencode'
    })

    expect(next.claudePath).toBe('/a/claude')
    expect(next.opencodePath).toBe('/b/opencode')
  })

  it('빈 경로는 null로 저장한다 — null이 "PATH에서 찾는다"이다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })
    repo.updatePaths({ id: created.id, claudePath: '/a/claude', opencodePath: '/b/opencode' })

    const cleared = repo.updatePaths({ id: created.id, claudePath: '', opencodePath: '   ' })

    expect(cleared.claudePath).toBeNull()
    expect(cleared.opencodePath).toBeNull()
  })

  it('앞뒤 공백을 떼어낸다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })

    expect(repo.updatePaths({
      id: created.id, claudePath: '  /a/claude  ', opencodePath: null
    }).claudePath).toBe('/a/claude')
  })

  it('실행 기본값은 건드리지 않는다 — 경로를 고치러 온 사람이 모델까지 덮으면 안 된다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })
    repo.updateDefaults({
      id: created.id, defaultAgentKind: 'opencode',
      defaultModelClaude: 'sonnet', defaultModelOpencode: 'openai/gpt-5',
      defaultEffortClaude: null,
      defaultVariantOpencode: null,
      defaultPermission: 'read_only'
    })

    const next = repo.updatePaths({ id: created.id, claudePath: '/a/claude', opencodePath: null })

    expect(next.defaultAgentKind).toBe('opencode')
    expect(next.defaultModelClaude).toBe('sonnet')
    expect(next.defaultPermission).toBe('read_only')
  })

  it('updatedAt을 올린다', () => {
    const db = makeTestDb()
    const repo = createWorkspaceRepository(db)
    const created = repo.create({ name: 'ws' })

    expect(repo.updatePaths({ id: created.id, claudePath: '/a', opencodePath: null }).updatedAt)
      .toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('없는 id면 던진다', () => {
    const db = makeTestDb()
    expect(() => createWorkspaceRepository(db).updatePaths({
      id: '없음', claudePath: null, opencodePath: null
    })).toThrow('workspace를 찾을 수 없습니다')
  })
})
