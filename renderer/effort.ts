import type { AgentKind } from '@shared/models'

/**
 * Claude Code의 `--effort` 다섯 단계 (docs/sdlc/agent-setup/ FR-12).
 *
 * **첫 항목이 빈 값이고 그것이 기본이다.** 모델 칸과 같은 규칙이다 — 비우면
 * `--effort`를 아예 붙이지 않아 CLI 자신의 기본값으로 돈다. 빈 항목을 빼면
 * "한 번 고른 뒤에는 되돌릴 수 없는" 칸이 된다.
 *
 * **나열 순서가 곧 강도 순서다** — 드롭다운 순서가 여기서 나온다.
 *
 * `renderer/permission.ts`와 같은 자리·같은 이유다. 실행 패널과 설정 화면이
 * 이 표 하나를 나눠 쓴다 — 두 화면이 같은 값을 다른 말로 부르면 안 된다(FR-11).
 */
export const EFFORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '기본값' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' }
]

/**
 * 이 agent에서 실행 조건 칸을 무엇이라 부르는가.
 *
 * **OpenCode는 드롭다운이 아니다.** `--variant`는 provider별 reasoning effort라
 * 값의 표가 provider마다 다르다 — 다섯 단계로 묶으면 그 표가 거짓말이 된다
 * (FR-13, 전체 설계 §199가 모델을 가른 것과 같은 이유).
 */
export function effortFieldOf(kind: AgentKind): {
  label: string
  /** 참이면 드롭다운, 거짓이면 자유 입력 */
  fixedOptions: boolean
  hint: string
} {
  return kind === 'opencode'
    ? {
        label: 'variant',
        fixedOptions: false,
        hint: 'provider마다 값이 다릅니다 (예: high, max, minimal)'
      }
    : {
        label: 'effort',
        fixedOptions: true,
        hint: '비우면 CLI 자신의 기본값으로 돕니다'
      }
}
