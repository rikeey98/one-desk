import { useEffect, useState, type KeyboardEvent } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Permission, Repo, Run, Workspace } from '@shared/models'
import type { ContextChip } from '../context'

const PERMISSION_LABELS: Record<Permission, string> = {
  read_only: '읽기 전용',
  edit: '편집 허용',
  full: '전체 허용'
}

export function RunPanel({
  workspaceId, workspaces, repos, reposError, chips, onRemoveChip, onStarted,
  resumeFrom, draftPrompt, draftCwd, onExitResume
}: {
  workspaceId: string
  /** App이 useWorkspaces()로 한 번만 조회해 내려준다 — 이 컴포넌트가 자기 인스턴스를
   * 따로 가지면 defaultPermission이 다른 곳에서 만든 workspace를 못 볼 수 있다. */
  workspaces: Workspace[]
  repos: Repo[]
  reposError: string | null
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onStarted: (run: Run) => void
  /** 이어서 실행할 원본. null이면 새 실행이다. */
  resumeFrom: Run | null
  /** "다시 실행"이 채워 넣는 초기 프롬프트 */
  draftPrompt: string
  /** "다시 실행"이 요구하는 작업 디렉토리. null이면 요구가 없다. */
  draftCwd: string | null
  onExitResume: () => void
}) {
  const client = useClient()
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null

  const [cwd, setCwd] = useState('')
  // "다시 실행"이 요구한 경로가 지금 repo 목록에 없을 때 그 경로를 담는다.
  const [missingCwd, setMissingCwd] = useState<string | null>(null)
  const [permission, setPermission] = useState<Permission>('edit')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 권한 기본값은 workspace의 defaultPermission이고, 선택은 그 run에만 적용된다 (설계 §7).
  // resume 모드에서는 원본의 권한이 우선이다 — workspace 조회가 비동기라 나중에
  // 도착하면 이 effect가 다시 실행돼 resumeFrom이 세운 값을 조용히 덮어쓸 수 있다.
  useEffect(() => {
    if (workspace && !resumeFrom) setPermission(workspace.defaultPermission)
  }, [workspace, resumeFrom])

  // resume은 원본의 권한에서 출발한다. 낮추면 조용히 깎이고, 올리는 것은 사용자의 판단이다.
  useEffect(() => {
    if (resumeFrom) setPermission(resumeFrom.permission)
  }, [resumeFrom])

  useEffect(() => {
    if (draftPrompt) setPrompt(draftPrompt)
  }, [draftPrompt])

  // cwd가 지금 workspace의 repo 목록에 없으면 첫 repo로 되돌린다(없으면 비운다).
  // "비어 있을 때만 채운다"로는 부족하다 — RunPanel은 workspace가 바뀌어도 다시
  // 마운트되지 않으므로(App이 key를 주지 않는다) 이전 workspace의 경로가 그대로 남고,
  // ready도 계속 true라 다른 workspace의 디렉토리에서 agent가 실행된다.
  // core/execution.ts는 맥락 항목의 소속만 검증하고 cwd는 보지 않는다.
  //
  // 다만 "다시 실행"이 요구한 경로는 예외다. 그 경로가 목록에 없다고 첫 repo로
  // 떨어뜨리면 원본과 다른 저장소에서 agent가 돈다 — 권한이 edit이면 엉뚱한 저장소가
  // 편집된다. 조용히 바꾸는 대신 그 사실을 보이고 실행을 막는다.
  useEffect(() => {
    if (cwd !== '' && repos.some((r) => r.path === cwd)) {
      setMissingCwd(null)
      return
    }
    if (cwd !== '' && cwd === draftCwd) {
      setMissingCwd(cwd)
      return
    }
    setMissingCwd(null)
    setCwd(repos.length > 0 ? repos[0]!.path : '')
  }, [repos, cwd, draftCwd])

  // "다시 실행"은 원본과 같은 디렉토리에서 돌아야 한다.
  // 이 effect는 위 fallback effect보다 반드시 뒤에 와야 한다 — 마운트 직후처럼 둘이
  // 같은 커밋에서 함께 실행될 때 나중에 부른 setCwd가 남기 때문이다. 앞에 두면
  // 요청받은 경로가 첫 repo 경로로 조용히 덮인다.
  useEffect(() => {
    if (draftCwd !== null) setCwd(draftCwd)
  }, [draftCwd])

  // resume은 cwd를 원본에서 받으므로 로컬 cwd가 비어도 실행할 수 있다.
  const ready = (resumeFrom !== null || (cwd !== '' && missingCwd === null))
    && prompt.trim() !== '' && !busy

  async function start() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const run = resumeFrom
        ? await client.runs.resume({
            parentRunId: resumeFrom.id,
            model: model.trim() || null,
            permission,
            userPrompt: prompt,
            context: chips.map(({ type, id }) => ({ type, id }))
          })
        : await client.runs.start({
            workspaceId,
            agentKind: 'claude-code',
            model: model.trim() || null,
            cwd,
            permission,
            userPrompt: prompt,
            context: chips.map(({ type, id }) => ({ type, id }))
          })
      setPrompt('')
      onStarted(run)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function onPromptKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void start()
    }
  }

  const shown = error ?? reposError

  return (
    <div className="run-panel">
      {shown && <div role="alert" className="form-error">{shown}</div>}
      {missingCwd && (
        <div role="alert" className="form-error">
          이 실행의 작업 디렉토리 {missingCwd} 를 이 workspace의 repo 목록에서 찾을 수 없습니다.
          repo를 등록하거나 다른 디렉토리를 고르세요.
        </div>
      )}
      {repos.length === 0 && (
        <div className="panel-empty">작업 디렉토리로 쓸 repo를 먼저 등록하세요</div>
      )}

      <div className="run-settings">
        <label>
          agent
          {/* OpenCode 어댑터는 5단계에 들어온다. 지금 고르게 하면 Claude Code가 실행돼 혼란만 준다. */}
          <select value="claude-code" disabled>
            <option value="claude-code">Claude Code</option>
          </select>
        </label>
        <label>
          모델
          <input
            value={model}
            placeholder="기본값"
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        {resumeFrom ? (
          <div className="resume-locked">
            <span className="resume-badge">이어서 실행</span>
            {/* 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 둘은 바꿀 수 없다 (설계 §6). */}
            <span>{resumeFrom.agentKind}</span>
            <span>{resumeFrom.cwd}</span>
            <button type="button" onClick={onExitResume}>새 실행으로</button>
          </div>
        ) : (
          <label>
            작업 디렉토리
            <select value={cwd} onChange={(e) => setCwd(e.target.value)}>
              {/* 목록에 없는 경로도 그대로 보여준다 — option에 없는 값을 주면 브라우저가
                  select.value를 ''로 정규화해 무엇이 문제인지 화면에서 사라진다. */}
              {missingCwd && <option value={missingCwd}>{missingCwd} (없는 경로)</option>}
              {repos.map((r) => (
                <option key={r.id} value={r.path}>{r.name} — {r.path}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          권한
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value as Permission)}
          >
            {(Object.keys(PERMISSION_LABELS) as Permission[]).map((p) => (
              <option key={p} value={p}>{PERMISSION_LABELS[p]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="run-chips">
        {chips.length === 0 && <span className="dock-empty">왼쪽에서 항목을 눌러 맥락을 담으세요</span>}
        {chips.map((chip) => (
          <button
            key={`${chip.type}:${chip.id}`}
            type="button"
            className="chip"
            onClick={() => onRemoveChip(chip)}
          >
            {chip.label} ✕
          </button>
        ))}
      </div>

      <textarea
        className="run-prompt"
        value={prompt}
        placeholder="무엇을 시킬지 적으세요. ⌘↵ 로 실행합니다."
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onPromptKeyDown}
      />

      <div className="run-actions">
        <button type="button" className="run-start" disabled={!ready} onClick={() => void start()}>
          ▶ 실행
        </button>
      </div>
    </div>
  )
}
