import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useClient } from '../client/ClientProvider'
import type { Permission, Repo, Run, Workspace } from '@shared/models'
import type { Conversation } from '../conversation'
import type { ContextChip } from '../context'

const PERMISSION_LABELS: Record<Permission, string> = {
  read_only: '읽기 전용',
  edit: '편집 허용',
  full: '전체 허용'
}

export function RunPanel({
  workspaceId, workspaces, repos, reposError, chips, onRemoveChip, onStarted,
  conversation, draftPrompt, draftCwd, reserved
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
  /** 이어갈 대화. null이면 새 대화다. */
  conversation: Conversation | null
  /** "다시 실행"이 채워 넣는 초기 프롬프트 */
  draftPrompt: string
  /** "다시 실행"이 요구하는 작업 디렉토리. null이면 요구가 없다. */
  draftCwd: string | null
  /** 대화당 예약은 하나다 — 이미 예약된 턴이 있으면 전송을 잠근다 (설계 §3-2). */
  reserved: boolean
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
  // 대화를 이어갈 때는 원본(마지막 턴)의 권한이 우선이다 — workspace 조회가 비동기라
  // 나중에 도착하면 이 effect가 다시 실행돼 conversation이 세운 값을 조용히 덮어쓸 수 있다.
  useEffect(() => {
    if (workspace && !conversation) setPermission(workspace.defaultPermission)
  }, [workspace, conversation])

  // 대화를 이어갈 때는 마지막 턴의 권한에서 출발한다. 낮추면 조용히 깎이고,
  // 올리는 것은 사용자의 판단이다 (설계 §7).
  //
  // conversation은 Dock의 groupConversations(runs)가 매번 새로 만드는 객체다 —
  // useRuns가 onRunUpdate로 새 배열을 세울 때마다 useMemo도 다시 돌아, 같은
  // 대화라도 참조가 달라진다. [conversation]에 기대면 그 workspace의 아무 run이나
  // 상태를 바꿀 때마다 이 effect가 다시 돌아, 사용자가 방금 올린 권한이 그 순간
  // 마지막 턴 값으로 조용히 되감긴다(설계 §7 위반 — 위 effect의 "조용히 덮어쓸
  // 수 있다" 경고와 같은 사고다). 그래서 대화가 실제로 "바뀌었을 때"(id가
  // 달라졌을 때)만 반영하도록 이전 id를 ref에 직접 담아 비교한다 — exhaustive-deps
  // 경고는 conversation을 deps에 그대로 두는 것으로 정직하게 만족시킨다.
  const conversationIdRef = useRef<string | null>(null)
  useEffect(() => {
    const id = conversation?.id ?? null
    if (id === conversationIdRef.current) return
    conversationIdRef.current = id
    if (conversation) setPermission(conversation.last.permission)
  }, [conversation])

  // "다시 실행"이 세운 draft는 새 대화에서만 반영한다 — 대화를 이어가는 중이면
  // 프롬프트는 항상 빈 입력에서 시작해야 한다(설계 §7). 그러지 않으면 이전에 세운
  // draft가 남아 있다가, 인박스를 오가며 기존 대화를 이어갈 때 조용히 섞여 들어간다.
  useEffect(() => {
    if (draftPrompt && !conversation) setPrompt(draftPrompt)
  }, [draftPrompt, conversation])

  // cwd를 정하는 단일 effect. "다시 실행"이 요구한 경로(draftCwd)가 있으면 그것을
  // 최우선으로 반영하고, 없을 때만 workspace의 repo 목록에 대한 fallback으로
  // 넘어간다. 두 갈래를 한 함수 안의 순차 조건문(early return)으로 묶어 두면
  // "무엇이 나중에 도느냐"가 일반적인 순차 코드가 되어, 블록을 옮겨도 뒤집히지
  // 않는다 — effect 두 개로 나뉘어 있던 예전 버전은 선언 순서가 곧 실행 순서였고,
  // 뒤집히면 요구한 경로가 첫 repo로 덮여 원본과 다른 저장소에서 agent가 돌았다.
  useEffect(() => {
    if (draftCwd !== null) {
      // "다시 실행"이 요구한 경로다. 목록에 없다고 첫 repo로 조용히 떨어뜨리면
      // 원본과 다른 저장소에서 agent가 돈다 — 권한이 edit이면 엉뚱한 저장소가
      // 편집된다. 조용히 바꾸는 대신 그 사실을 보이고 실행을 막는다.
      setMissingCwd(repos.some((r) => r.path === draftCwd) ? null : draftCwd)
      if (cwd !== draftCwd) setCwd(draftCwd)
      return
    }

    // 요구가 없을 때만 fallback한다: cwd가 지금 workspace의 repo 목록에 없으면
    // 첫 repo로 되돌린다(없으면 비운다). "비어 있을 때만 채운다"로는 부족하다 —
    // RunPanel은 workspace가 바뀌어도 다시 마운트되지 않으므로(App이 key를 주지
    // 않는다) 이전 workspace의 경로가 그대로 남고, ready도 계속 true라 다른
    // workspace의 디렉토리에서 agent가 실행된다. core/execution.ts는 맥락 항목의
    // 소속만 검증하고 cwd는 보지 않는다.
    if (cwd !== '' && repos.some((r) => r.path === cwd)) {
      setMissingCwd(null)
      return
    }
    setMissingCwd(null)
    setCwd(repos.length > 0 ? repos[0]!.path : '')
  }, [repos, cwd, draftCwd])

  // 대화를 이어갈 때는 cwd를 원본에서 받으므로 로컬 cwd가 비어도 실행할 수 있다.
  // reserved면(대화당 예약은 하나다 — 설계 §3-2) 전송을 잠근다.
  const ready = (conversation !== null || (cwd !== '' && missingCwd === null))
    && prompt.trim() !== '' && !busy && !reserved

  async function start() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const run = conversation
        ? await client.runs.resume({
            conversationId: conversation.id,
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
        {conversation ? (
          <div className="resume-locked">
            <span className="resume-badge">대화 이어가기</span>
            {/* 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 둘은 바꿀 수 없다 (설계 §6).
                대화를 벗어나는 것은 이제 도크 탭이 한다 — 여기엔 나갈 버튼이 없다. */}
            <span>{conversation.last.agentKind}</span>
            <span>{conversation.last.cwd}</span>
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
        {chips.length === 0 && <span className="dock-empty">왼쪽 항목의 ＋를 눌러 맥락을 담으세요</span>}
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
        aria-label="지시"
        value={prompt}
        placeholder="무엇을 시킬지 적으세요. ⌘↵ 로 실행합니다."
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onPromptKeyDown}
      />

      <div className="run-actions">
        <button type="button" className="run-start" disabled={!ready} onClick={() => void start()}>
          실행
        </button>
      </div>
    </div>
  )
}
