import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
      onedesk: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` }
      }
    }
  })
  // mode 인자만으로는 umask가 비트를 깎을 수 있다. 쓰고 나서 명시적으로 잠근다.
  writeFileSync(file, body, { mode: 0o600 })
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
