import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * MCP 서버 이름. 설정 파일의 `mcpServers` 키이자 CLI가 도구 이름을 붙이는
 * 접두사(`mcp__<이 값>__<도구명>`)다. `--allowedTools`에 넣는 `mcp__<이 값>`도
 * 같은 상수를 써야 한다 — 여기서만 정의하고 다른 곳은 전부 이 값을 참조한다.
 * 리터럴을 따로 두면 한쪽만 바뀌었을 때 도구 이름과 승인 목록이 어긋나
 * 모든 MCP 호출이 조용히 거부된다.
 */
export const MCP_SERVER_NAME = 'onedesk'

/**
 * run 하나의 MCP 설정 파일을 쓴다. 경로를 돌려준다.
 *
 * **토큰은 커맨드 인자에 넣지 않는다** — `--mcp-config`는 JSON 문자열도 받지만,
 * 인자는 `ps aux`로 같은 머신의 다른 사용자에게 그대로 보인다. 0600 파일에 담고
 * 경로만 넘긴다.
 */
export function writeMcpConfig(dir: string, runId: string, url: string, token: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${runId}.json`)
  const body = JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` }
      }
    }
  })
  // writeFileSync의 mode 옵션은 파일을 "새로" 만들 때만 적용된다 — 이미 존재하는
  // 파일(예: 이전 비정상 종료가 남긴 동명 파일)을 열 때는 기존 권한이 그대로
  // 남는다. chmodSync로 매번 명시적으로 0600을 강제해 그 경우까지 막는다.
  writeFileSync(file, body, { mode: 0o600 })
  chmodSync(file, 0o600)
  return file
}

/** 토큰을 폐기하는 자리에서 함께 부른다. 파일이 없어도 던지지 않는다. */
export function removeMcpConfig(dir: string, runId: string): void {
  rmSync(join(dir, `${runId}.json`), { force: true })
}

/** 부팅 시 지난 실행이 남긴 파일을 치운다. 토큰은 이미 죽었지만 파일까지 남길 이유가 없다. */
export function clearMcpConfigs(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
