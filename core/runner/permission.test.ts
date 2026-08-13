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

  it('읽기 전용은 permission-mode로 acceptEdits를 쓴다', () => {
    // 이름과 달리 위험하지 않다 — --tools로 편집 도구 자체를 이미 없앴으므로
    // acceptEdits가 승인할 편집이 존재하지 않는다. dontAsk의 의미가 문서화돼
    // 있지 않아(실측 노트 Q22) 검증 없이 bypassPermissions로 바꾸지 않는다.
    // 여기서 bypassPermissions로 새면 도구 유무와 무관하게 전면 허용이 되어
    // 이 함수가 막으려는 바로 그 실패 모드가 재발한다.
    expect(valueOf(claudeCodePermissionArgs('read_only'), '--permission-mode')).toBe('acceptEdits')
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

/** `--tools a,b` 처럼 붙어 오는 값을 꺼낸다. 없으면 null. */
function valueOf(args: string[], flag: string): string | null {
  const i = args.indexOf(flag)
  return i >= 0 ? (args[i + 1] ?? null) : null
}

describe('claudeCodePermissionArgs — 도구 집합', () => {
  it('읽기 전용은 --tools로 편집 도구를 아예 없앤다', () => {
    // --allowedTools만으로는 안 된다. 그것은 "있는 도구를 묻지 않고 승인"이지
    // "없앤다"가 아니다 (실측 노트 Q22). 이 구분을 놓치면 읽기 전용 run에서
    // 파일이 수정될 수 있다.
    const args = claudeCodePermissionArgs('read_only')
    const tools = valueOf(args, '--tools')
    expect(tools).not.toBeNull()
    for (const forbidden of ['Edit', 'Write', 'NotebookEdit', 'Bash']) {
      expect(tools!.split(',')).not.toContain(forbidden)
    }
    expect(tools!.split(',')).toContain('Read')
  })

  it('읽기 전용은 편집 도구를 disallowedTools에도 적는다', () => {
    const args = claudeCodePermissionArgs('read_only')
    expect(valueOf(args, '--disallowedTools')).toBe('Bash,Edit,Write,NotebookEdit')
  })

  it('편집 허용은 편집 도구를 살리고 Bash는 막는다', () => {
    const args = claudeCodePermissionArgs('edit')
    const tools = valueOf(args, '--tools')!.split(',')
    expect(tools).toContain('Edit')
    expect(tools).not.toContain('Bash')
    expect(valueOf(args, '--disallowedTools')).toBe('Bash')
  })

  it('전체 허용은 도구를 제한하지 않는다', () => {
    const args = claudeCodePermissionArgs('full')
    expect(args).not.toContain('--tools')
    expect(args).not.toContain('--disallowedTools')
  })
})

describe('claudeCodePermissionArgs — MCP 승인', () => {
  it('세 단계 모두 allowedTools에 MCP 접두사를 넣는다', () => {
    // --permission-mode는 MCP 도구를 자동 승인하지 않는다 (실측 노트 Q22).
    // 빠뜨리면 agent가 issue/memo를 전혀 못 고치는데 실패가 조용하다.
    for (const p of ALL) {
      const allowed = valueOf(claudeCodePermissionArgs(p, ['mcp__onedesk']), '--allowedTools')
      expect(allowed, `${p}에 MCP 접두사가 없다`).not.toBeNull()
      expect(allowed!.split(',')).toContain('mcp__onedesk')
    }
  })

  it('접두사가 없으면 전체 허용에는 allowedTools 자체가 붙지 않는다', () => {
    expect(claudeCodePermissionArgs('full')).not.toContain('--allowedTools')
  })

  it('접두사를 넣어도 ask는 생기지 않는다', () => {
    for (const p of ALL) {
      expect(claudeCodePermissionArgs(p, ['mcp__onedesk']).join(' ')).not.toContain('ask')
    }
  })
})
