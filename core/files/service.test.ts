import { describe, it, expect } from 'vitest'
import { createFileService, MAX_TURN_BYTES, MAX_TURN_FILES } from './service'
import type { RepoFileList } from './list'
import type { RepoFileRead } from './read'
import type { Repo } from '@shared/models'

const REPO: Repo = {
  id: 'r1', workspaceId: 'w1', name: 'api', path: '/tmp/api', description: null, sortOrder: 0, createdAt: 0
}

/** 부를 때마다 차례로 목록을 주는 가짜 git. 부른 횟수를 센다. */
function fakeList(results: RepoFileList[]) {
  const calls: string[] = []
  const fn = async (root: string): Promise<RepoFileList> => {
    calls.push(root)
    return results[Math.min(calls.length - 1, results.length - 1)]!
  }
  return Object.assign(fn, { calls })
}

function fakeRead(contents: Record<string, string | RepoFileRead>) {
  return async (_root: string, rel: string): Promise<RepoFileRead> => {
    const value = contents[rel]
    if (value === undefined) return { ok: false, reason: `파일을 읽을 수 없습니다: ${rel}` }
    if (typeof value !== 'string') return value
    return { ok: true, content: value, bytes: Buffer.byteLength(value) }
  }
}

const listed = (files: string[]): RepoFileList => ({ ok: true, files, truncated: false })

describe('search (§5-1)', () => {
  it('10초 안의 두 번째 검색은 git을 다시 띄우지 않고, 동시에 온 둘도 한 번이다', async () => {
    let clock = 0
    const list = fakeList([listed(['a.ts', 'b.ts'])])
    const service = createFileService({ getRepo: () => REPO, listFiles: list, now: () => clock })

    const [first] = await Promise.all([
      service.search({ workspaceId: 'w1', repoId: 'r1', query: 'a' }),
      service.search({ workspaceId: 'w1', repoId: 'r1', query: 'b' })
    ])
    clock = 9_999
    await service.search({ workspaceId: 'w1', repoId: 'r1', query: '' })
    expect(list.calls).toHaveLength(1)
    expect(first).toEqual({ ok: true, files: [{ path: 'a.ts' }], truncated: false })

    clock = 10_000
    await service.search({ workspaceId: 'w1', repoId: 'r1', query: '' })
    expect(list.calls).toHaveLength(2)
  })

  it('실패는 캐시하지 않고 이유를 돌려준다', async () => {
    const list = fakeList([{ ok: false, reason: 'git 저장소가 아니라 파일 목록을 만들 수 없습니다' }, listed(['a.ts'])])
    const service = createFileService({ getRepo: () => REPO, listFiles: list, now: () => 0 })

    const failed = await service.search({ workspaceId: 'w1', repoId: 'r1', query: '' })
    const retried = await service.search({ workspaceId: 'w1', repoId: 'r1', query: '' })

    expect(failed).toEqual({ ok: false, reason: 'git 저장소가 아니라 파일 목록을 만들 수 없습니다' })
    expect(retried.ok).toBe(true)
    expect(list.calls).toHaveLength(2)
  })

  it('다른 workspace의 repo id면 던진다', async () => {
    const service = createFileService({ getRepo: () => REPO, listFiles: fakeList([listed([])]) })

    await expect(service.search({ workspaceId: 'w2', repoId: 'r1', query: '' })).rejects.toThrow('이 workspace의 repo가 아닙니다')
  })
})

describe('resolveMentions (FR-8·FR-10·FR-13)', () => {
  it('멘션이 없으면 git을 띄우지 않는다', async () => {
    const list = fakeList([listed(['a.ts'])])
    const service = createFileService({ getRepo: () => REPO, listFiles: list })

    expect(await service.resolveMentions(REPO, 'a@b.com 에게 물어봐')).toEqual({ files: [], resolvedStarts: [] })
    expect(list.calls).toHaveLength(0)
  })

  it('캐시가 아니라 새 목록으로 해석한다 — 피커를 연 뒤에 만든 파일도 잡는다', async () => {
    const list = fakeList([listed(['a.ts']), listed(['a.ts', 'new.ts'])])
    const service = createFileService({ getRepo: () => REPO, listFiles: list, readFile: fakeRead({ 'new.ts': 'N' }), now: () => 0 })
    await service.search({ workspaceId: 'w1', repoId: 'r1', query: '' })

    const resolved = await service.resolveMentions(REPO, '@new.ts 봐')

    expect(resolved.files.map((f) => f.path)).toEqual(['new.ts'])
    expect(resolved.resolvedStarts).toEqual([0])
  })

  it('같은 파일을 두 번 짚어도 맥락은 하나이고, 목록에 없는 멘션은 해석하지 않는다', async () => {
    const service = createFileService({
      getRepo: () => REPO, listFiles: fakeList([listed(['a.ts'])]), readFile: fakeRead({ 'a.ts': 'A' })
    })

    const resolved = await service.resolveMentions(REPO, '@a.ts 와 @a.ts를, @.env 도')

    expect(resolved.files).toEqual([{ repoId: 'r1', repoName: 'api', path: 'a.ts', content: 'A' }])
    expect(resolved.resolvedStarts).toEqual([0, 8])
  })

  it('git 저장소가 아니거나 repo가 없으면 아무것도 해석하지 않는다', async () => {
    const service = createFileService({
      getRepo: () => REPO, listFiles: fakeList([{ ok: false, reason: 'git 저장소가 아니라 파일 목록을 만들 수 없습니다' }])
    })

    expect(await service.resolveMentions(REPO, '@a.ts')).toEqual({ files: [], resolvedStarts: [] })
    expect(await service.resolveMentions(null, '@a.ts')).toEqual({ files: [], resolvedStarts: [] })
  })

  it('읽기가 거부되면 그 이유로 던진다', async () => {
    const service = createFileService({
      getRepo: () => REPO, listFiles: fakeList([listed(['bin.dat'])]),
      readFile: fakeRead({ 'bin.dat': { ok: false, reason: '바이너리 파일은 담을 수 없습니다: bin.dat' } })
    })

    await expect(service.resolveMentions(REPO, '@bin.dat')).rejects.toThrow('바이너리 파일은 담을 수 없습니다: bin.dat')
  })

  it(`합계 ${MAX_TURN_BYTES / 1024} KiB를 넘거나 ${MAX_TURN_FILES}개를 넘으면 던진다`, async () => {
    const half = 'a'.repeat(MAX_TURN_BYTES / 2)
    const big = createFileService({
      getRepo: () => REPO, listFiles: fakeList([listed(['a', 'b', 'c'])]), readFile: fakeRead({ a: half, b: half, c: 'x' })
    })
    await expect(big.resolveMentions(REPO, '@a @b')).resolves.toMatchObject({ files: [{}, {}] })
    await expect(big.resolveMentions(REPO, '@a @b @c')).rejects.toThrow('합계')

    const names = Array.from({ length: MAX_TURN_FILES + 1 }, (_, i) => `f${i}`)
    const many = createFileService({
      getRepo: () => REPO, listFiles: fakeList([listed(names)]),
      readFile: fakeRead(Object.fromEntries(names.map((n) => [n, 'x'])))
    })
    await expect(many.resolveMentions(REPO, names.map((n) => `@${n}`).join(' '))).rejects.toThrow(`${MAX_TURN_FILES}개까지`)
  })
})
