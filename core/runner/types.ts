import type { AgentKind, Permission, PlanUsage } from '@shared/models'
import type { RunEventInit } from '@shared/events'

/**
 * opencode CLI의 방언 (`docs/sdlc/opencode-v2/` spec §2-1). 1.x와 2.x는 권한을 넘기는 통로·인자·MCP 설정 모양이 다르다.
 * **명령을 만드는 쪽만 가른다** — 줄을 읽는 쪽(parseLine)은 두 모양을 다 읽는다.
 */
export type OpencodeDialect = 'v1' | 'v2'

export interface PreflightResult {
  ok: boolean
  /** 실행 파일의 절대 경로 (ok일 때) */
  executable?: string
  /** 실패 사유 (ok가 아닐 때) — 사용자에게 그대로 보여준다 */
  reason?: string
  /** opencode만 싣는다 (ok일 때). 버전을 못 읽었으면 `v1`이다 — 틀린 방언은 실행 직전 확인이 잡는다 (spec FR-2·§2-2) */
  dialect?: OpencodeDialect
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
  /**
   * claude면 `--effort`, opencode면 `--variant`. null이면 그 인자를 붙이지 않는다.
   *
   * **어댑터가 값을 검증하지 않는다** — CLI 자신도 검증하지 않는다(`--effort bogus`도
   * 통과, 2026-09-22 실측). 고르는 자리(화면의 드롭다운)가 유일한 가드다.
   */
  effort: string | null
  permission: Permission
  /** 맥락이 합쳐진 최종 프롬프트 */
  prompt: string
  /** 이어서 실행할 때의 외부 세션 id */
  resumeSessionId: string | null
  /** preflight가 찾은 실행 파일 경로 */
  executable: string
  /** MCP를 쓰지 않는 실행(테스트 등)이면 null */
  mcp: McpRunConfig | null
  /**
   * opencode의 방언 — preflight가 정한 것 (opencode-v2 spec FR-3). claude는 null이다. **필수다** — 선택이면 한 자리를 빠뜨려도
   * 컴파일되고 그 길만 2.x를 1.x 방식으로 띄운다(권한이 통째로 무시된다).
   */
  dialect: OpencodeDialect | null
}

/** 실행 직전 마지막 확인에 필요한 것. preflight는 cwd를 받지 않는다. */
export interface VerifyRunnableInput {
  executable: string
  cwd: string
  permission: Permission
  /** opencode의 방언 (opencode-v2 spec FR-3). claude는 null이다. 필수다 — `ResolvedRunSpec.dialect`와 같은 이유 */
  dialect: OpencodeDialect | null
  /** 모델과 variant — 2.x는 variant를 `model#variant`로만 넘길 수 있어, 모델 없는 variant를 실행 전에 막는다 (FR-10) */
  model: string | null
  effort: string | null
  /**
   * 이어 갈 세션 — **launch 시점에 이미 아는 것만** (FR-14). 앞 턴이 아직 돌고 있어 세션이 없으면 null이다(그 세션은 지금
   * 쓰이는 중이라 없을 수 없다). 2.x의 `--session`은 없는 id로 새 세션을 만들 수 있어 실행 전에 있는지 본다.
   */
  resumeSessionId: string | null
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
  /**
   * 이 어댑터가 낸 `error` 이벤트가 **실패 이유**인가 (`docs/sdlc/conversation-fixes/` spec FR-13).
   *
   * manager는 실패한 run의 errorMessage를 "마지막 error 이벤트 → stderr" 순으로 채우는데,
   * **error 이벤트의 뜻이 어댑터마다 다르다.** opencode는 json 모드에서 오류를 stdout의
   * error 줄로만 낸다(stderr는 비어 있다) — true다. claude의 error 이벤트는 MCP 연결
   * 경고뿐이고 run을 실패시키지 않는다 — 실패 이유로 쓰면 진짜 원인(stderr)을 가리므로
   * 켜지 않는다. 없으면 false다. spawn 오류는 어댑터가 아니라 manager가 내므로 이 값과
   * 무관하게 실패 이유가 된다.
   */
  errorEventsAreFailureReasons?: boolean
  /**
   * stdout 한 줄에서 계정의 요금제 사용률을 읽는다 (`docs/sdlc/plan-usage/` FR-3). 아니면 null.
   *
   * **`parseLine`과 따로다** — 이벤트가 되면 manager가 `stream.jsonl`에 쓰고 run 이벤트로 흘린다.
   * 이 값은 저장하지 않는다(FR-1). 구독 한도 개념이 있는 어댑터(claude)만 구현한다.
   * `observedAt`은 manager가 채운다.
   */
  parsePlanUsage?(line: string): Omit<PlanUsage, 'observedAt'> | null
  /**
   * preflight를 통과한 뒤, 실제로 쓸 cwd와 권한으로 마지막 확인을 한다.
   *
   * **필요한 어댑터만 구현한다.** claude는 권한 플래그를 우리가 전부 소유하므로
   * 합쳐질 남의 설정이 없다. OpenCode는 설정이 병합되고 그중 일부는 우리가
   * 이길 수 없어(설계 §2-3) 이 단계가 필요하다.
   */
  verifyRunnable?(input: VerifyRunnableInput): Promise<PreflightResult>
  /**
   * 통과한 preflight에 붙일 안내 (docs/sdlc/opencode-v2/ spec FR-8a). 실행은 되지만 사람이 미리 알아야 하는 제약이 있으면
   * 그 문장, 없으면 null. 설정 화면의 느린 칸이 부른다 — 프로세스를 띄울 수 있다.
   */
  statusNote?(preflight: PreflightResult): Promise<string | null>
}
