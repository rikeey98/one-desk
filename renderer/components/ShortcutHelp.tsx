import { useEffect, useRef } from 'react'
import { SHORTCUTS, runShortcutLabel, shortcutLabel } from '../shortcut'
import { IconClose } from './icons'

/**
 * `?`로 뜨는 단축키 목록 (docs/sdlc/ux-polish/ FR-8). 모달이 아니라 `popover`다 — 뒤의 화면을 막지 않고, Esc 사다리(FR-39)의
 * 맨 안쪽에 선다. 표는 `renderer/shortcut.ts` 하나다 — 여기 따로 적지 않는다.
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const platform = navigator.platform

  useEffect(() => {
    const el = ref.current
    // jsdom에는 popover API가 없다 — 그때는 보통 요소로 보인다(슬래시 피커와 같은 규칙).
    el?.showPopover?.()
    el?.focus()
    return () => { el?.hidePopover?.() }
  }, [])

  return (
    <div
      ref={ref}
      className="shortcut-help"
      role="dialog"
      aria-label="단축키"
      tabIndex={-1}
      popover="manual"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
    >
      <header className="shortcut-help-head">
        <span>단축키</span>
        <button type="button" className="row-action" aria-label="단축키 목록 닫기" title="닫기 (Esc)" onClick={onClose}>
          <IconClose />
        </button>
      </header>
      <dl className="shortcut-list">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="shortcut-row">
            <dt>{s.label}</dt>
            <dd><kbd>{shortcutLabel(s, platform)}</kbd></dd>
          </div>
        ))}
        <div className="shortcut-row">
          <dt>지시 보내기</dt>
          <dd><kbd>{runShortcutLabel(platform)}</kbd></dd>
        </div>
        <div className="shortcut-row">
          <dt>안쪽부터 닫기</dt>
          <dd><kbd>Esc</kbd></dd>
        </div>
      </dl>
    </div>
  )
}
