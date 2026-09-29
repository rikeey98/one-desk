import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy } from './icons'
import { timesView } from '../times'

/** 복사가 끝났다는 체크가 머무는 시간. 상태를 전하는 표시라 장식 모션이 아니다. */
const DONE_MS = 1500

interface Props {
  /** 클립보드에 쓸 원문 — 화면에 그린 모양이 아니라 원래 글자다 */
  text: string
  /** 접근성 이름. `코드 복사`·`응답 복사`·`명령 복사`·`이슈 id 복사` (spec NFR-6) */
  label: string
  /**
   * 아이콘 앞에 보일 글자(예: 짧은 id `#3f2a9c1e`). 주면 글자 달린 알약 모양이고 `title`도 이것이
   * 아니라 `hint`다 — 보이는 글자와 복사되는 원문이 다를 때 원문을 거기서 보인다.
   */
  display?: string
  hint?: string
}

/**
 * 아이콘 하나짜리 복사 버튼 (docs/sdlc/conversation-timeline/ spec FR-25).
 *
 * **실패를 삼키지 않는다.** Electron 창에서 `navigator.clipboard.writeText`가 거부되면
 * 버튼이 아무 일도 안 한 것처럼 보인다(plan 리스크) — 그때는 "복사하지 못했습니다"를
 * `role="status"`로 옆에 둔다. 클립보드 API가 아예 없어도(jsdom) 같은 길로 떨어진다.
 */
/**
 * 이슈·메모 상세의 id 알약 — `#` + 앞 8자리를 보이고 누르면 **전체 id**를 복사한다. id는 agent가
 * MCP(`get_issue`·`update_memo` 등)로 그 항목을 짚는 이름이라, 지시문에 붙여 넣으려면 전체가 필요하다.
 * 이슈·메모가 같은 컴포넌트를 쓰는 것은 대칭 규칙과 부딪히지 않는다 — 갈라질 일이 없는 표시다.
 */
export function IdCopy({ kind, id }: { kind: '이슈' | '메모'; id: string }) {
  return (
    <CopyButton
      text={id}
      label={`${kind} id 복사`}
      display={`#${id.slice(0, 8)}`}
      hint={`${kind} id ${id} — 눌러서 복사`}
    />
  )
}

/**
 * 상세 메타 줄 오른쪽 끝의 도장 — 시각 한 줄(`docs/sdlc/timestamps/` FR-8)과 id 알약. 이슈·메모가 같이 쓴다.
 * 시각은 렌더할 때의 시계로 올해 여부만 가른다(초 단위로 바뀌는 값이 아니라 1분 타이머가 필요 없다).
 */
export function DetailStamp({ kind, id, times }: {
  kind: '이슈' | '메모'
  id: string
  times: ReadonlyArray<readonly [label: string, at: number | null]>
}) {
  const view = timesView(times, Date.now())
  return (
    <span className="detail-stamp">
      {view.text && <span className="detail-times" title={view.title}>{view.text}</span>}
      <IdCopy kind={kind} id={id} />
    </span>
  )
}

export function CopyButton({ text, label, display, hint }: Props) {
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
      <button
        type="button"
        className={display === undefined ? 'row-action copy-button' : 'copy-pill'}
        aria-label={label}
        title={hint ?? label}
        onClick={() => void copy()}
      >
        {display !== undefined && <span className="copy-pill-text">{display}</span>}
        {state === 'done' ? <IconCheck /> : <IconCopy />}
      </button>
      {state === 'failed' && <span role="status" className="copy-failed">복사하지 못했습니다</span>}
    </>
  )
}
