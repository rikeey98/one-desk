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
