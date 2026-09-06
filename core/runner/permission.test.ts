import { describe, it, expect } from 'vitest'
import { claudeCodePermissionArgs, opencodePermissionConfig, OPENCODE_PERMISSION_KEYS } from './permission'
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

describe('opencodePermissionConfig', () => {
  it.each(ALL)('%s에 ask가 하나도 없다', (level) => {
    // 설계 §7·§382. 헤드리스에서 ask는 곧 무한 대기다.
    const values = Object.values(opencodePermissionConfig(level))
    expect(values).not.toContain('ask')
    expect(values.every((v) => v === 'allow' || v === 'deny')).toBe(true)
  })

  it.each(ALL)('%s가 알려진 키 15개를 전부 명시한다', (level) => {
    // 이름을 대지 않은 키는 repo·전역 설정의 값이 그대로 살아남는다 (설계 §2-1).
    const config = opencodePermissionConfig(level)
    for (const key of OPENCODE_PERMISSION_KEYS) {
      expect(config, `${key}가 빠졌다`).toHaveProperty(key)
    }
  })

  it('키 목록이 실측한 15개다', () => {
    expect([...OPENCODE_PERMISSION_KEYS].sort()).toEqual([
      'bash', 'doom_loop', 'edit', 'external_directory', 'glob', 'grep',
      'list', 'lsp', 'question', 'read', 'skill', 'task', 'todowrite',
      'webfetch', 'websearch'
    ])
  })

  it('읽기 전용은 읽기만 연다', () => {
    const config = opencodePermissionConfig('read_only')
    expect(config['read']).toBe('allow')
    expect(config['grep']).toBe('allow')
    expect(config['edit']).toBe('deny')
    expect(config['bash']).toBe('deny')
    expect(config['*']).toBe('deny')
  })

  it('편집 허용은 edit만 더 연다 — bash는 여전히 막힌다', () => {
    // 전체 설계 §7 "파일 수정 자동 승인, 그 외 차단".
    const config = opencodePermissionConfig('edit')
    expect(config['edit']).toBe('allow')
    expect(config['bash']).toBe('deny')
  })

  it('전체 허용은 전부 연다', () => {
    const config = opencodePermissionConfig('full')
    expect(config['bash']).toBe('allow')
    expect(config['*']).toBe('allow')
    expect(Object.values(config).every((v) => v === 'allow')).toBe(true)
  })

  it('question은 전체 허용에서만 열린다', () => {
    // OpenCode에는 사람에게 되묻는 도구가 따로 있다. 헤드리스에서 열려 있으면
    // 답할 사람 없이 멈춘다 (설계 §3-2).
    expect(opencodePermissionConfig('read_only')['question']).toBe('deny')
    expect(opencodePermissionConfig('edit')['question']).toBe('deny')
    expect(opencodePermissionConfig('full')['question']).toBe('allow')
  })
})
