import type { FileEol, FileRef } from '@shared/models'

/**
 * 코드 칸에서 연 파일과 고친 글 (docs/sdlc/code-editor/ spec FR-7·FR-20·§3-2).
 *
 * **스토어가 쥐는 이유**는 초안 스토어(`drafts.ts`)와 같다: 도크는 인박스·설정에 가면 언마운트되고, 칸은 대상 repo가
 * 바뀌면 다른 파일을 보인다 — 컴포넌트 state에 두면 저장하지 않은 고침이 그때마다 사라진다. `main.tsx`가 앱 창에만
 * 하나 만들어 Context로 내린다(패널 창에는 코드 칸이 없다).
 *
 * **저장하지 않는다.** 앱을 끄면 비어 있다 — 닫을 때 `closeGuard`가 물으므로 조용히 잃지 않는다(FR-21).
 * 파일 내용을 localStorage에 남기지 않는 것도 의도다 — tracked 파일에 비밀이 있을 수 있다(spec §3-2).
 */
export interface OpenedFile {
  text: string
  hash: string
  eol: FileEol
  bom: boolean
}

export interface CodeBuffer extends FileRef {
  /** 편집기의 지금 글(`\n`) */
  text: string
  /** 연 때·마지막으로 저장한 때의 글 — 고친 것인지는 이것과 비교한다 */
  baseText: string
  /** 연 때·마지막으로 저장한 때의 디스크 해시 — 저장의 기대값이다(FR-19) */
  baseHash: string
  /** 마지막으로 확인한 디스크 해시. 지워졌으면 null (FR-22) */
  diskHash: string | null
  eol: FileEol
  bom: boolean
  dirty: boolean
  /** 줄바꿈이 섞인 파일은 고칠 수 없다 (FR-16) */
  readOnly: boolean
}

export interface CloseFailure {
  path: string
  reason: string
}

interface Entry {
  ref: FileRef
  text: string
  baseText: string
  baseHash: string
  diskHash: string | null
  eol: FileEol
  bom: boolean
}

const keyOf = (ref: { repoId: string; path: string }) => `${ref.repoId}\0${ref.path}`

export function createCodeBufferStore() {
  const entries = new Map<string, Entry>()
  const openPaths = new Map<string, string>()
  const expandedDirs = new Map<string, Set<string>>()
  let closing: { failures: CloseFailure[] } | null = null
  let version = 0
  const listeners = new Set<() => void>()

  function changed(): void {
    version++
    for (const listener of listeners) listener()
  }

  function view(entry: Entry): CodeBuffer {
    return {
      ...entry.ref,
      text: entry.text,
      baseText: entry.baseText,
      baseHash: entry.baseHash,
      diskHash: entry.diskHash,
      eol: entry.eol,
      bom: entry.bom,
      dirty: entry.text !== entry.baseText,
      readOnly: entry.eol === 'mixed'
    }
  }

  return {
    get(ref: { repoId: string; path: string }): CodeBuffer | undefined {
      const entry = entries.get(keyOf(ref))
      return entry ? view(entry) : undefined
    },

    /** 디스크에서 읽은 것으로 (다시) 세운다 — 열기, `디스크 내용 불러오기`, 깨끗한 버퍼의 바뀜 따라가기 */
    load(ref: FileRef, opened: OpenedFile): void {
      entries.set(keyOf(ref), {
        ref: { workspaceId: ref.workspaceId, repoId: ref.repoId, path: ref.path },
        text: opened.text,
        baseText: opened.text,
        baseHash: opened.hash,
        diskHash: opened.hash,
        eol: opened.eol,
        bom: opened.bom
      })
      changed()
    },

    /** 편집기의 글. 읽기 전용이거나 같은 글이면 아무것도 하지 않는다 */
    edit(ref: { repoId: string; path: string }, text: string): void {
      const entry = entries.get(keyOf(ref))
      if (!entry || entry.eol === 'mixed' || entry.text === text) return
      entry.text = text
      changed()
    },

    /**
     * 저장이 끝났다. 기준은 **보낸 글**이다 — 응답을 기다리는 사이 더 친 글은 고친 것으로 남는다. 기대 해시를 새 해시로
     * 바꾼다 — 안 바꾸면 다음 저장이 자기 자신과 충돌한다(CLAUDE.md의 `expected.current` 함정과 같다).
     */
    markSaved(ref: { repoId: string; path: string }, savedText: string, hash: string): void {
      const entry = entries.get(keyOf(ref))
      if (!entry) return
      entry.baseText = savedText
      entry.baseHash = hash
      entry.diskHash = hash
      changed()
    },

    /** 바뀜 확인 결과 (FR-22). 같으면 알리지 않는다 */
    setDisk(ref: { repoId: string; path: string }, hash: string | null): void {
      const entry = entries.get(keyOf(ref))
      if (!entry || entry.diskHash === hash) return
      entry.diskHash = hash
      changed()
    },

    /** 고친 것 버리기 — 마지막 기준으로 되돌린다 */
    discard(ref: { repoId: string; path: string }): void {
      const entry = entries.get(keyOf(ref))
      if (!entry || entry.text === entry.baseText) return
      entry.text = entry.baseText
      changed()
    },

    /** 고친 것이 있는 버퍼 — 닫기 확인과 칸 머리의 `저장하지 않은 파일 N`이 센다 */
    dirty(): FileRef[] {
      return [...entries.values()].filter((e) => e.text !== e.baseText).map((e) => ({ ...e.ref }))
    },

    openPath(repoId: string): string | null {
      return openPaths.get(repoId) ?? null
    },

    setOpenPath(repoId: string, path: string | null): void {
      if ((openPaths.get(repoId) ?? null) === path) return
      if (path === null) openPaths.delete(repoId)
      else openPaths.set(repoId, path)
      changed()
    },

    expanded(repoId: string): ReadonlySet<string> {
      return expandedDirs.get(repoId) ?? new Set()
    },

    toggleExpanded(repoId: string, dir: string): void {
      const set = new Set(expandedDirs.get(repoId))
      if (set.has(dir)) set.delete(dir)
      else set.add(dir)
      expandedDirs.set(repoId, set)
      changed()
    },

    /** 대화록에서 연 파일의 조상을 편다 — 이미 펼쳐져 있으면 알리지 않는다 */
    expand(repoId: string, dirs: readonly string[]): void {
      const current = expandedDirs.get(repoId) ?? new Set<string>()
      if (dirs.every((d) => current.has(d))) return
      expandedDirs.set(repoId, new Set([...current, ...dirs]))
      changed()
    },

    /** 닫기 확인 (FR-21) — App의 `CloseConfirm`이 이것을 듣고 선다 */
    closeRequest(): { failures: CloseFailure[] } | null {
      return closing
    },

    requestClose(failures: CloseFailure[] = []): void {
      closing = { failures }
      changed()
    },

    clearCloseRequest(): void {
      if (closing === null) return
      closing = null
      changed()
    },

    /** 바뀔 때마다 오르는 판 — `useSyncExternalStore`의 스냅샷이다 */
    version(): number {
      return version
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
}

export type CodeBufferStore = ReturnType<typeof createCodeBufferStore>
