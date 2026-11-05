import { chipKey, type ContextChip, type ContextPicker } from '../context'
import { IconCheck, IconPlus } from './icons'

/** 자리마다 버튼에 쓰는 글자(담기 전, 담긴 뒤). 사이드바 repo 줄은 자리가 없어 아이콘뿐이다. */
const WORDS = {
  row: ['담기', '담김'],
  header: ['대화에 담기', '대화에 담김'],
  repo: null
} as const

/**
 * 대화에 담는 버튼. 이슈·메모·asset의 줄, 열린 항목의 패널 헤더, 사이드바 repo 줄이 같이 쓴다.
 *
 * 헤더의 이름에 항목 제목을 넣지 않는다 — 상세가 열려도 목록은 DOM에 남아 있어 같은 이름이 둘이 된다.
 */
export function ContextPick({ chip, picker, place }: {
  chip: ContextChip
  picker: ContextPicker
  place: keyof typeof WORDS
}) {
  const picked = picker.keys.has(chipKey(chip))
  const words = WORDS[place]
  return (
    <button
      type="button"
      className={picked ? 'item-pick item-picked' : 'item-pick'}
      aria-label={place === 'header' ? '대화에 담기' : `${chip.label} 맥락에 담기`}
      aria-pressed={picked}
      title={picked ? '대화에서 빼기' : '대화에 담기'}
      onClick={() => picker.onToggle(chip)}
    >
      {picked ? <IconCheck width="12" height="12" /> : <IconPlus width="12" height="12" />}
      {words && <span className="item-pick-text">{words[picked ? 1 : 0]}</span>}
    </button>
  )
}
