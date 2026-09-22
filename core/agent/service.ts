import type { AgentAuth, AgentKind, AgentModel, AgentProbe, AgentProbes } from '@shared/models'
import type { PreflightResult } from '../runner/types'

/**
 * 준비 상태를 만드는 세 칸의 재료. **전부 주입받는다** — 실행 파일 해석도, 인증
 * 조회도, 모델 probe도 이미 다른 곳에 단일 출처가 있다. 여기서 다시 구현하면
 * 설정 화면과 실행 버튼이 다른 판정을 하게 된다(spec NFR-3·NFR-4).
 */
export interface AgentProbeDeps {
  /** `resolveAgentPath` → 어댑터 `preflight`. `checkAgents`가 쓰는 것과 같은 길이다 */
  preflight: (kind: AgentKind, workspaceId: string) => Promise<PreflightResult>
  checkAuth: (kind: AgentKind, executable: string) => Promise<AgentAuth>
  /** 슬래시 커맨드 probe가 실어 온 것. **캐시를 그쪽과 공유한다** */
  agentInfo: (input: { workspaceId: string; cwd: string }) => Promise<{
    model: string | null
    version: string | null
    error: string | null
  }>
  listModels: (kind: AgentKind, executable: string) => Promise<string[]>
  /**
   * probe를 돌릴 cwd. 실행 패널이 쓰는 것과 같아야 한다 — repo의
   * `.claude/settings.json`이 모델을 정할 수 있어 아무 데서나 돌리면 실행과
   * 다른 답이 나온다. 없으면 null.
   */
  firstRepoPath: (workspaceId: string) => string | null
}

const KINDS: AgentKind[] = ['claude-code', 'opencode']

function unknownAuth(reason: string): AgentAuth {
  return { state: 'unknown', reason }
}

function skipped(reason: string): AgentModel {
  return { state: 'skipped', reason }
}

/**
 * "이 CLI로 지금 대화가 되는가"를 만든다 (docs/sdlc/agent-setup/ FR-1).
 *
 * **세 칸이 쌓이고, 앞 칸이 통과해야 뒤가 돈다.**
 *
 * 1. 실행 파일 — 값싼 파일 검사. 막히면 뒤는 물을 것도 없다.
 * 2. 인증 — 0.24초. **이 칸이 없으면 이 기능이 고치려던 문제가 그대로 남는다:**
 *    claude의 `init`은 인증을 보지 않아 토큰이 없어도 모델 이름을 되돌려 준다
 *    (2026-09-22 실측). probe만 붙이면 아무것도 못 돌리는 사람에게 초록으로
 *    `claude-opus-5[1m]`를 자신 있게 띄우게 된다.
 * 3. 모델 — 0.9초, 슬래시 커맨드 probe와 같은 기동.
 *
 * **`checkAgents`를 대신하지 않는다.** 그쪽은 빠른 칸 하나만 보고 즉시 답하며,
 * 화면은 둘을 같이 불러 빠른 것으로 먼저 그린다(spec NFR-4).
 *
 * **던지지 않는다.** 어느 칸이 터져도 `unknown`으로 돌아온다 — 이 조회의 실패가
 * 실행을 막거나 화면을 비우면 안 된다(FR-6).
 */
export function createAgentProbeService(deps: AgentProbeDeps) {
  async function authOf(kind: AgentKind, executable: string): Promise<AgentAuth> {
    try {
      return await deps.checkAuth(kind, executable)
    } catch (err) {
      return unknownAuth(`인증 상태를 조회하지 못했습니다 (${message(err)})`)
    }
  }

  async function modelsOf(kind: AgentKind, executable: string): Promise<string[]> {
    try {
      return await deps.listModels(kind, executable)
    } catch {
      // 제안이 없을 뿐 칸은 그대로 쓸 수 있다(FR-8).
      return []
    }
  }

  async function probeOne(kind: AgentKind, workspaceId: string): Promise<AgentProbe> {
    // 1) 실행 파일
    const pre = await deps.preflight(kind, workspaceId)
    if (!pre.ok || !pre.executable) {
      const reason = pre.reason ?? '실행 파일을 찾을 수 없습니다'
      return {
        auth: unknownAuth(reason),
        model: skipped(reason),
        version: null,
        models: []
      }
    }
    const executable = pre.executable

    // 2) 인증. 모델 목록은 인증과 무관하게 조회된다(실측: 자격 증명 0개여도 382개)
    //    — 그래서 같이 띄운다.
    const [auth, models] = await Promise.all([
      authOf(kind, executable),
      modelsOf(kind, executable)
    ])

    // 3) 모델과 버전. 둘은 **같은 probe 한 번**에서 온다 — 따로 물으면 캐시가
    //    없을 때 CLI가 두 번 뜬다.
    //
    //    **인증이 `none`이면 돌리지 않는다**(FR-2) — 0.9초와 SessionStart 훅
    //    한 번을 아끼고, 무엇보다 못 쓰는 설정에 모델 이름을 붙이지 않는다.
    //    `unknown`일 때는 돌린다: 모르는 것과 없는 것은 다르고, 모른다는 이유로
    //    감추면 `auth status`가 없는 옛 CLI에서 화면이 통째로 빈다.
    const resolved = await modelAndVersion(kind, workspaceId, auth)
    return { auth, model: resolved.model, version: resolved.version, models }
  }

  /**
   * 셋째 칸. **캐시를 두지 않는다** — 슬래시 커맨드 서비스가 cwd별로 이미 쥐고
   * 있고(`agentInfo`), 여기에 하나 더 두면 `다시 확인`이 그쪽만 비워 옛 값이 남는다.
   */
  async function modelAndVersion(
    kind: AgentKind, workspaceId: string, auth: AgentAuth
  ): Promise<{ model: AgentModel; version: string | null }> {
    // OpenCode는 스트림 어디에도 모델이 없다(docs/sdlc/run-info/ 실측).
    // "무엇을 넘겼나"까지만 알 수 있으므로 여기서는 늘 건너뛴다.
    if (kind === 'opencode') {
      return { model: skipped('OpenCode는 실제로 쓰인 모델을 알려주지 않습니다.'), version: null }
    }
    if (auth.state === 'none') {
      return { model: skipped('로그인한 뒤에 확인합니다.'), version: null }
    }
    // probe의 cwd는 실행 패널이 쓰는 것과 같아야 한다 — repo의
    // `.claude/settings.json`이 모델을 정할 수 있어, 아무 데서나 돌리면
    // 실행과 다른 답이 나온다.
    const cwd = deps.firstRepoPath(workspaceId)
    if (!cwd) {
      return { model: skipped('repo를 등록하면 확인합니다.'), version: null }
    }

    try {
      const probed = await deps.agentInfo({ workspaceId, cwd })
      if (probed.error) {
        return { model: { state: 'unknown', reason: probed.error }, version: probed.version }
      }
      if (!probed.model) {
        return {
          model: { state: 'unknown', reason: '모델 이름이 오지 않았습니다.' },
          version: probed.version
        }
      }
      // **"유효하다"는 뜻이 아니다** — init은 모델을 검증하지 않는다(`gpt-9`도
      // 그대로 통과, 2026-09-22 실측). 화면 문구가 이 선을 넘으면 안 된다.
      return { model: { state: 'resolved', model: probed.model }, version: probed.version }
    } catch (err) {
      return {
        model: { state: 'unknown', reason: `모델을 확인하지 못했습니다 (${message(err)})` },
        version: null
      }
    }
  }

  return {
    async probeAgents(workspaceId: string): Promise<AgentProbes> {
      const entries = await Promise.all(KINDS.map(async (kind) => {
        try {
          return [kind, await probeOne(kind, workspaceId)] as const
        } catch (err) {
          // 한쪽이 터져도 다른 쪽 결과는 보여준다.
          const reason = `확인하지 못했습니다 (${message(err)})`
          return [kind, {
            auth: unknownAuth(reason), model: skipped(reason), version: null, models: []
          }] as const
        }
      }))
      return Object.fromEntries(entries) as AgentProbes
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export type AgentProbeService = ReturnType<typeof createAgentProbeService>
