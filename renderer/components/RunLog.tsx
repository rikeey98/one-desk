import type { RunEvent } from '@shared/events'

function line(event: RunEvent): { className: string; text: string } {
  switch (event.type) {
    case 'session':
      return { className: 'log-meta', text: `세션 ${event.sessionId}` }
    case 'text':
      return { className: 'log-text', text: event.text }
    case 'tool_use':
      return { className: 'log-tool', text: `→ ${event.name} ${event.targetPaths[0] ?? ''}`.trimEnd() }
    case 'tool_result':
      return {
        className: event.ok ? 'log-meta' : 'log-error',
        text: event.ok ? `  ${event.summary}` : `  실패: ${event.summary}`
      }
    case 'error':
      return { className: 'log-error', text: event.message }
    case 'raw':
      return { className: 'log-error', text: event.line }
    case 'result':
      return { className: 'log-result', text: event.resultText }
  }
}

export function RunLog({ events }: { events: readonly RunEvent[] }) {
  if (events.length === 0) {
    return <div className="panel-empty">아직 출력이 없습니다</div>
  }

  return (
    <div className="run-log">
      {events.map((event) => {
        const { className, text } = line(event)
        return (
          <div key={event.seq} className={className}>
            {event.type === 'result' && <hr className="log-divider" />}
            {text}
          </div>
        )
      })}
    </div>
  )
}
