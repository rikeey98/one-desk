import { listRepoFiles, type RepoFileList } from './list'
import { matchFiles } from './match'
import { hashRepoFile, openRepoFile, readRepoFile, statRepoFile, type RepoFileRead } from './read'
import { writeRepoFile } from './write'
import { longestFileMatch, scanMentions } from '@shared/mentions'
import type {
  FileOpenResult, FileProbeResult, FileRef, FileSaveInput, FileSaveResult, FileSearchInput, FileSearchResult,
  FileTreeInput, FileTreeResult, Repo
} from '@shared/models'

/** 한 턴에 실을 수 있는 파일 합계와 개수 (docs/sdlc/input-triggers/ FR-13) */
export const MAX_TURN_BYTES = 512 * 1024
export const MAX_TURN_FILES = 20
/** 피커 목록의 캐시 — agent가 방금 만든 파일이 곧 보이게 짧게 둔다(§5-1) */
const CACHE_MS = 10_000

/** 멘션에서 해석해 읽은 파일 하나 */
export interface ResolvedFile {
  repoId: string
  repoName: string
  /** repo 상대 경로, `/` 구분 */
  path: string
  content: string
}

export interface ResolvedMentions {
  files: ResolvedFile[]
  /** 해석된 멘션의 `@` 자리 — 조립기가 이 자리의 `@`만 떼고 나머지는 중화한다(FR-12) */
  resolvedStarts: number[]
}

export interface FileServiceDeps {
  /** repo 행. 없으면 던진다(저장소의 `get`) */
  getRepo: (id: string) => Repo
  listFiles?: (root: string) => Promise<RepoFileList>
  readFile?: (root: string, rel: string) => Promise<RepoFileRead>
  /** 코드 칸 (docs/sdlc/code-editor/) — 열기·쓰기·바뀜 확인. 테스트가 바꿔 끼운다 */
  openFile?: (root: string, rel: string) => Promise<FileOpenResult>
  writeFile?: (root: string, rel: string, text: string, expectedHash: string) => Promise<FileSaveResult>
  statFile?: (root: string, rel: string) => Promise<{ size: number; mtimeMs: number } | null>
  hashFile?: (root: string, rel: string) => Promise<string | null>
  now?: () => number
  platform?: NodeJS.Platform
}

/**
 * `@` 파일 참조의 core 쪽 (§5-2). 피커의 검색과 보낼 때의 해석이 **같은 목록 함수**를 쓴다 —
 * 따로 두면 피커에 없는 `.env`가 손으로 치면 실린다(spec §7의 3).
 */
export function createFileService(deps: FileServiceDeps) {
  const listFiles = deps.listFiles ?? ((root: string) => listRepoFiles(root))
  const readFile = deps.readFile ?? ((root: string, rel: string) => readRepoFile(root, rel))
  const openFile = deps.openFile ?? ((root: string, rel: string) => openRepoFile(root, rel))
  const writeFile = deps.writeFile
    ?? ((root: string, rel: string, text: string, expected: string) => writeRepoFile(root, rel, text, expected))
  const statFile = deps.statFile ?? ((root: string, rel: string) => statRepoFile(root, rel))
  const hashFile = deps.hashFile ?? ((root: string, rel: string) => hashRepoFile(root, rel))
  const now = deps.now ?? Date.now
  const platform = deps.platform ?? process.platform
  /** repo 경로 → 목록. **프로미스째** 담아 동시에 온 질의가 git을 한 번만 띄운다 */
  const cache = new Map<string, { at: number; list: Promise<RepoFileList> }>()

  function cachedList(root: string): Promise<RepoFileList> {
    const hit = cache.get(root)
    if (hit && now() - hit.at < CACHE_MS) return hit.list
    const list = listFiles(root).then((result) => {
      // 실패는 캐시하지 않는다 — `git init`한 뒤 곧바로 다시 찾을 수 있어야 한다.
      if (!result.ok && cache.get(root)?.list === list) cache.delete(root)
      return result
    })
    cache.set(root, { at: now(), list })
    return list
  }

  /** 캐시를 건너뛰고 새로 받는다. 받은 것은 캐시에 둔다 — 바로 뒤의 검색·트리가 같은 목록을 본다 */
  function freshList(root: string): Promise<RepoFileList> {
    const list = listFiles(root)
    cache.set(root, { at: now(), list })
    return list.then((result) => {
      if (!result.ok && cache.get(root)?.list === list) cache.delete(root)
      return result
    })
  }

  /** 잘못된 호출(다른 workspace의 repo)은 던진다 — 화면이 만들 수 없는 요청이다 */
  function ownedRepo(workspaceId: string, repoId: string): Repo {
    const repo = deps.getRepo(repoId)
    if (repo.workspaceId !== workspaceId) throw new Error(`이 workspace의 repo가 아닙니다: ${repoId}`)
    return repo
  }

  /** 바뀜 확인의 (크기, mtime) → 해시 기억. 경로 키 — 같은 값이면 파일을 다시 읽지 않는다(plan 위험 5) */
  const probed = new Map<string, { size: number; mtimeMs: number; hash: string }>()

  return {
    /** 피커의 검색 (§5-1). 못 찾는 이유는 `ok: false`, 잘못된 호출(다른 workspace의 repo)은 던진다. */
    async search(input: FileSearchInput): Promise<FileSearchResult> {
      const repo = ownedRepo(input.workspaceId, input.repoId)
      const list = await cachedList(repo.path)
      if (!list.ok) return list
      return {
        ok: true,
        files: matchFiles(list.files, input.query).map((path) => ({ path })),
        truncated: list.truncated
      }
    },

    /**
     * 보낼 때의 해석 (FR-8·FR-10·FR-13). 지시문에 멘션이 없으면 git을 띄우지 않는다. repo가 없거나
     * 목록을 못 얻으면(git 저장소가 아님 등) 아무것도 해석하지 않는다 — 조립기가 전부 중화한다.
     *
     * 목록은 **캐시가 아니라 새로 얻는다** — 피커를 연 뒤에 만든 파일도 해석돼야 한다. 읽기·상한에
     * 걸리면 **던진다** — 호출자(`launch`)가 run 행을 만들기 전이다.
     */
    async resolveMentions(repo: Repo | null, prompt: string): Promise<ResolvedMentions> {
      const mentions = scanMentions(prompt)
      if (mentions.length === 0 || !repo) return { files: [], resolvedStarts: [] }

      const list = await listFiles(repo.path)
      if (!list.ok) return { files: [], resolvedStarts: [] }
      cache.set(repo.path, { at: now(), list: Promise.resolve(list) })
      const known = new Set(list.files)

      const resolvedStarts: number[] = []
      const paths: string[] = []
      for (const mention of mentions) {
        const path = longestFileMatch(mention, known, platform)
        if (!path) continue
        resolvedStarts.push(mention.start)
        if (!paths.includes(path)) paths.push(path)
      }
      if (paths.length > MAX_TURN_FILES) {
        throw new Error(`한 번에 담을 수 있는 파일은 ${MAX_TURN_FILES}개까지입니다(${paths.length}개)`)
      }

      const files: ResolvedFile[] = []
      let total = 0
      for (const path of paths) {
        const read = await readFile(repo.path, path)
        if (!read.ok) throw new Error(read.reason)
        total += read.bytes
        if (total > MAX_TURN_BYTES) {
          throw new Error(`한 번에 담을 수 있는 파일은 합계 ${MAX_TURN_BYTES / 1024} KiB까지입니다`)
        }
        files.push({ repoId: repo.id, repoName: repo.name, path, content: read.content })
      }
      return { files, resolvedStarts }
    },

    /**
     * 코드 칸의 트리 (docs/sdlc/code-editor/ FR-8·FR-10). `@` 피커와 **같은 목록**이다. `fresh`면 10초 캐시를 건너뛴다.
     */
    async tree(input: FileTreeInput): Promise<FileTreeResult> {
      const repo = ownedRepo(input.workspaceId, input.repoId)
      return input.fresh ? freshList(repo.path) : cachedList(repo.path)
    },

    /**
     * 파일 열기 (FR-15). **목록에 있는 파일만 연다** — `.git/`·무시된 파일은 화면에 오지 않는다(spec §4의 3).
     * 캐시 목록에 없으면 한 번 새로 받아 본다: agent가 방금 만든 파일을 대화록에서 열 수 있어야 한다. 그래도 없으면
     * 던지지 않고 이유를 준다 — 대화록의 편집 줄은 무시된 파일(`.env`)을 가리킬 수 있어 사람이 만나는 실패다.
     */
    async open(ref: FileRef): Promise<FileOpenResult> {
      const repo = ownedRepo(ref.workspaceId, ref.repoId)
      let list = await cachedList(repo.path)
      if (list.ok && !list.files.includes(ref.path)) list = await freshList(repo.path)
      if (!list.ok) return list
      if (!list.files.includes(ref.path)) {
        return { ok: false, reason: `git 목록에 없는 파일이라 열 수 없습니다(무시된 파일일 수 있습니다): ${ref.path}` }
      }
      return openFile(repo.path, ref.path)
    },

    /**
     * 저장 (FR-17·FR-19, spec §3-4). 목록은 **캐시가 아니라 새로 받는다**(§3-4의 2) — 그 사이 무시 목록에 들어간 파일이나
     * `.git/hooks/*`를 쓰는 길을 막는다. 목록에 없으면 던진다(화면은 연 파일만 저장한다). 목록을 못 얻으면 쓰지 않고
     * 그 이유를 실패로 돌려준다.
     */
    async save(input: FileSaveInput): Promise<FileSaveResult> {
      const repo = ownedRepo(input.workspaceId, input.repoId)
      const list = await freshList(repo.path)
      if (!list.ok) return { ok: false, reason: list.reason }
      if (!list.files.includes(input.path)) throw new Error(`git 목록에 없는 파일은 저장할 수 없습니다: ${input.path}`)
      return writeFile(repo.path, input.path, input.content, input.expectedHash)
    },

    /**
     * 바뀜 확인 (FR-22) — 칸이 보이는 동안 2초마다 온다. (크기, mtime)이 지난번과 같으면 지난 해시를 돌려주고 다를 때만
     * 파일을 읽는다. **목록을 보지 않는다** — 2초마다 git을 띄울 수 없고, 돌려주는 것은 해시뿐이다. repo 밖은 null이다
     * (`statRepoFile`이 막는다).
     */
    async probe(ref: FileRef): Promise<FileProbeResult> {
      const repo = ownedRepo(ref.workspaceId, ref.repoId)
      const key = `${repo.path}\0${ref.path}`
      const info = await statFile(repo.path, ref.path)
      if (!info) {
        probed.delete(key)
        return { hash: null }
      }
      const hit = probed.get(key)
      if (hit && hit.size === info.size && hit.mtimeMs === info.mtimeMs) return { hash: hit.hash }
      const hash = await hashFile(repo.path, ref.path)
      if (hash === null) {
        probed.delete(key)
        return { hash: null }
      }
      probed.set(key, { ...info, hash })
      return { hash }
    }
  }
}

export type FileService = ReturnType<typeof createFileService>
