import { Panel } from './Panel'
import { useAssets } from '../hooks/useAssets'
import { chipKey, type ContextChip } from '../context'
import type { Asset, AssetKind } from '@shared/models'

/**
 * "없음" 판정. 그 workspace에서 가장 최근에 본 시각보다 오래된 discovered asset이
 * 이번 스캔에 나타나지 않은 것이다 (설계 §3-4).
 *
 * **authored는 대상이 아니다** — `lastSeenAt`이 null이라 스캔과 무관하다. 그것까지
 * "없음"으로 칠하면 앱에서 쓴 asset이 전부 사라진 것처럼 보인다.
 */
export function isMissing(item: Asset, latestSeenAt: number): boolean {
  if (item.source !== 'discovered') return false
  return (item.lastSeenAt ?? 0) < latestSeenAt
}

export function AssetPanel({
  workspaceId, chipKeys, onToggleContext
}: {
  workspaceId: string | null
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
}) {
  const { assets, error, rescan } = useAssets(workspaceId)

  // "없음"의 기준선. 그 workspace에서 가장 최근에 파일을 본 시각이다.
  const latestSeenAt = assets.reduce((max, a) => Math.max(max, a.lastSeenAt ?? 0), 0)

  const group = (kind: AssetKind, title: string) => {
    const items = assets.filter((a) => a.kind === kind)
    return (
      <section className="asset-group">
        <h3>{title}</h3>
        {items.length === 0 && <div className="panel-empty">없습니다</div>}
        <ul className="item-list">
          {items.map((a) => {
            const picked = chipKeys.has(chipKey({ type: 'asset', id: a.id }))
            return (
              <li key={a.id} className="item" aria-label={a.name}>
                <button
                  type="button"
                  className={picked ? 'item-pick item-picked' : 'item-pick'}
                  aria-label={`${a.name} 맥락에 담기`}
                  aria-pressed={picked}
                  onClick={() => onToggleContext({ type: 'asset', id: a.id, label: a.name })}
                >
                  {picked ? '✓' : ''}
                </button>
                {/* 이름·설명·경로는 평문이다. 외부 repo의 파일에서 왔으므로
                    마크다운으로 그리지 않는다 (설계 §6-3). */}
                <span className="asset-name">{a.name}</span>
                <span className="asset-desc">{a.description ?? ''}</span>
                <span className="asset-origin">
                  {a.source === 'authored' ? '앱에서 작성' : (a.filePath ?? '')}
                </span>
                {isMissing(a, latestSeenAt) && <span className="chip-badge">없음</span>}
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <Panel title="Skills / Agents">
      <button type="button" onClick={() => void rescan()}>새로고침</button>
      {error && <div role="alert">{error}</div>}
      {group('skill', 'SKILLS')}
      {group('agent', 'AGENTS')}
    </Panel>
  )
}
