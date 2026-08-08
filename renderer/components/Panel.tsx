import type { ReactNode } from 'react'

export function Panel({ title, action, children }: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-title">{title}</span>
        {action}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}
