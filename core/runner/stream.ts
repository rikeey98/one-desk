import { StringDecoder } from 'node:string_decoder'

export interface LineSplitter {
  (chunk: Buffer): void
  /** 개행 없이 끝난 마지막 줄을 내보낸다. 프로세스 종료 시 호출한다. */
  flush(): void
}

/**
 * stdout 청크를 줄 단위로 쪼갠다.
 *
 * 청크는 줄 경계와 무관하게 도착하고, 멀티바이트 문자가 청크 사이에서
 * 잘릴 수 있다. StringDecoder가 불완전한 바이트를 들고 있다가 이어붙인다.
 */
export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  const decoder = new StringDecoder('utf8')
  let buffer = ''

  const push = ((chunk: Buffer) => {
    buffer += decoder.write(chunk)
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trimEnd()
      if (line) onLine(line)
    }
  }) as LineSplitter

  push.flush = () => {
    buffer += decoder.end()
    const line = buffer.trimEnd()
    buffer = ''
    if (line) onLine(line)
  }

  return push
}
