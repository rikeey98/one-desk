import type { PanelKind } from '@shared/panelWindow'

/**
 * 패널 종류의 화면 이름 (docs/sdlc/item-windows/). 여는 버튼의 이름(`이슈 새 창으로 열기`)과 패널 창의
 * 제목(`이슈 · api`)이 같은 표를 쓴다 — 따로 적으면 같은 창을 두 곳이 다른 말로 부른다.
 */
export const PANEL_KIND_LABELS: Record<PanelKind, string> = {
  issue: '이슈',
  memo: '메모',
  asset: 'skill'
}
