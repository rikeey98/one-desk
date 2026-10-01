import type { ReactNode } from 'react'

export function Panel({ title, count, action, expanded, window: inWindow, children }: {
  title: string
  /** 제목 옆의 개수. 접히거나 필터돼도 "몇 개가 있는지"는 헤더에서 읽힌다. */
  count?: number
  action?: ReactNode
  /** 확장된 패널은 .columns 안에서 flex 비율이 커진다 (설계 §4) */
  expanded?: boolean
  /** 패널 창의 유일한 패널이다 — 창을 다 쓰고 목록·상세가 나란하다 (docs/sdlc/item-windows/ FR-7) */
  window?: boolean
  children: ReactNode
}) {
  return (
    // aria-label이 있어야 section이 region 역할을 얻는다. 테스트가 패널을
    // 이름으로 집을 수 있고, 스크린 리더에도 이름이 생긴다.
    <section
      className={['panel', expanded && 'panel-expanded', inWindow && 'panel-window'].filter(Boolean).join(' ')}
      aria-label={title}
    >
      <header className="panel-header">
        <span className="panel-title">{title}</span>
        {count !== undefined && <span className="panel-count">{count}</span>}
        <span className="panel-actions">{action}</span>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
