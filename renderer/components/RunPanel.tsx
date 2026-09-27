import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { CommandPicker } from './CommandPicker'
import { useCommands } from '../hooks/useCommands'
import { findSlashToken, insertCommand, extendCommand, matchCommands, commonPrefix } from '../slash'
import { useClient } from '../client/ClientProvider'
import { useDraftStore } from '../store/DraftContext'
import { draftKeyOf, isBlankDraft } from '../store/drafts'
import { PERMISSION_LABELS } from '../permission'
import { AGENT_KINDS, AGENT_LABELS } from '../agents'
import { runShortcutLabel } from '../shortcut'
import type { AgentKind, CommandInfo, Permission, Repo, Run, Workspace } from '@shared/models'
import type { Conversation } from '../conversation'
import type { ContextChip } from '../context'
import { ModelField } from './ModelField'
import { CopyButton } from './CopyButton'
import { repoLabel } from './ConversationList'
import { IconClose, IconSend, IconStop } from './icons'
import { EFFORT_OPTIONS } from '../effort'

/** 예약 칩에 보일 지시 — 첫 줄만. 전체는 칩의 title로 읽는다 (spec FR-30). */
function firstLineOf(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

/**
 * 이 agent에 쓸 workspace 기본 모델. 빈 문자열은 "CLI 자신의 기본값"이다.
 *
 * **컬럼이 agent별로 나뉘어 있는 이유가 여기서 드러난다** — claude는 `sonnet`
 * 같은 별칭을, opencode는 `provider/model`을 쓴다(전체 설계 §199). 한쪽 값을
 * 다른 쪽에 넘기면 그 CLI가 모르는 이름이 되므로, 고르는 기준은 workspace가
 * 아니라 **지금 고른 agent**다.
 */
function defaultModelOf(workspace: Workspace | null, agentKind: AgentKind): string {
  if (!workspace) return ''
  const value = agentKind === 'opencode'
    ? workspace.defaultModelOpencode
    : workspace.defaultModelClaude
  return value ?? ''
}

/**
 * 이 agent에 쓸 workspace 기본 effort/variant. **모델과 같은 규칙이다.**
 *
 * claude의 `high`와 opencode의 `high`는 다른 것을 가리키므로 컬럼이 갈려 있고
 * (전체 설계 §199), 고르는 기준도 workspace가 아니라 **지금 고른 agent**다.
 */
function defaultEffortOf(workspace: Workspace | null, agentKind: AgentKind): string {
  if (!workspace) return ''
  const value = agentKind === 'opencode'
    ? workspace.defaultVariantOpencode
    : workspace.defaultEffortClaude
  return value ?? ''
}

/**
 * 입력부 — 카드 하나다 (`docs/sdlc/conversation-timeline/` spec FR-27). 카드 위(밖)에 오류·경고와
 * 예약 칩, 카드 안에 맥락 칩 줄(담은 것이 있을 때) · 입력칸 · 알약 다섯(agent·모델·effort/variant·권한·작업
 * 디렉토리)과 전송 버튼. **모양만 바뀌었다** — 기본값·잠김을 정하는 effect와 `ready` 판정은
 * 카드가 되기 전 그대로다.
 */
export function RunPanel({
  workspaceId, workspaces, repos, reposError, chips, onRemoveChip, onStarted,
  conversation, draftPrompt, draftCwd, reserved, running, reservation, waitingFirst,
  onCancel, inputRef
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
  /**
   * 이 대화에서 지금 도는 턴. 있고 입력이 비었으면 전송 버튼이 **중지**가 된다 (spec FR-28).
   * `reserved`처럼 상위(ConversationPanel)가 계산해 넘긴다 — 여기서는 규칙을 세우지 않는다.
   */
  running: Run | null
  /** 예약 — 뿌리가 아닌 pending 턴. 대화록이 아니라 입력칸 위 칩으로 그린다 (FR-30). */
  reservation: Run | null
  /** 첫 지시(뿌리 턴)가 슬롯을 기다리는 중이다. 그 턴은 대화록에 남고 여기서는 안내만 한다 (FR-30). */
  waitingFirst: boolean
  /** 중지·예약 취소가 부른다 — 도크의 `cancel`이다(실패하면 도크 배너로 보인다) */
  onCancel: (runId: string) => void
  /**
   * 입력칸. **밖에서 받는다** — 대화록의 `답하기`가 여기에 포커스를 준다 (FR-44). 피커의
   * 커서 복원도 같은 ref를 쓴다.
   */
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const client = useClient()
  const drafts = useDraftStore()
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null

  const [cwd, setCwd] = useState('')
  // "다시 실행"이 요구한 경로가 지금 repo 목록에 없을 때 그 경로를 담는다.
  const [missingCwd, setMissingCwd] = useState<string | null>(null)
  const [permission, setPermission] = useState<Permission>('edit')
  const [agentKind, setAgentKind] = useState<AgentKind>(conversation?.last.agentKind ?? workspace?.defaultAgentKind ?? 'claude-code')
  // 실제 값은 아래 두 effect가 세운다 — 권한과 같은 구조다. 여기서 한 번 더
  // 계산하면 같은 규칙이 두 군데에 생기고, effect 쪽이 어떤 테스트로도 고정되지
  // 않는다(변이를 돌려 실제로 확인했다).
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  // 쓰던 지시는 이 컴포넌트가 아니라 초안 스토어가 쥔다 (spec FR-31). 입력부는 대화를 바꿀
  // 때마다(key) 다시 마운트되고, 인박스·설정에 가면 도크째로 사라진다 — 여기 state만 두면
  // 그때마다 쓰던 지시가 지워진다. 마운트할 때 그 대화의 초안에서 시작한다.
  const draftKey = draftKeyOf(conversation?.id ?? null, workspaceId)
  const [prompt, setPrompt] = useState(() => drafts.get(draftKey))
  // 마운트된 채로 키가 바뀌면(다른 대화·다른 workspace) 그 키의 초안에서 다시 시작한다. 도크가
  // key로 다시 마운트해 주지만 그 약속 하나에 기대면 앞 대화의 글을 다음 대화로 들고 간다.
  // effect가 아니라 렌더 중에 맞춘다 — effect면 옛 글이 새 키에 한 번 쓰인다.
  const [promptKey, setPromptKey] = useState(draftKey)
  if (promptKey !== draftKey) {
    setPromptKey(draftKey)
    setPrompt(drafts.get(draftKey))
  }
  // 바뀔 때마다 쓴다 — 치기·커맨드 넣기·"다시 실행"이 채우기가 전부 이 한 자리를 지난다.
  useEffect(() => {
    drafts.set(draftKey, prompt)
  }, [drafts, draftKey, prompt])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promptRef = inputRef
  const pendingCursor = useRef<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  // 피커의 listbox와 option id. textarea가 aria-controls/aria-activedescendant로 가리켜야
  // 스크린리더가 ↑↓로 무엇이 골라지는지 읽는다 — 시각적 하이라이트만으로는 전달되지 않는다.
  const listboxId = useId()
  const optionId = (name: string) => `${listboxId}-${name}`
  const effectiveCwd = conversation?.last.cwd ?? (missingCwd === null ? cwd : '')
  const commandState = useCommands(workspaceId, agentKind === 'claude-code' ? effectiveCwd : '')
  const token = agentKind === 'claude-code' && !dismissed ? findSlashToken(prompt, cursor) : null
  const query = token?.query ?? ''
  // 앞글자 일치 > 중간 일치 > 설명 > 건너뛰기 > 오타 순. 규칙은 slash.ts에.
  const filtered = matchCommands(commandState.commands, query)
  const pickedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1))
  const picked = token ? filtered[pickedIndex] : undefined
  const argumentWarning = agentKind === 'claude-code' && commandState.commands.some((command) =>
    command.usesArguments && prompt.trimStart().split(/\s+/).includes(`/${command.name}`))

  function pickCommand(command: CommandInfo) {
    if (!token) return
    const inserted = insertCommand(prompt, token, command.name)
    setPrompt(inserted.text)
    setCursor(inserted.cursor)
    setDismissed(true)
    pendingCursor.current = inserted.cursor
  }

  /**
   * 셸의 Tab. 후보가 여럿이고 공유하는 앞부분이 지금 친 것보다 길면 거기까지만 채우고
   * 피커를 열어 둔다. 더 채울 게 없으면 고른 것을 넣는다 — Enter와 같아진다.
   */
  function completeCommand() {
    if (!token) return
    const prefix = commonPrefix(filtered.map((command) => command.name))
    if (filtered.length > 1 && prefix.length > token.query.length) {
      const extended = extendCommand(prompt, token, prefix)
      setPrompt(extended.text)
      setCursor(extended.cursor)
      setSelectedIndex(0)
      pendingCursor.current = extended.cursor
    } else if (filtered[pickedIndex]) pickCommand(filtered[pickedIndex])
  }

  useLayoutEffect(() => {
    if (pendingCursor.current === null) return
    promptRef.current?.focus()
    promptRef.current?.setSelectionRange(pendingCursor.current, pendingCursor.current)
    pendingCursor.current = null
  }, [prompt])

  // agent 기본값도 workspace에서 오고 선택은 그 run에만 적용된다. 권한과 달리
  // 대화를 이어갈 때는 **잠긴다** — 세션은 특정 CLI가 특정 디렉토리에서 만든
  // 것이라 다른 조합으로 이어받을 수 없다 (전체 설계 §362). 잠겨 있으니 권한
  // 쪽처럼 사용자가 고른 값을 지켜줄 ref가 필요 없다.
  useEffect(() => {
    if (conversation) setAgentKind(conversation.last.agentKind)
    else if (workspace) setAgentKind(workspace.defaultAgentKind)
  }, [workspace, conversation])

  // 모델 기본값도 workspace에서 오지만 **agent에 따라 다른 칸에서 온다**(설계 §199).
  // 그래서 deps에 agentKind가 있다 — agent를 바꾸면 모델 칸이 따라 바뀌어야
  // claude 별칭이 opencode로 넘어가는 일이 없다. 선택은 agent·권한과 같은 규칙으로
  // 그 run에만 적용된다(설계 §403).
  //
  // 대화를 이어갈 때는 손대지 않는다 — 아래 대화 effect가 마지막 턴의 모델을 세운다.
  // 여기서도 세우면 workspace 조회가 늦게 도착할 때 그 값을 조용히 덮는다(바로 아래
  // 권한 effect의 경고와 같은 사고다).
  useEffect(() => {
    if (conversation) return
    setModel(defaultModelOf(workspace, agentKind))
  }, [workspace, conversation, agentKind])

  // effort도 **모델과 같은 규칙**이다 — agent별 칸에서 오고, agent를 바꾸면 따라
  // 바뀐다. 이 effect가 없으면 claude에 넣은 `high`가 opencode의 `--variant`로
  // 그대로 넘어간다.
  //
  // **대화를 이어갈 때도 초기화한다.** 모델과 다른 점이다: 모델은 세션이 쓰던 것을
  // 이어 보여주는 편이 낫지만, effort는 어느 CLI도 되돌려 주지 않아 "지난 턴이
  // 무엇이었나"를 화면이 단정할 수 없다. 매 턴 새로 고른다(spec FR-14).
  useEffect(() => {
    setEffort(defaultEffortOf(workspace, agentKind))
  }, [workspace, agentKind])

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
    if (!conversation) return
    setPermission(conversation.last.permission)
    // 모델도 같은 이유로 여기 있다. 위 모델 effect와 달리 이쪽은 대화가 실제로
    // 바뀐 순간에만 돈다 — [conversation]에 그냥 기대면 같은 대화의 아무 run이
    // 상태를 바꿀 때마다 사용자가 방금 고친 모델이 되감긴다.
    setModel(conversation.last.model ?? '')
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
            effort: effort.trim() || null,
            permission,
            userPrompt: prompt,
            context: chips.map(({ type, id }) => ({ type, id }))
          })
        : await client.runs.start({
            workspaceId,
            agentKind,
            model: model.trim() || null,
            effort: effort.trim() || null,
            cwd,
            permission,
            userPrompt: prompt,
            context: chips.map(({ type, id }) => ({ type, id }))
          })
      setPrompt('')
      // 스토어도 여기서 바로 비운다 — 위 effect에만 맡기지 않는다. 새 대화의 첫 턴이면
      // onStarted가 도크를 그 대화로 넘기며 이 입력부를 갈아끼우는데, 두 갱신이 한 번에
      // 그려지면 이 인스턴스는 빈 입력을 그려 보지도 못하고 사라져 effect가 돌지 않는다
      // — 방금 보낸 지시가 새 대화 칸의 초안으로 되살아난다.
      drafts.set(draftKey, '')
      onStarted(run)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function onPromptKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (token) {
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') setDismissed(true)
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const direction = e.key === 'ArrowDown' ? 1 : -1
          setSelectedIndex(filtered.length ? (pickedIndex + direction + filtered.length) % filtered.length : 0)
        } else if (e.key === 'Tab') completeCommand()
        else if (filtered[pickedIndex]) pickCommand(filtered[pickedIndex])
        return
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void start()
    }
  }

  const shown = error ?? reposError
  // 대화에 도는 턴이 있고 쓸 지시가 없으면 전송 버튼은 **중지**다 (spec FR-28). 치기 시작하면
  // 실행(예약)으로 돌아간다 — 공백만으로는 아니다: 그것으로는 보낼 수 없다.
  // 판정은 헤더의 멈추기(초안이 있을 때만 선다, spec §8의 3)와 같은 함수다 — 둘이 번갈아 선다.
  const stopTarget = running && isBlankDraft(prompt) ? running : null

  return (
    <div className="run-panel">
      {/* 카드 밖, 위 — 오류·경고·예약 칩 (FR-27의 1·2). 카드 안에 두면 카드가 늘어나 입력칸을
          밀어낸다. */}
      {shown && <div role="alert" className="form-error">{shown}</div>}
      {missingCwd && (
        <div role="alert" className="form-error">
          {/* 경로만 모노다 — UI 글꼴은 한국어 Windows에서 `\`를 `₩`로 그린다(spec §8의 7). */}
          이 실행의 작업 디렉토리 <span className="path-text">{missingCwd}</span> 를 이 workspace의 repo 목록에서 찾을 수 없습니다.
          repo를 등록하거나 다른 디렉토리를 고르세요.
        </div>
      )}
      {repos.length === 0 && (
        <div className="panel-empty">작업 디렉토리로 쓸 repo를 먼저 등록하세요</div>
      )}
      {reservation && (
        // 예약은 대화록이 아니라 여기다 (FR-30, intent D3) — 시작된 뒤에야 대화록에 나타난다.
        // live region이다: 전송이 잠긴 이유를 입력부만 보는 사람도 읽어야 한다. 그래서 이 줄은
        // 상태가 바뀔 때만 바뀐다 — 흐르는 시간 같은 것을 넣지 않는다(NFR-4).
        <div role="status" className="composer-queue">
          {/* e2e가 `getByText('대기 중')`으로 잡는다 — 단독 span이어야 이것 하나에만 걸린다. */}
          <span className="composer-queue-label">대기 중</span>
          <span className="composer-queue-prompt" title={reservation.userPrompt}>
            {firstLineOf(reservation.userPrompt)}
          </span>
          <span className="composer-queue-reason">
            {running ? '앞 턴이 끝나면 보냅니다' : '실행 슬롯이 비면 보냅니다'}
          </span>
          <button type="button" onClick={() => onCancel(reservation.id)}>예약 취소</button>
        </div>
      )}
      {waitingFirst && (
        // 첫 지시는 대화록에 남는다(§6 우려 1) — 대화록이 비면 무엇이 걸려 있는지 보이지 않는다.
        // 여기서는 왜 보낼 수 없는지만 말한다.
        <div role="status" className="composer-note">
          첫 지시가 실행을 기다리는 중입니다 — 시작된 뒤에 다음 지시를 보낼 수 있습니다
        </div>
      )}
      {argumentWarning && (
        <div className="command-warning" role="note">
          이 커맨드는 뒤에 오는 글을 인자로 씁니다 — 담은 맥락이 인자로 전달됩니다
        </div>
      )}

      <div className="composer-card">
        {/* 이번 턴에 담을 맥락 (FR-27의 3). 많아도 두 줄 높이 안에서 스크롤한다.
            **담은 것이 있을 때만 선다** (spec §8의 4, 결정 2026-09-27) — 비었을 때의 안내 줄("왼쪽
            항목의 ＋를 눌러…")이 한 줄을 늘 먹어 기본 도크에서 입력 카드가 대화록보다 컸다. 담는
            법은 항목 줄의 ＋ 버튼(`맥락에 담기`)이 말한다. */}
        {chips.length > 0 && (
          <div className="run-chips">
            {chips.map((chip) => (
              <button
                key={`${chip.type}:${chip.id}`}
                type="button"
                className="chip"
                /* 칩 전체가 "빼기" 버튼이다. 보이는 글자는 이름뿐이라 동작은 접근성 이름이 말한다.
                   e2e·App.test가 이 이름으로 칩을 잡는다. */
                aria-label={`${chip.label} 맥락에서 빼기`}
                onClick={() => onRemoveChip(chip)}
              >
                {chip.label}
                <IconClose className="chip-remove" width="10" height="10" />
              </button>
            ))}
          </div>
        )}

        {token && (
          <CommandPicker
            id={listboxId}
            optionId={optionId}
            commands={filtered}
            selectedIndex={pickedIndex}
            loading={commandState.loading}
            error={commandState.error}
            onPick={pickCommand}
            onRefresh={() => {
              void commandState.refresh()
              promptRef.current?.focus()
            }}
          />
        )}
        {/* 테두리 없이 카드에 녹는다 — 포커스는 카드의 테두리가 보인다(:focus-within). 피커는
            이 칸의 anchor-name에 붙어 위로 열린다(FR-32 — 바꾸지 않는다). */}
        <textarea
          ref={promptRef}
          className="run-prompt"
          aria-label="지시"
          aria-autocomplete="list"
          aria-controls={token ? listboxId : undefined}
          aria-activedescendant={picked ? optionId(picked.name) : undefined}
          value={prompt}
          placeholder={`무엇을 시킬지 적으세요. ${runShortcutLabel(navigator.platform)}로 실행합니다.`}
          onChange={(e) => {
            setPrompt(e.target.value)
            setCursor(e.target.selectionStart)
            setDismissed(false)
            setSelectedIndex(0)
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onKeyDown={onPromptKeyDown}
        />

        {/* 알약 다섯 + 전송 (FR-27의 5). **보이는 글자는 값이지만 이름은 그대로다** — select는
            `<label>`로 감싸지 않고 aria-label로 이름을 준다: 감싸면 옵션 글자가 이름에 빨려
            들어가 e2e의 getByLabel이 다른 것과 부딪힌다(CLAUDE.md). */}
        <div className="composer-controls">
          {/* 대화를 이어갈 때만 잠긴다 — 세션은 특정 CLI가 만든 것이라
              다른 CLI로 이어받을 수 없다 (전체 설계 §362). */}
          <select
            className="pill"
            aria-label="agent"
            value={agentKind}
            disabled={Boolean(conversation)}
            onChange={(e) => setAgentKind(e.target.value as AgentKind)}
          >
            {/* 이름은 한 표에서 온다 (docs/sdlc/conversation-timeline/ spec FR-46). */}
            {AGENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>{AGENT_LABELS[kind]}</option>
            ))}
          </select>
          {/* 빈 칸이면 -m을 붙이지 않아 CLI 자신의 기본값으로 돈다. workspace
              기본값은 설정 화면에서 agent별로 정한다 (설계 §403).
              **설정 화면과 같은 컴포넌트다** — 두 화면이 같은 값을 다른 말로
              부르면 안 된다(docs/sdlc/agent-setup/ FR-11). 알약 모양은 CSS가 입힌다 —
              컴포넌트가 그리는 "모델" 글자가 알약의 머리가 된다. */}
          <ModelField
            agentKind={agentKind}
            label="모델"
            value={model}
            onChange={setModel}
          />

          {/* claude는 다섯 단계가 정해져 있고(`--help`가 열거한다), opencode의
              variant는 provider마다 값이 달라 자유 입력이다(FR-12·FR-13).
              값이 비면 "기본값"만 보여 무엇의 기본값인지 모른다 — 알약에 칸 이름을 머리로 단다. */}
          {agentKind === 'opencode' ? (
            <label className="pill pill-field">
              <span className="pill-name">variant</span>
              <input
                aria-label="variant"
                value={effort}
                placeholder="기본값"
                onChange={(e) => setEffort(e.target.value)}
              />
            </label>
          ) : (
            <span className="pill pill-field">
              <span className="pill-name" aria-hidden="true">effort</span>
              <select
                aria-label="effort"
                value={effort}
                onChange={(e) => setEffort(e.target.value)}
              >
                {/* 표에 없는 값(설정에 손으로 넣은 것)을 잃지 않는다 — select에 없는
                    값을 주면 브라우저가 ''로 정규화해 문제가 화면에서 사라진다. */}
                {effort && !EFFORT_OPTIONS.some((o) => o.value === effort) && (
                  <option value={effort}>{effort} (표에 없는 값)</option>
                )}
                {EFFORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </span>
          )}
          <select
            className="pill"
            aria-label="권한"
            value={permission}
            onChange={(e) => setPermission(e.target.value as Permission)}
          >
            {(Object.keys(PERMISSION_LABELS) as Permission[]).map((p) => (
              <option key={p} value={p}>{PERMISSION_LABELS[p]}</option>
            ))}
          </select>
          {conversation ? (
            // 세션은 특정 CLI가 특정 디렉토리에서 만든 것이라 둘 다 바꿀 수 없다 (설계 §6).
            // 대화를 벗어나는 것은 도크의 대화 목록이 한다 — 여기엔 나갈 버튼이 없다.
            //
            // **글자는 repo 이름, 경로는 title과 곁의 복사 버튼이다** (spec §8의 1, 결정 2026-09-27
            // — 안 (다)). 경로를 값으로 두면 좁은 알약이 끝을 말줄임해 앞부분(`C:\Users\…\App…`)만
            // 보이고 구별되는 repo 폴더가 잘렸다. 이름은 대화 목록 줄·헤더 부제와 같은 함수다 — 같은
            // 대화의 repo를 다른 말로 부르지 않는다. disabled가 아니라 readOnly다 — 잠겼어도 포커스가
            // 가고 title을 읽을 수 있다.
            <>
              <input
                className="pill run-locked"
                aria-label="작업 디렉토리"
                value={repoLabel(conversation, repos)}
                readOnly
                title={conversation.last.cwd}
              />
              <CopyButton text={conversation.last.cwd} label="작업 디렉토리 경로 복사" />
            </>
          ) : (
            <select
              // 알약이 경로를 보이는 것은 목록에 없는 경로가 골라져 있을 때뿐이다 — 그때만 모노다
              // (spec §8의 7).
              className={missingCwd ? 'pill path-text' : 'pill'}
              aria-label="작업 디렉토리"
              value={cwd}
              title={cwd || undefined}
              onChange={(e) => setCwd(e.target.value)}
            >
              {/* 목록에 없는 경로도 그대로 보여준다 — option에 없는 값을 주면 브라우저가
                  select.value를 ''로 정규화해 무엇이 문제인지 화면에서 사라진다. */}
              {missingCwd && <option value={missingCwd}>{missingCwd} (없는 경로)</option>}
              {/* 알약에는 이름만 — 경로는 title로 읽는다 (FR-27). */}
              {repos.map((r) => (
                <option key={r.id} value={r.path} title={r.path}>{r.name}</option>
              ))}
            </select>
          )}

          {/* 전송 버튼은 둘 중 하나다 (FR-28). 이름은 정확히 "실행"/"중지" — e2e가 실행을
              `{ name: '실행', exact: true }`로 잡는다. **Esc·단축키로 멈추지 않는다** — 멈춤은
              되돌릴 수 없고, Esc는 이미 "안쪽부터 푼다"의 약속이 있다. */}
          {stopTarget ? (
            <button
              type="button"
              className="run-start run-stop"
              aria-label="중지"
              title="중지"
              onClick={() => onCancel(stopTarget.id)}
            >
              <IconStop />
            </button>
          ) : (
            <button
              type="button"
              className="run-start"
              aria-label="실행"
              title="실행"
              disabled={!ready}
              onClick={() => void start()}
            >
              <IconSend />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
