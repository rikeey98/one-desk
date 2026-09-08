import { useEffect, useState } from 'react'
import { Panel } from './Panel'
import { AddForm } from './AddForm'
import { AssetDetail } from './AssetDetail'
import { useAssets } from '../hooks/useAssets'
import { useClient } from '../client/ClientProvider'
import { chipKey, type ContextChip } from '../context'
import type { Asset, AssetKind, Repo } from '@shared/models'

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
  workspaceId, repos, chipKeys, onToggleContext, expanded, openId, onOpen
}: {
  workspaceId: string | null
  /** 지금 workspace의 repo들. 목록이 바뀌면 asset을 다시 읽는다 */
  repos: Repo[]
  chipKeys: Set<string>
  onToggleContext: (chip: ContextChip) => void
  expanded?: boolean
  openId?: string | null
  onOpen?: (id: string) => void
}) {
  const client = useClient()
  const { assets, error, rescan, refresh } = useAssets(workspaceId, repos.map((r) => r.id).join(','))
  // 새로 만들 asset의 종류. 이름만 받는 AddForm과 짝을 이룬다.
  const [newKind, setNewKind] = useState<AssetKind>('skill')

  const open = openId ? assets.find((a) => a.id === openId) ?? null : null

  // 열린 항목이 목록에서 사라졌으면(지워졌으면) 접는다.
  useEffect(() => {
    if (openId && !open && onOpen) onOpen(openId)
  }, [openId, open, onOpen])

  async function addAuthored(name: string) {
    if (!workspaceId) return
    await client.assets.createAuthored({ workspaceId, kind: newKind, name })
    await refresh()
  }

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
                <button
                  type="button"
                  className="item-open"
                  onClick={() => onOpen?.(a.id)}
                >{a.name}</button>
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

  const list = (
    <>
      <div className="asset-add">
        <select
          aria-label="새 asset 종류"
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as AssetKind)}
        >
          <option value="skill">skill</option>
          <option value="agent">agent</option>
        </select>
        <AddForm placeholder="새 asset 이름…" onSubmit={addAuthored} />
        <button type="button" onClick={() => void rescan()}>새로고침</button>
      </div>
      {error && <div role="alert">{error}</div>}
      {group('skill', 'SKILLS')}
      {group('agent', 'AGENTS')}
    </>
  )

  return (
    <Panel title="Skills / Agents">
      {expanded && open
        ? (
            <AssetDetail
              key={open.id}
              asset={open}
              onChanged={() => { void refresh() }}
              onDeleted={() => { onOpen?.(open.id); void refresh() }}
            />
          )
        : list}
    </Panel>
  )
}
