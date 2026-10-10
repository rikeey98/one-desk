import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRepoFile, openRepoFile, resolveRepoPath, MAX_FILE_BYTES, MAX_OPEN_BYTES } from './read'
import { hashBytes } from './text'

const dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'one-desk-read-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** 루트 밖 디렉토리를 가리키는 링크. Windows는 권한이 필요 없는 junction이다 — 건너뛰지 않는다. */
function linkDir(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('readRepoFile (FR-10)', () => {
  it('정상 파일은 내용이고 BOM은 걷힌다', async () => {
    const root = makeDir()
    writeFileSync(join(root, 'a.txt'), '\uFEFF안녕')
    expect(await readRepoFile(root, 'a.txt')).toEqual({ ok: true, content: '안녕', bytes: 9 })
  })

  it('하위 디렉토리의 파일도 / 경로로 읽는다', async () => {
    const root = makeDir()
    mkdirSync(join(root, 'notes'))
    writeFileSync(join(root, 'notes', 'a.txt'), 'x')
    expect(await readRepoFile(root, 'notes/a.txt')).toMatchObject({ ok: true, content: 'x' })
  })

  // 없는 이름을 쓴다 — 임시 폴더에 우연히 있는 파일이면 realpath 검사가 대신 막아 `..` 검사가 무방비가 된다.
  it.each([
    '/etc/passwd', String.raw`C:\Windows\win.ini`, '../없는-파일-7731', 'a/../../없는-파일-7731', '..'
  ])('%s는 repo 밖이다', async (rel) => {
    const root = makeDir()
    expect(await readRepoFile(root, rel)).toEqual({ ok: false, reason: `repo 밖의 파일은 담을 수 없습니다: ${rel}` })
  })

  it('루트 안의 링크가 밖을 가리키면 repo 밖이다 — 정규화한 문자열로는 못 막는다', async () => {
    const outside = makeDir()
    writeFileSync(join(outside, 'secret.txt'), 'SECRET')
    const root = makeDir()
    linkDir(outside, join(root, 'link'))

    const result = await readRepoFile(root, 'link/secret.txt')

    expect(result).toEqual({ ok: false, reason: 'repo 밖의 파일은 담을 수 없습니다: link/secret.txt' })
  })

  it('루트 자체가 링크 경로여도 안의 파일은 읽는다', async () => {
    const real = makeDir()
    writeFileSync(join(real, 'a.txt'), 'x')
    const holder = makeDir()
    linkDir(real, join(holder, 'root-link'))

    expect(await readRepoFile(join(holder, 'root-link'), 'a.txt')).toMatchObject({ ok: true, content: 'x' })
  })

  it('디렉토리·바이너리·UTF-8이 아닌 파일은 거부한다', async () => {
    const root = makeDir()
    mkdirSync(join(root, 'dir'))
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x61, 0x00, 0x62]))
    writeFileSync(join(root, 'latin.txt'), Buffer.from([0x61, 0xff, 0x62]))

    expect(await readRepoFile(root, 'dir')).toEqual({ ok: false, reason: '파일이 아닙니다: dir' })
    expect(await readRepoFile(root, 'bin.dat')).toEqual({ ok: false, reason: '바이너리 파일은 담을 수 없습니다: bin.dat' })
    expect(await readRepoFile(root, 'latin.txt'))
      .toEqual({ ok: false, reason: 'UTF-8 텍스트가 아닌 파일은 담을 수 없습니다: latin.txt' })
  })

  it('정확히 상한이면 통과하고 1바이트 넘으면 거부한다', async () => {
    const root = makeDir()
    writeFileSync(join(root, 'exact.txt'), 'a'.repeat(MAX_FILE_BYTES))
    writeFileSync(join(root, 'over.txt'), 'a'.repeat(MAX_FILE_BYTES + 1))

    expect(await readRepoFile(root, 'exact.txt')).toMatchObject({ ok: true, bytes: MAX_FILE_BYTES })
    const over = await readRepoFile(root, 'over.txt')
    expect(over.ok).toBe(false)
    expect((over as { reason: string }).reason).toMatch(/^파일이 너무 큽니다.*over\.txt$/)
  })

  it('없는 파일은 읽을 수 없다고 한다', async () => {
    expect(await readRepoFile(makeDir(), 'none.txt')).toEqual({ ok: false, reason: '파일을 읽을 수 없습니다: none.txt' })
  })
})

describe('openRepoFile — 코드 칸 (docs/sdlc/code-editor/ FR-15·FR-16)', () => {
  it('\n 텍스트와 디스크의 줄바꿈·BOM·바이트 해시를 준다', async () => {
    const root = makeDir()
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('가\r\n나\r\n', 'utf8')])
    writeFileSync(join(root, 'a.ts'), bytes)

    expect(await openRepoFile(root, 'a.ts')).toEqual({
      ok: true, text: '가\n나\n', eol: 'crlf', bom: true, hash: hashBytes(bytes), bytes: bytes.length
    })
  })

  it('줄바꿈이 섞인 파일도 열기는 한다 — mixed라고 말한다', async () => {
    const root = makeDir()
    writeFileSync(join(root, 'm.txt'), 'a\r\nb\n')
    expect(await openRepoFile(root, 'm.txt')).toMatchObject({ ok: true, text: 'a\nb\n', eol: 'mixed', bom: false })
  })

  it('상한은 2 MiB다 — @ 참조의 256 KiB보다 크다', async () => {
    const root = makeDir()
    writeFileSync(join(root, 'mid.txt'), 'a'.repeat(MAX_FILE_BYTES + 1))
    writeFileSync(join(root, 'exact.txt'), 'a'.repeat(MAX_OPEN_BYTES))
    writeFileSync(join(root, 'over.txt'), 'a'.repeat(MAX_OPEN_BYTES + 1))

    expect(await openRepoFile(root, 'mid.txt')).toMatchObject({ ok: true })
    expect(await openRepoFile(root, 'exact.txt')).toMatchObject({ ok: true, bytes: MAX_OPEN_BYTES })
    const over = await openRepoFile(root, 'over.txt')
    expect(over).toMatchObject({ ok: false })
    expect((over as { reason: string }).reason).toMatch(/^파일이 너무 큽니다\(.*상한 2048 KiB\): over\.txt$/)
  })

  it('이유는 "열 수 없습니다"로 말한다', async () => {
    const root = makeDir()
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x61, 0x00, 0x62]))
    writeFileSync(join(root, 'latin.txt'), Buffer.from([0x61, 0xff, 0x62]))

    expect(await openRepoFile(root, 'bin.dat')).toEqual({ ok: false, reason: '바이너리 파일은 열 수 없습니다: bin.dat' })
    expect(await openRepoFile(root, 'latin.txt'))
      .toEqual({ ok: false, reason: 'UTF-8 텍스트가 아닌 파일은 열 수 없습니다: latin.txt' })
    expect(await openRepoFile(root, '../없는-파일-7731'))
      .toEqual({ ok: false, reason: 'repo 밖의 파일은 열 수 없습니다: ../없는-파일-7731' })
  })

  it('루트 안의 링크가 밖을 가리키면 열지 않는다', async () => {
    const outside = makeDir()
    writeFileSync(join(outside, 'secret.txt'), 'SECRET')
    const root = makeDir()
    linkDir(outside, join(root, 'link'))
    expect(await openRepoFile(root, 'link/secret.txt'))
      .toEqual({ ok: false, reason: 'repo 밖의 파일은 열 수 없습니다: link/secret.txt' })
  })
})

describe('resolveRepoPath — 읽기와 쓰기가 같이 쓰는 경로 검사', () => {
  it('안쪽 파일은 실제 경로다', async () => {
    const root = makeDir()
    writeFileSync(join(root, 'a.txt'), 'x')
    const result = await resolveRepoPath(root, 'a.txt')
    expect(result.kind).toBe('inside')
  })

  it.each(['../없는-파일-7731', 'a/../../없는-파일-7731', '/etc/passwd', String.raw`C:\Windows\win.ini`, '', '.'])(
    '%j는 밖이다', async (rel) => {
      expect((await resolveRepoPath(makeDir(), rel)).kind).toBe('outside')
    }
  )

  it('없는 파일은 missing이다 — 밖과 다르다(쓰기는 지워짐으로 본다)', async () => {
    expect((await resolveRepoPath(makeDir(), 'none.txt')).kind).toBe('missing')
  })

  it('밖을 가리키는 링크 아래는 밖이다', async () => {
    const outside = makeDir()
    writeFileSync(join(outside, 'secret.txt'), 'SECRET')
    const root = makeDir()
    linkDir(outside, join(root, 'link'))
    expect((await resolveRepoPath(root, 'link/secret.txt')).kind).toBe('outside')
  })
})
