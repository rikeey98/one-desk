import type { Permission } from '@shared/models'

/** 읽기 전용에서 허용할 도구. 이 목록 밖은 전부 차단된다. */
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite']

/**
 * 권한 단계를 Claude Code CLI 인자로 바꾼다.
 *
 * 절대 규칙: 어떤 경우에도 'ask'로 떨어지는 설정을 만들지 않는다 (설계 §7).
 * 헤드리스 실행에서는 물어볼 사람이 없어 프로세스가 그대로 멈춘다.
 */
export function claudeCodePermissionArgs(permission: Permission): string[] {
  switch (permission) {
    case 'read_only':
      // 화이트리스트 방식. permission-mode를 쓰지 않는다 —
      // acceptEdits는 이름과 달리 편집을 허용해버린다.
      return ['--allowedTools', READ_ONLY_TOOLS.join(',')]
    case 'edit':
      return ['--permission-mode', 'acceptEdits']
    case 'full':
      return ['--permission-mode', 'bypassPermissions']
  }
}
