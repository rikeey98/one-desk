import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import type { RunEvent } from '@shared/events'

export interface LogWriter {
  write(event: RunEvent): void
  close(): Promise<void>
}

/** 정규화된 이벤트를 JSONL로 append한다. */
export function createLogWriter(path: string): LogWriter {
  mkdirSync(dirname(path), { recursive: true })
  const stream: WriteStream = createWriteStream(path, { flags: 'a' })

  return {
    write(event) {
      stream.write(`${JSON.stringify(event)}\n`)
    },
    close() {
      return new Promise((resolve) => stream.end(resolve))
    }
  }
}
