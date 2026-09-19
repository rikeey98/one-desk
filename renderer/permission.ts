import type { Permission } from '@shared/models'

/**
 * 권한 세 단계의 화면 이름 (전체 설계 §7).
 *
 * **실행 패널과 설정 화면이 공유한다.** 같은 값을 두 화면이 다른 말로 부르면
 * "편집 허용"으로 기본값을 정해 두고 실행 패널에서 다른 이름을 보게 된다.
 * issue/memo의 "의도된 중복"과는 다른 자리다 — 그쪽은 앞으로 갈라질 두 도메인이고
 * 이것은 하나의 enum을 옮겨 적은 표다.
 *
 * **나열 순서가 곧 좁은 순서다** — 드롭다운 순서가 여기서 나온다.
 */
export const PERMISSION_LABELS: Record<Permission, string> = {
  read_only: '읽기 전용',
  edit: '편집 허용',
  full: '전체 허용'
}
