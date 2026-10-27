import { useState } from 'react'
import type { IssueBanner } from '../proposal'
import { KIND_LABELS, PRIORITY_LABELS, SOURCE_LABELS } from '../issueAxes'
import type { AcceptIssueProposal, Repo } from '@shared/models'

/**
 * 대화 칸의 `이 대화를 이슈로 만들까요?` (`docs/sdlc/agent-proposals/` spec FR-21~23). 대화록과 입력부 사이에 선다.
 *
 * 고치는 것은 새 이슈의 **제목뿐**이다 — 본문·repo·축은 보이기만 하고 받은 뒤 상세에서 고친다(FR-22). 제목 칸의 초안은 이
 * 컴포넌트의 state라, 부르는 쪽이 key를 제안 id로 잡는다(새 제안이 오면 그 제목으로 다시 시작한다 — FR-4).
 */
export function IssueProposalBanner({ banner, repos, onAccept, onDecline }: {
  banner: IssueBanner
  repos: Repo[]
  /** 실패하면 던진다 — 배너가 이유를 보이고 남는다 */
  onAccept: (choice: AcceptIssueProposal) => Promise<void>
  onDecline: () => Promise<void>
}) {
  const { payload } = banner.proposal
  const [title, setTitle] = useState(payload.title)
  // 기존 이슈 갈래에서는 `이슈로 만들기`를 눌러야 제목 칸이 펼쳐진다 (FR-22)
  const [creating, setCreating] = useState(banner.mode === 'new')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function act(run: () => Promise<void>) {
    // 누르는 동안 세 버튼이 잠긴다 — 두 번 눌러 둘째가 "이미 처리된 제안입니다"로 실패하지 않게 (FR-23)
    setBusy(true)
    setError(null)
    try {
      await run()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const blank = title.trim() === ''
  const createNew = () => {
    if (!creating) { setCreating(true); return }
    if (blank) return
    void act(() => onAccept({ mode: 'new', title }))
  }

  const repoNames = payload.repoIds.flatMap((id) => repos.find((r) => r.id === id)?.name ?? [])
  const axes = [
    payload.kind ? KIND_LABELS[payload.kind] : null,
    payload.priority ? PRIORITY_LABELS[payload.priority] : null,
    payload.source ? SOURCE_LABELS[payload.source] : null
  ].filter((a): a is string => a !== null)

  return (
    <section className="conversation-proposal" role="status" aria-label="이 대화를 이슈로 만들까요?">
      <p className="conversation-proposal-question">
        {banner.mode === 'existing' && !creating
          ? <>기존 이슈 「{banner.existing.title}」에 붙일까요?</>
          : '이 대화를 이슈로 만들까요?'}
      </p>
      {creating && (
        <>
          <input
            className="conversation-proposal-title"
            aria-label="제안된 이슈 제목"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              createNew()
            }}
          />
          {payload.body.trim() !== '' && (
            <p className="conversation-proposal-body" title={payload.body}>{payload.body}</p>
          )}
        </>
      )}
      <div className="conversation-proposal-row">
        {(repoNames.length > 0 || axes.length > 0) && (
          <span className="conversation-proposal-tags">
            {[...repoNames, ...axes].map((tag, i) => <span key={`${i}:${tag}`} className="conversation-proposal-tag">{tag}</span>)}
          </span>
        )}
        <span className="conversation-proposal-actions">
          {banner.mode === 'existing' && !creating && (
            <button
              type="button" className="conversation-proposal-primary" disabled={busy}
              onClick={() => void act(() => onAccept({ mode: 'existing' }))}
            >
              기존 이슈에 붙이기
            </button>
          )}
          <button
            type="button"
            className={creating ? 'conversation-proposal-primary' : undefined}
            disabled={busy || (creating && blank)}
            onClick={createNew}
          >
            이슈로 만들기
          </button>
          <button type="button" disabled={busy} onClick={() => void act(onDecline)}>이슈로 만들지 않기</button>
        </span>
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
    </section>
  )
}
