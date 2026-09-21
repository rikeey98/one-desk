import { useEffect, useRef } from 'react'
import type { CommandInfo } from '@shared/models'

export function CommandPicker({ id, optionId, commands, selectedIndex, loading, error, onPick, onRefresh }: {
  /** listbox의 id. 입력창의 aria-controls가 이것을 가리킨다. */
  id: string
  /** option의 id. 입력창의 aria-activedescendant가 고른 항목을 이것으로 가리킨다. */
  optionId: (name: string) => string
  commands: CommandInfo[]
  selectedIndex: number
  loading: boolean
  error: string | null
  onPick: (command: CommandInfo) => void
  onRefresh: () => void
}) {
  // 인라인이 아니라 최상위 레이어(popover)에 띄운다 — 그래야 "/"를 칠 때 위 내용이 밀리지
  // 않고 .dock-body의 overflow에도 잘리지 않는다. 자리는 CSS anchor positioning이 정한다
  // (index.css의 .command-picker). 열고 닫는 것은 React의 마운트/언마운트가 맡으므로
  // 마운트 때 한 번만 연다. jsdom에는 togglePopover가 없어 옵셔널로 부른다.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { root.current?.togglePopover?.(true) }, [])

  return (
    <div className="command-picker" ref={root} popover="manual">
      <div className="command-picker-header">
        <span>커맨드 · ↑↓ 선택 · Enter/Tab 삽입 · Esc 닫기</span>
        <button type="button" disabled={loading} onClick={onRefresh}>커맨드 새로고침</button>
      </div>
      {loading && <div role="status">불러오는 중…</div>}
      {error && <div role="alert">{error}</div>}
      {!loading && !error && commands.length === 0 && <div role="status">일치하는 커맨드가 없습니다</div>}
      <div role="listbox" id={id} aria-label="슬래시 커맨드">
        {commands.map((command, index) => (
          <button
            type="button"
            role="option"
            id={optionId(command.name)}
            aria-selected={selectedIndex === index}
            key={command.name}
            className="command-option"
            ref={(node) => { if (selectedIndex === index) node?.scrollIntoView?.({ block: 'nearest' }) }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(command)}
          >
            <strong>/{command.name}</strong>
            {command.description && <span>{command.description}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
