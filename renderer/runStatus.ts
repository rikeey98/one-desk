import type { RunStatus } from '@shared/models'

/**
 * run 상태의 화면 이름 (`docs/sdlc/conversation-timeline/` spec FR-45).
 *
 * **영어 enum이 화면에 나가지 않는다.** 대화록의 상태 알약과 도크 목록 상태 점의
 * `aria-label`·`title`이 이 표 하나를 쓴다 — `permission.ts`와 같은 자리·같은 이유다
 * (CLAUDE.md "하나의 enum을 옮겨 적은 표는 공유한다").
 *
 * **클래스(`status-succeeded` 등)는 enum 그대로 둔다** — 색과 e2e 셀렉터가 거기 걸려 있다.
 * `shared/`가 아니라 여기 두는 것은 core가 이 이름을 쓰지 않아서다. 인박스 카테고리의
 * 이름(`shared/inbox.ts`)은 다른 개념이다.
 */
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  pending: '대기 중',
  running: '실행 중',
  succeeded: '완료',
  failed: '실패',
  canceled: '취소됨',
  interrupted: '중단됨'
}
