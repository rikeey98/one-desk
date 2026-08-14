import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import type { RunEvent } from '@shared/events'
import { consoleErrorSink, type ErrorSink } from '../errors'

export interface LogWriter {
  write(event: RunEvent): void
  close(): Promise<void>
}

/**
 * 정규화된 이벤트를 JSONL로 append한다.
 *
 * onError를 받는 이유: createWriteStream의 open은 **비동기**다. mkdirSync가
 * 방금 만든 디렉토리라도 그 사이에 사라질 수 있고, 디스크가 차거나 권한이
 * 막히거나 경로가 너무 길어도 실패한다. error 리스너가 없으면 그 실패가
 * 처리되지 않은 예외가 되어 Electron 메인 프로세스를 통째로 죽인다.
 *
 * 로그를 못 남기는 것은 run을 죽일 이유가 아니므로, 실패를 알리고 이후
 * 쓰기를 건너뛴다. DB의 run 기록은 그대로 남고 로그만 비게 된다.
 */
export function createLogWriter(path: string, onError: ErrorSink = consoleErrorSink): LogWriter {
  mkdirSync(dirname(path), { recursive: true })
  const stream: WriteStream = createWriteStream(path, { flags: 'a' })

  let failed = false
  stream.on('error', (err) => {
    failed = true
    onError(`run 로그를 쓸 수 없습니다: ${path}`, err)
  })

  return {
    write(event) {
      // 실패한 스트림에 또 쓰면 error가 한 번 더 나고 그때마다 리스너가 돈다.
      if (failed) return
      stream.write(`${JSON.stringify(event)}\n`)
    },
    close() {
      return new Promise((resolve) => {
        // 이미 깨진 스트림에 end()를 부르면 콜백이 오지 않을 수 있다.
        // 여기서 매달리면 run이 끝나지 않아 동시 실행 슬롯이 영영 점유된다.
        if (failed) {
          resolve()
          return
        }
        stream.once('error', () => resolve())
        stream.end(() => resolve())
      })
    }
  }
}
