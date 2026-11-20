import type { Permission } from '@shared/models'
import { MCP_SERVER_NAME } from '../mcp/configFile'

/**
 * 읽기 전용에서 살려둘 빌트인 도구 (Claude Code 2.1.x 기준, 실측 노트 Q22).
 *
 * **할 일 도구는 두 벌이다** (`docs/sdlc/conversation-fixes/` spec FR-15). 2.1.280은 기본이
 * `TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`이고 `TodoWrite`는 `CLAUDE_CODE_ENABLE_TASKS`가
 * false일 때만 켜진다. `--tools`는 화이트리스트라 Task*를 빠뜨리면 할 일 도구가 하나도 남지
 * 않는데 실패는 조용하다 — 모델이 그 도구를 못 볼 뿐이다. `TodoWrite`는 구버전·환경변수
 * 경로를 위해 남긴다. 어느 쪽도 파일을 건드리지 않는다.
 */
const READ_ONLY_TOOLS = [
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList'
]

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

/** OpenCode가 one-desk MCP 서버의 도구에 붙이는 이름(`<서버>_<도구>`)의 와일드카드 */
const ONE_DESK_MCP_KEY = `${MCP_SERVER_NAME}_*`

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
  // one-desk의 MCP 도구만 연다 — `"*": "deny"`가 MCP 도구(`<서버>_<도구>`)를 모델에게서 지우면 읽기 전용 대화가 list_issues·propose_issue를
  // 못 쓴다(agent-proposals §8의 6, 2026-10-27 사용자 결정 "one-desk MCP만 허용"). 쓰기 도구는 서버가 권한으로 등록하지 않는다
  config[ONE_DESK_MCP_KEY] = 'allow'
  // 편집 허용은 파일 수정만 더 연다. bash는 그대로 막힌다 (전체 설계 §7).
  if (permission === 'edit') config['edit'] = 'allow'
  return config
}

/** opencode 2.x의 권한 규칙 하나. **`ask`가 없고 resource는 `*`뿐이다** — 둘 다 타입이다 (opencode-v2 spec FR-4) */
export interface OpencodeRule {
  action: string
  /**
   * 늘 전체다. 2.x의 판정은 도구가 뽑아 준 resource마다 규칙을 보는데, 뽑을 것이 없으면(셸의 `exit 3`) 볼 규칙도 없어
   * 통과한다(spec 0-2 실측) — 좁힌 resource의 deny는 샌다. action 전체를 막으면 그 도구가 모델에게서 사라진다.
   */
  resource: '*'
  effect: 'allow' | 'deny'
}

const rule = (action: string, effect: OpencodeRule['effect']): OpencodeRule => ({ action, resource: '*', effect })

/**
 * 읽기 전용에서 살려두는 2.x action. 2.3.2의 도구 목록(전부 허용으로 실측)에서 파일·프로세스를 건드리지 않는 것이다 —
 * 1.x의 `list`·`lsp`·`todowrite`에 해당하는 도구는 2.x에 없다(plan §0).
 */
const OPENCODE_V2_READ_ACTIONS = ['read', 'grep', 'glob', 'webfetch', 'websearch']

/**
 * 권한 단계를 opencode 2.x의 규칙 목록으로 바꾼다 (opencode-v2 spec FR-4).
 *
 * **순서가 뜻이다** — 2.x는 뒤에 온 규칙이 이긴다. 첫 규칙 `* deny`가 앞선 출처(agent 기본값·프로젝트 설정)를 전부 덮고,
 * 그 뒤의 allow가 다시 여는 것만 남는다. 1.x처럼 키를 전부 적을 필요가 없다.
 *
 * - `edit` 하나가 edit·write 두 도구를 연다(실측). 편집 허용에도 `shell`·`execute`는 없다 (전체 설계 §7).
 * - one-desk MCP 도구는 action이 `<서버>_<도구>`다 — 와일드카드로 그 서버만 연다(1.x의 `ONE_DESK_MCP_KEY`와 같은 모양).
 * - 전체 허용은 `* allow` 하나다. `--auto`를 붙이지 않는다(FR-7) — 권한의 출처가 이 목록 하나다.
 */
export function opencodeV2Rules(permission: Permission): OpencodeRule[] {
  if (permission === 'full') return [rule('*', 'allow')]
  const rules = [
    rule('*', 'deny'),
    ...OPENCODE_V2_READ_ACTIONS.map((action) => rule(action, 'allow')),
    rule(ONE_DESK_MCP_KEY, 'allow')
  ]
  if (permission === 'edit') rules.push(rule('edit', 'allow'))
  return rules
}

/** 우리가 못박는 agent. run은 늘 `--agent build`로 뜬다 (opencode-v2 spec FR-6) */
export const OPENCODE_V2_AGENT = 'build'

/**
 * `OPENCODE_CONFIG_CONTENT`에 실을 객체 (opencode-v2 spec FR-5).
 *
 * **같은 목록을 두 자리에 넣는다.** 2.x가 규칙을 붙이는 순서는 agent 기본값 → 프로젝트 최상위 → 환경변수 최상위 →
 * 프로젝트 `agents.<id>` → 환경변수 `agents.<id>`다(spec 0-1 실측). 최상위에만 넣으면 프로젝트의
 * `agents.build.permissions`가 우리 deny 뒤에 붙어 셸을 다시 연다. **규칙 말고는 싣지 않는다** — 이 환경변수는 agent의
 * 셸 도구가 띄우는 자식에게 물려지므로 토큰·URL이 여기 있으면 안 된다(FR-12).
 */
export function opencodeV2Config(permission: Permission): {
  permissions: OpencodeRule[]
  agents: Record<typeof OPENCODE_V2_AGENT, { permissions: OpencodeRule[] }>
} {
  return {
    permissions: opencodeV2Rules(permission),
    agents: { [OPENCODE_V2_AGENT]: { permissions: opencodeV2Rules(permission) } }
  }
}
