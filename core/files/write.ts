import { readFile, stat, writeFile } from 'node:fs/promises'
import { MAX_OPEN_BYTES, resolveRepoPath } from './read'
import { decodeText, encodeText, hashBytes, splitBom } from './text'
import type { FileSaveResult } from '@shared/models'

/**
 * 충돌(`conflict`)은 연 뒤에 디스크가 바뀌었거나 지워진 것 — 쓰지 않았다. `hash`는 지금 디스크의 것(지워졌으면 null).
 * 실패(`reason`)는 쓰려 했지만 못 쓴 것(권한·잠김·디스크 가득·너무 큼) — 사람이 만날 수 있어 던지지 않는다.
 */
export type RepoFileWrite = FileSaveResult

/**
 * 코드 칸의 저장 (docs/sdlc/code-editor/ spec §3-4의 3~5). **파일을 쓰는 자리는 여기 하나다**(NFR-2).
 * 목록 검사(§3-4의 2)는 부르는 쪽(`service.save`)이 먼저 한다.
 *
 * 1. 경로가 repo 안의 일반 파일인가 — 읽기와 **같은** `resolveRepoPath`. 밖·파일 아님은 화면이 만들 수 없는 요청이라 던진다.
 * 2. 지금 디스크 바이트의 해시가 `expectedHash`와 같은가 — 다르면 충돌(FR-19). 자동 병합은 하지 않는다.
 * 3. 디스크 파일의 줄바꿈·BOM으로 텍스트를 되살려(FR-18) **제자리에** 쓴다 — `writeFile`의 `'w'`는 같은 파일을
 *    잘라 쓴다(하드링크·권한이 그대로). 임시 파일 + 이름 바꾸기는 다른 프로세스가 연 파일에서 Windows가 실패한다.
 *
 * 2와 3 사이는 원자적이지 않다 — 그 틈(해시 한 번과 쓰기 한 번 사이)에 agent가 쓰면 사람이 덮어쓴다(spec §3-4).
 */
export async function writeRepoFile(
  root: string, rel: string, text: string, expectedHash: string, opts: { platform?: NodeJS.Platform } = {}
): Promise<RepoFileWrite> {
  const resolved = await resolveRepoPath(root, rel, opts)
  if (resolved.kind === 'outside') throw new Error(`repo 밖의 파일은 저장할 수 없습니다: ${rel}`)
  const deleted = { ok: false as const, conflict: { hash: null, deleted: true } }
  if (resolved.kind === 'missing') return deleted

  try {
    if (!(await stat(resolved.realFile)).isFile()) throw new NotAFile()
  } catch (err) {
    if (err instanceof NotAFile) throw new Error(`파일이 아닙니다: ${rel}`)
    return deleted
  }

  let disk: Buffer
  try {
    disk = await readFile(resolved.realFile)
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return deleted
    return { ok: false, reason: `파일을 읽지 못했습니다(${codeOf(err) ?? '알 수 없음'}): ${rel}` }
  }
  const diskHash = hashBytes(disk)
  if (diskHash !== expectedHash) return { ok: false, conflict: { hash: diskHash, deleted: false } }

  // 해시가 같으므로 디스크는 화면이 연 그 바이트다 — 연 때 UTF-8로 읽혔다.
  const { bom, body } = splitBom(disk)
  const { eol } = decodeText(body.toString('utf8'))
  if (eol === 'mixed') throw new Error(`줄바꿈이 섞여 있어 저장할 수 없습니다: ${rel}`)

  // 화면은 `\n` 텍스트를 보낸다. 혹시 `\r\n`이 오면 CRLF 파일에서 `\r\r\n`이 되므로 먼저 고른다.
  const out = encodeText(text.replace(/\r\n?/g, '\n'), eol, bom)
  if (out.length > MAX_OPEN_BYTES) {
    return { ok: false, reason: `파일이 너무 큽니다(${Math.ceil(out.length / 1024)} KiB, 상한 ${MAX_OPEN_BYTES / 1024} KiB): ${rel}` }
  }
  try {
    await writeFile(resolved.realFile, out)
  } catch (err) {
    return { ok: false, reason: `파일을 저장하지 못했습니다(${codeOf(err) ?? '알 수 없음'}): ${rel}` }
  }
  return { ok: true, hash: hashBytes(out) }
}

class NotAFile extends Error {}

function codeOf(err: unknown): string | null {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : null
}
