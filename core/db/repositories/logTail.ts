import { open, type FileHandle } from 'node:fs/promises'
import type { RunEvent } from '@shared/events'

/**
 * 정규화 로그(`stream.jsonl`)의 **꼬리**를 창만큼 읽는다 (`docs/sdlc/conversation-events/` spec FR-33).
 *
 * **끝에서부터 덩어리로 거꾸로 읽고, 창이 차면 멈춘다**(리뷰 반영 2026-09-27). 파일 전체를 문자열로
 * 읽으면 IPC로 넘기는 양은 창이 묶어도 메인 프로세스가 로그 크기의 두 배 가까운 메모리를 순간적으로
 * 잡는다 — 같은 프로세스에 MCP 서버가 돈다. 로그에는 상한이 없어서, V8 문자열 한계(약 2^29자)를
 * 넘으면 `readFile`이 던져 턴이 꼬리 대신 오류를 보였다. 여기서 쥐는 것은 덩어리 하나와 아직 머리를
 * 못 찾은 줄 조각뿐이다.
 *
 * 줄은 바이트 `\n`으로 가른다 — UTF-8에서 그 바이트는 여러 바이트 글자 안에 나오지 않으므로, 덩어리
 * 경계가 글자 가운데에 걸려도 줄을 디코드할 때는 온전하다.
 *
 * 창의 규칙은 전과 같다: 끝에서부터 개수·글자 두 한계를 모두 지키는 만큼, 무게는 디코드한 줄의
 * 길이(`eventWeight`와 같은 수), 빈 줄과 깨진 줄은 건너뛰고 창에도 세지 않는다, 혼자서 창보다 무거운
 * 줄에서 멈춘다. 파일이 없으면 빈 배열이고 그 밖의 읽기 실패는 던진다.
 */

export interface TailWindow {
  maxEvents: number
  maxChars: number
}

export interface TailOptions {
  /** 한 번에 거꾸로 읽는 바이트. 테스트가 작게 주어 경계를 흔든다 */
  chunkBytes?: number
  /** 파일을 여는 이음매 — 테스트가 읽은 바이트를 센다 */
  openFile?: (path: string) => Promise<FileHandle>
}

const NEWLINE = 0x0a
const DEFAULT_CHUNK_BYTES = 64 * 1024

/** `position`에서 `buffer`를 가득 채운다. 한 번의 read가 덜 줄 수 있다 */
async function readFully(handle: FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset)
    if (bytesRead === 0) throw new Error('로그를 읽는 중에 파일이 줄었습니다')
    offset += bytesRead
  }
}

export async function readEventTail(
  path: string, window: TailWindow, options: TailOptions = {}
): Promise<RunEvent[]> {
  const chunkBytes = Math.max(1, options.chunkBytes ?? DEFAULT_CHUNK_BYTES)
  let handle: FileHandle
  try {
    handle = await (options.openFile ?? ((p: string) => open(p, 'r')))(path)
  } catch (err) {
    // 취소되거나 spawn 전에 끝난 run은 파일이 없다
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  try {
    const info = await handle.stat()
    // 디렉토리를 가리키면 "로그 없음"이 아니라 오류다 — 삼키면 로그가 원래 없던 run처럼 보인다
    if (!info.isFile()) throw new Error(`로그 경로가 파일이 아닙니다: ${path}`)

    const tail: RunEvent[] = []
    let chars = 0
    let full = false
    /** 한 줄을 창에 넣는다. 창이 찼으면(더 볼 필요가 없으면) full을 세운다 */
    const take = (bytes: Buffer): void => {
      const line = bytes.toString('utf8')
      if (!line.trim()) return
      let event: RunEvent
      try {
        event = JSON.parse(line) as RunEvent
      } catch {
        // 쓰다 만 마지막 줄일 수 있다. 나머지를 살린다 — 창에도 세지 않는다.
        return
      }
      chars += line.length
      if (chars > window.maxChars) {
        full = true
        return
      }
      tail.push(event)
      if (tail.length >= window.maxEvents) full = true
    }

    let position = info.size
    /** 아직 머리(앞의 줄바꿈)를 못 찾은 줄 조각 — 파일에서 `position` 바로 뒤에 온다 */
    let rest: Buffer = Buffer.alloc(0)
    while (position > 0 && !full && tail.length < window.maxEvents) {
      const size = Math.min(chunkBytes, position)
      position -= size
      const chunk = Buffer.allocUnsafe(size)
      await readFully(handle, chunk, position)
      const buffer = rest.length > 0 ? Buffer.concat([chunk, rest]) : chunk
      let end = buffer.length
      let newline = buffer.lastIndexOf(NEWLINE, end - 1)
      while (newline >= 0 && !full) {
        take(buffer.subarray(newline + 1, end))
        end = newline
        newline = end > 0 ? buffer.lastIndexOf(NEWLINE, end - 1) : -1
      }
      rest = buffer.subarray(0, end)
    }
    // 파일의 첫 줄 — 앞에 줄바꿈이 없다
    if (position === 0 && !full && tail.length < window.maxEvents && rest.length > 0) take(rest)
    return tail.reverse()
  } finally {
    await handle.close()
  }
}
