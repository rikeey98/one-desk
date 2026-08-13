import type { AgentKind, Permission } from '@shared/models'
import type { RunEventInit } from '@shared/events'

export interface PreflightResult {
  ok: boolean
  /** 실행 파일의 절대 경로 (ok일 때) */
  executable?: string
  /** 실패 사유 (ok가 아닐 때) — 사용자에게 그대로 보여준다 */
  reason?: string
}

/** run 하나에 발급된 MCP 접속 정보. 호스트가 만들고 실행 서비스가 실어 나른다. */
export interface McpRunConfig {
  /** 도구 접두사가 `mcp__<serverName>`이 된다 */
  serverName: string
  /** 0600으로 쓰인 설정 파일 경로. 커맨드에는 이 경로만 실린다 */
  configFile: string
  /** 설정 파일 안에만 있어야 한다. 인자에 실으면 ps aux로 새어나간다 */
  token: string
  url: string
}

export interface ResolvedRunSpec {
  runId: string
  cwd: string
  model: string | null
  permission: Permission
  /** 맥락이 합쳐진 최종 프롬프트 */
  prompt: string
  /** 이어서 실행할 때의 외부 세션 id */
  resumeSessionId: string | null
  /** preflight가 찾은 실행 파일 경로 */
  executable: string
  /** MCP를 쓰지 않는 실행(테스트 등)이면 null */
  mcp: McpRunConfig | null
}

export interface SpawnSpec {
  cmd: string
  args: string[]
  env: Record<string, string>
  cwd: string
}

export interface AgentAdapter {
  kind: AgentKind
  preflight(explicitPath: string | null): Promise<PreflightResult>
  buildCommand(spec: ResolvedRunSpec): SpawnSpec
  /**
   * stdout 한 줄을 정규화 이벤트로 변환한다.
   * 관심 없는 줄이면 빈 배열. 한 줄이 여러 이벤트로 갈라질 수 있다.
   * seq는 호출자가 채운다 — 순번 관리는 runner의 책임이다.
   * 어댑터가 seq를 매기면 여러 run이 돌 때 순번이 꼬인다.
   */
  parseLine(line: string, runId: string): RunEventInit[]
}
