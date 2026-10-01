import { useEffect, useRef, useState } from 'react'
import { Markdown } from './Markdown'
import { splitFrontmatter } from '../frontmatter'

/**
 * 상세의 본문 — 읽기(마크다운)와 편집(평문) 사이를 오간다 (docs/sdlc/item-windows/ spec FR-20~24).
 * 이슈·메모·asset 상세가 같이 쓴다 — 갈라질 일이 없는 표시다(`CopyButton`의 `IdCopy`와 같은 이유).
 *
 * - **본문이 있으면 읽기로, 비어 있으면 편집으로 시작한다**(FR-21). 시작은 마운트 때의 값으로 한 번만 정한다 —
 *   치는 도중에 모드가 바뀌면 안 된다. 고른 모드는 저장하지 않는다.
 * - **읽기는 지금 친 글자를 그린다**(FR-23) — 저장된 값이 아니라 `value`다.
 * - 마크다운은 `Markdown` 그대로다(FR-22) — asset 본문은 남의 repo에서 온 신뢰할 수 없는 입력이라 규칙을
 *   우회하는 렌더러를 따로 두지 않는다.
 * - 읽기에서 두 번 누르면 편집으로 간다. 한 번은 링크를 연다.
 */
export function BodyField({ value, onChange, onBlur, readOnly = false }: {
  value: string
  onChange?: (next: string) => void
  onBlur?: () => void
  /** discovered asset — 편집 대신 "원문 보기"(읽기 전용 편집칸)다 */
  readOnly?: boolean
}) {
  // discovered는 본문을 비동기로 읽어 와 마운트 때는 비어 있다 — 고칠 수 없으니 늘 읽기로 시작한다.
  const [mode, setMode] = useState<'read' | 'edit'>(() => (!readOnly && value.trim() === '' ? 'edit' : 'read'))
  const box = useRef<HTMLTextAreaElement>(null)
  // 사람이 편집으로 옮겼을 때만 편집칸에 커서를 둔다 — 마운트(빈 본문)에서 가져가면 제목 칸의 포커스를 뺏는다.
  const focusNext = useRef(false)

  useEffect(() => {
    if (mode === 'edit' && focusNext.current) {
      focusNext.current = false
      box.current?.focus()
    }
  }, [mode])

  function toEdit() {
    focusNext.current = true
    setMode('edit')
  }

  const editLabel = readOnly ? '원문 보기' : '원문 편집'
  return (
    <div className="body-field">
      <div className="body-mode" role="group" aria-label="보기 방식">
        <button
          type="button"
          className="body-mode-button"
          aria-pressed={mode === 'read'}
          onClick={() => setMode('read')}
        >
          마크다운으로 보기
        </button>
        <button
          type="button"
          className="body-mode-button"
          aria-pressed={mode === 'edit'}
          onClick={toEdit}
        >
          {editLabel}
        </button>
      </div>
      {mode === 'read'
        ? (
            <div
              className="detail-body detail-body-read"
              title={`두 번 누르면 ${editLabel}`}
              onDoubleClick={(e) => {
                // 링크 위의 두 번 누르기는 링크의 것이다.
                if ((e.target as HTMLElement).closest('a')) return
                toEdit()
              }}
            >
              {value.trim() === ''
                ? <span className="body-empty">본문이 비어 있습니다</span>
                : <ReadView text={value} />}
            </div>
          )
        : (
            <textarea
              ref={box}
              aria-label="본문"
              className="detail-body"
              value={value}
              readOnly={readOnly}
              onChange={(e) => onChange?.(e.target.value)}
              onBlur={onBlur}
            />
          )}
    </div>
  )
}

/**
 * 읽기 화면. frontmatter가 있으면 마크다운에 넘기지 않고 위에 평문 칸으로 둔다 — 그대로 넘기면 가로줄과 setext
 * 제목으로 뭉개진다(`splitFrontmatter`).
 */
function ReadView({ text }: { text: string }) {
  const { front, rest } = splitFrontmatter(text)
  return (
    <>
      {front !== null && <pre className="body-frontmatter">{front}</pre>}
      {rest.trim() !== '' && <Markdown text={rest} />}
    </>
  )
}
