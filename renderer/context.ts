import type { ContextItemType } from '@shared/models'

/**
 * 실행 패널에 담긴 맥락 항목.
 * 화면에 이름을 보여야 하므로 id만 있는 ContextItemRef에 label을 더한다.
 * 실행 요청으로 넘길 때는 type과 id만 쓴다.
 * 이슈 칩만 repo 태그를 든다 — 새 대화의 작업 디렉토리가 그것을 따른다 (docs/sdlc/issue-flow/ FR-3).
 */
export type ContextChip =
  | { type: 'issue'; id: string; label: string; repoIds: string[] }
  | { type: Exclude<ContextItemType, 'issue'>; id: string; label: string }

export function chipKey(chip: { type: ContextItemType; id: string }): string {
  return `${chip.type}:${chip.id}`
}

/**
 * 패널의 담기 토글이 쓰는 것 — 담긴 것의 키와 토글. 앱 창의 도크가 쥔 state라 **패널 창에는 없다**
 * (docs/sdlc/item-windows/ FR-8). 없으면 패널이 담기 토글을 그리지 않는다.
 */
export interface ContextPicker {
  keys: Set<string>
  onToggle: (chip: ContextChip) => void
}
