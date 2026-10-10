import { readFile, realpath, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { decodeText, hashBytes, splitBom } from './text'
import type { FileOpenResult } from '@shared/models'

/** 파일 하나의 상한 (docs/sdlc/input-triggers/ FR-13) */
export const MAX_FILE_BYTES = 256 * 1024
/** 코드 칸이 여는 파일의 상한 (docs/sdlc/code-editor/ spec FR-15). `@` 참조의 상한과 따로다. */
export const MAX_OPEN_BYTES = 2 * 1024 * 1024
/** git이 바이너리를 가르는 것과 같은 창 — 앞 8,000바이트에 NUL이 있으면 바이너리다 */
const BINARY_PROBE_BYTES = 8000

export type RepoFileRead =
  | { ok: true; content: string; bytes: number }
  | { ok: false; reason: string }

/** 코드 칸이 연 파일. `text`는 `\n` 줄바꿈이고 BOM이 없다 — 줄바꿈·BOM은 따로 말한다(FR-18) */
export type RepoFileOpen = FileOpenResult

/** repo 상대 경로가 가리키는 곳. 쓰기는 `missing`을 "지워짐"으로, `outside`를 잘못된 호출로 본다 */
export type RepoPath =
  | { kind: 'inside'; realFile: string }
  | { kind: 'outside' }
  | { kind: 'missing' }

interface PathOptions { platform?: NodeJS.Platform }

/**
 * repo 상대 경로를 실제 경로로 푼다. **읽기와 쓰기가 같이 쓰는 검사다** — 따로 두면 한쪽만 junction 탈출을 막는다.
 *
 * 절대 경로·`..`·**실제 경로(realpath)가 루트의 실제 경로 밖**(심링크·junction 탈출)이면 밖이다. 정규화한 문자열만
 * 비교하면 `link/secret.txt`처럼 루트 안에 놓인 링크가 밖을 가리키는 것을 못 막는다. 루트 자체가 링크일 수 있으므로
 * 양쪽 다 realpath다. 루트 자신(`''`·`.`)도 밖이다 — 파일이 아니다.
 *
 * `platform`은 경로 규칙을 고르는 인자다(`executable.ts`와 같은 이유). **던지지 않는다.**
 */
export async function resolveRepoPath(root: string, rel: string, opts: PathOptions = {}): Promise<RepoPath> {
  const p = (opts.platform ?? process.platform) === 'win32' ? win32 : posix
  if (rel === '' || p.isAbsolute(rel) || posix.isAbsolute(rel) || win32.isAbsolute(rel)) return { kind: 'outside' }
  const normalized = p.normalize(rel)
  if (normalized === '..' || normalized.startsWith(`..${p.sep}`) || normalized.startsWith('../')) {
    return { kind: 'outside' }
  }

  let realRoot: string
  try {
    realRoot = await realpath(root)
  } catch {
    return { kind: 'missing' }
  }
  let realFile: string
  try {
    realFile = await realpath(p.join(root, normalized))
  } catch {
    return { kind: 'missing' }
  }
  const relative = p.relative(realRoot, realFile)
  if (relative === '' || relative.startsWith('..') || p.isAbsolute(relative)) return { kind: 'outside' }
  return { kind: 'inside', realFile }
}

/**
 * 판정을 거친 바이트. `verb`는 이유 문구의 동사다 — `@` 참조는 "담을", 코드 칸은 "열"이다.
 * 판정 순서: 밖 → 없음 → 파일 아님 → 크기 → 읽기 → (다시 잰) 크기 → 바이너리.
 */
async function loadBytes(
  root: string, rel: string, maxBytes: number, verb: string, opts: PathOptions
): Promise<{ ok: true; buffer: Buffer } | { ok: false; reason: string }> {
  const resolved = await resolveRepoPath(root, rel, opts)
  if (resolved.kind === 'outside') return { ok: false, reason: `repo 밖의 파일은 ${verb} 수 없습니다: ${rel}` }
  if (resolved.kind === 'missing') return { ok: false, reason: `파일을 읽을 수 없습니다: ${rel}` }

  let size: number
  try {
    const info = await stat(resolved.realFile)
    if (!info.isFile()) return { ok: false, reason: `파일이 아닙니다: ${rel}` }
    size = info.size
  } catch {
    return { ok: false, reason: `파일을 읽을 수 없습니다: ${rel}` }
  }
  if (size > maxBytes) {
    return { ok: false, reason: `파일이 너무 큽니다(${kib(size)}, 상한 ${kib(maxBytes)}): ${rel}` }
  }

  let buffer: Buffer
  try {
    buffer = await readFile(resolved.realFile)
  } catch {
    return { ok: false, reason: `파일을 읽을 수 없습니다: ${rel}` }
  }
  // stat과 읽기 사이에 커졌을 수 있다 — 읽은 것으로 다시 잰다.
  if (buffer.length > maxBytes) {
    return { ok: false, reason: `파일이 너무 큽니다(${kib(buffer.length)}, 상한 ${kib(maxBytes)}): ${rel}` }
  }
  if (buffer.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
    return { ok: false, reason: `바이너리 파일은 ${verb} 수 없습니다: ${rel}` }
  }
  return { ok: true, buffer }
}

/**
 * repo 상대 경로의 파일을 읽는다 (FR-10). **파일을 읽는 자리는 이 모듈 하나다**(NFR-2) — `@` 참조는 이것을,
 * 코드 칸은 `openRepoFile`을 쓰고 둘 다 `loadBytes`를 지난다. 경로는 git 목록에서 왔더라도 여기서 다시 막는다.
 * **던지지 않는다.**
 */
export async function readRepoFile(
  root: string, rel: string, opts: PathOptions = {}
): Promise<RepoFileRead> {
  const loaded = await loadBytes(root, rel, MAX_FILE_BYTES, '담을', opts)
  if (!loaded.ok) return loaded
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(loaded.buffer)
  } catch {
    return { ok: false, reason: `UTF-8 텍스트가 아닌 파일은 담을 수 없습니다: ${rel}` }
  }
  return { ok: true, content, bytes: loaded.buffer.length }
}

/**
 * 코드 칸이 여는 파일 (docs/sdlc/code-editor/ spec FR-15·FR-16). 판정은 `readRepoFile`과 같고 상한만 다르다.
 * 해시는 **디스크 바이트 그대로**의 것이다 — 저장할 때 기대값으로 돌아온다(FR-19). **던지지 않는다.**
 */
export async function openRepoFile(
  root: string, rel: string, opts: PathOptions & { maxBytes?: number } = {}
): Promise<RepoFileOpen> {
  const loaded = await loadBytes(root, rel, opts.maxBytes ?? MAX_OPEN_BYTES, '열', opts)
  if (!loaded.ok) return loaded
  const { bom, body } = splitBom(loaded.buffer)
  let content: string
  try {
    // BOM은 이미 뗐다 — 남은 것이 또 BOM처럼 보여도 걷지 않는다(걷으면 바이트 그대로 되살릴 수 없다).
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)
  } catch {
    return { ok: false, reason: `UTF-8 텍스트가 아닌 파일은 열 수 없습니다: ${rel}` }
  }
  const { text, eol } = decodeText(content)
  return { ok: true, text, eol, bom, hash: hashBytes(loaded.buffer), bytes: loaded.buffer.length }
}

/**
 * 바뀜 확인(FR-22)의 값싼 첫 칸 — 지금 디스크의 (크기, mtime). repo 밖·없음·파일 아님은 null이다(지워진 것으로 본다).
 * 같은 값이면 부르는 쪽이 지난 해시를 다시 쓴다. **던지지 않는다.**
 */
export async function statRepoFile(
  root: string, rel: string, opts: PathOptions = {}
): Promise<{ size: number; mtimeMs: number } | null> {
  const resolved = await resolveRepoPath(root, rel, opts)
  if (resolved.kind !== 'inside') return null
  try {
    const info = await stat(resolved.realFile)
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null
  } catch {
    return null
  }
}

/** 디스크 바이트 그대로의 해시. `statRepoFile`이 바뀌었다고 할 때만 부른다. 못 읽으면 null. **던지지 않는다.** */
export async function hashRepoFile(root: string, rel: string, opts: PathOptions = {}): Promise<string | null> {
  const resolved = await resolveRepoPath(root, rel, opts)
  if (resolved.kind !== 'inside') return null
  try {
    return hashBytes(await readFile(resolved.realFile))
  } catch {
    return null
  }
}

function kib(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KiB`
}
