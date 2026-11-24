import { useEffect, useRef, type ReactNode } from 'react'

/**
 * 앱 창에서 패널이 서는 모양. 항목 하나를 열면 그 패널이 펼쳐져 목록과 상세가 나란하고,
 * 나머지 둘은 이름과 개수만 남은 레일로 접힌다. 레일을 누르면 열린 항목을 닫고 세 패널로
 * 돌아간다 (docs/sdlc/expand-rail/). 패널 창은 늘 `normal`이다.
 */
export type PanelMode =
  | { kind: 'normal' }
  | { kind: 'expanded' }
  | { kind: 'rail'; onRestore: () => void }

export function Panel({ title, count, action, mode, window: inWindow, children }: {
  title: string
  /** 제목 옆의 개수. 접히거나 필터돼도 "몇 개가 있는지"는 헤더에서 읽힌다. */
  count?: number
  action?: ReactNode
  mode: PanelMode
  /** 패널 창의 유일한 패널이다 — 창을 다 쓰고 목록·상세가 나란하다 (docs/sdlc/item-windows/ FR-7) */
  window?: boolean
  children: ReactNode
}) {
  const rail = mode.kind === 'rail' ? mode : null
  const sectionRef = useRef<HTMLElement>(null)
  // 레일 버튼은 세 패널로 돌아가는 순간 사라진다 — 포커스가 거기 있었으면 body로 떨어지지 않게 패널로 옮긴다.
  const railFocused = useRef(false)
  useEffect(() => {
    if (rail || !railFocused.current) return
    railFocused.current = false
    if (document.activeElement === null || document.activeElement === document.body) sectionRef.current?.focus({ preventScroll: true })
  }, [rail])

  return (
    // aria-label이 있어야 section이 region 역할을 얻는다. 테스트가 패널을
    // 이름으로 집을 수 있고, 스크린 리더에도 이름이 생긴다.
    <section
      ref={sectionRef}
      tabIndex={-1}
      className={['panel', mode.kind === 'expanded' && 'panel-expanded', rail && 'panel-rail', inWindow && 'panel-window'].filter(Boolean).join(' ')}
      aria-label={title}
    >
      {rail
        ? (
            <button
              type="button"
              className="panel-rail-button"
              aria-label={`${title} 보기`}
              aria-description={count !== undefined ? `${count}개` : undefined}
              title="열린 항목을 닫고 세 패널로 돌아갑니다"
              onFocus={() => { railFocused.current = true }}
              // 사라지며 나는 blur(브라우저에 따라 난다)에는 갈 곳이 없다 — 다른 곳으로 옮겨 갈 때만 잊는다.
              onBlur={(e) => { if (e.relatedTarget) railFocused.current = false }}
              onClick={rail.onRestore}
            >
              <span className="panel-rail-label">
                <span className="panel-title">{title}</span>
                {count !== undefined && <span className="panel-count">{count}</span>}
              </span>
            </button>
          )
        : (
            <header className="panel-header">
              <span className="panel-title">{title}</span>
              {count !== undefined && <span className="panel-count">{count}</span>}
              <span className="panel-actions">{action}</span>
            </header>
          )}
      {/* 레일이어도 본문은 남긴다 — 언마운트하면 추가 칸에 쓰던 글이 사라진다. */}
      <div className="panel-body" hidden={rail !== null}>{children}</div>
    </section>
  )
}
