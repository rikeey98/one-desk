import { describe, it, expect } from 'vitest'
import { createFileService, MAX_TURN_BYTES, MAX_TURN_FILES } from './service'
import type { RepoFileList } from './list'
import type { RepoFileRead } from './read'
import type { FileOpenResult, FileSaveResult, Repo } from '@shared/models'

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

describe('코드 칸 (docs/sdlc/code-editor/ spec §3-3·§3-4)', () => {
  const REF = { workspaceId: 'w1', repoId: 'r1', path: 'src/a.ts' }
  const OPENED: FileOpenResult = { ok: true, text: 'x\n', eol: 'lf', bom: false, hash: 'h1', bytes: 2 }

  function fakeOpen(result: FileOpenResult = OPENED) {
    const calls: Array<[string, string]> = []
    const fn = async (root: string, rel: string): Promise<FileOpenResult> => { calls.push([root, rel]); return result }
    return Object.assign(fn, { calls })
  }

  function fakeWrite(result: FileSaveResult = { ok: true, hash: 'h2' }) {
    const calls: Array<[string, string, string, string]> = []
    const fn = async (root: string, rel: string, text: string, expected: string): Promise<FileSaveResult> => {
      calls.push([root, rel, text, expected])
      return result
    }
    return Object.assign(fn, { calls })
  }

  describe('tree (FR-8·FR-10)', () => {
    it('목록 전체를 주고, 10초 캐시를 쓴다', async () => {
      const list = fakeList([listed(['src/a.ts', 'README.md'])])
      const service = createFileService({ getRepo: () => REPO, listFiles: list, now: () => 0 })

      expect(await service.tree({ workspaceId: 'w1', repoId: 'r1' }))
        .toEqual({ ok: true, files: ['src/a.ts', 'README.md'], truncated: false })
      await service.tree({ workspaceId: 'w1', repoId: 'r1' })
      expect(list.calls).toHaveLength(1)
    })

    it('fresh면 캐시를 건너뛰고 새로 받은 목록을 캐시에 둔다', async () => {
      const list = fakeList([listed(['a.ts']), listed(['a.ts', 'new.ts'])])
      const service = createFileService({ getRepo: () => REPO, listFiles: list, now: () => 0 })

      await service.tree({ workspaceId: 'w1', repoId: 'r1' })
      const fresh = await service.tree({ workspaceId: 'w1', repoId: 'r1', fresh: true })
      const cached = await service.tree({ workspaceId: 'w1', repoId: 'r1' })

      expect(list.calls).toHaveLength(2)
      expect(fresh).toEqual({ ok: true, files: ['a.ts', 'new.ts'], truncated: false })
      expect(cached).toEqual(fresh)
    })

    it('다른 workspace의 repo id면 던진다', async () => {
      const service = createFileService({ getRepo: () => REPO, listFiles: fakeList([listed([])]) })
      await expect(service.tree({ workspaceId: 'w2', repoId: 'r1' })).rejects.toThrow('이 workspace의 repo가 아닙니다')
    })
  })

  describe('open (FR-15)', () => {
    it('목록에 있으면 repo 경로 기준으로 연다', async () => {
      const open = fakeOpen()
      const service = createFileService({ getRepo: () => REPO, listFiles: fakeList([listed(['src/a.ts'])]), openFile: open })

      expect(await service.open(REF)).toEqual(OPENED)
      expect(open.calls).toEqual([['/tmp/api', 'src/a.ts']])
    })

    it('캐시 목록에 없으면 한 번 새로 받아 본다 — agent가 방금 만든 파일도 대화록에서 열린다', async () => {
      const list = fakeList([listed([]), listed(['src/a.ts'])])
      const service = createFileService({
        getRepo: () => REPO, listFiles: list, openFile: fakeOpen(), now: () => 0
      })
      await service.tree({ workspaceId: 'w1', repoId: 'r1' })

      expect(await service.open(REF)).toEqual(OPENED)
      expect(list.calls).toHaveLength(2)
    })

    it('새 목록에도 없으면(무시된 파일·.git 안) 열지 않고 이유를 준다', async () => {
      const open = fakeOpen()
      const service = createFileService({ getRepo: () => REPO, listFiles: fakeList([listed(['src/a.ts'])]), openFile: open })

      expect(await service.open({ ...REF, path: '.env' }))
        .toEqual({ ok: false, reason: 'git 목록에 없는 파일이라 열 수 없습니다(무시된 파일일 수 있습니다): .env' })
      expect(await service.open({ ...REF, path: '.git/config' })).toMatchObject({ ok: false })
      expect(open.calls).toHaveLength(0)
    })

    it('목록을 못 얻으면 그 이유다', async () => {
      const service = createFileService({
        getRepo: () => REPO,
        listFiles: fakeList([{ ok: false, reason: 'git 저장소가 아니라 파일 목록을 만들 수 없습니다' }]),
        openFile: fakeOpen()
      })
      expect(await service.open(REF)).toEqual({ ok: false, reason: 'git 저장소가 아니라 파일 목록을 만들 수 없습니다' })
    })

    it('다른 workspace의 repo id면 던진다', async () => {
      const service = createFileService({ getRepo: () => REPO, listFiles: fakeList([listed(['src/a.ts'])]), openFile: fakeOpen() })
      await expect(service.open({ ...REF, workspaceId: 'w2' })).rejects.toThrow('이 workspace의 repo가 아닙니다')
    })
  })

  describe('save (FR-17·FR-19, §3-4)', () => {
    const INPUT = { ...REF, content: 'y\n', expectedHash: 'h1' }

    it('새 목록으로 확인하고 repo 경로 기준으로 쓴다', async () => {
      const write = fakeWrite()
      const list = fakeList([listed(['src/a.ts'])])
      const service = createFileService({ getRepo: () => REPO, listFiles: list, writeFile: write, now: () => 0 })
      await service.tree({ workspaceId: 'w1', repoId: 'r1' })

      expect(await service.save(INPUT)).toEqual({ ok: true, hash: 'h2' })
      expect(write.calls).toEqual([['/tmp/api', 'src/a.ts', 'y\n', 'h1']])
      // 캐시가 살아 있어도 저장은 git을 새로 띄웠다
      expect(list.calls).toHaveLength(2)
    })

    it('캐시 목록에 있었어도 새 목록에서 빠졌으면 던진다 — 그 사이 무시 목록에 들어간 파일', async () => {
      const write = fakeWrite()
      const list = fakeList([listed(['src/a.ts']), listed([])])
      const service = createFileService({ getRepo: () => REPO, listFiles: list, writeFile: write, now: () => 0 })
      await service.tree({ workspaceId: 'w1', repoId: 'r1' })

      await expect(service.save(INPUT)).rejects.toThrow('git 목록에 없는 파일은 저장할 수 없습니다: src/a.ts')
      expect(write.calls).toHaveLength(0)
    })

    it('.git 안이나 무시된 파일은 던진다 — 렌더러에 구멍이 나도 훅을 심을 수 없다', async () => {
      const write = fakeWrite()
      const service = createFileService({ getRepo: () => REPO, listFiles: fakeList([listed(['src/a.ts'])]), writeFile: write })

      await expect(service.save({ ...INPUT, path: '.git/hooks/pre-commit' })).rejects.toThrow('git 목록에 없는')
      await expect(service.save({ ...INPUT, path: '.env' })).rejects.toThrow('git 목록에 없는')
      expect(write.calls).toHaveLength(0)
    })

    it('목록을 못 얻으면 쓰지 않고 그 이유를 실패로 돌려준다', async () => {
      const write = fakeWrite()
      const service = createFileService({
        getRepo: () => REPO, listFiles: fakeList([{ ok: false, reason: 'git이 5000ms 안에 파일 목록을 주지 않았습니다' }]), writeFile: write
      })
      expect(await service.save(INPUT)).toEqual({ ok: false, reason: 'git이 5000ms 안에 파일 목록을 주지 않았습니다' })
      expect(write.calls).toHaveLength(0)
    })

    it('다른 workspace의 repo id면 던진다', async () => {
      const service = createFileService({ getRepo: () => REPO, listFiles: fakeList([listed(['src/a.ts'])]), writeFile: fakeWrite() })
      await expect(service.save({ ...INPUT, workspaceId: 'w2' })).rejects.toThrow('이 workspace의 repo가 아닙니다')
    })
  })

  describe('probe (FR-22)', () => {
    it('(크기, mtime)이 그대로면 다시 해시하지 않는다', async () => {
      let stat: { size: number; mtimeMs: number } | null = { size: 2, mtimeMs: 100 }
      const hashed: string[] = []
      let next = 'h1'
      const service = createFileService({
        getRepo: () => REPO,
        statFile: async () => stat,
        hashFile: async (_root, rel) => { hashed.push(rel); return next }
      })

      expect(await service.probe(REF)).toEqual({ hash: 'h1' })
      expect(await service.probe(REF)).toEqual({ hash: 'h1' })
      expect(hashed).toHaveLength(1)

      stat = { size: 3, mtimeMs: 200 }
      next = 'h2'
      expect(await service.probe(REF)).toEqual({ hash: 'h2' })
      expect(hashed).toHaveLength(2)

      stat = null
      expect(await service.probe(REF)).toEqual({ hash: null })
    })

    it('다른 workspace의 repo id면 던진다', async () => {
      const service = createFileService({ getRepo: () => REPO, statFile: async () => null, hashFile: async () => null })
      await expect(service.probe({ ...REF, workspaceId: 'w2' })).rejects.toThrow('이 workspace의 repo가 아닙니다')
    })
  })
})
