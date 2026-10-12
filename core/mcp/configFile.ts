import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentKind } from '@shared/models'

/**
 * MCP 서버 이름. 설정 파일의 `mcpServers` 키이자 CLI가 도구 이름을 붙이는
 * 접두사(`mcp__<이 값>__<도구명>`)다. `--allowedTools`에 넣는 `mcp__<이 값>`도
 * 같은 상수를 써야 한다 — 여기서만 정의하고 다른 곳은 전부 이 값을 참조한다.
 * 리터럴을 따로 두면 한쪽만 바뀌었을 때 도구 이름과 승인 목록이 어긋나
 * 모든 MCP 호출이 조용히 거부된다.
 *
 * `onedesk`가 아니라 `one-desk`인 이유: 사용자 레벨에 이미 `onedesk`라는
 * 다른 MCP 서버를 등록해 둔 환경이 있었다. `--strict-mcp-config`가 사용자
 * 설정을 무시하므로 기능상 충돌하지는 않지만, 로그와 `--allowedTools`에
 * 같은 이름이 두 벌 보이면 어느 쪽 호출인지 사람이 가릴 수 없다.
 */
export const MCP_SERVER_NAME = 'one-desk'

/**
 * run 하나의 MCP 설정 파일을 쓴다. 경로를 돌려준다.
 *
 * **토큰은 커맨드 인자에 넣지 않는다** — `--mcp-config`는 JSON 문자열도 받지만,
 * 인자는 `ps aux`로 같은 머신의 다른 사용자에게 그대로 보인다. 0600 파일에 담고
 * 경로만 넘긴다.
 */
export interface McpConfigTarget {
  /** 브리지를 띄울 실행 파일. 패키징된 앱에는 독립 node가 없어 Electron 바이너리를 쓴다. */
  execPath: string
  /** bridge.mjs의 절대 경로. */
  bridgePath: string
  url: string
  token: string
}

/**
 * WSL run의 자리 (`docs/sdlc/wsl-support/` spec FR-21·22·23). 브리지는 **Windows에 남는다** — WSL 안의 claude가 interop으로
 * Windows 실행 파일을 자식으로 띄우고 stdio가 그 경계를 넘는다. **env에는 아무것도 기대지 않는다**(실측을 못 한 채로 가기로
 * 했다 — spec §4-A): `command`는 `cmd.exe`의 Linux 경로이고 인자는 `/c <runId>.bridge.cmd`(Windows 경로)뿐이다. 그 `.cmd`가
 * `ELECTRON_RUN_AS_NODE=1`을 스스로 세우고 Electron 바이너리로 브리지를 띄우므로 env가 interop을 넘든 안 넘든 같다.
 * URL·토큰은 브리지가 인자로 받는 0600 파일(`<runId>.bridge.json`)에 있다 — 인자에는 경로만 나간다(토큰은 인자에 없다).
 */
export interface WslConfigTarget {
  /** `cmd.exe`의 Linux 경로 (`/mnt/c/Windows/System32/cmd.exe`) */
  cmdExe: string
}

/** WSL run의 브리지를 띄우는 배치 파일 — Windows 경로. `cmd.exe /c <이 경로>`로 돈다 */
export function bridgeCmdOf(dir: string, runId: string): string {
  return join(dir, `${runId}.bridge.cmd`)
}

/** WSL run에서 브리지가 인자로 받는 파일의 이름 — 설정 파일 옆에 둔다 */
export function bridgeFileOf(dir: string, runId: string): string {
  return join(dir, `${runId}.bridge.json`)
}

function claudeWslBody(dir: string, runId: string, wsl: WslConfigTarget): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: wsl.cmdExe,
        args: ['/c', bridgeCmdOf(dir, runId)]
      }
    }
  })
}

/**
 * 브리지를 띄우는 배치 파일의 본문. 경로는 전부 Windows 쪽 그대로다 — cmd.exe가 Windows 프로세스라 Linux 경로를 모른다.
 * `%`가 든 경로는 cmd가 변수로 펼치므로 `%%`로 둔다(그 밖의 글자는 따옴표 안에서 그대로다).
 */
function bridgeCmdBody(target: McpConfigTarget, bridgeFile: string): string {
  const q = (p: string) => `"${p.replace(/%/g, '%%')}"`
  return ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `${q(target.execPath)} ${q(target.bridgePath)} ${q(bridgeFile)}`, ''].join('\r\n')
}

function claudeBody(target: McpConfigTarget): string {
  // stdio 전송이다 — claude가 브리지를 자식 프로세스로 띄우고 표준입출력으로
  // 대화한다. HTTP였을 때는 사내 프록시가 루프백 요청을 403으로 막아 이 환경에서
  // 아예 못 썼다. stdio 구간에는 네트워크가 없어 프록시가 관여할 수 없다.
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: target.execPath,
        args: [target.bridgePath],
        env: {
          // Electron 바이너리를 순수 Node로 돌린다.
          ELECTRON_RUN_AS_NODE: '1',
          ONE_DESK_MCP_URL: target.url,
          ONE_DESK_MCP_TOKEN: target.token
        }
      }
    }
  })
}

/**
 * OpenCode는 키 이름과 구조가 다르다 — `mcp`, `type: "local"`, `command`가
 * 배열이고 `env`가 `environment`다. 전송은 똑같이 stdio라 bridge.mjs는 그대로다.
 */
function opencodeBody(target: McpConfigTarget): string {
  return JSON.stringify({
    mcp: {
      [MCP_SERVER_NAME]: {
        type: 'local',
        command: [target.execPath, target.bridgePath],
        environment: {
          ELECTRON_RUN_AS_NODE: '1',
          ONE_DESK_MCP_URL: target.url,
          ONE_DESK_MCP_TOKEN: target.token
        },
        enabled: true,
        // 지정하지 않으면 기본 5초다. 브리지가 앱 안의 HTTP 서버로 한 번 더
        // 중계하는 구조라 여유를 둔다.
        timeout: 30_000
      }
    }
  })
}

export function writeMcpConfig(
  dir: string,
  runId: string,
  target: McpConfigTarget,
  agentKind: AgentKind,
  wsl?: WslConfigTarget
): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `${runId}.json`)
  if (wsl) {
    if (agentKind === 'opencode') throw new Error('WSL repo에서는 OpenCode를 아직 쓸 수 없습니다')
    // 브리지 인자 파일 — URL·토큰은 여기에만 있다(FR-22). 설정 파일과 같은 권한 규칙이다.
    const bridgeFile = bridgeFileOf(dir, runId)
    writeFileSync(bridgeFile, JSON.stringify({ url: target.url, token: target.token }), { mode: 0o600 })
    chmodSync(bridgeFile, 0o600)
    writeFileSync(bridgeCmdOf(dir, runId), bridgeCmdBody(target, bridgeFile), { mode: 0o600 })
  }
  const body = wsl ? claudeWslBody(dir, runId, wsl) : agentKind === 'opencode' ? opencodeBody(target) : claudeBody(target)
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
  rmSync(bridgeFileOf(dir, runId), { force: true })
  rmSync(bridgeCmdOf(dir, runId), { force: true })
}

/** 부팅 시 지난 실행이 남긴 파일을 치운다. 토큰은 이미 죽었지만 파일까지 남길 이유가 없다. */
export function clearMcpConfigs(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
