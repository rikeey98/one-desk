import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy } from './icons'

/** 복사가 끝났다는 체크가 머무는 시간. 상태를 전하는 표시라 장식 모션이 아니다. */
const DONE_MS = 1500

interface Props {
  /** 클립보드에 쓸 원문 — 화면에 그린 모양이 아니라 원래 글자다 */
  text: string
  /** 접근성 이름. `코드 복사`·`응답 복사`·`명령 복사` (spec NFR-6) */
  label: string
}

/**
 * 아이콘 하나짜리 복사 버튼 (docs/sdlc/conversation-timeline/ spec FR-25).
 *
 * **실패를 삼키지 않는다.** Electron 창에서 `navigator.clipboard.writeText`가 거부되면
 * 버튼이 아무 일도 안 한 것처럼 보인다(plan 리스크) — 그때는 "복사하지 못했습니다"를
 * `role="status"`로 옆에 둔다. 클립보드 API가 아예 없어도(jsdom) 같은 길로 떨어진다.
 */
export function CopyButton({ text, label }: Props) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  async function copy() {
    if (timer.current) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('done')
      timer.current = setTimeout(() => setState('idle'), DONE_MS)
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <button type="button" className="row-action copy-button" aria-label={label} title={label} onClick={() => void copy()}>
        {state === 'done' ? <IconCheck /> : <IconCopy />}
      </button>
      {state === 'failed' && <span role="status" className="copy-failed">복사하지 못했습니다</span>}
    </>
  )
}
