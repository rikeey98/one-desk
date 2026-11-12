import { useState, useSyncExternalStore } from 'react'
import { readSidebarCollapsed, writeSidebarCollapsed } from '../sidebarCollapsed'

/**
 * 이 폭 아래에서는 사이드바(236px)를 펴 두면 세 패널이 제목 목록 폭까지 눌린다. CSS 픽셀이라 200% 확대도 걸린다
 * (better-layout 검토, 2026-11-09).
 */
export const NARROW_WINDOW_QUERY = '(max-width: 900px)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(NARROW_WINDOW_QUERY)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

const isNarrow = () => window.matchMedia?.(NARROW_WINDOW_QUERY).matches ?? false

/**
 * 사이드바를 접었는가. 넓은 창에서는 사람이 정한 값(이 장비에 기억)이고, 좁은 창에서는 접힌 채 시작한다. 좁은 동안 펼친 것은
 * 기억하지 않는다 — 창이 넓어지면 기억한 값으로, 다시 좁아지면 또 접힌 채로 돌아간다.
 */
export function useSidebarCollapse(): { collapsed: boolean, narrow: boolean, toggle: () => void, expand: () => void } {
  const narrow = useSyncExternalStore(subscribe, isNarrow, () => false)
  const [stored, setStored] = useState(readSidebarCollapsed)
  const [narrowOpen, setNarrowOpen] = useState(false)
  const [seenNarrow, setSeenNarrow] = useState(narrow)
  if (seenNarrow !== narrow) {
    setSeenNarrow(narrow)
    setNarrowOpen(false)
  }

  const persist = (next: boolean) => {
    setStored(next)
    writeSidebarCollapsed(next)
  }
  return {
    collapsed: narrow ? !narrowOpen : stored,
    narrow,
    toggle: () => { if (narrow) setNarrowOpen(!narrowOpen); else persist(!stored) },
    expand: () => { if (narrow) setNarrowOpen(true); else if (stored) persist(false) }
  }
}
