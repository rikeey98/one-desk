import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createLogWriter } from './logWriter'
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
