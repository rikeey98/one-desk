import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientProvider } from '../../client/ClientProvider'
import { CodeBufferProvider } from '../../store/CodeBufferContext'
import { createCodeBufferStore } from '../../store/codeBuffers'
import { createCloseGuard } from '../../store/closeGuard'
import { createPendingSaves } from '../../store/pendingSaves'
import { FilePane, type OpenRequest } from './FilePane'
import type { OneDeskClient } from '@shared/client'
import type { FileOpenResult, FileSaveResult, FileTreeResult, Repo, Run } from '@shared/models'

// CodeMirror는 jsdom에서 믿을 수 없다(plan 위험 2) — 같은 계약을 지키는 textarea로 바꾼다. Ctrl+S는 onSave, Esc는
// CodeMirror처럼 찾기 창을 닫았다고 보고 preventDefault한다.
vi.mock('./CodeEditor', () => ({
  CodeEditor: ({ text, readOnly, label, onChange, onSave, gotoLine }: {
    text: string; readOnly: boolean; label: string; gotoLine: { line: number } | null
    onChange: (t: string) => void; onSave: () => void
  }) => (
    <div>
      <textarea
        aria-label={label}
        value={text}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 's' && e.ctrlKey) { e.preventDefault(); onSave() }
          if (e.key === 'Escape') e.preventDefault()
        }}
      />
      {gotoLine && <span data-testid="goto">{gotoLine.line}</span>}
    </div>
  )
}))

const REPO: Repo = { id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0 }
const OPENED: FileOpenResult = { ok: true, text: 'one\n', eol: 'lf', bom: false, hash: 'h1', bytes: 4 }

function makeClient(over: {
  tree?: FileTreeResult
  open?: (path: string) => FileOpenResult
  save?: ReturnType<typeof vi.fn>
  probe?: ReturnType<typeof vi.fn>
} = {}) {
  let runListener: ((run: Run) => void) | null = null
  const files = {
    search: vi.fn().mockResolvedValue({ ok: true, files: [], truncated: false }),
    tree: vi.fn().mockResolvedValue(over.tree ?? { ok: true, files: ['src/a.ts', 'src/b.ts', 'README.md'], truncated: false }),
    open: vi.fn(async (ref: { path: string }) => (over.open ? over.open(ref.path) : OPENED)),
    save: over.save ?? vi.fn(async (): Promise<FileSaveResult> => ({ ok: true, hash: 'h2' })),
    probe: over.probe ?? vi.fn(async () => ({ hash: 'h1' }))
  }
  const client = {
    files,
    repos: { openInEditor: vi.fn().mockResolvedValue(undefined) },
    events: {
      onRunUpdate: vi.fn((listener: (run: Run) => void) => { runListener = listener; return () => { runListener = null } })
    }
  } as unknown as OneDeskClient
  return { client, files, finishRun: (run: Partial<Run>) => act(() => runListener?.({ workspaceId: 'w1', endedAt: 1, ...run } as Run)) }
}

function renderPane(client: OneDeskClient, props: { openRequest?: OpenRequest | null; onClose?: () => void } = {}) {
  const store = createCodeBufferStore()
  const guard = createCloseGuard({ saves: createPendingSaves(), buffers: store, close: () => {}, save: client.files.save })
  const view = render(
    <ClientProvider client={client}>
      <CodeBufferProvider store={store} guard={guard}>
        <FilePane
          workspaceId="w1"
          repo={REPO}
          openRequest={props.openRequest ?? null}
          onClose={props.onClose ?? (() => {})}
          probeIntervalMs={30}
        />
      </CodeBufferProvider>
    </ClientProvider>
  )
  return { ...view, store }
}

async function openFromTree(name: string, dir = 'src') {
  await userEvent.click(await screen.findByRole('button', { name: dir }))
  await userEvent.click(await screen.findByRole('button', { name }))
}

const editor = (path = 'src/a.ts') => screen.findByRole('textbox', { name: `${path} 내용` })

describe('FilePane (docs/sdlc/code-editor/)', () => {
  it('트리에서 파일을 고르면 repo id + 상대 경로로 열어 편집기에 보인다 (FR-8·FR-15)', async () => {
    const { client, files } = makeClient()
    renderPane(client)

    expect(await screen.findByRole('button', { name: 'README.md' })).toBeInTheDocument()
    await openFromTree('a.ts')

    expect(await editor()).toHaveValue('one\n')
    expect(files.open).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1', path: 'src/a.ts' })
    expect(files.tree).toHaveBeenCalledWith({ workspaceId: 'w1', repoId: 'r1', fresh: false })
  })

  it('고쳐 Ctrl+S로 저장하면 기대 해시를 보내고, 두 번째 저장은 새 해시를 기대한다 (FR-17·FR-19)', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: true, hash: 'h2' })
      .mockResolvedValueOnce({ ok: true, hash: 'h3' })
    // 바뀜 확인이 끼어들지 않게 응답하지 않는 확인을 준다 — 이 테스트는 저장만 본다
    const { client } = makeClient({ save, probe: vi.fn(() => new Promise(() => {})) })
    renderPane(client)
    await openFromTree('a.ts')
    const box = await editor()

    fireEvent.change(box, { target: { value: 'two\n' } })
    expect(screen.getByRole('img', { name: '저장하지 않음' })).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 's', ctrlKey: true })
    await screen.findByText('저장됨')
    expect(save).toHaveBeenLastCalledWith({ workspaceId: 'w1', repoId: 'r1', path: 'src/a.ts', content: 'two\n', expectedHash: 'h1' })

    fireEvent.change(box, { target: { value: 'three\n' } })
    await userEvent.click(screen.getByRole('button', { name: '파일 저장' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'three\n', expectedHash: 'h2' }))
  })

  it('충돌하면 배너를 띄우고, 덮어쓰기는 지금 디스크 해시를 기대값으로 다시 저장한다', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false, conflict: { hash: 'h9', deleted: false } })
      .mockResolvedValueOnce({ ok: true, hash: 'h10' })
    const { client } = makeClient({ save, probe: vi.fn(() => new Promise(() => {})) })
    renderPane(client)
    await openFromTree('a.ts')
    fireEvent.change(await editor(), { target: { value: 'mine\n' } })
    await userEvent.click(screen.getByRole('button', { name: '파일 저장' }))

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('이 파일이 디스크에서 바뀌었습니다')
    await userEvent.click(within(banner).getByRole('button', { name: '내 것으로 덮어쓰기' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'mine\n', expectedHash: 'h9' }))
    await waitFor(() => expect(screen.queryByText('이 파일이 디스크에서 바뀌었습니다.')).not.toBeInTheDocument())
  })

  it('충돌 배너의 디스크 내용 불러오기는 내 고침을 버리고 디스크 글을 보인다', async () => {
    let disk: FileOpenResult = OPENED
    const save = vi.fn().mockResolvedValue({ ok: false, conflict: { hash: 'h9', deleted: false } })
    const { client } = makeClient({ save, open: () => disk, probe: vi.fn(() => new Promise(() => {})) })
    renderPane(client)
    await openFromTree('a.ts')
    fireEvent.change(await editor(), { target: { value: 'mine\n' } })
    await userEvent.click(screen.getByRole('button', { name: '파일 저장' }))
    disk = { ...OPENED, text: 'agent\n', hash: 'h9' }

    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '디스크 내용 불러오기' }))

    await waitFor(async () => expect(await editor()).toHaveValue('agent\n'))
    expect(screen.queryByRole('img', { name: '저장하지 않음' })).not.toBeInTheDocument()
  })

  it('디스크가 바뀌면 고친 것이 없을 때 따라간다 (FR-22)', async () => {
    let disk: FileOpenResult = OPENED
    let hash = 'h1'
    const { client } = makeClient({ open: () => disk, probe: vi.fn(async () => ({ hash })) })
    renderPane(client)
    await openFromTree('a.ts')
    await editor()

    disk = { ...OPENED, text: 'agent wrote\n', hash: 'h2' }
    hash = 'h2'

    await waitFor(async () => expect(await editor()).toHaveValue('agent wrote\n'))
  })

  it('고친 것이 있으면 따라가지 않고 디스크에서 바뀜을 알린다', async () => {
    let hash = 'h1'
    const { client, files } = makeClient({ probe: vi.fn(async () => ({ hash })) })
    renderPane(client)
    await openFromTree('a.ts')
    fireEvent.change(await editor(), { target: { value: 'mine\n' } })
    const opens = files.open.mock.calls.length

    hash = 'h2'

    expect(await screen.findByText(/디스크에서 바뀜 — 저장하면 충돌합니다/)).toBeInTheDocument()
    expect(await editor()).toHaveValue('mine\n')
    expect(files.open.mock.calls.length).toBe(opens)
  })

  it('지워졌으면 알리고 저장을 막는다', async () => {
    let hash: string | null = 'h1'
    const { client } = makeClient({ probe: vi.fn(async () => ({ hash })) })
    renderPane(client)
    await openFromTree('a.ts')
    fireEvent.change(await editor(), { target: { value: 'mine\n' } })

    hash = null

    expect(await screen.findByText(/디스크에서 지워졌습니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '파일 저장' })).toBeDisabled()
    expect(await editor()).toHaveValue('mine\n')
  })

  it('열 수 없는 파일은 이유와 VS Code에서 열기를 보인다 (FR-15)', async () => {
    const { client } = makeClient({ open: () => ({ ok: false, reason: '바이너리 파일은 열 수 없습니다: src/a.ts' }) })
    renderPane(client)
    await openFromTree('a.ts')

    expect(await screen.findByText('바이너리 파일은 열 수 없습니다: src/a.ts')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'VS Code에서 열기' }))
    expect(client.repos.openInEditor).toHaveBeenCalledWith('r1')
  })

  it('줄바꿈이 섞인 파일은 읽기 전용이고 저장 버튼이 없다 (FR-16)', async () => {
    const { client } = makeClient({ open: () => ({ ...OPENED, eol: 'mixed' }) })
    renderPane(client)
    await openFromTree('a.ts')

    expect(await screen.findByText('줄바꿈이 섞여 있어 고칠 수 없습니다')).toBeInTheDocument()
    expect(await editor()).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: '파일 저장' })).not.toBeInTheDocument()
  })

  it('목록을 못 얻으면 그 이유를 트리 자리에 보인다 (FR-11)', async () => {
    const { client } = makeClient({ tree: { ok: false, reason: 'git 저장소가 아니라 파일 목록을 만들 수 없습니다' } })
    renderPane(client)
    expect(await screen.findByText('git 저장소가 아니라 파일 목록을 만들 수 없습니다')).toBeInTheDocument()
  })

  it('같은 workspace의 run이 끝나면 트리를 새로 받는다 — 다른 workspace는 아니다 (FR-10)', async () => {
    const { client, files, finishRun } = makeClient()
    renderPane(client)
    await screen.findByRole('button', { name: 'README.md' })

    finishRun({ workspaceId: 'other' })
    finishRun({ workspaceId: 'w1', endedAt: null })
    expect(files.tree).toHaveBeenCalledTimes(1)
    finishRun({ workspaceId: 'w1' })
    await waitFor(() => expect(files.tree).toHaveBeenLastCalledWith({ workspaceId: 'w1', repoId: 'r1', fresh: true }))
  })

  it('새로고침은 캐시를 건너뛴다', async () => {
    const { client, files } = makeClient()
    renderPane(client)
    await screen.findByRole('button', { name: 'README.md' })
    await userEvent.click(screen.getByRole('button', { name: '파일 목록 새로고침' }))
    expect(files.tree).toHaveBeenLastCalledWith({ workspaceId: 'w1', repoId: 'r1', fresh: true })
  })

  it('대화록에서 온 요청은 그 파일을 그 줄로 열고 폴더를 편다 (FR-23)', async () => {
    const { client } = makeClient()
    renderPane(client, { openRequest: { path: 'src/b.ts', line: 42, nonce: 1 } })

    expect(await editor('src/b.ts')).toBeInTheDocument()
    expect(screen.getByTestId('goto')).toHaveTextContent('42')
    expect(await screen.findByRole('button', { name: 'b.ts' })).toHaveAttribute('aria-current', 'true')
  })

  it('고친 것 버리기는 두 번 눌러야 하고, 누르면 원래 글로 돌아간다', async () => {
    const { client } = makeClient({ probe: vi.fn(() => new Promise(() => {})) })
    renderPane(client)
    await openFromTree('a.ts')
    fireEvent.change(await editor(), { target: { value: 'mine\n' } })

    await userEvent.click(screen.getByRole('button', { name: '고친 것 버리기' }))
    expect(await editor()).toHaveValue('mine\n')
    await userEvent.click(screen.getByRole('button', { name: '정말 버리기' }))
    expect(await editor()).toHaveValue('one\n')
  })

  it('저장하지 않은 파일은 트리 줄에 점이 서고 머리가 개수를 말한다 (FR-20)', async () => {
    const { client } = makeClient({ probe: vi.fn(() => new Promise(() => {})) })
    renderPane(client)
    await openFromTree('a.ts')
    fireEvent.change(await editor(), { target: { value: 'mine\n' } })

    expect(screen.getByText('저장하지 않은 파일 1')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /^a\.ts/ })).getByTitle('저장하지 않음')).toBeInTheDocument()
  })

  it('편집기가 쓴 Esc는 바깥(도크·App)으로 가지 않는다', async () => {
    const { client } = makeClient({ probe: vi.fn(() => new Promise(() => {})) })
    const outer = vi.fn()
    const onDocument = vi.fn()
    document.addEventListener('keydown', onDocument)
    const store = createCodeBufferStore()
    const guard = createCloseGuard({ saves: createPendingSaves(), buffers: store, close: () => {}, save: client.files.save })
    render(
      <ClientProvider client={client}>
        <CodeBufferProvider store={store} guard={guard}>
          <div onKeyDown={outer}>
            <FilePane workspaceId="w1" repo={REPO} openRequest={null} onClose={() => {}} probeIntervalMs={30} />
          </div>
        </CodeBufferProvider>
      </ClientProvider>
    )
    await openFromTree('a.ts')
    fireEvent.keyDown(await editor(), { key: 'Escape' })

    expect(outer).not.toHaveBeenCalled()
    expect(onDocument).not.toHaveBeenCalled()
    document.removeEventListener('keydown', onDocument)
  })

  it('닫기 버튼은 onClose를 부른다', async () => {
    const onClose = vi.fn()
    const { client } = makeClient()
    renderPane(client, { onClose })
    await userEvent.click(screen.getByRole('button', { name: '코드 칸 닫기' }))
    expect(onClose).toHaveBeenCalled()
  })
})
