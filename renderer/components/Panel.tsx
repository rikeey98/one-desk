import type { ReactNode } from 'react'

export function Panel({ title, action, expanded, children }: {
  title: string
  action?: ReactNode
  /** 확장된 패널은 .columns 안에서 flex 비율이 커진다 (설계 §4) */
  expanded?: boolean
  children: ReactNode
}) {
  return (
    // aria-label이 있어야 section이 region 역할을 얻는다. 테스트가 패널을
    // 이름으로 집을 수 있고, 스크린 리더에도 이름이 생긴다.
    <section className={expanded ? 'panel panel-expanded' : 'panel'} aria-label={title}>
      <header className="panel-header">
        <span className="panel-title">{title}</span>
        {action}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
