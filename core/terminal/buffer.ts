/**
 * 셸 하나의 최근 출력 (`docs/sdlc/code-editor/terminal-spec.md` FR-6). 칸을 닫거나 다른 repo로 옮겼다 돌아오면 칸이 이것을 받아
 * 다시 그린다. 메모리에만 있다 — 파일로 남기지 않는다(FR-9).
 *
 * **누적 위치를 같이 쥔다.** 조각마다 "지금까지 받은 글자 중 몇 번째부터인가"(`append`의 반환값)를 붙여 내보내고, 스냅샷은 그
 * 끝 위치를 준다. 칸은 스냅샷을 받기 전에 구독부터 하므로 둘이 겹칠 수 있는데, 이 위치로 겹친 앞부분을 잘라 같은 출력이 두 번
 * 찍히지 않게 한다(`renderer/code/terminalStream.ts`).
 */

/** 셸마다 쥐는 최근 출력의 상한 — UTF-16 길이(`string.length`)로 잰다 */
export const OUTPUT_LIMIT = 512 * 1024

export interface OutputSnapshot {
  /** 남아 있는 최근 출력 — 상한을 넘지 않는다 */
  text: string
  /** 지금까지 받은 글자 수(버린 것 포함) — `text`의 끝 위치 */
  end: number
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** 뒤에서 `limit`만큼 남긴다. 자르는 자리가 서로게이트 쌍 가운데면 한 글자 더 버린다 */
function tail(text: string, limit: number): string {
  if (text.length <= limit) return text
  let cut = text.length - limit
  if (isLowSurrogate(text.charCodeAt(cut))) cut++
  return text.slice(cut)
}

export function createOutputBuffer(limit: number = OUTPUT_LIMIT) {
  let text = ''
  let end = 0
  return {
    /** 조각을 쌓고 그 조각의 누적 시작 위치를 준다 */
    append(data: string): number {
      const start = end
      text += data
      end += data.length
      // 조각마다 자르면 상한 근처에서 조각마다 512 KiB를 복사한다 — 두 배가 될 때만 자르고 스냅샷이 상한으로 맞춘다
      if (text.length > limit * 2) text = tail(text, limit)
      return start
    },
    snapshot(): OutputSnapshot {
      text = tail(text, limit)
      return { text, end }
    }
  }
}

export type OutputBuffer = ReturnType<typeof createOutputBuffer>
