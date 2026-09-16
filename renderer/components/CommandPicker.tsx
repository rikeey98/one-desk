import type { CommandInfo } from '@shared/models'

export function CommandPicker({ commands, selectedIndex, loading, error, onPick, onRefresh }: {
  commands: CommandInfo[]
  selectedIndex: number
  loading: boolean
  error: string | null
  onPick: (command: CommandInfo) => void
  onRefresh: () => void
}) {
  return (
    <div className="command-picker">
      <div className="command-picker-header">
        <span>커맨드 · ↑↓ 선택 · Enter/Tab 삽입 · Esc 닫기</span>
        <button type="button" disabled={loading} onClick={onRefresh}>커맨드 새로고침</button>
      </div>
      {loading && <div role="status">불러오는 중…</div>}
      {error && <div role="alert">{error}</div>}
      {!loading && !error && commands.length === 0 && <div role="status">일치하는 커맨드가 없습니다</div>}
      <div role="listbox" aria-label="슬래시 커맨드">
        {commands.map((command, index) => (
          <button
            type="button"
            role="option"
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
