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
  /**
   * `execPath`를 띄울 때 브리지 env에 얹을 것 (`docs/sdlc/linux-launch-env/`, `core/runner/userEnv.ts`의 `appLoaderEnv`). 리눅스
   * 패키지에서는 앱이 뜬 `LD_LIBRARY_PATH`다 — agent는 서버 env를 자기 환경 위에 얹어 브리지를 띄우는데 그 환경은 사용자의
   * 값이라, 그대로면 앱이 시작하지 못한 것과 같은 이유로 브리지도 못 뜬다. 그 밖에서는 비었다.
   */
  execEnv: Record<string, string>
  /** bridge.mjs의 절대 경로. */
  bridgePath: string
  url: string
  token: string
}

/**
 * WSL run의 자리 (`docs/sdlc/wsl-support/` spec FR-21·22·23, §4-C). 브리지는 **Windows에 남는다** — WSL 안의 claude가 interop으로
 * Electron 실행 파일을 **직접** 자식으로 띄우고 stdio가 그 경계를 넘는다. `cmd.exe`를 거치지 않는다: v0.25.0까지의 `.bridge.cmd`
 * 배치는 cmd가 `/c` 뒤를 자기 규칙으로 다시 읽어 사용자 폴더 이름의 `&`·`^`·`%이름%`·괄호에서 쪼갰고, 배치를 OEM 코드 페이지로
 * 읽어 한글 경로를 깨뜨렸고, 사용자의 `AutoRun`까지 돌렸다(2026-10-12 실측). interop은 argv를 바이트 그대로 넘긴다(한글·공백·
 * `&^%!()` 전부 — 실측).
 */
export interface WslConfigTarget {
  /**
   * Electron 실행 파일(`McpConfigTarget.execPath`)을 **WSL 안에서 본 경로**(`/mnt/c/…/one-desk.exe`, `wslpath`로 바꾼 것). 이름이
   * `execPath`가 아닌 것은 Windows 경로인 그것과 바꿔 넣어도 컴파일되지 않게 — 둘 다 문자열이라 타입은 못 막는다.
   */
  command: string
}

/** WSL run에서 브리지가 인자로 받는 파일의 이름 — 설정 파일 옆에 둔다 */
export function bridgeFileOf(dir: string, runId: string): string {
  return join(dir, `${runId}.bridge.json`)
}

/**
 * WSL run의 브리지 env. **Linux 쪽 변수는 `WSLENV`에 이름이 있는 것만 interop을 넘어 Windows 프로세스에 간다** — 없으면
 * `ELECTRON_RUN_AS_NODE`가 오지 않아 Electron이 node가 아니라 앱으로 뜬다(§4-C 실측). claude는 서버 env를 자기 환경 위에 얹는다
 * (2.1.296 — 사용자가 둔 `WSLENV`는 이 서버 프로세스에서만 덮인다). 브리지에는 다른 Linux 변수가 필요 없다 — URL·토큰은 인자
 * 파일이다. `ELECTRON_RUN_AS_NODE`를 wsl.exe의 Windows 환경에 두면 claude가 띄우는 **모든** Windows 프로세스(Bash 도구의
 * `code .` 같은 것)에 퍼지므로 이 서버 env에만 둔다.
 */
const WSL_BRIDGE_ENV = { ELECTRON_RUN_AS_NODE: '1', WSLENV: 'ELECTRON_RUN_AS_NODE' } as const

function claudeWslBody(dir: string, runId: string, target: McpConfigTarget, wsl: WslConfigTarget): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: wsl.command,
        // 둘 다 **Windows 경로**다 — 읽는 쪽이 Windows 프로세스(Electron)이고 interop은 argv를 바꾸지 않는다
        args: [target.bridgePath, bridgeFileOf(dir, runId)],
        // execEnv는 싣지 않는다 — 브리지가 Windows 프로세스라 리눅스 로더의 변수가 뜻이 없다
        env: { ...WSL_BRIDGE_ENV }
      }
    }
  })
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
          ...target.execEnv,
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
          ...target.execEnv,
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
  }
  const body = wsl ? claudeWslBody(dir, runId, target, wsl) : agentKind === 'opencode' ? opencodeBody(target) : claudeBody(target)
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
}

/** 부팅 시 지난 실행이 남긴 파일을 치운다. 토큰은 이미 죽었지만 파일까지 남길 이유가 없다. */
export function clearMcpConfigs(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
