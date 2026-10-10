import { createHash } from 'node:crypto'
import type { FileEol } from '@shared/models'

/**
 * 코드 칸이 읽고 쓰는 텍스트의 판정 (docs/sdlc/code-editor/ spec FR-16·FR-18). 전부 순수 함수다.
 *
 * 렌더러는 `\n` 텍스트만 다룬다. 줄바꿈과 BOM은 **디스크 파일의 것**을 core가 되살린다 — 저장 한 번에 Windows
 * repo의 CRLF가 LF로 바뀌면 diff 전체가 바뀐 줄이 된다.
 */
export type Eol = FileEol

const BOM = [0xef, 0xbb, 0xbf] as const

/** UTF-8 BOM을 뗀다. 있었는지 함께 돌려준다 — 저장할 때 다시 붙인다. */
export function splitBom(bytes: Buffer): { bom: boolean; body: Buffer } {
  const bom = bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2]
  return { bom, body: bom ? bytes.subarray(3) : bytes }
}

/**
 * 줄바꿈 종류. CRLF와 LF가 섞였거나 외톨이 `\r`(옛 Mac)이 하나라도 있으면 `mixed`다 — 어느 쪽으로도 바이트 그대로
 * 되살릴 수 없으므로 저장을 막는다(FR-16).
 */
export function detectEol(content: string): Eol {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i)
    if (c === 13) {
      if (content.charCodeAt(i + 1) !== 10) return 'mixed'
      crlf++
      i++
    } else if (c === 10) {
      lf++
    }
  }
  if (crlf > 0 && lf > 0) return 'mixed'
  if (crlf > 0) return 'crlf'
  if (lf > 0) return 'lf'
  return 'none'
}

/** BOM을 뗀 본문 → 화면이 쓸 `\n` 텍스트와 줄바꿈 종류. 섞인 파일도 보여 줄 수는 있게 `\n`으로 고른다. */
export function decodeText(content: string): { text: string; eol: Eol } {
  return { text: content.replace(/\r\n?/g, '\n'), eol: detectEol(content) }
}

/**
 * `\n` 텍스트 → 디스크에 쓸 바이트. 줄바꿈이 없던 파일(`none`)에 줄을 더하면 LF다. `mixed`는 받지 않는다 —
 * 부르는 쪽(쓰기)이 먼저 막는다.
 */
export function encodeText(text: string, eol: Exclude<Eol, 'mixed'>, bom: boolean): Buffer {
  const body = Buffer.from(eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text, 'utf8')
  return bom ? Buffer.concat([Buffer.from(BOM), body]) : body
}

/** 디스크 바이트 그대로의 sha256 hex — 낙관적 잠금의 기대값이다(FR-19). BOM·줄바꿈까지 포함한다. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
