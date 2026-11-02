import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../client/ClientProvider'
import { SchedulePanel } from './SchedulePanel'
import type { OneDeskClient } from '@shared/client'
import type { Repo, ScheduleFireView, ScheduleInput, SchedulePreview, ScheduleView, Workspace } from '@shared/models'

const WS = [
  { id: 'w1', name: '회사', defaultAgentKind: 'claude-code', defaultModelClaude: null, defaultModelOpencode: null, defaultEffortClaude: null, defaultVariantOpencode: null, defaultPermission: 'read_only' },
  { id: 'w2', name: '개인', defaultAgentKind: 'claude-code', defaultModelClaude: null, defaultModelOpencode: null, defaultEffortClaude: null, defaultVariantOpencode: null, defaultPermission: 'read_only' }
] as Workspace[]
const REPOS = [{ id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', agentEnv: 'host' }] as Repo[]

function schedule(over: Partial<ScheduleView> = {}): ScheduleView {
  return {
    id: 's1', workspaceId: 'w1', repoId: 'r1', name: '아침 훑기', trigger: { kind: 'weekdays', time: '09:00' }, timeZone: 'Asia/Seoul',
    conversationMode: 'new', conversationId: null, agentKind: 'claude-code', model: null, effort: null, permission: 'read_only',
    prompt: '훑어 줘', context: [], enabled: true, disabledReason: null, anchorAt: 1, consecutiveFailures: 0, createdAt: 1, updatedAt: 1,
    nextAt: Date.now() + 3_600_000, repoName: 'api', lastFire: null, ...over
  }
}

function makeClient(over: { schedules?: ScheduleView[]; fires?: ScheduleFireView[]; preview?: SchedulePreview } = {}) {
  let rows = over.schedules ?? []
  const create = vi.fn(async (input: ScheduleInput) => {
    const made = schedule({ ...input, id: 'new-1' })
    rows = [...rows, made]
    return made
  })
  const update = vi.fn(async (id: string, input: ScheduleInput) => {
    const updated = { ...rows.find((r) => r.id === id)!, ...input }
    rows = rows.map((r) => (r.id === id ? updated : r))
    return updated
  })
  const setEnabled = vi.fn(async (id: string, enabled: boolean) => {
    rows = rows.map((r) => (r.id === id ? { ...r, enabled } : r))
    return rows.find((r) => r.id === id)!
  })
  const client = {
    schedules: {
      list: vi.fn(async () => rows),
      create, update, setEnabled,
      remove: vi.fn(async () => {}),
      runNow: vi.fn(async () => ({ id: 'run-1' })),
      fires: vi.fn(async () => over.fires ?? []),
      preview: vi.fn(async () => over.preview ?? { ok: true, next: [Date.now() + 60_000, Date.now() + 120_000, Date.now() + 180_000] })
    },
    repos: { list: vi.fn(async (ws: string) => REPOS.filter((r) => r.workspaceId === ws)) },
    issues: { list: vi.fn(async () => [{ id: 'i1', title: '환불 웹훅' }]) },
    memos: { list: vi.fn(async () => []) },
    assets: { list: vi.fn(async () => [{ id: 'a1', name: 'CLAUDE.md', kind: 'instructions' }, { id: 'a2', name: 'review', kind: 'skill' }]) },
    events: { onRunUpdate: vi.fn(() => () => {}), onItemChanged: vi.fn(() => () => {}) }
  } as unknown as OneDeskClient
  return { client, create, update, setEnabled }
}

function renderPanel(client: OneDeskClient, onOpenConversation = vi.fn()) {
  render(<ClientProvider client={client}><SchedulePanel workspaces={WS} onOpenConversation={onOpenConversation} /></ClientProvider>)
  return { onOpenConversation }
}

async function fillNew(name = '저녁 요약') {
  await userEvent.click(screen.getByRole('button', { name: '새 정기 실행' }))
  await userEvent.type(await screen.findByLabelText('정기 실행 이름'), name)
  await userEvent.type(screen.getByLabelText('정기 실행 지시'), '열린 이슈를 요약해 줘')
  await waitFor(() => expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/다음:/))
}

describe('SchedulePanel (docs/sdlc/scheduled-runs/ spec FR-26~33)', () => {
  it('비었으면 빈 상태 하나가 무엇인지 말한다', async () => {
    renderPanel(makeClient().client)
    expect(await screen.findByText('정기 실행이 없습니다.')).toBeInTheDocument()
  })

  it('workspace로 묶고, 줄에 repo · 주기 · 다음 실행 또는 꺼진 이유가 선다', async () => {
    renderPanel(makeClient({
      schedules: [schedule(), schedule({ id: 's2', name: '고장', enabled: false, disabledReason: 'failures', nextAt: null })]
    }).client)
    const group = await screen.findByRole('region', { name: '회사 묶음' })
    expect(within(group).getByRole('button', { name: '아침 훑기 정기 실행 편집' })).toHaveTextContent(/api · 평일 09:00/)
    expect(within(group).getByRole('button', { name: '아침 훑기 정기 실행 편집' })).toHaveTextContent(/다음 /)
    expect(within(group).getByRole('button', { name: '고장 정기 실행 편집' })).toHaveTextContent('연속 3번 실패해 꺼졌습니다')
    expect(screen.queryByRole('region', { name: '개인 묶음' })).toBeNull()
  })

  it('새 정기 실행은 그 workspace의 기본값으로 시작하고 저장하면 그 시간대로 만든다', async () => {
    const { client, create } = makeClient()
    renderPanel(client)
    await fillNew()
    expect(screen.getByLabelText('정기 실행 작업 디렉토리')).toHaveValue('r1')
    // 지시 파일은 맥락 목록에 없다
    expect(screen.queryByText('CLAUDE.md')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]![0]).toMatchObject({
      workspaceId: 'w1', repoId: 'r1', name: '저녁 요약', trigger: { kind: 'weekdays', time: '09:00' },
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, permission: 'read_only', conversationMode: 'new'
    })
  })

  it('전체 허용으로 올릴 때만 두 번 눌러야 저장된다 (FR-29)', async () => {
    const { client, create } = makeClient()
    renderPanel(client)
    await fillNew()
    await userEvent.selectOptions(screen.getByLabelText('정기 실행 권한'), 'full')
    expect(screen.getByText(/사람이 보지 않는 시각에/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(create).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /전체 허용으로 저장합니다/ }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
  })

  it('이미 전체 허용이면 다른 것을 고칠 때 묻지 않는다', async () => {
    const { client, update } = makeClient({ schedules: [schedule({ permission: 'full' })] })
    renderPanel(client)
    await userEvent.click(await screen.findByRole('button', { name: '아침 훑기 정기 실행 편집' }))
    await userEvent.type(screen.getByLabelText('정기 실행 지시'), ' 더')
    await waitFor(() => expect(screen.getByRole('button', { name: '저장' })).toBeEnabled())
    expect(screen.queryByText(/사람이 보지 않는 시각에/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0]![1].timeZone).toBe('Asia/Seoul')
  })

  it('바뀐 것이 없으면 저장이 잠긴다', async () => {
    renderPanel(makeClient({ schedules: [schedule()] }).client)
    await userEvent.click(await screen.findByRole('button', { name: '아침 훑기 정기 실행 편집' }))
    await screen.findByText(/다음:/)
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('미리보기가 거부하면 그 말이 보이고 저장이 잠긴다 — 판정은 core의 것이다', async () => {
    const { client } = makeClient({ preview: { ok: false, error: '정기 실행은 10분보다 자주 돌 수 없습니다' } })
    renderPanel(client)
    await userEvent.click(screen.getByRole('button', { name: '새 정기 실행' }))
    await userEvent.type(await screen.findByLabelText('정기 실행 이름'), 'x')
    await userEvent.type(screen.getByLabelText('정기 실행 지시'), 'y')
    expect(await screen.findByText('정기 실행은 10분보다 자주 돌 수 없습니다')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('이어 가던 대화가 있으면 agent를 바꿀 때 새 대화로 시작한다고 말한다 (FR-30)', async () => {
    renderPanel(makeClient({ schedules: [schedule({ conversationMode: 'continue', conversationId: 'root-1' })] }).client)
    await userEvent.click(await screen.findByRole('button', { name: '아침 훑기 정기 실행 편집' }))
    expect(screen.queryByText(/다음 실행부터 새 대화로/)).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('정기 실행 agent'), 'opencode')
    expect(screen.getByText(/다음 실행부터 새 대화로/)).toBeInTheDocument()
  })

  it('스위치가 켜고 끈다', async () => {
    const { client, setEnabled } = makeClient({ schedules: [schedule()] })
    renderPanel(client)
    await userEvent.click(await screen.findByRole('switch', { name: '아침 훑기 켜기' }))
    expect(setEnabled).toHaveBeenCalledWith('s1', false)
  })

  it('실행 기록 — 사유·결과·건너뜀·뺀 맥락, 대화 열기는 그 workspace의 그 대화', async () => {
    const at = Date.now()
    const fires: ScheduleFireView[] = [
      { id: 'f1', scheduleId: 's1', cause: 'missed', slotAt: at, firedAt: at, outcome: 'started', skipReason: null, message: null, runId: 'r9', droppedContext: 1, runStatus: 'failed', needsAnswer: false, conversationId: 'root-9' },
      { id: 'f2', scheduleId: 's1', cause: 'on_time', slotAt: at, firedAt: at, outcome: 'skipped', skipReason: 'busy', message: null, runId: null, droppedContext: 0, runStatus: null, needsAnswer: false, conversationId: null }
    ]
    const { onOpenConversation } = renderPanel(makeClient({ schedules: [schedule({ lastFire: fires[0]! })], fires }).client)
    await userEvent.click(await screen.findByRole('button', { name: '아침 훑기 정기 실행 편집' }))
    const region = await screen.findByRole('region', { name: '실행 기록' })
    expect(await within(region).findByText('놓쳐서 실행')).toBeInTheDocument()
    expect(within(region).getByText('실패')).toBeInTheDocument()
    expect(within(region).getByText('지워진 맥락 1개는 빠졌습니다')).toBeInTheDocument()
    expect(within(region).getByText('앞 실행이 돌고 있어 건너뜀')).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: '대화 열기' }))
    expect(onOpenConversation).toHaveBeenCalledWith('w1', 'root-9')
  })

  it('고친 것이 있는데 다른 것을 고르면 묻는다 — 버리고 이동하거나 계속 고친다 (FR-31)', async () => {
    renderPanel(makeClient({ schedules: [schedule(), schedule({ id: 's2', name: '저녁' })] }).client)
    await userEvent.click(await screen.findByRole('button', { name: '아침 훑기 정기 실행 편집' }))
    await userEvent.type(screen.getByLabelText('정기 실행 지시'), ' 바뀜')
    await userEvent.click(screen.getByRole('button', { name: '저녁 정기 실행 편집' }))
    expect(screen.getByText('고친 것이 저장되지 않았습니다.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '계속 고치기' }))
    expect(screen.getByLabelText('정기 실행 지시')).toHaveValue('훑어 줘 바뀜')
    await userEvent.click(screen.getByRole('button', { name: '저녁 정기 실행 편집' }))
    await userEvent.click(screen.getByRole('button', { name: '버리고 이동' }))
    expect(screen.getByLabelText('정기 실행 이름')).toHaveValue('저녁')
  })
})
