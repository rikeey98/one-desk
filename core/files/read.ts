import { readFile, realpath, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

/** 파일 하나의 상한 (docs/sdlc/input-triggers/ FR-13) */
export const MAX_FILE_BYTES = 256 * 1024
/** git이 바이너리를 가르는 것과 같은 창 — 앞 8,000바이트에 NUL이 있으면 바이너리다 */
const BINARY_PROBE_BYTES = 8000

export type RepoFileRead =
  | { ok: true; content: string; bytes: number }
  | { ok: false; reason: string }

/**
 * repo 상대 경로의 파일을 읽는다 (FR-10). **파일을 읽는 자리는 여기 하나다**(NFR-2).
 *
 * 경로는 git 목록에서 왔더라도 여기서 다시 막는다 — 절대 경로·`..`·**실제 경로(realpath)가 루트의
 * 실제 경로 밖**(심링크·junction 탈출). 정규화한 문자열만 비교하면 `link/secret.txt`처럼 루트 안에
 * 놓인 링크가 밖을 가리키는 것을 못 막는다. 루트 자체가 링크일 수 있으므로 양쪽 다 realpath다.
 *
 * `platform`은 경로 규칙을 고르는 인자다(`executable.ts`와 같은 이유). **던지지 않는다.**
 */
export async function readRepoFile(
  root: string, rel: string, opts: { platform?: NodeJS.Platform } = {}
): Promise<RepoFileRead> {
  const p = (opts.platform ?? process.platform) === 'win32' ? win32 : posix
  const outside = { ok: false as const, reason: `repo 밖의 파일은 담을 수 없습니다: ${rel}` }
  if (rel === '' || p.isAbsolute(rel) || posix.isAbsolute(rel) || win32.isAbsolute(rel)) return outside
  const normalized = p.normalize(rel)
  if (normalized === '..' || normalized.startsWith(`..${p.sep}`) || normalized.startsWith('../')) return outside

  let realRoot: string
  let realFile: string
  try {
    realRoot = await realpath(root)
    realFile = await realpath(p.join(root, normalized))
  } catch {
    return { ok: false, reason: `파일을 읽을 수 없습니다: ${rel}` }
  }
  const relative = p.relative(realRoot, realFile)
  if (relative === '' || relative.startsWith('..') || p.isAbsolute(relative)) return outside

  let size: number
  try {
    const info = await stat(realFile)
    if (!info.isFile()) return { ok: false, reason: `파일이 아닙니다: ${rel}` }
    size = info.size
  } catch {
    return { ok: false, reason: `파일을 읽을 수 없습니다: ${rel}` }
  }
  if (size > MAX_FILE_BYTES) {
    return { ok: false, reason: `파일이 너무 큽니다(${kib(size)}, 상한 ${kib(MAX_FILE_BYTES)}): ${rel}` }
  }

  let buffer: Buffer
  try {
    buffer = await readFile(realFile)
  } catch {
    return { ok: false, reason: `파일을 읽을 수 없습니다: ${rel}` }
  }
  // stat과 읽기 사이에 커졌을 수 있다 — 읽은 것으로 다시 잰다.
  if (buffer.length > MAX_FILE_BYTES) {
    return { ok: false, reason: `파일이 너무 큽니다(${kib(buffer.length)}, 상한 ${kib(MAX_FILE_BYTES)}): ${rel}` }
  }
  if (buffer.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
    return { ok: false, reason: `바이너리 파일은 담을 수 없습니다: ${rel}` }
  }
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer)
  } catch {
    return { ok: false, reason: `UTF-8 텍스트가 아닌 파일은 담을 수 없습니다: ${rel}` }
  }
  return { ok: true, content, bytes: buffer.length }
}

function kib(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KiB`
}
