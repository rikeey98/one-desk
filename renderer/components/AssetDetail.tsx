import { useRef, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import { useDebouncedSave } from '../hooks/useDebouncedSave'
import { ConflictBanner } from './ConflictBanner'
import { ConfirmButton } from './ConfirmButton'
import type { Asset } from '@shared/models'

export function AssetDetail({ asset, onChanged, onDeleted }: {
  asset: Asset
  /** 목록을 다시 읽게 한다 */
  onChanged: () => void
  onDeleted: () => void
}) {
  const client = useClient()
  const [name, setName] = useState(asset.name)
  const [body, setBody] = useState(asset.content ?? '')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Asset | null>(null)
  // 낙관적 잠금의 기대값. **성공한 모든 쓰기가 이것을 갱신한다** (설계 §6-2).
  // 안 하면 다음 자동 저장이 낡은 값을 들고 가 자기 자신과 충돌한다.
  const expected = useRef(asset.updatedAt)

  /**
   * discovered는 앱에서 고칠 수 없다 — 본문은 파일이 원본이고, 앱이 고치면
   * 어느 쪽이 진짜인지 알 수 없게 된다 (설계 §6-2).
   */
  const readOnly = asset.source === 'discovered'

  async function persist(patch: { name?: string; content?: string }) {
    setError(null)
    const result = await client.assets.updateIfUnchanged({
      id: asset.id, ...patch, expectedUpdatedAt: expected.current
    })
    if (!result.ok) { setConflict(result.current); return }
    expected.current = result.asset.updatedAt
    onChanged()
  }

  const bodySave = useDebouncedSave(async (value) => {
    // 배너가 떠 있으면 멈춘다. 계속 재시도하면 결국 덮어쓰기가 되어 잠금이 무의미해진다.
    if (conflict) return
    try { await persist({ content: value }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })

  const nameSave = useDebouncedSave(async (value) => {
    if (conflict) return
    try { await persist({ name: value }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  })

  return (
    <div className="detail">
      {conflict && (
        <ConflictBanner
          onReload={() => {
            // 스테일한 텍스트를 든 디바운스 타이머를 버린다 — 남겨두면 새로 맞춰진
            // 기대값과 함께 옛 값을 몰래 써버려 화면과 DB가 갈린다.
            bodySave.cancel()
            nameSave.cancel()
            setName(conflict.name)
            setBody(conflict.content ?? '')
            expected.current = conflict.updatedAt
            setConflict(null)
            onChanged()
          }}
          onOverwrite={() => {
            void (async () => {
              try {
                // 지금 저장된 값을 기대값으로 삼아 다시 쓴다. 별도의 무보호 갱신을
                // 두지 않는 이유다 — 그 사이 또 바뀌었다면 다시 배너가 뜨는 것이 맞다.
                const result = await client.assets.updateIfUnchanged({
                  id: asset.id, name, content: body, expectedUpdatedAt: conflict.updatedAt
                })
                if (!result.ok) { setConflict(result.current); return }
                expected.current = result.asset.updatedAt
                setConflict(null)
                onChanged()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            })()
          }}
        />
      )}
      {error && <div role="alert" className="form-error">{error}</div>}

      <input
        aria-label="이름"
        className="detail-title"
        value={name}
        readOnly={readOnly}
        onChange={(e) => { setName(e.target.value); nameSave.schedule(e.target.value) }}
        onBlur={() => { void nameSave.flush() }}
      />

      {readOnly && (
        <div className="asset-path">
          {asset.filePath}
          {/* 본문을 DB에 두지 않으므로 여기 띄울 것이 없다. 빈 칸만 보이면
              사용자는 파일이 비었다고 오해한다 (설계 §2-2). */}
          <span className="panel-empty">본문은 실행 시점에 이 파일에서 읽습니다</span>
        </div>
      )}

      {/* 마크다운으로 그리지 않는다 — 외부 repo의 파일이라 신뢰할 수 없는 입력이다
          (설계 §6-3). */}
      <textarea
        aria-label="본문"
        className="detail-body"
        value={body}
        readOnly={readOnly}
        onChange={(e) => { setBody(e.target.value); bodySave.schedule(e.target.value) }}
        onBlur={() => { void bodySave.flush() }}
      />

      <div className="detail-actions">
        <ConfirmButton
          label="삭제"
          confirmLabel="정말 삭제?"
          onConfirm={() => {
            bodySave.cancel()
            nameSave.cancel()
            void (async () => {
              try { await client.assets.remove(asset.id); onDeleted() }
              catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            })()
          }}
        />
      </div>
    </div>
  )
}
