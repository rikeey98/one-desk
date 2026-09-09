import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../client/ClientProvider'
import type { GlobalRoots } from '@shared/models'

/** 줄바꿈 텍스트를 경로 목록으로. 빈 줄과 앞뒤 공백은 버린다 */
function toList(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

/**
 * 앱 설정 화면. 지금은 글로벌 asset 경로만 담는다.
 *
 * 모달이 아니라 **본문 영역을 대신 차지한다** — 전체 설계 §509가 모달을 피하는 근거는
 * "뒤의 목록을 계속 만질 수 있어야 한다"인데, 설정은 목록을 보며 고칠 화면이 아니다.
 * 전체 설계 §403이 전제한 workspace 기본값도 앞으로 여기로 모을 자리다.
 */
export function SettingsPanel() {
  const client = useClient()
  const [claude, setClaude] = useState('')
  const [opencode, setOpencode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const apply = useCallback((roots: GlobalRoots) => {
    setClaude(roots.claude.join('\n'))
    setOpencode(roots.opencode.join('\n'))
  }, [])

  useEffect(() => {
    let alive = true
    client.settings.globalRoots()
      .then((roots) => { if (alive) apply(roots) })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => { alive = false }
  }, [client, apply])

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      // 돌려받은 값으로 다시 채운다 — core가 빈 목록을 기본값으로 되돌리므로
      // 저장 결과가 입력과 다를 수 있다.
      apply(await client.settings.setGlobalRoots({
        claude: toList(claude), opencode: toList(opencode)
      }))
    } catch (err) {
      // 입력은 지우지 않는다. 실패했는데 지우면 다시 타이핑해야 한다.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings">
      <h2>설정</h2>
      {error && <div role="alert" className="form-error">{error}</div>}

      <p className="settings-hint">
        한 줄에 경로 하나. 여기에 있는 skill과 agent가 목록에 함께 보입니다.
        비워두면 기본값으로 돌아갑니다.
      </p>

      <label className="settings-field">
        Claude Code 글로벌 경로
        <textarea
          aria-label="Claude Code 글로벌 경로"
          value={claude}
          rows={4}
          onChange={(e) => setClaude(e.target.value)}
        />
      </label>

      <label className="settings-field">
        OpenCode 글로벌 경로
        <textarea
          aria-label="OpenCode 글로벌 경로"
          value={opencode}
          rows={3}
          onChange={(e) => setOpencode(e.target.value)}
        />
      </label>

      <button type="button" disabled={busy} onClick={() => void save()}>저장</button>
    </div>
  )
}
