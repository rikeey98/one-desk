import type { AgentKind } from '@shared/models'
import type { RunCli } from './types'
import { stripAnsi } from './auth'

/** 목록 조회는 실측 1.6초다. 느린 장비를 감안해 넉넉히 준다. */
const TIMEOUT_MS = 15_000

/**
 * 모델 칸의 **제안 목록**을 얻는다 (docs/sdlc/agent-setup/ FR-9).
 *
 * **두 CLI가 정반대다.** opencode는 `models`로 목록을 주지만(실측 382줄) 실제로 무엇이
 * 돌았는지는 알려주지 않고, claude는 목록을 주는 수단이 아예 없지만 `init`이 해석된
 * 이름을 돌려준다. 그래서 여기는 opencode만 다루고, claude의 제안은 화면이 가진
 * 별칭 표가 맡는다.
 *
 * **목록은 준비 상태가 아니다.** `opencode models`는 자격 증명이 0개여도 382개를
 * 돌려준다(실측). 준비 상태는 `checkAuth`가 따로 본다.
 *
 * **cwd와 무관하므로 실행 파일마다 캐시한다.** 슬래시 커맨드 캐시가 cwd별인 것과
 * 다르다 — 그쪽은 repo의 커맨드 파일을 훑기 때문이다.
 */
export function createModelCatalog(run: RunCli) {
  /** 실행 파일 경로 → 목록. 프로세스가 사는 동안만 유지한다 */
  const cache = new Map<string, string[]>()
  /** 아직 돌고 있는 조회. 동시에 부르면 CLI를 두 번 띄우지 않고 나눠 쓴다 */
  const loading = new Map<string, Promise<string[]>>()

  async function load(executable: string): Promise<string[]> {
    try {
      const out = await run({ executable, args: ['models'], timeoutMs: TIMEOUT_MS })
      // 제안이 없을 뿐 칸은 그대로 쓸 수 있다(FR-8) — 실패를 던지지 않는다.
      if (out.failure || out.code !== 0) return []
      return stripAnsi(out.stdout)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  }

  function fetchOnce(executable: string): Promise<string[]> {
    const running = loading.get(executable)
    if (running) return running

    const started = load(executable)
      .then((models) => {
        // **실패(빈 목록)도 캐시한다.** 화면을 오갈 때마다 프로세스를 띄우지
        // 않기 위해서다 — 슬래시 커맨드가 같은 이유로 실패를 캐시한다.
        cache.set(executable, models)
        return models
      })
      .finally(() => { loading.delete(executable) })

    loading.set(executable, started)
    return started
  }

  return {
    list(kind: AgentKind, executable: string): Promise<string[]> {
      // claude에는 목록을 얻을 수단이 없다 — 괜히 띄우지 않는다.
      if (kind !== 'opencode') return Promise.resolve([])
      const cached = cache.get(executable)
      if (cached) return Promise.resolve(cached)
      return fetchOnce(executable)
    },

    /** 캐시를 버린다. 화면의 `다시 확인`이 부른다 */
    refresh(): void {
      cache.clear()
    }
  }
}

export type ModelCatalog = ReturnType<typeof createModelCatalog>
