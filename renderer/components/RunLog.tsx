import type { RunEvent } from '@shared/events'
import type { RunStatus } from '@shared/models'

const STATUS_LABELS: Record<RunStatus, string> = {
  pending: '대기',
  running: '실행 중',
  succeeded: '완료',
  failed: '실패',
  canceled: '취소됨',
  interrupted: '중단됨'
}

interface Line {
  key: number
  className: string
  text: string
  divider?: boolean
  badge?: string
}

/**
 * 이벤트를 화면 줄로 바꾼다.
 *
 * Claude Code는 마지막 assistant 메시지를 text로 흘린 뒤 result에 같은 내용을
 * 다시 담는다. 설계 §9의 "result → 구분선과 최종 텍스트"를 곧이곧대로 그리면
 * 같은 답변이 두 번 나온다. 직전 텍스트와 같으면 본문은 접고 구분선과 상태만 남긴다.
 */
function buildLines(events: readonly RunEvent[]): Line[] {
  const lines: Line[] = []
  let lastText = ''

  for (const event of events) {
    switch (event.type) {
      case 'session':
        lines.push({ key: event.seq, className: 'log-meta', text: `세션 ${event.sessionId}` })
        break
      case 'text':
        lastText = event.text.trim()
        lines.push({ key: event.seq, className: 'log-text', text: event.text })
        break
      case 'tool_use':
        lines.push({
          key: event.seq,
          className: 'log-tool',
          text: `→ ${event.name} ${event.targetPaths[0] ?? ''}`.trimEnd()
        })
        break
      case 'tool_result':
        lines.push({
          key: event.seq,
          className: event.ok ? 'log-meta' : 'log-error',
          text: event.ok ? `  ${event.summary}` : `  실패: ${event.summary}`
        })
        break
      case 'error':
        lines.push({ key: event.seq, className: 'log-error', text: event.message })
        break
      case 'raw':
        lines.push({ key: event.seq, className: 'log-error', text: event.line })
        break
      case 'result': {
        const body = event.resultText.trim()
        const repeated = body !== '' && body === lastText
        lines.push({
          key: event.seq,
          className: repeated ? 'log-meta' : 'log-result',
          divider: true,
          text: repeated ? STATUS_LABELS[event.status] : event.resultText,
          ...(event.needsAnswer ? { badge: '답변 필요' } : {})
        })
        break
      }
    }
  }

  return lines
}

export function RunLog({ events }: { events: readonly RunEvent[] }) {
  if (events.length === 0) {
    return <div className="panel-empty">아직 출력이 없습니다</div>
  }

  return (
    <div className="run-log">
      {buildLines(events).map((line) => (
        <div key={line.key} className={line.className}>
          {line.divider && <hr className="log-divider" />}
          {line.badge && <span className="needs-answer">{line.badge}</span>}
          {line.text}
        </div>
      ))}
    </div>
  )
}
