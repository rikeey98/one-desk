import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevronLeft, IconChevronRight } from './icons'
import {
  clampListWidth, readListHidden, readListWidth, writeListHidden, writeListWidth,
  DEFAULT_LIST_PX, LIST_STEP_PX
} from '../listWidth'
import type { PanelKind } from '@shared/panelWindow'

/**
 * 패널 창의 목록 폭과 숨김 (docs/sdlc/item-windows/ FR-26~28).
 *
 * 상태는 `PanelWindow`가 쥐고 Context로 내린다 — 숨기기 버튼은 패널 헤더에, 경계는 패널 몸통에 있어 둘이 같은
 * 값을 봐야 한다. 앱 창에는 Provider가 없다: 그곳의 패널은 이것을 쓰지 않는다(`layout="window"`일 때만).
 */
interface SplitState {
  width: number
  hidden: boolean
  /** `persist`면 곧바로 저장한다 — 키보드·두 번 누르기. 끌기는 끝날 때 `commitWidth`로 한 번만 저장한다 */
  setWidth: (px: number, persist?: boolean) => void
  commitWidth: () => void
  toggleHidden: () => void
}

const SplitContext = createContext<SplitState | null>(null)

export function WindowSplitProvider({ kind, children }: { kind: PanelKind; children: ReactNode }) {
  const [width, setWidthState] = useState(() => readListWidth(kind))
  const [hidden, setHidden] = useState(() => readListHidden(kind))
  const latest = useRef(width)
  latest.current = width

  const value: SplitState = {
    width,
    hidden,
    setWidth: (px, persist = false) => {
      const next = clampListWidth(px, window.innerWidth)
      setWidthState(next)
      if (persist) writeListWidth(kind, next)
    },
    commitWidth: () => writeListWidth(kind, latest.current),
    toggleHidden: () => {
      setHidden((h) => {
        writeListHidden(kind, !h)
        return !h
      })
    }
  }
  return <SplitContext.Provider value={value}>{children}</SplitContext.Provider>
}

function useSplit(): SplitState {
  const state = useContext(SplitContext)
  if (!state) throw new Error('WindowSplitProvider 안에서만 사용할 수 있습니다')
  return state
}

/**
 * 패널 헤더의 `목록 숨기기` / `목록 보이기` (FR-26). "접기"·"펼치기"는 턴의 `접기`와 부분 일치로 부딪혀 쓰지 않는다.
 */
export function ListToggleButton() {
  const { hidden, toggleHidden } = useSplit()
  const label = hidden ? '목록 보이기' : '목록 숨기기'
  return (
    <button
      type="button"
      className="icon-button icon-button-sm"
      aria-label={label}
      title={label}
      aria-pressed={hidden}
      onClick={toggleHidden}
    >
      {hidden ? <IconChevronRight /> : <IconChevronLeft />}
    </button>
  )
}

/**
 * 목록 | 경계 | 상세. 숨긴 목록은 **언마운트하지 않는다**(`hidden`) — 추가 칸에 치던 글자가 남는다.
 * 그리는 폭은 지금 창으로 다시 자른다 — 큰 창에서 넓혀 두고 창을 줄여도 상세가 사라지지 않는다.
 */
export function WindowSplit({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  const { width, hidden, setWidth, commitWidth } = useSplit()
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 포인터를 창 어디로 끌어도 따라와야 하므로 window에 건다 (Dock의 경계와 같은 방식).
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current
      if (!d) return
      setWidth(d.startWidth + (e.clientX - d.startX))
    }
    function onUp() {
      if (!drag.current) return
      drag.current = null
      commitWidth()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [setWidth, commitWidth])

  const shown = clampListWidth(width, viewport)
  return (
    <div className="panel-split window-split">
      <div className="panel-split-list" hidden={hidden} style={{ flexBasis: shown }}>{list}</div>
      {!hidden && (
        <div
          role="separator"
          aria-label="목록 폭 조절"
          aria-orientation="vertical"
          aria-valuenow={Math.round(shown)}
          tabIndex={0}
          className="window-splitter"
          onPointerDown={(e) => {
            // preventDefault를 부르지 않는다 — 뒤따르는 dblclick(기본 폭으로)이 죽는다. 글자 선택은 CSS가 막는다.
            drag.current = { startX: e.clientX, startWidth: shown }
          }}
          onDoubleClick={() => setWidth(DEFAULT_LIST_PX, true)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            setWidth(shown + (e.key === 'ArrowRight' ? LIST_STEP_PX : -LIST_STEP_PX), true)
          }}
        />
      )}
      <div className="panel-split-detail">{detail}</div>
    </div>
  )
}
