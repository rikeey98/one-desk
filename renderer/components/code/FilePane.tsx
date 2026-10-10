import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useClient } from '../../client/ClientProvider'
import { useCodeBuffers } from '../../store/CodeBufferContext'
import { useFileSearch } from '../../hooks/useFileSearch'
import { ancestorsOf, buildTree, visibleRows } from '../../code/tree'
import { languageOf } from '../../code/language'
import type { GotoLine } from './CodeEditor'
import { FileTree } from './FileTree'
import { ConfirmButton } from '../ConfirmButton'
import { IconClose, IconRefresh } from '../icons'
import type { FileRef, FileTreeResult, Repo } from '@shared/models'

/**
 * 편집기는 칸을 처음 열 때 불러온다 — CodeMirror 본체(압축 안 한 크기로 약 740 KB)가 앱 시작 번들에 들지 않게
 * (spec §4의 4, plan 달라진 것). 언어 패키지는 그 안에서 또 따로 불린다(`languages.ts`).
 */
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))

/** 칸이 보이는 동안 디스크를 확인하는 간격 (docs/sdlc/code-editor/ FR-22) */
export const PROBE_INTERVAL_MS = 2000

/** 대화록의 `코드 칸에서 열기`가 Dock을 거쳐 보내는 요청. `nonce`가 바뀔 때마다 연다 */
export interface OpenRequest {
  path: string
  line: number
  nonce: number
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 코드 칸의 파일 칸 (docs/sdlc/code-editor/ spec (B)~(E)). 대상 repo 하나의 트리와 편집기 하나다.
 *
 * - 연 파일·펼친 폴더·고친 글은 **스토어**가 쥔다(FR-7·FR-20) — 이 컴포넌트가 다시 마운트돼도, 대상 repo가 바뀌었다
 *   돌아와도 남는다. 여기 state는 트리 응답·찾기 질의·저장 표시·충돌처럼 화면에만 있는 것이다.
 * - 저장은 명시적이다(FR-17): 편집기의 Mod-s나 `파일 저장`. 기대 해시는 스토어의 기준 해시이고, 성공하면 새 해시가
 *   기준이 된다(FR-19).
 * - 칸이 보이는 동안 디스크를 확인한다(FR-22). 고친 것이 없으면 따라가고, 있으면 머리에 알린다.
 */
export function FilePane({ workspaceId, repo, openRequest, onClose, probeIntervalMs = PROBE_INTERVAL_MS }: {
  workspaceId: string
  repo: Repo
  openRequest: OpenRequest | null
  onClose: () => void
  probeIntervalMs?: number
}) {
  const client = useClient()
  const buffers = useCodeBuffers()
  const [tree, setTree] = useState<{ repoId: string; result: FileTreeResult } | null>(null)
  const [query, setQuery] = useState('')
  const search = useFileSearch(workspaceId, repo.id, query, query.trim() !== '')
  const [openError, setOpenError] = useState<{ repoId: string; path: string; reason: string } | null>(null)
  const [status, setStatus] = useState<{ key: string; kind: 'saving' | 'saved' } | null>(null)
  const [failure, setFailure] = useState<{ key: string; text: string } | null>(null)
  const [conflict, setConflict] = useState<{ key: string; hash: string | null; deleted: boolean } | null>(null)
  const [gotoLine, setGotoLine] = useState<(GotoLine & { key: string }) | null>(null)
  // 저장·다시 읽기 뒤에 도착한 옛 바뀜 확인을 버린다 — 저장 직전에 떠난 확인이 옛 해시를 들고 와 "디스크에서 바뀜"을 띄운다.
  const epoch = useRef(0)
  const nonce = useRef(0)

  const openPath = buffers.openPath(repo.id)
  const ref: FileRef | null = openPath ? { workspaceId, repoId: repo.id, path: openPath } : null
  const key = ref ? `${ref.repoId}\0${ref.path}` : ''
  const buffer = ref ? buffers.get(ref) : undefined
  const dirtyRefs = buffers.dirty()
  const dirtyPaths = new Set(dirtyRefs.filter((r) => r.repoId === repo.id).map((r) => r.path))

  // 트리 — 대상 repo가 바뀌면 새로 읽고, 늦게 온 다른 repo의 응답은 버린다
  const currentRepo = useRef(repo.id)
  currentRepo.current = repo.id
  const loadTree = useCallback((fresh: boolean) => {
    const repoId = repo.id
    client.files.tree({ workspaceId, repoId, fresh }).then(
      (result) => { if (currentRepo.current === repoId) setTree({ repoId, result }) },
      (err: unknown) => {
        if (currentRepo.current === repoId) setTree({ repoId, result: { ok: false, reason: message(err) } })
      }
    )
  }, [client, workspaceId, repo.id])
  useEffect(() => { loadTree(false) }, [loadTree])

  const root = useMemo(
    () => (tree && tree.repoId === repo.id && tree.result.ok ? buildTree(tree.result.files) : null),
    [tree, repo.id]
  )
  const rows = root ? visibleRows(root, buffers.expanded(repo.id)) : []

  /** 파일을 연다 — 스토어에 버퍼가 있으면(고친 것이 있을 수 있다) 그대로 보이고, 없으면 읽어 온다 */
  const openFile = useCallback(async (path: string, line: number | null) => {
    const target = { workspaceId, repoId: repo.id, path }
    const targetKey = `${repo.id}\0${path}`
    buffers.setOpenPath(repo.id, path)
    buffers.expand(repo.id, ancestorsOf(path))
    setOpenError(null)
    if (line !== null) setGotoLine({ key: targetKey, line, nonce: ++nonce.current })
    if (buffers.get(target)) return
    try {
      const result = await client.files.open(target)
      if (!result.ok) {
        setOpenError({ repoId: repo.id, path, reason: result.reason })
        return
      }
      epoch.current++
      // 읽는 사이 같은 파일이 이미 세워졌으면(두 번 누름) 덮지 않는다 — 그 사이 친 글이 있을 수 있다
      if (!buffers.get(target)) buffers.load(target, result)
    } catch (err) {
      setOpenError({ repoId: repo.id, path, reason: message(err) })
    }
  }, [client, buffers, workspaceId, repo.id])

  // 스토어가 기억하는 연 파일인데 버퍼가 없으면(다른 workspace에서 돌아옴 등) 읽어 온다
  useEffect(() => {
    if (!openPath || buffers.get({ repoId: repo.id, path: openPath })) return
    if (openError && openError.repoId === repo.id && openError.path === openPath) return
    void openFile(openPath, null)
    // 연 파일·repo가 바뀔 때만 본다 — openError가 바뀔 때마다 다시 읽으면 실패한 열기를 되풀이한다
  }, [openPath, repo.id])

  // 대화록에서 연 파일 (FR-23)
  useEffect(() => {
    if (openRequest) void openFile(openRequest.path, openRequest.line)
    // 요청이 올 때만 연다 — openFile은 repo마다 새로 만들어지지만 요청은 Dock이 같은 repo로 보낸다
  }, [openRequest])

  /** 디스크를 다시 읽어 버퍼를 세운다 — 고친 것을 버린다(`디스크 내용 불러오기`) */
  async function reloadFromDisk(target: FileRef) {
    try {
      const result = await client.files.open(target)
      if (!result.ok) {
        setOpenError({ repoId: target.repoId, path: target.path, reason: result.reason })
        return
      }
      epoch.current++
      buffers.load(target, result)
      setConflict(null)
      setFailure(null)
    } catch (err) {
      setFailure({ key, text: message(err) })
    }
  }

  /** 저장 (FR-17·FR-19). `expectedHash`를 주면 그것을 기대값으로 덮어쓴다(`내 것으로 덮어쓰기`) */
  async function save(expectedHash?: string) {
    if (!ref) return
    const current = buffers.get(ref)
    if (!current || current.readOnly) return
    if (!current.dirty && expectedHash === undefined) return
    const target = ref
    const targetKey = key
    const text = current.text
    setStatus({ key: targetKey, kind: 'saving' })
    setFailure(null)
    try {
      const result = await client.files.save({ ...target, content: text, expectedHash: expectedHash ?? current.baseHash })
      if (result.ok) {
        epoch.current++
        buffers.markSaved(target, text, result.hash)
        setConflict(null)
        setStatus({ key: targetKey, kind: 'saved' })
        return
      }
      setStatus(null)
      if (result.conflict) {
        buffers.setDisk(target, result.conflict.hash)
        setConflict({ key: targetKey, ...result.conflict })
      } else {
        setFailure({ key: targetKey, text: result.reason })
      }
    } catch (err) {
      setStatus(null)
      setFailure({ key: targetKey, text: message(err) })
    }
  }

  // 바뀜 확인 (FR-22) — 보이는 동안 몇 초마다, 그리고 열 때 한 번. 함수는 늘 최신 것을 부른다
  const probe = useRef<() => Promise<void>>(async () => {})
  probe.current = async () => {
    if (!ref || document.visibilityState === 'hidden') return
    const target = ref
    if (!buffers.get(target)) return
    const started = epoch.current
    let hash: string | null
    try {
      hash = (await client.files.probe(target)).hash
    } catch {
      return
    }
    if (epoch.current !== started) return
    const now = buffers.get(target)
    if (!now) return
    buffers.setDisk(target, hash)
    // 고친 것이 없으면 따라간다 — agent가 고치는 동안 칸이 따라온다
    if (hash !== null && hash !== now.baseHash && !now.dirty) {
      try {
        const opened = await client.files.open(target)
        const again = buffers.get(target)
        if (opened.ok && again && !again.dirty && epoch.current === started) {
          epoch.current++
          buffers.load(target, opened)
        }
      } catch { /* 다음 확인에서 다시 본다 */ }
    }
  }
  useEffect(() => {
    if (!openPath) return
    void probe.current()
    const timer = setInterval(() => { void probe.current() }, probeIntervalMs)
    return () => clearInterval(timer)
  }, [openPath, repo.id, probeIntervalMs])

  // 같은 workspace의 run이 끝나면 트리를 새로 읽고 바로 확인한다 (FR-10) — agent가 만든 파일이 곧 보인다
  useEffect(() => client.events.onRunUpdate((run) => {
    if (run.workspaceId !== workspaceId || run.endedAt === null) return
    loadTree(true)
    void probe.current()
  }), [client, workspaceId, loadTree])

  async function openInEditor() {
    try {
      await client.repos.openInEditor(repo.id)
    } catch (err) {
      setFailure({ key, text: message(err) })
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    // 안쪽부터 푼다 — 편집기가 쓴 Esc(찾기 창 닫기)가 도크 최대화나 App의 "열린 항목 닫기"까지 가지 않게
    if (e.key === 'Escape' && e.defaultPrevented) e.stopPropagation()
  }

  const treeResult = tree && tree.repoId === repo.id ? tree.result : null
  const shownError = openError && openError.repoId === repo.id && openError.path === openPath ? openError.reason : null
  const shownConflict = conflict && conflict.key === key ? conflict : null
  const shownFailure = failure && failure.key === key ? failure.text : null
  const shownStatus = status && status.key === key ? status.kind : null
  const deleted = buffer?.diskHash === null
  const changedOnDisk = buffer !== undefined && buffer.dirty && !deleted && buffer.diskHash !== buffer.baseHash
  const otherDirty = dirtyRefs.length

  return (
    <section className="code-pane" aria-label="코드 칸" onKeyDown={onKeyDown}>
      <header className="code-pane-head">
        <div className="code-pane-title">
          <span className="code-pane-repo">{repo.name}</span>
          {openPath && <span className="code-pane-path path-text" title={openPath}>{openPath}</span>}
          {/* 점은 글리프가 아니라 CSS 원이다(DESIGN.md — 아이콘 자리에 유니코드 글리프를 넣지 않는다) */}
          {buffer?.dirty && <span className="code-pane-dirty" role="img" aria-label="저장하지 않음" title="저장하지 않음" />}
          {shownStatus === 'saving' && <span className="code-pane-status">저장 중…</span>}
          {shownStatus === 'saved' && !buffer?.dirty && <span className="code-pane-status">저장됨</span>}
        </div>
        <div className="code-pane-actions">
          {otherDirty > 0 && <span className="code-pane-count">저장하지 않은 파일 {otherDirty}</span>}
          {buffer && !buffer.readOnly && (
            <button
              type="button"
              className="code-pane-save"
              aria-label="파일 저장"
              title="파일 저장 (Ctrl+S)"
              disabled={!buffer.dirty || deleted || shownStatus === 'saving'}
              onClick={() => { void save() }}
            >
              저장
            </button>
          )}
          {buffer?.dirty && (
            <ConfirmButton
              className="row-action code-pane-discard"
              label="버리기"
              confirmLabel="정말 버리기"
              ariaLabel="고친 것 버리기"
              onConfirm={() => { if (ref) { buffers.discard(ref); setConflict(null) } }}
            />
          )}
          <button type="button" className="row-action" aria-label="파일 목록 새로고침" title="파일 목록 새로고침" onClick={() => loadTree(true)}>
            <IconRefresh width="13" height="13" />
          </button>
          <button type="button" className="row-action" aria-label="코드 칸 닫기" title="코드 칸 닫기" onClick={onClose}>
            <IconClose width="12" height="12" />
          </button>
        </div>
      </header>

      {buffer?.readOnly && <div className="code-pane-note">줄바꿈이 섞여 있어 고칠 수 없습니다</div>}
      {deleted && <div className="code-pane-note code-pane-warn" role="status">디스크에서 지워졌습니다 — 저장할 수 없습니다</div>}
      {changedOnDisk && !shownConflict && ref && (
        <div className="code-pane-note code-pane-warn" role="status">
          디스크에서 바뀜 — 저장하면 충돌합니다
          <button type="button" onClick={() => { void reloadFromDisk(ref) }}>디스크 내용 불러오기</button>
        </div>
      )}
      {shownConflict && ref && !shownConflict.deleted && (
        <div role="alert" className="conflict-banner">
          <span>이 파일이 디스크에서 바뀌었습니다.</span>
          <button type="button" onClick={() => { void reloadFromDisk(ref) }}>디스크 내용 불러오기</button>
          <button type="button" onClick={() => { void save(shownConflict.hash ?? undefined) }}>내 것으로 덮어쓰기</button>
        </div>
      )}
      {shownFailure && <div role="alert" className="form-error">{shownFailure}</div>}

      <div className="code-pane-body">
        {treeResult && !treeResult.ok
          ? (
            <div className="code-pane-reason">
              <p>{treeResult.reason}</p>
              <button type="button" onClick={() => { void openInEditor() }}>VS Code에서 열기</button>
            </div>
          )
          : (
            <FileTree
              rows={rows}
              openPath={openPath}
              dirtyPaths={dirtyPaths}
              query={query}
              onQueryChange={setQuery}
              search={query.trim() !== '' ? search : null}
              onToggleDir={(path) => buffers.toggleExpanded(repo.id, path)}
              onOpenFile={(path) => { void openFile(path, null) }}
            />
          )}
        <div className="code-pane-editor">
          {treeResult?.ok && treeResult.truncated && (
            <div className="code-pane-note">파일이 너무 많아 앞의 20만 개만 보입니다</div>
          )}
          {shownError
            ? (
              <div className="code-pane-reason">
                <p>{shownError}</p>
                <button type="button" onClick={() => { void openInEditor() }}>VS Code에서 열기</button>
              </div>
            )
            : buffer && ref
              ? (
                <Suspense fallback={<p className="code-pane-hint">편집기를 불러오는 중…</p>}>
                  <CodeEditor
                    docKey={key}
                    text={buffer.text}
                    readOnly={buffer.readOnly}
                    language={languageOf(ref.path)}
                    gotoLine={gotoLine && gotoLine.key === key ? gotoLine : null}
                    label={`${ref.path} 내용`}
                    onChange={(text) => {
                      buffers.edit(ref, text)
                      if (shownStatus === 'saved') setStatus(null)
                    }}
                    onSave={() => { void save() }}
                  />
                </Suspense>
              )
              : <p className="code-pane-hint">{openPath ? '여는 중…' : '왼쪽 목록에서 파일을 고르세요'}</p>}
        </div>
      </div>
    </section>
  )
}
