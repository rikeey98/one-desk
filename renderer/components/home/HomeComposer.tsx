import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { AgentKind, HomeTarget, HomeWorkspace, Permission, StartRunInput, Workspace } from '@shared/models'
import { AGENT_KINDS, AGENT_LABELS } from '../../agents'
import { PERMISSION_LABELS } from '../../permission'
import { agentBlockedReason } from '../../agentEnv'
import { defaultModelOf, newRunInput } from '../../runDefaults'
import { ModelField } from '../ModelField'
import { targetOf } from '../../home/target'

const PERMISSIONS: readonly Permission[] = ['read_only', 'edit', 'full']

/**
 * 바닥의 새 대화 카드 (`docs/sdlc/home/` FR-11, plan 개정 1). 대상은 마지막으로 보낸 workspace · repo(없으면 첫 workspace의 첫 repo),
 * agent·모델·권한은 그 workspace의 기본값이고 알약으로 바꾼다. 보낼 값은 `newRunInput` — 입력부(RunPanel)와 같은 기본값 유도라
 * 카드가 보여준 값이 곧 보내는 값이다. **보내는 것은 App이다**(`onStartConversation`) — 홈은 읽기다.
 *
 * `/`·`@` 피커는 없다(spec §6-2) — `@경로`는 core가 보낼 때 해석한다. 비어 있으면 `실행`이 잠긴다.
 */
export function HomeComposer({
  workspaces, rows, lastTarget, onStartConversation
}: {
  /** 기본값 유도용 전체 행 — App의 `useWorkspaces` 인스턴스 */
  workspaces: Workspace[]
  /** 요약의 workspace 카드(repo 목록·경로·실행 환경) */
  rows: HomeWorkspace[]
  lastTarget: HomeTarget | null
  onStartConversation: (input: StartRunInput, target: HomeTarget) => Promise<void>
}) {
  const fallback = useMemo(() => targetOf(lastTarget, rows), [lastTarget, rows])
  const [picked, setPicked] = useState<HomeTarget | null>(null)
  // 사람이 고른 대상이 요약에서 사라지면(repo 삭제) 폴백으로 돌아간다
  const target = picked && rows.some((w) => w.workspaceId === picked.workspaceId && w.repos.some((r) => r.repoId === picked.repoId))
    ? picked
    : fallback
  const workspace = workspaces.find((w) => w.id === target?.workspaceId) ?? null
  const row = rows.find((w) => w.workspaceId === target?.workspaceId) ?? null
  const repo = row?.repos.find((r) => r.repoId === target?.repoId) ?? null

  const [prompt, setPrompt] = useState('')
  const [agentPick, setAgentPick] = useState<AgentKind | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [permission, setPermission] = useState<Permission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 대상이 바뀌면 그 workspace의 기본값으로 돌아간다 — 전 workspace의 모델 이름을 다른 CLI에 넘기지 않는다
  useEffect(() => { setAgentPick(null); setModel(null); setPermission(null) }, [target?.workspaceId])

  const wanted = agentPick ?? workspace?.defaultAgentKind ?? 'claude-code'
  const agentKind: AgentKind = repo && agentBlockedReason(repo.agentEnv, wanted) ? 'claude-code' : wanted
  const modelValue = model ?? defaultModelOf(workspace, agentKind)
  const permissionValue = permission ?? workspace?.defaultPermission ?? 'edit'
  const ready = prompt.trim() !== '' && workspace !== null && repo !== null && !busy

  async function send() {
    if (!ready || !workspace || !repo || !target) return
    setBusy(true)
    setError(null)
    try {
      const input = newRunInput(workspace, repo, prompt, { agentKind, model: modelValue, permission: permissionValue })
      await onStartConversation(input, target)
      setPrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void send()
    }
  }

  if (!target || !workspace || !repo) {
    return (
      <section className="home-card home-composer" aria-label="새 대화">
        <p className="home-empty">repo를 등록하면 여기서 바로 대화를 시작할 수 있습니다</p>
      </section>
    )
  }

  return (
    <section className="home-card home-composer" aria-label="새 대화">
      <textarea
        aria-label="새 대화 지시"
        placeholder={`${workspace.name} · ${repo.name}에 보낼 지시 — Ctrl+Enter로 보내기`}
        value={prompt}
        rows={2}
        disabled={busy}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="home-composer-pills">
        <select
          aria-label="대상"
          className="home-pill"
          value={`${target.workspaceId}\n${target.repoId}`}
          onChange={(e) => {
            const [workspaceId, repoId] = e.target.value.split('\n')
            if (workspaceId && repoId) setPicked({ workspaceId, repoId })
          }}
        >
          {rows.flatMap((w) => w.repos.map((r) => (
            <option key={`${w.workspaceId}\n${r.repoId}`} value={`${w.workspaceId}\n${r.repoId}`}>{w.name} · {r.name}</option>
          )))}
        </select>
        <select aria-label="agent" className="home-pill" value={agentKind} onChange={(e) => setAgentPick(e.target.value as AgentKind)}>
          {AGENT_KINDS.map((k) => (
            <option key={k} value={k} disabled={agentBlockedReason(repo.agentEnv, k) !== null}>{AGENT_LABELS[k]}</option>
          ))}
        </select>
        <ModelField agentKind={agentKind} value={modelValue} onChange={setModel} label="모델" compact />
        <select aria-label="권한" className="home-pill" value={permissionValue} onChange={(e) => setPermission(e.target.value as Permission)}>
          {PERMISSIONS.map((p) => <option key={p} value={p}>{PERMISSION_LABELS[p]}</option>)}
        </select>
        <button type="button" className="home-primary home-send" disabled={!ready} onClick={() => void send()}>실행</button>
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
    </section>
  )
}
