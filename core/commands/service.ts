import type { CommandDescription, CommandPlugin, ProbeResult } from './types'
import type { CommandInfo, CommandListResult, CommandTarget } from '@shared/models'

export type { CommandTarget } from '@shared/models'

export interface CommandServiceDeps {
  /**
   * 실행 파일 해석은 주입하는 쪽(`core/index.ts`)이 한다 — `core/runner/agentPath.ts`가
   * workspace를 봐야 하고, 여기서 다시 하면 두 벌이 된다.
   */
  probe: (target: CommandTarget) => Promise<ProbeResult>
  describe: (input: { cwd: string; plugins: CommandPlugin[] }) => Promise<Map<string, CommandDescription>>
}

/** 지도에 없는 이름(내장 커맨드)도 목록에는 남는다 — 설명 없이(FR-3). */
const UNDESCRIBED: CommandDescription = { description: null, usesArguments: false }

/**
 * probe와 describe를 합쳐 피커가 쓰는 목록을 만들고 **작업 디렉토리마다 한 번만** 얻는다(FR-13).
 *
 * 캐시가 core에 있어야 하는 이유: 도크가 대화 탭을 바꿀 때마다 `RunPanel`을 재마운트하는데,
 * 캐시가 렌더러에 있으면 그때마다 CLI가 다시 떠 사용자의 `SessionStart` 훅이 같이 돈다.
 * 프로세스가 사는 동안만 유지한다 — 커맨드는 발견된 사실이지 기록할 데이터가 아니다(설계 › 데이터 모델).
 */
/**
 * 한 번의 probe가 준 것 전부. **커맨드 목록과 agent 정보가 같은 기동에서 온다** —
 * 그래서 설정 화면이 모델 이름 때문에 CLI를 또 띄우지 않는다
 * (docs/sdlc/agent-setup/ NFR-3).
 */
interface Entry {
  list: CommandListResult
  /** init이 해석해 준 모델 이름. 없으면 null */
  model: string | null
  version: string | null
}

/** 커맨드 목록을 빼고 남은 것. `agentInfo`가 돌려준다 */
export interface ProbedAgentInfo {
  model: string | null
  version: string | null
  /** probe가 실패한 사유. 성공이면 null */
  error: string | null
}

export function createCommandService(deps: CommandServiceDeps) {
  const cache = new Map<string, Entry>()
  /** 아직 돌고 있는 조회. 같은 cwd로 동시에 부르면 CLI를 두 번 띄우지 않고 이것을 나눠 쓴다. */
  const loading = new Map<string, Promise<Entry>>()

  async function load(target: CommandTarget): Promise<Entry> {
    const probed = await deps.probe(target)
    const described = await deps.describe({ cwd: target.cwd, plugins: probed.plugins })

    // 터미널이 있어야 도는 것은 헤드리스에서 무의미하다 — 피커에 띄우지 않는다(FR-2).
    const terminalOnly = new Set(probed.terminalSlashCommands)
    const commands: CommandInfo[] = probed.slashCommands
      .filter((name) => !terminalOnly.has(name))
      .map((name) => ({ name, ...(described.get(name) ?? UNDESCRIBED) }))

    return {
      list: { commands, error: probed.error },
      model: probed.model,
      version: probed.version
    }
  }

  function fetchOnce(target: CommandTarget): Promise<Entry> {
    const running = loading.get(target.cwd)
    if (running) return running

    const started = load(target)
      .then((entry) => {
        // 실패도 유지한다 — 탭 재마운트로 SessionStart 훅을 반복하지 않는다.
        cache.set(target.cwd, entry)
        return entry
      })
      .finally(() => { loading.delete(target.cwd) })

    loading.set(target.cwd, started)
    return started
  }

  return {
    /** 캐시에 있으면 CLI를 띄우지 않는다. 없으면 얻어서 담는다. 실패의 재시도도 refresh가 맡는다. */
    list(target: CommandTarget): Promise<CommandListResult> {
      const cached = cache.get(target.cwd)
      if (cached) return Promise.resolve(cached.list)
      return fetchOnce(target).then((e) => e.list)
    },

    /**
     * 같은 probe가 실어 온 agent 정보 (docs/sdlc/agent-setup/ FR-1의 셋째 칸).
     *
     * **캐시를 `list`와 공유한다.** 실행 패널이 슬래시 커맨드 때문에 이미 돌린
     * probe가 있으면 설정 화면은 CLI를 띄우지 않는다 — 그 반대도 같다.
     */
    agentInfo(target: CommandTarget): Promise<ProbedAgentInfo> {
      const cached = cache.get(target.cwd)
      const entry = cached ? Promise.resolve(cached) : fetchOnce(target)
      return entry.then((e) => ({ model: e.model, version: e.version, error: e.list.error }))
    },

    /**
     * 캐시를 버리고 다시 얻는다(FR-13의 새로고침).
     *
     * 이미 돌고 있는 조회가 있으면 그것을 나눠 쓴다 — 방금 뜬 CLI가 줄 답이 이미 최신이라
     * 하나 더 띄우면 `SessionStart` 훅만 한 번 더 도는 셈이다.
     */
    refresh(target: CommandTarget): Promise<CommandListResult> {
      cache.delete(target.cwd)
      return fetchOnce(target).then((e) => e.list)
    },

    /** 캐시만 버린다. 설정 화면의 `다시 확인`이 조회 전에 부른다 */
    invalidate(cwd: string): void {
      cache.delete(cwd)
    }
  }
}

export type CommandService = ReturnType<typeof createCommandService>
