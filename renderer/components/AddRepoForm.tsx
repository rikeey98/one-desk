import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useClient } from '../client/ClientProvider'
import { registerEnvOf, wslPickerOf } from '../agentEnv'
import { IconFolder } from './icons'
import type { WslDistros } from '@shared/models'

/** 경로의 마지막 조각. 렌더러에는 node:path가 없고, 구분자는 OS마다 다르다. */
function folderName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? ''
}

export function AddRepoForm({ workspaceId, onAdded, focusName = false, onFocusNameConsumed = () => {} }: {
  workspaceId: string
  onAdded: () => Promise<void>
  /** 홈 준비 단계 ②가 세운다 — 이름 칸에 포커스하고 치운다 (docs/sdlc/home/ FR-16). 일회성 지시 */
  focusName?: boolean
  onFocusNameConsumed?: () => void
}) {
  const client = useClient()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // WSL (docs/sdlc/wsl-repo-setup/). 폼이 열릴 때 한 번 묻는다 — 못 얻으면 WSL을 쓸 수 없는 것으로 본다(FR-1). 폼은 그대로 돈다.
  const [wsl, setWsl] = useState<WslDistros | null>(null)
  // 사람이 끈 `WSL 안의 claude로 실행` (FR-4). 경로가 WSL 경로인 동안만 남는다 — 한 글자 고칠 때마다 다시 켜지면 안 된다.
  const [optedOut, setOptedOut] = useState(false)
  const hintId = useId()
  // 대화상자가 넣은 경로는 끝(고른 폴더 이름)이 보이게 칸을 끝까지 민다 — 그대로 두면 `\\wsl.localhost\…`의 앞부분만 보인다
  const pathInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  // 홈 준비 단계 ②(docs/sdlc/home/ FR-16) — 펼쳐진 폼의 이름 칸에 포커스. 일회성 지시
  useEffect(() => {
    if (!focusName) return
    nameInput.current?.focus()
    onFocusNameConsumed()
  }, [focusName])
  const [pickedTick, setPickedTick] = useState(0)
  useEffect(() => {
    const el = pathInput.current
    if (pickedTick > 0 && el) el.scrollLeft = el.scrollWidth
  }, [pickedTick])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const next = await client.wsl.listDistros()
        if (alive) setWsl(next)
      } catch {
        // 버튼과 체크만 서지 않는다 — 등록은 지금처럼 된다
      }
    })()
    return () => { alive = false }
  }, [client])

  const env = registerEnvOf(path, wsl, optedOut)
  const picker = wslPickerOf(wsl)

  function changePath(next: string) {
    setPath(next)
    // WSL 경로가 아니게 되면 끈 것을 잊는다 — 다음 WSL 경로는 다시 켜진 채 온다(FR-4)
    if (!registerEnvOf(next, wsl, false).offered) setOptedOut(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !path.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      // host면 지금과 같은 모양이다 — agentEnv를 싣지 않는다(기본 host, FR-5)
      await client.repos.create({
        workspaceId, name: name.trim(), path: path.trim(), ...(env.agentEnv === 'wsl' ? { agentEnv: 'wsl' as const } : {})
      })
      setName('')
      setPath('')
      setOptedOut(false)
      await onAdded()
    } catch (err) {
      // 입력값은 지우지 않는다. 실패했는데 지우면 다시 타이핑해야 한다.
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** 폴더 선택 대화상자. WSL이면 뜻만 넘긴다 — 시작 폴더(기본 배포판의 홈)는 core가 정한다(FR-2) */
  async function pickFolder(start?: 'wsl') {
    setError(null)
    try {
      const picked = start ? await client.app.pickDirectory({ start }) : await client.app.pickDirectory()
      if (picked === null) return
      setPath(picked)
      setPickedTick((n) => n + 1)
      // 새로 고른 폴더는 새 판단이다 — 끈 체크를 잊는다(FR-4)
      setOptedOut(false)
      // 이미 적어 둔 이름은 사람이 고른 것이다 — 덮어쓰지 않는다.
      setName((current) => current.trim() ? current : folderName(picked))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="add-repo-form">
      <input ref={nameInput} value={name} onChange={(e) => setName(e.target.value)}
        placeholder="repo 이름" disabled={busy} />
      {/* 직접 치는 칸도 남긴다 — 경로를 붙여 넣는 편이 빠를 때가 있고, e2e가 이 칸을 쓴다. */}
      <div className="add-repo-path">
        <input ref={pathInput} value={path} onChange={(e) => changePath(e.target.value)}
          placeholder="/절대/경로" title={path || undefined} disabled={busy} />
        <button type="button" className="add-repo-pick" aria-label="폴더 선택" title="폴더 선택"
          onClick={() => void pickFolder()} disabled={busy}>
          <IconFolder />
        </button>
        {/* 글자 버튼이다 — 펭귄 글리프는 글꼴마다 달라 쓰지 않는다(DESIGN.md). 이름에 "폴더 선택"을 넣지 않는다 —
            옆 버튼을 부분 일치로 잡는 e2e와 부딪힌다(spec NFR-1). */}
        {picker && (
          <button type="button" className="add-repo-pick add-repo-wsl" aria-label="WSL 폴더 고르기"
            title={`WSL 폴더 고르기 — ${picker.distro}의 홈에서 엽니다`}
            onClick={() => void pickFolder('wsl')} disabled={busy}>
            WSL
          </button>
        )}
      </div>
      {/* WSL 폴더면 실행 환경을 여기서 정한다 — 등록한 뒤 설정에 가서 바꾸지 않아도 된다(FR-3). 기본은 켜짐이다. */}
      {env.offered && (
        <div className="add-repo-env">
          <label className="add-repo-env-check">
            <input
              type="checkbox"
              checked={env.agentEnv === 'wsl'}
              aria-describedby={hintId}
              onChange={(e) => setOptedOut(!e.target.checked)}
              disabled={busy}
            />
            WSL 안의 claude로 실행
          </label>
          {env.agentEnv === 'wsl'
            ? (
              <p id={hintId} className="add-repo-env-hint path-text">
                {/* 배포판과 Linux 경로를 두 줄로 — 좁은 사이드바에서 한 줄로 이으면 `Ubuntu-` / `24.04`, `onedesk-` / `capture`처럼
                    하이픈에서 끊긴다 */}
                <span className="add-repo-env-distro">{env.distro}</span>
                <span className="add-repo-env-path">{env.linuxPath}</span>
              </p>
            )
            : <p id={hintId} className="add-repo-env-hint">Windows의 claude가 이 폴더를 다룹니다</p>}
          {env.unknownDistro && (
            <p className="add-repo-env-warn">이 배포판이 wsl --list에 없습니다 — 꺼져 있거나 이름이 다를 수 있습니다</p>
          )}
        </div>
      )}
      <button type="submit" disabled={busy}>추가</button>
      {error && <div role="alert" className="form-error">{error}</div>}
    </form>
  )
}
