import { useEffect, useRef, useState } from 'react'
import { useCloseGuard, useCodeBuffers } from '../../store/CodeBufferContext'

/**
 * 저장하지 않은 고침이 있는데 앱 창을 닫을 때 (docs/sdlc/code-editor/ FR-21). 스토어의 닫기 요청을 듣고 선다 — App이
 * 그린다(코드 칸이 접혀 있거나 인박스에 있어도 보여야 한다). Electron은 막힌 `beforeunload`에 대화상자를 띄우지 않으므로
 * 묻는 것은 앱 안이다.
 *
 * "모두 저장" 중 하나라도 충돌·실패면 닫지 않고 무엇이 왜 남았는지 여기 남긴다 — 그 파일이 지금 칸의 repo가 아닐 수
 * 있어 칸에 열지 않는다(plan 달라진 것).
 */
export function CloseConfirm() {
  const buffers = useCodeBuffers()
  const guard = useCloseGuard()
  const request = buffers.closeRequest()
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (request) first.current?.focus()
  }, [request])

  if (!request) return null
  const count = buffers.dirty().length

  function answer(choice: 'save' | 'discard' | 'cancel') {
    setBusy(true)
    void guard.answer(choice).finally(() => setBusy(false))
  }

  return (
    <div className="close-confirm-backdrop">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
        className="close-confirm"
        onKeyDown={(e) => {
          // 안쪽부터 푼다 — 이 Esc가 도크 최대화나 열린 항목까지 닫지 않게
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          answer('cancel')
        }}
      >
        <h2 id="close-confirm-title" className="close-confirm-title">저장하지 않은 파일 {count}개가 있습니다</h2>
        {request.failures.length > 0 && (
          <ul className="close-confirm-failures" role="alert">
            {request.failures.map((f) => (
              <li key={f.path}><span className="path-text">{f.path}</span> — {f.reason}</li>
            ))}
          </ul>
        )}
        <div className="close-confirm-actions">
          <button ref={first} type="button" className="close-confirm-save" disabled={busy} onClick={() => answer('save')}>
            모두 저장하고 닫기
          </button>
          <button type="button" disabled={busy} onClick={() => answer('discard')}>저장하지 않고 닫기</button>
          <button type="button" disabled={busy} onClick={() => answer('cancel')}>취소</button>
        </div>
      </div>
    </div>
  )
}
