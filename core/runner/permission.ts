import type { Permission } from '@shared/models'

/** 읽기 전용에서 살려둘 빌트인 도구 (Claude Code 2.1.x 기준, 실측 노트 Q22) */
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite']

/** 편집 허용에서 추가되는 빌트인 도구 */
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit']

/**
 * 권한 단계를 Claude Code CLI 인자로 바꾼다.
 *
 * 세 플래그가 하는 일이 서로 다르다 (실측 노트 Q22).
 * - `--tools`         그 도구를 **존재하지 않게** 만든다. 모델이 아예 못 본다.
 * - `--allowedTools`  존재하는 도구를 **묻지 않고 승인**한다.
 * - `--disallowedTools` 존재하는 도구를 **항상 거부**한다.
 *
 * 읽기 전용에는 `--tools`가 본질적이다. 도구가 없으면 모델이 시도조차 하지 않아
 * 거부 잡음도 없고 프롬프트 인젝션으로 우회할 여지도 없다.
 *
 * 절대 규칙: 어떤 경우에도 'ask'로 떨어지는 설정을 만들지 않는다 (설계 §7).
 * 헤드리스 실행에서는 물어볼 사람이 없어 프로세스가 그대로 멈춘다.
 *
 * @param mcpToolPrefixes 자동 승인할 MCP 서버 이름(`mcp__onedesk`).
 *   `--permission-mode`가 MCP 도구를 커버하지 않으므로 반드시 필요하다.
 */
export function claudeCodePermissionArgs(
  permission: Permission,
  mcpToolPrefixes: string[] = []
): string[] {
  switch (permission) {
    case 'read_only': {
      const tools = READ_ONLY_TOOLS
      return [
        '--tools', tools.join(','),
        '--allowedTools', [...tools, ...mcpToolPrefixes].join(','),
        // --tools로 이미 사라졌지만 의도를 명시해 둔다.
        '--disallowedTools', 'Bash,Edit,Write,NotebookEdit',
        // 편집 도구가 없으므로 승인할 편집도 없다. 이름이 오해를 부르지만
        // dontAsk의 의미가 문서화돼 있지 않아(노트 Q22) 검증 없이 바꾸지 않는다.
        '--permission-mode', 'acceptEdits'
      ]
    }

    case 'edit': {
      const tools = [...READ_ONLY_TOOLS, ...EDIT_TOOLS]
      return [
        // Bash는 여전히 없다 — 설계 §7의 "파일 수정 자동 승인, 그 외 차단".
        '--tools', tools.join(','),
        '--allowedTools', [...tools, ...mcpToolPrefixes].join(','),
        '--disallowedTools', 'Bash',
        '--permission-mode', 'acceptEdits'
      ]
    }

    case 'full':
      return [
        '--permission-mode', 'bypassPermissions',
        // bypassPermissions가 MCP까지 덮는지는 미확인이므로 명시적으로도 넣는다.
        ...(mcpToolPrefixes.length ? ['--allowedTools', mcpToolPrefixes.join(',')] : [])
      ]
  }
}

/**
 * OpenCode의 권한 키. config 스키마 `$defs.PermissionConfig`가 열거하는 것
 * 그대로다 (1.18.27 실측, 15개).
 *
 * **전부 명시해야 한다.** OpenCode는 설정을 키 단위로 병합하므로, 이름을 대지
 * 않은 키는 프로젝트 `opencode.json`이나 전역 설정의 값이 그대로 살아남는다.
 * 거기 `ask`가 있으면 헤드리스 실행이 답할 사람 없이 멈춘다 (설계 §2-1·§3-1).
 */
export const OPENCODE_PERMISSION_KEYS = [
  'bash', 'doom_loop', 'edit', 'external_directory', 'glob', 'grep', 'list',
  'lsp', 'question', 'read', 'skill', 'task', 'todowrite', 'webfetch', 'websearch'
] as const

/** 읽기 전용에서 살려두는 키. 위 READ_ONLY_TOOLS와 대응이 어긋나지 않게 유지한다. */
const OPENCODE_READ_KEYS = [
  'read', 'glob', 'grep', 'list', 'lsp', 'todowrite', 'webfetch', 'websearch'
]

/**
 * 권한 단계를 `OPENCODE_PERMISSION` 환경변수에 실을 객체로 바꾼다.
 *
 * **파일이 아니라 환경변수인 이유:** `OPENCODE_CONFIG`가 가리키는 파일은 run의
 * cwd에 있는 `opencode.json`에게 진다. 환경변수만이 그것을 이긴다 (설계 §2).
 *
 * `"*"`도 넣지만 그것은 미래에 생길 키를 위한 것이지 보호 수단이 아니다 —
 * 구체적인 키가 와일드카드를 이긴다 (설계 §2-2).
 *
 * 절대 규칙: 어떤 경우에도 'ask'를 만들지 않는다 (설계 §7).
 */
export function opencodePermissionConfig(
  permission: Permission
): Record<string, 'allow' | 'deny'> {
  const config: Record<string, 'allow' | 'deny'> = {}

  if (permission === 'full') {
    config['*'] = 'allow'
    for (const key of OPENCODE_PERMISSION_KEYS) config[key] = 'allow'
    return config
  }

  config['*'] = 'deny'
  for (const key of OPENCODE_PERMISSION_KEYS) config[key] = 'deny'
  for (const key of OPENCODE_READ_KEYS) config[key] = 'allow'
  // 편집 허용은 파일 수정만 더 연다. bash는 그대로 막힌다 (전체 설계 §7).
  if (permission === 'edit') config['edit'] = 'allow'
  return config
}
