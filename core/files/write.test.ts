import { describe, it, expect, afterEach } from 'vitest'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeRepoFile } from './write'
import { hashBytes } from './text'
import { MAX_OPEN_BYTES } from './read'

const dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'one-desk-write-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    // 읽기 전용으로 만든 파일이 있으면 Windows에서 지워지지 않는다 — 풀고 지운다.
    try { chmodSync(join(d, 'ro.txt'), 0o644) } catch { /* 없으면 그만 */ }
    rmSync(d, { recursive: true, force: true })
  }
})

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const utf8 = (s: string) => Buffer.from(s, 'utf8')

/** 디스크에 바이트를 쓰고 그 해시를 돌려준다 — 화면이 열 때 받은 기대값이다 */
function put(root: string, rel: string, bytes: Buffer): string {
  writeFileSync(join(root, rel), bytes)
  return hashBytes(bytes)
}

function linkDir(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('writeRepoFile (docs/sdlc/code-editor/ spec §3-4)', () => {
  it('고친 텍스트를 쓰고 새 디스크 해시를 돌려준다', async () => {
    const root = makeDir()
    const expected = put(root, 'a.ts', utf8('const a = 1\n'))

    const result = await writeRepoFile(root, 'a.ts', 'const a = 2\n', expected)

    const disk = readFileSync(join(root, 'a.ts'))
    expect(disk.equals(utf8('const a = 2\n'))).toBe(true)
    expect(result).toEqual({ ok: true, hash: hashBytes(disk) })
  })

  it('CRLF·BOM 파일에 \\n 텍스트를 쓰면 CRLF·BOM 그대로 나간다 (FR-18)', async () => {
    const root = makeDir()
    const expected = put(root, 'w.cs', Buffer.concat([BOM, utf8('가\r\n나\r\n')]))

    await writeRepoFile(root, 'w.cs', '가\n다\n', expected)

    expect(readFileSync(join(root, 'w.cs')).equals(Buffer.concat([BOM, utf8('가\r\n다\r\n')]))).toBe(true)
  })

  it('화면이 \\r\\n을 보내도 두 번 바꾸지 않는다', async () => {
    const root = makeDir()
    const expected = put(root, 'w.txt', utf8('a\r\nb\r\n'))
    await writeRepoFile(root, 'w.txt', 'a\r\nc\r\n', expected)
    expect(readFileSync(join(root, 'w.txt')).equals(utf8('a\r\nc\r\n'))).toBe(true)
  })

  it('연 뒤에 디스크가 바뀌었으면 쓰지 않고 충돌로 돌려준다 (FR-19)', async () => {
    const root = makeDir()
    const expected = put(root, 'a.ts', utf8('mine\n'))
    const agent = utf8('agent wrote this\n')
    writeFileSync(join(root, 'a.ts'), agent)

    const result = await writeRepoFile(root, 'a.ts', 'overwrite\n', expected)

    expect(result).toEqual({ ok: false, conflict: { hash: hashBytes(agent), deleted: false } })
    expect(readFileSync(join(root, 'a.ts')).equals(agent)).toBe(true)
  })

  it('지워졌으면 다시 만들지 않고 지워짐으로 돌려준다 (FR-22)', async () => {
    const root = makeDir()
    const expected = put(root, 'gone.ts', utf8('x'))
    rmSync(join(root, 'gone.ts'))

    const result = await writeRepoFile(root, 'gone.ts', 'y', expected)

    expect(result).toEqual({ ok: false, conflict: { hash: null, deleted: true } })
    expect(() => readFileSync(join(root, 'gone.ts'))).toThrow()
  })

  // 없는 이름을 쓴다 — 있는 이름이면 realpath 검사가 대신 막아 `..` 검사를 지워도 초록이다(CLAUDE.md).
  it.each(['../없는-파일-7731', 'a/../../없는-파일-7731', '/etc/없는-파일-7731', String.raw`C:\없는-파일-7731`])(
    '%s는 repo 밖이라 던진다', async (rel) => {
      await expect(writeRepoFile(makeDir(), rel, 'x', 'h')).rejects.toThrow(/repo 밖/)
    }
  )

  it('루트 안의 링크가 밖을 가리키면 던지고, 밖의 파일은 그대로다', async () => {
    const outside = makeDir()
    const expected = put(outside, 'secret.txt', utf8('SECRET'))
    const root = makeDir()
    linkDir(outside, join(root, 'link'))

    await expect(writeRepoFile(root, 'link/secret.txt', 'pwned', expected)).rejects.toThrow(/repo 밖/)
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('SECRET')
  })

  it('디렉토리는 던진다', async () => {
    const root = makeDir()
    mkdirSync(join(root, 'dir'))
    await expect(writeRepoFile(root, 'dir', 'x', 'h')).rejects.toThrow(/파일이 아닙니다/)
  })

  it('디스크의 줄바꿈이 섞였으면 던지고 쓰지 않는다 (FR-16)', async () => {
    const root = makeDir()
    const bytes = utf8('a\r\nb\n')
    const expected = put(root, 'm.txt', bytes)

    await expect(writeRepoFile(root, 'm.txt', 'a\nc\n', expected)).rejects.toThrow(/줄바꿈이 섞/)
    expect(readFileSync(join(root, 'm.txt')).equals(bytes)).toBe(true)
  })

  it('제자리에 쓴다 — 하드링크한 다른 이름도 같이 바뀐다', async () => {
    const root = makeDir()
    const expected = put(root, 'a.txt', utf8('one'))
    linkSync(join(root, 'a.txt'), join(root, 'b.txt'))

    await writeRepoFile(root, 'a.txt', 'two', expected)

    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('two')
  })

  it('읽기 전용 파일은 던지지 않고 실패로 돌려준다 — 고친 것은 화면에 남는다', async () => {
    const root = makeDir()
    const expected = put(root, 'ro.txt', utf8('keep'))
    chmodSync(join(root, 'ro.txt'), 0o444)

    const result = await writeRepoFile(root, 'ro.txt', 'change', expected)

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/^파일을 저장하지 못했습니다.*ro\.txt/)
    expect(readFileSync(join(root, 'ro.txt'), 'utf8')).toBe('keep')
  })

  it('되살린 바이트가 상한을 넘으면 쓰지 않고 실패로 돌려준다', async () => {
    const root = makeDir()
    const expected = put(root, 'a.txt', utf8('small'))

    const result = await writeRepoFile(root, 'a.txt', 'a'.repeat(MAX_OPEN_BYTES + 1), expected)

    expect(result).toMatchObject({ ok: false })
    expect((result as { reason: string }).reason).toMatch(/^파일이 너무 큽니다/)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('small')
  })
})
