import type { ContextItemType } from '@shared/models'

/**
 * 실행 패널에 담긴 맥락 항목.
 * 화면에 이름을 보여야 하므로 id만 있는 ContextItemRef에 label을 더한다.
 * 실행 요청으로 넘길 때는 type과 id만 쓴다.
 */
export interface ContextChip {
  type: ContextItemType
  id: string
  label: string
}

export function chipKey(chip: { type: ContextItemType; id: string }): string {
  return `${chip.type}:${chip.id}`
}
