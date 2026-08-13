/**
 * "그 id의 행이 없다"를 나머지 오류와 구분하기 위한 타입.
 *
 * 메시지 문자열로 판별하면 문구를 다듬는 순간 조용히 깨진다. 호출자가
 * DB 장애와 부재를 갈라야 하는 자리가 두 곳 있다 — execution.resume과 MCP의
 * workspace 가드다.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * core가 삼킨 오류를 흘려보내는 곳.
 *
 * core/는 나중에 별도 데몬으로 떨어질 수 있으므로 목적지를 스스로 정하지 않는다.
 * 부르는 쪽(Electron main, 테스트)이 정한다.
 */
export type ErrorSink = (message: string, err: unknown) => void

/** 아무도 정해주지 않았을 때의 기본값. 조용해지는 것보다는 stderr가 낫다. */
export const consoleErrorSink: ErrorSink = (message, err) => {
  console.error(message, err)
}
