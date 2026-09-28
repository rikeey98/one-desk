import { listRepoFiles, type RepoFileList } from './list'
import { matchFiles } from './match'
import { readRepoFile, type RepoFileRead } from './read'
import { longestFileMatch, scanMentions } from '@shared/mentions'
import type { FileSearchInput, FileSearchResult, Repo } from '@shared/models'

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

  return {
    /** 피커의 검색 (§5-1). 못 찾는 이유는 `ok: false`, 잘못된 호출(다른 workspace의 repo)은 던진다. */
    async search(input: FileSearchInput): Promise<FileSearchResult> {
      const repo = deps.getRepo(input.repoId)
      if (repo.workspaceId !== input.workspaceId) {
        throw new Error(`이 workspace의 repo가 아닙니다: ${input.repoId}`)
      }
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
    }
  }
}

export type FileService = ReturnType<typeof createFileService>
