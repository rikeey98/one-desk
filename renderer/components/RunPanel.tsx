import { useEffect, useState, type KeyboardEvent } from 'react'
import { useClient } from '../client/ClientProvider'
import { useWorkspaces } from '../hooks/useWorkspaces'
import type { Permission, Repo, Run } from '@shared/models'
import type { ContextChip } from '../context'

const PERMISSION_LABELS: Record<Permission, string> = {
  read_only: '읽기 전용',
  edit: '편집 허용',
  full: '전체 허용'
}

export function RunPanel({ workspaceId, repos, reposError, chips, onRemoveChip, onStarted }: {
  workspaceId: string
  repos: Repo[]
  reposError: string | null
  chips: ContextChip[]
  onRemoveChip: (chip: ContextChip) => void
  onStarted: (run: Run) => void
}) {
  const client = useClient()
  const { workspaces } = useWorkspaces()
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null

  const [cwd, setCwd] = useState('')
  const [permission, setPermission] = useState<Permission>('edit')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 권한 기본값은 workspace의 defaultPermission이고, 선택은 그 run에만 적용된다 (설계 §7).
  useEffect(() => {
    if (workspace) setPermission(workspace.defaultPermission)
  }, [workspace])

  useEffect(() => {
    if (!cwd && repos.length > 0) setCwd(repos[0]!.path)
  }, [repos, cwd])

  const ready = cwd !== '' && prompt.trim() !== '' && !busy

  async function start() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const run = await client.runs.start({
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
        <label>
          작업 디렉토리
          <select value={cwd} onChange={(e) => setCwd(e.target.value)}>
            {repos.map((r) => (
              <option key={r.id} value={r.path}>{r.name} — {r.path}</option>
            ))}
          </select>
        </label>
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
