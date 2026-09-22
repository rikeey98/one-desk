import type { AgentKind } from '@shared/models'

/**
 * Claude Code의 모델 별칭 (docs/sdlc/agent-setup/ FR-9).
 *
 * **이 표는 낡는다. 그래도 아무도 막지 않는다.**
 *
 * claude에는 모델 목록을 조회할 수단이 없다 — 서브커맨드에 `models`가 없고
 * `--help`가 별칭을 산문으로만 설명한다(2026-09-22 실측). 그래서 앱이 표를
 * 들고 있을 수밖에 없는데, 표가 낡아도 **새 모델을 못 쓰게 되지는 않는다**:
 * 모델 칸은 `<select>`가 아니라 `<input>` + `<datalist>`이고, 목록에 없는
 * 이름도 그대로 저장돼 실행에 쓰인다(FR-8). 그것이 드롭다운 강제안 대신
 * 이 모양을 고른 이유의 전부다.
 *
 * **그러니 여기에 검증을 붙이지 말 것.** 제안일 뿐이다.
 */
export const CLAUDE_MODEL_SUGGESTIONS: readonly string[] = [
  'fable',
  'opus',
  'sonnet',
  'haiku'
]

/**
 * 이 agent의 모델 칸에 붙일 제안 목록.
 *
 * opencode는 `opencode models`가 준 값을 그대로 쓴다(실측 382개). claude는
 * 조회할 수 없으므로 위의 별칭 표를 쓴다 — **서로의 구멍을 서로가 메운다.**
 */
export function modelSuggestionsOf(kind: AgentKind, probed: readonly string[]): string[] {
  if (kind === 'opencode') return [...probed]
  // 조회된 것이 있으면 그것을 먼저 두고 별칭을 뒤에 붙인다. 지금 claude는
  // 조회가 불가능해 probed가 늘 비지만, 나중에 수단이 생기면 이 자리가 그대로 쓰인다.
  return [...probed, ...CLAUDE_MODEL_SUGGESTIONS.filter((m) => !probed.includes(m))]
}

/** 모델 칸의 placeholder. 형식이 agent마다 달라 예시도 달라야 한다(전체 설계 §199) */
export function modelPlaceholderOf(kind: AgentKind): string {
  return kind === 'opencode' ? '기본값 (예: anthropic/claude-sonnet-4-5)' : '기본값 (예: sonnet)'
}
