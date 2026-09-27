import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createLogWriter, createRawLogWriter, RAW_LOG_MAX_BYTES } from './logWriter'
import type { RunEvent } from '@shared/events'

const EVENT: RunEvent = { runId: 'r1', seq: 0, at: 1, type: 'text', text: '안녕' }

describe('createLogWriter', () => {
  it('스트림을 열지 못하면 처리되지 않은 예외 대신 onError로 흘려보낸다', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-logwriter-'))
    try {
      const target = join(dir, 'stream.jsonl')
      // 같은 이름의 디렉토리를 만들어 두면 append용 열기가 비동기로 실패한다.
      // createWriteStream의 open은 비동기여서, error 리스너가 없으면
      // 처리되지 않은 예외가 되어 Electron 메인 프로세스를 죽인다.
      mkdirSync(target)

      let resolveSeen: (v: [string, unknown]) => void = () => {}
      const seen = new Promise<[string, unknown]>((r) => {
        resolveSeen = r
      })
      const writer = createLogWriter(target, (message, err) => resolveSeen([message, err]))
      writer.write(EVENT)

      const [message, err] = await seen
      expect(message).toContain(target)
      expect(err).toBeInstanceOf(Error)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('열기에 실패해도 close()가 매달리지 않는다', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-logwriter-'))
    try {
      const target = join(dir, 'stream.jsonl')
      mkdirSync(target)

      const seen = new Promise<void>((r) => {
        const writer = createLogWriter(target, () => r())
        writer.write(EVENT)
      })
      await seen

      // 실패한 뒤에도 close()는 반드시 풀려야 한다. 여기서 매달리면
      // run이 끝나지 않고 동시 실행 슬롯이 영원히 점유된다.
      const writer2 = createLogWriter(target, () => {})
      await writer2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('정상 경로에서는 JSONL 한 줄을 쓴다', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-logwriter-'))
    try {
      const target = join(dir, 'nested', 'stream.jsonl')
      const writer = createLogWriter(target)
      writer.write(EVENT)
      await writer.close()

      const { readFileSync } = await import('node:fs')
      expect(JSON.parse(readFileSync(target, 'utf8').trim())).toEqual(EVENT)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * 원본 줄 로그 `raw.jsonl` (`docs/sdlc/conversation-events/` spec FR-3·FR-4, §7-A).
 * stdout 줄을 받은 그대로 적는 재료다 — 나중에 파서가 좋아지면 지난 대화에 다시 쓴다.
 */
describe('createRawLogWriter', () => {
  function tempDir() {
    const dir = mkdtempSync(resolve(tmpdir(), 'one-desk-rawlog-'))
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }

  /** 쓴 파일을 줄로 돌려준다. 마지막 개행 뒤의 빈 칸은 뺀다 */
  function readLines(path: string): string[] {
    const content = readFileSync(path, 'utf8')
    expect(content.endsWith('\n')).toBe(true)
    return content.slice(0, -1).split('\n')
  }

  const failOnError = (message: string, err: unknown) => {
    throw new Error(`onError가 불리면 안 된다: ${message} ${String(err)}`)
  }

  it('받은 줄을 그대로 한 줄씩 쓴다 — JSON이 아닌 줄과 어댑터가 버리는 줄도', async () => {
    const t = tempDir()
    try {
      const target = join(t.dir, 'nested', 'raw.jsonl')
      const lines = [
        '{"type":"system","subtype":"status","status":"compacting"}',
        '이건 JSON이 아니다 {',
        '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"","signature":"SIG"}]}}'
      ]
      const writer = createRawLogWriter(target, RAW_LOG_MAX_BYTES, failOnError)
      for (const line of lines) writer.write(line)
      await writer.close()

      expect(readLines(target)).toEqual(lines)
    } finally { t.cleanup() }
  })

  it('다음 줄이 상한을 넘기면 그 줄 대신 표식 한 줄을 쓰고, 이후 줄은 들어갈 자리가 있어도 버린다', async () => {
    const t = tempDir()
    try {
      const target = join(t.dir, 'raw.jsonl')
      // 'aaaa\n' + 'bbbb\n' = 10바이트 — 상한과 정확히 같으면 아직 넘은 것이 아니다.
      const writer = createRawLogWriter(target, 10, failOnError)
      const before = Date.now()
      for (const line of ['aaaa', 'bbbb', 'cc', 'd', 'e']) writer.write(line)
      await writer.close()

      const lines = readLines(target)
      expect(lines.slice(0, 2)).toEqual(['aaaa', 'bbbb'])
      // 표식은 한 번뿐이다 — 버린 줄마다 찍으면 상한 뒤로 파일이 계속 자란다.
      expect(lines).toHaveLength(3)
      const marker = JSON.parse(lines[2]!) as Record<string, unknown>
      expect(marker).toEqual({ oneDesk: 'raw-truncated', limitBytes: 10, at: expect.any(Number) })
      expect(marker['at']).toBeGreaterThanOrEqual(before)
      // 두 CLI의 줄은 전부 type을 가진다 — 다시 파싱하는 쪽이 CLI 출력과 헷갈리지 않게 type이 없다.
      expect('type' in marker).toBe(false)
    } finally { t.cleanup() }
  })

  it('한 줄이 상한보다 커도 같다 — 표식 한 줄로 끝난다', async () => {
    const t = tempDir()
    try {
      const target = join(t.dir, 'raw.jsonl')
      const writer = createRawLogWriter(target, 64, failOnError)
      writer.write('x'.repeat(1000))
      writer.write('y')
      await writer.close()

      const lines = readLines(target)
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]!)).toMatchObject({ oneDesk: 'raw-truncated', limitBytes: 64 })
    } finally { t.cleanup() }
  })

  it('상한은 UTF-8 바이트(개행 포함)로 잰다 — 글자 수가 아니다', async () => {
    const t = tempDir()
    try {
      // '가가'는 두 글자지만 6바이트다. 개행까지 7바이트.
      const exact = join(t.dir, 'exact.jsonl')
      const fits = createRawLogWriter(exact, 7, failOnError)
      fits.write('가가')
      await fits.close()
      expect(readLines(exact)).toEqual(['가가'])

      // 글자 수(개행 포함 3)로 재면 6바이트 상한 안에 들어가 버린다.
      const over = join(t.dir, 'over.jsonl')
      const tooBig = createRawLogWriter(over, 6, failOnError)
      tooBig.write('가가')
      await tooBig.close()
      const lines = readLines(over)
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]!)).toMatchObject({ oneDesk: 'raw-truncated' })
    } finally { t.cleanup() }
  })

  it('rate_limit_event 줄은 쓰지 않는다 — 개인 구독 정보다 (spec §7-A)', async () => {
    // run-info spec §7이 "로그에 원본 줄이 남지 않는다"고 약속한 유일한 type이다.
    const t = tempDir()
    try {
      const target = join(t.dir, 'raw.jsonl')
      const rateLimit = JSON.stringify({
        type: 'rate_limit_event', session_id: 's1',
        rate_limit_info: { status: 'allowed', resetsAt: 1790000000, unifiedWindows: { five_hour: { utilization: 0.03 } } },
        padding: 'p'.repeat(200)
      })
      // 글자로만 거르면 이 둘까지 빠진다 — 판정은 줄의 type이다.
      const mentions = '{"type":"assistant","message":{"content":[{"type":"text","text":"rate_limit_event란?"}]}}'
      const notJson = 'rate_limit_event 이건 JSON이 아니다'
      // 버린 줄은 상한에 세지 않는다 — 200자짜리 줄을 셌다면 아래 줄이 표식으로 바뀐다.
      const writer = createRawLogWriter(target, Buffer.byteLength(mentions + notJson) + 2, failOnError)
      writer.write(rateLimit)
      writer.write(mentions)
      writer.write(` ${rateLimit}`)
      writer.write(notJson)
      await writer.close()

      expect(readLines(target)).toEqual([mentions, notJson])
    } finally { t.cleanup() }
  })

  it('열기에 실패하면 onError로 흘려보내고, close()가 매달리지 않는다', async () => {
    const t = tempDir()
    try {
      const target = join(t.dir, 'raw.jsonl')
      // 같은 이름의 디렉토리 — append용 열기가 비동기로 실패한다(createLogWriter와 같은 함정).
      mkdirSync(target)

      let resolveSeen: (v: [string, unknown]) => void = () => {}
      const seen = new Promise<[string, unknown]>((r) => { resolveSeen = r })
      const writer = createRawLogWriter(target, RAW_LOG_MAX_BYTES, (message, err) => resolveSeen([message, err]))
      writer.write('{"type":"system"}')

      const [message, err] = await seen
      expect(message).toContain('원본 로그')
      expect(message).toContain(target)
      expect(err).toBeInstanceOf(Error)
      // 실패한 뒤에도 쓰기는 조용히 건너뛰고, close()는 풀려야 한다 — 매달리면 run이
      // 끝나지 않아 동시 실행 슬롯이 영영 점유된다.
      writer.write('{"type":"result"}')
      await writer.close()
    } finally { t.cleanup() }
  })

  it('디렉토리를 만들 수 없어도 던지지 않는다 — run을 죽이지 않고 onError로 간다', async () => {
    // 두 로그는 서로 독립이다(FR-4). 원본 로그 때문에 run 시작이 막히면 안 된다.
    const t = tempDir()
    try {
      const blocker = join(t.dir, 'blocker')
      writeFileSync(blocker, '')
      const target = join(blocker, 'r1', 'raw.jsonl')

      const errors: string[] = []
      let resolveSeen: () => void = () => {}
      const seen = new Promise<void>((r) => { resolveSeen = r })
      const writer = createRawLogWriter(target, RAW_LOG_MAX_BYTES, (message) => {
        errors.push(message)
        resolveSeen()
      })
      writer.write('{"type":"system"}')
      await seen
      await writer.close()
      expect(errors.some((m) => m.includes(target))).toBe(true)
    } finally { t.cleanup() }
  })

  it('기본 상한은 run당 32MiB다', () => {
    expect(RAW_LOG_MAX_BYTES).toBe(32 * 1024 * 1024)
  })
})
