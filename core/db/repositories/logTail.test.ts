import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { RunEvent } from '@shared/events'
import { readEventTail } from './logTail'

/**
 * 정규화 로그의 꼬리 읽기 (`docs/sdlc/conversation-events/` spec FR-33, 리뷰 반영 2026-09-27).
 *
 * `readLog`가 파일 전체를 문자열로 읽고 줄 배열을 만든 뒤에야 꼬리만 파싱했다 — IPC로 넘기는 양은
 * 창이 묶었지만 **메인 프로세스가 로그 크기의 두 배 가까운 메모리를 순간적으로 잡았고**, 로그가 V8
 * 문자열 한계(약 2^29자)를 넘으면 `readFile`이 던졌다. 끝에서부터 덩어리로 거꾸로 읽어 창이 차면 멈춘다.
 */

const NO_LIMIT = { maxEvents: Number.MAX_SAFE_INTEGER, maxChars: Number.MAX_SAFE_INTEGER }

function text(seq: number, body = `줄 ${seq}`): RunEvent {
  return { type: 'text', runId: 'r', seq, at: seq, text: body }
}

/** 옛 구현 그대로 — 파일 전체를 읽고 끝에서부터 창을 채운다. 꼬리 읽기가 같은 답을 내야 한다 */
function wholeFile(content: string, window: { maxEvents: number; maxChars: number }): RunEvent[] {
  const lines = content.split('\n')
  const tail: RunEvent[] = []
  let chars = 0
  for (let i = lines.length - 1; i >= 0 && tail.length < window.maxEvents; i--) {
    const line = lines[i]!
    if (!line.trim()) continue
    let event: RunEvent
    try {
      event = JSON.parse(line) as RunEvent
    } catch {
      continue
    }
    chars += line.length
    if (chars > window.maxChars) break
    tail.push(event)
  }
  return tail.reverse()
}

describe('readEventTail', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(resolve(tmpdir(), 'one-desk-tail-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  function write(content: string): string {
    const path = join(dir, 'stream.jsonl')
    writeFileSync(path, content)
    return path
  }

  it('덩어리 경계가 여러 바이트 글자·줄 가운데에 걸려도 파일 전체를 읽은 것과 같다', async () => {
    // 한글(3바이트)·이모지(4바이트)·CRLF·빈 줄·깨진 줄·끝 줄바꿈 없음을 한 파일에 섞는다
    const content = [
      JSON.stringify(text(0, '처음 — 한글')),
      '',
      JSON.stringify(text(1, '이모지 \u{1F600} 가운데')),
      '{깨진 줄',
      JSON.stringify(text(2, '윈도 줄바꿈')) + '\r',
      JSON.stringify(text(3, 'x'.repeat(300))),
      JSON.stringify(text(4, '끝 줄바꿈 없음'))
    ].join('\n')
    const path = write(content)
    for (const chunkBytes of [1, 2, 3, 5, 7, 64, 1 << 16]) {
      for (const window of [NO_LIMIT, { maxEvents: 2, maxChars: NO_LIMIT.maxChars }, { maxEvents: 10, maxChars: 400 }]) {
        expect(await readEventTail(path, window, { chunkBytes }), `chunk ${chunkBytes}`)
          .toEqual(wholeFile(content, window))
      }
    }
  })

  it('창이 차면 앞부분은 읽지 않는다 — 읽은 바이트가 파일보다 한참 작다', async () => {
    const path = write(Array.from({ length: 5_000 }, (_, s) => JSON.stringify(text(s)) + '\n').join(''))
    let bytesRead = 0
    const events = await readEventTail(path, { maxEvents: 10, maxChars: NO_LIMIT.maxChars }, {
      chunkBytes: 1_024,
      openFile: async (p) => {
        const handle = await open(p, 'r')
        const read = handle.read.bind(handle) as (...args: unknown[]) => Promise<{ bytesRead: number }>
        ;(handle as unknown as { read: typeof read }).read = async (...args: unknown[]) => {
          const result = await read(...args)
          bytesRead += result.bytesRead
          return result
        }
        return handle
      }
    })
    expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 10 }, (_, i) => 4_990 + i))
    expect(bytesRead).toBeLessThanOrEqual(2 * 1_024)
    expect(bytesRead).toBeLessThan(statSync(path).size / 50)
  })

  it('파일이 없으면 빈 배열이고, 파일이 아니면 던진다', async () => {
    expect(await readEventTail(join(dir, '없는.jsonl'), NO_LIMIT)).toEqual([])
    await expect(readEventTail(dir, NO_LIMIT)).rejects.toThrow()
  })

  it('빈 파일은 빈 배열이다', async () => {
    expect(await readEventTail(write(''), NO_LIMIT)).toEqual([])
  })
})
