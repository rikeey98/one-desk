import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import type { RunEvent } from '@shared/events'
import { consoleErrorSink, type ErrorSink } from '../errors'

export interface LogWriter {
  write(event: RunEvent): void
  close(): Promise<void>
}

/**
 * append 전용 파일 하나. 두 로그(정규화·원본)가 같은 실패 규칙을 쓴다.
 *
 * createWriteStream의 open은 **비동기**다. mkdirSync가 방금 만든 디렉토리라도 그
 * 사이에 사라질 수 있고, 디스크가 차거나 권한이 막히거나 경로가 너무 길어도
 * 실패한다. error 리스너가 없으면 그 실패가 처리되지 않은 예외가 되어 Electron
 * 메인 프로세스를 통째로 죽인다.
 */
function openAppendFile(path: string, onError: ErrorSink, what: string) {
  const stream: WriteStream = createWriteStream(path, { flags: 'a' })

  let failed = false
  stream.on('error', (err) => {
    failed = true
    onError(`${what}를 쓸 수 없습니다: ${path}`, err)
  })

  return {
    write(text: string) {
      // 실패한 스트림에 또 쓰면 error가 한 번 더 나고 그때마다 리스너가 돈다.
      if (failed) return
      stream.write(text)
    },
    close(): Promise<void> {
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

/**
 * 정규화된 이벤트를 JSONL로 append한다.
 *
 * 로그를 못 남기는 것은 run을 죽일 이유가 아니므로, 실패를 알리고 이후
 * 쓰기를 건너뛴다(openAppendFile). DB의 run 기록은 그대로 남고 로그만 비게 된다.
 */
export function createLogWriter(path: string, onError: ErrorSink = consoleErrorSink): LogWriter {
  mkdirSync(dirname(path), { recursive: true })
  const file = openAppendFile(path, onError, 'run 로그')

  return {
    write(event) {
      file.write(`${JSON.stringify(event)}\n`)
    },
    close: () => file.close()
  }
}

/**
 * 원본 줄 로그(`raw.jsonl`)의 run당 상한 — UTF-8 바이트, 개행 포함
 * (`docs/sdlc/conversation-events/` spec FR-3).
 */
export const RAW_LOG_MAX_BYTES = 32 * 1024 * 1024

/**
 * `raw.jsonl`에 **쓰지 않는** 줄의 `type` (spec §7-A).
 *
 * `rate_limit_event`는 Claude 구독 상태·리셋 시각이다 — 개인 계정 정보이고, run-info
 * spec §7이 "로그 파일에는 원본 줄이 남지 않는다"고 약속한 유일한 type이다. 원본 줄
 * 로그는 "모든 줄"이 원칙이므로(FR-1) 예외는 여기 한 자리에만 둔다.
 */
export const RAW_LOG_EXCLUDED_TYPES: readonly string[] = ['rate_limit_event']

/**
 * 제외할 줄인가. **판정은 줄의 `type`이다** — 글자로만 거르면 그 이름을 본문에 담은
 * 다른 줄(대화에서 그 이름을 말한 assistant 줄)까지 빠진다.
 *
 * 먼저 글자로 거르는 것은 비용 때문이다. 어댑터가 곧 같은 줄을 한 번 더 파싱하므로
 * 줄마다 JSON.parse를 두 번 하지 않는다 — 이름이 들어 있는 줄만 파싱한다.
 */
function isExcludedRawLine(line: string): boolean {
  if (!RAW_LOG_EXCLUDED_TYPES.some((type) => line.includes(type))) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  const type = (parsed as { type?: unknown }).type
  return typeof type === 'string' && RAW_LOG_EXCLUDED_TYPES.includes(type)
}

export interface RawLogWriter {
  /** 줄 분할기가 넘긴 stdout 한 줄. 개행은 writer가 붙인다 */
  write(line: string): void
  close(): Promise<void>
}

/**
 * CLI의 stdout 줄을 **받은 그대로** append한다 (spec FR-1·FR-3·FR-4).
 *
 * 정규화 로그(`createLogWriter`)는 어댑터가 고른 것만 남아서, 파서를 넓혀도 이미 끝난
 * 대화에는 소급되지 않는다. 이 파일은 그 재료다 — 읽는 코드는 없다(`readLog`는
 * 정규화 로그만 읽는다, FR-6).
 *
 * **상한을 넘기는 순간** 그 줄 대신 표식 한 줄을 쓰고 이후 줄은 전부 버린다. 표식은
 * 한 번뿐이고 상한 밖에 붙는다(파일은 상한 + 표식 한 줄까지 자란다). 표식에는 `type`이
 * 없다 — 두 CLI의 줄은 전부 `type`을 가지므로 다시 파싱하는 쪽이 헷갈리지 않는다.
 *
 * **run을 죽이지 않는다.** 디렉토리를 못 만들거나 파일을 못 열어도 던지지 않고
 * onError로 한 번 알린 뒤 쓰기를 건너뛴다. 정규화 로그와 서로 독립이다 — 한쪽이
 * 실패해도 다른 쪽은 계속 쓴다(FR-4).
 *
 * onError에 기본값이 없는 이유는 `RunManagerOptions.onError`와 같다 — 넘기는 한 줄을
 * 지워도 조용히 컴파일되면 오류가 앱의 sink 대신 stderr로 샌다.
 */
export function createRawLogWriter(path: string, maxBytes: number, onError: ErrorSink): RawLogWriter {
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch {
    // 알리는 것은 아래 열기다 — 디렉토리가 없으면 open이 비동기로 실패해 onError로 간다.
    // 여기서 던지면 원본 로그 하나 때문에 run 시작이 막힌다.
  }
  const file = openAppendFile(path, onError, 'run 원본 로그')

  let written = 0
  let truncated = false

  return {
    write(line) {
      if (truncated || isExcludedRawLine(line)) return
      const bytes = Buffer.byteLength(line, 'utf8') + 1
      if (written + bytes > maxBytes) {
        truncated = true
        file.write(`${JSON.stringify({ oneDesk: 'raw-truncated', limitBytes: maxBytes, at: Date.now() })}\n`)
        return
      }
      written += bytes
      file.write(`${line}\n`)
    },
    close: () => file.close()
  }
}
