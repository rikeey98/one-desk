import { useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { IconNewWindow } from './icons'
import { PANEL_KIND_LABELS } from '../panelKinds'
import type { PanelKind } from '@shared/panelWindow'

/**
 * 패널 헤더의 "새 창으로 열기" (docs/sdlc/item-windows/ FR-5). 누른 순간의 workspace·repo로 연다 — 창은 그
 * 범위에 고정되고, 이후 앱 창에서 repo를 바꿔도 따라가지 않는다(FR-2). 실패하면 버튼 옆에 말한다.
 */
export function OpenWindowButton({ kind, workspaceId, repoId }: {
  kind: PanelKind
  workspaceId: string | null
  repoId: string | null
}) {
  const client = useClient()
  const [error, setError] = useState<string | null>(null)
  if (!workspaceId) return null
  const label = `${PANEL_KIND_LABELS[kind]} 새 창으로 열기`
  return (
    <>
      <button
        type="button"
        className="icon-button icon-button-sm"
        aria-label={label}
        title={label}
        onClick={() => {
          setError(null)
          client.app.openPanelWindow({ kind, workspaceId, repoId })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        }}
      >
        <IconNewWindow />
      </button>
      {error && <span role="alert" className="form-error">{error}</span>}
    </>
  )
}
