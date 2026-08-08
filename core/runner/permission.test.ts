import { describe, it, expect } from 'vitest'
import { claudeCodePermissionArgs } from './permission'
import type { Permission } from '@shared/models'

const ALL: Permission[] = ['read_only', 'edit', 'full']

describe('claudeCodePermissionArgs', () => {
  it('어떤 권한에서도 ask를 생성하지 않는다', () => {
    for (const p of ALL) {
      const joined = claudeCodePermissionArgs(p).join(' ')
      expect(joined).not.toContain('ask')
    }
  })

  it('읽기 전용은 편집 도구를 허용하지 않는다', () => {
    const joined = claudeCodePermissionArgs('read_only').join(' ')
    expect(joined).not.toContain('acceptEdits')
    expect(joined).not.toContain('bypassPermissions')
  })

  it('편집 허용은 acceptEdits를 쓴다', () => {
    expect(claudeCodePermissionArgs('edit')).toContain('acceptEdits')
  })

  it('전체 허용은 bypassPermissions를 쓴다', () => {
    expect(claudeCodePermissionArgs('full')).toContain('bypassPermissions')
  })

  it('세 단계가 서로 다른 인자를 만든다', () => {
    const sets = ALL.map((p) => claudeCodePermissionArgs(p).join(' '))
    expect(new Set(sets).size).toBe(3)
  })
})
